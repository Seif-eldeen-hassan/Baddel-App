'use strict';

const path = require('path');
const { epicTrace } = require('../services/EpicDownloadTrace');
const {
    findEpicManagedInstall,
    inspectEpicManagedInstall,
} = require('../../domain/services/EpicManagedInstallContract');

const CHANNELS = Object.freeze({
    GET_SNAPSHOT: 'downloads:get-snapshot',
    QUEUE_INSTALL: 'downloads:queue-install',
    GET_STORAGE_OPTIONS: 'downloads:get-storage-options',
    PREFETCH_INSTALL_SIZE: 'downloads:prefetch-install-size',
    RESOLVE_INSTALL_PLAN: 'downloads:resolve-install-plan',
    PAUSE: 'downloads:pause',
    RESUME: 'downloads:resume',
    CANCEL: 'downloads:cancel',
    RETRY: 'downloads:retry',
    REMOVE: 'downloads:remove',
    UNINSTALL: 'downloads:uninstall',
    START_NOW: 'downloads:start-now',
    REORDER: 'downloads:reorder',
    CLEAR_COMPLETED: 'downloads:clear-completed',
    GET_HISTORY: 'downloads:get-history',
    CLEAR_HISTORY: 'downloads:clear-history',
    SELECT_INSTALL_DIRECTORY: 'downloads:select-install-directory',
    OPEN_INSTALL_DIRECTORY: 'downloads:open-install-directory',
    GET_SETTINGS: 'downloads:get-settings',
    UPDATE_SETTINGS: 'downloads:update-settings',
    GET_CAPABILITIES: 'downloads:get-capabilities',
    CHECK_UPDATE: 'downloads:check-update',
    QUEUE_MAINTENANCE: 'downloads:queue-maintenance',
    LAUNCH_EPIC_LEGENDARY: 'downloads:launch-epic-legendary',
    RESOLVE_EPIC_PLAY_TARGET: 'downloads:resolve-epic-play-target',
    GET_DIRECT_EPIC_ACCOUNTS: 'downloads:get-direct-epic-accounts',
    RECORD_DIAGNOSTIC: 'downloads:record-diagnostic',
    SNAPSHOT_EVENT: 'downloads:snapshot',
    TASK_UPDATED_EVENT: 'downloads:task-updated',
    QUEUE_CHANGED_EVENT: 'downloads:queue-changed',
});

function ok(value) {
    return { status: 'success', ...value };
}

function fail(err) {
    return {
        status: 'error',
        code: err?.code || 'DOWNLOAD_ERROR',
        message: err?.message || 'Download operation failed.',
        ...(err?.stage ? { stage: err.stage } : {}),
    };
}

function stageError(code, message, stage) {
    const err = new Error(message);
    err.code = code;
    err.stage = stage;
    return err;
}

function validateTaskId(taskId) {
    const id = String(taskId || '').trim();
    if (!/^dl_[a-f0-9]{16}$/i.test(id)) {
        const err = new Error('Invalid download task id.');
        err.code = 'DOWNLOAD_INVALID_TASK_ID';
        throw err;
    }
    return id;
}

function sanitizeSettingsPatch(patch = {}) {
    const out = {};
    if (typeof patch.askInstallLocation === 'boolean') out.askInstallLocation = patch.askInstallLocation;
    if (typeof patch.autoStartNext === 'boolean') out.autoStartNext = patch.autoStartNext;
    if (typeof patch.keepCompletedHistory === 'boolean') out.keepCompletedHistory = patch.keepCompletedHistory;
    if (patch.defaultInstallRoots && typeof patch.defaultInstallRoots === 'object') {
        out.defaultInstallRoots = {};
        for (const platform of ['epic', 'gog']) {
            const raw = patch.defaultInstallRoots[platform];
            if (typeof raw === 'string' && raw.trim() && path.isAbsolute(raw.trim())) {
                out.defaultInstallRoots[platform] = path.normalize(raw.trim());
            }
        }
    }
    return out;
}

