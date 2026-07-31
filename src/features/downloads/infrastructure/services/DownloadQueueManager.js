'use strict';

const EventEmitter = require('events');
const path = require('path');
const { normalizeTask, DOWNLOAD_STATUSES } = require('../../domain/entities/DownloadTask');
const { applyTransition } = require('../../domain/services/DownloadStateMachine');
const { buildDownloadIdentity, makeDownloadTaskId, slugFolderName } = require('../../domain/services/DownloadIdentity');
const {
    assertCoherentProgress,
    makeProgressPatch,
    reconcileDownloadProgress,
} = require('../../domain/services/DownloadProgressReconciliation');
const {
    makeCompletionPatch,
    validateDownloadCompletion,
} = require('../../domain/services/DownloadCompletionValidator');
const { makeDownloadError } = require('./DownloadPreflightService');
const { DownloadTelemetryAggregator } = require('./DownloadTelemetryAggregator');
const { DownloadCheckpointService } = require('./DownloadCheckpointService');

const PREPARING_PROGRESS_TIMEOUT_MS = 75_000;
const ACTIVE_DOWNLOAD_STATUSES = new Set([
    DOWNLOAD_STATUSES.PREPARING,
    DOWNLOAD_STATUSES.DOWNLOADING,
    DOWNLOAD_STATUSES.PAUSING,
    DOWNLOAD_STATUSES.RESUMING,
    DOWNLOAD_STATUSES.VERIFYING,
    DOWNLOAD_STATUSES.INSTALLING,
]);
const TERMINAL_DOWNLOAD_STATUSES = new Set([
    DOWNLOAD_STATUSES.COMPLETED,
    DOWNLOAD_STATUSES.CANCELLED,
    DOWNLOAD_STATUSES.FAILED,
]);

class DownloadQueueManager extends EventEmitter {
    constructor({
        repository,
        preflight,
        providerExecutor = null,
        clock = Date,
        autoStart = false,
        identityResolvers = {},
        preparingProgressTimeoutMs = PREPARING_PROGRESS_TIMEOUT_MS,
        telemetryAggregator = null,
        checkpointService = null,
    completionRegistrar = null,
    } = {}) {
        super();
        if (!repository) throw new Error('DownloadQueueManager requires repository');
        if (!preflight) throw new Error('DownloadQueueManager requires preflight');
        this.repository = repository;
        this.preflight = preflight;
        this.providerExecutor = providerExecutor;
        this.clock = clock;
        this.state = repository.emptyState ? repository.emptyState() : { version: 1, tasks: [], settings: {} };
        this.loaded = false;
        this.autoStart = autoStart;
        this.stopIntents = new Map();
        this.identityResolvers = identityResolvers || {};
        this.preparingProgressTimeoutMs = preparingProgressTimeoutMs;
        this.persistQueue = Promise.resolve();
        this.queueRevision = 0;
        this.runtimeSessions = new Map();
        this.stallFailures = new Set();
        this.telemetryAggregator = telemetryAggregator || new DownloadTelemetryAggregator({ clock });
        this.checkpointService = checkpointService || new DownloadCheckpointService({
            clock,
            writeState: async (state) => this.writeStateNow(state),
        });
        this.completionRegistrar = completionRegistrar;
    }

    async load() {
        this.state = await this.repository.readState();
        this.loaded = true;
        const reconciled = await this.reconcileCompletedRegistrations();
        if (reconciled) await this.writeStateNow(this.state);
        this.emitSnapshot();
        return this.getSnapshot();
    }

    async reconcileCompletedRegistrations() {
        const resolver = this.completionRegistrar?.recoverCompletedDownload || this.completionRegistrar?.resolveCompletedDownloadRegistration;
        if (!resolver) return false;
        let changed = false;
        for (let index = 0; index < this.state.tasks.length; index += 1) {
            const task = this.state.tasks[index];
            if (!task || task.status !== DOWNLOAD_STATUSES.COMPLETED) continue;
            if (task.installedGameId && task.resolvedExecutablePath) continue;
            try {
                const registration = await resolver.call(this.completionRegistrar, task);
                if (!registration?.installedGameId) continue;
                this.state.tasks[index] = {
                    ...task,
                    installedGameId: registration.installedGameId,
                    resolvedExecutablePath: registration.resolvedExecutablePath || task.resolvedExecutablePath || null,
                    libraryRegisteredAt: task.libraryRegisteredAt || new this.clock().toISOString(),
                    taskRevision: (Number(task.taskRevision) || 0) + 1,
                    updatedAt: new this.clock().toISOString(),
                };
                changed = true;
            } catch (_) {}
        }
        return changed;
    }

    async ensureLoaded() {
        if (!this.loaded) await this.load();
    }

