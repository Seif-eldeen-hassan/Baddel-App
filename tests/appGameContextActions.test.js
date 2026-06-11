'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT   = path.resolve(__dirname, '..');
const APP_JS = fs.readFileSync(path.join(ROOT, 'src/js/app.js'), 'utf8');
const HTML   = fs.readFileSync(path.join(ROOT, 'src/dashboard.html'), 'utf8');

// ── helpers ───────────────────────────────────────────────────────────────────

function extractFn(src, sig, maxLen = 2000) {
    const idx = src.indexOf(sig);
    if (idx === -1) return '';
    return src.slice(idx, idx + maxLen);
}

// ── 1. Source-presence tests ──────────────────────────────────────────────────

test('app.js: selectedGameId state is declared', () => {
    assert.match(APP_JS, /^let selectedGameId\s*=/m);
});

test('app.js: showContextMenu function exists', () => {
    assert.match(APP_JS, /^function showContextMenu\s*\(/m);
});

test('app.js: hideContextMenu function exists', () => {
    assert.match(APP_JS, /^function hideContextMenu\s*\(\)/m);
});

test('app.js: fixSubmenuPosition function exists', () => {
    assert.match(APP_JS, /^function fixSubmenuPosition\s*\(/m);
});

test('app.js: fixSubmenuPosition.reset static method exists', () => {
    assert.match(APP_JS, /fixSubmenuPosition\.reset\s*=/);
});

test('app.js: triggerRemove function exists', () => {
    assert.match(APP_JS, /^function triggerRemove\s*\(\)/m);
});

test('app.js: confirmDeleteAction function exists', () => {
    assert.match(APP_JS, /^async function confirmDeleteAction\s*\(\)/m);
});

test('app.js: hardDeleteGame function exists', () => {
    assert.match(APP_JS, /^function hardDeleteGame\s*\(/m);
});

test('app.js: toggleTimeTracking function exists', () => {
    assert.match(APP_JS, /^async function toggleTimeTracking\s*\(/m);
});

test('app.js: toggleFavorite function exists', () => {
    assert.match(APP_JS, /^async function toggleFavorite\s*\(/m);
});

test('app.js: _toggleCardFavorite function exists', () => {
    assert.match(APP_JS, /^async function _toggleCardFavorite\s*\(/m);
});

test('app.js: openRecycleBin function exists', () => {
    assert.match(APP_JS, /^async function openRecycleBin\s*\(\)/m);
});

test('app.js: closeRecycleBin function exists', () => {
    assert.match(APP_JS, /^function closeRecycleBin\s*\(\)/m);
});

test('app.js: restoreSelectedGames function exists', () => {
    assert.match(APP_JS, /^async function restoreSelectedGames\s*\(\)/m);
});

// ── 2. showContextMenu behaviour ─────────────────────────────────────────────

test('app.js: showContextMenu assigns selectedGameId from id argument', () => {
    const fn = extractFn(APP_JS, 'function showContextMenu(', 2600);
    assert.match(fn, /selectedGameId\s*=\s*id/);
});

test('app.js: showContextMenu sets data-current-name attribute', () => {
    const fn = extractFn(APP_JS, 'function showContextMenu(', 2600);
    assert.match(fn, /setAttribute\s*\(\s*['"]data-current-name['"]/);
});

test('app.js: showContextMenu looks up fav_system_default collection for like state', () => {
    const fn = extractFn(APP_JS, 'function showContextMenu(', 2600);
    assert.match(fn, /fav_system_default/);
    assert.match(fn, /allCollections\.find/);
});

test('app.js: showContextMenu generates toggleFavorite onclick entries', () => {
    const fn = extractFn(APP_JS, 'function showContextMenu(', 2600);
    assert.match(fn, /toggleFavorite\s*\(/);
});

test('app.js: showContextMenu generates addToCollection submenu from allCollections', () => {
    const fn = extractFn(APP_JS, 'function showContextMenu(', 2600);
    assert.match(fn, /allCollections\.forEach/);
    assert.match(fn, /addToCollection\s*\(/);
});

test('app.js: showContextMenu submenu skips current collectionId and fav_system_default', () => {
    const fn = extractFn(APP_JS, 'function showContextMenu(', 2600);
    assert.match(fn, /currentFilters\.collectionId/);
    assert.match(fn, /fav_system_default/);
});

test('app.js: showContextMenu includes removeFromCurrentCollection when inside a non-fav collection', () => {
    const fn = extractFn(APP_JS, 'function showContextMenu(', 2600);
    assert.match(fn, /removeFromCurrentCollection\s*\(/);
    assert.match(fn, /currentFilters\.collectionId\s*!==\s*null/);
    assert.match(fn, /currentFilters\.collectionId\s*!==\s*['"]fav_system_default['"]/);
});

test('app.js: showContextMenu includes toggleTimeTracking item based on timeTrackingEnabled', () => {
    const fn = extractFn(APP_JS, 'function showContextMenu(', 2600);
    assert.match(fn, /toggleTimeTracking\s*\(/);
    assert.match(fn, /timeTrackingEnabled/);
});

test('app.js: showContextMenu includes triggerPlay entry', () => {
    const fn = extractFn(APP_JS, 'function showContextMenu(', 2600);
    assert.match(fn, /triggerPlay\s*\(\)/);
});

test('app.js: showContextMenu includes openGameSettings entry', () => {
    const fn = extractFn(APP_JS, 'function showContextMenu(', 2600);
    assert.match(fn, /openGameSettings\s*\(/);
});

test('app.js: showContextMenu includes triggerRemove entry', () => {
    const fn = extractFn(APP_JS, 'function showContextMenu(', 2600);
    assert.match(fn, /triggerRemove\s*\(\)/);
});

test('app.js: showContextMenu sets display:block on the menu element', () => {
    const fn = extractFn(APP_JS, 'function showContextMenu(', 2600);
    assert.match(fn, /style\.display\s*=\s*['"]block['"]/);
});

test('app.js: showContextMenu clamps horizontal position when near right edge', () => {
    const fn = extractFn(APP_JS, 'function showContextMenu(', 2600);
    assert.match(fn, /window\.innerWidth/);
    assert.match(fn, /style\.left/);
    assert.match(fn, /style\.top/);
});

// ── 3. hideContextMenu behaviour ─────────────────────────────────────────────

test('app.js: hideContextMenu sets display:none on #contextMenu', () => {
    const fn = extractFn(APP_JS, 'function hideContextMenu()', 200);
    assert.match(fn, /getElementById\s*\(\s*['"]contextMenu['"]\s*\)/);
    assert.match(fn, /style\.display\s*=\s*['"]none['"]/);
});

test('app.js: hideContextMenu calls fixSubmenuPosition.reset', () => {
    const fn = extractFn(APP_JS, 'function hideContextMenu()', 200);
    assert.match(fn, /fixSubmenuPosition\.reset\s*\(\)/);
});

// ── 4. fixSubmenuPosition behaviour ──────────────────────────────────────────

test('app.js: fixSubmenuPosition flips submenu left when near right edge', () => {
    const fn = extractFn(APP_JS, 'function fixSubmenuPosition(', 400);
    assert.match(fn, /window\.innerWidth/);
    assert.match(fn, /s\.style\.left\s*=\s*['"]auto['"]/);
    assert.match(fn, /s\.style\.right\s*=\s*['"]100%['"]/);
});

test('app.js: fixSubmenuPosition.reset sets all submenus back to left:100%', () => {
    const fn = extractFn(APP_JS, 'fixSubmenuPosition.reset =', 200);
    assert.match(fn, /querySelectorAll\s*\(\s*['"]\.submenu['"]\s*\)/);
    assert.match(fn, /style\.left\s*=\s*['"]100%['"]/);
});

// ── 5. window.onclick dismiss handler ────────────────────────────────────────

test('app.js: window.onclick calls hideContextMenu when click is outside #contextMenu', () => {
    const fn = extractFn(APP_JS, 'window.onclick', 850);
    assert.match(fn, /closest\s*\(\s*['"]#contextMenu['"]\s*\)/);
    assert.match(fn, /hideContextMenu\s*\(\)/);
});

// ── 6. triggerRemove behaviour ────────────────────────────────────────────────

test('app.js: triggerRemove calls hideContextMenu before confirm modal', () => {
    const fn = extractFn(APP_JS, 'function triggerRemove()', 400);
    const hideIdx    = fn.indexOf('hideContextMenu');
    const confirmIdx = fn.indexOf('openConfirmModal');
    assert.ok(hideIdx > -1, 'must call hideContextMenu');
    assert.ok(confirmIdx > -1, 'must call openConfirmModal');
    assert.ok(hideIdx < confirmIdx, 'hideContextMenu must come before openConfirmModal');
});

test('app.js: triggerRemove confirmation title mentions Recycle Bin', () => {
    const fn = extractFn(APP_JS, 'function triggerRemove()', 400);
    assert.match(fn, /Recycle Bin|Move to Bin/i);
});

test('app.js: triggerRemove confirm callback delegates to confirmDeleteAction', () => {
    const fn = extractFn(APP_JS, 'function triggerRemove()', 400);
    assert.match(fn, /confirmDeleteAction\s*\(\)/);
});

// ── 7. confirmDeleteAction behaviour ─────────────────────────────────────────

test('app.js: confirmDeleteAction calls electronAPI.removeGame with selectedGameId', () => {
    const fn = extractFn(APP_JS, 'async function confirmDeleteAction()', 600);
    assert.match(fn, /electronAPI\.removeGame\s*\(\s*selectedGameId\s*\)/);
});

test('app.js: confirmDeleteAction shows success toast on success', () => {
    const fn = extractFn(APP_JS, 'async function confirmDeleteAction()', 600);
    assert.match(fn, /showToast\s*\(/);
    assert.match(fn, /success/);
});

test('app.js: confirmDeleteAction filters allGamesData by selectedGameId on success', () => {
    const fn = extractFn(APP_JS, 'async function confirmDeleteAction()', 600);
    assert.match(fn, /allGamesData\s*=\s*allGamesData\.filter/);
    assert.match(fn, /selectedGameId/);
});

test('app.js: confirmDeleteAction refreshes allCollections via getCollections on success', () => {
    const fn = extractFn(APP_JS, 'async function confirmDeleteAction()', 600);
    assert.match(fn, /electronAPI\.getCollections\s*\(\)/);
});

test('app.js: confirmDeleteAction calls applyFilters on success', () => {
    const fn = extractFn(APP_JS, 'async function confirmDeleteAction()', 600);
    assert.match(fn, /applyFilters\s*\(\)/);
});

test('app.js: confirmDeleteAction calls renderRecentlyPlayed on success', () => {
    const fn = extractFn(APP_JS, 'async function confirmDeleteAction()', 600);
    assert.match(fn, /renderRecentlyPlayed\s*\(\)/);
});

test('app.js: confirmDeleteAction calls renderExploreCarousel on success', () => {
    const fn = extractFn(APP_JS, 'async function confirmDeleteAction()', 600);
    assert.match(fn, /renderExploreCarousel\s*\(\)/);
});

test('app.js: confirmDeleteAction clears currentHeroGameId when it matches removed game', () => {
    const fn = extractFn(APP_JS, 'async function confirmDeleteAction()', 850);
    assert.match(fn, /currentHeroGameId/);
    assert.match(fn, /null/);
});

test('app.js: confirmDeleteAction keeps window.allGamesData in sync after removal', () => {
    const fn = extractFn(APP_JS, 'async function confirmDeleteAction()', 600);
    assert.match(fn, /window\.allGamesData\s*=\s*allGamesData/);
});

// ── 8. hardDeleteGame behaviour ───────────────────────────────────────────────

test('app.js: hardDeleteGame confirmation title mentions Delete Forever', () => {
    const fn = extractFn(APP_JS, 'function hardDeleteGame(', 400);
    assert.match(fn, /Delete Forever/i);
});

test('app.js: hardDeleteGame calls electronAPI.deleteGamePermanently', () => {
    const fn = extractFn(APP_JS, 'function hardDeleteGame(', 400);
    assert.match(fn, /electronAPI\.deleteGamePermanently\s*\(/);
});

test('app.js: hardDeleteGame calls openRecycleBin after permanent delete', () => {
    const fn = extractFn(APP_JS, 'function hardDeleteGame(', 400);
    assert.match(fn, /openRecycleBin\s*\(\)/);
});

test('app.js: hardDeleteGame calls reloadLibrary after permanent delete', () => {
    const fn = extractFn(APP_JS, 'function hardDeleteGame(', 400);
    assert.match(fn, /reloadLibrary/);
});

// ── 9. toggleTimeTracking behaviour ──────────────────────────────────────────

test('app.js: toggleTimeTracking calls hideContextMenu first', () => {
    const fn = extractFn(APP_JS, 'async function toggleTimeTracking(', 800);
    const hideIdx  = fn.indexOf('hideContextMenu');
    const apiIdx   = fn.indexOf('electronAPI.setTimeTrackingEnabled');
    assert.ok(hideIdx > -1, 'must call hideContextMenu');
    assert.ok(apiIdx > -1, 'must call setTimeTrackingEnabled');
    assert.ok(hideIdx < apiIdx, 'hideContextMenu must come before API call');
});

test('app.js: toggleTimeTracking calls electronAPI.setTimeTrackingEnabled', () => {
    const fn = extractFn(APP_JS, 'async function toggleTimeTracking(', 800);
    assert.match(fn, /electronAPI\.setTimeTrackingEnabled\s*\(/);
});

test('app.js: toggleTimeTracking updates timeTrackingEnabled on game object in allGamesData', () => {
    const fn = extractFn(APP_JS, 'async function toggleTimeTracking(', 800);
    assert.match(fn, /allGamesData\.find/);
    assert.match(fn, /timeTrackingEnabled\s*=\s*enable/);
});

test('app.js: toggleTimeTracking calls showToast on success', () => {
    const fn = extractFn(APP_JS, 'async function toggleTimeTracking(', 800);
    assert.match(fn, /showToast\s*\(/);
});

test('app.js: toggleTimeTracking calls showToast with error message on failure', () => {
    const fn = extractFn(APP_JS, 'async function toggleTimeTracking(', 1300);
    // success and error both call showToast
    const toastCount = (fn.match(/showToast\s*\(/g) || []).length;
    assert.ok(toastCount >= 2, 'showToast called for both success and failure branches');
});

// ── 10. toggleFavorite behaviour ──────────────────────────────────────────────

test('app.js: toggleFavorite calls hideContextMenu first', () => {
    const fn = extractFn(APP_JS, 'async function toggleFavorite(', 400);
    const hideIdx = fn.indexOf('hideContextMenu');
    const apiIdx  = fn.indexOf('electronAPI.addGameToCollection');
    assert.ok(hideIdx > -1, 'must call hideContextMenu');
    assert.ok(hideIdx < apiIdx, 'hideContextMenu must come first');
});

test('app.js: toggleFavorite calls addGameToCollection when shouldAdd is true', () => {
    const fn = extractFn(APP_JS, 'async function toggleFavorite(', 400);
    assert.match(fn, /electronAPI\.addGameToCollection\s*\(\s*['"]fav_system_default['"]/);
});

test('app.js: toggleFavorite calls removeGameFromCollection when shouldAdd is false', () => {
    const fn = extractFn(APP_JS, 'async function toggleFavorite(', 400);
    assert.match(fn, /electronAPI\.removeGameFromCollection\s*\(\s*['"]fav_system_default['"]/);
});

test('app.js: toggleFavorite refreshes allCollections via getCollections', () => {
    const fn = extractFn(APP_JS, 'async function toggleFavorite(', 400);
    assert.match(fn, /electronAPI\.getCollections\s*\(\)/);
});

test('app.js: toggleFavorite calls renderSidebar', () => {
    const fn = extractFn(APP_JS, 'async function toggleFavorite(', 400);
    assert.match(fn, /renderSidebar\s*\(\)/);
});

test('app.js: toggleFavorite calls applyFilters when currently in fav collection view', () => {
    const fn = extractFn(APP_JS, 'async function toggleFavorite(', 500);
    assert.match(fn, /currentFilters\.collectionId\s*===\s*['"]fav_system_default['"]/);
    assert.match(fn, /applyFilters\s*\(\)/);
});

// ── 11. _toggleCardFavorite behaviour ────────────────────────────────────────

test('app.js: _toggleCardFavorite reads current fav state from allCollections', () => {
    const fn = extractFn(APP_JS, 'async function _toggleCardFavorite(', 800);
    assert.match(fn, /allCollections\.find/);
    assert.match(fn, /fav_system_default/);
});

test('app.js: _toggleCardFavorite calls addGameToCollection when toggling on', () => {
    const fn = extractFn(APP_JS, 'async function _toggleCardFavorite(', 800);
    assert.match(fn, /electronAPI\.addGameToCollection\s*\(\s*['"]fav_system_default['"]/);
});

test('app.js: _toggleCardFavorite calls removeGameFromCollection when toggling off', () => {
    const fn = extractFn(APP_JS, 'async function _toggleCardFavorite(', 800);
    assert.match(fn, /electronAPI\.removeGameFromCollection\s*\(\s*['"]fav_system_default['"]/);
});

test('app.js: _toggleCardFavorite refreshes allCollections and calls renderSidebar', () => {
    const fn = extractFn(APP_JS, 'async function _toggleCardFavorite(', 800);
    assert.match(fn, /electronAPI\.getCollections\s*\(\)/);
    assert.match(fn, /renderSidebar\s*\(\)/);
});

test('app.js: _toggleCardFavorite updates DOM heart buttons by data-id attribute', () => {
    const fn = extractFn(APP_JS, 'async function _toggleCardFavorite(', 800);
    assert.match(fn, /\.gc-fav-btn\[data-id=/);
    assert.match(fn, /querySelectorAll/);
});

test('app.js: _toggleCardFavorite removes card when un-favoriting inside fav collection view', () => {
    const fn = extractFn(APP_JS, 'async function _toggleCardFavorite(', 1600);
    assert.match(fn, /currentFilters\.collectionId\s*===\s*['"]fav_system_default['"]/);
    assert.match(fn, /card\.remove\s*\(\)/);
});

// ── 12. openRecycleBin behaviour ──────────────────────────────────────────────

test('app.js: openRecycleBin adds active class to recycleModal', () => {
    const fn = extractFn(APP_JS, 'async function openRecycleBin()', 1500);
    assert.match(fn, /getElementById\s*\(\s*['"]recycleModal['"]\s*\)/);
    assert.match(fn, /classList\.add\s*\(\s*['"]active['"]\s*\)/);
});

test('app.js: openRecycleBin calls electronAPI.getHiddenGames', () => {
    const fn = extractFn(APP_JS, 'async function openRecycleBin()', 1500);
    assert.match(fn, /electronAPI\.getHiddenGames\s*\(\)/);
});

test('app.js: openRecycleBin renders hardDeleteGame buttons in recycle list', () => {
    const fn = extractFn(APP_JS, 'async function openRecycleBin()', 1500);
    assert.match(fn, /hardDeleteGame\s*\(/);
    assert.match(fn, /getElementById\s*\(\s*['"]recycleList['"]\s*\)/);
});

test('app.js: openRecycleBin uses bin-item class for each item', () => {
    const fn = extractFn(APP_JS, 'async function openRecycleBin()', 800);
    assert.match(fn, /bin-item/);
});

// ── 13. closeRecycleBin behaviour ─────────────────────────────────────────────

test('app.js: closeRecycleBin removes active class from recycleModal', () => {
    const fn = extractFn(APP_JS, 'function closeRecycleBin()', 150);
    assert.match(fn, /getElementById\s*\(\s*['"]recycleModal['"]\s*\)/);
    assert.match(fn, /classList\.remove\s*\(\s*['"]active['"]\s*\)/);
});

// ── 14. restoreSelectedGames behaviour ───────────────────────────────────────

test('app.js: restoreSelectedGames collects checked inputs from recycleList', () => {
    const fn = extractFn(APP_JS, 'async function restoreSelectedGames()', 300);
    assert.match(fn, /#recycleList\s+input\[type="checkbox"\]:checked/);
});

test('app.js: restoreSelectedGames calls electronAPI.restoreSpecificGames', () => {
    const fn = extractFn(APP_JS, 'async function restoreSelectedGames()', 300);
    assert.match(fn, /electronAPI\.restoreSpecificGames\s*\(/);
});

test('app.js: restoreSelectedGames calls closeRecycleBin after restoring', () => {
    const fn = extractFn(APP_JS, 'async function restoreSelectedGames()', 400);
    const restoreIdx = fn.indexOf('restoreSpecificGames');
    const closeIdx   = fn.indexOf('closeRecycleBin');
    assert.ok(restoreIdx > -1, 'must call restoreSpecificGames');
    assert.ok(closeIdx > -1, 'must call closeRecycleBin');
    assert.ok(closeIdx > restoreIdx, 'closeRecycleBin must come after restoreSpecificGames');
});

test('app.js: restoreSelectedGames calls reloadLibrary after restoring', () => {
    const fn = extractFn(APP_JS, 'async function restoreSelectedGames()', 500);
    assert.match(fn, /reloadLibrary\s*\(\)/);
});

// ── 15. DOM tests ─────────────────────────────────────────────────────────────

test('dashboard.html: #contextMenu element exists', () => {
    assert.match(HTML, /id="contextMenu"/);
});

test('dashboard.html: #contextMenu has context-menu class', () => {
    assert.match(HTML, /id="contextMenu"\s+class="context-menu"/);
});

test('dashboard.html: #recycleModal element exists', () => {
    assert.match(HTML, /id="recycleModal"/);
});

test('dashboard.html: #recycleList element exists', () => {
    assert.match(HTML, /id="recycleList"/);
});

test('dashboard.html: openRecycleBin is wired to recycle bin button inline handler', () => {
    assert.match(HTML, /onclick="openRecycleBin\(\)"/);
});

test('dashboard.html: closeRecycleBin is wired to Close button inline handler', () => {
    assert.match(HTML, /onclick="closeRecycleBin\(\)"/);
});

test('dashboard.html: restoreSelectedGames is wired to Restore Selected button inline handler', () => {
    assert.match(HTML, /onclick="restoreSelectedGames\(\)"/);
});

// ── 16. electronAPI dependencies ─────────────────────────────────────────────

test('app.js: confirmDeleteAction depends on electronAPI.removeGame', () => {
    const fn = extractFn(APP_JS, 'async function confirmDeleteAction()', 600);
    assert.match(fn, /electronAPI\.removeGame\b/);
});

test('app.js: confirmDeleteAction depends on electronAPI.getCollections', () => {
    const fn = extractFn(APP_JS, 'async function confirmDeleteAction()', 600);
    assert.match(fn, /electronAPI\.getCollections\b/);
});

test('app.js: hardDeleteGame depends on electronAPI.deleteGamePermanently', () => {
    const fn = extractFn(APP_JS, 'function hardDeleteGame(', 400);
    assert.match(fn, /electronAPI\.deleteGamePermanently\b/);
});

test('app.js: toggleTimeTracking depends on electronAPI.setTimeTrackingEnabled', () => {
    const fn = extractFn(APP_JS, 'async function toggleTimeTracking(', 800);
    assert.match(fn, /electronAPI\.setTimeTrackingEnabled\b/);
});

test('app.js: toggleFavorite depends on electronAPI.addGameToCollection and removeGameFromCollection', () => {
    const fn = extractFn(APP_JS, 'async function toggleFavorite(', 400);
    assert.match(fn, /electronAPI\.addGameToCollection\b/);
    assert.match(fn, /electronAPI\.removeGameFromCollection\b/);
});

test('app.js: toggleFavorite depends on electronAPI.getCollections', () => {
    const fn = extractFn(APP_JS, 'async function toggleFavorite(', 400);
    assert.match(fn, /electronAPI\.getCollections\b/);
});

test('app.js: openRecycleBin depends on electronAPI.getHiddenGames', () => {
    const fn = extractFn(APP_JS, 'async function openRecycleBin()', 1500);
    assert.match(fn, /electronAPI\.getHiddenGames\b/);
});

test('app.js: restoreSelectedGames depends on electronAPI.restoreSpecificGames', () => {
    const fn = extractFn(APP_JS, 'async function restoreSelectedGames()', 300);
    assert.match(fn, /electronAPI\.restoreSpecificGames\b/);
});

// ── 17. Intentional dependencies ─────────────────────────────────────────────

test('app.js: showContextMenu reads allCollections for favorites and collection submenu', () => {
    const fn = extractFn(APP_JS, 'function showContextMenu(', 2600);
    assert.match(fn, /\ballCollections\b/);
});

test('app.js: showContextMenu reads allGamesData for time-tracking state', () => {
    const fn = extractFn(APP_JS, 'function showContextMenu(', 2600);
    assert.match(fn, /\ballGamesData\b/);
});

test('app.js: showContextMenu reads currentFilters.collectionId for remove-from-collection entry', () => {
    const fn = extractFn(APP_JS, 'function showContextMenu(', 2600);
    assert.match(fn, /currentFilters\.collectionId/);
});

test('app.js: confirmDeleteAction uses selectedGameId to remove and filter', () => {
    const fn = extractFn(APP_JS, 'async function confirmDeleteAction()', 600);
    assert.match(fn, /\bselectedGameId\b/);
});

test('app.js: confirmDeleteAction references currentHeroGameId for hero reset', () => {
    const fn = extractFn(APP_JS, 'async function confirmDeleteAction()', 850);
    assert.match(fn, /\bcurrentHeroGameId\b/);
});

test('app.js: confirmDeleteAction depends on showToast for user feedback', () => {
    const fn = extractFn(APP_JS, 'async function confirmDeleteAction()', 600);
    assert.match(fn, /\bshowToast\b/);
});

test('app.js: confirmDeleteAction depends on applyFilters, renderRecentlyPlayed, renderExploreCarousel', () => {
    const fn = extractFn(APP_JS, 'async function confirmDeleteAction()', 600);
    assert.match(fn, /\bapplyFilters\b/);
    assert.match(fn, /\brenderRecentlyPlayed\b/);
    assert.match(fn, /\brenderExploreCarousel\b/);
});

test('app.js: triggerRemove depends on hideContextMenu and openConfirmModal', () => {
    const fn = extractFn(APP_JS, 'function triggerRemove()', 400);
    assert.match(fn, /\bhideContextMenu\b/);
    assert.match(fn, /\bopenConfirmModal\b/);
});

test('app.js: hardDeleteGame depends on openConfirmModal, _clearArtworkLocalState, openRecycleBin, reloadLibrary', () => {
    const fn = extractFn(APP_JS, 'function hardDeleteGame(', 400);
    assert.match(fn, /\bopenConfirmModal\b/);
    assert.match(fn, /\b_clearArtworkLocalState\b/);
    assert.match(fn, /\bopenRecycleBin\b/);
    assert.match(fn, /\breloadLibrary\b/);
});

test('app.js: toggleTimeTracking depends on allGamesData for game lookup', () => {
    const fn = extractFn(APP_JS, 'async function toggleTimeTracking(', 800);
    assert.match(fn, /\ballGamesData\b/);
});

test('app.js: toggleFavorite depends on renderSidebar and applyFilters', () => {
    const fn = extractFn(APP_JS, 'async function toggleFavorite(', 500);
    assert.match(fn, /\brenderSidebar\b/);
    assert.match(fn, /\bapplyFilters\b/);
});

test('app.js: _toggleCardFavorite depends on allCollections, renderSidebar, currentFilters', () => {
    const fn = extractFn(APP_JS, 'async function _toggleCardFavorite(', 1600);
    assert.match(fn, /\ballCollections\b/);
    assert.match(fn, /\brenderSidebar\b/);
    assert.match(fn, /currentFilters\.collectionId/);
});

// ── 18. Cross-file callers ────────────────────────────────────────────────────

test('app.js: showContextMenu is invoked from game-card contextmenu event handlers in app.js', () => {
    // Game card builders call showContextMenu in their contextmenu event listeners
    const count = (APP_JS.match(/showContextMenu\s*\(/g) || []).length;
    assert.ok(count >= 2, 'showContextMenu must be called from at least two card-building sites');
});

test('dashboard.html: hardDeleteGame is NOT wired as a static inline handler (dynamic only via openRecycleBin)', () => {
    // hardDeleteGame is injected dynamically by openRecycleBin, not via a static onclick in HTML
    assert.doesNotMatch(HTML, /onclick="hardDeleteGame\(/);
});

test('app.js: addToCollection referenced inside showContextMenu submenu HTML', () => {
    const fn = extractFn(APP_JS, 'function showContextMenu(', 2600);
    assert.match(fn, /addToCollection\s*\(/);
});

test('app.js: removeFromCurrentCollection referenced inside showContextMenu HTML', () => {
    const fn = extractFn(APP_JS, 'function showContextMenu(', 2600);
    assert.match(fn, /removeFromCurrentCollection\s*\(/);
});

// ── 19. Isolation tests ───────────────────────────────────────────────────────

test('app.js: showContextMenu does not call quick-switcher internals', () => {
    const fn = extractFn(APP_JS, 'function showContextMenu(', 2600);
    assert.doesNotMatch(fn, /openSettingsQuickSwitcher|closeSettingsQuickSwitcher|renderQuickSwitcher/);
});

test('app.js: showContextMenu does not call system stats internals', () => {
    const fn = extractFn(APP_JS, 'function showContextMenu(', 2600);
    assert.doesNotMatch(fn, /initSystemStats|_hudInterval|checkAndManagePolling/);
});

test('app.js: showContextMenu does not call hero internals', () => {
    const fn = extractFn(APP_JS, 'function showContextMenu(', 2600);
    assert.doesNotMatch(fn, /setHeroGame|_heroBgApply|setHeroBgStable/);
});

test('app.js: triggerRemove does not call platform panel or account display preference internals', () => {
    const fn = extractFn(APP_JS, 'function triggerRemove()', 400);
    assert.doesNotMatch(fn, /renderPlatformPanels|updateDisplayPrefs|applyDisplayPreferences/);
});

test('app.js: hardDeleteGame does not call collection settings modal internals', () => {
    const fn = extractFn(APP_JS, 'function hardDeleteGame(', 400);
    assert.doesNotMatch(fn, /openCollectionSettings|closeCollectionSettings|saveCollectionSettings/);
});

test('app.js: confirmDeleteAction does not call hero internals directly', () => {
    const fn = extractFn(APP_JS, 'async function confirmDeleteAction()', 600);
    assert.doesNotMatch(fn, /setHeroGame\s*\(|_heroBgApply\s*\(|setHeroBgStable\s*\(/);
});

// ── 20. Comment hygiene ───────────────────────────────────────────────────────

test('app.js: context-menu section contains no Arabic characters', () => {
    const fn = extractFn(APP_JS, 'function showContextMenu(', 3000);
    assert.doesNotMatch(fn, /[؀-ۿ]/);
});

test('app.js: delete/remove helpers section contains no Arabic characters', () => {
    const fn = extractFn(APP_JS, 'function triggerRemove()', 1000);
    assert.doesNotMatch(fn, /[؀-ۿ]/);
});
