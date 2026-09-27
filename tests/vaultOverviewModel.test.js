const test = require('node:test');
const assert = require('node:assert/strict');

const {
    aggregateEpicPlatformSummary,
    buildVaultOverviewModel,
    formatVaultCurrencyBuckets,
    shouldAcceptVaultSnapshot,
} = require('../src/js/vault-overview-model');

function game(key, amount, currency = 'USD', priceStatus = 'priced') {
    return {
        vaultCanonicalKey: key,
        title: key,
        priceStatus,
        livePrice: { amount, currency, priceStatus, priceResolved: priceStatus === 'priced' || priceStatus === 'free' },
    };
}

test('Vault totals count holdings per account while deduplicating only inside each account', () => {
    const shared = game('epic:catalog:shared', 1000);
    const model = buildVaultOverviewModel({
        epicVault: {
            accounts: [
                { accountId: ' ACCOUNT-A ', games: [shared, { ...shared }, game('epic:catalog:a', 200)] },
                { accountId: 'account-b', games: [shared] },
                { accountId: 'account-a', vaultRevision: 0, games: [shared, game('epic:catalog:a', 200)] },
            ],
        },
    });

    assert.equal(model.totalGames, 3, 'the shared game counts once for each owning account');
    assert.equal(model.accountCount, 2);
    assert.equal(model.platformCount, 1);
});

test('Library value keeps currencies separate and reports partial coverage without float aggregation', () => {
    const summary = aggregateEpicPlatformSummary([
        {
            accountId: 'a', currency: 'USD', permissions: { currentPrices: true }, games: [
                game('paid-a', 1001, 'USD'),
                game('free-a', 0, 'USD', 'free'),
                { vaultCanonicalKey: 'unknown-a', priceStatus: 'unresolved', livePrice: { currency: 'USD' } },
            ],
        },
        {
            accountId: 'b', currency: 'TRY', permissions: { currentPrices: true }, games: [
                game('paid-b', 895001, 'TRY'),
                game('paid-c', 2, 'USD'),
            ],
        },
    ]);

    assert.deepEqual(summary.libraryValue.buckets.USD, {
        minorUnits: 1003,
        resolvedItems: 3,
        totalItems: 4,
        status: 'partial',
    });
    assert.deepEqual(summary.libraryValue.buckets.TRY, {
        minorUnits: 895001,
        resolvedItems: 1,
        totalItems: 1,
        status: 'complete',
    });
    assert.equal(summary.libraryValue.status, 'partial');
    assert.deepEqual(formatVaultCurrencyBuckets(summary.libraryValue).map((line) => line.currency), ['TRY', 'USD']);
});

test('A verified free game is a known zero rather than missing value', () => {
    const summary = aggregateEpicPlatformSummary([
        { accountId: 'free', currency: 'USD', games: [game('free-game', 0, 'USD', 'free')] },
    ]);

    assert.equal(summary.libraryValue.status, 'complete');
    assert.deepEqual(summary.libraryValue.buckets.USD, {
        minorUnits: 0,
        resolvedItems: 1,
        totalItems: 1,
        status: 'complete',
    });
    assert.equal(formatVaultCurrencyBuckets(summary.libraryValue)[0].text, 'USD 0.00');
});

test('Real Spent aggregates stored net totals after refunds and never combines currencies', () => {
    const summary = aggregateEpicPlatformSummary([
        {
            accountId: 'a', permissions: { purchaseHistory: true },
            grossPurchasesByCurrency: { USD: 5000 }, refundsByCurrency: { USD: 1250 }, netSpentByCurrency: { USD: 3750 }, games: [],
        },
        {
            accountId: 'b', permissions: { purchaseHistory: true },
            grossPurchasesByCurrency: { USD: 1000, TRY: 92000 }, refundsByCurrency: { USD: 200 }, netSpentByCurrency: { USD: 800, TRY: 92000 }, games: [],
        },
    ]);

    assert.equal(summary.realSpent.status, 'complete');
    assert.equal(summary.realSpent.buckets.USD.minorUnits, 4550);
    assert.equal(summary.realSpent.buckets.TRY.minorUnits, 92000);
    assert.deepEqual(formatVaultCurrencyBuckets(summary.realSpent).map(({ text }) => text), ['TRY 920.00', 'USD 45.50']);
});

