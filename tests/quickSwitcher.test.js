'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const path   = require('path');
const Module = require('module');

// ── Electron stub ─────────────────────────────────────────────────────────────

const _electronStub = {
    app: {
        getPath: () => '/tmp/baddel-test-qs',
        on: () => {},
    },
    globalShortcut: {
        register: () => true,
        unregister: () => {},
    },
    screen: {
        getCursorScreenPoint: () => ({ x: 960, y: 540 }),
        getDisplayNearestPoint: () => ({
            workArea: { x: 0, y: 0, width: 1920, height: 1040 },
        }),
    },
    BrowserWindow: class {
        constructor() {
            this._visible = false;
            this._destroyed = false;
            this.webContents = { once: () => {}, send: () => {} };
        }
        loadFile()   {}
        show()       { this._visible = true; }
        hide()       { this._visible = false; }
        focus()      {}
        destroy()    { this._destroyed = true; }
        isDestroyed(){ return this._destroyed; }
        isVisible()  { return this._visible; }
        isFocused()  { return false; }
        getSize()    { return [460, 560]; }
        setBounds()  {}
        on(ev, cb)   { if (ev === 'closed') this._onClosed = cb; }
    },
    ipcRenderer: {
        invoke: () => Promise.resolve({}),
        on: () => {},
    },
};

function _mockElectron(fn) {
    const real = Module._load;
    Module._load = (req, ...rest) => {
        if (req === 'electron') return _electronStub;
        return real(req, ...rest);
    };
    try { return fn(); } finally { Module._load = real; }
}

// ── quickSwitcherSettings.js ──────────────────────────────────────────────────

test('quickSwitcherSettings: DEFAULTS has expected keys', () => {
    const { DEFAULTS } = _mockElectron(() => require('../services/quickSwitcherSettings'));
    assert.ok('enabled' in DEFAULTS);
    assert.ok('accelerator' in DEFAULTS);
    assert.ok('position' in DEFAULTS);
    assert.ok('closeAfterSwitch' in DEFAULTS);
    assert.ok('showSearchOnOpen' in DEFAULTS);
    assert.equal(DEFAULTS.accelerator, 'Ctrl+Alt+B');
    assert.equal(DEFAULTS.position,    'right');
    assert.equal(DEFAULTS.version,     1);
});

test('quickSwitcherSettings: VALID_POSITIONS contains expected values', () => {
    const { VALID_POSITIONS } = _mockElectron(() => require('../services/quickSwitcherSettings'));
    for (const p of ['right', 'center', 'left', 'top', 'bottom']) {
        assert.ok(VALID_POSITIONS.has(p), `missing position: ${p}`);
    }
});

test('quickSwitcherSettings: exports load and save', () => {
    const m = _mockElectron(() => require('../services/quickSwitcherSettings'));
    assert.equal(typeof m.load, 'function');
    assert.equal(typeof m.save, 'function');
    assert.equal(typeof m.invalidateCache, 'function');
});

// ── quickSwitcher.js — structure & safety ─────────────────────────────────────

test('quickSwitcher: exports expected functions', () => {
    const m = _mockElectron(() => {
        // Also stub quickSwitcherSettings to avoid FS access
        const real = Module._load;
        Module._load = (req, ...rest) => {
            if (req === 'electron') return _electronStub;
            return real(req, ...rest);
        };
        return require('../services/quickSwitcher');
    });
    for (const fn of [
        'createQuickSwitcherWindow', 'showQuickSwitcherOverlay', 'hideQuickSwitcherOverlay',
        'toggleQuickSwitcherOverlay', 'destroyQuickSwitcherWindow',
        'getQuickSwitcherAccounts', 'registerQuickSwitcherHotkey', 'unregisterQuickSwitcherHotkey',
        'getWindow', 'isReady',
    ]) {
        assert.equal(typeof m[fn], 'function', `missing export: ${fn}`);
    }
});

test('quickSwitcher: getWindow returns null before window is created', () => {
    const m = _mockElectron(() => require('../services/quickSwitcher'));
    assert.equal(m.getWindow(), null);
});

test('quickSwitcher: unregisterQuickSwitcherHotkey is idempotent (no throw)', () => {
    const m = _mockElectron(() => require('../services/quickSwitcher'));
    assert.doesNotThrow(() => m.unregisterQuickSwitcherHotkey());
    assert.doesNotThrow(() => m.unregisterQuickSwitcherHotkey());
});

// ── accountsHandler.js — getAllAccountsForQuickSwitcher ───────────────────────