    getSnapshot() {
        const tasks = this.state.tasks.map(t => ({ ...t }));
        const activeStatuses = new Set([
            DOWNLOAD_STATUSES.PREPARING,
            DOWNLOAD_STATUSES.DOWNLOADING,
            DOWNLOAD_STATUSES.PAUSING,
            DOWNLOAD_STATUSES.RESUMING,
            DOWNLOAD_STATUSES.VERIFYING,
            DOWNLOAD_STATUSES.INSTALLING,
        ]);
        const active = tasks.find(t => activeStatuses.has(t.status)) || null;
        const pending = tasks.filter(t => t.status === DOWNLOAD_STATUSES.PENDING);
        return {
            version: this.state.version || 1,
            tasks,
            settings: { ...(this.state.settings || {}) },
            activeTaskId: active?.id || null,
            activeCount: active ? 1 : 0,
            pendingCount: pending.length,
            badgeCount: (active ? 1 : 0) + pending.length,
            aggregateSpeedBps: tasks.reduce((sum, t) => sum + (Number(t.downloadSpeedBps) || 0), 0),
            queueRevision: this.queueRevision,
            updatedAt: this.state.updatedAt || new this.clock().toISOString(),
        };
    }

    cloneState() {
        return {
            ...this.state,
            tasks: this.state.tasks.map(t => ({ ...t })),
            settings: { ...(this.state.settings || {}) },
        };
    }

    async writeStateNow(state = this.state) {
        return this.repository.writeState(state);
    }

    async persistAndEmit({ queueChanged = true } = {}) {
        const write = async () => {
            this.checkpointService.cancelPending();
            this.state.updatedAt = new this.clock().toISOString();
            this.state = await this.writeStateNow(this.state);
            if (queueChanged) this.queueRevision += 1;
            this.emitSnapshot({ queueChanged });
            return this.getSnapshot();
        };
        this.persistQueue = this.persistQueue.then(write, write);
        return this.persistQueue;
    }

    emitSnapshot({ queueChanged = true } = {}) {
        const snapshot = this.getSnapshot();
        this.emit('snapshot', snapshot);
        if (queueChanged) this.emit('queue-changed', snapshot);
    }

    scheduleCheckpoint() {
        this.checkpointService.schedule(() => this.cloneState());
    }

    async flushCheckpoint() {
        this.state = await this.checkpointService.flush(() => this.cloneState());
        return this.getSnapshot();
    }

    nextSessionId(taskId) {
        return `${taskId}:${Date.now().toString(36)}:${Math.random().toString(16).slice(2, 8)}`;
    }

    bumpTask(index, patch = {}) {
        const current = this.state.tasks[index];
        const taskRevision = (Number(current.taskRevision) || 0) + 1;
        const progressRevision = (Number(current.progressRevision) || 0) + 1;
        this.state.tasks[index] = {
            ...current,
            ...patch,
            taskRevision,
            progressRevision,
            updatedAt: new this.clock().toISOString(),
        };
        return this.state.tasks[index];
    }

    emitTaskUpdated(task, patch = {}) {
        this.emit('task-updated', {
            ...task,
            taskId: task.id,
            taskRevision: task.taskRevision || 0,
            queueRevision: this.queueRevision,
            patch,
        });
    }

    async queueInstall(payload = {}) {
        await this.ensureLoaded();
        let valid = this.preflight.validateQueuePayload(payload);
        const resolver = this.identityResolvers?.[valid.platform];
        if (resolver?.resolveForQueue) {
            valid = this.preflight.validateQueuePayload(await resolver.resolveForQueue(valid));
        }
        const installFolder = String(valid.installFolder || slugFolderName(valid.title));
        const installPath = valid.installPath || path.join(valid.installRoot, installFolder);
        const identityKey = buildDownloadIdentity({ ...valid, installPath });
        if (!identityKey) throw makeDownloadError('DOWNLOAD_PROVIDER_ID_MISSING', 'This game is missing a provider install identity.');
        const duplicate = this.state.tasks.find(t =>
            t.identityKey === identityKey &&
            ![DOWNLOAD_STATUSES.COMPLETED, DOWNLOAD_STATUSES.CANCELLED].includes(t.status)
        );
        if (duplicate) throw makeDownloadError('DOWNLOAD_ALREADY_QUEUED', 'This game is already in the download queue.');

        const task = normalizeTask({
            ...valid,
            id: makeDownloadTaskId(identityKey),
            identityKey,
            installFolder,
            installPath,
            status: DOWNLOAD_STATUSES.PENDING,
            stage: 'queued',
            statusMessage: 'Waiting in queue',
        }, { clock: this.clock });
        this.state.tasks.push(task);
        let snapshot = await this.persistAndEmit();
        if (this.autoStart && this.state.settings?.autoStartNext !== false) {
            snapshot = await this.startNext();
        }
        return { status: 'success', task: this.state.tasks.find(t => t.id === task.id) || task, snapshot };
    }

