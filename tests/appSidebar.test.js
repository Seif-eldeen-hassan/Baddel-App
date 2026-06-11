'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT      = path.resolve(__dirname, '..');
const APP_JS    = fs.readFileSync(path.join(ROOT, 'src/js/app.js'),              'utf8');
const SIDEBAR_JS = fs.readFileSync(path.join(ROOT, 'src/js/app/sidebar.js'),     'utf8');
const HTML      = fs.readFileSync(path.join(ROOT, 'src/dashboard.html'),         'utf8');

// ─── helpers ─────────────────────────────────────────────────────────────────

function extractFn(src, sig) {
    const idx = src.indexOf(sig);
    if (idx === -1) return null;
    return src.slice(idx, idx + 2000);
}

// ─── 1. Source-presence: all sidebar functions exist in sidebar.js ────────────

test('sidebar.js: renderSidebar exists', () => {
    assert.match(SIDEBAR_JS, /function renderSidebar\(\)/);
});

test('sidebar.js: renderSidebarJumpBackIn exists', () => {
    assert.match(SIDEBAR_JS, /function renderSidebarJumpBackIn\(\)/);
});

test('sidebar.js: renderSidebarAccountSummary exists', () => {
    assert.match(SIDEBAR_JS, /function renderSidebarAccountSummary\(\)/);
});

test('sidebar.js: renderSidebarLibraryPulse exists', () => {
    assert.match(SIDEBAR_JS, /function renderSidebarLibraryPulse\(\)/);
});

test('sidebar.js: navigateToReadyToInstall exists', () => {
    assert.match(SIDEBAR_JS, /async function navigateToReadyToInstall\(\)/);
});

test('sidebar.js: updateSidebarPlatformDots exists', () => {
    assert.match(SIDEBAR_JS, /function updateSidebarPlatformDots\(\)/);
});

test('sidebar.js: updateSmartSidebarCounts exists', () => {
    assert.match(SIDEBAR_JS, /function updateSmartSidebarCounts\(\)/);
});

test('sidebar.js: getReadyToInstallGamesForCounts exists', () => {
    assert.match(SIDEBAR_JS, /function getReadyToInstallGamesForCounts\(\)/);
});

test('sidebar.js: getReadyToInstallCount exists', () => {
    assert.match(SIDEBAR_JS, /function getReadyToInstallCount\(\)/);
});

test('sidebar.js: getSidebarActionContext exists', () => {
    assert.match(SIDEBAR_JS, /function getSidebarActionContext\(\)/);
});

test('sidebar.js: syncSidebarActionButton exists', () => {
    assert.match(SIDEBAR_JS, /function syncSidebarActionButton\(\)/);
});

test('sidebar.js: renderSidebarCollectionsList exists', () => {
    assert.match(SIDEBAR_JS, /function renderSidebarCollectionsList\(\)/);
});

test('sidebar.js: updateSidebarCards exists', () => {
    assert.match(SIDEBAR_JS, /function updateSidebarCards\(\)/);
});

test('sidebar.js: sbToggleSection exists', () => {
    assert.match(SIDEBAR_JS, /function sbToggleSection\(sec\)/);
});

test('sidebar.js: sbExpandSection exists', () => {
    assert.match(SIDEBAR_JS, /function sbExpandSection\(sec\)/);
});

test('sidebar.js: _sbApplySectionState exists', () => {
    assert.match(SIDEBAR_JS, /function _sbApplySectionState\(sec\)/);
});

test('sidebar.js: sbGoManageCollections exists', () => {
    assert.match(SIDEBAR_JS, /function sbGoManageCollections\(\)/);
});

test('sidebar.js: handleSidebarContextBtn exists', () => {
    assert.match(SIDEBAR_JS, /function handleSidebarContextBtn\(\)/);
});

test('sidebar.js: updateSbContextBtn exists', () => {
    assert.match(SIDEBAR_JS, /function updateSbContextBtn\(\)/);
});

test('sidebar.js: clearSidebarActiveState exists', () => {
    assert.match(SIDEBAR_JS, /function clearSidebarActiveState\(\)/);
});

test('sidebar.js: updateSidebarActiveState exists', () => {
    assert.match(SIDEBAR_JS, /function updateSidebarActiveState\(\)/);
});

test('sidebar.js: toggleSidebar exists', () => {
    assert.match(SIDEBAR_JS, /function toggleSidebar\(\)/);
});

test('sidebar.js: openSidebarCollection exists', () => {
    assert.match(SIDEBAR_JS, /function openSidebarCollection\(collectionId\)/);
});

// ─── 2. State variables ───────────────────────────────────────────────────────

test('sidebar.js: SB_COLL_MAX is defined as a const', () => {
    assert.match(SIDEBAR_JS, /const SB_COLL_MAX\s*=\s*5/);
});

test('sidebar.js: window._sbSec initialized with library/collections/accounts keys', () => {
    const idx = SIDEBAR_JS.indexOf('window._sbSec');
    assert.ok(idx !== -1, 'window._sbSec must be initialized');
    const ctx = SIDEBAR_JS.slice(idx, idx + 100);
    assert.match(ctx, /library/);
    assert.match(ctx, /collections/);
    assert.match(ctx, /accounts/);
});

test('sidebar.js: window._sbSec accounts defaults to false (collapsed)', () => {
    const idx = SIDEBAR_JS.indexOf('window._sbSec');
    const ctx = SIDEBAR_JS.slice(idx, idx + 100);
    assert.match(ctx, /accounts:\s*false/);
});

// ─── 3. Window exports ────────────────────────────────────────────────────────

