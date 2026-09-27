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

function _basename(value) {
    const key = _pathKey(value);
    if (!key) return '';
    const parts = key.split('/').filter(Boolean);
    return parts[parts.length - 1] || '';
}

function _platformKey(obj) {
    return _key(obj?.platform || obj?.source || obj?.scannerPlatform);
}

function _platformCompatible(a, b) {
    const left = _platformKey(a);
    const right = _platformKey(b);
    if (!left || !right) return true;
    return left === right;
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

function _findUniqueByExact(records, value, fields, identity = null) {
    const wanted = _key(value);
    if (!wanted) return null;
    const matches = records.filter(record =>
        (!identity || _platformCompatible(identity, record)) &&
        fields.some(field => _key(record?.[field]) === wanted)
    );
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) return { __identityError: true, reason: 'ambiguous-' + fields[0] };
    return null;
}

function _isCompleteAumid(value) {
    const raw = _str(value);
    return /^shell:AppsFolder\\[^\\!]+![^\\!]+$/i.test(raw) || /^[^\\!]+![^\\!]+$/.test(raw);
}

function _aumid(value) {
    const raw = _str(value);
    const match = raw.match(/^shell:AppsFolder\\(.+![^\\!]+)$/i);
    return match ? match[1] : (_isCompleteAumid(raw) ? raw : '');
}

function _packageFamily(value) {
    const raw = _str(value);
    if (!raw) return '';
    if (/^shell:AppsFolder\\/i.test(raw)) return '';
    if (raw.includes('!')) return raw.split('!')[0];
    return raw;
}

