'use strict';
const test   = require('node:test');
const assert = require('assert/strict');
const fs     = require('fs');
const path   = require('path');

const MAIN_JS            = fs.readFileSync(path.join(__dirname, '..', 'main.js'),                              'utf8');
const LAUNCH_HANDLERS_JS = fs.readFileSync(path.join(__dirname, '..', 'handlers', 'launchHandlers.js'),       'utf8');
const SCANNER_JS         = fs.readFileSync(path.join(__dirname, '..', 'gameScanner.js'),                      'utf8');
const LAUNCHER_JS        = fs.readFileSync(path.join(__dirname, '..', 'services', 'safeLauncher.js'),         'utf8');
const PLAY_JS            = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'play-launcher.js'),       'utf8');

// ── gameScanner.js Xbox record fields ─────────────────────────────────────────

test('gameScanner: Xbox records store launchType uwp-appsfolder', () => {
    assert.ok(
        SCANNER_JS.includes("launchType:      'uwp-appsfolder'") ||
        SCANNER_JS.includes('launchType: "uwp-appsfolder"') ||
        SCANNER_JS.includes("launchType:'uwp-appsfolder'"),
        "launchType: 'uwp-appsfolder' not found in Xbox scanner map"
    );
});

test('gameScanner: Xbox records store appUserModelId ending with !App', () => {
    const idx = SCANNER_JS.indexOf('appUserModelId');
    assert.ok(idx !== -1, 'appUserModelId not found in gameScanner.js');
    const block = SCANNER_JS.slice(idx, idx + 200);
    assert.ok(block.includes('!App'), 'appUserModelId does not include !App');
});

test('gameScanner: Xbox records command starts with shell:AppsFolder\\', () => {
    const idx = SCANNER_JS.indexOf("command:         appsFolderTarget");
    assert.ok(idx !== -1, 'command: appsFolderTarget not found in Xbox scanner map');
});

test('gameScanner: Xbox appsFolderTarget uses shell:AppsFolder\\ prefix', () => {
    assert.ok(
        SCANNER_JS.includes('shell:AppsFolder\\\\'),
        'shell:AppsFolder\\ not found in Xbox scanner section'
    );
});

test('gameScanner: Xbox records store launchCommand matching command', () => {
    const idx = SCANNER_JS.indexOf('appsFolderTarget');
    assert.ok(idx !== -1, 'appsFolderTarget not found');
    const block = SCANNER_JS.slice(idx, idx + 1200);
    const cmdCount = (block.match(/appsFolderTarget/g) || []).length;
    assert.ok(cmdCount >= 2, 'appsFolderTarget should appear for both command and launchCommand');
});

// ── main.js: _extractAppsFolderLaunchTarget ───────────────────────────────────

test('main.js: _extractAppsFolderLaunchTarget function defined', () => {
    assert.ok(
        LAUNCH_HANDLERS_JS.includes('function _extractAppsFolderLaunchTarget('),
        '_extractAppsFolderLaunchTarget not defined'
    );
});

test('main.js: _extractAppsFolderLaunchTarget handles old explorer.exe format', () => {
    const idx = LAUNCH_HANDLERS_JS.indexOf('function _extractAppsFolderLaunchTarget(');
    const block = LAUNCH_HANDLERS_JS.slice(idx, idx + 800);
    assert.ok(
        block.includes('explorer') && block.includes('shell:AppsFolder'),
        'Old explorer.exe format not handled'
    );
});

test('main.js: _extractAppsFolderLaunchTarget handles new shell:AppsFolder format', () => {
    const idx = LAUNCH_HANDLERS_JS.indexOf('function _extractAppsFolderLaunchTarget(');
    const block = LAUNCH_HANDLERS_JS.slice(idx, idx + 800);
    assert.ok(block.includes('shell:AppsFolder'), 'shell:AppsFolder not handled');
});

test('main.js: _extractAppsFolderLaunchTarget handles raw AUMID (PackageFamilyName!App)', () => {
    const idx = LAUNCH_HANDLERS_JS.indexOf('function _extractAppsFolderLaunchTarget(');
    const block = LAUNCH_HANDLERS_JS.slice(idx, idx + 800);
    assert.ok(block.includes('!App') || block.includes('AUMID') || block.includes('Raw AUMID'), 'Raw AUMID case not handled');
});

// ── main.js: _launchAppsFolderTarget ─────────────────────────────────────────

test('main.js: _launchAppsFolderTarget function defined', () => {
    assert.ok(LAUNCH_HANDLERS_JS.includes('function _launchAppsFolderTarget('));
});

test('main.js: _launchAppsFolderTarget uses spawn with shell:false', () => {
    const idx = LAUNCH_HANDLERS_JS.indexOf('function _launchAppsFolderTarget(');
    const block = LAUNCH_HANDLERS_JS.slice(idx, idx + 800);
    assert.ok(block.includes("spawn('explorer.exe'"), "spawn('explorer.exe') not found");
    assert.ok(block.includes('shell:       false') || block.includes("shell: false"), 'shell: false not set');
});

test('main.js: _launchAppsFolderTarget does not use shell:true', () => {
    const idx = LAUNCH_HANDLERS_JS.indexOf('function _launchAppsFolderTarget(');
    const block = LAUNCH_HANDLERS_JS.slice(idx, idx + 800);
    assert.ok(!block.includes('shell: true') && !block.includes('shell:true'), 'shell: true must not be used');
});

test('main.js: _launchAppsFolderTarget resolves { ok: true } on spawn', () => {
    const idx = LAUNCH_HANDLERS_JS.indexOf('function _launchAppsFolderTarget(');
    const block = LAUNCH_HANDLERS_JS.slice(idx, idx + 800);
    assert.ok(block.includes("ok: true"), "{ ok: true } not resolved on spawn");
});

