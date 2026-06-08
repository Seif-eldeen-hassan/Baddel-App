'use strict';

// Creator Page IPC handlers extracted from main.js.
// All behaviour is verbatim — only outer-scope references are threaded through deps.
// Private helper functions (creatorPackMime … creatorDecodeAssets) move here too —
// they were only used by these five handlers.
//
// deps shape:
//   { dialog,
//     getMainWindow,   ← () => mainWindow
//     fs,              ← fs/promises  (same ref as main.js)
//     path,
//     app,
//     fileURLToPath }

module.exports.register = function registerCreatorPageHandlers(ipcMain, deps) {
    const { dialog, getMainWindow, fs, path, app, fileURLToPath } = deps;

    // ── Private helpers ──────────────────────────────────────────────────────

    const creatorPackMime = (filename) => {
        const ext = path.extname(String(filename || '')).toLowerCase();
        return ({
            '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
            '.avif': 'image/avif', '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm',
            '.mov': 'video/quicktime', '.m4v': 'video/mp4', '.ogv': 'video/ogg',
        })[ext] || 'application/octet-stream';
    };

    const creatorSafeName = (name, fallback = 'asset') => {
        const cleaned = String(name || fallback).replace(/[^a-z0-9._-]/gi, '_').slice(0, 80);
        return cleaned || fallback;
    };

    const creatorPathToFileUrl = (p) => {
        const normalized = String(p || '').replace(/\\/g, '/');
        return `file:///${normalized.replace(/^\/+/, '')}`;
    };

    const creatorResolveLocalPath = (url) => {
        if (!url || typeof url !== 'string') return null;
        if (url.startsWith('file://')) return fileURLToPath(url);
        return null;
    };

    const creatorEmbedAssets = async (pack) => {
        const cloned = JSON.parse(JSON.stringify(pack || {}));
        cloned.assets = cloned.assets || {};
        const page = cloned.page || {};
        let assetSeq = Object.keys(cloned.assets).length + 1;
        const missing = [];
        const toAsset = async (value, hint, kind = 'image') => {
            if (!value || typeof value !== 'string') return value;
            if (value.startsWith('asset://') || /^https?:\/\//i.test(value)) return value;
            let bytes = null;
            let filename = `${hint || 'asset'}-${assetSeq}`;
            let mime = 'application/octet-stream';
            if (value.startsWith('data:')) {
                const m = value.match(/^data:([^;,]+);base64,(.+)$/);
                if (!m) return value;
                mime = m[1];
                bytes = Buffer.from(m[2], 'base64');
                filename = `${filename}.${mime.split('/')[1] || 'bin'}`;
            } else if (value.startsWith('file://')) {
                const p = creatorResolveLocalPath(value);
                try {
                    const st = await fs.stat(p);
                    if (kind === 'video' && st.size > 50 * 1024 * 1024) {
                        const res = await dialog.showMessageBox(getMainWindow(), {
                            type: 'warning',
                            buttons: ['Embed video', 'Skip video'],
                            defaultId: 0,
                            cancelId: 1,
                            message: 'This video is large. The Page Pack may be heavy.',
                            detail: path.basename(p),
                        });
                        if (res.response === 1) return '';
                    }
                    bytes = await fs.readFile(p);
                    filename = path.basename(p);
                    mime = creatorPackMime(filename);
                } catch {
                    missing.push(value);
                    return value;
                }
            } else {
                return value;
            }
            const id = `${hint || kind}-${assetSeq++}`;
            cloned.assets[id] = { kind, filename: creatorSafeName(filename), mime, data: bytes.toString('base64') };
            return `asset://${id}`;
        };
        page.heroImage = await toAsset(page.heroImage, 'hero', 'image');
        page.posterImage = await toAsset(page.posterImage, 'poster', 'image');
        page.logoImage = await toAsset(page.logoImage, 'logo', 'image');
        if (Array.isArray(page.screenshots)) {
            page.screenshots = await Promise.all(page.screenshots.map(async (s, i) => {
                const row = typeof s === 'string' ? { id: `screenshot-${i + 1}`, url: s } : { ...s };
                row.url = await toAsset(row.url, `screenshot-${i + 1}`, 'image');
                return row;
            }));
        }
        if (Array.isArray(page.trailers)) {
            page.trailers = await Promise.all(page.trailers.map(async (t, i) => {
                const row = typeof t === 'string' ? { id: `trailer-${i + 1}`, url: t } : { ...t };
                const isVideo = /\.(mp4|webm|mov|m4v|ogv)(\?.*)?$/i.test(String(row.url || '')) || row.type === 'direct';
                row.url = await toAsset(row.url, `trailer-${i + 1}`, isVideo ? 'video' : 'image');
                row.thumbUrl = await toAsset(row.thumbUrl, `trailer-thumb-${i + 1}`, 'image');
                row.creatorOwned = true;
                return row;
            }));
        }
        if (missing.length) {
            throw new Error(`Missing local asset(s): ${missing.join(', ')}`);
        }
        cloned.page = page;
        return cloned;
    };

    const creatorDecodeAssets = async (pack, gameKey) => {
        const cloned = JSON.parse(JSON.stringify(pack || {}));
        const assets = cloned.assets || {};
        const safeKey = creatorSafeName(gameKey || cloned.exportedAt || Date.now(), 'page');
        const outDir = path.join(app.getPath('userData'), 'creator-page-assets', safeKey);
        await fs.mkdir(outDir, { recursive: true });
        const assetUrl = async (ref) => {
            if (!ref || typeof ref !== 'string' || !ref.startsWith('asset://')) return ref;
            const id = ref.slice('asset://'.length);
            const asset = assets[id];
            if (!asset?.data) return '';
            const filename = creatorSafeName(asset.filename || `${id}.bin`);
            const outPath = path.join(outDir, `${creatorSafeName(id)}-${filename}`);
            await fs.writeFile(outPath, Buffer.from(asset.data, 'base64'));
            return creatorPathToFileUrl(outPath);
        };
        const page = cloned.page || {};
        page.heroImage = await assetUrl(page.heroImage);
        page.posterImage = await assetUrl(page.posterImage);
        page.logoImage = await assetUrl(page.logoImage);
        if (Array.isArray(page.screenshots)) {
            page.screenshots = await Promise.all(page.screenshots.map(async (s) => {
                const row = typeof s === 'string' ? { url: s } : { ...s };
                row.url = await assetUrl(row.url);
                return row;
            }));
        }
        if (Array.isArray(page.trailers)) {
            page.trailers = await Promise.all(page.trailers.map(async (t) => {
                const row = typeof t === 'string' ? { url: t } : { ...t };
                row.url = await assetUrl(row.url);
                row.thumbUrl = await assetUrl(row.thumbUrl);
                row.importedFromPagePack = true;
                row.creatorOwned = true;
                return row;
            }));
        }
        cloned.page = page;
        return cloned;
    };

    // ── Handlers ─────────────────────────────────────────────────────────────

    ipcMain.handle('export-creator-page-pack', async (_, defaultName, pagePack) => {
        const result = await dialog.showSaveDialog(getMainWindow(), {
            defaultPath: defaultName || 'game.baddelpage',
            filters: [
                { name: 'Baddel Page Pack', extensions: ['baddelpage'] },
                { name: 'JSON', extensions: ['json'] },
            ],
        });
        if (result.canceled || !result.filePath) return false;
        const pack = typeof pagePack === 'string' ? JSON.parse(pagePack) : pagePack;
        const embedded = await creatorEmbedAssets(pack);
        await fs.writeFile(result.filePath, JSON.stringify(embedded, null, 2), 'utf8');
        return true;
    });

    ipcMain.handle('import-creator-page-pack', async () => {
        const result = await dialog.showOpenDialog(getMainWindow(), {
            properties: ['openFile'],
            filters: [
                { name: 'Baddel Page Pack', extensions: ['baddelpage', 'json'] },
            ],
        });
        if (result.canceled || !result.filePaths.length) return null;
        const raw = await fs.readFile(result.filePaths[0], 'utf8');
        return JSON.parse(raw);
    });

    ipcMain.handle('resolve-creator-page-assets', async (_, pagePack, gameKey) => creatorDecodeAssets(pagePack, gameKey));

    ipcMain.handle('export-creator-page', async (_, defaultName, pagePack) => {
        const pack = typeof pagePack === 'string' ? JSON.parse(pagePack) : pagePack;
        return ipcMain.emit ? await (async () => {
            const result = await dialog.showSaveDialog(getMainWindow(), {
                defaultPath: defaultName || 'game.baddelpage',
                filters: [{ name: 'Baddel Page Pack', extensions: ['baddelpage'] }, { name: 'JSON', extensions: ['json'] }],
            });
            if (result.canceled || !result.filePath) return false;
            const embedded = await creatorEmbedAssets(pack);
            await fs.writeFile(result.filePath, JSON.stringify(embedded, null, 2), 'utf8');
            return true;
        })() : false;
    });

    ipcMain.handle('import-creator-page', async () => {
        const result = await dialog.showOpenDialog(getMainWindow(), {
            properties: ['openFile'],
            filters: [{ name: 'Baddel Page Pack', extensions: ['baddelpage', 'json'] }],
        });
        if (result.canceled || !result.filePaths.length) return null;
        return JSON.parse(await fs.readFile(result.filePaths[0], 'utf8'));
    });
};
