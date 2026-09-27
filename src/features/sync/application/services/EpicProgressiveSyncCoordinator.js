'use strict';

const { EpicEnrichmentScheduler } = require('./EpicEnrichmentScheduler');
const PHASES = ['library', 'prices', 'purchaseHistory'];
const TERMINAL = new Set(['complete', 'partial', 'failed', 'waiting_for_auth', 'cancelled']);
const clone = (value) => JSON.parse(JSON.stringify(value));
const phaseState = (status = 'pending') => ({ status, errorCode: null });

class StaleEpicSyncRunError extends Error {
    constructor() {
        super('Epic sync run is no longer current.');
        this.code = 'EPIC_SYNC_RUN_STALE';
    }
}

class EpicProgressiveSyncCoordinator {
    constructor({
        store, emit = () => {}, now = () => new Date().toISOString(), nowMs = () => Date.now(),
        isAccountActive = async () => true, scheduler = null, ipcIntervalMs = 350,
        persistIntervalMs = 5000, persistEveryItems = 100,
    } = {}) {
        this.store = store;
        this.emit = emit;
        this.now = now;
        this.nowMs = nowMs;
        this.isAccountActive = isAccountActive;
        this.scheduler = scheduler || new EpicEnrichmentScheduler({ globalConcurrency: 2, perAccountConcurrency: 2 });
        this.ipcIntervalMs = Math.max(250, Number(ipcIntervalMs) || 350);
        this.persistIntervalMs = Math.max(1000, Number(persistIntervalMs) || 3000);
        this.persistEveryItems = Math.max(1, Number(persistEveryItems) || 25);
        this.states = new Map();
        this.generations = new Map();
        this.lastPersistedProcessed = new Map();
        this.lastPersistAt = 0;
        this.persistDirty = false;
        this.persisting = null;
        this.persistTimer = null;
        this.pendingEvents = new Map();
        this.emitTimer = null;
        this.lastEmitAt = 0;
    }

    async restore() {
        const saved = await this.store?.read?.() || {};
        for (const [accountId, raw] of Object.entries(saved.accounts || {})) {
            const state = clone(raw);
            for (const phase of PHASES) {
                if (state.phases?.[phase]?.errorCode === 'EPIC_HISTORY_REFRESH_ALREADY_RUNNING') {
                    state.phases[phase] = {
                        ...state.phases[phase], status: 'skipped', errorCode: null,
                        failedStage: null, completedAt: null,
                    };
                    continue;
                }
                if (state.phases?.[phase]?.status === 'running') {
                    state.phases[phase].status = 'failed';
                    state.phases[phase].errorCode = 'EPIC_SYNC_INTERRUPTED';
                }
            }
            if (state.overallStatus === 'library_syncing') state.overallStatus = 'failed';
            else if (state.overallStatus === 'library_ready_enriching') state.overallStatus = 'partial';
            state.updatedAt = this.now();
            this.states.set(String(accountId), state);
            this.generations.set(String(accountId), Number(state.revision || 0));
        }
        await this._persistNow();
        return this.getAllStates();
    }

    getAllStates() {
        return Object.fromEntries([...this.states.entries()].map(([id, state]) => [id, clone(state)]));
    }

    getAccountState(accountId) {
        const state = this.states.get(String(accountId));
        return state ? clone(state) : null;
    }

    getDiagnostics() {
        return {
            ...this.scheduler.getDiagnostics(),
            pendingIpcEvents: this.pendingEvents.size,
            persistencePending: this.persistDirty || Boolean(this.persisting),
        };
    }

    async beginAccount({ accountId, syncRunId, isFirstFullImport, options = {} }) {
        const id = String(accountId);
        this.scheduler.cancelAccount(id, 'A newer Epic library sync started.');
        const revision = (this.generations.get(id) || 0) + 1;
        this.generations.set(id, revision);
        const now = this.now();
        const previous = this.states.get(id);
        const preserve = (phase, fallback) => options.preserveTerminalOptionalState && previous?.phases?.[phase]
            ? clone(previous.phases[phase])
            : fallback;
        this.states.set(id, {
            platform: 'epic', accountId: id, syncRunId: String(syncRunId), revision,
            overallStatus: 'library_syncing', isFirstFullImport: Boolean(isFirstFullImport),
            startedAt: now, updatedAt: now, completedAt: null,
            phases: {
                library: { ...phaseState('running'), gamesFetched: 0, committedAt: null },
                prices: preserve('prices', {
                    ...phaseState(options.currentPrices ? 'pending' : 'skipped'),
                    processed: 0, resolved: 0, priced: 0, free: 0, notForSale: 0,
                    unresolved: 0, apiFailures: 0, timeouts: 0, rateLimits: 0,
                    total: null, completedAt: null,
                }),
                purchaseHistory: preserve('purchaseHistory', {
                    ...phaseState(options.purchaseHistory ? 'pending' : 'skipped'),
                    pagesFetched: 0, ordersFetched: 0, lastSuccessfulPage: -1,
                    completedAt: null, failedStage: null,
                }),
            },
        });
        await this._publish(id, 'library', 'running', true);
        return this.getAccountState(id);
    }

