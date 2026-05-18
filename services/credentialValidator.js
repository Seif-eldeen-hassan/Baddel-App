'use strict';

// ─── Field classification ─────────────────────────────────────────────────────

// Fields that must NEVER appear in stored credential blobs (raw or encrypted).
// If any of these keys are present, the credential object is rejected outright.
const DANGEROUS_FIELDS = new Set([
    'access_token', 'password', 'steamLoginSecure', 'sessionid',
    'bearer', 'cookies', 'exchange_code', 'authorizationCode', 'authCode',
]);

// Fields that contain JWTs when unencrypted — require an encrypted format version.
const SENSITIVE_JWT_FIELDS = new Set([
    'refresh_token', 'steam_id', 'account_username', 'persona_name',
]);

// Known encrypted format versions emitted by Python's SecureCredentialStorage.
const ENCRYPTED_VERSIONS = new Set(['v2_encrypted', 'v3_encrypted']);

// ─── JWT detection ───────────────────────────────────────────────────────────

/**
 * Returns true if the string looks like a raw JSON Web Token.
 * JWTs are three base64url segments separated by dots; first segment decodes
 * to a JSON object starting with {"alg" which base64url-encodes as "eyJ".
 */
function isRawJwt(value) {
    if (typeof value !== 'string') return false;
    return /^eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]*$/.test(value);
}

// ─── Credential object validation ────────────────────────────────────────────

/**
 * Validate a single credential object before it is stored to disk.
 * Returns `{ ok: true }` or `{ ok: false, reason: string }`.
 *
 * Rules:
 *  1. No DANGEROUS_FIELDS keys allowed (even if value is empty).
 *  2. If a known encrypted version is declared, sensitive values must not be raw JWTs.
 *  3. If no version is declared, any JWT-looking value causes rejection.
 *  4. SENSITIVE_JWT_FIELDS without an encryption version marker are rejected.
 */
function validateCredentialObject(creds) {
    if (!creds || typeof creds !== 'object' || Array.isArray(creds)) {
        return { ok: false, reason: 'not a plain object' };
    }

    const version = creds._format_version;

    for (const key of Object.keys(creds)) {
        if (DANGEROUS_FIELDS.has(key)) {
            return { ok: false, reason: `forbidden field "${key}" present` };
        }
    }

    if (version && ENCRYPTED_VERSIONS.has(version)) {
        // Format declares encryption — verify sensitive values are not raw JWTs
        for (const key of SENSITIVE_JWT_FIELDS) {
            const val = creds[key];
            if (val != null && isRawJwt(val)) {
                return { ok: false, reason: `encrypted credential has raw JWT in field "${key}"` };
            }
        }
        return { ok: true };
    }

    // No format version: any JWT value is plaintext
    for (const [key, val] of Object.entries(creds)) {
        if (key.startsWith('_')) continue;
        if (isRawJwt(val)) {
            return { ok: false, reason: `field "${key}" contains raw JWT (no encryption version)` };
        }
    }

    // Sensitive JWT fields present without an encryption marker → reject
    if (!version) {
        for (const key of SENSITIVE_JWT_FIELDS) {
            if (creds[key] != null) {
                return {
                    ok: false,
                    reason: `sensitive field "${key}" present with no _format_version encryption marker`,
                };
            }
        }
    }

    return { ok: true };
}

/**
 * Validate the full steam_bridge_cache structure before writing.
 * Returns `{ ok: true }` or `{ ok: false, reason, badKeys: Array<{steamId, reason}> }`.
 */
function validateCacheForWrite(cache) {
    if (!cache || typeof cache !== 'object') {
        return { ok: false, reason: 'cache is not an object', badKeys: [] };
    }

    const badKeys = [];

    const byAccount = cache._steamCredentialsByAccount || {};
    for (const [steamId, creds] of Object.entries(byAccount)) {
        const result = validateCredentialObject(creds);
        if (!result.ok) badKeys.push({ steamId, reason: result.reason });
    }

    if (cache._steamCredentials) {
        const result = validateCredentialObject(cache._steamCredentials);
        if (!result.ok) badKeys.push({ steamId: 'legacy', reason: result.reason });
    }

    return badKeys.length === 0
        ? { ok: true }
        : { ok: false, reason: 'plaintext credentials detected', badKeys };
}

// ─── Log redaction ────────────────────────────────────────────────────────────

const _REDACT_FIELD_NAMES = [
    'refresh_token', 'access_token', 'authorizationCode', 'authCode',
    'exchange_code', 'bearer', 'cookies', 'sessionid', 'steamLoginSecure', 'password',
];

// Matches JSON/object-style: "fieldName": "value"  or  fieldName="value"
const _FIELD_VALUE_PATTERN = new RegExp(
    '(' +
    _REDACT_FIELD_NAMES
        .map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|') +
    ')' +
    '(["\']?\\s*[=:]["\']?\\s*)' +
    '("[^"]{4,}"|\'[^\']{4,}\'|[^\\s,}"\']{8,})',
    'gi'
);

// Raw JWT pattern (standalone)
const _JWT_PATTERN = /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]*/g;

/**
 * Redact credential-like strings from a log message or object.
 * Pass a string, or anything JSON-serialisable. Returns a string.
 */
function redactSecrets(value) {
    if (value === null || value === undefined) return String(value);
    if (typeof value !== 'string') {
        try { value = JSON.stringify(value); } catch { return '[OBJECT]'; }
    }
    return value
        .replace(_JWT_PATTERN, (m) => m.substring(0, 8) + '...[JWT-REDACTED]')
        .replace(_FIELD_VALUE_PATTERN, (_, name, sep) => `${name}${sep}[REDACTED]`);
}

module.exports = {
    isRawJwt,
    validateCredentialObject,
    validateCacheForWrite,
    redactSecrets,
    DANGEROUS_FIELDS,
    SENSITIVE_JWT_FIELDS,
    ENCRYPTED_VERSIONS,
};
