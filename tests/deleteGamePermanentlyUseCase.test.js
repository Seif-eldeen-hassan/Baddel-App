'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');

const { deleteGamePermanently } = require('../src/features/games/application/useCases/DeleteGamePermanentlyUseCase');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDeps({ removedCount = 1, mrmThrows = false, cacheThrows = false } = {}) {
    const calls = {
        deleteGameById:   [],
        deleteGameImages: [],
        clearJob:         [],
        deleteEntry:      [],
        saveDatabase:     [],
    };
    return {
        deps: {
            gameId: 'game-123',
            gamesRepository: {
                deleteGameById: (id) => { calls.deleteGameById.push(id); return removedCount; },
            },
            imageCacheService: {
                deleteGameImages: (id) => { calls.deleteGameImages.push(id); },
            },
            metadataResolutionManager: {
                clearJob: (id) => {
                    calls.clearJob.push(id);
                    if (mrmThrows) throw new Error('mrm error');
                },
            },
            metadataCacheStore: {
                deleteEntry: async (id) => {
                    calls.deleteEntry.push(id);
                    if (cacheThrows) throw new Error('cache error');
                },
            },
            saveDatabase: () => { calls.saveDatabase.push(true); },
        },
        calls,
    };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('deleteGamePermanently: successful delete calls all side effects in order', async () => {
    const { deps, calls } = makeDeps({ removedCount: 1 });
    const result = await deleteGamePermanently(deps);

    assert.deepEqual(result, { status: 'success' });
    assert.deepEqual(calls.deleteGameById,   ['game-123']);
    assert.deepEqual(calls.deleteGameImages, ['game-123']);
    assert.deepEqual(calls.clearJob,         ['game-123']);
    assert.deepEqual(calls.deleteEntry,      ['game-123']);
    assert.equal(calls.saveDatabase.length, 1, 'saveDatabase must be called once');
});

test('deleteGamePermanently: returns error when repository reports 0 removed', async () => {
    const { deps, calls } = makeDeps({ removedCount: 0 });
    const result = await deleteGamePermanently(deps);

    assert.deepEqual(result, { status: 'error', message: 'Game not found' });
    assert.equal(calls.deleteGameImages.length, 0, 'deleteGameImages must NOT be called');
    assert.equal(calls.clearJob.length,         0, 'clearJob must NOT be called');
    assert.equal(calls.deleteEntry.length,      0, 'deleteEntry must NOT be called');
    assert.equal(calls.saveDatabase.length,     0, 'saveDatabase must NOT be called');
});

test('deleteGamePermanently: metadataCacheStore.deleteEntry rejection is swallowed', async () => {
    const { deps, calls } = makeDeps({ removedCount: 1, cacheThrows: true });
    const result = await deleteGamePermanently(deps);

    assert.deepEqual(result, { status: 'success' }, 'must still succeed even if cache throws');
    assert.equal(calls.saveDatabase.length, 1, 'saveDatabase still called after swallowed cache error');
});

test('deleteGamePermanently: metadataResolutionManager.clearJob error is swallowed', async () => {
    const { deps, calls } = makeDeps({ removedCount: 1, mrmThrows: true });
    const result = await deleteGamePermanently(deps);

    assert.deepEqual(result, { status: 'success' }, 'must still succeed even if clearJob throws');
    assert.equal(calls.deleteEntry.length, 1, 'deleteEntry still attempted after swallowed mrm error');
    assert.equal(calls.saveDatabase.length, 1, 'saveDatabase still called after swallowed mrm error');
});

test('deleteGamePermanently: deleteGameImages is called before clearJob', async () => {
    const order = [];
    const deps = {
        gameId: 'g1',
        gamesRepository: { deleteGameById: () => 1 },
        imageCacheService: { deleteGameImages: () => { order.push('images'); } },
        metadataResolutionManager: { clearJob: () => { order.push('clearJob'); } },
        metadataCacheStore: { deleteEntry: async () => {} },
        saveDatabase: () => {},
    };
    await deleteGamePermanently(deps);
    assert.equal(order[0], 'images',   'deleteGameImages must come first');
    assert.equal(order[1], 'clearJob', 'clearJob must come after deleteGameImages');
});

test('deleteGamePermanently: removedCount > 1 (multiple matches) still returns success', async () => {
    const { deps } = makeDeps({ removedCount: 2 });
    const result = await deleteGamePermanently(deps);
    assert.deepEqual(result, { status: 'success' });
});

test('deleteGamePermanently: gameId is forwarded to all side effects', async () => {
    const { deps, calls } = makeDeps({ removedCount: 1 });
    deps.gameId = 'specific-id';
    await deleteGamePermanently(deps);
    assert.equal(calls.deleteGameById[0],   'specific-id');
    assert.equal(calls.deleteGameImages[0], 'specific-id');
    assert.equal(calls.clearJob[0],         'specific-id');
    assert.equal(calls.deleteEntry[0],      'specific-id');
});
