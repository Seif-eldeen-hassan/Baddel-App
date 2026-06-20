'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');

const { MetadataCacheStore } = require('../src/features/games/infrastructure/services/MetadataCacheStore');

// ── helpers ───────────────────────────────────────────────────────────────────

function makeTempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-mcs-'));
}

function makeStore(dir) {
    return new MetadataCacheStore(dir || makeTempDir());
}

// Minimal non-hollow meta — info.description makes isHollowMetadata return false.
function richMeta(overrides = {}) {
    return { info: { description: 'A great game', screenshots: [], allTrailers: [], genres: [] }, ...overrides };
}

// Hollow meta — no description, no arrays with content.
function hollowMeta() {
    return { info: {} };
}

// Read the raw cache JSON from disk.
function readCache(dir) {
    return JSON.parse(fs.readFileSync(path.join(dir, 'metadata-cache.json'), 'utf8'));
}

// Directly seed the cache file without going through the store.
function writeCacheRaw(dir, obj) {
    fs.writeFileSync(path.join(dir, 'metadata-cache.json'), JSON.stringify(obj), 'utf8');
}

// ── module boundary ───────────────────────────────────────────────────────────

test('MetadataCacheStore: module exports exactly { MetadataCacheStore }', () => {
    const m = require('../src/features/games/infrastructure/services/MetadataCacheStore');
    assert.deepEqual(Object.keys(m), ['MetadataCacheStore']);
    assert.equal(typeof m.MetadataCacheStore, 'function');
});

test('MetadataCacheStore: can be required without Electron', () => {
    assert.doesNotThrow(() =>
        require('../src/features/games/infrastructure/services/MetadataCacheStore')
    );
});

test('MetadataCacheStore: does not pull in gameScanner', () => {
    const resolved = require.resolve('../src/features/games/infrastructure/services/MetadataCacheStore');
    const mod = require.cache[resolved];
    const childPaths = mod.children.map(c => c.filename);
    assert.ok(
        !childPaths.some(f => f.includes('gameScanner')),
        'MetadataCacheStore must not import gameScanner'
    );
});

// ── save ──────────────────────────────────────────────────────────────────────

test('MetadataCacheStore: save() returns { status: "success" }', async () => {
    const dir   = makeTempDir();
    const store = makeStore(dir);
    const result = await store.save('game1', 'Test Game', 'pc', richMeta());
    assert.deepEqual(result, { status: 'success' });
});

test('MetadataCacheStore: save() creates metadata-cache.json on disk', async () => {
    const dir   = makeTempDir();
    const store = makeStore(dir);
    await store.save('game1', 'Test Game', 'pc', richMeta());
    assert.ok(
        fs.existsSync(path.join(dir, 'metadata-cache.json')),
        'metadata-cache.json must exist after save'
    );
});

test('MetadataCacheStore: save() persists entry with correct shape', async () => {
    const dir   = makeTempDir();
    const store = makeStore(dir);
    const meta  = richMeta();
    const before = Date.now();
    await store.save('game1', 'Test Game', 'pc', meta);
    const after = Date.now();

    const cache = readCache(dir);
    const entry = cache['game1'];
    assert.ok(entry,                                        'must write game1 key');
    assert.equal(entry.gameId,          'game1');
    assert.equal(entry.originalGameId,  'game1');
    assert.equal(entry.title,           'Test Game');
    assert.equal(entry.platform,        'pc');
    assert.equal(entry.source,          'fallback-getMetadata');
    assert.ok(entry.fetchedAt >= before && entry.fetchedAt <= after,
        'fetchedAt must fall within the test window');
    assert.deepEqual(entry.meta, meta);
});

// ── load ──────────────────────────────────────────────────────────────────────

test('MetadataCacheStore: load() returns meta after save', async () => {
    const dir   = makeTempDir();
    const store = makeStore(dir);
    const meta  = richMeta();
    await store.save('game1', 'Test Game', 'pc', meta);
    const loaded = await store.load('game1');
    assert.deepEqual(loaded, meta);
});

