'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT           = path.resolve(__dirname, '..');
const APP_JS         = fs.readFileSync(path.join(ROOT, 'src/js/app.js'),               'utf8');
const COLLECTIONS_JS = fs.readFileSync(path.join(ROOT, 'src/js/app/collections.js'),   'utf8');
const SIDEBAR_JS     = fs.readFileSync(path.join(ROOT, 'src/js/app/sidebar.js'),       'utf8');
const HTML           = fs.readFileSync(path.join(ROOT, 'src/dashboard.html'),          'utf8');

// ── helpers ───────────────────────────────────────────────────────────────────

function extractFn(src, sig, maxLen = 2000) {
    const idx = src.indexOf(sig);
    if (idx === -1) return '';
    return src.slice(idx, idx + maxLen);
}

// ── 1. Source-presence tests ─────────────────────────────────────────────────

test('collections.js: navigateToCollections function exists', () => {
    assert.match(COLLECTIONS_JS, /function navigateToCollections\s*\(\)/);
});

test('collections.js: renderCollectionsView function exists', () => {
    assert.match(COLLECTIONS_JS, /function renderCollectionsView\s*\(\)/);
});

test('collections.js: _renderCollectionsHeader function exists', () => {
    assert.match(COLLECTIONS_JS, /function _renderCollectionsHeader\s*\(/);
});

test('collections.js: _renderCollectionsStats function exists', () => {
    assert.match(COLLECTIONS_JS, /function _renderCollectionsStats\s*\(/);
});

test('collections.js: _collectionsEmptyStateHTML function exists', () => {
    assert.match(COLLECTIONS_JS, /function _collectionsEmptyStateHTML\s*\(\)/);
});

test('collections.js: _getGameByCollectionGameId function exists', () => {
    assert.match(COLLECTIONS_JS, /function _getGameByCollectionGameId\s*\(/);
});

test('collections.js: _getGameCoverUrl function exists', () => {
    assert.match(COLLECTIONS_JS, /function _getGameCoverUrl\s*\(/);
});

test('collections.js: _renderCollectionCard function exists', () => {
    assert.match(COLLECTIONS_JS, /function _renderCollectionCard\s*\(/);
});

test('collections.js: openAddGamesToCollection function exists', () => {
    assert.match(COLLECTIONS_JS, /function openAddGamesToCollection\s*\(/);
});

test('collections.js: toggleCollectionCardMenu function exists', () => {
    assert.match(COLLECTIONS_JS, /function toggleCollectionCardMenu\s*\(/);
});

test('collections.js: renameCollection function exists', () => {
    assert.match(COLLECTIONS_JS, /async function renameCollection\s*\(/);
});

test('collections.js: openCollectionModal function exists', () => {
    assert.match(COLLECTIONS_JS, /function openCollectionModal\s*\(\)/);
});

test('collections.js: closeCollectionModal function exists', () => {
    assert.match(COLLECTIONS_JS, /function closeCollectionModal\s*\(\)/);
});

test('collections.js: saveCollection function exists', () => {
    assert.match(COLLECTIONS_JS, /async function saveCollection\s*\(\)/);
});

test('collections.js: deleteColl function exists', () => {
    assert.match(COLLECTIONS_JS, /function deleteColl\s*\(/);
});

test('collections.js: filterByCollection function exists', () => {
    assert.match(COLLECTIONS_JS, /function filterByCollection\s*\(/);
});

test('collections.js: addToCollection function exists', () => {
    assert.match(COLLECTIONS_JS, /async function addToCollection\s*\(/);
});

test('collections.js: removeFromCurrentCollection function exists', () => {
    assert.match(COLLECTIONS_JS, /async function removeFromCurrentCollection\s*\(/);
});

test('collections.js: openCollectionSettings function exists', () => {
    assert.match(COLLECTIONS_JS, /function openCollectionSettings\s*\(/);
});

test('collections.js: closeCollectionSettings function exists', () => {
    assert.match(COLLECTIONS_JS, /function closeCollectionSettings\s*\(\)/);
});

test('collections.js: saveCollectionSettings function exists', () => {
    assert.match(COLLECTIONS_JS, /async function saveCollectionSettings\s*\(\)/);
});

test('collections.js: triggerDeleteCollection function exists', () => {
    assert.match(COLLECTIONS_JS, /function triggerDeleteCollection\s*\(\)/);
});

test('collections.js: changeCollectionImage function exists', () => {
    assert.match(COLLECTIONS_JS, /async function changeCollectionImage\s*\(\)/);
});

test('collections.js: resetCollectionImage function exists', () => {
    assert.match(COLLECTIONS_JS, /async function resetCollectionImage\s*\(\)/);
});

test('collections.js: currentEditingCollectionId state variable exists', () => {
    assert.match(COLLECTIONS_JS, /let currentEditingCollectionId\s*=/);
});

// ── 2. Window exports ─────────────────────────────────────────────────────────

test('collections.js: all 26 collection helpers are exposed on window', () => {
    const exports = [
        'navigateToCollections', 'renderCollectionsView',
        '_renderCollectionsHeader', '_renderCollectionsStats',
        '_collectionsEmptyStateHTML', '_getGameByCollectionGameId',
        '_getGameCoverUrl', '_renderCollectionCard',
        'openAddGamesToCollection', 'toggleCollectionCardMenu',
        'renameCollection', 'openCollectionModal', 'closeCollectionModal',
        'saveCollection', 'deleteColl', 'filterByCollection',
        'addToCollection', 'removeFromCurrentCollection',
        'openCollectionSettings', 'closeCollectionSettings',
        'saveCollectionSettings', 'triggerDeleteCollection',
        'changeCollectionImage', 'resetCollectionImage',
    ];
    for (const name of exports) {
        assert.match(COLLECTIONS_JS, new RegExp(`window\\.${name}\\s*=`),
            `window.${name} must be exported`);
    }
});

test('collections.js: openRenameCollectionModal aliases openCollectionSettings on window', () => {
    assert.match(COLLECTIONS_JS, /window\.openRenameCollectionModal\s*=\s*openCollectionSettings/);
});

// ── 3. navigateToCollections behaviour ───────────────────────────────────────

test('collections.js: navigateToCollections sets currentView to collections', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function navigateToCollections()');
    assert.match(fn, /currentView\s*=\s*'collections'/);
});

test('collections.js: navigateToCollections sets agReadyOnly to false', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function navigateToCollections()');
    assert.match(fn, /window\.agReadyOnly\s*=\s*false/);
});

test('collections.js: navigateToCollections clears collectionId filter', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function navigateToCollections()');
    assert.match(fn, /currentFilters\.collectionId\s*=\s*null/);
});

test('collections.js: navigateToCollections shows collectionsView element', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function navigateToCollections()');
    assert.match(fn, /getElementById\('collectionsView'\)/);
    assert.match(fn, /style\.display\s*=\s*'block'/);
});

test('collections.js: navigateToCollections calls updateSidebarActiveState', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function navigateToCollections()');
    assert.match(fn, /updateSidebarActiveState\s*\(\)/);
});

test('collections.js: navigateToCollections calls renderCollectionsView', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function navigateToCollections()');
    assert.match(fn, /renderCollectionsView\s*\(\)/);
});

test('collections.js: navigateToCollections calls updateSbContextBtn', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function navigateToCollections()');
    assert.match(fn, /updateSbContextBtn\s*\(\)/);
});

// ── 4. renderCollectionsView behaviour ───────────────────────────────────────

test('collections.js: renderCollectionsView reads collectionsGrid element', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function renderCollectionsView()');
    assert.match(fn, /getElementById\('collectionsGrid'\)/);
});

test('collections.js: renderCollectionsView filters out fav_system_default', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function renderCollectionsView()');
    assert.match(fn, /fav_system_default/);
});

test('collections.js: renderCollectionsView calls _renderCollectionsHeader', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function renderCollectionsView()');
    assert.match(fn, /_renderCollectionsHeader\s*\(/);
});

test('collections.js: renderCollectionsView calls _renderCollectionsStats', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function renderCollectionsView()');
    assert.match(fn, /_renderCollectionsStats\s*\(/);
});

test('collections.js: renderCollectionsView renders empty state when no custom collections', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function renderCollectionsView()');
    assert.match(fn, /is-empty/);
    assert.match(fn, /_collectionsEmptyStateHTML\s*\(\)/);
});

test('collections.js: renderCollectionsView maps collections through _renderCollectionCard', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function renderCollectionsView()');
    assert.match(fn, /_renderCollectionCard/);
    assert.match(fn, /\.map\s*\(_renderCollectionCard\)/);
});

// ── 5. _renderCollectionsHeader ───────────────────────────────────────────────

test('collections.js: _renderCollectionsHeader writes to collectionsHeader element', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function _renderCollectionsHeader(');
    assert.match(fn, /getElementById\('collectionsHeader'\)/);
    assert.match(fn, /\.innerHTML\s*=/);
});

test('collections.js: _renderCollectionsHeader contains New Collection button calling openCollectionModal', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function _renderCollectionsHeader(');
    assert.match(fn, /openCollectionModal\s*\(\)/);
});

test('collections.js: _renderCollectionsHeader contains Browse Library button calling navigateToInstalled', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function _renderCollectionsHeader(');
    assert.match(fn, /navigateToInstalled\s*\(\)/);
});

// ── 6. _renderCollectionsStats ────────────────────────────────────────────────

test('collections.js: _renderCollectionsStats writes to collectionsStats element', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function _renderCollectionsStats(');
    assert.match(fn, /getElementById\('collectionsStats'\)/);
});

test('collections.js: _renderCollectionsStats clears element when no collections', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function _renderCollectionsStats(');
    assert.match(fn, /\.innerHTML\s*=\s*''/);
});

test('collections.js: _renderCollectionsStats computes total game count across collections', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function _renderCollectionsStats(');
    assert.match(fn, /gameIds/);
    assert.match(fn, /reduce/);
});

test('collections.js: _renderCollectionsStats renders three stat cards', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function _renderCollectionsStats(', 1500);
    const matches = fn.match(/collections-stat-card/g);
    assert.ok(matches && matches.length >= 3, 'must render at least 3 stat cards');
});

// ── 7. _collectionsEmptyStateHTML ─────────────────────────────────────────────

test('collections.js: _collectionsEmptyStateHTML returns HTML string with empty state class', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function _collectionsEmptyStateHTML()');
    assert.match(fn, /collections-empty-state/);
});

test('collections.js: _collectionsEmptyStateHTML contains Create Collection button calling openCollectionModal', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function _collectionsEmptyStateHTML()');
    assert.match(fn, /openCollectionModal\s*\(\)/);
});

