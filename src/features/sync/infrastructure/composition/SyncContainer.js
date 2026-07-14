'use strict';

const {
    createSyncFeatureApi,
} = require('./SyncFeatureApiContract');

function loadDefaultPlatformSyncApi() {
    const platformSyncPath = ['..', '..', '..', '..', '..', 'platformSync'].join('/');
    return require(platformSyncPath);
}

function resolvePlatformSyncApi(options) {
    if (options.platformSyncApi) return options.platformSyncApi;
    if (typeof options.loadPlatformSync === 'function') return options.loadPlatformSync();
    return loadDefaultPlatformSyncApi();
}

function createSyncFeature(options = {}) {
    const platformSyncApi = resolvePlatformSyncApi(options);
    return createSyncFeatureApi(platformSyncApi);
}

let singleton;

function getSyncFeature(options = {}) {
    if (!singleton) {
        singleton = createSyncFeature(options);
    }
    return singleton;
}

module.exports = {
    createSyncFeature,
    getSyncFeature,
};
