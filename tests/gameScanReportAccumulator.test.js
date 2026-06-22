const test = require('node:test');
const assert = require('node:assert/strict');

const { GameScanReportAccumulator } = require('../src/features/games/application/services/GameScanReportAccumulator');

// Simple normalizer that mirrors normalizeScannerPlatform's key behavior:
// lowercase + trim, pass-through (no alias mapping needed for these tests).
function norm(p) { return String(p || '').toLowerCase().trim(); }

function makeAccumulator() {
    return new GameScanReportAccumulator({ normalizePlatform: norm });
}

// ─── reset ────────────────────────────────────────────────────────────────────

test('GameScanReportAccumulator: reports starts empty', () => {
    const acc = makeAccumulator();
    assert.deepEqual(acc.reports, {}, 'reports must be empty on construction');
});

test('GameScanReportAccumulator: reset returns the new reports object', () => {
    const acc = makeAccumulator();
    const returned = acc.reset();
    assert.equal(returned, acc.reports, 'reset must return the same reports object reference');
});

test('GameScanReportAccumulator: reset clears existing platform reports', () => {
    const acc = makeAccumulator();
    acc.recordRaw('steam');
    assert.ok(acc.reports.steam, 'steam report must exist after recordRaw');
    acc.reset();
    assert.deepEqual(acc.reports, {}, 'reports must be empty after reset');
});

test('GameScanReportAccumulator: reset replaces the reports object reference', () => {
    const acc = makeAccumulator();
    const before = acc.reports;
    acc.reset();
    assert.notEqual(acc.reports, before, 'reset must produce a new reports object');
});

// ─── getReports ───────────────────────────────────────────────────────────────

test('GameScanReportAccumulator: getReports returns the current reports object', () => {
    const acc = makeAccumulator();
    assert.equal(acc.getReports(), acc.reports, 'getReports must return acc.reports');
    acc.recordRaw('steam');
    assert.ok(acc.getReports().steam, 'getReports must reflect mutations');
});

// ─── platformReport ───────────────────────────────────────────────────────────

test('GameScanReportAccumulator: platformReport creates default report with exact shape', () => {
    const acc = makeAccumulator();
    const r = acc.platformReport('steam');

    assert.equal(r.platform,           'steam', 'platform field must be normalized key');
    assert.equal(r.raw,                0);
    assert.equal(r.valid,              0);
    assert.equal(r.kept,               0);
    assert.equal(r.skipped,            0);
    assert.equal(r.skippedStale,       0);
    assert.equal(r.skippedMissingPath, 0);
    assert.equal(r.skippedMissingExe,  0);
    assert.equal(r.staleRemoved,       0);
    assert.equal(r.durationMs,         0);
    assert.deepEqual(r.errors,         []);
});

test('GameScanReportAccumulator: platformReport returns same object for same platform', () => {
    const acc = makeAccumulator();
    const first  = acc.platformReport('steam');
    const second = acc.platformReport('steam');
    assert.equal(first, second, 'same platform must return same report object');
});

test('GameScanReportAccumulator: platformReport creates separate reports for different platforms', () => {
    const acc = makeAccumulator();
    const steam = acc.platformReport('steam');
    const epic  = acc.platformReport('epic');
    assert.notEqual(steam, epic, 'different platforms must have different report objects');
});

test('GameScanReportAccumulator: platformReport normalizes platform via injected normalizer', () => {
    const acc = makeAccumulator(); // uses lowercase normalizer
    const r1 = acc.platformReport('STEAM');
    const r2 = acc.platformReport('steam');
    assert.equal(r1, r2, 'platform normalization must make STEAM and steam the same key');
    assert.equal(r1.platform, 'steam', 'stored platform key must be the normalized form');
});

// ─── recordRaw ────────────────────────────────────────────────────────────────

test('GameScanReportAccumulator: recordRaw increments raw by 1 by default', () => {
    const acc = makeAccumulator();
    acc.recordRaw('steam');
    assert.equal(acc.reports.steam.raw, 1);
});

test('GameScanReportAccumulator: recordRaw increments raw by count when provided', () => {
    const acc = makeAccumulator();
    acc.recordRaw('steam', 5);
    assert.equal(acc.reports.steam.raw, 5);
});

test('GameScanReportAccumulator: recordRaw does not affect other counters', () => {
    const acc = makeAccumulator();
    acc.recordRaw('steam');
    const r = acc.reports.steam;
    assert.equal(r.valid, 0);
    assert.equal(r.skipped, 0);
    assert.equal(r.errors.length, 0);
});

// ─── recordValid ──────────────────────────────────────────────────────────────

test('GameScanReportAccumulator: recordValid increments both valid and kept', () => {
    const acc = makeAccumulator();
    acc.recordValid('epic');
    assert.equal(acc.reports.epic.valid, 1, 'valid must be incremented');
    assert.equal(acc.reports.epic.kept,  1, 'kept must be incremented');
});

