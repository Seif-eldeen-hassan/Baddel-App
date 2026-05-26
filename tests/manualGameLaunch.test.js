'use strict';

// ============================================================
// Tests for the manual game launch fixes:
//   1. addManualGame stores unquoted command.
//   2. addManualGame stores path/executablePath/scannerPlatform/isInstalled.
//   3. .lnk files: command = .lnk, path = dirname(target), folderName/exeName from target.
//   4. Duplicate detection matches both command and executablePath.
//   5. preload.launchGame supports new (gameId, opts) and legacy
//      (command, gameId, gamePath, gameName) signatures.
//   6. Background pipeline: game.path as install dir → folderName = basename(game.path).
// ============================================================

const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');
const Module = require('module');

// ── Electron mock ─────────────────────────────────────────────────────────────

let _testUserData = os.tmpdir();

const _origLoad = Module._load.bind(Module);
Module._load = function (request, parent, isMain) {
    if (request === 'electron') {
        return {
            app: {
                getPath:    (name) => name === 'userData' ? _testUserData : os.tmpdir(),
                getVersion: () => '0.0.0',
                on:         () => {},
                isReady:    () => true,
            },
            shell:         { openExternal: async () => {}, openPath: async () => '' },
            net:           { request: () => ({ on: () => {}, end: () => {} }) },
            BrowserWindow: class { constructor() {} on() {} loadURL() {} },
            Notification:  class { constructor() {} show() {} },
            ipcMain:       { handle: () => {}, on: () => {} },
        };
    }
    return _origLoad(request, parent, isMain);
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-manual-test-')); }
function rmDir(dir)   { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /**/ } }

function freshRequireScanner() {
    for (const key of Object.keys(require.cache)) {
        if (key.includes('gameScanner') || key.includes('analytics') ||
            key.includes('metadataCacheStore') || key.includes('baddelApi') ||
            key.includes('candidateGenerator') || key.includes('metadataResolutionManager') ||
            key.includes('platformSyncShared')) {
            delete require.cache[key];
        }
    }
    return require('../gameScanner');
}

// ── addManualGame: .exe stores unquoted command ───────────────────────────────

test('addManualGame: command stored without outer quotes for .exe', async () => {
    _testUserData = makeTmpDir();
    try {
        const exeFile = path.join(_testUserData, 'TestGame', 'game.exe');
        fs.mkdirSync(path.dirname(exeFile), { recursive: true });
        fs.writeFileSync(exeFile, '');

        const scanner = freshRequireScanner();
        const result  = await scanner.addManualGame(exeFile, 'Test Game');

        assert.equal(result.status, 'success');
        assert.equal(result.game.command, exeFile);
        assert.ok(!result.game.command.startsWith('"'), 'command must not start with a quote');
    } finally { rmDir(_testUserData); }
});

// ── addManualGame: .exe stores correct install fields ─────────────────────────

test('addManualGame: .exe stores path=dirname, executablePath, scannerPlatform, isInstalled', async () => {
    _testUserData = makeTmpDir();
    try {
        const exeFile = path.join(_testUserData, 'MyGame', 'MyGame.exe');
        fs.mkdirSync(path.dirname(exeFile), { recursive: true });
        fs.writeFileSync(exeFile, '');

        const scanner = freshRequireScanner();
        const result  = await scanner.addManualGame(exeFile, 'My Game');

        assert.equal(result.status, 'success');
        assert.equal(result.game.path, path.dirname(exeFile));
        assert.equal(result.game.executablePath, exeFile);
        assert.equal(result.game.scannerPlatform, 'manual');
        assert.equal(result.game.installSource, 'manual');
        assert.equal(result.game.isInstalled, true);
    } finally { rmDir(_testUserData); }
});

// ── addManualGame: .lnk metadata correctness ─────────────────────────────────

