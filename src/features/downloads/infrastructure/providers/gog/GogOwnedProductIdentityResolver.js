'use strict';

const fs = require('fs').promises;
const path = require('path');
const { makeDownloadError } = require('../../services/DownloadPreflightService');
const { GogIdentityMapRepository } = require('./GogIdentityMapRepository');

const SECRET_RE = /(access[_-]?token|refresh[_-]?token|authorization|certificate|secure[_-]?link|sig|signature|token)(["'\s:=]+)([^"'\s,}&]+)/gi;

class GogOwnedProductIdentityResolver {
    constructor({
        userDataDir,
        fetchImpl = globalThis.fetch,
        mapRepository = null,
        runtime = null,
        timeoutMs = 15000,
        now = () => new Date().toISOString(),
        debug = () => {},
    } = {}) {
        if (!userDataDir) throw new Error('GogOwnedProductIdentityResolver requires userDataDir');
        if (typeof fetchImpl !== 'function') throw new Error('GogOwnedProductIdentityResolver requires fetch');
        this.userDataDir = userDataDir;
        this.fetch = fetchImpl;
        this.timeoutMs = timeoutMs;
        this.now = now;
        this.debug = debug;
        this.runtime = runtime;
        this.mapRepository = mapRepository || new GogIdentityMapRepository({ userDataDir });
    }

    getAuthPath(accountId) {
        return path.join(this.userDataDir, 'gog', 'accounts', String(accountId), 'auth.json');
    }

    async resolveForQueue(payload = {}) {
        const accountId = stringOrNull(payload.accountId);
        if (!accountId) throw makeDownloadError('GOG_ACCOUNT_NOT_FOUND', 'Choose a linked GOG account.');

        const title = stringOrNull(payload.title);
        const identity = normalizeInputIdentity(payload);
        const mappingKey = buildOwnedMappingKey({ accountId, identity, payload });
        let auth = await this.readAuth(accountId);
        const cached = await this.mapRepository.get(mappingKey);
        if (cached && isCacheReusable(cached, { accountId, title, identity })) {
            const validated = await this.validateCandidateWithRefresh({
                candidate: {
                    productId: cached.contentSystemProductId || cached.gogdlAppName,
                    source: cached.source || 'verified-cache',
                    provenance: 'verified-cache',
                },
                auth,
                title,
            }).catch(async (err) => {
                await this.mapRepository.remove(mappingKey);
                throw err;
            });
            return this.decoratePayload(payload, { ...cached, ...validated.mapping, source: cached.source || 'verified-cache' });
        }

        const diagnostics = {
            title,
            localGameId: stringOrNull(payload.gameId),
            previousGenericProductId: stringOrNull(payload.providerProductId || payload.providerAppName),
            rawOwnedEntryFieldNames: Object.keys(payload.rawLibraryIdentity || payload.gogIdentity || {}).sort(),
            galaxyLibraryEntryId: identity.galaxyLibraryEntryId,
            galaxyExternalId: identity.galaxyExternalId,
            gamesDbReleaseId: identity.gamesDbReleaseId,
            gamesDbExternalId: identity.gamesDbExternalId,
            catalogCandidateIds: [],
            rejectedCandidateReasons: [],
        };

        const candidates = [];
        addCandidate(candidates, identity.contentSystemProductId, 'normalized-content-system-id', 'owned-metadata');
        addCandidate(candidates, identity.gogdlAppName, 'normalized-gogdl-app-name', 'owned-metadata');
        addCandidate(candidates, identity.gogProductId, 'normalized-gog-product-id', 'owned-metadata');
        addCandidate(candidates, identity.gamesDbExternalId, 'gamesdb-external-id', 'authenticated-gamesdb');
        addCandidate(candidates, identity.galaxyExternalId, 'galaxy-external-id', 'authenticated-library');

        if (title) {
            const catalog = await this.searchCatalog(title).catch((err) => {
                diagnostics.rejectedCandidateReasons.push({
                    source: 'catalog-search',
                    reason: err.code || 'GOG_CATALOG_SEARCH_FAILED',
                });
                return [];
            });
            diagnostics.catalogCandidateIds = catalog.map(item => item.id).filter(Boolean);
            for (const item of catalog) {
                addCandidate(candidates, item.id, 'catalog-search', 'catalog-discovery', { slug: item.slug, title: item.title });
            }
        }

        const valid = [];
        let invalidLicenceSeen = false;
        for (const candidate of candidates) {
            try {
                const result = await this.validateCandidateWithRefresh({ candidate, auth, title });
                auth = result.auth || auth;
                valid.push({
                    ...result.mapping,
                    accountId,
                    galaxyLibraryEntryId: identity.galaxyLibraryEntryId,
                    galaxyExternalId: identity.galaxyExternalId,
                    title: result.mapping.title || title,
                    slug: result.mapping.slug || candidate.slug || identity.storeSlug,
                    source: candidate.source,
                    confidence: candidate.provenance === 'catalog-discovery' ? 'catalog-verified-licence' : 'owned-metadata-verified',
                    resolvedAt: this.now(),
                });
            } catch (err) {
                if (err.code === 'GOG_INVALID_LICENCE' || err.code === 'GOG_PRODUCT_NOT_OWNED') invalidLicenceSeen = true;
                diagnostics.rejectedCandidateReasons.push({
                    candidateId: candidate.productId,
                    source: candidate.source,
                    code: err.code || 'GOG_CANDIDATE_REJECTED',
                    message: safeDiagnosticMessage(err.message),
                });
            }
        }

        this.logDiagnostic({
            ...diagnostics,
            finalGogProductId: valid[0]?.contentSystemProductId || null,
            finalGogdlAppName: valid[0]?.gogdlAppName || null,
            identitySource: valid[0]?.source || null,
            verifiedBuildCount: valid[0]?.verifiedBuildCount || 0,
            ownershipVerified: valid[0]?.ownershipVerified || false,
            secureLinkStatus: valid[0]?.secureLinkStatus || null,
        });

        if (valid.length > 1) {
            throw makeDownloadError('GOG_OWNED_IDENTITY_AMBIGUOUS', 'Baddel found more than one licensed GOG download identity for this game.');
        }
        if (valid.length === 0) {
            if (invalidLicenceSeen) {
                throw makeDownloadError(
                    'GOG_INVALID_LICENCE',
                    'Baddel found this GOG game, but could not verify a downloadable licence for the connected account. Refresh or reconnect the GOG account and try again.'
                );
            }
            throw makeDownloadError('GOG_OWNED_IDENTITY_UNRESOLVED', 'Baddel could not resolve a verified GOG download identity for this game.');
        }

        const mapping = await this.mapRepository.set(mappingKey, valid[0]);
        return this.decoratePayload(payload, mapping);
    }

    async readAuth(accountId) {
        const authPath = this.getAuthPath(accountId);
        let authJson;
        try {
            authJson = JSON.parse(await fs.readFile(authPath, 'utf8'));
        } catch {
            throw makeDownloadError('GOG_AUTH_REQUIRED', 'GOG authentication expired. Relink the GOG account and retry.');
        }
        const accessToken = findAuthValue(authJson, ['access_token', 'accessToken']);
        if (!accessToken) {
            throw makeDownloadError('GOG_AUTH_REQUIRED', 'GOG authentication expired. Relink the GOG account and retry.');
        }
        return { accountId: String(accountId), authPath, accessToken };
    }

    async refreshAuth(auth) {
        if (!this.runtime || typeof this.runtime.run !== 'function') {
            throw makeDownloadError('GOG_AUTH_REQUIRED', 'GOG authentication expired. Relink the GOG account and retry.');
        }
        await this.runtime.run(['--auth-config-path', auth.authPath, 'auth'], {
            timeoutMs: 45000,
            redactOutput: true,
        });
        return this.readAuth(auth.accountId);
    }

    async searchCatalog(title) {
        const url = new URL('https://catalog.gog.com/v1/catalog');
        url.searchParams.set('limit', '20');
        url.searchParams.set('query', title);
        const body = await this.requestJson(url);
        const products = Array.isArray(body.products) ? body.products : (Array.isArray(body.items) ? body.items : []);
        const wanted = normalizeTitle(title);
        return products
            .map(product => ({
                id: normalizeNumericId(product?.id),
                title: localized(product?.title) || stringOrNull(product?.title),
                slug: stringOrNull(product?.slug),
            }))
            .filter(product => product.id && normalizeTitle(product.title) === wanted);
    }

    async validateCandidate({ candidate, auth, title }) {
        const productId = normalizeNumericId(candidate?.productId);
        if (!productId) throw makeDownloadError('GOG_INVALID_PRODUCT_ID', 'Baddel could not identify this game on GOG. Sync the GOG library again.');
        const builds = await this.fetchWindowsBuilds(productId, 2, auth);
        let generation = 2;
        let selectedBuilds = builds.items;
        if (selectedBuilds.length === 0) {
            const gen1 = await this.fetchWindowsBuilds(productId, 1, auth);
            generation = gen1.items.length > 0 ? 1 : 2;
            selectedBuilds = gen1.items.length > 0 ? gen1.items : [];
        }
        if (selectedBuilds.length === 0) {
            throw makeDownloadError('GOG_WINDOWS_BUILD_NOT_AVAILABLE', 'No downloadable Windows build was found for this GOG game.');
        }
        const matchingBuilds = selectedBuilds.filter(build => {
            const buildProductId = normalizeNumericId(build?.product_id || build?.productId || build?.product?.id || productId);
            return !buildProductId || buildProductId === productId;
        });
        if (matchingBuilds.length === 0) {
            throw makeDownloadError('GOG_WINDOWS_BUILD_NOT_AVAILABLE', 'No downloadable Windows build was found for this GOG game.');
        }
        const build = matchingBuilds[0] || selectedBuilds[0];
        await this.verifySecureLink(productId, generation, auth);
        return {
            gogProductId: productId,
            contentSystemProductId: productId,
            gogdlAppName: productId,
            title: title || candidate.title || null,
            slug: candidate.slug || null,
            verifiedBuildId: stringOrNull(build?.build_id || build?.buildId || build?.id),
            verifiedBuildGeneration: generation,
            verifiedBuildCount: matchingBuilds.length,
            ownershipVerified: true,
            secureLinkVerified: true,
            secureLinkStatus: 200,
        };
    }

    async validateCandidateWithRefresh({ candidate, auth, title }) {
        try {
            return { mapping: await this.validateCandidate({ candidate, auth, title }), auth };
        } catch (err) {
            if (!isAuthRejected(err)) throw err;
            const refreshedAuth = await this.refreshAuth(auth);
            return {
                mapping: await this.validateCandidate({ candidate, auth: refreshedAuth, title }),
                auth: refreshedAuth,
            };
        }
    }

    async fetchWindowsBuilds(productId, generation, auth) {
        const url = new URL(`https://content-system.gog.com/products/${encodeURIComponent(productId)}/os/windows/builds`);
        url.searchParams.set('generation', String(generation));
        url.searchParams.set('_version', '2');
        const body = await this.requestJson(url, { accessToken: auth.accessToken });
        const items = Array.isArray(body.items) ? body.items : (Array.isArray(body.builds) ? body.builds : []);
        return { generation, items };
    }

    async verifySecureLink(productId, generation, auth) {
        const url = new URL(`https://content-system.gog.com/products/${encodeURIComponent(productId)}/secure_link`);
        url.searchParams.set('_version', '2');
        url.searchParams.set('generation', String(generation));
        url.searchParams.set('path', '/');
        try {
            await this.requestJson(url, { accessToken: auth.accessToken, timeoutMs: Math.min(this.timeoutMs, 12000), secureLink: true });
        } catch (err) {
            if (err.status === 401) {
                const rejected = makeDownloadError('GOG_SECURE_LINK_REJECTED', 'GOG rejected the download licence check. Reconnect the GOG account and try again.');
                rejected.status = 401;
                throw rejected;
            }
            if (err.status === 403 || /invalid[_ -]?licen[cs]e/i.test(err.message || '')) {
                throw makeDownloadError(
                    'GOG_INVALID_LICENCE',
                    'Baddel found this GOG game, but could not verify a downloadable licence for the connected account. Refresh or reconnect the GOG account and try again.'
                );
            }
            if (err.code === 'GOG_REQUEST_TIMEOUT') {
                throw makeDownloadError('GOG_SECURE_LINK_TIMEOUT', 'GOG licence verification timed out. Check the connection and try again.');
            }
            throw err;
        }
        return true;
    }

    async requestJson(url, { accessToken = null, timeoutMs = this.timeoutMs, secureLink = false } = {}) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const headers = { Accept: 'application/json', 'User-Agent': 'Baddel-GOG-Resolver/1.0' };
            if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
            const res = await this.fetch(url, { headers, signal: controller.signal });
            let body = null;
            try { body = await res.json(); } catch {}
            if (!res.ok) {
                const message = safeDiagnosticMessage(body?.error || body?.code || body?.message || `GOG request failed with HTTP ${res.status}`);
                const err = makeDownloadError(secureLink ? 'GOG_SECURE_LINK_REJECTED' : 'GOG_HTTP_REQUEST_FAILED', message);
                err.status = res.status;
                throw err;
            }
            return body && typeof body === 'object' ? body : {};
        } catch (err) {
            if (err.name === 'AbortError') {
                const timeout = makeDownloadError('GOG_REQUEST_TIMEOUT', 'GOG request timed out.');
                timeout.status = 0;
                throw timeout;
            }
            throw err;
        } finally {
            clearTimeout(timer);
        }
    }

    decoratePayload(payload, mapping) {
        return {
            ...payload,
            providerProductId: mapping.contentSystemProductId,
            providerAppName: mapping.gogdlAppName,
            gogProductId: mapping.gogProductId,
            contentSystemProductId: mapping.contentSystemProductId,
            gogdlAppName: mapping.gogdlAppName,
            identitySource: mapping.source,
            ownershipVerified: mapping.ownershipVerified === true,
            secureLinkVerified: mapping.secureLinkVerified === true,
            verifiedBuildId: mapping.verifiedBuildId,
            verifiedBuildGeneration: mapping.verifiedBuildGeneration,
            verifiedBuildCount: mapping.verifiedBuildCount,
            supportPath: payload.supportPath || path.join(String(payload.installPath || payload.installRoot || ''), '.baddel-gog-support'),
            language: payload.language || 'en-US',
        };
    }

    logDiagnostic(payload) {
        if (process.env.BADDEL_GOG_DOWNLOAD_DEBUG !== '1') return;
        this.debug('[GOGIdentity]', redactDiagnostic(payload));
    }
}

