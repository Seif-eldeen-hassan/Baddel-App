'use strict';

const fsSync = require('fs');

/**
 * Re-fetches cover images for stored games that are missing a local cached file.
 * Skips hidden games and games with customArtworkLocked.
 *
 * @param {object}        deps
 * @param {object}        deps.engine           - BaddelEngine instance
 * @param {object}        deps.baddelApi        - Baddel API client
 * @param {Function|null} [deps.notifyCallback] - Called by backgroundDownload after each download
 */
async function refetchMissingImages({ engine, baddelApi, notifyCallback = null }) {
    let updated = false;

    for (const game of engine.getStoredGames()) {
        if (!game.isHidden && !game.customArtworkLocked) {
            let isMissing = false;

            if (game.image && game.image.startsWith('file://')) {
                try {
                    const cleanPath = decodeURI(game.image.replace('file://', ''));
                    if (!fsSync.existsSync(cleanPath)) isMissing = true;
                } catch (e) { isMissing = true; }
            } else if (!game.image) {
                isMissing = true;
            }

            if (isMissing) {
                try {
                    // Try to fetch from Baddel metadata server by title
                    const meta = await baddelApi.lookupGame({ title: game.name });
                    if (meta && meta.images) {
                        const coverImg = meta.images.find(i => i.image_type === 'cover');
                        if (coverImg) {
                            const coverUrl = coverImg.cdn_url || coverImg.url;
                            if (coverUrl) {
                                await engine.backgroundDownload({ cover: coverUrl }, game.id, notifyCallback, { source: 'pipeline' });
                                updated = true;
                            }
                        }
                    }
                } catch (e) { /* skip */ }
            }
        }
    }
    if (updated) engine.saveDatabase();
}

module.exports = { refetchMissingImages };
