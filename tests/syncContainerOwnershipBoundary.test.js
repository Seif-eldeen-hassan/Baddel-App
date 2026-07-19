'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SYNC_CONTAINER_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'composition', 'SyncContainer.js');
const CREATE_SYNC_CONNECTORS_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'composition', 'createSyncConnectors.js');
const CREATE_PLATFORM_SYNC_FEATURE_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'composition', 'createPlatformSyncFeature.js');
const SYNC_FEATURE_API_CONTRACT_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'composition', 'SyncFeatureApiContract.js');
const SYNC_RUNTIME_STATE_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'runtime', 'SyncRuntimeState.js');
const SYNC_EVENT_EMITTER_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'runtime', 'SyncEventEmitter.js');
const PLATFORM_SYNC_PATH = path.join(ROOT, 'platformSync.js');
const MAIN_JS_PATH = path.join(ROOT, 'main.js');

const {
    SYNC_FEATURE_API_KEYS,
} = require('../src/features/sync/infrastructure/composition/SyncFeatureApiContract');
const {
    CONNECTOR_METHODS,
} = require('../src/features/sync/infrastructure/composition/createSyncConnectors');

function read(filePath) {
    return fs.readFileSync(filePath, 'utf8');
}

function makeFakePlatformSyncApi() {
    const api = {};
    for (const key of SYNC_FEATURE_API_KEYS) {
        api[key] = key.endsWith('Connector') ? Object.fromEntries(CONNECTOR_METHODS.map((method) => [method, function fakeMethod() {}])) : function fakeExport() {};
    }
    return api;
}

test('SyncContainer exists and exposes only the current compatibility entrypoints', () => {
    assert.equal(fs.existsSync(SYNC_CONTAINER_PATH), true, 'SyncContainer.js should exist');

    const container = require('../src/features/sync/infrastructure/composition/SyncContainer');
    assert.deepEqual(Object.keys(container), ['createSyncFeature', 'getSyncFeature']);
    assert.equal(typeof container.createSyncFeature, 'function');
    assert.equal(typeof container.getSyncFeature, 'function');
});

test('SyncContainer remains a facade wrapper and does not own connector construction yet', () => {
    const source = read(SYNC_CONTAINER_PATH);

    assert.match(source, /SyncFeatureApiContract/);
    assert.match(source, /createSyncFeatureApi\(platformSyncApi\)/);
    assert.match(source, /loadDefaultPlatformSyncApi/);
    assert.doesNotMatch(source, /createSyncConnectors/);
    assert.doesNotMatch(source, /steamConnectorMethods|epicConnectorMethods/);
    assert.doesNotMatch(source, /const\s+steamConnector\s*=/);
    assert.doesNotMatch(source, /const\s+epicConnector\s*=/);
    assert.doesNotMatch(source, /registerPlatformSyncHandlers|ipcMain|platform-sync:/);
    assert.doesNotMatch(source, /electron|BrowserWindow|Notification|steamBridge|legendary|execFile/);
    assert.doesNotMatch(source, /SyncRuntimeState|SyncEventEmitter|_platformSyncState/);
});

test('SyncContainer feature behavior preserves current API shape and identity rules', () => {
    const containerPath = require.resolve('../src/features/sync/infrastructure/composition/SyncContainer');
    delete require.cache[containerPath];
    const { createSyncFeature, getSyncFeature } = require('../src/features/sync/infrastructure/composition/SyncContainer');
    const platformSyncApi = makeFakePlatformSyncApi();

    const first = createSyncFeature({ platformSyncApi });
    const second = createSyncFeature({ platformSyncApi });
    assert.deepEqual(Object.keys(first), SYNC_FEATURE_API_KEYS);
    assert.notEqual(first, second);
    assert.equal(first.steamConnector, platformSyncApi.steamConnector);
    assert.equal(first.epicConnector, platformSyncApi.epicConnector);

    const singleton = getSyncFeature({ platformSyncApi });
    assert.equal(getSyncFeature({ platformSyncApi: makeFakePlatformSyncApi() }), singleton);
    assert.equal(singleton.steamConnector, platformSyncApi.steamConnector);
});

test('platformSync still owns connector methods and delegates construction to createSyncConnectors', () => {
    const source = read(PLATFORM_SYNC_PATH);

    assert.match(source, /require\(['"]\.\/src\/features\/sync\/infrastructure\/composition\/createSyncConnectors['"]\)/);
    assert.match(source, /const\s+steamConnectorMethods\s*=\s*\{/);
    assert.match(source, /const\s+epicConnectorMethods\s*=\s*\{/);
    assert.match(source, /const\s+gogConnectorMethods\s*=\s*\{/);
    assert.match(source, /createSyncConnectors\(\{\s*steam:\s*steamConnectorMethods,\s*epic:\s*epicConnectorMethods,\s*gog:\s*gogConnectorMethods,\s*\}\)/);
    assert.match(source, /function\s+registerPlatformSyncHandlers\s*\(/);
    assert.doesNotMatch(source, /require\([^)]*SyncContainer/);
});

test('composition modules keep the current dependency direction before ownership moves', () => {
    const connectorFactorySource = read(CREATE_SYNC_CONNECTORS_PATH);
    const platformFeatureSource = read(CREATE_PLATFORM_SYNC_FEATURE_PATH);
    const apiContractSource = read(SYNC_FEATURE_API_CONTRACT_PATH);
    const mainSource = read(MAIN_JS_PATH);

    assert.doesNotMatch(connectorFactorySource, /platformSync|SyncContainer|electron|steamBridge|legendary|execFile/);
    assert.match(platformFeatureSource, /createSyncFeatureApi/);
    assert.match(apiContractSource, /SYNC_FEATURE_API_KEYS/);
    assert.deepEqual(SYNC_FEATURE_API_KEYS, [
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
    ]);

    assert.match(mainSource, /require\(['"]\.\/src\/features\/sync\/infrastructure\/composition\/SyncContainer['"]\)/);
    assert.match(mainSource, /getSyncFeature\(\)/);
    assert.doesNotMatch(mainSource, /require\(['"]\.\/platformSync['"]\)/);
});

test('future runtime extraction targets remain absent for this phase', () => {
    assert.equal(fs.existsSync(SYNC_RUNTIME_STATE_PATH), false, 'SyncRuntimeState.js should not exist yet');
    assert.equal(fs.existsSync(SYNC_EVENT_EMITTER_PATH), false, 'SyncEventEmitter.js should not exist yet');
    assert.deepEqual(CONNECTOR_METHODS, [
        'isLinked',
        'getAccounts',
        'link',
        'syncLibrary',
        'getCachedLibrary',
        'unlink',
    ]);
});
