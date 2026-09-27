'use strict';

/**
 * services/baddelApi.js
 *
 * Client-side wrapper for the Baddel Metadata Server.
 * Used by both platformSync.js and game-details.js (via main.js IPC).
 *
 * SECURITY NOTE: This launcher is a public client. It MUST NOT:
 *   - Ship or read BADDEL_API_SECRET / BADDEL_API_KEY
 *   - Call /games/import or /games/enrich* (admin-only endpoints)
 *
 * Safe endpoints used by this module:
 *   GET  /games/lookup          � public, no auth required
 *   POST /client/request-enrich � low-trust, rate-limited, no secret required
 */

const BASE_URL = (
    process.env.BADDEL_API_URL ||
    'https://baddelmetadata.spaincentral.cloudapp.azure.com'
).replace(/\/+$/, '');

const QUIET_LOGS = process.env.BADDEL_QUIET_LOGS === '1';
const VERBOSE_LOGS = process.env.BADDEL_VERBOSE_LOGS === '1';

// Throttle: suppress repeat log messages for the same key within 60 s.
const _logThrottle = new Map();
function _throttledWarn(key, ...args) {
    if (!QUIET_LOGS) { console.warn(...args); return; }
    const now = Date.now();
    if ((now - (_logThrottle.get(key) || 0)) >= 60_000) {
        _logThrottle.set(key, now);
        console.warn(...args);
    }
}
function _quietLog(...args) { if (VERBOSE_LOGS && !QUIET_LOGS) console.log(...args); }
function _normalLog(...args) { if (!QUIET_LOGS) console.log(...args); }

// Optional install-id for lightweight analytics / rate-limit bucketing.
// Not a secret � just identifies this install, not a user.
const _installId = (() => {
    try {
        const { app } = require('electron');
        const path = require('path');
        const fs   = require('fs');
        const idFile = path.join(app.getPath('userData'), '.baddel_install_id');
        if (fs.existsSync(idFile)) return fs.readFileSync(idFile, 'utf8').trim();
        const { randomUUID } = require('crypto');
        const id = randomUUID();
        fs.writeFileSync(idFile, id, 'utf8');
        return id;
    } catch { return 'unknown'; }
})();

// App version for server telemetry � not a secret.
// Mirrors the pattern used by _installId above.
const _appVersion = (() => {
    try { return require('electron').app.getVersion(); }
    catch { return 'unknown'; }
})();

/**
 * Richer HTTP error thrown by apiFetch.
 * Preserves the status code and the real Retry-After header value so
 * EnrichQueue can honour rate-limit signals from the server directly,
 * without parsing an error message string.
 */
class ApiError extends Error {
    constructor(path, status, retryAfter = null) {
        super(`Baddel API ${path} ? HTTP ${status}`);
        this.name       = 'ApiError';
        this.status     = status;
        this.retryAfter = retryAfter;  // string seconds e.g. "30", or null
    }
}

// -- Global 429 cooldown ------------------------------------------------------
// When the server rate-limits us, every additional request EXTENDS the lockout
// window. This causes a cascade where one rate-limited game makes every
// subsequent game also fail until the user restarts. Once a 429 lands here,
// short-circuit all further requests (synthetic 429) until the Retry-After
// window expires � so the server's window can actually close.
const _DEFAULT_COOLDOWN_MS = 60_000;
const _baddelApiCooldowns = new Map();

function _cooldownBucketForPath(path = '') {
    const p = String(path || '');

    if (p.startsWith('/games/lookup')) return 'lookup';
    if (p.startsWith('/client/request-enrich/batch')) return 'enrich-batch';
    if (p.startsWith('/client/request-enrich')) return 'enrich-single';
    if (p.startsWith('/client/resolve-metadata')) return 'resolve-metadata';

    return 'general';
}

function _setCooldownFromRetryAfter(path, retryAfter) {
    const sec = parseInt(retryAfter ?? '', 10);
    const waitMs = (!isNaN(sec) && sec > 0) ? sec * 1000 : _DEFAULT_COOLDOWN_MS;
    const until = Date.now() + waitMs;
    const bucket = _cooldownBucketForPath(path);

    const prev = _baddelApiCooldowns.get(bucket) || 0;

    if (until > prev) {
        _baddelApiCooldowns.set(bucket, until);
        console.warn(
            `[BaddelAPI] 429 cooldown bucket=${bucket} for ${Math.round(waitMs / 1000)}s until ${new Date(until).toISOString()}`
        );
    }
}

function _isCoolingDown(path = '') {
    const bucket = _cooldownBucketForPath(path);
    return Date.now() < (_baddelApiCooldowns.get(bucket) || 0);
}

function isCooldownActive(path = '') {
    return _isCoolingDown(path);
}

async function apiFetch(path, options = {}) {
    if (_isCoolingDown(path)) {
        const bucket = _cooldownBucketForPath(path);
        const until = _baddelApiCooldowns.get(bucket) || Date.now();
        throw new ApiError(
            path,
            429,
            Math.ceil((until - Date.now()) / 1000).toString()
        );
    }
    const res = await fetch(`${BASE_URL}${path}`, {
        headers: {
            'Content-Type': 'application/json',
            'X-Baddel-Install-Id': _installId,
            ...options.headers,
        },
        ...options,
    });
    if (!res.ok) {
        const retryAfter = res.headers?.get('Retry-After') ?? null;
        if (res.status === 429) _setCooldownFromRetryAfter(path, retryAfter);
        throw new ApiError(path, res.status, retryAfter);
    }
    return res.json();
}

