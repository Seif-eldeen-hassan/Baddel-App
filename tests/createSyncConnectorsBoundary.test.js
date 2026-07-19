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
const CREATE_SYNC_CONNECTORS_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'composition', 'createSyncConnectors.js');
const SYNC_TERMINAL_EVENT_EMITTER_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'runtime', 'SyncTerminalEventEmitter.js');

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
    let quote = null;
    let escaped = false;
    let lineComment = false;
    let blockComment = false;

    for (let index = braceStart; index < source.length; index += 1) {
        const char = source[index];
        const next = source[index + 1];

        if (lineComment) {
            if (char === '\n') lineComment = false;
            continue;
        }
        if (blockComment) {
            if (char === '*' && next === '/') {
                blockComment = false;
                index += 1;
            }
            continue;
        }
        if (quote) {
            if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === quote) {
                quote = null;
            }
            continue;
        }

        if (char === '/' && next === '/') {
            lineComment = true;
            index += 1;
            continue;
        }
        if (char === '/' && next === '*') {
            blockComment = true;
            index += 1;
            continue;
        }
        if (char === '"' || char === '\'' || char === '`') {
            quote = char;
            continue;
        }
        if (char === '{') depth += 1;
        if (char === '}') depth -= 1;
        if (depth === 0) return source.slice(braceStart, index + 1);
    }
    throw new Error(`Unable to extract ${declarationName} object literal`);
}

