// ── Sidebar helpers ───────────────────────────────────────────────────────────
// Drives the left sidebar: section toggling, nav active state, card rendering,
// platform dots, ready-to-install counts, and the context action button.
//
// Loads before app.js. All references to app.js globals (allGamesData,
// playtimeData, allCollections, currentView, currentFilters,
// currentAccountPlatform) resolve at call time through the classic-script
// Global Declarative Environment — they do not need to exist at parse time.

// ── Sidebar top-level rendering ───────────────────────────────────────────────

function renderSidebar() {
    _sbApplyAllSectionStates();
    _sbApplyStartupAllGamesCount();

    // Populate the COLLECTIONS section (up to SB_COLL_MAX inline, then "View all")
    try { renderSidebarCollectionsList(); } catch (_) {}

    // Legacy compat div stays empty
    const l = document.getElementById('collectionsList');
    if (l) l.innerHTML = '';

    updateSidebarActiveState();
    updateSidebarCards();
}

const SB_SECTION_PREF_KEY = 'baddel.sidebar.sections.v1';
const SB_ALL_GAMES_COUNT_KEY = 'baddel.sidebar.allGamesCount.v1';

function _sbDefaultSectionPreferences() {
    return { library: true, collections: true, accounts: true };
}

function _sbNormalizeSectionPreferences(value) {
    const defaults = _sbDefaultSectionPreferences();
    const out = { ...defaults };
    if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
    for (const key of Object.keys(defaults)) {
        if (typeof value[key] === 'boolean') out[key] = value[key];
    }
    return out;
}

function _sbLoadSectionPreferences() {
    try {
        const raw = localStorage.getItem(SB_SECTION_PREF_KEY);
        if (!raw) return _sbDefaultSectionPreferences();
        return _sbNormalizeSectionPreferences(JSON.parse(raw));
    } catch (_) {
        return _sbDefaultSectionPreferences();
    }
}

function _sbSaveSectionPreferences() {
    try {
        localStorage.setItem(SB_SECTION_PREF_KEY, JSON.stringify(_sbNormalizeSectionPreferences(window._sbSec)));
    } catch (_) {}
}

function _sbApplyAllSectionStates() {
    ['library', 'collections', 'accounts'].forEach(sec => {
        try { _sbApplySectionState(sec); } catch (_) {}
    });
}

function _sbReadPersistedAllGamesCount() {
    try {
        const raw = localStorage.getItem(SB_ALL_GAMES_COUNT_KEY);
        if (raw === null) return null;
        const value = Number(raw);
        return Number.isInteger(value) && value >= 0 ? value : null;
    } catch (_) {
        return null;
    }
}

function setSidebarAllGamesCount(count, options = {}) {
    const ready = options.ready === true;
    const hasCountValue = count !== null && count !== undefined && count !== '';
    const numeric = Number(count);
    const hasNumeric = hasCountValue && Number.isInteger(numeric) && numeric >= 0;
    const el = document.getElementById('allGamesCount');

    if (el) {
        if (hasNumeric) {
            el.textContent = String(numeric);
        } else if (options.loading === true || ready !== true) {
            el.textContent = '...';
        } else {
            el.textContent = '0';
        }
    }

    if (hasNumeric && ready) {
        window.__sidebarAllGamesCountReady = true;
        try { localStorage.setItem(SB_ALL_GAMES_COUNT_KEY, String(numeric)); } catch (_) {}
        try {
            window.dispatchEvent(new CustomEvent('baddel:all-games-count-updated', {
                detail: {
                    count: numeric,
                    source: options.source || 'library-updated',
                    ready: true,
                },
            }));
        } catch (_) {}
    }
}

function _sbApplyStartupAllGamesCount() {
    if (window.__sidebarAllGamesCountReady === true) return;
    const persisted = _sbReadPersistedAllGamesCount();
    if (persisted !== null) {
        setSidebarAllGamesCount(persisted, { source: 'startup-persisted', ready: true });
        return;
    }
    setSidebarAllGamesCount(null, { source: 'startup-loading', ready: false, loading: true });
}

