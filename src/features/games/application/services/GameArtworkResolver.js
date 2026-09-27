'use strict';

;(function () {
const _artworkResolverRoot = typeof window !== 'undefined' ? window : globalThis;
const _artworkPolicy = (typeof require === 'function')
    ? require('../../domain/services/ArtworkOwnershipPolicy')
    : _artworkResolverRoot.BaddelArtworkOwnershipPolicy;
const _artworkSchema = (typeof require === 'function')
    ? require('./GameArtworkSchema')
    : _artworkResolverRoot.BaddelGameArtworkSchema;

const {
    ARTWORK_TYPES,
    normalizeArtworkCandidate,
    resolveArtworkType,
} = _artworkPolicy;

const ALIASES = _artworkSchema.TYPE_ALIASES;

function _hasValue(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function _readFirst(obj, keys) {
    if (!obj || typeof obj !== 'object') return null;
    for (const key of keys) {
        if (_hasValue(obj[key])) return obj[key];
    }
    return null;
}

function _copyIdentity(identity) {
    if (!identity || typeof identity !== 'object') return null;
    return { ...identity };
}

function _gameIdentity(game = {}) {
    let readModel = _artworkResolverRoot.BaddelGameArtworkReadModel;
    if (!readModel && typeof require === 'function') {
        try { readModel = require('./GameArtworkReadModel'); } catch (_) {}
    }
    const canonical = readModel?.resolveCanonicalArtworkIdentity?.(game);
    if (canonical) return canonical;
    return { gameId: game.id || null, platform: game.platform || game.scannerPlatform || null, metadataId: game.metadataId || null };
}

function _sourceMeta(source, type, payload = {}) {
    const typeMeta = payload[type] && typeof payload[type] === 'object' && !Array.isArray(payload[type])
        ? payload[type]
        : {};
    return {
        updatedAt: typeMeta.updatedAt ?? payload.updatedAt ?? payload.artworkUpdatedAt ?? null,
        confidence: typeMeta.confidence ?? payload.confidence ?? null,
        verified: typeMeta.verified ?? payload.verified ?? false,
        locked: typeMeta.locked ?? payload.locked,
        identity: _copyIdentity(typeMeta.identity || payload.identity),
    };
}

function normalizeArtworkAliases(game = {}, { source = 'database', locked = false, identity = null } = {}) {
    const candidates = [];

    for (const type of ARTWORK_TYPES) {
        const aliases = ALIASES[type];
        aliases.forEach((alias) => {
            if (!_hasValue(game?.[alias])) return;
            candidates.push(normalizeArtworkCandidate({
                value: game[alias],
                type,
                source,
                locked: locked || game.customArtworkLocked === true,
                updatedAt: game.artworkUpdatedAt || null,
                confidence: null,
                verified: source === 'database' ? true : game.verified === true,
                cacheOnly: source === 'cache',
                identity: identity || _gameIdentity(game),
                alias,
                reason: `legacy alias ${alias}`,
            }, { type, order: candidates.length }));
        });
    }

    return Object.freeze(candidates.slice());
}

function _candidateFromPayload(payload, type, source, value, alias, order) {
    const meta = _sourceMeta(source, type, payload);
    return normalizeArtworkCandidate({
        value,
        type,
        source,
        locked: meta.locked,
        updatedAt: meta.updatedAt,
        confidence: meta.confidence,
        verified: meta.verified,
        cacheOnly: source === 'cache',
        identity: meta.identity,
        alias,
        reason: `${source} ${alias}`,
        order,
        representsSource: payload?.[type]?.representsSource || payload?.representsSource || null,
    }, { type, order });
}

function _pushPayloadCandidates(out, payload, type, source) {
    if (!payload || typeof payload !== 'object') return;

    const aliases = ALIASES[type];
    let order = out.length;

    if (payload[type] && typeof payload[type] === 'object' && !Array.isArray(payload[type])) {
        const item = payload[type];
        if (_hasValue(item.value)) {
            out.push(_candidateFromPayload(payload, type, source, item.value, `${type}.value`, order++));
        }
    } else if (_hasValue(payload[type])) {
        out.push(_candidateFromPayload(payload, type, source, payload[type], type, order++));
    }

    for (const alias of aliases) {
        if (_hasValue(payload[alias])) {
            out.push(_candidateFromPayload(payload, type, source, payload[alias], alias, order++));
        }
    }
}

function _typeCandidates({
    type,
    game = {},
    settingsArtwork = null,
    creatorArtwork = null,
    platformArtwork = null,
    metadataArtwork = null,
    cacheArtwork = null,
    placeholders = null,
}) {
    const candidates = [];
    _pushPayloadCandidates(candidates, settingsArtwork, type, 'settings');
    _pushPayloadCandidates(candidates, creatorArtwork, type, 'creator');
    candidates.push(...normalizeArtworkAliases(game, { source: 'database', identity: _gameIdentity(game) }).filter((c) => c.type === type));
    _pushPayloadCandidates(candidates, platformArtwork, type, 'platform');
    _pushPayloadCandidates(candidates, metadataArtwork, type, 'metadata');
    _pushPayloadCandidates(candidates, cacheArtwork, type, 'cache');
    _pushPayloadCandidates(candidates, placeholders, type, 'placeholder');
    return candidates;
}

function _cacheRepresentation(cacheArtwork, type, winner) {
    if (!cacheArtwork || !winner || winner.source === 'cache' || winner.source === 'placeholder') return null;
    const candidates = [];
    _pushPayloadCandidates(candidates, cacheArtwork, type, 'cache');
    return candidates.find((candidate) =>
        candidate.value &&
        candidate.representsSource === winner.source
    ) || null;
}

function _applyCacheRepresentation(result, cacheCandidate) {
    if (!cacheCandidate) return result;
    return Object.freeze({
        ...result,
        value: cacheCandidate.value,
        reason: `${result.reason}; using cache representation for ${result.source}`,
    });
}

function resolveGameArtwork({
    game = {},
    settingsArtwork = null,
    creatorArtwork = null,
    platformArtwork = null,
    metadataArtwork = null,
    cacheArtwork = null,
    placeholders = null,
} = {}) {
    const context = { identity: _gameIdentity(game) };
    const output = {};

    for (const type of ARTWORK_TYPES) {
        const candidates = _typeCandidates({
            type,
            game,
            settingsArtwork,
            creatorArtwork,
            platformArtwork,
            metadataArtwork,
            cacheArtwork,
            placeholders,
        });
        const resolved = resolveArtworkType({ type, candidates, context });
        output[type] = _applyCacheRepresentation(resolved, _cacheRepresentation(cacheArtwork, type, resolved));
        _artworkResolverRoot.BaddelArtworkDiagnostics?.record?.('resolver-winner', {
            canonicalIdentity: context.identity?.canonicalGameId || context.identity?.gameId,
            provider: context.identity?.platform || null,
            type,
            value: output[type]?.value,
            reason: output[type]?.reason,
            candidateCount: candidates.length,
        });
    }

    return Object.freeze(output);
}

const GameArtworkResolver = {
    ALIASES,
    normalizeArtworkAliases,
    resolveArtworkType,
    resolveGameArtwork,
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = GameArtworkResolver;
}

if (_artworkResolverRoot) {
    _artworkResolverRoot.BaddelGameArtworkResolver = GameArtworkResolver;
}
}());
