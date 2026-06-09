'use strict';
const test   = require('node:test');
const assert = require('assert/strict');
const fs     = require('fs');
const path   = require('path');

const MAIN_JS          = fs.readFileSync(path.join(__dirname, '..', 'main.js'),                              'utf8');
const LAUNCH_HANDLERS_JS = fs.readFileSync(path.join(__dirname, '..', 'handlers', 'launchHandlers.js'), 'utf8');
const SCANNER_JS       = fs.readFileSync(path.join(__dirname, '..', 'gameScanner.js'),                   'utf8');

// ── _parseLaunchCommand: helper existence ─────────────────────────────────────

test('handlers/launchHandlers.js: _parseLaunchCommand function is defined', () => {
    assert.ok(LAUNCH_HANDLERS_JS.includes('function _parseLaunchCommand(raw)'));
});

// ── _parseLaunchCommand: quoted exe + args (Riot use-case) ────────────────────

test('_parseLaunchCommand: quoted exe + args returns exePath and parsedArgs', () => {
    // Extract the function source and evaluate it in isolation
    const fnStart = LAUNCH_HANDLERS_JS.indexOf('function _parseLaunchCommand(raw)');
    assert.ok(fnStart !== -1, '_parseLaunchCommand not found');
    // Grab up to the closing brace of the function
    const block = LAUNCH_HANDLERS_JS.slice(fnStart, fnStart + 1200);
    const fnEnd  = block.lastIndexOf('\n    }');
    const fnSrc  = block.slice(0, fnEnd + 6);
    const fn = new Function(`return (${fnSrc})`)();

    const input = '"C:\\\\Riot Games\\\\Riot Client\\\\RiotClientServices.exe" --launch-product=valorant --launch-patchline=live';
    const result = fn(input);
    assert.ok(result.exePath.endsWith('RiotClientServices.exe'), 'exePath should end with RiotClientServices.exe');
    assert.ok(!result.exePath.includes('--launch'), 'exePath must not contain args');
    assert.ok(result.parsedArgs.includes('--launch-product=valorant'), 'parsedArgs must include --launch-product=valorant');
    assert.ok(result.parsedArgs.includes('--launch-patchline=live'), 'parsedArgs must include --launch-patchline=live');
});

test('_parseLaunchCommand: unquoted exe + args returns exePath and parsedArgs', () => {
    const fnStart = LAUNCH_HANDLERS_JS.indexOf('function _parseLaunchCommand(raw)');
    const block   = LAUNCH_HANDLERS_JS.slice(fnStart, fnStart + 1200);
    const fnEnd   = block.lastIndexOf('\n    }');
    const fn = new Function(`return (${block.slice(0, fnEnd + 6)})`)();

    const input = 'C:\\\\Games\\\\game.exe --some-arg';
    const result = fn(input);
    assert.ok(result.exePath.endsWith('game.exe'), 'exePath should end with game.exe');
    assert.deepEqual(result.parsedArgs, ['--some-arg']);
});

test('_parseLaunchCommand: plain exe no args returns exePath and empty parsedArgs', () => {
    const fnStart = LAUNCH_HANDLERS_JS.indexOf('function _parseLaunchCommand(raw)');
    const block   = LAUNCH_HANDLERS_JS.slice(fnStart, fnStart + 1200);
    const fnEnd   = block.lastIndexOf('\n    }');
    const fn = new Function(`return (${block.slice(0, fnEnd + 6)})`)();

    const result = fn('C:\\\\Games\\\\game.exe');
    assert.ok(result.exePath.endsWith('game.exe'));
    assert.deepEqual(result.parsedArgs, []);
});

test('_parseLaunchCommand: protocol URL returns null exePath (skipped)', () => {
    const fnStart = LAUNCH_HANDLERS_JS.indexOf('function _parseLaunchCommand(raw)');
    const block   = LAUNCH_HANDLERS_JS.slice(fnStart, fnStart + 1200);
    const fnEnd   = block.lastIndexOf('\n    }');
    const fn = new Function(`return (${block.slice(0, fnEnd + 6)})`)();

    assert.equal(fn('steam://rungameid/123').exePath, null);
    assert.equal(fn('com.epicgames.launcher://apps/foo').exePath, null);
    assert.equal(fn('eadesktop://mobilehome/default').exePath, null);
});

