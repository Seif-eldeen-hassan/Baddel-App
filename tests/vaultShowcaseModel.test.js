'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildAccountMetrics,
    buildVaultShowcaseSnapshot,
    containsSensitiveFields,
    dedupeCanonicalGames,
} = require('../src/js/vault-showcase-model');

function priced(key, title, amount, currency = 'USD', extra = {}) {
    return { canonicalGameId: key, title, priceStatus: 'priced', livePrice: { priceStatus: 'priced', amount, currency }, ...extra };
}

function account(games, extra = {}) {
    return {
        accountId: 'raw-account-id-must-not-leak',
        displayName: 'Vault Player',
        currency: 'USD',
        permissions: { purchaseHistory: true },
        games,
        grossPurchasesMinor: 12000,
        refundsMinor: 2000,
        netSpentMinor: 10000,
        ...extra,
    };
}

test('priced and every genuine no-price game are included while free games stay excluded', () => {
    const snapshot = buildVaultShowcaseSnapshot({ account: account([
        priced('epic:catalog:a', 'Alpha', 4999),
        { canonicalGameId: 'epic:catalog:b', title: 'Bravo', priceStatus: 'unresolved' },
        { canonicalGameId: 'epic:catalog:c', title: 'Claim', priceStatus: 'free', livePrice: { priceStatus: 'free', amount: 0, currency: 'USD' } },
        { canonicalGameId: 'epic:catalog:d', title: 'Gone', priceStatus: 'not_for_sale', livePrice: { priceStatus: 'not_for_sale' } },
        { canonicalGameId: 'epic:catalog:e', title: 'Unavailable', priceStatus: 'unavailable', livePrice: { priceStatus: 'unavailable' } },
    ]) });
    assert.deepEqual(snapshot.sections.map((section) => section.games.map((game) => game.title)), [['Alpha'], ['Bravo', 'Gone', 'Unavailable']]);
    assert.equal(snapshot.sections[1].title, 'Price Unavailable');
    assert.equal(snapshot.counts.included, 4);
    assert.equal(snapshot.counts.priceUnavailable, 3);
    assert.equal(snapshot.counts.freeExcluded, 1);
    assert.equal(snapshot.counts.unavailableExcluded, 0);
    assert.equal(snapshot.sections.flatMap((section) => section.games).some((game) => game.title === 'Claim'), false);
    for (const game of snapshot.sections[1].games) {
        assert.equal(game.priceStatus, 'price_unavailable');
        assert.equal('priceMinor' in game, false);
        assert.equal('priceCurrency' in game, false);
    }
});

test('a legacy row with no price record appears as Price Unavailable without inventing a price', () => {
    const snapshot = buildVaultShowcaseSnapshot({ account: account([
        priced('epic:catalog:a', 'Eligible', 100),
        { canonicalGameId: 'epic:catalog:legacy', title: 'Legacy no-price row' },
    ]) });
    assert.equal(snapshot.counts.priceUnavailable, 1);
    assert.equal(snapshot.counts.unresolved, 0);
    assert.equal(snapshot.sections[1].games[0].title, 'Legacy no-price row');
    assert.equal('priceMinor' in snapshot.sections[1].games[0], false);
});
test('known non-game entitlements are excluded', () => {
    const snapshot = buildVaultShowcaseSnapshot({ account: account([
        priced('epic:catalog:game', 'Real Game', 1000),
        priced('epic:catalog:dlc', 'Real Game Soundtrack', 500, 'USD', { productType: 'soundtrack' }),
        { canonicalGameId: 'epic:catalog:currency', title: '1000 V-Bucks', priceStatus: 'unresolved', productType: 'virtual currency' },
    ]) });
    assert.equal(snapshot.counts.included, 1);
    assert.equal(snapshot.counts.nonGameExcluded, 2);
});

test('canonical duplicates collapse while equal titles with different immutable identities remain separate', () => {
    const games = [
        priced('epic:catalog:one', 'Shared Name', 1000),
        priced('epic:catalog:one', 'Shared Name Deluxe', 1500),
        priced('epic:catalog:two', 'Shared Name', 2000),
        { title: 'No Identity' },
        { title: 'No Identity' },
    ];
    const canonical = dedupeCanonicalGames(games);
    assert.equal(canonical.length, 4);
    assert.equal(canonical.filter((item) => item.key === 'epic:catalog:one').length, 1);
    assert.equal(canonical.filter((item) => item.key.startsWith('epic:unidentified:')).length, 2);
});

