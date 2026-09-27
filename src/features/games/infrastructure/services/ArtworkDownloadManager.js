'use strict';

const { artworkNetworkTelemetry: defaultTelemetry } = require('./ArtworkNetworkTelemetry');
const {
    ARTWORK_DOWNLOAD_PRIORITIES,
} = require('./ArtworkDownloadScheduler');
const { optimizeArtworkSourceUrl } = require('./ArtworkSourceUrlPolicy');
const { ARTWORK_CACHE_CLASSES, DEFAULT_COVER_UPPER_BOUND_BYTES } = require('./ContentAddressedArtworkCache');
let sharp = null;
try { sharp = require('sharp'); } catch {}

const VERBOSE_LOGS = process.env.BADDEL_VERBOSE_LOGS === '1';

class ArtworkDownloadManager {
    constructor({
        cache,
        scheduler,
        httpClient,
        bandwidthPolicy = null,
        telemetry = defaultTelemetry,
        logger = console,
    } = {}) {
        if (!cache) throw new Error('ArtworkDownloadManager requires a content-addressed cache.');
        if (!scheduler) throw new Error('ArtworkDownloadManager requires an artwork download scheduler.');
        if (!httpClient) throw new Error('ArtworkDownloadManager requires an artwork HTTP client.');
        this._cache = cache;
        this._scheduler = scheduler;
        this._httpClient = httpClient;
        this._bandwidthPolicy = bandwidthPolicy;
        this._telemetry = telemetry;
        this._logger = logger;
        this._stats = {
            downloadedBytes: 0,
            cacheHits: 0,
            cacheMisses: 0,
            budgetRejections: 0,
            skipped: 0,
            failed: 0,
            ipcValidationFailures: 0,
            retryCount: 0,
            terminalErrorCount: 0,
            normalizedCovers: 0,
            normalizedCoverBytesIn: 0,
            normalizedCoverBytesOut: 0,
            capacityExhausted: 0,
            oversizedCoverMigrations: 0,
        };
    }

    async downloadAsset({
        structured = false,
        sourceUrl,
        canonicalGameId,
        type,
        priority = ARTWORK_DOWNLOAD_PRIORITIES.BACKGROUND,
        reason = 'artwork-download-manager',
        sourceSubsystem = 'artwork-download-manager',
        rendererDirectRemote = false,
        activeLibraryGameCount = null,
    } = {}) {
        const result = await this.requestAsset({
            sourceUrl,
            canonicalGameId,
            type,
            priority,
            reason,
            sourceSubsystem,
            rendererDirectRemote,
            activeLibraryGameCount,
        });
        if (structured) return result;
        return result.localUrl || null;
    }