function normalizeInputIdentity(payload = {}) {
    const raw = payload.rawLibraryIdentity || payload.gogIdentity || {};
    return {
        localGameId: stringOrNull(raw.localGameId || payload.gameId),
        canonicalGameId: stringOrNull(raw.canonicalGameId || payload.canonicalGameId),
        galaxyLibraryEntryId: stringOrNull(raw.galaxyLibraryEntryId),
        galaxyExternalId: normalizeNumericId(raw.galaxyExternalId),
        galaxyCertificatePresent: raw.galaxyCertificatePresent === true,
        gamesDbReleaseId: normalizeNumericId(raw.gamesDbReleaseId),
        gamesDbGameId: normalizeNumericId(raw.gamesDbGameId),
        gamesDbExternalId: normalizeNumericId(raw.gamesDbExternalId),
        releasePerPlatformId: stringOrNull(raw.releasePerPlatformId),
        gogProductId: normalizeNumericId(raw.gogProductId),
        contentSystemProductId: normalizeNumericId(raw.contentSystemProductId),
        gogdlAppName: normalizeNumericId(raw.gogdlAppName),
        storeSlug: stringOrNull(raw.storeSlug || payload.storeSlug),
        identitySource: stringOrNull(raw.identitySource),
    };
}

function buildOwnedMappingKey({ accountId, identity, payload }) {
    const ownedKey = identity.galaxyExternalId ||
        identity.gamesDbExternalId ||
        identity.releasePerPlatformId ||
        normalizeTitle(payload.title) ||
        stringOrNull(payload.canonicalGameId || payload.gameId);
    return `${accountId}:${ownedKey || 'unknown'}`;
}

