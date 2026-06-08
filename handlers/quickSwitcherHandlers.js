'use strict';

// Quick Switcher IPC handlers extracted from main.js.
// All behaviour is verbatim — only outer-scope references are threaded through deps.
//
// deps shape:
//   { quickSwitcher, quickSwitcherSettings, accountShortcuts,
//     ipcValidation, switchAccountByPlatform, analytics }
//
// Note: quickSwitcher.registerQuickSwitcherHotkey() and
// quickSwitcher.createQuickSwitcherWindow() lifecycle calls are NOT moved here —
// they remain in main.js because they are app startup side effects, not IPC handlers.

module.exports.register = function registerQuickSwitcherHandlers(ipcMain, deps) {
    const {
        quickSwitcher, quickSwitcherSettings, accountShortcuts,
        ipcValidation, switchAccountByPlatform, analytics,
    } = deps;

    // ── Quick Switcher IPC ─────────────────────────────────────────────────
    ipcMain.handle('quick-switcher:get-settings', async () => {
        try { return await quickSwitcherSettings.load(); }
        catch (err) { return ipcValidation.sanitizeErrorForRenderer(err, 'Could not load settings.'); }
    });

    ipcMain.handle('quick-switcher:set-settings', async (_, payload) => {
        try {
            if (payload && typeof payload !== 'object') throw new Error('Invalid payload.');
            const saved = await quickSwitcherSettings.save(payload || {});
            // Re-register hotkey if enabled state or accelerator changed.
            if ('enabled' in payload || 'accelerator' in payload) {
                await quickSwitcher.registerQuickSwitcherHotkey();
            }
            return { status: 'ok', settings: saved };
        } catch (err) { return ipcValidation.sanitizeErrorForRenderer(err, 'Could not save settings.'); }
    });

    ipcMain.handle('quick-switcher:set-hotkey', async (_, accelerator) => {
        try {
            ipcValidation.assertString(accelerator, 'accelerator', 64);
            // Validate via Phase 1 accountShortcuts validator.
            const v = accountShortcuts.validateAccelerator(accelerator);
            if (!v.valid) return { status: 'error', message: v.error };
            const norm = v.normalized;

            // Conflict with Phase 1 per-account shortcuts?
            const allShortcuts = await accountShortcuts.getAll();
            const conflict = allShortcuts?.shortcuts?.find(sc => sc.accelerator === norm);
            if (conflict) {
                return { status: 'error', message: `Conflicts with shortcut for ${conflict.accountName}.` };
            }

            // Try to register; if it fails, OS already has it.
            quickSwitcher.unregisterQuickSwitcherHotkey();
            const ok = await quickSwitcher.registerQuickSwitcherHotkey();
            // registerQuickSwitcherHotkey reads settings; save first so it uses the new value.
            await quickSwitcherSettings.save({ accelerator: norm });
            const ok2 = await quickSwitcher.registerQuickSwitcherHotkey();
            if (!ok2) {
                // Restore previous hotkey.
                await quickSwitcher.registerQuickSwitcherHotkey();
                return { status: 'error', message: 'That shortcut is already in use by another application.' };
            }
            try { analytics.track('quick_switcher_hotkey_changed'); } catch {}
            return { status: 'ok', accelerator: norm };
        } catch (err) { return ipcValidation.sanitizeErrorForRenderer(err, 'Could not set hotkey.'); }
    });

    ipcMain.handle('quick-switcher:clear-hotkey', async () => {
        try {
            quickSwitcher.unregisterQuickSwitcherHotkey();
            await quickSwitcherSettings.save({ accelerator: null });
            return { status: 'ok' };
        } catch (err) { return ipcValidation.sanitizeErrorForRenderer(err, 'Could not clear hotkey.'); }
    });

    ipcMain.handle('quick-switcher:validate-hotkey', (_, accelerator) => {
        try {
            ipcValidation.assertString(accelerator, 'accelerator', 64);
            return accountShortcuts.validateAccelerator(accelerator);
        } catch (err) { return { valid: false, error: err.message }; }
    });

    ipcMain.handle('quick-switcher:list-accounts', async () => {
        try { return await quickSwitcher.getQuickSwitcherAccounts(); }
        catch (err) { return ipcValidation.sanitizeErrorForRenderer(err, 'Could not load accounts.'); }
    });

    ipcMain.handle('quick-switcher:switch-account', async (_, payload) => {
        try {
            ipcValidation.assertString(payload?.platform, 'platform', 20);
            ipcValidation.assertPlatform(payload?.platform, 'platform');
            ipcValidation.assertString(payload?.accountId, 'accountId', 256);
            try { analytics.track('quick_switcher_switch_attempt', { platform: payload.platform }); } catch {}
            await switchAccountByPlatform(payload.platform, payload.accountId);
            try { analytics.track('quick_switcher_switch_success', { platform: payload.platform }); } catch {}
            return { status: 'ok' };
        } catch (err) {
            try { analytics.track('quick_switcher_switch_failed', { platform: payload?.platform }); } catch {}
            return ipcValidation.sanitizeErrorForRenderer(err, 'Account switch failed.');
        }
    });

    ipcMain.handle('quick-switcher:hide', () => {
        quickSwitcher.hideQuickSwitcherOverlay();
        return { status: 'ok' };
    });

    ipcMain.handle('quick-switcher:toggle', async () => {
        try { await quickSwitcher.toggleQuickSwitcherOverlay(); return { status: 'ok' }; }
        catch (err) { return ipcValidation.sanitizeErrorForRenderer(err, 'Could not toggle overlay.'); }
    });
};
