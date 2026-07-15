'use strict';

let _identityApi = null;
let _artworkStateApi = null;
if (typeof require === 'function') {
    try {
        _identityApi = require('./CanonicalGameIdentityResolver');
    } catch (_) {}
    try {
        _artworkStateApi = require('../../domain/services/GameArtworkState');
    } catch (_) {}
}
if (!_identityApi && typeof window !== 'undefined') {
    _identityApi = window.BaddelCanonicalGameIdentityResolver;
}
if (!_artworkStateApi && typeof window !== 'undefined') {
    _artworkStateApi = window.BaddelGameArtworkState;
}

const _COPY_FIELDS = [
    'image', 'cover', 'coverUrl', 'defaultImage',
    'hero', 'heroImage', 'heroUrl', 'defaultHero', 'background', 'backgroundUrl',
    'logo', 'logoUrl', 'defaultLogo',
    'customArtworkLocked', 'artworkSource', 'artworkUpdatedAt',
    'id', 'installedGameKey', 'allIds', 'steamAppId', 'steam_appid', 'appId', 'appid',
    'appName', 'launcherGameId', 'namespace', 'catalogNamespace', 'catalogItemId',
];

function _hasExplicitArtwork(game) {
    return Boolean(game && game.customArtworkLocked === true &&
        (game.artworkSource === 'settings' || game.artworkSource === 'creator'));
}

function _copyDefined(target, source, fields) {
    for (const field of fields) {
        if (source[field] !== undefined) target[field] = source[field];
    }
}

function normalizeArtworkAliases(game) {
    if (!game || typeof game !== 'object') return game;
    if (game.artworkState?.version === 2 && _artworkStateApi?.projectArtworkStateToLegacyAliases) {
        return _artworkStateApi.projectArtworkStateToLegacyAliases(game);
    }
    const out = { ...game };
    const cover = out.image ?? out.cover ?? out.coverUrl ?? out.defaultImage ?? null;
    const hero = out.hero ?? out.heroImage ?? out.heroUrl ?? out.defaultHero ?? null;
    const logo = out.logo ?? out.logoUrl ?? out.defaultLogo ?? null;
    if (cover != null) {
        out.image = cover;
        out.cover = cover;
        out.coverUrl = cover;
        out.defaultImage = cover;
    }
    if (hero != null) {
        out.hero = hero;
        out.heroImage = hero;
        out.heroUrl = hero;
        out.defaultHero = hero;
    }
    if (logo != null) {
        out.logo = logo;
        out.logoUrl = logo;
        out.defaultLogo = logo;
    }
    return out;
}

function projectCanonicalArtwork(displayGame, canonicalGame, { matchReason = null } = {}) {
    if (!displayGame || !canonicalGame || !_hasExplicitArtwork(canonicalGame)) return normalizeArtworkAliases(displayGame);
    const projected = { ...displayGame };
    const displayId = displayGame.id;
    _copyDefined(projected, canonicalGame, _COPY_FIELDS);
    projected.id = displayId ?? canonicalGame.id;
    projected.localGameId = canonicalGame.id;
    projected.installedId = displayGame.installedId || canonicalGame.id;
    projected._artworkIdentityMatchReason = matchReason || 'canonical';
    return normalizeArtworkAliases(projected);
}

function projectFromRecords(displayGame, records = []) {
    const resolver = _identityApi?.resolveCanonicalGameIdentity;
    if (typeof resolver !== 'function') return normalizeArtworkAliases(displayGame);
    const result = resolver(displayGame, records);
    if (result.status !== 'success') return normalizeArtworkAliases(displayGame);
    return projectCanonicalArtwork(displayGame, result.game, { matchReason: result.reason });
}

const CanonicalArtworkProjectionApi = { normalizeArtworkAliases, projectCanonicalArtwork, projectFromRecords };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = CanonicalArtworkProjectionApi;
}

const _projectionRoot =
    (typeof window !== 'undefined') ? window :
    (typeof globalThis !== 'undefined') ? globalThis :
    null;
if (_projectionRoot) {
    _projectionRoot.BaddelCanonicalArtworkProjection = CanonicalArtworkProjectionApi;
}
