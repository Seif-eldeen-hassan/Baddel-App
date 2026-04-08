'use strict';

function asId(value) {
    return value == null ? '' : String(value);
}

function cloneGame(game) {
    return JSON.parse(JSON.stringify(game));
}

function orderAccountsForSync(accounts, preferredAccountId) {
    const preferred = asId(preferredAccountId).trim();
    if (!preferred) return [...accounts];
    return [
        ...accounts.filter((account) => asId(account.id) === preferred),
        ...accounts.filter((account) => asId(account.id) !== preferred),
    ];
}

function countGamesForAccount(platform, games, accountId) {
    const aid = asId(accountId);
    if (!aid) return 0;

    return (games || []).filter((game) => {
        if (!game || typeof game !== 'object') return false;

        // Check primary ownership array
        if (Array.isArray(game.ownedByAccountIds) && game.ownedByAccountIds.some((id) => asId(id) === aid)) {
            return true;
        }

        // Steam-specific additional arrays
        if (platform === 'steam') {
            if (Array.isArray(game.steamLicensedAccountIds) && game.steamLicensedAccountIds.some((id) => asId(id) === aid)) {
                return true;
            }
            if (Array.isArray(game.steamDetectedAccountIds) && game.steamDetectedAccountIds.some((id) => asId(id) === aid)) {
                return true;
            }
        }

        return false;
    }).length;
}

function mergeAccountIntoSteamGame(target, source, account) {
    const accountId = asId(account.id);
    const displayName = account.displayName || '';

    if (!Array.isArray(target.ownedBy)) target.ownedBy = [];
    if (!Array.isArray(target.ownedByAccountIds)) target.ownedByAccountIds = [];
    if (!Array.isArray(target.steamLicensedAccountIds)) target.steamLicensedAccountIds = [];

    if (displayName && !target.ownedBy.includes(displayName)) {
        target.ownedBy.push(displayName);
    }
    if (!target.ownedByAccountIds.some((id) => asId(id) === accountId)) {
        target.ownedByAccountIds.push(accountId);
    }

    const sourceLicensed = Array.isArray(source.steamLicensedAccountIds) && source.steamLicensedAccountIds.length > 0
        ? source.steamLicensedAccountIds
        : source.ownedByAccountIds;

    if (Array.isArray(sourceLicensed) && sourceLicensed.some((id) => asId(id) === accountId)) {
        if (!target.steamLicensedAccountIds.some((id) => asId(id) === accountId)) {
            target.steamLicensedAccountIds.push(accountId);
        }
    }
}

function mergeAccountIntoGenericGame(target, account) {
    const accountId = asId(account.id);
    const displayName = account.displayName || '';

    if (!Array.isArray(target.ownedBy)) target.ownedBy = [];
    if (!Array.isArray(target.ownedByAccountIds)) target.ownedByAccountIds = [];

    if (displayName && !target.ownedBy.includes(displayName)) {
        target.ownedBy.push(displayName);
    }
    if (!target.ownedByAccountIds.some((id) => asId(id) === accountId)) {
        target.ownedByAccountIds.push(accountId);
    }
}

function preservePreviousAccountData(platform, previousGames, nextGamesMap, account) {
    const accountId = asId(account.id);
    let restored = 0;

    for (const previousGame of previousGames || []) {
        const ownsGame = countGamesForAccount(platform, [previousGame], accountId) > 0;
        if (!ownsGame) continue;

        if (nextGamesMap.has(previousGame.id)) {
            const existing = nextGamesMap.get(previousGame.id);
            if (platform === 'steam') {
                mergeAccountIntoSteamGame(existing, previousGame, account);
            } else {
                mergeAccountIntoGenericGame(existing, account);
            }
        } else {
            nextGamesMap.set(previousGame.id, cloneGame(previousGame));
        }
        restored++;
    }

    return restored;
}

