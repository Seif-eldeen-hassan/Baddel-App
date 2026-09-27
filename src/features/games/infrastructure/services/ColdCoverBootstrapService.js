'use strict';

const { ARTWORK_DOWNLOAD_PRIORITIES } = require('./ArtworkDownloadScheduler');
const { resolveArtworkCacheKeys } = require('../../application/services/GameArtworkReadModel');
const { buildSteamLibraryCardUrl } = require('../../../../shared/utils/steamLibraryAssets');

const JOB_STATES = Object.freeze({
    CACHE_CHECK: 'cache_check',
    AWAITING_METADATA: 'awaiting_metadata',
    CANDIDATE_READY: 'candidate_ready',
    QUEUED_DOWNLOAD: 'queued_download',
    DOWNLOADING: 'downloading',
    READY: 'ready',
    TERMINAL_NO_SOURCE: 'terminal_no_source',
    TERMINAL_ERROR: 'terminal_error',
});

const PRIORITY_RANK = Object.freeze({
    visible: 0,
    buffer: 1,
    prefetch: 2,
    background: 3,
});

function _isRemoteUrl(value) {
    return /^https?:\/\//i.test(String(value || '').trim());
}

function _pushUnique(out, value) {
    const text = String(value || '').trim();
    if (!text || out.includes(text)) return;
    out.push(text);
}

function _coverCandidatesFromGame(game = {}) {
    const urls = [];
    [
        game.coverUrl,
        game.image,
        game.defaultImage,
        game.cover,
        game.posterImage,
        game.verticalCover,
        game.verticalCoverUrl,
        game.boxArt,
        game.boxArtUrl,
        game.capsuleImage,
        game.grid,
    ].forEach((value) => {
        if (_isRemoteUrl(value)) _pushUnique(urls, value);
    });
    if (Array.isArray(game.keyImages)) {
        game.keyImages.forEach((img) => {
            const url = img?.url || img?.href || img?.src;
            if (_isRemoteUrl(url)) _pushUnique(urls, url);
        });
    }
    [
        game.coverCandidates,
        game.artworkCandidates,
        game.remoteCandidates,
        game.remoteCoverCandidates,
    ].forEach((items) => {
        if (!Array.isArray(items)) return;
        items.forEach((item) => {
            const url = typeof item === 'string' ? item : (item?.url || item?.href || item?.src);
            if (_isRemoteUrl(url)) _pushUnique(urls, url);
        });
    });
    // A missing metadata-server record is not evidence that Steam has no poster.
    if (String(game.platform || game.source || '').toLowerCase() === 'steam') {
        const appId = String(game.appId || game.appid || game.steamAppId || game.appName || String(game.id || '').replace(/^steam_/, ''));
        if (/^[1-9]\d*$/.test(appId)) _pushUnique(urls, buildSteamLibraryCardUrl(appId));
    }
    return urls;
}

function _primaryIdentity(game = {}) {
    const keys = resolveArtworkCacheKeys(game, game);
    return String(keys[0] || game.id || game.appName || game.title || game.name || '').trim();
}

function _jobKey(game = {}) {
    return String(_primaryIdentity(game) || '').toLowerCase();
}

function _yieldToLoop() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

function _normalizePriority(value) {
    const text = String(value || '').toLowerCase();
    if (text === 'visible' || text === 'viewport' || text === 'tier1') return 'visible';
    if (text === 'buffer' || text === 'near' || text === 'tier2') return 'buffer';
    if (text === 'prefetch' || text === 'tier3') return 'prefetch';
    return 'background';
}

