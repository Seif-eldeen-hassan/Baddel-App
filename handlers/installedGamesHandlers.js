'use strict';

// get-installed-games IPC handler extracted from main.js.
// All behaviour is verbatim — only outer-scope references are threaded through deps.
//
// deps shape:
//   { getSavedGames,
//     scanAllGames,
//     refetchMissingImages,           ← gameScanner.refetchMissingImages
//     runBackgroundMetadataPipeline,  ← gameScanner.runBackgroundMetadataPipeline
//     getMainWindow,                  ← () => mainWindow
//     installedGamesState }           ← { backgroundScanInProgress: false }
//                                        passed by object reference — mutations
//                                        visible across all concurrent IPC calls

module.exports.register = function registerInstalledGamesHandlers(ipcMain, deps) {
    const {
        getSavedGames,
        scanAllGames,
        refetchMissingImages,
        runBackgroundMetadataPipeline,
        getMainWindow,
        installedGamesState,
    } = deps;

    // ---- Games Library ----
    // ── FIX: guard against concurrent background scans ──────────────────────
    // get-installed-games is called by BOTH app.js (initSystem) and accounts.js
    // (renderAllGamesView) during startup.  Without a guard, each call launches
    // an independent scanAllGames() in the background → two 'library-updated'
    // events arrive at the renderer → EnrichQueue drains twice on the same games
    // → duplicate lookupGameServer calls, 429 rate-limit storms, and skeleton hangs.
    ipcMain.handle('get-installed-games', async () => {
        const stored = getSavedGames();

        // Helper: notify renderer when a single game's images are ready
        const notifyGameImageUpdated = (game) => {
            const mainWindow = getMainWindow();
            if (mainWindow) mainWindow.webContents.send('game-image-updated', game);
        };

        if (stored.length === 0) {
            // Fresh install / wiped DB — scan first, then refetch missing images
            console.log('[Startup] Fresh install detected — running full scan + background metadata pipeline.');
            const games = await scanAllGames();
            // Fire image refetch in background; renderer gets live updates via 'game-image-updated'
            refetchMissingImages(notifyGameImageUpdated).catch(() => {});
            // ── Run background metadata pipeline for non-Steam/Epic games ──────────
            // Fires after scan so the DB is fully populated before we read it.
            runBackgroundMetadataPipeline(games).catch(err =>
                console.warn('[BackgroundMetaPipeline] Fresh-install pipeline error:', err.message)
            );
            return games;
        }

        // Return stored immediately, sync in background.
        // Only ONE background scan may run at a time — if a scan is already in
        // progress (e.g. from a concurrent initSystem + renderAllGamesView call),
        // skip launching a second one.  The first scan will still fire
        // 'library-updated' when it completes, so no update is lost.
        if (!installedGamesState.backgroundScanInProgress) {
            installedGamesState.backgroundScanInProgress = true;
            scanAllGames()
                .then(updated => {
                    installedGamesState.backgroundScanInProgress = false;
                    const mainWindow = getMainWindow();
                    if (mainWindow) mainWindow.webContents.send('library-updated', updated);
                    // After scan, re-fetch images for any game still missing a cover
                    refetchMissingImages(notifyGameImageUpdated).catch(() => {});
                    // ── Run background metadata pipeline for non-Steam/Epic games ──
                    // Deferred 2 s so the library-updated render cycle settles first.
                    setTimeout(() => {
                        runBackgroundMetadataPipeline(updated).catch(err =>
                            console.warn('[BackgroundMetaPipeline] Background scan pipeline error:', err.message)
                        );
                    }, 2000);
                })
                .catch(() => { installedGamesState.backgroundScanInProgress = false; });
        }

        return stored;
    });
};
