'use strict';

const { pathToFileURL } = require('url');

const DEFAULT_MAX_BYTES = 15 * 1024 * 1024;
const MANIFEST_VERSION = 1;

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
        now = () => new Date(),
    }) {
        this._fs = fs;
        this._path = path;
        this._crypto = crypto;
        this._baseDir = baseDir;
        this._fetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
        this._logger = logger;
        this._maxBytes = maxBytes;
        this._now = now;
        this._inFlightByUrlHash = new Map();

        this._assetsDir = this._path.join(this._baseDir, 'assets');
        this._tempDir = this._path.join(this._baseDir, 'temp');
        this._manifestPath = this._path.join(this._baseDir, 'manifest.json');
        this._backupPath = this._path.join(this._baseDir, 'manifest.backup.json');

        this._ensureStructure();
        this._cleanupTemp();
        this._manifest = this._loadManifest();
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

    hashUrl(url) {
        return this._hash(String(url || ''));
    }

    aliasKey(canonicalGameId, type) {
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

    storeBuffer({ sourceUrl = null, canonicalGameId, type, buffer, mime = null, extension = null }) {
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
        this._saveManifest();

        return {
            ...this._materializedResult(assetHash),
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
        if (!this._assetExists(entry.assetHash)) return null;
        const asset = this._manifest.assets[entry.assetHash];
        if (asset) asset.lastAccessedAt = this._nowIso();
        return this._materializedResult(entry.assetHash);
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

    linkAlias({ assetHash, canonicalGameId, type }) {
        if (!assetHash || !this._manifest.assets[assetHash]) return null;
        this._attachAlias(assetHash, canonicalGameId, type);
        this._saveManifest();
        return this._materializedResult(assetHash);
    }

    cleanupTemp() {
        this._cleanupTemp();
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
        if (!entry || !this._assetExists(entry.assetHash)) return null;
        entry.lastAccessedAt = this._nowIso();
        return this._materializedResult(entry.assetHash);
    }

    _materializedResult(assetHash) {
        const asset = this._manifest.assets[assetHash];
        if (!asset) return null;
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
        };
    }

    _ensureAssetRecord(assetHash, { extension, mime, bytes, fileName }) {
        if (!this._manifest.assets[assetHash]) {
            this._manifest.assets[assetHash] = {
                assetHash,
                contentHash: assetHash,
                extension,
                mime,
                bytes,
                fileName,
                createdAt: this._nowIso(),
                lastAccessedAt: this._nowIso(),
                urlHashes: [],
                aliases: [],
            };
        } else {
            this._manifest.assets[assetHash].lastAccessedAt = this._nowIso();
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
        const asset = this._manifest.assets[assetHash];
        return !!asset && this._fs.existsSync(this._path.join(this._assetsDir, asset.fileName));
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
                stats: { duplicateContentFilesAvoided: 0, ...(parsed.stats || {}) },
            };
        } catch {
            return null;
        }
    }

    _saveManifest() {
        this._manifest.updatedAt = this._nowIso();
        this._writeJsonAtomic(this._manifestPath, this._manifest, true);
    }

    _writeJsonAtomic(filePath, data, backupCurrent) {
        const tmp = `${filePath}.tmp`;
        if (backupCurrent && this._fs.existsSync(filePath)) {
            try { this._fs.copyFileSync(filePath, this._backupPath); } catch {}
        }
        this._fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
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

    _nowIso() {
        return this._now().toISOString();
    }
}

module.exports = {
    ContentAddressedArtworkCache,
    DEFAULT_MAX_BYTES,
    MANIFEST_VERSION,
    MIME_EXTENSIONS,
    sniffImage,
};
