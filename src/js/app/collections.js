// ── Collections helpers ───────────────────────────────────────────────────────
// Drives the Collections page: navigation, view rendering, card rendering,
// collection card menus, CRUD modals (create / rename / delete / settings),
// image customization, and the add/remove-game-from-collection flows.
//
// Loads before app.js. All references to app.js globals (allCollections,
// allGamesData, currentView, currentFilters, currentHeroGameId,
// selectedGameId) resolve at call time through the classic-script Global
// Declarative Environment — they do not need to exist at parse time.

// ── State ─────────────────────────────────────────────────────────────────────
let currentEditingCollectionId = null;

// ── Navigation ────────────────────────────────────────────────────────────────
function navigateToCollections() {
    window.electronAPI?.trackFeatureEvent?.('feature_viewed', { feature: 'collections', view: 'collections' }).catch?.(() => {});
    window.agReadyOnly = false;
    currentView = 'collections';
    currentFilters.collectionId = null;
    _hideAllViews();

    const view = document.getElementById('collectionsView');
    if (view) view.style.display = 'block';

    updateSidebarActiveState();
    renderCollectionsView();
    updateSbContextBtn();
}

function filterByCollection(collId) {
    window.electronAPI?.trackFeatureEvent?.('feature_viewed', { feature: 'collections', view: 'collection' }).catch?.(() => {});
    window.agReadyOnly = false;
    currentView = 'collection';
    _hideAllViews();

    // Collections / Favorites do NOT show the full hero/play area.
    // heroSection stays hidden; only the installedGamesView content pane is shown.
    document.getElementById('installedGamesView').style.display = 'block';

    currentFilters.collectionId = collId;
    currentHeroGameId = null;
    currentFilters.platform = 'all';
    currentFilters.search = '';
    const searchInp = document.getElementById('searchInput');
    if (searchInp) searchInp.value = '';
    const platformTxt = document.getElementById('selectedPlatformText');
    if (platformTxt) platformTxt.innerText = 'All Platforms';

    const igPlatformTxt = document.getElementById('igSelectedPlatformText');
    if (igPlatformTxt) igPlatformTxt.innerText = 'All Platforms';

    // Reflect active state immediately (before applyFilters re-renders).
    updateSidebarActiveState();
    if (typeof updateSbContextBtn === 'function') updateSbContextBtn();

    applyFilters();
}

// ── Collections page rendering ────────────────────────────────────────────────
function renderCollectionsView() {
    const grid = document.getElementById('collectionsGrid');
    if (!grid) return;

    const custom = (allCollections || []).filter(c => c.id !== 'fav_system_default');

    _renderCollectionsHeader(custom);
    _renderCollectionsStats(custom);

    if (!custom.length) {
        grid.classList.add('is-empty');
        grid.innerHTML = _collectionsEmptyStateHTML();
        return;
    }

    grid.classList.remove('is-empty');
    grid.innerHTML = custom.map(_renderCollectionCard).join('');
}

function _renderCollectionsHeader(custom) {
    const el = document.getElementById('collectionsHeader');
    if (!el) return;
    el.innerHTML =
        `<section class="collections-hero">` +
          `<div class="collections-hero-text">` +
            `<p class="collections-eyebrow">LIBRARY ORGANIZER</p>` +
            `<h1 class="collections-hero-title">Collections</h1>` +
            `<p class="collections-hero-sub">Group your games by mood, platform, genre, backlog, or anything you want.</p>` +
          `</div>` +
          `<div class="collections-hero-actions">` +
            `<button class="collections-primary-btn" onclick="openCollectionModal()">+ New Collection</button>` +
            `<button class="collections-secondary-btn" onclick="navigateToInstalled()">Browse Library</button>` +
          `</div>` +
        `</section>`;
}

function _renderCollectionsStats(custom) {
    const el = document.getElementById('collectionsStats');
    if (!el) return;
    if (!custom.length) { el.innerHTML = ''; return; }

    const totalGames = custom.reduce((sum, c) => sum + (Array.isArray(c.gameIds) ? c.gameIds.length : 0), 0);
    const avg = custom.length > 0 ? Math.round(totalGames / custom.length) : 0;

    el.innerHTML =
        `<div class="collections-stats">` +
          `<div class="collections-stat-card">` +
            `<div class="collections-stat-value">${custom.length}</div>` +
            `<div class="collections-stat-label">Collections</div>` +
          `</div>` +
          `<div class="collections-stat-card">` +
            `<div class="collections-stat-value">${totalGames}</div>` +
            `<div class="collections-stat-label">Organized Games</div>` +
          `</div>` +
          `<div class="collections-stat-card">` +
            `<div class="collections-stat-value">${avg}</div>` +
            `<div class="collections-stat-label">Avg. Per Collection</div>` +
          `</div>` +
        `</div>`;
}

