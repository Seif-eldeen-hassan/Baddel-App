'use strict';

const { fileURLToPath, pathToFileURL } = require('url');

const DEFAULT_MAX_BYTES = 15 * 1024 * 1024;
const MIME_EXTENSIONS = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
};

function sanitizeId(value) {
    return String(value || 'unknown')
        .trim()
        .replace(/[^a-zA-Z0-9._-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 96) || 'unknown';
}

function extensionFromPath(path, fallback = 'png') {
    const match = /\.([a-zA-Z0-9]{2,8})(?:[?#].*)?$/.exec(String(path || ''));
    return match ? match[1].toLowerCase() : fallback;
}

class ArtworkAssetStore {
    constructor({
        fs,
        path,
        crypto,
        baseDir,
        fetchImpl = null,
        logger = console,
        maxBytes = DEFAULT_MAX_BYTES,
    }) {
        this._fs = fs;
        this._path = path;
        this._crypto = crypto;
        this._baseDir = baseDir;
        this._fetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
        this._log = logger;
        this._maxBytes = maxBytes;
    }

    getRootDir() {
        return this._baseDir;
    }

    getRootFileUrl() {
        return pathToFileURL(this._baseDir).href.replace(/\/?$/, '/');
    }

    ownsUrl(value) {
        if (!value || typeof value !== 'string' || !value.startsWith('file://')) return false;
        try {
            const filePath = fileURLToPath(value);
            const relative = this._path.relative(this._baseDir, filePath);
            return !!relative && !relative.startsWith('..') && !this._path.isAbsolute(relative);
        } catch {
            return false;
        }
    }

    materializeSync({ canonicalGameId, type, value }) {
        const parsed = this._readLocalValueSync(value);
        if (!parsed) return value || null;
        return this._writeBufferSync({ canonicalGameId, type, ...parsed }).url;
    }

    async materialize({ canonicalGameId, type, value }) {
        if (!value) return null;
        if (this.ownsUrl(value)) return value;
        const parsed = this._readLocalValueSync(value);
        if (parsed) {
            return this._writeBufferSync({ canonicalGameId, type, ...parsed }).url;
        }
        if (/^https?:\/\//i.test(value)) {
            const downloaded = await this._download(value);
            return this._writeBufferSync({ canonicalGameId, type, ...downloaded }).url;
        }
        if (/^blob:/i.test(value)) {
            throw new Error('Blob artwork URLs are transient and cannot be persisted.');
        }
        return value;
    }

    _readLocalValueSync(value) {
        if (!value || typeof value !== 'string') return null;
        const trimmed = value.trim();
        const recoveredDataUrl = trimmed.startsWith('file://data:image/')
            ? trimmed.slice('file://'.length)
            : trimmed;
        const dataMatch = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/i.exec(recoveredDataUrl);
        if (dataMatch) {
            const buffer = Buffer.from(dataMatch[2], 'base64');
            this._assertSize(buffer);
            return {
                buffer,
                extension: MIME_EXTENSIONS[dataMatch[1].toLowerCase()] || 'png',
                sourceKind: 'data-url',
            };
        }
        if (/^file:\/\//i.test(trimmed)) {
            let filePath = null;
            try {
                filePath = fileURLToPath(trimmed);
            } catch {
                return null;
            }
            if (!this._fs.existsSync(filePath)) return null;
            return this._readFileSync(filePath, extensionFromPath(filePath));
        }
        if (this._path.isAbsolute(trimmed)) {
            if (!this._fs.existsSync(trimmed)) return null;
            return this._readFileSync(trimmed, extensionFromPath(trimmed));
        }
        if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
            throw new Error('Unsupported artwork URL scheme.');
        }
        return null;
    }

    _readFileSync(filePath, extension) {
        const buffer = this._fs.readFileSync(filePath);
        this._assertSize(buffer);
        return { buffer, extension, sourceKind: 'local-file' };
    }

    async _download(url) {
        if (!this._fetch) throw new Error('No fetch implementation available for remote artwork materialization.');
        const response = await this._fetch(url);
        if (!response || !response.ok) {
            throw new Error(`Artwork download failed with status ${response && response.status}`);
        }
        const contentType = String(response.headers?.get?.('content-type') || '').split(';')[0].toLowerCase();
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        this._assertSize(buffer);
        return {
            buffer,
            extension: MIME_EXTENSIONS[contentType] || extensionFromPath(url, 'jpg'),
            sourceKind: 'remote-url',
        };
    }

    _writeBufferSync({ canonicalGameId, type, buffer, extension, sourceKind }) {
        this._assertSize(buffer);
        const safeGameId = sanitizeId(canonicalGameId);
        const safeType = sanitizeId(type);
        const hash = this._crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);
        const dir = this._path.join(this._baseDir, safeGameId);
        this._fs.mkdirSync(dir, { recursive: true });
        const filePath = this._path.join(dir, `${safeType}.${hash}.${extension || 'png'}`);
        if (!this._fs.existsSync(filePath)) {
            this._fs.writeFileSync(filePath, buffer);
        }
        this._log.log?.('[ArtworkAssetStore] materialized artwork', {
            canonicalGameId: safeGameId,
            type: safeType,
            sourceKind,
            bytes: buffer.length,
        });
        return { path: filePath, url: pathToFileURL(filePath).href, hash };
    }

    _assertSize(buffer) {
        if (!buffer || !buffer.length) throw new Error('Artwork asset is empty.');
        if (buffer.length > this._maxBytes) throw new Error('Artwork asset exceeds the maximum supported size.');
    }
}

module.exports = {
    ArtworkAssetStore,
    DEFAULT_MAX_BYTES,
};
