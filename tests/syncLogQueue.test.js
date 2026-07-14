'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SYNC_LOG_QUEUE_PATH = path.join(
    ROOT,
    'src',
    'features',
    'sync',
    'infrastructure',
    'runtime',
    'SyncLogQueue.js',
);

function readSource(filePath) {
    return fs.readFileSync(filePath, 'utf8');
}

function createDeferred() {
    let resolve;
    const promise = new Promise((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

test('SyncLogQueue exists and exports a constructable queue', () => {
    const { SyncLogQueue } = require('../src/features/sync/infrastructure/runtime/SyncLogQueue');

    assert.equal(typeof SyncLogQueue, 'function');
    assert.equal(typeof new SyncLogQueue().push, 'function');
});

test('push returns the current platform sync log entry shape with injected timestamp', () => {
    const { SyncLogQueue } = require('../src/features/sync/infrastructure/runtime/SyncLogQueue');
    const queue = new SyncLogQueue({
        now: () => '2026-07-14T10:20:30.000Z',
    });

    const entry = queue.push('steam', {
        level: 'warn',
        message: 'Retrying Steam sync',
        accountId: 's1',
        accountName: 'Steam One',
    });

    assert.deepEqual(entry, {
        timestamp: '2026-07-14T10:20:30.000Z',
        level: 'warn',
        message: 'Retrying Steam sync',
        accountId: 's1',
        accountName: 'Steam One',
    });
});

test('push preserves null account fields and delegates to injected writeLog', async () => {
    const { SyncLogQueue } = require('../src/features/sync/infrastructure/runtime/SyncLogQueue');
    const writes = [];
    const queue = new SyncLogQueue({
        now: () => '2026-07-14T10:20:30.000Z',
        writeLog: async (entry, key) => {
            writes.push({ entry, key });
        },
    });

    const entry = queue.push('epic', {
        level: 'info',
        message: 'Sending library to Baddel server...',
    });
    await queue.writeQueues.epic;

    assert.deepEqual(entry, {
        timestamp: '2026-07-14T10:20:30.000Z',
        level: 'info',
        message: 'Sending library to Baddel server...',
        accountId: null,
        accountName: null,
    });
    assert.deepEqual(writes, [{ entry, key: 'epic' }]);
});

test('multiple pushes for one platform are serialized in enqueue order', async () => {
    const { SyncLogQueue } = require('../src/features/sync/infrastructure/runtime/SyncLogQueue');
    const firstWrite = createDeferred();
    const writes = [];
    const queue = new SyncLogQueue({
        now: () => '2026-07-14T10:20:30.000Z',
        writeLog: async (entry) => {
            writes.push(`start:${entry.message}`);
            if (entry.message === 'first') {
                await firstWrite.promise;
            }
            writes.push(`end:${entry.message}`);
        },
    });

    queue.push('steam', { level: 'info', message: 'first' });
    queue.push('steam', { level: 'info', message: 'second' });
    await Promise.resolve();

    assert.deepEqual(writes, ['start:first']);

    firstWrite.resolve();
    await queue.writeQueues.steam;

    assert.deepEqual(writes, ['start:first', 'end:first', 'start:second', 'end:second']);
});

test('platform queues are independent while preserving per-platform ordering', async () => {
    const { SyncLogQueue } = require('../src/features/sync/infrastructure/runtime/SyncLogQueue');
    const steamGate = createDeferred();
    const writes = [];
    const queue = new SyncLogQueue({
        now: () => '2026-07-14T10:20:30.000Z',
        writeLog: async (entry, key) => {
            writes.push(`start:${key}:${entry.message}`);
            if (key === 'steam') {
                await steamGate.promise;
            }
            writes.push(`end:${key}:${entry.message}`);
        },
    });

    queue.push('steam', { level: 'info', message: 'steam-first' });
    queue.push('epic', { level: 'info', message: 'epic-first' });
    await queue.writeQueues.epic;

    assert.deepEqual(writes, [
        'start:steam:steam-first',
        'start:epic:epic-first',
        'end:epic:epic-first',
    ]);

    steamGate.resolve();
    await queue.writeQueues.steam;

    assert.deepEqual(writes, [
        'start:steam:steam-first',
        'start:epic:epic-first',
        'end:epic:epic-first',
        'end:steam:steam-first',
    ]);
});

test('write failures are swallowed and later writes continue on the same platform', async () => {
    const { SyncLogQueue } = require('../src/features/sync/infrastructure/runtime/SyncLogQueue');
    const writes = [];
    const queue = new SyncLogQueue({
        now: () => '2026-07-14T10:20:30.000Z',
        writeLog: async (entry) => {
            writes.push(entry.message);
            if (entry.message === 'first') {
                throw new Error('disk full');
            }
        },
    });

    queue.push('steam', { level: 'error', message: 'first' });
    queue.push('steam', { level: 'info', message: 'second' });
    await queue.writeQueues.steam;

    assert.deepEqual(writes, ['first', 'second']);
});

test('SyncLogQueue stays independent of platform runtime modules', () => {
    const source = readSource(SYNC_LOG_QUEUE_PATH);

    assert.doesNotMatch(source, /platformSync/);
    assert.doesNotMatch(source, /SyncContainer/);
    assert.doesNotMatch(source, /electron/);
    assert.doesNotMatch(source, /main\.js|preload\.js|renderer|dashboard/);
    assert.doesNotMatch(source, /steamBridge/);
    assert.doesNotMatch(source, /legendary|execFile/);
    assert.doesNotMatch(source, /baddelApi|services\/baddelApi/);
});
