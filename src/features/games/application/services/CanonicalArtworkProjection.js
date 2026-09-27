'use strict';

let _identityApi = null;
let _artworkStateApi = null;
let _readModelApi = null;
let _schemaApi = null;
if (typeof require === 'function') {
    try {
        _identityApi = require('./CanonicalGameIdentityResolver');
    } catch (_) {}
    try {
        _artworkStateApi = require('../../domain/services/GameArtworkState');
    } catch (_) {}
    try {
        _readModelApi = require('./GameArtworkReadModel');
    } catch (_) {}
    try {
        _schemaApi = require('./GameArtworkSchema');
    } catch (_) {}
}
if (!_identityApi && typeof window !== 'undefined') {
    _identityApi = window.BaddelCanonicalGameIdentityResolver;
}
if (!_artworkStateApi && typeof window !== 'undefined') {
    _artworkStateApi = window.BaddelGameArtworkState;
}
if (!_readModelApi && typeof window !== 'undefined') {
    _readModelApi = window.BaddelGameArtworkReadModel;
}
if (!_schemaApi && typeof window !== 'undefined') _schemaApi = window.BaddelGameArtworkSchema;

const _COPY_FIELDS = [
    'artworkState',
    'customArtworkLocked', 'artworkSource', 'artworkUpdatedAt',
    'id', 'installedGameKey', 'allIds', 'steamAppId', 'steam_appid', 'appId', 'appid',
    'appName', 'launcherGameId', 'namespace', 'catalogNamespace', 'catalogItemId',
    'gogProductId', 'gogdlAppName', 'productId', 'providerProductId',
    'riotProduct', 'riotProductId', 'packageFamilyName', 'appUserModelId',
    'scannerPlatform', 'installProvider',
];

function _copyDefined(target, source, fields) {
    for (const field of fields) {
        if (source[field] !== undefined) target[field] = source[field];
    }
}

function _hasExplicitArtwork(game) {
    return Boolean(game && game.customArtworkLocked === true &&
        (game.artworkSource === 'settings' || game.artworkSource === 'creator'));
}

function normalizeArtworkAliases(game) {
    if (!game || typeof game !== 'object') return game;
    if (game.artworkState?.version === 2 && _artworkStateApi?.projectArtworkStateToLegacyAliases) {
        return _artworkStateApi.projectArtworkStateToLegacyAliases(game);
    }
    const out = { ...game };
    const cover = _schemaApi?.readArtworkValue(out, 'cover') ?? null;
    const hero = _schemaApi?.readArtworkValue(out, 'hero') ?? null;
    const logo = _schemaApi?.readArtworkValue(out, 'logo') ?? null;
    if (cover != null) {
        _schemaApi?.projectTypedAliases(out, 'cover', cover);
    }
    if (hero != null) {
        _schemaApi?.projectTypedAliases(out, 'hero', hero);
    }
    if (logo != null) {
        _schemaApi?.projectTypedAliases(out, 'logo', logo);
    }
    return out;
}

function projectCanonicalArtwork(displayGame, canonicalGame, { matchReason = null } = {}) {
    if (!displayGame || !canonicalGame) return normalizeArtworkAliases(displayGame);
    const projected = { ...displayGame };
    const displayId = displayGame.id;
    _copyDefined(projected, canonicalGame, _COPY_FIELDS);
    projected.id = displayId ?? canonicalGame.id;
    projected.localGameId = canonicalGame.id;
    projected.installedId = displayGame.installedId || canonicalGame.id;
    projected._artworkIdentityMatchReason = matchReason || 'canonical';
    if (canonicalGame.artworkState?.version === 2 && _readModelApi?.buildGameArtworkReadModel) {
        const model = _readModelApi.buildGameArtworkReadModel({
            displayGame,
            canonicalGame,
            matchReason,
        });
        const withAliases = _readModelApi.applyReadModelAliases(projected, model);
        withAliases.artworkState = canonicalGame.artworkState;
        withAliases.customArtworkLocked = canonicalGame.customArtworkLocked;
        withAliases.artworkSource = canonicalGame.artworkSource;
        withAliases.artworkUpdatedAt = canonicalGame.artworkUpdatedAt;
        return withAliases;
    }
    if (_hasExplicitArtwork(canonicalGame)) {
        return normalizeArtworkAliases({ ...projected, ...canonicalGame, id: projected.id, localGameId: canonicalGame.id });
    }
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
