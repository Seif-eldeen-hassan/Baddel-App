'use strict';
const test        = require('node:test');
const assert      = require('node:assert/strict');
const fs          = require('node:fs');
const path        = require('node:path');

const ROOT        = path.resolve(__dirname, '..');
const APP_JS      = fs.readFileSync(path.join(ROOT, 'src/js/app.js'), 'utf8');
const PLAYTIME_JS = fs.readFileSync(path.join(ROOT, 'src/js/app/playtime.js'), 'utf8');

// ─── Source extraction helper ─────────────────────────────────────────────────
// Walks brace depth to find the closing brace of a named function declaration.
function extractFnSource(src, name) {
    const start = src.indexOf(`function ${name}`);
    assert.ok(start !== -1, `function ${name} not found in source`);
    let depth = 0, i = start;
    while (i < src.length) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) break; }
        i++;
    }
    return src.slice(start, i + 1);
}

// ─── Runtime-eval: formatPlaytime ────────────────────────────────────────────
// Internal implementation is now baddelPlaytimeFormat to avoid hoisting
// collisions when concatenated with app.js in the protected bundle.
const formatPlaytime = new Function(
    `${extractFnSource(PLAYTIME_JS, 'baddelPlaytimeFormat')}; return baddelPlaytimeFormat;`
)();

// ─── Runtime-eval: formatLastPlayed ──────────────────────────────────────────
const formatLastPlayed = new Function(
    `${extractFnSource(PLAYTIME_JS, 'baddelPlaytimeFormatLastPlayed')}; return baddelPlaytimeFormatLastPlayed;`
)();

// ─── Runtime-eval: buildPlaytimeCache ────────────────────────────────────────
// playtime.js version returns the cache object — no injected state needed.
const buildPlaytimeCache = new Function(
    `${extractFnSource(PLAYTIME_JS, 'baddelPlaytimeBuildCache')}; return baddelPlaytimeBuildCache;`
)();

// ─── Source-presence: playtime.js owns the implementations ───────────────────

