'use strict';

// Auto-updater IPC handlers extracted from main.js.
// All behaviour is verbatim — only outer-scope references are threaded through deps.
//
// deps shape: {
//   _updState,               ← object by reference (mutations visible in main.js)
//   getAutoUpdater,          ← () => autoUpdater   (lazy-loaded in setupAutoUpdater)
//   getMainWindow,           ← () => mainWindow
//   setIsQuitting,           ← (v) => { isQuitting = v; }
//   getTray,                 ← () => tray
//   setTray,                 ← (v) => { tray = v; }
//   getUpdateInstallStarted, ← () => _updateInstallStarted
//   setUpdateInstallStarted, ← (v) => { _updateInstallStarted = v; }
//   _sendUpdateStatus,
//   _clearPrepareTimer,
//   _clearAllUpdateTimers,
//   readUpdateNotesState,
//   markUpdateNotesPending,
// }
//
// Intentionally NOT moved here:
//   setupAutoUpdater()                — initialises autoUpdater and wires event listeners
//   autoUpdater.on('update-available') / download-progress / update-downloaded / error
//     — auto-updater state machine event listeners remain in main.js
//   _updState object declaration      — stays in main.js; only a reference is passed
//   _sendUpdateStatus / timer helpers — defined in main.js; passed as deps
//   markUpdateNotesPending / readUpdateNotesState — update-notes helpers in main.js

