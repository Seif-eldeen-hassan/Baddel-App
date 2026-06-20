'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');

// Real pipeline function — deps injected via the _deps parameter added in Phase 16.5.
const { runBackgroundMetadataPipeline } = require('../gameScanner');
// Real status enum so our fake MRM uses the exact values the pipeline compares against.
const { STATUS: MRM_STATUS } = require('../services/metadataResolutionManager');

// ── fake dep factories ────────────────────────────────────────────────────────

/**
 * Minimal game record.  Use platform that is NOT in _SERVER_ENRICH_PLATFORMS
 * (steam/Steam/epic/Epic Games/epic games) so the game isn't filtered out.
 */
function makeGame(overrides = {}) {
    return {
        id:        'g1',
        name:      'Test Game',
        platform:  'xbox',
        image:     null,
        heroImage: null,
        logo:      null,
        defaultLogo: null,
        isHidden:  false,
        ...overrides,
    };
}

/**
 * Fake engine.  Tracks calls; applies updateGameMetadata patches so getGameById
 * returns the post-update game (needed for the notifier path).
 */
function makeFakeEngine(games = {}) {
    const calls = { updateGameMetadata: [], saveDatabase: 0 };
    return {
        calls,
        findInCache(_gameId, _type) { return null; },
        async updateGameMetadata(gameId, patch, opts) {
            calls.updateGameMetadata.push({ gameId, patch, opts });
            if (games[gameId]) Object.assign(games[gameId], patch);
            return { status: 'success' };
        },
        saveDatabase() { calls.saveDatabase++; },
        getGameById(gameId) { return games[gameId] ?? null; },
    };
}

/**
 * Fake MRM.  Pre-seed statuses; resetToIdle mutates the stored status so the
 * second getStatus() call inside the pipeline sees the updated value.
 *
 * resolveResult: the object (or null) returned by mrm.resolve(), or a function
 * (gameId, payload) => result for per-call customisation.
 */
function makeFakeMrm({ statuses = {}, resolveResult = null } = {}) {
    const calls = { getStatus: [], resetToIdle: [], getJob: [], resolve: [] };
    const _s = { ...statuses };
    return {
        calls,
        getStatus(gameId) {
            calls.getStatus.push(gameId);
            return _s[gameId] ?? MRM_STATUS.IDLE;
        },
        resetToIdle(gameId) {
            calls.resetToIdle.push(gameId);
            _s[gameId] = MRM_STATUS.IDLE;
        },
        getJob(gameId) {
            calls.getJob.push(gameId);
            return { cooldownUntil: Date.now() + 60_000 };
        },
        async resolve(gameId, payload) {
            calls.resolve.push({ gameId, payload });
            return typeof resolveResult === 'function'
                ? resolveResult(gameId, payload)
                : resolveResult;
        },
    };
}

/**
 * Fake metadata cache.  Pre-seed entries so hasEntry/load return predictable
 * values; deleteEntry removes from the in-memory map so subsequent hasEntry
 * returns false.
 */
function makeFakeCache(entries = {}) {
    const calls = { hasEntry: [], load: [], save: [], deleteEntry: [] };
    const _e = { ...entries };
    return {
        calls,
        async hasEntry(gameId) {
            calls.hasEntry.push(gameId);
            return gameId in _e;
        },
        async load(gameId) {
            calls.load.push(gameId);
            return _e[gameId] ?? null;
        },
        async save(gameId, title, platform, meta) {
            calls.save.push({ gameId, title, platform, meta });
            _e[gameId] = meta;
        },
        async deleteEntry(gameId) {
            calls.deleteEntry.push(gameId);
            delete _e[gameId];
        },
    };
}

/**
 * Fake image downloader.  Returns file:// paths for any URL that is present.
 * Pass `overrides` to control the returned path per type (cover / hero / logo).
 */
function makeFakeImageDownload(overrides = {}) {
    const calls = [];
    const fn = async (assets, gameId) => {
        calls.push({ assets, gameId });
        const result = {};
        for (const [type, url] of Object.entries(assets)) {
            if (url) result[type] = overrides[type] ?? `file://cache/${type}_${gameId}.webp`;
        }
        return result;
    };
    fn.calls = calls;
    return fn;
}

