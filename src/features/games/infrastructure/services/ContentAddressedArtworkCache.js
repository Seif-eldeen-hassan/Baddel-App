'use strict';

const { pathToFileURL, fileURLToPath } = require('url');

const DEFAULT_MAX_BYTES = 15 * 1024 * 1024;
const MB = 1024 * 1024;
const DEFAULT_MAX_CACHE_BYTES = 512 * MB;
const DEFAULT_ACTIVE_COVER_CACHE_BYTES = 2 * 1024 * MB;
const DEFAULT_SECONDARY_CACHE_BYTES = 512 * MB;
const DEFAULT_COVER_UPPER_BOUND_BYTES = 500 * 1024;
const ARTWORK_CACHE_CLASSES = Object.freeze({
    ACTIVE_LIBRARY_COVER: 'active-library-cover',
    SECONDARY: 'secondary-artwork',
    AUTOMATIC: 'automatic-artwork',
});
const MANIFEST_VERSION = 1;
const ARTWORK_TYPES = new Set(['cover', 'hero', 'logo']);

const MIME_EXTENSIONS = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
};

function emptyManifest(nowIso) {
    return {
        version: MANIFEST_VERSION,
        createdAt: nowIso,
        updatedAt: nowIso,
        assets: {},
        urls: {},
        aliases: {},
        stats: {
            duplicateContentFilesAvoided: 0,
            evictedAssets: 0,
            evictedBytes: 0,
            evictionsByArtworkClass: {},
            capacityExhausted: 0,
            normalizedCoverMigrations: 0,
            normalizedCoverMigrationBytesSaved: 0,
        },
    };
}

function sanitizeAliasPart(value) {
    return String(value || 'unknown')
        .trim()
        .replace(/[^a-zA-Z0-9._:-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 128) || 'unknown';
}

function bufferFrom(value) {
    if (Buffer.isBuffer(value)) return value;
    if (value instanceof ArrayBuffer) return Buffer.from(value);
    if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    return Buffer.from(value || []);
}

function sniffImage(buffer) {
    if (!buffer || buffer.length < 4) return null;
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
        return { mime: 'image/png', extension: 'png' };
    }
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
        return { mime: 'image/jpeg', extension: 'jpg' };
    }
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
        return { mime: 'image/gif', extension: 'gif' };
    }
    if (
        buffer.length >= 12 &&
        buffer.toString('ascii', 0, 4) === 'RIFF' &&
        buffer.toString('ascii', 8, 12) === 'WEBP'
    ) {
        return { mime: 'image/webp', extension: 'webp' };
    }
    return null;
}

class ContentAddressedArtworkCache {
    constructor({
        fs,
        path,
        crypto,
        baseDir,
        fetchImpl = null,
        logger = console,
        maxBytes = DEFAULT_MAX_BYTES,
        maxCacheBytes = DEFAULT_MAX_CACHE_BYTES,
        activeCoverCacheBytes = process.env.BADDEL_ACTIVE_COVER_CACHE_BYTES,
        secondaryCacheBytes = process.env.BADDEL_SECONDARY_ARTWORK_CACHE_BYTES,
        coverUpperBoundBytes = DEFAULT_COVER_UPPER_BOUND_BYTES,
        activeLibraryGameCount = 0,
        now = () => new Date(),
    }) {
        this._fs = fs;
        this._path = path;
        this._crypto = crypto;
        this._baseDir = baseDir;
        this._fetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
        this._logger = logger;
        this._maxBytes = maxBytes;
        this._maxCacheBytes = this._normalizeLimit(maxCacheBytes, DEFAULT_MAX_CACHE_BYTES);
        this._coverUpperBoundBytes = this._normalizeLimit(coverUpperBoundBytes, DEFAULT_COVER_UPPER_BOUND_BYTES);
        this._activeLibraryGameCount = Math.max(0, Number(activeLibraryGameCount) || 0);
        this._activeCoverCacheBytes = this._normalizeLimit(activeCoverCacheBytes, DEFAULT_ACTIVE_COVER_CACHE_BYTES);
        this._secondaryCacheBytes = this._normalizeLimit(secondaryCacheBytes, DEFAULT_SECONDARY_CACHE_BYTES);
        this._now = now;
        this._inFlightByUrlHash = new Map();
        this._startupVerifiedAssets = new Set();

        this._assetsDir = this._path.join(this._baseDir, 'assets');
        this._tempDir = this._path.join(this._baseDir, 'temp');
        this._manifestPath = this._path.join(this._baseDir, 'manifest.json');
        this._backupPath = this._path.join(this._baseDir, 'manifest.backup.json');
        this._journalPath = this._path.join(this._baseDir, 'manifest.transaction-journal.json');
        this._manifestTransaction = null;

        this._ensureStructure();
        this._cleanupTemp();
        this._manifest = this._loadManifest();
        this._recoverTransactionJournal();
        this._scrubManifestIntegrity({ save: true });
    }

    getRootDir() {
        return this._baseDir;
    }

    getAssetsDir() {
        return this._assetsDir;
    }

    getTempDir() {
        return this._tempDir;
    }

    getManifest() {
        return JSON.parse(JSON.stringify(this._manifest));
    }

    getGeneration() {
        return [
            this._manifest.updatedAt || '',
            Object.keys(this._manifest.assets || {}).length,
            Object.keys(this._manifest.aliases || {}).length,
            Object.keys(this._manifest.urls || {}).length,
        ].join(':');
    }

    getCapacityStats() {
        const byClass = this._cacheBytesByClass();
        return {
            maxCacheBytes: this._maxCacheBytes,
            activeCoverCacheBytes: this._activeCoverAllowance(),
            secondaryCacheBytes: this._secondaryCacheBytes,
            coverUpperBoundBytes: this._coverUpperBoundBytes,
            activeLibraryGameCount: this._activeLibraryGameCount,
            byClass,
            totalBytes: Object.values(byClass).reduce((sum, value) => sum + Number(value || 0), 0),
        };
    }

    setActiveLibraryGameCount(count) {
        this._activeLibraryGameCount = Math.max(0, Number(count) || 0);
    }

