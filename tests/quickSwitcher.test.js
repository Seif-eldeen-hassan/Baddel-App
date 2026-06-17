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
    ipcMain: {
        on: () => {},
        handle: () => {},
    },
    BrowserWindow: class {
        constructor() {
            this._visible = false;
            this._destroyed = false;
            this.webContents = { once: () => {}, send: () => {} };
        }
        loadFile()              {}
        show()                  { this._visible = true; }
        hide()                  { this._visible = false; }
        focus()                 {}
        destroy()               { this._destroyed = true; }
        isDestroyed()           { return this._destroyed; }
        isVisible()             { return this._visible; }
        isFocused()             { return false; }
        getSize()               { return [460, 560]; }
        setBounds()             {}
        setIgnoreMouseEvents()  {}
        on(ev, cb)              { if (ev === 'closed') this._onClosed = cb; }
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
    const src = fs.readFileSync(path.join(__dirname, '..', 'handlers', 'quickSwitcherHandlers.js'), 'utf8');
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
    const src = fs.readFileSync(path.join(__dirname, '..', 'handlers', 'quickSwitcherHandlers.js'), 'utf8');
    const switchSrc = src.slice(src.indexOf("'quick-switcher:switch-account'"), src.indexOf("'quick-switcher:switch-account'") + 600);
    assert.ok(switchSrc.includes('assertPlatform'), 'assertPlatform called');
    assert.ok(switchSrc.includes('assertString'), 'assertString called for accountId');
});

test('main.js: switch-account IPC does not log accountId in analytics', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'handlers', 'quickSwitcherHandlers.js'), 'utf8');
    const switchSrc = src.slice(src.indexOf("'quick-switcher:switch-account'"), src.indexOf("'quick-switcher:switch-account'") + 800);
    // analytics.track call should not pass accountId or accountName
    assert.ok(!switchSrc.includes('accountId:'), 'no accountId in analytics');
    assert.ok(!switchSrc.includes('accountName:'), 'no accountName in analytics');
});

test('main.js: set-hotkey checks conflict with Phase 1 shortcuts', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'handlers', 'quickSwitcherHandlers.js'), 'utf8');
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

test('quick-switcher.html: deck structure — overlay, deck, bar, results, hints', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'quick-switcher.html'), 'utf8');
    assert.ok(src.includes('qs-overlay'), 'overlay root element');
    assert.ok(src.includes('qs-deck'), 'deck container');
    assert.ok(src.includes('qs-bar'), 'command bar');
    assert.ok(src.includes('qs-deck-results'), 'results container');
    assert.ok(src.includes('qs-deck-hints'), 'hints line');
});

test('quick-switcher.html: bar includes label, shortcut chip, and close button', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'quick-switcher.html'), 'utf8');
    assert.ok(src.includes('qs-bar-label'), 'bar label');
    assert.ok(src.includes('qsHotkeyHint'), 'hotkey hint id');
    assert.ok(src.includes('quickSwitcherClose'), 'close button');
});

test('quick-switcher.html: search input inside bar search area', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'quick-switcher.html'), 'utf8');
    assert.ok(src.includes('qs-bar-search'), 'search area container');
    assert.ok(src.includes('qs-bar-input'), 'search input class');
});

test('quick-switcher.html: has keyboard hint line', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'quick-switcher.html'), 'utf8');
    assert.ok(src.includes('qs-deck-hints'), 'deck hints element present');
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

test('quick-switcher.css: has .qs-active-pill and .qs-shortcut-label', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'quick-switcher.css'), 'utf8');
    assert.ok(src.includes('.qs-active-pill'),    '.qs-active-pill');
    assert.ok(src.includes('.qs-shortcut-label'), '.qs-shortcut-label');
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

test('quick-switcher.css: has .qs-bar and .qs-deck (command bar card)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'quick-switcher.css'), 'utf8');
    assert.ok(src.includes('.qs-bar'), '.qs-bar defined');
    assert.ok(src.includes('.qs-deck'), '.qs-deck defined');
});

test('quick-switcher.css: has .qs-card (account card button)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'quick-switcher.css'), 'utf8');
    assert.ok(src.includes('.qs-card'), '.qs-card defined');
    assert.ok(src.includes('.qs-card.is-active'), '.qs-card.is-active');
    assert.ok(src.includes('.qs-card.is-selected'), '.qs-card.is-selected');
});

