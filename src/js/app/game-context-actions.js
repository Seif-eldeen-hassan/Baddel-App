// ── Game Context Menu & Context Actions ──────────────────────────────────────
// Context menu open/close, submenu positioning, game remove/delete flows,
// favorites toggling, time-tracking toggle, and recycle-bin management.
//
// Loads before app.js. All references to app.js globals (allGamesData,
// allCollections, currentFilters, currentHeroGameId, playtimeData,
// applyFilters, renderRecentlyPlayed, renderExploreCarousel, renderSidebar,
// reloadLibrary, openConfirmModal, showToast, addToCollection,
// removeFromCurrentCollection, triggerPlay, openGameSettings)
// resolve at call time through the classic-script Global Declarative Environment.

let selectedGameId = null;

// ── Context menu open/close ───────────────────────────────────────────────────

function showContextMenu(x, y, id, name) {
    const m = document.getElementById('contextMenu');
    selectedGameId = id;
    m.setAttribute('data-current-name', name);

    const favColl = allCollections.find(c => c.id === 'fav_system_default');
    const isLiked = favColl && favColl.gameIds.includes(String(id));

    const favAction = isLiked
    ? `<div class="menu-item" onclick="hideContextMenu(); _toggleCardFavorite('${id}')"> Remove from Favorites</div>`
    : `<div class="menu-item" onclick="hideContextMenu(); _toggleCardFavorite('${id}')"> Add to Favorites</div>`;
   
    let o = '';
    allCollections.forEach(c => {
        if (c.id !== currentFilters.collectionId && c.id !== 'fav_system_default') {
            o += `<div class="dropdown-item" onclick="addToCollection('${c.id}')">${c.name}</div>`;
        }
    });
    if (o === '') o = `<div class="dropdown-item" style="color:#555;font-size:0.75rem;padding:8px 15px;">No other collections</div>`;

    let removeFromCollAction = '';
    if (currentFilters.collectionId !== null && currentFilters.collectionId !== 'fav_system_default') {
        removeFromCollAction = `<div class="menu-item delete" onclick="removeFromCurrentCollection('${id}')">Remove from Collection</div>`;
    }

    const _ctxGame = allGamesData.find(g => String(g.id) === String(id));
    const trackingEnabled = _ctxGame ? _ctxGame.timeTrackingEnabled !== false : true;
    const trackingItem = trackingEnabled
        ? `<div class="menu-item" onclick="toggleTimeTracking('${id}', false)">Disable Time Tracking</div>`
        : `<div class="menu-item" onclick="toggleTimeTracking('${id}', true)">Enable Time Tracking</div>`;

    m.innerHTML = `
        <div class="menu-item" onclick="triggerPlay()">Play</div>
        ${favAction} <hr>
        <div class="menu-item" style="position:relative" onmouseenter="fixSubmenuPosition(this)">
            <span>Add to Collection <span class="submenu-icon">&#9654;</span></span>
            <div class="submenu">${o}</div>
        </div>
        ${removeFromCollAction}
        ${trackingItem}
        <div class="menu-item" onclick="hideContextMenu(); openGameSettings('${id}')">Game Settings</div>
        <div class="menu-item delete" onclick="triggerRemove('${id}')">Remove from Library</div>
    `;

    m.style.display = 'block';
    const fx = x + 200 > window.innerWidth ? x - 200 : x;
    const fy = y + m.offsetHeight > window.innerHeight ? y - m.offsetHeight : y;
    m.style.left = `${fx}px`; m.style.top = `${fy}px`;
}

function hideContextMenu() { document.getElementById('contextMenu').style.display = 'none'; fixSubmenuPosition.reset(); }

// ── Submenu positioning ───────────────────────────────────────────────────────

function fixSubmenuPosition(i) {
    const s = i.querySelector('.submenu');
    if (s) {
        const r = i.getBoundingClientRect();
        if (window.innerWidth - r.right < 200) { s.style.left = 'auto'; s.style.right = '100%'; s.style.borderRadius = '8px 0 8px 8px'; }
        else { s.style.left = '100%'; s.style.right = 'auto'; s.style.borderRadius = '0 8px 8px 8px'; }
    }
}

