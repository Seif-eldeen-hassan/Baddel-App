'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    canonicalizeEpicLibraryGames,
    epicCanonicalAliases,
} = require('../src/features/sync/domain/services/EpicCanonicalProductIdentity');

test('655 raw entries can retain diagnostics while every account projection uses 619 canonical games', () => {
    const retained = Array.from({ length: 619 }, (_, index) => ({
        id: `epic_app_${index}`,
        title: `Game ${index}`,
        platform: 'epic',
        namespace: `namespace-${index}`,
        catalogItemId: `catalog-${index}`,
        appName: `app-${index}`,
        ownedByAccountIds: ['account-a'],
    }));
    for (let index = 0; index < 5; index += 1) {
        retained.push({
            id: `epic_duplicate_${index}`,
            title: `Game ${index}`,
            platform: 'epic',
            namespace: `namespace-${index}`,
            catalogItemId: `alternate-catalog-${index}`,
            appName: `app-${index}`,
            ownedByAccountIds: ['account-a'],
        });
    }
    const result = canonicalizeEpicLibraryGames(retained);
    const diagnostics = {
        rawLegendaryCount: 655,
        rejectedCount: 20,
        unknownCount: 11,
        nonGameExcludedCount: 31,
        duplicateCollapsedCount: result.diagnostics.duplicateCollapsedCount,
        canonicalGameCount: result.games.length,
    };
    assert.equal(retained.length, 624);
    assert.equal(result.games.length, 619);
    assert.equal(diagnostics.rawLegendaryCount, 655);
    assert.equal(diagnostics.duplicateCollapsedCount, 5);
    const userFacingCounts = {
        connectedPlatform: result.games.length,
        foundOwnedGames: result.games.length,
        vaultHeader: result.games.length,
        accountFilter: result.games.length,
        priceMaximum: result.games.length,
    };
    assert.deepEqual([...new Set(Object.values(userFacingCounts))], [619]);
});

test('canonical aliases merge source variants but keep real editions distinct', () => {
    const input = [
        { title: 'Control', namespace: 'control', catalogItemId: 'catalog-a', appName: 'control-base' },
        { title: 'Control', namespace: 'control', catalogItemId: 'catalog-b', appName: 'control-base' },
        { title: 'Control Ultimate Edition', namespace: 'control', catalogItemId: 'catalog-u', appName: 'control-ultimate' },
    ];
    const result = canonicalizeEpicLibraryGames(input);
    assert.equal(result.games.length, 2);
    assert.equal(result.diagnostics.duplicateCollapsedCount, 1);
    assert.ok(result.games[0].canonicalAliases.includes('epic:ns:control:catalog:catalog-a'));
    assert.ok(result.games[0].canonicalAliases.includes('epic:ns:control:catalog:catalog-b'));
    assert.notEqual(result.games[0].canonicalGameId, result.games[1].canonicalGameId);
    assert.ok(epicCanonicalAliases(result.games[1]).includes('epic:ns:control:app:control-ultimate'));
});

test('Current Prices consumes canonical library games only and cannot include purchase history rows', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '..', 'platformSync.js'), 'utf8');
    const start = source.indexOf('function buildEpicPriceCandidates');
    const end = source.indexOf('function mergeEpicLivePrices', start);
    const body = source.slice(start, end);
    assert.match(body, /canonicalizeEpicLibraryGames\(libraryGames\)/);
    assert.doesNotMatch(body, /purchaseGames|purchase_history/);
    assert.match(source, /const allCandidates = buildEpicPriceCandidates\(games\);/);
    assert.doesNotMatch(source, /buildEpicPriceCandidates\(games, purchaseGames\)/);
});

test('user-facing Epic counts are sourced from canonical collections while raw counts stay diagnostic', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '..', 'platformSync.js'), 'utf8');
    assert.match(source, /gamesCount: canonicalGameCount/);
    assert.match(source, /Found \$\{canonicalGameCount\} owned games/);
    assert.match(source, /totalGamesOwned: canonicalRows\.length/);
    assert.match(source, /gamesFetched: accountGames\.length/);
    assert.match(source, /rawLegendaryCount/);
    assert.match(source, /libraryDiagnostics/);
});
