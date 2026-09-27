'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT             = path.resolve(__dirname, '..');
const ACC_JS           = fs.readFileSync(path.join(ROOT, 'src/js/accounts.js'),                       'utf8');
const DISPLAY_PREFS_JS = fs.readFileSync(path.join(ROOT, 'src/js/accounts/display-prefs.js'),         'utf8');
const HTML             = fs.readFileSync(path.join(ROOT, 'src/dashboard.html'),                       'utf8');

// ─── 1. Source presence — all target functions in display-prefs.js ────────────

test('display-prefs.js: _agLoadDisplayPrefs is defined', () => {
    assert.match(DISPLAY_PREFS_JS, /function _agLoadDisplayPrefs\s*\(\s*\)/);
});

test('display-prefs.js: _agSaveDisplayPrefs is defined', () => {
    assert.match(DISPLAY_PREFS_JS, /function _agSaveDisplayPrefs\s*\(\s*\)/);
});

test('display-prefs.js: _agApplyDisplayPrefs is defined', () => {
    assert.match(DISPLAY_PREFS_JS, /function _agApplyDisplayPrefs\s*\(\s*options\s*=\s*\{\}\s*\)/);
});

test('display-prefs.js: AG_DISPLAY_DEFAULTS constant is defined', () => {
    assert.match(DISPLAY_PREFS_JS, /const AG_DISPLAY_DEFAULTS\s*=/);
});

test('display-prefs.js: window._agDisplayPrefs is initialized from _agLoadDisplayPrefs', () => {
    assert.match(DISPLAY_PREFS_JS, /window\._agDisplayPrefs\s*=\s*_agLoadDisplayPrefs\(\)/);
});

test('display-prefs.js: _igLoadDisplayPrefs is defined', () => {
    assert.match(DISPLAY_PREFS_JS, /function _igLoadDisplayPrefs\s*\(\s*\)/);
});

test('display-prefs.js: _igSaveDisplayPrefs is defined', () => {
    assert.match(DISPLAY_PREFS_JS, /function _igSaveDisplayPrefs\s*\(\s*\)/);
});

test('display-prefs.js: _igApplyDisplayPrefs is defined', () => {
    assert.match(DISPLAY_PREFS_JS, /function _igApplyDisplayPrefs\s*\(\s*\)/);
});

test('display-prefs.js: IG_DISPLAY_DEFAULTS constant is defined', () => {
    assert.match(DISPLAY_PREFS_JS, /const IG_DISPLAY_DEFAULTS\s*=/);
});

test('display-prefs.js: window._igDisplayPrefs is initialized from _igLoadDisplayPrefs', () => {
    assert.match(DISPLAY_PREFS_JS, /window\._igDisplayPrefs\s*=\s*_igLoadDisplayPrefs\(\)/);
});

test('display-prefs.js: setAgViewMode is assigned to window', () => {
    assert.match(DISPLAY_PREFS_JS, /window\.setAgViewMode\s*=/);
});

test('display-prefs.js: setAgDensity is assigned to window', () => {
    assert.match(DISPLAY_PREFS_JS, /window\.setAgDensity\s*=/);
});

test('display-prefs.js: setAgField is assigned to window', () => {
    assert.match(DISPLAY_PREFS_JS, /window\.setAgField\s*=/);
});

test('display-prefs.js: toggleAgDisplayPanel is assigned to window', () => {
    assert.match(DISPLAY_PREFS_JS, /window\.toggleAgDisplayPanel\s*=/);
});

test('display-prefs.js: setIgViewMode is assigned to window', () => {
    assert.match(DISPLAY_PREFS_JS, /window\.setIgViewMode\s*=/);
});

test('display-prefs.js: setIgDensity is assigned to window', () => {
    assert.match(DISPLAY_PREFS_JS, /window\.setIgDensity\s*=/);
});

test('display-prefs.js: setIgField is assigned to window', () => {
    assert.match(DISPLAY_PREFS_JS, /window\.setIgField\s*=/);
});

test('display-prefs.js: toggleIgDisplayPanel is assigned to window', () => {
    assert.match(DISPLAY_PREFS_JS, /window\.toggleIgDisplayPanel\s*=/);
});

// ─── 1b. accounts.js must NOT redeclare the moved identifiers ─────────────────

