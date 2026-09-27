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
    const automaticScanCooldownMs = Math.max(1_000, Number(deps.automaticScanCooldownMs) || 5 * 60 * 1000);
    const automaticScanRetryBaseMs = Math.max(1_000, Number(deps.automaticScanRetryBaseMs) || 15_000);

    const stableLibrarySignature = (games) => JSON.stringify((Array.isArray(games) ? games : [])
        .map((game) => ({
            id: String(game?.id || game?.gameId || game?.appName || game?.title || game?.name || ''),
            title: String(game?.title || game?.name || ''),
            platform: String(game?.platform || game?.scannerPlatform || game?.installSource || ''),
            path: String(game?.path || game?.exePath || game?.executablePath || ''),
            command: String(game?.command || game?.launchCommand || ''),
            cover: String(game?.coverUrl || game?.image || game?.defaultImage || ''),
            installed: game?.isInstalled === true || game?.installVerified === true,
        }))
        .sort((a, b) => (a.id || a.title).localeCompare(b.id || b.title)));

    const artworkTypeValue = (game, type) => {
        const state = game?.artworkState?.version === 2 ? game.artworkState[type] : null;
        if (type === 'cover') return state?.overrideValue || state?.fallbackValue || game?.image || game?.defaultImage || game?.coverUrl;
        if (type === 'hero') return state?.overrideValue || state?.fallbackValue || game?.heroImage || game?.defaultHero || game?.heroUrl;
        return state?.overrideValue || state?.fallbackValue || game?.logo || game?.defaultLogo || game?.logoUrl;
    };
    const libraryNeedsArtworkRepair = (games) => (Array.isArray(games) ? games : []).some((game) =>
        game && !game.isHidden && ['cover', 'hero', 'logo'].some((type) => !artworkTypeValue(game, type))
    );

    const clearBackgroundMetadataTimer = () => {
        if (installedGamesState.backgroundMetadataTimer) {
            clearTimeout(installedGamesState.backgroundMetadataTimer);
            installedGamesState.backgroundMetadataTimer = null;
        }
    };

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
        // installs. A single shared background scan later emits library-updated
        // only when the canonical installed-game snapshot actually changed.
        const now = Date.now();
        const cooldownElapsed = !installedGamesState.lastScanFinishedAt
            || now - installedGamesState.lastScanFinishedAt >= automaticScanCooldownMs;
        const retryReady = !installedGamesState.nextAutomaticScanAt
            || now >= installedGamesState.nextAutomaticScanAt;
        if (!installedGamesState.backgroundScanInProgress && cooldownElapsed && retryReady) {
            installedGamesState.backgroundScanInProgress = true;
            const scanStartedAt = Date.now();
            const beforeSignature = stableLibrarySignature(stored);
            if (!installedGamesState.lastLibrarySignature) {
                installedGamesState.lastLibrarySignature = beforeSignature;
            }
            sendScanState('scan-started', { count: stored.length });

            scanAllGames()
                .then(updated => {
                    installedGamesState.backgroundScanInProgress = false;
                    installedGamesState.lastScanFinishedAt = Date.now();
                    installedGamesState.nextAutomaticScanAt = null;
                    installedGamesState.automaticScanFailureCount = 0;
                    const afterSignature = stableLibrarySignature(updated);
                    const changed = afterSignature !== installedGamesState.lastLibrarySignature;
                    installedGamesState.lastLibrarySignature = afterSignature;
                    sendScanState('scan-finished', {
                        count: Array.isArray(updated) ? updated.length : 0,
                        changed,
                        durationMs: Date.now() - scanStartedAt,
                    });
                    const mainWindow = getMainWindow();
                    if (changed && mainWindow) mainWindow.webContents.send('library-updated', updated);
                    const needsArtworkRepair = libraryNeedsArtworkRepair(updated);
                    if (!changed && !needsArtworkRepair) return;
                    refetchMissingImages(notifyGameImageUpdated).catch(() => {});
                    clearBackgroundMetadataTimer();
                    installedGamesState.backgroundMetadataTimer = setTimeout(() => {
                        installedGamesState.backgroundMetadataTimer = null;
                        runBackgroundMetadataPipeline(updated).catch(err =>
                            console.warn('[BackgroundMetaPipeline] Background scan pipeline error:', err.message)
                        );
                    }, 2000);
                })
                .catch(err => {
                    installedGamesState.backgroundScanInProgress = false;
                    const failures = Math.min(6, (Number(installedGamesState.automaticScanFailureCount) || 0) + 1);
                    installedGamesState.automaticScanFailureCount = failures;
                    installedGamesState.nextAutomaticScanAt = Date.now()
                        + Math.min(5 * 60 * 1000, automaticScanRetryBaseMs * (2 ** (failures - 1)));
                    sendScanState('scan-failed', {
                        message: err?.message || 'scan failed',
                        durationMs: Date.now() - scanStartedAt,
                    });
                });
        }

        return stored;
    });
};
