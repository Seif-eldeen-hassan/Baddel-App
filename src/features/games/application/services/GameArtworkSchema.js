'use strict';

;(function () {
const root = typeof window !== 'undefined' ? window : globalThis;

const ARTWORK_TYPES = Object.freeze(['cover', 'hero', 'logo']);
const TYPE_ALIASES = Object.freeze({
    cover: Object.freeze(['image', 'cover', 'coverUrl', 'coverImage', 'defaultImage', 'posterImage', 'capsuleImage', 'boxArt', 'grid', 'poster']),
    hero: Object.freeze(['heroImage', 'hero', 'heroUrl', 'defaultHero', 'background', 'backgroundUrl', '_rouletteHeroUrl']),
    logo: Object.freeze(['logo', 'logoUrl', 'logoImage', 'defaultLogo']),
});

const PRIMARY_ALIASES = Object.freeze({
    cover: 'image',
    hero: 'heroImage',
    logo: 'logo',
});
const LEGACY_ALL_GAMES_COVER_ORDER = Object.freeze(['coverUrl', 'image', 'defaultImage', 'cover', 'posterImage', 'coverImage', 'capsuleImage', 'boxArt', 'grid', 'poster']);

function hasArtworkValue(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function readArtworkValue(source, type) {
    if (!source || !ARTWORK_TYPES.includes(type)) return null;
    const typed = source[type];
    if (typed && typeof typed === 'object' && !Array.isArray(typed) && hasArtworkValue(typed.value)) {
        return typed.value;
    }
    if (hasArtworkValue(typed)) return typed;
    for (const alias of TYPE_ALIASES[type]) {
        if (hasArtworkValue(source[alias])) return source[alias];
    }
    return null;
}

function matchedArtworkAlias(source, type) {
    if (!source || !ARTWORK_TYPES.includes(type)) return null;
    const typed = source[type];
    if (typed && typeof typed === 'object' && !Array.isArray(typed) && hasArtworkValue(typed.value)) return `${type}.value`;
    if (hasArtworkValue(typed)) return type;
    return TYPE_ALIASES[type].find(alias => hasArtworkValue(source[alias])) || null;
}

function projectTypedAliases(target, type, value) {
    if (!target || !ARTWORK_TYPES.includes(type)) return target;
    for (const alias of TYPE_ALIASES[type]) {
        if (alias.startsWith('_roulette')) continue;
        target[alias] = hasArtworkValue(value) ? value : null;
    }
    return target;
}

const api = { ARTWORK_TYPES, TYPE_ALIASES, PRIMARY_ALIASES, LEGACY_ALL_GAMES_COVER_ORDER, hasArtworkValue, readArtworkValue, matchedArtworkAlias, projectTypedAliases };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (root) root.BaddelGameArtworkSchema = api;
}());
