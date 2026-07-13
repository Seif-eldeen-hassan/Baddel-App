'use strict';

const defaultFs = require('fs').promises;
const defaultFsSync = require('fs');

class PlatformSyncAssetWriteBackService {
    constructor({
        fsDeps = { readFile: (file, enc) => defaultFs.readFile(file, enc), writeFile: (file, data, enc) => defaultFs.writeFile(file, data, enc) },
        existsFn = (file) => defaultFsSync.existsSync(file),
        enqueueWrite = null,
        waitForWrites = null,
        logger = {},
    } = {}) {
        this.fsDeps = fsDeps;
        this.existsFn = existsFn;
        this.enqueueWrite = enqueueWrite;
        this.waitForWrites = waitForWrites;
        this.logger = logger;
        this.localWriteQueue = Promise.resolve();
    }

    _log(...args) {
        if (typeof this.logger.log === 'function') this.logger.log(...args);
    }

    _debug(...args) {
        if (typeof this.logger.debug === 'function') this.logger.debug(...args);
    }

    _enqueueWrite(fn) {
        if (typeof this.enqueueWrite === 'function') {
            return this.enqueueWrite(fn);
        }
        this.localWriteQueue = this.localWriteQueue.then(fn);
        return this.localWriteQueue;
    }

    async _waitForWrites() {
        if (typeof this.waitForWrites === 'function') {
            await this.waitForWrites();
            return;
        }
        await this.localWriteQueue;
    }

    async _withConcurrency(items, fn, concurrency) {
        if (!items.length || concurrency <= 0) return;
        const queue = [...items];
        await Promise.all(
            Array.from({ length: Math.min(concurrency, items.length) }, async () => {
                while (queue.length > 0) {
                    const item = queue.shift();
                    if (item !== undefined) await fn(item);
                }
            })
        );
    }

