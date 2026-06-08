'use strict';

// Local metadata persistence IPC handlers extracted from main.js.
// All behaviour is verbatim — only outer-scope references are threaded through deps.
//
// deps shape: {
//   ipcValidation,
//   getSavedGames,
//   updateGameMetadata,
//   saveFullMetadata,
//   loadFullMetadata,
//   getMainWindow,   ← () => mainWindow
// }
//
// Intentionally NOT moved here:
//   get-game-metadata       — uses MetadataResolutionManager and the Steam/Epic enrichment pipeline
//   resolve-metadata        — already moved to handlers/baddelApiHandlers.js
//   lookup-game-server / enrich-game-server / import-and-enrich-server — Baddel API handlers
//   update-playtime / set-time-tracking-enabled / get-time-tracking-enabled — playtime domain
//   get-game-achievements   — achievements domain

module.exports.register = function registerLocalMetadataHandlers(ipcMain, deps) {
    const {
        ipcValidation,
        getSavedGames,
        updateGameMetadata,
        saveFullMetadata,
        loadFullMetadata,
        getMainWindow,
    } = deps;

    ipcMain.handle('save-game-metadata', async (_, id, meta, opts) => {
        try { ipcValidation.assertSafeId(id, 'id'); } catch (e) { return ipcValidation.sanitizeErrorForRenderer(e); }
        const result = await updateGameMetadata(id, meta, opts || {});
        if (result?.status === 'success') {
            try {
                const game = getSavedGames().find(g => String(g.id) === String(id));
                const mainWindow = getMainWindow();
                if (game && mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('game-image-updated', game);
                }
            } catch (_) {}
        }
        return result;
    });

    ipcMain.handle('save-full-metadata', (_, gameId, title, platform, meta) => {
        try {
            ipcValidation.assertSafeId(gameId, 'gameId');
            if (platform) ipcValidation.assertString(platform, 'platform', 32);
        } catch (e) { return ipcValidation.sanitizeErrorForRenderer(e); }
        return saveFullMetadata(gameId, title, platform, meta);
    });

    ipcMain.handle('load-full-metadata', (_, gameId) =>
        loadFullMetadata(gameId)
    );
};
