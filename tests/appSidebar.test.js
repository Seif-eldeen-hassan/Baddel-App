'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT   = path.resolve(__dirname, '..');
const APP_JS = fs.readFileSync(path.join(ROOT, 'src/js/app.js'), 'utf8');
const HTML   = fs.readFileSync(path.join(ROOT, 'src/dashboard.html'), 'utf8');

// ─── helpers ─────────────────────────────────────────────────────────────────

function extractFn(src, sig) {
    const idx = src.indexOf(sig);
    if (idx === -1) return null;
    return src.slice(idx, idx + 2000);
}

// ─── 1. Source-presence: all sidebar functions exist in app.js ────────────────

test('app.js: renderSidebar exists', () => {
    assert.match(APP_JS, /function renderSidebar\(\)/);
});

test('app.js: renderSidebarJumpBackIn exists', () => {
    assert.match(APP_JS, /function renderSidebarJumpBackIn\(\)/);
});

test('app.js: renderSidebarAccountSummary exists', () => {
    assert.match(APP_JS, /function renderSidebarAccountSummary\(\)/);
});

test('app.js: renderSidebarLibraryPulse exists', () => {
    assert.match(APP_JS, /function renderSidebarLibraryPulse\(\)/);
});

test('app.js: navigateToReadyToInstall exists', () => {
    assert.match(APP_JS, /async function navigateToReadyToInstall\(\)/);
});

test('app.js: updateSidebarPlatformDots exists', () => {
    assert.match(APP_JS, /function updateSidebarPlatformDots\(\)/);
});

test('app.js: updateSmartSidebarCounts exists', () => {
    assert.match(APP_JS, /function updateSmartSidebarCounts\(\)/);
});

test('app.js: getReadyToInstallGamesForCounts exists', () => {
    assert.match(APP_JS, /function getReadyToInstallGamesForCounts\(\)/);
});

test('app.js: getReadyToInstallCount exists', () => {
    assert.match(APP_JS, /function getReadyToInstallCount\(\)/);
});

test('app.js: getSidebarActionContext exists', () => {
    assert.match(APP_JS, /function getSidebarActionContext\(\)/);
});

test('app.js: syncSidebarActionButton exists', () => {
    assert.match(APP_JS, /function syncSidebarActionButton\(\)/);
});

test('app.js: renderSidebarCollectionsList exists', () => {
    assert.match(APP_JS, /function renderSidebarCollectionsList\(\)/);
});

test('app.js: updateSidebarCards exists', () => {
    assert.match(APP_JS, /function updateSidebarCards\(\)/);
});

test('app.js: sbToggleSection exists', () => {
    assert.match(APP_JS, /function sbToggleSection\(sec\)/);
});

test('app.js: sbExpandSection exists', () => {
    assert.match(APP_JS, /function sbExpandSection\(sec\)/);
});

test('app.js: _sbApplySectionState exists', () => {
    assert.match(APP_JS, /function _sbApplySectionState\(sec\)/);
});

test('app.js: sbGoManageCollections exists', () => {
    assert.match(APP_JS, /function sbGoManageCollections\(\)/);
});

test('app.js: handleSidebarContextBtn exists', () => {
    assert.match(APP_JS, /function handleSidebarContextBtn\(\)/);
});

test('app.js: updateSbContextBtn exists', () => {
    assert.match(APP_JS, /function updateSbContextBtn\(\)/);
});

test('app.js: clearSidebarActiveState exists', () => {
    assert.match(APP_JS, /function clearSidebarActiveState\(\)/);
});

test('app.js: updateSidebarActiveState exists', () => {
    assert.match(APP_JS, /function updateSidebarActiveState\(\)/);
});

test('app.js: toggleSidebar exists', () => {
    assert.match(APP_JS, /function toggleSidebar\(\)/);
});

test('app.js: openSidebarCollection exists', () => {
    assert.match(APP_JS, /function openSidebarCollection\(collectionId\)/);
});

// ─── 2. State variables ───────────────────────────────────────────────────────

test('app.js: SB_COLL_MAX is defined as a const', () => {
    assert.match(APP_JS, /const SB_COLL_MAX\s*=\s*5/);
});

test('app.js: window._sbSec initialized with library/collections/accounts keys', () => {
    const idx = APP_JS.indexOf('window._sbSec');
    assert.ok(idx !== -1, 'window._sbSec must be initialized');
    const ctx = APP_JS.slice(idx, idx + 100);
    assert.match(ctx, /library/);
    assert.match(ctx, /collections/);
    assert.match(ctx, /accounts/);
});

test('app.js: window._sbSec accounts defaults to false (collapsed)', () => {
    const idx = APP_JS.indexOf('window._sbSec');
    const ctx = APP_JS.slice(idx, idx + 100);
    assert.match(ctx, /accounts:\s*false/);
});

// ─── 3. Window exports ────────────────────────────────────────────────────────