class ColdCoverBootstrapService {
    constructor({
        artworkDownloadManager,
        metadataResolver = null,
        notify = null,
        logger = console,
        batchSize = 50,
        yieldEvery = 25,
        jobConcurrency = 6,
        backgroundJobConcurrency = jobConcurrency,
        bufferJobConcurrency = jobConcurrency,
        metadataConcurrency = 3,
        visibleMetadataConcurrency = 2,
        dataSaverJobConcurrency = 2,
        retryDelayMs = 15000,
        maxRetries = 2,
    } = {}) {
        if (!artworkDownloadManager) throw new Error('ColdCoverBootstrapService requires ArtworkDownloadManager.');
        this._manager = artworkDownloadManager;
        this._metadataResolver = typeof metadataResolver === 'function' ? metadataResolver : null;
        this._notify = typeof notify === 'function' ? notify : null;
        this._logger = logger;
        this._batchSize = Math.max(1, Number(batchSize) || 50);
        this._yieldEvery = Math.max(1, Number(yieldEvery) || 25);
        this._jobConcurrency = Math.max(1, Number(jobConcurrency) || 6);
        this._backgroundJobConcurrency = Math.max(1, Math.min(this._jobConcurrency, Number(backgroundJobConcurrency) || this._jobConcurrency));
        this._bufferJobConcurrency = Math.max(this._backgroundJobConcurrency, Math.min(this._jobConcurrency, Number(bufferJobConcurrency) || this._jobConcurrency));
        this._metadataConcurrency = Math.max(1, Number(metadataConcurrency) || 3);
        this._visibleMetadataConcurrency = Math.max(1, Number(visibleMetadataConcurrency) || 2);
        this._dataSaverJobConcurrency = Math.max(1, Number(dataSaverJobConcurrency) || 2);
        this._signature = '';
        this._retryDelayMs = Math.max(1, Number(retryDelayMs) || 15000);
        this._maxRetries = Math.max(0, Number(maxRetries) || 0);
        this._generation = 0;
        this._jobs = new Map();
        this._pumpPromise = null;
        this._reconcilePromise = null;
        this._drainResolvers = [];
        this._changed = new Set();
        this._notifyTimer = null;
        this._eventCount = 0;
        this._activeDownloads = 0;
        this._activeMetadata = 0;
        this._activeVisibleMetadata = 0;
        this._scheduled = false;
        this._stats = this._emptyStats();
    }

    start(games = [], options = {}) {
        const list = (Array.isArray(games) ? games : []).filter(Boolean);
        const signature = this._signatureFor(list);
        if (this._signature !== signature) {
            this._signature = signature;
            this._generation += 1;
            this._stats = this._emptyStats();
            this._stats.totalGames = list.length;
            this._stats.startedAt = Date.now();
        } else {
            this._stats.totalGames = list.length;
        }
        const generation = this._generation;
        const previous = this._reconcilePromise;
        const reconcile = Promise.resolve(previous).catch(() => {}).then(() =>
            this._reconcileJobsYielding(list, { priority: 'background', reason: options.reason || 'cold-library-cover-bootstrap' }, generation));
        this._reconcilePromise = reconcile;
        reconcile.finally(() => {
            if (this._reconcilePromise !== reconcile) return;
            this._reconcilePromise = null;
            if (generation === this._generation) this._schedulePump(options);
        });
        return { status: this._pumpPromise ? 'running' : 'started', stats: this.getStats() };
    }

    whenIdle() {
        if (this._reconcilePromise) return this._reconcilePromise.then(() => this.whenIdle());
        if (!this._pumpPromise && !this._hasRunnableWork() && this._activeDownloads === 0 && this._activeMetadata === 0) {
            return Promise.resolve(this.getStats());
        }
        return new Promise((resolve) => {
            this._drainResolvers.push(resolve);
            this._schedulePump();
        });
    }

    boost(games = [], options = {}) {
        const list = (Array.isArray(games) ? games : []).filter(Boolean);
        if (!list.length) return { status: 'empty', stats: this.getStats() };
        const priority = _normalizePriority(options.priority || 'visible');
        for (const game of list) {
            const job = this._ensureJob(game, {
                priority,
                reason: options.reason || 'cold-cover-bootstrap-visible-boost',
            });
            if (job) {
                this._promote(job, priority, options.reason || job.reason);
                const policyDeferred = job.candidateErrors?.some(item => /budget|data-saver/.test(item.reason));
                if (job.state === JOB_STATES.TERMINAL_ERROR && !job.retryPromise &&
                    (policyDeferred || ((job.retryable || job.lastError === 'download_failed') &&
                    Date.now() >= (job.retryAfterAt || 0)))) {
                    job.state = JOB_STATES.CANDIDATE_READY;
                    job.retryAfterAt = Date.now() + 60000;
                }
                // A newly opened renderer may not know about an existing hit.
                // Acknowledge it through the same batched channel as downloads.
                if (job.state === JOB_STATES.READY && job.localUrl) {
                    this._changed.add(job.primary);
                    this._scheduleNotification();
                }
            }
        }
        this._schedulePump({ ...options, priority });
        return { status: 'queued', stats: this.getStats() };
    }