function _launchProduct(value) {
    const raw = _str(value);
    const match = raw.match(/--launch-product[=\s]+["']?([a-z0-9_.-]+)/i);
    return match ? match[1] : '';
}

const _GENERIC_PATH_BASENAMES = new Set([
    'explorer.exe',
    'steam.exe',
    'epicgameslauncher.exe',
    'riotclientservices.exe',
    'eadesktop.exe',
    'ubisoftconnect.exe',
    'upc.exe',
    'rockstarservice.exe',
    'rockstarlauncher.exe',
    'launcher.exe',
    'client.exe',
    'game.exe',
]);

const _GENERIC_PATH_SUFFIXES = [
    '/program files/windowsapps',
    '/program files (x86)/windowsapps',
    '/epic games/launcher',
    '/riot games/riot client',
    '/electronic arts/ea desktop',
    '/ubisoft/ubisoft game launcher',
    '/steam',
];

function _pathRejectionReason(value) {
    const key = _pathKey(value);
    if (!key) return 'empty-path';
    if (/^shell:appsfolder/i.test(key) && !_isCompleteAumid(value)) return 'incomplete-aumid';
    if (_GENERIC_PATH_BASENAMES.has(_basename(value))) return 'generic-path';
    if (_GENERIC_PATH_SUFFIXES.some(suffix => key.endsWith(suffix))) return 'generic-path';
    return null;
}

function _findByPath(records, value, field, identity = null) {
    const wanted = _pathKey(value);
    if (!wanted) return null;
    const rejected = _pathRejectionReason(value);
    if (rejected) return { __identityError: true, reason: rejected };
    const matches = records.filter(record => {
        if (identity && !_platformCompatible(identity, record)) return false;
        if (_pathRejectionReason(record?.[field])) return false;
        return _pathKey(record?.[field]) === wanted;
    });
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) return { __identityError: true, reason: 'ambiguous-path' };
    return null;
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

function _resolveXbox(identity, records) {
    const candidates = [
        [_allId(identity, 'xbox'), ['allIds.xbox']],
        [_packageFamily(identity.packageFamilyName), ['packageFamilyName']],
        [_aumid(identity.appUserModelId), ['appUserModelId']],
        [_packageFamily(identity.launcherGameId), ['packageFamilyName']],
        [_aumid(identity.launcherGameId), ['appUserModelId']],
        [_aumid(identity.command), ['appUserModelId']],
    ];
    for (const [value, fields] of candidates) {
        if (!value) continue;
        const wanted = _key(value);
        const matches = records.filter(record => {
            if (!_platformCompatible(identity, record)) return false;
            const values = fields.flatMap(field => {
                if (field === 'allIds.xbox') return [_allId(record, 'xbox')];
                return [_str(record?.[field])];
            });
            return values.some(item => _key(item) === wanted);
        });
        if (matches.length === 1) return matches[0];
        if (matches.length > 1) return { __identityError: true, reason: 'ambiguous-xbox' };
    }
    return null;
}

function _resolveRiot(identity, records) {
    const values = [
        _allId(identity, 'riot'),
        identity.riotProduct,
        _launchProduct(identity.command),
        _launchProduct(identity.launchCommand),
        identity.launcherGameId,
    ].map(_str).filter(Boolean);
    for (const value of values) {
        const match = _findUniqueByExact(records, value, ['riotProduct', 'launcherGameId'], identity);
        if (match) return match;
        const allIdMatch = records.filter(record =>
            _platformCompatible(identity, record) && _key(_allId(record, 'riot')) === _key(value)
        );
        if (allIdMatch.length === 1) return allIdMatch[0];
        if (allIdMatch.length > 1) return { __identityError: true, reason: 'ambiguous-riot' };
    }
    return null;
}

function _resolveGog(identity, records) {
    const values = [
        _allId(identity, 'gog'),
        identity.gogProductId,
        identity.providerProductId,
        identity.productId,
        _platformKey(identity) === 'gog' ? identity.launcherGameId : '',
    ].map(_str).filter(value => /^\d+$/.test(value));
    for (const value of values) {
        const matches = records.filter(record => _platformCompatible(identity, record) && [
            _allId(record, 'gog'), record.gogProductId, record.providerProductId,
            _platformKey(record) === 'gog' ? record.launcherGameId : '',
        ].map(_str).some(candidate => candidate === value));
        if (matches.length === 1) return matches[0];
        if (matches.length > 1) {
            const byPath = ['executablePath', 'path'].map(field => _findByPath(matches, identity?.[field], field, identity)).find(Boolean);
            if (byPath && !byPath.__identityError) return byPath;
            return { __identityError: true, reason: 'ambiguous-gog-installation' };
        }
    }
    return null;
}

function _resolveLauncherSpecific(identity, records) {
    const fieldsByPlatform = {
        ea: ['launcherGameId', 'appId', 'installedGameKey'],
        ubisoft: ['launcherGameId', 'appId', 'installedGameKey'],
    };
    const fields = fieldsByPlatform[_platformKey(identity)] || [];
    for (const field of fields) {
        const match = _findUniqueByExact(records, identity?.[field], [field], identity);
        if (match) return match;
    }
    return null;
}

function _identityError(reason) {
    return { status: 'error', game: null, id: null, reason };
}

function resolveCanonicalGameIdentity(identity, records = []) {
    const source = identity && typeof identity === 'object' ? identity : { id: identity };
    const games = Array.isArray(records) ? records : [];

    const checks = [
        ['localGameId', () => _findByExact(games, source.localGameId, ['id'])],
        ['installedId', () => _findByExact(games, source.installedId, ['id'])],
        ['id', () => _findByExact(games, _first(source, ['gameId', 'id']), ['id'])],
        ['installedGameKey', () => _findByExact(games, source.installedGameKey, ['installedGameKey'])],
        ['steam', () => _resolveSteam(source, games)],
        ['epic', () => _resolveEpic(source, games)],
        ['xbox', () => _resolveXbox(source, games)],
        ['riot', () => _resolveRiot(source, games)],
        ['gog', () => _resolveGog(source, games)],
        ['launcherSpecific', () => _resolveLauncherSpecific(source, games)],
        ['executablePath', () => _findByPath(games, source.executablePath, 'executablePath', source)],
        ['command', () => _findByPath(games, source.command, 'command', source)],
        ['launchCommand', () => _findByPath(games, source.launchCommand, 'launchCommand', source)],
        ['shortcutPath', () => _findByPath(games, source.shortcutPath, 'shortcutPath', source)],
        ['path', () => _findByPath(games, source.path, 'path', source)],
    ];

    for (const [reason, finder] of checks) {
        const game = finder();
        if (game?.__identityError) return _identityError(game.reason);
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
