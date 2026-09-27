'use strict';

const EventEmitter = require('events');
const { epicTrace, taskValues } = require('./EpicDownloadTrace');
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
const { UpdateCheckCoordinator } = require('./UpdateCheckCoordinator');

const PREPARING_PROGRESS_TIMEOUT_MS = 75_000;
const DOWNLOAD_WATCHDOG_INTERVAL_MS = 2_000;
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
        historyRepository = null,
        preflight,
        providerExecutor = null,
        clock = Date,
        autoStart = false,
        identityResolvers = {},
        preparingProgressTimeoutMs = PREPARING_PROGRESS_TIMEOUT_MS,
        telemetryAggregator = null,
        checkpointService = null,
        completionRegistrar = null,
        managedUninstallService = null,
        diagnosticRecorder = null,
        watchdogIntervalMs = DOWNLOAD_WATCHDOG_INTERVAL_MS,
        setIntervalFn = setInterval,
        clearIntervalFn = clearInterval,
        updateCheckCoordinator = null,
    } = {}) {
        super();
        if (!repository) throw new Error('DownloadQueueManager requires repository');
        if (!preflight) throw new Error('DownloadQueueManager requires preflight');
        this.repository = repository;
        this.historyRepository = historyRepository;
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
        this.managedUninstallService = managedUninstallService;
        this.diagnosticRecorder = diagnosticRecorder;
        this.watchdogIntervalMs = Math.max(250, Number(watchdogIntervalMs) || DOWNLOAD_WATCHDOG_INTERVAL_MS);
        this.setIntervalFn = setIntervalFn;
        this.clearIntervalFn = clearIntervalFn;
        this.sessionWatchdogs = new Map();
        this.updateCheckCoordinator = updateCheckCoordinator || new UpdateCheckCoordinator();
        this.updateCheckCoordinator.onStateChange = () => {
            if (this.loaded) this.emitSnapshot({ queueChanged: false });
        };
        this.maintenanceRequests = new Map();
        this.maintenanceEnqueueTail = Promise.resolve();
        this.shutdownPromise = null;
    }

    async load() {
        this.state = await this.repository.readState();
        this.loaded = true;
        const duplicateReconciliation = await this.completionRegistrar?.reconcileManagedDuplicates?.(this.state.tasks);
        const remappedDuplicates = this.remapInstalledGameReferences(duplicateReconciliation?.idRemap);
        const restoredMaintenance = this.reconcileLegacyMaintenanceFailures();
        const reconciled = await this.reconcileCompletedRegistrations();
        await this.historyRepository?.archiveMany?.(this.state.tasks.filter(task => TERMINAL_DOWNLOAD_STATUSES.has(task.status)));
        if (remappedDuplicates || restoredMaintenance || reconciled) await this.writeStateNow(this.state);
        this.emitSnapshot();
        return this.getSnapshot();
    }

    remapInstalledGameReferences(idRemap = {}) {
        if (!idRemap || typeof idRemap !== "object" || !Object.keys(idRemap).length) return false;
        let changed = false;
        this.state.tasks = this.state.tasks.map(task => {
            const current = String(task?.installedGameId || "");
            const replacement = idRemap[current];
            if (!replacement || replacement === current) return task;
            changed = true;
            return {
                ...task,
                installedGameId: replacement,
                taskRevision: (Number(task.taskRevision) || 0) + 1,
                updatedAt: new this.clock().toISOString(),
            };
        });
        return changed;
    }

    reconcileLegacyMaintenanceFailures() {
        let changed = false;
        this.state.tasks = this.state.tasks.map(task => {
            const legacyFailedMaintenance = task?.status === DOWNLOAD_STATUSES.FAILED
                && ['update', 'repair'].includes(task.operationKind)
                && task.uninstallEligible === true
                && Boolean(task.installedGameId && task.installPath)
                && ((task.platform === 'epic' && task.installProvider === 'legendary')
                    || (task.platform === 'gog' && task.installProvider === 'gogdl'));
            if (!legacyFailedMaintenance) return task;
            changed = true;
            return {
                ...task,
                status: DOWNLOAD_STATUSES.COMPLETED,
                stage: 'completed',
                completionConfirmed: true,
                maintenanceErrorCode: task.errorCode || 'DOWNLOAD_MAINTENANCE_FAILED',
                maintenanceErrorMessage: task.errorMessage || task.statusMessage || 'Maintenance failed.',
                maintenanceFailedAt: task.updatedAt || new this.clock().toISOString(),
                errorCode: null,
                errorMessage: null,
                progressSessionId: null,
                taskRevision: (Number(task.taskRevision) || 0) + 1,
                updatedAt: new this.clock().toISOString(),
            };
        });
        return changed;
    }

    async reconcileCompletedRegistrations() {
        const resolver = this.completionRegistrar?.recoverCompletedDownload || this.completionRegistrar?.resolveCompletedDownloadRegistration;
        if (!resolver) return false;
        let changed = false;
        for (let index = 0; index < this.state.tasks.length; index += 1) {
            let task = this.state.tasks[index];
            if (!task || task.status !== DOWNLOAD_STATUSES.COMPLETED) continue;
            const provenancePatch = this.managedUninstallService?.recoverInstallRoot?.(task);
            if (provenancePatch) {
                task = { ...task, ...provenancePatch, taskRevision: (Number(task.taskRevision) || 0) + 1, updatedAt: new this.clock().toISOString() };
                this.state.tasks[index] = task;
                changed = true;
            }
            try {
                const registration = await resolver.call(this.completionRegistrar, task);
                const installedGameId = registration?.installedGameId || task.installedGameId || null;
                const resolvedExecutablePath = registration?.resolvedExecutablePath || task.resolvedExecutablePath || null;
                const managedEpic = task.platform === 'epic' && task.installProvider === 'legendary';
                const readyToPlay = managedEpic ? Boolean(registration?.installedGameId) : Boolean(registration?.installedGameId || task.readyToPlay);
                const uninstallEligible = this.managedUninstallService?.isEligible?.({
                    ...task,
                    ...registration,
                    installedGameId,
                    resolvedExecutablePath,
                    status: 'completed',
                    uninstallEligible: true,
                }) === true;
                if (!registration?.installedGameId && task.uninstallEligible === uninstallEligible && task.readyToPlay === readyToPlay) continue;
                if (installedGameId === task.installedGameId
                    && resolvedExecutablePath === task.resolvedExecutablePath
                    && task.uninstallEligible === uninstallEligible
                    && task.readyToPlay === readyToPlay) continue;
                this.state.tasks[index] = {
                    ...task,
                    installedGameId,
                    resolvedExecutablePath,
                    libraryRegisteredAt: task.libraryRegisteredAt || new this.clock().toISOString(),
                    uninstallEligible,
                    readyToPlay,
                    taskRevision: (Number(task.taskRevision) || 0) + 1,
                    updatedAt: new this.clock().toISOString(),
                };
                changed = true;
            } catch (_) {
                const uninstallEligible = this.managedUninstallService?.isEligible?.(task) === true;
                if (task.uninstallEligible !== uninstallEligible) {
                    this.state.tasks[index] = {
                        ...task,
                        uninstallEligible,
                        taskRevision: (Number(task.taskRevision) || 0) + 1,
                        updatedAt: new this.clock().toISOString(),
                    };
                    changed = true;
                }
            }
        }
        return changed;
    }

    async ensureLoaded() {
        if (!this.loaded) await this.load();
    }

    async shutdown() {
        if (this.shutdownPromise) return this.shutdownPromise;
        this.shutdownPromise = (async () => {
            await this.ensureLoaded();
            const activeTaskId = this.getSnapshot().activeTaskId;
            if (activeTaskId) {
                await this.pause(activeTaskId);
                const index = this.findTaskIndex(activeTaskId);
                if (index >= 0) {
                    this.bumpTask(index, {
                        recoveryReason: 'app-shutdown',
                        statusMessage: 'Paused because Baddel was closed. Resume when ready.',
                    });
                }
            }
            for (const taskId of this.sessionWatchdogs.keys()) this.stopSessionWatchdog(taskId);
            await this.flushCheckpoint();
            await this.persistAndEmit();
            return this.getSnapshot();
        })();
        return this.shutdownPromise;
    }

    getSnapshot() {
        const allTasks = this.state.tasks.map(t => ({ ...t }));
        const tasks = allTasks.filter(task => task.historyHidden !== true);
        const activeStatuses = new Set([
            DOWNLOAD_STATUSES.PREPARING,
            DOWNLOAD_STATUSES.DOWNLOADING,
            DOWNLOAD_STATUSES.PAUSING,
            DOWNLOAD_STATUSES.RESUMING,
            DOWNLOAD_STATUSES.VERIFYING,
            DOWNLOAD_STATUSES.INSTALLING,
        ]);
        const active = allTasks.find(t => activeStatuses.has(t.status)) || null;
        const pending = allTasks.filter(t => t.status === DOWNLOAD_STATUSES.PENDING);
        const managedCandidates = allTasks
            .filter(task => this.isMaintenanceManagedTask(task))
            .map(task => {
                const updateCheck = this.updateCheckCoordinator.get(this.managedIdentity(task));
                return ({
                taskId: task.id,
                title: task.title,
                installedGameId: task.installedGameId,
                identityKey: task.identityKey,
                platform: task.platform,
                installProvider: task.installProvider,
                accountId: task.accountId,
                providerProductId: task.providerProductId,
                providerAppName: task.providerAppName,
                contentSystemProductId: task.contentSystemProductId,
                gogProductId: task.gogProductId,
                gogdlAppName: task.gogdlAppName,
                gameId: task.gameId,
                canonicalGameId: task.canonicalGameId,
                installPath: task.installPath,
                uninstallEligible: task.uninstallEligible,
                maintenanceEligible: true,
                completionConfirmed: task.completionConfirmed,
                historyHidden: task.historyHidden,
                status: task.status,
                operationKind: task.operationKind,
                updateCheckedAt: task.updateCheckedAt,
                updateAvailable: task.updateAvailable,
                installedBuildId: task.installedBuildId || task.buildId || task.buildVersion || null,
                targetBuildId: task.targetBuildId,
                maintenanceRequestedAt: task.maintenanceRequestedAt,
                maintenanceErrorCode: task.maintenanceErrorCode,
                maintenanceErrorMessage: task.maintenanceErrorMessage,
                maintenanceFailedAt: task.maintenanceFailedAt,
                taskRevision: task.taskRevision,
                checkingForUpdate: Boolean(updateCheck),
                updateCheckState: updateCheck?.state || null,
                updateCheckPriority: updateCheck?.priority || null,
            });
            });
        const managedByIdentity = new Map();
        for (const candidate of managedCandidates) {
            const key = `${candidate.platform}:${candidate.installProvider}:${candidate.installedGameId}`;
            const existing = managedByIdentity.get(key);
            const candidateActive = activeStatuses.has(candidate.status) || candidate.status === DOWNLOAD_STATUSES.PENDING;
            const existingActive = existing && (activeStatuses.has(existing.status) || existing.status === DOWNLOAD_STATUSES.PENDING);
            if (!existing || (candidateActive && !existingActive) ||
                (candidateActive === existingActive && Number(candidate.taskRevision || 0) >= Number(existing.taskRevision || 0))) {
                managedByIdentity.set(key, candidate);
            }
        }
        const managedInstallations = [...managedByIdentity.values()];
        return {
            version: this.state.version || 1,
            tasks,
            managedInstallations,
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
        // Publish only committed values, including transitions normalized by the queue.
        const committedPatch = Object.fromEntries(Object.keys(patch)
            .filter(key => Object.prototype.hasOwnProperty.call(task, key))
            .map(key => [key, task[key]]));
        Object.assign(committedPatch, {
            status: task.status, stage: task.stage, statusMessage: task.statusMessage,
            taskRevision: task.taskRevision || 0,
        });
        this.emit('task-updated', {
            ...task,
            taskId: task.id,
            taskRevision: task.taskRevision || 0,
            queueRevision: this.queueRevision,
            patch: committedPatch,
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
        if (valid.installProvider === 'legendary') {
            const providerId = String(valid.providerAppName || valid.appName || '').trim();
            const installed = this.completionRegistrar?.gamesApi?.getAllGames?.().find(game =>
                game?.isInstalled !== false && game?.installProvider === 'legendary' &&
                String(game?.platform || '').toLowerCase() === 'epic' &&
                String(game?.appName || game?.providerAppName || '') === providerId
            );
            if (installed) throw makeDownloadError('EPIC_GAME_ALREADY_INSTALLED', 'This Epic game is already installed through Baddel.');
        }

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

    managedIdentity(task = {}) {
        return `${task.platform || ''}:${task.installProvider || ''}:${task.installedGameId || ''}`;
    }

    isMaintenanceManagedTask(task = {}) {
        const supported = (task.platform === 'gog' && task.installProvider === 'gogdl')
            || (task.platform === 'epic' && task.installProvider === 'legendary');
        const receipt = task.providerCompletionReceipt || task.maintenanceBaseCompletionReceipt;
        const verifiedReceipt = receipt?.completionConfirmed === true
            && receipt?.verification?.status === 'passed'
            && String(receipt?.provider || '') === String(task.platform || '');
        const maintenanceInProgress = ['update', 'repair'].includes(task.operationKind)
            && (task.maintenanceBaseManaged === true || Boolean(task.maintenanceBaseCompletionReceipt));
        return supported && (task.status === DOWNLOAD_STATUSES.COMPLETED || maintenanceInProgress)
            && (task.completionConfirmed === true || maintenanceInProgress)
            && Boolean(task.installedGameId && task.installPath)
            && (task.uninstallEligible === true || task.maintenanceBaseUninstallEligible === true || verifiedReceipt);
    }

    async reconcileMaintenanceProvenance(task) {
        if (task?.platform !== 'epic' || task?.installProvider !== 'legendary') return task;
        const resolver = this.identityResolvers?.epic;
        if (typeof resolver?.reconcileMaintenanceTask !== 'function') return task;
        const games = this.completionRegistrar?.gamesApi?.getAllGames?.() || [];
        const installedGame = games.find(game => String(game?.id || '') === String(task.installedGameId || ''));
        const gamePath = installedGame?.installPath || installedGame?.path;
        const sameInstalledPath = gamePath && task.installPath
            && path.resolve(path.normalize(String(gamePath))).toLowerCase() === path.resolve(path.normalize(String(task.installPath))).toLowerCase();
        if (!installedGame || String(installedGame.platform || installedGame.scannerPlatform || '').toLowerCase() !== 'epic'
            || String(installedGame.installProvider || '').toLowerCase() !== 'legendary' || !sameInstalledPath) {
            throw makeDownloadError('EPIC_INSTALL_PATH_MISMATCH', 'The installed Epic Library record no longer matches this managed installation path.');
        }
        const reconciled = await resolver.reconcileMaintenanceTask(task);
        if (String(reconciled?.task?.accountId || '') !== String(task.accountId || '')) {
            throw makeDownloadError('EPIC_ACCOUNT_PROVENANCE_MISMATCH', 'Baddel refused to move this installation to a different Epic account.');
        }
        const patch = reconciled.task || task;
        const changed = ['providerAppName', 'appName', 'namespace', 'catalogItemId', 'ownedByAccountIds', 'ownershipVerified']
            .some(key => JSON.stringify(task[key] ?? null) !== JSON.stringify(patch[key] ?? null));
        if (!changed) return task;
        const index = this.findTaskIndex(task.id);
        this.state.tasks[index] = {
            ...task,
            ...Object.fromEntries(['providerAppName', 'appName', 'namespace', 'catalogItemId', 'ownedByAccountIds', 'ownershipVerified']
                .map(key => [key, patch[key]])),
            taskRevision: (Number(task.taskRevision) || 0) + 1,
            updatedAt: new this.clock().toISOString(),
        };
        await this.persistAndEmit();
        return this.state.tasks[index];
    }

    async checkForUpdate(taskId, { priority = 'manual' } = {}) {
        await this.ensureLoaded();
        let task = this.findTask(taskId);
        if (task.status !== DOWNLOAD_STATUSES.COMPLETED) {
            throw makeDownloadError('DOWNLOAD_MAINTENANCE_ALREADY_PENDING', 'This game already has a queued or active maintenance task.');
        }
        if (!this.isMaintenanceManagedTask(task)) {
            throw makeDownloadError('DOWNLOAD_MAINTENANCE_NOT_MANAGED', 'Only a completed Baddel-managed installation can be checked for updates.');
        }
        task = await this.reconcileMaintenanceProvenance(task);
        if (this.hasMaintenanceRequestForTask(taskId)) {
            throw makeDownloadError('DOWNLOAD_MAINTENANCE_ALREADY_PENDING', 'This game already has a queued or active maintenance task.');
        }
        return this.scheduleUpdateCheck(task, priority);
    }

    scheduleUpdateCheck(task, priority = 'manual') {
        const identity = this.managedIdentity(task);
        return this.updateCheckCoordinator.request({
            identity,
            priority,
            run: () => this.checkForUpdateOnce(task.id),
        });
    }

    async checkForUpdateOnce(taskId) {
        const task = this.findTask(taskId);
        const result = await this.providerExecutor.checkForUpdate(task);
        const index = this.findTaskIndex(taskId);
        this.state.tasks[index] = {
            ...task,
            updateCheckedAt: result.checkedAt || new this.clock().toISOString(),
            updateAvailable: result.updateAvailable === true,
            installedBuildId: result.installedBuildId || task.installedBuildId || task.buildId || task.buildVersion || task.verifiedBuildId || null,
            targetBuildId: result.targetBuildId || null,
            ...(result.verifiedBuildGeneration ? { verifiedBuildGeneration: result.verifiedBuildGeneration } : {}),
            taskRevision: (Number(task.taskRevision) || 0) + 1,
            updatedAt: new this.clock().toISOString(),
        };
        await this.persistAndEmit();
        return { status: 'success', update: result, task: this.state.tasks[index], snapshot: this.getSnapshot() };
    }

    async queueMaintenance({ taskId, operationKind } = {}) {
        const taskKey = String(taskId || '');
        const operation = String(operationKind || '').trim().toLowerCase();
        const key = `${taskKey}:${operation}`;
        if (this.maintenanceRequests.has(key)) return this.maintenanceRequests.get(key);
        if (this.hasMaintenanceRequestForTask(taskKey)) {
            throw makeDownloadError('DOWNLOAD_MAINTENANCE_ALREADY_PENDING', 'Another maintenance action is already being prepared for this game.');
        }
        const enqueue = () => this.queueMaintenanceOnce({ taskId, operationKind });
        const request = this.maintenanceEnqueueTail.then(enqueue, enqueue);
        this.maintenanceEnqueueTail = request.then(() => undefined, () => undefined);
        this.maintenanceRequests.set(key, request);
        try { return await request; } finally { this.maintenanceRequests.delete(key); }
    }

    hasMaintenanceRequestForTask(taskId) {
        const prefix = `${String(taskId || '')}:`;
        return [...this.maintenanceRequests.keys()].some(key => key.startsWith(prefix));
    }

    async queueMaintenanceOnce({ taskId, operationKind } = {}) {
        await this.ensureLoaded();
        const operation = String(operationKind || '').trim().toLowerCase();
        if (!['update', 'repair'].includes(operation)) {
            throw makeDownloadError('DOWNLOAD_MAINTENANCE_OPERATION_INVALID', 'Choose Update or Verify / Repair.');
        }
        let task = this.findTask(taskId);
        const pendingUpdateCheck = this.updateCheckCoordinator.getPromise(this.managedIdentity(task));
        if (pendingUpdateCheck) {
            try { await pendingUpdateCheck; } catch (_) {}
            task = this.findTask(taskId);
        }
        if (task.status !== DOWNLOAD_STATUSES.COMPLETED) {
            throw makeDownloadError('DOWNLOAD_MAINTENANCE_ALREADY_PENDING', 'This game already has a queued or active maintenance task.');
        }
        if (!this.isMaintenanceManagedTask(task)) {
            throw makeDownloadError('DOWNLOAD_MAINTENANCE_NOT_MANAGED', 'Only a completed Baddel-managed installation can be maintained.');
        }
        task = await this.reconcileMaintenanceProvenance(task);
        await this.providerExecutor.assertMaintenanceSupported(task, operation);
        if (operation === 'update') {
            const checkedResult = await this.scheduleUpdateCheck(task, 'manual');
            const checked = checkedResult.update;
            if (checked.updateAvailable !== true) {
                const err = makeDownloadError('DOWNLOAD_UPDATE_NOT_AVAILABLE', 'This game is already up to date.');
                err.update = checked;
                throw err;
            }
            task = {
                ...task,
                installedBuildId: checked.installedBuildId,
                targetBuildId: checked.targetBuildId,
                updateCheckedAt: checked.checkedAt || new this.clock().toISOString(),
                updateAvailable: true,
                ...(checked.verifiedBuildGeneration ? { verifiedBuildGeneration: checked.verifiedBuildGeneration } : {}),
                ...(checked.targetBuildId ? { verifiedBuildId: checked.targetBuildId } : {}),
            };
        }
        const queued = applyTransition(task, DOWNLOAD_STATUSES.PENDING, {
            operationKind: operation,
            historyHidden: false,
            maintenanceRequestedAt: new this.clock().toISOString(),
            maintenanceBaseCompletionReceipt: task.providerCompletionReceipt,
            maintenanceBaseCompletedAt: task.completedAt,
            maintenanceBaseUninstallEligible: task.uninstallEligible === true,
            maintenanceBaseManaged: true,
            maintenanceErrorCode: null,
            maintenanceErrorMessage: null,
            maintenanceFailedAt: null,
            statusMessage: operation === 'repair' ? 'Verify / Repair waiting in queue' : 'Update waiting in queue',
            stage: 'queued',
            progressPercent: null,
            downloadedBytes: 0,
            totalBytes: null,
            transferDownloadedBytes: null,
            transferTotalBytes: null,
            downloadSpeedBps: 0,
            diskUsageBps: 0,
            etaSeconds: null,
            completionConfirmed: false,
            providerCompletionReceipt: null,
            completedAt: null,
            errorCode: null,
            errorMessage: null,
            recoveryReason: null,
            progressSessionId: null,
            taskRevision: (Number(task.taskRevision) || 0) + 1,
        }, this.clock);
        const index = this.findTaskIndex(taskId);
        this.state.tasks.splice(index, 1);
        this.state.tasks.push(queued);
        let snapshot = await this.persistAndEmit();
        if (this.autoStart && this.state.settings?.autoStartNext !== false) snapshot = await this.startNext();
        return { status: 'success', task: this.findTask(taskId), snapshot };
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
            statusMessage: this.state.tasks[idx].operationKind === 'repair' ? 'Preparing Verify / Repair...'
                : this.state.tasks[idx].operationKind === 'update' ? 'Preparing update...'
                    : 'Preparing download...',
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
        this.telemetryAggregator.reset(this.state.tasks[idx].id, {
            sessionId,
            startedAt: new this.clock().getTime(),
        });
        const snapshot = await this.persistAndEmit();
        this.executeActiveTask(this.state.tasks[idx]).catch(() => {});
        return snapshot;
    }

    async pause(taskId) {
        await this.ensureLoaded();
        const task = this.findTask(taskId);
        if (task.status === DOWNLOAD_STATUSES.PAUSED) return this.getSnapshot();
        this.stopIntents.set(taskId, 'pause');
        this.stopSessionWatchdog(taskId);
        if (task.status === DOWNLOAD_STATUSES.PAUSING) return this.getSnapshot();
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

    async resume(taskId, options = {}) {
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
            autoResumeFromSessionId: options.previousSessionId || null,
            autoResumeAttempt: options.autoResume === true
                ? Number(task.stallAutoResumeAttempts) || 1
                : Number(task.autoResumeAttempt) || 0,
            telemetryState: 'measuring',
            networkState: 'measuring',
            rawDownloadSpeedBps: null,
            decompressionSpeedBps: null,
            diskWriteSpeedBps: null,
            diskReadSpeedBps: null,
        });
        this.telemetryAggregator.reset(taskId, {
            sessionId,
            startedAt: new this.clock().getTime(),
        });
        await this.flushCheckpoint();
        this.diagnosticRecorder?.mark?.(taskId, options.autoResume === true ? 'STALL_AUTO_RESUME_STARTED' : 'DOWNLOAD_RESUME_STARTED', {
            previousSessionId: options.previousSessionId || null,
            sessionId,
            autoResumeAttempt: options.autoResume === true ? Number(task.stallAutoResumeAttempts) || 1 : 0,
        });
        this.executeActiveTask(this.findTask(taskId)).catch(() => {});
        return this.getSnapshot();
    }

    async cancel({ taskId, deletePartial = false } = {}) {
        this.stopIntents.set(taskId, 'cancel');
        this.stopSessionWatchdog(taskId);
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
        await this.transitionTask(taskId, DOWNLOAD_STATUSES.PENDING, {
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
        if (this.autoStart && this.state.settings?.autoStartNext !== false) {
            return this.startNext();
        }
        return this.getSnapshot();
    }

    async uninstall(taskId) {
        await this.ensureLoaded();
        if (!this.managedUninstallService) throw makeDownloadError('DOWNLOAD_UNINSTALL_UNAVAILABLE', 'Managed uninstall is not available.');
        const index = this.findTaskIndex(taskId);
        if (index < 0) throw makeDownloadError('DOWNLOAD_TASK_NOT_FOUND', 'Download task not found.');
        const task = this.state.tasks[index];
        const result = await this.managedUninstallService.uninstall(task);
        const removalIndex = this.findTaskIndex(taskId);
        const removed = removalIndex >= 0 ? this.state.tasks.splice(removalIndex, 1)[0] : null;
        try {
            const snapshot = await this.persistAndEmit();
            this.diagnosticRecorder?.mark?.(taskId, 'MANAGED_UNINSTALL_COMPLETED', result, { flush: true });
            return snapshot;
        } catch (err) {
            if (removed) this.state.tasks.splice(removalIndex, 0, removed);
            throw err;
        }
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
        await this.historyRepository?.archiveMany?.(this.state.tasks.filter(task => task.status === DOWNLOAD_STATUSES.COMPLETED));
        this.state.tasks = this.state.tasks.map(task => task.status === DOWNLOAD_STATUSES.COMPLETED && task.historyHidden !== true &&
            this.isMaintenanceManagedTask(task)
            ? { ...task, historyHidden: true, taskRevision: (Number(task.taskRevision) || 0) + 1, updatedAt: new this.clock().toISOString() }
            : task).filter(task => task.status !== DOWNLOAD_STATUSES.COMPLETED || task.historyHidden === true);
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
        if (TERMINAL_DOWNLOAD_STATUSES.has(status)) await this.historyRepository?.archive?.(this.state.tasks[index]);
        return this.persistAndEmit();
    }

    async getHistory() {
        await this.ensureLoaded();
        return this.historyRepository?.list?.() || [];
    }

    async clearHistory() {
        await this.ensureLoaded();
        await this.historyRepository?.clear?.();
        return [];
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

    startSessionWatchdog(taskId, sessionId) {
        this.stopSessionWatchdog(taskId);
        const entry = {
            taskId: String(taskId),
            sessionId,
            running: false,
            timer: null,
        };
        const tick = () => {
            if (entry.running) return;
            entry.running = true;
            Promise.resolve(this.applyWatchdogTick(entry.taskId, entry.sessionId))
                .catch(() => {})
                .finally(() => { entry.running = false; });
        };
        entry.tick = tick;
        entry.timer = this.setIntervalFn(tick, this.watchdogIntervalMs);
        entry.timer?.unref?.();
        this.sessionWatchdogs.set(entry.taskId, entry);
        return entry;
    }

    stopSessionWatchdog(taskId, sessionId = null) {
        const key = String(taskId);
        const entry = this.sessionWatchdogs.get(key);
        if (!entry || (sessionId && entry.sessionId !== sessionId)) return false;
        if (entry.timer != null) this.clearIntervalFn(entry.timer);
        this.sessionWatchdogs.delete(key);
        return true;
    }

    async applyWatchdogTick(taskId, sessionId) {
        if (this.stopIntents.has(taskId) || !this.isCurrentSession(taskId, sessionId)) return;
        const task = this.findTask(taskId, { sessionId });
        if (![DOWNLOAD_STATUSES.DOWNLOADING, DOWNLOAD_STATUSES.RESUMING].includes(task.status)) return;
        await this.applyProgress(taskId, {
            sessionId,
            timestamp: new this.clock().getTime(),
            syntheticWatchdogTick: true,
        });
    }

    evaluateRuntimeSize(task, patch = {}) {
        if (task?.sizeStatus !== 'unknown' || patch.authoritativeTransfer !== true) return { patch };
        const totalBytes = Number(patch.totalBytes ?? patch.providerTotalBytes);
        if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0) return { patch };
        const installedDiskSizeBytes = Number.isSafeInteger(Number(patch.installedDiskSizeBytes))
            && Number(patch.installedDiskSizeBytes) > 0 ? Number(patch.installedDiskSizeBytes) : null;
        const fileSafety = this.preflight?.fileSafety;
        const canRecheckDisk = typeof fileSafety?.calculateRequiredBytes === 'function'
            && typeof fileSafety?.calculateSafetyMargin === 'function'
            && typeof fileSafety?.getFreeSpaceBytes === 'function';
        const checkedAt = new this.clock().toISOString();
        const basePatch = {
            ...patch,
            downloadSizeBytes: totalBytes,
            downloadSizeSource: patch.totalBytesSource || patch.progressSource || 'provider-runtime',
            ...(installedDiskSizeBytes ? { installedDiskSizeBytes, installedSizeSource: 'provider-runtime' } : {}),
            sizeStatus: 'runtime_resolved',
            sizeReason: null,
            sizeCheckedAt: checkedAt,
        };
        if (!canRecheckDisk) return { patch: basePatch };
        const requiredSpaceBytes = fileSafety.calculateRequiredBytes({
            totalBytes,
            downloadSizeBytes: totalBytes,
            installedDiskSizeBytes,
        });
        const diskSafetyMarginBytes = fileSafety.calculateSafetyMargin(requiredSpaceBytes);
        const freeSpaceBytes = fileSafety.getFreeSpaceBytes(task.installPath);
        const enriched = {
            ...basePatch,
            requiredSpaceBytes,
            diskSafetyMarginBytes,
            freeSpaceBytesAtQueue: freeSpaceBytes,
        };
        if (Number.isFinite(freeSpaceBytes) && freeSpaceBytes < requiredSpaceBytes + diskSafetyMarginBytes) {
            const error = makeDownloadError(
                'DOWNLOAD_INSUFFICIENT_DISK_SPACE',
                'The provider reported the game size and this drive no longer has enough free space.'
            );
            error.details = {
                requiredSpaceBytes,
                diskSafetyMarginBytes,
                freeSpaceBytes,
                missingSpaceBytes: requiredSpaceBytes + diskSafetyMarginBytes - freeSpaceBytes,
            };
            return { patch: enriched, error };
        }
        return { patch: enriched };
    }

    async executeActiveTask(initialTask) {
        let task = initialTask;
        if (!task?.id) return;
        const sessionId = task.progressSessionId || this.nextSessionId(task.id);
        this.diagnosticRecorder?.captureIdentity?.({ ...task, progressSessionId: sessionId });
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
        let progressRejections = 0;
        let runtimeSizeFailure = null;
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
                    const runtimeSize = this.evaluateRuntimeSize(this.findTask(task.id), patch || {});
                    patch = runtimeSize.patch;
                    if (runtimeSize.error && !runtimeSizeFailure) {
                        runtimeSizeFailure = runtimeSize.error;
                        this.diagnosticRecorder?.record?.(task.id, 'progressPipeline', 'RUNTIME_SIZE_DISK_CHECK_FAILED', runtimeSize.error.details || {});
                        this.providerExecutor?.cancel?.(task.id, { reason: 'runtime-insufficient-space' }).catch(() => {});
                    }
                    firstProgressSeen = true;
                    clearPreparingTimer();
                    progressQueue = progressQueue
                        .catch(() => {})
                        .then(() => this.applyProgress(task.id, patch).catch(error => {
                            progressRejections += 1;
                            const rejection = {
                                taskId: task.id, sessionId, count: progressRejections,
                                code: error?.code || 'DOWNLOAD_PROGRESS_COMMIT_FAILED',
                                category: error?.code === 'DOWNLOAD_INVALID_STATE_TRANSITION' ? 'lifecycle-transition' : 'progress-commit',
                                currentStatus: this.findTask(task.id)?.status || null,
                                requestedStatus: patch?.status || null,
                                requestedStage: patch?.stage || null,
                                providerProcessFailed: false,
                            };
                            epicTrace.pipeline(task.id, patch, 'QUEUE_APPLY_ERROR', { ...rejection, message: error?.message });
                            if (task.platform === 'epic' && task.installProvider === 'legendary') {
                                this.diagnosticRecorder?.record?.(task.id, 'progressPipeline', 'QUEUE_APPLY_ERROR', rejection);
                                // Keep systemic failures visible without flooding the log.
                                if (progressRejections === 1 || progressRejections % 25 === 0) {
                                    console.warn('[EpicDownload] Progress commit rejected', rejection);
                                }
                            }
                        }));
                    return progressQueue;
                },
            });
            startPromise.catch(() => {});
            this.startSessionWatchdog(task.id, sessionId);
            const result = await Promise.race([startPromise, preparingTimeout]).finally(() => {
                clearPreparingTimer();
            });
            await drainProgressQueue();
            if (runtimeSizeFailure) throw runtimeSizeFailure;
            if (!this.isCurrentSession(task.id, sessionId)) return;
            const completionReceipt = validateDownloadCompletion(this.findTask(task.id), result || {});
            if (!this.isCurrentSession(task.id, sessionId)) return;
            await this.completeTask(task.id, completionReceipt);
            if (this.state.settings?.autoStartNext !== false) await this.startNext();
        } catch (err) {
            if (runtimeSizeFailure) err = runtimeSizeFailure;
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
            this.stopSessionWatchdog(task.id, sessionId);
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
        if (epicTrace.has(taskId)) epicTrace.pipeline(taskId, patch, 'QUEUE_INPUT', { patch, current: taskValues(this.state.tasks.find(task => task.id === taskId)) });
        const index = this.findTaskIndex(taskId, { sessionId: patch.sessionId });
        if (index < 0) {
            epicTrace.pipeline(taskId, patch, 'QUEUE_REJECT', { reason: 'task-or-session-not-found' });
            return this.getSnapshot();
        }
        const current = this.state.tasks[index];
        const syntheticWatchdogTick = patch.syntheticWatchdogTick === true;
        if (patch.sessionId && current.progressSessionId && patch.sessionId !== current.progressSessionId) {
            epicTrace.pipeline(taskId, patch, 'QUEUE_REJECT', { reason: 'stale-session', currentSessionId: current.progressSessionId });
            return this.getSnapshot();
        }
        if (![DOWNLOAD_STATUSES.PREPARING, DOWNLOAD_STATUSES.RESUMING, DOWNLOAD_STATUSES.DOWNLOADING, DOWNLOAD_STATUSES.VERIFYING, DOWNLOAD_STATUSES.INSTALLING].includes(current.status)) {
            epicTrace.pipeline(taskId, patch, 'QUEUE_REJECT', { reason: 'inactive-status', status: current.status });
            return this.getSnapshot();
        }
        let nextStatus = patch.status || current.status;
        if (current.status === DOWNLOAD_STATUSES.RESUMING && nextStatus === DOWNLOAD_STATUSES.PREPARING) {
            nextStatus = DOWNLOAD_STATUSES.RESUMING;
        }
        if (current.status === DOWNLOAD_STATUSES.RESUMING && nextStatus === DOWNLOAD_STATUSES.DOWNLOADING) {
            nextStatus = DOWNLOAD_STATUSES.DOWNLOADING;
        }
        const epicResumeVerification = current.platform === 'epic' && current.installProvider === 'legendary'
            && current.status === DOWNLOAD_STATUSES.RESUMING && nextStatus === DOWNLOAD_STATUSES.VERIFYING;
        // An up-to-date Epic resume can exit directly into verification without transfer samples.
        if ((current.status === DOWNLOAD_STATUSES.PREPARING || epicResumeVerification) && [DOWNLOAD_STATUSES.VERIFYING, DOWNLOAD_STATUSES.INSTALLING].includes(nextStatus)) {
            nextStatus = DOWNLOAD_STATUSES.DOWNLOADING;
        }
        if (nextStatus === DOWNLOAD_STATUSES.INSTALLING && current.status === DOWNLOAD_STATUSES.DOWNLOADING) {
            nextStatus = DOWNLOAD_STATUSES.VERIFYING;
        }
        const nonProgressPatch = { ...patch };
        delete nonProgressPatch.syntheticWatchdogTick;
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
        if (String(current.platform || '').toLowerCase() === 'gog') {
            this.diagnosticRecorder?.record?.(taskId, 'progressPipeline', 'DOWNLOAD_QUEUE_APPLY_PROGRESS', {
                sessionId: patch.sessionId || current.progressSessionId || null,
                authoritativeTransfer: patch.authoritativeTransfer === true,
                providerDownloadedBytes: patch.providerDownloadedBytes ?? patch.downloadedBytes ?? null,
                providerTotalBytes: patch.providerTotalBytes ?? patch.totalBytes ?? null,
                taskDownloadedBytesBefore: current.downloadedBytes ?? null,
                taskProgressPercentBefore: current.progressPercent ?? null,
                writtenBytes: patch.writtenBytes ?? null,
                rawDownloadedBytes: patch.rawDownloadedBytes ?? null,
                rawDownloadSpeedBps: patch.rawDownloadSpeedBps ?? null,
                decompressionSpeedBps: patch.decompressionSpeedBps ?? null,
                diskWriteSpeedBps: patch.diskWriteSpeedBps ?? null,
                diskUsageBps: patch.diskUsageBps ?? null,
                telemetryState: patch.telemetryState || null,
                networkState: patch.networkState || null,
            });
        }
        const reconciliation = reconcileDownloadProgress(current, patch);
        if (epicTrace.has(taskId)) epicTrace.pipeline(taskId, patch, 'RECONCILIATION', { reconciliationInput: { current: taskValues(current), patch }, reconciliationOutput: reconciliation });
        this.emitProgressDiagnostics(reconciliation.diagnostics);
        if (String(current.platform || '').toLowerCase() === 'gog') {
            this.diagnosticRecorder?.record?.(taskId, 'progressPipeline', 'RECONCILE_DOWNLOAD_PROGRESS', {
                sessionId: patch.sessionId || current.progressSessionId || null,
                providerDownloadedBytes: patch.providerDownloadedBytes ?? patch.downloadedBytes ?? null,
                providerTotalBytes: patch.providerTotalBytes ?? patch.totalBytes ?? null,
                reconciledDownloadedBytes: reconciliation.tuple?.downloadedBytes ?? null,
                reconciledTotalBytes: reconciliation.tuple?.totalBytes ?? null,
                diagnostics: reconciliation.diagnostics || null,
            });
        }
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
        if (epicTrace.has(taskId)) epicTrace.pipeline(taskId, patch, 'TELEMETRY', { telemetryInput: { current: taskValues(current), patch: telemetryInput }, telemetryOutput: telemetry, nextStatus });
        this.diagnosticRecorder?.updateLivenessSummary?.(taskId, {
            ...(telemetry.liveness || {}),
            processPid: telemetry.patch?.processPid || current.processPid || null,
            processStatus: current.status,
            sessionId: current.progressSessionId || null,
        });
        if (syntheticWatchdogTick && telemetry.liveness?.watchdogWarning) {
            this.diagnosticRecorder?.mark?.(taskId, telemetry.liveness.hardStallDecision
                ? 'DOWNLOAD_WATCHDOG_HARD_STALL'
                : 'DOWNLOAD_WATCHDOG_WARNING', {
                ...telemetry.liveness,
                processPid: current.processPid || null,
            });
        }
        if (String(current.platform || '').toLowerCase() === 'gog') {
            this.diagnosticRecorder?.record?.(taskId, 'progressPipeline', 'DOWNLOAD_TELEMETRY_AGGREGATOR', {
                sessionId: patch.sessionId || current.progressSessionId || null,
                shouldEmit: telemetry.shouldEmit === true,
                meaningful: telemetry.meaningful === true,
                downloadedBytes: telemetry.patch?.downloadedBytes ?? null,
                totalBytes: telemetry.patch?.totalBytes ?? null,
                downloadSpeedBps: telemetry.patch?.downloadSpeedBps ?? null,
                rawDownloadSpeedBps: telemetry.patch?.rawDownloadSpeedBps ?? null,
                decompressionSpeedBps: telemetry.patch?.decompressionSpeedBps ?? null,
                diskWriteSpeedBps: telemetry.patch?.diskWriteSpeedBps ?? null,
                diskUsageBps: telemetry.patch?.diskUsageBps ?? null,
                telemetryState: telemetry.patch?.telemetryState || null,
                networkState: telemetry.patch?.networkState || null,
                lastSpeedHistorySample: Array.isArray(telemetry.patch?.speedHistory) ? telemetry.patch.speedHistory.at(-1) || null : null,
            });
        }
        const nextPatch = assertCoherentProgress(telemetry.patch || guardedPatch);
        if (syntheticWatchdogTick && telemetry.shouldEmit !== true && nextPatch.errorCode !== 'GOG_DOWNLOAD_STALLED') {
            return this.getSnapshot();
        }
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
            lastProviderSampleAt: syntheticWatchdogTick
                ? current.lastProviderSampleAt
                : new this.clock().toISOString(),
            lastMeaningfulProgressAt: telemetry.meaningful ? new this.clock().toISOString() : current.lastMeaningfulProgressAt,
            errorCode: nextPatch.errorCode || null,
            errorMessage: nextPatch.errorMessage || null,
        }, this.clock);
        if (String(current.platform || '').toLowerCase() === 'gog') {
            this.diagnosticRecorder?.record?.(taskId, 'progressPipeline', 'DOWNLOAD_TASK_STATE_APPLIED', {
                sessionId: patch.sessionId || current.progressSessionId || null,
                taskDownloadedBytesBefore: current.downloadedBytes ?? null,
                taskDownloadedBytesAfter: this.state.tasks[index].downloadedBytes ?? null,
                taskProgressPercentBefore: current.progressPercent ?? null,
                taskProgressPercentAfter: this.state.tasks[index].progressPercent ?? null,
                reconciledDownloadedBytes: nextPatch.downloadedBytes ?? null,
                reconciledTotalBytes: nextPatch.totalBytes ?? null,
                ipcTaskUpdateEmitted: telemetry.shouldEmit === true,
                rawDownloadSpeedBps: this.state.tasks[index].rawDownloadSpeedBps ?? null,
                decompressionSpeedBps: this.state.tasks[index].decompressionSpeedBps ?? null,
                diskWriteSpeedBps: this.state.tasks[index].diskWriteSpeedBps ?? null,
                diskUsageBps: this.state.tasks[index].diskUsageBps ?? null,
                telemetryState: this.state.tasks[index].telemetryState || null,
                networkState: this.state.tasks[index].networkState || null,
                lastSpeedHistorySample: Array.isArray(this.state.tasks[index].speedHistory) ? this.state.tasks[index].speedHistory.at(-1) || null : null,
            });
        }
        if (epicTrace.has(taskId)) epicTrace.pipeline(taskId, patch, 'QUEUE_AFTER', { queueTaskAfter: taskValues(this.state.tasks[index]), shouldEmit: telemetry.shouldEmit });
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
        if (this.stopIntents.has(taskId)) return;

        const previousAutoResumeAttempts = Number(task.stallAutoResumeAttempts) || 0;
        this.stopIntents.set(taskId, 'auto-resume');
        this.stopSessionWatchdog(taskId, sessionId);
        await this.transitionTask(taskId, DOWNLOAD_STATUSES.PAUSING, {
            statusMessage: 'Restarting stalled download...',
            stallReason: 'no-transfer-activity',
            downloadSpeedBps: 0,
            diskUsageBps: 0,
            etaSeconds: null,
        });
        this.diagnosticRecorder?.mark?.(taskId, 'DOWNLOAD_PROCESS_TERMINATION_REQUESTED', {
            reason: 'hard-stall',
            sessionId,
            processPid: task.processPid || null,
            autoResumeAttempt: previousAutoResumeAttempts + 1,
        }, { flush: true });

        const stopResult = await this.providerExecutor?.cancel?.(taskId, { reason: 'stall' });
        const exitConfirmed = stopResult?.exitConfirmed === true;
        this.diagnosticRecorder?.mark?.(taskId, exitConfirmed
            ? 'DOWNLOAD_PROCESS_TERMINATION_CONFIRMED'
            : 'DOWNLOAD_PROCESS_TERMINATION_UNCONFIRMED', {
            reason: 'hard-stall',
            sessionId,
            processPid: task.processPid || null,
            stopResult: stopResult || null,
        }, { flush: true });

        if (!exitConfirmed) {
            this.stopIntents.delete(taskId);
            await this.failTask(taskId, makeDownloadError(
                'DOWNLOAD_STOP_NOT_CONFIRMED',
                'Baddel could not confirm the downloader stopped after a stall.'
            ), {
                retryable: true,
                autoResumeEligible: true,
                progressSessionId: sessionId,
                finalTerminalState: 'failed',
            });
            return;
        }

        const finalStopIntent = this.stopIntents.get(taskId);
        if (finalStopIntent === 'pause') {
            this.stopIntents.delete(taskId);
            await this.transitionTask(taskId, DOWNLOAD_STATUSES.PAUSED, {
                statusMessage: 'Paused. Resume to continue.',
                processExitedAt: new this.clock().toISOString(),
                downloadSpeedBps: 0,
                diskUsageBps: 0,
                etaSeconds: null,
            });
            await this.flushCheckpoint();
            return;
        }
        if (finalStopIntent !== 'auto-resume') return;

        if (previousAutoResumeAttempts < 1) {
            await this.transitionTask(taskId, DOWNLOAD_STATUSES.PAUSED, {
                statusMessage: 'Resuming stalled download...',
                stallAutoResumeAttempts: previousAutoResumeAttempts + 1,
                lastStalledSessionId: sessionId,
                processExitedAt: new this.clock().toISOString(),
                downloadSpeedBps: 0,
                diskUsageBps: 0,
                etaSeconds: null,
            });
            this.stopIntents.delete(taskId);
            await this.flushCheckpoint();
            await this.resume(taskId, {
                autoResume: true,
                previousSessionId: sessionId,
            });
            return;
        }

        this.stopIntents.delete(taskId);
        const stalledError = makeDownloadError(
            'GOG_DOWNLOAD_STALLED',
            'The GOG download stopped transferring data again. Retry to continue.'
        );
        stalledError.retryable = true;
        await this.failTask(taskId, stalledError, {
            statusMessage: 'The download stopped transferring data. Retry to continue.',
            stallReason: 'no-transfer-activity',
            retryable: true,
            autoResumeEligible: true,
            progressSessionId: sessionId,
            finalTerminalState: 'failed',
        });
        this.diagnosticRecorder?.mark?.(taskId, 'DOWNLOAD_FINAL_TERMINAL_STATE', {
            sessionId,
            status: 'failed',
            errorCode: 'GOG_DOWNLOAD_STALLED',
            autoResumeAttempts: previousAutoResumeAttempts,
        }, { flush: true });
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
            task = applyTransition(task, DOWNLOAD_STATUSES.VERIFYING, {
                statusMessage: 'Verifying files',
                etaSeconds: null,
                etaSource: null,
                etaUpdatedAt: null,
            }, this.clock);
        }
        if (task.status === DOWNLOAD_STATUSES.VERIFYING && this.completionRegistrar?.registerCompletedDownload) {
            task = applyTransition(task, DOWNLOAD_STATUSES.INSTALLING, {
                statusMessage: 'Finalizing installation',
                ...(task.platform === 'epic' && task.installProvider === 'legendary' ? { stage: 'finalizing' } : {}),
                etaSeconds: null,
                etaSource: null,
                etaUpdatedAt: null,
            }, this.clock);
            this.state.tasks[index] = task;
            await this.persistAndEmit({ queueChanged: false });
        }
        let registrationPatch = {};
        if (this.completionRegistrar?.registerCompletedDownload) {
            this.diagnosticRecorder?.mark?.(taskId, 'LIBRARY_REGISTRATION_STARTED', { installPath: task.installPath || null });
            const registration = await this.completionRegistrar.registerCompletedDownload(task, completionReceipt);
            this.diagnosticRecorder?.mark?.(taskId, 'LIBRARY_REGISTRATION_FINISHED', {
                installedGameId: registration?.installedGameId || null,
                resolvedExecutablePath: registration?.resolvedExecutablePath || null,
            });
            this.diagnosticRecorder?.record?.(taskId, 'libraryRegistration', 'LIBRARY_REGISTRATION_RESULT', registration || {});
            registrationPatch = {
                installedGameId: registration?.installedGameId || null,
                resolvedExecutablePath: registration?.resolvedExecutablePath || completionReceipt?.verification?.executablePath || null,
                libraryRegisteredAt: new this.clock().toISOString(),
            };
        }
        if (task.platform === 'epic' && task.installProvider === 'legendary' && !registrationPatch.installedGameId) {
            throw makeDownloadError('EPIC_MANAGED_INSTALL_INVALID', 'Baddel could not finalize the managed Epic installation record.');
        }
        const completionPatch = {
            ...makeCompletionPatch(completionReceipt, task),
            ...registrationPatch,
            historyHidden: false,
            readyToPlay: task.platform === 'epic' && task.installProvider === 'legendary'
                ? Boolean(registrationPatch.installedGameId)
                : true,
            statusMessage: task.operationKind === 'repair' ? 'Verification and repair complete'
                : task.operationKind === 'update' ? 'Update complete'
                    : 'Ready to play',
            updateAvailable: task.operationKind === 'update' ? false : task.updateAvailable,
            installedBuildId: completionReceipt.buildId || task.targetBuildId || task.installedBuildId || task.verifiedBuildId || null,
            uninstallEligible: this.managedUninstallService?.isEligible?.({ ...task, ...registrationPatch, status: 'completed', uninstallEligible: true }) === true,
            downloadSpeedBps: 0,
            diskUsageBps: 0,
            etaSeconds: null,
            telemetryState: 'idle',
            networkState: 'idle',
            processExitedAt: new this.clock().toISOString(),
            completedAt: completionReceipt.completedAt || new this.clock().toISOString(),
            errorCode: null,
            errorMessage: null,
            maintenanceBaseCompletionReceipt: null,
            maintenanceBaseCompletedAt: null,
            maintenanceBaseUninstallEligible: false,
            maintenanceBaseManaged: false,
            maintenanceErrorCode: null,
            maintenanceErrorMessage: null,
            maintenanceFailedAt: null,
        };
        this.state.tasks[index] = applyTransition(task, DOWNLOAD_STATUSES.COMPLETED, completionPatch, this.clock);
        await this.historyRepository?.archive?.(this.state.tasks[index]);
        this.stopSessionWatchdog(taskId);
        this.telemetryAggregator.clear(taskId);
        const snapshot = await this.persistAndEmit();
        this.diagnosticRecorder?.mark?.(taskId, 'TASK_COMPLETED_EMITTED', {
            installedGameId: this.state.tasks[index]?.installedGameId || null,
            resolvedExecutablePath: this.state.tasks[index]?.resolvedExecutablePath || null,
        }, { flush: true });
        this.diagnosticRecorder?.mark?.(taskId, 'DOWNLOAD_FINAL_TERMINAL_STATE', {
            sessionId: task.progressSessionId || null,
            status: 'completed',
            errorCode: null,
        }, { flush: true });
        return snapshot;
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
        const maintenanceFailure = ['update', 'repair'].includes(task.operationKind)
            && (task.maintenanceBaseManaged === true || Boolean(task.maintenanceBaseCompletionReceipt));
        if (maintenanceFailure) {
            const failureCode = failure?.code || err?.code || 'DOWNLOAD_PROCESS_FAILED';
            this.state.tasks[index] = {
                ...task,
                ...extraPatch,
                status: DOWNLOAD_STATUSES.COMPLETED,
                stage: 'completed',
                statusMessage: userMessage,
                completionConfirmed: true,
                providerCompletionReceipt: task.maintenanceBaseCompletionReceipt,
                completedAt: task.maintenanceBaseCompletedAt || task.completedAt,
                uninstallEligible: task.maintenanceBaseUninstallEligible === true,
                maintenanceErrorCode: failureCode,
                maintenanceErrorMessage: userMessage,
                maintenanceFailedAt: new this.clock().toISOString(),
                maintenanceBaseCompletionReceipt: null,
                maintenanceBaseCompletedAt: null,
                maintenanceBaseUninstallEligible: false,
                maintenanceBaseManaged: false,
                errorCode: null,
                errorMessage: null,
                downloadSpeedBps: 0,
                diskUsageBps: 0,
                etaSeconds: null,
                telemetryState: 'idle',
                networkState: 'idle',
                processExitedAt: new this.clock().toISOString(),
                progressSessionId: null,
                taskRevision: (Number(task.taskRevision) || 0) + 1,
                updatedAt: new this.clock().toISOString(),
            };
            this.stopSessionWatchdog(taskId);
            this.telemetryAggregator.clear(taskId);
            this.diagnosticRecorder?.mark?.(taskId, 'DOWNLOAD_FINAL_TERMINAL_STATE', {
                sessionId: task.progressSessionId || null,
                status: 'maintenance_failed_install_preserved',
                errorCode: failureCode,
            }, { flush: true });
            return this.persistAndEmit();
        }
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
        await this.historyRepository?.archive?.(this.state.tasks[index]);
        this.stopSessionWatchdog(taskId);
        this.telemetryAggregator.clear(taskId);
        this.diagnosticRecorder?.mark?.(taskId, 'DOWNLOAD_FINAL_TERMINAL_STATE', {
            sessionId: task.progressSessionId || null,
            status: 'failed',
            errorCode: failure?.code || err?.code || 'DOWNLOAD_PROCESS_FAILED',
        }, { flush: true });
        return this.persistAndEmit();
    }
}

module.exports = {
    DownloadQueueManager,
};