    getStats() {
        const managerStats = this._manager.getStats?.() || {};
        return {
            ...this._stats,
            running: !!this._reconcilePromise || !!this._pumpPromise || this._hasRunnableWork() || this._activeDownloads > 0 || this._activeMetadata > 0,
            queuedDownloads: managerStats.queuedDownloads || 0,
            activeDownloads: managerStats.activeDownloads || this._activeDownloads || 0,
            schedulerPaused: false,
            budgetState: managerStats.currentBudget || null,
            jobsByState: this._jobsByState(),
            terminalFailuresByReason: { ...this._stats.terminalFailuresByReason },
        };
    }

    _emptyStats() {
        return {
            totalGames: 0,
            uniqueJobs: 0,
            duplicateJobs: 0,
            validAliasHits: 0,
            cacheMisses: 0,
            missesWithRemoteCandidates: 0,
            awaitingMetadata: 0,
            metadataRequests: 0,
            metadataResolved: 0,
            metadataNoSource: 0,
            genuineNoSourceGames: 0,
            queuedUniqueDownloads: 0,
            completedDownloads: 0,
            failedDownloads: 0,
            skippedExistingHits: 0,
            terminalFailuresByReason: {},
            batchNotifications: 0,
            perCoverEvents: 0,
            startedAt: null,
            finishedAt: null,
            lastError: null,
        };
    }

    _signatureFor(list) {
        return list.map((game) => _jobKey(game)).filter(Boolean).sort().join('|');
    }

    _jobsByState() {
        const out = {};
        for (const job of this._jobs.values()) out[job.state] = Number(out[job.state] || 0) + 1;
        return out;
    }

    _reconcileJobs(list, options = {}) {
        const current = new Set();
        let duplicates = 0;
        for (const game of list) {
            const key = _jobKey(game);
            if (!key) continue;
            if (current.has(key)) { duplicates += 1; continue; }
            current.add(key);
            this._ensureJob(game, options);
        }
        for (const key of Array.from(this._jobs.keys())) {
            if (!current.has(key)) this._jobs.delete(key);
        }
        this._stats.uniqueJobs = current.size;
        this._stats.duplicateJobs = duplicates;
    }

    async _reconcileJobsYielding(list, options = {}, generation = this._generation) {
        const current = new Set();
        let duplicates = 0;
        for (let index = 0; index < list.length; index += 1) {
            if (generation !== this._generation) return;
            const game = list[index];
            const key = _jobKey(game);
            if (key) {
                if (current.has(key)) duplicates += 1;
                else {
                    current.add(key);
                    this._ensureJob(game, options);
                }
            }
            if (index > 0 && index % this._yieldEvery === 0) await _yieldToLoop();
        }
        if (generation !== this._generation) return;
        for (const key of Array.from(this._jobs.keys())) {
            if (!current.has(key)) this._jobs.delete(key);
        }
        this._stats.uniqueJobs = current.size;
        this._stats.duplicateJobs = duplicates;
    }

    _ensureJob(game, options = {}) {
        const key = _jobKey(game);
        if (!key) return null;
        const aliases = resolveArtworkCacheKeys(game, game);
        const primary = _primaryIdentity(game);
        const candidates = _coverCandidatesFromGame(game);
        let job = this._jobs.get(key);
        if (!job) {
            job = {
                key,
                primary,
                aliases: [],
                candidates: [],
                game,
                priority: _normalizePriority(options.priority),
                reason: options.reason || 'cold-library-cover-bootstrap',
                state: JOB_STATES.CACHE_CHECK,
                metadataAttempted: false,
                downloadAttempted: false,
                lastTouchedAt: Date.now(),
            };
            this._jobs.set(key, job);
        }
        job.game = { ...(job.game || {}), ...(game || {}) };
        job.aliases = Array.from(new Set([...(job.aliases || []), ...aliases].filter(Boolean)));
        job.primary = job.primary || primary;
        candidates.forEach((url) => _pushUnique(job.candidates, url));
        job.lastTouchedAt = Date.now();
        this._promote(job, options.priority, options.reason);
        if (job.state === JOB_STATES.CACHE_CHECK) this._prepareJob(job);
        if (job.state === JOB_STATES.TERMINAL_NO_SOURCE && job.candidates.length) job.state = JOB_STATES.CANDIDATE_READY;
        return job;
    }

