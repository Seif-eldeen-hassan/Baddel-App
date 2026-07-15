'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.resolve(__dirname, '..');
const PLATFORM_SYNC_PATH = path.join(ROOT, 'platformSync.js');
const MAIN_JS_PATH = path.join(ROOT, 'main.js');
const SYNC_CONTAINER_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'composition', 'SyncContainer.js');
const CREATE_SYNC_CONNECTORS_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'composition', 'createSyncConnectors.js');
const CONNECTOR_KEYS = ['isLinked', 'getAccounts', 'link', 'syncLibrary', 'getCachedLibrary', 'unlink'];

function clearModule(modulePath) {
    const resolved = require.resolve(modulePath);
    delete require.cache[resolved];
}

function clearPlatformSyncCache() {
    const target = PLATFORM_SYNC_PATH.toLowerCase();
    for (const key of Object.keys(require.cache)) {
        const lower = key.toLowerCase();
        if (
            lower === target ||
            lower.endsWith(`${path.sep}analytics.js`) ||
            lower.endsWith(`${path.sep}steambridge.js`) ||
            lower.includes(`${path.sep}services${path.sep}baddelapi.js`) ||
            lower.includes(`${path.sep}services${path.sep}credentialvalidator.js`) ||
            lower.includes(`${path.sep}src${path.sep}features${path.sep}games${path.sep}infrastructure${path.sep}composition${path.sep}gamescontainer.js`)
        ) {
            delete require.cache[key];
        }
    }
}

function loadPlatformSyncShapeOnly() {
    clearPlatformSyncCache();
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-sync-boundary-'));
    const originalLoad = Module._load;

    Module._load = function patchedLoad(request) {
        if (request === 'electron') {
            return {
                app: { getPath: () => userData },
                BrowserWindow: class {
                    static fromWebContents() { return null; }
                    static getFocusedWindow() { return null; }
                },
                Notification: class {
                    static isSupported() { return false; }
                },
                session: {
                    fromPartition() {
                        return { webRequest: { onBeforeRequest() {}, onCompleted() {}, onErrorOccurred() {} } };
                    },
                },
            };
        }
        if (request === './steamBridge') {
            return {
                isRunning: false,
                start: async () => {},
                stop: async () => {},
                on() {},
                getLastSessionSteamId: () => '',
                getCredentialsForAccount: () => null,
                deleteCredentialsForAccount() {},
            };
        }
        if (request === 'child_process') {
            return { execFile: () => ({ stdout: { on() {} }, stderr: { on() {} }, on() {} }) };
        }
        if (request === './analytics') {
            return {
                logPlatformLinked: async () => {},
                logPlatformUnlinked: async () => {},
                logSyncCompleted: async () => {},
                logSyncFailed: async () => {},
                logAutoSyncStarted: async () => {},
            };
        }
        if (request === './services/baddelApi') {
            return {};
        }
        if (request === './services/credentialValidator') {
            return { redactSecrets: (value) => value };
        }
        if (request === './src/features/games/infrastructure/composition/GamesContainer') {
            return {
                getGamesFeature: () => ({
                    getSavedGames: async () => [],
                    getLocalSteamGames: async () => [],
                    removeEpicNonGameEntries: async () => {},
                }),
            };
        }
        return originalLoad.apply(this, arguments);
    };

    try {
        return require('../platformSync');
    } finally {
        Module._load = originalLoad;
        fs.rmSync(userData, { recursive: true, force: true });
    }
}

function makeFakePlatformSyncApi() {
    return {
        registerPlatformSyncHandlers() {},
        epicConnector: Object.fromEntries(CONNECTOR_KEYS.map((key) => [key, function epicMethod() {}])),
        steamConnector: Object.fromEntries(CONNECTOR_KEYS.map((key) => [key, function steamMethod() {}])),
        enrichProfilesWithSyncData() {},
        registerPlatformSyncAssetDownloader() {},
        autoSyncOnStartup() {},
        _mobileApprovalPollStep() {},
        _startQrLoginFlow() {},
        cacheLibraryCoversFirst() {},
        _withConcurrency() {},
        _writeSyncLinkToExistingSwitcherProfile() {},
        _findMatchingEpicSwitcherProfile() {},
    };
}