    async startNow(taskId) {
        await this.ensureLoaded();
        const index = this.state.tasks.findIndex(t => t.id === taskId && t.status === DOWNLOAD_STATUSES.PENDING);
        if (index < 0) {
            const exists = this.state.tasks.some(t => t.id === taskId);
            throw makeDownloadError(
                exists ? 'DOWNLOAD_INVALID_STATE_TRANSITION' : 'DOWNLOAD_TASK_NOT_FOUND',
                exists ? 'Only queued downloads can be started now.' : 'Download task not found.'
            );
        }
        if (index > 0) {
            const [task] = this.state.tasks.splice(index, 1);
            this.state.tasks.unshift(task);
        }
        return this.startNext();
    }

    async startNext() {
        await this.ensureLoaded();
        if (this.getSnapshot().activeTaskId) return this.getSnapshot();
        const idx = this.state.tasks.findIndex(t => t.status === DOWNLOAD_STATUSES.PENDING);
        if (idx < 0) return this.getSnapshot();
        const sessionId = this.nextSessionId(this.state.tasks[idx].id);
        this.state.tasks[idx] = applyTransition(this.state.tasks[idx], DOWNLOAD_STATUSES.PREPARING, {
            statusMessage: 'Preparing download...',
            progressSessionId: sessionId,
            processPid: null,
            processStartedAt: null,
            processExitedAt: null,
            telemetryState: 'measuring',
            networkState: 'measuring',
            downloadSpeedBps: 0,
            diskUsageBps: 0,
            rawDownloadSpeedBps: null,
            decompressionSpeedBps: null,
            diskWriteSpeedBps: null,
            diskReadSpeedBps: null,
            etaSeconds: null,
            stallReason: null,
            firstProviderOutputAt: null,
            firstAuthoritativeProgressAt: null,
            lastAuthoritativeProgressAt: null,
            lastTransferCounterAt: null,
            lastProviderActivityAt: null,
        }, this.clock);
        this.telemetryAggregator.reset(this.state.tasks[idx].id, { sessionId });
        const snapshot = await this.persistAndEmit();
        this.executeActiveTask(this.state.tasks[idx]).catch(() => {});
        return snapshot;
    }

    async pause(taskId) {
        await this.ensureLoaded();
        const task = this.findTask(taskId);
        if (task.status === DOWNLOAD_STATUSES.PAUSED || task.status === DOWNLOAD_STATUSES.PAUSING) return this.getSnapshot();
        this.stopIntents.set(taskId, 'pause');
        try {
            await this.transitionTask(taskId, DOWNLOAD_STATUSES.PAUSING, {
                statusMessage: 'Pausing...',
                pauseRequestedAt: new this.clock().toISOString(),
                downloadSpeedBps: 0,
                diskUsageBps: 0,
                telemetryState: 'idle',
                networkState: 'idle',
            });
            const stopResult = await this.providerExecutor?.pause?.(taskId);
            if (stopResult && stopResult.exitConfirmed === false) {
                return this.transitionTask(taskId, DOWNLOAD_STATUSES.FAILED, {
                    statusMessage: 'Baddel could not confirm the downloader stopped. Close the downloader process and retry.',
                    errorCode: 'DOWNLOAD_STOP_NOT_CONFIRMED',
                    errorMessage: 'Downloader process exit was not confirmed.',
                    downloadSpeedBps: 0,
                    diskUsageBps: 0,
                    telemetryState: 'idle',
                    networkState: 'idle',
                });
            }
            await this.transitionTask(taskId, DOWNLOAD_STATUSES.PAUSED, {
                statusMessage: 'Paused. Resume to continue.',
                downloadSpeedBps: 0,
                diskUsageBps: 0,
                telemetryState: 'idle',
                networkState: 'idle',
                processExitedAt: new this.clock().toISOString(),
            });
            await this.flushCheckpoint();
            return this.getSnapshot();
        } finally {
            this.stopIntents.delete(taskId);
        }
    }