function sanitizeQueuePayload(payload = {}) {
    const allowed = [
        'gameId', 'canonicalGameId', 'title', 'coverUrl', 'heroUrl',
        'platform', 'installProvider', 'accountId', 'accountDisplayName',
        'providerProductId', 'providerAppName', 'appName', 'namespace', 'catalogItemId', 'ownedByAccountIds',
        'gogProductId', 'contentSystemProductId', 'gogdlAppName',
        'identitySource', 'ownershipVerified', 'secureLinkVerified',
        'verifiedBuildId', 'verifiedBuildGeneration', 'verifiedBuildCount',
        'supportPath', 'language', 'gogIdentity',
        'installTags', 'sdlPolicy', 'dlcPolicy', 'targetPlatform', 'buildId', 'buildVersion',
        'installRoot', 'installFolder', 'installPath', 'installPlanId', 'installPlanRendererStartedAt',
        'totalBytes', 'expectedTotalBytes', 'downloadSizeBytes', 'installedDiskSizeBytes',
        'sizeStatus', 'sizeReason', 'sizeCheckedAt',
    ];
    const out = {};
    for (const key of allowed) {
        if (Object.prototype.hasOwnProperty.call(payload, key)) out[key] = payload[key];
    }
    return out;
}

const DIAGNOSTIC_SECTIONS = new Set(['progressPipeline', 'completionTimeline', 'playResolution', 'finalLaunchTarget']);

function sanitizeDiagnosticPayload(payload = {}) {
    const section = String(payload.section || '');
    if (!DIAGNOSTIC_SECTIONS.has(section)) throw Object.assign(new Error('Invalid diagnostic section.'), { code: 'DOWNLOAD_INVALID_DIAGNOSTIC' });
    return {
        taskId: validateTaskId(payload.taskId),
        section,
        eventType: String(payload.eventType || 'RENDERER_DIAGNOSTIC').slice(0, 80),
        payload: payload.payload && typeof payload.payload === 'object' ? payload.payload : {},
    };
}

function sendToMainWindow(getMainWindow, channel, payload) {
    const win = getMainWindow?.();
    if (!win || win.isDestroyed?.()) return;
    win.webContents?.send?.(channel, payload);
    epicTrace.ipc(channel, payload);
}

