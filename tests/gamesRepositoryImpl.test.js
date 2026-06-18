'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');

const { GamesRepositoryImpl } = require('../src/features/games/infrastructure/repositories/GamesRepositoryImpl');

// ── helpers ───────────────────────────────────────────────────────────────────

// Legacy-delegate path (pre-13.4 / rollback)
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

// JsonGameRepository injection path (Step 13.4+)
function makeRepoViaJsonRepo({
    savedGames           = [],
    hiddenGames          = [],
    reorderLibrary       = async () => ({ status: 'success' }),
    unhideAllGames       = async () => ({ status: 'success' }),
    renameGame           = async () => ({ status: 'success' }),
    restoreSpecificGames = async () => ({ status: 'success', count: 0 }),
    removeGame           = async () => ({ status: 'success' }),
} = {}) {
    const jsonGameRepository = {
        getSavedGames:        () => savedGames,
        getHiddenGames:       () => hiddenGames,
        reorderLibrary,
        unhideAllGames,
        renameGame,
        restoreSpecificGames,
        removeGame,
    };
    return new GamesRepositoryImpl({ jsonGameRepository });
}

// ── getGameById (legacy delegate path) ───────────────────────────────────────

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

// ── getHiddenGames (legacy delegate path) ────────────────────────────────────

test('GamesRepositoryImpl: getHiddenGames returns legacy result unchanged', () => {
    const hidden = [{ id: 'h1', name: 'Hidden Game', isHidden: true }];
    const repo = makeRepo({ hidden });
    assert.deepEqual(repo.getHiddenGames(), hidden);
});

test('GamesRepositoryImpl: getHiddenGames returns empty array when nothing hidden', () => {
    const repo = makeRepo({ hidden: [] });
    assert.deepEqual(repo.getHiddenGames(), []);
});

// ── reorderLibrary (legacy delegate path) ────────────────────────────────────

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

// ── unhideAllGames (legacy delegate path) ────────────────────────────────────

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

// ── renameGame (legacy delegate path) ────────────────────────────────────────

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

// ── restoreSpecificGames (legacy delegate path) ───────────────────────────────

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

// ── removeGame (legacy delegate path) ────────────────────────────────────────

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

// ── getGameById (jsonGameRepository path) ────────────────────────────────────

test('GamesRepositoryImpl(jsonRepo): getGameById reads from jsonGameRepository.getSavedGames', () => {
    const game = { id: 'x99', name: 'Hades' };
    const repo = makeRepoViaJsonRepo({ savedGames: [game] });
    assert.deepEqual(repo.getGameById('x99'), game);
});

test('GamesRepositoryImpl(jsonRepo): getGameById returns null when id absent', () => {
    const repo = makeRepoViaJsonRepo({ savedGames: [{ id: 'aaa', name: 'Game A' }] });
    assert.equal(repo.getGameById('zzz'), null);
});

test('GamesRepositoryImpl(jsonRepo): getGameById string-coerces id comparison', () => {
    const game = { id: 'abc', name: 'Celeste' };
    const repo = makeRepoViaJsonRepo({ savedGames: [game] });
    assert.deepEqual(repo.getGameById(String('abc')), game);
});

test('GamesRepositoryImpl(jsonRepo): getGameById returns null if getSavedGames throws', () => {
    const repo = new GamesRepositoryImpl({
        jsonGameRepository: { getSavedGames: () => { throw new Error('repo exploded'); } },
    });
    assert.equal(repo.getGameById('x'), null);
});

// ── getHiddenGames (jsonGameRepository path) ──────────────────────────────────

test('GamesRepositoryImpl(jsonRepo): getHiddenGames delegates to jsonGameRepository.getHiddenGames', () => {
    const hidden = [{ id: 'h9', name: 'Buried', isHidden: true }];
    const repo = makeRepoViaJsonRepo({ hiddenGames: hidden });
    assert.deepEqual(repo.getHiddenGames(), hidden);
});

test('GamesRepositoryImpl(jsonRepo): getHiddenGames returns empty array when nothing hidden', () => {
    const repo = makeRepoViaJsonRepo({ hiddenGames: [] });
    assert.deepEqual(repo.getHiddenGames(), []);
});

// ── reorderLibrary (jsonGameRepository path) ──────────────────────────────────

test('GamesRepositoryImpl(jsonRepo): reorderLibrary delegates to jsonGameRepository.reorderLibrary', () => {
    let receivedIds;
    const repo = makeRepoViaJsonRepo({ reorderLibrary: (ids) => { receivedIds = ids; return { status: 'success' }; } });
    repo.reorderLibrary(['g3', 'g1', 'g2']);
    assert.deepEqual(receivedIds, ['g3', 'g1', 'g2']);
});