fixSubmenuPosition.reset = () => {
    document.querySelectorAll('.submenu').forEach(s => { s.style.left = '100%'; s.style.right = 'auto'; });
};

// ── Time tracking toggle ──────────────────────────────────────────────────────

async function toggleTimeTracking(gameId, enable) {
    hideContextMenu();
    const game = allGamesData.find(g => String(g.id) === String(gameId));
    if (!game) return;
    try {
        const res = await window.electronAPI.setTimeTrackingEnabled(gameId, enable);
        if (res && res.status === 'success') {
            game.timeTrackingEnabled = enable;
            if (!playtimeData[gameId]) playtimeData[gameId] = { totalMinutes: 0, lastPlayed: null };
            playtimeData[gameId].timeTrackingEnabled = enable;
            if (typeof showToast === 'function')
                showToast(enable ? 'Time tracking enabled for this game' : 'Time tracking disabled for this game', 'info');
        } else {
            const errMsg = (res && res.error) ? res.error : 'Unknown error';
            console.error('[TimeTracking] toggle failed:', errMsg);
            if (typeof showToast === 'function')
                showToast('Could not update time tracking setting', 'error');
        }
    } catch (e) {
        console.error('[TimeTracking] toggle error:', e);
        if (typeof showToast === 'function')
            showToast('Could not update time tracking setting', 'error');
    }
}

// ── Remove / delete flows ─────────────────────────────────────────────────────

function triggerRemove(gameId = selectedGameId) {
    selectedGameId = gameId;
    hideContextMenu();

    openConfirmModal(
        'Move to Recycle Bin?',
        'Are you sure you want to remove this game from your library? It will be moved to the Recycle Bin.',
        'Move to Bin',
        async () => { await confirmDeleteAction(gameId); }
    );
}

async function confirmDeleteAction(gameId = selectedGameId) {
    const id = String(gameId || '').trim();

    if (!id) {
        console.error('[GameContext] remove failed: missing selected game id');
        showToast('Could not identify the selected game', 'error');
        return;
    }

    try {
        const res = await window.electronAPI.removeGame(id);

        if (!res || res.status !== 'success') {
            console.error('[GameContext] removeGame failed:', { id, res });
            showToast(res?.message || res?.error || 'Could not move game to recycle bin', 'error');
            return;
        }

        showToast('Game moved to bin!', 'success');

        allGamesData = allGamesData.filter(g => String(g.id) !== id);
        window.allGamesData = allGamesData;

        applyFilters();
        renderRecentlyPlayed();
        renderExploreCarousel();

        if (currentHeroGameId === id) {
            currentHeroGameId = null;
            updateHeroSection?.(null);
        }

        allCollections = await window.electronAPI.getCollections();
    } catch (err) {
        console.error('[GameContext] confirmDeleteAction error:', err);
        showToast('Could not move game to recycle bin', 'error');
    }
}

function hardDeleteGame(id) {
    openConfirmModal(
        'Delete Forever?',
        'Permanently delete this game? Data and cached images cannot be recovered.',
        'Delete Forever',
        async () => {
            await window.electronAPI.deleteGamePermanently(id);
            _clearArtworkLocalState(id);
            openRecycleBin();
            reloadLibrary?.();
        }
    );
}

// ── Favorites toggling ────────────────────────────────────────────────────────

async function toggleFavorite(gameId, shouldAdd) {
    hideContextMenu();
    if (shouldAdd) await window.electronAPI.addGameToCollection('fav_system_default', gameId);
    else await window.electronAPI.removeGameFromCollection('fav_system_default', gameId);
    allCollections = await window.electronAPI.getCollections();
    renderSidebar();
    if (currentFilters.collectionId === 'fav_system_default') applyFilters();
}

