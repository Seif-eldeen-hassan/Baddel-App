'use strict';

// Collections IPC handlers extracted from main.js.
// All behaviour is verbatim — only outer-scope references are threaded through deps.
//
// deps shape: { colHandler, analytics }

module.exports.register = function registerCollectionHandlers(ipcMain, deps) {
    const { colHandler, analytics } = deps;

    // ---- Collections ----
    ipcMain.handle('get-collections', () => {
        try { return colHandler.getCollections(); }
        catch (err) { return []; }
    });
    ipcMain.handle('create-collection', async (_, name, img) => {
        const result = await colHandler.createCollection(name, img);
        if (result?.status === 'success') analytics.logCollectionCreated(false).catch(() => {});
        return result;
    });
    ipcMain.handle('add-game-collection', async (_, colId, gameId) => {
    const result = await colHandler.addGameToCollection(colId, gameId);
    const isFav = (colId === 'fav_system_default');
    analytics.logGameAddedToCollection(isFav).catch(() => {});

    return result;
});
    ipcMain.handle('remove-game-collection', async (_, colId, gameId) => {
        const result = await colHandler.removeGameFromCollection(colId, gameId);

        const isFav = (colId === 'fav_system_default');
        analytics.logGameRemovedFromCollection(isFav).catch(() => {});

        return result;
    });
    ipcMain.handle('delete-collection', (_, colId) => colHandler.deleteCollection(colId));
    ipcMain.handle('reorder-collection', (_, colId, order) => colHandler.reorderCollection(colId, order));
    ipcMain.handle('update-collection', (_, colId, name, img) => colHandler.updateCollectionDetails(colId, name, img));
};