test('collections.js: _collectionsEmptyStateHTML contains Browse Games button calling navigateToInstalled', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function _collectionsEmptyStateHTML()');
    assert.match(fn, /navigateToInstalled\s*\(\)/);
});

// ── 8. _getGameByCollectionGameId ─────────────────────────────────────────────

test('collections.js: _getGameByCollectionGameId searches multiple game pools', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function _getGameByCollectionGameId(');
    assert.match(fn, /window\._allGamesCache/);
    assert.match(fn, /allGamesData/);
    assert.match(fn, /window\._suggAllGames/);
});

test('collections.js: _getGameByCollectionGameId matches by id, gameId, appid, and path', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function _getGameByCollectionGameId(');
    assert.match(fn, /g\.id/);
    assert.match(fn, /g\.gameId/);
    assert.match(fn, /g\.appid/);
    assert.match(fn, /g\.path/);
});

test('collections.js: _getGameByCollectionGameId returns null when not found', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function _getGameByCollectionGameId(');
    assert.match(fn, /return null/);
});

// ── 9. _getGameCoverUrl ───────────────────────────────────────────────────────

test('collections.js: _getGameCoverUrl returns empty string for falsy input', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function _getGameCoverUrl(');
    assert.match(fn, /if\s*\(!game\)\s*return\s*''/);
});

