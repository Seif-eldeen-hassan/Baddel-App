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

module.exports = {
    createFriendlySyncError,
    summarizeEpicEntryForLog,
    summarizeGameTitles,
    steamGameBelongsToAccount,
};
