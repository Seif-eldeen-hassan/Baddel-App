'use strict';

// Quick Switcher IPC handlers extracted from main.js.
// All behaviour is verbatim — only outer-scope references are threaded through deps.
//
// deps shape:
//   { quickSwitcher, quickSwitcherSettings, accountShortcuts,
//     ipcValidation, switchAccountByPlatform, analytics,
//     getQuickSwitcherInstalledGames, endQuickSwitcherGame }
//
// Note: quickSwitcher.registerQuickSwitcherHotkey() and
// quickSwitcher.createQuickSwitcherWindow() lifecycle calls are NOT moved here —
// they remain in main.js because they are app startup side effects, not IPC handlers.

// Quick Switcher supports one or more modifiers plus a non-modifier key.
// This is intentionally more permissive than the per-account shortcut validator,
// which requires at least two modifiers to reduce accidental captures.
const _QS_MODS    = new Set(['ctrl', 'shift', 'alt', 'super', 'meta']);
const _QS_BLOCKED = new Set([
    'Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+A', 'Ctrl+Z', 'Ctrl+Y',
    'Ctrl+S', 'Ctrl+P', 'Ctrl+W', 'Ctrl+R', 'Ctrl+F', 'Ctrl+T',
    'Ctrl+N', 'Ctrl+Q', 'Alt+F4', 'Alt+Tab', 'F5', 'F11', 'F12',
    'Ctrl+Shift+I', 'Ctrl+Shift+J',
]);

function _validateQSAccelerator(accelerator, accountShortcuts) {
    const norm = accountShortcuts.normalizeAccelerator(accelerator);
    if (!norm) return { valid: false, error: 'Invalid shortcut format.' };
    const parts = norm.split('+');
    const mods  = parts.filter(p => _QS_MODS.has(p.toLowerCase()));
    const keys  = parts.filter(p => !_QS_MODS.has(p.toLowerCase()));
    if (keys.length === 0) return { valid: false, error: 'Shortcut must include a non-modifier key.' };
    if (mods.length < 1)  return { valid: false, error: 'Use at least one modifier key (e.g. Alt+F7, Ctrl+B).' };
    if (_QS_BLOCKED.has(norm)) return { valid: false, error: 'This shortcut is reserved by the system. Try a different combination.' };
    return { valid: true, normalized: norm };
}

module.exports.register = function registerQuickSwitcherHandlers(ipcMain, deps) {
    const {
        quickSwitcher, quickSwitcherSettings, accountShortcuts,
        ipcValidation, switchAccountByPlatform, analytics,
        getQuickSwitcherInstalledGames, endQuickSwitcherGame,
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
            const v = _validateQSAccelerator(accelerator, accountShortcuts);
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
            analytics?.track?.('quick_switcher_hotkey_changed', { feature: 'quick_switcher', result: 'success' }).catch?.(() => {});
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
            return _validateQSAccelerator(accelerator, accountShortcuts);
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
            analytics?.track?.('quick_switcher_switch_attempt', { feature: 'quick_switcher', platform: payload.platform }).catch?.(() => {});
            await switchAccountByPlatform(payload.platform, payload.accountId);
            analytics?.track?.('quick_switcher_switch_success', { feature: 'quick_switcher', platform: payload.platform }).catch?.(() => {});
            return { status: 'ok' };
        } catch (err) {
            analytics?.track?.('quick_switcher_switch_failed', { feature: 'quick_switcher', platform: payload?.platform, error_code: err }).catch?.(() => {});
            return ipcValidation.sanitizeErrorForRenderer(err, 'Account switch failed.');
        }
    });

    ipcMain.handle('quick-switcher:list-games', async () => {
        try {
            return typeof getQuickSwitcherInstalledGames === 'function'
                ? await getQuickSwitcherInstalledGames()
                : [];
        } catch (err) {
            return ipcValidation.sanitizeErrorForRenderer(err, 'Could not load installed games.');
        }
    });

    ipcMain.handle('quick-switcher:end-game', async (_, payload) => {
        try {
            ipcValidation.assertString(payload?.gameId, 'gameId', 256);
            analytics?.track?.('quick_switcher_end_game_attempt', { feature: 'quick_switcher' }).catch?.(() => {});
            const result = typeof endQuickSwitcherGame === 'function'
                ? await endQuickSwitcherGame(payload.gameId)
                : { status: 'error', message: 'End task is not available.' };
            analytics?.track?.('quick_switcher_end_game_result', { feature: 'quick_switcher', status: result?.status || 'unknown' }).catch?.(() => {});
            return result;
        } catch (err) {
            return ipcValidation.sanitizeErrorForRenderer(err, 'Could not end game.');
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
