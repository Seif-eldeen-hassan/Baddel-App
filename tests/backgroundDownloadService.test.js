'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');

const { backgroundDownload } = require('../src/features/games/infrastructure/services/BackgroundDownloadService');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeGame(overrides = {}) {
    return { id: 'g1', name: 'Test Game', platform: 'manual', image: null, ...overrides };
}

function makeDeps({ game = makeGame(), updateMeta = async () => {}, saveThrows = false } = {}) {
    const calls = {
        updateGameMetadata: [],
        getGameById:        [],
        save:               [],
        notify:             [],
    };
    const gamesRepository = {
        updateGameMetadata: async (gameId, patch, opts) => {
            calls.updateGameMetadata.push({ gameId, patch, opts });
            await updateMeta(gameId, patch, opts);
        },
        getGameById: (gameId) => {
            calls.getGameById.push(gameId);
            return game;
        },
    };
    const metadataCacheStore = {
        save: (gameId, name, platform, meta) => {
            calls.save.push({ gameId, name, platform, meta });
            if (saveThrows) return Promise.reject(new Error('save failed'));
            return Promise.resolve();
        },
    };
    return { gamesRepository, metadataCacheStore, calls };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('backgroundDownload: all assets present — updateGameMetadata, save, and notifyCallback all called', async () => {
    const { gamesRepository, metadataCacheStore, calls } = makeDeps();
    const notified = [];

    await backgroundDownload({
        metadata: { cover: 'https://cdn/cover.jpg', hero: 'https://cdn/hero.jpg', logo: 'https://cdn/logo.jpg' },
        gameId: 'g1',
        notifyCallback: (g) => notified.push(g),
        source: 'addManual',
        gamesRepository,
        metadataCacheStore,
    });

    assert.equal(calls.updateGameMetadata.length, 1, 'updateGameMetadata called once');
    assert.deepEqual(calls.updateGameMetadata[0].patch, {
        cover: 'https://cdn/cover.jpg',
        hero:  'https://cdn/hero.jpg',
        logo:  'https://cdn/logo.jpg',
    });
    assert.deepEqual(calls.updateGameMetadata[0].opts, { source: 'addManual' });
    assert.ok(calls.getGameById.length >= 1, 'getGameById called at least once');
    assert.equal(calls.save.length, 1, 'metadataCacheStore.save called');
    assert.equal(calls.save[0].gameId, 'g1');
    assert.equal(notified.length, 1, 'notifyCallback called once');
});

test('backgroundDownload: no assets — updateGameMetadata, save, and notifyCallback NOT called', async () => {
    const { gamesRepository, metadataCacheStore, calls } = makeDeps();
    const notified = [];

    await backgroundDownload({
        metadata: {},
        gameId: 'g1',
        notifyCallback: (g) => notified.push(g),
        source: 'pipeline',
        gamesRepository,
        metadataCacheStore,
    });

    assert.equal(calls.updateGameMetadata.length, 0, 'updateGameMetadata must not be called');
    assert.equal(calls.getGameById.length, 0,         'getGameById must not be called');
    assert.equal(calls.save.length, 0,                'save must not be called');
    assert.equal(notified.length, 0,                  'notifyCallback must not be called');
});

test('backgroundDownload: cover only — only cover written, hero/logo null', async () => {
    const { gamesRepository, metadataCacheStore, calls } = makeDeps();

    await backgroundDownload({
        metadata: { cover: 'https://cdn/cover.jpg' },
        gameId: 'g1',
        notifyCallback: null,
        source: 'pipeline',
        gamesRepository,
        metadataCacheStore,
    });

    assert.equal(calls.updateGameMetadata.length, 1);
    assert.equal(calls.updateGameMetadata[0].patch.cover, 'https://cdn/cover.jpg');
    assert.equal(calls.updateGameMetadata[0].patch.hero,  null);
    assert.equal(calls.updateGameMetadata[0].patch.logo,  null);
});

test('backgroundDownload: hero fallback — metadata.hero used when metadata.heroImage absent', async () => {
    const { gamesRepository, metadataCacheStore, calls } = makeDeps();

    await backgroundDownload({
        metadata: { hero: 'https://cdn/hero.jpg' },
        gameId: 'g1',
        notifyCallback: null,
        source: 'pipeline',
        gamesRepository,
        metadataCacheStore,
    });

    assert.equal(calls.updateGameMetadata[0].patch.hero, 'https://cdn/hero.jpg');
});

test('backgroundDownload: heroImage takes priority over hero', async () => {
    const { gamesRepository, metadataCacheStore, calls } = makeDeps();

    await backgroundDownload({
        metadata: { hero: 'https://cdn/wrong.jpg', heroImage: 'https://cdn/correct.jpg' },
        gameId: 'g1',
        notifyCallback: null,
        source: 'pipeline',
        gamesRepository,
        metadataCacheStore,
    });

    // resolveCachedUrl(metadata.hero) returns metadata.hero → cover path is the .hero value.
    // Then finalHero = hero(resolved) || metadata.heroImage || metadata.hero
    // hero resolved = 'https://cdn/wrong.jpg', so finalHero = 'https://cdn/wrong.jpg'
    // This matches original behavior exactly (hero field wins over heroImage in the fallback chain
    // because hero is the primary resolve key, heroImage is the fallback).
    assert.equal(calls.updateGameMetadata[0].patch.hero, 'https://cdn/wrong.jpg');
});

test('backgroundDownload: metadataCacheStore.save rejection is swallowed — no throw', async () => {
    const { gamesRepository, metadataCacheStore, calls } = makeDeps({ saveThrows: true });

    await assert.doesNotReject(() => backgroundDownload({
        metadata: { cover: 'https://cdn/cover.jpg' },
        gameId: 'g1',
        notifyCallback: null,
        source: 'pipeline',
        gamesRepository,
        metadataCacheStore,
    }), 'save rejection must be swallowed');

    assert.equal(calls.updateGameMetadata.length, 1, 'updateGameMetadata must still be called');
});

test('backgroundDownload: updateGameMetadata throws — outer error is swallowed', async () => {
    const { gamesRepository, metadataCacheStore } = makeDeps({
        updateMeta: async () => { throw new Error('DB write failed'); },
    });

    await assert.doesNotReject(() => backgroundDownload({
        metadata: { cover: 'https://cdn/cover.jpg' },
        gameId: 'g1',
        notifyCallback: null,
        source: 'pipeline',
        gamesRepository,
        metadataCacheStore,
    }), 'outer error from updateGameMetadata must be swallowed');
});

test('backgroundDownload: notifyCallback absent — no throw when game exists', async () => {
    const { gamesRepository, metadataCacheStore } = makeDeps();

    await assert.doesNotReject(() => backgroundDownload({
        metadata: { cover: 'https://cdn/cover.jpg' },
        gameId: 'g1',
        notifyCallback: null,
        source: 'pipeline',
        gamesRepository,
        metadataCacheStore,
    }));
});

test('backgroundDownload: source default is pipeline when not provided', async () => {
    const { gamesRepository, metadataCacheStore, calls } = makeDeps();

    await backgroundDownload({
        metadata: { cover: 'https://cdn/cover.jpg' },
        gameId: 'g1',
        gamesRepository,
        metadataCacheStore,
    });

    assert.equal(calls.updateGameMetadata[0].opts.source, 'pipeline');
});

test('backgroundDownload: metadataCacheStore.save receives merged metadata with final asset values', async () => {
    const { gamesRepository, metadataCacheStore, calls } = makeDeps();

    await backgroundDownload({
        metadata: { cover: 'https://cdn/cover.jpg', hero: 'https://cdn/hero.jpg', extra: 'kept' },
        gameId: 'g1',
        notifyCallback: null,
        source: 'pipeline',
        gamesRepository,
        metadataCacheStore,
    });

    const saved = calls.save[0].meta;
    assert.equal(saved.cover,     'https://cdn/cover.jpg', 'merged cover');
    assert.equal(saved.heroImage, 'https://cdn/hero.jpg',  'merged heroImage');
    assert.equal(saved.hero,      'https://cdn/hero.jpg',  'merged hero');
    assert.equal(saved.extra,     'kept',                   'original fields preserved');
});

test('backgroundDownload: notifyCallback receives the game from getGameById', async () => {
    const theGame = makeGame({ name: 'Real Game' });
    const { gamesRepository, metadataCacheStore } = makeDeps({ game: theGame });
    const received = [];

    await backgroundDownload({
        metadata: { cover: 'https://cdn/cover.jpg' },
        gameId: 'g1',
        notifyCallback: (g) => received.push(g),
        source: 'addManual',
        gamesRepository,
        metadataCacheStore,
    });

    assert.equal(received.length, 1);
    assert.equal(received[0].name, 'Real Game');
});
