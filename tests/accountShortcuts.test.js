'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT        = path.resolve(__dirname, '..');
const SERVICE_JS  = fs.readFileSync(path.join(ROOT, 'services/accountShortcuts.js'),         'utf8');
const MAIN_JS     = fs.readFileSync(path.join(ROOT, 'main.js'),                             'utf8');
const PRELOAD_JS  = fs.readFileSync(path.join(ROOT, 'preload.js'),                          'utf8');
const ACC_JS            = fs.readFileSync(path.join(ROOT, 'src/js/accounts.js'),                  'utf8');
const PLATFORM_PANELS_JS = fs.readFileSync(path.join(ROOT, 'src/js/accounts/platform-panels.js'), 'utf8');
const ACC_CSS     = fs.readFileSync(path.join(ROOT, 'src/css/accounts.css'),                'utf8');
const HANDLER_JS  = fs.readFileSync(path.join(ROOT, 'accountsHandler.js'),                  'utf8');
const ACCOUNT_SHORTCUT_HANDLERS_JS = fs.readFileSync(path.join(ROOT, 'handlers', 'accountShortcutHandlers.js'), 'utf8');

// ── Load pure functions (no Electron at require-time if we mock the module) ─

// Swap the 'electron' require for a lightweight stub so we can test pure functions.
const Module = require('module');
const _origLoad = Module._load.bind(Module);
Module._load = function(req, parent, isMain) {
    if (req === 'electron') {
        return {
            app: { getPath: () => require('os').tmpdir() },
            globalShortcut: {
                register:      () => true,
                unregister:    () => {},
                unregisterAll: () => {},
            },
            Notification: class { show() {} },
        };
    }
    return _origLoad(req, parent, isMain);
};

let svc;
try { svc = require('../services/accountShortcuts'); } catch {}

// Restore the original loader after our single require.
Module._load = _origLoad;

// ── 1. normalizeAccelerator ──────────────────────────────────────────────────

test('normalizeAccelerator: normalises Ctrl+Alt+H', () => {
    assert.equal(svc.normalizeAccelerator('Ctrl+Alt+H'), 'Ctrl+Alt+H');
});

test('normalizeAccelerator: normalises lowercase ctrl+shift+b', () => {
    assert.equal(svc.normalizeAccelerator('ctrl+shift+b'), 'Ctrl+Shift+B');
});

test('normalizeAccelerator: sorts modifiers in canonical order Ctrl,Shift,Alt', () => {
    assert.equal(svc.normalizeAccelerator('Alt+Ctrl+G'), 'Ctrl+Alt+G');
});

test('normalizeAccelerator: maps Control → Ctrl', () => {
    assert.equal(svc.normalizeAccelerator('Control+Shift+X'), 'Ctrl+Shift+X');
});

test('normalizeAccelerator: returns empty string for modifier-only input', () => {
    assert.equal(svc.normalizeAccelerator('Ctrl+Shift'), '');
});

test('normalizeAccelerator: returns empty string for empty input', () => {
    assert.equal(svc.normalizeAccelerator(''), '');
});

test('normalizeAccelerator: preserves function keys', () => {
    assert.equal(svc.normalizeAccelerator('Ctrl+Alt+F1'), 'Ctrl+Alt+F1');
});

// ── 2. validateAccelerator ───────────────────────────────────────────────────

test('validateAccelerator: accepts Ctrl+Alt+H', () => {
    const r = svc.validateAccelerator('Ctrl+Alt+H');
    assert.equal(r.valid, true);
    assert.ok(r.normalized);
});

test('validateAccelerator: accepts Ctrl+Shift+B', () => {
    const r = svc.validateAccelerator('Ctrl+Shift+B');
    assert.equal(r.valid, true);
});

test('validateAccelerator: accepts Alt+Shift+Q', () => {
    const r = svc.validateAccelerator('Alt+Shift+Q');
    assert.equal(r.valid, true);
});

test('validateAccelerator: rejects empty string', () => {
    assert.equal(svc.validateAccelerator('').valid, false);
});

