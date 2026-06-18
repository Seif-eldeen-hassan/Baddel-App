'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');

process.env.BADDEL_TEST_USER_DATA = require('fs').mkdtempSync(
    require('path').join(require('os').tmpdir(), 'baddel-ipc-adapter-')
);

const gamesIpc = require('../src/features/games/infrastructure/ipc/games.ipc');

// ── helpers ───────────────────────────────────────────────────────────────────

function makeFakeIpc() {
    const handles = new Map();
    const ons     = new Map();
    return {
        handle(ch, fn) { handles.set(ch, fn); },
        on(ch, fn)     { ons.set(ch, fn); },
        handles,
        ons,
    };
}

// Minimal deps that satisfy every handler's destructuring without crashing.
// All values are either no-op functions or safe primitives.
function makeDeps(overrides = {}) {
    const noop = () => {};
    const noopArr = () => [];
    return {
        getSavedGames:                        noopArr,
        getHiddenGames:                       noopArr,
        scanAllGames:                         noopArr,
        removeGame:                           noop,
        renameGame:                           noop,
        unhideAllGames:                       noop,
        restoreSpecificGames:                 noop,
        deleteGamePermanently:                noop,
        reorderLibrary:                       noop,
        getDynamicGameExes:                   noopArr,
        _detectPlatform:                      noop,
        addManualGame:                        noop,
        refetchMissingImages:                 noop,
        runBackgroundMetadataPipeline:        noop,
        installedGamesState:                  { backgroundScanInProgress: false },
        updateGameMetadata:                   noop,
        saveFullMetadata:                     noop,
        loadFullMetadata:                     noop,
        updateGameImage:                      noop,
        resetGameImage:                       noop,
        imageWebpCache:                       { getCached: noop, cache: noop },
        _collectImageCacheIdsFromGame:        noop,
        _readReadyToInstallProtectedImageIds: noopArr,
        IMAGE_CACHE_PRUNE_GRACE_MS:           60000,
        ipcValidation:                        { assertPathLike: noop, assertSafeId: noop, assertString: noop, assertArrayOfStrings: noop, sanitizeErrorForRenderer: noop },
        analytics:                            { track: noop, logGameRestored: async () => {}, logGameRemoved: async () => {} },
        app:                                  { getPath: () => '' },
        dialog:                               { showOpenDialog: noop },
        shell:                                { openPath: noop },
        path:                                 require('path'),
        fs:                                   require('fs').promises,
        fileURLToPath:                        (u) => u,
        getMainWindow:                        () => null,
        ...overrides,
    };
}

// ── registration: channel presence ───────────────────────────────────────────

test('games.ipc: get-game-by-id is registered exactly once', () => {
    const ipc = makeFakeIpc();
    gamesIpc.register(ipc, makeDeps());
    assert.ok(ipc.handles.has('get-game-by-id'), 'get-game-by-id not registered');
    assert.equal(typeof ipc.handles.get('get-game-by-id'), 'function');
});

test('games.ipc: get-hidden-games is registered exactly once', () => {
    const ipc = makeFakeIpc();
    gamesIpc.register(ipc, makeDeps());
    assert.ok(ipc.handles.has('get-hidden-games'), 'get-hidden-games not registered');
    assert.equal(typeof ipc.handles.get('get-hidden-games'), 'function');
});

// ── proxy interception: target channels use use-case result ──────────────────

test('games.ipc: get-game-by-id handler returns use case result', async () => {
    const game  = { id: 'x1', name: 'Celeste' };
    const ipc   = makeFakeIpc();
    gamesIpc.register(ipc, makeDeps({ getSavedGames: () => [game] }));
    const handler = ipc.handles.get('get-game-by-id');
    const result  = await handler({}, 'x1');
    assert.deepEqual(result, game);
});

test('games.ipc: get-game-by-id handler returns null for unknown id', async () => {
    const ipc  = makeFakeIpc();
    gamesIpc.register(ipc, makeDeps({ getSavedGames: () => [] }));
    const result = await ipc.handles.get('get-game-by-id')({}, 'no-such-id');
    assert.equal(result, null);
});