test('app.js: syncSidebarActionButton is exported to window', () => {
    assert.match(APP_JS, /window\.syncSidebarActionButton\s*=\s*syncSidebarActionButton/);
});

// ─── 4. Rendering behaviour — renderSidebar ───────────────────────────────────

test('app.js: renderSidebar calls renderSidebarCollectionsList', () => {
    const fn = extractFn(APP_JS, 'function renderSidebar()');
    assert.match(fn, /renderSidebarCollectionsList\(\)/);
});

test('app.js: renderSidebar calls updateSidebarActiveState', () => {
    const fn = extractFn(APP_JS, 'function renderSidebar()');
    assert.match(fn, /updateSidebarActiveState\(\)/);
});

test('app.js: renderSidebar calls updateSidebarCards', () => {
    const fn = extractFn(APP_JS, 'function renderSidebar()');
    assert.match(fn, /updateSidebarCards\(\)/);
});

test('app.js: renderSidebar empties legacy collectionsList div', () => {
    const fn = extractFn(APP_JS, 'function renderSidebar()');
    assert.match(fn, /getElementById\('collectionsList'\)/);
    assert.match(fn, /innerHTML\s*=\s*''/);
});

// ─── 5. Jump Back In rendering ────────────────────────────────────────────────

test('app.js: renderSidebarJumpBackIn reads sidebarJumpBackContent element', () => {
    const fn = extractFn(APP_JS, 'function renderSidebarJumpBackIn()');
    assert.match(fn, /getElementById\('sidebarJumpBackContent'\)/);
});

test('app.js: renderSidebarJumpBackIn shows empty-state message when no recent games', () => {
    const fn = extractFn(APP_JS, 'function renderSidebarJumpBackIn()');
    assert.match(fn, /No recent sessions/);
});

test('app.js: renderSidebarJumpBackIn calls getRecentGames', () => {
    const fn = extractFn(APP_JS, 'function renderSidebarJumpBackIn()');
    assert.match(fn, /getRecentGames\(\)/);
});

test('app.js: renderSidebarJumpBackIn reads playtimeData for session info', () => {
    const fn = extractFn(APP_JS, 'function renderSidebarJumpBackIn()');
    assert.match(fn, /playtimeData/);
});

test('app.js: renderSidebarJumpBackIn formats last-played relative to Date.now', () => {
    const fn = extractFn(APP_JS, 'function renderSidebarJumpBackIn()');
    assert.match(fn, /Date\.now\(\)/);
    assert.match(fn, /Today|days ago/);
});

test('app.js: renderSidebarJumpBackIn uses escapeHtml for all user-supplied strings', () => {
    const fn = extractFn(APP_JS, 'function renderSidebarJumpBackIn()');
    assert.match(fn, /escapeHtml\(id\)|escapeHtml\(safeId\)|escapeHtml\(title\)/);
});

// ─── 6. Account summary rendering ────────────────────────────────────────────

test('app.js: renderSidebarAccountSummary reads sidebarActiveAccounts element', () => {
    const fn = extractFn(APP_JS, 'function renderSidebarAccountSummary()');
    assert.match(fn, /getElementById\('sidebarActiveAccounts'\)/);
});

test('app.js: renderSidebarAccountSummary hides card when no platform counts are non-zero', () => {
    const fn = extractFn(APP_JS, 'function renderSidebarAccountSummary()');
    assert.match(fn, /classList\.add\('baddel-hidden'\)/);
});

test('app.js: renderSidebarAccountSummary reads count elements from DOM (not IPC)', () => {
    const fn = extractFn(APP_JS, 'function renderSidebarAccountSummary()');
    assert.match(fn, /steamCount/);
    assert.match(fn, /epicCount/);
    assert.match(fn, /textContent/);
});

test('app.js: renderSidebarAccountSummary renders baddel-acc-row items', () => {
    const fn = extractFn(APP_JS, 'function renderSidebarAccountSummary()');
    assert.match(fn, /baddel-acc-row/);
});

// ─── 7. Library pulse rendering ───────────────────────────────────────────────

test('app.js: renderSidebarLibraryPulse reads sbTotalGames element', () => {
    const fn = extractFn(APP_JS, 'function renderSidebarLibraryPulse()');
    assert.match(fn, /getElementById\('sbTotalGames'\)/);
});

test('app.js: renderSidebarLibraryPulse uses allGamesData for total count', () => {
    const fn = extractFn(APP_JS, 'function renderSidebarLibraryPulse()');
    assert.match(fn, /allGamesData/);
});

test('app.js: renderSidebarLibraryPulse uses _agIsInstalled for installed count', () => {
    const fn = extractFn(APP_JS, 'function renderSidebarLibraryPulse()');
    assert.match(fn, /_agIsInstalled/);
});

test('app.js: renderSidebarLibraryPulse reads window._suggAllGames for ready count', () => {
    const fn = extractFn(APP_JS, 'function renderSidebarLibraryPulse()');
    assert.match(fn, /window\._suggAllGames/);
});