function addCandidate(candidates, value, source, provenance, extra = {}) {
    const productId = normalizeNumericId(value);
    if (!productId || candidates.some(candidate => candidate.productId === productId)) return;
    candidates.push({ productId, source, provenance, ...extra });
}

function isCacheReusable(mapping, { accountId, title }) {
    if (!mapping || mapping.accountId && String(mapping.accountId) !== String(accountId)) return false;
    if (!mapping.ownershipVerified || !mapping.secureLinkVerified) return false;
    if (!normalizeNumericId(mapping.contentSystemProductId || mapping.gogdlAppName)) return false;
    if (title && mapping.title && normalizeTitle(title) !== normalizeTitle(mapping.title)) return false;
    return true;
}

function isAuthRejected(err) {
    return err && err.status === 401;
}

function findAuthValue(input, wantedKeys) {
    const normalizedWanted = new Set(wantedKeys.map(key => String(key).toLowerCase().replace(/[^a-z0-9]/g, '')));
    const stack = [input];
    const seen = new Set();
    while (stack.length) {
        const value = stack.pop();
        if (!value || typeof value !== 'object' || seen.has(value)) continue;
        seen.add(value);
        for (const [key, child] of Object.entries(value)) {
            const normalized = String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
            if (normalizedWanted.has(normalized) && child != null && String(child).trim()) return String(child);
            if (child && typeof child === 'object') stack.push(child);
        }
    }
    return null;
}