module.exports.register = function registerAutoUpdateHandlers(ipcMain, deps) {
    const {
        _updState,
        getAutoUpdater,
        getMainWindow,
        setIsQuitting,
        getTray,
        setTray,
        getUpdateInstallStarted,
        setUpdateInstallStarted,
        _sendUpdateStatus,
        _clearPrepareTimer,
        _clearAllUpdateTimers,
        readUpdateNotesState,
        markUpdateNotesPending,
        analytics,
    } = deps;

    ipcMain.handle('start-update-download', async () => {
        analytics?.track?.('update_action', { feature: 'updates', action: 'download', result: 'started' }).catch?.(() => {});
        const autoUpdater = getAutoUpdater();
        const mainWindow  = getMainWindow();
        console.log('[AutoUpdater] Download requested — current status:', _updState.status);

        if (_updState.downloaded) {
            console.log('[AutoUpdater] Already downloaded, re-sending update-ready');
            if (mainWindow) mainWindow.webContents.send('update-ready', _updState.version);
            _sendUpdateStatus({ status: 'downloaded', version: _updState.version });
            return { ok: true, status: 'downloaded' };
        }

        if (_updState.downloading) {
            console.log('[AutoUpdater] Download already in progress:', _updState.status);
            _sendUpdateStatus({ status: _updState.status, version: _updState.version });
            return { ok: true, status: _updState.status };
        }

        _updState.downloading = true;
        _updState.status      = 'preparing';
        console.log('[AutoUpdater] Starting download…');
        _sendUpdateStatus({ status: 'preparing', version: _updState.version });

        // Safety timeout — if download-progress never fires within 60 s, surface an error
        _clearPrepareTimer();
        _updState.prepareTimer = setTimeout(() => {
            if (_updState.status === 'preparing') {
                console.warn('[AutoUpdater] Prepare timeout — no progress after 60 s');
                _updState.downloading = false;
                _updState.status      = 'error';
                const msg = 'Download did not start. Check your connection and try again.';
                const mw = getMainWindow();
                if (mw) mw.webContents.send('update-error', msg);
                _sendUpdateStatus({ status: 'error', message: msg });
            }
        }, 60_000);

        try {
            if (!autoUpdater) throw new Error('autoUpdater failed to initialise — cannot download update');
            await autoUpdater.downloadUpdate();
            analytics?.track?.('update_action', { feature: 'updates', action: 'download', result: 'success' }).catch?.(() => {});
            console.log('[AutoUpdater] downloadUpdate() resolved');
            return { ok: true };
        } catch (err) {
            analytics?.track?.('update_action', { feature: 'updates', action: 'download', result: 'failed', error_code: err }).catch?.(() => {});
            _clearAllUpdateTimers();
            _updState.downloading = false;
            _updState.status      = 'error';
            const msg = err?.message || String(err);
            console.error('[AutoUpdater] downloadUpdate() rejected:', msg);
            const mw = getMainWindow();
            if (mw) mw.webContents.send('update-error', msg);
            _sendUpdateStatus({ status: 'error', message: msg });
            return { ok: false, error: msg };
        }
    });

    // Legacy send shim — keeps any old callers from crashing
    ipcMain.on('start-update-download', () => {
        const autoUpdater = getAutoUpdater();
        const mainWindow  = getMainWindow();
        console.warn('[AutoUpdater] Legacy ipcMain.on start-update-download — use invoke instead');
        if (_updState.downloaded) { if (mainWindow) mainWindow.webContents.send('update-ready', _updState.version); return; }
        if (_updState.downloading) return;
        if (!autoUpdater) {
            console.error('[AutoUpdater] (legacy) autoUpdater not initialised — cannot download');
            return;
        }
        autoUpdater.downloadUpdate().catch(err => {
            console.error('[AutoUpdater] (legacy) Download failed:', err.message);
            const mw = getMainWindow();
            if (mw) mw.webContents.send('update-error', err.message);
        });
    });

    // اليوزر وافق على الـ restart
    ipcMain.on('restart-and-update', () => {
        if (getUpdateInstallStarted()) {
            console.warn('[AutoUpdater] restart-and-update ignored — install already started');
            return;
        }

        setUpdateInstallStarted(true);
        analytics?.track?.('update_action', { feature: 'updates', action: 'install', result: 'started' }).catch?.(() => {});

        const autoUpdater = getAutoUpdater();
        if (!autoUpdater) {
            console.error('[AutoUpdater] quitAndInstall skipped — autoUpdater not initialised');
            setUpdateInstallStarted(false);
            return;
        }

        console.log('[AutoUpdater] restart-and-update requested');

        setIsQuitting(true);

        try {
            const tray = getTray();
            if (tray) {
                tray.destroy();
                setTray(null);
            }
        } catch (err) {
            console.warn('[AutoUpdater] tray destroy failed:', err?.message || err);
        }

        try {
            const mainWindow = getMainWindow();
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.removeAllListeners('close');
            }
        } catch {}

        // Never fall back to the old running version; it would poison pendingVersion.
        const savedState    = readUpdateNotesState();
        const targetVersion = _updState.version || savedState.pendingVersion || null;
        if (targetVersion) {
            markUpdateNotesPending(targetVersion);
        } else {
            console.warn('[UpdateNotes] restart-and-update: no target version found — update notes will not show');
        }

        setTimeout(() => {
            try {
                console.log('[AutoUpdater] calling quitAndInstall...');
                autoUpdater.quitAndInstall(false, true);
            } catch (err) {
                setUpdateInstallStarted(false);
                console.error('[AutoUpdater] quitAndInstall failed:', err?.message || err);
            }
        }, 1000);
    });

    ipcMain.handle('check-for-updates', async () => {
        analytics?.track?.('update_action', { feature: 'updates', action: 'check', result: 'started' }).catch?.(() => {});
        const autoUpdater = getAutoUpdater();
        if (!autoUpdater) {
            console.warn('[AutoUpdater] checkForUpdates skipped — autoUpdater not initialised');
            return;
        }
        try {
            await autoUpdater.checkForUpdates();
            analytics?.track?.('update_action', { feature: 'updates', action: 'check', result: 'success' }).catch?.(() => {});
        } catch (err) {
            analytics?.track?.('update_action', { feature: 'updates', action: 'check', result: 'failed', error_code: err }).catch?.(() => {});
            console.warn('[AutoUpdater] Manual check failed:', err.message);
        }
    });
};