test('games.ipc: get-hidden-games handler returns use case result', async () => {
    const hidden = [{ id: 'h1', name: 'Hidden Gem', isHidden: true }];
    const ipc    = makeFakeIpc();
    gamesIpc.register(ipc, makeDeps({ getHiddenGames: () => hidden }));
    const result = await ipc.handles.get('get-hidden-games')();
    assert.deepEqual(result, hidden);
});

test('games.ipc: get-hidden-games handler returns empty array when nothing hidden', async () => {
    const ipc  = makeFakeIpc();
    gamesIpc.register(ipc, makeDeps({ getHiddenGames: () => [] }));
    const result = await ipc.handles.get('get-hidden-games')();
    assert.deepEqual(result, []);
});

// ── reorder-library ───────────────────────────────────────────────────────────

test('games.ipc: reorder-library is registered exactly once', () => {
    const ipc = makeFakeIpc();
    gamesIpc.register(ipc, makeDeps());
    assert.ok(ipc.handles.has('reorder-library'), 'reorder-library not registered');
    assert.equal(typeof ipc.handles.get('reorder-library'), 'function');
});

test('games.ipc: reorder-library handler returns use case / repository result', async () => {
    const expected = { status: 'success' };
    const ipc = makeFakeIpc();
    gamesIpc.register(ipc, makeDeps({ reorderLibrary: () => expected }));
    const result = await ipc.handles.get('reorder-library')({}, ['g2', 'g1']);
    assert.equal(result, expected);
});

test('games.ipc: reorder-library passes ids through to legacy reorderLibrary', async () => {
    let received;
    const ipc = makeFakeIpc();
    gamesIpc.register(ipc, makeDeps({ reorderLibrary: (ids) => { received = ids; return { status: 'success' }; } }));
    await ipc.handles.get('reorder-library')({}, ['g3', 'g1', 'g2']);
    assert.deepEqual(received, ['g3', 'g1', 'g2']);
});

test('games.ipc: reorder-library does not execute legacy handler separately (no double write)', async () => {
    // The legacy handler captured from gameLibraryHandlers must NOT be called
    // after the use case — running it would write the DB a second time.
    let legacyCallCount = 0;
    const ipc = makeFakeIpc();
    const reorderSpy = (ids) => { legacyCallCount++; return { status: 'success' }; };
    gamesIpc.register(ipc, makeDeps({ reorderLibrary: reorderSpy }));
    await ipc.handles.get('reorder-library')({}, ['g1', 'g2']);
    assert.equal(legacyCallCount, 1, 'reorderLibrary must be called exactly once (no shadow)');
});

// ── unhide-all-games ──────────────────────────────────────────────────────────

test('games.ipc: unhide-all-games is registered exactly once', () => {
    const ipc = makeFakeIpc();
    gamesIpc.register(ipc, makeDeps());
    assert.ok(ipc.handles.has('unhide-all-games'), 'unhide-all-games not registered');
    assert.equal(typeof ipc.handles.get('unhide-all-games'), 'function');
});

test('games.ipc: unhide-all-games handler returns use case / repository result', async () => {
    const expected = { status: 'success', restoredCount: 4 };
    const ipc = makeFakeIpc();
    gamesIpc.register(ipc, makeDeps({ unhideAllGames: () => expected }));
    const result = await ipc.handles.get('unhide-all-games')();
    assert.equal(result, expected);
});

test('games.ipc: unhide-all-games calls legacy unhideAllGames exactly once (no shadow)', async () => {
    let callCount = 0;
    const ipc = makeFakeIpc();
    gamesIpc.register(ipc, makeDeps({ unhideAllGames: () => { callCount++; return { status: 'success', restoredCount: 0 }; } }));
    await ipc.handles.get('unhide-all-games')();
    assert.equal(callCount, 1, 'unhideAllGames must be called exactly once (no shadow)');
});

test('games.ipc: unhide-all-games returns no_hidden when nothing was hidden', async () => {
    const ipc = makeFakeIpc();
    gamesIpc.register(ipc, makeDeps({ unhideAllGames: () => ({ status: 'no_hidden' }) }));
    const result = await ipc.handles.get('unhide-all-games')();
    assert.deepEqual(result, { status: 'no_hidden' });
});