test('accounts.js: does NOT define AG_DISPLAY_DEFAULTS (moved to display-prefs.js)', () => {
    assert.doesNotMatch(ACC_JS, /const AG_DISPLAY_DEFAULTS\s*=/);
});

test('accounts.js: does NOT define IG_DISPLAY_DEFAULTS (moved to display-prefs.js)', () => {
    assert.doesNotMatch(ACC_JS, /const IG_DISPLAY_DEFAULTS\s*=/);
});

test('accounts.js: does NOT define _agLoadDisplayPrefs (moved to display-prefs.js)', () => {
    assert.doesNotMatch(ACC_JS, /function _agLoadDisplayPrefs\s*\(/);
});

test('accounts.js: does NOT define _agSaveDisplayPrefs (moved to display-prefs.js)', () => {
    assert.doesNotMatch(ACC_JS, /function _agSaveDisplayPrefs\s*\(/);
});

test('accounts.js: does NOT define _agApplyDisplayPrefs (moved to display-prefs.js)', () => {
    assert.doesNotMatch(ACC_JS, /function _agApplyDisplayPrefs\s*\(/);
});

test('accounts.js: does NOT define _igLoadDisplayPrefs (moved to display-prefs.js)', () => {
    assert.doesNotMatch(ACC_JS, /function _igLoadDisplayPrefs\s*\(/);
});

test('accounts.js: does NOT define _igSaveDisplayPrefs (moved to display-prefs.js)', () => {
    assert.doesNotMatch(ACC_JS, /function _igSaveDisplayPrefs\s*\(/);
});

test('accounts.js: does NOT define _igApplyDisplayPrefs (moved to display-prefs.js)', () => {
    assert.doesNotMatch(ACC_JS, /function _igApplyDisplayPrefs\s*\(/);
});

test('accounts.js: calls _agApplyDisplayPrefs via window guard', () => {
    assert.match(ACC_JS, /window\._agApplyDisplayPrefs\?\.\(\)/);
});

test('accounts.js: calls _igApplyDisplayPrefs via window guard', () => {
    assert.match(ACC_JS, /window\._igApplyDisplayPrefs\?\.\(\)/);
});

// ─── 2. localStorage keys ─────────────────────────────────────────────────────

test('display-prefs.js: All Games display prefs use localStorage key "baddelDisplayPrefs"', () => {
    assert.match(DISPLAY_PREFS_JS, /localStorage\.getItem\(['"]baddelDisplayPrefs['"]\)/, 'load must read baddelDisplayPrefs');
    assert.match(DISPLAY_PREFS_JS, /localStorage\.setItem\(['"]baddelDisplayPrefs['"]/, 'save must write baddelDisplayPrefs');
});

test('display-prefs.js: _agLoadDisplayPrefs reads "baddelDisplayPrefs"', () => {
    const idx = DISPLAY_PREFS_JS.indexOf('function _agLoadDisplayPrefs()');
    const fn  = DISPLAY_PREFS_JS.slice(idx, idx + 400);
    assert.match(fn, /localStorage\.getItem\(['"]baddelDisplayPrefs['"]\)/);
});

test('display-prefs.js: _agSaveDisplayPrefs writes "baddelDisplayPrefs"', () => {
    const idx = DISPLAY_PREFS_JS.indexOf('function _agSaveDisplayPrefs()');
    const fn  = DISPLAY_PREFS_JS.slice(idx, idx + 200);
    assert.match(fn, /localStorage\.setItem\(['"]baddelDisplayPrefs['"]/, 'must write baddelDisplayPrefs');
    assert.match(fn, /JSON\.stringify\(window\._agDisplayPrefs\)/, 'must serialize the prefs object');
});

test('display-prefs.js: Installed Games display prefs use localStorage key "baddelInstalledDisplayPrefs"', () => {
    assert.match(DISPLAY_PREFS_JS, /localStorage\.getItem\(['"]baddelInstalledDisplayPrefs['"]\)/, 'load must read baddelInstalledDisplayPrefs');
    assert.match(DISPLAY_PREFS_JS, /localStorage\.setItem\(['"]baddelInstalledDisplayPrefs['"]/, 'save must write baddelInstalledDisplayPrefs');
});

test('display-prefs.js: _igLoadDisplayPrefs reads "baddelInstalledDisplayPrefs"', () => {
    const idx = DISPLAY_PREFS_JS.indexOf('function _igLoadDisplayPrefs()');
    const fn  = DISPLAY_PREFS_JS.slice(idx, idx + 400);
    assert.match(fn, /localStorage\.getItem\(['"]baddelInstalledDisplayPrefs['"]\)/);
});

test('display-prefs.js: _igSaveDisplayPrefs writes "baddelInstalledDisplayPrefs"', () => {
    const idx = DISPLAY_PREFS_JS.indexOf('function _igSaveDisplayPrefs()');
    const fn  = DISPLAY_PREFS_JS.slice(idx, idx + 200);
    assert.match(fn, /localStorage\.setItem\(['"]baddelInstalledDisplayPrefs['"]/, 'must write baddelInstalledDisplayPrefs');
    assert.match(fn, /JSON\.stringify\(window\._igDisplayPrefs\)/, 'must serialize the prefs object');
});

// ─── 3. Default values ────────────────────────────────────────────────────────

test('display-prefs.js: AG_DISPLAY_DEFAULTS has viewMode grid', () => {
    const idx   = DISPLAY_PREFS_JS.indexOf('const AG_DISPLAY_DEFAULTS');
    const block = DISPLAY_PREFS_JS.slice(idx, idx + 300);
    assert.match(block, /viewMode\s*:\s*['"]grid['"]/, 'default viewMode must be grid');
});

test('display-prefs.js: AG_DISPLAY_DEFAULTS has gridDensity normal', () => {
    const idx   = DISPLAY_PREFS_JS.indexOf('const AG_DISPLAY_DEFAULTS');
    const block = DISPLAY_PREFS_JS.slice(idx, idx + 300);
    assert.match(block, /gridDensity\s*:\s*['"]normal['"]/, 'default gridDensity must be normal');
});

test('display-prefs.js: AG_DISPLAY_DEFAULTS has visibleFields object', () => {
    const idx   = DISPLAY_PREFS_JS.indexOf('const AG_DISPLAY_DEFAULTS');
    const block = DISPLAY_PREFS_JS.slice(idx, idx + 300);
    assert.match(block, /visibleFields\s*:\s*\{/, 'must have visibleFields');
});

test('display-prefs.js: IG_DISPLAY_DEFAULTS has viewMode grid', () => {
    const idx   = DISPLAY_PREFS_JS.indexOf('const IG_DISPLAY_DEFAULTS');
    const block = DISPLAY_PREFS_JS.slice(idx, idx + 300);
    assert.match(block, /viewMode\s*:\s*['"]grid['"]/, 'default viewMode must be grid');
});

test('display-prefs.js: IG_DISPLAY_DEFAULTS has visibleFields object', () => {
    const idx   = DISPLAY_PREFS_JS.indexOf('const IG_DISPLAY_DEFAULTS');
    const block = DISPLAY_PREFS_JS.slice(idx, idx + 300);
    assert.match(block, /visibleFields\s*:\s*\{/, 'must have visibleFields');
});

// ─── 4. Behavior: state mutations ────────────────────────────────────────────

test('display-prefs.js: setAgViewMode mutates window._agDisplayPrefs.viewMode', () => {
    const idx = DISPLAY_PREFS_JS.indexOf('window.setAgViewMode');
    const fn  = DISPLAY_PREFS_JS.slice(idx, idx + 200);
    assert.match(fn, /window\._agDisplayPrefs\.viewMode\s*=\s*mode/, 'must assign mode to viewMode');
});

test('display-prefs.js: setAgViewMode calls _agSaveDisplayPrefs', () => {
    const idx = DISPLAY_PREFS_JS.indexOf('window.setAgViewMode');
    const fn  = DISPLAY_PREFS_JS.slice(idx, idx + 200);
    assert.match(fn, /_agSaveDisplayPrefs\(\)/, 'must persist prefs after change');
});

test('display-prefs.js: setAgViewMode calls _agApplyDisplayPrefs', () => {
    const idx = DISPLAY_PREFS_JS.indexOf('window.setAgViewMode');
    const fn  = DISPLAY_PREFS_JS.slice(idx, idx + 200);
    assert.match(fn, /_agApplyDisplayPrefs\(\)/, 'must apply prefs to DOM after change');
});

test('display-prefs.js: setAgDensity mutates gridDensity when view is grid', () => {
    const idx = DISPLAY_PREFS_JS.indexOf('window.setAgDensity');
    const fn  = DISPLAY_PREFS_JS.slice(idx, idx + 400);
    assert.match(fn, /window\._agDisplayPrefs\.gridDensity\s*=\s*density/, 'must set gridDensity');
});

test('display-prefs.js: setAgDensity mutates listDensity when view is list', () => {
    const idx = DISPLAY_PREFS_JS.indexOf('window.setAgDensity');
    const fn  = DISPLAY_PREFS_JS.slice(idx, idx + 1100);
    assert.match(fn, /window\._agDisplayPrefs\.listDensity\s*=\s*density/, 'must set listDensity');
});

test('display-prefs.js: setAgDensity calls _agSaveDisplayPrefs and _agApplyDisplayPrefs', () => {
    const idx = DISPLAY_PREFS_JS.indexOf('window.setAgDensity');
    const fn  = DISPLAY_PREFS_JS.slice(idx, idx + 1100);
    assert.match(fn, /_agSaveDisplayPrefs\(\)/);
    assert.match(fn, /_agApplyDisplayPrefs\(\)/);
});

test('display-prefs.js: setAgField mutates window._agDisplayPrefs.visibleFields', () => {
    const idx = DISPLAY_PREFS_JS.indexOf('window.setAgField');
    const fn  = DISPLAY_PREFS_JS.slice(idx, idx + 200);
    assert.match(fn, /window\._agDisplayPrefs\.visibleFields\[field\]\s*=\s*visible/, 'must set field in visibleFields');
});

test('display-prefs.js: setAgField calls _agSaveDisplayPrefs and _agApplyDisplayPrefs', () => {
    const idx = DISPLAY_PREFS_JS.indexOf('window.setAgField');
    const fn  = DISPLAY_PREFS_JS.slice(idx, idx + 400);
    assert.match(fn, /_agSaveDisplayPrefs\(\)/);
    assert.match(fn, /_agApplyDisplayPrefs\(\)/);
});

test('display-prefs.js: setIgViewMode mutates window._igDisplayPrefs.viewMode', () => {
    const idx = DISPLAY_PREFS_JS.indexOf('window.setIgViewMode');
    const fn  = DISPLAY_PREFS_JS.slice(idx, idx + 200);
    assert.match(fn, /window\._igDisplayPrefs\.viewMode\s*=\s*mode/, 'must assign mode to viewMode');
});

test('display-prefs.js: setIgViewMode calls _igSaveDisplayPrefs and _igApplyDisplayPrefs', () => {
    const idx = DISPLAY_PREFS_JS.indexOf('window.setIgViewMode');
    const fn  = DISPLAY_PREFS_JS.slice(idx, idx + 200);
    assert.match(fn, /_igSaveDisplayPrefs\(\)/);
    assert.match(fn, /_igApplyDisplayPrefs\(\)/);
});

test('display-prefs.js: setIgDensity mutates gridDensity or listDensity based on current view', () => {
    const idx = DISPLAY_PREFS_JS.indexOf('window.setIgDensity');
    const fn  = DISPLAY_PREFS_JS.slice(idx, idx + 400);
    assert.match(fn, /window\._igDisplayPrefs\.gridDensity\s*=\s*density/);
    assert.match(fn, /window\._igDisplayPrefs\.listDensity\s*=\s*density/);
});

test('display-prefs.js: setIgDensity calls _igSaveDisplayPrefs and _igApplyDisplayPrefs', () => {
    const idx = DISPLAY_PREFS_JS.indexOf('window.setIgDensity');
    const fn  = DISPLAY_PREFS_JS.slice(idx, idx + 1050);
    assert.match(fn, /_igSaveDisplayPrefs\(\)/);
    assert.match(fn, /_igApplyDisplayPrefs\(\)/);
});

test('display-prefs.js: setIgField mutates window._igDisplayPrefs.visibleFields', () => {
    const idx = DISPLAY_PREFS_JS.indexOf('window.setIgField');
    const fn  = DISPLAY_PREFS_JS.slice(idx, idx + 200);
    assert.match(fn, /window\._igDisplayPrefs\.visibleFields\[field\]\s*=\s*visible/);
});

test('display-prefs.js: setIgField calls _igSaveDisplayPrefs and _igApplyDisplayPrefs', () => {
    const idx = DISPLAY_PREFS_JS.indexOf('window.setIgField');
    const fn  = DISPLAY_PREFS_JS.slice(idx, idx + 500);
    assert.match(fn, /_igSaveDisplayPrefs\(\)/);
    assert.match(fn, /_igApplyDisplayPrefs\(\)/);
});

// ─── 5. Behavior: apply functions update DOM ──────────────────────────────────

test('display-prefs.js: _agApplyDisplayPrefs reads from window._agDisplayPrefs', () => {
    const idx = DISPLAY_PREFS_JS.indexOf('function _agApplyDisplayPrefs(');
    const fn  = DISPLAY_PREFS_JS.slice(idx, idx + 200);
    assert.match(fn, /window\._agDisplayPrefs/);
});

test('display-prefs.js: _agApplyDisplayPrefs targets allGamesGrid element', () => {
    const idx = DISPLAY_PREFS_JS.indexOf('function _agApplyDisplayPrefs(');
    const fn  = DISPLAY_PREFS_JS.slice(idx, idx + 300);
    assert.match(fn, /getElementById\(['"]allGamesGrid['"]\)/);
});

test('display-prefs.js: _agApplyDisplayPrefs targets allGamesList element', () => {
    const idx = DISPLAY_PREFS_JS.indexOf('function _agApplyDisplayPrefs(');
    const fn  = DISPLAY_PREFS_JS.slice(idx, idx + 400);
    assert.match(fn, /getElementById\(['"]allGamesList['"]\)/);
});

test('display-prefs.js: _agApplyDisplayPrefs toggles density classes on grid', () => {
    const idx = DISPLAY_PREFS_JS.indexOf('function _agApplyDisplayPrefs(');
    const fn  = DISPLAY_PREFS_JS.slice(idx, idx + 3700);
    assert.match(fn, /density-compact/, 'must manage density-compact class');
    assert.match(fn, /density-normal/, 'must manage density-normal class');
});

test('display-prefs.js: _agApplyDisplayPrefs syncs field visibility checkboxes', () => {
    const idx = DISPLAY_PREFS_JS.indexOf('function _agApplyDisplayPrefs(');
    const fn  = DISPLAY_PREFS_JS.slice(idx, idx + 4500);
    assert.match(fn, /adpFieldTitle/, 'must sync adpFieldTitle checkbox');
    assert.match(fn, /adpFieldPlatforms/, 'must sync adpFieldPlatforms checkbox');
});

test('display-prefs.js: _agApplyDisplayPrefs guards against ag-empty-mode', () => {
    const idx = DISPLAY_PREFS_JS.indexOf('function _agApplyDisplayPrefs(');
    const fn  = DISPLAY_PREFS_JS.slice(idx, idx + 3700);
    assert.match(fn, /ag-empty-mode/, 'must check for ag-empty-mode to skip layout changes');
});

test('display-prefs.js: _igApplyDisplayPrefs reads from window._igDisplayPrefs', () => {
    const idx = DISPLAY_PREFS_JS.indexOf('function _igApplyDisplayPrefs()');
    const fn  = DISPLAY_PREFS_JS.slice(idx, idx + 200);
    assert.match(fn, /window\._igDisplayPrefs/);
});

test('display-prefs.js: _igApplyDisplayPrefs targets gamesGrid element', () => {
    const idx = DISPLAY_PREFS_JS.indexOf('function _igApplyDisplayPrefs()');
    const fn  = DISPLAY_PREFS_JS.slice(idx, idx + 300);
    assert.match(fn, /getElementById\(['"]gamesGrid['"]\)/);
});

test('display-prefs.js: _igApplyDisplayPrefs targets igListView element', () => {
    const idx = DISPLAY_PREFS_JS.indexOf('function _igApplyDisplayPrefs()');
    const fn  = DISPLAY_PREFS_JS.slice(idx, idx + 400);
    assert.match(fn, /getElementById\(['"]igListView['"]\)/);
});

test('display-prefs.js: _igApplyDisplayPrefs syncs field visibility checkboxes', () => {
    const idx = DISPLAY_PREFS_JS.indexOf('function _igApplyDisplayPrefs()');
    const fn  = DISPLAY_PREFS_JS.slice(idx, idx + 2600);
    assert.match(fn, /igAdpFieldTitle/, 'must sync igAdpFieldTitle checkbox');
    assert.match(fn, /igAdpFieldPlatform/, 'must sync igAdpFieldPlatform checkbox');
});

// ─── 6. Load functions: deep-merge and fallback ───────────────────────────────

test('display-prefs.js: _agLoadDisplayPrefs deep-merges visibleFields with defaults', () => {
    const idx = DISPLAY_PREFS_JS.indexOf('function _agLoadDisplayPrefs()');
    const fn  = DISPLAY_PREFS_JS.slice(idx, idx + 500);
    assert.match(fn, /Object\.assign.*AG_DISPLAY_DEFAULTS\.visibleFields/, 'must merge visibleFields from defaults');
});

test('display-prefs.js: _agLoadDisplayPrefs returns defaults when localStorage is empty', () => {
    const idx = DISPLAY_PREFS_JS.indexOf('function _agLoadDisplayPrefs()');
    const fn  = DISPLAY_PREFS_JS.slice(idx, idx + 500);
    assert.match(fn, /if\s*\(!raw\)/, 'must handle missing key');
});

test('display-prefs.js: _agLoadDisplayPrefs returns defaults on parse error', () => {
    const idx = DISPLAY_PREFS_JS.indexOf('function _agLoadDisplayPrefs()');
    const fn  = DISPLAY_PREFS_JS.slice(idx, idx + 700);
    assert.match(fn, /catch\s*\(e\)/, 'must catch JSON parse errors');
});

test('display-prefs.js: _igLoadDisplayPrefs deep-merges visibleFields with defaults', () => {
    const idx = DISPLAY_PREFS_JS.indexOf('function _igLoadDisplayPrefs()');
    const fn  = DISPLAY_PREFS_JS.slice(idx, idx + 500);
    assert.match(fn, /Object\.assign.*IG_DISPLAY_DEFAULTS\.visibleFields/, 'must merge visibleFields from defaults');
});

test('display-prefs.js: _igLoadDisplayPrefs returns defaults on parse error', () => {
    const idx = DISPLAY_PREFS_JS.indexOf('function _igLoadDisplayPrefs()');
    const fn  = DISPLAY_PREFS_JS.slice(idx, idx + 500);
    assert.match(fn, /catch\s*\(e\)/, 'must catch JSON parse errors');
});

// ─── 7. Display panel toggles ────────────────────────────────────────────────

test('display-prefs.js: toggleAgDisplayPanel toggles agDisplayPanel active class', () => {
    const idx = DISPLAY_PREFS_JS.indexOf('window.toggleAgDisplayPanel');
    const fn  = DISPLAY_PREFS_JS.slice(idx, idx + 560);
    assert.match(fn, /getElementById\(['"]agDisplayPanel['"]\)/);
    assert.match(fn, /panel\.classList\.toggle\('active'\)/);
});

test('display-prefs.js: toggleAgDisplayPanel closes agSortMenu before opening', () => {
    const idx = DISPLAY_PREFS_JS.indexOf('window.toggleAgDisplayPanel');
    const fn  = DISPLAY_PREFS_JS.slice(idx, idx + 560);
    assert.match(fn, /agSortMenu/, 'must reference agSortMenu');
    assert.ok(fn.includes("classList.remove('active')"), 'must remove active from menus');
});

test('display-prefs.js: toggleIgDisplayPanel toggles igDisplayPanel active class', () => {
    const idx = DISPLAY_PREFS_JS.indexOf('window.toggleIgDisplayPanel');
    const fn  = DISPLAY_PREFS_JS.slice(idx, idx + 560);
    assert.match(fn, /getElementById\(['"]igDisplayPanel['"]\)/);
    assert.match(fn, /panel\.classList\.toggle\('active'\)/);
});

test('display-prefs.js: toggleIgDisplayPanel closes igPlatformMenu and igSortMenu before opening', () => {
    const idx = DISPLAY_PREFS_JS.indexOf('window.toggleIgDisplayPanel');
    const fn  = DISPLAY_PREFS_JS.slice(idx, idx + 560);
    assert.match(fn, /igPlatformMenu/, 'must close igPlatformMenu');
    assert.match(fn, /igSortMenu/, 'must close igSortMenu');
});

// ─── 8. Inline onclick handlers in dashboard.html ────────────────────────────

test('dashboard.html: setAgViewMode called for grid and list view buttons', () => {
    assert.match(HTML, /onclick="setAgViewMode\('grid'\)"/, 'grid view button must call setAgViewMode(grid)');
    assert.match(HTML, /onclick="setAgViewMode\('list'\)"/, 'list view button must call setAgViewMode(list)');
});

test('dashboard.html: toggleAgDisplayPanel called from display trigger button', () => {
    assert.match(HTML, /onclick="toggleAgDisplayPanel\(event\)"/, 'display trigger must call toggleAgDisplayPanel');
});

test('dashboard.html: setAgDensity called for compact, normal, and large density buttons', () => {
    assert.match(HTML, /onclick="setAgDensity\('compact',this\)"/, 'must have compact density button');
    assert.match(HTML, /onclick="setAgDensity\('normal',this\)"/, 'must have normal density button');
    assert.match(HTML, /onclick="setAgDensity\('large',this\)"/, 'must have large density button');
});

test('dashboard.html: setAgField called from field visibility checkboxes', () => {
    assert.match(HTML, /onchange="setAgField\('title',this\.checked\)"/, 'title field checkbox');
    assert.match(HTML, /onchange="setAgField\('platforms',this\.checked\)"/, 'platforms field checkbox');
    assert.match(HTML, /onchange="setAgField\('lastPlayed',this\.checked\)"/, 'lastPlayed field checkbox');
    assert.match(HTML, /onchange="setAgField\('playtime',this\.checked\)"/, 'playtime field checkbox');
});

test('dashboard.html: setIgViewMode called for grid and list view buttons', () => {
    assert.match(HTML, /onclick="setIgViewMode\('grid'\)"/, 'grid view button must call setIgViewMode(grid)');
    assert.match(HTML, /onclick="setIgViewMode\('list'\)"/, 'list view button must call setIgViewMode(list)');
});

test('dashboard.html: toggleIgDisplayPanel called from IG display trigger button', () => {
    assert.match(HTML, /onclick="toggleIgDisplayPanel\(event\)"/, 'IG display trigger must call toggleIgDisplayPanel');
});

test('dashboard.html: setIgDensity called for compact, normal, and large density buttons', () => {
    assert.match(HTML, /onclick="setIgDensity\('compact',this\)"/, 'must have compact IG density button');
    assert.match(HTML, /onclick="setIgDensity\('normal',this\)"/, 'must have normal IG density button');
    assert.match(HTML, /onclick="setIgDensity\('large',this\)"/, 'must have large IG density button');
});

test('dashboard.html: setIgField called from IG field visibility checkboxes', () => {
    assert.match(HTML, /onchange="setIgField\('title',this\.checked\)"/, 'IG title field checkbox');
    assert.match(HTML, /onchange="setIgField\('platform',this\.checked\)"/, 'IG platform field checkbox');
    assert.match(HTML, /onchange="setIgField\('playtime',this\.checked\)"/, 'IG playtime field checkbox');
    assert.match(HTML, /onchange="setIgField\('lastPlayed',this\.checked\)"/, 'IG lastPlayed field checkbox');
});

// ─── 9. Dependency isolation ──────────────────────────────────────────────────

test('display-prefs.js: _agLoadDisplayPrefs does not reference currentView', () => {
    const idx = DISPLAY_PREFS_JS.indexOf('function _agLoadDisplayPrefs()');
    const fn  = DISPLAY_PREFS_JS.slice(idx, idx + 500);
    assert.doesNotMatch(fn, /\bcurrentView\b/);
});

test('display-prefs.js: _agSaveDisplayPrefs does not reference currentView', () => {
    const idx = DISPLAY_PREFS_JS.indexOf('function _agSaveDisplayPrefs()');
    const fn  = DISPLAY_PREFS_JS.slice(idx, idx + 200);
    assert.doesNotMatch(fn, /\bcurrentView\b/);
});

test('display-prefs.js: _agLoadDisplayPrefs does not reference playtimeData', () => {
    const idx = DISPLAY_PREFS_JS.indexOf('function _agLoadDisplayPrefs()');
    const fn  = DISPLAY_PREFS_JS.slice(idx, idx + 500);
    assert.doesNotMatch(fn, /\bplaytimeData\b/);
});

test('display-prefs.js: _igLoadDisplayPrefs does not reference currentView', () => {
    const idx = DISPLAY_PREFS_JS.indexOf('function _igLoadDisplayPrefs()');
    const fn  = DISPLAY_PREFS_JS.slice(idx, idx + 500);
    assert.doesNotMatch(fn, /\bcurrentView\b/);
});

test('display-prefs.js: _igSaveDisplayPrefs does not reference currentView', () => {
    const idx = DISPLAY_PREFS_JS.indexOf('function _igSaveDisplayPrefs()');
    const fn  = DISPLAY_PREFS_JS.slice(idx, idx + 200);
    assert.doesNotMatch(fn, /\bcurrentView\b/);
});

test('display-prefs.js: _agApplyDisplayPrefs does not reference currentFilters', () => {
    const idx = DISPLAY_PREFS_JS.indexOf('function _agApplyDisplayPrefs(');
    const fn  = DISPLAY_PREFS_JS.slice(idx, idx + 3700);
    assert.doesNotMatch(fn, /\bcurrentFilters\b/);
});

test('display-prefs.js: _igApplyDisplayPrefs does not reference currentFilters', () => {
    const idx = DISPLAY_PREFS_JS.indexOf('function _igApplyDisplayPrefs()');
    const fn  = DISPLAY_PREFS_JS.slice(idx, idx + 2600);
    assert.doesNotMatch(fn, /\bcurrentFilters\b/);
});

test('display-prefs.js: _agApplyDisplayPrefs does not reference playtimeData', () => {
    const idx = DISPLAY_PREFS_JS.indexOf('function _agApplyDisplayPrefs(');
    const fn  = DISPLAY_PREFS_JS.slice(idx, idx + 3700);
    assert.doesNotMatch(fn, /\bplaytimeData\b/);
});

// ─── 10. Window exports ───────────────────────────────────────────────────────

test('display-prefs.js: _agApplyDisplayPrefs explicitly exported on window', () => {
    assert.match(DISPLAY_PREFS_JS, /window\._agApplyDisplayPrefs\s*=\s*_agApplyDisplayPrefs/);
});

test('display-prefs.js: _agSaveDisplayPrefs explicitly exported on window', () => {
    assert.match(DISPLAY_PREFS_JS, /window\._agSaveDisplayPrefs\s*=\s*_agSaveDisplayPrefs/);
});

test('display-prefs.js: _igApplyDisplayPrefs explicitly exported on window', () => {
    assert.match(DISPLAY_PREFS_JS, /window\._igApplyDisplayPrefs\s*=\s*_igApplyDisplayPrefs/);
});

test('display-prefs.js: _igSaveDisplayPrefs explicitly exported on window', () => {
    assert.match(DISPLAY_PREFS_JS, /window\._igSaveDisplayPrefs\s*=\s*_igSaveDisplayPrefs/);
});

// ─── 11. Load order in dashboard.html ────────────────────────────────────────

test('dashboard.html: display-prefs.js is present', () => {
    assert.match(HTML, /accounts\/display-prefs\.js/, 'display-prefs.js must be in dashboard.html');
});

test('dashboard.html: display-prefs.js loads before accounts.js', () => {
    const dpIdx  = HTML.indexOf('accounts/display-prefs.js');
    const accIdx = HTML.indexOf('"js/accounts.js"');
    assert.ok(dpIdx > -1, 'display-prefs.js must be in dashboard.html');
    assert.ok(dpIdx < accIdx, 'display-prefs.js must load before accounts.js');
});

test('dashboard.html: display-prefs.js loads after app.js', () => {
    const appIdx = HTML.indexOf('"js/app.js"');
    const dpIdx  = HTML.indexOf('accounts/display-prefs.js');
    assert.ok(appIdx > -1, 'app.js must be in dashboard.html');
    assert.ok(dpIdx > appIdx, 'display-prefs.js must load after app.js');
});