    async requestAsset({
        sourceUrl,
        canonicalGameId,
        type,
        priority = ARTWORK_DOWNLOAD_PRIORITIES.BACKGROUND,
        reason = 'artwork-download-manager',
        sourceSubsystem = 'artwork-download-manager',
        rendererDirectRemote = false,
        activeLibraryGameCount = null,
    } = {}) {
        if (!sourceUrl || !canonicalGameId || !type) {
            return {
                status: 'skipped',
                localUrl: this._isLocalOrEmbedded(sourceUrl) ? sourceUrl : null,
                remoteCandidate: this._isRemote(sourceUrl) ? sourceUrl : null,
                blockedReason: 'missing-required-fields',
                skipReason: 'missing-required-fields',
                budgetRejection: false,
                errorCode: null,
            };
        }
        if (this._isLocalOrEmbedded(sourceUrl)) {
            return {
                status: 'local',
                localUrl: sourceUrl,
                remoteCandidate: null,
                blockedReason: null,
                skipReason: null,
                budgetRejection: false,
                errorCode: null,
            };
        }

        const startedAt = Date.now();
        let queuedAt = null;
        let httpStartedAt = null;
        let httpFinishedAt = null;
        let normalizeStartedAt = null;
        let normalizeFinishedAt = null;
        let storeStartedAt = null;
        let storeFinishedAt = null;
        const cached = this._cache.lookupUrl(sourceUrl, { canonicalGameId, type });
        if (cached) {
            this._stats.cacheHits += 1;
            this._record({
                sourceUrl,
                canonicalGameId,
                type,
                reason,
                sourceSubsystem,
                rendererDirectRemote,
                cacheHit: true,
                cacheMiss: false,
                downloadedBytes: 0,
                elapsedMs: Date.now() - startedAt,
            });
            return {
                status: 'cache-hit',
                localUrl: cached.fileUrl,
                remoteCandidate: sourceUrl,
                blockedReason: null,
                skipReason: null,
                budgetRejection: false,
                errorCode: null,
            };
        }

        const assetClass = this._artworkClassFor({ type, priority });
        const preflight = this._cache.preflightStore?.({
            type,
            assetClass,
            estimatedBytes: type === 'cover' ? DEFAULT_COVER_UPPER_BOUND_BYTES : 0,
            activeLibraryGameCount,
        });
        if (preflight && preflight.allowed === false) {
            this._stats.cacheMisses += 1;
            this._stats.skipped += 1;
            this._stats.capacityExhausted += 1;
            this._record({
                sourceUrl, canonicalGameId, type, reason, sourceSubsystem, rendererDirectRemote,
                cacheHit: false, cacheMiss: true, skipped: true, skipReason: preflight.reason,
                errorCode: 'capacity_exhausted', downloadedBytes: 0, elapsedMs: Date.now() - startedAt,
            });
            return {
                status: 'blocked', localUrl: null, remoteCandidate: sourceUrl, blockedReason: preflight.reason,
                skipReason: preflight.reason, budgetRejection: false, errorCode: 'capacity_exhausted',
            };
        }

        const policyDecision = this._bandwidthPolicy?.evaluate?.({ priority, type, sourceUrl });
        if (policyDecision && policyDecision.allowed === false) {
            this._stats.cacheMisses += 1;
            this._stats.skipped += 1;
            this._stats.budgetRejections += 1;
            this._record({
                sourceUrl,
                canonicalGameId,
                type,
                reason,
                sourceSubsystem,
                rendererDirectRemote,
                cacheHit: false,
                cacheMiss: true,
                skipped: true,
                skipReason: policyDecision.reason,
                budgetRejection: true,
                downloadedBytes: 0,
                elapsedMs: Date.now() - startedAt,
            });
            return {
                status: 'blocked',
                localUrl: null,
                remoteCandidate: sourceUrl,
                blockedReason: policyDecision.reason,
                skipReason: policyDecision.reason,
                budgetRejection: true,
                errorCode: null,
            };
        }

        try {
            const urlHash = this._cache.hashUrl(sourceUrl);
            const schedulerKey = `url:${urlHash}`;
            const inFlightDeduplication = this._scheduler.hasTask?.(schedulerKey) === true;
            const requestUrl = optimizeArtworkSourceUrl(sourceUrl, { type, priority });
            queuedAt = Date.now();
            const result = await this._scheduler.enqueue({
                key: schedulerKey,
                priority,
                sourceUrl,
                requestUrl,
                canonicalGameId,
                type,
                run: async () => {
                    const queueWaitMs = queuedAt ? Date.now() - queuedAt : 0;
                    httpStartedAt = Date.now();
                    const http = await this._httpClient.fetchImage({ url: requestUrl });
                    httpFinishedAt = Date.now();
                    if (http.notModified) {
                        throw new Error('Artwork returned HTTP 304 without an existing cached asset.');
                    }
                    normalizeStartedAt = Date.now();
                    const prepared = await this._prepareBufferForCache({ buffer: http.buffer, mime: http.mime, type });
                    normalizeFinishedAt = Date.now();
                    const actualPreflight = this._cache.preflightStore?.({
                        type,
                        assetClass,
                        estimatedBytes: prepared.buffer?.length || http.bytes || 0,
                        activeLibraryGameCount,
                    });
                    if (actualPreflight && actualPreflight.allowed === false) {
                        const err = new Error(actualPreflight.reason || 'capacity_exhausted');
                        err.code = 'capacity_exhausted';
                        throw err;
                    }
                    storeStartedAt = Date.now();
                    const stored = this._cache.storeBuffer({
                        sourceUrl,
                        canonicalGameId,
                        type,
                        buffer: prepared.buffer,
                        mime: prepared.mime || http.mime,
                        assetClass,
                        variant: prepared.variant || null,
                        normalized: prepared.normalized === true,
                        originalBytes: http.bytes || http.buffer?.length || null,
                    });
                    storeFinishedAt = Date.now();
                    if (prepared.normalized) {
                        this._stats.normalizedCovers += 1;
                        this._stats.normalizedCoverBytesIn += prepared.originalBytes || 0;
                        this._stats.normalizedCoverBytesOut += prepared.buffer?.length || 0;
                    }
                    return { ...stored, http, timings: {
                        queueWaitMs,
                        httpDownloadMs: httpFinishedAt && httpStartedAt ? httpFinishedAt - httpStartedAt : 0,
                        coverNormalizationMs: normalizeFinishedAt && normalizeStartedAt ? normalizeFinishedAt - normalizeStartedAt : 0,
                        cacheStoreMs: storeFinishedAt && storeStartedAt ? storeFinishedAt - storeStartedAt : 0,
                    } };
                },
            });
            const linked = this._cache.linkAlias({
                assetHash: result.assetHash,
                canonicalGameId,
                type,
            }) || result;
            const downloadedBytes = inFlightDeduplication ? 0 : (result.http?.bytes || result.bytes || 0);
            this._stats.cacheMisses += 1;
            this._stats.downloadedBytes += downloadedBytes;
            this._record({
                sourceUrl,
                canonicalGameId,
                type,
                reason,
                sourceSubsystem,
                rendererDirectRemote,
                cacheHit: false,
                cacheMiss: true,
                inFlightDeduplication,
                downloadedBytes,
                responseContentLength: downloadedBytes,
                httpStatus: result.http?.status || null,
                queueWaitMs: result.timings?.queueWaitMs || 0,
                httpDownloadMs: result.timings?.httpDownloadMs || 0,
                coverNormalizationMs: result.timings?.coverNormalizationMs || 0,
                cacheStoreMs: result.timings?.cacheStoreMs || 0,
                elapsedMs: Date.now() - startedAt,
            });
            if (!inFlightDeduplication) {
                this._bandwidthPolicy?.recordDownload?.({
                    priority,
                    type,
                    bytes: result.http?.bytes || result.bytes || 0,
                });
            }
            return {
                status: inFlightDeduplication ? 'deduplicated' : 'downloaded',
                localUrl: linked.fileUrl,
                remoteCandidate: sourceUrl,
                blockedReason: null,
                skipReason: null,
                budgetRejection: false,
                errorCode: null,
            };
        } catch (err) {
            this._stats.cacheMisses += 1;
            this._stats.failed += 1;
            if (err?.code === 'capacity_exhausted') this._stats.capacityExhausted += 1;
            this._record({
                sourceUrl,
                canonicalGameId,
                type,
                reason,
                sourceSubsystem,
                rendererDirectRemote,
                cacheHit: false,
                cacheMiss: true,
                failed: true,
                downloadedBytes: 0,
                elapsedMs: Date.now() - startedAt,
            });
            if (VERBOSE_LOGS) {
                try { this._logger.warn?.(`[ArtworkDownloadManager] ${type} for ${canonicalGameId}:`, err.message); } catch {}
            }
            return {
                status: 'failed',
                localUrl: null,
                remoteCandidate: sourceUrl,
                blockedReason: null,
                skipReason: null,
                budgetRejection: false,
                errorCode: err?.code || err?.message || 'artwork-download-failed',
            };
        }
    }