/** Fake renderer notifier — records every game it is called with. */
function makeFakeNotifier() {
    const notified = [];
    const fn = (game) => notified.push(game);
    fn.notified = notified;
    return fn;
}

// ── filter / early-exit ───────────────────────────────────────────────────────

test('pipeline: empty games array → returns without any side effects', async () => {
    const engine = makeFakeEngine();
    const mrm    = makeFakeMrm();
    const cache  = makeFakeCache();

    await runBackgroundMetadataPipeline([], { engine, mrm, metadataCacheStore: cache });

    assert.equal(mrm.calls.getStatus.length,              0, 'no MRM calls expected');
    assert.equal(engine.calls.updateGameMetadata.length,  0);
    assert.equal(cache.calls.save.length,                 0);
});

test('pipeline: steam/epic games are filtered out and produce no side effects', async () => {
    const engine = makeFakeEngine();
    const mrm    = makeFakeMrm();
    const cache  = makeFakeCache();

    await runBackgroundMetadataPipeline(
        [makeGame({ platform: 'steam' }), makeGame({ id: 'g2', platform: 'Epic Games' })],
        { engine, mrm, metadataCacheStore: cache },
    );

    assert.equal(mrm.calls.getStatus.length,             0, 'no MRM calls for server-enrich platforms');
    assert.equal(engine.calls.updateGameMetadata.length, 0);
});

test('pipeline: hidden game is filtered out and produces no side effects', async () => {
    const engine = makeFakeEngine();
    const mrm    = makeFakeMrm();
    const cache  = makeFakeCache();

    await runBackgroundMetadataPipeline(
        [makeGame({ isHidden: true })],
        { engine, mrm, metadataCacheStore: cache },
    );

    assert.equal(mrm.calls.getStatus.length, 0, 'hidden game must not reach MRM');
});

// ── skip gate ─────────────────────────────────────────────────────────────────

test('pipeline: fully complete game (cover+hero+logo+metadata) skips — no resolve, no DB write', async () => {
    const game = makeGame({ image: 'file://c.webp', heroImage: 'file://h.webp', logo: 'file://l.webp' });
    const engine = makeFakeEngine({ [game.id]: game });
    // RESOLVED + hasAnyArt → no recovery; then skip gate fires.
    const mrm  = makeFakeMrm({ statuses: { [game.id]: MRM_STATUS.RESOLVED } });
    const cache = makeFakeCache({ [game.id]: { info: { description: 'x' } } });

    await runBackgroundMetadataPipeline([game], { engine, mrm, metadataCacheStore: cache });

    assert.equal(mrm.calls.resolve.length,                0, 'must not call resolve for complete game');
    assert.equal(engine.calls.updateGameMetadata.length,  0, 'must not write DB for complete game');
    assert.equal(engine.calls.saveDatabase,               0);
});

// ── MRM recovery ──────────────────────────────────────────────────────────────

test('pipeline: RESOLVED-but-no-art triggers mrm.resetToIdle and cache.deleteEntry', async () => {
    const game  = makeGame(); // no art anywhere
    const engine = makeFakeEngine({ [game.id]: game });
    // RESOLVED but game has no art → recovery must fire.
    // After reset, resolve is called; returning null keeps the test focused on recovery.
    const mrm  = makeFakeMrm({ statuses: { [game.id]: MRM_STATUS.RESOLVED }, resolveResult: null });
    const cache = makeFakeCache();

    await runBackgroundMetadataPipeline([game], { engine, mrm, metadataCacheStore: cache });

    assert.ok(mrm.calls.resetToIdle.includes(game.id),   'resetToIdle must be called on recovery');
    assert.ok(cache.calls.deleteEntry.includes(game.id),  'stale cache entry must be deleted on recovery');
});

// ── hero backfill ─────────────────────────────────────────────────────────────