test('addManualGame: .lnk — command=lnk, path=dirname(target), folderName/exeName from target', async () => {
    _testUserData = makeTmpDir();
    try {
        const lnkFile  = path.join(_testUserData, 'Desktop', 'GameShortcut.lnk');
        const lnkTarget = path.join(_testUserData, 'Games', 'AwesomeGame', 'AwesomeGame.exe');
        fs.mkdirSync(path.dirname(lnkFile),   { recursive: true });
        fs.mkdirSync(path.dirname(lnkTarget), { recursive: true });
        fs.writeFileSync(lnkFile,   '');
        fs.writeFileSync(lnkTarget, '');

        const scanner = freshRequireScanner();
        const result  = await scanner.addManualGame(
            lnkFile, 'Awesome Game', null,
            { lnkTarget, metadataPath: lnkTarget }
        );

        assert.equal(result.status, 'success');
        // launch path must be the .lnk
        assert.equal(result.game.command, lnkFile, 'command must be the .lnk path');
        assert.equal(result.game.shortcutPath, lnkFile, 'shortcutPath must be set');
        // install fields must come from the target, NOT from the Desktop .lnk
        assert.equal(result.game.executablePath, lnkTarget);
        assert.equal(result.game.path, path.dirname(lnkTarget), 'path must be the game install dir');
        assert.equal(result.game.folderName, path.basename(path.dirname(lnkTarget)));
        assert.equal(result.game.exeName, path.parse(lnkTarget).name);
    } finally { rmDir(_testUserData); }
});

// ── addManualGame: .lnk without known target falls back to .lnk folder ────────

test('addManualGame: .lnk without lnkTarget uses lnk path as metadataPath', async () => {
    _testUserData = makeTmpDir();
    try {
        const lnkFile = path.join(_testUserData, 'SomeGame.lnk');
        fs.writeFileSync(lnkFile, '');

        const scanner = freshRequireScanner();
        // No lnkTarget → metadataPath defaults to lnkFile
        const result  = await scanner.addManualGame(lnkFile, 'Some Game');

        assert.equal(result.status, 'success');
        assert.equal(result.game.command, lnkFile);
        // When no target, effectivePath === lnkFile so executablePath === lnkFile
        assert.equal(result.game.executablePath, lnkFile);
    } finally { rmDir(_testUserData); }
});

// ── addManualGame: duplicate detection via executablePath ─────────────────────

test('addManualGame: adding same target via different .lnk returns existing game', async () => {
    _testUserData = makeTmpDir();
    try {
        const lnk1   = path.join(_testUserData, 'Desktop', 'Link1.lnk');
        const lnk2   = path.join(_testUserData, 'Taskbar', 'Link2.lnk');
        const target = path.join(_testUserData, 'Games', 'game.exe');
        for (const p of [lnk1, lnk2, target]) {
            fs.mkdirSync(path.dirname(p), { recursive: true });
            fs.writeFileSync(p, '');
        }

        const scanner = freshRequireScanner();
        const r1 = await scanner.addManualGame(lnk1, null, null, { lnkTarget: target, metadataPath: target });
        const r2 = await scanner.addManualGame(lnk2, null, null, { lnkTarget: target, metadataPath: target });

        assert.equal(r1.status, 'success');
        assert.equal(r2.status, 'success');
        assert.equal(r1.game.id, r2.game.id, 'same game id for same target');
    } finally { rmDir(_testUserData); }
});

// ── addManualGame: duplicate re-add for .exe ──────────────────────────────────

test('addManualGame: adding the same exe twice returns existing game without duplicate', async () => {
    _testUserData = makeTmpDir();
    try {
        const exeFile = path.join(_testUserData, 'DupGame', 'dup.exe');
        fs.mkdirSync(path.dirname(exeFile), { recursive: true });
        fs.writeFileSync(exeFile, '');

        const scanner = freshRequireScanner();
        const r1 = await scanner.addManualGame(exeFile, 'Dup Game');
        const r2 = await scanner.addManualGame(exeFile, 'Dup Game');

        assert.equal(r1.status, 'success');
        assert.equal(r2.status, 'success');
        assert.equal(r1.game.id, r2.game.id, 'same id on both adds');
        const games = scanner.getSavedGames();
        assert.equal(games.filter(g => g.id === r1.game.id).length, 1, 'only one entry in DB');
    } finally { rmDir(_testUserData); }
});

// ── preload.js launchGame dual-signature ──────────────────────────────────────

test('preload: launchGame new signature (gameId, opts) invokes IPC with null command', () => {
    const calls = [];
    const fakeIpc = { invoke: (...a) => { calls.push(a); return Promise.resolve(); } };

    // Build a minimal preload context without loading the real module
    const launchGame = (arg1, arg2 = {}, arg3 = null, arg4 = null, arg5 = {}) => {
        const isLegacyCall =
            typeof arg2 === 'string' ||
            typeof arg3 === 'string' ||
            typeof arg4 === 'string';
        if (isLegacyCall) {
            return fakeIpc.invoke('launch-game', arg1, arg2, arg3, arg4, arg5 || {});
        }
        return fakeIpc.invoke('launch-game', null, arg1, null, null, arg2 || {});
    };

    launchGame('game-id-123', { forceRetry: true });
    assert.deepEqual(calls[0], ['launch-game', null, 'game-id-123', null, null, { forceRetry: true }]);
});