test('quick-switcher.css: has .qs-deck-hints (replaces old footer bar)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'quick-switcher.css'), 'utf8');
    assert.ok(src.includes('.qs-deck-hints'), '.qs-deck-hints defined');
});

test('quick-switcher.css: has .qs-card-avatar for platform icon container', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'quick-switcher.css'), 'utf8');
    assert.ok(src.includes('.qs-card-avatar'), '.qs-card-avatar for platform icon container');
});

test('quick-switcher.css: has .qs-platform-group, .qs-platform-chip, .qs-platform-count', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'quick-switcher.css'), 'utf8');
    assert.ok(src.includes('.qs-platform-group'), '.qs-platform-group');
    assert.ok(src.includes('.qs-platform-chip'),  '.qs-platform-chip');
    assert.ok(src.includes('.qs-platform-count'), '.qs-platform-count');
});

test('quick-switcher.css: active card has left accent mark', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'quick-switcher.css'), 'utf8');
    assert.ok(src.includes('.qs-card.is-active'), '.qs-card.is-active defined');
    assert.ok(src.includes('inset') && src.includes('2px 0 0'), 'inset left accent on active card');
});

test('quick-switcher.css: enter glyph shown only on hover/selected', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'quick-switcher.css'), 'utf8');
    assert.ok(src.includes('.qs-enter-glyph'), '.qs-enter-glyph defined');
    assert.ok(src.includes('opacity: 0'), 'enter glyph hidden by default');
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

test('quick-switcher.css: has .qs-deck-hints for keyboard hints', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'quick-switcher.css'), 'utf8');
    assert.ok(src.includes('.qs-deck-hints'), '.qs-deck-hints defined');
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

test('quick-switcher.js: renders .qs-card buttons for accounts', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'quick-switcher.js'), 'utf8');
    assert.ok(src.includes('qs-card'), 'qs-card class used');
    assert.ok(src.includes('<button'), 'button element used for cards');
});

test('quick-switcher.js: renders card avatar with real platform icon', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'quick-switcher.js'), 'utf8');
    assert.ok(src.includes('qs-card-avatar'), '.qs-card-avatar rendered');
    assert.ok(src.includes('_platformIcon('), '_platformIcon called in card builder');
    assert.ok(src.includes('function _platformIcon'), '_platformIcon defined');
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

test('quick-switcher.js: platform chip includes count of accounts', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'quick-switcher.js'), 'utf8');
    assert.ok(src.includes('qs-platform-count'), 'platform count badge');
    assert.ok(src.includes('.count'), 'count from flat item');
});

test('quick-switcher.js: uses event delegation on listEl (no per-row addEventListener)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'quick-switcher.js'), 'utf8');
    assert.ok(src.includes("listEl.addEventListener('click'"), 'delegated click on list');
    assert.ok(src.includes('.closest('), 'closest() for delegation');
});

test('quick-switcher.js: _highlightSelected uses .qs-card selector', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'quick-switcher.js'), 'utf8');
    const fnSrc = src.slice(src.indexOf('function _highlightSelected'), src.indexOf('function _highlightSelected') + 200);
    assert.ok(fnSrc.includes('qs-card'), '_highlightSelected targets .qs-card');
});

test('quick-switcher.js: empty state renders polished message with icon', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'quick-switcher.js'), 'utf8');
    assert.ok(src.includes('_emptyStateHtml'), '_emptyStateHtml function');
    assert.ok(src.includes('qs-empty'), 'qs-empty class');
    assert.ok(src.includes('No matching accounts') || src.includes('No accounts found'), 'friendly empty text');
});

test('quick-switcher.js: account card includes .qs-card-body, .qs-card-state, .qs-enter-glyph', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'quick-switcher.js'), 'utf8');
    assert.ok(src.includes('qs-card-body'),   '.qs-card-body');
    assert.ok(src.includes('qs-card-state'),  '.qs-card-state');
    assert.ok(src.includes('qs-enter-glyph'), '.qs-enter-glyph indicator');
});

// ── dashboard.html — QS settings section ─────────────────────────────────────

