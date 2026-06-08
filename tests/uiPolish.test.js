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
const CSS         = fs.readFileSync(path.join(ROOT, 'src/css/dashboard.css'), 'utf8');
const ACCOUNTS_CSS = fs.readFileSync(path.join(ROOT, 'src/css/accounts.css'),  'utf8');
const MAIN_JS             = fs.readFileSync(path.join(ROOT, 'main.js'),               'utf8');
const SYNC_JS             = fs.readFileSync(path.join(ROOT, 'platformSync.js'),       'utf8');
const GAME_LIBRARY_HANDLERS_JS = fs.readFileSync(path.join(ROOT, 'handlers/gameLibraryHandlers.js'), 'utf8');

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
    const fn = ACC_JS.slice(fnStart, fnStart + 900);
    assert.match(fn, /_agNoLinkedAccounts/, '_agNoLinkedAccounts checked');
    assert.match(fn, /_agRenderEmptyOnboarding\(\)/, '_agRenderEmptyOnboarding called when cache empty');
    assert.match(fn, /_agSetToolbarVisible\(false\)/, 'toolbar hidden');
});

test('accounts.js: navigateToAllGames calls _agMaybeRenderEmptyOnboarding before renderAllGamesView', () => {
    const fnStart = ACC_JS.indexOf('async function navigateToAllGames');
    const fn = ACC_JS.slice(fnStart, fnStart + 7000);
    assert.match(fn, /_agMaybeRenderEmptyOnboarding/, '_agMaybeRenderEmptyOnboarding called in navigateToAllGames');
    // Must appear before renderAllGamesView call
    const maybeIdx  = fn.indexOf('_agMaybeRenderEmptyOnboarding');
    const renderIdx = fn.indexOf('renderAllGamesView');
    assert.ok(maybeIdx < renderIdx, '_agMaybeRenderEmptyOnboarding must precede renderAllGamesView');
});

test('accounts.js: renderAllGamesView calls _agMaybeRenderEmptyOnboarding after building cache', () => {
    const fnStart = ACC_JS.indexOf('window.renderAllGamesView = async function');
    const fn = ACC_JS.slice(fnStart, fnStart + 7000);
    assert.match(fn, /_agMaybeRenderEmptyOnboarding/, '_agMaybeRenderEmptyOnboarding called in renderAllGamesView');
    // Must appear after _allGamesCache is set
    const cacheIdx  = fn.indexOf('window._allGamesCache = await');
    const maybeIdx  = fn.indexOf('_agMaybeRenderEmptyOnboarding');
    assert.ok(cacheIdx < maybeIdx, '_agMaybeRenderEmptyOnboarding called after cache is built');
});

test('accounts.js: onLibraryUpdated clears empty mode when games arrive', () => {
    const listenerStart = ACC_JS.indexOf('onLibraryUpdated(async ()');
    const block = ACC_JS.slice(listenerStart, listenerStart + 5000);
    assert.match(block, /window\._allGamesCache\.length > 0/, 'checks _allGamesCache.length after filter');
    assert.match(block, /_agSetEmptyPageMode\(false\)/, '_agSetEmptyPageMode(false) called when games arrive');
    assert.match(block, /_agResetAllGamesGridMode\(\)/, '_agResetAllGamesGridMode called when games arrive');
});

// ─── Steam Link Account fix ───────────────────────────────────────────────────

test('accounts.js: linkNewPlatformAccount normalizes activePlatformView to lowercase', () => {
    const fnStart = ACC_JS.indexOf('async function linkNewPlatformAccount');
    const fn = ACC_JS.slice(fnStart, fnStart + 400);
    assert.match(fn, /\.toLowerCase\(\)/, 'platform must be lowercased');
    assert.match(fn, /\['steam', 'epic'\]\.includes\(platform\)/, "platform validated against ['steam','epic']");
});

test('accounts.js: linkNewPlatformAccount catch block uses actual error message not hardcoded string', () => {
    const fnStart = ACC_JS.indexOf('async function linkNewPlatformAccount');
    const fn = ACC_JS.slice(fnStart, fnStart + 7000);
    const catchStart = fn.lastIndexOf('} catch (err)');
    const catchBlock = fn.slice(catchStart, catchStart + 300);
    assert.match(catchBlock, /err\?\.message/, 'catch block must use err.message');
    assert.doesNotMatch(catchBlock, /Failed to link account\./, 'must not show hardcoded "Failed to link account."');
    assert.match(catchBlock, /Failed to link.*Steam.*Epic|Failed to link.*platform/is, 'toast must name the platform');
});

test('accounts.js: linkNewPlatformAccount uses finally block for cleanup', () => {
    const fnStart = ACC_JS.indexOf('async function linkNewPlatformAccount');
    const fn = ACC_JS.slice(fnStart, fnStart + 6500);
    assert.match(fn, /\} finally \{/, 'finally block must be present');
    const finallyStart = fn.lastIndexOf('} finally {');
    const finallyBlock = fn.slice(finallyStart, finallyStart + 80);
    assert.match(finallyBlock, /cleanup\(\)/, 'finally block must call cleanup()');
});

