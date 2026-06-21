'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');

const { removeEpicNonGameEntries } = require('../src/features/games/application/useCases/RemoveEpicNonGameEntriesUseCase');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEpicGame(overrides = {}) {
    return { id: 'epic-1', name: 'Game', platform: 'epic', ...overrides };
}

function makePolicy(allowedById = {}) {
    return {
        isEpicSyncedGameAllowed: (game) => {
            if (game.id in allowedById) return allowedById[game.id];
            return true;
        },
    };
}

function makeDeps(overrides = {}) {
    const games         = overrides.games || [];
    const deletedIds    = [];
    const deletedImages = [];
    const dbSaves       = [];

    return {
        gamesRepository: overrides.gamesRepository ?? {
            getAllGames:      () => games,
            deleteGamesByIds: (ids) => { deletedIds.push(...ids); },
        },
        imageCacheService: overrides.imageCacheService ?? {
            deleteGameImages: (id) => { deletedImages.push(id); },
        },
        saveDatabase:    overrides.saveDatabase ?? (() => { dbSaves.push(1); }),
        epicEntryPolicy: overrides.epicEntryPolicy ?? makePolicy(),
        _deletedIds:     () => deletedIds,
        _deletedImages:  () => deletedImages,
        _dbSaves:        () => dbSaves,
    };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('removeEpicNonGameEntries: empty array → returns {removed:0}, getAllGames not called', async () => {
    const getAllGamesCalls = [];
    const deps = makeDeps({
        gamesRepository: {
            getAllGames:      () => { getAllGamesCalls.push(1); return []; },
            deleteGamesByIds: () => {},
        },
    });
    const result = await removeEpicNonGameEntries({ badEntries: [], ...deps });
    assert.deepEqual(result, { removed: 0 });
    assert.equal(getAllGamesCalls.length, 0, 'getAllGames must not be called for empty badEntries');
    assert.equal(deps._dbSaves().length, 0, 'saveDatabase must not be called');
});

test('removeEpicNonGameEntries: null badEntries → returns {removed:0} immediately', async () => {
    const deps = makeDeps();
    const result = await removeEpicNonGameEntries({ badEntries: null, ...deps });
    assert.deepEqual(result, { removed: 0 });
});

test('removeEpicNonGameEntries: removes Epic game matching by app_name', async () => {
    const game = makeEpicGame({ id: 'epic-fab', appName: 'FabAsset123' });
    const deps = makeDeps({ games: [game] });
    const result = await removeEpicNonGameEntries({
        badEntries: [{ app_name: 'FabAsset123' }],
        ...deps,
    });
    assert.equal(result.removed, 1);
    assert.deepEqual(result.ids, ['epic-fab']);
    assert.deepEqual(deps._deletedIds(), ['epic-fab'], 'deleteGamesByIds must receive the matched id');
    assert.deepEqual(deps._deletedImages(), ['epic-fab'], 'deleteGameImages must be called for the matched id');
    assert.equal(deps._dbSaves().length, 1, 'saveDatabase must be called once');
});

test('removeEpicNonGameEntries: removes Epic game matching by app_title', async () => {
    const game = makeEpicGame({ id: 'epic-plugin', name: 'UnrealPlugin' });
    const deps = makeDeps({ games: [game] });
    const result = await removeEpicNonGameEntries({
        badEntries: [{ app_title: 'UnrealPlugin' }],
        ...deps,
    });
    assert.equal(result.removed, 1);
    assert.deepEqual(result.ids, ['epic-plugin']);
});

test('removeEpicNonGameEntries: removes Epic game matching by title (fallback field)', async () => {
    const game = makeEpicGame({ id: 'epic-t', name: 'MarketplaceTool' });
    const deps = makeDeps({ games: [game] });
    const result = await removeEpicNonGameEntries({
        badEntries: [{ title: 'MarketplaceTool' }],
        ...deps,
    });
    assert.equal(result.removed, 1);
    assert.deepEqual(result.ids, ['epic-t']);
});

test('removeEpicNonGameEntries: does not remove non-Epic game with matching name', async () => {
    const game = { id: 'steam-1', name: 'FabAsset', platform: 'Steam' };
    const deps = makeDeps({ games: [game] });
    const result = await removeEpicNonGameEntries({
        badEntries: [{ app_name: 'FabAsset' }],
        ...deps,
    });
    assert.equal(result.removed, 0);
    assert.equal(deps._deletedIds().length, 0, 'non-Epic game must not be deleted');
    assert.equal(deps._dbSaves().length, 0);
});

test('removeEpicNonGameEntries: removes multiple matching games, deleteGameImages called per id', async () => {
    const games = [
        makeEpicGame({ id: 'epic-a', appName: 'AssetA' }),
        makeEpicGame({ id: 'epic-b', appName: 'AssetB' }),
        makeEpicGame({ id: 'epic-c', appName: 'AssetC' }),
    ];
    const deps = makeDeps({ games });
    const result = await removeEpicNonGameEntries({
        badEntries: [{ app_name: 'AssetA' }, { app_name: 'AssetB' }],
        ...deps,
    });
    assert.equal(result.removed, 2);
    assert.deepEqual([...result.ids].sort(), ['epic-a', 'epic-b']);
    assert.deepEqual([...deps._deletedIds()].sort(), ['epic-a', 'epic-b']);
    assert.equal(deps._deletedImages().length, 2, 'deleteGameImages called once per removed game');
    assert.equal(deps._dbSaves().length, 1);
});

test('removeEpicNonGameEntries: policy reject → removed even without name match', async () => {
    const game = makeEpicGame({ id: 'epic-bad', name: 'SomeName' });
    const deps = makeDeps({
        games: [game],
        epicEntryPolicy: makePolicy({ 'epic-bad': false }),
    });
    const result = await removeEpicNonGameEntries({
        badEntries: [{ app_name: 'irrelevant-nomatch' }],
        ...deps,
    });
    assert.equal(result.removed, 1, 'policy reject must remove the game');
    assert.deepEqual(result.ids, ['epic-bad']);
});

test('removeEpicNonGameEntries: policy allows + no name match → not removed', async () => {
    const game = makeEpicGame({ id: 'epic-ok', name: 'Fortnite' });
    const deps = makeDeps({
        games: [game],
        epicEntryPolicy: makePolicy({ 'epic-ok': true }),
    });
    const result = await removeEpicNonGameEntries({
        badEntries: [{ app_name: 'unrelated-asset' }],
        ...deps,
    });
    assert.equal(result.removed, 0, 'allowed game with no name match must not be removed');
    assert.equal(deps._dbSaves().length, 0);
});

test('removeEpicNonGameEntries: no matches → deleteGamesByIds not called, returns {removed:0,ids:[]}', async () => {
    const game = makeEpicGame({ id: 'epic-x', name: 'SomethingElse' });
    const deleteCalledWith = [];
    const deps = makeDeps({
        gamesRepository: {
            getAllGames:      () => [game],
            deleteGamesByIds: (ids) => { deleteCalledWith.push(ids); },
        },
    });
    const result = await removeEpicNonGameEntries({
        badEntries: [{ app_name: 'nomatch' }],
        ...deps,
    });
    assert.equal(result.removed, 0);
    assert.deepEqual(result.ids, []);
    assert.equal(deleteCalledWith.length, 0, 'deleteGamesByIds must not be called when nothing matches');
    assert.equal(deps._dbSaves().length, 0);
});

test('removeEpicNonGameEntries: deleteGameImages throws → error propagates (no swallow)', async () => {
    const game = makeEpicGame({ id: 'epic-err', appName: 'BadAsset' });
    const deps = makeDeps({
        games: [game],
        imageCacheService: { deleteGameImages: () => { throw new Error('disk full'); } },
    });
    await assert.rejects(
        () => removeEpicNonGameEntries({ badEntries: [{ app_name: 'BadAsset' }], ...deps }),
        { message: 'disk full' }
    );
});

test('removeEpicNonGameEntries: source===epic (not platform) treated as Epic', async () => {
    const game = { id: 'epic-src', name: 'EpicGame', platform: 'manual', source: 'epic' };
    const deps = makeDeps({ games: [game] });
    // Game name goes into badTitles via app_title, not badAppNames via app_name
    const result = await removeEpicNonGameEntries({
        badEntries: [{ app_title: 'EpicGame' }],
        ...deps,
    });
    assert.equal(result.removed, 1, 'source===epic must be recognized as Epic');
});

test('removeEpicNonGameEntries: normalization strips special chars in app_name and title', async () => {
    const game = makeEpicGame({ id: 'epic-n', appName: 'My Game: Part 1!' });
    const deps = makeDeps({ games: [game] });
    const result = await removeEpicNonGameEntries({
        badEntries: [{ app_name: 'My Game: Part 1!' }],
        ...deps,
    });
    assert.equal(result.removed, 1, 'normalization must allow special-char entries to match');
});
