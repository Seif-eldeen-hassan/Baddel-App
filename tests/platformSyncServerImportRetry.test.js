'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.resolve(__dirname, '..');
const PLATFORM_SYNC_PATH = path.join(ROOT, 'platformSync.js');
const SYNC_SERVICES_DIR = path.join(ROOT, 'src', 'features', 'sync', 'application', 'services');
const SYNC_REPOSITORIES_DIR = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'repositories');
const SYNC_CONTAINER_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'composition', 'SyncContainer.js');

function makeTempUserData() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-sync-server-import-'));
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

function platformSyncDir(userData) {
    return path.join(userData, 'platform-sync');
}

function steamAccountsFile(userData) {
    return path.join(platformSyncDir(userData), 'steam_accounts.json');
}

function steamCacheFile(userData) {
    return path.join(platformSyncDir(userData), 'steam_library_merged.json');
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
            normalized.includes(`${path.sep}src${path.sep}features${path.sep}games${path.sep}infrastructure${path.sep}composition${path.sep}gamescontainer.js`) ||
            normalized.includes(`${path.sep}src${path.sep}features${path.sep}sync${path.sep}infrastructure${path.sep}repositories${path.sep}platformsynccacherepository.js`)
        ) {
            delete require.cache[key];
        }
    }
}

function makeFakeSteamBridge(options = {}) {
    const calls = {
        start: 0,
        authenticate: [],
        waitForCacheReady: [],
        getOwnedGames: 0,
    };
    const ownedResponses = [...(options.ownedResponses || [
        { status: 'success', games: [{ id: 'steam_10', appid: 10, title: 'Portal' }] },
    ])];
    const bridge = {
        calls,
        isRunning: false,
        _cacheIsReady: true,
        on() {},
        async start() {
            calls.start++;
            bridge.isRunning = true;
        },
        async stop() {
            bridge.isRunning = false;
        },
        getLastSessionSteamId() {
            return 's1';
        },
        getCredentialsForAccount(accountId) {
            return { accountId };
        },
        async authenticate(creds, authOptions) {
            calls.authenticate.push({ creds, authOptions });
            return { status: 'authenticated', steamId: String(creds.accountId || 's1') };
        },
        async waitForCacheReady(accountId, timeoutMs) {
            calls.waitForCacheReady.push({ accountId: String(accountId), timeoutMs });
        },
        async getOwnedGames() {
            calls.getOwnedGames++;
            return ownedResponses.length ? ownedResponses.shift() : { status: 'success', games: [] };
        },
        deleteCredentialsForAccount() {},
        async waitForCredentials() {
            return true;
        },
        async logout() {},
    };
    return bridge;
}

function makeBaddelApi(overrides = {}) {
    const calls = {
        requestGameEnrichBatch: [],
        lookupGame: [],
        normalizeServerData: [],
    };
    return {
        calls,
        async requestGameEnrichBatch(platform, chunk) {
            calls.requestGameEnrichBatch.push({ platform, chunk });
            if (overrides.requestGameEnrichBatch) {
                return overrides.requestGameEnrichBatch(platform, chunk, calls.requestGameEnrichBatch.length);
            }
            return makeBatchResult('accepted', chunk[0]?.id || '10');
        },
        async lookupGame(params) {
            calls.lookupGame.push(params);
            if (overrides.lookupGame) return overrides.lookupGame(params, calls.lookupGame.length);
            return null;
        },
        normalizeServerData(value) {
            calls.normalizeServerData.push(value);
            if (overrides.normalizeServerData) return overrides.normalizeServerData(value);
            return null;
        },
    };
}

function makeAnalytics() {
    return {
        logPlatformLinked: async () => {},
        logPlatformUnlinked: async () => {},
        logSyncCompleted: async () => {},
        logSyncFailed: async () => {},
        logAutoSyncStarted: async () => {},
    };
}

function makeGamesFeature() {
    return {
        async getSavedGames() {
            return [];
        },
        async getLocalSteamGames() {
            return [];
        },
        async removeEpicNonGameEntries() {},
    };
}