test('GameScanReportAccumulator: recordValid increments by count when provided', () => {
    const acc = makeAccumulator();
    acc.recordValid('epic', 3);
    assert.equal(acc.reports.epic.valid, 3);
    assert.equal(acc.reports.epic.kept,  3);
});

test('GameScanReportAccumulator: recordValid does not affect raw or skipped', () => {
    const acc = makeAccumulator();
    acc.recordValid('epic');
    assert.equal(acc.reports.epic.raw,     0);
    assert.equal(acc.reports.epic.skipped, 0);
});

// ─── recordSkip ───────────────────────────────────────────────────────────────

test('GameScanReportAccumulator: recordSkip always increments skipped', () => {
    const acc = makeAccumulator();
    acc.recordSkip('steam', 'some_reason');
    assert.equal(acc.reports.steam.skipped, 1);
});

test('GameScanReportAccumulator: recordSkip with install_path_missing increments skippedMissingPath', () => {
    const acc = makeAccumulator();
    acc.recordSkip('steam', 'install_path_missing');
    assert.equal(acc.reports.steam.skippedMissingPath, 1);
    assert.equal(acc.reports.steam.skippedMissingExe,  0);
    assert.equal(acc.reports.steam.skippedStale,        0);
});

test('GameScanReportAccumulator: recordSkip with exe_missing increments skippedMissingExe', () => {
    const acc = makeAccumulator();
    acc.recordSkip('riot', 'exe_missing');
    assert.equal(acc.reports.riot.skippedMissingExe,  1);
    assert.equal(acc.reports.riot.skippedMissingPath, 0);
    assert.equal(acc.reports.riot.skippedStale,        0);
});

test('GameScanReportAccumulator: recordSkip with stale_registry_entry increments skippedStale', () => {
    const acc = makeAccumulator();
    acc.recordSkip('ubisoft', 'stale_registry_entry', { name: 'Test' });
    assert.equal(acc.reports.ubisoft.skippedStale, 1);
    assert.equal(acc.reports.ubisoft.skippedMissingPath, 0);
});

test('GameScanReportAccumulator: recordSkip with install_path_empty also increments skippedStale', () => {
    const acc = makeAccumulator();
    acc.recordSkip('steam', 'install_path_empty');
    assert.equal(acc.reports.steam.skippedStale, 1);
});

test('GameScanReportAccumulator: recordSkip with unknown reason increments only skipped', () => {
    const acc = makeAccumulator();
    acc.recordSkip('epic', 'not_game');
    const r = acc.reports.epic;
    assert.equal(r.skipped,            1);
    assert.equal(r.skippedMissingPath, 0);
    assert.equal(r.skippedMissingExe,  0);
    assert.equal(r.skippedStale,       0);
});

test('GameScanReportAccumulator: recordSkip for ubisoft logs to console', () => {
    const acc = makeAccumulator();
    const logged = [];
    const orig = console.log;
    console.log = (...args) => logged.push(args.join(' '));
    try {
        acc.recordSkip('ubisoft', 'stale_registry_entry', { name: 'AC Unity', path: 'C:/Games/AC' });
    } finally {
        console.log = orig;
    }
    assert.ok(logged.some(l => l.includes('[Ubisoft Scan]')), 'must log [Ubisoft Scan] for ubisoft skips');
    assert.ok(logged.some(l => l.includes('AC Unity')), 'log must include candidate name');
});

test('GameScanReportAccumulator: recordSkip for non-ubisoft platform does not log', () => {
    const acc = makeAccumulator();
    const logged = [];
    const orig = console.log;
    console.log = (...args) => logged.push(args.join(' '));
    try {
        acc.recordSkip('steam', 'install_path_missing', { name: 'Game' });
    } finally {
        console.log = orig;
    }
    assert.ok(!logged.some(l => l.includes('[Ubisoft Scan]')), 'must not log [Ubisoft Scan] for non-ubisoft');
});

// ─── recordError ──────────────────────────────────────────────────────────────

test('GameScanReportAccumulator: recordError pushes err.message to errors array', () => {
    const acc = makeAccumulator();
    acc.recordError('steam', new Error('disk read failed'));
    assert.deepEqual(acc.reports.steam.errors, ['disk read failed']);
});

test('GameScanReportAccumulator: recordError falls back to String(err) when no .message', () => {
    const acc = makeAccumulator();
    acc.recordError('epic', 'plain string error');
    assert.deepEqual(acc.reports.epic.errors, ['plain string error']);
});

test('GameScanReportAccumulator: recordError accumulates multiple errors', () => {
    const acc = makeAccumulator();
    acc.recordError('riot', new Error('first'));
    acc.recordError('riot', new Error('second'));
    assert.equal(acc.reports.riot.errors.length, 2);
    assert.deepEqual(acc.reports.riot.errors, ['first', 'second']);
});

test('GameScanReportAccumulator: recordError does not affect other counters', () => {
    const acc = makeAccumulator();
    acc.recordError('xbox', new Error('err'));
    const r = acc.reports.xbox;
    assert.equal(r.raw,     0);
    assert.equal(r.valid,   0);
    assert.equal(r.skipped, 0);
});