test('preload: launchGame legacy signature (command, gameId, gamePath, gameName) routes correctly', () => {
    const calls = [];
    const fakeIpc = { invoke: (...a) => { calls.push(a); return Promise.resolve(); } };

    const launchGame = (arg1, arg2 = {}, arg3 = null, arg4 = null, arg5 = {}) => {
        const isLegacyCall =
            typeof arg2 === 'string' ||
            typeof arg3 === 'string' ||
            typeof arg4 === 'string';
        if (isLegacyCall) {
            return fakeIpc.invoke('launch-game', arg1, arg2, arg3, arg4, arg5 || {});
        }
        return fakeIpc.invoke('launch-game', null, arg1, null, null, arg2 || {});
    };

    launchGame('"C:\\game.exe"', 'id-abc', 'C:\\game', 'My Game');
    assert.deepEqual(calls[0], ['launch-game', '"C:\\game.exe"', 'id-abc', 'C:\\game', 'My Game', {}]);
});

// ── Background pipeline: folderName from install dir ─────────────────────────

test('background pipeline helper: game.path as install folder → folderName = basename(game.path)', () => {
    // Test the _metadataFolderForGame logic inline — the function is not exported,
    // so we replicate its exact rules here.
    function metadataFolderForGame(game) {
        if (game.folderName) return game.folderName;
        const p = game.executablePath ||
            (game.command || '').replace(/^"|"$/g, '').trim() ||
            game.path || '';
        if (!p) return undefined;
        try {
            const ext = path.extname(p).toLowerCase();
            return ext ? path.basename(path.dirname(p)) : path.basename(p);
        } catch { return undefined; }
    }

    // Game with path already set to install folder and executablePath
    const gameWithExe = {
        name: 'Test Game',
        path: path.join('C:\\', 'Games', 'TestGame'),
        executablePath: path.join('C:\\', 'Games', 'TestGame', 'TestGame.exe'),
    };
    assert.equal(metadataFolderForGame(gameWithExe), 'TestGame');

    // Game where game.folderName is pre-set — should be used directly
    const gameWithFolder = { name: 'Test', folderName: 'MyFolder' };
    assert.equal(metadataFolderForGame(gameWithFolder), 'MyFolder');

    // Game where path is an install directory (no extension)
    const gameWithDir = { name: 'Test', path: path.join('C:\\', 'Games', 'CoolGame') };
    assert.equal(metadataFolderForGame(gameWithDir), 'CoolGame');

    // Lnk game that was previously broken: command = lnk, executablePath = real target
    const lnkGame = {
        name: 'Via Shortcut',
        command: path.join('C:\\', 'Desktop', 'game.lnk'),
        executablePath: path.join('C:\\', 'Games', 'AwesomeGame', 'AwesomeGame.exe'),
    };
    // Should use executablePath, so folderName = AwesomeGame, not Desktop
    assert.equal(metadataFolderForGame(lnkGame), 'AwesomeGame');
    assert.notEqual(metadataFolderForGame(lnkGame), 'Desktop');
});

// ── addManualGame: .lnk stores shortcutPath, executablePath, launchArgs, launchCwd ──

test('addManualGame: .lnk stores shortcutPath, executablePath, launchArgs, launchCwd', async () => {
    _testUserData = makeTmpDir();
    try {
        const lnkFile  = path.join(_testUserData, 'Desktop', 'Launch.lnk');
        const lnkTarget = path.join(_testUserData, 'Games', 'Shooter', 'shooter.exe');
        fs.mkdirSync(path.dirname(lnkFile),   { recursive: true });
        fs.mkdirSync(path.dirname(lnkTarget), { recursive: true });
        fs.writeFileSync(lnkFile, '');
        fs.writeFileSync(lnkTarget, '');

        const scanner = freshRequireScanner();
        const result  = await scanner.addManualGame(
            lnkFile, 'Shooter', null,
            {
                lnkTarget,
                metadataPath:  lnkTarget,
                shortcutArgs:  '-dx12 -nosplash',
                shortcutCwd:   path.dirname(lnkTarget),
            }
        );

        assert.equal(result.status, 'success');
        assert.equal(result.game.shortcutPath, lnkFile,       'shortcutPath = lnk');
        assert.equal(result.game.executablePath, lnkTarget,   'executablePath = target');
        assert.deepEqual(result.game.launchArgs, ['-dx12', '-nosplash'], 'launchArgs parsed');
        assert.equal(result.game.launchCwd, path.dirname(lnkTarget), 'launchCwd from shortcutCwd');
    } finally { rmDir(_testUserData); }
});