test('validateAccelerator: rejects single letter', () => {
    assert.equal(svc.validateAccelerator('A').valid, false);
});

test('validateAccelerator: accepts single modifier + key', () => {
    const r = svc.validateAccelerator('Ctrl+H');
    assert.equal(r.valid, true);
    assert.equal(r.normalized, 'Ctrl+H');
});

test('validateAccelerator: rejects Ctrl+C (blocked)', () => {
    const r = svc.validateAccelerator('Ctrl+C');
    assert.equal(r.valid, false);
});

test('validateAccelerator: rejects Alt+Tab (blocked)', () => {
    const r = svc.validateAccelerator('Alt+Tab');
    assert.equal(r.valid, false);
});

test('validateAccelerator: returns normalized in valid result', () => {
    const r = svc.validateAccelerator('ctrl+alt+g');
    assert.equal(r.valid, true);
    assert.equal(r.normalized, 'Ctrl+Alt+G');
});

// ── 3. Service file safety: no sensitive field names ────────────────────────

test('accountShortcuts service never stores password field', () => {
    assert.doesNotMatch(SERVICE_JS, /password/i);
});

test('accountShortcuts service never stores token field', () => {
    assert.doesNotMatch(SERVICE_JS, /"token"|'token'|\.token\b/);
});

test('accountShortcuts service never stores session data', () => {
    assert.doesNotMatch(SERVICE_JS, /sessionData|session_data/);
});

test('accountShortcuts service data model has expected safe fields', () => {
    // The save/load functions only persist safe fields.
    assert.match(SERVICE_JS, /platform/);
    assert.match(SERVICE_JS, /accountId/);
    assert.match(SERVICE_JS, /accountName/);
    assert.match(SERVICE_JS, /accelerator/);
    assert.match(SERVICE_JS, /enabled/);
});

// ── 4. Conflict and error messages ───────────────────────────────────────────

test('accountShortcuts service checks for internal conflicts', () => {
    assert.match(SERVICE_JS, /conflict/i);
});

test('accountShortcuts service handles globalShortcut.register returning false', () => {
    assert.match(SERVICE_JS, /already in use by another application/i);
});

// ── 5. accountsHandler exports switchAccountByPlatform ───────────────────────

test('accountsHandler exports switchAccountByPlatform', () => {
    assert.match(HANDLER_JS, /switchAccountByPlatform/);
    assert.match(HANDLER_JS, /module\.exports.*switchAccountByPlatform/);
});

test('accountsHandler.switchAccountByPlatform covers all 7 platforms', () => {
    const fnStart = HANDLER_JS.indexOf('function switchAccountByPlatform');
    const fn = HANDLER_JS.slice(fnStart, fnStart + 600);
    assert.match(fn, /steam/);
    assert.match(fn, /epic/);
    assert.match(fn, /ea/);
    assert.match(fn, /riot/);
    assert.match(fn, /ubisoft/);
    assert.match(fn, /discord/);
    assert.match(fn, /rockstar/);
});

// ── 6. accountShortcutHandlers.js IPC handlers registered ───────────────────

test('main.js registers account-shortcuts:list IPC handler', () => {
    assert.match(ACCOUNT_SHORTCUT_HANDLERS_JS, /account-shortcuts:list/);
});

test('main.js registers account-shortcuts:set IPC handler', () => {
    assert.match(ACCOUNT_SHORTCUT_HANDLERS_JS, /account-shortcuts:set/);
});

test('main.js registers account-shortcuts:clear IPC handler', () => {
    assert.match(ACCOUNT_SHORTCUT_HANDLERS_JS, /account-shortcuts:clear/);
});

test('main.js registers account-shortcuts:validate IPC handler', () => {
    assert.match(ACCOUNT_SHORTCUT_HANDLERS_JS, /account-shortcuts:validate/);
});

test('main.js calls accountShortcuts.registerAll on startup', () => {
    assert.match(MAIN_JS, /accountShortcuts\.registerAll/);
});