test('main.js: _launchAppsFolderTarget resolves { ok: false } on error', () => {
    const idx = LAUNCH_HANDLERS_JS.indexOf('function _launchAppsFolderTarget(');
    const block = LAUNCH_HANDLERS_JS.slice(idx, idx + 800);
    assert.ok(block.includes("ok: false"), "{ ok: false } not resolved on error");
});

// ── main.js: Xbox/UWP branch in launch-game ──────────────────────────────────

test('main.js: Xbox/UWP branch present in launch-game', () => {
    assert.ok(
        LAUNCH_HANDLERS_JS.includes('Branch Xbox/UWP'),
        'Xbox/UWP branch log line not found in launch-game'
    );
});

test('main.js: Xbox/UWP branch calls _extractAppsFolderLaunchTarget', () => {
    const idx = LAUNCH_HANDLERS_JS.indexOf('Branch Xbox/UWP');
    assert.ok(idx !== -1, 'Branch Xbox/UWP not found');
    // Assignment is right after the comment line; scan comment + following block
    const block = LAUNCH_HANDLERS_JS.slice(idx, idx + 500);
    assert.ok(block.includes('_extractAppsFolderLaunchTarget'), '_extractAppsFolderLaunchTarget not called');
});

test('main.js: Xbox/UWP branch calls _launchAppsFolderTarget', () => {
    const idx = LAUNCH_HANDLERS_JS.indexOf('Branch Xbox/UWP');
    const block = LAUNCH_HANDLERS_JS.slice(idx, idx + 600);
    assert.ok(block.includes('_launchAppsFolderTarget'), '_launchAppsFolderTarget not called in branch');
});

test('main.js: Xbox/UWP branch returns status:success with method:xbox-appsfolder', () => {
    const idx = LAUNCH_HANDLERS_JS.indexOf('Branch Xbox/UWP');
    const block = LAUNCH_HANDLERS_JS.slice(idx, idx + 1400);
    assert.ok(block.includes("status: 'success'"), "status: 'success' not returned");
    assert.ok(block.includes("method: 'xbox-appsfolder'"), "method: 'xbox-appsfolder' not returned");
});

test('main.js: Xbox/UWP branch runs before protocol:// branch', () => {
    const xboxIdx    = LAUNCH_HANDLERS_JS.indexOf('Branch Xbox/UWP');
    const protocolIdx = LAUNCH_HANDLERS_JS.indexOf("cleanCmd.includes('://')");
    assert.ok(xboxIdx !== -1,    'Xbox/UWP branch not found');
    assert.ok(protocolIdx !== -1, 'protocol branch not found');
    assert.ok(xboxIdx < protocolIdx, 'Xbox/UWP branch must come before protocol:// branch');
});

test('main.js: Xbox/UWP branch calls startGameTracking', () => {
    const idx = LAUNCH_HANDLERS_JS.indexOf('Branch Xbox/UWP');
    const block = LAUNCH_HANDLERS_JS.slice(idx, idx + 800);
    assert.ok(block.includes('startGameTracking'), 'startGameTracking not called in Xbox branch');
});

test('main.js: Xbox/UWP branch does not pass to safeLauncher.openProtocolUrl', () => {
    const idx = LAUNCH_HANDLERS_JS.indexOf('Branch Xbox/UWP');
    const block = LAUNCH_HANDLERS_JS.slice(idx, idx + 800);
    assert.ok(!block.includes('openProtocolUrl'), 'openProtocolUrl must not be called in Xbox branch');
});

// ── safeLauncher.js: launchExecutable contract ────────────────────────────────

test('safeLauncher: launchExecutable returns Promise<{ok,pid}>', () => {
    assert.ok(
        LAUNCHER_JS.includes("resolve({ ok: true, pid: child.pid })"),
        "{ ok: true, pid } not resolved"
    );
});

test('safeLauncher: launchExecutable returns {ok:false,error} on spawn error', () => {
    assert.ok(
        LAUNCHER_JS.includes("resolve({ ok: false, error: err })") ||
        LAUNCHER_JS.includes("resolve({ ok: false, error: syncErr })"),
        "{ ok: false, error } not resolved on error"
    );
});

test('safeLauncher: launchExecutable uses once(spawn) not on(spawn)', () => {
    assert.ok(
        LAUNCHER_JS.includes("child.once('spawn'"),
        "child.once('spawn') not found — should use once not on"
    );
});

test('safeLauncher: launchExecutable has 1200ms timeout fallback', () => {
    assert.ok(
        LAUNCHER_JS.includes('1200'),
        '1200ms timeout fallback not found in launchExecutable'
    );
});

test('safeLauncher: launchExecutable settled guard prevents double-resolve', () => {
    assert.ok(
        LAUNCHER_JS.includes('settled'),
        'settled guard not found in launchExecutable'
    );
});

// ── play-launcher.js: improved error logging ──────────────────────────────────

test('play-launcher: logs launchRes diagnostics on status:error', () => {
    assert.ok(
        PLAY_JS.includes("console.error('[PlayLauncher] Launch failed:'") ||
        PLAY_JS.includes('console.error("[PlayLauncher] Launch failed:"'),
        '[PlayLauncher] Launch failed: log not found'
    );
});

test('play-launcher: logs error in catch block', () => {
    assert.ok(
        PLAY_JS.includes("console.error('[PlayLauncher] Error starting game:'") ||
        PLAY_JS.includes('console.error("[PlayLauncher] Error starting game:"'),
        '[PlayLauncher] Error starting game: catch log not found'
    );
});

test('play-launcher: toast message is still Error starting game!', () => {
    assert.ok(
        PLAY_JS.includes("'Error starting game!'"),
        "User-facing toast 'Error starting game!' not found"
    );
});
