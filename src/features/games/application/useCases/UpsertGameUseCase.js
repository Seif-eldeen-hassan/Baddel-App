'use strict';

/**
 * Inserts or updates a game record in the database.
 *
 * On INSERT: recovers cached artwork from disk if the incoming game object
 * carries no image fields (protects against DB-wipe data loss).
 * On UPDATE: skips cache lookup — the existing record already has its images.
 *
 * Mutates the incoming game object: stamps game.id and game.installedGameKey
 * if they are absent. This mutation is intentional and tested behavior.
 *
 * @param {object}   params
 * @param {object}   params.game                  - Game object to insert or update.
 * @param {object}   params.gamesRepository       - JsonGameRepository instance.
 * @param {Function} params.findInCache            - (gameId, type) => string|null
 * @param {Function} params.makeInstalledGameKey   - (game) => string
 */
function upsertGame({ game, gamesRepository, findInCache, makeInstalledGameKey }) {
    if (!game.id) game.id = gamesRepository.generateStableId(game);
    game.installedGameKey = game.installedGameKey || makeInstalledGameKey(game);

    const willUpdate = gamesRepository.hasUpsertMatch(game);

    const cachedCover = willUpdate ? null : (game.image     || findInCache(game.id, 'cover'));
    const cachedHero  = willUpdate ? null : (game.heroImage || findInCache(game.id, 'hero'));
    const cachedLogo  = willUpdate ? null : (game.logo      || findInCache(game.id, 'logo'));

    gamesRepository.upsertGameRecord(game, { cachedCover, cachedHero, cachedLogo });
}

module.exports = { upsertGame };
