'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT   = path.resolve(__dirname, '..');
const APP_JS = fs.readFileSync(path.join(ROOT, 'src/js/app.js'),        'utf8');
const ACC_JS = fs.readFileSync(path.join(ROOT, 'src/js/accounts.js'),   'utf8');
const HTML   = fs.readFileSync(path.join(ROOT, 'src/dashboard.html'),   'utf8');

// ─── 1. Source presence — functions must still be in app.js ──────────────────

test('app.js: renderAccountShortcuts is defined', () => {
    assert.match(APP_JS, /function renderAccountShortcuts\s*\(\s*\)/);
});

test('app.js: initShortcutsSortable is defined', () => {
    assert.match(APP_JS, /function initShortcutsSortable\s*\(\s*\)/);
});

test('app.js: saveShortcutsOrder is defined', () => {
    assert.match(APP_JS, /function saveShortcutsOrder\s*\(\s*\)/);
});

test('app.js: switchPinnedAccount is defined on window', () => {
    assert.match(APP_JS, /window\.switchPinnedAccount\s*=/);
});

test('app.js: PLATFORM_LOGOS constant is defined', () => {
    assert.match(APP_JS, /const PLATFORM_LOGOS\s*=/);
});

// ─── 2. DOM IDs and classes ───────────────────────────────────────────────────

test('app.js: renderAccountShortcuts targets accountsShortcutsInner container', () => {
    const idx = APP_JS.indexOf('function renderAccountShortcuts()');
    const fn  = APP_JS.slice(idx, idx + 200);
    assert.match(fn, /getElementById\('accountsShortcutsInner'\)/, 'must get accountsShortcutsInner by id');
});

test('app.js: renderAccountShortcuts targets accountsShortcutsSection', () => {
    const idx = APP_JS.indexOf('function renderAccountShortcuts()');
    const fn  = APP_JS.slice(idx, idx + 200);
    assert.match(fn, /getElementById\('accountsShortcutsSection'\)/, 'must get accountsShortcutsSection by id');
});

test('dashboard.html: accountsShortcutsInner element exists', () => {
    assert.match(HTML, /id="accountsShortcutsInner"/, 'accountsShortcutsInner must exist in HTML');
});

test('dashboard.html: accountsShortcutsSection element exists', () => {
    assert.match(HTML, /id="accountsShortcutsSection"/, 'accountsShortcutsSection must exist in HTML');
});

test('app.js: renderAccountShortcuts creates cards with class account-shortcut-card', () => {
    const idx = APP_JS.indexOf('function renderAccountShortcuts()');
    const fn  = APP_JS.slice(idx, idx + 5000);
    assert.match(fn, /account-shortcut-card/, 'must use account-shortcut-card class');
});

test('app.js: renderAccountShortcuts renders asc-unpin-btn button', () => {
    const idx = APP_JS.indexOf('function renderAccountShortcuts()');
    const fn  = APP_JS.slice(idx, idx + 5000);
    assert.match(fn, /asc-unpin-btn/, 'must render asc-unpin-btn');
});

test('app.js: renderAccountShortcuts renders asc-play-btn button', () => {
    const idx = APP_JS.indexOf('function renderAccountShortcuts()');
    const fn  = APP_JS.slice(idx, idx + 5000);
    assert.match(fn, /asc-play-btn/, 'must render asc-play-btn');
});

test('app.js: renderAccountShortcuts renders asc-avatar element', () => {
    const idx = APP_JS.indexOf('function renderAccountShortcuts()');
    const fn  = APP_JS.slice(idx, idx + 5000);
    assert.match(fn, /asc-avatar/, 'must render asc-avatar');
});