function getTopLevelMethodNames(objectLiteral) {
    const names = [];
    let depth = 0;
    let quote = null;
    let escaped = false;
    let lineComment = false;
    let blockComment = false;

    for (let index = 0; index < objectLiteral.length; index += 1) {
        const char = objectLiteral[index];
        const next = objectLiteral[index + 1];

        if (lineComment) {
            if (char === '\n') lineComment = false;
            continue;
        }
        if (blockComment) {
            if (char === '*' && next === '/') {
                blockComment = false;
                index += 1;
            }
            continue;
        }
        if (quote) {
            if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === quote) {
                quote = null;
            }
            continue;
        }

        if (char === '/' && next === '/') {
            lineComment = true;
            index += 1;
            continue;
        }
        if (char === '/' && next === '*') {
            blockComment = true;
            index += 1;
            continue;
        }
        if (char === '"' || char === '\'' || char === '`') {
            quote = char;
            continue;
        }

        if (char === '{') {
            depth += 1;
            continue;
        }
        if (char === '}') {
            depth -= 1;
            continue;
        }
        if (depth !== 1) continue;

        const previous = objectLiteral[index - 1] || '';
        if (index > 0 && !/[\s,{]/.test(previous)) continue;

        const remaining = objectLiteral.slice(index);
        const match = remaining.match(/^(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/);
        if (match) {
            names.push(match[1]);
            index += match[0].length - 1;
        }
    }

    return names;
}

test('createSyncConnectors factory exists and platformSync delegates connector assembly to it', () => {
    const source = readSource(PLATFORM_SYNC_PATH);
    const factorySource = readSource(CREATE_SYNC_CONNECTORS_PATH);

    assert.equal(fs.existsSync(CREATE_SYNC_CONNECTORS_PATH), true, 'createSyncConnectors.js should exist after extraction');
    assert.match(source, /createSyncConnectors/);
    assert.match(source, /const\s+steamConnectorMethods\s*=\s*\{/);
    assert.match(source, /const\s+epicConnectorMethods\s*=\s*\{/);
    assert.match(source, /const\s+gogConnectorMethods\s*=\s*\{/);
    assert.match(source, /ALL_CONNECTORS/);
    assert.doesNotMatch(source, /SyncContainer/);
    assert.doesNotMatch(factorySource, /platformSync|SyncContainer|electron|steamBridge|legendary|execFile|ipcMain/);
});

test('Steam and Epic connector method shapes are exact and ordered for the future factory seam', () => {
    const source = readSource(PLATFORM_SYNC_PATH);

    assert.deepEqual(getTopLevelMethodNames(extractObjectLiteral(source, 'steamConnectorMethods')), CONNECTOR_METHODS);
    assert.deepEqual(getTopLevelMethodNames(extractObjectLiteral(source, 'epicConnectorMethods')), CONNECTOR_METHODS);
    assert.deepEqual(getTopLevelMethodNames(extractObjectLiteral(source, 'gogConnectorMethods')), CONNECTOR_METHODS);
});

test('factory input candidates already backed by repositories, adapters, or services remain wired in platformSync', () => {
    const source = readSource(PLATFORM_SYNC_PATH);

    assert.match(source, /createConnectorRepositoryBundle/);
    assert.match(source, /syncCacheRepository/);
    assert.match(source, /epicSwitcherRepository/);
    assert.match(source, /GamesSyncAdapter/);
    assert.match(source, /gamesSyncAdapter\.getSavedGames/);
    assert.match(source, /gamesSyncAdapter\.getLocalSteamGames/);
    assert.match(source, /gamesSyncAdapter\.removeEpicNonGameEntries/);
    assert.match(source, /PlatformSyncServerImportService/);
    assert.match(source, /new\s+PlatformSyncServerImportService\s*\(/);
    assert.match(source, /PlatformSyncAssetWriteBackService/);
    assert.match(source, /new\s+PlatformSyncAssetWriteBackService\s*\(/);
});

test('platformSync still owns sync runtime state, logging, and event helpers before factory extraction', () => {
    const source = readSource(PLATFORM_SYNC_PATH);

    assert.match(source, /SyncLogQueue/);
    assert.match(source, /const\s+syncLogQueue\s*=\s*new\s+SyncLogQueue\(/);
    assert.doesNotMatch(source, /const\s+_platformSyncLogWriteQueue\s*=\s*\{\s*\}/);

    for (const symbol of [
        '_platformSyncWindowGetter',
        '_platformSyncAssetDownloader',
        '_platformSyncState',
        '_setPlatformSyncState',
        '_getPlatformSyncState',
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

test('platformSync still owns Steam bridge, Legendary, and Electron runtime boundaries', () => {
    const source = readSource(PLATFORM_SYNC_PATH);
    const terminalEmitterSource = readSource(SYNC_TERMINAL_EVENT_EMITTER_PATH);

    assert.match(source, /const\s+steamBridge\s*=\s*require\(['"]\.\/steamBridge['"]\)/);
    assert.match(source, /let\s+_bridgeStarted\s*=\s*false/);
    assert.match(source, /let\s+_steamBridgeListenersBound\s*=\s*false/);
    assert.match(source, /async\s+function\s+_ensureBridgeRunning\s*\(/);
    assert.match(source, /async\s+function\s+_openSteamLoginWindow\s*\(/);
    assert.match(source, /steamBridge\.waitForCredentials/);
    assert.match(source, /steamBridge\.authenticate/);
    assert.match(source, /steamBridge\.waitForCacheReady/);
    assert.match(source, /steamBridge\.getOwnedGames/);

    assert.match(source, /const\s+\{\s*execFile\s*\}\s*=\s*require\(['"]child_process['"]\)/);
    assert.match(source, /function\s+runLegendary\s*\(/);
    assert.match(source, /execFile\(LEGENDARY_BIN/);
    assert.match(source, /function\s+openEpicLoginWindow\s*\(/);
    assert.match(source, /runLegendary\(\['list',\s*'--json'\]/);
    assert.match(source, /getLegendaryConfPath/);

    assert.match(source, /const\s+\{\s*app,\s*BrowserWindow,\s*Notification,\s*session\s*\}\s*=\s*require\(['"]electron['"]\)/);
    assert.match(source, /app\.getPath\(['"]userData['"]\)/);
    assert.match(source, /BrowserWindow\.fromWebContents/);
    assert.match(source, /BrowserWindow\.getFocusedWindow/);
    assert.match(source, /new\s+BrowserWindow\s*\(/);
    assert.match(source, /const\s+\{\s*session:\s*electronSession\s*\}\s*=\s*require\(['"]electron['"]\)/);
    assert.match(source, /electronSession\.fromPartition/);
    assert.match(source, /SyncTerminalEventEmitter/);
    assert.match(source, /Notification,/);
    assert.match(terminalEmitterSource, /this\.Notification\.isSupported\(\)/);
    assert.match(terminalEmitterSource, /new\s+this\.Notification\(notificationOptions\)\.show\(\)/);
});

test('public API, IPC channels, and production entrypoint remain on the platformSync facade', () => {
    const source = readSource(PLATFORM_SYNC_PATH);
    const mainSource = readSource(MAIN_JS_PATH);
    const expectedKeys = [
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

    assert.deepEqual(SYNC_FEATURE_API_KEYS, expectedKeys);
    assert.match(source, /module\.exports\s*=\s*createPlatformSyncFeature\s*\(\s*\{/);
    for (const key of expectedKeys) {
        assert.match(source, new RegExp(`\\b${escapeRegExp(key)}\\b`), `${key} should remain exported through platformSync`);
    }
    for (const channel of PLATFORM_SYNC_IPC_CHANNELS) {
        assert.match(source, new RegExp(`['"]${escapeRegExp(channel)}['"]`), `${channel} IPC channel should remain unchanged`);
    }

    assert.match(mainSource, /require\(['"]\.\/src\/features\/sync\/infrastructure\/composition\/SyncContainer['"]\)/);
    assert.match(mainSource, /getSyncFeature\(\)/);
});
