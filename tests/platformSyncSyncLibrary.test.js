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
    return fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-sync-library-'));
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

function epicAccountsFile(userData) {
    return path.join(platformSyncDir(userData), 'epic_accounts.json');
}

function epicCacheFile(userData) {
    return path.join(platformSyncDir(userData), 'epic_library_merged.json');
}

function epicReportFile(userData) {
    return path.join(platformSyncDir(userData), 'epic_sync_classification_report.json');
}

function legendaryConfigDir(userData, accountId) {
    return path.join(userData, `legendary-config-${accountId}`);
}

function clearPlatformSyncCache() {
    for (const key of Object.keys(require.cache)) {
        const lower = key.toLowerCase();
        if (
            lower.endsWith(`${path.sep}platformsync.js`) ||
            lower.endsWith(`${path.sep}steambridge.js`) ||
            lower.endsWith(`${path.sep}analytics.js`) ||
            lower.includes(`${path.sep}services${path.sep}baddelapi.js`) ||
            lower.includes(`${path.sep}services${path.sep}credentialvalidator.js`) ||
            lower.includes(`${path.sep}src${path.sep}features${path.sep}games${path.sep}infrastructure${path.sep}composition${path.sep}gamescontainer.js`)
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
        deleteCredentialsForAccount: [],
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
            if (options.startError) throw options.startError;
            bridge.isRunning = true;
        },
        async stop() {
            bridge.isRunning = false;
        },
        getLastSessionSteamId() {
            return options.lastSessionSteamId || '';
        },
        getCredentialsForAccount(accountId) {
            if (options.credentials === false) return null;
            if (options.credentialsByAccount) return options.credentialsByAccount[String(accountId)] || null;
            return { accountId };
        },
        async authenticate(creds, authOptions) {
            calls.authenticate.push({ creds, authOptions });
            if (options.authResult) return options.authResult;
            return { status: 'authenticated', steamId: String(creds.accountId || creds.steamId || options.lastSessionSteamId || '') };
        },
        async waitForCacheReady(accountId, timeoutMs) {
            calls.waitForCacheReady.push({ accountId: String(accountId), timeoutMs });
        },
        async getOwnedGames() {
            calls.getOwnedGames++;
            return ownedResponses.length ? ownedResponses.shift() : { status: 'success', games: [] };
        },
        deleteCredentialsForAccount(accountId) {
            calls.deleteCredentialsForAccount.push(String(accountId));
        },
        async waitForCredentials() {
            return true;
        },
        async logout() {},
    };
    return bridge;
}

