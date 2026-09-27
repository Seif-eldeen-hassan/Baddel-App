'use strict';
const fs   = require('fs');
const path = require('path');
const { computeCandidateSignature } = require('./candidateGenerator');

const VERBOSE_LOGS = process.env.BADDEL_VERBOSE_LOGS === '1';
function verboseLog(...args) { if (VERBOSE_LOGS) console.log(...args); }

const STATUS = Object.freeze({
    IDLE:      'idle',
    PENDING:   'pending',
    RESOLVED:  'resolved',
    NOT_FOUND: 'not_found',
    AMBIGUOUS: 'ambiguous',
    COOLDOWN:  'cooldown',
});

// Resolved entries expire after 7 days (matches metadataCacheStore TTL).
const RESOLVED_TTL_MS  = 7  * 24 * 60 * 60 * 1000;
// not_found / ambiguous expire after 24 h so new server DB entries are picked up.
const TERMINAL_TTL_MS  = 24 * 60 * 60 * 1000;
const DEFAULT_COOLDOWN = 60_000;

/**
 * MetadataResolutionManager (MRM)
 *
 * Single authoritative coordinator for all non-Steam/Epic metadata resolution.
 * Replaces the scattered _resolveThrottleMap + ad-hoc cooldown checks that were
 * spread across addManualGame, runBackgroundMetadataPipeline, the Xbox worker,
 * and the get-game-metadata IPC handler.
 *
 * All four flows call mrm.resolve(gameId, hints).  MRM:
 *   1. Short-circuits on terminal / cooldown states (prevents retry storms)
 *   2. Deduplicates concurrent calls to the same gameId (inflight Map)
 *   3. Persists per-game job state to disk across restarts
 *   4. Runs Stage 1 (cheap DB lookups) then Stage 2 (rate-limited transient
 *      resolver) in a single ordered sequence
 *
 * @example
 *   const result = await mrm.resolve(game.id, {
 *     candidates: [{ slug: 'hades', title: 'Hades', displayName: 'Hades' }],
 *     title: 'Hades',
 *     platformHint: 'gog',
 *   });
 *   if (result) { // { meta, matchedName, _resolveSource }
 *     await metadataCacheStore.save(game.id, result.matchedName, platform, result.meta);
 *   }
 */
class MetadataResolutionManager {
    constructor(userDataPath) {
        this._jobsFile = path.join(userDataPath, 'metadata-resolve-jobs.json');
        this._jobs     = {};
        this._inflight = new Map();  // gameId → Promise
        this._api      = null;
        this._loaded   = false;
    }

    /** @param {object} api - baddelApi module */
    setApi(api) { this._api = api; }

    _ensureLoaded() {
        if (this._loaded) return;
        try {
            if (fs.existsSync(this._jobsFile)) {
                this._jobs = JSON.parse(fs.readFileSync(this._jobsFile, 'utf8'));
            }
        } catch { this._jobs = {}; }
        this._loaded = true;
    }

    _flush() {
        try { fs.writeFileSync(this._jobsFile, JSON.stringify(this._jobs, null, 2), 'utf8'); }
        catch (e) { console.warn('[MRM] flush failed:', e.message); }
    }

    _setJob(gameId, fields) {
        this._ensureLoaded();
        const id = String(gameId);
        this._jobs[id] = Object.assign({}, this._jobs[id] || {}, fields);
        this._flush();
    }

    /** Return the raw persisted job record, or null. */
    getJob(gameId) {
        this._ensureLoaded();
        return this._jobs[String(gameId)] || null;
    }

    /**
     * Return the effective status for a game, accounting for TTL expiry.
     * Expired resolved/terminal/cooldown states return IDLE so the next
     * call will attempt a fresh resolution.
     */
    getStatus(gameId) {
        this._ensureLoaded();
        const job = this._jobs[String(gameId)];
        if (!job) return STATUS.IDLE;
        const now = Date.now();

        if (job.status === STATUS.RESOLVED) {
            return (job.resolvedAt && (now - job.resolvedAt) < RESOLVED_TTL_MS)
                ? STATUS.RESOLVED : STATUS.IDLE;
        }
        if (job.status === STATUS.NOT_FOUND || job.status === STATUS.AMBIGUOUS) {
            return (job.updatedAt && (now - job.updatedAt) < TERMINAL_TTL_MS)
                ? job.status : STATUS.IDLE;
        }
        if (job.status === STATUS.COOLDOWN) {
            return (job.cooldownUntil && now < job.cooldownUntil)
                ? STATUS.COOLDOWN : STATUS.IDLE;
        }
        // PENDING with no active inflight = crashed mid-resolve; retry as IDLE.
        if (job.status === STATUS.PENDING && !this._inflight.has(String(gameId))) {
            return STATUS.IDLE;
        }
        return job.status || STATUS.IDLE;
    }

