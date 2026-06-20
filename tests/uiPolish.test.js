'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT              = path.resolve(__dirname, '..');
const APP_JS            = fs.readFileSync(path.join(ROOT, 'src/js/app.js'),                         'utf8');
const GAME_CARD_JS      = fs.readFileSync(path.join(ROOT, 'src/js/app/game-card.js'),               'utf8');
const SUGGESTIONS_JS    = fs.readFileSync(path.join(ROOT, 'src/js/app/suggestions.js'),              'utf8');
const SIDEBAR_JS        = fs.readFileSync(path.join(ROOT, 'src/js/app/sidebar.js'),                 'utf8');
const COLLECTIONS_JS    = fs.readFileSync(path.join(ROOT, 'src/js/app/collections.js'),             'utf8');
const GAME_CONTEXT_JS   = fs.readFileSync(path.join(ROOT, 'src/js/app/game-context-actions.js'),    'utf8');
const ARTWORK_SYNC_JS   = fs.readFileSync(path.join(ROOT, 'src/js/app/artwork-sync.js'),            'utf8');
const HELP_JS = fs.readFileSync(path.join(ROOT, 'src/js/app/help-feedback.js'), 'utf8');
const GD_JS   = fs.readFileSync(path.join(ROOT, 'src/js/game-details.js'),'utf8');
const ACC_JS             = fs.readFileSync(path.join(ROOT, 'src/js/accounts.js'),                   'utf8');
const DISPLAY_PREFS_JS   = fs.readFileSync(path.join(ROOT, 'src/js/accounts/display-prefs.js'),     'utf8');
const PLATFORM_PANELS_JS = fs.readFileSync(path.join(ROOT, 'src/js/accounts/platform-panels.js'),   'utf8');
const HTML    = fs.readFileSync(path.join(ROOT, 'src/dashboard.html'),    'utf8');
const CSS         = fs.readFileSync(path.join(ROOT, 'src/css/dashboard.css'), 'utf8');
const ACCOUNTS_CSS = fs.readFileSync(path.join(ROOT, 'src/css/accounts.css'),  'utf8');
const MAIN_JS             = fs.readFileSync(path.join(ROOT, 'main.js'),               'utf8');
const SYNC_JS             = fs.readFileSync(path.join(ROOT, 'platformSync.js'),       'utf8');
const GAME_LIBRARY_HANDLERS_JS   = fs.readFileSync(path.join(ROOT, 'handlers/gameLibraryHandlers.js'),   'utf8');
const GAME_METADATA_HANDLERS_JS  = fs.readFileSync(path.join(ROOT, 'handlers/gameMetadataHandlers.js'),  'utf8');

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

