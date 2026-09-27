'use strict';

function resolveEpicPriceRetryInput({ mergedLibrary = [], accountId, libraryGamesFetched = 0 } = {}) {
    const list = Array.isArray(mergedLibrary) ? mergedLibrary : [];
    const target = String(accountId || '');
    const stats = list.reduce((out, game) => {
        const owners = Array.isArray(game?.ownedByAccountIds) ? game.ownedByAccountIds : [];
        if (!owners.length) out.withoutOwnershipIds += 1;
        if (owners.some((id) => String(id) === target)) out.withMatchingAccountId += 1;
        return out;
    }, { withoutOwnershipIds: 0, withMatchingAccountId: 0 });
    const games = list.filter((game) => Array.isArray(game?.ownedByAccountIds)
        && game.ownedByAccountIds.some((id) => String(id) === target));
    if (Number(libraryGamesFetched || 0) > 0 && games.length === 0) {
        const error = new Error('Epic price retry could not resolve the saved library for this account.');
        error.code = 'EPIC_PRICE_RETRY_INPUT_EMPTY';
        error.failedStage = 'retry_input_resolution';
        error.progress = { libraryGamesFetched: Number(libraryGamesFetched || 0), matchedAccountGames: 0 };
        error.ownershipStats = stats;
        throw error;
    }
    return { games, stats };
}

module.exports = { resolveEpicPriceRetryInput };
