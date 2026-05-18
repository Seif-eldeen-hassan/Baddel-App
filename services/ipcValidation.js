'use strict';

// Maximum lengths for validated string types
const MAX_ID_LEN       = 64;
const MAX_STRING_LEN   = 2048;
const MAX_PATH_LEN     = 1024;

const VALID_PLATFORMS  = new Set(['steam', 'epic', 'ea', 'ubisoft', 'riot', 'discord', 'rockstar', 'xbox', 'gog', 'battlenet', 'amazon']);

// Regex for stable game IDs (MD5 hex or uuid-like short IDs from gameScanner)
const ID_RE = /^[a-zA-Z0-9_\-]{1,64}$/;

function _reject(code, msg) {
    const e = new Error(msg);
    e.code  = code;
    return e;
}

/**
 * Assert `v` is a non-empty string, optionally with max length.
 * Throws IPC_INVALID_ARG on failure.
 */
function assertString(v, name, max = MAX_STRING_LEN) {
    if (typeof v !== 'string' || !v.trim()) throw _reject('IPC_INVALID_ARG', `${name} must be a non-empty string`);
    if (v.length > max)                     throw _reject('IPC_INVALID_ARG', `${name} too long (max ${max})`);
    return v;
}

/**
 * Assert `v` is a safe game/collection ID (alphanumeric + _ -).
 */
function assertSafeId(v, name = 'id') {
    assertString(v, name, MAX_ID_LEN);
    if (!ID_RE.test(v)) throw _reject('IPC_INVALID_ARG', `${name} contains invalid characters`);
    return v;
}

/**
 * Assert `v` is an array where every element passes `assertString`.
 */
function assertArrayOfStrings(v, name, max = MAX_STRING_LEN) {
    if (!Array.isArray(v)) throw _reject('IPC_INVALID_ARG', `${name} must be an array`);
    v.forEach((el, i) => assertString(el, `${name}[${i}]`, max));
    return v;
}

/**
 * Assert `v` is a recognised platform identifier.
 */
function assertPlatform(v, name = 'platform') {
    assertString(v, name, 32);
    if (!VALID_PLATFORMS.has(v.toLowerCase())) throw _reject('IPC_INVALID_ARG', `Unknown platform: ${v}`);
    return v.toLowerCase();
}

/**
 * Assert `v` looks like a file path (string, reasonable length, no null bytes).
 * Does NOT check whether the path exists — use validateExecutablePath for that.
 */
function assertPathLike(v, name = 'path') {
    assertString(v, name, MAX_PATH_LEN);
    if (v.includes('\0')) throw _reject('IPC_INVALID_ARG', `${name} contains null bytes`);
    return v;
}

/**
 * Strip internal error details before sending to the renderer.
 * Returns a plain object safe to serialize over IPC.
 */
function sanitizeErrorForRenderer(err, fallback = 'An internal error occurred.') {
    return {
        status:  'error',
        message: err?.message || fallback,
        code:    err?.code    || undefined,
    };
}

module.exports = { assertString, assertSafeId, assertArrayOfStrings, assertPlatform, assertPathLike, sanitizeErrorForRenderer };
