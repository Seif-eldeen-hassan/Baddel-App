'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT            = path.resolve(__dirname, '..');
const APP_JS          = fs.readFileSync(path.join(ROOT, 'src/js/app.js'),                        'utf8');
const GAME_CARD_JS    = fs.readFileSync(path.join(ROOT, 'src/js/app/game-card.js'),               'utf8');
const GAME_CONTEXT_JS = fs.readFileSync(path.join(ROOT, 'src/js/app/game-context-actions.js'),   'utf8');
const HTML            = fs.readFileSync(path.join(ROOT, 'src/dashboard.html'),                   'utf8');

// ── helpers ───────────────────────────────────────────────────────────────────

function extractFn(src, sig, maxLen = 2000) {
    const idx = src.indexOf(sig);
    if (idx === -1) return '';
    return src.slice(idx, idx + maxLen);
}

// ── 1. Source-presence tests ──────────────────────────────────────────────────

test('game-context-actions.js: selectedGameId state is declared', () => {
    assert.match(GAME_CONTEXT_JS, /^let selectedGameId\s*=/m);
});

test('game-context-actions.js: showContextMenu function exists', () => {
    assert.match(GAME_CONTEXT_JS, /^function showContextMenu\s*\(/m);
});

test('game-context-actions.js: hideContextMenu function exists', () => {
    assert.match(GAME_CONTEXT_JS, /^function hideContextMenu\s*\(\)/m);
});

test('game-context-actions.js: fixSubmenuPosition function exists', () => {
    assert.match(GAME_CONTEXT_JS, /^function fixSubmenuPosition\s*\(/m);
});

test('game-context-actions.js: fixSubmenuPosition.reset static method exists', () => {
    assert.match(GAME_CONTEXT_JS, /fixSubmenuPosition\.reset\s*=/);
});

test('game-context-actions.js: triggerRemove function exists', () => {
    assert.match(GAME_CONTEXT_JS, /^function triggerRemove\s*\(/m);
});

test('game-context-actions.js: confirmDeleteAction function exists', () => {
    assert.match(GAME_CONTEXT_JS, /^async function confirmDeleteAction\s*\(/m);
});

test('game-context-actions.js: hardDeleteGame function exists', () => {
    assert.match(GAME_CONTEXT_JS, /^function hardDeleteGame\s*\(/m);
});

test('game-context-actions.js: toggleTimeTracking function exists', () => {
    assert.match(GAME_CONTEXT_JS, /^async function toggleTimeTracking\s*\(/m);
});

test('game-context-actions.js: toggleFavorite function exists', () => {
    assert.match(GAME_CONTEXT_JS, /^async function toggleFavorite\s*\(/m);
});

test('game-context-actions.js: _toggleCardFavorite function exists', () => {
    assert.match(GAME_CONTEXT_JS, /^async function _toggleCardFavorite\s*\(/m);
});

test('game-context-actions.js: openRecycleBin function exists', () => {
    assert.match(GAME_CONTEXT_JS, /^async function openRecycleBin\s*\(\)/m);
});

test('game-context-actions.js: closeRecycleBin function exists', () => {
    assert.match(GAME_CONTEXT_JS, /^function closeRecycleBin\s*\(\)/m);
});

test('game-context-actions.js: restoreSelectedGames function exists', () => {
    assert.match(GAME_CONTEXT_JS, /^async function restoreSelectedGames\s*\(\)/m);
});

// ── 2. showContextMenu behaviour ─────────────────────────────────────────────

test('game-context-actions.js: showContextMenu assigns selectedGameId from id argument', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'function showContextMenu(', 2600);
    assert.match(fn, /selectedGameId\s*=\s*id/);
});

test('game-context-actions.js: showContextMenu sets data-current-name attribute', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'function showContextMenu(', 2600);
    assert.match(fn, /setAttribute\s*\(\s*['"]data-current-name['"]/);
});

test('game-context-actions.js: showContextMenu looks up fav_system_default collection for like state', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'function showContextMenu(', 2600);
    assert.match(fn, /fav_system_default/);
    assert.match(fn, /allCollections\.find/);
});

test('game-context-actions.js: showContextMenu generates _toggleCardFavorite onclick entries', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'function showContextMenu(', 2600);
    assert.match(fn, /_toggleCardFavorite\s*\(/);
});

test('game-context-actions.js: showContextMenu generates addToCollection submenu from allCollections', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'function showContextMenu(', 2600);
    assert.match(fn, /allCollections\.forEach/);
    assert.match(fn, /addToCollection\s*\(/);
});

test('game-context-actions.js: showContextMenu submenu skips current collectionId and fav_system_default', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'function showContextMenu(', 2600);
    assert.match(fn, /currentFilters\.collectionId/);
    assert.match(fn, /fav_system_default/);
});

test('game-context-actions.js: showContextMenu includes removeFromCurrentCollection when inside a non-fav collection', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'function showContextMenu(', 2600);
    assert.match(fn, /removeFromCurrentCollection\s*\(/);
    assert.match(fn, /currentFilters\.collectionId\s*!==\s*null/);
    assert.match(fn, /currentFilters\.collectionId\s*!==\s*['"]fav_system_default['"]/);
});

test('game-context-actions.js: showContextMenu includes toggleTimeTracking item based on timeTrackingEnabled', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'function showContextMenu(', 2600);
    assert.match(fn, /toggleTimeTracking\s*\(/);
    assert.match(fn, /timeTrackingEnabled/);
});

test('game-context-actions.js: showContextMenu includes triggerPlay entry', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'function showContextMenu(', 2600);
    assert.match(fn, /triggerPlay\s*\(\)/);
});