function _collectionsEmptyStateHTML() {
    return (
        `<div class="collections-empty-state">` +
          `<div class="collections-empty-inner">` +
            `<div class="collections-empty-art">` +
              `<svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="rgba(18,206,24,0.75)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">` +
                `<path d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/>` +
              `</svg>` +
            `</div>` +
            `<h2>Start organizing your game library</h2>` +
            `<p>Create collections for genres, multiplayer nights, backlog, favorites, or anything you play often.</p>` +
            `<div class="collections-empty-actions">` +
              `<button class="collections-primary-btn" onclick="openCollectionModal()">Create Collection</button>` +
              `<button class="collections-secondary-btn" onclick="navigateToInstalled()">Browse Games</button>` +
            `</div>` +
            `<div class="collections-suggestions">` +
              `<span>Multiplayer</span>` +
              `<span>Story Games</span>` +
              `<span>Backlog</span>` +
              `<span>Competitive</span>` +
              `<span>Cozy Games</span>` +
            `</div>` +
          `</div>` +
        `</div>`
    );
}

// ── Collection card helpers ────────────────────────────────────────────────────
function _getGameByCollectionGameId(gameId) {
    const pools = [window._allGamesCache, window._allGamesRawCache, allGamesData, window._suggAllGames];
    for (const pool of pools) {
        if (!Array.isArray(pool)) continue;
        const found = pool.find(g =>
            String(g.id) === String(gameId) ||
            String(g.gameId) === String(gameId) ||
            String(g.appid) === String(gameId) ||
            String(g.path) === String(gameId)
        );
        if (found) return found;
    }
    return null;
}

function _getGameCoverUrl(game) {
    if (!game) return '';
    return game.cover || game.coverUrl || game.image || game.hero || game.poster || game.icon || '';
}

function _renderCollectionCard(c) {
    const count = Array.isArray(c.gameIds) ? c.gameIds.length : 0;
    const safeId = escapeHtml(String(c.id));
    const safeName = escapeHtml(c.name || 'Unnamed');
    const gameLabel = count === 1 ? '1 game' : `${count} games`;

    let coverHTML;
    if (c.image) {
        // Custom collection background takes priority over game collage
        coverHTML =
            `<div class="collection-card-cover collection-card-cover--single">` +
              `<img src="${escapeHtml(c.image.replace(/\\/g, '/'))}" alt="" loading="lazy" onerror="this.parentElement.className='collection-cover-placeholder'">` +
            `</div>`;
    } else {
        const covers = (Array.isArray(c.gameIds) ? c.gameIds.slice(0, 4) : [])
            .map(id => _getGameCoverUrl(_getGameByCollectionGameId(id)))
            .filter(Boolean);

        if (covers.length > 0) {
            const imgs = covers.map(url =>
                `<img src="${escapeHtml(url)}" alt="" loading="lazy" onerror="this.style.display='none'">`
            ).join('');
            coverHTML = `<div class="collection-card-cover">${imgs}</div>`;
        } else {
            coverHTML =
                `<div class="collection-cover-placeholder">` +
                  `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">` +
                    `<path d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/>` +
                  `</svg>` +
                `</div>`;
        }
    }

    return (
        `<article class="collection-card" onclick="filterByCollection('${safeId}')">` +
          coverHTML +
          `<div class="collection-card-body">` +
            `<div class="collection-card-title-row">` +
              `<div>` +
                `<h3>${safeName}</h3>` +
                `<p>${gameLabel}</p>` +
              `</div>` +
            `</div>` +
            `<div class="collection-card-actions">` +
              `<button onclick="event.stopPropagation();filterByCollection('${safeId}')">Open</button>` +
              `<button onclick="event.stopPropagation();openAddGamesToCollection('${safeId}')">Add Games</button>` +
              `<div class="collection-more-wrap" onclick="event.stopPropagation()">` +
                `<button class="collection-more-btn" onclick="toggleCollectionCardMenu(event,'${safeId}')" title="More options">···</button>` +
                `<div class="collection-card-menu" id="collection-menu-${safeId}" hidden>` +
                  `<button type="button" onclick="event.stopPropagation();openRenameCollectionModal('${safeId}')">Rename</button>` +
                  `<button class="danger" onclick="event.stopPropagation();deleteColl(event,'${safeId}')">Delete</button>` +
                `</div>` +
              `</div>` +
            `</div>` +
          `</div>` +
        `</article>`
    );
}

// ── Collection card menu ───────────────────────────────────────────────────────
function openAddGamesToCollection(collectionId) {
    window.activeAddToCollectionId = collectionId;
    navigateToInstalled();
}

