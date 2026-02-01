const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getGames: () => ipcRenderer.invoke('get-installed-games'),
    getDrives: () => ipcRenderer.invoke('get-drives'),
    listDirs: (path) => ipcRenderer.invoke('list-directories', path), 
    addManualGame: (exePath, customName) => ipcRenderer.invoke('add-manual-game', exePath, customName),
    removeGame: (gameIdOrPath) => ipcRenderer.invoke('remove-game', gameIdOrPath),
    launchGame: (command) => ipcRenderer.send('launch-game', command),
    getMetadata: (gameName) => ipcRenderer.invoke('get-game-metadata', gameName),
    renameGame: (id, name) => ipcRenderer.invoke('rename-game', id, name),
    scanAllGames: () => ipcRenderer.invoke('scan-all-games'),
    unhideAllGames: () => ipcRenderer.invoke('unhide-all-games'),
    getHiddenGames: () => ipcRenderer.invoke('get-hidden-games'),
    restoreSpecificGames: (ids) => ipcRenderer.invoke('restore-specific-games', ids),
    deleteGamePermanently: (id) => ipcRenderer.invoke('delete-game-permanently', id),
    onLibraryUpdated: (callback) => ipcRenderer.on('library-updated', (event, games) => callback(games)),
    
    // --- دوال الصور (تمت إضافة cacheImage هنا) ---
    selectImage: () => ipcRenderer.invoke('select-game-image'),
    updateGameImage: (id, path, type) => ipcRenderer.invoke('update-game-image', id, path, type),
    resetGameImage: (id, type) => ipcRenderer.invoke('reset-game-image', id, type),
    
    // 🔥 دي الدالة الجديدة اللي بتربط الدنيا ببعضها
    cacheImage: (url, gameId, type) => ipcRenderer.invoke('cache-image', url, gameId, type),

    getFilePath: (file) => webUtils.getPathForFile(file),
    
    // --- Collections & System ---
    getCollections: () => ipcRenderer.invoke('get-collections'),
    createCollection: (name, img) => ipcRenderer.invoke('create-collection', name, img),
    addGameToCollection: (colId, gameId) => ipcRenderer.invoke('add-game-collection', colId, gameId),
    removeGameFromCollection: (colId, gameId) => ipcRenderer.invoke('remove-game-collection', colId, gameId), // خد بالك الدالة دي متكررة مرتين في كودك القديم، أنا شلت التكرار وظبطها هنا
    deleteCollection: (colId) => ipcRenderer.invoke('delete-collection', colId),
    
    getDesktopPath: () => ipcRenderer.invoke('get-desktop-path'),
    minimizeApp: () => ipcRenderer.send('minimize-app'),
    maximizeApp: () => ipcRenderer.send('maximize-app'),
    closeApp: () => ipcRenderer.send('close-app'),
    cacheAllAssets: (assets, gameId) => ipcRenderer.invoke('cache-all-assets', assets, gameId),
    saveMetadata: (gameId, metadata) => ipcRenderer.invoke('save-game-metadata', gameId, metadata),
    reorderLibrary: (ids) => ipcRenderer.invoke('reorder-library', ids),
    reorderCollection: (colId, newOrder) => ipcRenderer.invoke('reorder-collection', colId, newOrder),
    updateCollection: (colId, name, img) => ipcRenderer.invoke('update-collection', colId, name, img),
});