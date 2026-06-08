'use strict';

// Launcher path selection IPC handlers extracted from main.js.
// All behaviour is verbatim — only outer-scope references are threaded through deps.
// Inline require('./services/riotPathResolver') and require('./services/launcherPathResolver')
// replaced with deps to avoid path resolution issues from handlers/ subdirectory.
//
// deps shape:
//   { dialog,
//     getMainWindow,        ← () => mainWindow
//     riotPathResolver,     ← require('./services/riotPathResolver')
//     launcherPathResolver  ← require('./services/launcherPathResolver') }

module.exports.register = function registerLauncherPathHandlers(ipcMain, deps) {
    const { dialog, getMainWindow, riotPathResolver, launcherPathResolver } = deps;

    // ---- Riot Client manual path selection (legacy, kept for backward compat) ----
    ipcMain.handle('select-riot-client-manually', async () => {
        const result = await dialog.showOpenDialog(getMainWindow(), {
            title:       'Locate RiotClientServices.exe',
            properties:  ['openFile'],
            filters:     [{ name: 'RiotClientServices.exe', extensions: ['exe'] }],
        });
        if (result.canceled || !result.filePaths.length) return { success: false, canceled: true };
        const selected = result.filePaths[0];
        try {
            const valid = await riotPathResolver.saveManualRiotClientPath(selected);
            return { success: true, path: valid, platform: 'riot' };
        } catch (err) {
            return { success: false, message: err.message, code: err.code };
        }
    });

    // ---- Generic launcher manual path selection (all platforms) ----
    ipcMain.handle('select-launcher-manually', async (_, platform) => {
        const info = launcherPathResolver.getPlatformInfo(platform);
        if (!info) return { success: false, code: 'UNSUPPORTED_PLATFORM', message: `Unknown platform: ${platform}` };

        const result = await dialog.showOpenDialog(getMainWindow(), {
            title:      info.dialogTitle || `Locate ${info.name}`,
            properties: ['openFile'],
            filters:    [{ name: `${info.name} executable`, extensions: ['exe'] }],
        });
        if (result.canceled || !result.filePaths.length) return { success: false, canceled: true };
        const selected = result.filePaths[0];
        try {
            const valid = await launcherPathResolver.saveManualLauncherPath(platform, selected);
            return { success: true, path: valid, platform };
        } catch (err) {
            return { success: false, message: err.message, code: err.code };
        }
    });
};