test('dashboard.html: has Quick Switcher settings section', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'dashboard.html'), 'utf8', { encoding: 'utf8' });
    assert.ok(src.includes('Quick Switcher'), 'QS section heading');
    assert.ok(src.includes('id="qsEnabledToggle"'), 'enabled toggle');
    assert.ok(src.includes('id="qsHotkeyDisplay"'), 'hotkey display element');
    assert.ok(!src.includes('id="qsPositionSelect"'), 'position select removed');
    assert.ok(src.includes('id="qsCloseAfterSwitchToggle"'), 'close-after-switch toggle');
});

test('dashboard.html: hotkey Change and Reset buttons call correct functions', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'dashboard.html'), 'utf8');
    const qsSrc = src.slice(src.indexOf('Quick Switcher Overlay'), src.indexOf('Quick Switcher Overlay') + 1500);
    assert.ok(qsSrc.includes('qsChangeHotkey()'), 'Change calls qsChangeHotkey');
    assert.ok(qsSrc.includes('qsResetHotkey()'), 'Reset calls qsResetHotkey');
});

test('dashboard.html: position select is removed from settings UI', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'dashboard.html'), 'utf8');
    assert.ok(!src.includes('qsPositionSelect'), 'position select element removed');
    assert.ok(!src.includes('qsChangePosition'), 'qsChangePosition handler removed from HTML');
});

// ── app.js — QS settings handlers ────────────────────────────────────────────

test('settings-quick-switcher.js: defines qsToggleEnabled, qsChangePosition, qsToggleCloseAfter', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'app', 'settings-quick-switcher.js'), 'utf8');
    assert.ok(src.includes('function qsToggleEnabled'), 'qsToggleEnabled');
    assert.ok(src.includes('function qsChangePosition'), 'qsChangePosition');
    assert.ok(src.includes('function qsToggleCloseAfter'), 'qsToggleCloseAfter');
});

test('settings-quick-switcher.js: defines qsChangeHotkey and qsResetHotkey', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'app', 'settings-quick-switcher.js'), 'utf8');
    assert.ok(src.includes('function qsChangeHotkey'), 'qsChangeHotkey');
    assert.ok(src.includes('function qsResetHotkey'), 'qsResetHotkey');
});

test('settings-quick-switcher.js: openSettingsModal calls _qsLoadSettings', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'app', 'settings-quick-switcher.js'), 'utf8');
    const modalSrc = src.slice(src.indexOf('async function openSettingsModal'), src.indexOf('async function openSettingsModal') + 3000);
    assert.ok(modalSrc.includes('_qsLoadSettings()'), '_qsLoadSettings called in openSettingsModal');
});

test('settings-quick-switcher.js: _openQSHotkeyModal uses shortcut-capture-box CSS classes', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'app', 'settings-quick-switcher.js'), 'utf8');
    const modalSrc = src.slice(src.indexOf('function _openQSHotkeyModal'), src.indexOf('function _openQSHotkeyModal') + 2500);
    assert.ok(modalSrc.includes('shortcut-capture-box'), 'reuses capture-box class');
    assert.ok(modalSrc.includes('is-valid'), 'is-valid state');
    assert.ok(modalSrc.includes('is-invalid'), 'is-invalid state');
});

test('settings-quick-switcher.js: _openQSHotkeyModal guards Save button when invalid', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'app', 'settings-quick-switcher.js'), 'utf8');
    const modalSrc = src.slice(src.indexOf('function _openQSHotkeyModal'), src.indexOf('function _openQSHotkeyModal') + 2500);
    assert.ok(modalSrc.includes('saveBtn.disabled = true'), 'Save disabled when invalid');
    assert.ok(modalSrc.includes('!capturedValid') || modalSrc.includes('capturedValid'), 'guards on validity');
});

test('settings-quick-switcher.js: _qsBasicValidate allows single-modifier shortcuts', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'app', 'settings-quick-switcher.js'), 'utf8');
    const start = src.indexOf('function _qsBasicValidate');
    const end   = src.indexOf('\n}', start) + 2;
    const fnSrc = src.slice(start, end);
    assert.ok(fnSrc.includes('mods.length < 1'), 'rejects modifier-only (< 1 non-modifier key)');
    assert.ok(fnSrc.includes('valid: false'), 'returns invalid when no modifier');
    assert.ok(fnSrc.includes('valid: true'), 'returns valid for good input');
});

