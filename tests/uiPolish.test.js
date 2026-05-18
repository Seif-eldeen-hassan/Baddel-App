'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT    = path.resolve(__dirname, '..');
const APP_JS  = fs.readFileSync(path.join(ROOT, 'src/js/app.js'),         'utf8');
const GD_JS   = fs.readFileSync(path.join(ROOT, 'src/js/game-details.js'),'utf8');
const ACC_JS  = fs.readFileSync(path.join(ROOT, 'src/js/accounts.js'),    'utf8');
const HTML    = fs.readFileSync(path.join(ROOT, 'src/dashboard.html'),    'utf8');
const CSS     = fs.readFileSync(path.join(ROOT, 'src/css/dashboard.css'), 'utf8');
const MAIN_JS = fs.readFileSync(path.join(ROOT, 'main.js'),               'utf8');
const SYNC_JS = fs.readFileSync(path.join(ROOT, 'platformSync.js'),       'utf8');

// ── Task D — Platform filter normalization ────────────────────────────────────

test('Task D: _PLAT_NORM_MAP constant exists in app.js', () => {
    assert.match(APP_JS, /_PLAT_NORM_MAP/);
});

test('Task D: _normPlatform function exists in app.js', () => {
    assert.match(APP_JS, /function _normPlatform\s*\(/);
});

test('Task D: _normPlatform inline logic maps known aliases', () => {
    // Extract the map literal for assertion
    assert.match(APP_JS, /'epic games':\s*'epic'/);
    assert.match(APP_JS, /'ea app':\s*'ea'/);
    assert.match(APP_JS, /'riot games':\s*'riot'/);
    assert.match(APP_JS, /'ubisoft connect':\s*'ubisoft'/);
});

test('Task D: applyFilters uses _normPlatform via _gameMatchesPlatformFilter helper', () => {
    // Platform filtering is delegated to _gameMatchesPlatformFilter which calls _normPlatform internally
    const filterBlock = APP_JS.slice(
        APP_JS.indexOf('if (currentFilters.platform'),
        APP_JS.indexOf('if (currentFilters.platform') + 800
    );
    assert.match(filterBlock, /_gameMatchesPlatformFilter/);
    // The helper itself must call _normPlatform
    const helperStart = APP_JS.indexOf('function _gameMatchesPlatformFilter');
    const helper = APP_JS.slice(helperStart, helperStart + 400);
    assert.match(helper, /_normPlatform/);
});

test('Task D: applyFilters also checks game sources via _gameMatchesPlatformFilter', () => {
    // Source/platform matching is handled inside _gameMatchesPlatformFilter via _platformAliasesForGame
    const helperStart = APP_JS.indexOf('function _gameMatchesPlatformFilter');
    const helper = APP_JS.slice(helperStart, helperStart + 400);
    assert.match(helper, /_platformAliasesForGame/);
    // _platformAliasesForGame must reference sources or platform
    const aliasStart = APP_JS.indexOf('function _platformAliasesForGame');
    const aliasFn = APP_JS.slice(aliasStart, aliasStart + 600);
    assert.match(aliasFn, /platform|sources/);
});

test('Task D: platform dropdown items in HTML use canonical short keys in igSelectPlatform calls', () => {
    // igSelectPlatform's first arg must be the canonical key ('epic', 'riot', not long forms)
    assert.match(HTML, /igSelectPlatform\('epic'/);
    assert.match(HTML, /igSelectPlatform\('riot'/);
    assert.doesNotMatch(HTML, /igSelectPlatform\('epic games'/i);
    assert.doesNotMatch(HTML, /igSelectPlatform\('riot games'/i);
});

// ── Task A — Favorite heart button ───────────────────────────────────────────

test('Task A: createGameCard includes gc-fav-btn in its output', () => {
    assert.match(APP_JS, /gc-fav-btn/);
});

test('Task A: _toggleCardFavorite function exists in app.js', () => {
    assert.match(APP_JS, /function _toggleCardFavorite\s*\(/);
    assert.match(APP_JS, /async function _toggleCardFavorite/);
});

test('Task A: _toggleCardFavorite calls removeGameFromCollection when unfavoriting', () => {
    const fn = APP_JS.slice(
        APP_JS.indexOf('async function _toggleCardFavorite'),
        APP_JS.indexOf('\n}', APP_JS.indexOf('async function _toggleCardFavorite')) + 2
    );
    assert.match(fn, /removeGameFromCollection/);
    assert.match(fn, /addGameToCollection/);
});

test('Task A: .gc-fav-btn CSS is positioned absolute and hidden by default', () => {
    const cssBlock = CSS.slice(CSS.indexOf('.gc-fav-btn'), CSS.indexOf('.gc-fav-btn') + 400);
    assert.match(cssBlock, /position:\s*absolute/);
    assert.match(cssBlock, /opacity:\s*0/);
});

test('Task A: .gc-fav-active CSS shows the heart button', () => {
    assert.match(CSS, /\.gc-fav-btn\.gc-fav-active/);
    const activeBlock = CSS.slice(CSS.indexOf('.gc-fav-btn.gc-fav-active'), CSS.indexOf('.gc-fav-btn.gc-fav-active') + 200);
    assert.match(activeBlock, /opacity:\s*1/);
});

// ── Task B — Game Details Back navigation ────────────────────────────────────

test('Task B: _gdPreviousView variable declared in game-details.js', () => {
    assert.match(GD_JS, /_gdPreviousView/);
});

test('Task B: _gdSavedFilterState variable declared in game-details.js', () => {
    assert.match(GD_JS, /_gdSavedFilterState/);
});

test('Task B: openGameDetails captures currentView into _gdPreviousView', () => {
    // Use the assignment form to find the actual function definition, not an earlier reference call
    const openFn = GD_JS.slice(
        GD_JS.indexOf('window.openGameDetails = async function'),
        GD_JS.indexOf('window.openGameDetails = async function') + 2000
    );
    assert.match(openFn, /_gdPreviousView\s*=/);
    assert.match(openFn, /currentView/);
});

test('Task B: closeGameDetails restores installed view when _gdPreviousView is installed', () => {
    const closeFn = GD_JS.slice(
        GD_JS.indexOf("prev === 'installed'"),
        GD_JS.indexOf("prev === 'installed'") + 1400
    );
    assert.match(closeFn, /navigateToInstalled/);
    assert.match(closeFn, /currentFilters\.platform/);
});

test('Task B: closeGameDetails restores collection view when _gdPreviousView is collection', () => {
    const closeFn = GD_JS.slice(
        GD_JS.indexOf("prev === 'collection'"),
        GD_JS.indexOf("prev === 'collection'") + 400
    );
    assert.match(closeFn, /filterByCollection/);
});

// ── Task C — Media cleanup on navigation away ─────────────────────────────────

test('Task C: window._gdStopMediaOnNavAway is exposed by game-details.js', () => {
    assert.match(GD_JS, /window\._gdStopMediaOnNavAway\s*=/);
});

test('Task C: _hideAllViews in app.js calls _gdStopMediaOnNavAway when GD view is visible', () => {
    const hideBlock = APP_JS.slice(
        APP_JS.indexOf('function _hideAllViews'),
        APP_JS.indexOf('function _hideAllViews') + 800
    );
    assert.match(hideBlock, /_gdStopMediaOnNavAway/);
});

test('Task C: media teardown guard checks gameDetailsView display before calling stop', () => {
    const hideBlock = APP_JS.slice(
        APP_JS.indexOf('function _hideAllViews'),
        APP_JS.indexOf('function _hideAllViews') + 800
    );
    assert.match(hideBlock, /gameDetailsView/);
    assert.match(hideBlock, /style\.display/);
});

// ── Task E — Display toggles ──────────────────────────────────────────────────

test('Task E: _igApplyDisplayPrefs function exists in accounts.js', () => {
    assert.match(ACC_JS, /function _igApplyDisplayPrefs\s*\(/);
});

test('Task E: patched applyFilters calls _igApplyDisplayPrefs after the original', () => {
    const patch = ACC_JS.slice(
        ACC_JS.indexOf('window.applyFilters'),
        ACC_JS.indexOf('window.applyFilters') + 600
    );
    assert.match(patch, /_origApplyFilters/);
    assert.match(patch, /_igApplyDisplayPrefs/);
});

test('Task E: CSS contains ig-hide-title class', () => {
    assert.match(CSS, /ig-hide-title/);
});

test('Task E: CSS contains ig-hide-platform class', () => {
    assert.match(CSS, /ig-hide-platform/);
});

// ── Task F — Platform icon styling ───────────────────────────────────────────

test('Task F: .epic-icon background scoped to .platform-card in accounts.css', () => {
    const accCss = fs.readFileSync(path.join(ROOT, 'src/css/accounts.css'), 'utf8');
    assert.match(accCss, /\.platform-card\s+\.epic-icon/);
    assert.doesNotMatch(accCss, /^\.epic-icon\s*\{[^}]*background/m);
});

test('Task F: invert-on-dark hover fix — no filter removal on :hover in dashboard.css', () => {
    // filter: none only on .nav-item.active, not on :hover
    assert.doesNotMatch(CSS, /nav-item:hover[^}]*invert-on-dark[^}]*filter:\s*none/);
    assert.match(CSS, /\.nav-item\.active\s+img\.invert-on-dark/);
});

test('Task F: Ubisoft sidebar icon uses Ubisoft_white.png asset', () => {
    assert.match(HTML, /Ubisoft_white\.png/);
});

// ── Task G — Roulette card title placement ────────────────────────────────────

test('Task G: #rouletteName is NOT nested inside .roulette-overlay', () => {
    const overlayBlock = HTML.slice(
        HTML.indexOf('roulette-overlay'),
        HTML.indexOf('/div', HTML.indexOf('roulette-overlay') + 10) + 5
    );
    assert.doesNotMatch(overlayBlock, /id="rouletteName"/);
});

test('Task G: .roulette-caption wrapper exists in HTML', () => {
    assert.match(HTML, /class="roulette-caption"/);
});

test('Task G: #rouletteName lives inside .roulette-caption', () => {
    const captionBlock = HTML.slice(
        HTML.indexOf('roulette-caption'),
        HTML.indexOf('roulette-caption') + 400
    );
    assert.match(captionBlock, /id="rouletteName"/);
});

test('Task G: .roulette-caption-name CSS class exists', () => {
    assert.match(CSS, /\.roulette-caption-name/);
});

// ── Task H — Ready to Install empty state ────────────────────────────────────

test('Task H: no raw emoji in syncedSuggEmpty initial HTML', () => {
    // Find the div and extract only up to its closing tag (it's now empty)
    const startIdx = HTML.indexOf('id="syncedSuggEmpty"');
    const closeTag = HTML.indexOf('</div>', startIdx);
    const emptyDiv = HTML.slice(startIdx, closeTag + 6);
    assert.doesNotMatch(emptyDiv, /✅/);
    // The div should be essentially empty (no text/emoji content between the tags)
    const innerContent = emptyDiv.replace(/id="syncedSuggEmpty"[^>]*>/, '').replace('</div>', '').trim();
    assert.equal(innerContent, '', `syncedSuggEmpty should be empty but contains: ${innerContent.slice(0, 80)}`);
});

test('Task H: empty.innerHTML in app.js uses SVG icon, not emoji', () => {
    // The svg has class="synced-empty-icon" — search for the opening tag
    assert.match(APP_JS, /<svg[^>]*synced-empty-icon/);
    assert.doesNotMatch(APP_JS.slice(
        APP_JS.indexOf('synced-empty-icon'),
        APP_JS.indexOf('synced-empty-icon') + 200
    ), /✅/);
});

test('Task H: empty state uses .synced-empty-title and .synced-empty-sub classes', () => {
    assert.match(APP_JS, /synced-empty-title/);
    assert.match(APP_JS, /synced-empty-sub/);
});

test('Task H: CSS defines .synced-empty-title', () => {
    assert.match(CSS, /\.synced-empty-title/);
});

test('Task H: CTA button navigates to accounts when no platforms linked', () => {
    const ctaBlock = APP_JS.slice(
        APP_JS.indexOf('syncedCtaBtns'),
        APP_JS.indexOf('syncedCtaBtns') + 600
    );
    // Navigates either via selectAccountPlatform or navigateToAllGames / nav-all-games click
    assert.match(ctaBlock, /selectAccountPlatform|navigateToAllGames|nav-all-games/);
});

test('Task H: CTA has a single connect button, not two redundant platform buttons', () => {
    // Find the ctaBtns.innerHTML assignment inside the linkedPlatforms.length === 0 branch
    const noAccBranch = APP_JS.slice(
        APP_JS.indexOf('linkedPlatforms.length === 0'),
        APP_JS.indexOf('linkedPlatforms.length === 0') + 1400
    );
    // Button text is either "Open Accounts" or "Connect Accounts" — no "Connect Steam" duplicate
    assert.match(noAccBranch, /Open Accounts|Connect Accounts/);
    const connectSteamCount = (noAccBranch.match(/Connect Steam/g) || []).length;
    assert.equal(connectSteamCount, 0, 'Redundant "Connect Steam" button still present');
});

// ── Task I — Auto-sync on startup ─────────────────────────────────────────────

test('Task I: autoSyncOnStartup is exported from platformSync.js', () => {
    assert.match(SYNC_JS, /autoSyncOnStartup/);
    const exportsBlock = SYNC_JS.slice(SYNC_JS.lastIndexOf('module.exports'));
    assert.match(exportsBlock, /autoSyncOnStartup/);
});

test('Task I: autoSyncOnStartup iterates ALL_CONNECTORS', () => {
    const fn = SYNC_JS.slice(
        SYNC_JS.indexOf('async function autoSyncOnStartup'),
        SYNC_JS.indexOf('async function autoSyncOnStartup') + 600
    );
    assert.match(fn, /ALL_CONNECTORS/);
});

test('Task I: autoSyncOnStartup checks isSyncing before firing', () => {
    const fn = SYNC_JS.slice(
        SYNC_JS.indexOf('async function autoSyncOnStartup'),
        SYNC_JS.indexOf('async function autoSyncOnStartup') + 600
    );
    assert.match(fn, /isSyncing/);
});

test('Task I: autoSyncOnStartup calls syncLibrary in fire-and-forget manner', () => {
    const fn = SYNC_JS.slice(
        SYNC_JS.indexOf('async function autoSyncOnStartup'),
        SYNC_JS.indexOf('async function autoSyncOnStartup') + 600
    );
    assert.match(fn, /syncLibrary\(\)/);
    assert.match(fn, /\.catch/);
});

test('Task I: main.js imports autoSyncOnStartup from platformSync', () => {
    assert.match(MAIN_JS, /autoSyncOnStartup/);
    assert.match(MAIN_JS, /require\(.*platformSync.*\)/);
});

test('Task I: main.js schedules autoSyncOnStartup with setTimeout after ready-to-show', () => {
    const readyBlock = MAIN_JS.slice(
        MAIN_JS.indexOf("mainWindow.once('ready-to-show'"),
        MAIN_JS.indexOf("mainWindow.once('ready-to-show'") + 1500
    );
    assert.match(readyBlock, /setTimeout/);
    assert.match(readyBlock, /autoSyncOnStartup/);
});

test('Task I: startup delay is at least 5 seconds', () => {
    const readyBlock = MAIN_JS.slice(
        MAIN_JS.indexOf("mainWindow.once('ready-to-show'"),
        MAIN_JS.indexOf("mainWindow.once('ready-to-show'") + 600
    );
    const delayMatch = readyBlock.match(/autoSyncOnStartup\(\)[^,)]*[,)]\s*(\d[\d_]*)/);
    if (delayMatch) {
        const ms = parseInt(delayMatch[1].replace(/_/g, ''), 10);
        assert.ok(ms >= 5000, `Startup sync delay is ${ms}ms — should be at least 5000ms`);
    } else {
        // setTimeout(() => autoSyncOnStartup(), 12_000) form
        const timeoutMatch = readyBlock.match(/setTimeout\([^,]+,\s*(\d[\d_]*)\)/);
        if (timeoutMatch) {
            const ms = parseInt(timeoutMatch[1].replace(/_/g, ''), 10);
            assert.ok(ms >= 5000, `Startup sync delay is ${ms}ms — should be at least 5000ms`);
        }
    }
});

// ── Task G — All Games "Show Fields" checkboxes ───────────────────────────────
// Regression guard: _vsBuildCard must call _agDecorateAllGamesCardFields so the
// overlay (title/playtime/lastPlayed/installed) is present in virtualized cards.

const ACC_CSS = fs.readFileSync(path.join(ROOT, 'src/css/accounts.css'), 'utf8');

test('Task G: _vsBuildCard calls _agDecorateAllGamesCardFields', () => {
    // Find _vsBuildCard body (from function declaration to the matching return)
    const fnStart = ACC_JS.indexOf('function _vsBuildCard(');
    assert.ok(fnStart !== -1, '_vsBuildCard not found in accounts.js');
    const fnSlice = ACC_JS.slice(fnStart, fnStart + 4000);
    assert.match(
        fnSlice,
        /_agDecorateAllGamesCardFields/,
        '_vsBuildCard must call _agDecorateAllGamesCardFields to add the display overlay'
    );
});

test('Task G: _agDecorateAllGamesCardFields exists in app.js', () => {
    assert.match(APP_JS, /function _agDecorateAllGamesCardFields/);
});

test('Task G: ag-card-display-overlay CSS is defined for #allGamesGrid', () => {
    assert.match(CSS, /#allGamesGrid .ag-card-display-overlay/);
});

test('Task G: show-playtime CSS shows .ag-card-field-playtime', () => {
    assert.match(CSS, /#allGamesGrid\.show-playtime .ag-card-field-playtime/);
});

test('Task G: show-lastPlayed CSS shows .ag-card-field-lastPlayed', () => {
    assert.match(CSS, /#allGamesGrid\.show-lastPlayed .ag-card-field-lastPlayed/);
});

test('Task G: show-installed CSS shows .ag-card-field-installed', () => {
    assert.match(CSS, /#allGamesGrid\.show-installed .ag-card-field-installed/);
});

test('Task G: hide-title CSS hides ag-card-display-title', () => {
    assert.match(CSS, /#allGamesGrid\.hide-title .ag-card-display-title/);
});

test('Task G: hide-platforms CSS hides agc-badges-strip', () => {
    assert.match(CSS, /#allGamesGrid\.hide-platforms .agc-badges-strip/);
});

test('Task G: setAgField function is exposed on window in app.js', () => {
    assert.match(APP_JS, /window\.setAgField\s*=\s*setAgField/);
});

test('Task G: game-card-info is hidden in All Games grid (no duplicate title)', () => {
    assert.match(ACC_CSS, /#allGamesGrid .game-card-info\s*\{[^}]*display:\s*none/);
});
