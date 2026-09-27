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
        timeoutMs = 15000,
    } = {}) {
        this._fetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
        this._maxAttempts = Math.max(1, Number(maxAttempts) || 1);
        this._baseDelayMs = Math.max(0, Number(baseDelayMs) || 0);
        this._maxDelayMs = Math.max(this._baseDelayMs, Number(maxDelayMs) || this._baseDelayMs);
        this._sleep = sleep;
        this._timeoutMs = Math.max(1000, Number(timeoutMs) || 15000);
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
                return await this._fetchWithTimeout(url, { headers }, response => this._handleResponse(response, {
                    url,
                    attempt,
                    maxBytes,
                    canRetry: attempt < this._maxAttempts,
                }));
            } catch (err) {
                lastError = err;
                const retryable = err instanceof ArtworkHttpError ? err.retryable : true;
                if (!retryable || attempt >= this._maxAttempts) break;
                await this._sleep(this._retryDelay(err, attempt));
            }
        }
        throw lastError;
    }

    async _fetchWithTimeout(url, options = {}, consume = response => response) {
        const controller = new AbortController();
        let timer;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => {
                reject(new ArtworkHttpError(`Artwork request timed out after ${this._timeoutMs}ms.`, { retryable: true }));
                controller.abort();
            }, this._timeoutMs);
        });
        try {
            const operation = async () => {
                let response;
                try {
                    response = await this._fetch(url, { ...options, signal: controller.signal });
                } catch (err) {
                    const networkCode = err?.cause?.code || err?.code || null;
                    if (!controller.signal.aborted && /^https:/i.test(String(url || '')) && ['ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH'].includes(networkCode)) {
                        response = await this._fetchHttpsIpv4(url, { ...options, signal: controller.signal });
                    } else throw err;
                }
                // Keep the same deadline and signal through body consumption.
                return consume(response);
            };
            return await Promise.race([operation(), timeout]);
        } catch (err) {
            if (err?.name === 'AbortError') {
                throw new ArtworkHttpError(`Artwork request timed out after ${this._timeoutMs}ms for ${url}`, {
                    status: null,
                    retryable: true,
                });
            }
            throw err;
        } finally {
            clearTimeout(timer);
        }
    }

    _fetchHttpsIpv4(url, options = {}, redirects = 0) {
        if (typeof require !== 'function') return Promise.reject(new ArtworkHttpError('IPv4 HTTPS fallback is unavailable.'));
        const https = require('node:https');
        const parsed = new URL(String(url));
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
            return Promise.reject(new ArtworkHttpError('Artwork IPv4 fallback accepts credential-free HTTPS URLs only.'));
        }
        return new Promise((resolve, reject) => {
            const request = https.get(parsed, { headers: options.headers || {}, family: 4, signal: options.signal }, response => {
                const status = Number(response.statusCode || 0);
                const location = response.headers.location;
                if (status >= 300 && status < 400 && location && redirects < 3) {
                    response.resume();
                    let next;
                    try { next = new URL(location, parsed); } catch { reject(new ArtworkHttpError('Invalid artwork redirect.')); return; }
                    if (next.protocol !== 'https:' || next.username || next.password) {
                        reject(new ArtworkHttpError('Artwork redirect must remain credential-free HTTPS.'));
                        return;
                    }
                    this._fetchHttpsIpv4(next.href, options, redirects + 1).then(resolve, reject);
                    return;
                }
                const chunks = [];
                response.on('data', chunk => chunks.push(Buffer.from(chunk)));
                response.on('error', reject);
                response.on('end', () => {
                    const body = Buffer.concat(chunks);
                    resolve({
                        status,
                        ok: status >= 200 && status < 300,
                        headers: { get: name => response.headers[String(name || '').toLowerCase()] || null },
                        arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
                    });
                });
            });
            request.setTimeout(this._timeoutMs, () => request.destroy(new ArtworkHttpError(`Artwork IPv4 request timed out after ${this._timeoutMs}ms.`, { retryable: true })));
            request.on('error', reject);
        });
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
