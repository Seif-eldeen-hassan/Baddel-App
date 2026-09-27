'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const vm = require('vm');
const { classifyEpicPriceResponse } = require('../src/features/sync/application/services/EpicPriceErrorClassifier');

const ROOT = path.resolve(__dirname, '..');
const platformSync = fs.readFileSync(path.join(ROOT, 'platformSync.js'), 'utf8');
const sidebar = fs.readFileSync(path.join(ROOT, 'src/js/app/sidebar.js'), 'utf8');

function extractByName(source, name) {
    const patterns = [new RegExp(`async\\s+function\\s+${name}\\s*\\(`), new RegExp(`function\\s+${name}\\s*\\(`)];
    const match = patterns.map((re) => re.exec(source)).find(Boolean);
    assert.ok(match, `${name} should exist`);
    const start = match.index;
    const paramsEnd = source.indexOf(') {', start);
    assert.notStrictEqual(paramsEnd, -1, `${name} should have body`);
    const bodyStart = source.indexOf('{', paramsEnd);
    let depth = 0;
    for (let i = bodyStart; i < source.length; i += 1) {
        if (source[i] === '{') depth += 1;
        if (source[i] === '}') depth -= 1;
        if (depth === 0) return source.slice(start, i + 1);
    }
    throw new Error(`Could not extract ${name}`);
}

function createPlatformSyncArtworkSandbox(mockRequest) {
    const names = [
        'normalizeEpicLookupValue',
        'normalizeEpicComparableTitle',
        'getEpicOfferRefFromEntry',
        'getEpicPriceIdentityKeys',
        'buildEpicPriceMap',
        'verifyEpicOfferMatchesRef',
        'extractEpicOfferCandidates',
        'resolveEpicOfferFromCatalogItem',
        'resolveEpicOfferFromVerifiedFallback',
        'buildEpicUnresolvedPriceRecord',
        'fetchEpicCatalogOffer',
        'isUsableEpicArtworkUrl',
        'normalizeEpicCoverCandidates',
        'epicArtworkFromOffer',
        'epicArtworkFromPriceRecord',
        'shouldTraceEpicPurchaseArtwork',
        'epicKeyImageTypes',
        'traceEpicPurchaseArtwork',
        'epicPurchaseArtworkCacheKeys',
        'getEpicPurchaseOwnArtwork',
        'buildEpicPurchaseArtworkCache',
        'findEpicPurchaseCachedArtwork',
        'findEpicLivePriceArtwork',
        'resolveEpicPurchaseCatalogArtwork',
        'applyEpicPurchaseArtwork',
        'enrichEpicPurchaseHistoryArtwork',
        '_pickEpicCover',
        '_pickEpicHero',
    ];
    const code = `${names.map((name) => extractByName(platformSync, name)).join('\n')}\nObject.assign(globalThis, { ${names.join(', ')} });`;
    const sandbox = {
        process: { env: {} },
        console,
        setTimeout: (fn) => { fn(); return 1; },
        _pushPlatformSyncLog: () => {},
        getEpicPricingCountryForRequest: (country) => country || 'US',
        mapWithConcurrency: async (items, _limit, worker) => Promise.all((items || []).map(worker)),
        epicNetJsonRequest: mockRequest,
        classifyEpicPriceResponse,
    };
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox, { filename: 'platform-sync-artwork-block.js' });
    return sandbox;
}

