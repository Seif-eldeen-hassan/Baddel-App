'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const adapter = require('../src/features/games/application/services/GameDetailsArtworkAdapter');
const source = fs.readFileSync(path.join(__dirname, '../src/js/game-details.js'), 'utf8');

function harness(cache) {
    const elements = new Map();
    const element = id => {
        if (!elements.has(id)) elements.set(id, { style: {}, dataset: {}, removeAttribute(key) { delete this[key]; } });
        return elements.get(id);
    };
    const context = {
        console, document: { getElementById: element },
        _gdViewToken: Symbol('view'), _gdCurrentBaseGame: null, _gdCurrentGame: null, _gdCurrentMeta: null,
        _gdCurrentCustomDetails: null, _gdLoadCustomDetails: () => null, _gdRecordStage() {},
        _gdClearProceduralHero() {}, _gdApplyProceduralHero() {}, _gdClearProceduralCard() {}, _gdApplyProceduralCard() {},
        window: { BaddelGameDetailsArtworkAdapter: adapter, electronAPI: { cacheAllAssets: cache } },
    };
    vm.createContext(context);
    const start = source.indexOf('function _gdHasArtworkValue');
    const end = source.indexOf('function _gdPopulateBasic', start);
    vm.runInContext(source.slice(start, end), context);
    return { context, element, render(game, meta = null) {
        context._gdCurrentBaseGame = { ...game };
        context._gdCurrentGame = { ...game };
        context._gdCurrentMeta = meta;
        context._gdApplyResolvedArtworkToDom(context._gdCurrentGame, meta);
        return context._gdHydratePendingArtwork(context._gdCurrentGame, context._gdResolveArtworkForDisplay(game, meta));
    } };
}

test('synced remote artwork with no installed DB row is cached and painted on the open page', async () => {
    const calls = [];
    const h = harness(async (assets, id) => {
        calls.push({ assets, id });
        return { cover: 'file:///cache/cover.webp', hero: 'file:///cache/hero.webp', logo: 'file:///cache/logo.webp' };
    });
    const game = { id: 'steam_10', platform: 'steam', image: 'https://fixture/cover', heroImage: 'https://fixture/hero', logo: 'https://fixture/logo' };
    assert.equal(adapter.resolveGameDetailsArtwork({ game }).cover.value, null, 'remote candidate initially needs acquisition');
    await h.render(game);
    assert.equal(calls.length, 3, 'one acquisition per type, shared by duplicate renders');
    assert.equal(h.element('gdCover').src, 'file:///cache/cover.webp');
    assert.equal(h.element('gdLogo').src, 'file:///cache/logo.webp');
    assert.equal(h.element('gdLogo').style.display, 'block');
});

test('metadata supplied later acquires missing logo and paints without a database update', async () => {
    const h = harness(async () => ({ logo: 'file:///cache/logo.webp' }));
    await h.render({ id: 'epic_fixture', platform: 'epic' }, { logo: 'https://fixture/logo', verified: true });
    assert.equal(h.element('gdLogo').src, 'file:///cache/logo.webp');
});

test('navigation during acquisition cannot paint the next game', async () => {
    let finish;
    const h = harness(() => new Promise(resolve => { finish = resolve; }));
    const pending = h.render({ id: 'a', platform: 'steam', image: 'https://fixture/a' });
    await Promise.resolve();
    h.context._gdViewToken = Symbol('next-view');
    h.context._gdCurrentGame = { id: 'b' };
    finish({ cover: 'file:///cache/a.webp' });
    await pending;
    assert.equal(h.element('gdCover').src, undefined);
    assert.equal(h.context._gdCurrentGame.__baddelResolvedLocalCover, undefined);
});

test('cache failure settles and repeated renders do not create a retry loop', async () => {
    let calls = 0;
    const h = harness(async () => { calls++; throw new Error('offline'); });
    const game = { id: 'a', image: 'https://fixture/a' };
    await h.render(game);
    await h.render(game);
    assert.equal(calls, 1);
});

test('cached local artwork needs no download', async () => {
    let calls = 0;
    const h = harness(async () => { calls++; });
    await h.render({ id: 'a', image: 'file:///cache/cover.webp', logo: 'file:///cache/logo.webp' });
    assert.equal(calls, 0);
    assert.equal(h.element('gdLogo').style.display, 'block');
});

test('a stalled cover cannot delay an available logo, or duplicate requests on repaint', async () => {
    let finishCover;
    const cover = new Promise(resolve => { finishCover = resolve; });
    const calls = [];
    const h = harness(async assets => {
        calls.push(Object.keys(assets));
        const result = {};
        for (const type of Object.keys(assets)) result[type] = type === 'cover' ? await cover : 'file:///cache/logo.webp';
        return result;
    });
    const pending = h.render({ id: 'fixture', image: 'https://fixture/cover', logo: 'https://fixture/logo' });
    await new Promise(resolve => setImmediate(resolve));
    try {
        assert.equal(h.element('gdLogo').src, 'file:///cache/logo.webp', 'logo paints while cover is still unresolved');
        assert.equal(calls.flat().filter(type => type === 'cover').length, 1);
        assert.equal(calls.flat().filter(type => type === 'logo').length, 1);
    } finally {
        finishCover('file:///cache/cover.webp');
        await pending;
    }
});