    async markLibraryCommitted({ accountId, syncRunId, revision, gamesFetched = 0, committedRevision = null }) {
        const id = String(accountId);
        await this.assertCurrent(id, syncRunId, revision);
        const state = this.states.get(id);
        state.phases.library = {
            ...state.phases.library, status: 'complete', gamesFetched: Number(gamesFetched || 0),
            committedAt: this.now(), committedRevision, errorCode: null,
        };
        const hasOptional = ['prices', 'purchaseHistory'].some((phase) => state.phases[phase].status !== 'skipped');
        state.overallStatus = hasOptional ? 'library_ready_enriching' : 'complete';
        state.updatedAt = this.now();
        if (!hasOptional) state.completedAt = state.updatedAt;
        await this._publish(id, 'library', 'complete', true);
        return this.getAccountState(id);
    }

    async startRun(args) {
        const id = String(args.accountId);
        const started = await this.beginAccount(args);
        const revision = started.revision;
        try {
            const libraryResult = await args.libraryTask({
                assertCurrent: () => this.assertCurrent(id, args.syncRunId, revision),
            });
            await this.assertCurrent(id, args.syncRunId, revision);
            await args.commitLibrary(libraryResult, {
                assertCurrent: () => this.assertCurrent(id, args.syncRunId, revision),
            });
            await this.markLibraryCommitted({
                accountId: id, syncRunId: args.syncRunId, revision,
                gamesFetched: Number(libraryResult?.gamesFetched ?? libraryResult?.games?.length ?? 0),
            });
            await args.emitLibraryReady?.(libraryResult, this.getAccountState(id));
            const background = this.startOptionalPhases({ ...args, revision });
            return { libraryResult, state: this.getAccountState(id), background };
        } catch (error) {
            if (error?.code !== 'EPIC_SYNC_RUN_STALE' && this._matches(id, args.syncRunId, revision)) {
                await this._failPhase(id, 'library', error, 'EPIC_LIBRARY_SYNC_FAILED');
            }
            throw error;
        }
    }

    startOptionalPhases({ accountId, syncRunId, revision, pricesTask, purchaseHistoryTask }) {
        const tasks = [];
        // Probe auth first. waiting_for_auth returns quickly and releases the heavy slot for prices.
        if (purchaseHistoryTask) tasks.push(this._runPhase(accountId, syncRunId, revision, 'purchaseHistory', purchaseHistoryTask));
        if (pricesTask) tasks.push(this._runPhase(accountId, syncRunId, revision, 'prices', pricesTask));
        return Promise.allSettled(tasks).then(async (results) => {
            await this._finalize(accountId, syncRunId, revision);
            return results;
        });
    }

    async retryPhase({ accountId, syncRunId, phase, task }) {
        if (!['prices', 'purchaseHistory'].includes(phase)) throw new Error('Unsupported Epic retry phase.');
        const id = String(accountId);
        const state = this.states.get(id);
        if (!state) throw new Error('Epic sync state was not found.');
        if (syncRunId && String(syncRunId) !== String(state.syncRunId)) throw new StaleEpicSyncRunError();
        state.overallStatus = 'library_ready_enriching';
        state.completedAt = null;
        state.phases[phase] = { ...state.phases[phase], status: 'pending', errorCode: null, failedStage: null };
        await this._publish(id, phase, 'pending', true);
        const result = await this._runPhase(id, state.syncRunId, state.revision, phase, task);
        await this._finalize(id, state.syncRunId, state.revision);
        return { result, state: this.getAccountState(id) };
    }

    async report(accountId, syncRunId, revision, phase, patch = {}) {
        await this.assertCurrent(accountId, syncRunId, revision);
        const state = this.states.get(String(accountId));
        const currentSequence = Number(state.phases?.[phase]?.operationSequence || 0);
        const incomingSequence = Number(patch.operationSequence || 0);
        if (phase === 'purchaseHistory' && incomingSequence > 0 && currentSequence > incomingSequence) {
            return this.getAccountState(accountId);
        }
        state.phases[phase] = { ...state.phases[phase], ...clone(patch) };
        state.updatedAt = this.now();
        const status = state.phases[phase].status;
        const force = TERMINAL.has(status) || patch.event === 'batch_committed';
        try {
            await this._publish(accountId, phase, patch.event || status, force);
        } catch (cause) {
            if (phase !== 'prices') throw cause;
            const error = new Error('Epic price progress could not be persisted.', { cause });
            error.code = 'EPIC_PRICE_PROGRESS_PERSIST_FAILED';
            error.failedStage = 'progress_persistence';
            error.progress = { ...state.phases[phase] };
            throw error;
        }
    }