    async resume(taskId) {
        await this.ensureLoaded();
        const task = this.findTask(taskId);
        if (task.status !== DOWNLOAD_STATUSES.PAUSED) {
            throw makeDownloadError('DOWNLOAD_INVALID_STATE_TRANSITION', 'Only paused downloads can be resumed.');
        }
        if (this.getSnapshot().activeTaskId) {
            await this.transitionTask(taskId, DOWNLOAD_STATUSES.PENDING, { statusMessage: 'Waiting in queue' });
            return this.getSnapshot();
        }
        const sessionId = this.nextSessionId(taskId);
        await this.transitionTask(taskId, DOWNLOAD_STATUSES.RESUMING, {
            statusMessage: 'Resuming download...',
            progressSessionId: sessionId,
            resumeStartedAt: new this.clock().toISOString(),
            resumeAttempts: (Number(task.resumeAttempts) || 0) + 1,
            resumeBaseDownloadedBytes: Number.isFinite(Number(task.downloadedBytes)) ? Number(task.downloadedBytes) : task.checkpointDownloadedBytes,
            stableTotalBytes: Number.isFinite(Number(task.totalBytes)) ? Number(task.totalBytes) : task.checkpointTotalBytes,
            sessionDownloadedBytes: null,
            sessionTotalBytes: null,
            progressMode: 'resuming',
            errorCode: null,
            errorMessage: null,
            downloadSpeedBps: 0,
            diskUsageBps: 0,
            etaSeconds: null,
            stallReason: null,
            firstProviderOutputAt: null,
            firstAuthoritativeProgressAt: null,
            lastAuthoritativeProgressAt: null,
            lastTransferCounterAt: null,
            lastProviderActivityAt: null,
            telemetryState: 'measuring',
            networkState: 'measuring',
            rawDownloadSpeedBps: null,
            decompressionSpeedBps: null,
            diskWriteSpeedBps: null,
            diskReadSpeedBps: null,
        });
        this.telemetryAggregator.reset(taskId, { sessionId });
        await this.flushCheckpoint();
        this.executeActiveTask(this.findTask(taskId)).catch(() => {});
        return this.getSnapshot();
    }

    async cancel({ taskId, deletePartial = false } = {}) {
        this.stopIntents.set(taskId, 'cancel');
        try {
            const task = this.findTask(taskId);
            if ([DOWNLOAD_STATUSES.PREPARING, DOWNLOAD_STATUSES.DOWNLOADING, DOWNLOAD_STATUSES.RESUMING, DOWNLOAD_STATUSES.VERIFYING, DOWNLOAD_STATUSES.INSTALLING].includes(task.status)) {
                await this.transitionTask(taskId, DOWNLOAD_STATUSES.PAUSING, {
                    statusMessage: 'Cancelling...',
                    downloadSpeedBps: 0,
                    diskUsageBps: 0,
                    telemetryState: 'idle',
                    networkState: 'idle',
                });
            }
            const stopResult = await this.providerExecutor?.cancel?.(taskId);
            if (stopResult && stopResult.exitConfirmed === false) {
                return this.transitionTask(taskId, DOWNLOAD_STATUSES.FAILED, {
                    statusMessage: 'Baddel could not confirm the downloader stopped. Close the downloader process and retry.',
                    errorCode: 'DOWNLOAD_STOP_NOT_CONFIRMED',
                    errorMessage: 'Downloader process exit was not confirmed.',
                    downloadSpeedBps: 0,
                    diskUsageBps: 0,
                    telemetryState: 'idle',
                    networkState: 'idle',
                });
            }
            let deletionPatch = {};
            if (deletePartial) {
                try {
                    const current = this.findTask(taskId);
                    const deletion = this.preflight.fileSafety?.deletePartial?.(current);
                    deletionPatch = {
                        partialDeletedAt: deletion?.partialDeletedAt || new this.clock().toISOString(),
                        partialDeletionEligible: false,
                        statusMessage: 'Cancelled and partial files were removed.',
                    };
                } catch (err) {
                    await this.failTask(taskId, err?.code ? err : makeDownloadError('DOWNLOAD_PARTIAL_DELETE_FAILED', 'Baddel could not safely delete all partial files.'));
                    throw err?.code ? err : makeDownloadError('DOWNLOAD_PARTIAL_DELETE_FAILED', 'Baddel could not safely delete all partial files.');
                }
            }
            await this.transitionTask(taskId, DOWNLOAD_STATUSES.CANCELLED, {
                statusMessage: deletePartial ? 'Cancelled and partial files were removed.' : 'Cancelled. Partial files preserved.',
                downloadSpeedBps: 0,
                diskUsageBps: 0,
                telemetryState: 'idle',
                networkState: 'idle',
                processExitedAt: new this.clock().toISOString(),
                ...deletionPatch,
            });
            const removeIndex = this.findTaskIndex(taskId);
            if (removeIndex >= 0) {
                this.state.tasks.splice(removeIndex, 1);
                return this.persistAndEmit();
            }
            return this.getSnapshot();
        } finally {
            this.stopIntents.delete(taskId);
        }
    }

    async retry(taskId) {
        await this.ensureLoaded();
        const task = this.findTask(taskId);
        if (task.status !== DOWNLOAD_STATUSES.FAILED && task.status !== DOWNLOAD_STATUSES.CANCELLED) {
            throw makeDownloadError('DOWNLOAD_INVALID_STATE_TRANSITION', 'Only failed or cancelled downloads can be retried.');
        }
        return this.transitionTask(taskId, DOWNLOAD_STATUSES.PENDING, {
            statusMessage: 'Waiting in queue',
            retryCount: (Number(task.retryCount) || 0) + 1,
            errorCode: null,
            errorMessage: null,
            progressSessionId: null,
            processPid: null,
            processStartedAt: null,
            processExitedAt: null,
            telemetryState: 'measuring',
            networkState: 'measuring',
            downloadSpeedBps: 0,
            diskUsageBps: 0,
            rawDownloadSpeedBps: null,
            decompressionSpeedBps: null,
            diskWriteSpeedBps: null,
            diskReadSpeedBps: null,
            etaSeconds: null,
            stallReason: null,
            firstProviderOutputAt: null,
            firstAuthoritativeProgressAt: null,
            lastAuthoritativeProgressAt: null,
            lastTransferCounterAt: null,
            lastProviderActivityAt: null,
        });
    }

