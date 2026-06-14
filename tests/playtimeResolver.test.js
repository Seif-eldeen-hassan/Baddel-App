'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Playtime Consistency — cross-ID resolver tests
//
// PURPOSE
//   Verify _agResolvePlaytimeRecordForGame tries each identity field in the
//   correct priority order, falls through to localGameId/installedId for
//   platform-synced All Games entries, and returns {key, data, localGame}.
//
// TARGET FILE: src/js/app/game-card.js
// ─────────────────────────────────────────────────────────────────────────────

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('node:fs');
const path     = require('node:path');

const GAME_CARD_JS = fs.readFileSync(
    path.join(__dirname, '../src/js/app/game-card.js'), 'utf8'
);

function extractFn(src, signature) {
    const idx = src.indexOf(signature);
    if (idx === -1) return '';
    let depth = 0;
    let i = idx;
    while (i < src.length) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') {
            depth--;
            if (depth === 0) return src.slice(idx, i + 1);
        }
        i++;
    }
    return src.slice(idx);
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — Source-text shape tests
// ─────────────────────────────────────────────────────────────────────────────

test('_agResolvePlaytimeRecordForGame is defined in game-card.js', () => {
    assert.match(GAME_CARD_JS, /function _agResolvePlaytimeRecordForGame\s*\(/);
});

test('_agResolvePlaytimeRecordForGame is exported to window', () => {
    assert.match(GAME_CARD_JS, /window\._agResolvePlaytimeRecordForGame\s*=/);
});

test('_agResolvePlaytimeRecordForGame tries installedId and localGameId', () => {
    const body = extractFn(GAME_CARD_JS, 'function _agResolvePlaytimeRecordForGame(');
    assert.match(body, /game\.installedId/);
    assert.match(body, /game\.localGameId/);
});

test('_agResolvePlaytimeRecordForGame uses _agFindInstalledLocalMatch as fallback', () => {
    const body = extractFn(GAME_CARD_JS, 'function _agResolvePlaytimeRecordForGame(');
    assert.match(body, /_agFindInstalledLocalMatch/);
});

test('_agResolvePlaytimeRecordForGame returns {key, data, localGame} shape', () => {
    const body = extractFn(GAME_CARD_JS, 'function _agResolvePlaytimeRecordForGame(');
    assert.match(body, /key.*data.*localGame/s);
});

test('_agResolvePlaytimeRecordForGame guards window access before calling _agFindInstalledLocalMatch', () => {
    const body = extractFn(GAME_CARD_JS, 'function _agResolvePlaytimeRecordForGame(');
    assert.match(body, /typeof window\s*!==\s*['"]undefined['"]/);
});

test('_agFieldPlaytimeMinutes calls _agResolvePlaytimeRecordForGame', () => {
    const body = extractFn(GAME_CARD_JS, 'function _agFieldPlaytimeMinutes(');
    assert.match(body, /_agResolvePlaytimeRecordForGame\s*\(\s*game\s*\)/);
});

test('_agFieldLastPlayed calls _agResolvePlaytimeRecordForGame', () => {
    const body = extractFn(GAME_CARD_JS, 'function _agFieldLastPlayed(');
    assert.match(body, /_agResolvePlaytimeRecordForGame\s*\(\s*game\s*\)/);
});

test('_agResolveLastPlayedTimestamp calls _agResolvePlaytimeRecordForGame', () => {
    const body = extractFn(GAME_CARD_JS, 'function _agResolveLastPlayedTimestamp(');
    assert.match(body, /_agResolvePlaytimeRecordForGame\s*\(\s*game\s*\)/);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — Behavioral tests (new Function injection; Node.js safe)
// ─────────────────────────────────────────────────────────────────────────────

{
    const idSrc      = extractFn(GAME_CARD_JS, 'function _agFieldGameId(');
    const crossIdSrc = extractFn(GAME_CARD_JS, 'function _agResolvePlaytimeRecordForGame(');
    // eslint-disable-next-line no-new-func
    const _agFieldGameId = new Function(`return (${idSrc.trim()})`)();

    function makeResolver(game, pd) {
        const playtimeData = pd || {};
        // eslint-disable-next-line no-new-func
        const fn = new Function(
            'playtimeData', '_agFieldGameId',
            `return (${crossIdSrc.trim()})`
        )(playtimeData, _agFieldGameId);
        return fn(game);
    }

    test('resolver: priority 1 — hits game.id directly', () => {
        const game = { id: 'local-001' };
        const pd   = { 'local-001': { totalMinutes: 60, lastPlayed: 1000 } };
        const result = makeResolver(game, pd);
        assert.equal(result.key, 'local-001');
        assert.equal(result.data.totalMinutes, 60);
        assert.equal(result.localGame, null);
    });

    test('resolver: priority 2 — falls through to game.installedId when game.id misses', () => {
        const game = { id: 'sync-id-from-epic', installedId: 'local-002' };
        const pd   = { 'local-002': { totalMinutes: 120, lastPlayed: 2000 } };
        const result = makeResolver(game, pd);
        assert.equal(result.key, 'local-002');
        assert.equal(result.data.totalMinutes, 120);
    });

    test('resolver: priority 3 — falls through to game.localGameId', () => {
        const game = { id: 'sync-id', localGameId: 'local-003' };
        const pd   = { 'local-003': { totalMinutes: 30, lastPlayed: 3000 } };
        const result = makeResolver(game, pd);
        assert.equal(result.key, 'local-003');
        assert.equal(result.data.totalMinutes, 30);
    });

    test('resolver: priority 4 — falls through to game.gameId when different from game.id', () => {
        const game = { id: 'sync-id', gameId: 'local-004' };
        const pd   = { 'local-004': { totalMinutes: 45 } };
        const result = makeResolver(game, pd);
        assert.equal(result.key, 'local-004');
        assert.equal(result.data.totalMinutes, 45);
    });

    test('resolver: priority 4 — does NOT use game.gameId when it equals game.id (avoids double-hit)', () => {
        const game = { id: 'same-id', gameId: 'same-id' };
        const pd   = {};
        const result = makeResolver(game, pd);
        assert.equal(result.key, null);
        assert.equal(result.data, null);
    });

    test('resolver: returns null data when no match anywhere (no window in Node)', () => {
        const game = { id: 'unknown-sync-id', appName: 'SomeGame' };
        const result = makeResolver(game, {});
        assert.equal(result.key, null);
        assert.equal(result.data, null);
        assert.equal(result.localGame, null);
    });

    test('resolver: returns {key:null,data:null,localGame:null} for null game', () => {
        const result = makeResolver(null, {});
        assert.equal(result.key, null);
        assert.equal(result.data, null);
        assert.equal(result.localGame, null);
    });

    test('resolver: installedId takes precedence over localGameId when both present', () => {
        const game = {
            id:          'sync-id',
            installedId: 'installed-win',
            localGameId: 'local-lose',
        };
        const pd = {
            'installed-win': { totalMinutes: 99 },
            'local-lose':    { totalMinutes: 1 },
        };
        const result = makeResolver(game, pd);
        assert.equal(result.key, 'installed-win');
        assert.equal(result.data.totalMinutes, 99);
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — Integration: _agFieldPlaytimeMinutes uses resolved record
// ─────────────────────────────────────────────────────────────────────────────

{
    const idSrc      = extractFn(GAME_CARD_JS, 'function _agFieldGameId(');
    const crossIdSrc = extractFn(GAME_CARD_JS, 'function _agResolvePlaytimeRecordForGame(');
    const pmSrc      = extractFn(GAME_CARD_JS, 'function _agFieldPlaytimeMinutes(');
    // eslint-disable-next-line no-new-func
    const _agFieldGameId = new Function(`return (${idSrc.trim()})`)();

    function makePlaytimeMinutes(game, pd) {
        const playtimeData = pd || {};
        // eslint-disable-next-line no-new-func
        const _agResolvePlaytimeRecordForGame = new Function(
            'playtimeData', '_agFieldGameId',
            `return (${crossIdSrc.trim()})`
        )(playtimeData, _agFieldGameId);
        // eslint-disable-next-line no-new-func
        const fn = new Function(
            'playtimeData', '_agFieldGameId', '_agResolvePlaytimeRecordForGame',
            `return (${pmSrc.trim()})`
        )(playtimeData, _agFieldGameId, _agResolvePlaytimeRecordForGame);
        return fn(game);
    }

    test('_agFieldPlaytimeMinutes resolves via installedId for synced game', () => {
        const game = { id: 'epic-sync-id', installedId: 'local-installed' };
        const pd   = { 'local-installed': { totalMinutes: 150 } };
        assert.equal(makePlaytimeMinutes(game, pd), 150);
    });

    test('_agFieldPlaytimeMinutes returns 0 for unknown game', () => {
        const game = { id: 'unknown' };
        assert.equal(makePlaytimeMinutes(game, {}), 0);
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — accounts.js: playtime_desc sort uses cross-ID resolver
// ─────────────────────────────────────────────────────────────────────────────

const ACCOUNTS_JS = fs.readFileSync(
    path.join(__dirname, '../src/js/accounts.js'), 'utf8'
);

test('playtime_desc sort block calls window._agFieldPlaytimeMinutes', () => {
    const idx = ACCOUNTS_JS.indexOf("sort === 'playtime_desc'");
    assert.ok(idx !== -1, "'playtime_desc' sort block not found in accounts.js");
    const block = ACCOUNTS_JS.slice(idx, idx + 1200);
    assert.match(block, /window\._agFieldPlaytimeMinutes/);
});

test('playtime_desc sort block calls window._agResolveLastPlayedTimestamp', () => {
    const idx = ACCOUNTS_JS.indexOf("sort === 'playtime_desc'");
    const block = ACCOUNTS_JS.slice(idx, idx + 1200);
    assert.match(block, /window\._agResolveLastPlayedTimestamp/);
});

test('playtime_desc sort block has fallback to game.playtime and game.totalPlaytime', () => {
    const idx = ACCOUNTS_JS.indexOf("sort === 'playtime_desc'");
    const block = ACCOUNTS_JS.slice(idx, idx + 1200);
    assert.match(block, /game\?\.playtime/);
    assert.match(block, /game\?\.totalPlaytime/);
});

test('playtime_desc sort block uses localeCompare as tiebreaker', () => {
    const idx = ACCOUNTS_JS.indexOf("sort === 'playtime_desc'");
    const block = ACCOUNTS_JS.slice(idx, idx + 1200);
    assert.match(block, /localeCompare/);
});

test('window._agFieldPlaytimeMinutes exported from game-card.js', () => {
    assert.match(GAME_CARD_JS, /window\._agFieldPlaytimeMinutes\s*=/);
});

test('window._agFieldLastPlayed exported from game-card.js', () => {
    assert.match(GAME_CARD_JS, /window\._agFieldLastPlayed\s*=/);
});

// Simulation: sort by playtime using the same comparator logic as accounts.js,
// ensuring synced games with installedId reach correct playtime records.
{
    const idSrc      = extractFn(GAME_CARD_JS, 'function _agFieldGameId(');
    const crossIdSrc = extractFn(GAME_CARD_JS, 'function _agResolvePlaytimeRecordForGame(');
    const pmSrc      = extractFn(GAME_CARD_JS, 'function _agFieldPlaytimeMinutes(');
    // eslint-disable-next-line no-new-func
    const _agFieldGameId = new Function(`return (${idSrc.trim()})`)();

    function makePlaytimeOf(pd) {
        const playtimeData = pd;
        // eslint-disable-next-line no-new-func
        const _agResolvePlaytimeRecordForGame = new Function(
            'playtimeData', '_agFieldGameId',
            `return (${crossIdSrc.trim()})`
        )(playtimeData, _agFieldGameId);
        // eslint-disable-next-line no-new-func
        const _agFieldPlaytimeMinutes = new Function(
            'playtimeData', '_agFieldGameId', '_agResolvePlaytimeRecordForGame',
            `return (${pmSrc.trim()})`
        )(playtimeData, _agFieldGameId, _agResolvePlaytimeRecordForGame);
        return (game) => Number(_agFieldPlaytimeMinutes(game)) || 0;
    }

    test('simulation: synced game with installedId sorts above unplayed game', () => {
        const pd = { 'local-001': { totalMinutes: 90 } };
        const playtimeOf = makePlaytimeOf(pd);
        const synced   = { id: 'epic-sync-xyz', installedId: 'local-001' };
        const unplayed = { id: 'epic-sync-abc' };
        const pool = [unplayed, synced];
        pool.sort((a, b) => playtimeOf(b) - playtimeOf(a));
        assert.equal(pool[0].id, 'epic-sync-xyz');
    });

    test('simulation: game with more playtime sorts first', () => {
        const pd = {
            'local-a': { totalMinutes: 200 },
            'local-b': { totalMinutes: 50 },
        };
        const playtimeOf = makePlaytimeOf(pd);
        const gameA = { id: 'sync-a', localGameId: 'local-a' };
        const gameB = { id: 'sync-b', localGameId: 'local-b' };
        const pool = [gameB, gameA];
        pool.sort((a, b) => playtimeOf(b) - playtimeOf(a));
        assert.equal(pool[0].id, 'sync-a');
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5 — accounts.js: _renderAllGamesList uses cross-ID resolver
// ─────────────────────────────────────────────────────────────────────────────

test('_renderAllGamesList: playtime uses window._agFieldPlaytimeMinutes', () => {
    const idx = ACCOUNTS_JS.indexOf('function _renderAllGamesList(');
    assert.ok(idx !== -1, '_renderAllGamesList not found in accounts.js');
    const body = ACCOUNTS_JS.slice(idx, idx + 3000);
    assert.match(body, /window\._agFieldPlaytimeMinutes/);
});

test('_renderAllGamesList: last-played uses window._agResolveLastPlayedTimestamp', () => {
    const idx = ACCOUNTS_JS.indexOf('function _renderAllGamesList(');
    const body = ACCOUNTS_JS.slice(idx, idx + 3000);
    assert.match(body, /window\._agResolveLastPlayedTimestamp/);
});

test('_renderAllGamesList: playtime has fallback to game.playtime and game.totalPlaytime', () => {
    const idx = ACCOUNTS_JS.indexOf('function _renderAllGamesList(');
    const body = ACCOUNTS_JS.slice(idx, idx + 3000);
    assert.match(body, /game\.playtime/);
    assert.match(body, /game\.totalPlaytime/);
});

test('_renderAllGamesList: uses formatPlaytime when available', () => {
    const idx = ACCOUNTS_JS.indexOf('function _renderAllGamesList(');
    const body = ACCOUNTS_JS.slice(idx, idx + 3000);
    assert.match(body, /typeof formatPlaytime\s*===\s*['"]function['"]/);
});

test('_renderAllGamesList: uses formatLastPlayed when available', () => {
    const idx = ACCOUNTS_JS.indexOf('function _renderAllGamesList(');
    const body = ACCOUNTS_JS.slice(idx, idx + 3000);
    assert.match(body, /typeof formatLastPlayed\s*===\s*['"]function['"]/);
});

test('_renderAllGamesList: does NOT use raw game.lastPlayed || game.last_played directly for lpStr', () => {
    const idx = ACCOUNTS_JS.indexOf('function _renderAllGamesList(');
    const body = ACCOUNTS_JS.slice(idx, idx + 3000);
    // The raw two-field expression must no longer be used as the sole last-played source
    assert.doesNotMatch(body, /const lp = game\.lastPlayed \|\| game\.last_played/);
});
