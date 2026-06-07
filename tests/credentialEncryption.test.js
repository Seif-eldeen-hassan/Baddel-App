'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

// ─── Mock electron and keytar before requiring the module ─────────────────────

const Module    = require('module');
const _origLoad = Module._load.bind(Module);

// A fixed 32-byte key used for all tests so encrypt/decrypt share the same key.
const TEST_KEY_BUF = crypto.randomBytes(32);
const TEST_KEY_B64 = TEST_KEY_BUF.toString('base64');

let _keytarGetPassword = async () => TEST_KEY_B64;  // mutable so tests can override
let _keytarSetPassword = async () => {};

Module._load = function (req, parent, isMain) {
    if (req === 'electron') {
        return { app: { getPath: () => require('os').tmpdir() } };
    }
    if (req === 'keytar') {
        return {
            getPassword: (...a) => _keytarGetPassword(...a),
            setPassword: (...a) => _keytarSetPassword(...a),
        };
    }
    return _origLoad(req, parent, isMain);
};

let enc;
try { enc = require('../services/credentialEncryption'); } catch (e) { enc = null; }

Module._load = _origLoad;

// ─── 1. Constants ─────────────────────────────────────────────────────────────

test('ENCRYPT_MAGIC is 4-byte Buffer "BDEL"', () => {
    assert.ok(enc);
    assert.ok(Buffer.isBuffer(enc.ENCRYPT_MAGIC));
    assert.equal(enc.ENCRYPT_MAGIC.toString('ascii'), 'BDEL');
    assert.equal(enc.ENCRYPT_MAGIC.length, 4);
});

test('ENCRYPT_VERSION is 1', () => {
    assert.equal(enc.ENCRYPT_VERSION, 1);
});

test('KEYTAR_SERVICE is "baddel-account-switcher"', () => {
    assert.equal(enc.KEYTAR_SERVICE, 'baddel-account-switcher');
});

test('KEYTAR_ACCOUNT is "master-encryption-key"', () => {
    assert.equal(enc.KEYTAR_ACCOUNT, 'master-encryption-key');
});

// ─── 2. isEncryptedFile ───────────────────────────────────────────────────────

test('isEncryptedFile: returns true for buffer starting with BDEL', () => {
    const buf = Buffer.concat([Buffer.from('BDEL'), Buffer.alloc(30)]);
    assert.equal(enc.isEncryptedFile(buf), true);
});

test('isEncryptedFile: returns false for plaintext buffer', () => {
    assert.equal(enc.isEncryptedFile(Buffer.from('hello world')), false);
});

test('isEncryptedFile: returns false for buffer shorter than 4 bytes', () => {
    assert.equal(enc.isEncryptedFile(Buffer.from('BDE')), false);
});

test('isEncryptedFile: returns false for empty buffer', () => {
    assert.equal(enc.isEncryptedFile(Buffer.alloc(0)), false);
});

// ─── 3. encryptBuffer / decryptBuffer round-trip ─────────────────────────────

test('encryptBuffer produces a buffer starting with BDEL magic', async () => {
    enc.clearEncryptionKeyCache();
    const plain = Buffer.from('super secret token', 'utf8');
    const encrypted = await enc.encryptBuffer(plain);
    assert.equal(encrypted.slice(0, 4).toString('ascii'), 'BDEL');
});

test('encryptBuffer output byte 4 is version 1', async () => {
    enc.clearEncryptionKeyCache();
    const encrypted = await enc.encryptBuffer(Buffer.from('x'));
    assert.equal(encrypted[4], 1);
});

test('encryptBuffer output is longer than plaintext + header (33 bytes min)', async () => {
    enc.clearEncryptionKeyCache();
    const plain = Buffer.from('token');
    const encrypted = await enc.encryptBuffer(plain);
    // header=5, IV=12, authTag=16 → min 33 bytes before ciphertext
    assert.ok(encrypted.length >= 33 + plain.length);
});

test('decryptBuffer correctly recovers the original plaintext', async () => {
    enc.clearEncryptionKeyCache();
    const plain = Buffer.from('my-secret-session-token', 'utf8');
    const encrypted = await enc.encryptBuffer(plain);
    const recovered = await enc.decryptBuffer(encrypted);
    assert.deepEqual(recovered, plain);
});

test('decryptBuffer with wrong authTag throws (GCM integrity check)', async () => {
    enc.clearEncryptionKeyCache();
    const encrypted = await enc.encryptBuffer(Buffer.from('data'));
    // Corrupt one byte of the ciphertext (after 33-byte header)
    if (encrypted.length > 33) encrypted[33] ^= 0xff;
    await assert.rejects(() => enc.decryptBuffer(encrypted));
});

test('decryptBuffer rejects buffer that is too short', async () => {
    enc.clearEncryptionKeyCache();
    await assert.rejects(() => enc.decryptBuffer(Buffer.alloc(10)), /too short/i);
});

