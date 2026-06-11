'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT   = path.resolve(__dirname, '..');
const APP_JS = fs.readFileSync(path.join(ROOT, 'src/js/app.js'),          'utf8');
const HTML   = fs.readFileSync(path.join(ROOT, 'src/dashboard.html'),     'utf8');
const SIDEBAR_JS = fs.readFileSync(path.join(ROOT, 'src/js/app/sidebar.js'), 'utf8');

// ── helpers ───────────────────────────────────────────────────────────────────

function extractFn(src, sig, maxLen = 2000) {
    const idx = src.indexOf(sig);
    if (idx === -1) return '';
    return src.slice(idx, idx + maxLen);
}

// ── 1. Source-presence tests ─────────────────────────────────────────────────

test('app.js: navigateToCollections function exists', () => {
    assert.match(APP_JS, /function navigateToCollections\s*\(\)/);
});

test('app.js: renderCollectionsView function exists', () => {
    assert.match(APP_JS, /function renderCollectionsView\s*\(\)/);
});

test('app.js: _renderCollectionsHeader function exists', () => {
    assert.match(APP_JS, /function _renderCollectionsHeader\s*\(/);
});

test('app.js: _renderCollectionsStats function exists', () => {
    assert.match(APP_JS, /function _renderCollectionsStats\s*\(/);
});

test('app.js: _collectionsEmptyStateHTML function exists', () => {
    assert.match(APP_JS, /function _collectionsEmptyStateHTML\s*\(\)/);
});

test('app.js: _getGameByCollectionGameId function exists', () => {
    assert.match(APP_JS, /function _getGameByCollectionGameId\s*\(/);
});

test('app.js: _getGameCoverUrl function exists', () => {
    assert.match(APP_JS, /function _getGameCoverUrl\s*\(/);
});

test('app.js: _renderCollectionCard function exists', () => {
    assert.match(APP_JS, /function _renderCollectionCard\s*\(/);
});

test('app.js: openAddGamesToCollection function exists', () => {
    assert.match(APP_JS, /function openAddGamesToCollection\s*\(/);
});

test('app.js: toggleCollectionCardMenu function exists', () => {
    assert.match(APP_JS, /function toggleCollectionCardMenu\s*\(/);
});

test('app.js: renameCollection function exists', () => {
    assert.match(APP_JS, /async function renameCollection\s*\(/);
});

test('app.js: openCollectionModal function exists', () => {
    assert.match(APP_JS, /function openCollectionModal\s*\(\)/);
});

test('app.js: closeCollectionModal function exists', () => {
    assert.match(APP_JS, /function closeCollectionModal\s*\(\)/);
});

test('app.js: saveCollection function exists', () => {
    assert.match(APP_JS, /async function saveCollection\s*\(\)/);
});

test('app.js: deleteColl function exists', () => {
    assert.match(APP_JS, /function deleteColl\s*\(/);
});

test('app.js: filterByCollection function exists', () => {
    assert.match(APP_JS, /function filterByCollection\s*\(/);
});

test('app.js: addToCollection function exists', () => {
    assert.match(APP_JS, /async function addToCollection\s*\(/);
});

test('app.js: removeFromCurrentCollection function exists', () => {
    assert.match(APP_JS, /async function removeFromCurrentCollection\s*\(/);
});

test('app.js: openCollectionSettings function exists', () => {
    assert.match(APP_JS, /function openCollectionSettings\s*\(/);
});

test('app.js: closeCollectionSettings function exists', () => {
    assert.match(APP_JS, /function closeCollectionSettings\s*\(\)/);
});

test('app.js: saveCollectionSettings function exists', () => {
    assert.match(APP_JS, /async function saveCollectionSettings\s*\(\)/);
});

test('app.js: triggerDeleteCollection function exists', () => {
    assert.match(APP_JS, /function triggerDeleteCollection\s*\(\)/);
});

test('app.js: changeCollectionImage function exists', () => {
    assert.match(APP_JS, /async function changeCollectionImage\s*\(\)/);
});

test('app.js: resetCollectionImage function exists', () => {
    assert.match(APP_JS, /async function resetCollectionImage\s*\(\)/);
});

test('app.js: currentEditingCollectionId state variable exists', () => {
    assert.match(APP_JS, /let currentEditingCollectionId\s*=/);
});

// ── 2. Window exports ─────────────────────────────────────────────────────────

test('app.js: renameCollection is exposed on window', () => {
    assert.match(APP_JS, /window\.renameCollection\s*=\s*renameCollection/);
});

test('app.js: toggleCollectionCardMenu is exposed on window', () => {
    assert.match(APP_JS, /window\.toggleCollectionCardMenu\s*=\s*toggleCollectionCardMenu/);
});

test('app.js: openAddGamesToCollection is exposed on window', () => {
    assert.match(APP_JS, /window\.openAddGamesToCollection\s*=\s*openAddGamesToCollection/);
});

test('app.js: openRenameCollectionModal aliases openCollectionSettings on window', () => {
    assert.match(APP_JS, /window\.openRenameCollectionModal\s*=\s*openCollectionSettings/);
});

// ── 3. navigateToCollections behaviour ───────────────────────────────────────

test('app.js: navigateToCollections sets currentView to collections', () => {
    const fn = extractFn(APP_JS, 'function navigateToCollections()');
    assert.match(fn, /currentView\s*=\s*'collections'/);
});

test('app.js: navigateToCollections sets agReadyOnly to false', () => {
    const fn = extractFn(APP_JS, 'function navigateToCollections()');
    assert.match(fn, /window\.agReadyOnly\s*=\s*false/);
});

test('app.js: navigateToCollections clears collectionId filter', () => {
    const fn = extractFn(APP_JS, 'function navigateToCollections()');
    assert.match(fn, /currentFilters\.collectionId\s*=\s*null/);
});

test('app.js: navigateToCollections shows collectionsView element', () => {
    const fn = extractFn(APP_JS, 'function navigateToCollections()');
    assert.match(fn, /getElementById\('collectionsView'\)/);
    assert.match(fn, /style\.display\s*=\s*'block'/);
});

test('app.js: navigateToCollections calls updateSidebarActiveState', () => {
    const fn = extractFn(APP_JS, 'function navigateToCollections()');
    assert.match(fn, /updateSidebarActiveState\s*\(\)/);
});

test('app.js: navigateToCollections calls renderCollectionsView', () => {
    const fn = extractFn(APP_JS, 'function navigateToCollections()');
    assert.match(fn, /renderCollectionsView\s*\(\)/);
});

test('app.js: navigateToCollections calls updateSbContextBtn', () => {
    const fn = extractFn(APP_JS, 'function navigateToCollections()');
    assert.match(fn, /updateSbContextBtn\s*\(\)/);
});

// ── 4. renderCollectionsView behaviour ───────────────────────────────────────

test('app.js: renderCollectionsView reads collectionsGrid element', () => {
    const fn = extractFn(APP_JS, 'function renderCollectionsView()');
    assert.match(fn, /getElementById\('collectionsGrid'\)/);
});

test('app.js: renderCollectionsView filters out fav_system_default', () => {
    const fn = extractFn(APP_JS, 'function renderCollectionsView()');
    assert.match(fn, /fav_system_default/);
});

test('app.js: renderCollectionsView calls _renderCollectionsHeader', () => {
    const fn = extractFn(APP_JS, 'function renderCollectionsView()');
    assert.match(fn, /_renderCollectionsHeader\s*\(/);
});

test('app.js: renderCollectionsView calls _renderCollectionsStats', () => {
    const fn = extractFn(APP_JS, 'function renderCollectionsView()');
    assert.match(fn, /_renderCollectionsStats\s*\(/);
});

test('app.js: renderCollectionsView renders empty state when no custom collections', () => {
    const fn = extractFn(APP_JS, 'function renderCollectionsView()');
    assert.match(fn, /is-empty/);
    assert.match(fn, /_collectionsEmptyStateHTML\s*\(\)/);
});

test('app.js: renderCollectionsView maps collections through _renderCollectionCard', () => {
    const fn = extractFn(APP_JS, 'function renderCollectionsView()');
    assert.match(fn, /_renderCollectionCard/);
    assert.match(fn, /\.map\s*\(_renderCollectionCard\)/);
});

// ── 5. _renderCollectionsHeader ───────────────────────────────────────────────

test('app.js: _renderCollectionsHeader writes to collectionsHeader element', () => {
    const fn = extractFn(APP_JS, 'function _renderCollectionsHeader(');
    assert.match(fn, /getElementById\('collectionsHeader'\)/);
    assert.match(fn, /\.innerHTML\s*=/);
});

test('app.js: _renderCollectionsHeader contains New Collection button calling openCollectionModal', () => {
    const fn = extractFn(APP_JS, 'function _renderCollectionsHeader(');
    assert.match(fn, /openCollectionModal\s*\(\)/);
});

test('app.js: _renderCollectionsHeader contains Browse Library button calling navigateToInstalled', () => {
    const fn = extractFn(APP_JS, 'function _renderCollectionsHeader(');
    assert.match(fn, /navigateToInstalled\s*\(\)/);
});

// ── 6. _renderCollectionsStats ────────────────────────────────────────────────

test('app.js: _renderCollectionsStats writes to collectionsStats element', () => {
    const fn = extractFn(APP_JS, 'function _renderCollectionsStats(');
    assert.match(fn, /getElementById\('collectionsStats'\)/);
});

test('app.js: _renderCollectionsStats clears element when no collections', () => {
    const fn = extractFn(APP_JS, 'function _renderCollectionsStats(');
    assert.match(fn, /\.innerHTML\s*=\s*''/);
});

test('app.js: _renderCollectionsStats computes total game count across collections', () => {
    const fn = extractFn(APP_JS, 'function _renderCollectionsStats(');
    assert.match(fn, /gameIds/);
    assert.match(fn, /reduce/);
});

test('app.js: _renderCollectionsStats renders three stat cards', () => {
    const fn = extractFn(APP_JS, 'function _renderCollectionsStats(', 1500);
    const matches = fn.match(/collections-stat-card/g);
    assert.ok(matches && matches.length >= 3, 'must render at least 3 stat cards');
});

// ── 7. _collectionsEmptyStateHTML ─────────────────────────────────────────────

test('app.js: _collectionsEmptyStateHTML returns HTML string with empty state class', () => {
    const fn = extractFn(APP_JS, 'function _collectionsEmptyStateHTML()');
    assert.match(fn, /collections-empty-state/);
});

test('app.js: _collectionsEmptyStateHTML contains Create Collection button calling openCollectionModal', () => {
    const fn = extractFn(APP_JS, 'function _collectionsEmptyStateHTML()');
    assert.match(fn, /openCollectionModal\s*\(\)/);
});

test('app.js: _collectionsEmptyStateHTML contains Browse Games button calling navigateToInstalled', () => {
    const fn = extractFn(APP_JS, 'function _collectionsEmptyStateHTML()');
    assert.match(fn, /navigateToInstalled\s*\(\)/);
});

// ── 8. _getGameByCollectionGameId ─────────────────────────────────────────────

test('app.js: _getGameByCollectionGameId searches multiple game pools', () => {
    const fn = extractFn(APP_JS, 'function _getGameByCollectionGameId(');
    assert.match(fn, /window\._allGamesCache/);
    assert.match(fn, /allGamesData/);
    assert.match(fn, /window\._suggAllGames/);
});

test('app.js: _getGameByCollectionGameId matches by id, gameId, appid, and path', () => {
    const fn = extractFn(APP_JS, 'function _getGameByCollectionGameId(');
    assert.match(fn, /g\.id/);
    assert.match(fn, /g\.gameId/);
    assert.match(fn, /g\.appid/);
    assert.match(fn, /g\.path/);
});

test('app.js: _getGameByCollectionGameId returns null when not found', () => {
    const fn = extractFn(APP_JS, 'function _getGameByCollectionGameId(');
    assert.match(fn, /return null/);
});

// ── 9. _getGameCoverUrl ───────────────────────────────────────────────────────

test('app.js: _getGameCoverUrl returns empty string for falsy input', () => {
    const fn = extractFn(APP_JS, 'function _getGameCoverUrl(');
    assert.match(fn, /if\s*\(!game\)\s*return\s*''/);
});

test('app.js: _getGameCoverUrl tries cover, coverUrl, image, hero, poster, icon fields', () => {
    const fn = extractFn(APP_JS, 'function _getGameCoverUrl(');
    assert.match(fn, /game\.cover/);
    assert.match(fn, /game\.coverUrl/);
    assert.match(fn, /game\.image/);
    assert.match(fn, /game\.hero/);
    assert.match(fn, /game\.poster/);
    assert.match(fn, /game\.icon/);
});

// ── 10. _renderCollectionCard ─────────────────────────────────────────────────

test('app.js: _renderCollectionCard escapes collection id and name with escapeHtml', () => {
    const fn = extractFn(APP_JS, 'function _renderCollectionCard(');
    assert.match(fn, /escapeHtml\s*\(String\s*\(c\.id\)\)/);
    assert.match(fn, /escapeHtml\s*\(c\.name/);
});

test('app.js: _renderCollectionCard renders article.collection-card with filterByCollection onclick', () => {
    const fn = extractFn(APP_JS, 'function _renderCollectionCard(', 3200);
    assert.match(fn, /class="collection-card"/);
    assert.match(fn, /filterByCollection\s*\(/);
});

test('app.js: _renderCollectionCard renders Add Games button calling openAddGamesToCollection', () => {
    const fn = extractFn(APP_JS, 'function _renderCollectionCard(', 3200);
    assert.match(fn, /openAddGamesToCollection\s*\(/);
});

test('app.js: _renderCollectionCard renders More button calling toggleCollectionCardMenu', () => {
    const fn = extractFn(APP_JS, 'function _renderCollectionCard(', 3200);
    assert.match(fn, /toggleCollectionCardMenu\s*\(/);
});

test('app.js: _renderCollectionCard renders Rename button calling openRenameCollectionModal', () => {
    const fn = extractFn(APP_JS, 'function _renderCollectionCard(', 3200);
    assert.match(fn, /openRenameCollectionModal\s*\(/);
});

test('app.js: _renderCollectionCard renders Delete button calling deleteColl', () => {
    const fn = extractFn(APP_JS, 'function _renderCollectionCard(', 3200);
    assert.match(fn, /deleteColl\s*\(/);
});

test('app.js: _renderCollectionCard renders game count label with singular/plural', () => {
    const fn = extractFn(APP_JS, 'function _renderCollectionCard(');
    assert.match(fn, /1 game/);
    assert.match(fn, /games/);
});

test('app.js: _renderCollectionCard uses c.image for custom cover when present', () => {
    const fn = extractFn(APP_JS, 'function _renderCollectionCard(', 1500);
    assert.match(fn, /c\.image/);
    assert.match(fn, /collection-card-cover--single/);
});

test('app.js: _renderCollectionCard builds game cover collage via _getGameCoverUrl', () => {
    const fn = extractFn(APP_JS, 'function _renderCollectionCard(', 1500);
    assert.match(fn, /_getGameCoverUrl/);
    assert.match(fn, /_getGameByCollectionGameId/);
});

test('app.js: _renderCollectionCard renders collection-cover-placeholder when no covers', () => {
    const fn = extractFn(APP_JS, 'function _renderCollectionCard(', 1500);
    assert.match(fn, /collection-cover-placeholder/);
});

// ── 11. toggleCollectionCardMenu ─────────────────────────────────────────────

test('app.js: toggleCollectionCardMenu closes all other menus before toggling target', () => {
    const fn = extractFn(APP_JS, 'function toggleCollectionCardMenu(');
    assert.match(fn, /querySelectorAll\s*\(\s*'\.collection-card-menu'\s*\)/);
    assert.match(fn, /m\.hidden\s*=\s*true/);
});

test('app.js: toggleCollectionCardMenu toggles the target menu hidden state', () => {
    const fn = extractFn(APP_JS, 'function toggleCollectionCardMenu(');
    assert.match(fn, /menu\.hidden\s*=\s*!menu\.hidden/);
});

test('app.js: toggleCollectionCardMenu registers a global dismiss click listener once', () => {
    assert.match(APP_JS, /_collMenuDismissRegistered/);
    assert.match(APP_JS, /document\.addEventListener\s*\(\s*'click'/);
});

// ── 12. openAddGamesToCollection ──────────────────────────────────────────────

test('app.js: openAddGamesToCollection sets window.activeAddToCollectionId', () => {
    const fn = extractFn(APP_JS, 'function openAddGamesToCollection(');
    assert.match(fn, /window\.activeAddToCollectionId\s*=\s*collectionId/);
});

test('app.js: openAddGamesToCollection navigates to installed view', () => {
    const fn = extractFn(APP_JS, 'function openAddGamesToCollection(');
    assert.match(fn, /navigateToInstalled\s*\(\)/);
});

// ── 13. renameCollection ──────────────────────────────────────────────────────

test('app.js: renameCollection finds collection in allCollections', () => {
    const fn = extractFn(APP_JS, 'async function renameCollection(');
    assert.match(fn, /allCollections.*find/);
});

test('app.js: renameCollection returns early if collection not found', () => {
    const fn = extractFn(APP_JS, 'async function renameCollection(');
    assert.match(fn, /if\s*\(!coll\)\s*return/);
});

test('app.js: renameCollection calls window.electronAPI.updateCollection', () => {
    const fn = extractFn(APP_JS, 'async function renameCollection(');
    assert.match(fn, /window\.electronAPI\.updateCollection\s*\(/);
});

test('app.js: renameCollection refreshes allCollections from getCollections after rename', () => {
    const fn = extractFn(APP_JS, 'async function renameCollection(');
    assert.match(fn, /window\.electronAPI\.getCollections\s*\(\)/);
    assert.match(fn, /allCollections\s*=/);
});

test('app.js: renameCollection calls renderCollectionsView after rename', () => {
    const fn = extractFn(APP_JS, 'async function renameCollection(');
    assert.match(fn, /renderCollectionsView\s*\(\)/);
});

test('app.js: renameCollection calls renderSidebarCollectionsList after rename', () => {
    const fn = extractFn(APP_JS, 'async function renameCollection(');
    assert.match(fn, /renderSidebarCollectionsList\s*\(\)/);
});

test('app.js: renameCollection shows warning toast when name is empty', () => {
    const fn = extractFn(APP_JS, 'async function renameCollection(');
    assert.match(fn, /showToast\s*\(.*warning/);
});

test('app.js: renameCollection shows success toast after rename', () => {
    const fn = extractFn(APP_JS, 'async function renameCollection(');
    assert.match(fn, /showToast\s*\(.*success/);
});

test('app.js: renameCollection shows error toast on exception', () => {
    const fn = extractFn(APP_JS, 'async function renameCollection(');
    assert.match(fn, /showToast\s*\(.*error/);
});

// ── 14. openCollectionModal / closeCollectionModal ────────────────────────────

test('app.js: openCollectionModal clears collName input and activates modal', () => {
    const fn = extractFn(APP_JS, 'function openCollectionModal()');
    assert.match(fn, /getElementById\s*\(\s*'collName'\s*\)/);
    assert.match(fn, /getElementById\s*\(\s*'collectionModal'\s*\)/);
    assert.match(fn, /classList\.add\s*\(\s*'active'\s*\)/);
});

test('app.js: closeCollectionModal removes active class from collectionModal', () => {
    const fn = extractFn(APP_JS, 'function closeCollectionModal()');
    assert.match(fn, /getElementById\s*\(\s*'collectionModal'\s*\)/);
    assert.match(fn, /classList\.remove\s*\(\s*'active'\s*\)/);
});

// ── 15. saveCollection ────────────────────────────────────────────────────────

test('app.js: saveCollection reads collName input value', () => {
    const fn = extractFn(APP_JS, 'async function saveCollection()');
    assert.match(fn, /getElementById\s*\(\s*'collName'\s*\)/);
    assert.match(fn, /\.value\.trim\s*\(\)/);
});

test('app.js: saveCollection shows error toast when name is empty', () => {
    const fn = extractFn(APP_JS, 'async function saveCollection()');
    assert.match(fn, /showToast\s*\(.*error/);
});

test('app.js: saveCollection calls window.electronAPI.createCollection', () => {
    const fn = extractFn(APP_JS, 'async function saveCollection()');
    assert.match(fn, /window\.electronAPI\.createCollection\s*\(/);
});

test('app.js: saveCollection refreshes allCollections after create', () => {
    const fn = extractFn(APP_JS, 'async function saveCollection()');
    assert.match(fn, /allCollections\s*=\s*await\s*window\.electronAPI\.getCollections/);
});

test('app.js: saveCollection calls renderSidebar after create', () => {
    const fn = extractFn(APP_JS, 'async function saveCollection()');
    assert.match(fn, /renderSidebar\s*\(\)/);
});

test('app.js: saveCollection calls closeCollectionModal after create', () => {
    const fn = extractFn(APP_JS, 'async function saveCollection()');
    assert.match(fn, /closeCollectionModal\s*\(\)/);
});

test('app.js: saveCollection calls renderCollectionsView when on collections page', () => {
    const fn = extractFn(APP_JS, 'async function saveCollection()');
    assert.match(fn, /currentView\s*===\s*'collections'/);
    assert.match(fn, /renderCollectionsView\s*\(\)/);
});

test('app.js: saveCollection shows success toast after create', () => {
    const fn = extractFn(APP_JS, 'async function saveCollection()');
    assert.match(fn, /showToast\s*\(.*success/);
});

// ── 16. deleteColl ────────────────────────────────────────────────────────────

test('app.js: deleteColl stops event propagation', () => {
    const fn = extractFn(APP_JS, 'function deleteColl(');
    assert.match(fn, /e\.stopPropagation\s*\(\)/);
});

test('app.js: deleteColl calls openConfirmModal for confirmation', () => {
    const fn = extractFn(APP_JS, 'function deleteColl(');
    assert.match(fn, /openConfirmModal\s*\(/);
    assert.match(fn, /Delete/);
});

test('app.js: deleteColl calls window.electronAPI.deleteCollection inside confirm callback', () => {
    const fn = extractFn(APP_JS, 'function deleteColl(', 800);
    assert.match(fn, /window\.electronAPI\.deleteCollection\s*\(/);
});

test('app.js: deleteColl refreshes allCollections after delete', () => {
    const fn = extractFn(APP_JS, 'function deleteColl(', 800);
    assert.match(fn, /allCollections\s*=\s*await\s*window\.electronAPI\.getCollections/);
});

test('app.js: deleteColl clears collectionId filter when deleted collection was active', () => {
    const fn = extractFn(APP_JS, 'function deleteColl(', 800);
    assert.match(fn, /currentFilters\.collectionId.*null/);
});

test('app.js: deleteColl calls renderSidebar after delete', () => {
    const fn = extractFn(APP_JS, 'function deleteColl(', 800);
    assert.match(fn, /renderSidebar\s*\(\)/);
});

test('app.js: deleteColl navigates to installed if currently in single collection view', () => {
    const fn = extractFn(APP_JS, 'function deleteColl(', 800);
    assert.match(fn, /currentView.*'collection'/);
    assert.match(fn, /navigateToInstalled\s*\(\)/);
});

// ── 17. filterByCollection ────────────────────────────────────────────────────

test('app.js: filterByCollection sets currentView to collection', () => {
    const fn = extractFn(APP_JS, 'function filterByCollection(');
    assert.match(fn, /currentView\s*=\s*'collection'/);
});

test('app.js: filterByCollection sets agReadyOnly to false', () => {
    const fn = extractFn(APP_JS, 'function filterByCollection(');
    assert.match(fn, /window\.agReadyOnly\s*=\s*false/);
});

test('app.js: filterByCollection sets currentFilters.collectionId', () => {
    const fn = extractFn(APP_JS, 'function filterByCollection(');
    assert.match(fn, /currentFilters\.collectionId\s*=\s*collId/);
});

test('app.js: filterByCollection shows installedGamesView', () => {
    const fn = extractFn(APP_JS, 'function filterByCollection(');
    assert.match(fn, /getElementById\s*\(\s*'installedGamesView'\s*\)/);
    assert.match(fn, /style\.display\s*=\s*'block'/);
});

test('app.js: filterByCollection calls updateSidebarActiveState', () => {
    const fn = extractFn(APP_JS, 'function filterByCollection(');
    assert.match(fn, /updateSidebarActiveState\s*\(\)/);
});

test('app.js: filterByCollection calls updateSbContextBtn', () => {
    const fn = extractFn(APP_JS, 'function filterByCollection(');
    assert.match(fn, /updateSbContextBtn\s*\(\)/);
});

test('app.js: filterByCollection calls applyFilters', () => {
    const fn = extractFn(APP_JS, 'function filterByCollection(');
    assert.match(fn, /applyFilters\s*\(\)/);
});

test('app.js: filterByCollection resets platform filter to all', () => {
    const fn = extractFn(APP_JS, 'function filterByCollection(');
    assert.match(fn, /currentFilters\.platform\s*=\s*'all'/);
});

test('app.js: filterByCollection clears search filter', () => {
    const fn = extractFn(APP_JS, 'function filterByCollection(');
    assert.match(fn, /currentFilters\.search\s*=\s*''/);
});

// ── 18. addToCollection ───────────────────────────────────────────────────────

test('app.js: addToCollection hides context menu first', () => {
    const fn = extractFn(APP_JS, 'async function addToCollection(');
    assert.match(fn, /hideContextMenu\s*\(\)/);
});

test('app.js: addToCollection calls window.electronAPI.addGameToCollection', () => {
    const fn = extractFn(APP_JS, 'async function addToCollection(');
    assert.match(fn, /window\.electronAPI\.addGameToCollection\s*\(/);
});

test('app.js: addToCollection refreshes allCollections after add', () => {
    const fn = extractFn(APP_JS, 'async function addToCollection(');
    assert.match(fn, /allCollections\s*=\s*await\s*window\.electronAPI\.getCollections/);
});

test('app.js: addToCollection calls renderSidebar after add', () => {
    const fn = extractFn(APP_JS, 'async function addToCollection(');
    assert.match(fn, /renderSidebar\s*\(\)/);
});

test('app.js: addToCollection shows success toast', () => {
    const fn = extractFn(APP_JS, 'async function addToCollection(');
    assert.match(fn, /showToast\s*\(.*success/);
});

// ── 19. removeFromCurrentCollection ──────────────────────────────────────────

test('app.js: removeFromCurrentCollection returns early when no active collection', () => {
    const fn = extractFn(APP_JS, 'async function removeFromCurrentCollection(');
    assert.match(fn, /if\s*\(!currentFilters\.collectionId\)/);
});

test('app.js: removeFromCurrentCollection calls window.electronAPI.removeGameFromCollection', () => {
    const fn = extractFn(APP_JS, 'async function removeFromCurrentCollection(');
    assert.match(fn, /window\.electronAPI\.removeGameFromCollection\s*\(/);
});

test('app.js: removeFromCurrentCollection refreshes allCollections on success', () => {
    const fn = extractFn(APP_JS, 'async function removeFromCurrentCollection(');
    assert.match(fn, /allCollections\s*=\s*await\s*window\.electronAPI\.getCollections/);
});

test('app.js: removeFromCurrentCollection calls applyFilters on success', () => {
    const fn = extractFn(APP_JS, 'async function removeFromCurrentCollection(');
    assert.match(fn, /applyFilters\s*\(\)/);
});

test('app.js: removeFromCurrentCollection shows success toast on success', () => {
    const fn = extractFn(APP_JS, 'async function removeFromCurrentCollection(');
    assert.match(fn, /showToast\s*\(.*success/);
});

// ── 20. openCollectionSettings / closeCollectionSettings ─────────────────────

test('app.js: openCollectionSettings stores id in currentEditingCollectionId', () => {
    const fn = extractFn(APP_JS, 'function openCollectionSettings(');
    assert.match(fn, /currentEditingCollectionId\s*=\s*id/);
});

test('app.js: openCollectionSettings populates editCollNameInput with collection name', () => {
    const fn = extractFn(APP_JS, 'function openCollectionSettings(');
    assert.match(fn, /getElementById\s*\(\s*'editCollNameInput'\s*\)/);
    assert.match(fn, /\.value\s*=/);
});

test('app.js: openCollectionSettings disables name input for fav_system_default', () => {
    const fn = extractFn(APP_JS, 'function openCollectionSettings(', 700);
    assert.match(fn, /fav_system_default/);
    assert.match(fn, /nameInput\.disabled\s*=\s*true/);
});

test('app.js: openCollectionSettings hides delete button for fav_system_default', () => {
    const fn = extractFn(APP_JS, 'function openCollectionSettings(', 700);
    assert.match(fn, /deleteBtn.*display.*none|display.*none.*deleteBtn/s);
});

test('app.js: openCollectionSettings activates collectionSettingsModal', () => {
    const fn = extractFn(APP_JS, 'function openCollectionSettings(', 1000);
    assert.match(fn, /getElementById\s*\(\s*'collectionSettingsModal'\s*\)/);
    assert.match(fn, /classList\.add\s*\(\s*'active'\s*\)/);
});

test('app.js: closeCollectionSettings deactivates collectionSettingsModal', () => {
    const fn = extractFn(APP_JS, 'function closeCollectionSettings()');
    assert.match(fn, /getElementById\s*\(\s*'collectionSettingsModal'\s*\)/);
    assert.match(fn, /classList\.remove\s*\(\s*'active'\s*\)/);
});

test('app.js: closeCollectionSettings resets currentEditingCollectionId to null', () => {
    const fn = extractFn(APP_JS, 'function closeCollectionSettings()');
    assert.match(fn, /currentEditingCollectionId\s*=\s*null/);
});

// ── 21. saveCollectionSettings ────────────────────────────────────────────────

test('app.js: saveCollectionSettings returns early when currentEditingCollectionId is null', () => {
    const fn = extractFn(APP_JS, 'async function saveCollectionSettings()');
    assert.match(fn, /if\s*\(!currentEditingCollectionId\)\s*return/);
});

test('app.js: saveCollectionSettings reads editCollNameInput value', () => {
    const fn = extractFn(APP_JS, 'async function saveCollectionSettings()');
    assert.match(fn, /getElementById\s*\(\s*'editCollNameInput'\s*\)/);
    assert.match(fn, /\.value\.trim\s*\(\)/);
});

test('app.js: saveCollectionSettings calls window.electronAPI.updateCollection', () => {
    const fn = extractFn(APP_JS, 'async function saveCollectionSettings()');
    assert.match(fn, /window\.electronAPI\.updateCollection\s*\(/);
});

test('app.js: saveCollectionSettings calls renderSidebar after save', () => {
    const fn = extractFn(APP_JS, 'async function saveCollectionSettings()');
    assert.match(fn, /renderSidebar\s*\(\)/);
});

test('app.js: saveCollectionSettings calls renderCollectionsView when on collections page', () => {
    const fn = extractFn(APP_JS, 'async function saveCollectionSettings()');
    assert.match(fn, /currentView\s*===\s*'collections'/);
    assert.match(fn, /renderCollectionsView\s*\(\)/);
});

test('app.js: saveCollectionSettings calls closeCollectionSettings after save', () => {
    const fn = extractFn(APP_JS, 'async function saveCollectionSettings()');
    assert.match(fn, /closeCollectionSettings\s*\(\)/);
});

// ── 22. triggerDeleteCollection ───────────────────────────────────────────────

test('app.js: triggerDeleteCollection returns early when no currentEditingCollectionId', () => {
    const fn = extractFn(APP_JS, 'function triggerDeleteCollection()');
    assert.match(fn, /if\s*\(!currentEditingCollectionId\)\s*return/);
});

test('app.js: triggerDeleteCollection calls openConfirmModal for confirmation', () => {
    const fn = extractFn(APP_JS, 'function triggerDeleteCollection()');
    assert.match(fn, /openConfirmModal\s*\(/);
    assert.match(fn, /Delete/);
});

test('app.js: triggerDeleteCollection calls window.electronAPI.deleteCollection inside confirm', () => {
    const fn = extractFn(APP_JS, 'function triggerDeleteCollection()', 900);
    assert.match(fn, /window\.electronAPI\.deleteCollection\s*\(/);
});

test('app.js: triggerDeleteCollection clears collectionId filter when deleted was active', () => {
    const fn = extractFn(APP_JS, 'function triggerDeleteCollection()', 900);
    assert.match(fn, /currentFilters\.collectionId\s*=\s*null/);
});

test('app.js: triggerDeleteCollection navigates to installed when in single collection view', () => {
    const fn = extractFn(APP_JS, 'function triggerDeleteCollection()', 900);
    assert.match(fn, /currentView.*'collection'/);
    assert.match(fn, /navigateToInstalled\s*\(\)/);
});

test('app.js: triggerDeleteCollection calls closeCollectionSettings after delete', () => {
    const fn = extractFn(APP_JS, 'function triggerDeleteCollection()', 900);
    assert.match(fn, /closeCollectionSettings\s*\(\)/);
});

// ── 23. DOM IDs and classes ───────────────────────────────────────────────────

test('dashboard.html: collectionsView element exists', () => {
    assert.match(HTML, /id="collectionsView"/);
});

test('dashboard.html: collectionsGrid element exists', () => {
    assert.match(HTML, /id="collectionsGrid"/);
});

test('dashboard.html: collectionsHeader element exists', () => {
    assert.match(HTML, /id="collectionsHeader"/);
});

test('dashboard.html: collectionsStats element exists', () => {
    assert.match(HTML, /id="collectionsStats"/);
});

test('dashboard.html: collectionModal element exists', () => {
    assert.match(HTML, /id="collectionModal"/);
});

test('dashboard.html: collName input exists', () => {
    assert.match(HTML, /id="collName"/);
});

test('dashboard.html: collectionSettingsModal element exists', () => {
    assert.match(HTML, /id="collectionSettingsModal"/);
});

test('dashboard.html: editCollNameInput exists', () => {
    assert.match(HTML, /id="editCollNameInput"/);
});

test('dashboard.html: previewCollImage exists', () => {
    assert.match(HTML, /id="previewCollImage"/);
});

test('dashboard.html: previewCollText exists', () => {
    assert.match(HTML, /id="previewCollText"/);
});

// ── 24. Inline onclick handlers in dashboard.html ─────────────────────────────

test('dashboard.html: collectionModal cancel button calls closeCollectionModal', () => {
    assert.match(HTML, /onclick="closeCollectionModal\(\)"/);
});

test('dashboard.html: collectionModal create button calls saveCollection', () => {
    assert.match(HTML, /onclick="saveCollection\(\)"/);
});

test('dashboard.html: collectionSettingsModal save button calls saveCollectionSettings', () => {
    assert.match(HTML, /onclick="saveCollectionSettings\(\)"/);
});

test('dashboard.html: collectionSettingsModal cancel button calls closeCollectionSettings', () => {
    assert.match(HTML, /onclick="closeCollectionSettings\(\)"/);
});

test('dashboard.html: collectionSettingsModal delete button calls triggerDeleteCollection', () => {
    assert.match(HTML, /onclick="triggerDeleteCollection\(\)"/);
});

test('dashboard.html: image zone calls changeCollectionImage', () => {
    assert.match(HTML, /onclick="changeCollectionImage\(\)"/);
});

test('dashboard.html: reset image button calls resetCollectionImage', () => {
    assert.match(HTML, /onclick="resetCollectionImage\(\)"/);
});

test('dashboard.html: nav-fav item calls filterByCollection with fav_system_default', () => {
    assert.match(HTML, /onclick="filterByCollection\s*\(\s*'fav_system_default'\s*\)"/);
});

// ── 25. electronAPI dependencies ─────────────────────────────────────────────

test('app.js: collection functions use electronAPI.getCollections', () => {
    assert.match(APP_JS, /window\.electronAPI\.getCollections\s*\(\)/);
});

test('app.js: saveCollection uses electronAPI.createCollection', () => {
    assert.match(APP_JS, /window\.electronAPI\.createCollection\s*\(/);
});

test('app.js: deleteColl uses electronAPI.deleteCollection', () => {
    const fn = extractFn(APP_JS, 'function deleteColl(', 600);
    assert.match(fn, /window\.electronAPI\.deleteCollection\s*\(/);
});

test('app.js: triggerDeleteCollection uses electronAPI.deleteCollection', () => {
    const fn = extractFn(APP_JS, 'function triggerDeleteCollection()', 600);
    assert.match(fn, /window\.electronAPI\.deleteCollection\s*\(/);
});

test('app.js: renameCollection uses electronAPI.updateCollection', () => {
    const fn = extractFn(APP_JS, 'async function renameCollection(');
    assert.match(fn, /window\.electronAPI\.updateCollection\s*\(/);
});

test('app.js: saveCollectionSettings uses electronAPI.updateCollection', () => {
    const fn = extractFn(APP_JS, 'async function saveCollectionSettings()');
    assert.match(fn, /window\.electronAPI\.updateCollection\s*\(/);
});

test('app.js: addToCollection uses electronAPI.addGameToCollection', () => {
    const fn = extractFn(APP_JS, 'async function addToCollection(');
    assert.match(fn, /window\.electronAPI\.addGameToCollection\s*\(/);
});

test('app.js: removeFromCurrentCollection uses electronAPI.removeGameFromCollection', () => {
    const fn = extractFn(APP_JS, 'async function removeFromCurrentCollection(');
    assert.match(fn, /window\.electronAPI\.removeGameFromCollection\s*\(/);
});

test('app.js: changeCollectionImage uses electronAPI.selectImage', () => {
    const fn = extractFn(APP_JS, 'async function changeCollectionImage()');
    assert.match(fn, /window\.electronAPI\.selectImage\s*\(\)/);
});

test('app.js: changeCollectionImage uses electronAPI.updateCollection', () => {
    const fn = extractFn(APP_JS, 'async function changeCollectionImage()');
    assert.match(fn, /window\.electronAPI\.updateCollection\s*\(/);
});

test('app.js: resetCollectionImage uses electronAPI.updateCollection', () => {
    const fn = extractFn(APP_JS, 'async function resetCollectionImage()');
    assert.match(fn, /window\.electronAPI\.updateCollection\s*\(/);
});

// ── 26. Intentional dependencies on app.js globals ───────────────────────────

test('app.js: collection section depends on allCollections global', () => {
    const section = APP_JS.slice(
        APP_JS.indexOf('function navigateToCollections'),
        APP_JS.indexOf('function triggerRemove')
    );
    assert.match(section, /allCollections/);
});

test('app.js: collection section depends on allGamesData global', () => {
    const section = APP_JS.slice(
        APP_JS.indexOf('function _getGameByCollectionGameId'),
        APP_JS.indexOf('function openCollectionModal')
    );
    assert.match(section, /allGamesData/);
});

test('app.js: collection section depends on currentView global', () => {
    const section = APP_JS.slice(
        APP_JS.indexOf('function navigateToCollections'),
        APP_JS.indexOf('function triggerRemove')
    );
    assert.match(section, /currentView/);
});

test('app.js: collection section depends on currentFilters global', () => {
    const section = APP_JS.slice(
        APP_JS.indexOf('function navigateToCollections'),
        APP_JS.indexOf('function triggerRemove')
    );
    assert.match(section, /currentFilters/);
});

test('app.js: collection section uses showToast helper', () => {
    const section = APP_JS.slice(
        APP_JS.indexOf('function navigateToCollections'),
        APP_JS.indexOf('function triggerRemove')
    );
    assert.match(section, /showToast\s*\(/);
});

test('app.js: collection section uses openConfirmModal helper', () => {
    const section = APP_JS.slice(
        APP_JS.indexOf('function navigateToCollections'),
        APP_JS.indexOf('function triggerRemove')
    );
    assert.match(section, /openConfirmModal\s*\(/);
});

test('app.js: collection section uses escapeHtml helper', () => {
    const section = APP_JS.slice(
        APP_JS.indexOf('function _renderCollectionCard'),
        APP_JS.indexOf('function openAddGamesToCollection')
    );
    assert.match(section, /escapeHtml\s*\(/);
});

test('app.js: collection section calls renderSidebar from sidebar.js', () => {
    const section = APP_JS.slice(
        APP_JS.indexOf('function navigateToCollections'),
        APP_JS.indexOf('function triggerRemove')
    );
    assert.match(section, /renderSidebar\s*\(\)/);
});

test('app.js: collection section calls renderSidebarCollectionsList from sidebar.js', () => {
    const fn = extractFn(APP_JS, 'async function renameCollection(');
    assert.match(fn, /renderSidebarCollectionsList\s*\(\)/);
});

test('app.js: collection section calls updateSidebarActiveState from sidebar.js', () => {
    const fn = extractFn(APP_JS, 'function navigateToCollections()');
    assert.match(fn, /updateSidebarActiveState\s*\(\)/);
});

test('app.js: collection section calls updateSbContextBtn from sidebar.js', () => {
    const fn = extractFn(APP_JS, 'function navigateToCollections()');
    assert.match(fn, /updateSbContextBtn\s*\(\)/);
});

// ── 27. Cross-file callers ────────────────────────────────────────────────────

test('sidebar.js: sbGoManageCollections calls navigateToCollections', () => {
    const fn = extractFn(SIDEBAR_JS, 'function sbGoManageCollections()');
    assert.match(fn, /navigateToCollections\s*\(\)/);
});

test('sidebar.js: renderSidebarCollectionsList emits onclick navigateToCollections for more link', () => {
    const fn = extractFn(SIDEBAR_JS, 'function renderSidebarCollectionsList', 2000);
    assert.match(fn, /navigateToCollections\s*\(\)/);
});

test('dashboard.html: nav-collections item calls sbGoManageCollections', () => {
    assert.match(HTML, /onclick="sbGoManageCollections\s*\(\)"/);
});

// ── 28. Isolation tests ───────────────────────────────────────────────────────

// Slice the collection section: navigateToCollections through the end of deleteColl.
// Using function showContextMenu as the end marker, which is the first function
// in section 9 (CONTEXT MENU) and reliably terminates the collections block.
function _collectionBlock() {
    const start = APP_JS.indexOf('function navigateToCollections');
    const end   = APP_JS.indexOf('function showContextMenu(');
    return APP_JS.slice(start, end);
}

test('app.js: collection section does not reference AG_DISPLAY_DEFAULTS', () => {
    assert.doesNotMatch(_collectionBlock(), /AG_DISPLAY_DEFAULTS/);
});

test('app.js: collection section does not reference IG_DISPLAY_DEFAULTS', () => {
    assert.doesNotMatch(_collectionBlock(), /IG_DISPLAY_DEFAULTS/);
});

test('app.js: collection section does not reference window._agDisplayPrefs', () => {
    assert.doesNotMatch(_collectionBlock(), /window\._agDisplayPrefs/);
});

test('app.js: collection section does not reference window._igDisplayPrefs', () => {
    assert.doesNotMatch(_collectionBlock(), /window\._igDisplayPrefs/);
});

test('app.js: collection section does not reference Quick Switcher internals', () => {
    assert.doesNotMatch(_collectionBlock(), /_qsLoad|qsToggleEnabled|qsChangePosition/);
});

test('app.js: collection section does not reference system stats internals', () => {
    assert.doesNotMatch(_collectionBlock(), /renderSystemStats|_tickStats|initSystemStats/);
});

// ── 29. Comment hygiene ───────────────────────────────────────────────────────

test('app.js: collection section has no Arabic or mojibake characters', () => {
    assert.doesNotMatch(_collectionBlock(), /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/,
        'collection section must not contain Arabic characters');
});

test('app.js: collection section has no emoji in comments', () => {
    assert.doesNotMatch(_collectionBlock(), /\/\/.*[\u{1F300}-\u{1FAFF}]/u,
        'collection section must not have emoji in comments');
});
