'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');

const ipcValidation = require('../services/ipcValidation');

// ─── assertSafeId ─────────────────────────────────────────────────────────────

test('ipcValidation: valid game ID passes', () => {
    assert.doesNotThrow(() => ipcValidation.assertSafeId('abc123def456', 'id'));
});

test('ipcValidation: MD5-style hex ID passes', () => {
    assert.doesNotThrow(() => ipcValidation.assertSafeId('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4', 'id'));
});

test('ipcValidation: empty string is rejected by assertSafeId', () => {
    assert.throws(() => ipcValidation.assertSafeId('', 'id'));
});

test('ipcValidation: path traversal in ID is rejected', () => {
    assert.throws(() => ipcValidation.assertSafeId('../etc/passwd', 'id'), /invalid/i);
});

test('ipcValidation: null is rejected by assertSafeId', () => {
    assert.throws(() => ipcValidation.assertSafeId(null, 'id'));
});

// ─── assertString ─────────────────────────────────────────────────────────────

test('ipcValidation: normal name passes assertString', () => {
    assert.doesNotThrow(() => ipcValidation.assertString('My Game', 'name', 256));
});

test('ipcValidation: string exceeding max length is rejected', () => {
    assert.throws(() => ipcValidation.assertString('x'.repeat(300), 'name', 256), /too long|length/i);
});

test('ipcValidation: non-string is rejected by assertString', () => {
    assert.throws(() => ipcValidation.assertString(42, 'name', 256), /string/i);
});

test('ipcValidation: null is rejected by assertString', () => {
    assert.throws(() => ipcValidation.assertString(null, 'name', 256), /string/i);
});

// ─── sanitizeErrorForRenderer ─────────────────────────────────────────────────

test('ipcValidation: sanitizeErrorForRenderer does not include stack property', () => {
    const err = new Error('oops');
    const result = ipcValidation.sanitizeErrorForRenderer(err);
    assert.ok(!('stack' in result), 'result must not expose raw .stack');
});

test('ipcValidation: sanitizeErrorForRenderer returns status + message', () => {
    const result = ipcValidation.sanitizeErrorForRenderer(new Error('test error'));
    assert.equal(result.status, 'error');
    assert.equal(result.message, 'test error');
});

test('ipcValidation: sanitizeErrorForRenderer uses fallback when err has no message', () => {
    const result = ipcValidation.sanitizeErrorForRenderer({}, 'fallback msg');
    assert.equal(result.message, 'fallback msg');
});
