'use strict';

const { artworkNetworkTelemetry: defaultTelemetry } = require('./ArtworkNetworkTelemetry');
const {
    ARTWORK_DOWNLOAD_PRIORITIES,
} = require('./ArtworkDownloadScheduler');
const { optimizeArtworkSourceUrl } = require('./ArtworkSourceUrlPolicy');

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
    }

    async downloadAsset({
        sourceUrl,
        canonicalGameId,
        type,
        priority = ARTWORK_DOWNLOAD_PRIORITIES.BACKGROUND,
        reason = 'artwork-download-manager',
        sourceSubsystem = 'artwork-download-manager',
        rendererDirectRemote = false,
    } = {}) {
        if (!sourceUrl || !canonicalGameId || !type) return sourceUrl || null;
        if (this._isLocalOrEmbedded(sourceUrl)) return sourceUrl;

        const startedAt = Date.now();
        const cached = this._cache.lookupUrl(sourceUrl, { canonicalGameId, type });
        if (cached) {
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
            return cached.fileUrl;
        }

        const policyDecision = this._bandwidthPolicy?.evaluate?.({ priority, type, sourceUrl });
        if (policyDecision && policyDecision.allowed === false) {
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
                downloadedBytes: 0,
                elapsedMs: Date.now() - startedAt,
            });
            return sourceUrl;
        }

        try {
            const urlHash = this._cache.hashUrl(sourceUrl);
            const requestUrl = optimizeArtworkSourceUrl(sourceUrl, { type, priority });
            const result = await this._scheduler.enqueue({
                key: `url:${urlHash}`,
                priority,
                sourceUrl,
                requestUrl,
                canonicalGameId,
                type,
                run: async () => {
                    const http = await this._httpClient.fetchImage({ url: requestUrl });
                    if (http.notModified) {
                        throw new Error('Artwork returned HTTP 304 without an existing cached asset.');
                    }
                    const stored = this._cache.storeBuffer({
                        sourceUrl,
                        canonicalGameId,
                        type,
                        buffer: http.buffer,
                        mime: http.mime,
                    });
                    return { ...stored, http };
                },
            });
            const linked = this._cache.linkAlias({
                assetHash: result.assetHash,
                canonicalGameId,
                type,
            }) || result;
            this._record({
                sourceUrl,
                canonicalGameId,
                type,
                reason,
                sourceSubsystem,
                rendererDirectRemote,
                cacheHit: false,
                cacheMiss: true,
                downloadedBytes: result.http?.bytes || result.bytes || 0,
                responseContentLength: result.http?.bytes || result.bytes || 0,
                httpStatus: result.http?.status || null,
                elapsedMs: Date.now() - startedAt,
            });
            this._bandwidthPolicy?.recordDownload?.({
                priority,
                type,
                bytes: result.http?.bytes || result.bytes || 0,
            });
            return linked.fileUrl;
        } catch (err) {
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
            try { this._logger.warn?.(`[ArtworkDownloadManager] ${type} for ${canonicalGameId}:`, err.message); } catch {}
            return sourceUrl;
        }
    }

    async downloadAssets(assets = {}, canonicalGameId, options = {}) {
        const results = {};
        await Promise.all(Object.entries(assets || {}).map(async ([type, sourceUrl]) => {
            if (!sourceUrl) return;
            results[type] = await this.downloadAsset({
                sourceUrl,
                canonicalGameId,
                type,
                ...options,
            });
        }));
        return results;
    }

    getCachedAsset({ canonicalGameId, type } = {}) {
        if (!canonicalGameId || !type) return null;
        return this._cache.lookupAlias({ canonicalGameId, type });
    }

    getStats() {
        return {
            cache: this._cache.getManifest().stats,
            scheduler: this._scheduler.getStats(),
            bandwidthPolicy: this._bandwidthPolicy?.getStats?.() || null,
        };
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

    _isLocalOrEmbedded(value) {
        return String(value || '').startsWith('file://') ||
            String(value || '').startsWith('data:') ||
            String(value || '').startsWith('assets/');
    }
}

module.exports = {
    ArtworkDownloadManager,
    ARTWORK_DOWNLOAD_PRIORITIES,
};