test('app.js: saveShortcutsOrder queries .account-shortcut-card elements', () => {
    const idx = APP_JS.indexOf('function saveShortcutsOrder()');
    const fn  = APP_JS.slice(idx, idx + 400);
    assert.match(fn, /querySelectorAll\(['"].account-shortcut-card['"]\)/, 'must query account-shortcut-card cards');
});

// ─── 3. Empty-state behavior ──────────────────────────────────────────────────

test('app.js: renderAccountShortcuts hides section when pinned list is empty', () => {
    const idx = APP_JS.indexOf('function renderAccountShortcuts()');
    const fn  = APP_JS.slice(idx, idx + 500);
    assert.match(fn, /pinned\.length\s*===\s*0/, 'must check for empty pinned list');
    assert.match(fn, /display.*none|style\.display\s*=\s*['"]none['"]/, 'must hide section when empty');
});

test('app.js: renderAccountShortcuts shows section when pinned list has entries', () => {
    const idx = APP_JS.indexOf('function renderAccountShortcuts()');
    const fn  = APP_JS.slice(idx, idx + 600);
    assert.match(fn, /style\.display\s*=\s*['"]block['"]/, 'must show section when entries exist');
});

// ─── 4. localStorage behavior ────────────────────────────────────────────────

test('app.js: renderAccountShortcuts reads baddel_pinned_accounts from localStorage', () => {
    const idx = APP_JS.indexOf('function renderAccountShortcuts()');
    const fn  = APP_JS.slice(idx, idx + 500);
    assert.match(fn, /localStorage\.getItem\(['"]baddel_pinned_accounts['"]\)/, 'must read baddel_pinned_accounts');
});

test('app.js: renderAccountShortcuts handles missing localStorage key safely with fallback []', () => {
    const idx = APP_JS.indexOf('function renderAccountShortcuts()');
    const fn  = APP_JS.slice(idx, idx + 500);
    assert.match(fn, /\|\|\s*'\[\]'/, 'must fall back to [] when key is absent');
});

test('app.js: saveShortcutsOrder reads baddel_pinned_accounts from localStorage', () => {
    const idx = APP_JS.indexOf('function saveShortcutsOrder()');
    const fn  = APP_JS.slice(idx, idx + 400);
    assert.match(fn, /localStorage\.getItem\(['"]baddel_pinned_accounts['"]\)/, 'must read baddel_pinned_accounts');
});

test('app.js: saveShortcutsOrder writes baddel_pinned_accounts to localStorage', () => {
    const idx = APP_JS.indexOf('function saveShortcutsOrder()');
    const fn  = APP_JS.slice(idx, idx + 800);
    assert.match(fn, /localStorage\.setItem\(['"]baddel_pinned_accounts['"]/, 'must write baddel_pinned_accounts');
});

test('app.js: saveShortcutsOrder serializes new order to JSON', () => {
    const idx = APP_JS.indexOf('function saveShortcutsOrder()');
    const fn  = APP_JS.slice(idx, idx + 800);
    assert.match(fn, /JSON\.stringify/, 'must JSON.stringify the new order');
});

// ─── 5. Cross-file dependencies ───────────────────────────────────────────────

test('app.js: switchPinnedAccount calls handleSwitchAccount', () => {
    const idx = APP_JS.indexOf('window.switchPinnedAccount');
    const fn  = APP_JS.slice(idx, idx + 200);
    assert.match(fn, /handleSwitchAccount/, 'switchPinnedAccount must delegate to handleSwitchAccount');
});

test('app.js: switchPinnedAccount guards handleSwitchAccount with typeof check', () => {
    const idx = APP_JS.indexOf('window.switchPinnedAccount');
    const fn  = APP_JS.slice(idx, idx + 200);
    assert.match(fn, /typeof handleSwitchAccount\s*===\s*['"]function['"]/, 'must guard with typeof check');
});

test('accounts.js: handleSwitchAccount is defined', () => {
    assert.match(ACC_JS, /async function handleSwitchAccount\s*\(/, 'handleSwitchAccount must be in accounts.js');
});

test('accounts.js: handlePinAccount is exposed on window', () => {
    assert.match(ACC_JS, /window\.handlePinAccount\s*=/, 'handlePinAccount must be on window in accounts.js');
});

test('app.js: renderAccountShortcuts calls handlePinAccount for unpin (not defined in app.js)', () => {
    const idx = APP_JS.indexOf('function renderAccountShortcuts()');
    const fn  = APP_JS.slice(idx, idx + 5000);
    assert.match(fn, /handlePinAccount\(/, 'must call handlePinAccount for unpin/contextmenu');
});

test('app.js: renderAccountShortcuts inline onclick calls switchPinnedAccount', () => {
    const idx = APP_JS.indexOf('function renderAccountShortcuts()');
    const fn  = APP_JS.slice(idx, idx + 5000);
    assert.match(fn, /onclick="switchPinnedAccount\(/, 'play button must call switchPinnedAccount via inline onclick');
});

test('app.js: initShortcutsSortable uses Sortable (drag-and-drop library)', () => {
    const idx = APP_JS.indexOf('function initShortcutsSortable()');
    const fn  = APP_JS.slice(idx, idx + 400);
    assert.match(fn, /new Sortable\(/, 'must instantiate Sortable');
});

test('app.js: initShortcutsSortable wires onEnd to saveShortcutsOrder', () => {
    const idx = APP_JS.indexOf('function initShortcutsSortable()');
    const fn  = APP_JS.slice(idx, idx + 600);
    assert.ok(fn.includes('onEnd'), 'must have onEnd handler');
    assert.ok(fn.includes('saveShortcutsOrder'), 'onEnd must call saveShortcutsOrder');
});

test('app.js: initShortcutsSortable destroys previous instance before creating new one', () => {
    const idx = APP_JS.indexOf('function initShortcutsSortable()');
    const fn  = APP_JS.slice(idx, idx + 400);
    assert.match(fn, /shortcutsSortableInstance.*destroy|destroy.*shortcutsSortableInstance/, 'must destroy previous Sortable instance');
});

// ─── 6. Low-dependency checks ────────────────────────────────────────────────

test('app.js account shortcuts section: does not reference currentView', () => {
    const section = APP_JS.slice(APP_JS.indexOf('// ACCOUNT SHORTCUTS'), APP_JS.indexOf('// REAL-TIME PLAYTIME UPDATER'));
    assert.doesNotMatch(section, /\bcurrentView\b/, 'account shortcuts must not reference currentView');
});

test('app.js account shortcuts section: does not reference currentFilters', () => {
    const section = APP_JS.slice(APP_JS.indexOf('// ACCOUNT SHORTCUTS'), APP_JS.indexOf('// REAL-TIME PLAYTIME UPDATER'));
    assert.doesNotMatch(section, /\bcurrentFilters\b/, 'account shortcuts must not reference currentFilters');
});

test('app.js account shortcuts section: does not reference window._vs', () => {
    const section = APP_JS.slice(APP_JS.indexOf('// ACCOUNT SHORTCUTS'), APP_JS.indexOf('// REAL-TIME PLAYTIME UPDATER'));
    assert.doesNotMatch(section, /window\._vs\b/, 'account shortcuts must not reference window._vs');
});

test('app.js account shortcuts section: does not reference renderAllGamesView', () => {
    const section = APP_JS.slice(APP_JS.indexOf('// ACCOUNT SHORTCUTS'), APP_JS.indexOf('// REAL-TIME PLAYTIME UPDATER'));
    assert.doesNotMatch(section, /\brenderAllGamesView\b/, 'account shortcuts must not reference renderAllGamesView');
});

test('app.js account shortcuts section: does not reference _allGamesCache', () => {
    const section = APP_JS.slice(APP_JS.indexOf('// ACCOUNT SHORTCUTS'), APP_JS.indexOf('// REAL-TIME PLAYTIME UPDATER'));
    assert.doesNotMatch(section, /\b_allGamesCache\b/, 'account shortcuts must not reference _allGamesCache');
});

test('app.js account shortcuts section: does not reference _agDisplayPrefs', () => {
    const section = APP_JS.slice(APP_JS.indexOf('// ACCOUNT SHORTCUTS'), APP_JS.indexOf('// REAL-TIME PLAYTIME UPDATER'));
    assert.doesNotMatch(section, /\b_agDisplayPrefs\b/, 'account shortcuts must not reference _agDisplayPrefs');
});

test('app.js account shortcuts section: does not reference _igDisplayPrefs', () => {
    const section = APP_JS.slice(APP_JS.indexOf('// ACCOUNT SHORTCUTS'), APP_JS.indexOf('// REAL-TIME PLAYTIME UPDATER'));
    assert.doesNotMatch(section, /\b_igDisplayPrefs\b/, 'account shortcuts must not reference _igDisplayPrefs');
});

// ─── 7. PLATFORM_LOGOS ───────────────────────────────────────────────────────

test('app.js: PLATFORM_LOGOS contains steam entry', () => {
    const idx = APP_JS.indexOf('const PLATFORM_LOGOS');
    const block = APP_JS.slice(idx, idx + 500);
    assert.match(block, /steam\s*:\s*\{/, 'must have steam entry');
});

test('app.js: PLATFORM_LOGOS contains epic entry', () => {
    const idx = APP_JS.indexOf('const PLATFORM_LOGOS');
    const block = APP_JS.slice(idx, idx + 500);
    assert.match(block, /epic\s*:\s*\{/, 'must have epic entry');
});

test('app.js: PLATFORM_LOGOS contains ea entry', () => {
    const idx = APP_JS.indexOf('const PLATFORM_LOGOS');
    const block = APP_JS.slice(idx, idx + 500);
    assert.match(block, /ea\s*:\s*\{/, 'must have ea entry');
});

test('app.js: PLATFORM_LOGOS contains riot entry', () => {
    const idx = APP_JS.indexOf('const PLATFORM_LOGOS');
    const block = APP_JS.slice(idx, idx + 500);
    assert.match(block, /riot\s*:\s*\{/, 'must have riot entry');
});

// ─── 8. window export ────────────────────────────────────────────────────────

test('app.js: switchPinnedAccount is an async function assigned to window', () => {
    const idx = APP_JS.indexOf('window.switchPinnedAccount');
    const fn  = APP_JS.slice(idx, idx + 60);
    assert.match(fn, /window\.switchPinnedAccount\s*=\s*async function/, 'must be async and on window');
});

// ─── 9. Steam avatar lazy-load ────────────────────────────────────────────────

test('app.js: renderAccountShortcuts lazy-loads steam avatar via getSteamImage', () => {
    const idx = APP_JS.indexOf('function renderAccountShortcuts()');
    const fn  = APP_JS.slice(idx, idx + 5000);
    assert.match(fn, /getSteamImage/, 'must call getSteamImage for steam avatar lazy-load');
});

test('app.js: renderAccountShortcuts steam avatar load has onload/onerror guards', () => {
    const idx = APP_JS.indexOf('function renderAccountShortcuts()');
    const fn  = APP_JS.slice(idx, idx + 5000);
    assert.match(fn, /imgEl\.onload/, 'must have imgEl.onload handler');
    assert.match(fn, /imgEl\.onerror/, 'must have imgEl.onerror handler');
});
