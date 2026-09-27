'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const {
    SYNC_FEATURE_API_KEYS,
} = require('../src/features/sync/infrastructure/composition/SyncFeatureApiContract');

const ROOT = path.resolve(__dirname, '..');
const PLATFORM_SYNC_PATH = path.join(ROOT, 'platformSync.js');
const MAIN_JS_PATH = path.join(ROOT, 'main.js');
const SYNC_RUNTIME_STATE_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'runtime', 'SyncRuntimeState.js');
const STATE_CHANGED_EMITTER_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'runtime', 'StateChangedEmitter.js');
const SYNC_EVENT_EMITTER_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'runtime', 'SyncEventEmitter.js');
const CREATE_SYNC_CONNECTORS_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'composition', 'createSyncConnectors.js');
const SYNC_LOG_QUEUE_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'runtime', 'SyncLogQueue.js');
const LINK_STATE_EMITTER_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'runtime', 'LinkStateEmitter.js');
const LIBRARY_UPDATE_EMITTER_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'runtime', 'LibraryUpdateEmitter.js');
const SYNC_TERMINAL_EVENT_EMITTER_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'runtime', 'SyncTerminalEventEmitter.js');

const PLATFORM_SYNC_IPC_CHANNELS = [
    'platform-sync:status',
    'platform-sync:get-accounts',
    'platform-sync:link',
    'platform-sync:sync',
    'platform-sync:get-state',
    'platform-sync:get-cached',
    'platform-sync:unlink',
];

const CONNECTOR_METHODS = ['isLinked', 'getAccounts', 'link', 'syncLibrary', 'getCachedLibrary', 'unlink'];

function readSource(filePath) {
    return fs.readFileSync(filePath, 'utf8');
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractFunctionSource(source, functionName) {
    const start = source.indexOf(`function ${functionName}(`);
    assert.notEqual(start, -1, `${functionName} should exist`);

    const parenStart = source.indexOf('(', start);
    let parenDepth = 0;
    let signatureEnd = -1;
    for (let index = parenStart; index < source.length; index += 1) {
        if (source[index] === '(') parenDepth += 1;
        if (source[index] === ')') {
            parenDepth -= 1;
            if (parenDepth === 0) {
                signatureEnd = index;
                break;
            }
        }
    }
    assert.notEqual(signatureEnd, -1, `${functionName} signature should close`);

    const braceStart = source.indexOf('{', signatureEnd);
    let depth = 0;
    for (let index = braceStart; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}') {
            depth -= 1;
            if (depth === 0) return source.slice(start, index + 1);
        }
    }
    throw new Error(`Could not extract ${functionName}`);
}

function makeTempUserData() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-sync-state-event-'));
}

function rmDir(dir) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
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

function loadPlatformSync(userData) {
    clearPlatformSyncCache();

    const originalLoad = Module._load;
    class FakeNotification {
        static isSupported() { return false; }
        show() {}
    }
    class FakeBrowserWindow {
        static fromWebContents() { return null; }
        static getFocusedWindow() { return null; }
        constructor() {
            this.webContents = {
                on() {},
                setWindowOpenHandler() {},
                executeJavaScript: async () => {},
                insertCSS: async () => {},
                getURL: () => 'file:///index.html',
            };
        }
        once() {}
        on() {}
        show() {}
        close() {}
        loadURL() { return Promise.resolve(); }
        isDestroyed() { return false; }
        isFocused() { return true; }
    }
    const fakeElectron = {
        app: {
            getPath: (name) => name === 'userData' ? userData : os.tmpdir(),
            getVersion: () => '0.0.0-test',
            isPackaged: false,
            on() {},
            isReady: () => true,
        },
        BrowserWindow: FakeBrowserWindow,
        Notification: FakeNotification,
        session: {
            fromPartition: () => ({
                webRequest: {
                    onBeforeRequest() {},
                    onCompleted() {},
                    onErrorOccurred() {},
                },
            }),
        },
        net: { request: () => ({ on() {}, end() {} }) },
        shell: { openExternal: async () => {} },
    };

    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === 'electron') return fakeElectron;
        if (request === './steamBridge') {
            return {
                isRunning: false,
                start: async () => {},
                stop: async () => {},
                on() {},
                getOwnedGames: async () => ({ status: 'success', games: [] }),
                getLastSessionSteamId: () => '',
                getCredentialsForAccount: () => null,
                deleteCredentialsForAccount() {},
                waitForCredentials: async () => false,
                waitForCacheReady: async () => {},
                authenticate: async () => ({ status: 'authenticated', steamId: '0' }),
                logout: async () => {},
            };
        }
        if (request === './services/baddelApi') {
            return {
                requestGameEnrichBatch: async () => ({ results: [] }),
                lookupGame: async () => null,
                normalizeServerData: () => null,
            };
        }
        if (request === './services/credentialValidator') {
            return { redactSecrets: (value) => value };
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
    }
}

function makeFakeIpcMain() {
    const handles = new Map();
    return {
        handles,
        handle(channel, fn) {
            handles.set(channel, fn);
        },
    };
}

