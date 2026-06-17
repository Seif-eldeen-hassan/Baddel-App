'use strict';

// Pure and semi-pure playtime utilities, extracted from app.js.
// Stateful functions accept a deps object so they have no hidden
// dependency on app.js lexical variables.
//
// IMPORTANT: Internal function names use the baddelPlaytime* prefix to avoid
// name collisions when all renderer scripts are concatenated into a single
// bundle.  app.js defines same-named wrappers (formatPlaytime, etc.) — if
// both the wrapper and this implementation used the identical function name,
// JavaScript hoisting would let the wrapper declaration win and cause infinite
// recursion when the namespace is captured below.  The prefix makes the names
// distinct so window.BaddelPlaytime always points to this file's implementations.

function baddelPlaytimeFormat(minutes) {
    if (!minutes) return '0h 0m';
    if (minutes < 60) return `${minutes}m`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function baddelPlaytimeFormatLastPlayed(timestamp) {
    if (!timestamp) return 'Never';
    const date = new Date(timestamp);
    const now = new Date();
    const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
}

// Returns a fresh cache object — does not mutate any outer state.
// Caller (app.js wrapper) assigns the result to playtimeData.
function baddelPlaytimeBuildCache(games) {
    const cache = {};
    games.forEach(g => {
        if (g.totalPlaytime || g.lastPlayed || g.playSessions) {
            cache[g.id] = {
                totalMinutes:        g.totalPlaytime        || 0,
                lastPlayed:          g.lastPlayed           || null,
                lastQualifiedPlayed: g.lastQualifiedPlayed  || null,
                playSessions:        g.playSessions         || [],
                timeTrackingEnabled: g.timeTrackingEnabled !== false,
            };
        }
    });
    return cache;
}

// deps: { playtimeData, allGamesData }
// Both are app.js-owned arrays/objects passed by reference; mutations are
// visible to the caller because only properties are written, not reassigned.
async function baddelPlaytimeSave({ playtimeData, allGamesData }, gameId, playedMinutes) {
    try {
        const result = await window.electronAPI.updatePlaytime(gameId, playedMinutes);
        if (result && result.status === 'success') {
            if (!playtimeData[gameId]) playtimeData[gameId] = { totalMinutes: 0, lastPlayed: null };
            playtimeData[gameId].totalMinutes = result.totalPlaytime;
            playtimeData[gameId].lastPlayed = result.lastPlayed;

            const gameIndex = allGamesData.findIndex(g => String(g.id) === String(gameId));
            if (gameIndex > -1) {
                allGamesData[gameIndex].totalPlaytime = result.totalPlaytime;
                allGamesData[gameIndex].lastPlayed = result.lastPlayed;
            }
        }
    } catch (e) {
        console.error('Failed to save playtime:', e);
    }
}

// deps: { playtimeData }
async function baddelPlaytimeMigrate({ playtimeData }) {
    const migrationDone = localStorage.getItem('baddel_playtime_migrated');
    if (migrationDone) return;

    const oldData = JSON.parse(localStorage.getItem('baddel_playtime') || '{}');
    const entries = Object.entries(oldData);
    if (entries.length === 0) {
        localStorage.setItem('baddel_playtime_migrated', '1');
        return;
    }

    for (const [gameId, data] of entries) {
        try {
            await window.electronAPI.updatePlaytime(gameId, data.totalMinutes || 0);
            playtimeData[gameId] = { totalMinutes: data.totalMinutes || 0, lastPlayed: data.lastPlayed || null };
        } catch { /* skip failed games */ }
    }

    localStorage.setItem('baddel_playtime_migrated', '1');
}

window.BaddelPlaytime = {
    formatPlaytime:               baddelPlaytimeFormat,
    formatLastPlayed:             baddelPlaytimeFormatLastPlayed,
    buildPlaytimeCache:           baddelPlaytimeBuildCache,
    savePlaytimeData:             baddelPlaytimeSave,
    migratePlaytimeFromLocalStorage: baddelPlaytimeMigrate,
};