    beginManifestTransaction({ label = 'bulk-artwork', batchSize = 50 } = {}) {
        const size = Math.max(1, Number(batchSize) || 50);
        if (this._manifestTransaction) {
            this._manifestTransaction.depth += 1;
            this._manifestTransaction.batchSize = Math.min(this._manifestTransaction.batchSize, size);
            return { active: true, nested: true, label: this._manifestTransaction.label, batchSize: this._manifestTransaction.batchSize };
        }
        this._manifestTransaction = {
            label: String(label || 'bulk-artwork'),
            batchSize: size,
            depth: 1,
            dirty: false,
            operationsSinceCommit: 0,
            totalOperations: 0,
            startedAt: this._nowIso(),
            pending: {},
        };
        this._writeTransactionJournal();
        return { active: true, nested: false, label: this._manifestTransaction.label, batchSize: size };
    }

    commitManifestTransaction({ final = true } = {}) {
        const tx = this._manifestTransaction;
        if (!tx) return { committed: false, reason: 'no-active-transaction' };
        if (final && tx.depth > 1) {
            tx.depth -= 1;
            return { committed: false, reason: 'nested-transaction-open', depth: tx.depth };
        }
        // Warm bulk lookups open a transaction to backfill aliases, but often
        // change nothing. Do not rewrite the entire manifest for those reads.
        if (tx.dirty) this._commitManifestNow();
        if (final) {
            this._manifestTransaction = null;
            this._safeUnlink(this._journalPath);
        }
        return { committed: true, final, totalOperations: tx.totalOperations };
    }

    async withManifestTransaction(options, fn) {
        this.beginManifestTransaction(options);
        try {
            const result = await fn();
            this.commitManifestTransaction({ final: true });
            return result;
        } catch (err) {
            try { this.commitManifestTransaction({ final: true }); } catch {}
            throw err;
        }
    }

    preflightStore({ type = null, assetClass = null, estimatedBytes = 0, activeLibraryGameCount = null } = {}) {
        if (activeLibraryGameCount != null) this.setActiveLibraryGameCount(activeLibraryGameCount);
        const normalizedClass = this._normalizeArtworkClass(assetClass, type);
        const bytes = Math.max(0, Number(estimatedBytes) || 0);
        const byClass = this._cacheBytesByClass();
        const disk = this._getAvailableDiskBytes();
        if (disk.availableBytes != null && bytes > 0 && disk.availableBytes < bytes + 50 * MB) {
            return { allowed: false, reason: 'capacity_exhausted', class: normalizedClass, disk, byClass };
        }
        if (normalizedClass === ARTWORK_CACHE_CLASSES.ACTIVE_LIBRARY_COVER) {
            const projected = byClass[normalizedClass] + Math.max(bytes, this._coverUpperBoundBytes);
            const limit = this._activeCoverAllowance();
            if (Number.isFinite(limit) && projected > limit) {
                this._manifest.stats.capacityExhausted += 1;
                this._saveManifest();
                return { allowed: false, reason: 'capacity_exhausted', class: normalizedClass, projectedBytes: projected, maxBytes: limit, byClass, disk };
            }
        } else {
            const projected = byClass[ARTWORK_CACHE_CLASSES.SECONDARY] + byClass[ARTWORK_CACHE_CLASSES.AUTOMATIC] + bytes;
            const limit = this._secondaryCacheBytes;
            if (Number.isFinite(limit) && projected > limit) {
                return { allowed: true, reason: 'secondary-eviction-available', class: normalizedClass, projectedBytes: projected, maxBytes: limit, byClass, disk };
            }
        }
        return { allowed: true, reason: 'capacity-available', class: normalizedClass, byClass, disk };
    }

    hashUrl(url) {
        return this._hash(String(url || ''));
    }

    aliasKey(canonicalGameId, type) {
        if (!ARTWORK_TYPES.has(String(type || ''))) throw new Error(`Unsupported artwork type: ${type || 'unknown'}`);
        return `${sanitizeAliasPart(canonicalGameId)}:${sanitizeAliasPart(type)}`;
    }

    ownsUrl(value) {
        if (!value || typeof value !== 'string' || !value.startsWith('file://')) return false;
        try {
            const filePath = require('url').fileURLToPath(value);
            const relative = this._path.relative(this._baseDir, filePath);
            return !!relative && !relative.startsWith('..') && !this._path.isAbsolute(relative);
        } catch {
            return false;
        }
    }

    async fetchAndStore({ sourceUrl, canonicalGameId, type }) {
        if (!sourceUrl) throw new Error('sourceUrl is required.');
        const urlHash = this.hashUrl(sourceUrl);
        const existing = this._resolveUrlHash(urlHash);
        if (existing) {
            this._attachAlias(existing.assetHash, canonicalGameId, type);
            this._saveManifest();
            return { ...existing, cacheHit: true, urlHash, inFlightDeduplication: false };
        }

        if (this._inFlightByUrlHash.has(urlHash)) {
            const result = await this._inFlightByUrlHash.get(urlHash);
            this._attachAlias(result.assetHash, canonicalGameId, type);
            this._saveManifest();
            return { ...this._materializedResult(result.assetHash), cacheHit: false, urlHash, inFlightDeduplication: true };
        }

        const promise = this._downloadAndStore({ sourceUrl, canonicalGameId, type, urlHash });
        this._inFlightByUrlHash.set(urlHash, promise);
        try {
            return await promise;
        } finally {
            this._inFlightByUrlHash.delete(urlHash);
        }
    }