// ── Sidebar card helpers ──────────────────────────────────────────────────────

function renderSidebarJumpBackIn() {
    const card    = document.getElementById('sidebarJumpBack');
    const content = document.getElementById('sidebarJumpBackContent');
    if (!card || !content) return;

    let recent = [];
    try { recent = getRecentGames(); } catch (_) {}

    if (!recent.length) {
        content.innerHTML = '<div class="jb-empty-msg nav-text">No recent sessions</div>';
        return;
    }

    const game  = recent[0];
    const id    = String(game.id || game.gameId || '');
    const title = game.title || game.name || 'Unknown Game';
    const plat  = (game.platform || '').toUpperCase();
    const img   = game.heroImage || game.heroUrl || game.poster || game.artwork || game.image || game.defaultImage || '';

    const pd       = (typeof playtimeData !== 'undefined') ? (playtimeData[id] || null) : null;
    const mins     = pd ? (pd.totalMinutes || 0) : 0;
    const hrs      = Math.floor(mins / 60);
    const minsRem  = mins % 60;
    const timeStr  = mins > 0 ? `${hrs}h ${minsRem}m` : '';

    let lastStr = '';
    const ts = pd ? (pd.lastPlayed || 0) : 0;
    if (ts > 0) {
        const d = Math.floor((Date.now() - ts) / 86400000);
        if      (d === 0) lastStr = 'Today';
        else if (d === 1) lastStr = '1 day ago';
        else if (d < 30)  lastStr = `${d} days ago`;
        else              lastStr = `${Math.floor(d / 30)} months ago`;
    }

    const meta    = [lastStr, timeStr].filter(Boolean).join(' · ');
    const bgStyle = img ? `background-image:url('${escapeHtml(img)}')` : '';
    const safeId  = escapeHtml(id);

    content.innerHTML =
        `<div class="jb-inner" style="${bgStyle}" onclick="if(window.openGameDetails)window.openGameDetails('${safeId}')">` +
          `<div class="jb-overlay">` +
            `<div class="jb-info">` +
              (plat ? `<div class="jb-platform">${escapeHtml(plat)}</div>` : '') +
              `<div class="jb-title">${escapeHtml(title)}</div>` +
              (meta ? `<div class="jb-meta">${escapeHtml(meta)}</div>` : '') +
            `</div>` +
            `<button class="jb-play" title="Play" onclick="event.stopPropagation();if(window.electronAPI?.launchGame)window.electronAPI.launchGame('${safeId}')">&#9654;</button>` +
          `</div>` +
        `</div>`;
}

function renderSidebarAccountSummary() {
    const card    = document.getElementById('sidebarActiveAccounts');
    const content = document.getElementById('sidebarAccountsContent');
    if (!card || !content) return;

    // Read safe count data already in the DOM — populated by accounts.js
    const platforms = [
        { key: 'steam',    countId: 'steamCount',    name: 'Steam',    color: '#66c0f4' },
        { key: 'epic',     countId: 'epicCount',     name: 'Epic',     color: '#e0e0e0' },
        { key: 'riot',     countId: 'riotCount',     name: 'Riot',     color: '#ff4655' },
        { key: 'ea',       countId: 'eaCount',       name: 'EA',       color: '#ff6b35' },
        { key: 'ubisoft',  countId: 'ubisoftCount',  name: 'Ubisoft',  color: '#00a8ff' },
        { key: 'discord',  countId: 'discordCount',  name: 'Discord',  color: '#5865f2' },
        { key: 'rockstar', countId: 'rockstarCount', name: 'Rockstar', color: '#fcaf17' },
    ];

    const active = platforms.filter(p => {
        const el = document.getElementById(p.countId);
        return parseInt(el?.textContent?.trim() || '0') > 0;
    }).map(p => ({
        ...p,
        count: parseInt(document.getElementById(p.countId).textContent.trim()),
    }));

    if (!active.length) {
        card.classList.add('baddel-hidden');   // hide entirely — empty state looks bad
        return;
    }

    card.classList.remove('baddel-hidden');
    content.innerHTML = active.map(p =>
        `<div class="baddel-acc-row" onclick="selectAccountPlatform('${p.key}');switchSidebarSection('accounts');">` +
          `<span class="baddel-acc-dot" style="background:${p.color};"></span>` +
          `<span class="baddel-acc-name">${escapeHtml(p.name)}</span>` +
          `<span class="baddel-acc-count">${p.count}</span>` +
          `<span class="baddel-acc-live"></span>` +
        `</div>`
    ).join('');
}