test('accountsHandler: exports getAllAccountsForQuickSwitcher', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'accountsHandler.js'), 'utf8');
    assert.ok(src.includes('getAllAccountsForQuickSwitcher'), 'function defined');
    assert.ok(src.includes("module.exports = {") && src.includes('getAllAccountsForQuickSwitcher'), 'exported');
});

test('accountsHandler: getAllAccountsForQuickSwitcher uses safe fields only', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'accountsHandler.js'), 'utf8');
    // Should map safe fields
    assert.ok(src.includes('accountId:'), 'maps accountId');
    assert.ok(src.includes('accountName:'), 'maps accountName');
    assert.ok(src.includes('isActive:'), 'maps isActive');
    // Should NOT expose passwords or tokens
    assert.ok(!src.includes('password:'), 'no password field');
    assert.ok(!src.includes('token:'), 'no token field');
});

test('accountsHandler: getAllAccountsForQuickSwitcher handles all seven platforms', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'accountsHandler.js'), 'utf8');
    const after = src.slice(src.indexOf('async function getAllAccountsForQuickSwitcher'));
    for (const p of ['steam', 'epic', 'ea', 'riot', 'ubisoft', 'discord', 'rockstar']) {
        assert.ok(after.includes(`'${p}'`), `platform missing: ${p}`);
    }
});

test('accountsHandler: getAllAccountsForQuickSwitcher wraps each platform in try/catch', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'accountsHandler.js'), 'utf8');
    const fnSrc = src.slice(src.indexOf('async function getAllAccountsForQuickSwitcher'));
    const tryCatches = (fnSrc.match(/\} catch \{\}/g) || []).length;
    assert.ok(tryCatches >= 7, `expected ≥7 try/catch blocks, got ${tryCatches}`);
});

// ── main.js — IPC handlers ────────────────────────────────────────────────────

test('main.js: imports quickSwitcher and quickSwitcherSettings', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8').slice(0, 2000);
    assert.ok(src.includes("require('./services/quickSwitcher')"), 'quickSwitcher import');
    assert.ok(src.includes("require('./services/quickSwitcherSettings')"), 'quickSwitcherSettings import');
});

test('main.js: imports screen from electron', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8').slice(0, 500);
    assert.ok(src.includes('screen'), 'screen in electron destructure');
});

test('main.js: registers all quick-switcher IPC channels', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    const channels = [
        'quick-switcher:get-settings', 'quick-switcher:set-settings',
        'quick-switcher:set-hotkey', 'quick-switcher:clear-hotkey',
        'quick-switcher:validate-hotkey', 'quick-switcher:list-accounts',
        'quick-switcher:switch-account', 'quick-switcher:hide', 'quick-switcher:toggle',
    ];
    for (const ch of channels) {
        assert.ok(src.includes(`'${ch}'`), `missing IPC channel: ${ch}`);
    }
});

test('main.js: tray has "Quick Switch" menu item', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    const tray = src.slice(src.indexOf('function createTray'), src.indexOf('function createTray') + 600);
    assert.ok(tray.includes('Quick Switch'), 'tray has Quick Switch item');
});

test('main.js: before-quit unregisters QS hotkey and destroys window', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    const quitSrc = src.slice(src.indexOf("app.on('before-quit'"), src.indexOf("app.on('before-quit'") + 400);
    assert.ok(quitSrc.includes('unregisterQuickSwitcherHotkey'), 'hotkey unregistered on quit');
    assert.ok(quitSrc.includes('destroyQuickSwitcherWindow'), 'window destroyed on quit');
});

test('main.js: switch-account IPC validates platform before calling switchAccountByPlatform', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    const switchSrc = src.slice(src.indexOf("'quick-switcher:switch-account'"), src.indexOf("'quick-switcher:switch-account'") + 600);
    assert.ok(switchSrc.includes('assertPlatform'), 'assertPlatform called');
    assert.ok(switchSrc.includes('assertString'), 'assertString called for accountId');
});

test('main.js: switch-account IPC does not log accountId in analytics', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    const switchSrc = src.slice(src.indexOf("'quick-switcher:switch-account'"), src.indexOf("'quick-switcher:switch-account'") + 800);
    // analytics.track call should not pass accountId or accountName
    assert.ok(!switchSrc.includes('accountId:'), 'no accountId in analytics');
    assert.ok(!switchSrc.includes('accountName:'), 'no accountName in analytics');
});

test('main.js: set-hotkey checks conflict with Phase 1 shortcuts', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    const hotkeySrc = src.slice(src.indexOf("'quick-switcher:set-hotkey'"), src.indexOf("'quick-switcher:set-hotkey'") + 900);
    assert.ok(hotkeySrc.includes('accountShortcuts.getAll()'), 'checks Phase 1 shortcuts');
    assert.ok(hotkeySrc.includes('Conflicts with'), 'returns conflict message');
});