function assertDefaultStateShape(state, platform) {
    assert.equal(state.platform, platform);
    assert.equal(state.isSyncing, false);
    assert.equal(state.phase, 'idle');
    assert.equal(state.statusText, '');
    assert.equal(state.startedAt, null);
    assert.equal(state.finishedAt, null);
    assert.deepEqual(state.progress, {
        completedAccounts: 0,
        totalAccounts: 0,
        percent: 0,
        currentAccountId: null,
        currentAccountName: null,
    });
    assert.deepEqual(state.accounts, {});
    assert.deepEqual(state.logs, []);
    assert.equal(state.lastError, null);
    assert.deepEqual(state.validation, { ok: true, issues: [], countsByAccount: {}, totalGames: 0 });
    assert.deepEqual(state.summary, { totalGames: 0, installOnlyGames: 0, sampleTitles: [] });
}

test('future state/runtime extraction targets do not exist yet', () => {
    assert.equal(fs.existsSync(SYNC_RUNTIME_STATE_PATH), false);
    assert.equal(fs.existsSync(STATE_CHANGED_EMITTER_PATH), true);
    assert.equal(fs.existsSync(SYNC_EVENT_EMITTER_PATH), false);
    assert.equal(fs.existsSync(CREATE_SYNC_CONNECTORS_PATH), true);

    assert.equal(fs.existsSync(SYNC_LOG_QUEUE_PATH), true);
    assert.equal(fs.existsSync(LINK_STATE_EMITTER_PATH), true);
    assert.equal(fs.existsSync(LIBRARY_UPDATE_EMITTER_PATH), true);
    assert.equal(fs.existsSync(SYNC_TERMINAL_EVENT_EMITTER_PATH), true);
});

