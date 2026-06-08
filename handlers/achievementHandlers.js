'use strict';

// Achievements IPC handlers extracted from main.js.
// All behaviour is verbatim — only outer-scope references are threaded through deps.
//
// deps shape: {
//   _extractSteamAppId,       ← pure helper: extracts Steam app ID from payload hints
//   _enqueueAchievementFetch, ← serialises concurrent achievement fetches (one at a time)
//   _fetchAchievementsForApp, ← full Steam bridge achievement fetch logic
// }
//
// Intentionally NOT moved here:
//   launch-game               — launch domain
//   update-playtime / playtime handlers — playtime domain
//   Steam account switching   — account domain
//   get-game-metadata / MRM   — metadata pipeline
//   platform sync handlers    — platform sync domain
//   _achievementIpcChain      — module-level Promise state that lives in main.js; threaded
//                               indirectly through _enqueueAchievementFetch

module.exports.register = function registerAchievementHandlers(ipcMain, deps) {
    const { _extractSteamAppId, _enqueueAchievementFetch, _fetchAchievementsForApp } = deps;

    ipcMain.handle('get-game-achievements', async (_, payload = {}) => {
        try {
            const appId = payload.appId || _extractSteamAppId(payload.gameName || '', payload);
            return await _enqueueAchievementFetch(() => _fetchAchievementsForApp({ ...payload, appId }));
        } catch (err) {
            return { status: 'error', message: err?.message || 'Failed to load achievements' };
        }
    });
};