// ── preload.js — quickSwitcher API ────────────────────────────────────────────

test('preload.js: exposes quickSwitcher namespace', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
    assert.ok(src.includes('quickSwitcher:'), 'quickSwitcher namespace');
});

test('preload.js: quickSwitcher exposes all required methods', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
    const qsSrc = src.slice(src.indexOf('quickSwitcher:'), src.indexOf('quickSwitcher:') + 1200);
    for (const method of ['getSettings', 'setSettings', 'setHotkey', 'clearHotkey',
        'validateHotkey', 'listAccounts', 'switchAccount', 'hide', 'toggle', 'onShow']) {
        assert.ok(qsSrc.includes(method), `missing preload method: ${method}`);
    }
});

test('preload.js: onShow uses ipcRenderer.on (push from main)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
    const qsSrc = src.slice(src.indexOf('quickSwitcher:'), src.indexOf('quickSwitcher:') + 1200);
    assert.ok(qsSrc.includes("ipcRenderer.on('qs:show'"), 'onShow uses ipcRenderer.on');
});

test('preload.js: switchAccount uses invoke not send (awaitable)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
    const qsSrc = src.slice(src.indexOf('quickSwitcher:'), src.indexOf('quickSwitcher:') + 1200);
    assert.ok(qsSrc.includes("ipcRenderer.invoke('quick-switcher:switch-account'"), 'switchAccount uses invoke');
});

// ── overlay HTML ──────────────────────────────────────────────────────────────

test('quick-switcher.html: exists and has required ids', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'quick-switcher.html'), 'utf8');
    assert.ok(src.includes('id="quickSwitcherApp"'), 'app root id');
    assert.ok(src.includes('id="quickSwitcherSearch"'), 'search input id');
    assert.ok(src.includes('id="quickSwitcherList"'), 'list id');
    assert.ok(src.includes('id="quickSwitcherError"'), 'error element id');
    assert.ok(src.includes('id="quickSwitcherClose"'), 'close button id');
});

test('quick-switcher.html: premium structure — shell, panel, header, brand, footer', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'quick-switcher.html'), 'utf8');
    assert.ok(src.includes('quick-switcher-shell'), 'outer shell for animation');
    assert.ok(src.includes('quick-switcher-panel'), 'glass panel element');
    assert.ok(src.includes('quick-switcher-header'), 'header element');
    assert.ok(src.includes('quick-switcher-brand'), 'brand area');
    assert.ok(src.includes('quick-switcher-footer'), 'footer element');
});

test('quick-switcher.html: brand includes logo, title, subtitle, hotkey hint', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'quick-switcher.html'), 'utf8');
    assert.ok(src.includes('quick-switcher-logo'), 'logo element');
    assert.ok(src.includes('quick-switcher-title'), 'title span');
    assert.ok(src.includes('quick-switcher-subtitle'), 'subtitle span');
    assert.ok(src.includes('qs-hotkey-hint'), 'hotkey hint (replaces GLOBAL pill)');
});

test('quick-switcher.html: search input inside quick-switcher-search-wrap', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'quick-switcher.html'), 'utf8');
    assert.ok(src.includes('quick-switcher-search-wrap'), 'search wrap');
    assert.ok(src.includes('quick-switcher-search'), 'search input class');
});

test('quick-switcher.html: footer has qs-keycap elements', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'quick-switcher.html'), 'utf8');
    assert.ok(src.includes('qs-keycap'), 'keycap elements in footer');
});

test('quick-switcher.html: loads quick-switcher.css and quick-switcher.js', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'quick-switcher.html'), 'utf8');
    assert.ok(src.includes('quick-switcher.css'), 'css link');
    assert.ok(src.includes('quick-switcher.js'), 'script tag');
});

test('quick-switcher.html: has CSP meta tag', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'quick-switcher.html'), 'utf8');
    assert.ok(src.includes('Content-Security-Policy'), 'CSP present');
});

test('quick-switcher.html: shows keyboard hint footer', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'quick-switcher.html'), 'utf8');
    assert.ok(src.includes('navigate') || src.includes('Esc'), 'keyboard hints');
});

// ── overlay CSS ───────────────────────────────────────────────────────────────

test('quick-switcher.css: uses green accent #12CE18', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'quick-switcher.css'), 'utf8');
    assert.ok(src.includes('#12CE18') || src.includes('#12ce18'), 'green accent');
});

