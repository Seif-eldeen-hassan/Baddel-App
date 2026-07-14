'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const LINK_STATE_EMITTER_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'runtime', 'LinkStateEmitter.js');
const { LinkStateEmitter, LINK_STATE_CHANNEL } = require('../src/features/sync/infrastructure/runtime/LinkStateEmitter');

function readSource(filePath) {
    return fs.readFileSync(filePath, 'utf8');
}

function makeWindow({ destroyed = false, webContents = undefined } = {}) {
    const events = [];
    const resolvedWebContents = Object.prototype.hasOwnProperty.call(arguments[0] || {}, 'webContents')
        ? webContents
        : {
            send(channel, payload) {
                events.push({ channel, payload });
            },
        };
    return {
        events,
        isDestroyed: () => destroyed,
        webContents: resolvedWebContents,
    };
}

test('LinkStateEmitter exists and exports the current link-state channel', () => {
    assert.equal(fs.existsSync(LINK_STATE_EMITTER_PATH), true);
    assert.equal(typeof LinkStateEmitter, 'function');
    assert.equal(LINK_STATE_CHANNEL, 'platform-sync:link-state-changed');
});

test('emit sends platform-sync:link-state-changed with the success payload shape', () => {
    const emitter = new LinkStateEmitter();
    const win = makeWindow();

    const result = emitter.emit(win, 'steam', 'waiting_for_signin', 'Waiting for Steam authorization.', {
        displayName: 'Steam One',
        accountId: 's1',
    });

    assert.equal(result, undefined);
    assert.deepEqual(win.events, [{
        channel: 'platform-sync:link-state-changed',
        payload: {
            platform: 'steam',
            status: 'waiting_for_signin',
            message: 'Waiting for Steam authorization.',
            displayName: 'Steam One',
            accountId: 's1',
        },
    }]);
});

test('emit preserves failure payload shape and merges extra fields last', () => {
    const emitter = new LinkStateEmitter();
    const win = makeWindow();

    emitter.emit(win, 'steam', 'failed', 'Steam link failed', {
        code: 'STEAM_LINK_FAILED',
        status: 'custom_failed',
        retryable: false,
    });

    assert.deepEqual(win.events, [{
        channel: 'platform-sync:link-state-changed',
        payload: {
            platform: 'steam',
            status: 'custom_failed',
            message: 'Steam link failed',
            code: 'STEAM_LINK_FAILED',
            retryable: false,
        },
    }]);
});

test('emit is a no-op when there is no window', () => {
    const emitter = new LinkStateEmitter();

    assert.doesNotThrow(() => {
        emitter.emit(null, 'steam', 'failed', 'Link failed');
    });
});

test('emit swallows missing webContents or missing send behavior like platformSync did', () => {
    const emitter = new LinkStateEmitter();
    const missingWebContents = makeWindow({ webContents: null });
    const missingSend = makeWindow({ webContents: {} });

    assert.doesNotThrow(() => {
        emitter.emit(missingWebContents, 'steam', 'failed', 'Link failed');
        emitter.emit(missingSend, 'steam', 'failed', 'Link failed');
    });
    assert.deepEqual(missingWebContents.events, []);
    assert.deepEqual(missingSend.events, []);
});

test('emit checks window destruction, not webContents destruction', () => {
    const emitter = new LinkStateEmitter();
    const destroyedWindow = makeWindow({ destroyed: true });
    const webContentsDestroyedEvents = [];
    const webContentsDestroyedWindow = makeWindow({
        webContents: {
            isDestroyed: () => true,
            send(channel, payload) {
                webContentsDestroyedEvents.push({ channel, payload });
            },
        },
    });

    emitter.emit(destroyedWindow, 'steam', 'failed', 'Link failed');
    emitter.emit(webContentsDestroyedWindow, 'steam', 'failed', 'Link failed');

    assert.deepEqual(destroyedWindow.events, []);
    assert.deepEqual(webContentsDestroyedEvents, [{
        channel: 'platform-sync:link-state-changed',
        payload: {
            platform: 'steam',
            status: 'failed',
            message: 'Link failed',
        },
    }]);
});

test('module stays independent from platform runtime and IPC boundaries', () => {
    const source = readSource(LINK_STATE_EMITTER_PATH);

    assert.doesNotMatch(source, /platformSync/);
    assert.doesNotMatch(source, /SyncContainer/);
    assert.doesNotMatch(source, /require\(['"]electron['"]\)/);
    assert.doesNotMatch(source, /main\.js|preload\.js|dashboard|renderer/);
    assert.doesNotMatch(source, /steamBridge|legendary|LEGENDARY/i);
    assert.doesNotMatch(source, /ipcMain|ipcRenderer|handle\(/);
});
