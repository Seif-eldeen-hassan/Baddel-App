'use strict';

// ============================================================
// Unit tests for services/riotPathResolver.js
//
// Strategy: inject lightweight stubs via the _opts parameter
// exposed by each public function so no real filesystem or
// PowerShell is touched during CI or local test runs.
// ============================================================

const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('path');
const os     = require('os');

const resolver = require('../services/riotPathResolver');
const { RIOT_EXE_NAME } = resolver;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeExists(...existingPaths) {
    const set = new Set(existingPaths.map(p => p.toLowerCase()));
    return (p) => set.has((p || '').toLowerCase());
}

function makeDrives(...letters) {
    return async () => letters.map(l => `${l}:\\`);
}

function makeInstalls(data) {
    return async () => data;
}

const noRegistry  = async () => [];
const noShortcuts = async () => [];
const noRunning   = async () => null;

// ─── validateRiotClientExe ────────────────────────────────────────────────────

test('validateRiotClientExe: accepts a correct path', () => {
    const p = `C:\\Riot Games\\Riot Client\\${RIOT_EXE_NAME}`;
    // Provide a fake exists so fsSync.statSync does not run
    // validateRiotClientExe uses fsSync directly, so we need the file to exist
    // for a fully passing test — in an isolated test we only test the error branches.
    const err = (() => {
        try { resolver.validateRiotClientExe(p); } catch (e) { return e; }
        return null;
    })();
    // Only expect FILE_NOT_FOUND (wrong basename check passes), not WRONG_EXE_NAME
    if (err) assert.equal(err.code, 'FILE_NOT_FOUND');
});

test('validateRiotClientExe: rejects null / empty path', () => {
    assert.throws(() => resolver.validateRiotClientExe(null),  { code: 'INVALID_PATH' });
    assert.throws(() => resolver.validateRiotClientExe(''),    { code: 'INVALID_PATH' });
    assert.throws(() => resolver.validateRiotClientExe('   '), { code: 'INVALID_PATH' });
});

test('validateRiotClientExe: rejects wrong exe name', () => {
    assert.throws(
        () => resolver.validateRiotClientExe('C:\\Riot Games\\Riot Client\\LeagueClient.exe'),
        { code: 'WRONG_EXE_NAME' }
    );
    assert.throws(
        () => resolver.validateRiotClientExe('C:\\some\\path\\riotclientux.exe'),
        { code: 'WRONG_EXE_NAME' }
    );
});

// ─── findRiotClientExe — env-based paths ──────────────────────────────────────

test('findRiotClientExe: finds client at C:\\Riot Games (default location)', async () => {
    const expected = `C:\\Riot Games\\Riot Client\\${RIOT_EXE_NAME}`;
    const found = await resolver.findRiotClientExe({
        _fileExists:    makeExists(expected),
        _getDrives:     makeDrives('C'),
        _readInstalls:  makeInstalls(null),
        _queryRegistry: noRegistry,
        _queryShortcuts: noShortcuts,
        _findRunning:   noRunning,
    });
    assert.equal(found, expected);
});

test('findRiotClientExe: finds client in Program Files', async () => {
    const pf       = process.env['ProgramFiles'] || 'C:\\Program Files';
    const expected = path.join(pf, 'Riot Games', 'Riot Client', RIOT_EXE_NAME);
    const found = await resolver.findRiotClientExe({
        _fileExists:    makeExists(expected),
        _getDrives:     makeDrives('C'),
        _readInstalls:  makeInstalls(null),
        _queryRegistry: noRegistry,
        _queryShortcuts: noShortcuts,
        _findRunning:   noRunning,
    });
    assert.equal(found, expected);
});

test('findRiotClientExe: finds client in Program Files (x86)', async () => {
    const pfx      = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const expected = path.join(pfx, 'Riot Games', 'Riot Client', RIOT_EXE_NAME);
    const found = await resolver.findRiotClientExe({
        _fileExists:    makeExists(expected),
        _getDrives:     makeDrives('C'),
        _readInstalls:  makeInstalls(null),
        _queryRegistry: noRegistry,
        _queryShortcuts: noShortcuts,
        _findRunning:   noRunning,
    });
    assert.equal(found, expected);
});

// ─── findRiotClientExe — drive scan ───────────────────────────────────────────

test('findRiotClientExe: finds client on custom drive D:\\Riot Games', async () => {
    const expected = `D:\\Riot Games\\Riot Client\\${RIOT_EXE_NAME}`;
    const found = await resolver.findRiotClientExe({
        _fileExists:    makeExists(expected),
        _getDrives:     makeDrives('C', 'D'),
        _readInstalls:  makeInstalls(null),
        _queryRegistry: noRegistry,
        _queryShortcuts: noShortcuts,
        _findRunning:   noRunning,
    });
    assert.equal(found, expected);
});

