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
const SYNC_FEATURE_DIR = path.join(ROOT, 'src', 'features', 'sync');
const {
    SYNC_FEATURE_API_KEYS,
    createSyncFeatureApi,
} = require('../src/features/sync/infrastructure/composition/SyncFeatureApiContract');

function makeTempUserData() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-platform-sync-'));
}

function rmDir(dir) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

function mkdirp(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, value) {
    mkdirp(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function clearPlatformSyncCache() {
    const target = path.resolve(ROOT, 'platformSync.js').toLowerCase();
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

function loadPlatformSync(userData, overrides = {}) {
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
        BrowserWindow: overrides.BrowserWindow || fakeBrowserWindow,
        Notification: overrides.Notification || fakeNotification,
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
        stop: async () => { fakeSteamBridge.isRunning = false; },
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
        if (request === './steamBridge') return overrides.steamBridge || fakeSteamBridge;
        if (request === './services/baddelApi') {
            return overrides.baddelApi || {
                requestGameEnrichBatch: async () => ({ results: [] }),
                lookupGame: async () => null,
                normalizeServerData: () => null,
            };
        }
        if (request === './services/credentialValidator') {
            return overrides.credentialValidator || { redactSecrets: (value) => value };
        }
        if (request === './analytics') {
            return overrides.analytics || {
                logPlatformLinked: async () => {},
                logPlatformUnlinked: async () => {},
                logSyncCompleted: async () => {},
                logSyncFailed: async () => {},
                logAutoSyncStarted: async () => {},
            };
        }
        if (request === './src/features/games/infrastructure/composition/GamesContainer') {
            return overrides.gamesContainer || fakeGamesContainer;
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
    const listeners = new Map();
    return {
        handles,
        listeners,
        handle(channel, fn) {
            handles.set(channel, fn);
        },
        on(channel, fn) {
            listeners.set(channel, fn);
        },
    };
}

function platformSyncDir(userData) {
    return path.join(userData, 'platform-sync');
}

function steamAccountsFile(userData) {
    return path.join(platformSyncDir(userData), 'steam_accounts.json');
}

function steamCacheFile(userData) {
    return path.join(platformSyncDir(userData), 'steam_library_merged.json');
}

function epicAccountsFile(userData) {
    return path.join(platformSyncDir(userData), 'epic_accounts.json');
}

function epicCacheFile(userData) {
    return path.join(platformSyncDir(userData), 'epic_library_merged.json');
}

test('platformSync public/runtime exports keep their current shapes', () => {
    const userData = makeTempUserData();
    try {
        const sync = loadPlatformSync(userData);
        assert.deepEqual(Object.keys(sync), SYNC_FEATURE_API_KEYS);

        const contractFacade = createSyncFeatureApi(sync);
        assert.notEqual(contractFacade, sync);
        for (const name of SYNC_FEATURE_API_KEYS) {
            assert.equal(contractFacade[name], sync[name], `${name} identity must be preserved by the API contract`);
        }

        const expectedFunctions = [
            'registerPlatformSyncHandlers',
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

        for (const name of expectedFunctions) {
            assert.equal(typeof sync[name], 'function', `${name} must remain a function export`);
        }
        assert.equal(typeof sync.steamConnector, 'object');
        assert.equal(typeof sync.epicConnector, 'object');
        for (const connector of [sync.steamConnector, sync.epicConnector]) {
            assert.equal(typeof connector.isLinked, 'function');
            assert.equal(typeof connector.getAccounts, 'function');
            assert.equal(typeof connector.link, 'function');
            assert.equal(typeof connector.syncLibrary, 'function');
            assert.equal(typeof connector.getCachedLibrary, 'function');
            assert.equal(typeof connector.unlink, 'function');
        }
    } finally {
        rmDir(userData);
    }
});

test('registerPlatformSyncHandlers registers current platform-sync IPC channels', () => {
    const userData = makeTempUserData();
    try {
        const sync = loadPlatformSync(userData);
        const ipcMain = makeFakeIpcMain();

        sync.registerPlatformSyncHandlers(ipcMain, () => null);

        assert.deepEqual([...ipcMain.handles.keys()].sort(), [
            'platform-sync:get-accounts',
            'platform-sync:get-cached',
            'platform-sync:get-state',
            'platform-sync:link',
            'platform-sync:status',
            'platform-sync:sync',
            'platform-sync:unlink',
        ]);
        assert.deepEqual([...ipcMain.listeners.keys()], []);
    } finally {
        rmDir(userData);
    }
});

test('safe IPC handlers preserve empty-cache response payload shapes', async () => {
    const userData = makeTempUserData();
    try {
        mkdirp(platformSyncDir(userData));
        const sync = loadPlatformSync(userData);
        const ipcMain = makeFakeIpcMain();
        sync.registerPlatformSyncHandlers(ipcMain, () => null);

        const fakeEvent = { sender: {} };
        assert.deepEqual(await ipcMain.handles.get('platform-sync:status')(fakeEvent), {
            steam: false,
            epic: false,
            gog: false,
        });

        assert.deepEqual(await ipcMain.handles.get('platform-sync:get-accounts')(fakeEvent, 'steam'), {
            status: 'success',
            accounts: [],
        });
        assert.deepEqual(await ipcMain.handles.get('platform-sync:get-accounts')(fakeEvent, 'epic'), {
            status: 'success',
            accounts: [],
        });
        assert.deepEqual(await ipcMain.handles.get('platform-sync:get-accounts')(fakeEvent, 'unknown'), {
            status: 'success',
            accounts: [],
        });

        assert.deepEqual(await ipcMain.handles.get('platform-sync:get-cached')(fakeEvent, 'steam'), {
            status: 'success',
            games: [],
        });
        assert.deepEqual(await ipcMain.handles.get('platform-sync:get-cached')(fakeEvent, 'epic'), {
            status: 'success',
            games: [],
        });

        const stateResult = await ipcMain.handles.get('platform-sync:get-state')(fakeEvent, 'steam');
        assert.equal(stateResult.status, 'success');
        assert.equal(stateResult.state.platform, 'steam');
        assert.equal(stateResult.state.isSyncing, false);
        assert.equal(Array.isArray(stateResult.state.logs), true);

        const unlinkSteam = await ipcMain.handles.get('platform-sync:unlink')(fakeEvent, 'steam');
        assert.deepEqual(unlinkSteam, { status: 'success' });
        const unlinkEpic = await ipcMain.handles.get('platform-sync:unlink')(fakeEvent, 'epic');
        assert.deepEqual(unlinkEpic, { status: 'success' });

        const originalError = console.error;
        console.error = () => {};
        try {
            const unknownCached = await ipcMain.handles.get('platform-sync:get-cached')(fakeEvent, 'unknown');
            assert.equal(unknownCached.status, 'error');
            assert.match(unknownCached.message, /Unsupported platform/);
        } finally {
            console.error = originalError;
        }
    } finally {
        rmDir(userData);
    }
});

test('steamConnector reads empty cache defaults and unlink removes one account ownership', async () => {
    const userData = makeTempUserData();
    try {
        mkdirp(platformSyncDir(userData));
        const sync = loadPlatformSync(userData);

        assert.equal(sync.steamConnector.isLinked(), false);
        assert.deepEqual(sync.steamConnector.getAccounts(), []);
        assert.deepEqual(await sync.steamConnector.getCachedLibrary(), []);
        await assert.doesNotReject(() => sync.steamConnector.unlink('missing'));
        assert.deepEqual(sync.steamConnector.getAccounts(), []);

        writeJson(steamAccountsFile(userData), [
            { id: 's1', displayName: 'Steam One' },
            { id: 's2', displayName: 'Steam Two' },
        ]);
        writeJson(steamCacheFile(userData), [
            {
                id: 'steam_shared',
                title: 'Shared',
                ownedBy: ['Steam One', 'Steam Two'],
                ownedByAccountIds: ['s1', 's2'],
                steamLicensedAccountIds: ['s1', 's2'],
            },
            {
                id: 'steam_two_only',
                title: 'Two Only',
                ownedBy: ['Steam Two'],
                ownedByAccountIds: ['s2'],
                steamLicensedAccountIds: ['s2'],
            },
        ]);

        await sync.steamConnector.unlink('s2');

        assert.deepEqual(readJson(steamAccountsFile(userData)), [
            { id: 's1', displayName: 'Steam One' },
        ]);
        const cached = readJson(steamCacheFile(userData));
        assert.equal(cached.length, 1);
        assert.equal(cached[0].id, 'steam_shared');
        assert.deepEqual(cached[0].ownedByAccountIds, ['s1']);
        assert.deepEqual(cached[0].steamLicensedAccountIds, ['s1']);
    } finally {
        rmDir(userData);
    }
});

test('epicConnector reads empty cache defaults and unlink removes one account ownership', async () => {
    const userData = makeTempUserData();
    try {
        mkdirp(platformSyncDir(userData));
        const sync = loadPlatformSync(userData);

        assert.equal(sync.epicConnector.isLinked(), false);
        assert.deepEqual(sync.epicConnector.getAccounts(), []);
        assert.deepEqual(await sync.epicConnector.getCachedLibrary(), []);
        await assert.doesNotReject(() => sync.epicConnector.unlink('missing'));
        assert.deepEqual(sync.epicConnector.getAccounts(), []);

        writeJson(epicAccountsFile(userData), [
            { id: 'e1', displayName: 'Epic One' },
            { id: 'e2', displayName: 'Epic Two' },
        ]);
        writeJson(epicCacheFile(userData), [
            {
                id: 'epic_shared',
                title: 'Shared',
                ownedBy: ['Epic One', 'Epic Two'],
                ownedByAccountIds: ['e1', 'e2'],
            },
            {
                id: 'epic_two_only',
                title: 'Two Only',
                ownedBy: ['Epic Two'],
                ownedByAccountIds: ['e2'],
            },
        ]);

        await sync.epicConnector.unlink('e2');

        assert.deepEqual(readJson(epicAccountsFile(userData)), [
            { id: 'e1', displayName: 'Epic One' },
        ]);
        const cached = readJson(epicCacheFile(userData));
        assert.equal(cached.length, 1);
        assert.equal(cached[0].id, 'epic_shared');
        assert.deepEqual(cached[0].ownedByAccountIds, ['e1']);
    } finally {
        rmDir(userData);
    }
});

test('autoSyncOnStartup does not call connector syncLibrary when there are no linked accounts', async () => {
    const userData = makeTempUserData();
    try {
        mkdirp(platformSyncDir(userData));
        const sync = loadPlatformSync(userData);
        let started = 0;
        sync.steamConnector.syncLibrary = async () => { started++; };
        sync.epicConnector.syncLibrary = async () => { started++; };

        await sync.autoSyncOnStartup();

        assert.equal(started, 0);
    } finally {
        rmDir(userData);
    }
});

test('autoSyncOnStartup fire-and-forgets sync for linked accounts', async () => {
    const userData = makeTempUserData();
    try {
        mkdirp(platformSyncDir(userData));
        const sync = loadPlatformSync(userData);
        writeJson(steamAccountsFile(userData), [{ id: 's1', displayName: 'Steam One' }]);
        writeJson(epicAccountsFile(userData), [{ id: 'e1', displayName: 'Epic One' }]);
        const started = [];
        sync.steamConnector.syncLibrary = async () => { started.push('steam'); };
        sync.epicConnector.syncLibrary = async () => { started.push('epic'); };

        await sync.autoSyncOnStartup();

        assert.deepEqual(started.sort(), ['epic', 'steam']);
    } finally {
        rmDir(userData);
    }
});

test('platformSync source guards preserve current Games and Sync boundaries', () => {
    const platformSyncSource = fs.readFileSync(PLATFORM_SYNC_PATH, 'utf8');
    const mainSource = fs.readFileSync(MAIN_JS_PATH, 'utf8');
    const syncContainerPath = path.join(SYNC_FEATURE_DIR, 'infrastructure', 'composition', 'SyncContainer.js');
    const syncFeatureApiContractPath = path.join(SYNC_FEATURE_DIR, 'infrastructure', 'composition', 'SyncFeatureApiContract.js');

    assert.match(
        platformSyncSource,
        /getGamesFeature\s*}\s*=\s*require\(['"]\.\/src\/features\/games\/infrastructure\/composition\/GamesContainer['"]\)/
    );
    assert.doesNotMatch(platformSyncSource, /\bcreateGamesFeature\b/);
    assert.doesNotMatch(platformSyncSource, /SyncContainer/);
    assert.doesNotMatch(platformSyncSource, /getSyncFeature/);
    assert.doesNotMatch(platformSyncSource, /\bcreateSyncFeature\s*\(/);
    assert.match(platformSyncSource, /createPlatformSyncFeature/);
    assert.match(platformSyncSource, /createPlatformSyncFeature\(\{/);
    assert.doesNotMatch(platformSyncSource, /SyncFeatureApiContract/);
    assert.doesNotMatch(platformSyncSource, /createSyncFeatureApi/);
    assert.match(mainSource, /require\(['"]\.\/src\/features\/sync\/infrastructure\/composition\/SyncContainer['"]\)/);
    assert.match(mainSource, /getSyncFeature\(\)/);
    assert.equal(fs.existsSync(syncContainerPath), true);
    assert.equal(fs.existsSync(syncFeatureApiContractPath), true);

    const syncContainer = require(syncContainerPath);
    assert.equal(typeof syncContainer.createSyncFeature, 'function');
    assert.equal(typeof syncContainer.getSyncFeature, 'function');

    const syncFiles = fs.readdirSync(SYNC_FEATURE_DIR, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => path.join(entry.parentPath || SYNC_FEATURE_DIR, entry.name))
        .filter((filePath) => filePath.endsWith('.js'));

    for (const filePath of syncFiles) {
        const source = fs.readFileSync(filePath, 'utf8');
        if (path.basename(filePath) === 'SyncContainer.js') {
            assert.match(source, /createSyncFeature/);
            assert.match(source, /getSyncFeature/);
            assert.match(source, /loadDefaultPlatformSyncApi/);
            assert.match(source, /SyncFeatureApiContract/);
            assert.doesNotMatch(source, /main\.js|preload\.js|src\/js|src\\js/);
            continue;
        }
        if (path.basename(filePath) === 'SyncFeatureApiContract.js') {
            assert.match(source, /SYNC_FEATURE_API_KEYS/);
            assert.doesNotMatch(source, /platformSync|SyncContainer|electron|main\.js|preload\.js|src\/js|src\\js/);
            continue;
        }
        if (path.basename(filePath) === 'createPlatformSyncFeature.js') {
            assert.match(source, /createPlatformSyncFeature/);
            assert.match(source, /SyncFeatureApiContract/);
            assert.doesNotMatch(source, /platformSync\.js|SyncContainer|electron|main\.js|preload\.js|src\/js|src\\js/);
            continue;
        }
        assert.doesNotMatch(source, /platformSync/);
        assert.doesNotMatch(source, /SyncContainer/);
    }
});
