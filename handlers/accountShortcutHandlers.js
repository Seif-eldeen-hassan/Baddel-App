'use strict';

function _trackShortcutSetting(analytics, params, enabled, result, error) {
    analytics?.track?.('settings_changed', {
        feature: 'account_shortcuts', setting: 'shortcut', enabled, result,
        platform: params?.platform, ...(error ? { error_code: error } : {}),
    }).catch?.(() => {});
}

async function _setShortcutWithAnalytics(accountShortcuts, analytics, params) {
    try {
        const result = await accountShortcuts.setShortcut(params);
        _trackShortcutSetting(analytics, params, true, 'success');
        return result;
    } catch (error) {
        _trackShortcutSetting(analytics, params, true, 'failed', error);
        throw error;
    }
}

// Account-shortcuts IPC handlers extracted from main.js.
// All behaviour is verbatim — only outer-scope references are threaded through deps.
//
// deps shape: { accountShortcuts }
//
// Note: accountShortcuts.registerAll / unregisterAll lifecycle calls are NOT
// moved here — they remain in main.js because they are app lifecycle hooks,
// not IPC handler registrations.

module.exports.register = function registerAccountShortcutHandlers(ipcMain, deps) {
    const { accountShortcuts, analytics } = deps;

    // ── Account Shortcuts IPC ──────────────────────────────────────────────
    ipcMain.handle('account-shortcuts:list', async () => {
        try { return await accountShortcuts.getAll(); }
        catch (err) { return { status: 'error', message: err.message }; }
    });
    ipcMain.handle('account-shortcuts:set', async (_, params) => {
        try { return await _setShortcutWithAnalytics(accountShortcuts, analytics, params); }
        catch (err) { return { status: 'error', message: err.message }; }
    });
    ipcMain.handle('account-shortcuts:clear', async (_, params) => {
        try {
            const result = await accountShortcuts.clearShortcut(params);
            _trackShortcutSetting(analytics, params, false, 'success');
            return result;
        } catch (err) {
            _trackShortcutSetting(analytics, params, false, 'failed', err);
            return { status: 'error', message: err.message };
        }
    });
    ipcMain.handle('account-shortcuts:validate', (_, accelerator) => {
        return accountShortcuts.validateAccelerator(accelerator);
    });
};