test('settings-quick-switcher.js: qsToggleEnabled reverts checkbox on error', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'app', 'settings-quick-switcher.js'), 'utf8');
    const fnSrc = src.slice(src.indexOf('async function qsToggleEnabled'), src.indexOf('async function qsToggleEnabled') + 300);
    assert.ok(fnSrc.includes('catch'), 'has catch block');
    assert.ok(fnSrc.includes('checkbox.checked = prev'), 'reverts checkbox on error');
});

// ── Deck UI — new command palette structure ───────────────────────────────────

test('quick-switcher.html: bar area has label and shortcut chip id', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'quick-switcher.html'), 'utf8');
    assert.ok(src.includes('qs-bar-label') || src.includes('qs-bar'), 'bar with label');
    assert.ok(src.includes('qsHotkeyHint'), 'hotkey hint id present');
});

test('quick-switcher.html: has hotkey hint id (not GLOBAL pill)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'quick-switcher.html'), 'utf8');
    assert.ok(src.includes('qsHotkeyHint'), 'qsHotkeyHint id present');
    assert.ok(!src.includes('qs-global-pill'), 'no GLOBAL pill');
});

test('quick-switcher.css: has .qs-card-icon or .qs-chip-icon for real platform icons', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'quick-switcher.css'), 'utf8');
    assert.ok(src.includes('.qs-card-icon') || src.includes('.qs-chip-icon'), 'platform icon classes defined');
});

test('quick-switcher.css: has .qs-chip-icon for platform chip header', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'quick-switcher.css'), 'utf8');
    assert.ok(src.includes('.qs-chip-icon'), '.qs-chip-icon defined');
});

test('quick-switcher.css: bar uses neutral white border, not bright green', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'quick-switcher.css'), 'utf8');
    // Bar border should be a subtle white, not a green value
    assert.ok(src.includes('rgba(255, 255, 255, 0.10)') || src.includes('rgba(255,255,255,0.10)'), 'subtle white border on bar');
    assert.ok(!src.includes('0 0 48px rgba(18, 206, 24'), 'no large green glow');
});

test('quick-switcher.css: no large panel-level green glow shadow', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'quick-switcher.css'), 'utf8');
    assert.ok(!src.includes('0 0 48px rgba(18, 206, 24'), 'no large green glow');
});

test('quick-switcher.css: has .qs-bar-shortcut style', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'quick-switcher.css'), 'utf8');
    assert.ok(src.includes('.qs-bar-shortcut'), '.qs-bar-shortcut styled');
});

test('quick-switcher.js: _platformIcon returns img tag; called with qs- class names', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'quick-switcher.js'), 'utf8');
    const fnSrc = src.slice(src.indexOf('function _platformIcon'), src.indexOf('function _platformIcon') + 300);
    assert.ok(fnSrc.length > 50, '_platformIcon function found');
    assert.ok(fnSrc.includes('<img'), '_platformIcon returns img element');
    // Call sites must pass qs- prefixed class names
    assert.ok(src.includes('qs-card-icon'), 'qs-card-icon passed to _platformIcon at card call site');
    assert.ok(src.includes('qs-chip-icon'), 'qs-chip-icon passed to _platformIcon at chip call site');
});

test('quick-switcher.js: _platformChipHtml outputs chip with data-platform', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'quick-switcher.js'), 'utf8');
    const fnSrc = src.slice(src.indexOf('function _platformChipHtml'), src.indexOf('function _platformChipHtml') + 400);
    assert.ok(fnSrc.includes('qs-chip-icon') || fnSrc.includes('qs-platform'), 'chip icon class used');
    assert.ok(fnSrc.includes('data-platform='), 'data-platform on chip div');
});

test('quick-switcher.js: account card has no .qs-row-indicator (replaced by box-shadow accent)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'quick-switcher.js'), 'utf8');
    const cardFn = src.slice(src.indexOf('function _accountCardHtml'), src.indexOf('function _accountCardHtml') + 600);
    assert.ok(!cardFn.includes('qs-row-indicator'), 'no qs-row-indicator in new card template');
});

// ── Overlay dim + layout ──────────────────────────────────────────────────────

test('quick-switcher.css: html/body background is transparent', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'quick-switcher.css'), 'utf8');
    assert.ok(src.includes('background: transparent !important'), 'html/body transparent !important');
});

test('quick-switcher.css: .qs-overlay has dim background for readability', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'quick-switcher.css'), 'utf8');
    const overlaySrc = src.slice(src.indexOf('.qs-overlay {'), src.indexOf('.qs-overlay {') + 300);
    assert.ok(overlaySrc.includes('rgba(0, 0, 0,'), 'overlay has dim background');
    assert.ok(overlaySrc.length > 50, '.qs-overlay rule found and non-empty');
});