function localized(value) {
    if (!value) return null;
    if (typeof value === 'string') return stringOrNull(value);
    return stringOrNull(value['*'] || value['en-US'] || value.en || value.default || value.title || value.name);
}

function normalizeNumericId(value) {
    const normalized = String(value || '').replace(/^gog[-_]/i, '').trim();
    return /^\d+$/.test(normalized) ? normalized : null;
}

function normalizeTitle(value) {
    return String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

function stringOrNull(value) {
    const s = String(value || '').trim();
    return s || null;
}

function safeDiagnosticMessage(value) {
    return String(value || '').replace(SECRET_RE, (_m, key, sep) => `${key}${sep}[REDACTED]`).slice(0, 240);
}

function redactDiagnostic(value) {
    if (Array.isArray(value)) return value.map(redactDiagnostic);
    if (!value || typeof value !== 'object') return value;
    const out = {};
    for (const [key, child] of Object.entries(value)) {
        if (/token|certificate|authorization|secure.*url|signed|signature/i.test(key)) {
            out[key] = '[REDACTED]';
        } else {
            out[key] = redactDiagnostic(child);
        }
    }
    return out;
}

module.exports = {
    GogOwnedProductIdentityResolver,
    normalizeInputIdentity,
    buildOwnedMappingKey,
    normalizeNumericId,
    findAuthValue,
    safeDiagnosticMessage,
};
