'use strict';

;(function () {
const _gameDetailsArtworkRoot = typeof window !== 'undefined' ? window : globalThis;
const _gameArtworkResolver = (typeof require === 'function')
    ? require('./GameArtworkResolver')
    : _gameDetailsArtworkRoot.BaddelGameArtworkResolver;
const _artworkSchema = (typeof require === 'function')
    ? require('./GameArtworkSchema')
    : _gameDetailsArtworkRoot.BaddelGameArtworkSchema;
const _readModel = (typeof require === 'function')
    ? require('./GameArtworkReadModel')
    : _gameDetailsArtworkRoot.BaddelGameArtworkReadModel;

const { resolveGameArtwork } = _gameArtworkResolver;

const COVER_ALIASES = _artworkSchema.TYPE_ALIASES.cover;
const HERO_ALIASES = _artworkSchema.TYPE_ALIASES.hero;
const LOGO_ALIASES = _artworkSchema.TYPE_ALIASES.logo;

const LEGACY_DETAILS_ORDER = _artworkSchema.TYPE_ALIASES;

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
    return _first(payload, LEGACY_DETAILS_ORDER[type] || []);
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

function legacyGameDetailsArtwork({ game = {}, metaData = {}, placeholders = null } = {}) {
    const artLocked = game.customArtworkLocked === true;
    const meta = metaData || {};
    const gameValues = {
        cover: _first(game, LEGACY_DETAILS_ORDER.cover),
        hero: _first(game, LEGACY_DETAILS_ORDER.hero),
        logo: _first(game, LEGACY_DETAILS_ORDER.logo),
    };
    const metaValues = {
        cover: _first(meta, ['cover', 'image', 'posterImage', 'coverImage']),
        hero: _first(meta, ['heroImage', 'hero', 'heroUrl', 'defaultHero']),
        logo: _first(meta, ['logo', 'logoUrl', 'logoImage', 'defaultLogo']),
    };

    const pick = (type) => {
        if (artLocked) return gameValues[type] || metaValues[type] || _typeValue(placeholders, type);
        return metaValues[type] || gameValues[type] || _typeValue(placeholders, type);
    };

    const out = {};
    for (const type of ['cover', 'hero', 'logo']) {
        const value = pick(type) || null;
        out[type] = Object.freeze({
            value,
            type,
            source: value ? 'legacy-fallback' : 'placeholder',
            reason: value ? 'legacy Game Details artwork fallback' : 'no Game Details artwork candidate',
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

function resolveGameDetailsArtwork({
    game = {},
    settingsArtwork = null,
    creatorArtwork = null,
    platformArtwork = null,
    metadataArtwork = null,
    cacheArtwork = null,
    placeholders = null,
    metaData = null,
    resolver = _safeResolve,
} = {}) {
    const normalizedCache = _readModel?.runtimeCacheArtwork?.(game, game, cacheArtwork) || cacheArtwork;
    const fallback = legacyGameDetailsArtwork({ game, metaData: metaData || metadataArtwork, placeholders });
    let resolved = null;
    try {
        resolved = resolver({
            game,
            settingsArtwork: settingsArtwork || explicitSettingsArtworkFromGame(game),
            creatorArtwork,
            platformArtwork,
            metadataArtwork,
            cacheArtwork: normalizedCache,
            placeholders,
        });
    } catch {
        resolved = null;
    }

    const output = {};
    const canonicalModel = _readModel?.buildGameArtworkReadModel?.({
        displayGame: game,
        canonicalGame: game,
        metadataArtwork,
        platformArtwork,
        cacheArtwork: normalizedCache,
    }) || null;
    for (const type of ['cover', 'hero', 'logo']) {
        const item = resolved?.[type];
        const canonicalItem = canonicalModel?.[type] || null;
        const remotePending = _validResultItem(item) && /^https?:\/\//i.test(item.value) && item.source !== 'settings' && item.source !== 'creator';
        const rejectedGogScannerLogo = type === 'logo' && canonicalItem?.identity?.platform === 'gog' && canonicalItem?.originalSource === 'none';
        if (_validResultItem(item) && !remotePending && !rejectedGogScannerLogo) {
            output[type] = Object.freeze({ ...canonicalItem, ...item, effectiveValue: item.value, availability: 'available', pending: false, terminal: false, usedFallback: false, fallbackValue: fallback[type].value });
        } else if ((remotePending || rejectedGogScannerLogo) && canonicalItem) {
            output[type] = Object.freeze({
                ...canonicalItem,
                value: canonicalItem.effectiveValue,
                usedFallback: false,
            });
        } else {
            output[type] = fallback[type];
        }
    }
    return Object.freeze(output);
}

const GameDetailsArtworkAdapter = {
    COVER_ALIASES,
    HERO_ALIASES,
    LOGO_ALIASES,
    LEGACY_DETAILS_ORDER,
    creatorArtworkFromCustomDetails,
    explicitSettingsArtworkFromGame,
    legacyGameDetailsArtwork,
    resolveGameDetailsArtwork,
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = GameDetailsArtworkAdapter;
}

if (_gameDetailsArtworkRoot) {
    _gameDetailsArtworkRoot.BaddelGameDetailsArtworkAdapter = GameDetailsArtworkAdapter;
}
}());
