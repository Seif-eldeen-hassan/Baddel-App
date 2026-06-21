'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');

process.env.BADDEL_TEST_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-scanprep-singleton-'));

const { BaddelEngine } = require('../gameScanner');

function makeEngine() {
    const dbFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-scanprep-'));
    return new BaddelEngine({
        dbFolder,
        programData: path.join(dbFolder, 'ProgramData'),
        skipMetadataServerSync: true,
    });
}

const TS = '2025-01-01T00:00:00.000Z';

// ── _prepareScannerGame ────────────────────────────────────────────────────────

test('_prepareScannerGame: installSource is always set to "scanner"', () => {
    const engine = makeEngine();
    const { game } = engine._prepareScannerGame(
        { name: 'Half-Life 2', scannerPlatform: 'steam', allIds: { steam: '220' } },
        'steam', TS
    );
    assert.equal(game.installSource, 'scanner');
});

test('_prepareScannerGame: scannerPlatform is normalized from the platform arg', () => {
    const engine = makeEngine();
    const { game } = engine._prepareScannerGame(
        { name: 'Half-Life 2', allIds: { steam: '220' } },
        'Steam',    // unnormalized
        TS
    );
    assert.equal(game.scannerPlatform, 'steam');
});

test('_prepareScannerGame: lastSeenAt equals the scanStartedAt timestamp', () => {
    const engine = makeEngine();
    const { game } = engine._prepareScannerGame(
        { name: 'Portal', scannerPlatform: 'steam', allIds: { steam: '400' } },
        'steam', TS
    );
    assert.equal(game.lastSeenAt, TS);
});

test('_prepareScannerGame: firstSeenAt is set to scanStartedAt when absent on game', () => {
    const engine = makeEngine();
    const { game } = engine._prepareScannerGame(
        { name: 'Portal', scannerPlatform: 'steam', allIds: { steam: '400' } },
        'steam', TS
    );
    assert.equal(game.firstSeenAt, TS);
});

test('_prepareScannerGame: firstSeenAt is preserved when already set on game', () => {
    const engine = makeEngine();
    const early = '2020-01-01T00:00:00.000Z';
    const { game } = engine._prepareScannerGame(
        { name: 'Old Game', scannerPlatform: 'steam', allIds: { steam: '123' }, firstSeenAt: early },
        'steam', TS
    );
    assert.equal(game.firstSeenAt, early);
});

test('_prepareScannerGame: isInstalled is true for a valid game', () => {
    const engine = makeEngine();
    const { game } = engine._prepareScannerGame(
        { name: 'Half-Life 2', scannerPlatform: 'steam', allIds: { steam: '220' } },
        'steam', TS
    );
    assert.equal(game.isInstalled, true);
});

test('_prepareScannerGame: isInstalled is false for an invalid game (riot with no exe)', () => {
    const engine = makeEngine();
    const { game } = engine._prepareScannerGame(
        { name: 'VALORANT', scannerPlatform: 'riot' },
        'riot', TS
    );
    assert.equal(game.isInstalled, false);
    assert.equal(game.installVerified, false);
});

test('_prepareScannerGame: validationWarnings is always an array', () => {
    const engine = makeEngine();
    const { game } = engine._prepareScannerGame(
        { name: 'Half-Life 2', scannerPlatform: 'steam', allIds: { steam: '220' } },
        'steam', TS
    );
    assert.ok(Array.isArray(game.validationWarnings));
});

test('_prepareScannerGame: validation warnings from isGameInstallValid are included', () => {
    const engine = makeEngine();
    const { game } = engine._prepareScannerGame(
        { name: 'VALORANT', scannerPlatform: 'riot' },  // riot requires exe
        'riot', TS
    );
    assert.ok(game.validationWarnings.length > 0, 'must have at least one warning');
    assert.ok(game.validationWarnings.some(w => typeof w === 'string'), 'warnings must be strings');
});

