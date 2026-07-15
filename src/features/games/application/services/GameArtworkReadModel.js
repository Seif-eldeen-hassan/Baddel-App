'use strict';

(function() {

let _artworkStateApi = null;
if (typeof require === 'function') {
    try {
        _artworkStateApi = require('../../domain/services/GameArtworkState');
    } catch (_) {}
}
if (!_artworkStateApi && typeof window !== 'undefined') {
    _artworkStateApi = window.BaddelGameArtworkState;
}

const TYPES = Object.freeze(['cover', 'hero', 'logo']);
const FIELD_CANDIDATES = Object.freeze({
    cover: Object.freeze(['image', 'cover', 'coverUrl', 'defaultImage', 'posterImage', 'capsuleImage', 'boxArt', 'grid']),
    hero: Object.freeze(['heroImage', 'hero', 'heroUrl', 'defaultHero', 'background', 'backgroundUrl']),
    logo: Object.freeze(['logo', 'logoUrl', 'defaultLogo']),
});
const METADATA_FIELDS = Object.freeze({
    cover: Object.freeze(['cover', 'image', 'coverUrl', 'defaultImage']),
    hero: Object.freeze(['hero', 'heroImage', 'heroUrl', 'defaultHero', 'background', 'backgroundUrl']),
    logo: Object.freeze(['logo', 'logoUrl', 'defaultLogo']),
});

function _hasValue(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function _firstValue(source, fields) {
    if (!source || typeof source !== 'object') return null;
    for (const field of fields) {
        if (_hasValue(source[field])) return source[field];
    }
    return null;
}

function _canonicalItem(canonicalGame, type) {
    const raw = canonicalGame?.artworkState?.version === 2
        ? canonicalGame.artworkState
        : null;
    if (!raw) return null;
    const state = _artworkStateApi?.createArtworkState
        ? _artworkStateApi.createArtworkState(raw)
        : raw;
    return state?.[type] || null;
}

function _metadataVerified(metadataArtwork) {
    if (!metadataArtwork || typeof metadataArtwork !== 'object') return false;
    return metadataArtwork.verified === true ||
        metadataArtwork.serverVerified === true ||
        metadataArtwork.confidence === undefined ||
        Number(metadataArtwork.confidence) >= 0.8;
}

function _buildType({ displayGame, canonicalGame, metadataArtwork, platformArtwork, cacheArtwork }, type) {
    const item = _canonicalItem(canonicalGame, type);
    if (item?.locked === true && _hasValue(item.overrideValue)) {
        return {
            effectiveValue: item.overrideValue,
            source: item.overrideSource || 'canonical-explicit',
            revision: Number(item.revision || 0),
            explicit: true,
            fallbackValue: item.fallbackValue || null,
        };
    }
    if (_hasValue(item?.fallbackValue)) {
        return {
            effectiveValue: item.fallbackValue,
            source: item.fallbackSource || 'canonical-fallback',
            revision: Number(item.revision || 0),
            explicit: false,
            fallbackValue: item.fallbackValue,
        };
    }

    const displayValue = _firstValue(displayGame, FIELD_CANDIDATES[type]) ||
        _firstValue(platformArtwork, FIELD_CANDIDATES[type]);
    if (displayValue) {
        return {
            effectiveValue: displayValue,
            source: 'display',
            revision: Number(item?.revision || 0),
            explicit: false,
            fallbackValue: displayValue,
        };
    }

    const metadataValue = _metadataVerified(metadataArtwork)
        ? _firstValue(metadataArtwork, METADATA_FIELDS[type])
        : null;
    if (metadataValue) {
        return {
            effectiveValue: metadataValue,
            source: 'metadata',
            revision: Number(item?.revision || 0),
            explicit: false,
            fallbackValue: metadataValue,
        };
    }

    const cacheValue = _firstValue(cacheArtwork, FIELD_CANDIDATES[type]);
    if (cacheValue) {
        return {
            effectiveValue: cacheValue,
            source: 'cache',
            revision: Number(item?.revision || 0),
            explicit: false,
            fallbackValue: cacheValue,
        };
    }

    return {
        effectiveValue: null,
        source: 'none',
        revision: Number(item?.revision || 0),
        explicit: false,
        fallbackValue: null,
    };
}

function buildGameArtworkReadModel({
    displayGame = null,
    canonicalGame = null,
    metadataArtwork = null,
    platformArtwork = null,
    cacheArtwork = null,
    matchReason = null,
} = {}) {
    const model = {
        identity: {
            displayId: displayGame?.id ?? null,
            canonicalGameId: canonicalGame?.id ?? null,
            matchReason,
        },
    };
    for (const type of TYPES) {
        model[type] = _buildType({ displayGame, canonicalGame, metadataArtwork, platformArtwork, cacheArtwork }, type);
    }
    return model;
}

function applyReadModelAliases(displayGame, model) {
    const out = { ...(displayGame || {}) };
    if (model?.cover?.effectiveValue) {
        out.image = model.cover.effectiveValue;
        out.cover = model.cover.effectiveValue;
        out.coverUrl = model.cover.effectiveValue;
        out.defaultImage = model.cover.effectiveValue;
    }
    if (model?.hero?.effectiveValue) {
        out.heroImage = model.hero.effectiveValue;
        out.hero = model.hero.effectiveValue;
        out.heroUrl = model.hero.effectiveValue;
        out.defaultHero = model.hero.effectiveValue;
        out.background = model.hero.effectiveValue;
        out.backgroundUrl = model.hero.effectiveValue;
    }
    if (model?.logo?.effectiveValue) {
        out.logo = model.logo.effectiveValue;
        out.logoUrl = model.logo.effectiveValue;
        out.defaultLogo = model.logo.effectiveValue;
    }
    return out;
}

function selectPresentationCandidates(model, surface) {
    if (!model) return [];
    const values = [];
    const push = value => { if (_hasValue(value) && !values.includes(value)) values.push(value); };
    if (surface === 'home-hero') {
        push(model.hero.effectiveValue);
        push(model.cover.effectiveValue);
    } else if (surface === 'last-played' || surface === 'card') {
        push(model.cover.effectiveValue);
        push(model.hero.effectiveValue);
    } else {
        push(model.cover.effectiveValue);
        push(model.hero.effectiveValue);
        push(model.logo.effectiveValue);
    }
    return values;
}

const GameArtworkReadModelApi = {
    buildGameArtworkReadModel,
    applyReadModelAliases,
    selectPresentationCandidates,
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = GameArtworkReadModelApi;
}

const _root =
    (typeof window !== 'undefined') ? window :
    (typeof globalThis !== 'undefined') ? globalThis :
    null;
if (_root) {
    _root.BaddelGameArtworkReadModel = GameArtworkReadModelApi;
}

})();
