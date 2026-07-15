'use strict';

const ARTWORK_TYPES = Object.freeze(['cover', 'hero', 'logo']);

const TYPE_ALIASES = Object.freeze({
    cover: Object.freeze(['image', 'cover', 'coverUrl', 'defaultImage', 'posterImage']),
    hero: Object.freeze(['heroImage', 'hero', 'heroUrl', 'defaultHero', 'background', 'backgroundUrl']),
    logo: Object.freeze(['logo', 'logoUrl', 'defaultLogo']),
});

const FALLBACK_SOURCES = new Set(['scanner', 'platform', 'pipeline', 'server', 'server-details', 'addManual', 'jump-back-in', 'manual', 'metadata', 'sync', 'reset']);
const EXPLICIT_USER_SOURCES = new Set(['settings', 'creator']);

function _hasValue(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function _clone(value) {
    return JSON.parse(JSON.stringify(value || null));
}

function _emptyTypeState() {
    return {
        overrideValue: null,
        overrideSource: null,
        locked: false,
        updatedAt: null,
        revision: 0,
        fallbackValue: null,
        fallbackSource: null,
        fallbackUpdatedAt: null,
    };
}

function createArtworkState(seed = null) {
    const source = seed && typeof seed === 'object' ? seed : {};
    const state = { version: 2 };
    for (const type of ARTWORK_TYPES) {
        state[type] = { ..._emptyTypeState(), ...(source[type] || {}) };
        state[type].locked = state[type].locked === true && _hasValue(state[type].overrideValue);
        state[type].revision = Number.isFinite(Number(state[type].revision)) ? Number(state[type].revision) : 0;
    }
    return state;
}

function _readFirst(game, keys) {
    if (!game || typeof game !== 'object') return null;
    for (const key of keys) {
        if (_hasValue(game[key])) return game[key];
    }
    return null;
}

function _legacyFallback(game, type) {
    if (type === 'cover') return _readFirst(game, ['creatorOriginalCover', 'defaultImage', 'cover', 'coverUrl', 'image']);
    if (type === 'hero') return _readFirst(game, ['creatorOriginalHero', 'defaultHero', 'hero', 'heroImage', 'heroUrl', 'background', 'backgroundUrl']);
    return _readFirst(game, ['creatorOriginalLogo', 'defaultLogo', 'logo', 'logoUrl']);
}

function _legacyVisible(game, type) {
    return _readFirst(game, TYPE_ALIASES[type]);
}

function _isExplicitSource(source) {
    return EXPLICIT_USER_SOURCES.has(source);
}

function migrateLegacyArtworkState(game = {}) {
    const existing = game.artworkState && game.artworkState.version === 2
        ? createArtworkState(game.artworkState)
        : createArtworkState();

    if (game.artworkState && game.artworkState.version === 2) {
        return existing;
    }

    const source = game.artworkSource || (game.customArtworkLocked === true ? 'creator' : null);
    const locked = game.customArtworkLocked === true && (_isExplicitSource(source) || !game.artworkSource);
    const updatedAt = game.artworkUpdatedAt || null;

    for (const type of ARTWORK_TYPES) {
        const visible = _legacyVisible(game, type);
        const fallback = _legacyFallback(game, type) || visible;
        const typeState = existing[type];

        if (locked && _hasValue(visible)) {
            typeState.overrideValue = visible;
            typeState.overrideSource = source;
            typeState.locked = true;
            typeState.updatedAt = updatedAt;
            typeState.revision = Math.max(1, typeState.revision || 0);
            typeState.fallbackValue = fallback && fallback !== visible ? fallback : null;
            typeState.fallbackSource = typeState.fallbackValue ? 'legacy' : null;
            typeState.fallbackUpdatedAt = typeState.fallbackValue ? updatedAt : null;
        } else if (_hasValue(visible)) {
            typeState.fallbackValue = visible;
            typeState.fallbackSource = source || 'legacy';
            typeState.fallbackUpdatedAt = updatedAt;
            typeState.revision = Math.max(1, typeState.revision || 0);
        }
    }

    return existing;
}

function getEffectiveArtwork(stateLike, type) {
    const state = createArtworkState(stateLike);
    const item = state[type];
    if (!item) return null;
    return item.locked && _hasValue(item.overrideValue) ? item.overrideValue : (item.fallbackValue || null);
}

function canApplyArtworkWrite(stateLike, type, { source = 'server', mode = 'fallback', expectedRevision = null } = {}) {
    const state = createArtworkState(stateLike);
    const item = state[type];
    if (!item) return false;
    if (mode !== 'explicit') return true;
    if (!item.locked || !_hasValue(item.overrideValue)) return true;
    if (!_isExplicitSource(source)) return false;
    if (expectedRevision != null && Number(expectedRevision) < Number(item.revision || 0)) return false;
    return _isExplicitSource(item.overrideSource);
}

function applyExplicitOverride(stateLike, type, value, { source = 'settings', updatedAt = Date.now(), expectedRevision = null } = {}) {
    const state = createArtworkState(stateLike);
    const item = state[type];
    if (!item) return { state, applied: false, reason: 'unknown-type' };
    if (!_hasValue(value)) return { state, applied: false, reason: 'empty-value' };
    const previous = { ...item };
    if (!canApplyArtworkWrite(state, type, { source, mode: 'explicit', expectedRevision })) {
        const reason = expectedRevision != null && Number(expectedRevision) < Number(item.revision || 0)
            ? 'stale-revision'
            : 'non-user-source-blocked';
        return { state, applied: false, reason, previous };
    }
    item.overrideValue = value;
    item.overrideSource = source;
    item.locked = true;
    item.updatedAt = updatedAt;
    item.revision = (item.revision || 0) + 1;
    return { state, applied: true, reason: previous.locked ? 'explicit-user-replaced' : 'explicit-user', previous };
}

function applyFallback(stateLike, type, value, { source = 'server', updatedAt = Date.now() } = {}) {
    const state = createArtworkState(stateLike);
    const item = state[type];
    if (!item) return { state, applied: false, reason: 'unknown-type' };
    item.fallbackValue = _hasValue(value) ? value : null;
    item.fallbackSource = source;
    item.fallbackUpdatedAt = updatedAt;
    item.revision = (item.revision || 0) + 1;
    return { state, applied: true, reason: 'fallback' };
}

function clearExplicitOverride(stateLike, type, { updatedAt = Date.now() } = {}) {
    const state = createArtworkState(stateLike);
    const item = state[type];
    if (!item) return { state, applied: false, reason: 'unknown-type' };
    item.overrideValue = null;
    item.overrideSource = null;
    item.locked = false;
    item.updatedAt = updatedAt;
    item.revision = (item.revision || 0) + 1;
    return { state, applied: true, reason: 'cleared' };
}

function summarizeLegacyOwnership(stateLike) {
    const state = createArtworkState(stateLike);
    const lockedSources = ARTWORK_TYPES
        .map(type => state[type])
        .filter(item => item.locked && _hasValue(item.overrideValue))
        .map(item => item.overrideSource || 'unknown');
    if (lockedSources.length === 0) {
        const fallbackSources = ARTWORK_TYPES
            .map(type => state[type].fallbackSource)
            .filter(Boolean);
        const unique = Array.from(new Set(fallbackSources));
        return {
            customArtworkLocked: false,
            artworkSource: unique.length === 1 ? unique[0] : (unique.length > 1 ? 'mixed' : null),
            artworkUpdatedAt: null,
        };
    }
    const unique = Array.from(new Set(lockedSources));
    const updatedAt = ARTWORK_TYPES
        .map(type => state[type])
        .filter(item => item.locked && _hasValue(item.overrideValue))
        .map(item => item.updatedAt)
        .filter(Boolean)
        .sort()
        .pop() || null;
    return {
        customArtworkLocked: true,
        artworkSource: unique.length === 1 ? unique[0] : 'mixed',
        artworkUpdatedAt: updatedAt,
    };
}

function projectArtworkStateToLegacyAliases(game = {}) {
    const out = { ...game, artworkState: migrateLegacyArtworkState(game) };
    for (const type of ARTWORK_TYPES) {
        const effective = getEffectiveArtwork(out.artworkState, type);
        const aliases = TYPE_ALIASES[type];
        for (const alias of aliases) {
            if (alias === 'posterImage') continue;
            out[alias] = effective || null;
        }
    }
    Object.assign(out, summarizeLegacyOwnership(out.artworkState));
    return out;
}

function normalizeArtworkWriteSource(source = 'server') {
    if (_isExplicitSource(source)) return { source, mode: 'explicit' };
    return { source: source || 'server', mode: FALLBACK_SOURCES.has(source) ? 'fallback' : 'fallback' };
}

function describeArtworkState(game = {}) {
    const state = migrateLegacyArtworkState(game);
    const summary = {};
    for (const type of ARTWORK_TYPES) {
        const item = state[type];
        summary[type] = {
            effective: getEffectiveArtwork(state, type),
            overrideValue: item.overrideValue,
            overrideSource: item.overrideSource,
            locked: item.locked,
            fallbackValue: item.fallbackValue,
            fallbackSource: item.fallbackSource,
            revision: item.revision,
        };
    }
    return { version: 2, ...summary };
}

const GameArtworkStateApi = {
    ARTWORK_TYPES,
    TYPE_ALIASES,
    createArtworkState,
    migrateLegacyArtworkState,
    getEffectiveArtwork,
    applyExplicitOverride,
    applyFallback,
    clearExplicitOverride,
    canApplyArtworkWrite,
    projectArtworkStateToLegacyAliases,
    summarizeLegacyOwnership,
    normalizeArtworkWriteSource,
    describeArtworkState,
    _private: { _hasValue, _clone },
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = GameArtworkStateApi;
}

const _artworkStateRoot =
    (typeof window !== 'undefined') ? window :
    (typeof globalThis !== 'undefined') ? globalThis :
    null;
if (_artworkStateRoot) {
    _artworkStateRoot.BaddelGameArtworkState = GameArtworkStateApi;
}
