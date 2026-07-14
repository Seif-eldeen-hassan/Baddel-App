'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const BUILDER_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'composition', 'createPlatformSyncFeature.js');

const {
    SYNC_FEATURE_API_KEYS,
    createPlatformSyncFeature,
} = require('../src/features/sync/infrastructure/composition/createPlatformSyncFeature');

function makeSource() {
    const source = {};
    for (const key of SYNC_FEATURE_API_KEYS) {
        source[key] = key.endsWith('Connector') ? { key } : function fakeExport() {};
    }
    return source;
}

test('createPlatformSyncFeature returns exactly the expected platform sync API shape', () => {
    const api = createPlatformSyncFeature(makeSource());

    assert.deepEqual(Object.keys(api), SYNC_FEATURE_API_KEYS);
});

test('createPlatformSyncFeature preserves connector and function identity', () => {
    const source = makeSource();
    const api = createPlatformSyncFeature(source);

    assert.notEqual(api, source);
    assert.equal(api.steamConnector, source.steamConnector);
    assert.equal(api.epicConnector, source.epicConnector);
    assert.equal(api.registerPlatformSyncHandlers, source.registerPlatformSyncHandlers);
    assert.equal(api.cacheLibraryCoversFirst, source.cacheLibraryCoversFirst);
});

test('createPlatformSyncFeature enforces missing source and missing key errors', () => {
    assert.throws(() => createPlatformSyncFeature(null), /Sync feature source must be an object/);
    assert.throws(() => createPlatformSyncFeature(undefined), /Sync feature source must be an object/);

    const source = makeSource();
    delete source.autoSyncOnStartup;
    assert.throws(() => createPlatformSyncFeature(source), /Missing sync feature export: autoSyncOnStartup/);
});

test('createPlatformSyncFeature is pure and does not import runtime modules', () => {
    const source = fs.readFileSync(BUILDER_PATH, 'utf8');

    assert.match(source, /SyncFeatureApiContract/);
    assert.doesNotMatch(source, /platformSync/);
    assert.doesNotMatch(source, /SyncContainer/);
    assert.doesNotMatch(source, /electron|BrowserWindow|app\.getPath/);
    assert.doesNotMatch(source, /main\.js|preload\.js|src\/js|src\\js/);
    assert.doesNotMatch(source, /repositories|services|steamBridge|baddelApi|legendary|execFile/);
});