test('game-context-actions.js: showContextMenu includes openGameSettings entry', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'function showContextMenu(', 2600);
    assert.match(fn, /openGameSettings\s*\(/);
});

test('game-context-actions.js: showContextMenu includes triggerRemove entry with explicit id', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'function showContextMenu(', 2600);
    assert.match(fn, /triggerRemove\s*\(/);
});

test('game-context-actions.js: showContextMenu sets display:block on the menu element', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'function showContextMenu(', 2600);
    assert.match(fn, /style\.display\s*=\s*['"]block['"]/);
});

test('game-context-actions.js: showContextMenu clamps horizontal position when near right edge', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'function showContextMenu(', 2600);
    assert.match(fn, /window\.innerWidth/);
    assert.match(fn, /style\.left/);
    assert.match(fn, /style\.top/);
});

// ── 3. hideContextMenu behaviour ─────────────────────────────────────────────

test('game-context-actions.js: hideContextMenu sets display:none on #contextMenu', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'function hideContextMenu()', 200);
    assert.match(fn, /getElementById\s*\(\s*['"]contextMenu['"]\s*\)/);
    assert.match(fn, /style\.display\s*=\s*['"]none['"]/);
});

test('game-context-actions.js: hideContextMenu calls fixSubmenuPosition.reset', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'function hideContextMenu()', 200);
    assert.match(fn, /fixSubmenuPosition\.reset\s*\(\)/);
});

// ── 4. fixSubmenuPosition behaviour ──────────────────────────────────────────

test('game-context-actions.js: fixSubmenuPosition flips submenu left when near right edge', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'function fixSubmenuPosition(', 400);
    assert.match(fn, /window\.innerWidth/);
    assert.match(fn, /s\.style\.left\s*=\s*['"]auto['"]/);
    assert.match(fn, /s\.style\.right\s*=\s*['"]100%['"]/);
});

test('game-context-actions.js: fixSubmenuPosition.reset sets all submenus back to left:100%', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'fixSubmenuPosition.reset =', 200);
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

test('game-context-actions.js: triggerRemove calls hideContextMenu before confirm modal', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'function triggerRemove(', 400);
    const hideIdx    = fn.indexOf('hideContextMenu');
    const confirmIdx = fn.indexOf('openConfirmModal');
    assert.ok(hideIdx > -1, 'must call hideContextMenu');
    assert.ok(confirmIdx > -1, 'must call openConfirmModal');
    assert.ok(hideIdx < confirmIdx, 'hideContextMenu must come before openConfirmModal');
});

test('game-context-actions.js: triggerRemove confirmation title mentions Recycle Bin', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'function triggerRemove(', 400);
    assert.match(fn, /Recycle Bin|Move to Bin/i);
});

test('game-context-actions.js: triggerRemove confirm callback delegates to confirmDeleteAction', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'function triggerRemove(', 400);
    assert.match(fn, /confirmDeleteAction\s*\(/);
});

// ── 7. confirmDeleteAction behaviour ─────────────────────────────────────────

test('game-context-actions.js: confirmDeleteAction calls electronAPI.removeGame with resolved id', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'async function confirmDeleteAction(', 600);
    assert.match(fn, /electronAPI\.removeGame\s*\(\s*id\s*\)/);
});

test('game-context-actions.js: confirmDeleteAction shows success toast on success', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'async function confirmDeleteAction(', 600);
    assert.match(fn, /showToast\s*\(/);
    assert.match(fn, /success/);
});

