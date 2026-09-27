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
    queueSidebarOverflowSync();
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
        const installedCount = _sbComputeInstalledCount();
        if (installedCount !== null) {
            const stableCount = _sbResolveStableInstalledCount(installedCount, 'library-pulse');
            instEl.textContent = stableCount > 0 ? String(stableCount) : '—';
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

let _sbStableInstalledCount = null;
let _sbPendingInstalledDrop = null;
let _sbPendingInstalledTimer = null;

function _sbIsInstalledGame(game) {
    if (typeof _agIsInstalled === 'function') {
        try { return _agIsInstalled(game); } catch (_) {}
    }
    // accounts.js loads after app.js, so its canonical predicate may not exist
    // when the cached local library is rendered during the first startup turn.
    return !!(game?.path || game?.command || game?.isInstalled);
}

function _sbComputeInstalledCount() {
    if (!Array.isArray(allGamesData)) return null;
    const installed = allGamesData.filter(_sbIsInstalledGame);
    const api = window.BaddelCanonicalProductIdentity;
    if (api && typeof api.dedupeDelegatedLaunchProducts === 'function') {
        try {
            const projected = api.dedupeDelegatedLaunchProducts(installed);
            if (Array.isArray(projected)) return projected.length;
        } catch (_) {}
    }
    return installed.length;
}

function _sbApplyInstalledCountToDom(count) {
    const navInst = document.getElementById('sbNavInstalled');
    if (navInst) navInst.textContent = String(count);

    const instEl = document.getElementById('sbInstalledGames');
    if (instEl) instEl.textContent = String(count);
}

function _sbResolveStableInstalledCount(nextCount, source = 'sidebar-counts') {
    if (!Number.isInteger(nextCount) || nextCount < 0) return _sbStableInstalledCount;

    if (_sbStableInstalledCount === null || nextCount >= _sbStableInstalledCount) {
        _sbStableInstalledCount = nextCount;
        _sbPendingInstalledDrop = null;
        if (_sbPendingInstalledTimer) {
            clearTimeout(_sbPendingInstalledTimer);
            _sbPendingInstalledTimer = null;
        }
        return _sbStableInstalledCount;
    }

    _sbPendingInstalledDrop = {
        count: nextCount,
        source,
        requestedAt: Date.now(),
    };

    if (!_sbPendingInstalledTimer) {
        _sbPendingInstalledTimer = setTimeout(() => {
            _sbPendingInstalledTimer = null;
            const pending = _sbPendingInstalledDrop;
            if (!pending) return;
            const confirmed = _sbComputeInstalledCount();
            if (Number.isInteger(confirmed) && confirmed <= pending.count) {
                _sbStableInstalledCount = confirmed;
                _sbPendingInstalledDrop = null;
                _sbApplyInstalledCountToDom(confirmed);
            } else {
                _sbPendingInstalledDrop = null;
            }
        }, 1500);
    }

    return _sbStableInstalledCount;
}

function updateSmartSidebarCounts() {
    // Installed count badge in nav
    const nextInstalledCount = _sbComputeInstalledCount();
    if (nextInstalledCount !== null) {
        const stableCount = _sbResolveStableInstalledCount(nextInstalledCount, 'smart-sidebar');
        if (stableCount !== null) _sbApplyInstalledCountToDom(stableCount);
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
    const accountsVisible = document.getElementById('accountsView')?.style.display !== 'none';
    const installedVisible = document.getElementById('installedGamesView')?.style.display !== 'none';
    const allGamesVisible = document.getElementById('allGamesView')?.style.display !== 'none';
    const downloadsVisible = _sbIsDownloadsVisible();
    const isFavorites = currentView === 'collection' && currentFilters.collectionId === 'fav_system_default';
    const customCollVisible = currentView === 'collection' && !!currentFilters.collectionId && !isFavorites;

    if (accountsVisible && currentAccountPlatform) return 'accounts';
    if ((installedVisible && currentView === 'installed') || currentView === 'installed') return 'installed';
    if (downloadsVisible || currentView === 'downloads') return 'downloads';
    if (isFavorites) return 'favorites';
    if (customCollVisible) return 'collection';
    if (currentView === 'collections') return 'collections';
    if ((allGamesVisible || currentView === 'all-games') && window.agReadyOnly) return 'ready';
    if (allGamesVisible || currentView === 'all-games') return 'all-games';
    if (currentView === 'vault') return 'vault';
    if (currentView === 'home') return 'home';
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
        downloads:  { text: 'Browse Ready Games',       plus: false },
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

function queueSidebarOverflowSync() {
    const run = () => {
        try { syncSidebarAccountOverflowMode(); } catch (e) { console.warn('[Sidebar] overflow sync failed', e); }
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 0);
}

const SIDEBAR_PRIMARY_PLATFORM_LIMIT = 5;

function syncSidebarAccountOverflowMode() {
    const sidebar = document.getElementById('mainSidebar');
    const scroller = sidebar?.querySelector('.sidebar-scroll-content');
    const accounts = document.getElementById('sbBodyAccounts');
    const moreButton = document.getElementById('sbAccountsMoreBtn');
    const moreText = document.getElementById('sbAccountsMoreText');
    if (!sidebar || !scroller || !accounts) return;

    const platformRows = [...accounts.querySelectorAll('.platform-item')];
    platformRows.forEach((row, index) => {
        row.classList.toggle('sb-account-extra', index >= SIDEBAR_PRIMARY_PLATFORM_LIMIT);
    });
    const hasMorePlatforms = platformRows.length > SIDEBAR_PRIMARY_PLATFORM_LIMIT;
    if (moreButton) moreButton.hidden = !hasMorePlatforms;

    const previousScrollTop = scroller.scrollTop;
    sidebar.classList.toggle('sidebar-compact-accounts', hasMorePlatforms);

    if (!hasMorePlatforms) accounts.classList.remove('sb-accounts-expanded');
    if (moreText) {
        moreText.textContent = hasMorePlatforms && accounts.classList.contains('sb-accounts-expanded')
            ? 'Show less'
            : 'More platforms';
    }

    scroller.scrollTop = Math.min(previousScrollTop, scroller.scrollHeight);
}
window._sbSec = _sbLoadSectionPreferences();

function sbToggleSection(sec) {
    if (!Object.prototype.hasOwnProperty.call(window._sbSec, sec)) return;
    window._sbSec[sec] = !window._sbSec[sec];
    _sbApplySectionState(sec);
    _sbSaveSectionPreferences();
    // Section expand/collapse does NOT change the active page or button context.
    // updateSbContextBtn reads DOM state (which view is visible), not _sbSec.
    updateSbContextBtn();
    queueSidebarOverflowSync();
}

function sbExpandSection(sec) {
    if (!Object.prototype.hasOwnProperty.call(window._sbSec, sec)) return;
    if (window._sbSec[sec]) return;
    window._sbSec[sec] = true;
    _sbApplySectionState(sec);
    updateSbContextBtn();
    queueSidebarOverflowSync();
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

function sbToggleAccountsMore(event) {
    if (event) event.stopPropagation();
    const body = document.getElementById('sbBodyAccounts');
    if (!body) return;
    const expanded = !body.classList.contains('sb-accounts-expanded');
    body.classList.toggle('sb-accounts-expanded', expanded);
    const text = document.getElementById('sbAccountsMoreText');
    if (text) text.textContent = expanded ? 'Show less' : 'More platforms';
    queueSidebarOverflowSync();
}

function toggleInstalledFavoritesFilter() {
    const isFavorites = currentView === 'collection' && currentFilters.collectionId === 'fav_system_default';
    if (isFavorites) {
        if (typeof navigateToInstalled === 'function') navigateToInstalled();
        return;
    }
    if (typeof filterByCollection === 'function') filterByCollection('fav_system_default');
}

const VAULT_PLATFORM_META = {
    epic: {
        label: 'Epic Games vault',
        title: 'Purchases by game, account by account.',
        text: 'A focused ledger for total spend, game-level purchases, linked accounts, and notable library value signals.',
        accounts: 'Multi',
        signal: 'Spend'
    },
    steam: {
        label: 'Steam vault',
        title: 'Ownership history with spend context.',
        text: 'Track store spend, library value, playtime weight, and account-level purchasing patterns without leaving the vault.',
        accounts: 'Multi',
        signal: 'Library'
    },
    valorant: {
        label: 'Valorant vault',
        title: 'Skins, bundles, wallet trail.',
        text: 'A sealed view for VP spend, unlocked cosmetics, account inventory, and the parts of the collection that matter most.',
        accounts: 'Riot',
        signal: 'Skins'
    },
    league: {
        label: 'League vault',
        title: 'Skins, champions, and account value.',
        text: 'Designed for owned skins, champion collection, purchase trail, and multiple account comparison when the data layer lands.',
        accounts: 'Riot',
        signal: 'Skins'
    }
};

function normalizeVaultPlatform(platform) {
    const key = String(platform || '').toLowerCase();
    if (key === 'overview' || !key) return 'overview';
    return VAULT_PLATFORM_META[key] ? key : null;
}

let __vaultState = 'overview';
let __vaultSelectedPlatform = null;
const VAULT_EPIC_CURRENT_FILTER_VERSION_KEY = 'baddelVaultEpicCurrentFilterVersion';
const VAULT_EPIC_CURRENT_FILTER_KEY = 'baddelVaultEpicCurrentFilter';
const VAULT_EPIC_CURRENT_FILTER_VERSION = '2';

function _vaultAllowedCurrentLibraryFilter(filter) {
    return ['priced', 'all', 'free', 'sale', 'unavailable'].includes(filter) ? filter : 'priced';
}

function _vaultLoadCurrentLibraryFilter() {
    try {
        const version = localStorage.getItem(VAULT_EPIC_CURRENT_FILTER_VERSION_KEY);
        if (version !== VAULT_EPIC_CURRENT_FILTER_VERSION) {
            localStorage.setItem(VAULT_EPIC_CURRENT_FILTER_VERSION_KEY, VAULT_EPIC_CURRENT_FILTER_VERSION);
            localStorage.setItem(VAULT_EPIC_CURRENT_FILTER_KEY, 'priced');
            return 'priced';
        }
        return _vaultAllowedCurrentLibraryFilter(localStorage.getItem(VAULT_EPIC_CURRENT_FILTER_KEY) || 'priced');
    } catch (_) {
        return 'priced';
    }
}

let __vaultEpicPriceMode = localStorage.getItem('baddelVaultEpicPriceMode') || 'current';
let __vaultEpicSection = 'library';
let __vaultEpicLibrarySort = localStorage.getItem('baddelVaultEpicLibrarySort') || 'price_desc';
let __vaultEpicCurrentLibraryFilter = _vaultLoadCurrentLibraryFilter();
let __vaultEpicPurchaseLibraryFilter = 'all';
let __vaultEpicLibraryFilter = __vaultEpicPriceMode === 'purchase' ? __vaultEpicPurchaseLibraryFilter : __vaultEpicCurrentLibraryFilter;
let __vaultEpicLibrarySearch = '';
let __vaultEpicHistorySort = localStorage.getItem('baddelVaultEpicHistorySort') || 'amount_desc';
let __vaultEpicHistoryFilter = 'all';
let __vaultEpicHistoryCurrency = 'all';
let __vaultEpicHistorySearch = '';
let __vaultSelectedEpicAccountId = null;
let __vaultEpicAccountNavigationRevision = 0;
let __vaultEpicDataCache = null;
let __vaultEpicCacheDirty = true;
let __vaultEpicProgressStates = {};
const __vaultEpicPendingProgressPayloads = new Map();
const __vaultEpicSeenTerminalEvents = new Set();
let __vaultEpicProgressPatchScheduled = false;
let __vaultEpicProgressDomPatchCount = 0;
let __vaultEpicVaultReconcileCount = 0;
let __vaultEpicFullRenderCount = 0;
let __vaultEpicBatchReconcileTimer = null;
let __vaultEpicLastBatchReconcileAt = 0;
const __vaultEpicCoverRuntimePrefs = new Map();
const __vaultEpicBadCoverCandidates = new Set();
const __vaultEpicUnmatchedPurchaseLogs = new Set();
const __vaultEpicCoverWarmQueued = new Set();
const __vaultEpicArtworkRegistry = new Map();
const __vaultEpicArtworkLookupInflight = new Map();
const __vaultArtworkArrayIds = new WeakMap();
let __vaultArtworkArraySeq = 1;
let __vaultArtworkIndexCache = null;
let __vaultEpicHistoryRefreshing = false;
let __vaultEpicHistoryOperationId = null;
const __vaultEpicPriceRefreshingAccounts = new Set();
const __vaultEpicPriceRefreshErrors = new Map();
const __vaultEpicPriceRefreshProgress = new Map();
const VAULT_EPIC_PRICE_DISMISSALS_KEY = 'baddel.vault.epicPriceDismissals.v1';

function _vaultLoadEpicPriceDismissals() {
    try {
        const value = JSON.parse(localStorage.getItem(VAULT_EPIC_PRICE_DISMISSALS_KEY) || '{}');
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch { return {}; }
}

function _vaultEpicPriceFailureAttemptId(accountId, price = null, state = null) {
    const phase = price || state?.phases?.prices || {};
    return [
        'prices', String(accountId || ''), String(state?.syncRunId || 'manual'),
        Number(state?.revision || 0), String(phase.attemptId || phase.completedAt || ''),
        String(phase.errorCode || ''), String(phase.failedStage || ''),
    ].join(':');
}

function _vaultIsEpicPriceWarningDismissed(accountId, attemptId) {
    return _vaultLoadEpicPriceDismissals()[String(accountId || '')] === String(attemptId || '');
}

function _vaultClearEpicPriceWarningDismissal(accountId) {
    const id = String(accountId || '');
    const dismissals = _vaultLoadEpicPriceDismissals();
    if (!Object.prototype.hasOwnProperty.call(dismissals, id)) return;
    delete dismissals[id];
    try { localStorage.setItem(VAULT_EPIC_PRICE_DISMISSALS_KEY, JSON.stringify(dismissals)); } catch {}
}

function dismissVaultEpicPriceWarning(accountId, attemptId) {
    const id = String(accountId || '');
    const dismissals = _vaultLoadEpicPriceDismissals();
    dismissals[id] = String(attemptId || '');
    try { localStorage.setItem(VAULT_EPIC_PRICE_DISMISSALS_KEY, JSON.stringify(dismissals)); } catch {}
    const manual = __vaultEpicPriceRefreshErrors.get(id);
    if (manual && String(manual.attemptId || '') === String(attemptId || '')) __vaultEpicPriceRefreshErrors.delete(id);
    const account = _vaultSelectedEpicAccount();
    if (account && String(account.accountId) === id) {
        _vaultPatchEpicAccountShell(account);
        const notice = document.getElementById('vaultEpicProgressNotice');
        if (notice) notice.innerHTML = _vaultEpicProgressNoticeHtml(id);
    }
}
window.dismissVaultEpicPriceWarning = dismissVaultEpicPriceWarning;

let __vaultEpicHistoryNotice = null;
let __vaultEpicHistorySuccessTimer = null;
let __vaultEpicAuthPromptResolve = null;
let __vaultEpicLibrarySearchTimer = null;
let __vaultEpicHistorySearchTimer = null;
let __vaultEpicLibraryRenderJob = 0;
let __vaultEpicHistoryRenderJob = 0;
const __vaultArtworkWarmSignatures = new Set();
let __vaultEpicRefreshSeq = 0;
let __vaultEpicAcceptedRevision = 0;
let __vaultEpicRequiredRevision = 0;
let __vaultOverviewError = null;
let __vaultEpicUserDataPath = null;
const __vaultHydrationDiagnostics = [];
let __vaultEpicRefreshPromise = null;
let __vaultEpicRefreshQueued = false;
const VAULT_EPIC_WARM_BATCH_LIMIT = 48;
const VAULT_LIBRARY_MIN_CARD_WIDTH = 160;
const VAULT_LIBRARY_CARD_RATIO = 1.5;
const VAULT_LIBRARY_ROW_GAP = 18;
const VAULT_LIBRARY_BUFFER_ROWS = 3;
const VAULT_HISTORY_ROW_HEIGHT = 90;
const VAULT_HISTORY_BUFFER_ROWS = 6;
const __vaultLibraryVirtual = { items: [], account: null, purchaseMap: new Map(), renderContext: null, host: null, scroller: null, controller: null, cardCache: new Map(), rowPool: new Map(), columns: 1, cardWidth: 160, cardHeight: 240, rowHeight: 258, totalHeight: 0, renderedStart: -1, renderedEnd: -1, raf: 0, generation: 0 };
const __vaultHistoryVirtual = { items: [], account: null, host: null, scroller: null, controller: null, rowPool: new Map(), rowHeight: VAULT_HISTORY_ROW_HEIGHT, totalHeight: 0, renderedStart: -1, renderedEnd: -1, raf: 0, generation: 0 };

function _vaultEffectiveLibraryFilter() {
    __vaultEpicLibraryFilter = __vaultEpicPriceMode === 'purchase' ? __vaultEpicPurchaseLibraryFilter : __vaultEpicCurrentLibraryFilter;
    return __vaultEpicLibraryFilter;
}

function _vaultSetEffectiveLibraryFilter(filter, { persist = true } = {}) {
    if (__vaultEpicPriceMode === 'purchase') {
        __vaultEpicPurchaseLibraryFilter = 'all';
        __vaultEpicLibraryFilter = 'all';
        return 'all';
    }
    __vaultEpicCurrentLibraryFilter = _vaultAllowedCurrentLibraryFilter(filter);
    __vaultEpicLibraryFilter = __vaultEpicCurrentLibraryFilter;
    if (persist) {
        try {
            localStorage.setItem(VAULT_EPIC_CURRENT_FILTER_VERSION_KEY, VAULT_EPIC_CURRENT_FILTER_VERSION);
            localStorage.setItem(VAULT_EPIC_CURRENT_FILTER_KEY, __vaultEpicCurrentLibraryFilter);
        } catch (_) {}
    }
    return __vaultEpicCurrentLibraryFilter;
}

function _vaultIsCurrentPricedGame(game, account) {
    const view = _vaultGetCurrentPriceView(game, account);
    return view.status === 'priced' && _vaultCurrentAmountMinor(game) > 0;
}

function _vaultIsCurrentFreeGame(game, account) {
    const view = _vaultGetCurrentPriceView(game, account);
    return view.status === 'free' || (view.status === 'priced' && _vaultCurrentAmountMinor(game) === 0);
}

function _vaultIsCurrentUnavailableGame(game, account) {
    const view = _vaultGetCurrentPriceView(game, account);
    return ['unresolved', 'unavailable', 'not_for_sale'].includes(view.status);
}
function _setVaultState(state, platform = null) {
    const nextState = ['overview', 'platform', 'account'].includes(state) ? state : 'overview';
    const nextPlatform = nextState === 'overview' ? null : normalizeVaultPlatform(platform);
    if (nextState !== 'overview' && !nextPlatform) {
        __vaultState = 'overview';
        __vaultSelectedPlatform = null;
    } else {
        __vaultState = nextState;
        __vaultSelectedPlatform = nextPlatform;
    }

    const page = document.getElementById('vaultPage');
    if (page) {
        page.dataset.vaultState = __vaultState;
        if (__vaultSelectedPlatform) page.dataset.vaultPlatform = __vaultSelectedPlatform;
        else delete page.dataset.vaultPlatform;
    }
}

function _vaultCurrencyCode(currency = 'USD') {
    const code = String(currency || 'USD').trim().toUpperCase();
    return /^[A-Z]{3}$/.test(code) ? code : 'USD';
}

function _vaultMoney(value, currency = 'USD') {
    const n = Number(value || 0);
    const amount = Number.isFinite(n)
        ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : '0.00';
    return _vaultCurrencyCode(currency) + ' ' + amount;
}

function _vaultMinorMoney(value, currency = 'USD') {
    return _vaultMoney(Number(value || 0) / 100, currency);
}

function _vaultCurrencyMapField(minorField) {
    return {
        grossPurchasesMinor: 'grossPurchasesByCurrency',
        refundsMinor: 'refundsByCurrency',
        netSpentMinor: 'netSpentByCurrency',
    }[minorField] || null;
}

function _vaultSpendCurrency(account = {}) {
    const raw = account.primaryCurrency || account.currency || 'USD';
    return raw && raw !== 'MULTI' ? raw : 'USD';
}

function _vaultCurrencyLines(account = {}, minorField = 'netSpentMinor') {
    if (window.VaultShowcaseModel?.financialLines) {
        return window.VaultShowcaseModel.financialLines(account, minorField, {
            locale: 'en-US',
            absolute: minorField === 'refundsMinor',
        }).map((line) => line.text);
    }
    const mapField = _vaultCurrencyMapField(minorField);
    const bucket = mapField ? account[mapField] : null;
    const entries = bucket && typeof bucket === 'object'
        ? Object.entries(bucket)
            .map(([currency, minor]) => ({ currency: String(currency || '').toUpperCase(), minor: Number(minor || 0) }))
            .filter(({ currency, minor }) => currency && currency !== 'MULTI' && Number.isFinite(minor) && minor !== 0)
        : [];
    if (entries.length) return entries.map(({ currency, minor }) => _vaultMinorMoney(minor, currency));
    const currency = _vaultSpendCurrency(account);
    const minor = Number(account[minorField] ?? Math.round(Number(account.actualSpent || 0) * 100));
    return [_vaultMinorMoney(Number.isFinite(minor) ? minor : 0, currency)];
}

function _vaultFormatCurrencyBucket(bucket = {}) {
    const temp = { netSpentByCurrency: bucket, multipleCurrencies: true, currency: 'USD' };
    return _vaultCurrencyLines(temp, 'netSpentMinor').join('\n');
}

function _vaultSpendLabel(account = {}, minorField = 'netSpentMinor') {
    return _vaultCurrencyLines(account, minorField).join('\n');
}

function _vaultSpendHtml(account = {}, minorField = 'netSpentMinor') {
    return _vaultCurrencyLines(account, minorField)
        .map((line) => `<span>${_vaultHtml(line)}</span>`)
        .join('');
}

function _vaultCountryLabel(countryCode) {
    const code = String(countryCode || '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) return 'Unknown';
    try {
        const locale = typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en';
        const names = new Intl.DisplayNames([locale], { type: 'region' });
        const name = names.of(code);
        return name ? `${name} (${code})` : code;
    } catch {
        return code;
    }
}

function _vaultStoreCurrency(account = {}) {
    const prices = Array.isArray(account.livePrices) ? account.livePrices : [];
    const priced = prices.find((price) => price?.currency && price.currency !== 'MULTI');
    return String(priced?.currency || account.primaryCurrency || account.currency || 'USD').toUpperCase();
}

function _vaultInfo(text) {
    return `<span class="vault-info" tabindex="0" data-tooltip="${_vaultHtml(text)}">ⓘ</span>`;
}

function _vaultMetricCard(label, htmlValue, tooltip, tone = '') {
    return `<article class="vault-metric-card ${tone}">
        <div class="vault-metric-label"><span>${_vaultHtml(label)}</span>${_vaultInfo(tooltip)}</div>
        <div class="vault-metric-value">${htmlValue}</div>
    </article>`;
}

function _vaultHtml(value) {
    if (typeof escapeHtml === 'function') return escapeHtml(String(value || ''));
    return String(value || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function _setVaultReadout(labelId, valueId, label, value) {
    const l = document.getElementById(labelId);
    const v = document.getElementById(valueId);
    if (l) l.textContent = label;
    if (v) v.textContent = value;
}

function _vaultNormalizeTitle(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function _vaultIdentityKeys(entry = {}) {
    if (!entry || typeof entry !== 'object') return [];
    const keys = [];
    const namespace = entry.namespace || entry.sandboxId || entry.epicMetadata?.namespace || '';
    const offerId = entry.offerId || entry.catalogOfferId || entry.offer_id || '';
    const catalogItemId = entry.catalogItemId || entry.catalog_item_id || entry.catalogId || '';
    const appName = entry.appName || entry.app_name || '';
    const id = entry.id || entry.gameId || entry.productId || '';
    const allIds = entry.allIds && typeof entry.allIds === 'object' ? entry.allIds : {};
    const launcherGameId = entry.launcherGameId || entry.displayId || entry.localGameId || entry.canonicalGameId || '';
    const title = _vaultNormalizeTitle(entry.title || entry.name || entry.description);
    const push = (key) => { if (key && !keys.includes(key)) keys.push(key); };
    if (namespace && offerId) push(`ns:${namespace}:offer:${offerId}`);
    if (namespace && catalogItemId) push(`ns:${namespace}:catalog:${catalogItemId}`);
    if (offerId) push(`offer:${String(offerId).toLowerCase()}`);
    if (catalogItemId) push(`catalog:${String(catalogItemId).toLowerCase()}`);
    if (appName) push(`app:${String(appName).toLowerCase()}`);
    if (allIds.epic) push(`allids:epic:${String(allIds.epic).toLowerCase()}`);
    if (allIds.epicCatalogItemId) push(`catalog:${String(allIds.epicCatalogItemId).toLowerCase()}`);
    if (allIds.epicOfferId) push(`offer:${String(allIds.epicOfferId).toLowerCase()}`);
    if (launcherGameId) push(`local:${String(launcherGameId).toLowerCase()}`);
    if (id) push(`id:${String(id).toLowerCase()}`);
    if (title) push(`title:${title}`);
    return keys;
}

function _vaultKeyPart(value) {
    return String(value || '').trim().toLowerCase();
}

function _vaultCanonicalGameKey(entry = {}) {
    if (!entry || typeof entry !== 'object') return '';
    const namespace = _vaultKeyPart(entry.namespace || entry.sandboxId || entry.epicMetadata?.namespace);
    const catalogItemId = _vaultKeyPart(entry.catalogItemId || entry.catalog_item_id || entry.catalogId);
    const appName = _vaultKeyPart(entry.appName || entry.app_name);
    const productSlug = _vaultKeyPart(entry.productSlug || entry.slug);
    const title = _vaultNormalizeTitle(entry.title || entry.name || entry.description);
    const offerId = _vaultKeyPart(entry.offerId || entry.catalogOfferId || entry.offer_id);
    if (namespace && catalogItemId) return `epic:ns:${namespace}:catalog:${catalogItemId}`;
    if (namespace && appName) return `epic:ns:${namespace}:app:${appName}`;
    if (namespace && productSlug) return `epic:ns:${namespace}:slug:${productSlug}`;
    if (catalogItemId) return `epic:catalog:${catalogItemId}`;
    if (namespace && title) return `epic:ns:${namespace}:title:${title}`;
    if (appName) return `epic:app:${appName}`;
    if (productSlug) return `epic:slug:${productSlug}`;
    if (title && !/\b(dlc|add on|add-on|pack|bundle|edition|soundtrack|demo|beta|test)\b/i.test(title)) return `epic:title:${title}`;
    return offerId ? `epic:offer:${offerId}` : '';
}

function _vaultHasUsablePrice(row = {}) {
    const status = row.priceStatus || row.livePrice?.priceStatus;
    return status === 'priced' || status === 'free' || status === 'not_for_sale' || status === 'unavailable';
}

function _vaultProductKind(entry = {}) {
    const text = _vaultNormalizeTitle(`${entry.productType || entry.type || entry.categories || ''} ${entry.title || entry.name || ''}`);
    if (/\b(soundtrack|ost|music)\b/.test(text)) return 'soundtrack';
    if (/\b(dlc|add on|add-on|addon|pack|skin|bundle|episode|season pass|expansion)\b/.test(text)) return 'addon';
    if (/\b(demo|beta|test|server|editor|tool)\b/.test(text)) return 'utility';
    return 'game';
}

function _vaultArtworkFingerprints(entry = {}) {
    const candidates = [];
    if (entry.coverUrl) candidates.push(entry.coverUrl);
    if (entry.image) candidates.push(entry.image);
    if (entry.defaultImage) candidates.push(entry.defaultImage);
    if (entry.artwork?.cover) candidates.push(entry.artwork.cover);
    for (const item of Array.isArray(entry.coverCandidates) ? entry.coverCandidates : []) candidates.push(typeof item === 'string' ? item : item?.url);
    return new Set(candidates.map((candidate) => String(candidate || '').trim().toLowerCase()).filter(Boolean));
}

function _vaultPrimaryArtworkFingerprint(entry = {}) {
    return [..._vaultArtworkFingerprints(entry)][0] || '';
}

function _vaultHasSharedArtworkFingerprint(existing = {}, incoming = {}) {
    const existingArt = _vaultArtworkFingerprints(existing);
    if (!existingArt.size) return false;
    for (const art of _vaultArtworkFingerprints(incoming)) {
        if (existingArt.has(art)) return true;
    }
    return false;
}

function _vaultCanMergeByTitle(existing = {}, incoming = {}) {
    const title = _vaultNormalizeTitle(existing.title || existing.name);
    if (!title || title !== _vaultNormalizeTitle(incoming.title || incoming.name)) return false;
    if (_vaultProductKind(existing) !== _vaultProductKind(incoming)) return false;
    if (_vaultProductKind(existing) !== 'game') return false;
    const nsA = _vaultKeyPart(existing.namespace || existing.sandboxId || existing.epicMetadata?.namespace);
    const nsB = _vaultKeyPart(incoming.namespace || incoming.sandboxId || incoming.epicMetadata?.namespace);
    const appA = _vaultKeyPart(existing.appName || existing.app_name);
    const appB = _vaultKeyPart(incoming.appName || incoming.app_name);
    if (_vaultHasSharedArtworkFingerprint(existing, incoming)) return true;
    if (nsA && nsB && nsA === nsB) return true;
    if (appA && appB && appA === appB) return true;
    return false;
}
function _vaultMergeGameDuplicate(existing = {}, incoming = {}) {
    const existingPriceWins = _vaultHasUsablePrice(existing) && !_vaultHasUsablePrice(incoming);
    const livePrice = existingPriceWins ? existing.livePrice : (incoming.livePrice || existing.livePrice || null);
    const priceStatus = existingPriceWins
        ? (existing.priceStatus || existing.livePrice?.priceStatus || 'unresolved')
        : (incoming.priceStatus || incoming.livePrice?.priceStatus || existing.priceStatus || 'unresolved');
    const coverCandidates = [];
    for (const item of [...(existing.coverCandidates || []), ...(incoming.coverCandidates || [])]) {
        const url = typeof item === 'string' ? item : item?.url;
        if (url && !coverCandidates.some((candidate) => candidate.url === url)) coverCandidates.push(typeof item === 'string' ? { url, source: 'merged' } : item);
    }
    return {
        ...existing,
        ...incoming,
        id: existing.id || incoming.id,
        title: existing.title || incoming.title,
        coverUrl: existing.coverUrl || incoming.coverUrl || coverCandidates[0]?.url || null,
        coverCandidates,
        appName: existing.appName || incoming.appName || null,
        namespace: existing.namespace || incoming.namespace || null,
        catalogItemId: existing.catalogItemId || incoming.catalogItemId || null,
        offerId: existing.offerId || incoming.offerId || null,
        livePrice,
        priceResolved: _vaultHasUsablePrice({ livePrice, priceStatus }) || existing.priceResolved === true,
        priceStatus,
        duplicateOfferIds: [...new Set([...(existing.duplicateOfferIds || []), existing.offerId, incoming.offerId].filter(Boolean).map(String))],
        vaultCanonicalKey: existing.vaultCanonicalKey || incoming.vaultCanonicalKey || _vaultCanonicalGameKey(existing) || _vaultCanonicalGameKey(incoming),
    };
}

function _vaultDedupeLibraryGames(games = []) {
    const seen = new Set();
    return (Array.isArray(games) ? games : []).filter((game, index) => {
        if (!game) return false;
        const key = String(game.canonicalGameId || game.vaultCanonicalKey || game.id || `epic:row:${index}`);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
function _vaultIsCancelledOrFailed(item = {}) {
    const text = `${item.status || ''} ${item.orderStatus || ''} ${item.state || ''} ${item.type || ''}`;
    return /cancel|failed|declined|void|pending|authoriz/i.test(text);
}

function _vaultAmountMinor(item = {}) {
    return Number(item.amountMinor ?? Math.round(Number(item.amount || 0) * 100)) || 0;
}

function _vaultIsPaidGamePurchase(item = {}) {
    return _vaultAmountMinor(item) > 0 && item.isRefund !== true && item.isFab !== true && !_vaultIsCancelledOrFailed(item);
}

function _vaultPurchaseRank(item = {}) {
    if (_vaultIsPaidGamePurchase(item)) return 3;
    if (_vaultAmountMinor(item) > 0 && item.isRefund !== true && !_vaultIsCancelledOrFailed(item)) return 2;
    if (_vaultAmountMinor(item) === 0 && item.isRefund !== true && !_vaultIsCancelledOrFailed(item)) return 1;
    return 0;
}

function _vaultBuildPurchaseMap(account = {}) {
    const map = new Map();
    const add = (item = {}) => {
        const rank = _vaultPurchaseRank(item);
        for (const key of _vaultIdentityKeys(item)) {
            const existing = map.get(key);
            if (!existing || rank > _vaultPurchaseRank(existing)) map.set(key, item);
        }
    };
    for (const item of Array.isArray(account.paidItems) ? account.paidItems : []) add(item);
    for (const item of Array.isArray(account.purchaseHistoryItems) ? account.purchaseHistoryItems : []) {
        if (item.isRefund) continue;
        add(item);
        for (const child of Array.isArray(item.items) ? item.items : []) {
            add({ ...child, amount: item.amount, amountMinor: item.amountMinor, currency: item.currency, status: item.status, isFab: item.isFab, type: item.type });
        }
    }
    return map;
}

function _vaultFindPurchaseForGame(game, purchaseMap, options = {}) {
    for (const key of _vaultIdentityKeys(game)) {
        const item = purchaseMap.get(key);
        if (!item) continue;
        if (options.paidOnly && !_vaultIsPaidGamePurchase(item)) continue;
        return item;
    }
    return null;
}

function _vaultSortCurrencyThenAmount(a, b, direction = 'desc') {
    const ca = String(a.currency || '').toUpperCase();
    const cb = String(b.currency || '').toUpperCase();
    if (ca !== cb) return ca.localeCompare(cb);
    const diff = Number(a.amountMinor || 0) - Number(b.amountMinor || 0);
    return direction === 'asc' ? diff : -diff;
}

function _vaultSafeTitle(value) {
    return String(value || '').trim().toLowerCase();
}

function _vaultCurrentSortBucket(game, account) {
    const view = _vaultGetCurrentPriceView(game, account);
    if (view.status === 'priced') return 0;
    if (view.status === 'free') return 1;
    return 2;
}

function _vaultCurrentAmountMinor(game) {
    const raw = game?.livePrice?.amount;
    const amount = Number(raw);
    return Number.isFinite(amount) ? amount : null;
}

function _vaultCurrentPriceSortTuple(game, account, direction = 'desc') {
    const view = _vaultGetCurrentPriceView(game, account);
    const amount = _vaultCurrentAmountMinor(game);
    const isPositive = view.status === 'priced' && Number.isFinite(amount) && amount > 0;
    const isFree = view.status === 'free' || (view.status === 'priced' && amount === 0);
    const bucket = direction === 'asc'
        ? (isFree ? 0 : (isPositive ? 1 : 2))
        : (isPositive ? 0 : (isFree ? 1 : 2));
    return { bucket, amount: Number.isFinite(amount) ? amount : null, title: String(game?.title || '').toLowerCase(), key: _vaultStableItemKey(game, 'library') };
}

function _vaultCompareCurrentPrices(a, b, account, direction = 'desc') {
    const ta = _vaultCurrentPriceSortTuple(a, account, direction);
    const tb = _vaultCurrentPriceSortTuple(b, account, direction);
    if (ta.bucket !== tb.bucket) return ta.bucket - tb.bucket;
    if (ta.amount !== null && tb.amount !== null && ta.amount !== tb.amount) {
        return direction === 'asc' ? ta.amount - tb.amount : tb.amount - ta.amount;
    }
    const titleDiff = ta.title.localeCompare(tb.title);
    if (titleDiff) return titleDiff;
    return ta.key.localeCompare(tb.key);
}


function _vaultPurchaseGroupKey(item = {}) {
    const currency = String(item.currency || 'USD').toUpperCase();
    const keys = _vaultIdentityKeys(item);
    const primary = _vaultCanonicalGameKey(item) || keys[0] || `title:${_vaultNormalizeTitle(item.title || item.name || item.description || item.orderId || item.stableOrderId)}`;
    return `${currency}:${primary}`;
}

function _vaultComparablePurchaseTitle(value) {
    return _vaultNormalizeTitle(value)
        .replace(/\b(reloaded|reload|remastered|remaster|definitive|complete|ultimate|deluxe|standard|edition|game of the year|goty)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function _vaultScopedKey(namespace, id) {
    const ns = String(namespace || '').trim().toLowerCase();
    const value = String(id || '').trim().toLowerCase();
    return ns && value ? `${ns}:${value}` : '';
}

function _vaultLooseKey(value) {
    return String(value || '').trim().toLowerCase();
}

function _vaultBuildLibraryGameIndex(games = []) {
    const byKey = new Map();
    const byTitle = new Map();
    const byNamespaceOffer = new Map();
    const byNamespaceCatalog = new Map();
    const byOffer = new Map();
    const byCatalog = new Map();
    const byAppName = new Map();
    const add = (map, key, game) => { if (key && !map.has(key)) map.set(key, game); };
    for (const game of Array.isArray(games) ? games : []) {
        for (const key of _vaultIdentityKeys(game)) add(byKey, key, game);
        const namespace = game.namespace || game.sandboxId || game.epicMetadata?.namespace || '';
        add(byNamespaceOffer, _vaultScopedKey(namespace, game.offerId || game.catalogOfferId), game);
        add(byNamespaceCatalog, _vaultScopedKey(namespace, game.catalogItemId || game.catalog_item_id), game);
        add(byOffer, _vaultLooseKey(game.offerId || game.catalogOfferId), game);
        add(byCatalog, _vaultLooseKey(game.catalogItemId || game.catalog_item_id), game);
        add(byAppName, _vaultLooseKey(game.appName || game.app_name), game);
        const title = _vaultNormalizeTitle(game.title || game.name);
        add(byTitle, title, game);
    }
    return { byKey, byTitle, byNamespaceOffer, byNamespaceCatalog, byOffer, byCatalog, byAppName, games: Array.isArray(games) ? games : [] };
}

function _vaultNamespacesCompatible(purchase = {}, game = {}) {
    const purchaseNs = _vaultLooseKey(purchase.namespace || purchase.sandboxId || purchase.epicMetadata?.namespace);
    const gameNs = _vaultLooseKey(game.namespace || game.sandboxId || game.epicMetadata?.namespace);
    return !purchaseNs || !gameNs || purchaseNs === gameNs;
}

function _vaultFindLibraryGameMatchForPurchase(purchase = {}, libraryIndex) {
    if (!purchase || !libraryIndex) return { game: null, type: null };
    const namespace = purchase.namespace || purchase.sandboxId || purchase.epicMetadata?.namespace || '';
    for (const key of _vaultIdentityKeys(purchase)) {
        if (key.startsWith('title:')) continue;
        const game = libraryIndex.byKey?.get?.(key);
        if (game && _vaultNamespacesCompatible(purchase, game)) return { game, type: 'strong_identity' };
    }
    const checks = [
        ['namespace_offer_id', libraryIndex.byNamespaceOffer, _vaultScopedKey(namespace, purchase.offerId || purchase.catalogOfferId)],
        ['namespace_catalog_item_id', libraryIndex.byNamespaceCatalog, _vaultScopedKey(namespace, purchase.catalogItemId || purchase.catalog_item_id)],
        ['offer_id', libraryIndex.byOffer, _vaultLooseKey(purchase.offerId || purchase.catalogOfferId)],
        ['catalog_item_id', libraryIndex.byCatalog, _vaultLooseKey(purchase.catalogItemId || purchase.catalog_item_id)],
    ];
    for (const [type, map, key] of checks) {
        const game = key ? map.get(key) : null;
        if (game && _vaultNamespacesCompatible(purchase, game)) return { game, type };
    }
    const appGame = libraryIndex.byAppName.get(_vaultLooseKey(purchase.appName || purchase.app_name));
    if (appGame && _vaultNamespacesCompatible(purchase, appGame)) return { game: appGame, type: 'app_name' };
    const title = _vaultNormalizeTitle(purchase.title || purchase.name || purchase.description);
    const titleGame = title ? libraryIndex.byTitle.get(title) : null;
    if (titleGame && _vaultNamespacesCompatible(purchase, titleGame)) return { game: titleGame, type: 'exact_title' };
    return { game: null, type: null };
}

function _vaultFindLibraryGameForPurchase(purchase = {}, libraryIndex) {
    return _vaultFindLibraryGameMatchForPurchase(purchase, libraryIndex).game;
}

function _vaultLogUnmatchedPurchaseEnrichment(purchase = {}) {
    const key = `${purchase.currency || ''}:${purchase.orderId || purchase.stableOrderId || purchase.title || ''}:${purchase.amountMinor || ''}`;
    if (__vaultEpicUnmatchedPurchaseLogs.has(key)) return;
    __vaultEpicUnmatchedPurchaseLogs.add(key);
    console.debug?.('[Epic Vault] Purchase card could not be enriched from current library:', {
        title: purchase.title,
        namespace: purchase.namespace,
        offerId: purchase.offerId,
        catalogItemId: purchase.catalogItemId,
        appName: purchase.appName,
        amountMinor: purchase.amountMinor,
    });
}

function _vaultBuildRetainedPurchaseCards(account = {}) {
    const rows = Array.isArray(account.purchaseHistoryItems) && account.purchaseHistoryItems.length
        ? account.purchaseHistoryItems
        : (Array.isArray(account.paidItems) ? account.paidItems : []);
    const groups = new Map();
    for (const item of rows) {
        if (!item || item.isFab === true || _vaultIsCancelledOrFailed(item)) continue;
        const amountMinor = Math.abs(_vaultAmountMinor(item));
        if (amountMinor === 0 && item.isRefund !== true) continue;
        const key = _vaultPurchaseGroupKey(item);
        const current = groups.get(key) || {
            key,
            currency: String(item.currency || account.primaryCurrency || account.currency || 'USD').toUpperCase(),
            netPaidMinor: 0,
            grossPaidMinor: 0,
            refundedMinor: 0,
            purchase: null,
            refunds: [],
            transactions: [],
        };
        current.transactions.push(item);
        if (item.isRefund === true) {
            current.refundedMinor += amountMinor;
            current.netPaidMinor -= amountMinor;
            current.refunds.push(item);
        } else if (_vaultIsPaidGamePurchase(item)) {
            current.grossPaidMinor += amountMinor;
            current.netPaidMinor += amountMinor;
            if (!current.purchase) current.purchase = item;
        }
        groups.set(key, current);
    }
    const libraryIndex = _vaultBuildLibraryGameIndex(account.games);
    const cards = [];
    for (const group of groups.values()) {
        if (!group.purchase || group.netPaidMinor <= 0) continue;
        const purchase = group.purchase;
        const match = _vaultFindLibraryGameMatchForPurchase(purchase, libraryIndex);
        const matchedGame = match.game;
        if (!matchedGame) _vaultLogUnmatchedPurchaseEnrichment(purchase);
        cards.push({
            ...(matchedGame || {}),
            title: purchase.title || purchase.name || matchedGame?.title || 'Epic purchase',
            namespace: purchase.namespace || matchedGame?.namespace || null,
            offerId: purchase.offerId || matchedGame?.offerId || null,
            catalogItemId: purchase.catalogItemId || matchedGame?.catalogItemId || null,
            appName: purchase.appName || matchedGame?.appName || null,
            coverUrl: purchase.coverUrl || matchedGame?.coverUrl || null,
            coverCandidates: Array.isArray(purchase.coverCandidates) && purchase.coverCandidates.length ? purchase.coverCandidates : (Array.isArray(matchedGame?.coverCandidates) ? matchedGame.coverCandidates : []),
            artworkSource: purchase.artworkSource || (matchedGame ? 'legendary_metadata' : 'fallback'),
            orderId: purchase.orderId || null,
            stableOrderId: purchase.stableOrderId || null,
            purchaseDate: purchase.date || null,
            currency: group.currency,
            netPaidMinor: group.netPaidMinor,
            grossPaidMinor: group.grossPaidMinor,
            refundedMinor: group.refundedMinor,
            __vaultPurchase: { ...purchase, amountMinor: group.netPaidMinor, amount: group.netPaidMinor / 100, currency: group.currency },
            __vaultMatchedGame: matchedGame || null,
            __vaultMatchType: match.type,
        });
    }
    return cards;
}

function _vaultRepresentedPurchaseTotal(cards = []) {
    const byCurrency = {};
    for (const card of cards) {
        const currency = String(card.currency || card.__vaultPurchase?.currency || 'USD').toUpperCase();
        byCurrency[currency] = (byCurrency[currency] || 0) + Number(card.netPaidMinor || _vaultAmountMinor(card.__vaultPurchase) || 0);
    }
    return byCurrency;
}

function _vaultIsLocalCoverUrl(url = '') {
    return /^(file:|app:|baddel-cache:|\.\.?\/|[a-z]:\\)/i.test(String(url || '').trim());
}

function _vaultPushCoverCandidatesFromObject(push, source, prefix = 'game') {
    if (!source || typeof source !== 'object') return;
    for (const candidate of Array.isArray(source.coverCandidates) ? source.coverCandidates : []) {
        push(candidate?.url || candidate, candidate?.source || `${prefix}_candidate`);
    }
    push(source.image, `${prefix}_image`);
    push(source.defaultImage, `${prefix}_defaultImage`);
    push(source.cover, `${prefix}_cover`);
    push(source.coverUrl, `${prefix}_coverUrl`);
    push(source.posterImage, `${prefix}_posterImage`);
    push(source.heroImage, `${prefix}_heroImage`);
    push(source.livePrice?.image, `${prefix}_livePrice`);
}

function _vaultArtworkSubject(game = {}, account = null) {
    return {
        ...(game || {}),
        platform: 'epic',
        scannerPlatform: 'epic',
        accountId: game.accountId || account?.accountId || game.ownerAccountId || null,
        ownerAccountIds: game.ownerAccountIds || (account?.accountId ? [account.accountId] : undefined),
    };
}

function _vaultArtworkKey(game = {}, account = null) {
    const subject = _vaultArtworkSubject(game, account);
    if (typeof _agArtworkKey === 'function') {
        try { return _agArtworkKey(subject); } catch {}
    }
    return _vaultCanonicalGameKey(subject) || _vaultCoverKey(subject);
}

function _vaultLegacyArtworkAliasKeys(entry = {}) {
    const aliases = [];
    const pushTitle = (value) => {
        const title = String(value || '').trim();
        if (!title) return;
        const safeTitle = title.replace(/[^a-zA-Z0-9._:-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 180);
        if (safeTitle) { aliases.push(safeTitle); aliases.push(`${safeTitle}:cover`); }
    };
    pushTitle(entry.title || entry.name || entry.description);
    pushTitle(entry.__vaultPurchase?.title || entry.__vaultPurchase?.name);
    return aliases.filter(Boolean);
}
function _vaultArtworkAliasesForGame(game = {}, account = null) {
    const subject = _vaultArtworkSubject(game, account);
    const aliases = new Set();
    if (window.BaddelGameArtworkReadModel?.resolveArtworkCacheKeys) {
        try {
            window.BaddelGameArtworkReadModel.resolveArtworkCacheKeys(subject, subject)
                .forEach((key) => aliases.add(String(key)));
        } catch {}
    }
    if (typeof _agArtworkAliasesForGame === 'function') {
        try { _agArtworkAliasesForGame(subject).forEach((key) => aliases.add(String(key))); } catch {}
    }
    for (const key of [_vaultArtworkKey(subject, account), _vaultCanonicalGameKey(subject), _vaultCoverKey(subject), ..._vaultIdentityKeys(subject)]) {
        if (key) aliases.add(String(key));
    }
    // Compatibility only: allows the shared bulk resolver to atomically migrate old title-based aliases.
    for (const key of _vaultLegacyArtworkAliasKeys(subject)) {
        if (key) aliases.add(String(key));
    }
    return Array.from(aliases).filter(Boolean);
}

function _vaultLocalCoverFromCandidates(game = {}, account = null) {
    const candidates = _vaultCoverCandidatesForGame(game, account);
    return candidates.find((candidate) => _vaultIsLocalCoverUrl(candidate?.url || candidate))?.url || null;
}

function _vaultArtworkRecord(game = {}, account = null, create = true) {
    const key = _vaultArtworkKey(game, account);
    if (!key) return null;
    let record = __vaultEpicArtworkRegistry.get(key);
    if (!record && create) {
        record = { key, aliases: _vaultArtworkAliasesForGame(game, account), localUrl: null, status: 'unknown', updatedAt: Date.now() };
        __vaultEpicArtworkRegistry.set(key, record);
    }
    if (record) {
        record.aliases = Array.from(new Set([...(record.aliases || []), ..._vaultArtworkAliasesForGame(game, account)]));
        const local = _vaultLocalCoverFromCandidates(game, account);
        if (local) {
            record.localUrl = local;
            record.status = 'ready';
        }
    }
    return record;
}

function _vaultResolveLocalCover(game = {}, account = null) {
    const record = _vaultArtworkRecord(game, account, true);
    if (record?.localUrl && _vaultIsLocalCoverUrl(record.localUrl)) return record.localUrl;
    return null;
}

function _vaultQueueMissingCoverWarm(games = [], accountOrContext = null, reason = 'epic-vault-cover-warm') {
    if (!window.electronAPI?.boostColdCoverBootstrap) return 0;
    const context = accountOrContext?.artworkIndex ? accountOrContext : null;
    const account = context?.account || accountOrContext || _vaultSelectedEpicAccount();
    const targets = [];
    const seen = new Set();
    for (const game of Array.isArray(games) ? games : []) {
        const record = _vaultArtworkRecord(game, context || account, true);
        if (!record || record.localUrl) continue;
        const remoteCandidates = _vaultCoverCandidatesForGame(game, context || account)
            .map((candidate) => candidate?.url || candidate)
            .filter((url) => url && !_vaultIsLocalCoverUrl(url));
        if (seen.has(record.key)) continue;
        seen.add(record.key);
        targets.push({
            ...game,
            platform: game.platform || 'epic',
            coverCandidates: remoteCandidates,
            coverUrl: remoteCandidates[0] || null,
        });
    }
    if (!targets.length) return 0;
    const priority = String(reason).includes('visible') ? 'visible' : 'prefetch';
    window.electronAPI.boostColdCoverBootstrap(targets, { priority, reason }).catch?.(() => {});
    return targets.length;
}
async function _vaultPrimeLocalCovers(games = [], account = null) {
    if (!window.electronAPI?.getCachedImagesBulk) return 0;
    const identities = [];
    const seen = new Set();
    for (const game of Array.isArray(games) ? games : []) {
        const record = _vaultArtworkRecord(game, account, true);
        if (!record || record.localUrl) continue;
        const key = record.key;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        identities.push({ key, ids: record.aliases || [key] });
    }
    if (!identities.length) return 0;
    const signature = identities.map((item) => `${item.key}:${(item.ids || []).join(',')}`).sort().join('|');
    if (__vaultEpicArtworkLookupInflight.has(signature)) return __vaultEpicArtworkLookupInflight.get(signature);
    const job = window.electronAPI.getCachedImagesBulk(identities, 'cover')
        .then((response) => {
            const results = response?.images || response?.results || response?.items || response || {};
            let patched = 0;
            for (const identity of identities) {
                const result = results[identity.key] || (identity.ids || []).map((id) => results[id]).find(Boolean);
                const fileUrl = typeof result === 'string' ? result : (result?.fileUrl || result?.localUrl || result?.url || null);
                if (!fileUrl || !_vaultIsLocalCoverUrl(fileUrl)) continue;
                const record = __vaultEpicArtworkRegistry.get(identity.key) || { key: identity.key, aliases: identity.ids };
                record.localUrl = fileUrl;
                record.status = 'ready';
                record.updatedAt = Date.now();
                __vaultEpicArtworkRegistry.set(identity.key, record);
                patched += _vaultPatchMountedCover(identity.key, fileUrl);
            }
            return patched;
        })
        .catch(() => 0)
        .finally(() => { __vaultEpicArtworkLookupInflight.delete(signature); });
    __vaultEpicArtworkLookupInflight.set(signature, job);
    return job;
}

function _vaultIsManagedArtworkCacheUrl(url) {
    const value = String(url || '').trim();
    if (!value.startsWith('file://')) return false;
    return /[\\/]artwork-cache-v2[\\/]/i.test(value)
        || /artwork-cache-v2%5c/i.test(value)
        || /artwork-cache-v2\//i.test(value);
}

function _vaultIsGridThumbnailUrl(url) {
    const value = String(url || '');
    return /[\\/]artwork-grid-cache-v1[\\/]160x240[\\/]/i.test(value)
        || /artwork-grid-cache-v1%5c160x240%5c/i.test(value);
}

function _vaultGridDisplayCover(localUrl) {
    const source = String(localUrl || '');
    return window.__agGridThumbnailByCover instanceof Map
        ? (window.__agGridThumbnailByCover.get(source) || source)
        : source;
}

function _vaultAwaitArtworkBoundary(promise, timeoutMs = 1800) {
    let timer = null;
    return Promise.race([
        Promise.resolve(promise).catch(() => 0),
        new Promise((resolve) => { timer = setTimeout(() => resolve(0), timeoutMs); }),
    ]).finally(() => { if (timer) clearTimeout(timer); });
}

function _vaultAcceptGridThumbnails(response) {
    window.__agGridThumbnailByCover = window.__agGridThumbnailByCover instanceof Map
        ? window.__agGridThumbnailByCover
        : new Map();
    let accepted = 0;
    for (const [sourceUrl, thumbnailUrl] of Object.entries(response?.images || {})) {
        if (!_vaultIsManagedArtworkCacheUrl(sourceUrl) || !_vaultIsGridThumbnailUrl(thumbnailUrl)) continue;
        window.__agGridThumbnailByCover.set(sourceUrl, thumbnailUrl);
        window.__agVerifiedArtworkUrls?.add?.(thumbnailUrl);
        accepted += 1;
    }
    return accepted;
}

async function _vaultLoadExistingGridThumbnails(games = [], accountOrContext = null, { limit = 48, createMissing = false } = {}) {
    if (!window.electronAPI?.getGridArtworkThumbnails) return 0;
    window.__agGridThumbnailByCover = window.__agGridThumbnailByCover instanceof Map
        ? window.__agGridThumbnailByCover
        : new Map();
    const urls = [...new Set((Array.isArray(games) ? games : [])
        .slice(0, Math.max(0, Number(limit) || 0))
        .map((game) => _vaultResolveLocalCover(game, accountOrContext))
        .filter((url) => _vaultIsManagedArtworkCacheUrl(url) && !window.__agGridThumbnailByCover.has(String(url)))
        .map(String))];
    if (!urls.length) return 0;
    const response = await window.electronAPI.getGridArtworkThumbnails(urls, { createMissing }).catch(() => null);
    return _vaultAcceptGridThumbnails(response);
}

function _vaultScheduleArtworkWarm(games = [], accountOrContext = null, reason = 'epic-vault-background-artwork') {
    const remaining = (Array.isArray(games) ? games : []).slice(48);
    if (!remaining.length) return;
    const accountId = accountOrContext?.account?.accountId || accountOrContext?.accountId || '';
    const signature = [reason, accountId, remaining.length, _vaultCoverKey(remaining[0]), _vaultCoverKey(remaining[remaining.length - 1])].join('|');
    if (__vaultArtworkWarmSignatures.has(signature)) return;
    __vaultArtworkWarmSignatures.add(signature);
    if (__vaultArtworkWarmSignatures.size > 24) __vaultArtworkWarmSignatures.delete(__vaultArtworkWarmSignatures.values().next().value);
    const run = async () => {
        for (let offset = 0; offset < remaining.length; offset += 64) {
            const chunk = remaining.slice(offset, offset + 64);
            await _vaultPrimeLocalCovers(chunk, accountOrContext);
            await _vaultLoadExistingGridThumbnails(chunk, accountOrContext, { limit: chunk.length, createMissing: true });
            const active = __vaultEpicSection === 'history' ? __vaultHistoryVirtual.controller : __vaultLibraryVirtual.controller;
            active?.render?.(true, true);
        }
        _vaultQueueMissingCoverWarm(remaining, accountOrContext, reason);
    };
    if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(() => { run().catch(() => {}); }, { timeout: 1200 });
    } else {
        setTimeout(() => { run().catch(() => {}); }, 120);
    }
}

function _vaultPatchMountedCover(key, localUrl) {
    if (!key || !localUrl) return 0;
    localUrl = _vaultGridDisplayCover(localUrl);
    const patchLibrary = (card) => {
        const imgWrap = card.querySelector?.('.vault-epic-card-artwork');
        if (!imgWrap) return;
        let slot = imgWrap.querySelector?.('[data-vault-cover-slot]');
        if (!slot) {
            slot = document.createElement('div');
            slot.dataset.vaultCoverSlot = '';
            imgWrap.prepend(slot);
        }
        let img = slot.querySelector?.('.vault-epic-cover-img');
        if (!img) {
            slot.innerHTML = `<img class="vault-epic-cover-img" alt="" loading="lazy" decoding="async" data-cover-key="${_vaultHtml(key)}">`;
            img = slot.querySelector('.vault-epic-cover-img');
        }
        if (img && img.getAttribute('src') !== localUrl) img.setAttribute('src', localUrl);
    };
    const patchHistory = (row) => {
        const wrap = row.querySelector?.('.vault-history-cover');
        if (!wrap) return;
        let img = wrap.querySelector?.('.vault-history-cover-img');
        if (!img) {
            wrap.innerHTML = '<img class="vault-history-cover-img" alt="" loading="lazy" decoding="async">';
            img = wrap.querySelector('.vault-history-cover-img');
        }
        if (img && img.getAttribute('src') !== localUrl) img.setAttribute('src', localUrl);
    };
    let count = 0;
    const vs = __vaultLibraryVirtual;
    if (vs.controller?.patch) count += vs.controller.patch((card) => card.dataset.vaultArtworkKey === key, patchLibrary);
    else {
        for (const card of vs.rowPool?.values?.() || []) {
            if (card.dataset?.vaultArtworkKey === key) { patchLibrary(card); count += 1; }
        }
    }
    for (const row of __vaultHistoryVirtual.rowPool?.values?.() || []) {
        if (row.dataset?.vaultArtworkKey === key) { patchHistory(row); count += 1; }
    }
    return count;
}function _vaultAllGamesArtworkPools(account = null) {
    return [window._allGamesCache, window._allGamesRawCache, window.allGamesData, account?.games]
        .filter(Array.isArray);
}

function _vaultArrayGenerationId(array) {
    if (!array || typeof array !== 'object') return 'none';
    if (!__vaultArtworkArrayIds.has(array)) __vaultArtworkArrayIds.set(array, __vaultArtworkArraySeq++);
    return __vaultArtworkArrayIds.get(array);
}

function _vaultArtworkIndexSignature(account = null) {
    return _vaultAllGamesArtworkPools(account)
        .map((array) => `${_vaultArrayGenerationId(array)}:${array.length}`)
        .join('|');
}

function _vaultBuildArtworkIndex(account = null) {
    const signature = _vaultArtworkIndexSignature(account);
    if (__vaultArtworkIndexCache?.signature === signature) return __vaultArtworkIndexCache.index;
    const byStrongKey = new Map();
    const byExactTitle = new Map();
    const byComparableTitle = new Map();
    const pools = _vaultAllGamesArtworkPools(account);
    for (const pool of pools) {
        for (const candidate of pool) {
            if (!candidate || typeof candidate !== 'object') continue;
            for (const key of _vaultIdentityKeys(candidate)) {
                if (key.startsWith('title:')) continue;
                if (!byStrongKey.has(key)) byStrongKey.set(key, candidate);
            }
            const title = _vaultNormalizeTitle(candidate.title || candidate.name || candidate.description);
            if (title && !byExactTitle.has(title)) byExactTitle.set(title, candidate);
            const comparable = _vaultComparablePurchaseTitle(title);
            if (comparable && !byComparableTitle.has(comparable)) byComparableTitle.set(comparable, candidate);
        }
    }
    const index = { byStrongKey, byExactTitle, byComparableTitle, signature, poolsCount: pools.length };
    __vaultArtworkIndexCache = { signature, index };
    return index;
}

function _vaultCreateEpicRenderContext(account = null) {
    const libraryGames = _vaultDedupeLibraryGames(account?.games);
    const libraryIndex = _vaultBuildLibraryGameIndex(libraryGames);
    return {
        account,
        libraryGames,
        libraryIndex,
        artworkIndex: _vaultBuildArtworkIndex(account),
        artworkLookupCache: new Map(),
        coverCandidateCache: new Map(),
        historyArtworkCache: new Map(),
        warmTargets: [],
    };
}

function _vaultHistoryArtworkLookupKey(item = {}) {
    return String(_vaultHistoryStableId(item) || _vaultCoverKey(item) || JSON.stringify(_vaultIdentityKeys(item))).trim();
}

function _vaultHistoryArtworkSubject(item = {}, accountOrContext = null) {
    const context = accountOrContext?.libraryIndex ? accountOrContext : null;
    const account = context?.account || accountOrContext || _vaultSelectedEpicAccount();
    const lookupKey = _vaultHistoryArtworkLookupKey(item);
    if (context?.historyArtworkCache?.has(lookupKey)) return context.historyArtworkCache.get(lookupKey);
    const libraryIndex = context?.libraryIndex || _vaultBuildLibraryGameIndex(_vaultDedupeLibraryGames(account?.games));
    const match = _vaultFindLibraryGameMatchForPurchase(item, libraryIndex);
    const matchedGame = match?.game || null;
    const seed = { ...(matchedGame || {}), ...item, __vaultPurchase: item, __vaultMatchedGame: matchedGame };
    const allGamesArtwork = _vaultFindAllGamesArtworkForEpic(seed, context || account);
    const logicalGame = allGamesArtwork || matchedGame || null;
    const subject = logicalGame
        ? { ...logicalGame, __vaultPurchase: item, __vaultMatchedGame: matchedGame || logicalGame, __vaultMatchType: match?.type || 'artwork_index' }
        : { ...item, __vaultPurchase: item };
    if (context?.historyArtworkCache) context.historyArtworkCache.set(lookupKey, subject);
    return subject;
}

function _vaultFindAllGamesArtworkForEpic(game = {}, accountOrContext = null) {
    if (!game || typeof game !== 'object') return null;
    const context = accountOrContext?.artworkIndex ? accountOrContext : null;
    const account = context?.account || accountOrContext || null;
    const index = context?.artworkIndex || _vaultBuildArtworkIndex(account);
    const lookupKey = _vaultCoverKey(game) || JSON.stringify(_vaultIdentityKeys(game));
    if (context?.artworkLookupCache?.has(lookupKey)) return context.artworkLookupCache.get(lookupKey);

    const purchase = game.__vaultPurchase || {};
    const sources = [game, game.__vaultMatchedGame, purchase].filter(Boolean);
    for (const source of sources) {
        for (const key of _vaultIdentityKeys(source)) {
            if (key.startsWith('title:')) continue;
            const match = index.byStrongKey.get(key);
            if (match) {
                context?.artworkLookupCache?.set(lookupKey, match);
                return match;
            }
        }
    }

    for (const source of sources) {
        const title = _vaultNormalizeTitle(source.title || source.name || source.description);
        if (title && index.byExactTitle.has(title)) {
            const match = index.byExactTitle.get(title);
            context?.artworkLookupCache?.set(lookupKey, match);
            return match;
        }
        const comparable = _vaultComparablePurchaseTitle(title);
        if (comparable && index.byComparableTitle.has(comparable)) {
            const match = index.byComparableTitle.get(comparable);
            context?.artworkLookupCache?.set(lookupKey, match);
            return match;
        }
    }

    context?.artworkLookupCache?.set(lookupKey, null);
    return null;
}

function _vaultResolveCanonicalAllGamesCover(game = {}) {
    const resolver = typeof window._agResolveAllGamesCoverDecision === 'function'
        ? window._agResolveAllGamesCoverDecision
        : null;
    if (resolver) {
        try {
            const decision = resolver(game);
            if (decision?.value) return { url: decision.value, source: `allgames_${decision.source || 'resolver'}` };
        } catch {}
    }
    const adapter = window.BaddelAllGamesArtworkAdapter;
    if (adapter && typeof adapter.resolveAllGamesArtwork === 'function') {
        try {
            const decision = adapter.resolveAllGamesArtwork({ game });
            if (decision?.value) return { url: decision.value, source: `allgames_${decision.source || 'adapter'}` };
        } catch {}
    }
    return null;
}

function _vaultScheduleIdle(fn, timeout = 180) {
    if (typeof requestIdleCallback === 'function') return requestIdleCallback(fn, { timeout });
    return setTimeout(fn, timeout);
}

function _vaultHasLocalCoverCandidate(game = {}, account = null) {
    return _vaultCoverCandidatesForGame(game, account).some((candidate) => _vaultIsLocalCoverUrl(candidate?.url || candidate));
}

function _vaultQueueAllGamesCoverWarm() {
    return 0;
}
function _vaultCoverCandidatesForGame(game = {}, account = null) {
    const context = account?.artworkIndex ? account : null;
    const accountRef = context?.account || account || null;
    const cacheKey = context ? (_vaultCoverKey(game) || JSON.stringify(_vaultIdentityKeys(game))) : null;
    if (context && context.coverCandidateCache.has(cacheKey)) return context.coverCandidateCache.get(cacheKey);
    const raw = [];
    const push = (url, source) => {
        const value = String(url || '').trim();
        if (!value || raw.some((item) => item.url === value)) return;
        raw.push({ url: value, source });
    };
    const coverKey = _vaultCoverKey(game);
    if (coverKey && __vaultEpicCoverRuntimePrefs.has(coverKey)) push(__vaultEpicCoverRuntimePrefs.get(coverKey), 'runtime_success');
    _vaultPushCoverCandidatesFromObject(push, game.__vaultPurchase, 'purchase');
    _vaultPushCoverCandidatesFromObject(push, game, 'game');
    _vaultPushCoverCandidatesFromObject(push, game.__vaultMatchedGame, 'matched');
    const allGamesArtwork = _vaultFindAllGamesArtworkForEpic(game, context || accountRef);
    const canonical = _vaultResolveCanonicalAllGamesCover(allGamesArtwork || game.__vaultMatchedGame || game);
    if (canonical) push(canonical.url, canonical.source);
    _vaultPushCoverCandidatesFromObject(push, allGamesArtwork, 'allgames');
    const ordered = raw;
    if (context) context.coverCandidateCache.set(cacheKey, ordered);
    if (context && !ordered.length) context.warmTargets.push(allGamesArtwork || game.__vaultMatchedGame || game);
    return ordered;
}

function _vaultCoverKey(game = {}) {
    return String(game.id || game.appName || game.offerId || game.catalogItemId || game.orderId || game.stableOrderId || game.title || '').trim();
}

function _vaultEncodeCoverCandidates(candidates = []) {
    try { return encodeURIComponent(JSON.stringify(candidates.map((item) => item.url || item).filter(Boolean))); }
    catch { return '%5B%5D'; }
}

function _vaultEpicCoverPlaceholder(title = '') {
    const initial = String(title || 'Epic').trim().slice(0, 1).toUpperCase() || 'E';
    return `<div class="vault-epic-cover-fallback"><span>${_vaultHtml(initial)}</span></div>`;
}

function _vaultRenderEpicCover(game = {}, account = null) {
    const localUrl = _vaultGridDisplayCover(_vaultResolveLocalCover(game, account));
    const coverKey = _vaultHtml(_vaultArtworkKey(game, account) || _vaultCoverKey(game));
    if (!localUrl) return _vaultEpicCoverPlaceholder(game.title);
    return `<img class="vault-epic-cover-img" src="${_vaultHtml(localUrl)}" alt="" loading="lazy" decoding="async" data-cover-key="${coverKey}" onload="markVaultEpicCoverLoaded(this)" onerror="handleVaultEpicCoverError(this)">`;
}

function markVaultEpicCoverLoaded(img) {
    const key = String(img?.dataset?.coverKey || '').trim();
    const src = img?.getAttribute?.('src') || img?.src || '';
    if (key && _vaultIsLocalCoverUrl(src)) __vaultEpicCoverRuntimePrefs.set(key, src);
}

function handleVaultEpicCoverError(img) {
    if (!img || !img.dataset) return;
    const key = img.dataset.coverKey || '';
    if (key) {
        const record = __vaultEpicArtworkRegistry.get(key);
        if (record) {
            record.status = 'error';
            record.lastError = 'renderer_img_error';
        }
    }
    img.outerHTML = _vaultEpicCoverPlaceholder(img.closest?.('.vault-epic-cover-card')?.querySelector?.('.ag-card-display-title')?.textContent || 'Epic');
}
function _vaultGetCurrentPriceView(game, account) {
    const price = game?.livePrice || null;
    const status = game?.priceStatus || price?.priceStatus || (price?.priceResolved ? (Number(price.amount || 0) === 0 ? 'free' : 'priced') : 'unavailable');
    if (status === 'free') return { label: 'FREE', status: 'free', discount: null, original: null };
    if (status === 'priced' && price) {
        const currency = price.currency || account?.currency || 'USD';
        return {
            label: _vaultMinorMoney(price.amount || 0, currency),
            status: 'priced',
            discount: price.isDiscounted && Number(price.discountPercent || 0) > 0 ? `-${price.discountPercent}%` : null,
            original: price.isDiscounted && Number(price.originalAmount || 0) > Number(price.amount || 0) ? _vaultMinorMoney(price.originalAmount, currency) : null,
        };
    }
    if (status === 'not_for_sale' || status === 'unavailable') return { label: 'Price unavailable', status, discount: null, original: null };
    return { label: 'Price unavailable', status: 'unresolved', discount: null, original: null };
}

function _vaultGetPurchasePriceView(game, account, purchaseMap) {
    const item = game?.__vaultPurchase || _vaultFindPurchaseForGame(game, purchaseMap, { paidOnly: true });
    if (!item) return { label: 'No paid purchase', status: 'unresolved', discount: null, original: null };
    const amountMinor = Number(game?.netPaidMinor || _vaultAmountMinor(item));
    const currency = game?.currency || item.currency || account.currency || 'USD';
    return { label: _vaultMinorMoney(amountMinor, currency), status: 'priced', discount: null, original: null, amountMinor, currency };
}

function _vaultEpicCoverage(account = {}) {
    if (window.VaultShowcaseModel?.buildAccountMetrics) {
        return window.VaultShowcaseModel.buildAccountMetrics(account);
    }
    const games = _vaultDedupeLibraryGames(account.games);
    let currentValueMinor = 0;
    let pricedGames = 0;
    let freeGames = 0;
    let unavailableGames = 0;
    for (const game of games) {
        const view = _vaultGetCurrentPriceView(game, account);
        if (view.status === 'priced') {
            pricedGames += 1;
            currentValueMinor += Number(game.livePrice?.amount || 0);
        } else if (view.status === 'free') {
            freeGames += 1;
        } else if (view.status === 'not_for_sale' || view.status === 'unavailable') {
            unavailableGames += 1;
        }
    }
    return {
        totalGames: games.length,
        pricedGames,
        freeGames,
        unavailableGames,
        resolvedGames: pricedGames + freeGames + unavailableGames,
        unresolvedGames: Math.max(0, games.length - pricedGames - freeGames - unavailableGames),
        currentValueMinor,
        currency: account.livePrices?.[0]?.currency || account.currency || 'USD',
    };
}

function _vaultActualSpentLabel(account = {}) {
    if (account.permissions?.purchaseHistory !== true) return 'Not imported';
    return _vaultSpendLabel(account, 'netSpentMinor');
}


function _vaultSetConsoleIntro(label, title, text) {
    const labelEl = document.getElementById('vaultConsoleLabel');
    const titleEl = document.getElementById('vaultConsoleTitle');
    const textEl = document.getElementById('vaultConsoleText');
    const headerKicker = document.getElementById('vaultHeaderKicker');
    const headerTitle = document.getElementById('vaultHeaderTitle');
    const headerText = document.getElementById('vaultHeaderText');
    const topBack = document.getElementById('vaultTopBack');
    if (labelEl) labelEl.textContent = label;
    if (titleEl) titleEl.textContent = title;
    if (textEl) textEl.textContent = text;
    if (headerKicker) headerKicker.textContent = label || 'Vault';
    if (headerTitle) headerTitle.textContent = title || 'Baddel Vault';
    if (headerText) headerText.textContent = text || '';
    if (topBack) topBack.style.display = __vaultState === 'overview' ? 'none' : 'inline-flex';
}

function _vaultOverviewModel() {
    const api = window.VaultOverviewModel;
    if (!api?.buildVaultOverviewModel) {
        return { totalGames: 0, accountCount: 0, platformCount: 0, libraryValue: { buckets: {}, status: 'unavailable', resolvedItems: 0, totalItems: 0 }, realSpent: { buckets: {}, status: 'not_requested', resolvedItems: 0, totalItems: 0 }, platforms: [] };
    }
    return api.buildVaultOverviewModel({ epicVault: __vaultEpicDataCache || { accounts: [] }, epicProgressStates: __vaultEpicProgressStates });
}

function _vaultOverviewCurrencyHtml(summary = {}, emptyLabel = 'Not available') {
    const locale = typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en-US';
    const lines = window.VaultOverviewModel?.formatVaultCurrencyBuckets?.(summary, locale) || [];
    if (!lines.length) return '<span class="is-muted">' + _vaultHtml(emptyLabel) + '</span>';
    return lines.map((line) => '<span>' + _vaultHtml(line.text) + '</span>').join('');
}

function _vaultOverviewPriceCoverage(summary = {}) {
    const resolved = Number(summary.resolvedItems || 0);
    const total = Number(summary.totalItems || 0);
    if (summary.status === 'loading') return 'Calculating prices...';
    if (summary.status === 'not_requested') return total ? 'Prices not requested' : 'No games to value';
    if (summary.status === 'unavailable') return total ? 'Prices unavailable' : 'No games to value';
    if (summary.status === 'partial') return resolved + ' of ' + total + ' prices resolved';
    return total + ' of ' + total + ' prices resolved';
}

function _vaultOverviewHistoryLabel(summary = {}) {
    if (summary.status === 'loading') return 'Importing history...';
    if (summary.status === 'not_requested') return 'History not imported';
    if (summary.status === 'unavailable') return 'History unavailable';
    if (summary.status === 'partial') return 'Known totals shown; some accounts need attention';
    return 'Net purchases after refunds';
}

function _vaultOverviewStatusHtml(model) {
    if (__vaultOverviewError) {
        const hasLastGood = Boolean(__vaultEpicDataCache);
        const title = hasLastGood ? 'Saved Vault data is still shown' : 'Vault data could not be loaded';
        const code = __vaultOverviewError.code || 'VAULT_LOAD_FAILED';
        const message = __vaultOverviewError.message || 'The saved Vault snapshot could not be read.';
        return '<div class="vault-overview-notice is-warning"><span><strong>' + _vaultHtml(title) + '</strong><small>' + _vaultHtml(message) + ' [' + _vaultHtml(code) + ']</small></span><button type="button" onclick="retryVaultOverviewHydration()">Retry</button></div>';
    }
    if (!__vaultEpicDataCache) {
        return '<div class="vault-overview-notice"><span><strong>Reading your Vault</strong><small>Loading the latest saved account snapshot.</small></span></div>';
    }
    if (!model.accountCount) {
        return '<div class="vault-overview-notice"><span><strong>No Epic accounts connected</strong><small>Connect and sync Epic to add factual library and spending totals.</small></span><button type="button" onclick="openPlatformsModal()">Connect Epic</button></div>';
    }
    const enriching = [model.libraryValue.status, model.realSpent.status].some((status) => status === 'loading' || status === 'partial');
    if (enriching) {
        return '<div class="vault-overview-notice"><span><strong>Your library is ready</strong><small>Known totals are shown while optional prices or history continue updating.</small></span></div>';
    }
    return '';
}

function _vaultOverviewSetText(id, value) {
    const node = document.getElementById(id);
    const text = String(value ?? '');
    if (node && node.textContent !== text) node.textContent = text;
}

function _renderVaultOverview() {
    _vaultClearVirtualRows(__vaultLibraryVirtual);
    _vaultClearVirtualRows(__vaultHistoryVirtual);
    _setVaultState('overview', null);
    __vaultSelectedEpicAccountId = null;
    document.querySelectorAll('.vault-platform-card.active').forEach(el => el.classList.remove('active'));
    _vaultSetConsoleIntro('Vault overview', 'Baddel Vault', 'A clear view of your connected accounts, owned games, library value, and real spending.');
    const panel = document.getElementById('vaultOverviewPanel');
    const consolePanel = document.getElementById('vaultConsole');
    if (panel) panel.style.display = 'block';
    if (consolePanel) consolePanel.style.display = 'none';
    const box = document.getElementById('vaultEpicLibrary');
    if (box) { box.style.display = 'none'; box.innerHTML = ''; }

    const model = _vaultOverviewModel();
    const epic = model.platforms.find((platform) => platform.platform === 'epic') || { accountCount: 0, totalGames: 0, covers: [], libraryValue: {}, realSpent: {} };
    _vaultOverviewSetText('vaultOverviewTotalGames', model.totalGames);
    _vaultOverviewSetText('vaultOverviewGamesNote', model.accountCount ? 'Counted per owning account' : 'Across connected accounts');
    _vaultOverviewSetText('vaultOverviewAccountsPlatforms', model.accountCount + ' / ' + model.platformCount);
    const libraryValue = document.getElementById('vaultOverviewLibraryValue');
    const realSpent = document.getElementById('vaultOverviewRealSpent');
    if (libraryValue) libraryValue.innerHTML = _vaultOverviewCurrencyHtml(model.libraryValue, model.libraryValue.status === 'loading' ? 'Calculating' : 'Not available');
    if (realSpent) realSpent.innerHTML = _vaultOverviewCurrencyHtml(model.realSpent, model.realSpent.status === 'loading' ? 'Importing history...' : (model.realSpent.status === 'not_requested' ? 'History not imported' : 'Not available'));
    _vaultOverviewSetText('vaultOverviewLibraryCoverage', _vaultOverviewPriceCoverage(model.libraryValue));
    _vaultOverviewSetText('vaultOverviewHistoryStatus', _vaultOverviewHistoryLabel(model.realSpent));
    _vaultOverviewSetText('vaultEpicCardConnection', epic.connected ? 'Connected and synced' : 'Not connected');
    _vaultOverviewSetText('vaultEpicCardBadge', epic.accountCount + ' ' + (epic.accountCount === 1 ? 'account' : 'accounts'));
    _vaultOverviewSetText('vaultEpicCardGames', epic.totalGames);
    const epicValueLines = window.VaultOverviewModel?.formatVaultCurrencyBuckets?.(epic.libraryValue || {}) || [];
    const epicSpentLines = window.VaultOverviewModel?.formatVaultCurrencyBuckets?.(epic.realSpent || {}) || [];
    _vaultOverviewSetText('vaultEpicCardValue', epicValueLines.map((line) => line.text).join(' · ') || (epic.libraryValue?.status === 'loading' ? 'Calculating' : 'Not available'));
    _vaultOverviewSetText('vaultEpicCardSpent', epicSpentLines.map((line) => line.text).join(' · ') || (epic.realSpent?.status === 'loading' ? 'Importing' : 'Not imported'));
    const epicCard = document.getElementById('vault-card-epic');
    if (epicCard) {
        if (epic.connected === true) epicCard.classList.add('is-connected');
        else epicCard.classList.remove('is-connected');
    }
    const status = document.getElementById('vaultOverviewStatus');
    if (status) status.innerHTML = _vaultOverviewStatusHtml(model);
    const updatedAt = model.generatedAt ? new Date(model.generatedAt) : null;
    _vaultOverviewSetText('vaultOverviewUpdatedAt', updatedAt && !Number.isNaN(updatedAt.getTime()) ? 'Updated ' + updatedAt.toLocaleString() : 'Saved data');
}

function _renderVaultPlatformPlaceholder(platform) {
    if (platform !== 'epic') return _renderVaultOverview();
}

function _vaultEpicProgressState(accountId) {
    return __vaultEpicProgressStates?.[String(accountId)] || null;
}

function _vaultEpicAccountById(accountId) {
    const cache = typeof __vaultEpicDataCache === 'undefined' ? null : __vaultEpicDataCache;
    return (cache?.accounts || []).find((item) => String(item.accountId) === String(accountId)) || null;
}

function _vaultEffectiveHistoryPhase(accountId) {
    const phase = _vaultEpicProgressState(accountId)?.phases?.purchaseHistory || {};
    const account = _vaultEpicAccountById(accountId);
    const code = String(phase.errorCode || '');
    if (code === 'EPIC_HISTORY_REFRESH_ALREADY_RUNNING') {
        const refreshing = typeof __vaultEpicHistoryRefreshing !== 'undefined' && __vaultEpicHistoryRefreshing;
        const selectedAccountId = typeof __vaultSelectedEpicAccountId === 'undefined' ? '' : __vaultSelectedEpicAccountId;
        return refreshing && String(selectedAccountId || '') === String(accountId)
            ? { ...phase, status: 'running', errorCode: null, failedStage: null }
            : { ...phase, status: 'skipped', errorCode: null, failedStage: null };
    }
    const fetchedAt = Date.parse(account?.purchaseHistoryFetchedAt || account?.purchaseHistory?.fetchedAt || '');
    const failedAt = Date.parse(phase.completedAt || phase.updatedAt || '');
    const vaultRevision = Number(account?.phaseRevisions?.purchaseHistory || 0);
    const phaseRevision = Number(phase.committedRevision || 0);
    const staleFailure = ['failed', 'partial', 'waiting_for_auth'].includes(phase.status)
        && Number.isFinite(fetchedAt)
        && ((Number.isFinite(failedAt) && failedAt <= fetchedAt)
            || (phaseRevision > 0 && vaultRevision >= phaseRevision));
    return staleFailure
        ? { ...phase, status: 'complete', errorCode: null, failedStage: null, committedRevision: vaultRevision }
        : phase;
}

function _vaultReconcileProgressWithCommittedVault() {
    for (const [accountId, state] of Object.entries(__vaultEpicProgressStates || {})) {
        if (!state?.phases?.purchaseHistory) continue;
        const effective = _vaultEffectiveHistoryPhase(accountId);
        if (effective === state.phases.purchaseHistory) continue;
        const next = { ...state, phases: { ...state.phases, purchaseHistory: effective } };
        const optional = [next.phases?.prices, next.phases?.purchaseHistory];
        const active = optional.some((phase) => ['pending', 'running'].includes(phase?.status));
        next.overallStatus = active
            ? 'library_ready_enriching'
            : (optional.some((phase) => ['failed', 'partial', 'waiting_for_auth'].includes(phase?.status)) ? 'partial' : 'complete');
        __vaultEpicProgressStates[accountId] = next;
    }
}

function _vaultMergeEpicProgressState(existing, incoming) {
    if (!existing || !incoming) return incoming || existing;
    const current = existing.phases?.purchaseHistory || {};
    const next = incoming.phases?.purchaseHistory || {};
    const currentSequence = Number(current.operationSequence || 0);
    const nextSequence = Number(next.operationSequence || 0);
    const currentCommit = Number(current.committedRevision || 0);
    const nextCommit = Number(next.committedRevision || 0);
    const nextIsFailure = ['failed', 'partial', 'waiting_for_auth'].includes(next.status)
        || next.errorCode === 'EPIC_HISTORY_REFRESH_ALREADY_RUNNING';
    const keepCurrentHistory = nextIsFailure && (
        (currentSequence > 0 && (nextSequence === 0 || currentSequence > nextSequence))
        || (current.status === 'complete' && currentCommit > 0 && currentCommit >= nextCommit)
    );
    return keepCurrentHistory
        ? { ...incoming, phases: { ...incoming.phases, purchaseHistory: current } }
        : incoming;
}

function _vaultEpicPhaseProgressText(accountId, phase) {
    const item = phase === 'purchaseHistory'
        ? _vaultEffectiveHistoryPhase(accountId)
        : (_vaultEpicProgressState(accountId)?.phases?.[phase] || {});
    if (phase === 'prices') {
        if (item.status === 'running' || item.status === 'pending') return 'Prices ' + Number(item.processed || 0) + '/' + Number(item.total ?? item.candidates ?? 0);
        if (item.status === 'failed' || item.status === 'partial') return 'Prices need attention';
        if (item.status === 'complete') return 'Prices updated';
        return '';
    }
    if (item.status === 'running' || item.status === 'pending') return 'History ' + Number(item.pagesFetched || 0) + ' pages · ' + Number(item.ordersFetched || 0) + ' orders';
    if (item.status === 'waiting_for_auth') return 'History needs sign-in';
    if (item.status === 'failed' || item.status === 'partial') return 'History needs attention';
    if (item.status === 'complete') return 'History updated';
    return '';
}

function _vaultEpicProgressSummary(accountId) {
    const state = _vaultEpicProgressState(accountId);
    if (!state) return '';
    const prices = state.phases?.prices;
    const history = _vaultEffectiveHistoryPhase(accountId);
    const pricesActive = ['pending', 'running'].includes(prices?.status);
    const historyActive = ['pending', 'running'].includes(history?.status);
    if (pricesActive && historyActive) return 'Updating prices and purchase history';
    if (pricesActive) return _vaultEpicPhaseProgressText(accountId, 'prices');
    if (historyActive) return _vaultEpicPhaseProgressText(accountId, 'purchaseHistory');
    if (history?.status === 'waiting_for_auth') return 'Waiting for Epic sign-in';
    if (state.overallStatus === 'partial') return 'Some details need attention';
    return '';
}

function _vaultEpicProgressNoticeHtml(accountId) {
    const state = _vaultEpicProgressState(accountId);
    if (!state || !['library_ready_enriching', 'partial'].includes(state.overallStatus)) return '';
    const history = _vaultEffectiveHistoryPhase(accountId);
    const phases = ['prices', 'purchaseHistory'];
    const actionable = phases.filter((phase) => {
        const item = phase === 'purchaseHistory' ? history : state.phases?.[phase];
        if (!['failed', 'partial', 'waiting_for_auth'].includes(item?.status)) return false;
        if (phase === 'prices') {
            const attemptId = _vaultEpicPriceFailureAttemptId(accountId, item, state);
            if (_vaultIsEpicPriceWarningDismissed(accountId, attemptId)) return false;
        }
        if (phase === 'purchaseHistory' && typeof __vaultEpicHistoryNotice !== 'undefined' && __vaultEpicHistoryNotice
            && String(__vaultEpicHistoryNotice.accountId || '') === String(accountId)) return false;
        return true;
    });
    const hasActive = [state.phases?.prices, history].some((phase) => ['pending', 'running'].includes(phase?.status));
    if (!actionable.length && !hasActive) return '';
    const firstPending = state.isFirstFullImport && state.overallStatus === 'library_ready_enriching';
    const title = actionable.length ? 'Some Epic details need attention' : (firstPending ? 'Your Epic library is ready' : 'Updating Epic Vault details');
    const price = state.phases?.prices || {};
    const libraryGames = Number(state.phases?.library?.gamesFetched || 0);
    const priceCandidates = Number(price.candidates ?? price.total ?? 0);
    const priceMetrics = 'Library games: ' + libraryGames
        + '. Price candidates: ' + priceCandidates
        + '. Processed: ' + Number(price.processed || 0)
        + '. Resolved: ' + Number(price.resolved || 0)
        + '. Unresolved: ' + Number(price.unresolved || 0) + '.';
    let body = firstPending ? 'Prices and purchase history are still being calculated in the background.' : 'Showing your last saved values while enrichment continues.';
    if (price.status === 'failed' && Number(price.resolved || 0) === 0) body = priceMetrics + ' Prices could not be loaded yet.';
    else if (price.status === 'partial') body = priceMetrics;
    const actions = actionable.map((phase) => {
        const label = phase === 'prices' ? (state.phases?.prices?.status === 'partial' ? 'Retry unresolved' : 'Retry prices') : (history?.status === 'waiting_for_auth' ? 'Sign in to continue' : 'Retry history');
        const retry = '<button type="button" class="is-primary" onclick="retryVaultEpicPhase(\'' + _vaultHtml(accountId) + '\', \'' + phase + '\')">' + label + '</button>';
        if (phase !== 'prices') return retry;
        const attemptId = _vaultEpicPriceFailureAttemptId(accountId, state.phases?.prices, state);
        return retry + '<button type="button" onclick="dismissVaultEpicPriceWarning(\'' + _vaultHtml(accountId) + '\', \'' + _vaultHtml(attemptId) + '\')">Dismiss</button>';
    }).join('');
    if (actionable.length && price.status !== 'failed' && price.status !== 'partial') body = 'Your games remain available. ' + body;
    const diagnosticLines = actionable.map((phase) => {
        const item = phase === 'purchaseHistory' ? history : (state.phases?.[phase] || {});
        if (!item.errorCode && !item.failedStage) return '';
        return '<code>' + _vaultHtml(phase) + ': ' + _vaultHtml(item.errorCode || item.status) + (item.failedStage ? ' at ' + _vaultHtml(item.failedStage) : '') + '</code>';
    }).filter(Boolean).join('');
    const diagnostics = diagnosticLines ? '<details class="vault-epic-phase-diagnostics"><summary>Diagnostic details</summary>' + diagnosticLines + '</details>' : '';
    const progressRows = '<div class="vault-epic-progress-rows">'
        + '<span data-vault-epic-progress-prices>' + _vaultHtml(_vaultEpicPhaseProgressText(accountId, 'prices')) + '</span>'
        + '<span data-vault-epic-progress-history>' + _vaultHtml(_vaultEpicPhaseProgressText(accountId, 'purchaseHistory')) + '</span>'
        + '</div>';
    return '<div class="vault-history-notice is-' + (actionable.length ? 'warning' : 'info') + '" role="status"><div><strong>' + _vaultHtml(title) + '</strong><span>' + _vaultHtml(body) + '</span>' + progressRows + diagnostics + '</div>' + (actions ? '<div class="vault-history-notice-actions">' + actions + '</div>' : '') + '</div>';
}

async function retryVaultEpicPhase(accountId, phase) {
    try {
        await window.electronAPI?.platformSyncRetryEpicPhase?.(accountId, phase);
    } catch (error) {
        console.error('[Vault] Epic phase retry failed:', error?.message || error);
    }
}
window.retryVaultEpicPhase = retryVaultEpicPhase;

async function refreshVaultEpicPrices(accountId = __vaultSelectedEpicAccountId) {
    const id = String(accountId || __vaultSelectedEpicAccountId || '');
    if (!id || __vaultEpicPriceRefreshingAccounts.has(id)) return;
    const attemptId = 'manual:' + Date.now() + ':' + Math.random().toString(36).slice(2, 10);
    __vaultEpicPriceRefreshingAccounts.add(id);
    __vaultEpicPriceRefreshErrors.delete(id);
    _vaultPatchEpicAccountShell(_vaultSelectedEpicAccount());
    try {
        const result = await window.electronAPI?.platformSyncRefreshEpicPrices?.(id);
        if (!result || result.status !== 'success') {
            __vaultEpicPriceRefreshErrors.set(id, {
                code: result?.code || 'EPIC_PRICE_REFRESH_FAILED',
                message: result?.message || 'Epic prices could not be refreshed.',
                failedStage: result?.failedStage || 'price_refresh',
                attemptId,
            });
            return result;
        }
        __vaultEpicPriceRefreshErrors.delete(id);
        _vaultClearEpicPriceWarningDismissal(id);
        await hydrateEpicVaultConsole(true, { reason: 'epic-prices-refreshed', preserveScroll: true });
        return result;
    } catch (error) {
        __vaultEpicPriceRefreshErrors.set(id, {
            code: error?.code || 'EPIC_PRICE_REFRESH_FAILED',
            message: error?.message || 'Epic prices could not be refreshed.',
            failedStage: error?.failedStage || 'price_refresh',
            attemptId,
        });
        return { status: 'error', code: error?.code || 'EPIC_PRICE_REFRESH_FAILED' };
    } finally {
        __vaultEpicPriceRefreshingAccounts.delete(id);
        _vaultShowcaseUpdateRefreshGate();
        const account = _vaultSelectedEpicAccount();
        if (account && String(account.accountId) === id) _vaultPatchEpicAccountShell(account);
    }
}
window.refreshVaultEpicPrices = refreshVaultEpicPrices;

function _renderVaultEpicAccounts(accounts = []) {
    _vaultClearVirtualRows(__vaultLibraryVirtual);
    _vaultClearVirtualRows(__vaultHistoryVirtual);
    const box = document.getElementById('vaultEpicLibrary');
    if (!box) return;
    _setVaultState('platform', 'epic');
    const overviewPanel = document.getElementById('vaultOverviewPanel');
    if (overviewPanel) overviewPanel.style.display = 'none';
    const consolePanel = document.getElementById('vaultConsole');
    if (consolePanel) consolePanel.style.display = 'grid';
    document.querySelectorAll('.vault-platform-card.active').forEach(el => el.classList.remove('active'));
    document.getElementById('vault-card-epic')?.classList.add('active');
    box.style.display = 'block';
    __vaultEpicSection = 'library';
    _vaultSetConsoleIntro('Epic Games', 'Linked Epic Accounts', 'Choose one Epic account to open its account-scoped value and purchase history.');
    _setVaultReadout('vaultReadoutAccountsLabel', 'vaultReadoutAccounts', 'Accounts', accounts.length + ' linked');
    _setVaultReadout('vaultReadoutSignalLabel', 'vaultReadoutSignal', 'View', 'Account list');
    _setVaultReadout('vaultReadoutStatusLabel', 'vaultReadoutStatus', 'Status', accounts.length ? 'Ready' : 'Empty');

    if (!accounts.length) {
        box.innerHTML = '<div class="vault-account-shell"><div class="vault-empty-state"><strong>No Epic accounts linked</strong><span>Connect an Epic account to build your Vault.</span><button type="button" class="vault-empty-action" onclick="openPlatformsModal()">Connect Epic</button></div></div>';
        return;
    }

    const cards = accounts.map((account) => {
        const coverage = _vaultEpicCoverage(account);
        const state = _vaultEpicProgressState(account.accountId);
        const firstPending = state?.isFirstFullImport && state?.overallStatus === 'library_ready_enriching';
        const pricePhase = state?.phases?.prices || {};
        const current = firstPending ? 'Pending' : (coverage.resolvedGames ? _vaultMinorMoney(coverage.currentValueMinor, coverage.currency) : (pricePhase.status === 'failed' ? 'Prices unavailable' : 'No prices yet'));
        const spent = firstPending ? '<span>History pending</span>' : (account.permissions?.purchaseHistory ? '<span>' + _vaultHtml(_vaultActualSpentLabel(account)) + ' net spent</span>' : '<span>History not imported</span>');
        const progress = _vaultEpicProgressSummary(account.accountId);
        return `<button class="vault-epic-account-card" onclick="selectVaultEpicAccount('${_vaultHtml(account.accountId)}')">
            <span class="vault-epic-account-icon"><img src="../assets/epic.svg" alt=""></span>
            <strong>${_vaultHtml(account.displayName || 'Epic Account')}</strong>
            <small>${coverage.totalGames} games</small>
            <span>${_vaultHtml(current)} current</span>
            ${spent}
            ${progress ? `<em class="vault-epic-progress-label">${_vaultHtml(progress)}</em>` : ''}
            <i aria-hidden="true">Open</i>
        </button>`;
    }).join('');
    box.innerHTML = '<div class="vault-account-shell"><div class="vault-epic-account-grid">' + cards + '</div></div>';
}

function _vaultGetLibraryFilterOptions() {
    if (__vaultEpicPriceMode === 'purchase') return [{ value: 'all', label: 'All paid' }];
    return [
        { value: 'priced', label: 'Priced' },
        { value: 'all', label: 'All' },
        { value: 'free', label: 'Free' },
        { value: 'sale', label: 'On Sale' },
        { value: 'unavailable', label: 'Unavailable' },
    ];
}

function _vaultLibrarySortOptions() {
    return [
        { value: 'price_desc', label: 'Price: High to Low' },
        { value: 'price_asc', label: 'Price: Low to High' },
        { value: 'name_asc', label: 'Name: A-Z' },
        { value: 'name_desc', label: 'Name: Z-A' },
        { value: 'discount_desc', label: 'Biggest Discount' },
    ];
}

function _vaultHistorySortOptions() {
    return [
        { value: 'amount_desc', label: 'Amount: High to Low' },
        { value: 'amount_asc', label: 'Amount: Low to High' },
        { value: 'newest', label: 'Newest First' },
        { value: 'oldest', label: 'Oldest First' },
        { value: 'name_asc', label: 'Name: A-Z' },
    ];
}

function _vaultDropdownHtml(label, currentValue, options, setterName, disabled = false) {
    const list = Array.isArray(options) ? options : [];
    const selected = list.find((item) => String(item.value) === String(currentValue)) || list[0] || { value: '', label: 'Select' };
    const items = list.map((item) => `<button type="button" role="option" class="${String(item.value) === String(selected.value) ? 'is-selected' : ''}" aria-selected="${String(item.value) === String(selected.value) ? 'true' : 'false'}" onclick="selectVaultDropdownOption('${_vaultHtml(setterName)}', '${_vaultHtml(item.value)}')" onkeydown="handleVaultDropdownOptionKey(event, '${_vaultHtml(setterName)}', '${_vaultHtml(item.value)}')">${_vaultHtml(item.label)}</button>`).join('');
    return `<div class="vault-select ${disabled ? 'is-disabled' : ''}" data-vault-dropdown>
        <span class="vault-select-label">${_vaultHtml(label)}</span>
        <button type="button" class="vault-select-button" ${disabled ? 'disabled aria-disabled="true"' : ''} onclick="toggleVaultDropdown(this)" onkeydown="handleVaultDropdownKey(event, this)" aria-haspopup="listbox" aria-expanded="false">
            <span>${_vaultHtml(selected.label)}</span><i aria-hidden="true">⌄</i>
        </button>
        <div class="vault-select-menu" role="listbox">${items}</div>
    </div>`;
}

function _vaultPrepareLibraryGames(account, purchaseMap) {
    const games = _vaultDedupeLibraryGames(account?.games);
    const query = _vaultSafeTitle(__vaultEpicLibrarySearch);
    const filter = _vaultEffectiveLibraryFilter();
    let visibleGames = __vaultEpicPriceMode === 'purchase'
        ? _vaultBuildRetainedPurchaseCards(account)
        : [...games];
    visibleGames = visibleGames.filter((game) => !query || _vaultSafeTitle(game.title || game.name).includes(query));

    if (__vaultEpicPriceMode !== 'purchase') {
        visibleGames = visibleGames.filter((game) => {
            if (filter === 'priced') return _vaultIsCurrentPricedGame(game, account);
            if (filter === 'free') return _vaultIsCurrentFreeGame(game, account);
            if (filter === 'sale') return _vaultIsCurrentPricedGame(game, account) && game?.livePrice?.isDiscounted === true;
            if (filter === 'unavailable') return _vaultIsCurrentUnavailableGame(game, account);
            return true;
        });
    }

    const currentCurrencies = new Set(visibleGames.map((game) => game?.livePrice?.currency).filter(Boolean));
    const purchaseCurrencies = new Set(visibleGames.map((game) => game?.currency || game?.__vaultPurchase?.currency).filter(Boolean));
    const mixedPurchaseCurrencies = purchaseCurrencies.size > 1;
    visibleGames.sort((a, b) => {
        if (__vaultEpicLibrarySort === 'name_asc') return String(a.title || '').localeCompare(String(b.title || ''));
        if (__vaultEpicLibrarySort === 'name_desc') return String(b.title || '').localeCompare(String(a.title || ''));
        if (__vaultEpicLibrarySort === 'discount_desc') return Number(b.livePrice?.discountPercent || 0) - Number(a.livePrice?.discountPercent || 0);
        const direction = __vaultEpicLibrarySort === 'price_asc' ? 'asc' : 'desc';
        if (__vaultEpicPriceMode === 'purchase') {
            const pa = a.__vaultPurchase || {};
            const pb = b.__vaultPurchase || {};
            const amountA = Number(a.netPaidMinor || _vaultAmountMinor(pa));
            const amountB = Number(b.netPaidMinor || _vaultAmountMinor(pb));
            if (mixedPurchaseCurrencies) return _vaultSortCurrencyThenAmount(
                { currency: a.currency || pa.currency, amountMinor: amountA },
                { currency: b.currency || pb.currency, amountMinor: amountB },
                direction,
            );
            const diff = amountA - amountB;
            return direction === 'asc' ? diff : -diff;
        }
        return _vaultCompareCurrentPrices(a, b, account, direction);
    });
    return visibleGames;
}
function _vaultSelectedEpicAccount() {
    const accounts = Array.isArray(__vaultEpicDataCache?.accounts) ? __vaultEpicDataCache.accounts : [];
    return accounts.find((item) => String(item.accountId) === String(__vaultSelectedEpicAccountId)) || null;
}

function _vaultLibraryToolbarHtml(account) {
    const filterValue = __vaultEpicPriceMode === 'purchase' ? 'all' : __vaultEpicLibraryFilter;
    return `<div class="vault-library-toolbar">
        <div class="vault-toolbar-count" data-vault-library-count></div>
        <input type="search" placeholder="Search games..." value="${_vaultHtml(__vaultEpicLibrarySearch)}" oninput="setVaultEpicLibrarySearch(this.value)">
        ${_vaultDropdownHtml('Filter', filterValue, _vaultGetLibraryFilterOptions(), 'setVaultEpicLibraryFilter', __vaultEpicPriceMode === 'purchase')}
        ${_vaultDropdownHtml('Sort', __vaultEpicLibrarySort, _vaultLibrarySortOptions(), 'setVaultEpicLibrarySort')}
    </div>`;
}

function _vaultEpicCardHtml(game, account, purchaseMap, renderContext) {
    const priceView = __vaultEpicPriceMode === 'purchase'
        ? _vaultGetPurchasePriceView(game, account, purchaseMap)
        : _vaultGetCurrentPriceView(game, account);
    const cover = _vaultRenderEpicCover(game, renderContext || account);
    const discount = priceView.discount ? `<span class="vault-epic-card-discount">${_vaultHtml(priceView.discount)}</span>` : '';
    const original = priceView.original ? `<span class="vault-epic-card-original">${_vaultHtml(priceView.original)}</span>` : '';
    return `<article class="game-card vault-epic-cover-card" data-price-status="${_vaultHtml(priceView.status)}">
        <div class="game-card-img-wrap vault-epic-card-artwork">
            ${cover}
            <div class="gc-grad-bottom"></div>
            <div class="vault-epic-card-price">${original}<strong>${_vaultHtml(priceView.label)}</strong>${discount}</div>
            <div class="ag-card-display-overlay">
                <div class="ag-card-display-title" title="${_vaultHtml(game.title || '')}">${_vaultHtml(game.title || 'Untitled')}</div>
            </div>
        </div>
    </article>`;
}

function _vaultCreateEpicCardElement() {
    const card = document.createElement('article');
    card.className = 'game-card vault-epic-cover-card';
    card.innerHTML = `<div class="game-card-img-wrap vault-epic-card-artwork">
        <div data-vault-cover-slot>${_vaultEpicCoverPlaceholder('Epic')}</div>
        <div class="gc-grad-bottom"></div>
        <div class="vault-epic-card-price"><span data-vault-original></span><strong data-vault-price></strong><span data-vault-discount></span></div>
        <div class="ag-card-display-overlay"><div class="ag-card-display-title" data-vault-title></div></div>
    </div>`;
    return card;
}

function _vaultBindEpicCard(card, game, bind = {}) {
    const account = bind.context?.account || __vaultSelectedEpicAccount();
    const purchaseMap = bind.context?.purchaseMap || new Map();
    const priceView = __vaultEpicPriceMode === 'purchase'
        ? _vaultGetPurchasePriceView(game, account, purchaseMap)
        : _vaultGetCurrentPriceView(game, account);
    const key = _vaultStableItemKey(game, 'library');
    const artworkKey = _vaultArtworkKey(game, account) || key;
    card.className = 'game-card vault-epic-cover-card';
    card.dataset.priceStatus = priceView.status;
    card.dataset.vaultKey = key;
    card.dataset.vaultArtworkKey = artworkKey;
    card.dataset.vaultGeneration = String(bind.generation || 0);

    const title = game.title || 'Untitled';
    const titleEl = card.querySelector('[data-vault-title]');
    if (titleEl) {
        titleEl.textContent = title;
        titleEl.title = title;
    }
    const priceEl = card.querySelector('[data-vault-price]');
    if (priceEl) priceEl.textContent = priceView.label;
    const originalEl = card.querySelector('[data-vault-original]');
    if (originalEl) {
        originalEl.textContent = priceView.original || '';
        originalEl.className = priceView.original ? 'vault-epic-card-original' : '';
    }
    const discountEl = card.querySelector('[data-vault-discount]');
    if (discountEl) {
        discountEl.textContent = priceView.discount || '';
        discountEl.className = priceView.discount ? 'vault-epic-card-discount' : '';
    }

    const localUrl = _vaultGridDisplayCover(_vaultResolveLocalCover(game, bind.context?.renderContext || account));
    const slot = card.querySelector('[data-vault-cover-slot]');
    if (!slot) return;
    const currentImg = slot.querySelector('.vault-epic-cover-img');
    if (localUrl) {
        if (currentImg) {
            if (currentImg.getAttribute('src') !== localUrl) currentImg.setAttribute('src', localUrl);
            currentImg.dataset.coverKey = artworkKey;
            return;
        }
        slot.innerHTML = `<img class="vault-epic-cover-img" alt="" loading="lazy" decoding="async" data-cover-key="${_vaultHtml(artworkKey)}">`;
        const img = slot.querySelector('.vault-epic-cover-img');
        if (img) img.setAttribute('src', localUrl);
        return;
    }
    if (!slot.querySelector('.vault-epic-cover-fallback')) {
        slot.innerHTML = _vaultEpicCoverPlaceholder(title);
    } else {
        const span = slot.querySelector('.vault-epic-cover-fallback span');
        if (span) span.textContent = String(title || 'Epic').trim().slice(0, 1).toUpperCase() || 'E';
    }
}
function _vaultEpicCardErrorHtml(game = {}, err = null) {
    console.error?.('[Epic Vault] Failed to render card', { title: game?.title, id: game?.id, err });
    return `<article class="game-card vault-epic-cover-card is-error" data-price-status="unresolved">
        <div class="game-card-img-wrap vault-epic-card-artwork">
            ${_vaultEpicCoverPlaceholder(game?.title || 'Epic')}
            <div class="gc-grad-bottom"></div>
            <div class="ag-card-display-overlay">
                <div class="ag-card-display-title" title="${_vaultHtml(game?.title || '')}">${_vaultHtml(game?.title || 'Epic purchase')}</div>
            </div>
        </div>
    </article>`;
}

function _vaultLibraryCardsHtml(account, purchaseMap, games, renderContext) {
    return (Array.isArray(games) ? games : []).map((game) => {
        try { return _vaultEpicCardHtml(game, account, purchaseMap, renderContext); }
        catch (err) { return _vaultEpicCardErrorHtml(game, err); }
    }).join('');
}

function _vaultLibraryResultsHtml(account, purchaseMap, visibleGames, games, renderContext = _vaultCreateEpicRenderContext(account)) {
    if (__vaultEpicPriceMode === 'purchase' && !visibleGames.length) {
        return `<div class="vault-empty-state"><strong>No paid Epic game purchases found for this account.</strong></div>`;
    }
    if (!visibleGames.length) {
        return `<div class="vault-empty-state"><strong>No games match these filters.</strong></div>`;
    }
    return `<div class="vault-epic-library-grid">${_vaultLibraryCardsHtml(account, purchaseMap, visibleGames, renderContext)}</div>`;
}

function _vaultRaf(fn) {
    if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(fn);
    return setTimeout(fn, 0);
}

function _vaultCanUseVirtualDom() {
    return typeof document !== 'undefined' && typeof document.createElement === 'function';
}

function _vaultVirtualScroller() {
    return document.getElementById('mainContentArea') || document.scrollingElement || document.documentElement;
}

function _vaultDebugVirtual(kind, data = {}) {
    if (!window.baddel_debug_vault_vs) return;
    console.debug?.(`[VaultVS:${kind}]`, data);
}

function _vaultStableItemKey(item = {}, prefix = 'library') {
    return String(_vaultCanonicalGameKey(item) || item.id || item.appName || item.catalogItemId || item.offerId || item.stableOrderId || item.orderId || _vaultIdentityKeys(item)[0] || `${prefix}:${item.title || item.name || ''}`).trim();
}

function _vaultClearVirtualRows(vs) {
    vs.controller?.cleanup?.(false);
    vs.rowPool?.forEach?.((row) => row?.remove?.());
    vs.rowPool?.clear?.();
    vs.cardCache?.clear?.();
    vs.renderedStart = -1;
    vs.renderedEnd = -1;
}

function _vaultMeasureLibraryVirtual(vs) {
    const width = Math.max(1, Number(vs.host?.clientWidth || vs.host?.getBoundingClientRect?.().width || 760));
    const columns = Math.max(1, Math.floor((width + VAULT_LIBRARY_ROW_GAP) / (VAULT_LIBRARY_MIN_CARD_WIDTH + VAULT_LIBRARY_ROW_GAP)));
    const cardWidth = Math.floor((width - (columns - 1) * VAULT_LIBRARY_ROW_GAP) / columns);
    const cardHeight = Math.round(cardWidth * VAULT_LIBRARY_CARD_RATIO);
    vs.columns = columns;
    vs.cardWidth = cardWidth;
    vs.cardHeight = cardHeight;
    vs.rowHeight = cardHeight + VAULT_LIBRARY_ROW_GAP;
    vs.totalHeight = Math.ceil(vs.items.length / columns) * vs.rowHeight;
    vs.host.style.height = `${vs.totalHeight}px`;
}

function _vaultLibraryRange(vs) {
    const hostTop = vs.host?.offsetTop || 0;
    const scrollTop = Math.max(0, Number(vs.scroller?.scrollTop || 0) - hostTop);
    const viewport = Math.max(360, Number(vs.scroller?.clientHeight || window.innerHeight || 720));
    const firstRow = Math.max(0, Math.floor(scrollTop / vs.rowHeight) - VAULT_LIBRARY_BUFFER_ROWS);
    const lastRow = Math.min(Math.ceil(vs.items.length / vs.columns) - 1, Math.ceil((scrollTop + viewport) / vs.rowHeight) + VAULT_LIBRARY_BUFFER_ROWS);
    return { start: firstRow * vs.columns, end: Math.min(vs.items.length, (lastRow + 1) * vs.columns), firstRow, lastRow, scrollTop };
}

function _vaultSyncVirtualMirror(vs) {
    const controller = vs.controller;
    if (!controller) return;
    vs.items = controller.items;
    vs.host = controller.host;
    vs.scroller = controller.scroller;
    vs.columns = controller.columns;
    vs.cardWidth = controller.cardWidth;
    vs.cardHeight = controller.cardHeight;
    vs.rowHeight = controller.rowHeight;
    vs.totalHeight = controller.totalHeight;
    vs.renderedStart = controller.renderedStart;
    vs.renderedEnd = controller.renderedEnd;
    vs.cardCache = controller.mounted;
    vs.rowPool = controller.mounted;
}

function _vaultWarmVisibleRange(vs, range, kind) {
    const controller = vs.controller;
    const context = controller?.context?.renderContext || controller?.context || vs.renderContext || vs.account;
    const signature = [controller?.generation || 0, range.start, range.end].join(':');
    if (!controller || vs.visibleWarmSignature === signature) return;
    vs.visibleWarmSignature = signature;
    const rawItems = (vs.items || []).slice(range.start, range.end);
    const targets = kind === 'history'
        ? rawItems.map((item) => _vaultHistoryArtworkSubject(item, context))
        : rawItems;
    _vaultAwaitArtworkBoundary(_vaultPrimeLocalCovers(targets, context))
        .then(() => _vaultAwaitArtworkBoundary(_vaultLoadExistingGridThumbnails(targets, context, { limit: targets.length })))
        .then(() => {
            if (vs.controller !== controller || vs.visibleWarmSignature !== signature) return;
            _vaultQueueMissingCoverWarm(targets, context, kind === 'history' ? 'epic-vault-visible-history-artwork' : 'epic-vault-visible-artwork');
            controller.render(true, true);
        })
        .catch(() => {});
}

function _vaultEnsureLibraryController(vs) {
    if (vs.controller || !window.BaddelVirtualGridController) return vs.controller;
    vs.controller = new window.BaddelVirtualGridController({
        name: 'epic-vault-library',
        getScroller: _vaultVirtualScroller,
        minCardWidth: VAULT_LIBRARY_MIN_CARD_WIDTH,
        cardRatio: VAULT_LIBRARY_CARD_RATIO,
        rowGap: VAULT_LIBRARY_ROW_GAP,
        bufferRows: VAULT_LIBRARY_BUFFER_ROWS,
        getKey: (game) => _vaultStableItemKey(game, 'library'),
        createCard: _vaultCreateEpicCardElement,
        bindCard: _vaultBindEpicCard,
        onRange: (range) => {
            _vaultSyncVirtualMirror(vs);
            _vaultWarmVisibleRange(vs, range, 'library');
            _vaultDebugVirtual('library', { total: range.total, mounted: range.mounted, range, columns: range.columns });
        },
    });
    return vs.controller;
}

function _vaultRenderLibraryVirtualFrame(force = false) {
    const vs = __vaultLibraryVirtual;
    const controller = _vaultEnsureLibraryController(vs);
    if (!controller) return;
    controller.render(force);
    _vaultSyncVirtualMirror(vs);
}

function _vaultScheduleLibraryVirtual(force = false) {
    const vs = __vaultLibraryVirtual;
    const controller = _vaultEnsureLibraryController(vs);
    if (controller) controller.schedule(force);
}

function _vaultBindVirtualScroll(vs, schedule) {
    const controller = _vaultEnsureLibraryController(vs);
    if (!controller) {
        const scroller = _vaultVirtualScroller();
        if (vs.scroller && vs._onScroll) vs.scroller.removeEventListener?.('scroll', vs._onScroll);
        vs.scroller = scroller;
        vs._onScroll = () => schedule(false);
        scroller?.addEventListener?.('scroll', vs._onScroll, { passive: true });
    }
}

function _vaultMountLibraryVirtual(host, account, purchaseMap, visibleGames, options = {}) {
    const scrollPolicy = typeof options === 'object'
        ? (options.scrollPolicy || (options.preserveScroll ? 'preserve-anchor' : (options.resetScroll === true ? 'results-start' : 'preserve-position')))
        : (options ? 'results-start' : 'preserve-position');
    const resetScroll = scrollPolicy === 'results-start' || scrollPolicy === 'account-start';
    const preserveScroll = scrollPolicy === 'preserve-anchor' || (typeof options === 'object' && options.preserveScroll === true);
    if (!_vaultCanUseVirtualDom() || !window.BaddelVirtualGridController) {
        const renderContext = options.renderContext || _vaultCreateEpicRenderContext(account);
        host.innerHTML = _vaultLibraryResultsHtml(account, purchaseMap, visibleGames.slice(0, 60), account.games || [], renderContext);
        return;
    }
    const vs = __vaultLibraryVirtual;
    const controller = _vaultEnsureLibraryController(vs);
    const anchor = (typeof options === 'object' && options.anchor) || (preserveScroll && controller?.host === host ? controller.captureAnchor?.() : null);
    vs.generation += 1;
    vs.items = visibleGames;
    vs.account = account;
    vs.purchaseMap = purchaseMap;
    vs.renderContext = options.renderContext || _vaultCreateEpicRenderContext(account);
    vs.host = host;
    host.className = 'vault-epic-library-grid vault-virtual-grid';
    if (host.querySelector?.('.vault-empty-state')) host.textContent = '';
    host.style.position = 'relative';
    const context = { account, purchaseMap, renderContext: vs.renderContext };
    if ((preserveScroll || scrollPolicy === 'results-start' || scrollPolicy === 'preserve-position') && controller?.host === host && typeof controller.setItems === 'function') {
        controller.setItems(visibleGames, { context, preserveAnchor: anchor, scrollPolicy });
    } else {
        controller.mount({ host, items: visibleGames, context, resetScroll, scrollPolicy });
    }
    _vaultSyncVirtualMirror(vs);
}
async function _renderVaultEpicLibraryResults(account, options = {}) {
    const box = document.getElementById('vaultEpicAccountContent') || document.getElementById('vaultEpicLibrary');
    const host = document.getElementById('vaultEpicLibraryResults') || box;
    if (!box || !host || !account) return;
    const renderJob = ++__vaultEpicLibraryRenderJob;
    const games = _vaultDedupeLibraryGames(account?.games);
    const purchaseMap = _vaultBuildPurchaseMap(account);
    const visibleGames = _vaultPrepareLibraryGames(account, purchaseMap);
    const representedTotals = __vaultEpicPriceMode === 'purchase' ? _vaultRepresentedPurchaseTotal(visibleGames) : null;
    const representedLabel = representedTotals
        ? Object.entries(representedTotals).map(([currency, minor]) => _vaultMinorMoney(minor, currency)).join(' + ')
        : '';
    const filter = _vaultEffectiveLibraryFilter();
    const selectedFilter = _vaultGetLibraryFilterOptions().find((item) => item.value === filter)?.label || 'games';
    const countLabel = __vaultEpicPriceMode === 'purchase'
        ? `${visibleGames.length} paid games${representedLabel ? ` · ${representedLabel} represented` : ''}`
        : (filter === 'priced'
            ? `${visibleGames.length} priced games · ${games.length} total`
            : `${visibleGames.length} ${selectedFilter.toLowerCase()} games · ${games.length} total`);    const countEl = typeof box.querySelector === 'function' ? box.querySelector('[data-vault-library-count]') : null;
    if (countEl) countEl.textContent = countLabel;
    if (__vaultEpicPriceMode === 'purchase' && !visibleGames.length) {
        _vaultClearVirtualRows(__vaultLibraryVirtual);
        host.className = '';
        host.innerHTML = `<div class="vault-empty-state"><strong>No paid Epic game purchases found for this account.</strong></div>`;
        return;
    }
    if (!visibleGames.length) {
        _vaultClearVirtualRows(__vaultLibraryVirtual);
        host.className = '';
        const coverage = _vaultEpicCoverage(account);
        const pricePhase = _vaultEpicProgressState(account.accountId)?.phases?.prices || {};
        if (filter === 'priced' && games.length > 0 && coverage.resolvedGames === 0) {
            host.innerHTML = '<div class="vault-empty-state is-warning"><strong>' + games.length + ' games are available. Prices could not be loaded yet.</strong><span>' + 'Epic pricing is still unavailable.' + '</span><button type="button" class="vault-empty-action" onclick="setVaultEpicLibraryFilter(\'all\')">Show all ' + games.length + ' games</button></div>';
        } else {
            host.innerHTML = '<div class="vault-empty-state"><strong>No games match these filters.</strong></div>';
        }
        return;
    }
    const renderContext = _vaultCreateEpicRenderContext(account);
    const firstPaintGames = visibleGames.slice(0, 48);
    await _vaultAwaitArtworkBoundary(_vaultPrimeLocalCovers(firstPaintGames, renderContext));
    await _vaultAwaitArtworkBoundary(_vaultLoadExistingGridThumbnails(firstPaintGames, renderContext, { limit: firstPaintGames.length }));
    if (renderJob !== __vaultEpicLibraryRenderJob || host.isConnected === false) return;
    _vaultMountLibraryVirtual(host, account, purchaseMap, visibleGames, { ...options, renderContext });
    _vaultQueueMissingCoverWarm(firstPaintGames, renderContext, 'epic-vault-visible-artwork');
    _vaultScheduleArtworkWarm(visibleGames, renderContext, 'epic-vault-library-artwork');
}

function _renderVaultEpicLibrary(account, options = {}) {
    const box = document.getElementById('vaultEpicAccountContent') || document.getElementById('vaultEpicLibrary');
    if (!box) return;
    const games = _vaultDedupeLibraryGames(account?.games);
    _vaultSetStickyControlsHtml(`${_vaultAccountTabsHtml()}${_vaultPriceModeHtml()}${_vaultLibraryToolbarHtml(account)}`);
    if (!games.length && __vaultEpicPriceMode !== 'purchase') {
        _vaultClearVirtualRows(__vaultLibraryVirtual);
        box.innerHTML = `<div class="vault-empty-state"><strong>No games found for this account.</strong></div>`;
        return;
    }
    box.dataset.vaultEpicPanel = 'library';
    if (!document.getElementById('vaultEpicLibraryResults')) box.innerHTML = '<div id="vaultEpicLibraryResults"></div>';
    _renderVaultEpicLibraryResults(account, options);
}

function _vaultFormatDate(value) {
    if (!value) return 'No date';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'No date';
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function _vaultHistoryAmountLabel(item, account) {
    const amountMinor = _vaultAmountMinor(item);
    if (amountMinor === 0 && !item.isRefund) return 'FREE';
    const label = _vaultMinorMoney(Math.abs(amountMinor), item.currency || account.primaryCurrency || account.currency || 'USD');
    return item.isRefund ? `-${label}` : label;
}

function _vaultHistoryType(item = {}) {
    if (item.isRefund) return 'refund';
    if (item.isFab) return 'fab';
    if (_vaultAmountMinor(item) === 0) return 'free';
    return 'purchase';
}

function _vaultHistoryTypeLabel(type) {
    return { refund: 'Refund', fab: 'FAB', free: 'Free', purchase: 'Purchase' }[type] || 'Purchase';
}


function _vaultHistoryArtworkCandidates(item = {}) {
    const candidates = [];
    const push = (url, source = 'purchase') => {
        const value = String(url || '').trim();
        if (!value || candidates.some((candidate) => candidate.url === value)) return;
        candidates.push({ url: value, source });
    };
    push(item.coverUrl, item.artworkSource || 'purchase_cover');
    for (const candidate of Array.isArray(item.coverCandidates) ? item.coverCandidates : []) {
        if (typeof candidate === 'string') push(candidate, 'purchase_candidate');
        else push(candidate?.url, candidate?.source || 'purchase_candidate');
    }
    push(item.image, 'purchase_image');
    push(item.cover, 'purchase_cover_legacy');
    push(item.posterImage, 'purchase_poster');
    push(item.heroImage, 'purchase_hero');
    return candidates;
}

function _vaultHistoryArtworkPlaceholder(title = '') {
    const initial = String(title || 'Epic').trim().slice(0, 1).toUpperCase() || 'E';
    return `<div class="vault-history-cover-fallback" aria-hidden="true"><span>${_vaultHtml(initial)}</span></div>`;
}

function _vaultRenderHistoryArtwork(item = {}, accountOrContext = null) {
    const context = accountOrContext?.libraryIndex ? accountOrContext : null;
    const account = context?.account || accountOrContext || _vaultSelectedEpicAccount();
    const subject = _vaultHistoryArtworkSubject(item, context || account);
    const title = item.title || item.name || subject?.title || 'Epic order';
    const localUrl = _vaultGridDisplayCover(_vaultResolveLocalCover(subject, context || account));
    const key = _vaultHtml(_vaultArtworkKey(subject, context || account) || _vaultHistoryStableId(item));
    if (!localUrl) return `<div class="vault-history-cover" data-vault-artwork-key="${key}">${_vaultHistoryArtworkPlaceholder(title)}</div>`;
    return `<div class="vault-history-cover" data-vault-artwork-key="${key}"><img class="vault-history-cover-img" src="${_vaultHtml(localUrl)}" alt="" loading="lazy" decoding="async" data-cover-key="${key}" onerror="handleVaultHistoryCoverError(this)"></div>`;
}
function handleVaultHistoryCoverError(img) {
    if (!img) return;
    const row = img.closest?.('.vault-history-row');
    const title = row?.querySelector?.('.vault-history-main strong')?.textContent || 'Epic';
    const wrap = img.closest?.('.vault-history-cover');
    if (wrap) wrap.innerHTML = _vaultHistoryArtworkPlaceholder(title);
}
function _vaultHistoryCurrencyOptions(items = []) {
    const currencies = [...new Set(items.map((item) => String(item.currency || '').toUpperCase()).filter(Boolean))].sort();
    return [{ value: 'all', label: 'All' }, ...currencies.map((currency) => ({ value: currency, label: currency }))];
}

function _vaultHistoryStableId(item = {}) {
    return String(item.stableOrderId || item.orderId || item.transactionId || item.id || _vaultIdentityKeys(item)[0] || `${item.currency || ''}:${item.date || ''}:${item.title || item.name || ''}:${_vaultAmountMinor(item)}`);
}

function _vaultHistoryMonetaryBucket(item = {}) {
    return Math.abs(_vaultAmountMinor(item)) > 0 ? 0 : 1;
}

function _vaultHistoryAmountSort(a, b, direction = 'desc', currencies = new Set()) {
    const bucketDiff = _vaultHistoryMonetaryBucket(a) - _vaultHistoryMonetaryBucket(b);
    if (bucketDiff) return bucketDiff;
    const va = { currency: a.currency, amountMinor: Math.abs(_vaultAmountMinor(a)) };
    const vb = { currency: b.currency, amountMinor: Math.abs(_vaultAmountMinor(b)) };
    if (currencies.size > 1) return _vaultSortCurrencyThenAmount(va, vb, direction);
    const diff = va.amountMinor - vb.amountMinor;
    return direction === 'asc' ? diff : -diff;
}

function _vaultPrepareHistoryItems(account) {
    const items = Array.isArray(account.purchaseHistoryItems) ? account.purchaseHistoryItems : [];
    const query = _vaultSafeTitle(__vaultEpicHistorySearch);
    let visibleItems = [...items].filter((item) => {
        const type = _vaultHistoryType(item);
        if (query && !_vaultSafeTitle(item.title || item.name || 'Epic order').includes(query)) return false;
        if (__vaultEpicHistoryCurrency !== 'all' && String(item.currency || '').toUpperCase() !== __vaultEpicHistoryCurrency) return false;
        if (__vaultEpicHistoryFilter === 'paid') return type === 'purchase' && _vaultIsPaidGamePurchase(item);
        if (__vaultEpicHistoryFilter === 'refunds') return type === 'refund';
        if (__vaultEpicHistoryFilter === 'free') return type === 'free';
        if (__vaultEpicHistoryFilter === 'fab') return type === 'fab';
        return true;
    });
    const currencies = new Set(visibleItems.map((item) => String(item.currency || '').toUpperCase()).filter(Boolean));
    visibleItems.sort((a, b) => {
        if (__vaultEpicHistorySort === 'name_asc') return String(a.title || '').localeCompare(String(b.title || ''));
        if (__vaultEpicHistorySort === 'newest') return new Date(b.date || 0) - new Date(a.date || 0);
        if (__vaultEpicHistorySort === 'oldest') return new Date(a.date || 0) - new Date(b.date || 0);
        const direction = __vaultEpicHistorySort === 'amount_asc' ? 'asc' : 'desc';
        if (__vaultEpicHistoryFilter === 'all' && __vaultEpicHistoryCurrency === 'all') return _vaultHistoryAmountSort(a, b, direction, currencies);
        const va = { currency: a.currency, amountMinor: Math.abs(_vaultAmountMinor(a)) };
        const vb = { currency: b.currency, amountMinor: Math.abs(_vaultAmountMinor(b)) };
        if (currencies.size > 1 && __vaultEpicHistoryCurrency === 'all') return _vaultSortCurrencyThenAmount(va, vb, direction);
        const diff = va.amountMinor - vb.amountMinor;
        return direction === 'asc' ? diff : -diff;
    });
    return visibleItems;
}

function _vaultEpicHistoryStatus(account = {}, items = []) {
    const activeNotice = __vaultEpicHistoryNotice;
    if (!items.length && activeNotice?.kind === 'error'
        && String(activeNotice.accountId || '') === String(account.accountId || '')) {
        return { kind: 'empty', title: 'No history to display', text: '' };
    }
    const phase = _vaultEffectiveHistoryPhase(account.accountId);
    const cachedRevision = Number(account.phaseRevisions?.purchaseHistory || account.vaultRevision || 0);
    const committedRevision = Number(phase.committedRevision || 0);
    if (items.length) return null;
    if (['pending', 'running'].includes(phase.status)) {
        return { kind: 'progress', title: 'Importing Purchase History', text: _vaultEpicPhaseProgressText(account.accountId, 'purchaseHistory') };
    }
    if (phase.status === 'complete' && committedRevision > cachedRevision) {
        return { kind: 'progress', title: 'Applying purchase history...', text: 'Your completed Epic history is being applied to this view.' };
    }
    if (phase.status === 'waiting_for_auth') {
        return { kind: 'auth', title: 'Sign in to import history', text: 'Your Epic library remains available.', actionLabel: 'Sign in', action: 'refreshVaultEpicPurchaseHistory' };
    }
    if (phase.status === 'failed' || phase.status === 'partial') {
        const detail = [phase.errorCode, phase.failedStage].filter(Boolean).join(' at ');
        return { kind: 'refresh', title: 'Purchase History needs attention', text: detail || 'Epic Purchase History could not be refreshed.', actionLabel: 'Retry History', action: 'refreshVaultEpicPurchaseHistory' };
    }
    const permission = account.permissions?.purchaseHistory === true;
    const rawStatus = String(account.purchaseHistory?.status || account.purchaseHistoryStatus || '').toLowerCase();
    if (permission && /complete|success|loaded|empty/.test(rawStatus)) {
        return { kind: 'empty', title: 'No purchases found', text: 'Epic returned a successful purchase-history response with no completed purchases for this account.', actionLabel: 'Refresh', action: 'refreshVaultEpicPurchaseHistory' };
    }
    return { kind: 'refresh', title: 'Purchase History not imported', text: 'Import the purchase ledger for this linked Epic account.', actionLabel: 'Import History', action: 'refreshVaultEpicPurchaseHistory' };
}

function _vaultEpicEmptyStateHtml(state, account) {
    const accountId = _vaultHtml(account?.accountId || '');
    const action = state?.action
        ? `<button type="button" class="vault-empty-action" onclick="${_vaultHtml(state.action)}('${accountId}')">${_vaultHtml(state.actionLabel || 'Refresh')}</button>`
        : '';
    return `<div class="vault-empty-state is-${_vaultHtml(state?.kind || 'empty')}"><strong>${_vaultHtml(state?.title || 'Nothing here yet')}</strong><span>${_vaultHtml(state?.text || '')}</span>${action}</div>`;
}

function _vaultHistoryFetchedAt(account = {}) {
    return account.purchaseHistoryFetchedAt || account.purchaseHistory?.fetchedAt || account.ordersFetchedAt || null;
}

function _vaultHistoryLastUpdatedLabel(account = {}) {
    const raw = _vaultHistoryFetchedAt(account);
    if (!raw) return account.permissions?.purchaseHistory === true ? 'Not synced yet' : 'Never updated';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return 'Not synced yet';
    return date.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function _vaultHistoryToolbarHtml(items, account = {}) {
    const refreshing = __vaultEpicHistoryRefreshing;
    return `<div class="vault-history-statusbar">
        <span>Last updated: <b>${_vaultHtml(_vaultHistoryLastUpdatedLabel(account))}</b></span>
        <button type="button" class="vault-history-refresh" ${refreshing ? 'disabled aria-busy="true"' : ''} onclick="refreshVaultEpicPurchaseHistory('${_vaultHtml(account.accountId || '')}')">${refreshing ? 'Refreshing...' : 'Refresh'}</button>
    </div>
    ${_vaultEpicHistoryNoticeHtml(account)}
    <div class="vault-history-toolbar">
        <input type="search" placeholder="Search transactions..." value="${_vaultHtml(__vaultEpicHistorySearch)}" oninput="setVaultEpicHistorySearch(this.value)">
        <div class="vault-filter-pills">
            ${['all:All','paid:Paid Purchases','refunds:Refunds','free:Free Claims','fab:FAB'].map((pair) => { const [value,label]=pair.split(':'); return `<button class="${__vaultEpicHistoryFilter === value ? 'active' : ''}" onclick="setVaultEpicHistoryFilter('${value}')">${label}</button>`; }).join('')}
        </div>
        ${_vaultDropdownHtml('Currency', __vaultEpicHistoryCurrency, _vaultHistoryCurrencyOptions(items), 'setVaultEpicHistoryCurrency')}
        ${_vaultDropdownHtml('Sort', __vaultEpicHistorySort, _vaultHistorySortOptions(), 'setVaultEpicHistorySort')}
    </div>`;
}

function _vaultHistoryRowHtml(item, account) {
    const type = _vaultHistoryType(item);
    const label = _vaultHistoryTypeLabel(type);
    const subject = _vaultHistoryArtworkSubject(item, account);
    return `<article class="vault-history-row is-${type}" data-vault-artwork-key="${_vaultHtml(_vaultArtworkKey(subject, account) || _vaultHistoryStableId(item))}">
        <span class="vault-history-badge">${_vaultHtml(label)}</span>
        ${_vaultRenderHistoryArtwork(item, account)}
        <div class="vault-history-main">
            <strong>${_vaultHtml(item.title || 'Epic order')}</strong>
            <span>${_vaultHtml(_vaultFormatDate(item.date))}</span>
            <small>${_vaultHtml(label)}${item.itemCount > 1 ? ` · ${item.itemCount} items` : ''}</small>
        </div>
        <div class="vault-history-amount">
            <b>${_vaultHtml(_vaultHistoryAmountLabel(item, account))}</b>
            <span>${_vaultHtml(item.status || 'Completed')}</span>
        </div>
    </article>`;
}

function _vaultCreateHistoryRowElement() {
    const row = document.createElement('article');
    row.className = 'vault-history-row';
    row.innerHTML = `<span class="vault-history-badge" data-vault-history-badge></span>
        <div data-vault-history-cover-slot></div>
        <div class="vault-history-main">
            <strong data-vault-history-title></strong>
            <span data-vault-history-date></span>
            <small data-vault-history-sub></small>
        </div>
        <div class="vault-history-amount">
            <b data-vault-history-amount></b>
            <span data-vault-history-status></span>
        </div>`;
    return row;
}

function _vaultBindHistoryRow(row, item, bind = {}) {
    const account = bind.context?.account || __vaultSelectedEpicAccount();
    const type = _vaultHistoryType(item);
    const label = _vaultHistoryTypeLabel(type);
    const key = _vaultHistoryStableId(item, bind.index);
    const artworkSubject = _vaultHistoryArtworkSubject(item, bind.context || account);
    const artworkKey = _vaultArtworkKey(artworkSubject, bind.context || account) || key;
    row.className = `vault-history-row is-${type}`;
    row.dataset.vaultKey = key;
    row.dataset.vaultArtworkKey = artworkKey;
    row.dataset.vaultGeneration = String(bind.generation || 0);
    const setText = (selector, value) => { const el = row.querySelector(selector); if (el) el.textContent = value; };
    setText('[data-vault-history-badge]', label);
    setText('[data-vault-history-title]', item.title || 'Epic order');
    setText('[data-vault-history-date]', _vaultFormatDate(item.date));
    setText('[data-vault-history-sub]', `${label}${item.itemCount > 1 ? ` · ${item.itemCount} items` : ''}`);
    setText('[data-vault-history-amount]', _vaultHistoryAmountLabel(item, account));
    setText('[data-vault-history-status]', item.status || 'Completed');
    const slot = row.querySelector('[data-vault-history-cover-slot]');
    if (slot) {
        const next = _vaultRenderHistoryArtwork(item, bind.context || account);
        if (slot.dataset.vaultArtworkKey !== artworkKey || slot.innerHTML !== next) {
            slot.dataset.vaultArtworkKey = artworkKey;
            slot.innerHTML = next;
        }
    }
}

function _vaultEnsureHistoryController(vs) {
    if (vs.controller || !window.BaddelVirtualGridController) return vs.controller;
    vs.controller = new window.BaddelVirtualGridController({
        name: 'epic-vault-history',
        layout: 'list',
        getScroller: _vaultVirtualScroller,
        minCardWidth: 320,
        rowHeight: VAULT_HISTORY_ROW_HEIGHT,
        rowGap: 10,
        bufferRows: VAULT_HISTORY_BUFFER_ROWS,
        getKey: (item, index) => _vaultHistoryStableId(item, index),
        createCard: _vaultCreateHistoryRowElement,
        bindCard: _vaultBindHistoryRow,
        onRange: (range) => {
            _vaultSyncVirtualMirror(vs);
            _vaultWarmVisibleRange(vs, range, 'history');
            _vaultDebugVirtual('history', { total: range.total, mounted: range.mounted, range });
        },
    });
    return vs.controller;
}

function _vaultRenderHistoryVirtualFrame(force = false) {
    const controller = _vaultEnsureHistoryController(__vaultHistoryVirtual);
    if (!controller) return;
    controller.render(force);
    _vaultSyncVirtualMirror(__vaultHistoryVirtual);
}

function _vaultScheduleHistoryVirtual(force = false) {
    const controller = _vaultEnsureHistoryController(__vaultHistoryVirtual);
    if (controller) controller.schedule(force);
}

function _vaultMountHistoryVirtual(host, account, visibleItems, options = {}) {
    const resetScroll = typeof options === 'boolean' ? options : options.resetScroll === true;
    const scrollPolicy = typeof options === 'object' ? (options.scrollPolicy || (resetScroll ? 'results-start' : 'preserve-position')) : (resetScroll ? 'results-start' : 'preserve-position');
    const preserveScroll = scrollPolicy === 'preserve-anchor' || (typeof options === 'object' && options.preserveScroll === true);
    if (!_vaultCanUseVirtualDom() || !window.BaddelVirtualGridController) {
        const renderContext = options.renderContext || _vaultCreateEpicRenderContext(account);
        const fallbackItems = visibleItems.slice(0, 80);
        host.innerHTML = `<div class="vault-history-ledger">${fallbackItems.map((item) => _vaultHistoryRowHtml(item, renderContext)).join('')}</div>`;
        return;
    }
    const vs = __vaultHistoryVirtual;
    const controller = _vaultEnsureHistoryController(vs);
    const anchor = (typeof options === 'object' && options.anchor) || (preserveScroll && controller?.host === host ? controller.captureAnchor?.() : null);
    vs.generation += 1;
    vs.items = visibleItems;
    vs.account = account;
    vs.host = host;
    host.className = 'vault-history-ledger vault-virtual-history vault-virtual-grid';
    if (host.querySelector?.('.vault-empty-state')) host.textContent = '';
    host.style.position = 'relative';
    const context = options.renderContext || _vaultCreateEpicRenderContext(account);
    if ((preserveScroll || scrollPolicy === 'results-start' || scrollPolicy === 'preserve-position') && controller?.host === host && typeof controller.setItems === 'function') {
        controller.setItems(visibleItems, { context, preserveAnchor: anchor, scrollPolicy });
    } else {
        controller.mount({ host, items: visibleItems, context, resetScroll, scrollPolicy });
    }
    _vaultSyncVirtualMirror(vs);
}
async function _renderVaultEpicHistoryResults(account, options = {}) {
    const box = document.getElementById('vaultEpicAccountContent') || document.getElementById('vaultEpicLibrary');
    const host = document.getElementById('vaultEpicHistoryResults') || box;
    if (!box || !host || !account) return;
    const renderJob = ++__vaultEpicHistoryRenderJob;
    const visibleItems = _vaultPrepareHistoryItems(account);
    if (!visibleItems.length) {
        _vaultClearVirtualRows(__vaultHistoryVirtual);
        host.className = '';
        host.innerHTML = `<div class="vault-empty-state"><strong>No transactions match these filters.</strong></div>`;
        return;
    }
    const context = _vaultCreateEpicRenderContext(account);
    const artworkTargets = visibleItems.map((item) => _vaultHistoryArtworkSubject(item, context));
    const firstPaintTargets = artworkTargets.slice(0, 48);
    await _vaultAwaitArtworkBoundary(_vaultPrimeLocalCovers(firstPaintTargets, context));
    await _vaultAwaitArtworkBoundary(_vaultLoadExistingGridThumbnails(firstPaintTargets, context, { limit: firstPaintTargets.length }));
    if (renderJob !== __vaultEpicHistoryRenderJob || host.isConnected === false) return;
    _vaultMountHistoryVirtual(host, account, visibleItems, { ...options, renderContext: context });
    _vaultQueueMissingCoverWarm(firstPaintTargets, context, 'epic-vault-visible-history-artwork');
    _vaultScheduleArtworkWarm(artworkTargets, context, 'epic-vault-history-artwork');
}

function _renderVaultEpicHistory(account, options = {}) {
    const box = document.getElementById('vaultEpicAccountContent') || document.getElementById('vaultEpicLibrary');
    if (!box || !account) return;
    const items = Array.isArray(account.purchaseHistoryItems) ? account.purchaseHistoryItems : [];
    const state = _vaultEpicHistoryStatus(account, items);
    box.dataset.vaultEpicPanel = 'history';
    _vaultSetStickyControlsHtml(`${_vaultAccountTabsHtml()}${_vaultHistoryToolbarHtml(items, account)}`);
    if (state) {
        _vaultClearVirtualRows(__vaultHistoryVirtual);
        box.innerHTML = _vaultEpicEmptyStateHtml(state, account);
        return;
    }
    if (!document.getElementById('vaultEpicHistoryResults')) box.innerHTML = '<div id="vaultEpicHistoryResults"></div>';
    _renderVaultEpicHistoryResults(account, options);
}

function closeVaultDropdowns(except = null) {
    document.querySelectorAll('[data-vault-dropdown].is-open').forEach((menu) => {
        if (except && menu === except) return;
        menu.classList.remove('is-open');
        menu.querySelector('.vault-select-button')?.setAttribute('aria-expanded', 'false');
    });
}

function toggleVaultDropdown(button) {
    const root = button?.closest?.('[data-vault-dropdown]');
    if (!root || root.classList.contains('is-disabled')) return;
    const willOpen = !root.classList.contains('is-open');
    closeVaultDropdowns(root);
    root.classList.toggle('is-open', willOpen);
    button.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    if (willOpen) setTimeout(() => root.querySelector('.vault-select-menu .is-selected, .vault-select-menu button')?.focus?.(), 0);
}

function selectVaultDropdownOption(setterName, value) {
    const active = document.activeElement;
    const root = active?.closest?.('[data-vault-dropdown]');
    const label = active?.textContent || '';
    closeVaultDropdowns();
    if (root && label) {
        root.querySelectorAll?.('.vault-select-menu button').forEach((button) => {
            const selected = button === active;
            button.classList.toggle('is-selected', selected);
            button.setAttribute('aria-selected', selected ? 'true' : 'false');
        });
        const buttonLabel = root.querySelector?.('.vault-select-button span');
        if (buttonLabel) buttonLabel.textContent = label;
    }
    const fn = window[setterName];
    if (typeof fn === 'function') fn(value);
}
function handleVaultDropdownKey(event, button) {
    if (!event) return;
    if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggleVaultDropdown(button);
    } else if (event.key === 'Escape') {
        closeVaultDropdowns();
        button?.focus?.();
    } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        const root = button?.closest?.('[data-vault-dropdown]');
        if (root && !root.classList.contains('is-open')) toggleVaultDropdown(button);
        root?.querySelector?.('.vault-select-menu button')?.focus?.();
    }
}

function handleVaultDropdownOptionKey(event, setterName, value) {
    if (!event) return;
    const option = event.currentTarget;
    const menu = option?.closest?.('.vault-select-menu');
    const options = [...(menu?.querySelectorAll?.('button') || [])];
    const index = options.indexOf(option);
    if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectVaultDropdownOption(setterName, value);
    } else if (event.key === 'Escape') {
        event.preventDefault();
        const trigger = option?.closest?.('[data-vault-dropdown]')?.querySelector?.('.vault-select-button');
        closeVaultDropdowns();
        trigger?.focus?.();
    } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        options[Math.min(options.length - 1, index + 1)]?.focus?.();
    } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        options[Math.max(0, index - 1)]?.focus?.();
    }
}

if (!window.__vaultDropdownOutsideBound) {
    window.__vaultDropdownOutsideBound = true;
    document.addEventListener('click', (event) => {
        if (!event.target?.closest?.('[data-vault-dropdown]')) closeVaultDropdowns();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeVaultDropdowns();
    });
}

function _vaultAccountTabsHtml() {
    return `<div class="vault-account-tabs" data-vault-account-tabs>
        <button class="${__vaultEpicSection === 'library' ? 'active' : ''}" onclick="setVaultEpicSection('library')">Library</button>
        <button class="${__vaultEpicSection === 'history' ? 'active' : ''}" onclick="setVaultEpicSection('history')">Purchase History</button>
    </div>`;
}

function _vaultPriceModeHtml() {
    if (__vaultEpicSection !== 'library') return '';
    return `<div class="vault-price-line" data-vault-price-line><span>Displayed price:</span><div class="vault-price-mode"><button class="${__vaultEpicPriceMode === 'current' ? 'active' : ''}" onclick="setVaultEpicPriceMode('current')">Current</button><button class="${__vaultEpicPriceMode === 'purchase' ? 'active' : ''}" onclick="setVaultEpicPriceMode('purchase')">Purchase</button></div></div>`;
}

function _vaultPriceLastUpdatedLabel(account = {}) {
    const date = new Date(account.pricesFetchedAt || '');
    if (Number.isNaN(date.getTime())) return 'Never';
    return date.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function _vaultPriceRefreshControlHtml(account = {}) {
    const id = String(account.accountId || '');
    const refreshing = __vaultEpicPriceRefreshingAccounts.has(id);
    const storedError = __vaultEpicPriceRefreshErrors.get(id);
    const errorAttemptId = storedError?.attemptId || '';
    const error = storedError && !_vaultIsEpicPriceWarningDismissed(id, errorAttemptId) ? storedError : null;
    const progress = __vaultEpicPriceRefreshProgress.get(id);
    const progressLabel = refreshing && Number(progress?.total) > 0 ? 'Refreshing ' + Number(progress.processed || 0) + '/' + Number(progress.total) + '...' : 'Refreshing...';
    return '<div class="vault-price-refresh-control">'
        + '<span>Prices updated: <b>' + _vaultHtml(_vaultPriceLastUpdatedLabel(account)) + '</b></span>'
        + '<button type="button" title="Fetch current Epic Store prices for this account region" '
        + (refreshing ? 'disabled aria-busy="true"' : '')
        + ' onclick="refreshVaultEpicPrices(\'' + _vaultHtml(id) + '\')">'
        + (refreshing ? _vaultHtml(progressLabel) : 'Refresh prices') + '</button>'
        + (error ? '<small>' + _vaultHtml(error.message) + '</small><details><summary>Diagnostic details</summary><code>' + _vaultHtml(error.code) + (error.failedStage ? ' at ' + _vaultHtml(error.failedStage) : '') + '</code></details><button type="button" onclick="dismissVaultEpicPriceWarning(\'' + _vaultHtml(id) + '\', \'' + _vaultHtml(errorAttemptId) + '\')">Dismiss</button>' : '')
        + '</div>';
}

function _vaultAccountSummaryHtml(account, coverage = _vaultEpicCoverage(account)) {
    const storeCurrency = _vaultStoreCurrency(account);
    const regionLabel = _vaultCountryLabel(account.pricingCountry);
    return `<div class="vault-account-titleline">
        <span class="vault-epic-account-icon"><img src="../assets/epic.svg" alt=""></span>
        <div>
            <span class="vault-platform-eyebrow">Epic Games</span>
            <h3>${_vaultHtml(account.displayName || 'Epic Account')}</h3>
            <small>${coverage.totalGames} Games</small>
        </div>
    </div>
    <div class="vault-account-meta">
        <span>Region: <b>${_vaultHtml(regionLabel)}</b>${_vaultInfo('Epic account country currently used for regional store pricing.')}</span>
        <span>Store Currency: <b>${_vaultHtml(storeCurrency)}</b>${_vaultInfo('Currency returned by Epic Store for the account\'s current region.')}</span>
        ${_vaultPriceRefreshControlHtml(account)}
    </div>`;
}

function _vaultFinanceGridHtml(account, coverage = _vaultEpicCoverage(account)) {
    const storeCurrency = _vaultStoreCurrency(account);
    const currentLabel = coverage.resolvedGames ? _vaultMinorMoney(coverage.currentValueMinor, coverage.currency || storeCurrency) : 'No prices yet';
    const hasHistory = account.permissions?.purchaseHistory === true;
    const grossHtml = hasHistory ? _vaultSpendHtml(account, 'grossPurchasesMinor') : '<span>Not imported</span>';
    const refundsHtml = hasHistory ? _vaultSpendHtml(account, 'refundsMinor') : '<span>Not imported</span>';
    const netHtml = hasHistory ? _vaultSpendHtml(account, 'netSpentMinor') : '<span>Not imported</span>';
    return [
        _vaultMetricCard('Current Library Value', `<span>${_vaultHtml(currentLabel)}</span>`, 'Current Epic Store value of the account\'s games using this account\'s current Epic region.', 'is-current'),
        _vaultMetricCard('Gross Purchases', grossHtml, 'Total value of completed paid Epic purchases before refunds.'),
        _vaultMetricCard('Refunds', refundsHtml, 'Total value returned through refunded Epic purchases.'),
        _vaultMetricCard('Net Spent', netHtml, 'Completed purchases minus refunds. Multiple currencies are shown separately.', 'is-net'),
    ].join('');
}

function _vaultPatchEpicAccountShell(account) {
    if (!account) return;
    const coverage = _vaultEpicCoverage(account);
    const summary = document.querySelector?.('[data-vault-account-summary]');
    if (summary) summary.innerHTML = _vaultAccountSummaryHtml(account, coverage);
    const finance = document.querySelector?.('[data-vault-finance-grid]');
    if (finance) finance.innerHTML = _vaultFinanceGridHtml(account, coverage);
}

function _vaultSetStickyControlsHtml(html) {
    const sticky = document.getElementById('vaultEpicStickyControls');
    if (sticky) sticky.innerHTML = html || '';
}
function _renderVaultEpicAccountDetail(account, options = {}) {
    const box = document.getElementById('vaultEpicLibrary');
    if (!box || !account) return;
    _setVaultState('account', 'epic');
    document.querySelectorAll('.vault-platform-card.active').forEach(el => el.classList.remove('active'));
    document.getElementById('vault-card-epic')?.classList.add('active');
    box.style.display = 'block';

    if (options.preserveScroll && box.querySelector?.('.vault-epic-detail')) {
        _vaultPatchEpicAccountShell(account);
        if (__vaultEpicSection === 'history') _renderVaultEpicHistory(account, { preserveScroll: true, scrollPolicy: 'preserve-anchor' });
        else _renderVaultEpicLibrary(account, { preserveScroll: true, scrollPolicy: 'preserve-anchor' });
        return;
    }

    const coverage = _vaultEpicCoverage(account);
    const progressState = _vaultEpicProgressState(account.accountId);
    const firstPending = progressState?.isFirstFullImport && progressState?.overallStatus === 'library_ready_enriching';
    const financeHtml = firstPending
        ? '<div class="vault-enrichment-placeholder"><strong>Calculating Vault values</strong><span>Prices and purchase history will appear here as each phase finishes.</span></div>'
        : _vaultFinanceGridHtml(account, coverage);
    box.innerHTML = `<div class="vault-account-shell vault-epic-detail" data-vault-account-id="${_vaultHtml(account.accountId || '')}">
        <div class="vault-account-nav"><button class="vault-back-btn" onclick="backToVaultEpicAccounts()">← Epic Accounts</button><button type="button" class="vault-showcase-export-btn" onclick="exportVaultShowcase()" aria-label="Share Vault"><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4"></path></svg><span>Share Vault</span></button></div>
        <div id="vaultEpicProgressNotice">${_vaultEpicProgressNoticeHtml(account.accountId)}</div>
        <span data-vault-epic-progress-text class="vault-epic-progress-label">${_vaultHtml(_vaultEpicProgressSummary(account.accountId))}</span>
        <section class="vault-account-summary" data-vault-account-summary>${_vaultAccountSummaryHtml(account, coverage)}</section>
        <section class="vault-finance-grid" data-vault-finance-grid>${financeHtml}</section>
        <div class="vault-epic-sticky-panel" id="vaultEpicStickyControls"></div>
        <div id="vaultEpicAccountContent"></div>
    </div>`;
    const contentOptions = options.accountNavigationRevision
        ? { resetScroll: false, scrollPolicy: 'preserve-position' }
        : { resetScroll: options.resetScroll !== false, scrollPolicy: options.scrollPolicy };
    if (__vaultEpicSection === 'history') _renderVaultEpicHistory(account, contentOptions);
    else _renderVaultEpicLibrary(account, contentOptions);
    if (options.accountNavigationRevision) {
        _vaultResetAccountPageScroll(options.accountNavigationRevision, account.accountId);
    }
}

function _vaultUpdateEpicAccountControlState() {
    const shell = document.querySelector?.('.vault-epic-detail');
    if (!shell) return;
    shell.querySelectorAll?.('.vault-price-mode button').forEach((button) => {
        const mode = (button.textContent || '').trim().toLowerCase();
        button.classList?.toggle('active', mode === __vaultEpicPriceMode);
    });
    shell.querySelectorAll?.('.vault-account-tabs button').forEach((button) => {
        const section = (button.textContent || '').toLowerCase().includes('history') ? 'history' : 'library';
        button.classList?.toggle('active', section === __vaultEpicSection);
    });
}
function _renderVaultEpicFromCache(options = {}) {
    __vaultEpicFullRenderCount += 1;
    const accounts = Array.isArray(__vaultEpicDataCache?.accounts) ? __vaultEpicDataCache.accounts : [];
    if (!__vaultSelectedEpicAccountId) {
        _renderVaultEpicAccounts(accounts);
        return;
    }
    const account = accounts.find((item) => String(item.accountId) === String(__vaultSelectedEpicAccountId));
    if (!account) {
        __vaultSelectedEpicAccountId = null;
        _renderVaultEpicAccounts(accounts);
        return;
    }
    _renderVaultEpicAccountDetail(account, options);
}

function invalidateEpicVaultCache(refresh = false, options = {}) {
    __vaultEpicCacheDirty = true;
    const reason = options.reason || 'background-sync-complete';
    __vaultHydrationDiagnostics.push({ at: new Date().toISOString(), stage: 'renderer.cache.dirty', reason, currentView: typeof currentView === 'undefined' ? null : currentView, selectedAccountPresent: Boolean(__vaultSelectedEpicAccountId) });
    if (__vaultHydrationDiagnostics.length > 50) __vaultHydrationDiagnostics.splice(0, __vaultHydrationDiagnostics.length - 50);
    if (refresh && (typeof currentView === 'undefined' || currentView === 'vault')) {
        return _vaultScheduleEpicVaultRefresh({ reason, preserveScroll: options.preserveScroll !== false });
    }
    return Promise.resolve();
}

function _vaultScheduleEpicVaultRefresh(options = {}) {
    const reason = options.reason || 'background-sync-complete';
    const preserveScroll = options.preserveScroll !== false && /background|sync|committed|library|metadata|artwork|snapshot|invalidation/i.test(reason);
    if (__vaultEpicRefreshPromise) {
        __vaultEpicRefreshQueued = true;
        return __vaultEpicRefreshPromise;
    }
    __vaultEpicRefreshPromise = (async () => {
        do {
            __vaultEpicRefreshQueued = false;
            await hydrateEpicVaultConsole(true, { ...options, reason, preserveScroll });
        } while (__vaultEpicRefreshQueued);
    })().finally(() => { __vaultEpicRefreshPromise = null; });
    return __vaultEpicRefreshPromise;
}

function _vaultCurrentArtworkItems() {
    const account = _vaultSelectedEpicAccount();
    const items = [];
    if (__vaultEpicSection === 'history') items.push(...(__vaultHistoryVirtual.items || []));
    else items.push(...(__vaultLibraryVirtual.items || []));
    if (!items.length && account) items.push(..._vaultPrepareLibraryGames(account, _vaultBuildPurchaseMap(account)));
    return { account, items };
}

function _vaultPatchReadyArtworkBatch(payload = {}) {
    const changed = new Set((Array.isArray(payload.changedCanonicalIds) ? payload.changedCanonicalIds : []).map(String));
    if (!changed.size) return;
    const { account, items } = _vaultCurrentArtworkItems();
    if (!account || !items.length) return;
    const matches = items.filter((item) => {
        const record = _vaultArtworkRecord(item, account, true);
        if (!record) return false;
        if (changed.has(record.key)) return true;
        return (record.aliases || []).some((alias) => changed.has(String(alias)));
    });
    if (matches.length) _vaultPrimeLocalCovers(matches, account).catch?.(() => {});
}

if (window.electronAPI?.onColdCoverBootstrapBatch && !window.__vaultColdCoverBootstrapBatchAttached) {
    window.__vaultColdCoverBootstrapBatchAttached = true;
    window.electronAPI.onColdCoverBootstrapBatch((payload) => _vaultPatchReadyArtworkBatch(payload));
}

async function _vaultTrackAccountActivation(accounts = [], platform = 'epic') {
    if (!Array.isArray(accounts) || accounts.length === 0) return;
    const safePlatform = String(platform || 'unknown').toLowerCase();
    const storageKey = `baddel.analytics.vault_account_activated.${safePlatform}`;
    try {
        if (localStorage.getItem(storageKey) === '1') return;
        if (!await window.electronAPI?.isAnalyticsEnabled?.()) return;
        const accepted = await window.electronAPI?.trackFeatureEvent?.('vault_account_activated', {
            feature: 'vault', platform: safePlatform, result: 'success',
        });
        if (accepted) localStorage.setItem(storageKey, '1');
    } catch (_) {}
}

async function hydrateEpicVaultConsole(force = false, options = {}) {
    const box = document.getElementById('vaultEpicLibrary');
    const preserveScroll = options.preserveScroll === true;
    const refreshSeq = ++__vaultEpicRefreshSeq;
    const activeVaultController = __vaultEpicSection === 'history' ? __vaultHistoryVirtual.controller : __vaultLibraryVirtual.controller;
    const preserveAnchor = preserveScroll ? activeVaultController?.captureAnchor?.() : null;
    const expectedAccountId = __vaultSelectedEpicAccountId;
    const expectedState = __vaultState;
    const expectedSection = __vaultEpicSection;
    const expectedNavigationRevision = __vaultEpicAccountNavigationRevision;
    if (!force && __vaultEpicDataCache && !__vaultEpicCacheDirty) {
        if (__vaultState === 'overview') _renderVaultOverview();
        else _renderVaultEpicFromCache(options);
        return;
    }
    if (box && !__vaultEpicDataCache && __vaultState !== 'overview') {
        box.style.display = 'block';
        box.innerHTML = '<div class="vault-empty-state"><span>Reading Epic Vault data...</span></div>';
    }
    const recordBoundary = (stage, payload = {}) => {
        const entry = { at: new Date().toISOString(), refreshSeq, stage, ...payload };
        __vaultHydrationDiagnostics.push(entry);
        if (__vaultHydrationDiagnostics.length > 50) __vaultHydrationDiagnostics.splice(0, __vaultHydrationDiagnostics.length - 50);
        window.__vaultHydrationDiagnostics = __vaultHydrationDiagnostics.slice();
        try { if (localStorage.getItem('baddel_debug_vault') === '1') console.info('[VaultHydrationRenderer]', entry); } catch {}
    };
    const startedAt = performance.now();
    recordBoundary('renderer.invoke.start', { reason: options.reason || 'unspecified' });
    try {
        const client = window.VaultHydrationClient;
        if (!client?.requestSnapshot) {
            const error = new Error('The Vault hydration client did not load.');
            error.code = 'VAULT_CLIENT_MISSING';
            throw error;
        }
        const res = await client.requestSnapshot(window.electronAPI, { expectedUserDataPath: __vaultEpicUserDataPath, timeoutMs: 10000 });
        recordBoundary('renderer.invoke.resolved', { durationMs: Math.round((performance.now() - startedAt) * 100) / 100, main: res.diagnostics || null });
        if (refreshSeq !== __vaultEpicRefreshSeq) {
            recordBoundary('renderer.response.rejected', { reason: 'superseded_sequence' });
            return;
        }
        const previousSnapshot = __vaultEpicDataCache;
        const nextSnapshot = res.vault;
        const nextRevision = Number(window.VaultOverviewModel?.vaultSnapshotRevision?.(nextSnapshot) || 0);
        const acceptsRevision = window.VaultOverviewModel?.shouldAcceptVaultSnapshot
            ? window.VaultOverviewModel.shouldAcceptVaultSnapshot({ incomingRevision: nextRevision, acceptedRevision: __vaultEpicAcceptedRevision, requiredRevision: __vaultEpicRequiredRevision })
            : nextRevision >= __vaultRequiredRevisionForHydration();
        if (!acceptsRevision && previousSnapshot) {
            recordBoundary('renderer.response.rejected', { reason: 'stale_revision', incomingRevision: nextRevision, acceptedRevision: __vaultEpicAcceptedRevision, requiredRevision: __vaultEpicRequiredRevision });
            return;
        }
        const nextAccounts = Array.isArray(nextSnapshot.accounts) ? nextSnapshot.accounts.slice() : [];
        const selectionRemoved = Boolean(expectedAccountId && !nextAccounts.some((account) => String(account.accountId) === String(expectedAccountId)));
        if (selectionRemoved) {
            __vaultSelectedEpicAccountId = null;
            __vaultState = 'platform';
            __vaultSelectedPlatform = 'epic';
            recordBoundary('renderer.selection.cleared', { reason: 'account_removed' });
        }
        __vaultEpicDataCache = { ...nextSnapshot, accounts: nextAccounts };
        _vaultTrackAccountActivation(nextAccounts, 'epic');
        _vaultReconcileProgressWithCommittedVault();
        __vaultEpicCacheDirty = false;
        __vaultEpicAcceptedRevision = Math.max(__vaultEpicAcceptedRevision, nextRevision);
        __vaultEpicUserDataPath = String(res.diagnostics?.userDataPath || __vaultEpicUserDataPath || '');
        __vaultOverviewError = null;
        window.__vaultLastHydrationDiagnostic = res.diagnostics || null;
        recordBoundary('renderer.cache.updated', { accounts: nextAccounts.length, revision: nextRevision });
        if (selectionRemoved || !(preserveScroll && (expectedState !== __vaultState || expectedAccountId !== __vaultSelectedEpicAccountId || expectedSection !== __vaultEpicSection))) {
            if (__vaultState === 'overview') _renderVaultOverview();
            else {
                const navigationChanged = expectedNavigationRevision !== __vaultEpicAccountNavigationRevision;
                _renderVaultEpicFromCache(navigationChanged ? {
                    ...options,
                    anchor: null,
                    preserveScroll: false,
                    resetScroll: false,
                    scrollPolicy: 'preserve-position',
                    accountNavigationRevision: __vaultEpicAccountNavigationRevision,
                } : { ...options, anchor: preserveAnchor });
            }
            recordBoundary('renderer.render.complete', { state: __vaultState, accounts: nextAccounts.length });
        }
        client.requestProgress(window.electronAPI, { timeoutMs: 2500 }).then((progressRes) => {
            if (refreshSeq !== __vaultEpicRefreshSeq) return;
            const incomingProgressStates = progressRes?.state && typeof progressRes.state === 'object' ? progressRes.state : {};
            for (const [accountId, incomingState] of Object.entries(incomingProgressStates)) {
                const existingState = __vaultEpicProgressStates[accountId];
                const incomingStateRevision = Number(incomingState?.revision || 0);
                const existingStateRevision = Number(existingState?.revision || 0);
                if (incomingStateRevision > existingStateRevision || (incomingStateRevision === existingStateRevision && (!existingState?.syncRunId || String(existingState.syncRunId) === String(incomingState?.syncRunId)))) {
                    __vaultEpicProgressStates[accountId] = _vaultMergeEpicProgressState(existingState, incomingState);
                }
            }
            _vaultReconcileProgressWithCommittedVault();
            recordBoundary('renderer.progress.settled', { status: progressRes?.status || 'success' });
            if (__vaultState === 'overview') _renderVaultOverview();
            else if (expectedState === __vaultState && expectedAccountId === __vaultSelectedEpicAccountId && expectedSection === __vaultEpicSection) _renderVaultEpicFromCache({ ...options, anchor: preserveAnchor });
        }).catch(() => {});
    } catch (err) {
        const code = err?.code || 'VAULT_LOAD_FAILED';
        __vaultOverviewError = { code, message: err?.message || 'Could not load the saved Vault snapshot.' };
        recordBoundary('renderer.invoke.failed', { durationMs: Math.round((performance.now() - startedAt) * 100) / 100, errorCode: code });
        if (__vaultState === 'overview') _renderVaultOverview();
        else if (!__vaultEpicDataCache && box) box.innerHTML = '<div class="vault-empty-state is-error"><strong>Could not read Epic Vault data</strong><span>' + _vaultHtml(__vaultOverviewError.message) + ' [' + _vaultHtml(code) + ']</span></div>';
    }
}
function __vaultRequiredRevisionForHydration() {
    return Math.max(__vaultEpicAcceptedRevision, __vaultEpicRequiredRevision);
}

function retryVaultOverviewHydration() {
    return _vaultScheduleEpicVaultRefresh({ reason: 'overview-retry', preserveScroll: false });
}

function setVaultEpicPriceMode(mode) {
    __vaultEpicPriceMode = ['current', 'purchase'].includes(mode) ? mode : 'current';
    _vaultEffectiveLibraryFilter();
    localStorage.setItem('baddelVaultEpicPriceMode', __vaultEpicPriceMode);
    _vaultUpdateEpicAccountControlState();
    const account = _vaultSelectedEpicAccount();
    if (account && __vaultEpicSection === 'library') {
        _renderVaultEpicLibrary(account, { scrollPolicy: 'results-start' });
        return;
    }
    _renderVaultEpicFromCache({ scrollPolicy: 'results-start' });
}

function setVaultEpicSection(section) {
    __vaultEpicSection = section === 'history' ? 'history' : 'library';
    if (__vaultEpicSection !== 'history') _vaultClearEpicHistoryNotice();
    const account = _vaultSelectedEpicAccount();
    if (account && document.querySelector?.('.vault-epic-detail')) {
        if (__vaultEpicSection === 'history') _renderVaultEpicHistory(account, { scrollPolicy: 'results-start' });
        else _renderVaultEpicLibrary(account, { scrollPolicy: 'results-start' });
        _vaultUpdateEpicAccountControlState();
        return;
    }
    _renderVaultEpicFromCache({ scrollPolicy: 'results-start' });
}

function setVaultEpicLibrarySort(sort) {
    __vaultEpicLibrarySort = ['price_desc', 'price_asc', 'name_asc', 'name_desc', 'discount_desc'].includes(sort) ? sort : 'price_desc';
    localStorage.setItem('baddelVaultEpicLibrarySort', __vaultEpicLibrarySort);
    const account = _vaultSelectedEpicAccount();
    if (account) _renderVaultEpicLibraryResults(account, { scrollPolicy: 'results-start' });
}
function setVaultEpicLibraryFilter(filter) {
    _vaultSetEffectiveLibraryFilter(filter);
    const account = _vaultSelectedEpicAccount();
    if (account) _renderVaultEpicLibraryResults(account, { scrollPolicy: 'results-start' });
}
function setVaultEpicLibrarySearch(value) {
    __vaultEpicLibrarySearch = String(value || '');
    clearTimeout(__vaultEpicLibrarySearchTimer);
    __vaultEpicLibrarySearchTimer = setTimeout(() => {
        const account = _vaultSelectedEpicAccount();
        if (account) _renderVaultEpicLibraryResults(account, { scrollPolicy: 'results-start' });
    }, 120);
}

function setVaultEpicHistorySort(sort) {
    __vaultEpicHistorySort = ['amount_desc', 'amount_asc', 'newest', 'oldest', 'name_asc'].includes(sort) ? sort : 'amount_desc';
    localStorage.setItem('baddelVaultEpicHistorySort', __vaultEpicHistorySort);
    _renderVaultEpicHistory(_vaultSelectedEpicAccount(), { scrollPolicy: 'results-start' });
}

function setVaultEpicHistoryFilter(filter) {
    __vaultEpicHistoryFilter = ['all', 'paid', 'refunds', 'free', 'fab'].includes(filter) ? filter : 'all';
    const account = _vaultSelectedEpicAccount();
    if (account) _renderVaultEpicHistory(account, { scrollPolicy: 'results-start' });
}

function setVaultEpicHistoryCurrency(currency) {
    __vaultEpicHistoryCurrency = String(currency || 'all').toUpperCase();
    if (__vaultEpicHistoryCurrency === 'ALL') __vaultEpicHistoryCurrency = 'all';
    const account = _vaultSelectedEpicAccount();
    if (account) _renderVaultEpicHistory(account, { scrollPolicy: 'results-start' });
}

function setVaultEpicHistorySearch(value) {
    __vaultEpicHistorySearch = String(value || '');
    clearTimeout(__vaultEpicHistorySearchTimer);
    __vaultEpicHistorySearchTimer = setTimeout(() => {
        const account = _vaultSelectedEpicAccount();
        if (account) _renderVaultEpicHistoryResults(account, { scrollPolicy: 'results-start' });
    }, 120);
}

function _vaultEpicHistoryNoticeHtml(account = {}) {
    const notice = __vaultEpicHistoryNotice;
    if (!notice || String(notice.accountId || '') !== String(account.accountId || '')) return '<div id="vaultEpicHistoryNotice"></div>';
    const actions = (notice.actions || []).map((action) => `<button type="button" class="${action.primary ? 'is-primary' : ''}" onclick="${action.handler}">${_vaultHtml(action.label)}</button>`).join('');
    const details = notice.code
        ? `<details><summary>Diagnostic details</summary><code>${_vaultHtml(notice.code)}${notice.failedStage ? ` at ${_vaultHtml(notice.failedStage)}` : ''}</code></details>`
        : '';
    return `<div id="vaultEpicHistoryNotice" class="vault-history-notice is-${_vaultHtml(notice.kind || 'info')}" role="status">
        <div><strong>${_vaultHtml(notice.title || '')}</strong><span>${_vaultHtml(notice.body || '')}</span>${details}</div>
        ${actions ? `<div class="vault-history-notice-actions">${actions}</div>` : ''}
    </div>`;
}

function _vaultSetEpicHistoryNotice(notice = null) {
    clearTimeout(__vaultEpicHistorySuccessTimer);
    __vaultEpicHistoryNotice = notice;
    const account = _vaultSelectedEpicAccount();
    if (account && __vaultEpicSection === 'history') _renderVaultEpicHistory(account, { preserveScroll: true, scrollPolicy: 'preserve-anchor' });
}

function dismissVaultEpicHistoryNotice() {
    _vaultSetEpicHistoryNotice(null);
}

function _vaultClearEpicHistoryNotice() {
    clearTimeout(__vaultEpicHistorySuccessTimer);
    __vaultEpicHistoryNotice = null;
}

function _vaultEpicHistoryErrorNotice(result, account = {}) {
    const accountName = account.displayName || result?.accountDisplayName || 'this Epic account';
    const common = {
        accountId: account.accountId || __vaultSelectedEpicAccountId,
        code: result?.code || 'EPIC_HISTORY_FETCH_FAILED',
        failedStage: result?.failedStage || result?.diagnostics?.at?.(-1)?.stage || '',
    };
    if (result?.code === 'EPIC_ACCOUNT_MISMATCH') {
        return {
            ...common,
            kind: 'warning',
            title: 'Different Epic account detected',
            body: `You signed in with a different Epic account. To protect your Purchase History, Baddel did not update ${accountName}.`,
            actions: [
                { label: `Sign in with ${accountName}`, primary: true, handler: `refreshVaultEpicPurchaseHistory('${_vaultHtml(common.accountId)}')` },
                { label: 'Cancel', handler: 'dismissVaultEpicHistoryNotice()' },
            ],
        };
    }
    if (result?.code === 'EPIC_REAUTH_REQUIRED') {
        return {
            ...common,
            kind: 'warning',
            title: 'Epic sign-in required',
            body: `Sign in again to refresh Purchase History for ${accountName}. Your saved Purchase History was not changed.`,
            actions: [
                { label: 'Sign in', primary: true, handler: `refreshVaultEpicPurchaseHistory('${_vaultHtml(common.accountId)}')` },
                { label: 'Dismiss', handler: 'dismissVaultEpicHistoryNotice()' },
            ],
        };
    }
    const failedAfterLogin = result?.code === 'EPIC_POST_LOGIN_SESSION_NOT_READY'
        || (result?.code === 'EPIC_IDENTITY_CHECK_FAILED' && result?.failedStage === 'post_login_identity_check');
    if (failedAfterLogin) {
        return {
            ...common,
            kind: 'error',
            title: "Couldn't complete Epic sign-in",
            body: 'Epic accepted the sign-in, but Baddel could not verify the account session. Your existing Purchase History was not changed.',
            actions: [
                { label: 'Try again', primary: true, handler: `refreshVaultEpicPurchaseHistory('${_vaultHtml(common.accountId)}')` },
                { label: 'Dismiss', handler: 'dismissVaultEpicHistoryNotice()' },
            ],
        };
    }
    const mappings = {
        EPIC_HISTORY_NETWORK_ERROR: {
            title: "Couldn't connect to Epic",
            body: 'Your saved Purchase History is safe. Check your connection and try again.',
        },
        EPIC_HISTORY_REQUEST_TIMEOUT: {
            title: 'Epic took too long to respond',
            body: 'Your saved Purchase History is safe. Check your connection and try again.',
        },
        EPIC_HISTORY_DEADLINE_EXCEEDED: {
            title: 'Epic took too long to respond',
            body: 'Your saved Purchase History is safe. Try again in a moment.',
        },
        EPIC_HISTORY_SERVICE_UNAVAILABLE: {
            title: 'Epic is temporarily unavailable',
            body: 'Epic returned a server error. Your saved Purchase History was not changed.',
        },
        EPIC_IDENTITY_ENDPOINT_UNAVAILABLE: {
            title: 'Epic returned an unexpected response',
            body: 'Baddel tried both available session checks. Your saved Purchase History was not changed.',
        },
        EPIC_HISTORY_INVALID_RESPONSE: {
            title: 'Epic returned an unexpected response',
            body: 'The response could not be used safely, so your saved Purchase History was not changed.',
        },
    };
    const mapped = mappings[result?.code] || {
        title: "Couldn't refresh Purchase History",
        body: 'Your saved Purchase History was not changed. Try again in a moment.',
    };
    return {
        ...common,
        kind: 'error',
        title: mapped.title,
        body: mapped.body,
        actions: [
            { label: 'Try again', primary: true, handler: `refreshVaultEpicPurchaseHistory('${_vaultHtml(common.accountId)}')` },
            { label: 'Dismiss', handler: 'dismissVaultEpicHistoryNotice()' },
        ],
    };
}

function _vaultOpenEpicReauthPrompt(account = {}) {
    const modal = document.getElementById('vaultEpicAuthModal');
    if (!modal) return Promise.resolve(false);
    if (__vaultEpicAuthPromptResolve) __vaultEpicAuthPromptResolve(false);
    const name = account.displayName || 'this Epic account';
    document.getElementById('vaultEpicAuthTitle').textContent = 'Epic sign-in required';
    document.getElementById('vaultEpicAuthMessage').textContent = `Epic needs you to sign in again before Baddel can refresh Purchase History for ${name}. This does not unlink your Epic account, and your existing Purchase History will remain unchanged if you cancel.`;
    document.getElementById('vaultEpicAuthActions').hidden = false;
    document.getElementById('vaultEpicAuthWaiting').hidden = true;
    modal.classList.add('active');
    return new Promise((resolve) => { __vaultEpicAuthPromptResolve = resolve; });
}

function resolveVaultEpicReauthPrompt(approved) {
    const resolve = __vaultEpicAuthPromptResolve;
    __vaultEpicAuthPromptResolve = null;
    if (!approved) document.getElementById('vaultEpicAuthModal')?.classList.remove('active');
    resolve?.(approved === true);
}

function _vaultShowEpicAuthWaiting(account = {}) {
    const name = account.displayName || 'this Epic account';
    document.getElementById('vaultEpicAuthTitle').textContent = 'Waiting for Epic sign-in';
    document.getElementById('vaultEpicAuthMessage').textContent = `Finish signing in as ${name}. Baddel will continue the refresh automatically.`;
    document.getElementById('vaultEpicAuthActions').hidden = true;
    document.getElementById('vaultEpicAuthWaiting').hidden = false;
    document.getElementById('vaultEpicAuthModal')?.classList.add('active');
}

function _vaultCloseEpicAuthModal() {
    document.getElementById('vaultEpicAuthModal')?.classList.remove('active');
    const waiting = document.getElementById('vaultEpicAuthWaiting');
    const actions = document.getElementById('vaultEpicAuthActions');
    if (waiting) waiting.hidden = true;
    if (actions) actions.hidden = false;
}

async function refreshVaultEpicPurchaseHistory(accountId = __vaultSelectedEpicAccountId) {
    const id = accountId || __vaultSelectedEpicAccountId || null;
    if (__vaultEpicHistoryRefreshing || !id) return;
    const previousScrollTop = Number(document.getElementById('mainContentArea')?.scrollTop || 0);
    const account = _vaultSelectedEpicAccount() || { accountId: id, displayName: 'this Epic account' };
    const operationId = globalThis.crypto?.randomUUID?.()
        || `history-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let result = null;
    __vaultEpicHistoryOperationId = operationId;
    __vaultEpicHistoryRefreshing = true;
    _vaultClearEpicHistoryNotice();
    if (__vaultEpicSection === 'history') _renderVaultEpicHistory(account, { preserveScroll: true, scrollPolicy: 'preserve-anchor' });
    try {
        result = await window.electronAPI?.platformSyncRefreshEpicPurchaseHistory?.(id, {
            allowInteractiveLogin: false,
            operationId,
        });
        if (result?.status === 'reauth_required') {
            const approved = await _vaultOpenEpicReauthPrompt(account);
            if (!approved) return { status: 'cancelled', code: 'EPIC_LOGIN_CANCELLED' };
            _vaultShowEpicAuthWaiting(account);
            result = await window.electronAPI?.platformSyncRefreshEpicPurchaseHistory?.(id, {
                allowInteractiveLogin: true,
                operationId,
            });
        }
        if (result?.code === 'EPIC_LOGIN_CANCELLED') return { status: 'cancelled', code: result.code };
        if (!result || result.status !== 'success') {
            _vaultSetEpicHistoryNotice(_vaultEpicHistoryErrorNotice(result, account));
            return result || { status: 'error', code: 'EPIC_HISTORY_FETCH_FAILED' };
        }
        __vaultEpicHistoryNotice = {
            accountId: id,
            kind: 'success',
            title: `Purchase History updated - ${Number(result.ordersCount || result.purchaseHistoryItemsCount || 0)} transactions`,
            body: '',
            actions: [],
        };
        const hydrationStartedAt = performance.now();
        await hydrateEpicVaultConsole(true, { reason: 'epic-history-committed', preserveScroll: true });
        await window.electronAPI?.platformSyncConfirmEpicPurchaseHistoryHydrated?.(id, operationId, {
            durationMs: Math.round((performance.now() - hydrationStartedAt) * 100) / 100,
        });
        __vaultEpicHistorySuccessTimer = setTimeout(() => {
            if (__vaultEpicHistoryNotice?.kind === 'success' && String(__vaultEpicHistoryNotice.accountId) === String(id)) {
                _vaultSetEpicHistoryNotice(null);
            }
        }, 5000);
        return result;
    } catch (error) {
        console.error('[Epic Vault] Purchase history refresh failed', error?.code || '', error?.message || error);
        result = { status: 'error', code: error?.code || 'EPIC_HISTORY_FETCH_FAILED', failedStage: error?.failedStage, message: error?.message || String(error) };
        _vaultSetEpicHistoryNotice(_vaultEpicHistoryErrorNotice(result, account));
        return result;
    } finally {
        if (__vaultEpicHistoryOperationId === operationId) {
            _vaultCloseEpicAuthModal();
            __vaultEpicHistoryRefreshing = false;
            __vaultEpicHistoryOperationId = null;
        }
        const stillVisible = (typeof currentView === 'undefined' || currentView === 'vault')
            && String(__vaultSelectedEpicAccountId || '') === String(id)
            && __vaultEpicSection === 'history';
        if (stillVisible) {
            const refreshedAccount = _vaultSelectedEpicAccount() || account;
            _renderVaultEpicHistory(refreshedAccount, { preserveScroll: true, scrollPolicy: 'preserve-anchor' });
            requestAnimationFrame(() => {
                const scroller = document.getElementById('mainContentArea');
                if (scroller) scroller.scrollTop = previousScrollTop;
            });
        }
    }
}

async function connectVaultEpicPurchaseHistory() {
    return refreshVaultEpicPurchaseHistory(__vaultSelectedEpicAccountId);
}

function _vaultResetAccountPageScroll(revision, accountId) {
    const reset = () => {
        if (revision !== __vaultEpicAccountNavigationRevision) return;
        if (String(__vaultSelectedEpicAccountId || '') !== String(accountId || '')) return;
        const scroller = document.getElementById('mainContentArea');
        if (scroller) scroller.scrollTop = 0;
    };
    reset();
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(reset);
    else reset();
}

function selectVaultEpicAccount(accountId) {
    _vaultClearEpicHistoryNotice();
    __vaultSelectedEpicAccountId = String(accountId || '');
    __vaultEpicSection = 'library';
    const revision = ++__vaultEpicAccountNavigationRevision;
    _renderVaultEpicFromCache({
        resetScroll: false,
        scrollPolicy: 'preserve-position',
        accountNavigationRevision: revision,
    });
    _vaultResetAccountPageScroll(revision, __vaultSelectedEpicAccountId);
}

function backToVaultEpicAccounts() {
    _vaultClearEpicHistoryNotice();
    __vaultSelectedEpicAccountId = null;
    __vaultEpicSection = 'library';
    _renderVaultEpicFromCache();
}

function backToVaultPlatforms() {
    _vaultClearEpicHistoryNotice();
    _renderVaultOverview();
}

function selectVaultPlatform(platform) {
    const key = normalizeVaultPlatform(platform);
    if (key === 'overview' || !key) {
        _renderVaultOverview();
        _vaultScheduleEpicVaultRefresh({ reason: 'overview-open', preserveScroll: false }).catch?.(() => {});
        return;
    }
    __vaultSelectedEpicAccountId = null;
    __vaultEpicSection = 'library';
    if (key === 'epic') {
        _setVaultState('platform', 'epic');
        if (__vaultEpicRefreshPromise) {
            __vaultEpicRefreshPromise.then(() => {
                if (__vaultState === 'platform' && __vaultSelectedPlatform === 'epic') hydrateEpicVaultConsole(false);
            }).catch(() => {});
        } else {
            hydrateEpicVaultConsole(false);
        }
        return;
    }
    _renderVaultOverview();
}

function triggerVaultDoorTransition() {
    const page = document.getElementById('vaultPage');
    if (!page) return;
    page.classList.remove('vault-ready', 'vault-unsealing');
    void page.offsetWidth;
    page.classList.add('vault-unsealing');
    window.clearTimeout(window.__vaultDoorTimer);
    window.__vaultDoorTimer = window.setTimeout(() => {
        page.classList.remove('vault-unsealing');
        page.classList.add('vault-ready');
    }, 760);
}

function openVaultPlatform(platform) {
    window.electronAPI?.trackFeatureEvent?.('feature_viewed', { feature: 'vault', view: 'vault', platform }).catch?.(() => {});
    bindVaultPlatformGridClicks();
    bindVaultBackToTop();
    window.agReadyOnly = false;
    if (typeof currentView !== 'undefined') currentView = 'vault';
    if (typeof currentAccountPlatform !== 'undefined') currentAccountPlatform = null;
    if (typeof currentFilters !== 'undefined') {
        currentFilters.collectionId = null;
        currentFilters.platform = 'all';
        currentFilters.search = '';
    }

    if (typeof _hideAllViews === 'function') _hideAllViews();
    const vaultView = document.getElementById('vaultView');
    if (vaultView) vaultView.style.display = 'block';
    const main = document.getElementById('mainContentArea');
    if (main) main.scrollTop = 0;

    try {
        selectVaultPlatform(platform);
        triggerVaultDoorTransition();
        updateSidebarActiveState();
        if (typeof syncSidebarActionButton === 'function') syncSidebarActionButton();
    } catch (err) {
        console.error(`[Vault] Failed to open platform ${platform}: ${err?.message || err}`);
        const box = document.getElementById('vaultEpicLibrary');
        if (box) {
            box.style.display = 'block';
            box.innerHTML = `<div class="vault-empty-state is-error"><strong>Could not open Vault platform</strong><span>${_vaultHtml(err?.message || err)}</span></div>`;
        }
    }
}


function bindVaultPlatformGridClicks() {
    const grid = document.getElementById('vaultPlatformGrid');
    if (!grid || grid.dataset.boundVaultClicks === '1') return;
    grid.dataset.boundVaultClicks = '1';
    grid.addEventListener('click', (event) => {
        const card = event.target?.closest?.('.vault-platform-card');
        if (!card || !grid.contains(card) || card.disabled || card.getAttribute?.('aria-disabled') === 'true') return;
        const platform = card.dataset.vaultPlatform;
        if (!platform) return;
        event.preventDefault();
        openVaultPlatform(platform);
    });
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindVaultPlatformGridClicks, { once: true });
    } else {
        bindVaultPlatformGridClicks();
    }
}
function _vaultPatchEpicProgressDom(payload = {}) {
    __vaultEpicProgressDomPatchCount += 1;
    const accountId = String(payload.accountId || '');
    if (String(__vaultSelectedEpicAccountId || '') !== accountId) return;
    const phase = payload.phase;
    if (phase === 'prices') {
        document.querySelectorAll?.('[data-vault-epic-progress-prices]').forEach((node) => { node.textContent = _vaultEpicPhaseProgressText(accountId, 'prices'); });
    } else if (phase === 'purchaseHistory') {
        document.querySelectorAll?.('[data-vault-epic-progress-history]').forEach((node) => { node.textContent = _vaultEpicPhaseProgressText(accountId, 'purchaseHistory'); });
    }
    const label = _vaultEpicProgressSummary(accountId);
    document.querySelectorAll?.('[data-vault-epic-progress-text]').forEach((node) => { node.textContent = label; });
}

function _vaultScheduleEpicBatchReconcile() {
    if (__vaultEpicBatchReconcileTimer) return;
    const intervalMs = 5000;
    const delay = Math.max(0, intervalMs - (Date.now() - __vaultEpicLastBatchReconcileAt));
    __vaultEpicBatchReconcileTimer = setTimeout(() => {
        __vaultEpicBatchReconcileTimer = null;
        __vaultEpicLastBatchReconcileAt = Date.now();
        __vaultEpicVaultReconcileCount += 1;
        invalidateEpicVaultCache(true, { reason: 'epic-enrichment-batch', preserveScroll: true }).catch?.(() => {});
    }, delay);
}

function _vaultReconcileEpicTerminal() {
    if (__vaultEpicBatchReconcileTimer) {
        clearTimeout(__vaultEpicBatchReconcileTimer);
        __vaultEpicBatchReconcileTimer = null;
    }
    __vaultEpicLastBatchReconcileAt = Date.now();
    __vaultEpicVaultReconcileCount += 1;
    invalidateEpicVaultCache(true, { reason: 'epic-enrichment-terminal', preserveScroll: true }).catch?.(() => {});
}

if (window.electronAPI?.onPlatformSyncAccountsChanged && !window.__vaultEpicAccountsChangedListenerAttached) {
    window.__vaultEpicAccountsChangedListenerAttached = true;
    window.electronAPI.onPlatformSyncAccountsChanged((payload = {}) => {
        if (String(payload.platform || '').toLowerCase() !== 'epic') return;
        __vaultEpicAcceptedRevision = 0;
        __vaultEpicRequiredRevision = 0;
        invalidateEpicVaultCache(true, { reason: 'epic-accounts-changed', preserveScroll: true }).catch?.(() => {});
    });
}

if (window.electronAPI?.onPlatformLibraryCommitted && !window.__vaultEpicLibraryCommittedListenerAttached) {
    window.__vaultEpicLibraryCommittedListenerAttached = true;
    window.electronAPI.onPlatformLibraryCommitted((payload = {}) => {
        if (String(payload.platform || '').toLowerCase() !== 'epic') return;
        invalidateEpicVaultCache(true, { reason: 'epic-library-committed', preserveScroll: true }).catch?.(() => {});
    });
}

if (window.electronAPI?.onEpicPurchaseHistoryRefreshState && !window.__vaultEpicHistoryRefreshListenerAttached) {
    window.__vaultEpicHistoryRefreshListenerAttached = true;
    window.electronAPI.onEpicPurchaseHistoryRefreshState((payload = {}) => {
        const id = String(payload.accountId || '');
        if (!id || payload.operationId !== __vaultEpicHistoryOperationId) return;
        if (payload.phase === 'session_verified') {
            _vaultCloseEpicAuthModal();
            _vaultSetEpicHistoryNotice({
                accountId: id,
                kind: 'info',
                title: 'Signed in',
                body: 'Purchase History is updating in the background. You can keep using Baddel.',
                actions: [],
            });
        } else if (payload.phase === 'cancelled' || payload.phase === 'error') {
            _vaultCloseEpicAuthModal();
        }
    });
}

if (window.electronAPI?.onEpicPriceRefreshState && !window.__vaultEpicPriceRefreshListenerAttached) {
    window.__vaultEpicPriceRefreshListenerAttached = true;
    window.electronAPI.onEpicPriceRefreshState((payload = {}) => {
        const id = String(payload.accountId || '');
        if (!id) return;
        if (payload.status === 'running') {
            __vaultEpicPriceRefreshingAccounts.add(id);
            __vaultEpicPriceRefreshProgress.set(id, { processed: payload.processed, resolved: payload.resolved, total: payload.total });
        } else {
            __vaultEpicPriceRefreshingAccounts.delete(id);
            __vaultEpicPriceRefreshProgress.delete(id);
            if (payload.status === 'success') {
                __vaultEpicPriceRefreshErrors.delete(id);
                _vaultClearEpicPriceWarningDismissal(id);
            }
        }
        _vaultShowcaseUpdateRefreshGate();
        if (typeof currentView !== 'undefined' && currentView !== 'vault') return;
        const account = _vaultSelectedEpicAccount();
        if (account && String(account.accountId) === id) _vaultPatchEpicAccountShell(account);
        if (payload.status === 'success' && payload.source === 'automatic') {
            hydrateEpicVaultConsole(true, { reason: 'epic-prices-auto-refreshed', preserveScroll: true }).catch?.(() => {});
        }
    });
}

if (window.electronAPI?.onEpicSyncProgress && !window.__vaultEpicProgressListenerAttached) {
    window.__vaultEpicProgressListenerAttached = true;
    window.electronAPI.onEpicSyncProgress((payload = {}) => {
        const accountKey = String(payload.accountId || '');
        const existing = __vaultEpicProgressStates[accountKey];
        const incomingRevision = Number(payload.libraryRevision ?? payload.state?.revision ?? 0);
        const existingRevision = Number(existing?.revision || 0);
        if (incomingRevision < existingRevision) return;
        if (incomingRevision === existingRevision && existing?.syncRunId && payload.syncRunId && String(existing.syncRunId) !== String(payload.syncRunId)) return;
        if (payload.cancelled) delete __vaultEpicProgressStates[accountKey];
        else if (payload.state) __vaultEpicProgressStates[accountKey] = _vaultMergeEpicProgressState(existing, payload.state);
        _vaultReconcileProgressWithCommittedVault();
        if (payload.phase === 'prices' && payload.phaseStatus === 'complete') {
            __vaultEpicPriceRefreshErrors.delete(accountKey);
            _vaultClearEpicPriceWarningDismissal(accountKey);
        }
        const committedRevision = Number(payload.committedRevision || 0);
        if (committedRevision > 0) __vaultEpicRequiredRevision = Math.max(__vaultEpicRequiredRevision, committedRevision);
        if (typeof currentView !== 'undefined' && currentView !== 'vault') return;
        __vaultEpicPendingProgressPayloads.set(accountKey + ':' + (payload.phase || '__overall'), payload);
        if (!__vaultEpicProgressPatchScheduled) {
            __vaultEpicProgressPatchScheduled = true;
            _vaultRaf(() => {
                __vaultEpicProgressPatchScheduled = false;
                const pending = [...__vaultEpicPendingProgressPayloads.values()];
                __vaultEpicPendingProgressPayloads.clear();
                const activeVaultState = typeof __vaultState === 'undefined' ? 'account' : __vaultState;
                if (activeVaultState === 'overview') _renderVaultOverview();
                else for (const item of pending) _vaultPatchEpicProgressDom(item);
            });
        }
        if (payload.phaseStatus === 'batch_committed') {
            _vaultScheduleEpicBatchReconcile();
        } else if (['complete', 'partial', 'failed', 'waiting_for_auth'].includes(payload.phaseStatus)) {
            const terminalKey = [payload.accountId, payload.syncRunId, incomingRevision, payload.phase, payload.phaseStatus, payload.committedRevision].join(':');
            if (!__vaultEpicSeenTerminalEvents.has(terminalKey)) {
                __vaultEpicSeenTerminalEvents.add(terminalKey);
                _vaultReconcileEpicTerminal();
            }
        }
    });
}

function bindVaultBackToTop() {
    const button = document.getElementById('vaultBackToTop');
    const scroller = _vaultVirtualScroller();
    if (!button || !scroller) return;
    if (window.__vaultBackToTopScroller && window.__vaultBackToTopHandler) {
        window.__vaultBackToTopScroller.removeEventListener?.('scroll', window.__vaultBackToTopHandler);
    }
    const update = () => {
        const active = typeof currentView === 'undefined' || currentView === 'vault';
        const visible = active && Number(scroller.scrollTop || 0) > 520;
        if (visible) button.classList.add?.('is-visible');
        else button.classList.remove?.('is-visible');
    };
    window.__vaultBackToTopScroller = scroller;
    window.__vaultBackToTopHandler = update;
    scroller.addEventListener?.('scroll', update, { passive: true });
    update();
}

function scrollVaultToTop() {
    const scroller = _vaultVirtualScroller();
    if (!scroller) return;
    if (typeof scroller.scrollTo === 'function') scroller.scrollTo({ top: 0, behavior: 'smooth' });
    else scroller.scrollTop = 0;
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
    if (ctx === 'downloads') {
        if (typeof navigateToReadyToInstall === 'function') navigateToReadyToInstall();
        return;
    }
    // all-games / ready / home / library — open accounts linking modal
    if (typeof openPlatformsModal === 'function') openPlatformsModal();
}

function openSupportBaddel() {
    showSupportChoices();
    document.getElementById('supportBaddelModal')?.classList.add('active');
}

function closeSupportBaddel() {
    document.getElementById('supportBaddelModal')?.classList.remove('active');
}

function showSupportChoices() {
    const choices = document.getElementById('supportBaddelChoices');
    const egypt = document.getElementById('supportBaddelEgypt');
    if (choices) choices.hidden = false;
    if (egypt) egypt.hidden = true;
}

function showEgyptSupport() {
    const choices = document.getElementById('supportBaddelChoices');
    const egypt = document.getElementById('supportBaddelEgypt');
    if (choices) choices.hidden = true;
    if (egypt) egypt.hidden = false;
}

async function openSupportWorldwide() {
    const result = await window.electronAPI?.openBaddelSupport?.();
    if (result?.status === 'error' && typeof showToast === 'function') showToast(result.message || 'Could not open Ko-fi.', 'error');
}

document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.getElementById('supportBaddelModal')?.classList.contains('active')) closeSupportBaddel();
    if (event.key === 'Escape' && document.getElementById('vaultShowcaseModal')?.classList.contains('active')) closeVaultShowcaseModal();
});

let __vaultShowcaseExportId = null;

function _vaultShowcaseSetState(state, message) {
    const modal = document.getElementById('vaultShowcaseModal');
    const modalMessage = document.getElementById('vaultShowcaseMessage');
    const options = document.getElementById('vaultShowcaseOptions');
    const progress = document.getElementById('vaultShowcaseProgress');
    const progressText = document.getElementById('vaultShowcaseProgressText');
    const result = document.getElementById('vaultShowcaseResult');
    const close = document.getElementById('vaultShowcaseCloseButton');
    const generate = document.getElementById('vaultShowcaseGenerateButton');
    const copy = document.getElementById('vaultShowcaseCopyButton');
    const configuring = state === 'configure';
    const busy = ['preparing', 'rendering', 'capturing', 'saving'].includes(state);
    modal?.classList.toggle('is-busy', busy);
    if (modalMessage && message) modalMessage.textContent = message;
    if (options) options.hidden = !configuring;
    if (progress) progress.hidden = !busy;
    if (progressText && message) progressText.textContent = message;
    if (result) {
        result.hidden = configuring || busy;
        result.className = `vault-showcase-result ${state === 'failed' ? 'is-error' : ''}`;
        if (!configuring && !busy) result.textContent = message || '';
    }
    if (close) close.disabled = busy;
    if (generate) generate.hidden = !configuring;
    if (copy && state !== 'complete') copy.hidden = true;
}

function _vaultShowcaseProgress(payload = {}) {
    const labels = {
        preparing: 'Preparing the committed Vault snapshot and cached posters...',
        rendering: `Laying out a ${payload.width || 1920}px showcase...`,
        capturing: `Capturing tile ${payload.current || 0} of ${payload.total || 0}...`,
        saving: 'Composing the final PNG and opening Save...',
        complete: 'Your Vault showcase was saved.',
        failed: payload.message || 'The Vault showcase could not be exported.',
    };
    _vaultShowcaseSetState(payload.stage, labels[payload.stage]);
}

if (window.electronAPI?.onVaultShowcaseProgress && !window.__vaultShowcaseProgressBound) {
    window.__vaultShowcaseProgressBound = true;
    window.electronAPI.onVaultShowcaseProgress(_vaultShowcaseProgress);
}

function closeVaultShowcaseModal() {
    const modal = document.getElementById('vaultShowcaseModal');
    if (modal?.classList.contains('is-busy')) return;
    modal?.classList.remove('active');
}

function _vaultShowcaseDisplayOptions() {
    return {
        currentLibraryValue: document.getElementById('vaultShowcaseCurrentLibraryValue')?.checked === true,
        totalPaid: document.getElementById('vaultShowcaseTotalPaid')?.checked === true,
        totalRefunded: document.getElementById('vaultShowcaseTotalRefunded')?.checked === true,
        netSpend: document.getElementById('vaultShowcaseNetSpend')?.checked === true,
    };
}

function _vaultShowcaseCloneAccount(account) {
    if (typeof structuredClone === 'function') return structuredClone(account);
    return JSON.parse(JSON.stringify(account));
}

function _vaultShowcaseUpdateRefreshGate() {
    const modal = document.getElementById('vaultShowcaseModal');
    if (!modal?.classList.contains('active') || modal.classList.contains('is-busy')) return;
    const account = _vaultSelectedEpicAccount();
    const refreshing = __vaultEpicPriceRefreshingAccounts.has(String(account?.accountId || ''));
    const generate = document.getElementById('vaultShowcaseGenerateButton');
    const message = document.getElementById('vaultShowcaseMessage');
    if (generate) generate.disabled = refreshing || !account;
    if (message) message.textContent = refreshing
        ? 'Wait for the current price refresh to finish before generating.'
        : 'Choose which totals to include in the PNG.';
}

function _vaultShowcaseEligibilityHtml(account) {
    try {
        const snapshot = window.VaultShowcaseModel?.buildVaultShowcaseSnapshot?.({ account, displayOptions: _vaultShowcaseDisplayOptions() });
        const counts = snapshot?.counts;
        if (!counts) return '';
        return [
            `${counts.rawOwned} owned`, `${counts.included} included`, `${counts.freeExcluded} free excluded`,
            `${counts.priceUnavailable} price unavailable included`, `${counts.nonGameExcluded} non-game`, `${counts.duplicatesRemoved} duplicates`,
        ].map((label) => `<span>${_vaultHtml(label)}</span>`).join('');
    } catch { return ''; }
}

function _vaultShowcaseUpdateEligibility(account) {
    const host = document.getElementById('vaultShowcaseEligibility');
    if (host) host.innerHTML = _vaultShowcaseEligibilityHtml(account);
}

function exportVaultShowcase() {
    const modal = document.getElementById('vaultShowcaseModal');
    const account = _vaultSelectedEpicAccount();
    const generate = document.getElementById('vaultShowcaseGenerateButton');
    const historyNote = document.getElementById('vaultShowcaseHistoryNote');
    const historyAvailable = account?.permissions?.purchaseHistory === true;
    __vaultShowcaseExportId = null;
    document.getElementById('vaultShowcaseCopyButton')?.setAttribute('hidden', '');
    modal?.classList.add('active');
    if (!account) {
        _vaultShowcaseSetState('failed', 'Select an Epic account before exporting.');
        return;
    }
    const optionIds = ['vaultShowcaseCurrentLibraryValue', 'vaultShowcaseTotalPaid', 'vaultShowcaseTotalRefunded', 'vaultShowcaseNetSpend'];
    optionIds.forEach((id, index) => {
        const input = document.getElementById(id);
        if (!input) return;
        const available = index === 0 || historyAvailable;
        input.disabled = !available;
        input.checked = available;
        input.closest('label')?.classList.toggle('is-unavailable', !available);
    });
    if (historyNote) historyNote.hidden = historyAvailable;
    _vaultShowcaseUpdateEligibility(account);
    const refreshing = __vaultEpicPriceRefreshingAccounts.has(String(account.accountId || ''));
    if (generate) generate.disabled = refreshing;
    _vaultShowcaseSetState('configure', refreshing
        ? 'Wait for the current price refresh to finish before generating.'
        : 'Choose which totals to include in the PNG.');
}

async function generateVaultShowcase() {
    const copy = document.getElementById('vaultShowcaseCopyButton');
    try {
        const account = _vaultSelectedEpicAccount();
        if (!account) {
            const error = new Error('Select an Epic account before exporting.');
            error.code = 'VAULT_EXPORT_NO_ACCOUNT';
            throw error;
        }
        if (__vaultEpicPriceRefreshingAccounts.has(String(account.accountId || ''))) {
            _vaultShowcaseSetState('configure', 'Wait for the current price refresh to finish before generating.');
            return;
        }
        if (!window.VaultShowcaseModel?.buildVaultShowcaseSnapshot) throw new Error('The Vault export model is unavailable.');
        const displayOptions = _vaultShowcaseDisplayOptions();
        const frozenAccount = _vaultShowcaseCloneAccount(account);
        const generatedAt = new Date().toISOString();
        _vaultShowcaseUpdateEligibility(frozenAccount);
        _vaultShowcaseSetState('preparing', 'Restoring cached cover artwork...');
        const games = Array.isArray(frozenAccount.games) ? frozenAccount.games : [];
        for (let offset = 0; offset < games.length; offset += 96) {
            await _vaultAwaitArtworkBoundary(_vaultPrimeLocalCovers(games.slice(offset, offset + 96), frozenAccount), 2500);
        }
        const snapshot = window.VaultShowcaseModel.buildVaultShowcaseSnapshot({
            account: frozenAccount,
            generatedAt,
            locale: 'en-US',
            displayOptions,
            resolveCover: (game) => _vaultResolveLocalCover(game, frozenAccount),
        });
        const response = await window.electronAPI?.exportVaultShowcase?.(snapshot);
        if (!response) throw new Error('The export service is unavailable.');
        if (response.status === 'cancelled') {
            _vaultShowcaseSetState('cancelled', 'Save cancelled. No file was written.');
            return;
        }
        if (response.status !== 'success') {
            const error = new Error(response.message || 'The Vault showcase could not be exported.');
            error.code = response.code;
            throw error;
        }
        __vaultShowcaseExportId = response.exportId;
        _vaultShowcaseSetState('complete', `Saved a ${response.width} x ${response.height}px PNG.`);
        if (copy) copy.hidden = response.copyAvailable !== true;
    } catch (error) {
        _vaultShowcaseSetState('failed', `${error?.message || 'The Vault showcase could not be exported.'}${error?.code ? ` (${error.code})` : ''}`);
    }
}

async function copyVaultShowcaseImage() {
    if (!__vaultShowcaseExportId) return;
    const response = await window.electronAPI?.copyVaultShowcase?.(__vaultShowcaseExportId);
    if (response?.status === 'success') {
        window.electronAPI?.trackFeatureEvent?.('vault_action', { feature: 'vault', action: 'copy', result: 'success' }).catch?.(() => {});
        _vaultShowcaseSetState('complete', 'Vault showcase copied to the clipboard.');
        return;
    }
    window.electronAPI?.trackFeatureEvent?.('vault_action', { feature: 'vault', action: 'copy', result: 'failed', error_code: response?.code }).catch?.(() => {});
    _vaultShowcaseSetState('failed', response?.message || 'Could not copy this image.');
}
function updateSbContextBtn() {
    syncSidebarActionButton();
}


// ─────────────────────────────────────────────────────────────────────────────

function clearSidebarActiveState() {
    document.querySelectorAll('.nav-item.active, .platform-item.active, .vault-item.active, [data-collection-id].active, #igFavoritesFilter.active')
        .forEach(el => el.classList.remove('active'));
}

function _sbIsDownloadsVisible() {
    const el = document.getElementById('downloadsView');
    return !!el && el.style.display !== 'none';
}

function updateSidebarActiveState() {
    clearSidebarActiveState();
    const accountsVisible = document.getElementById('accountsView')?.style.display !== 'none';
    const allGamesVisible = document.getElementById('allGamesView')?.style.display !== 'none';
    const downloadsVisible = _sbIsDownloadsVisible();
    const vaultVisible = document.getElementById('vaultView')?.style.display !== 'none';

    if (accountsVisible && currentAccountPlatform) {
        document.getElementById(`nav-${currentAccountPlatform}`)?.classList.add('active');
    } else if (allGamesVisible && window.agReadyOnly) {
        document.getElementById('nav-ready')?.classList.add('active');
    } else if (allGamesVisible) {
        document.getElementById('nav-all-games')?.classList.add('active');
    } else if (vaultVisible || currentView === 'vault') {
        document.getElementById('nav-vault-overview')?.classList.add('active');
    } else if (downloadsVisible || currentView === 'downloads') {
        document.getElementById('nav-downloads')?.classList.add('active');
    } else if (currentView === 'installed') {
        document.getElementById('nav-installed')?.classList.add('active');
    } else if (currentView === 'collections') {
        document.getElementById('nav-collections')?.classList.add('active');
    } else if (currentView === 'collection' && currentFilters.collectionId === 'fav_system_default') {
        document.getElementById('nav-fav')?.classList.add('active');
        document.getElementById('igFavoritesFilter')?.classList.add('active');
    } else if (currentView === 'collection' && currentFilters.collectionId) {
        const escaped = CSS.escape(currentFilters.collectionId);
        document.querySelector(`[data-collection-id="${escaped}"]`)?.classList.add('active');
    } else if (currentView === 'stores') {
        document.getElementById('nav-stores')?.classList.add('active');
    } else if (currentView === 'home') {
        document.getElementById('nav-home')?.classList.add('active');
    }
}

function toggleSidebar() {
    const s = document.getElementById('mainSidebar'), i = document.getElementById('toggleIcon');
    s.classList.toggle('collapsed');
    i.innerHTML = s.classList.contains('collapsed') ? '&#9654;' : '&#9664;';
    queueSidebarOverflowSync();

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

if (typeof window !== 'undefined') {
    window.addEventListener('resize', queueSidebarOverflowSync);
    window.addEventListener('resize', () => {
        if (__vaultLibraryVirtual.items.length) _vaultScheduleLibraryVirtual(true);
        if (__vaultHistoryVirtual.items.length) _vaultScheduleHistoryVirtual(true);
    });
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
window.queueSidebarOverflowSync    = queueSidebarOverflowSync;
window.syncSidebarAccountOverflowMode = syncSidebarAccountOverflowMode;
window.sbToggleSection             = sbToggleSection;
window.sbExpandSection             = sbExpandSection;
window._sbApplySectionState        = _sbApplySectionState;
window.sbGoManageCollections       = sbGoManageCollections;
window.sbToggleAccountsMore        = sbToggleAccountsMore;
window.toggleInstalledFavoritesFilter = toggleInstalledFavoritesFilter;
window.openVaultPlatform          = openVaultPlatform;
window.selectVaultPlatform        = selectVaultPlatform;
window.setVaultEpicPriceMode      = setVaultEpicPriceMode;
window.setVaultEpicSection        = setVaultEpicSection;
window.setVaultEpicLibrarySort    = setVaultEpicLibrarySort;
window.setVaultEpicLibraryFilter  = setVaultEpicLibraryFilter;
window.setVaultEpicLibrarySearch  = setVaultEpicLibrarySearch;
window.setVaultEpicHistorySort    = setVaultEpicHistorySort;
window.setVaultEpicHistoryFilter  = setVaultEpicHistoryFilter;
window.setVaultEpicHistoryCurrency = setVaultEpicHistoryCurrency;
window.setVaultEpicHistorySearch  = setVaultEpicHistorySearch;
window.toggleVaultDropdown = toggleVaultDropdown;
window.selectVaultDropdownOption = selectVaultDropdownOption;
window.handleVaultDropdownKey = handleVaultDropdownKey;
window.handleVaultDropdownOptionKey = handleVaultDropdownOptionKey;
window.closeVaultDropdowns = closeVaultDropdowns;
window.refreshVaultEpicPurchaseHistory = refreshVaultEpicPurchaseHistory;
window.connectVaultEpicPurchaseHistory = connectVaultEpicPurchaseHistory;
window.resolveVaultEpicReauthPrompt = resolveVaultEpicReauthPrompt;
window.dismissVaultEpicHistoryNotice = dismissVaultEpicHistoryNotice;
window.scrollVaultToTop          = scrollVaultToTop;
window.openSupportBaddel         = openSupportBaddel;
window.closeSupportBaddel        = closeSupportBaddel;
window.showSupportChoices        = showSupportChoices;
window.showEgyptSupport          = showEgyptSupport;
window.openSupportWorldwide      = openSupportWorldwide;
window.exportVaultShowcase       = exportVaultShowcase;
window.generateVaultShowcase     = generateVaultShowcase;
window.copyVaultShowcaseImage    = copyVaultShowcaseImage;
window.closeVaultShowcaseModal   = closeVaultShowcaseModal;
window.markVaultEpicCoverLoaded   = markVaultEpicCoverLoaded;
window.handleVaultEpicCoverError  = handleVaultEpicCoverError;
window.handleVaultHistoryCoverError = handleVaultHistoryCoverError;
window._vaultIdentityKeys = _vaultIdentityKeys;
window._vaultBuildArtworkIndex = _vaultBuildArtworkIndex;
window._vaultCreateEpicRenderContext = _vaultCreateEpicRenderContext;
window._vaultBuildLibraryGameIndex = _vaultBuildLibraryGameIndex;
window._vaultFindLibraryGameMatchForPurchase = _vaultFindLibraryGameMatchForPurchase;
window._vaultHasLocalCoverCandidate = _vaultHasLocalCoverCandidate;
window._vaultRenderHistoryArtwork = _vaultRenderHistoryArtwork;
window._vaultHistoryArtworkCandidates = _vaultHistoryArtworkCandidates;
window._vaultLibraryResultsHtml = _vaultLibraryResultsHtml;
window._vaultEpicCoverage = _vaultEpicCoverage;
window._vaultEpicProgressMetrics = () => ({ domPatches: __vaultEpicProgressDomPatchCount, reconciles: __vaultEpicVaultReconcileCount, fullRenders: __vaultEpicFullRenderCount });
window.selectVaultEpicAccount     = selectVaultEpicAccount;
window.backToVaultEpicAccounts    = backToVaultEpicAccounts;
window.backToVaultPlatforms       = backToVaultPlatforms;
window.invalidateEpicVaultCache   = invalidateEpicVaultCache;
window.retryVaultOverviewHydration    = retryVaultOverviewHydration;
window.handleSidebarContextBtn     = handleSidebarContextBtn;
window.updateSbContextBtn          = updateSbContextBtn;
window.clearSidebarActiveState     = clearSidebarActiveState;
window.updateSidebarActiveState    = updateSidebarActiveState;
window.toggleSidebar               = toggleSidebar;
window.openSidebarCollection       = openSidebarCollection;