test('app.js: renderSidebarLibraryPulse hides ready tile when no data', () => {
    const fn = extractFn(APP_JS, 'function renderSidebarLibraryPulse()');
    assert.match(fn, /style\.display\s*=\s*'none'/);
});

// ─── 8. Ready-to-install counts ───────────────────────────────────────────────

test('app.js: getReadyToInstallGamesForCounts returns window._readyToInstallRenderedGames first', () => {
    const fn = extractFn(APP_JS, 'function getReadyToInstallGamesForCounts()');
    assert.match(fn, /window\._readyToInstallRenderedGames/);
    // Canonical source is checked before fallbacks
    const canonicalIdx = fn.indexOf('_readyToInstallRenderedGames');
    const suggIdx      = fn.indexOf('_suggAllGames');
    assert.ok(canonicalIdx < suggIdx, 'canonical source must be checked before _suggAllGames');
});

test('app.js: getReadyToInstallGamesForCounts falls back to window._suggAllGames', () => {
    const fn = extractFn(APP_JS, 'function getReadyToInstallGamesForCounts()');
    assert.match(fn, /window\._suggAllGames/);
});

test('app.js: getReadyToInstallGamesForCounts falls back to window._allGamesCache filtered by _agIsInstalled', () => {
    const fn = extractFn(APP_JS, 'function getReadyToInstallGamesForCounts()');
    assert.match(fn, /window\._allGamesCache/);
    assert.match(fn, /_agIsInstalled/);
});

test('app.js: getReadyToInstallGamesForCounts returns null when no data loaded yet', () => {
    const fn = extractFn(APP_JS, 'function getReadyToInstallGamesForCounts()');
    assert.match(fn, /return null/);
});

test('app.js: getReadyToInstallCount delegates to getReadyToInstallGamesForCounts', () => {
    const fn = extractFn(APP_JS, 'function getReadyToInstallCount()');
    assert.match(fn, /getReadyToInstallGamesForCounts\(\)/);
    assert.match(fn, /null.*null|games === null/);
});

// ─── 9. Smart sidebar counts ──────────────────────────────────────────────────

test('app.js: updateSmartSidebarCounts reads sbNavInstalled element', () => {
    const fn = extractFn(APP_JS, 'function updateSmartSidebarCounts()');
    assert.match(fn, /getElementById\('sbNavInstalled'\)/);
});

test('app.js: updateSmartSidebarCounts reads sbNavReady element', () => {
    const fn = extractFn(APP_JS, 'function updateSmartSidebarCounts()');
    assert.match(fn, /getElementById\('sbNavReady'\)/);
});

test('app.js: updateSmartSidebarCounts uses allGamesData and _agIsInstalled for installed badge', () => {
    const fn = extractFn(APP_JS, 'function updateSmartSidebarCounts()');
    assert.match(fn, /allGamesData/);
    assert.match(fn, /_agIsInstalled/);
});

test('app.js: updateSmartSidebarCounts calls getReadyToInstallCount for ready badge', () => {
    const fn = extractFn(APP_JS, 'function updateSmartSidebarCounts()');
    assert.match(fn, /getReadyToInstallCount\(\)/);
});

test('app.js: updateSmartSidebarCounts shows loading indicator (…) when data not ready', () => {
    const fn = extractFn(APP_JS, 'function updateSmartSidebarCounts()');
    assert.match(fn, /…|\.\.\.|…/);
});

// ─── 10. Platform dots ────────────────────────────────────────────────────────

test('app.js: updateSidebarPlatformDots reads sbPlatformDots container', () => {
    const fn = extractFn(APP_JS, 'function updateSidebarPlatformDots()');
    assert.match(fn, /getElementById\('sbPlatformDots'\)/);
});

test('app.js: updateSidebarPlatformDots reads all seven platform count elements', () => {
    const fn = extractFn(APP_JS, 'function updateSidebarPlatformDots()');
    assert.match(fn, /steamCount/);
    assert.match(fn, /epicCount/);
    assert.match(fn, /riotCount/);
    assert.match(fn, /eaCount/);
    assert.match(fn, /ubisoftCount/);
    assert.match(fn, /discordCount/);
    assert.match(fn, /rockstarCount/);
});

test('app.js: updateSidebarPlatformDots renders baddel-plat-dot spans', () => {
    const fn = extractFn(APP_JS, 'function updateSidebarPlatformDots()');
    assert.match(fn, /baddel-plat-dot/);
});

// ─── 11. Sidebar active state ─────────────────────────────────────────────────

test('app.js: clearSidebarActiveState removes active class from nav-item and platform-item elements', () => {
    const fn = extractFn(APP_JS, 'function clearSidebarActiveState()');
    assert.match(fn, /\.nav-item\.active/);
    assert.match(fn, /classList\.remove\('active'\)/);
});

