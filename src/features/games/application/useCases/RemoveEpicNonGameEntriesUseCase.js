'use strict';

async function removeEpicNonGameEntries({
    badEntries,
    gamesRepository,
    imageCacheService,
    saveDatabase,
    epicEntryPolicy,
}) {
    if (!Array.isArray(badEntries) || badEntries.length === 0) return { removed: 0 };

    const normalize = v => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    const badAppNames = new Set(
        badEntries.map(e => normalize(e?.app_name)).filter(Boolean)
    );
    const badTitles = new Set(
        badEntries.map(e => normalize(e?.app_title || e?.title)).filter(Boolean)
    );

    const removed = [];

    for (const game of gamesRepository.getAllGames()) {
        const isEpic = game.platform === 'epic' || game.source === 'epic';
        if (!isEpic) continue;

        const gameAppName = normalize(game.appName || game.app_name);
        const gameTitle   = normalize(game.title || game.name);
        const gameId      = normalize(game.id);

        if ((gameAppName && badAppNames.has(gameAppName)) ||
            (gameTitle   && badTitles.has(gameTitle))     ||
            (gameId      && badAppNames.has(gameId))      ||
            !epicEntryPolicy.isEpicSyncedGameAllowed(game)) {
            removed.push(game.id);
        }
    }

    if (removed.length > 0) {
        gamesRepository.deleteGamesByIds(removed);
        removed.forEach(id => imageCacheService.deleteGameImages(id));
        saveDatabase();
        console.log(`[GameScanner] Removed ${removed.length} Epic non-game entries:`, removed);
    }

    return { removed: removed.length, ids: removed };
}

module.exports = { removeEpicNonGameEntries };
