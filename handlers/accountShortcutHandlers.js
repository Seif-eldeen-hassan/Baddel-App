'use strict';

// Account-shortcuts IPC handlers extracted from main.js.
// All behaviour is verbatim — only outer-scope references are threaded through deps.
//
// deps shape: { accountShortcuts }
//
// Note: accountShortcuts.registerAll / unregisterAll lifecycle calls are NOT
// moved here — they remain in main.js because they are app lifecycle hooks,
// not IPC handler registrations.

module.exports.register = function registerAccountShortcutHandlers(ipcMain, deps) {
    const { accountShortcuts } = deps;

    // ── Account Shortcuts IPC ──────────────────────────────────────────────
    ipcMain.handle('account-shortcuts:list', async () => {
        try { return await accountShortcuts.getAll(); }
        catch (err) { return { status: 'error', message: err.message }; }
    });
    ipcMain.handle('account-shortcuts:set', async (_, params) => {
        try { return await accountShortcuts.setShortcut(params); }
        catch (err) { return { status: 'error', message: err.message }; }
    });
    ipcMain.handle('account-shortcuts:clear', async (_, params) => {
        try { return await accountShortcuts.clearShortcut(params); }
        catch (err) { return { status: 'error', message: err.message }; }
    });
    ipcMain.handle('account-shortcuts:validate', (_, accelerator) => {
        return accountShortcuts.validateAccelerator(accelerator);
    });
};