function loadPlatformSync(userData, overrides = {}) {
    clearPlatformSyncCache();
    const originalLoad = Module._load;
    const baddelApi = overrides.baddelApi || makeBaddelApi();
    const steamBridge = overrides.steamBridge || makeFakeSteamBridge();
    const analytics = overrides.analytics || makeAnalytics();
    const gamesFeature = overrides.gamesFeature || makeGamesFeature();

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
        if (request === 'child_process') return { execFile: () => ({ stdout: { on() {} }, stderr: { on() {} }, on() {} }) };
        if (request === './steamBridge') return steamBridge;
        if (request === './services/baddelApi') return baddelApi;
        if (request === './analytics') return analytics;
        if (request === './services/credentialValidator') return { redactSecrets: (value) => value };
        if (request === './src/features/games/infrastructure/composition/GamesContainer') {
            return { getGamesFeature: () => gamesFeature };
        }
        return originalLoad.apply(this, arguments);
    };

    try {
        const sync = require('../platformSync');
        return { sync, baddelApi, steamBridge };
    } finally {
        Module._load = originalLoad;
    }
}

function makeBatchResult(status, id = '10') {
    const counts = {
        acceptedCount: 0,
        queuedCount: 0,
        alreadyQueuedCount: 0,
        alreadyExistsCount: 0,
        invalidCount: 0,
        errorCount: 0,
        dedupCount: 0,
    };
    if (status === 'accepted') counts.acceptedCount = 1;
    if (status === 'already_exists' || status === 'needs_enrich') counts.alreadyExistsCount = 1;
    if (status === 'created_and_queued') counts.queuedCount = 1;
    if (status === 'already_queued') counts.alreadyQueuedCount = 1;
    if (status === 'error') counts.errorCount = 1;
    return {
        ...counts,
        results: status === 'accepted' ? [] : [{ id, status }],
    };
}

function makeRateLimitError({ retryAfter } = {}) {
    const err = new Error('rate limited');
    err.status = 429;
    if (retryAfter !== undefined) err.retryAfter = retryAfter;
    return err;
}

function installImmediateTimers() {
    const delays = [];
    const originalSetTimeout = global.setTimeout;
    const originalClearTimeout = global.clearTimeout;
    global.setTimeout = (fn, ms = 0, ...args) => {
        delays.push(ms);
        return setImmediate(() => fn(...args));
    };
    global.clearTimeout = (handle) => {
        clearImmediate(handle);
    };
    return {
        delays,
        restore() {
            global.setTimeout = originalSetTimeout;
            global.clearTimeout = originalClearTimeout;
        },
    };
}

async function flushAsync(times = 1) {
    for (let i = 0; i < times; i++) {
        await new Promise((resolve) => setImmediate(resolve));
    }
}

async function waitFor(assertion, maxTicks = 100) {
    let lastError = null;
    for (let i = 0; i < maxTicks; i++) {
        try {
            assertion();
            return;
        } catch (err) {
            lastError = err;
            await flushAsync(2);
        }
    }
    if (lastError) throw lastError;
}

function setupSteamImportFixture(userData, steamGames = [{ id: 'steam_10', appid: 10, title: 'Portal' }]) {
    mkdirp(platformSyncDir(userData));
    writeJson(steamAccountsFile(userData), [{ id: 's1', displayName: 'Steam One' }]);
    return makeFakeSteamBridge({
        ownedResponses: [
            { status: 'success', games: steamGames },
        ],
    });
}