// --- Lookup -------------------------------------------------------------------

/**
 * Look up a game already in the DB.
 * Returns full game data or null if not found.
 *
 * @param {{ platform: string, id: string } | { slug: string } | { uuid: string }} query
 */
async function lookupGame(query) {
    try {
        const params = new URLSearchParams();
        if (query.uuid)    params.set('uuid', query.uuid);
        if (query.slug)    params.set('slug', query.slug);
        if (query.title)   params.set('title', query.title);
        if (query.platform && query.id) {
            const rawId = String(query.id);
            const cleanId = rawId.startsWith(`${query.platform}_`)
                ? rawId.slice(query.platform.length + 1)
                : rawId;
            params.set('platform', query.platform);
            params.set('namespace', query.platform === 'steam' ? 'app_id' : 'catalog_namespace');
            params.set('id', cleanId);
        }

        const url = `/games/lookup?${params}`;
        const data = await apiFetch(url);

        return data.status === 'success' ? data.data : null;
    } catch (err) {
        // 404 means the game doesn't exist under this key.
        if (err?.status === 404 || String(err?.message || '').includes('HTTP 404')) {
            return null;
        }

        // Anything else (429 / timeout / network / cooldown) is a transient
        // failure � must not collapse into "No metadata".
        _throttledWarn(
            "lookup-fail",
            '[BaddelAPI] lookup temporary failure:',
            err?.message || err,
            'for query:',
            query
        );

        throw err;
    }
}

// --- Client-safe Enrich Request -----------------------------------------------

/**
 * Raw single-shot enrich request (no retry, no queue).
 * Throws on HTTP error so callers can inspect the status code.
 *
 * @param {string} platform
 * @param {string} id
 * @param {string} [title]
 * @returns {Promise<{ status: string }>}
 */
async function _rawRequestGameEnrich(platform, id, title) {
    const body = { platform, id };
    if (title) body.title = title;
    return apiFetch('/client/request-enrich', {
        method: 'POST',
        body: JSON.stringify(body),
    });
}

/**
 * Ask the server to enrich a game � simple wrapper kept for
 * one-off callers outside of a sync pass.
 *
 * For sync passes use requestGameEnrichBatch() instead.
 *
 * @param {string} platform  - 'steam' | 'epic'
 * @param {string} id        - platform-specific game id
 * @param {string} [title]   - human-readable title hint
 * @returns {Promise<{ status: string } | null>}
 */
async function requestGameEnrich(platform, id, title) {
    try {
        return await _rawRequestGameEnrich(platform, id, title);
    } catch (err) {
        _throttledWarn(`enrich-fail-${platform}-${id}`, '[BaddelAPI] requestGameEnrich failed:', err.message);
        return null;
    }
}

// --- Transient Resolver (non-Steam/Epic) -------------------------------------

/**
 * POST /client/resolve-metadata
 *
 * Server-side transient resolver for non-Steam/non-Epic games.
 * The server owns IGDB + SteamGridDB confidence scoring and returns one of:
 *   { status: 'resolved',   data: { ...gameFields } }
 *   { status: 'ambiguous',  candidates: [...] }
 *   { status: 'not_found' }
 *
 * This is a read-only, no-DB-write endpoint � safe for public low-trust clients.
 * Never call this for Steam or Epic games; use lookupGame() + requestGameEnrich() instead.
 *
 * @param {{ title: string, slug?: string, platform?: string, hints?: object }} hints
 * @returns {Promise<{ status: 'resolved'|'ambiguous'|'not_found', data?: object } | null>}
 */