test('main.js calls accountShortcuts.unregisterAll in before-quit', () => {
    const quitBlock = MAIN_JS.slice(
        MAIN_JS.indexOf("app.on('before-quit'"),
        MAIN_JS.indexOf("app.on('before-quit'") + 1600
    );
    assert.match(quitBlock, /accountShortcuts\.unregisterAll/);
});

test('main.js imports switchAccountByPlatform from accountsHandler', () => {
    assert.match(MAIN_JS, /switchAccountByPlatform/);
});

test('main.js shows notification in shortcut callback', () => {
    const regBlock = MAIN_JS.slice(
        MAIN_JS.indexOf('accountShortcuts.registerAll'),
        MAIN_JS.indexOf('accountShortcuts.registerAll') + 400
    );
    assert.match(regBlock, /Notification|notification/i);
});

// ── 7. preload.js exposes accountShortcuts ───────────────────────────────────

test('preload.js exposes accountShortcuts object', () => {
    assert.match(PRELOAD_JS, /accountShortcuts/);
});

test('preload.js exposes accountShortcuts.list', () => {
    const block = PRELOAD_JS.slice(
        PRELOAD_JS.indexOf('accountShortcuts'),
        PRELOAD_JS.indexOf('accountShortcuts') + 400
    );
    assert.match(block, /list/);
});

test('preload.js exposes accountShortcuts.set', () => {
    const block = PRELOAD_JS.slice(
        PRELOAD_JS.indexOf('accountShortcuts'),
        PRELOAD_JS.indexOf('accountShortcuts') + 400
    );
    assert.match(block, /set/);
});

test('preload.js exposes accountShortcuts.clear', () => {
    const block = PRELOAD_JS.slice(
        PRELOAD_JS.indexOf('accountShortcuts'),
        PRELOAD_JS.indexOf('accountShortcuts') + 400
    );
    assert.match(block, /clear/);
});

test('preload.js exposes accountShortcuts.validate', () => {
    const block = PRELOAD_JS.slice(
        PRELOAD_JS.indexOf('accountShortcuts'),
        PRELOAD_JS.indexOf('accountShortcuts') + 400
    );
    assert.match(block, /validate/);
});

test('preload.js uses account-shortcuts:list IPC channel', () => {
    assert.match(PRELOAD_JS, /account-shortcuts:list/);
});

// ── 8. Renderer: shortcut helpers in platform-panels.js ─────────────────────

test('platform-panels.js defines _loadShortcutsMap', () => {
    assert.match(PLATFORM_PANELS_JS, /function _loadShortcutsMap/);
});

test('platform-panels.js defines _shortcutBtnHtml', () => {
    assert.match(PLATFORM_PANELS_JS, /function _shortcutBtnHtml/);
});

test('platform-panels.js defines _updateCardShortcutBtn', () => {
    assert.match(PLATFORM_PANELS_JS, /function _updateCardShortcutBtn/);
});

test('platform-panels.js defines openShortcutCaptureModal', () => {
    assert.match(PLATFORM_PANELS_JS, /function openShortcutCaptureModal/);
});

test('platform-panels.js openShortcutCaptureModal validates against API', () => {
    const fnStart = PLATFORM_PANELS_JS.indexOf('function openShortcutCaptureModal');
    const fn = PLATFORM_PANELS_JS.slice(fnStart, fnStart + 10000);
    assert.match(fn, /accountShortcuts\.set/);
    assert.match(fn, /accountShortcuts\.clear/);
});

test('platform-panels.js createAccountCard accepts shortcut param', () => {
    const fnStart = PLATFORM_PANELS_JS.indexOf('function createAccountCard');
    const sig = PLATFORM_PANELS_JS.slice(fnStart, fnStart + 80);
    assert.match(sig, /shortcut/);
});

test('platform-panels.js createSteamAccountCard accepts shortcut param', () => {
    const fnStart = PLATFORM_PANELS_JS.indexOf('function createSteamAccountCard');
    const sig = PLATFORM_PANELS_JS.slice(fnStart, fnStart + 80);
    assert.match(sig, /shortcut/);
});

