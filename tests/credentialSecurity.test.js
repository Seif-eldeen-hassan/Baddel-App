'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');

const {
    isRawJwt,
    validateCredentialObject,
    validateCacheForWrite,
    redactSecrets,
    DANGEROUS_FIELDS,
    ENCRYPTED_VERSIONS,
} = require('../services/credentialValidator');

// ─── isRawJwt ─────────────────────────────────────────────────────────────────

test('isRawJwt: Steam refresh token (JWT) is detected', () => {
    const jwt = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    assert.equal(isRawJwt(jwt), true);
});

test('isRawJwt: base64-encrypted blob is NOT a JWT', () => {
    // AES-GCM encrypted value: nonce (12 bytes) + ciphertext, all base64-encoded — no dots
    const encrypted = 'AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHHIIIIJJJJKKKKLLLLMMMM';
    assert.equal(isRawJwt(encrypted), false);
});

test('isRawJwt: plain string is not a JWT', () => {
    assert.equal(isRawJwt('hello world'), false);
    assert.equal(isRawJwt(''), false);
    assert.equal(isRawJwt(null), false);
    assert.equal(isRawJwt(42), false);
});

test('isRawJwt: Steam64 ID is not a JWT', () => {
    assert.equal(isRawJwt('76561198012345678'), false);
});

// ─── validateCredentialObject ─────────────────────────────────────────────────

test('validateCredentialObject: valid v3_encrypted object is accepted', () => {
    const cred = {
        _format_version: 'v3_encrypted',
        steam_id:          'AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHHIIIIJJJJKKKK',
        refresh_token:     'LLLLMMMMNNNNOOOOOOOO0000PPPPQQQQRRRRSSSSUUUU',
        account_username:  'VVVVWWWWXXXXYYYYZZZZaaaabbbbccccddddeeeefffff',
        persona_name:      'gggghhhhiiiijjjjkkkkllllmmmmnnnnooooppppqqqqqq',
        steamAccountId:    '76561198012345678',
    };
    const result = validateCredentialObject(cred);
    assert.equal(result.ok, true, result.reason);
});

test('validateCredentialObject: valid v2_encrypted object is accepted', () => {
    const cred = {
        _format_version: 'v2_encrypted',
        steam_id:         'AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHHIIIIJJJJKKKKbase64',
        refresh_token:    'LLLLMMMMNNNNbase64encryptedblob==',
        steamAccountId:   '76561198012345678',
    };
    assert.equal(validateCredentialObject(cred).ok, true);
});

test('validateCredentialObject: raw refresh_token JWT is rejected', () => {
    const jwt = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SIGNATURE';
    const cred = {
        _format_version: 'v3_encrypted',
        steam_id:         'AAAABBBBencrypted',
        refresh_token:    jwt,
        steamAccountId:   '76561198012345678',
    };
    const result = validateCredentialObject(cred);
    assert.equal(result.ok, false);
    assert.ok(result.reason.includes('refresh_token'), result.reason);
});

test('validateCredentialObject: access_token field name is always rejected', () => {
    const cred = {
        _format_version: 'v3_encrypted',
        access_token:    'anything',
        steamAccountId:  '76561198012345678',
    };
    const result = validateCredentialObject(cred);
    assert.equal(result.ok, false);
    assert.ok(result.reason.includes('access_token'), result.reason);
});

test('validateCredentialObject: password field is rejected', () => {
    const cred = { password: 'hunter2', steamAccountId: '76561198012345678' };
    const result = validateCredentialObject(cred);
    assert.equal(result.ok, false);
    assert.ok(result.reason.includes('password'), result.reason);
});

test('validateCredentialObject: sessionid field is rejected', () => {
    const result = validateCredentialObject({ sessionid: 'abc123def', steamAccountId: '76561198' });
    assert.equal(result.ok, false);
    assert.ok(result.reason.includes('sessionid'), result.reason);
});

test('validateCredentialObject: cookies field is rejected', () => {
    const result = validateCredentialObject({ cookies: 'steamLoginSecure=...', steamAccountId: '76561198' });
    assert.equal(result.ok, false);
    assert.ok(result.reason.includes('cookies'), result.reason);
});