    async downloadAssets(assets = {}, canonicalGameId, options = {}) {
        const results = {};
        const entries = Object.entries(assets || {}).filter(([, sourceUrl]) => sourceUrl);
        entries.sort(([a], [b]) => (a === 'cover' ? -1 : b === 'cover' ? 1 : 0));
        for (const [type, sourceUrl] of entries) {
            const interactive = [
                ARTWORK_DOWNLOAD_PRIORITIES.GAME_DETAILS,
                ARTWORK_DOWNLOAD_PRIORITIES.VISIBLE,
            ].includes(options.priority);
            const secondaryOptions = type === 'cover' ? options : {
                ...options,
                priority: interactive
                    ? options.priority
                    : ARTWORK_DOWNLOAD_PRIORITIES.BACKGROUND,
            };
            results[type] = await this.downloadAsset({
                sourceUrl,
                canonicalGameId,
                type,
                ...secondaryOptions,
            });
        }
        return results;
    }

    getCachedAsset({ canonicalGameId, type } = {}) {
        if (!canonicalGameId || !type) return null;
        return this._cache.lookupAlias({ canonicalGameId, type });
    }

    getCachedAssetByFileUrl(fileUrl, options = {}) {
        return this._cache.lookupFileUrl?.(fileUrl, options) || null;
    }