test('current library value sums priced games only and unresolved games do not affect it', () => {
    const metrics = buildAccountMetrics(account([
        priced('epic:catalog:a', 'A', 1099),
        priced('epic:catalog:b', 'B', 2401),
        { canonicalGameId: 'epic:catalog:c', title: 'C', priceStatus: 'unresolved', livePrice: { amount: 999999, currency: 'USD' } },
        { canonicalGameId: 'epic:catalog:d', title: 'D', priceStatus: 'free', livePrice: { amount: 0, currency: 'USD' } },
    ]));
    assert.deepEqual(metrics.currentLibraryValue, [{ currency: 'USD', minorUnits: 3500, text: 'USD 35.00' }]);
    assert.equal(metrics.pricedGames, 2);
    assert.equal(metrics.unresolvedGames, 1);
});

test('paid, refunded and net lines reuse committed Vault aggregates and refunds display positively', () => {
    const snapshot = buildVaultShowcaseSnapshot({ account: account([priced('epic:catalog:a', 'A', 100)], {
        grossPurchasesByCurrency: { USD: 12000, EGP: 30000 },
        refundsByCurrency: { USD: -2000, EGP: 5000 },
        netSpentByCurrency: { USD: 10000, EGP: 25000 },
    }) });
    assert.deepEqual(snapshot.financials.totalPaid.map((line) => line.minorUnits), [12000, 30000]);
    assert.deepEqual(snapshot.financials.totalRefunded.map((line) => line.minorUnits), [2000, 5000]);
    assert.deepEqual(snapshot.financials.netSpend.map((line) => line.minorUnits), [10000, 25000]);
    assert.equal(snapshot.financials.totalPaid.length, 2, 'currencies remain separate');
});

test('sorting is deterministic: priced by amount descending then title, price unavailable alphabetically', () => {
    const snapshot = buildVaultShowcaseSnapshot({ account: account([
        priced('epic:catalog:b', 'Zulu', 2000),
        priced('epic:catalog:a', 'Alpha', 2000),
        priced('epic:catalog:c', 'Cheap', 100),
        { canonicalGameId: 'epic:catalog:e', title: 'Echo', priceStatus: 'unresolved' },
        { canonicalGameId: 'epic:catalog:d', title: 'Delta', priceStatus: 'unresolved' },
    ]) });
    assert.deepEqual(snapshot.sections[0].games.map((game) => game.title), ['Alpha', 'Zulu', 'Cheap']);
    assert.deepEqual(snapshot.sections[1].games.map((game) => game.title), ['Delta', 'Echo']);
});

test('snapshot strips unsafe account identity and credentials and rejects email display names', () => {
    const snapshot = buildVaultShowcaseSnapshot({ account: account([priced('epic:catalog:a', 'A', 100)], {
        displayName: 'player@example.com', token: 'secret', credentials: { password: 'secret' },
    }) });
    assert.equal(snapshot.displayName, null);
    assert.equal(JSON.stringify(snapshot).includes('player@example.com'), false);
    assert.equal(JSON.stringify(snapshot).includes('raw-account-id'), false);
    assert.equal(containsSensitiveFields(snapshot), false);
});

test('missing or untrusted poster sources become placeholders without failing the snapshot', () => {
    const snapshot = buildVaultShowcaseSnapshot({
        account: account([priced('epic:catalog:a', 'A', 100), { canonicalGameId: 'epic:catalog:b', title: 'B', priceStatus: 'unresolved' }]),
        resolveCover: (game) => game.title === 'A' ? 'https://example.invalid/poster.jpg' : null,
    });
    assert.deepEqual(snapshot.sections.flatMap((section) => section.games).map((game) => game.coverSource), [null, null]);
});

test('display options and committed price timestamp are frozen into the snapshot', () => {
    const source = account([priced('epic:catalog:a', 'A', 1234)], { pricesFetchedAt: '2026-09-11T08:30:00.000Z' });
    const options = { currentLibraryValue: false, totalPaid: true, totalRefunded: false, netSpend: true };
    const snapshot = buildVaultShowcaseSnapshot({ account: source, displayOptions: options });
    source.games[0].livePrice.amount = 999999;
    source.pricesFetchedAt = '2026-09-12T08:30:00.000Z';
    assert.deepEqual(snapshot.displayOptions, options);
    assert.equal(snapshot.priceDataAt, '2026-09-11T08:30:00.000Z');
    assert.equal(snapshot.sections[0].games[0].priceMinor, 1234);
});