test('quick-switcher.css: .qs-deck is centered and max-width constrained', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'quick-switcher.css'), 'utf8');
    const deckSrc = src.slice(src.indexOf('.qs-deck {'), src.indexOf('.qs-deck {') + 250);
    assert.ok(deckSrc.includes('max-width'), 'deck has max-width constraint');
    assert.ok(deckSrc.length > 50, '.qs-deck rule found and non-empty');
});

test('quick-switcher.css: .qs-deck-results scrolls with max-height', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'quick-switcher.css'), 'utf8');
    const resultsSrc = src.slice(src.indexOf('.qs-deck-results {'), src.indexOf('.qs-deck-results {') + 250);
    assert.ok(resultsSrc.includes('max-height'), 'results has max-height for scroll');
    assert.ok(resultsSrc.includes('overflow-y: auto'), 'results scrolls internally');
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

test('quick-switcher.css: scoped Epic logo visibility rule on card or chip', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'quick-switcher.css'), 'utf8');
    assert.ok(src.includes('[data-platform="epic"]'), 'scoped Epic rule present');
    assert.ok(src.includes('filter: brightness(0) invert(1)'), 'filter inverts Epic icon to white');
});

test('quick-switcher.css: Epic fix does not target sidebar nav (not global)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'quick-switcher.css'), 'utf8');
    assert.ok(!src.includes('#nav-epic'), 'no sidebar nav-epic reference in overlay CSS');
    assert.ok(!src.includes('.epic-icon'), 'no sidebar epic-icon class in overlay CSS');
});

test('quick-switcher.css: compact account cards (min-height ≤ 50px)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'quick-switcher.css'), 'utf8');
    const cardSrc = src.slice(src.indexOf('.qs-card {'), src.indexOf('.qs-card {') + 400);
    const mhMatch = cardSrc.match(/min-height:\s*(\d+)px/);
    assert.ok(mhMatch, 'min-height defined on .qs-card');
    assert.ok(Number(mhMatch[1]) <= 50, `min-height ${mhMatch[1]}px should be ≤ 50`);
});

test('quick-switcher.js: _platformChipHtml adds data-platform to chip div', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'quick-switcher.js'), 'utf8');
    const fnSrc = src.slice(src.indexOf('function _platformChipHtml'), src.indexOf('function _platformChipHtml') + 700);
    assert.ok(fnSrc.includes('data-platform='), 'data-platform on platform chip div');
});

// ── Regression: shortcut map was always empty (getAll() returns array, not {shortcuts:[]} ──

test('quickSwitcher service: getQuickSwitcherAccounts iterates shortcuts array directly (no .shortcuts access)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'quickSwitcher.js'), 'utf8');
    const fnSrc = src.slice(src.indexOf('async function getQuickSwitcherAccounts'), src.indexOf('async function getQuickSwitcherAccounts') + 600);
    // Must iterate the result of getAll() directly — not access .shortcuts on it
    assert.ok(!fnSrc.includes('shortcuts.shortcuts'), 'must not access .shortcuts on result (was the bug)');
    assert.ok(!fnSrc.includes('shortcutsData?.shortcuts'), 'old buggy guard must not be present');
    assert.ok(!fnSrc.includes('shortcutsData.shortcuts'), 'old buggy guard must not be present');
    // Must use for..of on the array directly
    assert.match(fnSrc, /for\s*\(const\s+sc\s+of\s+shortcuts\)/);
});

test('quickSwitcher service: shortcut map is built from all elements, not gated on an object property', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'quickSwitcher.js'), 'utf8');
    const fnSrc = src.slice(src.indexOf('async function getQuickSwitcherAccounts'), src.indexOf('async function getQuickSwitcherAccounts') + 600);
    // The shortcutMap.set() call must be reachable regardless of a conditional guard
    assert.match(fnSrc, /shortcutMap\.set\(/);
    // There must be no if-guard around the for loop that would hide it
    assert.ok(!fnSrc.match(/if\s*\(\s*(shortcuts|shortcutsData)/), 'no if-gate on the shortcuts loop');
});

