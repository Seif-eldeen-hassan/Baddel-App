'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');

let sharp = null;
try { sharp = require('sharp'); } catch {}

const GRID_THUMBNAIL_WIDTH = 160;
const GRID_THUMBNAIL_HEIGHT = 240;
const DEFAULT_MAX_BYTES = 128 * 1024 * 1024;

function isPathInside(candidate, root) {
    const relative = path.relative(path.resolve(root), path.resolve(candidate));
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

class GridArtworkThumbnailCache {
    constructor({ baseDir, sourceRoots = [], maxBytes = DEFAULT_MAX_BYTES, sharpImpl = sharp, logger = console } = {}) {
        if (!baseDir) throw new Error('GridArtworkThumbnailCache requires baseDir.');
        this._baseDir = path.resolve(baseDir);
        this._sourceRoots = sourceRoots.filter(Boolean).map(value => path.resolve(value));
        this._maxBytes = Math.max(16 * 1024 * 1024, Number(maxBytes) || DEFAULT_MAX_BYTES);
        this._sharp = sharpImpl;
        this._logger = logger;
        this._inFlight = new Map();
        this._createBatchCount = 0;
        this._scrollActive = false;
        this._stats = { hits: 0, misses: 0, generated: 0, failures: 0, rejected: 0, cancelledForScroll: 0, bytes: 0 };
        fs.mkdirSync(this._baseDir, { recursive: true });
    }

    getStats() {
        return { ...this._stats, inFlight: this._inFlight.size, maxBytes: this._maxBytes, scrollActive: this._scrollActive };
    }

    setScrollActive(active) {
        this._scrollActive = active === true;
    }

    async resolveBatch(sourceUrls = [], { createMissing = false, concurrency = 2 } = {}) {
        const urls = [...new Set((Array.isArray(sourceUrls) ? sourceUrls : []).map(String).filter(Boolean))];
        const images = {};
        let next = 0;
        const workers = Array.from({ length: Math.min(Math.max(1, Number(concurrency) || 1), 4, urls.length || 1) }, async () => {
            while (next < urls.length) {
                const url = urls[next++];
                const result = await this.resolve(url, { createMissing });
                if (result?.fileUrl) images[url] = result.fileUrl;
            }
        });
        await Promise.all(workers);
        if (createMissing) {
            this._createBatchCount += 1;
            if (this._createBatchCount % 32 === 0) await this._prune().catch(() => {});
        }
        return { images, requested: urls.length, resolved: Object.keys(images).length, stats: this.getStats() };
    }

    async resolve(sourceUrl, { createMissing = false } = {}) {
        const source = await this._sourceDescriptor(sourceUrl);
        if (!source) {
            this._stats.rejected += 1;
            return null;
        }
        const key = crypto.createHash('sha256')
            .update(`${source.path}\0${source.size}\0${source.mtimeMs}\0${GRID_THUMBNAIL_WIDTH}x${GRID_THUMBNAIL_HEIGHT}`)
            .digest('hex');
        const destination = path.join(this._baseDir, `${key}.webp`);
        try {
            const stat = await fs.promises.stat(destination);
            if (stat.isFile() && stat.size > 0) {
                this._stats.hits += 1;
                return { fileUrl: pathToFileURL(destination).href, width: GRID_THUMBNAIL_WIDTH, height: GRID_THUMBNAIL_HEIGHT, created: false };
            }
        } catch {}
        this._stats.misses += 1;
        if (!createMissing || !this._sharp) return null;
        if (!this._inFlight.has(key)) this._inFlight.set(key, this._generate(source.path, destination, key));
        try {
            return await this._inFlight.get(key);
        } finally {
            this._inFlight.delete(key);
        }
    }

    async _sourceDescriptor(sourceUrl) {
        try {
            if (!String(sourceUrl || '').startsWith('file://')) return null;
            const sourcePath = path.resolve(fileURLToPath(sourceUrl));
            if (!this._sourceRoots.some(root => isPathInside(sourcePath, root))) return null;
            const stat = await fs.promises.stat(sourcePath);
            if (!stat.isFile() || stat.size <= 0) return null;
            return { path: sourcePath, size: stat.size, mtimeMs: Math.trunc(stat.mtimeMs) };
        } catch {
            return null;
        }
    }

    async _generate(sourcePath, destination, key) {
        const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
        try {
            const buffer = await this._sharp(sourcePath, { failOn: 'none' })
                .rotate()
                .resize({ width: GRID_THUMBNAIL_WIDTH, height: GRID_THUMBNAIL_HEIGHT, fit: 'cover', withoutEnlargement: true })
                .webp({ quality: 84, effort: 3 })
                .toBuffer();
            if (this._scrollActive) {
                this._stats.cancelledForScroll += 1;
                return null;
            }
            await fs.promises.writeFile(temporary, buffer, { flag: 'wx' });
            await fs.promises.rename(temporary, destination);
            const stat = await fs.promises.stat(destination);
            this._stats.generated += 1;
            this._stats.bytes += stat.size;
            return { fileUrl: pathToFileURL(destination).href, width: GRID_THUMBNAIL_WIDTH, height: GRID_THUMBNAIL_HEIGHT, created: true, key };
        } catch (error) {
            this._stats.failures += 1;
            await fs.promises.rm(temporary, { force: true }).catch(() => {});
            if (process.env.BADDEL_VERBOSE_LOGS === '1') this._logger.warn?.('[GridArtworkThumbnailCache] generation failed:', error?.message || error);
            return null;
        }
    }

    async _prune() {
        const entries = [];
        let total = 0;
        for (const name of await fs.promises.readdir(this._baseDir)) {
            if (!name.endsWith('.webp')) continue;
            const filePath = path.join(this._baseDir, name);
            try {
                const stat = await fs.promises.stat(filePath);
                total += stat.size;
                entries.push({ filePath, size: stat.size, mtimeMs: stat.mtimeMs });
            } catch {}
        }
        if (total <= this._maxBytes) return;
        entries.sort((left, right) => left.mtimeMs - right.mtimeMs);
        for (const entry of entries) {
            if (total <= this._maxBytes) break;
            await fs.promises.rm(entry.filePath, { force: true }).catch(() => {});
            total -= entry.size;
        }
    }
}

module.exports = { GridArtworkThumbnailCache, GRID_THUMBNAIL_WIDTH, GRID_THUMBNAIL_HEIGHT, isPathInside };
