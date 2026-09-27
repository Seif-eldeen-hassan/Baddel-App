'use strict';

const Module = require('module');
const path = require('path');

const bundlePath = path.resolve(process.argv[2]);
const exposed = {};
const invokes = [];
const listeners = [];
const ipcRenderer = {
    sendSync() { return null; },
    send() {},
    invoke(...args) { invokes.push(args); return Promise.resolve({ ok: true }); },
    on(channel, callback) { listeners.push({ channel, callback }); return this; },
    once(channel, callback) { listeners.push({ channel, callback }); return this; },
    removeListener() { return this; },
    removeAllListeners() { return this; },
};
const electron = {
    contextBridge: { exposeInMainWorld(name, value) { exposed[name] = value; } },
    ipcRenderer,
    webUtils: { getPathForFile() { return ''; } },
    shell: { openExternal() { return Promise.resolve(); } },
};
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') return electron;
    return originalLoad.call(this, request, parent, isMain);
};

(async () => {
    try {
        require(bundlePath);
        const api = exposed.electronAPI || {};
        await api.platformSyncRefreshEpicPurchaseHistory?.('account-a', {
            allowInteractiveLogin: true,
            operationId: 'operation-fingerprint-1',
        });
        for (const method of [
            'saveEpicAccount', 'saveGogAccount', 'saveEAAccount', 'saveRiotAccount',
            'saveUbisoftAccount', 'saveDiscordAccount', 'saveRockstarAccount',
        ]) {
            await api[method]?.('boundary-name');
        }
        const refreshInvoke = invokes.find((entry) => entry[0] === 'platform-sync:refresh-epic-purchase-history');
        process.stdout.write(JSON.stringify({
            apiNames: Object.keys(api).sort(),
            refreshInvoke,
            saveInvokes: invokes.filter((entry) => String(entry[0]).startsWith('save-')),
            listenerChannels: listeners.map((entry) => entry.channel),
        }));
    } finally {
        Module._load = originalLoad;
    }
})().catch((error) => {
    console.error(error?.stack || error);
    process.exit(1);
});