async function resolveMetadata(hints) {
    try {
        _quietLog(`[BaddelAPI] resolveMetadata ? POST /client/resolve-metadata`, JSON.stringify(hints));

        // Honor the shared 429 cooldown set by apiFetch � synthesise a 429
        // ApiError so callers' existing rate-limit handling fires without
        // hitting the network and extending the server's lockout window.
        const _RM_PATH = '/client/resolve-metadata';
        if (_isCoolingDown(_RM_PATH)) {
            const bucket   = _cooldownBucketForPath(_RM_PATH);
            const coolUntil = _baddelApiCooldowns.get(bucket) || Date.now();
            const retrySec  = Math.ceil((coolUntil - Date.now()) / 1000).toString();
            throw new ApiError(_RM_PATH, 429, retrySec);
        }

        // Do NOT use apiFetch() here � we need to inspect non-2xx bodies ourselves.
        // The server returns a valid JSON body on 404 (not_found), but apiFetch()
        // throws ApiError before we can read it.
        const res = await fetch(`${BASE_URL}/client/resolve-metadata`, {
            method: 'POST',
            headers: {
                'Content-Type':         'application/json',
                'X-Baddel-Install-Id':  _installId,
                'X-Baddel-App-Version': _appVersion,
            },
            body: JSON.stringify(hints),
        });

        // Always try to parse the body � even on error statuses
        let result = null;
        try {
            result = await res.json();
        } catch (parseErr) {
            console.warn(`[BaddelAPI] resolveMetadata ? HTTP ${res.status}: body is not JSON � parse error: ${parseErr.message}`);
        }

        if (!res.ok) {
            const retryAfter = res.headers?.get('Retry-After') ?? null;

            // Log the raw body so we can distinguish a valid not_found JSON from
            // a true route-level 404 (which would have an HTML or empty body).
            console.warn(
                `[BaddelAPI] resolveMetadata ? HTTP ${res.status}` +
                (retryAfter ? ` (Retry-After: ${retryAfter}s)` : '') +
                ` � raw body: ${JSON.stringify(result)}`
            );

            // HTTP 404 with a valid structured body from the server ? return as-is.
            // The server previously sent 404 for not_found; treat any JSON with a
            // recognisable status field as a structured result rather than an error.
            if (res.status === 404 && result && typeof result.status === 'string') {
                _quietLog(`[BaddelAPI] resolveMetadata: 404 has structured body � returning status="${result.status}" directly`);
                return result;
            }

            // Rate-limited or other hard server error � throw so callers know
            if (res.status === 429) _setCooldownFromRetryAfter('/client/resolve-metadata', retryAfter);
            throw new ApiError('/client/resolve-metadata', res.status, retryAfter);
        }

        const resolvedTitle = result?.meta?.title || result?.data?.title || null;
        _quietLog(`[BaddelAPI] resolveMetadata ? status="${result?.status}"`, result?.status === 'resolved' ? `title="${resolvedTitle}"` : '');
        return result;
    } catch (err) {
        // Re-throw ApiError so callers can inspect .status and .retryAfter.
        // This is critical for 429 handling: the Xbox scanner must see the
        // rate-limit signal to defer candidates instead of dropping them.
        if (err && err.name === 'ApiError') {
            console.warn(`[BaddelAPI] resolveMetadata failed (HTTP ${err.status}):`, err.message);
            throw err;
        }
        // Non-API errors (network, parse) � log and re-throw so callers
        // can apply the same deferred-keep logic as for rate limits.
        console.warn('[BaddelAPI] resolveMetadata network/parse error:', err.message);
        throw err;
    }
}

// --- Batch Enrich Request -----------------------------------------------------

/**
 * Send a batch of games to POST /client/request-enrich/batch.
 *
 * Security: public client path � no secret, uses X-Baddel-Install-Id only.
 * HTTP 207 Multi-Status is treated as success (partial results are normal).
 * HTTP 429 triggers an ApiError with retryAfter populated from the header.
 *
 * @param {string} platform  - 'steam' | 'epic'
 * @param {{ id: string, title?: string }[]} games  - max 200 per call (server enforced)
 * @returns {Promise<{
 *   acceptedCount:      number,
 *   queuedCount:        number,
 *   alreadyQueuedCount: number,
 *   alreadyExistsCount: number,
 *   invalidCount:       number,
 *   errorCount:         number,
 *   dedupCount:         number,
 *   maxBatchSize:       number,
 *   results:            Array<{ id: string, status: string, reason?: string }>,
 * }>}
 */
async function requestGameEnrichBatch(platform, games) {
    const res = await fetch(`${BASE_URL}/client/request-enrich/batch`, {
        method: 'POST',
        headers: {
            'Content-Type':          'application/json',
            'X-Baddel-Install-Id':   _installId,
            'X-Baddel-App-Version':  _appVersion,
        },
        body: JSON.stringify({ platform, games }),
    });

    // 207 Multi-Status = partial success � treat as OK
    if (res.status === 207 || res.ok) {
        return res.json();
    }

    const retryAfter = res.headers?.get('Retry-After') ?? null;
    throw new ApiError('/client/request-enrich/batch', res.status, retryAfter);
}

// --- EnrichQueue --------------------------------------------------------------

/**
 * Rate-limit-aware, deduplicating, throttled queue for POST /client/request-enrich.
 *
 * Behaviour:
 *  - Deduplicates by `${platform}:${id}` so the same game is never sent twice
 *    within one queue instance / sync pass.
 *  - Caps concurrency (default 2 in-flight at once).
 *  - On HTTP 429: reads `Retry-After` header if present, otherwise uses
 *    exponential backoff with jitter (base 10 s, cap 120 s).
 *  - Retries up to `maxRetries` times (default 4) before marking as deferred.
 *  - Never throws � collects per-item outcomes into a summary.
 *
 * Usage:
 *   const q = new EnrichQueue({ concurrency: 2 });
 *   q.enqueue('epic', 'someNamespace', 'Game Title');
 *   // � enqueue more �
 *   const summary = await q.drain();
 *   // { queued, skippedDuplicate, rateLimited, failed }
 */
class EnrichQueue {
    /**
     * @param {{ concurrency?: number, maxRetries?: number }} [opts]
     */
    constructor({ concurrency = 2, maxRetries = 4 } = {}) {
        this._concurrency = Math.max(1, concurrency);
        this._maxRetries  = Math.max(0, maxRetries);

        /** @type {Array<{ platform:string, id:string, title?:string }>} */
        this._pending = [];
        this._seen    = new Set();   // dedup key ? already enqueued

        // Counters
        this.queued           = 0;  // successfully accepted by server
        this.skippedDuplicate = 0;  // deduped before hitting the wire
        this.rateLimited      = 0;  // gave up after max retries on 429
        this.failed           = 0;  // other permanent errors

        this._drainPromise = null;
    }