    getCacheGeneration() {
        return this._cache.getGeneration?.() || null;
    }

    linkCachedAliases({ assetHash, canonicalGameIds, type } = {}) {
        if (!assetHash || !Array.isArray(canonicalGameIds) || !type) return null;
        return this._cache.linkAliases({ assetHash, canonicalGameIds, type });
    }

    linkCachedAlias({ assetHash, canonicalGameId, type } = {}) {
        if (!assetHash || !canonicalGameId || !type) return null;
        return this._cache.linkAlias?.({ assetHash, canonicalGameId, type }) || null;
    }

    recordIpcValidationFailure() {
        this._stats.ipcValidationFailures += 1;
    }

    recordTerminalError() {
        this._stats.terminalErrorCount += 1;
    }

    beginManifestTransaction(options = {}) {
        return this._cache.beginManifestTransaction?.(options) || { active: false, reason: 'cache-transaction-unavailable' };
    }

    commitManifestTransaction(options = {}) {
        return this._cache.commitManifestTransaction?.(options) || { committed: false, reason: 'cache-transaction-unavailable' };
    }

    async withManifestTransaction(options, fn) {
        if (typeof this._cache.withManifestTransaction === 'function') {
            return this._cache.withManifestTransaction(options, fn);
        }
        return fn();
    }

    getStats() {
        const schedulerSnapshot = this._scheduler.getSnapshot?.() || null;
        const schedulerStats = schedulerSnapshot?.stats || this._scheduler.getStats();
        const bandwidthPolicy = this._bandwidthPolicy?.getStats?.() || null;
        return {
            cache: this._cache.getManifest().stats,
            scheduler: schedulerStats,
            schedulerSnapshot,
            bandwidthPolicy,
            downloadedBytes: this._stats.downloadedBytes,
            currentBudget: bandwidthPolicy ? {
                usedBytes: bandwidthPolicy.automaticBytes,
                maxAutomaticBytes: bandwidthPolicy.maxAutomaticBytes,
                dataSaverMaxAutomaticBytes: bandwidthPolicy.dataSaverMaxAutomaticBytes,
            } : null,
            budgetRejections: this._stats.budgetRejections,
            activeDownloads: schedulerSnapshot?.active ?? schedulerStats.active ?? 0,
            queuedDownloads: Array.isArray(schedulerSnapshot?.pending) ? schedulerSnapshot.pending.length : 0,
            cacheHits: this._stats.cacheHits,
            cacheMisses: this._stats.cacheMisses,
            ipcValidationFailures: this._stats.ipcValidationFailures,
            retryCount: this._stats.retryCount,
            terminalErrorCount: this._stats.terminalErrorCount,
            normalizedCovers: this._stats.normalizedCovers,
            normalizedCoverBytesIn: this._stats.normalizedCoverBytesIn,
            normalizedCoverBytesOut: this._stats.normalizedCoverBytesOut,
            capacityExhausted: this._stats.capacityExhausted,
            oversizedCoverMigrations: this._stats.oversizedCoverMigrations,
            capacity: this._cache.getCapacityStats?.() || null,
        };
    }

    async migrateOneOversizedActiveCover() {
        const result = await this._cache.migrateOneOversizedActiveCover?.({
            normalizer: ({ buffer }) => this._normalizeCoverBuffer({ buffer, mime: null }),
            minBytes: DEFAULT_COVER_UPPER_BOUND_BYTES,
        });
        if (result?.migrated) this._stats.oversizedCoverMigrations += 1;
        return result || { migrated: false, reason: 'cache-migration-unavailable' };
    }

