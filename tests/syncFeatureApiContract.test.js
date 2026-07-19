'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CONTRACT_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'composition', 'SyncFeatureApiContract.js');

const EXPECTED_KEYS = [
    'registerPlatformSyncHandlers',
    'epicConnector',
    'steamConnector',
    'gogConnector',
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

function makeSource() {
    const source = {};
    for (const key of EXPECTED_KEYS) {
        source[key] = key.endsWith('Connector') ? { key } : function namedExport() {};
    }
    source.extraExport = function extraExport() {};
    return source;
}

test('SYNC_FEATURE_API_KEYS contains the current platform sync API keys in order', () => {
    const { SYNC_FEATURE_API_KEYS } = require('../src/features/sync/infrastructure/composition/SyncFeatureApiContract');

    assert.deepEqual(SYNC_FEATURE_API_KEYS, EXPECTED_KEYS);
    assert.equal(Object.isFrozen(SYNC_FEATURE_API_KEYS), true);
});

test('createSyncFeatureApi returns exactly the expected API shape', () => {
    const { createSyncFeatureApi } = require('../src/features/sync/infrastructure/composition/SyncFeatureApiContract');
    const api = createSyncFeatureApi(makeSource());

    assert.deepEqual(Object.keys(api), EXPECTED_KEYS);
    assert.equal('extraExport' in api, false);
});

test('createSyncFeatureApi preserves connector and function identity', () => {
    const { createSyncFeatureApi } = require('../src/features/sync/infrastructure/composition/SyncFeatureApiContract');
    const source = makeSource();
    const api = createSyncFeatureApi(source);

    assert.equal(api.steamConnector, source.steamConnector);
    assert.equal(api.epicConnector, source.epicConnector);
    assert.equal(api.gogConnector, source.gogConnector);
    assert.equal(api.registerPlatformSyncHandlers, source.registerPlatformSyncHandlers);
    assert.equal(api.cacheLibraryCoversFirst, source.cacheLibraryCoversFirst);
});

test('createSyncFeatureApi throws for missing or incomplete sources', () => {
    const { createSyncFeatureApi } = require('../src/features/sync/infrastructure/composition/SyncFeatureApiContract');
    const source = makeSource();
    delete source.autoSyncOnStartup;

    assert.throws(() => createSyncFeatureApi(null), /Sync feature source must be an object/);
    assert.throws(() => createSyncFeatureApi(undefined), /Sync feature source must be an object/);
    assert.throws(() => createSyncFeatureApi(source), /Missing sync feature export: autoSyncOnStartup/);
});

test('assertSyncFeatureApi validates shape and returns the original source', () => {
    const { assertSyncFeatureApi } = require('../src/features/sync/infrastructure/composition/SyncFeatureApiContract');
    const source = makeSource();

    assert.equal(assertSyncFeatureApi(source), source);
});

test('SyncFeatureApiContract is pure and does not import runtime modules', () => {
    const source = fs.readFileSync(CONTRACT_PATH, 'utf8');

    assert.doesNotMatch(source, /platformSync/);
    assert.doesNotMatch(source, /SyncContainer/);
    assert.doesNotMatch(source, /electron|BrowserWindow|app\.getPath/);
    assert.doesNotMatch(source, /main\.js|preload\.js|src\/js|src\\js/);
    assert.doesNotMatch(source, /repositories|services|steamBridge|baddelApi/);
});