test('platformSync still owns runtime state helpers and state mutations', () => {
    const source = readSource(PLATFORM_SYNC_PATH);
    const mainSource = readSource(MAIN_JS_PATH);

    for (const symbol of [
        'const _platformSyncState',
        'function _createPlatformSyncState',
        'function _getPlatformSyncState',
        'function _setPlatformSyncState',
        'function _emitPlatformSyncState',
        'function _startPlatformSync',
        'function _updatePlatformSyncAccount',
        'function _updatePlatformSyncProgress',
        'function _finishPlatformSync',
    ]) {
        assert.match(source, new RegExp(escapeRegExp(symbol)));
    }

    assert.match(source, /SyncLogQueue/);
    assert.match(source, /LinkStateEmitter/);
    assert.match(source, /LibraryUpdateEmitter/);
    assert.match(source, /SyncTerminalEventEmitter/);
    assert.match(source, /StateChangedEmitter/);
    assert.match(source, /const\s+stateChangedEmitter\s*=\s*new\s+StateChangedEmitter\(\{/);
    assert.doesNotMatch(source, /SyncContainer/);
    assert.match(mainSource, /require\(['"]\.\/src\/features\/sync\/infrastructure\/composition\/SyncContainer['"]\)/);
    assert.match(mainSource, /getSyncFeature\(\)/);
});

test('runtime state default shape and cloning boundaries remain source-visible', () => {
    const source = readSource(PLATFORM_SYNC_PATH);
    const createSource = extractFunctionSource(source, '_createPlatformSyncState');
    const getSource = extractFunctionSource(source, '_getPlatformSyncState');
    const setSource = extractFunctionSource(source, '_setPlatformSyncState');
    const emitSource = extractFunctionSource(source, '_emitPlatformSyncState');
    const finishSource = extractFunctionSource(source, '_finishPlatformSync');

    assert.match(source, /const\s+_platformSyncState\s*=\s*\{\s*steam:\s*null,\s*epic:\s*null,\s*gog:\s*null,\s*\}/s);
    assert.match(createSource, /platform,\s*isSyncing:\s*false,\s*phase:\s*['"]idle['"]/s);
    for (const field of [
        'statusText',
        'startedAt',
        'finishedAt',
        'progress',
        'completedAccounts',
        'totalAccounts',
        'percent',
        'currentAccountId',
        'currentAccountName',
        'accounts',
        'logs',
        'lastError',
        'validation',
        'summary',
    ]) {
        assert.match(createSource, new RegExp(`\\b${escapeRegExp(field)}\\b`), `${field} should remain in default state`);
    }

    assert.doesNotMatch(getSource, /_clonePlain/);
    assert.match(getSource, /_platformSyncState\[platform\]\s*=\s*_createPlatformSyncState\(platform\)/);
    assert.match(getSource, /return\s+_platformSyncState\[platform\]/);
    assert.match(setSource, /const\s+baseState\s*=\s*_clonePlain\(_getPlatformSyncState\(platform\)\)/);
    assert.match(setSource, /_platformSyncState\[platform\]\s*=\s*nextState/);
    assert.match(setSource, /_emitPlatformSyncState\(platform\)/);
    assert.match(emitSource, /stateChangedEmitter\.emit\(_clonePlain\(_getPlatformSyncState\(platform\)\)\)/);
    assert.match(finishSource, /const\s+finalState\s*=\s*_clonePlain\(_getPlatformSyncState\(platform\)\)/);
});

test('state event and get-state IPC channels remain stable', () => {
    const source = readSource(PLATFORM_SYNC_PATH);
    const stateEmitterSource = readSource(STATE_CHANGED_EMITTER_PATH);

    assert.match(source, /ipcMainRef\.handle\(['"]platform-sync:get-state['"]/);
    assert.match(source, /return\s+\{\s*status:\s*['"]success['"],\s*state:\s*_clonePlain\(_platformSyncState\)\s*\}/);
    assert.match(source, /return\s+\{\s*status:\s*['"]success['"],\s*state:\s*_clonePlain\(_getPlatformSyncState\(platform\)\)\s*\}/);
    assert.match(stateEmitterSource, /['"]platform-sync:state['"]/);

    for (const channel of PLATFORM_SYNC_IPC_CHANNELS) {
        assert.match(source, new RegExp(`['"]${escapeRegExp(channel)}['"]`), `${channel} IPC channel should remain unchanged`);
    }
});

test('state mutation order remains source-visible in start, progress, and finish helpers', () => {
    const source = readSource(PLATFORM_SYNC_PATH);
    const startSource = extractFunctionSource(source, '_startPlatformSync');
    const progressSource = extractFunctionSource(source, '_updatePlatformSyncProgress');
    const finishSource = extractFunctionSource(source, '_finishPlatformSync');

    assert.ok(startSource.indexOf('_platformSyncState[platform] = state') < startSource.indexOf('_emitPlatformSyncState(platform)'));
    assert.ok(startSource.indexOf('_emitPlatformSyncState(platform)') < startSource.indexOf('_pushPlatformSyncLog(platform'));
    assert.match(progressSource, /state\.progress\s*=\s*\{\s*\.\.\.state\.progress,\s*\.\.\.patch\s*\}/);
    assert.match(progressSource, /state\.progress\.percent\s*=/);
    assert.match(progressSource, /_setPlatformSyncState\(platform,\s*\(state\)\s*=>/);
    assert.ok(finishSource.indexOf('_setPlatformSyncState(platform') < finishSource.indexOf('const finalState = _clonePlain(_getPlatformSyncState(platform))'));
    assert.ok(finishSource.indexOf('const finalState = _clonePlain(_getPlatformSyncState(platform))') < finishSource.indexOf('syncTerminalEventEmitter.emit'));
    assert.match(finishSource, /state\.isSyncing\s*=\s*false/);
    assert.match(finishSource, /state\.lastError\s*=\s*patch\.lastError\s*\|\|\s*null/);
});

test('platformSync keeps connector methods while cold-cover bootstrap owns cover notifications', () => {
    const source = readSource(PLATFORM_SYNC_PATH);
    const mainSource = readSource(MAIN_JS_PATH);

    assert.doesNotMatch(source, /all-games-cover-cached/);
    assert.match(mainSource, /new\s+ColdCoverBootstrapService\(\{/);
    assert.match(mainSource, /webContents\?\.send\(['"]artwork-cold-cover-bootstrap:batch['"],\s*payload\)/);
    assert.match(source, /const\s+steamConnectorMethods\s*=\s*\{/);
    assert.match(source, /const\s+epicConnectorMethods\s*=\s*\{/);
    assert.match(source, /createSyncConnectors/);
    assert.match(source, /ALL_CONNECTORS/);
    for (const method of CONNECTOR_METHODS) {
        assert.match(source, new RegExp(`\\b${escapeRegExp(method)}\\s*\\(`), `${method} should remain source-visible`);
    }
});

test('public platform sync API keys remain stable', () => {
    const source = readSource(PLATFORM_SYNC_PATH);
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
    for (const key of expectedKeys) {
        assert.match(source, new RegExp(`\\b${escapeRegExp(key)}\\b`), `${key} should remain exported through platformSync`);
    }
});

test('platform-sync:get-state returns cloned default state payloads', async () => {
    const userData = makeTempUserData();
    try {
        const sync = loadPlatformSync(userData);
        const ipcMain = makeFakeIpcMain();
        sync.registerPlatformSyncHandlers(ipcMain, () => null);
        const getState = ipcMain.handles.get('platform-sync:get-state');

        const first = await getState({}, 'steam');
        assert.equal(first.status, 'success');
        assertDefaultStateShape(first.state, 'steam');

        first.state.phase = 'mutated';
        first.state.progress.percent = 77;
        first.state.logs.push({ level: 'warn', message: 'mutated' });

        const second = await getState({}, 'steam');
        assert.equal(second.status, 'success');
        assertDefaultStateShape(second.state, 'steam');

        const allState = await getState({}, null);
        assert.equal(allState.status, 'success');
        assertDefaultStateShape(allState.state.steam, 'steam');
        assert.equal(allState.state.epic, null);

        const epicState = await getState({}, 'epic');
        assert.equal(epicState.status, 'success');
        assertDefaultStateShape(epicState.state, 'epic');
    } finally {
        rmDir(userData);
    }
});