test('Missing history is not represented as zero spending', () => {
    const summary = aggregateEpicPlatformSummary([
        { accountId: 'a', currency: 'USD', permissions: { purchaseHistory: false }, netSpentMinor: 0, games: [] },
    ], {
        a: { phases: { purchaseHistory: { status: 'skipped' } } },
    });

    assert.equal(summary.realSpent.status, 'not_requested');
    assert.deepEqual(summary.realSpent.buckets, {});
    assert.deepEqual(formatVaultCurrencyBuckets(summary.realSpent), []);
});

test('A committed library remains visible while optional phases are pending or failed', () => {
    const account = { accountId: 'a', vaultRevision: 1, currency: 'USD', games: [game('known', 500), { vaultCanonicalKey: 'pending', priceStatus: 'unresolved' }] };
    const loading = buildVaultOverviewModel({
        epicVault: { accounts: [account] },
        epicProgressStates: { a: { phases: { prices: { status: 'running' }, purchaseHistory: { status: 'running' } } } },
    });
    const failed = buildVaultOverviewModel({
        epicVault: { accounts: [account] },
        epicProgressStates: { a: { phases: { prices: { status: 'partial' }, purchaseHistory: { status: 'failed' } } } },
    });

    for (const model of [loading, failed]) {
        assert.equal(model.accountCount, 1);
        assert.equal(model.totalGames, 2);
        assert.equal(model.libraryValue.buckets.USD.minorUnits, 500);
    }
    assert.equal(loading.realSpent.status, 'loading');
    assert.equal(failed.realSpent.status, 'unavailable');
});

test('Overview cover preview is bounded and ignores duplicate or missing artwork', () => {
    const games = Array.from({ length: 8 }, (_, index) => ({
        vaultCanonicalKey: `game-${index}`,
        coverUrl: index === 7 ? null : `cover-${Math.min(index, 5)}.webp`,
    }));
    const summary = aggregateEpicPlatformSummary([{ accountId: 'a', games }]);
    assert.deepEqual(summary.covers, ['cover-0.webp', 'cover-1.webp', 'cover-2.webp', 'cover-3.webp']);
});

test('Overview aggregation is deterministic regardless of account and game source order', () => {
    const accountA = {
        accountId: 'A', currency: 'USD', permissions: { currentPrices: true, purchaseHistory: true },
        netSpentByCurrency: { USD: 250 }, games: [game('z-game', 900), game('a-game', 100)],
    };
    const accountB = {
        accountId: 'B', currency: 'TRY', permissions: { currentPrices: true, purchaseHistory: true },
        netSpentByCurrency: { TRY: 12500 }, games: [game('m-game', 5000, 'TRY')],
    };
    const forward = buildVaultOverviewModel({ epicVault: { accounts: [accountA, accountB] } });
    const reversed = buildVaultOverviewModel({ epicVault: { accounts: [
        { ...accountB, games: [...accountB.games].reverse() },
        { ...accountA, games: [...accountA.games].reverse() },
    ] } });

    assert.deepEqual(reversed, forward);
});

test('Snapshot revision gate rejects late stale responses and accepts the committed revision', () => {
    assert.equal(shouldAcceptVaultSnapshot({ incomingRevision: 2, acceptedRevision: 3, requiredRevision: 1 }), false);
    assert.equal(shouldAcceptVaultSnapshot({ incomingRevision: 3, acceptedRevision: 1, requiredRevision: 3 }), true);
    assert.equal(shouldAcceptVaultSnapshot({ incomingRevision: 4, acceptedRevision: 3, requiredRevision: 2 }), true);
});
