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
const LAUNCH_HANDLERS_JS = fs.readFileSync(path.join(ROOT, 'handlers', 'launchHandlers.js'), 'utf8');
const SAFE_LAUNCHER_JS = fs.readFileSync(
    path.join(ROOT, 'services', 'safeLauncher.js'), 'utf8'
);
const { buildExecutableLaunchArgs } = require('../handlers/launchHandlers');

// ── Slice anchors ─────────────────────────────────────────────────────────────

const launchHandlerStart = LAUNCH_HANDLERS_JS.indexOf("ipcMain.handle('launch-game'");
assert.ok(launchHandlerStart !== -1, "launch-game handler must exist in handlers/launchHandlers.js");
// 16 000 chars covers the full ~310-line handler on Windows CRLF line endings.
const LAUNCH_SRC = LAUNCH_HANDLERS_JS.slice(launchHandlerStart, launchHandlerStart + 16000);

const installHandlerStart = LAUNCH_HANDLERS_JS.indexOf("ipcMain.handle('launcher:open-install-url'");
assert.ok(installHandlerStart !== -1, "launcher:open-install-url handler must exist in handlers/launchHandlers.js");
// 9 000 chars covers the ~163-line handler.
const INSTALL_SRC = LAUNCH_HANDLERS_JS.slice(installHandlerStart, installHandlerStart + 9000);

const protocolReliableStart = LAUNCH_HANDLERS_JS.indexOf('async function _openProtocolUrlReliable(');
assert.ok(protocolReliableStart !== -1, '_openProtocolUrlReliable must exist in handlers/launchHandlers.js');
const PROTOCOL_SRC = LAUNCH_HANDLERS_JS.slice(protocolReliableStart, protocolReliableStart + 1200);

const launcherRunningStart = LAUNCH_HANDLERS_JS.indexOf('async function _launcherIsRunning(');
assert.ok(launcherRunningStart !== -1, '_launcherIsRunning must exist in handlers/launchHandlers.js');
const LAUNCHER_RUNNING_SRC = LAUNCH_HANDLERS_JS.slice(launcherRunningStart, launcherRunningStart + 400);

const regQueryStart = LAUNCH_HANDLERS_JS.indexOf('async function _regQueryValue(');
assert.ok(regQueryStart !== -1, '_regQueryValue must exist in handlers/launchHandlers.js');
const REG_QUERY_SRC = LAUNCH_HANDLERS_JS.slice(regQueryStart, regQueryStart + 800);

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