// ── rename-game ───────────────────────────────────────────────────────────────

test('games.ipc: rename-game is registered exactly once', () => {
    const ipc = makeFakeIpc();
    gamesIpc.register(ipc, makeDeps());
    assert.ok(ipc.handles.has('rename-game'), 'rename-game not registered');
    assert.equal(typeof ipc.handles.get('rename-game'), 'function');
});

test('games.ipc: rename-game handler returns use case / repository result', async () => {
    const expected = { status: 'success', newName: 'Renamed', customTitleLocked: true, titleSource: 'creator', titleUpdatedAt: 1 };
    const ipc = makeFakeIpc();
    gamesIpc.register(ipc, makeDeps({ renameGame: () => expected }));
    const result = await ipc.handles.get('rename-game')({}, 'g1', 'Renamed');
    assert.equal(result, expected);
});

test('games.ipc: rename-game passes gameId and newName unchanged to legacy', async () => {
    let receivedId, receivedName;
    const ipc = makeFakeIpc();
    gamesIpc.register(ipc, makeDeps({ renameGame: (id, name) => { receivedId = id; receivedName = name; return { status: 'success' }; } }));
    await ipc.handles.get('rename-game')({}, 'g42', 'Cool Game');
    assert.equal(receivedId, 'g42');
    assert.equal(receivedName, 'Cool Game');
});

test('games.ipc: rename-game calls legacy renameGame exactly once (no shadow)', async () => {
    let callCount = 0;
    const ipc = makeFakeIpc();
    gamesIpc.register(ipc, makeDeps({ renameGame: () => { callCount++; return { status: 'success' }; } }));
    await ipc.handles.get('rename-game')({}, 'g1', 'Title');
    assert.equal(callCount, 1, 'renameGame must be called exactly once (no shadow)');
});

test('games.ipc: rename-game returns sanitized error when gameId fails assertSafeId', async () => {
    const sanitized = { status: 'error', message: 'bad id' };
    const ipc = makeFakeIpc();
    const fakeValidation = {
        assertSafeId:              () => { throw new Error('bad id'); },
        assertString:              () => {},
        sanitizeErrorForRenderer:  () => sanitized,
    };
    gamesIpc.register(ipc, makeDeps({ ipcValidation: fakeValidation }));
    const result = await ipc.handles.get('rename-game')({}, '', 'Title');
    assert.equal(result, sanitized);
});

test('games.ipc: rename-game returns sanitized error when newName fails assertString', async () => {
    const sanitized = { status: 'error', message: 'name too long' };
    const ipc = makeFakeIpc();
    const fakeValidation = {
        assertSafeId:              () => {},
        assertString:              () => { throw new Error('name too long'); },
        sanitizeErrorForRenderer:  () => sanitized,
    };
    gamesIpc.register(ipc, makeDeps({ ipcValidation: fakeValidation }));
    const result = await ipc.handles.get('rename-game')({}, 'g1', 'x'.repeat(300));
    assert.equal(result, sanitized);
});

// ── restore-specific-games ────────────────────────────────────────────────────

test('games.ipc: restore-specific-games is registered exactly once', () => {
    const ipc = makeFakeIpc();
    gamesIpc.register(ipc, makeDeps());
    assert.ok(ipc.handles.has('restore-specific-games'), 'restore-specific-games not registered');
    assert.equal(typeof ipc.handles.get('restore-specific-games'), 'function');
});

test('games.ipc: restore-specific-games handler returns use case / repository result', async () => {
    const expected = { status: 'success', count: 2 };
    const ipc = makeFakeIpc();
    gamesIpc.register(ipc, makeDeps({ restoreSpecificGames: async () => expected }));
    const result = await ipc.handles.get('restore-specific-games')({}, ['g1', 'g2']);
    assert.equal(result, expected);
});

test('games.ipc: restore-specific-games passes ids through to legacy', async () => {
    let receivedIds;
    const ipc = makeFakeIpc();
    gamesIpc.register(ipc, makeDeps({ restoreSpecificGames: async (ids) => { receivedIds = ids; return { status: 'success', count: ids.length }; } }));
    await ipc.handles.get('restore-specific-games')({}, ['g3', 'g4']);
    assert.deepEqual(receivedIds, ['g3', 'g4']);
});