test('pipeline: hero backfill — cached meta has hero URL → downloaded and written to DB', async () => {
    // Game has a cover but no hero anywhere.
    const game = makeGame({ image: 'file://c.webp' });
    // getGameById must return the post-update game so the notifier receives it.
    const updatedGame = { ...game, heroImage: 'file://cache/hero_g1.webp' };
    const engine = makeFakeEngine({ [game.id]: updatedGame });
    const mrm    = makeFakeMrm();
    const cache  = makeFakeCache({
        [game.id]: { heroImage: 'https://cdn/hero.jpg', info: { description: 'x' } },
    });
    const imgDl  = makeFakeImageDownload({ hero: 'file://cache/hero_g1.webp' });
    const notify = makeFakeNotifier();

    await runBackgroundMetadataPipeline([game], {
        engine,
        mrm,
        metadataCacheStore: cache,
        imageDownloadFn:    imgDl,
        gameImageUpdatedFn: notify,
    });

    assert.equal(engine.calls.updateGameMetadata.length, 1,  'updateGameMetadata must be called once');
    assert.deepEqual(engine.calls.updateGameMetadata[0].patch, { hero: 'file://cache/hero_g1.webp' });
    assert.ok(engine.calls.saveDatabase > 0,                  'saveDatabase must be called');
    assert.equal(notify.notified.length, 1,                   'notifier must fire after hero write');
    assert.equal(mrm.calls.resolve.length, 0,                 'must not trigger full resolve for hero backfill');
});

test('pipeline: hero backfill — cached meta has no hero URL → deleteEntry + resetToIdle + fall-through', async () => {
    const game   = makeGame({ image: 'file://c.webp' }); // cover but no hero
    const engine = makeFakeEngine({ [game.id]: game });
    const mrm    = makeFakeMrm({ resolveResult: null });
    // Cache entry exists but holds only a cover URL — no hero.
    const cache  = makeFakeCache({
        [game.id]: { cover: 'https://cdn/c.jpg', info: { description: 'x' } },
    });

    await runBackgroundMetadataPipeline([game], { engine, mrm, metadataCacheStore: cache });

    assert.ok(cache.calls.deleteEntry.includes(game.id), 'incomplete cache entry must be deleted');
    assert.ok(mrm.calls.resetToIdle.includes(game.id),   'MRM must be reset to IDLE so next pass re-resolves');
});

// ── logo backfill ─────────────────────────────────────────────────────────────

test('pipeline: logo backfill — cached meta has logo URL → downloaded and written to DB', async () => {
    // Game has cover + hero, but no logo.
    const game = makeGame({ image: 'file://c.webp', heroImage: 'file://h.webp' });
    const updatedGame = { ...game, logo: 'file://cache/logo_g1.webp' };
    const engine = makeFakeEngine({ [game.id]: updatedGame });
    const mrm    = makeFakeMrm();
    const cache  = makeFakeCache({
        [game.id]: { logo: 'https://cdn/logo.png', info: { description: 'x' } },
    });
    const imgDl  = makeFakeImageDownload({ logo: 'file://cache/logo_g1.webp' });
    const notify = makeFakeNotifier();

    await runBackgroundMetadataPipeline([game], {
        engine,
        mrm,
        metadataCacheStore: cache,
        imageDownloadFn:    imgDl,
        gameImageUpdatedFn: notify,
    });

    assert.equal(engine.calls.updateGameMetadata.length,  1, 'updateGameMetadata must be called once');
    assert.deepEqual(engine.calls.updateGameMetadata[0].patch, { logo: 'file://cache/logo_g1.webp' });
    assert.ok(engine.calls.saveDatabase > 0,                   'saveDatabase must be called');
    assert.equal(mrm.calls.resolve.length, 0,                  'must not trigger full resolve for logo backfill');
});

// ── MRM cooldown ──────────────────────────────────────────────────────────────