    /**
     * Add a game to the queue.
     * Returns false if it was a duplicate (already enqueued this pass).
     *
     * @param {string} platform
     * @param {string} id
     * @param {string} [title]
     * @returns {boolean}
     */
    enqueue(platform, id, title) {
        const key = `${platform}:${id}`;
        if (this._seen.has(key)) {
            this.skippedDuplicate++;
            _quietLog(`[EnrichQueue] skip duplicate  ${platform} ${id}`);
            return false;
        }
        this._seen.add(key);
        this._pending.push({ platform, id, title });
        _quietLog(`[EnrichQueue] enqueued        ${platform} ${id}${title ? ` "${title}"` : ''}`);
        return true;
    }

    /**
     * Process all pending items with capped concurrency.
     * Resolves when the queue is empty.
     *
     * @returns {Promise<{ queued:number, skippedDuplicate:number, rateLimited:number, failed:number }>}
     */
    async drain() {
        if (this._drainPromise) return this._drainPromise;

        this._drainPromise = (async () => {
            const items = this._pending.splice(0);
            if (items.length === 0) return this._summary();

            _quietLog(`[EnrichQueue] starting drain � ${items.length} items, concurrency=${this._concurrency}`);

            let cursor = 0;
            const worker = async () => {
                while (cursor < items.length) {
                    const item = items[cursor++];
                    await this._process(item);
                }
            };

            await Promise.all(
                Array.from({ length: Math.min(this._concurrency, items.length) }, () => worker())
            );

            const s = this._summary();
            if (VERBOSE_LOGS || s.rateLimited > 0 || s.failed > 0) {
                _normalLog(
                    `[EnrichQueue] Summary queued:${s.queued} duplicate:${s.skippedDuplicate} ` +
                    `rateLimited:${s.rateLimited} failed:${s.failed}`
                );
            }
            return s;
        })();

        return this._drainPromise;
    }

    _summary() {
        return {
            queued:           this.queued,
            skippedDuplicate: this.skippedDuplicate,
            rateLimited:      this.rateLimited,
            failed:           this.failed,
        };
    }

    /**
     * Send one item, with retry/backoff on 429.
     * Never rejects.
     */
    async _process({ platform, id, title }) {
        const tag = `${platform} ${id}`;
        let attempt = 0;

        while (attempt <= this._maxRetries) {
            try {
                await _rawRequestGameEnrich(platform, id, title);
                this.queued++;
                _quietLog(`[EnrichQueue] ? queued        ${tag}`);
                return;
            } catch (err) {
                const is429 = err && err.status === 429;

                if (!is429) {
                    this.failed++;
                    _throttledWarn(tag, `[EnrichQueue] ? failed (perm) ${tag} � ${err.message}`);
                    return;
                }

                // 429 � compute back-off
                attempt++;
                if (attempt > this._maxRetries) {
                    this.rateLimited++;
                    _throttledWarn(tag, `[EnrichQueue] ? rate-limited  ${tag} � giving up after ${this._maxRetries} retries`);
                    return;
                }

                const retryAfterMs = this._retryAfterMs(err, attempt);
                _quietLog(
                    `[EnrichQueue] 429 retry ${attempt}/${this._maxRetries} ${tag} ` +
                    `waiting ${Math.round(retryAfterMs / 1000)}s`
                );
                await this._sleep(retryAfterMs);
            }
        }
    }

    /**
     * Parse `Retry-After` from error message if present, otherwise
     * exponential back-off: base 10 s � 2^attempt + �20 % jitter, capped at 120 s.
     *
     * @param {Error} err
     * @param {number} attempt  1-based retry attempt number
     */
    _retryAfterMs(err, attempt = 1) {
        // Prefer the real Retry-After header value preserved on ApiError.
        // This is the authoritative path when the server sends the header.
        if (err && err.retryAfter != null) {
            const seconds = parseInt(err.retryAfter, 10);
            if (!isNaN(seconds) && seconds > 0 && seconds < 600) return seconds * 1000;
        }
        // Exponential back-off with �20 % jitter.
        // attempt is 1-based: attempt=1 ? 10 s, attempt=2 ? 20 s, attempt=3 ? 40 s �
        const base   = 10_000;
        const exp    = Math.min(base * Math.pow(2, attempt - 1), 120_000);
        const jitter = exp * (0.8 + Math.random() * 0.4);
        return Math.round(jitter);
    }

    _sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }
}

/**
 * Convenience factory � creates a fresh EnrichQueue for a sync pass.
 * Export gives platformSync.js a clean import surface.
 *
 * @param {{ concurrency?: number, maxRetries?: number }} [opts]
 * @returns {EnrichQueue}
 */
function createEnrichQueue(opts) {
    return new EnrichQueue(opts);
}

// --- Normalize server response to app format ----------------------------------

/**
 * Safely parse a genres value that may arrive in multiple shapes:
 *   - JS array of strings:   ["Action", "RPG"]
 *   - JS array of objects:   [{ name: "Action" }]
 *   - Postgres array literal: "{Action,RPG}"  or  "{}"
 *   - JSON string:            '["Action","RPG"]'
 *   - null / undefined
 */