test('quick-switcher.css: has .is-selected and .is-active states', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'quick-switcher.css'), 'utf8');
    assert.ok(src.includes('.is-selected'), '.is-selected');
    assert.ok(src.includes('.is-active'),   '.is-active');
});

test('quick-switcher.css: has .qs-active-badge and .qs-shortcut-pill', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'quick-switcher.css'), 'utf8');
    assert.ok(src.includes('.qs-active-badge'), '.qs-active-badge');
    assert.ok(src.includes('.qs-shortcut-pill'), '.qs-shortcut-pill');
});

test('quick-switcher.css: transparent body background (overlay window)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'quick-switcher.css'), 'utf8');
    assert.ok(src.includes('background: transparent'), 'transparent body');
});

test('quick-switcher.css: has reduced-motion media query', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'quick-switcher.css'), 'utf8');
    assert.ok(src.includes('prefers-reduced-motion'), 'reduced-motion support');
});

test('quick-switcher.css: spinner animation defined', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'quick-switcher.css'), 'utf8');
    assert.ok(src.includes('@keyframes qs-spin') || src.includes('.qs-spinner'), 'spinner');
});

test('quick-switcher.css: has .quick-switcher-panel (glass card)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'quick-switcher.css'), 'utf8');
    assert.ok(src.includes('.quick-switcher-panel'), '.quick-switcher-panel defined');
});

test('quick-switcher.css: has .qs-account-row (replaces .qs-account-item)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'quick-switcher.css'), 'utf8');
    assert.ok(src.includes('.qs-account-row'), '.qs-account-row defined');
    assert.ok(src.includes('.qs-account-row.is-active'), '.qs-account-row.is-active');
    assert.ok(src.includes('.qs-account-row.is-selected'), '.qs-account-row.is-selected');
});

test('quick-switcher.css: has .quick-switcher-footer', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'quick-switcher.css'), 'utf8');
    assert.ok(src.includes('.quick-switcher-footer'), '.quick-switcher-footer');
});

test('quick-switcher.css: has .qs-account-icon-wrap for platform icon container', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'quick-switcher.css'), 'utf8');
    assert.ok(src.includes('.qs-account-icon-wrap'), '.qs-account-icon-wrap');
});

test('quick-switcher.css: has .qs-platform-group and .qs-platform-header', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'quick-switcher.css'), 'utf8');
    assert.ok(src.includes('.qs-platform-group'), '.qs-platform-group');
    assert.ok(src.includes('.qs-platform-header'), '.qs-platform-header');
    assert.ok(src.includes('.qs-platform-count'), '.qs-platform-count');
});

test('quick-switcher.css: active row has .qs-row-indicator left accent bar', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'quick-switcher.css'), 'utf8');
    assert.ok(src.includes('.qs-row-indicator'), '.qs-row-indicator defined');
    assert.ok(src.includes('.qs-account-row.is-active .qs-row-indicator'), 'indicator shown on active row');
});

test('quick-switcher.css: .qs-enter-hint shown only on hover/selected', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'quick-switcher.css'), 'utf8');
    assert.ok(src.includes('.qs-enter-hint'), '.qs-enter-hint defined');
    assert.ok(src.includes('opacity: 0'), 'enter hint hidden by default');
});

test('quick-switcher.css: entrance animation defined', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'quick-switcher.css'), 'utf8');
    assert.ok(src.includes('@keyframes qs-enter') || src.includes('qs-enter'), 'entrance animation');
});

test('quick-switcher.css: error bar styled as alert when non-empty', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'quick-switcher.css'), 'utf8');
    assert.ok(src.includes('.qs-error-bar'), '.qs-error-bar defined');
    assert.ok(src.includes(':not(:empty)'), 'styled when non-empty');
});

test('quick-switcher.css: .qs-keycap defined for footer hints', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'quick-switcher.css'), 'utf8');
    assert.ok(src.includes('.qs-keycap'), '.qs-keycap defined');
});

// ── overlay renderer JS ───────────────────────────────────────────────────────

test('quick-switcher.js: calls api.listAccounts() to load data', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'quick-switcher.js'), 'utf8');
    assert.ok(src.includes('api.listAccounts()'), 'listAccounts call');
});

test('quick-switcher.js: handles keyboard navigation (ArrowUp/ArrowDown/Enter/Escape)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'quick-switcher.js'), 'utf8');
    assert.ok(src.includes("'ArrowDown'"), 'ArrowDown');
    assert.ok(src.includes("'ArrowUp'"),   'ArrowUp');
    assert.ok(src.includes("'Enter'"),     'Enter');
    assert.ok(src.includes("'Escape'"),    'Escape');
});

