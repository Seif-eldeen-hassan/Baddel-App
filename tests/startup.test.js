'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT               = path.resolve(__dirname, '..');
const MAIN_JS            = fs.readFileSync(path.join(ROOT, 'main.js'),    'utf8');
const SYSTEM_HANDLERS_JS = fs.readFileSync(path.join(ROOT, 'handlers/systemHandlers.js'), 'utf8');
const APP_JS             = fs.readFileSync(path.join(ROOT, 'src/js/app.js'), 'utf8');
const HTML               = fs.readFileSync(path.join(ROOT, 'src/dashboard.html'), 'utf8');
const PRELOAD            = fs.readFileSync(path.join(ROOT, 'preload.js'),  'utf8');

// ─── 1. Startup preference helpers ──────────────────────────────────────────

test('main.js: STARTUP_PREF_FILE is defined using userData path', () => {
    assert.match(MAIN_JS, /STARTUP_PREF_FILE.*startup-preferences\.json/, 'must define STARTUP_PREF_FILE');
});

test('main.js: readStartupPrefs / writeStartupPrefs exist', () => {
    assert.match(MAIN_JS, /function readStartupPrefs\(\)/, 'readStartupPrefs must exist');
    assert.match(MAIN_JS, /function writeStartupPrefs\(prefs\)/, 'writeStartupPrefs must exist');
});

test('main.js: applyStartupSetting uses --hidden and --startup args via getStartupLoginItemOptions', () => {
    const fnStart = MAIN_JS.indexOf('function applyStartupSetting(');
    const fn = MAIN_JS.slice(fnStart, fnStart + 500);
    // args are now centralised in getStartupLoginItemOptions — function must use that helper
    assert.match(fn, /getStartupLoginItemOptions\(\)/, 'must use getStartupLoginItemOptions for path/args');
    assert.match(fn, /setLoginItemSettings/, 'must call setLoginItemSettings');
    // The helper itself must contain the required args
    const helperStart = MAIN_JS.indexOf('function getStartupLoginItemOptions()');
    const helper = MAIN_JS.slice(helperStart, helperStart + 200);
    assert.match(helper, /'--hidden'/, 'getStartupLoginItemOptions must include --hidden');
    assert.match(helper, /'--startup'/, 'getStartupLoginItemOptions must include --startup');
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
    const handlerIdx = SYSTEM_HANDLERS_JS.indexOf("ipcMain.handle('get-startup-enabled'");
    const handler = SYSTEM_HANDLERS_JS.slice(handlerIdx, handlerIdx + 700);
    assert.match(handler, /userSetStartupEnabled/, 'must check userSetStartupEnabled');
    assert.match(handler, /prefs\.startupEnabled/, 'must return stored startupEnabled');
});

test('main.js: get-startup-enabled returns false in dev mode', () => {
    const handlerIdx = SYSTEM_HANDLERS_JS.indexOf("ipcMain.handle('get-startup-enabled'");
    const handler = SYSTEM_HANDLERS_JS.slice(handlerIdx, handlerIdx + 200);
    assert.match(handler, /app\.isPackaged/, 'must guard with isPackaged');
    assert.match(handler, /return false/, 'must return false in dev');
});

