'use strict';

const value = (input) => String(input || '').trim().toLowerCase();
const EXPLICIT_NON_GAME_TYPES = new Set([
    'addon', 'add_on', 'dlc', 'fab', 'asset', 'marketplace_asset',
    'soundtrack', 'demo', 'beta', 'test', 'editor', 'mod',
]);

function isCanonicalEpicGameRecord(entry = {}) {
    const type = value(entry.epicProductType || entry.productType || entry.product_type || entry.offerType || entry.category);
    return !type || !EXPLICIT_NON_GAME_TYPES.has(type.replace(/[ -]+/g, '_'));
}

function epicCanonicalAliases(entry = {}) {
    const aliases = new Set(Array.isArray(entry.canonicalAliases) ? entry.canonicalAliases.map(value).filter(Boolean) : []);
    const metadata = entry.metadata || entry.epicMetadata || {};
    const assetInfo = Object.values(entry.asset_infos || {})[0] || {};
    const namespace = value(entry.namespace || entry.sandboxId || metadata.namespace || assetInfo.namespace || entry.allIds?.epic);
    const catalog = value(entry.catalogItemId || entry.catalog_item_id || entry.catalogId || metadata.catalogItemId || metadata.id);
    const offer = value(entry.offerId || entry.catalogOfferId || entry.offer_id || metadata.offerId || metadata.catalogOfferId);
    const app = value(entry.appName || entry.app_name || entry.app || entry.launcherGameId);
    const asset = value(entry.assetId || entry.asset_id || assetInfo.assetId);
    if (namespace && catalog) aliases.add(`epic:ns:${namespace}:catalog:${catalog}`);
    if (namespace && offer) aliases.add(`epic:ns:${namespace}:offer:${offer}`);
    if (namespace && app) aliases.add(`epic:ns:${namespace}:app:${app}`);
    if (namespace && asset) aliases.add(`epic:ns:${namespace}:asset:${asset}`);
    if (catalog) aliases.add(`epic:catalog:${catalog}`);
    if (app) aliases.add(`epic:app:${app}`);
    if (asset) aliases.add(`epic:asset:${asset}`);
    return [...aliases];
}

function mergeCanonicalGames(existing, incoming, aliases) {
    const ownedByAccountIds = [...new Set([...(existing.ownedByAccountIds || []), ...(incoming.ownedByAccountIds || [])].map(String))];
    const ownedBy = [...new Set([...(existing.ownedBy || []), ...(incoming.ownedBy || [])].map(String))];
    return {
        ...incoming,
        ...existing,
        coverUrl: existing.coverUrl || incoming.coverUrl || null,
        heroUrl: existing.heroUrl || incoming.heroUrl || null,
        logoUrl: existing.logoUrl || incoming.logoUrl || null,
        namespace: existing.namespace || incoming.namespace || null,
        catalogItemId: existing.catalogItemId || incoming.catalogItemId || null,
        offerId: existing.offerId || incoming.offerId || null,
        appName: existing.appName || incoming.appName || null,
        ownedByAccountIds,
        ownedBy,
        canonicalGameId: existing.canonicalGameId || aliases[0],
        canonicalAliases: aliases,
    };
}

function canonicalizeEpicLibraryGames(entries = []) {
    const games = [];
    const aliasToIndex = new Map();
    let duplicateCollapsedCount = 0;
    let nonGameExcludedCount = 0;
    for (const entry of Array.isArray(entries) ? entries : []) {
        if (!entry || typeof entry !== 'object') continue;
        if (!isCanonicalEpicGameRecord(entry)) {
            nonGameExcludedCount += 1;
            continue;
        }
        const aliases = epicCanonicalAliases(entry);
        const existingIndexes = [...new Set(aliases.map((alias) => aliasToIndex.get(alias)).filter(Number.isInteger))];
        if (!existingIndexes.length) {
            const index = games.length;
            const canonicalGameId = entry.canonicalGameId || aliases[0] || `epic:row:${index}`;
            const canonicalAliases = [...new Set([canonicalGameId, ...aliases])];
            games.push({ ...entry, canonicalGameId, canonicalAliases });
            for (const alias of canonicalAliases) aliasToIndex.set(alias, index);
            continue;
        }
        const index = existingIndexes[0];
        const canonicalAliases = [...new Set([...(games[index].canonicalAliases || []), ...aliases])];
        games[index] = mergeCanonicalGames(games[index], entry, canonicalAliases);
        for (const alias of canonicalAliases) aliasToIndex.set(alias, index);
        duplicateCollapsedCount += 1;
    }
    return {
        games,
        diagnostics: {
            inputCount: Array.isArray(entries) ? entries.length : 0,
            duplicateCollapsedCount,
            nonGameExcludedCount,
            canonicalGameCount: games.length,
        },
    };
}

module.exports = { epicCanonicalAliases, canonicalizeEpicLibraryGames, isCanonicalEpicGameRecord };