    storeBuffer({ sourceUrl = null, canonicalGameId, type, buffer, mime = null, extension = null, assetClass = null, variant = null, normalized = false, originalBytes = null }) {
        const bytes = bufferFrom(buffer);
        const image = this._validateImage(bytes, mime);
        const finalMime = image.mime;
        const finalExt = MIME_EXTENSIONS[finalMime] || image.extension || extension || 'img';
        const assetHash = this._hash(bytes);
        const fileName = `${assetHash}.${finalExt}`;
        const finalPath = this._path.join(this._assetsDir, fileName);
        const existed = this._fs.existsSync(finalPath);
        const tempId = this._crypto.randomBytes
            ? this._crypto.randomBytes(6).toString('hex')
            : `${process.pid}.${Date.now()}`;
        const tempPath = this._path.join(this._tempDir, `${assetHash}.${tempId}.tmp`);

        if (!existed) {
            this._fs.writeFileSync(tempPath, bytes);
            this._fs.renameSync(tempPath, finalPath);
        } else if (this._fs.existsSync(tempPath)) {
            this._safeUnlink(tempPath);
        }

        this._ensureAssetRecord(assetHash, {
            extension: finalExt,
            mime: finalMime,
            bytes: bytes.length,
            fileName,
            type,
            artworkClass: this._normalizeArtworkClass(assetClass, type),
            variant,
            normalized,
            originalBytes,
        });
        if (existed) {
            this._manifest.stats.duplicateContentFilesAvoided += 1;
        }

        if (sourceUrl) {
            const urlHash = this.hashUrl(sourceUrl);
            this._manifest.urls[urlHash] = {
                urlHash,
                assetHash,
                lastAccessedAt: this._nowIso(),
            };
            this._addUnique(this._manifest.assets[assetHash].urlHashes, urlHash);
        }

        this._attachAlias(assetHash, canonicalGameId, type);
        const materialized = this._materializedResult(assetHash);
        this._recordTransactionPendingAsset(assetHash);
        this._saveManifest();
        this._enforceArtworkCapacity({ admittedAssetHash: assetHash });

        return {
            ...materialized,
            cacheHit: existed,
            duplicateContent: existed,
            urlHash: sourceUrl ? this.hashUrl(sourceUrl) : null,
        };
    }

    removeAlias({ canonicalGameId, type }) {
        const key = this.aliasKey(canonicalGameId, type);
        const entry = this._manifest.aliases[key];
        if (!entry) return { removed: false };
        delete this._manifest.aliases[key];
        const asset = this._manifest.assets[entry.assetHash];
        if (asset) asset.aliases = (asset.aliases || []).filter(alias => alias !== key);
        this._saveManifest();
        return {
            removed: true,
            assetHash: entry.assetHash,
            assetStillReferenced: this._assetHasReferences(entry.assetHash),
            assetExists: this._assetExists(entry.assetHash),
        };
    }

    lookupAlias({ canonicalGameId, type }) {
        const key = this.aliasKey(canonicalGameId, type);
        const entry = this._manifest.aliases[key];
        if (!entry) return null;
        if (entry.type && entry.type !== type) return null;
        const materialized = this._materializeAsset(entry.assetHash, { invalidate: true });
        if (!materialized) return null;
        const asset = this._manifest.assets[entry.assetHash];
        if (asset) asset.lastAccessedAt = this._nowIso();
        return materialized;
    }

    lookupUrl(sourceUrl, { canonicalGameId = null, type = null } = {}) {
        if (!sourceUrl) return null;
        const urlHash = this.hashUrl(sourceUrl);
        const existing = this._resolveUrlHash(urlHash);
        if (!existing) return null;
        this._attachAlias(existing.assetHash, canonicalGameId, type);
        this._saveManifest();
        return { ...existing, urlHash };
    }

    lookupFileUrl(fileUrl, { type = null } = {}) {
        if (!fileUrl || !String(fileUrl).startsWith('file://')) return null;
        let filePath;
        try {
            filePath = this._path.resolve(fileURLToPath(String(fileUrl)));
        } catch {
            return null;
        }
        const assetsDir = this._path.resolve(this._assetsDir);
        const relative = this._path.relative(assetsDir, filePath);
        if (!relative || relative.startsWith('..') || this._path.isAbsolute(relative)) return null;
        if (relative.includes(this._path.sep) || relative.includes('/') || relative.includes('\\')) return null;

        const asset = Object.values(this._manifest.assets || {})
            .find(entry => entry?.fileName === relative);
        if (!asset) return null;
        if (type && !Array.isArray(asset.aliases)) return null;
        if (type && !asset.aliases.some(alias => {
            const entry = this._manifest.aliases?.[alias];
            return entry?.assetHash === asset.assetHash && entry?.type === type && String(alias).endsWith(`:${type}`);
        })) return null;
        const materialized = this._materializeAsset(asset.assetHash, { invalidate: true });
        if (!materialized) return null;
        const expectedPath = this._path.resolve(fileURLToPath(materialized.fileUrl));
        if (process.platform === 'win32') {
            if (expectedPath.toLowerCase() !== filePath.toLowerCase()) return null;
        } else if (expectedPath !== filePath) {
            return null;
        }
        asset.lastAccessedAt = this._nowIso();
        return materialized;
    }

    linkAliases({ assetHash, canonicalGameIds = [], type }) {
        const materialized = this._materializeAsset(assetHash, { invalidate: true });
        if (!materialized) return null;
        let aliasesCreated = 0;
        for (const id of new Set(canonicalGameIds.filter(Boolean))) {
            const key = this.aliasKey(id, type);
            if (this._manifest.aliases?.[key]?.assetHash === assetHash) continue;
            this._attachAlias(assetHash, id, type);
            aliasesCreated++;
        }
        if (aliasesCreated) this._saveManifest();
        return { ...materialized, aliasesCreated };
    }

    linkAlias({ assetHash, canonicalGameId, type }) {
        if (!assetHash || !this._manifest.assets[assetHash]) return null;
        if (!this._assetExists(assetHash)) {
            this._purgeAssetReferences(assetHash, { removeAsset: true });
            this._saveManifest();
            return null;
        }
        const key = this.aliasKey(canonicalGameId, type);
        const aliasCreated = this._manifest.aliases?.[key]?.assetHash !== assetHash;
        if (aliasCreated) {
            this._attachAlias(assetHash, canonicalGameId, type);
            this._saveManifest();
        }
        const materialized = this._materializedResult(assetHash);
        return materialized ? { ...materialized, aliasCreated } : null;
    }

    cleanupTemp() {
        this._cleanupTemp();
    }

    getCacheSizeBytes() {
        return Object.values(this._manifest.assets || {}).reduce((total, asset) => {
            if (!asset || !this._assetExists(asset.assetHash)) return total;
            return total + (Number(asset.bytes) || 0);
        }, 0);
    }

