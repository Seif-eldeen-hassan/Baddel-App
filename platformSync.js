'use strict';

// ============================================================
// BADDEL LAUNCHER ? platformSync.js
// ============================================================

const path        = require('path');
const fs          = require('fs').promises;
const fsSync      = require('fs');
const { spawn } = require('child_process');
const { performance, monitorEventLoopDelay } = require('perf_hooks');
const crypto = require('crypto');
const { getDefaultGogAccountSwitcher } = require('./services/gogAccountSwitcher');
const { app, BrowserWindow, WebContentsView, Notification, session } = require('electron');
const { getGamesFeature } = require('./src/features/games/infrastructure/composition/GamesContainer');
const { GamesSyncAdapter } = require('./src/features/sync/infrastructure/adapters/GamesSyncAdapter');
const {
    EPIC_HISTORY_ERROR_CODES,
    classifyEpicWebResponse,
    collectEpicPurchaseHistoryPages,
    epicHistoryError,
} = require('./src/features/sync/application/services/EpicPurchaseHistoryRefreshService');
const {
    createEpicPurchaseHistoryRefreshService,
} = require('./src/features/sync/infrastructure/composition/createEpicPurchaseHistoryRefreshService');
const {
    EpicHistoryRefreshOperationRegistry,
} = require('./src/features/sync/application/services/EpicHistoryRefreshOperationRegistry');
const {
    orderAccountsForSync,
    countGamesForAccount,
    finalizeLibraryForAccounts,
    removeAccountFromLibrary,
    computeSteamSyncMessage,
    computeTerminalAccountStatus,
    TRANSIENT_SYNC_STATUSES,
    isEpicPlayableGameEntry,
    isEpicSyncedGameAllowed,
    classifyEpicEntry,
    resolveEpicAccountIdentity,
    isEpicFallbackDisplayName,
} = require('./platformSyncShared');
const {
    createFriendlySyncError,
    mergeExistingEpicOwnership,
    mergeOwnedGamesIntoLibrary,
    summarizeEpicEntryForLog,
    summarizeGameTitles,
    steamGameBelongsToAccount,
} = require('./src/features/sync/domain/services/syncLibraryRules');
const {
    canonicalizeEpicLibraryGames,
    epicCanonicalAliases,
} = require('./src/features/sync/domain/services/EpicCanonicalProductIdentity');
const {
    projectEpicVaultAccount,
} = require('./src/features/sync/domain/services/EpicVaultAccountProjection');
const {
    createConnectorRepositoryBundle,
} = require('./src/features/sync/infrastructure/composition/ConnectorRepositoryBundle');
const {
    PollSteamApprovalUseCase,
} = require('./src/features/sync/application/useCases/PollSteamApprovalUseCase');
const {
    createSteamQrPollingLoop,
} = require('./src/features/sync/application/services/SteamQrPollingLoop');
const {
    PlatformSyncAssetWriteBackService,
} = require('./src/features/sync/application/services/PlatformSyncAssetWriteBackService');
const {
    PlatformSyncServerImportService,
} = require('./src/features/sync/application/services/PlatformSyncServerImportService');
const {
    EpicProgressiveSyncCoordinator,
} = require('./src/features/sync/application/services/EpicProgressiveSyncCoordinator');
const {
    EpicVaultHydrationService,
    withDeadline: withEpicVaultDeadline,
} = require('./src/features/sync/application/services/EpicVaultHydrationService');
const {
    EpicPriceEnrichmentService,
    shouldRefreshCachedEpicPrice,
} = require('./src/features/sync/application/services/EpicPriceEnrichmentService');
const {
    EpicPriceRefreshScheduler,
} = require('./src/features/sync/application/services/EpicPriceRefreshScheduler');
const {
    EpicPriceRefreshOperationRegistry,
} = require('./src/features/sync/application/services/EpicPriceRefreshOperationRegistry');
const {
    EpicHistorySessionBootstrapService,
    attemptOptionalEpicHistorySessionBootstrap,
    isCanonicalEpicAccountId,
    isEpicCookie,
} = require('./src/features/sync/application/services/EpicHistorySessionBootstrapService');
const {
    classifyEpicPriceResponse,
} = require('./src/features/sync/application/services/EpicPriceErrorClassifier');
const {
    resolveEpicPriceRetryInput,
} = require('./src/features/sync/application/services/EpicPriceRetryInputResolver');
const {
    AtomicJsonFileStore,
} = require('./src/features/sync/infrastructure/runtime/AtomicJsonFileStore');
const {
    EpicPriceDebugSession,
    endpointSummary,
    errorSummary,
} = require('./src/features/sync/infrastructure/diagnostics/EpicPriceDebugSession');
const {
    SyncLogQueue,
} = require('./src/features/sync/infrastructure/runtime/SyncLogQueue');
const {
    LinkStateEmitter,
} = require('./src/features/sync/infrastructure/runtime/LinkStateEmitter');
const {
    LibraryUpdateEmitter,
} = require('./src/features/sync/infrastructure/runtime/LibraryUpdateEmitter');
const {
    SyncTerminalEventEmitter,
} = require('./src/features/sync/infrastructure/runtime/SyncTerminalEventEmitter');
const {
    StateChangedEmitter,
} = require('./src/features/sync/infrastructure/runtime/StateChangedEmitter');
const {
    createPlatformSyncFeature,
} = require('./src/features/sync/infrastructure/composition/createPlatformSyncFeature');
const {
    createSyncConnectors,
} = require('./src/features/sync/infrastructure/composition/createSyncConnectors');
const {
    GogRuntime,
    redactGogSecrets,
    loadGogRuntimeVersionInfo,
} = require('./src/features/sync/infrastructure/integrations/gog/GogRuntime');
const {
    inspectLegendaryRuntime,
    createLegendaryRuntimeMissingError,
} = require('./src/features/sync/infrastructure/integrations/epic/LegendaryRuntimeResolver');
const {
    GogAuthService,
    resolveGogAuthShellPath,
} = require('./src/features/sync/infrastructure/integrations/gog/GogAuthService');
const {
    GogApiClient,
} = require('./src/features/sync/infrastructure/integrations/gog/GogApiClient');
const {
    normalizeGogRelease,
    mergeGogGames,
} = require('./src/features/sync/infrastructure/integrations/gog/GogLibraryNormalizer');
const {
    hasGoodBasicMetadata: hasGoodGogBasicMetadata,
    classifySyncCandidate: classifyGogSyncCandidate,
    preserveLastKnownGood: preserveGogLastKnownGood,
} = require('./src/features/sync/domain/services/GogSyncPolicy');
const baddelApi = require('./services/baddelApi');
const { redactSecrets } = require('./services/credentialValidator');
const analytics = require('./analytics');

// --- Dev/debug logging gates ---------------------------------
const QUIET_LOGS      = process.env.BADDEL_QUIET_LOGS      === '1';
const STEAM_AUTH_DEBUG = process.env.BADDEL_STEAM_AUTH_DEBUG === '1';
const VERBOSE_LOGS     = process.env.BADDEL_VERBOSE_LOGS     === '1';
const APP_STARTED_AT = new Date().toISOString();

function syncLog(...args)  { if (!QUIET_LOGS) console.log(...args); }
function syncWarn(...args) { if (!QUIET_LOGS) console.warn(...args); }
function verboseLog(...args) { if (VERBOSE_LOGS && !QUIET_LOGS) console.log(...args); }
function syncInfo(...args) { try { verboseLog(...args); } catch {} }
function steamAuthLog(...args) {
    if (STEAM_AUTH_DEBUG || !QUIET_LOGS) console.log(...args);
}
function coverDbgSync(msg, data = {}) {
    try {
        verboseLog('[CoverDebug:Sync]', msg, data);
    } catch {}
}

const steamApprovalPollUseCase = new PollSteamApprovalUseCase();
const gamesSyncAdapter = new GamesSyncAdapter({ getGamesFeature });

// --- Paths ---------------------------------------------------
const {
    syncCacheRepository,
    epicSwitcherRepository,
} = createConnectorRepositoryBundle({
    cacheRepositoryOptions: { userDataDir: app.getPath('userData') },
    epicSwitcherRepositoryOptions: {
        accountsRootDir: path.join(app.getPath('userData'), 'accounts'),
    },
});
const SYNC_CACHE_DIR     = syncCacheRepository.syncCacheDir;
const SYNC_LOGS_DIR      = syncCacheRepository.syncLogsDir;

// Epic Paths
const EPIC_MERGED_CACHE            = syncCacheRepository.epicMergedCacheFile;

const EPIC_SYNC_OPTION_DEFAULTS = {
    games: true,
    currentPrices: false,
    purchaseHistory: false,
};

function normalizeEpicSyncOptions(opts = {}) {
    const raw = opts?.epicSyncOptions || opts || {};
    return {
        games: true,
        currentPrices: raw.currentPrices === true,
        purchaseHistory: raw.purchaseHistory === true,
    };
}

function normalizeEpicCountry(value) {
    const country = String(value || '').trim().toUpperCase();
    return /^[A-Z]{2}$/.test(country) ? country : null;
}

async function readEpicPricingCountryFromLegendary(configPath) {
    try {
        if (!configPath) return null;
        const raw = await fs.readFile(path.join(configPath, 'user.json'), 'utf8');
        const user = JSON.parse(raw);
        return normalizeEpicCountry(user?.country);
    } catch {
        return null;
    }
}

async function readEpicLegendaryUser(configPath) {
    try {
        if (!configPath) return null;
        const raw = await fs.readFile(path.join(configPath, 'user.json'), 'utf8');
        const user = JSON.parse(raw);
        return {
            account_id: user?.account_id || null,
            display_name: user?.display_name || null,
            country: normalizeEpicCountry(user?.country),
        };
    } catch {
        return null;
    }
}

function getEpicPricingCountryForRequest(pricingCountry) {
    return normalizeEpicCountry(pricingCountry);
}

