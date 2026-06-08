'use strict';

// Window / app-control IPC handlers extracted from main.js.
// All behaviour is verbatim — only outer-scope references are threaded through deps.
//
// deps shape:
//   { getMainWindow,   ← () => mainWindow
//     app }            ← electron.app

module.exports.register = function registerWindowHandlers(ipcMain, deps) {
    const { getMainWindow, app } = deps;

    ipcMain.on('minimize-app', () => getMainWindow()?.minimize());

    ipcMain.on('maximize-app', () => {
        const mainWindow = getMainWindow();
        if (!mainWindow) return;
        mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
    });

    ipcMain.on('close-app', () => getMainWindow()?.close());

    ipcMain.handle('get-app-version', () => app.getVersion());
};