    async remove(taskId) {
        await this.ensureLoaded();
        const before = this.state.tasks.length;
        this.state.tasks = this.state.tasks.filter(t => t.id !== taskId);
        if (before === this.state.tasks.length) throw makeDownloadError('DOWNLOAD_TASK_NOT_FOUND', 'Download task not found.');
        return this.persistAndEmit();
    }

    async clearCompleted() {
        await this.ensureLoaded();
        this.state.tasks = this.state.tasks.filter(t => t.status !== DOWNLOAD_STATUSES.COMPLETED);
        return this.persistAndEmit();
    }

    async reorder(orderedIds = []) {
        await this.ensureLoaded();
        if (!Array.isArray(orderedIds)) throw makeDownloadError('DOWNLOAD_INVALID_QUEUE_ORDER', 'Invalid queue order.');
        const pendingById = new Map(this.state.tasks.filter(t => t.status === DOWNLOAD_STATUSES.PENDING).map(t => [t.id, t]));
        const orderedPending = orderedIds.map(id => pendingById.get(String(id))).filter(Boolean);
        const missing = [...pendingById.values()].filter(t => !orderedIds.includes(t.id));
        const nonPending = this.state.tasks.filter(t => t.status !== DOWNLOAD_STATUSES.PENDING);
        this.state.tasks = [...nonPending, ...orderedPending, ...missing];
        return this.persistAndEmit();
    }

    async updateSettings(patch = {}) {
        await this.ensureLoaded();
        const settings = this.state.settings || {};
        this.state.settings = {
            ...settings,
            ...patch,
            defaultInstallRoots: {
                ...(settings.defaultInstallRoots || {}),
                ...(patch.defaultInstallRoots || {}),
            },
        };
        return this.persistAndEmit();
    }

    async transitionTask(taskId, status, patch = {}) {
        await this.ensureLoaded();
        const index = this.findTaskIndex(taskId, { sessionId: patch.progressSessionId });
        if (index < 0) throw makeDownloadError('DOWNLOAD_TASK_NOT_FOUND', 'Download task not found.');
        this.state.tasks[index] = applyTransition(this.state.tasks[index], status, patch, this.clock);
        return this.persistAndEmit();
    }

    findTaskIndex(taskId, { sessionId = null } = {}) {
        const wanted = String(taskId || '');
        const matches = [];
        for (let i = 0; i < this.state.tasks.length; i += 1) {
            if (this.state.tasks[i]?.id === wanted) matches.push(i);
        }
        if (!matches.length) return -1;
        if (sessionId) {
            const sessionMatch = matches.find(i => this.state.tasks[i]?.progressSessionId === sessionId);
            if (sessionMatch !== undefined) return sessionMatch;
        }
        const activeMatch = matches.find(i => ACTIVE_DOWNLOAD_STATUSES.has(this.state.tasks[i]?.status));
        if (activeMatch !== undefined) return activeMatch;
        const nonTerminalMatch = matches.find(i => !TERMINAL_DOWNLOAD_STATUSES.has(this.state.tasks[i]?.status));
        if (nonTerminalMatch !== undefined) return nonTerminalMatch;
        return matches[matches.length - 1];
    }

    findTask(taskId, options = {}) {
        const index = this.findTaskIndex(taskId, options);
        if (index < 0) throw makeDownloadError('DOWNLOAD_TASK_NOT_FOUND', 'Download task not found.');
        return this.state.tasks[index];
    }

