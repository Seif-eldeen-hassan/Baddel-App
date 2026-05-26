'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT    = path.resolve(__dirname, '..');
const MAIN_JS = fs.readFileSync(path.join(ROOT, 'main.js'),    'utf8');
const APP_JS  = fs.readFileSync(path.join(ROOT, 'src/js/app.js'), 'utf8');
const HTML    = fs.readFileSync(path.join(ROOT, 'src/dashboard.html'), 'utf8');
const PRELOAD = fs.readFileSync(path.join(ROOT, 'preload.js'),  'utf8');

// ─── 1. Startup preference helpers ──────────────────────────────────────────

test('main.js: STARTUP_PREF_FILE is defined using userData path', () => {
    assert.match(MAIN_JS, /STARTUP_PREF_FILE.*startup-preferences\.json/, 'must define STARTUP_PREF_FILE');
});

test('main.js: readStartupPrefs / writeStartupPrefs exist', () => {
    assert.match(MAIN_JS, /function readStartupPrefs\(\)/, 'readStartupPrefs must exist');
    assert.match(MAIN_JS, /function writeStartupPrefs\(prefs\)/, 'writeStartupPrefs must exist');
});

test('main.js: applyStartupSetting uses --hidden and --startup args', () => {
    const fnStart = MAIN_JS.indexOf('function applyStartupSetting(');
    const fn = MAIN_JS.slice(fnStart, fnStart + 500);
    assert.match(fn, /'--hidden'/, 'must include --hidden arg');
    assert.match(fn, /'--startup'/, 'must include --startup arg');
    assert.match(fn, /setLoginItemSettings/, 'must call setLoginItemSettings');
});

test('main.js: applyStartupSetting guards with app.isPackaged', () => {
    const fnStart = MAIN_JS.indexOf('function applyStartupSetting(');
    const fn = MAIN_JS.slice(fnStart, fnStart + 200);
    assert.match(fn, /app\.isPackaged/, 'must check app.isPackaged before applying');
});

// ─── 2. setupWindowsIntegration: default-first-run enable ───────────────────