function _parseGenres(raw) {
    if (!raw) return [];
    // Already a proper JS array
    if (Array.isArray(raw)) {
        return raw.map(g => (typeof g === 'string' ? g : g?.name || '')).filter(Boolean);
    }
    if (typeof raw === 'string') {
        // Postgres array literal: "{Action,RPG}" or "{}"
        if (raw.startsWith('{') && raw.endsWith('}')) {
            const inner = raw.slice(1, -1).trim();
            if (!inner) return [];
            // Split on commas not inside quotes, strip surrounding quotes
            return inner.split(',')
                .map(s => s.trim().replace(/^"(.*)"$/, '$1'))
                .filter(Boolean);
        }
        // JSON array string
        if (raw.startsWith('[')) {
            try {
                const parsed = JSON.parse(raw);
                return Array.isArray(parsed)
                    ? parsed.map(g => (typeof g === 'string' ? g : g?.name || '')).filter(Boolean)
                    : [];
            } catch { return []; }
        }
    }
    return [];
}

function normalizeServerData(serverGame) {
    if (!serverGame) return null;
    const images   = serverGame.images   || [];
    const media    = serverGame.media    || [];
    const ratings  = serverGame.ratings  || [];
    const metadata = serverGame.metadata || [];
    const sysreqs  = serverGame.system_requirements || [];

    // -- Diagnostic: log metadata array shape so we can see what we're working with --
    _quietLog(`[BaddelAPI] normalizeServerData: "${serverGame.title}" | metadata rows: ${metadata.length} | sources: [${metadata.map(m => m.source).join(', ')}]`);
    if (metadata.length > 0) {
        metadata.forEach((m, i) => {
            _quietLog(`[BaddelAPI]   metadata[${i}] source=${m.source} | desc=${!!m.description} (${String(m.description||'').slice(0,60)}) | dev=${m.developer||'�'} | genres type=${typeof m.genres} val=${JSON.stringify(m.genres)}`);
        });
    }

    const pick = (type) => {
        const img = images.find(i => i.image_type === type);
        return img ? (img.cdn_url || img.url) : null;
    };
    const cover = pick('cover');
    const hero  = pick('hero');
    const logo  = pick('logo');

    const imageTypes = images.map(i => i.image_type).filter(Boolean);
    _quietLog(
        `[BaddelAPI] normalizeServerData images for "${serverGame.title}": [${imageTypes.join(', ')}] ` +
        `? cover=${!!cover} hero=${!!hero} logo=${!!logo}`
    );
    if (imageTypes.includes('hero') && !hero) {
        console.warn(`[BaddelAPI] normalizeServerData: image_type=hero present but pick() returned null for "${serverGame.title}" � check cdn_url/url fields`);
    }
    const screenshots = images
        .filter(i => i.image_type === 'screenshot')
        .sort((a, b) => a.sort_order - b.sort_order)
        .map(i => i.cdn_url || i.url);
    const allTrailers = media
        .filter(m => m.media_type === 'trailer')
        .sort((a, b) => a.sort_order - b.sort_order)
        .map(m => ({
            name:     m.title || '',
            url:      m.url,
            thumbUrl: m.thumbnail_url || null,
            isVideo:  !m.url.includes('youtube'),
        }));
    const igdbRating  = ratings.find(r => r.source === 'igdb' || r.source === 'igdb_users');
    const epicRating  = ratings.find(r => r.source === 'epic');
    const steamRating = ratings.find(r => r.source === 'steam');

    // Prefer igdb metadata (richest), then epic, then first available
    const preferredSource =
    serverGame.platform_ids?.some(p => p.platform === 'steam') ? 'steam' :
    serverGame.platform_ids?.some(p => p.platform === 'epic')  ? 'epic'  :
    'igdb';

    const meta =
        metadata.find(m => m.source === preferredSource) ||
        metadata.find(m => m.source === 'steam') ||
        metadata.find(m => m.source === 'epic')  ||
        metadata.find(m => m.source === 'igdb')  ||
        metadata[0] || {};

    _quietLog(`[BaddelAPI]   chosen metadata source: "${meta.source || '(none)'}" | has desc: ${!!meta.description} | has dev: ${!!meta.developer}`);

    const requirements = sysreqs.length > 0 ? sysreqs : null;
    const sources = {
        cover: cover ? (images.find(i => i.image_type === 'cover')?.source || 'server') : null,
        hero:  hero  ? (images.find(i => i.image_type === 'hero')?.source  || 'server') : null,
        logo:  logo  ? (images.find(i => i.image_type === 'logo')?.source  || 'server') : null,
        text:  meta.source || (serverGame.description || serverGame.developer ? 'server' : null),
    };
    const filledFields = Object.values(sources).filter(Boolean).length;
    const confidence   = Math.round((filledFields / 4) * 100);
    const developer = meta.developer || serverGame.developer || null;
    const publisher = meta.publisher || serverGame.publisher || null;
    const description = meta.description || serverGame.description || null;
    const short_description = meta.short_description || serverGame.short_description || null;

    // Use robust parser � Postgres may return genres as "{Action,RPG}" array literal string
    const genres = _parseGenres(meta.genres) || _parseGenres(serverGame.genres) || [];

    _quietLog(`[BaddelAPI] normalizeServerData: "${serverGame.title}" cover=${!!cover} hero=${!!hero} desc=${!!description} genres=${genres.length}`);
    return {
        cover,
        heroImage: hero,
        logo,
        ratings,
        info: {
            description,
            short_description,
            genres,
            developer,
            publisher,
            releaseDate: serverGame.release_year ? String(serverGame.release_year) : null,
            rating: igdbRating?.score || null,
            ratingSource: igdbRating?.source || null,
            steamReview: steamRating ? {
                scorePercent:    steamRating.score,
                reviewScoreDesc: _steamScoreLabel(steamRating.score),
                totalReviews:    steamRating.total_reviews,
                totalPositive:   steamRating.positive_count,
                totalNegative:   steamRating.negative_count,
            } : null,
            screenshots,
            artworks: [],
            allTrailers,
            trailer: allTrailers[0]?.url || null,
            isDirectVideo: allTrailers[0] ? !allTrailers[0].url.includes('youtube') : false,
            requirements: requirements ? _normalizeRequirements(requirements) : null,
        },
        quality: { confidence, sources },
        _serverData: serverGame,
    };
}