async function epicNetJsonRequest(url, payload, timeoutMs = 9000, options = {}) {
    const startedAt = performance.now();
    const operation = String(options.operationName || payload?.operationName || 'epic_graphql');
    const endpoint = endpointSummary(url);
    await options.debug?.record?.('http_request_started', {
        operation, endpoint, attempt: Number(options.attempt || 0) + 1,
    });
    const controller = new AbortController();
    const abortFromParent = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) abortFromParent();
    else options.signal?.addEventListener?.('abort', abortFromParent, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await session.defaultSession.fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome || '120.0.0.0'} Safari/537.36`,
            },
            body: JSON.stringify(payload),
            credentials: 'include',
            signal: controller.signal,
        });
        const text = await response.text();
        const contentType = String(response.headers?.get?.('content-type') || '');
        const retryAfter = String(response.headers?.get?.('retry-after') || '').trim();
        const retryAfterMs = /^\d+$/.test(retryAfter)
            ? Number(retryAfter) * 1000
            : Math.max(0, Date.parse(retryAfter) - Date.now()) || 0;
        let data = null;
        try { data = JSON.parse(text); } catch {}
        const graphQLErrors = Array.isArray(data?.errors) ? data.errors.map((item) => ({
            code: item?.extensions?.code || null,
            message: String(item?.message || '').slice(0, 300),
        })) : [];
        await options.debug?.record?.('http_request_completed', {
            operation, endpoint, attempt: Number(options.attempt || 0) + 1,
            durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
            httpStatus: response.status, contentType, retryAfterMs,
            hasGraphQLErrors: graphQLErrors.length > 0, graphQLErrors,
            persistedQueryNotFound: graphQLErrors.some((item) => /persistedquerynotfound/i.test(`${item.code} ${item.message}`)),
            hasCatalogOfferSchema: Object.prototype.hasOwnProperty.call(data?.data?.Catalog || {}, 'catalogOffer'),
            hasSearchStoreSchema: Object.prototype.hasOwnProperty.call(data?.data?.Catalog || {}, 'searchStore'),
        });
        return { status: response.status, data, retryAfterMs, contentType };
    } catch (err) {
        if (options.signal?.aborted) {
            const error = options.signal.reason instanceof Error ? options.signal.reason : new Error('Epic request cancelled.');
            if (!error.code) error.code = 'EPIC_SYNC_CANCELLED';
            await options.debug?.record?.('http_request_completed', {
                operation, endpoint, attempt: Number(options.attempt || 0) + 1,
                durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
                classification: 'abort', error: errorSummary(error),
            });
            throw error;
        }
        await options.debug?.record?.('http_request_completed', {
            operation, endpoint, attempt: Number(options.attempt || 0) + 1,
            durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
            httpStatus: null,
            classification: err?.name === 'AbortError' ? 'timeout' : 'network_failure',
            error: errorSummary(err),
        });
        return {
            status: err?.name === 'AbortError' ? 408 : 0,
            error: err?.message, data: null, retryAfterMs: 0,
            timedOut: err?.name === 'AbortError', networkFailure: err?.name !== 'AbortError',
        };
    } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener?.('abort', abortFromParent);
    }
}
function normalizeEpicLookupValue(value) {
    return String(value || '').trim();
}

function normalizeEpicComparableTitle(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function getEpicOfferRefFromEntry(entry = {}) {
    const metadata = entry.metadata || {};
    const assetInfo = Object.values(entry.asset_infos || {})[0] || {};
    return {
        offerId: normalizeEpicLookupValue(entry.offerId || entry.catalogOfferId || metadata.offerId || metadata.catalogOfferId || ''),
        namespace: normalizeEpicLookupValue(metadata.namespace || assetInfo.namespace || entry.namespace || entry.sandboxId || entry.allIds?.epic || ''),
        catalogItemId: normalizeEpicLookupValue(entry.catalogItemId || entry.catalog_item_id || metadata.catalogItemId || metadata.catalog_item_id || metadata.id || ''),
        title: normalizeEpicLookupValue(entry.app_title || entry.title || metadata.title || entry.app_name || entry.name || 'Unknown'),
        appName: normalizeEpicLookupValue(entry.app_name || entry.appName || entry.app || ''),
    };
}

function getEpicPriceIdentityKeys(entry = {}) {
    const ref = getEpicOfferRefFromEntry(entry);
    const keys = [];
    if (ref.namespace && ref.offerId) keys.push(`ns:${ref.namespace}:offer:${ref.offerId}`);
    if (ref.namespace && ref.catalogItemId) keys.push(`ns:${ref.namespace}:catalog:${ref.catalogItemId}`);
    if (ref.appName) keys.push(`app:${ref.appName.toLowerCase()}`);
    if (ref.title) keys.push(`title:${normalizeEpicComparableTitle(ref.title)}`);
    return keys;
}

function verifyEpicOfferMatchesRef(offer = {}, ref = {}) {
    const offerNamespace = normalizeEpicLookupValue(offer.namespace || offer.sandboxId || offer.catalogNs?.mappings?.[0]?.pageSlug || '');
    const offerId = normalizeEpicLookupValue(offer.id || offer.offerId || '');
    const offerTitle = normalizeEpicComparableTitle(offer.title || offer.name);
    const refTitle = normalizeEpicComparableTitle(ref.title);
    if (ref.namespace && offerNamespace && ref.namespace !== offerNamespace) return false;
    if (ref.offerId && offerId && ref.offerId === offerId) return true;
    if (ref.title && offerTitle && refTitle && offerTitle === refTitle) return true;
    if (ref.appName && String(ref.appName).toLowerCase() === String(offer.productSlug || offer.urlSlug || '').toLowerCase()) return true;
    return Boolean(ref.namespace && (ref.catalogItemId || ref.appName) && offerId);
}

function extractEpicOfferCandidates(node, out = []) {
    if (!node || typeof node !== 'object') return out;
    if (Array.isArray(node)) {
        for (const item of node) extractEpicOfferCandidates(item, out);
        return out;
    }
    const hasOfferShape = (node.id || node.offerId) && (node.title || node.name || node.price || node.keyImages);
    if (hasOfferShape) out.push(node);
    for (const value of Object.values(node)) extractEpicOfferCandidates(value, out);
    return out;
}

async function resolveEpicOfferFromCatalogItem(ref, pricingCountry, options = {}) {
    if (!ref.namespace || !ref.catalogItemId) return null;
    const payload = {
        operationName: 'catalogItemOfferResolution',
        query: `query catalogItemOfferResolution($locale: String!, $country: String!, $sandboxId: String!, $keywords: String) { Catalog { searchStore(locale: $locale, country: $country, namespace: $sandboxId, keywords: $keywords) { elements { id namespace title productSlug urlSlug keyImages { type url } price(country: $country) { totalPrice { discountPrice originalPrice currencyCode fmtPrice(locale: $locale) { discountPrice originalPrice } } } } } } }`,
        variables: {
            locale: 'en-US',
            country: getEpicPricingCountryForRequest(pricingCountry),
            sandboxId: ref.namespace,
            keywords: ref.title || ref.appName || ref.catalogItemId,
        },
    };
    const response = await epicNetJsonRequest('https://store.epicgames.com/graphql', payload, Number(options.requestTimeoutMs || process.env.BADDEL_EPIC_PRICE_REQUEST_TIMEOUT_MS || 9000), options);
    const failure = classifyEpicPriceResponse(response);
    if (failure) return { status: failure.reason === 'rate_limited' ? 'rate_limited' : 'failed', ...failure };
    if (!Object.prototype.hasOwnProperty.call(response.data?.data?.Catalog || {}, 'searchStore')) {
        return { status: 'failed', code: 'EPIC_PRICE_RESPONSE_SCHEMA_CHANGED', failedStage: 'offer_resolution', reason: 'response_schema_changed', retryable: false };
    }
    const offers = extractEpicOfferCandidates(response.data?.data || response.data)
        .filter((offer) => verifyEpicOfferMatchesRef(offer, ref));
    const exactTitle = normalizeEpicComparableTitle(ref.title);
    const offer = offers.find((candidate) => normalizeEpicComparableTitle(candidate.title || candidate.name) === exactTitle) || offers[0] || null;
    if (!offer) return null;
    return { offerId: normalizeEpicLookupValue(offer.id || offer.offerId), offer };
}

async function resolveEpicOfferFromVerifiedFallback(ref, pricingCountry, options = {}) {
    if (!ref.namespace || (!ref.appName && !ref.title)) return null;
    const payload = {
        operationName: 'verifiedOfferFallbackResolution',
        query: `query verifiedOfferFallbackResolution($locale: String!, $country: String!, $sandboxId: String!, $keywords: String) { Catalog { searchStore(locale: $locale, country: $country, namespace: $sandboxId, keywords: $keywords) { elements { id namespace title productSlug urlSlug keyImages { type url } price(country: $country) { totalPrice { discountPrice originalPrice currencyCode fmtPrice(locale: $locale) { discountPrice originalPrice } } } } } } }`,
        variables: {
            locale: 'en-US',
            country: getEpicPricingCountryForRequest(pricingCountry),
            sandboxId: ref.namespace,
            keywords: ref.appName || ref.title,
        },
    };
    const response = await epicNetJsonRequest('https://store.epicgames.com/graphql', payload, Number(options.requestTimeoutMs || process.env.BADDEL_EPIC_PRICE_REQUEST_TIMEOUT_MS || 9000), options);
    const failure = classifyEpicPriceResponse(response);
    if (failure) return { status: failure.reason === 'rate_limited' ? 'rate_limited' : 'failed', ...failure };
    if (!Object.prototype.hasOwnProperty.call(response.data?.data?.Catalog || {}, 'searchStore')) {
        return { status: 'failed', code: 'EPIC_PRICE_RESPONSE_SCHEMA_CHANGED', failedStage: 'offer_resolution', reason: 'response_schema_changed', retryable: false };
    }
    const refTitle = normalizeEpicComparableTitle(ref.title);
    const refApp = String(ref.appName || '').toLowerCase();
    const offers = extractEpicOfferCandidates(response.data?.data || response.data).filter((offer) => {
        if (!verifyEpicOfferMatchesRef(offer, ref)) return false;
        const title = normalizeEpicComparableTitle(offer.title || offer.name);
        const slug = String(offer.productSlug || offer.urlSlug || '').toLowerCase();
        return (refTitle && title === refTitle) || (refApp && slug === refApp);
    });
    const offer = offers[0] || null;
    if (!offer) return null;
    const source = refApp && String(offer.productSlug || offer.urlSlug || '').toLowerCase() === refApp ? 'app_name' : 'title_verified';
    return { offerId: normalizeEpicLookupValue(offer.id || offer.offerId), offer, source };
}
function buildEpicUnresolvedPriceRecord(ref, priceStatus = 'unresolved', reason = 'unresolved', details = {}) {
    const checkedAt = new Date().toISOString();
    const isFinalUnavailable = priceStatus === 'unavailable' || priceStatus === 'not_for_sale';
    return {
        offerId: ref.offerId || null,
        namespace: ref.namespace || null,
        catalogItemId: ref.catalogItemId || null,
        appName: ref.appName || null,
        title: ref.title || 'Unknown',
        amount: null,
        originalAmount: null,
        formatted: null,
        originalFormatted: null,
        currency: null,
        isDiscounted: false,
        discountPercent: 0,
        priceResolved: isFinalUnavailable,
        priceStatus,
        resolutionSource: reason,
        errorCode: details.code || null,
        failedStage: details.failedStage || null,
        retryAfterMs: Number(details.retryAfterMs || 0),
        resolvedAt: checkedAt,
        checkedAt: isFinalUnavailable ? checkedAt : null,
    };
}

async function fetchEpicCatalogOffer(ref, pricingCountry, resolutionSource = 'offer_id', options = {}) {
    const payload = {
        operationName: 'getCatalogOffer',
        variables: { locale: 'en-US', country: getEpicPricingCountryForRequest(pricingCountry), offerId: ref.offerId, sandboxId: ref.namespace },
        extensions: { persistedQuery: { version: 1, sha256Hash: 'ec112951b1824e1e215daecae17db4069c737295d4a697ddb9832923f93a326e' } },
    };
    const response = await epicNetJsonRequest('https://store.epicgames.com/graphql', payload, Number(options.requestTimeoutMs || process.env.BADDEL_EPIC_PRICE_REQUEST_TIMEOUT_MS || 9000), options);
    const failure = classifyEpicPriceResponse(response);
    if (failure) return { retryable: failure.retryable, price: buildEpicUnresolvedPriceRecord(ref, 'unresolved', failure.reason, failure) };
    const catalog = response.data?.data?.Catalog;
    if (!Object.prototype.hasOwnProperty.call(catalog || {}, 'catalogOffer')) {
        const schema = { code: 'EPIC_PRICE_RESPONSE_SCHEMA_CHANGED', failedStage: 'catalog_offer_parse' };
        return { retryable: false, price: buildEpicUnresolvedPriceRecord(ref, 'unresolved', 'response_schema_changed', schema) };
    }
    const offer = catalog.catalogOffer;
    if (!offer) return { retryable: false, price: buildEpicUnresolvedPriceRecord(ref, 'unavailable', 'catalog_missing') };
    const price = offer?.price?.totalPrice;
    if (!price) {
        return {
            retryable: false,
            price: {
                ...buildEpicUnresolvedPriceRecord(ref, 'not_for_sale', 'identified_no_purchasable_offer'),
                title: offer.title || ref.title,
                image: _pickEpicCover(offer.keyImages) || _pickEpicHero(offer.keyImages) || null,
                priceResolved: true,
            },
        };
    }
    const current = Number(price.discountPrice || 0);
    const original = Number(price.originalPrice || 0);
    return {
        retryable: false,
        price: {
            offerId: ref.offerId,
            namespace: ref.namespace,
            catalogItemId: ref.catalogItemId || null,
            appName: ref.appName || null,
            title: offer.title || ref.title,
            image: _pickEpicCover(offer.keyImages) || _pickEpicHero(offer.keyImages) || null,
            amount: current,
            originalAmount: original,
            formatted: price.fmtPrice?.discountPrice || (current === 0 ? 'Free' : ''),
            originalFormatted: price.fmtPrice?.originalPrice || null,
            currency: price.currencyCode || null,
            isDiscounted: original > current,
            discountPercent: original > current ? Math.round(((original - current) / original) * 100) : 0,
            priceResolved: true,
            priceStatus: current === 0 ? 'free' : 'priced',
            resolutionSource,
            resolvedAt: new Date().toISOString(),
        },
    };
}

async function fetchEpicLivePriceForEntry(entry, pricingCountry, options = {}) {
    const originalRef = getEpicOfferRefFromEntry(entry);
    const finish = async (price) => {
        await options.debug?.record?.('offer_resolution_completed', {
            attempt: Number(options.attempt || 0) + 1,
            identity: {
                hasNamespace: Boolean(originalRef.namespace), hasOfferId: Boolean(originalRef.offerId),
                hasCatalogItemId: Boolean(originalRef.catalogItemId), hasAppName: Boolean(originalRef.appName),
                hasTitle: Boolean(originalRef.title),
            },
            resolutionSource: price?.resolutionSource || null,
            priceStatus: price?.priceStatus || 'unresolved',
        });
        return price;
    };
    if (!originalRef.namespace || (!originalRef.offerId && !originalRef.catalogItemId && !originalRef.appName && !originalRef.title)) {
        return finish(buildEpicUnresolvedPriceRecord(originalRef, 'unresolved', 'missing_identity'));
    }

    let ref = { ...originalRef };
    let resolutionSource = ref.offerId ? 'offer_id' : null;
    let successfulLookupMiss = false;
    if (!ref.offerId && ref.namespace && ref.catalogItemId) {
        const resolved = await resolveEpicOfferFromCatalogItem(ref, pricingCountry, options);
        if (resolved?.status === 'rate_limited') return finish(buildEpicUnresolvedPriceRecord(ref, 'unresolved', 'rate_limited', resolved));
        if (resolved?.status === 'failed') return finish(buildEpicUnresolvedPriceRecord(ref, 'unresolved', resolved.reason || 'api_failure', resolved));
        if (resolved?.offerId) {
            ref = { ...ref, offerId: resolved.offerId };
            resolutionSource = 'catalog_item';
        } else if (resolved === null) {
            successfulLookupMiss = true;
        }
    }

    if (!ref.offerId && ref.namespace && (ref.appName || ref.title)) {
        const resolved = await resolveEpicOfferFromVerifiedFallback(ref, pricingCountry, options);
        if (resolved?.status === 'rate_limited') return finish(buildEpicUnresolvedPriceRecord(ref, 'unresolved', 'rate_limited', resolved));
        if (resolved?.status === 'failed') return finish(buildEpicUnresolvedPriceRecord(ref, 'unresolved', resolved.reason || 'api_failure', resolved));
        if (resolved?.offerId) {
            ref = { ...ref, offerId: resolved.offerId };
            resolutionSource = resolved.source || 'title_verified';
        } else if (resolved === null) {
            successfulLookupMiss = true;
        }
    }

    if (!ref.offerId || !ref.namespace) {
        return finish(buildEpicUnresolvedPriceRecord(
            ref,
            successfulLookupMiss ? 'unavailable' : 'unresolved',
            successfulLookupMiss ? 'catalog_missing' : 'no_verified_offer_id'
        ));
    }
    const result = await fetchEpicCatalogOffer(ref, pricingCountry, resolutionSource || 'offer_id', options);
    return finish(result.price);
}

function selectEpicPriceDebugProbe(entries = [], limit = 12) {
    const groups = [
        (ref) => ref.namespace && ref.offerId,
        (ref) => ref.namespace && !ref.offerId && ref.catalogItemId,
        (ref) => ref.namespace && !ref.offerId && !ref.catalogItemId && (ref.appName || ref.title),
        (ref) => !ref.namespace || (!ref.offerId && !ref.catalogItemId && !ref.appName && !ref.title),
    ];
    const selected = [];
    const seen = new Set();
    const add = (entry) => {
        if (!entry || seen.has(entry) || selected.length >= limit) return;
        seen.add(entry);
        selected.push(entry);
    };
    for (const matches of groups) add(entries.find((entry) => matches(getEpicOfferRefFromEntry(entry))));
    for (const entry of entries) add(entry);
    return selected;
}
async function fetchEpicLivePricesForEntries(entries = [], pricingCountry, onProgress = null) {
    const diagnostics = {
        totalOwnedGames: entries.length,
        resolvedByOfferId: 0,
        resolvedByCatalogItemId: 0,
        resolvedByVerifiedFallback: 0,
        free: 0,
        priced: 0,
        notForSale: 0,
        unavailable: 0,
        unresolved: 0,
        apiFailures: 0,
        rateLimits: 0,
        pricingCountry: getEpicPricingCountryForRequest(pricingCountry),
    };
    let processed = 0;
    const results = await mapWithConcurrency(entries, 6, async (entry) => {
        try {
            const price = await fetchEpicLivePriceForEntry(entry, pricingCountry);
            const status = price?.priceStatus || 'unresolved';
            if (price?.resolutionSource === 'offer_id' && (status === 'priced' || status === 'free')) diagnostics.resolvedByOfferId += 1;
            else if (price?.resolutionSource === 'catalog_item' && (status === 'priced' || status === 'free')) diagnostics.resolvedByCatalogItemId += 1;
            else if (status === 'priced' || status === 'free') diagnostics.resolvedByVerifiedFallback += 1;
            if (status === 'free') diagnostics.free += 1;
            else if (status === 'priced') diagnostics.priced += 1;
            else if (status === 'not_for_sale') diagnostics.notForSale += 1;
            else if (status === 'unavailable') diagnostics.unavailable = Number(diagnostics.unavailable || 0) + 1;
            else diagnostics.unresolved += 1;
            if (price?.resolutionSource === 'rate_limited') diagnostics.rateLimits += 1;
            if (price?.resolutionSource === 'api_failure') diagnostics.apiFailures += 1;
            return price;
        } catch (err) {
            diagnostics.unresolved += 1;
            diagnostics.apiFailures += 1;
            const ref = getEpicOfferRefFromEntry(entry);
            return buildEpicUnresolvedPriceRecord(ref, 'unresolved', 'exception');
        } finally {
            processed += 1;
            try { await onProgress?.({ processed, total: entries.length }); } catch (_) {}
        }
    });
    results.diagnostics = diagnostics;
    return results;
}

function buildEpicPriceCandidates(libraryGames = []) {
    const { games } = canonicalizeEpicLibraryGames(libraryGames);
    return games.map((entry) => {
        const ref = getEpicOfferRefFromEntry(entry);
        return {
            ...entry,
            offerId: ref.offerId || null,
            namespace: ref.namespace || null,
            catalogItemId: ref.catalogItemId || null,
            appName: ref.appName || null,
            title: ref.title,
            priceSource: 'canonical_library',
            canonicalAliases: epicCanonicalAliases(entry),
        };
    });
}

function mergeEpicLivePrices(existingPrices = [], fetchedPrices = []) {
    const merged = [];
    const indexByKey = new Map();
    const addKeys = (price, index) => {
        for (const key of getEpicPriceIdentityKeys(price)) {
            if (!indexByKey.has(key)) indexByKey.set(key, index);
        }
    };
    for (const price of Array.isArray(existingPrices) ? existingPrices : []) {
        if (!price) continue;
        const copy = { ...price };
        merged.push(copy);
        addKeys(copy, merged.length - 1);
    }
    let freshResolved = 0;
    let preservedFromPreviousCache = 0;
    for (const price of Array.isArray(fetchedPrices) ? fetchedPrices : []) {
        if (!price) continue;
        const keys = getEpicPriceIdentityKeys(price);
        const hit = keys.map((key) => indexByKey.get(key)).find((idx) => Number.isInteger(idx));
        const status = price.priceStatus || 'unresolved';
        const canReplace = status === 'priced' || status === 'free' || status === 'not_for_sale' || status === 'unavailable';
        if (Number.isInteger(hit)) {
            if (canReplace) {
                merged[hit] = { ...merged[hit], ...price, resolvedAt: price.resolvedAt || new Date().toISOString() };
                freshResolved += 1;
            } else {
                preservedFromPreviousCache += 1;
            }
            addKeys(merged[hit], hit);
        } else {
            merged.push({ ...price, resolvedAt: price.resolvedAt || new Date().toISOString() });
            addKeys(price, merged.length - 1);
            if (canReplace) freshResolved += 1;
        }
    }
    merged.diagnostics = {
        ...(fetchedPrices.diagnostics || {}),
        freshResolved,
        preservedFromPreviousCache,
        totalCachedPrices: merged.length,
    };
    return merged;
}

function isUsableEpicArtworkUrl(url) {
    return /^https?:\/\//i.test(String(url || '').trim()) || /^(file:|app:|baddel-cache:|\.\.?\/|[a-z]:\\)/i.test(String(url || '').trim());
}

function normalizeEpicCoverCandidates(candidates = []) {
    const out = [];
    const push = (url, source) => {
        const value = String(url || '').trim();
        if (!isUsableEpicArtworkUrl(value) || out.some((item) => item.url === value)) return;
        out.push({ url: value, source: source || 'unknown' });
    };
    for (const candidate of Array.isArray(candidates) ? candidates : []) {
        if (typeof candidate === 'string') push(candidate, 'cached');
        else push(candidate?.url, candidate?.source || 'cached');
    }
    return out;
}

function epicArtworkFromOffer(offer = {}, source = 'epic_catalog') {
    const cover = _pickEpicCover(offer.keyImages);
    const hero = _pickEpicHero(offer.keyImages);
    const candidates = normalizeEpicCoverCandidates([
        cover ? { url: cover, source } : null,
        hero ? { url: hero, source: `${source}_hero` } : null,
    ].filter(Boolean));
    if (!candidates.length) return null;
    return { coverUrl: candidates[0].url, coverCandidates: candidates, artworkSource: source };
}

function epicArtworkFromPriceRecord(price = {}, source = 'epic_catalog') {
    const candidates = normalizeEpicCoverCandidates([
        price.image ? { url: price.image, source } : null,
        price.coverUrl ? { url: price.coverUrl, source: `${source}_cover` } : null,
    ].filter(Boolean));
    if (!candidates.length) return null;
    return { coverUrl: candidates[0].url, coverCandidates: candidates, artworkSource: source };
}


function shouldTraceEpicPurchaseArtwork(item = {}) {
    if (process.env.BADDEL_EPIC_PURCHASE_ARTWORK_DEBUG === '1') return true;
    return false;
}

function epicKeyImageTypes(offer = {}) {
    return Array.from(new Set((Array.isArray(offer?.keyImages) ? offer.keyImages : [])
        .map((image) => image?.type)
        .filter(Boolean)));
}

function traceEpicPurchaseArtwork(stage, item = {}, details = {}) {
    if (!shouldTraceEpicPurchaseArtwork(item)) return;
    const payload = {
        stage,
        title: item.title || item.name || item.description || null,
        namespace: item.namespace || item.sandboxId || null,
        offerId: item.offerId || item.catalogOfferId || null,
        catalogItemId: item.catalogItemId || item.catalog_item_id || null,
        appName: item.appName || item.app_name || null,
        existingCoverUrl: item.coverUrl || null,
        existingCoverCandidates: Array.isArray(item.coverCandidates) ? item.coverCandidates.length : 0,
        existingArtworkSource: item.artworkSource || null,
        ...details,
    };
    _pushPlatformSyncLog('epic', 'info', '[Epic Purchase Artwork]', payload);
}

function epicPurchaseArtworkCacheKeys(item = {}) {
    const ref = getEpicOfferRefFromEntry(item);
    return [
        item.stableOrderId ? `stable:${item.stableOrderId}` : null,
        item.orderId ? `order:${item.orderId}` : null,
        ref.namespace && ref.offerId ? `ns:${ref.namespace}:offer:${ref.offerId}` : null,
        ref.namespace && ref.catalogItemId ? `ns:${ref.namespace}:catalog:${ref.catalogItemId}` : null,
        ref.offerId ? `offer:${ref.offerId}` : null,
        ref.catalogItemId ? `catalog:${ref.catalogItemId}` : null,
    ].filter(Boolean);
}

function getEpicPurchaseOwnArtwork(item = {}, source = null) {
    const candidates = normalizeEpicCoverCandidates(item.coverCandidates);
    if (isUsableEpicArtworkUrl(item.coverUrl)) candidates.unshift({ url: String(item.coverUrl).trim(), source: source || item.artworkSource || 'cached_purchase' });
    const deduped = normalizeEpicCoverCandidates(candidates);
    if (!deduped.length) return null;
    return { coverUrl: deduped[0].url, coverCandidates: deduped, artworkSource: source || item.artworkSource || 'cached_purchase' };
}

function buildEpicPurchaseArtworkCache(existingVault = {}) {
    const map = new Map();
    const add = (item = {}) => {
        const artwork = getEpicPurchaseOwnArtwork(item, 'cached_purchase');
        if (!artwork) return;
        for (const key of epicPurchaseArtworkCacheKeys(item)) {
            if (!map.has(key)) map.set(key, artwork);
        }
    };
    for (const bucket of ['purchaseHistoryItems', 'paidItems', 'purchaseGames', 'fabItems']) {
        for (const item of Array.isArray(existingVault?.[bucket]) ? existingVault[bucket] : []) add(item);
    }
    return map;
}

function findEpicPurchaseCachedArtwork(item = {}, cache = new Map()) {
    for (const key of epicPurchaseArtworkCacheKeys(item)) {
        const artwork = cache.get(key);
        if (artwork) return artwork;
    }
    return null;
}

function findEpicLivePriceArtwork(item = {}, livePriceMap = new Map()) {
    for (const key of getEpicPriceIdentityKeys(item)) {
        const price = livePriceMap.get(key);
        const artwork = epicArtworkFromPriceRecord(price, 'epic_catalog');
        if (artwork) return artwork;
    }
    return null;
}

async function resolveEpicPurchaseCatalogArtwork(item = {}, pricingCountry, retry = 0) {
    const originalRef = getEpicOfferRefFromEntry(item);
    if (!originalRef.namespace || (!originalRef.offerId && !originalRef.catalogItemId)) {
        traceEpicPurchaseArtwork('missing_identity', item, { failureReason: 'missing_identity' });
        return null;
    }
    let ref = { ...originalRef };
    let source = ref.offerId ? 'epic_catalog' : 'epic_catalog_catalog_item';
    traceEpicPurchaseArtwork('catalog_lookup_start', item, { inputOfferId: ref.offerId || null, inputCatalogItemId: ref.catalogItemId || null, pricingCountry: getEpicPricingCountryForRequest(pricingCountry) });
    if (!ref.offerId && ref.catalogItemId) {
        const resolved = await resolveEpicOfferFromCatalogItem(ref, pricingCountry);
        if (resolved?.status === 'rate_limited' && retry < 2) {
            await new Promise(r => setTimeout(r, 1200 * (retry + 1)));
            return resolveEpicPurchaseCatalogArtwork(item, pricingCountry, retry + 1);
        }
        traceEpicPurchaseArtwork('catalog_item_resolution', item, {
            resolvedOfferId: resolved?.offerId || null,
            offerFound: !!resolved?.offer,
            keyImagesCount: Array.isArray(resolved?.offer?.keyImages) ? resolved.offer.keyImages.length : 0,
            keyImageTypes: epicKeyImageTypes(resolved?.offer),
            failureReason: resolved?.status || (!resolved?.offer ? 'catalog_item_resolution_failed' : null),
        });
        if (resolved?.offer) {
            const artwork = epicArtworkFromOffer(resolved.offer, source);
            if (artwork) return { ...artwork, resolvedOfferId: resolved.offerId || null };
        }
        if (resolved?.offerId) ref = { ...ref, offerId: resolved.offerId };
    }
    let directFailureReason = null;
    if (ref.offerId) {
        const result = await fetchEpicCatalogOffer(ref, pricingCountry, source);
        if (result.retryable && retry < 2) {
            await new Promise(r => setTimeout(r, 1200 * (retry + 1)));
            return resolveEpicPurchaseCatalogArtwork(item, pricingCountry, retry + 1);
        }
        const artwork = epicArtworkFromPriceRecord(result.price, 'epic_catalog');
        directFailureReason = result.price?.resolutionSource || result.price?.priceStatus || (!artwork ? 'empty_key_images' : null);
        traceEpicPurchaseArtwork('direct_offer_lookup', item, {
            inputOfferId: originalRef.offerId || null,
            returnedOfferId: result.price?.offerId || null,
            returnedCatalogItemId: result.price?.catalogItemId || null,
            keyImagesCount: artwork?.coverCandidates?.length || 0,
            selectedCover: artwork?.coverUrl || null,
            failureReason: artwork ? null : directFailureReason,
        });
        if (artwork) return { ...artwork, resolvedOfferId: result.price?.offerId || ref.offerId || null };
    }
    const fallback = await resolveEpicOfferFromVerifiedFallback(ref, pricingCountry);
    if (fallback?.status === 'rate_limited' && retry < 2) {
        await new Promise(r => setTimeout(r, 1200 * (retry + 1)));
        return resolveEpicPurchaseCatalogArtwork(item, pricingCountry, retry + 1);
    }
    traceEpicPurchaseArtwork('verified_fallback_lookup', item, {
        resolvedOfferId: fallback?.offerId || null,
        offerFound: !!fallback?.offer,
        keyImagesCount: Array.isArray(fallback?.offer?.keyImages) ? fallback.offer.keyImages.length : 0,
        keyImageTypes: epicKeyImageTypes(fallback?.offer),
        failureReason: fallback?.status || (!fallback?.offer ? (directFailureReason || 'offer_not_found') : null),
    });
    if (fallback?.offer) {
        const artwork = epicArtworkFromOffer(fallback.offer, fallback.source === 'app_name' ? 'epic_catalog_app_name' : 'epic_catalog_title_verified');
        if (artwork) return { ...artwork, resolvedOfferId: fallback.offerId || null };
    }
    return null;
}

function applyEpicPurchaseArtwork(item = {}, artwork = null) {
    if (!item || !artwork) return item;
    return {
        ...item,
        coverUrl: artwork.coverUrl || item.coverUrl || null,
        coverCandidates: normalizeEpicCoverCandidates([...(artwork.coverCandidates || []), ...(item.coverCandidates || [])]),
        artworkSource: artwork.artworkSource || item.artworkSource || null,
        resolvedOfferId: artwork.resolvedOfferId || item.resolvedOfferId || null,
        artworkResolvedAt: item.artworkResolvedAt || new Date().toISOString(),
        source: item.source || 'purchase_history',
    };
}

async function enrichEpicPurchaseHistoryArtwork(historySeed, existingVault, livePrices, pricingCountry) {
    if (!historySeed || historySeed.error) return historySeed;
    const cachedArtwork = buildEpicPurchaseArtworkCache(existingVault);
    const livePriceMap = buildEpicPriceMap(livePrices);
    const memo = new Map();
    const resolve = async (item = {}) => {
        if (!item) return item;
        const own = getEpicPurchaseOwnArtwork(item);
        if (own) return applyEpicPurchaseArtwork(item, own);
        const keys = epicPurchaseArtworkCacheKeys(item);
        const memoKey = keys[0] || `${item.title || item.name || ''}:${item.currency || ''}:${item.amountMinor || ''}`;
        if (memo.has(memoKey)) return applyEpicPurchaseArtwork(item, memo.get(memoKey));
        let artwork = findEpicPurchaseCachedArtwork(item, cachedArtwork) || findEpicLivePriceArtwork(item, livePriceMap) || null;
        if (!artwork && pricingCountry) artwork = await resolveEpicPurchaseCatalogArtwork(item, pricingCountry).catch(() => null);
        memo.set(memoKey, artwork || null);
        return artwork ? applyEpicPurchaseArtwork(item, artwork) : { ...item, source: item.source || 'purchase_history', artworkSource: item.artworkSource || 'fallback' };
    };
    const enrichArray = async (items = []) => mapWithConcurrency(Array.isArray(items) ? items : [], 4, resolve);
    return {
        ...historySeed,
        games: await enrichArray(historySeed.games),
        paidItems: await enrichArray(historySeed.paidItems),
        fabItems: await enrichArray(historySeed.fabItems),
        purchaseHistoryItems: await enrichArray(historySeed.purchaseHistoryItems),
    };
}
function buildEpicPurchaseHistoryStatus(historySeed, existingVault, requested) {
    if (historySeed && !historySeed.error) {
        return {
            status: 'complete',
            fetchedAt: new Date().toISOString(),
            ordersCount: Number(historySeed.ordersCount || 0),
        };
    }
    if (historySeed?.error) {
        return {
            ...(existingVault?.purchaseHistory || {}),
            status: 'failed',
            error: historySeed.error,
            failedAt: new Date().toISOString(),
        };
    }
    return existingVault?.purchaseHistory || {
        status: requested ? 'deferred' : 'not_requested',
    };
}


function getEpicGamesForVaultAccount(mergedGames = [], accountId) {
    const aid = String(accountId || '');
    if (!aid) return [];
    return (Array.isArray(mergedGames) ? mergedGames : []).filter((game) => {
        const ids = Array.isArray(game?.ownedByAccountIds) ? game.ownedByAccountIds.map(String) : [];
        return ids.includes(aid) || String(game?.platformAccountId || '') === aid || String(game?.accountId || '') === aid;
    });
}

function normalizeEpicVaultKeyPart(value) {
    return String(value || '').trim().toLowerCase();
}

function normalizeEpicVaultTitle(value) {
    return normalizeEpicVaultKeyPart(value).replace(/[^a-z0-9]+/g, ' ').trim();
}

function getEpicVaultCanonicalGameKey(entry = {}) {
    if (!entry || typeof entry !== 'object') return '';
    const namespace = normalizeEpicVaultKeyPart(entry.namespace || entry.sandboxId || entry.epicMetadata?.namespace);
    const catalogItemId = normalizeEpicVaultKeyPart(entry.catalogItemId || entry.catalog_item_id || entry.catalogId);
    const appName = normalizeEpicVaultKeyPart(entry.appName || entry.app_name);
    const productSlug = normalizeEpicVaultKeyPart(entry.productSlug || entry.slug);
    const title = normalizeEpicVaultTitle(entry.title || entry.name || entry.description);
    const offerId = normalizeEpicVaultKeyPart(entry.offerId || entry.catalogOfferId || entry.offer_id);

    if (namespace && catalogItemId) return `epic:ns:${namespace}:catalog:${catalogItemId}`;
    if (namespace && appName) return `epic:ns:${namespace}:app:${appName}`;
    if (namespace && productSlug) return `epic:ns:${namespace}:slug:${productSlug}`;
    if (catalogItemId) return `epic:catalog:${catalogItemId}`;
    if (namespace && title) return `epic:ns:${namespace}:title:${title}`;
    if (appName) return `epic:app:${appName}`;
    if (productSlug) return `epic:slug:${productSlug}`;
    if (title && !/\b(dlc|add on|add-on|pack|bundle|edition|soundtrack|demo|beta|test)\b/i.test(title)) return `epic:title:${title}`;
    return offerId ? `epic:offer:${offerId}` : '';
}

function epicVaultHasUsablePrice(row = {}) {
    const status = row.priceStatus || row.livePrice?.priceStatus;
    return status === 'priced' || status === 'free' || status === 'not_for_sale' || status === 'unavailable';
}

function mergeEpicVaultGameRow(existing = {}, incoming = {}) {
    const existingPriceWins = epicVaultHasUsablePrice(existing) && !epicVaultHasUsablePrice(incoming);
    const livePrice = existingPriceWins ? existing.livePrice : (incoming.livePrice || existing.livePrice || null);
    const priceStatus = existingPriceWins
        ? (existing.priceStatus || existing.livePrice?.priceStatus || 'unresolved')
        : (incoming.priceStatus || incoming.livePrice?.priceStatus || existing.priceStatus || 'unresolved');
    return {
        ...existing,
        ...incoming,
        id: existing.id || incoming.id,
        title: existing.title || incoming.title,
        coverUrl: existing.coverUrl || incoming.coverUrl || null,
        coverCandidates: normalizeEpicCoverCandidates([...(existing.coverCandidates || []), ...(incoming.coverCandidates || [])]),
        appName: existing.appName || incoming.appName || null,
        namespace: existing.namespace || incoming.namespace || null,
        catalogItemId: existing.catalogItemId || incoming.catalogItemId || null,
        offerId: existing.offerId || incoming.offerId || null,
        livePrice,
        priceResolved: epicVaultHasUsablePrice({ ...incoming, livePrice, priceStatus }) || existing.priceResolved === true,
        priceStatus,
        duplicateOfferIds: [...new Set([...(existing.duplicateOfferIds || []), existing.offerId, incoming.offerId].filter(Boolean).map(String))],
        vaultCanonicalKey: existing.vaultCanonicalKey || incoming.vaultCanonicalKey || getEpicVaultCanonicalGameKey(existing) || getEpicVaultCanonicalGameKey(incoming),
    };
}

function dedupeEpicVaultGameRows(rows = []) {
    const byKey = new Map();
    const unique = [];
    for (const row of Array.isArray(rows) ? rows : []) {
        if (!row) continue;
        const key = getEpicVaultCanonicalGameKey(row) || `epic:row:${unique.length}`;
        const withKey = { ...row, vaultCanonicalKey: row.vaultCanonicalKey || key };
        if (!byKey.has(key)) {
            byKey.set(key, unique.length);
            unique.push(withKey);
            continue;
        }
        unique[byKey.get(key)] = mergeEpicVaultGameRow(unique[byKey.get(key)], withKey);
    }
    return unique;
}

function sanitizeEpicVaultAccount(account = {}) {
    if (!account || typeof account !== 'object') return account;
    return {
        ...account,
        games: dedupeEpicVaultGameRows(account.games),
    };
}

function buildMinimalEpicVaultAccount({ account, games = [], existingVault = null }) {
    const accountId = String(account?.id || account?.accountId || existingVault?.accountId || '');
    const livePrices = Array.isArray(existingVault?.livePrices) ? existingVault.livePrices : [];
    return mergeEpicVaultValuation({
        accountId,
        displayName: account?.displayName || account?.name || existingVault?.displayName || 'Epic Account',
        rawGamesCount: games.length || Number(existingVault?.totalGamesOwned || 0),
        games,
        livePrices,
        historySeed: null,
        existingVault,
        syncOptions: { games: true, currentPrices: false, purchaseHistory: false },
        historyImported: existingVault?.permissions?.purchaseHistory === true,
        pricingCountry: normalizeEpicCountry(account?.pricingCountry) || normalizeEpicCountry(existingVault?.pricingCountry),
    });
}

function reconcileEpicVaultWithLinkedAccounts({ vault, linkedAccounts, mergedGames }) {
    const safeVault = vault && typeof vault === 'object' ? vault : { accounts: [] };
    const existingAccounts = Array.isArray(safeVault.accounts) ? safeVault.accounts.map(sanitizeEpicVaultAccount) : [];
    const existingById = new Map(existingAccounts
        .filter((account) => account?.accountId)
        .map((account) => [String(account.accountId), account]));
    const accounts = (Array.isArray(linkedAccounts) ? linkedAccounts : [])
        .filter((account) => account?.id || account?.accountId)
        .map((account) => {
            const accountId = String(account.id || account.accountId);
            const existingVault = existingById.get(accountId) || null;
            const accountGames = getEpicGamesForVaultAccount(mergedGames, accountId);
            return buildMinimalEpicVaultAccount({ account: { ...account, id: accountId }, games: accountGames, existingVault });
        });
    return { ...safeVault, accounts: accounts.map(sanitizeEpicVaultAccount), generatedAt: safeVault.generatedAt || new Date().toISOString() };
}

async function readReconciledEpicVault({ stageTimeoutMs = 5000 } = {}) {
    const stages = [];
    const timed = async (name, task) => {
        const startedAt = performance.now();
        try {
            const value = await withEpicVaultDeadline(task, stageTimeoutMs, 'VAULT_' + name.toUpperCase().replace(/[^A-Z0-9]+/g, '_') + '_TIMEOUT', 'Vault hydration stage ' + name + ' did not settle within ' + stageTimeoutMs + 'ms.');
            stages.push({ name, status: 'success', durationMs: Math.round((performance.now() - startedAt) * 100) / 100 });
            return value;
        } catch (error) {
            stages.push({ name, status: 'error', durationMs: Math.round((performance.now() - startedAt) * 100) / 100, errorCode: error?.code || 'VAULT_STAGE_FAILED' });
            error.stages = stages.slice();
            throw error;
        }
    };
    const vault = await timed('repository.readEpicVault', () => syncCacheRepository.readEpicVault());
    const linkedAccounts = await timed('repository.readEpicAccounts', () => getEpicAccountsList());
    const mergedGames = await timed('repository.readEpicMergedLibrary', () => syncCacheRepository.readEpicMergedLibrary());
    const reconcileStartedAt = performance.now();
    const reconciled = reconcileEpicVaultWithLinkedAccounts({ vault, linkedAccounts, mergedGames });
    stages.push({ name: 'reconciliation', status: 'success', durationMs: Math.round((performance.now() - reconcileStartedAt) * 100) / 100 });
    return { vault: reconciled, stages };
}

const epicVaultHydrationService = new EpicVaultHydrationService({
    readSnapshot: () => readReconciledEpicVault(),
    userDataPath: app.getPath('userData'),
    snapshotPath: syncCacheRepository.epicVaultFile,
    isPackaged: app.isPackaged,
    timeoutMs: 8000,
    log: process.env.BADDEL_VAULT_DIAGNOSTICS === '1' ? (diagnostics) => console.log('[VaultHydration]', JSON.stringify(diagnostics)) : null,
});

function mergeEpicVaultValuation({
    accountId,
    displayName,
    rawGamesCount,
    games,
    livePrices,
    historySeed,
    existingVault,
    syncOptions,
    historyImported,
    pricingCountry,
}) {
    const priceMap = buildEpicPriceMap(livePrices);
    const hasNewHistory = !!historySeed && !historySeed.error;
    const purchaseHistory = buildEpicPurchaseHistoryStatus(historySeed, existingVault, syncOptions.purchaseHistory);
    const valueOrExisting = (key, fallback = 0) => hasNewHistory ? (historySeed[key] ?? fallback) : (existingVault?.[key] ?? fallback);
    const arrayOrExisting = (key) => hasNewHistory
        ? (Array.isArray(historySeed[key]) ? historySeed[key] : [])
        : (Array.isArray(existingVault?.[key]) ? existingVault[key] : []);
    const objectOrExisting = (key) => hasNewHistory
        ? (historySeed[key] && typeof historySeed[key] === 'object' ? historySeed[key] : {})
        : (existingVault?.[key] && typeof existingVault[key] === 'object' ? existingVault[key] : {});
    const currency = hasNewHistory
        ? (historySeed.currency || historySeed.primaryCurrency || existingVault?.currency || livePrices.find(p => p?.currency)?.currency || 'USD')
        : (existingVault?.currency || livePrices.find(p => p?.currency)?.currency || 'USD');
    const netSpentMinor = Number(valueOrExisting('netSpentMinor', valueOrExisting('actualSpentMinor', 0)) || 0);
    const canonicalRows = dedupeEpicVaultGameRows(buildEpicVaultGameRows(games, priceMap));

    // Reconciliation is a projection over authoritative account/game rows.
    // Keep committed timestamps, revisions and diagnostics stable on reads.
    return projectEpicVaultAccount(existingVault, {
        accountId,
        displayName,
        currency,
        primaryCurrency: hasNewHistory ? (historySeed.primaryCurrency || currency) : (existingVault?.primaryCurrency || currency),
        pricingCountry: normalizeEpicCountry(pricingCountry) || normalizeEpicCountry(existingVault?.pricingCountry) || null,
        multipleCurrencies: hasNewHistory ? historySeed.multipleCurrencies === true : existingVault?.multipleCurrencies === true,
        region: historySeed?.region || existingVault?.region || 'UNK',
        totalGamesOwned: canonicalRows.length,
        games: canonicalRows,
        livePrices,
        grossPurchasesMinor: Number(valueOrExisting('grossPurchasesMinor', 0) || 0),
        refundsMinor: Number(valueOrExisting('refundsMinor', 0) || 0),
        netSpentMinor,
        gameSpendMinor: Number(valueOrExisting('gameSpendMinor', 0) || 0),
        fabSpendMinor: Number(valueOrExisting('fabSpendMinor', 0) || 0),
        grossPurchasesByCurrency: objectOrExisting('grossPurchasesByCurrency'),
        refundsByCurrency: objectOrExisting('refundsByCurrency'),
        netSpentByCurrency: objectOrExisting('netSpentByCurrency'),
        gameSpendByCurrency: objectOrExisting('gameSpendByCurrency'),
        fabSpendByCurrency: objectOrExisting('fabSpendByCurrency'),
        freeClaimsCount: Number(valueOrExisting('freeClaimsCount', 0) || 0),
        cancelledOrdersCount: Number(valueOrExisting('cancelledOrdersCount', 0) || 0),
        duplicateOrdersDropped: Number(valueOrExisting('duplicateOrdersDropped', 0) || 0),
        actualSpent: netSpentMinor / 100,
        realSpent: netSpentMinor / 100,
        actualSpentMinor: netSpentMinor,
        paidItems: arrayOrExisting('paidItems'),
        fabItems: arrayOrExisting('fabItems'),
        refunds: arrayOrExisting('refunds'),
        purchaseGames: hasNewHistory
            ? (Array.isArray(historySeed.games) ? historySeed.games : [])
            : (Array.isArray(existingVault?.purchaseGames) ? existingVault.purchaseGames : []),
        purchaseHistoryItems: hasNewHistory
            ? (Array.isArray(historySeed.purchaseHistoryItems) ? historySeed.purchaseHistoryItems : [])
            : (Array.isArray(existingVault?.purchaseHistoryItems) ? existingVault.purchaseHistoryItems : []),
        spendDiagnostics: hasNewHistory ? (historySeed.spendDiagnostics || null) : (existingVault?.spendDiagnostics || null),
        purchaseHistory,
        purchaseHistoryFetchedAt: hasNewHistory
            ? purchaseHistory.fetchedAt
            : (existingVault?.purchaseHistoryFetchedAt || existingVault?.purchaseHistory?.fetchedAt || null),
        permissions: {
            currentPrices: syncOptions.currentPrices ? livePrices.some(p => p?.priceStatus === 'priced' || p?.priceStatus === 'free' || p?.priceStatus === 'not_for_sale' || p?.priceStatus === 'unavailable') : existingVault?.permissions?.currentPrices === true,
            purchaseHistory: historyImported || existingVault?.permissions?.purchaseHistory === true,
        },
        historyError: historySeed?.error || existingVault?.historyError || null,
    });
}

function buildEpicVaultCoverCandidates(game = {}, price = null) {
    const candidates = [];
    const push = (url, source) => {
        const value = String(url || '').trim();
        if (!value || candidates.some((item) => item.url === value)) return;
        candidates.push({ url: value, source });
    };
    push(game.image, 'library_image');
    push(game.defaultImage, 'library_default_image');
    push(game.cover, 'library_cover');
    push(game.coverUrl, 'library_cover_url');
    push(game.posterImage, 'library_poster');
    push(price?.image, 'epic_catalog_price');
    push(price?.coverUrl, 'epic_catalog_cover');
    return candidates;
}

function buildEpicVaultGameRows(games = [], priceMap = new Map()) {
    return dedupeEpicVaultGameRows(games.map((game) => {
        const price = getEpicPriceIdentityKeys(game).map((key) => priceMap.get(key)).find(Boolean) || null;
        const status = price?.priceStatus || 'unresolved';
        const hasPrice = !!price && (status === 'priced' || status === 'free' || status === 'not_for_sale' || status === 'unavailable');
        const coverCandidates = buildEpicVaultCoverCandidates(game, price);
        return {
            id: game.id,
            title: game.title,
            coverUrl: coverCandidates[0]?.url || null,
            coverCandidates,
            appName: game.appName,
            namespace: game.namespace,
            catalogItemId: game.catalogItemId,
            offerId: game.offerId || null,
            livePrice: price,
            priceResolved: hasPrice,
            priceStatus: hasPrice ? status : 'unresolved',
        };
    }));
}
function buildEpicPriceMap(livePrices = []) {
    const map = new Map();
    for (const price of Array.isArray(livePrices) ? livePrices : []) {
        if (!price) continue;
        for (const key of getEpicPriceIdentityKeys(price)) {
            if (key) map.set(String(key), price);
        }
    }
    return map;
}
function hasUsableEpicPurchaseHistory(accountVault = {}) {
    if (!accountVault || accountVault.historyError) return false;
    if (accountVault.permissions?.purchaseHistory !== true) return false;
    const status = accountVault.purchaseHistory?.status || accountVault.purchaseHistoryStatus || null;
    if (status) return status === 'complete';
    return Boolean(accountVault.purchaseHistoryFetchedAt || accountVault.ordersFetchedAt);
}
function getEpicOrderCurrency(order = {}, fallback = 'USD') {
    const tx = Array.isArray(order.transactions) ? order.transactions.find(t => t?.currency || t?.total?.currency || t?.amount?.currency) : null;
    return String(order.subtotal?.currency || order.total?.currency || order.currency || order.currencyCode || tx?.currency || tx?.total?.currency || tx?.amount?.currency || fallback || 'USD').toUpperCase();
}

function getEpicOrderDate(order = {}) {
    const raw = order.createdAtMillis || order.createdAt || order.date || order.orderDate || order.completedAt || order.updatedAt;
    if (!raw) return null;
    const ms = Number(raw);
    const date = Number.isFinite(ms) && ms > 10_000 ? new Date(ms) : new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function getEpicOrderStableId(order = {}) {
    const direct = order.orderId || order.id || order.orderNumber || order.number || order.receiptId || null;
    if (direct) return String(direct);
    const items = getEpicOrderItems(order).map(item => item.offerId || item.catalogOfferId || item.catalogItemId || item.description || item.title || item.name).filter(Boolean).join('|');
    return `fp:${[getEpicOrderDate(order), getEpicOrderCurrency(order, 'UNK'), order.orderStatus || order.status || '', order.orderType || '', getEpicRawOrderAmountCandidate(order), items].join('|')}`;
}

function getEpicRawOrderAmountCandidate(order = {}) {
    const candidates = [
        order.total?.amount,
        order.orderTotal?.amount,
        order.amountTotal?.amount,
        order.amount,
        order.grandTotal,
        order.subtotal?.amount,
    ];
    for (const value of candidates) {
        const n = Number(value);
        if (Number.isFinite(n)) return n;
    }
    return 0;
}

function getEpicTransactionAmountMinor(tx = {}) {
    const raw = tx.amount?.amount ?? tx.total?.amount ?? tx.total ?? tx.amount ?? tx.value ?? 0;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
}

function getEpicTransactionLifecycle(tx = {}) {
    return String(tx.status || tx.transactionStatus || tx.state || tx.type || tx.transactionType || '').toUpperCase();
}

function isEpicRefundOrder(order = {}) {
    const haystack = [order.orderStatus, order.status, order.orderType, order.type, order.refundStatus, order.paymentStatus]
        .map(v => String(v || '').toUpperCase()).join(' ');
    if (/REFUND|REFUNDED|REVERSAL|CHARGEBACK|RETURNED/.test(haystack)) return true;
    const txs = Array.isArray(order.transactions) ? order.transactions : [];
    return txs.some(tx => /REFUND|REFUNDED|REVERSAL|CHARGEBACK|RETURNED/.test(getEpicTransactionLifecycle(tx)) || getEpicTransactionAmountMinor(tx) < 0);
}

function isEpicCanceledOrder(order = {}) {
    const haystack = [order.orderStatus, order.status, order.paymentStatus, order.orderType]
        .map(v => String(v || '').toUpperCase()).join(' ');
    return /CANCEL|CANCELED|CANCELLED|FAILED|DECLINED|VOID|ERROR|EXPIRED/.test(haystack);
}

function isEpicCompletedOrder(order = {}) {
    if (isEpicCanceledOrder(order)) return false;
    const haystack = [order.orderStatus, order.status, order.paymentStatus, order.orderType]
        .map(v => String(v || '').toUpperCase()).join(' ');
    if (!haystack.trim()) return true;
    return /COMPLETE|COMPLETED|SUCCESS|SUCCEEDED|PAID|PURCHASE|REFUND|REFUNDED|FULFILLED|FULFILLED/.test(haystack);
}

function isEpicFabOrder(order = {}) {
    const group = String(order.merchantGroup || '').toUpperCase();
    const marketplace = String(order.marketplaceName || order.store || order.salesChannel || '').toLowerCase();
    const itemsText = getEpicOrderItems(order).map(item => `${item.namespace || item.sandboxId || ''} ${item.description || item.title || item.name || ''}`).join(' ').toLowerCase();
    return group === 'UE_MKT' || marketplace.includes('fab marketplace') || marketplace.includes('unreal engine marketplace') || /\bfab\b|unreal engine marketplace/.test(itemsText);
}

function getEpicOrderItems(order = {}) {
    if (Array.isArray(order.items)) return order.items;
    if (Array.isArray(order.lineItems)) return order.lineItems;
    if (Array.isArray(order.orderItems)) return order.orderItems;
    if (Array.isArray(order.entitlements)) return order.entitlements;
    return [];
}

function getEpicAuthoritativeOrderAmount(order = {}) {
    const direct = getEpicRawOrderAmountCandidate(order);
    const txs = Array.isArray(order.transactions) ? order.transactions : [];
    const settled = txs.filter((tx) => /CAPTURE|CAPTURED|SETTLED|SALE|PAID|SUCCESS|SUCCEEDED|REFUND|REFUNDED|REVERSAL/.test(getEpicTransactionLifecycle(tx)));
    const rejected = txs.filter((tx) => /AUTH|AUTHORIZE|AUTHORIZED|PENDING|VOID|FAILED|DECLINED|CANCEL/.test(getEpicTransactionLifecycle(tx)));
    let amountMinor = direct;
    let source = direct ? 'order_total' : 'zero_or_missing_total';
    if (!amountMinor && settled.length) {
        const absValues = settled.map(getEpicTransactionAmountMinor).map(v => Math.abs(v)).filter(v => Number.isFinite(v));
        const unique = Array.from(new Set(absValues));
        amountMinor = unique.length ? Math.max(...unique) : 0;
        source = 'settled_transaction_unique_max';
    }
    if (!amountMinor && txs.length && !settled.length && rejected.length) source = 'ignored_unsettled_transactions';
    if (!Number.isFinite(Number(amountMinor))) amountMinor = 0;
    return {
        amountMinor: Math.abs(Number(amountMinor || 0)),
        source,
        transactionRows: txs.length,
        settledRows: settled.length,
        ignoredRows: rejected.length,
    };
}

function getEpicOrderAmountMinor(order = {}) {
    return getEpicAuthoritativeOrderAmount(order).amountMinor;
}

function addEpicMinor(bucket, currency, value) {
    const code = String(currency || 'USD').toUpperCase();
    bucket[code] = Number(bucket[code] || 0) + Number(value || 0);
}

function epicSingleCurrencyMinor(bucket, preferredCurrency = 'USD') {
    const entries = Object.entries(bucket || {}).filter(([, value]) => Number(value || 0) !== 0);
    if (entries.length === 0) return { currency: preferredCurrency, amountMinor: 0, isMixed: false };
    if (entries.length === 1) return { currency: entries[0][0], amountMinor: entries[0][1], isMixed: false };
    const preferred = entries.find(([currency]) => currency === preferredCurrency) || entries[0];
    return { currency: 'MULTI', amountMinor: preferred[1], isMixed: true };
}

function normalizeEpicUniqueOrders(orders = []) {
    const seen = new Set();
    const unique = [];
    let duplicateOrdersDropped = 0;
    for (const order of Array.isArray(orders) ? orders : []) {
        if (!order) continue;
        const id = getEpicOrderStableId(order);
        if (seen.has(id)) {
            duplicateOrdersDropped += 1;
            continue;
        }
        seen.add(id);
        unique.push(order);
    }
    return { unique, duplicateOrdersDropped };
}

function normalizeEpicPurchaseHistoryItems(orders = []) {
    const { unique } = normalizeEpicUniqueOrders(orders);
    const rows = [];
    for (const order of unique) {
        const items = getEpicOrderItems(order);
        const first = items[0] || {};
        const amount = getEpicAuthoritativeOrderAmount(order);
        const amountMinor = amount.amountMinor;
        const currency = getEpicOrderCurrency(order, 'USD');
        const isRefund = isEpicRefundOrder(order);
        const isFab = isEpicFabOrder(order);
        const isCancelled = isEpicCanceledOrder(order);
        const status = order.orderStatus || order.status || order.orderType || (isRefund ? 'REFUNDED' : (isCancelled ? 'CANCELED' : 'COMPLETED'));
        const title = first.description || first.title || first.name || order.description || order.offerTitle || 'Unknown item';
        rows.push({
            orderId: order.orderId || order.id || order.orderNumber || order.number || null,
            stableOrderId: getEpicOrderStableId(order),
            title,
            date: getEpicOrderDate(order),
            status,
            amount: amountMinor / 100,
            amountMinor,
            currency,
            type: isRefund ? 'refund' : (isFab ? 'fab' : (amountMinor === 0 ? 'free' : 'game')),
            isRefund,
            isFab,
            isCancelled,
            amountSource: amount.source,
            transactionRows: amount.transactionRows,
            offerId: first.offerId || first.catalogOfferId || order.offerId || null,
            catalogItemId: first.catalogItemId || first.catalog_item_id || order.catalogItemId || null,
            namespace: first.namespace || first.sandboxId || order.namespace || null,
            source: 'purchase_history',
            coverUrl: null,
            coverCandidates: [],
            artworkSource: null,
            itemCount: items.length || 1,
            items: (items.length ? items : [first]).map((item) => ({
                title: item.description || item.title || item.name || null,
                offerId: item.offerId || item.catalogOfferId || null,
                catalogItemId: item.catalogItemId || item.catalog_item_id || null,
                namespace: item.namespace || item.sandboxId || null,
            })).filter((item) => item.title || item.offerId || item.catalogItemId || item.namespace),
        });
    }
    return rows;
}

function processEpicOrdersForVault(orders = []) {
    let currency = 'USD';
    let region = 'UNK';
    const grossPurchasesByCurrency = {};
    const refundsByCurrency = {};
    const netSpentByCurrency = {};
    const gameSpendByCurrency = {};
    const fabSpendByCurrency = {};
    let freeClaimsCount = 0;
    let cancelledOrdersCount = 0;
    let paidCompletedOrdersCount = 0;
    let refundsCount = 0;
    let fabOrdersCount = 0;
    const games = [];
    const paidItems = [];
    const fabItems = [];
    const refunds = [];
    const diagnostics = [];
    const { unique, duplicateOrdersDropped } = normalizeEpicUniqueOrders(orders);

    for (const order of unique) {
        if (!order) continue;
        if (region === 'UNK') region = order.market || order.country || order.address?.regionName || order.billingAddress?.country || 'UNK';
        const amount = getEpicAuthoritativeOrderAmount(order);
        const amountMinor = amount.amountMinor;
        const orderCurrency = getEpicOrderCurrency(order, currency);
        if (amountMinor > 0) currency = orderCurrency;
        const isRefund = isEpicRefundOrder(order);
        const isCanceled = isEpicCanceledOrder(order);
        const isCompleted = isEpicCompletedOrder(order);
        const isFab = isEpicFabOrder(order);
        const items = getEpicOrderItems(order);
        const first = items[0] || {};
        const baseRow = {
            orderId: order.orderId || order.id || order.orderNumber || order.number || null,
            stableOrderId: getEpicOrderStableId(order),
            title: first.description || first.title || first.name || order.description || order.offerTitle || 'Unknown item',
            offerId: first.offerId || first.catalogOfferId || order.offerId || null,
            catalogItemId: first.catalogItemId || first.catalog_item_id || order.catalogItemId || null,
            namespace: first.namespace || first.sandboxId || order.namespace || null,
            amount: amountMinor / 100,
            amountMinor,
            currency: orderCurrency,
            date: getEpicOrderDate(order),
            status: order.orderStatus || order.status || order.orderType || (isRefund ? 'REFUNDED' : (isCanceled ? 'CANCELED' : 'COMPLETED')),
            type: isFab ? 'fab' : 'game',
            amountSource: amount.source,
            source: 'purchase_history',
            coverUrl: null,
            coverCandidates: [],
            artworkSource: null,
        };

        if (isCanceled || !isCompleted) {
            cancelledOrdersCount += 1;
            diagnostics.push({ orderId: baseRow.stableOrderId, reason: 'ignored_cancelled_or_failed', status: baseRow.status, amountSource: amount.source });
            continue;
        }
        if (amountMinor === 0) {
            freeClaimsCount += 1;
        } else if (isRefund) {
            refundsCount += 1;
            addEpicMinor(refundsByCurrency, orderCurrency, amountMinor);
            addEpicMinor(netSpentByCurrency, orderCurrency, -amountMinor);
            refunds.push({ ...baseRow, type: isFab ? 'fab_refund' : 'refund' });
            continue;
        } else {
            paidCompletedOrdersCount += 1;
            addEpicMinor(grossPurchasesByCurrency, orderCurrency, amountMinor);
            addEpicMinor(netSpentByCurrency, orderCurrency, amountMinor);
            addEpicMinor(isFab ? fabSpendByCurrency : gameSpendByCurrency, orderCurrency, amountMinor);
            paidItems.push(baseRow);
            if (isFab) {
                fabOrdersCount += 1;
                fabItems.push(baseRow);
            }
        }

        if (!isFab) {
            for (const item of items.length ? items : [first]) {
                const title = item.description || item.title || item.name || order.description || null;
                const offerId = item.offerId || item.catalogOfferId || null;
                const catalogItemId = item.catalogItemId || item.catalog_item_id || null;
                const namespace = item.namespace || item.sandboxId || null;
                if (!title && !offerId && !catalogItemId && !namespace) continue;
                games.push({ title: title || 'Unknown game', offerId, catalogItemId, namespace, source: 'purchase_history' });
            }
        }
    }

    const gross = epicSingleCurrencyMinor(grossPurchasesByCurrency, currency);
    const refund = epicSingleCurrencyMinor(refundsByCurrency, currency);
    const net = epicSingleCurrencyMinor(netSpentByCurrency, currency);
    const gameSpend = epicSingleCurrencyMinor(gameSpendByCurrency, currency);
    const fabSpend = epicSingleCurrencyMinor(fabSpendByCurrency, currency);
    const multipleCurrencies = gross.isMixed || refund.isMixed || net.isMixed || gameSpend.isMixed || fabSpend.isMixed;
    const summary = {
        rawOrders: Array.isArray(orders) ? orders.length : 0,
        uniqueNormalizedOrders: unique.length,
        duplicateOrdersDropped,
        paidCompleted: paidCompletedOrdersCount,
        refunds: refundsCount,
        freeClaims: freeClaimsCount,
        cancelledFailed: cancelledOrdersCount,
        fabOrders: fabOrdersCount,
        grossPurchasesByCurrency,
        refundsByCurrency,
        netSpentByCurrency,
    };
    syncInfo('[Epic Vault] Spend reconciliation', summary);

    return {
        games,
        currency: multipleCurrencies ? 'MULTI' : net.currency,
        primaryCurrency: net.currency === 'MULTI' ? currency : net.currency,
        multipleCurrencies,
        region,
        grossPurchasesMinor: gross.amountMinor,
        refundsMinor: refund.amountMinor,
        netSpentMinor: net.amountMinor,
        gameSpendMinor: gameSpend.amountMinor,
        fabSpendMinor: fabSpend.amountMinor,
        grossPurchasesByCurrency,
        refundsByCurrency,
        netSpentByCurrency,
        gameSpendByCurrency,
        fabSpendByCurrency,
        freeClaimsCount,
        cancelledOrdersCount,
        duplicateOrdersDropped,
        paidCompletedOrdersCount,
        refundsCount,
        fabOrdersCount,
        realSpent: net.amountMinor / 100,
        actualSpent: net.amountMinor / 100,
        actualSpentMinor: net.amountMinor,
        paidItems,
        fabItems,
        refunds,
        ordersCount: unique.length,
        rawOrdersCount: Array.isArray(orders) ? orders.length : 0,
        spendDiagnostics: { summary, unknownStructures: diagnostics },
        purchaseHistoryItems: normalizeEpicPurchaseHistoryItems(unique),
    };
}
function _epicWebUserAgent(userAgent) {
    return userAgent || `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome || '120.0.0.0'} Safari/537.36`;
}

function _epicResponseClassification(response, bodyText = '') {
    return classifyEpicWebResponse(response, bodyText);
}

function _epicRequestOriginPath(value) {
    try {
        const parsed = new URL(String(value || ''));
        return `${parsed.origin}${parsed.pathname}`;
    } catch {
        return '[invalid Epic URL]';
    }
}

async function _fetchEpicWebJson(epicSession, url, userAgent, purpose, options = {}) {
    const requestController = new AbortController();
    const forwardAbort = () => requestController.abort(options.signal?.reason);
    if (options.signal?.aborted) forwardAbort();
    else options.signal?.addEventListener?.('abort', forwardAbort, { once: true });
    const requestTimer = setTimeout(() => requestController.abort(), Number(options.requestTimeoutMs || 18000));
    const stage = options.stage || (purpose === 'account identity' ? 'cached_identity_check' : 'history_page_fetch');
    const attempt = Number(options.attempt || 0);
    const originPath = _epicRequestOriginPath(url);
    const identityRequest = purpose === 'account identity' || purpose === 'session authorization';
    const fail = (response, classification, code) => {
        options.onDiagnostic?.({
            stage,
            status: Number(response?.status || 0),
            originPath,
            contentType: String(response?.headers?.get?.('content-type') || ''),
            redirected: response?.redirected === true,
            classification,
            attempt,
            code,
        });
    };
    if (!epicSession?.fetch) {
        const code = identityRequest
            ? EPIC_HISTORY_ERROR_CODES.IDENTITY_ENDPOINT_UNAVAILABLE
            : EPIC_HISTORY_ERROR_CODES.REAUTH_REQUIRED;
        fail(null, 'empty', code);
        throw epicHistoryError(code, 'Epic browser session is not available.');
    }
    let response;
    let bodyText;
    try {
        response = await epicSession.fetch(url, {
            method: 'GET',
            headers: {
                Accept: 'application/json, text/plain, */*',
                'Accept-Language': 'en-US,en;q=0.9',
                Referer: 'https://www.epicgames.com/account/payment/history',
                'X-Requested-With': 'XMLHttpRequest',
                'User-Agent': _epicWebUserAgent(userAgent),
            },
            credentials: 'include',
            cache: 'no-store',
            signal: requestController.signal,
        });
        bodyText = await response.text();
    } catch (error) {
        if (options.signal?.aborted) throw options.signal.reason || error;
        if (requestController.signal.aborted) throw epicHistoryError(EPIC_HISTORY_ERROR_CODES.TIMEOUT, 'Epic ' + purpose + ' request timed out.', error);
        const code = EPIC_HISTORY_ERROR_CODES.NETWORK_ERROR;
        fail(null, 'empty', code);
        throw epicHistoryError(code, `Epic ${purpose} request failed.`, error);
    } finally {
        clearTimeout(requestTimer);
        options.signal?.removeEventListener?.('abort', forwardAbort);
    }
    const responseClassification = _epicResponseClassification(response, bodyText);
    const classification = responseClassification.classification;
    if (responseClassification.explicitAuthStatus || responseClassification.explicitLoginRedirect) {
        fail(response, classification, EPIC_HISTORY_ERROR_CODES.REAUTH_REQUIRED);
        throw epicHistoryError(
            EPIC_HISTORY_ERROR_CODES.REAUTH_REQUIRED,
            'Epic authentication is required.',
            null,
            {
                explicitAuthStatus: responseClassification.explicitAuthStatus,
                explicitLoginRedirect: responseClassification.explicitLoginRedirect,
                status: response.status,
            }
        );
    }
    if (classification === 'login_html') {
        fail(response, classification, EPIC_HISTORY_ERROR_CODES.REAUTH_REQUIRED);
        throw epicHistoryError(EPIC_HISTORY_ERROR_CODES.REAUTH_REQUIRED, 'Epic authentication is required.');
    }
    if (!response.ok) {
        const code = response.status >= 500
            ? EPIC_HISTORY_ERROR_CODES.SERVICE_UNAVAILABLE
            : (identityRequest ? EPIC_HISTORY_ERROR_CODES.IDENTITY_CHECK_FAILED : EPIC_HISTORY_ERROR_CODES.FETCH_FAILED);
        fail(response, classification, code);
        throw epicHistoryError(code, `Epic ${purpose} request failed (${response.status}).`, null, {
            status: Number(response.status || 0),
        });
    }
    if (classification !== 'json') {
        const code = identityRequest
            ? EPIC_HISTORY_ERROR_CODES.IDENTITY_ENDPOINT_UNAVAILABLE
            : EPIC_HISTORY_ERROR_CODES.INVALID_RESPONSE;
        fail(response, classification, code);
        throw epicHistoryError(code, `Epic ${purpose} returned an unexpected ${classification} response.`);
    }
    try {
        return JSON.parse(bodyText);
    } catch (error) {
        const code = identityRequest ? EPIC_HISTORY_ERROR_CODES.IDENTITY_CHECK_FAILED : EPIC_HISTORY_ERROR_CODES.INVALID_RESPONSE;
        fail(response, classification, code);
        throw epicHistoryError(code, `Epic ${purpose} returned invalid data.`, error);
    }
}

function _extractEpicWebIdentity(data = {}) {
    const candidates = [data, data.account, data.user, data.personal, data.response];
    for (const candidate of candidates) {
        if (!candidate || typeof candidate !== 'object') continue;
        const accountId = candidate.accountId || candidate.account_id || candidate.id;
        if (accountId) return { accountId: String(accountId), displayName: candidate.displayName || candidate.display_name || null };
    }
    return null;
}

async function verifyEpicWebIdentity(epicSession, userAgent, options = {}) {
    const data = await _fetchEpicWebJson(
        epicSession,
        'https://www.epicgames.com/account/v2/personal/ajaxGet',
        userAgent,
        'account identity',
        options
    );
    const identity = _extractEpicWebIdentity(data);
    if (!identity?.accountId) {
        options.onDiagnostic?.({
            stage: options.stage || 'cached_identity_check',
            originPath: 'https://www.epicgames.com/account/v2/personal/ajaxGet',
            classification: 'json',
            attempt: Number(options.attempt || 0),
            code: EPIC_HISTORY_ERROR_CODES.IDENTITY_CHECK_FAILED,
        });
        throw epicHistoryError(EPIC_HISTORY_ERROR_CODES.IDENTITY_CHECK_FAILED, 'Epic authenticated-session identity is unavailable.');
    }
    return identity;
}

async function fetchEpicOrderHistoryWithSession(epicSession, userAgent, options = {}) {
    const orders = await collectEpicPurchaseHistoryPages(async (nextPageToken, page, request = {}) => {
        return _fetchEpicWebJson(epicSession, _epicOrderHistoryUrl(nextPageToken), userAgent, 'order history', {
            ...options,
            signal: request.signal || options.signal,
            attempt: Number(options.attempt || 0) + page,
        });
    }, options);
    const processed = processEpicOrdersForVault(orders);
    processed.pagesFetched = Number(orders.pagesFetched || 0);
    processed.lastSuccessfulPage = Number(orders.lastSuccessfulPage ?? -1);
    return processed;
}

function _epicOrderHistoryUrl(nextPageToken = '') {
    const url = new URL('https://www.epicgames.com/account/v2/payment/ajaxGetOrderHistory');
    url.searchParams.set('count', '30');
    url.searchParams.set('sortDir', 'DESC');
    url.searchParams.set('sortBy', 'DATE');
    url.searchParams.set('locale', 'en-US');
    if (nextPageToken) url.searchParams.set('nextPageToken', nextPageToken);
    return url.toString();
}

function _readEpicBrowserJson(result, purpose, options = {}) {
    const identityRequest = purpose === 'account identity';
    const failureCode = identityRequest ? EPIC_HISTORY_ERROR_CODES.IDENTITY_CHECK_FAILED : EPIC_HISTORY_ERROR_CODES.FETCH_FAILED;
    const diagnostic = {
        stage: options.stage || (identityRequest ? 'post_login_identity_check' : 'history_page_fetch'),
        status: Number(result?.status || 0),
        originPath: String(result?.originPath || '[invalid Epic URL]'),
        contentType: String(result?.contentType || ''),
        redirected: result?.redirected === true,
        classification: String(result?.classification || 'empty'),
        attempt: Number(options.attempt || 0),
        causeCode: result?.causeCode || undefined,
        causeSummary: result?.causeSummary || undefined,
    };
    if (diagnostic.status === 401 || diagnostic.status === 403 || diagnostic.classification === 'login_html') {
        options.onDiagnostic?.({ ...diagnostic, code: EPIC_HISTORY_ERROR_CODES.REAUTH_REQUIRED });
        throw epicHistoryError(EPIC_HISTORY_ERROR_CODES.REAUTH_REQUIRED, 'Epic authentication is required.', null, {
            explicitAuthStatus: diagnostic.status === 401 || diagnostic.status === 403,
        });
    }
    if (result?.ok !== true) {
        options.onDiagnostic?.({ ...diagnostic, code: failureCode });
        throw epicHistoryError(failureCode, `Epic ${purpose} request failed (${diagnostic.status || 'network'}).`);
    }
    if (diagnostic.classification !== 'json' || !result?.data || typeof result.data !== 'object') {
        const code = identityRequest ? EPIC_HISTORY_ERROR_CODES.IDENTITY_CHECK_FAILED : EPIC_HISTORY_ERROR_CODES.INVALID_RESPONSE;
        options.onDiagnostic?.({ ...diagnostic, code });
        throw epicHistoryError(code, `Epic ${purpose} did not return valid JSON.`);
    }
    return result.data;
}

async function verifyEpicLoginBrowserIdentity(loginResult, options = {}) {
    const result = await loginResult.requestJson('https://www.epicgames.com/account/v2/personal/ajaxGet');
    const identity = _extractEpicWebIdentity(_readEpicBrowserJson(result, 'account identity', options));
    if (!identity?.accountId) {
        options.onDiagnostic?.({ stage: options.stage || 'post_login_identity_check', classification: 'json', attempt: Number(options.attempt || 0), code: EPIC_HISTORY_ERROR_CODES.IDENTITY_CHECK_FAILED });
        throw epicHistoryError(EPIC_HISTORY_ERROR_CODES.IDENTITY_CHECK_FAILED, 'Epic browser identity did not include an account ID.');
    }
    return identity;
}

async function fetchEpicOrderHistoryWithLoginResult(loginResult, options = {}) {
    const orders = await collectEpicPurchaseHistoryPages(async (nextPageToken, page) => {
        const result = await loginResult.requestJson(_epicOrderHistoryUrl(nextPageToken));
        return _readEpicBrowserJson(result, 'order history', { ...options, attempt: Number(options.attempt || 0) + page });
    }, options);
    const processed = processEpicOrdersForVault(orders);
    processed.pagesFetched = Number(orders.pagesFetched || 0);
    processed.lastSuccessfulPage = Number(orders.lastSuccessfulPage ?? -1);
    return processed;
}

// Steam Paths
const STEAM_MERGED_CACHE  = syncCacheRepository.steamMergedCacheFile;
const GOG_MERGED_CACHE    = syncCacheRepository.gogMergedCacheFile;
const gogRuntimeMetadata = loadGogRuntimeVersionInfo({
    projectRoot: __dirname,
    resourcesPath: process.resourcesPath,
    isPackaged: app.isPackaged,
});
if (gogRuntimeMetadata.error) {
    syncWarn('[GOG Runtime] Metadata unavailable:', gogRuntimeMetadata.error.message);
}
const gogRuntime = new GogRuntime({
    projectRoot: __dirname,
    resourcesPath: process.resourcesPath,
    isPackaged: app.isPackaged,
    versionInfo: gogRuntimeMetadata.versionInfo,
});
const gogApiClient = new GogApiClient();
const gogAuthService = new GogAuthService({
    runtime: gogRuntime,
    userDataDir: app.getPath('userData'),
    BrowserWindow,
    WebContentsView,
    session,
    shellPath: resolveGogAuthShellPath({
        projectRoot: __dirname,
        isPackaged: app.isPackaged,
        fsSync,
        path,
    }),
    windowIcon: path.join(__dirname, 'Logo.ico'),
    profileResolver: (credentials) => gogApiClient.fetchUserDetails({
        userId: credentials.userId,
        accessToken: credentials.accessToken,
    }),
});
const gogRichMetadataInflight = new Map();
const gogRichMetadataFailures = new Map();
const GOG_RICH_METADATA_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const GOG_RICH_METADATA_FAILURE_COOLDOWN_MS = 60 * 1000;

function isFreshGogRichMetadata(game, now = Date.now()) {
    const updatedAt = Date.parse(game?.gogRichMetadataUpdatedAt || '');
    return Number.isFinite(updatedAt) && now - updatedAt < GOG_RICH_METADATA_TTL_MS;
}

async function enrichGogGameDetailsOnDemand(gameId) {
    const id = String(gameId || '').trim();
    if (!/^gog[_-]\d+$/i.test(id)) throw new Error('A valid GOG game id is required.');
    const library = await syncCacheRepository.readGogMergedLibrary();
    const existing = library.find((game) => String(game?.id) === id);
    if (!existing) throw new Error('GOG game was not found in the synced library.');
    if (isFreshGogRichMetadata(existing)) return { status: 'success', cached: true, game: existing };
    const failedAt = gogRichMetadataFailures.get(id) || 0;
    if (Date.now() - failedAt < GOG_RICH_METADATA_FAILURE_COOLDOWN_MS) {
        return { status: 'cooldown', cached: true, game: existing };
    }
    if (gogRichMetadataInflight.has(id)) return gogRichMetadataInflight.get(id);

    const promise = (async () => {
        try {
            const accountId = String(existing?.ownedByAccountIds?.[0] || '');
            const credentials = accountId ? await gogAuthService.readCredentials(accountId) : {};
            const release = {
                external_id: existing.productId || existing.allIds?.gog,
                title: existing.title,
                name: existing.title,
                slug: existing.slug,
            };
            const { storeProduct, storePage } = await fetchGogStoreMetadata(release, credentials, null, { allowStorePage: true });
            if (!storeProduct && !storePage) {
                gogRichMetadataFailures.set(id, Date.now());
                return { status: 'unavailable', cached: true, game: existing };
            }
            const account = { id: accountId, displayName: existing?.ownedBy?.[0] || 'GOG account' };
            const enriched = preserveGogLastKnownGood(existing, normalizeGogRelease({
                ...existing,
                external_id: release.external_id,
                _storeProduct: storeProduct,
                _storePage: storePage,
            }, account));
            const persisted = {
                ...existing,
                ...enriched,
                info: { ...(existing.info || {}), ...(enriched.info || {}) },
                ownedBy: existing.ownedBy,
                ownedByAccountIds: existing.ownedByAccountIds,
                gogRichMetadataUpdatedAt: new Date().toISOString(),
            };
            const nextLibrary = library.map((game) => String(game?.id) === id ? persisted : game);
            await syncCacheRepository.writeGogMergedLibrary(nextLibrary);
            gogRichMetadataFailures.delete(id);
            return { status: 'success', cached: false, game: persisted };
        } catch (error) {
            gogRichMetadataFailures.set(id, Date.now());
            syncWarn(`[GogDetails] Lazy enrichment failed for ${id}: ${redactGogSecrets(error?.message || error)}`);
            return { status: 'error', cached: true, game: existing };
        }
    })().finally(() => gogRichMetadataInflight.delete(id));
    gogRichMetadataInflight.set(id, promise);
    return promise;
}
let _libraryWriteQueue = Promise.resolve();
let _enrichRequestQueue = Promise.resolve();

// Injected from main.js ? same signature as gameScanner's registerImageDownloader.
// Downloads { cover?, hero?, logo? } assets to local image_cache and returns file:// paths.
let _platformSyncAssetDownloader = null;
function registerPlatformSyncAssetDownloader(fn) {
    _platformSyncAssetDownloader = fn;
}

/**
 * Debounced library-updated emitter.
 * Collapses rapid-fire cache-write events into a single IPC send after 1.5s of quiet.
 * Prevents All Games from re-rendering dozens of times during a sync batch.
 */
function _emitLibraryUpdated(win) {
    libraryUpdateEmitter.emit(win);
}

let _platformAccountsChangeRevision = 0;
function _emitPlatformAccountsChanged(platform, reason, win = _platformSyncWindowGetter?.()) {
    const payload = { platform, reason, changeRevision: ++_platformAccountsChangeRevision, changedAt: Date.now() };
    if (win && !win.isDestroyed?.()) win.webContents?.send?.('platform-sync:accounts-changed', payload);
    return payload;
}

async function _emitPlatformLibraryCommitted(platform, win = _platformSyncWindowGetter?.(), meta = {}) {
    const syncRunId = meta?.syncRunId || null;
    try {
        const readStart = performance.now();
        const snapshot = meta?.snapshot || await syncCacheRepository.readMergedLibrarySnapshot(platform);
        _syncTraceStage(syncRunId, "commit.snapshot-read", readStart, {
            fromWriteResult: !!meta?.snapshot,
            games: Array.isArray(snapshot?.games) ? snapshot.games.length : 0,
            revision: snapshot?.revision ?? null,
            changed: snapshot?.changed !== false,
            writeDiagnostics: snapshot?.writeDiagnostics || null,
        });
        if (snapshot?.changed === false && meta?.forceEmit !== true) {
            _syncTraceStage(syncRunId, "commit.no-op-suppressed", performance.now(), { games: Array.isArray(snapshot.games) ? snapshot.games.length : 0 });
            return snapshot;
        }
        if (win && !win.isDestroyed()) {
            const dispatchStart = performance.now();
            win.webContents.send("platform-library-committed", {
                ...snapshot,
                syncRunId,
                committedAt: Date.now(),
                changed: snapshot?.changed !== false,
            });
            _syncTraceStage(syncRunId, "commit.event-dispatch", dispatchStart, { viewSent: true });
        }
        return snapshot;
    } catch (err) {
        syncWarn(`[PlatformSync] Could not emit platform-library-committed for ${platform}:`, err.message);
        _finishPlatformSyncCommitTrace(syncRunId, { error: err?.message || String(err) });
        return null;
    }
}

/**
 * Bounded-concurrency iterator: runs fn(item) for each item in items,
 * keeping at most `concurrency` promises in-flight at once.
 * @template T
 * @param {T[]} items
 * @param {(item: T) => Promise<void>} fn
 * @param {number} concurrency
 */
async function _withConcurrency(items, fn, concurrency) {
    if (!items.length || concurrency <= 0) return;
    const queue = [...items];
    await Promise.all(
        Array.from({ length: Math.min(concurrency, items.length) }, async () => {
            while (queue.length > 0) {
                const item = queue.shift();
                if (item !== undefined) await fn(item);
            }
        })
    );
}

function _enqueueLibraryWrite(fn) {
    _libraryWriteQueue = _libraryWriteQueue.then(fn);
    return _libraryWriteQueue;
}

function _waitForLibraryWrites() {
    return _libraryWriteQueue;
}

/**
 * Cover-first image caching for a just-written merged library.
 *
 * Phase 1 ? Covers: download remote coverUrls at up to coverConcurrency workers.
 *   After each successful cover, fires coverCachedEmitter immediately for instant
 *   per-card UI patch.  Writes file:// paths back to cacheFile in batches and
 *   fires the debounced emitter (library-updated) every ~500ms as a backup sync.
 * Phase 2 ? Secondary: after ALL covers are done, download hero/logo fire-and-
 *   forget at lower concurrency so they never block covers.
 *
 * Stale detection: file:// URLs whose underlying file is missing are cleared
 * from the entry so the renderer can re-trigger its own fetch later.
 *
 * Ownership: entries with customArtworkLocked=true are always skipped.
 *
 * @param {object[]} entries                   - Merged library array (mutated in place)
 * @param {Function} downloader                - (assets, gameId) => Promise<{cover?,hero?,logo?}>
 * @param {string}   cacheFile                 - Absolute path to merged JSON cache
 * @param {Function} matchFn                   - (lib, entry) => index in lib (-1 if absent)
 * @param {Function} [emitter]                 - Debounced library-updated backup emitter
 * @param {object}   [opts]
 * @param {Function} [opts.coverCachedEmitter] - (payload) => void; fired immediately per cached cover
 * @param {Function} [opts.existsFn]           - Override fsSync.existsSync (for unit testing)
 * @param {object}   [opts.fsDeps]             - Override { readFile, writeFile } (for unit testing)
 * @param {number}   [opts.coverConcurrency=10]
 * @param {number}   [opts.secondaryConcurrency=2]
 * @param {number}   [opts.batchSize=20]
 * @param {number}   [opts.libUpdatedDebounceMs=500]
 */
async function cacheLibraryCoversFirst(entries, downloader, cacheFile, matchFn, emitter, opts = {}) {
    const assetWriteBackService = new PlatformSyncAssetWriteBackService({
        fsDeps: opts.fsDeps || {
            readFile: (file, encoding) => fs.readFile(file, encoding),
            writeJson: (file, value) => syncCacheRepository.writeJsonFileAtomic(file, value),
        },
        existsFn: opts.existsFn || ((file) => fsSync.existsSync(file)),
        enqueueWrite: _enqueueLibraryWrite,
        waitForWrites: _waitForLibraryWrites,
        logger: {
            log: (...args) => syncLog(...args),
            debug: (msg, data) => coverDbgSync(msg, data),
        },
        userDataDir: app.getPath('userData'),
        path,
    });

    const runHydration = () => assetWriteBackService.cacheLibraryCoversFirst({
        entries,
        downloader,
        cacheFile,
        matchFn,
        emitter,
        opts,
    });

    if (typeof downloader?.withManifestTransaction === 'function') {
        return downloader.withManifestTransaction({
            label: 'library-cover-hydration',
            batchSize: opts.manifestBatchSize || 50,
        }, runHydration);
    }
    return runHydration();
}

function _scheduleLibraryArtworkWarmup({
    platform,
    entries,
    cacheFile,
    matchFn,
    coverCachedEmitter,
}) {
    if (!_platformSyncAssetDownloader) return;
    cacheLibraryCoversFirst(
        entries,
        _platformSyncAssetDownloader,
        cacheFile,
        matchFn,
        null,
        { coverCachedEmitter }
    ).catch(e => syncWarn(`[CoverFirst] ${platform} error:`, e.message));
}

// --- Helpers -------------------------------------------------

let _managedArtworkMigrationPromise = null;
async function ensureDirs() {
    await syncCacheRepository.ensureDirs();
    if (!_managedArtworkMigrationPromise) {
        _managedArtworkMigrationPromise = syncCacheRepository.migrateManagedArtworkUrlsFromMergedLibraries()
            .then((summary) => {
                if (summary?.changed) syncLog('[ArtworkPersistence] removed managed cache URLs from merged libraries', summary.platforms);
                return summary;
            })
            .catch((err) => {
                syncWarn('[ArtworkPersistence] merged library migration failed:', err?.message || err);
                return null;
            });
    }
    await _managedArtworkMigrationPromise;
}

let _platformSyncWindowGetter = null;
const epicProgressiveStateFile = path.join(SYNC_CACHE_DIR, 'epic_progressive_sync.json');
const epicProgressiveAtomicStore = new AtomicJsonFileStore();
const epicProgressiveSyncCoordinator = new EpicProgressiveSyncCoordinator({
    store: {
        read: async () => {
            try { return JSON.parse(await fs.readFile(epicProgressiveStateFile, 'utf8')); }
            catch (error) { if (error?.code === 'ENOENT') return {}; throw error; }
        },
        write: async (value) => epicProgressiveAtomicStore.writeJson(epicProgressiveStateFile, value),
    },
    emit: (payload) => {
        const win = _platformSyncWindowGetter?.();
        if (win && !win.isDestroyed()) win.webContents.send('epic-sync-progress', payload);
    },
    isAccountActive: async (accountId) => {
        if (!_epicActiveAccountIds) await getEpicAccountsList();
        return _epicActiveAccountIds.has(String(accountId));
    },
});
app.once?.('before-quit', () => { epicProgressiveSyncCoordinator.shutdown().catch(() => {}); });
const syncLogQueue = new SyncLogQueue({
    now: () => new Date().toISOString(),
    writeLog: async (entry, platform) => {
        const logLine = JSON.stringify(entry) + '\n';
        await ensureDirs();
        await fs.appendFile(path.join(SYNC_LOGS_DIR, `${platform}.log`), logLine, 'utf8');
    },
});
const linkStateEmitter = new LinkStateEmitter();
const libraryUpdateEmitter = new LibraryUpdateEmitter({
    getSavedGames: () => gamesSyncAdapter.getSavedGames(),
    debounceMs: 1500,
});
const syncTerminalEventEmitter = new SyncTerminalEventEmitter({
    getWindow: () => _platformSyncWindowGetter?.(),
    Notification,
});
const stateChangedEmitter = new StateChangedEmitter({
    getWindow: () => _platformSyncWindowGetter?.(),
});
const _platformSyncState = {
    steam: null,
    epic: null,
    gog: null,
};

const _platformSyncCommitTraces = new Map();

function _createSyncRunId(platform) {
    return `${platform}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function _startPlatformSyncCommitTrace(platform, syncRunId, context = {}) {
    const id = String(syncRunId || _createSyncRunId(platform));
    if (_platformSyncCommitTraces.has(id)) return id;
    let eventLoop = null;
    try {
        eventLoop = monitorEventLoopDelay({ resolution: 10 });
        eventLoop.enable();
    } catch {}
    _platformSyncCommitTraces.set(id, {
        syncRunId: id,
        platform,
        startedAt: Date.now(),
        startedAtIso: new Date().toISOString(),
        context: { ...context, eventLoopMonitor: eventLoop },
        main: { stages: [], eventLoopLagMaxMs: 0, eventLoopLagMeanMs: 0 },
        completion: {
            artworkWarmupScheduled: 0,
            warmupEntriesScanned: 0,
            coverCachedEventsSent: 0,
            newlyDownloadedCovers: 0,
            cacheMisses: 0,
        },
    });
    return id;
}

