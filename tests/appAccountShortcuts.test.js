'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT         = path.resolve(__dirname, '..');
const APP_JS       = fs.readFileSync(path.join(ROOT, 'src/js/app.js'),                          'utf8');
const SHORTCUTS_JS = fs.readFileSync(path.join(ROOT, 'src/js/app/account-shortcuts.js'),        'utf8');
const ACC_JS       = fs.readFileSync(path.join(ROOT, 'src/js/accounts.js'),                     'utf8');
const HTML         = fs.readFileSync(path.join(ROOT, 'src/dashboard.html'),                     'utf8');

// ─── 1. Source presence — functions in account-shortcuts.js ──────────────────

test('account-shortcuts.js: renderAccountShortcuts is defined', () => {
    assert.match(SHORTCUTS_JS, /function renderAccountShortcuts\s*\(\s*\)/);
});

test('account-shortcuts.js: initShortcutsSortable is defined', () => {
    assert.match(SHORTCUTS_JS, /function initShortcutsSortable\s*\(\s*\)/);
});

test('account-shortcuts.js: saveShortcutsOrder is defined', () => {
    assert.match(SHORTCUTS_JS, /function saveShortcutsOrder\s*\(\s*\)/);
});

test('account-shortcuts.js: switchPinnedAccount is defined on window', () => {
    assert.match(SHORTCUTS_JS, /window\.switchPinnedAccount\s*=/);
});

test('account-shortcuts.js: PLATFORM_LOGOS constant is defined', () => {
    assert.match(SHORTCUTS_JS, /const PLATFORM_LOGOS\s*=/);
});

// ─── 1b. app.js must NOT redeclare the moved identifiers ─────────────────────

