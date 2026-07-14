'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    SYNC_FEATURE_API_KEYS,
} = require('../src/features/sync/infrastructure/composition/SyncFeatureApiContract');

const ROOT = path.resolve(__dirname, '..');
const PLATFORM_SYNC_PATH = path.join(ROOT, 'platformSync.js');
const MAIN_JS_PATH = path.join(ROOT, 'main.js');
const SYNC_CONTAINER_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'composition', 'SyncContainer.js');
const CONNECTOR_REPOSITORY_BUNDLE_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'composition', 'ConnectorRepositoryBundle.js');
const CREATE_SYNC_CONNECTORS_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'composition', 'createSyncConnectors.js');

const CONNECTOR_METHODS = ['isLinked', 'getAccounts', 'link', 'syncLibrary', 'getCachedLibrary', 'unlink'];
const PLATFORM_SYNC_IPC_CHANNELS = [
    'platform-sync:status',
    'platform-sync:get-accounts',
    'platform-sync:link',
    'platform-sync:sync',
    'platform-sync:get-state',
    'platform-sync:get-cached',
    'platform-sync:unlink',
];

function readSource(filePath) {
    return fs.readFileSync(filePath, 'utf8');
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractObjectLiteral(source, declarationName) {
    const declaration = `const ${declarationName} = {`;
    const start = source.indexOf(declaration);
    assert.notEqual(start, -1, `${declarationName} declaration must exist`);

    const braceStart = source.indexOf('{', start);
    let depth = 0;
    for (let index = braceStart; index < source.length; index += 1) {
        const char = source[index];
        if (char === '{') depth += 1;
        if (char === '}') depth -= 1;
        if (depth === 0) return source.slice(braceStart, index + 1);
    }
    throw new Error(`Unable to extract ${declarationName} object literal`);
}

test('connector construction still lives in platformSync without the future factory', () => {
    const platformSyncSource = readSource(PLATFORM_SYNC_PATH);
    const syncContainerSource = readSource(SYNC_CONTAINER_PATH);
    const mainSource = readSource(MAIN_JS_PATH);

    assert.match(platformSyncSource, /const\s+steamConnector\s*=\s*\{/);
    assert.match(platformSyncSource, /const\s+epicConnector\s*=\s*\{/);
    assert.match(platformSyncSource, /const\s+ALL_CONNECTORS\s*=\s*\{/);
    assert.equal(fs.existsSync(CREATE_SYNC_CONNECTORS_PATH), false, 'createSyncConnectors.js should not exist before extraction');

    assert.doesNotMatch(platformSyncSource, /SyncContainer/);
    assert.match(syncContainerSource, /function\s+loadDefaultPlatformSyncApi/);
    assert.match(syncContainerSource, /require\(platformSyncPath\)/);
    assert.match(mainSource, /require\(['"]\.\/platformSync['"]\)/);
    assert.doesNotMatch(mainSource, /SyncContainer/);
});

test('connector method names remain stable at the current boundary', () => {
    const platformSyncSource = readSource(PLATFORM_SYNC_PATH);
    const steamConnectorSource = extractObjectLiteral(platformSyncSource, 'steamConnector');
    const epicConnectorSource = extractObjectLiteral(platformSyncSource, 'epicConnector');

    for (const method of CONNECTOR_METHODS) {
        assert.match(steamConnectorSource, new RegExp(`\\b(?:async\\s+)?${method}\\s*\\(`), `steamConnector.${method} must remain`);
        assert.match(epicConnectorSource, new RegExp(`\\b(?:async\\s+)?${method}\\s*\\(`), `epicConnector.${method} must remain`);
    }
});

test('Steam connector still depends on the Steam bridge runtime boundary', () => {
    const platformSyncSource = readSource(PLATFORM_SYNC_PATH);
    const steamConnectorSource = extractObjectLiteral(platformSyncSource, 'steamConnector');

    assert.match(platformSyncSource, /const\s+steamBridge\s*=\s*require\(['"]\.\/steamBridge['"]\)/);
    assert.match(platformSyncSource, /let\s+_bridgeStarted\s*=\s*false/);
    assert.match(platformSyncSource, /let\s+_steamBridgeListenersBound\s*=\s*false/);
    assert.match(platformSyncSource, /async\s+function\s+_ensureBridgeRunning\s*\(/);
    assert.match(platformSyncSource, /async\s+function\s+_openSteamLoginWindow\s*\(/);

    assert.match(platformSyncSource, /async\s+function\s+fetchSteamOwnedGamesWithRetry\s*\(/);
    assert.match(platformSyncSource, /steamBridge\.getOwnedGames/);

    for (const boundary of ['_ensureBridgeRunning', 'steamBridge.waitForCredentials', 'steamBridge.authenticate', 'steamBridge.waitForCacheReady', 'fetchSteamOwnedGamesWithRetry']) {
        assert.match(steamConnectorSource, new RegExp(escapeRegExp(boundary)), `${boundary} should remain inside the Steam connector boundary`);
    }
});

test('Epic connector still depends on the Legendary execFile runtime boundary', () => {
    const platformSyncSource = readSource(PLATFORM_SYNC_PATH);
    const epicConnectorSource = extractObjectLiteral(platformSyncSource, 'epicConnector');

    assert.match(platformSyncSource, /const\s+\{\s*execFile\s*\}\s*=\s*require\(['"]child_process['"]\)/);
    assert.match(platformSyncSource, /function\s+runLegendary\s*\(/);
    assert.match(platformSyncSource, /execFile\(LEGENDARY_BIN/);
    assert.match(platformSyncSource, /function\s+openEpicLoginWindow\s*\(/);

    for (const boundary of ['openEpicLoginWindow', 'runLegendary', 'syncSingleEpicAccount', 'getLegendaryConfPath']) {
        assert.match(epicConnectorSource, new RegExp(escapeRegExp(boundary)), `${boundary} should remain inside the Epic connector boundary`);
    }
});

test('platformSync still owns Electron login, session, notification, state, and event seams', () => {
    const source = readSource(PLATFORM_SYNC_PATH);

    assert.match(source, /const\s+\{\s*app,\s*BrowserWindow,\s*Notification\s*\}\s*=\s*require\(['"]electron['"]\)/);
    assert.match(source, /app\.getPath\(['"]userData['"]\)/);
    assert.match(source, /BrowserWindow\.fromWebContents/);
    assert.match(source, /BrowserWindow\.getFocusedWindow/);
    assert.match(source, /new\s+BrowserWindow\s*\(/);
    assert.match(source, /const\s+\{\s*session:\s*electronSession\s*\}\s*=\s*require\(['"]electron['"]\)/);
    assert.match(source, /electronSession\.fromPartition/);
    assert.match(source, /Notification\.isSupported\(\)/);
    assert.match(source, /new\s+Notification\s*\(/);

    for (const symbol of [
        '_platformSyncWindowGetter',
        '_platformSyncLogWriteQueue',
        '_platformSyncState',
        '_emitPlatformSyncState',
        '_pushPlatformSyncLog',
        '_emitLibraryUpdated',
        '_emitLinkState',
        '_startPlatformSync',
        '_updatePlatformSyncAccount',
        '_updatePlatformSyncProgress',
        '_finishPlatformSync',
    ]) {
        assert.match(source, new RegExp(escapeRegExp(symbol)), `${symbol} should remain owned by platformSync`);
    }
});

test('platformSync still owns repository, service, and Games feature dependencies', () => {
    const source = readSource(PLATFORM_SYNC_PATH);

    assert.equal(fs.existsSync(CONNECTOR_REPOSITORY_BUNDLE_PATH), true, 'ConnectorRepositoryBundle should exist after repository seam extraction');
    assert.match(source, /createConnectorRepositoryBundle/);
    assert.match(source, /syncCacheRepository/);
    assert.match(source, /epicSwitcherRepository/);
    assert.doesNotMatch(source, /new\s+PlatformSyncCacheRepository\s*\(/);
    assert.doesNotMatch(source, /new\s+EpicSwitcherRepository\s*\(/);
    assert.match(source, /PlatformSyncAssetWriteBackService/);
    assert.match(source, /new\s+PlatformSyncAssetWriteBackService\s*\(/);
    assert.match(source, /PlatformSyncServerImportService/);
    assert.match(source, /new\s+PlatformSyncServerImportService\s*\(/);
    assert.match(source, /getGamesFeature/);
    assert.match(source, /function\s+getGamesApi\s*\(/);

    for (const gamesCall of ['getGamesApi().getSavedGames', 'getGamesApi().getLocalSteamGames', 'getGamesApi().removeEpicNonGameEntries']) {
        assert.match(source, new RegExp(escapeRegExp(gamesCall)), `${gamesCall} should remain at the current boundary`);
    }
});

test('public sync API keys and platform-sync IPC channels remain unchanged', () => {
    const source = readSource(PLATFORM_SYNC_PATH);
    const expectedKeys = [
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

    assert.deepEqual(SYNC_FEATURE_API_KEYS, expectedKeys);
    assert.match(source, /module\.exports\s*=\s*createPlatformSyncFeature\s*\(\s*\{/);
    for (const key of expectedKeys) {
        assert.match(source, new RegExp(`\\b${escapeRegExp(key)}\\b`), `${key} should remain exported through platformSync`);
    }
    for (const channel of PLATFORM_SYNC_IPC_CHANNELS) {
        assert.match(source, new RegExp(`['"]${escapeRegExp(channel)}['"]`), `${channel} IPC channel should remain unchanged`);
    }
});