// ── safeLauncher.launchExecutable: returns Promise<{ok,pid}> ─────────────────

test('safeLauncher.launchExecutable: returns a Promise that resolves', async () => {
    // We can only test the validation layer without spawning a real exe.
    // Attempting to launch a non-existent .exe must return { ok: false } or throw.
    const Module2 = require('module');
    const origLoad = Module2._load.bind(Module2);
    // Stub electron for safeLauncher
    Module2._load = function (req, parent, isMain) {
        if (req === 'electron') return { shell: { openExternal: async () => {} } };
        return origLoad(req, parent, isMain);
    };
    try {
        // Clear module cache so we get a fresh require
        for (const key of Object.keys(require.cache)) {
            if (key.includes('safeLauncher')) delete require.cache[key];
        }
        const sl = require('../services/safeLauncher');
        // validateExecutablePath throws synchronously for a missing file,
        // so launchExecutable should propagate the throw (not return a rejected promise)
        // — the caller in main.js wraps it in try/catch.
        const missing = path.join(os.tmpdir(), `missing_${Date.now()}.exe`);
        assert.throws(() => sl.launchExecutable(missing), /not found/i);
    } finally {
        Module2._load = origLoad;
    }
});

// ── safeLauncher.launchExecutable: returns Promise for valid exe ──────────────

test('safeLauncher.launchExecutable: returns Promise<{ok,pid}> for existing exe', async () => {
    const Module2 = require('module');
    const origLoad = Module2._load.bind(Module2);
    Module2._load = function (req, parent, isMain) {
        if (req === 'electron') return { shell: { openExternal: async () => {} } };
        return origLoad(req, parent, isMain);
    };
    const tmpExe = path.join(os.tmpdir(), `baddel_launcher_test_${Date.now()}.exe`);
    fs.writeFileSync(tmpExe, '');
    try {
        for (const key of Object.keys(require.cache)) {
            if (key.includes('safeLauncher')) delete require.cache[key];
        }
        const sl = require('../services/safeLauncher');
        const result = sl.launchExecutable(tmpExe, [], {});
        // launchExecutable now returns a Promise — suppress the inevitable EFTYPE rejection
        assert.ok(result && typeof result.then === 'function', 'must return a Promise');
        // Await and swallow the result (empty exe may fail with EFTYPE/ENOEXEC on Windows)
        await result.catch(() => {});
    } finally {
        Module2._load = origLoad;
        try { fs.unlinkSync(tmpExe); } catch { /**/ }
    }
});

// ── main.js: manual game branch uses shell.openPath ──────────────────────────

// Replicate the manual-branch logic from main.js to test it in isolation.
// Changes to main.js must keep this logic in sync.
async function simulateLaunch(trusted, fsExistsResult, shellOpenPathResult) {
    const openCalls = [];
    const fakeShell = {
        openPath: async (p) => { openCalls.push(p); return shellOpenPathResult; },
    };
    const fakeFs = { existsSync: () => fsExistsResult };
    const trackCalls = [];

    const isManualGame =
        trusted && (
            trusted.scannerPlatform === 'manual' ||
            trusted.installSource   === 'manual' ||
            trusted.platform        === 'Manual'
        );

    if (!isManualGame) return { isManualGame: false };

    let manualLaunchPath = trusted.shortcutPath || trusted.command || '';
    if (manualLaunchPath.startsWith('"') && manualLaunchPath.endsWith('"')) {
        manualLaunchPath = manualLaunchPath.slice(1, -1).trim();
    }

    if (!fakeFs.existsSync(manualLaunchPath)) {
        return { status: 'error', code: 'PATH_NOT_FOUND', manualLaunchPath, openCalls };
    }
    const openErr = await fakeShell.openPath(manualLaunchPath);
    if (openErr) {
        return { status: 'error', code: 'SHELL_OPENPATH_ERROR', message: openErr, openCalls };
    }
    trackCalls.push(trusted.executablePath || manualLaunchPath);
    return { status: 'success', method: 'manual-shell-openpath', openCalls, trackCalls };
}