test('game-context-actions.js: confirmDeleteAction filters allGamesData using resolved id on success', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'async function confirmDeleteAction(', 800);
    assert.match(fn, /allGamesData\s*=\s*allGamesData\.filter/);
    assert.match(fn, /selectedGameId/);
});

test('game-context-actions.js: confirmDeleteAction refreshes allCollections via getCollections on success', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'async function confirmDeleteAction(', 1150);
    assert.match(fn, /electronAPI\.getCollections\s*\(\)/);
});

test('game-context-actions.js: confirmDeleteAction calls applyFilters on success', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'async function confirmDeleteAction(', 900);
    assert.match(fn, /applyFilters\s*\(\)/);
});

test('game-context-actions.js: confirmDeleteAction calls renderRecentlyPlayed on success', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'async function confirmDeleteAction(', 950);
    assert.match(fn, /renderRecentlyPlayed\s*\(\)/);
});

test('game-context-actions.js: confirmDeleteAction calls renderExploreCarousel on success', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'async function confirmDeleteAction(', 1000);
    assert.match(fn, /renderExploreCarousel\s*\(\)/);
});

test('game-context-actions.js: confirmDeleteAction clears currentHeroGameId when it matches removed game', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'async function confirmDeleteAction(', 1000);
    assert.match(fn, /currentHeroGameId/);
    assert.match(fn, /null/);
});

test('game-context-actions.js: confirmDeleteAction keeps window.allGamesData in sync after removal', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'async function confirmDeleteAction(', 850);
    assert.match(fn, /window\.allGamesData\s*=\s*allGamesData/);
});

// ── 8. hardDeleteGame behaviour ───────────────────────────────────────────────

test('game-context-actions.js: hardDeleteGame confirmation title mentions Delete Forever', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'function hardDeleteGame(', 400);
    assert.match(fn, /Delete Forever/i);
});

test('game-context-actions.js: hardDeleteGame calls electronAPI.deleteGamePermanently', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'function hardDeleteGame(', 400);
    assert.match(fn, /electronAPI\.deleteGamePermanently\s*\(/);
});

test('game-context-actions.js: hardDeleteGame calls _clearArtworkLocalState', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'function hardDeleteGame(', 400);
    assert.match(fn, /_clearArtworkLocalState\s*\(/);
});

test('game-context-actions.js: hardDeleteGame calls openRecycleBin after permanent delete', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'function hardDeleteGame(', 400);
    assert.match(fn, /openRecycleBin\s*\(\)/);
});

test('game-context-actions.js: hardDeleteGame calls reloadLibrary after permanent delete', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'function hardDeleteGame(', 400);
    assert.match(fn, /reloadLibrary/);
});

// ── 9. toggleTimeTracking behaviour ──────────────────────────────────────────

test('game-context-actions.js: toggleTimeTracking calls hideContextMenu first', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'async function toggleTimeTracking(', 800);
    const hideIdx  = fn.indexOf('hideContextMenu');
    const apiIdx   = fn.indexOf('electronAPI.setTimeTrackingEnabled');
    assert.ok(hideIdx > -1, 'must call hideContextMenu');
    assert.ok(apiIdx > -1, 'must call setTimeTrackingEnabled');
    assert.ok(hideIdx < apiIdx, 'hideContextMenu must come before API call');
});

test('game-context-actions.js: toggleTimeTracking calls electronAPI.setTimeTrackingEnabled', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'async function toggleTimeTracking(', 800);
    assert.match(fn, /electronAPI\.setTimeTrackingEnabled\s*\(/);
});

test('game-context-actions.js: toggleTimeTracking updates timeTrackingEnabled on game object in allGamesData', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'async function toggleTimeTracking(', 800);
    assert.match(fn, /allGamesData\.find/);
    assert.match(fn, /timeTrackingEnabled\s*=\s*enable/);
});

test('game-context-actions.js: toggleTimeTracking calls showToast on success', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'async function toggleTimeTracking(', 800);
    assert.match(fn, /showToast\s*\(/);
});

test('game-context-actions.js: toggleTimeTracking calls showToast with error message on failure', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'async function toggleTimeTracking(', 1300);
    const toastCount = (fn.match(/showToast\s*\(/g) || []).length;
    assert.ok(toastCount >= 2, 'showToast called for both success and failure branches');
});

// ── 10. toggleFavorite behaviour ──────────────────────────────────────────────