    _isFileValid(url) {
        if (!url || !String(url).startsWith('file://')) return false;
        const raw = String(url).replace(/^file:\/\/\//, '').replace(/^file:\/\//, '');
        return this.existsFn(raw);
    }

    _getCover(entry) {
        const candidates = [
            entry.coverUrl,
            entry.image,
            entry.defaultImage,
            entry.cover,
            entry.posterUrl,
            entry.boxArtUrl,
        ].filter(Boolean);

        const validLocal = candidates.find((url) => this._isFileValid(url));
        if (validLocal) return validLocal;

        const remote = candidates.find((url) => !String(url).startsWith('file://'));
        if (remote) return remote;

        return candidates[0] || null;
    }

    _setCover(entry, cover) {
        if (!cover) return;
        entry.coverUrl = cover;
        entry.image = cover;
        entry.defaultImage = cover;
        entry._agCoverPipelineDone = true;
        entry._agCoverInFlight = false;
    }

    _getGameKey(entry) {
        return String(
            entry.id ||
            entry.appid ||
            entry.appId ||
            entry.appName ||
            entry.namespace ||
            entry.title ||
            entry.name ||
            ''
        );
    }

    _emitCoverReady(entry, cover, coverCachedEmitter) {
        if (typeof coverCachedEmitter !== 'function' || !cover) return;

        const payload = {
            platform:      entry.platform      || null,
            accountId:     entry.accountId     || null,
            id:            entry.id            || entry.appid || entry.appId || entry.appName || null,
            title:         entry.title         || entry.appName || entry.name || null,
            appid:         entry.appid         || entry.appId || entry.appName || null,
            namespace:     entry.namespace     || null,
            coverUrl:      cover,
            image:         cover,
            defaultImage:  cover,
            _agCoverPipelineDone: true,
        };

        this._debug('EMIT all-games-cover-cached', {
            id: payload.id,
            appid: payload.appid,
            title: payload.title,
            namespace: payload.namespace,
            platform: payload.platform,
            accountId: payload.accountId,
            coverUrl: String(payload.coverUrl || '').startsWith('file://')
                ? 'file://' + String(payload.coverUrl).split(/[\\/]/).pop()
                : payload.coverUrl,
        });
        coverCachedEmitter(payload);
        this._log(`[CoverWarmup] emitted all-games-cover-cached ${payload.id || payload.appid}/${payload.title}`);
    }

    async cacheLibraryCoversFirst({
        entries,
        downloader,
        cacheFile,
        matchFn,
        emitter,
        opts = {},
    }) {
        const {
            coverCachedEmitter       = null,
            existsFn                 = null,
            fsDeps                   = null,
            coverConcurrency         = 10,
            secondaryConcurrency     = 2,
            batchSize                = 20,
            libUpdatedDebounceMs     = 500,
        } = opts;

        if (existsFn) this.existsFn = existsFn;
        if (fsDeps) this.fsDeps = fsDeps;

        this._debug('cacheLibraryCoversFirst START', {
            entries: Array.isArray(entries) ? entries.length : 0,
            cacheFile,
            hasDownloader: typeof downloader === 'function',
            hasCoverEmitter: typeof coverCachedEmitter === 'function',
            hasLibraryEmitter: typeof emitter === 'function',
            coverConcurrency,
            secondaryConcurrency,
            batchSize,
        });

        const pendingUpdates = [];
        const scheduleFlush = () => {
            const batch = pendingUpdates.splice(0);
            this._enqueueWrite(async () => {
                try {
                    if (!batch.length) return;

                    const lib = JSON.parse(
                        await this.fsDeps.readFile(cacheFile, 'utf8').catch(() => '[]')
                    );

                    let changed = false;

                    for (const e of batch) {
                        const idx = matchFn(lib, e);
                        if (idx === -1) continue;

                        if (e.coverUrl !== undefined) {
                            lib[idx].coverUrl = e.coverUrl;
                            changed = true;
                        }

                        if (e.image !== undefined) {
                            lib[idx].image = e.image;
                            changed = true;
                        }

                        if (e.defaultImage !== undefined) {
                            lib[idx].defaultImage = e.defaultImage;
                            changed = true;
                        }

                        if (e._agCoverPipelineDone !== undefined) {
                            lib[idx]._agCoverPipelineDone = e._agCoverPipelineDone;
                            changed = true;
                        }
                    }

                    if (changed) {
                        await this.fsDeps.writeFile(cacheFile, JSON.stringify(lib, null, 2), 'utf8');
                    }
                } catch {}
            });
        };

        const pushPendingUpdate = (entry) => {
            if (!entry) return;
            pendingUpdates.push(entry);
            if (pendingUpdates.length >= batchSize) scheduleFlush();
        };

        let libUpdateTimer = null;
        const debounceLibUpdated = () => {
            if (!emitter) return;
            if (libUpdateTimer) clearTimeout(libUpdateTimer);
            libUpdateTimer = setTimeout(() => {
                emitter();
                libUpdateTimer = null;
            }, libUpdatedDebounceMs);
        };

        for (const entry of entries) {
            if (entry.coverUrl && String(entry.coverUrl).startsWith('file://') && !this._isFileValid(entry.coverUrl)) entry.coverUrl = null;
            if (entry.image && String(entry.image).startsWith('file://') && !this._isFileValid(entry.image)) entry.image = null;
            if (entry.defaultImage && String(entry.defaultImage).startsWith('file://') && !this._isFileValid(entry.defaultImage)) entry.defaultImage = null;
            if (entry.cover && String(entry.cover).startsWith('file://') && !this._isFileValid(entry.cover)) entry.cover = null;
            if (entry.posterUrl && String(entry.posterUrl).startsWith('file://') && !this._isFileValid(entry.posterUrl)) entry.posterUrl = null;
            if (entry.boxArtUrl && String(entry.boxArtUrl).startsWith('file://') && !this._isFileValid(entry.boxArtUrl)) entry.boxArtUrl = null;
            if (entry.heroUrl && String(entry.heroUrl).startsWith('file://') && !this._isFileValid(entry.heroUrl)) entry.heroUrl = null;
            if (entry.logoUrl && String(entry.logoUrl).startsWith('file://') && !this._isFileValid(entry.logoUrl)) entry.logoUrl = null;
        }

        let alreadyReadyCount = 0;

        for (const entry of entries) {
            if (entry.customArtworkLocked) continue;

            const cover = this._getCover(entry);

            if (this._isFileValid(cover)) {
                this._setCover(entry, cover);
                alreadyReadyCount++;

                this._emitCoverReady(entry, cover, coverCachedEmitter);
                pushPendingUpdate(entry);
            }
        }

        if (alreadyReadyCount > 0) {
            this._log(`[CoverWarmup] emitted ${alreadyReadyCount} already-cached covers`);
        }

        const coverTargets = entries.filter(e => {
            if (e.customArtworkLocked) return false;

            const cover = this._getCover(e);
            if (!cover) return false;
            if (this._isFileValid(cover)) return false;

            return !String(cover).startsWith('file://');
        });

        const total = coverTargets.length;
        this._log(`[CoverWarmup] queued ${total} covers`);

        let cachedCount = 0;

        const processOneCover = async (entry) => {
            const gameId = this._getGameKey(entry);
            const sourceCover = this._getCover(entry);

            if (!gameId || !sourceCover) return;

            try {
                entry._agCoverInFlight = true;
                this._debug('DOWNLOAD cover START', {
                    gameId,
                    title: entry.title || entry.appName || entry.name,
                    sourceKind: String(sourceCover || '').startsWith('file://') ? 'file' : 'remote',
                    sourceCover: String(sourceCover || '').slice(0, 160),
                });
                const result = await downloader({ cover: sourceCover }, gameId);
                this._debug('DOWNLOAD cover RESULT', {
                    gameId,
                    title: entry.title || entry.appName || entry.name,
                    hasCover: !!result?.cover,
                    coverKind: String(result?.cover || '').startsWith('file://') ? 'file' : (result?.cover ? 'remote/other' : 'none'),
                    cover: String(result?.cover || '').startsWith('file://')
                        ? 'file://' + String(result.cover).split(/[\\/]/).pop()
                        : String(result?.cover || '').slice(0, 160),
                });

                if (result?.cover && String(result.cover).startsWith('file://')) {
                    this._setCover(entry, result.cover);

                    cachedCount++;
                    this._log(`[CoverWarmup] cached cover ${cachedCount}/${total} "${entry.title || entry.appName || gameId}" ${result.cover}`);

                    this._emitCoverReady(entry, result.cover, coverCachedEmitter);

                    pushPendingUpdate(entry);
                    debounceLibUpdated();
                }
            } catch (e) {
                entry._agCoverInFlight = false;
                this._log(`[CoverWarmup] cover failed for "${entry.title || entry.appName || gameId}": ${e.message}`);
            }
        };

        await this._withConcurrency(coverTargets, processOneCover, coverConcurrency);

        scheduleFlush();

        if (libUpdateTimer) {
            clearTimeout(libUpdateTimer);
            libUpdateTimer = null;
            if (emitter) emitter();
        }

        await this._waitForWrites();

        const secondaryTargets = entries.filter(e =>
            !e.customArtworkLocked && (
                (e.heroUrl && !String(e.heroUrl).startsWith('file://')) ||
                (e.logoUrl && !String(e.logoUrl).startsWith('file://'))
            )
        );

        const processOneSecondary = async (entry) => {
            const gameId = this._getGameKey(entry);
            if (!gameId) return;

            const assets = {};

            if (entry.heroUrl && !String(entry.heroUrl).startsWith('file://')) {
                assets.hero = entry.heroUrl;
            }

            if (entry.logoUrl && !String(entry.logoUrl).startsWith('file://')) {
                assets.logo = entry.logoUrl;
            }

            if (!Object.keys(assets).length) return;

            try {
                const result = await downloader(assets, gameId);
                let changed = false;

                if (result?.hero && String(result.hero).startsWith('file://')) {
                    entry.heroUrl = result.hero;
                    entry.heroImage = result.hero;
                    changed = true;
                }

                if (result?.logo && String(result.logo).startsWith('file://')) {
                    entry.logoUrl = result.logo;
                    entry.logo = result.logo;
                    changed = true;
                }

                if (changed) {
                    this._enqueueWrite(async () => {
                        try {
                            const lib = JSON.parse(
                                await this.fsDeps.readFile(cacheFile, 'utf8').catch(() => '[]')
                            );

                            const idx = matchFn(lib, entry);

                            if (idx !== -1) {
                                if (entry.heroUrl?.startsWith?.('file://')) {
                                    lib[idx].heroUrl = entry.heroUrl;
                                    lib[idx].heroImage = entry.heroUrl;
                                }

                                if (entry.logoUrl?.startsWith?.('file://')) {
                                    lib[idx].logoUrl = entry.logoUrl;
                                    lib[idx].logo = entry.logoUrl;
                                }

                                await this.fsDeps.writeFile(cacheFile, JSON.stringify(lib, null, 2), 'utf8');
                            }
                        } catch {}
                    });
                }
            } catch {}
        };

        this._withConcurrency(secondaryTargets, processOneSecondary, secondaryConcurrency).catch(() => {});
    }
}

module.exports = {
    PlatformSyncAssetWriteBackService,
};