test('collections.js: _getGameCoverUrl tries cover, coverUrl, image, hero, poster, icon fields', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function _getGameCoverUrl(');
    assert.match(fn, /game\.cover/);
    assert.match(fn, /game\.coverUrl/);
    assert.match(fn, /game\.image/);
    assert.match(fn, /game\.hero/);
    assert.match(fn, /game\.poster/);
    assert.match(fn, /game\.icon/);
});

// ── 10. _renderCollectionCard ─────────────────────────────────────────────────

test('collections.js: _renderCollectionCard escapes collection id and name with escapeHtml', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function _renderCollectionCard(');
    assert.match(fn, /escapeHtml\s*\(String\s*\(c\.id\)\)/);
    assert.match(fn, /escapeHtml\s*\(c\.name/);
});

test('collections.js: _renderCollectionCard renders article.collection-card with filterByCollection onclick', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function _renderCollectionCard(', 3200);
    assert.match(fn, /class="collection-card"/);
    assert.match(fn, /filterByCollection\s*\(/);
});

test('collections.js: _renderCollectionCard renders Add Games button calling openAddGamesToCollection', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function _renderCollectionCard(', 3200);
    assert.match(fn, /openAddGamesToCollection\s*\(/);
});

test('collections.js: _renderCollectionCard renders More button calling toggleCollectionCardMenu', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function _renderCollectionCard(', 3200);
    assert.match(fn, /toggleCollectionCardMenu\s*\(/);
});

test('collections.js: _renderCollectionCard renders Rename button calling openRenameCollectionModal', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function _renderCollectionCard(', 3200);
    assert.match(fn, /openRenameCollectionModal\s*\(/);
});

test('collections.js: _renderCollectionCard renders Delete button calling deleteColl', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function _renderCollectionCard(', 3200);
    assert.match(fn, /deleteColl\s*\(/);
});

test('collections.js: _renderCollectionCard renders game count label with singular/plural', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function _renderCollectionCard(');
    assert.match(fn, /1 game/);
    assert.match(fn, /games/);
});

test('collections.js: _renderCollectionCard uses c.image for custom cover when present', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function _renderCollectionCard(', 1500);
    assert.match(fn, /c\.image/);
    assert.match(fn, /collection-card-cover--single/);
});

test('collections.js: _renderCollectionCard builds game cover collage via _getGameCoverUrl', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function _renderCollectionCard(', 1500);
    assert.match(fn, /_getGameCoverUrl/);
    assert.match(fn, /_getGameByCollectionGameId/);
});

test('collections.js: _renderCollectionCard renders collection-cover-placeholder when no covers', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function _renderCollectionCard(', 1500);
    assert.match(fn, /collection-cover-placeholder/);
});

// ── 11. toggleCollectionCardMenu ─────────────────────────────────────────────

test('collections.js: toggleCollectionCardMenu closes all other menus before toggling target', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function toggleCollectionCardMenu(');
    assert.match(fn, /querySelectorAll\s*\(\s*'\.collection-card-menu'\s*\)/);
    assert.match(fn, /m\.hidden\s*=\s*true/);
});

test('collections.js: toggleCollectionCardMenu toggles the target menu hidden state', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function toggleCollectionCardMenu(');
    assert.match(fn, /menu\.hidden\s*=\s*!menu\.hidden/);
});

test('collections.js: toggleCollectionCardMenu registers a global dismiss click listener once', () => {
    assert.match(COLLECTIONS_JS, /_collMenuDismissRegistered/);
    assert.match(COLLECTIONS_JS, /document\.addEventListener\s*\(\s*'click'/);
});

// ── 12. openAddGamesToCollection ──────────────────────────────────────────────

test('collections.js: openAddGamesToCollection sets window.activeAddToCollectionId', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function openAddGamesToCollection(');
    assert.match(fn, /window\.activeAddToCollectionId\s*=\s*collectionId/);
});

test('collections.js: openAddGamesToCollection navigates to installed view', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function openAddGamesToCollection(');
    assert.match(fn, /navigateToInstalled\s*\(\)/);
});

// ── 13. renameCollection ──────────────────────────────────────────────────────

test('collections.js: renameCollection finds collection in allCollections', () => {
    const fn = extractFn(COLLECTIONS_JS, 'async function renameCollection(');
    assert.match(fn, /allCollections.*find/);
});

test('collections.js: renameCollection returns early if collection not found', () => {
    const fn = extractFn(COLLECTIONS_JS, 'async function renameCollection(');
    assert.match(fn, /if\s*\(!coll\)\s*return/);
});

test('collections.js: renameCollection calls window.electronAPI.updateCollection', () => {
    const fn = extractFn(COLLECTIONS_JS, 'async function renameCollection(');
    assert.match(fn, /window\.electronAPI\.updateCollection\s*\(/);
});

test('collections.js: renameCollection refreshes allCollections from getCollections after rename', () => {
    const fn = extractFn(COLLECTIONS_JS, 'async function renameCollection(');
    assert.match(fn, /window\.electronAPI\.getCollections\s*\(\)/);
    assert.match(fn, /allCollections\s*=/);
});

test('collections.js: renameCollection calls renderCollectionsView after rename', () => {
    const fn = extractFn(COLLECTIONS_JS, 'async function renameCollection(');
    assert.match(fn, /renderCollectionsView\s*\(\)/);
});

test('collections.js: renameCollection calls renderSidebarCollectionsList after rename', () => {
    const fn = extractFn(COLLECTIONS_JS, 'async function renameCollection(');
    assert.match(fn, /renderSidebarCollectionsList\s*\(\)/);
});

test('collections.js: renameCollection shows warning toast when name is empty', () => {
    const fn = extractFn(COLLECTIONS_JS, 'async function renameCollection(');
    assert.match(fn, /showToast\s*\(.*warning/);
});

test('collections.js: renameCollection shows success toast after rename', () => {
    const fn = extractFn(COLLECTIONS_JS, 'async function renameCollection(');
    assert.match(fn, /showToast\s*\(.*success/);
});

test('collections.js: renameCollection shows error toast on exception', () => {
    const fn = extractFn(COLLECTIONS_JS, 'async function renameCollection(');
    assert.match(fn, /showToast\s*\(.*error/);
});

// ── 14. openCollectionModal / closeCollectionModal ────────────────────────────

test('collections.js: openCollectionModal clears collName input and activates modal', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function openCollectionModal()');
    assert.match(fn, /getElementById\s*\(\s*'collName'\s*\)/);
    assert.match(fn, /getElementById\s*\(\s*'collectionModal'\s*\)/);
    assert.match(fn, /classList\.add\s*\(\s*'active'\s*\)/);
});

test('collections.js: closeCollectionModal removes active class from collectionModal', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function closeCollectionModal()');
    assert.match(fn, /getElementById\s*\(\s*'collectionModal'\s*\)/);
    assert.match(fn, /classList\.remove\s*\(\s*'active'\s*\)/);
});

// ── 15. saveCollection ────────────────────────────────────────────────────────

test('collections.js: saveCollection reads collName input value', () => {
    const fn = extractFn(COLLECTIONS_JS, 'async function saveCollection()');
    assert.match(fn, /getElementById\s*\(\s*'collName'\s*\)/);
    assert.match(fn, /\.value\.trim\s*\(\)/);
});

test('collections.js: saveCollection shows error toast when name is empty', () => {
    const fn = extractFn(COLLECTIONS_JS, 'async function saveCollection()');
    assert.match(fn, /showToast\s*\(.*error/);
});

test('collections.js: saveCollection calls window.electronAPI.createCollection', () => {
    const fn = extractFn(COLLECTIONS_JS, 'async function saveCollection()');
    assert.match(fn, /window\.electronAPI\.createCollection\s*\(/);
});

test('collections.js: saveCollection refreshes allCollections after create', () => {
    const fn = extractFn(COLLECTIONS_JS, 'async function saveCollection()');
    assert.match(fn, /allCollections\s*=\s*await\s*window\.electronAPI\.getCollections/);
});

test('collections.js: saveCollection calls renderSidebar after create', () => {
    const fn = extractFn(COLLECTIONS_JS, 'async function saveCollection()');
    assert.match(fn, /renderSidebar\s*\(\)/);
});

test('collections.js: saveCollection calls closeCollectionModal after create', () => {
    const fn = extractFn(COLLECTIONS_JS, 'async function saveCollection()');
    assert.match(fn, /closeCollectionModal\s*\(\)/);
});

test('collections.js: saveCollection calls renderCollectionsView when on collections page', () => {
    const fn = extractFn(COLLECTIONS_JS, 'async function saveCollection()');
    assert.match(fn, /currentView\s*===\s*'collections'/);
    assert.match(fn, /renderCollectionsView\s*\(\)/);
});

test('collections.js: saveCollection shows success toast after create', () => {
    const fn = extractFn(COLLECTIONS_JS, 'async function saveCollection()');
    assert.match(fn, /showToast\s*\(.*success/);
});

// ── 16. deleteColl ────────────────────────────────────────────────────────────

test('collections.js: deleteColl stops event propagation', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function deleteColl(');
    assert.match(fn, /e\.stopPropagation\s*\(\)/);
});

test('collections.js: deleteColl calls openConfirmModal for confirmation', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function deleteColl(');
    assert.match(fn, /openConfirmModal\s*\(/);
    assert.match(fn, /Delete/);
});

test('collections.js: deleteColl calls window.electronAPI.deleteCollection inside confirm callback', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function deleteColl(', 800);
    assert.match(fn, /window\.electronAPI\.deleteCollection\s*\(/);
});

test('collections.js: deleteColl refreshes allCollections after delete', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function deleteColl(', 800);
    assert.match(fn, /allCollections\s*=\s*await\s*window\.electronAPI\.getCollections/);
});

test('collections.js: deleteColl clears collectionId filter when deleted collection was active', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function deleteColl(', 800);
    assert.match(fn, /currentFilters\.collectionId.*null/);
});

test('collections.js: deleteColl calls renderSidebar after delete', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function deleteColl(', 800);
    assert.match(fn, /renderSidebar\s*\(\)/);
});

test('collections.js: deleteColl navigates to installed if currently in single collection view', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function deleteColl(', 800);
    assert.match(fn, /currentView.*'collection'/);
    assert.match(fn, /navigateToInstalled\s*\(\)/);
});

// ── 17. filterByCollection ────────────────────────────────────────────────────

test('collections.js: filterByCollection sets currentView to collection', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function filterByCollection(');
    assert.match(fn, /currentView\s*=\s*'collection'/);
});

test('collections.js: filterByCollection sets agReadyOnly to false', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function filterByCollection(');
    assert.match(fn, /window\.agReadyOnly\s*=\s*false/);
});

test('collections.js: filterByCollection sets currentFilters.collectionId', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function filterByCollection(');
    assert.match(fn, /currentFilters\.collectionId\s*=\s*collId/);
});

test('collections.js: filterByCollection shows installedGamesView', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function filterByCollection(');
    assert.match(fn, /getElementById\s*\(\s*'installedGamesView'\s*\)/);
    assert.match(fn, /style\.display\s*=\s*'block'/);
});

test('collections.js: filterByCollection calls updateSidebarActiveState', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function filterByCollection(');
    assert.match(fn, /updateSidebarActiveState\s*\(\)/);
});

test('collections.js: filterByCollection calls updateSbContextBtn', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function filterByCollection(');
    assert.match(fn, /updateSbContextBtn\s*\(\)/);
});

test('collections.js: filterByCollection calls applyFilters', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function filterByCollection(');
    assert.match(fn, /applyFilters\s*\(\)/);
});

test('collections.js: filterByCollection resets platform filter to all', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function filterByCollection(');
    assert.match(fn, /currentFilters\.platform\s*=\s*'all'/);
});

test('collections.js: filterByCollection clears search filter', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function filterByCollection(');
    assert.match(fn, /currentFilters\.search\s*=\s*''/);
});

// ── 18. addToCollection ───────────────────────────────────────────────────────

test('collections.js: addToCollection hides context menu first', () => {
    const fn = extractFn(COLLECTIONS_JS, 'async function addToCollection(');
    assert.match(fn, /hideContextMenu\s*\(\)/);
});

test('collections.js: addToCollection calls window.electronAPI.addGameToCollection', () => {
    const fn = extractFn(COLLECTIONS_JS, 'async function addToCollection(');
    assert.match(fn, /window\.electronAPI\.addGameToCollection\s*\(/);
});

test('collections.js: addToCollection refreshes allCollections after add', () => {
    const fn = extractFn(COLLECTIONS_JS, 'async function addToCollection(');
    assert.match(fn, /allCollections\s*=\s*await\s*window\.electronAPI\.getCollections/);
});

test('collections.js: addToCollection calls renderSidebar after add', () => {
    const fn = extractFn(COLLECTIONS_JS, 'async function addToCollection(');
    assert.match(fn, /renderSidebar\s*\(\)/);
});

test('collections.js: addToCollection shows success toast', () => {
    const fn = extractFn(COLLECTIONS_JS, 'async function addToCollection(');
    assert.match(fn, /showToast\s*\(.*success/);
});

// ── 19. removeFromCurrentCollection ──────────────────────────────────────────

test('collections.js: removeFromCurrentCollection returns early when no active collection', () => {
    const fn = extractFn(COLLECTIONS_JS, 'async function removeFromCurrentCollection(');
    assert.match(fn, /if\s*\(!currentFilters\.collectionId\)/);
});

test('collections.js: removeFromCurrentCollection calls window.electronAPI.removeGameFromCollection', () => {
    const fn = extractFn(COLLECTIONS_JS, 'async function removeFromCurrentCollection(');
    assert.match(fn, /window\.electronAPI\.removeGameFromCollection\s*\(/);
});

test('collections.js: removeFromCurrentCollection refreshes allCollections on success', () => {
    const fn = extractFn(COLLECTIONS_JS, 'async function removeFromCurrentCollection(');
    assert.match(fn, /allCollections\s*=\s*await\s*window\.electronAPI\.getCollections/);
});

test('collections.js: removeFromCurrentCollection calls applyFilters on success', () => {
    const fn = extractFn(COLLECTIONS_JS, 'async function removeFromCurrentCollection(');
    assert.match(fn, /applyFilters\s*\(\)/);
});

test('collections.js: removeFromCurrentCollection shows success toast on success', () => {
    const fn = extractFn(COLLECTIONS_JS, 'async function removeFromCurrentCollection(');
    assert.match(fn, /showToast\s*\(.*success/);
});

// ── 20. openCollectionSettings / closeCollectionSettings ─────────────────────

test('collections.js: openCollectionSettings stores id in currentEditingCollectionId', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function openCollectionSettings(');
    assert.match(fn, /currentEditingCollectionId\s*=\s*id/);
});

test('collections.js: openCollectionSettings populates editCollNameInput with collection name', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function openCollectionSettings(');
    assert.match(fn, /getElementById\s*\(\s*'editCollNameInput'\s*\)/);
    assert.match(fn, /\.value\s*=/);
});

test('collections.js: openCollectionSettings disables name input for fav_system_default', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function openCollectionSettings(', 700);
    assert.match(fn, /fav_system_default/);
    assert.match(fn, /nameInput\.disabled\s*=\s*true/);
});

test('collections.js: openCollectionSettings hides delete button for fav_system_default', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function openCollectionSettings(', 700);
    assert.match(fn, /deleteBtn.*display.*none|display.*none.*deleteBtn/s);
});

test('collections.js: openCollectionSettings activates collectionSettingsModal', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function openCollectionSettings(', 1000);
    assert.match(fn, /getElementById\s*\(\s*'collectionSettingsModal'\s*\)/);
    assert.match(fn, /classList\.add\s*\(\s*'active'\s*\)/);
});

test('collections.js: closeCollectionSettings deactivates collectionSettingsModal', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function closeCollectionSettings()');
    assert.match(fn, /getElementById\s*\(\s*'collectionSettingsModal'\s*\)/);
    assert.match(fn, /classList\.remove\s*\(\s*'active'\s*\)/);
});

test('collections.js: closeCollectionSettings resets currentEditingCollectionId to null', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function closeCollectionSettings()');
    assert.match(fn, /currentEditingCollectionId\s*=\s*null/);
});

// ── 21. saveCollectionSettings ────────────────────────────────────────────────

test('collections.js: saveCollectionSettings returns early when currentEditingCollectionId is null', () => {
    const fn = extractFn(COLLECTIONS_JS, 'async function saveCollectionSettings()');
    assert.match(fn, /if\s*\(!currentEditingCollectionId\)\s*return/);
});

test('collections.js: saveCollectionSettings reads editCollNameInput value', () => {
    const fn = extractFn(COLLECTIONS_JS, 'async function saveCollectionSettings()');
    assert.match(fn, /getElementById\s*\(\s*'editCollNameInput'\s*\)/);
    assert.match(fn, /\.value\.trim\s*\(\)/);
});

test('collections.js: saveCollectionSettings calls window.electronAPI.updateCollection', () => {
    const fn = extractFn(COLLECTIONS_JS, 'async function saveCollectionSettings()');
    assert.match(fn, /window\.electronAPI\.updateCollection\s*\(/);
});

test('collections.js: saveCollectionSettings calls renderSidebar after save', () => {
    const fn = extractFn(COLLECTIONS_JS, 'async function saveCollectionSettings()');
    assert.match(fn, /renderSidebar\s*\(\)/);
});

test('collections.js: saveCollectionSettings calls renderCollectionsView when on collections page', () => {
    const fn = extractFn(COLLECTIONS_JS, 'async function saveCollectionSettings()');
    assert.match(fn, /currentView\s*===\s*'collections'/);
    assert.match(fn, /renderCollectionsView\s*\(\)/);
});

test('collections.js: saveCollectionSettings calls closeCollectionSettings after save', () => {
    const fn = extractFn(COLLECTIONS_JS, 'async function saveCollectionSettings()');
    assert.match(fn, /closeCollectionSettings\s*\(\)/);
});

// ── 22. triggerDeleteCollection ───────────────────────────────────────────────

test('collections.js: triggerDeleteCollection returns early when no currentEditingCollectionId', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function triggerDeleteCollection()');
    assert.match(fn, /if\s*\(!currentEditingCollectionId\)\s*return/);
});

test('collections.js: triggerDeleteCollection calls openConfirmModal for confirmation', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function triggerDeleteCollection()');
    assert.match(fn, /openConfirmModal\s*\(/);
    assert.match(fn, /Delete/);
});

test('collections.js: triggerDeleteCollection calls window.electronAPI.deleteCollection inside confirm', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function triggerDeleteCollection()', 900);
    assert.match(fn, /window\.electronAPI\.deleteCollection\s*\(/);
});

test('collections.js: triggerDeleteCollection clears collectionId filter when deleted was active', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function triggerDeleteCollection()', 900);
    assert.match(fn, /currentFilters\.collectionId\s*=\s*null/);
});

test('collections.js: triggerDeleteCollection navigates to installed when in single collection view', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function triggerDeleteCollection()', 900);
    assert.match(fn, /currentView.*'collection'/);
    assert.match(fn, /navigateToInstalled\s*\(\)/);
});

test('collections.js: triggerDeleteCollection calls closeCollectionSettings after delete', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function triggerDeleteCollection()', 900);
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

test('collections.js: collection functions use electronAPI.getCollections', () => {
    assert.match(COLLECTIONS_JS, /window\.electronAPI\.getCollections\s*\(\)/);
});

test('collections.js: saveCollection uses electronAPI.createCollection', () => {
    assert.match(COLLECTIONS_JS, /window\.electronAPI\.createCollection\s*\(/);
});

test('collections.js: deleteColl uses electronAPI.deleteCollection', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function deleteColl(', 600);
    assert.match(fn, /window\.electronAPI\.deleteCollection\s*\(/);
});

test('collections.js: triggerDeleteCollection uses electronAPI.deleteCollection', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function triggerDeleteCollection()', 600);
    assert.match(fn, /window\.electronAPI\.deleteCollection\s*\(/);
});

test('collections.js: renameCollection uses electronAPI.updateCollection', () => {
    const fn = extractFn(COLLECTIONS_JS, 'async function renameCollection(');
    assert.match(fn, /window\.electronAPI\.updateCollection\s*\(/);
});

test('collections.js: saveCollectionSettings uses electronAPI.updateCollection', () => {
    const fn = extractFn(COLLECTIONS_JS, 'async function saveCollectionSettings()');
    assert.match(fn, /window\.electronAPI\.updateCollection\s*\(/);
});

test('collections.js: addToCollection uses electronAPI.addGameToCollection', () => {
    const fn = extractFn(COLLECTIONS_JS, 'async function addToCollection(');
    assert.match(fn, /window\.electronAPI\.addGameToCollection\s*\(/);
});

test('collections.js: removeFromCurrentCollection uses electronAPI.removeGameFromCollection', () => {
    const fn = extractFn(COLLECTIONS_JS, 'async function removeFromCurrentCollection(');
    assert.match(fn, /window\.electronAPI\.removeGameFromCollection\s*\(/);
});

test('collections.js: changeCollectionImage uses electronAPI.selectImage', () => {
    const fn = extractFn(COLLECTIONS_JS, 'async function changeCollectionImage()');
    assert.match(fn, /window\.electronAPI\.selectImage\s*\(\)/);
});

test('collections.js: changeCollectionImage uses electronAPI.updateCollection', () => {
    const fn = extractFn(COLLECTIONS_JS, 'async function changeCollectionImage()');
    assert.match(fn, /window\.electronAPI\.updateCollection\s*\(/);
});

test('collections.js: resetCollectionImage uses electronAPI.updateCollection', () => {
    const fn = extractFn(COLLECTIONS_JS, 'async function resetCollectionImage()');
    assert.match(fn, /window\.electronAPI\.updateCollection\s*\(/);
});

// ── 26. Intentional dependencies on app.js globals ───────────────────────────

test('collections.js: depends on allCollections global', () => {
    assert.match(COLLECTIONS_JS, /allCollections/);
});

test('collections.js: depends on allGamesData global', () => {
    assert.match(COLLECTIONS_JS, /allGamesData/);
});

test('collections.js: depends on currentView global', () => {
    assert.match(COLLECTIONS_JS, /currentView/);
});

test('collections.js: depends on currentFilters global', () => {
    assert.match(COLLECTIONS_JS, /currentFilters/);
});

test('collections.js: uses showToast helper', () => {
    assert.match(COLLECTIONS_JS, /showToast\s*\(/);
});

test('collections.js: uses openConfirmModal helper', () => {
    assert.match(COLLECTIONS_JS, /openConfirmModal\s*\(/);
});

test('collections.js: uses escapeHtml helper', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function _renderCollectionCard(', 3200);
    assert.match(fn, /escapeHtml\s*\(/);
});

test('collections.js: calls renderSidebar from sidebar.js', () => {
    assert.match(COLLECTIONS_JS, /renderSidebar\s*\(\)/);
});

test('collections.js: calls renderSidebarCollectionsList from sidebar.js', () => {
    const fn = extractFn(COLLECTIONS_JS, 'async function renameCollection(');
    assert.match(fn, /renderSidebarCollectionsList\s*\(\)/);
});

test('collections.js: calls updateSidebarActiveState from sidebar.js', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function navigateToCollections()');
    assert.match(fn, /updateSidebarActiveState\s*\(\)/);
});

test('collections.js: calls updateSbContextBtn from sidebar.js', () => {
    const fn = extractFn(COLLECTIONS_JS, 'function navigateToCollections()');
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

test('collections.js: does not reference AG_DISPLAY_DEFAULTS', () => {
    assert.doesNotMatch(COLLECTIONS_JS, /AG_DISPLAY_DEFAULTS/);
});

test('collections.js: does not reference IG_DISPLAY_DEFAULTS', () => {
    assert.doesNotMatch(COLLECTIONS_JS, /IG_DISPLAY_DEFAULTS/);
});

test('collections.js: does not reference window._agDisplayPrefs', () => {
    assert.doesNotMatch(COLLECTIONS_JS, /window\._agDisplayPrefs/);
});

test('collections.js: does not reference window._igDisplayPrefs', () => {
    assert.doesNotMatch(COLLECTIONS_JS, /window\._igDisplayPrefs/);
});

test('collections.js: does not reference Quick Switcher internals', () => {
    assert.doesNotMatch(COLLECTIONS_JS, /_qsLoad|qsToggleEnabled|qsChangePosition/);
});

test('collections.js: does not reference system stats internals', () => {
    assert.doesNotMatch(COLLECTIONS_JS, /renderSystemStats|_tickStats|initSystemStats/);
});

// ── 29. Comment hygiene ───────────────────────────────────────────────────────

test('collections.js: has no Arabic or mojibake characters', () => {
    assert.doesNotMatch(COLLECTIONS_JS, /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/,
        'collections.js must not contain Arabic characters');
});

test('collections.js: has no emoji in comments', () => {
    assert.doesNotMatch(COLLECTIONS_JS, /\/\/.*[\u{1F300}-\u{1FAFF}]/u,
        'collections.js must not have emoji in comments');
});

// ── 30. No-redeclaration tests ────────────────────────────────────────────────

test('app.js: does not redeclare navigateToCollections', () => {
    assert.doesNotMatch(APP_JS, /^function navigateToCollections\s*\(\)/m);
});

test('app.js: does not redeclare renderCollectionsView', () => {
    assert.doesNotMatch(APP_JS, /^function renderCollectionsView\s*\(\)/m);
});

test('app.js: does not redeclare _renderCollectionCard', () => {
    assert.doesNotMatch(APP_JS, /^function _renderCollectionCard\s*\(/m);
});

test('app.js: does not redeclare filterByCollection', () => {
    assert.doesNotMatch(APP_JS, /^function filterByCollection\s*\(/m);
});

test('app.js: does not redeclare openCollectionModal', () => {
    assert.doesNotMatch(APP_JS, /^function openCollectionModal\s*\(\)/m);
});

test('app.js: does not redeclare saveCollection', () => {
    assert.doesNotMatch(APP_JS, /^async function saveCollection\s*\(\)/m);
});

test('app.js: does not redeclare deleteColl', () => {
    assert.doesNotMatch(APP_JS, /^function deleteColl\s*\(/m);
});

test('app.js: does not redeclare addToCollection', () => {
    assert.doesNotMatch(APP_JS, /^async function addToCollection\s*\(/m);
});

test('app.js: does not redeclare removeFromCurrentCollection', () => {
    assert.doesNotMatch(APP_JS, /^async function removeFromCurrentCollection\s*\(/m);
});

test('app.js: does not redeclare openCollectionSettings', () => {
    assert.doesNotMatch(APP_JS, /^function openCollectionSettings\s*\(/m);
});

test('app.js: does not redeclare triggerDeleteCollection', () => {
    assert.doesNotMatch(APP_JS, /^function triggerDeleteCollection\s*\(\)/m);
});

test('app.js: does not redeclare currentEditingCollectionId', () => {
    assert.doesNotMatch(APP_JS, /^let currentEditingCollectionId\s*=/m);
});

// ── 31. Script order tests ────────────────────────────────────────────────────

test('dashboard.html: collections.js script tag is present', () => {
    assert.match(HTML, /src="js\/app\/collections\.js"/);
});

test('dashboard.html: toast-confirm.js loads before collections.js', () => {
    const toastIdx       = HTML.indexOf('js/app/toast-confirm.js');
    const collectionsIdx = HTML.indexOf('js/app/collections.js');
    assert.ok(toastIdx > -1, 'toast-confirm.js must be present');
    assert.ok(collectionsIdx > -1, 'collections.js must be present');
    assert.ok(toastIdx < collectionsIdx, 'toast-confirm.js must load before collections.js');
});

test('dashboard.html: sidebar.js loads before collections.js', () => {
    const sidebarIdx     = HTML.indexOf('js/app/sidebar.js');
    const collectionsIdx = HTML.indexOf('js/app/collections.js');
    assert.ok(sidebarIdx > -1, 'sidebar.js must be present');
    assert.ok(collectionsIdx > -1, 'collections.js must be present');
    assert.ok(sidebarIdx < collectionsIdx, 'sidebar.js must load before collections.js');
});

test('dashboard.html: collections.js loads before app.js', () => {
    const collectionsIdx = HTML.indexOf('js/app/collections.js');
    const appIdx         = HTML.indexOf('"js/app.js"');
    assert.ok(collectionsIdx > -1, 'collections.js must be present');
    assert.ok(appIdx > -1, 'app.js must be present');
    assert.ok(collectionsIdx < appIdx, 'collections.js must load before app.js');
});

test('dashboard.html: collections.js loads before accounts/display-prefs.js', () => {
    const collectionsIdx  = HTML.indexOf('js/app/collections.js');
    const displayPrefsIdx = HTML.indexOf('js/accounts/display-prefs.js');
    assert.ok(collectionsIdx > -1, 'collections.js must be present');
    assert.ok(displayPrefsIdx > -1, 'display-prefs.js must be present');
    assert.ok(collectionsIdx < displayPrefsIdx, 'collections.js must load before display-prefs.js');
});