test('game-context-actions.js: toggleFavorite calls hideContextMenu first', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'async function toggleFavorite(', 400);
    const hideIdx = fn.indexOf('hideContextMenu');
    const apiIdx  = fn.indexOf('electronAPI.addGameToCollection');
    assert.ok(hideIdx > -1, 'must call hideContextMenu');
    assert.ok(hideIdx < apiIdx, 'hideContextMenu must come first');
});

test('game-context-actions.js: toggleFavorite calls addGameToCollection when shouldAdd is true', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'async function toggleFavorite(', 400);
    assert.match(fn, /electronAPI\.addGameToCollection\s*\(\s*['"]fav_system_default['"]/);
});

test('game-context-actions.js: toggleFavorite calls removeGameFromCollection when shouldAdd is false', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'async function toggleFavorite(', 400);
    assert.match(fn, /electronAPI\.removeGameFromCollection\s*\(\s*['"]fav_system_default['"]/);
});

test('game-context-actions.js: toggleFavorite refreshes allCollections via getCollections', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'async function toggleFavorite(', 400);
    assert.match(fn, /electronAPI\.getCollections\s*\(\)/);
});

test('game-context-actions.js: toggleFavorite calls renderSidebar', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'async function toggleFavorite(', 400);
    assert.match(fn, /renderSidebar\s*\(\)/);
});

test('game-context-actions.js: toggleFavorite calls applyFilters when currently in fav collection view', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'async function toggleFavorite(', 500);
    assert.match(fn, /currentFilters\.collectionId\s*===\s*['"]fav_system_default['"]/);
    assert.match(fn, /applyFilters\s*\(\)/);
});

// ── 11. _toggleCardFavorite behaviour ────────────────────────────────────────

test('game-context-actions.js: _toggleCardFavorite reads current fav state from allCollections', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'async function _toggleCardFavorite(', 800);
    assert.match(fn, /allCollections\.find/);
    assert.match(fn, /fav_system_default/);
});

test('game-context-actions.js: _toggleCardFavorite calls addGameToCollection when toggling on', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'async function _toggleCardFavorite(', 800);
    assert.match(fn, /electronAPI\.addGameToCollection\s*\(\s*['"]fav_system_default['"]/);
});

test('game-context-actions.js: _toggleCardFavorite calls removeGameFromCollection when toggling off', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'async function _toggleCardFavorite(', 800);
    assert.match(fn, /electronAPI\.removeGameFromCollection\s*\(\s*['"]fav_system_default['"]/);
});

test('game-context-actions.js: _toggleCardFavorite refreshes allCollections and calls renderSidebar', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'async function _toggleCardFavorite(', 1620);
    assert.match(fn, /electronAPI\.getCollections\s*\(\)/);
    assert.match(fn, /renderSidebar\s*\(\)/);
});

test('game-context-actions.js: _toggleCardFavorite updates DOM heart buttons by data-id attribute', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'async function _toggleCardFavorite(', 800);
    assert.match(fn, /\.gc-fav-btn\[data-id=/);
    assert.match(fn, /querySelectorAll/);
});

test('game-context-actions.js: _toggleCardFavorite removes card when un-favoriting inside fav collection view', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'async function _toggleCardFavorite(', 1620);
    assert.match(fn, /currentFilters\.collectionId\s*===\s*['"]fav_system_default['"]/);
    assert.match(fn, /card\.remove\s*\(\)/);
});

test('game-context-actions.js: _toggleCardFavorite DOM heart update appears before allCollections refresh', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'async function _toggleCardFavorite(', 1620);
    const heartPos = fn.indexOf('gc-fav-active');
    const collectionsPos = fn.indexOf('electronAPI.getCollections');
    assert.ok(heartPos > 0, 'heart toggle must exist');
    assert.ok(collectionsPos > 0, 'getCollections must exist');
    assert.ok(heartPos < collectionsPos, 'heart DOM update must happen before allCollections refresh');
});

test('game-context-actions.js: confirmDeleteAction applyFilters appears before allCollections refresh', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'async function confirmDeleteAction(', 1200);
    const applyPos = fn.indexOf('applyFilters()');
    const collectionsPos = fn.indexOf('electronAPI.getCollections');
    assert.ok(applyPos > 0, 'applyFilters must exist');
    assert.ok(collectionsPos > 0, 'getCollections must exist');
    assert.ok(applyPos < collectionsPos, 'view refresh must happen before allCollections IPC call');
});

// ── 12. openRecycleBin behaviour ──────────────────────────────────────────────