    enforceMaxCacheBytes({ maxBytes = this._maxCacheBytes } = {}) {
        return this._enforceMaxCacheBytes(maxBytes);
    }

    migrateLegacyImageCache({ legacyCacheDir, entries = null } = {}) {
        const summary = {
            scanned: 0,
            migrated: 0,
            skipped: 0,
            aliases: [],
            errors: [],
            duplicateContentFilesAvoided: 0,
        };
        if (!legacyCacheDir || !this._fs.existsSync(legacyCacheDir)) return summary;

        const beforeDuplicates = this._manifest.stats.duplicateContentFilesAvoided;
        const files = entries || this._safeReadDir(legacyCacheDir);
        for (const fileName of files) {
            const legacy = this._parseLegacyCacheFileName(fileName);
            if (!legacy) continue;
            summary.scanned += 1;

            const legacyPath = this._path.join(legacyCacheDir, fileName);
            try {
                if (!this._fs.statSync(legacyPath).isFile()) {
                    summary.skipped += 1;
                    continue;
                }
                const stored = this.storeBuffer({
                    canonicalGameId: legacy.gameId,
                    type: legacy.type,
                    buffer: this._fs.readFileSync(legacyPath),
                });
                summary.migrated += 1;
                summary.aliases.push({
                    canonicalGameId: legacy.gameId,
                    type: legacy.type,
                    assetHash: stored.assetHash,
                });
            } catch (err) {
                summary.skipped += 1;
                summary.errors.push({
                    fileName,
                    message: err?.message || 'Legacy artwork migration failed.',
                });
            }
        }
        summary.duplicateContentFilesAvoided = this._manifest.stats.duplicateContentFilesAvoided - beforeDuplicates;
        return summary;
    }

    async _downloadAndStore({ sourceUrl, canonicalGameId, type, urlHash }) {
        if (!this._fetch) throw new Error('No fetch implementation available for artwork cache.');
        const response = await this._fetch(sourceUrl);
        if (!response || !response.ok) {
            throw new Error(`Artwork download failed with status ${response && response.status}`);
        }

        const mime = String(response.headers?.get?.('content-type') || '').split(';')[0].toLowerCase();
        if (!MIME_EXTENSIONS[mime]) throw new Error(`Unsupported artwork MIME type: ${mime || 'unknown'}`);
        const declaredLength = Number(response.headers?.get?.('content-length') || 0);
        if (declaredLength > this._maxBytes) throw new Error('Artwork response exceeds maximum supported size.');

        const arrayBuffer = await response.arrayBuffer();
        const bytes = bufferFrom(arrayBuffer);
        const result = this.storeBuffer({
            sourceUrl,
            canonicalGameId,
            type,
            buffer: bytes,
            mime,
        });
        return { ...result, cacheHit: false, urlHash, inFlightDeduplication: false };
    }

    _resolveUrlHash(urlHash) {
        const entry = this._manifest.urls[urlHash];
        if (!entry) return null;
        const materialized = this._materializeAsset(entry.assetHash, { invalidate: true });
        if (!materialized) return null;
        entry.lastAccessedAt = this._nowIso();
        return materialized;
    }

    _materializedResult(assetHash) {
        return this._materializeAsset(assetHash, { invalidate: false });
    }

    _materializeAsset(assetHash, { invalidate = false } = {}) {
        const asset = this._manifest.assets[assetHash];
        if (!asset) return null;
        if (!this._assetExists(assetHash)) {
            if (invalidate) {
                this._purgeAssetReferences(assetHash, { removeAsset: true });
                this._saveManifest();
            }
            return null;
        }
        const filePath = this._path.join(this._assetsDir, asset.fileName);
        return {
            assetHash,
            contentHash: assetHash,
            path: filePath,
            url: pathToFileURL(filePath).href,
            fileUrl: pathToFileURL(filePath).href,
            mime: asset.mime,
            extension: asset.extension,
            bytes: asset.bytes,
            type: asset.type || null,
            logicalTypes: [...new Set((asset.aliases || []).map(alias => this._manifest.aliases?.[alias]?.type).filter(Boolean))],
        };
    }

    _ensureAssetRecord(assetHash, { extension, mime, bytes, fileName, type = null, artworkClass = null, variant = null, normalized = false, originalBytes = null }) {
        if (!this._manifest.assets[assetHash]) {
            this._manifest.assets[assetHash] = {
                assetHash,
                contentHash: assetHash,
                extension,
                mime,
                bytes,
                fileName,
                type: type || null,
                artworkClass: this._normalizeArtworkClass(artworkClass, type),
                variant: variant || null,
                normalized: normalized === true,
                originalBytes: Number(originalBytes) || bytes,
                createdAt: this._nowIso(),
                lastAccessedAt: this._nowIso(),
                urlHashes: [],
                aliases: [],
            };
        } else {
            const asset = this._manifest.assets[assetHash];
            asset.lastAccessedAt = this._nowIso();
            if (type && !asset.type) asset.type = type;
            if (artworkClass && !asset.artworkClass) asset.artworkClass = this._normalizeArtworkClass(artworkClass, type);
            if (variant && !asset.variant) asset.variant = variant;
            if (normalized === true) asset.normalized = true;
            if (originalBytes && !asset.originalBytes) asset.originalBytes = Number(originalBytes) || bytes;
        }
    }

    _attachAlias(assetHash, canonicalGameId, type) {
        if (!canonicalGameId || !type || !this._manifest.assets[assetHash]) return;
        const key = this.aliasKey(canonicalGameId, type);
        this._manifest.aliases[key] = {
            canonicalGameId: String(canonicalGameId),
            type: String(type),
            assetHash,
            updatedAt: this._nowIso(),
        };
        this._addUnique(this._manifest.assets[assetHash].aliases, key);
        this._manifest.assets[assetHash].lastAccessedAt = this._nowIso();
    }

    _assetHasReferences(assetHash) {
        const asset = this._manifest.assets[assetHash];
        return !!asset && ((asset.aliases || []).length > 0 || (asset.urlHashes || []).length > 0);
    }

    _assetExists(assetHash) {
        if (this._startupVerifiedAssets.has(assetHash)) {
            this._startupVerifiedAssets.delete(assetHash);
            return true;
        }
        const asset = this._manifest.assets[assetHash];
        return this._assetFileStatus(asset).usable;
    }

