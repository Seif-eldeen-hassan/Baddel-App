'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    createPlatformSyncFeature,
    SYNC_FEATURE_API_KEYS,
} = require('../src/features/sync/infrastructure/composition/createPlatformSyncFeature');

const ROOT = path.resolve(__dirname, '..');
const PLATFORM_SYNC_PATH = path.join(ROOT, 'platformSync.js');
const MAIN_JS_PATH = path.join(ROOT, 'main.js');
const PRELOAD_PATH = path.join(ROOT, 'preload.js');
const RENDERER_PATH = path.join(ROOT, 'src', 'js', 'app.js');
const SYNC_CONTAINER_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'composition', 'SyncContainer.js');
const CREATE_SYNC_CONNECTORS_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'composition', 'createSyncConnectors.js');
const SYNC_RUNTIME_STATE_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'runtime', 'SyncRuntimeState.js');
const SYNC_EVENT_EMITTER_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'runtime', 'SyncEventEmitter.js');

const RUNTIME_MODULE_PATHS = [
    path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'runtime', 'SyncLogQueue.js'),
    path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'runtime', 'LinkStateEmitter.js'),
    path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'runtime', 'LibraryUpdateEmitter.js'),
    path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'runtime', 'SyncTerminalEventEmitter.js'),
    path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'runtime', 'StateChangedEmitter.js'),
];

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

function extractBalancedBlock(source, startIndex) {
    const braceStart = source.indexOf('{', startIndex);
    assert.notEqual(braceStart, -1, 'balanced block must have an opening brace');

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

    throw new Error('Unable to extract balanced block');
}

function extractObjectLiteral(source, declarationName) {
    const declaration = `const ${declarationName} = {`;
    const start = source.indexOf(declaration);
    assert.notEqual(start, -1, `${declarationName} declaration must exist`);
    return extractBalancedBlock(source, start);
}

function extractFunctionSource(source, functionName) {
    const start = source.search(new RegExp(`(?:async\\s+)?function\\s+${escapeRegExp(functionName)}\\s*\\(`));
    assert.notEqual(start, -1, `${functionName} function must exist`);
    return source.slice(start, source.indexOf(extractBalancedBlock(source, start), start) + extractBalancedBlock(source, start).length);
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

        const match = objectLiteral.slice(index).match(/^(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/);
        if (match) {
            names.push(match[1]);
            index += match[0].length - 1;
        }
    }

    return names;
}