test('quick-switcher.js: Escape calls api.hide()', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'quick-switcher.js'), 'utf8');
    const escSrc = src.slice(src.indexOf("'Escape'"), src.indexOf("'Escape'") + 80);
    assert.ok(escSrc.includes('api.hide()'), 'Escape hides overlay');
});

test('quick-switcher.js: _switchAccount calls api.switchAccount with platform and accountId', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'quick-switcher.js'), 'utf8');
    assert.ok(src.includes('api.switchAccount('), 'switchAccount called');
    assert.ok(src.includes('platform:') && src.includes('accountId:'), 'payload has platform+accountId');
});

test('quick-switcher.js: hides overlay after successful switch when closeAfterSwitch=true', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'quick-switcher.js'), 'utf8');
    assert.ok(src.includes('_closeAfterSwitch'), '_closeAfterSwitch flag');
    assert.ok(src.includes("api.hide()"), 'api.hide() called on success');
});

test('quick-switcher.js: shows error message on failed switch without hiding', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'quick-switcher.js'), 'utf8');
    const switchSrc = src.slice(src.indexOf('async function _switchAccount'), src.indexOf('async function _switchAccount') + 500);
    assert.ok(switchSrc.includes('errorEl.textContent'), 'sets error text on failure');
});

test('quick-switcher.js: search filter passes query to _buildFlat', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'quick-switcher.js'), 'utf8');
    assert.ok(src.includes('_buildFlat('), '_buildFlat called');
    assert.ok(src.includes('searchEl.value'), 'uses search input value');
});

test('quick-switcher.js: does not expose passwords or raw credentials', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'quick-switcher.js'), 'utf8');
    assert.ok(!src.includes('password'), 'no password reference');
    assert.ok(!src.includes('token'),    'no token reference');
});

test('quick-switcher.js: listens for qs:show via api.onShow', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'quick-switcher.js'), 'utf8');
    assert.ok(src.includes('api.onShow('), 'onShow listener');
});

test('quick-switcher.js: HTML-escapes account names before inserting into DOM', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'quick-switcher.js'), 'utf8');
    assert.ok(src.includes('_esc('), '_esc helper used for account names');
    assert.ok(src.includes("replace(/&/g, '&amp;')"), '_esc replaces &');
    assert.ok(src.includes("replace(/</g, '&lt;')"), '_esc replaces <');
});

test('quick-switcher.js: renders .qs-account-row buttons (not plain divs)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'quick-switcher.js'), 'utf8');
    assert.ok(src.includes('qs-account-row'), 'qs-account-row class used');
    assert.ok(src.includes('<button'), 'button element used for rows');
});

test('quick-switcher.js: renders account icon wrap with real platform icon', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'quick-switcher.js'), 'utf8');
    assert.ok(src.includes('qs-account-icon-wrap'), '.qs-account-icon-wrap rendered');
    assert.ok(src.includes('getPlatformIcon('), 'getPlatformIcon called in row');
    assert.ok(src.includes('function getPlatformIcon'), 'getPlatformIcon defined');
});

test('quick-switcher.js: PLATFORM_ICONS maps all platforms to real bundled asset paths', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'quick-switcher.js'), 'utf8');
    assert.ok(src.includes('PLATFORM_ICONS'), 'PLATFORM_ICONS defined');
    for (const p of ['steam', 'epic', 'riot', 'ea', 'ubisoft', 'discord', 'rockstar']) {
        assert.ok(src.includes(`${p}:`), `PLATFORM_ICONS has platform: ${p}`);
    }
    assert.ok(src.includes('../assets/'), 'uses local asset paths');
});

test('quick-switcher.js: groups accounts into .qs-platform-group sections', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'quick-switcher.js'), 'utf8');
    assert.ok(src.includes('qs-platform-group'), 'platform group wrapper');
});

test('quick-switcher.js: platform header includes count of accounts', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'quick-switcher.js'), 'utf8');
    assert.ok(src.includes('qs-platform-count'), 'platform count badge');
    assert.ok(src.includes('.count'), 'count from flat item');
});

test('quick-switcher.js: uses event delegation on listEl (no per-row addEventListener)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'quick-switcher.js'), 'utf8');
    assert.ok(src.includes("listEl.addEventListener('click'"), 'delegated click on list');
    assert.ok(src.includes('.closest('), 'closest() for delegation');
});

test('quick-switcher.js: _highlightSelected uses .qs-account-row selector', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'quick-switcher.js'), 'utf8');
    const fnSrc = src.slice(src.indexOf('function _highlightSelected'), src.indexOf('function _highlightSelected') + 200);
    assert.ok(fnSrc.includes('qs-account-row'), '_highlightSelected targets .qs-account-row');
});

