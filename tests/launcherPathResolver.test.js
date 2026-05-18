'use strict';

// ============================================================
// Unit tests for services/launcherPathResolver.js
//
// Strategy: inject lightweight stubs via the _opts parameter
// so no real filesystem, registry, or PowerShell is touched.
// ============================================================

const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('path');
const os     = require('os');

const resolver = require('../services/launcherPathResolver');

// ─── Shared stubs ─────────────────────────────────────────────────────────────

function makeExists(...existingPaths) {
    const set = new Set(existingPaths.map(p => p.toLowerCase()));
    return (p) => set.has((p || '').toLowerCase());
}

function makeDrives(...letters) {
    return async () => letters.map(l => `${l}:\\`);
}

const noDrives    = makeDrives();
const noRegistry  = async () => [];
const noShortcuts = async () => [];
const noRunning   = async () => null;
const noProtocol  = async () => null;
const noSteamReg  = async () => null;
const noRiotInstalls = async () => null;
const noDiscordApp   = async () => null;

// ─── validateLauncherExe ─────────────────────────────────────────────────────

test('validateLauncherExe: rejects null / empty path', () => {
    assert.throws(() => resolver.validateLauncherExe('epic', null),  { code: 'INVALID_PATH' });
    assert.throws(() => resolver.validateLauncherExe('epic', ''),    { code: 'INVALID_PATH' });
    assert.throws(() => resolver.validateLauncherExe('epic', '   '), { code: 'INVALID_PATH' });
});

test('validateLauncherExe: rejects unsupported platform', () => {
    assert.throws(
        () => resolver.validateLauncherExe('battlenet', 'C:\\foo\\Battle.net.exe'),
        { code: 'UNSUPPORTED_PLATFORM' }
    );
});

test('validateLauncherExe: rejects wrong exe name for epic', () => {
    assert.throws(
        () => resolver.validateLauncherExe('epic', 'C:\\Epic Games\\Launcher\\Portal\\Binaries\\Win64\\steam.exe'),
        { code: 'WRONG_EXE_NAME' }
    );
});

test('validateLauncherExe: rejects generic Launcher.exe outside Rockstar path', () => {
    assert.throws(
        () => resolver.validateLauncherExe('rockstar', 'C:\\SomeOtherApp\\Launcher.exe'),
        { code: 'WRONG_EXE_NAME' }
    );
});

test('validateLauncherExe: rejects Discord exe outside Discord folder', () => {
    assert.throws(
        () => resolver.validateLauncherExe('discord', 'C:\\SomeOtherApp\\Update.exe'),
        { code: 'WRONG_EXE_NAME' }
    );
});

test('validateLauncherExe: accepts correct Rockstar path (name + location checks only)', () => {
    // Use a path that is guaranteed to not exist (random suffix), so we only get FILE_NOT_FOUND
    const p = 'C:\\NonExistent_baddel_test_xyz\\Rockstar Games\\Launcher\\Launcher.exe';
    const err = (() => {
        try { return resolver.validateLauncherExe('rockstar', p); }
        catch (e) { return e; }
    })();
    // Must fail with FILE_NOT_FOUND (passed name + location checks) not WRONG_EXE_NAME
    assert.ok(err, 'must throw for non-existent file');
    assert.equal(err.code, 'FILE_NOT_FOUND', 'should fail with FILE_NOT_FOUND, not WRONG_EXE_NAME');
});

test('validateLauncherExe: accepts UbisoftConnect.exe and upc.exe for ubisoft', () => {
    for (const name of ['UbisoftConnect.exe', 'upc.exe']) {
        // Use a guaranteed non-existent path to test only the name check
        const p = `C:\\NonExistent_baddel_test_xyz\\Ubisoft\\Ubisoft Game Launcher\\${name}`;
        const err = (() => {
            try { return resolver.validateLauncherExe('ubisoft', p); }
            catch (e) { return e; }
        })();
        assert.ok(err, `${name}: must throw for non-existent file`);
        assert.equal(err.code, 'FILE_NOT_FOUND', `${name} should pass name check and fail with FILE_NOT_FOUND`);
    }
});

// ─── findLauncherExe — saved manual path ─────────────────────────────────────

test('findLauncherExe: finds Epic via drive scan on D:\\ (manual path not injectable, uses drive scan)', async () => {
    // The saved-manual-path strategy reads from the real filesystem and cannot be
    // injected via _opts in the current design, so this test exercises the drive-
    // scan strategy using a standard drive path.
    const expected = 'D:\\Epic Games\\Launcher\\Portal\\Binaries\\Win64\\EpicGamesLauncher.exe';

    const found = await resolver.findLauncherExe('epic', {
        _fileExists:     makeExists(expected),
        _getDrives:      makeDrives('C', 'D'),
        _queryRegistry:  noRegistry,
        _queryShortcuts: noShortcuts,
        _findRunning:    noRunning,
        _queryProtocol:  noProtocol,
    });
    assert.equal(found, expected);
});

