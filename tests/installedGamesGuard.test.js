'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MAIN_JS = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
const ACCOUNTS_JS = fs.readFileSync(path.join(ROOT, 'src', 'js', 'accounts.js'), 'utf8');
const INSTALLED_GAMES_HANDLERS_JS = fs.readFileSync(
    path.join(ROOT, 'handlers', 'installedGamesHandlers.js'),
    'utf8'
);

const handlerStart = INSTALLED_GAMES_HANDLERS_JS.indexOf("ipcMain.handle('get-installed-games'");
assert.ok(handlerStart !== -1, 'get-installed-games handler must exist');
const HANDLER_SRC = INSTALLED_GAMES_HANDLERS_JS.slice(handlerStart, handlerStart + 5000);

test('installedGamesState is declared in main.js with backgroundScanInProgress: false', () => {
    assert.match(MAIN_JS, /const installedGamesState\s*=\s*\{[\s\S]{0,200}backgroundScanInProgress:\s*false/);
});

test('installedGamesState is passed to installedGamesHandlers through gamesIpc deps', () => {
    const gamesIpcIdx = MAIN_JS.lastIndexOf('gamesIpc.register(ipcMain');
    assert.ok(gamesIpcIdx !== -1, 'gamesIpc.register must be the primary games registration');
    const depsBagIdx = MAIN_JS.lastIndexOf('const _gamesDeps', gamesIpcIdx);
    const depsBag = MAIN_JS.slice(depsBagIdx, gamesIpcIdx);
    assert.match(depsBag, /installedGamesState/);
});

test('get-installed-games raises the background scan guard before scanAllGames', () => {
    const setAnchor = 'installedGamesState.backgroundScanInProgress = true';
    const setIdx = HANDLER_SRC.indexOf(setAnchor);
    const scanCallIdx = HANDLER_SRC.indexOf('scanAllGames()', setIdx);
    assert.ok(setIdx !== -1, 'guard must be set');
    assert.ok(scanCallIdx !== -1, 'scanAllGames must be called');
    assert.ok(setIdx < scanCallIdx, 'guard must be set before scan starts');
    assert.doesNotMatch(HANDLER_SRC.slice(setIdx + setAnchor.length, scanCallIdx), /\bawait\b/);
});

test('get-installed-games resets the scan guard on success and failure', () => {
    const resets = HANDLER_SRC.match(/installedGamesState\.backgroundScanInProgress\s*=\s*false/g);
    assert.ok(resets && resets.length >= 2, 'guard must reset in both paths');
    assert.match(HANDLER_SRC, /\.catch\(\s*err\s*=>\s*\{\s*installedGamesState\.backgroundScanInProgress\s*=\s*false/);
});

test('empty stored games return immediately and do not await scanAllGames', () => {
    assert.match(HANDLER_SRC, /stored\.length\s*===\s*0/);
    assert.match(HANDLER_SRC, /return stored/);
    assert.match(HANDLER_SRC, /scanAllGames\(\)/);
    assert.doesNotMatch(HANDLER_SRC, /await\s+scanAllGames\(\)/);
});

test('concurrent startup callers share one background scan guard', () => {
    assert.match(HANDLER_SRC, /!\s*installedGamesState\.backgroundScanInProgress/);
    assert.equal((HANDLER_SRC.match(/scanAllGames\(\)/g) || []).length, 1);
});

test('get-installed-games emits explicit scan-started, scan-finished, and scan-failed states', () => {
    assert.match(HANDLER_SRC, /installed-games-scan-state/);
    assert.match(HANDLER_SRC, /scan-started/);
    assert.match(HANDLER_SRC, /scan-finished/);
    assert.match(HANDLER_SRC, /scan-failed/);
});

test('get-installed-games sends library-updated only after a changed background scan resolves', () => {
    const thenIdx = HANDLER_SRC.indexOf('.then(');
    assert.ok(thenIdx !== -1, '.then callback must exist');
    assert.match(HANDLER_SRC, /stableLibrarySignature/);
    assert.match(HANDLER_SRC, /const changed = afterSignature !== installedGamesState\.lastLibrarySignature/);
    assert.match(HANDLER_SRC, /if \(!changed && !needsArtworkRepair\) return/);
    assert.ok(HANDLER_SRC.indexOf("'library-updated'", thenIdx) !== -1);
});

test('get-installed-games sends game-image-updated via notifyGameImageUpdated callback', () => {
    assert.match(HANDLER_SRC, /['"]game-image-updated['"]/);
});

test('background pipeline remains deferred and uses a single replaceable timer', () => {
    const setTimeoutIdx = HANDLER_SRC.indexOf('setTimeout');
    const pipelineAfterIdx = HANDLER_SRC.indexOf('runBackgroundMetadataPipeline', setTimeoutIdx);
    assert.ok(setTimeoutIdx !== -1, 'setTimeout must defer metadata pipeline');
    assert.ok(pipelineAfterIdx !== -1, 'metadata pipeline must run inside deferred callback');
    assert.match(HANDLER_SRC, /backgroundMetadataTimer/);
    assert.match(HANDLER_SRC, /clearBackgroundMetadataTimer\(\)/);
    assert.match(HANDLER_SRC, /2000/);
});

test('installed filter treats downloaded launch records as installed', () => {
    assert.match(ACCOUNTS_JS, /g\.path \|\| g\.command \|\| g\.launchCommand \|\| g\.executablePath \|\| g\.installVerified \|\| g\.isInstalled/);
    assert.match(ACCOUNTS_JS, /local entry has a launch target or verified installed marker/);
});


test('20 identical get-installed-games calls do not storm library-updated or metadata timers', async () => {
    const { register } = require('../handlers/installedGamesHandlers');
    let handler;
    const ipcMain = { handle: (_name, fn) => { handler = fn; } };
    const events = [];
    let resolveScan;
    let scanCount = 0;
    const stored = [{
        id: 'game-1',
        title: 'Same Game',
        platform: 'local',
        coverUrl: 'file:///same-cover.webp',
        heroUrl: 'file:///same-hero.webp',
        logoUrl: 'file:///same-logo.webp',
    }];
    const state = { backgroundScanInProgress: false };
    const originalSetTimeout = global.setTimeout;
    const originalClearTimeout = global.clearTimeout;
    let timerCount = 0;
    global.setTimeout = (fn, ms) => { timerCount += 1; return { fn, ms }; };
    global.clearTimeout = () => {};
    try {
        register(ipcMain, {
            getSavedGames: () => stored,
            scanAllGames: () => {
                scanCount += 1;
                return new Promise(resolve => { resolveScan = resolve; });
            },
            refetchMissingImages: async () => {},
            runBackgroundMetadataPipeline: async () => {},
            getMainWindow: () => ({ webContents: { send: (channel, payload) => events.push({ channel, payload }) } }),
            installedGamesState: state,
        });

        const calls = Array.from({ length: 20 }, () => handler());
        assert.equal(scanCount, 1);
        resolveScan([{ ...stored[0] }]);
        await Promise.all(calls);
        await Promise.resolve();
        await Promise.resolve();

        assert.equal(scanCount, 1);
        assert.equal(events.filter(e => e.channel === 'library-updated').length, 0);
        assert.equal(timerCount, 0);
        assert.equal(state.backgroundScanInProgress, false);
        const finished = events.filter(e => e.channel === 'installed-games-scan-state' && e.payload.state === 'scan-finished');
        assert.equal(finished.length, 1);
        assert.equal(finished[0].payload.changed, false);
    } finally {
        global.setTimeout = originalSetTimeout;
        global.clearTimeout = originalClearTimeout;
    }
});

test('main registers the persisted-artwork notifier before renderer library requests can run', () => {
    const mainSource = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
    const registerIpc = mainSource.indexOf('gamesIpc.register(ipcMain, _gamesDeps)');
    const registerNotifier = mainSource.indexOf('gamesApi.registerGameImageUpdatedNotifier', registerIpc);
    const registerDownloader = mainSource.indexOf('gamesApi.registerImageDownloader', registerIpc);
    assert.ok(registerIpc >= 0);
    assert.ok(registerNotifier > registerIpc);
    assert.ok(registerNotifier < registerDownloader);
    const notifierBlock = mainSource.slice(registerNotifier, registerNotifier + 500);
    assert.match(notifierBlock, /isDestroyed/);
    assert.match(notifierBlock, /webContents\.send\('game-image-updated', payload\)/);
});

test('unchanged installed snapshot still schedules repair when hero or logo is missing', async () => {
    const { register } = require('../handlers/installedGamesHandlers');
    let handler;
    const ipcMain = { handle: (_name, fn) => { handler = fn; } };
    const events = [];
    const stored = [{ id: 'game-1', title: 'Needs Art', platform: 'local', coverUrl: 'file:///cover.webp' }];
    const state = { backgroundScanInProgress: false };
    const originalSetTimeout = global.setTimeout;
    const originalClearTimeout = global.clearTimeout;
    const timers = [];
    let refetchCount = 0;
    let pipelineCount = 0;
    global.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return { fn, ms }; };
    global.clearTimeout = () => {};
    try {
        register(ipcMain, {
            getSavedGames: () => stored,
            scanAllGames: async () => [{ ...stored[0] }],
            refetchMissingImages: async () => { refetchCount += 1; },
            runBackgroundMetadataPipeline: async () => { pipelineCount += 1; },
            getMainWindow: () => ({ webContents: { send: (channel, payload) => events.push({ channel, payload }) } }),
            installedGamesState: state,
        });

        await handler();
        await Promise.resolve();
        await Promise.resolve();

        assert.equal(events.filter(event => event.channel === 'library-updated').length, 0);
        assert.equal(refetchCount, 1);
        assert.equal(timers.length, 1);
        assert.equal(timers[0].ms, 2000);
        timers[0].fn();
        await Promise.resolve();
        assert.equal(pipelineCount, 1);
    } finally {
        global.setTimeout = originalSetTimeout;
        global.clearTimeout = originalClearTimeout;
    }
});


test('automatic installed-game reads use a completion cooldown and bounded failure backoff', () => {
    assert.match(INSTALLED_GAMES_HANDLERS_JS, /lastScanFinishedAt\s*=\s*Date\.now\(\)/);
    assert.match(INSTALLED_GAMES_HANDLERS_JS, /now - installedGamesState\.lastScanFinishedAt >= automaticScanCooldownMs/);
    assert.match(INSTALLED_GAMES_HANDLERS_JS, /nextAutomaticScanAt/);
    assert.match(INSTALLED_GAMES_HANDLERS_JS, /Math\.min\(5 \* 60 \* 1000/);
    const manualHandlers = fs.readFileSync(path.join(ROOT, 'handlers', 'gameLibraryHandlers.js'), 'utf8');
    assert.match(manualHandlers, /ipcMain\.handle\('scan-all-games'[\s\S]{0,200}await scanAllGames\(\)/);
});
