'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SYNC_CONTAINER_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'composition', 'SyncContainer.js');
const MAIN_JS_PATH = path.join(ROOT, 'main.js');
const PRELOAD_JS_PATH = path.join(ROOT, 'preload.js');
const RENDERER_DIR = path.join(ROOT, 'src', 'js');

const EXPECTED_EXPORTS = [
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

function makeFakePlatformSyncApi() {
    const api = {};
    for (const name of EXPECTED_EXPORTS) {
        api[name] = name.endsWith('Connector') ? { name } : function fakeExport() {};
    }
    return api;
}

test('createSyncFeature returns the current platformSync public API shape', () => {
    const { createSyncFeature } = require('../src/features/sync/infrastructure/composition/SyncContainer');
    const platformSyncApi = makeFakePlatformSyncApi();
    const feature = createSyncFeature({ platformSyncApi });

    assert.deepEqual(Object.keys(feature), EXPECTED_EXPORTS);
    for (const name of EXPECTED_EXPORTS) {
        assert.equal(feature[name], platformSyncApi[name], `${name} should be exposed from the wrapped facade`);
    }
});

test('createSyncFeature returns a fresh compatibility feature object', () => {
    const { createSyncFeature } = require('../src/features/sync/infrastructure/composition/SyncContainer');
    const platformSyncApi = makeFakePlatformSyncApi();

    const first = createSyncFeature({ platformSyncApi });
    const second = createSyncFeature({ platformSyncApi });

    assert.notEqual(first, second);
    assert.equal(first.steamConnector, second.steamConnector);
    assert.equal(first.epicConnector, second.epicConnector);
});

test('getSyncFeature returns a singleton identity', () => {
    const containerPath = require.resolve('../src/features/sync/infrastructure/composition/SyncContainer');
    delete require.cache[containerPath];
    const { getSyncFeature } = require('../src/features/sync/infrastructure/composition/SyncContainer');
    const platformSyncApi = makeFakePlatformSyncApi();

    const first = getSyncFeature({ platformSyncApi });
    const second = getSyncFeature({ platformSyncApi: makeFakePlatformSyncApi() });

    assert.equal(first, second);
    assert.equal(first.steamConnector, platformSyncApi.steamConnector);
});

test('SyncContainer import is lazy and accepts injected platformSync API without Electron windows or network', () => {
    const source = fs.readFileSync(SYNC_CONTAINER_PATH, 'utf8');
    const { createSyncFeature } = require('../src/features/sync/infrastructure/composition/SyncContainer');

    assert.doesNotMatch(source, /BrowserWindow/);
    assert.doesNotMatch(source, /execFile/);
    assert.doesNotMatch(source, /app\.getPath/);
    assert.doesNotThrow(() => createSyncFeature({ platformSyncApi: makeFakePlatformSyncApi() }));
});

test('SyncContainer is currently a compatibility wrapper around the platformSync facade', () => {
    const source = fs.readFileSync(SYNC_CONTAINER_PATH, 'utf8');

    assert.match(source, /loadDefaultPlatformSyncApi/);
    assert.match(source, /require\(platformSyncPath\)/);
    assert.match(source, /options\.platformSyncApi/);
    assert.match(source, /options\.loadPlatformSync/);
});

test('platformSync must not import SyncContainer until the dependency is inverted', () => {
    const platformSyncSource = fs.readFileSync(path.join(ROOT, 'platformSync.js'), 'utf8');

    assert.doesNotMatch(platformSyncSource, /SyncContainer/);
    assert.doesNotMatch(platformSyncSource, /getSyncFeature/);
    assert.doesNotMatch(platformSyncSource, /createSyncFeature/);
});

test('production call sites remain on the platformSync facade for this phase', () => {
    const mainSource = fs.readFileSync(MAIN_JS_PATH, 'utf8');
    const preloadSource = fs.readFileSync(PRELOAD_JS_PATH, 'utf8');

    assert.match(mainSource, /require\(['"]\.\/platformSync['"]\)/);
    assert.doesNotMatch(mainSource, /SyncContainer/);
    assert.doesNotMatch(preloadSource, /SyncContainer/);
});

test('SyncContainer does not import main, preload, renderer, or build tooling', () => {
    const source = fs.readFileSync(SYNC_CONTAINER_PATH, 'utf8');

    assert.doesNotMatch(source, /main\.js/);
    assert.doesNotMatch(source, /preload\.js/);
    assert.doesNotMatch(source, /src\/js|src\\js/);
    assert.doesNotMatch(source, /dist:protected|audit:protected|electron-builder/);

    const rendererFiles = fs.readdirSync(RENDERER_DIR, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name);
    assert.ok(rendererFiles.length > 0);
});