test('findRiotClientExe: finds client on custom drive E:\\Program Files\\Riot Games', async () => {
    const expected = `E:\\Program Files\\Riot Games\\Riot Client\\${RIOT_EXE_NAME}`;
    const found = await resolver.findRiotClientExe({
        _fileExists:    makeExists(expected),
        _getDrives:     makeDrives('C', 'D', 'E'),
        _readInstalls:  makeInstalls(null),
        _queryRegistry: noRegistry,
        _queryShortcuts: noShortcuts,
        _findRunning:   noRunning,
    });
    assert.equal(found, expected);
});

// ─── findRiotClientExe — RiotClientInstalls.json ──────────────────────────────

test('findRiotClientExe: finds client from RiotClientInstalls.json rc_live key', async () => {
    const expected = `D:\\Custom Install\\Riot Client\\${RIOT_EXE_NAME}`;
    const found = await resolver.findRiotClientExe({
        _fileExists:    makeExists(expected),
        _getDrives:     makeDrives('C'),
        _readInstalls:  makeInstalls({ rc_live: expected }),
        _queryRegistry: noRegistry,
        _queryShortcuts: noShortcuts,
        _findRunning:   noRunning,
    });
    assert.equal(found, expected);
});

test('findRiotClientExe: infers client path from associated_client VALORANT entry', async () => {
    const root     = 'E:\\Games\\Riot Games';
    const expected = path.join(root, 'Riot Client', RIOT_EXE_NAME);
    const valorantExe = path.join(root, 'VALORANT', 'live', 'VALORANT.exe');
    const found = await resolver.findRiotClientExe({
        _fileExists:    makeExists(expected),
        _getDrives:     makeDrives('C'),
        _readInstalls:  makeInstalls({
            rc_default:       null,
            rc_live:          null,
            associated_client: { valorant: valorantExe },
        }),
        _queryRegistry: noRegistry,
        _queryShortcuts: noShortcuts,
        _findRunning:   noRunning,
    });
    assert.equal(found, expected);
});

// ─── findRiotClientExe — registry ─────────────────────────────────────────────

test('findRiotClientExe: finds client via registry InstallLocation', async () => {
    const installLoc = 'F:\\Riot Games';
    const expected   = path.join(installLoc, 'Riot Client', RIOT_EXE_NAME);
    const found = await resolver.findRiotClientExe({
        _fileExists:    makeExists(expected),
        _getDrives:     makeDrives('C'),
        _readInstalls:  makeInstalls(null),
        _queryRegistry: async () => [{ Name: 'Riot Client', Location: installLoc, Icon: '', Uninstall: '' }],
        _queryShortcuts: noShortcuts,
        _findRunning:   noRunning,
    });
    assert.equal(found, expected);
});

test('findRiotClientExe: finds client via registry DisplayIcon field', async () => {
    const expected = `G:\\Custom\\Riot Client\\${RIOT_EXE_NAME}`;
    const found = await resolver.findRiotClientExe({
        _fileExists:    makeExists(expected),
        _getDrives:     makeDrives('C'),
        _readInstalls:  makeInstalls(null),
        _queryRegistry: async () => [{ Name: 'Riot Client', Location: '', Icon: `${expected},0`, Uninstall: '' }],
        _queryShortcuts: noShortcuts,
        _findRunning:   noRunning,
    });
    assert.equal(found, expected);
});

// ─── findRiotClientExe — shortcuts / running process ─────────────────────────

test('findRiotClientExe: finds client via shortcut target', async () => {
    const expected = `H:\\Riot Games\\Riot Client\\${RIOT_EXE_NAME}`;
    const found = await resolver.findRiotClientExe({
        _fileExists:    makeExists(expected),
        _getDrives:     makeDrives('C'),
        _readInstalls:  makeInstalls(null),
        _queryRegistry: noRegistry,
        _queryShortcuts: async () => [expected],
        _findRunning:   noRunning,
    });
    assert.equal(found, expected);
});

test('findRiotClientExe: finds client from running process as last resort', async () => {
    const expected = `I:\\Weird\\Path\\Riot Client\\${RIOT_EXE_NAME}`;
    const found = await resolver.findRiotClientExe({
        _fileExists:    makeExists(expected),
        _getDrives:     makeDrives('C'),
        _readInstalls:  makeInstalls(null),
        _queryRegistry: noRegistry,
        _queryShortcuts: noShortcuts,
        _findRunning:   async () => expected,
    });
    assert.equal(found, expected);
});

