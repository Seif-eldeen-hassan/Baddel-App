'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    canonicalizeEpicLibraryGames,
    isCanonicalEpicGameRecord,
} = require('../src/features/sync/domain/services/EpicCanonicalProductIdentity');

test('explicit non-game product types are excluded without title-based edition collapse', () => {
    const records = [
        { title: 'Base Game', namespace: 'base', appName: 'base', productType: 'game' },
        { title: 'Base Game DLC', namespace: 'base', appName: 'base-dlc', productType: 'DLC' },
        { title: 'Base Game Ultimate Edition', namespace: 'base', appName: 'base-ultimate', productType: 'game' },
        { title: 'Creator Asset', namespace: 'fab', appName: 'asset', productType: 'marketplace asset' },
    ];
    const result = canonicalizeEpicLibraryGames(records);
    assert.equal(isCanonicalEpicGameRecord(records[0]), true);
    assert.equal(isCanonicalEpicGameRecord(records[1]), false);
    assert.equal(result.diagnostics.nonGameExcludedCount, 2);
    assert.deepEqual(result.games.map((game) => game.title), ['Base Game', 'Base Game Ultimate Edition']);
});
