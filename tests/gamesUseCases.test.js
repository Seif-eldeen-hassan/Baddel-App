'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');

const { GetGameByIdUseCase }    = require('../src/features/games/application/useCases/GetGameByIdUseCase');
const { GetHiddenGamesUseCase } = require('../src/features/games/application/useCases/GetHiddenGamesUseCase');
const { ReorderLibraryUseCase }  = require('../src/features/games/application/useCases/ReorderLibraryUseCase');
const { UnhideAllGamesUseCase }  = require('../src/features/games/application/useCases/UnhideAllGamesUseCase');
const { RenameGameUseCase }      = require('../src/features/games/application/useCases/RenameGameUseCase');

// ── GetGameByIdUseCase ────────────────────────────────────────────────────────

test('GetGameByIdUseCase: execute delegates to repository.getGameById', () => {
    const game = { id: 'g1', name: 'Half-Life' };
    let calledWith;
    const repo = { getGameById(id) { calledWith = id; return game; } };
    const uc = new GetGameByIdUseCase(repo);
    uc.execute('g1');
    assert.equal(calledWith, 'g1');
});

test('GetGameByIdUseCase: execute returns repository result unchanged', () => {
    const game = { id: 'g1', name: 'Half-Life' };
    const repo = { getGameById: () => game };
    const uc = new GetGameByIdUseCase(repo);
    assert.equal(uc.execute('g1'), game);
});

test('GetGameByIdUseCase: execute returns null when repository returns null', () => {
    const repo = { getGameById: () => null };
    const uc = new GetGameByIdUseCase(repo);
    assert.equal(uc.execute('missing'), null);
});

// ── GetHiddenGamesUseCase ─────────────────────────────────────────────────────

test('GetHiddenGamesUseCase: execute delegates to repository.getHiddenGames', () => {
    let called = false;
    const repo = { getHiddenGames() { called = true; return []; } };
    const uc = new GetHiddenGamesUseCase(repo);
    uc.execute();
    assert.ok(called, 'getHiddenGames was not called');
});

test('GetHiddenGamesUseCase: execute returns repository result unchanged', () => {
    const hidden = [{ id: 'h1', name: 'Buried Game', isHidden: true }];
    const repo = { getHiddenGames: () => hidden };
    const uc = new GetHiddenGamesUseCase(repo);
    assert.equal(uc.execute(), hidden);
});

test('GetHiddenGamesUseCase: execute returns empty array when nothing hidden', () => {
    const repo = { getHiddenGames: () => [] };
    const uc = new GetHiddenGamesUseCase(repo);
    assert.deepEqual(uc.execute(), []);
});

// ── ReorderLibraryUseCase ─────────────────────────────────────────────────────

test('ReorderLibraryUseCase: execute delegates to repository.reorderLibrary', () => {
    let calledWith;
    const repo = { reorderLibrary(ids) { calledWith = ids; return { status: 'success' }; } };
    const uc = new ReorderLibraryUseCase(repo);
    const ids = ['g3', 'g1', 'g2'];
    uc.execute(ids);
    assert.deepEqual(calledWith, ids);
});

test('ReorderLibraryUseCase: execute returns repository result unchanged', () => {
    const legacyResult = { status: 'success' };
    const repo = { reorderLibrary: () => legacyResult };
    const uc = new ReorderLibraryUseCase(repo);
    assert.equal(uc.execute([]), legacyResult);
});

test('ReorderLibraryUseCase: execute propagates error result from repository', () => {
    const repo = { reorderLibrary: () => ({ status: 'error' }) };
    const uc = new ReorderLibraryUseCase(repo);
    assert.deepEqual(uc.execute([]), { status: 'error' });
});

// ── UnhideAllGamesUseCase ─────────────────────────────────────────────────────

test('UnhideAllGamesUseCase: execute delegates to repository.unhideAllGames', () => {
    let called = false;
    const repo = { unhideAllGames() { called = true; return { status: 'success', restoredCount: 1 }; } };
    const uc = new UnhideAllGamesUseCase(repo);
    uc.execute();
    assert.ok(called, 'unhideAllGames was not called');
});

test('UnhideAllGamesUseCase: execute returns repository result unchanged', () => {
    const legacyResult = { status: 'success', restoredCount: 5 };
    const repo = { unhideAllGames: () => legacyResult };
    const uc = new UnhideAllGamesUseCase(repo);
    assert.equal(uc.execute(), legacyResult);
});

test('UnhideAllGamesUseCase: execute returns no_hidden status when nothing was hidden', () => {
    const repo = { unhideAllGames: () => ({ status: 'no_hidden' }) };
    const uc = new UnhideAllGamesUseCase(repo);
    assert.deepEqual(uc.execute(), { status: 'no_hidden' });
});

// ── RenameGameUseCase ─────────────────────────────────────────────────────────

test('RenameGameUseCase: execute delegates gameId and newName to repository.renameGame', () => {
    let receivedId, receivedName;
    const repo = { renameGame(id, name) { receivedId = id; receivedName = name; return { status: 'success' }; } };
    const uc = new RenameGameUseCase(repo);
    uc.execute('g1', 'New Title');
    assert.equal(receivedId, 'g1');
    assert.equal(receivedName, 'New Title');
});

test('RenameGameUseCase: execute returns repository result unchanged', () => {
    const legacyResult = { status: 'success', newName: 'New Title', customTitleLocked: true, titleSource: 'creator', titleUpdatedAt: 12345 };
    const repo = { renameGame: () => legacyResult };
    const uc = new RenameGameUseCase(repo);
    assert.equal(uc.execute('g1', 'New Title'), legacyResult);
});

test('RenameGameUseCase: execute propagates error result from repository', () => {
    const repo = { renameGame: () => ({ status: 'error', message: 'Game not found' }) };
    const uc = new RenameGameUseCase(repo);
    assert.deepEqual(uc.execute('missing', 'X'), { status: 'error', message: 'Game not found' });
});
