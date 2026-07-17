'use strict';

// get-installed-games IPC handler.
//
// deps shape:
//   { getSavedGames,
//     scanAllGames,
//     refetchMissingImages,
//     runBackgroundMetadataPipeline,
//     getMainWindow,
//     installedGamesState } // shared object: { backgroundScanInProgress: false }

module.exports.register = function registerInstalledGamesHandlers(ipcMain, deps) {
    const {
        getSavedGames,
        scanAllGames,
        refetchMissingImages,
        runBackgroundMetadataPipeline,
        getMainWindow,
        installedGamesState,
    } = deps;

    ipcMain.handle('get-installed-games', async () => {
        const stored = getSavedGames();

        const notifyGameImageUpdated = (game) => {
            const mainWindow = getMainWindow();
            if (mainWindow) mainWindow.webContents.send('game-image-updated', game);
        };
        const sendScanState = (state, details = {}) => {
            const mainWindow = getMainWindow();
            if (mainWindow) {
                mainWindow.webContents.send('installed-games-scan-state', {
                    state,
                    source: stored.length === 0 ? 'fresh-install' : 'background-refresh',
                    ...details,
                });
            }
        };

        // Return the current stored games immediately, including [] on fresh
        // installs. A single shared background scan later emits library-updated.
        if (!installedGamesState.backgroundScanInProgress) {
            installedGamesState.backgroundScanInProgress = true;
            const scanStartedAt = Date.now();
            sendScanState('scan-started', { count: stored.length });

            scanAllGames()
                .then(updated => {
                    installedGamesState.backgroundScanInProgress = false;
                    sendScanState('scan-finished', {
                        count: Array.isArray(updated) ? updated.length : 0,
                        durationMs: Date.now() - scanStartedAt,
                    });
                    const mainWindow = getMainWindow();
                    if (mainWindow) mainWindow.webContents.send('library-updated', updated);
                    refetchMissingImages(notifyGameImageUpdated).catch(() => {});
                    setTimeout(() => {
                        runBackgroundMetadataPipeline(updated).catch(err =>
                            console.warn('[BackgroundMetaPipeline] Background scan pipeline error:', err.message)
                        );
                    }, 2000);
                })
                .catch(err => {
                    installedGamesState.backgroundScanInProgress = false;
                    sendScanState('scan-failed', {
                        message: err?.message || 'scan failed',
                        durationMs: Date.now() - scanStartedAt,
                    });
                });
        }

        return stored;
    });
};
