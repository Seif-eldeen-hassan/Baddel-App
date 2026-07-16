'use strict';

// Image/cache-related IPC handlers extracted from main.js.
// All behaviour is verbatim — only outer-scope references are threaded through deps.
//
// deps shape:
//   { app, path, fs, dialog, imageWebpCache, artworkDownloadManager, ipcValidation, fileURLToPath,
//     getSavedGames, getMainWindow,
//     _collectImageCacheIdsFromGame, _readReadyToInstallProtectedImageIds,
//     IMAGE_CACHE_PRUNE_GRACE_MS, updateGameImage, setGameArtwork, resetGameArtwork, resetGameImage }
//
//   fs            — require('fs').promises
//   getMainWindow — () => mainWindow  (mainWindow is mutable, must be a getter)

module.exports.register = function registerImageHandlers(ipcMain, deps) {
    const {
        app, path, fs, dialog, imageWebpCache, artworkDownloadManager, ipcValidation, fileURLToPath,
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

    // ---- Image Caching ----
    ipcMain.handle('cache-image', async (_, url, gameId, type) => {
        try {
            ipcValidation.assertString(url,    'url',    2048);
            ipcValidation.assertSafeId(gameId, 'gameId');
            ipcValidation.assertString(type,   'type',   32);
        } catch (e) { return ipcValidation.sanitizeErrorForRenderer(e); }
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
            if (!artworkDownloadManager) return url;
            return await artworkDownloadManager.downloadAsset({
                sourceUrl: url,
                canonicalGameId: gameId,
                type,
                priority: 'visible',
                sourceSubsystem: 'renderer-cache-image-ipc',
                reason: 'cache-image',
                rendererDirectRemote: true,
            });
        } catch (err) {
            console.error(`[Cache] Failed for ${gameId} (${type}):`, err.message);
            return url;
        }
    });

    ipcMain.handle('cache-all-assets', async (_, assets, gameId) => {
        if (!artworkDownloadManager) return assets || {};
        return artworkDownloadManager.downloadAssets(assets, gameId, {
            priority: 'visible',
            sourceSubsystem: 'renderer-cache-all-assets-ipc',
            reason: 'cache-all-assets',
            rendererDirectRemote: true,
        });
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
            const p = fileURLToPath(fileUrl);
            const st = await fs.stat(p);
            return st.size > 0;
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

    // Check if a game has a cached image on disk (used as fast fallback after reinstall)
    ipcMain.handle('get-cached-image', (_, gameId, type = 'cover') => {
    try {
        const fsSync = require('fs');
        const v2Cached = artworkDownloadManager?.getCachedAsset?.({
            canonicalGameId: gameId,
            type,
        });
        if (v2Cached?.fileUrl) {
            console.log('[CoverDebug:Main] get-cached-image HIT artwork-cache-v2', {
                gameId: String(gameId),
                type,
                fileUrl: v2Cached.fileUrl,
            });
            return v2Cached.fileUrl;
        }

        const cacheDir = path.join(app.getPath('userData'), 'image_cache');

        if (!fsSync.existsSync(cacheDir)) {
            console.warn('[CoverDebug:Main] get-cached-image MISS cacheDir missing', {
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

        console.log('[CoverDebug:Main] get-cached-image lookup', {
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
                console.warn('[CoverDebug:Main] get-cached-image REJECT tiny file', {
                    gameId: String(gameId),
                    type,
                    found,
                    size,
                });
                return null;
            }
        } catch (err) {
            console.warn('[CoverDebug:Main] get-cached-image stat ERROR', {
                gameId: String(gameId),
                type,
                found,
                error: err?.message || String(err),
            });
            return null;
        }

        const fileUrl = imageWebpCache.filePathToFileUrl(abs);

        console.log('[CoverDebug:Main] get-cached-image HIT', {
            gameId: String(gameId),
            type,
            found,
            fileUrl,
        });

        return fileUrl;
    } catch (err) {
        console.warn('[CoverDebug:Main] get-cached-image ERROR', {
            gameId: String(gameId),
            type,
            error: err?.message || String(err),
        });
        return null;
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