test('platform-panels.js createDiscordAccountCard accepts shortcut param', () => {
    const fnStart = PLATFORM_PANELS_JS.indexOf('function createDiscordAccountCard');
    // Second occurrence is the real one (first is the duplicate comment)
    const first = PLATFORM_PANELS_JS.indexOf('function createDiscordAccountCard');
    const second = PLATFORM_PANELS_JS.indexOf('function createDiscordAccountCard', first + 1);
    const fn = second > -1 ? PLATFORM_PANELS_JS.slice(second, second + 80) : PLATFORM_PANELS_JS.slice(first, first + 80);
    assert.match(fn, /shortcut/);
});

test('platform-panels.js renders _shortcutBtnHtml inside account cards', () => {
    assert.match(PLATFORM_PANELS_JS, /_shortcutBtnHtml\(shortcut\)/);
});

test('platform-panels.js wires shortcut button click on createAccountCard', () => {
    const fnStart = PLATFORM_PANELS_JS.indexOf('function createAccountCard');
    const fn = PLATFORM_PANELS_JS.slice(fnStart, fnStart + 4000);
    assert.match(fn, /data-action="shortcut"/);
    assert.match(fn, /openShortcutCaptureModal/);
});

test('platform-panels.js wires shortcut button click on createSteamAccountCard', () => {
    const fnStart = PLATFORM_PANELS_JS.indexOf('function createSteamAccountCard');
    const fn = PLATFORM_PANELS_JS.slice(fnStart, fnStart + 4000);
    assert.match(fn, /openShortcutCaptureModal/);
});

test('platform-panels.js loadAccountsForPlatform fetches shortcuts map', () => {
    assert.match(PLATFORM_PANELS_JS, /_loadShortcutsMap/);
    assert.match(PLATFORM_PANELS_JS, /shortcutsMap\.get/);
});

test('platform-panels.js shortcut modal shows error field', () => {
    const fnStart = PLATFORM_PANELS_JS.indexOf('function openShortcutCaptureModal');
    const fn = PLATFORM_PANELS_JS.slice(fnStart, fnStart + 6000);
    assert.match(fn, /shortcut-error/);
    assert.match(fn, /errorEl\.textContent/);
});

test('platform-panels.js shortcut modal Escape key closes modal', () => {
    const fnStart = PLATFORM_PANELS_JS.indexOf('function openShortcutCaptureModal');
    const fn = PLATFORM_PANELS_JS.slice(fnStart, fnStart + 6000);
    assert.match(fn, /Escape/);
});

test('platform-panels.js shortcut modal Backspace/Delete clears capture', () => {
    const fnStart = PLATFORM_PANELS_JS.indexOf('function openShortcutCaptureModal');
    const fn = PLATFORM_PANELS_JS.slice(fnStart, fnStart + 6000);
    assert.match(fn, /Backspace/);
    assert.match(fn, /Delete/);
});

// ── 9. CSS styles present ────────────────────────────────────────────────────

test('accounts.css defines .acc-shortcut-btn', () => {
    assert.match(ACC_CSS, /\.acc-shortcut-btn/);
});

test('accounts.css defines .acc-shortcut-pill', () => {
    assert.match(ACC_CSS, /\.acc-shortcut-pill/);
});

test('accounts.css defines .shortcut-capture-box', () => {
    assert.match(ACC_CSS, /\.shortcut-capture-box/);
});

test('accounts.css defines .shortcut-error', () => {
    assert.match(ACC_CSS, /\.shortcut-error/);
});

test('accounts.css has-shortcut variant styling', () => {
    assert.match(ACC_CSS, /\.acc-shortcut-btn\.has-shortcut/);
});

// ── 10. validateShortcutCapture — renderer-side validation ──────────────────

test('platform-panels.js defines validateShortcutCapture', () => {
    assert.match(PLATFORM_PANELS_JS, /function validateShortcutCapture/);
});

