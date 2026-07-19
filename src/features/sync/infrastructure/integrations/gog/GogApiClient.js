'use strict';

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

class GogApiClient {
    constructor({
        fetchImpl = globalThis.fetch,
        baseUrl = 'https://galaxy-library.gog.com',
        sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        timeoutMs = 15000,
        maxRetries = 2,
    } = {}) {
        if (typeof fetchImpl !== 'function') {
            throw new TypeError('GogApiClient requires fetch');
        }
        this.fetch = fetchImpl;
        this.baseUrl = baseUrl;
        this.sleep = sleep;
        this.timeoutMs = timeoutMs;
        this.maxRetries = maxRetries;
    }

    async _requestJson(url, { accessToken, signal } = {}) {
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
            const res = await this.fetch(url, {
                headers,
                signal: controller.signal,
            });
            if (!res.ok) {
                throw new GogApiError('GOG_LIBRARY_REQUEST_FAILED', `GOG library request failed with HTTP ${res.status}`, { status: res.status });
            }
            const body = await res.json();
            if (!body || typeof body !== 'object') {
                throw new GogApiError('GOG_LIBRARY_INVALID_RESPONSE', 'GOG library response was invalid.');
            }
            return body;
        } catch (err) {
            if (err.name === 'AbortError') {
                throw new GogApiError('GOG_LIBRARY_REQUEST_FAILED', 'GOG library request timed out or was cancelled.');
            }
            if (err instanceof GogApiError) throw err;
            throw new GogApiError('GOG_LIBRARY_REQUEST_FAILED', err?.message || 'GOG library request failed.');
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

    async fetchLibraryReleases({ userId, accessToken, refreshAuth = null, signal = null } = {}) {
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
                    if (!isTransientStatus(err.status) || attempt >= this.maxRetries) throw err;
                    attempt += 1;
                    await this.sleep(Math.min(250 * Math.pow(2, attempt - 1), 1500));
                }
            }
        } while (pageToken);

        return releases;
    }
}

module.exports = {
    GogApiClient,
    GogApiError,
};