function toggleCollectionCardMenu(event, collectionId) {
    event.stopPropagation();
    document.querySelectorAll('.collection-card-menu').forEach(m => {
        if (m.id !== `collection-menu-${collectionId}`) m.hidden = true;
    });
    const menu = document.getElementById(`collection-menu-${collectionId}`);
    if (menu) menu.hidden = !menu.hidden;
}

if (!window._collMenuDismissRegistered) {
    window._collMenuDismissRegistered = true;
    document.addEventListener('click', () => {
        document.querySelectorAll('.collection-card-menu').forEach(m => { m.hidden = true; });
    });
}

async function renameCollection(collectionId) {
    const coll = (allCollections || []).find(c => String(c.id) === String(collectionId));
    if (!coll) return;
    // Close menu before prompting so the dismiss listener doesn't interfere
    document.querySelectorAll('.collection-card-menu').forEach(m => { m.hidden = true; });
    const newName = prompt('Rename collection', coll.name || '');
    if (newName === null) return;                          // user cancelled
    const cleanName = newName.trim();
    if (!cleanName) { showToast('Name cannot be empty.', 'warning'); return; }
    if (cleanName === (coll.name || '').trim()) return;    // no change
    try {
        await window.electronAPI.updateCollection(collectionId, cleanName, undefined);
        allCollections = await window.electronAPI.getCollections();
        renderCollectionsView();
        if (typeof renderSidebarCollectionsList === 'function') renderSidebarCollectionsList();
        if (typeof updateSidebarActiveState === 'function') updateSidebarActiveState();
        showToast('Collection renamed.', 'success');
    } catch (e) {
        showToast('Could not rename collection.', 'error');
    }
}

// ── Create / delete collection modal ─────────────────────────────────────────
function openCollectionModal() { document.getElementById('collName').value = ''; document.getElementById('collectionModal').classList.add('active'); }
function closeCollectionModal() { document.getElementById('collectionModal').classList.remove('active'); }

async function saveCollection() {
    const name = document.getElementById('collName').value.trim();
    if (!name) return showToast('Please enter a name', 'error');
    try {
        await window.electronAPI.createCollection(name, null);
        allCollections = await window.electronAPI.getCollections();
        renderSidebar();
        closeCollectionModal();
        showToast('Collection Created!', 'success');
        // If the user is on the Collections page, update it immediately
        if (currentView === 'collections') renderCollectionsView();
    } catch (e) { showToast('Error', 'error'); }
}

function deleteColl(e, id) {
    e.stopPropagation();
    openConfirmModal(
        'Delete Collection?',
        'Delete this collection from your sidebar? Games will stay in your library.',
        'Delete',
        async () => {
            await window.electronAPI.deleteCollection(id);
            allCollections = await window.electronAPI.getCollections();
            if (currentFilters.collectionId === id) currentFilters.collectionId = null;
            renderSidebar();
            if (currentView === 'collections') renderCollectionsView();
            if (currentView === 'collection') navigateToInstalled();
        }
    );
}

// ── Add / remove game from collection (context menu actions) ──────────────────
async function addToCollection(collId) {
    hideContextMenu();
    await window.electronAPI.addGameToCollection(collId, selectedGameId);
    allCollections = await window.electronAPI.getCollections();
    renderSidebar();
    showToast('Added to collection', 'success');
}

async function removeFromCurrentCollection(gameId) {
    hideContextMenu();
    if (!currentFilters.collectionId) return;
    try {
        const res = await window.electronAPI.removeGameFromCollection(currentFilters.collectionId, gameId);
        if (res.status === 'success') {
            allCollections = await window.electronAPI.getCollections();
            applyFilters();
            showToast('Removed from collection', 'success');
        } else {
            showToast('Failed to remove from collection', 'error');
        }
    } catch (e) {
        console.error(e);
        showToast('Error removing from collection', 'error');
    }
}

// ── Collection settings modal ─────────────────────────────────────────────────
function openCollectionSettings(id) {
    currentEditingCollectionId = id;
    const coll = allCollections.find(c => String(c.id) === String(id));
    if (!coll) return;

    const nameInput = document.getElementById('editCollNameInput');
    const deleteBtn = document.querySelector('#collectionSettingsModal .btn-danger');

    nameInput.value = coll.name || 'Favorites';
    document.getElementById('previewCollImage').src = coll.image || '../assets/app_icon.png';

    if (id === 'fav_system_default') {
        nameInput.disabled = true;
        nameInput.style.opacity = '0.5';
        if (deleteBtn) deleteBtn.style.display = 'none';
    } else {
        nameInput.disabled = false;
        nameInput.style.opacity = '1';
        if (deleteBtn) deleteBtn.style.display = 'block';
    }

    document.getElementById('collectionSettingsModal').classList.add('active');
}

