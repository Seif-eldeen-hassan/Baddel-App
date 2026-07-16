'use strict';

async function resetGameImage({
    gameId,
    type = 'cover',
    opts = {},
    gamesRepository,
    imageCacheService,
}) {
    const game = gamesRepository.getGameById(gameId);
    if (!game) return { status: 'error', message: 'Game not found' };

    const resetAll = type === 'all' || opts.all === true;

    const resolvedPaths = {};
    if (resetAll || type === 'cover') {
        resolvedPaths.cover = game.defaultImage || imageCacheService.findInCache(gameId, 'cover') || null;
    }
    if (resetAll || type === 'hero') {
        resolvedPaths.hero = game.defaultHero || imageCacheService.findInCache(gameId, 'hero') || null;
    }
    if (resetAll || type === 'logo') {
        resolvedPaths.logo = game.defaultLogo || imageCacheService.findInCache(gameId, 'logo') || null;
    }

    if (typeof gamesRepository.resetGameArtwork === 'function') {
        const types = resetAll ? ['cover', 'hero', 'logo'] : [type];
        return gamesRepository.resetGameArtwork(gameId, {
            types,
            operationId: opts.operationId || null,
            expectedRevisions: opts.expectedRevisions || null,
            updatedAt: opts.updatedAt || Date.now(),
        });
    }

    return gamesRepository.applyImageReset(gameId, resolvedPaths, { type, resetAll });
}

module.exports = { resetGameImage };