test('app.js: does NOT define renderAccountShortcuts (moved to account-shortcuts.js)', () => {
    assert.doesNotMatch(APP_JS, /function renderAccountShortcuts\s*\(/);
});

test('app.js: does NOT define PLATFORM_LOGOS (moved to account-shortcuts.js)', () => {
    assert.doesNotMatch(APP_JS, /const PLATFORM_LOGOS\s*=/);
});

test('app.js: does NOT define shortcutsSortableInstance (moved to account-shortcuts.js)', () => {
    assert.doesNotMatch(APP_JS, /let shortcutsSortableInstance\s*=/);
});

test('app.js: calls renderAccountShortcuts via window guard', () => {
    assert.match(APP_JS, /window\.renderAccountShortcuts\s*\(\s*\)|typeof window\.renderAccountShortcuts/);
});

// ─── 2. DOM IDs and classes ───────────────────────────────────────────────────

test('account-shortcuts.js: renderAccountShortcuts targets accountsShortcutsInner container', () => {
    const idx = SHORTCUTS_JS.indexOf('function renderAccountShortcuts()');
    const fn  = SHORTCUTS_JS.slice(idx, idx + 200);
    assert.match(fn, /getElementById\('accountsShortcutsInner'\)/, 'must get accountsShortcutsInner by id');
});

test('account-shortcuts.js: renderAccountShortcuts targets accountsShortcutsSection', () => {
    const idx = SHORTCUTS_JS.indexOf('function renderAccountShortcuts()');
    const fn  = SHORTCUTS_JS.slice(idx, idx + 200);
    assert.match(fn, /getElementById\('accountsShortcutsSection'\)/, 'must get accountsShortcutsSection by id');
});

test('dashboard.html: accountsShortcutsInner element exists', () => {
    assert.match(HTML, /id="accountsShortcutsInner"/, 'accountsShortcutsInner must exist in HTML');
});

test('dashboard.html: accountsShortcutsSection element exists', () => {
    assert.match(HTML, /id="accountsShortcutsSection"/, 'accountsShortcutsSection must exist in HTML');
});

test('account-shortcuts.js: renderAccountShortcuts creates cards with class account-shortcut-card', () => {
    const idx = SHORTCUTS_JS.indexOf('function renderAccountShortcuts()');
    const fn  = SHORTCUTS_JS.slice(idx, idx + 5000);
    assert.match(fn, /account-shortcut-card/, 'must use account-shortcut-card class');
});

test('account-shortcuts.js: renderAccountShortcuts renders asc-unpin-btn button', () => {
    const idx = SHORTCUTS_JS.indexOf('function renderAccountShortcuts()');
    const fn  = SHORTCUTS_JS.slice(idx, idx + 5000);
    assert.match(fn, /asc-unpin-btn/, 'must render asc-unpin-btn');
});

test('account-shortcuts.js: renderAccountShortcuts renders asc-play-btn button', () => {
    const idx = SHORTCUTS_JS.indexOf('function renderAccountShortcuts()');
    const fn  = SHORTCUTS_JS.slice(idx, idx + 5000);
    assert.match(fn, /asc-play-btn/, 'must render asc-play-btn');
});

test('account-shortcuts.js: renderAccountShortcuts renders asc-avatar element', () => {
    const idx = SHORTCUTS_JS.indexOf('function renderAccountShortcuts()');
    const fn  = SHORTCUTS_JS.slice(idx, idx + 5000);
    assert.match(fn, /asc-avatar/, 'must render asc-avatar');
});

test('account-shortcuts.js: saveShortcutsOrder queries .account-shortcut-card elements', () => {
    const idx = SHORTCUTS_JS.indexOf('function saveShortcutsOrder()');
    const fn  = SHORTCUTS_JS.slice(idx, idx + 400);
    assert.match(fn, /querySelectorAll\(['"].account-shortcut-card['"]\)/, 'must query account-shortcut-card cards');
});

// ─── 3. Empty-state behavior ──────────────────────────────────────────────────

test('account-shortcuts.js: renderAccountShortcuts hides section when pinned list is empty', () => {
    const idx = SHORTCUTS_JS.indexOf('function renderAccountShortcuts()');
    const fn  = SHORTCUTS_JS.slice(idx, idx + 500);
    assert.match(fn, /pinned\.length\s*===\s*0/, 'must check for empty pinned list');
    assert.match(fn, /display.*none|style\.display\s*=\s*['"]none['"]/, 'must hide section when empty');
});

test('account-shortcuts.js: renderAccountShortcuts shows section when pinned list has entries', () => {
    const idx = SHORTCUTS_JS.indexOf('function renderAccountShortcuts()');
    const fn  = SHORTCUTS_JS.slice(idx, idx + 600);
    assert.match(fn, /style\.display\s*=\s*['"]block['"]/, 'must show section when entries exist');
});

// ─── 4. localStorage behavior ────────────────────────────────────────────────

test('account-shortcuts.js: renderAccountShortcuts reads baddel_pinned_accounts from localStorage', () => {
    const idx = SHORTCUTS_JS.indexOf('function renderAccountShortcuts()');
    const fn  = SHORTCUTS_JS.slice(idx, idx + 500);
    assert.match(fn, /localStorage\.getItem\(['"]baddel_pinned_accounts['"]\)/, 'must read baddel_pinned_accounts');
});

test('account-shortcuts.js: renderAccountShortcuts handles missing localStorage key safely with fallback []', () => {
    const idx = SHORTCUTS_JS.indexOf('function renderAccountShortcuts()');
    const fn  = SHORTCUTS_JS.slice(idx, idx + 500);
    assert.match(fn, /\|\|\s*'\[\]'/, 'must fall back to [] when key is absent');
});

test('account-shortcuts.js: saveShortcutsOrder reads baddel_pinned_accounts from localStorage', () => {
    const idx = SHORTCUTS_JS.indexOf('function saveShortcutsOrder()');
    const fn  = SHORTCUTS_JS.slice(idx, idx + 400);
    assert.match(fn, /localStorage\.getItem\(['"]baddel_pinned_accounts['"]\)/, 'must read baddel_pinned_accounts');
});

test('account-shortcuts.js: saveShortcutsOrder writes baddel_pinned_accounts to localStorage', () => {
    const idx = SHORTCUTS_JS.indexOf('function saveShortcutsOrder()');
    const fn  = SHORTCUTS_JS.slice(idx, idx + 800);
    assert.match(fn, /localStorage\.setItem\(['"]baddel_pinned_accounts['"]/, 'must write baddel_pinned_accounts');
});

test('account-shortcuts.js: saveShortcutsOrder serializes new order to JSON', () => {
    const idx = SHORTCUTS_JS.indexOf('function saveShortcutsOrder()');
    const fn  = SHORTCUTS_JS.slice(idx, idx + 800);
    assert.match(fn, /JSON\.stringify/, 'must JSON.stringify the new order');
});

// ─── 5. Cross-file dependencies ───────────────────────────────────────────────

test('account-shortcuts.js: switchPinnedAccount calls handleSwitchAccount', () => {
    const idx = SHORTCUTS_JS.indexOf('window.switchPinnedAccount');
    const fn  = SHORTCUTS_JS.slice(idx, idx + 200);
    assert.match(fn, /handleSwitchAccount/, 'switchPinnedAccount must delegate to handleSwitchAccount');
});

test('account-shortcuts.js: switchPinnedAccount guards handleSwitchAccount with typeof check', () => {
    const idx = SHORTCUTS_JS.indexOf('window.switchPinnedAccount');
    const fn  = SHORTCUTS_JS.slice(idx, idx + 200);
    assert.match(fn, /typeof handleSwitchAccount\s*===\s*['"]function['"]/, 'must guard with typeof check');
});

test('accounts.js: handleSwitchAccount is defined', () => {
    assert.match(ACC_JS, /async function handleSwitchAccount\s*\(/, 'handleSwitchAccount must be in accounts.js');
});

test('accounts.js: handlePinAccount is exposed on window', () => {
    assert.match(ACC_JS, /window\.handlePinAccount\s*=/, 'handlePinAccount must be on window in accounts.js');
});

test('account-shortcuts.js: renderAccountShortcuts calls handlePinAccount for unpin', () => {
    const idx = SHORTCUTS_JS.indexOf('function renderAccountShortcuts()');
    const fn  = SHORTCUTS_JS.slice(idx, idx + 5000);
    assert.match(fn, /handlePinAccount\(/, 'must call handlePinAccount for unpin/contextmenu');
});

test('account-shortcuts.js: renderAccountShortcuts inline onclick calls switchPinnedAccount', () => {
    const idx = SHORTCUTS_JS.indexOf('function renderAccountShortcuts()');
    const fn  = SHORTCUTS_JS.slice(idx, idx + 5000);
    assert.match(fn, /onclick="switchPinnedAccount\(/, 'play button must call switchPinnedAccount via inline onclick');
});

test('account-shortcuts.js: initShortcutsSortable uses Sortable (drag-and-drop library)', () => {
    const idx = SHORTCUTS_JS.indexOf('function initShortcutsSortable()');
    const fn  = SHORTCUTS_JS.slice(idx, idx + 400);
    assert.match(fn, /new Sortable\(/, 'must instantiate Sortable');
});

test('account-shortcuts.js: initShortcutsSortable wires onEnd to saveShortcutsOrder', () => {
    const idx = SHORTCUTS_JS.indexOf('function initShortcutsSortable()');
    const fn  = SHORTCUTS_JS.slice(idx, idx + 600);
    assert.ok(fn.includes('onEnd'), 'must have onEnd handler');
    assert.ok(fn.includes('saveShortcutsOrder'), 'onEnd must call saveShortcutsOrder');
});

test('account-shortcuts.js: initShortcutsSortable destroys previous instance before creating new one', () => {
    const idx = SHORTCUTS_JS.indexOf('function initShortcutsSortable()');
    const fn  = SHORTCUTS_JS.slice(idx, idx + 400);
    assert.match(fn, /shortcutsSortableInstance.*destroy|destroy.*shortcutsSortableInstance/, 'must destroy previous Sortable instance');
});

// ─── 6. Low-dependency checks (against account-shortcuts.js directly) ─────────

test('account-shortcuts.js: does not reference currentView', () => {
    assert.doesNotMatch(SHORTCUTS_JS, /\bcurrentView\b/, 'account shortcuts must not reference currentView');
});

test('account-shortcuts.js: does not reference currentFilters', () => {
    assert.doesNotMatch(SHORTCUTS_JS, /\bcurrentFilters\b/, 'account shortcuts must not reference currentFilters');
});

test('account-shortcuts.js: does not reference window._vs', () => {
    assert.doesNotMatch(SHORTCUTS_JS, /window\._vs\b/, 'account shortcuts must not reference window._vs');
});

test('account-shortcuts.js: does not reference renderAllGamesView', () => {
    assert.doesNotMatch(SHORTCUTS_JS, /\brenderAllGamesView\b/, 'account shortcuts must not reference renderAllGamesView');
});

test('account-shortcuts.js: does not reference _allGamesCache', () => {
    assert.doesNotMatch(SHORTCUTS_JS, /\b_allGamesCache\b/, 'account shortcuts must not reference _allGamesCache');
});

test('account-shortcuts.js: does not reference _agDisplayPrefs', () => {
    assert.doesNotMatch(SHORTCUTS_JS, /\b_agDisplayPrefs\b/, 'account shortcuts must not reference _agDisplayPrefs');
});

test('account-shortcuts.js: does not reference _igDisplayPrefs', () => {
    assert.doesNotMatch(SHORTCUTS_JS, /\b_igDisplayPrefs\b/, 'account shortcuts must not reference _igDisplayPrefs');
});

// ─── 7. PLATFORM_LOGOS ───────────────────────────────────────────────────────

test('account-shortcuts.js: PLATFORM_LOGOS contains steam entry', () => {
    const idx = SHORTCUTS_JS.indexOf('const PLATFORM_LOGOS');
    const block = SHORTCUTS_JS.slice(idx, idx + 500);
    assert.match(block, /steam\s*:\s*\{/, 'must have steam entry');
});

test('account-shortcuts.js: PLATFORM_LOGOS contains epic entry', () => {
    const idx = SHORTCUTS_JS.indexOf('const PLATFORM_LOGOS');
    const block = SHORTCUTS_JS.slice(idx, idx + 500);
    assert.match(block, /epic\s*:\s*\{/, 'must have epic entry');
});

test('account-shortcuts.js: PLATFORM_LOGOS contains ea entry', () => {
    const idx = SHORTCUTS_JS.indexOf('const PLATFORM_LOGOS');
    const block = SHORTCUTS_JS.slice(idx, idx + 500);
    assert.match(block, /ea\s*:\s*\{/, 'must have ea entry');
});

test('account-shortcuts.js: PLATFORM_LOGOS contains riot entry', () => {
    const idx = SHORTCUTS_JS.indexOf('const PLATFORM_LOGOS');
    const block = SHORTCUTS_JS.slice(idx, idx + 500);
    assert.match(block, /riot\s*:\s*\{/, 'must have riot entry');
});

// ─── 8. window exports ───────────────────────────────────────────────────────

test('account-shortcuts.js: switchPinnedAccount is an async function assigned to window', () => {
    const idx = SHORTCUTS_JS.indexOf('window.switchPinnedAccount');
    const fn  = SHORTCUTS_JS.slice(idx, idx + 60);
    assert.match(fn, /window\.switchPinnedAccount\s*=\s*async function/, 'must be async and on window');
});

test('account-shortcuts.js: renderAccountShortcuts explicitly exported on window', () => {
    assert.match(SHORTCUTS_JS, /window\.renderAccountShortcuts\s*=\s*renderAccountShortcuts/);
});

test('dashboard.html: account-shortcuts.js loads before app.js', () => {
    const shortcutsIdx = HTML.indexOf('js/app/account-shortcuts.js');
    const appIdx       = HTML.indexOf('js/app.js');
    assert.ok(shortcutsIdx > -1, 'account-shortcuts.js must be in dashboard.html');
    assert.ok(shortcutsIdx < appIdx, 'account-shortcuts.js must load before app.js');
});

// ─── 9. Steam avatar lazy-load ────────────────────────────────────────────────

test('account-shortcuts.js: renderAccountShortcuts lazy-loads steam avatar via getSteamImage', () => {
    const idx = SHORTCUTS_JS.indexOf('function renderAccountShortcuts()');
    const fn  = SHORTCUTS_JS.slice(idx, idx + 5000);
    assert.match(fn, /getSteamImage/, 'must call getSteamImage for steam avatar lazy-load');
});

test('account-shortcuts.js: renderAccountShortcuts steam avatar load has onload/onerror guards', () => {
    const idx = SHORTCUTS_JS.indexOf('function renderAccountShortcuts()');
    const fn  = SHORTCUTS_JS.slice(idx, idx + 5000);
    assert.match(fn, /imgEl\.onload/, 'must have imgEl.onload handler');
    assert.match(fn, /imgEl\.onerror/, 'must have imgEl.onerror handler');
});
