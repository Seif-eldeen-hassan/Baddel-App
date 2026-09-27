'use strict';
// ============================================================
// BADDEL LAUNCHER — DISPLAY PREFERENCES (display-prefs.js)
// Extracted from accounts.js.
// Owns All Games and Installed Games display preference state,
// persistence, and DOM application.
// Loads before accounts.js in dashboard.html.
// ============================================================

// ══════════════════════════════════════════════════════════════
// ALL GAMES — DISPLAY PREFERENCES
// ══════════════════════════════════════════════════════════════

const AG_DISPLAY_DEFAULTS = {
    viewMode: 'grid',
    gridDensity: 'normal',
    listDensity: 'normal',
    visibleFields: {
        title: true,
        platforms: true,
        lastPlayed: false,
        playtime: false,
        installed: false,
        rating: false,
    }
};

function _agLoadDisplayPrefs() {
    try {
        const raw = localStorage.getItem('baddelDisplayPrefs');
        if (!raw) return Object.assign({}, AG_DISPLAY_DEFAULTS, { visibleFields: Object.assign({}, AG_DISPLAY_DEFAULTS.visibleFields) });
        const p = JSON.parse(raw);
        // Deep merge to handle new fields added later
        p.visibleFields = Object.assign({}, AG_DISPLAY_DEFAULTS.visibleFields, p.visibleFields || {});
        return Object.assign({}, AG_DISPLAY_DEFAULTS, p);
    } catch(e) { return Object.assign({}, AG_DISPLAY_DEFAULTS, { visibleFields: Object.assign({}, AG_DISPLAY_DEFAULTS.visibleFields) }); }
}

function _agSaveDisplayPrefs() {
    try { localStorage.setItem('baddelDisplayPrefs', JSON.stringify(window._agDisplayPrefs)); } catch(e) {}
}

window._agDisplayPrefs = _agLoadDisplayPrefs();

// ── Apply prefs to DOM ────────────────────────────────────────
function _agApplyDisplayPrefs(options = {}) {
    const prefs = window._agDisplayPrefs;
    const grid  = document.getElementById('allGamesGrid');
    const list  = document.getElementById('allGamesList');
    const view  = document.getElementById('allGamesView');
    if (!grid || !list) return;

    const routeActive = options.routeActive ?? (
        typeof currentView !== 'undefined'
        && currentView === 'all-games'
        && view?.style.display !== 'none'
    );
    if (!routeActive) {
        grid.style.display = 'none';
        list.style.display = 'none';
        return;
    }

    // Empty-state layout remains owned by the empty-state renderer, but it may
    // never make the list presentation visible at the same time.
    if (grid.classList.contains('ag-empty-mode')) {
        list.style.display = 'none';
        return;
    }

    // This is the sole owner of normal Grid/List presentation visibility.
    const isGrid = prefs.viewMode === 'grid';
    grid.style.display = isGrid ? 'block' : 'none';
    list.style.display = isGrid ? 'none' : 'block';

    document.getElementById('agViewGrid')?.classList.toggle('active', isGrid);
    document.getElementById('agViewList')?.classList.toggle('active', !isGrid);

    // --- Density label ---
    const densityLabel = document.getElementById('adpDensityLabel');
    if (densityLabel) densityLabel.textContent = isGrid ? 'Card Size' : 'Row Height';
    const currentDensity = isGrid ? prefs.gridDensity : prefs.listDensity;
    const densityLabels = { compact: 'Compact', normal: 'Normal', large: isGrid ? 'Large' : 'Comfortable' };
    // FIX: scope to agDisplayPanel only — without this, the selector also matches
    // Installed Games density buttons (they share the .adp-seg-btn class), which
    // incorrectly toggles IG active state based on All Games preferences.
    document.querySelectorAll('#agDisplayPanel .adp-seg-btn').forEach(btn => {
        const d = btn.dataset.density;
        btn.classList.toggle('active', d === currentDensity);
    });
    // Remap "large" density btn text for list mode
    const largeDensityBtn = document.querySelector('#agDisplayPanel .adp-seg-btn[data-density="large"]');
    if (largeDensityBtn) largeDensityBtn.textContent = isGrid ? 'Large' : 'Comfortable';

    // --- Grid density class ---
    grid.classList.remove('density-compact','density-normal','density-large');
    grid.classList.add('density-' + prefs.gridDensity);

    // --- List density class ---
    list.classList.remove('density-compact','density-normal','density-comfortable');
    const listDensityClass = prefs.listDensity === 'large' ? 'density-comfortable' : ('density-' + prefs.listDensity);
    list.classList.add(listDensityClass);

    // --- Field visibility: grid ---
    const fields = prefs.visibleFields;
    grid.classList.toggle('hide-title',    !fields.title);
    grid.classList.toggle('hide-platforms',!fields.platforms);
    grid.classList.toggle('show-playtime',  fields.playtime);
    grid.classList.toggle('show-lastPlayed',fields.lastPlayed);
    grid.classList.toggle('show-installed', fields.installed);
    grid.classList.toggle('show-rating',    fields.rating);

    // --- Field visibility: list ---
    list.classList.toggle('hide-platforms', !fields.platforms);
    list.classList.toggle('hide-playtime',  !fields.playtime);
    list.classList.toggle('hide-lastPlayed',!fields.lastPlayed);
    list.classList.toggle('hide-installed', !fields.installed);
    list.classList.toggle('hide-title',     !fields.title);

    // --- Sync checkboxes ---
    const cb = (id, val) => { const el = document.getElementById(id); if (el) el.checked = val; };
    cb('adpFieldTitle',      fields.title);
    cb('adpFieldPlatforms',  fields.platforms);
    cb('adpFieldLastPlayed', fields.lastPlayed);
    cb('adpFieldPlaytime',   fields.playtime);
    cb('adpFieldInstalled',  fields.installed);
    cb('adpFieldRating',     fields.rating);
}