// ─── findLauncherExe — env-based paths ───────────────────────────────────────

test('findLauncherExe: finds Epic on ProgramFiles(x86) env path', async () => {
    const pfx = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const expected = path.join(pfx, 'Epic Games', 'Launcher', 'Portal', 'Binaries', 'Win64', 'EpicGamesLauncher.exe');

    const found = await resolver.findLauncherExe('epic', {
        _fileExists:     makeExists(expected),
        _getDrives:      noDrives,
        _queryRegistry:  noRegistry,
        _queryShortcuts: noShortcuts,
        _findRunning:    noRunning,
        _queryProtocol:  noProtocol,
    });
    assert.equal(found, expected);
});

test('findLauncherExe: finds EA from ProgramFiles env path', async () => {
    const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
    const expected = path.join(pf, 'Electronic Arts', 'EA Desktop', 'EA Desktop', 'EADesktop.exe');

    const found = await resolver.findLauncherExe('ea', {
        _fileExists:     makeExists(expected),
        _getDrives:      noDrives,
        _queryRegistry:  noRegistry,
        _queryShortcuts: noShortcuts,
        _findRunning:    noRunning,
        _queryProtocol:  noProtocol,
    });
    assert.equal(found, expected);
});

test('findLauncherExe: finds Steam from ProgramFiles(x86)', async () => {
    const pfx = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const expected = path.join(pfx, 'Steam', 'steam.exe');

    const found = await resolver.findLauncherExe('steam', {
        _fileExists:     makeExists(expected),
        _getDrives:      noDrives,
        _queryRegistry:  noRegistry,
        _queryShortcuts: noShortcuts,
        _findRunning:    noRunning,
        _queryProtocol:  noProtocol,
        _steamRegPath:   noSteamReg,
    });
    assert.equal(found, expected);
});

// ─── findLauncherExe — custom drive ──────────────────────────────────────────

test('findLauncherExe: finds Epic on D:\\ custom drive', async () => {
    const expected = 'D:\\Epic Games\\Launcher\\Portal\\Binaries\\Win64\\EpicGamesLauncher.exe';

    const found = await resolver.findLauncherExe('epic', {
        _fileExists:     makeExists(expected),
        _getDrives:      makeDrives('C', 'D'),
        _queryRegistry:  noRegistry,
        _queryShortcuts: noShortcuts,
        _findRunning:    noRunning,
        _queryProtocol:  noProtocol,
    });
    assert.equal(found, expected);
});

test('findLauncherExe: finds Rockstar on E:\\ custom drive', async () => {
    const expected = 'E:\\Rockstar Games\\Launcher\\Launcher.exe';

    const found = await resolver.findLauncherExe('rockstar', {
        _fileExists:     makeExists(expected),
        _getDrives:      makeDrives('C', 'D', 'E'),
        _queryRegistry:  noRegistry,
        _queryShortcuts: noShortcuts,
        _findRunning:    noRunning,
        _queryProtocol:  noProtocol,
    });
    assert.equal(found, expected);
});

// ─── findLauncherExe — Ubisoft both exe names ────────────────────────────────

test('findLauncherExe: finds Ubisoft via UbisoftConnect.exe', async () => {
    const pfx = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const expected = path.join(pfx, 'Ubisoft', 'Ubisoft Game Launcher', 'UbisoftConnect.exe');

    const found = await resolver.findLauncherExe('ubisoft', {
        _fileExists:     makeExists(expected),
        _getDrives:      noDrives,
        _queryRegistry:  noRegistry,
        _queryShortcuts: noShortcuts,
        _findRunning:    noRunning,
        _queryProtocol:  noProtocol,
    });
    assert.equal(found, expected);
});

test('findLauncherExe: finds Ubisoft via upc.exe when UbisoftConnect.exe absent', async () => {
    const pfx = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const expected = path.join(pfx, 'Ubisoft', 'Ubisoft Game Launcher', 'upc.exe');

    const found = await resolver.findLauncherExe('ubisoft', {
        _fileExists:     makeExists(expected),
        _getDrives:      noDrives,
        _queryRegistry:  noRegistry,
        _queryShortcuts: noShortcuts,
        _findRunning:    noRunning,
        _queryProtocol:  noProtocol,
    });
    assert.equal(found, expected);
});

// ─── findLauncherExe — Rockstar path guard ────────────────────────────────────

