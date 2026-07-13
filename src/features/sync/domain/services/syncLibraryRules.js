'use strict';

function createFriendlySyncError(platform, err) {
    const rawMessage = String(err?.message || err || 'Unknown error').trim();
    const lower = rawMessage.toLowerCase();

    if (lower.includes('timeout')) {
        return {
            userMessage: platform === 'steam'
                ? 'Steam took too long to reply. We kept the previous library data and saved diagnostics.'
                : 'Epic Games took too long to reply. We kept the previous library data and saved diagnostics.',
            diagnosticMessage: rawMessage,
        };
    }

    if (lower.includes('credentials folder is missing')) {
        return {
            userMessage: 'The saved account data is incomplete. Please relink this account and try again.',
            diagnosticMessage: rawMessage,
        };
    }

    if (lower.includes('not authenticated') || lower.includes('authentication')) {
        return {
            userMessage: 'Authentication did not finish correctly. Please sign in again.',
            diagnosticMessage: rawMessage,
        };
    }

    return {
        userMessage: rawMessage || 'Sync failed. We kept the previous library data.',
        diagnosticMessage: rawMessage || 'Unknown sync error',
    };
}

function summarizeEpicEntryForLog(entry) {
    return {
        app_name:    entry?.app_name,
        app_title:   entry?.app_title || entry?.title,
        namespace:   entry?.namespace || entry?.metadata?.namespace,
        productType: entry?.metadata?.productType
                  || entry?.metadata?.customAttributes?.productType?.value
                  || entry?.app_type
                  || entry?.type,
        categories:  entry?.metadata?.categories,
    };
}

function summarizeGameTitles(games, limit = 4) {
    return [...new Set(
        (games || [])
            .map((game) => String(game?.title || '').trim())
            .filter(Boolean)
    )].slice(0, limit);
}

function steamGameBelongsToAccount(game, accountId) {
    const aid = String(accountId);
    if (!game || typeof game !== 'object') return false;

    // Local install detection is not evidence of a Steam license.
    if (Array.isArray(game.steamLicensedAccountIds) && game.steamLicensedAccountIds.map(String).includes(aid)) {
        return true;
    }
    if (Array.isArray(game.ownedByAccountIds) && game.ownedByAccountIds.map(String).includes(aid)) {
        return true;
    }

    return false;
}

function mergeOwnedGamesIntoLibrary(mergedLibrary, games, account, platform) {
    const aid = String(account.id);
    for (const game of games) {
        if (mergedLibrary.has(game.id)) {
            const existing = mergedLibrary.get(game.id);
            if (!existing.ownedBy.includes(account.displayName)) existing.ownedBy.push(account.displayName);
            if (!existing.ownedByAccountIds.map(String).includes(aid)) existing.ownedByAccountIds.push(aid);
            if (platform === 'steam') {
                if (!existing.steamLicensedAccountIds) existing.steamLicensedAccountIds = [];
                if (!existing.steamLicensedAccountIds.map(String).includes(aid)) existing.steamLicensedAccountIds.push(aid);
            }
            continue;
        }
        mergedLibrary.set(game.id, game);
    }
}

function mergeExistingEpicOwnership(targetGame, previousGame, targetAccountId) {
    const targetAid = String(targetAccountId);

    if (!Array.isArray(targetGame.ownedBy)) targetGame.ownedBy = [];
    if (!Array.isArray(targetGame.ownedByAccountIds)) targetGame.ownedByAccountIds = [];

    for (const prevAid of (previousGame.ownedByAccountIds || [])) {
        const prevAidStr = String(prevAid);
        if (prevAidStr === targetAid) continue;
        if (!targetGame.ownedByAccountIds.some((id) => String(id) === prevAidStr)) {
            targetGame.ownedByAccountIds.push(prevAidStr);
        }
    }

    for (const prevName of (previousGame.ownedBy || [])) {
        const prevNameStr = String(prevName || '').trim();
        if (!prevNameStr) continue;
        if (!targetGame.ownedBy.includes(prevNameStr)) {
            targetGame.ownedBy.push(prevNameStr);
        }
    }
}

module.exports = {
    createFriendlySyncError,
    mergeExistingEpicOwnership,
    mergeOwnedGamesIntoLibrary,
    summarizeEpicEntryForLog,
    summarizeGameTitles,
    steamGameBelongsToAccount,
};