function _syncTraceStage(syncRunId, name, startedAt, extra = {}) {
    const trace = _platformSyncCommitTraces.get(String(syncRunId || ""));
    if (!trace) return;
    trace.main.stages.push({
        name,
        atMs: Math.max(0, startedAt - performance.timeOrigin),
        durationMs: performance.now() - startedAt,
        ...extra,
    });
}

function _syncTraceCompletionCounter(syncRunId, patch = {}) {
    const trace = _platformSyncCommitTraces.get(String(syncRunId || ""));
    if (!trace) return;
    trace.completion = { ...(trace.completion || {}), ...patch };
}

function _recordPostSyncArtworkWarmupSkipped(syncRunId, platform, entries = []) {
    const count = Array.isArray(entries) ? entries.length : 0;
    _syncTraceCompletionCounter(syncRunId, {
        artworkWarmupScheduled: 0,
        warmupEntriesScanned: 0,
        coverCachedEventsSent: 0,
        newlyDownloadedCovers: 0,
        cacheMisses: 0,
    });
    _syncTraceStage(syncRunId, "artwork-warmup.skipped-normal-sync", performance.now(), { platform, entries: count });
}

function _finishPlatformSyncCommitTrace(syncRunId, extra = {}) {
    const id = String(syncRunId || "");
    const trace = _platformSyncCommitTraces.get(id);
    if (!trace || trace.finished) return;
    trace.finished = true;
    Object.assign(trace, extra);
    try {
        const monitor = trace.context?.eventLoopMonitor;
        if (monitor) {
            trace.main.eventLoopLagMaxMs = Number(monitor.max || 0) / 1e6;
            trace.main.eventLoopLagMeanMs = Number(monitor.mean || 0) / 1e6;
            monitor.disable?.();
            if (trace.context) delete trace.context.eventLoopMonitor;
        }
    } catch {}
    setTimeout(() => {
        const finalTrace = _platformSyncCommitTraces.get(id);
        if (!finalTrace) return;
        console.log("BADDEL_SYNC_COMMIT_TRACE", JSON.stringify(finalTrace));
        _platformSyncCommitTraces.delete(id);
    }, 2000);
}

function _clonePlain(value) {
    return JSON.parse(JSON.stringify(value));
}

function _createPlatformSyncState(platform) {
    return {
        platform,
        isSyncing: false,
        phase: 'idle',
        statusText: '',
        startedAt: null,
        finishedAt: null,
        progress: {
            completedAccounts: 0,
            totalAccounts: 0,
            percent: 0,
            currentAccountId: null,
            currentAccountName: null,
        },
        accounts: {},
        logs: [],
        lastError: null,
        validation: { ok: true, issues: [], countsByAccount: {}, totalGames: 0 },
        summary: { totalGames: 0, installOnlyGames: 0, sampleTitles: [] },
    };
}

function _getPlatformSyncState(platform) {
    if (!_platformSyncState[platform]) {
        _platformSyncState[platform] = _createPlatformSyncState(platform);
    }
    return _platformSyncState[platform];
}

function _emitPlatformSyncState(platform) {
    try {
        stateChangedEmitter.emit(_clonePlain(_getPlatformSyncState(platform)));
    } catch {}
}

function _setPlatformSyncState(platform, updater) {
    const baseState = _clonePlain(_getPlatformSyncState(platform));
    const nextState = typeof updater === 'function'
        ? (updater(baseState) || baseState)
        : { ...baseState, ...updater };
    _platformSyncState[platform] = nextState;
    _emitPlatformSyncState(platform);
    return nextState;
}

function _pushPlatformSyncLog(platform, level, message, extra = {}) {
    const prefix = `[PlatformSync:${platform}]`;
    if (level === 'error') console.error(prefix, message, extra);
    else if (level === 'warn') console.warn(prefix, message, extra);
    else console.log(prefix, message, extra);

    const entry = syncLogQueue.push(platform, {
        level,
        message,
        accountId: extra.accountId ? String(extra.accountId) : null,
        accountName: extra.accountName || null,
    });

    _setPlatformSyncState(platform, (state) => {
        state.logs = [...(state.logs || []), entry].slice(-80);
        return state;
    });
}

function _startPlatformSync(platform, accounts, statusText, operation = {}) {
    const now = new Date().toISOString();
    const state = _createPlatformSyncState(platform);
    state.isSyncing = true;
    state.phase = 'starting';
    state.statusText = statusText;
    state.startedAt = now;
    state.finishedAt = null;
    state.operationType = operation.operationType || 'sync';
    state.operationId = operation.operationId || null;
    state.syncRunId = operation.syncRunId || null;
    state.progress.totalAccounts = accounts.length;
    state.accounts = Object.fromEntries(accounts.map((account) => [
        String(account.id),
        {
            id: String(account.id),
            displayName: account.displayName || String(account.id),
            status: 'pending',
            gamesCount: 0,
            gameTitles: [],
            message: 'Waiting to sync',
            startedAt: null,
            finishedAt: null,
        },
    ]));
    _platformSyncState[platform] = state;
    _emitPlatformSyncState(platform);
    _pushPlatformSyncLog(platform, 'info', statusText);
}

function _updatePlatformSyncAccount(platform, accountId, patch = {}) {
    _setPlatformSyncState(platform, (state) => {
        const aid = String(accountId);
        const existing = state.accounts?.[aid] || { id: aid, displayName: aid, status: 'pending', gamesCount: 0 };
        state.accounts = {
            ...state.accounts,
            [aid]: {
                ...existing,
                ...patch,
            },
        };
        return state;
    });
}

function _updatePlatformSyncProgress(platform, patch = {}) {
    _setPlatformSyncState(platform, (state) => {
        state.progress = { ...state.progress, ...patch };
        const total = Math.max(0, Number(state.progress.totalAccounts) || 0);
        const completed = Math.max(0, Number(state.progress.completedAccounts) || 0);
        state.progress.percent = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
        return state;
    });
}

function _finishPlatformSync(platform, patch = {}) {
    const __finishTraceStart = performance.now();
    _setPlatformSyncState(platform, (state) => {
        state.isSyncing = false;
        state.phase = patch.phase || 'done';
        state.statusText = patch.statusText || state.statusText;
        state.finishedAt = new Date().toISOString();
        state.lastError = patch.lastError || null;
        if (patch.validation) state.validation = patch.validation;
        if (patch.summary) state.summary = patch.summary;
        if (patch.progress) state.progress = { ...state.progress, ...patch.progress };
        const total = Math.max(0, Number(state.progress.totalAccounts) || 0);
        const completed = Math.max(0, Number(state.progress.completedAccounts) || 0);
        state.progress.percent = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
        return state;
    });

    try {
        const finalState = _clonePlain(_getPlatformSyncState(platform));
        const isFailed = patch.phase === 'error' || !!patch.lastError;
        if (isFailed) {
            syncTerminalEventEmitter.emitFailed(finalState);
        } else {
            const notifyGames = patch.targetAccountId
                // Targeted sync ? show target account count, not total merged library
                ? finalState.accounts?.[String(patch.targetAccountId)]?.gamesCount || 0
                : finalState.summary?.totalGames || 0;
            const platformName = platform.charAt(0).toUpperCase() + platform.slice(1);
            syncTerminalEventEmitter.emitCompleted(finalState, {
                title: 'Baddel Launcher',
                body: notifyGames > 0
                    ? `${platformName} sync complete ? ${notifyGames} games synced.`
                    : `${platformName} library sync complete.`,
                icon: path.join(__dirname, 'Logo.ico'),
            });
        }
    } catch {}

    if (patch?.syncRunId) {
        _syncTraceStage(patch.syncRunId, "sync.finish-state", __finishTraceStart, {
            phase: patch.phase || 'done',
            activePlatform: platform,
            statusText: patch.statusText || null,
        });
        _finishPlatformSyncCommitTrace(patch.syncRunId, {
            suppressed: false,
            completedAt: Date.now(),
            completedAtIso: new Date().toISOString(),
        });
    }
}

function _emitLinkState(mainWindow, platform, status, message, extra = {}) {
    linkStateEmitter.emit(mainWindow, platform, status, message, extra);
}

async function _writeSwitcherSyncLink(platform, switcherProfileName, platformAccountId, extra = {}) {
    try {
        const switcherDir = path.join(app.getPath('userData'), 'accounts', platform, switcherProfileName.trim());
        await fs.mkdir(switcherDir, { recursive: true });
        const linkFile = path.join(switcherDir, 'sync_link.json');
        await fs.writeFile(linkFile, JSON.stringify({
            platformAccountId: String(platformAccountId),
            linkedAt: new Date().toISOString(),
            ...extra
        }, null, 2), 'utf8');
    } catch (e) {
        syncWarn(`[PlatformSync] Could not write sync_link.json for ${platform}/${switcherProfileName}:`, e.message);
    }
}

// Safe variant ? never creates a new directory. Only writes sync_link.json when a
// real switcher profile folder already exists. For Epic it also verifies the folder
// contains actual session data (Data/, Config/, etc.) so phantom folders are ignored.
async function _writeSyncLinkToExistingSwitcherProfile(platform, profileName, platformAccountId, extra = {}) {
    const result = await epicSwitcherRepository.writeSyncLinkToExistingProfile(platform, profileName, platformAccountId, extra);
    if (result.ok) return true;
    if (result.reason === 'missing_profile') {
        syncLog(`[PlatformSync] No existing ${platform} switcher profile "${profileName}"; skipping sync_link write.`);
    } else if (result.reason === 'phantom_profile') {
        syncLog(`[PlatformSync] Epic folder "${profileName}" contains no real session data; skipping sync_link write.`);
    } else if (result.reason === 'error') {
        syncWarn(`[PlatformSync] Could not write sync_link.json for ${platform}/${profileName}:`, result.error.message);
    }
    return false;
}

// Searches existing Epic switcher profiles for one that matches by account ID or
// display name. Returns the profile folder name if found, null otherwise.
async function _findMatchingEpicSwitcherProfile(accountId, displayName) {
    return epicSwitcherRepository.findMatchingEpicProfile(accountId, displayName);
}

