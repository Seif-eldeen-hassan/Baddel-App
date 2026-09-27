'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
    EpicPriceEnrichmentService,
    shouldRefreshCachedEpicPrice,
} = require('../src/features/sync/application/services/EpicPriceEnrichmentService');

const root = path.resolve(__dirname, '..');
const platformSync = fs.readFileSync(path.join(root, 'platformSync.js'), 'utf8');
const sidebar = fs.readFileSync(path.join(root, 'src/js/app/sidebar.js'), 'utf8');

test('twelve confirmed delisted games complete as unavailable without zero-coverage failure', async () => {
    const checkedAt = '2026-09-09T12:00:00.000Z';
    const service = new EpicPriceEnrichmentService({
        fetchEntry: async (entry) => ({
            ...entry,
            priceStatus: 'unavailable',
            priceResolved: true,
            resolutionSource: 'catalog_missing',
            checkedAt,
        }),
        concurrency: 2,
        maxRetries: 0,
    });

    const result = await service.process(
        Array.from({ length: 12 }, (_, id) => ({ id })),
        { onBatch: async () => {} }
    );

    assert.equal(result.status, 'complete');
    assert.equal(result.prices.length, 12);
    assert.equal(result.progress.resolved, 12);
    assert.equal(result.progress.unavailable, 12);
    assert.equal(result.progress.unresolved, 0);
    assert.ok(result.prices.every((price) =>
        price.priceStatus === 'unavailable'
        && price.priceResolved === true
        && price.checkedAt === checkedAt));
});

test('real API zero coverage remains a typed retryable warning', async () => {
    const service = new EpicPriceEnrichmentService({
        fetchEntry: async () => ({
            priceStatus: 'unresolved',
            resolutionSource: 'network_failure',
            errorCode: 'EPIC_PRICE_NETWORK_FAILURE',
        }),
        maxRetries: 0,
        circuitMinAttempts: 50,
    });

    await assert.rejects(
        service.process([{}, {}], { onBatch: async () => {} }),
        (error) => error.code === 'EPIC_PRICES_ZERO_COVERAGE'
            && error.progress.reasonCounts.network_failure === 2
    );
});

test('structural unresolved records do not masquerade as pricing-service zero coverage', async () => {
    const service = new EpicPriceEnrichmentService({
        fetchEntry: async () => ({
            priceStatus: 'unresolved',
            resolutionSource: 'missing_identity',
        }),
        maxRetries: 0,
        circuitMinAttempts: 50,
    });
    const result = await service.process([{}], { onBatch: async () => {} });
    assert.equal(result.status, 'partial');
    assert.equal(result.progress.resolved, 0);
    assert.equal(result.progress.unresolved, 1);
});

test('confirmed unavailable cache uses a long TTL while manual refresh can force a recheck', () => {
    const nowMs = Date.parse('2026-09-09T12:00:00.000Z');
    const cached = {
        priceStatus: 'unavailable',
        pricingCountry: 'EG',
        checkedAt: '2026-09-01T12:00:00.000Z',
    };
    const original = structuredClone(cached);
    const options = {
        nowMs,
        priceTtlMs: 6 * 60 * 60 * 1000,
        unavailableTtlMs: 30 * 24 * 60 * 60 * 1000,
    };

    assert.equal(shouldRefreshCachedEpicPrice(cached, 'EG', options), false);
    assert.equal(shouldRefreshCachedEpicPrice(cached, 'EG', { ...options, forceRefresh: true }), true);
    assert.equal(shouldRefreshCachedEpicPrice(cached, 'EG', {
        ...options,
        nowMs: Date.parse('2026-10-02T12:00:00.000Z'),
    }), true);
    assert.deepEqual(cached, original, 'cache policy must not mutate an existing valid price record');
});

test('catalog misses are final unavailable records and remain mergeable/filterable', () => {
    assert.match(platformSync, /buildEpicUnresolvedPriceRecord\(ref, 'unavailable', 'catalog_missing'\)/);
    assert.match(platformSync, /successfulLookupMiss \? 'unavailable' : 'unresolved'/);
    assert.match(platformSync, /status === 'not_for_sale' \|\| status === 'unavailable'/);
    assert.match(sidebar, /label: 'Price unavailable', status/);
    assert.match(sidebar, /\['unresolved', 'unavailable', 'not_for_sale'\]/);
});