function _steamScoreLabel(score) {
    if (!score) return 'No Reviews';
    if (score >= 95) return 'Overwhelmingly Positive';
    if (score >= 80) return 'Very Positive';
    if (score >= 70) return 'Mostly Positive';
    if (score >= 40) return 'Mixed';
    if (score >= 20) return 'Mostly Negative';
    return 'Overwhelmingly Negative';
}

function _normalizeRequirements(sysreqs) {
    const result = {};
    for (const r of sysreqs) {
        const key = r.platform;
        if (!result[key]) result[key] = {};
        result[key][r.tier] = {
            os:      r.os_versions,
            cpu:     r.cpu,
            gpu:     r.gpu,
            ram:     r.ram,
            storage: r.storage,
            directx: r.directx,
            notes:   r.notes,
        };
    }
    return result;
}

// --- Deprecated stubs � kept for temporary compatibility only -----------------
// These wrappers log a warning and internally use the safe flow.
// They will be removed in the next cleanup pass.

// -- Shared module-level queue for importGames() --------------------------------
// The old implementation created a NEW EnrichQueue on every importGames() call
// and called drain() immediately.  platformSync.js calls importGames() once per
// platform per sync pass � so two concurrent calls (steam + epic) each spawned
// their own queue, each one re-draining the FULL game list independently.
// Result: 2 � N request-enrich calls at startup, instant 429 storm.
//
// Fix: one shared queue + one shared drain timer.  All importGames() calls
// within a 200 ms window are merged into the same queue and drained once.
// Subsequent calls are deduped by the queue's own _seen set.
let _sharedImportQueue = null;
let _sharedImportDrainTimer = null;

function _getSharedImportQueue() {
    if (!_sharedImportQueue) {
        _sharedImportQueue = new EnrichQueue({ concurrency: 2, maxRetries: 4 });
    }
    return _sharedImportQueue;
}

/** @deprecated Use createEnrichQueue() + EnrichQueue.enqueue() instead */
async function importGames(platform, games) {
    _quietLog('[BaddelAPI] importGames() is deprecated. Migrating callers to EnrichQueue.');
    const q = _getSharedImportQueue();
    for (const g of games || []) {
        const id = platform === 'steam' ? (g.id || g.appid) : (g.id || g.namespace);
        if (id) q.enqueue(platform, String(id), g.title || null);
    }

    // Debounce: wait 200 ms for any other concurrent importGames() calls to add
    // their items before we start draining.  If a drain is already in progress
    // the new items will be silently deduped by _seen and the existing drain
    // will pick them up in the next cycle automatically.
    if (_sharedImportDrainTimer) clearTimeout(_sharedImportDrainTimer);
    const summary = await new Promise(resolve => {
        _sharedImportDrainTimer = setTimeout(async () => {
            _sharedImportDrainTimer = null;
            const result = await q.drain();
            // Reset so the next sync pass gets a clean queue (fresh _seen set).
            _sharedImportQueue = null;
            resolve(result);
        }, 200);
    });

    return {
        found:   [],
        pending: [],
        summary: {
            total:   (games || []).length,
            found:   0,
            pending: summary.queued,
            skippedDuplicate: summary.skippedDuplicate,
            rateLimited: summary.rateLimited,
            failed: summary.failed,
        },
    };
}

/** @deprecated Use requestGameEnrich() instead */
async function enrichGame(gameId, clientData = {}) {
    console.warn('[BaddelAPI] enrichGame() is deprecated � admin endpoint removed from launcher.');
    // We can no longer call /games/enrich/:id directly.
    // Silently swallow the call; the server will enrich via its own queue after request-enrich.
    return null;
}

/** @deprecated Use requestGameEnrich() instead */
async function importAndEnrich(platform, game) {
    console.warn('[BaddelAPI] importAndEnrich() is deprecated. Use requestGameEnrich().');
    const id = platform === 'steam'
        ? String(game.id || game.appid || '')
        : String(game.id || game.namespace || '');
    if (!id) return null;
    await requestGameEnrich(platform, id, game.title || null);
    // Give the server a moment, then lookup to return the uuid if already indexed
    await new Promise(r => setTimeout(r, 3000));
    const looked = await lookupGame({ platform, id });
    return looked?.id || null;
}

// --- Canonical installed-game ? server routing helper ------------------------

/**
 * Decide whether an installed game is eligible for server lookup/enrich,
 * and resolve the canonical platform + external ID to use.
 *
 * Rules:
 *  - Steam  ? { platform: 'steam', id: '<numeric appid>' }
 *  - Epic   ? { platform: 'epic',  id: '<CatalogNamespace hex UUID>' }
 *  - Others ? null  (stay local-first, no server call)
 *
 * This is the single source of truth for platform eligibility and ID
 * resolution.  All callers (game-details.js, gameScanner.js, IPC handlers)
 * must use this function instead of duplicating the logic.
 *
 * @param {object} game  - installed game record from the local DB
 * @returns {{ platform: string, id: string } | null}
 */