test('launch-game: protocol URL branch calls _getExternalLauncherInfo(platformKey) for official launchers', () => {
    const protocolIdx = LAUNCH_SRC.indexOf("cleanCmd.includes('://')");
    assert.ok(protocolIdx !== -1, "cleanCmd.includes('://') protocol branch must exist");
    // _getExternalLauncherInfo is called ~37 lines after the protocol branch opener;
    // 2200 chars covers that distance safely with CRLF line endings.
    const protocolBlock = LAUNCH_SRC.slice(protocolIdx, protocolIdx + 3000);
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
    const exeBlock = LAUNCH_SRC.slice(exeIdx, exeIdx + 1200);
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

test('launcher:open-install-url: allowlist includes Steam, Epic, and GOG only', () => {
    assert.match(INSTALL_SRC, /ALLOWED_PLATFORMS\s*=\s*\[\s*'steam'\s*,\s*'epic'\s*,\s*'gog'\s*\]/);
});

test('launcher:open-install-url: GOG accepts only exact numeric product-view URLs', () => {
    assert.match(INSTALL_SRC, /gogGalaxyProtocol\.isProductViewUrl\(installUrl\)/);
    assert.match(INSTALL_SRC, /GOG_INSTALL_URL_INVALID/);
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
    assert.match(LAUNCH_HANDLERS_JS, /const\s+COLD_START_GRACE_MS\s*=\s*2000/);
});

test('ACCOUNT_SWITCH_GRACE_MS is 6000 ms', () => {
    assert.match(LAUNCH_HANDLERS_JS, /const\s+ACCOUNT_SWITCH_GRACE_MS\s*=\s*6000/);
});

// ─── 6. startGameTracking — internal contract ─────────────────────────────────

const sgtStart = MAIN_JS.indexOf('function startGameTracking(');
assert.ok(sgtStart !== -1, 'startGameTracking must exist in main.js');
// 1600 chars covers the 37-line function body on Windows CRLF line endings.
const SGT_SRC = MAIN_JS.slice(sgtStart, sgtStart + 1600);

test('startGameTracking: duplicate-entry guard is the first statement — prevents creating two trackers for the same game', () => {
    const guardIdx  = SGT_SRC.indexOf('if (activeTrackers[gameId]) return');
    const createIdx = SGT_SRC.indexOf('activeTrackers[gameId] = {');
    assert.ok(guardIdx  !== -1, 'duplicate-entry guard must exist');
    assert.ok(createIdx !== -1, 'tracker object creation must exist');
    assert.ok(guardIdx < createIdx, 'duplicate-entry guard must appear before tracker creation');
});

test('startGameTracking: timeTrackingEnabled === false permission gate appears before tracker creation', () => {
    const gateIdx   = SGT_SRC.indexOf('game.timeTrackingEnabled === false');
    const createIdx = SGT_SRC.indexOf('activeTrackers[gameId] = {');
    assert.ok(gateIdx   !== -1, 'timeTrackingEnabled === false gate must exist');
    assert.ok(gateIdx < createIdx, 'permission gate must precede tracker object creation');
});

test("startGameTracking: initial tracker state field is 'launching'", () => {
    assert.match(SGT_SRC, /state:\s*'launching'/);
});

test('startGameTracking: userLaunched parameter is stored as a field on the tracker object', () => {
    const createIdx = SGT_SRC.indexOf('activeTrackers[gameId] = {');
    const closeIdx  = SGT_SRC.indexOf('};', createIdx);
    assert.ok(createIdx !== -1, 'tracker object literal must exist');
    assert.ok(closeIdx  !== -1, 'tracker object literal closing };  must exist');
    const objectLiteral = SGT_SRC.slice(createIdx, closeIdx + 2);
    assert.match(objectLiteral, /userLaunched[,\s]/);
});

test('startGameTracking: intervalId is assigned from the setInterval return value', () => {
    assert.match(SGT_SRC, /activeTrackers\[gameId\]\.intervalId\s*=\s*setInterval\(/);
});

test('startGameTracking: setInterval uses TRACK_INTERVAL_MS as its delay argument', () => {
    const intervalIdx = SGT_SRC.indexOf('setInterval(');
    assert.ok(intervalIdx !== -1, 'setInterval must exist in startGameTracking');
    const intervalBlock = SGT_SRC.slice(intervalIdx, intervalIdx + 200);
    assert.match(intervalBlock, /TRACK_INTERVAL_MS/);
});

test('startGameTracking: setInterval callback invokes _tickTracker with all four arguments (gameId, command, gamePath, gameName)', () => {
    assert.match(SGT_SRC, /_tickTracker\(gameId,\s*command,\s*gamePath,\s*gameName\)/);
});

// ─── 7. launch-game — startGameTracking call sites ───────────────────────────

test('launch-game: manual branch calls startGameTracking after shell.openPath succeeds (openErr guard first)', () => {
    // shell.openPath returns a non-empty string on error.  startGameTracking must
    // appear AFTER the openErr early-return so it only fires on success.
    const openPathIdx = LAUNCH_SRC.indexOf('shell.openPath(manualLaunchPath)');
    assert.ok(openPathIdx !== -1, 'shell.openPath(manualLaunchPath) must exist in handler');
    // 1200 chars covers the large diagnostics-return block plus the startGameTracking
    // call ~18 lines after the openPath call on Windows CRLF line endings.
    const afterOpen = LAUNCH_SRC.slice(openPathIdx, openPathIdx + 1200);
    const openErrIdx  = afterOpen.indexOf('if (openErr)');
    const trackingIdx = afterOpen.indexOf('startGameTracking(');
    assert.ok(openErrIdx  !== -1, 'openErr guard must exist after shell.openPath');
    assert.ok(trackingIdx !== -1, 'startGameTracking must be called in the manual branch');
    assert.ok(openErrIdx < trackingIdx, 'openErr early-return must precede startGameTracking');
});

test('launch-game: EA exe fallback branch calls startGameTracking after successful spawn (failure guard first)', () => {
    const eaIdx = LAUNCH_SRC.indexOf('eadesktop://mobilehome');
    assert.ok(eaIdx !== -1, 'EA exe fallback branch must exist in handler');
    // 1300 chars covers the ~15-line EA block including extra indent from register() wrapper.
    const eaBlock = LAUNCH_SRC.slice(eaIdx, eaIdx + 1300);
    const failGuardIdx = eaBlock.indexOf('!eaResult.ok');
    const trackingIdx  = eaBlock.indexOf('startGameTracking(');
    assert.ok(failGuardIdx !== -1, '!eaResult.ok failure guard must exist');
    assert.ok(trackingIdx  !== -1, 'startGameTracking must be called in EA fallback');
    assert.ok(failGuardIdx < trackingIdx, 'failure guard must precede startGameTracking');
});

test('launch-game: protocol/lnk/exe success path calls startGameTracking inside the if (launchSuccess) block', () => {
    const launchSuccessIdx = LAUNCH_SRC.indexOf('if (launchSuccess)');
    assert.ok(launchSuccessIdx !== -1, 'if (launchSuccess) block must exist');
    const successBlock = LAUNCH_SRC.slice(launchSuccessIdx, launchSuccessIdx + 200);
    assert.match(successBlock, /startGameTracking\(/);
});

test('launch-game: .exe branch sets launchSuccess = true after safeLauncher.launchExecutable so tracking fires via the shared success path', () => {
    const exeIdx = LAUNCH_SRC.indexOf("ext === '.exe'");
    assert.ok(exeIdx !== -1, ".exe branch must exist in handler");
    // 1500 chars covers the spawnArgs + spawnCwd setup plus the launchSuccess flag
    // including extra indent from the register() wrapper.
    const exeBlock       = LAUNCH_SRC.slice(exeIdx, exeIdx + 1700);
    const spawnIdx       = exeBlock.indexOf('safeLauncher.launchExecutable(');
    const successFlagIdx = exeBlock.indexOf('launchSuccess = true');
    assert.ok(spawnIdx       !== -1, 'safeLauncher.launchExecutable must exist in .exe block');
    assert.ok(successFlagIdx !== -1, 'launchSuccess = true must be set inside .exe block');
    assert.ok(spawnIdx < successFlagIdx, 'safeLauncher.launchExecutable must precede launchSuccess = true');
});

test('launch-game: Xbox/UWP branch calls startGameTracking only after _launchAppsFolderTarget succeeds (failure guard first)', () => {
    const xboxIdx = LAUNCH_SRC.indexOf('_launchAppsFolderTarget(');
    assert.ok(xboxIdx !== -1, '_launchAppsFolderTarget must exist in handler');
    const xboxBlock    = LAUNCH_SRC.slice(xboxIdx, xboxIdx + 700);
    const failGuardIdx = xboxBlock.indexOf('XBOX_APPSFOLDER_LAUNCH_FAILED');
    const trackingIdx  = xboxBlock.indexOf('startGameTracking(');
    assert.ok(failGuardIdx !== -1, 'XBOX_APPSFOLDER_LAUNCH_FAILED error code must exist');
    assert.ok(trackingIdx  !== -1, 'startGameTracking must be called in Xbox/UWP branch');
    assert.ok(failGuardIdx < trackingIdx, 'failure error code must precede startGameTracking call');
});

// ─── 8. _endTrackerSession — cleanup contract ─────────────────────────────────

const endTrackerStart = MAIN_JS.indexOf('function _endTrackerSession(');
assert.ok(endTrackerStart !== -1, '_endTrackerSession must exist in main.js');
// 800 chars covers the 20-line function body on Windows CRLF line endings.
const END_TRACKER_SRC = MAIN_JS.slice(endTrackerStart, endTrackerStart + 800);

test('_endTrackerSession: calls clearInterval(tracker.intervalId) to stop the tick loop', () => {
    assert.match(END_TRACKER_SRC, /clearInterval\(tracker\.intervalId\)/);
});

test('_endTrackerSession: deletes activeTrackers[gameId] and does so after clearInterval', () => {
    assert.match(END_TRACKER_SRC, /delete activeTrackers\[gameId\]/);
    const clearIdx  = END_TRACKER_SRC.indexOf('clearInterval(tracker.intervalId)');
    const deleteIdx = END_TRACKER_SRC.indexOf('delete activeTrackers[gameId]');
    assert.ok(clearIdx < deleteIdx, 'clearInterval must precede delete activeTrackers[gameId]');
});

// ─── 9. startGlobalWatcher — co-location guard ───────────────────────────────

test('startGlobalWatcher calls startGameTracking — guards against the watcher being split from the tracking engine', () => {
    const gwStart = MAIN_JS.indexOf('function startGlobalWatcher()');
    assert.ok(gwStart !== -1, 'startGlobalWatcher must exist in main.js');
    // startGameTracking is called ~84 lines into the watcher body.
    // 5500 chars comfortably covers that distance on Windows CRLF line endings.
    const gwSrc = MAIN_JS.slice(gwStart, gwStart + 5500);
    assert.match(gwSrc, /startGameTracking\(/);
});


test('ScummVM launch args disable its console without mutating stored args', () => {
    const stored = ['--fullscreen', '--console'];
    const args = buildExecutableLaunchArgs('F:/Games/Sanitarium/ScummVM/scummvm.exe', stored);
    assert.deepEqual(stored, ['--fullscreen', '--console']);
    assert.deepEqual(args, ['--fullscreen', '--no-console']);
});

test('non-ScummVM executable args are unchanged and executable launch remains shell-free', () => {
    const stored = ['--fullscreen'];
    assert.deepEqual(buildExecutableLaunchArgs('F:/Games/SYMMETRY/Symmetry.exe', stored), stored);
    assert.match(LAUNCH_SRC, /buildExecutableLaunchArgs\(cleanCmd, storedArgs\)/);
    const launchExeIdx = SAFE_LAUNCHER_JS.indexOf('function launchExecutable(');
    const launchExeBlock = SAFE_LAUNCHER_JS.slice(launchExeIdx, launchExeIdx + 800);
    assert.match(launchExeBlock, /shell:\s*false/);
    assert.doesNotMatch(launchExeBlock, /cmd\.exe|shell:\s*true/i);
});
