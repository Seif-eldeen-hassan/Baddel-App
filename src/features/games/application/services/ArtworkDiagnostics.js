'use strict';

;(function () {
const root = typeof window !== 'undefined' ? window : globalThis;

function shortHash(value) {
    const text = String(value || '');
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

function sourceClass(value) {
    const text = String(value || '').trim().toLowerCase();
    if (!text) return 'empty';
    if (text.startsWith('file://')) return text.includes('artwork-cache-v2') ? 'managed-cache' : 'local-file';
    if (text.startsWith('https://')) return 'remote-https';
    if (text.startsWith('http://')) return 'remote-http';
    if (text.startsWith('data:image/')) return 'data-image';
    return 'opaque';
}

function enabled() {
    if (root?.__BADDEL_ARTWORK_DIAGNOSTICS__ === true) return true;
    try { return root?.localStorage?.getItem('baddel.artworkDiagnostics') === '1'; } catch { return false; }
}

function sanitize(payload = {}) {
    const out = {};
    for (const [key, value] of Object.entries(payload || {})) {
        if (value == null || typeof value === 'boolean' || typeof value === 'number') { out[key] = value; continue; }
        if (['provider', 'type', 'stage', 'reason', 'rejectionReason', 'aliasName', 'availability', 'operationId'].includes(key)) {
            out[key] = String(value).slice(0, 160);
            continue;
        }
        if (/identity|gameId|displayId|canonical|asset|alias|sourceValue|value|url|path/i.test(key)) {
            out[`${key}Hash`] = shortHash(value);
            if (/value|url|path/i.test(key)) out[`${key}Class`] = sourceClass(value);
            continue;
        }
        if (Array.isArray(value)) {
            out[key] = value.slice(0, 30).map(item => String(item).slice(0, 80));
            continue;
        }
        // Never serialize arbitrary records into diagnostics. Unknown objects can
        // contain account data, source URLs, launch commands, or user paths.
        if (typeof value === 'object') { out[key] = '[object omitted]'; continue; }
        out[key] = typeof value === 'string' ? value.slice(0, 160) : value;
    }
    return out;
}

function record(stage, payload = {}) {
    if (!enabled()) return null;
    const event = Object.freeze({ stage: String(stage || 'unknown'), at: Date.now(), ...sanitize(payload) });
    try {
        const list = root.__baddelArtworkDiagnosticsEvents || (root.__baddelArtworkDiagnosticsEvents = []);
        list.push(event);
        if (list.length > 1000) list.splice(0, list.length - 1000);
        root.console?.info?.('[ArtworkDiagnostic]', event);
    } catch (_) {}
    return event;
}

const api = { shortHash, sourceClass, sanitize, enabled, record };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (root) root.BaddelArtworkDiagnostics = api;
}());