test('games.ipc: restore-specific-games calls legacy restoreSpecificGames exactly once (no shadow)', async () => {
    let callCount = 0;
    const ipc = makeFakeIpc();
    gamesIpc.register(ipc, makeDeps({ restoreSpecificGames: async () => { callCount++; return { status: 'success', count: 1 }; } }));
    await ipc.handles.get('restore-specific-games')({}, ['g1']);
    assert.equal(callCount, 1, 'restoreSpecificGames must be called exactly once (no shadow)');
});

test('games.ipc: restore-specific-games fires analytics on success', async () => {
    let analyticsCount = 0;
    const ipc = makeFakeIpc();
    const analytics = { logGameRestored: async (n) => { analyticsCount++; }, track: () => {} };
    gamesIpc.register(ipc, makeDeps({ restoreSpecificGames: async () => ({ status: 'success', count: 3 }), analytics }));
    await ipc.handles.get('restore-specific-games')({}, ['g1', 'g2', 'g3']);
    // give fire-and-forget a tick to run
    await new Promise(r => setImmediate(r));
    assert.equal(analyticsCount, 1, 'logGameRestored must be called once on success');
});

test('games.ipc: restore-specific-games does NOT fire analytics on error result', async () => {
    let analyticsCount = 0;
    const ipc = makeFakeIpc();
    const analytics = { logGameRestored: async () => { analyticsCount++; }, track: () => {} };
    gamesIpc.register(ipc, makeDeps({ restoreSpecificGames: async () => ({ status: 'error', message: 'Nothing restored' }), analytics }));
    await ipc.handles.get('restore-specific-games')({}, []);
    await new Promise(r => setImmediate(r));
    assert.equal(analyticsCount, 0, 'logGameRestored must NOT be called on error');
});

// ── remove-game ───────────────────────────────────────────────────────────────

test('games.ipc: remove-game is registered exactly once', () => {
    const ipc = makeFakeIpc();
    gamesIpc.register(ipc, makeDeps());
    assert.ok(ipc.handles.has('remove-game'), 'remove-game not registered');
    assert.equal(typeof ipc.handles.get('remove-game'), 'function');
});

test('games.ipc: remove-game handler returns use case / repository result', async () => {
    const expected = { status: 'success' };
    const ipc = makeFakeIpc();
    gamesIpc.register(ipc, makeDeps({ removeGame: async () => expected }));
    const result = await ipc.handles.get('remove-game')({}, 'g1');
    assert.equal(result, expected);
});

test('games.ipc: remove-game passes id unchanged to legacy removeGame', async () => {
    let receivedId;
    const ipc = makeFakeIpc();
    gamesIpc.register(ipc, makeDeps({ removeGame: async (id) => { receivedId = id; return { status: 'success' }; } }));
    await ipc.handles.get('remove-game')({}, 'g42');
    assert.equal(receivedId, 'g42');
});

test('games.ipc: remove-game calls legacy removeGame exactly once (no shadow)', async () => {
    let callCount = 0;
    const ipc = makeFakeIpc();
    gamesIpc.register(ipc, makeDeps({ removeGame: async () => { callCount++; return { status: 'success' }; } }));
    await ipc.handles.get('remove-game')({}, 'g1');
    assert.equal(callCount, 1, 'removeGame must be called exactly once (no shadow)');
});

test('games.ipc: remove-game returns sanitized error when id fails assertSafeId', async () => {
    const sanitized = { status: 'error', message: 'bad id' };
    const ipc = makeFakeIpc();
    const fakeValidation = {
        assertSafeId:             () => { throw new Error('bad id'); },
        sanitizeErrorForRenderer: () => sanitized,
    };
    gamesIpc.register(ipc, makeDeps({ ipcValidation: fakeValidation }));
    const result = await ipc.handles.get('remove-game')({}, '');
    assert.equal(result, sanitized);
});