test('accountShortcuts.js: getAll() returns an array (no wrapper object)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'accountShortcuts.js'), 'utf8');
    const fnSrc = src.slice(src.indexOf('async function getAll'), src.indexOf('async function getAll') + 400);
    // getAll must return an array — either [] literal or parsed array
    assert.match(fnSrc, /return\s+(\[\]|shortcuts|data|parsed)/);
    // It must NOT return an object like { shortcuts: [...] }
    assert.ok(!fnSrc.includes('return {'), 'getAll must not return a wrapper object');
});

// ── Release cleanliness: no debug artifacts ───────────────────────────────────

test('quickSwitcher service: debug hotkey Ctrl+Shift+Alt+B is not registered', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'quickSwitcher.js'), 'utf8');
    assert.ok(!src.includes('Ctrl+Shift+Alt+B'), 'debug hotkey not present in release');
    assert.ok(!src.includes('_registerDebugHotkey'), 'debug hotkey registration function not present');
    assert.ok(!src.includes('_debugHotkeyAccelerator'), 'debug hotkey accelerator variable not present');
});

test('quickSwitcher service: devTools is explicitly false in BrowserWindow config', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'quickSwitcher.js'), 'utf8');
    const winSrc = src.slice(src.indexOf('new BrowserWindow'), src.indexOf('new BrowserWindow') + 600);
    assert.ok(winSrc.includes('devTools: false'), 'devTools: false in BrowserWindow webPreferences');
});

test('preload.js: debugSnapshot IPC is not exposed in release', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
    assert.ok(!src.includes('debugSnapshot'), 'debugSnapshot not in preload');
    assert.ok(!src.includes('quick-switcher-debug-snapshot'), 'debug snapshot IPC channel not exposed');
});

test('quick-switcher.js: no debug CSS injected at runtime', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'quick-switcher.js'), 'utf8');
    assert.ok(!src.includes('outline: red') && !src.includes('outline: lime'), 'no debug outline colors injected');
    assert.ok(!src.includes('document.createElement(\'style\')'), 'no injected style elements');
});

test('quick-switcher.js: no renderer console.log debug spam', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'quick-switcher.js'), 'utf8');
    assert.ok(!src.includes("console.log('[QS Renderer]"), 'no QS Renderer debug logs');
});

test('quickSwitcher service: visible-ready timeout does not abort show (window stays visible)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'quickSwitcher.js'), 'utf8');
    // After vrOk timeout, code must not return early — look for the timeout comment/log
    const vrSrc = src.slice(src.indexOf('visibleReadyPromise'), src.indexOf('visibleReadyPromise') + 600);
    assert.ok(vrSrc.includes('already shown') || vrSrc.includes('continuing'), 'vr timeout is informational, not a gate');
    // The hide() call must not appear after the visibleReadyPromise await
    assert.ok(!vrSrc.includes('_win.hide()'), 'hide() not called on vr timeout');
});

test('quick-switcher.js: renderer sends visibleReady on every qs:show', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'quick-switcher.js'), 'utf8');
    const onShowSrc = src.slice(src.indexOf('api.onShow('), src.indexOf('api.onShow(') + 1200);
    assert.ok(onShowSrc.includes('api.visibleReady('), 'visibleReady called inside every onShow');
});

test('quickSwitcher service: _showing is reset in finally block', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'quickSwitcher.js'), 'utf8');
    const showSrc = src.slice(src.indexOf('async function showQuickSwitcherOverlay'), src.indexOf('async function showQuickSwitcherOverlay') + 500);
    assert.ok(showSrc.includes('finally'), 'finally block present in showQuickSwitcherOverlay');
    assert.ok(showSrc.includes('_showing = false'), '_showing reset in finally');
});

test('quickSwitcher service: protected path resolution uses app.getAppPath()', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'quickSwitcher.js'), 'utf8');
    assert.ok(src.includes('app.getAppPath'), 'uses app.getAppPath for protected path resolution');
    assert.ok(src.includes('preload.bundle.cjs'), 'looks for preload.bundle.cjs in protected build');
    assert.ok(src.includes('quick-switcher.html'), 'looks for quick-switcher.html in protected build');
});

test('quickSwitcher service: fails closed when HTML or preload path is missing', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'quickSwitcher.js'), 'utf8');
    assert.ok(src.includes('html path missing; aborting show'), 'aborts if HTML missing');
    assert.ok(src.includes('preload path missing; aborting show'), 'aborts if preload missing');
});
