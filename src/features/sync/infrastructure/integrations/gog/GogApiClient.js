'use strict';

const https = require('node:https');

const gogHttpsAgent = new https.Agent({ keepAlive: true, family: 4 });

function defaultGogFetch(input, init = {}, redirectCount = 0) {
    const url = input instanceof URL ? input : new URL(String(input));
    return new Promise((resolve, reject) => {
        const request = https.request(url, {
            method: init.method || 'GET',
            headers: init.headers || {},
            agent: gogHttpsAgent,
            family: 4,
        }, (response) => {
            const status = Number(response.statusCode || 0);
            const location = response.headers.location;
            if (location && status >= 300 && status < 400 && redirectCount < 5) {
                response.resume();
                const nextUrl = new URL(location, url);
                const nextHeaders = { ...(init.headers || {}) };
                if (nextUrl.origin !== url.origin) {
                    delete nextHeaders.Authorization;
                    delete nextHeaders.authorization;
                }
                resolve(defaultGogFetch(nextUrl, { ...init, headers: nextHeaders }, redirectCount + 1));
                return;
            }
            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.once('error', reject);
            response.once('end', () => {
                const body = Buffer.concat(chunks);
                resolve({
                    ok: status >= 200 && status < 300,
                    status,
                    headers: { get: (name) => response.headers[String(name || '').toLowerCase()] || null },
                    json: async () => JSON.parse(body.toString('utf8')),
                    text: async () => body.toString('utf8'),
                    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
                });
            });
        });
        const abort = () => request.destroy(Object.assign(new Error('The operation was aborted'), { name: 'AbortError', code: 'ABORT_ERR' }));
        if (init.signal) {
            if (init.signal.aborted) abort();
            else init.signal.addEventListener('abort', abort, { once: true });
            request.once('close', () => init.signal.removeEventListener('abort', abort));
        }
        request.once('error', reject);
        request.end(init.body);
    });
}

class GogApiError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = 'GogApiError';
        this.code = code;
        this.status = details.status;
        this.details = details;
    }
}

