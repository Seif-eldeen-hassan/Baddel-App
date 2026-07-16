'use strict';

const defaultCrypto = require('crypto');
const defaultFs = require('fs');
const defaultPath = require('path');

function emptySummary(now = new Date()) {
    return {
        sessionStartedAt: now.toISOString(),
        sessionDownloadedBytes: 0,
        sessionRequestCount: 0,
        cacheHits: 0,
        cacheMisses: 0,
        revalidated304: 0,
        deduplicatedRequests: 0,
        failedRequests: 0,
        rendererDirectRemoteRequests: 0,
        bySubsystem: {},
        byAssetType: {},
        topRepeatedUrlHashes: [],
    };
}

function incrementBucket(target, key, patch) {
    const safeKey = String(key || 'unknown');
    if (!target[safeKey]) {
        target[safeKey] = {
            requestCount: 0,
            downloadedBytes: 0,
            cacheHits: 0,
            cacheMisses: 0,
            failedRequests: 0,
        };
    }
    const bucket = target[safeKey];
    bucket.requestCount += patch.requestCount || 0;
    bucket.downloadedBytes += patch.downloadedBytes || 0;
    bucket.cacheHits += patch.cacheHits || 0;
    bucket.cacheMisses += patch.cacheMisses || 0;
    bucket.failedRequests += patch.failedRequests || 0;
}

class ArtworkNetworkTelemetry {
    constructor({
        crypto = defaultCrypto,
        fs = defaultFs,
        path = defaultPath,
        now = () => new Date(),
        maxTopUrlHashes = 10,
    } = {}) {
        this._crypto = crypto;
        this._fs = fs;
        this._path = path;
        this._now = now;
        this._maxTopUrlHashes = maxTopUrlHashes;
        this._summaryFile = null;
        this._summary = emptySummary(this._now());
        this._urlHashCounts = new Map();
    }

    configure({ summaryFile = null } = {}) {
        this._summaryFile = summaryFile || null;
        if (this._summaryFile) this._loadPersistedSummary();
    }

    reset() {
        this._summary = emptySummary(this._now());
        this._urlHashCounts = new Map();
        this._persist();
    }

    hashUrl(url) {
        return this._crypto
            .createHash('sha256')
            .update(String(url || ''))
            .digest('hex')
            .slice(0, 16);
    }

    hostForUrl(url) {
        try {
            const parsed = new URL(String(url || ''));
            return parsed.hostname || null;
        } catch {
            return null;
        }
    }

    recordRequest(event = {}) {
        const urlHash = event.urlHash || (event.url ? this.hashUrl(event.url) : null);
        const host = event.host || this.hostForUrl(event.url) || null;
        const subsystem = event.sourceSubsystem || event.subsystem || 'unknown';
        const assetType = event.assetType || 'unknown';
        const downloadedBytes = Math.max(0, Number(event.downloadedBytes || 0));
        const cacheHit = event.cacheHit === true;
        const cacheMiss = event.cacheMiss === true || (!cacheHit && event.cacheMiss !== false);
        const failed = event.failed === true || event.error === true;
        const status = Number(event.httpStatus || 0);

        this._summary.sessionRequestCount += 1;
        this._summary.sessionDownloadedBytes += downloadedBytes;
        if (cacheHit) this._summary.cacheHits += 1;
        if (cacheMiss) this._summary.cacheMisses += 1;
        if (status === 304 || event.revalidationResult === '304') this._summary.revalidated304 += 1;
        if (event.inFlightDeduplication === true) this._summary.deduplicatedRequests += 1;
        if (failed) this._summary.failedRequests += 1;
        if (event.rendererDirectRemote === true) this._summary.rendererDirectRemoteRequests += 1;

        const patch = {
            requestCount: 1,
            downloadedBytes,
            cacheHits: cacheHit ? 1 : 0,
            cacheMisses: cacheMiss ? 1 : 0,
            failedRequests: failed ? 1 : 0,
        };
        incrementBucket(this._summary.bySubsystem, subsystem, patch);
        incrementBucket(this._summary.byAssetType, assetType, patch);

        if (urlHash) {
            this._urlHashCounts.set(urlHash, (this._urlHashCounts.get(urlHash) || 0) + 1);
            this._summary.topRepeatedUrlHashes = Array.from(this._urlHashCounts.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, this._maxTopUrlHashes)
                .map(([hash, count]) => ({ hash, count }));
        }

        this._summary.lastEvent = {
            at: this._now().toISOString(),
            urlHash,
            host,
            sourceSubsystem: subsystem,
            reason: event.reason || null,
            canonicalGameId: event.canonicalGameId ? String(event.canonicalGameId) : null,
            assetType,
            httpStatus: event.httpStatus ?? null,
            responseContentLength: event.responseContentLength ?? null,
            downloadedBytes,
            cacheHit,
            cacheMiss,
            revalidationResult: event.revalidationResult || null,
            inFlightDeduplication: event.inFlightDeduplication === true,
            retryCount: Number(event.retryCount || 0),
            elapsedMs: event.elapsedMs ?? null,
            cancellation: event.cancellation === true,
            budgetRejection: event.budgetRejection === true,
            failed,
        };

        this._persist();
        return this.getSummary();
    }

    getSummary() {
        return JSON.parse(JSON.stringify(this._summary));
    }

    _loadPersistedSummary() {
        try {
            if (!this._fs.existsSync(this._summaryFile)) return;
            const raw = this._fs.readFileSync(this._summaryFile, 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                this._summary = { ...emptySummary(this._now()), ...parsed };
                this._urlHashCounts = new Map(
                    (this._summary.topRepeatedUrlHashes || [])
                        .map(item => [item.hash, Number(item.count || 0)])
                        .filter(([hash]) => !!hash)
                );
            }
        } catch {
            this._summary = emptySummary(this._now());
            this._urlHashCounts = new Map();
        }
    }

    _persist() {
        if (!this._summaryFile) return;
        try {
            this._fs.mkdirSync(this._path.dirname(this._summaryFile), { recursive: true });
            const dailySummary = {
                ...this.getSummary(),
                persistedAt: this._now().toISOString(),
            };
            this._fs.writeFileSync(this._summaryFile, JSON.stringify(dailySummary, null, 2), 'utf8');
        } catch {
            // Diagnostics must never affect artwork delivery.
        }
    }
}

const artworkNetworkTelemetry = new ArtworkNetworkTelemetry();

module.exports = {
    ArtworkNetworkTelemetry,
    artworkNetworkTelemetry,
    emptySummary,
};