    async executeActiveTask(initialTask) {
        let task = initialTask;
        if (!task?.id) return;
        const sessionId = task.progressSessionId || this.nextSessionId(task.id);
        this.runtimeSessions.set(task.id, {
            taskId: task.id,
            sessionId,
            startedAt: new this.clock().toISOString(),
            stopIntent: null,
        });
        if (!this.providerExecutor?.start) {
            await this.failTask(task.id, makeDownloadError('DOWNLOAD_PROVIDER_UNAVAILABLE', 'Direct download runtime is not available yet.'));
            return;
        }
        let firstProgressSeen = false;
        let ownershipPrepared = false;
        let progressQueue = Promise.resolve();
        const drainProgressQueue = () => progressQueue.catch(() => {});
        try {
            const ownershipPatch = this.preflight.fileSafety?.prepareTaskOwnership?.(task) || {};
            if (Object.keys(ownershipPatch).length) {
                await this.transitionTask(task.id, task.status, ownershipPatch);
                task = this.findTask(task.id);
                ownershipPrepared = true;
            }
            let preparingTimer = null;
            const preparingTimeout = new Promise((_resolve, reject) => {
                preparingTimer = setTimeout(() => {
                    if (firstProgressSeen) return;
                    reject(makeDownloadError(
                        'DOWNLOAD_PREPARING_TIMEOUT',
                        'The download did not start in time. Retry the download or reconnect the account.'
                    ));
                }, this.preparingProgressTimeoutMs);
            });
            const clearPreparingTimer = () => {
                if (preparingTimer) {
                    clearTimeout(preparingTimer);
                    preparingTimer = null;
                }
            };
            const startPromise = this.providerExecutor.start(task, {
                sessionId,
                onProgress: (patch) => {
                    if (patch && !patch.sessionId) patch.sessionId = sessionId;
                    firstProgressSeen = true;
                    clearPreparingTimer();
                    progressQueue = progressQueue
                        .catch(() => {})
                        .then(() => this.applyProgress(task.id, patch).catch(() => {}));
                    return progressQueue;
                },
            });
            startPromise.catch(() => {});
            const result = await Promise.race([startPromise, preparingTimeout]).finally(() => {
                clearPreparingTimer();
            });
            await drainProgressQueue();
            if (!this.isCurrentSession(task.id, sessionId)) return;
            const completionReceipt = validateDownloadCompletion(this.findTask(task.id), result || {});
            if (!this.isCurrentSession(task.id, sessionId)) return;
            await this.completeTask(task.id, completionReceipt);
            if (this.state.settings?.autoStartNext !== false) await this.startNext();
        } catch (err) {
            if (err?.code === 'DOWNLOAD_PREPARING_TIMEOUT') {
                await this.providerExecutor?.cancel?.(task.id, { reason: 'preparing-timeout' }).catch(() => {});
            }
            await drainProgressQueue();
            if (!this.isCurrentSession(task.id, sessionId)) return;
            if (this.stopIntents.has(task.id)) return;
            let cleanupPatch = {};
            if (ownershipPrepared && !firstProgressSeen) {
                const cleanup = this.preflight.fileSafety?.cleanupFailedStart?.(this.findTask(task.id));
                if (cleanup?.deleted) {
                    cleanupPatch = {
                        partialDeletedAt: cleanup.partialDeletedAt || new this.clock().toISOString(),
                        partialDeletionEligible: false,
                        partialDeletionMarkerPath: null,
                        ownershipNonce: null,
                        installPathOwnershipPreparedAt: null,
                    };
                }
            }
            await this.failTask(task.id, err, cleanupPatch);
            if (this.state.settings?.autoStartNext !== false) await this.startNext();
        } finally {
            const session = this.runtimeSessions.get(task.id);
            if (session?.sessionId === sessionId) this.runtimeSessions.delete(task.id);
        }
    }

    isCurrentSession(taskId, sessionId) {
        const index = this.findTaskIndex(taskId, { sessionId });
        if (index < 0) return false;
        const current = this.state.tasks[index];
        return !sessionId || !current?.progressSessionId || current.progressSessionId === sessionId;
    }