function isTransientStatus(status) {
    return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

function isTransientGogError(error) {
    return isTransientStatus(error?.status) || error?.details?.transient === true ||
        ['GOG_LIBRARY_TIMEOUT', 'GOG_LIBRARY_NETWORK_ERROR'].includes(error?.code);
}

function retryAfterMs(response) {
    const raw = response?.headers?.get?.('retry-after');
    if (!raw) return null;
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(30000, seconds * 1000);
    const at = Date.parse(raw);
    return Number.isFinite(at) ? Math.max(0, Math.min(30000, at - Date.now())) : null;
}

class GogApiClient {
    constructor({
        fetchImpl = defaultGogFetch,
        baseUrl = 'https://galaxy-library.gog.com',
        sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        timeoutMs = 15000,
        maxRetries = 2,
        random = Math.random,
    } = {}) {
        if (typeof fetchImpl !== 'function') {
            throw new TypeError('GogApiClient requires fetch');
        }
        this.fetch = fetchImpl;
        this.baseUrl = baseUrl;
        this.sleep = sleep;
        this.timeoutMs = timeoutMs;
        this.maxRetries = maxRetries;
        this.random = random;
    }

    async _requestJson(url, { accessToken, signal } = {}) {
        const controller = new AbortController();
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeoutMs);
        const abort = () => controller.abort();
        if (signal) {
            if (signal.aborted) controller.abort();
            else signal.addEventListener('abort', abort, { once: true });
        }
        try {
            const headers = {};
            if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
            const res = await this.fetch(url, {
                headers,
                signal: controller.signal,
            });
            if (!res.ok) {
                throw new GogApiError('GOG_LIBRARY_REQUEST_FAILED', `GOG library request failed with HTTP ${res.status}`, { status: res.status, retryAfterMs: retryAfterMs(res), transient: isTransientStatus(res.status) });
            }
            const body = await res.json();
            if (!body || typeof body !== 'object') {
                throw new GogApiError('GOG_LIBRARY_INVALID_RESPONSE', 'GOG library response was invalid.');
            }
            return body;
        } catch (err) {
            if (err.name === 'AbortError') {
                if (!timedOut) throw new GogApiError('GOG_REQUEST_CANCELLED', 'GOG request was cancelled.', { transient: false });
                throw new GogApiError('GOG_LIBRARY_TIMEOUT', 'GOG library request timed out.', { transient: true, networkCode: 'ETIMEDOUT' });
            }
            if (err instanceof GogApiError) throw err;
            const networkCode = String(err?.code || err?.cause?.code || 'NETWORK_ERROR');
            const transient = ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET'].includes(networkCode);
            throw new GogApiError('GOG_LIBRARY_NETWORK_ERROR', err?.message || 'GOG library request failed.', { transient, networkCode });
        } finally {
            clearTimeout(timer);
            if (signal) signal.removeEventListener('abort', abort);
        }
    }

    _extractItems(body) {
        const items = body.items || body.releases || body.products || body._embedded?.items || body._embedded?.releases;
        if (!Array.isArray(items)) {
            throw new GogApiError('GOG_LIBRARY_INVALID_RESPONSE', 'GOG library response did not include a releases array.');
        }
        return items;
    }

    async fetchUserProfile({ accessToken, signal = null } = {}) {
        return this.fetchUserDetails({ userId: arguments[0]?.userId, accessToken, signal });
    }

    async fetchUserDetails({ userId, accessToken, signal = null } = {}) {
        if (!userId || !accessToken) {
            throw new GogApiError('GOG_AUTH_EXPIRED', 'GOG credentials are missing or expired.');
        }
        return this._requestJson(new URL(`https://users.gog.com/users/${encodeURIComponent(String(userId))}`), {
            accessToken,
            signal,
        });
    }

    async fetchGamesDbData({ platform = 'gog', externalId, certificate = null, accessToken = null, signal = null } = {}) {
        if (!externalId) {
            throw new GogApiError('GOG_GAME_DETAILS_INVALID', 'GOG game id is missing.');
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        const abort = () => controller.abort();
        if (signal) {
            if (signal.aborted) controller.abort();
            else signal.addEventListener('abort', abort, { once: true });
        }
        try {
            const headers = {};
            if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
            if (certificate) headers['X-GOG-Library-Cert'] = certificate;
            const res = await this.fetch(
                new URL(`https://gamesdb.gog.com/platforms/${encodeURIComponent(String(platform))}/external_releases/${encodeURIComponent(String(externalId))}`),
                { headers, signal: controller.signal }
            );
            if (!res.ok) {
                throw new GogApiError('GOG_GAME_DETAILS_REQUEST_FAILED', `GOG game details request failed with HTTP ${res.status}`, { status: res.status });
            }
            const body = await res.json();
            if (!body || typeof body !== 'object') {
                throw new GogApiError('GOG_GAME_DETAILS_INVALID', 'GOG game details response was invalid.');
            }
            return body;
        } catch (err) {
            if (err.name === 'AbortError') {
                throw new GogApiError('GOG_GAME_DETAILS_REQUEST_FAILED', 'GOG game details request timed out or was cancelled.');
            }
            if (err instanceof GogApiError) throw err;
            throw new GogApiError('GOG_GAME_DETAILS_REQUEST_FAILED', err?.message || 'GOG game details request failed.');
        } finally {
            clearTimeout(timer);
            if (signal) signal.removeEventListener('abort', abort);
        }
    }

    async fetchStoreProductData({ productId, accessToken = null, signal = null } = {}) {
        if (!productId) {
            throw new GogApiError('GOG_STORE_PRODUCT_INVALID', 'GOG product id is missing.');
        }
        const url = new URL(`https://api.gog.com/products/${encodeURIComponent(String(productId))}`);
        url.searchParams.set('expand', 'description,screenshots,videos,requirements,ratings');
        return this._requestJson(url, { accessToken, signal });
    }

    async searchStoreCatalog({ query, limit = 20, signal = null } = {}) {
        if (!query) {
            throw new GogApiError('GOG_CATALOG_SEARCH_INVALID', 'GOG catalog search query is missing.');
        }
        const url = new URL('https://catalog.gog.com/v1/catalog');
        url.searchParams.set('limit', String(limit));
        url.searchParams.set('query', String(query));
        return this._requestJson(url, { accessToken: null, signal });
    }

    async fetchStorePageData({ url, signal = null } = {}) {
        if (!url) {
            throw new GogApiError('GOG_STORE_PAGE_INVALID', 'GOG store page url is missing.');
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        const abort = () => controller.abort();
        if (signal) {
            if (signal.aborted) controller.abort();
            else signal.addEventListener('abort', abort, { once: true });
        }
        try {
            const res = await this.fetch(url, { signal: controller.signal });
            if (!res.ok) {
                throw new GogApiError('GOG_STORE_PAGE_REQUEST_FAILED', `GOG store page request failed with HTTP ${res.status}`, { status: res.status });
            }
            return {
                url: String(url),
                html: await res.text(),
            };
        } catch (err) {
            if (err.name === 'AbortError') {
                throw new GogApiError('GOG_STORE_PAGE_REQUEST_FAILED', 'GOG store page request timed out or was cancelled.');
            }
            if (err instanceof GogApiError) throw err;
            throw new GogApiError('GOG_STORE_PAGE_REQUEST_FAILED', err?.message || 'GOG store page request failed.');
        } finally {
            clearTimeout(timer);
            if (signal) signal.removeEventListener('abort', abort);
        }
    }

    async fetchLibraryReleases({ userId, accessToken, refreshAuth = null, signal = null, stats = null } = {}) {
        if (!userId || !accessToken) {
            throw new GogApiError('GOG_AUTH_EXPIRED', 'GOG credentials are missing or expired.');
        }

        const releases = [];
        let pageToken = null;
        let refreshed = false;

        do {
            const url = new URL(`/users/${encodeURIComponent(String(userId))}/releases`, this.baseUrl);
            if (pageToken) url.searchParams.set('page_token', pageToken);

            let attempt = 0;
            while (true) {
                try {
                    const body = await this._requestJson(url, { accessToken, signal });
                    if (stats) stats.numberOfPages = (stats.numberOfPages || 0) + 1;
                    releases.push(...this._extractItems(body));
                    pageToken = body.next_page_token || body.nextPageToken || null;
                    break;
                } catch (err) {
                    if (err.status === 401 && !refreshed && typeof refreshAuth === 'function') {
                        refreshed = true;
                        const refreshedCredentials = await refreshAuth();
                        accessToken = refreshedCredentials?.accessToken || accessToken;
                        continue;
                    }
                    if (!isTransientGogError(err) || attempt >= this.maxRetries) throw err;
                    attempt += 1;
                    const backoff = Math.min(250 * Math.pow(2, attempt - 1), 1500);
                    const jitter = Math.round(backoff * 0.2 * this.random());
                    await this.sleep(err?.details?.retryAfterMs ?? backoff + jitter);
                }
            }
        } while (pageToken);

        return releases;
    }
}

module.exports = {
    GogApiClient,
    GogApiError,
    isTransientGogError,
    defaultGogFetch,
};