    _prepareJob(job) {
        const hit = this._cacheHitFor(job.aliases);
        if (hit) {
            job.state = JOB_STATES.READY;
            job.localUrl = hit;
            this._stats.validAliasHits += 1;
            this._stats.skippedExistingHits += 1;
            return;
        }
        this._stats.cacheMisses += 1;
        if (job.candidates.length) {
            this._stats.missesWithRemoteCandidates += 1;
            job.state = JOB_STATES.CANDIDATE_READY;
        } else {
            this._stats.awaitingMetadata += 1;
            job.state = JOB_STATES.AWAITING_METADATA;
        }
    }

    _promote(job, priority = null, reason = null) {
        const next = _normalizePriority(priority || job.priority);
        const currentRank = PRIORITY_RANK[job.priority || 'background'];
        const nextRank = PRIORITY_RANK[next];
        if (nextRank < currentRank) {
            job.priority = next;
            if (reason) job.reason = reason;
        } else if (nextRank === currentRank && reason) {
            job.reason = reason;
        }
    }

    _cacheHitFor(keys) {
        for (const key of keys || []) {
            const hit = this._manager.getCachedAsset?.({ canonicalGameId: key, type: 'cover' });
            if (hit?.fileUrl) return hit.fileUrl;
        }
        return null;
    }

    _schedulePump(options = {}) {
        if (this._scheduled) return;
        this._scheduled = true;
        setTimeout(() => {
            this._scheduled = false;
            if (this._pumpPromise) return;
            this._pumpPromise = this._pump(options)
                .catch((err) => {
                    this._stats.lastError = err?.message || String(err);
                    try { this._logger.warn?.('[ColdCoverBootstrap] failed:', this._stats.lastError); } catch {}
                })
                .finally(() => {
                    this._pumpPromise = null;
                    if (this._hasRunnableWork() || this._activeDownloads > 0 || this._activeMetadata > 0) {
                        this._schedulePump(options);
                        return;
                    }
                    this._stats.finishedAt = Date.now();
                    this._flushNotification();
                    const resolvers = this._drainResolvers.splice(0);
                    resolvers.forEach((resolve) => resolve(this.getStats()));
                });
        }, 0);
    }

    async _pump(options = {}) {
        await this._manager.withManifestTransaction({
            label: 'cold-library-cover-bootstrap',
            batchSize: this._batchSize,
        }, async () => {
            let yielded = 0;
            while (this._hasRunnableWork() || this._activeDownloads > 0 || this._activeMetadata > 0) {
                const started = this._startRunnableJobs(options);
                if (!started) {
                    const active = this._activeWorkPromises();
                    if (!active.length) break;
                    await Promise.race(active);
                    continue;
                }
                yielded += 1;
                if (yielded % this._yieldEvery === 0) await _yieldToLoop();
            }
        });
    }

    _activeWorkPromises() {
        const promises = [];
        for (const job of this._jobs.values()) {
            if (job.metadataPromise) promises.push(job.metadataPromise);
            if (job.downloadPromise) promises.push(job.downloadPromise);
            if (job.retryPromise) promises.push(job.retryPromise);
        }
        return promises;
    }

    _hasRunnableWork() {
        for (const job of this._jobs.values()) {
            if (job.retryPromise) return true;
            if (job.state === JOB_STATES.AWAITING_METADATA && !job.metadataPromise) return true;
            if ((job.state === JOB_STATES.CANDIDATE_READY || job.state === JOB_STATES.QUEUED_DOWNLOAD) && !job.downloadPromise) return true;
        }
        return false;
    }

    _startRunnableJobs(options = {}) {
        let started = 0;
        const jobs = Array.from(this._jobs.values()).sort((a, b) => {
            const pa = PRIORITY_RANK[a.priority || 'background'];
            const pb = PRIORITY_RANK[b.priority || 'background'];
            if (pa !== pb) return pa - pb;
            return a.lastTouchedAt - b.lastTouchedAt;
        });
        for (const job of jobs) {
            if (job.state === JOB_STATES.AWAITING_METADATA) {
                if (this._tryStartMetadata(job)) started += 1;
                continue;
            }
            if (job.state === JOB_STATES.CANDIDATE_READY || job.state === JOB_STATES.QUEUED_DOWNLOAD) {
                if (this._tryStartDownload(job, options)) started += 1;
            }
        }
        return started;
    }