async function mapWithConcurrency(items, limit, mapper) {
    const list = Array.isArray(items) ? items : [];
    if (list.length === 0) return [];
    const concurrency = Math.max(1, Math.min(Number(limit) || 1, list.length));
    const results = new Array(list.length);
    let cursor = 0;

    async function worker() {
        while (cursor < list.length) {
            const index = cursor++;
            results[index] = await mapper(list[index], index);
        }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    return results;
}

async function buildSteamOwnedGameEntries(account, games = []) {
    return mapWithConcurrency(games, 10, async (game) => ({
        id: game.id,
        title: game.title,
        platform: 'steam',
        source: 'steam',
        coverUrl: null,
        heroUrl:  null,
        logoUrl:  null,
        appName: String(game.appid),
        playtime: 0,
        lastSynced: new Date().toISOString(),
        ownedBy: [account.displayName],
        steamAppType: game.steamAppType || null,
        ownedByAccountIds: [String(account.id)],
        steamLicensedAccountIds: [String(account.id)],
    }));
}

async function buildEpicOwnedGameEntries(account, entries = []) {
    const confPath = getLegendaryConfPath(account.id);
    // Defensive: ensure no non-game entries slip through regardless of call site.
    const playableEntries = (Array.isArray(entries) ? entries : []).filter(isEpicPlayableGameEntry);
    return mapWithConcurrency(playableEntries, 10, async (entry) => {
        const gameId = `epic_${entry.app_name}`;
        let metadata = entry.metadata;

        // --- If metadata is missing from JSON, try to read from disk cache ---
        if (!metadata || !metadata.keyImages) {
            try {
                const diskMeta = await _getLegendaryMetadataFromDisk(confPath, entry.app_name);
                if (diskMeta && diskMeta.metadata) {
                    metadata = diskMeta.metadata;
                    // syncLog(`[Epic Sync] Found disk metadata for ${entry.app_name}`);
                }
            } catch (err) {
                // syncWarn(`[Epic Sync] Failed to read disk metadata for ${entry.app_name}:`, err.message);
            }
        }

        // All image caching is now handled by baddelapi
        const newCoverUrl = _pickEpicCover(metadata?.keyImages);

        return {
            id: gameId,
            title: entry.app_title || entry.app_name,
            platform: 'epic',
            source: 'epic',
            coverUrl: newCoverUrl || null,
            heroUrl: _pickEpicHero(metadata?.keyImages),
            logoUrl: _pickEpicLogo(metadata?.keyImages),
            appName: entry.app_name,
            namespace: entry.metadata?.namespace 
                    || Object.values(entry.asset_infos || {})[0]?.namespace
                    || metadata?.namespace 
                    || '',
            // -- FIX: expose namespace as allIds.epic so game-details.js uses
            // the correct server lookup ID (namespace UUID, NOT appName).
            // The server stores Epic games by catalog_namespace, not app_name.
            allIds: {
                epic: entry.metadata?.namespace
                    || Object.values(entry.asset_infos || {})[0]?.namespace
                    || metadata?.namespace
                    || null,
            },
            catalogItemId: entry.catalog_item_id || metadata?.id || '',
            offerId: entry.offerId || entry.catalogOfferId || metadata?.offerId || metadata?.catalogOfferId || null,
            // ????? ??????: ????? ?? ??????? ???? ??????? ??????? ?? Fallback
            epicMetadata: metadata ? {
                developer: metadata.developer || null,
                description: metadata.description || null,
                creationDate: metadata.creationDate || null,
                namespace: metadata.namespace || null
            } : null, 
            lastSynced: new Date().toISOString(),
            ownedBy: [account.displayName],
            ownedByAccountIds: [String(account.id)],
            epicProductType: entry.productType || entry.product_type || entry.offerType || entry.category || null,
            thirdPartyLauncher: entry.third_party_store || null,
            requiresExternalLauncher: false, // keep EA/third-party games visible in library
        };
    });
}

async function _getLegendaryMetadataFromDisk(confPath, appName) {
    // Build a list of all known account config paths, current account first
    const allConfPaths = [confPath];
    try {
        const otherAccounts = await getEpicAccountsList();
        for (const a of otherAccounts) {
            const p = getLegendaryConfPath(a.id);
            if (p !== confPath) allConfPaths.push(p);
        }
    } catch {}

    // Search across all account folders ? metadata may live in a different account's folder
    for (const p of allConfPaths) {
        try {
            const metaPath = path.join(p, 'metadata', `${appName}.json`);
            if (fsSync.existsSync(metaPath)) {
                const raw = await fs.readFile(metaPath, 'utf8');
                return JSON.parse(raw);
            }
        } catch (err) {
            console.error('[Epic Sync Disk Meta] Error reading from', p, ':', err.message);
        }
    }
    return null;
}

async function fetchSteamOwnedGamesWithRetry(account, previousCount, initialSessionSteamId, expectedGeneration) {
    const aid = String(account.id);
    let result = await steamBridge.getOwnedGames(expectedGeneration);
    let rawGamesCount = Array.isArray(result?.games) ? result.games.length : 0;
    const shouldRetry = result?.status === 'success' && rawGamesCount === 0;

    if (!shouldRetry) {
        // syncLog(`[Sync:${account.displayName}] getOwnedGames ? ${rawGamesCount} games (no retry needed)`);
        return { result, rawGamesCount };
    }

    // syncWarn(`[Sync:${account.displayName}] ? getOwnedGames returned 0 ? retrying after 1.5s grace period`);
    _pushPlatformSyncLog('steam', 'warn', `Steam returned 0 owned games for ${account.displayName}. Retrying once after the cache settles.`, {
        accountId: aid,
        accountName: account.displayName,
    });
    _updatePlatformSyncAccount('steam', aid, {
        status: 'syncing',
        message: 'Checking your Steam library again',
    });

    // Cache was already awaited before this call ? just a short grace period
    await new Promise((resolve) => setTimeout(resolve, 1_500));

    const retryResult = await steamBridge.getOwnedGames(expectedGeneration);
    const retryCount = Array.isArray(retryResult?.games) ? retryResult.games.length : 0;
    syncLog(`[Sync:${account.displayName}] Retry ? ${retryCount} games`);

    if (retryResult?.status === 'success' && retryCount > rawGamesCount) {
        _pushPlatformSyncLog('steam', 'info', `Retry recovered ${retryCount} owned games for ${account.displayName}`, {
            accountId: aid,
            accountName: account.displayName,
        });
        result = retryResult;
        rawGamesCount = retryCount;
    } else if (retryResult?.status === 'success' && retryCount === 0) {
        result = retryResult;
        rawGamesCount = 0;
    }

    return { result, rawGamesCount };
}

// --- Steam Bridge --------------------------------------------

const steamBridge = require('./steamBridge');

let _bridgeStarted = false;
let _steamBridgeListenersBound = false;
async function _ensureBridgeRunning() {
    if (_bridgeStarted && steamBridge.isRunning) return;
    await steamBridge.start();
    _bridgeStarted = true;

    if (_steamBridgeListenersBound) return;
    _steamBridgeListenersBound = true;

    steamBridge.on('bridgeLog', ({ level, message }) => {
        _pushPlatformSyncLog('steam', level === 'error' ? 'error' : 'info', message);
    });

    steamBridge.on('gamesUpdate', async (payload) => {
        // Payload from Python is { steamAccountId, games } (new shape) or a legacy raw array.
        const isLegacyArray = Array.isArray(payload);
        const newGames = isLegacyArray ? payload : (Array.isArray(payload?.games) ? payload.games : []);
        // Always read the account id from the event payload ? never from getLastSessionSteamId()
        // at handling time, because a later sync for a different account may now be active.
        const sid = isLegacyArray ? null : (payload?.steamAccountId ? String(payload.steamAccountId).trim() : null);

        if (!newGames.length) return;

        // If a sync is actively running, skip background writes to avoid cross-account contamination.
        if (_getPlatformSyncState('steam').isSyncing) {
            syncLog(`[SteamBridge] Background gamesUpdate received during active sync ? skipped to prevent cross-account write (steamAccountId=${sid ?? 'unknown'})`);
            return;
        }

        if (!sid) {
            syncWarn(`[SteamBridge] Background gamesUpdate has no steamAccountId ? skipping ownership attribution (${newGames.length} games ignored)`);
            return;
        }

        syncLog(`[SteamBridge] ?? Background: ${newGames.length} new games from account ${sid}`);
        try {
            const existing = await syncCacheRepository.readSteamMergedLibrary();
            const map = new Map(existing.map(g => [g.id, g]));
            const accs = steamConnector.getAccounts();
            const accMatch = accs.find((a) => String(a.id) === sid) || null;
            const displayNames = accMatch ? [accMatch.displayName] : [];

            for (const g of newGames) {
                if (!map.has(g.id)) {
                    map.set(g.id, {
                        id: g.id,
                        title: g.title,
                        platform: 'steam',
                        source: 'steam',
                        coverUrl: null,
                        heroUrl:  null,
                        logoUrl:  null,
                        appName: String(g.appid),
                        playtime: 0,
                        lastSynced: new Date().toISOString(),
                        ownedBy: displayNames,
                        ownedByAccountIds: [sid],
                        steamLicensedAccountIds: [sid],
                    });
                } else {
                    const ex = map.get(g.id);
                    if (!ex.steamLicensedAccountIds) ex.steamLicensedAccountIds = [];
                    if (!ex.steamLicensedAccountIds.map(String).includes(sid)) ex.steamLicensedAccountIds.push(sid);
                    if (!ex.ownedByAccountIds) ex.ownedByAccountIds = [];
                    if (!ex.ownedByAccountIds.map(String).includes(sid)) ex.ownedByAccountIds.push(sid);
                    if (accMatch) {
                        if (!ex.ownedBy) ex.ownedBy = [];
                        if (!ex.ownedBy.includes(accMatch.displayName)) ex.ownedBy.push(accMatch.displayName);
                    }
                }
            }
            await syncCacheRepository.writeSteamMergedLibrary([...map.values()]);
            await _emitPlatformLibraryCommitted('steam');
        } catch (e) {
            console.error('[SteamBridge] Failed to merge background games:', e.message);
        }
    });
}

// --- Steam Mobile Approval Auto-Polling ----------------------
//
// Called when the Steam confirm (mobile approval) view is shown.
// Polls every 2s; on success closes the window and resolves the auth promise.
// Returns a stop function the caller can invoke to cancel polling.

// Pure step handler ? exported for testing.
function _mobileApprovalPollStep(status, attempt, maxAttempts) {
    return steamApprovalPollUseCase.pollStep({ status, attempt, maxAttempts });
}

function _startMobileApprovalPolling(win, resolve, reject) {
    const CONFIRM_STUB = 'baddel://steam/two_factor_confirm_finished';
    const POLL_INTERVAL_MS  = 2000;
    const POLL_TIMEOUT_MS   = 15000;
    const FALLBACK_MS       = 20000;
    const MAX_ATTEMPTS      = 90; // ~3 min

    let active = true;
    let attempt = 0;
    const diagLog = [];
    console.log('[SteamLinkDiag] polling started');

    const injectUiUpdate = (msg, reenableButton = false) => {
        if (!win || win.isDestroyed()) return;
        const escaped = msg.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        win.webContents.executeJavaScript(`
            (function(){
                var el = document.querySelector('#steamGuardConfirm .waiting-status span');
                if (el) el.textContent = '${escaped}';
                ${reenableButton ? `
                var btn = document.getElementById('continueBtn');
                if (btn) { btn.disabled = false; btn.style.opacity = ''; }
                ` : ''}
            })();
        `).catch(() => {});
    };

    const writeDiag = (finalStatus) => {
    try {
        const { app: electronApp } = require('electron');
        const diagPath = path.join(electronApp.getPath('userData'), 'steam-link-diagnostics.json');
        fsSync.writeFileSync(diagPath, JSON.stringify({
            timestamp: new Date().toISOString(),
            finalStatus,
            totalAttempts: attempt,
            log: diagLog,
        }, null, 2));
        console.log('[SteamLinkDiag] wrote:', diagPath);
    } catch (e) {
        console.error('[SteamLinkDiag] failed:', e.message);
    }
};

    // 20-second fallback ? re-enable the button so the user isn't permanently stuck
    const fallbackTimer = setTimeout(() => {
        if (active) injectUiUpdate('Still waiting? Keep Steam open and approve the same request.', false);
    }, FALLBACK_MS);

    const stop = () => {
        active = false;
        clearTimeout(fallbackTimer);
    };

    const poll = async () => {
        if (!active || !win || win.isDestroyed()) return;

        const thisAttempt = ++attempt;
        if (thisAttempt > MAX_ATTEMPTS) {
            stop();
            injectUiUpdate('Approval request expired. Click Continue to try again.', true);
            writeDiag('max_attempts');
            return;
        }

        const t0 = Date.now();
        let result = null;
        try {
            result = await Promise.race([
                steamBridge.passLoginCredentials(CONFIRM_STUB, {}),
                new Promise((_, rej) => setTimeout(() => rej(new Error('poll timeout')), POLL_TIMEOUT_MS)),
            ]);

            const elapsed = Date.now() - t0;
            diagLog.push({ attempt: thisAttempt, status: result?.status ?? 'null', elapsed });
            if (diagLog.length > 20) diagLog.shift();
            console.log('[SteamLinkDiag] attempt:', thisAttempt, 'status:', result?.status, 'elapsed:', elapsed);
            writeDiag('live_poll');

            if (!active) return;

            const next = _mobileApprovalPollStep(result?.status, thisAttempt, MAX_ATTEMPTS);

            if (next.action === 'resolved') {
                stop();
                if (!win.isDestroyed()) win.close();
                resolve(result);
            } else if (next.action === 'stop') {
                stop();
                injectUiUpdate(next.message, next.reenableButton);
                if (next.writeDiag) writeDiag(next.writeDiag);
            } else {
                if (next.message) injectUiUpdate(next.message);
                setTimeout(poll, POLL_INTERVAL_MS);
            }
        } catch (e) {
            const elapsed = Date.now() - t0;
            diagLog.push({ attempt: thisAttempt, status: 'exception', error: e.message, elapsed });
            if (diagLog.length > 20) diagLog.shift();
            console.error('[SteamLinkDiag] poll exception:', e.message);
            writeDiag('poll_exception');
            if (active) setTimeout(poll, POLL_INTERVAL_MS);
        }
    };

    // Disable button and show initial status
    if (!win.isDestroyed()) {
        win.webContents.executeJavaScript(`
            (function(){
                var el = document.querySelector('#steamGuardConfirm .waiting-status span');
                if (el) el.textContent = 'Waiting for your approval. This will continue automatically.';
                var btn = document.getElementById('continueBtn');
                if (btn) { btn.disabled = true; btn.style.opacity = '0.45'; }
            })();
        `).catch(() => {});
    }

    setTimeout(poll, POLL_INTERVAL_MS);
    return stop;
}

// --- QR Login Flow -------------------------------------------
//
// Starts a QR auth session: generates a QR image, loads the steam_qr view,
// and polls until authenticated, expired, or denied.
// onStop(stopFn) is called immediately with a cancellation function.

async function _startQrLoginFlow(win, resolve, reject, onStop) {
    const qrPollingLoop = createSteamQrPollingLoop({
        pollSteamAuth: () => steamBridge.pollSteamAuth(),
        isWindowDestroyed: () => !win || win.isDestroyed(),
        closeWindow: () => win.close(),
        resolve,
        reject,
        restart: () => _startQrLoginFlow(win, resolve, reject, onStop),
        logger: console,
        setTimeoutFn: setTimeout,
        clearTimeoutFn: clearTimeout,
    });
    if (typeof onStop === 'function') onStop(qrPollingLoop.stop);

    let qrData;
    try {
        qrData = await steamBridge.startQrLogin();
    } catch (e) {
        console.error('[QR] startQrLogin failed:', e.message);
        return;
    }

    if (qrData?.status !== 'need_qr' || !qrData.challengeUrl) {
        console.error('[QR] Unexpected status from startQrLogin:', qrData?.status);
        return;
    }

    const { challengeUrl, interval } = qrData;
    const pollIntervalMs = Math.max((interval || 2) * 1000, 2000);

    let qrDataUrl;
    try {
        const QRCode = require('qrcode');
        qrDataUrl = await QRCode.toDataURL(challengeUrl, { width: 200, margin: 1 });
    } catch (e) {
        console.error('[QR] QR code generation failed:', e.message);
        return;
    }

    if (!win || win.isDestroyed()) return;

    try {
        const currentRaw = win.webContents.getURL();
        const currentUrl = new URL(currentRaw);
        currentUrl.searchParams.set('view', 'steam_qr');
        currentUrl.searchParams.delete('errored');
        await win.loadURL(currentUrl.href);
    } catch (e) {
        console.error('[QR] Failed to load steam_qr view:', e.message);
        return;
    }

    try {
        const escaped = qrDataUrl.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        await win.webContents.executeJavaScript(`
            (function(){
                var container = document.getElementById('steamQRCode');
                if (container) {
                    container.innerHTML = '<img src="${escaped}" width="200" height="200" alt="QR Code" style="border-radius:8px;display:block;" />';
                }
                var status = document.querySelector('#steamGuardQR .qr-status');
                if (status) status.textContent = 'Scan with your Steam mobile app';
            })();
        `);
    } catch (e) {
        console.error('[QR] Failed to inject QR image:', e.message);
    }

    qrPollingLoop.start(pollIntervalMs);
}

// --- Steam Login Window ---------------------------------------
//
// steamId = null  ?  ?????? ???? ? ???? ?? force fresh login ??? ?? ???????
//                    authenticated ??????? ????
// steamId = "xxx" ?  re-auth ??????? ????? ???????? credentials ????????

async function _openSteamLoginWindow(parentWindow, steamId = null) {
    const { BrowserWindow } = require('electron');

    return new Promise(async (resolve, reject) => {
        await _ensureBridgeRunning();

        let authResult;

        if (steamId) {
            // - Re-auth ??????? ????? -------------------------
            const storedCreds = steamBridge.getCredentialsForAccount(steamId);
            authResult = await steamBridge.authenticate(storedCreds);

            // ?? ??? authenticated ???? ???????? ? ????
            if (authResult.status === 'authenticated') {
                if (String(authResult.steamId) === String(steamId)) {
                    return resolve(authResult);
                }
                // ??? ??????? ????? ? ????? ????? login
                console.warn(`[SteamBridge] Re-auth returned wrong account: ${authResult.steamId} !== ${steamId}`);
            }
        } else {
            try {
                await steamBridge.logout();
            } catch (e) {
                console.warn('[SteamBridge] Fresh-login logout skipped:', e?.message || e);
            }

            authResult = await steamBridge.authenticate(null);
            console.log('[STEAM-LINK-DEBUG] initial authResult:', JSON.stringify(authResult, null, 2));
        }

        if (authResult.status === 'error') {
            return reject(new Error(authResult.message));
        }

        // ??? ????? ??? Login
        const win = new BrowserWindow({
            width: 520,
            height: 700,
            parent: parentWindow || undefined,
            modal: !!parentWindow,
            autoHideMenuBar: true,
            frame: false,
            transparent: true,
            backgroundColor: '#00000000', // Fully transparent to let index.html handle it
            resizable: false,
            show: false, // Don't show until ready-to-show to avoid white flash
            icon: path.join(__dirname, 'assets', 'app_icon.png'),
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: false,
                webSecurity: false,
                allowRunningInsecureContent: true,
            },
            title: 'Connect Steam',
        });

        win.setMenuBarVisibility(false);
        win.removeMenu();


        win.once('ready-to-show', () => {
            win.show();
        });

        let currentEndUriRegex = authResult.endUriRegex;
        const applySteamSupportTheme = async () => {
            try {
                await win.webContents.insertCSS(`
                    /* -- Reverting to original Steam design -- */
                    /* We only hide the scrollbar and add style for our custom close arrow */
                    
                    ::-webkit-scrollbar { width: 0px; background: transparent; }
                    * { -ms-overflow-style: none; scrollbar-width: none; }

                    #baddel-close-button {
                        position: fixed !important;
                        top: 20px !important;
                        right: 20px !important;
                        width: 40px !important;
                        height: 40px !important;
                        background: #171d25 !important;
                        border: 1px solid #3d4450 !important;
                        border-radius: 50% !important;
                        display: flex !important;
                        align-items: center !important;
                        justify-content: center !important;
                        cursor: pointer !important;
                        color: #c7d5e0 !important;
                        z-index: 999999 !important;
                        box-shadow: 0 4px 15px rgba(0,0,0,0.5) !important;
                        transition: all 0.2s ease !important;
                    }
                    #baddel-close-button:hover {
                        background: #3d4450 !important;
                        color: #ffffff !important;
                        transform: scale(1.05) !important;
                        border-color: #66c0f4 !important;
                    }
                `);
            } catch {}
        };

        const injectNavigationButtons = async () => {
            try {
                await win.webContents.executeJavaScript(`
                    (function() {
                        if (document.getElementById('baddel-close-button')) return;
                        
                        const btn = document.createElement('div');
                        btn.id = 'baddel-close-button';
                        btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
                        btn.title = 'Close';
                        btn.onclick = () => { window.location.href = 'baddel://close'; };
                        
                        document.body.appendChild(btn);
                    })();
                `);
            } catch {}
        };

        let approvalPollStop = null;

        const stopApprovalPoll = () => {
            if (approvalPollStop) { approvalPollStop(); approvalPollStop = null; }
        };

        const handleBaddelAuthUrl = async (url) => {
            const action = url.replace('baddel://auth/', '');
            if (action === 'resend-email') {
                const result = await steamBridge.resendSteamGuardEmail();
                if (result.status === 'need_2fa' && result.resent === true) {
                    currentEndUriRegex = result.endUriRegex;
                    await win.loadURL(result.loginUrl);
                } else if (result.status === 'cooldown') {
                    const seconds = Math.max(1, Number(result.retryAfterSeconds) || 1);
                    await win.webContents.executeJavaScript(`(() => {
                        const link = document.querySelector('#steamGuardEmail .resend-link');
                        if (!link) return;
                        link.textContent = 'Try again in ${seconds}s';
                        setTimeout(() => { link.textContent = 'Resend'; link.style.pointerEvents = ''; }, ${seconds} * 1000);
                    })()`).catch(() => {});
                } else {
                    await win.webContents.executeJavaScript(`(() => {
                        const link = document.querySelector('#steamGuardEmail .resend-link');
                        if (link) { link.textContent = 'Resend failed'; link.style.pointerEvents = ''; }
                    })()`).catch(() => {});
                }
            } else if (action === 'qr-start') {
                stopApprovalPoll();
                await _startQrLoginFlow(win, resolve, reject, (stopFn) => { approvalPollStop = stopFn; });
            } else if (action === 'login-form') {
                stopApprovalPoll();
                const loginUrl = authResult.passwordLoginUrl;
                if (loginUrl) {
                    currentEndUriRegex = authResult.endUriRegex;
                    await win.loadURL(loginUrl);
                }
            }
        };

        const checkUrl = async (url) => {
            if (!currentEndUriRegex) return;
            const regex = new RegExp(currentEndUriRegex);
            if (!regex.test(url)) return;

            // User manually submitted while polling ? stop poll, let checkUrl own this
            stopApprovalPoll();

            try {
                const urlObj = new URL(url);
                const params = {};
                urlObj.searchParams.forEach((v, k) => { params[k] = v; });

                const result = await steamBridge.passLoginCredentials(url, params);

                if (result.status === 'authenticated') {
                    win.close();
                    resolve(result);
                } else if (result.status === 'need_2fa' || result.status === 'need_login') {
                    currentEndUriRegex = result.endUriRegex;
                    await win.loadURL(result.loginUrl);
                    if (result.method === 'confirm') {
                        approvalPollStop = _startMobileApprovalPolling(win, resolve, reject);
                    }
                } else {
                    win.close();
                    reject(new Error(result.message || 'Steam login failed'));
                }
            } catch (e) {
                win.close();
                reject(e);
            }
        };

        win.webContents.setWindowOpenHandler(({ url }) => {
            if (url.includes('help.steampowered.com')) {
                win.loadURL(url);
                return { action: 'deny' };
            }
            return { action: 'deny' };
        });

        win.webContents.on('will-navigate', (_e, url) => {
            if (url === 'baddel://close') {
                _e.preventDefault();
                win.close();
                return;
            }
            if (url.startsWith('baddel://auth/')) {
                _e.preventDefault();
                handleBaddelAuthUrl(url);
                return;
            }
            if (url.includes('help.steampowered.com')) {
                return;
            }
            _e.preventDefault();
            checkUrl(url);
        });

        win.webContents.on('did-navigate', (_e, url) => {
            if (url.includes('help.steampowered.com')) {
                applySteamSupportTheme();
                injectNavigationButtons();
                return;
            }
            checkUrl(url);
        });

        win.webContents.on('did-navigate-in-page', (_e, url) => checkUrl(url));
        win.on('closed', () => reject(new Error('Steam login window closed.')));

        try {
            await win.loadURL(authResult.loginUrl);
        } catch (err) {
            console.error('[SteamBridge] Failed to load login URL:', err);
            win.close();
             return reject(new Error('Could not connect to Steam. Please check your internet connection.'));
         }
         // win.webContents.openDevTools({ mode: 'detach' });
     });
 }

// --- steamConnector -------------------------------------------

const steamConnectorMethods = {
    isLinked() {
        return syncCacheRepository.isSteamLinked();
    },

    getAccounts() {
        return syncCacheRepository.readSteamAccountsSync()
            .map((a) => ({ ...a, id: String(a.id) }));
    },

    async link(parentWindow) {
        analytics.logAccountAddStarted?.('steam', 'platform_sync')?.catch?.(() => {});
        steamAuthLog('[PlatformSync:Steam] link:start');
        await ensureDirs();
        steamAuthLog('[PlatformSync:Steam] ensureDirs:ok');
        try {
            await _ensureBridgeRunning();
        } catch (err) {
            console.error('[PlatformSync:Steam] Failed to start Steam bridge:', err);
            const e = new Error(`Steam bridge failed to start: ${err.message || err}`);
            e.code = 'STEAM_BRIDGE_START_FAILED';
            throw e;
        }
        steamAuthLog('[PlatformSync:Steam] bridge:running');

        const authResult = await _openSteamLoginWindow(parentWindow, null);
        steamAuthLog('[PlatformSync:Steam] auth window returned:', authResult?.status);

        if (authResult.status !== 'authenticated') {
            throw new Error('Steam authentication failed');
        }

        const { steamId, personaName } = authResult;
        const steamIdStr  = String(steamId);
        const displayName = personaName || `Steam ${steamIdStr.slice(-6)}`;

        // Wait for the Python bridge to emit store_credentials for this account.
        // Required so that syncLibrary() can authenticate after an app restart.
        const storedCreds = await steamBridge.waitForCredentials(steamIdStr, 12_000);
        if (!storedCreds) {
            steamAuthLog(`[PlatformSync:Steam] ? Credentials not confirmed for ${steamIdStr} within 12s ? account will require reconnect on next sync`);
        } else {
            steamAuthLog(`[PlatformSync:Steam] ? Credentials confirmed for ${steamIdStr}`);
        }

        const now = new Date().toISOString();
        let accounts = this.getAccounts();
        const existingIndex = accounts.findIndex(a => String(a.id) === steamIdStr);

        const accountEntry = {
            id:               steamIdStr,
            displayName,
            status:           'linked',
            credentialStatus: storedCreds ? 'ok' : 'pending',
            needsReauth:      !storedCreds,
            lastLinkedAt:     now,
            // Preserve lastSyncedAt and gamesCount from a previous link if present
            ...(existingIndex > -1
                ? { lastSyncedAt: accounts[existingIndex].lastSyncedAt,
                    gamesCount:   accounts[existingIndex].gamesCount }
                : {}),
        };

        if (existingIndex > -1) {
            accounts[existingIndex] = { ...accounts[existingIndex], ...accountEntry };
        } else {
            accounts.push(accountEntry);
        }

        if (accounts.length === 0) {
            console.error('[PlatformSync:Steam] Account list is empty after linking ? blocking save');
            throw new Error('Failed to update account list.');
        }

        await syncCacheRepository.writeSteamAccountsAtomic(accounts);
        await _writeSwitcherSyncLink('steam', displayName, steamIdStr, { steamDisplayName: displayName });

        steamAuthLog(`[PlatformSync:Steam] ? Linked ${displayName} (${steamIdStr}) credentialStatus=${accountEntry.credentialStatus}`);
        analytics.logPlatformLinked('steam').catch(() => {});
        return { displayName, steamId: steamIdStr };
    },

    async syncLibrary(targetAccountId = null, opts = {}) {
        const syncRunId = opts?.__syncRunId || null;
        await ensureDirs();
        const allAccounts = this.getAccounts();
        if (allAccounts.length === 0) throw new Error('No Steam accounts linked.');

        let accountsToSync = [...allAccounts];
        if (targetAccountId) {
            const target = allAccounts.find(a => String(a.id) === String(targetAccountId));
            if (target) {
                accountsToSync = [target];
            } else {
                syncWarn(`[PlatformSync] Target account ${targetAccountId} not found in linked accounts, syncing all.`);
            }
        }

        await _ensureBridgeRunning();

        const initialSessionSteamId = String(steamBridge.getLastSessionSteamId?.() || '');
        const orderedAccounts = orderAccountsForSync(accountsToSync, initialSessionSteamId);
        const previousGames = await this.getCachedLibrary();
        const mergedLibrary = new Map();
        const accountResults = {};
        let completedAccounts = 0;

        _startPlatformSync('steam', orderedAccounts, `Syncing Steam library for ${orderedAccounts.length} account(s)`);
        analytics.logSyncStarted?.('steam', orderedAccounts.length, targetAccountId ? 'single_account' : 'library')?.catch?.(() => {});

        // For targeted sync: add non-target accounts to the state with clean terminal status.
        // Never restore transient (queued/pending/syncing/etc.) states from a previous run.
        if (targetAccountId) {
            for (const account of allAccounts) {
                const aid = String(account.id);
                if (orderedAccounts.some(a => String(a.id) === aid)) continue;
                const prevCount = countGamesForAccount('steam', previousGames, aid);
                const terminal = computeTerminalAccountStatus(account, prevCount);
                _updatePlatformSyncAccount('steam', aid, {
                    id: aid,
                    displayName: account.displayName || aid,
                    gamesCount: prevCount,
                    gameTitles: [],
                    startedAt: null,
                    finishedAt: null,
                    ...terminal,
                });
            }
        }

        for (const account of orderedAccounts) {
            _updatePlatformSyncAccount('steam', account.id, {
                gamesCount: countGamesForAccount('steam', previousGames, account.id),
                message: 'Queued for sync',
            });
        }

        try {
            for (const account of orderedAccounts) {
                const aid = String(account.id);
                const previousCount = countGamesForAccount('steam', previousGames, aid);
                _updatePlatformSyncProgress('steam', {
                    completedAccounts,
                    totalAccounts: orderedAccounts.length,
                    currentAccountId: aid,
                    currentAccountName: account.displayName,
                });
                _setPlatformSyncState('steam', (state) => {
                    state.phase = 'sync_account';
                    state.statusText = `Syncing ${account.displayName}`;
                    return state;
                });
                _updatePlatformSyncAccount('steam', aid, {
                    status: 'syncing',
                    startedAt: new Date().toISOString(),
                    finishedAt: null,
                    gamesCount: previousCount,
                    message: 'Authenticating with Steam',
                });
                _pushPlatformSyncLog('steam', 'info', `Authenticating ${account.displayName}`, {
                    accountId: aid,
                    accountName: account.displayName,
                });

                try {
                    let authResult = null;
                    const creds = steamBridge.getCredentialsForAccount(account.id);

                    if (creds) {
                        authResult = await steamBridge.authenticate(creds, { waitForCache: false });
                    } else if (initialSessionSteamId && initialSessionSteamId === aid) {
                        authResult = {
                            status: 'authenticated',
                            steamId: initialSessionSteamId,
                        };
                        _pushPlatformSyncLog('steam', 'warn', `Using active Steam session for ${account.displayName} until credentials are stored`, {
                            accountId: aid,
                            accountName: account.displayName,
                        });
                    } else {
                        // Mark account as needing reauth so the UI shows "Reconnect required"
                        // and we stop pretending the account is fully linked.
                        const savedAccts = this.getAccounts();
                        const acctIdx = savedAccts.findIndex(a => String(a.id) === aid);
                        if (acctIdx > -1) {
                            savedAccts[acctIdx] = {
                                ...savedAccts[acctIdx],
                                needsReauth:      true,
                                credentialStatus: 'missing',
                                status:           'needs_reauth',
                            };
                            await syncCacheRepository.writeSteamAccountsAtomic(savedAccts);
                        }
                        accountResults[aid] = { status: 'warning', rawGamesCount: 0, validationFailed: true, allowZeroGames: false };
                        _updatePlatformSyncAccount('steam', aid, {
                            status: 'warning',
                            finishedAt: new Date().toISOString(),
                            gamesCount: previousCount,
                            message: 'Steam session expired. Reconnect this account.',
                        });
                        _pushPlatformSyncLog('steam', 'warn', `Skipping ${account.displayName} ? no stored credentials found. Account needs reauth.`, {
                            accountId: aid,
                            accountName: account.displayName,
                        });
                        continue;
                    }

                    if (authResult.status !== 'authenticated') {
                        accountResults[aid] = { status: 'warning', rawGamesCount: 0, validationFailed: true };
                        _updatePlatformSyncAccount('steam', aid, {
                            status: 'warning',
                            finishedAt: new Date().toISOString(),
                            gamesCount: previousCount,
                            message: 'Authentication did not complete. Cached data will be kept.',
                        });
                        _pushPlatformSyncLog('steam', 'warn', `${account.displayName} is not authenticated`, {
                            accountId: aid,
                            accountName: account.displayName,
                        });
                        continue;
                    }

                    if (authResult.steamId && String(authResult.steamId) !== aid) {
                        syncWarn(`[Sync:${account.displayName}] AUTH MISMATCH ? expected ${aid}, got ${authResult.steamId}. Skipping game fetch, preserving cache.`);
                        _pushPlatformSyncLog('steam', 'warn', `Steam session mismatch for ${account.displayName}: expected ${aid}, got ${authResult.steamId}. Cached library preserved.`, {
                            accountId: aid,
                            accountName: account.displayName,
                        });
                        accountResults[aid] = { status: 'warning', rawGamesCount: 0, validationFailed: true, allowZeroGames: false };
                        _updatePlatformSyncAccount('steam', aid, {
                            status: 'warning',
                            finishedAt: new Date().toISOString(),
                            gamesCount: previousCount,
                            message: 'Steam session returned the wrong account. Cached data will be kept.',
                        });
                        continue;
                    }

                    _updatePlatformSyncAccount('steam', aid, {
                        status: 'syncing',
                        gamesCountKnown: previousCount > 0 || !!account.lastSyncedAt,
                        message: 'Loading owned games',
                    });

                    steamAuthLog(`[Sync:${account.displayName}] cacheIsReady=${steamBridge._cacheIsReady} calling progress-aware waitForCacheReady(targetId=${aid})`);
                    let lastLoggedRevision = null;
                    const readyCollection = await steamBridge.waitForCacheReady(aid, {
                        inactivityMs: 60_000,
                        overallMs: 10 * 60_000,
                        maxRecoveryAttempts: 2,
                        onProgress: (snapshot) => {
                            const completeness = snapshot?.completeness || {};
                            const revision = completeness.progressRevision;
                            _updatePlatformSyncAccount('steam', aid, {
                                status: 'syncing',
                                gamesCountKnown: previousCount > 0 || !!account.lastSyncedAt,
                                message: completeness.expectedApps > 0
                                    ? `Loading Steam library: ${completeness.resolvedApps || 0}/${completeness.expectedApps} records`
                                    : 'Discovering Steam licenses',
                            });
                            if (revision !== lastLoggedRevision) {
                                lastLoggedRevision = revision;
                                _pushPlatformSyncLog('steam', 'info', 'Steam collection progress', {
                                    accountId: aid,
                                    sessionGeneration: snapshot?.sessionGeneration,
                                    expectedPackages: completeness.expectedPackages,
                                    receivedPackages: completeness.completedPackages,
                                    pendingPackages: completeness.pendingPackages,
                                    expectedApps: completeness.expectedApps,
                                    receivedApps: completeness.receivedApps,
                                    resolvedApps: completeness.resolvedApps,
                                    pendingApps: completeness.pendingApps,
                                    failedApps: completeness.failedApps,
                                    recoveryAttempts: snapshot?.recoveryAttempts || 0,
                                    lastProgressKind: completeness.lastProgressKind,
                                    runtime: snapshot?.runtime,
                                    transport: snapshot?.transport,
                                });
                            }
                        },
                    });

                    // Re-check session after waiting: a concurrent auth may have switched accounts.
                    const postWaitSession = String(steamBridge.getLastSessionSteamId?.() || '');
                    if (postWaitSession && postWaitSession !== aid) {
                        steamAuthLog(`[Sync:${account.displayName}] Post-wait session mismatch: session is now ${postWaitSession}, expected ${aid}. Skipping getOwnedGames.`);
                        _pushPlatformSyncLog('steam', 'warn', `Steam session changed while waiting for cache (expected ${aid}, now ${postWaitSession}). Cached library preserved.`, {
                            accountId: aid,
                            accountName: account.displayName,
                        });
                        accountResults[aid] = { status: 'warning', rawGamesCount: 0, validationFailed: true, allowZeroGames: false };
                        _updatePlatformSyncAccount('steam', aid, {
                            status: 'warning',
                            finishedAt: new Date().toISOString(),
                            gamesCount: previousCount,
                            message: 'Steam session changed during sync. Cached data will be kept.',
                        });
                        continue;
                    }

                    steamAuthLog(`[Sync:${account.displayName}] ? waitForCacheReady done ? fetching games`);

                    const { result, rawGamesCount } = await fetchSteamOwnedGamesWithRetry(
                        account, previousCount, initialSessionSteamId, readyCollection.sessionGeneration
                    );
                    const resultAccountId = String(result?.steamAccountId || '');
                    const authoritative = result?.status === 'success' && result?.complete === true && resultAccountId === aid;
                    if (!authoritative) {
                        accountResults[aid] = {
                            status: result?.status === 'partial' ? 'partial' : 'error', rawGamesCount, previousCount,
                            reachedFetch: true, authoritative: false, validationFailed: true,
                            completeness: result?.completeness || null,
                        };
                        const friendlyError = createFriendlySyncError('steam', result?.message || 'Failed to load owned games');
                        _updatePlatformSyncAccount('steam', aid, {
                            status: 'error',
                            finishedAt: new Date().toISOString(),
                            gamesCount: previousCount,
                            message: result?.status === 'partial'
                                ? 'Steam returned an incomplete library. Cached ownership was preserved.'
                                : friendlyError.userMessage,
                        });
                        _pushPlatformSyncLog('steam', 'error', `getOwnedGames failed for ${account.displayName}: ${friendlyError.diagnosticMessage}`, {
                            accountId: aid,
                            accountName: account.displayName,
                        });
                        continue;
                    }

                    _pushPlatformSyncLog('steam', 'info', `Fetched ${rawGamesCount} owned games for ${account.displayName}`, {
                        accountId: aid,
                        accountName: account.displayName,
                    });

                    const ownedGames = await buildSteamOwnedGameEntries(account, result.games);
                    mergeOwnedGamesIntoLibrary(mergedLibrary, ownedGames, account, 'steam');
                    // NOTE: metadata sync is deferred to the single post-finalization call on finalGames.

                    const accountStatus = rawGamesCount > 0 ? 'success' : (previousCount > 0 ? 'warning' : 'success');

                    // Store rawGamesCount and previousCount so the finalization pass can
                    // build the definitive user-visible message once finalCount is known.
                    accountResults[aid] = {
                        status:          accountStatus,
                        rawGamesCount,
                        previousCount,
                        reachedFetch:    true,
                        validationFailed: rawGamesCount === 0 && previousCount > 0,
                        allowZeroGames:  true,
                        authoritative:   true,
                        gamesCountKnown:  true,
                        completeness:    result.completeness,
                        sessionGeneration: result.sessionGeneration,
                    };

                    // Interim message ? finalization will replace it with the final
                    // count-aware message once deduplicated counts are available.
                    const interimMessage = rawGamesCount > 0
                        ? `Fetched ${rawGamesCount} entries; finalizing library?`
                        : (previousCount > 0 ? 'Steam returned 0 entries; preserving cached library?' : 'No owned games found');

                    _updatePlatformSyncAccount('steam', aid, {
                        status:    accountStatus,
                        finishedAt: new Date().toISOString(),
                        gamesCount: rawGamesCount > 0 ? rawGamesCount : previousCount,
                        gameTitles: summarizeGameTitles(result.games),
                        message:   interimMessage,
                    });
                    // steam_accounts.json persistence is deferred to the finalization
                    // pass so gamesCount reflects the deduplicated final library count.
                } catch (err) {
                    accountResults[aid] = { status: 'error', rawGamesCount: 0, validationFailed: true };
                    const friendlyError = createFriendlySyncError('steam', err);
                    _updatePlatformSyncAccount('steam', aid, {
                        status: 'error',
                        finishedAt: new Date().toISOString(),
                        gamesCount: previousCount,
                        message: friendlyError.userMessage,
                    });
                    _pushPlatformSyncLog('steam', 'error', `Failed to sync ${account.displayName}: ${friendlyError.diagnosticMessage}`, {
                        accountId: aid,
                        accountName: account.displayName,
                        errorCode: err?.code || null,
                        collectionDiagnostics: err?.collectionDiagnostics || null,
                    });
                } finally {
                    completedAccounts += 1;
                    _updatePlatformSyncProgress('steam', {
                        completedAccounts,
                        totalAccounts: orderedAccounts.length,
                        currentAccountId: aid,
                        currentAccountName: account.displayName,
                    });
                }
            }

            _setPlatformSyncState('steam', (state) => {
                state.phase = 'merge_local';
                state.statusText = 'Merging local Steam installs';
                return state;
            });
            _pushPlatformSyncLog('steam', 'info', 'Merging locally installed Steam games');

            const localGames = await gamesSyncAdapter.getLocalSteamGames().catch((err) => {
                _pushPlatformSyncLog('steam', 'warn', `Failed to read local Steam manifests: ${err.message}`);
                return [];
            });
            let addedFromLocal = 0;

            for (const game of localGames) {
                const gameId = `steam_${game.appid}`;
                if (mergedLibrary.has(gameId)) {
                    const existing = mergedLibrary.get(gameId);
                    if (!existing.steamLicensedAccountIds) existing.steamLicensedAccountIds = [];
                } else {
                    addedFromLocal++;
                    mergedLibrary.set(gameId, {
                        id:                      gameId,
                        title:                   game.name,
                        platform:                'steam',
                        source:                  'steam',
                        coverUrl:                null,
                        heroUrl:                 null,
                        logoUrl:                 null,
                        appName:                 String(game.appid),
                        playtime:                0,
                        lastSynced:              new Date().toISOString(),
                        ownedBy:                 [],
                        ownedByAccountIds:       [],
                        steamLicensedAccountIds: [],
                        installOnly:             true,
                    });
                }
            }

            // Local install-only games are kept in the library as installOnly:true but are NOT
            // attributed to any account ? detected installs are not evidence of licensed ownership.
            // The fallbackLocalAccount / steamDetectedAccountIds attribution block has been removed.
            // countGamesForAccount() and the UI helpers must not treat steamDetectedAccountIds as ownership.

            const finalizeStart = performance.now();
            const finalized = finalizeLibraryForAccounts({
                platform: 'steam',
                previousGames,
                nextGames: Array.from(mergedLibrary.values()),
                accounts: allAccounts,
                accountResults,
            });
            const finalGames = finalized.games;
            _syncTraceStage(syncRunId, "merge.finalize", finalizeStart, { previousGames: previousGames.length, nextGames: mergedLibrary.size, finalGames: finalGames.length });
            const summary = {
                totalGames: finalGames.length,
                installOnlyGames: finalGames.filter((game) => game.installOnly).length,
                sampleTitles: summarizeGameTitles(finalGames, 5),
            };

            const authoritativeAccountUpdates = [];
            for (const account of allAccounts) {
                const aid          = String(account.id);
                const existingState = _getPlatformSyncState('steam').accounts?.[aid] || {};
                const accountGames = finalGames.filter((game) => steamGameBelongsToAccount(game, aid));
                const finalCount   = finalized.validation.countsByAccount?.[aid] ?? existingState.gamesCount ?? 0;

                const patch = {
                    gamesCount: finalCount,
                    gamesCountKnown: accountResults[aid]?.authoritative === true || finalCount > 0 || !!account.lastSyncedAt,
                    gameTitles: summarizeGameTitles(accountGames),
                };

                if (accountResults[aid]?.reachedFetch) {
                    // Account was actively fetched this sync ? compute the definitive message
                    // now that the deduplicated final count is known.
                    const rawCount  = accountResults[aid].rawGamesCount ?? 0;
                    const prevCount = accountResults[aid].previousCount
                        ?? countGamesForAccount('steam', previousGames, aid);

                    patch.message = computeSteamSyncMessage(rawCount, finalCount, prevCount);
                    patch.status  = accountResults[aid].authoritative === true ? 'finalizing' : 'warning';
                    patch.finishedAt = new Date().toISOString();

                    console.log(`[PlatformSync:Steam] ${account.displayName}: raw=${rawCount}, final=${finalCount}, previous=${prevCount}`);
                    _pushPlatformSyncLog('steam', 'info',
                        `${account.displayName}: raw=${rawCount}, final=${finalCount}, previous=${prevCount}`,
                        { accountId: aid, accountName: account.displayName });

                    if (accountResults[aid].authoritative === true) {
                        authoritativeAccountUpdates.push({ aid, finalCount });
                    }
                } else {
                    // Non-fetched account (not the sync target, or auth failed before fetch).
                    // Apply a clean terminal status ? never leave transient state after sync ends.
                    const existingStatus = _getPlatformSyncState('steam').accounts?.[aid]?.status;
                    if (!existingStatus || TRANSIENT_SYNC_STATUSES.has(existingStatus)) {
                        const terminal = computeTerminalAccountStatus(account, finalCount);
                        patch.status = terminal.status;
                        patch.message = terminal.message;
                        patch.finishedAt = new Date().toISOString();
                    }
                    // Preserve non-transient terminal status (e.g. 'error') set in the main loop.
                }

                _updatePlatformSyncAccount('steam', aid, patch);
            }

            for (const issue of finalized.validation.issues || []) {
                _pushPlatformSyncLog('steam', 'warn', issue);
            }

            const writeStart = performance.now();
            const steamCommitSnapshot = await syncCacheRepository.writeSteamMergedLibrary(finalGames);
            if (authoritativeAccountUpdates.length > 0) {
                const savedAccounts = this.getAccounts();
                const completedAt = new Date().toISOString();
                for (const update of authoritativeAccountUpdates) {
                    const index = savedAccounts.findIndex(account => String(account.id) === update.aid);
                    if (index < 0) continue;
                    savedAccounts[index] = {
                        ...savedAccounts[index], lastSyncedAt: completedAt,
                        gamesCount: update.finalCount, needsReauth: false,
                        credentialStatus: 'ok', status: 'synced',
                    };
                }
                await syncCacheRepository.writeSteamAccountsAtomic(savedAccounts);
                for (const update of authoritativeAccountUpdates) {
                    _updatePlatformSyncAccount('steam', update.aid, { status: 'synced', finishedAt: completedAt });
                }
            }
            _syncTraceStage(syncRunId, "commit.atomic-write", writeStart, { changed: steamCommitSnapshot?.changed !== false, diagnostics: steamCommitSnapshot?.writeDiagnostics || null });
            await _emitPlatformLibraryCommitted('steam', undefined, { syncRunId, snapshot: steamCommitSnapshot });

            // -- Cover-first image caching (fire-and-forget) -------------------
                        _recordPostSyncArtworkWarmupSkipped(syncRunId, 'steam', finalGames);

            // -- Send to Baddel server in background --------------------------
            _pushPlatformSyncLog('steam', 'info', 'Sending library to Baddel server...');
            _importLibraryToServer('steam', finalGames).catch(err =>
                _pushPlatformSyncLog('steam', 'warn', `Baddel server import failed: ${err.message}`)
            );

            _updatePlatformSyncProgress('steam', {
                completedAccounts: orderedAccounts.length,
                totalAccounts: orderedAccounts.length,
                currentAccountId: null,
                currentAccountName: null,
            });
            // Build a statusText appropriate to whether this was a targeted or full sync.
            const targetAccount = targetAccountId
                ? orderedAccounts.find(a => String(a.id) === String(targetAccountId)) : null;
            const targetFinalCount = targetAccount
                ? (finalized.validation.countsByAccount?.[String(targetAccountId)] ?? 0) : null;
            const hasIncompleteAccounts = Object.values(accountResults).some(result => result.authoritative !== true);
            const hasFinalIssues = finalized.validation.issues.length > 0 || hasIncompleteAccounts;
            const finishStatusText = targetAccount
                ? (accountResults[String(targetAccount.id)]?.authoritative === true
                    ? `${targetAccount.displayName} sync completed. ${targetFinalCount} games synced. Steam library: ${finalGames.length} total.`
                    : `${targetAccount.displayName} sync incomplete. Cached library preserved with ${targetFinalCount} games.`)
                : (hasFinalIssues
                    ? `Steam sync incomplete. Cached ownership preserved; ${finalGames.length} games remain available.`
                    : `Steam sync completed. ${finalGames.length} games ready.`);

            _finishPlatformSync('steam', {
                syncRunId,
                phase: hasIncompleteAccounts ? 'partial' : 'done',
                statusText: finishStatusText,
                validation: finalized.validation,
                summary,
                targetAccountId: targetAccountId || null,
            });
            _pushPlatformSyncLog('steam', 'info', `Steam sync finished with ${finalGames.length} games and ${addedFromLocal} local-only additions`);
            analytics.logSyncCompleted('steam', finalGames.length, orderedAccounts.length).catch(() => {});
            return finalGames;
        } catch (err) {
            // On failure, clean transient states for non-target accounts so they are never
            // left stuck as Queued/Pending.
            if (targetAccountId) {
                for (const account of allAccounts) {
                    const aid = String(account.id);
                    if (orderedAccounts.some(a => String(a.id) === aid)) continue;
                    const prevCount = countGamesForAccount('steam', previousGames, aid);
                    const terminal = computeTerminalAccountStatus(account, prevCount);
                    _updatePlatformSyncAccount('steam', aid, {
                        ...terminal,
                        gamesCount: prevCount,
                        finishedAt: new Date().toISOString(),
                    });
                }
            }
            _finishPlatformSync('steam', {
                syncRunId,
                phase: 'error',
                statusText: `Steam sync failed: ${err.message}`,
                lastError: err.message,
            });
            _pushPlatformSyncLog('steam', 'error', `Steam sync crashed: ${err.message}`);
            analytics.logSyncFailed('steam', err.message).catch(() => {});
            throw err;
        }
    },

    async getCachedLibrary() {
        return syncCacheRepository.readSteamMergedLibrary();
    },

    async unlink(accountId) {
        let accounts = this.getAccounts();
        const removedAccount = accountId
            ? accounts.find((account) => String(account.id) === String(accountId)) || null
            : null;

        if (accountId) {
            accounts = accounts.filter(a => a.id !== accountId);
            steamBridge.deleteCredentialsForAccount(accountId);
        } else {
            for (const acc of accounts) steamBridge.deleteCredentialsForAccount(acc.id);
            accounts = [];
        }

        await syncCacheRepository.writeSteamAccounts(accounts);

        if (accounts.length === 0) {
            await syncCacheRepository.deleteSteamMergedLibrary();
            await _emitPlatformLibraryCommitted('steam');
            if (steamBridge.isRunning) await steamBridge.stop();
            _bridgeStarted = false;
        } else if (removedAccount) {
            const cachedGames = await this.getCachedLibrary();
            const filteredGames = removeAccountFromLibrary('steam', cachedGames, removedAccount);
            await syncCacheRepository.writeSteamMergedLibrary(filteredGames);
            await _emitPlatformLibraryCommitted('steam');
        }
        analytics.logPlatformUnlinked('steam').catch(() => {});
    },
};


