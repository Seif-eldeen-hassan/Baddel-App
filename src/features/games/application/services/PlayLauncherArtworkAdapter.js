'use strict';

;(function () {
const _playLauncherArtworkRoot = typeof window !== 'undefined' ? window : globalThis;
const _gameArtworkResolver = (typeof require === 'function')
    ? require('./GameArtworkResolver')
    : _playLauncherArtworkRoot.BaddelGameArtworkResolver;

const { resolveGameArtwork } = _gameArtworkResolver;

const COVER_ALIASES = Object.freeze(['image', 'cover', 'coverUrl', 'defaultImage', 'posterImage', 'coverImage']);
const HERO_ALIASES = Object.freeze(['heroImage', 'hero', 'heroUrl', 'defaultHero', 'background', 'backgroundUrl']);
const LOGO_ALIASES = Object.freeze(['logo', 'logoUrl', 'defaultLogo', 'logoImage']);

const LEGACY_PLAY_LAUNCHER_ORDER = Object.freeze({
    cover: Object.freeze(['image', 'cover', 'coverUrl', 'defaultImage', 'posterImage', 'coverImage']),
    hero: Object.freeze([
        'heroImage',
        'hero',
        'defaultHero',
        'background',
        'heroUrl',
        'backgroundUrl',
        'image',
        'cover',
        'coverUrl',
        'defaultImage',
    ]),
    logo: Object.freeze(['logo', 'defaultLogo', 'logoUrl', 'logoImage']),
});

function _hasValue(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function _first(obj = {}, keys = []) {
    for (const key of keys) {
        if (_hasValue(obj?.[key])) return obj[key];
    }
    return null;
}

function _typeValue(payload, type) {
    if (!payload || typeof payload !== 'object') return null;
    if (payload[type] && typeof payload[type] === 'object' && !Array.isArray(payload[type])) {
        return _hasValue(payload[type].value) ? payload[type].value : null;
    }
    if (_hasValue(payload[type])) return payload[type];
    return _first(payload, LEGACY_PLAY_LAUNCHER_ORDER[type] || []);
}

function _candidate(type, value, extra = {}) {
    if (!_hasValue(value)) return null;
    return {
        [type]: {
            value,
            updatedAt: extra.updatedAt || null,
            locked: extra.locked === true,
            verified: extra.verified === true,
            confidence: extra.confidence ?? null,
            identity: extra.identity || null,
            representsSource: extra.representsSource || null,
        },
        updatedAt: extra.updatedAt || null,
        locked: extra.locked === true,
        verified: extra.verified === true,
        confidence: extra.confidence ?? null,
        identity: extra.identity || null,
        representsSource: extra.representsSource || null,
    };
}

function explicitSettingsArtworkFromGame(game = {}) {
    if (!(game.customArtworkLocked === true && game.artworkSource === 'settings')) return null;
    const updatedAt = game.artworkUpdatedAt || null;
    return {
        ...(_candidate('cover', _first(game, COVER_ALIASES), { updatedAt, locked: true }) || {}),
        ...(_candidate('hero', _first(game, HERO_ALIASES), { updatedAt, locked: true }) || {}),
        ...(_candidate('logo', _first(game, LOGO_ALIASES), { updatedAt, locked: true }) || {}),
    };
}

function creatorArtworkFromCustomDetails(custom = {}) {
    if (!custom || typeof custom !== 'object') return null;
    const logo = custom.logoMode === 'text' ? null : _first(custom, LOGO_ALIASES);
    return {
        ...(_candidate('cover', _first(custom, COVER_ALIASES), { locked: true }) || {}),
        ...(_candidate('hero', _first(custom, HERO_ALIASES), { locked: true }) || {}),
        ...(_candidate('logo', logo, { locked: true }) || {}),
    };
}

function legacyPlayLauncherArtwork({ game = {}, fullMeta = {}, cacheArtwork = {}, placeholders = null } = {}) {
    const meta = fullMeta || {};
    const cache = cacheArtwork || {};
    const cover = _first(game, LEGACY_PLAY_LAUNCHER_ORDER.cover)
        || _typeValue(meta, 'cover')
        || _typeValue(cache, 'cover')
        || _typeValue(placeholders, 'cover');

    const hero = _first(game, ['heroImage', 'hero', 'defaultHero', 'background'])
        || _first(meta, ['heroImage', 'hero', 'defaultHero', 'background'])
        || _first(meta?.assets, ['hero', 'heroImage'])
        || _typeValue(cache, 'hero')
        || _typeValue(cache, 'cover')
        || cover
        || _typeValue(placeholders, 'hero');

    const logo = _first(game, ['logo', 'defaultLogo'])
        || _first(meta, ['logo', 'defaultLogo'])
        || _first(meta?.assets, ['logo'])
        || _typeValue(cache, 'logo')
        || _typeValue(placeholders, 'logo');

    const out = {};
    for (const [type, value] of Object.entries({ cover, hero, logo })) {
        out[type] = Object.freeze({
            value: value || null,
            type,
            source: value ? 'legacy-fallback' : 'placeholder',
            reason: value ? 'legacy Play Launcher artwork fallback' : 'no Play Launcher artwork candidate',
            usedFallback: true,
        });
    }
    return Object.freeze(out);
}

function _metadataArtworkFromFullMeta(fullMeta = {}) {
    if (!fullMeta || typeof fullMeta !== 'object') return null;
    return {
        ...(_candidate('cover', _first(fullMeta, ['cover', 'image', 'posterImage', 'coverImage']), {
            verified: fullMeta.verified === true,
            confidence: fullMeta.confidence ?? null,
        }) || {}),
        ...(_candidate('hero', _first(fullMeta, ['heroImage', 'hero', 'heroUrl', 'defaultHero', 'background', 'backgroundUrl']) || _first(fullMeta.assets, ['hero', 'heroImage']), {
            verified: fullMeta.verified === true,
            confidence: fullMeta.confidence ?? null,
        }) || {}),
        ...(_candidate('logo', _first(fullMeta, ['logo', 'logoUrl', 'defaultLogo', 'logoImage']) || _first(fullMeta.assets, ['logo']), {
            verified: fullMeta.verified === true,
            confidence: fullMeta.confidence ?? null,
        }) || {}),
    };
}

function _safeResolve(input) {
    try {
        return resolveGameArtwork(input);
    } catch {
        return null;
    }
}

function _validResultItem(item) {
    return item && typeof item === 'object' && _hasValue(item.value);
}

function resolvePlayLauncherArtwork({
    game = {},
    settingsArtwork = null,
    creatorArtwork = null,
    platformArtwork = null,
    metadataArtwork = null,
    cacheArtwork = null,
    placeholders = null,
    fullMeta = null,
    resolver = _safeResolve,
} = {}) {
    const fallback = legacyPlayLauncherArtwork({ game, fullMeta: fullMeta || metadataArtwork, cacheArtwork, placeholders });
    let resolved = null;
    try {
        resolved = resolver({
            game,
            settingsArtwork: settingsArtwork || explicitSettingsArtworkFromGame(game),
            creatorArtwork,
            platformArtwork,
            metadataArtwork: metadataArtwork || _metadataArtworkFromFullMeta(fullMeta),
            cacheArtwork,
            placeholders,
        });
    } catch {
        resolved = null;
    }

    const output = {};
    for (const type of ['cover', 'hero', 'logo']) {
        const item = resolved?.[type];
        output[type] = _validResultItem(item)
            ? Object.freeze({ ...item, usedFallback: false, fallbackValue: fallback[type].value })
            : fallback[type];
    }
    return Object.freeze(output);
}

const PlayLauncherArtworkAdapter = {
    COVER_ALIASES,
    HERO_ALIASES,
    LOGO_ALIASES,
    LEGACY_PLAY_LAUNCHER_ORDER,
    creatorArtworkFromCustomDetails,
    explicitSettingsArtworkFromGame,
    legacyPlayLauncherArtwork,
    resolvePlayLauncherArtwork,
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = PlayLauncherArtworkAdapter;
}

if (_playLauncherArtworkRoot) {
    _playLauncherArtworkRoot.BaddelPlayLauncherArtworkAdapter = PlayLauncherArtworkAdapter;
}
}());
