'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT               = path.resolve(__dirname, '..');
const MAIN_JS            = fs.readFileSync(path.join(ROOT, 'main.js'),    'utf8');
const SYSTEM_HANDLERS_JS = fs.readFileSync(path.join(ROOT, 'handlers/systemHandlers.js'), 'utf8');
const APP_JS             = fs.readFileSync(path.join(ROOT, 'src/js/app.js'), 'utf8');
const SETTINGS_QS_JS     = fs.readFileSync(path.join(ROOT, 'src/js/app/settings-quick-switcher.js'), 'utf8');
const HTML               = fs.readFileSync(path.join(ROOT, 'src/dashboard.html'), 'utf8');
const PRELOAD            = fs.readFileSync(path.join(ROOT, 'preload.js'),  'utf8');
const ANALYTICS_JS       = fs.readFileSync(path.join(ROOT, 'analytics.js'), 'utf8');
const HERO_JS            = fs.readFileSync(path.join(ROOT, 'src/js/app/hero.js'), 'utf8');
const DASHBOARD_CSS      = fs.readFileSync(path.join(ROOT, 'src/css/dashboard.css'), 'utf8');

// ─── 1. Startup preference helpers ──────────────────────────────────────────

test('main.js: STARTUP_PREF_FILE is defined using userData path', () => {
    assert.match(MAIN_JS, /STARTUP_PREF_FILE.*startup-preferences\.json/, 'must define STARTUP_PREF_FILE');
});

test('main.js: readStartupPrefs / writeStartupPrefs exist', () => {
    assert.match(MAIN_JS, /function readStartupPrefs\(\)/, 'readStartupPrefs must exist');
    assert.match(MAIN_JS, /function writeStartupPrefs\(prefs\)/, 'writeStartupPrefs must exist');
});

test('main.js: readStartupPrefs uses fsSync.readFileSync, not fs.readFileSync', () => {
    const fnStart = MAIN_JS.indexOf('function readStartupPrefs()');
    const fn = MAIN_JS.slice(fnStart, fnStart + 200);
    assert.match(fn, /fsSync\.readFileSync/, 'readStartupPrefs must use fsSync (sync fs), not promises API');
    assert.ok(!fn.includes('fs.readFileSync'), 'readStartupPrefs must not call fs.readFileSync (fs is promises)');
});