test('_prepareScannerGame: existing validationWarnings on game are merged with validation warnings', () => {
    const engine = makeEngine();
    const { game } = engine._prepareScannerGame(
        { name: 'VALORANT', scannerPlatform: 'riot', validationWarnings: ['pre-existing-warn'] },
        'riot', TS
    );
    assert.ok(game.validationWarnings.includes('pre-existing-warn'), 'existing warning must survive');
    assert.ok(game.validationWarnings.length > 1, 'validation warnings must also be included');
});

test('_prepareScannerGame: installedGameKey is set on the prepared game', () => {
    const engine = makeEngine();
    const { game } = engine._prepareScannerGame(
        { name: 'Half-Life 2', scannerPlatform: 'steam', allIds: { steam: '220' } },
        'steam', TS
    );
    assert.ok(game.installedGameKey, 'installedGameKey must be truthy');
    assert.equal(game.installedGameKey, 'steam:220');
});

test('_prepareScannerGame: existing installedGameKey is preserved and not overwritten', () => {
    const engine = makeEngine();
    const { game } = engine._prepareScannerGame(
        { name: 'Half-Life 2', scannerPlatform: 'steam', allIds: { steam: '220' }, installedGameKey: 'steam:custom-key' },
        'steam', TS
    );
    assert.equal(game.installedGameKey, 'steam:custom-key');
});

test('_prepareScannerGame: returns both game and validation objects', () => {
    const engine = makeEngine();
    const result = engine._prepareScannerGame(
        { name: 'Half-Life 2', scannerPlatform: 'steam', allIds: { steam: '220' } },
        'steam', TS
    );
    assert.ok('game' in result, 'result must have game key');
    assert.ok('validation' in result, 'result must have validation key');
    assert.ok(typeof result.validation.valid === 'boolean', 'validation.valid must be boolean');
});

test('_prepareScannerGame: does not mutate the original game object', () => {
    const engine = makeEngine();
    const original = { name: 'Half-Life 2', scannerPlatform: 'steam', allIds: { steam: '220' } };
    const snapshot = { ...original };
    engine._prepareScannerGame(original, 'steam', TS);
    assert.deepEqual(original, snapshot, 'original game object must not be mutated');
});

// ── Steam launcherGameId hydration ────────────────────────────────────────────

test('_prepareScannerGame (steam): launcherGameId set from allIds.steam when absent', () => {
    const engine = makeEngine();
    const { game } = engine._prepareScannerGame(
        { name: 'Half-Life 2', scannerPlatform: 'steam', allIds: { steam: '220' } },
        'steam', TS
    );
    assert.equal(game.launcherGameId, '220');
});

test('_prepareScannerGame (steam): launcherGameId from id prefix when allIds.steam absent', () => {
    const engine = makeEngine();
    const { game } = engine._prepareScannerGame(
        { id: 'steam-440', name: 'Half-Life 2', scannerPlatform: 'steam' },
        'steam', TS
    );
    assert.equal(game.launcherGameId, '440');
});

// ── Epic launcherGameId hydration ─────────────────────────────────────────────

test('_prepareScannerGame (epic): launcherGameId is namespace:catalogItemId:appName when absent', () => {
    const engine = makeEngine();
    const { game } = engine._prepareScannerGame(
        { name: 'Fortnite', scannerPlatform: 'epic', namespace: 'fn', catalogItemId: 'cid', appName: 'Fortnite' },
        'epic', TS
    );
    assert.equal(game.launcherGameId, 'fn:cid:Fortnite');
});

test('_prepareScannerGame (epic): launcherGameId omits empty segments', () => {
    const engine = makeEngine();
    const { game } = engine._prepareScannerGame(
        { name: 'Fortnite', scannerPlatform: 'epic', appName: 'Fortnite' },  // no namespace/catalogItemId
        'epic', TS
    );
    assert.equal(game.launcherGameId, 'Fortnite');
});

// ── Riot launcherGameId hydration ─────────────────────────────────────────────

test('_prepareScannerGame (riot): launcherGameId set from riotProduct when absent', () => {
    const engine = makeEngine();
    const { game } = engine._prepareScannerGame(
        { name: 'VALORANT', scannerPlatform: 'riot', riotProduct: 'valorant',
          executablePath: 'C:/Riot/VALORANT.exe' },
        'riot', TS
    );
    assert.equal(game.launcherGameId, 'valorant');
});

