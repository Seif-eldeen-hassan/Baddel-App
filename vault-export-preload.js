'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vaultExportAPI', Object.freeze({
    getSnapshot: () => ipcRenderer.invoke('vault-showcase:renderer-snapshot'),
}));