// ── View Mode ─────────────────────────────────────────────────
window.setAgViewMode = function(mode) {
    window._agDisplayPrefs.viewMode = mode;
    _agSaveDisplayPrefs();
    _agApplyDisplayPrefs();
    // Re-render in new mode with existing filtered data
    const vs = window._vs;
    if (vs && vs.items && vs.items.length > 0) {
        if (mode === 'list') {
            _renderAllGamesList(vs.items);
        } else {
            // Grid mode: measure only after the newly-visible surface has layout.
            vs.cols = 0;
            vs.rowH = 0;
            vs._gridTopDirty = true;
            requestAnimationFrame(() => requestAnimationFrame(() => _vsRender(true, 'view-mode-grid')));
        }
    }
};

// ── Density ───────────────────────────────────────────────────
window.setAgDensity = function(density, btn) {
    console.log('[setAgDensity] called with', density, 'btn=', btn, 'current prefs=', JSON.stringify(window._agDisplayPrefs));
    const isGrid = window._agDisplayPrefs.viewMode === 'grid';
    if (isGrid) {
        window._agDisplayPrefs.gridDensity = density;
    } else {
        // For list, "large" = comfortable
        window._agDisplayPrefs.listDensity = density;
    }
    _agSaveDisplayPrefs();
    _agApplyDisplayPrefs();

    // Force grid remeasure with new card width
    const vs = window._vs;
    if (isGrid && vs && vs.items.length > 0) {
        // Invalidate column count so _vsMeasure runs again with new density
        vs.cols = 0;
        vs._gridTopDirty = true;
        _vsRender(true);
    }

    // FIX: scope to All Games panel only — '.adp-seg-btn' alone also matches
    // Installed Games buttons (they share the class), which would toggle their
    // active state incorrectly.
    document.querySelectorAll('#agDisplayPanel .adp-seg-btn').forEach(b => b.classList.toggle('active', b.dataset.density === density));
};

// ── Field visibility ──────────────────────────────────────────
window.setAgField = function(field, visible) {
    window._agDisplayPrefs.visibleFields[field] = visible;
    _agSaveDisplayPrefs();
    _agApplyDisplayPrefs();
    // Rebuild list rows if in list mode (fields affect column rendering)
    const vs = window._vs;
    if (window._agDisplayPrefs.viewMode === 'list' && vs && vs.items.length > 0) {
        _renderAllGamesList(vs.items);
    }
};