test('findLauncherExe: rejects generic Launcher.exe outside Rockstar path', async () => {
    // A Launcher.exe NOT in a Rockstar directory should never be returned
    const bad = 'D:\\SomeOtherApp\\Launcher\\Launcher.exe';

    const found = await resolver.findLauncherExe('rockstar', {
        _fileExists:     makeExists(bad),
        _getDrives:      makeDrives('C', 'D'),
        _queryRegistry:  noRegistry,
        _queryShortcuts: noShortcuts,
        _findRunning:    noRunning,
        _queryProtocol:  noProtocol,
    });
    assert.equal(found, null, 'must not return a Launcher.exe outside a Rockstar directory');
});

// ─── findLauncherExe — Discord Update.exe and app-* fallback ─────────────────

test('findLauncherExe: finds Discord via Update.exe in LOCALAPPDATA', async () => {
    const lad = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const expected = path.join(lad, 'Discord', 'Update.exe');

    const found = await resolver.findLauncherExe('discord', {
        _fileExists:     makeExists(expected),
        _getDrives:      noDrives,
        _queryRegistry:  noRegistry,
        _queryShortcuts: noShortcuts,
        _findRunning:    noRunning,
        _queryProtocol:  noProtocol,
        _discordAppDirs: noDiscordApp,
    });
    assert.equal(found, expected);
});

test('findLauncherExe: finds Discord via app-*/Discord.exe when Update.exe absent', async () => {
    const lad = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const appExe = path.join(lad, 'Discord', 'app-1.0.9019', 'Discord.exe');

    const found = await resolver.findLauncherExe('discord', {
        _fileExists:     makeExists(appExe),   // Update.exe does NOT exist
        _getDrives:      noDrives,
        _queryRegistry:  noRegistry,
        _queryShortcuts: noShortcuts,
        _findRunning:    noRunning,
        _queryProtocol:  noProtocol,
        _discordAppDirs: async (existsFn) => existsFn(appExe) ? appExe : null,
    });
    assert.equal(found, appExe);
});

// ─── findLauncherExe — registry strategies ────────────────────────────────────

test('findLauncherExe: finds Epic from registry InstallLocation', async () => {
    const loc = 'C:\\Games\\Epic';
    const expected = path.join(loc, 'EpicGamesLauncher.exe');

    const found = await resolver.findLauncherExe('epic', {
        _fileExists:     makeExists(expected),
        _getDrives:      noDrives,
        _queryRegistry:  async () => [{ InstallLocation: loc }],
        _queryShortcuts: noShortcuts,
        _findRunning:    noRunning,
        _queryProtocol:  noProtocol,
    });
    assert.equal(found, expected);
});

test('findLauncherExe: finds EA from registry DisplayIcon with ",0" suffix', async () => {
    const icon     = 'C:\\Program Files\\Electronic Arts\\EA Desktop\\EA Desktop\\EADesktop.exe,0';
    const expected = 'C:\\Program Files\\Electronic Arts\\EA Desktop\\EA Desktop\\EADesktop.exe';

    const found = await resolver.findLauncherExe('ea', {
        _fileExists:     makeExists(expected),
        _getDrives:      noDrives,
        _queryRegistry:  async () => [{ DisplayIcon: icon }],
        _queryShortcuts: noShortcuts,
        _findRunning:    noRunning,
        _queryProtocol:  noProtocol,
    });
    assert.equal(found, expected);
});

test('findLauncherExe: finds Steam from registry UninstallString', async () => {
    const uninstall = '"C:\\Program Files (x86)\\Steam\\uninstall.exe"';
    const expected  = 'C:\\Program Files (x86)\\Steam\\steam.exe';

    const found = await resolver.findLauncherExe('steam', {
        _fileExists:     makeExists(expected),
        _getDrives:      noDrives,
        _queryRegistry:  async () => [{ UninstallString: uninstall }],
        _queryShortcuts: noShortcuts,
        _findRunning:    noRunning,
        _queryProtocol:  noProtocol,
        _steamRegPath:   noSteamReg,
    });
    assert.equal(found, expected);
});

// ─── findLauncherExe — shortcut strategy ──────────────────────────────────────

test('findLauncherExe: finds launcher from Start Menu shortcut target', async () => {
    const target = 'D:\\Ubisoft Connect\\UbisoftConnect.exe';

    const found = await resolver.findLauncherExe('ubisoft', {
        _fileExists:     makeExists(target),
        _getDrives:      noDrives,
        _queryRegistry:  noRegistry,
        _queryShortcuts: async () => [target],
        _findRunning:    noRunning,
        _queryProtocol:  noProtocol,
    });
    assert.equal(found, target);
});

// ─── findLauncherExe — running process strategy ───────────────────────────────

test('findLauncherExe: finds launcher from running process path', async () => {
    const running = 'D:\\Rockstar Games\\Launcher\\Launcher.exe';

    const found = await resolver.findLauncherExe('rockstar', {
        _fileExists:     makeExists(running),
        _getDrives:      noDrives,
        _queryRegistry:  noRegistry,
        _queryShortcuts: noShortcuts,
        _findRunning:    async () => running,
        _queryProtocol:  noProtocol,
    });
    assert.equal(found, running);
});

