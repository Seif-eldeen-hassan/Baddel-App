'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('src/js/accounts.js', 'utf8');

function functionSource(name) {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `${name} must exist`);
    const signatureEnd = source.indexOf(') {', start);
    assert.notEqual(signatureEnd, -1, `${name} signature must end`);
    const bodyStart = signatureEnd + 2;
    let depth = 0;
    for (let index = bodyStart; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}') depth -= 1;
        if (depth === 0) return source.slice(start, index + 1);
    }
    throw new Error(`Could not extract ${name}`);
}

test('provider filter prioritizes its complete small pool while mixed view remains bounded', () => {
    const calls = [];
    const context = {
        window: { _agState: { platform: 'steam' } },
        _agArtworkKey: game => `steam:${game.id}`,
        _agWarmFirstPaintCoversAfterRender: (games, options) => { calls.push({ games, options }); return Promise.resolve(0); },
    };
    vm.createContext(context);
    vm.runInContext(functionSource('_agPrioritizeFilteredPoolArtwork'), context);
    const steam = Array.from({ length: 248 }, (_, id) => ({ id }));
    assert.equal(context._agPrioritizeFilteredPoolArtwork(steam), 248);
    assert.equal(calls[0].options.limit, 248);
    assert.equal(calls[0].options.reason, 'all-games-filter-visible:steam');
    assert.equal(context.window.__agForegroundArtworkKeys.size, 248);

    context.window._agState.platform = 'all';
    const mixed = Array.from({ length: 3000 }, (_, id) => ({ id }));
    assert.equal(context._agPrioritizeFilteredPoolArtwork(mixed), 144);
    assert.equal(calls[1].options.limit, 144);
});

test('foreground restoration loads existing thumbnails before rebinding cards', async () => {
    const events = [];
    const context = {
        window: { _agRouteVersion: 7 },
        requestAnimationFrame: callback => callback(),
        _agWarmCachedCoversForGames: async games => { events.push(['bulk', games.length]); return 2; },
        _agLoadExistingGridThumbnails: async (games, options) => { events.push(['thumbnails', games.length, options]); return 2; },
        _agScheduleGridThumbnailPreparation: games => events.push(['prepare', games.length]),
        _agRebindCachedCards: games => events.push(['rebind', games.length]),
        _agEnsureVirtualGridIntegrity: reason => events.push(['integrity', reason]),
    };
    vm.createContext(context);
    vm.runInContext(functionSource('_agWarmFirstPaintCoversAfterRender'), context);
    await context._agWarmFirstPaintCoversAfterRender([{ id: 1 }, { id: 2 }, { id: 3 }], { limit: 2, reason: 'test-visible' });
    assert.deepEqual(events.map(event => event[0]), ['bulk', 'thumbnails', 'prepare', 'rebind', 'integrity']);
    assert.equal(events[1][2].defer, false);
    assert.equal(events[1][2].waitForPending, true);
    assert.equal(events[3][1], 2);
});

test('provider foreground warmup survives unrelated route revisions but rejects an older filter generation', async () => {
    const batches = [];
    const context = {
        window: { _agRouteVersion: 4, __agForegroundArtworkWarmGeneration: 9 },
        requestAnimationFrame: callback => callback(),
        _agWarmCachedCoversForGames: async games => {
            batches.push(games.length);
            context.window._agRouteVersion += 1;
            return games.length;
        },
        _agLoadExistingGridThumbnails: async () => 0,
        _agScheduleGridThumbnailPreparation: () => {},
        _agRebindCachedCards: () => {},
        _agEnsureVirtualGridIntegrity: () => {},
    };
    vm.createContext(context);
    vm.runInContext(functionSource('_agWarmFirstPaintCoversAfterRender'), context);
    const games = Array.from({ length: 96 }, (_, id) => ({ id }));
    assert.equal(await context._agWarmFirstPaintCoversAfterRender(games, { limit: 96, generation: 9 }), 96);
    assert.deepEqual(batches, [48, 48]);

    batches.length = 0;
    context._agWarmCachedCoversForGames = async chunk => {
        batches.push(chunk.length);
        context.window.__agForegroundArtworkWarmGeneration = 11;
        return chunk.length;
    };
    context.window.__agForegroundArtworkWarmGeneration = 10;
    assert.equal(await context._agWarmFirstPaintCoversAfterRender(games, { limit: 96, generation: 10 }), 0);
    assert.deepEqual(batches, [48]);
});
