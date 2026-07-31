'use strict';

const path = require('path');

const CHANNELS = Object.freeze({
    GET_SNAPSHOT: 'downloads:get-snapshot',
    QUEUE_INSTALL: 'downloads:queue-install',
    PAUSE: 'downloads:pause',
    RESUME: 'downloads:resume',
    CANCEL: 'downloads:cancel',
    RETRY: 'downloads:retry',
    REMOVE: 'downloads:remove',
    START_NOW: 'downloads:start-now',
    REORDER: 'downloads:reorder',
    CLEAR_COMPLETED: 'downloads:clear-completed',
    SELECT_INSTALL_DIRECTORY: 'downloads:select-install-directory',
    OPEN_INSTALL_DIRECTORY: 'downloads:open-install-directory',
    GET_SETTINGS: 'downloads:get-settings',
    UPDATE_SETTINGS: 'downloads:update-settings',
    GET_CAPABILITIES: 'downloads:get-capabilities',
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
    };
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
        'platform', 'accountId', 'accountDisplayName',
        'providerProductId', 'providerAppName',
        'gogProductId', 'contentSystemProductId', 'gogdlAppName',
        'identitySource', 'ownershipVerified', 'secureLinkVerified',
        'verifiedBuildId', 'verifiedBuildGeneration', 'verifiedBuildCount',
        'supportPath', 'language', 'gogIdentity',
        'installRoot', 'installFolder', 'installPath',
        'totalBytes', 'expectedTotalBytes', 'downloadSizeBytes', 'installedDiskSizeBytes',
    ];
    const out = {};
    for (const key of allowed) {
        if (Object.prototype.hasOwnProperty.call(payload, key)) out[key] = payload[key];
    }
    return out;
}

function sendToMainWindow(getMainWindow, channel, payload) {
    const win = getMainWindow?.();
    if (!win || win.isDestroyed?.()) return;
    win.webContents?.send?.(channel, payload);
}

function registerDownloadsIpc(ipcMain, deps = {}) {
    const { container, dialog, shell, getMainWindow } = deps;
    if (!ipcMain || !container) throw new Error('registerDownloadsIpc requires ipcMain and container');
    const { queueManager, useCases } = container;

    queueManager.on('snapshot', snapshot => sendToMainWindow(getMainWindow, CHANNELS.SNAPSHOT_EVENT, snapshot));
    queueManager.on('queue-changed', snapshot => sendToMainWindow(getMainWindow, CHANNELS.QUEUE_CHANGED_EVENT, snapshot));
    queueManager.on('task-updated', payload => sendToMainWindow(getMainWindow, CHANNELS.TASK_UPDATED_EVENT, payload));

    ipcMain.handle(CHANNELS.GET_SNAPSHOT, async () => {
        try { return ok({ snapshot: await useCases.getSnapshot.execute() }); } catch (err) { return fail(err); }
    });

    ipcMain.handle(CHANNELS.QUEUE_INSTALL, async (_event, payload) => {
        try { return await useCases.queueInstall.execute(sanitizeQueuePayload(payload)); } catch (err) { return fail(err); }
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
}

module.exports = {
    CHANNELS,
    registerDownloadsIpc,
    validateTaskId,
    sanitizeQueuePayload,
    sanitizeSettingsPatch,
};

