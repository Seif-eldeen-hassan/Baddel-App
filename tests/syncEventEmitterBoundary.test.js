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
const SYNC_EVENT_EMITTER_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'runtime', 'SyncEventEmitter.js');
const STATE_CHANGED_EMITTER_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'runtime', 'StateChangedEmitter.js');
const SYNC_TERMINAL_EVENT_EMITTER_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'runtime', 'SyncTerminalEventEmitter.js');
const LINK_STATE_EMITTER_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'runtime', 'LinkStateEmitter.js');
const LIBRARY_UPDATE_EMITTER_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'runtime', 'LibraryUpdateEmitter.js');
const SYNC_RUNTIME_STATE_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'runtime', 'SyncRuntimeState.js');
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
const RENDERER_EVENT_CHANNELS = [
    'platform-sync:state',
    'platform-sync:completed',
    'platform-sync:failed',
    'platform-sync:link-state-changed',
    'library-updated',
    'all-games-cover-cached',
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
    return fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-sync-event-emitter-'));
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

function makeFakeWindow() {
    const events = [];
    return {
        events,
        isDestroyed: () => false,
        isFocused: () => true,
        webContents: {
            send(channel, payload) {
                events.push({ channel, payload });
            },
        },
    };
}

test('link-state emitter is extracted while platformSync owns remaining event helpers', () => {
    const source = readSource(PLATFORM_SYNC_PATH);
    const mainSource = readSource(MAIN_JS_PATH);

    assert.equal(fs.existsSync(SYNC_EVENT_EMITTER_PATH), false, 'SyncEventEmitter.js should not exist before extraction');
    assert.equal(fs.existsSync(LINK_STATE_EMITTER_PATH), true, 'LinkStateEmitter.js should exist after link-state extraction');
    assert.equal(fs.existsSync(LIBRARY_UPDATE_EMITTER_PATH), true, 'LibraryUpdateEmitter.js should exist after library-updated extraction');
    assert.equal(fs.existsSync(STATE_CHANGED_EMITTER_PATH), true, 'StateChangedEmitter.js should exist after state-event extraction');
    assert.equal(fs.existsSync(SYNC_RUNTIME_STATE_PATH), false, 'SyncRuntimeState.js should not exist before extraction');
    assert.equal(fs.existsSync(CREATE_SYNC_CONNECTORS_PATH), true, 'createSyncConnectors.js should exist after connector extraction');
    assert.equal(fs.existsSync(SYNC_LOG_QUEUE_PATH), true, 'SyncLogQueue.js should remain extracted');

    assert.match(source, /function\s+_emitPlatformSyncState\s*\(/);
    assert.match(source, /StateChangedEmitter/);
    assert.match(source, /stateChangedEmitter\.emit\(_clonePlain\(_getPlatformSyncState\(platform\)\)\)/);
    assert.match(source, /function\s+_emitLinkState\s*\(/);
    assert.match(source, /LinkStateEmitter/);
    assert.match(source, /linkStateEmitter\.emit\(mainWindow,\s*platform,\s*status,\s*message,\s*extra\)/);
    assert.match(source, /function\s+_emitLibraryUpdated\s*\(/);
    assert.match(source, /LibraryUpdateEmitter/);
    assert.match(source, /libraryUpdateEmitter\.emit\(win\)/);
    assert.match(source, /let\s+_platformSyncWindowGetter\s*=\s*null/);
    assert.match(source, /_platformSyncWindowGetter\s*=\s*getMainWindow/);
    assert.match(source, /SyncLogQueue/);
    assert.match(source, /function\s+_pushPlatformSyncLog\s*\(/);
    assert.match(source, /const\s+steamConnectorMethods\s*=\s*\{/);
    assert.match(source, /const\s+epicConnectorMethods\s*=\s*\{/);
    assert.match(source, /createSyncConnectors/);
    assert.doesNotMatch(source, /SyncContainer/);
    assert.match(mainSource, /require\(['"]\.\/src\/features\/sync\/infrastructure\/composition\/SyncContainer['"]\)/);
    assert.match(mainSource, /getSyncFeature\(\)/);
});

test('renderer event channels and send payload shapes remain source-visible', () => {
    const source = readSource(PLATFORM_SYNC_PATH);
    const eventSource = [
        source,
        readSource(STATE_CHANGED_EMITTER_PATH),
        readSource(SYNC_TERMINAL_EVENT_EMITTER_PATH),
        readSource(LINK_STATE_EMITTER_PATH),
        readSource(LIBRARY_UPDATE_EMITTER_PATH),
    ].join('\n');

    for (const channel of RENDERER_EVENT_CHANNELS) {
        assert.match(eventSource, new RegExp(`['"]${escapeRegExp(channel)}['"]`), `${channel} should remain source-visible`);
    }

    assert.match(source, /stateChangedEmitter\.emit\(_clonePlain\(_getPlatformSyncState\(platform\)\)\)/);
    assert.match(source, /libraryUpdateEmitter\.emit\(win\)/);
    assert.match(source, /linkStateEmitter\.emit\(mainWindow,\s*platform,\s*status,\s*message,\s*extra\)/);
    assert.match(source, /syncTerminalEventEmitter\.emitCompleted\(finalState,\s*\{/);
    assert.match(source, /syncTerminalEventEmitter\.emitFailed\(finalState\)/);
    assert.match(source, /_cfWin\.webContents\.send\(['"]all-games-cover-cached['"],\s*payload\)/);
    assert.ok((source.match(/all-games-cover-cached/g) || []).length >= 2, 'cover cache notifications should remain wired for Steam and Epic');
});

test('library-updated debounce behavior remains source-visible', () => {
    const source = readSource(PLATFORM_SYNC_PATH);
    const emitterSource = readSource(LIBRARY_UPDATE_EMITTER_PATH);

    assert.match(source, /const\s+libraryUpdateEmitter\s*=\s*new\s+LibraryUpdateEmitter\(\{/);
    assert.match(source, /getSavedGames:\s*\(\)\s*=>\s*gamesSyncAdapter\.getSavedGames\(\)/);
    assert.match(source, /debounceMs:\s*1500/);
    assert.match(source, /function\s+_emitLibraryUpdated\(win\)\s*\{\s*libraryUpdateEmitter\.emit\(win\)/s);
    assert.match(emitterSource, /if\s*\(this\.timer\)\s*this\.clearTimeoutFn\(this\.timer\)/);
    assert.match(emitterSource, /this\.timer\s*=\s*this\.setTimeoutFn\(async\s*\(\)\s*=>/);
    assert.match(emitterSource, /const\s+updatedLibrary\s*=\s*this\.getSavedGames/);
    assert.match(emitterSource, /win\.webContents\.send\(LIBRARY_UPDATED_CHANNEL,\s*updatedLibrary\)/);
    assert.match(emitterSource, /this\.debounceMs/);
});

test('public API, IPC channels, and connector method shapes remain stable', () => {
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
    assert.deepEqual(getTopLevelMethodNames(extractObjectLiteral(source, 'steamConnectorMethods')), CONNECTOR_METHODS);
    assert.deepEqual(getTopLevelMethodNames(extractObjectLiteral(source, 'epicConnectorMethods')), CONNECTOR_METHODS);

    for (const channel of PLATFORM_SYNC_IPC_CHANNELS) {
        assert.match(source, new RegExp(`['"]${escapeRegExp(channel)}['"]`), `${channel} IPC channel should remain unchanged`);
    }
    for (const key of expectedKeys) {
        assert.match(source, new RegExp(`\\b${escapeRegExp(key)}\\b`), `${key} should remain exported through platformSync`);
    }
});

test('platform-sync:link emits the current success link-state payload shape', async () => {
    const userData = makeTempUserData();
    try {
        const sync = loadPlatformSync(userData);
        const ipcMain = makeFakeIpcMain();
        const mainWindow = makeFakeWindow();
        sync.registerPlatformSyncHandlers(ipcMain, () => mainWindow);

        const originalLink = sync.steamConnector.link;
        sync.steamConnector.link = async (_parentWindow, emitState) => {
            emitState('waiting_for_signin', 'Waiting for Steam authorization.', {
                displayName: 'Steam One',
                accountId: 's1',
            });
            return { displayName: 'Steam One', accountId: 's1', steamId: 's1' };
        };
        try {
            const result = await ipcMain.handles.get('platform-sync:link')({ sender: {} }, 'steam', {});
            assert.deepEqual(result, {
                status: 'success',
                displayName: 'Steam One',
                accountId: 's1',
                steamId: 's1',
            });
        } finally {
            sync.steamConnector.link = originalLink;
        }

        assert.deepEqual(mainWindow.events, [
            {
                channel: 'platform-sync:link-state-changed',
                payload: {
                    platform: 'steam',
                    status: 'waiting_for_signin',
                    message: 'Waiting for Steam authorization.',
                    displayName: 'Steam One',
                    accountId: 's1',
                },
            },
        ]);
    } finally {
        rmDir(userData);
    }
});

test('platform-sync:link emits the current failed link-state payload shape', async () => {
    const userData = makeTempUserData();
    try {
        const sync = loadPlatformSync(userData);
        const ipcMain = makeFakeIpcMain();
        const mainWindow = makeFakeWindow();
        sync.registerPlatformSyncHandlers(ipcMain, () => mainWindow);

        const originalLink = sync.steamConnector.link;
        sync.steamConnector.link = async () => {
            const error = new Error('Steam link failed');
            error.code = 'STEAM_LINK_FAILED';
            throw error;
        };
        try {
            const result = await ipcMain.handles.get('platform-sync:link')({ sender: {} }, 'steam', {});
            assert.deepEqual(result, {
                status: 'error',
                code: 'STEAM_LINK_FAILED',
                message: 'Steam link failed',
            });
        } finally {
            sync.steamConnector.link = originalLink;
        }

        assert.deepEqual(mainWindow.events, [
            {
                channel: 'platform-sync:link-state-changed',
                payload: {
                    platform: 'steam',
                    status: 'failed',
                    message: 'Steam link failed',
                },
            },
        ]);
    } finally {
        rmDir(userData);
    }
});
