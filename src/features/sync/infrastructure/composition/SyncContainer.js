'use strict';

const PLATFORM_SYNC_EXPORTS = [
    'registerPlatformSyncHandlers',
    'epicConnector',
    'steamConnector',
    'enrichProfilesWithSyncData',
    'registerPlatformSyncAssetDownloader',
    'autoSyncOnStartup',
    '_mobileApprovalPollStep',
    '_startQrLoginFlow',
    'cacheLibraryCoversFirst',
    '_withConcurrency',
    '_writeSyncLinkToExistingSwitcherProfile',
    '_findMatchingEpicSwitcherProfile',
];

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
    const feature = {};

    for (const name of PLATFORM_SYNC_EXPORTS) {
        feature[name] = platformSyncApi[name];
    }

    return feature;
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
