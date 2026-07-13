'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { EventEmitter } = require('node:events');

const ROOT = path.resolve(__dirname, '..');
const PLATFORM_SYNC_PATH = path.join(ROOT, 'platformSync.js');
const SYNC_REPOSITORIES_DIR = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'repositories');

function makeTempUserData() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-sync-cache-'));
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

function writeText(filePath, value) {
    mkdirp(path.dirname(filePath));
    fs.writeFileSync(filePath, value, 'utf8');
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

function clearPlatformSyncCache() {
    for (const key of Object.keys(require.cache)) {
        const normalized = path.normalize(key).toLowerCase();
        const base = path.basename(normalized);
        if (
            base === 'platformsync.js' ||
            base === 'steambridge.js' ||
            base === 'analytics.js' ||
            normalized.includes(`${path.sep}services${path.sep}baddelapi.js`) ||
            normalized.includes(`${path.sep}services${path.sep}credentialvalidator.js`) ||
            normalized.includes(`${path.sep}src${path.sep}features${path.sep}games${path.sep}infrastructure${path.sep}composition${path.sep}gamescontainer.js`)
        ) {
            delete require.cache[key];
        }
    }
}

function makeLegendaryExec() {
    const calls = [];
    const execFile = (file, args, options = {}) => {
        const proc = new EventEmitter();
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        calls.push({ file, args: [...args], options });
        process.nextTick(() => {
            proc.stdout.emit('data', '[]');
            proc.emit('close', 0, null);
        });
        return proc;
    };
    execFile.calls = calls;
    return execFile;
}

function loadPlatformSync(userData, overrides = {}) {
    clearPlatformSyncCache();
    const originalLoad = Module._load;
    const execFile = overrides.execFile || makeLegendaryExec();
    const steamBridge = overrides.steamBridge || {
        isRunning: false,
        start: async () => {},
        stop: async () => { steamBridge.isRunning = false; },
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
    const fakeGamesContainer = {
        getGamesFeature: () => ({
            getSavedGames: async () => [],
            getLocalSteamGames: async () => [],
            removeEpicNonGameEntries: async () => {},
        }),
    };

    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === 'electron') {
            return {
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
        }
        if (request === 'child_process') return { execFile };
        if (request === './steamBridge') return steamBridge;
        if (request === './services/baddelApi') {
            return {
                requestGameEnrichBatch: async () => ({ results: [] }),
                lookupGame: async () => null,
                normalizeServerData: () => null,
            };
        }
        if (request === './services/credentialValidator') return { redactSecrets: (value) => value };
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
        const sync = require('../platformSync');
        return { sync, execFile, steamBridge };
    } finally {
        Module._load = originalLoad;
    }
}

test('steam cache getters return empty arrays for missing and corrupt persistence files', async () => {
    const userData = makeTempUserData();
    try {
        let loaded = loadPlatformSync(userData);
        assert.deepEqual(loaded.sync.steamConnector.getAccounts(), []);
        assert.deepEqual(await loaded.sync.steamConnector.getCachedLibrary(), []);

        writeText(steamAccountsFile(userData), '{ nope');
        writeText(steamCacheFile(userData), '{ nope');
        loaded = loadPlatformSync(userData);

        assert.deepEqual(loaded.sync.steamConnector.getAccounts(), []);
        assert.deepEqual(await loaded.sync.steamConnector.getCachedLibrary(), []);
    } finally {
        rmDir(userData);
    }
});

test('steam accounts are read from platform-sync JSON with string ids', () => {
    const userData = makeTempUserData();
    try {
        writeJson(steamAccountsFile(userData), [
            { id: 12345, displayName: 'Numeric Steam' },
            { id: '67890', displayName: 'String Steam' },
        ]);

        const { sync } = loadPlatformSync(userData);

        assert.deepEqual(sync.steamConnector.getAccounts(), [
            { id: '12345', displayName: 'Numeric Steam' },
            { id: '67890', displayName: 'String Steam' },
        ]);
    } finally {
        rmDir(userData);
    }
});

test('steam unlink removes one account ownership and drops games no longer owned', async () => {
    const userData = makeTempUserData();
    try {
        writeJson(steamAccountsFile(userData), [
            { id: 's1', displayName: 'Steam One' },
            { id: 's2', displayName: 'Steam Two' },
        ]);
        writeJson(steamCacheFile(userData), [
            {
                id: 'steam_shared',
                title: 'Shared Steam Game',
                ownedBy: ['Steam One', 'Steam Two'],
                ownedByAccountIds: ['s1', 's2'],
                ownedByAccounts: [
                    { id: 's1', displayName: 'Steam One' },
                    { id: 's2', displayName: 'Steam Two' },
                ],
                steamLicensedAccountIds: ['s1', 's2'],
            },
            {
                id: 'steam_two_only',
                title: 'Steam Two Only',
                ownedBy: ['Steam Two'],
                ownedByAccountIds: ['s2'],
                ownedByAccounts: [{ id: 's2', displayName: 'Steam Two' }],
                steamLicensedAccountIds: ['s2'],
            },
        ]);

        const { sync } = loadPlatformSync(userData);
        await sync.steamConnector.unlink('s2');

        assert.deepEqual(readJson(steamAccountsFile(userData)), [
            { id: 's1', displayName: 'Steam One' },
        ]);
        const cached = readJson(steamCacheFile(userData));
        assert.equal(cached.length, 1);
        assert.equal(cached[0].id, 'steam_shared');
        assert.deepEqual(cached[0].ownedBy, ['Steam One']);
        assert.deepEqual(cached[0].ownedByAccountIds, ['s1']);
        assert.deepEqual(cached[0].ownedByAccounts, [
            { id: 's1', displayName: 'Steam One' },
            { id: 's2', displayName: 'Steam Two' },
        ]);
        assert.deepEqual(cached[0].steamLicensedAccountIds, ['s1']);
    } finally {
        rmDir(userData);
    }
});

test('steam unlink without an account id clears accounts and deletes the merged cache', async () => {
    const userData = makeTempUserData();
    try {
        writeJson(steamAccountsFile(userData), [{ id: 's1', displayName: 'Steam One' }]);
        writeJson(steamCacheFile(userData), [{ id: 'steam_one', title: 'Steam One Game' }]);

        const { sync } = loadPlatformSync(userData);
        await sync.steamConnector.unlink();

        assert.deepEqual(readJson(steamAccountsFile(userData)), []);
        assert.equal(fs.existsSync(steamCacheFile(userData)), false);
    } finally {
        rmDir(userData);
    }
});

test('steam unlink for a missing account keeps cached ownership unchanged', async () => {
    const userData = makeTempUserData();
    const originalCache = [
        {
            id: 'steam_one',
            title: 'Steam One Game',
            ownedBy: ['Steam One'],
            ownedByAccountIds: ['s1'],
            ownedByAccounts: [{ id: 's1', displayName: 'Steam One' }],
            steamLicensedAccountIds: ['s1'],
        },
    ];
    try {
        writeJson(steamAccountsFile(userData), [{ id: 's1', displayName: 'Steam One' }]);
        writeJson(steamCacheFile(userData), originalCache);

        const { sync } = loadPlatformSync(userData);
        await sync.steamConnector.unlink('missing');

        assert.deepEqual(readJson(steamAccountsFile(userData)), [{ id: 's1', displayName: 'Steam One' }]);
        assert.deepEqual(readJson(steamCacheFile(userData)), originalCache);
    } finally {
        rmDir(userData);
    }
});

test('epic cache getters return empty arrays for missing and corrupt persistence files', async () => {
    const userData = makeTempUserData();
    try {
        let loaded = loadPlatformSync(userData);
        assert.deepEqual(loaded.sync.epicConnector.getAccounts(), []);
        assert.deepEqual(await loaded.sync.epicConnector.getCachedLibrary(), []);

        writeText(epicAccountsFile(userData), '{ nope');
        writeText(epicCacheFile(userData), '{ nope');
        loaded = loadPlatformSync(userData);

        assert.deepEqual(loaded.sync.epicConnector.getAccounts(), []);
        assert.deepEqual(await loaded.sync.epicConnector.getCachedLibrary(), []);
    } finally {
        rmDir(userData);
    }
});

test('epic accounts are read from platform-sync JSON and tmp accounts require reconnect', () => {
    const userData = makeTempUserData();
    try {
        writeJson(epicAccountsFile(userData), [
            { id: 'epic_tmp_123', displayName: 'Epic Temp' },
            { id: 'e1', displayName: 'Epic One' },
            { displayName: 'Missing Id' },
        ]);

        const { sync } = loadPlatformSync(userData);

        assert.deepEqual(sync.epicConnector.getAccounts(), [
            {
                id: 'epic_tmp_123',
                displayName: 'Reconnect Epic account',
                needsReauth: true,
            },
            { id: 'e1', displayName: 'Epic One' },
        ]);
    } finally {
        rmDir(userData);
    }
});

test('epic unlink removes one account ownership and drops games no longer owned', async () => {
    const userData = makeTempUserData();
    try {
        writeJson(epicAccountsFile(userData), [
            { id: 'e1', displayName: 'Epic One' },
            { id: 'e2', displayName: 'Epic Two' },
        ]);
        writeJson(epicCacheFile(userData), [
            {
                id: 'epic_shared',
                title: 'Shared Epic Game',
                ownedBy: ['Epic One', 'Epic Two'],
                ownedByAccountIds: ['e1', 'e2'],
                ownedByAccounts: [
                    { id: 'e1', displayName: 'Epic One' },
                    { id: 'e2', displayName: 'Epic Two' },
                ],
            },
            {
                id: 'epic_two_only',
                title: 'Epic Two Only',
                ownedBy: ['Epic Two'],
                ownedByAccountIds: ['e2'],
                ownedByAccounts: [{ id: 'e2', displayName: 'Epic Two' }],
            },
        ]);

        const { sync } = loadPlatformSync(userData);
        await sync.epicConnector.unlink('e2');

        assert.deepEqual(readJson(epicAccountsFile(userData)), [
            { id: 'e1', displayName: 'Epic One' },
        ]);
        const cached = readJson(epicCacheFile(userData));
        assert.equal(cached.length, 1);
        assert.equal(cached[0].id, 'epic_shared');
        assert.deepEqual(cached[0].ownedBy, ['Epic One']);
        assert.deepEqual(cached[0].ownedByAccountIds, ['e1']);
        assert.deepEqual(cached[0].ownedByAccounts, [
            { id: 'e1', displayName: 'Epic One' },
            { id: 'e2', displayName: 'Epic Two' },
        ]);
    } finally {
        rmDir(userData);
    }
});

test('epic unlink without an account id clears accounts and deletes the merged cache', async () => {
    const userData = makeTempUserData();
    try {
        writeJson(epicAccountsFile(userData), [{ id: 'e1', displayName: 'Epic One' }]);
        writeJson(epicCacheFile(userData), [{ id: 'epic_one', title: 'Epic One Game' }]);

        const { sync } = loadPlatformSync(userData);
        await sync.epicConnector.unlink();

        assert.deepEqual(readJson(epicAccountsFile(userData)), []);
        assert.equal(fs.existsSync(epicCacheFile(userData)), false);
    } finally {
        rmDir(userData);
    }
});

test('epic unlink for a missing account keeps cached ownership unchanged', async () => {
    const userData = makeTempUserData();
    const originalCache = [
        {
            id: 'epic_one',
            title: 'Epic One Game',
            ownedBy: ['Epic One'],
            ownedByAccountIds: ['e1'],
            ownedByAccounts: [{ id: 'e1', displayName: 'Epic One' }],
        },
    ];
    try {
        writeJson(epicAccountsFile(userData), [{ id: 'e1', displayName: 'Epic One' }]);
        writeJson(epicCacheFile(userData), originalCache);

        const { sync } = loadPlatformSync(userData);
        await sync.epicConnector.unlink('missing');

        assert.deepEqual(readJson(epicAccountsFile(userData)), [{ id: 'e1', displayName: 'Epic One' }]);
        assert.deepEqual(readJson(epicCacheFile(userData)), originalCache);
    } finally {
        rmDir(userData);
    }
});

test('platformSync still owns sync cache file names and no cache repository has been extracted', () => {
    const platformSyncSource = fs.readFileSync(PLATFORM_SYNC_PATH, 'utf8');

    assert.match(platformSyncSource, /SYNC_CACHE_DIR\s*=\s*path\.join\(app\.getPath\(['"]userData['"]\), ['"]platform-sync['"]\)/);
    assert.match(platformSyncSource, /STEAM_ACCOUNTS_FILE\s*=\s*path\.join\(SYNC_CACHE_DIR,\s*['"]steam_accounts\.json['"]\)/);
    assert.match(platformSyncSource, /STEAM_MERGED_CACHE\s*=\s*path\.join\(SYNC_CACHE_DIR,\s*['"]steam_library_merged\.json['"]\)/);
    assert.match(platformSyncSource, /EPIC_ACCOUNTS_FILE\s*=\s*path\.join\(SYNC_CACHE_DIR,\s*['"]epic_accounts\.json['"]\)/);
    assert.match(platformSyncSource, /EPIC_MERGED_CACHE\s*=\s*path\.join\(SYNC_CACHE_DIR,\s*['"]epic_library_merged\.json['"]\)/);
    assert.match(platformSyncSource, /EPIC_CLASSIFICATION_REPORT\s*=\s*path\.join\(SYNC_CACHE_DIR,\s*['"]epic_sync_classification_report\.json['"]\)/);
    assert.match(platformSyncSource, /async getCachedLibrary\(\)/);
    assert.match(platformSyncSource, /async unlink\(accountId\)/);

    const repositoryFiles = fs.existsSync(SYNC_REPOSITORIES_DIR)
        ? fs.readdirSync(SYNC_REPOSITORIES_DIR)
        : [];
    assert.equal(repositoryFiles.includes('PlatformSyncCacheRepository.js'), false);
    assert.equal(repositoryFiles.includes('SteamSyncCacheRepository.js'), false);
    assert.equal(repositoryFiles.includes('EpicSyncCacheRepository.js'), false);
    assert.equal(repositoryFiles.includes('SyncAccountRepository.js'), false);
});