test('MetadataCacheStore: load() returns null for nonexistent key', async () => {
    const dir   = makeTempDir();
    const store = makeStore(dir);
    assert.equal(await store.load('nonexistent'), null);
});

test('MetadataCacheStore: load() returns null when cache file does not exist yet', async () => {
    const dir   = makeTempDir();
    const store = makeStore(dir);
    assert.equal(await store.load('game1'), null);
});

// ── getEntry ──────────────────────────────────────────────────────────────────

test('MetadataCacheStore: getEntry() returns full entry with all required fields', async () => {
    const dir   = makeTempDir();
    const store = makeStore(dir);
    const meta  = richMeta();
    const before = Date.now();
    await store.save('game1', 'Test Game', 'pc', meta);
    const after = Date.now();

    const entry = await store.getEntry('game1');
    assert.ok(entry !== null,                               'entry must not be null');
    assert.equal(entry.gameId,          'game1');
    assert.equal(entry.originalGameId,  'game1');
    assert.equal(entry.title,           'Test Game');
    assert.equal(entry.platform,        'pc');
    assert.equal(entry.source,          'fallback-getMetadata');
    assert.ok(entry.fetchedAt >= before && entry.fetchedAt <= after,
        'fetchedAt must fall within the test window');
    assert.deepEqual(entry.meta, meta);
});

test('MetadataCacheStore: getEntry() returns null for nonexistent key', async () => {
    const dir   = makeTempDir();
    const store = makeStore(dir);
    assert.equal(await store.getEntry('nonexistent'), null);
});

// ── hasEntry ──────────────────────────────────────────────────────────────────

test('MetadataCacheStore: hasEntry() returns true for a fresh entry', async () => {
    const dir   = makeTempDir();
    const store = makeStore(dir);
    await store.save('game1', 'Test Game', 'pc', richMeta());
    assert.equal(await store.hasEntry('game1'), true);
});

test('MetadataCacheStore: hasEntry() returns false when entry does not exist', async () => {
    const dir   = makeTempDir();
    const store = makeStore(dir);
    assert.equal(await store.hasEntry('nonexistent'), false);
});

test('MetadataCacheStore: hasEntry() returns false when entry is older than maxAgeMs', async () => {
    const dir = makeTempDir();
    await makeStore(dir).save('game1', 'Test', 'pc', richMeta());

    // Backdate fetchedAt to 8 days ago so the entry is stale.
    const cache = readCache(dir);
    cache['game1'].fetchedAt = Date.now() - (8 * 24 * 60 * 60 * 1000);
    writeCacheRaw(dir, cache);

    // Fresh store to force a reload from disk.
    const stale = await makeStore(dir).hasEntry('game1', 7 * 24 * 60 * 60 * 1000);
    assert.equal(stale, false);
});

test('MetadataCacheStore: hasEntry() with maxAgeMs=0 treats all entries as stale', async () => {
    const dir   = makeTempDir();
    const store = makeStore(dir);
    await store.save('game1', 'Test', 'pc', richMeta());
    // (Date.now() - fetchedAt) is always >= 0, so < 0 is always false.
    assert.equal(await store.hasEntry('game1', 0), false);
});

// ── Steam alias / canonicalization ────────────────────────────────────────────

test('MetadataCacheStore: save("steam-860510") writes canonical key steam_860510', async () => {
    const dir   = makeTempDir();
    const store = makeStore(dir);
    await store.save('steam-860510', 'Game', 'steam', richMeta());
    const cache = readCache(dir);
    assert.ok(cache['steam_860510'],  'canonical underscore key must be written');
    assert.ok(!cache['steam-860510'], 'hyphen key must NOT be written');
});

test('MetadataCacheStore: load("steam_860510") reads entry saved with steam-860510', async () => {
    const dir   = makeTempDir();
    const store = makeStore(dir);
    const meta  = richMeta();
    await store.save('steam-860510', 'Game', 'steam', meta);
    const loaded = await store.load('steam_860510');
    assert.deepEqual(loaded, meta);
});

