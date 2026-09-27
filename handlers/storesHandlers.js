'use strict';

const { normalizeProvider } = require('../services/storesViewManager');

function registerStoresHandlers(ipcMain, { getManager, getMainWindow, clipboard }) {
    const trusted = event => event.sender === getMainWindow()?.webContents;
    const handle = (channel, fn) => ipcMain.handle(channel, async (event, ...args) => {
        if (!trusted(event)) throw Object.assign(new Error('Untrusted Stores request.'), { code: 'STORES_SENDER_INVALID' });
        return fn(...args);
    });
    handle('stores:open', provider => getManager().open(provider));
    handle('stores:command', command => {
        if (!['back', 'forward', 'reload', 'stop', 'home'].includes(command)) throw Object.assign(new Error('Invalid Stores command.'), { code: 'STORES_COMMAND_INVALID' });
        return getManager().command(command);
    });
    handle('stores:open-external', () => getManager().openExternal());
    handle('stores:copy-url', expected => {
        const result = getManager().copyCurrentUrl(expected);
        if (!result.ok) return result;
        try {
            clipboard.writeText(result.url);
            return result;
        } catch {
            return { ok: false, error: 'clipboard_unavailable' };
        }
    });
    handle('stores:set-bounds', bounds => getManager().setBounds(bounds));
    handle('stores:set-visible', visible => {
        if (typeof visible !== 'boolean') throw Object.assign(new Error('Invalid Stores visibility.'), { code: 'STORES_VISIBILITY_INVALID' });
        return getManager().setVisible(visible);
    });
}

module.exports = { registerStoresHandlers };