test('server import retries a 429 batch page using Retry-After and then applies lookup metadata', async () => {
    const userData = makeTempUserData();
    const timers = installImmediateTimers();
    try {
        const steamBridge = setupSteamImportFixture(userData);
        const baddelApi = makeBaddelApi({
            requestGameEnrichBatch: async (_platform, _chunk, callCount) => {
                if (callCount === 1) throw makeRateLimitError({ retryAfter: '2' });
                return makeBatchResult('already_exists', '10');
            },
            lookupGame: async (params) => ({ id: params.id, title: 'Portal from Server' }),
            normalizeServerData: (value) => value && ({
                cover: 'https://cdn.example/portal-cover.jpg',
                heroImage: 'https://cdn.example/portal-hero.jpg',
                logo: 'https://cdn.example/portal-logo.png',
                info: { releaseDate: '2007-10-10' },
            }),
        });
        const { sync } = loadPlatformSync(userData, { baddelApi, steamBridge });

        await sync.steamConnector.syncLibrary();

        await waitFor(() => {
            assert.equal(baddelApi.calls.requestGameEnrichBatch.length, 2);
            assert.deepEqual(baddelApi.calls.requestGameEnrichBatch[0].chunk, [{ id: '10', title: 'Portal' }]);
            assert.deepEqual(baddelApi.calls.requestGameEnrichBatch[1].chunk, [{ id: '10', title: 'Portal' }]);
            assert.deepEqual(baddelApi.calls.lookupGame, [{ platform: 'steam', id: '10' }]);
            const cached = readJson(steamCacheFile(userData))[0];
            assert.equal(cached.coverUrl, 'https://cdn.example/portal-cover.jpg');
            assert.equal(cached.heroUrl, 'https://cdn.example/portal-hero.jpg');
            assert.equal(cached.logoUrl, 'https://cdn.example/portal-logo.png');
            assert.equal(cached.releaseYear, '2007-10-10');
        });
        assert.ok(timers.delays.includes(2000));
    } finally {
        timers.restore();
        rmDir(userData);
    }
});

test('server import retries a 429 batch page with jittered exponential backoff when Retry-After is absent', async () => {
    const userData = makeTempUserData();
    const timers = installImmediateTimers();
    const originalRandom = Math.random;
    Math.random = () => 0.5;
    try {
        const steamBridge = setupSteamImportFixture(userData);
        const baddelApi = makeBaddelApi({
            requestGameEnrichBatch: async (_platform, _chunk, callCount) => {
                if (callCount === 1) throw makeRateLimitError();
                return makeBatchResult('accepted', '10');
            },
        });
        const { sync } = loadPlatformSync(userData, { baddelApi, steamBridge });

        await sync.steamConnector.syncLibrary();

        await waitFor(() => {
            assert.equal(baddelApi.calls.requestGameEnrichBatch.length, 2);
            assert.deepEqual(baddelApi.calls.requestGameEnrichBatch[1].chunk, [{ id: '10', title: 'Portal' }]);
        });
        assert.ok(timers.delays.includes(10000));
    } finally {
        Math.random = originalRandom;
        timers.restore();
        rmDir(userData);
    }
});

test('server import retries per-item error results and polls when retry returns created_and_queued', async () => {
    const userData = makeTempUserData();
    const timers = installImmediateTimers();
    try {
        const steamBridge = setupSteamImportFixture(userData);
        const baddelApi = makeBaddelApi({
            requestGameEnrichBatch: async (_platform, _chunk, callCount) => {
                if (callCount === 1) return makeBatchResult('error', '10');
                return makeBatchResult('created_and_queued', '10');
            },
            lookupGame: async (params) => ({ id: params.id, title: 'Portal enriched later' }),
            normalizeServerData: (value) => value && ({
                cover: 'https://cdn.example/retry-poll-cover.jpg',
                heroImage: null,
                logo: null,
            }),
        });
        const { sync } = loadPlatformSync(userData, { baddelApi, steamBridge });

        await sync.steamConnector.syncLibrary();

        await waitFor(() => {
            assert.equal(baddelApi.calls.requestGameEnrichBatch.length, 2);
            assert.deepEqual(baddelApi.calls.requestGameEnrichBatch[0].chunk, [{ id: '10', title: 'Portal' }]);
            assert.deepEqual(baddelApi.calls.requestGameEnrichBatch[1].chunk, [{ id: '10', title: 'Portal' }]);
            assert.deepEqual(baddelApi.calls.lookupGame, [{ platform: 'steam', id: '10' }]);
            assert.equal(readJson(steamCacheFile(userData))[0].coverUrl, 'https://cdn.example/retry-poll-cover.jpg');
        });
        assert.ok(timers.delays.includes(12000));
    } finally {
        timers.restore();
        rmDir(userData);
    }
});