// ── Display panel toggle ──────────────────────────────────────
window.toggleAgDisplayPanel = function(e) {
    if (e) e.stopPropagation();
    const panel = document.getElementById('agDisplayPanel');
    const trigger = document.getElementById('agDisplayTrigger') || e?.currentTarget;
    if (!panel) return;
    document.getElementById('agSortMenu')?.classList.remove('active');
    document.getElementById('agAccountMenu')?.classList.remove('active');
    panel.classList.toggle('active');
    if (trigger) trigger.classList.toggle('active', panel.classList.contains('active'));
};

// ══════════════════════════════════════════════════════════════
// INSTALLED GAMES — DISPLAY PREFERENCES
// ══════════════════════════════════════════════════════════════

const IG_DISPLAY_DEFAULTS = {
    viewMode:     'grid',   // 'grid' | 'list'
    gridDensity:  'normal', // 'compact' | 'normal' | 'large'
    listDensity:  'normal', // 'compact' | 'normal' | 'comfortable'
    visibleFields: {
        title:      true,
        platform:   true,
        playtime:   true,
        lastPlayed: false,
    },
};

// ── Persistence ───────────────────────────────────────────────
function _igLoadDisplayPrefs() {
    try {
        const raw = localStorage.getItem('baddelInstalledDisplayPrefs');
        if (!raw) return Object.assign({}, IG_DISPLAY_DEFAULTS, { visibleFields: Object.assign({}, IG_DISPLAY_DEFAULTS.visibleFields) });
        const p = JSON.parse(raw);
        p.visibleFields = Object.assign({}, IG_DISPLAY_DEFAULTS.visibleFields, p.visibleFields || {});
        return Object.assign({}, IG_DISPLAY_DEFAULTS, p);
    } catch(e) {
        return Object.assign({}, IG_DISPLAY_DEFAULTS, { visibleFields: Object.assign({}, IG_DISPLAY_DEFAULTS.visibleFields) });
    }
}

function _igSaveDisplayPrefs() {
    try { localStorage.setItem('baddelInstalledDisplayPrefs', JSON.stringify(window._igDisplayPrefs)); } catch(e) {}
}

window._igDisplayPrefs = _igLoadDisplayPrefs();

// ── Apply prefs → DOM ─────────────────────────────────────────
function _igApplyDisplayPrefs() {
    const prefs   = window._igDisplayPrefs;
    console.log('[_igApplyDisplayPrefs] viewMode=', prefs.viewMode, 'gridDensity=', prefs.gridDensity, 'listDensity=', prefs.listDensity);
    const grid    = document.getElementById('gamesGrid');
    const listView = document.getElementById('igListView');
    if (!grid || !listView) return;

    // --- View mode visibility ---
    const isGrid = prefs.viewMode === 'grid';
    grid.style.display     = isGrid ? '' : 'none';
    listView.style.display = isGrid ? 'none' : '';

    document.getElementById('igViewGrid')?.classList.toggle('active',  isGrid);
    document.getElementById('igViewList')?.classList.toggle('active', !isGrid);

    // --- Density label ---
    const densityLabel = document.getElementById('igDensityLabel');
    if (densityLabel) densityLabel.textContent = isGrid ? 'Card Size' : 'Row Height';

    const currentDensity = isGrid ? prefs.gridDensity : prefs.listDensity;
    const densityMap = { compact: 'Compact', normal: 'Normal', large: isGrid ? 'Large' : 'Comfortable' };

    document.querySelectorAll('.ig-density-btn').forEach(btn => {
        const d = btn.dataset.density;
        btn.classList.toggle('active', d === currentDensity);
        if (d === 'large') btn.textContent = isGrid ? 'Large' : 'Comfortable';
    });

    // --- Grid density class ---
    grid.classList.remove('density-compact', 'density-normal', 'density-large');
    grid.classList.add('density-' + prefs.gridDensity);

    // --- List density class ---
    listView.classList.remove('density-compact', 'density-normal', 'density-comfortable');
    const listDensityClass = prefs.listDensity === 'large' ? 'density-comfortable' : ('density-' + prefs.listDensity);
    listView.classList.add(listDensityClass);

    // --- Field visibility ---
    const fields = prefs.visibleFields || {};
    grid.classList.toggle('ig-hide-title',      !fields.title);
    grid.classList.toggle('ig-hide-platform',   !fields.platform);
    grid.classList.toggle('ig-hide-playtime',   !fields.playtime);
    grid.classList.toggle('ig-show-lastplayed', !!fields.lastPlayed);

    // Sync checkboxes
    const _cb = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };
    _cb('igAdpFieldTitle',     fields.title);
    _cb('igAdpFieldPlatform',  fields.platform);
    _cb('igAdpFieldPlaytime',  fields.playtime);
    _cb('igAdpFieldLastPlayed',fields.lastPlayed);
}