test('_parseLaunchCommand: shell: path returns null exePath (handled by Xbox branch)', () => {
    const fnStart = LAUNCH_HANDLERS_JS.indexOf('function _parseLaunchCommand(raw)');
    const block   = LAUNCH_HANDLERS_JS.slice(fnStart, fnStart + 1200);
    const fnEnd   = block.lastIndexOf('\n    }');
    const fn = new Function(`return (${block.slice(0, fnEnd + 6)})`)();

    assert.equal(fn('shell:AppsFolder\\Microsoft.JigsawPuzzle_8wekyb3d8bbwe!App').exePath, null);
});

// ── main.js: _cmdParsed used in launch-game handler ───────────────────────────

test('main.js: launch-game uses _parseLaunchCommand to compute cleanCmd', () => {
    assert.ok(LAUNCH_HANDLERS_JS.includes('_parseLaunchCommand(command)'), '_parseLaunchCommand not called in handler');
    assert.ok(
        LAUNCH_HANDLERS_JS.includes('_cmdParsed.exePath ||'),
        '_cmdParsed.exePath fallback not used for cleanCmd'
    );
});

test('main.js: Branch D uses _cmdParsed.parsedArgs as arg fallback', () => {
    const idx = LAUNCH_HANDLERS_JS.indexOf('Branch D — .exe spawn:');
    assert.ok(idx !== -1, 'Branch D not found');
    const block = LAUNCH_HANDLERS_JS.slice(idx, idx + 400);
    assert.ok(
        block.includes('_cmdParsed.parsedArgs'),
        '_cmdParsed.parsedArgs not used in Branch D'
    );
    // trusted.launchArgs must still take precedence
    assert.ok(
        block.includes('trusted?.launchArgs?.length') || block.includes("trusted?.launchArgs?.length"),
        'trusted.launchArgs precedence check missing'
    );
});

// ── main.js: EA mobilehome fallback branch ────────────────────────────────────

test('main.js: EA mobilehome fallback branch is defined', () => {
    assert.ok(
        LAUNCH_HANDLERS_JS.includes('EA mobilehome fallback') || LAUNCH_HANDLERS_JS.includes('eadesktop://mobilehome'),
        'EA mobilehome fallback not found'
    );
});

test('main.js: EA mobilehome fallback checks trusted.executablePath', () => {
    const idx = LAUNCH_HANDLERS_JS.indexOf('eadesktop://mobilehome');
    assert.ok(idx !== -1, 'eadesktop://mobilehome not found');
    const block = LAUNCH_HANDLERS_JS.slice(idx, idx + 600);
    assert.ok(block.includes('trusted?.executablePath') || block.includes('trusted.executablePath'), 'executablePath check missing');
});

test('main.js: EA mobilehome fallback uses safeLauncher.launchExecutable', () => {
    const idx = LAUNCH_HANDLERS_JS.indexOf('EA mobilehome fallback');
    assert.ok(idx !== -1, 'EA mobilehome fallback comment not found');
    const block = LAUNCH_HANDLERS_JS.slice(idx, idx + 800);
    assert.ok(block.includes('launchExecutable'), 'launchExecutable not called in EA fallback');
});

test('main.js: EA mobilehome fallback returns status:success with method:ea-exe-fallback', () => {
    const idx = LAUNCH_HANDLERS_JS.indexOf('EA mobilehome fallback');
    const block = LAUNCH_HANDLERS_JS.slice(idx, idx + 900);
    assert.ok(block.includes("status: 'success'"), "status: 'success' not returned");
    assert.ok(block.includes("method: 'ea-exe-fallback'"), "method: 'ea-exe-fallback' not returned");
});

test('main.js: EA mobilehome fallback does not use shell:true', () => {
    const idx = LAUNCH_HANDLERS_JS.indexOf('EA mobilehome fallback');
    const block = LAUNCH_HANDLERS_JS.slice(idx, idx + 900);
    assert.ok(!block.includes('shell: true') && !block.includes('shell:true'), 'shell:true must not appear');
});

