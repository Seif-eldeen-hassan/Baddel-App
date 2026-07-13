'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    createSteamQrPollingLoop,
} = require('../src/features/sync/application/services/SteamQrPollingLoop');

const flushMicrotasks = async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
};

const createHarness = ({ pollResults = [], destroyed = false } = {}) => {
    const scheduled = [];
    const cleared = [];
    const loggerErrors = [];
    const calls = [];
    let closed = false;
    let resolved;
    let rejected;
    let resolveAuth;
    let rejectAuth;
    const promise = new Promise((resolve, reject) => {
        resolveAuth = resolve;
        rejectAuth = reject;
    });
    promise.catch(() => {});

    const loop = createSteamQrPollingLoop({
        pollSteamAuth: async () => {
            calls.push('poll');
            const next = pollResults.shift();
            if (next instanceof Error) throw next;
            return next ?? { status: 'pending_approval' };
        },
        isWindowDestroyed: () => destroyed,
        closeWindow: () => {
            calls.push('close');
            closed = true;
        },
        resolve: (value) => {
            calls.push('resolve');
            resolved = value;
            resolveAuth(value);
        },
        reject: (err) => {
            calls.push('reject');
            rejected = err;
            rejectAuth(err);
        },
        restart: () => {
            calls.push('restart');
        },
        logger: {
            error: (...args) => loggerErrors.push(args),
        },
        setTimeoutFn: (cb, ms) => {
            const timer = { cb, ms, cleared: false };
            scheduled.push(timer);
            return timer;
        },
        clearTimeoutFn: (timer) => {
            timer.cleared = true;
            cleared.push(timer);
        },
    });

    return {
        loop,
        scheduled,
        cleared,
        calls,
        loggerErrors,
        promise,
        get closed() { return closed; },
        get resolved() { return resolved; },
        get rejected() { return rejected; },
    };
};

test('SteamQrPollingLoop schedules pending result for another poll', async () => {
    const harness = createHarness({
        pollResults: [{ status: 'pending_approval' }],
    });

    harness.loop.start(2000);
    assert.equal(harness.scheduled.length, 1);
    assert.equal(harness.scheduled[0].ms, 2000);

    await harness.scheduled[0].cb();
    await flushMicrotasks();

    assert.equal(harness.resolved, undefined);
    assert.equal(harness.rejected, undefined);
    assert.equal(harness.closed, false);
    assert.equal(harness.scheduled.length, 2);
    assert.equal(harness.scheduled[1].ms, 2000);
});

test('SteamQrPollingLoop closes window and resolves authenticated result', async () => {
    const result = { status: 'authenticated', steamId: '123', accountName: 'alice' };
    const harness = createHarness({ pollResults: [result] });

    harness.loop.start(2500);
    await harness.scheduled[0].cb();
    const resolved = await harness.promise;

    assert.deepEqual(resolved, result);
    assert.equal(harness.closed, true);
    assert.deepEqual(harness.calls, ['poll', 'close', 'resolve']);
    assert.equal(harness.scheduled[0].cleared, true);
    assert.equal(harness.cleared.length, 1);
});

test('SteamQrPollingLoop rejects denied result without closing window', async () => {
    const harness = createHarness({
        pollResults: [{ status: 'approval_denied', message: 'User denied' }],
    });

    harness.loop.start(2000);
    await harness.scheduled[0].cb();
    await assert.rejects(harness.promise, /User denied/);

    assert.equal(harness.closed, false);
    assert.deepEqual(harness.calls, ['poll', 'reject']);
    assert.equal(harness.scheduled[0].cleared, true);
});

test('SteamQrPollingLoop rejects error result with fallback message', async () => {
    const harness = createHarness({
        pollResults: [{ status: 'error' }],
    });

    harness.loop.start(2000);
    await harness.scheduled[0].cb();
    await assert.rejects(harness.promise, /QR login failed/);

    assert.equal(harness.closed, false);
    assert.deepEqual(harness.calls, ['poll', 'reject']);
    assert.equal(harness.scheduled[0].cleared, true);
});

test('SteamQrPollingLoop restarts on expired result without closing window', async () => {
    const harness = createHarness({
        pollResults: [{ status: 'approval_expired' }],
    });

    harness.loop.start(2000);
    await harness.scheduled[0].cb();
    await flushMicrotasks();

    assert.equal(harness.closed, false);
    assert.deepEqual(harness.calls, ['poll', 'restart']);
    assert.equal(harness.scheduled[0].cleared, true);
});

test('SteamQrPollingLoop retries after poll exception', async () => {
    const harness = createHarness({
        pollResults: [new Error('temporary bridge failure')],
    });

    harness.loop.start(3000);
    await harness.scheduled[0].cb();
    await flushMicrotasks();

    assert.equal(harness.resolved, undefined);
    assert.equal(harness.rejected, undefined);
    assert.equal(harness.closed, false);
    assert.equal(harness.loggerErrors.length, 1);
    assert.equal(harness.scheduled.length, 2);
    assert.equal(harness.scheduled[1].ms, 3000);
});

test('SteamQrPollingLoop stop clears scheduled poll and prevents bridge call', async () => {
    const harness = createHarness({
        pollResults: [{ status: 'authenticated', steamId: 'stopped' }],
    });

    harness.loop.start(2000);
    harness.loop.stop();
    await harness.scheduled[0].cb();
    await flushMicrotasks();

    assert.equal(harness.scheduled[0].cleared, true);
    assert.deepEqual(harness.calls, []);
    assert.equal(harness.closed, false);
});