// ============================================================
// --- EPIC CONNECTOR -----------------------------------------
// ============================================================

function getLegendaryConfPath(accountId) {
    return path.join(app.getPath('userData'), `legendary-config-${accountId}`);
}

let _epicActiveAccountIds = null;
let _epicIdentityWriteQueue = Promise.resolve();
async function getEpicAccountsList() {
    const accounts = await syncCacheRepository.readEpicAccounts();
    _epicActiveAccountIds = new Set((accounts || []).map((account) => String(account?.id || '')).filter(Boolean));
    return accounts;
}

async function saveEpicAccountsList(accounts) {
    await syncCacheRepository.writeEpicAccounts(accounts);
    _epicActiveAccountIds = new Set((accounts || []).map((account) => String(account?.id || '')).filter(Boolean));
}

function _classifyLegendaryStderr(value) {
    const text = String(value || '').toLowerCase();
    if (!text) return 'none';
    if (/timed? out|timeout/.test(text)) return 'timeout';
    if (/not found|no such file|enoent/.test(text)) return 'missing_file';
    if (/unauthori[sz]ed|forbidden|invalid.*code|exchange.*fail/.test(text)) return 'authorization_rejected';
    if (/network|connect|socket|dns|tls|certificate/.test(text)) return 'network';
    return 'command_failed';
}
function _legendarySafeSummary(details = {}) {
    if (details.timeout) return 'Legendary command timed out.';
    if (details.executableExists === false) return 'Legendary executable is missing.';
    if (details.signal) return `Legendary command ended with signal ${details.signal}.`;
    if (Number.isInteger(details.exitCode)) return `Legendary command exited with code ${details.exitCode}.`;
    return 'Legendary command could not be started.';
}
function _attachLegendaryDiagnostics(error, details) {
    const target = error instanceof Error ? error : new Error('Legendary command failed.');
    target.legendaryDiagnostics = { ...details };
    target.safeSummary = _legendarySafeSummary(details);
    return target;
}
function runLegendary(args, configPath, timeoutMs = 45_000) {
    return new Promise((resolve, reject) => {
        const runtime = inspectLegendaryRuntime({ projectRoot: __dirname, resourcesPath: process.resourcesPath, isPackaged: app.isPackaged });
        const base = {
            command: String(args?.[0] || 'unknown'), executableExists: runtime.exists === true,
            mode: runtime.isPackaged ? 'packaged' : 'development', exitCode: null, signal: null,
            timeout: false, stderrClassification: 'none',
            configDirectoryCreated: fsSync.existsSync(configPath),
            userJsonExists: fsSync.existsSync(path.join(configPath, 'user.json')),
        };
        syncLog('[Epic Legendary Runtime]', { isPackaged: runtime.isPackaged, resourcesPath: runtime.resourcesPath, legendaryPath: runtime.legendaryPath, exists: runtime.exists });
        if (!runtime.exists) return reject(_attachLegendaryDiagnostics(createLegendaryRuntimeMissingError(runtime.legendaryPath), base));
        const env = { ...process.env, LEGENDARY_CONFIG_PATH: configPath };
        const proc = spawn(runtime.legendaryPath, args, { env, shell: false, windowsHide: true });
        let settled = false, out = '', err = '';
        const finishError = (error, fields = {}) => _attachLegendaryDiagnostics(error, {
            ...base, ...fields, stderrClassification: fields.stderrClassification || _classifyLegendaryStderr(err),
            userJsonExists: fsSync.existsSync(path.join(configPath, 'user.json')),
        });
        const timer = setTimeout(() => {
            if (settled) return; settled = true; try { proc.kill(); } catch {}
            reject(finishError(new Error('Legendary command timed out.'), { timeout: true }));
        }, timeoutMs);
        proc.stdout?.on('data', (data) => { out += data; });
        proc.stderr?.on('data', (data) => { err += data; });
        proc.on('close', (code, signal) => {
            if (settled) return; settled = true; clearTimeout(timer);
            if (code === 0) return resolve(out);
            reject(finishError(new Error('Legendary command failed.'), { exitCode: Number.isInteger(code) ? code : null, signal: signal || null }));
        });
        proc.on('error', (error) => {
            if (settled) return; settled = true; clearTimeout(timer);
            const missing = error?.code === 'ENOENT';
            reject(finishError(missing ? createLegendaryRuntimeMissingError(runtime.legendaryPath) : new Error('Failed to start Legendary command.'), {
                executableExists: missing ? false : base.executableExists,
                stderrClassification: _classifyLegendaryStderr(error?.code || ''),
            }));
        });
    });
}function pickSafeEpicResponseHeaders(headers = {}) {
    const safe = {};
    const allowed = new Set(['content-type', 'content-length', 'server']);
    for (const [key, value] of Object.entries(headers || {})) {
        const normalized = String(key || '').toLowerCase();
        if (allowed.has(normalized)) safe[normalized] = value;
    }
    return safe;
}
function _safeEpicLogUrl(value) {
    try {
        const parsed = new URL(String(value || ''));
        return `${parsed.origin}${parsed.pathname}`;
    } catch {
        return '[invalid Epic URL]';
    }
}

function openEpicLoginWindow(parentWindow, options = {}) {
    return new Promise((resolve, reject) => {
        let codeFound = false;
        let settled   = false;
        let activeRequests = 0;
        let lastNetworkActivityAt = Date.now();
        let captureInProgress = false;
        let loginDeadlineTimer = null;
        const sessionId = Date.now();

        async function waitForSessionReady() {
            const deadline = Date.now() + 4000;
            while (Date.now() < deadline) {
                if (activeRequests === 0 && Date.now() - lastNetworkActivityAt >= 300) return;
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
        }

        function log(level, msg, extra = '') {
            const line = `[Epic Login][${sessionId}] ${msg}${extra ? ' | ' + extra : ''}`;
            if (level === 'error') console.error(line);
            else if (level === 'warn')  syncWarn(line);
            else if (level === 'verbose') verboseLog(line);
            else                        syncLog(line);
        }
        function settle(fn) {
            if (settled) return;
            settled = true;
            if (loginDeadlineTimer) clearTimeout(loginDeadlineTimer);
            fn();
        }
        function diagnose(stage, details = {}) {
            try { options.onDiagnostic?.({ stage, ...details }); } catch (_) {}
        }

        const { session: electronSession } = require('electron');

        const partitionName = options.partitionName || `epic-login-${sessionId}`;
        log('verbose', `Using isolated Epic session: ${partitionName}`);
        diagnose('login_partition_selected');
        syncLog('[Epic Login] Opening sign-in window');
        const epicSession = options.epicSession || electronSession.fromPartition(partitionName, { cache: false });

        const win = new BrowserWindow({
            width: 480, height: 660, parent: parentWindow || undefined,
            modal: options.modal !== false && !!parentWindow,
            frame: false, backgroundColor: '#121212',
            show: false,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: false,
                session: epicSession,
            },
            title: 'Connect Epic Games',
        });

        const cancelLogin = () => {
            const error = options.signal?.reason instanceof Error ? options.signal.reason : epicHistoryError(EPIC_HISTORY_ERROR_CODES.CANCELLED, 'Epic sign-in cancelled.');
            settle(() => reject(error));
            if (!win.isDestroyed()) win.destroy();
        };
        if (options.signal?.aborted) cancelLogin();
        else options.signal?.addEventListener?.('abort', cancelLogin, { once: true });

        win.once('ready-to-show', () => {
            log('verbose', 'Window ready-to-show - showing');
            win.show();
        });

        // Use the real Chromium version ? spoofing Chrome/120 causes Talon fingerprint mismatch ? 409
        const chromeVer = process.versions.chrome || '120.0.0.0';
        const customUserAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer} Safari/537.36`;
        verboseLog('[Epic Login] Using UA:', customUserAgent);

        // -- Log every Epic request/response -------------------------
        epicSession.webRequest.onBeforeRequest({ urls: ['*://*.epicgames.com/*'] }, (details, callback) => {
            activeRequests += 1;
            lastNetworkActivityAt = Date.now();
            log('verbose', `${details.method} ${_safeEpicLogUrl(details.url)}`);
            callback({});
        });

        epicSession.webRequest.onCompleted({ urls: ['*://*.epicgames.com/*'] }, (details) => {
            activeRequests = Math.max(0, activeRequests - 1);
            lastNetworkActivityAt = Date.now();
            if (details.statusCode >= 400) {
                log('error', `${details.statusCode} ${_safeEpicLogUrl(details.url)} headers=${JSON.stringify(pickSafeEpicResponseHeaders(details.responseHeaders))}`);
            } else {
                log('verbose', `${details.statusCode} ${_safeEpicLogUrl(details.url)}`);
            }
        });

        epicSession.webRequest.onErrorOccurred({ urls: ['*://*.epicgames.com/*'] }, (details) => {
            activeRequests = Math.max(0, activeRequests - 1);
            lastNetworkActivityAt = Date.now();
            log('warn', `NET ERROR ${_safeEpicLogUrl(details.url)} | ${details.error}`);
        });

        // -- Log WebView console output -------------------------------
        win.webContents.on('console-message', (_e, level, message) => {
            const lvl = ['verbose', 'info', 'warn', 'error'][level] || 'info';
            log(lvl === 'error' ? 'warn' : 'verbose', '[WebView] console message redacted');
        });

        // -- Log navigations ------------------------------------------
        win.webContents.on('did-start-navigation', (_e, url, _isInPlace, isMainFrame) => {
            if (isMainFrame) {
                const originPath = _safeEpicLogUrl(url);
                log('verbose', `Navigation start - ${originPath}`);
                diagnose('login_navigation', { originPath });
            }
        });

        win.webContents.on('did-fail-load', (_e, errorCode, errorDescription, url) => {
            log('error', `did-fail-load ${errorCode} ${errorDescription} | ${_safeEpicLogUrl(url)}`);
        });

        // -- Inject UI chrome + intercept auth code -------------------
        win.webContents.on('did-navigate', async (_e, url, httpStatus) => {
            log('verbose', `did-navigate - ${_safeEpicLogUrl(url)} (HTTP ${httpStatus})`);

            win.webContents.insertCSS(`
                #nav-logo-con, .site-navbar, footer { display: none !important; }
            `).catch(() => {});

            win.webContents.executeJavaScript(`
                (function() {
                    if (document.getElementById('baddel-close-btn')) return;
                    const btn = document.createElement('div');
                    btn.id = 'baddel-close-btn';
                    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
                    btn.style.cssText = 'position:fixed; top:12px; right:12px; width:32px; height:32px; background:rgba(255,255,255,0.1); border-radius:50%; display:flex; align-items:center; justify-content:center; cursor:pointer; z-index:999999; transition:0.2s;';
                    btn.onmouseover = () => btn.style.background = 'rgba(255,255,255,0.2)';
                    btn.onmouseout  = () => btn.style.background = 'rgba(255,255,255,0.1)';
                    btn.onclick = () => window.close();
                    document.body.appendChild(btn);
                    const drag = document.createElement('div');
                    drag.style.cssText = 'position:fixed; top:0; left:0; right:50px; height:40px; -webkit-app-region:drag; z-index:999998;';
                    document.body.appendChild(drag);
                })();
            `).catch(() => {});

            let redirectUrl;
            try { redirectUrl = new URL(String(url || '')); } catch { return; }
            if (redirectUrl.origin !== 'https://www.epicgames.com' || redirectUrl.pathname !== '/id/api/redirect') return;
            if (captureInProgress || settled) return;
            captureInProgress = true;

            log('verbose', 'Redirect URL detected - attempting to read auth code');
            diagnose('authorization_redirect_detected', { originPath: `${redirectUrl.origin}${redirectUrl.pathname}` });
            try {
                let data = null;
                let lastError = null;
                for (const delayMs of [0, 100, 300, 750, 1500]) {
                    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
                    if (settled || win.isDestroyed()) return;
                    try {
                        const bodyText = await win.webContents.executeJavaScript('document.body.innerText');
                        data = JSON.parse(bodyText);
                        if (data?.authorizationCode) break;
                    } catch (error) {
                        lastError = error;
                    }
                }
                if (!data?.authorizationCode && lastError) throw lastError;
                if (data?.authorizationCode) {
                    syncLog('[Epic Login] Authorization received');
                    log('verbose', `Auth code received - length=${data.authorizationCode.length} [value redacted]`);
                    diagnose('authorization_code_received');
                    codeFound = true;
                    win.hide();
                    settle(() => resolve({
                        authorizationCode: data.authorizationCode,
                        epicSession,
                        userAgent: customUserAgent,
                        waitForSessionReady,
                        requestJson: async (rawUrl) => {
                            const parsed = new URL(String(rawUrl || ''));
                            if (parsed.protocol !== 'https:' || parsed.origin !== 'https://www.epicgames.com') {
                                throw epicHistoryError(EPIC_HISTORY_ERROR_CODES.IDENTITY_CHECK_FAILED, 'Blocked non-Epic browser request.');
                            }
                            if (win.isDestroyed()) throw epicHistoryError(EPIC_HISTORY_ERROR_CODES.POST_LOGIN_SESSION_NOT_READY, 'Epic login window is no longer available.');
                            const requestUrl = parsed.toString();
                            const execution = win.webContents.executeJavaScript(`(async () => {
                                const controller = new AbortController();
                                const timeoutId = setTimeout(() => controller.abort(), 12000);
                                let response;
                                try {
                                    response = await fetch(${JSON.stringify(requestUrl)}, {
                                        method: 'GET', credentials: 'include', cache: 'no-store', signal: controller.signal,
                                        headers: { Accept: 'application/json, text/plain, */*', 'X-Requested-With': 'XMLHttpRequest' }
                                    });
                                } catch (error) {
                                    return {
                                        ok: false, status: 0, contentType: '', redirected: false,
                                        classification: 'network_error', originPath: new URL(${JSON.stringify(requestUrl)}).origin + new URL(${JSON.stringify(requestUrl)}).pathname,
                                        causeCode: error?.name === 'AbortError' ? 'EPIC_BROWSER_REQUEST_TIMEOUT' : 'EPIC_BROWSER_REQUEST_FAILED',
                                        causeSummary: error?.name === 'AbortError' ? 'Epic browser request timed out.' : 'Epic browser request failed.',
                                        data: null,
                                    };
                                } finally {
                                    clearTimeout(timeoutId);
                                }
                                const text = await response.text();
                                const contentType = response.headers.get('content-type') || '';
                                const prefix = text.trimStart().slice(0, 1200).toLowerCase();
                                let classification = 'other';
                                if (!text.trim()) classification = 'empty';
                                else if (contentType.toLowerCase().includes('json') || prefix.startsWith('{') || prefix.startsWith('[')) classification = 'json';
                                else if (contentType.toLowerCase().includes('text/html') || prefix.startsWith('<!doctype html') || prefix.startsWith('<html')) classification = prefix.includes('/id/login') || prefix.includes('epicgames.com/id/authorize') || (prefix.includes('epic games') && /sign[ -]?in|log[ -]?in/.test(prefix)) ? 'login_html' : 'html';
                                let data = null;
                                if (classification === 'json') { try { data = JSON.parse(text); } catch {} }
                                const finalUrl = new URL(response.url || ${JSON.stringify(requestUrl)});
                                return { ok: response.ok, status: response.status, contentType, redirected: response.redirected, classification, originPath: finalUrl.origin + finalUrl.pathname, data };
                            })()`, true);
                            let timeoutId;
                            try {
                                return await Promise.race([
                                    execution,
                                    new Promise((_, reject) => {
                                        timeoutId = setTimeout(() => reject(epicHistoryError(
                                            EPIC_HISTORY_ERROR_CODES.POST_LOGIN_SESSION_NOT_READY,
                                            'Epic browser execution timed out.', null,
                                            { causeCode: 'EPIC_BROWSER_EXECUTION_TIMEOUT', causeSummary: 'Epic browser execution timed out.' }
                                        )), 15000);
                                    }),
                                ]);
                            } finally {
                                clearTimeout(timeoutId);
                            }
                        },
                        close: () => { try { if (!win.isDestroyed()) win.close(); } catch {} },
                    }));                } else {
                    log('warn', `No authorizationCode in redirect. Keys: ${Object.keys(data).join(', ')}`);
                }
            } catch (err) {
                log('warn', `Could not parse redirect body: ${err.message}`);
                diagnose('authorization_redirect_unreadable', { code: 'EPIC_AUTH_REDIRECT_UNREADABLE' });
            } finally {
                captureInProgress = false;
            }
        });

        win.webContents.on('did-finish-load', () => {
            const currentUrl = win.webContents.getURL();
            if (currentUrl) win.webContents.emit('did-navigate', {}, currentUrl, 200);
        });

        win.on('closed', () => {
            options.signal?.removeEventListener?.('abort', cancelLogin);
            log('verbose', `Window closed. codeFound=${codeFound} settled=${settled}`);
            settle(() => {
                if (!codeFound) reject(epicHistoryError(EPIC_HISTORY_ERROR_CODES.LOGIN_CANCELLED, 'Epic login cancelled.'));
            });
        });

        const loginDeadlineMs = Math.max(30000, Number(options.loginDeadlineMs || 5 * 60 * 1000));
        loginDeadlineTimer = setTimeout(() => {
            const error = epicHistoryError(EPIC_HISTORY_ERROR_CODES.DEADLINE_EXCEEDED, 'Epic sign-in exceeded its time limit.');
            diagnose('login_deadline_exceeded', { code: error.code });
            settle(() => reject(error));
            if (!win.isDestroyed()) win.destroy();
        }, loginDeadlineMs);

        const LOGIN_URL = `https://www.epicgames.com/id/login?redirectUrl=${encodeURIComponent(`https://www.epicgames.com/id/api/redirect?clientId=34a02cf8f4414e29b15921876da36f9a&responseType=code`)}`;
        log('verbose', `Loading login URL with session ${partitionName}`);

        win.loadURL(LOGIN_URL, { userAgent: customUserAgent }).catch((err) => {
            log('error', `loadURL failed: ${err.message}`);
            setTimeout(() => {
                if (settled) return;
                const loginError = win.isDestroyed()
                    ? epicHistoryError(EPIC_HISTORY_ERROR_CODES.LOGIN_CANCELLED, 'Epic login cancelled.')
                    : epicHistoryError(EPIC_HISTORY_ERROR_CODES.AUTH_EXPIRED, 'Could not load Epic login page.');
                settle(() => reject(loginError));
            }, 0);
        });
    });
}

function _epicHistoryCheckpointFile(accountId) {
    const digest = crypto.createHash('sha256').update(String(accountId || '')).digest('hex').slice(0, 24);
    return path.join(SYNC_CACHE_DIR, 'epic-history-checkpoints', digest + '.json');
}

let _epicHistoryOperationTimelineWrite = Promise.resolve();

function recordEpicHistoryOperationEvent(event = {}) {
    const accountHash = crypto.createHash('sha256').update(String(event.accountId || '')).digest('hex').slice(0, 16);
    const safe = {
        at: new Date().toISOString(),
        accountHash,
        source: String(event.source || 'unknown'),
        operationId: String(event.operationId || ''),
        canonicalOperationId: String(event.canonicalOperationId || event.operationId || ''),
        canonicalSource: String(event.canonicalSource || event.source || 'unknown'),
        operationSequence: Number(event.operationSequence || 0),
        startedAt: event.startedAt || null,
        phase: event.phase || null,
        disposition: event.disposition || null,
        terminalStatus: event.terminalStatus || null,
        code: event.code || null,
        commitRevision: event.commitRevision ?? null,
        purchaseHistoryFetchedAt: event.purchaseHistoryFetchedAt || null,
        progressiveStateUpdatedBy: event.progressiveStateUpdatedBy || null,
    };
    const file = path.join(app.getPath('userData'), 'epic-purchase-history-operation-timeline.json');
    _epicHistoryOperationTimelineWrite = _epicHistoryOperationTimelineWrite.then(async () => {
        let previous = {};
        try { previous = JSON.parse(await fs.readFile(file, 'utf8')); } catch {}
        const events = [...(Array.isArray(previous.events) ? previous.events : []), safe].slice(-500);
        await epicProgressiveAtomicStore.writeJson(file, { version: 1, updatedAt: safe.at, events });
    }).catch((error) => syncWarn('[Epic History] operation timeline write failed:', error?.message || String(error)));
}

function persistRecoveredEpicDisplayName(change) {
    const task = _epicIdentityWriteQueue.then(async () => {
        const accounts = await getEpicAccountsList();
        const index = accounts.findIndex((account) => String(account?.id || '') === String(change?.accountId || ''));
        if (index === -1) return false;
        const currentName = String(accounts[index]?.displayName || '').trim();
        if (!isEpicFallbackDisplayName(currentName)) return false;
        const nextAccounts = accounts.slice();
        nextAccounts[index] = { ...nextAccounts[index], displayName: change.displayName };
        await saveEpicAccountsList(nextAccounts);
        _emitPlatformAccountsChanged('epic', 'identity_refreshed');
        return true;
    });
    _epicIdentityWriteQueue = task.catch(() => {});
    return task;
}

const epicHistoryRefreshOperationRegistry = new EpicHistoryRefreshOperationRegistry({
    onEvent: recordEpicHistoryOperationEvent,
});

function _epicHistoryPartitionName(accountId) {
    if (!isCanonicalEpicAccountId(accountId)) {
        const error = new Error('Epic History session requires a canonical account ID.');
        error.code = EPIC_HISTORY_ERROR_CODES.IDENTITY_CHECK_FAILED;
        throw error;
    }
    const digest = crypto.createHash('sha256').update(String(accountId)).digest('hex').slice(0, 24);
    return `persist:baddel-epic-history-${digest}`;
}

function getEpicHistorySession(accountId) {
    return session.fromPartition(_epicHistoryPartitionName(accountId), { cache: true });
}

async function clearEpicHistorySession(accountId) {
    if (!accountId) return;
    const epicSession = getEpicHistorySession(accountId);
    await epicSession.clearStorageData?.();
    try { await epicSession.clearCache?.(); } catch {}
}

function _emitEpicHistorySessionDiagnostic(event = {}) {
    const safe = {
        stage: String(event.stage || 'unknown'),
        status: event.status ? String(event.status) : undefined,
        code: event.code ? String(event.code) : undefined,
        accountHash: event.accountHash ? String(event.accountHash) : undefined,
        cookieCount: Number.isFinite(event.cookieCount) ? Number(event.cookieCount) : undefined,
        verificationSource: event.verificationSource ? String(event.verificationSource) : undefined,
        failedStage: event.failedStage ? String(event.failedStage) : undefined,
        operationType: event.operationType ? String(event.operationType) : undefined,
        operationId: event.operationId ? String(event.operationId) : undefined,
        syncRunId: event.syncRunId ? String(event.syncRunId) : undefined,
    };
    verboseLog('[Epic History Session]', safe);
}

const epicHistorySessionBootstrapService = new EpicHistorySessionBootstrapService({
    getTargetSession: async (accountId) => getEpicHistorySession(accountId),
    verifyIdentity: verifyEpicWebIdentity,
    resolvePersistentSessionIdentity: resolveEpicPersistentSessionIdentity,
    flushSession: async (epicSession) => epicSession.cookies.flushStore?.(),
    onDiagnostic: _emitEpicHistorySessionDiagnostic,
});

async function bootstrapEpicHistorySessionFromLogin(accountId, authResult, options = {}) {
    return epicHistorySessionBootstrapService.bootstrap(accountId, authResult, options);
}

function buildRefreshedEpicVaultAccount({ account, previous, processed, fetchedAt }) {
    const { games: purchaseGames = [], ...historyFields } = processed;
    return sanitizeEpicVaultAccount({
        ...(previous || {}),
        ...historyFields,
        accountId: String(account.id),
        displayName: account.displayName || previous?.displayName || 'Epic Account',
        games: Array.isArray(previous?.games) ? previous.games : [],
        purchaseGames,
        purchaseHistory: {
            status: 'complete',
            fetchedAt,
            ordersCount: Number(processed.ordersCount || 0),
            purchaseHistoryItemsCount: processed.purchaseHistoryItems.length,
        },
        purchaseHistoryFetchedAt: fetchedAt,
        permissions: { ...(previous?.permissions || {}), purchaseHistory: true },
        historyError: null,
    });
}

async function resolveEpicPersistentSessionIdentity(epicSession, account, userAgent, options = {}) {
    const authorizationUrl = 'https://www.epicgames.com/id/api/redirect?clientId=34a02cf8f4414e29b15921876da36f9a&responseType=code';
    const data = await _fetchEpicWebJson(
        epicSession,
        authorizationUrl,
        userAgent,
        'session authorization',
        { ...options, stage: options.stage || 'persistent_session_authorization_check' }
    );
    const authorizationCode = String(data?.authorizationCode || '');
    if (!authorizationCode) {
        options.onDiagnostic?.({
            stage: options.stage || 'persistent_session_authorization_check',
            originPath: 'https://www.epicgames.com/id/api/redirect',
            classification: 'json',
            code: EPIC_HISTORY_ERROR_CODES.IDENTITY_CHECK_FAILED,
        });
        throw epicHistoryError(
            EPIC_HISTORY_ERROR_CODES.IDENTITY_CHECK_FAILED,
            'Epic session authorization did not include an identity code.'
        );
    }
    const identity = await resolveEpicAuthorizationIdentityForHistory(
        { authorizationCode },
        account,
        { ...options, stage: options.stage || 'persistent_session_authorization_check' }
    );
    options.onDiagnostic?.({
        stage: options.stage || 'persistent_session_authorization_check',
        originPath: 'https://www.epicgames.com/id/api/redirect',
        classification: 'json',
        verificationSource: 'persistent_session_authorization',
        code: 'OK',
    });
    return identity;
}

