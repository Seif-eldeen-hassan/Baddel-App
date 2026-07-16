'use strict';

const PLATFORM_LABELS = {
    steam: 'Steam',
    epic: 'Epic',
    riot: 'Riot Games',
    ea: 'EA',
    ubisoft: 'Ubisoft',
    xbox: 'Xbox',
    manual: 'Manual',
};

function normalizeText(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[®©™]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function compactText(value) {
    return normalizeText(value).replace(/\s+/g, '');
}

function normalizePlatform(value) {
    const raw = String(value || '').toLowerCase().trim();
    if (!raw) return '';
    if (raw.includes('steam')) return 'steam';
    if (raw.includes('epic')) return 'epic';
    if (raw.includes('riot')) return 'riot';
    if (raw.includes('ea') || raw.includes('origin')) return 'ea';
    if (raw.includes('ubisoft') || raw.includes('uplay')) return 'ubisoft';
    if (raw.includes('xbox') || raw.includes('microsoft') || raw === 'store') return 'xbox';
    if (raw.includes('manual')) return 'manual';
    return raw;
}

function displayPlatform(value) {
    const key = normalizePlatform(value);
    return PLATFORM_LABELS[key] || value || key || 'Manual';
}

function addUnique(list, value) {
    const label = displayPlatform(value);
    if (!label) return;
    if (!list.some(item => normalizePlatform(item) === normalizePlatform(label))) {
        list.push(label);
    }
}

function allPlatformHints(game = {}) {
    const out = [];
    if (game.platform) out.push(game.platform);
    if (game.scannerPlatform) out.push(game.scannerPlatform);
    if (game.installSource) out.push(game.installSource);
    if (game.source) out.push(game.source);
    if (Array.isArray(game.platforms)) out.push(...game.platforms);
    if (Array.isArray(game.sources)) out.push(...game.sources);
    return out;
}

function hasPlatform(game, platform) {
    const wanted = normalizePlatform(platform);
    return allPlatformHints(game).some(hint => normalizePlatform(hint) === wanted);
}

function stringHaystack(game = {}) {
    return [
        game.command,
        game.launchCommand,
        game.path,
        game.executablePath,
        game.installPath,
        game.executable,
        game.launcherGameId,
        game.appName,
        game.id,
    ].map(value => String(value || '').toLowerCase()).join(' ');
}

function hasRiotValorantRuntimeEvidence(game = {}) {
    const haystack = stringHaystack(game);
    return (
        String(game.riotProduct || '').toLowerCase() === 'valorant' ||
        String(game.allIds?.riot || '').toLowerCase() === 'valorant' ||
        (String(game.launcherGameId || '').toLowerCase() === 'valorant' && hasPlatform(game, 'riot')) ||
        haystack.includes('--launch-product=valorant') ||
        haystack.includes('launch-product=valorant') ||
        haystack.includes('valorant-win64-shipping') ||
        (haystack.includes('riotclientservices') && haystack.includes('valorant'))
    );
}

function hasEpicValorantOwnershipEvidence(game = {}) {
    if (!hasPlatform(game, 'epic')) return false;
    const title = compactText(game.title || game.name);
    if (title !== 'valorant') return false;

    const hasStructuredEpicSignal = !!(
        game.appName ||
        game.launcherGameId ||
        game.catalogItemId ||
        game.namespace ||
        game.allIds?.epic ||
        String(game.id || '').toLowerCase().startsWith('epic-')
    );
    if (!hasStructuredEpicSignal) return false;

    const haystack = stringHaystack(game);
    return (
        haystack.includes('valorant') ||
        title === 'valorant'
    );
}

function deriveCanonicalProductIdentity(game = {}) {
    if (!game || typeof game !== 'object') return null;

    if (hasRiotValorantRuntimeEvidence(game)) {
        return {
            productKey: 'riot:valorant',
            product: 'valorant',
            runtimePlatform: 'riot',
            ownershipPlatforms: ['riot', 'epic'],
            evidence: ['riot-runtime'],
        };
    }

    if (hasEpicValorantOwnershipEvidence(game)) {
        return {
            productKey: 'riot:valorant',
            product: 'valorant',
            runtimePlatform: 'riot',
            ownershipPlatforms: ['riot', 'epic'],
            evidence: ['curated-epic-valorant'],
        };
    }

    return null;
}

function isDelegatedLaunchProduct(productKey) {
    return productKey === 'riot:valorant';
}

function hasLaunchData(game = {}) {
    return !!(game.command || game.launchCommand || game.path || game.executablePath || game.installPath);
}

function runtimeScore(game = {}) {
    let score = 0;
    if (hasPlatform(game, 'riot')) score += 100;
    if (hasRiotValorantRuntimeEvidence(game)) score += 90;
    if (game.command || game.launchCommand) score += 30;
    if (game.path || game.executablePath || game.installPath) score += 20;
    if (game.isInstalled || game.installVerified || hasLaunchData(game)) score += 10;
    if (hasPlatform(game, 'epic') && !hasPlatform(game, 'riot')) score -= 40;
    return score;
}

function chooseCanonicalProductRecord(records = []) {
    const candidates = records.filter(Boolean);
    if (candidates.length === 0) return null;
    return candidates
        .map((record, index) => ({ record, index, score: runtimeScore(record) }))
        .sort((a, b) => (b.score - a.score) || (a.index - b.index))[0].record;
}

function collectSourcePlatforms(records = []) {
    const platforms = [];
    for (const record of records) {
        for (const hint of allPlatformHints(record)) addUnique(platforms, hint);
    }
    return platforms;
}

function mergeArrays(...arrays) {
    const out = [];
    for (const arr of arrays) {
        if (!Array.isArray(arr)) continue;
        for (const item of arr) {
            if (item == null) continue;
            if (!out.some(existing => String(existing).toLowerCase() === String(item).toLowerCase())) {
                out.push(item);
            }
        }
    }
    return out;
}

function mergeDelegatedProductRecords(records = []) {
    const valid = records.filter(Boolean);
    if (valid.length <= 1) return valid[0] || null;

    const canonical = chooseCanonicalProductRecord(valid);
    if (!canonical) return valid[0] || null;

    const identity = deriveCanonicalProductIdentity(canonical) || deriveCanonicalProductIdentity(valid[0]);
    const sourceRecordIds = mergeArrays(
        valid.map(record => record.id || record.gameId || record.appName || record.launcherGameId),
        ...valid.map(record => record.sourceRecordIds)
    );
    const platforms = collectSourcePlatforms(valid);
    addUnique(platforms, 'Riot Games');

    const ownershipPlatforms = [...platforms];
    for (const record of valid) {
        if (hasPlatform(record, 'epic')) addUnique(ownershipPlatforms, 'Epic');
        if (hasPlatform(record, 'riot')) addUnique(ownershipPlatforms, 'Riot Games');
    }

    const mergedAllIds = {};
    for (const record of valid) Object.assign(mergedAllIds, record.allIds || {});
    for (const record of valid) {
        if (hasPlatform(record, 'epic')) {
            const epicId = record.appName || record.launcherGameId || record.id;
            if (epicId && !mergedAllIds.epic) mergedAllIds.epic = epicId;
        }
        if (hasPlatform(record, 'riot')) {
            const riotId = record.riotProduct || record.allIds?.riot || record.launcherGameId || 'valorant';
            if (riotId && !mergedAllIds.riot) mergedAllIds.riot = riotId;
        }
    }

    return {
        ...valid.reduce((acc, record) => ({
            ...acc,
            favorites: acc.favorites || record.favorites,
            favorite: acc.favorite || record.favorite,
            collectionIds: mergeArrays(acc.collectionIds, record.collectionIds),
        }), {}),
        ...canonical,
        canonicalProductKey: identity?.productKey || 'riot:valorant',
        delegatedRuntimePlatform: identity?.runtimePlatform || 'riot',
        platform: displayPlatform('riot'),
        platforms,
        sources: platforms,
        ownershipPlatforms,
        sourceRecordIds,
        allIds: mergedAllIds,
        installedId: canonical.installedId || canonical.id,
        isInstalled: canonical.isInstalled !== false,
    };
}

function dedupeDelegatedLaunchProducts(games = []) {
    if (!Array.isArray(games)) return games;

    const groups = new Map();
    const result = [];

    games.forEach((game) => {
        const identity = deriveCanonicalProductIdentity(game);
        if (!identity || !isDelegatedLaunchProduct(identity.productKey)) {
            result.push(game);
            return;
        }

        if (!groups.has(identity.productKey)) {
            const marker = { productKey: identity.productKey };
            groups.set(identity.productKey, { marker, records: [] });
            result.push(marker);
        }
        groups.get(identity.productKey).records.push(game);
    });

    return result.map(item => {
        if (!item || !item.productKey || !groups.has(item.productKey)) return item;
        const group = groups.get(item.productKey);
        return mergeDelegatedProductRecords(group.records);
    }).filter(Boolean);
}

const api = {
    normalizePlatform,
    deriveCanonicalProductIdentity,
    isDelegatedLaunchProduct,
    chooseCanonicalProductRecord,
    mergeDelegatedProductRecords,
    dedupeDelegatedLaunchProducts,
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
}

if (typeof window !== 'undefined') {
    window.BaddelCanonicalProductIdentity = api;
}