test('main.js: EA mobilehome fallback runs before the protocol:// branch', () => {
    const eaIdx       = LAUNCH_HANDLERS_JS.indexOf('eadesktop://mobilehome');
    const protocolIdx = LAUNCH_HANDLERS_JS.indexOf("cleanCmd.includes('://')");
    assert.ok(eaIdx !== -1, 'EA mobilehome check not found');
    assert.ok(protocolIdx !== -1, 'protocol branch not found');
    assert.ok(eaIdx < protocolIdx, 'EA fallback must come before protocol:// branch');
});

// ── gameScanner.js: EA scanner no longer stores mobilehome/default ────────────

test('gameScanner.js: EA scanner uses eaLaunchCmd variable', () => {
    assert.ok(
        SCANNER_JS.includes('eaLaunchCmd'),
        'eaLaunchCmd variable not found in EA scanner'
    );
});

test('gameScanner.js: EA scanner rejects mobilehome URL as launch command', () => {
    const idx = SCANNER_JS.indexOf('eaLaunchCmd');
    assert.ok(idx !== -1, 'eaLaunchCmd not found');
    const block = SCANNER_JS.slice(idx, idx + 300);
    assert.ok(block.includes('mobilehome'), 'mobilehome guard not found');
});

test('gameScanner.js: EA scanner falls back to exe path when no real launch URL', () => {
    const idx = SCANNER_JS.indexOf('eaLaunchCmd');
    const block = SCANNER_JS.slice(idx, idx + 200);
    // The fallback is the exe variable
    assert.ok(block.includes(': exe'), 'exe fallback not set in eaLaunchCmd');
});

test('gameScanner.js: EA scanner stores launchCwd as exe directory', () => {
    const idx = SCANNER_JS.indexOf('_buildEAGameFromCandidate');
    assert.ok(idx !== -1, '_buildEAGameFromCandidate not found');
    const block = SCANNER_JS.slice(idx, idx + 2100);
    assert.ok(block.includes('launchCwd'), 'launchCwd not stored in EA game record');
    assert.ok(block.includes('path.dirname(exe)'), 'launchCwd not set to exe directory');
});

test('gameScanner.js: EA scanner no longer hard-codes eadesktop://mobilehome/default', () => {
    const idx = SCANNER_JS.indexOf('_buildEAGameFromCandidate');
    assert.ok(idx !== -1);
    const fnEnd = SCANNER_JS.indexOf('\n    }', idx + 1000);
    const block = SCANNER_JS.slice(idx, fnEnd > idx ? fnEnd + 6 : idx + 1600);
    // The string eadesktop://mobilehome/default must NOT appear as a direct assignment value
    assert.ok(
        !block.includes("command: `eadesktop://mobilehome/default`") &&
        !block.includes("command: 'eadesktop://mobilehome/default'") &&
        !block.includes('command: "eadesktop://mobilehome/default"'),
        'command must not be hard-coded to eadesktop://mobilehome/default'
    );
});

// ── Protocol URLs for other platforms still go through the :// branch ─────────

test('main.js: steam:// command is not intercepted by EA fallback', () => {
    // The EA fallback regex must only match eadesktop://mobilehome, not steam://
    const fnStart = LAUNCH_HANDLERS_JS.indexOf('eadesktop://mobilehome');
    const block   = LAUNCH_HANDLERS_JS.slice(fnStart - 10, fnStart + 50);
    assert.ok(block.includes('eadesktop://mobilehome'), 'EA-specific check must reference mobilehome path');
    // steam:// does not match /^eadesktop:\/\/mobilehome/
    const regexStr = block.match(/\/\^eadesktop.+?\//i)?.[0] || '';
    if (regexStr) {
        const rx = new RegExp(regexStr.slice(1, -1), 'i');
        assert.ok(!rx.test('steam://rungameid/123'), 'steam:// must not match EA mobilehome pattern');
        assert.ok( rx.test('eadesktop://mobilehome/default'), 'eadesktop://mobilehome/default must match');
    }
});