// ─── findLauncherExe — returns null when nothing found ───────────────────────

test('findLauncherExe: returns null when launcher not found anywhere', async () => {
    const found = await resolver.findLauncherExe('epic', {
        _fileExists:     makeExists(),          // nothing exists
        _getDrives:      makeDrives('C', 'D'),
        _queryRegistry:  noRegistry,
        _queryShortcuts: noShortcuts,
        _findRunning:    noRunning,
        _queryProtocol:  noProtocol,
    });
    assert.equal(found, null);
});

// ─── findLauncherExe — Riot special: RiotClientInstalls.json ─────────────────

test('findLauncherExe: finds Riot from RiotClientInstalls.json rc_default', async () => {
    const expected = 'C:\\Riot Games\\Riot Client\\RiotClientServices.exe';

    const found = await resolver.findLauncherExe('riot', {
        _fileExists:      makeExists(expected),
        _getDrives:       noDrives,
        _queryRegistry:   noRegistry,
        _queryShortcuts:  noShortcuts,
        _findRunning:     noRunning,
        _queryProtocol:   noProtocol,
        _readRiotInstalls: async () => ({ rc_default: expected, rc_live: '', associated_client: {} }),
    });
    assert.equal(found, expected);
});

// ─── getLauncherLaunchSpec ────────────────────────────────────────────────────

test('getLauncherLaunchSpec: returns empty args for Epic', async () => {
    const pfx = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const exe = path.join(pfx, 'Epic Games', 'Launcher', 'Portal', 'Binaries', 'Win64', 'EpicGamesLauncher.exe');

    const spec = await resolver.getLauncherLaunchSpec('epic', {
        _fileExists:     makeExists(exe),
        _getDrives:      noDrives,
        _queryRegistry:  noRegistry,
        _queryShortcuts: noShortcuts,
        _findRunning:    noRunning,
        _queryProtocol:  noProtocol,
    });
    assert.ok(spec, 'spec must not be null');
    assert.equal(spec.exePath, exe);
    assert.deepEqual(spec.args, []);
});

test('getLauncherLaunchSpec: returns --processStart Discord.exe args when Update.exe found', async () => {
    const lad = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const updateExe = path.join(lad, 'Discord', 'Update.exe');

    const spec = await resolver.getLauncherLaunchSpec('discord', {
        _fileExists:     makeExists(updateExe),
        _getDrives:      noDrives,
        _queryRegistry:  noRegistry,
        _queryShortcuts: noShortcuts,
        _findRunning:    noRunning,
        _queryProtocol:  noProtocol,
        _discordAppDirs: noDiscordApp,
    });
    assert.ok(spec, 'spec must not be null');
    assert.equal(spec.exePath, updateExe);
    assert.deepEqual(spec.args, ['--processStart', 'Discord.exe']);
});

test('getLauncherLaunchSpec: returns empty args when Discord.exe found directly', async () => {
    const lad = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const discordExe = path.join(lad, 'Discord', 'app-1.0.9019', 'Discord.exe');

    const spec = await resolver.getLauncherLaunchSpec('discord', {
        _fileExists:     makeExists(discordExe),
        _getDrives:      noDrives,
        _queryRegistry:  noRegistry,
        _queryShortcuts: noShortcuts,
        _findRunning:    noRunning,
        _queryProtocol:  noProtocol,
        _discordAppDirs: async (existsFn) => existsFn(discordExe) ? discordExe : null,
    });
    assert.ok(spec, 'spec must not be null');
    assert.match(spec.exePath.toLowerCase(), /discord\.exe/);
    assert.deepEqual(spec.args, []);
});

test('getLauncherLaunchSpec: returns null when launcher not found', async () => {
    const spec = await resolver.getLauncherLaunchSpec('discord', {
        _fileExists:     makeExists(),
        _getDrives:      noDrives,
        _queryRegistry:  noRegistry,
        _queryShortcuts: noShortcuts,
        _findRunning:    noRunning,
        _queryProtocol:  noProtocol,
        _discordAppDirs: noDiscordApp,
    });
    assert.equal(spec, null);
});

// ─── getPlatformInfo ──────────────────────────────────────────────────────────

test('getPlatformInfo: returns metadata for all supported platforms', () => {
    for (const platform of resolver.SUPPORTED_PLATFORMS) {
        const info = resolver.getPlatformInfo(platform);
        assert.ok(info,              `${platform}: must have info`);
        assert.ok(info.name,         `${platform}: must have name`);
        assert.ok(info.exeNames?.length, `${platform}: must have exeNames`);
    }
});

test('getPlatformInfo: returns null for unsupported platform', () => {
    assert.equal(resolver.getPlatformInfo('battlenet'), null);
});