// ── Existing launcherGameId preservation ─────────────────────────────────────

test('_prepareScannerGame: existing launcherGameId is preserved over hydration', () => {
    const engine = makeEngine();
    const { game } = engine._prepareScannerGame(
        { name: 'Half-Life 2', scannerPlatform: 'steam', allIds: { steam: '220' }, launcherGameId: 'preserved-id' },
        'steam', TS
    );
    assert.equal(game.launcherGameId, 'preserved-id');
});

// ── _scannerPlatformForGame ───────────────────────────────────────────────────

test('_scannerPlatformForGame: scannerPlatform wins and is normalized', () => {
    const engine = makeEngine();
    assert.equal(engine._scannerPlatformForGame({ scannerPlatform: 'Steam' }), 'steam');
});

test('_scannerPlatformForGame: platform is used when scannerPlatform absent', () => {
    const engine = makeEngine();
    assert.equal(engine._scannerPlatformForGame({ platform: 'Epic Games' }), 'epic');
});

test('_scannerPlatformForGame: source is used when scannerPlatform and platform absent', () => {
    const engine = makeEngine();
    assert.equal(engine._scannerPlatformForGame({ source: 'riot' }), 'riot');
});

test('_scannerPlatformForGame: id prefix steam- returns steam', () => {
    const engine = makeEngine();
    assert.equal(engine._scannerPlatformForGame({ id: 'steam-12345' }), 'steam');
});

test('_scannerPlatformForGame: id prefix epic- returns epic', () => {
    const engine = makeEngine();
    assert.equal(engine._scannerPlatformForGame({ id: 'epic-abc123' }), 'epic');
});

test('_scannerPlatformForGame: id prefix riot- returns riot', () => {
    const engine = makeEngine();
    assert.equal(engine._scannerPlatformForGame({ id: 'riot-valorant' }), 'riot');
});

test('_scannerPlatformForGame: id prefix ubisoft- returns ubisoft', () => {
    const engine = makeEngine();
    assert.equal(engine._scannerPlatformForGame({ id: 'ubisoft-99' }), 'ubisoft');
});

test('_scannerPlatformForGame: id prefix ea- returns ea', () => {
    const engine = makeEngine();
    assert.equal(engine._scannerPlatformForGame({ id: 'ea-bf2' }), 'ea');
});

test('_scannerPlatformForGame: id prefix xbox- returns xbox', () => {
    const engine = makeEngine();
    assert.equal(engine._scannerPlatformForGame({ id: 'xbox-game-pass-1' }), 'xbox');
});

test('_scannerPlatformForGame: unknown platform with no id prefix returns null', () => {
    const engine = makeEngine();
    assert.equal(engine._scannerPlatformForGame({ platform: 'Discord', id: 'manual-abc' }), null);
});

test('_scannerPlatformForGame: empty object returns null', () => {
    const engine = makeEngine();
    assert.equal(engine._scannerPlatformForGame({}), null);
});

test('_scannerPlatformForGame: id prefix match is case-insensitive', () => {
    const engine = makeEngine();
    assert.equal(engine._scannerPlatformForGame({ id: 'Steam-440' }), 'steam');
});

// ── _isScannerOwnedGame ───────────────────────────────────────────────────────

test('_isScannerOwnedGame: installSource === "scanner" returns true', () => {
    const engine = makeEngine();
    assert.equal(engine._isScannerOwnedGame({ installSource: 'scanner' }), true);
});

test('_isScannerOwnedGame: installSource === "manual" returns false even with scanner platform', () => {
    const engine = makeEngine();
    assert.equal(engine._isScannerOwnedGame({
        installSource: 'manual',
        scannerPlatform: 'steam',
        allIds: { steam: '440' },
    }), false);
});

test('_isScannerOwnedGame: other installSource value returns false', () => {
    const engine = makeEngine();
    assert.equal(engine._isScannerOwnedGame({ installSource: 'import' }), false);
});