test('MetadataCacheStore: load("steam-860510") reads entry saved with steam_860510', async () => {
    const dir   = makeTempDir();
    const store = makeStore(dir);
    const meta  = richMeta();
    await store.save('steam_860510', 'Game', 'steam', meta);
    const loaded = await store.load('steam-860510');
    assert.deepEqual(loaded, meta);
});

test('MetadataCacheStore: save() removes stale hyphen alias when both keys already exist', async () => {
    const dir  = makeTempDir();
    const meta = richMeta();
    // Pre-seed with both the legacy hyphen key and the canonical underscore key.
    writeCacheRaw(dir, {
        'steam-860510': { gameId: 'steam-860510', title: 'Old', fetchedAt: Date.now(), meta },
        'steam_860510': { gameId: 'steam_860510', title: 'Old', fetchedAt: Date.now(), meta },
    });

    const store = makeStore(dir);
    await store.save('steam-860510', 'New', 'steam', richMeta());

    const cache = readCache(dir);
    assert.ok(cache['steam_860510'],              'canonical key must survive');
    assert.ok(!cache['steam-860510'],             'hyphen alias must be deleted');
    assert.equal(Object.keys(cache).length, 1,   'exactly one key must remain');
});

test('MetadataCacheStore: load() migrates legacy hyphen key to canonical underscore key', async () => {
    const dir  = makeTempDir();
    const meta = richMeta();
    // Seed only the old hyphen key — the canonical key does not exist yet.
    writeCacheRaw(dir, {
        'steam-860510': { gameId: 'steam-860510', title: 'Legacy', fetchedAt: Date.now(), meta },
    });

    const store  = makeStore(dir);
    const loaded = await store.load('steam_860510');
    assert.deepEqual(loaded, meta,              'must return the migrated meta');

    const cache = readCache(dir);
    assert.ok(cache['steam_860510'],            'canonical key must exist after migration');
    assert.ok(!cache['steam-860510'],           'legacy hyphen key must be removed');
});

test('MetadataCacheStore: getEntry() migrates legacy hyphen key to canonical underscore key', async () => {
    const dir  = makeTempDir();
    const meta = richMeta();
    writeCacheRaw(dir, {
        'steam-860510': { gameId: 'steam-860510', title: 'Legacy', fetchedAt: Date.now(), meta },
    });

    const store = makeStore(dir);
    const entry = await store.getEntry('steam_860510');
    assert.ok(entry !== null,                   'entry must be found');
    assert.equal(entry.gameId, 'steam_860510',  'gameId in entry must be canonical');

    const cache = readCache(dir);
    assert.ok(cache['steam_860510'],            'canonical key must exist after migration');
    assert.ok(!cache['steam-860510'],           'legacy hyphen key must be removed');
});

// ── hollow metadata ───────────────────────────────────────────────────────────

test('MetadataCacheStore: load() returns null for hollow meta and deletes the entry', async () => {
    const dir = makeTempDir();
    writeCacheRaw(dir, {
        'game1': { gameId: 'game1', title: 'Test', fetchedAt: Date.now(), meta: hollowMeta() },
    });
    const store  = makeStore(dir);
    const result = await store.load('game1');
    assert.equal(result, null,          'hollow meta must return null');
    const cache = readCache(dir);
    assert.ok(!cache['game1'],          'hollow entry must be deleted from disk');
});

test('MetadataCacheStore: getEntry() returns null for hollow meta and deletes the entry', async () => {
    const dir = makeTempDir();
    writeCacheRaw(dir, {
        'game1': { gameId: 'game1', title: 'Test', fetchedAt: Date.now(), meta: hollowMeta() },
    });
    const store  = makeStore(dir);
    const result = await store.getEntry('game1');
    assert.equal(result, null,          'hollow meta must return null');
    const cache = readCache(dir);
    assert.ok(!cache['game1'],          'hollow entry must be deleted from disk');
});

test('MetadataCacheStore: load() treats null meta as hollow', async () => {
    const dir = makeTempDir();
    writeCacheRaw(dir, {
        'game1': { gameId: 'game1', title: 'Test', fetchedAt: Date.now(), meta: null },
    });
    const store  = makeStore(dir);
    const result = await store.load('game1');
    assert.equal(result, null);
});