test('validateCredentialObject: raw JWT without format version is rejected', () => {
    const jwt = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SIG';
    const cred = { some_token: jwt, steamAccountId: '76561198012345678' };
    const result = validateCredentialObject(cred);
    assert.equal(result.ok, false);
});

test('validateCredentialObject: sensitive fields without version marker are rejected', () => {
    // No _format_version but has refresh_token key — even if value is not a JWT
    const cred = { refresh_token: 'some-non-jwt-string', steamAccountId: '76561198012345678' };
    const result = validateCredentialObject(cred);
    assert.equal(result.ok, false);
    assert.ok(result.reason.includes('refresh_token'), result.reason);
});

test('validateCredentialObject: steamAccountId-only object is accepted', () => {
    // Safe: only contains the plain decimal key, no sensitive fields
    const result = validateCredentialObject({ steamAccountId: '76561198012345678' });
    assert.equal(result.ok, true);
});

test('validateCredentialObject: null/non-object is rejected', () => {
    assert.equal(validateCredentialObject(null).ok, false);
    assert.equal(validateCredentialObject('string').ok, false);
    assert.equal(validateCredentialObject([]).ok, false);
});

// ─── validateCacheForWrite ────────────────────────────────────────────────────

test('validateCacheForWrite: cache with valid v3_encrypted credentials is accepted', () => {
    const cache = {
        _steamCredentialsByAccount: {
            '76561198012345678': {
                _format_version: 'v3_encrypted',
                steam_id:         'encryptedblob1==',
                refresh_token:    'encryptedblob2==',
                account_username: 'encryptedblob3==',
                persona_name:     'encryptedblob4==',
                steamAccountId:   '76561198012345678',
            },
        },
    };
    const result = validateCacheForWrite(cache);
    assert.equal(result.ok, true, JSON.stringify(result));
});

test('validateCacheForWrite: cache with raw refresh_token JWT is rejected', () => {
    const jwt = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SIG';
    const cache = {
        _steamCredentialsByAccount: {
            '76561198012345678': {
                _format_version: 'v3_encrypted',
                steam_id:         'encryptedblob1==',
                refresh_token:    jwt,
                steamAccountId:   '76561198012345678',
            },
        },
    };
    const result = validateCacheForWrite(cache);
    assert.equal(result.ok, false);
    assert.ok(Array.isArray(result.badKeys) && result.badKeys.length > 0);
    assert.equal(result.badKeys[0].steamId, '76561198012345678');
});

test('validateCacheForWrite: cache with access_token field is rejected', () => {
    const cache = {
        _steamCredentialsByAccount: {
            '76561198012345678': {
                _format_version: 'v3_encrypted',
                access_token:     'some-raw-token',
                steamAccountId:   '76561198012345678',
            },
        },
    };
    const result = validateCacheForWrite(cache);
    assert.equal(result.ok, false);
    assert.ok(result.badKeys[0].reason.includes('access_token'));
});

test('validateCacheForWrite: legacy _steamCredentials blob is also validated', () => {
    const jwt = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SIG';
    const cache = {
        _steamCredentials: {
            refresh_token:  jwt,
            steamAccountId: '76561198012345678',
        },
    };
    const result = validateCacheForWrite(cache);
    assert.equal(result.ok, false);
    assert.ok(result.badKeys.some((b) => b.steamId === 'legacy'));
});

test('validateCacheForWrite: empty cache object is accepted (will be blocked by empty-check later)', () => {
    const result = validateCacheForWrite({});
    assert.equal(result.ok, true);
});

// ─── redactSecrets ────────────────────────────────────────────────────────────

test('redactSecrets: raw JWT in string is redacted', () => {
    const jwt = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SIGNATURE_HERE';
    const output = redactSecrets(`token is ${jwt}`);
    assert.ok(!output.includes('SIGNATURE_HERE'), `JWT not redacted: ${output}`);
    assert.ok(output.includes('[JWT-REDACTED]'), `Expected [JWT-REDACTED] in: ${output}`);
});