    _tryStartMetadata(job) {
        if (!this._metadataResolver || job.metadataPromise || job.metadataAttempted) {
            if (!this._metadataResolver && !job.metadataAttempted) {
                job.metadataAttempted = true;
                this._markNoSource(job, 'metadata_unavailable');
            }
            return false;
        }
        const visible = job.priority === 'visible';
        const visibleSlot = visible && this._activeVisibleMetadata < this._visibleMetadataConcurrency;
        const generalSlot = this._activeMetadata < this._metadataConcurrency;
        if (!visibleSlot && !generalSlot) return false;
        this._activeMetadata += 1;
        if (visible) this._activeVisibleMetadata += 1;
        job.metadataAttempted = true;
        this._stats.metadataRequests += 1;
        job.metadataPromise = this._resolveMetadata(job)
            .finally(() => {
                this._activeMetadata = Math.max(0, this._activeMetadata - 1);
                if (visible) this._activeVisibleMetadata = Math.max(0, this._activeVisibleMetadata - 1);
                job.metadataPromise = null;
                this._schedulePump();
            });
        return true;
    }

    async _resolveMetadata(job) {
        const meta = await this._metadataResolver(job.game).catch((err) => {
            job.lastError = err?.message || String(err);
            return null;
        });
        const enriched = _coverCandidatesFromGame({ ...(job.game || {}), ...(meta || {}) });
        enriched.forEach((url) => _pushUnique(job.candidates, url));
        if (job.candidates.length) {
            this._stats.metadataResolved += 1;
            job.state = JOB_STATES.CANDIDATE_READY;
            return;
        }
        this._markNoSource(job, 'metadata_no_source');
    }

    _tryStartDownload(job, options = {}) {
        const configured = this._concurrencyForOptions(options);
        const limit = job.priority === 'visible'
            ? configured
            : (job.priority === 'buffer'
                ? Math.min(configured, this._bufferJobConcurrency)
                : Math.min(configured, this._backgroundJobConcurrency));
        if (job.downloadPromise || this._activeDownloads >= limit) return false;
        if (!job.candidates.length) {
            job.state = JOB_STATES.AWAITING_METADATA;
            return false;
        }
        this._activeDownloads += 1;
        job.state = JOB_STATES.QUEUED_DOWNLOAD;
        this._stats.queuedUniqueDownloads += job.downloadAttempted ? 0 : 1;
        job.downloadAttempted = true;
        job.downloadPromise = this._downloadJob(job, options)
            .finally(() => {
                this._activeDownloads = Math.max(0, this._activeDownloads - 1);
                job.downloadPromise = null;
                this._schedulePump();
            });
        return true;
    }