test('sidebar.js: all sidebar functions are exported to window', () => {
    assert.match(SIDEBAR_JS, /window\.renderSidebar\s*=\s*renderSidebar/);
    assert.match(SIDEBAR_JS, /window\.renderSidebarJumpBackIn\s*=\s*renderSidebarJumpBackIn/);
    assert.match(SIDEBAR_JS, /window\.renderSidebarAccountSummary\s*=\s*renderSidebarAccountSummary/);
    assert.match(SIDEBAR_JS, /window\.renderSidebarLibraryPulse\s*=\s*renderSidebarLibraryPulse/);
    assert.match(SIDEBAR_JS, /window\.navigateToReadyToInstall\s*=\s*navigateToReadyToInstall/);
    assert.match(SIDEBAR_JS, /window\.updateSidebarPlatformDots\s*=\s*updateSidebarPlatformDots/);
    assert.match(SIDEBAR_JS, /window\.updateSmartSidebarCounts\s*=\s*updateSmartSidebarCounts/);
    assert.match(SIDEBAR_JS, /window\.getReadyToInstallGamesForCounts\s*=\s*getReadyToInstallGamesForCounts/);
    assert.match(SIDEBAR_JS, /window\.getReadyToInstallCount\s*=\s*getReadyToInstallCount/);
    assert.match(SIDEBAR_JS, /window\.getSidebarActionContext\s*=\s*getSidebarActionContext/);
    assert.match(SIDEBAR_JS, /window\.syncSidebarActionButton\s*=\s*syncSidebarActionButton/);
    assert.match(SIDEBAR_JS, /window\.renderSidebarCollectionsList\s*=\s*renderSidebarCollectionsList/);
    assert.match(SIDEBAR_JS, /window\.updateSidebarCards\s*=\s*updateSidebarCards/);
    assert.match(SIDEBAR_JS, /window\.sbToggleSection\s*=\s*sbToggleSection/);
    assert.match(SIDEBAR_JS, /window\.sbExpandSection\s*=\s*sbExpandSection/);
    assert.match(SIDEBAR_JS, /window\._sbApplySectionState\s*=\s*_sbApplySectionState/);
    assert.match(SIDEBAR_JS, /window\.sbGoManageCollections\s*=\s*sbGoManageCollections/);
    assert.match(SIDEBAR_JS, /window\.handleSidebarContextBtn\s*=\s*handleSidebarContextBtn/);
    assert.match(SIDEBAR_JS, /window\.updateSbContextBtn\s*=\s*updateSbContextBtn/);
    assert.match(SIDEBAR_JS, /window\.clearSidebarActiveState\s*=\s*clearSidebarActiveState/);
    assert.match(SIDEBAR_JS, /window\.updateSidebarActiveState\s*=\s*updateSidebarActiveState/);
    assert.match(SIDEBAR_JS, /window\.toggleSidebar\s*=\s*toggleSidebar/);
    assert.match(SIDEBAR_JS, /window\.openSidebarCollection\s*=\s*openSidebarCollection/);
});

// ─── 4. Rendering behaviour — renderSidebar ───────────────────────────────────

test('sidebar.js: renderSidebar calls renderSidebarCollectionsList', () => {
    const fn = extractFn(SIDEBAR_JS, 'function renderSidebar()');
    assert.match(fn, /renderSidebarCollectionsList\(\)/);
});

test('sidebar.js: renderSidebar calls updateSidebarActiveState', () => {
    const fn = extractFn(SIDEBAR_JS, 'function renderSidebar()');
    assert.match(fn, /updateSidebarActiveState\(\)/);
});

test('sidebar.js: renderSidebar calls updateSidebarCards', () => {
    const fn = extractFn(SIDEBAR_JS, 'function renderSidebar()');
    assert.match(fn, /updateSidebarCards\(\)/);
});

test('sidebar.js: renderSidebar empties legacy collectionsList div', () => {
    const fn = extractFn(SIDEBAR_JS, 'function renderSidebar()');
    assert.match(fn, /getElementById\('collectionsList'\)/);
    assert.match(fn, /innerHTML\s*=\s*''/);
});

// ─── 5. Jump Back In rendering ────────────────────────────────────────────────

test('sidebar.js: renderSidebarJumpBackIn reads sidebarJumpBackContent element', () => {
    const fn = extractFn(SIDEBAR_JS, 'function renderSidebarJumpBackIn()');
    assert.match(fn, /getElementById\('sidebarJumpBackContent'\)/);
});

test('sidebar.js: renderSidebarJumpBackIn shows empty-state message when no recent games', () => {
    const fn = extractFn(SIDEBAR_JS, 'function renderSidebarJumpBackIn()');
    assert.match(fn, /No recent sessions/);
});

test('sidebar.js: renderSidebarJumpBackIn calls getRecentGames', () => {
    const fn = extractFn(SIDEBAR_JS, 'function renderSidebarJumpBackIn()');
    assert.match(fn, /getRecentGames\(\)/);
});

test('sidebar.js: renderSidebarJumpBackIn reads playtimeData for session info', () => {
    const fn = extractFn(SIDEBAR_JS, 'function renderSidebarJumpBackIn()');
    assert.match(fn, /playtimeData/);
});

test('sidebar.js: renderSidebarJumpBackIn formats last-played relative to Date.now', () => {
    const fn = extractFn(SIDEBAR_JS, 'function renderSidebarJumpBackIn()');
    assert.match(fn, /Date\.now\(\)/);
    assert.match(fn, /Today|days ago/);
});

