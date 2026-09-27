'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    normalizeGogRelease,
    mergeGogGames,
    isGogFallbackTitle,
} = require('../src/features/sync/infrastructure/integrations/gog/GogLibraryNormalizer');

const accountA = { id: 'a', displayName: 'A' };
const accountB = { id: 'b', displayName: 'B' };

test('first unresolved sync is upgraded when later metadata resolves a real title', () => {
    const merged = new Map();
    const fallback = normalizeGogRelease({ external_id: '1098723469' }, accountA);
    const resolved = normalizeGogRelease({ external_id: '1098723469', title: { '*': 'A Real Game' } }, accountA);
    mergeGogGames(merged, [fallback], accountA);
    mergeGogGames(merged, [resolved], accountA);
    assert.equal(merged.get('gog_1098723469').title, 'A Real Game');
    assert.equal(merged.get('gog_1098723469').needsMetadataEnrichment, false);
});

test('existing real title is never downgraded by a later enrichment failure', () => {
    const merged = new Map();
    mergeGogGames(merged, [normalizeGogRelease({ external_id: '42', title: 'Stable Title' }, accountA)], accountA);
    mergeGogGames(merged, [normalizeGogRelease({ external_id: '42' }, accountA)], accountA);
    assert.equal(merged.get('gog_42').title, 'Stable Title');
    assert.equal(merged.get('gog_42').needsMetadataEnrichment, false);
});

test('multi-account merge retains the best title and both owners', () => {
    const merged = new Map();
    mergeGogGames(merged, [normalizeGogRelease({ external_id: '77' }, accountA)], accountA);
    mergeGogGames(merged, [normalizeGogRelease({ external_id: '77', title: 'Shared Game' }, accountB)], accountB);
    const game = merged.get('gog_77');
    assert.equal(game.title, 'Shared Game');
    assert.deepEqual(game.ownedByAccountIds, ['a', 'b']);
});

test('store metadata supplies a title when GamesDB is unavailable', () => {
    const game = normalizeGogRelease({ external_id: '88', _storeProduct: { title: 'Store Title' } }, accountA);
    assert.equal(game.title, 'Store Title');
    assert.equal(game.titleSource, 'store-product');
});

test('GamesDB title survives missing store metadata', () => {
    const game = normalizeGogRelease({ external_id: '99', title: { '*': 'GamesDB Title' } }, accountA);
    assert.equal(game.title, 'GamesDB Title');
    assert.equal(game.titleSource, 'gamesdb');
});

test('all metadata unavailable keeps stable identity and marks bounded enrichment work', () => {
    const game = normalizeGogRelease({ external_id: '123' }, accountA);
    assert.equal(game.title, 'GOG 123');
    assert.equal(game.needsMetadataEnrichment, true);
    assert.equal(isGogFallbackTitle(game.title, '123'), true);
});

test('existing cached fallback records are repaired by normal merge without wiping the library', () => {
    const merged = new Map([['gog_456', {
        id: 'gog_456', productId: '456', title: 'GOG 456', ownedBy: ['A'], ownedByAccountIds: ['a'], info: {},
    }]]);
    mergeGogGames(merged, [normalizeGogRelease({ external_id: '456', _storeProduct: { title: 'Repaired Title' } }, accountA)], accountA);
    assert.equal(merged.get('gog_456').title, 'Repaired Title');
});
