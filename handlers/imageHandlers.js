'use strict';

// Image/cache-related IPC handlers extracted from main.js.
// All behaviour is verbatim — only outer-scope references are threaded through deps.
//
// deps shape:
//   { app, path, fs, dialog, imageWebpCache, artworkDownloadManager, coldCoverBootstrapService, gridArtworkThumbnailCache, ipcValidation, fileURLToPath,
//     getSavedGames, getMainWindow,
//     _collectImageCacheIdsFromGame, _readReadyToInstallProtectedImageIds,
//     IMAGE_CACHE_PRUNE_GRACE_MS, updateGameImage, setGameArtwork, resetGameArtwork, resetGameImage }
//
//   fs            — require('fs').promises
//   getMainWindow — () => mainWindow  (mainWindow is mutable, must be a getter)

const VERBOSE_LOGS = process.env.BADDEL_VERBOSE_LOGS === '1';
function coverDebugLog(...args) { if (VERBOSE_LOGS) console.log(...args); }
function coverDebugWarn(...args) { if (VERBOSE_LOGS) console.warn(...args); }

function _auditShortHash(value) {
    const text = String(value || '').trim();
    if (!text) return null;
    try {
        return require('crypto').createHash('sha256').update(text).digest('hex').slice(0, 12);
    } catch {
        return null;
    }
}

function _emptyArtworkPersistenceAuditSampleBucket() {
    return {
        valid_alias_hit: [],
        stored_file_url_exists: [],
        stored_file_url_missing: [],
        alias_points_to_missing_file: [],
        alias_miss_but_url_hash_hit: [],
        remote_candidate_only: [],
        no_artwork_source: [],
        identity_mismatch: [],
    };
}

function _pushAuditSample(samples, category, sample, limit = 8) {
    if (!samples[category]) samples[category] = [];
    if (samples[category].length < limit) samples[category].push(sample);
}

function _auditFileUrl(fileURLToPath, fsSync, fileUrl) {
    const out = { url: fileUrl || null, isFileUrl: false, exists: false, size: 0, path: null, error: null };
    if (!fileUrl || !String(fileUrl).startsWith('file://')) return out;
    out.isFileUrl = true;
    try {
        const filePath = fileURLToPath(fileUrl);
        out.path = filePath;
        const st = fsSync.statSync(filePath);
        out.exists = st.isFile() && st.size > 0;
        out.size = st.size;
    } catch (err) {
        out.error = err?.code || err?.message || String(err);
    }
    return out;
}

function _auditAddCount(target, key, amount = 1) {
    const safeKey = key || 'unknown';
    target[safeKey] = Number(target[safeKey] || 0) + amount;
}


