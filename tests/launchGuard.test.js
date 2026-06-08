'use strict';
// Safety tests for launch-game and launcher:open-install-url IPC handlers.
// These tests lock in the behavioral contracts — in-flight guards, trust boundary,
// branch routing, and shared helpers — so that future extraction cannot silently
// break launch safety or the protocol dispatch logic.
// All tests are source-level: no Electron process is started.

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT    = path.resolve(__dirname, '..');
const MAIN_JS = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
const SAFE_LAUNCHER_JS = fs.readFileSync(
    path.join(ROOT, 'services', 'safeLauncher.js'), 'utf8'
);

// ── Slice anchors ─────────────────────────────────────────────────────────────

const launchHandlerStart = MAIN_JS.indexOf("ipcMain.handle('launch-game'");
assert.ok(launchHandlerStart !== -1, "launch-game handler must exist in main.js");
// 16 000 chars covers the full ~310-line handler on Windows CRLF line endings.
const LAUNCH_SRC = MAIN_JS.slice(launchHandlerStart, launchHandlerStart + 16000);

const installHandlerStart = MAIN_JS.indexOf("ipcMain.handle('launcher:open-install-url'");
assert.ok(installHandlerStart !== -1, "launcher:open-install-url handler must exist in main.js");
// 9 000 chars covers the ~163-line handler.
const INSTALL_SRC = MAIN_JS.slice(installHandlerStart, installHandlerStart + 9000);

const protocolReliableStart = MAIN_JS.indexOf('async function _openProtocolUrlReliable(');
assert.ok(protocolReliableStart !== -1, '_openProtocolUrlReliable must exist in main.js');
const PROTOCOL_SRC = MAIN_JS.slice(protocolReliableStart, protocolReliableStart + 1200);

const launcherRunningStart = MAIN_JS.indexOf('async function _launcherIsRunning(');
assert.ok(launcherRunningStart !== -1, '_launcherIsRunning must exist in main.js');
const LAUNCHER_RUNNING_SRC = MAIN_JS.slice(launcherRunningStart, launcherRunningStart + 400);

const regQueryStart = MAIN_JS.indexOf('async function _regQueryValue(');
assert.ok(regQueryStart !== -1, '_regQueryValue must exist in main.js');
const REG_QUERY_SRC = MAIN_JS.slice(regQueryStart, regQueryStart + 800);

// ─── 1. launch-game — in-flight guard ────────────────────────────────────────

test('launch-game: _launchInFlight.has(launchKey) appears before _launchInFlight.add(launchKey)', () => {
    const hasIdx = LAUNCH_SRC.indexOf('_launchInFlight.has(launchKey)');
    const addIdx = LAUNCH_SRC.indexOf('_launchInFlight.add(launchKey)');
    assert.ok(hasIdx !== -1, '_launchInFlight.has(launchKey) must exist in handler');
    assert.ok(addIdx !== -1, '_launchInFlight.add(launchKey) must exist in handler');
    assert.ok(hasIdx < addIdx, 'has() guard check must precede add() to prevent duplicate dispatches');
});

test('launch-game: _launchInFlight.delete(launchKey) is wrapped in setTimeout (not in a finally block)', () => {
    // Deletion is intentionally delayed so a second IPC call arriving within the
    // window still sees the key as in-flight. It must NOT be in a finally.
    const deleteInTimeout = 'setTimeout(() => _launchInFlight.delete(launchKey)';
    assert.ok(
        LAUNCH_SRC.includes(deleteInTimeout),
        '_launchInFlight.delete must be wrapped in setTimeout, not a finally block'
    );
});