    /**
     * Record a resolution outcome that was performed by the caller (e.g. the
     * Xbox worker which does its own Stage 1 DB lookups).  Prevents MRM from
     * repeating work already done in the same scan pass.
     */
    markResolved(gameId, { matchedName = null, resolveSource = 'server-hit' } = {}) {
        this._setJob(String(gameId), {
            status: STATUS.RESOLVED,
            resolvedAt: Date.now(),
            matchedName,
            _resolveSource: resolveSource,
            updatedAt: Date.now(),
        });
    }

    /**
     * Reset a game's MRM state to IDLE so the next pipeline pass will retry.
     * Used when a previous resolution succeeded but image persistence then
     * failed — we don't want the RESOLVED lock to prevent retries for 7 days.
     */
    resetToIdle(gameId) {
        this._ensureLoaded();
        const id = String(gameId);
        if (this._jobs[id]) {
            this._setJob(id, { status: STATUS.IDLE, updatedAt: Date.now() });
            verboseLog(`[MRM] resetToIdle: ${id.slice(0, 12)}`);
        }
    }

    /**
     * Remove all persisted state for a game.  More aggressive than resetToIdle —
     * use when a job record is known to be corrupt or stale beyond recovery.
     */
    clearJob(gameId) {
        this._ensureLoaded();
        const id = String(gameId);
        if (this._jobs[id]) {
            delete this._jobs[id];
            this._flush();
            verboseLog(`[MRM] clearJob: ${id.slice(0, 12)}`);
        }
    }

    /**
     * Unified metadata resolution entry-point.
     *
     * All four flows (manual add, get-game-metadata IPC, background pipeline,
     * Xbox scanner) call this method.  Internally it runs Stage 1 (cheap DB
     * lookups via lookupGame) then Stage 2 (rate-limited POST /client/resolve-
     * metadata) and persists the per-game outcome to disk.
     *
     * @param {string} gameId  - stable DB id or synthetic 'xbox_candidate:<slug>'
     * @param {{
     *   candidates?: Array<{slug?: string, title?: string, displayName?: string}>,
     *   title?: string,
     *   slug?: string,
     *   platformHint?: string,
     *   exeName?: string,
     *   folderName?: string,
     *   pathHint?: string,
     * }} hints
     * @returns {Promise<{meta: object, matchedName: string, _resolveSource: string}|null>}
     *   null when: terminal state, cooldown, no metadata found, or error.
     */
    async resolve(gameId, hints = {}) {
        const id  = String(gameId);
        const TAG = `[MRM][${id.slice(0, 12)}]`;

        const force = hints.force === true || hints.bypassTtl === true || hints.ignoreTtl === true;
        if (force) {
            verboseLog(`${TAG} FORCE resolve requested — clearing persisted job state`);
            this.clearJob(id);
            this._inflight.delete(id);
        }

        const st  = this.getStatus(id);

        if (st === STATUS.RESOLVED) {
            verboseLog(`${TAG} SKIP resolved (7-day TTL)`);
            return null;
        }
        if (st === STATUS.NOT_FOUND || st === STATUS.AMBIGUOUS) {
            // Check if the candidate set has changed since we wrote the terminal state.
            // If so, reset to IDLE and retry — better names/aliases have been provided.
            // Also retry when oldSig is absent (job was written before signature support).
            const candidates = Array.isArray(hints.candidates) ? hints.candidates : [];
            const newSig = computeCandidateSignature(candidates);
            const job = this.getJob(id);
            const oldSig = job?.candidateSignature || '';
            if (newSig && (!oldSig || newSig !== oldSig)) {
                verboseLog(`${TAG} candidate signature changed/initialized (${oldSig || 'none'} → ${newSig}) — clearing terminal ${st}, retrying`);
                this._setJob(id, { status: STATUS.IDLE, updatedAt: Date.now(), candidateSignature: newSig });
                // fall through to _doResolve below
            } else {
                verboseLog(`${TAG} SKIP ${st} (24-h TTL)`);
                return null;
            }
        }
        if (st === STATUS.COOLDOWN) {
            const job = this.getJob(id);
            verboseLog(`${TAG} SKIP cooldown until ${new Date(job.cooldownUntil).toISOString()}`);
            return null;
        }

        // Inflight dedup: concurrent calls for the same game join the same promise
        if (this._inflight.has(id)) {
            verboseLog(`${TAG} PENDING — joining inflight promise`);
            return this._inflight.get(id);
        }

        this._setJob(id, { status: STATUS.PENDING, updatedAt: Date.now() });
        const p = this._doResolve(id, hints).finally(() => this._inflight.delete(id));
        this._inflight.set(id, p);
        return p;
    }

