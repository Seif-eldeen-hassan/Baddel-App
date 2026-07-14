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
const SYNC_TERMINAL_EVENT_EMITTER_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'runtime', 'SyncTerminalEventEmitter.js');
const LINK_STATE_EMITTER_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'runtime', 'LinkStateEmitter.js');
const LIBRARY_UPDATE_EMITTER_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'runtime', 'LibraryUpdateEmitter.js');
const SYNC_LOG_QUEUE_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'runtime', 'SyncLogQueue.js');
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
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === quote) quote = null;
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
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === quote) quote = null;
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
        if (index > 0 && !/[\s,{]/.test(objectLiteral[index - 1])) continue;

        const match = objectLiteral.slice(index).match(/^(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/);
        if (match) {
            names.push(match[1]);
            index += match[0].length - 1;
        }
    }

    return names;
}

function makeTempUserData() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-sync-runtime-state-'));
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
    const fakeNotification = class {
        static isSupported() { return false; }
        constructor() {}
        show() {}
    };
    const fakeBrowserWindow = class {
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
    };
    const fakeElectron = {
        app: {
            getPath: (name) => name === 'userData' ? userData : os.tmpdir(),
            getVersion: () => '0.0.0-test',
            isPackaged: false,
            on() {},
            isReady: () => true,
        },
        BrowserWindow: fakeBrowserWindow,
        Notification: fakeNotification,
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
    const fakeSteamBridge = {
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
    const fakeGamesContainer = {
        getGamesFeature: () => ({
            getSavedGames: async () => [],
            getLocalSteamGames: async () => [],
            removeEpicNonGameEntries: async () => {},
        }),
    };

    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === 'electron') return fakeElectron;
        if (request === './steamBridge') return fakeSteamBridge;
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
            return fakeGamesContainer;
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

test('platformSync still owns the runtime state seam before extraction', () => {
    const source = readSource(PLATFORM_SYNC_PATH);
    const mainSource = readSource(MAIN_JS_PATH);

    assert.equal(fs.existsSync(SYNC_RUNTIME_STATE_PATH), false, 'SyncRuntimeState.js should not exist before extraction');
    assert.equal(fs.existsSync(SYNC_LOG_QUEUE_PATH), true, 'SyncLogQueue.js should exist after log queue extraction');
    assert.equal(fs.existsSync(CREATE_SYNC_CONNECTORS_PATH), false, 'createSyncConnectors.js should not exist before connector extraction');

    assert.match(source, /const\s+syncLogQueue\s*=\s*new\s+SyncLogQueue\(/);
    assert.doesNotMatch(source, /const\s+_platformSyncLogWriteQueue\s*=\s*\{\s*\}/);
    assert.match(source, /const\s+_platformSyncState\s*=\s*\{/);
    assert.match(source, /function\s+_createPlatformSyncState\s*\(/);
    assert.match(source, /function\s+_getPlatformSyncState\s*\(/);
    assert.match(source, /function\s+_setPlatformSyncState\s*\(/);
    assert.match(source, /function\s+_emitPlatformSyncState\s*\(/);
    assert.equal(fs.existsSync(STATE_CHANGED_EMITTER_PATH), true, 'StateChangedEmitter.js should exist after state-event extraction');
    assert.match(source, /StateChangedEmitter/);
    assert.match(source, /stateChangedEmitter\.emit\(_clonePlain\(_getPlatformSyncState\(platform\)\)\)/);
    assert.match(source, /function\s+_pushPlatformSyncLog\s*\(/);
    assert.match(source, /function\s+_startPlatformSync\s*\(/);
    assert.match(source, /function\s+_updatePlatformSyncAccount\s*\(/);
    assert.match(source, /function\s+_updatePlatformSyncProgress\s*\(/);
    assert.match(source, /function\s+_finishPlatformSync\s*\(/);
    assert.match(source, /function\s+_emitLinkState\s*\(/);
    assert.match(source, /function\s+_emitLibraryUpdated\s*\(/);
    assert.equal(fs.existsSync(LINK_STATE_EMITTER_PATH), true, 'LinkStateEmitter.js should exist after link-state extraction');
    assert.equal(fs.existsSync(LIBRARY_UPDATE_EMITTER_PATH), true, 'LibraryUpdateEmitter.js should exist after library-updated extraction');

    assert.match(source, /const\s+steamConnector\s*=\s*\{/);
    assert.match(source, /const\s+epicConnector\s*=\s*\{/);
    assert.doesNotMatch(source, /SyncContainer/);
    assert.match(mainSource, /require\(['"]\.\/platformSync['"]\)/);
    assert.doesNotMatch(mainSource, /SyncContainer/);
});

test('runtime state default shape and clone boundaries are source-visible', () => {
    const source = readSource(PLATFORM_SYNC_PATH);

    assert.match(source, /platform,\s*isSyncing:\s*false,\s*phase:\s*['"]idle['"]/s);
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
        assert.match(source, new RegExp(`\\b${escapeRegExp(field)}\\b`), `${field} should remain part of runtime state`);
    }

    assert.match(source, /function\s+_clonePlain\s*\(value\)\s*\{\s*return\s+JSON\.parse\(JSON\.stringify\(value\)\)/s);
    assert.match(source, /const\s+baseState\s*=\s*_clonePlain\(_getPlatformSyncState\(platform\)\)/);
    assert.match(source, /_platformSyncState\[platform\]\s*=\s*nextState/);
    assert.match(source, /_clonePlain\(_getPlatformSyncState\(platform\)\)/);
    assert.match(source, /_clonePlain\(_platformSyncState\)/);
});

test('runtime events and IPC channels remain on their current payload channels', () => {
    const source = readSource(PLATFORM_SYNC_PATH);
    const stateEmitterSource = readSource(STATE_CHANGED_EMITTER_PATH);
    const terminalEmitterSource = readSource(SYNC_TERMINAL_EVENT_EMITTER_PATH);

    assert.doesNotMatch(source, /function\s+_emitPlatformSyncEvent\s*\(/, 'current source uses split event helpers, not a monolithic event emitter');
    assert.equal(fs.existsSync(LINK_STATE_EMITTER_PATH), true, 'LinkStateEmitter.js should exist after link-state extraction');
    assert.equal(fs.existsSync(LIBRARY_UPDATE_EMITTER_PATH), true, 'LibraryUpdateEmitter.js should exist after library-updated extraction');
    assert.match(source, /stateChangedEmitter\.emit\(_clonePlain\(_getPlatformSyncState\(platform\)\)\)/);
    assert.match(stateEmitterSource, /webContents\.send\(['"]platform-sync:state['"],\s*payload\)/);
    assert.match(source, /libraryUpdateEmitter\.emit\(win\)/);
    assert.match(source, /linkStateEmitter\.emit\(mainWindow,\s*platform,\s*status,\s*message,\s*extra\)/);
    assert.match(source, /syncTerminalEventEmitter\.emitCompleted\(finalState,\s*\{/);
    assert.match(source, /syncTerminalEventEmitter\.emitFailed\(finalState\)/);
    assert.match(terminalEmitterSource, /this\._send\(['"]platform-sync:completed['"],\s*payload\)/);
    assert.match(terminalEmitterSource, /this\._send\(['"]platform-sync:failed['"],\s*payload\)/);
    assert.match(source, /ipcMainRef\.handle\(['"]platform-sync:get-state['"]/);

    for (const channel of PLATFORM_SYNC_IPC_CHANNELS) {
        assert.match(source, new RegExp(`['"]${escapeRegExp(channel)}['"]`), `${channel} IPC channel should remain unchanged`);
    }
});

test('connectors and public sync API shapes remain stable while runtime state is characterized', () => {
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
    assert.deepEqual(getTopLevelMethodNames(extractObjectLiteral(source, 'steamConnector')), CONNECTOR_METHODS);
    assert.deepEqual(getTopLevelMethodNames(extractObjectLiteral(source, 'epicConnector')), CONNECTOR_METHODS);
    assert.match(source, /module\.exports\s*=\s*createPlatformSyncFeature\s*\(\s*\{/);
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
        first.state.progress.percent = 99;
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

        const initializedAllState = await getState({}, null);
        assertDefaultStateShape(initializedAllState.state.steam, 'steam');
        assertDefaultStateShape(initializedAllState.state.epic, 'epic');
    } finally {
        rmDir(userData);
    }
});
