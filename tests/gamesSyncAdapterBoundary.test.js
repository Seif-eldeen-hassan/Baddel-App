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
const GAMES_SYNC_ADAPTER_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'adapters', 'GamesSyncAdapter.js');
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

function extractFunctionBody(source, functionName) {
    const declaration = `function ${functionName}`;
    const start = source.indexOf(declaration);
    assert.notEqual(start, -1, `${functionName} declaration must exist`);

    const braceStart = source.indexOf('{', start);
    let depth = 0;
    for (let index = braceStart; index < source.length; index += 1) {
        const char = source[index];
        if (char === '{') depth += 1;
        if (char === '}') depth -= 1;
        if (depth === 0) return source.slice(braceStart, index + 1);
    }
    throw new Error(`Unable to extract ${functionName} body`);
}

test('Games sync adapter extraction is in place without moving connector construction', () => {
    const platformSyncSource = readSource(PLATFORM_SYNC_PATH);
    const mainSource = readSource(MAIN_JS_PATH);
    const syncContainerSource = readSource(SYNC_CONTAINER_PATH);

    assert.equal(fs.existsSync(GAMES_SYNC_ADAPTER_PATH), true, 'GamesSyncAdapter should exist after extraction');
    assert.equal(fs.existsSync(CREATE_SYNC_CONNECTORS_PATH), false, 'createSyncConnectors should not exist before connector extraction');
    assert.doesNotMatch(platformSyncSource, /SyncContainer/);
    assert.match(syncContainerSource, /require\(platformSyncPath\)/);
    assert.match(mainSource, /require\(['"]\.\/platformSync['"]\)/);
    assert.doesNotMatch(mainSource, /SyncContainer/);
});

test('platformSync owns connector construction and connector method shapes', () => {
    const source = readSource(PLATFORM_SYNC_PATH);
    const steamConnectorSource = extractObjectLiteral(source, 'steamConnector');
    const epicConnectorSource = extractObjectLiteral(source, 'epicConnector');

    assert.match(source, /const\s+steamConnector\s*=\s*\{/);
    assert.match(source, /const\s+epicConnector\s*=\s*\{/);
    assert.match(source, /const\s+ALL_CONNECTORS\s*=\s*\{/);

    for (const method of CONNECTOR_METHODS) {
        assert.match(steamConnectorSource, new RegExp(`\\b(?:async\\s+)?${method}\\s*\\(`), `steamConnector.${method} must remain`);
        assert.match(epicConnectorSource, new RegExp(`\\b(?:async\\s+)?${method}\\s*\\(`), `epicConnector.${method} must remain`);
    }
});

test('platformSync delegates Games calls through the extracted adapter seam', () => {
    const source = readSource(PLATFORM_SYNC_PATH);

    assert.match(source, /const\s+\{\s*getGamesFeature\s*\}\s*=\s*require\(['"]\.\/src\/features\/games\/infrastructure\/composition\/GamesContainer['"]\)/);
    assert.match(source, /const\s+\{\s*GamesSyncAdapter\s*\}\s*=\s*require\(['"]\.\/src\/features\/sync\/infrastructure\/adapters\/GamesSyncAdapter['"]\)/);
    assert.match(source, /const\s+gamesSyncAdapter\s*=\s*new\s+GamesSyncAdapter\(\{\s*getGamesFeature\s*\}\)/);
    assert.doesNotMatch(source, /function\s+getGamesApi\s*\(/);
});

test('Steam sync path still uses Games API for local installed Steam games', () => {
    const source = readSource(PLATFORM_SYNC_PATH);
    const steamConnectorSource = extractObjectLiteral(source, 'steamConnector');

    assert.match(steamConnectorSource, /Merging local Steam installs/);
    assert.match(steamConnectorSource, /gamesSyncAdapter\.getLocalSteamGames\(\)/);
    assert.match(steamConnectorSource, /installOnly:\s*true/);
    assert.match(steamConnectorSource, /steamLicensedAccountIds/);
});

test('Epic sync path still uses Games API for non-game cleanup', () => {
    const source = readSource(PLATFORM_SYNC_PATH);

    assert.match(source, /const\s+badEntries\s*=\s*\[\.\.\.rejectedEntries,\s*\.\.\.unknownEntries\]\.map\(x\s*=>\s*x\.entry\)/);
    assert.match(source, /gamesSyncAdapter\.removeEpicNonGameEntries\(badEntries\)/);
    assert.match(source, /DB cleanup error/);
});

test('library update events still fetch saved games through the Games API seam', () => {
    const source = readSource(PLATFORM_SYNC_PATH);
    const emitLibraryUpdatedSource = extractFunctionBody(source, '_emitLibraryUpdated');

    assert.match(emitLibraryUpdatedSource, /gamesSyncAdapter\.getSavedGames\(\)/);
    assert.match(emitLibraryUpdatedSource, /win\.webContents\.send\(['"]library-updated['"],\s*updatedLibrary\)/);
});

test('public platform sync API keys and IPC channels remain unchanged', () => {
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
    for (const key of expectedKeys) {
        assert.match(source, new RegExp(`\\b${escapeRegExp(key)}\\b`), `${key} should remain exported through platformSync`);
    }
    for (const channel of PLATFORM_SYNC_IPC_CHANNELS) {
        assert.match(source, new RegExp(`['"]${escapeRegExp(channel)}['"]`), `${channel} IPC channel should remain unchanged`);
    }
});
