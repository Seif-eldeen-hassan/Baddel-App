'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    SyncTerminalEventEmitter,
} = require('../src/features/sync/infrastructure/runtime/SyncTerminalEventEmitter');

const ROOT = path.resolve(__dirname, '..');
const MODULE_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'runtime', 'SyncTerminalEventEmitter.js');

function makeWindow({ destroyed = false, focused = true, sendThrows = false } = {}) {
    const events = [];
    return {
        events,
        isDestroyed() {
            return destroyed;
        },
        isFocused() {
            return focused;
        },
        webContents: {
            send(channel, payload) {
                if (sendThrows) throw new Error('send failed');
                events.push({ channel, payload });
            },
        },
    };
}

function makeNotification({ supported = true, throws = false } = {}) {
    const shown = [];
    class FakeNotification {
        constructor(options) {
            if (throws) throw new Error('notification failed');
            this.options = options;
        }

        show() {
            if (throws) throw new Error('notification show failed');
            shown.push(this.options);
        }

        static isSupported() {
            if (throws) throw new Error('support check failed');
            return supported;
        }
    }
    FakeNotification.shown = shown;
    return FakeNotification;
}

test('SyncTerminalEventEmitter exists', () => {
    assert.equal(typeof SyncTerminalEventEmitter, 'function');
});

test('emitCompleted sends platform-sync:completed with exact payload', () => {
    const win = makeWindow();
    const payload = { platform: 'steam', phase: 'done', nested: { count: 1 } };
    const emitter = new SyncTerminalEventEmitter({
        getWindow: () => win,
        Notification: makeNotification({ supported: false }),
    });

    emitter.emitCompleted(payload, { title: 'ignored' });

    assert.deepEqual(win.events, [{
        channel: 'platform-sync:completed',
        payload,
    }]);
});

test('emitFailed sends platform-sync:failed with exact payload', () => {
    const win = makeWindow();
    const payload = { platform: 'epic', phase: 'error', lastError: 'boom' };
    const emitter = new SyncTerminalEventEmitter({ getWindow: () => win });

    emitter.emitFailed(payload);

    assert.deepEqual(win.events, [{
        channel: 'platform-sync:failed',
        payload,
    }]);
});

test('completed notification shows only when supported and window is not focused', () => {
    const win = makeWindow({ focused: false });
    const Notification = makeNotification({ supported: true });
    const notificationOptions = {
        title: 'Baddel Launcher',
        body: 'Steam library sync complete.',
        icon: 'Logo.ico',
    };
    const emitter = new SyncTerminalEventEmitter({
        getWindow: () => win,
        Notification,
    });

    emitter.emitCompleted({ platform: 'steam' }, notificationOptions);

    assert.deepEqual(Notification.shown, [notificationOptions]);
});

test('completed notification is skipped for focused windows and unsupported notifications', () => {
    const focusedNotification = makeNotification({ supported: true });
    new SyncTerminalEventEmitter({
        getWindow: () => makeWindow({ focused: true }),
        Notification: focusedNotification,
    }).emitCompleted({ platform: 'steam' }, { title: 'focused' });

    const unsupportedNotification = makeNotification({ supported: false });
    new SyncTerminalEventEmitter({
        getWindow: () => makeWindow({ focused: false }),
        Notification: unsupportedNotification,
    }).emitCompleted({ platform: 'steam' }, { title: 'unsupported' });

    assert.deepEqual(focusedNotification.shown, []);
    assert.deepEqual(unsupportedNotification.shown, []);
});

test('failed events do not trigger notification', () => {
    const Notification = makeNotification({ supported: true });
    const emitter = new SyncTerminalEventEmitter({
        getWindow: () => makeWindow({ focused: false }),
        Notification,
    });

    emitter.emitFailed({ platform: 'steam', phase: 'error' });

    assert.deepEqual(Notification.shown, []);
});

test('no window behavior skips send and allows completed notification', () => {
    const Notification = makeNotification({ supported: true });
    const emitter = new SyncTerminalEventEmitter({
        getWindow: () => null,
        Notification,
    });

    assert.doesNotThrow(() => {
        emitter.emitCompleted({ platform: 'steam' }, { title: 'complete' });
        emitter.emitFailed({ platform: 'steam', phase: 'error' });
    });
    assert.deepEqual(Notification.shown, [{ title: 'complete' }]);
});

test('missing webContents, destroyed window, and send failure are swallowed', () => {
    assert.doesNotThrow(() => {
        new SyncTerminalEventEmitter({
            getWindow: () => ({ isDestroyed: () => false }),
        }).emitCompleted({ platform: 'steam' });

        new SyncTerminalEventEmitter({
            getWindow: () => makeWindow({ destroyed: true }),
        }).emitFailed({ platform: 'steam' });

        new SyncTerminalEventEmitter({
            getWindow: () => makeWindow({ sendThrows: true }),
        }).emitFailed({ platform: 'steam' });
    });
});

test('completed notification is skipped when terminal send/window access fails', () => {
    const sendFailureNotification = makeNotification({ supported: true });
    new SyncTerminalEventEmitter({
        getWindow: () => makeWindow({ focused: false, sendThrows: true }),
        Notification: sendFailureNotification,
    }).emitCompleted({ platform: 'steam' }, { title: 'send failed' });

    const windowFailureNotification = makeNotification({ supported: true });
    new SyncTerminalEventEmitter({
        getWindow: () => {
            throw new Error('window failed');
        },
        Notification: windowFailureNotification,
    }).emitCompleted({ platform: 'steam' }, { title: 'window failed' });

    assert.deepEqual(sendFailureNotification.shown, []);
    assert.deepEqual(windowFailureNotification.shown, []);
});

test('webContents destroyed state is not inspected by the terminal emitter', () => {
    const win = makeWindow();
    win.webContents.isDestroyed = () => true;
    const payload = { platform: 'steam', phase: 'done' };
    const emitter = new SyncTerminalEventEmitter({ getWindow: () => win });

    emitter.emitCompleted(payload);

    assert.deepEqual(win.events, [{
        channel: 'platform-sync:completed',
        payload,
    }]);
});

test('notification failure is swallowed', () => {
    const emitter = new SyncTerminalEventEmitter({
        getWindow: () => makeWindow({ focused: false }),
        Notification: makeNotification({ supported: true, throws: true }),
    });

    assert.doesNotThrow(() => {
        emitter.emitCompleted({ platform: 'steam' }, { title: 'complete' });
    });
});

test('module has no forbidden infrastructure or application dependencies', () => {
    const source = fs.readFileSync(MODULE_PATH, 'utf8');

    assert.doesNotMatch(source, /platformSync/);
    assert.doesNotMatch(source, /SyncContainer/);
    assert.doesNotMatch(source, /require\(['"]electron['"]\)/);
    assert.doesNotMatch(source, /main\.js|preload\.js|renderer|dashboard/);
    assert.doesNotMatch(source, /steamBridge|legendary|execFile/);
    assert.doesNotMatch(source, /ipcMain|ipcRenderer|handle\(|\.on\(/);
    assert.doesNotMatch(source, /_platformSyncState|_setPlatformSyncState|_getPlatformSyncState/);
});