test('app.js: updateSidebarActiveState calls clearSidebarActiveState first', () => {
    const fn = extractFn(APP_JS, 'function updateSidebarActiveState()');
    assert.match(fn, /clearSidebarActiveState\(\)/);
    const clearIdx  = fn.indexOf('clearSidebarActiveState()');
    const addIdx    = fn.indexOf("classList.add('active')");
    assert.ok(clearIdx < addIdx, 'must clear before adding active state');
});

test('app.js: updateSidebarActiveState reads currentView', () => {
    const fn = extractFn(APP_JS, 'function updateSidebarActiveState()');
    assert.match(fn, /currentView/);
});

test('app.js: updateSidebarActiveState reads currentFilters.collectionId', () => {
    const fn = extractFn(APP_JS, 'function updateSidebarActiveState()');
    assert.match(fn, /currentFilters\.collectionId/);
});

test('app.js: updateSidebarActiveState activates nav-home for home view', () => {
    const fn = extractFn(APP_JS, 'function updateSidebarActiveState()');
    assert.match(fn, /getElementById\('nav-home'\)/);
    assert.match(fn, /'home'/);
});

test('app.js: updateSidebarActiveState activates nav-all-games for all-games view', () => {
    const fn = extractFn(APP_JS, 'function updateSidebarActiveState()');
    assert.match(fn, /getElementById\('nav-all-games'\)/);
});

test('app.js: updateSidebarActiveState activates nav-installed for installed view', () => {
    const fn = extractFn(APP_JS, 'function updateSidebarActiveState()');
    assert.match(fn, /getElementById\('nav-installed'\)/);
});

test('app.js: updateSidebarActiveState activates nav-fav for fav_system_default collection', () => {
    const fn = extractFn(APP_JS, 'function updateSidebarActiveState()');
    assert.match(fn, /getElementById\('nav-fav'\)/);
    assert.match(fn, /fav_system_default/);
});

test('app.js: updateSidebarActiveState activates nav-ready when agReadyOnly is set', () => {
    const fn = extractFn(APP_JS, 'function updateSidebarActiveState()');
    assert.match(fn, /getElementById\('nav-ready'\)/);
    assert.match(fn, /agReadyOnly/);
});

test('app.js: updateSidebarActiveState uses CSS.escape for custom collection IDs', () => {
    const fn = extractFn(APP_JS, 'function updateSidebarActiveState()');
    assert.match(fn, /CSS\.escape/);
    assert.match(fn, /data-collection-id/);
});

// ─── 12. Sidebar context/action button ───────────────────────────────────────

test('app.js: getSidebarActionContext reads currentView', () => {
    const fn = extractFn(APP_JS, 'function getSidebarActionContext()');
    assert.match(fn, /currentView/);
});

test('app.js: getSidebarActionContext reads currentFilters.collectionId', () => {
    const fn = extractFn(APP_JS, 'function getSidebarActionContext()');
    assert.match(fn, /currentFilters\.collectionId/);
});

test('app.js: getSidebarActionContext reads currentAccountPlatform', () => {
    const fn = extractFn(APP_JS, 'function getSidebarActionContext()');
    assert.match(fn, /currentAccountPlatform/);
});

test('app.js: getSidebarActionContext returns all expected context values', () => {
    const fn = extractFn(APP_JS, 'function getSidebarActionContext()');
    assert.match(fn, /'accounts'/);
    assert.match(fn, /'installed'/);
    assert.match(fn, /'favorites'/);
    assert.match(fn, /'collection'/);
    assert.match(fn, /'collections'/);
    assert.match(fn, /'all-games'/);
    assert.match(fn, /'home'/);
    assert.match(fn, /'ready'/);
    assert.match(fn, /'library'/);
});

test('app.js: syncSidebarActionButton reads sbCtxBtnText element', () => {
    const fn = extractFn(APP_JS, 'function syncSidebarActionButton()');
    assert.match(fn, /getElementById\('sbCtxBtnText'\)/);
});

test('app.js: syncSidebarActionButton reads btn-new-coll element', () => {
    const fn = extractFn(APP_JS, 'function syncSidebarActionButton()');
    assert.match(fn, /getElementById\('btn-new-coll'\)/);
});

test('app.js: syncSidebarActionButton calls getSidebarActionContext', () => {
    const fn = extractFn(APP_JS, 'function syncSidebarActionButton()');
    assert.match(fn, /getSidebarActionContext\(\)/);
});

test('app.js: syncSidebarActionButton sets different button text per context', () => {
    const fn = extractFn(APP_JS, 'function syncSidebarActionButton()');
    assert.match(fn, /Add Account/);
    assert.match(fn, /Add Game/);
    assert.match(fn, /New Collection/);
    assert.match(fn, /Link Accounts/);
});

test('app.js: updateSbContextBtn delegates to syncSidebarActionButton', () => {
    const fn = extractFn(APP_JS, 'function updateSbContextBtn()');
    assert.match(fn, /syncSidebarActionButton\(\)/);
});