test('sidebar.js: renderSidebarJumpBackIn uses escapeHtml for all user-supplied strings', () => {
    const fn = extractFn(SIDEBAR_JS, 'function renderSidebarJumpBackIn()');
    assert.match(fn, /escapeHtml\(id\)|escapeHtml\(safeId\)|escapeHtml\(title\)/);
});

// ─── 6. Account summary rendering ────────────────────────────────────────────

test('sidebar.js: renderSidebarAccountSummary reads sidebarActiveAccounts element', () => {
    const fn = extractFn(SIDEBAR_JS, 'function renderSidebarAccountSummary()');
    assert.match(fn, /getElementById\('sidebarActiveAccounts'\)/);
});

test('sidebar.js: renderSidebarAccountSummary hides card when no platform counts are non-zero', () => {
    const fn = extractFn(SIDEBAR_JS, 'function renderSidebarAccountSummary()');
    assert.match(fn, /classList\.add\('baddel-hidden'\)/);
});

test('sidebar.js: renderSidebarAccountSummary reads count elements from DOM (not IPC)', () => {
    const fn = extractFn(SIDEBAR_JS, 'function renderSidebarAccountSummary()');
    assert.match(fn, /steamCount/);
    assert.match(fn, /epicCount/);
    assert.match(fn, /textContent/);
});

test('sidebar.js: renderSidebarAccountSummary renders baddel-acc-row items', () => {
    const fn = extractFn(SIDEBAR_JS, 'function renderSidebarAccountSummary()');
    assert.match(fn, /baddel-acc-row/);
});

// ─── 7. Library pulse rendering ───────────────────────────────────────────────

test('sidebar.js: renderSidebarLibraryPulse reads sbTotalGames element', () => {
    const fn = extractFn(SIDEBAR_JS, 'function renderSidebarLibraryPulse()');
    assert.match(fn, /getElementById\('sbTotalGames'\)/);
});

test('sidebar.js: renderSidebarLibraryPulse uses allGamesData for total count', () => {
    const fn = extractFn(SIDEBAR_JS, 'function renderSidebarLibraryPulse()');
    assert.match(fn, /allGamesData/);
});

test('sidebar.js: renderSidebarLibraryPulse uses _agIsInstalled for installed count', () => {
    const fn = extractFn(SIDEBAR_JS, 'function renderSidebarLibraryPulse()');
    assert.match(fn, /_agIsInstalled/);
});

test('sidebar.js: renderSidebarLibraryPulse reads window._suggAllGames for ready count', () => {
    const fn = extractFn(SIDEBAR_JS, 'function renderSidebarLibraryPulse()');
    assert.match(fn, /window\._suggAllGames/);
});

test('sidebar.js: renderSidebarLibraryPulse hides ready tile when no data', () => {
    const fn = extractFn(SIDEBAR_JS, 'function renderSidebarLibraryPulse()');
    assert.match(fn, /style\.display\s*=\s*'none'/);
});

// ─── 8. Ready-to-install counts ───────────────────────────────────────────────

test('sidebar.js: getReadyToInstallGamesForCounts returns window._readyToInstallRenderedGames first', () => {
    const fn = extractFn(SIDEBAR_JS, 'function getReadyToInstallGamesForCounts()');
    assert.match(fn, /window\._readyToInstallRenderedGames/);
    // Canonical source is checked before fallbacks
    const canonicalIdx = fn.indexOf('_readyToInstallRenderedGames');
    const suggIdx      = fn.indexOf('_suggAllGames');
    assert.ok(canonicalIdx < suggIdx, 'canonical source must be checked before _suggAllGames');
});

test('sidebar.js: getReadyToInstallGamesForCounts falls back to window._suggAllGames', () => {
    const fn = extractFn(SIDEBAR_JS, 'function getReadyToInstallGamesForCounts()');
    assert.match(fn, /window\._suggAllGames/);
});

test('sidebar.js: getReadyToInstallGamesForCounts falls back to window._allGamesCache filtered by _agIsInstalled', () => {
    const fn = extractFn(SIDEBAR_JS, 'function getReadyToInstallGamesForCounts()');
    assert.match(fn, /window\._allGamesCache/);
    assert.match(fn, /_agIsInstalled/);
});

test('sidebar.js: getReadyToInstallGamesForCounts returns null when no data loaded yet', () => {
    const fn = extractFn(SIDEBAR_JS, 'function getReadyToInstallGamesForCounts()');
    assert.match(fn, /return null/);
});

test('sidebar.js: getReadyToInstallCount delegates to getReadyToInstallGamesForCounts', () => {
    const fn = extractFn(SIDEBAR_JS, 'function getReadyToInstallCount()');
    assert.match(fn, /getReadyToInstallGamesForCounts\(\)/);
    assert.match(fn, /null.*null|games === null/);
});

// ─── 9. Smart sidebar counts ──────────────────────────────────────────────────

test('sidebar.js: updateSmartSidebarCounts reads sbNavInstalled element', () => {
    const fn = extractFn(SIDEBAR_JS, 'function updateSmartSidebarCounts()');
    assert.match(fn, /getElementById\('sbNavInstalled'\)/);
});

test('sidebar.js: updateSmartSidebarCounts reads sbNavReady element', () => {
    const fn = extractFn(SIDEBAR_JS, 'function updateSmartSidebarCounts()');
    assert.match(fn, /getElementById\('sbNavReady'\)/);
});