test('quick-switcher.js: empty state renders polished message with icon', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'quick-switcher.js'), 'utf8');
    assert.ok(src.includes('_emptyStateHtml'), '_emptyStateHtml function');
    assert.ok(src.includes('qs-empty'), 'qs-empty class');
    assert.ok(src.includes('No matching accounts') || src.includes('No accounts found'), 'friendly empty text');
});

test('quick-switcher.js: account row includes .qs-account-main, .qs-account-side, .qs-enter-hint', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'quick-switcher.js'), 'utf8');
    assert.ok(src.includes('qs-account-main'), '.qs-account-main');
    assert.ok(src.includes('qs-account-side'), '.qs-account-side');
    assert.ok(src.includes('qs-enter-hint'), '.qs-enter-hint indicator');
});

// ── dashboard.html — QS settings section ─────────────────────────────────────

test('dashboard.html: has Quick Switcher settings section', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'dashboard.html'), 'utf8', { encoding: 'utf8' });
    assert.ok(src.includes('Quick Switcher'), 'QS section heading');
    assert.ok(src.includes('id="qsEnabledToggle"'), 'enabled toggle');
    assert.ok(src.includes('id="qsHotkeyDisplay"'), 'hotkey display element');
    assert.ok(src.includes('id="qsPositionSelect"'), 'position select');
    assert.ok(src.includes('id="qsCloseAfterSwitchToggle"'), 'close-after-switch toggle');
});

test('dashboard.html: hotkey Change and Reset buttons call correct functions', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'dashboard.html'), 'utf8');
    const qsSrc = src.slice(src.indexOf('Quick Switcher Overlay'), src.indexOf('Quick Switcher Overlay') + 1500);
    assert.ok(qsSrc.includes('qsChangeHotkey()'), 'Change calls qsChangeHotkey');
    assert.ok(qsSrc.includes('qsResetHotkey()'), 'Reset calls qsResetHotkey');
});

test('dashboard.html: position select has all five positions', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'dashboard.html'), 'utf8');
    const selSrc = src.slice(src.indexOf('qsPositionSelect'), src.indexOf('qsPositionSelect') + 700);
    for (const p of ['right', 'center', 'left', 'top', 'bottom']) {
        assert.ok(selSrc.includes(`value="${p}"`), `position option missing: ${p}`);
    }
});

// ── app.js — QS settings handlers ────────────────────────────────────────────

test('app.js: defines qsToggleEnabled, qsChangePosition, qsToggleCloseAfter', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'app.js'), 'utf8');
    assert.ok(src.includes('function qsToggleEnabled'), 'qsToggleEnabled');
    assert.ok(src.includes('function qsChangePosition'), 'qsChangePosition');
    assert.ok(src.includes('function qsToggleCloseAfter'), 'qsToggleCloseAfter');
});

test('app.js: defines qsChangeHotkey and qsResetHotkey', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'app.js'), 'utf8');
    assert.ok(src.includes('function qsChangeHotkey'), 'qsChangeHotkey');
    assert.ok(src.includes('function qsResetHotkey'), 'qsResetHotkey');
});

test('app.js: openSettingsModal calls _qsLoadSettings', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'app.js'), 'utf8');
    const modalSrc = src.slice(src.indexOf('async function openSettingsModal'), src.indexOf('async function openSettingsModal') + 3000);
    assert.ok(modalSrc.includes('_qsLoadSettings()'), '_qsLoadSettings called in openSettingsModal');
});

test('app.js: _openQSHotkeyModal uses shortcut-capture-box CSS classes', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'app.js'), 'utf8');
    const modalSrc = src.slice(src.indexOf('function _openQSHotkeyModal'), src.indexOf('function _openQSHotkeyModal') + 2500);
    assert.ok(modalSrc.includes('shortcut-capture-box'), 'reuses capture-box class');
    assert.ok(modalSrc.includes('is-valid'), 'is-valid state');
    assert.ok(modalSrc.includes('is-invalid'), 'is-invalid state');
});

test('app.js: _openQSHotkeyModal guards Save button when invalid', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'app.js'), 'utf8');
    const modalSrc = src.slice(src.indexOf('function _openQSHotkeyModal'), src.indexOf('function _openQSHotkeyModal') + 2500);
    assert.ok(modalSrc.includes('saveBtn.disabled = true'), 'Save disabled when invalid');
    assert.ok(modalSrc.includes('!capturedValid') || modalSrc.includes('capturedValid'), 'guards on validity');
});