async function resolveEpicAuthorizationIdentityForHistory(loginResult, account, options = {}) {
    const authorizationCode = String(loginResult?.authorizationCode || '');
    if (!authorizationCode) throw epicHistoryError(EPIC_HISTORY_ERROR_CODES.IDENTITY_CHECK_FAILED, 'Epic authorization did not provide an identity code.');
    const configPath = path.join(app.getPath('userData'), `legendary-history-auth-${crypto.randomBytes(8).toString('hex')}`);
    let configDirectoryCreated = false, userJsonExists = false;
    const fail = (code, message, cause = null, extra = {}) => {
        const details = {
            ...(cause?.legendaryDiagnostics || {}), ...extra, configDirectoryCreated, userJsonExists,
            causeCode: cause?.code || code, causeSummary: cause?.safeSummary || message,
        };
        options.onDiagnostic?.({ stage: options.stage || 'post_login_identity_check', code, ...details });
        return epicHistoryError(code, message, cause, details);
    };
    try {
        await fs.mkdir(configPath, { recursive: true });
        configDirectoryCreated = fsSync.existsSync(configPath);
        try { await runLegendary(['auth', '--code', authorizationCode], configPath); }
        catch (error) {
            const code = error?.code === EPIC_HISTORY_ERROR_CODES.LEGENDARY_RUNTIME_MISSING ? EPIC_HISTORY_ERROR_CODES.LEGENDARY_RUNTIME_MISSING : EPIC_HISTORY_ERROR_CODES.LEGENDARY_AUTH_FAILED;
            throw fail(code, code === EPIC_HISTORY_ERROR_CODES.LEGENDARY_RUNTIME_MISSING ? 'The packaged Epic helper is unavailable.' : 'The Epic helper could not exchange the sign-in authorization.', error);
        }
        userJsonExists = fsSync.existsSync(path.join(configPath, 'user.json'));
        const legendaryUser = await readEpicLegendaryUser(configPath);
        if (!userJsonExists || !legendaryUser?.account_id) throw fail(EPIC_HISTORY_ERROR_CODES.LEGENDARY_USER_DATA_MISSING, 'The Epic helper did not create usable account data.', null, { command: 'auth' });
        // auth --code has already exchanged an authorization code produced by
        // the verified persistent Epic session. Its user.json is the authoritative
        // identity result. Running status --json here performs another remote
        // request and can time out on a slow connection after successful auth,
        // incorrectly blocking purchase-history import.
        const resolved = resolveEpicAccountIdentity({
            account_id: legendaryUser.account_id,
            display_name: legendaryUser.display_name,
        }, account, 'epic_history_unresolved');
        const accountId = String(resolved?.accountId || '');
        if (!accountId || accountId === 'epic_history_unresolved') throw fail(EPIC_HISTORY_ERROR_CODES.IDENTITY_CHECK_FAILED, 'The Epic helper did not resolve an account ID.');
        return { accountId, displayName: resolved?.displayName || legendaryUser.display_name || account?.displayName || null };
    } finally {
        await fs.rm(configPath, { recursive: true, force: true }).catch(() => {});
    }
}
const epicPurchaseHistoryRefreshService = createEpicPurchaseHistoryRefreshService({
    operationRegistry: epicHistoryRefreshOperationRegistry,
    getAccount: async (accountId) => {
        const accounts = await getEpicAccountsList();
        return accounts.find((account) => String(account.id) === String(accountId)) || null;
    },
    getSession: async (accountId) => getEpicHistorySession(accountId),
    clearSession: async (epicSession) => {
        await epicSession.clearStorageData?.();
        await epicSession.clearCache().catch(() => {});
    },
    flushSession: async (epicSession) => {
        if (typeof epicSession?.cookies?.flushStore === 'function') await epicSession.cookies.flushStore();
    },
    openLogin: async ({ account, epicSession, parentWindow, signal, onDiagnostic }) => openEpicLoginWindow(parentWindow, {
        epicSession, signal, onDiagnostic,
        modal: false,
        partitionName: _epicHistoryPartitionName(account.id),
    }),
    verifyEpicWebIdentity,
    resolveEpicPersistentSessionIdentity,
    fetchEpicOrderHistoryWithSession,
    readVaultAccount: async (accountId) => {
        const vault = await syncCacheRepository.readEpicVault();
        return (vault.accounts || []).find((entry) => String(entry.accountId) === String(accountId)) || null;
    },
    buildVaultAccount: buildRefreshedEpicVaultAccount,
    commitVaultAccount: async (accountVault, options = {}) => {
        const saved = await syncCacheRepository.mergeEpicVaultAccountPhase({
            accountId: accountVault.accountId, phase: 'purchaseHistory', patch: accountVault,
            assertCurrent: options.assertCurrent,
        });
        if (!saved || saved.purchaseHistoryFetchedAt !== accountVault.purchaseHistoryFetchedAt) {
            throw new Error('Epic Vault commit verification failed.');
        }
        return saved;
    },
    requestTimeoutMs: Number(process.env.BADDEL_EPIC_HISTORY_REQUEST_TIMEOUT_MS || 18000),
    phaseDeadlineMs: Number(process.env.BADDEL_EPIC_HISTORY_DEADLINE_MS || 120000),
    maxPhaseDurationMs: Number(process.env.BADDEL_EPIC_HISTORY_MAX_DURATION_MS || 15 * 60 * 1000),
});

async function _persistEpicHistoryDiagnostics(accountId, outcome, diagnostics = []) {
    const accountHash = crypto.createHash('sha256').update(String(accountId || '')).digest('hex').slice(0, 16);
    const payload = { capturedAt: new Date().toISOString(), accountHash, outcome, diagnostics };
    const file = path.join(app.getPath('userData'), 'epic-purchase-history-diagnostics.json');
    await fs.writeFile(file, JSON.stringify(payload, null, 2), 'utf8').catch(() => {});
}

async function appendEpicPurchaseHistoryRendererDiagnostic(accountId, operationId, details = {}) {
    const safeOperationId = /^[a-zA-Z0-9._:-]{8,128}$/.test(String(operationId || '')) ? String(operationId) : null;
    if (!safeOperationId) return { status: 'ignored' };
    const accountHash = crypto.createHash('sha256').update(String(accountId || '')).digest('hex').slice(0, 16);
    const file = path.join(app.getPath('userData'), 'epic-purchase-history-diagnostics.json');
    try {
        const payload = JSON.parse(await fs.readFile(file, 'utf8'));
        if (payload.accountHash !== accountHash) return { status: 'ignored' };
        const diagnostics = Array.isArray(payload.diagnostics) ? payload.diagnostics : [];
        diagnostics.push({
            at: new Date().toISOString(),
            stage: 'renderer_hydration_completed',
            code: 'OK',
            operationId: safeOperationId,
            durationMs: Math.max(0, Number(details.durationMs || 0)),
        });
        payload.diagnostics = diagnostics.slice(-240);
        payload.capturedAt = new Date().toISOString();
        await fs.writeFile(file, JSON.stringify(payload, null, 2), 'utf8');
        return { status: 'recorded' };
    } catch {
        return { status: 'ignored' };
    }
}

function emitEpicPurchaseHistoryRefreshState(payload = {}) {
    const win = _platformSyncWindowGetter?.();
    if (win && !win.isDestroyed()) win.webContents.send('epic-purchase-history-refresh-state', payload);
}

async function refreshEpicPurchaseHistory(accountId, parentWindow, options = {}) {
    const id = String(accountId || '');
    const operationId = /^[a-zA-Z0-9._:-]{8,128}$/.test(String(options.operationId || ''))
        ? String(options.operationId)
        : crypto.randomUUID();
    const accountHash = crypto.createHash('sha256').update(id).digest('hex').slice(0, 16);
    const partitionName = _epicHistoryPartitionName(id);
    const partitionHash = crypto.createHash('sha256').update(partitionName).digest('hex').slice(0, 16);
    const liveDiagnostics = [];
    let canonicalOperation = null;
    const onDiagnostic = (event) => {
        liveDiagnostics.push(event);
        try { options.onDiagnostic?.(event); } catch (_) {}
    };
    const checkpointFile = _epicHistoryCheckpointFile(accountId);
    const context = {
        parentWindow,
        ...options,
        operationId,
        accountHash,
        partitionHash,
        onDiagnostic,
        source: String(options.source || 'unknown'),
        onOperation: (event) => {
            canonicalOperation = event;
            try { options.onOperation?.(event); } catch (_) {}
        },
        onState: (payload) => emitEpicPurchaseHistoryRefreshState({ platform: 'epic', ...payload }),
        inspectSession: async (epicSession) => {
            const cookies = await epicSession?.cookies?.get?.({ domain: '.epicgames.com' }) || [];
            return { cookieCount: cookies.filter(isEpicCookie).length };
        },
        loadCheckpoint: options.loadCheckpoint || (async () => {
            try { return JSON.parse(await fs.readFile(checkpointFile, 'utf8')); }
            catch (error) { if (error?.code !== 'ENOENT') syncWarn('[Epic History] checkpoint read failed:', error.message); return null; }
        }),
        saveCheckpoint: options.saveCheckpoint || (async (checkpoint) => {
            await epicProgressiveAtomicStore.writeJson(checkpointFile, {
                version: 1,
                accountHash: crypto.createHash('sha256').update(String(accountId)).digest('hex').slice(0, 16),
                updatedAt: new Date().toISOString(),
                ...checkpoint,
            });
        }),
        clearCheckpoint: options.clearCheckpoint || (async () => {
            await fs.unlink(checkpointFile).catch((error) => { if (error?.code !== 'ENOENT') throw error; });
        }),
    };
    try {
        const result = await epicPurchaseHistoryRefreshService.refresh(accountId, context);
        if (result?.status === 'success') {
            await epicProgressiveSyncCoordinator.reconcilePurchaseHistorySuccess({
                accountId: id,
                operationId: result.canonicalOperationId || operationId,
                operationSequence: result.operationSequence || canonicalOperation?.operationSequence || 0,
                committedRevision: result.committedRevision ?? null,
                purchaseHistoryFetchedAt: result.fetchedAt || null,
            });
            recordEpicHistoryOperationEvent({
                accountId: id,
                operationId,
                source: context.source,
                canonicalOperationId: result.canonicalOperationId || operationId,
                canonicalSource: result.canonicalSource || context.source,
                operationSequence: result.operationSequence || canonicalOperation?.operationSequence || 0,
                startedAt: canonicalOperation?.startedAt || null,
                phase: 'success_reconciled',
                disposition: 'coordinator_reconciled',
                terminalStatus: 'success',
                commitRevision: result.committedRevision ?? null,
                purchaseHistoryFetchedAt: result.fetchedAt || null,
                progressiveStateUpdatedBy: context.source,
            });
        }
        await _persistEpicHistoryDiagnostics(accountId, result.status, result.diagnostics);
        return { ...result, operationId };
    } catch (error) {
        await _persistEpicHistoryDiagnostics(accountId, error?.code || 'error', error?.diagnostics || liveDiagnostics);
        throw error;
    }
}

function _pickEpicCover(keyImages) {
    if (!Array.isArray(keyImages) || keyImages.length === 0) return null;
    // OfferImageTall is episode/item-specific art; DieselGameBoxTall is often shared season art.
    // Prefer OfferImageTall first to avoid all episodes showing the same season cover.
    const PREF = ['OfferImageTall', 'DieselStoreFrontTall', 'DieselGameBoxTall', 'TakeoverTall', 'Poster', 'DieselGameBox', 'Thumbnail', 'OfferImageWide', 'DieselStoreFrontWide', 'DieselGameBoxWide', 'Featured'];
    for (const type of PREF) {
        const img = keyImages.find(k => k.type === type);
        if (img?.url) return img.url;
    }
    return keyImages[0]?.url || null;
}

function _pickEpicHero(keyImages) {
    if (!Array.isArray(keyImages) || keyImages.length === 0) return null;
    // OfferImageWide is episode-specific; DieselGameBox may be shared season art.
    const PREF = ['OfferImageWide', 'DieselStoreFrontWide', 'DieselGameBoxWide', 'Featured', 'DieselGameBox', 'Thumbnail', 'OfferImageTall', 'DieselStoreFrontTall'];
    for (const type of PREF) {
        const img = keyImages.find((k) => k.type === type);
        if (img?.url) return img.url;
    }
    return null;
}

function _pickEpicLogo(keyImages) {
    if (!Array.isArray(keyImages) || keyImages.length === 0) return null;
    const PREF = ['DieselLogo', 'Logo', 'OfferLogo'];
    for (const type of PREF) {
        const img = keyImages.find((k) => k.type === type);
        if (img?.url) return img.url;
    }
    return null;
}

async function recoverEpicDisplayNameAfterSuccessfulLibraryRead(acc, confPath) {
    const accountId = String(acc?.id || '').trim();
    const previousDisplayName = String(acc?.displayName || '').trim();
    if (!accountId || !isEpicFallbackDisplayName(previousDisplayName)) return null;

    let legendaryUser = null;
    try {
        legendaryUser = await readEpicLegendaryUser(confPath);
    } catch (error) {
        syncWarn('[Epic Identity] Could not reread Legendary user.json:', error?.message || String(error));
    }

    let status = {
        account_id: legendaryUser?.account_id || accountId,
        display_name: legendaryUser?.display_name || null,
    };
    let identity = resolveEpicAccountIdentity(status, null, accountId);

    // `legendary list` has already succeeded, so this is the best moment to retry
    // the profile lookup that may have timed out during the original link. It is
    // deliberately non-fatal: a slow status call must never turn a good library
    // sync into a failure, and the next successful sync will retry the repair.
    if (identity?.source === 'id-derived' || isEpicFallbackDisplayName(identity?.displayName)) {
        try {
            const statusRaw = JSON.parse(await runLegendary(['status', '--json'], confPath, 8_000));
            status = {
                ...statusRaw,
                account_id: legendaryUser?.account_id || statusRaw?.account_id || accountId,
                display_name: legendaryUser?.display_name || statusRaw?.display_name,
            };
            identity = resolveEpicAccountIdentity(status, null, accountId);
        } catch (error) {
            syncWarn('[Epic Identity] Name refresh deferred:', error?.message || String(error));
            return null;
        }
    }

    const nextDisplayName = String(identity?.displayName || '').trim();
    if (String(identity?.accountId || '') !== accountId
        || identity?.source === 'id-derived'
        || isEpicFallbackDisplayName(nextDisplayName)) return null;

    acc.displayName = nextDisplayName;
    _updatePlatformSyncAccount('epic', accountId, { displayName: nextDisplayName });
    try {
        await persistRecoveredEpicDisplayName({ accountId, previousDisplayName, displayName: nextDisplayName });
    } catch (error) {
        syncWarn('[Epic Identity] Could not persist recovered display name:', error?.message || String(error));
    }
    syncLog(`[Epic Identity] Recovered account display name after successful library sync.`);
    return { accountId, previousDisplayName, displayName: nextDisplayName };
}

function replaceEpicOwnerDisplayName(libraryMap, change) {
    if (!(libraryMap instanceof Map) || !change?.accountId || !change?.displayName) return;
    const accountId = String(change.accountId);
    const previous = String(change.previousDisplayName || '').trim().toLowerCase();
    for (const game of libraryMap.values()) {
        const ownsGame = Array.isArray(game?.ownedByAccountIds)
            && game.ownedByAccountIds.some((id) => String(id) === accountId);
        if (!ownsGame) continue;
        const names = Array.isArray(game.ownedBy) ? game.ownedBy : [];
        game.ownedBy = [...new Set([
            ...names.filter((name) => !previous || String(name || '').trim().toLowerCase() !== previous),
            change.displayName,
        ].filter(Boolean))];
    }
}

async function syncSingleEpicAccount(acc, previousGames, targetAccountId = null, syncOptions = EPIC_SYNC_OPTION_DEFAULTS, parentWindow = null, runtime = {}) {
    if (targetAccountId && String(acc.id) !== String(targetAccountId)) {
        return { status: 'skipped' };
    }
    const aid = String(acc.id);
    const previousCount = countGamesForAccount('epic', previousGames, aid);

    _setPlatformSyncState('epic', (state) => {
        state.phase = 'sync_account';
        state.statusText = `Syncing ${acc.displayName}`;
        return state;
    });
    _updatePlatformSyncAccount('epic', aid, {
        status: 'syncing',
        startedAt: new Date().toISOString(),
        finishedAt: null,
        gamesCount: previousCount,
        message: 'Reading Epic library',
    });
    _pushPlatformSyncLog('epic', 'info', `Reading Epic library for ${acc.displayName}`, {
        accountId: aid,
        accountName: acc.displayName,
    });

    try {
        const confPath = getLegendaryConfPath(acc.id);
        if (!fsSync.existsSync(confPath)) {
            _pushPlatformSyncLog('epic', 'warn', `Skipping ${acc.displayName} because its config folder is missing`, {
                accountId: aid,
                accountName: acc.displayName,
            });
            _updatePlatformSyncAccount('epic', aid, {
                status: 'warning',
                finishedAt: new Date().toISOString(),
                gamesCount: previousCount,
                message: 'The saved Epic login is missing. Relink this account to sync again.',
            });
            return {
                aid,
                games: [],
                result: { status: 'warning', rawGamesCount: 0, validationFailed: true },
            };
        }
        const vaultBeforeSync = await syncCacheRepository.readEpicVault().catch(() => ({ accounts: [] }));
        const existingVaultBeforeSync = Array.isArray(vaultBeforeSync.accounts)
            ? vaultBeforeSync.accounts.find((item) => String(item.accountId) === aid)
            : null;
        let historySeed = null;
        let historyImported = existingVaultBeforeSync?.permissions?.purchaseHistory === true && hasUsableEpicPurchaseHistory(existingVaultBeforeSync);

        _pushPlatformSyncLog('epic', 'info', `Running legendary list for ${acc.displayName}`, {
            accountId: aid,
            accountName: acc.displayName,
        });

        // Primary source: `legendary list --json` returns only owned playable games.
        // Do NOT use --include-non-ac as the primary source; it leaks Fab/asset catalog entries.
        const rawPlayable = await runLegendary(['list', '--json'], confPath, 30_000);
        let playableParsed = JSON.parse(rawPlayable);
        if (!Array.isArray(playableParsed)) playableParsed = [];
        const accountNameChange = await recoverEpicDisplayNameAfterSuccessfulLibraryRead(acc, confPath);

        // Third-party source: EA App, Ubisoft, etc.
        let thirdPartyParsed = [];
        try {
            const rawThirdParty = await runLegendary(['list', '--json', '--third-party'], confPath, 30_000);
            thirdPartyParsed = JSON.parse(rawThirdParty);
            if (!Array.isArray(thirdPartyParsed)) thirdPartyParsed = [];
        } catch (_) { /* non-fatal */ }

        // Diagnostic-only: --include-non-ac (never merged into library).
        // Logged so we can see exactly what Legendary returns in that list.
        let nonAcParsed = [];
        try {
            const rawNonAc = await runLegendary(['list', '--json', '--include-non-ac'], confPath, 30_000);
            nonAcParsed = JSON.parse(rawNonAc);
            if (!Array.isArray(nonAcParsed)) nonAcParsed = [];
        } catch (_) { /* non-fatal */ }

        // Classify every candidate with the strict positive-game classifier.
        // Unknown entries (no positive game signal) are dropped by default.
        const candidates = [...playableParsed, ...thirdPartyParsed];
        const keptEntries     = [];
        const rejectedEntries = [];
        const unknownEntries  = [];

        for (const entry of candidates) {
            const result = classifyEpicEntry(entry);
            if (result.decision === 'keep') {
                keptEntries.push(entry);
            } else if (result.decision === 'unknown') {
                unknownEntries.push({ entry, reason: result.reason });
            } else {
                rejectedEntries.push({ entry, reason: result.reason });
            }
        }

        const rawLegendaryCount = candidates.length;
        const allEntries = keptEntries;

        _pushPlatformSyncLog('epic', 'info', 'Legendary Epic classification summary', {
            accountId:         aid,
            accountName:       acc.displayName,
            playableReturned:  playableParsed.length,
            thirdPartyReturned: thirdPartyParsed.length,
            nonAcReturned:     nonAcParsed.length,
            retainedCount:     keptEntries.length,
            rejectedCount:     rejectedEntries.length,
            unknownCount:      unknownEntries.length,
            nonAcSample:       nonAcParsed.slice(0, 20).map(summarizeEpicEntryForLog),
            rejectedSample:    rejectedEntries.slice(0, 20).map(x => ({ ...summarizeEpicEntryForLog(x.entry), reason: x.reason })),
            unknownSample:     unknownEntries.slice(0, 20).map(x => ({ ...summarizeEpicEntryForLog(x.entry), reason: x.reason })),
        });

        const builtGames = await buildEpicOwnedGameEntries(acc, allEntries);
        const canonical = canonicalizeEpicLibraryGames(builtGames);
        const games = canonical.games;
        const canonicalGameCount = games.length;
        const libraryDiagnostics = {
            rawLegendaryCount,
            rejectedCount: rejectedEntries.length,
            unknownCount: unknownEntries.length,
            nonGameExcludedCount: rejectedEntries.length + unknownEntries.length + canonical.diagnostics.nonGameExcludedCount,
            duplicateCollapsedCount: canonical.diagnostics.duplicateCollapsedCount,
            canonicalGameCount,
        };
        const result = {
            status: canonicalGameCount > 0 ? 'success' : (previousCount > 0 ? 'warning' : 'success'),
            rawGamesCount: rawLegendaryCount,
            canonicalGameCount,
            libraryDiagnostics,
            validationFailed: canonicalGameCount === 0 && previousCount > 0,
            allowZeroGames: previousCount === 0,
        };

        _updatePlatformSyncAccount('epic', aid, {
            status: result.status,
            finishedAt: new Date().toISOString(),
            gamesCount: canonicalGameCount > 0 ? canonicalGameCount : previousCount,
            message: canonicalGameCount > 0
                ? `Found ${canonicalGameCount} owned games`
                : (previousCount > 0 ? 'Epic returned 0 games. Cached data will be verified.' : 'No owned games found'),
        });
        _pushPlatformSyncLog('epic', 'info',
            `Fetched ${canonicalGameCount} canonical games for ${acc.displayName} (raw=${rawLegendaryCount} retained=${keptEntries.length} rejected=${rejectedEntries.length} unknown=${unknownEntries.length})`, {
            accountId: aid,
            accountName: acc.displayName,
        });

        const classificationReport = {
            accountId:   aid,
            accountName: acc.displayName,
            rawLegendaryCount,
            retainedCount: keptEntries.length,
            keptCount: canonicalGameCount,
            canonicalGameCount,
            duplicateCollapsedCount: canonical.diagnostics.duplicateCollapsedCount,
            nonGameExcludedCount: rejectedEntries.length + unknownEntries.length,
            rejectedCount: rejectedEntries.length,
            unknownCount:  unknownEntries.length,
            kept:     games.map(e => ({ app_name: e.appName, app_title: e.title, canonicalGameId: e.canonicalGameId, aliases: e.canonicalAliases, reason: 'canonical_game' })),
            rejected: rejectedEntries.map(x => ({ app_name: x.entry?.app_name, app_title: x.entry?.app_title || x.entry?.title, reason: x.reason })),
            unknown:  unknownEntries.map(x => ({ app_name: x.entry?.app_name, app_title: x.entry?.app_title || x.entry?.title, reason: x.reason })),
            nonAcDiagnostic: nonAcParsed.map(summarizeEpicEntryForLog),
        };

        // DB cleanup: permanently delete previously-imported non-game entries.
        const badEntries = [...rejectedEntries, ...unknownEntries].map(x => x.entry);
        if (badEntries.length > 0) {
            try {
                await gamesSyncAdapter.removeEpicNonGameEntries(badEntries);
            } catch (cleanupErr) {
                _pushPlatformSyncLog('epic', 'warn', `DB cleanup error: ${cleanupErr.message}`, { accountId: aid });
            }
        }

        if (!runtime.libraryOnly) {
            const vault = await syncCacheRepository.readEpicVault().catch(() => ({ accounts: [] }));
            const existingVault = existingVaultBeforeSync || (Array.isArray(vault.accounts)
                ? vault.accounts.find((item) => String(item.accountId) === aid)
                : null);

            const pricingCountry = await readEpicPricingCountryFromLegendary(confPath)
                || normalizeEpicCountry(acc.pricingCountry)
                || normalizeEpicCountry(existingVault?.pricingCountry);
            if (pricingCountry) {
                _pushPlatformSyncLog('epic', 'info', `[Epic Prices] Using pricing country ${pricingCountry} for ${acc.displayName}`, {
                    accountId: aid,
                    accountName: acc.displayName,
                    pricingCountry,
                });
                if (normalizeEpicCountry(acc.pricingCountry) !== pricingCountry) {
                    try {
                        const allAccounts = await getEpicAccountsList();
                        const accountIndex = allAccounts.findIndex((item) => String(item.id) === aid);
                        if (accountIndex !== -1) {
                            allAccounts[accountIndex] = { ...allAccounts[accountIndex], pricingCountry };
                            await saveEpicAccountsList(allAccounts);
                        }
                    } catch (persistErr) {
                        syncWarn('[Epic Prices] Could not persist Epic pricing country:', persistErr?.message || String(persistErr));
                    }
                }
            }
            const currency = historySeed?.currency || existingVault?.currency || 'USD';
            const purchaseGames = Array.isArray(historySeed?.games)
                ? historySeed.games
                : (Array.isArray(existingVault?.purchaseGames) ? existingVault.purchaseGames : []);
            let livePrices = Array.isArray(existingVault?.livePrices) ? existingVault.livePrices : [];
            if (syncOptions.currentPrices) {
                const priceCandidates = buildEpicPriceCandidates(games);
                _pushPlatformSyncLog('epic', 'info', `Reading Epic store prices for ${acc.displayName}`, {
                    accountId: aid,
                    accountName: acc.displayName,
                    gamesCount: games.length,
                    priceCandidates: priceCandidates.length,
                    pricingCountry,
                });
                if (!pricingCountry) {
                    _pushPlatformSyncLog('epic', 'warn', '[Epic Prices] Pricing country unavailable for account; preserving cached prices.', {
                        accountId: aid,
                        accountName: acc.displayName,
                    });
                } else {
                    const fetchedLivePrices = await fetchEpicLivePricesForEntries(priceCandidates, pricingCountry);
                    livePrices = mergeEpicLivePrices(livePrices, fetchedLivePrices);
                    const priceDiagnostics = livePrices.diagnostics || fetchedLivePrices.diagnostics || {};
                    _pushPlatformSyncLog('epic', 'info', `Epic store prices read complete for ${acc.displayName}. prices=${livePrices.length}`, {
                        accountId: aid,
                        accountName: acc.displayName,
                        totalOwnedGames: priceDiagnostics.totalOwnedGames || games.length,
                        resolvedByOfferId: priceDiagnostics.resolvedByOfferId || 0,
                        resolvedByCatalogItemId: priceDiagnostics.resolvedByCatalogItemId || 0,
                        resolvedByVerifiedFallback: priceDiagnostics.resolvedByVerifiedFallback || 0,
                        free: priceDiagnostics.free || 0,
                        priced: priceDiagnostics.priced || 0,
                        notForSale: priceDiagnostics.notForSale || 0,
                        unresolved: priceDiagnostics.unresolved || 0,
                        preservedFromPreviousCache: priceDiagnostics.preservedFromPreviousCache || 0,
                        apiFailures: priceDiagnostics.apiFailures || 0,
                        rateLimits: priceDiagnostics.rateLimits || 0,
                        pricingCountry: priceDiagnostics.pricingCountry || pricingCountry,
                    });
                }
            }
            const artworkSeed = historySeed || (existingVault?.permissions?.purchaseHistory === true ? existingVault : null);
            const enrichedHistorySeed = await enrichEpicPurchaseHistoryArtwork(artworkSeed, existingVault, livePrices, pricingCountry);
            const existingVaultForMerge = (!historySeed && enrichedHistorySeed && existingVault)
                ? {
                    ...existingVault,
                    purchaseGames: Array.isArray(enrichedHistorySeed.games) ? enrichedHistorySeed.games : existingVault.purchaseGames,
                    paidItems: Array.isArray(enrichedHistorySeed.paidItems) ? enrichedHistorySeed.paidItems : existingVault.paidItems,
                    fabItems: Array.isArray(enrichedHistorySeed.fabItems) ? enrichedHistorySeed.fabItems : existingVault.fabItems,
                    purchaseHistoryItems: Array.isArray(enrichedHistorySeed.purchaseHistoryItems) ? enrichedHistorySeed.purchaseHistoryItems : existingVault.purchaseHistoryItems,
                }
                : existingVault;
            const accountVault = mergeEpicVaultValuation({
                accountId: aid,
                displayName: acc.displayName,
                rawGamesCount,
                games,
                livePrices,
                historySeed: historySeed ? enrichedHistorySeed : historySeed,
                existingVault: existingVaultForMerge,
                syncOptions,
                historyImported,
                pricingCountry,
            });

            await syncCacheRepository.mergeEpicVaultAccount(sanitizeEpicVaultAccount(accountVault))
                .catch((vaultErr) => syncWarn('[Epic Vault] Could not save Epic vault data:', vaultErr.message));
        }
        return { aid, games, result, classificationReport, accountNameChange };
    } catch (err) {
        const friendlyError = createFriendlySyncError('epic', err);
        _updatePlatformSyncAccount('epic', aid, {
            status: 'error',
            finishedAt: new Date().toISOString(),
            gamesCount: previousCount,
            message: friendlyError.userMessage,
        });
        _pushPlatformSyncLog('epic', 'error', `Failed to sync ${acc.displayName}: ${friendlyError.diagnosticMessage}`, {
            accountId: aid,
            accountName: acc.displayName,
        });
        return {
            aid,
            games: [],
            result: { status: 'error', rawGamesCount: 0, validationFailed: true },
        };
    }
}

async function runEpicProgressivePricesPhase({ account, games, assertCurrent, report, signal, debug = null, forceRefresh = false }) {
    try {
    const aid = String(account.id);
    const vault = await syncCacheRepository.readEpicVault().catch(() => ({ accounts: [] }));
    const existingVault = Array.isArray(vault.accounts)
        ? vault.accounts.find((item) => String(item.accountId) === aid) || null
        : null;
    await debug?.record?.('vault_loaded', {
        vaultAccountFound: Boolean(existingVault), purchaseGamesCount: Number(existingVault?.purchaseGames?.length || 0),
        existingPricesCount: Number(existingVault?.livePrices?.length || 0),
    });
    const confPath = getLegendaryConfPath(aid);
    const legendaryCountry = await readEpicPricingCountryFromLegendary(confPath);
    const linkedCountry = normalizeEpicCountry(account.pricingCountry);
    const vaultCountry = normalizeEpicCountry(existingVault?.pricingCountry);
    const pricingCountry = legendaryCountry || linkedCountry || vaultCountry;
    await debug?.record?.('pricing_country_resolved', {
        source: legendaryCountry ? 'Legendary' : (linkedCountry ? 'linked_account' : (vaultCountry ? 'existing_vault' : 'missing')),
        present: Boolean(pricingCountry),
    });
    if (!pricingCountry) {
        const error = new Error('Epic pricing country is unavailable.');
        error.code = 'EPIC_PRICING_COUNTRY_MISSING';
        throw error;
    }
    const purchaseGames = Array.isArray(existingVault?.purchaseGames) ? existingVault.purchaseGames : [];
    const allCandidates = buildEpicPriceCandidates(games);
    const identityStats = allCandidates.reduce((stats, entry) => {
        const ref = getEpicOfferRefFromEntry(entry);
        if (ref.namespace) stats.hasNamespace += 1;
        if (ref.offerId) stats.hasOfferId += 1;
        if (ref.catalogItemId) stats.hasCatalogItemId += 1;
        if (ref.appName) stats.hasAppName += 1;
        if (ref.title) stats.hasTitle += 1;
        if (!ref.namespace || (!ref.offerId && !ref.catalogItemId && !ref.appName && !ref.title)) stats.missingRequiredIdentity += 1;
        return stats;
    }, { hasNamespace: 0, hasOfferId: 0, hasCatalogItemId: 0, hasAppName: 0, hasTitle: 0, missingRequiredIdentity: 0 });
    await debug?.record?.('candidates_built', {
        accountLibraryCount: games.length, purchaseGamesCount: purchaseGames.length,
        allCandidatesCount: allCandidates.length, identityStats,
    });
    const cachedByKey = buildEpicPriceMap(existingVault?.livePrices || []);
    const ttlMs = Number(process.env.BADDEL_EPIC_PRICE_TTL_MS || 6 * 60 * 60 * 1000);
    const unavailableTtlMs = Number(process.env.BADDEL_EPIC_UNAVAILABLE_PRICE_TTL_MS || 30 * 24 * 60 * 60 * 1000);
    const candidates = allCandidates.filter((entry) => {
        const cached = getEpicPriceIdentityKeys(entry).map((key) => cachedByKey.get(key)).find(Boolean);
        return shouldRefreshCachedEpicPrice(cached, pricingCountry, {
            forceRefresh, priceTtlMs: ttlMs, unavailableTtlMs, normalizeCountry: normalizeEpicCountry,
        });
    });
    await debug?.record?.('cache_filter_completed', {
        validCachedPricesCount: allCandidates.length - candidates.length,
        pendingCandidatesCount: candidates.length,
        forceRefresh: forceRefresh === true,
    });
    const processCandidates = process.env.BADDEL_EPIC_PRICE_DEBUG === '1' && process.env.BADDEL_EPIC_PRICE_DEBUG_FULL !== '1'
        ? selectEpicPriceDebugProbe(candidates, 12)
        : candidates;
    const service = new EpicPriceEnrichmentService({
        fetchEntry: (entry, country, options) => fetchEpicLivePriceForEntry(entry, country, { ...options, debug }),
        concurrency: Number(process.env.BADDEL_EPIC_PRICE_CONCURRENCY || 2),
        batchSize: Number(process.env.BADDEL_EPIC_PRICE_BATCH_SIZE || 100),
        maxRetries: 2,
        maxRetryAfterMs: Number(process.env.BADDEL_EPIC_PRICE_MAX_RETRY_AFTER_MS || 15_000),
        circuitMinAttempts: Number(process.env.BADDEL_EPIC_PRICE_CIRCUIT_MIN_ATTEMPTS || 24),
        progressEveryItems: Number(process.env.BADDEL_EPIC_PRICE_PROGRESS_EVERY || 10),
        progressIntervalMs: Number(process.env.BADDEL_EPIC_PRICE_PROGRESS_INTERVAL_MS || 500),
    });
    let latestPrices = Array.isArray(existingVault?.livePrices) ? existingVault.livePrices : [];
    let lastCommittedRevision = null;
    const commitBatch = async (batch, diagnostics) => {
        await debug?.record?.('batch_commit_started', { batchSize: batch.length, processed: diagnostics.processed, resolved: diagnostics.resolved });
        await assertCurrent();
        const stamped = batch.map((price) => ({
            ...price,
            pricingCountry,
            fetchedAt: price.fetchedAt || new Date().toISOString(),
        }));
        latestPrices = mergeEpicLivePrices(latestPrices, stamped);
        const latestVault = await syncCacheRepository.readEpicVault().catch(() => ({ accounts: [] }));
        const latestAccount = (latestVault.accounts || []).find((item) => String(item.accountId) === aid) || existingVault;
        const accountVault = mergeEpicVaultValuation({
            accountId: aid,
            displayName: account.displayName,
            rawGamesCount: games.length,
            games,
            livePrices: latestPrices,
            historySeed: null,
            existingVault: latestAccount,
            syncOptions: { games: true, currentPrices: true, purchaseHistory: false },
            historyImported: hasUsableEpicPurchaseHistory(latestAccount),
            pricingCountry,
        });
        accountVault.priceDiagnostics = diagnostics;
        try {
            const committed = await syncCacheRepository.mergeEpicVaultAccountPhase({
                accountId: aid,
                phase: 'prices',
                patch: sanitizeEpicVaultAccount(accountVault),
                assertCurrent,
            });
            lastCommittedRevision = committed?.vaultRevision ?? committed?.phaseRevisions?.prices ?? lastCommittedRevision;
        } catch (cause) {
            const error = new Error('Epic price batch could not be committed to the Vault.', { cause });
            error.code = 'EPIC_PRICE_VAULT_COMMIT_FAILED';
            error.failedStage = 'vault_commit';
            error.progress = { ...diagnostics };
            throw error;
        }
        await debug?.record?.('batch_commit_completed', { batchSize: batch.length, processed: diagnostics.processed, resolved: diagnostics.resolved });
    };
    await debug?.record?.('phase_progress_started', { total: processCandidates.length, fullPendingCount: candidates.length });
    await report({ status: 'running', processed: 0, resolved: 0, total: processCandidates.length, candidates: candidates.length });
    if (!processCandidates.length) {
        const pricesFetchedAt = new Date().toISOString();
        const cachedCommit = await syncCacheRepository.mergeEpicVaultAccountPhase({
            accountId: aid,
            phase: 'prices',
            patch: { pricesFetchedAt },
            assertCurrent,
        });
        return {
            status: 'complete',
            committedRevision: cachedCommit?.vaultRevision ?? cachedCommit?.phaseRevisions?.prices ?? null,
            pricesFetchedAt,
            progress: {
                processed: 0, resolved: 0, total: 0, cached: allCandidates.length,
                priced: 0, free: 0, notForSale: 0, unavailable: 0, unresolved: 0,
                apiFailures: 0, timeouts: 0, rateLimits: 0,
            },
        };
    }
    const result = await service.process(processCandidates, {
        signal, pricingCountry, debug, errorSummary, onProgress: report, onBatch: commitBatch,
        makeUnresolved: (entry, reason) => buildEpicUnresolvedPriceRecord(getEpicOfferRefFromEntry(entry), 'unresolved', reason),
    });
    await assertCurrent();
    const pricesFetchedAt = new Date().toISOString();
    const completedCommit = await syncCacheRepository.mergeEpicVaultAccountPhase({
        accountId: aid,
        phase: 'prices',
        patch: { pricesFetchedAt },
        assertCurrent,
    });
    lastCommittedRevision = completedCommit?.vaultRevision ?? completedCommit?.phaseRevisions?.prices ?? lastCommittedRevision;
    await debug?.record?.('phase_completed', { status: result.status, progress: result.progress, probeOnly: processCandidates.length !== candidates.length, pricesFetchedAt });
    return {
        status: result.status,
        committedRevision: lastCommittedRevision,
        pricesFetchedAt,
        progress: { ...result.progress, cached: allCandidates.length - candidates.length, candidates: candidates.length },
    };
    } catch (error) {
        await debug?.fail?.(error, { failedStage: error?.failedStage || null });
        throw error;
    }
}

const _epicPriceRefreshInFlight = new EpicPriceRefreshOperationRegistry();

function emitEpicPriceRefreshState(payload = {}) {
    const win = _platformSyncWindowGetter?.();
    if (win && !win.isDestroyed()) win.webContents.send('epic-price-refresh-state', payload);
}

function epicPriceRefreshError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