    async _doResolve(gameId, hints) {
        const id  = String(gameId);
        const TAG = `[MRM][${id.slice(0, 12)}]`;

        // Build lookup candidate list from explicit array or from title/slug hints.
        const candidates = Array.isArray(hints.candidates) ? [...hints.candidates] : [];
        if (!candidates.length) {
            if (hints.slug && hints.slug.length >= 3) candidates.push({ slug: hints.slug });
            if (hints.title) candidates.push({ title: hints.title, displayName: hints.title });
        }

        // Store the candidate signature in the job so we can detect changes later.
        const sig = computeCandidateSignature(candidates);
        if (sig) this._setJob(id, { candidateSignature: sig });

        verboseLog(`${TAG} candidates (${candidates.length}): ${candidates.map(c => c.title || c.slug).join(', ')}`);

        // ── Stage 1+2: cheap DB lookups (no rate-limit risk) ──────────────────
        for (const c of candidates) {
            try {
                const queries = [];
                if (c.slug && c.slug.length >= 3 && !/^\d+$/.test(c.slug)) {
                    queries.push({ slug: c.slug });
                }
                if (c.title) {
                    queries.push({ title: c.title });
                }

                for (const q of queries) {
                    const label = q.slug ? `slug="${q.slug}"` : `title="${q.title}"`;
                    verboseLog(`${TAG} lookup ${label}`);
                    const hit = await this._api.lookupGame(q);
                    if (hit) {
                        const norm = this._api.normalizeServerData(hit);
                        if (norm && (norm.cover || norm.heroImage || norm.logo)) {
                            const matchedName = c.displayName || c.title || c.slug;
                            verboseLog(`${TAG} ✓ server HIT (${label}) → "${matchedName}"`);
                            this._setJob(id, {
                                status: STATUS.RESOLVED,
                                resolvedAt: Date.now(),
                                matchedName,
                                _resolveSource: 'server-hit',
                                updatedAt: Date.now(),
                            });
                            return { meta: norm, matchedName, _resolveSource: 'server-hit' };
                        }
                    }
                }
            } catch (e) {
                console.warn(`${TAG} lookup error:`, e.message);
            }
        }

        // ── Stage 3: transient resolver — loop ALL candidates ─────────────────
        // Guard: if a prior call already registered a cooldown on this job, skip.
        const existingJob = this.getJob(id);
        if (existingJob?.cooldownUntil && Date.now() < existingJob.cooldownUntil) {
            verboseLog(`${TAG} residual cooldown — skipping transient resolver`);
            this._setJob(id, { status: STATUS.COOLDOWN, updatedAt: Date.now() });
            return null;
        }

        // Build the ordered transient candidate list from the same candidates array.
        // Each entry maps to a resolveHints object for POST /client/resolve-metadata.
        const transientCandidates = [];
        for (const c of candidates) {
            const title = c.title;
            const slug  = (c.slug && c.slug.length >= 3) ? c.slug : undefined;
            if (!title && !slug) continue;
            // Merge with top-level hints that apply to all candidates
            const entry = {};
            if (title)                                    entry.title        = title;
            if (slug)                                     entry.slug         = slug;
            if (hints.platformHint)                       entry.platformHint = hints.platformHint;
            if (hints.exeName && !title)                  entry.exeName      = hints.exeName;
            if (hints.folderName && !title)               entry.folderName   = hints.folderName;
            if (hints.pathHint)                           entry.pathHint     = hints.pathHint;
            transientCandidates.push({ entry, displayName: c.displayName || title || slug });
        }

        // Also add the raw hints.title / hints.slug as a final fallback if not
        // already covered by the candidate list (preserves old single-candidate behaviour).
        if (hints.title) {
            const exists = transientCandidates.some(tc => tc.entry.title === hints.title);
            if (!exists) {
                const entry = { title: hints.title };
                if (hints.slug && hints.slug.length >= 3) entry.slug = hints.slug;
                if (hints.platformHint) entry.platformHint = hints.platformHint;
                if (hints.exeName)      entry.exeName      = hints.exeName;
                if (hints.folderName)   entry.folderName   = hints.folderName;
                if (hints.pathHint)     entry.pathHint     = hints.pathHint;
                transientCandidates.push({ entry, displayName: hints.title });
            }
        }

        if (!transientCandidates.length) {
            console.warn(`${TAG} no candidates for transient resolver → NOT_FOUND`);
            this._setJob(id, { status: STATUS.NOT_FOUND, updatedAt: Date.now() });
            return null;
        }

        let lastAmbiguous = false;

        for (let i = 0; i < transientCandidates.length; i++) {
            const { entry: resolveHints, displayName } = transientCandidates[i];
            const isLast = i === transientCandidates.length - 1;

            // Re-check cooldown before each attempt (a prior iteration may have set it)
            const freshJob = this.getJob(id);
            if (freshJob?.cooldownUntil && Date.now() < freshJob.cooldownUntil) {
                verboseLog(`${TAG} cooldown active — aborting transient loop`);
                this._setJob(id, { status: STATUS.COOLDOWN, updatedAt: Date.now() });
                return null;
            }

            try {
                const label = resolveHints.title ? `title="${resolveHints.title}"` : `slug="${resolveHints.slug}"`;
                verboseLog(`${TAG} transient resolver [${i + 1}/${transientCandidates.length}] → POST /client/resolve-metadata ${label}`);
                const res    = await this._api.resolveMetadata(resolveHints);
                const status = res?.status;

                if (status === 'resolved') {
                    const raw  = res.meta || res.data;
                    const norm = this._api.normalizeTransientData(raw);
                    if (norm && (norm.cover || norm.heroImage || norm.logo)) {
                        const matchedName = raw?.title || displayName;
                        verboseLog(`${TAG} ✓ transient RESOLVED [${i + 1}/${transientCandidates.length}] title="${raw?.title}" via candidate "${displayName}"`);
                        this._setJob(id, {
                            status: STATUS.RESOLVED,
                            resolvedAt: Date.now(),
                            matchedName,
                            _resolveSource: 'transient-resolved',
                            updatedAt: Date.now(),
                        });
                        return { meta: norm, matchedName, _resolveSource: 'transient-resolved' };
                    }
                    // Resolved but no images — try next candidate
                    verboseLog(`${TAG} transient resolved but no images for "${displayName}" — trying next candidate`);
                    if (isLast) {
                        verboseLog(`${TAG} all candidates resolved with no images → NOT_FOUND`);
                        this._setJob(id, { status: STATUS.NOT_FOUND, updatedAt: Date.now() });
                        return null;
                    }
                    continue;
                }

                if (status === 'not_found') {
                    verboseLog(`${TAG} transient NOT_FOUND for candidate "${displayName}"${isLast ? ' (last — writing NOT_FOUND)' : ' — trying next'}`);
                    if (isLast) {
                        this._setJob(id, { status: STATUS.NOT_FOUND, updatedAt: Date.now() });
                        return null;
                    }
                    continue;
                }

                if (status === 'ambiguous') {
                    verboseLog(`${TAG} transient AMBIGUOUS for candidate "${displayName}"${isLast ? ' (last — writing AMBIGUOUS)' : ' — trying next'}`);
                    lastAmbiguous = true;
                    if (isLast) {
                        this._setJob(id, { status: STATUS.AMBIGUOUS, updatedAt: Date.now() });
                        return null;
                    }
                    continue;
                }

                // null / unexpected status — leave IDLE so caller can retry
                verboseLog(`${TAG} transient null/unexpected for "${displayName}" (retryable) → IDLE`);
                this._setJob(id, { status: STATUS.IDLE, updatedAt: Date.now() });
                return null;

            } catch (err) {
                const is429 = err?.status === 429 || (err?.message || '').includes('429');
                if (is429) {
                    const sec        = parseInt(err?.retryAfter || '60', 10);
                    const waitMs     = (!isNaN(sec) && sec > 0) ? sec * 1000 : DEFAULT_COOLDOWN;
                    const cooldownUntil = Date.now() + waitMs;
                    console.warn(
                        `${TAG} 429 RATE LIMITED on candidate "${displayName}" — cooldown ${Math.round(waitMs / 1000)}s ` +
                        `until ${new Date(cooldownUntil).toISOString()}`
                    );
                    this._setJob(id, { status: STATUS.COOLDOWN, cooldownUntil, updatedAt: Date.now() });
                    return null;
                }
                // Network / parse error — leave IDLE so next pipeline pass can retry
                console.warn(`${TAG} transient error for "${displayName}" (retryable → IDLE):`, err.message);
                this._setJob(id, { status: STATUS.IDLE, updatedAt: Date.now() });
                return null;
            }
        }

        // Exhausted all candidates
        verboseLog(`${TAG} all ${transientCandidates.length} transient candidates exhausted → ${lastAmbiguous ? 'AMBIGUOUS' : 'NOT_FOUND'}`);
        this._setJob(id, {
            status: lastAmbiguous ? STATUS.AMBIGUOUS : STATUS.NOT_FOUND,
            updatedAt: Date.now(),
        });
        return null;
    }
}

module.exports = { MetadataResolutionManager, STATUS };