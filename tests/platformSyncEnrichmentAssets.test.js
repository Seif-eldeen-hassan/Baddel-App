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
const SYNC_SERVICES_DIR = path.join(ROOT, 'src', 'features', 'sync', 'application', 'services');
const SYNC_CONTAINER_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'composition', 'SyncContainer.js');

function makeTempUserData() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-sync-enrich-assets-'));
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

function fileUrl(filePath) {
    return `file:///${filePath.replace(/\\/g, '/')}`;
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

function makeFakeWindow() {
    const events = [];
    return {
        events,
        isDestroyed: () => false,
        webContents: {
            send(channel, payload) {
                events.push({ channel, payload });
            },
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
        return { sync, baddelApi, analytics, gamesFeature, steamBridge };
    } finally {
        Module._load = originalLoad;
    }
}

async function waitFor(assertion, timeoutMs = 2500) {
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

async function flushAsync() {
    await new Promise((resolve) => setImmediate(resolve));
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
    if (status === 'already_exists') counts.alreadyExistsCount = 1;
    if (status === 'created_and_queued') counts.queuedCount = 1;
    if (status === 'error') counts.errorCount = 1;
    return {
        ...counts,
        results: [{ id, status }],
    };
}

test('real cacheLibraryCoversFirst writes cover first, then secondary hero/logo, and emits cover payload', async () => {
    const userData = makeTempUserData();
    try {
        const { sync } = loadPlatformSync(userData);
        const cacheFile = path.join(userData, 'cover-first-cache.json');
        const entries = [{
            id: 'game-1',
            title: 'Cover First',
            platform: 'steam',
            appName: '10',
            coverUrl: 'https://cdn.example/cover.jpg',
            heroUrl: 'https://cdn.example/hero.jpg',
            logoUrl: 'https://cdn.example/logo.png',
        }];
        writeJson(cacheFile, entries);

        const calls = [];
        const coverEvents = [];
        let libraryUpdateEvents = 0;
        const downloader = async (assets, gameId) => {
            calls.push({ assets, gameId });
            if (assets.cover) return { cover: 'file:///cache/cover.webp' };
            return { hero: 'file:///cache/hero.webp', logo: 'file:///cache/logo.webp' };
        };

        await sync.cacheLibraryCoversFirst(
            entries,
            downloader,
            cacheFile,
            (library, entry) => library.findIndex((game) => game.id === entry.id),
            () => { libraryUpdateEvents++; },
            {
                coverCachedEmitter: (payload) => coverEvents.push(payload),
                coverConcurrency: 1,
                secondaryConcurrency: 1,
                batchSize: 1,
                libUpdatedDebounceMs: 1,
            }
        );

        assert.deepEqual(calls[0], {
            assets: { cover: 'https://cdn.example/cover.jpg' },
            gameId: 'game-1',
        });
        assert.equal(coverEvents.length, 1);
        assert.deepEqual(coverEvents[0], {
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
        });
        assert.equal(libraryUpdateEvents, 1);

        await waitFor(() => {
            assert.equal(calls.length, 2);
            assert.deepEqual(calls[1], {
                assets: {
                    hero: 'https://cdn.example/hero.jpg',
                    logo: 'https://cdn.example/logo.png',
                },
                gameId: 'game-1',
            });
            const cached = readJson(cacheFile)[0];
            assert.equal(cached.coverUrl, 'file:///cache/cover.webp');
            assert.equal(cached.image, 'file:///cache/cover.webp');
            assert.equal(cached.defaultImage, 'file:///cache/cover.webp');
            assert.equal(cached._agCoverPipelineDone, true);
            assert.equal(cached.heroUrl, 'file:///cache/hero.webp');
            assert.equal(cached.heroImage, 'file:///cache/hero.webp');
            assert.equal(cached.logoUrl, 'file:///cache/logo.webp');
            assert.equal(cached.logo, 'file:///cache/logo.webp');
        });
    } finally {
        rmDir(userData);
    }
});

test('real cacheLibraryCoversFirst reuses valid file cover and skips downloader for that cover', async () => {
    const userData = makeTempUserData();
    try {
        const { sync } = loadPlatformSync(userData);
        const cacheFile = path.join(userData, 'existing-cover-cache.json');
        const existingCover = path.join(userData, 'existing-cover.webp');
        writeJson(existingCover, { ok: true });
        const existingCoverUrl = fileUrl(existingCover);
        const entries = [{
            id: 'game-existing',
            title: 'Existing Cover',
            coverUrl: existingCoverUrl,
        }];
        writeJson(cacheFile, entries);

        const calls = [];
        const coverEvents = [];
        await sync.cacheLibraryCoversFirst(
            entries,
            async (assets, gameId) => {
                calls.push({ assets, gameId });
                return { cover: 'file:///should-not-run.webp' };
            },
            cacheFile,
            (library, entry) => library.findIndex((game) => game.id === entry.id),
            null,
            { coverCachedEmitter: (payload) => coverEvents.push(payload), batchSize: 1 }
        );

        assert.deepEqual(calls, []);
        assert.equal(entries[0].coverUrl, existingCoverUrl);
        assert.equal(entries[0].image, existingCoverUrl);
        assert.equal(entries[0].defaultImage, existingCoverUrl);
        assert.equal(entries[0]._agCoverPipelineDone, true);
        assert.equal(coverEvents.length, 1);
        assert.equal(coverEvents[0].coverUrl, existingCoverUrl);
        await waitFor(() => {
            assert.equal(readJson(cacheFile)[0]._agCoverPipelineDone, true);
        });
    } finally {
        rmDir(userData);
    }
});

test('real cacheLibraryCoversFirst clears stale file cover and falls back to remote image', async () => {
    const userData = makeTempUserData();
    try {
        const { sync } = loadPlatformSync(userData);
        const cacheFile = path.join(userData, 'stale-cover-cache.json');
        const missingCoverUrl = fileUrl(path.join(userData, 'missing-cover.webp'));
        const entries = [{
            id: 'game-stale',
            title: 'Stale Cover',
            coverUrl: missingCoverUrl,
            image: 'https://cdn.example/fallback-cover.jpg',
        }];
        writeJson(cacheFile, entries);

        const calls = [];
        await sync.cacheLibraryCoversFirst(
            entries,
            async (assets, gameId) => {
                calls.push({ assets, gameId });
                return { cover: 'file:///cache/fallback-cover.webp' };
            },
            cacheFile,
            (library, entry) => library.findIndex((game) => game.id === entry.id),
            null,
            { coverConcurrency: 1, batchSize: 1 }
        );

        assert.deepEqual(calls, [{
            assets: { cover: 'https://cdn.example/fallback-cover.jpg' },
            gameId: 'game-stale',
        }]);
        assert.equal(entries[0].coverUrl, 'file:///cache/fallback-cover.webp');
        await waitFor(() => {
            const cached = readJson(cacheFile)[0];
            assert.equal(cached.coverUrl, 'file:///cache/fallback-cover.webp');
            assert.equal(cached.image, 'file:///cache/fallback-cover.webp');
            assert.equal(cached.defaultImage, 'file:///cache/fallback-cover.webp');
        });
    } finally {
        rmDir(userData);
    }
});

test('real cacheLibraryCoversFirst swallows downloader failures and keeps processing other covers', async () => {
    const userData = makeTempUserData();
    try {
        const { sync } = loadPlatformSync(userData);
        const cacheFile = path.join(userData, 'cover-failure-cache.json');
        const entries = [
            { id: 'game-fail', title: 'Fail', coverUrl: 'https://cdn.example/fail.jpg' },
            { id: 'game-ok', title: 'OK', coverUrl: 'https://cdn.example/ok.jpg' },
        ];
        writeJson(cacheFile, entries);

        await assert.doesNotReject(() => sync.cacheLibraryCoversFirst(
            entries,
            async (assets, gameId) => {
                if (gameId === 'game-fail') throw new Error('cover failed');
                return { cover: 'file:///cache/ok.webp' };
            },
            cacheFile,
            (library, entry) => library.findIndex((game) => game.id === entry.id),
            null,
            { coverConcurrency: 1, batchSize: 1 }
        ));

        assert.equal(entries[0]._agCoverInFlight, false);
        assert.equal(entries[1].coverUrl, 'file:///cache/ok.webp');
        await waitFor(() => {
            const cached = readJson(cacheFile);
            assert.equal(cached[0].coverUrl, 'https://cdn.example/fail.jpg');
            assert.equal(cached[1].coverUrl, 'file:///cache/ok.webp');
        });
    } finally {
        rmDir(userData);
    }
});

test('steam sync applies already_exists lookup metadata, downloads assets, writes file URLs, and emits library update', async () => {
    const userData = makeTempUserData();
    try {
        mkdirp(platformSyncDir(userData));
        writeJson(steamAccountsFile(userData), [{ id: 's1', displayName: 'Steam One' }]);
        const baddelApi = makeBaddelApi({
            requestResponses: [makeBatchResult('already_exists', '10')],
            lookupGame: async (params) => ({ id: params.id, found: true }),
            normalizeServerData: () => ({
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
        const downloaderCalls = [];
        sync.registerPlatformSyncHandlers({ handle() {}, on() {} }, () => win);
        sync.registerPlatformSyncAssetDownloader(async (assets, gameId) => {
            downloaderCalls.push({ assets, gameId });
            return {
                cover: 'file:///image-cache/steam_10-cover.webp',
                hero: 'file:///image-cache/steam_10-hero.webp',
                logo: 'file:///image-cache/steam_10-logo.webp',
            };
        });

        const result = await sync.steamConnector.syncLibrary();
        assert.equal(result.length, 1);

        await waitFor(() => {
            assert.equal(baddelApi.calls.requestGameEnrichBatch.length, 1);
            assert.deepEqual(baddelApi.calls.requestGameEnrichBatch[0], {
                platform: 'steam',
                chunk: [{ id: '10', title: 'Portal' }],
            });
            assert.deepEqual(baddelApi.calls.lookupGame, [{ platform: 'steam', id: '10' }]);
            assert.equal(downloaderCalls.length, 1);
        });

        assert.deepEqual(downloaderCalls[0], {
            assets: {
                cover: 'https://cdn.example/portal-cover.jpg',
                hero: 'https://cdn.example/portal-hero.jpg',
                logo: 'https://cdn.example/portal-logo.png',
            },
            gameId: 'steam_10',
        });

        await waitFor(() => {
            const cached = readJson(steamCacheFile(userData))[0];
            assert.equal(cached.coverUrl, 'file:///image-cache/steam_10-cover.webp');
            assert.equal(cached.heroUrl, 'file:///image-cache/steam_10-hero.webp');
            assert.equal(cached.logoUrl, 'file:///image-cache/steam_10-logo.webp');
            assert.equal(cached.releaseYear, '2007-10-10');
        });

        await waitFor(() => {
            const event = win.events.find((item) => item.channel === 'library-updated');
            assert.ok(event);
            assert.deepEqual(event.payload, [{ id: 'steam_10', title: 'Portal Saved' }]);
            assert.ok(gamesFeature.calls.getSavedGames >= 1);
        }, 2600);
    } finally {
        rmDir(userData);
    }
});

test('steam sync retries per-item error results and applies normalized metadata from retry success', async () => {
    const userData = makeTempUserData();
    try {
        mkdirp(platformSyncDir(userData));
        writeJson(steamAccountsFile(userData), [{ id: 's1', displayName: 'Steam One' }]);
        const baddelApi = makeBaddelApi({
            requestResponses: [
                makeBatchResult('error', '10'),
                makeBatchResult('already_exists', '10'),
            ],
            lookupGame: async (params) => ({ id: params.id, found: true }),
            normalizeServerData: () => ({
                cover: 'https://cdn.example/retry-cover.jpg',
                heroImage: null,
                logo: null,
            }),
        });
        const steamBridge = makeFakeSteamBridge({
            lastSessionSteamId: 's1',
            ownedResponses: [
                { status: 'success', games: [{ id: 'steam_10', appid: 10, title: 'Portal' }] },
            ],
        });
        const { sync } = loadPlatformSync(userData, { baddelApi, steamBridge });

        await sync.steamConnector.syncLibrary();

        await waitFor(() => {
            assert.equal(baddelApi.calls.requestGameEnrichBatch.length, 2);
            assert.deepEqual(baddelApi.calls.requestGameEnrichBatch[0].chunk, [{ id: '10', title: 'Portal' }]);
            assert.deepEqual(baddelApi.calls.requestGameEnrichBatch[1].chunk, [{ id: '10', title: 'Portal' }]);
            assert.deepEqual(baddelApi.calls.lookupGame, [{ platform: 'steam', id: '10' }]);
            assert.equal(readJson(steamCacheFile(userData))[0].coverUrl, 'https://cdn.example/retry-cover.jpg');
        });
    } finally {
        rmDir(userData);
    }
});

test('platformSync still owns enrichment/asset helpers until extraction phases', () => {
    const source = fs.readFileSync(PLATFORM_SYNC_PATH, 'utf8');

    assert.match(source, /async function _importLibraryToServer\(platform, games\)/);
    assert.match(source, /async function cacheLibraryCoversFirst\(entries, downloader, cacheFile, matchFn, emitter, opts = \{\}\)/);
    assert.match(source, /PlatformSyncAssetWriteBackService/);
    assert.match(source, /assetWriteBackService\.cacheLibraryCoversFirst/);
    assert.match(source, /function registerPlatformSyncAssetDownloader\(fn\)/);
    assert.match(source, /let _platformSyncAssetDownloader = null/);
    assert.match(source, /let _libraryWriteQueue = Promise\.resolve\(\)/);
    assert.match(source, /let _libraryUpdateDebounceTimer = null/);

    assert.equal(fs.existsSync(path.join(SYNC_SERVICES_DIR, 'PlatformSyncServerImportService.js')), false);
    assert.equal(fs.existsSync(path.join(SYNC_SERVICES_DIR, 'PlatformSyncAssetWriteBackService.js')), true);
    assert.equal(fs.existsSync(path.join(SYNC_SERVICES_DIR, 'CoverFirstCacheAssetService.js')), false);
    assert.equal(fs.existsSync(SYNC_CONTAINER_PATH), false);
});