test('_isScannerOwnedGame: no installSource, scanner platform, with command returns true', () => {
    const engine = makeEngine();
    assert.equal(engine._isScannerOwnedGame({
        scannerPlatform: 'steam',
        command: '"C:\\Games\\game.exe"',
    }), true);
});

test('_isScannerOwnedGame: no installSource, scanner platform, with path returns true', () => {
    const engine = makeEngine();
    assert.equal(engine._isScannerOwnedGame({
        scannerPlatform: 'epic',
        path: 'C:\\Games\\Epic\\Fortnite',
    }), true);
});

test('_isScannerOwnedGame: no installSource, scanner platform, with allIds returns true', () => {
    const engine = makeEngine();
    assert.equal(engine._isScannerOwnedGame({
        scannerPlatform: 'steam',
        allIds: { steam: '440' },
    }), true);
});

test('_isScannerOwnedGame: no installSource, platform is "manual" returns false', () => {
    const engine = makeEngine();
    assert.equal(engine._isScannerOwnedGame({
        platform: 'manual',
        scannerPlatform: 'steam',
        allIds: { steam: '440' },
    }), false);
});

test('_isScannerOwnedGame: no installSource, no scanner platform, returns false', () => {
    const engine = makeEngine();
    assert.equal(engine._isScannerOwnedGame({
        platform: 'Discord',
        command: '"C:\\Discord\\discord.exe"',
    }), false);
});

test('_isScannerOwnedGame: no installSource, scanner platform, no identifiers returns false', () => {
    const engine = makeEngine();
    assert.equal(engine._isScannerOwnedGame({
        scannerPlatform: 'steam',
        // no command, path, launcherGameId, allIds
    }), false);
});

test('_isScannerOwnedGame: id prefix fallback — steam id with command returns true', () => {
    const engine = makeEngine();
    assert.equal(engine._isScannerOwnedGame({
        id: 'steam-440',
        command: '"C:\\Steam\\game.exe"',
    }), true);
});

// ── _missingReasonForStoredGame ───────────────────────────────────────────────

test('_missingReasonForStoredGame: Epic Fab entry returns "epic_non_game_asset"', () => {
    const engine = makeEngine();
    const reason = engine._missingReasonForStoredGame({
        scannerPlatform: 'epic',
        appName: 'fab',
        name: 'Fab',
        namespace: 'fab',
    });
    assert.equal(reason, 'epic_non_game_asset');
});

test('_missingReasonForStoredGame: Epic marketplace plugin returns "epic_non_game_asset"', () => {
    const engine = makeEngine();
    const reason = engine._missingReasonForStoredGame({
        scannerPlatform: 'epic',
        appName: 'BP_CSV_Parsing',
        name: 'Blueprint CSV Parsing',
        namespace: 'unrealmarketplaceplugin',
    });
    assert.equal(reason, 'epic_non_game_asset');
});

test('_missingReasonForStoredGame: Epic game with platform === "Epic Games" also triggers Epic check', () => {
    const engine = makeEngine();
    const reason = engine._missingReasonForStoredGame({
        platform: 'Epic Games',
        appName: 'fab',
        name: 'Fab',
        namespace: 'fab',
    });
    assert.equal(reason, 'epic_non_game_asset');
});

test('_missingReasonForStoredGame: missing install path returns "install_path_missing"', () => {
    const engine = makeEngine();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mrsg-'));
    const missingPath = path.join(tmpDir, 'definitely-not-here');
    const reason = engine._missingReasonForStoredGame({
        scannerPlatform: 'steam',
        path: missingPath,
    });
    assert.equal(reason, 'install_path_missing');
});

test('_missingReasonForStoredGame: existing path but missing exe returns "exe_missing"', () => {
    const engine = makeEngine();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mrsg-'));
    const missingExe = path.join(tmpDir, 'missing.exe');
    const reason = engine._missingReasonForStoredGame({
        path: tmpDir,           // directory exists
        executablePath: missingExe,  // exe does not exist
    });
    assert.equal(reason, 'exe_missing');
});

