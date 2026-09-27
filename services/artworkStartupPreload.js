'use strict';
function createArtworkInvoke(ipcRenderer, enabled = process.env.BADDEL_ARTWORK_STARTUP_TRACE === '1') {
    let sequence = 0;
    const started = Date.now();
    const emit = payload => { try { ipcRenderer.send('artwork-startup-trace:preload', payload); } catch {} };
    return (channel, ...args) => {
        if (!enabled || Date.now() - started > 120000) return ipcRenderer.invoke(channel, ...args);
        const id = ++sequence;
        const at = Date.now();
        emit({ channel, stage: 'invoke', id, at, count: Array.isArray(args[0]) ? args[0].length : 0 });
        return ipcRenderer.invoke(channel, ...args).then(result => {
            emit({ channel, stage: 'resolved', id, at: Date.now(), durationMs: Date.now() - at });
            return result;
        }, error => {
            emit({ channel, stage: 'rejected', id, at: Date.now(), durationMs: Date.now() - at });
            throw error;
        });
    };
}
module.exports = { createArtworkInvoke };