test('playtime.js: defines implementation function baddelPlaytimeFormat', () => {
    assert.match(PLAYTIME_JS, /function baddelPlaytimeFormat\s*\(/);
});

test('playtime.js: defines implementation function baddelPlaytimeFormatLastPlayed', () => {
    assert.match(PLAYTIME_JS, /function baddelPlaytimeFormatLastPlayed\s*\(/);
});

test('playtime.js: defines implementation function baddelPlaytimeBuildCache', () => {
    assert.match(PLAYTIME_JS, /function baddelPlaytimeBuildCache\s*\(/);
});

test('playtime.js: defines async implementation function baddelPlaytimeSave', () => {
    assert.match(PLAYTIME_JS, /async function baddelPlaytimeSave\s*\(/);
});

test('playtime.js: defines async implementation function baddelPlaytimeMigrate', () => {
    assert.match(PLAYTIME_JS, /async function baddelPlaytimeMigrate\s*\(/);
});

test('playtime.js: exposes window.BaddelPlaytime namespace', () => {
    assert.match(PLAYTIME_JS, /window\.BaddelPlaytime\s*=/);
});

test('playtime.js: BaddelPlaytime includes all five functions', () => {
    const block = PLAYTIME_JS.slice(PLAYTIME_JS.indexOf('window.BaddelPlaytime'));
    assert.match(block, /formatPlaytime/);
    assert.match(block, /formatLastPlayed/);
    assert.match(block, /buildPlaytimeCache/);
    assert.match(block, /savePlaytimeData/);
    assert.match(block, /migratePlaytimeFromLocalStorage/);
});

test('playtime.js: baddelPlaytimeBuildCache returns a cache object (does not mutate)', () => {
    // Should contain `return cache` and use a local `const cache = {}`
    const fn = extractFnSource(PLAYTIME_JS, 'baddelPlaytimeBuildCache');
    assert.match(fn, /const cache\s*=\s*\{\}/);
    assert.match(fn, /return cache/);
});

test('playtime.js: baddelPlaytimeSave accepts deps as first argument', () => {
    // Destructuring signature: ({ playtimeData, allGamesData }, gameId, ...)
    const fnStart = PLAYTIME_JS.indexOf('async function baddelPlaytimeSave');
    const header  = PLAYTIME_JS.slice(fnStart, fnStart + 80);
    assert.match(header, /\{\s*playtimeData,\s*allGamesData\s*\}/);
});

test('playtime.js: baddelPlaytimeMigrate accepts deps as first argument', () => {
    const fnStart = PLAYTIME_JS.indexOf('async function baddelPlaytimeMigrate');
    const header  = PLAYTIME_JS.slice(fnStart, fnStart + 80);
    assert.match(header, /\{\s*playtimeData\s*\}/);
});

// ─── Source-presence: app.js contains only thin wrappers ─────────────────────

test('app.js: formatPlaytime is a wrapper delegating to BaddelPlaytime', () => {
    const fn = extractFnSource(APP_JS, 'formatPlaytime');
    assert.match(fn, /window\.BaddelPlaytime\.formatPlaytime/);
});

test('app.js: formatPlaytime does NOT contain the full implementation', () => {
    const fn = extractFnSource(APP_JS, 'formatPlaytime');
    assert.doesNotMatch(fn, /if \(!minutes\) return '0h 0m'/);
});

test('app.js: formatLastPlayed is a wrapper delegating to BaddelPlaytime', () => {
    const fn = extractFnSource(APP_JS, 'formatLastPlayed');
    assert.match(fn, /window\.BaddelPlaytime\.formatLastPlayed/);
});

test('app.js: formatLastPlayed does NOT contain the full implementation', () => {
    const fn = extractFnSource(APP_JS, 'formatLastPlayed');
    assert.doesNotMatch(fn, /toLocaleDateString/);
});

test('app.js: buildPlaytimeCache wrapper assigns result to playtimeData', () => {
    const fn = extractFnSource(APP_JS, 'buildPlaytimeCache');
    assert.match(fn, /playtimeData\s*=\s*window\.BaddelPlaytime\.buildPlaytimeCache/);
});

test('app.js: savePlaytimeData wrapper passes { playtimeData, allGamesData } as deps', () => {
    const fn = extractFnSource(APP_JS, 'savePlaytimeData');
    assert.match(fn, /\{\s*playtimeData,\s*allGamesData\s*\}/);
    assert.match(fn, /window\.BaddelPlaytime\.savePlaytimeData/);
});

test('app.js: migratePlaytimeFromLocalStorage wrapper passes { playtimeData } as deps', () => {
    const fn = extractFnSource(APP_JS, 'migratePlaytimeFromLocalStorage');
    assert.match(fn, /\{\s*playtimeData\s*\}/);
    assert.match(fn, /window\.BaddelPlaytime\.migratePlaytimeFromLocalStorage/);
});

// ─── formatPlaytime behavior ──────────────────────────────────────────────────

test('formatPlaytime(0) returns "0h 0m"', () => {
    assert.equal(formatPlaytime(0), '0h 0m');
});

test('formatPlaytime(null) returns "0h 0m"', () => {
    assert.equal(formatPlaytime(null), '0h 0m');
});

test('formatPlaytime(undefined) returns "0h 0m"', () => {
    assert.equal(formatPlaytime(undefined), '0h 0m');
});

test('formatPlaytime(30) returns "30m"', () => {
    assert.equal(formatPlaytime(30), '30m');
});

test('formatPlaytime(60) returns "1h" (no minutes suffix when m === 0)', () => {
    assert.equal(formatPlaytime(60), '1h');
});

test('formatPlaytime(90) returns "1h 30m"', () => {
    assert.equal(formatPlaytime(90), '1h 30m');
});

test('formatPlaytime(121) returns "2h 1m"', () => {
    assert.equal(formatPlaytime(121), '2h 1m');
});

test('formatPlaytime(1440) returns "24h" (full day, no minutes component)', () => {
    assert.equal(formatPlaytime(1440), '24h');
});

test('formatPlaytime(59) returns "59m" (boundary: one minute before 1h)', () => {
    assert.equal(formatPlaytime(59), '59m');
});

test('formatPlaytime(61) returns "1h 1m" (boundary: one minute past 1h)', () => {
    assert.equal(formatPlaytime(61), '1h 1m');
});

// ─── formatLastPlayed behavior ────────────────────────────────────────────────

test('formatLastPlayed(null) returns "Never"', () => {
    assert.equal(formatLastPlayed(null), 'Never');
});

test('formatLastPlayed(undefined) returns "Never"', () => {
    assert.equal(formatLastPlayed(undefined), 'Never');
});

test('formatLastPlayed(0) returns "Never" (falsy timestamp)', () => {
    assert.equal(formatLastPlayed(0), 'Never');
});

test('formatLastPlayed(now) returns "Today"', () => {
    assert.equal(formatLastPlayed(Date.now()), 'Today');
});

test('formatLastPlayed(25 hours ago) returns "Yesterday"', () => {
    const yesterday = Date.now() - 25 * 60 * 60 * 1000;
    assert.equal(formatLastPlayed(yesterday), 'Yesterday');
});

test('formatLastPlayed(3.5 days ago) returns "3 days ago"', () => {
    const threeDaysAgo = Date.now() - 3.5 * 24 * 60 * 60 * 1000;
    assert.equal(formatLastPlayed(threeDaysAgo), '3 days ago');
});

test('formatLastPlayed(6.5 days ago) returns "6 days ago"', () => {
    const sixDaysAgo = Date.now() - 6.5 * 24 * 60 * 60 * 1000;
    assert.equal(formatLastPlayed(sixDaysAgo), '6 days ago');
});

test('formatLastPlayed(10 days ago) returns toLocaleDateString (>= 7 days)', () => {
    const ts = Date.now() - 10 * 24 * 60 * 60 * 1000;
    const expected = new Date(ts).toLocaleDateString();
    assert.equal(formatLastPlayed(ts), expected);
});

// ─── buildPlaytimeCache behavior ─────────────────────────────────────────────

test('buildPlaytimeCache: returns empty object for empty array', () => {
    assert.deepEqual(buildPlaytimeCache([]), {});
});

test('buildPlaytimeCache: skips games with no playtime fields', () => {
    const games = [
        { id: 'a' },
        { id: 'b', totalPlaytime: 0, lastPlayed: null, playSessions: null },
    ];
    assert.deepEqual(buildPlaytimeCache(games), {});
});

test('buildPlaytimeCache: indexes by game.id', () => {
    const result = buildPlaytimeCache([{ id: 'g1', totalPlaytime: 60 }]);
    assert.ok(Object.prototype.hasOwnProperty.call(result, 'g1'));
});

test('buildPlaytimeCache: stores totalMinutes from game.totalPlaytime', () => {
    assert.equal(buildPlaytimeCache([{ id: 'g1', totalPlaytime: 120 }])['g1'].totalMinutes, 120);
});

test('buildPlaytimeCache: stores lastPlayed from game.lastPlayed', () => {
    const ts = Date.now();
    assert.equal(buildPlaytimeCache([{ id: 'g1', totalPlaytime: 10, lastPlayed: ts }])['g1'].lastPlayed, ts);
});

test('buildPlaytimeCache: stores lastQualifiedPlayed from game.lastQualifiedPlayed', () => {
    const ts = Date.now();
    assert.equal(buildPlaytimeCache([{ id: 'g1', totalPlaytime: 5, lastQualifiedPlayed: ts }])['g1'].lastQualifiedPlayed, ts);
});

test('buildPlaytimeCache: stores playSessions from game.playSessions', () => {
    const sessions = [{ start: 1000, end: 2000 }];
    assert.deepEqual(buildPlaytimeCache([{ id: 'g1', playSessions: sessions }])['g1'].playSessions, sessions);
});

test('buildPlaytimeCache: defaults totalMinutes to 0 when game.totalPlaytime missing', () => {
    assert.equal(buildPlaytimeCache([{ id: 'g1', playSessions: [{}] }])['g1'].totalMinutes, 0);
});

test('buildPlaytimeCache: defaults lastPlayed to null when missing', () => {
    assert.equal(buildPlaytimeCache([{ id: 'g1', totalPlaytime: 10 }])['g1'].lastPlayed, null);
});

test('buildPlaytimeCache: defaults playSessions to [] when missing', () => {
    assert.deepEqual(buildPlaytimeCache([{ id: 'g1', totalPlaytime: 10 }])['g1'].playSessions, []);
});

test('buildPlaytimeCache: timeTrackingEnabled defaults true when field absent', () => {
    assert.equal(buildPlaytimeCache([{ id: 'g1', totalPlaytime: 10 }])['g1'].timeTrackingEnabled, true);
});

test('buildPlaytimeCache: timeTrackingEnabled is false when explicitly set false', () => {
    assert.equal(buildPlaytimeCache([{ id: 'g1', totalPlaytime: 10, timeTrackingEnabled: false }])['g1'].timeTrackingEnabled, false);
});

test('buildPlaytimeCache: includes game only when lastPlayed is truthy (no totalPlaytime)', () => {
    const ts = Date.now();
    const result = buildPlaytimeCache([{ id: 'g1', lastPlayed: ts }]);
    assert.ok(Object.prototype.hasOwnProperty.call(result, 'g1'));
});

test('buildPlaytimeCache: each call returns independent object (no shared state)', () => {
    const first  = buildPlaytimeCache([{ id: 'a', totalPlaytime: 10 }]);
    const second = buildPlaytimeCache([{ id: 'b', totalPlaytime: 20 }]);
    assert.ok(!Object.prototype.hasOwnProperty.call(second, 'a'));
    assert.ok(Object.prototype.hasOwnProperty.call(second, 'b'));
});

test('buildPlaytimeCache: handles multiple games', () => {
    const games = [
        { id: 'x', totalPlaytime: 30 },
        { id: 'y', totalPlaytime: 60 },
        { id: 'z' },
    ];
    const result = buildPlaytimeCache(games);
    assert.ok(Object.prototype.hasOwnProperty.call(result, 'x'));
    assert.ok(Object.prototype.hasOwnProperty.call(result, 'y'));
    assert.ok(!Object.prototype.hasOwnProperty.call(result, 'z'));
    assert.equal(result['x'].totalMinutes, 30);
    assert.equal(result['y'].totalMinutes, 60);
});

// ─── savePlaytimeData source structure ───────────────────────────────────────
// Runtime test not possible (requires window.electronAPI). Verify source structure.

test('baddelPlaytimeSave: calls window.electronAPI.updatePlaytime', () => {
    const fnStart = PLAYTIME_JS.indexOf('async function baddelPlaytimeSave');
    const fn = PLAYTIME_JS.slice(fnStart, fnStart + 600);
    assert.match(fn, /window\.electronAPI\.updatePlaytime\(gameId, playedMinutes\)/);
});

test('baddelPlaytimeSave: updates playtimeData[gameId].totalMinutes on success', () => {
    const fnStart = PLAYTIME_JS.indexOf('async function baddelPlaytimeSave');
    const fn = PLAYTIME_JS.slice(fnStart, fnStart + 600);
    assert.match(fn, /playtimeData\[gameId\]\.totalMinutes\s*=\s*result\.totalPlaytime/);
});

test('baddelPlaytimeSave: updates allGamesData entry on success', () => {
    const fnStart = PLAYTIME_JS.indexOf('async function baddelPlaytimeSave');
    const fn = PLAYTIME_JS.slice(fnStart, fnStart + 900);
    assert.match(fn, /allGamesData\[gameIndex\]\.totalPlaytime\s*=\s*result\.totalPlaytime/);
});

test('baddelPlaytimeSave: initializes missing playtimeData[gameId] before writing', () => {
    const fnStart = PLAYTIME_JS.indexOf('async function baddelPlaytimeSave');
    const fn = PLAYTIME_JS.slice(fnStart, fnStart + 600);
    assert.match(fn, /if \(!playtimeData\[gameId\]\)/);
});

// ─── baddelPlaytimeMigrate source structure ───────────────────────────────────

test('baddelPlaytimeMigrate: checks baddel_playtime_migrated flag', () => {
    const fnStart = PLAYTIME_JS.indexOf('async function baddelPlaytimeMigrate');
    const fn = PLAYTIME_JS.slice(fnStart, fnStart + 600);
    assert.match(fn, /baddel_playtime_migrated/);
    assert.match(fn, /localStorage\.getItem/);
});

test('baddelPlaytimeMigrate: reads old data from baddel_playtime key', () => {
    const fnStart = PLAYTIME_JS.indexOf('async function baddelPlaytimeMigrate');
    const fn = PLAYTIME_JS.slice(fnStart, fnStart + 600);
    assert.match(fn, /baddel_playtime['"]/);
});

test('baddelPlaytimeMigrate: sets migration flag after completion', () => {
    const fnStart = PLAYTIME_JS.indexOf('async function baddelPlaytimeMigrate');
    const fn = PLAYTIME_JS.slice(fnStart, fnStart + 600);
    assert.match(fn, /localStorage\.setItem\('baddel_playtime_migrated'/);
});

test('baddelPlaytimeMigrate: calls updatePlaytime for each entry', () => {
    const fnStart = PLAYTIME_JS.indexOf('async function baddelPlaytimeMigrate');
    const fn = PLAYTIME_JS.slice(fnStart, fnStart + 600);
    assert.match(fn, /window\.electronAPI\.updatePlaytime\(/);
});

test('baddelPlaytimeMigrate: skips migration when flag already set (early return)', () => {
    const fnStart = PLAYTIME_JS.indexOf('async function baddelPlaytimeMigrate');
    const fn = PLAYTIME_JS.slice(fnStart, fnStart + 600);
    assert.match(fn, /if \(migrationDone\) return/);
});