test('games.ipc: remove-game fires analytics unconditionally after removeGame', async () => {
    let analyticsCount = 0;
    const ipc = makeFakeIpc();
    const analytics = { logGameRemoved: async () => { analyticsCount++; }, logGameRestored: async () => {}, track: () => {} };
    gamesIpc.register(ipc, makeDeps({ removeGame: async () => ({ status: 'success' }), analytics }));
    await ipc.handles.get('remove-game')({}, 'g1');
    await new Promise(r => setImmediate(r));
    assert.equal(analyticsCount, 1, 'logGameRemoved must be called once');
});

test('games.ipc: remove-game fires analytics even when removeGame returns error-like result', async () => {
    // Legacy fires analytics unconditionally — not conditioned on result.status.
    let analyticsCount = 0;
    const ipc = makeFakeIpc();
    const analytics = { logGameRemoved: async () => { analyticsCount++; }, logGameRestored: async () => {}, track: () => {} };
    gamesIpc.register(ipc, makeDeps({ removeGame: async () => ({ status: 'error' }), analytics }));
    await ipc.handles.get('remove-game')({}, 'g1');
    await new Promise(r => setImmediate(r));
    assert.equal(analyticsCount, 1, 'logGameRemoved must still be called on non-success result');
});

test('games.ipc: remove-game passes platform from _detectPlatform to logGameRemoved', async () => {
    let receivedPlatform;
    const ipc = makeFakeIpc();
    const analytics = { logGameRemoved: async (p) => { receivedPlatform = p; }, logGameRestored: async () => {}, track: () => {} };
    const game = { id: 'g1', command: 'steam://rungameid/12345' };
    gamesIpc.register(ipc, makeDeps({
        getSavedGames:   () => [game],
        _detectPlatform: (cmd) => cmd && cmd.startsWith('steam') ? 'steam' : 'unknown',
        removeGame:      async () => ({ status: 'success' }),
        analytics,
    }));
    await ipc.handles.get('remove-game')({}, 'g1');
    await new Promise(r => setImmediate(r));
    assert.equal(receivedPlatform, 'steam');
});

test('games.ipc: remove-game passes undefined platform when game not found in getSavedGames', async () => {
    let receivedPlatform = 'NOT_SET';
    const ipc = makeFakeIpc();
    const analytics = { logGameRemoved: async (p) => { receivedPlatform = p; }, logGameRestored: async () => {}, track: () => {} };
    gamesIpc.register(ipc, makeDeps({
        getSavedGames:   () => [],
        _detectPlatform: (cmd) => cmd ? 'steam' : undefined,
        removeGame:      async () => ({ status: 'success' }),
        analytics,
    }));
    await ipc.handles.get('remove-game')({}, 'no-such-id');
    await new Promise(r => setImmediate(r));
    assert.equal(receivedPlatform, undefined);
});

// ── proxy interception: non-target channels still register ───────────────────

test('games.ipc: scan-all-games is registered (non-target channel passes through)', () => {
    const ipc = makeFakeIpc();
    gamesIpc.register(ipc, makeDeps());
    assert.ok(ipc.handles.has('scan-all-games'), 'scan-all-games not registered');
});

test('games.ipc: get-installed-games is registered (untouched by proxy)', () => {
    const ipc = makeFakeIpc();
    gamesIpc.register(ipc, makeDeps());
    assert.ok(ipc.handles.has('get-installed-games'), 'get-installed-games not registered');
});

test('games.ipc: save-game-metadata is registered (local metadata handler)', () => {
    const ipc = makeFakeIpc();
    gamesIpc.register(ipc, makeDeps());
    assert.ok(ipc.handles.has('save-game-metadata'), 'save-game-metadata not registered');
});

test('games.ipc: cache-image is registered (image handler)', () => {
    const ipc = makeFakeIpc();
    gamesIpc.register(ipc, makeDeps());
    assert.ok(ipc.handles.has('cache-image'), 'cache-image not registered');
});

// ── no duplicate registration ─────────────────────────────────────────────────

test('games.ipc: no channel is registered more than once per call', () => {
    const counts = new Map();
    const ipc = {
        handle(ch) { counts.set(ch, (counts.get(ch) || 0) + 1); },
        on()       {},
    };
    gamesIpc.register(ipc, makeDeps());
    for (const [ch, n] of counts) {
        assert.equal(n, 1, `channel "${ch}" registered ${n} times`);
    }
});