function registerDownloadsIpc(ipcMain, deps = {}) {
    const { container, dialog, shell, getMainWindow, analytics } = deps;
    if (!ipcMain || !container) throw new Error('registerDownloadsIpc requires ipcMain and container');
    const { queueManager, useCases } = container;

    const resolveManagedEpicGame = ({ gameId = null, taskId = null } = {}) => {
        const games = container.completionRegistrar?.gamesApi?.getAllGames?.() || [];
        let task = null;
        if (taskId) {
            const id = validateTaskId(taskId);
            task = (queueManager.getSnapshot?.().tasks || []).find(item => String(item?.id || '') === id) || null;
            if (!task || task.status !== 'completed' || task.readyToPlay !== true
                || task.platform !== 'epic' || task.installProvider !== 'legendary') {
                throw stageError('EPIC_INSTALL_FINALIZATION_INCOMPLETE', 'This Epic installation has not finished finalizing.', 'managed-install-resolution');
            }
        }
        const requestedId = String(gameId || '').trim();
        const exact = requestedId
            ? games.find(item => String(item?.id || '') === requestedId
                || (Array.isArray(item?.recordAliases) && item.recordAliases.map(String).includes(requestedId)))
            : null;
        const game = task ? (findEpicManagedInstall(games, task) || exact) : exact;
        const inspection = inspectEpicManagedInstall(game, task);
        if (task?.id) {
            container.diagnosticRecorder?.mark?.(task.id, 'BADDEL_EPIC_INSTALL_CHECK', {
                requestedByTask: true,
                recordFound: inspection.fields.recordFound,
                lookupKey: 'completed-download-task',
                installSource: inspection.fields.installSource || null,
                installProvider: inspection.fields.installProvider || null,
                installPathPresent: inspection.fields.installPathPresent,
                launchTargetPresent: inspection.fields.launchTargetPresent,
                appNamePresent: inspection.fields.appNamePresent,
                namespacePresent: inspection.fields.namespacePresent,
                catalogItemIdPresent: inspection.fields.catalogItemIdPresent,
                result: inspection.ok,
                failedFields: inspection.failedFields,
            });
        }
        if (!inspection.ok) {
            const error = stageError('EPIC_LEGENDARY_INSTALL_NOT_FOUND', 'This game is not a Baddel-managed Epic installation.', 'managed-install-validation');
            error.details = { failedFields: inspection.failedFields };
            throw error;
        }
        return { game, task };
    };

    queueManager.on('snapshot', snapshot => sendToMainWindow(getMainWindow, CHANNELS.SNAPSHOT_EVENT, snapshot));
    queueManager.on('queue-changed', snapshot => sendToMainWindow(getMainWindow, CHANNELS.QUEUE_CHANGED_EVENT, snapshot));
    const terminalDownloadStates = new Map();
    queueManager.on('task-updated', payload => {
        sendToMainWindow(getMainWindow, CHANNELS.TASK_UPDATED_EVENT, payload);
        const task = payload?.task || payload;
        const status = String(task?.status || '').toLowerCase();
        if (!task?.id || !['completed', 'failed'].includes(status) || terminalDownloadStates.get(task.id) === status) return;
        terminalDownloadStates.set(task.id, status);
        analytics?.track?.(status === 'completed' ? 'download_completed' : 'download_failed', {
            feature: 'downloads',
            platform: task.platform,
            provider: task.installProvider,
            ...(status === 'failed' ? { error_code: task.errorCode || task.code || 'unknown' } : {}),
        }).catch?.(() => {});
    });

    ipcMain.handle(CHANNELS.GET_DIRECT_EPIC_ACCOUNTS, async (_event, game = {}) => {
        try {
            const safeGame = {
                id: game?.id ? String(game.id) : null,
                name: game?.name ? String(game.name) : null,
                title: game?.title ? String(game.title) : null,
                appName: game?.appName ? String(game.appName) : null,
                namespace: game?.namespace ? String(game.namespace) : null,
                catalogItemId: game?.catalogItemId ? String(game.catalogItemId) : null,
                launcherGameId: game?.launcherGameId ? String(game.launcherGameId) : null,
                allIds: game?.allIds && typeof game.allIds === 'object' ? { epic: game.allIds.epic ? String(game.allIds.epic) : null } : {},
            };
            return ok({ accounts: await container.epicAccountResolver.resolveOptions(safeGame) });
        } catch (err) { return fail(err); }
    });

    ipcMain.handle(CHANNELS.RESOLVE_EPIC_PLAY_TARGET, async (_event, taskId) => {
        try {
            const { game } = resolveManagedEpicGame({ taskId });
            return ok({
                route: 'baddel-managed-epic',
                game: { ...game, managedDownloadTaskId: validateTaskId(taskId) },
            });
        } catch (err) { return fail(err); }
    });

    ipcMain.handle(CHANNELS.LAUNCH_EPIC_LEGENDARY, async (_event, payload = {}) => {
        try {
            const gameId = String(payload.gameId || '').trim();
            const accountId = String(payload.accountId || '').trim();
            if (!gameId || !accountId || accountId.startsWith('ghost-')) throw Object.assign(new Error('Choose a valid synced Epic account.'), { code: 'EPIC_ACCOUNT_ID_INVALID' });
            const { game } = resolveManagedEpicGame({ gameId, taskId: payload.taskId || null });
            let verified;
            try {
                verified = await container.epicAccountResolver.validateTask({ ...game, accountId, providerAppName: game.appName || game.providerAppName });
            } catch (err) {
                err.stage = err.stage || 'account-resolution';
                throw err;
            }
            let result;
            try {
                result = await container.epicLegendaryRuntime.launch({ appName: verified.appName, installPath: game.installPath || game.path, configPath: verified.configPath });
            } catch (err) {
                err.stage = err.stage || 'epic-launch';
                throw err;
            }
            return ok({ ...result, route: 'baddel-managed-epic', method: 'legendary' });
        } catch (err) { return fail(err); }
    });

    ipcMain.handle(CHANNELS.GET_SNAPSHOT, async () => {
        try { return ok({ snapshot: await useCases.getSnapshot.execute() }); } catch (err) { return fail(err); }
    });

    ipcMain.handle(CHANNELS.GET_STORAGE_OPTIONS, async () => {
        try { return ok({ drives: await container.installPlanService.storageOptions() }); } catch (err) { return fail(err); }
    });
    ipcMain.handle(CHANNELS.PREFETCH_INSTALL_SIZE, async (_event, payload = {}) => {
        try { return ok({ prefetch: await container.installPlanService.prefetchSize(sanitizeQueuePayload(payload)) }); }
        catch (err) { return fail(err); }
    });
    ipcMain.handle(CHANNELS.RESOLVE_INSTALL_PLAN, async (_event, payload = {}) => {
        try {
            const safe = sanitizeQueuePayload(payload);
            safe.installPlanIpcReceivedAt = Date.now();
            return ok({ plan: await container.installPlanService.resolve(safe) });
        } catch (err) { return fail(err); }
    });

    ipcMain.handle(CHANNELS.QUEUE_INSTALL, async (_event, payload) => {
        try {
            const safe = sanitizeQueuePayload(payload);
            const result = await useCases.queueInstall.execute(container.installPlanService ? container.installPlanService.applyPlan(safe) : safe);
            analytics?.track?.('download_queued', { feature: 'downloads', platform: safe.platform, provider: safe.installProvider, result: 'success' }).catch?.(() => {});
            return result;
        } catch (err) {
            analytics?.track?.('download_queued', { feature: 'downloads', platform: payload?.platform, provider: payload?.installProvider, result: 'failed', error_code: err }).catch?.(() => {});
            return fail(err);
        }
    });

    ipcMain.handle(CHANNELS.PAUSE, async (_event, taskId) => {
        try { return ok({ snapshot: await useCases.pause.execute(validateTaskId(taskId)) }); } catch (err) { return fail(err); }
    });

    ipcMain.handle(CHANNELS.RESUME, async (_event, taskId) => {
        try { return ok({ snapshot: await useCases.resume.execute(validateTaskId(taskId)) }); } catch (err) { return fail(err); }
    });

    ipcMain.handle(CHANNELS.CANCEL, async (_event, payload = {}) => {
        try {
            if (
                Object.prototype.hasOwnProperty.call(payload || {}, 'deletePartial') &&
                typeof payload.deletePartial !== 'boolean'
            ) {
                const err = new Error('Invalid deletePartial value.');
                err.code = 'DOWNLOAD_INVALID_DELETE_PARTIAL';
                throw err;
            }
            return ok({ snapshot: await useCases.cancel.execute({
                taskId: validateTaskId(payload.taskId),
                deletePartial: payload.deletePartial === true,
            }) });
        } catch (err) { return fail(err); }
    });

    ipcMain.handle(CHANNELS.RETRY, async (_event, taskId) => {
        try { return ok({ snapshot: await useCases.retry.execute(validateTaskId(taskId)) }); } catch (err) { return fail(err); }
    });

    ipcMain.handle(CHANNELS.REMOVE, async (_event, taskId) => {
        try { return ok({ snapshot: await useCases.remove.execute(validateTaskId(taskId)) }); } catch (err) { return fail(err); }
    });

    ipcMain.handle(CHANNELS.UNINSTALL, async (_event, taskId) => {
        try { return ok({ snapshot: await useCases.uninstall.execute(validateTaskId(taskId)) }); } catch (err) { return fail(err); }
    });

    ipcMain.handle(CHANNELS.START_NOW, async (_event, taskId) => {
        try { return ok({ snapshot: await queueManager.startNow(validateTaskId(taskId)) }); } catch (err) { return fail(err); }
    });

    ipcMain.handle(CHANNELS.REORDER, async (_event, orderedIds) => {
        try {
            const ids = (Array.isArray(orderedIds) ? orderedIds : []).map(validateTaskId);
            return ok({ snapshot: await useCases.reorder.execute(ids) });
        } catch (err) { return fail(err); }
    });

    ipcMain.handle(CHANNELS.CLEAR_COMPLETED, async () => {
        try { return ok({ snapshot: await queueManager.clearCompleted() }); } catch (err) { return fail(err); }
    });

    ipcMain.handle(CHANNELS.GET_HISTORY, async () => {
        try { return ok({ history: await queueManager.getHistory() }); } catch (err) { return fail(err); }
    });

    ipcMain.handle(CHANNELS.CLEAR_HISTORY, async () => {
        try { return ok({ history: await queueManager.clearHistory() }); } catch (err) { return fail(err); }
    });

    ipcMain.handle(CHANNELS.SELECT_INSTALL_DIRECTORY, async () => {
        try {
            const result = await dialog.showOpenDialog(getMainWindow?.(), {
                title: 'Choose install folder',
                properties: ['openDirectory', 'createDirectory'],
            });
            if (result.canceled || !result.filePaths?.[0]) return ok({ canceled: true, path: null });
            return ok({ canceled: false, path: result.filePaths[0] });
        } catch (err) { return fail(err); }
    });

    ipcMain.handle(CHANNELS.OPEN_INSTALL_DIRECTORY, async (_event, taskId) => {
        try {
            validateTaskId(taskId);
            await queueManager.ensureLoaded();
            const task = queueManager.findTask(taskId);
            if (!task.installPath) throw Object.assign(new Error('No install folder for this task.'), { code: 'DOWNLOAD_INVALID_INSTALL_PATH' });
            await shell.openPath(task.installPath);
            return ok({});
        } catch (err) { return fail(err); }
    });

    ipcMain.handle(CHANNELS.GET_SETTINGS, async () => {
        try {
            await queueManager.ensureLoaded();
            return ok({ settings: queueManager.getSnapshot().settings });
        } catch (err) { return fail(err); }
    });

    ipcMain.handle(CHANNELS.UPDATE_SETTINGS, async (_event, patch) => {
        try { return ok({ snapshot: await queueManager.updateSettings(sanitizeSettingsPatch(patch)) }); } catch (err) { return fail(err); }
    });

    ipcMain.handle(CHANNELS.GET_CAPABILITIES, async () => {
        try { return ok({ capabilities: await container.providerExecutor?.getCapabilities?.() || [] }); } catch (err) { return fail(err); }
    });

    ipcMain.handle(CHANNELS.CHECK_UPDATE, async (_event, taskId) => {
        try { return await useCases.checkUpdate.execute(validateTaskId(taskId)); } catch (err) { return fail(err); }
    });

    ipcMain.handle(CHANNELS.QUEUE_MAINTENANCE, async (_event, payload = {}) => {
        try {
            return await useCases.queueMaintenance.execute({
                taskId: validateTaskId(payload.taskId),
                operationKind: String(payload.operationKind || ''),
            });
        } catch (err) { return fail(err); }
    });

    ipcMain.handle(CHANNELS.RECORD_DIAGNOSTIC, async (_event, payload) => {
        try {
            if (epicTrace.has(payload?.taskId)) {
                const diagnostic = sanitizeDiagnosticPayload(payload);
                return ok({ enabled: epicTrace.renderer(diagnostic.taskId, diagnostic.eventType, diagnostic.payload) === true });
            }
            if (!container.diagnosticRecorder?.isEnabled?.()) return ok({ enabled: false });
            const diagnostic = sanitizeDiagnosticPayload(payload);
            if (diagnostic.eventType === 'RENDERER_RECEIVED_COMPLETED') {
                container.diagnosticRecorder.mark(diagnostic.taskId, diagnostic.eventType, diagnostic.payload, { flush: true });
            } else {
                container.diagnosticRecorder.record(diagnostic.taskId, diagnostic.section, diagnostic.eventType, diagnostic.payload, { flush: diagnostic.eventType === 'FINAL_LAUNCH_TARGET' });
            }
            return ok({ enabled: true, diagnosticPath: container.diagnosticRecorder.getReportPath(diagnostic.taskId) });
        } catch (err) { return fail(err); }
    });
}

module.exports = {
    CHANNELS,
    registerDownloadsIpc,
    validateTaskId,
    sanitizeQueuePayload,
    sanitizeSettingsPatch,
    sanitizeDiagnosticPayload,
};