function makeBaddelApi() {
    const calls = {
        requestGameEnrichBatch: [],
        lookupGame: [],
    };
    return {
        calls,
        async requestGameEnrichBatch(platform, chunk) {
            calls.requestGameEnrichBatch.push({ platform, chunk });
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
            return null;
        },
        normalizeServerData() {
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
        autoSync: [],
    };
    return {
        calls,
        logPlatformLinked: async (platform) => calls.linked.push(platform),
        logPlatformUnlinked: async (platform) => calls.unlinked.push(platform),
        logSyncCompleted: async (...args) => calls.completed.push(args),
        logSyncFailed: async (...args) => calls.failed.push(args),
        logAutoSyncStarted: async (...args) => calls.autoSync.push(args),
    };
}

function makeGamesFeature(overrides = {}) {
    const calls = {
        getLocalSteamGames: 0,
        removeEpicNonGameEntries: [],
        getSavedGames: 0,
    };
    return {
        calls,
        async getSavedGames() {
            calls.getSavedGames++;
            return [];
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

function makeLegendaryExec(resolver) {
    const calls = [];
    const execFile = (file, args, options = {}) => {
        const proc = new EventEmitter();
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        calls.push({ file, args: [...args], options });
        process.nextTick(() => {
            try {
                const result = resolver(args, options);
                if (result instanceof Error) {
                    proc.stderr.emit('data', result.message);
                    proc.emit('close', result.code || 1, null);
                    return;
                }
                const stdout = typeof result === 'string' ? result : JSON.stringify(result || []);
                if (stdout) proc.stdout.emit('data', stdout);
                proc.emit('close', 0, null);
            } catch (err) {
                proc.stderr.emit('data', err.message);
                proc.emit('close', 1, null);
            }
        });
        return proc;
    };
    execFile.calls = calls;
    return execFile;
}

function loadPlatformSync(userData, overrides = {}) {
    clearPlatformSyncCache();
    const originalLoad = Module._load;
    const baddelApi = overrides.baddelApi || makeBaddelApi();
    const analytics = overrides.analytics || makeAnalytics();
    const gamesFeature = overrides.gamesFeature || makeGamesFeature();
    const steamBridge = overrides.steamBridge || makeFakeSteamBridge();
    const execFile = overrides.execFile || makeLegendaryExec(() => []);

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
        return { sync, baddelApi, analytics, gamesFeature, steamBridge, execFile };
    } finally {
        Module._load = originalLoad;
    }
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

test('steamConnector.syncLibrary writes merged cache, account counts, events, and server import payload', async () => {
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
        const gamesFeature = makeGamesFeature({
            localSteamGames: [{ appid: 20, name: 'Local Only' }],
        });
        const { sync, baddelApi, analytics } = loadPlatformSync(userData, { steamBridge, gamesFeature });
        const win = makeFakeWindow();
        sync.registerPlatformSyncHandlers({ handle() {}, on() {} }, () => win);

        const result = await sync.steamConnector.syncLibrary();
        await flushAsync();

        assert.equal(Array.isArray(result), true);
        assert.equal(result.length, 2);
        assert.deepEqual(result.map((game) => game.id).sort(), ['steam_10', 'steam_20']);
        const owned = result.find((game) => game.id === 'steam_10');
        assert.deepEqual(owned.ownedByAccountIds, ['s1']);
        assert.deepEqual(owned.steamLicensedAccountIds, ['s1']);
        const localOnly = result.find((game) => game.id === 'steam_20');
        assert.equal(localOnly.installOnly, true);

        assert.deepEqual(readJson(steamCacheFile(userData)).map((game) => game.id).sort(), ['steam_10', 'steam_20']);
        await waitFor(() => {
            assert.equal(readJson(steamAccountsFile(userData))[0].gamesCount, 1);
            assert.equal(readJson(steamAccountsFile(userData))[0].status, 'synced');
        });
        assert.equal(gamesFeature.calls.getLocalSteamGames, 1);
        assert.equal(steamBridge.calls.start, 1);
        assert.equal(steamBridge.calls.authenticate.length, 1);
        assert.deepEqual(steamBridge.calls.waitForCacheReady, [{ accountId: 's1', timeoutMs: 60000 }]);

        assert.equal(baddelApi.calls.requestGameEnrichBatch.length, 1);
        assert.equal(baddelApi.calls.requestGameEnrichBatch[0].platform, 'steam');
        assert.deepEqual(
            baddelApi.calls.requestGameEnrichBatch[0].chunk.map((item) => item.id).sort(),
            ['10', '20']
        );
        assert.deepEqual(analytics.calls.completed[0], ['steam', 2, 1]);
        assert.ok(win.events.some((event) => event.channel === 'platform-sync:completed'));
        const completed = win.events.find((event) => event.channel === 'platform-sync:completed').payload;
        assert.equal(completed.platform, 'steam');
        assert.equal(completed.summary.totalGames, 2);
    } finally {
        rmDir(userData);
    }
});

test('steamConnector.syncLibrary preserves previous cache when Steam returns zero games for an account with history', async () => {
    const userData = makeTempUserData();
    try {
        mkdirp(platformSyncDir(userData));
        writeJson(steamAccountsFile(userData), [{ id: 's1', displayName: 'Steam One', gamesCount: 1, lastSyncedAt: '2026-01-01T00:00:00.000Z' }]);
        writeJson(steamCacheFile(userData), [{
            id: 'steam_10',
            title: 'Cached Portal',
            platform: 'steam',
            source: 'steam',
            appName: '10',
            ownedBy: ['Steam One'],
            ownedByAccountIds: ['s1'],
            steamLicensedAccountIds: ['s1'],
        }]);
        const steamBridge = makeFakeSteamBridge({
            lastSessionSteamId: 's1',
            ownedResponses: [
                { status: 'success', games: [] },
                { status: 'success', games: [] },
            ],
        });
        const { sync } = loadPlatformSync(userData, { steamBridge, gamesFeature: makeGamesFeature() });

        const result = await sync.steamConnector.syncLibrary();

        assert.equal(result.length, 1);
        assert.equal(result[0].id, 'steam_10');
        assert.equal(readJson(steamCacheFile(userData))[0].id, 'steam_10');
        assert.equal(steamBridge.calls.getOwnedGames, 2);
    } finally {
        rmDir(userData);
    }
});

test('steamConnector.syncLibrary rejects bridge startup failure without writing merged cache', async () => {
    const userData = makeTempUserData();
    try {
        mkdirp(platformSyncDir(userData));
        writeJson(steamAccountsFile(userData), [{ id: 's1', displayName: 'Steam One' }]);
        const steamBridge = makeFakeSteamBridge({
            startError: new Error('bridge unavailable'),
        });
        const { sync, analytics } = loadPlatformSync(userData, { steamBridge });

        await assert.rejects(
            () => sync.steamConnector.syncLibrary(),
            /bridge unavailable/
        );
        assert.equal(fs.existsSync(steamCacheFile(userData)), false);
        assert.deepEqual(analytics.calls.failed, []);
    } finally {
        rmDir(userData);
    }
});

test('epicConnector.syncLibrary writes merged cache, classification report, cleanup, events, and server import payload', async () => {
    const userData = makeTempUserData();
    try {
        mkdirp(platformSyncDir(userData));
        mkdirp(legendaryConfigDir(userData, 'e1'));
        writeJson(epicAccountsFile(userData), [{ id: 'e1', displayName: 'Epic One' }]);
        const playable = [{
            app_name: 'control',
            app_title: 'Control',
            executable: 'Control.exe',
            metadata: {
                namespace: 'controlns1234',
                categories: ['games'],
                keyImages: [
                    { type: 'OfferImageTall', url: 'https://cdn.example/control-cover.jpg' },
                    { type: 'OfferImageWide', url: 'https://cdn.example/control-hero.jpg' },
                    { type: 'DieselLogo', url: 'https://cdn.example/control-logo.png' },
                ],
            },
        }];
        const nonGame = [{
            app_name: 'fab',
            app_title: 'Fab',
            metadata: { namespace: 'fab', categories: ['applications'] },
        }];
        const execFile = makeLegendaryExec((args) => {
            if (args.includes('--include-non-ac')) return nonGame;
            if (args.includes('--third-party')) return [];
            return [...playable, ...nonGame];
        });
        const gamesFeature = makeGamesFeature();
        const { sync, baddelApi, analytics } = loadPlatformSync(userData, { execFile, gamesFeature });
        const win = makeFakeWindow();
        sync.registerPlatformSyncHandlers({ handle() {}, on() {} }, () => win);

        const result = await sync.epicConnector.syncLibrary();
        await flushAsync();

        assert.equal(result.length, 1);
        assert.equal(result[0].id, 'epic_control');
        assert.equal(result[0].namespace, 'controlns1234');
        assert.deepEqual(result[0].ownedByAccountIds, ['e1']);
        assert.deepEqual(readJson(epicCacheFile(userData)).map((game) => game.id), ['epic_control']);

        await flushAsync();
        const report = readJson(epicReportFile(userData));
        assert.equal(report.accounts[0].keptCount, 1);
        assert.equal(report.accounts[0].rejectedCount, 1);
        assert.equal(report.accounts[0].rejected[0].app_name, 'fab');
        assert.equal(gamesFeature.calls.removeEpicNonGameEntries.length, 1);
        assert.equal(gamesFeature.calls.removeEpicNonGameEntries[0][0].app_name, 'fab');

        assert.equal(baddelApi.calls.requestGameEnrichBatch.length, 1);
        assert.equal(baddelApi.calls.requestGameEnrichBatch[0].platform, 'epic');
        assert.deepEqual(baddelApi.calls.requestGameEnrichBatch[0].chunk, [
            { id: 'controlns1234', title: 'Control' },
        ]);
        assert.deepEqual(analytics.calls.completed[0], ['epic', 1, 1]);
        assert.ok(win.events.some((event) => event.channel === 'platform-sync:completed'));
    } finally {
        rmDir(userData);
    }
});

test('epicConnector.syncLibrary handles empty Legendary library without crashing or deleting cache', async () => {
    const userData = makeTempUserData();
    try {
        mkdirp(platformSyncDir(userData));
        mkdirp(legendaryConfigDir(userData, 'e1'));
        writeJson(epicAccountsFile(userData), [{ id: 'e1', displayName: 'Epic One' }]);
        writeJson(epicCacheFile(userData), [{
            id: 'epic_cached',
            title: 'Cached Epic',
            platform: 'epic',
            source: 'epic',
            appName: 'cached',
            namespace: 'cachedns1234',
            ownedBy: ['Epic One'],
            ownedByAccountIds: ['e1'],
        }]);
        const execFile = makeLegendaryExec(() => []);
        const { sync } = loadPlatformSync(userData, { execFile });

        const result = await sync.epicConnector.syncLibrary();

        assert.equal(result.length, 1);
        assert.equal(result[0].id, 'epic_cached');
        assert.equal(readJson(epicCacheFile(userData))[0].id, 'epic_cached');
    } finally {
        rmDir(userData);
    }
});

test('epicConnector.syncLibrary converts Legendary failure into account error and preserves previous cache', async () => {
    const userData = makeTempUserData();
    try {
        mkdirp(platformSyncDir(userData));
        mkdirp(legendaryConfigDir(userData, 'e1'));
        writeJson(epicAccountsFile(userData), [{ id: 'e1', displayName: 'Epic One' }]);
        writeJson(epicCacheFile(userData), [{
            id: 'epic_cached',
            title: 'Cached Epic',
            platform: 'epic',
            source: 'epic',
            appName: 'cached',
            namespace: 'cachedns1234',
            ownedBy: ['Epic One'],
            ownedByAccountIds: ['e1'],
        }]);
        const execFile = makeLegendaryExec((args) => {
            if (args.includes('--third-party') || args.includes('--include-non-ac')) return [];
            return Object.assign(new Error('legendary list failed'), { code: 1 });
        });
        const { sync, analytics } = loadPlatformSync(userData, { execFile });
        const win = makeFakeWindow();
        sync.registerPlatformSyncHandlers({ handle() {}, on() {} }, () => win);

        const result = await sync.epicConnector.syncLibrary();

        assert.equal(result.length, 1);
        assert.equal(result[0].id, 'epic_cached');
        assert.equal(readJson(epicCacheFile(userData))[0].id, 'epic_cached');
        assert.deepEqual(analytics.calls.completed[0], ['epic', 1, 1]);
        const completed = win.events.find((event) => event.channel === 'platform-sync:completed').payload;
        assert.equal(completed.accounts.e1.status, 'error');
        assert.match(completed.accounts.e1.message, /Sync failed|failed/i);
    } finally {
        rmDir(userData);
    }
});
