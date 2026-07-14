'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { EventEmitter } = require('node:events');

const ROOT = path.resolve(__dirname, '..');

function makeTempUserData() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-sync-event-payloads-'));
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
            normalized.includes(`${path.sep}src${path.sep}features${path.sep}sync${path.sep}`)
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
        { status: 'success', games: [] },
    ])];
    const bridge = {
        calls,
        isRunning: !!options.isRunning,
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
            return options.lastSessionSteamId || '';
        },
        getCredentialsForAccount(accountId) {
            return { accountId };
        },
        async authenticate(creds, authOptions) {
            calls.authenticate.push({ creds, authOptions });
            return { status: 'authenticated', steamId: String(creds.accountId || options.lastSessionSteamId || '') };
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
    const requestResponses = [...(overrides.requestResponses || [])];
    return {
        calls,
        async requestGameEnrichBatch(platform, chunk) {
            calls.requestGameEnrichBatch.push({ platform, chunk });
            if (overrides.requestGameEnrichBatch) {
                return overrides.requestGameEnrichBatch(platform, chunk, calls.requestGameEnrichBatch.length);
            }
            if (requestResponses.length) return requestResponses.shift();
            return {
                acceptedCount: chunk.length,
                queuedCount: 0,
                alreadyQueuedCount: 0,
                alreadyExistsCount: 0,
                invalidCount: 0,
                errorCount: 0,
                dedupCount: 0,
                results: [],
            };
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
    const calls = {
        completed: [],
        failed: [],
        linked: [],
        unlinked: [],
        autoSyncStarted: [],
    };
    return {
        calls,
        logPlatformLinked: async (platform) => calls.linked.push(platform),
        logPlatformUnlinked: async (platform) => calls.unlinked.push(platform),
        logSyncCompleted: async (...args) => calls.completed.push(args),
        logSyncFailed: async (...args) => calls.failed.push(args),
        logAutoSyncStarted: async (platforms) => calls.autoSyncStarted.push(platforms),
    };
}

function makeGamesFeature(overrides = {}) {
    const calls = {
        getSavedGames: 0,
        getLocalSteamGames: 0,
        removeEpicNonGameEntries: [],
    };
    return {
        calls,
        async getSavedGames() {
            calls.getSavedGames++;
            return overrides.savedGames || [];
        },
        async getLocalSteamGames() {
            calls.getLocalSteamGames++;
            return overrides.localSteamGames || [];
        },
        async removeEpicNonGameEntries(entries) {
            calls.removeEpicNonGameEntries.push(entries);
        },
    };
}

function makeLegendaryExec() {
    const execFile = () => {
        const proc = new EventEmitter();
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        process.nextTick(() => {
            proc.stdout.emit('data', '[]');
            proc.emit('close', 0, null);
        });
        return proc;
    };
    return execFile;
}

function makeFakeWindow({ destroyed = false } = {}) {
    const events = [];
    return {
        events,
        isDestroyed: () => destroyed,
        isFocused: () => true,
        webContents: {
            send(channel, payload) {
                events.push({ channel, payload });
            },
        },
    };
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

function loadPlatformSync(userData, overrides = {}) {
    clearPlatformSyncCache();
    const originalLoad = Module._load;
    const baddelApi = overrides.baddelApi || makeBaddelApi();
    const analytics = overrides.analytics || makeAnalytics();
    const gamesFeature = overrides.gamesFeature || makeGamesFeature();
    const steamBridge = overrides.steamBridge || makeFakeSteamBridge();
    const execFile = overrides.execFile || makeLegendaryExec();
    const fsPromises = overrides.fsPromises || fs.promises;

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
        if (request === 'fs') return { ...fs, promises: fsPromises };
        if (request === 'child_process') return { execFile };
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
        return { sync, baddelApi, analytics, gamesFeature, steamBridge, execFile };
    } finally {
        Module._load = originalLoad;
    }
}

async function flushAsync() {
    await new Promise((resolve) => setImmediate(resolve));
}

async function waitFor(assertion, timeoutMs = 1000) {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    while (Date.now() < deadline) {
        try {
            assertion();
            return;
        } catch (err) {
            lastError = err;
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
    }
    if (lastError) throw lastError;
}

function makeAlreadyExistsBatch(id) {
    return {
        acceptedCount: 0,
        queuedCount: 0,
        alreadyQueuedCount: 0,
        alreadyExistsCount: 1,
        invalidCount: 0,
        errorCount: 0,
        dedupCount: 0,
        results: [{ id, status: 'already_exists' }],
    };
}

test('platform-sync:link-state-changed preserves success and failure payload shapes', async () => {
    const userData = makeTempUserData();
    try {
        const { sync } = loadPlatformSync(userData);
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

        assert.deepEqual(mainWindow.events, [{
            channel: 'platform-sync:link-state-changed',
            payload: {
                platform: 'steam',
                status: 'waiting_for_signin',
                message: 'Waiting for Steam authorization.',
                displayName: 'Steam One',
                accountId: 's1',
            },
        }]);

        mainWindow.events.length = 0;
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

        assert.deepEqual(mainWindow.events, [{
            channel: 'platform-sync:link-state-changed',
            payload: {
                platform: 'steam',
                status: 'failed',
                message: 'Steam link failed',
            },
        }]);
    } finally {
        rmDir(userData);
    }
});

test('steam sync emits cloned state and completed payload shapes', async () => {
    const userData = makeTempUserData();
    try {
        mkdirp(platformSyncDir(userData));
        writeJson(steamAccountsFile(userData), [{ id: 's1', displayName: 'Steam One' }]);
        const steamBridge = makeFakeSteamBridge({
            lastSessionSteamId: 's1',
            ownedResponses: [
                { status: 'success', games: [{ id: 'steam_10', appid: 10, title: 'Portal' }] },
            ],
        });
        const { sync } = loadPlatformSync(userData, { steamBridge });
        const ipcMain = makeFakeIpcMain();
        const win = makeFakeWindow();
        sync.registerPlatformSyncHandlers(ipcMain, () => win);

        const result = await sync.steamConnector.syncLibrary();
        await flushAsync();

        assert.deepEqual(result.map((game) => game.id), ['steam_10']);
        const stateEvents = win.events.filter((event) => event.channel === 'platform-sync:state');
        assert.ok(stateEvents.length > 0);

        const startingState = stateEvents[0].payload;
        assert.equal(startingState.platform, 'steam');
        assert.equal(startingState.isSyncing, true);
        assert.equal(startingState.phase, 'starting');
        assert.equal(startingState.statusText, 'Syncing Steam library for 1 account(s)');
        assert.deepEqual(Object.keys(startingState.accounts), ['s1']);
        assert.deepEqual(startingState.progress, {
            completedAccounts: 0,
            totalAccounts: 1,
            percent: 0,
            currentAccountId: null,
            currentAccountName: null,
        });
        assert.deepEqual(startingState.logs, []);
        assert.equal(startingState.lastError, null);

        startingState.statusText = 'mutated outside platformSync';
        const currentState = await ipcMain.handles.get('platform-sync:get-state')({}, 'steam');
        assert.notEqual(currentState.state.statusText, 'mutated outside platformSync');

        const completed = win.events.find((event) => event.channel === 'platform-sync:completed');
        assert.ok(completed);
        assert.equal(completed.payload.platform, 'steam');
        assert.equal(completed.payload.isSyncing, false);
        assert.equal(completed.payload.phase, 'done');
        assert.equal(completed.payload.statusText, 'Steam sync completed. 1 games ready.');
        assert.equal(completed.payload.progress.completedAccounts, 1);
        assert.equal(completed.payload.progress.totalAccounts, 1);
        assert.equal(completed.payload.progress.percent, 100);
        assert.equal(completed.payload.accounts.s1.status, 'synced');
        assert.equal(completed.payload.accounts.s1.gamesCount, 1);
        assert.deepEqual(completed.payload.accounts.s1.gameTitles, ['Portal']);
        assert.deepEqual(completed.payload.summary, {
            totalGames: 1,
            installOnlyGames: 0,
            sampleTitles: ['Portal'],
        });
        assert.equal(completed.payload.lastError, null);
    } finally {
        rmDir(userData);
    }
});

test('steam sync emits failed payload shape when final cache write fails', async () => {
    const userData = makeTempUserData();
    try {
        mkdirp(platformSyncDir(userData));
        writeJson(steamAccountsFile(userData), [{ id: 's1', displayName: 'Steam One' }]);
        const steamBridge = makeFakeSteamBridge({
            lastSessionSteamId: 's1',
            ownedResponses: [
                { status: 'success', games: [{ id: 'steam_10', appid: 10, title: 'Portal' }] },
            ],
        });
        const fsPromises = {
            ...fs.promises,
            async writeFile(filePath, ...args) {
                if (String(filePath).endsWith('steam_library_merged.json')) {
                    throw new Error('merged cache write failed');
                }
                return fs.promises.writeFile(filePath, ...args);
            },
        };
        const { sync, analytics } = loadPlatformSync(userData, { steamBridge, fsPromises });
        const win = makeFakeWindow();
        sync.registerPlatformSyncHandlers({ handle() {}, on() {} }, () => win);

        await assert.rejects(
            () => sync.steamConnector.syncLibrary(),
            /merged cache write failed/
        );

        const failed = win.events.find((event) => event.channel === 'platform-sync:failed');
        assert.ok(failed);
        assert.equal(failed.payload.platform, 'steam');
        assert.equal(failed.payload.isSyncing, false);
        assert.equal(failed.payload.phase, 'error');
        assert.equal(failed.payload.statusText, 'Steam sync failed: merged cache write failed');
        assert.equal(failed.payload.lastError, 'merged cache write failed');
        assert.equal(failed.payload.progress.completedAccounts, 1);
        assert.equal(failed.payload.progress.totalAccounts, 1);
        assert.equal(failed.payload.progress.percent, 100);
        assert.equal(failed.payload.accounts.s1.status, 'synced');
        assert.equal(failed.payload.accounts.s1.gamesCount, 1);
        assert.deepEqual(analytics.calls.failed, [['steam', 'merged cache write failed']]);
    } finally {
        rmDir(userData);
    }
});

test('library-updated payload uses saved games after server import debounce', async () => {
    const userData = makeTempUserData();
    try {
        mkdirp(platformSyncDir(userData));
        writeJson(steamAccountsFile(userData), [{ id: 's1', displayName: 'Steam One' }]);
        const baddelApi = makeBaddelApi({
            requestResponses: [makeAlreadyExistsBatch('10')],
            lookupGame: async (params) => ({ id: params.id, found: true }),
            normalizeServerData: () => ({
                title: 'Portal',
                cover: 'https://cdn.example/portal-cover.jpg',
                heroImage: 'https://cdn.example/portal-hero.jpg',
                logo: 'https://cdn.example/portal-logo.png',
                info: { releaseDate: '2007-10-10' },
            }),
        });
        const gamesFeature = makeGamesFeature({
            savedGames: [{ id: 'steam_10', title: 'Portal Saved' }],
        });
        const steamBridge = makeFakeSteamBridge({
            lastSessionSteamId: 's1',
            ownedResponses: [
                { status: 'success', games: [{ id: 'steam_10', appid: 10, title: 'Portal' }] },
            ],
        });
        const { sync } = loadPlatformSync(userData, { baddelApi, gamesFeature, steamBridge });
        const win = makeFakeWindow();
        sync.registerPlatformSyncHandlers({ handle() {}, on() {} }, () => win);
        sync.registerPlatformSyncAssetDownloader(async () => ({
            cover: 'file:///image-cache/steam_10-cover.webp',
            hero: 'file:///image-cache/steam_10-hero.webp',
            logo: 'file:///image-cache/steam_10-logo.webp',
        }));

        await sync.steamConnector.syncLibrary();

        await waitFor(() => {
            assert.deepEqual(baddelApi.calls.lookupGame, [{ platform: 'steam', id: '10' }]);
            const cached = readJson(steamCacheFile(userData))[0];
            assert.equal(cached.coverUrl, 'file:///image-cache/steam_10-cover.webp');
            assert.equal(cached.heroUrl, 'file:///image-cache/steam_10-hero.webp');
            assert.equal(cached.logoUrl, 'file:///image-cache/steam_10-logo.webp');
            assert.equal(cached.releaseYear, '2007-10-10');
        });

        await waitFor(() => {
            const events = win.events.filter((event) => event.channel === 'library-updated');
            assert.equal(events.length, 1);
            assert.deepEqual(events[0].payload, [{ id: 'steam_10', title: 'Portal Saved' }]);
            assert.ok(gamesFeature.calls.getSavedGames >= 1);
        }, 2600);
    } finally {
        rmDir(userData);
    }
});

test('all-games-cover-cached payload shape is forwarded from cover-first warmup', async () => {
    const userData = makeTempUserData();
    try {
        const { sync } = loadPlatformSync(userData);
        const cacheFile = path.join(userData, 'cover-cache.json');
        writeJson(cacheFile, [{
            id: 'game-1',
            appid: '10',
            title: 'Cover First',
            platform: 'steam',
            appName: '10',
            coverUrl: 'https://cdn.example/cover.jpg',
        }]);
        const coverEvents = [];

        await sync.cacheLibraryCoversFirst(
            readJson(cacheFile),
            async () => ({ cover: 'file:///cache/cover.webp' }),
            cacheFile,
            (library, entry) => library.findIndex((game) => game.id === entry.id),
            null,
            {
                coverConcurrency: 1,
                secondaryConcurrency: 1,
                batchSize: 1,
                coverCachedEmitter: (payload) => {
                    coverEvents.push({ channel: 'all-games-cover-cached', payload });
                },
            }
        );

        assert.deepEqual(coverEvents, [{
            channel: 'all-games-cover-cached',
            payload: {
                platform: 'steam',
                accountId: null,
                id: 'game-1',
                title: 'Cover First',
                appid: '10',
                namespace: null,
                coverUrl: 'file:///cache/cover.webp',
                image: 'file:///cache/cover.webp',
                defaultImage: 'file:///cache/cover.webp',
                _agCoverPipelineDone: true,
            },
        }]);
    } finally {
        rmDir(userData);
    }
});

test('destroyed or missing windows do not receive sync event sends', async () => {
    const userData = makeTempUserData();
    try {
        mkdirp(platformSyncDir(userData));
        writeJson(steamAccountsFile(userData), [{ id: 's1', displayName: 'Steam One' }]);
        const steamBridge = makeFakeSteamBridge({
            lastSessionSteamId: 's1',
            ownedResponses: [
                { status: 'success', games: [{ id: 'steam_10', appid: 10, title: 'Portal' }] },
            ],
        });
        const { sync } = loadPlatformSync(userData, { steamBridge });
        const destroyedWindow = makeFakeWindow({ destroyed: true });
        sync.registerPlatformSyncHandlers({ handle() {}, on() {} }, () => destroyedWindow);

        await sync.steamConnector.syncLibrary();
        await flushAsync();

        assert.deepEqual(destroyedWindow.events, []);
    } finally {
        rmDir(userData);
    }
});