// ── View mode toggle ──────────────────────────────────────────
window.setIgViewMode = function(mode) {
    window._igDisplayPrefs.viewMode = mode;
    _igSaveDisplayPrefs();
    _igApplyDisplayPrefs();

    if (mode === 'list') {
        // Re-render list from current filtered data in the grid
        const currentGames = _igGetCurrentFilteredGames();
        _renderInstalledGamesList(currentGames);
    }
    // Grid re-render is handled by applyFilters() which already populated gamesGrid
};

// ── Density ───────────────────────────────────────────────────
window.setIgDensity = function(density, btn) {
    console.log('[setIgDensity] called with', density, 'btn=', btn, 'current prefs=', JSON.stringify(window._igDisplayPrefs));
    const isGrid = window._igDisplayPrefs.viewMode === 'grid';
    if (isGrid) {
        window._igDisplayPrefs.gridDensity = density;
    } else {
        window._igDisplayPrefs.listDensity = density;
    }
    _igSaveDisplayPrefs();
    _igApplyDisplayPrefs();
    document.querySelectorAll('.ig-density-btn').forEach(b => b.classList.toggle('active', b.dataset.density === density));

    // Force a visible layout update — same pattern as All Games setAgDensity.
    // applyFilters() re-renders the grid cards (grid mode) and triggers the
    // patched wrapper that also rebuilds the list (list mode).
    if (typeof applyFilters === 'function') {
        applyFilters();
    } else if (window._igDisplayPrefs.viewMode === 'list') {
        _renderInstalledGamesList(_igGetCurrentFilteredGames());
    }
};

// ── Field visibility ──────────────────────────────────────────
window.setIgField = function(field, visible) {
    if (!window._igDisplayPrefs.visibleFields) window._igDisplayPrefs.visibleFields = {};
    window._igDisplayPrefs.visibleFields[field] = visible;
    _igSaveDisplayPrefs();
    _igApplyDisplayPrefs();
    if (window._igDisplayPrefs.viewMode === 'list') {
        const games = (typeof _igGetCurrentFilteredGames === 'function') ? _igGetCurrentFilteredGames() : [];
        if (games.length) _renderInstalledGamesList(games);
    }
};

// ── IG Display panel toggle ───────────────────────────────────
window.toggleIgDisplayPanel = function(e) {
    if (e) e.stopPropagation();
    const panel   = document.getElementById('igDisplayPanel');
    const trigger = document.getElementById('igDisplayTrigger');
    if (!panel) return;
    // Close other IG menus first
    document.getElementById('igPlatformMenu')?.classList.remove('active');
    document.getElementById('igSortMenu')?.classList.remove('active');
    panel.classList.toggle('active');
    if (trigger) trigger.classList.toggle('active', panel.classList.contains('active'));
};

// ── Explicit window exports for accounts.js call sites ───────
window._agApplyDisplayPrefs  = _agApplyDisplayPrefs;
window._agSaveDisplayPrefs   = _agSaveDisplayPrefs;
window._igApplyDisplayPrefs  = _igApplyDisplayPrefs;
window._igSaveDisplayPrefs   = _igSaveDisplayPrefs;