function renderSidebarLibraryPulse() {
    const totalEl   = document.getElementById('sbTotalGames');
    const instEl    = document.getElementById('sbInstalledGames');
    const readyEl   = document.getElementById('sbReadyGames');
    const syncEl    = document.getElementById('sbNeedSync');

    const games = Array.isArray(allGamesData) ? allGamesData : [];

    // Total games
    if (totalEl) totalEl.textContent = games.length > 0 ? games.length : '—';

    // Installed — use the same predicate as the Installed Games filter (_agIsInstalled from accounts.js)
    if (instEl) {
        if (games.length > 0 && typeof _agIsInstalled === 'function') {
            const installedCount = games.filter(g => {
                try { return _agIsInstalled(g); } catch (_) { return false; }
            }).length;
            instEl.textContent = installedCount;
        } else {
            instEl.textContent = '—';
        }
    }

    // Ready to install — show tile only when _suggAllGames has real data
    const readyArr = Array.isArray(window._suggAllGames) ? window._suggAllGames : [];
    const readyTile = readyEl?.closest('.sidebar-metric');
    if (readyEl && readyTile) {
        if (readyArr.length > 0) {
            readyEl.textContent = readyArr.length;
            readyTile.style.display = '';
        } else {
            readyTile.style.display = 'none';   // hide "—" placeholder tile
        }
    }

    // Need Sync — always hidden until wired to a reliable sync-error API
    const syncTile = syncEl?.closest('.sidebar-metric');
    if (syncTile) syncTile.style.display = 'none';
}

async function navigateToReadyToInstall() {
    const _rdbg = typeof localStorage !== 'undefined' && localStorage.getItem('baddel_debug_vs') === '1';
    // Idempotency: already in the RTI view — do not rebuild the page.
    if (typeof currentView !== 'undefined' && currentView === 'all-games' && window.agReadyOnly) {
        if (_rdbg) console.log('[AGROUTE] ready-click ignored/coalesced — already in RTI view');
        return;
    }
    // In-flight guard: prevent concurrent RTI navigations from racing and corrupting the DOM.
    if (window._agRtiNavInFlight) {
        if (_rdbg) console.log('[AGROUTE] ready-click ignored/coalesced — navigation in-flight');
        return;
    }
    window._agRtiNavInFlight = true;
    // agReadyOnly is set BEFORE navigateToAllGames so it can apply correct
    // title + nav active state before the first render (no two-pass flash).
    window.agInstalledOnly = false;
    window.agReadyOnly     = true;
    try {
        await navigateToAllGames({ _keepReadyMode: true });
    } finally {
        window._agRtiNavInFlight = false;
    }
    // Title and nav-ready active state are now set inside navigateToAllGames.
}