    _assetFileStatus(asset) {
        if (!asset?.fileName) return { usable: false, reason: 'missing-asset-record' };
        const filePath = this._path.join(this._assetsDir, asset.fileName);
        try {
            const stat = this._fs.statSync(filePath);
            if (!stat.isFile() || stat.size <= 0) return { usable: false, reason: 'invalid-file' };
            const fd = this._fs.openSync(filePath, 'r');
            try {
                const header = Buffer.alloc(Math.min(16, stat.size));
                this._fs.readSync(fd, header, 0, header.length, 0);
                if (!sniffImage(header)) return { usable: false, reason: 'unsupported-image' };
            } finally {
                try { this._fs.closeSync(fd); } catch {}
            }
            return { usable: true, reason: null, path: filePath, size: stat.size };
        } catch (err) {
            return { usable: false, reason: err?.code || 'missing-file', path: filePath };
        }
    }

    _scrubManifestIntegrity({ save = false } = {}) {
        let changed = false;
        const assets = this._manifest.assets || {};
        for (const [assetHash, asset] of Object.entries(assets)) {
            if (!this._assetFileStatus(asset).usable) {
                this._purgeAssetReferences(assetHash, { removeAsset: true });
                changed = true;
            } else {
                this._startupVerifiedAssets.add(assetHash);
            }
        }
        for (const [alias, entry] of Object.entries(this._manifest.aliases || {})) {
            if (!entry?.assetHash || !this._manifest.assets?.[entry.assetHash]) {
                delete this._manifest.aliases[alias];
                changed = true;
                continue;
            }
            const suffixType = String(alias).split(':').pop();
            if (!ARTWORK_TYPES.has(suffixType) || (entry.type && entry.type !== suffixType)) {
                delete this._manifest.aliases[alias];
                changed = true;
                continue;
            }
            if (!entry.type) { entry.type = suffixType; changed = true; }
        }
        for (const [urlHash, entry] of Object.entries(this._manifest.urls || {})) {
            if (!entry?.assetHash || !this._manifest.assets?.[entry.assetHash]) {
                delete this._manifest.urls[urlHash];
                changed = true;
            }
        }
        for (const asset of Object.values(this._manifest.assets || {})) {
            const aliases = Array.isArray(asset.aliases) ? asset.aliases : [];
            const urlHashes = Array.isArray(asset.urlHashes) ? asset.urlHashes : [];
            const nextAliases = aliases.filter(alias => this._manifest.aliases?.[alias]?.assetHash === asset.assetHash);
            const nextUrlHashes = urlHashes.filter(urlHash => this._manifest.urls?.[urlHash]?.assetHash === asset.assetHash);
            if (nextAliases.length !== aliases.length) {
                asset.aliases = nextAliases;
                changed = true;
            }
            if (nextUrlHashes.length !== urlHashes.length) {
                asset.urlHashes = nextUrlHashes;
                changed = true;
            }
        }
        if (changed && save) this._saveManifest();
        return { changed };
    }

    _purgeAssetReferences(assetHash, { removeAsset = false } = {}) {
        this._startupVerifiedAssets.delete(assetHash);
        for (const [urlHash, entry] of Object.entries(this._manifest.urls || {})) {
            if (entry?.assetHash === assetHash) delete this._manifest.urls[urlHash];
        }
        for (const [alias, entry] of Object.entries(this._manifest.aliases || {})) {
            if (entry?.assetHash === assetHash) delete this._manifest.aliases[alias];
        }
        if (removeAsset) delete this._manifest.assets[assetHash];
        else if (this._manifest.assets?.[assetHash]) {
            this._manifest.assets[assetHash].aliases = [];
            this._manifest.assets[assetHash].urlHashes = [];
        }
    }

    _validateImage(buffer, mime) {
        if (!buffer || !buffer.length) throw new Error('Artwork asset is empty.');
        if (buffer.length > this._maxBytes) throw new Error('Artwork asset exceeds the maximum supported size.');
        const sniffed = sniffImage(buffer);
        if (!sniffed) throw new Error('Artwork asset is not a supported image.');
        const cleanMime = String(mime || sniffed.mime).split(';')[0].toLowerCase();
        if (!MIME_EXTENSIONS[cleanMime]) throw new Error(`Unsupported artwork MIME type: ${cleanMime || 'unknown'}`);
        if (mime && MIME_EXTENSIONS[cleanMime] !== sniffed.extension && !(cleanMime === 'image/jpeg' && sniffed.extension === 'jpg')) {
            throw new Error('Artwork MIME type does not match image content.');
        }
        return sniffed;
    }

    _loadManifest() {
        const tempManifest = `${this._manifestPath}.tmp`;
        if (!this._fs.existsSync(this._manifestPath) && this._fs.existsSync(tempManifest)) {
            try { this._fs.renameSync(tempManifest, this._manifestPath); } catch {}
        } else if (this._fs.existsSync(tempManifest)) {
            this._safeUnlink(tempManifest);
        }

        const loaded = this._readManifestFile(this._manifestPath);
        if (loaded) return loaded;
        const backup = this._readManifestFile(this._backupPath);
        if (backup) {
            this._writeJsonAtomic(this._manifestPath, backup, false);
            return backup;
        }
        return emptyManifest(this._nowIso());
    }

    _readManifestFile(filePath) {
        try {
            if (!this._fs.existsSync(filePath)) return null;
            const parsed = JSON.parse(this._fs.readFileSync(filePath, 'utf8'));
            if (!parsed || parsed.version !== MANIFEST_VERSION) return null;
            return {
                ...emptyManifest(this._nowIso()),
                ...parsed,
                assets: parsed.assets || {},
                urls: parsed.urls || {},
                aliases: parsed.aliases || {},
                stats: { ...emptyManifest(this._nowIso()).stats, ...(parsed.stats || {}) },
            };
        } catch {
            return null;
        }
    }

    _saveManifest() {
        const tx = this._manifestTransaction;
        if (!tx) {
            this._commitManifestNow();
            return;
        }
        tx.dirty = true;
        tx.operationsSinceCommit += 1;
        tx.totalOperations += 1;
        this._writeTransactionJournal();
        if (tx.operationsSinceCommit >= tx.batchSize) this._commitManifestNow();
    }