test('validateShortcutCapture: Ctrl+K is valid with one modifier', () => {
    const fnStart = PLATFORM_PANELS_JS.indexOf('function validateShortcutCapture');
    const fn = PLATFORM_PANELS_JS.slice(fnStart, fnStart + 3000);
    assert.match(fn, /normMods\.length < 1/);
    assert.doesNotMatch(fn, /normMods\.length < 2/);
});

test('validateShortcutCapture: blocks Ctrl+C, Ctrl+S, Alt+Tab', () => {
    const fnStart = PLATFORM_PANELS_JS.indexOf('function validateShortcutCapture');
    const fn = PLATFORM_PANELS_JS.slice(fnStart, fnStart + 2000);
    assert.match(fn, /Ctrl\+C/);
    assert.match(fn, /Ctrl\+S/);
    assert.match(fn, /Alt\+Tab/);
});

test('validateShortcutCapture: rejects Escape/Backspace/Delete as main key', () => {
    const fnStart = PLATFORM_PANELS_JS.indexOf('function validateShortcutCapture');
    const fn = PLATFORM_PANELS_JS.slice(fnStart, fnStart + 2000);
    assert.match(fn, /REJECT_KEYS/);
    assert.match(fn, /escape/);
    assert.match(fn, /backspace/);
});

test('validateShortcutCapture: returns { valid, message, normalized }', () => {
    const fnStart = PLATFORM_PANELS_JS.indexOf('function validateShortcutCapture');
    const fn = PLATFORM_PANELS_JS.slice(fnStart, fnStart + 2000);
    assert.match(fn, /valid:/);
    assert.match(fn, /message:/);
    assert.match(fn, /normalized:/);
});

test('validateShortcutCapture: no-modifier shortcut error suggests one-modifier example', () => {
    const fnStart = PLATFORM_PANELS_JS.indexOf('function validateShortcutCapture');
    const fn = PLATFORM_PANELS_JS.slice(fnStart, fnStart + 2000);
    // Must produce a friendly example like "Ctrl + H"
    assert.match(fn, /for example/i);
    assert.match(fn, /Ctrl/);
});

test('validateShortcutCapture: display format uses spaces around plus', () => {
    const fnStart = PLATFORM_PANELS_JS.indexOf('function validateShortcutCapture');
    const fn = PLATFORM_PANELS_JS.slice(fnStart, fnStart + 3000);
    // Joins with ' + ' not '+'
    assert.match(fn, /join\(' \+ '\)/);
});

// ── 11. Modal UI wired to validateShortcutCapture ───────────────────────────

test('modal calls validateShortcutCapture in keydown handler', () => {
    const fnStart = PLATFORM_PANELS_JS.indexOf('function openShortcutCaptureModal');
    const fn = PLATFORM_PANELS_JS.slice(fnStart, fnStart + 6000);
    assert.match(fn, /validateShortcutCapture/);
});

test('modal uses _refreshUI to sync state to DOM', () => {
    const fnStart = PLATFORM_PANELS_JS.indexOf('function openShortcutCaptureModal');
    const fn = PLATFORM_PANELS_JS.slice(fnStart, fnStart + 6000);
    assert.match(fn, /_refreshUI/);
});

test('modal applies is-valid class to capture box', () => {
    const fnStart = PLATFORM_PANELS_JS.indexOf('function openShortcutCaptureModal');
    const fn = PLATFORM_PANELS_JS.slice(fnStart, fnStart + 6000);
    assert.match(fn, /is-valid/);
});

test('modal applies is-invalid class to capture box', () => {
    const fnStart = PLATFORM_PANELS_JS.indexOf('function openShortcutCaptureModal');
    const fn = PLATFORM_PANELS_JS.slice(fnStart, fnStart + 6000);
    assert.match(fn, /is-invalid/);
});