function resolveInstalledServerTarget(game) {
    if (!game) return null;

    const platRaw = (game.platform || '').toLowerCase().trim();

    // -- Steam -----------------------------------------------------------------
    const isSteam = platRaw === 'steam';
    if (isSteam) {
        // Prefer the pre-stored allIds.steam (set at scan time)
        let steamId = game.allIds?.steam
            ? String(game.allIds.steam).trim()
            : null;

        // Fallback: strip prefix from the stored id  (e.g. 'steam-12345' ? '12345')
        if (!steamId) {
            const stripped = String(game.id || '').replace(/^steam[-_]/i, '').trim();
            if (/^\d+$/.test(stripped)) steamId = stripped;
        }

        if (!steamId) {
            console.warn(`[ServerTarget] Steam game "${game.name}" � could not resolve a numeric app id. Skipping server flow.`);
            return null;
        }

        _quietLog(`[ServerTarget] ? Steam game "${game.name}" ? id=${steamId}`);
        return { platform: 'steam', id: steamId };
    }

    // -- Epic Games ------------------------------------------------------------
    const isEpic = platRaw === 'epic games' || platRaw === 'epic';
    if (isEpic) {
        // Precedence:
        //   1. game.allIds.epic  � the canonical namespace written at scan time
        //   2. game.namespace    � raw manifest field
        //   3. stripped game.id  � only if it passes namespace validation
        // appName is NEVER used (it's a short slug, not a namespace UUID).
        const candidates = [
            game.allIds?.epic,
            game.namespace,
            String(game.id || '').replace(/^epic[-_]/i, ''),
        ].filter(Boolean);

        const epicId = candidates.find(c => _isValidEpicNamespace(c)) || null;

        if (!epicId) {
            const rejected = candidates.join(', ') || '(none)';
            console.warn(`[ServerTarget] Epic game "${game.name}" � no valid namespace found. Rejected candidates: [${rejected}]. Staying local-only.`);
            return null;
        }

        _quietLog(`[ServerTarget] ? Epic game "${game.name}" ? namespace=${epicId}`);
        return { platform: 'epic', id: epicId };
    }

    // -- Unsupported platforms � local-only for this release ------------------
    _quietLog(`[ServerTarget] Platform "${game.platform}" is not Steam/Epic � local-only (no server call).`);
    return null;
}

/**
 * Validate an Epic Games namespace.
 * Valid namespaces are hex UUIDs (32 chars, e.g. 9773aa1aa54f4f7b80e44bef04986107)
 * or longer hex-hyphen slugs.  Short plain-word appName strings are rejected.
 *
 * @param {string} s
 * @returns {boolean}
 */
function _isValidEpicNamespace(s) {
    if (!s || typeof s !== 'string') return false;
    return s.length >= 10 && /^[a-f0-9\-]+$/i.test(s);
}


// --- Riot metadata lookup resolver -------------------------------------------

/**
 * Resolve the best metadata lookup key for a Riot Games title.
 * Riot is local-first � this helper produces a slug or title for a
 * server lookup by name only.  Never sends platform/id to the server.
 *
 * Known mappings (hardened):
 *   VALORANT           ? slug 'valorant'
 *   League of Legends  ? slug 'league-of-legends'
 *
 * Unknown Riot titles fall back to { title: game.name }.
 *
 * @param {{ name: string, platform: string }} game
 * @returns {{ slug: string } | { title: string } | null}
 */
function resolveRiotMetadataLookup(game) {
    if (!game?.name) return null;

    const SLUG_MAP = {
        'valorant':          'valorant',
        'league of legends': 'league-of-legends',
    };

    const normalized = game.name.toLowerCase().trim().replace(/\s+/g, ' ');
    const slug = SLUG_MAP[normalized] || null;

    if (slug) {
        _quietLog(`[RiotMeta] Known title "${game.name}" ? slug="${slug}"`);
        return { slug };
    }

    // Unknown Riot title � try by title, don't fail
    _quietLog(`[RiotMeta] Unknown Riot title "${game.name}" � fallback to title lookup`);
    return { title: game.name };
}

// --- Normalize transient resolver payload ? app format ------------------------

/**
 * Normalizes the `meta` object returned by POST /client/resolve-metadata
 * (via transientResolver.js on the server) into the same launcher shape
 * that normalizeServerData() produces.
 *
 * Transient payloads look like:
 *   {
 *     title, slug, releaseYear, description,
 *     genres, developer, publisher, ratings,
 *     images: { cover, hero, logo, artworks, screenshots },
 *     videos,
 *   }
 *
 * This is DIFFERENT from a full server-game object (which has images[],
 * metadata[], platform_ids[], etc.).  Never pass a transient payload into
 * normalizeServerData() � use this function instead.
 *
 * @param {object|null} resultMeta  � the `meta` (or `data`) field from the
 *                                    /client/resolve-metadata response
 * @returns {object|null}
 */
