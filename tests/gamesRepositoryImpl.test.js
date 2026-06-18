'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');

const { GamesRepositoryImpl } = require('../src/features/games/infrastructure/repositories/GamesRepositoryImpl');

// ── helpers ───────────────────────────────────────────────────────────────────

function makeRepo({
    saved = [],
    hidden = [],
    reorderLibrary       = () => ({ status: 'success' }),
    unhideAllGames       = () => ({ status: 'success' }),
    renameGame           = () => ({ status: 'success' }),
    restoreSpecificGames = async () => ({ status: 'success', count: 0 }),
    removeGame           = async () => ({ status: 'success' }),
} = {}) {
    return new GamesRepositoryImpl({
        getSavedGames:  () => saved,
        getHiddenGames: () => hidden,
        reorderLibrary,
        unhideAllGames,
        renameGame,
        restoreSpecificGames,
        removeGame,
    });
}

// ── getGameById ───────────────────────────────────────────────────────────────

test('GamesRepositoryImpl: getGameById returns matching game', () => {
    const game = { id: 'abc123', name: 'Portal 2' };
    const repo = makeRepo({ saved: [game] });
    assert.deepEqual(repo.getGameById('abc123'), game);
});

test('GamesRepositoryImpl: getGameById compares ids as strings', () => {
    const game = { id: 'abc123', name: 'Portal 2' };
    const repo = makeRepo({ saved: [game] });
    // id stored as string, caller passes same string — must match
    assert.deepEqual(repo.getGameById(String('abc123')), game);
});

test('GamesRepositoryImpl: getGameById returns null when no match', () => {
    const repo = makeRepo({ saved: [{ id: 'abc123', name: 'Portal 2' }] });
    assert.equal(repo.getGameById('no-such-id'), null);
});

test('GamesRepositoryImpl: getGameById returns null if getSavedGames throws', () => {
    const repo = new GamesRepositoryImpl({
        getSavedGames:  () => { throw new Error('db exploded'); },
        getHiddenGames: () => [],
    });
    assert.equal(repo.getGameById('abc123'), null);
});

// ── getHiddenGames ────────────────────────────────────────────────────────────

test('GamesRepositoryImpl: getHiddenGames returns legacy result unchanged', () => {
    const hidden = [{ id: 'h1', name: 'Hidden Game', isHidden: true }];
    const repo = makeRepo({ hidden });
    assert.deepEqual(repo.getHiddenGames(), hidden);
});

test('GamesRepositoryImpl: getHiddenGames returns empty array when nothing hidden', () => {
    const repo = makeRepo({ hidden: [] });
    assert.deepEqual(repo.getHiddenGames(), []);
});

// ── reorderLibrary ────────────────────────────────────────────────────────────

test('GamesRepositoryImpl: reorderLibrary delegates to legacy with same ids', () => {
    const received = [];
    const repo = makeRepo({ reorderLibrary: (ids) => { received.push(...ids); return { status: 'success' }; } });
    repo.reorderLibrary(['g2', 'g1', 'g3']);
    assert.deepEqual(received, ['g2', 'g1', 'g3']);
});

test('GamesRepositoryImpl: reorderLibrary returns legacy result unchanged', () => {
    const legacyResult = { status: 'success' };
    const repo = makeRepo({ reorderLibrary: () => legacyResult });
    assert.equal(repo.reorderLibrary([]), legacyResult);
});

// ── unhideAllGames ────────────────────────────────────────────────────────────

test('GamesRepositoryImpl: unhideAllGames delegates to legacy unhideAllGames', () => {
    let called = false;
    const repo = makeRepo({ unhideAllGames: () => { called = true; return { status: 'success', restoredCount: 3 }; } });
    repo.unhideAllGames();
    assert.ok(called, 'legacy unhideAllGames was not called');
});

test('GamesRepositoryImpl: unhideAllGames returns legacy result unchanged', () => {
    const legacyResult = { status: 'success', restoredCount: 2 };
    const repo = makeRepo({ unhideAllGames: () => legacyResult });
    assert.equal(repo.unhideAllGames(), legacyResult);
});

// ── renameGame ────────────────────────────────────────────────────────────────

test('GamesRepositoryImpl: renameGame delegates with same gameId and newName', () => {
    let receivedId, receivedName;
    const repo = makeRepo({ renameGame: (id, name) => { receivedId = id; receivedName = name; return { status: 'success' }; } });
    repo.renameGame('g1', 'New Title');
    assert.equal(receivedId, 'g1');
    assert.equal(receivedName, 'New Title');
});

test('GamesRepositoryImpl: renameGame returns legacy result unchanged', () => {
    const legacyResult = { status: 'success', newName: 'New Title', customTitleLocked: true, titleSource: 'creator', titleUpdatedAt: 12345 };
    const repo = makeRepo({ renameGame: () => legacyResult });
    assert.equal(repo.renameGame('g1', 'New Title'), legacyResult);
});

// ── restoreSpecificGames ──────────────────────────────────────────────────────

test('GamesRepositoryImpl: restoreSpecificGames delegates to legacy with same ids', async () => {
    let receivedIds;
    const repo = makeRepo({ restoreSpecificGames: async (ids) => { receivedIds = ids; return { status: 'success', count: ids.length }; } });
    await repo.restoreSpecificGames(['g1', 'g2', 'g3']);
    assert.deepEqual(receivedIds, ['g1', 'g2', 'g3']);
});

test('GamesRepositoryImpl: restoreSpecificGames returns legacy result unchanged', async () => {
    const legacyResult = { status: 'success', count: 2 };
    const repo = makeRepo({ restoreSpecificGames: async () => legacyResult });
    const result = await repo.restoreSpecificGames(['g1', 'g2']);
    assert.equal(result, legacyResult);
});

// ── removeGame ────────────────────────────────────────────────────────────────

test('GamesRepositoryImpl: removeGame delegates to legacy removeGame with same id', async () => {
    let receivedId;
    const repo = makeRepo({ removeGame: async (id) => { receivedId = id; return { status: 'success' }; } });
    await repo.removeGame('g99');
    assert.equal(receivedId, 'g99');
});

test('GamesRepositoryImpl: removeGame returns legacy result unchanged', async () => {
    const legacyResult = { status: 'success' };
    const repo = makeRepo({ removeGame: async () => legacyResult });
    const result = await repo.removeGame('g1');
    assert.equal(result, legacyResult);
});