function updateSidebarPlatformDots() {
    const container = document.getElementById('sbPlatformDots');
    if (!container) return;
    const platforms = [
        { id: 'steamCount',    color: '#66c0f4' },
        { id: 'epicCount',     color: '#e0e0e0' },
        { id: 'riotCount',     color: '#ff4655' },
        { id: 'eaCount',       color: '#ff6b35' },
        { id: 'ubisoftCount',  color: '#00a8ff' },
        { id: 'discordCount',  color: '#5865f2' },
        { id: 'rockstarCount', color: '#fcaf17' },
    ];
    const active = platforms.filter(p => {
        const el = document.getElementById(p.id);
        return el && parseInt(el.textContent?.trim() || '0') > 0;
    });
    container.innerHTML = active.map(p =>
        `<span class="baddel-plat-dot" style="background:${p.color};" title="${p.id.replace('Count','')}"></span>`
    ).join('');
}

function updateSmartSidebarCounts() {
    // Installed count badge in nav
    const navInst = document.getElementById('sbNavInstalled');
    if (navInst && Array.isArray(allGamesData) && typeof _agIsInstalled === 'function') {
        const n = allGamesData.filter(g => { try { return _agIsInstalled(g); } catch(_) { return false; } }).length;
        navInst.textContent = n > 0 ? n : '—';
    }
    // Ready to Install — show real count, "…" while loading, "—" only on startup.
    const navReady = document.getElementById('sbNavReady');
    if (navReady) {
        const count = getReadyToInstallCount();
        if (count === null) {
            // If canonical state exists (accounts.js loaded), show loading "…"
            // Otherwise show initial dash "—"
            navReady.textContent = window.__readyToInstallState ? '…' : '—';
        } else {
            navReady.textContent = String(count);
        }
    }
}

// ── Ready to Install count — reads from canonical state ──────────────────────
// The canonical state is owned by accounts.js and published after every
// reliable library cache rebuild. Returns null when data is not yet ready.
function getReadyToInstallGamesForCounts() {
    if (typeof window.getCanonicalReadyToInstallGames === 'function') {
        const games = window.getCanonicalReadyToInstallGames();
        if (games !== null) {
            console.log(`[ReadyCount] sidebar consumed count=${games.length}`);
        }
        return games; // null = not ready, [] = ready but all installed, Array = ready
    }
    return null;
}

function getReadyToInstallCount() {
    if (typeof window.getCanonicalReadyToInstallCount === 'function') {
        return window.getCanonicalReadyToInstallCount();
    }
    return null;
}

// Update sidebar counts whenever canonical ready state changes.
try {
    window.addEventListener('baddel:ready-install-updated', () => {
        try { updateSmartSidebarCounts(); } catch (_) {}
    });
} catch (_) {}

// ── Sidebar action context — based on active view, not section toggle ─────────
function getSidebarActionContext() {
    const accountsVisible  = document.getElementById('accountsView')?.style.display !== 'none';
    const installedVisible = document.getElementById('installedGamesView')?.style.display !== 'none';
    const allGamesVisible  = document.getElementById('allGamesView')?.style.display !== 'none';
    const isFavorites      = currentView === 'collection' && currentFilters.collectionId === 'fav_system_default';
    // customCollVisible: installedGamesView is shown for collections too, so also require currentView
    const customCollVisible = currentView === 'collection' && !!currentFilters.collectionId && !isFavorites;

    if (accountsVisible && currentAccountPlatform)     return 'accounts';
    // installed: DOM visible AND currentView confirms it (collection pages also show installedGamesView)
    if ((installedVisible && currentView === 'installed') || currentView === 'installed') return 'installed';
    if (isFavorites)                                   return 'favorites';
    if (customCollVisible)                             return 'collection';
    if (currentView === 'collections')                 return 'collections';
    if ((allGamesVisible || currentView === 'all-games') && window.agReadyOnly) return 'ready';
    if (allGamesVisible || currentView === 'all-games') return 'all-games';
    if (currentView === 'home')                        return 'home';
    return 'library';
}