function sanitizeGames(games, issues) {
    const sanitized = [];
    const seenIds = new Set();

    for (const game of games || []) {
        if (!game || typeof game !== 'object') {
            issues.push('Ignored invalid game record.');
            continue;
        }

        const id = asId(game.id).trim();
        if (!id) {
            issues.push('Ignored game without id.');
            continue;
        }

        if (seenIds.has(id)) {
            issues.push(`Ignored duplicate game id: ${id}`);
            continue;
        }

        seenIds.add(id);
        sanitized.push(cloneGame(game));
    }

    return sanitized;
}

function finalizeLibraryForAccounts({ platform, previousGames = [], nextGames = [], accounts = [], accountResults = {} }) {
    const issues = [];
    const sanitizedGames = sanitizeGames(nextGames, issues);
    const nextGamesMap = new Map(sanitizedGames.map((game) => [game.id, game]));

    for (const account of accounts) {
        const accountId = asId(account.id);
        const previousCount = countGamesForAccount(platform, previousGames, accountId);
        const nextCount = countGamesForAccount(platform, sanitizedGames, accountId);
        const result = accountResults[accountId] || {};
        const shouldPreserve = previousCount > 0 && nextCount === 0 && result.allowZeroGames !== true;

        if (!shouldPreserve) continue;

        const looksUnreliable =
            result.status !== 'success' ||
            result.rawGamesCount === 0 ||
            result.validationFailed === true;

        if (!looksUnreliable) continue;

        const restored = preservePreviousAccountData(platform, previousGames, nextGamesMap, account);
        if (restored > 0) {
            issues.push(`Preserved ${restored} cached games for ${account.displayName || accountId}.`);
        }
    }

    const finalGames = Array.from(nextGamesMap.values());
    const countsByAccount = Object.fromEntries(
        accounts.map((account) => [asId(account.id), countGamesForAccount(platform, finalGames, account.id)])
    );

    return {
        games: finalGames,
        validation: {
            ok: issues.length === 0,
            issues,
            countsByAccount,
            totalGames: finalGames.length,
        },
    };
}

function removeAccountFromLibrary(platform, games = [], account = {}) {
    const accountId = asId(account.id);
    const displayName = String(account.displayName || '').trim();
    if (!accountId) return [...(games || [])]; // Safety check

    const filteredGames = [];

    for (const originalGame of games || []) {
        if (!originalGame || typeof originalGame !== 'object') continue;

        const game = cloneGame(originalGame);

        // 1. Filter out the unlinked account's ID from all possible ID arrays
        if (Array.isArray(game.ownedByAccountIds)) {
            game.ownedByAccountIds = game.ownedByAccountIds.filter((id) => asId(id) !== accountId);
        }
        if (Array.isArray(game.steamLicensedAccountIds)) {
            game.steamLicensedAccountIds = game.steamLicensedAccountIds.filter((id) => asId(id) !== accountId);
        }
        if (Array.isArray(game.steamDetectedAccountIds)) {
            game.steamDetectedAccountIds = game.steamDetectedAccountIds.filter((id) => asId(id) !== accountId);
        }

        // 2. Filter out the unlinked account's name from the display name array
        if (Array.isArray(game.ownedBy) && displayName) {
            game.ownedBy = game.ownedBy.filter((name) => String(name || '').trim().toLowerCase() !== displayName.toLowerCase());
        }

        // 3. Keep the game if at least one OTHER account still owns it, OR if it's installed locally
        const hasOtherOwners = (
            (Array.isArray(game.ownedByAccountIds) && game.ownedByAccountIds.length > 0) ||
            (Array.isArray(game.steamLicensedAccountIds) && game.steamLicensedAccountIds.length > 0) ||
            (Array.isArray(game.steamDetectedAccountIds) && game.steamDetectedAccountIds.length > 0)
        );

        if (hasOtherOwners || game.installOnly === true) {
            filteredGames.push(game);
        }
    }

    return filteredGames;
}

module.exports = {
    orderAccountsForSync,
    countGamesForAccount,
    preservePreviousAccountData,
    finalizeLibraryForAccounts,
    removeAccountFromLibrary,
};