async function refreshEpicPricesForAccount(accountId, { source = 'manual' } = {}) {
    const id = String(accountId || '');
    if (!id) throw epicPriceRefreshError('EPIC_PRICE_REFRESH_ACCOUNT_REQUIRED', 'Select an Epic account to refresh prices.');
    const timeoutMs = Math.max(1000, Number(process.env.BADDEL_EPIC_PRICE_REFRESH_DEADLINE_MS || 8 * 60 * 1000));

    return _epicPriceRefreshInFlight.run(id, {
        source, timeoutMs,
        onDeadline: (error, operation) => emitEpicPriceRefreshState({
            platform: 'epic', accountId: id, source: operation.source, status: 'error',
            code: error.code, failedStage: error.failedStage,
        }),
    }, async ({ signal, source: activeSource }) => {
        const startedAt = performance.now();
        const sourceLabel = activeSource === 'automatic' ? 'automatic' : 'manual';
        const accountHash = crypto.createHash('sha256').update(id).digest('hex').slice(0, 16);
        const phaseState = epicProgressiveSyncCoordinator.getAccountState(id)?.phases?.prices || null;
        const debug = await new EpicPriceDebugSession({
            app, sourceFile: __filename, appStartedAt: APP_STARTED_AT, enabled: true,
        }).start({ accountId: id, phaseState, source: sourceLabel });
        await debug.runtimeFingerprint();
        emitEpicPriceRefreshState({ platform: 'epic', accountId: id, source: sourceLabel, status: 'running', processed: 0, total: null });
        await debug.record('terminal_event_sent', { status: 'running', source: sourceLabel });

        try {
            await debug.record('account_resolution_started', { source: sourceLabel, deadlineMs: timeoutMs });
            const account = (await getEpicAccountsList()).find((item) => String(item.id) === id);
            if (!account) throw epicPriceRefreshError('EPIC_PRICE_REFRESH_ACCOUNT_NOT_LINKED', 'The selected Epic account is not linked.');
            await debug.record('account_resolved', { accountFound: true, accountHash });

            const coordinatorAtStart = epicProgressiveSyncCoordinator.getAccountState(id);
            if (_getPlatformSyncState('epic')?.isSyncing
                || coordinatorAtStart?.phases?.library?.status === 'running'
                || coordinatorAtStart?.phases?.prices?.status === 'running') {
                throw epicPriceRefreshError('EPIC_PRICE_REFRESH_BUSY', 'Epic is already updating this account.');
            }

            const mergedLibrary = await epicConnectorMethods.getCachedLibrary();
            const vault = await syncCacheRepository.readEpicVault().catch(() => ({ accounts: [] }));
            const vaultAccount = (vault.accounts || []).find((item) => String(item.accountId) === id) || null;
            const retryInput = resolveEpicPriceRetryInput({
                mergedLibrary,
                accountId: id,
                libraryGamesFetched: Number(vaultAccount?.totalGamesOwned || vaultAccount?.games?.length || 0),
            });
            const games = retryInput.games;
            await debug.record('account_library_filtered', {
                mergedLibraryCount: mergedLibrary.length, matchedAccountGamesCount: games.length,
                ownershipStats: retryInput.stats || null,
            });
            if (!games.length) throw epicPriceRefreshError('EPIC_PRICE_REFRESH_LIBRARY_EMPTY', 'Sync this Epic account before refreshing its prices.');

            const startRevision = coordinatorAtStart?.revision ?? null;
            const assertCurrent = async () => {
                if (signal.aborted) throw signal.reason;
                const stillLinked = (await getEpicAccountsList()).some((item) => String(item.id) === id);
                if (!stillLinked) throw epicPriceRefreshError('EPIC_PRICE_REFRESH_STALE', 'The Epic account changed while prices were refreshing.');
                if (_getPlatformSyncState('epic')?.isSyncing) throw epicPriceRefreshError('EPIC_PRICE_REFRESH_STALE', 'A newer Epic library sync started.');
                const current = epicProgressiveSyncCoordinator.getAccountState(id);
                if (startRevision !== null && current && Number(current.revision) !== Number(startRevision)) {
                    throw epicPriceRefreshError('EPIC_PRICE_REFRESH_STALE', 'A newer Epic account revision replaced this refresh.');
                }
            };
            const report = async (progress = {}) => {
                const event = {
                    platform: 'epic', accountId: id, source: sourceLabel, status: 'running',
                    processed: Number(progress.processed || 0), resolved: Number(progress.resolved || 0),
                    total: Number(progress.total || games.length), event: progress.event || 'progress',
                };
                emitEpicPriceRefreshState(event);
                await debug.record('price_refresh_progress', { ...event, accountId: undefined });
            };

            syncLog('[Epic Prices] Refresh started', { accountHash, source: sourceLabel, games: games.length, deadlineMs: timeoutMs });
            const result = await runEpicProgressivePricesPhase({
                account, games, assertCurrent, report, signal, debug, forceRefresh: sourceLabel === 'manual',
            });
            const persistedVault = await syncCacheRepository.readEpicVault();
            const persistedAccount = (persistedVault.accounts || []).find((item) => String(item.accountId) === id) || null;
            if (!persistedAccount?.pricesFetchedAt || persistedAccount.pricesFetchedAt !== result.pricesFetchedAt) {
                const error = epicPriceRefreshError('EPIC_PRICE_REFRESH_PERSISTENCE_FAILED', 'Epic prices finished but their refresh timestamp was not persisted.');
                error.failedStage = 'vault_persistence_verification';
                throw error;
            }
            await debug.record('prices_timestamp_verified', {
                present: true, vaultRevision: persistedAccount.vaultRevision || null,
                pricePhaseRevision: persistedAccount.phaseRevisions?.prices || null,
            });
            const response = {
                status: 'success', phaseStatus: result.status, accountId: id,
                pricesFetchedAt: result.pricesFetchedAt,
                resolved: Number(result.progress?.resolved || 0), total: Number(result.progress?.total || games.length),
                durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
            };
            syncLog('[Epic Prices] Refresh completed', { accountHash, source: sourceLabel, phaseStatus: result.status, resolved: response.resolved, total: response.total, durationMs: response.durationMs });
            emitEpicPriceRefreshState({ platform: 'epic', accountId: id, source: sourceLabel, ...response });
            await debug.record('terminal_event_sent', { status: 'success', phaseStatus: result.status, durationMs: response.durationMs });
            return response;
        } catch (error) {
            const code = error?.code || 'EPIC_PRICE_REFRESH_FAILED';
            const failedStage = error?.failedStage || 'price_refresh';
            syncWarn('[Epic Prices] Refresh failed', { accountHash, source: sourceLabel, code, failedStage, durationMs: Math.round((performance.now() - startedAt) * 100) / 100 });
            await debug.fail(error, { failedStage, source: sourceLabel });
            emitEpicPriceRefreshState({ platform: 'epic', accountId: id, source: sourceLabel, status: 'error', code, failedStage, progress: error?.progress || null });
            await debug.record('terminal_event_sent', { status: 'error', code, failedStage });
            throw error;
        } finally {
            await debug.flush();
        }
    });
}

const epicPriceRefreshScheduler = new EpicPriceRefreshScheduler({
    listAccounts: async () => {
        const { vault } = await readReconciledEpicVault();
        return (vault.accounts || []).map((account) => ({
            accountId: account.accountId,
            totalGames: Number(account.totalGamesOwned || account.games?.length || 0),
            pricesFetchedAt: account.pricesFetchedAt || null,
        }));
    },
    refreshAccount: refreshEpicPricesForAccount,
    logger: { warn: (...args) => syncWarn(...args) },
});

async function runEpicProgressiveHistoryPhase({
    account, parentWindow, allowInteractiveLogin, assertCurrent, report, signal,
    source = 'progressive_sync',
}) {
    let progressQueue = Promise.resolve();
    const operationId = crypto.randomUUID();
    _emitEpicHistorySessionDiagnostic({
        stage: 'history_background_fetch_started',
        accountHash: crypto.createHash('sha256').update(String(account.id)).digest('hex').slice(0, 16),
    });
    const queueProgress = (patch) => {
        progressQueue = progressQueue.then(() => report(patch));
    };
    const result = await refreshEpicPurchaseHistory(account.id, parentWindow, {
        allowInteractiveLogin: allowInteractiveLogin === true,
        operationId,
        source,
        beforeCommit: assertCurrent,
        signal,
        onOperation: (operation) => queueProgress({
            status: 'running',
            errorCode: null,
            operationId: operation.canonicalOperationId || operation.operationId,
            operationSequence: Number(operation.operationSequence || 0),
            operationDisposition: operation.disposition,
            operationSource: operation.canonicalSource || operation.source,
        }),
        onProgress: (progress) => queueProgress({ status: 'running', ...progress }),
        onDiagnostic: (event) => {
            const stage = String(event?.stage || 'history_page_fetch');
            queueProgress({
                status: stage === 'login_started' ? 'waiting_for_auth' : 'running',
                failedStage: stage,
            });
        },
    });
    await progressQueue;
    if (result?.status === 'reauth_required') {
        _emitEpicHistorySessionDiagnostic({
            stage: 'history_waiting_for_auth', status: 'reauth_required', code: result.code,
            accountHash: crypto.createHash('sha256').update(String(account.id)).digest('hex').slice(0, 16),
        });
        return {
            status: 'reauth_required',
            code: result.code || EPIC_HISTORY_ERROR_CODES.REAUTH_REQUIRED,
            progress: {
                ordersFetched: Number(result?.ordersCount || 0),
                pagesFetched: Number(result?.pagesFetched || 0),
            },
        };
    }
    _emitEpicHistorySessionDiagnostic({
        stage: 'history_background_fetch_completed', status: 'complete',
        accountHash: crypto.createHash('sha256').update(String(account.id)).digest('hex').slice(0, 16),
    });
    return {
        status: 'complete',
        committedRevision: result?.committedRevision ?? null,
        progress: {
            committedRevision: result?.committedRevision ?? null,
            ordersFetched: Number(result?.ordersCount || 0),
            pagesFetched: Number(result?.pagesFetched || 0),
            lastSuccessfulPage: Math.max(-1, Number(result?.pagesFetched || 0) - 1),
        },
    };
}

function startEpicProgressiveOptionalPhases({ account, games, state, syncOptions, parentWindow, allowInteractiveLogin, historySessionBootstrap }) {
    const background = epicProgressiveSyncCoordinator.startOptionalPhases({
        accountId: account.id,
        syncRunId: state.syncRunId,
        revision: state.revision,
        pricesTask: syncOptions.currentPrices
            ? ({ assertCurrent, report, signal }) => runEpicProgressivePricesPhase({ account, games, assertCurrent, report, signal })
            : null,
        purchaseHistoryTask: syncOptions.purchaseHistory
            ? ({ assertCurrent, report, signal }) => {
                if (historySessionBootstrap?.status === 'waiting_for_auth') {
                    return Promise.resolve({
                        status: 'reauth_required',
                        code: historySessionBootstrap.code || EPIC_HISTORY_ERROR_CODES.REAUTH_REQUIRED,
                        progress: { failedStage: historySessionBootstrap.failedStage || 'history_session_identity_verified' },
                    });
                }
                if (['mismatch', 'unavailable'].includes(historySessionBootstrap?.status)) {
                    const error = epicHistoryError(
                        historySessionBootstrap.code || EPIC_HISTORY_ERROR_CODES.IDENTITY_CHECK_FAILED,
                        'Epic Purchase History session bootstrap is unavailable.'
                    );
                    error.failedStage = historySessionBootstrap.failedStage || 'history_session_identity_verified';
                    return Promise.reject(error);
                }
                return runEpicProgressiveHistoryPhase({
                    account, parentWindow, allowInteractiveLogin, assertCurrent, report, signal,
                    source: 'progressive_sync',
                });
            }
            : null,
    });
    background.catch((error) => syncWarn('[Epic Progressive] Optional phases ended unexpectedly:', error?.message || String(error)));
    return background;
}

const epicConnectorMethods = {
    isLinked() {
        return syncCacheRepository.isEpicLinked();
    },
    getAccounts() {
        const raw = syncCacheRepository.readEpicAccountsSync();
        if (!Array.isArray(raw)) return [];
        return raw.filter(a => a?.id).map(a => {
            // Sanitize accounts saved with an epic_tmp fallback id or display name
            const idStr = String(a.id);
            const nameStr = String(a.displayName || '');
            if (idStr.startsWith('epic_tmp') || /^epic_tmp/i.test(nameStr) || /^epic epic_tmp/i.test(nameStr)) {
                syncWarn('[EpicAccounts] Found unresolved epic_tmp account, marking as needs_reauth:', idStr);
                return { ...a, displayName: 'Reconnect Epic account', needsReauth: true };
            }
            return a;
        });
    },
    async link(parentWindow, emitState = () => {}, opts = {}) {
        analytics.logAccountAddStarted?.('epic', 'platform_sync')?.catch?.(() => {});
        await ensureDirs();
        emitState('waiting_for_signin', 'Waiting for Epic authorization. This can take a few seconds.');
        const syncOptions = normalizeEpicSyncOptions(opts);
        const authResult = await openEpicLoginWindow(parentWindow, syncOptions);
        const linkOperationId = opts?.__operationId || _createSyncRunId('epic-link');
        _emitEpicHistorySessionDiagnostic({
            stage: 'initial_login_authenticated', operationType: 'link', operationId: linkOperationId,
        });
        const authCode = typeof authResult === 'string' ? authResult : authResult?.authorizationCode;
        const closeEpicAuthWindow = typeof authResult === 'string' ? null : authResult?.close;
        emitState('resolving_identity', 'Reading your Epic account profile...');
        const tmpId = `epic_tmp_${Date.now()}`;
        const confPath = getLegendaryConfPath(tmpId);
        await fs.mkdir(confPath, { recursive: true });
        try {
            await runLegendary(['auth', '--code', authCode], confPath);

            // Read only non-secret Legendary identity fields from user.json.
            let legendaryUser = null;
            let pricingCountry = null;
            try {
                legendaryUser = await readEpicLegendaryUser(confPath);
                pricingCountry = normalizeEpicCountry(legendaryUser?.country);
                if (pricingCountry) verboseLog(`[Epic Region] pricingCountry=${pricingCountry}`);
                verboseLog('[Epic Link] Legendary identity fields resolved:', {
                    hasAccountId: Boolean(legendaryUser?.account_id),
                    hasDisplayName: Boolean(legendaryUser?.display_name),
                });
            } catch (err) {
                syncWarn('[Epic Region] Could not read Epic pricing country from Legendary user.json:', err?.message || String(err));
            }

            let statusRaw = {};
            try {
                statusRaw = JSON.parse(await runLegendary(['status', '--json'], confPath));
            } catch (err) {
                syncWarn('[Epic Link] Could not read Legendary status:', err?.message || String(err));
            }

            // Merge user.json data for more reliable identity resolution
            const status = {
                ...statusRaw,
                account_id:   legendaryUser?.account_id   || statusRaw?.account_id,
                display_name: legendaryUser?.display_name || statusRaw?.display_name,
            };

            emitState('saving_account', 'Saving linked Epic account...');

            // Check existing accounts so we can fall back to a saved name.
            const existingAccounts = await getEpicAccountsList().catch(() => []);
            const identity = resolveEpicAccountIdentity(status, null, tmpId);
            const { accountId, displayName, confidence } = identity;

            // Guard: if we still ended up with the tmp fallback id, auth succeeded but
            // Legendary did not expose the real account_id ? abort so we don't persist garbage.
            if (String(accountId) === String(tmpId) || String(accountId).startsWith('epic_tmp')) {
                throw new Error(
                    'Could not resolve your Epic account ID from Legendary. ' +
                    'Please try linking your account again.'
                );
            }
            _emitEpicHistorySessionDiagnostic({
                stage: 'account_identity_resolved',
                accountHash: crypto.createHash('sha256').update(String(accountId)).digest('hex').slice(0, 16),
                operationType: 'link', operationId: linkOperationId,
            });

            const existingEntry = existingAccounts.find(a => String(a.id) === String(accountId));
            const _isBadName = (n) => !n || /^epic user$/i.test(n) || /^Epic [0-9a-f]{6,8}$/i.test(n)
                || /^epic_tmp/i.test(n) || /^epic epic_tmp/i.test(n);
            // Use resolved name if it's real; fall back to previously-saved valid name.
            const finalDisplayName = !_isBadName(displayName) ? displayName
                : (!_isBadName(existingEntry?.displayName) ? existingEntry.displayName
                    : (displayName || 'Epic Account'));

            verboseLog('[Epic Link] Account identity resolved:', {
                accountHash: crypto.createHash('sha256').update(String(accountId)).digest('hex').slice(0, 16),
                confidence,
            });
            const realConfPath = getLegendaryConfPath(accountId);
            if (confPath !== realConfPath) {
                await fs.rename(confPath, realConfPath).catch(async () => {
                    await fs.cp(confPath, realConfPath, { recursive: true });
                    await fs.rm(confPath, { recursive: true, force: true });
                });
            }
            let accounts = await getEpicAccountsList();
            const existingIdx = accounts.findIndex(a => String(a.id) === String(accountId));
            if (existingIdx === -1) {
                accounts.push({ id: accountId, displayName: finalDisplayName, pricingCountry });
            } else {
                // Upgrade any invalid/fallback display name to the newly resolved real name.
                const old = accounts[existingIdx].displayName;
                if (_isBadName(old)) {
                    accounts[existingIdx].displayName = finalDisplayName;
                }
                if (pricingCountry) {
                    accounts[existingIdx].pricingCountry = pricingCountry;
                }
            }
            await saveEpicAccountsList(accounts);
            // Only write sync_link.json to an already-existing real switcher profile.
            // Never create a new folder ? that would cause the account to silently
            // appear in the Epic Account Switcher after a library-only sync.
            const matchingProfile = await _findMatchingEpicSwitcherProfile(accountId, finalDisplayName);
            if (matchingProfile) {
                await _writeSyncLinkToExistingSwitcherProfile('epic', matchingProfile, accountId, { epicDisplayName: finalDisplayName });
            } else {
                syncLog(`[Epic Link] No existing switcher profile matches "${finalDisplayName}"; sync_link skipped.`);
            }

            const historySessionBootstrap = await attemptOptionalEpicHistorySessionBootstrap({
                bootstrap: bootstrapEpicHistorySessionFromLogin,
                accountId,
                authResult,
                context: {
                    authoritativeIdentity: {
                        accountId,
                        source: 'legendary_authorization_code',
                        authorizationCodeBound: true,
                    },
                    onDiagnostic: (event) => _emitEpicHistorySessionDiagnostic({
                        ...event, operationType: 'link', operationId: linkOperationId,
                    }),
                },
            });
            if (!['verified', 'identity_indeterminate'].includes(historySessionBootstrap.status)) {
                _emitEpicHistorySessionDiagnostic({
                    stage: historySessionBootstrap.status === 'waiting_for_auth'
                        ? 'history_waiting_for_auth' : 'history_session_handoff_unavailable',
                    status: historySessionBootstrap.status,
                    code: historySessionBootstrap.code,
                    failedStage: historySessionBootstrap.failedStage,
                    accountHash: crypto.createHash('sha256').update(String(accountId)).digest('hex').slice(0, 16),
                    operationType: 'link', operationId: linkOperationId,
                });
            }
            let initialSyncGamesCount = 0;
            if (syncOptions.games || syncOptions.currentPrices || syncOptions.purchaseHistory) {
                emitState('starting_sync', 'Syncing Epic library inside Baddel...');
                const initialGames = await this.syncLibrary(accountId, {
                    ...syncOptions,
                    __operationId: linkOperationId,
                    __operationType: 'link',
                    __epicHistoryBootstrap: historySessionBootstrap,
                }, parentWindow);
                initialSyncGamesCount = Array.isArray(initialGames)
                    ? countGamesForAccount('epic', initialGames, accountId)
                    : 0;
            }
            emitState('linked', `Epic account linked as ${finalDisplayName}.`, { displayName: finalDisplayName, accountId });
            analytics.logPlatformLinked('epic').catch(() => {});
            return {
                displayName: finalDisplayName,
                accountId,
                epicAccountId: accountId,
                initialSyncComplete: true,
                gamesCount: initialSyncGamesCount,
                pricingCountry,
                historySessionBootstrap: {
                    status: historySessionBootstrap.status,
                    code: historySessionBootstrap.code || null,
                    failedStage: historySessionBootstrap.failedStage || null,
                    verificationSource: historySessionBootstrap.verificationSource || null,
                },
                operationType: 'link',
                operationId: linkOperationId,
            };
        } catch (err) {
            await fs.rm(confPath, { recursive: true, force: true }).catch(()=>{});
            throw err;
        } finally {
            if (closeEpicAuthWindow) closeEpicAuthWindow();
        }
    },
    async syncLibrary(targetAccountId = null, opts = {}, parentWindow = null, runtime = {}) {
        const syncOptions = normalizeEpicSyncOptions(opts);
        const hasExplicitOptionalSelection = Boolean(opts?.epicSyncOptions)
            || Object.prototype.hasOwnProperty.call(opts || {}, 'currentPrices')
            || Object.prototype.hasOwnProperty.call(opts || {}, 'purchaseHistory');
        const syncRunId = opts?.__syncRunId || _createSyncRunId('epic');
        await ensureDirs();
        const accounts = await getEpicAccountsList();
        if (accounts.length === 0) throw new Error('No Epic accounts linked.');

        const rawPreviousGames = await this.getCachedLibrary();
        // Evict any non-game entries (Fab, Blueprint CSV Parsing, etc.) that
        // may have been cached by an earlier version of the sync pipeline.
        const previousGames = rawPreviousGames.filter(isEpicSyncedGameAllowed);
        if (rawPreviousGames.length !== previousGames.length) {
            _pushPlatformSyncLog('epic', 'info',
                `Evicted ${rawPreviousGames.length - previousGames.length} cached non-game Epic entries from previous sync`);
        }

        // -- Ownership-safe merge seed -------------------------------------
        // Always start mergedLibrary from the full previous cache.
        //
        // For a full sync this is a no-op functionally: every account is
        // re-synced so all games will be overwritten with fresh data anyway.
        //
        // For a partial sync (targetAccountId is set) this is the critical
        // fix: non-target accounts' games and their ownership metadata on
        // shared games survive in the map before we apply fresh data on top.
        // This replaces the old "only preserve games not owned by target"
        // block, which stripped A's ownership from shared games when syncing B.
        const mergedLibrary = new Map(
            previousGames.map((g) => [g.id, JSON.parse(JSON.stringify(g))])
        );

        const accountResults = {};
        const classificationReports = [];
        const progressiveStates = new Map();
        let completedAccounts = 0;

        // If targeting a specific account, filter the list
        const accountsToSync = targetAccountId 
            ? accounts.filter(a => String(a.id) === String(targetAccountId))
            : accounts;

        if (accountsToSync.length === 0 && targetAccountId) {
            syncWarn(`[EpicSync] Target account ${targetAccountId} not found.`);
        }

        _startPlatformSync('epic', accountsToSync, `Syncing Epic library for ${accountsToSync.length} account(s)`, {
            operationType: opts?.__operationType || 'sync', operationId: opts?.__operationId || null, syncRunId,
        });
        analytics.logSyncStarted?.('epic', accountsToSync.length, targetAccountId ? 'single_account' : 'library')?.catch?.(() => {});

        const vaultBeforeLibrary = await syncCacheRepository.readEpicVault().catch(() => ({ accounts: [] }));
        for (const account of accountsToSync) {
            const existingVault = Array.isArray(vaultBeforeLibrary.accounts)
                ? vaultBeforeLibrary.accounts.find((item) => String(item.accountId) === String(account.id))
                : null;
            const state = await epicProgressiveSyncCoordinator.beginAccount({
                accountId: account.id,
                syncRunId,
                isFirstFullImport: !hasUsableEpicPurchaseHistory(existingVault),
                options: {
                    ...syncOptions,
                    preserveTerminalOptionalState: !hasExplicitOptionalSelection,
                },
            });
            progressiveStates.set(String(account.id), state);
            _updatePlatformSyncAccount('epic', account.id, {
                gamesCount: countGamesForAccount('epic', previousGames, account.id),
                message: 'Queued for sync',
            });
        }

        try {
            const syncResults = await mapWithConcurrency(accountsToSync, 2, async (acc) => {
                _updatePlatformSyncProgress('epic', {
                    completedAccounts,
                    totalAccounts: accountsToSync.length,
                    currentAccountId: String(acc.id),
                    currentAccountName: acc.displayName,
                });
                const libraryOnlyOptions = { ...syncOptions, currentPrices: false, purchaseHistory: false };
                const result = await syncSingleEpicAccount(acc, previousGames, targetAccountId, libraryOnlyOptions, parentWindow, {
                    libraryOnly: true,
                });
                if (result.status === 'skipped') return null;

                completedAccounts += 1;
                _updatePlatformSyncProgress('epic', {
                    completedAccounts,
                    totalAccounts: accountsToSync.length,
                    currentAccountId: String(acc.id),
                    currentAccountName: acc.displayName,
                });
                return { account: acc, ...result };
            });

            for (const item of syncResults) {
                if (!item) continue;
                replaceEpicOwnerDisplayName(mergedLibrary, item.accountNameChange);
                accountResults[item.aid] = item.result;
                if (item.classificationReport) classificationReports.push(item.classificationReport);

                // mergeOwnedGamesIntoLibrary merges fresh games into the map.
                // For games already seeded from previousGames (shared games),
                // the merge path adds the target account's id/name to the
                // existing entry ? so shared games end up with ALL owners.
                // For new games introduced by this sync they are added fresh.
                mergeOwnedGamesIntoLibrary(mergedLibrary, item.games, item.account, 'epic');

                // For a partial sync, also repair any non-target ownership
                // that the merge above may have lost (e.g. display names that
                // are duplicated differently).  This is a safety pass that
                // re-applies cached non-target ownership onto shared games.
                if (targetAccountId) {
                    const targetAid = String(targetAccountId);
                    for (const freshGame of item.games) {
                        const cached = previousGames.find((p) => p.id === freshGame.id);
                        if (!cached) continue;
                        const merged = mergedLibrary.get(freshGame.id);
                        if (!merged) continue;
                        mergeExistingEpicOwnership(merged, cached, targetAid);
                    }
                }

                // NOTE: metadata sync is deferred to the single post-finalization call on finalGames.
            }

            const finalizeStart = performance.now();
            const finalized = finalizeLibraryForAccounts({
                platform: 'epic',
                previousGames,
                nextGames: Array.from(mergedLibrary.values()),
                accounts: accountsToSync,
                accountResults,
            });
            // Cache cleanup: remove any Fab/marketplace entries that survived
            // from a previous sync before the filter was in place.
            _syncTraceStage(syncRunId, "merge.finalize", finalizeStart, { previousGames: previousGames.length, nextGames: mergedLibrary.size, finalGames: finalized.games.length });
            const rawFinalGames = finalized.games;
            const finalGames = rawFinalGames.filter(isEpicSyncedGameAllowed);
            const cleanedCount = rawFinalGames.length - finalGames.length;
            if (cleanedCount > 0) {
                _pushPlatformSyncLog('epic', 'info',
                    `Evicted ${cleanedCount} cached non-game Epic entries during cleanup`);
            }

            for (const acc of accountsToSync) {
                const aid = String(acc.id);
                const existingState = _getPlatformSyncState('epic').accounts?.[aid] || {};
                _updatePlatformSyncAccount('epic', aid, {
                    gamesCount: finalized.validation.countsByAccount?.[aid] ?? existingState.gamesCount ?? 0,
                });
            }

            for (const issue of finalized.validation.issues || []) {
                _pushPlatformSyncLog('epic', 'warn', issue);
            }

            const writeStart = performance.now();
            const epicCommitSnapshot = await syncCacheRepository.writeEpicMergedLibrary(finalGames);
            _syncTraceStage(syncRunId, "commit.atomic-write", writeStart, { changed: epicCommitSnapshot?.changed !== false, diagnostics: epicCommitSnapshot?.writeDiagnostics || null });

            const vaultAtLibraryCommit = await syncCacheRepository.readEpicVault().catch(() => ({ accounts: [] }));
            for (const account of accountsToSync) {
                const aid = String(account.id);
                const started = progressiveStates.get(aid);
                if (!started) continue;
                const accountGames = finalGames.filter((game) => Array.isArray(game.ownedByAccountIds)
                    && game.ownedByAccountIds.some((id) => String(id) === aid));
                const previousVaultAccount = (vaultAtLibraryCommit.accounts || []).find((item) => String(item.accountId) === aid) || null;
                const libraryVault = buildMinimalEpicVaultAccount({ account, games: accountGames, existingVault: previousVaultAccount });
                libraryVault.libraryRevision = started.revision;
                libraryVault.libraryDiagnostics = accountResults[aid]?.libraryDiagnostics || null;
                const committedLibrary = await syncCacheRepository.mergeEpicVaultAccountPhase({
                    accountId: aid,
                    phase: 'library',
                    patch: sanitizeEpicVaultAccount(libraryVault),
                    assertCurrent: () => epicProgressiveSyncCoordinator.assertCurrent(aid, syncRunId, started.revision),
                });
                const state = await epicProgressiveSyncCoordinator.markLibraryCommitted({
                    accountId: aid,
                    syncRunId,
                    revision: started.revision,
                    gamesFetched: accountGames.length,
                    committedRevision: committedLibrary?.vaultRevision ?? null,
                });
                startEpicProgressiveOptionalPhases({
                    account,
                    games: accountGames,
                    state,
                    syncOptions,
                    parentWindow,
                    allowInteractiveLogin: opts?.__allowInteractiveEpicHistory === true,
                    historySessionBootstrap: opts?.__epicHistoryBootstrap || null,
                });
            }

            // Consumers of this event read both the merged library and Epic Vault.
            // Emit only after every account's library phase is durably committed.
            await _emitPlatformLibraryCommitted('epic', undefined, {
                syncRunId,
                snapshot: epicCommitSnapshot,
                forceEmit: true,
            });

            // -- Cover-first image caching (fire-and-forget) -------------------
                        _recordPostSyncArtworkWarmupSkipped(syncRunId, 'epic', finalGames);

            // -- Write classification report (non-blocking) --------------------
            syncCacheRepository.writeEpicClassificationReport({
                generatedAt: new Date().toISOString(),
                accounts: classificationReports,
            }).catch(err =>
                _pushPlatformSyncLog('epic', 'warn', `Failed to write classification report: ${err.message}`)
            );

            // -- Send to Baddel server in background --------------------------
            _pushPlatformSyncLog('epic', 'info', 'Sending library to Baddel server...');
            _importLibraryToServer('epic', finalGames).catch(err =>
                _pushPlatformSyncLog('epic', 'warn', `Baddel server import failed: ${err.message}`)
            );

            _updatePlatformSyncProgress('epic', {
                completedAccounts: accountsToSync.length,
                totalAccounts: accountsToSync.length,
                currentAccountId: null,
                currentAccountName: null,
            });
            const optionalSelected = syncOptions.currentPrices || syncOptions.purchaseHistory;
            const firstFullImport = [...progressiveStates.values()].some((state) => state.isFirstFullImport);
            const readyStatus = optionalSelected
                ? 'Your Epic games are ready. Baddel is still importing prices and Purchase History in the background.'
                    + (firstFullImport ? ' The first full Epic import may take a while. Future refreshes will normally reuse saved data.' : '')
                : (finalized.validation.issues.length > 0
                    ? `Epic sync completed with recovery checks. ${finalGames.length} games ready.`
                    : `Epic sync completed. ${finalGames.length} games ready.`);
            _finishPlatformSync('epic', {
                syncRunId,
                phase: 'done',
                statusText: readyStatus,
                validation: finalized.validation,
                summary: {
                    totalGames: finalGames.length,
                    installOnlyGames: 0,
                },
            });
            analytics.logSyncCompleted('epic', finalGames.length, accountsToSync.length).catch(() => {});
            return finalGames;
        } catch (err) {
            _finishPlatformSync('epic', {
                syncRunId,
                phase: 'error',
                statusText: `Epic sync failed: ${err.message}`,
                lastError: err.message,
            });
            _pushPlatformSyncLog('epic', 'error', `Epic sync crashed: ${err.message}`);
            analytics.logSyncFailed('epic', err.message).catch(() => {});
            throw err;
        }
    },
    async getCachedLibrary() {
        return syncCacheRepository.readEpicMergedLibrary();
    },
    async unlink(accountId) {
        let accounts = await getEpicAccountsList();
        const cancelledAccountIds = accountId ? [accountId] : accounts.map((account) => account.id);
        await Promise.all(cancelledAccountIds.map((id) => epicProgressiveSyncCoordinator.cancelAccount(id)));
        const removedAccount = accountId
            ? accounts.find((account) => String(account.id) === String(accountId)) || null
            : null;
        if (accountId) {
            await clearEpicHistorySession(accountId);
            const confPath = getLegendaryConfPath(accountId);
            try { await runLegendary(['auth', '--delete'], confPath); } catch {}
            await fs.rm(confPath, { recursive: true, force: true }).catch(()=>{});
            accounts = accounts.filter(a => a.id !== accountId);
        } else {
            for (const acc of accounts) {
                await clearEpicHistorySession(acc.id);
                const confPath = getLegendaryConfPath(acc.id);
                try { await runLegendary(['auth', '--delete'], confPath); } catch {}
                await fs.rm(confPath, { recursive: true, force: true }).catch(()=>{});
            }
            accounts = [];
        }
        await saveEpicAccountsList(accounts);
        if (accounts.length === 0) {
            await syncCacheRepository.deleteEpicMergedLibrary();
            await syncCacheRepository.deleteEpicVault();
            await _emitPlatformLibraryCommitted('epic');
        } else if (removedAccount) {
            const cachedGames = await this.getCachedLibrary();
            const filteredGames = removeAccountFromLibrary('epic', cachedGames, removedAccount);
            const snapshot = await syncCacheRepository.writeEpicMergedLibrary(filteredGames);
            await syncCacheRepository.removeEpicVaultAccount(accountId);
            await _emitPlatformLibraryCommitted('epic', undefined, { snapshot });
        }
        analytics.logPlatformUnlinked('epic').catch(() => {});
    },
};

// ============================================================
// --- GOG CONNECTOR ------------------------------------------
// ============================================================

async function getGogAccountsList() {
    return syncCacheRepository.readGogAccounts();
}

async function saveGogAccountsList(accounts) {
    await syncCacheRepository.writeGogAccountsAtomic(accounts);
}

function resolveGogDisplayName(credentials, existingAccount = null) {
    const candidates = [
        credentials?.displayName,
        credentials?.username,
        credentials?.user?.username,
        credentials?.user?.displayName,
        existingAccount?.displayName,
    ].map(v => String(v || '').trim()).filter(Boolean);
    if (candidates.length > 0) return candidates[0];
    const id = String(credentials?.userId || credentials?.id || '');
    return id ? `GOG ${id.slice(-6)}` : 'GOG Account';
}

