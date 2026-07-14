'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MAIN_JS_PATH = path.join(ROOT, 'main.js');
const PLATFORM_SYNC_PATH = path.join(ROOT, 'platformSync.js');
const SYNC_CONTAINER_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'composition', 'SyncContainer.js');
const CREATE_SYNC_CONNECTORS_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'composition', 'createSyncConnectors.js');
const SYNC_FEATURE_API_CONTRACT_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'composition', 'SyncFeatureApiContract.js');
const SYNC_RUNTIME_STATE_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'runtime', 'SyncRuntimeState.js');
const SYNC_EVENT_EMITTER_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'runtime', 'SyncEventEmitter.js');

const {
    SYNC_FEATURE_API_KEYS,
} = require('../src/features/sync/infrastructure/composition/SyncFeatureApiContract');
const {
    CONNECTOR_METHODS,
} = require('../src/features/sync/infrastructure/composition/createSyncConnectors');

const MAIN_USED_SYNC_KEYS = [
    'registerPlatformSyncHandlers',
    'steamConnector',
    'epicConnector',
    'registerPlatformSyncAssetDownloader',
    'autoSyncOnStartup',
];

function read(filePath) {
    return fs.readFileSync(filePath, 'utf8');
}

function makeFakePlatformSyncApi() {
    const api = {};
    for (const key of SYNC_FEATURE_API_KEYS) {
        api[key] = key.endsWith('Connector')
            ? Object.fromEntries(CONNECTOR_METHODS.map((method) => [method, function fakeConnectorMethod() {}]))
            : function fakeSyncExport() {};
    }
    return api;
}

test('main.js keeps the current direct platformSync destructuring boundary', () => {
    const source = read(MAIN_JS_PATH);
    const importMatch = source.match(/const\s+\{([^}]+)\}\s*=\s*require\(['"]\.\/platformSync['"]\)/);

    assert.ok(importMatch, 'main.js should directly require ./platformSync for this phase');
    const importedNames = importMatch[1].split(',').map((name) => name.trim()).filter(Boolean);
    assert.deepEqual(importedNames, MAIN_USED_SYNC_KEYS);
    assert.doesNotMatch(source, /SyncContainer/);
    assert.doesNotMatch(source, /createSyncConnectors/);
    assert.doesNotMatch(source, /getSyncFeature/);
});

test('main.js platformSync imports are used at the current startup and achievement seams', () => {
    const source = read(MAIN_JS_PATH);

    assert.match(source, /registerPlatformSyncHandlers\(ipcMain,\s*\(\)\s*=>\s*mainWindow\)/);
    assert.match(source, /runAfterStartupGrace\(['"]autoSyncOnStartup['"],\s*\(\)\s*=>\s*autoSyncOnStartup\(\),\s*45000\)/);
    assert.match(source, /const\s+accounts\s*=\s*steamConnector\?\.getAccounts\?\.\(\)\s*\|\|\s*\[\]/);
    assert.match(source, /registerPlatformSyncAssetDownloader\(_downloadAssetsToCache\)/);

    assert.equal((source.match(/\bsteamConnector\b/g) || []).length, 2);
    assert.equal((source.match(/\bepicConnector\b/g) || []).length, 1);
});

test('platformSync continues to export every sync dependency used by main.js', () => {
    const source = read(PLATFORM_SYNC_PATH);

    assert.match(source, /module\.exports\s*=\s*createPlatformSyncFeature\(\{/);
    for (const key of MAIN_USED_SYNC_KEYS) {
        assert.match(source, new RegExp(`\\b${key}\\b`), `${key} should remain visible in platformSync.js`);
        assert.ok(SYNC_FEATURE_API_KEYS.includes(key), `${key} should remain in the sync feature API contract`);
    }
});

test('SyncContainer can expose the main.js dependency keys without changing production imports yet', () => {
    const containerPath = require.resolve('../src/features/sync/infrastructure/composition/SyncContainer');
    delete require.cache[containerPath];
    const { createSyncFeature, getSyncFeature } = require('../src/features/sync/infrastructure/composition/SyncContainer');
    const platformSyncApi = makeFakePlatformSyncApi();

    const feature = createSyncFeature({ platformSyncApi });
    const singleton = getSyncFeature({ platformSyncApi });

    for (const key of MAIN_USED_SYNC_KEYS) {
        assert.equal(feature[key], platformSyncApi[key], `${key} should be forwarded by createSyncFeature`);
        assert.equal(singleton[key], platformSyncApi[key], `${key} should be forwarded by getSyncFeature`);
    }
    assert.notEqual(createSyncFeature({ platformSyncApi }), feature);
    assert.equal(getSyncFeature({ platformSyncApi: makeFakePlatformSyncApi() }), singleton);
});

test('composition direction remains unchanged before main.js migration', () => {
    const mainSource = read(MAIN_JS_PATH);
    const platformSyncSource = read(PLATFORM_SYNC_PATH);
    const syncContainerSource = read(SYNC_CONTAINER_PATH);
    const connectorFactorySource = read(CREATE_SYNC_CONNECTORS_PATH);
    const apiContractSource = read(SYNC_FEATURE_API_CONTRACT_PATH);

    assert.match(syncContainerSource, /require\(platformSyncPath\)/);
    assert.match(apiContractSource, /SYNC_FEATURE_API_KEYS/);
    assert.doesNotMatch(mainSource, /SyncContainer|getSyncFeature|createSyncConnectors/);
    assert.doesNotMatch(platformSyncSource, /require\([^)]*SyncContainer/);
    assert.doesNotMatch(connectorFactorySource, /platformSync|SyncContainer/);
});

test('future runtime extraction targets remain absent before migration', () => {
    assert.equal(fs.existsSync(SYNC_RUNTIME_STATE_PATH), false, 'SyncRuntimeState.js should not exist yet');
    assert.equal(fs.existsSync(SYNC_EVENT_EMITTER_PATH), false, 'SyncEventEmitter.js should not exist yet');
});
