'use strict';

class PlatformSyncServerImportService {
    constructor({
        baddelApi,
        syncCacheRepository,
        enqueueWrite = null,
        emitLibraryUpdated = null,
        getWindow = null,
        getAssetDownloader = null,
        sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        random = Math.random,
        logger = {},
        mapWithConcurrency = null,
    } = {}) {
        this.baddelApi = baddelApi;
        this.syncCacheRepository = syncCacheRepository;
        this.enqueueWrite = enqueueWrite;
        this.emitLibraryUpdated = emitLibraryUpdated;
        this.getWindow = getWindow;
        this.getAssetDownloader = getAssetDownloader;
        this.sleep = sleep;
        this.random = random;
        this.logger = logger;
        this.mapWithConcurrency = mapWithConcurrency || this._mapWithConcurrency.bind(this);
        this.localWriteQueue = Promise.resolve();
    }

    _log(...args) {
        if (typeof this.logger.log === 'function') this.logger.log(...args);
    }

    _warn(...args) {
        if (typeof this.logger.warn === 'function') this.logger.warn(...args);
    }

    _consoleLog(...args) {
        if (typeof this.logger.consoleLog === 'function') this.logger.consoleLog(...args);
        else console.log(...args);
    }

    _consoleWarn(...args) {
        if (typeof this.logger.consoleWarn === 'function') this.logger.consoleWarn(...args);
        else console.warn(...args);
    }

    _enqueueWrite(fn) {
        if (typeof this.enqueueWrite === 'function') {
            return this.enqueueWrite(fn);
        }
        this.localWriteQueue = this.localWriteQueue.then(fn);
        return this.localWriteQueue;
    }