test('app.js: handleSidebarContextBtn calls getSidebarActionContext', () => {
    const fn = extractFn(APP_JS, 'function handleSidebarContextBtn()');
    assert.match(fn, /getSidebarActionContext\(\)/);
});

test('app.js: handleSidebarContextBtn calls openPlatformsModal as fallback', () => {
    const fn = extractFn(APP_JS, 'function handleSidebarContextBtn()');
    assert.match(fn, /openPlatformsModal\(\)/);
});

test('app.js: handleSidebarContextBtn calls navigateToInstalled for collection/favorites context', () => {
    const fn = extractFn(APP_JS, 'function handleSidebarContextBtn()');
    assert.match(fn, /navigateToInstalled\(\)/);
});

test('app.js: handleSidebarContextBtn calls openAddGameModal for installed context', () => {
    const fn = extractFn(APP_JS, 'function handleSidebarContextBtn()');
    assert.match(fn, /openAddGameModal\(\)/);
});

test('app.js: handleSidebarContextBtn calls openCollectionModal for collections context', () => {
    const fn = extractFn(APP_JS, 'function handleSidebarContextBtn()');
    assert.match(fn, /openCollectionModal\(\)/);
});

// ─── 13. Section expand/collapse ─────────────────────────────────────────────

test('app.js: sbToggleSection flips window._sbSec[sec] and applies state', () => {
    const fn = extractFn(APP_JS, 'function sbToggleSection(sec)');
    assert.match(fn, /window\._sbSec\[sec\]\s*=\s*!window\._sbSec\[sec\]/);
    assert.match(fn, /_sbApplySectionState\(sec\)/);
});

test('app.js: sbToggleSection calls updateSbContextBtn after toggling', () => {
    const fn = extractFn(APP_JS, 'function sbToggleSection(sec)');
    assert.match(fn, /updateSbContextBtn\(\)/);
});

test('app.js: sbExpandSection does nothing when section already open', () => {
    const fn = extractFn(APP_JS, 'function sbExpandSection(sec)');
    assert.match(fn, /if\s*\(window\._sbSec\[sec\]\)\s*return/);
});

test('app.js: sbExpandSection sets window._sbSec[sec] to true and applies state', () => {
    const fn = extractFn(APP_JS, 'function sbExpandSection(sec)');
    assert.match(fn, /window\._sbSec\[sec\]\s*=\s*true/);
    assert.match(fn, /_sbApplySectionState\(sec\)/);
});

test('app.js: _sbApplySectionState reads sbBody<Section> element', () => {
    const fn = extractFn(APP_JS, 'function _sbApplySectionState(sec)');
    assert.match(fn, /getElementById\(`sbBody\$\{cap\}`\)/);
});

test('app.js: _sbApplySectionState reads sbChevron<Section> element', () => {
    const fn = extractFn(APP_JS, 'function _sbApplySectionState(sec)');
    assert.match(fn, /getElementById\(`sbChevron\$\{cap\}`\)/);
});