test('_missingReasonForStoredGame: no path no exe returns "not_seen_in_latest_scan"', () => {
    const engine = makeEngine();
    const reason = engine._missingReasonForStoredGame({
        scannerPlatform: 'steam',
        name: 'Half-Life 2',
    });
    assert.equal(reason, 'not_seen_in_latest_scan');
});

test('_missingReasonForStoredGame: existing path with no exe field returns "not_seen_in_latest_scan"', () => {
    const engine = makeEngine();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mrsg-'));
    const reason = engine._missingReasonForStoredGame({
        path: tmpDir,   // exists — no exe to check
    });
    assert.equal(reason, 'not_seen_in_latest_scan');
});

test('_missingReasonForStoredGame: install_path_missing takes precedence over exe check', () => {
    const engine = makeEngine();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mrsg-'));
    const reason = engine._missingReasonForStoredGame({
        path: path.join(tmpDir, 'missing-dir'),  // path missing
        executablePath: path.join(tmpDir, 'missing-dir', 'game.exe'),  // exe also missing
    });
    assert.equal(reason, 'install_path_missing');
});

// ── _preferDetectedCandidate ──────────────────────────────────────────────────

test('_preferDetectedCandidate: existing is null returns candidate', () => {
    const engine = makeEngine();
    const candidate = { name: 'Game', executablePath: 'C:/Games/game.exe' };
    assert.equal(engine._preferDetectedCandidate(null, candidate), candidate);
});

test('_preferDetectedCandidate: candidate has executablePath, existing does not — returns candidate', () => {
    const engine = makeEngine();
    const existing  = { path: 'C:/Games/A' };
    const candidate = { path: 'C:/Games/B', executablePath: 'C:/Games/B/game.exe' };
    assert.equal(engine._preferDetectedCandidate(existing, candidate), candidate);
});

test('_preferDetectedCandidate: existing has executablePath, candidate does not — returns existing', () => {
    const engine = makeEngine();
    const existing  = { path: 'C:/Games/A', executablePath: 'C:/Games/A/game.exe' };
    const candidate = { path: 'C:/Games/B' };
    assert.equal(engine._preferDetectedCandidate(existing, candidate), existing);
});

test('_preferDetectedCandidate: both have executablePath, shorter path wins', () => {
    const engine = makeEngine();
    const existing  = { executablePath: 'C:/Games/A/game.exe', path: 'C:/Games/A' };
    const candidate = { executablePath: 'C:/Games/B/game.exe', path: 'C:/B' };
    assert.equal(engine._preferDetectedCandidate(existing, candidate), candidate,
        'candidate with shorter path must win when both have exe');
});

test('_preferDetectedCandidate: both have executablePath, longer candidate path — existing wins', () => {
    const engine = makeEngine();
    const existing  = { executablePath: 'C:/G/game.exe', path: 'C:/G' };
    const candidate = { executablePath: 'C:/Games/Very/Deep/Path/game.exe', path: 'C:/Games/Very/Deep/Path' };
    assert.equal(engine._preferDetectedCandidate(existing, candidate), existing,
        'existing with shorter path must win when candidate path is longer');
});

test('_preferDetectedCandidate: neither has executablePath, candidate has shorter path — candidate wins', () => {
    const engine = makeEngine();
    const existing  = { path: 'C:/Games/Very/Long/Path/Here' };
    const candidate = { path: 'C:/Short' };
    assert.equal(engine._preferDetectedCandidate(existing, candidate), candidate);
});

test('_preferDetectedCandidate: neither has executablePath, existing has path, candidate has no path — existing wins', () => {
    const engine = makeEngine();
    const existing  = { path: 'C:/Games/A' };
    const candidate = {};
    assert.equal(engine._preferDetectedCandidate(existing, candidate), existing);
});

test('_preferDetectedCandidate: both have same-length path — existing wins (no change)', () => {
    const engine = makeEngine();
    const existing  = { path: 'C:/A' };
    const candidate = { path: 'C:/B' };
    assert.equal(engine._preferDetectedCandidate(existing, candidate), existing);
});
