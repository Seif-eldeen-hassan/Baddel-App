'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT   = path.resolve(__dirname, '..');
const APP_JS = fs.readFileSync(path.join(ROOT, 'src/js/app.js'), 'utf8');

// ─── Source extraction helper ─────────────────────────────────────────────────
// Walks brace depth to find the closing brace of a named function declaration.
// Template-literal `${...}` pairs count as balanced braces so they don't skew
// the depth counter.
function extractFnSource(src, name) {
    const start = src.indexOf(`function ${name}`);
    assert.ok(start !== -1, `function ${name} not found in app.js`);
    let depth = 0, i = start;
    while (i < src.length) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) break; }
        i++;
    }
    return src.slice(start, i + 1);
}

// ─── Runtime-eval: formatPlaytime ────────────────────────────────────────────
// Pure function, no external dependencies — safe to eval in Node.
const formatPlaytime = new Function(
    `${extractFnSource(APP_JS, 'formatPlaytime')}; return formatPlaytime;`
)();

// ─── Runtime-eval: formatLastPlayed ──────────────────────────────────────────
// Uses new Date() but no DOM/localStorage — safe to eval in Node.
const formatLastPlayed = new Function(
    `${extractFnSource(APP_JS, 'formatLastPlayed')}; return formatLastPlayed;`
)();

// ─── Runtime-eval: buildPlaytimeCache ────────────────────────────────────────
// The function assigns to a module-level `playtimeData` variable. We inject a
// local `playtimeData` into the eval scope and return it after each call.
const _buildPlaytimeCacheWrapped = new Function(
    `let playtimeData = {};
     ${extractFnSource(APP_JS, 'buildPlaytimeCache')}
     return function run(games) {
         buildPlaytimeCache(games);
         return playtimeData;
     };`
)();

// ─── Source-presence tests ────────────────────────────────────────────────────