    async applyProgress(taskId, patch = {}) {
        await this.ensureLoaded();
        const index = this.findTaskIndex(taskId, { sessionId: patch.sessionId });
        if (index < 0) return this.getSnapshot();
        const current = this.state.tasks[index];
        if (patch.sessionId && current.progressSessionId && patch.sessionId !== current.progressSessionId) {
            return this.getSnapshot();
        }
        if (![DOWNLOAD_STATUSES.PREPARING, DOWNLOAD_STATUSES.RESUMING, DOWNLOAD_STATUSES.DOWNLOADING, DOWNLOAD_STATUSES.VERIFYING, DOWNLOAD_STATUSES.INSTALLING].includes(current.status)) {
            return this.getSnapshot();
        }
        let nextStatus = patch.status || current.status;
        if (current.status === DOWNLOAD_STATUSES.RESUMING && nextStatus === DOWNLOAD_STATUSES.PREPARING) {
            nextStatus = DOWNLOAD_STATUSES.RESUMING;
        }
        if (current.status === DOWNLOAD_STATUSES.RESUMING && nextStatus === DOWNLOAD_STATUSES.DOWNLOADING) {
            nextStatus = DOWNLOAD_STATUSES.DOWNLOADING;
        }
        if (current.status === DOWNLOAD_STATUSES.PREPARING && [DOWNLOAD_STATUSES.VERIFYING, DOWNLOAD_STATUSES.INSTALLING].includes(nextStatus)) {
            nextStatus = DOWNLOAD_STATUSES.DOWNLOADING;
        }
        if (nextStatus === DOWNLOAD_STATUSES.INSTALLING && current.status === DOWNLOAD_STATUSES.DOWNLOADING) {
            nextStatus = DOWNLOAD_STATUSES.VERIFYING;
        }
        const nonProgressPatch = { ...patch };
        if (nonProgressPatch.errorCode && nonProgressPatch.errorCode !== 'GOG_DOWNLOAD_STALLED') {
            nonProgressPatch.transientProviderWarningCode = nonProgressPatch.errorCode;
            nonProgressPatch.transientProviderWarningMessage = nonProgressPatch.errorMessage || nonProgressPatch.statusMessage || null;
            delete nonProgressPatch.errorCode;
            delete nonProgressPatch.errorMessage;
        }
        for (const key of [
            'sessionId', 'timestamp', 'progressPercent', 'downloadedBytes',
            'totalBytes', 'transferDownloadedBytes', 'transferTotalBytes',
            'providerDownloadedBytes', 'providerTotalBytes',
            'providerReportedPercent', 'progressSource',
            'totalBytesSource', 'downloadedBytesSource',
            'stableTotalBytes', 'resumeBaseDownloadedBytes', 'sessionDownloadedBytes',
            'sessionTotalBytes', 'progressMode',
        ]) {
            delete nonProgressPatch[key];
        }
        const reconciliation = reconcileDownloadProgress(current, patch);
        this.emitProgressDiagnostics(reconciliation.diagnostics);
        const progressPatch = makeProgressPatch(reconciliation.tuple);
        const guardedPatch = assertCoherentProgress({
            ...nonProgressPatch,
            ...progressPatch,
        });
        const telemetryInput = {
            ...guardedPatch,
            sessionId: patch.sessionId || current.progressSessionId || null,
        };
        if (patch.timestamp != null) telemetryInput.timestamp = patch.timestamp;
        const telemetry = this.telemetryAggregator.apply(current, telemetryInput);
        const nextPatch = assertCoherentProgress(telemetry.patch || guardedPatch);
        this.state.tasks[index] = applyTransition(current, nextStatus, {
            ...nextPatch,
            taskRevision: (Number(current.taskRevision) || 0) + 1,
            progressRevision: (Number(current.progressRevision) || 0) + 1,
            checkpointDownloadedBytes: Number.isFinite(Number(nextPatch.downloadedBytes)) ? Number(nextPatch.downloadedBytes) : current.checkpointDownloadedBytes,
            checkpointTotalBytes: Number.isFinite(Number(nextPatch.totalBytes)) ? Number(nextPatch.totalBytes) : current.checkpointTotalBytes,
            checkpointProgressPercent: Number.isFinite(Number(nextPatch.progressPercent)) ? Number(nextPatch.progressPercent) : current.checkpointProgressPercent,
            checkpointProgressSource: nextPatch.progressSource || current.checkpointProgressSource,
            checkpointSessionId: current.progressSessionId || current.checkpointSessionId,
            checkpointAt: telemetry.meaningful ? new this.clock().toISOString() : current.checkpointAt,
            lastProviderSampleAt: new this.clock().toISOString(),
            lastMeaningfulProgressAt: telemetry.meaningful ? new this.clock().toISOString() : current.lastMeaningfulProgressAt,
            errorCode: nextPatch.errorCode || null,
            errorMessage: nextPatch.errorMessage || null,
        }, this.clock);
        if (telemetry.shouldEmit) this.emitTaskUpdated(this.state.tasks[index], nextPatch);
        this.scheduleCheckpoint();
        if (nextPatch.errorCode === 'GOG_DOWNLOAD_STALLED') {
            await this.failStalledDownload(taskId, current.progressSessionId);
        }
        return this.getSnapshot();
    }

    async failStalledDownload(taskId, sessionId) {
        const key = `${taskId}:${sessionId || ''}`;
        if (this.stallFailures.has(key)) return;
        this.stallFailures.add(key);
        const index = this.findTaskIndex(taskId, { sessionId });
        const task = index >= 0 ? this.state.tasks[index] : null;
        if (!task || task.progressSessionId !== sessionId) return;
        if (![DOWNLOAD_STATUSES.DOWNLOADING, DOWNLOAD_STATUSES.PREPARING, DOWNLOAD_STATUSES.RESUMING].includes(task.status)) return;
        const stopResult = await this.providerExecutor?.cancel?.(taskId, { reason: 'stall' });
        if (stopResult && stopResult.exitConfirmed === false) {
            await this.failTask(taskId, makeDownloadError('DOWNLOAD_STOP_NOT_CONFIRMED', 'Baddel could not confirm the downloader stopped after a stall.'), {
                retryable: true,
                autoResumeEligible: true,
            });
            return;
        }
        await this.failTask(taskId, makeDownloadError('GOG_DOWNLOAD_STALLED', 'Provider active, but game data is not advancing.'), {
            statusMessage: 'Provider active, but game data is not advancing. Retry to continue.',
            stallReason: 'no-authoritative-byte-progress',
            retryable: true,
            autoResumeEligible: true,
        });
    }