    _commitManifestNow() {
        this._manifest.updatedAt = this._nowIso();
        this._writeJsonAtomic(this._manifestPath, this._manifest, true);
        const tx = this._manifestTransaction;
        if (tx) {
            tx.dirty = false;
            tx.operationsSinceCommit = 0;
            tx.pending = {};
            this._writeTransactionJournal();
        }
    }

    _recordTransactionPendingAsset(assetHash) {
        const tx = this._manifestTransaction;
        const asset = this._manifest.assets?.[assetHash];
        if (!tx || !asset) return;
        const urlHashes = {};
        for (const urlHash of asset.urlHashes || []) {
            const entry = this._manifest.urls?.[urlHash];
            if (entry?.assetHash === assetHash) urlHashes[urlHash] = entry;
        }
        const aliases = {};
        for (const alias of asset.aliases || []) {
            const entry = this._manifest.aliases?.[alias];
            if (entry?.assetHash === assetHash) aliases[alias] = entry;
        }
        tx.pending[assetHash] = { asset: { ...asset }, urlHashes, aliases, recordedAt: this._nowIso() };
    }

    _writeTransactionJournal() {
        const tx = this._manifestTransaction;
        if (!tx) return;
        this._writeJsonAtomic(this._journalPath, {
            version: 1,
            label: tx.label,
            batchSize: tx.batchSize,
            startedAt: tx.startedAt,
            updatedAt: this._nowIso(),
            operationsSinceCommit: tx.operationsSinceCommit,
            totalOperations: tx.totalOperations,
            pending: tx.pending || {},
        }, false);
    }

    _recoverTransactionJournal() {
        let journal = null;
        try {
            if (!this._fs.existsSync(this._journalPath)) return;
            journal = JSON.parse(this._fs.readFileSync(this._journalPath, 'utf8'));
        } catch {
            this._safeUnlink(this._journalPath);
            return;
        }
        let recovered = 0;
        for (const [assetHash, entry] of Object.entries(journal?.pending || {})) {
            const asset = entry?.asset;
            if (!asset?.fileName) continue;
            if (!this._fs.existsSync(this._path.join(this._assetsDir, asset.fileName))) continue;
            this._manifest.assets[assetHash] = { ...(this._manifest.assets[assetHash] || {}), ...asset };
            for (const [urlHash, urlEntry] of Object.entries(entry.urlHashes || {})) {
                if (urlEntry?.assetHash === assetHash) this._manifest.urls[urlHash] = urlEntry;
            }
            for (const [alias, aliasEntry] of Object.entries(entry.aliases || {})) {
                if (aliasEntry?.assetHash === assetHash) this._manifest.aliases[alias] = aliasEntry;
            }
            recovered += 1;
        }
        if (recovered > 0) this._commitManifestNow();
        this._safeUnlink(this._journalPath);
    }

    _writeJsonAtomic(filePath, data, backupCurrent) {
        const tmp = `${filePath}.tmp`;
        if (backupCurrent && this._fs.existsSync(filePath)) {
            try { this._fs.copyFileSync(filePath, this._backupPath); } catch {}
        }
        this._fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
        this._replaceFileSync(tmp, filePath);
    }

