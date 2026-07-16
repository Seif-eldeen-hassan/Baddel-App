'use strict';

const IGDB_SIZE_BY_TYPE = Object.freeze({
    cover: 't_cover_big',
    hero: 't_screenshot_big',
    logo: 't_logo_med',
});

function optimizeArtworkSourceUrl(sourceUrl, { type = null } = {}) {
    const raw = String(sourceUrl || '');
    if (!raw || raw.startsWith('file://') || raw.startsWith('data:') || raw.startsWith('assets/')) return raw || null;

    let parsed;
    try {
        parsed = new URL(raw);
    } catch {
        return raw;
    }

    const host = parsed.hostname.toLowerCase();
    if (host === 'images.igdb.com' && parsed.pathname.includes('/igdb/image/upload/')) {
        const size = IGDB_SIZE_BY_TYPE[String(type || '').toLowerCase()];
        if (size) {
            parsed.pathname = parsed.pathname.replace(
                /\/igdb\/image\/upload\/t_[^/]+\//,
                `/igdb/image/upload/${size}/`
            );
            return parsed.href;
        }
    }

    return raw;
}

module.exports = {
    optimizeArtworkSourceUrl,
    IGDB_SIZE_BY_TYPE,
};
