'use strict';

const {
    SYNC_FEATURE_API_KEYS,
    createSyncFeatureApi,
    assertSyncFeatureApi,
} = require('./SyncFeatureApiContract');

function createPlatformSyncFeature(source) {
    return createSyncFeatureApi(source);
}

module.exports = {
    createPlatformSyncFeature,
    createSyncFeatureApi,
    assertSyncFeatureApi,
    SYNC_FEATURE_API_KEYS,
};
