'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    StateChangedEmitter,
} = require('../src/features/sync/infrastructure/runtime/StateChangedEmitter');

const ROOT = path.resolve(__dirname, '..');
const MODULE_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'runtime', 'StateChangedEmitter.js');

function makeWindow({ destroyed = false, sendThrows = false } = {}) {
    const events = [];
    return {
        events,
        isDestroyed() {
            return destroyed;
        },
        webContents: {
            send(channel, payload) {
                if (sendThrows) throw new Error('send failed');
                events.push({ channel, payload });
            },
        },
    };
}

test('StateChangedEmitter exists', () => {
    assert.equal(typeof StateChangedEmitter, 'function');
});

test('emit sends platform-sync:state with exact payload object', () => {
    const win = makeWindow();
    const payload = { platform: 'steam', phase: 'starting', nested: { percent: 0 } };
    const emitter = new StateChangedEmitter({ getWindow: () => win });

    emitter.emit(payload);

    assert.deepEqual(win.events, [{
        channel: 'platform-sync:state',
        payload,
    }]);
    assert.equal(win.events[0].payload, payload);
});

test('no window behavior is a no-op', () => {
    const emitter = new StateChangedEmitter({ getWindow: () => null });

    assert.doesNotThrow(() => emitter.emit({ platform: 'steam' }));
});

test('missing webContents behavior is swallowed', () => {
    const emitter = new StateChangedEmitter({
        getWindow: () => ({ isDestroyed: () => false }),
    });

    assert.doesNotThrow(() => emitter.emit({ platform: 'steam' }));
});

test('destroyed window skips state event send', () => {
    const win = makeWindow({ destroyed: true });
    const emitter = new StateChangedEmitter({ getWindow: () => win });

    emitter.emit({ platform: 'steam' });

    assert.deepEqual(win.events, []);
});

test('webContents destroyed state is not inspected by the state emitter', () => {
    const win = makeWindow();
    win.webContents.isDestroyed = () => true;
    const payload = { platform: 'steam', phase: 'starting' };
    const emitter = new StateChangedEmitter({ getWindow: () => win });

    emitter.emit(payload);

    assert.deepEqual(win.events, [{
        channel: 'platform-sync:state',
        payload,
    }]);
});

test('window getter, missing isDestroyed, and send failures are swallowed', () => {
    assert.doesNotThrow(() => {
        new StateChangedEmitter({
            getWindow: () => {
                throw new Error('window failed');
            },
        }).emit({ platform: 'steam' });

        new StateChangedEmitter({
            getWindow: () => ({ webContents: { send() {} } }),
        }).emit({ platform: 'steam' });

        new StateChangedEmitter({
            getWindow: () => makeWindow({ sendThrows: true }),
        }).emit({ platform: 'steam' });
    });
});

test('module has no forbidden infrastructure or state dependencies', () => {
    const source = fs.readFileSync(MODULE_PATH, 'utf8');

    assert.doesNotMatch(source, /platformSync/);
    assert.doesNotMatch(source, /SyncContainer/);
    assert.doesNotMatch(source, /require\(['"]electron['"]\)/);
    assert.doesNotMatch(source, /main\.js|preload\.js|renderer|dashboard/);
    assert.doesNotMatch(source, /steamBridge|legendary|execFile/);
    assert.doesNotMatch(source, /ipcMain|ipcRenderer|handle\(|\.on\(/);
    assert.doesNotMatch(source, /_platformSyncState|_setPlatformSyncState|_getPlatformSyncState|_createPlatformSyncState/);
    assert.doesNotMatch(source, /Notification|SyncLogQueue|LinkStateEmitter|LibraryUpdateEmitter|SyncTerminalEventEmitter/);
});