function closeCollectionSettings() {
    document.getElementById('collectionSettingsModal').classList.remove('active');
    currentEditingCollectionId = null;
}

function triggerDeleteCollection() {
    if (!currentEditingCollectionId) return;
    openConfirmModal(
        'Delete Collection?',
        'Are you sure you want to delete this collection? Games inside will NOT be deleted from your library.',
        'Delete Collection',
        async () => {
            await window.electronAPI.deleteCollection(currentEditingCollectionId);
            allCollections = await window.electronAPI.getCollections();
            if (String(currentFilters.collectionId) === String(currentEditingCollectionId)) {
                currentFilters.collectionId = null;
            }
            renderSidebar();
            if (currentView === 'collection') navigateToInstalled();
            closeCollectionSettings();
            showToast('Collection deleted', 'success');
        }
    );
}

async function saveCollectionSettings() {
    if (!currentEditingCollectionId) return;
    const newName = document.getElementById('editCollNameInput').value.trim();
    if (!newName) return showToast('Name cannot be empty', 'error');
    try {
        await window.electronAPI.updateCollection(currentEditingCollectionId, newName, undefined);
        const coll = allCollections.find(c => String(c.id) === String(currentEditingCollectionId));
        if (coll) coll.name = newName;
        showToast('Settings saved!', 'success');
        renderSidebar();
        if (currentView === 'collections') renderCollectionsView();
        applyFilters();
        closeCollectionSettings();
    } catch (e) {
        console.error(e);
        showToast('Error saving collection', 'error');
    }
}

async function changeCollectionImage() {
    if (!currentEditingCollectionId) return;
    try {
        const newPath = await window.electronAPI.selectImage();
        if (newPath) {
            const safePath = `file://${newPath.replace(/\\/g, '/')}`;
            await window.electronAPI.updateCollection(currentEditingCollectionId, undefined, safePath);
            document.getElementById('previewCollImage').src = safePath;
            document.getElementById('previewCollImage').style.display = 'block';
            const txt = document.getElementById('previewCollText');
            if (txt) txt.style.display = 'none';
            const coll = allCollections.find(c => String(c.id) === String(currentEditingCollectionId));
            if (coll) coll.image = safePath;
            showToast('Custom image applied!', 'success');
            if (currentView === 'collections') renderCollectionsView();
            applyFilters();
        }
    } catch (e) { console.error(e); }
}

async function resetCollectionImage() {
    if (!currentEditingCollectionId) return;
    try {
        await window.electronAPI.updateCollection(currentEditingCollectionId, undefined, null);
        const coll = allCollections.find(c => String(c.id) === String(currentEditingCollectionId));
        if (coll) coll.image = null;
        document.getElementById('previewCollImage').src = '';
        document.getElementById('previewCollImage').style.display = 'none';
        const txt = document.getElementById('previewCollText');
        if (txt) txt.style.display = 'flex';
        showToast('Slideshow restored!', 'success');
        if (currentView === 'collections') renderCollectionsView();
        applyFilters();
    } catch (e) { console.error(e); }
}

// ── Window exports ────────────────────────────────────────────────────────────
window.navigateToCollections        = navigateToCollections;
window.renderCollectionsView        = renderCollectionsView;
window._renderCollectionsHeader     = _renderCollectionsHeader;
window._renderCollectionsStats      = _renderCollectionsStats;
window._collectionsEmptyStateHTML   = _collectionsEmptyStateHTML;
window._getGameByCollectionGameId   = _getGameByCollectionGameId;
window._getGameCoverUrl             = _getGameCoverUrl;
window._renderCollectionCard        = _renderCollectionCard;
window.openAddGamesToCollection     = openAddGamesToCollection;
window.toggleCollectionCardMenu     = toggleCollectionCardMenu;
window.renameCollection             = renameCollection;
window.openRenameCollectionModal    = openCollectionSettings;
window.openCollectionModal          = openCollectionModal;
window.closeCollectionModal         = closeCollectionModal;
window.saveCollection               = saveCollection;
window.deleteColl                   = deleteColl;
window.filterByCollection           = filterByCollection;
window.addToCollection              = addToCollection;
window.removeFromCurrentCollection  = removeFromCurrentCollection;
window.openCollectionSettings       = openCollectionSettings;
window.closeCollectionSettings      = closeCollectionSettings;
window.saveCollectionSettings       = saveCollectionSettings;
window.triggerDeleteCollection      = triggerDeleteCollection;
window.changeCollectionImage        = changeCollectionImage;
window.resetCollectionImage         = resetCollectionImage;
