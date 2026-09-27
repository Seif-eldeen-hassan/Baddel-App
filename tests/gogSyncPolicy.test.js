'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifySyncCandidate, preserveLastKnownGood } = require('../src/features/sync/domain/services/GogSyncPolicy');

test('first-sync records request basic enrichment and known non-games do not repeat it', () => {
    assert.equal(classifySyncCandidate(null), 'new');
    assert.equal(classifySyncCandidate(null, { kind: 'non-game', checkedAt: new Date().toISOString() }), 'known-non-game');
    assert.equal(classifySyncCandidate(null, { kind: 'non-game', checkedAt: '2020-01-01T00:00:00.000Z' }), 'new');
});

test('unchanged good GOG metadata skips enrichment', () => {
    assert.equal(classifySyncCandidate({ productId: '1', title: 'Good Game', coverUrl: 'https://img' }), 'unchanged');
});

test('fallback titles and missing covers remain repairable', () => {
    assert.equal(classifySyncCandidate({ productId: '1', title: 'GOG 1', coverUrl: 'https://img' }), 'title-repair');
    assert.equal(classifySyncCandidate({ productId: '1', title: 'Good Game', coverUrl: null }), 'cover-repair');
});

test('transient enrichment failure preserves last-known-good title and artwork', () => {
    const result = preserveLastKnownGood(
        { productId: '1', title: 'Good Game', titleSource: 'gamesdb', coverUrl: 'https://cover', heroUrl: 'https://hero' },
        { productId: '1', title: 'GOG 1', titleSource: 'fallback-id', coverUrl: null, heroUrl: null },
    );
    assert.equal(result.title, 'Good Game');
    assert.equal(result.coverUrl, 'https://cover');
    assert.equal(result.heroUrl, 'https://hero');
});