test('main.js: set-startup-enabled calls applyStartupSetting and writes userSetStartupEnabled:true', () => {
    const handlerIdx = SYSTEM_HANDLERS_JS.indexOf("ipcMain.handle('set-startup-enabled'");
    const handler = SYSTEM_HANDLERS_JS.slice(handlerIdx, handlerIdx + 1700);
    assert.match(handler, /applyStartupSetting\(enabled/, 'must call applyStartupSetting');
    assert.match(handler, /userSetStartupEnabled:\s*true/, 'must write userSetStartupEnabled: true');
    assert.match(handler, /startupEnabled:\s*verifiedEnabled/, 'must write verified state, not raw requested enabled');
});

test('main.js: set-startup-enabled returns {status, enabled} object', () => {
    const handlerIdx = SYSTEM_HANDLERS_JS.indexOf("ipcMain.handle('set-startup-enabled'");
    const handler = SYSTEM_HANDLERS_JS.slice(handlerIdx, handlerIdx + 2400);
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
    // Listener is now attached via JS (DOMContentLoaded), not inline onchange
    assert.ok(!HTML.includes('onchange="toggleStartup'), 'startupToggle must not use inline onchange — use JS listener');
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

// ─── 11. OS-first startup state (new) ───────────────────────────────────────

test('main.js: get-startup-enabled queries getLoginItemSettings before falling back to preference', () => {
    const handlerIdx = SYSTEM_HANDLERS_JS.indexOf("ipcMain.handle('get-startup-enabled'");
    const handler = SYSTEM_HANDLERS_JS.slice(handlerIdx, handlerIdx + 800);
    const osQueryIdx   = handler.indexOf('getLoginItemSettings');
    const prefFallback = handler.indexOf('userSetStartupEnabled === true');
    assert.ok(osQueryIdx !== -1, 'getLoginItemSettings must be called');
    assert.ok(prefFallback !== -1, 'userSetStartupEnabled fallback must exist');
    assert.ok(osQueryIdx < prefFallback, 'OS query must come before preference fallback');
});

test('main.js: get-startup-enabled returns structured object with enabled and osEnabled fields', () => {
    const handlerIdx = SYSTEM_HANDLERS_JS.indexOf("ipcMain.handle('get-startup-enabled'");
    const handler = SYSTEM_HANDLERS_JS.slice(handlerIdx, handlerIdx + 800);
    assert.match(handler, /source:\s*'os'/, "must return source: 'os' when OS state available");
    assert.match(handler, /osEnabled/, 'must return osEnabled field');
    assert.match(handler, /enabled:\s*osEnabled/, 'enabled must reflect OS state');
});

test('main.js: set-startup-enabled verifies OS state after applying (calls getLoginItemSettings after applyStartupSetting)', () => {
    const handlerIdx = SYSTEM_HANDLERS_JS.indexOf("ipcMain.handle('set-startup-enabled'");
    const handler = SYSTEM_HANDLERS_JS.slice(handlerIdx, handlerIdx + 1500);
    const applyIdx  = handler.indexOf('applyStartupSetting');
    const verifyIdx = handler.indexOf('getLoginItemSettings');
    assert.ok(applyIdx !== -1,  'applyStartupSetting must be called');
    assert.ok(verifyIdx !== -1, 'getLoginItemSettings must be called for verification');
    assert.ok(applyIdx < verifyIdx, 'getLoginItemSettings must be called AFTER applyStartupSetting');
});

test('main.js: set-startup-enabled returns verified OS state (enabled: verifiedEnabled)', () => {
    const handlerIdx = SYSTEM_HANDLERS_JS.indexOf("ipcMain.handle('set-startup-enabled'");
    const handler = SYSTEM_HANDLERS_JS.slice(handlerIdx, handlerIdx + 1500);
    assert.match(handler, /verifiedEnabled/, 'verifiedEnabled variable must be used');
    assert.match(handler, /enabled:\s*verifiedEnabled/, 'return value must use verifiedEnabled, not raw enabled');
});

test('app.js: toggleStartup syncs checkbox with verified result.enabled from setStartupEnabled', () => {
    const fnStart = APP_JS.indexOf('async function toggleStartup(checkbox)');
    const fn = APP_JS.slice(fnStart, fnStart + 1000);
    assert.match(fn, /result\.enabled/, 'must read result.enabled from setStartupEnabled response');
    assert.match(fn, /checkbox\.checked\s*=\s*result\.enabled/, 'must sync checkbox.checked to result.enabled');
});

test('app.js: toggleStartup function exists and calls setStartupEnabled', () => {
    assert.match(APP_JS, /async function toggleStartup\(checkbox\)/, 'toggleStartup must exist');
    const fnStart = APP_JS.indexOf('async function toggleStartup(checkbox)');
    const fn = APP_JS.slice(fnStart, fnStart + 2000);
    assert.match(fn, /setStartupEnabled\(enabled\)/, 'must call setStartupEnabled(enabled)');
    assert.match(fn, /checkbox\.checked\s*=\s*!enabled/, 'must revert checkbox on error');
});

// ─── 12. Startup toggle robustness (new) ────────────────────────────────────

test('main.js: getStartupLoginItemOptions helper is defined', () => {
    assert.match(MAIN_JS, /function getStartupLoginItemOptions\(\)/, 'getStartupLoginItemOptions must be defined');
});

test('main.js: getStartupLoginItemOptions returns path and args', () => {
    const fnStart = MAIN_JS.indexOf('function getStartupLoginItemOptions()');
    const fn = MAIN_JS.slice(fnStart, fnStart + 200);
    assert.match(fn, /path/, 'must return path');
    assert.match(fn, /'--hidden'/, 'must include --hidden arg');
    assert.match(fn, /'--startup'/, 'must include --startup arg');
});

test('main.js: applyStartupSetting uses getStartupLoginItemOptions', () => {
    const fnStart = MAIN_JS.indexOf('function applyStartupSetting(');
    const fn = MAIN_JS.slice(fnStart, fnStart + 400);
    assert.match(fn, /getStartupLoginItemOptions\(\)/, 'must use getStartupLoginItemOptions for path/args');
    assert.match(fn, /setLoginItemSettings/, 'must call setLoginItemSettings');
});

test('main.js: get-startup-enabled passes options to getLoginItemSettings', () => {
    const handlerIdx = SYSTEM_HANDLERS_JS.indexOf("ipcMain.handle('get-startup-enabled'");
    const handler = SYSTEM_HANDLERS_JS.slice(handlerIdx, handlerIdx + 800);
    assert.match(handler, /getStartupLoginItemOptions\(\)/, 'must call getStartupLoginItemOptions');
    const optsIdx  = handler.indexOf('getStartupLoginItemOptions');
    const queryIdx = handler.indexOf('getLoginItemSettings');
    assert.ok(optsIdx !== -1 && queryIdx !== -1, 'both must be present');
    assert.ok(optsIdx < queryIdx, 'options must be prepared before querying');
    assert.ok(
        handler.includes('getLoginItemSettings(opts)') || handler.includes('getLoginItemSettings(options)'),
        'getLoginItemSettings must receive the options, not called with no args'
    );
});

test('main.js: set-startup-enabled passes options to getLoginItemSettings for verification', () => {
    const handlerIdx = SYSTEM_HANDLERS_JS.indexOf("ipcMain.handle('set-startup-enabled'");
    const handler = SYSTEM_HANDLERS_JS.slice(handlerIdx, handlerIdx + 1500);
    assert.match(handler, /getStartupLoginItemOptions\(\)/, 'must call getStartupLoginItemOptions');
    assert.ok(
        handler.includes('getLoginItemSettings(opts)') || handler.includes('getLoginItemSettings(options)'),
        'verification must pass options to getLoginItemSettings'
    );
});

test('main.js: set-startup-enabled can return status mismatch', () => {
    const handlerIdx = SYSTEM_HANDLERS_JS.indexOf("ipcMain.handle('set-startup-enabled'");
    const handler = SYSTEM_HANDLERS_JS.slice(handlerIdx, handlerIdx + 2000);
    assert.match(handler, /status:\s*'mismatch'/, "must be able to return status: 'mismatch'");
});

test('main.js: set-startup-enabled saves verifiedEnabled to startupEnabled in prefs', () => {
    const handlerIdx = SYSTEM_HANDLERS_JS.indexOf("ipcMain.handle('set-startup-enabled'");
    const handler = SYSTEM_HANDLERS_JS.slice(handlerIdx, handlerIdx + 1700);
    assert.match(handler, /startupEnabled:\s*verifiedEnabled/, 'must save verified state, not raw requested value');
    assert.ok(!handler.includes('startupEnabled: enabled,'), 'must not save unverified requested value');
});

test('app.js: toggleStartup disables checkbox while saving', () => {
    const fnStart = APP_JS.indexOf('async function toggleStartup(checkbox)');
    const fn = APP_JS.slice(fnStart, fnStart + 2100);
    assert.match(fn, /checkbox\.disabled\s*=\s*true/, 'must disable checkbox before async call');
    assert.match(fn, /checkbox\.disabled\s*=\s*false/, 'must re-enable checkbox in finally');
});

test('app.js: toggleStartup guards against repeated clicks while saving', () => {
    const fnStart = APP_JS.indexOf('async function toggleStartup(checkbox)');
    const fn = APP_JS.slice(fnStart, fnStart + 200);
    assert.match(fn, /dataset\.saving/, 'must check dataset.saving to guard repeated clicks');
});

test('app.js: toggleStartup shows error toast on status mismatch', () => {
    const fnStart = APP_JS.indexOf('async function toggleStartup(checkbox)');
    const fn = APP_JS.slice(fnStart, fnStart + 1300);
    assert.match(fn, /result\?\.status\s*===\s*'mismatch'|result\.status\s*===\s*'mismatch'/, 'must check for mismatch status');
    assert.match(fn, /could not be enabled|Startup Apps/, 'must show informative error on mismatch');
});

test('app.js: toggleStartup does not show success toast based on original requested value', () => {
    const fnStart = APP_JS.indexOf('async function toggleStartup(checkbox)');
    const fn = APP_JS.slice(fnStart, fnStart + 1000);
    // Old bug: showToast(enabled ? '...' : '...'). Must not use enabled directly in toast.
    assert.ok(
        !fn.includes("showToast(enabled ?") && !fn.includes('showToast( enabled ?'),
        'toast must not branch on the original requested enabled — use result.enabled/status instead'
    );
});

// ─── 13. dataset.currentState and controlled listener (new) ─────────────────

test('dashboard.html: startupToggle has no inline onchange attribute', () => {
    const idx = HTML.indexOf('id="startupToggle"');
    const ctx = HTML.slice(Math.max(0, idx - 10), idx + 120);
    assert.ok(!ctx.includes('onchange'), 'startupToggle must not have inline onchange — listener attached via JS');
});

test('app.js: attaches controlled change listener to startupToggle at DOMContentLoaded', () => {
    const idx = APP_JS.indexOf("getElementById('startupToggle')");
    assert.ok(idx !== -1, "must call getElementById('startupToggle')");
    const ctx = APP_JS.slice(idx, idx + 150);
    assert.ok(
        ctx.includes("addEventListener('change'") || ctx.includes('addEventListener("change"'),
        'must attach change listener to startupToggle element'
    );
});

test('app.js: openSettingsModal stores dataset.currentState from getStartupEnabled result', () => {
    const fnStart = APP_JS.indexOf('async function openSettingsModal()');
    const fn = APP_JS.slice(fnStart, fnStart + 700);
    assert.match(fn, /dataset\.currentState/, 'openSettingsModal must set dataset.currentState on the startup toggle');
});

test('app.js: toggleStartup computes requested as the inverse of dataset.currentState', () => {
    const fnStart = APP_JS.indexOf('async function toggleStartup(checkbox)');
    const fn = APP_JS.slice(fnStart, fnStart + 500);
    assert.match(fn, /currentState\s*===\s*['"]true['"]/, 'must read currentState to determine previous state');
    assert.ok(fn.includes('!previous'), 'must compute requested as !previous from currentState');
});

test('app.js: toggleStartup sets optimistic checkbox.checked before the async call', () => {
    const fnStart = APP_JS.indexOf('async function toggleStartup(checkbox)');
    const fn = APP_JS.slice(fnStart, fnStart + 800);
    const checkedIdx = fn.indexOf('checkbox.checked = requested');
    const awaitIdx   = fn.indexOf('await window.electronAPI');
    assert.ok(checkedIdx !== -1, 'checkbox.checked = requested must be set');
    assert.ok(checkedIdx < awaitIdx, 'optimistic update must happen before the async IPC call');
});

test('app.js: toggleStartup updates dataset.currentState with verified result', () => {
    const fnStart = APP_JS.indexOf('async function toggleStartup(checkbox)');
    const fn = APP_JS.slice(fnStart, fnStart + 1500);
    assert.match(fn, /dataset\.currentState\s*=\s*String\(verified\)/, 'must store verified state in dataset.currentState');
});

test('app.js: toggleStartup uses result.status mismatch/error for failure toast (not enabled variable)', () => {
    const fnStart = APP_JS.indexOf('async function toggleStartup(checkbox)');
    const fn = APP_JS.slice(fnStart, fnStart + 1500);
    // Mismatch toast must branch on `requested`, not on `enabled` or checkbox.checked
    const mismatchIdx = fn.indexOf("'mismatch'");
    assert.ok(mismatchIdx !== -1, "must check for 'mismatch' status");
    const toastCtx = fn.slice(mismatchIdx, mismatchIdx + 350);
    assert.match(toastCtx, /requested/, 'mismatch toast must branch on the `requested` variable');
    assert.match(toastCtx, /could not be enabled/, 'must have "could not be enabled" message');
});

test('app.js: toggleStartup reverts dataset.currentState on IPC error', () => {
    const fnStart = APP_JS.indexOf('async function toggleStartup(checkbox)');
    const fn = APP_JS.slice(fnStart, fnStart + 2000);
    const catchIdx = fn.indexOf('} catch (err)');
    assert.ok(catchIdx !== -1, 'catch block must exist');
    const catchBlock = fn.slice(catchIdx, catchIdx + 200);
    assert.match(catchBlock, /dataset\.currentState/, 'catch must revert dataset.currentState');
});

test('main.js: set-startup-enabled returns requestedEnabled in all non-dev responses', () => {
    const handlerIdx = SYSTEM_HANDLERS_JS.indexOf("ipcMain.handle('set-startup-enabled'");
    const handler = SYSTEM_HANDLERS_JS.slice(handlerIdx, handlerIdx + 2400);
    assert.match(handler, /requestedEnabled/, 'all response paths must include requestedEnabled');
});

test('main.js: set-startup-enabled returns osEnabled in response', () => {
    const handlerIdx = SYSTEM_HANDLERS_JS.indexOf("ipcMain.handle('set-startup-enabled'");
    const handler = SYSTEM_HANDLERS_JS.slice(handlerIdx, handlerIdx + 2400);
    assert.match(handler, /osEnabled/, 'response must include osEnabled for diagnostics');
});

test("main.js: set-startup-enabled returns status 'error' when applyStartupSetting throws", () => {
    const handlerIdx = SYSTEM_HANDLERS_JS.indexOf("ipcMain.handle('set-startup-enabled'");
    const handler = SYSTEM_HANDLERS_JS.slice(handlerIdx, handlerIdx + 2400);
    assert.match(handler, /status:\s*'error'/, "must return status: 'error' when set throws");
    // applyStartupSetting must be in a try block
    const applyIdx = handler.indexOf('applyStartupSetting');
    const tryBefore = handler.slice(0, applyIdx);
    assert.ok(tryBefore.lastIndexOf('try {') > tryBefore.lastIndexOf('} catch'), 'applyStartupSetting must be inside a try block');
});

test('main.js: set-startup-enabled logs isPackaged and path at entry', () => {
    const handlerIdx = SYSTEM_HANDLERS_JS.indexOf("ipcMain.handle('set-startup-enabled'");
    const handler = SYSTEM_HANDLERS_JS.slice(handlerIdx, handlerIdx + 600);
    assert.match(handler, /isPackaged/, 'must log app.isPackaged at entry');
    assert.match(handler, /opts\.path/, 'must log startup exe path');
});
