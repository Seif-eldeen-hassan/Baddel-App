'use strict';

// The acceptance fixture loads the real dashboard source without starting Baddel's
// privileged main process. Supply inert API methods so unrelated startup listeners
// do not obscure the focused artwork check.
window.electronAPI = new Proxy({}, {
    get(_target, property) {
        const name = String(property || '');
        if (name.startsWith('on')) return () => () => {};
        if (name === 'getGames') return async () => [];
        if (name === 'getPlaytimeData') return async () => ({});
        if (name === 'getSettings') return async () => ({});
        return async () => null;
    },
});