function rendererHarness() {
    const storage = new Map();
    let state = {
        syncRunId: 'run-a',
        revision: 4,
        overallStatus: 'partial',
        isFirstFullImport: false,
        phases: {
            library: { status: 'complete', gamesFetched: 12 },
            prices: {
                status: 'failed',
                processed: 12,
                resolved: 0,
                unresolved: 12,
                errorCode: 'EPIC_PRICES_ZERO_COVERAGE',
                failedStage: 'price_resolution',
                completedAt: '2026-09-09T12:00:00.000Z',
            },
            purchaseHistory: { status: 'skipped' },
        },
    };
    const helperStart = sidebar.indexOf('const VAULT_EPIC_PRICE_DISMISSALS_KEY');
    const helperEnd = sidebar.indexOf('let __vaultEpicHistoryNotice', helperStart);
    const noticeStart = sidebar.indexOf('function _vaultEpicProgressNoticeHtml');
    const noticeEnd = sidebar.indexOf('async function retryVaultEpicPhase', noticeStart);
    assert.ok(helperStart >= 0 && helperEnd > helperStart && noticeStart >= 0 && noticeEnd > noticeStart);

    const sandbox = {
        window: {},
        document: { getElementById: () => null },
        localStorage: {
            getItem: (key) => storage.has(key) ? storage.get(key) : null,
            setItem: (key, value) => storage.set(key, String(value)),
        },
        __vaultEpicPriceRefreshErrors: new Map(),
        __vaultSelectedEpicAccountId: null,
        _vaultSelectedEpicAccount: () => null,
        _vaultPatchEpicAccountShell: () => {},
        _vaultEpicProgressState: () => state,
        _vaultEffectiveHistoryPhase: () => state.phases.purchaseHistory,
        _vaultEpicPhaseProgressText: () => '',
        _vaultHtml: (value) => String(value ?? ''),
    };
    vm.createContext(sandbox);
    vm.runInContext(
        sidebar.slice(helperStart, helperEnd) + '\n' + sidebar.slice(noticeStart, noticeEnd),
        sandbox
    );
    return {
        sandbox,
        setState: (next) => { state = next; },
        getState: () => state,
        storage,
    };
}

test('price warning dismissal survives hydration/navigation and is scoped to one failed attempt', () => {
    const harness = rendererHarness();
    const first = harness.sandbox._vaultEpicProgressNoticeHtml('account-a');
    assert.match(first, /Retry prices/);
    assert.match(first, />Dismiss</);
    assert.match(first, /<details[^>]*><summary>Diagnostic details<\/summary><code>prices: EPIC_PRICES_ZERO_COVERAGE/);
    assert.doesNotMatch(first.split('<details')[0], /EPIC_PRICES_ZERO_COVERAGE/);

    const attemptId = harness.sandbox._vaultEpicPriceFailureAttemptId(
        'account-a',
        harness.getState().phases.prices,
        harness.getState()
    );
    harness.sandbox.dismissVaultEpicPriceWarning('account-a', attemptId);
    assert.equal(harness.sandbox._vaultEpicProgressNoticeHtml('account-a'), '');

    harness.setState(structuredClone(harness.getState()));
    assert.equal(harness.sandbox._vaultEpicProgressNoticeHtml('account-a'), '');

    const next = structuredClone(harness.getState());
    next.phases.prices.completedAt = '2026-09-09T12:05:00.000Z';
    harness.setState(next);
    assert.match(harness.sandbox._vaultEpicProgressNoticeHtml('account-a'), /Retry prices/);

    harness.sandbox._vaultClearEpicPriceWarningDismissal('account-a');
    assert.equal(harness.sandbox._vaultIsEpicPriceWarningDismissed('account-a', attemptId), false);
});

test('twelve confirmed unavailable games render no account-level price warning', () => {
    const harness = rendererHarness();
    const complete = structuredClone(harness.getState());
    complete.overallStatus = 'complete';
    complete.phases.prices = {
        status: 'complete',
        processed: 12,
        resolved: 12,
        unavailable: 12,
        unresolved: 0,
        completedAt: '2026-09-09T12:00:00.000Z',
    };
    harness.setState(complete);

    assert.equal(harness.sandbox._vaultEpicProgressNoticeHtml('account-a'), '');
});
test('manual and automatic price routing apply force only to the manual attempt', () => {
    assert.match(platformSync, /forceRefresh: sourceLabel === 'manual'/);
    assert.match(platformSync, /BADDEL_EPIC_UNAVAILABLE_PRICE_TTL_MS/);
});