test('created_and_queued import result polls after delay and writes normalized metadata on a later lookup', async () => {
    const userData = makeTempUserData();
    const timers = installImmediateTimers();
    try {
        const steamBridge = setupSteamImportFixture(userData);
        const baddelApi = makeBaddelApi({
            requestGameEnrichBatch: async () => makeBatchResult('created_and_queued', '10'),
            lookupGame: async (params, callCount) => callCount === 1 ? null : { id: params.id, title: 'Portal enriched' },
            normalizeServerData: (value) => value && ({
                cover: null,
                heroImage: 'https://cdn.example/queued-hero.jpg',
                logo: null,
            }),
        });
        const { sync } = loadPlatformSync(userData, { baddelApi, steamBridge });

        await sync.steamConnector.syncLibrary();

        await waitFor(() => {
            assert.deepEqual(baddelApi.calls.lookupGame, [
                { platform: 'steam', id: '10' },
                { platform: 'steam', id: '10' },
            ]);
            assert.equal(readJson(steamCacheFile(userData))[0].heroUrl, 'https://cdn.example/queued-hero.jpg');
        });
        assert.ok(timers.delays.includes(12000));
        assert.ok(timers.delays.includes(15000));
    } finally {
        timers.restore();
        rmDir(userData);
    }
});

test('already_queued import result follows the same delayed poll and write-back path', async () => {
    const userData = makeTempUserData();
    const timers = installImmediateTimers();
    try {
        const steamBridge = setupSteamImportFixture(userData);
        const baddelApi = makeBaddelApi({
            requestGameEnrichBatch: async () => makeBatchResult('already_queued', '10'),
            lookupGame: async (params) => ({ id: params.id, title: 'Portal already queued' }),
            normalizeServerData: (value) => value && ({
                cover: 'https://cdn.example/already-queued-cover.jpg',
                heroImage: null,
                logo: 'https://cdn.example/already-queued-logo.png',
            }),
        });
        const { sync } = loadPlatformSync(userData, { baddelApi, steamBridge });

        await sync.steamConnector.syncLibrary();

        await waitFor(() => {
            assert.deepEqual(baddelApi.calls.lookupGame, [{ platform: 'steam', id: '10' }]);
            const cached = readJson(steamCacheFile(userData))[0];
            assert.equal(cached.coverUrl, 'https://cdn.example/already-queued-cover.jpg');
            assert.equal(cached.logoUrl, 'https://cdn.example/already-queued-logo.png');
        });
        assert.ok(timers.delays.includes(12000));
    } finally {
        timers.restore();
        rmDir(userData);
    }
});

test('delayed polling gives up after three lookup attempts when no normalized images appear', async () => {
    const userData = makeTempUserData();
    const timers = installImmediateTimers();
    try {
        const steamBridge = setupSteamImportFixture(userData);
        const baddelApi = makeBaddelApi({
            requestGameEnrichBatch: async () => makeBatchResult('created_and_queued', '10'),
            lookupGame: async () => null,
            normalizeServerData: () => null,
        });
        const { sync } = loadPlatformSync(userData, { baddelApi, steamBridge });

        await sync.steamConnector.syncLibrary();

        await waitFor(() => {
            assert.equal(baddelApi.calls.lookupGame.length, 3);
            const cached = readJson(steamCacheFile(userData))[0];
            assert.equal(cached.coverUrl, null);
            assert.equal(cached.heroUrl, null);
            assert.equal(cached.logoUrl, null);
        });
        assert.equal(timers.delays.filter((delay) => delay === 12000).length, 1);
        assert.equal(timers.delays.filter((delay) => delay === 15000).length, 2);
    } finally {
        timers.restore();
        rmDir(userData);
    }
});

test('platformSync delegates server import to the extracted service', () => {
    const source = fs.readFileSync(PLATFORM_SYNC_PATH, 'utf8');

    assert.match(source, /async function _importLibraryToServer\(platform, games\)/);
    assert.match(source, /PlatformSyncServerImportService/);
    assert.match(source, /serverImportService\.importLibraryToServer\(platform, games\)/);
    assert.equal(fs.existsSync(path.join(SYNC_SERVICES_DIR, 'PlatformSyncServerImportService.js')), true);
    assert.equal(fs.existsSync(path.join(SYNC_SERVICES_DIR, 'PlatformSyncAssetWriteBackService.js')), true);
    assert.equal(fs.existsSync(path.join(SYNC_REPOSITORIES_DIR, 'PlatformSyncCacheRepository.js')), true);
    assert.equal(fs.existsSync(SYNC_CONTAINER_PATH), false);
});