test('modal disables Save button when capturedValid is false', () => {
    const fnStart = PLATFORM_PANELS_JS.indexOf('function openShortcutCaptureModal');
    const fn = PLATFORM_PANELS_JS.slice(fnStart, fnStart + 6000);
    // The _refreshUI function sets saveBtn.disabled = true for invalid/empty state.
    assert.match(fn, /saveBtn\.disabled = true/);
    assert.match(fn, /saveBtn\.disabled = false/);
});

test('modal save handler guards on capturedValid before calling API', () => {
    const fnStart = PLATFORM_PANELS_JS.indexOf('function openShortcutCaptureModal');
    const fn = PLATFORM_PANELS_JS.slice(fnStart, fnStart + 8000);
    assert.match(fn, /capturedValid/);
    // The guard: if (!capturedRaw || !capturedValid)
    assert.match(fn, /!capturedValid/);
});

test('modal shows placeholder text when nothing captured', () => {
    const fnStart = PLATFORM_PANELS_JS.indexOf('function openShortcutCaptureModal');
    const fn = PLATFORM_PANELS_JS.slice(fnStart, fnStart + 6000);
    assert.match(fn, /Press a shortcut like/);
});

test('modal tracks capturedRaw separately from display', () => {
    const fnStart = PLATFORM_PANELS_JS.indexOf('function openShortcutCaptureModal');
    const fn = PLATFORM_PANELS_JS.slice(fnStart, fnStart + 6000);
    assert.match(fn, /capturedRaw/);
    assert.match(fn, /capturedDisplay/);
});

// ── 12. CSS: is-valid / is-invalid states ────────────────────────────────────

test('accounts.css defines .shortcut-capture-box.is-valid', () => {
    assert.match(ACC_CSS, /\.shortcut-capture-box\.is-valid/);
});

test('accounts.css defines .shortcut-capture-box.is-invalid', () => {
    assert.match(ACC_CSS, /\.shortcut-capture-box\.is-invalid/);
});

test('accounts.css is-valid uses green border/background', () => {
    const block = ACC_CSS.slice(
        ACC_CSS.indexOf('.shortcut-capture-box.is-valid'),
        ACC_CSS.indexOf('.shortcut-capture-box.is-valid') + 200
    );
    // Green colour signature
    assert.match(block, /18,\s*206,\s*24/);
});

test('accounts.css is-invalid uses red border/background', () => {
    const block = ACC_CSS.slice(
        ACC_CSS.indexOf('.shortcut-capture-box.is-invalid'),
        ACC_CSS.indexOf('.shortcut-capture-box.is-invalid') + 200
    );
    // Red colour signature
    assert.match(block, /255,\s*76,\s*96/);
});

test('accounts.css shortcut-save-btn:disabled reduces opacity', () => {
    assert.match(ACC_CSS, /\.shortcut-save-btn:disabled/);
    const block = ACC_CSS.slice(
        ACC_CSS.indexOf('.shortcut-save-btn:disabled'),
        ACC_CSS.indexOf('.shortcut-save-btn:disabled') + 150
    );
    assert.match(block, /opacity/);
    assert.match(block, /cursor:\s*not-allowed/);
});

// ── 13. Main-process validator is still enforced ─────────────────────────────

test('main-process accountShortcuts.setShortcut validates before registering', () => {
    // The service must call validateAccelerator before touching globalShortcut.
    const fnStart = SERVICE_JS.indexOf('async function setShortcut');
    const fn = SERVICE_JS.slice(fnStart, fnStart + 600);
    assert.match(fn, /validateAccelerator/);
    assert.match(fn, /!val\.valid/);
});

test('main-process IPC set handler wraps setShortcut and returns error', () => {
    const block = ACCOUNT_SHORTCUT_HANDLERS_JS.slice(
        ACCOUNT_SHORTCUT_HANDLERS_JS.indexOf("'account-shortcuts:set'"),
        ACCOUNT_SHORTCUT_HANDLERS_JS.indexOf("'account-shortcuts:set'") + 200
    );
    assert.match(block, /setShortcut/);
    assert.match(block, /status.*error|error.*status/);
});