function assertNoRuntimeModuleBoundaryImport(source, modulePath) {
    assert.doesNotMatch(source, /platformSync/);
    assert.doesNotMatch(source, /SyncContainer/);
    assert.doesNotMatch(source, /require\(['"]electron['"]\)|BrowserWindow|ipcMain|ipcRenderer/);
    assert.doesNotMatch(source, /main\.js|preload\.js|src\/js|src\\js/);
    assert.doesNotMatch(source, /steamBridge/);
    assert.doesNotMatch(source, /legendary|LEGENDARY|execFile/);
    assert.doesNotMatch(source, /registerPlatformSyncHandlers/, modulePath);
}

test('future createSyncConnectors extraction targets remain absent before production extraction', () => {
    assert.equal(fs.existsSync(CREATE_SYNC_CONNECTORS_PATH), false, 'createSyncConnectors.js should not exist yet');
    assert.equal(fs.existsSync(SYNC_RUNTIME_STATE_PATH), false, 'SyncRuntimeState.js should not exist yet');
    assert.equal(fs.existsSync(SYNC_EVENT_EMITTER_PATH), false, 'SyncEventEmitter.js should not exist yet');
});

test('platformSync still owns connector construction and ALL_CONNECTORS before extraction', () => {
    const source = readSource(PLATFORM_SYNC_PATH);

    assert.match(source, /const\s+steamConnector\s*=\s*\{/);
    assert.match(source, /const\s+epicConnector\s*=\s*\{/);
    assert.match(source, /const\s+ALL_CONNECTORS\s*=\s*\{/);
    assert.doesNotMatch(source, /createSyncConnectors/);
    assert.doesNotMatch(source, /require\([^)]*SyncContainer/);
});

test('connector method shape and exported object identity expectations remain stable', () => {
    const source = readSource(PLATFORM_SYNC_PATH);
    const steamConnector = Object.fromEntries(CONNECTOR_METHODS.map((method) => [method, function steamMethod() {}]));
    const epicConnector = Object.fromEntries(CONNECTOR_METHODS.map((method) => [method, function epicMethod() {}]));
    const feature = createPlatformSyncFeature({
        registerPlatformSyncHandlers() {},
        epicConnector,
        steamConnector,
        enrichProfilesWithSyncData() {},
        registerPlatformSyncAssetDownloader() {},
        autoSyncOnStartup() {},
        _mobileApprovalPollStep() {},
        _startQrLoginFlow() {},
        cacheLibraryCoversFirst() {},
        _withConcurrency() {},
        _writeSyncLinkToExistingSwitcherProfile() {},
        _findMatchingEpicSwitcherProfile() {},
    });

    assert.deepEqual(getTopLevelMethodNames(extractObjectLiteral(source, 'steamConnector')), CONNECTOR_METHODS);
    assert.deepEqual(getTopLevelMethodNames(extractObjectLiteral(source, 'epicConnector')), CONNECTOR_METHODS);
    assert.deepEqual(Object.keys(feature.steamConnector), CONNECTOR_METHODS);
    assert.deepEqual(Object.keys(feature.epicConnector), CONNECTOR_METHODS);

    for (const method of CONNECTOR_METHODS) {
        assert.equal(typeof feature.steamConnector[method], 'function', `steamConnector.${method} should remain a function`);
        assert.equal(typeof feature.epicConnector[method], 'function', `epicConnector.${method} should remain a function`);
    }

    assert.equal(feature.steamConnector, steamConnector);
    assert.equal(feature.epicConnector, epicConnector);
});

test('platformSync exports both connectors and preserves public API key order', () => {
    const source = readSource(PLATFORM_SYNC_PATH);
    const exportBlock = extractBalancedBlock(source, source.indexOf('module.exports = createPlatformSyncFeature'));

    assert.deepEqual(SYNC_FEATURE_API_KEYS, [
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
    assert.match(source, /module\.exports\s*=\s*createPlatformSyncFeature\s*\(/);
    assert.match(exportBlock, /\bsteamConnector\b/);
    assert.match(exportBlock, /\bepicConnector\b/);
});

test('registerPlatformSyncHandlers still resolves connectors through local connector objects and IPC channels', () => {
    const source = readSource(PLATFORM_SYNC_PATH);
    const handlerSource = extractFunctionSource(source, 'registerPlatformSyncHandlers');

    assert.match(handlerSource, /const\s+connectors\s*=\s*\{/);
    assert.match(handlerSource, /epic:\s*epicConnector/);
    assert.match(handlerSource, /steam:\s*steamConnector/);

    for (const channel of PLATFORM_SYNC_IPC_CHANNELS) {
        assert.match(handlerSource, new RegExp(`['"]${escapeRegExp(channel)}['"]`), `${channel} should remain registered`);
    }
    for (const method of ['isLinked', 'getAccounts', 'link', 'syncLibrary', 'getCachedLibrary', 'unlink']) {
        assert.match(handlerSource, new RegExp(`connector\\.${escapeRegExp(method)}|v\\.${escapeRegExp(method)}`));
    }
});

test('ALL_CONNECTORS consumers remain limited to enrichment and startup auto-sync', () => {
    const source = readSource(PLATFORM_SYNC_PATH);
    const enrichSource = extractFunctionSource(source, 'enrichProfilesWithSyncData');
    const autoSyncSource = extractFunctionSource(source, 'autoSyncOnStartup');

    assert.match(enrichSource, /const\s+connector\s*=\s*ALL_CONNECTORS\[platform\]/);
    assert.match(enrichSource, /connector\.getAccounts\(\)/);
    assert.match(enrichSource, /connector\.getCachedLibrary\(\)/);
    assert.match(autoSyncSource, /Object\.entries\(ALL_CONNECTORS\)/);
    assert.match(autoSyncSource, /connector\?\.getAccounts\?\.\(\)/);
    assert.match(autoSyncSource, /connector\.syncLibrary\(\)\.catch/);
});

test('main.js dependency on exported steamConnector remains known and stable', () => {
    const mainSource = readSource(MAIN_JS_PATH);

    assert.match(mainSource, /const\s+\{[^}]*steamConnector[^}]*\}\s*=\s*require\(['"]\.\/platformSync['"]\)/s);
    assert.match(mainSource, /steamConnector\?\.getAccounts\?\.\(\)/);
    assert.doesNotMatch(mainSource, /createSyncConnectors|SyncContainer/);
});

test('SyncContainer remains a compatibility wrapper and does not own real connector construction', () => {
    const syncContainerSource = readSource(SYNC_CONTAINER_PATH);
    const platformSyncSource = readSource(PLATFORM_SYNC_PATH);
    const preloadSource = readSource(PRELOAD_PATH);
    const rendererSource = readSource(RENDERER_PATH);

    assert.match(syncContainerSource, /function\s+loadDefaultPlatformSyncApi/);
    assert.match(syncContainerSource, /require\(platformSyncPath\)/);
    assert.doesNotMatch(syncContainerSource, /const\s+steamConnector\s*=\s*\{/);
    assert.doesNotMatch(syncContainerSource, /const\s+epicConnector\s*=\s*\{/);
    assert.doesNotMatch(syncContainerSource, /createSyncConnectors/);
    assert.doesNotMatch(platformSyncSource, /SyncContainer/);
    assert.doesNotMatch(preloadSource, /SyncContainer|createSyncConnectors/);
    assert.doesNotMatch(rendererSource, /SyncContainer|createSyncConnectors/);
});

test('extracted runtime modules still exist and remain isolated from platform runtime boundaries', () => {
    for (const modulePath of RUNTIME_MODULE_PATHS) {
        assert.equal(fs.existsSync(modulePath), true, `${path.basename(modulePath)} should exist`);
        assertNoRuntimeModuleBoundaryImport(readSource(modulePath), modulePath);
    }
});

test('future createSyncConnectors dependency categories remain source-visible in platformSync', () => {
    const source = readSource(PLATFORM_SYNC_PATH);

    const dependencyCategories = {
        repositoriesAdaptersServices: [
            'createConnectorRepositoryBundle',
            'syncCacheRepository',
            'epicSwitcherRepository',
            'GamesSyncAdapter',
            'PlatformSyncServerImportService',
            'PlatformSyncAssetWriteBackService',
        ],
        runtimeStateHelpers: [
            '_getPlatformSyncState',
            '_startPlatformSync',
            '_updatePlatformSyncAccount',
            '_updatePlatformSyncProgress',
            '_finishPlatformSync',
        ],
        eventEmitters: [
            'SyncLogQueue',
            'LinkStateEmitter',
            'LibraryUpdateEmitter',
            'SyncTerminalEventEmitter',
            'StateChangedEmitter',
            '_emitPlatformSyncState',
            '_pushPlatformSyncLog',
            '_emitLibraryUpdated',
            '_emitLinkState',
        ],
        steamRuntimeHelpers: [
            'steamBridge',
            '_ensureBridgeRunning',
            '_openSteamLoginWindow',
            '_startQrLoginFlow',
            '_mobileApprovalPollStep',
            'fetchSteamOwnedGamesWithRetry',
        ],
        epicLegendaryHelpers: [
            'LEGENDARY_BIN',
            'runLegendary',
            'openEpicLoginWindow',
            'getLegendaryConfPath',
            'syncSingleEpicAccount',
        ],
        electronWindowSessionHelpers: [
            'app.getPath',
            'BrowserWindow',
            'Notification',
            'electronSession',
            '_platformSyncWindowGetter',
        ],
        analyticsApiCredentialFsPathHelpers: [
            'analytics',
            'baddelApi',
            'redactSecrets',
            'fs',
            'path',
            '_importLibraryToServer',
            'cacheLibraryCoversFirst',
        ],
    };

    for (const [category, symbols] of Object.entries(dependencyCategories)) {
        for (const symbol of symbols) {
            assert.match(source, new RegExp(escapeRegExp(symbol)), `${category} dependency ${symbol} should remain visible`);
        }
    }
});