test('platformSync exports Steam and Epic connector objects with stable method shapes', () => {
    const sync = loadPlatformSyncShapeOnly();

    assert.deepEqual(Object.keys(sync.steamConnector), CONNECTOR_KEYS);
    assert.deepEqual(Object.keys(sync.epicConnector), CONNECTOR_KEYS);
    for (const key of CONNECTOR_KEYS) {
        assert.equal(typeof sync.steamConnector[key], 'function', `steamConnector.${key} must remain a function`);
        assert.equal(typeof sync.epicConnector[key], 'function', `epicConnector.${key} must remain a function`);
    }
});

test('createPlatformSyncFeature preserves real connector object identity', () => {
    const sync = loadPlatformSyncShapeOnly();
    const { createPlatformSyncFeature } = require('../src/features/sync/infrastructure/composition/createPlatformSyncFeature');
    const feature = createPlatformSyncFeature(sync);

    assert.equal(feature.steamConnector, sync.steamConnector);
    assert.equal(feature.epicConnector, sync.epicConnector);
});

test('SyncContainer preserves injected connector object identity', () => {
    clearModule('../src/features/sync/infrastructure/composition/SyncContainer');
    const { createSyncFeature } = require('../src/features/sync/infrastructure/composition/SyncContainer');
    const platformSyncApi = makeFakePlatformSyncApi();
    const feature = createSyncFeature({ platformSyncApi });

    assert.equal(feature.steamConnector, platformSyncApi.steamConnector);
    assert.equal(feature.epicConnector, platformSyncApi.epicConnector);
});

test('getSyncFeature singleton preserves connector object identity', () => {
    clearModule('../src/features/sync/infrastructure/composition/SyncContainer');
    const { getSyncFeature } = require('../src/features/sync/infrastructure/composition/SyncContainer');
    const platformSyncApi = makeFakePlatformSyncApi();
    const feature = getSyncFeature({ platformSyncApi });

    assert.equal(feature.steamConnector, platformSyncApi.steamConnector);
    assert.equal(feature.epicConnector, platformSyncApi.epicConnector);
    assert.equal(getSyncFeature({ platformSyncApi: makeFakePlatformSyncApi() }), feature);
});

test('connector boundary source guards keep current production wiring stable', () => {
    const platformSyncSource = fs.readFileSync(PLATFORM_SYNC_PATH, 'utf8');
    const syncContainerSource = fs.readFileSync(SYNC_CONTAINER_PATH, 'utf8');
    const mainSource = fs.readFileSync(MAIN_JS_PATH, 'utf8');
    const factorySource = fs.readFileSync(CREATE_SYNC_CONNECTORS_PATH, 'utf8');

    assert.match(mainSource, /require\(['"]\.\/src\/features\/sync\/infrastructure\/composition\/SyncContainer['"]\)/);
    assert.match(mainSource, /getSyncFeature\(\)/);
    assert.doesNotMatch(platformSyncSource, /SyncContainer/);
    assert.match(platformSyncSource, /createSyncConnectors/);
    assert.match(syncContainerSource, /loadDefaultPlatformSyncApi/);
    assert.match(syncContainerSource, /require\(['"]\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/platformSync['"]\)/);
    assert.doesNotMatch(syncContainerSource, /platformSyncPath|\.join\(['"]\/['"]\)/);
    assert.equal(fs.existsSync(CREATE_SYNC_CONNECTORS_PATH), true);
    assert.doesNotMatch(factorySource, /platformSync|SyncContainer|electron|steamBridge|legendary|execFile/);
});

test('platformSync still owns connector method implementations and current platform-sync IPC channels', () => {
    const source = fs.readFileSync(PLATFORM_SYNC_PATH, 'utf8');
    const channels = [
        'platform-sync:status',
        'platform-sync:get-accounts',
        'platform-sync:link',
        'platform-sync:sync',
        'platform-sync:get-state',
        'platform-sync:get-cached',
        'platform-sync:unlink',
    ];

    assert.match(source, /const\s+steamConnectorMethods\s*=\s*\{/);
    assert.match(source, /const\s+epicConnectorMethods\s*=\s*\{/);
    assert.match(source, /ALL_CONNECTORS/);
    for (const channel of channels) {
        assert.match(source, new RegExp(`['"]${channel}['"]`));
    }
});
