'use strict';

const SYNC_FEATURE_API_KEYS = Object.freeze([
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
]);

function createSyncFeatureApi(source) {
    if (!source || typeof source !== 'object') {
        throw new TypeError('Sync feature source must be an object');
    }

    const feature = {};
    for (const key of SYNC_FEATURE_API_KEYS) {
        if (!(key in source)) {
            throw new TypeError(`Missing sync feature export: ${key}`);
        }
        feature[key] = source[key];
    }
    return feature;
}

function assertSyncFeatureApi(source) {
    createSyncFeatureApi(source);
    return source;
}

module.exports = {
    SYNC_FEATURE_API_KEYS,
    createSyncFeatureApi,
    assertSyncFeatureApi,
};