test('game-context-actions.js: openRecycleBin adds active class to recycleModal', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'async function openRecycleBin()', 1500);
    assert.match(fn, /getElementById\s*\(\s*['"]recycleModal['"]\s*\)/);
    assert.match(fn, /classList\.add\s*\(\s*['"]active['"]\s*\)/);
});

test('game-context-actions.js: openRecycleBin calls electronAPI.getHiddenGames', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'async function openRecycleBin()', 1500);
    assert.match(fn, /electronAPI\.getHiddenGames\s*\(\)/);
});

test('game-context-actions.js: openRecycleBin renders hardDeleteGame buttons in recycle list', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'async function openRecycleBin()', 1500);
    assert.match(fn, /hardDeleteGame\s*\(/);
    assert.match(fn, /getElementById\s*\(\s*['"]recycleList['"]\s*\)/);
});

test('game-context-actions.js: openRecycleBin uses bin-item class for each item', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'async function openRecycleBin()', 1500);
    assert.match(fn, /bin-item/);
});

// ── 13. closeRecycleBin behaviour ─────────────────────────────────────────────

test('game-context-actions.js: closeRecycleBin removes active class from recycleModal', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'function closeRecycleBin()', 150);
    assert.match(fn, /getElementById\s*\(\s*['"]recycleModal['"]\s*\)/);
    assert.match(fn, /classList\.remove\s*\(\s*['"]active['"]\s*\)/);
});

// ── 14. restoreSelectedGames behaviour ───────────────────────────────────────

test('game-context-actions.js: restoreSelectedGames collects checked inputs from recycleList', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'async function restoreSelectedGames()', 500);
    assert.match(fn, /#recycleList\s+input\[type="checkbox"\]:checked/);
});

test('game-context-actions.js: restoreSelectedGames calls electronAPI.restoreSpecificGames', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'async function restoreSelectedGames()', 500);
    assert.match(fn, /electronAPI\.restoreSpecificGames\s*\(/);
});

test('game-context-actions.js: restoreSelectedGames calls closeRecycleBin after restoring', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'async function restoreSelectedGames()', 400);
    const restoreIdx = fn.indexOf('restoreSpecificGames');
    const closeIdx   = fn.indexOf('closeRecycleBin');
    assert.ok(restoreIdx > -1, 'must call restoreSpecificGames');
    assert.ok(closeIdx > -1, 'must call closeRecycleBin');
    assert.ok(closeIdx > restoreIdx, 'closeRecycleBin must come after restoreSpecificGames');
});

test('game-context-actions.js: restoreSelectedGames calls reloadLibrary after restoring', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'async function restoreSelectedGames()', 500);
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

test('game-context-actions.js: confirmDeleteAction depends on electronAPI.removeGame', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'async function confirmDeleteAction(', 600);
    assert.match(fn, /electronAPI\.removeGame\b/);
});

test('game-context-actions.js: confirmDeleteAction depends on electronAPI.getCollections', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'async function confirmDeleteAction(', 1150);
    assert.match(fn, /electronAPI\.getCollections\b/);
});

test('game-context-actions.js: hardDeleteGame depends on electronAPI.deleteGamePermanently', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'function hardDeleteGame(', 400);
    assert.match(fn, /electronAPI\.deleteGamePermanently\b/);
});

test('game-context-actions.js: toggleTimeTracking depends on electronAPI.setTimeTrackingEnabled', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'async function toggleTimeTracking(', 800);
    assert.match(fn, /electronAPI\.setTimeTrackingEnabled\b/);
});

test('game-context-actions.js: toggleFavorite depends on electronAPI.addGameToCollection and removeGameFromCollection', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'async function toggleFavorite(', 400);
    assert.match(fn, /electronAPI\.addGameToCollection\b/);
    assert.match(fn, /electronAPI\.removeGameFromCollection\b/);
});

test('game-context-actions.js: toggleFavorite depends on electronAPI.getCollections', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'async function toggleFavorite(', 400);
    assert.match(fn, /electronAPI\.getCollections\b/);
});

test('game-context-actions.js: openRecycleBin depends on electronAPI.getHiddenGames', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'async function openRecycleBin()', 1500);
    assert.match(fn, /electronAPI\.getHiddenGames\b/);
});

test('game-context-actions.js: restoreSelectedGames depends on electronAPI.restoreSpecificGames', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'async function restoreSelectedGames()', 500);
    assert.match(fn, /electronAPI\.restoreSpecificGames\b/);
});

// ── 17. Intentional dependencies ─────────────────────────────────────────────