test('launch-game: Epic protocol launch uses 70000 ms in-flight lock window', () => {
    assert.match(
        LAUNCH_SRC,
        /setTimeout\(\s*\(\s*\)\s*=>\s*_launchInFlight\.delete\(launchKey\)\s*,\s*isEpic\s*\?\s*70000/
    );
});

test('launch-game: non-Epic protocol launch uses 5000 ms in-flight lock window', () => {
    assert.match(
        LAUNCH_SRC,
        /setTimeout\(\s*\(\s*\)\s*=>\s*_launchInFlight\.delete\(launchKey\)\s*,\s*isEpic\s*\?\s*70000\s*:\s*5000/
    );
});

// ─── 2. launch-game — trust boundary ─────────────────────────────────────────

test('launch-game: getSavedGames() is called inside the gameId truthy branch', () => {
    const gameIdIdx = LAUNCH_SRC.indexOf('if (gameId)');
    assert.ok(gameIdIdx !== -1, 'gameId guard (if (gameId)) must exist in handler');
    const gameIdBlock = LAUNCH_SRC.slice(gameIdIdx, gameIdIdx + 250);
    assert.match(gameIdBlock, /getSavedGames\(\)/);
});

test('launch-game: returns GAME_NOT_FOUND when gameId is not found in the DB', () => {
    assert.match(LAUNCH_SRC, /code:\s*'GAME_NOT_FOUND'/);
});

test('launch-game: returns INVALID_COMMAND for empty or non-string command', () => {
    assert.match(LAUNCH_SRC, /typeof command !== 'string'/);
    assert.match(LAUNCH_SRC, /code:\s*'INVALID_COMMAND'/);
});

// ─── 3. launch-game — branch routing ─────────────────────────────────────────

test('launch-game: manual game branch uses shell.openPath (never spawn)', () => {
    // Anchor on the if-block, not the const declaration, so the slice starts closer
    // to the shell.openPath call. 2000 chars comfortably covers the path-not-found
    // guard plus the openPath call on CRLF line endings.
    const manualIdx = LAUNCH_SRC.indexOf('if (isManualGame)');
    assert.ok(manualIdx !== -1, 'isManualGame check must exist in handler');
    const manualBlock = LAUNCH_SRC.slice(manualIdx, manualIdx + 2000);
    assert.match(manualBlock, /shell\.openPath\(manualLaunchPath\)/);
    assert.ok(
        !manualBlock.includes('launchExecutable'),
        'manual game branch must not call launchExecutable'
    );
});

test('launch-game: Xbox/UWP branch calls _extractAppsFolderLaunchTarget before _launchAppsFolderTarget', () => {
    const extractIdx = LAUNCH_SRC.indexOf('_extractAppsFolderLaunchTarget(');
    const launchIdx  = LAUNCH_SRC.indexOf('_launchAppsFolderTarget(');
    assert.ok(extractIdx !== -1, '_extractAppsFolderLaunchTarget must exist in handler');
    assert.ok(launchIdx  !== -1, '_launchAppsFolderTarget must exist in handler');
    assert.ok(extractIdx < launchIdx, '_extractAppsFolderLaunchTarget must precede _launchAppsFolderTarget');
});

test('launch-game: protocol URL branch calls _getExternalLauncherInfo(platformKey) for steam/epic', () => {
    const protocolIdx = LAUNCH_SRC.indexOf("cleanCmd.includes('://')");
    assert.ok(protocolIdx !== -1, "cleanCmd.includes('://') protocol branch must exist");
    // _getExternalLauncherInfo is called ~37 lines after the protocol branch opener;
    // 2200 chars covers that distance safely with CRLF line endings.
    const protocolBlock = LAUNCH_SRC.slice(protocolIdx, protocolIdx + 2200);
    assert.match(protocolBlock, /_getExternalLauncherInfo\(platformKey\)/);
});

test('launch-game: Epic protocol branch dispatches via _openEpicPlayUrlWithColdStartRecovery', () => {
    assert.match(
        LAUNCH_SRC,
        /_openEpicPlayUrlWithColdStartRecovery\(cleanCmd,\s*wasRunning\)/
    );
});

test('launch-game: .lnk branch uses shell.openPath', () => {
    const lnkIdx = LAUNCH_SRC.indexOf("ext === '.lnk'");
    assert.ok(lnkIdx !== -1, ".lnk branch must exist in handler");
    const lnkBlock = LAUNCH_SRC.slice(lnkIdx, lnkIdx + 300);
    assert.match(lnkBlock, /shell\.openPath\(/);
});

test('launch-game: .exe branch uses safeLauncher.launchExecutable', () => {
    const exeIdx = LAUNCH_SRC.indexOf("ext === '.exe'");
    assert.ok(exeIdx !== -1, ".exe branch must exist in handler");
    // safeLauncher.launchExecutable appears ~13 lines into the .exe block; 900 chars
    // covers the spawnArgs + spawnCwd setup that precedes it on CRLF line endings.
    const exeBlock = LAUNCH_SRC.slice(exeIdx, exeIdx + 900);
    assert.match(exeBlock, /safeLauncher\.launchExecutable\(/);
});

test('safeLauncher.launchExecutable spawns with shell: false (never shell: true)', () => {
    const launchExeIdx = SAFE_LAUNCHER_JS.indexOf('function launchExecutable(');
    assert.ok(launchExeIdx !== -1, 'launchExecutable must exist in services/safeLauncher.js');
    const launchExeBlock = SAFE_LAUNCHER_JS.slice(launchExeIdx, launchExeIdx + 800);
    assert.match(launchExeBlock, /shell:\s*false/);
    assert.ok(
        !launchExeBlock.includes('shell: true'),
        'launchExecutable must never use shell: true'
    );
});

// ─── 4. launcher:open-install-url — contract ─────────────────────────────────

test('launcher:open-install-url: ALLOWED_PLATFORMS is [\'steam\', \'epic\']', () => {
    assert.match(INSTALL_SRC, /ALLOWED_PLATFORMS\s*=\s*\[\s*'steam'\s*,\s*'epic'\s*\]/);
});

test('launcher:open-install-url: rejects platforms not in ALLOWED_PLATFORMS', () => {
    assert.match(INSTALL_SRC, /ALLOWED_PLATFORMS\.includes\(platform\)/);
    // The rejection branch must produce an error result
    assert.match(INSTALL_SRC, /Unsupported platform:/);
});

test('launcher:open-install-url: validates installUrl prefix against PROTOCOL_MAP[platform]', () => {
    assert.match(INSTALL_SRC, /installUrl\.startsWith\(PROTOCOL_MAP\[platform\]\)/);
});

test('launcher:open-install-url: _installInFlight.has(key) checked before _installInFlight.add(key)', () => {
    const hasIdx = INSTALL_SRC.indexOf('_installInFlight.has(key)');
    const addIdx = INSTALL_SRC.indexOf('_installInFlight.add(key)');
    assert.ok(hasIdx !== -1, '_installInFlight.has(key) must exist in install handler');
    assert.ok(addIdx !== -1, '_installInFlight.add(key) must exist in install handler');
    assert.ok(hasIdx < addIdx, 'has() must precede add() to guard against duplicate install dispatches');
});

test('launcher:open-install-url: _installInFlight.delete(key) is in the finally block', () => {
    const finallyIdx = INSTALL_SRC.lastIndexOf('finally');
    assert.ok(finallyIdx !== -1, 'finally block must exist in install handler');
    const finallyBlock = INSTALL_SRC.slice(finallyIdx, finallyIdx + 100);
    assert.match(finallyBlock, /_installInFlight\.delete\(key\)/);
});

test('launcher:open-install-url: Epic branch dispatches via _openEpicInstallUrlWithColdStartRecovery', () => {
    assert.match(
        INSTALL_SRC,
        /_openEpicInstallUrlWithColdStartRecovery\(effectiveInstallUrl,\s*wasRunning\)/
    );
});

test('launcher:open-install-url: Steam store fallback (steam://store/) is guarded by fallbackToStore flag', () => {
    const storeUrlIdx = INSTALL_SRC.indexOf('steam://store/');
    assert.ok(storeUrlIdx !== -1, 'steam://store/ fallback URL must exist in install handler');
    // The guard must appear before the store URL in the source so the fallback
    // is conditional — it must not fire unconditionally for every Steam install.
    const guardIdx = INSTALL_SRC.lastIndexOf('fallbackToStore', storeUrlIdx);
    assert.ok(
        guardIdx !== -1 && guardIdx < storeUrlIdx,
        'steam://store/ URL must be inside a fallbackToStore conditional'
    );
});

test('launcher:open-install-url: success result contains required contract fields', () => {
    // The main success return must include all fields callers depend on.
    const successIdx = INSTALL_SRC.lastIndexOf('return { ok: true');
    assert.ok(successIdx !== -1, 'success return { ok: true, … } must exist');
    const successBlock = INSTALL_SRC.slice(successIdx, successIdx + 300);
    assert.match(successBlock, /\bok:\s*true\b/);
    assert.match(successBlock, /\bplatform\b/);
    assert.match(successBlock, /\binstallUrl\b/);
    assert.match(successBlock, /\battempts\b/);
    assert.match(successBlock, /\bcoldStartRetryUsed\b/);
    assert.match(successBlock, /\bfallbackStoreUsed\b/);
    assert.match(successBlock, /\bwasRunning\b/);
});

// ─── 5. Shared launch helpers ─────────────────────────────────────────────────

test('_openProtocolUrlReliable tries shell.openExternal before safeLauncher.openProtocolUrl fallback', () => {
    const openExternalIdx  = PROTOCOL_SRC.indexOf('shell.openExternal(url)');
    const safelauncherIdx  = PROTOCOL_SRC.indexOf('safeLauncher.openProtocolUrl(url)');
    assert.ok(openExternalIdx !== -1, 'shell.openExternal must be the primary attempt');
    assert.ok(safelauncherIdx !== -1, 'safeLauncher.openProtocolUrl must be the fallback');
    assert.ok(
        openExternalIdx < safelauncherIdx,
        'shell.openExternal must appear before the safeLauncher fallback'
    );
});

test('_openProtocolUrlReliable falls back to safeLauncher.openProtocolUrl on shell.openExternal failure', () => {
    // The fallback must be in a separate try block (not inside the first try).
    // Verify both appear and a catch separates them.
    const catchIdx         = PROTOCOL_SRC.indexOf('} catch');
    const safelauncherIdx  = PROTOCOL_SRC.indexOf('safeLauncher.openProtocolUrl(url)');
    assert.ok(catchIdx !== -1, 'catch block must separate the two attempts');
    assert.ok(
        catchIdx < safelauncherIdx,
        'safeLauncher fallback must appear after the first catch block'
    );
});

test('_launcherIsRunning uses dynamic import(\'ps-list\') (not require)', () => {
    assert.match(LAUNCHER_RUNNING_SRC, /import\s*\(\s*['"]ps-list['"]\s*\)/);
    assert.ok(
        !LAUNCHER_RUNNING_SRC.includes("require('ps-list')"),
        "_launcherIsRunning must use dynamic import, not require, to stay CJS-compatible with the ESM ps-list package"
    );
});

test('_regQueryValue invokes reg.exe with the query subcommand and does not use shell: true', () => {
    assert.match(REG_QUERY_SRC, /['"]reg\.exe['"]/);
    assert.match(REG_QUERY_SRC, /['"]query['"]/);
    assert.ok(!REG_QUERY_SRC.includes('shell: true'), '_regQueryValue must not use shell: true');
});

test('COLD_START_GRACE_MS is 2000 ms', () => {
    assert.match(MAIN_JS, /const\s+COLD_START_GRACE_MS\s*=\s*2000/);
});

test('ACCOUNT_SWITCH_GRACE_MS is 6000 ms', () => {
    assert.match(MAIN_JS, /const\s+ACCOUNT_SWITCH_GRACE_MS\s*=\s*6000/);
});