test('GamesRepositoryImpl(jsonRepo): reorderLibrary returns repository result unchanged', () => {
    const r = { status: 'success' };
    const repo = makeRepoViaJsonRepo({ reorderLibrary: () => r });
    assert.equal(repo.reorderLibrary([]), r);
});

// ── unhideAllGames (jsonGameRepository path) ──────────────────────────────────

test('GamesRepositoryImpl(jsonRepo): unhideAllGames delegates to jsonGameRepository.unhideAllGames', () => {
    let called = false;
    const repo = makeRepoViaJsonRepo({ unhideAllGames: () => { called = true; return { status: 'success', restoredCount: 5 }; } });
    repo.unhideAllGames();
    assert.ok(called, 'jsonGameRepository.unhideAllGames was not called');
});

test('GamesRepositoryImpl(jsonRepo): unhideAllGames returns repository result unchanged', () => {
    const r = { status: 'success', restoredCount: 7 };
    const repo = makeRepoViaJsonRepo({ unhideAllGames: () => r });
    assert.equal(repo.unhideAllGames(), r);
});

// ── renameGame (jsonGameRepository path) ─────────────────────────────────────

test('GamesRepositoryImpl(jsonRepo): renameGame delegates gameId and newName to jsonGameRepository', () => {
    let rId, rName;
    const repo = makeRepoViaJsonRepo({ renameGame: (id, name) => { rId = id; rName = name; return { status: 'success' }; } });
    repo.renameGame('gX', 'Cool Title');
    assert.equal(rId, 'gX');
    assert.equal(rName, 'Cool Title');
});

test('GamesRepositoryImpl(jsonRepo): renameGame returns repository result unchanged', () => {
    const r = { status: 'success', newName: 'Cool Title', customTitleLocked: true, titleSource: 'creator', titleUpdatedAt: 999 };
    const repo = makeRepoViaJsonRepo({ renameGame: () => r });
    assert.equal(repo.renameGame('g1', 'Cool Title'), r);
});

// ── restoreSpecificGames (jsonGameRepository path) ────────────────────────────

test('GamesRepositoryImpl(jsonRepo): restoreSpecificGames delegates ids to jsonGameRepository', async () => {
    let rIds;
    const repo = makeRepoViaJsonRepo({ restoreSpecificGames: async (ids) => { rIds = ids; return { status: 'success', count: ids.length }; } });
    await repo.restoreSpecificGames(['a', 'b', 'c']);
    assert.deepEqual(rIds, ['a', 'b', 'c']);
});

test('GamesRepositoryImpl(jsonRepo): restoreSpecificGames returns repository result unchanged', async () => {
    const r = { status: 'success', count: 3 };
    const repo = makeRepoViaJsonRepo({ restoreSpecificGames: async () => r });
    assert.equal(await repo.restoreSpecificGames(['a', 'b', 'c']), r);
});

// ── removeGame (jsonGameRepository path) ─────────────────────────────────────

test('GamesRepositoryImpl(jsonRepo): removeGame delegates gameId to jsonGameRepository', async () => {
    let rId;
    const repo = makeRepoViaJsonRepo({ removeGame: async (id) => { rId = id; return { status: 'success' }; } });
    await repo.removeGame('g77');
    assert.equal(rId, 'g77');
});

test('GamesRepositoryImpl(jsonRepo): removeGame returns repository result unchanged', async () => {
    const r = { status: 'success' };
    const repo = makeRepoViaJsonRepo({ removeGame: async () => r });
    assert.equal(await repo.removeGame('g1'), r);
});

// ── jsonGameRepository takes precedence over legacy delegates when both supplied ──

test('GamesRepositoryImpl: jsonGameRepository path wins when both jsonRepo and legacy delegate provided', () => {
    let jsonCalled = false, legacyCalled = false;
    const repo = new GamesRepositoryImpl({
        jsonGameRepository: {
            getSavedGames:  () => { jsonCalled = true; return []; },
            getHiddenGames: () => [],
        },
        getSavedGames: () => { legacyCalled = true; return []; },
        getHiddenGames: () => [],
    });
    repo.getGameById('x');
    assert.ok(jsonCalled,   'jsonGameRepository.getSavedGames should have been called');
    assert.ok(!legacyCalled, 'legacy getSavedGames must NOT be called when jsonRepo is present');
});
