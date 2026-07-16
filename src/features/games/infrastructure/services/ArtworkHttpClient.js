'use strict';

const { MIME_EXTENSIONS, DEFAULT_MAX_BYTES } = require('./ContentAddressedArtworkCache');

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

class ArtworkHttpError extends Error {
    constructor(message, { status = null, retryable = false } = {}) {
        super(message);
        this.name = 'ArtworkHttpError';
        this.status = status;
        this.retryable = retryable;
    }
}

function bufferFrom(value) {
    if (Buffer.isBuffer(value)) return value;
    if (value instanceof ArrayBuffer) return Buffer.from(value);
    if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    return Buffer.from(value || []);
}

function headerValue(headers, name) {
    if (!headers) return null;
    if (typeof headers.get === 'function') return headers.get(name);
    return headers[String(name).toLowerCase()] || headers[name] || null;
}

function parseRetryAfter(value) {
    if (!value) return null;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const dateMs = Date.parse(value);
    if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
    return null;
}

class ArtworkHttpClient {
    constructor({
        fetchImpl = null,
        maxAttempts = 3,
        baseDelayMs = 250,
        maxDelayMs = 5000,
        sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
    } = {}) {
        this._fetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
        this._maxAttempts = Math.max(1, Number(maxAttempts) || 1);
        this._baseDelayMs = Math.max(0, Number(baseDelayMs) || 0);
        this._maxDelayMs = Math.max(this._baseDelayMs, Number(maxDelayMs) || this._baseDelayMs);
        this._sleep = sleep;
    }

    async fetchImage({ url, etag = null, lastModified = null, maxBytes = DEFAULT_MAX_BYTES } = {}) {
        if (!this._fetch) throw new ArtworkHttpError('No fetch implementation available for artwork HTTP client.');
        if (!url) throw new ArtworkHttpError('Artwork URL is required.');

        const headers = {};
        if (etag) headers['If-None-Match'] = etag;
        if (lastModified) headers['If-Modified-Since'] = lastModified;

        let lastError = null;
        for (let attempt = 1; attempt <= this._maxAttempts; attempt += 1) {
            try {
                const response = await this._fetch(url, { headers });
                return await this._handleResponse(response, {
                    url,
                    attempt,
                    maxBytes,
                    canRetry: attempt < this._maxAttempts,
                });
            } catch (err) {
                lastError = err;
                const retryable = err instanceof ArtworkHttpError ? err.retryable : true;
                if (!retryable || attempt >= this._maxAttempts) break;
                await this._sleep(this._retryDelay(err, attempt));
            }
        }
        throw lastError;
    }

    async _handleResponse(response, { url, attempt, maxBytes, canRetry }) {
        const status = Number(response?.status || 0);
        const retryable = RETRYABLE_STATUSES.has(status);
        if (status === 304) {
            return {
                status,
                notModified: true,
                buffer: null,
                bytes: 0,
                mime: null,
                etag: headerValue(response.headers, 'etag'),
                lastModified: headerValue(response.headers, 'last-modified'),
                retryCount: attempt - 1,
            };
        }
        if (!response || !response.ok) {
            const err = new ArtworkHttpError(`Artwork request failed with HTTP ${status || 'unknown'} for ${url}`, {
                status,
                retryable: retryable && canRetry,
            });
            err.retryAfterMs = parseRetryAfter(headerValue(response?.headers, 'retry-after'));
            throw err;
        }

        const mime = String(headerValue(response.headers, 'content-type') || '').split(';')[0].toLowerCase();
        if (!MIME_EXTENSIONS[mime]) {
            throw new ArtworkHttpError(`Unsupported artwork MIME type: ${mime || 'unknown'}`, { status, retryable: false });
        }

        const declaredLength = Number(headerValue(response.headers, 'content-length') || 0);
        if (declaredLength > maxBytes) {
            throw new ArtworkHttpError('Artwork response exceeds maximum supported size.', { status, retryable: false });
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = bufferFrom(arrayBuffer);
        if (buffer.length > maxBytes) {
            throw new ArtworkHttpError('Artwork response exceeds maximum supported size.', { status, retryable: false });
        }

        return {
            status,
            notModified: false,
            buffer,
            bytes: buffer.length,
            mime,
            etag: headerValue(response.headers, 'etag'),
            lastModified: headerValue(response.headers, 'last-modified'),
            retryCount: attempt - 1,
        };
    }

    _retryDelay(err, attempt) {
        if (Number.isFinite(err?.retryAfterMs)) return Math.min(err.retryAfterMs, this._maxDelayMs);
        return Math.min(this._baseDelayMs * (2 ** Math.max(0, attempt - 1)), this._maxDelayMs);
    }
}

module.exports = {
    ArtworkHttpClient,
    ArtworkHttpError,
    RETRYABLE_STATUSES,
    parseRetryAfter,
};