function syncSidebarActionButton() {
    const textEl = document.getElementById('sbCtxBtnText');
    const btn    = document.getElementById('btn-new-coll');
    const iconEl = document.getElementById('sbCtxIcon');
    if (!textEl) return;

    const ctx = getSidebarActionContext();

    const _map = {
        accounts:   { text: 'Add Account',            plus: true  },
        installed:  { text: 'Add Game',                plus: true  },
        collections:{ text: 'New Collection',          plus: true  },
        collection: { text: 'Browse Installed Games',  plus: false },
        favorites:  { text: 'Browse Installed Games',  plus: false },
        'all-games':{ text: 'Link Accounts',           plus: true  },
        ready:      { text: 'Link Accounts',           plus: true  },
        home:       { text: 'Link Accounts',           plus: true  },
        library:    { text: 'Link Accounts',           plus: true  },
    };
    const cfg = _map[ctx] || _map.library;
    textEl.textContent = cfg.text;
    if (iconEl) {
        // swap between + (plus) and ↗ (arrow) SVGs based on context
        iconEl.innerHTML = cfg.plus
            ? '<line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line>'
            : '<line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline>';
    }
    if (btn) {
        btn.style.display = '';
        btn.dataset.context = ctx;
    }
}

// ── Sidebar COLLECTIONS section ───────────────────────────────────────────────
const SB_COLL_MAX = 5;

function renderSidebarCollectionsList() {
    const body = document.getElementById('sbBodyCollections');
    if (!body) return;

    const custom = (allCollections || []).filter(c => c.id !== 'fav_system_default');
    const visible = custom.slice(0, SB_COLL_MAX);
    const moreCount = Math.max(0, custom.length - visible.length);

    if (!visible.length) {
        body.innerHTML =
            `<div class="nav-item sb-sub-item sb-coll-empty">` +
              `<div class="nav-icon"><div class="sb-coll-dot"></div></div>` +
              `<span class="nav-text" style="color:rgba(255,255,255,0.22)">No collections</span>` +
            `</div>`;
        return;
    }

    let html = visible.map(c => {
        const safeId   = escapeHtml(String(c.id));
        const safeName = escapeHtml(c.name || 'Unnamed');
        const count    = Array.isArray(c.gameIds) ? c.gameIds.length : 0;
        return (
            `<div class="nav-item sb-sub-item sb-coll-item" id="nav-coll-${safeId}" ` +
                `data-collection-id="${safeId}" onclick="openSidebarCollection('${safeId}')">` +
              `<div class="nav-icon"><div class="sb-coll-dot"></div></div>` +
              `<span class="nav-text">${safeName}</span>` +
              `<span class="sidebar-nav-badge">${count > 0 ? count : ''}</span>` +
            `</div>`
        );
    }).join('');

    if (moreCount > 0) {
        html +=
            `<div class="nav-item sb-sub-item sb-coll-more" onclick="navigateToCollections()">` +
              `<div class="nav-icon"><div class="sb-coll-dot" style="opacity:0.4"></div></div>` +
              `<span class="nav-text">View all</span>` +
              `<span class="sidebar-nav-badge">${moreCount} more</span>` +
            `</div>`;
    }

    body.innerHTML = html;
}

function openSidebarCollection(collectionId) {
    currentAccountPlatform = null;
    filterByCollection(collectionId);
    if (typeof updateSidebarActiveState === 'function') updateSidebarActiveState();
    if (typeof updateSbContextBtn === 'function') updateSbContextBtn();
}

function updateSidebarCards() {
    try { updateSidebarPlatformDots();  } catch (e) { console.warn('[Sidebar] platDots failed', e); }
    try { updateSmartSidebarCounts();   } catch (e) { console.warn('[Sidebar] counts failed', e); }
    // Legacy panel functions no-op gracefully (panels removed from HTML)
    try { renderSidebarJumpBackIn();    } catch (_) {}
    try { renderSidebarAccountSummary();} catch (_) {}
    try { renderSidebarLibraryPulse();  } catch (_) {}
}

// ── Sidebar section toggle ────────────────────────────────────────────────────