test('sidebar.js: updateSmartSidebarCounts uses allGamesData and _agIsInstalled for installed badge', () => {
    const fn = extractFn(SIDEBAR_JS, 'function updateSmartSidebarCounts()');
    assert.match(fn, /allGamesData/);
    assert.match(fn, /_agIsInstalled/);
});

test('sidebar.js: updateSmartSidebarCounts calls getReadyToInstallCount for ready badge', () => {
    const fn = extractFn(SIDEBAR_JS, 'function updateSmartSidebarCounts()');
    assert.match(fn, /getReadyToInstallCount\(\)/);
});

test('sidebar.js: updateSmartSidebarCounts shows loading indicator (…) when data not ready', () => {
    const fn = extractFn(SIDEBAR_JS, 'function updateSmartSidebarCounts()');
    assert.match(fn, /…|\.\.\.|…/);
});

// ─── 10. Platform dots ────────────────────────────────────────────────────────

test('sidebar.js: updateSidebarPlatformDots reads sbPlatformDots container', () => {
    const fn = extractFn(SIDEBAR_JS, 'function updateSidebarPlatformDots()');
    assert.match(fn, /getElementById\('sbPlatformDots'\)/);
});

test('sidebar.js: updateSidebarPlatformDots reads all seven platform count elements', () => {
    const fn = extractFn(SIDEBAR_JS, 'function updateSidebarPlatformDots()');
    assert.match(fn, /steamCount/);
    assert.match(fn, /epicCount/);
    assert.match(fn, /riotCount/);
    assert.match(fn, /eaCount/);
    assert.match(fn, /ubisoftCount/);
    assert.match(fn, /discordCount/);
    assert.match(fn, /rockstarCount/);
});

test('sidebar.js: updateSidebarPlatformDots renders baddel-plat-dot spans', () => {
    const fn = extractFn(SIDEBAR_JS, 'function updateSidebarPlatformDots()');
    assert.match(fn, /baddel-plat-dot/);
});

// ─── 11. Sidebar active state ─────────────────────────────────────────────────

test('sidebar.js: clearSidebarActiveState removes active class from nav-item and platform-item elements', () => {
    const fn = extractFn(SIDEBAR_JS, 'function clearSidebarActiveState()');
    assert.match(fn, /\.nav-item\.active/);
    assert.match(fn, /classList\.remove\('active'\)/);
});

test('sidebar.js: updateSidebarActiveState calls clearSidebarActiveState first', () => {
    const fn = extractFn(SIDEBAR_JS, 'function updateSidebarActiveState()');
    assert.match(fn, /clearSidebarActiveState\(\)/);
    const clearIdx  = fn.indexOf('clearSidebarActiveState()');
    const addIdx    = fn.indexOf("classList.add('active')");
    assert.ok(clearIdx < addIdx, 'must clear before adding active state');
});

test('sidebar.js: updateSidebarActiveState reads currentView', () => {
    const fn = extractFn(SIDEBAR_JS, 'function updateSidebarActiveState()');
    assert.match(fn, /currentView/);
});

test('sidebar.js: updateSidebarActiveState reads currentFilters.collectionId', () => {
    const fn = extractFn(SIDEBAR_JS, 'function updateSidebarActiveState()');
    assert.match(fn, /currentFilters\.collectionId/);
});

test('sidebar.js: updateSidebarActiveState activates nav-home for home view', () => {
    const fn = extractFn(SIDEBAR_JS, 'function updateSidebarActiveState()');
    assert.match(fn, /getElementById\('nav-home'\)/);
    assert.match(fn, /'home'/);
});

test('sidebar.js: updateSidebarActiveState activates nav-all-games for all-games view', () => {
    const fn = extractFn(SIDEBAR_JS, 'function updateSidebarActiveState()');
    assert.match(fn, /getElementById\('nav-all-games'\)/);
});

test('sidebar.js: updateSidebarActiveState activates nav-installed for installed view', () => {
    const fn = extractFn(SIDEBAR_JS, 'function updateSidebarActiveState()');
    assert.match(fn, /getElementById\('nav-installed'\)/);
});

test('sidebar.js: updateSidebarActiveState activates nav-fav for fav_system_default collection', () => {
    const fn = extractFn(SIDEBAR_JS, 'function updateSidebarActiveState()');
    assert.match(fn, /getElementById\('nav-fav'\)/);
    assert.match(fn, /fav_system_default/);
});

test('sidebar.js: updateSidebarActiveState activates nav-ready when agReadyOnly is set', () => {
    const fn = extractFn(SIDEBAR_JS, 'function updateSidebarActiveState()');
    assert.match(fn, /getElementById\('nav-ready'\)/);
    assert.match(fn, /agReadyOnly/);
});

test('sidebar.js: updateSidebarActiveState uses CSS.escape for custom collection IDs', () => {
    const fn = extractFn(SIDEBAR_JS, 'function updateSidebarActiveState()');
    assert.match(fn, /CSS\.escape/);
    assert.match(fn, /data-collection-id/);
});

// ─── 12. Sidebar context/action button ───────────────────────────────────────

test('sidebar.js: getSidebarActionContext reads currentView', () => {
    const fn = extractFn(SIDEBAR_JS, 'function getSidebarActionContext()');
    assert.match(fn, /currentView/);
});

test('sidebar.js: getSidebarActionContext reads currentFilters.collectionId', () => {
    const fn = extractFn(SIDEBAR_JS, 'function getSidebarActionContext()');
    assert.match(fn, /currentFilters\.collectionId/);
});

test('sidebar.js: getSidebarActionContext reads currentAccountPlatform', () => {
    const fn = extractFn(SIDEBAR_JS, 'function getSidebarActionContext()');
    assert.match(fn, /currentAccountPlatform/);
});

