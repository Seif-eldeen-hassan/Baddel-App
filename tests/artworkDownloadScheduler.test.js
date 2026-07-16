'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
    ArtworkDownloadScheduler,
    ARTWORK_DOWNLOAD_PRIORITIES,
    defaultKeyForTask,
} = require('../src/features/games/infrastructure/services/ArtworkDownloadScheduler');

const SCHEDULER_PATH = path.join(
    __dirname,
    '..',
    'src',
    'features',
    'games',
    'infrastructure',
    'services',
    'ArtworkDownloadScheduler.js'
);

function nextTick() {
    return new Promise(resolve => setImmediate(resolve));
}

test('ArtworkDownloadScheduler runs higher-priority visible/detail work before background work', async () => {
    const order = [];
    const scheduler = new ArtworkDownloadScheduler({
        concurrency: 1,
        worker: async task => {
            order.push(task.key);
            return task.key;
        },
    });

    scheduler.enqueue({ key: 'background-1', priority: ARTWORK_DOWNLOAD_PRIORITIES.BACKGROUND });
    scheduler.enqueue({ key: 'visible-1', priority: ARTWORK_DOWNLOAD_PRIORITIES.VISIBLE });
    scheduler.enqueue({ key: 'details-1', priority: ARTWORK_DOWNLOAD_PRIORITIES.GAME_DETAILS });
    await scheduler.drain();

    assert.deepEqual(order, ['details-1', 'visible-1', 'background-1']);
});

test('ArtworkDownloadScheduler escalates a pending duplicate to the highest requested priority', async () => {
    const order = [];
    const scheduler = new ArtworkDownloadScheduler({
        concurrency: 1,
        worker: async task => {
            order.push(`${task.key}:${task.priority}`);
            return task.priority;
        },
    });

    scheduler.enqueue({ key: 'background-1', priority: ARTWORK_DOWNLOAD_PRIORITIES.BACKGROUND });
    const first = scheduler.enqueue({ key: 'shared-cover', priority: ARTWORK_DOWNLOAD_PRIORITIES.BACKGROUND });
    const second = scheduler.enqueue({ key: 'shared-cover', priority: ARTWORK_DOWNLOAD_PRIORITIES.GAME_DETAILS });
    scheduler.enqueue({ key: 'visible-1', priority: ARTWORK_DOWNLOAD_PRIORITIES.VISIBLE });
    await scheduler.drain();

    assert.strictEqual(first, second);
    assert.deepEqual(order, [
        'shared-cover:game-details',
        'visible-1:visible',
        'background-1:background',
    ]);
    assert.equal(await first, ARTWORK_DOWNLOAD_PRIORITIES.GAME_DETAILS);
    assert.equal(scheduler.getStats().deduplicated, 1);
    assert.equal(scheduler.getStats().priorityEscalations, 1);
});

test('ArtworkDownloadScheduler deduplicates in-flight requests by key', async () => {
    let workerCalls = 0;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const scheduler = new ArtworkDownloadScheduler({
        concurrency: 1,
        worker: async task => {
            workerCalls += 1;
            await gate;
            return `done:${task.key}`;
        },
    });

    const first = scheduler.enqueue({ key: 'same-url', priority: ARTWORK_DOWNLOAD_PRIORITIES.VISIBLE });
    await nextTick();
    const second = scheduler.enqueue({ key: 'same-url', priority: ARTWORK_DOWNLOAD_PRIORITIES.GAME_DETAILS });
    release();

    assert.strictEqual(first, second);
    assert.equal(await first, 'done:same-url');
    assert.equal(await second, 'done:same-url');
    assert.equal(workerCalls, 1);
    assert.equal(scheduler.getStats().deduplicated, 1);
});

test('ArtworkDownloadScheduler caps worker concurrency', async () => {
    let active = 0;
    let maxActive = 0;
    const scheduler = new ArtworkDownloadScheduler({
        concurrency: 2,
        worker: async task => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await new Promise(resolve => setTimeout(resolve, 5));
            active -= 1;
            return task.key;
        },
    });

    for (let i = 0; i < 6; i += 1) {
        scheduler.enqueue({ key: `task-${i}`, priority: ARTWORK_DOWNLOAD_PRIORITIES.BACKGROUND });
    }
    await scheduler.drain();

    assert.equal(maxActive, 2);
    assert.equal(scheduler.getStats().started, 6);
    assert.equal(scheduler.getStats().completed, 6);
});

test('ArtworkDownloadScheduler isolates failed tasks and keeps draining later work', async () => {
    const order = [];
    const scheduler = new ArtworkDownloadScheduler({
        concurrency: 1,
        worker: async task => {
            order.push(task.key);
            if (task.key === 'bad') throw new Error('download failed');
            return task.key;
        },
    });

    const bad = scheduler.enqueue({ key: 'bad', priority: ARTWORK_DOWNLOAD_PRIORITIES.GAME_DETAILS });
    const good = scheduler.enqueue({ key: 'good', priority: ARTWORK_DOWNLOAD_PRIORITIES.VISIBLE });
    await assert.rejects(bad, /download failed/);
    assert.equal(await good, 'good');
    await scheduler.drain();

    assert.deepEqual(order, ['bad', 'good']);
    assert.equal(scheduler.getStats().failed, 1);
    assert.equal(scheduler.getStats().completed, 1);
});

test('ArtworkDownloadScheduler default keys include URL, canonical game id, and type', () => {
    assert.equal(
        defaultKeyForTask({
            sourceUrl: 'https://cdn.example/a.png',
            canonicalGameId: 'steam:10',
            type: 'cover',
        }),
        'https://cdn.example/a.png|steam:10|cover'
    );
});

test('ArtworkDownloadScheduler stays infrastructure-only and does not import renderer or Electron modules', () => {
    const source = fs.readFileSync(SCHEDULER_PATH, 'utf8');

    assert.doesNotMatch(source, /electron|ipcMain|BrowserWindow|window\.|document\./);
    assert.doesNotMatch(source, /platformSync|main\.js|preload\.js/);
});
