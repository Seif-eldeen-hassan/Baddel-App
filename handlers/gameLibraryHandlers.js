'use strict';

// Basic game-library IPC handlers extracted from main.js.
// All behaviour is verbatim — only outer-scope references are threaded through deps.
//
// deps shape: {
//   ipcValidation,
//   getSavedGames,
//   scanAllGames,
//   removeGame, renameGame, unhideAllGames, getHiddenGames,
//   restoreSpecificGames, deleteGamePermanently, reorderLibrary,
//   getDynamicGameExes,
//   _detectPlatform,
//   analytics,
//   getMainWindow,   ← () => mainWindow
// }
//
// Intentionally NOT moved here:
//   get-installed-games   — owns _backgroundScanInProgress local flag and triggers the
//                           background metadata pipeline + refetchMissingImages side-effects
//   add-manual-game       — resolves .lnk shortcuts (complex file selection) and passes
//                           forceMetadata: true into addManualGame

module.exports.register = function registerGameLibraryHandlers(ipcMain, deps) {
    const {
        ipcValidation,
        getSavedGames,
        scanAllGames,
        removeGame,
        renameGame,
        unhideAllGames,
        getHiddenGames,
        restoreSpecificGames,
        deleteGamePermanently,
        reorderLibrary,
        getDynamicGameExes,
        _detectPlatform,
        analytics,
        getMainWindow,
    } = deps;

    ipcMain.handle('remove-game', async (_, id) => {
        try { ipcValidation.assertSafeId(id, 'id'); } catch (e) { return ipcValidation.sanitizeErrorForRenderer(e); }
        const games = await getSavedGames();
        const game = games.find(g => g.id === id);
        const platform = _detectPlatform(game?.command);
        const result = await removeGame(id);
        analytics.logGameRemoved(platform).catch(() => {});
        return result;
    });

    ipcMain.handle('rename-game', (_, id, name) => {
        try {
            ipcValidation.assertSafeId(id, 'id');
            ipcValidation.assertString(name, 'name', 256);
        } catch (e) { return ipcValidation.sanitizeErrorForRenderer(e); }
        return renameGame(id, name);
    });

    ipcMain.handle('scan-all-games', async () => {
        const games = await scanAllGames();
        const platforms = [...new Set(games.map(g => g.platform).filter(Boolean))];
        analytics.logLibraryScanned(games.length, platforms).catch(() => {});
        return games;
    });

    ipcMain.handle('unhide-all-games', () => unhideAllGames());
    ipcMain.handle('get-hidden-games', () => getHiddenGames());

    ipcMain.handle('restore-specific-games', async (_, ids) => {
        const result = await restoreSpecificGames(ids);
        if (result.status === 'success') analytics.logGameRestored(ids.length).catch(() => {});
        return result;
    });

    ipcMain.handle('delete-game-permanently', async (_, id) => {
        try { ipcValidation.assertSafeId(id, 'id'); } catch (e) { return ipcValidation.sanitizeErrorForRenderer(e); }
        const result = await deleteGamePermanently(id);
        if (result.status === 'success') {
            analytics.logGameDeletedForever().catch(() => {});
            const mainWindow = getMainWindow();
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('game-deleted-permanently', { id });
            }
        }
        return result;
    });

    ipcMain.handle('reorder-library', (_, ids) => {
        try { ipcValidation.assertArrayOfStrings(ids, 'ids'); } catch (e) { return ipcValidation.sanitizeErrorForRenderer(e); }
        return reorderLibrary(ids);
    });

    // ── Lightweight single-game read (no scan, no background work) ────────────
    // Used by game-details.js instead of get-installed-games so that opening a
    // game details page never triggers a background scan or library-updated flood.
    ipcMain.handle('get-game-by-id', async (_, gameId) => {
        try {
            const stored = getSavedGames();
            return stored.find(g => String(g.id) === String(gameId)) || null;
        } catch (err) {
            console.warn('[get-game-by-id] error:', err.message);
            return null;
        }
    });

    ipcMain.handle('get-dynamic-game-exes', (_, gameId, gamePath) => getDynamicGameExes(gameId, gamePath));
};