test('pipeline: MRM COOLDOWN → skips without calling resolve', async () => {
    const game   = makeGame(); // no art so skip gate never fires
    const engine = makeFakeEngine({ [game.id]: game });
    const mrm    = makeFakeMrm({ statuses: { [game.id]: MRM_STATUS.COOLDOWN } });
    const cache  = makeFakeCache();

    await runBackgroundMetadataPipeline([game], { engine, mrm, metadataCacheStore: cache });

    assert.equal(mrm.calls.resolve.length,                0, 'resolve must not be called during cooldown');
    assert.equal(engine.calls.updateGameMetadata.length,  0);
    assert.equal(cache.calls.save.length,                 0);
});

// ── full resolve ──────────────────────────────────────────────────────────────

test('pipeline: full resolve — meta with images → cache.save, imageDownload, updateGameMetadata, notifier', async () => {
    const game = makeGame(); // no art, no cache entry
    const resolvedGame = {
        ...game,
        image:     'file://cache/cover_g1.webp',
        heroImage: 'file://cache/hero_g1.webp',
        logo:      'file://cache/logo_g1.webp',
    };
    const engine = makeFakeEngine({ [game.id]: resolvedGame });
    const mrm    = makeFakeMrm({
        resolveResult: {
            meta: {
                cover: 'https://cdn/c.jpg',
                hero:  'https://cdn/h.jpg',
                logo:  'https://cdn/l.png',
                info:  { description: 'A great game' },
            },
            _resolveSource: 'mrm-api',
        },
    });
    const cache  = makeFakeCache();
    const imgDl  = makeFakeImageDownload({
        cover: 'file://cache/cover_g1.webp',
        hero:  'file://cache/hero_g1.webp',
        logo:  'file://cache/logo_g1.webp',
    });
    const notify = makeFakeNotifier();

    await runBackgroundMetadataPipeline([game], {
        engine,
        mrm,
        metadataCacheStore: cache,
        imageDownloadFn:    imgDl,
        gameImageUpdatedFn: notify,
    });

    // Metadata persisted
    assert.equal(cache.calls.save.length,         1, 'metadata must be saved to cache');
    assert.equal(cache.calls.save[0].gameId,      game.id);

    // Assets downloaded
    assert.equal(imgDl.calls.length,  1,    'imageDownloadFn must be called');
    assert.ok(imgDl.calls[0].assets.cover,  'cover URL must be passed to downloader');
    assert.ok(imgDl.calls[0].assets.hero,   'hero URL must be passed to downloader');
    assert.ok(imgDl.calls[0].assets.logo,   'logo URL must be passed to downloader');

    // DB written with local file:// paths
    assert.equal(engine.calls.updateGameMetadata.length, 1);
    const patch = engine.calls.updateGameMetadata[0].patch;
    assert.equal(patch.cover, 'file://cache/cover_g1.webp');
    assert.equal(patch.hero,  'file://cache/hero_g1.webp');
    assert.equal(patch.logo,  'file://cache/logo_g1.webp');
    assert.ok(engine.calls.saveDatabase > 0, 'saveDatabase must be called after DB write');

    // Renderer notified
    assert.equal(notify.notified.length, 1, 'notifier must fire after successful DB write');
});

test('pipeline: full resolve — meta has no images → cache.save called, no DB write, mrm.resetToIdle', async () => {
    const game   = makeGame();
    const engine = makeFakeEngine({ [game.id]: game });
    const mrm    = makeFakeMrm({
        resolveResult: {
            meta: { info: { description: 'Text-only metadata, no artwork' } },
            _resolveSource: 'mrm-api',
        },
    });
    const cache  = makeFakeCache();
    // imageDownloadFn present but returns {} for null URLs — no art stored.
    const imgDl  = makeFakeImageDownload();

    await runBackgroundMetadataPipeline([game], {
        engine,
        mrm,
        metadataCacheStore: cache,
        imageDownloadFn:    imgDl,
    });

    assert.equal(cache.calls.save.length,                1, 'text metadata must still be persisted');
    assert.equal(engine.calls.updateGameMetadata.length, 0, 'no images → DB write must be skipped');
    assert.ok(mrm.calls.resetToIdle.includes(game.id),      'MRM must reset to IDLE for image retry on next pass');
});
