'use strict';

(function() {

let _artworkStateApi = null;
let _schemaApi = null;
if (typeof require === 'function') {
    try {
        _artworkStateApi = require('../../domain/services/GameArtworkState');
    } catch (_) {}
}
if (!_artworkStateApi && typeof window !== 'undefined') {
    _artworkStateApi = window.BaddelGameArtworkState;
}
if (typeof require === 'function') {
    try { _schemaApi = require('./GameArtworkSchema'); } catch (_) {}
}
if (!_schemaApi && typeof window !== 'undefined') _schemaApi = window.BaddelGameArtworkSchema;

const TYPES = _schemaApi.ARTWORK_TYPES;
const FIELD_CANDIDATES = _schemaApi.TYPE_ALIASES;
const METADATA_FIELDS = _schemaApi.TYPE_ALIASES;

function _addUnique(out, value) {
    if (!_hasValue(value)) return;
    const text = String(value).trim();
    if (!out.includes(text)) out.push(text);
}

function _key(value) {
    return String(value || '').trim().toLowerCase();
}

function _platform(game) {
    const raw = String(game?.platform || game?.scannerPlatform || game?.source || game?.platforms?.[0] || '').toLowerCase().trim();
    const aliases = {
        'epic games': 'epic', epicgames: 'epic', 'riot games': 'riot',
        'gog galaxy': 'gog', gogdl: 'gog', 'xbox store': 'xbox',
        'microsoft store': 'xbox', 'xbox / store': 'xbox', 'ea app': 'ea',
        origin: 'ea', 'ubisoft connect': 'ubisoft',
    };
    return aliases[raw] || raw;
}

function _accountId(game) {
    const owners = [
        game?.libraryAccountId,
        game?.ownerAccountId,
        game?.accountId,
        ...(Array.isArray(game?.ownedByAccountIds) ? game.ownedByAccountIds : []),
        ...(Array.isArray(game?.ownerAccountIds) ? game.ownerAccountIds : []),
        ...(Array.isArray(game?.accountKeys) ? game.accountKeys : []),
    ].filter(Boolean).map(String).sort();
    return owners[0] || 'all';
}

function _safeLegacyTitle(value) {
    const title = String(value || '').trim();
    if (!title) return '';
    return title
        .replace(/[^a-zA-Z0-9._:-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 180);
}

function _looseTitle(value) {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function _canonicalProductKey(game) {
    const platform = _platform(game) || 'game';
    if (platform === 'epic') {
        const namespace = _key(game?.namespace || game?.catalogNamespace || game?.sandboxId || game?.epicMetadata?.namespace || game?.allIds?.epic);
        const catalogItemId = _key(game?.catalogItemId || game?.catalog_item_id || game?.catalogId || game?.productId);
        const appName = _key(game?.appName || game?.app_name || game?.launcherGameId);
        if (namespace && catalogItemId) return `ns:${namespace}:catalog:${catalogItemId}`;
        if (catalogItemId) return `catalog:${catalogItemId}`;
        if (appName) return appName;
        if (namespace) return namespace;
        const offerId = _key(game?.offerId || game?.catalogOfferId || game?.offer_id);
        if (offerId) return `offer:${offerId}`;
    }
    if (platform === 'steam') {
        const steamId = game?.allIds?.steam || game?.steamAppId || game?.steam_appid || game?.appId || game?.appid || game?.appName;
        if (_hasValue(steamId)) return String(steamId).trim();
    }
    if (platform === 'gog') {
        const gogId = game?.allIds?.gog || game?.gogProductId || game?.providerProductId || game?.productId || game?.gogdlAppName || game?.launcherGameId;
        if (_hasValue(gogId)) return String(gogId).trim();
    }
    if (platform === 'riot') {
        const command = String(game?.command || game?.launchCommand || '');
        const commandProduct = /--launch-product[=\s]+["']?([a-z0-9_.-]+)/i.exec(command)?.[1];
        const riotId = game?.allIds?.riot || game?.riotProduct || commandProduct || game?.launcherGameId;
        if (_hasValue(riotId)) return String(riotId).trim();
    }
    if (platform === 'xbox') {
        const xboxId = game?.allIds?.xbox || game?.packageFamilyName || game?.appUserModelId || game?.launcherGameId;
        if (_hasValue(xboxId)) return String(xboxId).trim();
    }
    const generic = game?.allIds?.[platform] || game?.appName || game?.appid || game?.appId || game?.productId || game?.catalogItemId || game?.launcherGameId || game?.installedGameKey || game?.id;
    if (_hasValue(generic)) return String(generic).trim();
    return 'unknown';
}

function resolveCanonicalArtworkIdentity(game = {}) {
    const platform = _platform(game) || 'game';
    const productKey = _canonicalProductKey(game);
    const account = _accountId(game);
    const canonicalGameId = `${platform}:${account}:${productKey}`;
    const strongAliases = [];
    const legacyAliases = [];

    _addUnique(strongAliases, canonicalGameId);
    _addUnique(strongAliases, game?.id);
    _addUnique(strongAliases, game?.gameId);
    _addUnique(strongAliases, game?.localGameId);
    _addUnique(strongAliases, game?.installedId);
    _addUnique(strongAliases, game?.installedGameKey);

    if (platform === 'epic') {
        const namespace = game?.namespace || game?.catalogNamespace || game?.sandboxId || game?.epicMetadata?.namespace || game?.allIds?.epic;
        const catalogItemId = game?.catalogItemId || game?.catalog_item_id || game?.catalogId || game?.productId;
        const appName = game?.appName || game?.app_name || game?.launcherGameId;
        const offerId = game?.offerId || game?.catalogOfferId || game?.offer_id;
        _addUnique(strongAliases, namespace);
        _addUnique(strongAliases, catalogItemId);
        _addUnique(strongAliases, appName);
        if (namespace && catalogItemId) _addUnique(strongAliases, `epic:ns:${_key(namespace)}:catalog:${_key(catalogItemId)}`);
        if (namespace && appName) _addUnique(strongAliases, `epic:ns:${_key(namespace)}:app:${_key(appName)}`);
        if (namespace) _addUnique(strongAliases, `epic:all:${_key(namespace)}`);
        if (offerId) {
            _addUnique(strongAliases, offerId);
            _addUnique(strongAliases, `offer:${_key(offerId)}`);
            if (namespace) _addUnique(strongAliases, `ns:${_key(namespace)}:offer:${_key(offerId)}`);
        }
    }

    _strongSteamIds(game).forEach(id => {
        _addUnique(strongAliases, id);
        _addUnique(strongAliases, `steam-${id}`);
    });
    _strongEpicIds(game).forEach(id => _addUnique(strongAliases, id));
    _strongWindowsStoreIds(game).forEach(id => _addUnique(strongAliases, id));
    const gogId = game?.allIds?.gog || game?.gogProductId || game?.providerProductId || game?.productId || game?.gogdlAppName;
    if (gogId) {
        _addUnique(strongAliases, gogId);
        _addUnique(strongAliases, `gog-${gogId}`);
        _addUnique(strongAliases, `gog_${gogId}`);
    }

    const riotId = game?.allIds?.riot || game?.riotProduct || (platform === 'riot' ? productKey : null);
    if (riotId) {
        _addUnique(strongAliases, riotId);
        _addUnique(strongAliases, `riot-${riotId}`);
    }
    const xboxId = game?.allIds?.xbox || game?.packageFamilyName || game?.appUserModelId;
    if (xboxId) {
        _addUnique(strongAliases, xboxId);
        _addUnique(strongAliases, `xbox-${xboxId}`);
    }

    return {
        canonicalGameId,
        strongAliases,
        legacyAliases,
        platform,
        externalProductId: productKey,
        confidence: productKey === 'unknown' ? 'low' : 'strong',
        source: platform === 'game' ? 'generic' : platform,
        appId: productKey === 'unknown' ? null : productKey,
        gameId: game?.id || null,
        installedGameKey: game?.installedGameKey || null,
        metadataId: game?.metadataId || null,
        namespace: game?.namespace || game?.catalogNamespace || null,
        catalogItemId: game?.catalogItemId || null,
        launcherGameId: game?.launcherGameId || null,
        gogProductId: gogId || null,
        riotProduct: riotId || null,
        packageFamilyName: game?.packageFamilyName || null,
        appUserModelId: game?.appUserModelId || null,
    };
}
function _strongSteamIds(game) {
    const platform = String(game?.platform || '').toLowerCase();
    const ids = [];
    _addUnique(ids, game?.allIds?.steam);
    _addUnique(ids, game?.steamAppId);
    _addUnique(ids, game?.steam_appid);
    if (platform === 'steam') {
        _addUnique(ids, game?.appId);
        _addUnique(ids, game?.appid);
    }
    return ids;
}

function _strongEpicIds(game) {
    const ids = [];
    _addUnique(ids, game?.allIds?.epic);
    _addUnique(ids, game?.appName);
    _addUnique(ids, game?.launcherGameId);
    _addUnique(ids, game?.catalogItemId);
    return ids;
}

function _strongWindowsStoreIds(game) {
    const ids = [];
    _addUnique(ids, game?.allIds?.xbox);
    _addUnique(ids, game?.packageFamilyName);
    _addUnique(ids, game?.appUserModelId);
    _addUnique(ids, game?.launcherGameId);
    const command = String(game?.command || game?.launchCommand || '');
    const appMatch = /AppsFolder\\([^\s"']+)!/i.exec(command);
    if (appMatch) _addUnique(ids, appMatch[1]);
    return ids;
}

function resolveArtworkCacheKeys(displayGame = null, canonicalGame = null) {
    const keys = [];
    _addUnique(keys, canonicalGame?.id);
    _addUnique(keys, displayGame?.localGameId);
    _addUnique(keys, displayGame?.installedId);
    _addUnique(keys, displayGame?.id);
    _addUnique(keys, canonicalGame?.installedGameKey);
    for (const game of [displayGame, canonicalGame]) {
        _strongSteamIds(game).forEach(id => _addUnique(keys, id));
        _strongEpicIds(game).forEach(id => _addUnique(keys, id));
        _strongWindowsStoreIds(game).forEach(id => _addUnique(keys, id));
    }
    for (const game of [canonicalGame, displayGame]) {
        const identity = resolveCanonicalArtworkIdentity(game || {});
        _addUnique(keys, identity.canonicalGameId);
        identity.strongAliases.forEach(id => _addUnique(keys, id));
        // Never fall back to title-only aliases: display names are mutable and
        // may refer to different products on different providers.
    }
    return keys;
}

function _hasValue(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function _firstValue(source, fields) {
    if (!source || typeof source !== 'object') return null;
    const type = Object.keys(FIELD_CANDIDATES).find(key => FIELD_CANDIDATES[key] === fields);
    return type ? _schemaApi.readArtworkValue(source, type) : null;
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

function _isRemote(value) {
    return /^https?:\/\//i.test(String(value || '').trim());
}

function _typeRuntimeState(displayGame, canonicalGame, type) {
    const state = canonicalGame?.__baddelArtworkAvailability?.[type]
        || displayGame?.__baddelArtworkAvailability?.[type]
        || _canonicalItem(canonicalGame, type)?.availability
        || null;
    return typeof state === 'string' ? state : state?.state || null;
}

function _cacheValueAndMeta(cacheArtwork, type) {
    if (!cacheArtwork || typeof cacheArtwork !== 'object') return { value: null, representsSource: null };
    const typed = cacheArtwork[type];
    if (typed && typeof typed === 'object' && !Array.isArray(typed)) {
        return {
            value: _hasValue(typed.value) ? typed.value : null,
            representsSource: typed.representsSource || cacheArtwork[`${type}RepresentsSource`] || cacheArtwork.representsSource || null,
        };
    }
    return {
        value: _schemaApi.readArtworkValue(cacheArtwork, type),
        representsSource: cacheArtwork[`${type}RepresentsSource`] || cacheArtwork.representsSource || null,
    };
}

function runtimeCacheArtwork(displayGame, canonicalGame, supplied) {
    const out = { ...(supplied || {}) };
    const marker = {
        cover: displayGame?.__baddelResolvedLocalCover || canonicalGame?.__baddelResolvedLocalCover,
        hero: displayGame?.__baddelResolvedLocalHero || canonicalGame?.__baddelResolvedLocalHero,
        logo: displayGame?.__baddelResolvedLocalLogo || canonicalGame?.__baddelResolvedLocalLogo,
    };
    for (const type of TYPES) {
        if (!_hasValue(_cacheValueAndMeta(out, type).value) && _hasValue(marker[type])) {
            out[type] = { value: marker[type], representsSource: 'content-addressed-cache' };
        }
    }
    return out;
}

function _typedResult({ type, originalValue, source, item, cache, explicit = false, runtimeState = null, identity = null }) {
    const remotePending = _isRemote(originalValue) && !cache.value;
    const effectiveValue = cache.value || (remotePending ? null : originalValue) || null;
    let availability = runtimeState;
    if (effectiveValue) availability = 'available';
    else if (remotePending) availability = 'pending';
    else if (!availability) availability = 'terminal-miss';
    const pending = availability === 'pending' || availability === 'loading';
    const terminal = availability === 'terminal-miss' || availability === 'unavailable' || availability === 'failed';
    return {
        effectiveValue,
        originalValue: originalValue || null,
        originalSource: source,
        cacheRepresentation: cache.value || null,
        representsSource: cache.representsSource || null,
        source: cache.value ? (cache.representsSource || source || 'cache') : source,
        revision: Number(item?.revision || 0),
        identity,
        availability,
        pending,
        terminal,
        explicit,
        locked: item?.locked === true,
        fallbackValue: item?.fallbackValue || originalValue || null,
    };
}

function _buildType({ displayGame, canonicalGame, metadataArtwork, platformArtwork, cacheArtwork }, type) {
    const item = _canonicalItem(canonicalGame, type);
    const identity = resolveCanonicalArtworkIdentity(canonicalGame || displayGame || {});
    const cache = _cacheValueAndMeta(cacheArtwork, type);
    const runtimeState = _typeRuntimeState(displayGame, canonicalGame, type);
    if (item?.locked === true && _hasValue(item.overrideValue)) {
        return _typedResult({ type, originalValue: item.overrideValue, source: item.overrideSource || 'canonical-explicit', item, cache, explicit: true, runtimeState, identity });
    }
    const rejectedGogScannerLogo = type === 'logo' && identity.platform === 'gog' &&
        /^(scanner|gamesdb)$/i.test(String(item?.fallbackSource || ''));
    if (_hasValue(item?.fallbackValue) && !rejectedGogScannerLogo) {
        return _typedResult({ type, originalValue: item.fallbackValue, source: item.fallbackSource || 'canonical-fallback', item, cache, runtimeState, identity });
    }

    const rawDisplayValue = _firstValue(displayGame, FIELD_CANDIDATES[type]);
    const displayValue = (rejectedGogScannerLogo && rawDisplayValue === item?.fallbackValue ? null : rawDisplayValue) ||
        _firstValue(platformArtwork, FIELD_CANDIDATES[type]);
    if (displayValue) {
        return _typedResult({ type, originalValue: displayValue, source: 'display', item, cache, runtimeState, identity });
    }

    const metadataValue = _metadataVerified(metadataArtwork)
        ? _firstValue(metadataArtwork, METADATA_FIELDS[type])
        : null;
    if (metadataValue) {
        return _typedResult({ type, originalValue: metadataValue, source: 'metadata', item, cache, runtimeState, identity });
    }

    if (cache.value) {
        return _typedResult({ type, originalValue: null, source: 'cache', item, cache, runtimeState, identity });
    }

    const finalAvailability = rejectedGogScannerLogo ? 'terminal-miss' : (runtimeState || 'terminal-miss');
    return {
        effectiveValue: null,
        originalValue: null,
        originalSource: 'none',
        cacheRepresentation: null,
        representsSource: null,
        source: 'none',
        revision: Number(item?.revision || 0),
        identity,
        availability: finalAvailability,
        pending: finalAvailability === 'pending' || finalAvailability === 'loading',
        terminal: !(finalAvailability === 'pending' || finalAvailability === 'loading'),
        explicit: false,
        locked: item?.locked === true,
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
    cacheArtwork = runtimeCacheArtwork(displayGame, canonicalGame, cacheArtwork);
    const model = {
        identity: {
            displayId: displayGame?.id ?? null,
            canonicalGameId: canonicalGame?.id ?? null,
            matchReason,
        },
    };
    const diagRoot = typeof window !== 'undefined' ? window : globalThis;
    diagRoot.BaddelArtworkDiagnostics?.record?.('read-model-input', {
        canonicalIdentity: resolveCanonicalArtworkIdentity(canonicalGame || displayGame || {}).canonicalGameId,
        provider: _platform(canonicalGame || displayGame || {}),
        displayCandidateFields: TYPES.flatMap(type => FIELD_CANDIDATES[type].filter(alias => _hasValue(displayGame?.[alias]))),
        canonicalCandidateFields: TYPES.flatMap(type => FIELD_CANDIDATES[type].filter(alias => _hasValue(canonicalGame?.[alias]))),
        metadataCandidateFields: TYPES.flatMap(type => METADATA_FIELDS[type].filter(alias => _hasValue(metadataArtwork?.[alias]))),
    });
    for (const type of TYPES) {
        model[type] = _buildType({ displayGame, canonicalGame, metadataArtwork, platformArtwork, cacheArtwork }, type);
        diagRoot.BaddelArtworkDiagnostics?.record?.('read-model-type', {
            canonicalIdentity: model[type].identity?.canonicalGameId,
            provider: model[type].identity?.platform,
            type,
            value: model[type].effectiveValue,
            sourceValue: model[type].originalValue,
            availability: model[type].availability,
            reason: matchReason || model[type].source,
            revision: model[type].revision,
        });
    }
    return model;
}

function applyReadModelAliases(displayGame, model) {
    const out = { ...(displayGame || {}) };
    for (const type of TYPES) {
        if (model?.[type]) _schemaApi.projectTypedAliases(out, type, model[type].effectiveValue);
    }
    out.__baddelArtworkReadModel = model;
    return out;
}

function selectPresentationCandidates(model, surface) {
    if (!model) return [];
    const values = [];
    const push = value => { if (_hasValue(value) && !values.includes(value)) values.push(value); };
    if (surface === 'home-hero') {
        push(model.hero.effectiveValue);
        if (model.hero.terminal === true) push(model.cover.effectiveValue);
    } else if (surface === 'last-played' || surface === 'jump-back-in') {
        push(model.hero.effectiveValue);
        push(model.cover.effectiveValue);
    } else if (surface === 'library-card' || surface === 'card') {
        push(model.cover.effectiveValue);
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
    resolveArtworkCacheKeys,
    resolveCanonicalArtworkIdentity,
    runtimeCacheArtwork,
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
