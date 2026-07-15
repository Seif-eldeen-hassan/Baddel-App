'use strict';

function _str(value) {
    if (value == null) return '';
    return String(value).trim();
}

function _key(value) {
    return _str(value).toLowerCase();
}

function _pathKey(value) {
    return _str(value)
        .replace(/^file:\/\//i, '')
        .replace(/^"|"$/g, '')
        .replace(/[\\/]+/g, '/')
        .toLowerCase();
}

function _first(obj, fields) {
    if (!obj || typeof obj !== 'object') return '';
    for (const field of fields) {
        const value = _str(obj[field]);
        if (value) return value;
    }
    return '';
}

function _allId(obj, platform) {
    if (!obj || typeof obj !== 'object' || !obj.allIds || typeof obj.allIds !== 'object') return '';
    return _str(obj.allIds[platform]);
}

function _recordFields(record, fields) {
    return fields.map(field => _str(record?.[field])).filter(Boolean);
}

function _findByExact(records, value, fields) {
    const wanted = _key(value);
    if (!wanted) return null;
    return records.find(record => fields.some(field => _key(record?.[field]) === wanted)) || null;
}

function _findByPath(records, value) {
    const wanted = _pathKey(value);
    if (!wanted) return null;
    const pathFields = ['command', 'executablePath', 'path', 'launchCommand', 'shortcutPath'];
    return records.find(record => pathFields.some(field => _pathKey(record?.[field]) === wanted)) || null;
}

function _resolveSteam(identity, records) {
    const steamId =
        _allId(identity, 'steam') ||
        _first(identity, ['steamAppId', 'steam_appid']) ||
        (String(identity?.platform || '').toLowerCase() === 'steam' ? _first(identity, ['appId', 'appid', 'id']) : '');
    const wanted = _key(steamId);
    if (!wanted) return null;
    return records.find(record => {
        const values = [
            _allId(record, 'steam'),
            ..._recordFields(record, ['steamAppId', 'steam_appid']),
            String(record?.platform || '').toLowerCase() === 'steam' ? _first(record, ['appId', 'appid']) : '',
        ];
        return values.some(value => _key(value) === wanted);
    }) || null;
}

function _epicTuple(identity) {
    const appName = _first(identity, ['appName', 'launcherGameId']);
    const namespace = _first(identity, ['namespace', 'catalogNamespace']);
    const catalogItemId = _first(identity, ['catalogItemId']);
    if (!appName && !namespace && !catalogItemId) return null;
    return {
        appName: _key(appName),
        namespace: _key(namespace),
        catalogItemId: _key(catalogItemId),
    };
}

function _resolveEpic(identity, records) {
    const wanted = _epicTuple(identity);
    if (!wanted) return null;
    return records.find(record => {
        const got = _epicTuple(record);
        if (!got) return false;
        const appMatches = wanted.appName && got.appName && wanted.appName === got.appName;
        const namespaceMatches = wanted.namespace && got.namespace && wanted.namespace === got.namespace;
        const catalogMatches = wanted.catalogItemId && got.catalogItemId && wanted.catalogItemId === got.catalogItemId;

        if (wanted.namespace || got.namespace) return appMatches && namespaceMatches;
        if (wanted.catalogItemId || got.catalogItemId) return appMatches && catalogMatches;
        return appMatches;
    }) || null;
}

function resolveCanonicalGameIdentity(identity, records = []) {
    const source = identity && typeof identity === 'object' ? identity : { id: identity };
    const games = Array.isArray(records) ? records : [];

    const checks = [
        ['localGameId', () => _findByExact(games, source.localGameId, ['id'])],
        ['installedId', () => _findByExact(games, source.installedId, ['id'])],
        ['id', () => _findByExact(games, _first(source, ['gameId', 'id']), ['id'])],
        ['installedGameKey', () => _findByExact(games, source.installedGameKey, ['installedGameKey'])],
        ['command', () => _findByPath(games, _first(source, ['command', 'executablePath', 'path', 'launchCommand', 'shortcutPath']))],
        ['steam', () => _resolveSteam(source, games)],
        ['epic', () => _resolveEpic(source, games)],
    ];

    for (const [reason, finder] of checks) {
        const game = finder();
        if (game) return { status: 'success', game, id: game.id, reason };
    }

    return { status: 'error', game: null, id: null, reason: 'not-found' };
}

const CanonicalGameIdentityResolverApi = { resolveCanonicalGameIdentity };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = CanonicalGameIdentityResolverApi;
}

const _canonicalIdentityRoot =
    (typeof window !== 'undefined') ? window :
    (typeof globalThis !== 'undefined') ? globalThis :
    null;
if (_canonicalIdentityRoot) {
    _canonicalIdentityRoot.BaddelCanonicalGameIdentityResolver = CanonicalGameIdentityResolverApi;
}
