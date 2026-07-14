'use strict';

const {
    PlatformSyncCacheRepository,
} = require('../repositories/PlatformSyncCacheRepository');
const {
    EpicSwitcherRepository,
} = require('../repositories/EpicSwitcherRepository');

function createConnectorRepositoryBundle(options = {}) {
    const {
        cacheRepository,
        epicSwitcherRepository,
        cacheRepositoryOptions,
        epicSwitcherRepositoryOptions,
    } = options;

    return {
        syncCacheRepository: cacheRepository || new PlatformSyncCacheRepository(cacheRepositoryOptions),
        epicSwitcherRepository: epicSwitcherRepository || new EpicSwitcherRepository(epicSwitcherRepositoryOptions),
    };
}

module.exports = {
    createConnectorRepositoryBundle,
};