window._sbSec = _sbLoadSectionPreferences();

function sbToggleSection(sec) {
    if (!Object.prototype.hasOwnProperty.call(window._sbSec, sec)) return;
    window._sbSec[sec] = !window._sbSec[sec];
    _sbApplySectionState(sec);
    _sbSaveSectionPreferences();
    // Section expand/collapse does NOT change the active page or button context.
    // updateSbContextBtn reads DOM state (which view is visible), not _sbSec.
    updateSbContextBtn();
}

function sbExpandSection(sec) {
    if (!Object.prototype.hasOwnProperty.call(window._sbSec, sec)) return;
    if (window._sbSec[sec]) return;
    window._sbSec[sec] = true;
    _sbApplySectionState(sec);
    updateSbContextBtn();
}

function _sbApplySectionState(sec) {
    const cap     = sec.charAt(0).toUpperCase() + sec.slice(1);
    const body    = document.getElementById(`sbBody${cap}`);
    const chevron = document.getElementById(`sbChevron${cap}`);
    const open    = !!window._sbSec[sec];
    if (body) {
        // Use class (not inline style) so CSS collapsed mode can distinguish
        // between "section closed by user" vs "section open but collapsed sidebar".
        body.classList.toggle('sb-sec-closed', !open);
        body.style.display = open ? '' : 'none';
    }
    if (chevron) chevron.classList.toggle('sb-chevron-closed', !open);
}

function sbGoManageCollections() {
    navigateToCollections();
}

function handleSidebarContextBtn() {
    const ctx = getSidebarActionContext();
    if (ctx === 'accounts') {
        if (typeof addNewAccount === 'function' && currentAccountPlatform) {
            addNewAccount(currentAccountPlatform);
        } else if (typeof openPlatformsModal === 'function') {
            openPlatformsModal();
        }
        return;
    }
    if (ctx === 'installed') {
        if (typeof openAddGameModal === 'function') openAddGameModal();
        return;
    }
    if (ctx === 'collections') {
        if (typeof openCollectionModal === 'function') openCollectionModal();
        return;
    }
    if (ctx === 'collection' || ctx === 'favorites') {
        if (typeof navigateToInstalled === 'function') navigateToInstalled();
        return;
    }
    // all-games / ready / home / library — open accounts linking modal
    if (typeof openPlatformsModal === 'function') openPlatformsModal();
}

function updateSbContextBtn() {
    syncSidebarActionButton();
}


// ─────────────────────────────────────────────────────────────────────────────

function clearSidebarActiveState() {
    document.querySelectorAll('.nav-item.active, .platform-item.active, [data-collection-id].active')
        .forEach(el => el.classList.remove('active'));
}

function updateSidebarActiveState() {
    clearSidebarActiveState();

    const accountsVisible  = document.getElementById('accountsView')?.style.display !== 'none';
    const allGamesVisible  = document.getElementById('allGamesView')?.style.display !== 'none';

    // Only one branch wins — order from most-specific to most-general.
    if (accountsVisible && currentAccountPlatform) {
        // Platform/account page: only the matching platform row is active.
        document.getElementById(`nav-${currentAccountPlatform}`)?.classList.add('active');
    } else if (allGamesVisible && window.agReadyOnly) {
        document.getElementById('nav-ready')?.classList.add('active');
    } else if (allGamesVisible) {
        document.getElementById('nav-all-games')?.classList.add('active');
    } else if (currentView === 'installed') {
        document.getElementById('nav-installed')?.classList.add('active');
    } else if (currentView === 'collections') {
        document.getElementById('nav-collections')?.classList.add('active');
    } else if (currentView === 'collection' && currentFilters.collectionId === 'fav_system_default') {
        document.getElementById('nav-fav')?.classList.add('active');
    } else if (currentView === 'collection' && currentFilters.collectionId) {
        const escaped = CSS.escape(currentFilters.collectionId);
        document.querySelector(`[data-collection-id="${escaped}"]`)?.classList.add('active');
    } else if (currentView === 'home') {
        document.getElementById('nav-home')?.classList.add('active');
    }
}