test('app.js: _qsBasicValidate rejects single-modifier shortcuts', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'app.js'), 'utf8');
    const fnSrc = src.slice(src.indexOf('function _qsBasicValidate'), src.indexOf('function _qsBasicValidate') + 500);
    assert.ok(fnSrc.includes('mods.length < 2'), 'rejects < 2 modifiers');
    assert.ok(fnSrc.includes('valid: false'), 'returns invalid');
});

test('app.js: qsToggleEnabled reverts checkbox on error', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'app.js'), 'utf8');
    const fnSrc = src.slice(src.indexOf('async function qsToggleEnabled'), src.indexOf('async function qsToggleEnabled') + 300);
    assert.ok(fnSrc.includes('catch'), 'has catch block');
    assert.ok(fnSrc.includes('checkbox.checked = prev'), 'reverts checkbox on error');
});

// ── Round 2 UI polish — real assets, toned-down green ────────────────────────

test('quick-switcher.html: logo uses real Baddel app icon image', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'quick-switcher.html'), 'utf8');
    assert.ok(src.includes('app_icon.png'), 'logo references app_icon.png');
    assert.ok(src.includes('quick-switcher-logo-img'), 'logo img class present');
});

test('quick-switcher.html: has hotkey hint element (not GLOBAL pill)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'quick-switcher.html'), 'utf8');
    assert.ok(src.includes('qs-hotkey-hint'), 'qs-hotkey-hint present');
    assert.ok(!src.includes('qs-global-pill'), 'no GLOBAL pill in Round 2');
});

test('quick-switcher.css: has .qs-platform-icon for real platform icons', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'quick-switcher.css'), 'utf8');
    assert.ok(src.includes('.qs-platform-icon'), '.qs-platform-icon defined');
});

test('quick-switcher.css: has .qs-platform-heading-icon for platform group header', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'quick-switcher.css'), 'utf8');
    assert.ok(src.includes('.qs-platform-heading-icon'), '.qs-platform-heading-icon defined');
});

test('quick-switcher.css: panel border variable is neutral white, not bright green', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'quick-switcher.css'), 'utf8');
    assert.ok(src.includes('--qs-panel-border:    rgba(255, 255, 255, 0.08)'), 'panel border variable is subtle white');
    // Panel border declaration should use the variable, not a hardcoded green value
    assert.ok(src.includes('border: 1px solid var(--qs-panel-border)'), 'panel uses white border variable');
});

test('quick-switcher.css: no large panel-level green glow shadow', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'quick-switcher.css'), 'utf8');
    assert.ok(!src.includes('0 0 48px rgba(18, 206, 24'), 'no large green glow');
});

test('quick-switcher.css: has .qs-hotkey-hint style', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'quick-switcher.css'), 'utf8');
    assert.ok(src.includes('.qs-hotkey-hint'), '.qs-hotkey-hint styled');
});

test('quick-switcher.js: getPlatformIcon returns img tag with qs-platform-icon class', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'quick-switcher.js'), 'utf8');
    const fnSrc = src.slice(src.indexOf('function getPlatformIcon'), src.indexOf('function getPlatformIcon') + 300);
    assert.ok(fnSrc.includes('qs-platform-icon'), 'getPlatformIcon uses qs-platform-icon class');
    assert.ok(fnSrc.includes('<img'), 'getPlatformIcon returns img element');
});

test('quick-switcher.js: _platformHeaderHtml uses qs-platform-heading-icon img', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'quick-switcher.js'), 'utf8');
    const fnSrc = src.slice(src.indexOf('function _platformHeaderHtml'), src.indexOf('function _platformHeaderHtml') + 400);
    assert.ok(fnSrc.includes('qs-platform-heading-icon'), 'heading icon class used');
});

test('quick-switcher.js: account row includes .qs-row-indicator element', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'quick-switcher.js'), 'utf8');
    const fnSrc = src.slice(src.indexOf('function _accountRowHtml'), src.indexOf('function _accountRowHtml') + 600);
    assert.ok(fnSrc.includes('qs-row-indicator'), '.qs-row-indicator in account row HTML');
});

// ── Fixed-size overlay + transparent background ───────────────────────────────

test('quick-switcher.css: html/body background is transparent', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'quick-switcher.css'), 'utf8');
    assert.ok(src.includes('background: transparent !important'), 'html/body transparent !important');
});