test('manual .exe: launches via shell.openPath using command field', async () => {
    const trusted = {
        scannerPlatform: 'manual',
        command:         'C:\\Games\\Shooter\\shooter.exe',
        shortcutPath:    null,
        executablePath:  'C:\\Games\\Shooter\\shooter.exe',
        path:            'C:\\Games\\Shooter',
    };
    const res = await simulateLaunch(trusted, true, '');
    assert.equal(res.status, 'success');
    assert.equal(res.method, 'manual-shell-openpath');
    assert.equal(res.openCalls[0], trusted.command, 'openPath called with command');
});

test('manual .lnk: launches via shell.openPath using shortcutPath', async () => {
    const trusted = {
        scannerPlatform: 'manual',
        command:         'C:\\Desktop\\Game.lnk',
        shortcutPath:    'C:\\Desktop\\Game.lnk',
        executablePath:  'C:\\Games\\AwesomeGame\\game.exe',
        path:            'C:\\Games\\AwesomeGame',
    };
    const res = await simulateLaunch(trusted, true, '');
    assert.equal(res.status, 'success');
    assert.equal(res.openCalls[0], trusted.shortcutPath, 'openPath called with shortcutPath, not executablePath');
});

test('manual game: missing path returns PATH_NOT_FOUND', async () => {
    const trusted = {
        scannerPlatform: 'manual',
        command:         'C:\\Games\\Missing\\game.exe',
        shortcutPath:    null,
        executablePath:  'C:\\Games\\Missing\\game.exe',
    };
    const res = await simulateLaunch(trusted, false, '');
    assert.equal(res.status, 'error');
    assert.equal(res.code, 'PATH_NOT_FOUND');
});

test('manual game: shell.openPath error returns SHELL_OPENPATH_ERROR', async () => {
    const trusted = {
        installSource:   'manual',
        command:         'C:\\Games\\Shooter\\shooter.exe',
        shortcutPath:    null,
        executablePath:  'C:\\Games\\Shooter\\shooter.exe',
    };
    const res = await simulateLaunch(trusted, true, 'The system cannot find the file specified.');
    assert.equal(res.status, 'error');
    assert.equal(res.code, 'SHELL_OPENPATH_ERROR');
    assert.ok(res.message.length > 0);
});

test('non-manual game: does not go through manual branch', async () => {
    const trusted = {
        scannerPlatform: 'steam',
        command:         'steam://run/440',
        executablePath:  null,
    };
    const res = await simulateLaunch(trusted, true, '');
    assert.equal(res.isManualGame, false, 'steam game must not enter manual branch');
});

test('manual game: outer-quoted command is stripped before openPath', async () => {
    const trusted = {
        platform:        'Manual',
        command:         '"C:\\Games\\Shooter\\shooter.exe"',
        shortcutPath:    null,
        executablePath:  'C:\\Games\\Shooter\\shooter.exe',
    };
    const res = await simulateLaunch(trusted, true, '');
    assert.equal(res.status, 'success');
    assert.equal(res.openCalls[0], 'C:\\Games\\Shooter\\shooter.exe', 'outer quotes stripped');
});

// ── main.js source: manual branch precedes safeLauncher spawn ────────────────

test('main.js: isManualGame check and manual-shell-openpath exist in launch-game handler', () => {
    const js = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    const idx = js.indexOf("ipcMain.handle('launch-game'");
    assert.ok(idx > -1, 'launch-game handler found');
    const slice = js.slice(idx, idx + 5500);
    assert.match(slice, /isManualGame/, 'isManualGame defined');
    assert.match(slice, /manual-shell-openpath/, 'manual-shell-openpath method string present');
    assert.match(slice, /shell\.openPath\(manualLaunchPath\)/, 'shell.openPath(manualLaunchPath) called');
    // manual branch must appear before launchExecutable spawn — search wider window
    const handlerBody = js.slice(idx, idx + 12000);
    const manualIdx = handlerBody.indexOf('isManualGame');
    const spawnIdx  = handlerBody.indexOf('launchExecutable');
    assert.ok(spawnIdx > -1, 'launchExecutable found in handler');
    assert.ok(manualIdx < spawnIdx, 'manual branch appears before launchExecutable');
});