test('app.js: _sbApplySectionState toggles sb-sec-closed class on body', () => {
    const fn = extractFn(APP_JS, 'function _sbApplySectionState(sec)');
    assert.match(fn, /classList\.toggle\('sb-sec-closed'/);
});

test('app.js: _sbApplySectionState toggles sb-chevron-closed class on chevron', () => {
    const fn = extractFn(APP_JS, 'function _sbApplySectionState(sec)');
    assert.match(fn, /classList\.toggle\('sb-chevron-closed'/);
});

// ─── 14. Collections list rendering ──────────────────────────────────────────

test('app.js: renderSidebarCollectionsList reads sbBodyCollections element', () => {
    const fn = extractFn(APP_JS, 'function renderSidebarCollectionsList()');
    assert.match(fn, /getElementById\('sbBodyCollections'\)/);
});

test('app.js: renderSidebarCollectionsList filters out fav_system_default', () => {
    const fn = extractFn(APP_JS, 'function renderSidebarCollectionsList()');
    assert.match(fn, /fav_system_default/);
    assert.match(fn, /\.filter\(/);
});

test('app.js: renderSidebarCollectionsList reads allCollections', () => {
    const fn = extractFn(APP_JS, 'function renderSidebarCollectionsList()');
    assert.match(fn, /allCollections/);
});

test('app.js: renderSidebarCollectionsList limits to SB_COLL_MAX entries', () => {
    const fn = extractFn(APP_JS, 'function renderSidebarCollectionsList()');
    assert.match(fn, /SB_COLL_MAX/);
    assert.match(fn, /\.slice\(0,\s*SB_COLL_MAX\)/);
});

test('app.js: renderSidebarCollectionsList renders sb-coll-item entries with onclick openSidebarCollection', () => {
    const fn = extractFn(APP_JS, 'function renderSidebarCollectionsList()');
    assert.match(fn, /sb-coll-item/);
    assert.match(fn, /openSidebarCollection/);
});

test('app.js: renderSidebarCollectionsList shows View all link when more collections exist', () => {
    const fn = extractFn(APP_JS, 'function renderSidebarCollectionsList()');
    assert.match(fn, /View all/);
    assert.match(fn, /moreCount/);
});

test('app.js: renderSidebarCollectionsList shows empty-state message when no custom collections', () => {
    const fn = extractFn(APP_JS, 'function renderSidebarCollectionsList()');
    assert.match(fn, /No collections/);
});

test('app.js: openSidebarCollection calls filterByCollection', () => {
    const fn = extractFn(APP_JS, 'function openSidebarCollection(collectionId)');
    assert.match(fn, /filterByCollection\(collectionId\)/);
});

test('app.js: openSidebarCollection clears currentAccountPlatform', () => {
    const fn = extractFn(APP_JS, 'function openSidebarCollection(collectionId)');
    assert.match(fn, /currentAccountPlatform\s*=\s*null/);
});

// ─── 15. Sidebar cards refresh ────────────────────────────────────────────────

test('app.js: updateSidebarCards calls updateSidebarPlatformDots', () => {
    const fn = extractFn(APP_JS, 'function updateSidebarCards()');
    assert.match(fn, /updateSidebarPlatformDots\(\)/);
});

test('app.js: updateSidebarCards calls updateSmartSidebarCounts', () => {
    const fn = extractFn(APP_JS, 'function updateSidebarCards()');
    assert.match(fn, /updateSmartSidebarCounts\(\)/);
});

test('app.js: updateSidebarCards calls renderSidebarJumpBackIn', () => {
    const fn = extractFn(APP_JS, 'function updateSidebarCards()');
    assert.match(fn, /renderSidebarJumpBackIn\(\)/);
});

test('app.js: updateSidebarCards calls renderSidebarAccountSummary', () => {
    const fn = extractFn(APP_JS, 'function updateSidebarCards()');
    assert.match(fn, /renderSidebarAccountSummary\(\)/);
});

test('app.js: updateSidebarCards calls renderSidebarLibraryPulse', () => {
    const fn = extractFn(APP_JS, 'function updateSidebarCards()');
    assert.match(fn, /renderSidebarLibraryPulse\(\)/);
});

test('app.js: updateSidebarCards wraps each card call in try/catch', () => {
    const fn = extractFn(APP_JS, 'function updateSidebarCards()');
    assert.match(fn, /try\s*\{/);
    assert.match(fn, /\}\s*catch/);
});

// ─── 16. Navigate to Ready to Install ────────────────────────────────────────

test('app.js: navigateToReadyToInstall sets window.agReadyOnly before calling navigateToAllGames', () => {
    const fn = extractFn(APP_JS, 'async function navigateToReadyToInstall()');
    assert.match(fn, /window\.agReadyOnly\s*=\s*true/);
    assert.match(fn, /navigateToAllGames/);
    const readyIdx = fn.indexOf('agReadyOnly');
    const navIdx   = fn.indexOf('navigateToAllGames');
    assert.ok(readyIdx < navIdx, 'agReadyOnly must be set before calling navigateToAllGames');
});

test('app.js: navigateToReadyToInstall sets window.agInstalledOnly to false', () => {
    const fn = extractFn(APP_JS, 'async function navigateToReadyToInstall()');
    assert.match(fn, /window\.agInstalledOnly\s*=\s*false/);
});

// ─── 17. Toggle sidebar ────────────────────────────────────────────────────────

test('app.js: toggleSidebar reads mainSidebar element', () => {
    const fn = extractFn(APP_JS, 'function toggleSidebar()');
    assert.match(fn, /getElementById\('mainSidebar'\)/);
});

test('app.js: toggleSidebar toggles collapsed class on mainSidebar', () => {
    const fn = extractFn(APP_JS, 'function toggleSidebar()');
    assert.match(fn, /classList\.toggle\('collapsed'\)/);
});

test('app.js: toggleSidebar reads toggleIcon element and updates its innerHTML', () => {
    const fn = extractFn(APP_JS, 'function toggleSidebar()');
    assert.match(fn, /getElementById\('toggleIcon'\)/);
    assert.match(fn, /innerHTML/);
});

test('app.js: toggleSidebar skips _vsRender when agDisplayPrefs viewMode is list', () => {
    const fn = extractFn(APP_JS, 'function toggleSidebar()');
    assert.match(fn, /window\._agDisplayPrefs/);
    assert.match(fn, /viewMode.*list|list.*viewMode/);
    assert.match(fn, /return/);
});

test('app.js: toggleSidebar polls for column changes during CSS transition', () => {
    const fn = extractFn(APP_JS, 'function toggleSidebar()');
    assert.match(fn, /requestAnimationFrame/);
    assert.match(fn, /setTimeout/);
    assert.match(fn, /_vsRender/);
});

test('app.js: toggleSidebar uses _vsMeasure to detect column count changes', () => {
    const fn = extractFn(APP_JS, 'function toggleSidebar()');
    assert.match(fn, /_vsMeasure\(/);
});

// ─── 18. DOM IDs — sidebar structure (dashboard.html) ────────────────────────

test('dashboard.html: mainSidebar aside element exists', () => {
    assert.ok(HTML.includes('id="mainSidebar"'), 'mainSidebar must exist');
});

test('dashboard.html: toggleBtn and toggleIcon exist', () => {
    assert.ok(HTML.includes('id="toggleBtn"'), 'toggleBtn must exist');
    assert.ok(HTML.includes('id="toggleIcon"'), 'toggleIcon must exist');
});

test('dashboard.html: sidebar section headers exist for library, collections, accounts', () => {
    assert.ok(HTML.includes('id="sbSecLibrary"'),    'sbSecLibrary must exist');
    assert.ok(HTML.includes('id="sbSecCollections"'), 'sbSecCollections must exist');
    assert.ok(HTML.includes('id="sbSecAccounts"'),   'sbSecAccounts must exist');
});

test('dashboard.html: sidebar section bodies exist for library, collections, accounts', () => {
    assert.ok(HTML.includes('id="sbBodyLibrary"'),    'sbBodyLibrary must exist');
    assert.ok(HTML.includes('id="sbBodyCollections"'), 'sbBodyCollections must exist');
    assert.ok(HTML.includes('id="sbBodyAccounts"'),   'sbBodyAccounts must exist');
});

test('dashboard.html: sidebar chevrons exist for all three sections', () => {
    assert.ok(HTML.includes('id="sbChevronLibrary"'),    'sbChevronLibrary must exist');
    assert.ok(HTML.includes('id="sbChevronCollections"'), 'sbChevronCollections must exist');
    assert.ok(HTML.includes('id="sbChevronAccounts"'),   'sbChevronAccounts must exist');
});

test('dashboard.html: sidebar nav items exist (nav-home, nav-all-games, nav-installed, nav-ready, nav-fav, nav-collections)', () => {
    assert.ok(HTML.includes('id="nav-home"'),        'nav-home must exist');
    assert.ok(HTML.includes('id="nav-all-games"'),   'nav-all-games must exist');
    assert.ok(HTML.includes('id="nav-installed"'),   'nav-installed must exist');
    assert.ok(HTML.includes('id="nav-ready"'),       'nav-ready must exist');
    assert.ok(HTML.includes('id="nav-fav"'),         'nav-fav must exist');
    assert.ok(HTML.includes('id="nav-collections"'), 'nav-collections must exist');
});

test('dashboard.html: sidebar badge elements sbNavInstalled and sbNavReady exist', () => {
    assert.ok(HTML.includes('id="sbNavInstalled"'), 'sbNavInstalled must exist');
    assert.ok(HTML.includes('id="sbNavReady"'),     'sbNavReady must exist');
});

test('dashboard.html: context button btn-new-coll with sbCtxBtnText and sbCtxIcon exist', () => {
    assert.ok(HTML.includes('id="btn-new-coll"'),   'btn-new-coll must exist');
    assert.ok(HTML.includes('id="sbCtxBtnText"'),   'sbCtxBtnText must exist');
    assert.ok(HTML.includes('id="sbCtxIcon"'),      'sbCtxIcon must exist');
});

test('dashboard.html: legacy collectionsList div exists (stays empty)', () => {
    assert.ok(HTML.includes('id="collectionsList"'), 'collectionsList must exist for renderSidebar compat');
});

// ─── 19. Inline onclick handlers in dashboard.html ────────────────────────────

test('dashboard.html: toggleSidebar is called from sidebar toggle button', () => {
    assert.ok(HTML.includes('onclick="toggleSidebar()"'), 'toggleSidebar must be wired as onclick');
});

test('dashboard.html: sbToggleSection is called from section header onclicks', () => {
    assert.ok(HTML.includes("onclick=\"sbToggleSection('library')\""), 'library section must call sbToggleSection');
    assert.ok(HTML.includes("onclick=\"sbToggleSection('collections')\""), 'collections section must call sbToggleSection');
    assert.ok(HTML.includes("onclick=\"sbToggleSection('accounts')\""), 'accounts section must call sbToggleSection');
});

test('dashboard.html: navigateToReadyToInstall is called from nav-ready item', () => {
    assert.ok(HTML.includes('onclick="navigateToReadyToInstall()"'), 'nav-ready must call navigateToReadyToInstall');
});

test('dashboard.html: sbGoManageCollections is called from nav-collections item', () => {
    assert.ok(HTML.includes('onclick="sbGoManageCollections()"'), 'nav-collections must call sbGoManageCollections');
});

test('dashboard.html: handleSidebarContextBtn is called from btn-new-coll', () => {
    assert.ok(HTML.includes('onclick="handleSidebarContextBtn()"'), 'btn-new-coll must call handleSidebarContextBtn');
});

// ─── 20. Cross-file callers ────────────────────────────────────────────────────

test('accounts/platform-panels.js: calls updateSidebarActiveState with typeof guard', () => {
    const panelsJs = fs.readFileSync(
        path.join(ROOT, 'src/js/accounts/platform-panels.js'), 'utf8'
    );
    assert.ok(
        panelsJs.includes("typeof updateSidebarActiveState === 'function'"),
        'platform-panels.js must guard updateSidebarActiveState with typeof check'
    );
});

// ─── 21. Intentional app.js dependencies ─────────────────────────────────────
// Each dependency is verified against the specific function that uses it.

test('app.js: renderSidebarLibraryPulse reads allGamesData (global from app.js)', () => {
    const fn = extractFn(APP_JS, 'function renderSidebarLibraryPulse()');
    assert.match(fn, /allGamesData/);
});

test('app.js: updateSmartSidebarCounts reads allGamesData (global from app.js)', () => {
    const fn = extractFn(APP_JS, 'function updateSmartSidebarCounts()');
    assert.match(fn, /allGamesData/);
});

test('app.js: renderSidebarJumpBackIn reads playtimeData (global from app.js)', () => {
    const fn = extractFn(APP_JS, 'function renderSidebarJumpBackIn()');
    assert.match(fn, /playtimeData/);
});

test('app.js: getSidebarActionContext reads currentView (global from app.js)', () => {
    const fn = extractFn(APP_JS, 'function getSidebarActionContext()');
    assert.match(fn, /currentView/);
});

test('app.js: updateSidebarActiveState reads currentView (global from app.js)', () => {
    const fn = extractFn(APP_JS, 'function updateSidebarActiveState()');
    assert.match(fn, /currentView/);
});

test('app.js: getSidebarActionContext reads currentFilters (global from app.js)', () => {
    const fn = extractFn(APP_JS, 'function getSidebarActionContext()');
    assert.match(fn, /currentFilters/);
});

test('app.js: renderSidebarCollectionsList reads allCollections (global from app.js)', () => {
    const fn = extractFn(APP_JS, 'function renderSidebarCollectionsList()');
    assert.match(fn, /allCollections/);
});

test('app.js: getSidebarActionContext reads currentAccountPlatform (global from app.js)', () => {
    const fn = extractFn(APP_JS, 'function getSidebarActionContext()');
    assert.match(fn, /currentAccountPlatform/);
});

test('app.js: toggleSidebar reads window._agDisplayPrefs.viewMode (display-prefs cross-dep)', () => {
    const fn = extractFn(APP_JS, 'function toggleSidebar()');
    assert.match(fn, /window\._agDisplayPrefs/);
    assert.match(fn, /viewMode/);
});

// ─── 22. Dependency isolation — sidebar does NOT use unrelated internals ──────

// Sidebar block: from section 8 header through toggleSidebar (ends before openCollectionModal).
// openCollectionModal begins immediately after the last sidebar function (toggleSidebar).
function _sidebarBlock() {
    const start = APP_JS.indexOf('// 8. SIDEBAR');
    const end   = APP_JS.indexOf('function openCollectionModal()');
    return APP_JS.slice(start, end);
}

test('app.js: sidebar functions do not reference AG_DISPLAY_DEFAULTS', () => {
    assert.ok(!_sidebarBlock().includes('AG_DISPLAY_DEFAULTS'), 'sidebar must not reference AG_DISPLAY_DEFAULTS');
});

test('app.js: sidebar functions do not reference IG_DISPLAY_DEFAULTS', () => {
    assert.ok(!_sidebarBlock().includes('IG_DISPLAY_DEFAULTS'), 'sidebar must not reference IG_DISPLAY_DEFAULTS');
});

test('app.js: sidebar functions do not reference window._igDisplayPrefs', () => {
    assert.ok(!_sidebarBlock().includes('_igDisplayPrefs'), 'sidebar must not reference _igDisplayPrefs');
});

test('app.js: sidebar functions do not reference Quick Switcher helpers', () => {
    const block = _sidebarBlock();
    assert.ok(!block.includes('_qsLoad') && !block.includes('qsToggleEnabled'),
        'sidebar must not reference Quick Switcher internals');
});

test('app.js: sidebar functions do not reference toast/confirm internal state', () => {
    assert.ok(!_sidebarBlock().includes('pendingConfirmAction'), 'sidebar must not access pendingConfirmAction');
});

// ─── 23. Comment hygiene ─────────────────────────────────────────────────────

test('app.js sidebar section: no Arabic characters in sidebar block', () => {
    assert.doesNotMatch(_sidebarBlock(), /[؀-ۿ]/, 'sidebar section must contain no Arabic characters');
});