test('game-context-actions.js: showContextMenu reads allCollections for favorites and collection submenu', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'function showContextMenu(', 2600);
    assert.match(fn, /\ballCollections\b/);
});

test('game-context-actions.js: showContextMenu reads allGamesData for time-tracking state', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'function showContextMenu(', 2600);
    assert.match(fn, /\ballGamesData\b/);
});

test('game-context-actions.js: showContextMenu reads currentFilters.collectionId for remove-from-collection entry', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'function showContextMenu(', 2600);
    assert.match(fn, /currentFilters\.collectionId/);
});

test('game-context-actions.js: confirmDeleteAction uses selectedGameId to remove and filter', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'async function confirmDeleteAction(', 600);
    assert.match(fn, /\bselectedGameId\b/);
});

test('game-context-actions.js: confirmDeleteAction references currentHeroGameId for hero reset', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'async function confirmDeleteAction(', 1000);
    assert.match(fn, /\bcurrentHeroGameId\b/);
});

test('game-context-actions.js: confirmDeleteAction depends on showToast for user feedback', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'async function confirmDeleteAction(', 600);
    assert.match(fn, /\bshowToast\b/);
});

test('game-context-actions.js: confirmDeleteAction depends on applyFilters, renderRecentlyPlayed, renderExploreCarousel', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'async function confirmDeleteAction(', 1000);
    assert.match(fn, /\bapplyFilters\b/);
    assert.match(fn, /\brenderRecentlyPlayed\b/);
    assert.match(fn, /\brenderExploreCarousel\b/);
});

test('game-context-actions.js: triggerRemove depends on hideContextMenu and openConfirmModal', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'function triggerRemove(', 400);
    assert.match(fn, /\bhideContextMenu\b/);
    assert.match(fn, /\bopenConfirmModal\b/);
});

test('game-context-actions.js: hardDeleteGame depends on openConfirmModal, _clearArtworkLocalState, openRecycleBin, reloadLibrary', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'function hardDeleteGame(', 400);
    assert.match(fn, /\bopenConfirmModal\b/);
    assert.match(fn, /\b_clearArtworkLocalState\b/);
    assert.match(fn, /\bopenRecycleBin\b/);
    assert.match(fn, /\breloadLibrary\b/);
});

test('game-context-actions.js: toggleTimeTracking depends on allGamesData for game lookup', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'async function toggleTimeTracking(', 800);
    assert.match(fn, /\ballGamesData\b/);
});

test('game-context-actions.js: toggleFavorite depends on renderSidebar and applyFilters', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'async function toggleFavorite(', 500);
    assert.match(fn, /\brenderSidebar\b/);
    assert.match(fn, /\bapplyFilters\b/);
});

test('game-context-actions.js: _toggleCardFavorite depends on allCollections, renderSidebar, currentFilters', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'async function _toggleCardFavorite(', 1600);
    assert.match(fn, /\ballCollections\b/);
    assert.match(fn, /\brenderSidebar\b/);
    assert.match(fn, /currentFilters\.collectionId/);
});

// ── 18. Cross-file callers ────────────────────────────────────────────────────

test('game-card.js: showContextMenu is invoked from game-card contextmenu event handlers in game-card.js', () => {
    const count = (GAME_CARD_JS.match(/showContextMenu\s*\(/g) || []).length;
    assert.ok(count >= 2, 'showContextMenu must be called from at least two card-building sites');
});

test('dashboard.html: hardDeleteGame is NOT wired as a static inline handler (dynamic only via openRecycleBin)', () => {
    assert.doesNotMatch(HTML, /onclick="hardDeleteGame\(/);
});

test('game-context-actions.js: addToCollection referenced inside showContextMenu submenu HTML', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'function showContextMenu(', 2600);
    assert.match(fn, /addToCollection\s*\(/);
});

test('game-context-actions.js: removeFromCurrentCollection referenced inside showContextMenu HTML', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'function showContextMenu(', 2600);
    assert.match(fn, /removeFromCurrentCollection\s*\(/);
});

// ── 19. Isolation tests ───────────────────────────────────────────────────────

test('game-context-actions.js: showContextMenu does not call quick-switcher internals', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'function showContextMenu(', 2600);
    assert.doesNotMatch(fn, /openSettingsQuickSwitcher|closeSettingsQuickSwitcher|renderQuickSwitcher/);
});

test('game-context-actions.js: showContextMenu does not call system stats internals', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'function showContextMenu(', 2600);
    assert.doesNotMatch(fn, /initSystemStats|_hudInterval|checkAndManagePolling/);
});