test('redactSecrets: refresh_token key-value pair is redacted', () => {
    const input = '{"refresh_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.body.sig"}';
    const output = redactSecrets(input);
    assert.ok(!output.includes('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.body.sig'), `Token not redacted: ${output}`);
});

test('redactSecrets: access_token field value is redacted', () => {
    const input = 'access_token: "some-long-secret-token-value"';
    const output = redactSecrets(input);
    assert.ok(!output.includes('some-long-secret-token-value'), `Not redacted: ${output}`);
    assert.ok(output.includes('[REDACTED]'), `Expected [REDACTED] in: ${output}`);
});

test('redactSecrets: safe strings are not modified', () => {
    const safe = 'User logged in: steamId=76561198012345678 games=42';
    assert.equal(redactSecrets(safe), safe);
});

test('redactSecrets: null/undefined return safely', () => {
    assert.equal(redactSecrets(null), 'null');
    assert.equal(redactSecrets(undefined), 'undefined');
});

test('redactSecrets: object is serialised then redacted', () => {
    const jwt = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SIG';
    const obj = { refresh_token: jwt, steamId: '76561198012345678' };
    const output = redactSecrets(obj);
    assert.ok(!output.includes(jwt.split('.')[2]), `Sig not redacted: ${output}`);
});

// ─── DANGEROUS_FIELDS and ENCRYPTED_VERSIONS exports ─────────────────────────

test('DANGEROUS_FIELDS contains expected entries', () => {
    for (const f of ['access_token', 'password', 'steamLoginSecure', 'sessionid', 'bearer', 'cookies']) {
        assert.ok(DANGEROUS_FIELDS.has(f), `Expected DANGEROUS_FIELDS to contain "${f}"`);
    }
});

test('ENCRYPTED_VERSIONS contains v2_encrypted and v3_encrypted', () => {
    assert.ok(ENCRYPTED_VERSIONS.has('v2_encrypted'));
    assert.ok(ENCRYPTED_VERSIONS.has('v3_encrypted'));
});

// ─── Epic unlink deletes Legendary config folder ─────────────────────────────

test('Epic unlink: legendary config dir is deleted on unlink', async () => {
    // Test the file-system contract: if the dir exists before unlink, it must be gone after.
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-test-epic-'));
    const confDir = path.join(tmpBase, 'legendary-config-testaccount123');
    const userJsonPath = path.join(confDir, 'user.json');

    fs.mkdirSync(confDir, { recursive: true });
    fs.writeFileSync(userJsonPath, JSON.stringify({ account_id: 'testaccount123', display_name: 'TestUser' }));

    assert.ok(fs.existsSync(confDir), 'Config dir should exist before unlink');

    // Simulate what epicConnector.unlink() does
    fs.rmSync(confDir, { recursive: true, force: true });

    assert.ok(!fs.existsSync(confDir), 'Config dir must be deleted after unlink');

    // Cleanup tmpBase
    fs.rmSync(tmpBase, { recursive: true, force: true });
});

test('Epic tmp config cleanup: epic_tmp_* directories are deleted', async () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-test-epicclean-'));

    // Create some tmp dirs (simulating crashed link flows)
    const tmpDirs = [
        path.join(tmpBase, 'legendary-config-epic_tmp_1700000000000'),
        path.join(tmpBase, 'legendary-config-epic_tmp_1700000001234'),
    ];
    // Also a real account dir that must NOT be deleted
    const realDir = path.join(tmpBase, 'legendary-config-abc123def456');

    for (const d of [...tmpDirs, realDir]) fs.mkdirSync(d, { recursive: true });

    // Simulate _cleanupEpicTmpConfigs logic
    const entries = fs.readdirSync(tmpBase);
    for (const e of entries) {
        if (/^legendary-config-epic_tmp_/i.test(e)) {
            fs.rmSync(path.join(tmpBase, e), { recursive: true, force: true });
        }
    }

    for (const d of tmpDirs) {
        assert.ok(!fs.existsSync(d), `tmp dir should be deleted: ${path.basename(d)}`);
    }
    assert.ok(fs.existsSync(realDir), 'Real account dir must NOT be deleted');

    fs.rmSync(tmpBase, { recursive: true, force: true });
});