    emitProgressDiagnostics(diagnostics) {
        if (!diagnostics || process.env.BADDEL_DOWNLOAD_PROGRESS_DIAGNOSTICS !== '1') return;
        console.info('[Downloads][ProgressReconciliation]', JSON.stringify(diagnostics));
    }

    async completeTask(taskId, completionReceipt = {}) {
        await this.ensureLoaded();
        const index = this.findTaskIndex(taskId, { sessionId: completionReceipt.progressSessionId });
        if (index < 0) return this.getSnapshot();
        let task = this.state.tasks[index];
        if (task.status === DOWNLOAD_STATUSES.PREPARING || task.status === DOWNLOAD_STATUSES.RESUMING) {
            task = applyTransition(task, DOWNLOAD_STATUSES.DOWNLOADING, { statusMessage: 'Finalizing download...' }, this.clock);
        }
        if (task.status === DOWNLOAD_STATUSES.DOWNLOADING) {
            task = applyTransition(task, DOWNLOAD_STATUSES.VERIFYING, { statusMessage: 'Verifying downloaded files...' }, this.clock);
        }
        let registrationPatch = {};
        if (this.completionRegistrar?.registerCompletedDownload) {
            const registration = await this.completionRegistrar.registerCompletedDownload(task, completionReceipt);
            registrationPatch = {
                installedGameId: registration?.installedGameId || null,
                resolvedExecutablePath: registration?.resolvedExecutablePath || completionReceipt?.verification?.executablePath || null,
                libraryRegisteredAt: new this.clock().toISOString(),
            };
        }
        const completionPatch = {
            ...makeCompletionPatch(completionReceipt),
            ...registrationPatch,
            statusMessage: 'Download completed.',
            downloadSpeedBps: 0,
            diskUsageBps: 0,
            etaSeconds: null,
            telemetryState: 'idle',
            networkState: 'idle',
            processExitedAt: new this.clock().toISOString(),
            completedAt: completionReceipt.completedAt || new this.clock().toISOString(),
            errorCode: null,
            errorMessage: null,
        };
        this.state.tasks[index] = applyTransition(task, DOWNLOAD_STATUSES.COMPLETED, completionPatch, this.clock);
        this.telemetryAggregator.clear(taskId);
        return this.persistAndEmit();
    }

    async failTask(taskId, err, extraPatch = {}) {
        await this.ensureLoaded();
        const index = this.findTaskIndex(taskId, { sessionId: extraPatch.progressSessionId });
        if (index < 0) return this.getSnapshot();
        const task = this.state.tasks[index];
        if (![DOWNLOAD_STATUSES.PREPARING, DOWNLOAD_STATUSES.RESUMING, DOWNLOAD_STATUSES.DOWNLOADING, DOWNLOAD_STATUSES.PAUSING, DOWNLOAD_STATUSES.VERIFYING, DOWNLOAD_STATUSES.INSTALLING].includes(task.status)) {
            return this.getSnapshot();
        }
        const failure = err?.failure && typeof err.failure === 'object' ? err.failure : null;
        const userMessage = failure?.userMessage || err?.message || 'Download failed.';
        this.state.tasks[index] = applyTransition(task, DOWNLOAD_STATUSES.FAILED, {
            statusMessage: userMessage,
            errorCode: failure?.code || err?.code || 'DOWNLOAD_PROCESS_FAILED',
            errorMessage: userMessage,
            errorTechnicalSummary: failure?.technicalSummary || null,
            failureDetails: failure,
            failureCategory: failure?.category || null,
            failureSuggestedAction: failure?.suggestedAction || null,
            providerDiagnosticPath: err?.providerDiagnosticPath || task.providerDiagnosticPath || null,
            retryable: failure?.retryable ?? err?.retryable ?? task.retryable,
            expectedDownloadBytes: failure?.evidence?.expectedDownloadBytes ?? task.expectedDownloadBytes ?? null,
            expectedInstalledBytes: failure?.evidence?.expectedInstalledBytes ?? task.expectedInstalledBytes ?? null,
            requiredSpaceBytes: failure?.evidence?.requiredSpaceBytes ?? task.requiredSpaceBytes ?? null,
            downloadSpeedBps: 0,
            diskUsageBps: 0,
            etaSeconds: null,
            telemetryState: 'idle',
            networkState: 'idle',
            processExitedAt: new this.clock().toISOString(),
            ...extraPatch,
        }, this.clock);
        this.telemetryAggregator.clear(taskId);
        return this.persistAndEmit();
    }
}

module.exports = {
    DownloadQueueManager,
};