test('game-context-actions.js: showContextMenu does not call hero internals', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'function showContextMenu(', 2600);
    assert.doesNotMatch(fn, /setHeroGame|_heroBgApply|setHeroBgStable/);
});

test('game-context-actions.js: triggerRemove does not call platform panel or account display preference internals', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'function triggerRemove(', 400);
    assert.doesNotMatch(fn, /renderPlatformPanels|updateDisplayPrefs|applyDisplayPreferences/);
});

test('game-context-actions.js: hardDeleteGame does not call collection settings modal internals', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'function hardDeleteGame(', 400);
    assert.doesNotMatch(fn, /openCollectionSettings|closeCollectionSettings|saveCollectionSettings/);
});

test('game-context-actions.js: confirmDeleteAction does not call hero internals directly', () => {
    const fn = extractFn(GAME_CONTEXT_JS, 'async function confirmDeleteAction(', 600);
    assert.doesNotMatch(fn, /setHeroGame\s*\(|_heroBgApply\s*\(|setHeroBgStable\s*\(/);
});

// ── 20. Window export tests ───────────────────────────────────────────────────

test('game-context-actions.js: exports showContextMenu on window', () => {
    assert.match(GAME_CONTEXT_JS, /window\.showContextMenu\s*=\s*showContextMenu/);
});

test('game-context-actions.js: exports hideContextMenu on window', () => {
    assert.match(GAME_CONTEXT_JS, /window\.hideContextMenu\s*=\s*hideContextMenu/);
});

test('game-context-actions.js: exports fixSubmenuPosition on window', () => {
    assert.match(GAME_CONTEXT_JS, /window\.fixSubmenuPosition\s*=\s*fixSubmenuPosition/);
});

test('game-context-actions.js: exports triggerRemove on window', () => {
    assert.match(GAME_CONTEXT_JS, /window\.triggerRemove\s*=\s*triggerRemove/);
});

test('game-context-actions.js: exports confirmDeleteAction on window', () => {
    assert.match(GAME_CONTEXT_JS, /window\.confirmDeleteAction\s*=\s*confirmDeleteAction/);
});

test('game-context-actions.js: exports hardDeleteGame on window', () => {
    assert.match(GAME_CONTEXT_JS, /window\.hardDeleteGame\s*=\s*hardDeleteGame/);
});

test('game-context-actions.js: exports toggleTimeTracking on window', () => {
    assert.match(GAME_CONTEXT_JS, /window\.toggleTimeTracking\s*=\s*toggleTimeTracking/);
});

test('game-context-actions.js: exports toggleFavorite on window', () => {
    assert.match(GAME_CONTEXT_JS, /window\.toggleFavorite\s*=\s*toggleFavorite/);
});

test('game-context-actions.js: exports _toggleCardFavorite on window', () => {
    assert.match(GAME_CONTEXT_JS, /window\._toggleCardFavorite\s*=\s*_toggleCardFavorite/);
});

test('game-context-actions.js: exports openRecycleBin on window', () => {
    assert.match(GAME_CONTEXT_JS, /window\.openRecycleBin\s*=\s*openRecycleBin/);
});

test('game-context-actions.js: exports closeRecycleBin on window', () => {
    assert.match(GAME_CONTEXT_JS, /window\.closeRecycleBin\s*=\s*closeRecycleBin/);
});

test('game-context-actions.js: exports restoreSelectedGames on window', () => {
    assert.match(GAME_CONTEXT_JS, /window\.restoreSelectedGames\s*=\s*restoreSelectedGames/);
});

// ── 21. No-redeclaration tests ────────────────────────────────────────────────

test('app.js: does not redeclare selectedGameId', () => {
    assert.doesNotMatch(APP_JS, /^let selectedGameId\s*=/m);
});

test('app.js: does not redeclare showContextMenu', () => {
    assert.doesNotMatch(APP_JS, /^function showContextMenu\s*\(/m);
});

test('app.js: does not redeclare hideContextMenu', () => {
    assert.doesNotMatch(APP_JS, /^function hideContextMenu\s*\(\)/m);
});

test('app.js: does not redeclare fixSubmenuPosition', () => {
    assert.doesNotMatch(APP_JS, /^function fixSubmenuPosition\s*\(/m);
});

test('app.js: does not redeclare triggerRemove', () => {
    assert.doesNotMatch(APP_JS, /^function triggerRemove\s*\(\)/m);
});

test('app.js: does not redeclare confirmDeleteAction', () => {
    assert.doesNotMatch(APP_JS, /^async function confirmDeleteAction\s*\(\)/m);
});

test('app.js: does not redeclare hardDeleteGame', () => {
    assert.doesNotMatch(APP_JS, /^function hardDeleteGame\s*\(/m);
});

test('app.js: does not redeclare toggleTimeTracking', () => {
    assert.doesNotMatch(APP_JS, /^async function toggleTimeTracking\s*\(/m);
});

test('app.js: does not redeclare toggleFavorite', () => {
    assert.doesNotMatch(APP_JS, /^async function toggleFavorite\s*\(/m);
});

test('app.js: does not redeclare _toggleCardFavorite', () => {
    assert.doesNotMatch(APP_JS, /^async function _toggleCardFavorite\s*\(/m);
});

test('app.js: does not redeclare openRecycleBin', () => {
    assert.doesNotMatch(APP_JS, /^async function openRecycleBin\s*\(\)/m);
});

test('app.js: does not redeclare closeRecycleBin', () => {
    assert.doesNotMatch(APP_JS, /^function closeRecycleBin\s*\(\)/m);
});

test('app.js: does not redeclare restoreSelectedGames', () => {
    assert.doesNotMatch(APP_JS, /^async function restoreSelectedGames\s*\(\)/m);
});

// ── 22. Script-order tests ────────────────────────────────────────────────────

test('dashboard.html: game-context-actions.js script tag is present', () => {
    assert.match(HTML, /src="js\/app\/game-context-actions\.js"/);
});

test('dashboard.html: toast-confirm.js loads before game-context-actions.js', () => {
    const toastIdx  = HTML.indexOf('js/app/toast-confirm.js');
    const gcaIdx    = HTML.indexOf('js/app/game-context-actions.js');
    assert.ok(toastIdx > -1 && gcaIdx > -1 && toastIdx < gcaIdx,
        'toast-confirm.js must appear before game-context-actions.js');
});

test('dashboard.html: artwork-sync.js loads before game-context-actions.js', () => {
    const artIdx = HTML.indexOf('js/app/artwork-sync.js');
    const gcaIdx = HTML.indexOf('js/app/game-context-actions.js');
    assert.ok(artIdx > -1 && gcaIdx > -1 && artIdx < gcaIdx,
        'artwork-sync.js must appear before game-context-actions.js');
});

test('dashboard.html: collections.js loads before game-context-actions.js', () => {
    const collIdx = HTML.indexOf('js/app/collections.js');
    const gcaIdx  = HTML.indexOf('js/app/game-context-actions.js');
    assert.ok(collIdx > -1 && gcaIdx > -1 && collIdx < gcaIdx,
        'collections.js must appear before game-context-actions.js');
});

test('dashboard.html: game-context-actions.js loads before app.js', () => {
    const gcaIdx  = HTML.indexOf('js/app/game-context-actions.js');
    const appIdx  = HTML.indexOf('"js/app.js"');
    assert.ok(gcaIdx > -1 && appIdx > -1 && gcaIdx < appIdx,
        'game-context-actions.js must appear before app.js');
});

test('dashboard.html: game-context-actions.js loads before accounts/display-prefs.js', () => {
    const gcaIdx   = HTML.indexOf('js/app/game-context-actions.js');
    const dpIdx    = HTML.indexOf('js/accounts/display-prefs.js');
    assert.ok(gcaIdx > -1 && dpIdx > -1 && gcaIdx < dpIdx,
        'game-context-actions.js must appear before accounts/display-prefs.js');
});

test('dashboard.html: game-context-actions.js loads before accounts/platform-panels.js', () => {
    const gcaIdx  = HTML.indexOf('js/app/game-context-actions.js');
    const ppIdx   = HTML.indexOf('js/accounts/platform-panels.js');
    assert.ok(gcaIdx > -1 && ppIdx > -1 && gcaIdx < ppIdx,
        'game-context-actions.js must appear before accounts/platform-panels.js');
});

// ── 23. Comment hygiene ───────────────────────────────────────────────────────

test('game-context-actions.js: contains no Arabic-script characters', () => {
    assert.doesNotMatch(GAME_CONTEXT_JS, /[؀-ۿ]/);
});

test('game-context-actions.js: contains no emoji in comments', () => {
    // Emoji range: basic emoji block
    assert.doesNotMatch(GAME_CONTEXT_JS, /[\u{1F300}-\u{1FFFF}]/u);
});

test('game-context-actions.js: _clearArtworkLocalState dependency is called by hardDeleteGame', () => {
    assert.match(GAME_CONTEXT_JS, /_clearArtworkLocalState\s*\(/);
});