    async cancelAccount(accountId) {
        const id = String(accountId);
        const previous = this.states.get(id) || null;
        this.scheduler.cancelAccount(id);
        this.generations.set(id, (this.generations.get(id) || 0) + 1);
        this.states.delete(id);
        for (const key of this.pendingEvents.keys()) {
            if (key.startsWith(id + ':')) this.pendingEvents.delete(key);
        }
        await this._persistNow();
        this.emit({
            platform: 'epic', accountId: id,
            syncRunId: previous?.syncRunId || null,
            libraryRevision: previous?.revision ?? null,
            overallStatus: 'failed', phase: null, phaseStatus: 'cancelled', cancelled: true,
        });
    }

    async shutdown() {
        this.scheduler.shutdown();
        if (this.emitTimer) clearTimeout(this.emitTimer);
        if (this.persistTimer) clearTimeout(this.persistTimer);
        await this._persistNow();
    }

    async assertCurrent(accountId, syncRunId, revision) {
        const id = String(accountId);
        if (!this._matches(id, syncRunId, revision) || !(await this.isAccountActive(id))) {
            throw new StaleEpicSyncRunError();
        }
    }

    _matches(accountId, syncRunId, revision) {
        const state = this.states.get(String(accountId));
        return Boolean(state && String(state.syncRunId) === String(syncRunId)
            && Number(state.revision) === Number(revision));
    }

    _runPhase(accountId, syncRunId, revision, phase, task) {
        const state = this.states.get(String(accountId));
        if (!task || state?.phases?.[phase]?.status === 'skipped') {
            return Promise.resolve({ status: 'skipped' });
        }
        return this.scheduler.schedule({
            accountId, revision, phase,
            task: async ({ signal }) => {
                await this.report(accountId, syncRunId, revision, phase, {
                    status: 'running', errorCode: null, failedStage: null,
                });
                try {
                    const result = await task({
                        signal,
                        assertCurrent: () => this.assertCurrent(accountId, syncRunId, revision),
                        report: (patch) => this.report(accountId, syncRunId, revision, phase, patch),
                    });
                    await this.assertCurrent(accountId, syncRunId, revision);
                    const status = result?.status === 'reauth_required'
                        ? 'waiting_for_auth'
                        : (result?.status || 'complete');
                    await this.report(accountId, syncRunId, revision, phase, {
                        status, completedAt: TERMINAL.has(status) ? this.now() : null,
                        errorCode: result?.code || null,
                        operationId: result?.canonicalOperationId || result?.operationId || null,
                        operationSequence: Number(result?.operationSequence || 0),
                        committedRevision: result?.committedRevision ?? result?.progress?.committedRevision ?? null,
                        ...clone(result?.progress || {}),
                    });
                    return result;
                } catch (error) {
                    if (error?.code === 'EPIC_HISTORY_REFRESH_ALREADY_RUNNING') {
                        await this.report(accountId, syncRunId, revision, phase, {
                            status: 'running', errorCode: null, failedStage: null,
                        });
                        return { status: 'joined', code: null };
                    }
                    if (!['EPIC_SYNC_RUN_STALE', 'EPIC_SYNC_CANCELLED'].includes(error?.code)
                        && this._matches(accountId, syncRunId, revision)) {
                        await this._failPhase(accountId, phase, error, 'EPIC_' + phase.toUpperCase() + '_FAILED');
                    }
                    throw error;
                }
            },
        });
    }

    async _failPhase(accountId, phase, error, fallback) {
        const state = this.states.get(String(accountId));
        const currentSequence = Number(state?.phases?.[phase]?.operationSequence || 0);
        const incomingSequence = Number(error?.operationSequence || 0);
        if (phase === 'purchaseHistory' && (
            error?.code === 'EPIC_HISTORY_REFRESH_ALREADY_RUNNING'
            || (incomingSequence > 0 && currentSequence > incomingSequence)
        )) return this.getAccountState(accountId);
        state.phases[phase] = {
            ...state.phases[phase], status: 'failed',
            errorCode: String(error?.code || fallback),
            failedStage: error?.failedStage ? String(error.failedStage) : null,
            completedAt: this.now(),
            ...(error?.progress && typeof error.progress === 'object' ? clone(error.progress) : {}),
        };
        state.overallStatus = phase === 'library' ? 'failed' : 'partial';
        state.updatedAt = this.now();
        await this._publish(accountId, phase, 'failed', true);
    }