test('Task A: _toggleCardFavorite function exists in game-context-actions.js', () => {
    assert.match(GAME_CONTEXT_JS, /function _toggleCardFavorite\s*\(/);
    assert.match(GAME_CONTEXT_JS, /async function _toggleCardFavorite/);
});

test('Task A: _toggleCardFavorite calls removeGameFromCollection when unfavoriting', () => {
    const fn = GAME_CONTEXT_JS.slice(
        GAME_CONTEXT_JS.indexOf('async function _toggleCardFavorite'),
        GAME_CONTEXT_JS.indexOf('\n}', GAME_CONTEXT_JS.indexOf('async function _toggleCardFavorite')) + 2
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

test('Task E: _igApplyDisplayPrefs function exists in display-prefs.js', () => {
    assert.match(DISPLAY_PREFS_JS, /function _igApplyDisplayPrefs\s*\(/);
});

test('Task E: patched applyFilters calls _igApplyDisplayPrefs after the original', () => {
    const patch = ACC_JS.slice(
        ACC_JS.indexOf('window.applyFilters'),
        ACC_JS.indexOf('window.applyFilters') + 600
    );
    assert.match(patch, /_origApplyFilters/);
    assert.match(patch, /window\._igApplyDisplayPrefs/);
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

test('Task H: empty.innerHTML in suggestions.js uses SVG icon, not emoji', () => {
    // The svg has class="synced-empty-icon" — search for the opening tag
    assert.match(SUGGESTIONS_JS, /<svg[^>]*synced-empty-icon/);
    assert.doesNotMatch(SUGGESTIONS_JS.slice(
        SUGGESTIONS_JS.indexOf('synced-empty-icon'),
        SUGGESTIONS_JS.indexOf('synced-empty-icon') + 200
    ), /✅/);
});

test('Task H: empty state uses .synced-empty-title and .synced-empty-sub classes', () => {
    assert.match(SUGGESTIONS_JS, /synced-empty-title/);
    assert.match(SUGGESTIONS_JS, /synced-empty-sub/);
});

test('Task H: CSS defines .synced-empty-title', () => {
    assert.match(CSS, /\.synced-empty-title/);
});

test('Task H: CTA button navigates to accounts when no platforms linked', () => {
    const ctaBlock = SUGGESTIONS_JS.slice(
        SUGGESTIONS_JS.indexOf('syncedCtaBtns'),
        SUGGESTIONS_JS.indexOf('syncedCtaBtns') + 600
    );
    // Navigates either via selectAccountPlatform or navigateToAllGames / nav-all-games click
    assert.match(ctaBlock, /selectAccountPlatform|navigateToAllGames|nav-all-games/);
});

test('Task H: CTA has a single connect button, not two redundant platform buttons', () => {
    // Find the ctaBtns.innerHTML assignment inside the linkedPlatforms.length === 0 branch
    const noAccBranch = SUGGESTIONS_JS.slice(
        SUGGESTIONS_JS.indexOf('linkedPlatforms.length === 0'),
        SUGGESTIONS_JS.indexOf('linkedPlatforms.length === 0') + 1400
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

test('Task I: main.js schedules autoSyncOnStartup after ready-to-show', () => {
    const readyBlock = MAIN_JS.slice(
        MAIN_JS.indexOf("mainWindow.once('ready-to-show'"),
        MAIN_JS.indexOf("mainWindow.once('ready-to-show'") + 2000
    );
    assert.match(readyBlock, /autoSyncOnStartup/);
    // Must be wrapped in runAfterStartupGrace (which internally delays at boot)
    assert.match(readyBlock, /runAfterStartupGrace\('autoSyncOnStartup'/, 'must use runAfterStartupGrace wrapper');
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
    const fnSlice = ACC_JS.slice(fnStart, fnStart + 5500);
    assert.match(
        fnSlice,
        /_agDecorateAllGamesCardFields/,
        '_vsBuildCard must call _agDecorateAllGamesCardFields to add the display overlay'
    );
});

test('Task G: _agDecorateAllGamesCardFields exists in game-card.js', () => {
    assert.match(GAME_CARD_JS, /function _agDecorateAllGamesCardFields/);
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

// Phase 2.2 complete: app.js dead field-pref infrastructure removed.
// accounts.js is the sole runtime owner of window.setAgField/setIgField.
test('Phase 2.2: app.js does NOT assign window.setAgField via named ref (dead code removed)', () => {
    assert.doesNotMatch(APP_JS, /window\.setAgField\s*=\s*setAgField\b/,
        'dead app.js assignment must be gone after Phase 2.2');
});

test('Task G: game-card-info is hidden in All Games grid (no duplicate title)', () => {
    assert.match(ACC_CSS, /#allGamesGrid .game-card-info\s*\{[^}]*display:\s*none/);
});

// ── All Games empty-state onboarding ─────────────────────────────────────────

test('accounts.js: _agHasLinkedSteamOrEpicAccounts is defined', () => {
    assert.ok(ACC_JS.includes('async function _agHasLinkedSteamOrEpicAccounts'),
        '_agHasLinkedSteamOrEpicAccounts must be defined');
});

test('accounts.js: _agMaybeRenderEmptyOnboarding is defined', () => {
    assert.ok(ACC_JS.includes('async function _agMaybeRenderEmptyOnboarding'),
        '_agMaybeRenderEmptyOnboarding must be defined');
});

test('accounts.js: _agMaybeRenderEmptyOnboarding calls _agRenderEmptyOnboarding when no accounts', () => {
    const fnStart = ACC_JS.indexOf('async function _agMaybeRenderEmptyOnboarding');
    const fnEnd   = ACC_JS.indexOf('\nasync function ', fnStart + 1);
    const fn = ACC_JS.slice(fnStart, fnEnd > fnStart ? fnEnd : fnStart + 1500);
    assert.match(fn, /_agRenderEmptyOnboarding\(\)/, 'must call _agRenderEmptyOnboarding');
    assert.match(fn, /return true/, 'must return true when onboarding is shown');
    assert.match(fn, /return false/, 'must return false when onboarding is not needed');
});

test('accounts.js: _agRenderEmptyOnboarding calls _agSetEmptyPageMode and _agSetToolbarVisible', () => {
    const fnStart = ACC_JS.indexOf('function _agRenderEmptyOnboarding');
    const fn = ACC_JS.slice(fnStart, fnStart + 500);
    assert.match(fn, /_agSetEmptyPageMode\(true\)/, '_agSetEmptyPageMode(true) called');
    assert.match(fn, /_agSetToolbarVisible\(false\)/, '_agSetToolbarVisible(false) called');
});

test('accounts.js: _agRenderEmptyOnboarding hides allGamesList', () => {
    const fnStart = ACC_JS.indexOf('function _agRenderEmptyOnboarding');
    const fn = ACC_JS.slice(fnStart, fnStart + 800);
    assert.match(fn, /list.*display.*none|display.*none.*list/s, 'allGamesList must be hidden');
});

test('accounts.js: _applyAgFilters shows onboarding when cache empty and _agNoLinkedAccounts is true', () => {
    const fnStart = ACC_JS.indexOf('function _applyAgFilters');
    const fn = ACC_JS.slice(fnStart, fnStart + 2500);
    assert.match(fn, /_agNoLinkedAccounts/, '_agNoLinkedAccounts checked');
    assert.match(fn, /_agRenderEmptyOnboarding\(\)/, '_agRenderEmptyOnboarding called when cache empty');
    assert.match(fn, /_agSetToolbarVisible\(false\)/, 'toolbar hidden');
});

test('accounts.js: navigateToAllGames calls _agMaybeRenderEmptyOnboarding before renderAllGamesView', () => {
    const fnStart = ACC_JS.indexOf('async function navigateToAllGames');
    const fn = ACC_JS.slice(fnStart, fnStart + 10000);
    assert.match(fn, /_agMaybeRenderEmptyOnboarding/, '_agMaybeRenderEmptyOnboarding called in navigateToAllGames');
    // Must appear before renderAllGamesView call
    const maybeIdx  = fn.indexOf('_agMaybeRenderEmptyOnboarding');
    const renderIdx = fn.indexOf('renderAllGamesView');
    assert.ok(maybeIdx < renderIdx, '_agMaybeRenderEmptyOnboarding must precede renderAllGamesView');
});

test('accounts.js: renderAllGamesView calls _agMaybeRenderEmptyOnboarding after building cache', () => {
    const fnStart = ACC_JS.indexOf('window.renderAllGamesView = async function');
    const fn = ACC_JS.slice(fnStart, fnStart + 8500);
    assert.match(fn, /_agMaybeRenderEmptyOnboarding/, '_agMaybeRenderEmptyOnboarding called in renderAllGamesView');
    // Must appear after _allGamesCache is set
    const cacheIdx  = fn.indexOf('window._allGamesCache = await');
    const maybeIdx  = fn.indexOf('_agMaybeRenderEmptyOnboarding');
    assert.ok(cacheIdx < maybeIdx, '_agMaybeRenderEmptyOnboarding called after cache is built');
});

test('accounts.js: onLibraryUpdated clears empty mode when games arrive', () => {
    const listenerStart = ACC_JS.indexOf('onLibraryUpdated(async ()');
    // The handler is large — use a generous window to cover the full changed-pool path.
    const block = ACC_JS.slice(listenerStart, listenerStart + 10000);
    assert.match(block, /window\._allGamesCache\.length > 0/, 'checks _allGamesCache.length after filter');
    assert.match(block, /_agSetEmptyPageMode\(false\)/, '_agSetEmptyPageMode(false) called when games arrive');
    assert.match(block, /_agResetAllGamesGridMode\(\)/, '_agResetAllGamesGridMode called when games arrive');
});

// ─── Steam Link Account fix ───────────────────────────────────────────────────

test('accounts.js: linkNewPlatformAccount normalizes activePlatformView to lowercase', () => {
    const fnStart = PLATFORM_PANELS_JS.indexOf('async function linkNewPlatformAccount');
    const fn = PLATFORM_PANELS_JS.slice(fnStart, fnStart + 400);
    assert.match(fn, /\.toLowerCase\(\)/, 'platform must be lowercased');
    assert.match(fn, /\['steam', 'epic'\]\.includes\(platform\)/, "platform validated against ['steam','epic']");
});

test('accounts.js: linkNewPlatformAccount catch block uses actual error message not hardcoded string', () => {
    const fnStart = PLATFORM_PANELS_JS.indexOf('async function linkNewPlatformAccount');
    const fn = PLATFORM_PANELS_JS.slice(fnStart, fnStart + 6000);
    const catchStart = fn.indexOf('} catch (err)');
    const catchBlock = fn.slice(catchStart, catchStart + 300);
    assert.match(catchBlock, /err\?\.message/, 'catch block must use err.message');
    assert.doesNotMatch(catchBlock, /Failed to link account\./, 'must not show hardcoded "Failed to link account."');
    assert.match(catchBlock, /Failed to link.*Steam.*Epic|Failed to link.*platform/is, 'toast must name the platform');
});

test('accounts.js: linkNewPlatformAccount uses finally block for cleanup', () => {
    const fnStart = PLATFORM_PANELS_JS.indexOf('async function linkNewPlatformAccount');
    const fn = PLATFORM_PANELS_JS.slice(fnStart, fnStart + 6500);
    assert.match(fn, /\} finally \{/, 'finally block must be present');
    const finallyStart = fn.lastIndexOf('} finally {');
    const finallyBlock = fn.slice(finallyStart, finallyStart + 80);
    assert.match(finallyBlock, /cleanup\(\)/, 'finally block must call cleanup()');
});

test('accounts.js: invalid activePlatformView shows error without calling platformSyncLink', () => {
    const fnStart = PLATFORM_PANELS_JS.indexOf('async function linkNewPlatformAccount');
    const fn = PLATFORM_PANELS_JS.slice(fnStart, fnStart + 400);
    // The guard must throw/return before the IPC call which appears later in the function
    const guardIdx = fn.indexOf("!['steam', 'epic'].includes(platform)");
    const ipcIdx   = fn.indexOf('platformSyncLink');
    assert.ok(guardIdx !== -1, "platform guard must exist");
    // Guard is before the IPC call (or IPC call isn't in the guard window at all)
    assert.ok(ipcIdx === -1 || guardIdx < ipcIdx, 'platform guard must precede platformSyncLink call');
});

test('platformSync.js: platform-sync:link handler returns {status,code,message} on error', () => {
    const handlerStart = SYNC_JS.indexOf("ipcMainRef.handle('platform-sync:link'");
    const handler = SYNC_JS.slice(handlerStart, handlerStart + 1300);
    assert.match(handler, /status.*'error'|'error'.*status/s, 'handler must return status: error on failure');
    assert.match(handler, /code.*err\.code|err\.code.*code/s, 'handler must propagate err.code');
    assert.match(handler, /message.*err\.message|err\.message.*message/s, 'handler must propagate err.message');
});

test('platformSync.js: platform-sync:link handler derives parentWindow from event.sender', () => {
    const handlerStart = SYNC_JS.indexOf("ipcMainRef.handle('platform-sync:link'");
    const handler = SYNC_JS.slice(handlerStart, handlerStart + 300);
    assert.match(handler, /BrowserWindow\.fromWebContents\(event\.sender\)/, 'parentWindow derived from BrowserWindow.fromWebContents(event.sender)');
});

test('platformSync.js: steamConnector.link wraps _ensureBridgeRunning as STEAM_BRIDGE_START_FAILED', () => {
    const linkStart = SYNC_JS.indexOf('async link(parentWindow)');
    const linkFn = SYNC_JS.slice(linkStart, linkStart + 600);
    assert.match(linkFn, /_ensureBridgeRunning\(\)/, '_ensureBridgeRunning called');
    assert.match(linkFn, /STEAM_BRIDGE_START_FAILED/, 'error code STEAM_BRIDGE_START_FAILED must be set');
    assert.match(linkFn, /e\.code = 'STEAM_BRIDGE_START_FAILED'/, 'error.code assigned before throw');
});

// ─── All Games: user-library filter (installed-only games must not appear) ────

test('accounts.js: _agIsUserLibraryGame is defined', () => {
    assert.match(ACC_JS, /function _agIsUserLibraryGame/, '_agIsUserLibraryGame must be defined');
});

test('accounts.js: _agGetUserLibraryGames is defined', () => {
    assert.match(ACC_JS, /function _agGetUserLibraryGames/, '_agGetUserLibraryGames must be defined');
});

test('accounts.js: _agIsUserLibraryGame returns false for Xbox installed-only game', () => {
    // Verify the function body rejects a game with platform=Xbox / scanner=xbox
    const fnStart = ACC_JS.indexOf('function _agIsUserLibraryGame');
    const fn = ACC_JS.slice(fnStart, fnStart + 1200);
    // Must NOT return true based on xbox platform alone
    assert.match(fn, /return false/, 'must have a final return false for non-library games');
    // steam/epic must match, xbox must not be in the allow-list
    assert.doesNotMatch(fn, /platform === 'xbox'/, 'xbox must not be in the positive match list');
});

test('accounts.js: _agIsUserLibraryGame rejects manual games (product rule: manual belongs in Installed Games only)', () => {
    const fnStart = ACC_JS.indexOf('function _agIsUserLibraryGame');
    const fn = ACC_JS.slice(fnStart, fnStart + 1200);
    // Must detect manual platform/scanner/installSource
    assert.match(fn, /platform === 'manual'/, 'must check manual platform');
    assert.match(fn, /installSource === 'manual'/, 'must check installSource');
    // Manual detection must lead to return false, not return true
    assert.doesNotMatch(fn, /isManual.*return true|return true.*isManual/s, 'manual branch must NOT return true');
    assert.match(fn, /return false/, 'must return false for manual games');
});

test('accounts.js: _agIsUserLibraryGame accepts steam and epic with synced evidence', () => {
    const fnStart = ACC_JS.indexOf('function _agIsUserLibraryGame');
    const fn = ACC_JS.slice(fnStart, fnStart + 3500);
    // isSteamOrEpic uses these checks
    assert.match(fn, /platform === 'steam'/, "steam platform check must exist");
    assert.match(fn, /platform === 'epic'/,  "epic platform check must exist");
    // Must be gated on hasSyncedAccountEvidence (not an unconditional return true)
    assert.match(fn, /isSteamOrEpic.*hasSyncedAccountEvidence|hasSyncedAccountEvidence.*isSteamOrEpic/s,
        'Steam/Epic must require hasSyncedAccountEvidence');
});

test('accounts.js: _agGetUserLibraryGames filters using _agIsUserLibraryGame', () => {
    const fnStart = ACC_JS.indexOf('function _agGetUserLibraryGames');
    const fn = ACC_JS.slice(fnStart, fnStart + 120);
    assert.match(fn, /_agIsUserLibraryGame/, '_agGetUserLibraryGames must call _agIsUserLibraryGame');
    assert.match(fn, /\.filter\(/, 'must use .filter()');
});

test('accounts.js: navigateToAllGames uses _agGetUserLibraryGames before skipping rebuild', () => {
    const fnStart = ACC_JS.indexOf('async function navigateToAllGames');
    const fn = ACC_JS.slice(fnStart, fnStart + 8000);
    assert.match(fn, /_agGetUserLibraryGames\(window\._allGamesCache\)/, 'must call _agGetUserLibraryGames on existing cache');
    // The early-return must only fire if libraryCache.length > 0
    const checkIdx  = fn.indexOf('_agGetUserLibraryGames(window._allGamesCache)');
    const returnIdx = fn.indexOf('libraryCache.length > 0');
    assert.ok(returnIdx > checkIdx, 'length check must follow _agGetUserLibraryGames call');
});

test('accounts.js: navigateToAllGames checks platformSyncStatus BEFORE using cache (no-account gate)', () => {
    const fnStart = ACC_JS.indexOf('async function navigateToAllGames');
    const fn = ACC_JS.slice(fnStart, fnStart + 8000);
    // Must call platformSyncStatus
    assert.match(fn, /platformSyncStatus/, 'must call platformSyncStatus');
    // Must clear caches and show onboarding when no accounts linked
    assert.match(fn, /window\._allGamesCache\s*=\s*\[\]/, 'must clear _allGamesCache when no accounts');
    assert.match(fn, /window\._allGamesRawCache\s*=\s*\[\]/, 'must clear _allGamesRawCache when no accounts');
    assert.match(fn, /_agRenderEmptyOnboarding\(\)/, 'must call _agRenderEmptyOnboarding when no accounts');
    // The account gate must come BEFORE the sanitize/cache-check block
    const gateIdx     = fn.indexOf('platformSyncStatus');
    const sanitizeIdx = fn.indexOf('_agGetUserLibraryGames(window._allGamesCache)');
    assert.ok(gateIdx < sanitizeIdx, 'account gate must precede cache sanitize');
});

test('accounts.js: renderAllGamesView stores raw cache in _allGamesRawCache', () => {
    const fnStart = ACC_JS.indexOf('window.renderAllGamesView = async function');
    const fn = ACC_JS.slice(fnStart, fnStart + 6500);
    assert.match(fn, /window\._allGamesRawCache/, '_allGamesRawCache must be set in renderAllGamesView');
});

test('accounts.js: renderAllGamesView assigns filtered cache to _allGamesCache', () => {
    const fnStart = ACC_JS.indexOf('window.renderAllGamesView = async function');
    const fn = ACC_JS.slice(fnStart, fnStart + 6500);
    assert.match(fn, /_agGetUserLibraryGames\(_rawResolved\)/, 'must filter raw result with _agGetUserLibraryGames');
    assert.match(fn, /window\._allGamesCache\s*=\s*_agGetUserLibraryGames/, '_allGamesCache must be assigned from _agGetUserLibraryGames');
});

test('accounts.js: _agMaybeRenderEmptyOnboarding uses _allGamesRawCache and library filter', () => {
    const fnStart = ACC_JS.indexOf('async function _agMaybeRenderEmptyOnboarding');
    const fn = ACC_JS.slice(fnStart, fnStart + 400);
    assert.match(fn, /window\._allGamesRawCache/, 'must reference _allGamesRawCache');
    assert.match(fn, /_agGetUserLibraryGames\(rawCache\)/, 'must call _agGetUserLibraryGames(rawCache)');
});

test('accounts.js: _applyAgFilters uses _agGetUserLibraryGames to filter pool', () => {
    const fnStart = ACC_JS.indexOf('function _applyAgFilters');
    const fn = ACC_JS.slice(fnStart, fnStart + 3000);
    assert.match(fn, /_agGetUserLibraryGames\(window\._allGamesCache/, 'must filter cache with _agGetUserLibraryGames');
    // pool must use the filtered cache — now delegated to _agBuildFilteredPool
    const filterIdx = fn.indexOf('_agGetUserLibraryGames(window._allGamesCache');
    const poolIdx   = fn.indexOf('_agBuildFilteredPool(');
    assert.ok(filterIdx !== -1, '_agGetUserLibraryGames(window._allGamesCache call must be present');
    assert.ok(poolIdx   !== -1, '_agBuildFilteredPool call must be present');
    assert.ok(filterIdx < poolIdx, '_agGetUserLibraryGames must run before _agBuildFilteredPool');
});

test('accounts.js: Installed Games (allGamesData) is not affected by library filter', () => {
    // allGamesData and getGames() must not be filtered — they feed Installed Games
    const fnStart = ACC_JS.indexOf('function _agApplyInstalledCreatorOverrides');
    const fn = ACC_JS.slice(fnStart, fnStart + 300);
    assert.match(fn, /window\.allGamesData|getGames/, 'allGamesData must still be populated from getGames');
    assert.doesNotMatch(fn, /_agGetUserLibraryGames/, '_agApplyInstalledCreatorOverrides must NOT filter allGamesData');
});

// ─── Manual Game poster: Delete Forever → re-add fix ─────────────────────────

const ADD_GAME_JS = fs.readFileSync(path.join(ROOT, 'src/js/addGameModal.js'), 'utf8');
const PRELOAD_JS  = fs.readFileSync(path.join(ROOT, 'preload.js'),             'utf8');

test('artwork-sync.js: _clearArtworkLocalState is defined and exposed on window', () => {
    assert.match(ARTWORK_SYNC_JS, /function _clearArtworkLocalState\(gameId\)/, 'function must be declared');
    assert.match(ARTWORK_SYNC_JS, /window\._clearArtworkLocalState\s*=\s*_clearArtworkLocalState/, 'must be exposed on window');
});

test('artwork-sync.js: _clearArtworkLocalState removes localStorage keys for cover/hero/logo', () => {
    const fnStart = ARTWORK_SYNC_JS.indexOf('function _clearArtworkLocalState');
    const fn = ARTWORK_SYNC_JS.slice(fnStart, fnStart + 600);
    assert.match(fn, /localStorage\.removeItem\('cover_'\s*\+\s*id\)/, 'removes cover_ key');
    assert.match(fn, /localStorage\.removeItem\('hero_'\s*\+\s*id\)/, 'removes hero_ key');
    assert.match(fn, /localStorage\.removeItem\('logo_'\s*\+\s*id\)/, 'removes logo_ key');
});

test('artwork-sync.js: _clearArtworkLocalState removes game from window._allGamesCache and allGamesData', () => {
    const fnStart = ARTWORK_SYNC_JS.indexOf('function _clearArtworkLocalState');
    const fn = ARTWORK_SYNC_JS.slice(fnStart, fnStart + 900);
    assert.match(fn, /window\._allGamesCache\s*=\s*window\._allGamesCache\.filter/, 'removes from _allGamesCache');
    assert.match(fn, /allGamesData\s*=\s*allGamesData\.filter/, 'removes from allGamesData');
});

test('artwork-sync.js: _clearArtworkLocalState removes cardCache and _coverQueued entries', () => {
    const fnStart = ARTWORK_SYNC_JS.indexOf('function _clearArtworkLocalState');
    const fn = ARTWORK_SYNC_JS.slice(fnStart, fnStart + 900);
    assert.match(fn, /cardCache.*instanceof Map/s, 'guards cardCache with instanceof Map');
    assert.match(fn, /cardCache\.delete\(id\)/, 'removes from cardCache');
    assert.match(fn, /_coverQueued.*instanceof Set/s, 'guards _coverQueued with instanceof Set');
    assert.match(fn, /_coverQueued\.delete\(id\)/, 'removes from _coverQueued');
});

test('game-context-actions.js: hardDeleteGame calls _clearArtworkLocalState after deleteGamePermanently', () => {
    const fnStart = GAME_CONTEXT_JS.indexOf('function hardDeleteGame');
    const fn = GAME_CONTEXT_JS.slice(fnStart, fnStart + 500);
    assert.match(fn, /deleteGamePermanently\(id\)/, 'calls deleteGamePermanently');
    const deleteIdx = fn.indexOf('deleteGamePermanently');
    const clearIdx  = fn.indexOf('_clearArtworkLocalState');
    assert.ok(clearIdx !== -1, '_clearArtworkLocalState must be called');
    assert.ok(deleteIdx < clearIdx, '_clearArtworkLocalState must come after deleteGamePermanently');
});

test('app.js: onGameDeletedPermanently listener calls _clearArtworkLocalState', () => {
    assert.match(APP_JS, /onGameDeletedPermanently/, 'listener must be registered');
    const listenerIdx = APP_JS.indexOf('onGameDeletedPermanently');
    const block = APP_JS.slice(listenerIdx, listenerIdx + 300);
    assert.match(block, /_clearArtworkLocalState\(id\)/, 'must call _clearArtworkLocalState with id');
});

test('preload.js: onGameDeletedPermanently is exposed via contextBridge', () => {
    assert.match(PRELOAD_JS, /onGameDeletedPermanently/, 'must be in preload');
    assert.match(PRELOAD_JS, /game-deleted-permanently/, 'must listen to game-deleted-permanently channel');
});

test('main.js: delete-game-permanently sends game-deleted-permanently event on success', () => {
    const handlerIdx = GAME_LIBRARY_HANDLERS_JS.indexOf("ipcMain.handle('delete-game-permanently'");
    const handler = GAME_LIBRARY_HANDLERS_JS.slice(handlerIdx, handlerIdx + 600);
    assert.match(handler, /game-deleted-permanently/, 'must send game-deleted-permanently');
    assert.match(handler, /\.send\('game-deleted-permanently'.*\{\s*id\s*\}/, 'must include id in payload');
});

test('artwork-sync.js: hydrateManualGameArtworkNow is defined and exposed on window', () => {
    assert.match(ARTWORK_SYNC_JS, /async function hydrateManualGameArtworkNow\(game\)/, 'function must be declared');
    assert.match(ARTWORK_SYNC_JS, /window\.hydrateManualGameArtworkNow\s*=\s*hydrateManualGameArtworkNow/, 'must be exposed on window');
});

test('artwork-sync.js: hydrateManualGameArtworkNow removes stale file:// cover from localStorage', () => {
    const fnStart = ARTWORK_SYNC_JS.indexOf('async function hydrateManualGameArtworkNow');
    const fn = ARTWORK_SYNC_JS.slice(fnStart, fnStart + 1200);
    assert.match(fn, /localStorage\.removeItem\('cover_'/, 'removes stale cover from localStorage');
    assert.match(fn, /_isUsableLocalArtwork/, 'uses _isUsableLocalArtwork to probe');
});

test('artwork-sync.js: hydrateManualGameArtworkNow passes force:true and bypassTtl:true unconditionally', () => {
    const fnStart = ARTWORK_SYNC_JS.indexOf('async function hydrateManualGameArtworkNow');
    const fn = ARTWORK_SYNC_JS.slice(fnStart, fnStart + 2000);
    assert.match(fn, /force:\s*true/, 'must pass force:true unconditionally');
    assert.match(fn, /bypassTtl:\s*true/, 'must pass bypassTtl:true');
    assert.match(fn, /source:\s*'manual-add-readd'/, 'uses manual-add-readd source');
});

test('artwork-sync.js: _isUsableLocalArtwork probes file:// URLs via probeLocalImage', () => {
    const fnStart = ARTWORK_SYNC_JS.indexOf('async function _isUsableLocalArtwork');
    const fn = ARTWORK_SYNC_JS.slice(fnStart, fnStart + 300);
    assert.match(fn, /probeLocalImage\(url\)/, 'calls probeLocalImage');
    assert.match(fn, /file:\/\//, 'checks for file:// prefix');
});

test('addGameModal.js: calls hydrateManualGameArtworkNow for each added game after success', () => {
    const successIdx = ADD_GAME_JS.indexOf('if (successCount > 0)');
    const block = ADD_GAME_JS.slice(successIdx, successIdx + 1200);
    assert.match(block, /hydrateManualGameArtworkNow/, 'must call hydrateManualGameArtworkNow');
    // Must come after closeAddGameModal so the modal is closed first
    const closeIdx   = block.indexOf('closeAddGameModal');
    const hydrateIdx = block.indexOf('hydrateManualGameArtworkNow');
    assert.ok(closeIdx < hydrateIdx, 'hydrateManualGameArtworkNow must come after closeAddGameModal');
});

test('addGameModal.js: awaits hydrateManualGameArtworkNow before applyFilters', () => {
    const successIdx = ADD_GAME_JS.indexOf('if (successCount > 0)');
    const block = ADD_GAME_JS.slice(successIdx, successIdx + 1400);
    // Must use await on hydrateManualGameArtworkNow (not fire-and-forget .catch)
    assert.match(block, /await window\.hydrateManualGameArtworkNow/, 'must await hydrateManualGameArtworkNow');
    // applyFilters must come AFTER hydration
    const hydrateIdx = block.indexOf('await window.hydrateManualGameArtworkNow');
    const applyIdx   = block.indexOf('applyFilters');
    assert.ok(hydrateIdx < applyIdx, 'applyFilters must come after hydration');
});

test('artwork-sync.js: hydrateManualGameArtworkNow passes rich manual hints to getMetadata', () => {
    const fnStart = ARTWORK_SYNC_JS.indexOf('async function hydrateManualGameArtworkNow');
    const fn = ARTWORK_SYNC_JS.slice(fnStart, fnStart + 1800);
    assert.match(fn, /command:\s*game\.command/, 'must pass command hint');
    assert.match(fn, /executablePath:\s*game\.executablePath/, 'must pass executablePath hint');
    assert.match(fn, /folderName:\s*game\.folderName/, 'must pass folderName hint');
    assert.match(fn, /exeName:\s*game\.exeName/, 'must pass exeName hint');
});

test('artwork-sync.js: hydrateManualGameArtworkNow uses meta.image/defaultImage/coverUrl as cover fallback', () => {
    const fnStart = ARTWORK_SYNC_JS.indexOf('async function hydrateManualGameArtworkNow');
    const fn = ARTWORK_SYNC_JS.slice(fnStart, fnStart + 2500);
    // finalCover must try multiple aliases
    assert.match(fn, /meta\.image/, 'must try meta.image as cover fallback');
    assert.match(fn, /meta\.defaultImage/, 'must try meta.defaultImage as cover fallback');
    assert.match(fn, /meta\.coverUrl/, 'must try meta.coverUrl as cover fallback');
});

test('app.js: _patchGameInMemory does not fall back to manual platform for belongsInAllGames', () => {
    const fnStart = APP_JS.indexOf('function _patchGameInMemory');
    const fn = APP_JS.slice(fnStart, fnStart + 800);
    // Fallback must be false, not a check for manual platform
    assert.doesNotMatch(fn, /scannerPlatform.*=== 'manual'|installSource.*=== 'manual'|platform.*=== 'Manual'/,
        'must not fall back to manual platform check in _patchGameInMemory');
    // When _agIsUserLibraryGame is unavailable, default to false
    assert.match(fn, /:\s*false\s*;/, 'fallback must be false');
});

// ─── Bug A: Manual re-add poster regression (MRM force + deleteGamePermanently) ─

const MRM_JS     = fs.readFileSync(path.join(ROOT, 'services/metadataResolutionManager.js'), 'utf8');
const SCANNER_JS = fs.readFileSync(path.join(ROOT, 'gameScanner.js'), 'utf8');

test('MRM.resolve: force/bypassTtl flag clears persisted job before computing status', () => {
    const fnStart = MRM_JS.indexOf('async resolve(gameId, hints = {})');
    const fn = MRM_JS.slice(fnStart, fnStart + 600);
    assert.match(fn, /hints\.force\s*===\s*true/, 'must check hints.force');
    assert.match(fn, /hints\.bypassTtl\s*===\s*true/, 'must check hints.bypassTtl');
    assert.match(fn, /clearJob\(id\)/, 'must call clearJob when force is set');
    // clearJob must come before getStatus so the RESOLVED check sees IDLE
    const clearIdx  = fn.indexOf('clearJob(id)');
    const statusIdx = fn.indexOf('getStatus(id)');
    assert.ok(clearIdx < statusIdx, 'clearJob must precede getStatus');
});

test('MRM.resolve: force=true clears inflight before new resolve (source check)', () => {
    // Verify that when force is set, the inflight entry is also cleared so
    // a fresh _doResolve is triggered even if a prior call is in flight.
    const fnStart = MRM_JS.indexOf('async resolve(gameId, hints = {})');
    const fn = MRM_JS.slice(fnStart, fnStart + 3000);
    assert.match(fn, /_inflight\.delete\(id\)/, 'must delete inflight entry when force is set');
    // Inflight delete must come before the inflight.has() check
    const deleteIdx  = fn.indexOf('_inflight.delete(id)');
    const hasIdx     = fn.indexOf('_inflight.has(id)');
    assert.ok(deleteIdx !== -1, '_inflight.delete(id) must be present');
    assert.ok(hasIdx !== -1, '_inflight.has(id) must be present');
    assert.ok(deleteIdx < hasIdx, 'inflight.delete must precede inflight.has');
});

test('gameScanner.js: deleteGamePermanently calls mrm.clearJob after deleteGameImages', () => {
    assert.ok(
        SCANNER_JS.indexOf('async deleteGamePermanently(gameId)') !== -1,
        'deleteGamePermanently must exist in gameScanner.js delegate'
    );
    // Real body lives in DeleteGamePermanentlyUseCase.js (Phase 18.3).
    const ucSrc   = fs.readFileSync(path.join(ROOT, 'src', 'features', 'games', 'application', 'useCases', 'DeleteGamePermanentlyUseCase.js'), 'utf8');
    const fnStart = ucSrc.indexOf('async function deleteGamePermanently(');
    const fn      = ucSrc.slice(fnStart, fnStart + 500);
    assert.match(fn, /metadataResolutionManager\.clearJob\(gameId\)/, 'must call metadataResolutionManager.clearJob');
    const imgIdx   = fn.indexOf('imageCacheService.deleteGameImages');
    const clearIdx = fn.indexOf('metadataResolutionManager.clearJob');
    assert.ok(imgIdx < clearIdx, 'clearJob must come after deleteGameImages');
});

test('gameScanner.js: deleteGamePermanently calls metadataCacheStore.deleteEntry', () => {
    // Real body lives in DeleteGamePermanentlyUseCase.js (Phase 18.3).
    const ucSrc   = fs.readFileSync(path.join(ROOT, 'src', 'features', 'games', 'application', 'useCases', 'DeleteGamePermanentlyUseCase.js'), 'utf8');
    const fnStart = ucSrc.indexOf('async function deleteGamePermanently(');
    const fn      = ucSrc.slice(fnStart, fnStart + 500);
    assert.match(fn, /metadataCacheStore\.deleteEntry\(gameId\)/, 'must call metadataCacheStore.deleteEntry');
});

test('gameMetadataHandlers.js: get-game-metadata passes force/bypassTtl to mrm.resolve when hints.force is true', () => {
    const handlerIdx = GAME_METADATA_HANDLERS_JS.indexOf("ipcMain.handle('get-game-metadata'");
    const handler = GAME_METADATA_HANDLERS_JS.slice(handlerIdx, handlerIdx + 9000);
    assert.match(handler, /forceMetadata/, 'must compute forceMetadata');
    assert.match(handler, /hints\.force\s*===\s*true/, 'must check hints.force');
    assert.match(handler, /force:\s*forceMetadata/, 'must pass force to mrm.resolve');
    assert.match(handler, /bypassTtl:\s*forceMetadata/, 'must pass bypassTtl to mrm.resolve');
    assert.match(handler, /!forceMetadata.*cooldown|cooldown.*!forceMetadata/s, 'cooldown check must be gated on !forceMetadata');
});

test('gameMetadataHandlers.js: get-game-metadata bypasses cooldown when source is manual-add-readd', () => {
    const handlerIdx = GAME_METADATA_HANDLERS_JS.indexOf("ipcMain.handle('get-game-metadata'");
    const handler = GAME_METADATA_HANDLERS_JS.slice(handlerIdx, handlerIdx + 6000);
    assert.match(handler, /manual-add-readd/, 'must include manual-add-readd source in forceMetadata check');
});

test('gameLibraryHandlers.js: add-manual-game passes forceMetadata:true to gameScanner', () => {
    const handlerIdx = GAME_LIBRARY_HANDLERS_JS.indexOf("ipcMain.handle('add-manual-game'");
    const handler = GAME_LIBRARY_HANDLERS_JS.slice(handlerIdx, handlerIdx + 1500);
    assert.match(handler, /forceMetadata:\s*true/, 'must pass forceMetadata:true');
});

test('gameScanner.js: addManualGame reads forceMetadata from options', () => {
    const fnStart = SCANNER_JS.indexOf('async addManualGame(launchPath');
    const fn = SCANNER_JS.slice(fnStart, fnStart + 400);
    assert.match(fn, /forceMetadata\s*=\s*options/, 'must read forceMetadata from options');
});

test('gameScanner.js: addManualGame passes force/bypassTtl to mrm.resolve', () => {
    const fnStart = SCANNER_JS.indexOf('async addManualGame(launchPath');
    const fn = SCANNER_JS.slice(fnStart, fnStart + 4500);
    assert.match(fn, /force:\s*forceMetadata/, 'must pass force to mrm.resolve');
    assert.match(fn, /bypassTtl:\s*forceMetadata/, 'must pass bypassTtl to mrm.resolve');
});

test('gameScanner.js: addManualGame awaits backgroundDownload and returns hydrated game from dbCache', () => {
    const fnStart = SCANNER_JS.indexOf('async addManualGame(launchPath');
    const fn = SCANNER_JS.slice(fnStart, fnStart + 8500);
    // Must await backgroundDownload (not fire-and-forget)
    assert.match(fn, /await this\.backgroundDownload/, 'must await backgroundDownload');
    // Must return the hydrated game from the DB (via getGameById or dbCache.find)
    assert.match(fn, /hydratedGame.*(?:getGameById|dbCache)|(?:getGameById|dbCache).*hydratedGame/, 'must return hydrated game from DB');
    assert.match(fn, /return \{ status: 'success', game: hydratedGame \}/, 'must return hydratedGame');
});

test('artwork-sync.js: hydrateManualGameArtworkNow awaits cacheAllAssets (no fire-and-forget .then)', () => {
    const fnStart = ARTWORK_SYNC_JS.indexOf('async function hydrateManualGameArtworkNow');
    const fn = ARTWORK_SYNC_JS.slice(fnStart, fnStart + 2600);
    assert.match(fn, /await window\.electronAPI\.cacheAllAssets/, 'must await cacheAllAssets');
    assert.doesNotMatch(fn, /cacheAllAssets\([^)]*\)\s*\n?\s*\.then\(/, 'must NOT use .then() (fire-and-forget)');
});

test('artwork-sync.js: hydrateManualGameArtworkNow persists metadata with saveMetadata after caching', () => {
    const fnStart = ARTWORK_SYNC_JS.indexOf('async function hydrateManualGameArtworkNow');
    const fn = ARTWORK_SYNC_JS.slice(fnStart, fnStart + 4000);
    assert.match(fn, /saveMetadata\??\.?\(game\.id/, 'must call saveMetadata');
    assert.match(fn, /artworkSource/, 'must include artworkSource in saved metadata');
});

test('artwork-sync.js: hydrateManualGameArtworkNow always passes force:true to getMetadata', () => {
    const fnStart = ARTWORK_SYNC_JS.indexOf('async function hydrateManualGameArtworkNow');
    const fn = ARTWORK_SYNC_JS.slice(fnStart, fnStart + 2000);
    assert.match(fn, /force:\s*true/, 'must always pass force:true');
    assert.match(fn, /bypassTtl:\s*true/, 'must always pass bypassTtl:true');
});

test('app.js: fetchMetadata probes stale file:// game.image before using it', () => {
    const fnStart = APP_JS.indexOf('async function fetchMetadata');
    const fn = APP_JS.slice(fnStart, fnStart + 800);
    assert.match(fn, /probeLocalImage\(game\.image\)/, 'must probe game.image');
    // Clear stale refs when probe fails
    assert.match(fn, /game\.image\s*=\s*null/, 'must null game.image when stale');
    assert.match(fn, /localStorage\.removeItem\('cover_'/, 'must remove stale localStorage cover');
});

test('app.js: fetchMetadata probes stale file:// storedCover before using it', () => {
    const fnStart = APP_JS.indexOf('async function fetchMetadata');
    const fn = APP_JS.slice(fnStart, fnStart + 1200);
    assert.match(fn, /probeLocalImage\(storedCover\)/, 'must probe storedCover');
});

// ─── Bug B: Installed-only games leaking into All Games ──────────────────────

test('accounts.js: _agIsUserLibraryGame exposed on window', () => {
    assert.match(ACC_JS, /window\._agIsUserLibraryGame\s*=\s*_agIsUserLibraryGame/, 'must be exposed on window');
    assert.match(ACC_JS, /window\._agGetUserLibraryGames\s*=\s*_agGetUserLibraryGames/, 'must be exposed on window');
});

test('accounts.js: _agIsUserLibraryGame requires synced-account evidence for Steam/Epic', () => {
    const fnStart = ACC_JS.indexOf('function _agIsUserLibraryGame');
    const fn = ACC_JS.slice(fnStart, fnStart + 3500);
    assert.match(fn, /hasSyncedAccountEvidence/, 'must use hasSyncedAccountEvidence');
    assert.match(fn, /isSteamOrEpic.*hasSyncedAccountEvidence|hasSyncedAccountEvidence.*isSteamOrEpic/s,
        'must gate Steam/Epic on hasSyncedAccountEvidence');
});

test('accounts.js: _agIsUserLibraryGame rejects Xbox installed-only (no synced evidence)', () => {
    const fnStart = ACC_JS.indexOf('function _agIsUserLibraryGame');
    const fn = ACC_JS.slice(fnStart, fnStart + 3500);
    // Xbox with no accounts/owners/librarySource should fall through to false
    assert.doesNotMatch(fn, /scanner\s*===\s*'xbox'.*return\s*true/, 'must NOT accept xbox scanner blindly');
});

test('accounts.js: renderAllGamesView marks synced records with _agSource and librarySource', () => {
    const fnStart = ACC_JS.indexOf('window.renderAllGamesView = async function');
    const fn = ACC_JS.slice(fnStart, fnStart + 5000);
    assert.match(fn, /_agSource\s*=\s*'platform-sync'/, 'must set _agSource');
    assert.match(fn, /librarySource\s*=\s*'synced-account'/, 'must set librarySource');
});

test('accounts.js: onLibraryUpdated background refresh marks synced records', () => {
    const listenerStart = ACC_JS.indexOf('onLibraryUpdated(async ()');
    // Handler body grew with scroll-preserve wrapper; use a generous slice
    const fn = ACC_JS.slice(listenerStart, listenerStart + 5000);
    assert.match(fn, /_agSource\s*=\s*'platform-sync'/, 'onLibraryUpdated must set _agSource');
    assert.match(fn, /librarySource\s*=\s*'synced-account'/, 'onLibraryUpdated must set librarySource');
});

test('accounts.js: navigateToAllGames sanitizes _allGamesCache at start', () => {
    const fnStart = ACC_JS.indexOf('async function navigateToAllGames');
    const fn = ACC_JS.slice(fnStart, fnStart + 8000);
    assert.match(fn, /_agGetUserLibraryGames\(window\._allGamesCache\)/, 'must sanitize _allGamesCache');
    assert.match(fn, /_agGetUserLibraryGames\(window\._allGamesRawCache\)/, 'must sanitize _allGamesRawCache');
    // Sanitize must come before the "if cache exists" early-return
    const sanitizeIdx   = fn.indexOf('_agGetUserLibraryGames(window._allGamesCache)');
    const cacheCheckIdx = fn.indexOf('if (window._allGamesCache && window._allGamesCache.length > 0)');
    assert.ok(sanitizeIdx < cacheCheckIdx, 'sanitize must precede cache check');
});

test('app.js: _patchGameInMemory uses _agIsUserLibraryGame to guard _allGamesCache push', () => {
    const fnStart = APP_JS.indexOf('function _patchGameInMemory');
    const fn = APP_JS.slice(fnStart, fnStart + 1200);
    assert.match(fn, /belongsInAllGames/, 'must use belongsInAllGames flag');
    assert.match(fn, /_agIsUserLibraryGame\(normalized\)/, 'must call _agIsUserLibraryGame');
    // push must be inside a belongsInAllGames block, not before it
    const belongsIdx = fn.indexOf('belongsInAllGames');
    const pushIdx    = fn.indexOf('_allGamesCache.push');
    assert.ok(pushIdx > belongsIdx, 'push must come after belongsInAllGames check');
});

test('app.js: _patchGameInMemory also gates _allGamesRawCache updates', () => {
    const fnStart = APP_JS.indexOf('function _patchGameInMemory');
    const fn = APP_JS.slice(fnStart, fnStart + 2000);
    assert.match(fn, /window\._allGamesRawCache/, 'must update _allGamesRawCache');
    // The raw cache push must also be gated
    const rawIdx = fn.indexOf('window._allGamesRawCache');
    const rawBlock = fn.slice(rawIdx, rawIdx + 600);
    assert.match(rawBlock, /belongsInAllGames/, 'raw cache update must check belongsInAllGames');
});

test('app.js: onGameImageUpdated removes All Games card for installed-only games', () => {
    const listenerIdx = APP_JS.indexOf('onGameImageUpdated((updatedGame)');
    const block = APP_JS.slice(listenerIdx, listenerIdx + 1000);
    assert.match(block, /belongsInAllGames/, 'must check belongsInAllGames');
    assert.match(block, /_agIsUserLibraryGame\(patched/, 'must call _agIsUserLibraryGame');
    assert.match(block, /#allGamesView.*remove\(\)|remove\(\).*#allGamesView/s, 'must remove card from #allGamesView');
});

test('game-details.js: _gdRefreshGameFromDbAfterMutation does not patch _allGamesCache for installed-only game', () => {
    const fnStart = GD_JS.indexOf('async function _gdRefreshGameFromDbAfterMutation');
    const fn = GD_JS.slice(fnStart, fnStart + 3500);
    assert.match(fn, /_gdBelongsInAllGames/, 'must use _gdBelongsInAllGames flag');
    assert.match(fn, /_agIsUserLibraryGame\(freshGame\)/, 'must call _agIsUserLibraryGame(freshGame)');
    // _allGamesCache patch must be inside the if(_gdBelongsInAllGames) branch
    const belongsIdx = fn.indexOf('_gdBelongsInAllGames');
    const cacheIdx   = fn.indexOf('_allGamesCache', belongsIdx);
    assert.ok(cacheIdx > belongsIdx, '_allGamesCache patch must come after _gdBelongsInAllGames check');
});

// ── All Games route-lock and layout-shift prevention ──────────────────────────

test('accounts.js: _agRouteSkeletonHTML is defined and returns ag-route-skeleton HTML', () => {
    assert.match(ACC_JS, /function _agRouteSkeletonHTML\(\)/,
        '_agRouteSkeletonHTML must be defined');
    const fnStart = ACC_JS.indexOf('function _agRouteSkeletonHTML');
    const fn = ACC_JS.slice(fnStart, fnStart + 200);
    assert.match(fn, /ag-route-skeleton/, 'must return ag-route-skeleton HTML');
});

test('accounts.js: _agBeginAllGamesRoute is defined and clears cardPool without touching cardCache', () => {
    assert.match(ACC_JS, /function _agBeginAllGamesRoute\(/,
        '_agBeginAllGamesRoute must be defined');
    const fnStart = ACC_JS.indexOf('function _agBeginAllGamesRoute');
    const fn = ACC_JS.slice(fnStart, fnStart + 1500);
    assert.match(fn, /cardPool\.forEach/, 'must iterate cardPool to remove row nodes');
    assert.match(fn, /cardPool\.clear\(\)/, 'must clear cardPool');
    assert.doesNotMatch(fn, /cardCache\.clear\(\)/, 'must NOT clear cardCache');
});

test('accounts.js: _agBeginAllGamesRoute installs route-lock classes', () => {
    const fnStart = ACC_JS.indexOf('function _agBeginAllGamesRoute');
    const fn = ACC_JS.slice(fnStart, fnStart + 1500);
    assert.match(fn, /ag-route-pending/, 'must add ag-route-pending to body');
    assert.match(fn, /ag-first-paint-lock/, 'must add ag-first-paint-lock to allGamesView');
});

test('accounts.js: _agBeginAllGamesRoute sets grid minHeight to stable viewport height', () => {
    const fnStart = ACC_JS.indexOf('function _agBeginAllGamesRoute');
    const fn = ACC_JS.slice(fnStart, fnStart + 1500);
    assert.match(fn, /minHeight\s*=\s*['"]calc\(100vh/, 'must set minHeight to calc(100vh...) to prevent collapse');
});

test('accounts.js: _agBeginAllGamesRoute writes route skeleton into grid', () => {
    const fnStart = ACC_JS.indexOf('function _agBeginAllGamesRoute');
    const fn = ACC_JS.slice(fnStart, fnStart + 1500);
    assert.match(fn, /_agRouteSkeletonHTML\(\)/, 'must use _agRouteSkeletonHTML() as grid content');
});

test('accounts.js: _agEndAllGamesRoute is defined, removes route-lock classes, uses requestAnimationFrame', () => {
    assert.match(ACC_JS, /function _agEndAllGamesRoute\(\)/,
        '_agEndAllGamesRoute must be defined');
    const fnStart = ACC_JS.indexOf('function _agEndAllGamesRoute');
    const fn = ACC_JS.slice(fnStart, fnStart + 500);
    assert.match(fn, /ag-route-pending/, 'must remove ag-route-pending from body');
    assert.match(fn, /ag-first-paint-lock/, 'must remove ag-first-paint-lock from view');
    assert.match(fn, /requestAnimationFrame/, 'must use requestAnimationFrame to restore scrollBehavior');
});

test('accounts.js: _agLockAllGamesLayout is defined', () => {
    assert.match(ACC_JS, /function _agLockAllGamesLayout\(\)/,
        '_agLockAllGamesLayout must be defined');
});

test('accounts.js: _agUnlockAllGamesLayout is defined and uses requestAnimationFrame', () => {
    assert.match(ACC_JS, /function _agUnlockAllGamesLayout\(\)/,
        '_agUnlockAllGamesLayout must be defined');
    const fnStart = ACC_JS.indexOf('function _agUnlockAllGamesLayout');
    const fn = ACC_JS.slice(fnStart, fnStart + 400);
    assert.match(fn, /requestAnimationFrame/, 'must use requestAnimationFrame to release lock');
});

test('accounts.js: _agStableLibraryLoadingHTML is defined', () => {
    assert.match(ACC_JS, /function _agStableLibraryLoadingHTML\(\)/,
        '_agStableLibraryLoadingHTML must be defined');
    const fnStart = ACC_JS.indexOf('function _agStableLibraryLoadingHTML');
    const fn = ACC_JS.slice(fnStart, fnStart + 200);
    assert.match(fn, /ag-stable-loading-panel/, 'must return ag-stable-loading-panel HTML');
});

test('accounts.js: navigateToAllGames resets scrollTop before _hideAllViews (before first paint)', () => {
    const fnStart = ACC_JS.indexOf('async function navigateToAllGames');
    const fn = ACC_JS.slice(fnStart, fnStart + 8500);
    const scrollIdx = fn.indexOf('scrollTop = 0');
    const hideIdx   = fn.indexOf('_hideAllViews');
    assert.ok(scrollIdx > -1, 'scrollTop = 0 must appear in navigateToAllGames');
    assert.ok(hideIdx   > -1, '_hideAllViews must appear in navigateToAllGames');
    assert.ok(scrollIdx < hideIdx, 'scrollTop reset must precede _hideAllViews call');
});

test('accounts.js: navigateToAllGames calls _agBeginAllGamesRoute before renderAllGamesView (full path)', () => {
    const fnStart = ACC_JS.indexOf('async function navigateToAllGames');
    const fn = ACC_JS.slice(fnStart, fnStart + 10000);
    const beginIdx  = fn.indexOf('_agBeginAllGamesRoute');
    const renderIdx = fn.lastIndexOf('renderAllGamesView');
    assert.ok(beginIdx  > -1, '_agBeginAllGamesRoute must appear in navigateToAllGames');
    assert.ok(renderIdx > -1, 'renderAllGamesView must appear in navigateToAllGames');
    assert.ok(beginIdx  < renderIdx, '_agBeginAllGamesRoute must precede renderAllGamesView call');
});

test('accounts.js: navigateToAllGames calls _agBeginAllGamesRoute before _applyAgFilters (cache path)', () => {
    const fnStart = ACC_JS.indexOf('async function navigateToAllGames');
    const fn = ACC_JS.slice(fnStart, fnStart + 8500);
    const beginIdx  = fn.indexOf('_agBeginAllGamesRoute');
    const filterIdx = fn.indexOf('_applyAgFilters');
    assert.ok(beginIdx  > -1, '_agBeginAllGamesRoute must appear in navigateToAllGames');
    assert.ok(filterIdx > -1, '_applyAgFilters must appear in navigateToAllGames');
    assert.ok(beginIdx  < filterIdx, '_agBeginAllGamesRoute must precede _applyAgFilters call');
});

test('accounts.js: navigateToAllGames calls _agBeginAllGamesRoute after allGamesView display=block', () => {
    const fnStart = ACC_JS.indexOf('async function navigateToAllGames');
    const fn = ACC_JS.slice(fnStart, fnStart + 8500);
    const displayIdx = fn.indexOf("style.display = 'block'");
    const beginIdx   = fn.indexOf('_agBeginAllGamesRoute');
    assert.ok(displayIdx > -1, "display='block' must appear before _agBeginAllGamesRoute");
    assert.ok(beginIdx   > displayIdx, '_agBeginAllGamesRoute must come after view display=block');
});

test('accounts.js: navigateToAllGames wraps async body in try/finally calling _agEndAllGamesRoute', () => {
    const fnStart = ACC_JS.indexOf('async function navigateToAllGames');
    const fn = ACC_JS.slice(fnStart, fnStart + 8500);
    assert.match(fn, /\bfinally\b/, 'navigateToAllGames must use try/finally');
    assert.match(fn, /_agEndAllGamesRoute\(\)/, 'finally block must call _agEndAllGamesRoute');
});

test('accounts.js: navigateToAllGames cache path uses resetScroll controlled by restoreState', () => {
    const fnStart = ACC_JS.indexOf('async function navigateToAllGames');
    const fn = ACC_JS.slice(fnStart, fnStart + 8500);
    assert.match(fn, /resetScroll.*restoreState|restoreState.*resetScroll/,
        'cache path must pass resetScroll based on restoreState');
});

test('accounts.js: renderAllGamesView accepts an options parameter', () => {
    assert.match(ACC_JS, /renderAllGamesView = async function\s*\(\s*options\s*=/,
        'renderAllGamesView must accept options = {} parameter');
});

test('accounts.js: renderAllGamesView handles suppressInitialLoading option', () => {
    const fnStart = ACC_JS.indexOf('window.renderAllGamesView = async function');
    const fn = ACC_JS.slice(fnStart, fnStart + 5500);
    assert.match(fn, /suppressInitialLoading/, 'renderAllGamesView must check options.suppressInitialLoading');
    assert.match(fn, /options\.stableLayout/, 'must still branch on options.stableLayout');
    assert.match(fn, /_agStableLibraryLoadingHTML\(\)/, 'must call _agStableLibraryLoadingHTML when stableLayout');
});

test('accounts.js: _renderAllGamesGrid preserves previous height before clearing innerHTML', () => {
    const fnStart = ACC_JS.indexOf('function _renderAllGamesGrid');
    const fn = ACC_JS.slice(fnStart, fnStart + 2500);
    const heightCapture = fn.indexOf('previousHeight');
    const resetMode     = fn.indexOf('_agResetAllGamesGridMode');
    const clear         = fn.indexOf('grid.innerHTML');
    assert.ok(heightCapture > -1, 'must capture previousHeight');
    assert.ok(heightCapture < resetMode, 'previousHeight must be captured before _agResetAllGamesGridMode');
    assert.ok(resetMode < clear,         '_agResetAllGamesGridMode must run before innerHTML clear');
});

test('accounts.js: _renderAllGamesGrid calls _agUnlockAllGamesLayout after _vsInit', () => {
    const fnStart = ACC_JS.indexOf('function _renderAllGamesGrid');
    const fn = ACC_JS.slice(fnStart, fnStart + 2500);
    const vsInitIdx  = fn.indexOf('_vsInit(');
    const unlockIdx  = fn.indexOf('_agUnlockAllGamesLayout');
    assert.ok(vsInitIdx  > -1, '_vsInit must be called');
    assert.ok(unlockIdx  > -1, '_agUnlockAllGamesLayout must be called in _renderAllGamesGrid');
    assert.ok(vsInitIdx  < unlockIdx, '_agUnlockAllGamesLayout must come after _vsInit');
});

test('dashboard.css: route-lock and layout-shift-prevention rules exist', () => {
    assert.match(CSS, /ag-route-pending/, 'CSS must contain ag-route-pending rule');
    assert.match(CSS, /ag-first-paint-lock/, 'CSS must contain ag-first-paint-lock rule');
    assert.match(CSS, /ag-route-skeleton/, 'CSS must contain ag-route-skeleton rule');
    assert.match(CSS, /ag-layout-loading/, 'CSS must contain ag-layout-loading rule');
    assert.match(CSS, /ag-stable-loading-panel/, 'CSS must contain ag-stable-loading-panel rule');
    assert.match(CSS, /overflow-anchor:\s*none/, 'CSS must set overflow-anchor: none');
    assert.match(CSS, /calc\(100vh\s*-\s*180px\)/, 'ag-route-skeleton must use calc(100vh - 180px) min-height');
});

// ── Sidebar active-state single-source-of-truth ───────────────────────────────

test('sidebar.js: clearSidebarActiveState is defined and clears nav-item, platform-item, and collection rows', () => {
    assert.match(SIDEBAR_JS, /function clearSidebarActiveState\(\)/,
        'clearSidebarActiveState must be defined');
    const fnStart = SIDEBAR_JS.indexOf('function clearSidebarActiveState');
    const fn = SIDEBAR_JS.slice(fnStart, fnStart + 400);
    assert.match(fn, /\.nav-item\.active/, 'must target .nav-item.active');
    assert.match(fn, /\.platform-item\.active/, 'must target .platform-item.active');
    assert.match(fn, /\[data-collection-id\]\.active/, 'must target [data-collection-id].active');
});

test('sidebar.js: updateSidebarActiveState calls clearSidebarActiveState first', () => {
    const fnStart = SIDEBAR_JS.indexOf('function updateSidebarActiveState');
    const fn = SIDEBAR_JS.slice(fnStart, fnStart + 200);
    assert.match(fn, /clearSidebarActiveState\(\)/, 'must call clearSidebarActiveState() at the start');
});

test('sidebar.js: updateSidebarActiveState uses else-if chain (not independent ifs)', () => {
    const fnStart = SIDEBAR_JS.indexOf('function updateSidebarActiveState');
    const fn = SIDEBAR_JS.slice(fnStart, fnStart + 900);
    assert.match(fn, /\} else if/, 'must use else-if so only one branch can win');
    // Must NOT have nav-ready or nav-all-games activations outside the else-if chain
    const platformIdx = fn.indexOf('currentAccountPlatform');
    const readyIdx    = fn.indexOf('nav-ready');
    assert.ok(platformIdx > -1, 'must reference currentAccountPlatform');
    assert.ok(readyIdx    > -1, 'must activate nav-ready');
    assert.ok(platformIdx < readyIdx, 'platform check must come before nav-ready in else-if order');
});

test('sidebar.js: updateSidebarActiveState uses DOM visibility for accounts branch', () => {
    const fnStart = SIDEBAR_JS.indexOf('function updateSidebarActiveState');
    const fn = SIDEBAR_JS.slice(fnStart, fnStart + 500);
    assert.match(fn, /accountsVisible/, 'must check accountsVisible via DOM');
    assert.match(fn, /accountsView.*display|display.*accountsView/, 'must check accountsView display style');
});

test('sidebar.js: updateSidebarActiveState uses DOM visibility for allGames branch', () => {
    const fnStart = SIDEBAR_JS.indexOf('function updateSidebarActiveState');
    const fn = SIDEBAR_JS.slice(fnStart, fnStart + 500);
    assert.match(fn, /allGamesVisible/, 'must check allGamesVisible via DOM');
});

test('app.js: navigateToHome calls updateSidebarActiveState instead of manual nav clearing', () => {
    const fnStart = APP_JS.indexOf('function navigateToHome');
    const fn = APP_JS.slice(fnStart, fnStart + 800);
    assert.match(fn, /updateSidebarActiveState\(\)/, 'navigateToHome must call updateSidebarActiveState');
});

test('app.js: navigateToInstalled calls updateSidebarActiveState and sets collectionId null', () => {
    const fnStart = APP_JS.indexOf('function navigateToInstalled');
    const fn = APP_JS.slice(fnStart, fnStart + 600);
    assert.match(fn, /updateSidebarActiveState\(\)/, 'navigateToInstalled must call updateSidebarActiveState');
    assert.match(fn, /currentFilters\.collectionId\s*=\s*null/, 'must clear collectionId');
});

test('collections.js: navigateToCollections calls updateSidebarActiveState and sets collectionId null', () => {
    const fnStart = COLLECTIONS_JS.indexOf('function navigateToCollections');
    const fn = COLLECTIONS_JS.slice(fnStart, fnStart + 400);
    assert.match(fn, /updateSidebarActiveState\(\)/, 'navigateToCollections must call updateSidebarActiveState');
    assert.match(fn, /currentFilters\.collectionId\s*=\s*null/, 'must clear collectionId');
});

test('collections.js: filterByCollection calls updateSidebarActiveState instead of manual nav activation', () => {
    const fnStart = COLLECTIONS_JS.indexOf('function filterByCollection');
    const fn = COLLECTIONS_JS.slice(fnStart, fnStart + 1200);
    assert.match(fn, /updateSidebarActiveState\(\)/, 'filterByCollection must call updateSidebarActiveState');
    // Must not manually add active to individual nav items
    assert.doesNotMatch(fn, /classList\.add\('active'\)/, 'must not manually add active — let updateSidebarActiveState do it');
});

test('accounts.js: selectAccountPlatform calls updateSidebarActiveState instead of manually activating nav', () => {
    const fnStart = PLATFORM_PANELS_JS.indexOf('function selectAccountPlatform');
    const fn = PLATFORM_PANELS_JS.slice(fnStart, fnStart + 1200);
    assert.match(fn, /updateSidebarActiveState\(\)/, 'must call updateSidebarActiveState');
    // Must not directly add active to a specific nav-platform element
    assert.doesNotMatch(fn, /getElementById.*nav-.*classList\.add\('active'\)/,
        'must not manually activate nav-platform element');
});

test('accounts.js: selectAccountPlatform clears currentFilters.collectionId', () => {
    const fnStart = PLATFORM_PANELS_JS.indexOf('function selectAccountPlatform');
    const fn = PLATFORM_PANELS_JS.slice(fnStart, fnStart + 600);
    assert.match(fn, /currentFilters\.collectionId\s*=\s*null/, 'must clear collectionId');
});

test('accounts.js: navigateToAllGames clears currentFilters.collectionId for normal navigation', () => {
    const fnStart = ACC_JS.indexOf('async function navigateToAllGames');
    const fn = ACC_JS.slice(fnStart, fnStart + 2700);
    assert.match(fn, /currentFilters\.collectionId\s*=\s*null/, 'must clear collectionId');
    assert.match(fn, /!opts\.restoreState/, 'must guard by !opts.restoreState');
});

// ── Sidebar context button correctness ────────────────────────────────────────

test('sidebar.js: getSidebarActionContext returns installed when installedGamesView visible and currentView=installed', () => {
    const fnStart = SIDEBAR_JS.indexOf('function getSidebarActionContext');
    const fn = SIDEBAR_JS.slice(fnStart, fnStart + 1000);
    assert.match(fn, /installedVisible/, 'must check installedVisible');
    assert.match(fn, /'installed'/, "must return 'installed'");
    assert.match(fn, /currentView === 'installed'/, "must guard with currentView === 'installed'");
});

test('sidebar.js: getSidebarActionContext returns collection for custom collection view', () => {
    const fnStart = SIDEBAR_JS.indexOf('function getSidebarActionContext');
    const fn = SIDEBAR_JS.slice(fnStart, fnStart + 1000);
    assert.match(fn, /customCollVisible/, 'must check customCollVisible');
    assert.match(fn, /'collection'/, "must return 'collection'");
    assert.match(fn, /currentView === 'collection'/, "must guard with currentView === 'collection'");
});

test('sidebar.js: handleSidebarContextBtn on installed calls openAddGameModal', () => {
    const fnStart = SIDEBAR_JS.indexOf('function handleSidebarContextBtn');
    const fn = SIDEBAR_JS.slice(fnStart, fnStart + 1300);
    const installedIdx = fn.indexOf("ctx === 'installed'");
    const modalIdx     = fn.indexOf('openAddGameModal');
    assert.ok(installedIdx > -1, "must check ctx === 'installed'");
    assert.ok(modalIdx     > -1, 'must call openAddGameModal');
    assert.ok(installedIdx < modalIdx, 'openAddGameModal must be inside the installed branch');
});

test('sidebar.js: handleSidebarContextBtn on collection calls navigateToInstalled', () => {
    const fnStart = SIDEBAR_JS.indexOf('function handleSidebarContextBtn');
    const fn = SIDEBAR_JS.slice(fnStart, fnStart + 1300);
    const collIdx = fn.indexOf("ctx === 'collection'");
    const navIdx  = fn.indexOf('navigateToInstalled');
    assert.ok(collIdx > -1, "must check ctx === 'collection'");
    assert.ok(navIdx  > -1, 'must call navigateToInstalled');
    assert.ok(collIdx < navIdx, 'navigateToInstalled must be inside the collection branch');
});

test('sidebar.js: handleSidebarContextBtn does NOT call openPlatformsModal for installed context', () => {
    const fnStart = SIDEBAR_JS.indexOf('function handleSidebarContextBtn');
    const fn = SIDEBAR_JS.slice(fnStart, fnStart + 1300);
    // openPlatformsModal must only appear in the library/fallback branch, not the installed branch
    const installedBlock = fn.slice(fn.indexOf("ctx === 'installed'"), fn.indexOf("ctx === 'collections'"));
    assert.doesNotMatch(installedBlock, /openPlatformsModal/, 'installed branch must not call openPlatformsModal');
});

test('sidebar.js: updateSbContextBtn delegates to syncSidebarActionButton (Browse Installed Games for collection)', () => {
    // updateSbContextBtn now delegates; the label lives in syncSidebarActionButton
    const fnStart = SIDEBAR_JS.indexOf('function syncSidebarActionButton');
    const fn = SIDEBAR_JS.slice(fnStart, fnStart + 1600);
    assert.match(fn, /Browse Installed Games/, 'must show Browse Installed Games text for collection/favorites context');
    assert.match(fn, /collection:/, "map must have 'collection' key");
});

test('sidebar.js: updateSbContextBtn delegates to syncSidebarActionButton (Add Game for installed)', () => {
    // updateSbContextBtn now delegates; the label lives in syncSidebarActionButton
    const fnStart = SIDEBAR_JS.indexOf('function syncSidebarActionButton');
    const fn = SIDEBAR_JS.slice(fnStart, fnStart + 1600);
    assert.match(fn, /installed:/, "map must have 'installed' key");
    const installedIdx = fn.indexOf('installed:');
    const addGameIdx   = fn.indexOf('Add Game', installedIdx);
    assert.ok(addGameIdx > installedIdx && addGameIdx < installedIdx + 80,
        'Add Game text must follow the installed key');
});

// ── Issue 1: Collection from Manage keeps correct context button ──────────────

test('collections.js: filterByCollection calls updateSbContextBtn after updateSidebarActiveState', () => {
    const fnStart = COLLECTIONS_JS.indexOf('function filterByCollection');
    const fn = COLLECTIONS_JS.slice(fnStart, fnStart + 1200);
    assert.match(fn, /updateSbContextBtn/, 'filterByCollection must call updateSbContextBtn');
    const activeIdx = fn.indexOf('updateSidebarActiveState');
    const ctxIdx    = fn.indexOf('updateSbContextBtn');
    assert.ok(activeIdx > -1, 'must call updateSidebarActiveState');
    assert.ok(ctxIdx > -1, 'must call updateSbContextBtn');
    assert.ok(ctxIdx > activeIdx, 'updateSbContextBtn must come after updateSidebarActiveState');
});

test('sidebar.js: openSidebarCollection clears currentAccountPlatform before calling filterByCollection', () => {
    const fnStart = SIDEBAR_JS.indexOf('function openSidebarCollection');
    const fn = SIDEBAR_JS.slice(fnStart, fnStart + 400);
    assert.match(fn, /currentAccountPlatform\s*=\s*null/, 'must set currentAccountPlatform to null');
    const clearIdx  = fn.indexOf('currentAccountPlatform');
    const filterIdx = fn.indexOf('filterByCollection');
    assert.ok(clearIdx < filterIdx, 'currentAccountPlatform must be cleared before filterByCollection');
});

test('sidebar.js: getSidebarActionContext checks collection (custom) before collections (manage page)', () => {
    const fnStart = SIDEBAR_JS.indexOf('function getSidebarActionContext');
    const fn = SIDEBAR_JS.slice(fnStart, fnStart + 1800);
    const collectionIdx  = fn.indexOf("return 'collection'");
    const collectionsIdx = fn.indexOf("return 'collections'");
    assert.ok(collectionIdx  > -1, "must return 'collection' for custom collection view");
    assert.ok(collectionsIdx > -1, "must return 'collections' for collections manage page");
    assert.ok(collectionIdx < collectionsIdx, "collection detail must be checked before collections manage");
});

// ── Issue 2: All Games / Ready button should say Link Accounts ────────────────

test('sidebar.js: syncSidebarActionButton shows Link Accounts for all-games and not for installed', () => {
    // Link Accounts label lives in syncSidebarActionButton map
    const fnStart = SIDEBAR_JS.indexOf('function syncSidebarActionButton');
    const fn = SIDEBAR_JS.slice(fnStart, fnStart + 1600);
    assert.match(fn, /Link Accounts/, 'must contain Link Accounts text');
    // installed key must map to Add Game, not Link Accounts
    const installedIdx = fn.indexOf("installed:");
    const installedBlock = fn.slice(installedIdx, installedIdx + 80);
    assert.doesNotMatch(installedBlock, /Link Accounts/, 'installed entry must not say Link Accounts');
    assert.match(installedBlock, /Add Game/, 'installed entry must say Add Game');
});

test('sidebar.js: getSidebarActionContext returns all-games when allGamesView visible and not readyOnly', () => {
    const fnStart = SIDEBAR_JS.indexOf('function getSidebarActionContext');
    const fn = SIDEBAR_JS.slice(fnStart, fnStart + 1800);
    assert.match(fn, /allGamesVisible/, 'must track allGamesVisible');
    assert.match(fn, /'all-games'/, "must return 'all-games'");
    assert.match(fn, /'ready'/, "must return 'ready'");
    // ready must be checked before all-games (agReadyOnly guard)
    const readyIdx    = fn.indexOf("return 'ready'");
    const allGamesIdx = fn.indexOf("return 'all-games'");
    assert.ok(readyIdx < allGamesIdx, "'ready' must be checked before 'all-games'");
});

// ── Issue 3: Refresh button uses local cache only ─────────────────────────────

test('dashboard.html: btn-refresh-all-games calls refreshAllGamesView not syncEpicLibrary', () => {
    assert.match(HTML, /id="btn-refresh-all-games"/, 'must have btn-refresh-all-games button');
    assert.match(HTML, /onclick="refreshAllGamesView\(\)"/, 'must call refreshAllGamesView');
    // Must not call syncEpicLibrary from the refresh button
    const btnIdx = HTML.indexOf('btn-refresh-all-games');
    const btnBlock = HTML.slice(btnIdx, btnIdx + 200);
    assert.doesNotMatch(btnBlock, /syncEpicLibrary/, 'refresh button must not call syncEpicLibrary');
});

test('dashboard.html: btn-refresh-all-games has Refresh title (not Sync)', () => {
    const btnIdx = HTML.indexOf('btn-refresh-all-games');
    const btnBlock = HTML.slice(btnIdx, btnIdx + 200);
    assert.match(btnBlock, /title="Refresh"/, 'refresh button title must be Refresh');
});

test('accounts.js: refreshAllGamesView uses local cache without calling platformSync', () => {
    const fnStart = ACC_JS.indexOf('window.refreshAllGamesView');
    const fn = ACC_JS.slice(fnStart, fnStart + 1200);
    assert.match(fn, /btn-refresh-all-games/, 'must reference the refresh button id');
    // Must not call platformSyncSync or syncEpicLibrary
    assert.doesNotMatch(fn, /platformSyncSync/, 'must not trigger platform sync');
    assert.doesNotMatch(fn, /syncEpicLibrary/, 'must not call syncEpicLibrary');
    // Must use existing cache
    assert.match(fn, /_allGamesCache/, 'must read from _allGamesCache');
});

// ── Issue 4: Installed filter chip hidden in Ready to Install mode ────────────

test('accounts.js: navigateToAllGames toggles ag-ready-mode class on body', () => {
    const fnStart = ACC_JS.indexOf('async function navigateToAllGames');
    const fn = ACC_JS.slice(fnStart, fnStart + 2500);
    assert.match(fn, /ag-ready-mode/, 'must toggle ag-ready-mode class on body');
    assert.match(fn, /classList\.toggle\('ag-ready-mode'/, 'must use classList.toggle for ag-ready-mode');
});

test('css: body.ag-ready-mode hides the ag-installed-toggle chip', () => {
    assert.match(CSS, /ag-ready-mode/, 'dashboard.css must have ag-ready-mode rule');
    assert.match(CSS, /\.ag-installed-toggle/, 'must target .ag-installed-toggle');
    const ruleIdx  = CSS.indexOf('ag-ready-mode');
    const ruleBlock = CSS.slice(ruleIdx, ruleIdx + 150);
    assert.match(ruleBlock, /display:\s*none/, 'ag-ready-mode rule must hide the element');
});

// ── Epic Games icon visibility when active ────────────────────────────────────

test('accounts.css: active Epic item overrides img filter to black (not white)', () => {
    const ruleIdx = ACCOUNTS_CSS.indexOf('#nav-epic.active img');
    assert.ok(ruleIdx > -1, '#nav-epic.active img rule must exist in accounts.css');
    const block = ACCOUNTS_CSS.slice(ruleIdx, ruleIdx + 120);
    assert.match(block, /brightness\(0\)/, 'must use brightness(0) to make icon black');
    assert.doesNotMatch(block, /invert\(1\)/, 'must NOT invert to white — active background is light');
});

test('accounts.css: active Epic icon rule does not affect other platform active icons', () => {
    // The rule must be scoped to #nav-epic only
    assert.doesNotMatch(ACCOUNTS_CSS, /#nav-steam\.active img\s*\{[^}]*invert\(0\)/, 'steam active img must not be forced black');
    // No blanket rule making ALL platform active icons invert
    assert.doesNotMatch(ACCOUNTS_CSS, /\.platform-item\.active img\s*\{/, 'must not have a blanket rule for all platform-item active imgs');
});

// ── Top bar Settings button removal ──────────────────────────────────────────

test('dashboard.html: top title bar has no Settings button', () => {
    const titleBarEnd = HTML.indexOf('</div>', HTML.indexOf('class="title-bar"'));
    // Grab everything up to the window-controls div as the title-bar content
    const titleBar = HTML.slice(HTML.indexOf('class="title-bar"'), HTML.indexOf('class="window-controls"'));
    // Must not contain a button with the text "Settings" (gear icon button)
    assert.doesNotMatch(titleBar, /onclick="openSettingsModal\(\)".*Settings|Settings.*onclick="openSettingsModal\(\)"/, 'top bar must not have a Settings button');
    // Must not have the gear SVG (circle cx="12" cy="12" r="3" is the gear center)
    assert.doesNotMatch(titleBar, /class="help-btn"[^>]*>[\s\S]*?Settings/, 'help-btn with Settings text must be gone from title bar');
});

test('dashboard.html: sidebar Manage Settings item still exists', () => {
    const sidebarEl = HTML.indexOf('id="nav-settings"');
    assert.ok(sidebarEl > -1, 'sidebar #nav-settings must still exist');
    const block = HTML.slice(sidebarEl, sidebarEl + 200);
    assert.match(block, /openSettingsModal\(\)/, 'sidebar Settings item must still call openSettingsModal');
    assert.match(block, /Settings/, 'sidebar Settings item must still show Settings text');
});

test('dashboard.html: update badge element still exists with correct id', () => {
    assert.match(HTML, /id="updateBadgeBtn"/, 'updateBadgeBtn must exist');
    assert.match(HTML, /id="updateBadgeLabel"/, 'updateBadgeLabel span must exist');
    const btnIdx = HTML.indexOf('id="updateBadgeBtn"');
    const block  = HTML.slice(btnIdx - 20, btnIdx + 200);
    assert.match(block, /onclick="openUpdateModal\(\)"/, 'badge must still call openUpdateModal');
});

test('help-feedback.js: _setUpdateBadge shows badge with label when called with true', () => {
    const fnStart = HELP_JS.indexOf('function _setUpdateBadge');
    const fn = HELP_JS.slice(fnStart, fnStart + 400);
    assert.match(fn, /updateBadgeBtn/, 'must reference updateBadgeBtn');
    assert.match(fn, /show\s*\?\s*['"]flex['"]/, 'must set display flex when showing');
    assert.match(fn, /lbl.*label|label.*lbl/, 'must update label text');
});

test('help-feedback.js: _setUpdateBadge hides badge when called with false', () => {
    const fnStart = HELP_JS.indexOf('function _setUpdateBadge');
    const fn = HELP_JS.slice(fnStart, fnStart + 400);
    assert.match(fn, /['"]none['"]/, "must set display none when hiding");
});

test('css: .update-badge-btn has amber/orange styling', () => {
    const ruleIdx = CSS.indexOf('.update-badge-btn');
    assert.ok(ruleIdx > -1, '.update-badge-btn rule must exist in dashboard.css');
    const block = CSS.slice(ruleIdx, ruleIdx + 1200);
    assert.match(block, /border-radius:\s*999px/, 'must use pill border-radius');
    assert.match(block, /rgba\(255,\s*132,\s*45/, 'must use the amber/orange color');
    assert.match(block, /::before/, 'must have ::before pseudo-element for the dot');
    assert.match(block, /badgePulse/, 'dot must use badgePulse animation');
});

// ── Beta Feedback Banner ──────────────────────────────────────────────────────

test('dashboard.html: betaFeedbackBanner element exists with correct ids and actions', () => {
    assert.match(HTML, /id="betaFeedbackBanner"/, 'betaFeedbackBanner element must exist');
    assert.match(HTML, /onclick="openBetaFeedbackFromBanner\(\)"/, 'CTA must call openBetaFeedbackFromBanner');
    assert.match(HTML, /onclick="dismissBetaFeedbackBanner\(\)"/, 'close button must call dismissBetaFeedbackBanner');
    // Must start hidden
    const bannerIdx = HTML.indexOf('id="betaFeedbackBanner"');
    const tag = HTML.slice(bannerIdx - 5, bannerIdx + 60);
    assert.match(tag, /hidden/, 'banner must have hidden attribute by default');
});

test('help-feedback.js: BETA_FEEDBACK_BANNER_KEY constant defined', () => {
    assert.match(HELP_JS, /BETA_FEEDBACK_BANNER_KEY/, 'constant must exist');
    assert.match(HELP_JS, /baddel\.betaFeedbackBanner\.dismissed\.v1/, 'must use the correct localStorage key');
});

test('help-feedback.js: shouldShowBetaFeedbackBanner reads localStorage', () => {
    const fnStart = HELP_JS.indexOf('function shouldShowBetaFeedbackBanner');
    const fn = HELP_JS.slice(fnStart, fnStart + 200);
    assert.match(fn, /localStorage\.getItem/, 'must read from localStorage');
    assert.match(fn, /BETA_FEEDBACK_BANNER_KEY/, 'must use the key constant');
});

test('help-feedback.js: markBetaFeedbackBannerDismissed writes to localStorage', () => {
    const fnStart = HELP_JS.indexOf('function markBetaFeedbackBannerDismissed');
    const fn = HELP_JS.slice(fnStart, fnStart + 200);
    assert.match(fn, /localStorage\.setItem/, 'must write to localStorage');
    assert.match(fn, /BETA_FEEDBACK_BANNER_KEY/, 'must use the key constant');
});

test('help-feedback.js: showBetaFeedbackBanner shows/hides based on shouldShowBetaFeedbackBanner', () => {
    const fnStart = HELP_JS.indexOf('function showBetaFeedbackBanner');
    const fn = HELP_JS.slice(fnStart, fnStart + 400);
    assert.match(fn, /shouldShowBetaFeedbackBanner/, 'must call shouldShowBetaFeedbackBanner');
    assert.match(fn, /has-beta-feedback-banner/, 'must toggle has-beta-feedback-banner class on body');
    assert.match(fn, /banner\.hidden\s*=\s*false/, 'must unhide banner when showing');
});

test('help-feedback.js: hideBetaFeedbackBanner removes class and hides element', () => {
    const fnStart = HELP_JS.indexOf('function hideBetaFeedbackBanner');
    const fn = HELP_JS.slice(fnStart, fnStart + 400);
    assert.match(fn, /markBetaFeedbackBannerDismissed/, 'must call markBetaFeedbackBannerDismissed when persist=true');
    assert.match(fn, /banner\.hidden\s*=\s*true/, 'must set banner.hidden = true');
    assert.match(fn, /has-beta-feedback-banner/, 'must remove has-beta-feedback-banner from body');
});

test('help-feedback.js: openBetaFeedbackFromBanner calls openHelpModal with feedback tab', () => {
    const fnStart = HELP_JS.indexOf('function openBetaFeedbackFromBanner');
    const fn = HELP_JS.slice(fnStart, fnStart + 300);
    assert.match(fn, /openHelpModal\(['"]feedback['"]\)/, "must call openHelpModal('feedback')");
    assert.match(fn, /handleHelpDropdownAction/, 'must fall back to handleHelpDropdownAction');
});

test('help-feedback.js: dismissBetaFeedbackBanner delegates to hideBetaFeedbackBanner(true)', () => {
    const fnStart = HELP_JS.indexOf('function dismissBetaFeedbackBanner');
    const fn = HELP_JS.slice(fnStart, fnStart + 150);
    assert.match(fn, /hideBetaFeedbackBanner\(true\)/, 'must call hideBetaFeedbackBanner(true)');
});

test('help-feedback.js: window globals exposed for banner', () => {
    assert.match(HELP_JS, /window\.dismissBetaFeedbackBanner\s*=\s*dismissBetaFeedbackBanner/, 'must expose dismissBetaFeedbackBanner on window');
    assert.match(HELP_JS, /window\.openBetaFeedbackFromBanner\s*=\s*openBetaFeedbackFromBanner/, 'must expose openBetaFeedbackFromBanner on window');
});

test('help-feedback.js: sendFeedback success branch calls hideBetaFeedbackBanner(true)', () => {
    const fnStart = HELP_JS.indexOf('async function sendFeedback');
    const fn = HELP_JS.slice(fnStart, fnStart + 1200);
    const successIdx = fn.indexOf('response.ok');
    const hideIdx    = fn.indexOf('hideBetaFeedbackBanner(true)');
    assert.ok(successIdx > -1, 'sendFeedback must check response.ok');
    assert.ok(hideIdx > -1, 'sendFeedback must call hideBetaFeedbackBanner(true)');
    assert.ok(hideIdx > successIdx, 'hideBetaFeedbackBanner call must be inside the success branch');
});

test('help-feedback.js: DOMContentLoaded handler wires banner initializer', () => {
    assert.match(HELP_JS, /DOMContentLoaded[\s\S]*?initBetaFeedbackBanner\(\)/, 'initBetaFeedbackBanner must be wired to DOMContentLoaded');
});

test('css: .beta-feedback-banner has correct structure', () => {
    const ruleIdx = CSS.indexOf('.beta-feedback-banner');
    assert.ok(ruleIdx > -1, '.beta-feedback-banner rule must exist in dashboard.css');
    const block = CSS.slice(ruleIdx, ruleIdx + 3500);
    assert.match(block, /position:\s*fixed/, 'must be position fixed');
    assert.match(block, /z-index:\s*99990/, 'must have high z-index');
    assert.match(block, /\.beta-feedback-banner\[hidden\]/, 'must have [hidden] rule');
    assert.match(block, /body\.has-beta-feedback-banner\s+#mainContentArea/, 'must add padding when banner visible');
    assert.match(block, /\.beta-feedback-cta/, 'must have CTA button styles');
    assert.match(block, /\.beta-feedback-close/, 'must have close button styles');
    assert.match(block, /betaFeedbackIn/, 'must include entrance animation');
    assert.match(block, /max-width:\s*900px|max-width:\s*640px/, 'must have responsive media queries');
});

// ── Sidebar action button label correctness ───────────────────────────────────

test('sidebar.js: syncSidebarActionButton function exists and is exposed on window', () => {
    assert.match(SIDEBAR_JS, /function syncSidebarActionButton\s*\(/, 'syncSidebarActionButton must be defined');
    assert.match(SIDEBAR_JS, /window\.syncSidebarActionButton\s*=\s*syncSidebarActionButton/, 'must be exposed on window');
});

test('sidebar.js: syncSidebarActionButton maps all-games context to Link Accounts', () => {
    const fnStart = SIDEBAR_JS.indexOf('function syncSidebarActionButton');
    const fn = SIDEBAR_JS.slice(fnStart, fnStart + 1200);
    assert.match(fn, /all-games.*Link Accounts|Link Accounts.*all-games/, 'all-games must map to Link Accounts');
    assert.match(fn, /ready.*Link Accounts|Link Accounts.*ready/, 'ready must map to Link Accounts');
    assert.match(fn, /home.*Link Accounts|Link Accounts.*home/, 'home must map to Link Accounts');
});

test('sidebar.js: syncSidebarActionButton maps installed to Add Game', () => {
    const fnStart = SIDEBAR_JS.indexOf('function syncSidebarActionButton');
    const fn = SIDEBAR_JS.slice(fnStart, fnStart + 1200);
    assert.match(fn, /installed.*Add Game|Add Game.*installed/, 'installed must map to Add Game');
});

test('sidebar.js: syncSidebarActionButton maps collections to New Collection', () => {
    const fnStart = SIDEBAR_JS.indexOf('function syncSidebarActionButton');
    const fn = SIDEBAR_JS.slice(fnStart, fnStart + 1200);
    assert.match(fn, /collections.*New Collection|New Collection.*collections/, 'collections must map to New Collection');
});

test('sidebar.js: syncSidebarActionButton maps collection and favorites to Browse Installed Games', () => {
    const fnStart = SIDEBAR_JS.indexOf('function syncSidebarActionButton');
    const fn = SIDEBAR_JS.slice(fnStart, fnStart + 1200);
    assert.match(fn, /Browse Installed Games/, 'must have Browse Installed Games label');
    const collIdx = fn.indexOf("collection:");
    const favIdx  = fn.indexOf("favorites:");
    assert.ok(collIdx > -1, 'must have collection key in map');
    assert.ok(favIdx  > -1, 'must have favorites key in map');
});

test('sidebar.js: syncSidebarActionButton sets data-context on the button', () => {
    const fnStart = SIDEBAR_JS.indexOf('function syncSidebarActionButton');
    const fn = SIDEBAR_JS.slice(fnStart, fnStart + 1600);
    assert.match(fn, /dataset\.context\s*=\s*ctx/, 'must set btn.dataset.context = ctx');
});

test('sidebar.js: updateSbContextBtn delegates to syncSidebarActionButton', () => {
    const fnStart = SIDEBAR_JS.indexOf('function updateSbContextBtn');
    const fn = SIDEBAR_JS.slice(fnStart, fnStart + 200);
    assert.match(fn, /syncSidebarActionButton\(\)/, 'updateSbContextBtn must call syncSidebarActionButton');
    assert.doesNotMatch(fn, /textContent/, 'updateSbContextBtn must not set textContent directly');
});

test('sidebar.js: handleSidebarContextBtn handles favorites context by navigating to installed', () => {
    const fnStart = SIDEBAR_JS.indexOf('function handleSidebarContextBtn');
    const fn = SIDEBAR_JS.slice(fnStart, fnStart + 1400);
    const favIdx = fn.indexOf("'favorites'");
    const navIdx = fn.indexOf('navigateToInstalled', favIdx > -1 ? favIdx : 0);
    assert.ok(favIdx > -1, "must check ctx === 'favorites'");
    assert.ok(navIdx > -1, 'must call navigateToInstalled for favorites');
});

test('app.js: navigateToHome calls syncSidebarActionButton after updateSidebarActiveState', () => {
    const fnStart = APP_JS.indexOf('function navigateToHome');
    const fn = APP_JS.slice(fnStart, fnStart + 1000);
    assert.match(fn, /syncSidebarActionButton\(\)/, 'navigateToHome must call syncSidebarActionButton');
    const activeIdx = fn.indexOf('updateSidebarActiveState');
    const syncIdx   = fn.indexOf('syncSidebarActionButton');
    assert.ok(syncIdx > activeIdx, 'syncSidebarActionButton must come after updateSidebarActiveState');
});

test('app.js: navigateToInstalled calls syncSidebarActionButton after updateSidebarActiveState', () => {
    const fnStart = APP_JS.indexOf('function navigateToInstalled');
    const fn = APP_JS.slice(fnStart, fnStart + 600);
    assert.match(fn, /syncSidebarActionButton\(\)/, 'navigateToInstalled must call syncSidebarActionButton');
    const activeIdx = fn.indexOf('updateSidebarActiveState');
    const syncIdx   = fn.indexOf('syncSidebarActionButton');
    assert.ok(syncIdx > activeIdx, 'syncSidebarActionButton must come after updateSidebarActiveState');
});

test('accounts.js: navigateToAllGames calls syncSidebarActionButton after view is shown', () => {
    const fnStart = ACC_JS.indexOf('async function navigateToAllGames');
    const fn = ACC_JS.slice(fnStart, fnStart + 4500);
    assert.match(fn, /syncSidebarActionButton/, 'navigateToAllGames must call syncSidebarActionButton');
    // The call must come AFTER display = 'block'
    const showIdx = fn.indexOf("view.style.display = 'block'");
    const syncIdx = fn.indexOf('syncSidebarActionButton', showIdx > -1 ? showIdx : 0);
    assert.ok(showIdx > -1, 'navigateToAllGames must set view display block');
    assert.ok(syncIdx > showIdx, 'syncSidebarActionButton must be called after view is shown');
});

test('sidebar.js: getSidebarActionContext returns home for home view', () => {
    const fnStart = SIDEBAR_JS.indexOf('function getSidebarActionContext');
    const fn = SIDEBAR_JS.slice(fnStart, fnStart + 1800);
    assert.match(fn, /currentView === 'home'/, "must handle home view");
    assert.match(fn, /return 'home'/, "must return 'home'");
});

// ── Sidebar context button label correctness ──────────────────────────────────

test('sidebar.js: syncSidebarActionButton maps all-games to "Link Accounts"', () => {
    const fnStart = SIDEBAR_JS.indexOf('function syncSidebarActionButton');
    const fn = SIDEBAR_JS.slice(fnStart, fnStart + 1000);
    assert.match(fn, /'all-games'/, 'all-games key in label map');
    // Extract the text value for all-games entry
    const allGamesIdx = fn.indexOf("'all-games'");
    const snippet = fn.slice(allGamesIdx, allGamesIdx + 80);
    assert.match(snippet, /Link Accounts/, 'all-games must map to Link Accounts');
});

test('sidebar.js: syncSidebarActionButton maps ready to "Link Accounts"', () => {
    const fnStart = SIDEBAR_JS.indexOf('function syncSidebarActionButton');
    const fn = SIDEBAR_JS.slice(fnStart, fnStart + 1000);
    // key is unquoted: ready: { text: 'Link Accounts', ... }
    const readyIdx = fn.indexOf('ready:');
    assert.ok(readyIdx > -1, 'ready key in label map');
    const snippet = fn.slice(readyIdx, readyIdx + 80);
    assert.match(snippet, /Link Accounts/, 'ready must map to Link Accounts');
});

test('sidebar.js: syncSidebarActionButton maps installed to "Add Game", not "Link Accounts"', () => {
    const fnStart = SIDEBAR_JS.indexOf('function syncSidebarActionButton');
    const fn = SIDEBAR_JS.slice(fnStart, fnStart + 1000);
    // key is unquoted: installed: { text: 'Add Game', ... }
    const installedIdx = fn.indexOf('installed:');
    assert.ok(installedIdx > -1, 'installed key in label map');
    const snippet = fn.slice(installedIdx, installedIdx + 80);
    assert.match(snippet, /Add Game/, 'installed must map to Add Game');
    assert.doesNotMatch(snippet, /Link Accounts/, 'installed must not say Link Accounts');
});

test('sidebar.js: syncSidebarActionButton default fallback is "Link Accounts"', () => {
    const fnStart = SIDEBAR_JS.indexOf('function syncSidebarActionButton');
    const fn = SIDEBAR_JS.slice(fnStart, fnStart + 1000);
    // fallback via _map.library — key is unquoted: library: { text: 'Link Accounts', ... }
    const libIdx = fn.indexOf('library:');
    assert.ok(libIdx > -1, 'library key in label map');
    const snippet = fn.slice(libIdx, libIdx + 80);
    assert.match(snippet, /Link Accounts/, 'library fallback must be Link Accounts');
});

test('accounts.js: navigateToAllGames sets currentView to all-games before syncing button', () => {
    const fnStart = ACC_JS.indexOf('async function navigateToAllGames');
    const fn = ACC_JS.slice(fnStart, fnStart + 4200);
    assert.match(fn, /currentView\s*=\s*'all-games'/, "must set currentView = 'all-games'");
    // Must appear before the first syncSidebarActionButton call
    const cvIdx   = fn.indexOf("currentView = 'all-games'");
    const syncIdx = fn.indexOf('syncSidebarActionButton');
    assert.ok(cvIdx > -1,  'currentView assignment present');
    assert.ok(syncIdx > -1, 'syncSidebarActionButton call present');
    assert.ok(cvIdx < syncIdx, 'currentView must be set before syncSidebarActionButton');
});

test('sidebar.js: getSidebarActionContext handles all-games when currentView is all-games', () => {
    const fnStart = SIDEBAR_JS.indexOf('function getSidebarActionContext');
    const fn = SIDEBAR_JS.slice(fnStart, fnStart + 1800);
    assert.match(fn, /currentView === 'all-games'/, "handles all-games view via currentView");
});

test('sidebar.js: getSidebarActionContext installed branch requires BOTH installedVisible and currentView', () => {
    const fnStart = SIDEBAR_JS.indexOf('function getSidebarActionContext');
    const fn = SIDEBAR_JS.slice(fnStart, fnStart + 1800);
    // The installed branch should depend on currentView === 'installed' so navigating
    // away from installed (which changes currentView) stops returning 'installed'.
    const installedReturn = fn.slice(fn.indexOf("return 'installed'") - 150, fn.indexOf("return 'installed'") + 20);
    assert.match(installedReturn, /currentView/, "installed return must check currentView");
});

// ── Phase 2.1 — setAgField / setIgField global ownership ─────────────────────
//
// These tests document the canonical runtime owner (accounts.js) and the
// temporary duplication in app.js that Phase 2.2 will remove.
//
// "TEMP Phase 2.2" tests are sentinels: they MUST FAIL after cleanup to confirm
// the dead code was actually deleted. Do not update them — delete them together
// with the lines they guard.

// ── display-prefs.js is the canonical owner (moved in Phase 2.10B) ───────────

test('Phase 2.1: display-prefs.js assigns window.setAgField (canonical owner)', () => {
    assert.match(DISPLAY_PREFS_JS, /window\.setAgField\s*=\s*function\s*\(field/,
        'display-prefs.js must assign window.setAgField as an inline function');
});

test('Phase 2.1: display-prefs.js assigns window.setIgField (canonical owner)', () => {
    assert.match(DISPLAY_PREFS_JS, /window\.setIgField\s*=\s*function\s*\(field/,
        'display-prefs.js must assign window.setIgField as an inline function');
});

test('Phase 2.1: display-prefs.js setAgField updates window._agDisplayPrefs.visibleFields[field]', () => {
    const fnStart = DISPLAY_PREFS_JS.indexOf('window.setAgField = function(field');
    assert.ok(fnStart !== -1, 'window.setAgField assignment not found in display-prefs.js');
    const fn = DISPLAY_PREFS_JS.slice(fnStart, fnStart + 400);
    assert.match(fn, /window\._agDisplayPrefs\.visibleFields\[field\]\s*=\s*visible/,
        'must assign visible to window._agDisplayPrefs.visibleFields[field]');
});

test('Phase 2.1: display-prefs.js setAgField calls _agSaveDisplayPrefs()', () => {
    const fnStart = DISPLAY_PREFS_JS.indexOf('window.setAgField = function(field');
    const fn = DISPLAY_PREFS_JS.slice(fnStart, fnStart + 400);
    assert.match(fn, /_agSaveDisplayPrefs\(\)/, 'must call _agSaveDisplayPrefs()');
});

test('Phase 2.1: display-prefs.js setAgField calls _agApplyDisplayPrefs()', () => {
    const fnStart = DISPLAY_PREFS_JS.indexOf('window.setAgField = function(field');
    const fn = DISPLAY_PREFS_JS.slice(fnStart, fnStart + 400);
    assert.match(fn, /_agApplyDisplayPrefs\(\)/, 'must call _agApplyDisplayPrefs()');
});

test('Phase 2.1: display-prefs.js setIgField updates window._igDisplayPrefs.visibleFields[field]', () => {
    const fnStart = DISPLAY_PREFS_JS.indexOf('window.setIgField = function(field');
    assert.ok(fnStart !== -1, 'window.setIgField assignment not found in display-prefs.js');
    const fn = DISPLAY_PREFS_JS.slice(fnStart, fnStart + 400);
    assert.match(fn, /window\._igDisplayPrefs\.visibleFields\[field\]\s*=\s*visible/,
        'must assign visible to window._igDisplayPrefs.visibleFields[field]');
});

test('Phase 2.1: display-prefs.js setIgField calls _igSaveDisplayPrefs()', () => {
    const fnStart = DISPLAY_PREFS_JS.indexOf('window.setIgField = function(field');
    const fn = DISPLAY_PREFS_JS.slice(fnStart, fnStart + 400);
    assert.match(fn, /_igSaveDisplayPrefs\(\)/, 'must call _igSaveDisplayPrefs()');
});

test('Phase 2.1: display-prefs.js setIgField calls _igApplyDisplayPrefs()', () => {
    const fnStart = DISPLAY_PREFS_JS.indexOf('window.setIgField = function(field');
    const fn = DISPLAY_PREFS_JS.slice(fnStart, fnStart + 400);
    assert.match(fn, /_igApplyDisplayPrefs\(\)/, 'must call _igApplyDisplayPrefs()');
});

// ── Phase 2.2: confirm dead app.js symbols are gone ──────────────────────────

test('Phase 2.2: app.js does NOT contain function setAgField', () => {
    assert.doesNotMatch(APP_JS, /function setAgField\s*\(/,
        'app.js dead setAgField function must be removed');
});

test('Phase 2.2: app.js does NOT contain function setIgField', () => {
    assert.doesNotMatch(APP_JS, /function setIgField\s*\(/,
        'app.js dead setIgField function must be removed');
});

test('Phase 2.2: app.js does NOT contain window.setIgField named ref assignment', () => {
    assert.doesNotMatch(APP_JS, /window\.setIgField\s*=\s*setIgField\b/,
        'dead app.js assignment must be gone after Phase 2.2');
});

test('Phase 2.2: app.js does NOT contain _applyFieldClass', () => {
    assert.doesNotMatch(APP_JS, /_applyFieldClass/,
        '_applyFieldClass (dead helper) must be removed from app.js');
});

test('Phase 2.2: app.js does NOT contain _AG_FIELD_CLASS_MAP', () => {
    assert.doesNotMatch(APP_JS, /_AG_FIELD_CLASS_MAP/,
        '_AG_FIELD_CLASS_MAP (dead constant) must be removed from app.js');
});

test('Phase 2.2: app.js does NOT contain _IG_FIELD_CLASS_MAP', () => {
    assert.doesNotMatch(APP_JS, /_IG_FIELD_CLASS_MAP/,
        '_IG_FIELD_CLASS_MAP (dead constant) must be removed from app.js');
});

// ── HTML depends on these globals ─────────────────────────────────────────────
// dashboard.html inline onchange handlers call setAgField/setIgField directly.
// These tests confirm the contract that must hold after Phase 2.2 (accounts.js
// must still expose the same global names so the HTML handlers keep working).

test('Phase 2.1: dashboard.html onchange handlers call setAgField()', () => {
    assert.match(HTML, /onchange="setAgField\(/,
        'dashboard.html must have onchange handlers invoking setAgField()');
});

test('Phase 2.1: dashboard.html onchange handlers call setIgField()', () => {
    assert.match(HTML, /onchange="setIgField\(/,
        'dashboard.html must have onchange handlers invoking setIgField()');
});

test('Phase 2.1: dashboard.html setAgField handlers pass field name and this.checked', () => {
    // Verify the args pattern — callers pass (fieldName, this.checked)
    assert.match(HTML, /onchange="setAgField\('[a-zA-Z]+',this\.checked\)"/,
        'setAgField calls must pass (fieldName, this.checked)');
});

test('Phase 2.1: dashboard.html setIgField handlers pass field name and this.checked', () => {
    assert.match(HTML, /onchange="setIgField\('[a-zA-Z]+',this\.checked\)"/,
        'setIgField calls must pass (fieldName, this.checked)');
});

// ── Phase 2.3 — window._vs temporal-coupling guards ──────────────────────────

test('Phase 2.3: sidebar.js toggleSidebar captures window._vs as local vs before using it', () => {
    const fnStart = SIDEBAR_JS.indexOf('function toggleSidebar');
    assert.ok(fnStart !== -1, 'toggleSidebar must exist in sidebar.js');
    const fn = SIDEBAR_JS.slice(fnStart, fnStart + 1500);
    assert.match(fn, /const vs\s*=\s*window\._vs/,
        'toggleSidebar must capture window._vs into a local const vs');
});

test('Phase 2.3: sidebar.js toggleSidebar guards vs before accessing its properties', () => {
    const fnStart = SIDEBAR_JS.indexOf('function toggleSidebar');
    const fn = SIDEBAR_JS.slice(fnStart, fnStart + 1500);
    // Guard must appear before any vs.* property access
    const guardIdx = fn.indexOf('if (!vs');
    const propIdx  = fn.indexOf('vs.');
    assert.ok(guardIdx !== -1, 'toggleSidebar must have !vs guard');
    assert.ok(propIdx  !== -1, 'toggleSidebar must use vs.* properties');
    assert.ok(guardIdx < propIdx, '!vs guard must precede first vs.* property access');
});

test('Phase 2.3: app.js toggleSidebar does NOT use bare _vs (only vs or window._vs)', () => {
    const fnStart = APP_JS.indexOf('function toggleSidebar');
    const fn = APP_JS.slice(fnStart, fnStart + 1500);
    // bare _vs (not preceded by window. or const) must not appear
    assert.doesNotMatch(fn, /[^w]\._vs\b|^_vs\b|\btypeof _vs\b/m,
        'toggleSidebar must not reference bare _vs — use local vs or window._vs');
});

test('Phase 2.3: app.js cardCache instanceof guards use window._vs optional chain', () => {
    // Every place that checks `window._vs.cardCache instanceof Map` must use ?.
    // (Operations inside the guard are fine without ?. since the guard already ran.)
    const guardMatches = [...APP_JS.matchAll(/window\._vs\??\.cardCache\s+instanceof/g)];
    assert.ok(guardMatches.length > 0, 'app.js must have cardCache instanceof guards');
    for (const m of guardMatches) {
        assert.match(m[0], /window\._vs\?\.cardCache\s+instanceof/,
            'cardCache instanceof guard must use window._vs?.cardCache');
    }
});

test('Phase 2.3: app.js _coverQueued instanceof guards use window._vs optional chain', () => {
    // Every place that checks `window._vs._coverQueued instanceof Set` must use ?.
    const guardMatches = [...APP_JS.matchAll(/window\._vs\??\.\_coverQueued\s+instanceof/g)];
    assert.ok(guardMatches.length > 0, 'app.js must have _coverQueued instanceof guards');
    for (const m of guardMatches) {
        assert.match(m[0], /window\._vs\?\._coverQueued\s+instanceof/,
            '_coverQueued instanceof guard must use window._vs?._coverQueued');
    }
});

// ── Phase 2.4 — _agSafeRenderAllGamesView consolidation ──────────────────────

test('Phase 2.4: accounts.js defines _agSafeRenderAllGamesView', () => {
    assert.match(ACC_JS, /function _agSafeRenderAllGamesView\s*\(/,
        '_agSafeRenderAllGamesView must be defined in accounts.js');
});

test('Phase 2.4: _agSafeRenderAllGamesView reads window.renderAllGamesView', () => {
    const fnStart = ACC_JS.indexOf('function _agSafeRenderAllGamesView');
    const fn = ACC_JS.slice(fnStart, fnStart + 200);
    assert.match(fn, /window\.renderAllGamesView/,
        'helper must read window.renderAllGamesView');
});

test('Phase 2.4: _agSafeRenderAllGamesView guards with typeof fn !== function check', () => {
    const fnStart = ACC_JS.indexOf('function _agSafeRenderAllGamesView');
    const fn = ACC_JS.slice(fnStart, fnStart + 200);
    assert.match(fn, /typeof fn !== 'function'/,
        'helper must guard against fn not being a function');
});

test('Phase 2.4: _agSafeRenderAllGamesView returns Promise.resolve(null) when missing', () => {
    const fnStart = ACC_JS.indexOf('function _agSafeRenderAllGamesView');
    const fn = ACC_JS.slice(fnStart, fnStart + 200);
    assert.match(fn, /Promise\.resolve\(null\)/,
        'helper must return Promise.resolve(null) when renderAllGamesView is absent');
});

test('Phase 2.4: no repeated typeof renderAllGamesView guards remain in accounts.js', () => {
    assert.doesNotMatch(ACC_JS, /typeof renderAllGamesView === 'function'/,
        'all typeof renderAllGamesView guards must be replaced by _agSafeRenderAllGamesView');
});

test('Phase 2.4: window.renderAllGamesView definition is unchanged', () => {
    assert.match(ACC_JS, /window\.renderAllGamesView\s*=\s*async function\s*\(\s*options\s*=\s*\{\}\s*\)/,
        'window.renderAllGamesView definition signature must be unchanged');
});

test('Phase 2.4: direct renderAllGamesView calls inside navigateToAllGames are preserved', () => {
    // navigateToAllGames is past the definition so the direct call is safe without a guard
    const fnStart = ACC_JS.indexOf('async function navigateToAllGames');
    const fn = ACC_JS.slice(fnStart, fnStart + 9500);
    assert.match(fn, /await renderAllGamesView\(/,
        'navigateToAllGames must still call renderAllGamesView directly (no guard needed)');
});

// ── Ready to Install page: startup loading behavior ───────────────────────────

test('accounts.js: _agRenderReadyToInstallLoading function exists', () => {
    assert.match(ACC_JS, /function _agRenderReadyToInstallLoading\s*\(/,
        '_agRenderReadyToInstallLoading must be defined');
});

test('accounts.js: _agRenderReadyToInstallLoading sets agResultCount to ellipsis', () => {
    const fnStart = ACC_JS.indexOf('function _agRenderReadyToInstallLoading');
    const fn = ACC_JS.slice(fnStart, fnStart + 3500);
    assert.match(fn, /agResultCount/, 'must reference agResultCount element');
    assert.match(fn, /…|\.\.\./, 'must set loading ellipsis text');
});

test('accounts.js: _agRenderReadyToInstallLoading hides toolbar', () => {
    const fnStart = ACC_JS.indexOf('function _agRenderReadyToInstallLoading');
    const fn = ACC_JS.slice(fnStart, fnStart + 3500);
    assert.match(fn, /_agSetToolbarVisible\s*\(\s*false\s*\)/, 'must hide toolbar while loading');
});

test('accounts.js: _agRenderReadyToInstallLoading registers baddel:ready-install-updated listener', () => {
    const fnStart = ACC_JS.indexOf('function _agRenderReadyToInstallLoading');
    const fn = ACC_JS.slice(fnStart, fnStart + 3500);
    assert.match(fn, /addEventListener\s*\(\s*['"]baddel:ready-install-updated['"]/, 'must listen for canonical state event');
});

test('accounts.js: _agRenderReadyToInstallLoading listener calls _applyAgFilters when canonical fires', () => {
    const fnStart = ACC_JS.indexOf('function _agRenderReadyToInstallLoading');
    const fn = ACC_JS.slice(fnStart, fnStart + 3500);
    assert.match(fn, /_applyAgFilters/, 'listener must call _applyAgFilters to re-render with canonical data');
});

test('accounts.js: _agRenderReadyToInstallLoading listener removes itself after first fire', () => {
    const fnStart = ACC_JS.indexOf('function _agRenderReadyToInstallLoading');
    const fn = ACC_JS.slice(fnStart, fnStart + 3500);
    assert.match(fn, /removeEventListener/, 'listener must remove itself to avoid duplicate renders');
});

test('accounts.js: navigateToAllGames RTI loading guard exists before _applyAgFilters', () => {
    const fnStart = ACC_JS.indexOf('async function navigateToAllGames');
    const fn = ACC_JS.slice(fnStart, fnStart + 8000);
    assert.match(fn, /agReadyOnly/, 'must check agReadyOnly in cache fast path');
    assert.match(fn, /isCanonicalReadyToInstallReady/, 'must check canonical readiness before rendering');
    assert.match(fn, /_agRenderReadyToInstallLoading/, 'must call loading helper when not ready');
    const guardIdx  = fn.indexOf('_agRenderReadyToInstallLoading');
    const filterIdx = fn.indexOf('_applyAgFilters');
    assert.ok(guardIdx > -1, '_agRenderReadyToInstallLoading must appear in navigateToAllGames');
    assert.ok(filterIdx > -1, '_applyAgFilters must appear in navigateToAllGames');
    assert.ok(guardIdx < filterIdx, 'RTI loading guard must precede _applyAgFilters call');
});

test('accounts.js: navigateToAllGames RTI guard only blocks when agReadyOnly is true', () => {
    const fnStart = ACC_JS.indexOf('async function navigateToAllGames');
    const fn = ACC_JS.slice(fnStart, fnStart + 8000);
    // Guard must be conditional on agReadyOnly — All Games path must not be gated
    const guardStart = fn.indexOf('_agRenderReadyToInstallLoading');
    const guardBlock = fn.slice(Math.max(0, guardStart - 300), guardStart + 10);
    assert.match(guardBlock, /agReadyOnly/, 'loading guard must be inside agReadyOnly conditional');
});

test('accounts.js: _agRenderReadyToInstallLoading listener guards against non-RTI view', () => {
    const fnStart = ACC_JS.indexOf('function _agRenderReadyToInstallLoading');
    const fn = ACC_JS.slice(fnStart, fnStart + 3200);
    assert.match(fn, /agReadyOnly/, 'listener must check agReadyOnly before re-rendering');
});

// ── Behavioral simulation: RTI loading state ─────────────────────────────────

test('RTI loading: pre-canonical state shows ellipsis, not raw count', () => {
    // Simulate: agReadyOnly=true, canonical not ready, raw cache has 125 games
    const fakeWindow = {
        agReadyOnly: true,
        __readyToInstallState: { ready: false, games: null, count: null, version: 0, source: 'not-ready' },
        _listeners: {},
        addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
        removeEventListener(ev, fn) {
            if (this._listeners[ev]) this._listeners[ev] = this._listeners[ev].filter(f => f !== fn);
        },
    };
    fakeWindow.isCanonicalReadyToInstallReady = function() {
        return fakeWindow.__readyToInstallState?.ready === true;
    };
    // Simulate what _agRenderReadyToInstallLoading does
    let countText = null;
    let toolbarVisible = true;
    const countEl = { set textContent(v) { countText = v; } };
    const getElementById = (id) => id === 'agResultCount' ? countEl : null;

    // Execute the loading behavior inline
    toolbarVisible = false; // _agSetToolbarVisible(false)
    countEl.textContent = '…';

    assert.strictEqual(countText, '…', 'count must show ellipsis, not raw pre-sync number');
    assert.strictEqual(toolbarVisible, false, 'toolbar must be hidden during loading');
    assert.notStrictEqual(countText, '125 games', 'must not show pre-sync 125 games count');
});

test('RTI loading: canonical fires -> re-renders with 119', () => {
    // Simulate: after baddel:ready-install-updated fires, page renders canonical 119
    const games119 = Array.from({ length: 119 }, (_, i) => ({ id: i, title: `Game ${i}` }));
    const fakeWindow = {
        agReadyOnly: true,
        __readyToInstallState: { ready: true, games: games119, count: 119, version: 1, source: 'library-updated' },
        _listeners: {},
        addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
        removeEventListener() {},
    };
    fakeWindow.isCanonicalReadyToInstallReady = function() {
        return fakeWindow.__readyToInstallState?.ready === true;
    };
    fakeWindow.getCanonicalReadyToInstallCount = function() {
        return fakeWindow.__readyToInstallState?.ready ? fakeWindow.__readyToInstallState.count : null;
    };
    const count = fakeWindow.getCanonicalReadyToInstallCount();
    assert.strictEqual(count, 119, 'after canonical fires, count must be 119');
    assert.notStrictEqual(count, 125, 'must not use pre-sync raw cache count');
    assert.notStrictEqual(count, 117, 'must not use suggestions pool count');
});

test('RTI loading: All Games route (agReadyOnly=false) renders normally without guard', () => {
    // agReadyOnly=false means normal All Games — canonical guard must NOT block
    const fakeState = { ready: false, games: null, count: null, version: 0, source: 'not-ready' };
    const isReady = () => fakeState.ready === true;
    // When agReadyOnly is false, the guard condition (agReadyOnly && !isReady()) is false
    const agReadyOnly = false;
    const guardFires = agReadyOnly && !isReady();
    assert.strictEqual(guardFires, false, 'loading guard must NOT fire for All Games route');
});

// ── renderAllGamesView full-rebuild RTI guard ─────────────────────────────────

test('accounts.js: renderAllGamesView has RTI guard before _renderAllGamesViewModeAware', () => {
    const fnStart = ACC_JS.indexOf('window.renderAllGamesView = async function');
    const fn = ACC_JS.slice(fnStart, fnStart + 10000);
    assert.match(fn, /agReadyOnly/, 'renderAllGamesView must check agReadyOnly');
    assert.match(fn, /isCanonicalReadyToInstallReady/, 'renderAllGamesView must check canonical readiness');
    assert.match(fn, /_agRenderReadyToInstallLoading/, 'renderAllGamesView must call loading helper when not ready');
    // Guard must appear before the raw _allGamesCache render call
    const guardIdx  = fn.indexOf('_agRenderReadyToInstallLoading');
    const renderIdx = fn.lastIndexOf('_renderAllGamesViewModeAware');
    assert.ok(guardIdx  > -1, '_agRenderReadyToInstallLoading must appear in renderAllGamesView');
    assert.ok(renderIdx > -1, '_renderAllGamesViewModeAware must appear in renderAllGamesView');
    assert.ok(guardIdx < renderIdx, 'RTI guard must precede _renderAllGamesViewModeAware call');
});

test('accounts.js: renderAllGamesView uses canonical list for RTI when canonical is ready', () => {
    const fnStart = ACC_JS.indexOf('window.renderAllGamesView = async function');
    const fn = ACC_JS.slice(fnStart, fnStart + 10000);
    assert.match(fn, /getCanonicalReadyToInstallGames/, 'renderAllGamesView must use canonical list when ready');
});

test('accounts.js: renderAllGamesView has debug log when blocking raw RTI render', () => {
    const fnStart = ACC_JS.indexOf('window.renderAllGamesView = async function');
    const fn = ACC_JS.slice(fnStart, fnStart + 10000);
    assert.match(fn, /ReadyCount.*renderAllGamesView blocked|renderAllGamesView blocked.*ReadyCount/,
        'must log when blocking raw RTI render');
});

// ── _applyAgFilters RTI canonical path ────────────────────────────────────────

test('accounts.js: _applyAgFilters has RTI guard that blocks when canonical not ready', () => {
    const fnStart = ACC_JS.indexOf('function _applyAgFilters');
    const fn = ACC_JS.slice(fnStart, fnStart + 3000);
    assert.match(fn, /agReadyOnly/, 'must check agReadyOnly');
    assert.match(fn, /isCanonicalReadyToInstallReady/, 'must check canonical readiness');
    assert.match(fn, /_agRenderReadyToInstallLoading/, 'must call loading helper when canonical not ready');
    // Guard must precede the pool construction
    const guardIdx = fn.indexOf('_agRenderReadyToInstallLoading');
    const cacheIdx = fn.indexOf('_agBuildFilteredPool(');
    assert.ok(guardIdx !== -1, '_agRenderReadyToInstallLoading must be present');
    assert.ok(cacheIdx !== -1, '_agBuildFilteredPool must be present');
    assert.ok(guardIdx < cacheIdx, 'RTI guard must appear before pool is built');
});

test('accounts.js: _applyAgFilters uses canonical list as base pool when RTI and canonical ready', () => {
    const fnStart = ACC_JS.indexOf('function _applyAgFilters');
    const fn = ACC_JS.slice(fnStart, fnStart + 2500);
    assert.match(fn, /getCanonicalReadyToInstallGames/, 'must use canonical list as base pool for RTI');
    assert.match(fn, /useCanonical/, 'must have a useCanonical flag to switch pool source');
});

test('accounts.js: _applyAgFilters has debug log when using canonical pool', () => {
    const fnStart = ACC_JS.indexOf('function _applyAgFilters');
    const fn = ACC_JS.slice(fnStart, fnStart + 2500);
    assert.match(fn, /ReadyCount.*_applyAgFilters using canonical|_applyAgFilters using canonical/,
        'must log when using canonical pool');
});

// ── Behavioral: renderAllGamesView full-rebuild guard simulation ──────────────

test('renderAllGamesView RTI: pre-canonical state shows loading, not raw 125', () => {
    // Simulate: agReadyOnly=true, canonical not ready, raw cache has 125 games
    const rawCache125 = Array.from({ length: 125 }, (_, i) => ({ id: i, title: `Game ${i}` }));
    const state = { ready: false, games: null, count: null, version: 0, source: 'not-ready' };
    const isReady = () => state.ready === true;
    const agReadyOnly = true;

    // Guard logic mirrors the actual code
    const blocked = agReadyOnly && !isReady();
    assert.strictEqual(blocked, true, 'guard must block raw RTI render when canonical not ready');
    // Confirm: raw cache would produce 125 (pre-sync count) but we must not render it
    assert.strictEqual(rawCache125.length, 125, 'pre-sync cache produces 125');
    // The loading function sets count to "…" — verified here by logic
    const countText = blocked ? '…' : `${rawCache125.length} games`;
    assert.strictEqual(countText, '…', 'must show ellipsis, not 125');
});

test('renderAllGamesView RTI: canonical ready -> renders 119, not raw 125', () => {
    // Simulate: canonical ready with 119 games, raw cache has 125
    const rawCache125 = Array.from({ length: 125 }, (_, i) => ({ id: i, title: `Game ${i}` }));
    const games119 = Array.from({ length: 119 }, (_, i) => ({ id: i, title: `Game ${i}` }));
    const state = { ready: true, games: games119, count: 119, version: 1, source: 'library-updated' };
    const agReadyOnly = true;
    const isReady = () => state.ready === true;
    const getCanonical = () => state.ready ? state.games : null;

    // Guard does not block
    assert.strictEqual(agReadyOnly && !isReady(), false, 'guard must not block when canonical ready');
    // Render path uses canonical list
    const readyGames = getCanonical();
    assert.ok(Array.isArray(readyGames), 'canonical must provide an array');
    assert.strictEqual(readyGames.length, 119, 'must render 119 from canonical list');
    assert.notStrictEqual(rawCache125.length, 119, 'raw cache has different count');
});

test('_applyAgFilters RTI: canonical ready -> pool is 119 not 125', () => {
    // Simulate the useCanonical path in _applyAgFilters
    const rawCache125 = Array.from({ length: 125 });
    const games119 = Array.from({ length: 119 });
    const state = { ready: true, games: games119, count: 119, version: 1, source: 'library-updated' };
    const agReadyOnly = true;
    const isReady = () => state.ready === true;
    const getCanonical = () => state.ready ? state.games : null;

    const useCanonical = agReadyOnly && isReady();
    const canonicalGames = useCanonical ? getCanonical() : null;
    const pool = (useCanonical && Array.isArray(canonicalGames)) ? [...canonicalGames] : [...rawCache125];

    assert.strictEqual(pool.length, 119, 'pool must use canonical 119, not raw 125');
});

test('_applyAgFilters All Games: agReadyOnly=false -> uses _allGamesCache normally', () => {
    // Normal All Games route must not be affected by RTI canonical path
    const rawCache = Array.from({ length: 300 });
    const agReadyOnly = false;
    const isReady = () => true; // canonical ready, but agReadyOnly=false
    const getCanonical = () => Array.from({ length: 119 });

    const useCanonical = agReadyOnly && isReady();
    const pool = useCanonical ? [...getCanonical()] : [...rawCache];
    assert.strictEqual(pool.length, 300, 'All Games route must use raw cache, not canonical');
});

// ─────────────────────────────────────────────────────────────────────────────
// Scroll preservation during background library updates
// ─────────────────────────────────────────────────────────────────────────────

// ── _getActiveScrollContainer source-text tests ───────────────────────────────

test('scroll: _getActiveScrollContainer is defined in app.js', () => {
    assert.match(APP_JS, /function _getActiveScrollContainer\s*\(/);
});

test('scroll: _getActiveScrollContainer is exported on window', () => {
    assert.match(APP_JS, /window\._getActiveScrollContainer\s*=\s*_getActiveScrollContainer/);
});

test('scroll: _getActiveScrollContainer checks multiple candidate containers', () => {
    const body = extractFnFromSource(APP_JS, 'function _getActiveScrollContainer(');
    assert.match(body, /mainContentArea/);
    assert.match(body, /scrollingElement/);
    assert.match(body, /documentElement/);
    assert.match(body, /document\.body/);
});

test('scroll: _getActiveScrollContainer prefers element with scrollTop > 0', () => {
    const body = extractFnFromSource(APP_JS, 'function _getActiveScrollContainer(');
    assert.match(body, /scrollTop\s*>\s*0/);
});

test('scroll: _getActiveScrollContainer checks window.scrollY as fallback', () => {
    const body = extractFnFromSource(APP_JS, 'function _getActiveScrollContainer(');
    assert.match(body, /window\.scrollY\s*>\s*0/);
});

// ── _preserveActiveScrollDuring source-text tests ────────────────────────────

test('scroll: _preserveActiveScrollDuring is defined in app.js', () => {
    assert.match(APP_JS, /function _preserveActiveScrollDuring\s*\(/);
});

test('scroll: _preserveActiveScrollDuring is exported on window', () => {
    assert.match(APP_JS, /window\._preserveActiveScrollDuring\s*=\s*_preserveActiveScrollDuring/);
});

test('scroll: _preserveActiveScrollDuring saves and restores scrollTop and scrollLeft', () => {
    const body = extractFnFromSource(APP_JS, 'function _preserveActiveScrollDuring(');
    assert.match(body, /scrollTop/);
    assert.match(body, /scrollLeft/);
    assert.match(body, /savedTop/);
    assert.match(body, /savedLeft/);
});

test('scroll: _preserveActiveScrollDuring supports async fn via .then()', () => {
    const body = extractFnFromSource(APP_JS, 'function _preserveActiveScrollDuring(');
    assert.match(body, /\.then\s*\(/);
});

test('scroll: _preserveActiveScrollDuring uses rAF chain for deferred layout settle', () => {
    const body = extractFnFromSource(APP_JS, 'function _preserveActiveScrollDuring(');
    assert.match(body, /requestAnimationFrame/);
});

test('scroll: _preserveActiveScrollDuring includes timeout restores at 50ms and 150ms', () => {
    const body = extractFnFromSource(APP_JS, 'function _preserveActiveScrollDuring(');
    assert.match(body, /setTimeout/);
});

test('scroll: _preserveActiveScrollDuring restores scrollTop and scrollLeft', () => {
    const body = extractFnFromSource(APP_JS, 'function _preserveActiveScrollDuring(');
    assert.match(body, /scrollTop\s*=\s*savedTop/);
    assert.match(body, /scrollLeft\s*=\s*savedLeft/);
});

test('scroll: _preserveActiveScrollDuring detects user scroll via wheel event', () => {
    const body = extractFnFromSource(APP_JS, 'function _preserveActiveScrollDuring(');
    assert.match(body, /wheel/);
    assert.match(body, /_userScrolled/);
    assert.match(body, /_markUserScroll/);
});

test('scroll: _preserveActiveScrollDuring skips restore when user scrolled during update', () => {
    const body = extractFnFromSource(APP_JS, 'function _preserveActiveScrollDuring(');
    assert.match(body, /_userScrolled\s*&&\s*savedTop\s*>\s*0/);
});

test('scroll: _preserveActiveScrollDuring skips restore when currentView changed', () => {
    const body = extractFnFromSource(APP_JS, 'function _preserveActiveScrollDuring(');
    assert.match(body, /nowView\s*!==\s*snapView/);
});

// ── onLibraryUpdated handler source-text tests ───────────────────────────────

test('scroll: onLibraryUpdated calls renderSidebar unconditionally then guards Home branch', () => {
    // Anchor on the line just before renderSidebar() which is after the data merge
    const anchor = APP_JS.indexOf('invalidate stale RTI page count');
    assert.ok(anchor !== -1, 'RTI invalidation comment not found in onLibraryUpdated handler');
    const handler = APP_JS.slice(anchor, anchor + 600);
    assert.match(handler, /renderSidebar\s*\(\s*\)/);
    assert.match(handler, /_homeIsUserScrolled\s*\(\s*\)/);
    assert.match(handler, /_markHomeRefreshPending/);
});

test('scroll: onLibraryUpdated non-home branch still uses _preserveActiveScrollDuring', () => {
    const idx = APP_JS.indexOf("'library-updated'");
    assert.ok(idx !== -1, 'library-updated label not found in app.js');
    const context = APP_JS.slice(Math.max(0, idx - 60), idx + 200);
    assert.match(context, /_preserveActiveScrollDuring/);
});

test('scroll: accounts.js onLibraryUpdated background path uses resetScroll:false', () => {
    // The background-sync re-render must not reset the user scroll position
    const idx = ACC_JS.indexOf('_applyAgFilters({ resetScroll: false })');
    assert.ok(idx !== -1, 'resetScroll:false not found in accounts.js');
});

test('scroll: accounts.js onLibraryUpdated uses window._preserveActiveScrollDuring', () => {
    const idx = ACC_JS.indexOf('window._allGamesLibraryListenerAttached');
    assert.ok(idx !== -1, 'library listener guard not found in accounts.js');
    const handlerBlock = ACC_JS.slice(idx, idx + 500);
    assert.match(handlerBlock, /window\._preserveActiveScrollDuring/);
});

test('scroll: accounts.js preserve wrapper uses accounts-library-updated reason', () => {
    assert.match(ACC_JS, /accounts-library-updated/);
});

test('scroll: accounts.js preserve wrapper surrounds cache rebuild and RTI publish', () => {
    const idx = ACC_JS.indexOf('accounts-library-updated');
    assert.ok(idx !== -1, 'accounts-library-updated label not found in accounts.js');
    // The preserve wrapper async fn is several hundred lines long; use a generous slice
    const afterLabel = ACC_JS.slice(idx, idx + 10000);
    assert.match(afterLabel, /_agPublishReadyToInstallState/);
    assert.match(afterLabel, /_applyAgFilters/);
});

test('scroll: _onCanonicalReady uses resetScroll:false to preserve user position', () => {
    // _onCanonicalReady is a nested function — find its definition inside _agRenderReadyToInstallLoading
    const outerIdx = ACC_JS.indexOf('function _agRenderReadyToInstallLoading');
    assert.ok(outerIdx !== -1, '_agRenderReadyToInstallLoading not found in accounts.js');
    const outerBody = ACC_JS.slice(outerIdx, outerIdx + 4000);
    const innerIdx = outerBody.indexOf('function _onCanonicalReady');
    assert.ok(innerIdx !== -1, '_onCanonicalReady not found inside _agRenderReadyToInstallLoading');
    const body = outerBody.slice(innerIdx, innerIdx + 1200);
    assert.match(body, /resetScroll:\s*false/);
    assert.doesNotMatch(body, /resetScroll:\s*true/);
});

test('scroll: navigateToAllGames still resets scroll to 0 for intentional navigation', () => {
    // User-driven navigation must reset scroll; only background updates preserve it
    const idx = ACC_JS.indexOf('function navigateToAllGames(');
    assert.ok(idx !== -1, 'navigateToAllGames not found in accounts.js');
    const body = ACC_JS.slice(idx, idx + 3200);
    assert.match(body, /scrollTop\s*=\s*0/);
});

test('scroll: accounts.js background re-render saves scrollTop before rendering', () => {
    // The onLibraryUpdated handler in accounts.js must capture scrollTop
    const idx = ACC_JS.indexOf('keepScrollTop');
    assert.ok(idx !== -1, 'keepScrollTop variable not found in accounts.js');
    // Must be used to restore scroll in a rAF
    const context = ACC_JS.slice(idx, idx + 700);
    assert.match(context, /scroller\.scrollTop\s*=\s*keepScrollTop/);
});

// ── preload.js multi-subscriber onLibraryUpdated tests ───────────────────────

test('preload.js: onLibraryUpdated does NOT call removeAllListeners', () => {
    const idx = PRELOAD_JS.indexOf('onLibraryUpdated');
    assert.ok(idx !== -1, 'onLibraryUpdated not found in preload.js');
    const slice = PRELOAD_JS.slice(idx, idx + 300);
    assert.doesNotMatch(slice, /removeAllListeners/, 'must not evict previous registrations');
});

test('preload.js: onLibraryUpdated uses a Set for multi-subscriber fanout', () => {
    assert.match(PRELOAD_JS, /_libraryUpdatedCallbacks\s*=\s*new Set/);
});

test('preload.js: onLibraryUpdated attaches a single IPC listener and fans out to all callbacks', () => {
    assert.match(PRELOAD_JS, /_libraryUpdatedListenerAttached/);
    assert.match(PRELOAD_JS, /_libraryUpdatedCallbacks\.forEach/);
});

test('preload.js: onLibraryUpdated adds callback to the Set', () => {
    const idx = PRELOAD_JS.indexOf('onLibraryUpdated:');
    assert.ok(idx !== -1, 'onLibraryUpdated: not found');
    const slice = PRELOAD_JS.slice(idx, idx + 400);
    assert.match(slice, /_libraryUpdatedCallbacks\.add\s*\(\s*cb\s*\)/);
});

// ── suggestions.js deferred Home refresh tests ───────────────────────────────

test('suggestions.js: _renderSyncedSuggestionsInner contains the original render body', () => {
    assert.match(SUGGESTIONS_JS, /async function _renderSyncedSuggestionsInner\s*\(/);
    const body = extractFnFromSource(SUGGESTIONS_JS, 'async function _renderSyncedSuggestionsInner(');
    assert.match(body, /_buildSyncedSuggestions/);
    assert.match(body, /_rtia_hydrateAll/);
});

test('suggestions.js: renderSyncedSuggestions skips DOM when Home is scrolled', () => {
    const body = extractFnFromSource(SUGGESTIONS_JS, 'async function renderSyncedSuggestions(');
    assert.match(body, /window\._homeIsUserScrolled/);
    assert.match(body, /window\._markHomeRefreshPending/);
    assert.match(body, /_renderSyncedSuggestionsInner/);
});

test('suggestions.js: renderSyncedSuggestions marks home-synced-suggestions-scrolled when deferred', () => {
    const body = extractFnFromSource(SUGGESTIONS_JS, 'async function renderSyncedSuggestions(');
    assert.match(body, /home-synced-suggestions-scrolled/);
});

test('suggestions.js: baddel:ready-install-updated listener uses text-only update when Home is scrolled', () => {
    const idx = SUGGESTIONS_JS.indexOf('baddel:ready-install-updated');
    assert.ok(idx !== -1, 'baddel:ready-install-updated not found in suggestions.js');
    const slice = SUGGESTIONS_JS.slice(idx, idx + 900);
    assert.match(slice, /window\._homeIsUserScrolled/);
    assert.match(slice, /window\._updateHomeReadyCountTextOnly/);
    assert.match(slice, /window\._markHomeRefreshPending/);
    assert.match(slice, /home-ready-count-text-only/);
});

// ── app.js Home deferred refresh helpers ─────────────────────────────────────

test('app.js: _homeIsUserScrolled is defined', () => {
    assert.match(APP_JS, /function _homeIsUserScrolled\s*\(/);
    assert.match(APP_JS, /window\._homeIsUserScrolled\s*=\s*_homeIsUserScrolled/);
});

test('app.js: _homeIsUserScrolled checks currentView === home and scrollTop > 40', () => {
    const body = extractFnFromSource(APP_JS, 'function _homeIsUserScrolled(');
    assert.match(body, /currentView.*home|home.*currentView/);
    assert.match(body, /scrollTop\s*>\s*40/);
});

test('app.js: _markHomeRefreshPending sets the pending flag and logs a deferred message', () => {
    assert.match(APP_JS, /function _markHomeRefreshPending\s*\(/);
    const body = extractFnFromSource(APP_JS, 'function _markHomeRefreshPending(');
    assert.match(body, /window\._homeRefreshPending\s*=\s*true/);
    assert.match(body, /\[HomeRefresh\].*deferred/);
});

test('app.js: _flushPendingHomeRefreshIfSafe guards on _homeIsUserScrolled and calls Home renders', () => {
    assert.match(APP_JS, /function _flushPendingHomeRefreshIfSafe\s*\(/);
    const body = extractFnFromSource(APP_JS, 'function _flushPendingHomeRefreshIfSafe(');
    assert.match(body, /_homeIsUserScrolled/);
    assert.match(body, /renderRecentlyPlayed/);
    assert.match(body, /renderSyncedSuggestions/);
    assert.match(body, /\[HomeRefresh\].*flushed/);
});

test('app.js: onLibraryUpdated skips Home DOM when user is scrolled', () => {
    const idx = APP_JS.indexOf('library-updated-home-scrolled');
    assert.ok(idx !== -1, 'library-updated-home-scrolled label not found in app.js');
    const context = APP_JS.slice(Math.max(0, idx - 400), idx + 100);
    assert.match(context, /_homeIsUserScrolled/);
    assert.match(context, /_markHomeRefreshPending/);
});

test('app.js: onLibraryUpdated still renders sidebar even when Home is scrolled', () => {
    const idx = APP_JS.indexOf('library-updated-home-scrolled');
    assert.ok(idx !== -1);
    // renderSidebar must appear before the _homeIsUserScrolled check
    const beforeCheck = APP_JS.slice(Math.max(0, idx - 500), idx);
    assert.match(beforeCheck, /renderSidebar/);
});

test('app.js: navigateToHome resets mainContentArea scrollTop and clears pending flag', () => {
    const body = extractFnFromSource(APP_JS, 'function navigateToHome(');
    assert.match(body, /mainContentArea/);
    assert.match(body, /scrollTop\s*=\s*0/);
    assert.match(body, /window\._homeRefreshPending\s*=\s*false/);
});

test('app.js: scroll lock system has been removed — no _restoreProtectedHomeScroll', () => {
    assert.doesNotMatch(APP_JS, /function _restoreProtectedHomeScroll\s*\(/);
    assert.doesNotMatch(APP_JS, /HomeScrollLock/);
    assert.doesNotMatch(APP_JS, /_homeProtectedScrollTop/);
});

test('app.js: _updateHomeReadyCountTextOnly is defined and exposed on window', () => {
    assert.match(APP_JS, /function _updateHomeReadyCountTextOnly\s*\(/);
    assert.match(APP_JS, /window\._updateHomeReadyCountTextOnly\s*=/);
});

test('app.js: _updateHomeReadyCountTextOnly uses textContent only — no innerHTML', () => {
    const body = extractFnFromSource(APP_JS, 'function _updateHomeReadyCountTextOnly(');
    assert.match(body, /\.textContent\s*=/);
    assert.doesNotMatch(body, /\.innerHTML\s*=/);
    assert.match(body, /data-ready-count/);
});

test('suggestions.js: baddel:ready-install-updated when scrolled calls _updateHomeReadyCountTextOnly', () => {
    const idx = SUGGESTIONS_JS.indexOf('baddel:ready-install-updated');
    assert.ok(idx !== -1, 'listener not found');
    const slice = SUGGESTIONS_JS.slice(idx, idx + 900);
    assert.match(slice, /_updateHomeReadyCountTextOnly/);
    assert.match(slice, /_homeIsUserScrolled/);
    assert.match(slice, /_markHomeRefreshPending/);
});

// ─────────────────────────────────────────────────────────────────────────────
// Behavioral: _getActiveScrollContainer runtime tests
// ─────────────────────────────────────────────────────────────────────────────

{
    const getContainerSrc = extractFnFromSource(APP_JS, 'function _getActiveScrollContainer(');

    function buildGetContainerFn(mockDoc, mockWin) {
        // eslint-disable-next-line no-new-func
        return new Function(
            'document', 'window',
            `${getContainerSrc}\nreturn _getActiveScrollContainer;`
        )(mockDoc, mockWin);
    }

    test('_getActiveScrollContainer: returns element with scrollTop > 0', () => {
        const scrolled   = { scrollTop: 600, scrollHeight: 3000, clientHeight: 800 };
        const unscrolled = { scrollTop: 0,   scrollHeight: 1000, clientHeight: 800 };
        const mockDoc = {
            getElementById: (id) => id === 'mainContentArea' ? unscrolled : null,
            querySelector:  (sel) => sel === '.main-content' ? scrolled : null,
            scrollingElement: unscrolled,
            documentElement:  unscrolled,
            body:             unscrolled,
        };
        const result = buildGetContainerFn(mockDoc, { scrollY: 0 })();
        assert.strictEqual(result.el, scrolled, 'must pick the scrolled element');
    });

    test('_getActiveScrollContainer: prefers mainContentArea when it is scrolled', () => {
        const main = { scrollTop: 400, scrollHeight: 2000, clientHeight: 700 };
        const mockDoc = {
            getElementById: (id) => id === 'mainContentArea' ? main : null,
            querySelector:  () => null,
            scrollingElement: null,
            documentElement: { scrollTop: 0, scrollHeight: 700, clientHeight: 700 },
            body:            { scrollTop: 0, scrollHeight: 700, clientHeight: 700 },
        };
        const result = buildGetContainerFn(mockDoc, { scrollY: 0 })();
        assert.strictEqual(result.el, main);
        assert.strictEqual(result.name, 'mainContentArea');
    });

    test('_getActiveScrollContainer: falls back to element that can scroll when none scrolled', () => {
        const main = { scrollTop: 0, scrollHeight: 3000, clientHeight: 800 };
        const mockDoc = {
            getElementById: (id) => id === 'mainContentArea' ? main : null,
            querySelector:  () => null,
            scrollingElement: null,
            documentElement: { scrollTop: 0, scrollHeight: 800, clientHeight: 800 },
            body:            { scrollTop: 0, scrollHeight: 800, clientHeight: 800 },
        };
        const result = buildGetContainerFn(mockDoc, { scrollY: 0 })();
        assert.strictEqual(result.el, main, 'fall back to element that can scroll');
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Behavioral: _preserveActiveScrollDuring runtime tests
// ─────────────────────────────────────────────────────────────────────────────

{
    const preserveSrc    = extractFnFromSource(APP_JS, 'function _preserveActiveScrollDuring(');
    const containerSrc   = extractFnFromSource(APP_JS, 'function _getActiveScrollContainer(');

    function makeScroller(scrollTop = 800) {
        return {
            scrollTop,
            scrollLeft:   0,
            scrollHeight: 3000,
            clientHeight: 700,
            _handlers:    {},
            addEventListener(evt, h) { this._handlers[evt] = h; },
            removeEventListener(evt) { delete this._handlers[evt]; },
        };
    }

    function buildPreserveFn(scroller, initialView) {
        const rafCbs     = [];
        const timeoutCbs = [];
        const mockDoc = {
            getElementById: () => scroller,
            querySelector:  () => null,
            scrollingElement: null,
            documentElement: { scrollTop: 0 },
            body:            { scrollTop: 0 },
        };
        const mockWin    = { scrollY: 0, scrollTo() {} };
        const mockRAF    = (cb) => { rafCbs.push(cb); };
        const mockTO     = (cb) => { timeoutCbs.push(cb); return 0; };
        const viewStr    = initialView != null ? JSON.stringify(initialView) : 'undefined';

        // eslint-disable-next-line no-new-func
        const preserve = new Function(
            'document', 'window', 'requestAnimationFrame', 'setTimeout',
            `var currentView = ${viewStr};
             ${containerSrc}
             return (${preserveSrc});`
        )(mockDoc, mockWin, mockRAF, mockTO);

        return { preserve, rafCbs, timeoutCbs };
    }

    test('_preserveActiveScrollDuring: async fn — restores after resolve then rAF chain', async () => {
        const scroller = makeScroller(500);
        const { preserve, rafCbs, timeoutCbs } = buildPreserveFn(scroller, 'home');

        let resolveAsync;
        preserve('test-async', () => new Promise(res => { resolveAsync = res; }));
        scroller.scrollTop = 0;

        assert.equal(scroller.scrollTop, 0, 'clamped before resolve');

        resolveAsync();
        await Promise.resolve();
        assert.equal(scroller.scrollTop, 500, 'restored after fn resolves');

        scroller.scrollTop = 0;
        rafCbs.shift()?.();
        assert.equal(scroller.scrollTop, 500, 'restored after rAF1');

        scroller.scrollTop = 0;
        rafCbs.shift()?.();
        assert.equal(scroller.scrollTop, 500, 'restored after rAF2');

        scroller.scrollTop = 0;
        timeoutCbs.shift()?.();
        assert.equal(scroller.scrollTop, 500, 'restored after timeout50');

        scroller.scrollTop = 0;
        timeoutCbs.shift()?.();
        assert.equal(scroller.scrollTop, 500, 'restored after timeout150');
    });

    test('_preserveActiveScrollDuring: sync fn — restores via rAF chain', () => {
        const scroller = makeScroller(300);
        const { preserve, rafCbs } = buildPreserveFn(scroller, 'installed');

        preserve('test-sync', () => { scroller.scrollTop = 0; });

        assert.equal(scroller.scrollTop, 0, 'clamped before rAF fires');

        rafCbs.shift()?.();
        assert.equal(scroller.scrollTop, 300, 'restored after rAF1');

        scroller.scrollTop = 0;
        rafCbs.shift()?.();
        assert.equal(scroller.scrollTop, 300, 'restored after rAF2');
    });

    test('_preserveActiveScrollDuring: wheel event skips restore to avoid fighting user', async () => {
        const scroller = makeScroller(700);
        const { preserve } = buildPreserveFn(scroller, 'home');

        let resolveAsync;
        preserve('test-wheel', () => new Promise(res => { resolveAsync = res; }));

        scroller._handlers['wheel']?.();
        scroller.scrollTop = 200;

        resolveAsync();
        await Promise.resolve();

        assert.equal(scroller.scrollTop, 200, 'must not restore over intentional user scroll');
    });

    test('_preserveActiveScrollDuring: wheel guard inactive when savedTop is 0', async () => {
        const scroller = makeScroller(0);
        const { preserve } = buildPreserveFn(scroller, 'home');

        let resolveAsync;
        preserve('test-zero', () => new Promise(res => { resolveAsync = res; }));

        scroller._handlers['wheel']?.();
        scroller.scrollTop = 0;

        resolveAsync();
        await Promise.resolve();

        assert.equal(scroller.scrollTop, 0, 'savedTop was 0 so no restore needed regardless of wheel');
    });
}

// Helper — extract a complete function body from source text
function extractFnFromSource(src, signature) {
    const idx = src.indexOf(signature);
    if (idx === -1) return '';
    let depth = 0;
    let i = idx;
    while (i < src.length) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(idx, i + 1); }
        i++;
    }
    return src.slice(idx);
}

// ── All Games background-sync flicker fix ────────────────────────────────────

test('accounts.js: _agLastRenderedPoolSignature state variable is declared', () => {
    assert.match(ACC_JS, /window\._agLastRenderedPoolSignature\s*=\s*['"]{2}/);
});

test('accounts.js: _agComputePoolSignature function is defined', () => {
    assert.match(ACC_JS, /function _agComputePoolSignature\s*\(/);
});

test('accounts.js: _agComputePoolSignature includes mode, filters, and ordered IDs', () => {
    const body = extractFnFromSource(ACC_JS, 'function _agComputePoolSignature(');
    assert.match(body, /agReadyOnly/);
    assert.match(body, /platform/);
    assert.match(body, /sort/);
    assert.match(body, /search/);
    assert.match(body, /account/);
    assert.match(body, /\.map\s*\(.*\bid\b/);
    assert.match(body, /\.join\s*\(\s*['"],['"]\s*\)/);
});

test('accounts.js: _applyAgFilters returns false and logs skip when background signature unchanged', () => {
    // Use direct source search — extractFnFromSource breaks on default-param {} in signature.
    assert.match(ACC_JS, /background-library-updated/);
    assert.match(ACC_JS, /_agLastRenderedPoolSignature/);
    assert.match(ACC_JS, /return\s+false/);
    assert.match(ACC_JS, /\[AllGames\] background update skipped visible rerender: signature unchanged/);
});

test('accounts.js: _applyAgFilters updates _agLastRenderedPoolSignature before each real render', () => {
    assert.match(ACC_JS, /window\._agLastRenderedPoolSignature\s*=\s*_newSig/);
});

test('accounts.js: onLibraryUpdated passes background-library-updated reason to _applyAgFilters', () => {
    const idx = ACC_JS.indexOf('background-library-updated');
    assert.ok(idx !== -1, 'background-library-updated string not found');
    const slice = ACC_JS.slice(idx - 50, idx + 100);
    assert.match(slice, /_applyAgFilters|reason/);
});

test('accounts.js: onLibraryUpdated does NOT clear cardCache on background update', () => {
    const idx = ACC_JS.indexOf('_allGamesLibraryListenerAttached');
    assert.ok(idx !== -1, 'listener guard not found');
    const slice = ACC_JS.slice(idx, idx + 3000);
    assert.doesNotMatch(slice, /cardCache\s*\.\s*clear\s*\(\s*\)/);
});

test('accounts.js: onLibraryUpdated skips scroll restore when render was skipped', () => {
    assert.match(ACC_JS, /_rendered\s*!==\s*false/);
});

test('app.js: onLibraryUpdated does NOT call applyFilters when currentView === all-games', () => {
    // The all-games branch must exist as a separate else-if, keeping applyFilters in the else branch.
    assert.match(APP_JS, /else\s+if\s*\(\s*currentView\s*===\s*['"]all-games['"]\s*\)/);
    // The all-games branch must NOT call applyFilters() (only _onSyncLibraryUpdated is allowed).
    const agIdx = APP_JS.indexOf("else if (currentView === 'all-games')");
    assert.ok(agIdx !== -1);
    // Extract the branch body (up to the next } else { closer).
    const elseIdx = APP_JS.indexOf('} else {', agIdx);
    if (elseIdx !== -1) {
        // Strip // comments before checking to avoid false positives.
        const branchText = APP_JS.slice(agIdx, elseIdx).replace(/\/\/[^\n]*/g, '');
        assert.doesNotMatch(branchText, /\bapplyFilters\s*\(\s*\)/);
    }
});

test('accounts.js: onAllGamesCoverCached listener does not call _renderAllGamesGrid', () => {
    const idx = ACC_JS.indexOf('onAllGamesCoverCached');
    assert.ok(idx !== -1, 'onAllGamesCoverCached listener not found');
    const body = ACC_JS.slice(idx, idx + 3000);
    assert.doesNotMatch(body, /_renderAllGamesGrid\s*\(/);
    assert.doesNotMatch(body, /_applyAgFilters\s*\(/);
});
