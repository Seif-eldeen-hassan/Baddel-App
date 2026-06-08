'use strict';

// Simple playtime IPC handlers extracted from main.js.
// All behaviour is verbatim — only outer-scope references are threaded through deps.
//
// deps shape: {
//   updatePlaytime,          ← gameScanner.updatePlaytime
//   setTimeTrackingEnabled,  ← gameScanner.setTimeTrackingEnabled
//   getTimeTrackingEnabled,  ← gameScanner.getTimeTrackingEnabled
//   activeTrackers,          ← module-level object in main.js (passed by reference)
// }
//
// Intentionally NOT moved here:
//   isGameRunning             — process-monitoring domain
//   activeTrackers object     — stays in main.js; only a reference is passed here
//   process scanning / ps-list loops — live process monitoring
//   launch-game               — launch domain
//   game runtime tracking     — launch / tracker lifecycle
//   fuzzy process matching    — _safeFuzzyGameNameMatch, playtimeShared helpers

module.exports.register = function registerPlaytimeHandlers(ipcMain, deps) {
    const { updatePlaytime, setTimeTrackingEnabled, getTimeTrackingEnabled, activeTrackers } = deps;

    ipcMain.handle('update-playtime', (_, id, mins) => updatePlaytime(id, mins));

    ipcMain.handle('set-time-tracking-enabled', async (_, gameId, enabled) => {
        try {
            if (typeof setTimeTrackingEnabled !== 'function') {
                console.error('[Playtime] setTimeTrackingEnabled missing from gameScanner exports');
                return { status: 'error', error: 'Time tracking API unavailable' };
            }
            const result = await setTimeTrackingEnabled(String(gameId), !!enabled);
            if (!enabled) {
                const gid = String(gameId);
                if (activeTrackers[gid]) {
                    const tracker = activeTrackers[gid];
                    if (tracker.intervalId) clearInterval(tracker.intervalId);
                    delete activeTrackers[gid];
                    console.log(`[Playtime] tracking disabled mid-session for game: ${gid}`);
                }
            }
            return result;
        } catch (err) {
            console.error('[Playtime] set-time-tracking-enabled error:', err.message);
            return { status: 'error', error: err.message };
        }
    });

    ipcMain.handle('get-time-tracking-enabled', (_, gameId) => {
        try {
            if (typeof getTimeTrackingEnabled !== 'function') {
                console.error('[Playtime] getTimeTrackingEnabled missing from gameScanner exports');
                return { status: 'error', error: 'Time tracking API unavailable' };
            }
            return getTimeTrackingEnabled(String(gameId));
        } catch (err) {
            return { status: 'error', error: err.message };
        }
    });
};
