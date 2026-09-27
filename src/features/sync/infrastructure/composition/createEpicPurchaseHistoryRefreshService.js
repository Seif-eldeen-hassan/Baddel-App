'use strict';

const {
    EpicPurchaseHistoryRefreshService,
} = require('../../application/services/EpicPurchaseHistoryRefreshService');

/**
 * Production dependency assembly for Epic Purchase History refreshes.
 * The persistent-session fallback is deliberately mandatory here.
 */
function createEpicPurchaseHistoryRefreshService(deps = {}) {
    if (typeof deps.resolveEpicPersistentSessionIdentity !== 'function') {
        throw new TypeError(
            'Epic Purchase History production composition requires resolveEpicPersistentSessionIdentity.'
        );
    }

    return new EpicPurchaseHistoryRefreshService({
        ...deps,
        verifyIdentity: deps.verifyEpicWebIdentity,
        resolvePersistentSessionIdentity: deps.resolveEpicPersistentSessionIdentity,
        fetchHistory: deps.fetchEpicOrderHistoryWithSession,
    });
}

module.exports = { createEpicPurchaseHistoryRefreshService };
