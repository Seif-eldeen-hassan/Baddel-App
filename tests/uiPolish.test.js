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
    const fn = ACC_JS.slice(fnStart, fnStart + 5500);
    assert.match(fn, /_agMaybeRenderEmptyOnboarding/, '_agMaybeRenderEmptyOnboarding called in navigateToAllGames');
    // Must appear before renderAllGamesView call
    const maybeIdx  = fn.indexOf('_agMaybeRenderEmptyOnboarding');
    const renderIdx = fn.indexOf('renderAllGamesView');
    assert.ok(maybeIdx < renderIdx, '_agMaybeRenderEmptyOnboarding must precede renderAllGamesView');
});

test('accounts.js: renderAllGamesView calls _agMaybeRenderEmptyOnboarding after building cache', () => {
    const fnStart = ACC_JS.indexOf('window.renderAllGamesView = async function');
    const fn = ACC_JS.slice(fnStart, fnStart + 5500);
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
    const fn = ACC_JS.slice(fnStart, fnStart + 5000);
    assert.match(fn, /_agGetUserLibraryGames\(window\._allGamesCache\)/, 'must call _agGetUserLibraryGames on existing cache');
    // The early-return must only fire if libraryCache.length > 0
    const checkIdx  = fn.indexOf('_agGetUserLibraryGames(window._allGamesCache)');
    const returnIdx = fn.indexOf('libraryCache.length > 0');
    assert.ok(returnIdx > checkIdx, 'length check must follow _agGetUserLibraryGames call');
});

test('accounts.js: navigateToAllGames checks platformSyncStatus BEFORE using cache (no-account gate)', () => {
    const fnStart = ACC_JS.indexOf('async function navigateToAllGames');
    const fn = ACC_JS.slice(fnStart, fnStart + 5000);
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
    const fn = ACC_JS.slice(fnStart, fnStart + 5000);
    assert.match(fn, /window\._allGamesRawCache/, '_allGamesRawCache must be set in renderAllGamesView');
});

test('accounts.js: renderAllGamesView assigns filtered cache to _allGamesCache', () => {
    const fnStart = ACC_JS.indexOf('window.renderAllGamesView = async function');
    const fn = ACC_JS.slice(fnStart, fnStart + 5000);
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
    const handlerIdx = MAIN_JS.indexOf("ipcMain.handle('delete-game-permanently'");
    const handler = MAIN_JS.slice(handlerIdx, handlerIdx + 600);
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
    const fn = ACC_JS.slice(fnStart, fnStart + 4500);
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