// Toggles favorite state and updates all visible heart buttons for this game.
async function _toggleCardFavorite(gameId) {
    const favColl = allCollections.find(c => c.id === 'fav_system_default');
    const wasFav  = favColl?.gameIds?.includes(String(gameId)) || false;
    const nowFav  = !wasFav;

    if (nowFav) await window.electronAPI.addGameToCollection('fav_system_default', gameId);
    else        await window.electronAPI.removeGameFromCollection('fav_system_default', gameId);

    // Apply visual feedback immediately after the API call, before the async
    // allCollections refresh, so the heart state is never blocked by IPC timing.
    document.querySelectorAll(`.gc-fav-btn[data-id="${gameId}"]`).forEach(btn => {
        btn.classList.toggle('gc-fav-active', nowFav);
        btn.setAttribute('aria-label', nowFav ? 'Remove from Favorites' : 'Add to Favorites');
        btn.setAttribute('title',      nowFav ? 'Remove from Favorites' : 'Add to Favorites');
        const svg = btn.querySelector('svg');
        if (svg) svg.setAttribute('fill', nowFav ? 'currentColor' : 'none');
    });

    // If currently in Favorites view, remove the card smoothly after un-favoriting
    if (!nowFav && currentFilters.collectionId === 'fav_system_default') {
        const card = document.querySelector(`.game-card[data-id="${gameId}"]`);
        if (card) {
            card.style.transition = 'opacity 0.25s, transform 0.25s';
            card.style.opacity = '0';
            card.style.transform = 'scale(0.93)';
            setTimeout(() => card.remove(), 260);
        }
    }

    allCollections = await window.electronAPI.getCollections();
    renderSidebar();
}

// ── Recycle bin ───────────────────────────────────────────────────────────────

async function openRecycleBin() {
    document.getElementById('recycleModal').classList.add('active');
    const list = document.getElementById('recycleList');
    list.innerHTML = "<div style='padding:20px; color:#555; text-align:center;'>Loading...</div>";
    try {
        const hidden = await window.electronAPI.getHiddenGames();
        list.innerHTML = '';
        if (hidden.length === 0) {
            list.innerHTML = "<div style='padding:30px; color:#444; text-align:center;font-size:0.9rem;'>Recycle bin is empty.</div>";
            return;
        }
        hidden.forEach(g => {
            const div = document.createElement('div');
            div.className = 'bin-item';
            div.innerHTML = `
                <label class="custom-checkbox">
                    <input type="checkbox" value="${g.id}">
                    <span class="checkmark"></span>
                </label>
                <img src="${g.image || 'assets/logo.png'}" style="width:32px;height:32px;border-radius:6px;margin-right:12px;object-fit:cover; border: 1px solid #333;">
                <span style="flex-grow:1; color:#ddd; font-weight:500; font-size:0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-right: 15px;">${g.name}</span>
                <button class="btn-danger" style="padding:6px 12px; font-size:0.75rem; flex-shrink:0;" onclick="hardDeleteGame('${g.id}')">Delete Forever</button>
            `;
            list.appendChild(div);
        });
    } catch (e) { console.error(e); }
}

function closeRecycleBin() { document.getElementById('recycleModal').classList.remove('active'); }

async function restoreSelectedGames() {
    const checks = document.querySelectorAll('#recycleList input[type="checkbox"]:checked');
    const ids = Array.from(checks).map(c => c.value);
    if (ids.length === 0) return;
    await window.electronAPI.restoreSpecificGames(ids);
    closeRecycleBin();
    reloadLibrary();
}

// ── Window exports ────────────────────────────────────────────────────────────

window.showContextMenu     = showContextMenu;
window.hideContextMenu     = hideContextMenu;
window.fixSubmenuPosition  = fixSubmenuPosition;
window.triggerRemove       = triggerRemove;
window.confirmDeleteAction = confirmDeleteAction;
window.hardDeleteGame      = hardDeleteGame;
window.toggleTimeTracking  = toggleTimeTracking;
window.toggleFavorite      = toggleFavorite;
window._toggleCardFavorite = _toggleCardFavorite;
window.openRecycleBin      = openRecycleBin;
window.closeRecycleBin     = closeRecycleBin;
window.restoreSelectedGames = restoreSelectedGames;