module.exports.register = function registerImageHandlers(ipcMain, deps) {
    const {
        app, path, fs, dialog, imageWebpCache, artworkDownloadManager, coldCoverBootstrapService, gridArtworkThumbnailCache, ipcValidation, fileURLToPath,
        getSavedGames, getMainWindow,
        _collectImageCacheIdsFromGame, _readReadyToInstallProtectedImageIds,
        IMAGE_CACHE_PRUNE_GRACE_MS, updateGameImage, setGameArtwork, resetGameArtwork, resetGameImage,
    } = deps;

    // ---- Synchronous IPC: cache dir URL (used before any renderer script runs) ----
    // ipcMain.on (not .handle) because preload exposes this synchronously via returnValue.
    ipcMain.on('get-image-cache-dir-url-sync', (event) => {
        try {
            const dir = path.join(app.getPath('userData'), 'image_cache');
            event.returnValue = imageWebpCache.filePathToFileUrl(dir) + '/';
        } catch (err) {
            console.warn('[Main] get-image-cache-dir-url-sync failed:', err && err.message);
            event.returnValue = '';
        }
    });

    ipcMain.on('get-user-artwork-dir-url-sync', (event) => {
        try {
            const dir = path.join(app.getPath('userData'), 'user_artwork');
            event.returnValue = imageWebpCache.filePathToFileUrl(dir) + '/';
        } catch (err) {
            console.warn('[Main] get-user-artwork-dir-url-sync failed:', err && err.message);
            event.returnValue = '';
        }
    });

    ipcMain.on('get-artwork-cache-dir-url-sync', (event) => {
        try {
            const dir = path.join(app.getPath('userData'), 'artwork-cache-v2');
            event.returnValue = imageWebpCache.filePathToFileUrl(dir) + '/';
        } catch (err) {
            console.warn('[Main] get-artwork-cache-dir-url-sync failed:', err && err.message);
            event.returnValue = '';
        }
    });

    const _isRemoteArtworkUrl = value => /^https?:\/\//i.test(String(value || '').trim());
    const _localOrNull = value => {
        if (!value || _isRemoteArtworkUrl(value)) return null;
        return value;
    };
    const _filterCachedAssetResult = assets => Object.fromEntries(
        Object.entries(assets || {}).map(([type, value]) => {
            if (value && typeof value === 'object' && value.status === 'error') return [type, value];
            return [type, _localOrNull(value)];
        })
    );
    const _structuredOrLocal = (result, structured = false) => {
        if (structured && result && typeof result === 'object') return result;
        if (result && typeof result === 'object' && result.status === 'error') return result;
        return _localOrNull(result?.localUrl || result);
    };

    // ---- Image Caching ----
    ipcMain.handle('cache-image', async (_, url, gameId, type, opts = {}) => {
        try {
            ipcValidation.assertString(url,    'url',    2048);
            ipcValidation.assertArtworkCacheKey(gameId, 'gameId');
            ipcValidation.assertString(type,   'type',   32);
        } catch (e) { artworkDownloadManager?.recordIpcValidationFailure?.(); artworkDownloadManager?.recordTerminalError?.(); return ipcValidation.sanitizeErrorForRenderer(e); }
        if (!url || url.startsWith('assets/')) return url;
        // For file:// URLs, verify the file still exists on disk (handles cache wipes)
        if (url.startsWith('file://')) {
            try {
                const p = fileURLToPath(url);
                const st = await fs.stat(p);
                if (st.size > 0) return url; // File exists and is valid
            } catch { /* File gone — fall through to re-download */ }
        }
        try {
            if (!artworkDownloadManager) return _localOrNull(url);
            const structured = opts?.structured === true;
            const cached = await artworkDownloadManager.downloadAsset({
                structured,
                sourceUrl: url,
                canonicalGameId: gameId,
                type,
                priority: 'visible',
                sourceSubsystem: 'renderer-cache-image-ipc',
                reason: 'cache-image',
                rendererDirectRemote: true,
            });
            return _structuredOrLocal(cached, structured);
        } catch (err) {
            console.error(`[Cache] Failed for ${gameId} (${type}):`, err.message);
            return { status: 'error', code: err?.code || 'CACHE_IMAGE_FAILED', message: err?.message || 'Artwork cache failed' };
        }
    });

    ipcMain.handle('cache-all-assets', async (_, assets, gameId, opts = {}) => {
        try {
            ipcValidation.assertArtworkCacheKey(gameId, 'gameId');
        } catch (e) { artworkDownloadManager?.recordIpcValidationFailure?.(); artworkDownloadManager?.recordTerminalError?.(); return ipcValidation.sanitizeErrorForRenderer(e); }
        if (!artworkDownloadManager) return _filterCachedAssetResult(assets);
        const requestedPriority = String(opts?.priority || 'visible');
        const priority = ['game-details', 'visible', 'prewarm', 'background'].includes(requestedPriority)
            ? requestedPriority
            : 'visible';
        try {
            const cached = await artworkDownloadManager.downloadAssets(assets, gameId, {
                priority,
                sourceSubsystem: opts?.sourceSubsystem || (priority === 'game-details'
                    ? 'game-details-cache-all-assets-ipc'
                    : 'renderer-cache-all-assets-ipc'),
                reason: opts?.reason || (priority === 'game-details'
                    ? 'game-details-cache-all-assets'
                    : 'cache-all-assets'),
                rendererDirectRemote: true,
                structured: opts?.structured === true,
            });
            return opts?.structured === true ? cached : _filterCachedAssetResult(cached);
        } catch (err) {
            return { status: 'error', code: err?.code || 'CACHE_ALL_ASSETS_FAILED', message: err?.message || 'Artwork cache failed' };
        }
    });

    ipcMain.handle('artwork-cold-cover-bootstrap:start', async (_, games = [], opts = {}) => {
        if (!coldCoverBootstrapService) return { status: 'unavailable' };
        return coldCoverBootstrapService.start(games, opts || {});
    });

    ipcMain.handle('artwork-cold-cover-bootstrap:boost', async (_, games = [], opts = {}) => {
        if (!coldCoverBootstrapService) return { status: 'unavailable' };
        return coldCoverBootstrapService.boost(games, opts || {});
    });

    ipcMain.handle('artwork-cold-cover-bootstrap:stats', async () => {
        if (!coldCoverBootstrapService) return { status: 'unavailable' };
        return { status: 'success', stats: coldCoverBootstrapService.getStats() };
    });
    // Prune image_cache of files that don't belong to installed or synced Ready-to-Install games.
    // Called once at startup (with a delay) and exposed for manual maintenance.
    ipcMain.handle('prune-image-cache', async () => {
        try {
            const fsSync    = require('fs');
            const cacheDir  = path.join(app.getPath('userData'), 'image_cache');
            const protectedIds = new Set();
            for (const g of (getSavedGames?.() || [])) _collectImageCacheIdsFromGame(g, protectedIds);
            for (const id of _readReadyToInstallProtectedImageIds(app.getPath('userData'))) protectedIds.add(id);

            const files = fsSync.readdirSync(cacheDir);
            let pruned = 0;
            let protectedCount = 0;
            let freshSkipped = 0;
            const now = Date.now();
            for (const file of files) {
                const m = /^(?:cover|hero|logo)_(.+?)\.(?:webp|jpg|png|gif)$/.exec(file);
                if (!m) continue;
                const gameId = m[1];
                if (protectedIds.has(gameId) || protectedIds.has(String(gameId).toLowerCase())) {
                    protectedCount++;
                    continue;
                }

                const abs = path.join(cacheDir, file);
                try {
                    const st = fsSync.statSync(abs);
                    const ageMs = now - Math.max(st.mtimeMs || 0, st.ctimeMs || 0);
                    if (ageMs >= 0 && ageMs < IMAGE_CACHE_PRUNE_GRACE_MS) {
                        freshSkipped++;
                        continue;
                    }
                } catch {
                    // If stat fails, try to unlink below; locked files are skipped there.
                }

                try {
                    fsSync.unlinkSync(abs);
                    pruned++;
                } catch { /* skip locked */ }
            }
            if (pruned) {
                console.log(`[ImageCachePrune] Removed ${pruned} truly orphaned file(s); protected=${protectedCount}; freshSkipped=${freshSkipped}`);
            }
            return { pruned, protected: protectedCount, freshSkipped };
        } catch (e) {
            console.warn('[ImageCachePrune] error:', e.message);
            return { pruned: 0, error: e.message };
        }
    });

    // ---- Images ----
    ipcMain.handle('select-game-image', async () => {
        const result = await dialog.showOpenDialog(getMainWindow(), {
            properties: ['openFile'],
            filters: [{ name: 'Images', extensions: ['jpg', 'png', 'jpeg', 'webp'] }]
        });
        return result.canceled ? null : result.filePaths[0];
    });

    // True if a file:// image still exists on disk (invalidates stale localStorage / JSON after cache wipe)
    ipcMain.handle('probe-local-image', async (_, fileUrl) => {
        try {
            if (!fileUrl || !String(fileUrl).startsWith('file://')) return false;
            const isManaged = /artwork-cache-v2(?:%5C|[\/])/i.test(String(fileUrl));
            const managed = artworkDownloadManager?.getCachedAssetByFileUrl?.(fileUrl);
            if (isManaged) return !!managed?.fileUrl;
            const fsSync = require('fs');
            const filePath = fileURLToPath(fileUrl);
            const stat = fsSync.statSync(filePath);
            if (!stat.isFile() || stat.size <= 0) return false;
            const fd = fsSync.openSync(filePath, 'r');
            try {
                const header = Buffer.alloc(Math.min(16, stat.size));
                fsSync.readSync(fd, header, 0, header.length, 0);
                const png = header.length >= 8 && header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
                const jpeg = header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
                const gif = header.length >= 6 && (header.subarray(0, 6).toString('ascii') === 'GIF87a' || header.subarray(0, 6).toString('ascii') === 'GIF89a');
                const webp = header.length >= 12 && header.subarray(0, 4).toString('ascii') === 'RIFF' && header.subarray(8, 12).toString('ascii') === 'WEBP';
                return png || jpeg || gif || webp;
            } finally {
                try { fsSync.closeSync(fd); } catch {}
            }
        } catch {
            return false;
        }
    });

    ipcMain.handle('get-image-cache-dir-url', () => {
        const dir = path.join(app.getPath('userData'), 'image_cache');
        return imageWebpCache.filePathToFileUrl(dir) + '/';
    });

    ipcMain.handle('get-user-artwork-dir-url', () => {
        const dir = path.join(app.getPath('userData'), 'user_artwork');
        return imageWebpCache.filePathToFileUrl(dir) + '/';
    });

    ipcMain.handle('get-artwork-cache-dir-url', () => {
        const dir = path.join(app.getPath('userData'), 'artwork-cache-v2');
        return imageWebpCache.filePathToFileUrl(dir) + '/';
    });

    function _resolveCachedImageLocalDetails(gameId, type = 'cover') {
        try {
            ipcValidation.assertArtworkCacheKey(String(gameId || ''), 'gameId');
            const fsSync = require('fs');
            const v2Cached = artworkDownloadManager?.getCachedAsset?.({
                canonicalGameId: gameId,
                type,
            });
            if (v2Cached?.fileUrl) {
                return {
                    fileUrl: v2Cached.fileUrl,
                    localUrl: v2Cached.fileUrl,
                    url: v2Cached.fileUrl,
                    assetHash: v2Cached.assetHash || null,
                    matchedAlias: String(gameId || ''),
                    source: 'artwork-cache-v2',
                    type,
                };
            }

            const cacheDir = path.join(app.getPath('userData'), 'image_cache');
            if (!fsSync.existsSync(cacheDir)) return null;

            const files = fsSync.readdirSync(cacheDir);
            const prefix = imageWebpCache.cacheBaseName(type, gameId);
            const found = files.find((f) => f.startsWith(prefix)) || null;
            if (!found) return null;

            const abs = path.join(cacheDir, found);
            const size = fsSync.statSync(abs).size;
            if (size < 512) return null;
            const fileUrl = imageWebpCache.filePathToFileUrl(abs);
            return {
                fileUrl,
                localUrl: fileUrl,
                url: fileUrl,
                assetHash: null,
                matchedAlias: String(gameId || ''),
                source: 'legacy-image-cache',
                type,
            };
        } catch (err) {
            return {
                fileUrl: null,
                localUrl: null,
                url: null,
                errorCode: err?.code || 'CACHE_LOOKUP_FAILED',
                error: err?.message || String(err || 'cache lookup failed'),
                matchedAlias: String(gameId || ''),
                source: 'error',
                type,
            };
        }
    }

    function _resolveCachedImageLocal(gameId, type = 'cover') {
        const details = _resolveCachedImageLocalDetails(gameId, type);
        return details?.fileUrl || null;
    }

    function _isBackfillableArtworkAlias(value) {
        if (value == null) return false;
        const key = String(value).trim();
        if (!key || key.length > 256) return false;
        if (/^(?:https?:|file:|data:|blob:)/i.test(key)) return false;
        if (/[\/\0]/.test(key)) return false;
        return /^[A-Za-z0-9 ._:\-]+$/.test(key);
    }

    function _bulkIdentityAliases(identity = {}) {
        const out = [];
        const add = (value) => {
            if (!_isBackfillableArtworkAlias(value)) return;
            const key = String(value).trim();
            if (!out.includes(key)) out.push(key);
        };
        add(identity.key);
        add(identity.canonicalGameId);
        add(identity.id);
        add(identity.gameId);
        for (const value of Array.isArray(identity.ids) ? identity.ids : []) add(value);
        for (const value of Array.isArray(identity.strongAliases) ? identity.strongAliases : []) add(value);
        for (const value of Array.isArray(identity.legacyAliases) ? identity.legacyAliases : []) add(value);
        return out;
    }

    function _bulkManagedCandidateUrls(identity = {}) {
        const urls = [];
        const add = (value) => {
            const url = String(value || '').trim();
            if (!url.startsWith('file://') || !/artwork-cache-v2(?:%5C|[\\/])/i.test(url)) return;
            if (!urls.includes(url)) urls.push(url);
        };
        for (const value of Array.isArray(identity.candidateManagedLocalUrls) ? identity.candidateManagedLocalUrls : []) add(value);
        return urls;
    }

    ipcMain.handle('get-cached-images-bulk', async (_, identities = [], type = 'cover') => {
        const list = Array.isArray(identities) ? identities : [];
        const images = {};
        const results = {};
        let backfilledAliases = 0;
        let aliasHits = 0;
        let persistedPathHits = 0;
        let misses = 0;
        let transactionStarted = false;
        let processed = 0;
        try {
            for (const identity of list) {
                if (processed > 0 && processed % 24 === 0) {
                    await new Promise(resolve => setImmediate(resolve));
                }
                processed += 1;
                const ids = _bulkIdentityAliases(identity);
                const key = String(identity?.key || identity?.canonicalGameId || ids[0] || '');
                if (!key) continue;
                let hit = null;
                for (const id of ids) {
                    const details = _resolveCachedImageLocalDetails(id, type);
                    if (details?.fileUrl) {
                        hit = { ...details, matchedAlias: id, source: details.source || 'artwork-cache-v2' };
                        aliasHits += 1;
                        break;
                    }
                    if (!hit && details?.errorCode) hit = details;
                }
                if (!hit?.fileUrl) {
                    for (const candidateUrl of _bulkManagedCandidateUrls(identity)) {
                        const candidate = artworkDownloadManager?.getCachedAssetByFileUrl?.(candidateUrl, { type });
                        if (!candidate?.fileUrl) continue;
                        hit = {
                            ...candidate,
                            fileUrl: candidate.fileUrl,
                            localUrl: candidate.fileUrl,
                            url: candidate.fileUrl,
                            matchedAlias: null,
                            matchedCandidateUrl: candidateUrl,
                            source: 'persisted-managed-file',
                            type,
                        };
                        persistedPathHits += 1;
                        break;
                    }
                }
                if (hit?.fileUrl) {
                    images[key] = hit.fileUrl;
                    results[key] = {
                        requestKey: key,
                        canonicalGameId: String(identity?.canonicalGameId || key),
                        fileUrl: hit.fileUrl,
                        localUrl: hit.fileUrl,
                        url: hit.fileUrl,
                        matchedAlias: hit.matchedAlias || null,
                        matchedCandidateUrl: hit.matchedCandidateUrl || null,
                        assetHash: hit.assetHash || null,
                        source: hit.source || 'artwork-cache-v2',
                        type,
                    };
                    if (hit.assetHash && artworkDownloadManager?.linkCachedAlias) {
                        if (!transactionStarted && artworkDownloadManager?.beginManifestTransaction) {
                            artworkDownloadManager.beginManifestTransaction({ label: 'bulk-artwork-alias-backfill', batchSize: 50 });
                            transactionStarted = true;
                        }
                        if (artworkDownloadManager.linkCachedAliases) {
                            const linked = artworkDownloadManager.linkCachedAliases({
                                assetHash: hit.assetHash,
                                canonicalGameIds: ids.filter(alias => alias !== hit.matchedAlias),
                                type,
                            });
                            backfilledAliases += Number(linked?.aliasesCreated || 0);
                        } else {
                            for (const alias of ids) {
                                if (alias === hit.matchedAlias) continue;
                                const linked = artworkDownloadManager.linkCachedAlias({ assetHash: hit.assetHash, canonicalGameId: alias, type });
                                if (linked?.aliasCreated === true) backfilledAliases += 1;
                            }
                        }
                    }
                } else {
                    misses += 1;
                    results[key] = {
                        requestKey: key,
                        canonicalGameId: String(identity?.canonicalGameId || key),
                        fileUrl: null,
                        localUrl: null,
                        url: null,
                        matchedAlias: hit?.matchedAlias || null,
                        errorCode: hit?.errorCode || null,
                        missReason: hit?.errorCode ? 'lookup_error' : 'not_found',
                        source: 'miss',
                        type,
                    };
                }
            }
        } finally {
            if (transactionStarted && artworkDownloadManager?.commitManifestTransaction) {
                artworkDownloadManager.commitManifestTransaction({ reason: 'bulk-artwork-alias-backfill-final' });
            }
        }
        return {
            status: 'success',
            type,
            images,
            results,
            backfilledAliases,
            aliasHits,
            persistedPathHits,
            misses,
            cacheGeneration: artworkDownloadManager?.getCacheGeneration?.() || null,
        };
    });

    // Check if a game has a cached image on disk (used as fast fallback after reinstall)
    ipcMain.handle('get-cached-image', (_, gameId, type = 'cover') => {
    try {
        ipcValidation.assertArtworkCacheKey(gameId, 'gameId');
        const fsSync = require('fs');
        const v2Cached = artworkDownloadManager?.getCachedAsset?.({
            canonicalGameId: gameId,
            type,
        });
        if (v2Cached?.fileUrl) {
            coverDebugLog('[CoverDebug:Main] get-cached-image HIT artwork-cache-v2', {
                gameId: String(gameId),
                type,
                fileUrl: v2Cached.fileUrl,
            });
            return v2Cached.fileUrl;
        }

        const cacheDir = path.join(app.getPath('userData'), 'image_cache');

        if (!fsSync.existsSync(cacheDir)) {
            coverDebugWarn('[CoverDebug:Main] get-cached-image MISS cacheDir missing', {
                gameId: String(gameId),
                type,
                cacheDir,
            });
            return null;
        }

        const files = fsSync.readdirSync(cacheDir);
        const prefix = imageWebpCache.cacheBaseName(type, gameId);
        const matches = files.filter((f) => f.startsWith(prefix));
        const found = matches[0] || null;

        coverDebugLog('[CoverDebug:Main] get-cached-image lookup', {
            gameId: String(gameId),
            type,
            prefix,
            cacheDir,
            totalFiles: files.length,
            matches: matches.slice(0, 8),
            found,
            sampleFiles: files.slice(0, 20),
        });

        if (!found) return null;

        const abs = path.join(cacheDir, found);

        try {
            const size = fsSync.statSync(abs).size;

            if (size < 512) {
                coverDebugWarn('[CoverDebug:Main] get-cached-image REJECT tiny file', {
                    gameId: String(gameId),
                    type,
                    found,
                    size,
                });
                return null;
            }
        } catch (err) {
            coverDebugWarn('[CoverDebug:Main] get-cached-image stat ERROR', {
                gameId: String(gameId),
                type,
                found,
                error: err?.message || String(err),
            });
            return null;
        }

        const fileUrl = imageWebpCache.filePathToFileUrl(abs);

        coverDebugLog('[CoverDebug:Main] get-cached-image HIT', {
            gameId: String(gameId),
            type,
            found,
            fileUrl,
        });

        return fileUrl;
    } catch (err) {
        coverDebugWarn('[CoverDebug:Main] get-cached-image ERROR', {
            gameId: String(gameId),
            type,
            error: err?.message || String(err),
        });
        if (err?.code === 'IPC_INVALID_ARG') {
            artworkDownloadManager?.recordIpcValidationFailure?.();
            artworkDownloadManager?.recordTerminalError?.();
            return ipcValidation.sanitizeErrorForRenderer(err);
        }
        return null;
    }
});

    ipcMain.handle('get-artwork-persistence-audit', async (_event, payload = {}) => {
        const allowed = !app?.isPackaged || process.env.BADDEL_ENABLE_ARTWORK_PERSISTENCE_AUDIT === '1';
        if (!allowed) {
            return { status: 'error', code: 'AUDIT_DISABLED', message: 'Artwork persistence audit is development-only.' };
        }

        const fsSync = require('fs');
        const cache = artworkDownloadManager?._cache || null;
        const managerStats = artworkDownloadManager?.getStats?.() || {};
        const manifest = cache?.getManifest?.() || { assets: {}, urls: {}, aliases: {}, stats: {} };
        const assetsDir = cache?.getAssetsDir?.() || path.join(app.getPath('userData'), 'artwork-cache-v2', 'assets');
        const rootDir = cache?.getRootDir?.() || path.join(app.getPath('userData'), 'artwork-cache-v2');
        const games = Array.isArray(payload.games) ? payload.games : [];
        const rendererEvidence = payload.rendererEvidence && typeof payload.rendererEvidence === 'object' ? payload.rendererEvidence : {};

        const statPath = (filePath) => {
            try {
                const st = fsSync.statSync(filePath);
                return { exists: st.isFile(), size: st.isFile() ? st.size : 0 };
            } catch (err) {
                return { exists: false, size: 0, error: err?.code || err?.message || String(err) };
            }
        };
        const assetPath = (asset) => asset?.fileName ? path.join(assetsDir, asset.fileName) : null;
        const assetExists = (assetHash) => {
            const asset = manifest.assets?.[assetHash];
            if (!asset) return false;
            const p = assetPath(asset);
            return !!p && statPath(p).exists;
        };
        const materializeFileUrl = (assetHash) => {
            const asset = manifest.assets?.[assetHash];
            if (!asset?.fileName) return null;
            return imageWebpCache.filePathToFileUrl(path.join(assetsDir, asset.fileName));
        };

        let physicalFiles = [];
        try { physicalFiles = fsSync.readdirSync(assetsDir).filter(f => statPath(path.join(assetsDir, f)).exists); } catch {}
        const physicalByName = new Map(physicalFiles.map(fileName => [fileName, statPath(path.join(assetsDir, fileName))]));

        const cacheCapacity = {
            effectiveMaxCacheBytes: Number(cache?._maxCacheBytes ?? 512 * 1024 * 1024),
            manifestAssetCount: Object.keys(manifest.assets || {}).length,
            physicalAssetFileCount: physicalFiles.length,
            manifestBytes: 0,
            actualPhysicalBytes: 0,
            byType: {
                cover: { count: 0, bytes: 0 },
                hero: { count: 0, bytes: 0 },
                logo: { count: 0, bytes: 0 },
                unknown: { count: 0, bytes: 0 },
            },
            evictedAssets: Number(manifest.stats?.evictedAssets || 0),
            evictedBytes: Number(manifest.stats?.evictedBytes || 0),
            evictionsByArtworkType: {},
            nearLimit: false,
        };

        for (const asset of Object.values(manifest.assets || {})) {
            const bytes = Number(asset?.bytes || 0);
            cacheCapacity.manifestBytes += bytes;
            const aliases = Array.isArray(asset?.aliases) ? asset.aliases : [];
            const type = aliases.map(a => String(a).split(':').pop()).find(t => ['cover', 'hero', 'logo'].includes(t)) || 'unknown';
            cacheCapacity.byType[type] = cacheCapacity.byType[type] || { count: 0, bytes: 0 };
            cacheCapacity.byType[type].count += 1;
            cacheCapacity.byType[type].bytes += bytes;
        }
        for (const st of physicalByName.values()) cacheCapacity.actualPhysicalBytes += Number(st.size || 0);
        cacheCapacity.nearLimit = Number.isFinite(cacheCapacity.effectiveMaxCacheBytes)
            && cacheCapacity.effectiveMaxCacheBytes > 0
            && cacheCapacity.actualPhysicalBytes >= cacheCapacity.effectiveMaxCacheBytes * 0.9;

        const manifestIntegrity = {
            aliasCount: Object.keys(manifest.aliases || {}).length,
            urlMappingCount: Object.keys(manifest.urls || {}).length,
            aliasesPointingToMissingAssets: 0,
            assetRecordsPointingToMissingFiles: 0,
            physicalOrphanFilesNotInManifest: 0,
            manifestLoadedSuccessfully: !!cache,
            backupManifestWasUsed: false,
            manifestParseErrors: [],
            manifestWriteErrors: [],
            manifestRecoveryErrors: [],
            samples: { aliasesPointingToMissingAssets: [], assetRecordsPointingToMissingFiles: [], orphanFiles: [] },
        };

        const manifestFileNames = new Set(Object.values(manifest.assets || {}).map(a => a?.fileName).filter(Boolean));
        for (const [alias, entry] of Object.entries(manifest.aliases || {})) {
            if (!assetExists(entry?.assetHash)) {
                manifestIntegrity.aliasesPointingToMissingAssets += 1;
                _pushAuditSample(manifestIntegrity.samples, 'aliasesPointingToMissingAssets', { alias, assetHash: entry?.assetHash || null }, 12);
            }
        }
        for (const [assetHash, asset] of Object.entries(manifest.assets || {})) {
            if (!assetExists(assetHash)) {
                manifestIntegrity.assetRecordsPointingToMissingFiles += 1;
                _pushAuditSample(manifestIntegrity.samples, 'assetRecordsPointingToMissingFiles', { assetHash, fileName: asset?.fileName || null, bytes: asset?.bytes || 0 }, 12);
            }
        }
        for (const fileName of physicalFiles) {
            if (!manifestFileNames.has(fileName)) {
                manifestIntegrity.physicalOrphanFilesNotInManifest += 1;
                _pushAuditSample(manifestIntegrity.samples, 'orphanFiles', { fileName, size: physicalByName.get(fileName)?.size || 0 }, 12);
            }
        }

        const categories = Object.fromEntries(Object.keys(_emptyArtworkPersistenceAuditSampleBucket()).map(k => [k, 0]));
        const categorySamples = _emptyArtworkPersistenceAuditSampleBucket();
        const storedFileStats = { totalFileUrls: 0, exists: 0, missing: 0, samples: [] };
        const exactRendererFileChecks = [];

        const classifyGame = (game) => {
            const aliases = [...new Set((Array.isArray(game.aliases) ? game.aliases : []).map(String).filter(Boolean))];
            const storedUrls = [...new Set([game.coverUrl, game.image, game.defaultImage, game.storedCoverUrl].map(v => String(v || '').trim()).filter(Boolean))];
            const remoteCandidates = [...new Set((Array.isArray(game.remoteCandidates) ? game.remoteCandidates : []).map(String).filter(v => /^https?:\/\//i.test(v)))];
            const canonicalParts = String(game.canonicalKey || '').split(':');
            const accountIdentity = canonicalParts.length >= 3 ? canonicalParts[1] : (
                game.libraryAccountId || game.ownerAccountId || game.accountId || null
            );
            const platform = game.platform || (canonicalParts.length ? canonicalParts[0] : null);
            const stablePlatformGameIds = {
                id: game.id || null,
                appName: game.appName || null,
                launcherGameId: game.launcherGameId || null,
                namespace: game.namespace || game.catalogNamespace || null,
                catalogItemId: game.catalogItemId || null,
                offerId: game.offerId || null,
                productId: game.productId || null,
                allIds: game.allIds || null,
            };
            const sampleBase = {
                title: game.title || game.name || null,
                id: game.id || null,
                platform,
                accountHash: _auditShortHash(accountIdentity),
                stablePlatformGameIds,
                canonicalKeyExpected: game.canonicalKey || null,
                canonicalKeyUsedByLibrary: aliases[0] || game.id || null,
                canonicalKeyUsedByCacheAliasLookup: game.canonicalKey || null,
                canonicalKey: game.canonicalKey || null,
                aliases: aliases.slice(0, 12),
                allIdentityAliasesTried: aliases,
                remoteCoverSourceAvailable: remoteCandidates.length > 0,
            };

            let aliasMissing = null;
            for (const alias of aliases) {
                const aliasKey = cache?.aliasKey?.(alias, 'cover') || `${alias}:cover`;
                const entry = manifest.aliases?.[aliasKey];
                if (!entry) continue;
                if (assetExists(entry.assetHash)) {
                    return { category: 'valid_alias_hit', sample: { ...sampleBase, alias, aliasKey, assetHash: entry.assetHash, fileUrl: materializeFileUrl(entry.assetHash) } };
                }
                aliasMissing = { alias, aliasKey, assetHash: entry.assetHash || null };
            }

            for (const url of storedUrls) {
                if (!url.startsWith('file://')) continue;
                const st = _auditFileUrl(fileURLToPath, fsSync, url);
                storedFileStats.totalFileUrls += 1;
                if (st.exists) {
                    storedFileStats.exists += 1;
                    if (storedFileStats.samples.length < 12) storedFileStats.samples.push({ ...sampleBase, file: st });
                    return { category: 'stored_file_url_exists', sample: { ...sampleBase, file: st } };
                }
                storedFileStats.missing += 1;
                if (storedFileStats.samples.length < 12) storedFileStats.samples.push({ ...sampleBase, file: st });
                return { category: 'stored_file_url_missing', sample: { ...sampleBase, file: st } };
            }

            if (aliasMissing) return { category: 'alias_points_to_missing_file', sample: { ...sampleBase, ...aliasMissing } };

            if (!storedUrls.length && remoteCandidates.length === 0) {
                return { category: 'no_artwork_source', sample: sampleBase };
            }

            for (const url of remoteCandidates) {
                const urlHash = cache?.hashUrl?.(url);
                const entry = urlHash ? manifest.urls?.[urlHash] : null;
                if (entry && assetExists(entry.assetHash)) {
                    return { category: 'alias_miss_but_url_hash_hit', sample: { ...sampleBase, urlHash, assetHash: entry.assetHash, remoteCandidate: url } };
                }
            }

            if (remoteCandidates.length > 0) return { category: 'remote_candidate_only', sample: { ...sampleBase, remoteCandidate: remoteCandidates[0] } };
            return { category: 'identity_mismatch', sample: { ...sampleBase, storedUrls: storedUrls.slice(0, 3), remoteCandidateCount: remoteCandidates.length } };
        };

        for (const game of games) {
            const result = classifyGame(game || {});
            categories[result.category] = Number(categories[result.category] || 0) + 1;
            _pushAuditSample(categorySamples, result.category, result.sample);
        }

        const sortedGames = [...games].sort((a, b) => String(a.title || a.name || '').localeCompare(String(b.title || b.name || '')));
        const classifySlice = (list) => {
            const out = Object.fromEntries(Object.keys(categories).map(k => [k, 0]));
            for (const game of list) out[classifyGame(game || {}).category] += 1;
            return out;
        };
        const first50 = classifySlice(sortedGames.slice(0, 50));
        const last50 = classifySlice(sortedGames.slice(-50));

        const rendererBroken = Array.isArray(rendererEvidence.brokenImages) ? rendererEvidence.brokenImages : [];
        for (const broken of rendererBroken.slice(0, 40)) {
            const src = String(broken?.src || '');
            exactRendererFileChecks.push({
                ...broken,
                file: _auditFileUrl(fileURLToPath, fsSync, src),
            });
        }

        const schedulerSnapshot = managerStats.schedulerSnapshot || {};
        const schedulerStats = managerStats.scheduler || {};
        const telemetry = deps.artworkNetworkTelemetry?.getSummary?.() || {};
        const blockedByReason = {};
        const blockedByPriority = {};
        const events = Array.isArray(telemetry.recentEvents) ? telemetry.recentEvents : [];
        for (const event of events) {
            if (event?.budgetRejection || event?.blockedReason || event?.skipReason) {
                _auditAddCount(blockedByReason, event.blockedReason || event.skipReason || 'unknown');
                _auditAddCount(blockedByPriority, event.priority || 'unknown');
            }
        }

        return {
            status: 'success',
            marker: 'BADDEL_ARTWORK_PERSISTENCE_AUDIT',
            generatedAt: new Date().toISOString(),
            label: payload.label || 'snapshot',
            readOnly: true,
            userDataDir: app.getPath('userData'),
            cacheRootDir: rootDir,
            bandwidthPolicy: {
                automaticBytes: managerStats.bandwidthPolicy?.automaticBytes ?? managerStats.currentBudget?.usedBytes ?? null,
                maxAutomaticBytes: managerStats.bandwidthPolicy?.maxAutomaticBytes ?? managerStats.currentBudget?.maxAutomaticBytes ?? null,
                skippedCount: managerStats.bandwidthPolicy?.skipped ?? managerStats.skipped ?? 0,
                blockedCoverCount: events.filter(e => e?.type === 'cover' && (e?.budgetRejection || e?.blockedReason || e?.skipReason)).length,
                blockedByReason,
                blockedByPriority,
                visibleDownloads: events.filter(e => e?.priority === 'visible' && e?.downloadedBytes > 0).length,
                backgroundDownloads: events.filter(e => ['background', 'prewarm'].includes(e?.priority) && e?.downloadedBytes > 0).length,
            },
            schedulerDownloadPerformance: {
                configuredConcurrency: 3,
                activeTasks: schedulerSnapshot.active ?? managerStats.activeDownloads ?? 0,
                pendingTasks: Array.isArray(schedulerSnapshot.pending) ? schedulerSnapshot.pending.length : managerStats.queuedDownloads ?? 0,
                coversDownloaded: schedulerStats.completed ?? 0,
                averageDownloadDurationMs: telemetry.averageDurationMs ?? null,
                p50DownloadDurationMs: telemetry.p50DurationMs ?? null,
                p95DownloadDurationMs: telemetry.p95DurationMs ?? null,
                averageBytesPerCover: (managerStats.downloadedBytes && schedulerStats.completed) ? Math.round(managerStats.downloadedBytes / Math.max(1, schedulerStats.completed)) : 0,
                http429Count: telemetry.http429Count ?? 0,
                retryCount: managerStats.retryCount ?? 0,
                failureCount: managerStats.failed ?? schedulerStats.failed ?? 0,
                visibleInitiatedDownloads: events.filter(e => e?.priority === 'visible' && e?.cacheMiss).length,
                backgroundCompletedWithoutVisible: events.filter(e => ['background', 'prewarm'].includes(e?.priority) && e?.downloadedBytes > 0).length,
            },
            cacheCapacity,
            manifestIntegrity,
            fullLibraryAudit: {
                totalGames: games.length,
                categories,
                samples: categorySamples,
                storedFileUrlStats: storedFileStats,
                first50Alphabetical: first50,
                last50Alphabetical: last50,
                earlyMissingLatePresentEvidence: (first50.valid_alias_hit + first50.stored_file_url_exists) < (last50.valid_alias_hit + last50.stored_file_url_exists),
            },
            rendererEvidence: {
                imgErrorCount: Number(rendererEvidence.imgErrorCount || 0),
                brokenFileUrlCount: rendererBroken.filter(b => String(b?.src || '').startsWith('file://')).length,
                brokenImagesChecked: exactRendererFileChecks,
                assignedUrlWhoseFileWasEvictedOrDeleted: exactRendererFileChecks.filter(x => x.file?.isFileUrl && !x.file?.exists).length,
                validFileChromiumFailedToLoad: exactRendererFileChecks.filter(x => x.file?.isFileUrl && x.file?.exists).length,
                rendererReceivedNoCachedUrl: Number(rendererEvidence.rendererReceivedNoCachedUrl || 0),
                canonicalIdentityLookupMiss: Number(rendererEvidence.canonicalIdentityLookupMiss || 0),
                mountedImageCount: Number(rendererEvidence.mountedImageCount || 0),
                mountedFileImageCount: Number(rendererEvidence.mountedFileImageCount || 0),
            },
            lifecycle: payload.lifecycle || null,
        };
    });

    ipcMain.on('grid-artwork-scroll-active', (_, active) => {
        gridArtworkThumbnailCache?.setScrollActive?.(active === true);
    });

    ipcMain.handle('get-grid-artwork-thumbnails', async (_, sourceUrls = [], options = {}) => {
        const requested = Array.isArray(sourceUrls) ? sourceUrls.filter(value => typeof value === 'string') : [];
        const createMissing = options?.createMissing === true;
        const limit = createMissing ? 32 : 1200;
        if (requested.length > limit) {
            return { status: 'error', code: 'GRID_THUMBNAIL_BATCH_TOO_LARGE', images: {}, requested: requested.length, limit };
        }
        if (!gridArtworkThumbnailCache) return { status: 'unavailable', images: {}, requested: requested.length };
        try {
            const result = await gridArtworkThumbnailCache.resolveBatch(requested, {
                createMissing,
                concurrency: createMissing ? 1 : 4,
            });
            return { status: 'success', ...result };
        } catch (err) {
            return { status: 'error', code: err?.code || 'GRID_THUMBNAIL_FAILED', message: err?.message || String(err), images: {} };
        }
    });

    ipcMain.handle('artwork-download-stats', () => {
        try {
            return { status: 'success', ...(artworkDownloadManager?.getStats?.() || {}) };
        } catch (err) {
            return { status: 'error', code: err?.code || 'ARTWORK_STATS_FAILED', message: err?.message || 'Could not read artwork stats' };
        }
    });

    ipcMain.handle('update-game-image', (_, id, imgPath, type, opts) =>
        updateGameImage(id, imgPath, type, opts));
    ipcMain.handle('set-game-artwork', (_, id, updates, opts) =>
        setGameArtwork(id, updates, opts));
    ipcMain.handle('reset-game-artwork', (_, id, opts) =>
        resetGameArtwork(id, opts));
    ipcMain.handle('reset-game-image', (_, id, type) =>
        resetGameImage(id, type));
};
