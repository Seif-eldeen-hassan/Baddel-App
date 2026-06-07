'use strict';

// AES-256-GCM encryption layer — extracted from accountsHandler.js so the
// crypto logic can be tested without pulling in all account-platform code.
//
// Key lifecycle:
//   1. First run: generate a random 256-bit key, store via keytar (Windows
//      Credential Manager / DPAPI — tied to the Windows user account).
//   2. Subsequent runs: load from Credential Manager into memory.
//   3. The raw key bytes are NEVER written to disk.
//
// Fallback when keytar is unavailable (non-Windows / missing native build):
//   Key is derived from userData path + salt via scrypt. Weaker, but functional.
//
// Binary format of every encrypted buffer:
//   [4 bytes: magic "BDEL"] [1 byte: version=1]
//   [12 bytes: IV] [16 bytes: authTag] [N bytes: ciphertext]

const crypto  = require('crypto');
const { app } = require('electron');

const ENCRYPT_MAGIC         = Buffer.from('BDEL');
const ENCRYPT_VERSION       = 1;
const KEYTAR_SERVICE        = 'baddel-account-switcher';
const KEYTAR_ACCOUNT        = 'master-encryption-key';
const ENCRYPT_SALT_FALLBACK = 'baddel-accounts-v1';

let _encKey    = null; // in-memory only — never written to disk
let _keytarLib = null; // lazy-loaded to survive missing native binary

function tryLoadKeytar() {
    if (_keytarLib !== null) return _keytarLib;
    try {
        _keytarLib = require('keytar');
    } catch {
        _keytarLib = undefined;
        console.warn('[ENCRYPT] keytar not available — falling back to scrypt key derivation. ' +
                     'Install keytar for Windows Credential Manager protection.');
    }
    return _keytarLib;
}

async function getEncryptionKey() {
    if (_encKey) return _encKey;

    const keytar = tryLoadKeytar();

    if (keytar) {
        try {
            let storedB64 = await keytar.getPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT);
            if (!storedB64) {
                // First run: generate a cryptographically random key and persist it.
                // keytar stores it via DPAPI — tied to the Windows user account.
                const newKey = crypto.randomBytes(32);
                await keytar.setPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT, newKey.toString('base64'));
                storedB64 = newKey.toString('base64');
                console.log('[ENCRYPT] New master key generated and stored in Windows Credential Manager.');
            }
            _encKey = Buffer.from(storedB64, 'base64');
            return _encKey;
        } catch (err) {
            console.error('[ENCRYPT] Credential Manager error, falling back to scrypt:', err.message);
        }
    }

    // Fallback: derive key from machine path + salt.
    const secret = app.getPath('userData') + ENCRYPT_SALT_FALLBACK;
    _encKey = crypto.scryptSync(secret, ENCRYPT_SALT_FALLBACK, 32);
    return _encKey;
}

// Zero-out and clear the in-memory key (call on app quit or for testing).
function clearEncryptionKeyCache() {
    if (_encKey) { _encKey.fill(0); _encKey = null; }
}

async function encryptBuffer(plainBuf) {
    const key = await getEncryptionKey();
    const iv  = crypto.randomBytes(12); // 96-bit IV for GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plainBuf), cipher.final()]);
    const authTag   = cipher.getAuthTag(); // 128-bit auth tag

    return Buffer.concat([
        ENCRYPT_MAGIC,
        Buffer.from([ENCRYPT_VERSION]),
        iv,
        authTag,
        encrypted,
    ]);
}

async function decryptBuffer(encBuf) {
    if (encBuf.length < 4 + 1 + 12 + 16) throw new Error('Encrypted file too short.');
    if (!encBuf.slice(0, 4).equals(ENCRYPT_MAGIC)) throw new Error('Not an encrypted baddel file.');
    if (encBuf[4] !== ENCRYPT_VERSION)             throw new Error('Unknown encryption version.');

    const iv         = encBuf.slice(5,  17);
    const authTag    = encBuf.slice(17, 33);
    const ciphertext = encBuf.slice(33);

    const key      = await getEncryptionKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// Returns true if a buffer starts with our magic header.
function isEncryptedFile(buf) {
    return buf.length >= 4 && buf.slice(0, 4).equals(ENCRYPT_MAGIC);
}

// Encrypt a UTF-8 string → base64 string (suitable for JSON fields).
async function encryptString(plainText) {
    if (!plainText) return plainText;
    const buf = await encryptBuffer(Buffer.from(plainText, 'utf8'));
    return buf.toString('base64');
}

// Decrypt a base64-encoded encrypted string back to plaintext.
// Returns the input unchanged if it is not an encrypted baddel buffer (legacy plaintext).
async function decryptString(encBase64) {
    if (!encBase64) return encBase64;
    try {
        const buf = Buffer.from(encBase64, 'base64');
        if (!isEncryptedFile(buf)) return encBase64;
        return (await decryptBuffer(buf)).toString('utf8');
    } catch {
        return encBase64; // fallback: return as-is if decryption fails
    }
}

module.exports = {
    ENCRYPT_MAGIC,
    ENCRYPT_VERSION,
    KEYTAR_SERVICE,
    KEYTAR_ACCOUNT,
    ENCRYPT_SALT_FALLBACK,
    tryLoadKeytar,
    getEncryptionKey,
    clearEncryptionKeyCache,
    encryptBuffer,
    decryptBuffer,
    isEncryptedFile,
    encryptString,
    decryptString,
};