    async _downloadJob(job, options = {}) {
        job.state = JOB_STATES.DOWNLOADING;
        job.retryable = false;
        job.candidateErrors = [];
        for (const candidate of job.candidates) {
            const result = await this._manager.requestAsset({
                sourceUrl: candidate,
                canonicalGameId: job.primary,
                type: 'cover',
                priority: this._downloadPriorityFor(job),
                reason: job.reason || options.reason || 'cold-library-cover-bootstrap',
                sourceSubsystem: 'cold-cover-bootstrap',
                activeLibraryGameCount: this._stats.totalGames,
            });
            if (result?.localUrl) {
                this._linkAliases(job, result);
                this._stats.completedDownloads += result.status === 'cache-hit' ? 0 : 1;
                this._stats.validAliasHits += 1;
                job.state = JOB_STATES.READY;
                job.localUrl = result.localUrl;
                this._changed.add(job.primary);
                this._scheduleNotification();
                return true;
            }
            const reason = result?.errorCode || result?.blockedReason || result?.skipReason || result?.status || 'download_failed';
            job.candidateErrors.push({ sourceUrl: candidate, reason });
            if (result?.retryable === true || /HTTP[_ ](?:408|425|429|5\d\d)|timed? ?out|fetch failed|ECONN|ENET|EHOST|EAI_AGAIN|ETIMEDOUT/i.test(reason)) job.retryable = true;
            // Policy deferrals may recover when promoted into the viewport.
            if (result?.budgetRejection) job.retryable = true;
            if (reason === 'capacity_exhausted' || reason === 'missing-required-fields') {
                this._markTerminalError(job, reason);
                return false;
            }
        }
        if (!job.metadataAttempted && this._metadataResolver) {
            job.state = JOB_STATES.AWAITING_METADATA;
            return false;
        }
        this._markTerminalError(job, job.candidateErrors.at(-1)?.reason || 'download_failed');
        if (job.retryable && !job.candidateErrors.some(e => /budget|data-saver/.test(e.reason)) &&
            (job.retryCount || 0) < this._maxRetries) {
            const delay = this._retryDelayMs * (2 ** (job.retryCount || 0));
            job.retryCount = (job.retryCount || 0) + 1;
            job.retryAfterAt = Date.now() + delay;
            job.retryPromise = new Promise(resolve => setTimeout(() => {
                job.retryPromise = null;
                if (this._jobs.get(job.key) === job && job.state === JOB_STATES.TERMINAL_ERROR) job.state = JOB_STATES.CANDIDATE_READY;
                resolve();
                this._schedulePump();
            }, delay));
        }
        return false;
    }

    _downloadPriorityFor(job) {
        if (job.priority === 'visible') return ARTWORK_DOWNLOAD_PRIORITIES.VISIBLE;
        if (job.priority === 'buffer') return ARTWORK_DOWNLOAD_PRIORITIES.PREWARM || ARTWORK_DOWNLOAD_PRIORITIES.LIBRARY_COVER_HYDRATION;
        return ARTWORK_DOWNLOAD_PRIORITIES.LIBRARY_COVER_HYDRATION;
    }

    _linkAliases(job, result) {
        let assetHash = result?.assetHash || null;
        if (!assetHash) {
            const hit = this._manager.getCachedAsset?.({ canonicalGameId: job.primary, type: 'cover' });
            assetHash = hit?.assetHash || null;
        }
        if (!assetHash) return;
        for (const alias of job.aliases) {
            if (alias && alias !== job.primary) {
                this._manager.linkCachedAlias?.({ assetHash, canonicalGameId: alias, type: 'cover' });
            }
        }
    }

    _markNoSource(job, reason) {
        job.state = JOB_STATES.TERMINAL_NO_SOURCE;
        job.lastError = reason;
        this._stats.metadataNoSource += 1;
        this._stats.genuineNoSourceGames += 1;
        this._recordTerminal(reason || 'no_source');
    }

    _markTerminalError(job, reason) {
        job.state = JOB_STATES.TERMINAL_ERROR;
        job.lastError = reason;
        job.retryAfterAt = Date.now() + 60000;
        this._stats.failedDownloads += 1;
        this._recordTerminal(reason || 'download_failed');
    }

    _concurrencyForOptions(options = {}) {
        if (Number.isFinite(Number(options.jobConcurrency))) return Math.max(1, Number(options.jobConcurrency));
        if (options.dataSaver === true || options.dataSaverMode === true) return this._dataSaverJobConcurrency;
        return this._jobConcurrency;
    }

    _recordTerminal(reason) {
        const key = String(reason || 'unknown');
        this._stats.terminalFailuresByReason[key] = Number(this._stats.terminalFailuresByReason[key] || 0) + 1;
    }

    _scheduleNotification() {
        if (!this._notify || this._notifyTimer) return;
        this._notifyTimer = setTimeout(() => {
            this._notifyTimer = null;
            this._flushNotification();
        }, 250);
        if (typeof this._notifyTimer.unref === 'function') this._notifyTimer.unref();
    }

    _flushNotification() {
        if (!this._notify || !this._changed.size) return;
        const ids = Array.from(this._changed);
        this._changed.clear();
        this._eventCount += 1;
        this._stats.batchNotifications = this._eventCount;
        this._notify({
            status: 'batch',
            changedCanonicalIds: ids,
            stats: this.getStats(),
        });
    }
}

module.exports = {
    ColdCoverBootstrapService,
    JOB_STATES,
    _coverCandidatesFromGame,
};