function resolveGogStorePageUrl(product, release) {
    const candidates = [
        product?.url,
        product?.storeUrl,
        product?.store_url,
        product?.links?.product,
        product?.links?.store,
        product?.links?.self,
        product?._links?.product?.href,
        product?._links?.store?.href,
    ].map(v => String(v || '').trim()).filter(Boolean);
    const absolute = candidates.find(v => /^https?:\/\/(?:www\.)?gog\.com\/game\//i.test(v));
    if (absolute) return absolute;

    const slug = String(
        product?.slug ||
        product?.productSlug ||
        product?.product_slug ||
        release?.slug ||
        release?.product_slug ||
        ''
    ).trim();
    if (!slug || /[\/\\]/.test(slug)) return null;
    return `https://www.gog.com/game/${encodeURIComponent(slug)}`;
}

function normalizeGogCatalogTitle(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}

function pickGogCatalogProduct(catalog, release) {
    const products = Array.isArray(catalog?.products) ? catalog.products : [];
    if (!products.length) return null;
    const title = normalizeGogCatalogTitle(release?.title?.['*'] || release?.title || release?.name);
    if (!title) return null;
    const exact = products.find(product => normalizeGogCatalogTitle(product?.title) === title);
    if (exact) return exact;
    return null;
}

function isGogAmazonPrimeRelease(release) {
    const values = [
        release?.title?.['*'],
        release?.title,
        release?.name,
        release?.game?.title?.['*'],
        release?.game?.title,
    ];
    return values.some((value) => /\bamazon\s+prime\b/i.test(String(value || '')));
}

function hasGogStoreDescription(product) {
    return !!(
        product?.description?.full ||
        product?.description?.lead ||
        product?.summary ||
        product?.short_description ||
        product?.shortDescription
    );
}

function hasGogStoreReleaseDate(product) {
    return !!(
        product?.release_date ||
        product?.releaseDate ||
        product?.globalReleaseDate ||
        product?._catalogProduct?.releaseDate ||
        product?._catalogProduct?.release_date
    );
}

function hasGogStoreRequirements(product) {
    return !!(
        product?.requirements ||
        product?.system_requirements ||
        product?.systemRequirements ||
        product?.content_system_compatibility?.requirements
    );
}

function shouldFetchGogStorePage(product) {
    if (!product) return true;
    return !hasGogStoreDescription(product) ||
        !hasGogStoreReleaseDate(product) ||
        !hasGogStoreRequirements(product);
}

async function fetchGogStoreMetadata(release, credentials = {}, stats = null, { allowStorePage = true } = {}) {
    let storeProduct = null;
    const productStart = performance.now();
    if (stats) stats.storeProduct.requestCount += 1;
    try {
        storeProduct = await gogApiClient.fetchStoreProductData({
            productId: release.external_id,
            accessToken: credentials.accessToken,
        });
        if (stats) stats.storeProduct.successCount += 1;
    } catch (err) {
        if (stats) stats.storeProduct.failureCount += 1;
        if (err?.status === 400) {
            if (stats) stats.optionalProductMisses = (stats.optionalProductMisses || 0) + 1;
            verboseLog(`[GogSync] Optional store product unavailable for external id ${release?.external_id}: ${redactGogSecrets(err?.message || err)}`);
        } else {
            if (stats) stats.optionalProductFailures = (stats.optionalProductFailures || 0) + 1;
            syncWarn(`[GogSync] Failed to fetch store product by external id ${release?.external_id}: ${redactGogSecrets(err?.message || err)}`);
        }
    } finally {
        if (stats) stats.storeProduct.totalElapsedMs += performance.now() - productStart;
    }

    if (!resolveGogStorePageUrl(storeProduct, release)) {
        const query = release?.title?.['*'] || release?.title || release?.name;
        if (query) {
            const catalogStart = performance.now();
            try {
                if (stats) stats.catalogSearch.requestCount += 1;
                const catalog = await gogApiClient.searchStoreCatalog({ query });
                if (stats) stats.catalogSearch.successCount += 1;
                const catalogProduct = pickGogCatalogProduct(catalog, release);
                if (catalogProduct) {
                    storeProduct = {
                        ...(storeProduct || {}),
                        ...catalogProduct,
                        _catalogProduct: catalogProduct,
                    };
                }
            } catch (catalogErr) {
                if (stats) stats.catalogSearch.failureCount += 1;
                syncWarn(`[GogSync] Failed to search GOG catalog for ${release?.external_id}: ${redactGogSecrets(catalogErr?.message || catalogErr)}`);
            } finally {
                if (stats) stats.catalogSearch.totalElapsedMs += performance.now() - catalogStart;
            }
        }
    }

    let storePage = null;
    const pageUrl = resolveGogStorePageUrl(storeProduct, release);
    if (allowStorePage && pageUrl && shouldFetchGogStorePage(storeProduct)) {
        const pageStart = performance.now();
        try {
            if (stats) stats.storePage.requestCount += 1;
            storePage = await gogApiClient.fetchStorePageData({ url: pageUrl });
            if (stats) stats.storePage.successCount += 1;
        } catch (pageErr) {
            if (stats) stats.storePage.failureCount += 1;
            syncWarn(`[GogSync] Failed to fetch store page metadata for ${release?.external_id}: ${redactGogSecrets(pageErr?.message || pageErr)}`);
        } finally {
            if (stats) stats.storePage.totalElapsedMs += performance.now() - pageStart;
        }
    }
    return { storeProduct, storePage };
}

async function buildGogOwnedGameEntries(account, releases = [], credentials = {}, metrics = null, previousGames = [], classificationIndex = {}) {
    const storeStats = metrics || {
        optionalProductMisses: 0,
        optionalProductFailures: 0,
        gamesDb: { requestCount: 0, successCount: 0, failureCount: 0, totalElapsedMs: 0 },
        storeProduct: { requestCount: 0, successCount: 0, failureCount: 0, totalElapsedMs: 0 },
        catalogSearch: { requestCount: 0, successCount: 0, failureCount: 0, totalElapsedMs: 0 },
        storePage: { requestCount: 0, successCount: 0, failureCount: 0, totalElapsedMs: 0 },
    };
    const previousById = new Map((previousGames || []).map((game) => [String(game?.id || ''), game]));
    storeStats.cache = { unchangedSkipped: 0, newGames: 0, titleRepairs: 0, coverRepairs: 0 };
    const games = await mapWithConcurrency(releases, 6, async (release) => {
        if (String(release?.platform_id || '').toLowerCase() !== 'gog') return null;
        if (isGogAmazonPrimeRelease(release)) return null;
        const ownedProductId = String(release?.external_id || '').trim();
        const existing = previousById.get(`gog_${ownedProductId}`) || null;
        const syncClass = classifyGogSyncCandidate(existing, classificationIndex[ownedProductId]);
        if (syncClass === 'known-non-game') {
            storeStats.cache.unchangedSkipped += 1;
            return null;
        }
        if (syncClass === 'unchanged') {
            classificationIndex[ownedProductId] = { kind: 'game', checkedAt: classificationIndex[ownedProductId]?.checkedAt || new Date().toISOString() };
            storeStats.cache.unchangedSkipped += 1;
            return {
                ...existing,
                lastSynced: new Date().toISOString(),
                ownedBy: account?.displayName ? [String(account.displayName)] : [],
                ownedByAccountIds: account?.id ? [String(account.id)] : [],
            };
        }
        if (syncClass === 'new') storeStats.cache.newGames += 1;
        else {
            if (syncClass === 'title-repair') storeStats.cache.titleRepairs += 1;
            if (syncClass === 'cover-repair') storeStats.cache.coverRepairs += 1;
        }
        const gamesDbStart = performance.now();
        storeStats.gamesDb.requestCount += 1;
        try {
            const details = await gogApiClient.fetchGamesDbData({
                platform: 'gog',
                externalId: release.external_id,
                certificate: release.certificate,
                accessToken: credentials.accessToken,
            });
            storeStats.gamesDb.successCount += 1;
            storeStats.gamesDb.totalElapsedMs += performance.now() - gamesDbStart;
            let normalized = normalizeGogRelease({ ...details, _libraryEntry: release }, account);
            if (!normalized) {
                classificationIndex[ownedProductId] = { kind: 'non-game', checkedAt: new Date().toISOString() };
                return null;
            }
            classificationIndex[ownedProductId] = { kind: 'game', checkedAt: new Date().toISOString() };
            normalized = preserveGogLastKnownGood(existing, normalized);
            if (!hasGoodGogBasicMetadata(normalized)) {
                let storeProduct = null;
                try {
                    ({ storeProduct } = await fetchGogStoreMetadata({
                    ...release,
                    title: details?.title || release?.title,
                    name: details?.title?.['*'] || details?.title || release?.name,
                    }, credentials, storeStats, { allowStorePage: false }));
                    normalized = preserveGogLastKnownGood(existing, normalizeGogRelease({ ...details, _storeProduct: storeProduct, _libraryEntry: release }, account));
                } catch (storeErr) {
                    syncWarn(`[GogSync] Failed to fetch basic store metadata for ${release?.external_id}: ${redactGogSecrets(storeErr?.message || storeErr)}`);
                }
            }
            return normalized;
        } catch (err) {
            storeStats.gamesDb.failureCount += 1;
            storeStats.gamesDb.totalElapsedMs += performance.now() - gamesDbStart;
            syncWarn(`[GogSync] Failed to fetch game details for ${release?.external_id}: ${redactGogSecrets(err?.message || err)}`);
            try {
                const { storeProduct } = await fetchGogStoreMetadata(release, credentials, storeStats, { allowStorePage: false });
                return preserveGogLastKnownGood(existing, normalizeGogRelease({ ...release, _storeProduct: storeProduct }, account));
            } catch (storeErr) {
                syncWarn(`[GogSync] Failed to fetch store metadata for ${release?.external_id}: ${redactGogSecrets(storeErr?.message || storeErr)}`);
                return preserveGogLastKnownGood(existing, normalizeGogRelease(release, account));
            }
        }
    }).then((items) => items.filter(Boolean));

    if (storeStats.optionalProductFailures > 0) {
        syncWarn(`[GogSync] Store enrichment optional product failures=${storeStats.optionalProductFailures}`);
    }
    if (storeStats.optionalProductMisses > 0) {
        verboseLog(`[GogSync] Store enrichment optional product misses=${storeStats.optionalProductMisses}`);
    }
    return games;
}
async function syncSingleGogAccount(account, previousGames, syncRunId = null, classificationIndex = {}) {
    const aid = String(account.id);
    const previousCount = countGamesForAccount('gog', previousGames, aid);
    const accountStart = performance.now();
    const metrics = {
        gamesDb: { requestCount: 0, successCount: 0, failureCount: 0, totalElapsedMs: 0 },
        storeProduct: { requestCount: 0, successCount: 0, failureCount: 0, totalElapsedMs: 0 },
        catalogSearch: { requestCount: 0, successCount: 0, failureCount: 0, totalElapsedMs: 0 },
        storePage: { requestCount: 0, successCount: 0, failureCount: 0, totalElapsedMs: 0 },
    };
    try {
        _updatePlatformSyncAccount('gog', aid, {
            status: 'syncing',
            startedAt: new Date().toISOString(),
            message: 'Refreshing GOG credentials',
        });

        const credentialsReadStart = performance.now();
        let credentials = await gogAuthService.readCredentials(aid);
        metrics.credentialsReadMs = performance.now() - credentialsReadStart;
        metrics.credentialsRefreshMs = 0;
        metrics.refreshWasActuallyRequired = false;
        const refreshCredentialsOnce = async () => {
            const credentialsRefreshStart = performance.now();
            credentials = await gogAuthService.refreshCredentials(aid);
            metrics.credentialsRefreshMs += performance.now() - credentialsRefreshStart;
            metrics.refreshWasActuallyRequired = true;
            return credentials;
        };
        try {
            let profile;
            try {
                profile = await gogApiClient.fetchUserDetails({
                    userId: credentials.userId || aid,
                    accessToken: credentials.accessToken,
                });
            } catch (profileError) {
                if (profileError?.status !== 401) throw profileError;
                await refreshCredentialsOnce();
                profile = await gogApiClient.fetchUserDetails({
                    userId: credentials.userId || aid,
                    accessToken: credentials.accessToken,
                });
            }
            account.displayName = resolveGogDisplayName({ ...credentials, user: profile, ...profile }, account);
        } catch (err) {
            syncWarn(`[GogSync] Could not refresh account profile for ${aid}: ${redactGogSecrets(err?.message || err)}`);
        }
        _updatePlatformSyncAccount('gog', aid, { message: 'Reading GOG library' });
        const libraryStats = {};
        const libraryStart = performance.now();
        const releases = await gogApiClient.fetchLibraryReleases({
            userId: credentials.userId || aid,
            accessToken: credentials.accessToken,
            refreshAuth: refreshCredentialsOnce,
            stats: libraryStats,
        });
        metrics.libraryFetchMs = performance.now() - libraryStart;
        metrics.numberOfPages = libraryStats.numberOfPages || 0;
        metrics.rawReleaseCount = releases.length;
        const buildStart = performance.now();
        const games = await buildGogOwnedGameEntries(account, releases, credentials, metrics, previousGames, classificationIndex);
        metrics.buildGogOwnedGameEntriesMs = performance.now() - buildStart;
        metrics.eligibleGameCount = games.length;
        metrics.totalAccountSyncMs = performance.now() - accountStart;
        _syncTraceStage(syncRunId, 'gog.account-sync', accountStart, { accountIdHash: crypto.createHash('sha256').update(aid).digest('hex').slice(0, 12), metrics });

        _updatePlatformSyncAccount('gog', aid, {
            status: 'synced',
            finishedAt: new Date().toISOString(),
            gamesCount: games.length,
            gameTitles: summarizeGameTitles(games),
            message: `Synced ${games.length} games`,
        });
        return {
            aid,
            games,
            result: {
                status: 'success',
                rawGamesCount: releases.length,
                allowZeroGames: true,
                displayName: account.displayName,
            },
        };
    } catch (err) {
        const code = err?.code || 'GOG_LIBRARY_REQUEST_FAILED';
        const message = redactGogSecrets(err?.message || 'GOG sync failed.');
        const isAuth = code === 'GOG_AUTH_EXPIRED' || code === 'GOG_AUTH_FAILED' || /auth/i.test(message);
        if (isAuth) {
            const accounts = await getGogAccountsList();
            const nextAccounts = accounts.map((acc) => String(acc.id) === aid
                ? { ...acc, needsReauth: true, credentialStatus: 'invalid' }
                : acc);
            await saveGogAccountsList(nextAccounts);
        }
        _updatePlatformSyncAccount('gog', aid, {
            status: isAuth ? 'needs_reauth' : 'error',
            finishedAt: new Date().toISOString(),
            gamesCount: previousCount,
            message: isAuth ? 'Reconnect required' : message,
        });
        _pushPlatformSyncLog('gog', isAuth ? 'warn' : 'error', `Failed to sync ${account.displayName}: ${message}`, {
            accountId: aid,
            accountName: account.displayName,
        });
        return {
            aid,
            games: [],
            result: {
                status: isAuth ? 'needs_reauth' : 'error',
                rawGamesCount: 0,
                validationFailed: true,
            },
        };
    }
}

const gogConnectorMethods = {
    isLinked() {
        return syncCacheRepository.isGogLinked();
    },
    getAccounts() {
        const raw = syncCacheRepository.readGogAccountsSync();
        if (!Array.isArray(raw)) return [];
        return raw.filter(a => a?.id).map(a => ({ ...a, id: String(a.id) }));
    },
    async link(parentWindow, emitState = () => {}) {
        analytics.logAccountAddStarted?.('gog', 'platform_sync')?.catch?.(() => {});
        await ensureDirs();
        emitState('authenticating', 'Waiting for GOG authorization...');
        const credentials = await gogAuthService.link(parentWindow, emitState);
        const accountId = String(credentials.userId);
        const now = new Date().toISOString();
        const accounts = await getGogAccountsList();
        const existingIndex = accounts.findIndex(a => String(a.id) === accountId);
        const displayName = resolveGogDisplayName(credentials, existingIndex >= 0 ? accounts[existingIndex] : null);
        const accountEntry = {
            id: accountId,
            displayName,
            status: 'linked',
            credentialStatus: 'ok',
            needsReauth: false,
            lastLinkedAt: now,
            ...(existingIndex >= 0
                ? {
                    lastSyncedAt: accounts[existingIndex].lastSyncedAt,
                    gamesCount: accounts[existingIndex].gamesCount,
                }
                : {}),
        };
        if (existingIndex >= 0) accounts[existingIndex] = { ...accounts[existingIndex], ...accountEntry };
        else accounts.push(accountEntry);
        await saveGogAccountsList(accounts);
        // GOG reconciliation is exact-ID-only and never creates switcher folders.
        // Null-ID legacy profiles remain unverified until Galaxy itself proves the ID.
        await getDefaultGogAccountSwitcher().reconcilePlatformAccountId(accountId).catch((error) => {
            syncWarn('[GogSync] Switcher identity reconciliation skipped:', error?.code || error?.message);
        });
        emitState('linked', `GOG account linked as ${displayName}.`, { displayName, accountId, userId: accountId });
        analytics.logPlatformLinked('gog').catch(() => {});
        return { displayName, accountId, userId: accountId };
    },
    async syncLibrary(targetAccountId = null, opts = {}) {
        const syncRunId = opts?.__syncRunId || null;
        await ensureDirs();
        const allAccounts = await getGogAccountsList();
        if (allAccounts.length === 0) throw new Error('No GOG accounts linked.');

        const previousGames = await this.getCachedLibrary();
        const classificationIndex = await syncCacheRepository.readGogBasicIndex();
        const accountsToSync = targetAccountId
            ? allAccounts.filter(a => String(a.id) === String(targetAccountId))
            : allAccounts;
        if (accountsToSync.length === 0 && targetAccountId) {
            syncWarn(`[GogSync] Target account ${targetAccountId} not found.`);
        }

        const mergedLibrary = new Map(previousGames.map((g) => [g.id, JSON.parse(JSON.stringify(g))]));
        const accountResults = {};
        let completedAccounts = 0;

        _startPlatformSync('gog', accountsToSync, `Syncing GOG library for ${accountsToSync.length} account(s)`);
        analytics.logSyncStarted?.('gog', accountsToSync.length, targetAccountId ? 'single_account' : 'library')?.catch?.(() => {});
        for (const account of accountsToSync) {
            _updatePlatformSyncAccount('gog', account.id, {
                gamesCount: countGamesForAccount('gog', previousGames, account.id),
                message: 'Queued for sync',
            });
        }

        try {
            const syncResults = await mapWithConcurrency(accountsToSync, 2, async (account) => {
                _updatePlatformSyncProgress('gog', {
                    completedAccounts,
                    totalAccounts: accountsToSync.length,
                    currentAccountId: String(account.id),
                    currentAccountName: account.displayName,
                });
                const result = await syncSingleGogAccount(account, previousGames, syncRunId, classificationIndex);
                completedAccounts += 1;
                _updatePlatformSyncProgress('gog', {
                    completedAccounts,
                    totalAccounts: accountsToSync.length,
                    currentAccountId: String(account.id),
                    currentAccountName: account.displayName,
                });
                return { account, ...result };
            });

            for (const item of syncResults) {
                accountResults[item.aid] = item.result;
                if (item.result.status === 'success') {
                    for (const cached of previousGames) {
                        const ownsTarget = Array.isArray(cached.ownedByAccountIds)
                            && cached.ownedByAccountIds.map(String).includes(String(item.aid));
                        if (!ownsTarget) continue;
                        const freshStillOwns = item.games.some((game) => game.id === cached.id);
                        if (!freshStillOwns) {
                            const existing = mergedLibrary.get(cached.id);
                            if (existing) {
                                existing.ownedByAccountIds = (existing.ownedByAccountIds || []).filter((id) => String(id) !== String(item.aid));
                                existing.ownedBy = (existing.ownedBy || []).filter((name) => String(name) !== String(item.account.displayName));
                                if ((existing.ownedByAccountIds || []).length === 0 && existing.installOnly !== true) {
                                    mergedLibrary.delete(cached.id);
                                }
                            }
                        }
                    }
                    mergeGogGames(mergedLibrary, item.games, item.account);
                }
            }

            await syncCacheRepository.writeGogBasicIndex(classificationIndex);
            const finalizeStart = performance.now();
            const finalized = finalizeLibraryForAccounts({
                platform: 'gog',
                previousGames,
                nextGames: Array.from(mergedLibrary.values()),
                accounts: accountsToSync,
                accountResults,
            });
            const finalGames = finalized.games;
            _syncTraceStage(syncRunId, "merge.finalize", finalizeStart, { previousGames: previousGames.length, nextGames: mergedLibrary.size, finalGames: finalGames.length });
            const writeStart = performance.now();
            const gogCommitSnapshot = await syncCacheRepository.writeGogMergedLibrary(finalGames);
            _syncTraceStage(syncRunId, "commit.atomic-write", writeStart, { changed: gogCommitSnapshot?.changed !== false, diagnostics: gogCommitSnapshot?.writeDiagnostics || null });
            await _emitPlatformLibraryCommitted('gog', undefined, { syncRunId, snapshot: gogCommitSnapshot });

            const accounts = await getGogAccountsList();
            const now = new Date().toISOString();
            await saveGogAccountsList(accounts.map((account) => {
                if (!accountsToSync.some((target) => String(target.id) === String(account.id))) return account;
                const result = accountResults[String(account.id)];
                if (result?.status !== 'success') return account;
                return {
                    ...account,
                    displayName: result.displayName || account.displayName,
                    credentialStatus: 'ok',
                    needsReauth: false,
                    lastSyncedAt: now,
                    gamesCount: countGamesForAccount('gog', finalGames, account.id),
                };
            }));

                        _recordPostSyncArtworkWarmupSkipped(syncRunId, 'gog', finalGames);

            _pushPlatformSyncLog('gog', 'info', 'GOG server enrichment is not enabled yet; local sync completed without server import.');
            _updatePlatformSyncProgress('gog', {
                completedAccounts: accountsToSync.length,
                totalAccounts: accountsToSync.length,
                currentAccountId: null,
                currentAccountName: null,
            });
            _finishPlatformSync('gog', {
                syncRunId,
                phase: finalized.validation.issues.length > 0 ? 'done' : 'done',
                statusText: finalized.validation.issues.length > 0
                    ? `GOG sync completed with recovery checks. ${finalGames.length} games ready.`
                    : `GOG sync completed. ${finalGames.length} games ready.`,
                validation: finalized.validation,
                summary: {
                    totalGames: finalGames.length,
                    installOnlyGames: 0,
                },
            });
            analytics.logSyncCompleted('gog', finalGames.length, accountsToSync.length).catch(() => {});
            return finalGames;
        } catch (err) {
            const message = redactGogSecrets(err?.message || 'GOG sync failed.');
            _finishPlatformSync('gog', {
                syncRunId,
                phase: 'error',
                statusText: `GOG sync failed: ${message}`,
                lastError: message,
            });
            _pushPlatformSyncLog('gog', 'error', `GOG sync crashed: ${message}`);
            analytics.logSyncFailed('gog', message).catch(() => {});
            throw err;
        }
    },
    async getCachedLibrary() {
        return syncCacheRepository.readGogMergedLibrary();
    },
    async unlink(accountId) {
        let accounts = await getGogAccountsList();
        const removedAccount = accountId
            ? accounts.find((account) => String(account.id) === String(accountId)) || null
            : null;
        if (accountId) {
            await gogAuthService.unlink(accountId);
            accounts = accounts.filter(a => String(a.id) !== String(accountId));
        } else {
            for (const acc of accounts) await gogAuthService.unlink(acc.id);
            accounts = [];
        }
        await saveGogAccountsList(accounts);
        if (accounts.length === 0) {
            await syncCacheRepository.deleteGogMergedLibrary();
            await _emitPlatformLibraryCommitted('gog');
        } else if (removedAccount) {
            const cachedGames = await this.getCachedLibrary();
            const filteredGames = removeAccountFromLibrary('gog', cachedGames, removedAccount);
            await syncCacheRepository.writeGogMergedLibrary(filteredGames);
            await _emitPlatformLibraryCommitted('gog');
        }
        analytics.logPlatformUnlinked('gog').catch(() => {});
    },
};

const {
    steamConnector,
    epicConnector,
    gogConnector,
    ALL_CONNECTORS,
} = createSyncConnectors({
    steam: steamConnectorMethods,
    epic: epicConnectorMethods,
    gog: gogConnectorMethods,
});

// --- IPC Handler Registry ------------------------------------

async function _cleanupEpicTmpConfigs() {
    try {
        const userData = app.getPath('userData');
        const entries = await fs.readdir(userData).catch(() => []);
        await Promise.all(
            entries
                .filter((e) => /^legendary-config-epic_tmp_/i.test(e))
                .map((e) => {
                    const dir = path.join(userData, e);
                    syncLog('[EpicLink] Cleaning up orphaned tmp config dir:', e);
                    return fs.rm(dir, { recursive: true, force: true }).catch(() => {});
                })
        );
    } catch {}
}

function registerPlatformSyncHandlers(ipcMainRef, getMainWindow) {
    _platformSyncWindowGetter = getMainWindow;
    epicProgressiveSyncCoordinator.restore().catch((error) =>
        syncWarn('[Epic Progressive] Could not restore state:', error?.message || String(error))
    ).finally(() => epicPriceRefreshScheduler.start());

    // Clean up any orphaned legendary tmp config dirs from interrupted link flows
    _cleanupEpicTmpConfigs().catch(() => {});

    const connectors = ALL_CONNECTORS;

    function safeHandle(fn) {
        return async (...args) => {
            try { return await fn(...args); } 
            catch (err) {
                console.error('[PlatformSync] IPC error:', err);
                return { status: 'error', message: err?.message || 'Unknown error.' };
            }
        };
    }

    ipcMainRef.handle('platform-sync:status', safeHandle(async () => {
        return Object.fromEntries(Object.entries(connectors).map(([k, v]) => [k, v.isLinked()]));
    }));

    ipcMainRef.handle('platform-sync:get-accounts', safeHandle(async (_e, platform) => {
        const connector = connectors[platform];
        if (!connector || !connector.getAccounts) return { status: 'success', accounts: [] };
        return { status: 'success', accounts: connector.getAccounts() };
    }));

    ipcMainRef.handle('platform-sync:link', async (event, platform, opts = {}) => {
        const mainWin = getMainWindow?.();
        const parentWindow = BrowserWindow.fromWebContents(event.sender) || mainWin || BrowserWindow.getFocusedWindow();
        try {
            const connector = connectors[platform];
            if (!connector) throw new Error(`Unsupported platform: ${platform}`);
            if (platform === 'steam' && _getPlatformSyncState('steam').isSyncing) {
                const error = new Error('Wait for the active Steam sync to finish before linking another account.');
                error.code = 'STEAM_OPERATION_BUSY';
                throw error;
            }
            syncLog(`[PlatformSync] Linking platform: ${platform} addToSwitcher=${!!opts?.addToSwitcher}`);
            const operationId = opts?.__operationId || _createSyncRunId(`${platform}-link`);
            const emitState = (status, message, extra = {}) =>
                _emitLinkState(parentWindow, platform, status, message, {
                    ...extra, operationType: 'link', operationId,
                });
            const linkRes = await connector.link(parentWindow, emitState, { ...opts, __operationId: operationId });
            if (platform === 'epic') _emitPlatformAccountsChanged('epic', 'linked', parentWindow);
            if (typeof linkRes === 'string') return { status: 'success', displayName: linkRes, operationType: 'link', operationId };
            return { status: 'success', operationType: 'link', operationId, ...linkRes };
        } catch (err) {
            console.error('[PlatformSync] Link error:', err);
            const operationId = opts?.__operationId || null;
            _emitLinkState(parentWindow, platform, 'failed', err.message || 'Link failed', {
                operationType: 'link', operationId,
            });
            return {
                status: 'error',
                code: err.code || err.name || 'PLATFORM_LINK_FAILED',
                message: err.message || 'Failed to link account.',
                operationType: 'link',
                operationId,
            };
        }
    });

    ipcMainRef.handle('platform-sync:sync', safeHandle(async (event, platform, accountId = null, opts = {}) => {
        const mainWin = getMainWindow?.();
        const parentWindow = BrowserWindow.fromWebContents(event.sender) || mainWin || BrowserWindow.getFocusedWindow();
        const connector = connectors[platform];
        if (!connector) throw new Error(`Unsupported platform: ${platform}`);

        const currentState = _getPlatformSyncState(platform);
        if (currentState.isSyncing) return { alreadyRunning: true };

        if (typeof connector.getAccounts === 'function') {
            const accounts = connector.getAccounts();
            if (!accounts || accounts.length === 0) throw new Error(`No ${platform} accounts linked.`);
        }

        const syncRunId = _createSyncRunId(platform);
        const operationId = opts?.__operationId || syncRunId;
        // Reserve synchronously so a second click cannot enter before connector setup awaits.
        _setPlatformSyncState(platform, (state) => {
            state.isSyncing = true;
            state.phase = 'queued';
            state.statusText = 'Preparing sync';
            state.syncRunId = syncRunId;
            return state;
        });
        _startPlatformSyncCommitTrace(platform, syncRunId, {
            accountId: accountId ? String(accountId) : null,
            requestedAt: Date.now(),
            options: {
                epicSyncOptions: opts?.epicSyncOptions ? { ...opts.epicSyncOptions } : undefined,
            },
        });

        // Fire and forget ? results flow back via platform-sync:state / completed / failed events
        connector.syncLibrary(accountId, {
            ...(opts || {}),
            __syncRunId: syncRunId,
            __operationId: operationId,
            __operationType: 'sync',
            __allowInteractiveEpicHistory: false,
        }, parentWindow).catch(err => {
            console.error(`[PlatformSync] Background sync for ${platform} ended with error:`, err.message);
            _finishPlatformSyncCommitTrace(syncRunId, { error: err?.message || String(err) });
            const activeState = _getPlatformSyncState(platform);
            if (activeState.isSyncing && activeState.syncRunId === syncRunId) {
                _finishPlatformSync(platform, {
                    syncRunId,
                    phase: 'error',
                    statusText: `${platform} sync failed: ${err?.message || 'Unknown error'}`,
                    lastError: err?.message || String(err),
                });
            }
        });

        return { status: "started", operationType: 'sync', operationId, syncRunId };
    }));

    ipcMainRef.handle('platform-sync:get-state', safeHandle(async (_e, platform) => {
        if (!platform) return { status: 'success', state: _clonePlain(_platformSyncState) };
        return { status: 'success', state: _clonePlain(_getPlatformSyncState(platform)) };
    }));

    ipcMainRef.handle('platform-sync:get-cached', safeHandle(async (_e, platform) => {
        const connector = connectors[platform];
        if (!connector) throw new Error(`Unsupported platform: ${platform}`);
        if (typeof syncCacheRepository.readMergedLibrarySnapshot === 'function') {
            return await syncCacheRepository.readMergedLibrarySnapshot(platform);
        }
        const games = await connector.getCachedLibrary?.() ?? [];
        return { status: 'success', platform, games, revision: 0, stale: false, authoritativeEmpty: games.length === 0 };
    }));

    ipcMainRef.handle('platform-sync:enrich-gog-details', safeHandle(async (_event, gameId) => {
        return enrichGogGameDetailsOnDemand(gameId);
    }));

    ipcMainRef.handle('platform-sync:get-epic-progress-state', safeHandle(async (_event, accountId = null) => {
        const states = epicProgressiveSyncCoordinator.getAllStates();
        return { status: 'success', state: accountId ? states[String(accountId)] || null : states };
    }));

    ipcMainRef.handle('platform-sync:retry-epic-phase', safeHandle(async (event, accountId, phase) => {
        const account = (await getEpicAccountsList()).find((item) => String(item.id) === String(accountId));
        if (!account) throw new Error('The selected Epic account is not linked.');
        const state = epicProgressiveSyncCoordinator.getAccountState(accountId);
        if (!state || state.phases?.library?.status !== 'complete') throw new Error('Epic library must be ready before retrying enrichment.');
        const debug = phase === 'prices'
            ? await new EpicPriceDebugSession({ app, sourceFile: __filename, appStartedAt: APP_STARTED_AT }).start({ accountId, phaseState: state.phases?.prices })
            : null;
        await debug?.runtimeFingerprint?.();
        await debug?.record?.('account_resolved', { accountFound: true, accountHash: debug?.document?.accountHash || null });
        const mergedLibrary = await epicConnectorMethods.getCachedLibrary();
        await debug?.record?.('merged_library_loaded', { mergedLibraryCount: mergedLibrary.length });
        const libraryGamesFetchedFromState = Number(state.phases?.library?.gamesFetched || 0);
        let retryInput;
        try {
            retryInput = resolveEpicPriceRetryInput({ mergedLibrary, accountId, libraryGamesFetched: libraryGamesFetchedFromState });
        } catch (error) {
            await debug?.fail?.(error, { ownershipStats: error.ownershipStats });
            throw error;
        }
        const { games, stats: ownershipStats } = retryInput;
        await debug?.record?.('account_library_filtered', {
            libraryGamesFetchedFromState, mergedLibraryCount: mergedLibrary.length,
            matchedAccountGamesCount: games.length, ...ownershipStats,
        });
        const mainWin = getMainWindow?.();
        const parentWindow = BrowserWindow.fromWebContents(event.sender) || mainWin || BrowserWindow.getFocusedWindow();
        const task = phase === 'prices'
            ? ({ assertCurrent, report, signal }) => runEpicProgressivePricesPhase({ account, games, assertCurrent, report, signal, debug })
            : ({ assertCurrent, report, signal }) => runEpicProgressiveHistoryPhase({
                account, parentWindow, allowInteractiveLogin: true, assertCurrent, report, signal,
                source: 'retry_phase',
            });
        try {
            return await epicProgressiveSyncCoordinator.retryPhase({ accountId, syncRunId: state.syncRunId, phase, task });
        } catch (error) {
            await debug?.fail?.(error, { coordinatorState: epicProgressiveSyncCoordinator.getAccountState(accountId)?.phases?.prices });
            throw error;
        }
    }));

    ipcMainRef.handle('platform-sync:refresh-epic-prices', async (_event, accountId) => {
        try {
            return await refreshEpicPricesForAccount(accountId, { source: 'manual' });
        } catch (error) {
            return {
                status: 'error',
                code: error?.code || 'EPIC_PRICE_REFRESH_FAILED',
                message: error?.message || 'Epic prices could not be refreshed.',
                failedStage: error?.failedStage || 'price_refresh',
                progress: error?.progress || null,
            };
        }
    });

    ipcMainRef.handle('platform-sync:get-epic-vault', async () => epicVaultHydrationService.handle());

    ipcMainRef.handle('platform-sync:epic-purchase-history-renderer-hydrated', async (_event, accountId, operationId, details = {}) => {
        return appendEpicPurchaseHistoryRendererDiagnostic(accountId, operationId, {
            durationMs: details?.durationMs,
        });
    });

    ipcMainRef.handle('platform-sync:refresh-epic-purchase-history', async (event, accountId, options = {}) => {
        const mainWin = getMainWindow?.();
        const parentWindow = BrowserWindow.fromWebContents(event.sender) || mainWin || BrowserWindow.getFocusedWindow();
        try {
            return await refreshEpicPurchaseHistory(accountId, parentWindow, {
                allowInteractiveLogin: options?.allowInteractiveLogin === true,
                operationId: options?.operationId,
                source: 'manual_refresh',
            });
        } catch (error) {
            const code = error?.code || EPIC_HISTORY_ERROR_CODES.FETCH_FAILED;
            console.error('[Epic Vault] Purchase History refresh failed:', code, error?.message || 'Unknown error');
            return {
                status: 'error',
                code,
                message: error?.message || 'Could not refresh Epic Purchase History.',
                failedStage: error?.failedStage || error?.diagnostics?.at?.(-1)?.stage || 'unknown',
                causeCode: error?.causeCode || error?.details?.causeCode || null,
                causeSummary: error?.causeSummary || error?.details?.causeSummary || null,
                diagnostics: Array.isArray(error?.diagnostics) ? error.diagnostics : [],
            };
        }
    });

    ipcMainRef.handle('platform-sync:unlink', safeHandle(async (_e, platform, accountId) => {
        const connector = connectors[platform];
        if (!connector) throw new Error(`Unsupported platform: ${platform}`);
        if (platform === 'steam' && _getPlatformSyncState('steam').isSyncing) {
            const error = new Error('Wait for the active Steam sync to finish before unlinking this account.');
            error.code = 'STEAM_OPERATION_BUSY';
            throw error;
        }
        await connector.unlink(accountId);
        if (platform === 'epic') _emitPlatformAccountsChanged('epic', 'unlinked');
        return { status: 'success' };
    }));
}

// --- Data Enrichment Helper -----------------------------------

async function enrichProfilesWithSyncData(platform, switcherProfiles) {
    const connector = ALL_CONNECTORS[platform];

    const normalized = switcherProfiles.map(p => {
        if (typeof p === 'string') return { name: p, username: p, displayName: p, id: p };
        return { name: p.name || p.username || p.displayName || String(p.id || ''), ...p };
    });

    if (!connector || !connector.getCachedLibrary || !connector.getAccounts) {
        return normalized.map(p => ({ ...p, isSynced: false, ownedGames: [] }));
    }

    try {
        const syncedAccounts = await connector.getAccounts();
        const library = await connector.getCachedLibrary();

        return normalized.map(profile => {
            const realId = profile.platformAccountId ? String(profile.platformAccountId) : String(profile.id || profile.accountId || profile.username || profile.name);
            const isSynced = syncedAccounts.some(sa => String(sa.id) === realId);
            const ownedGames = library.filter((g) => {
                if (platform === 'steam') {
                    return steamGameBelongsToAccount(g, realId);
                }
                return g.ownedByAccountIds && g.ownedByAccountIds.some((id) => String(id) === realId);
            }).map((g) => g.title);

            return { ...profile, isSynced, ownedGames, _resolvedSyncId: realId };
        });
    } catch (e) {
        console.error(`[PlatformSync] Error enriching profiles for ${platform}:`, e);
        return normalized;
    }
}


/**
 * Send synced library to Baddel metadata server using the batch endpoint.
 * Runs in background after sync completes ? never blocks the UI.
 *
 * Strategy:
 *  1. Build a deduplicated payload from all synced games (platform+id key).
 *  2. Chunk into pages of MAX_BATCH_PAGE items (= 200, the server hard cap).
 *  3. Send pages sequentially with a short inter-page delay (400 ms).
 *  4. On HTTP 429: respect Retry-After if present, else bounded exponential
 *     backoff (base 10 s ? 2^attempt, cap 120 s, ?20 % jitter). Retry the
 *     same page up to MAX_BATCH_RETRIES times before giving up on that page.
 *  5. Per-item statuses from 207 body are tallied across all pages.
 *  6. After all pages are submitted, run lookup+apply for games that came
 *     back as needs_enrich or already_exists (server already has data).
 *  7. For games that were created_and_queued, poll after a delay so images
 *     appear in the library card once the server has enriched them.
 *
 * @param {'steam'|'epic'} platform
 * @param {object[]} games - synced game entries from local cache
 */
async function _importLibraryToServer(platform, games) {
    const serverImportService = new PlatformSyncServerImportService({
        baddelApi,
        syncCacheRepository,
        enqueueWrite: _enqueueLibraryWrite,
        emitLibraryUpdated: _emitLibraryUpdated,
        getWindow: () => _platformSyncWindowGetter?.(),
        getAssetDownloader: () => _platformSyncAssetDownloader,
        sleep: (ms) => new Promise(r => setTimeout(r, ms)),
        random: Math.random,
        logger: {
            log: (...args) => syncLog(...args),
            warn: (...args) => syncWarn(...args),
            consoleLog: (...args) => verboseLog(...args),
            consoleWarn: (...args) => syncWarn(...args),
        },
        mapWithConcurrency,
    });

    return serverImportService.importLibraryToServer(platform, games);
}
// --- Startup auto-sync ---------------------------------------
// Called from main.js after the window shows. Fires background syncs for any
// platform that has linked accounts and is not already syncing.
async function autoSyncOnStartup() {
    const platformsToSync = [];
    for (const [platform, connector] of Object.entries(ALL_CONNECTORS)) {
        try {
            const accounts = connector?.getAccounts?.();
            if (!Array.isArray(accounts) || accounts.length === 0) continue;
            const state = _getPlatformSyncState(platform);
            if (state?.isSyncing) continue;
            platformsToSync.push(platform);
            verboseLog(`[AutoSync] Starting background ${platform} sync`);
            connector.syncLibrary().catch(err => {
                console.error(`[AutoSync] ${platform} sync failed:`, err.message);
            });
        } catch (err) {
            console.error(`[AutoSync] ${platform} account check error:`, err.message);
        }
    }
    if (platformsToSync.length > 0) {
        analytics.logAutoSyncStarted(platformsToSync).catch(() => {});
    }
}

// --- Exports -------------------------------------------------

module.exports = createPlatformSyncFeature({
    registerPlatformSyncHandlers,
    epicConnector,
    steamConnector,
    gogConnector,
    enrichProfilesWithSyncData,
    registerPlatformSyncAssetDownloader,
    autoSyncOnStartup,
    _mobileApprovalPollStep,
    _startQrLoginFlow,
    cacheLibraryCoversFirst,
    _withConcurrency,
    // Exported for testing only ? not part of the public API
    _writeSyncLinkToExistingSwitcherProfile,
    _findMatchingEpicSwitcherProfile,
});