test('sidebar.js: getSidebarActionContext returns all expected context values', () => {
    const fn = extractFn(SIDEBAR_JS, 'function getSidebarActionContext()');
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

test('sidebar.js: syncSidebarActionButton reads sbCtxBtnText element', () => {
    const fn = extractFn(SIDEBAR_JS, 'function syncSidebarActionButton()');
    assert.match(fn, /getElementById\('sbCtxBtnText'\)/);
});

test('sidebar.js: syncSidebarActionButton reads btn-new-coll element', () => {
    const fn = extractFn(SIDEBAR_JS, 'function syncSidebarActionButton()');
    assert.match(fn, /getElementById\('btn-new-coll'\)/);
});

test('sidebar.js: syncSidebarActionButton calls getSidebarActionContext', () => {
    const fn = extractFn(SIDEBAR_JS, 'function syncSidebarActionButton()');
    assert.match(fn, /getSidebarActionContext\(\)/);
});

test('sidebar.js: syncSidebarActionButton sets different button text per context', () => {
    const fn = extractFn(SIDEBAR_JS, 'function syncSidebarActionButton()');
    assert.match(fn, /Add Account/);
    assert.match(fn, /Add Game/);
    assert.match(fn, /New Collection/);
    assert.match(fn, /Link Accounts/);
});

test('sidebar.js: updateSbContextBtn delegates to syncSidebarActionButton', () => {
    const fn = extractFn(SIDEBAR_JS, 'function updateSbContextBtn()');
    assert.match(fn, /syncSidebarActionButton\(\)/);
});

test('sidebar.js: handleSidebarContextBtn calls getSidebarActionContext', () => {
    const fn = extractFn(SIDEBAR_JS, 'function handleSidebarContextBtn()');
    assert.match(fn, /getSidebarActionContext\(\)/);
});

test('sidebar.js: handleSidebarContextBtn calls openPlatformsModal as fallback', () => {
    const fn = extractFn(SIDEBAR_JS, 'function handleSidebarContextBtn()');
    assert.match(fn, /openPlatformsModal\(\)/);
});

test('sidebar.js: handleSidebarContextBtn calls navigateToInstalled for collection/favorites context', () => {
    const fn = extractFn(SIDEBAR_JS, 'function handleSidebarContextBtn()');
    assert.match(fn, /navigateToInstalled\(\)/);
});

test('sidebar.js: handleSidebarContextBtn calls openAddGameModal for installed context', () => {
    const fn = extractFn(SIDEBAR_JS, 'function handleSidebarContextBtn()');
    assert.match(fn, /openAddGameModal\(\)/);
});

test('sidebar.js: handleSidebarContextBtn calls openCollectionModal for collections context', () => {
    const fn = extractFn(SIDEBAR_JS, 'function handleSidebarContextBtn()');
    assert.match(fn, /openCollectionModal\(\)/);
});

// ─── 13. Section expand/collapse ─────────────────────────────────────────────

test('sidebar.js: sbToggleSection flips window._sbSec[sec] and applies state', () => {
    const fn = extractFn(SIDEBAR_JS, 'function sbToggleSection(sec)');
    assert.match(fn, /window\._sbSec\[sec\]\s*=\s*!window\._sbSec\[sec\]/);
    assert.match(fn, /_sbApplySectionState\(sec\)/);
});

test('sidebar.js: sbToggleSection calls updateSbContextBtn after toggling', () => {
    const fn = extractFn(SIDEBAR_JS, 'function sbToggleSection(sec)');
    assert.match(fn, /updateSbContextBtn\(\)/);
});

test('sidebar.js: sbExpandSection does nothing when section already open', () => {
    const fn = extractFn(SIDEBAR_JS, 'function sbExpandSection(sec)');
    assert.match(fn, /if\s*\(window\._sbSec\[sec\]\)\s*return/);
});

test('sidebar.js: sbExpandSection sets window._sbSec[sec] to true and applies state', () => {
    const fn = extractFn(SIDEBAR_JS, 'function sbExpandSection(sec)');
    assert.match(fn, /window\._sbSec\[sec\]\s*=\s*true/);
    assert.match(fn, /_sbApplySectionState\(sec\)/);
});

test('sidebar.js: _sbApplySectionState reads sbBody<Section> element', () => {
    const fn = extractFn(SIDEBAR_JS, 'function _sbApplySectionState(sec)');
    assert.match(fn, /getElementById\(`sbBody\$\{cap\}`\)/);
});

test('sidebar.js: _sbApplySectionState reads sbChevron<Section> element', () => {
    const fn = extractFn(SIDEBAR_JS, 'function _sbApplySectionState(sec)');
    assert.match(fn, /getElementById\(`sbChevron\$\{cap\}`\)/);
});

test('sidebar.js: _sbApplySectionState toggles sb-sec-closed class on body', () => {
    const fn = extractFn(SIDEBAR_JS, 'function _sbApplySectionState(sec)');
    assert.match(fn, /classList\.toggle\('sb-sec-closed'/);
});

test('sidebar.js: _sbApplySectionState toggles sb-chevron-closed class on chevron', () => {
    const fn = extractFn(SIDEBAR_JS, 'function _sbApplySectionState(sec)');
    assert.match(fn, /classList\.toggle\('sb-chevron-closed'/);
});

// ─── 14. Collections list rendering ──────────────────────────────────────────

test('sidebar.js: renderSidebarCollectionsList reads sbBodyCollections element', () => {
    const fn = extractFn(SIDEBAR_JS, 'function renderSidebarCollectionsList()');
    assert.match(fn, /getElementById\('sbBodyCollections'\)/);
});

test('sidebar.js: renderSidebarCollectionsList filters out fav_system_default', () => {
    const fn = extractFn(SIDEBAR_JS, 'function renderSidebarCollectionsList()');
    assert.match(fn, /fav_system_default/);
    assert.match(fn, /\.filter\(/);
});

test('sidebar.js: renderSidebarCollectionsList reads allCollections', () => {
    const fn = extractFn(SIDEBAR_JS, 'function renderSidebarCollectionsList()');
    assert.match(fn, /allCollections/);
});

test('sidebar.js: renderSidebarCollectionsList limits to SB_COLL_MAX entries', () => {
    const fn = extractFn(SIDEBAR_JS, 'function renderSidebarCollectionsList()');
    assert.match(fn, /SB_COLL_MAX/);
    assert.match(fn, /\.slice\(0,\s*SB_COLL_MAX\)/);
});

test('sidebar.js: renderSidebarCollectionsList renders sb-coll-item entries with onclick openSidebarCollection', () => {
    const fn = extractFn(SIDEBAR_JS, 'function renderSidebarCollectionsList()');
    assert.match(fn, /sb-coll-item/);
    assert.match(fn, /openSidebarCollection/);
});

test('sidebar.js: renderSidebarCollectionsList shows View all link when more collections exist', () => {
    const fn = extractFn(SIDEBAR_JS, 'function renderSidebarCollectionsList()');
    assert.match(fn, /View all/);
    assert.match(fn, /moreCount/);
});

test('sidebar.js: renderSidebarCollectionsList shows empty-state message when no custom collections', () => {
    const fn = extractFn(SIDEBAR_JS, 'function renderSidebarCollectionsList()');
    assert.match(fn, /No collections/);
});

test('sidebar.js: openSidebarCollection calls filterByCollection', () => {
    const fn = extractFn(SIDEBAR_JS, 'function openSidebarCollection(collectionId)');
    assert.match(fn, /filterByCollection\(collectionId\)/);
});

test('sidebar.js: openSidebarCollection clears currentAccountPlatform', () => {
    const fn = extractFn(SIDEBAR_JS, 'function openSidebarCollection(collectionId)');
    assert.match(fn, /currentAccountPlatform\s*=\s*null/);
});

// ─── 15. Sidebar cards refresh ────────────────────────────────────────────────

test('sidebar.js: updateSidebarCards calls updateSidebarPlatformDots', () => {
    const fn = extractFn(SIDEBAR_JS, 'function updateSidebarCards()');
    assert.match(fn, /updateSidebarPlatformDots\(\)/);
});

test('sidebar.js: updateSidebarCards calls updateSmartSidebarCounts', () => {
    const fn = extractFn(SIDEBAR_JS, 'function updateSidebarCards()');
    assert.match(fn, /updateSmartSidebarCounts\(\)/);
});

test('sidebar.js: updateSidebarCards calls renderSidebarJumpBackIn', () => {
    const fn = extractFn(SIDEBAR_JS, 'function updateSidebarCards()');
    assert.match(fn, /renderSidebarJumpBackIn\(\)/);
});

test('sidebar.js: updateSidebarCards calls renderSidebarAccountSummary', () => {
    const fn = extractFn(SIDEBAR_JS, 'function updateSidebarCards()');
    assert.match(fn, /renderSidebarAccountSummary\(\)/);
});

test('sidebar.js: updateSidebarCards calls renderSidebarLibraryPulse', () => {
    const fn = extractFn(SIDEBAR_JS, 'function updateSidebarCards()');
    assert.match(fn, /renderSidebarLibraryPulse\(\)/);
});

test('sidebar.js: updateSidebarCards wraps each card call in try/catch', () => {
    const fn = extractFn(SIDEBAR_JS, 'function updateSidebarCards()');
    assert.match(fn, /try\s*\{/);
    assert.match(fn, /\}\s*catch/);
});

// ─── 16. Navigate to Ready to Install ────────────────────────────────────────

test('sidebar.js: navigateToReadyToInstall sets window.agReadyOnly before calling navigateToAllGames', () => {
    const fn = extractFn(SIDEBAR_JS, 'async function navigateToReadyToInstall()');
    assert.match(fn, /window\.agReadyOnly\s*=\s*true/);
    assert.match(fn, /navigateToAllGames/);
    const readyIdx = fn.indexOf('agReadyOnly');
    const navIdx   = fn.indexOf('navigateToAllGames');
    assert.ok(readyIdx < navIdx, 'agReadyOnly must be set before calling navigateToAllGames');
});

test('sidebar.js: navigateToReadyToInstall sets window.agInstalledOnly to false', () => {
    const fn = extractFn(SIDEBAR_JS, 'async function navigateToReadyToInstall()');
    assert.match(fn, /window\.agInstalledOnly\s*=\s*false/);
});

// ─── 17. Toggle sidebar ────────────────────────────────────────────────────────

test('sidebar.js: toggleSidebar reads mainSidebar element', () => {
    const fn = extractFn(SIDEBAR_JS, 'function toggleSidebar()');
    assert.match(fn, /getElementById\('mainSidebar'\)/);
});

test('sidebar.js: toggleSidebar toggles collapsed class on mainSidebar', () => {
    const fn = extractFn(SIDEBAR_JS, 'function toggleSidebar()');
    assert.match(fn, /classList\.toggle\('collapsed'\)/);
});

test('sidebar.js: toggleSidebar reads toggleIcon element and updates its innerHTML', () => {
    const fn = extractFn(SIDEBAR_JS, 'function toggleSidebar()');
    assert.match(fn, /getElementById\('toggleIcon'\)/);
    assert.match(fn, /innerHTML/);
});

test('sidebar.js: toggleSidebar skips _vsRender when agDisplayPrefs viewMode is list', () => {
    const fn = extractFn(SIDEBAR_JS, 'function toggleSidebar()');
    assert.match(fn, /window\._agDisplayPrefs/);
    assert.match(fn, /viewMode.*list|list.*viewMode/);
    assert.match(fn, /return/);
});

test('sidebar.js: toggleSidebar polls for column changes during CSS transition', () => {
    const fn = extractFn(SIDEBAR_JS, 'function toggleSidebar()');
    assert.match(fn, /requestAnimationFrame/);
    assert.match(fn, /setTimeout/);
    assert.match(fn, /_vsRender/);
});

test('sidebar.js: toggleSidebar uses _vsMeasure to detect column count changes', () => {
    const fn = extractFn(SIDEBAR_JS, 'function toggleSidebar()');
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

test('sidebar.js: renderSidebarLibraryPulse reads allGamesData (global from app.js)', () => {
    const fn = extractFn(SIDEBAR_JS, 'function renderSidebarLibraryPulse()');
    assert.match(fn, /allGamesData/);
});

test('sidebar.js: updateSmartSidebarCounts reads allGamesData (global from app.js)', () => {
    const fn = extractFn(SIDEBAR_JS, 'function updateSmartSidebarCounts()');
    assert.match(fn, /allGamesData/);
});

test('sidebar.js: renderSidebarJumpBackIn reads playtimeData (global from app.js)', () => {
    const fn = extractFn(SIDEBAR_JS, 'function renderSidebarJumpBackIn()');
    assert.match(fn, /playtimeData/);
});

test('sidebar.js: getSidebarActionContext reads currentView (global from app.js)', () => {
    const fn = extractFn(SIDEBAR_JS, 'function getSidebarActionContext()');
    assert.match(fn, /currentView/);
});

test('sidebar.js: updateSidebarActiveState reads currentView (global from app.js)', () => {
    const fn = extractFn(SIDEBAR_JS, 'function updateSidebarActiveState()');
    assert.match(fn, /currentView/);
});

test('sidebar.js: getSidebarActionContext reads currentFilters (global from app.js)', () => {
    const fn = extractFn(SIDEBAR_JS, 'function getSidebarActionContext()');
    assert.match(fn, /currentFilters/);
});

test('sidebar.js: renderSidebarCollectionsList reads allCollections (global from app.js)', () => {
    const fn = extractFn(SIDEBAR_JS, 'function renderSidebarCollectionsList()');
    assert.match(fn, /allCollections/);
});

test('sidebar.js: getSidebarActionContext reads currentAccountPlatform (global from app.js)', () => {
    const fn = extractFn(SIDEBAR_JS, 'function getSidebarActionContext()');
    assert.match(fn, /currentAccountPlatform/);
});

test('sidebar.js: toggleSidebar reads window._agDisplayPrefs.viewMode (display-prefs cross-dep)', () => {
    const fn = extractFn(SIDEBAR_JS, 'function toggleSidebar()');
    assert.match(fn, /window\._agDisplayPrefs/);
    assert.match(fn, /viewMode/);
});

// ─── 22. Dependency isolation — sidebar.js does NOT use unrelated internals ───

test('sidebar.js: does not reference AG_DISPLAY_DEFAULTS', () => {
    assert.ok(!SIDEBAR_JS.includes('AG_DISPLAY_DEFAULTS'), 'sidebar must not reference AG_DISPLAY_DEFAULTS');
});

test('sidebar.js: does not reference IG_DISPLAY_DEFAULTS', () => {
    assert.ok(!SIDEBAR_JS.includes('IG_DISPLAY_DEFAULTS'), 'sidebar must not reference IG_DISPLAY_DEFAULTS');
});

test('sidebar.js: does not reference window._igDisplayPrefs', () => {
    assert.ok(!SIDEBAR_JS.includes('_igDisplayPrefs'), 'sidebar must not reference _igDisplayPrefs');
});

test('sidebar.js: does not reference Quick Switcher helpers', () => {
    assert.ok(!SIDEBAR_JS.includes('_qsLoad') && !SIDEBAR_JS.includes('qsToggleEnabled'),
        'sidebar must not reference Quick Switcher internals');
});

test('sidebar.js: does not reference toast/confirm internal state', () => {
    assert.ok(!SIDEBAR_JS.includes('pendingConfirmAction'), 'sidebar must not access pendingConfirmAction');
});

// ─── 23. Comment hygiene ─────────────────────────────────────────────────────

test('sidebar.js: no Arabic characters', () => {
    assert.doesNotMatch(SIDEBAR_JS, /[؀-ۿ]/, 'sidebar.js must contain no Arabic characters');
});

// ─── 24. No-redeclaration: moved identifiers must not exist in app.js ─────────

test('app.js: does not redeclare function renderSidebar (no duplicate binding)', () => {
    assert.doesNotMatch(APP_JS, /^function renderSidebar\(\)/m);
});

test('app.js: does not redeclare function renderSidebarJumpBackIn', () => {
    assert.doesNotMatch(APP_JS, /^function renderSidebarJumpBackIn\(\)/m);
});

test('app.js: does not redeclare function renderSidebarAccountSummary', () => {
    assert.doesNotMatch(APP_JS, /^function renderSidebarAccountSummary\(\)/m);
});

test('app.js: does not redeclare function renderSidebarLibraryPulse', () => {
    assert.doesNotMatch(APP_JS, /^function renderSidebarLibraryPulse\(\)/m);
});

test('app.js: does not redeclare async function navigateToReadyToInstall', () => {
    assert.doesNotMatch(APP_JS, /^async function navigateToReadyToInstall\(\)/m);
});

test('app.js: does not redeclare function updateSidebarPlatformDots', () => {
    assert.doesNotMatch(APP_JS, /^function updateSidebarPlatformDots\(\)/m);
});

test('app.js: does not redeclare function updateSmartSidebarCounts', () => {
    assert.doesNotMatch(APP_JS, /^function updateSmartSidebarCounts\(\)/m);
});

test('app.js: does not redeclare function getReadyToInstallGamesForCounts', () => {
    assert.doesNotMatch(APP_JS, /^function getReadyToInstallGamesForCounts\(\)/m);
});

test('app.js: does not redeclare function getReadyToInstallCount', () => {
    assert.doesNotMatch(APP_JS, /^function getReadyToInstallCount\(\)/m);
});

test('app.js: does not redeclare function getSidebarActionContext', () => {
    assert.doesNotMatch(APP_JS, /^function getSidebarActionContext\(\)/m);
});

test('app.js: does not redeclare function syncSidebarActionButton', () => {
    assert.doesNotMatch(APP_JS, /^function syncSidebarActionButton\(\)/m);
});

test('app.js: does not redeclare function renderSidebarCollectionsList', () => {
    assert.doesNotMatch(APP_JS, /^function renderSidebarCollectionsList\(\)/m);
});

test('app.js: does not redeclare function updateSidebarCards', () => {
    assert.doesNotMatch(APP_JS, /^function updateSidebarCards\(\)/m);
});

test('app.js: does not redeclare function sbToggleSection', () => {
    assert.doesNotMatch(APP_JS, /^function sbToggleSection\(/m);
});

test('app.js: does not redeclare function sbExpandSection', () => {
    assert.doesNotMatch(APP_JS, /^function sbExpandSection\(/m);
});

test('app.js: does not redeclare function _sbApplySectionState', () => {
    assert.doesNotMatch(APP_JS, /^function _sbApplySectionState\(/m);
});

test('app.js: does not redeclare function handleSidebarContextBtn', () => {
    assert.doesNotMatch(APP_JS, /^function handleSidebarContextBtn\(\)/m);
});

test('app.js: does not redeclare function updateSbContextBtn', () => {
    assert.doesNotMatch(APP_JS, /^function updateSbContextBtn\(\)/m);
});

test('app.js: does not redeclare function clearSidebarActiveState', () => {
    assert.doesNotMatch(APP_JS, /^function clearSidebarActiveState\(\)/m);
});

test('app.js: does not redeclare function updateSidebarActiveState', () => {
    assert.doesNotMatch(APP_JS, /^function updateSidebarActiveState\(\)/m);
});

test('app.js: does not redeclare function toggleSidebar', () => {
    assert.doesNotMatch(APP_JS, /^function toggleSidebar\(\)/m);
});

test('app.js: does not redeclare function openSidebarCollection', () => {
    assert.doesNotMatch(APP_JS, /^function openSidebarCollection\(/m);
});

test('app.js: does not redeclare const SB_COLL_MAX', () => {
    assert.doesNotMatch(APP_JS, /^const SB_COLL_MAX/m);
});

// ─── 25. Script load order (dashboard.html) ───────────────────────────────────

test('dashboard.html: sidebar.js script tag is present', () => {
    assert.ok(HTML.includes('src="js/app/sidebar.js"'), 'sidebar.js script must be present in dashboard.html');
});

test('dashboard.html: settings-quick-switcher.js loads before sidebar.js', () => {
    const qsIdx  = HTML.indexOf('src="js/app/settings-quick-switcher.js"');
    const sbIdx  = HTML.indexOf('src="js/app/sidebar.js"');
    assert.ok(qsIdx !== -1 && sbIdx !== -1, 'both script tags must exist');
    assert.ok(qsIdx < sbIdx, 'settings-quick-switcher.js must load before sidebar.js');
});

test('dashboard.html: sidebar.js loads before app.js', () => {
    const sbIdx  = HTML.indexOf('src="js/app/sidebar.js"');
    const appIdx = HTML.indexOf('src="js/app.js"');
    assert.ok(sbIdx !== -1 && appIdx !== -1, 'both script tags must exist');
    assert.ok(sbIdx < appIdx, 'sidebar.js must load before app.js');
});

test('dashboard.html: sidebar.js loads before accounts/display-prefs.js', () => {
    const sbIdx   = HTML.indexOf('src="js/app/sidebar.js"');
    const dpIdx   = HTML.indexOf('src="js/accounts/display-prefs.js"');
    assert.ok(sbIdx !== -1 && dpIdx !== -1, 'both script tags must exist');
    assert.ok(sbIdx < dpIdx, 'sidebar.js must load before display-prefs.js');
});

test('dashboard.html: sidebar.js loads before accounts/platform-panels.js', () => {
    const sbIdx   = HTML.indexOf('src="js/app/sidebar.js"');
    const ppIdx   = HTML.indexOf('src="js/accounts/platform-panels.js"');
    assert.ok(sbIdx !== -1 && ppIdx !== -1, 'both script tags must exist');
    assert.ok(sbIdx < ppIdx, 'sidebar.js must load before platform-panels.js');
});