    async _mapWithConcurrency(items, limit, mapper) {
        const queue = [...items];
        const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
            while (queue.length) {
                const item = queue.shift();
                await mapper(item);
            }
        });
        await Promise.all(workers);
    }

    _retryAfterMs(err, attempt) {
        if (err?.retryAfter != null) {
            const s = parseInt(err.retryAfter, 10);
            if (!isNaN(s) && s > 0 && s < 600) return s * 1000;
        }
        const base = 10_000;
        const exp  = Math.min(base * Math.pow(2, attempt - 1), 120_000);
        return Math.round(exp * (0.8 + this.random() * 0.4));
    }

    _buildPayload(platform, games) {
        const seen = new Set();
        const payload = [];

        for (const g of games) {
            let id, title;

            if (platform === 'steam') {
                id    = g.appName || (g.id ? String(g.id).replace('steam_', '') : null);
                title = g.title || null;
            } else {
                id    = g.namespace || null;
                title = g.title     || null;
            }

            if (!id) continue;

            const dedupKey = `${platform}:${id}`;
            if (seen.has(dedupKey)) continue;
            seen.add(dedupKey);
            payload.push({ id, title });
        }

        return payload;
    }

    _findLocalLibraryIndex(platform, localLibrary, gameIdExternal) {
        return localLibrary.findIndex(lg => {
            if (platform === 'steam') return String(lg.appName) === String(gameIdExternal);
            return lg.namespace === gameIdExternal || lg.appName === gameIdExternal;
        });
    }

    _applyNormalizedToCache(platform, gameIdExternal, normalized) {
        return this._applyNormalizedBatchToCache(platform, [{ id: gameIdExternal, normalized }]);
    }

    _applyNormalizedBatchToCache(platform, items = []) {
        const normalizedItems = (Array.isArray(items) ? items : [])
            .filter(item => item?.id && item?.normalized && (
                item.normalized.cover || item.normalized.heroImage || item.normalized.logo || item.normalized.info?.releaseDate
            ));
        if (!normalizedItems.length) return Promise.resolve({ updated: 0, writeCount: 0 });

        return this._enqueueWrite(async () => {
            try {
                const localLibrary = await this.syncCacheRepository.readMergedLibrary(platform);
                let updatedCount = 0;
                const downloads = [];

                for (const item of normalizedItems) {
                    const localIdx = this._findLocalLibraryIndex(platform, localLibrary, item.id);
                    if (localIdx === -1) continue;

                    const lg = localLibrary[localIdx];
                    const normalized = item.normalized;
                    let updated = false;
                    if (normalized.cover     && lg.coverUrl !== normalized.cover)     { lg.coverUrl = normalized.cover;     updated = true; }
                    if (normalized.heroImage && lg.heroUrl  !== normalized.heroImage)  { lg.heroUrl  = normalized.heroImage; updated = true; }
                    if (normalized.logo      && lg.logoUrl  !== normalized.logo)       { lg.logoUrl  = normalized.logo;      updated = true; }
                    if (normalized.info?.releaseDate && lg.releaseYear !== normalized.info.releaseDate) { lg.releaseYear = normalized.info.releaseDate; updated = true; }
                    if (!updated) continue;

                    updatedCount += 1;
                    const assetDownloader = this.getAssetDownloader?.();
                    if (assetDownloader && lg.id && (normalized.cover || normalized.heroImage || normalized.logo)) {
                        const gameId = lg.id;
                        const gameTitle = lg.title || gameId;
                        const assets = {
                            cover: normalized.cover || null,
                            hero: normalized.heroImage || null,
                            logo: normalized.logo || null,
                        };
                        downloads.push({ assetDownloader, assets, gameId, gameTitle });
                    }
                }

                if (!updatedCount) return { updated: 0, writeCount: 0 };

                await this.syncCacheRepository.writeMergedLibrary(platform, localLibrary);
                const win = this.getWindow?.();
                this.emitLibraryUpdated?.(win, { platform, changedCount: updatedCount });

                for (const item of downloads) {
                    item.assetDownloader(item.assets, item.gameId, {
                        reason: 'platform-sync-metadata-batch',
                    }).catch(e => this._warn(`[EnrichQueueAssets] ${item.gameTitle} download error:`, e.message));
                }

                return { updated: updatedCount, writeCount: 1 };
            } catch (e) {
                this._consoleWarn('[BaddelAPI] Cache write error:', e.message);
                return { updated: 0, writeCount: 0, error: e.message };
            }
        });
    }

    async _waitAndApplyEnrich(platform, gameIdExternal, initialDelayMs = 8000) {
        await this.sleep(initialDelayMs);
        for (let attempt = 0; attempt < 3; attempt++) {
            const enriched   = await this.baddelApi.lookupGame({ platform, id: gameIdExternal }).catch(() => null);
            const normalized = this.baddelApi.normalizeServerData(enriched);
            if (normalized && (normalized.cover || normalized.heroImage || normalized.logo)) {
                this._applyNormalizedToCache(platform, gameIdExternal, normalized);
                return;
            }
            if (attempt < 2) await this.sleep(15000);
        }
        this._log(`[BaddelAPI] waitAndApplyEnrich: giving up for ${gameIdExternal} after 3 attempts`);
    }

    async importLibraryToServer(platform, games) {
        if (!games || games.length === 0) return;

        const MAX_BATCH_PAGE         = 200;
        const MAX_BATCH_RETRIES      = 4;
        const MAX_ITEM_ERROR_RETRIES = 2;
        const INTER_PAGE_DELAY_MS    = 400;

        const payload = this._buildPayload(platform, games);
        if (payload.length === 0) return;

        const titleMap = new Map(payload.map(g => [g.id, g.title ?? null]));

        const chunks = [];
        for (let i = 0; i < payload.length; i += MAX_BATCH_PAGE) {
            chunks.push(payload.slice(i, i + MAX_BATCH_PAGE));
        }

        const totals = {
            submitted:      payload.length,
            localDedupDropped: games.length - payload.length,
            accepted:       0,
            queued:         0,
            alreadyQueued:  0,
            alreadyExists:  0,
            invalid:        0,
            error:          0,
            serverDedup:    0,
        };

        const needsLookup = new Set();
        const needsPoll   = new Set();
        const errorItems  = new Set();

        this._log(`[BaddelAPI] Batch sync ${platform}: ${payload.length} games → ${chunks.length} page(s)`);

        for (let pageIdx = 0; pageIdx < chunks.length; pageIdx++) {
            const chunk   = chunks[pageIdx];
            let   attempt = 0;
            let   sent    = false;

            while (!sent && attempt <= MAX_BATCH_RETRIES) {
                try {
                    const body = await this.baddelApi.requestGameEnrichBatch(platform, chunk);

                    totals.accepted      += body.acceptedCount      || 0;
                    totals.queued        += body.queuedCount        || 0;
                    totals.alreadyQueued += body.alreadyQueuedCount || 0;
                    totals.alreadyExists += body.alreadyExistsCount || 0;
                    totals.invalid       += body.invalidCount       || 0;
                    totals.error         += body.errorCount         || 0;
                    totals.serverDedup   += body.dedupCount         || 0;

                    for (const r of (body.results || [])) {
                        if (!r.id) continue;
                        if (r.status === 'already_exists' || r.status === 'needs_enrich') {
                            needsLookup.add(r.id);
                        } else if (r.status === 'created_and_queued' || r.status === 'already_queued') {
                            needsPoll.add(r.id);
                        } else if (r.status === 'error') {
                            errorItems.add(r.id);
                        }
                    }

                    sent = true;
                    this._log(`[BaddelAPI] Batch page ${pageIdx + 1}/${chunks.length} OK — accepted:${body.acceptedCount} queued:${body.queuedCount} exists:${body.alreadyExistsCount} invalid:${body.invalidCount} err:${body.errorCount}`);
                } catch (err) {
                    const is429 = err?.status === 429;
                    attempt++;

                    if (!is429) {
                        this._warn(`[BaddelAPI] Batch page ${pageIdx + 1}/${chunks.length} failed (non-429): ${err.message}`);
                        totals.error += chunk.length;
                        break;
                    }

                    if (attempt > MAX_BATCH_RETRIES) {
                        this._warn(`[BaddelAPI] Batch page ${pageIdx + 1}/${chunks.length} gave up after ${MAX_BATCH_RETRIES} 429 retries`);
                        totals.error += chunk.length;
                        break;
                    }

                    const waitMs = this._retryAfterMs(err, attempt);
                    this._consoleWarn(
                        `[BaddelAPI] Batch page ${pageIdx + 1}/${chunks.length} — 429, retry ${attempt}/${MAX_BATCH_RETRIES} ` +
                        `in ${Math.round(waitMs / 1000)}s`
                    );
                    await this.sleep(waitMs);
                }
            }

            if (pageIdx < chunks.length - 1) {
                await this.sleep(INTER_PAGE_DELAY_MS);
            }
        }

        if (errorItems.size > 0) {
            this._log(`[BaddelAPI] Per-item error retry: ${errorItems.size} item(s) eligible, max ${MAX_ITEM_ERROR_RETRIES} pass(es)`);

            let remainingErrors = new Set(errorItems);
            let itemRetryPass   = 0;

            while (remainingErrors.size > 0 && itemRetryPass < MAX_ITEM_ERROR_RETRIES) {
                itemRetryPass++;

                const retryBatch = [...remainingErrors].map(id => ({
                    id,
                    title: titleMap.get(id) ?? undefined,
                }));

                let retryAttempt = 0;
                let retrySent    = false;

                while (!retrySent && retryAttempt <= MAX_BATCH_RETRIES) {
                    try {
                        const retryBody = await this.baddelApi.requestGameEnrichBatch(platform, retryBatch);
                        const stillError = new Set();

                        for (const r of (retryBody.results || [])) {
                            if (!r.id) continue;

                            remainingErrors.delete(r.id);

                            if (r.status === 'already_exists' || r.status === 'needs_enrich') {
                                needsLookup.add(r.id);
                                totals.error = Math.max(0, totals.error - 1);
                                totals.alreadyExists++;
                            } else if (r.status === 'created_and_queued' || r.status === 'already_queued') {
                                needsPoll.add(r.id);
                                totals.error = Math.max(0, totals.error - 1);
                                totals.queued++;
                            } else if (r.status === 'error') {
                                stillError.add(r.id);
                            }
                        }

                        remainingErrors = stillError;
                        retrySent = true;

                        this._consoleLog(
                            `[BaddelAPI] Item-error retry pass ${itemRetryPass}/${MAX_ITEM_ERROR_RETRIES} — ` +
                            `sent:${retryBatch.length} still-error:${stillError.size}`
                        );
                    } catch (retryErr) {
                        const is429 = retryErr?.status === 429;
                        retryAttempt++;

                        if (!is429) {
                            this._consoleWarn(`[BaddelAPI] Item-error retry pass ${itemRetryPass} failed (non-429): ${retryErr.message}`);
                            break;
                        }

                        if (retryAttempt > MAX_BATCH_RETRIES) {
                            this._consoleWarn(`[BaddelAPI] Item-error retry pass ${itemRetryPass} gave up after ${MAX_BATCH_RETRIES} 429 retries`);
                            break;
                        }

                        const waitMs = this._retryAfterMs(retryErr, retryAttempt);
                        this._consoleWarn(
                            `[BaddelAPI] Item-error retry pass ${itemRetryPass} — 429, attempt ${retryAttempt}/${MAX_BATCH_RETRIES} ` +
                            `in ${Math.round(waitMs / 1000)}s`
                        );
                        await this.sleep(waitMs);
                    }
                }
            }

            const finalErrorCount = remainingErrors.size;
            this._consoleLog(
                `[BaddelAPI] Per-item error retry done — ` +
                `originally:${errorItems.size} resolved:${errorItems.size - finalErrorCount} still-failed:${finalErrorCount}`
            );
        }

        this._consoleLog(
            `[BaddelAPI] Batch sync complete for ${platform}:\n` +
            `  total submitted:     ${totals.submitted}\n` +
            `  local dedup dropped: ${totals.localDedupDropped}\n` +
            `  server dedup:        ${totals.serverDedup}\n` +
            `  accepted:            ${totals.accepted}\n` +
            `  queued (new):        ${totals.queued}\n` +
            `  already queued:      ${totals.alreadyQueued}\n` +
            `  already exists:      ${totals.alreadyExists}\n` +
            `  invalid:             ${totals.invalid}\n` +
            `  error (final):       ${totals.error}\n` +
            `  item-error retried:  ${errorItems.size > 0 ? errorItems.size : 0}`
        );

        const lookupIds = [...needsLookup];
        const LOOKUP_APPLY_PAGE = 50;
        for (let i = 0; i < lookupIds.length; i += LOOKUP_APPLY_PAGE) {
            const page = lookupIds.slice(i, i + LOOKUP_APPLY_PAGE);
            const normalizedPage = [];
            await this.mapWithConcurrency(page, 2, async (id) => {
                try {
                    const existing = await this.baddelApi.lookupGame({ platform, id }).catch(() => null);
                    const normalized = this.baddelApi.normalizeServerData(existing);
                    if (normalized && (normalized.cover || normalized.heroImage || normalized.logo)) {
                        normalizedPage.push({ id, normalized });
                    } else if (existing) {
                        this._waitAndApplyEnrich(platform, id, 10000);
                    }
                } catch (err) {
                    this._consoleWarn(`[BaddelAPI] Post-batch lookup failed for ${id}:`, err.message);
                }
            });
            if (normalizedPage.length) await this._applyNormalizedBatchToCache(platform, normalizedPage);
        }

        const pollIds = [...needsPoll];
        for (let i = 0; i < pollIds.length; i += LOOKUP_APPLY_PAGE) {
            for (const id of pollIds.slice(i, i + LOOKUP_APPLY_PAGE)) {
                this._waitAndApplyEnrich(platform, id, 12000);
            }
        }
    }
}

module.exports = {
    PlatformSyncServerImportService,
};