function normalizeTransientData(resultMeta) {
    if (!resultMeta) return null;

    const images     = resultMeta.images     || {};
    const cover      = images.cover?.url     || images.cover     || null;
    const heroImage  = images.hero?.url      || images.hero      || null;
    const logo       = images.logo?.url      || images.logo      || null;

    const screenshots = (images.screenshots || []).map(s => s?.url || s).filter(Boolean);
    const artworks    = (images.artworks    || []).map(a => a?.url || a).filter(Boolean);

    const allTrailers = (resultMeta.videos || []).map(v => ({
        name:     v.title || v.name || 'Trailer',
        url:      v.url,
        thumbUrl: v.thumb || v.thumbUrl || null,
        isVideo:  v.url ? !v.url.includes('youtube') : false,
    })).filter(t => {
        if (!t.url) return false;
        // Reject URLs containing the literal string 'undefined' � these are
        // the result of a null video_id being interpolated into the embed URL.
        if (t.url.includes('undefined')) {
            console.warn(`[BaddelAPI] normalizeTransientData: dropping trailer with bad URL: ${t.url}`);
            return false;
        }
        return true;
    });

    // Transient ratings from the server use { score, count, source } on a 0-10 scale.
    // The renderer expects { score, max_score, total_reviews, source }.
    // Without max_score, the UI assumes 0-100 and displays e.g. "8 / 100" instead of "7.5 / 10".
    // Without total_reviews, the review count is hidden entirely.
    const ratings = Array.isArray(resultMeta.ratings)
        ? resultMeta.ratings.map(r => ({
              ...r,
              max_score:     r.max_score     != null ? r.max_score     : 10,
              total_reviews: r.total_reviews != null ? r.total_reviews : (r.count != null ? r.count : null),
          }))
        : [];
    const igdbRating = ratings.find(r => r.source === 'igdb_critics' || r.source === 'igdb');

    const description = resultMeta.description || resultMeta.storyline || null;
    const genres      = Array.isArray(resultMeta.genres) ? resultMeta.genres : [];
    const developer   = resultMeta.developer || null;
    const publisher   = resultMeta.publisher  || null;
    const releaseDate = resultMeta.releaseYear ? String(resultMeta.releaseYear) : null;

    // Quality / confidence heuristic (mirrors normalizeServerData logic)
    const hasCover  = !!cover;
    const hasHero   = !!heroImage;
    const hasLogo   = !!logo;
    const hasText   = !!(description || developer);
    const filled    = [hasCover, hasHero, hasLogo, hasText].filter(Boolean).length;
    const confidence = Math.round((filled / 4) * 100);

    // Art-only guard: if there is no text metadata AND no screenshots from a
    // trusted metadata source, mark this payload as art-only so the launcher
    // can skip persisting it.
    const _isArtOnly = !hasText && screenshots.length === 0;

    _quietLog(`[BaddelAPI] normalizeTransientData: "${resultMeta.title}" | desc=${!!description} | cover=${hasCover} | hero=${hasHero} | genres=${genres.length} | screenshots=${screenshots.length} | trailers=${allTrailers.length} | artOnly=${_isArtOnly}`);

    return {
        cover,
        heroImage,
        logo,
        ratings,
        info: {
            description,
            short_description: null,
            genres,
            developer,
            publisher,
            releaseDate,
            rating:       igdbRating?.score || null,
            ratingSource: igdbRating?.source || null,
            steamReview:  null,
            screenshots,
            artworks,
            allTrailers,
            trailer:       allTrailers[0]?.url || null,
            isDirectVideo: allTrailers[0] ? !allTrailers[0].url.includes('youtube') : false,
            requirements:  null,
        },
        quality: { confidence, sources: { cover: hasCover ? 'transient' : null, hero: hasHero ? 'transient' : null, logo: hasLogo ? 'transient' : null, text: hasText ? 'transient' : null } },
        _transientData: resultMeta,
    };
}

// --- Image-asset presence check ----------------------------------------------

/**
 * Returns true when a normalised metadata object (from normalizeServerData OR
 * normalizeTransientData) contains at least one usable image asset:
 *   � cover  / image
 *   � heroImage / hero
 *   � logo
 *
 * Used by getXboxGames() to decide whether a Store app is a real game.
 *
 * @param {object|null} meta
 * @returns {boolean}
 */
function hasImageAsset(meta) {
    if (!meta) return false;
    return !!(meta.cover || meta.image || meta.heroImage || meta.hero || meta.logo);
}

/**
 * Collapse all known cover/hero/logo alias forms into the single canonical
 * transport shape used by updateGameMetadata, cacheAllAssets, and saveMetadata:
 *   { cover, hero, logo }
 *
 * Call this at every persistence/caching boundary so field-name drift between
 * normalizeServerData (returns heroImage) and consumers (expect hero) can never
 * silently drop the hero asset.
 *
 * @param {object|null} meta  Any normalised metadata object.
 * @returns {{ cover: string|null, hero: string|null, logo: string|null }}
 */
function normalizeAssets(meta) {
    if (!meta) return { cover: null, hero: null, logo: null };
    return {
        cover: meta.cover || meta.image || null,
        hero:  meta.hero  || meta.heroImage || null,
        logo:  meta.logo  || null,
    };
}

module.exports = { lookupGame, requestGameEnrich, requestGameEnrichBatch, resolveMetadata, normalizeServerData, normalizeTransientData, importGames, enrichGame, importAndEnrich, EnrichQueue, createEnrichQueue, ApiError, resolveInstalledServerTarget, resolveRiotMetadataLookup, hasImageAsset, normalizeAssets, isCooldownActive: _isCoolingDown };
