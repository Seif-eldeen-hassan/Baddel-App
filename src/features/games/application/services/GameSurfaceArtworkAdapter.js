'use strict';

;(function () {
const _surfaceArtworkRoot = typeof window !== 'undefined' ? window : globalThis;
const _gameArtworkResolver = (typeof require === 'function')
    ? require('./GameArtworkResolver')
    : _surfaceArtworkRoot.BaddelGameArtworkResolver;
const _gameArtworkState = (typeof require === 'function')
    ? require('../../domain/services/GameArtworkState')
    : _surfaceArtworkRoot.BaddelGameArtworkState;

const { resolveGameArtwork } = _gameArtworkResolver;

const COVER_ALIASES = Object.freeze(['image', 'cover', 'coverUrl', 'defaultImage', 'posterImage', 'coverImage', 'capsuleImage', 'boxArt', 'grid', 'poster']);
const HERO_ALIASES = Object.freeze(['heroImage', 'hero', 'heroUrl', 'defaultHero', 'background', 'backgroundUrl', '_rouletteHeroUrl']);
const LOGO_ALIASES = Object.freeze(['logo', 'logoUrl', 'defaultLogo', 'logoImage']);

const LEGACY_SURFACE_ORDER = Object.freeze({
    cover: Object.freeze(['image', 'defaultImage', 'coverUrl', 'cover', 'posterImage', 'coverImage', 'capsuleImage', 'boxArt', 'grid', 'poster', '_roulettePosterUrl']),
    hero: Object.freeze(['heroImage', 'defaultHero', 'heroUrl', 'hero', 'background', 'backgroundUrl', '_rouletteHeroUrl', 'image', 'defaultImage', 'coverUrl', 'cover', 'capsuleImage']),
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
    if (type === 'cover' && _hasValue(payload.poster)) return payload.poster;
    return _first(payload, LEGACY_SURFACE_ORDER[type] || []);
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
            revision: extra.revision ?? null,
            fallbackSource: extra.fallbackSource || null,
        },
        updatedAt: extra.updatedAt || null,
        locked: extra.locked === true,
        verified: extra.verified === true,
        confidence: extra.confidence ?? null,
        identity: extra.identity || null,
        representsSource: extra.representsSource || null,
        revision: extra.revision ?? null,
        fallbackSource: extra.fallbackSource || null,
    };
}

function _v2ArtworkFromGameForSource(game = {}, source) {
    if (game?.artworkState?.version !== 2) return null;
    const state = _gameArtworkState?.createArtworkState
        ? _gameArtworkState.createArtworkState(game.artworkState)
        : game.artworkState;
    const out = {};
    for (const type of ['cover', 'hero', 'logo']) {
        const item = state?.[type];
        if (!item || item.overrideSource !== source || !_hasValue(item.overrideValue)) continue;
        Object.assign(out, _candidate(type, item.overrideValue, {
            updatedAt: item.updatedAt || null,
            locked: item.locked === true,
            revision: item.revision || 0,
            fallbackSource: item.fallbackSource || null,
        }) || {});
    }
    return Object.keys(out).length ? out : null;
}

function explicitSettingsArtworkFromGame(game = {}) {
    const v2 = _v2ArtworkFromGameForSource(game, 'settings');
    if (v2) return v2;
    if (!(game.customArtworkLocked === true && game.artworkSource === 'settings')) return null;
    const updatedAt = game.artworkUpdatedAt || null;
    return {
        ...(_candidate('cover', _first(game, COVER_ALIASES), { updatedAt, locked: true }) || {}),
        ...(_candidate('hero', _first(game, HERO_ALIASES), { updatedAt, locked: true }) || {}),
        ...(_candidate('logo', _first(game, LOGO_ALIASES), { updatedAt, locked: true }) || {}),
    };
}

function creatorArtworkFromGame(game = {}) {
    const v2 = _v2ArtworkFromGameForSource(game, 'creator');
    if (v2) return v2;
    if (!(game.customArtworkLocked === true && game.artworkSource === 'creator')) return null;
    const updatedAt = game.artworkUpdatedAt || null;
    return {
        ...(_candidate('cover', _first(game, COVER_ALIASES), { updatedAt, locked: true }) || {}),
        ...(_candidate('hero', _first(game, HERO_ALIASES), { updatedAt, locked: true }) || {}),
        ...(_candidate('logo', _first(game, LOGO_ALIASES), { updatedAt, locked: true }) || {}),
    };
}

function cacheArtworkFromSurfaceCache(cache = {}) {
    if (!cache || typeof cache !== 'object') return null;
    return {
        ...(_candidate('cover', _typeValue(cache, 'cover'), { representsSource: cache.coverRepresentsSource || cache.representsSource || null }) || {}),
        ...(_candidate('hero', _typeValue(cache, 'hero'), { representsSource: cache.heroRepresentsSource || cache.representsSource || null }) || {}),
        ...(_candidate('logo', _typeValue(cache, 'logo'), { representsSource: cache.logoRepresentsSource || cache.representsSource || null }) || {}),
    };
}

function legacyGameSurfaceArtwork({ game = {}, cacheArtwork = null, metadataArtwork = null, placeholders = null } = {}) {
    const cache = cacheArtwork || {};
    const meta = metadataArtwork || {};
    const cover = _first(game, LEGACY_SURFACE_ORDER.cover)
        || _typeValue(cache, 'cover')
        || _typeValue(meta, 'cover')
        || _typeValue(placeholders, 'cover');
    const hero = _first(game, LEGACY_SURFACE_ORDER.hero)
        || _typeValue(cache, 'hero')
        || _typeValue(meta, 'hero')
        || cover
        || _typeValue(placeholders, 'hero');
    const logo = _first(game, LEGACY_SURFACE_ORDER.logo)
        || _typeValue(cache, 'logo')
        || _typeValue(meta, 'logo')
        || _typeValue(placeholders, 'logo');

    const out = {};
    for (const [type, value] of Object.entries({ cover, hero, logo })) {
        out[type] = Object.freeze({
            value: value || null,
            type,
            source: value ? 'legacy-fallback' : 'placeholder',
            reason: value ? 'legacy game surface artwork fallback' : 'no game surface artwork candidate',
            usedFallback: true,
        });
    }
    return Object.freeze(out);
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

function resolveGameSurfaceArtwork({
    surface = 'generic',
    game = {},
    settingsArtwork = null,
    creatorArtwork = null,
    platformArtwork = null,
    metadataArtwork = null,
    cacheArtwork = null,
    placeholders = null,
    resolver = _safeResolve,
} = {}) {
    const normalizedCache = cacheArtworkFromSurfaceCache(cacheArtwork);
    const fallback = legacyGameSurfaceArtwork({ game, cacheArtwork, metadataArtwork, placeholders });
    let resolved = null;
    try {
        resolved = resolver({
            game,
            settingsArtwork: settingsArtwork || explicitSettingsArtworkFromGame(game),
            creatorArtwork: creatorArtwork || creatorArtworkFromGame(game),
            platformArtwork,
            metadataArtwork,
            cacheArtwork: normalizedCache,
            placeholders,
        });
    } catch {
        resolved = null;
    }

    const output = { surface };
    for (const type of ['cover', 'hero', 'logo']) {
        const item = resolved?.[type];
        output[type] = _validResultItem(item)
            ? Object.freeze({ ...item, usedFallback: false, fallbackValue: fallback[type].value })
            : fallback[type];
    }
    return Object.freeze(output);
}

const GameSurfaceArtworkAdapter = {
    COVER_ALIASES,
    HERO_ALIASES,
    LOGO_ALIASES,
    LEGACY_SURFACE_ORDER,
    cacheArtworkFromSurfaceCache,
    creatorArtworkFromGame,
    explicitSettingsArtworkFromGame,
    legacyGameSurfaceArtwork,
    resolveGameSurfaceArtwork,
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = GameSurfaceArtworkAdapter;
}

if (_surfaceArtworkRoot) {
    _surfaceArtworkRoot.BaddelGameSurfaceArtworkAdapter = GameSurfaceArtworkAdapter;
}
}());
