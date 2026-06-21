'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');

const { resetGameImage } = require('../src/features/games/application/useCases/ResetGameImageUseCase');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeGame(overrides = {}) {
    return { id: 'g1', name: 'TestGame', ...overrides };
}

function makeDeps(overrides = {}) {
    const cacheHits    = [];
    const resetCalls   = [];
    const game         = overrides.game !== undefined ? overrides.game : makeGame();

    return {
        gamesRepository: overrides.gamesRepository ?? {
            getGameById:   ()           => game,
            applyImageReset: (id, paths, opts) => { resetCalls.push({ id, paths, opts }); return { status: 'success', ...opts }; },
        },
        imageCacheService: overrides.imageCacheService ?? {
            findInCache: (gameId, type) => { cacheHits.push({ gameId, type }); return null; },
        },
        _cacheHits:  () => cacheHits,
        _resetCalls: () => resetCalls,
    };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('resetGameImage: game not found → returns error, no further calls', async () => {
    const cacheHits  = [];
    const resetCalls = [];
    const deps = makeDeps({
        gamesRepository: {
            getGameById:     () => null,
            applyImageReset: (...a) => { resetCalls.push(a); },
        },
        imageCacheService: { findInCache: (...a) => { cacheHits.push(a); } },
    });
    const result = await resetGameImage({ gameId: 'missing', type: 'cover', ...deps });
    assert.deepEqual(result, { status: 'error', message: 'Game not found' });
    assert.equal(cacheHits.length,  0, 'findInCache must not be called');
    assert.equal(resetCalls.length, 0, 'applyImageReset must not be called');
});

test('resetGameImage: type=cover uses game.defaultImage first, skips findInCache', async () => {
    const cacheHits = [];
    const game = makeGame({ defaultImage: 'file://default-cover.webp' });
    const deps = makeDeps({
        game,
        imageCacheService: { findInCache: (id, t) => { cacheHits.push(t); return null; } },
    });
    await resetGameImage({ gameId: 'g1', type: 'cover', ...deps });
    assert.equal(cacheHits.filter(t => t === 'cover').length, 0, 'cover findInCache must not be called when defaultImage exists');
    const call = deps._resetCalls()[0];
    assert.equal(call.paths.cover, 'file://default-cover.webp', 'defaultImage must be passed to applyImageReset');
    assert.equal(call.opts.resetAll, false);
    assert.equal(call.opts.type, 'cover');
});

test('resetGameImage: type=cover falls back to imageCacheService when no defaultImage', async () => {
    const cacheHits = [];
    const game = makeGame({ defaultImage: null });
    const deps = makeDeps({
        game,
        imageCacheService: { findInCache: (id, t) => { cacheHits.push(t); return 'file://cached-cover.webp'; } },
    });
    await resetGameImage({ gameId: 'g1', type: 'cover', ...deps });
    assert.ok(cacheHits.includes('cover'), 'findInCache must be called for cover');
    const call = deps._resetCalls()[0];
    assert.equal(call.paths.cover, 'file://cached-cover.webp');
});

test('resetGameImage: type=hero uses game.defaultHero first', async () => {
    const game = makeGame({ defaultHero: 'file://default-hero.webp' });
    const deps = makeDeps({ game });
    await resetGameImage({ gameId: 'g1', type: 'hero', ...deps });
    const call = deps._resetCalls()[0];
    assert.equal(call.paths.hero, 'file://default-hero.webp');
    assert.ok(!('cover' in call.paths), 'cover must not be in resolvedPaths for hero-only reset');
    assert.ok(!('logo'  in call.paths), 'logo must not be in resolvedPaths for hero-only reset');
    assert.equal(call.opts.resetAll, false);
    assert.equal(call.opts.type, 'hero');
});

test('resetGameImage: type=logo uses game.defaultLogo first', async () => {
    const game = makeGame({ defaultLogo: 'file://default-logo.webp' });
    const deps = makeDeps({ game });
    await resetGameImage({ gameId: 'g1', type: 'logo', ...deps });
    const call = deps._resetCalls()[0];
    assert.equal(call.paths.logo, 'file://default-logo.webp');
    assert.equal(call.opts.type, 'logo');
    assert.equal(call.opts.resetAll, false);
});

test('resetGameImage: type=all resolves all three slots with resetAll=true', async () => {
    const game = makeGame({
        defaultImage: 'file://c.webp',
        defaultHero:  null,
        defaultLogo:  'file://l.webp',
    });
    const cacheHits = [];
    const deps = makeDeps({
        game,
        imageCacheService: { findInCache: (id, t) => { cacheHits.push(t); return t === 'hero' ? 'file://cached-hero.webp' : null; } },
    });
    await resetGameImage({ gameId: 'g1', type: 'all', ...deps });
    const call = deps._resetCalls()[0];
    assert.equal(call.paths.cover, 'file://c.webp',              'cover from defaultImage');
    assert.equal(call.paths.hero,  'file://cached-hero.webp',    'hero from cache fallback');
    assert.equal(call.paths.logo,  'file://l.webp',              'logo from defaultLogo');
    assert.equal(call.opts.resetAll, true,                       'resetAll must be true');
    assert.equal(call.opts.type, 'all');
    assert.ok(cacheHits.includes('hero'), 'hero cache must be consulted when no defaultHero');
    assert.ok(!cacheHits.includes('cover'), 'cover cache must not be consulted when defaultImage exists');
});

test('resetGameImage: opts.all=true triggers resetAll even when type is not all', async () => {
    const game = makeGame({ defaultImage: 'file://c.webp', defaultHero: 'file://h.webp', defaultLogo: 'file://l.webp' });
    const deps = makeDeps({ game });
    await resetGameImage({ gameId: 'g1', type: 'cover', opts: { all: true }, ...deps });
    const call = deps._resetCalls()[0];
    assert.equal(call.opts.resetAll, true,            'opts.all=true must set resetAll=true');
    assert.equal(call.opts.type,    'cover',          'type is still passed as-is to applyImageReset');
    assert.ok('cover' in call.paths, 'cover must be resolved');
    assert.ok('hero'  in call.paths, 'hero must be resolved');
    assert.ok('logo'  in call.paths, 'logo must be resolved');
});

test('resetGameImage: no default and no cache → null propagated to applyImageReset', async () => {
    const game = makeGame({ defaultImage: null, defaultHero: null, defaultLogo: null });
    const deps = makeDeps({
        game,
        imageCacheService: { findInCache: () => null },
    });
    await resetGameImage({ gameId: 'g1', type: 'cover', ...deps });
    const call = deps._resetCalls()[0];
    assert.equal(call.paths.cover, null, 'null must be passed when no default and no cache');
});

test('resetGameImage: return value passes through from applyImageReset unchanged', async () => {
    const sentinel = { status: 'success', type: 'cover', cover: null, hero: null, logo: null, path: 'file://x.webp' };
    const game = makeGame({});
    const deps = makeDeps({
        game,
        gamesRepository: {
            getGameById:     () => game,
            applyImageReset: () => sentinel,
        },
    });
    const result = await resetGameImage({ gameId: 'g1', type: 'cover', ...deps });
    assert.strictEqual(result, sentinel, 'must return the exact object from applyImageReset');
});

test('resetGameImage: findInCache throws → error propagates (no swallow)', async () => {
    const game = makeGame({ defaultImage: null });
    const deps = makeDeps({
        game,
        imageCacheService: { findInCache: () => { throw new Error('cache I/O error'); } },
    });
    await assert.rejects(
        () => resetGameImage({ gameId: 'g1', type: 'cover', ...deps }),
        { message: 'cache I/O error' }
    );
});

test('resetGameImage: applyImageReset throws → error propagates (no swallow)', async () => {
    const game = makeGame({});
    const deps = makeDeps({
        game,
        gamesRepository: {
            getGameById:     () => game,
            applyImageReset: () => { throw new Error('db write failed'); },
        },
    });
    await assert.rejects(
        () => resetGameImage({ gameId: 'g1', type: 'cover', ...deps }),
        { message: 'db write failed' }
    );
});

test('resetGameImage: applyImageReset called with gameId and correct opts shape', async () => {
    const game = makeGame({});
    const calls = [];
    const deps = makeDeps({
        game,
        gamesRepository: {
            getGameById:     () => game,
            applyImageReset: (id, paths, opts) => { calls.push({ id, opts }); return { status: 'success' }; },
        },
    });
    await resetGameImage({ gameId: 'my-id', type: 'hero', ...deps });
    assert.equal(calls[0].id, 'my-id', 'gameId must be forwarded to applyImageReset');
    assert.deepEqual(calls[0].opts, { type: 'hero', resetAll: false });
});