function createVaultSandbox() {
    const sandbox = {
        console,
        window: {},
        localStorage: { getItem: () => null, setItem: () => {} },
        document: { getElementById: () => null, querySelectorAll: () => [], addEventListener: () => {}, readyState: 'complete' },
        CSS: { escape: (value) => String(value) },
        requestAnimationFrame: (fn) => fn(),
        setTimeout: (fn) => { fn(); return 1; },
        clearTimeout: () => {},
        currentView: 'vault',
        currentFilters: {},
        escapeHtml: (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    };
    sandbox.window = { ...sandbox.window, setTimeout: sandbox.setTimeout, clearTimeout: sandbox.clearTimeout };
    vm.createContext(sandbox);
    const start = sidebar.indexOf('const VAULT_PLATFORM_META');
    const end = sidebar.indexOf('function handleSidebarContextBtn');
    assert.ok(start > -1 && end > start);
    vm.runInContext(`${sidebar.slice(start, end)}\nObject.assign(window, { _vaultBuildPurchaseMap, _vaultPrepareLibraryGames, _vaultCoverCandidatesForGame, _vaultRenderEpicCover, setVaultEpicPriceMode });`, sandbox);
    return sandbox;
}

test('direct namespace plus offerId enriches Purchase History artwork and persists cover fields', async () => {
    const calls = [];
    const sandbox = createPlatformSyncArtworkSandbox(async (_url, payload) => {
        calls.push(payload.operationName);
        assert.equal(payload.operationName, 'getCatalogOffer');
        assert.equal(payload.variables.offerId, 'offer-123');
        return { status: 200, data: { data: { Catalog: { catalogOffer: {
            id: 'offer-123', namespace: 'ns', title: 'Example DLC',
            keyImages: [{ type: 'OfferImageTall', url: 'https://example.test/cover.jpg' }],
            price: { totalPrice: { discountPrice: 999, originalPrice: 1999, currencyCode: 'USD', fmtPrice: {} } },
        } } } } };
    });
    const seed = { purchaseHistoryItems: [{ title: 'Example DLC', namespace: 'ns', offerId: 'offer-123', amountMinor: 999, currency: 'USD' }], paidItems: [], games: [], fabItems: [] };
    const result = await sandbox.enrichEpicPurchaseHistoryArtwork(seed, {}, [], 'US');
    assert.equal(result.purchaseHistoryItems[0].coverUrl, 'https://example.test/cover.jpg');
    assert.equal(result.purchaseHistoryItems[0].artworkSource, 'epic_catalog');
    assert.deepEqual(calls, ['getCatalogOffer']);
});

test('catalogItemId resolution enriches Purchase History artwork through resolved offer', async () => {
    const sandbox = createPlatformSyncArtworkSandbox(async (_url, payload) => {
        if (payload.operationName === 'catalogItemOfferResolution') {
            return { status: 200, data: { data: { Catalog: { searchStore: { elements: [{
                id: 'resolved-offer', namespace: 'ns', title: 'Catalog Item Game',
                keyImages: [{ type: 'DieselStoreFrontTall', url: 'https://example.test/catalog-cover.jpg' }],
            }] } } } } };
        }
        throw new Error(`unexpected operation ${payload.operationName}`);
    });
    const seed = { purchaseHistoryItems: [{ title: 'Catalog Item Game', namespace: 'ns', catalogItemId: 'item-123', amountMinor: 999, currency: 'USD' }], paidItems: [], games: [], fabItems: [] };
    const result = await sandbox.enrichEpicPurchaseHistoryArtwork(seed, {}, [], 'US');
    assert.equal(result.purchaseHistoryItems[0].coverUrl, 'https://example.test/catalog-cover.jpg');
    assert.equal(result.purchaseHistoryItems[0].artworkSource, 'epic_catalog_catalog_item');
    assert.equal(result.purchaseHistoryItems[0].resolvedOfferId, 'resolved-offer');
});

test('invalid direct offerId falls back to exact verified catalog search without changing purchase title', async () => {
    const sandbox = createPlatformSyncArtworkSandbox(async (_url, payload) => {
        if (payload.operationName === 'getCatalogOffer') {
            return { status: 200, data: { data: { Catalog: { catalogOffer: null } } } };
        }
        if (payload.operationName === 'verifiedOfferFallbackResolution') {
            return { status: 200, data: { data: { Catalog: { searchStore: { elements: [{
                id: 'real-offer', namespace: 'ns', title: 'Old Purchase Title', productSlug: 'old-purchase-title',
                keyImages: [{ type: 'DieselStoreFrontWide', url: 'https://example.test/fallback-wide.jpg' }],
            }] } } } } };
        }
        throw new Error(`unexpected operation ${payload.operationName}`);
    });
    const seed = { purchaseHistoryItems: [{ title: 'Old Purchase Title', namespace: 'ns', offerId: 'transaction-offer', amountMinor: 999, currency: 'USD' }], paidItems: [], games: [], fabItems: [] };
    const result = await sandbox.enrichEpicPurchaseHistoryArtwork(seed, {}, [], 'US');
    assert.equal(result.purchaseHistoryItems[0].title, 'Old Purchase Title');
    assert.equal(result.purchaseHistoryItems[0].coverUrl, 'https://example.test/fallback-wide.jpg');
    assert.equal(result.purchaseHistoryItems[0].artworkSource, 'epic_catalog_title_verified');
});

test('Catalog lookup without usable artwork leaves identity intact and marks fallback', async () => {
    const sandbox = createPlatformSyncArtworkSandbox(async () => ({ status: 200, data: { data: { Catalog: { catalogOffer: null, searchStore: { elements: [] } } } } }));
    const seed = { purchaseHistoryItems: [{ title: 'Delisted Game', namespace: 'ns', offerId: 'gone', amountMinor: 999, currency: 'USD' }], paidItems: [], games: [], fabItems: [] };
    const result = await sandbox.enrichEpicPurchaseHistoryArtwork(seed, {}, [], 'US');
    assert.equal(result.purchaseHistoryItems[0].title, 'Delisted Game');
    assert.equal(result.purchaseHistoryItems[0].coverUrl, undefined);
    assert.equal(result.purchaseHistoryItems[0].artworkSource, 'fallback');
});

test('cached Purchase artwork is reused without a catalog request', async () => {
    let calls = 0;
    const sandbox = createPlatformSyncArtworkSandbox(async () => { calls += 1; throw new Error('catalog should not be called'); });
    const existingVault = { purchaseHistoryItems: [{ title: 'Cached Game', namespace: 'ns', offerId: 'cached', coverUrl: 'https://example.test/cached.jpg', artworkSource: 'epic_catalog' }] };
    const seed = { purchaseHistoryItems: [{ title: 'Cached Game', namespace: 'ns', offerId: 'cached', amountMinor: 999, currency: 'USD' }], paidItems: [], games: [], fabItems: [] };
    const result = await sandbox.enrichEpicPurchaseHistoryArtwork(seed, existingVault, [], 'US');
    assert.equal(result.purchaseHistoryItems[0].coverUrl, 'https://example.test/cached.jpg');
    assert.equal(result.purchaseHistoryItems[0].artworkSource, 'cached_purchase');
    assert.equal(calls, 0);
});

test('Purchase Library card consumes local enriched purchase artwork before Legendary artwork', () => {
    const sandbox = createVaultSandbox();
    sandbox.window.setVaultEpicPriceMode('purchase');
    const account = {
        games: [{ title: 'Legendary Title', namespace: 'ns', offerId: 'offer', coverUrl: 'file://legendary.webp' }],
        purchaseHistoryItems: [{ title: 'Receipt Title', namespace: 'ns', offerId: 'offer', amountMinor: 999, currency: 'USD', status: 'Completed', coverUrl: 'file://purchase.webp', artworkSource: 'epic_catalog' }],
    };
    const cards = sandbox.window._vaultPrepareLibraryGames(account, new Map());
    const html = sandbox.window._vaultRenderEpicCover(cards[0], account);
    assert.equal(cards[0].title, 'Receipt Title');
    assert.match(html, /file:\/\/purchase\.webp/);
    assert.doesNotMatch(html, /file:\/\/legendary\.webp/);
});

test('Purchase Library remote enriched artwork remains a candidate and is not rendered directly', () => {
    const sandbox = createVaultSandbox();
    sandbox.window.setVaultEpicPriceMode('purchase');
    const account = {
        games: [{ title: 'Legendary Title', namespace: 'ns', offerId: 'offer', coverUrl: 'file://legendary.webp' }],
        purchaseHistoryItems: [{ title: 'Receipt Title', namespace: 'ns', offerId: 'offer', amountMinor: 999, currency: 'USD', status: 'Completed', coverUrl: 'https://example.test/purchase.jpg', artworkSource: 'epic_catalog' }],
    };
    const cards = sandbox.window._vaultPrepareLibraryGames(account, new Map());
    const candidates = sandbox.window._vaultCoverCandidatesForGame(cards[0], account).map((item) => item.url);
    const html = sandbox.window._vaultRenderEpicCover(cards[0], account);
    assert.ok(candidates.includes('https://example.test/purchase.jpg'));
    assert.equal(cards[0].title, 'Receipt Title');
    assert.match(html, /file:\/\/legendary\.webp/);
    assert.doesNotMatch(html, /https:\/\/example\.test\/purchase\.jpg/);
});