test('appPlaytime: app.js defines function formatPlaytime', () => {
    assert.match(APP_JS, /function formatPlaytime\s*\(/);
});

test('appPlaytime: app.js defines function formatLastPlayed', () => {
    assert.match(APP_JS, /function formatLastPlayed\s*\(/);
});

test('appPlaytime: app.js defines function buildPlaytimeCache', () => {
    assert.match(APP_JS, /function buildPlaytimeCache\s*\(/);
});

test('appPlaytime: app.js defines async function savePlaytimeData', () => {
    assert.match(APP_JS, /async function savePlaytimeData\s*\(/);
});

test('appPlaytime: app.js defines async function migratePlaytimeFromLocalStorage', () => {
    assert.match(APP_JS, /async function migratePlaytimeFromLocalStorage\s*\(/);
});

// ─── formatPlaytime behavior ──────────────────────────────────────────────────

test('formatPlaytime(0) returns "0h 0m"', () => {
    // !0 is truthy → early-return fallback
    assert.equal(formatPlaytime(0), '0h 0m');
});

test('formatPlaytime(null) returns "0h 0m"', () => {
    assert.equal(formatPlaytime(null), '0h 0m');
});

test('formatPlaytime(undefined) returns "0h 0m"', () => {
    assert.equal(formatPlaytime(undefined), '0h 0m');
});

test('formatPlaytime(30) returns "30m"', () => {
    // 30 < 60
    assert.equal(formatPlaytime(30), '30m');
});

test('formatPlaytime(60) returns "1h" (no minutes suffix when m === 0)', () => {
    // h=1, m=0 → no m component
    assert.equal(formatPlaytime(60), '1h');
});

test('formatPlaytime(90) returns "1h 30m"', () => {
    assert.equal(formatPlaytime(90), '1h 30m');
});

test('formatPlaytime(121) returns "2h 1m"', () => {
    assert.equal(formatPlaytime(121), '2h 1m');
});

test('formatPlaytime(1440) returns "24h" (full day, no minutes component)', () => {
    // h=24, m=0
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
    // !0 is truthy → returns 'Never'
    assert.equal(formatLastPlayed(0), 'Never');
});

test('formatLastPlayed(now) returns "Today"', () => {
    // diffDays = Math.floor(0 / day_ms) = 0
    assert.equal(formatLastPlayed(Date.now()), 'Today');
});

test('formatLastPlayed(25 hours ago) returns "Yesterday"', () => {
    // diffDays = Math.floor(25/24) = 1
    const yesterday = Date.now() - 25 * 60 * 60 * 1000;
    assert.equal(formatLastPlayed(yesterday), 'Yesterday');
});

test('formatLastPlayed(3.5 days ago) returns "3 days ago"', () => {
    // diffDays = Math.floor(3.5 * 24 / 24) = 3  (< 7, not 0, not 1)
    const threeDaysAgo = Date.now() - 3.5 * 24 * 60 * 60 * 1000;
    assert.equal(formatLastPlayed(threeDaysAgo), '3 days ago');
});

test('formatLastPlayed(6.5 days ago) returns "6 days ago"', () => {
    // diffDays = 6, still < 7
    const sixDaysAgo = Date.now() - 6.5 * 24 * 60 * 60 * 1000;
    assert.equal(formatLastPlayed(sixDaysAgo), '6 days ago');
});

test('formatLastPlayed(10 days ago) returns toLocaleDateString (>= 7 days)', () => {
    // diffDays = 10 → falls through to date.toLocaleDateString()
    const ts = Date.now() - 10 * 24 * 60 * 60 * 1000;
    const expected = new Date(ts).toLocaleDateString();
    assert.equal(formatLastPlayed(ts), expected);
});

// ─── buildPlaytimeCache behavior ─────────────────────────────────────────────

test('buildPlaytimeCache: returns empty object for empty array', () => {
    const result = _buildPlaytimeCacheWrapped([]);
    assert.deepEqual(result, {});
});

test('buildPlaytimeCache: skips games with no playtime fields', () => {
    // condition: g.totalPlaytime || g.lastPlayed || g.playSessions
    const games = [
        { id: 'a' },
        { id: 'b', totalPlaytime: 0, lastPlayed: null, playSessions: null },
    ];
    const result = _buildPlaytimeCacheWrapped(games);
    assert.deepEqual(result, {});
});

test('buildPlaytimeCache: indexes by game.id', () => {
    const games = [{ id: 'g1', totalPlaytime: 60 }];
    const result = _buildPlaytimeCacheWrapped(games);
    assert.ok(Object.prototype.hasOwnProperty.call(result, 'g1'),
        'result must have key equal to game.id');
});

test('buildPlaytimeCache: stores totalMinutes from game.totalPlaytime', () => {
    const games = [{ id: 'g1', totalPlaytime: 120 }];
    const result = _buildPlaytimeCacheWrapped(games);
    assert.equal(result['g1'].totalMinutes, 120);
});

test('buildPlaytimeCache: stores lastPlayed from game.lastPlayed', () => {
    const ts = Date.now();
    const games = [{ id: 'g1', totalPlaytime: 10, lastPlayed: ts }];
    const result = _buildPlaytimeCacheWrapped(games);
    assert.equal(result['g1'].lastPlayed, ts);
});

test('buildPlaytimeCache: stores lastQualifiedPlayed from game.lastQualifiedPlayed', () => {
    const ts = Date.now();
    const games = [{ id: 'g1', totalPlaytime: 5, lastQualifiedPlayed: ts }];
    const result = _buildPlaytimeCacheWrapped(games);
    assert.equal(result['g1'].lastQualifiedPlayed, ts);
});

test('buildPlaytimeCache: stores playSessions from game.playSessions', () => {
    const sessions = [{ start: 1000, end: 2000 }];
    const games = [{ id: 'g1', playSessions: sessions }];
    const result = _buildPlaytimeCacheWrapped(games);
    assert.deepEqual(result['g1'].playSessions, sessions);
});

test('buildPlaytimeCache: defaults totalMinutes to 0 when game.totalPlaytime missing', () => {
    // game has playSessions but no totalPlaytime
    const games = [{ id: 'g1', playSessions: [{}] }];
    const result = _buildPlaytimeCacheWrapped(games);
    assert.equal(result['g1'].totalMinutes, 0);
});

test('buildPlaytimeCache: defaults lastPlayed to null when missing', () => {
    const games = [{ id: 'g1', totalPlaytime: 10 }];
    const result = _buildPlaytimeCacheWrapped(games);
    assert.equal(result['g1'].lastPlayed, null);
});

test('buildPlaytimeCache: defaults playSessions to [] when missing', () => {
    const games = [{ id: 'g1', totalPlaytime: 10 }];
    const result = _buildPlaytimeCacheWrapped(games);
    assert.deepEqual(result['g1'].playSessions, []);
});

test('buildPlaytimeCache: timeTrackingEnabled defaults true when field absent', () => {
    // g.timeTrackingEnabled !== false → true when undefined
    const games = [{ id: 'g1', totalPlaytime: 10 }];
    const result = _buildPlaytimeCacheWrapped(games);
    assert.equal(result['g1'].timeTrackingEnabled, true);
});

test('buildPlaytimeCache: timeTrackingEnabled is false when explicitly set false', () => {
    const games = [{ id: 'g1', totalPlaytime: 10, timeTrackingEnabled: false }];
    const result = _buildPlaytimeCacheWrapped(games);
    assert.equal(result['g1'].timeTrackingEnabled, false);
});

test('buildPlaytimeCache: includes game only when lastPlayed is truthy (no totalPlaytime)', () => {
    const ts = Date.now();
    const games = [{ id: 'g1', lastPlayed: ts }];
    const result = _buildPlaytimeCacheWrapped(games);
    assert.ok(Object.prototype.hasOwnProperty.call(result, 'g1'));
});

test('buildPlaytimeCache: resets on successive calls (each call starts fresh)', () => {
    const first  = _buildPlaytimeCacheWrapped([{ id: 'a', totalPlaytime: 10 }]);
    const second = _buildPlaytimeCacheWrapped([{ id: 'b', totalPlaytime: 20 }]);
    assert.ok(!Object.prototype.hasOwnProperty.call(second, 'a'), 'previous call result must not bleed through');
    assert.ok(Object.prototype.hasOwnProperty.call(second, 'b'));
});

test('buildPlaytimeCache: handles multiple games', () => {
    const games = [
        { id: 'x', totalPlaytime: 30 },
        { id: 'y', totalPlaytime: 60 },
        { id: 'z' }, // no playtime — must be skipped
    ];
    const result = _buildPlaytimeCacheWrapped(games);
    assert.ok(Object.prototype.hasOwnProperty.call(result, 'x'));
    assert.ok(Object.prototype.hasOwnProperty.call(result, 'y'));
    assert.ok(!Object.prototype.hasOwnProperty.call(result, 'z'), 'game with no playtime fields must be excluded');
    assert.equal(result['x'].totalMinutes, 30);
    assert.equal(result['y'].totalMinutes, 60);
});

// ─── savePlaytimeData source structure ───────────────────────────────────────
// Runtime test not possible (requires window.electronAPI). Verify source structure.

test('savePlaytimeData: calls window.electronAPI.updatePlaytime', () => {
    const fnStart = APP_JS.indexOf('async function savePlaytimeData');
    const fn = APP_JS.slice(fnStart, fnStart + 600);
    assert.match(fn, /window\.electronAPI\.updatePlaytime\(gameId, playedMinutes\)/);
});

test('savePlaytimeData: updates playtimeData[gameId].totalMinutes on success', () => {
    const fnStart = APP_JS.indexOf('async function savePlaytimeData');
    const fn = APP_JS.slice(fnStart, fnStart + 600);
    assert.match(fn, /playtimeData\[gameId\]\.totalMinutes\s*=\s*result\.totalPlaytime/);
});

test('savePlaytimeData: updates allGamesData entry on success', () => {
    const fnStart = APP_JS.indexOf('async function savePlaytimeData');
    const fn = APP_JS.slice(fnStart, fnStart + 900);
    assert.match(fn, /allGamesData\[gameIndex\]\.totalPlaytime\s*=\s*result\.totalPlaytime/);
});

test('savePlaytimeData: initializes missing playtimeData[gameId] before writing', () => {
    const fnStart = APP_JS.indexOf('async function savePlaytimeData');
    const fn = APP_JS.slice(fnStart, fnStart + 600);
    assert.match(fn, /if \(!playtimeData\[gameId\]\)/);
});

// ─── migratePlaytimeFromLocalStorage source structure ────────────────────────
// Runtime test not possible (requires localStorage + window.electronAPI).

test('migratePlaytimeFromLocalStorage: checks baddel_playtime_migrated flag', () => {
    const fnStart = APP_JS.indexOf('async function migratePlaytimeFromLocalStorage');
    const fn = APP_JS.slice(fnStart, fnStart + 600);
    assert.match(fn, /baddel_playtime_migrated/);
    assert.match(fn, /localStorage\.getItem/);
});

test('migratePlaytimeFromLocalStorage: reads old data from baddel_playtime key', () => {
    const fnStart = APP_JS.indexOf('async function migratePlaytimeFromLocalStorage');
    const fn = APP_JS.slice(fnStart, fnStart + 600);
    assert.match(fn, /baddel_playtime['"]/);
});

test('migratePlaytimeFromLocalStorage: sets migration flag after completion', () => {
    const fnStart = APP_JS.indexOf('async function migratePlaytimeFromLocalStorage');
    const fn = APP_JS.slice(fnStart, fnStart + 600);
    assert.match(fn, /localStorage\.setItem\('baddel_playtime_migrated'/);
});

test('migratePlaytimeFromLocalStorage: calls updatePlaytime for each entry', () => {
    const fnStart = APP_JS.indexOf('async function migratePlaytimeFromLocalStorage');
    const fn = APP_JS.slice(fnStart, fnStart + 600);
    assert.match(fn, /window\.electronAPI\.updatePlaytime\(/);
});

test('migratePlaytimeFromLocalStorage: skips migration when flag already set (early return)', () => {
    const fnStart = APP_JS.indexOf('async function migratePlaytimeFromLocalStorage');
    const fn = APP_JS.slice(fnStart, fnStart + 600);
    // Must have an early return path when migrationDone is truthy
    assert.match(fn, /if \(migrationDone\) return/);
});
