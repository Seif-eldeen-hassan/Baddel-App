'use strict';

const ARTWORK_TYPES = Object.freeze(['cover', 'hero', 'logo']);

const SOURCE_TIERS = Object.freeze({
    settings: 700,
    creator: 600,
    database: 500,
    platform: 400,
    metadata: 300,
    cache: 100,
    unknown: 50,
    placeholder: 0,
});

const EXPLICIT_LOCKED_SOURCES = new Set(['settings', 'creator']);

function _isArtworkType(type) {
    return ARTWORK_TYPES.includes(type);
}

function _hasValue(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function _toTimestamp(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function _toConfidence(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : null;
}

function _copyIdentity(identity) {
    if (!identity || typeof identity !== 'object') return null;
    const out = {};
    for (const key of ['gameId', 'platform', 'appId', 'metadataId']) {
        if (identity[key] !== undefined && identity[key] !== null && identity[key] !== '') {
            out[key] = String(identity[key]);
        }
    }
    return Object.keys(out).length ? out : null;
}

function _sameIdentityValue(a, b) {
    return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

function _identityMatches(candidateIdentity, expectedIdentity) {
    if (!expectedIdentity || !candidateIdentity) return true;
    const strongKeys = ['gameId', 'appId', 'metadataId']
        .filter((key) => expectedIdentity[key] !== undefined && candidateIdentity[key] !== undefined);
    if (strongKeys.length) {
        return strongKeys.some((key) => _sameIdentityValue(candidateIdentity[key], expectedIdentity[key]));
    }

    const comparableKeys = ['platform']
        .filter((key) => expectedIdentity[key] !== undefined && candidateIdentity[key] !== undefined);
    if (!comparableKeys.length) return true;
    return comparableKeys.some((key) => _sameIdentityValue(candidateIdentity[key], expectedIdentity[key]));
}

function normalizeArtworkCandidate(candidate = {}, defaults = {}) {
    const source = SOURCE_TIERS[candidate.source] !== undefined ? candidate.source : 'unknown';
    const type = _isArtworkType(candidate.type) ? candidate.type : defaults.type;
    const cacheOnly = candidate.cacheOnly === true || source === 'cache';
    const locked = candidate.locked === true || EXPLICIT_LOCKED_SOURCES.has(source);

    return Object.freeze({
        value: _hasValue(candidate.value) ? String(candidate.value).trim() : null,
        type: _isArtworkType(type) ? type : null,
        source,
        locked,
        updatedAt: _toTimestamp(candidate.updatedAt),
        confidence: _toConfidence(candidate.confidence),
        verified: candidate.verified === true,
        cacheOnly,
        identity: _copyIdentity(candidate.identity),
        alias: candidate.alias ? String(candidate.alias) : null,
        reason: candidate.reason ? String(candidate.reason) : null,
        representsSource: candidate.representsSource ? String(candidate.representsSource) : null,
        order: Number.isFinite(candidate.order) ? candidate.order : (Number.isFinite(defaults.order) ? defaults.order : 0),
    });
}

function isCandidateEligible(candidate, context = {}) {
    if (!candidate || !_isArtworkType(candidate.type) || !_hasValue(candidate.value)) return false;

    if (candidate.source === 'platform') {
        if (!candidate.verified) return false;
        if (!_identityMatches(candidate.identity, context.identity || null)) return false;
    }

    if (candidate.source === 'metadata') {
        if (!candidate.verified && !(candidate.confidence !== null && candidate.confidence >= 0.75)) {
            return false;
        }
    }

    return true;
}

function _score(candidate) {
    return SOURCE_TIERS[candidate.source] ?? SOURCE_TIERS.unknown;
}

function _compareCandidates(a, b) {
    const tierDiff = _score(b) - _score(a);
    if (tierDiff) return tierDiff;

    const timeDiff = (b.updatedAt || 0) - (a.updatedAt || 0);
    if (timeDiff) return timeDiff;

    if (a.source === 'metadata' && b.source === 'metadata') {
        const confidenceDiff = (b.confidence || 0) - (a.confidence || 0);
        if (confidenceDiff) return confidenceDiff;
    }

    if (a.verified !== b.verified) return b.verified ? 1 : -1;

    return (a.order || 0) - (b.order || 0);
}

function _stableEmptyResult(type, reason = 'no eligible artwork candidate') {
    return Object.freeze({
        value: null,
        type,
        source: 'placeholder',
        locked: false,
        updatedAt: null,
        confidence: null,
        verified: false,
        cacheOnly: false,
        identity: null,
        reason,
    });
}

function resolveArtworkType({ type, candidates = [], fallback = null, context = {} } = {}) {
    if (!_isArtworkType(type)) {
        throw new Error(`Unsupported artwork type: ${type}`);
    }

    const normalized = [];
    candidates.forEach((candidate, index) => {
        const item = normalizeArtworkCandidate(candidate, { type, order: index });
        if (isCandidateEligible(item, context)) normalized.push(item);
    });

    if (fallback) {
        const fallbackCandidate = normalizeArtworkCandidate(fallback, {
            type,
            order: candidates.length,
        });
        if (isCandidateEligible(fallbackCandidate, context)) normalized.push(fallbackCandidate);
    }

    if (!normalized.length) return _stableEmptyResult(type);

    const sorted = normalized.slice().sort(_compareCandidates);
    const winner = sorted[0];
    const output = {
        value: winner.value,
        type: winner.type,
        source: winner.source,
        locked: winner.locked,
        updatedAt: winner.updatedAt,
        confidence: winner.confidence,
        verified: winner.verified,
        cacheOnly: winner.cacheOnly,
        identity: winner.identity ? Object.freeze({ ...winner.identity }) : null,
        reason: `selected ${winner.source} ${type}${winner.alias ? ` via ${winner.alias}` : ''}`,
    };

    return Object.freeze(output);
}

module.exports = {
    ARTWORK_TYPES,
    SOURCE_TIERS,
    normalizeArtworkCandidate,
    isCandidateEligible,
    resolveArtworkType,
};
