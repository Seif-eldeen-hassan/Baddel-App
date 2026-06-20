'use strict';

/**
 * Permanently deletes a game: removes it from the DB, clears cached images,
 * clears MRM state, and evicts the metadata cache entry.
 *
 * @param {object}   params
 * @param {string}   params.gameId
 * @param {object}   params.gamesRepository           - JsonGameRepository instance
 * @param {object}   params.imageCacheService          - ImageCacheService instance
 * @param {object}   params.metadataResolutionManager  - MetadataResolutionManager instance
 * @param {object}   params.metadataCacheStore         - MetadataCacheStore instance
 * @param {Function} params.saveDatabase               - () => void — triggers DB flush
 * @returns {Promise<{status: string, message?: string}>}
 */
async function deleteGamePermanently({
    gameId,
    gamesRepository,
    imageCacheService,
    metadataResolutionManager,
    metadataCacheStore,
    saveDatabase,
}) {
    const removedCount = gamesRepository.deleteGameById(gameId);
    if (removedCount > 0) {
        imageCacheService.deleteGameImages(gameId);
        try { metadataResolutionManager.clearJob(gameId); } catch (_) {}
        try { await metadataCacheStore.deleteEntry(gameId); } catch (_) {}
        saveDatabase();
        return { status: 'success' };
    }
    return { status: 'error', message: 'Game not found' };
}

module.exports = { deleteGamePermanently };