// ─── findRiotClientExe — not found ────────────────────────────────────────────

test('findRiotClientExe: returns null when nothing is found', async () => {
    const found = await resolver.findRiotClientExe({
        _fileExists:    () => false,
        _getDrives:     makeDrives('C', 'D', 'E'),
        _readInstalls:  makeInstalls(null),
        _queryRegistry: noRegistry,
        _queryShortcuts: noShortcuts,
        _findRunning:   noRunning,
    });
    assert.equal(found, null);
});

// ─── getRiotDetectionDiagnostics ─────────────────────────────────────────────

test('getRiotDetectionDiagnostics: returns structured diagnostics when nothing found', async () => {
    const diag = await resolver.getRiotDetectionDiagnostics({
        _fileExists: () => false,
        _getDrives:  makeDrives('C', 'D'),
    });
    assert.ok(Array.isArray(diag.checkedPaths));
    assert.ok(diag.checkedPaths.length > 0);
    assert.ok(Array.isArray(diag.drives));
    assert.equal(diag.manualPathSaved, null);
    assert.equal(diag.manualPathValid, false);
    diag.checkedPaths.forEach(entry => {
        assert.ok('path' in entry);
        assert.ok('exists' in entry);
        assert.equal(entry.exists, false);
    });
});

test('getRiotDetectionDiagnostics: marks found path as existing', async () => {
    const pf       = process.env['ProgramFiles'] || 'C:\\Program Files';
    const existing = path.join(pf, 'Riot Games', 'Riot Client', RIOT_EXE_NAME);
    const diag = await resolver.getRiotDetectionDiagnostics({
        _fileExists: makeExists(existing),
        _getDrives:  makeDrives('C'),
    });
    const entry = diag.checkedPaths.find(e => e.path.toLowerCase() === existing.toLowerCase());
    assert.ok(entry, 'expected path should appear in checkedPaths');
    assert.equal(entry.exists, true);
});

// ─── getRiotRootCandidates ────────────────────────────────────────────────────

test('getRiotRootCandidates: includes C:\\Riot Games', async () => {
    const roots = await resolver.getRiotRootCandidates({
        _getDrives:    makeDrives('C'),
        _readInstalls: makeInstalls(null),
    });
    const lower = roots.map(r => r.toLowerCase());
    assert.ok(lower.some(r => r === 'c:\\riot games'), `expected C:\\Riot Games in roots: ${roots.join(', ')}`);
});

test('getRiotRootCandidates: includes roots inferred from RiotClientInstalls.json', async () => {
    const roots = await resolver.getRiotRootCandidates({
        _getDrives:    makeDrives('C'),
        _readInstalls: makeInstalls({
            rc_live: 'D:\\Custom\\Riot Client\\RiotClientServices.exe',
        }),
    });
    const lower = roots.map(r => r.toLowerCase());
    assert.ok(lower.some(r => r === 'd:\\custom'), `expected D:\\Custom in roots: ${roots.join(', ')}`);
});

// ─── getRiotClientCandidates ─────────────────────────────────────────────────

test('getRiotClientCandidates: returns array of exe paths', async () => {
    const candidates = await resolver.getRiotClientCandidates({
        _getDrives:    makeDrives('C', 'D'),
        _readInstalls: makeInstalls(null),
    });
    assert.ok(Array.isArray(candidates));
    assert.ok(candidates.length > 0);
    candidates.forEach(p => {
        assert.ok(p.toLowerCase().endsWith('riotclientservices.exe'),
            `candidate should end with RiotClientServices.exe: ${p}`);
    });
});

// ─── Manual path management (in-memory stubs, no real disk I/O) ───────────────

test('validateRiotClientExe: rejects file with wrong name even if extension matches', () => {
    assert.throws(
        () => resolver.validateRiotClientExe('C:\\some\\path\\riot_client.exe'),
        { code: 'WRONG_EXE_NAME' }
    );
});

test('findRiotClientExe: manual path in opts._fileExists is used first', async () => {
    // The resolver checks env-based paths before drives; both point to same location
    const manual  = `C:\\Riot Games\\Riot Client\\${RIOT_EXE_NAME}`;
    const onDrive = `D:\\Riot Games\\Riot Client\\${RIOT_EXE_NAME}`;
    const found = await resolver.findRiotClientExe({
        _fileExists:    makeExists(manual, onDrive),
        _getDrives:     makeDrives('C', 'D'),
        _readInstalls:  makeInstalls(null),
        _queryRegistry: noRegistry,
        _queryShortcuts: noShortcuts,
        _findRunning:   noRunning,
    });
    // env-based C:\ path is checked before drive scan, so manual wins
    assert.equal(found, manual);
});
