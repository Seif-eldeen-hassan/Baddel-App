'use strict';

// downloadToCache is a no-op stub in the engine (returns url || null).
// Inlined here so no engine reference is needed.
async function resolveCachedUrl(url) {
    return url || null;
}

/**
 * Downloads (or resolves) game artwork URLs, writes them to the DB, re-persists
 * full metadata with local paths, and notifies the renderer.
 *
 * @param {object}        params
 * @param {object}        params.metadata           - Raw metadata object (cover/hero/logo URLs)
 * @param {string}        params.gameId
 * @param {Function|null} [params.notifyCallback]   - Called with updated game after write
 * @param {string}        [params.source]           - Artwork source tag ('pipeline', 'addManual', …)
 * @param {object}        params.gamesRepository    - JsonGameRepository instance
 * @param {object}        params.metadataCacheStore - MetadataCacheStore instance
 */
async function backgroundDownload({
    metadata,
    gameId,
    notifyCallback = null,
    source = 'pipeline',
    gamesRepository,
    metadataCacheStore,
}) {
    try {
        const [cover, hero, logo] = await Promise.all([
            metadata.cover ? resolveCachedUrl(metadata.cover) : null,
            metadata.hero  ? resolveCachedUrl(metadata.hero)  : null,
            metadata.logo  ? resolveCachedUrl(metadata.logo)  : null,
        ]);

        const finalCover = cover || metadata.cover || null;
        const finalHero  = hero  || metadata.heroImage || metadata.hero || null;
        const finalLogo  = logo  || metadata.logo  || null;

        if (finalCover || finalHero || finalLogo) {
            await gamesRepository.updateGameMetadata(gameId, {
                cover: finalCover,
                hero:  finalHero,
                logo:  finalLogo,
            }, { source });

            const game = gamesRepository.getGameById(gameId);
            if (game && metadata) {
                const updatedMeta = {
                    ...metadata,
                    cover:     finalCover,
                    heroImage: finalHero,
                    hero:      finalHero,
                    logo:      finalLogo,
                };
                metadataCacheStore.save(gameId, game.name, game.platform, updatedMeta)
                    .catch(err => console.warn('[Background Download] Failed to re-persist metadata with local paths:', err.message));
            }

            if (notifyCallback) {
                const updatedGame = gamesRepository.getGameById(gameId);
                if (updatedGame) notifyCallback(updatedGame);
            }
        }
    } catch (err) {
        console.error('[Background Download]', err);
    }
}

module.exports = { backgroundDownload };