    async migrateOversizedActiveCovers({ batchSize = 50, maxAssets = Infinity } = {}) {
        return this.withManifestTransaction({ label: 'oversized-cover-migration', batchSize }, async () => {
            const summary = { migrated: 0, skipped: 0, failures: 0, bytesSaved: 0, lastReason: null };
            const limit = Number.isFinite(Number(maxAssets)) ? Math.max(0, Number(maxAssets)) : Infinity;
            while (summary.migrated < limit) {
                let result;
                try {
                    result = await this.migrateOneOversizedActiveCover();
                } catch (err) {
                    summary.failures += 1;
                    summary.lastReason = err?.message || 'migration-failed';
                    break;
                }
                if (!result?.migrated) {
                    summary.lastReason = result?.reason || 'complete';
                    break;
                }
                summary.migrated += 1;
                summary.bytesSaved += Math.max(0, Number(result.bytesSaved || 0));
            }
            return summary;
        });
    }

    _record({
        sourceUrl,
        canonicalGameId,
        type,
        reason,
        sourceSubsystem,
        rendererDirectRemote,
        ...patch
    }) {
        this._telemetry?.recordRequest?.({
            url: sourceUrl,
            canonicalGameId,
            assetType: type,
            reason,
            sourceSubsystem,
            rendererDirectRemote,
            ...patch,
        });
    }

    async _prepareBufferForCache({ buffer, mime, type }) {
        if (String(type || '').toLowerCase() !== 'cover') {
            return { buffer, mime, normalized: false, originalBytes: buffer?.length || 0 };
        }
        return this._normalizeCoverBuffer({ buffer, mime });
    }

    async _normalizeCoverBuffer({ buffer, mime = null }) {
        const originalBytes = buffer?.length || 0;
        if (!sharp || !buffer) return { buffer, mime, normalized: false, originalBytes };
        try {
            if (String(mime || '').toLowerCase() === 'image/webp' && originalBytes <= 200 * 1024) {
                const meta = await sharp(buffer, { failOn: 'none' }).metadata();
                if ((meta.width || 0) <= 384 && (meta.height || 0) <= 576) {
                    return { buffer, mime: 'image/webp', normalized: false, originalBytes, variant: 'card-cover-existing-webp' };
                }
            }
        } catch {}
        const qualities = [82, 76, 70, 64, 58];
        let best = null;
        for (const quality of qualities) {
            try {
                const out = await sharp(buffer, { failOn: 'none' })
                    .rotate()
                    .resize({ width: 384, height: 576, fit: 'cover', withoutEnlargement: true })
                    .webp({ quality, effort: 4 })
                    .toBuffer();
                if (!best || out.length < best.buffer.length) best = { buffer: out, mime: 'image/webp', normalized: true, originalBytes, quality, variant: 'card-cover-384x576-webp' };
                if (out.length <= 200 * 1024) break;
            } catch (err) {
                if (VERBOSE_LOGS) {
                    try { this._logger.warn?.('[ArtworkDownloadManager] cover normalization failed:', err?.message || err); } catch {}
                }
                return { buffer, mime, normalized: false, originalBytes };
            }
        }
        if (!best) return { buffer, mime, normalized: false, originalBytes };
        if (best.buffer.length > 500 * 1024 && originalBytes > 0 && originalBytes < best.buffer.length) {
            return { buffer, mime, normalized: false, originalBytes };
        }
        return best;
    }

    _artworkClassFor({ type, priority }) {
        if (String(type || '').toLowerCase() === 'cover' && (
            priority === ARTWORK_DOWNLOAD_PRIORITIES.LIBRARY_COVER_HYDRATION ||
            priority === ARTWORK_DOWNLOAD_PRIORITIES.VISIBLE ||
            priority === ARTWORK_DOWNLOAD_PRIORITIES.PREWARM
        )) {
            return ARTWORK_CACHE_CLASSES.ACTIVE_LIBRARY_COVER;
        }
        if (String(type || '').toLowerCase() === 'cover') return ARTWORK_CACHE_CLASSES.ACTIVE_LIBRARY_COVER;
        return ARTWORK_CACHE_CLASSES.SECONDARY;
    }

    _isLocalOrEmbedded(value) {
        return String(value || '').startsWith('file://') ||
            String(value || '').startsWith('data:') ||
            String(value || '').startsWith('assets/');
    }

    _isRemote(value) {
        return /^https?:\/\//i.test(String(value || '').trim());
    }
}

module.exports = {
    ArtworkDownloadManager,
    ARTWORK_DOWNLOAD_PRIORITIES,
};