test('decryptBuffer rejects buffer with wrong magic', async () => {
    enc.clearEncryptionKeyCache();
    const bad = Buffer.alloc(40);
    bad.write('NOPE', 0, 'ascii');
    await assert.rejects(() => enc.decryptBuffer(bad), /not an encrypted/i);
});

test('decryptBuffer rejects buffer with unknown version byte', async () => {
    enc.clearEncryptionKeyCache();
    const good = await enc.encryptBuffer(Buffer.from('x'));
    good[4] = 99; // corrupt version
    await assert.rejects(() => enc.decryptBuffer(good), /unknown encryption version/i);
});

test('two encryptions of the same plaintext produce different ciphertext (random IV)', async () => {
    enc.clearEncryptionKeyCache();
    const plain = Buffer.from('same text');
    const a = await enc.encryptBuffer(plain);
    const b = await enc.encryptBuffer(plain);
    // IVs at bytes 5-16 should differ
    assert.notDeepEqual(a.slice(5, 17), b.slice(5, 17));
});

// ─── 4. encryptString / decryptString round-trip ─────────────────────────────

test('encryptString returns a base64 string', async () => {
    enc.clearEncryptionKeyCache();
    const result = await enc.encryptString('my-token');
    assert.equal(typeof result, 'string');
    assert.doesNotThrow(() => Buffer.from(result, 'base64'));
});

test('encryptString / decryptString round-trip recovers plaintext', async () => {
    enc.clearEncryptionKeyCache();
    const plain = 'super-secret-password-123!@#';
    const encrypted = await enc.encryptString(plain);
    const recovered = await enc.decryptString(encrypted);
    assert.equal(recovered, plain);
});

test('decryptString on plaintext (unencrypted legacy) returns it unchanged', async () => {
    enc.clearEncryptionKeyCache();
    const plain = 'not-encrypted-old-token';
    const result = await enc.decryptString(plain);
    assert.equal(result, plain);
});

test('encryptString with empty string returns empty string unchanged', async () => {
    enc.clearEncryptionKeyCache();
    assert.equal(await enc.encryptString(''), '');
});

test('decryptString with empty string returns empty string unchanged', async () => {
    enc.clearEncryptionKeyCache();
    assert.equal(await enc.decryptString(''), '');
});

test('decryptString with null returns null unchanged', async () => {
    enc.clearEncryptionKeyCache();
    assert.equal(await enc.decryptString(null), null);
});

test('decryptString on corrupted base64 returns the input (graceful fallback)', async () => {
    enc.clearEncryptionKeyCache();
    // Manually construct a BDEL-prefixed base64 that will fail GCM tag check
    const fakeEncrypted = Buffer.alloc(50);
    Buffer.from('BDEL').copy(fakeEncrypted, 0);
    fakeEncrypted[4] = 1; // version
    const b64 = fakeEncrypted.toString('base64');
    const result = await enc.decryptString(b64);
    // Falls back to returning the input
    assert.equal(result, b64);
});

// ─── 5. clearEncryptionKeyCache ───────────────────────────────────────────────

test('clearEncryptionKeyCache allows re-loading key on next call', async () => {
    enc.clearEncryptionKeyCache();
    const k1 = await enc.getEncryptionKey();
    assert.equal(k1.length, 32);
    enc.clearEncryptionKeyCache();
    // After clearing, getEncryptionKey must succeed and return a 32-byte key.
    const k2 = await enc.getEncryptionKey();
    assert.equal(k2.length, 32);
});

test('clearEncryptionKeyCache zeros the key buffer before clearing', async () => {
    enc.clearEncryptionKeyCache();
    const key = await enc.getEncryptionKey();
    const snapshot = Buffer.from(key); // copy before clear
    enc.clearEncryptionKeyCache();
    // The original buffer (key === _encKey) should now be zeroed
    assert.ok(key.every(b => b === 0), 'in-place buffer must be zeroed after clearEncryptionKeyCache');
    // The snapshot captured the real key bytes — must not be all zeros
    assert.ok(!snapshot.every(b => b === 0), 'snapshot must contain the pre-clear key bytes');
});

// ─── 6. Privacy — no plaintext in output ─────────────────────────────────────

test('encryptString output does not contain the plaintext', async () => {
    enc.clearEncryptionKeyCache();
    const secret = 'my-account-password';
    const encrypted = await enc.encryptString(secret);
    assert.ok(!encrypted.includes(secret), 'encrypted output must not contain the plaintext');
});

test('credential file starts with BDEL not a readable string', async () => {
    enc.clearEncryptionKeyCache();
    const buf = await enc.encryptBuffer(Buffer.from('user@example.com'));
    // First 4 bytes must be BDEL, not readable text from the secret
    assert.equal(buf.slice(0, 4).toString('ascii'), 'BDEL');
    assert.ok(!buf.toString('utf8').includes('user@example.com'));
});

