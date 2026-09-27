'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const gameLibraryHandlers = require('../handlers/gameLibraryHandlers');
const { createKeyedSingleFlight } = require('../services/keyedSingleFlight');
const { PerformanceDiagnostics } = require('../services/performanceDiagnostics');

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function fakeIpc() {
    return { handles: new Map(), handle(channel, fn) { this.handles.set(channel, fn); } };
}

function libraryDeps(overrides = {}) {
    return {
        ipcValidation: {
            assertSafeId() {}, assertString() {}, assertArrayOfStrings() {},
            sanitizeErrorForRenderer(error) { return { status: 'error', message: error.message }; },
        },
        getSavedGames: () => [], scanAllGames: async () => [], removeGame: async () => ({}),
        renameGame: async () => ({}), unhideAllGames: async () => ({}), getHiddenGames: async () => [],
        restoreSpecificGames: async () => ({}), deleteGamePermanently: async () => ({}),
        reorderLibrary: async () => ({}), getDynamicGameExes: async () => [], _detectPlatform: () => null,
        analytics: { logLibraryScanned: async () => {}, logGameRemoved: async () => {}, logGameRestored: async () => {}, logGameDeletedForever: async () => {} },
        shell: {}, path, addManualGame: async () => ({}), getMainWindow: () => null,
        ...overrides,
    };
}

test('ten concurrent scan IPC requests share one scanner operation and recover afterward', async () => {
    const gate = deferred();
    let calls = 0;
    const ipc = fakeIpc();
    gameLibraryHandlers.register(ipc, libraryDeps({
        scanAllGames: async () => { calls++; return gate.promise; },
    }));
    const handler = ipc.handles.get('scan-all-games');
    const requests = Array.from({ length: 10 }, () => handler({}));
    await Promise.resolve();
    assert.equal(calls, 1);
    gate.resolve([{ id: 'one', platform: 'steam' }]);
    const results = await Promise.all(requests);
    assert.equal(results.length, 10);
    assert.ok(results.every(result => result[0].id === 'one'));
    await handler({});
    assert.equal(calls, 2, 'single-flight state must clear after success');
});

test('scan single-flight clears after failure', async () => {
    let calls = 0;
    const ipc = fakeIpc();
    gameLibraryHandlers.register(ipc, libraryDeps({
        scanAllGames: async () => { calls++; if (calls === 1) throw new Error('scan failed'); return []; },
    }));
    const handler = ipc.handles.get('scan-all-games');
    await assert.rejects(handler({}), /scan failed/);
    await handler({});
    assert.equal(calls, 2);
});

test('ten identical account switches are one operation; conflicting switch is rejected', async () => {
    const switches = createKeyedSingleFlight({
        conflictResult: () => ({ status: 'error', code: 'ACCOUNT_SWITCH_IN_PROGRESS' }),
    });
    const gate = deferred();
    let calls = 0;
    const operation = () => { calls++; return gate.promise; };
    const requests = Array.from({ length: 10 }, () =>
        switches.run('epic', 'account-a', operation));
    const conflicting = await switches.run('epic', 'account-b', operation);
    assert.equal(conflicting.code, 'ACCOUNT_SWITCH_IN_PROGRESS');
    assert.equal(calls, 1);
    gate.resolve({ status: 'success' });
    const results = await Promise.all(requests);
    assert.ok(results.every(result => result.status === 'success'));
});

test('ten rapid Play requests dispatch one launch and set launch state synchronously', async () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'play-launcher.js'), 'utf8');
    const gate = deferred();
    let launches = 0;
    const trigger = {
        tagName: 'BUTTON', disabled: false, isConnected: true, busy: false,
        setAttribute(name) { if (name === 'aria-busy') this.busy = true; },
        removeAttribute(name) { if (name === 'aria-busy') this.busy = false; },
    };
    const document = {
        activeElement: trigger,
        getElementById() { return null; },
        addEventListener() {}, removeEventListener() {},
    };
    const window = {
        electronAPI: {
            launchGame() { launches++; return gate.promise; },
            getCachedImage: async () => '', minimizeApp() {},
        },
        _gdBuildLaunchOptions: game => [game],
        addEventListener() {}, removeEventListener() {},
    };
    const context = vm.createContext({
        window, document, localStorage: { getItem: () => null, setItem() {} },
        performance: { now: () => 0 }, requestAnimationFrame: fn => fn(),
        setTimeout: () => 1, clearTimeout() {}, console,
        _plResolveArtworkForDisplay: () => ({ cover: null, hero: null, logo: null }),
    });
    vm.runInContext(source, context, { filename: 'play-launcher.js' });
    const game = { id: 'manual-1', name: 'Manual Game', platform: 'manual', path: 'C:\\Games\\game.exe' };
    const requests = Array.from({ length: 10 }, () => window.openPlayLauncher(game));
    assert.equal(window.isLaunching, true, 'loading state must be set before yielding');
    assert.equal(trigger.disabled, true);
    assert.equal(trigger.busy, true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(launches, 1);
    gate.resolve({ status: 'success' });
    await Promise.all(requests);
    assert.equal(launches, 1);
    assert.equal(trigger.disabled, false);
    assert.equal(trigger.busy, false);
});

test('performance diagnostics are inert by default and never inspect IPC payloads', async () => {
    const diagnostics = new PerformanceDiagnostics({ enabled: false });
    const ipc = fakeIpc();
    const originalHandle = ipc.handle;
    diagnostics.installIpcTiming(ipc);
    assert.equal(ipc.handle, originalHandle);
    assert.deepEqual(await diagnostics.snapshot(), { enabled: false });
});