test('all 16 financial display-option combinations survive snapshot construction exactly', () => {
    const keys = ['currentLibraryValue', 'totalPaid', 'totalRefunded', 'netSpend'];
    for (let mask = 0; mask < 16; mask += 1) {
        const displayOptions = Object.fromEntries(keys.map((key, index) => [key, Boolean(mask & (1 << index))]));
        const snapshot = buildVaultShowcaseSnapshot({ account: account([priced('epic:catalog:a', 'A', 100)]), displayOptions });
        assert.deepEqual(snapshot.displayOptions, displayOptions);
    }
});

test('equal price and title ties use canonical key and no-price games remain in their own trailing section', () => {
    const snapshot = buildVaultShowcaseSnapshot({ account: account([
        priced('epic:catalog:z', 'Same', 500),
        priced('epic:catalog:a', 'same', 500),
        { canonicalGameId: 'epic:catalog:pending', title: 'A Pending Game', priceStatus: 'unresolved' },
    ]) });
    assert.deepEqual(snapshot.sections[0].games.map((game) => game.key), ['epic:catalog:a', 'epic:catalog:z']);
    assert.equal(snapshot.sections[1].key, 'price_unavailable');
    assert.deepEqual(snapshot.sections[1].games.map((game) => game.title), ['A Pending Game']);
});
test('title words Pack, Bundle, and Episode do not exclude legitimate games', () => {
    const games = [
        priced('epic:catalog:pack', 'The Jackbox Party Pack 4', 2499),
        priced('epic:catalog:bundle', 'A Complete Bundle Adventure', 1999, 'USD', { productType: 'GAME' }),
        priced('epic:catalog:episode', 'Episode One', 999, 'USD', { categories: ['games'] }),
    ];
    const snapshot = buildVaultShowcaseSnapshot({ account: account(games) });
    assert.deepEqual(snapshot.sections[0].games.map((game) => game.title), ['The Jackbox Party Pack 4', 'A Complete Bundle Adventure', 'Episode One']);
    assert.equal(snapshot.counts.nonGameExcluded, 0);
});

test('authoritative structured add-on types override titles while narrow fallbacks exclude clear utilities', () => {
    const snapshot = buildVaultShowcaseSnapshot({ account: account([
        priced('epic:catalog:game', 'Game DLC in the Name', 500, 'USD', { productType: 'GAME' }),
        priced('epic:catalog:dlc', 'Extra Chapter', 400, 'USD', { productType: 'DLC' }),
        priced('epic:catalog:soundtrack', 'Music Collection', 300, 'USD', { categories: ['soundtrack'] }),
        priced('epic:catalog:currency', 'Coins', 200, 'USD', { entitlementType: 'virtual_currency' }),
        priced('epic:catalog:demo', 'Clearly a Demo', 100),
        priced('epic:catalog:unknown', 'Ordinary Unknown Product', 50),
    ]) });
    assert.deepEqual(snapshot.sections[0].games.map((game) => game.title), ['Game DLC in the Name', 'Ordinary Unknown Product']);
    assert.equal(snapshot.counts.nonGameExcluded, 4);
});

test('all owned entries reconcile without silent disappearance', () => {
    const source = [priced('epic:catalog:a', 'A', 100), priced('epic:catalog:a', 'A duplicate', 90),
        { canonicalGameId: 'epic:catalog:free', title: 'Free', priceStatus: 'free' },
        { canonicalGameId: 'epic:catalog:gone', title: 'Gone', priceStatus: 'unavailable' },
        { canonicalGameId: 'epic:catalog:demo', title: 'Sample Demo', priceStatus: 'free' }];
    const snapshot = buildVaultShowcaseSnapshot({ account: account(source) });
    assert.equal(snapshot.counts.rawOwned, 5);
    assert.equal(snapshot.counts.canonicalOwned, 4);
    assert.equal(snapshot.counts.duplicatesRemoved, 1);
    assert.equal(snapshot.counts.rawOwned, snapshot.counts.included + snapshot.counts.freeExcluded + snapshot.counts.nonGameExcluded + snapshot.counts.duplicatesRemoved);
});