test('accounts.js: invalid activePlatformView shows error without calling platformSyncLink', () => {
    const fnStart = ACC_JS.indexOf('async function linkNewPlatformAccount');
    const fn = ACC_JS.slice(fnStart, fnStart + 400);
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
    const fn = ACC_JS.slice(fnStart, fnStart + 2200);
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
    const fn = ACC_JS.slice(fnStart, fnStart + 5500);
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
    const fn = ACC_JS.slice(fnStart, fnStart + 1100);
    assert.match(fn, /_agGetUserLibraryGames\(window\._allGamesCache/, 'must filter cache with _agGetUserLibraryGames');
    // pool must use the filtered cache, not the raw window._allGamesCache
    const filterIdx = fn.indexOf('_agGetUserLibraryGames(window._allGamesCache');
    const poolIdx   = fn.indexOf('let pool =');
    assert.ok(filterIdx < poolIdx, '_agGetUserLibraryGames must run before pool is built');
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

test('app.js: _clearArtworkLocalState is defined and exposed on window', () => {
    assert.match(APP_JS, /function _clearArtworkLocalState\(gameId\)/, 'function must be declared');
    assert.match(APP_JS, /window\._clearArtworkLocalState\s*=\s*_clearArtworkLocalState/, 'must be exposed on window');
});

test('app.js: _clearArtworkLocalState removes localStorage keys for cover/hero/logo', () => {
    const fnStart = APP_JS.indexOf('function _clearArtworkLocalState');
    const fn = APP_JS.slice(fnStart, fnStart + 600);
    assert.match(fn, /localStorage\.removeItem\('cover_'\s*\+\s*id\)/, 'removes cover_ key');
    assert.match(fn, /localStorage\.removeItem\('hero_'\s*\+\s*id\)/, 'removes hero_ key');
    assert.match(fn, /localStorage\.removeItem\('logo_'\s*\+\s*id\)/, 'removes logo_ key');
});

test('app.js: _clearArtworkLocalState removes game from window._allGamesCache and allGamesData', () => {
    const fnStart = APP_JS.indexOf('function _clearArtworkLocalState');
    const fn = APP_JS.slice(fnStart, fnStart + 900);
    assert.match(fn, /window\._allGamesCache\s*=\s*window\._allGamesCache\.filter/, 'removes from _allGamesCache');
    assert.match(fn, /allGamesData\s*=\s*allGamesData\.filter/, 'removes from allGamesData');
});

test('app.js: _clearArtworkLocalState removes cardCache and _coverQueued entries', () => {
    const fnStart = APP_JS.indexOf('function _clearArtworkLocalState');
    const fn = APP_JS.slice(fnStart, fnStart + 900);
    assert.match(fn, /cardCache.*instanceof Map/s, 'guards cardCache with instanceof Map');
    assert.match(fn, /cardCache\.delete\(id\)/, 'removes from cardCache');
    assert.match(fn, /_coverQueued.*instanceof Set/s, 'guards _coverQueued with instanceof Set');
    assert.match(fn, /_coverQueued\.delete\(id\)/, 'removes from _coverQueued');
});

test('app.js: hardDeleteGame calls _clearArtworkLocalState after deleteGamePermanently', () => {
    const fnStart = APP_JS.indexOf('function hardDeleteGame');
    const fn = APP_JS.slice(fnStart, fnStart + 500);
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

test('app.js: hydrateManualGameArtworkNow is defined and exposed on window', () => {
    assert.match(APP_JS, /async function hydrateManualGameArtworkNow\(game\)/, 'function must be declared');
    assert.match(APP_JS, /window\.hydrateManualGameArtworkNow\s*=\s*hydrateManualGameArtworkNow/, 'must be exposed on window');
});

test('app.js: hydrateManualGameArtworkNow removes stale file:// cover from localStorage', () => {
    const fnStart = APP_JS.indexOf('async function hydrateManualGameArtworkNow');
    const fn = APP_JS.slice(fnStart, fnStart + 1200);
    assert.match(fn, /localStorage\.removeItem\('cover_'/, 'removes stale cover from localStorage');
    assert.match(fn, /_isUsableLocalArtwork/, 'uses _isUsableLocalArtwork to probe');
});

test('app.js: hydrateManualGameArtworkNow passes force:true and bypassTtl:true unconditionally', () => {
    const fnStart = APP_JS.indexOf('async function hydrateManualGameArtworkNow');
    const fn = APP_JS.slice(fnStart, fnStart + 2000);
    assert.match(fn, /force:\s*true/, 'must pass force:true unconditionally');
    assert.match(fn, /bypassTtl:\s*true/, 'must pass bypassTtl:true');
    assert.match(fn, /source:\s*'manual-add-readd'/, 'uses manual-add-readd source');
});

test('app.js: _isUsableLocalArtwork probes file:// URLs via probeLocalImage', () => {
    const fnStart = APP_JS.indexOf('async function _isUsableLocalArtwork');
    const fn = APP_JS.slice(fnStart, fnStart + 300);
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

test('app.js: hydrateManualGameArtworkNow passes rich manual hints to getMetadata', () => {
    const fnStart = APP_JS.indexOf('async function hydrateManualGameArtworkNow');
    const fn = APP_JS.slice(fnStart, fnStart + 1800);
    assert.match(fn, /command:\s*game\.command/, 'must pass command hint');
    assert.match(fn, /executablePath:\s*game\.executablePath/, 'must pass executablePath hint');
    assert.match(fn, /folderName:\s*game\.folderName/, 'must pass folderName hint');
    assert.match(fn, /exeName:\s*game\.exeName/, 'must pass exeName hint');
});

test('app.js: hydrateManualGameArtworkNow uses meta.image/defaultImage/coverUrl as cover fallback', () => {
    const fnStart = APP_JS.indexOf('async function hydrateManualGameArtworkNow');
    const fn = APP_JS.slice(fnStart, fnStart + 2500);
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
    const fnStart = SCANNER_JS.indexOf('async deleteGamePermanently(gameId)');
    const fn = SCANNER_JS.slice(fnStart, fnStart + 500);
    assert.match(fn, /mrm\.clearJob\(gameId\)/, 'must call mrm.clearJob');
    const imgIdx   = fn.indexOf('deleteGameImages');
    const clearIdx = fn.indexOf('mrm.clearJob');
    assert.ok(imgIdx < clearIdx, 'mrm.clearJob must come after deleteGameImages');
});

test('gameScanner.js: deleteGamePermanently calls metadataCacheStore.deleteEntry', () => {
    const fnStart = SCANNER_JS.indexOf('async deleteGamePermanently(gameId)');
    const fn = SCANNER_JS.slice(fnStart, fnStart + 500);
    assert.match(fn, /metadataCacheStore\.deleteEntry\(gameId\)/, 'must call metadataCacheStore.deleteEntry');
});

test('main.js: get-game-metadata passes force/bypassTtl to mrm.resolve when hints.force is true', () => {
    const handlerIdx = MAIN_JS.indexOf("ipcMain.handle('get-game-metadata'");
    const handler = MAIN_JS.slice(handlerIdx, handlerIdx + 9000);
    assert.match(handler, /forceMetadata/, 'must compute forceMetadata');
    assert.match(handler, /hints\.force\s*===\s*true/, 'must check hints.force');
    assert.match(handler, /force:\s*forceMetadata/, 'must pass force to mrm.resolve');
    assert.match(handler, /bypassTtl:\s*forceMetadata/, 'must pass bypassTtl to mrm.resolve');
    assert.match(handler, /!forceMetadata.*cooldown|cooldown.*!forceMetadata/s, 'cooldown check must be gated on !forceMetadata');
});

test('main.js: get-game-metadata bypasses cooldown when source is manual-add-readd', () => {
    const handlerIdx = MAIN_JS.indexOf("ipcMain.handle('get-game-metadata'");
    const handler = MAIN_JS.slice(handlerIdx, handlerIdx + 6000);
    assert.match(handler, /manual-add-readd/, 'must include manual-add-readd source in forceMetadata check');
});

test('main.js: add-manual-game passes forceMetadata:true to gameScanner', () => {
    const handlerIdx = MAIN_JS.indexOf("ipcMain.handle('add-manual-game'");
    const handler = MAIN_JS.slice(handlerIdx, handlerIdx + 1500);
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
    // Must return the hydrated game from dbCache
    assert.match(fn, /hydratedGame.*dbCache|dbCache.*hydratedGame/, 'must return hydrated game from dbCache');
    assert.match(fn, /return \{ status: 'success', game: hydratedGame \}/, 'must return hydratedGame');
});

test('app.js: hydrateManualGameArtworkNow awaits cacheAllAssets (no fire-and-forget .then)', () => {
    const fnStart = APP_JS.indexOf('async function hydrateManualGameArtworkNow');
    const fn = APP_JS.slice(fnStart, fnStart + 2600);
    assert.match(fn, /await window\.electronAPI\.cacheAllAssets/, 'must await cacheAllAssets');
    assert.doesNotMatch(fn, /cacheAllAssets\([^)]*\)\s*\n?\s*\.then\(/, 'must NOT use .then() (fire-and-forget)');
});

test('app.js: hydrateManualGameArtworkNow persists metadata with saveMetadata after caching', () => {
    const fnStart = APP_JS.indexOf('async function hydrateManualGameArtworkNow');
    const fn = APP_JS.slice(fnStart, fnStart + 4000);
    assert.match(fn, /saveMetadata\??\.?\(game\.id/, 'must call saveMetadata');
    assert.match(fn, /artworkSource/, 'must include artworkSource in saved metadata');
});

test('app.js: hydrateManualGameArtworkNow always passes force:true to getMetadata', () => {
    const fnStart = APP_JS.indexOf('async function hydrateManualGameArtworkNow');
    const fn = APP_JS.slice(fnStart, fnStart + 2000);
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
    const fn = ACC_JS.slice(fnStart, fnStart + 2200);
    assert.match(fn, /hasSyncedAccountEvidence/, 'must use hasSyncedAccountEvidence');
    assert.match(fn, /isSteamOrEpic.*hasSyncedAccountEvidence|hasSyncedAccountEvidence.*isSteamOrEpic/s,
        'must gate Steam/Epic on hasSyncedAccountEvidence');
});

test('accounts.js: _agIsUserLibraryGame rejects Xbox installed-only (no synced evidence)', () => {
    const fnStart = ACC_JS.indexOf('function _agIsUserLibraryGame');
    const fn = ACC_JS.slice(fnStart, fnStart + 2200);
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
    const fn = ACC_JS.slice(listenerStart, listenerStart + 3200);
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
    const fn = ACC_JS.slice(fnStart, fnStart + 7000);
    const scrollIdx = fn.indexOf('scrollTop = 0');
    const hideIdx   = fn.indexOf('_hideAllViews');
    assert.ok(scrollIdx > -1, 'scrollTop = 0 must appear in navigateToAllGames');
    assert.ok(hideIdx   > -1, '_hideAllViews must appear in navigateToAllGames');
    assert.ok(scrollIdx < hideIdx, 'scrollTop reset must precede _hideAllViews call');
});

test('accounts.js: navigateToAllGames calls _agBeginAllGamesRoute before renderAllGamesView (full path)', () => {
    const fnStart = ACC_JS.indexOf('async function navigateToAllGames');
    const fn = ACC_JS.slice(fnStart, fnStart + 7000);
    const beginIdx  = fn.indexOf('_agBeginAllGamesRoute');
    const renderIdx = fn.lastIndexOf('renderAllGamesView');
    assert.ok(beginIdx  > -1, '_agBeginAllGamesRoute must appear in navigateToAllGames');
    assert.ok(renderIdx > -1, 'renderAllGamesView must appear in navigateToAllGames');
    assert.ok(beginIdx  < renderIdx, '_agBeginAllGamesRoute must precede renderAllGamesView call');
});

test('accounts.js: navigateToAllGames calls _agBeginAllGamesRoute before _applyAgFilters (cache path)', () => {
    const fnStart = ACC_JS.indexOf('async function navigateToAllGames');
    const fn = ACC_JS.slice(fnStart, fnStart + 7000);
    const beginIdx  = fn.indexOf('_agBeginAllGamesRoute');
    const filterIdx = fn.indexOf('_applyAgFilters');
    assert.ok(beginIdx  > -1, '_agBeginAllGamesRoute must appear in navigateToAllGames');
    assert.ok(filterIdx > -1, '_applyAgFilters must appear in navigateToAllGames');
    assert.ok(beginIdx  < filterIdx, '_agBeginAllGamesRoute must precede _applyAgFilters call');
});

test('accounts.js: navigateToAllGames calls _agBeginAllGamesRoute after allGamesView display=block', () => {
    const fnStart = ACC_JS.indexOf('async function navigateToAllGames');
    const fn = ACC_JS.slice(fnStart, fnStart + 7000);
    const displayIdx = fn.indexOf("style.display = 'block'");
    const beginIdx   = fn.indexOf('_agBeginAllGamesRoute');
    assert.ok(displayIdx > -1, "display='block' must appear before _agBeginAllGamesRoute");
    assert.ok(beginIdx   > displayIdx, '_agBeginAllGamesRoute must come after view display=block');
});

test('accounts.js: navigateToAllGames wraps async body in try/finally calling _agEndAllGamesRoute', () => {
    const fnStart = ACC_JS.indexOf('async function navigateToAllGames');
    const fn = ACC_JS.slice(fnStart, fnStart + 7000);
    assert.match(fn, /\bfinally\b/, 'navigateToAllGames must use try/finally');
    assert.match(fn, /_agEndAllGamesRoute\(\)/, 'finally block must call _agEndAllGamesRoute');
});

test('accounts.js: navigateToAllGames cache path uses resetScroll controlled by restoreState', () => {
    const fnStart = ACC_JS.indexOf('async function navigateToAllGames');
    const fn = ACC_JS.slice(fnStart, fnStart + 7000);
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

test('app.js: clearSidebarActiveState is defined and clears nav-item, platform-item, and collection rows', () => {
    assert.match(APP_JS, /function clearSidebarActiveState\(\)/,
        'clearSidebarActiveState must be defined');
    const fnStart = APP_JS.indexOf('function clearSidebarActiveState');
    const fn = APP_JS.slice(fnStart, fnStart + 400);
    assert.match(fn, /\.nav-item\.active/, 'must target .nav-item.active');
    assert.match(fn, /\.platform-item\.active/, 'must target .platform-item.active');
    assert.match(fn, /\[data-collection-id\]\.active/, 'must target [data-collection-id].active');
});

test('app.js: updateSidebarActiveState calls clearSidebarActiveState first', () => {
    const fnStart = APP_JS.indexOf('function updateSidebarActiveState');
    const fn = APP_JS.slice(fnStart, fnStart + 200);
    assert.match(fn, /clearSidebarActiveState\(\)/, 'must call clearSidebarActiveState() at the start');
});

test('app.js: updateSidebarActiveState uses else-if chain (not independent ifs)', () => {
    const fnStart = APP_JS.indexOf('function updateSidebarActiveState');
    const fn = APP_JS.slice(fnStart, fnStart + 900);
    assert.match(fn, /\} else if/, 'must use else-if so only one branch can win');
    // Must NOT have nav-ready or nav-all-games activations outside the else-if chain
    const platformIdx = fn.indexOf('currentAccountPlatform');
    const readyIdx    = fn.indexOf('nav-ready');
    assert.ok(platformIdx > -1, 'must reference currentAccountPlatform');
    assert.ok(readyIdx    > -1, 'must activate nav-ready');
    assert.ok(platformIdx < readyIdx, 'platform check must come before nav-ready in else-if order');
});

test('app.js: updateSidebarActiveState uses DOM visibility for accounts branch', () => {
    const fnStart = APP_JS.indexOf('function updateSidebarActiveState');
    const fn = APP_JS.slice(fnStart, fnStart + 500);
    assert.match(fn, /accountsVisible/, 'must check accountsVisible via DOM');
    assert.match(fn, /accountsView.*display|display.*accountsView/, 'must check accountsView display style');
});

test('app.js: updateSidebarActiveState uses DOM visibility for allGames branch', () => {
    const fnStart = APP_JS.indexOf('function updateSidebarActiveState');
    const fn = APP_JS.slice(fnStart, fnStart + 500);
    assert.match(fn, /allGamesVisible/, 'must check allGamesVisible via DOM');
});

test('app.js: navigateToHome calls updateSidebarActiveState instead of manual nav clearing', () => {
    const fnStart = APP_JS.indexOf('function navigateToHome');
    const fn = APP_JS.slice(fnStart, fnStart + 600);
    assert.match(fn, /updateSidebarActiveState\(\)/, 'navigateToHome must call updateSidebarActiveState');
});

test('app.js: navigateToInstalled calls updateSidebarActiveState and sets collectionId null', () => {
    const fnStart = APP_JS.indexOf('function navigateToInstalled');
    const fn = APP_JS.slice(fnStart, fnStart + 600);
    assert.match(fn, /updateSidebarActiveState\(\)/, 'navigateToInstalled must call updateSidebarActiveState');
    assert.match(fn, /currentFilters\.collectionId\s*=\s*null/, 'must clear collectionId');
});

test('app.js: navigateToCollections calls updateSidebarActiveState and sets collectionId null', () => {
    const fnStart = APP_JS.indexOf('function navigateToCollections');
    const fn = APP_JS.slice(fnStart, fnStart + 400);
    assert.match(fn, /updateSidebarActiveState\(\)/, 'navigateToCollections must call updateSidebarActiveState');
    assert.match(fn, /currentFilters\.collectionId\s*=\s*null/, 'must clear collectionId');
});

test('app.js: filterByCollection calls updateSidebarActiveState instead of manual nav activation', () => {
    const fnStart = APP_JS.indexOf('function filterByCollection');
    const fn = APP_JS.slice(fnStart, fnStart + 1200);
    assert.match(fn, /updateSidebarActiveState\(\)/, 'filterByCollection must call updateSidebarActiveState');
    // Must not manually add active to individual nav items
    assert.doesNotMatch(fn, /classList\.add\('active'\)/, 'must not manually add active — let updateSidebarActiveState do it');
});

test('accounts.js: selectAccountPlatform calls updateSidebarActiveState instead of manually activating nav', () => {
    const fnStart = ACC_JS.indexOf('function selectAccountPlatform');
    const fn = ACC_JS.slice(fnStart, fnStart + 1200);
    assert.match(fn, /updateSidebarActiveState\(\)/, 'must call updateSidebarActiveState');
    // Must not directly add active to a specific nav-platform element
    assert.doesNotMatch(fn, /getElementById.*nav-.*classList\.add\('active'\)/,
        'must not manually activate nav-platform element');
});

test('accounts.js: selectAccountPlatform clears currentFilters.collectionId', () => {
    const fnStart = ACC_JS.indexOf('function selectAccountPlatform');
    const fn = ACC_JS.slice(fnStart, fnStart + 600);
    assert.match(fn, /currentFilters\.collectionId\s*=\s*null/, 'must clear collectionId');
});

test('accounts.js: navigateToAllGames clears currentFilters.collectionId for normal navigation', () => {
    const fnStart = ACC_JS.indexOf('async function navigateToAllGames');
    const fn = ACC_JS.slice(fnStart, fnStart + 2000);
    assert.match(fn, /currentFilters\.collectionId\s*=\s*null/, 'must clear collectionId');
    assert.match(fn, /!opts\.restoreState/, 'must guard by !opts.restoreState');
});

// ── Sidebar context button correctness ────────────────────────────────────────

test('app.js: getSidebarActionContext returns installed when installedGamesView visible and currentView=installed', () => {
    const fnStart = APP_JS.indexOf('function getSidebarActionContext');
    const fn = APP_JS.slice(fnStart, fnStart + 1000);
    assert.match(fn, /installedVisible/, 'must check installedVisible');
    assert.match(fn, /'installed'/, "must return 'installed'");
    assert.match(fn, /currentView === 'installed'/, "must guard with currentView === 'installed'");
});

test('app.js: getSidebarActionContext returns collection for custom collection view', () => {
    const fnStart = APP_JS.indexOf('function getSidebarActionContext');
    const fn = APP_JS.slice(fnStart, fnStart + 1000);
    assert.match(fn, /customCollVisible/, 'must check customCollVisible');
    assert.match(fn, /'collection'/, "must return 'collection'");
    assert.match(fn, /currentView === 'collection'/, "must guard with currentView === 'collection'");
});

test('app.js: handleSidebarContextBtn on installed calls openAddGameModal', () => {
    const fnStart = APP_JS.indexOf('function handleSidebarContextBtn');
    const fn = APP_JS.slice(fnStart, fnStart + 1300);
    const installedIdx = fn.indexOf("ctx === 'installed'");
    const modalIdx     = fn.indexOf('openAddGameModal');
    assert.ok(installedIdx > -1, "must check ctx === 'installed'");
    assert.ok(modalIdx     > -1, 'must call openAddGameModal');
    assert.ok(installedIdx < modalIdx, 'openAddGameModal must be inside the installed branch');
});

test('app.js: handleSidebarContextBtn on collection calls navigateToInstalled', () => {
    const fnStart = APP_JS.indexOf('function handleSidebarContextBtn');
    const fn = APP_JS.slice(fnStart, fnStart + 1300);
    const collIdx = fn.indexOf("ctx === 'collection'");
    const navIdx  = fn.indexOf('navigateToInstalled');
    assert.ok(collIdx > -1, "must check ctx === 'collection'");
    assert.ok(navIdx  > -1, 'must call navigateToInstalled');
    assert.ok(collIdx < navIdx, 'navigateToInstalled must be inside the collection branch');
});

test('app.js: handleSidebarContextBtn does NOT call openPlatformsModal for installed context', () => {
    const fnStart = APP_JS.indexOf('function handleSidebarContextBtn');
    const fn = APP_JS.slice(fnStart, fnStart + 1300);
    // openPlatformsModal must only appear in the library/fallback branch, not the installed branch
    const installedBlock = fn.slice(fn.indexOf("ctx === 'installed'"), fn.indexOf("ctx === 'collections'"));
    assert.doesNotMatch(installedBlock, /openPlatformsModal/, 'installed branch must not call openPlatformsModal');
});

test('app.js: updateSbContextBtn delegates to syncSidebarActionButton (Browse Installed Games for collection)', () => {
    // updateSbContextBtn now delegates; the label lives in syncSidebarActionButton
    const fnStart = APP_JS.indexOf('function syncSidebarActionButton');
    const fn = APP_JS.slice(fnStart, fnStart + 1600);
    assert.match(fn, /Browse Installed Games/, 'must show Browse Installed Games text for collection/favorites context');
    assert.match(fn, /collection:/, "map must have 'collection' key");
});

test('app.js: updateSbContextBtn delegates to syncSidebarActionButton (Add Game for installed)', () => {
    // updateSbContextBtn now delegates; the label lives in syncSidebarActionButton
    const fnStart = APP_JS.indexOf('function syncSidebarActionButton');
    const fn = APP_JS.slice(fnStart, fnStart + 1600);
    assert.match(fn, /installed:/, "map must have 'installed' key");
    const installedIdx = fn.indexOf('installed:');
    const addGameIdx   = fn.indexOf('Add Game', installedIdx);
    assert.ok(addGameIdx > installedIdx && addGameIdx < installedIdx + 80,
        'Add Game text must follow the installed key');
});

// ── Issue 1: Collection from Manage keeps correct context button ──────────────

test('app.js: filterByCollection calls updateSbContextBtn after updateSidebarActiveState', () => {
    const fnStart = APP_JS.indexOf('function filterByCollection');
    const fn = APP_JS.slice(fnStart, fnStart + 1200);
    assert.match(fn, /updateSbContextBtn/, 'filterByCollection must call updateSbContextBtn');
    const activeIdx = fn.indexOf('updateSidebarActiveState');
    const ctxIdx    = fn.indexOf('updateSbContextBtn');
    assert.ok(activeIdx > -1, 'must call updateSidebarActiveState');
    assert.ok(ctxIdx > -1, 'must call updateSbContextBtn');
    assert.ok(ctxIdx > activeIdx, 'updateSbContextBtn must come after updateSidebarActiveState');
});

test('app.js: openSidebarCollection clears currentAccountPlatform before calling filterByCollection', () => {
    const fnStart = APP_JS.indexOf('function openSidebarCollection');
    const fn = APP_JS.slice(fnStart, fnStart + 400);
    assert.match(fn, /currentAccountPlatform\s*=\s*null/, 'must set currentAccountPlatform to null');
    const clearIdx  = fn.indexOf('currentAccountPlatform');
    const filterIdx = fn.indexOf('filterByCollection');
    assert.ok(clearIdx < filterIdx, 'currentAccountPlatform must be cleared before filterByCollection');
});

test('app.js: getSidebarActionContext checks collection (custom) before collections (manage page)', () => {
    const fnStart = APP_JS.indexOf('function getSidebarActionContext');
    const fn = APP_JS.slice(fnStart, fnStart + 1800);
    const collectionIdx  = fn.indexOf("return 'collection'");
    const collectionsIdx = fn.indexOf("return 'collections'");
    assert.ok(collectionIdx  > -1, "must return 'collection' for custom collection view");
    assert.ok(collectionsIdx > -1, "must return 'collections' for collections manage page");
    assert.ok(collectionIdx < collectionsIdx, "collection detail must be checked before collections manage");
});

// ── Issue 2: All Games / Ready button should say Link Accounts ────────────────

test('app.js: syncSidebarActionButton shows Link Accounts for all-games and not for installed', () => {
    // Link Accounts label lives in syncSidebarActionButton map
    const fnStart = APP_JS.indexOf('function syncSidebarActionButton');
    const fn = APP_JS.slice(fnStart, fnStart + 1600);
    assert.match(fn, /Link Accounts/, 'must contain Link Accounts text');
    // installed key must map to Add Game, not Link Accounts
    const installedIdx = fn.indexOf("installed:");
    const installedBlock = fn.slice(installedIdx, installedIdx + 80);
    assert.doesNotMatch(installedBlock, /Link Accounts/, 'installed entry must not say Link Accounts');
    assert.match(installedBlock, /Add Game/, 'installed entry must say Add Game');
});

test('app.js: getSidebarActionContext returns all-games when allGamesView visible and not readyOnly', () => {
    const fnStart = APP_JS.indexOf('function getSidebarActionContext');
    const fn = APP_JS.slice(fnStart, fnStart + 1800);
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
    const fn = ACC_JS.slice(fnStart, fnStart + 600);
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

test('app.js: _setUpdateBadge shows badge with label when called with true', () => {
    const fnStart = APP_JS.indexOf('function _setUpdateBadge');
    const fn = APP_JS.slice(fnStart, fnStart + 400);
    assert.match(fn, /updateBadgeBtn/, 'must reference updateBadgeBtn');
    assert.match(fn, /show\s*\?\s*['"]flex['"]/, 'must set display flex when showing');
    assert.match(fn, /lbl.*label|label.*lbl/, 'must update label text');
});

test('app.js: _setUpdateBadge hides badge when called with false', () => {
    const fnStart = APP_JS.indexOf('function _setUpdateBadge');
    const fn = APP_JS.slice(fnStart, fnStart + 400);
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

test('app.js: BETA_FEEDBACK_BANNER_KEY constant defined', () => {
    assert.match(APP_JS, /BETA_FEEDBACK_BANNER_KEY/, 'constant must exist');
    assert.match(APP_JS, /baddel\.betaFeedbackBanner\.dismissed\.v1/, 'must use the correct localStorage key');
});

test('app.js: shouldShowBetaFeedbackBanner reads localStorage', () => {
    const fnStart = APP_JS.indexOf('function shouldShowBetaFeedbackBanner');
    const fn = APP_JS.slice(fnStart, fnStart + 200);
    assert.match(fn, /localStorage\.getItem/, 'must read from localStorage');
    assert.match(fn, /BETA_FEEDBACK_BANNER_KEY/, 'must use the key constant');
});

test('app.js: markBetaFeedbackBannerDismissed writes to localStorage', () => {
    const fnStart = APP_JS.indexOf('function markBetaFeedbackBannerDismissed');
    const fn = APP_JS.slice(fnStart, fnStart + 200);
    assert.match(fn, /localStorage\.setItem/, 'must write to localStorage');
    assert.match(fn, /BETA_FEEDBACK_BANNER_KEY/, 'must use the key constant');
});

test('app.js: showBetaFeedbackBanner shows/hides based on shouldShowBetaFeedbackBanner', () => {
    const fnStart = APP_JS.indexOf('function showBetaFeedbackBanner');
    const fn = APP_JS.slice(fnStart, fnStart + 400);
    assert.match(fn, /shouldShowBetaFeedbackBanner/, 'must call shouldShowBetaFeedbackBanner');
    assert.match(fn, /has-beta-feedback-banner/, 'must toggle has-beta-feedback-banner class on body');
    assert.match(fn, /banner\.hidden\s*=\s*false/, 'must unhide banner when showing');
});

test('app.js: hideBetaFeedbackBanner removes class and hides element', () => {
    const fnStart = APP_JS.indexOf('function hideBetaFeedbackBanner');
    const fn = APP_JS.slice(fnStart, fnStart + 400);
    assert.match(fn, /markBetaFeedbackBannerDismissed/, 'must call markBetaFeedbackBannerDismissed when persist=true');
    assert.match(fn, /banner\.hidden\s*=\s*true/, 'must set banner.hidden = true');
    assert.match(fn, /has-beta-feedback-banner/, 'must remove has-beta-feedback-banner from body');
});

test('app.js: openBetaFeedbackFromBanner calls openHelpModal with feedback tab', () => {
    const fnStart = APP_JS.indexOf('function openBetaFeedbackFromBanner');
    const fn = APP_JS.slice(fnStart, fnStart + 300);
    assert.match(fn, /openHelpModal\(['"]feedback['"]\)/, "must call openHelpModal('feedback')");
    assert.match(fn, /handleHelpDropdownAction/, 'must fall back to handleHelpDropdownAction');
});

test('app.js: dismissBetaFeedbackBanner delegates to hideBetaFeedbackBanner(true)', () => {
    const fnStart = APP_JS.indexOf('function dismissBetaFeedbackBanner');
    const fn = APP_JS.slice(fnStart, fnStart + 150);
    assert.match(fn, /hideBetaFeedbackBanner\(true\)/, 'must call hideBetaFeedbackBanner(true)');
});

test('app.js: window globals exposed for banner', () => {
    assert.match(APP_JS, /window\.dismissBetaFeedbackBanner\s*=\s*dismissBetaFeedbackBanner/, 'must expose dismissBetaFeedbackBanner on window');
    assert.match(APP_JS, /window\.openBetaFeedbackFromBanner\s*=\s*openBetaFeedbackFromBanner/, 'must expose openBetaFeedbackFromBanner on window');
});

test('app.js: sendFeedback success branch calls hideBetaFeedbackBanner(true)', () => {
    const fnStart = APP_JS.indexOf('async function sendFeedback');
    const fn = APP_JS.slice(fnStart, fnStart + 1200);
    const successIdx = fn.indexOf('response.ok');
    const hideIdx    = fn.indexOf('hideBetaFeedbackBanner(true)');
    assert.ok(successIdx > -1, 'sendFeedback must check response.ok');
    assert.ok(hideIdx > -1, 'sendFeedback must call hideBetaFeedbackBanner(true)');
    assert.ok(hideIdx > successIdx, 'hideBetaFeedbackBanner call must be inside the success branch');
});

test('app.js: DOMContentLoaded handler calls showBetaFeedbackBanner', () => {
    assert.match(APP_JS, /DOMContentLoaded.*showBetaFeedbackBanner|showBetaFeedbackBanner.*DOMContentLoaded/, 'showBetaFeedbackBanner must be wired to DOMContentLoaded');
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

test('app.js: syncSidebarActionButton function exists and is exposed on window', () => {
    assert.match(APP_JS, /function syncSidebarActionButton\s*\(/, 'syncSidebarActionButton must be defined');
    assert.match(APP_JS, /window\.syncSidebarActionButton\s*=\s*syncSidebarActionButton/, 'must be exposed on window');
});

test('app.js: syncSidebarActionButton maps all-games context to Link Accounts', () => {
    const fnStart = APP_JS.indexOf('function syncSidebarActionButton');
    const fn = APP_JS.slice(fnStart, fnStart + 1200);
    assert.match(fn, /all-games.*Link Accounts|Link Accounts.*all-games/, 'all-games must map to Link Accounts');
    assert.match(fn, /ready.*Link Accounts|Link Accounts.*ready/, 'ready must map to Link Accounts');
    assert.match(fn, /home.*Link Accounts|Link Accounts.*home/, 'home must map to Link Accounts');
});

test('app.js: syncSidebarActionButton maps installed to Add Game', () => {
    const fnStart = APP_JS.indexOf('function syncSidebarActionButton');
    const fn = APP_JS.slice(fnStart, fnStart + 1200);
    assert.match(fn, /installed.*Add Game|Add Game.*installed/, 'installed must map to Add Game');
});

test('app.js: syncSidebarActionButton maps collections to New Collection', () => {
    const fnStart = APP_JS.indexOf('function syncSidebarActionButton');
    const fn = APP_JS.slice(fnStart, fnStart + 1200);
    assert.match(fn, /collections.*New Collection|New Collection.*collections/, 'collections must map to New Collection');
});

test('app.js: syncSidebarActionButton maps collection and favorites to Browse Installed Games', () => {
    const fnStart = APP_JS.indexOf('function syncSidebarActionButton');
    const fn = APP_JS.slice(fnStart, fnStart + 1200);
    assert.match(fn, /Browse Installed Games/, 'must have Browse Installed Games label');
    const collIdx = fn.indexOf("collection:");
    const favIdx  = fn.indexOf("favorites:");
    assert.ok(collIdx > -1, 'must have collection key in map');
    assert.ok(favIdx  > -1, 'must have favorites key in map');
});

test('app.js: syncSidebarActionButton sets data-context on the button', () => {
    const fnStart = APP_JS.indexOf('function syncSidebarActionButton');
    const fn = APP_JS.slice(fnStart, fnStart + 1600);
    assert.match(fn, /dataset\.context\s*=\s*ctx/, 'must set btn.dataset.context = ctx');
});

test('app.js: updateSbContextBtn delegates to syncSidebarActionButton', () => {
    const fnStart = APP_JS.indexOf('function updateSbContextBtn');
    const fn = APP_JS.slice(fnStart, fnStart + 200);
    assert.match(fn, /syncSidebarActionButton\(\)/, 'updateSbContextBtn must call syncSidebarActionButton');
    assert.doesNotMatch(fn, /textContent/, 'updateSbContextBtn must not set textContent directly');
});

test('app.js: handleSidebarContextBtn handles favorites context by navigating to installed', () => {
    const fnStart = APP_JS.indexOf('function handleSidebarContextBtn');
    const fn = APP_JS.slice(fnStart, fnStart + 1400);
    const favIdx = fn.indexOf("'favorites'");
    const navIdx = fn.indexOf('navigateToInstalled', favIdx > -1 ? favIdx : 0);
    assert.ok(favIdx > -1, "must check ctx === 'favorites'");
    assert.ok(navIdx > -1, 'must call navigateToInstalled for favorites');
});

test('app.js: navigateToHome calls syncSidebarActionButton after updateSidebarActiveState', () => {
    const fnStart = APP_JS.indexOf('function navigateToHome');
    const fn = APP_JS.slice(fnStart, fnStart + 800);
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
    const fn = ACC_JS.slice(fnStart, fnStart + 2300);
    assert.match(fn, /syncSidebarActionButton/, 'navigateToAllGames must call syncSidebarActionButton');
    // The call must come AFTER display = 'block'
    const showIdx = fn.indexOf("view.style.display = 'block'");
    const syncIdx = fn.indexOf('syncSidebarActionButton', showIdx > -1 ? showIdx : 0);
    assert.ok(showIdx > -1, 'navigateToAllGames must set view display block');
    assert.ok(syncIdx > showIdx, 'syncSidebarActionButton must be called after view is shown');
});

test('app.js: getSidebarActionContext returns home for home view', () => {
    const fnStart = APP_JS.indexOf('function getSidebarActionContext');
    const fn = APP_JS.slice(fnStart, fnStart + 1800);
    assert.match(fn, /currentView === 'home'/, "must handle home view");
    assert.match(fn, /return 'home'/, "must return 'home'");
});

// ── Sidebar context button label correctness ──────────────────────────────────

test('app.js: syncSidebarActionButton maps all-games to "Link Accounts"', () => {
    const fnStart = APP_JS.indexOf('function syncSidebarActionButton');
    const fn = APP_JS.slice(fnStart, fnStart + 1000);
    assert.match(fn, /'all-games'/, 'all-games key in label map');
    // Extract the text value for all-games entry
    const allGamesIdx = fn.indexOf("'all-games'");
    const snippet = fn.slice(allGamesIdx, allGamesIdx + 80);
    assert.match(snippet, /Link Accounts/, 'all-games must map to Link Accounts');
});

test('app.js: syncSidebarActionButton maps ready to "Link Accounts"', () => {
    const fnStart = APP_JS.indexOf('function syncSidebarActionButton');
    const fn = APP_JS.slice(fnStart, fnStart + 1000);
    // key is unquoted: ready: { text: 'Link Accounts', ... }
    const readyIdx = fn.indexOf('ready:');
    assert.ok(readyIdx > -1, 'ready key in label map');
    const snippet = fn.slice(readyIdx, readyIdx + 80);
    assert.match(snippet, /Link Accounts/, 'ready must map to Link Accounts');
});

test('app.js: syncSidebarActionButton maps installed to "Add Game", not "Link Accounts"', () => {
    const fnStart = APP_JS.indexOf('function syncSidebarActionButton');
    const fn = APP_JS.slice(fnStart, fnStart + 1000);
    // key is unquoted: installed: { text: 'Add Game', ... }
    const installedIdx = fn.indexOf('installed:');
    assert.ok(installedIdx > -1, 'installed key in label map');
    const snippet = fn.slice(installedIdx, installedIdx + 80);
    assert.match(snippet, /Add Game/, 'installed must map to Add Game');
    assert.doesNotMatch(snippet, /Link Accounts/, 'installed must not say Link Accounts');
});

test('app.js: syncSidebarActionButton default fallback is "Link Accounts"', () => {
    const fnStart = APP_JS.indexOf('function syncSidebarActionButton');
    const fn = APP_JS.slice(fnStart, fnStart + 1000);
    // fallback via _map.library — key is unquoted: library: { text: 'Link Accounts', ... }
    const libIdx = fn.indexOf('library:');
    assert.ok(libIdx > -1, 'library key in label map');
    const snippet = fn.slice(libIdx, libIdx + 80);
    assert.match(snippet, /Link Accounts/, 'library fallback must be Link Accounts');
});

test('accounts.js: navigateToAllGames sets currentView to all-games before syncing button', () => {
    const fnStart = ACC_JS.indexOf('async function navigateToAllGames');
    const fn = ACC_JS.slice(fnStart, fnStart + 3000);
    assert.match(fn, /currentView\s*=\s*'all-games'/, "must set currentView = 'all-games'");
    // Must appear before the first syncSidebarActionButton call
    const cvIdx   = fn.indexOf("currentView = 'all-games'");
    const syncIdx = fn.indexOf('syncSidebarActionButton');
    assert.ok(cvIdx > -1,  'currentView assignment present');
    assert.ok(syncIdx > -1, 'syncSidebarActionButton call present');
    assert.ok(cvIdx < syncIdx, 'currentView must be set before syncSidebarActionButton');
});

test('app.js: getSidebarActionContext handles all-games when currentView is all-games', () => {
    const fnStart = APP_JS.indexOf('function getSidebarActionContext');
    const fn = APP_JS.slice(fnStart, fnStart + 1800);
    assert.match(fn, /currentView === 'all-games'/, "handles all-games view via currentView");
});

test('app.js: getSidebarActionContext installed branch requires BOTH installedVisible and currentView', () => {
    const fnStart = APP_JS.indexOf('function getSidebarActionContext');
    const fn = APP_JS.slice(fnStart, fnStart + 1800);
    // The installed branch should depend on currentView === 'installed' so navigating
    // away from installed (which changes currentView) stops returning 'installed'.
    const installedReturn = fn.slice(fn.indexOf("return 'installed'") - 150, fn.indexOf("return 'installed'") + 20);
    assert.match(installedReturn, /currentView/, "installed return must check currentView");
});
