'use strict';

;(function () {
const _allGamesArtworkRoot = typeof window !== 'undefined' ? window : globalThis;
const _gameArtworkResolver = (typeof require === 'function')
    ? require('./GameArtworkResolver')
    : _allGamesArtworkRoot.BaddelGameArtworkResolver;

const { resolveGameArtwork } = _gameArtworkResolver;

const COVER_ALIASES = Object.freeze(['image', 'cover', 'coverUrl', 'defaultImage', 'posterImage']);
const LEGACY_ALL_GAMES_COVER_ORDER = Object.freeze(['coverUrl', 'image', 'defaultImage', 'cover', 'posterImage']);

function _hasValue(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function _firstCover(game = {}) {
    for (const alias of LEGACY_ALL_GAMES_COVER_ORDER) {
        if (_hasValue(game[alias])) return game[alias];
    }
    return null;
}

function legacyAllGamesCover(game = {}) {
    return _firstCover(game);
}

function _explicitArtworkFromGame(game = {}) {
    const cover = _firstCover(game);
    if (!cover || game.customArtworkLocked !== true) return {};

    const source = game.artworkSource === 'settings'
        ? 'settingsArtwork'
        : game.artworkSource === 'creator'
            ? 'creatorArtwork'
            : null;

    if (!source) return {};

    return {
        [source]: {
            cover: {
                value: cover,
                updatedAt: game.artworkUpdatedAt || null,
                locked: true,
            },
        },
    };
}

function _safeResolverCover(input) {
    try {
        const resolved = resolveGameArtwork(input);
        const cover = resolved?.cover || null;
        return _hasValue(cover?.value) ? cover : null;
    } catch {
        return null;
    }
}

function resolveAllGamesArtwork({
    game = {},
    settingsArtwork = null,
    creatorArtwork = null,
    platformArtwork = null,
    metadataArtwork = null,
    cacheArtwork = null,
    placeholder = null,
    resolver = _safeResolverCover,
} = {}) {
    const explicitFromGame = _explicitArtworkFromGame(game);
    const fallbackCover = legacyAllGamesCover(game);

    const resolverInput = {
        game,
        settingsArtwork: settingsArtwork || explicitFromGame.settingsArtwork || null,
        creatorArtwork: creatorArtwork || explicitFromGame.creatorArtwork || null,
        platformArtwork,
        metadataArtwork,
        cacheArtwork,
        placeholders: placeholder ? { cover: placeholder } : null,
    };

    const cover = resolver(resolverInput);
    if (cover && _hasValue(cover.value)) {
        return Object.freeze({
            cover,
            value: cover.value,
            source: cover.source,
            reason: cover.reason,
            usedFallback: false,
            fallbackValue: fallbackCover,
        });
    }

    return Object.freeze({
        cover: Object.freeze({
            value: fallbackCover,
            type: 'cover',
            source: fallbackCover ? 'legacy-fallback' : 'placeholder',
            locked: game.customArtworkLocked === true,
            updatedAt: game.artworkUpdatedAt || null,
            confidence: null,
            verified: false,
            cacheOnly: false,
            identity: null,
            reason: fallbackCover ? 'legacy All Games cover fallback' : 'no All Games cover candidate',
        }),
        value: fallbackCover,
        source: fallbackCover ? 'legacy-fallback' : 'placeholder',
        reason: fallbackCover ? 'legacy All Games cover fallback' : 'no All Games cover candidate',
        usedFallback: true,
        fallbackValue: fallbackCover,
    });
}

const AllGamesArtworkAdapter = {
    COVER_ALIASES,
    LEGACY_ALL_GAMES_COVER_ORDER,
    legacyAllGamesCover,
    resolveAllGamesArtwork,
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = AllGamesArtworkAdapter;
}

if (_allGamesArtworkRoot) {
    _allGamesArtworkRoot.BaddelAllGamesArtworkAdapter = AllGamesArtworkAdapter;
}
}());