test('main.js: writeStartupPrefs uses fsSync.writeFileSync, not fs.writeFileSync', () => {
    const fnStart = MAIN_JS.indexOf('function writeStartupPrefs(');
    const fn = MAIN_JS.slice(fnStart, fnStart + 200);
    assert.match(fn, /fsSync\.writeFileSync/, 'writeStartupPrefs must use fsSync (sync fs), not promises API');
    assert.ok(!fn.includes('fs.writeFileSync'), 'writeStartupPrefs must not call fs.writeFileSync (fs is promises)');
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

test('main.js: analytics init is not awaited before createWindow', () => {
    const readyIdx = MAIN_JS.indexOf('app.whenReady().then');
    const createCallIdx = MAIN_JS.indexOf('createWindow();', readyIdx);
    const beforeCreate = MAIN_JS.slice(readyIdx, createCallIdx);
    assert.doesNotMatch(beforeCreate, /await\s+runAfterStartupGrace\(['"]analytics\.init/);
    assert.doesNotMatch(beforeCreate, /await\s+analytics\.init\(/);
    assert.match(MAIN_JS, /function startAnalyticsAfterWindowVisible/);
    const createWindowFn = MAIN_JS.slice(MAIN_JS.indexOf('function createWindow'), MAIN_JS.indexOf('// -- Webview security'));
    assert.match(createWindowFn, /mainWindow\.once\('show'/);
    assert.match(createWindowFn, /startAnalyticsAfterWindowVisible\(\)/);
});

test('analytics.js: startup OS version check uses non-blocking local API', () => {
    assert.doesNotMatch(ANALYTICS_JS, /execSync/);
    assert.doesNotMatch(ANALYTICS_JS, /powershell|Get-WmiObject|Win32_OperatingSystem/i);
    assert.match(ANALYTICS_JS, /os\.release\(\)|process\.getSystemVersion/);
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

test('settings-quick-switcher.js: openSettingsModal loads startupToggle state', () => {
    const fnStart = SETTINGS_QS_JS.indexOf('async function openSettingsModal()');
    const fn = SETTINGS_QS_JS.slice(fnStart, fnStart + 600);
    assert.match(fn, /startupToggle/, 'must reference startupToggle');
    assert.match(fn, /getStartupEnabled/, 'must call getStartupEnabled');
});

test('settings-quick-switcher.js: openSettingsModal handles both boolean and object response from getStartupEnabled', () => {
    const fnStart = SETTINGS_QS_JS.indexOf('async function openSettingsModal()');
    const fn = SETTINGS_QS_JS.slice(fnStart, fnStart + 600);
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

test('settings-quick-switcher.js: toggleStartup syncs checkbox with verified result.enabled from setStartupEnabled', () => {
    const fnStart = SETTINGS_QS_JS.indexOf('async function toggleStartup(checkbox)');
    const fn = SETTINGS_QS_JS.slice(fnStart, fnStart + 1000);
    assert.match(fn, /result\.enabled/, 'must read result.enabled from setStartupEnabled response');
    assert.match(fn, /checkbox\.checked\s*=\s*result\.enabled/, 'must sync checkbox.checked to result.enabled');
});

test('settings-quick-switcher.js: toggleStartup function exists and calls setStartupEnabled', () => {
    assert.match(SETTINGS_QS_JS, /async function toggleStartup\(checkbox\)/, 'toggleStartup must exist');
    const fnStart = SETTINGS_QS_JS.indexOf('async function toggleStartup(checkbox)');
    const fn = SETTINGS_QS_JS.slice(fnStart, fnStart + 2000);
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

test('settings-quick-switcher.js: toggleStartup disables checkbox while saving', () => {
    const fnStart = SETTINGS_QS_JS.indexOf('async function toggleStartup(checkbox)');
    const fn = SETTINGS_QS_JS.slice(fnStart, fnStart + 2100);
    assert.match(fn, /checkbox\.disabled\s*=\s*true/, 'must disable checkbox before async call');
    assert.match(fn, /checkbox\.disabled\s*=\s*false/, 'must re-enable checkbox in finally');
});

test('settings-quick-switcher.js: toggleStartup guards against repeated clicks while saving', () => {
    const fnStart = SETTINGS_QS_JS.indexOf('async function toggleStartup(checkbox)');
    const fn = SETTINGS_QS_JS.slice(fnStart, fnStart + 200);
    assert.match(fn, /dataset\.saving/, 'must check dataset.saving to guard repeated clicks');
});

test('settings-quick-switcher.js: toggleStartup shows error toast on status mismatch', () => {
    const fnStart = SETTINGS_QS_JS.indexOf('async function toggleStartup(checkbox)');
    const fn = SETTINGS_QS_JS.slice(fnStart, fnStart + 1300);
    assert.match(fn, /result\?\.status\s*===\s*'mismatch'|result\.status\s*===\s*'mismatch'/, 'must check for mismatch status');
    assert.match(fn, /could not be enabled|Startup Apps/, 'must show informative error on mismatch');
});

test('settings-quick-switcher.js: toggleStartup does not show success toast based on original requested value', () => {
    const fnStart = SETTINGS_QS_JS.indexOf('async function toggleStartup(checkbox)');
    const fn = SETTINGS_QS_JS.slice(fnStart, fnStart + 1000);
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

test('settings-quick-switcher.js: attaches controlled change listener to startupToggle at DOMContentLoaded', () => {
    const domIdx = SETTINGS_QS_JS.indexOf("document.addEventListener('DOMContentLoaded'");
    assert.ok(domIdx !== -1, 'DOMContentLoaded listener must exist');
    const ctx = SETTINGS_QS_JS.slice(domIdx, domIdx + 250);
    assert.ok(ctx.includes("getElementById('startupToggle')"), "must call getElementById('startupToggle')");
    assert.ok(
        ctx.includes("addEventListener('change'") || ctx.includes('addEventListener("change"'),
        'must attach change listener to startupToggle element'
    );
});

test('settings-quick-switcher.js: openSettingsModal stores dataset.currentState from getStartupEnabled result', () => {
    const fnStart = SETTINGS_QS_JS.indexOf('async function openSettingsModal()');
    const fn = SETTINGS_QS_JS.slice(fnStart, fnStart + 700);
    assert.match(fn, /dataset\.currentState/, 'openSettingsModal must set dataset.currentState on the startup toggle');
});

test('settings-quick-switcher.js: toggleStartup computes requested as the inverse of dataset.currentState', () => {
    const fnStart = SETTINGS_QS_JS.indexOf('async function toggleStartup(checkbox)');
    const fn = SETTINGS_QS_JS.slice(fnStart, fnStart + 500);
    assert.match(fn, /currentState\s*===\s*['"]true['"]/, 'must read currentState to determine previous state');
    assert.ok(fn.includes('!previous'), 'must compute requested as !previous from currentState');
});

test('settings-quick-switcher.js: toggleStartup sets optimistic checkbox.checked before the async call', () => {
    const fnStart = SETTINGS_QS_JS.indexOf('async function toggleStartup(checkbox)');
    const fn = SETTINGS_QS_JS.slice(fnStart, fnStart + 800);
    const checkedIdx = fn.indexOf('checkbox.checked = requested');
    const awaitIdx   = fn.indexOf('await window.electronAPI');
    assert.ok(checkedIdx !== -1, 'checkbox.checked = requested must be set');
    assert.ok(checkedIdx < awaitIdx, 'optimistic update must happen before the async IPC call');
});

test('settings-quick-switcher.js: toggleStartup updates dataset.currentState with verified result', () => {
    const fnStart = SETTINGS_QS_JS.indexOf('async function toggleStartup(checkbox)');
    const fn = SETTINGS_QS_JS.slice(fnStart, fnStart + 1500);
    assert.match(fn, /dataset\.currentState\s*=\s*String\(verified\)/, 'must store verified state in dataset.currentState');
});

test('settings-quick-switcher.js: toggleStartup uses result.status mismatch/error for failure toast (not enabled variable)', () => {
    const fnStart = SETTINGS_QS_JS.indexOf('async function toggleStartup(checkbox)');
    const fn = SETTINGS_QS_JS.slice(fnStart, fnStart + 1500);
    // Mismatch toast must branch on `requested`, not on `enabled` or checkbox.checked
    const mismatchIdx = fn.indexOf("'mismatch'");
    assert.ok(mismatchIdx !== -1, "must check for 'mismatch' status");
    const toastCtx = fn.slice(mismatchIdx, mismatchIdx + 350);
    assert.match(toastCtx, /requested/, 'mismatch toast must branch on the `requested` variable');
    assert.match(toastCtx, /could not be enabled/, 'must have "could not be enabled" message');
});

test('settings-quick-switcher.js: toggleStartup reverts dataset.currentState on IPC error', () => {
    const fnStart = SETTINGS_QS_JS.indexOf('async function toggleStartup(checkbox)');
    const fn = SETTINGS_QS_JS.slice(fnStart, fnStart + 2000);
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

// ─── Phase 25.2A-R8: adaptive Home startup readiness ───────────────────────

test('app.js: defines explicit startup library readiness states', () => {
    assert.match(APP_JS, /STARTUP_LIBRARY_STATES\s*=\s*Object\.freeze/, 'startup library states must be explicit');
    for (const state of ['bootstrapping', 'cached-ready', 'scanning', 'ready-with-games', 'confirmed-empty', 'scan-failed']) {
        assert.ok(APP_JS.includes(`'${state}'`), `missing startup library state ${state}`);
    }
});

test('app.js: startup scan-state signals register before initSystem starts', () => {
    const registerIdx = APP_JS.indexOf('registerStartupLibrarySignals();');
    const initIdx = APP_JS.indexOf('initSystem();');
    assert.ok(registerIdx > -1, 'startup signal registration call must exist');
    assert.ok(initIdx > -1, 'initSystem call must exist');
    assert.ok(registerIdx < initIdx, 'scan-state listener must be registered before initSystem starts');
});

test('app.js: non-empty cached library renders critical Home before splash dismissal', () => {
    const fnStart = APP_JS.indexOf('async function _resolveStartupLibraryBeforeSplash');
    const fnEnd = APP_JS.indexOf('function _handleStartupScanState', fnStart);
    const fn = APP_JS.slice(fnStart, fnEnd);
    const cachedIdx = fn.indexOf('cachedCount > 0');
    const criticalIdx = fn.indexOf("_renderCriticalHomeContent('cached-ready')");
    const coversIdx = fn.indexOf('waitForHomeCovers(controller');
    const revealIdx = fn.indexOf("requestReveal('cached-ready')");
    assert.ok(cachedIdx > -1, 'cached-count branch must exist');
    assert.ok(criticalIdx > cachedIdx, 'must render critical Home for cached games');
    assert.ok(coversIdx > criticalIdx, 'must wait for selected Home covers after critical render');
    assert.ok(revealIdx > coversIdx, 'splash reveal is requested only after the cover gate');
});

test('app.js: empty cached library with active scan uses adaptive grace, not immediate empty render', () => {
    const fnStart = APP_JS.indexOf('async function _resolveStartupLibraryBeforeSplash');
    const fnEnd = APP_JS.indexOf('function _handleStartupScanState', fnStart);
    const fn = APP_JS.slice(fnStart, fnEnd);
    assert.match(fn, /lib\.scanActive|\bSCANNING\b/, 'must detect active startup scan');
    assert.match(fn, /_startStartupLibraryGrace\(loader,\s*grid,\s*hideSplash\)/, 'must start adaptive library grace');
    assert.doesNotMatch(fn, /No Games Found|No games yet/, 'startup resolver must not render final empty copy');
});

test('app.js: adaptive startup library grace defaults to 1200ms and keeps splash gate active', () => {
    const fnStart = APP_JS.indexOf('function _startStartupLibraryGrace');
    const fn = APP_JS.slice(fnStart, fnStart + 900);
    assert.match(fn, /__baddelStartupLibraryGraceMs\s*\?\?\s*1200/, 'grace default must be 1200ms');
    assert.match(fn, /startupLibraryGraceExpired\s*=\s*true/, 'metrics must record grace expiry');
    assert.match(fn, /renderHomeLoadingState\(\)/, 'slow scans must reveal loading state');
    assert.doesNotMatch(fn, /requestReveal\(/, 'grace expiry must not request final reveal');
    assert.doesNotMatch(fn, /hideSplash\(/, 'grace expiry must not hide the splash');
    assert.doesNotMatch(fn, /No Games Found|No games yet/, 'grace expiry must not show final empty copy');
});

test('app.js and hero.js: pending startup states suppress false empty Home copy', () => {
    const exploreStart = APP_JS.indexOf('function renderExploreCarousel');
    const explore = APP_JS.slice(exploreStart, exploreStart + 1800);
    assert.match(explore, /BOOTSTRAPPING[\s\S]*SCANNING[\s\S]*renderHomeLoadingState\(\)/, 'Explore must render loading while startup library is pending');
    assert.match(explore, /SCAN_FAILED[\s\S]*renderHomeScanErrorState\(\)/, 'Explore must render retry/error UI on scan failure');
    const loadingIdx = explore.indexOf('renderHomeLoadingState()');
    const emptyIdx = explore.indexOf('No games yet.');
    assert.ok(loadingIdx > -1 && emptyIdx > loadingIdx, 'Explore empty copy must come after pending-state guard');

    const heroStart = HERO_JS.indexOf('function applyHeroForHome');
    const hero = HERO_JS.slice(heroStart, heroStart + 1600);
    assert.match(hero, /bootstrapping[\s\S]*scanning[\s\S]*renderHomeLoadingState\(\)/, 'Hero must render loading while startup library is pending');
    assert.match(hero, /scan-failed[\s\S]*renderHomeScanErrorState\(\)/, 'Hero must render scan error UI');
    const heroLoadingIdx = hero.indexOf('renderHomeLoadingState()');
    const noGamesIdx = hero.indexOf('No Games Found');
    assert.ok(heroLoadingIdx > -1 && noGamesIdx > heroLoadingIdx, 'Hero empty copy must come after pending-state guard');
});

test('app.js: scan-finished zero is the only startup path to confirmed empty', () => {
    const fnStart = APP_JS.indexOf('function _handleStartupScanState');
    const fn = APP_JS.slice(fnStart, fnStart + 1000);
    assert.match(fn, /payload\.state === 'scan-finished'/, 'must handle scan-finished');
    assert.match(fn, /count === 0[\s\S]*renderHomeConfirmedEmptyState\(\)/, 'zero scan result must render confirmed empty');
    const confirmedStart = APP_JS.indexOf('function renderHomeConfirmedEmptyState');
    const confirmed = APP_JS.slice(confirmedStart, confirmedStart + 500);
    assert.match(confirmed, /CONFIRMED_EMPTY/, 'confirmed empty state must be explicit');
    assert.match(confirmed, /confirmedEmptyAt/, 'confirmed empty metric must be recorded');
});

test('app.js: scan-failed shows retry/error UI and preserves cached games', () => {
    const fnStart = APP_JS.indexOf('function renderHomeScanErrorState');
    const fnEnd = APP_JS.indexOf('function _startStartupLibraryGrace', fnStart);
    const fn = APP_JS.slice(fnStart, fnEnd);
    assert.match(fn, /SCAN_FAILED/, 'scan failed state must be explicit');
    assert.match(fn, /_startupLibraryHasGames\(\)[\s\S]*_renderCriticalHomeContent\('scan-failed-cached'\)/, 'cached games must remain visible after failed refresh scan');
    assert.match(fn, /Library scan needs a retry|Preparing your library hit a snag/, 'empty-cache failure must show retry/error copy');
    assert.doesNotMatch(fn, /No Games Found|No games yet/, 'scan failure must not show normal empty copy');
});

test('app.js: library-updated readiness is handled inside the existing debounced processing path', () => {
    const listenerCount = (APP_JS.match(/window\.electronAPI\.onLibraryUpdated\(/g) || []).length;
    assert.equal(listenerCount, 1, 'app.js must keep one effective library-updated listener');
    const processStart = APP_JS.indexOf('async function _processLibraryUpdatedPayload');
    const processBlock = APP_JS.slice(processStart, processStart + 1700);
    assert.match(processBlock, /_handleStartupLibraryUpdatedPayload\(mergedGames\)/, 'startup readiness must observe the existing library-updated pipeline');
    assert.match(processBlock, /if \(startupHandled\)[\s\S]*return;/, 'initial scan result must not render structural Home twice');
});

test('app.js: library-updated defers transient Installed count drops before replacing allGamesData', () => {
    assert.match(APP_JS, /function _countDirectInstalledGames\(/, 'library update path must count installed entries directly');
    assert.match(APP_JS, /function _shouldDeferInstalledLibraryDrop\(/, 'library update path must detect transient installed drops');
    assert.match(APP_JS, /function _deferInstalledLibraryDrop\(/, 'library update path must defer suspected drops');
    const processStart = APP_JS.indexOf('async function _processLibraryUpdatedPayload');
    const processBlock = APP_JS.slice(processStart, processStart + 1000);
    assert.match(processBlock, /_shouldDeferInstalledLibraryDrop\(mergedGames,\s*options\)/);
    assert.match(processBlock, /_deferInstalledLibraryDrop\(updatedGames,\s*mergedGames\)/);
    assert.ok(
        processBlock.indexOf('_shouldDeferInstalledLibraryDrop') < processBlock.indexOf('allGamesData = mergedGames'),
        'suspected Installed drops must be deferred before allGamesData is replaced'
    );
});

test('app.js: library-updated inside grace renders populated Home and hides splash', () => {
    const fnStart = APP_JS.indexOf('function _handleStartupLibraryUpdatedPayload');
    const fnEnd = APP_JS.indexOf('function registerStartupLibrarySignals', fnStart);
    const fn = APP_JS.slice(fnStart, fnEnd);
    assert.match(fn, /READY_WITH_GAMES/, 'non-empty library update must mark ready-with-games');
    assert.match(fn, /_cancelStartupLibraryGrace\(\)/, 'non-empty update must cancel startup grace timer');
    assert.match(fn, /_renderCriticalHomeContent\('library-updated'\)/, 'non-empty update must render one critical Home refresh');
    assert.match(fn, /_hideSplashForStartupLibrary\('library-updated'\)/, 'non-empty update must resolve the splash gate');
});

test('app.js and dashboard.css: Home loading presentation has skeletons and no empty copy', () => {
    const fnStart = APP_JS.indexOf('function renderHomeLoadingState');
    const fn = APP_JS.slice(fnStart, fnStart + 1800);
    assert.match(fn, /title\.innerText\s*=\s*''/, 'loading state must keep hero title empty until a real game is selected');
    assert.match(fn, /title\.style\.display\s*=\s*'none'/, 'loading state must hide placeholder hero title');
    assert.match(fn, /home-hero-skeleton/, 'loading state must apply hero skeleton class');
    assert.match(fn, /home-explore-skeleton-card/, 'loading state must render Explore skeleton cards');
    assert.doesNotMatch(fn, /Welcome to Baddel|No Games Found|No games yet/, 'loading state must not include placeholder or final empty copy');
    const heroStart = HTML.indexOf('id="heroSection"');
    const heroEnd = HTML.indexOf('id="libraryView"', heroStart);
    const hero = HTML.slice(heroStart, heroEnd);
    assert.doesNotMatch(hero, /Welcome to Baddel/, 'initial hero markup must not flash welcome copy');
    assert.match(DASHBOARD_CSS, /\.home-hero-skeleton/, 'hero skeleton CSS must exist');
    assert.match(DASHBOARD_CSS, /\.home-explore-skeleton-card/, 'Explore skeleton CSS must exist');
});

test('app.js: R8 startup metrics remain available', () => {
    for (const metric of [
        'startupLibraryState',
        'startupLibraryGraceExpired',
        'firstCriticalHomeRenderAt',
        'homeLoadingStateShownAt',
        'confirmedEmptyAt',
    ]) {
        assert.ok(APP_JS.includes(metric), `missing startup metric ${metric}`);
    }
    assert.ok(APP_JS.includes('firstShellAt'), 'R7 firstShellAt metric must remain');
    assert.ok(APP_JS.includes('splashHiddenAt'), 'R7 splashHiddenAt metric must remain');
});

test('app.js: Phase 25.2A-R8 corrective startup coordinator tracks required readiness fields', () => {
    assert.match(APP_JS, /class StartupReadinessCoordinator/, 'startup readiness coordinator must exist');
    for (const field of [
        'libraryScanState',
        'libraryDataReady',
        'installedSnapshotReady',
        'homeSelectionGeneration',
        'homeCoverTotal',
        'homeCoverResolved',
        'homeCoverFallbackCount',
        'homeCoversReady',
        'revealRequested',
        'revealed',
        'startedAt',
        'scanDurationMs',
        'coverDurationMs',
    ]) {
        assert.ok(APP_JS.includes(`this.${field}`), `missing coordinator field ${field}`);
    }
    assert.match(APP_JS, /StartupReadinessSummary/, 'must log sanitized startup readiness summary');
});

test('app.js: startup reveal waits for scan, data, Installed snapshot, cover gate, and two RAFs', () => {
    const start = APP_JS.indexOf('class StartupReadinessCoordinator');
    const block = APP_JS.slice(start, start + 6000);
    assert.match(block, /terminalScan/, 'must require terminal scan state before reveal');
    assert.match(block, /libraryDataReady/, 'must require merged library data before reveal');
    assert.match(block, /installedSnapshotReady/, 'must require prepared Installed snapshot before reveal');
    assert.match(block, /homeCoversReady/, 'must require selected Home cover readiness before reveal');
    assert.match(block, /controller\.generation !== this\.homeSelectionGeneration/, 'must reject stale Explore generations');
    assert.match(block, /_waitForNextHomePaint\(240\)/, 'must wait two RAFs before splash dismissal');
    assert.match(block, /onStartupRevealed/, 'startup reveal must wake background artwork queues');
});

test('app.js: Explore cover gate exposes generation-aware decoded terminal readiness', () => {
    const start = APP_JS.indexOf('class ExploreCoverHydrationController');
    const block = APP_JS.slice(start);
    assert.match(block, /waitForCoversReady\(\{\s*generation/, 'controller must expose waitForCoversReady API');
    assert.match(block, /terminalCoverByDisplayId/, 'controller must track terminal cover states separately from cache completion');
    assert.match(block, /requireDecoded/, 'cover gate must support decoded readiness');
    assert.match(block, /_decodeCardImage/, 'cover gate must wait for browser image readiness');
    assert.match(block, /naturalWidth/, 'image readiness must verify decoded dimensions where available');
    assert.match(block, /_applyFallbackCover/, 'unresolved covers must fall back before terminal readiness');
    assert.match(block, /stale:\s*true/, 'stale generations must not satisfy current startup gate');
});

test('app.js: startup Explore cover downloads use startup-critical priority and defer secondary art', () => {
    const start = APP_JS.indexOf('class ExploreCoverHydrationController');
    const block = APP_JS.slice(start);
    assert.match(block, /startup-critical-cover/, 'startup selected cover downloads must use startup-critical-cover priority');
    assert.match(block, /explore-cover-hydration/, 'cover-first request path must remain separate');
    assert.match(APP_JS, /explore-secondary-hydration/, 'secondary hero/logo hydration must remain separate');
    assert.match(block, /__baddelStartupReadinessCoordinator[\s\S]*!window\.__baddelStartupReadinessCoordinator\.revealed/, 'secondary hydration must be deferred while startup reveal is gated');
    assert.match(block, /onStartupRevealed/, 'secondary hydration must resume after startup reveal');
    assert.match(block, /postRevealRetryByDisplayId/, 'fallback covers must get a bounded post-reveal real-cover retry');
});

test('app.js: startup cover gate is cover-first and does not wait for full image decode', () => {
    const start = APP_JS.indexOf('async waitForHomeCovers');
    const block = APP_JS.slice(start, start + 900);
    assert.match(block, /timeoutMs\s*=\s*2200/, 'startup cover gate default must stay short');
    assert.match(block, /requireDecoded:\s*false/, 'startup reveal must not wait for full image decode');
    assert.match(APP_JS, /__baddelStartupCoverGateTimeoutMs\s*\?\?\s*2200/, 'callers must use the shorter startup cover gate fallback');
});

test('app.js: Explore cover result patches the live card before decode or navigation', () => {
    const start = APP_JS.indexOf('_applyCoverResultToCard');
    const block = APP_JS.slice(start, start + 900);
    assert.match(block, /img\.src\s*=\s*url/, 'cover result must assign the visible image directly');
    assert.match(block, /img-loaded/, 'direct patch must mark the image as loaded');
    const consumeStart = APP_JS.indexOf('\n    _consumePending(id, reason)');
    const consume = APP_JS.slice(consumeStart, consumeStart + 2600);
    assert.match(consume, /_applyCoverResultToCard\(card,\s*id,\s*result\)/, 'pending cover consumption must patch the mounted card');
    assert.match(consume, /_markCoverTerminal\(id,\s*result,\s*\{\s*decoded:\s*false\s*\}\)/, 'cover gate can release after assignment while decode continues');
    const renderStart = APP_JS.indexOf('function renderExploreCarousel');
    const render = APP_JS.slice(renderStart, renderStart + 3600);
    const replaceIdx = render.indexOf('grid.replaceChildren(fragment)');
    const registerIdx = render.indexOf('nextNodes.forEach');
    assert.ok(replaceIdx > -1 && registerIdx > replaceIdx, 'new Explore cards must register after they are mounted');
});

test('app.js: Installed view can reuse prepared startup snapshot for current revision', () => {
    assert.match(APP_JS, /function _computeInstalledGamesSnapshot/, 'must compute Installed snapshot via shared helper');
    assert.match(APP_JS, /function _prepareInstalledGamesSnapshot/, 'must prepare Installed snapshot before reveal');
    assert.match(APP_JS, /function _installedSnapshotMatchesCurrentFilters/, 'must validate snapshot revision and filters');
    const navStart = APP_JS.indexOf('function navigateToInstalled');
    const nav = APP_JS.slice(navStart, navStart + 900);
    assert.match(nav, /_renderInstalledSnapshot\(window\.__baddelInstalledSnapshot\)/, 'navigateToInstalled must try prepared snapshot first');
    assert.match(nav, /if \(!usedPreparedSnapshot\) applyFilters\(\)/, 'navigateToInstalled must fall back to normal filtering if snapshot is stale');
});

test('app.js and dashboard: startup loader writes styled status text and first-run note', () => {
    assert.match(HTML, /id="splashStatusText"/, 'splash status text element must exist');
    assert.match(HTML, /id="splashStatusNote"/, 'splash first-run note element must exist');
    const setterStart = APP_JS.indexOf('function _setStartupLoaderText');
    const setter = APP_JS.slice(setterStart, setterStart + 900);
    assert.match(setter, /splashStatusText/, 'loader updates must target text node, not the whole status row');
    assert.match(setter, /splashStatusNote/, 'loader must support a quieter first-run note');
    assert.doesNotMatch(setter, /getElementById\('splashStatus'\)/, 'loader must not overwrite status row structure');
    assert.match(APP_JS, /First launch can take a little longer/, 'fresh install copy must explain first-run duration');
});

test('dashboard startup loader is minimal, accessible, and motion-safe', () => {
    const loaderStart = HTML.indexOf('id="mainLoader"');
    const loaderEnd = HTML.indexOf('id="launchOverlay"', loaderStart);
    const loader = HTML.slice(loaderStart, loaderEnd);

    assert.match(loader, /role="status"/, 'startup loader must expose status semantics');
    assert.match(loader, /aria-live="polite"/, 'startup loader status updates must be polite');
    assert.match(loader, /aria-busy="true"/, 'startup loader must mark startup as busy while visible');
    assert.match(loader, /Baddel app logo/, 'startup logo must have accessible alt text');
    assert.match(loader, /Preparing your library/, 'startup loader must use the restrained status copy');
    assert.match(loader, /Every launcher\. One place\./, 'startup loader must keep the Baddel tagline');

    assert.doesNotMatch(loader, /canvas|splashCanvas|splashHud|splashFrameCounter|splashScan|splash-corner|splash-arc|splash-ring/i);
    assert.match(DASHBOARD_CSS, /@media\s*\(prefers-reduced-motion:\s*reduce\)/, 'loader must support reduced motion');
    assert.match(DASHBOARD_CSS, /@keyframes splashProgressSweep/, 'loader must keep the minimal indeterminate progress line');
    assert.doesNotMatch(APP_JS, /playSplashSound|AudioContext|webkitAudioContext|_splashTimers|_splashIntervals|_splashRafId/);
});