test('main.js: setupWindowsIntegration calls applyStartupSetting(true) on first run', () => {
    const fnStart = MAIN_JS.indexOf('function setupWindowsIntegration()');
    const fn = MAIN_JS.slice(fnStart, fnStart + 1200);
    assert.match(fn, /applyStartupSetting\(true/, 'must enable startup by default on first run');
    assert.match(fn, /default-first-run/, 'must label it default-first-run');
});

test('main.js: setupWindowsIntegration does NOT re-enable if userSetStartupEnabled === true', () => {
    const fnStart = MAIN_JS.indexOf('function setupWindowsIntegration()');
    const fn = MAIN_JS.slice(fnStart, fnStart + 1200);
    // Must check userSetStartupEnabled before applying default
    assert.match(fn, /userSetStartupEnabled/, 'must check userSetStartupEnabled');
    // When user has explicit pref, must call applyStartupSetting with their preference
    assert.match(fn, /user-preference/, 'must apply with user-preference reason');
    // Must NOT force-enable when user has explicitly disabled
    assert.match(fn, /applyStartupSetting\(!!prefs\.startupEnabled/, 'must apply stored preference, not hardcoded true');
});

test('main.js: setupWindowsIntegration writes defaultAppliedAt when applying default', () => {
    const fnStart = MAIN_JS.indexOf('function setupWindowsIntegration()');
    const fn = MAIN_JS.slice(fnStart, fnStart + 2000);
    assert.match(fn, /defaultAppliedAt/, 'must write defaultAppliedAt timestamp');
});

// ─── 3. IPC handlers ────────────────────────────────────────────────────────

test('main.js: get-startup-enabled returns stored preference when userSetStartupEnabled is true', () => {
    const handlerIdx = MAIN_JS.indexOf("ipcMain.handle('get-startup-enabled'");
    const handler = MAIN_JS.slice(handlerIdx, handlerIdx + 500);
    assert.match(handler, /userSetStartupEnabled/, 'must check userSetStartupEnabled');
    assert.match(handler, /prefs\.startupEnabled/, 'must return stored startupEnabled');
});

test('main.js: get-startup-enabled returns false in dev mode', () => {
    const handlerIdx = MAIN_JS.indexOf("ipcMain.handle('get-startup-enabled'");
    const handler = MAIN_JS.slice(handlerIdx, handlerIdx + 200);
    assert.match(handler, /app\.isPackaged/, 'must guard with isPackaged');
    assert.match(handler, /return false/, 'must return false in dev');
});

test('main.js: set-startup-enabled calls applyStartupSetting and writes userSetStartupEnabled:true', () => {
    const handlerIdx = MAIN_JS.indexOf("ipcMain.handle('set-startup-enabled'");
    const handler = MAIN_JS.slice(handlerIdx, handlerIdx + 500);
    assert.match(handler, /applyStartupSetting\(enabled/, 'must call applyStartupSetting');
    assert.match(handler, /userSetStartupEnabled:\s*true/, 'must write userSetStartupEnabled: true');
    assert.match(handler, /startupEnabled:\s*enabled/, 'must write startupEnabled: enabled');
});

test('main.js: set-startup-enabled returns {status, enabled} object', () => {
    const handlerIdx = MAIN_JS.indexOf("ipcMain.handle('set-startup-enabled'");
    const handler = MAIN_JS.slice(handlerIdx, handlerIdx + 500);
    assert.match(handler, /status:\s*'success'/, 'must return success status');
    assert.match(handler, /return \{ status/, 'must return object not bare boolean');
});

// ─── 4. isStartupLaunch detection ──────────────────────────────────────────

test('main.js: isStartupLaunch detects --hidden, --startup, and --autostart', () => {
    assert.match(MAIN_JS, /isStartupLaunch/, 'isStartupLaunch must be defined');
    const declIdx = MAIN_JS.indexOf('const isStartupLaunch');
    const decl = MAIN_JS.slice(declIdx, declIdx + 300);
    assert.match(decl, /'--hidden'/, 'must detect --hidden');
    assert.match(decl, /'--startup'/, 'must detect --startup');
    assert.match(decl, /'--autostart'/, 'must detect --autostart');
});

test('main.js: isStartupLaunch is logged at startup', () => {
    assert.match(MAIN_JS, /isStartupLaunch.*argv|argv.*isStartupLaunch/s, 'must log isStartupLaunch and argv');
});

// ─── 5. mainWindow ready-to-show guards ────────────────────────────────────

test('main.js: ready-to-show does not unconditionally call mainWindow.show()', () => {
    const rtIdx = MAIN_JS.indexOf("mainWindow.once('ready-to-show'");
    const block = MAIN_JS.slice(rtIdx, rtIdx + 400);
    // show() must be guarded — not the first statement
    assert.match(block, /isStartupLaunch/, 'ready-to-show must check isStartupLaunch');
    // show() should appear after the isStartupLaunch guard
    const guardIdx = block.indexOf('isStartupLaunch');
    const showIdx  = block.indexOf('mainWindow.show()');
    assert.ok(showIdx > guardIdx, 'show() must come after isStartupLaunch check');
});

test('main.js: ready-to-show logs when launched hidden to tray', () => {
    const rtIdx = MAIN_JS.indexOf("mainWindow.once('ready-to-show'");
    const block = MAIN_JS.slice(rtIdx, rtIdx + 600);
    assert.match(block, /launched hidden to tray/, 'must log hidden-to-tray message');
});

// ─── 6. runAfterStartupGrace ────────────────────────────────────────────────

test('main.js: runAfterStartupGrace is defined', () => {
    assert.match(MAIN_JS, /function runAfterStartupGrace\(/, 'runAfterStartupGrace must be defined');
});

test('main.js: runAfterStartupGrace calls fn() immediately when not isStartupLaunch', () => {
    const fnStart = MAIN_JS.indexOf('function runAfterStartupGrace(');
    const fn = MAIN_JS.slice(fnStart, fnStart + 300);
    assert.match(fn, /if \(!isStartupLaunch\)/, 'must check !isStartupLaunch');
    assert.match(fn, /return fn\(\)/, 'must return fn() immediately for non-startup');
});

test('main.js: runAfterStartupGrace delays with setTimeout when isStartupLaunch', () => {
    const fnStart = MAIN_JS.indexOf('function runAfterStartupGrace(');
    const fn = MAIN_JS.slice(fnStart, fnStart + 400);
    assert.match(fn, /setTimeout/, 'must use setTimeout for startup delay');
});

test('main.js: checkForUpdates is wrapped with runAfterStartupGrace', () => {
    const rtIdx = MAIN_JS.indexOf("mainWindow.once('ready-to-show'");
    const block = MAIN_JS.slice(rtIdx, rtIdx + 1000);
    assert.match(block, /runAfterStartupGrace\('checkForUpdates'/, 'checkForUpdates must be wrapped');
});

test('main.js: autoSyncOnStartup is wrapped with runAfterStartupGrace', () => {
    const rtIdx = MAIN_JS.indexOf("mainWindow.once('ready-to-show'");
    const block = MAIN_JS.slice(rtIdx, rtIdx + 2000);
    assert.match(block, /runAfterStartupGrace\('autoSyncOnStartup'/, 'autoSyncOnStartup must be wrapped');
});

// ─── 7. Global error handlers ───────────────────────────────────────────────

test('main.js: unhandledRejection handler is registered', () => {
    assert.match(MAIN_JS, /process\.on\('unhandledRejection'/, 'must register unhandledRejection handler');
});

test('main.js: uncaughtException handler logs [Fatal]', () => {
    const errIdx = MAIN_JS.indexOf("process.on('uncaughtException'");
    const block = MAIN_JS.slice(errIdx, errIdx + 300);
    assert.match(block, /\[Fatal\]/, 'must prefix log with [Fatal]');
});

// ─── 8. second-instance respects startup args ───────────────────────────────

test('main.js: second-instance handler ignores boot-time duplicates', () => {
    const siIdx = MAIN_JS.indexOf("app.on('second-instance'");
    const block = MAIN_JS.slice(siIdx, siIdx + 500);
    assert.match(block, /secondIsStartup/, 'must detect startup second-instance');
    assert.match(block, /ignored second startup instance/, 'must log and skip startup duplicates');
    // Must check --hidden, --startup, --autostart
    assert.match(block, /'--hidden'/, 'must detect --hidden in second instance');
    assert.match(block, /'--startup'/, 'must detect --startup in second instance');
});

// ─── 9. preload.js exposes startup IPC ──────────────────────────────────────

test('preload.js: exposes getStartupEnabled', () => {
    assert.match(PRELOAD, /getStartupEnabled/, 'must expose getStartupEnabled');
    assert.match(PRELOAD, /get-startup-enabled/, 'must invoke get-startup-enabled channel');
});

test('preload.js: exposes setStartupEnabled', () => {
    assert.match(PRELOAD, /setStartupEnabled/, 'must expose setStartupEnabled');
    assert.match(PRELOAD, /set-startup-enabled/, 'must invoke set-startup-enabled channel');
});

// ─── 10. Settings UI ────────────────────────────────────────────────────────

test('dashboard.html: startup toggle input exists with id=startupToggle', () => {
    assert.match(HTML, /id="startupToggle"/, 'startupToggle must be in HTML');
    assert.match(HTML, /toggleStartup\(this\)/, 'must call toggleStartup on change');
});

test('dashboard.html: startup toggle label text is correct', () => {
    const toggleIdx = HTML.indexOf('startupToggle');
    // Look at surrounding context for label text
    const ctx = HTML.slice(Math.max(0, toggleIdx - 400), toggleIdx + 100);
    assert.match(ctx, /Launch Baddel when Windows starts/, 'must have correct label text');
    assert.match(ctx, /Starts minimized in the background/, 'must have correct subtext');
});

test('app.js: openSettingsModal loads startupToggle state', () => {
    const fnStart = APP_JS.indexOf('async function openSettingsModal()');
    const fn = APP_JS.slice(fnStart, fnStart + 600);
    assert.match(fn, /startupToggle/, 'must reference startupToggle');
    assert.match(fn, /getStartupEnabled/, 'must call getStartupEnabled');
});

test('app.js: openSettingsModal handles both boolean and object response from getStartupEnabled', () => {
    const fnStart = APP_JS.indexOf('async function openSettingsModal()');
    const fn = APP_JS.slice(fnStart, fnStart + 600);
    // Must handle typeof result === 'object' case
    assert.match(fn, /typeof result.*object|object.*typeof result/s, 'must handle object response');
});

test('app.js: toggleStartup function exists and calls setStartupEnabled', () => {
    assert.match(APP_JS, /async function toggleStartup\(checkbox\)/, 'toggleStartup must exist');
    const fnStart = APP_JS.indexOf('async function toggleStartup(checkbox)');
    const fn = APP_JS.slice(fnStart, fnStart + 500);
    assert.match(fn, /setStartupEnabled\(enabled\)/, 'must call setStartupEnabled(enabled)');
    assert.match(fn, /checkbox\.checked\s*=\s*!enabled/, 'must revert checkbox on error');
});