test('remote cooldown does not prevent reading persisted artwork metadata', async () => {
    const start = source.indexOf('        if (platform && cleanedId) {');
    const end = source.indexOf('        } else {', start);
    const readStart = source.indexOf('            let cachedFallback = null;', end);
    const readEnd = source.indexOf('            const isHollowCachedFallback', readStart);
    let reads = 0;
    const saved = { cover: 'https://fixture/cover', logo: 'https://fixture/logo' };
    const context = { console: { log() {}, warn() {} }, platform: 'steam', cleanedId: 'fixture', game: { id: 'steam_fixture' },
        fullMetadataCacheId: 'steam_fixture', _gdCacheGet() {}, _gdRecordStage() {}, _gdMetadataDiagnosticSummary() {},
        _gdWithTimeout: promise => promise, tokenStillValid: () => true,
        _gdShowMetadataPendingAndRetry() {}, window: { electronAPI: {
            isCooldownActive: async () => true,
            loadFullMetadata: async () => { reads++; return saved; },
        } } };
    const result = await vm.runInNewContext('(async () => {' + source.slice(start, end) + '}' + source.slice(readStart, readEnd) + 'return cachedFallback; })()', context);
    assert.equal(reads, 1);
    assert.equal(result, saved);
});

test('remote backfill remains blocked during cooldown', async () => {
    const start = source.indexOf('                    const cooling = await');
    const end = source.indexOf('                    const canonicalAllIds', start);
    let pending = 0;
    const context = { tokenStillValid: () => true, _gdHasUsableMeta: () => false, _gdCurrentMeta: null, game: {},
        _gdShowMetadataPendingAndRetry() { pending++; }, window: { electronAPI: { isCooldownActive: async () => true } } };
    const result = await vm.runInNewContext('(async () => {' + source.slice(start, end) + 'return "backfill"; })()', context);
    assert.equal(result, undefined);
    assert.equal(pending, 1);
});

test('All Games handoff preserves canonical artwork state and resolved cache markers', () => {
    const cachedGame = { id: 'steam_10', name: 'Fixture', platform: 'steam', image: 'https://fixture/cover',
        artworkState: { version: 2 }, __baddelResolvedLocalCover: 'file:///cache/cover.webp', metadata: { description: 'Saved description' } };
    const start = source.indexOf('game = {', source.indexOf('const epicNs ='));
    assert.ok(start > 0);
    const end = source.indexOf('\n            };', start) + '\n            };'.length;
    const context = { cachedGame, _gdCurrentGameId: cachedGame.id, epicNs: null, game: null };
    vm.runInNewContext(source.slice(start, end), context);
    assert.equal(context.game.name, cachedGame.name);
    assert.equal(context.game.image, cachedGame.image);
    assert.equal(context.game.artworkState, cachedGame.artworkState);
    assert.equal(context.game.__baddelResolvedLocalCover, cachedGame.__baddelResolvedLocalCover);
    assert.equal(context.game.metadata, cachedGame.metadata);
});

test('partial metadata preserves synced descriptions for Steam and Epic without overriding creator drafts', () => {
    const context = { console, _gdMergeCustomIntoMeta: (_game, meta) => meta,
        _gdMergeUniqueTrailers: (a, b) => a || b || [], _gdMergeUniqueRatings: (a, b) => a || b || [] };
    vm.createContext(context);
    for (const name of ['_gdBuildGameInfoMeta', '_gdMergeMetaSafe']) {
        const start = source.indexOf(`function ${name}(`);
        const end = source.indexOf('\n}', start) + 2;
        vm.runInContext(source.slice(start, end), context);
    }
    const start = source.indexOf('function _gdPopulateMeta(game, metaData)');
    const end = source.indexOf('    const images = metaData', start);
    vm.runInContext(source.slice(start, end) + '\nreturn metaData; }', context);
    for (const platform of ['steam', 'epic']) {
        const game = { platform, info: { description: 'Library description', genres: ['Adventure'] } };
        const result = context._gdPopulateMeta(game, { info: { description: '', genres: [] } });
        assert.equal(result.info.description, 'Library description');
        assert.deepEqual(Array.from(result.info.genres), ['Adventure']);
        const draft = context._gdPopulateMeta(game, { _creatorCustom: true, info: { description: '' } });
        assert.equal(draft.info.description, '');
    }
});

test('a source changed during acquisition is not overwritten by its old cache result', async () => {
    let finish;
    const h = harness(() => new Promise(resolve => { finish = resolve; }));
    const pending = h.render({ id: 'a', image: 'https://fixture/old' });
    await Promise.resolve();
    h.context._gdCurrentBaseGame.image = 'https://fixture/new';
    finish({ cover: 'file:///cache/old.webp' });
    await pending;
    assert.equal(h.context._gdCurrentGame.__baddelResolvedLocalCover, undefined);
});

test('a pending or failed backfill does not erase usable library metadata', () => {
    const start = source.indexOf('if (_gdIsLikelyServerPending &&');
    const end = source.indexOf('                    } else {', start);
    const branch = source.slice(start, end) + '}';
    const usableStart = source.indexOf('function _gdHasUsableMeta(');
    const usableEnd = source.indexOf('\n}', usableStart) + 2;
    for (const pending of [true, false]) {
        const meta = { info: { description: 'Saved library description' } };
        const context = { _gdIsLikelyServerPending: pending, _gdCurrentMeta: meta, game: {}, fallbackError: new Error('offline'),
            _gdRecordStage() {}, _gdShowMetadataPendingAndRetry() { assert.fail('must preserve useful metadata'); },
            _gdRenderMetadataErrorState() { assert.fail('must preserve useful metadata'); } };
        vm.createContext(context);
        vm.runInContext(source.slice(usableStart, usableEnd), context);
        vm.runInContext(branch, context);
        assert.equal(context._gdCurrentMeta, meta);
    }
});
