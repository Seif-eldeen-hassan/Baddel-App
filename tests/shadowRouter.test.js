'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');

const {
    createShadowCapture,
    deepEqual,
    wrapWithShadow,
    shadowHandle,
} = require('../src/shared/ipc/shadowRouter');

// ─── deepEqual ────────────────────────────────────────────────────────────────

test('deepEqual: identical primitives', () => {
    assert.ok(deepEqual(1, 1));
    assert.ok(deepEqual('x', 'x'));
    assert.ok(deepEqual(null, null));
    assert.ok(deepEqual(true, false) === false);
});

test('deepEqual: nested objects match', () => {
    assert.ok(deepEqual({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 2 } }));
});

test('deepEqual: nested objects differ', () => {
    assert.ok(!deepEqual({ a: 1 }, { a: 2 }));
});

test('deepEqual: arrays equal', () => {
    assert.ok(deepEqual([1, 2, 3], [1, 2, 3]));
});

test('deepEqual: arrays differ by length', () => {
    assert.ok(!deepEqual([1, 2], [1, 2, 3]));
});

// ─── createShadowCapture ─────────────────────────────────────────────────────

test('createShadowCapture: captures handle registrations', () => {
    const capture = createShadowCapture();
    const fn = () => 'result';
    capture.handle('my-channel', fn);
    const entry = capture.getHandler('my-channel');
    assert.ok(entry);
    assert.strictEqual(entry.type, 'handle');
    assert.strictEqual(entry.fn, fn);
});

test('createShadowCapture: captures on registrations', () => {
    const capture = createShadowCapture();
    const fn = () => {};
    capture.on('my-event', fn);
    const entry = capture.getHandler('my-event');
    assert.ok(entry);
    assert.strictEqual(entry.type, 'on');
});

test('createShadowCapture: getHandler returns null for unknown channel', () => {
    const capture = createShadowCapture();
    assert.strictEqual(capture.getHandler('unknown'), null);
});

test('createShadowCapture: getChannels lists all registered channels', () => {
    const capture = createShadowCapture();
    capture.handle('ch-a', () => {});
    capture.on('ch-b', () => {});
    const channels = capture.getChannels();
    assert.ok(channels.includes('ch-a'));
    assert.ok(channels.includes('ch-b'));
});

// ─── wrapWithShadow ──────────────────────────────────────────────────────────

test('wrapWithShadow: returns legacy result to caller', async () => {
    const legacyFn = async () => ({ status: 'ok', source: 'legacy' });
    const shadowFn = async () => ({ status: 'ok', source: 'shadow' });
    const wrapped  = wrapWithShadow('test-channel', legacyFn, shadowFn);
    const result   = await wrapped({});
    assert.deepStrictEqual(result, { status: 'ok', source: 'legacy' });
});

test('wrapWithShadow: shadow throw does not propagate to caller', async () => {
    const legacyFn = async () => 'safe';
    const shadowFn = async () => { throw new Error('shadow exploded'); };
    const wrapped  = wrapWithShadow('test-channel', legacyFn, shadowFn);
    const result   = await wrapped({});
    assert.strictEqual(result, 'safe');
    // Allow the fire-and-forget microtask to settle before test ends
    await new Promise(r => setImmediate(r));
});

test('wrapWithShadow: onMismatch callback fires when results differ', async () => {
    const legacyFn = async () => [1, 2, 3];
    const shadowFn = async () => [1, 2];
    const mismatches = [];
    const wrapped = wrapWithShadow('test-channel', legacyFn, shadowFn, {
        onMismatch(channel, leg, shad) { mismatches.push({ channel, leg, shad }); },
    });
    await wrapped({});
    await new Promise(r => setImmediate(r));
    assert.strictEqual(mismatches.length, 1);
    assert.strictEqual(mismatches[0].channel, 'test-channel');
});

test('wrapWithShadow: onMismatch not called when results match', async () => {
    const legacyFn = async () => ({ id: 'abc', name: 'Game' });
    const shadowFn = async () => ({ id: 'abc', name: 'Game' });
    const mismatches = [];
    const wrapped = wrapWithShadow('test-channel', legacyFn, shadowFn, {
        onMismatch() { mismatches.push(true); },
    });
    await wrapped({});
    await new Promise(r => setImmediate(r));
    assert.strictEqual(mismatches.length, 0);
});

test('wrapWithShadow: onMismatch throw does not propagate', async () => {
    const legacyFn = async () => 'a';
    const shadowFn = async () => 'b';
    const wrapped = wrapWithShadow('test-channel', legacyFn, shadowFn, {
        onMismatch() { throw new Error('callback exploded'); },
    });
    const result = await wrapped({});
    await new Promise(r => setImmediate(r));
    assert.strictEqual(result, 'a');
});

// ─── shadowHandle ─────────────────────────────────────────────────────────────

test('shadowHandle: registers wrapped handler on real ipcMain', async () => {
    const registered = {};
    const fakeIpcMain = {
        handle(channel, fn) { registered[channel] = fn; },
    };
    const capture = createShadowCapture();
    capture.handle('ch', async () => 'shadow-value');

    const legacyFn = async () => 'legacy-value';
    shadowHandle(fakeIpcMain, 'ch', legacyFn, capture);

    assert.ok(registered['ch'], 'handler was registered');
    const result = await registered['ch']({});
    assert.strictEqual(result, 'legacy-value');
});

test('shadowHandle: falls back to legacy when no capture for channel', () => {
    const registered = {};
    const fakeIpcMain = {
        handle(channel, fn) { registered[channel] = fn; },
    };
    const capture = createShadowCapture();
    const legacyFn = async () => 'legacy';
    shadowHandle(fakeIpcMain, 'missing-ch', legacyFn, capture);
    assert.strictEqual(registered['missing-ch'], legacyFn);
});