    async reconcilePurchaseHistorySuccess({
        accountId, operationId = null, operationSequence = 0,
        committedRevision = null, purchaseHistoryFetchedAt = null,
    }) {
        const id = String(accountId);
        const state = this.states.get(id);
        if (!state) return null;
        const phase = state.phases?.purchaseHistory || phaseState('skipped');
        const currentSequence = Number(phase.operationSequence || 0);
        const incomingSequence = Number(operationSequence || 0);
        const currentRevision = Number(phase.committedRevision || 0);
        const incomingRevision = Number(committedRevision || 0);
        if ((incomingSequence > 0 && currentSequence > incomingSequence)
            || (incomingRevision > 0 && currentRevision > incomingRevision)) {
            return this.getAccountState(id);
        }
        state.phases.purchaseHistory = {
            ...phase,
            status: 'complete', errorCode: null, failedStage: null,
            completedAt: this.now(), operationId,
            operationSequence: Math.max(currentSequence, incomingSequence),
            committedRevision: committedRevision ?? phase.committedRevision ?? null,
            purchaseHistoryFetchedAt: purchaseHistoryFetchedAt || phase.purchaseHistoryFetchedAt || null,
        };
        const optional = [state.phases.prices, state.phases.purchaseHistory];
        const pending = optional.some((item) => ['pending', 'running'].includes(item.status));
        state.overallStatus = pending
            ? 'library_ready_enriching'
            : (optional.some((item) => ['failed', 'partial', 'waiting_for_auth'].includes(item.status)) ? 'partial' : 'complete');
        state.updatedAt = this.now();
        if (!pending) state.completedAt = state.updatedAt;
        await this._publish(id, 'purchaseHistory', 'complete', true);
        return this.getAccountState(id);
    }

    async _finalize(accountId, syncRunId, revision) {
        if (!this._matches(accountId, syncRunId, revision)) return;
        const state = this.states.get(String(accountId));
        const optional = [state.phases.prices, state.phases.purchaseHistory];
        const pending = optional.some((phase) => ['pending', 'running'].includes(phase.status));
        state.overallStatus = pending
            ? 'library_ready_enriching'
            : (optional.some((phase) => ['failed', 'partial', 'waiting_for_auth'].includes(phase.status))
                ? 'partial' : 'complete');
        state.updatedAt = this.now();
        if (!pending) state.completedAt = state.updatedAt;
        await this._publish(accountId, null, state.overallStatus, true);
    }

    async _publish(accountId, phase, phaseStatus, force = false) {
        const id = String(accountId);
        const state = this.getAccountState(id);
        if (!state) return;
        const phaseKey = phase || '__overall';
        const currentPhase = phase ? state.phases?.[phase] : null;
        this.pendingEvents.set(`${id}:${phaseKey}`, {
            platform: 'epic', accountId: id, syncRunId: state.syncRunId,
            libraryRevision: state.revision,
            committedRevision: currentPhase?.committedRevision ?? null,
            overallStatus: state.overallStatus, phase, phaseStatus, state,
        });
        const processed = Number(state.phases?.[phase]?.processed || 0);
        const key = id + ':' + phase;
        const persisted = Number(this.lastPersistedProcessed.get(key) || 0);
        const byCount = phase && processed - persisted >= this.persistEveryItems;
        if (force || byCount || this.nowMs() - this.lastPersistAt >= this.persistIntervalMs) {
            if (phase) this.lastPersistedProcessed.set(key, processed);
            await this._persistNow();
        } else {
            this._schedulePersist();
        }
        this._scheduleEmit();
    }

    _scheduleEmit() {
        if (this.emitTimer) return;
        const delay = Math.max(0, this.ipcIntervalMs - (this.nowMs() - this.lastEmitAt));
        this.emitTimer = setTimeout(() => {
            this.emitTimer = null;
            this._flushEvents();
        }, delay);
    }

    _flushEvents() {
        if (this.emitTimer) {
            clearTimeout(this.emitTimer);
            this.emitTimer = null;
        }
        const events = [...this.pendingEvents.values()];
        this.pendingEvents.clear();
        this.lastEmitAt = this.nowMs();
        for (const event of events) this.emit(event);
    }

    _schedulePersist() {
        this.persistDirty = true;
        if (this.persistTimer) return;
        this.persistTimer = setTimeout(() => {
            this.persistTimer = null;
            this._persistNow().catch(() => {});
        }, this.persistIntervalMs);
    }

    async _persistNow() {
        this.persistDirty = true;
        if (this.persistTimer) {
            clearTimeout(this.persistTimer);
            this.persistTimer = null;
        }
        if (this.persisting) return this.persisting;
        this.persisting = (async () => {
            while (this.persistDirty) {
                this.persistDirty = false;
                await this.store?.write?.({
                    version: 2, updatedAt: this.now(), accounts: this.getAllStates(),
                });
                this.lastPersistAt = this.nowMs();
            }
        })().finally(() => { this.persisting = null; });
        return this.persisting;
    }
}

module.exports = { EpicProgressiveSyncCoordinator, StaleEpicSyncRunError };
