'use strict';

function isFallbackTitle(game) {
    const productId = String(game?.productId || game?.allIds?.gog || '').trim();
    return new RegExp(`^GOG\\s+${productId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i').test(String(game?.title || game?.name || '').trim());
}

function hasGoodBasicMetadata(game) {
    return Boolean(String(game?.title || game?.name || '').trim() && !isFallbackTitle(game) && game?.coverUrl);
}

const CLASSIFICATION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function classifySyncCandidate(existing, cachedClassification = null, now = Date.now()) {
    if (existing && hasGoodBasicMetadata(existing)) return 'unchanged';
    const checkedAt = Date.parse(cachedClassification?.checkedAt || '');
    if (!existing && cachedClassification?.kind === 'non-game' && Number.isFinite(checkedAt) && now - checkedAt < CLASSIFICATION_TTL_MS) return 'known-non-game';
    if (!existing) return 'new';
    if (isFallbackTitle(existing)) return 'title-repair';
    if (!existing.coverUrl) return 'cover-repair';
    return 'basic-repair';
}

function preserveLastKnownGood(existing, incoming) {
    if (!existing || !incoming) return incoming || existing || null;
    const merged = { ...existing, ...incoming };
    if (isFallbackTitle(incoming) && !isFallbackTitle(existing)) {
        merged.title = existing.title;
        merged.titleSource = existing.titleSource;
        merged.needsMetadataEnrichment = false;
    }
    for (const key of ['coverUrl', 'heroUrl', 'logoUrl']) {
        if (!incoming[key] && existing[key]) merged[key] = existing[key];
    }
    return merged;
}

module.exports = { CLASSIFICATION_TTL_MS, isFallbackTitle, hasGoodBasicMetadata, classifySyncCandidate, preserveLastKnownGood };