test('MetadataCacheStore: load() preserves non-hollow meta — info.description', async () => {
    const dir  = makeTempDir();
    const meta = { info: { description: 'A great game' } };
    await makeStore(dir).save('game1', 'Test', 'pc', meta);
    assert.deepEqual(await makeStore(dir).load('game1'), meta);
});

test('MetadataCacheStore: load() preserves non-hollow meta — top-level description', async () => {
    const dir  = makeTempDir();
    const meta = { description: 'Top-level description' };
    await makeStore(dir).save('game1', 'Test', 'pc', meta);
    assert.deepEqual(await makeStore(dir).load('game1'), meta);
});

test('MetadataCacheStore: load() preserves non-hollow meta — screenshots', async () => {
    const dir  = makeTempDir();
    const meta = { info: { screenshots: ['https://example.com/screen.jpg'] } };
    await makeStore(dir).save('game1', 'Test', 'pc', meta);
    assert.deepEqual(await makeStore(dir).load('game1'), meta);
});

test('MetadataCacheStore: load() preserves non-hollow meta — genres', async () => {
    const dir  = makeTempDir();
    const meta = { info: { genres: ['Action', 'RPG'] } };
    await makeStore(dir).save('game1', 'Test', 'pc', meta);
    assert.deepEqual(await makeStore(dir).load('game1'), meta);
});

test('MetadataCacheStore: load() preserves non-hollow meta — trailers', async () => {
    const dir  = makeTempDir();
    const meta = { info: { allTrailers: ['https://youtube.com/watch?v=xyz'] } };
    await makeStore(dir).save('game1', 'Test', 'pc', meta);
    assert.deepEqual(await makeStore(dir).load('game1'), meta);
});

test('MetadataCacheStore: load() preserves non-hollow meta — quality.sources.ratings', async () => {
    const dir  = makeTempDir();
    const meta = { quality: { sources: { ratings: [{ source: 'IGN', score: 9 }] } } };
    await makeStore(dir).save('game1', 'Test', 'pc', meta);
    assert.deepEqual(await makeStore(dir).load('game1'), meta);
});

// ── deleteEntry ───────────────────────────────────────────────────────────────

test('MetadataCacheStore: deleteEntry() removes the canonical key', async () => {
    const dir   = makeTempDir();
    const store = makeStore(dir);
    await store.save('game1', 'Test', 'pc', richMeta());
    await store.deleteEntry('game1');
    const cache = readCache(dir);
    assert.ok(!cache['game1'], 'canonical key must be gone after deleteEntry');
});

test('MetadataCacheStore: deleteEntry("steam-860510") removes both Steam alias keys', async () => {
    const dir  = makeTempDir();
    const meta = richMeta();
    writeCacheRaw(dir, {
        'steam-860510': { gameId: 'steam-860510', title: 'T', fetchedAt: Date.now(), meta },
        'steam_860510': { gameId: 'steam_860510', title: 'T', fetchedAt: Date.now(), meta },
    });
    const store = makeStore(dir);
    await store.deleteEntry('steam-860510');
    const cache = readCache(dir);
    assert.ok(!cache['steam-860510'], 'hyphen key must be deleted');
    assert.ok(!cache['steam_860510'], 'canonical underscore key must also be deleted');
    assert.equal(Object.keys(cache).length, 0, 'cache must be empty');
});

test('MetadataCacheStore: deleteEntry() does not throw for a nonexistent key', async () => {
    const dir   = makeTempDir();
    const store = makeStore(dir);
    await store.save('other', 'Other', 'pc', richMeta()); // ensure cache file exists
    await assert.doesNotReject(store.deleteEntry('nonexistent'));
});

test('MetadataCacheStore: deleteEntry() does not throw when cache file does not exist', async () => {
    const dir   = makeTempDir();
    const store = makeStore(dir);
    // No save — cache file is absent; _load() will silently init to {}.
    await assert.doesNotReject(store.deleteEntry('game1'));
});