    _replaceFileSync(tmp, filePath) {
        try {
            this._fs.renameSync(tmp, filePath);
            return;
        } catch (err) {
            if (!err || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err;
        }
        try { this._fs.unlinkSync(filePath); } catch (err) { if (err?.code !== 'ENOENT') throw err; }
        this._fs.renameSync(tmp, filePath);
    }

    _ensureStructure() {
        if (this._path.basename(this._baseDir).toLowerCase() === 'user_artwork') {
            throw new Error('Automatic artwork cache must not use user_artwork as its base directory.');
        }
        this._fs.mkdirSync(this._assetsDir, { recursive: true });
        this._fs.mkdirSync(this._tempDir, { recursive: true });
    }

    _cleanupTemp() {
        try {
            if (!this._fs.existsSync(this._tempDir)) return;
            for (const file of this._fs.readdirSync(this._tempDir)) {
                this._safeUnlink(this._path.join(this._tempDir, file));
            }
        } catch {
            // Cache recovery must be best-effort.
        }
    }

    _safeReadDir(dirPath) {
        try { return this._fs.readdirSync(dirPath); } catch { return []; }
    }

    _parseLegacyCacheFileName(fileName) {
        const match = /^(cover|hero|logo)_(.+)\.[^.]+$/i.exec(String(fileName || ''));
        if (!match) return null;
        const gameId = match[2];
        if (!gameId || gameId.includes('/') || gameId.includes('\\')) return null;
        return {
            type: match[1].toLowerCase(),
            gameId,
        };
    }

    _hash(value) {
        return this._crypto.createHash('sha256').update(value).digest('hex');
    }

    _addUnique(target, value) {
        if (!target.includes(value)) target.push(value);
    }

    _safeUnlink(filePath) {
        try { this._fs.unlinkSync(filePath); } catch {}
    }

    _enforceArtworkCapacity({ admittedAssetHash = null } = {}) {
        const admitted = admittedAssetHash ? this._manifest.assets[admittedAssetHash] : null;
        const admittedClass = this._assetClass(admitted);
        if (admittedClass === ARTWORK_CACHE_CLASSES.AUTOMATIC) {
            return this._enforceMaxCacheBytes();
        }
        if (admittedClass === ARTWORK_CACHE_CLASSES.ACTIVE_LIBRARY_COVER) {
            const byClass = this._cacheBytesByClass();
            const limit = this._activeCoverAllowance();
            if (Number.isFinite(limit) && byClass[ARTWORK_CACHE_CLASSES.ACTIVE_LIBRARY_COVER] > limit) {
                this._manifest.stats.capacityExhausted += 1;
                this._saveManifest();
                return { capacityExhausted: true, class: admittedClass, beforeBytes: byClass[ARTWORK_CACHE_CLASSES.ACTIVE_LIBRARY_COVER], maxBytes: limit, evictedAssets: 0, evictedBytes: 0 };
            }
            return { capacityExhausted: false, class: admittedClass, evictedAssets: 0, evictedBytes: 0 };
        }
        return this._enforceSecondaryCapacity();
    }

    _enforceSecondaryCapacity() {
        const byClass = this._cacheBytesByClass();
        const secondaryBefore = byClass[ARTWORK_CACHE_CLASSES.SECONDARY] + byClass[ARTWORK_CACHE_CLASSES.AUTOMATIC];
        const summary = {
            maxBytes: this._secondaryCacheBytes,
            beforeBytes: secondaryBefore,
            afterBytes: secondaryBefore,
            evictedAssets: 0,
            evictedBytes: 0,
            protectedActiveCoverBytes: byClass[ARTWORK_CACHE_CLASSES.ACTIVE_LIBRARY_COVER],
        };
        if (!Number.isFinite(this._secondaryCacheBytes) || secondaryBefore <= this._secondaryCacheBytes) return summary;
        let currentBytes = secondaryBefore;
        const candidates = this._evictionCandidates({ includeActiveCovers: false });
        for (const asset of candidates) {
            if (currentBytes <= this._secondaryCacheBytes) break;
            const evicted = this._evictAsset(asset.assetHash);
            if (!evicted.evicted) continue;
            currentBytes -= evicted.bytes;
            summary.evictedAssets += 1;
            summary.evictedBytes += evicted.bytes;
            this._incrementEvictionClass(evicted.artworkClass);
        }
        summary.afterBytes = Math.max(0, currentBytes);
        if (summary.evictedAssets > 0) {
            this._manifest.stats.evictedAssets += summary.evictedAssets;
            this._manifest.stats.evictedBytes += summary.evictedBytes;
            this._saveManifest();
        }
        return summary;
    }

    _enforceMaxCacheBytes(maxBytes = this._maxCacheBytes) {
        const limit = this._normalizeLimit(maxBytes, this._maxCacheBytes);
        const summary = {
            maxBytes: limit,
            beforeBytes: this.getCacheSizeBytes(),
            afterBytes: 0,
            evictedAssets: 0,
            evictedBytes: 0,
        };
        if (!Number.isFinite(limit)) {
            summary.afterBytes = summary.beforeBytes;
            return summary;
        }

        let currentBytes = summary.beforeBytes;
        if (currentBytes <= limit) {
            summary.afterBytes = currentBytes;
            return summary;
        }

        const candidates = this._evictionCandidates({ includeActiveCovers: false });
        for (const asset of candidates) {
            if (currentBytes <= limit) break;
            const evicted = this._evictAsset(asset.assetHash);
            if (!evicted.evicted) continue;
            currentBytes -= evicted.bytes;
            summary.evictedAssets += 1;
            summary.evictedBytes += evicted.bytes;
            this._incrementEvictionClass(evicted.artworkClass);
        }

        summary.afterBytes = Math.max(0, currentBytes);
        if (currentBytes > limit) {
            summary.capacityExhausted = true;
            this._manifest.stats.capacityExhausted += 1;
        }
        if (summary.evictedAssets > 0 || summary.capacityExhausted) {
            this._manifest.stats.evictedAssets += summary.evictedAssets;
            this._manifest.stats.evictedBytes += summary.evictedBytes;
            this._saveManifest();
        }
        return summary;
    }

    _evictionCandidates({ includeActiveCovers = false } = {}) {
        return Object.values(this._manifest.assets || {})
            .filter(asset => asset && this._assetExists(asset.assetHash))
            .filter(asset => includeActiveCovers || this._assetClass(asset) !== ARTWORK_CACHE_CLASSES.ACTIVE_LIBRARY_COVER)
            .sort((a, b) => {
                const aTime = Date.parse(a.lastAccessedAt || a.createdAt || 0) || 0;
                const bTime = Date.parse(b.lastAccessedAt || b.createdAt || 0) || 0;
                return (aTime - bTime) || String(a.assetHash).localeCompare(String(b.assetHash));
            });
    }

    _evictAsset(assetHash) {
        const asset = this._manifest.assets[assetHash];
        if (!asset) return { evicted: false, bytes: 0, artworkClass: ARTWORK_CACHE_CLASSES.AUTOMATIC };
        const bytes = Number(asset.bytes) || 0;
        const artworkClass = this._assetClass(asset);
        this._safeUnlink(this._path.join(this._assetsDir, asset.fileName));

        for (const [urlHash, entry] of Object.entries(this._manifest.urls || {})) {
            if (entry?.assetHash === assetHash) delete this._manifest.urls[urlHash];
        }
        for (const [alias, entry] of Object.entries(this._manifest.aliases || {})) {
            if (entry?.assetHash === assetHash) delete this._manifest.aliases[alias];
        }
        delete this._manifest.assets[assetHash];
        return { evicted: true, bytes, artworkClass };
    }

    async migrateOneOversizedActiveCover({ normalizer, minBytes = this._coverUpperBoundBytes } = {}) {
        if (typeof normalizer !== 'function') return { migrated: false, reason: 'missing-normalizer' };
        const candidates = Object.values(this._manifest.assets || {})
            .filter(asset => asset && this._assetExists(asset.assetHash))
            .filter(asset => this._assetClass(asset) === ARTWORK_CACHE_CLASSES.ACTIVE_LIBRARY_COVER || this._assetHasCoverAlias(asset))
            .filter(asset => Number(asset.bytes || 0) > minBytes)
            .sort((a, b) => (Number(b.bytes || 0) - Number(a.bytes || 0)) || String(a.assetHash).localeCompare(String(b.assetHash)));
        const asset = candidates[0];
        if (!asset) return { migrated: false, reason: 'no-oversized-active-cover' };
        const oldPath = this._path.join(this._assetsDir, asset.fileName);
        const beforeBytes = Number(asset.bytes || 0);
        const input = this._fs.readFileSync(oldPath);
        const normalized = await normalizer({ buffer: input, asset: { ...asset }, maxBytes: minBytes });
        if (!normalized || !normalized.buffer) return { migrated: false, reason: 'normalizer-skipped', assetHash: asset.assetHash };
        const bytes = bufferFrom(normalized.buffer);
        if (!bytes.length || bytes.length >= beforeBytes) return { migrated: false, reason: 'normalized-not-smaller', assetHash: asset.assetHash, beforeBytes, afterBytes: bytes.length };

        const image = this._validateImage(bytes, normalized.mime || 'image/webp');
        const finalMime = image.mime;
        const finalExt = MIME_EXTENSIONS[finalMime] || image.extension || 'webp';
        const newHash = this._hash(bytes);
        const newFileName = `${newHash}.${finalExt}`;
        const newPath = this._path.join(this._assetsDir, newFileName);
        const tempId = this._crypto.randomBytes ? this._crypto.randomBytes(6).toString('hex') : `${process.pid}.${Date.now()}`;
        const tempPath = this._path.join(this._tempDir, `${newHash}.${tempId}.tmp`);
        if (!this._fs.existsSync(newPath)) {
            this._fs.writeFileSync(tempPath, bytes);
            this._fs.renameSync(tempPath, newPath);
        }

        this._ensureAssetRecord(newHash, {
            extension: finalExt,
            mime: finalMime,
            bytes: bytes.length,
            fileName: newFileName,
            type: asset.type || 'cover',
            artworkClass: ARTWORK_CACHE_CLASSES.ACTIVE_LIBRARY_COVER,
            variant: 'card-cover-384x576-webp',
            normalized: true,
            originalBytes: asset.originalBytes || beforeBytes,
        });
        const next = this._manifest.assets[newHash];
        const oldAliases = Array.from(new Set(asset.aliases || []));
        const oldUrlHashes = Array.from(new Set(asset.urlHashes || []));
        for (const alias of oldAliases) {
            const existing = this._manifest.aliases[alias];
            if (existing?.assetHash === asset.assetHash) existing.assetHash = newHash;
            this._addUnique(next.aliases, alias);
        }
        for (const urlHash of oldUrlHashes) {
            const existing = this._manifest.urls[urlHash];
            if (existing?.assetHash === asset.assetHash) existing.assetHash = newHash;
            this._addUnique(next.urlHashes, urlHash);
        }
        this._manifest.stats.normalizedCoverMigrations += 1;
        this._manifest.stats.normalizedCoverMigrationBytesSaved += Math.max(0, beforeBytes - bytes.length);
        this._recordTransactionPendingAsset(newHash);
        delete this._manifest.assets[asset.assetHash];
        this._saveManifest();
        this._safeUnlink(oldPath);
        return {
            migrated: true,
            oldAssetHash: asset.assetHash,
            assetHash: newHash,
            beforeBytes,
            afterBytes: bytes.length,
            bytesSaved: beforeBytes - bytes.length,
            aliases: oldAliases.length,
            fileUrl: this._materializedResult(newHash)?.fileUrl || null,
        };
    }

    _assetHasCoverAlias(asset) {
        if (!asset) return false;
        if (String(asset.type || '').toLowerCase() === 'cover') return true;
        return Array.isArray(asset.aliases) && asset.aliases.some(alias => String(alias).endsWith(':cover'));
    }

    _assetClass(asset) {
        return this._normalizeArtworkClass(asset?.artworkClass, asset?.type);
    }

    _normalizeArtworkClass(value, type = null) {
        const candidate = String(value || '').trim();
        if (Object.values(ARTWORK_CACHE_CLASSES).includes(candidate)) return candidate;
        return ARTWORK_CACHE_CLASSES.AUTOMATIC;
    }

    _cacheBytesByClass() {
        const result = {
            [ARTWORK_CACHE_CLASSES.ACTIVE_LIBRARY_COVER]: 0,
            [ARTWORK_CACHE_CLASSES.SECONDARY]: 0,
            [ARTWORK_CACHE_CLASSES.AUTOMATIC]: 0,
        };
        for (const asset of Object.values(this._manifest.assets || {})) {
            // Capacity accounting uses the validated manifest. Reopening every
            // image for each stats/preflight call blocks downloads and IPC.
            // Startup scrubbing and individual lookups still validate files.
            // Externally removed files are conservatively counted until then.
            if (!asset) continue;
            const cls = this._assetClass(asset);
            result[cls] = (result[cls] || 0) + (Number(asset.bytes) || 0);
        }
        return result;
    }

    _activeCoverAllowance() {
        const dynamic = Math.max(0, this._activeLibraryGameCount) * this._coverUpperBoundBytes;
        const configured = this._activeCoverCacheBytes;
        if (!Number.isFinite(configured)) return configured;
        return Math.max(configured, dynamic);
    }

    _getAvailableDiskBytes() {
        try {
            if (typeof this._fs.statfsSync !== 'function') return { availableBytes: null, supported: false };
            const stats = this._fs.statfsSync(this._baseDir);
            const availableBytes = Number(stats.bavail) * Number(stats.bsize);
            return { availableBytes: Number.isFinite(availableBytes) ? availableBytes : null, supported: true };
        } catch (err) {
            return { availableBytes: null, supported: false, error: err?.code || err?.message || String(err) };
        }
    }

    _incrementEvictionClass(artworkClass) {
        const key = artworkClass || ARTWORK_CACHE_CLASSES.AUTOMATIC;
        this._manifest.stats.evictionsByArtworkClass = this._manifest.stats.evictionsByArtworkClass || {};
        this._manifest.stats.evictionsByArtworkClass[key] = (this._manifest.stats.evictionsByArtworkClass[key] || 0) + 1;
    }

    _normalizeLimit(value, fallback) {
        if (value === Infinity || value === 'Infinity') return Infinity;
        const n = Number(value);
        if (!Number.isFinite(n) || n < 0) return fallback;
        return n;
    }

    _nowIso() {
        return this._now().toISOString();
    }
}

module.exports = {
    ContentAddressedArtworkCache,
    DEFAULT_MAX_BYTES,
    DEFAULT_MAX_CACHE_BYTES,
    DEFAULT_ACTIVE_COVER_CACHE_BYTES,
    DEFAULT_SECONDARY_CACHE_BYTES,
    DEFAULT_COVER_UPPER_BOUND_BYTES,
    ARTWORK_CACHE_CLASSES,
    MANIFEST_VERSION,
    MIME_EXTENSIONS,
    sniffImage,
};
