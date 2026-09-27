'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('src/js/accounts.js', 'utf8');

test('populated-cache navigation warms a bounded first paint before background full resolution', () => {
    const start = source.indexOf('async function navigateToAllGames');
    const end = source.indexOf('async function navigateToReadyToInstall', start);
    const block = source.slice(start, end);
    assert.match(block, /cacheWarmLimit[^]*?__baddelAllGamesFirstPaintWarmLimit\s*\?\?\s*48/);
        assert.match(block, /await _agWarmCachedCoversForGames\(visibleGames,[^]*?limit:\s*cacheWarmLimit/);
    assert.match(block, /_agStartCompleteLibraryCoverHydration\(visibleGames/);
    assert.doesNotMatch(block, /await _agResolveLocalCoverPathsForRevision\(window\._allGamesCache/);
});


test('recycled All Games cards use a byte-budgeted retained LRU', () => {
    assert.ok(source.includes('retainedCardBudgetBytes: 96 * 1024 * 1024'));
    assert.match(source, /function _vsCardDecodedBytes/);
    assert.match(source, /function _vsEvictRetainedCardsToBudget/);
    assert.ok(source.includes('while (_vs.retainedCardBytes > _vs.retainedCardBudgetBytes'));
    assert.ok(source.includes('_vsClearCardCoverForRebind(card, null)'));
});

test('retained card reuse is identity-safe and rebinds changed artwork', () => {
    const start = source.indexOf('function _vsAcquireCard');
    const end = source.indexOf('// Synchronous first-paint helper', start);
    const body = source.slice(start, end);
    assert.ok(body.includes('_vs.retainedCards.get(gameId)'));
    assert.ok(body.includes('card._vsBoundGame !== game'));
    assert.ok(body.includes('card.dataset.coverUrl'));
    assert.ok(body.includes('_vsBindCard(card, game)'));
});
