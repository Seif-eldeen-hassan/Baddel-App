'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const LIBRARY_UPDATE_EMITTER_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'runtime', 'LibraryUpdateEmitter.js');
const {
    LibraryUpdateEmitter,
    LIBRARY_UPDATED_CHANNEL,
} = require('../src/features/sync/infrastructure/runtime/LibraryUpdateEmitter');

function readSource(filePath) {
    return fs.readFileSync(filePath, 'utf8');
}

function createFakeTimers() {
    let nextId = 1;
    const timers = new Map();
    const cleared = [];
    return {
        cleared,
        setTimeoutFn(fn, ms) {
            const id = nextId++;
            timers.set(id, { fn, ms });
            return id;
        },
        clearTimeoutFn(id) {
            cleared.push(id);
            timers.delete(id);
        },
        async run(id) {
            const timer = timers.get(id);
            assert.ok(timer, `timer ${id} should exist`);
            await timer.fn();
        },
        pendingIds() {
            return [...timers.keys()];
        },
        msFor(id) {
            return timers.get(id)?.ms;
        },
    };
}

function makeWindow({ destroyed = false, webContents = undefined } = {}) {
    const events = [];
    const hasWebContents = Object.prototype.hasOwnProperty.call(arguments[0] || {}, 'webContents');
    return {
        events,
        isDestroyed: () => destroyed,
        webContents: hasWebContents ? webContents : {
            send(channel, payload) {
                events.push({ channel, payload });
            },
        },
    };
}

function makeEmitter({ savedGames = [], getSavedGames, timers = createFakeTimers() } = {}) {
    const calls = { getSavedGames: 0 };
    const emitter = new LibraryUpdateEmitter({
        getSavedGames: getSavedGames || (async () => {
            calls.getSavedGames++;
            return savedGames;
        }),
        setTimeoutFn: timers.setTimeoutFn,
        clearTimeoutFn: timers.clearTimeoutFn,
    });
    return { emitter, timers, calls };
}

test('LibraryUpdateEmitter exists and exports the current library-updated channel', () => {
    assert.equal(fs.existsSync(LIBRARY_UPDATE_EMITTER_PATH), true);
    assert.equal(typeof LibraryUpdateEmitter, 'function');
    assert.equal(LIBRARY_UPDATED_CHANNEL, 'library-updated');
});

test('emit sends library-updated with the saved games array payload', async () => {
    const savedGames = [{ id: 'steam_10', title: 'Portal Saved' }];
    const win = makeWindow();
    const { emitter, timers, calls } = makeEmitter({ savedGames });

    const result = emitter.emit(win);
    assert.equal(result, undefined);
    assert.equal(calls.getSavedGames, 0, 'getSavedGames should be lazy until debounce fires');

    const [timerId] = timers.pendingIds();
    assert.equal(timers.msFor(timerId), 1500);
    await timers.run(timerId);

    assert.equal(calls.getSavedGames, 1);
    assert.deepEqual(win.events, [{
        channel: 'library-updated',
        payload: savedGames,
    }]);
});

test('multiple rapid emits collapse into one send using the latest window', async () => {
    const firstWindow = makeWindow();
    const secondWindow = makeWindow();
    const { emitter, timers, calls } = makeEmitter({
        savedGames: [{ id: 'g1' }],
    });

    emitter.emit(firstWindow);
    const [firstTimerId] = timers.pendingIds();
    emitter.emit(secondWindow);
    const [secondTimerId] = timers.pendingIds();

    assert.notEqual(firstTimerId, secondTimerId);
    assert.deepEqual(timers.cleared, [firstTimerId]);
    await timers.run(secondTimerId);

    assert.equal(calls.getSavedGames, 1);
    assert.deepEqual(firstWindow.events, []);
    assert.deepEqual(secondWindow.events, [{
        channel: 'library-updated',
        payload: [{ id: 'g1' }],
    }]);
});

test('no window and destroyed window do not fetch saved games or send', async () => {
    const destroyedWindow = makeWindow({ destroyed: true });
    const { emitter, timers, calls } = makeEmitter({ savedGames: [{ id: 'g1' }] });

    emitter.emit(null);
    await timers.run(timers.pendingIds()[0]);
    assert.equal(calls.getSavedGames, 0);

    emitter.emit(destroyedWindow);
    await timers.run(timers.pendingIds()[0]);
    assert.equal(calls.getSavedGames, 0);
    assert.deepEqual(destroyedWindow.events, []);
});

test('missing webContents or send errors are swallowed after getSavedGames', async () => {
    const missingWebContents = makeWindow({ webContents: null });
    const throwingWebContents = makeWindow({
        webContents: {
            send() {
                throw new Error('send failed');
            },
        },
    });
    const { emitter, timers, calls } = makeEmitter({ savedGames: [{ id: 'g1' }] });

    emitter.emit(missingWebContents);
    await timers.run(timers.pendingIds()[0]);
    emitter.emit(throwingWebContents);
    await timers.run(timers.pendingIds()[0]);

    assert.equal(calls.getSavedGames, 2);
    assert.deepEqual(missingWebContents.events, []);
    assert.deepEqual(throwingWebContents.events, []);
});

test('missing isDestroyed and getSavedGames failures are swallowed', async () => {
    const noIsDestroyed = {
        webContents: {
            send() {
                throw new Error('should not be reached');
            },
        },
    };
    const win = makeWindow();
    let getSavedGamesCalls = 0;
    const timers = createFakeTimers();
    const emitter = new LibraryUpdateEmitter({
        getSavedGames: async () => {
            getSavedGamesCalls++;
            throw new Error('saved games failed');
        },
        setTimeoutFn: timers.setTimeoutFn,
        clearTimeoutFn: timers.clearTimeoutFn,
    });

    emitter.emit(noIsDestroyed);
    await timers.run(timers.pendingIds()[0]);
    assert.equal(getSavedGamesCalls, 0);

    emitter.emit(win);
    await timers.run(timers.pendingIds()[0]);
    assert.equal(getSavedGamesCalls, 1);
    assert.deepEqual(win.events, []);
});

test('cancel clears a pending timer', async () => {
    const win = makeWindow();
    const { emitter, timers, calls } = makeEmitter({ savedGames: [{ id: 'g1' }] });

    emitter.emit(win);
    const [timerId] = timers.pendingIds();
    emitter.cancel();

    assert.deepEqual(timers.cleared, [timerId]);
    assert.deepEqual(timers.pendingIds(), []);
    assert.equal(calls.getSavedGames, 0);
    assert.deepEqual(win.events, []);
});

test('module stays independent from platform runtime and IPC boundaries', () => {
    const source = readSource(LIBRARY_UPDATE_EMITTER_PATH);

    assert.doesNotMatch(source, /platformSync/);
    assert.doesNotMatch(source, /SyncContainer/);
    assert.doesNotMatch(source, /require\(['"]electron['"]\)/);
    assert.doesNotMatch(source, /main\.js|preload\.js|dashboard|renderer/);
    assert.doesNotMatch(source, /steamBridge|legendary|LEGENDARY/i);
    assert.doesNotMatch(source, /ipcMain|ipcRenderer|handle\(/);
});
