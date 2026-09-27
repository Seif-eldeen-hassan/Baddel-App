'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function fixture({ failLookup = false } = {}) {
    const source = fs.readFileSync(path.join(__dirname, '../src/js/accounts.js'), 'utf8');
    const start = source.indexOf('function _agScheduleColdCoverPriorityBoost(');
    const end = source.indexOf('function _vsScheduleCoverWork(', start);
    const calls = [];
    let timer;
    const context = vm.createContext({
        window: { electronAPI: { boostColdCoverBootstrap: async (games, options) => calls.push(['boost', games, options.priority]) } },
        setTimeout: fn => { timer = fn; return 1; }, clearTimeout: () => {},
        _agArtworkKey: game => game.id, _agGameKey: game => game.id,
        _agHasLocalCover: game => !!game.local,
        _agApplyBulkCachedCovers: async games => {
            calls.push(['lookup', games]);
            if (failLookup) throw new Error('IPC unavailable');
            games.forEach(game => { if (game.cached) game.local = true; });
            return games.filter(game => game.local).length;
        },
        _agRebindCachedCards: games => calls.push(['rebind', games]),
    });
    vm.runInContext(source.slice(start, end), context);
    return { calls, context, flush: async () => { timer(); await new Promise(setImmediate); } };
}

test('viewport restores cached posters without waiting for full-library hydration or a download event', async () => {
    const f = fixture();
    const hit = { id: 'epic_cached', cached: true };
    const miss = { id: 'steam_missing' };
    f.context._agScheduleColdCoverPriorityBoost([hit, miss]);
    await f.flush();
    assert.deepEqual(f.calls.map(call => call[0]), ['lookup', 'rebind', 'boost']);
    assert.equal(hit.local, true);
    assert.deepEqual(Array.from(f.calls[2][1]), [miss]);
    assert.equal(f.calls[2][2], 'visible');
});

test('buffer and prefetch cache hits rebind without redownloading', async () => {
    const f = fixture();
    f.context._agScheduleColdCoverPriorityBoost([], [{ id: 'buffer', cached: true }], [{ id: 'prefetch', cached: true }]);
    await f.flush();
    assert.equal(f.calls.filter(call => call[0] === 'rebind').length, 2);
    assert.equal(f.calls.filter(call => call[0] === 'boost').length, 0);
});

test('buffer cache reads wait for the visible cache response', async () => {
    const f = fixture();
    let release;
    const priorities = [];
    f.context._agApplyBulkCachedCovers = async (games, reason) => {
        priorities.push(reason);
        if (reason.includes('visible')) await new Promise(resolve => { release = resolve; });
        games.forEach(game => { game.local = true; });
        return games.length;
    };
    f.context._agScheduleColdCoverPriorityBoost([{ id: 'visible' }], [{ id: 'buffer' }], [{ id: 'prefetch' }]);
    await f.flush();
    assert.deepEqual(priorities, ['all-games-visible-cache']);
    release();
    await new Promise(setImmediate);
    assert.deepEqual(priorities, ['all-games-visible-cache', 'all-games-buffer-cache', 'all-games-prefetch-cache']);
});

test('cache lookup failure still dispatches a visible download', async () => {
    const f = fixture({ failLookup: true });
    const game = { id: 'epic_missing' };
    f.context._agScheduleColdCoverPriorityBoost([game]);
    await f.flush();
    assert.deepEqual(f.calls.map(call => call[0]), ['lookup', 'boost']);
    assert.equal(f.calls[1][2], 'visible');
});
