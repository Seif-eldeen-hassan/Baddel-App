'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    UpdateCheckCoordinator,
    UPDATE_CHECK_CONCURRENCY,
} = require('../src/features/downloads/infrastructure/services/UpdateCheckCoordinator');

const turn = () => new Promise(resolve => setImmediate(resolve));

test('20+ rapid manual checks are globally bounded, lossless, and same-game deduplicated', async () => {
    const coordinator = new UpdateCheckCoordinator();
    const started = [];
    const gates = [];
    let active = 0;
    let maximumActive = 0;
    const run = identity => () => new Promise(resolve => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        started.push(identity);
        gates.push(() => { active -= 1; resolve(identity); });
    });

    const requests = Array.from({ length: 24 }, (_, index) => {
        const identity = `gog:gogdl:game-${index}`;
        return coordinator.request({ identity, priority: 'manual', run: run(identity) });
    });
    const duplicates = [0, 0, 7, 7, 23].map(index => coordinator.request({
        identity: `gog:gogdl:game-${index}`,
        priority: 'manual',
        run: () => { throw new Error('duplicate provider call'); },
    }));

    while (coordinator.getSnapshot().checks.length > 0) {
        await turn();
        const release = gates.shift();
        if (release) release();
    }
    const results = await Promise.all([...requests, ...duplicates]);
    assert.equal(maximumActive, UPDATE_CHECK_CONCURRENCY);
    assert.equal(new Set(started).size, 24);
    assert.equal(started.length, 24);
    assert.equal(results.length, 29);
    assert.deepEqual(new Set(started), new Set(Array.from({ length: 24 }, (_, index) => `gog:gogdl:game-${index}`)));
});

test('manual work outranks waiting background work without interrupting active checks', async () => {
    const coordinator = new UpdateCheckCoordinator();
    const order = [];
    const releases = new Map();
    const schedule = (identity, priority) => coordinator.request({
        identity,
        priority,
        run: () => new Promise(resolve => {
            order.push(identity);
            releases.set(identity, resolve);
        }),
    });

    const all = [
        schedule('background-running-1', 'background'),
        schedule('background-running-2', 'background'),
        schedule('background-waiting-1', 'background'),
        schedule('background-waiting-2', 'background'),
        schedule('manual-waiting', 'manual'),
    ];
    await turn();
    assert.deepEqual(order, ['background-running-1', 'background-running-2']);
    releases.get('background-running-1')();
    await turn();
    assert.equal(order[2], 'manual-waiting');
    for (const identity of ['background-running-2', 'manual-waiting', 'background-waiting-1', 'background-waiting-2']) {
        releases.get(identity)?.();
        await turn();
    }
    await Promise.all(all);
    assert.deepEqual(order, ['background-running-1', 'background-running-2', 'manual-waiting', 'background-waiting-1', 'background-waiting-2']);
});

test('a manual duplicate promotes the same waiting background entry', async () => {
    const coordinator = new UpdateCheckCoordinator({ concurrency: 1 });
    let releaseBlocker;
    const blocker = coordinator.request({ identity: 'blocker', priority: 'background', run: () => new Promise(resolve => { releaseBlocker = resolve; }) });
    let providerCalls = 0;
    const background = coordinator.request({ identity: 'same-game', priority: 'background', run: async () => { providerCalls += 1; return 'checked'; } });
    const manual = coordinator.request({ identity: 'same-game', priority: 'manual', run: async () => { providerCalls += 100; } });
    assert.deepEqual(coordinator.get('same-game'), { identity: 'same-game', priority: 'manual', state: 'queued' });
    await turn();
    releaseBlocker();
    assert.deepEqual(await Promise.all([blocker, background, manual]), [undefined, 'checked', 'checked']);
    assert.equal(providerCalls, 1);
});