test('quick-switcher.css: .quick-switcher-shell background is transparent, no flex layout', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'quick-switcher.css'), 'utf8');
    const shellSrc = src.slice(src.indexOf('.quick-switcher-shell {'), src.indexOf('.quick-switcher-shell {') + 250);
    assert.ok(shellSrc.includes('background: transparent'), 'shell is transparent');
    assert.ok(shellSrc.includes('padding: 10px'), 'shell has 10px padding for shadow room');
});

test('quick-switcher.css: .quick-switcher-panel fills full height of window', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'quick-switcher.css'), 'utf8');
    const panelSrc = src.slice(src.indexOf('.quick-switcher-panel {'), src.indexOf('.quick-switcher-panel {') + 350);
    assert.ok(panelSrc.includes('height: 100%'), 'panel height is 100%');
    assert.ok(panelSrc.includes('width: 100%'), 'panel width is 100%');
    assert.ok(!panelSrc.includes('max-height'), 'no max-height that allows shrinking');
});

test('quick-switcher.css: .quick-switcher-list uses flex:1 with min-height:0 to scroll within panel', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'quick-switcher.css'), 'utf8');
    const listSrc = src.slice(src.indexOf('.quick-switcher-list {'), src.indexOf('.quick-switcher-list {') + 200);
    assert.ok(listSrc.includes('flex: 1 1 auto'), 'list grows to fill remaining space');
    assert.ok(listSrc.includes('min-height: 0'), 'min-height:0 allows flex item to shrink for scroll');
    assert.ok(listSrc.includes('overflow-y: auto'), 'list scrolls internally');
});

// ── Compact size + Epic fix ───────────────────────────────────────────────────

test('quickSwitcher service: window width is 440–480px (compact)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'quickSwitcher.js'), 'utf8');
    const winSrc = src.slice(src.indexOf('new BrowserWindow'), src.indexOf('new BrowserWindow') + 400);
    const wMatch = winSrc.match(/width:\s*(\d+)/);
    assert.ok(wMatch, 'width defined');
    const w = Number(wMatch[1]);
    assert.ok(w >= 440 && w <= 480, `width ${w} not in 440–480 range`);
});

test('quickSwitcher service: window height is 540–580px (compact)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'quickSwitcher.js'), 'utf8');
    const winSrc = src.slice(src.indexOf('new BrowserWindow'), src.indexOf('new BrowserWindow') + 400);
    const hMatch = winSrc.match(/height:\s*(\d+)/);
    assert.ok(hMatch, 'height defined');
    const h = Number(hMatch[1]);
    assert.ok(h >= 540 && h <= 580, `height ${h} not in 540–580 range`);
});

test('quickSwitcher service: BrowserWindow is transparent with no background color', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'quickSwitcher.js'), 'utf8');
    const winSrc = src.slice(src.indexOf('new BrowserWindow'), src.indexOf('new BrowserWindow') + 400);
    assert.ok(winSrc.includes("transparent: true"), 'transparent: true');
    assert.ok(winSrc.includes("frame: false"), 'frame: false');
    assert.ok(winSrc.includes("backgroundColor: '#00000000'"), 'backgroundColor fully transparent');
});

test('quick-switcher.css: scoped Epic logo visibility rule inside .quick-switcher-panel', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'quick-switcher.css'), 'utf8');
    assert.ok(src.includes('.quick-switcher-panel') && src.includes('[data-platform="epic"]'), 'scoped Epic rule present');
    assert.ok(src.includes('filter: brightness(0) invert(1)'), 'filter inverts Epic icon to white');
});

test('quick-switcher.css: Epic fix does not target sidebar nav (not global)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'quick-switcher.css'), 'utf8');
    assert.ok(!src.includes('#nav-epic'), 'no sidebar nav-epic reference in overlay CSS');
    assert.ok(!src.includes('.epic-icon'), 'no sidebar epic-icon class in overlay CSS');
});

test('quick-switcher.css: compact account rows (min-height ≤ 50px)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'quick-switcher.css'), 'utf8');
    const rowSrc = src.slice(src.indexOf('.qs-account-row {'), src.indexOf('.qs-account-row {') + 400);
    const mhMatch = rowSrc.match(/min-height:\s*(\d+)px/);
    assert.ok(mhMatch, 'min-height defined on .qs-account-row');
    assert.ok(Number(mhMatch[1]) <= 50, `min-height ${mhMatch[1]}px should be ≤ 50`);
});

test('quick-switcher.js: _platformHeaderHtml adds data-platform to header div', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'quick-switcher.js'), 'utf8');
    const fnSrc = src.slice(src.indexOf('function _platformHeaderHtml'), src.indexOf('function _platformHeaderHtml') + 700);
    assert.ok(fnSrc.includes('data-platform='), 'data-platform on platform header div');
});