function toggleSidebar() {
    const s = document.getElementById('mainSidebar'), i = document.getElementById('toggleIcon');
    s.classList.toggle('collapsed');
    i.innerHTML = s.classList.contains('collapsed') ? '&#9654;' : '&#9664;';

    const vs = window._vs;
    if (!vs || typeof window._vsRender !== 'function') return;
    if (vs.items.length === 0) return;
    // FIX: Skip _vsRender when in list mode — _vsRender forces grid.style.display='block'
    // which would snap All Games back to grid view when user collapses the sidebar.
    if (window._agDisplayPrefs && window._agDisplayPrefs.viewMode === 'list') return;

    // Match CSS transition duration (250ms).
    // Poll every ~3 frames instead of every frame — columns change at most once.
    const DURATION = 270;
    const POLL_MS   = 48;
    const startTime = performance.now();
    let lastCols = vs.cols;

    function poll() {
        const elapsed = performance.now() - startTime;
        const grid = document.getElementById('allGamesGrid');
        if (!grid) return;

        const m = _vsMeasure(grid);
        if (m.cols !== lastCols) {
            lastCols = m.cols;
            vs._gridTopDirty = true;
            window._vsRender(true);
        } else if (vs.rowH !== m.rowH) {
            vs.rowH = m.rowH;
            const totalRows = Math.ceil(vs.items.length / vs.cols);
            grid.style.height = (totalRows * vs.rowH - vs.gap) + 'px';
            vs.cardPool.forEach((rowEl, rowIdx) => {
                rowEl.style.top = (rowIdx * vs.rowH) + 'px';
            });
        }

        if (elapsed < DURATION) {
            setTimeout(() => requestAnimationFrame(poll), POLL_MS);
        } else {
            // Final pass after transition ends
            vs._gridTopDirty = true;
            window._vsRender(true);
        }
    }

    requestAnimationFrame(poll);
}

// Explicit window exports so inline onclick handlers and cross-file calls resolve correctly
window.renderSidebar               = renderSidebar;
window.setSidebarAllGamesCount     = setSidebarAllGamesCount;
window._sbReadPersistedAllGamesCount = _sbReadPersistedAllGamesCount;
window._sbApplyStartupAllGamesCount = _sbApplyStartupAllGamesCount;
window.renderSidebarJumpBackIn     = renderSidebarJumpBackIn;
window.renderSidebarAccountSummary = renderSidebarAccountSummary;
window.renderSidebarLibraryPulse   = renderSidebarLibraryPulse;
window.navigateToReadyToInstall    = navigateToReadyToInstall;
window.updateSidebarPlatformDots   = updateSidebarPlatformDots;
window.updateSmartSidebarCounts    = updateSmartSidebarCounts;
window.getReadyToInstallGamesForCounts = getReadyToInstallGamesForCounts;
window.getReadyToInstallCount      = getReadyToInstallCount;
window.getSidebarActionContext     = getSidebarActionContext;
window.syncSidebarActionButton     = syncSidebarActionButton;
window.renderSidebarCollectionsList = renderSidebarCollectionsList;
window.updateSidebarCards          = updateSidebarCards;
window.sbToggleSection             = sbToggleSection;
window.sbExpandSection             = sbExpandSection;
window._sbApplySectionState        = _sbApplySectionState;
window.sbGoManageCollections       = sbGoManageCollections;
window.handleSidebarContextBtn     = handleSidebarContextBtn;
window.updateSbContextBtn          = updateSbContextBtn;
window.clearSidebarActiveState     = clearSidebarActiveState;
window.updateSidebarActiveState    = updateSidebarActiveState;
window.toggleSidebar               = toggleSidebar;
window.openSidebarCollection       = openSidebarCollection;
