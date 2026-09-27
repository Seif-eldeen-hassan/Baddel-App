// ============================================================
// BADDEL LAUNCHER - ACCOUNTS VIEW (accounts.js)
// Sidebar navigation, library view, tutorial modal, Epic library
// window exports, All Games view, and Installed Games view.
// Account card renderers and platform sync logic live in
// src/js/accounts/platform-panels.js (loaded before this file).
// ============================================================

// ---- State (shared with platform-panels.js at runtime) ----
let currentSidebarSection = 'library'; // 'library' | 'accounts'
let currentAccountPlatform = null;     // 'steam' | 'epic' | 'ea' | 'riot' | 'ubisoft'
let isAccountProcessing = false;

// ============================================================
// SECTION 1: SIDEBAR SECTION SWITCHING
// ============================================================

function switchSidebarSection(section) {
    currentSidebarSection = section;

    document.querySelectorAll('.sidebar-section-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`sectionBtn-${section}`)?.classList.add('active');

    document.getElementById('subItems-library').style.display  = section === 'library'  ? 'block' : 'none';
    document.getElementById('subItems-accounts').style.display = section === 'accounts' ? 'block' : 'none';

    const btnIcon = document.getElementById('bottomBtnIcon');
    const btnText = document.getElementById('bottomBtnText');

    if (section === 'library') {
        if (btnIcon) btnIcon.textContent = '+';
        if (btnText) btnText.textContent = 'New Collection';
        showLibraryView();
    } else {
        if (btnIcon) btnIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
        if (btnText) btnText.textContent = 'Add Account';
        if (!currentAccountPlatform) {
            selectAccountPlatform('steam');
        } else {
            showAccountsView(currentAccountPlatform);
        }
    }
}

/**
 * handleSidebarBottomBtn — context action button, driven by active view not section toggle
 */
function handleSidebarBottomBtn() {
    // Delegates to the app.js version which is the authoritative implementation.
    if (typeof handleSidebarContextBtn === 'function') {
        handleSidebarContextBtn();
    }
}

// ============================================================
// SECTION 2: VIEW SWITCHING (Library vs Accounts)
// ============================================================

function showLibraryView() {
    // Preserve the currently active library sub-view instead of always resetting to Home.
    // • On Favorites            → stay on Favorites (collectionId = 'fav_system_default')
    // • On a custom collection  → stay on that collection
    // • On Installed view       → stay on Installed
    // • Only fall back to Home when there is genuinely nothing active.
    if (typeof currentView === 'undefined' || typeof currentFilters === 'undefined') {
        if (typeof navigateToHome === 'function') navigateToHome();
        return;
    }

    if (currentFilters.collectionId === 'fav_system_default') {
        // Stay on Favorites — filterByCollection is the real function in app.js.
        if (typeof filterByCollection === 'function') {
            filterByCollection('fav_system_default');
        } else if (typeof applyFilters === 'function') {
            applyFilters();
        }
        return;
    }

    if (currentFilters.collectionId !== null) {
        // Stay on the active custom collection.
        if (typeof filterByCollection === 'function') {
            filterByCollection(currentFilters.collectionId);
        } else if (typeof applyFilters === 'function') {
            applyFilters();
        }
        return;
    }

    if (currentView === 'installed') {
        if (typeof navigateToInstalled === 'function') navigateToInstalled();
        return;
    }

    // Default: go Home only when there is no active sub-view.
    if (typeof navigateToHome === 'function') navigateToHome();
}

// showAccountsView, selectAccountPlatform, PLATFORM_CONFIG, renderAccountsView,
// loadAccountsForPlatform, shortcut helpers, account card builders, action handlers,
// platform wrappers, ipcInvoke, and promptAccountName are defined in
// src/js/accounts/platform-panels.js (loaded before this file).

// ============================================================
// VIDEO TUTORIAL LOGIC
// ============================================================

const TUTORIAL_VIDEOS = {
    epic:    "https://www.youtube.com/watch?v=LSZ_k3IH1rU",
    steam:   "",
    ea:      "",
    riot:    "https://www.youtube.com/watch?v=03lG2bS3RUo",
    ubisoft: "",
    discord: ""
};

function openTutorialModal(platform) {
    const videoInput = TUTORIAL_VIDEOS[platform];
    const cfg = PLATFORM_CONFIG[platform];

    if (!videoInput) {
        if (typeof showToast === 'function') showToast(`Tutorial for ${cfg.name} is coming soon!`, 'warning');
        return;
    }

    let videoId = videoInput.trim();
    if (videoId.includes("youtu.be/")) {
        videoId = videoId.split("youtu.be/")[1].split("?")[0];
    } else if (videoId.includes("youtube.com/watch")) {
        videoId = videoId.split("v=")[1].split("&")[0];
    }

    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const thumbUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

    const titleEl = document.getElementById('tutorialTitle');
    titleEl.innerHTML = `
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="${cfg.accent}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
        How to add ${cfg.name} account
    `;

    // YouTube embeds are blocked by Electron CSP (Error 153); open via shell instead.
    // Render a clickable thumbnail that delegates to _openTutorialInBrowser.
    const wrapper = document.querySelector('.video-player-wrapper');
    wrapper.innerHTML = `
        <div id="yt-trigger-btn" style="
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: #000;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            border-radius: 8px;
            overflow: hidden;
            z-index: 50;
        ">
            <img src="${thumbUrl}" alt="Video thumbnail"
                style="width: 100%; height: 100%; object-fit: cover; opacity: 0.75;"
                onerror="this.style.display='none'">
            <div style="
                position: absolute;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                gap: 14px;
                text-align: center;
                padding: 20px;
            ">
                <div style="
                    width: 72px; height: 72px;
                    background: rgba(255,0,0,0.9);
                    border-radius: 50%;
                    display: flex; align-items: center; justify-content: center;
                    box-shadow: 0 4px 20px rgba(255,0,0,0.5);
                    transition: transform 0.2s;
                " onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="white"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                </div>
                <div style="color: #fff; font-size: 15px; font-weight: 600; text-shadow: 0 1px 4px rgba(0,0,0,0.8);">
                    Watch on YouTube
                </div>
                <div style="color: rgba(255,255,255,0.6); font-size: 12px;">
                    Opens in your browser
                </div>
            </div>
        </div>
    `;

    const triggerBtn = document.getElementById('yt-trigger-btn');
    triggerBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof showToast === 'function') {
            showToast('Opening YouTube...', 'success');
        }
        try {
            _openTutorialInBrowser(watchUrl);
        } catch (error) {
            if (typeof showToast === 'function') showToast('Error opening link!', 'error');
        }
    });

    document.getElementById('tutorialModal').classList.add('active');
}

function _openTutorialInBrowser(url) {
    if (window.electronAPI?.openExternal) {
        window.electronAPI.openExternal(url);
    } else {
        window.open(url, '_blank');
    }
}

function closeTutorialModal() {
    document.getElementById('tutorialModal').classList.remove('active');

    setTimeout(() => {
        const wrapper = document.querySelector('.video-player-wrapper');
        if (wrapper) {
            wrapper.innerHTML = `<iframe id="tutorialIframe" src="" frameborder="0" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
        }
    }, 300);
}

// ============================================================
// SECTION 10: EPIC LIBRARY WINDOW EXPORTS
// (showEpicLibraryPanel and _renderEpicLibraryPanel are in platform-panels.js)
// ============================================================

window.showEpicSyncOptionsDialog = function showEpicSyncOptionsDialog() {
    return new Promise((resolve) => {
        const existing = document.getElementById('epicSyncOptionsModal');
        if (existing) existing.remove();
        const modal = document.createElement('div');
        modal.id = 'epicSyncOptionsModal';
        modal.className = 'epic-sync-options-modal';
        modal.innerHTML = `
            <div class="epic-sync-options-card">
                <div class="epic-sync-options-head">
                    <img src="../assets/epic.svg" alt="Epic">
                    <div>
                        <strong>Sync Epic Account</strong>
                        <span>Choose exactly what Baddel imports before Epic sign-in starts.</span>
                    </div>
                </div>
                <label class="epic-sync-option locked">
                    <input type="checkbox" checked disabled>
                    <span><strong>Sync Epic Games Library</strong><small>Import your owned Epic games into Baddel All Games.</small></span>
                </label>
                <label class="epic-sync-option">
                    <input id="epicSyncCurrentPrices" type="checkbox">
                    <span><strong>Sync Current Epic Store Prices</strong><small>Fetch current Epic Store prices based on your account region.</small></span>
                </label>
                <label class="epic-sync-option sensitive">
                    <input id="epicSyncPurchaseHistory" type="checkbox">
                    <span><strong>Import Purchase History</strong><small>Allow Baddel to analyze your Epic purchase history and calculate your actual spending.</small></span>
                </label>
                <div class="epic-sync-options-actions">
                    <button type="button" id="epicSyncOptionsCancel">Cancel</button>
                    <button type="button" id="epicSyncOptionsContinue">Continue</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
        const cleanup = (value) => { modal.remove(); resolve(value); };
        modal.querySelector('#epicSyncOptionsCancel').onclick = () => cleanup(null);
        modal.querySelector('#epicSyncOptionsContinue').onclick = () => cleanup({
            epicSyncOptions: {
                games: true,
                currentPrices: !!modal.querySelector('#epicSyncCurrentPrices')?.checked,
                purchaseHistory: !!modal.querySelector('#epicSyncPurchaseHistory')?.checked,
            }
        });
        modal.addEventListener('click', (event) => { if (event.target === modal) cleanup(null); });
    });
}

window.linkEpicLibrary = async function() {
    const syncOpts = await window.showEpicSyncOptionsDialog();
    if (!syncOpts) return;
    const content = document.getElementById('epicLibraryContent');
    if (content) content.innerHTML = `<div class="accounts-loading"><div class="acc-spinner"></div><span>Opening Epic login...</span></div>`;

    try {
        const res = await window.electronAPI.platformSyncLink?.('epic', syncOpts);
        if (res?.status === 'error') throw new Error(res.message);
        const count = Number(res?.gamesCount || 0);
        showToast(`Epic linked as ${res?.displayName || 'account'}${count ? ` and synced ${count} games` : ''}!`, 'success');
        if (content) await window._renderEpicLibraryPanel?.();
        _agSafeRenderAllGamesView();
        hydrateSidebarAllGamesCount('account-sync').catch(() => {});
        if (typeof invalidateEpicVaultCache === 'function') await invalidateEpicVaultCache(true);
    } catch (err) {
        showToast(`Link failed: ${err.message}`, 'error');
        if (content) await window._renderEpicLibraryPanel?.();
    }
};

window.syncEpicLibrary = async function() {
    const syncOpts = await window.showEpicSyncOptionsDialog();
    if (!syncOpts) return;
    const content = document.getElementById('epicLibraryContent');
    const syncBtn = null; // btn-sync-epic removed; no button to disable
    if (content) content.innerHTML = `<div class="accounts-loading"><div class="acc-spinner"></div><span>Syncing Epic library...</span></div>`;

    const epicSyncing = document.getElementById('epicSyncing');
    if (epicSyncing) epicSyncing.style.display = 'flex';

    try {
        await _syncEpicAndRefresh(syncOpts);
    } catch (err) {
        showToast(`Sync failed: ${err.message}`, 'error');
    } finally {
        if (syncBtn) { syncBtn.disabled = false; syncBtn.style.opacity = '1'; }
        if (epicSyncing) epicSyncing.style.display = 'none';
    }
};

/**
 * Refresh All Games view from existing cached/local data only.
 * Does NOT trigger any platform sync. Preserves agReadyOnly, filters, search, sort, and view mode.
 */
window.refreshAllGamesView = async function() {
    const btn = document.getElementById('btn-refresh-all-games');
    if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; }

    const main = document.getElementById('mainContentArea');
    const scrollTop = main ? main.scrollTop : 0;

    try {
        if (Array.isArray(window._allGamesCache) && window._allGamesCache.length > 0) {
            if (typeof _agRenderAccountFilterOptions === 'function') {
                _agRenderAccountFilterOptions(window._allGamesCache);
            }
            if (typeof _applyAgFilters === 'function') {
                _applyAgFilters({ resetScroll: false });
            }
            if (main && scrollTop) {
                requestAnimationFrame(() => { main.scrollTop = scrollTop; });
            }
        } else {
            await _agSafeRenderAllGamesView({ suppressInitialLoading: true });
        }
    } catch (err) {
        if (typeof showToast === 'function') showToast('Refresh failed: ' + err.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
    }
};

const AG_BACK_TO_TOP_THRESHOLD = 500;
window._agSyncBackToTopVisibility = function() {
    const button = document.getElementById('agBackToTop');
    const scroller = document.getElementById('mainContentArea');
    const allGamesView = document.getElementById('allGamesView');
    if (!button || !scroller) return;
    const onAllGamesRoute = (typeof currentView === 'undefined' || currentView === 'all-games')
        && allGamesView?.style.display !== 'none';
    button.hidden = !onAllGamesRoute || scroller.scrollTop < AG_BACK_TO_TOP_THRESHOLD;
};

window._agInitBackToTop = function() {
    const button = document.getElementById('agBackToTop');
    const scroller = document.getElementById('mainContentArea');
    if (!button || !scroller || button.dataset.bound === '1') return;
    button.dataset.bound = '1';
    scroller.addEventListener('scroll', window._agSyncBackToTopVisibility, { passive: true });
    button.addEventListener('click', () => {
        scroller.scrollTop = 0;
        window._agSyncBackToTopVisibility();
    });
    window._agSyncBackToTopVisibility();
};

async function _syncEpicAndRefresh(syncOpts = {}) {
    const res = await window.electronAPI.platformSyncSync?.('epic', null, syncOpts);
    if (res?.status === 'error') throw new Error(res.message);
    const count = res?.games?.length || 0;
    showToast(`Synced ${count} Epic games!`, 'success');

    const panel = document.getElementById('epicLibraryPanel');
    if (panel && panel.style.display !== 'none') await window._renderEpicLibraryPanel?.();

    // All Games / Ready to Install are reconciled by the library-updated event.
    // Sync completion only updates non-library UI here.
    hydrateSidebarAllGamesCount('account-sync').catch(() => {});
    if (typeof invalidateEpicVaultCache === 'function') await invalidateEpicVaultCache(true);
}

window.unlinkEpicLibrary = async function() {
    openConfirmModal(
        'Disconnect Epic Library?',
        'This will remove the synced Epic game list from All Games. Your account switcher profiles are not affected.',
        'Disconnect',
        async () => {
            try {
                const result = await window.electronAPI.platformSyncUnlink?.('epic');
                if (!result || result.status === 'error') throw Object.assign(new Error(result?.message || 'Epic library could not be disconnected.'), { code: result?.code || 'PLATFORM_UNLINK_FAILED' });
                showToast('Epic library disconnected.', 'success');
                await window._renderEpicLibraryPanel?.();
                _agSafeRenderAllGamesView();
                hydrateSidebarAllGamesCount('account-sync').catch(() => {});
                if (typeof invalidateEpicVaultCache === 'function') await invalidateEpicVaultCache(true);
            } catch (err) {
                showToast(`Error: ${err.message}`, 'error');
            }
        }
    );
};

// ============================================================
// SECTION 11: ALL GAMES VIEW
// ============================================================

window._allGamesCache = [];
window.__readyToInstallState = {
    ready: false, games: null, count: null, version: 0, source: 'not-ready',
};
// Signature of the last pool passed to _renderAllGamesViewModeAware.
// Used by the background-update path to skip re-renders when nothing changed.
window._agLastRenderedPoolSignature = '';

function _agMetadataHints(game) {
    const platforms = Array.isArray(game.platforms) && game.platforms.length
        ? [...game.platforms]
        : (game.platform ? [game.platform] : []);
    return {
        id: game.id,
        platform: game.platform || platforms[0] || 'steam',
        platforms,
        command: null,
        path: null,
        allIds: game.allIds && typeof game.allIds === 'object' ? { ...game.allIds } : {},
        existingCover: game.coverUrl || null,
        existingHero: game.heroUrl || game.heroImage || null,
        existingLogo: game.logoUrl || game.logo || null,
    };
}

function _agIdentityKey(value) {
    return String(value || '').trim().toLowerCase();
}

function _agLooseIdentityKey(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

function _agAddIdentityKey(set, value) {
    const raw = _agIdentityKey(value);
    if (raw) set.add(raw);

    const loose = _agLooseIdentityKey(value);
    if (loose) set.add(loose);
}

function _agCollectIdentityKeys(game = {}) {
    const keys = new Set();

    _agAddIdentityKey(keys, game.id);
    _agAddIdentityKey(keys, game.installedId);
    _agAddIdentityKey(keys, game.appName);
    _agAddIdentityKey(keys, game.appid);
    _agAddIdentityKey(keys, game.appId);
    _agAddIdentityKey(keys, game.namespace);
    _agAddIdentityKey(keys, game.catalogNamespace);
    _agAddIdentityKey(keys, game.catalogItemId);
    _agAddIdentityKey(keys, game.launcherGameId);

    if (game.allIds && typeof game.allIds === 'object') {
        Object.values(game.allIds).forEach(v => _agAddIdentityKey(keys, v));
    }

    // Steam common forms: steam-730 + 730
    const steamId =
        game.allIds?.steam ||
        game.steamAppId ||
        game.appid ||
        game.appId ||
        game.appName;

    if (steamId) {
        _agAddIdentityKey(keys, steamId);
        _agAddIdentityKey(keys, `steam-${steamId}`);
    }

    // Epic common forms: epic_AppName + AppName + namespace
    const epicAppName = game.appName || game.epicAppName;
    if (epicAppName) {
        _agAddIdentityKey(keys, epicAppName);
        _agAddIdentityKey(keys, `epic_${epicAppName}`);
        _agAddIdentityKey(keys, `epic-${epicAppName}`);
    }

    const gogProductId = game.allIds?.gog || game.productId;
    if (gogProductId) {
        _agAddIdentityKey(keys, gogProductId);
        _agAddIdentityKey(keys, `gog_${gogProductId}`);
        _agAddIdentityKey(keys, `gog-${gogProductId}`);
    }

    // Fallback title key
    [
        game.title,
        game.name,
        game.originalName,
        game.originalTitle,
        game.customTitle
    ].forEach(title => {
        const titleKey = _agLooseIdentityKey(title);
        if (titleKey) keys.add(`title:${titleKey}`);
    });

    return keys;
}

function _agBuildInstalledCreatorOverrideMap(installedGames = []) {
    const map = new Map();

    installedGames.forEach(localGame => {
        const hasCreatorArtwork =
            localGame.customArtworkLocked === true ||
            localGame.artworkSource === 'creator';

        const hasCustomTitle =
            localGame.customTitleLocked === true ||
            localGame.titleSource === 'creator' ||
            !!localGame.customTitle;

        if (!hasCreatorArtwork && !hasCustomTitle) return;

        _agCollectIdentityKeys(localGame).forEach(key => {
            if (!map.has(key)) map.set(key, localGame);
        });
    });

    return map;
}

function _agApplyInstalledCreatorOverride(syncGame, localGame) {
    if (!localGame) return syncGame;

    const projection = window.BaddelCanonicalArtworkProjection;
    const out = projection?.projectCanonicalArtwork
        ? projection.projectCanonicalArtwork(syncGame, localGame, { matchReason: 'accounts-installed-override' })
        : { ...syncGame };

    const customTitle = localGame.name || localGame.title;
    if (customTitle) {
        out.title = customTitle;
        out.name = customTitle;
    }

    if (out.image) {
        out._agCoverPipelineDone = true;
        out._agCoverInFlight = false;
        out._agRemoteFallbackReady = true;
        out._agLocalRetryCount = 999;
    }
    out.installedId = localGame.id;

    out.allIds = {
        ...(localGame.allIds || {}),
        ...(out.allIds || {}),
    };

    console.info('[ArtworkLinkProjection] syncedId=' + String(syncGame.id || '') +
        ' canonicalId=' + String(localGame.id || '') +
        ' source=' + String(out.artworkSource || localGame.artworkSource || 'unknown'));
    return out;
}

function _agDedupeDelegatedLaunchProducts(games) {
    const service = window.BaddelCanonicalProductIdentity;
    return service?.dedupeDelegatedLaunchProducts
        ? service.dedupeDelegatedLaunchProducts(games)
        : games;
}

async function _agApplyInstalledCreatorOverrides(games = []) {
    let installedGames = [];

    if (window.__baddelRefreshCanonicalGamesRegistry) {
        installedGames = await window.__baddelRefreshCanonicalGamesRegistry('accounts-sync-projection');
    } else if (window.electronAPI?.getGames) {
        try {
            installedGames = _agDedupeDelegatedLaunchProducts(await window.electronAPI.getGames());
            window.allGamesData = installedGames;
            window.__baddelSetCanonicalGamesRegistry?.(installedGames);
        } catch (_) {
            installedGames = [];
        }
    } else if (Array.isArray(window.__baddelCanonicalGames) && window.__baddelCanonicalGames.length > 0) {
        installedGames = window.__baddelCanonicalGames;
    } else if (Array.isArray(window.allGamesData) && window.allGamesData.length > 0) {
        installedGames = window.allGamesData;
    }

    const overrideMap = _agBuildInstalledCreatorOverrideMap(installedGames);

    if (overrideMap.size === 0) return _agDedupeDelegatedLaunchProducts(games);

   return _agDedupeDelegatedLaunchProducts(games.map(game => {
        const localOverride = _agFindInstalledCreatorOverrideFromMap(overrideMap, game);
        return _agApplyInstalledCreatorOverride(game, localOverride);
    }));
}


function _agFindInstalledCreatorOverrideFromMap(map, game) {
    if (!map || !game) return null;

    const keys = _agCollectIdentityKeys(game);

    for (const key of keys) {
        if (map.has(key)) {
            return map.get(key);
        }
    }

    return null;
}

function _agAttrUrl(u) {
    return String(u || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function _agIsCreatorArtworkGame(game = {}) {
    return game.customArtworkLocked === true || game.artworkSource === 'creator';
}

function _agIsManagedArtworkCacheUrl(url) {
    const value = String(url || '').trim();
    if (!value.startsWith('file://')) return false;
    return /[\/](artwork-cache-v2)[\/]/i.test(value) || /artwork-cache-v2%5C/i.test(value) || /artwork-cache-v2\//i.test(value);
}

function _agIsGridThumbnailUrl(url) {
    return /[\/]artwork-grid-cache-v1[\/]160x240[\/]/i.test(String(url || '')) || /artwork-grid-cache-v1%5C160x240%5C/i.test(String(url || ''));
}

function _agGridDisplayCover(cover) {
    const source = String(cover || '');
    return window.__agGridThumbnailByCover.get(source) || source;
}

function _agIsUsableCardCover(url, game = {}) {
    const s = String(url || '').trim();
    if (!s) return false;

    // Renderer-visible All Games covers must already be local/verified. Remote
    // candidates are inputs for the main-process downloader, never img.src here.
    if (s.startsWith('file://')) {
        if (_agIsGridThumbnailUrl(s)) {
            return window.__agVerifiedArtworkUrls instanceof Set && window.__agVerifiedArtworkUrls.has(s);
        }
        if (_agIsManagedArtworkCacheUrl(s)) {
            return window.__agVerifiedArtworkUrls instanceof Set && window.__agVerifiedArtworkUrls.has(s);
        }
        return true;
    }
    if (_agIsCreatorArtworkGame(game) && (s.startsWith('data:image/') || s.startsWith('blob:'))) return true;
    return false;
}

function _agCoverStateFor(game) {
    if (!game) return null;
    game._agCoverState = game._agCoverState || { state: 'idle', token: 0, retryCount: 0, lastError: null };
    return game._agCoverState;
}

function _agSetCoverState(game, state, patch = {}) {
    const coverState = _agCoverStateFor(game);
    if (!coverState) return null;
    Object.assign(coverState, { state, updatedAt: Date.now() }, patch);
    return coverState;
}


// Session-level artwork registry: DOM cards are disposable, artwork state is not.
window.__agArtworkRegistry = window.__agArtworkRegistry instanceof Map ? window.__agArtworkRegistry : new Map();
window.__agVerifiedArtworkUrls = window.__agVerifiedArtworkUrls instanceof Set ? window.__agVerifiedArtworkUrls : new Set();
window.__agGridThumbnailByCover = window.__agGridThumbnailByCover instanceof Map ? window.__agGridThumbnailByCover : new Map();
window.__agArtworkDiagnostics = window.__agArtworkDiagnostics || {
    mountedCards: 0,
    pooledCards: 0,
    artworkRegistrySize: 0,
    readyArtworkCount: 0,
    activeArtworkJobs: 0,
    queuedArtworkJobs: 0,
    bulkArtworkLookupCount: 0,
    cardRemountCacheHits: 0,
    artworkRestartsOnRemount: 0,
    rendererDirectRemoteRequests: 0,
    virtualRenderCount: 0,
    forcedVirtualRenderCount: 0,
};

function _agArtworkDiagnosticsBump(field, amount = 1) {
    const diag = window.__agArtworkDiagnostics || (window.__agArtworkDiagnostics = {});
    diag[field] = Number(diag[field] || 0) + amount;
}

function _agArtworkFileExistsForDiagnostics(url) {
    const src = String(url || '');
    if (!src.startsWith('file://')) return Promise.resolve(null);
    if (!window.electronAPI?.probeLocalImage) return Promise.resolve(null);
    return window.electronAPI.probeLocalImage(src).then(Boolean).catch(() => false);
}

function _agFindDiagnosticGameForCard(card, fallback = null) {
    const id = String(card?.dataset?.id || card?.dataset?.gameId || fallback?.id || '');
    const pools = [window._vs?.items, window._allGamesCache, window._allGamesRawCache, window.allGamesData].filter(Array.isArray);
    for (const pool of pools) {
        const found = pool.find(game => String(game?.id || game?.appName || game?.title || '') === id);
        if (found) return found;
    }
    return fallback || null;
}

function _agAssetHashFromFileUrl(url) {
    const match = String(url || '').match(/\/assets\/([^\/?#]+)\.(?:webp|png|jpe?g|gif|avif)(?:[?#].*)?$/i);
    return match ? match[1] : null;
}

function _agMarkImageAssignment(img, card, game, src, source = 'unknown') {
    if (!img || !src) return null;
    const token = String((Number(img.dataset?.artworkAssignmentToken || 0) || 0) + 1);
    if (img.dataset) {
        img.dataset.artworkAssignmentToken = token;
        img.dataset.artworkAssignedSrc = String(src);
        img.dataset.artworkAssignedGameId = String(game?.id || card?.dataset?.id || '');
        img.dataset.artworkAssignedAt = String(Date.now());
    }
    const assignment = {
        token,
        source,
        assignedAt: Date.now(),
        src: String(src),
        cardTokenAtAssignment: card?.dataset?.coverToken || null,
        cardInstanceToken: card?.dataset?.cardInstanceToken || null,
        gameId: String(game?.id || card?.dataset?.id || ''),
        canonicalKey: (() => { try { return _agArtworkKey(game); } catch { return null; } })(),
        fileExistsAtAssignment: null,
    };
    img.__agArtworkAssignment = assignment;
    _agArtworkFileExistsForDiagnostics(src).then(exists => {
        assignment.fileExistsAtAssignment = exists;
    });
    return assignment;
}

function _agResetArtworkImageErrorDiagnostics(label = 'manual-reset') {
    const generation = Number(window.__agArtworkPersistenceEvidence?.generation || 0) + 1;
    window.__agArtworkPersistenceEvidence = {
        generation,
        resetLabel: label,
        resetAt: Date.now(),
        imgErrorCount: 0,
        brokenImages: [],
        pendingEnrichment: 0,
    };
    return window.__agArtworkPersistenceEvidence;
}
window.__resetArtworkImageErrorDiagnostics = _agResetArtworkImageErrorDiagnostics;

function _agCanonicalAccountKey(game = {}) {
    const owners = [
        game.libraryAccountId,
        game.ownerAccountId,
        game.accountId,
        ...(Array.isArray(game.ownedByAccountIds) ? game.ownedByAccountIds : []),
        ...(Array.isArray(game.ownerAccountIds) ? game.ownerAccountIds : []),
        ...(Array.isArray(game.accountKeys) ? game.accountKeys : []),
    ].filter(Boolean).map(String).sort();
    return owners[0] || 'all';
}

function _agCanonicalProductKey(game = {}) {
    const platform = String(game.platform || game.scannerPlatform || game.platforms?.[0] || 'game')
        .toLowerCase()
        .trim() || 'game';
    if (platform === 'epic') {
        const namespace = _agIdentityKey(
            game.namespace ||
            game.catalogNamespace ||
            game.sandboxId ||
            game.epicMetadata?.namespace ||
            game.allIds?.epic
        );
        const catalogItemId = _agIdentityKey(
            game.catalogItemId ||
            game.catalog_item_id ||
            game.catalogId ||
            game.productId
        );
        const appName = _agIdentityKey(game.appName || game.app_name || game.launcherGameId);
        if (namespace && catalogItemId) return `ns:${namespace}:catalog:${catalogItemId}`;
        if (catalogItemId) return `catalog:${catalogItemId}`;
        if (appName) return appName;
        if (namespace) return namespace;
        const offerId = _agIdentityKey(game.offerId || game.catalogOfferId || game.offer_id);
        if (offerId) return `offer:${offerId}`;
    }
    const platformId =
        game.allIds?.[platform] ||
        game.appName ||
        game.appid ||
        game.appId ||
        game.namespace ||
        game.catalogNamespace ||
        game.catalogItemId ||
        game.offerId ||
        game.productId ||
        game.launcherGameId ||
        game.id;
    const titleKey = _agLooseIdentityKey(game.title || game.name || game.originalTitle || game.originalName || '');
    return _agIdentityKey(platformId) || (titleKey ? `title:${titleKey}` : 'unknown');
}

function _agArtworkKey(game = {}) {
    const canonicalResolver = window.BaddelGameArtworkReadModel?.resolveCanonicalArtworkIdentity;
    if (typeof canonicalResolver === 'function') {
        try {
            const canonicalGameId = canonicalResolver(game)?.canonicalGameId;
            if (canonicalGameId) return String(canonicalGameId);
        } catch (_) {}
    }
    const platform = String(game.platform || game.scannerPlatform || game.platforms?.[0] || 'game')
        .toLowerCase()
        .trim() || 'game';
    return `${platform}:${_agCanonicalAccountKey(game)}:${_agCanonicalProductKey(game)}`;
}

function _agArtworkAliasesForGame(game = {}) {
    const aliases = new Set();
    try { _agCollectIdentityKeys(game).forEach(key => aliases.add(String(key))); } catch {}
    try { _agCoverCacheKeys(game).forEach(key => aliases.add(String(key))); } catch {}
    const canonical = _agArtworkKey(game);
    if (canonical) aliases.add(canonical);
    return [...aliases].filter(Boolean);
}

function _agArtworkRecordFor(game, create = true) {
    if (!game) return null;
    const key = _agArtworkKey(game);
    if (!key) return null;
    const registry = window.__agArtworkRegistry;
    let record = registry.get(key);
    if (!record && create) {
        record = {
            status: 'unknown',
            localUrl: null,
            cacheKey: key,
            sourceRevision: null,
            attempts: 0,
            nextRetryAt: 0,
            lastError: null,
            promise: null,
            generation: 0,
            aliases: new Set(),
            candidates: [],
            candidateIndex: 0,
            metadataComplete: false,
        };
        registry.set(key, record);
    }
    if (record) {
        record.aliases = record.aliases instanceof Set ? record.aliases : new Set(record.aliases || []);
        _agArtworkAliasesForGame(game).forEach(alias => record.aliases.add(alias));
    }
    return record;
}

function _agPatchMountedArtwork(game, url) {
    url = _agGridDisplayCover(url);
    const key = _agGameKey(game);
    let patched = 0;
    const card = window._vs?.visibleCardsByGameId instanceof Map ? window._vs.visibleCardsByGameId.get(key) : null;
    if (card) patched += _agPatchCardCover(card, url);
    const grid = document.getElementById('allGamesGrid');
    const selectorId = _agCssEscape(String(game.id || game.appName || game.title || key || ''));
    const img = grid?.querySelector?.(`[data-id="${selectorId}"] .native-lazy-load`);
    if (img) {
        img.onload = null;
        img.onerror = null;
        if (img.getAttribute('src') !== url) img.src = url;
        img.dataset.src = url;
        img.style.display = '';
        img.classList.add('loaded');
        img.classList.remove('loading', 'skeleton');
        patched++;
    }
    return patched;
}

function _agSetArtworkReady(game, localUrl, source = 'unknown') {
    if (!game || !_agIsUsableCardCover(localUrl, game)) return false;
    const record = _agArtworkRecordFor(game);
    if (!record) return false;
    const changed = record.status !== 'ready' || record.localUrl !== localUrl;
    record.status = 'ready';
    record.localUrl = String(localUrl);
    record.cacheKey = record.cacheKey || _agArtworkKey(game);
    record.lastError = null;
    record.promise = null;
    record.nextRetryAt = 0;
    record.generation += changed ? 1 : 0;
    record.readySource = source;
    record.metadataComplete = true;
    record.localFileVerified = true;

    game.coverUrl = record.localUrl;
    game.image = record.localUrl;
    game.defaultImage = record.localUrl;
    game._agCoverPipelineDone = true;
    game._agCoverInFlight = false;
    game._agRemoteFallbackReady = false;
    game._agArtworkWarmSource = source;
    game._agLocalRetryCount = 999;
    _agSetCoverState(game, 'ready', { url: record.localUrl, lastError: null });
    try {
        const id = String(game.id || game.appName || game.title || '');
        if (id) {
            const key = 'cover_' + id;
            if (_agIsManagedArtworkCacheUrl(record.localUrl)) {
                localStorage.removeItem(key);
                window.__agVerifiedArtworkUrls.add(record.localUrl);
            }
            else localStorage.setItem(key, record.localUrl);
        }
    } catch {}
    if (window._vs?._coverQueued) window._vs._coverQueued.delete(_agGameKey(game));
    _agPatchMountedArtwork(game, record.localUrl);
    return changed;
}

function _agApplyReadyArtworkToGame(game) {
    const record = _agArtworkRecordFor(game, false);
    if (!record || record.status !== 'ready') return false;
    if (record.localFileVerified === true && _agIsManagedArtworkCacheUrl(record.localUrl)) {
        window.__agVerifiedArtworkUrls.add(record.localUrl);
    }
    if (!_agIsUsableCardCover(record.localUrl, game)) {
        if (_agIsManagedArtworkCacheUrl(record.localUrl)) _agInvalidateArtworkRecord(game, 'managed-cache-unverified');
        return false;
    }
    game.coverUrl = record.localUrl;
    game.image = record.localUrl;
    game.defaultImage = record.localUrl;
    game._agCoverPipelineDone = true;
    game._agCoverInFlight = false;
    game._agRemoteFallbackReady = false;
    _agSetCoverState(game, 'ready', { url: record.localUrl, lastError: null });
    return true;
}

function _agInvalidateArtworkRecord(game, reason = 'invalid-local-file') {
    const record = _agArtworkRecordFor(game, false);
    if (!record || record.status !== 'ready') return false;
    record.status = 'retry_wait';
    record.localUrl = null;
    record.localFileVerified = false;
    record.lastError = reason;
    record.nextRetryAt = Date.now() + 1500;
    record.generation += 1;
    game._agCoverPipelineDone = false;
    game._agCoverInFlight = false;
    game.coverUrl = null;
    if (window._vs?._coverQueued) window._vs._coverQueued.delete(_agGameKey(game));
    return true;
}

async function _agVerifyLocalArtworkUrl(url) {
    if (!url || !String(url).startsWith('file://')) return false;
    if (!window.electronAPI?.probeLocalImage) return true;
    try { return await window.electronAPI.probeLocalImage(url); } catch { return false; }
}

function _agArtworkCandidateUrlsFromGame(game = {}) {
    const urls = [];
    const add = (value) => {
        const url = String(value || '').trim();
        if (!url || !/^https?:\/\//i.test(url)) return;
        if (!urls.includes(url)) urls.push(url);
    };
    [
        game.coverUrl,
        game.image,
        game.defaultImage,
        game.cover,
        game.posterImage,
        game.verticalCover,
        game.verticalCoverUrl,
        game.boxArt,
        game.boxArtUrl,
    ].forEach(add);
    if (Array.isArray(game.keyImages)) {
        game.keyImages.forEach((img) => add(img?.url || img?.href || img?.src));
    }
    [
        game.coverCandidates,
        game.artworkCandidates,
        game.remoteCandidates,
        game.remoteCoverCandidates,
    ].forEach((candidates) => {
        if (!Array.isArray(candidates)) return;
        candidates.forEach((candidate) => {
            if (typeof candidate === 'string') add(candidate);
            else add(candidate?.url || candidate?.href || candidate?.src);
        });
    });
    return urls;
}

function _agIsIpcErrorResult(value) {
    return !!(value && typeof value === 'object' && value.status === 'error');
}

function _agSetArtworkTerminalError(game, code, message) {
    const record = _agArtworkRecordFor(game);
    if (!record) return null;
    record.status = 'terminal_error';
    record.lastError = message || code || 'terminal artwork error';
    record.errorCode = code || 'ARTWORK_TERMINAL_ERROR';
    record.promise = null;
    record.nextRetryAt = 0;
    record.attempts = Math.min(5, Math.max(0, Number(record.attempts || 0)));
    game._agCoverInFlight = false;
    game._agCoverPipelineDone = false;
    if (window._vs?._coverQueued) window._vs._coverQueued.delete(_agGameKey(game));
    _agArtworkDiagnosticsBump('terminalErrorCount');
    _agSetCoverState(game, 'terminal_error', { lastError: record.lastError, errorCode: record.errorCode });
    return record;
}

function _agScheduleArtworkRetry(game, tier, reason = 'transient-failure') {
    const record = _agArtworkRecordFor(game);
    if (!record) return;
    const attempts = Math.max(0, Number(record.attempts || 0));
    if (attempts >= 5) {
        record.status = record.metadataComplete ? 'no_source' : 'terminal_error';
        record.attempts = 5;
        record.lastError = reason;
        record.errorCode = record.status === 'terminal_error' ? 'ARTWORK_MAX_ATTEMPTS' : record.errorCode;
        record.promise = null;
        record.nextRetryAt = 0;
        if (window._vs?._coverQueued) window._vs._coverQueued.delete(_agGameKey(game));
        return;
    }
    const delay = Math.min(30000, 1200 * Math.pow(2, attempts));
    record.status = 'retry_wait';
    record.nextRetryAt = Date.now() + delay;
    record.lastError = reason;
    record.promise = null;
    game._agCoverInFlight = false;
    game._agCoverPipelineDone = false;
    if (window._vs?._coverQueued) window._vs._coverQueued.delete(_agGameKey(game));
    setTimeout(() => {
        const latest = _agArtworkRecordFor(game, false);
        if (!latest || latest.status !== 'retry_wait' || latest.nextRetryAt > Date.now()) return;
        _agEnqueueByPriority(tier === 1 ? [game] : null, tier === 2 ? [game] : null, tier === 3 ? [game] : null);
    }, delay);
}

function _agRefreshArtworkDiagnostics() {
    const diag = window.__agArtworkDiagnostics || (window.__agArtworkDiagnostics = {});
    const registry = window.__agArtworkRegistry instanceof Map ? window.__agArtworkRegistry : new Map();
    diag.mountedCards = window._vs?.visibleCardsByGameId instanceof Map ? window._vs.visibleCardsByGameId.size : 0;
    diag.pooledCards = window._vs?.cardPool instanceof Map ? window._vs.cardPool.size : 0;
    diag.artworkRegistrySize = registry.size;
    diag.readyArtworkCount = [...registry.values()].filter(r => r?.status === 'ready' && r.localUrl).length;
    diag.activeArtworkJobs = _agT1Active + _agT2Active + _agT3Active;
    diag.queuedArtworkJobs = _agViewportCoverQueue.length + _agBufferCoverQueue.length + _agBackgroundCoverQueue.length;
    diag.terminalErrorCount = [...registry.values()].filter(r => r?.status === 'terminal_error').length;
    diag.maxArtworkAttempts = Math.max(0, ...[...registry.values()].map(r => Number(r?.attempts || 0)));
    diag.rendererDirectRemoteRequests = 0;
    return diag;
}
window._agGetArtworkDiagnostics = _agRefreshArtworkDiagnostics;

function _agCssEscape(val) {
    if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(String(val));
    return String(val).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function _agComposeAccountKey(platform, accountId) {
    return `${String(platform || '').toLowerCase()}:${String(accountId || '')}`;
}

function _agExtractGameAccountKeys(game) {
    const platform = String(game?.platform || '').toLowerCase();
    const ids = [];
    if (platform === 'steam') {
        ids.push(...(Array.isArray(game?.steamLicensedAccountIds) ? game.steamLicensedAccountIds : []));
        ids.push(...(Array.isArray(game?.ownedByAccountIds) ? game.ownedByAccountIds : []));
        // steamDetectedAccountIds is intentionally excluded — local installs are not ownership evidence.
    } else {
        ids.push(...(Array.isArray(game?.ownedByAccountIds) ? game.ownedByAccountIds : []));
    }
    return [...new Set(ids.map((id) => String(id)).filter(Boolean))]
        .map((id) => _agComposeAccountKey(platform, id));
}

function _agNormalizeAccountLabel(label, fallbackId) {
    const clean = String(label || '').trim();
    return clean || String(fallbackId || '').trim() || 'Unknown Account';
}

function _agBuildAccountLabelsForGame(game, accountNameByKey) {
    const labels = {};
    const keys = _agExtractGameAccountKeys(game);
    const ids = keys.map((k) => k.split(':').slice(1).join(':'));
    keys.forEach((key, idx) => {
        const fromMap = accountNameByKey.get(key);
        const fromOwnedBy = Array.isArray(game?.ownedBy) ? game.ownedBy[idx] : null;
        labels[key] = _agNormalizeAccountLabel(fromMap || fromOwnedBy, ids[idx]);
    });
    return labels;
}

function _agPlatformIdentityValue(game = {}) {
    const platform = String(game.platform || '').toLowerCase();
    if (platform === 'gog') return game.productId || game.allIds?.gog || game.appName || game.id;
    if (platform === 'steam') return game.appName || game.allIds?.steam || game.id;
    if (platform === 'epic') return game.appName || game.launcherGameId || game.allIds?.epic || game.id;
    return game.id || game.appName || game.productId;
}

function _agMergeUniqueList(primary = [], secondary = [], keyFn = (item) => String(item || '').toLowerCase()) {
    const out = [];
    const seen = new Set();
    for (const item of [...(primary || []), ...(secondary || [])]) {
        if (item == null || item === '') continue;
        const key = keyFn(item);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(item);
    }
    return out;
}

function _agMergeTrailerLists(primary = [], secondary = []) {
    return _agMergeUniqueList(primary, secondary, (item) => {
        if (typeof item === 'string') return item.toLowerCase();
        return String(item?.url || item?.src || item?.href || item?.title || item?.name || '').toLowerCase();
    });
}

function _agMergeRatingLists(primary = [], secondary = []) {
    return _agMergeUniqueList(primary, secondary, (item) => {
        if (!item || typeof item !== 'object') return '';
        return String(item.source || item.provider || item.name || JSON.stringify(item)).toLowerCase();
    });
}

function _agMergeRichSyncedGameMeta(targetGame, sourceGame) {
    if (!targetGame || !sourceGame) return;
    const sourceInfo = sourceGame.info && typeof sourceGame.info === 'object' ? sourceGame.info : {};
    const targetInfo = targetGame.info && typeof targetGame.info === 'object' ? targetGame.info : {};
    const isGogSource = String(sourceGame.platform || '').toLowerCase() === 'gog';

    targetGame.info = {
        ...sourceInfo,
        ...targetInfo,
    };

    for (const key of ['description', 'short_description', 'developer', 'publisher', 'releaseDate', 'trailer']) {
        if ((targetGame.info[key] == null || targetGame.info[key] === '') && sourceInfo[key]) {
            targetGame.info[key] = sourceInfo[key];
        }
    }

    targetGame.info.allTrailers = _agMergeTrailerLists(targetInfo.allTrailers, sourceInfo.allTrailers);
    targetGame.info.ratings = _agMergeRatingLists(targetInfo.ratings, sourceInfo.ratings);
    targetGame.info.screenshots = _agMergeUniqueList(targetInfo.screenshots, sourceInfo.screenshots);
    targetGame.info.genres = _agMergeUniqueList(targetInfo.genres, sourceInfo.genres, (item) => String(item || '').toLowerCase());
    targetGame.ratings = _agMergeRatingLists(targetGame.ratings, sourceGame.ratings || sourceInfo.ratings);

    if (isGogSource && sourceInfo.releaseDate) {
        targetGame.info.releaseDate = sourceInfo.releaseDate;
        targetGame.releaseDate = sourceInfo.releaseDate;
    }

    for (const key of ['coverUrl', 'heroUrl', 'logoUrl', 'short_description', 'description', 'developer', 'publisher']) {
        if (!targetGame[key] && sourceGame[key]) targetGame[key] = sourceGame[key];
    }
}

function _agMergeAccountMeta(targetGame, sourceGame, accountNameByKey) {
    const sourceKeys = _agExtractGameAccountKeys(sourceGame);
    const targetKeys = Array.isArray(targetGame.accountKeys) ? targetGame.accountKeys : [];

    targetGame.accountKeys = [...new Set([...targetKeys, ...sourceKeys])];
    targetGame.accountLabels = { ...(targetGame.accountLabels || {}) };

    const sourceLabels = _agBuildAccountLabelsForGame(sourceGame, accountNameByKey);

    sourceKeys.forEach((key) => {
        if (!targetGame.accountLabels[key]) {
            targetGame.accountLabels[key] = sourceLabels[key] || _agNormalizeAccountLabel('', key);
        }
    });
}

function _agRenderAccountFilterOptions(games) {
    const menu = document.getElementById('agAccountMenu');
    const selectedText = document.getElementById('selectedAgAccountText');
    if (!menu || !selectedText) return;

    const optionMap = new Map();
    optionMap.set('all', 'All Accounts');

    (games || []).forEach((game) => {
        const keys = Array.isArray(game.accountKeys) ? game.accountKeys : [];
        const labels = game.accountLabels || {};
        keys.forEach((key) => {
            const platform = key.split(':')[0] || 'platform';
            const label = _agNormalizeAccountLabel(labels[key], key);
            const platformName = platform.charAt(0).toUpperCase() + platform.slice(1);
            optionMap.set(key, `${platformName} - ${label}`);
        });
    });

    const previousAccount = window._agState?.account || 'all';
    menu.innerHTML = Array.from(optionMap.entries())
        .map(([value, label]) => `<div class="dropdown-item" onclick="setAgAccountFilter('${_escapePlatformSyncHtml(value)}', decodeURIComponent('${encodeURIComponent(label)}'))">${_escapePlatformSyncHtml(label)}</div>`)
        .join('');

    // Keep the selected account if it still exists; fall back to 'all' if removed by sync.
    const resolvedAccount = optionMap.has(previousAccount) ? previousAccount : 'all';
    if (resolvedAccount !== previousAccount) {
        console.log(`[AGFILTER] account '${previousAccount}' dropped from options — reset to All Accounts`);
    }
    selectedText.innerText = optionMap.get(resolvedAccount) || 'All Accounts';
    if (window._agState) {
        window._agState.account = resolvedAccount;
    }
}

function _agBuildAccountNameByKey(accountMetadata = {}) {
    const accountNameByKey = new Map();
    const addAccounts = (platform, accounts) => {
        (Array.isArray(accounts) ? accounts : []).forEach((acc) => {
            accountNameByKey.set(
                _agComposeAccountKey(platform, acc.id),
                _agNormalizeAccountLabel(acc.displayName || acc.name, acc.id)
            );
        });
    };

    if (accountMetadata instanceof Map) return accountMetadata;
    addAccounts('epic', accountMetadata.epic || accountMetadata.epicAccounts);
    addAccounts('steam', accountMetadata.steam || accountMetadata.steamAccounts);
    addAccounts('gog', accountMetadata.gog || accountMetadata.gogAccounts);
    return accountNameByKey;
}

function _agMergeSyncedLibraryRecords(rawGames = [], accountNameByKey = new Map()) {
    const mergedGamesMap = new Map();

    (Array.isArray(rawGames) ? rawGames : []).forEach(game => {
        const cleanTitle = (game.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');

        if (mergedGamesMap.has(cleanTitle)) {
            const existingGame = mergedGamesMap.get(cleanTitle);
            if (!existingGame.platforms.includes(game.platform)) {
                existingGame.platforms.push(game.platform);
            }
            existingGame.allIds[game.platform] = _agPlatformIdentityValue(game);
            existingGame._agSource     = 'platform-sync';
            existingGame.librarySource = 'synced-account';
            _agMergeRichSyncedGameMeta(existingGame, game);
            _agMergeAccountMeta(existingGame, game, accountNameByKey);
            return;
        }

        const newGame = { ...game };
        newGame.platforms     = [game.platform];
        newGame.allIds        = { [game.platform]: _agPlatformIdentityValue(game) };
        newGame._agSource     = 'platform-sync';
        newGame.librarySource = 'synced-account';
        _agMergeAccountMeta(newGame, game, accountNameByKey);
        mergedGamesMap.set(cleanTitle, newGame);
    });

    return Array.from(mergedGamesMap.values());
}

async function buildAllGamesLibraryProjection({
    cachedPlatformGames = [],
    accountMetadata = {},
} = {}) {
    const accountNameByKey = _agBuildAccountNameByKey(accountMetadata);
    let _rawResolved = await _agApplyInstalledCreatorOverrides(
        _agMergeSyncedLibraryRecords(cachedPlatformGames, accountNameByKey)
    );
    _rawResolved = _agDedupeDelegatedLaunchProducts(_rawResolved);
    const libraryGames = _agGetUserLibraryGames(_rawResolved);
    return {
        rawResolved: _rawResolved,
        libraryGames,
        count: libraryGames.length,
        platformSnapshots: [],
        revision: '',
        stale: false,
        authoritativeEmpty: libraryGames.length === 0,
    };
}

window.__agCommittedAllGamesSnapshot = window.__agCommittedAllGamesSnapshot || null;
window.__agAllGamesSnapshotGeneration = window.__agAllGamesSnapshotGeneration || 0;

function _agProjectionRevision(platformSnapshots = []) {
    return platformSnapshots
        .map(s => `${s.platform || '?'}:${s.revision || 0}:${s.stale ? 'stale' : 'fresh'}:${s.authoritativeEmpty ? 'empty' : 'data'}`)
        .join('|');
}

function _agCanCommitProjection(projection, source = 'unknown') {
    const previous = window.__agCommittedAllGamesSnapshot;
    if (!projection || !Array.isArray(projection.libraryGames)) return false;
    const staleEmptyPlatform = (projection.platformSnapshots || []).some(s => s?.stale && Array.isArray(s.games) && s.games.length === 0 && !s.authoritativeEmpty);
    if (previous?.count > 0 && projection.count === 0 && staleEmptyPlatform) {
        console.warn(`[AllGamesSnapshot] Ignored transient empty projection from ${source}; keeping last committed ${previous.count} games.`);
        return false;
    }
    return true;
}

function _agCommitAllGamesProjection(projection, source = 'unknown') {
    if (!_agCanCommitProjection(projection, source)) return window.__agCommittedAllGamesSnapshot;
    const committed = {
        ...projection,
        committedAt: Date.now(),
        source,
        revision: projection.revision || _agProjectionRevision(projection.platformSnapshots),
    };
    window.__agCommittedAllGamesSnapshot = committed;
    window._allGamesRawCache = committed.rawResolved;
    window._allGamesCache = committed.libraryGames;
    _agInvalidateLocalCoverResolution('platform-projection-committed');
    _agPublishAllGamesCount(committed.count, source);
    const _rtiGames = _agComputeReadyToInstallGamesFromCache();
    if (_rtiGames !== null) _agPublishReadyToInstallState(_rtiGames, source);
        _agStartColdCoverBootstrap(committed.libraryGames, source);
    return committed;
}

function _agStartColdCoverBootstrap(games, source = 'all-games-projection') {
    const list = (Array.isArray(games) ? games : []).filter(Boolean);
    if (!list.length || !window.electronAPI?.startColdCoverBootstrap) return;
    const signature = list.map(_agArtworkKey).filter(Boolean).sort().join('|');
    window.__agColdCoverBootstrap = window.__agColdCoverBootstrap || { signature: '', timer: null };
    if (window.__agColdCoverBootstrap.signature === signature) return;
    window.__agColdCoverBootstrap.signature = signature;
    if (window.__agColdCoverBootstrap.timer) clearTimeout(window.__agColdCoverBootstrap.timer);
    window.__agColdCoverBootstrap.timer = setTimeout(() => {
        window.__agColdCoverBootstrap.timer = null;
        window.electronAPI.startColdCoverBootstrap(list, { reason: `cold-cover-bootstrap:${source}` }).catch?.(() => {});
    }, 0);
}

async function _agPatchColdBootstrapBatch(payload = {}) {
    const changed = Array.isArray(payload.changedCanonicalIds) ? payload.changedCanonicalIds.filter(Boolean) : [];
    if (!changed.length || !Array.isArray(window._allGamesCache) || !window.electronAPI?.getCachedImagesBulk) return 0;
    const changedSet = new Set(changed.map(String));
    const candidates = window._allGamesCache.filter((game) => {
        const key = _agArtworkKey(game);
        if (changedSet.has(String(key))) return true;
        return _agArtworkAliasesForGame(game).some(alias => changedSet.has(String(alias)));
    });
    if (!candidates.length) return 0;
    const changedCount = await _agApplyBulkCachedCovers(candidates, 'cold-cover-bootstrap-batch');
    if (changedCount) {
        _agRebindCachedCards(candidates);
        _agEnsureVirtualGridIntegrity('cold-cover-bootstrap-batch');
    }
    return changedCount;
}

if (window.electronAPI?.onColdCoverBootstrapBatch && !window.__agColdCoverBootstrapBatchAttached) {
    window.__agColdCoverBootstrapBatchAttached = true;
    window.electronAPI.onColdCoverBootstrapBatch((payload) => {
        _agPatchColdBootstrapBatch(payload).catch(() => {});
    });
}
async function _agReadCachedAllGamesProjection(options = {}) {
    const overrideSnapshots = new Map((options.platformSnapshots || []).filter(item => item?.platform).map(item => [String(item.platform), item]));
    const status = typeof window.electronAPI?.platformSyncStatus === 'function'
        ? await window.electronAPI.platformSyncStatus().catch(() => ({}))
        : {};
    const cachedPlatformGames = [];
    const accountMetadata = { epic: [], steam: [], gog: [] };
    const platformSnapshots = [];

    if (status?.epic === true) {
        const epicAccountsRes = typeof window.electronAPI?.platformSyncGetAccounts === 'function'
            ? await window.electronAPI.platformSyncGetAccounts('epic').catch(() => ({}))
            : {};
        accountMetadata.epic = epicAccountsRes?.accounts || [];
        const epicRes = overrideSnapshots.get("epic") || (typeof window.electronAPI?.platformSyncGetCached === "function"
            ? await window.electronAPI.platformSyncGetCached("epic").catch(() => ({}))
            : {});
        if (epicRes?.status === 'success') platformSnapshots.push(epicRes);
        if (epicRes?.games) cachedPlatformGames.push(...epicRes.games);
    }
    if (status?.steam === true) {
        const steamAccountsRes = typeof window.electronAPI?.platformSyncGetAccounts === 'function'
            ? await window.electronAPI.platformSyncGetAccounts('steam').catch(() => ({}))
            : {};
        accountMetadata.steam = steamAccountsRes?.accounts || [];
        const steamRes = overrideSnapshots.get("steam") || (typeof window.electronAPI?.platformSyncGetCached === "function"
            ? await window.electronAPI.platformSyncGetCached("steam").catch(() => ({}))
            : {});
        if (steamRes?.status === 'success') platformSnapshots.push(steamRes);
        if (steamRes?.games) cachedPlatformGames.push(...steamRes.games);
    }
    if (status?.gog === true) {
        const gogAccountsRes = typeof window.electronAPI?.platformSyncGetAccounts === 'function'
            ? await window.electronAPI.platformSyncGetAccounts('gog').catch(() => ({}))
            : {};
        accountMetadata.gog = gogAccountsRes?.accounts || [];
        const gogRes = overrideSnapshots.get("gog") || (typeof window.electronAPI?.platformSyncGetCached === "function"
            ? await window.electronAPI.platformSyncGetCached("gog").catch(() => ({}))
            : {});
        if (gogRes?.status === 'success') platformSnapshots.push(gogRes);
        if (gogRes?.games) cachedPlatformGames.push(...gogRes.games);
    }

    const projection = await buildAllGamesLibraryProjection({ cachedPlatformGames, accountMetadata });
    projection.platformSnapshots = platformSnapshots;
    projection.revision = _agProjectionRevision(platformSnapshots);
    projection.stale = platformSnapshots.some(s => s?.stale);
    projection.authoritativeEmpty = platformSnapshots.length > 0 && platformSnapshots.every(s => s?.authoritativeEmpty === true);
    return projection;
}

function _agPublishAllGamesCount(count, source) {
    window.__sidebarAllGamesCountReady = true;
    if (typeof window.setSidebarAllGamesCount === 'function') {
        window.setSidebarAllGamesCount(count, { source, ready: true });
        return;
    }
    const el = document.getElementById('allGamesCount');
    if (el) el.textContent = String(Number.isInteger(Number(count)) && Number(count) >= 0 ? Number(count) : 0);
}

async function hydrateSidebarAllGamesCount(source = 'startup-cache') {
    if (typeof window._sbApplyStartupAllGamesCount === 'function') {
        window._sbApplyStartupAllGamesCount();
    } else if (typeof window.setSidebarAllGamesCount === 'function') {
        window.setSidebarAllGamesCount(null, { source: 'startup-loading', ready: false, loading: true });
    }

    const projection = await _agReadCachedAllGamesProjection();
    return _agCommitAllGamesProjection(projection, source) || projection;
}

window.buildAllGamesLibraryProjection = buildAllGamesLibraryProjection;
window.hydrateSidebarAllGamesCount = hydrateSidebarAllGamesCount;

// ── Strict 3-tier cover queue ─────────────────────────────────────────────────
//
// Tier 1 — viewportCoverQueue  : cards actually visible right now
//           Concurrency: 6.  Nothing else runs while this has items.
//
// Tier 2 — bufferCoverQueue    : rows just outside the viewport (render buffer)
//           Concurrency: 4.  Only runs when Tier 1 is fully empty (queue + in-flight).
//
// Tier 3 — backgroundCoverQueue : far prefetch rows
//           Concurrency: 2.  Only runs when BOTH Tier 1 and Tier 2 are fully empty.
//
// The pump is called after every resolve completes, so priority is re-evaluated
// continuously and a newly-added Tier 1 item will always preempt Tier 2/3 work.

const _agViewportCoverQueue   = [];   // Tier 1 — current viewport only
const _agBufferCoverQueue     = [];   // Tier 2 — nearby buffer rows
const _agBackgroundCoverQueue = [];   // Tier 3 — far prefetch
// Legacy alias — any old code pushing to _agCoverQueue goes to background (Tier 3)
const _agCoverQueue = _agBackgroundCoverQueue;

let _agT1Active = 0;   // in-flight Tier 1
let _agT2Active = 0;   // in-flight Tier 2
let _agT3Active = 0;   // in-flight Tier 3

const _AG_T1_CONCURRENCY = 6;
const _AG_T2_CONCURRENCY = 4;
const _AG_T3_CONCURRENCY = 2;

function _agStartCompleteLibraryCoverHydration(games, reason = 'complete-library-cover-hydration') {
    const requested = Array.isArray(games) ? games : [];
    const list = Array.isArray(window._allGamesCache) && window._allGamesCache.length
        ? window._allGamesCache
        : requested;
    if (!list.length) return Promise.resolve(0);
    const libraryRevision = String(window.__agCommittedAllGamesSnapshot?.revision || 'unversioned');
    const signature = libraryRevision + '|' + list.map(_agArtworkKey).filter(Boolean).join('|');
    const state = window.__agApplicationArtworkHydration || (window.__agApplicationArtworkHydration = {
        signature: '', status: 'idle', promise: null, completed: 0, total: 0, reason: null,
    });
    if (state.signature === signature && (state.status === 'running' || state.status === 'complete')) {
        return state.promise || Promise.resolve(state.completed);
    }
    state.signature = signature;
    state.status = 'scheduled';
    state.completed = 0;
    state.total = list.length;
    state.reason = reason;
    const run = async () => {
        state.status = 'running';
        const chunkSize = 48;
        let changedTotal = 0;
        for (let index = 0; index < list.length; index += chunkSize) {
            while (Number(window.__agForegroundArtworkWarmCount || 0) > 0) {
                await new Promise(resolve => requestAnimationFrame(() => resolve()));
            }
            const chunk = list.slice(index, index + chunkSize);
            const changedCount = await _agApplyBulkCachedCovers(chunk, reason).catch(() => 0);
            changedTotal += changedCount;
            _agScheduleGridThumbnailPreparation(chunk);
            state.completed = Math.min(list.length, index + chunk.length);
            if (changedCount && typeof currentView !== 'undefined' && currentView === 'all-games') _agRebindCachedCards(chunk);
            await new Promise(resolve => requestAnimationFrame(() => resolve()));
        }
        try { _agEnqueueAllGamesCovers(list); } catch {}
        // Thumbnail preparation above hydrates the complete library in bounded
        // idle batches. A second full-cache probe here used to stat every cover
        // again and could contend with the next user navigation for seconds.
        if (!window._vs?._isScrolling && typeof currentView !== 'undefined' && currentView === 'all-games') {
            _agRebindCachedCards(list);
            _agEnsureVirtualGridIntegrity('grid-thumbnails-ready');
        }
        state.status = 'complete';
        return changedTotal;
    };
    state.promise = new Promise(resolve => setTimeout(resolve, 0)).then(run).catch(error => {
        state.status = 'failed';
        state.error = error?.message || String(error);
        throw error;
    });
    return state.promise;
}

function _agWarmFirstPaintCoversAfterRender(games, { limit = 48, reason = 'all-games-first-paint', generation = null } = {}) {
    const list = Array.isArray(games) ? games : [];
    if (!list.length) return Promise.resolve(0);
    const routeVersion = window._agRouteVersion || 0;
    const isCurrent = () => generation !== null
        ? Number(window.__agForegroundArtworkWarmGeneration || 0) === generation
        : (window._agRouteVersion || 0) === routeVersion;
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))).then(async () => {
        if (!isCurrent()) return;
        const foreground = list.slice(0, Math.max(0, Number(limit) || 0));
        let restored = 0;
        for (let index = 0; index < foreground.length; index += 48) {
            const chunk = foreground.slice(index, index + 48);
            const changed = await _agWarmCachedCoversForGames(chunk, { limit: chunk.length, reason }).catch(() => 0);
            if (!isCurrent()) return restored;
            const thumbnails = await _agLoadExistingGridThumbnails(chunk, {
                limit: chunk.length,
                waitForPending: true,
                defer: false,
            }).catch(() => 0);
            _agScheduleGridThumbnailPreparation(chunk);
            if (!changed && !thumbnails) continue;
            restored += Number(changed || 0) + Number(thumbnails || 0);
            _agRebindCachedCards(chunk);
            _agEnsureVirtualGridIntegrity(reason);
            if (typeof window._vsRender === 'function') window._vsRender(false, reason);
        }
        return restored;
    }).catch(() => 0);
}

function _agPrioritizeFilteredPoolArtwork(pool) {
    const list = Array.isArray(pool) ? pool : [];
    if (!list.length) return 0;
    const selectedPlatform = String(window._agState?.platform || 'all').toLowerCase();
    // A selected provider is at most a few hundred records in normal use, so
    // warm the complete provider view. Mixed/All Games remains capped and keeps
    // the existing full-library hydration in its lower-priority queue.
    const limit = Math.min(list.length, selectedPlatform === 'all' ? 144 : 320);
    const generation = Number(window.__agForegroundArtworkWarmGeneration || 0) + 1;
    window.__agForegroundArtworkWarmGeneration = generation;
    const foreground = list.slice(0, limit);
    window.__agForegroundArtworkKeys = new Set(foreground.map(_agArtworkKey).filter(Boolean));
    window.__agForegroundArtworkWarmCount = Number(window.__agForegroundArtworkWarmCount || 0) + 1;
    _agWarmFirstPaintCoversAfterRender(foreground, {
        limit,
        reason: `all-games-filter-visible:${selectedPlatform}`,
        generation,
    }).finally(() => {
        window.__agForegroundArtworkWarmCount = Math.max(0, Number(window.__agForegroundArtworkWarmCount || 0) - 1);
        if (Number(window.__agForegroundArtworkWarmGeneration || 0) === generation) {
            window.__agForegroundArtworkKeys = new Set();
        }
    });
    return limit;
}
window.__agPrioritizeFilteredPoolArtwork = _agPrioritizeFilteredPoolArtwork;

function _agEnqueueAllGamesCovers(games) {
    if (!Array.isArray(games) || games.length === 0) return;
    _agViewportCoverQueue.length = 0;
    _agBufferCoverQueue.length = 0;
    _agBackgroundCoverQueue.length = 0;
    if (window.electronAPI?.startColdCoverBootstrap) {
        window.electronAPI.startColdCoverBootstrap(games, { reason: 'renderer-complete-library-handoff' }).catch?.(() => {});
    }
}

function _agQueueArtworkGames(queue, games, { front = false } = {}) {
    if (!Array.isArray(games) || !games.length) return 0;
    const queuedKeys = new Set([
        ..._agViewportCoverQueue,
        ..._agBufferCoverQueue,
        ..._agBackgroundCoverQueue,
    ].map(_agArtworkKey));
    const accepted = [];
    for (const game of games) {
        if (!game) continue;
        const key = _agArtworkKey(game);
        if (!key || queuedKeys.has(key) || !_agNeedsLocalCoverWork(game)) continue;
        const record = _agArtworkRecordFor(game);
        if (!record) continue;
        record.status = 'queued';
        record.lastQueuedAt = Date.now();
        _agScrollDiagnosticCount('artwork.queueAdditions');
        queuedKeys.add(key);
        accepted.push(game);
        window._vs?._coverQueued?.add(_agGameKey(game));
    }
    if (accepted.length) {
        if (front) queue.unshift(...accepted);
        else queue.push(...accepted);
    }
    return accepted.length;
}

/**
 * Enqueue games into the correct tier with session-level deduplication.
 *   viewportGames -> Tier 1 (front = highest priority within tier)
 *   bufferGames   -> Tier 2
 *   bgGames       -> Tier 3
 */
function _agEnqueueByPriority(viewportGames, bufferGames, bgGames) {
    const added =
        _agQueueArtworkGames(_agViewportCoverQueue, viewportGames, { front: true }) +
        _agQueueArtworkGames(_agBufferCoverQueue, bufferGames) +
        _agQueueArtworkGames(_agBackgroundCoverQueue, bgGames);
    if (added) _agPumpCoverQueue();
}

/**
 * Strict 3-tier pump.
 *
 * Rule: a lower tier only gets a slot when ALL higher tiers are completely
 * idle — queue empty AND zero in-flight resolves.  This prevents a slow
 * Tier 3 resolve (e.g. a metadata fetch that started before a scroll) from
 * continuing to consume concurrency that should go to newly-visible cards.
 */
function _agStartArtworkJob(game, tier) {
    const record = _agArtworkRecordFor(game);
    if (!record || record.status === 'ready') return null;
    if (record.promise) return record.promise;
    if (record.status !== 'queued' && !_agNeedsLocalCoverWork(game)) return null;
    record.status = 'resolving';
    const promise = _agResolveCoverForGame(game, tier)
        .catch((err) => {
            _agScheduleArtworkRetry(game, tier, err?.message || 'artwork-job-failed');
        })
        .finally(() => {
            if (record.promise === promise) record.promise = null;
            if (window._vs?._coverQueued) window._vs._coverQueued.delete(_agGameKey(game));
            game._agCoverInFlight = false;
            _agRefreshArtworkDiagnostics();
        });
    record.promise = promise;
    return promise;
}

function _agPumpTier(queue, tier, getActive, setActive, limit) {
    while (getActive() < limit && queue.length > 0) {
        const game = queue.shift();
        const job = _agStartArtworkJob(game, tier);
        if (!job) continue;
        setActive(getActive() + 1);
        job.finally(() => {
            setActive(Math.max(0, getActive() - 1));
            _agPumpCoverQueue();
        });
    }
}

function _agPumpCoverQueue() {
    _agPumpTier(_agViewportCoverQueue, 1, () => _agT1Active, (v) => { _agT1Active = v; }, _AG_T1_CONCURRENCY);
    if (_agViewportCoverQueue.length > 0 || _agT1Active > 0) return;
    _agPumpTier(_agBufferCoverQueue, 2, () => _agT2Active, (v) => { _agT2Active = v; }, _AG_T2_CONCURRENCY);
    if (_agBufferCoverQueue.length > 0 || _agT2Active > 0) return;
    _agPumpTier(_agBackgroundCoverQueue, 3, () => _agT3Active, (v) => { _agT3Active = v; }, _AG_T3_CONCURRENCY);
}

/**
 * Resolve and patch a cover image for one game.
 *
 * tier 1 = viewport (highest priority)
 * tier 2 = buffer
 * tier 3 = background (lowest priority)
 *
 * Fast-path: http coverUrl / localStorage http → patches card immediately,
 * no IPC needed.  file:// URLs are probed then used.  Only when no cache
 * exists does the expensive getMetadata() call happen.
 */


function _agCoverCacheKeys(game) {
    const normTitle = String(game.title || game.name || game.appName || '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');

    return [...new Set([
        game.id,
        game.appid,
        game.appId,
        game.appName,
        game.namespace,
        game.productId,
        game.catalogItemId,
        game.offerId,
        game.allIds?.steam,
        game.allIds?.epic,
        game.allIds?.gog,
        game.title,
        game.name,
        normTitle,
    ].filter(Boolean).map(String))];
}

function _agBulkCoverIdentityForGame(game) {
    const key = _agArtworkKey(game);
    const ids = _agArtworkAliasesForGame(game);
    const candidateManagedLocalUrls = [...new Set([
        game?.coverUrl,
        game?.image,
        game?.defaultImage,
    ].filter(url => _agIsManagedArtworkCacheUrl(url)).map(String))];
    return {
        key,
        ids,
        candidateManagedLocalUrls,
        platform: game?.platform || game?.platforms?.[0] || '',
        accountId: _agCanonicalAccountKey(game),
        appName: game?.appName || game?.appid || game?.appId || '',
        namespace: game?.namespace || game?.allIds?.epic || '',
        productId: game?.productId || game?.catalogItemId || game?.offerId || '',
        title: game?.title || game?.name || game?.appName || '',
    };
}


function _agGridThumbnailSourceUrls(games) {
    return [...new Set((Array.isArray(games) ? games : []).map(game => {
        const record = _agArtworkRecordFor(game, false);
        const cover = record?.status === 'ready' ? record.localUrl : (game?.coverUrl || game?.image || game?.defaultImage);
        return _agIsManagedArtworkCacheUrl(cover) ? String(cover) : '';
    }).filter(Boolean))];
}

window.__agPendingGridThumbnailMappings = window.__agPendingGridThumbnailMappings instanceof Map ? window.__agPendingGridThumbnailMappings : new Map();
window.__agGridThumbnailLoads = window.__agGridThumbnailLoads instanceof Map ? window.__agGridThumbnailLoads : new Map();

function _agAcceptGridThumbnailMappings(images, { deferIfScrolling = true } = {}) {
    const target = deferIfScrolling && window._vs?._isScrolling
        ? window.__agPendingGridThumbnailMappings
        : window.__agGridThumbnailByCover;
    let accepted = 0;
    for (const [sourceUrl, thumbnailUrl] of Object.entries(images || {})) {
        if (!_agIsManagedArtworkCacheUrl(sourceUrl) || !_agIsGridThumbnailUrl(thumbnailUrl)) continue;
        target.set(sourceUrl, thumbnailUrl);
        window.__agVerifiedArtworkUrls.add(thumbnailUrl);
        accepted++;
    }
    return accepted;
}

function _agFlushPendingGridThumbnailMappings() {
    if (!window.__agPendingGridThumbnailMappings?.size) return 0;
    const images = Object.fromEntries(window.__agPendingGridThumbnailMappings);
    window.__agPendingGridThumbnailMappings.clear();
    return _agAcceptGridThumbnailMappings(images, { deferIfScrolling: false });
}

async function _agLoadExistingGridThumbnails(games, { limit = 48, waitForPending = false, defer = true } = {}) {
    if (!window.electronAPI?.getGridArtworkThumbnails) return 0;
    if (defer && Number.isFinite(limit)) {
        setTimeout(() => {
            _agLoadExistingGridThumbnails(games, { limit, waitForPending: false, defer: false })
                .then(loaded => {
                    if (loaded && !window._vs?._isScrolling) _agRebindCachedCards((Array.isArray(games) ? games : []).slice(0, limit));
                })
                .catch(() => {});
        }, 0);
        return 0;
    }
    const known = window.__agGridThumbnailByCover;
    const urls = _agGridThumbnailSourceUrls(games)
        .filter(url => !known.has(url))
        .slice(0, Number.isFinite(limit) ? Math.max(0, limit) : undefined);
    if (!urls.length) return 0;

    const waits = [];
    const newUrls = [];
    for (const url of urls) {
        const pending = window.__agGridThumbnailLoads.get(url);
        if (pending) {
            if (waitForPending) waits.push(pending);
        }
        else newUrls.push(url);
    }
    for (let index = 0; index < newUrls.length; index += 96) {
        const batch = newUrls.slice(index, index + 96);
        const request = window.electronAPI.getGridArtworkThumbnails(batch, { createMissing: false })
            .then(response => _agAcceptGridThumbnailMappings(response?.images, { deferIfScrolling: false }))
            .catch(() => 0)
            .finally(() => batch.forEach(url => {
                if (window.__agGridThumbnailLoads.get(url) === request) window.__agGridThumbnailLoads.delete(url);
            }));
        batch.forEach(url => window.__agGridThumbnailLoads.set(url, request));
        waits.push(request);
    }
    const counts = await Promise.all(waits);
    return counts.reduce((sum, count) => sum + (Number(count) || 0), 0);
}

const _agGridThumbnailPrepareQueue = [];
const _agGridThumbnailPrepareQueued = new Set();
let _agGridThumbnailPrepareActive = false;
let _agGridThumbnailPrepareTimer = null;

function _agPumpGridThumbnailPreparation() {
    if (_agGridThumbnailPrepareActive || !_agGridThumbnailPrepareQueue.length) return;
    if (window._vs?._isScrolling || window._vs?._isFastScrolling) {
        _agGridThumbnailPrepareTimer = setTimeout(_agPumpGridThumbnailPreparation, 200);
        return;
    }
    _agGridThumbnailPrepareTimer = null;
    const batch = _agGridThumbnailPrepareQueue.splice(0, 8);
    batch.forEach(url => _agGridThumbnailPrepareQueued.delete(url));
    _agGridThumbnailPrepareActive = true;
    window.electronAPI.getGridArtworkThumbnails(batch, { createMissing: true })
        .then(response => _agAcceptGridThumbnailMappings(response?.images))
        .catch(() => null)
        .finally(() => {
            _agGridThumbnailPrepareActive = false;
            _agGridThumbnailPrepareTimer = setTimeout(_agPumpGridThumbnailPreparation, 100);
        });
}

function _agScheduleGridThumbnailPreparation(games) {
    if (!window.electronAPI?.getGridArtworkThumbnails) return;
    for (const url of _agGridThumbnailSourceUrls(games)) {
        if (window.__agGridThumbnailByCover.has(url) || _agGridThumbnailPrepareQueued.has(url)) continue;
        _agGridThumbnailPrepareQueued.add(url);
        _agGridThumbnailPrepareQueue.push(url);
    }
    if (!_agGridThumbnailPrepareTimer && !_agGridThumbnailPrepareActive) {
        _agGridThumbnailPrepareTimer = setTimeout(_agPumpGridThumbnailPreparation, 150);
    }
}

async function _agApplyBulkCachedCovers(games, source = 'disk-cache-bulk', revision = null) {
    if (!window.electronAPI?.getCachedImagesBulk) return 0;
    const list = (Array.isArray(games) ? games : []).filter(Boolean);
    if (!list.length) return 0;

    const identities = [];
    for (const game of list) {
        const record = _agArtworkRecordFor(game);
        if (!record || record.status === 'ready') {
            _agApplyReadyArtworkToGame(game);
            continue;
        }
        identities.push(_agBulkCoverIdentityForGame(game));
    }
    if (!identities.length) return 0;

    _agArtworkDiagnosticsBump('bulkArtworkLookupCount');
    const response = await window.electronAPI.getCachedImagesBulk(identities, 'cover').catch(() => null);
    const images = response?.images || {};
    const results = response?.results || {};
    window.__agLastBulkArtworkLookup = {
        cacheGeneration: response?.cacheGeneration || null,
        hits: Object.values(results).filter(result => result?.fileUrl).length,
        misses: Object.values(results).filter(result => !result?.fileUrl).length,
        persistedPathHits: Number(response?.persistedPathHits || 0),
        backfilledAliases: Number(response?.backfilledAliases || 0),
    };
    let changed = 0;
    for (const game of list) {
        const key = _agArtworkKey(game);
        const requestKey = images[key] ? key : _agGameKey(game);
        const cover = images[requestKey];
        const resolutionSource = results[requestKey]?.source || source;
        if (_agApplyCachedCoverToGame(game, cover, resolutionSource)) {
            const record = _agArtworkRecordFor(game, false);
            if (record) record.sourceRevision = revision;
            changed++;
        }
    }
    _agRefreshArtworkDiagnostics();
    return changed;
}

async function _agGetCachedImageAnyKey(game, type = 'cover') {
    if (type === 'cover' && _agApplyReadyArtworkToGame(game)) return game.coverUrl;
    return null;
}

function _agApplyCachedCoverToGame(game, cover, source = 'disk-cache') {
    if (!game || !cover || !String(cover).startsWith('file://')) return false;
    const creatorCover = game.coverUrl || game.image || game.defaultImage;
    if (_agIsCreatorArtworkGame(game) && _agIsUsableCardCover(creatorCover, game)) return false;
    if (_agIsManagedArtworkCacheUrl(cover)) window.__agVerifiedArtworkUrls.add(cover);
    return _agSetArtworkReady(game, cover, source);
}

function _agAcceptVerifiedBulkCover(game, cover, source = 'shared-bulk-cache') {
    if (!game || !_agIsManagedArtworkCacheUrl(cover)) return false;
    window.__agVerifiedArtworkUrls.add(cover);
    return _agSetArtworkReady(game, cover, source);
}
window.__baddelAcceptVerifiedBulkCover = _agAcceptVerifiedBulkCover;

function _agProjectReadyArtworkFromAllGames(readyGames) {
    const sourceGames = Array.isArray(window._allGamesCache) ? window._allGamesCache : [];
    const coverByAlias = new Map();
    for (const game of sourceGames) {
        const cover = game?.coverUrl || game?.image || game?.defaultImage;
        if (!_agIsUsableCardCover(cover, game)) continue;
        for (const alias of _agArtworkAliasesForGame(game)) coverByAlias.set(String(alias), cover);
    }
    let projected = 0;
    for (const game of Array.isArray(readyGames) ? readyGames : []) {
        const creatorCover = game?.coverUrl || game?.image || game?.defaultImage;
        if (_agIsCreatorArtworkGame(game) && _agIsUsableCardCover(creatorCover, game)) continue;
        const cover = _agArtworkAliasesForGame(game).map(alias => coverByAlias.get(String(alias))).find(Boolean);
        if (cover && _agApplyCachedCoverToGame(game, cover, 'all-games-canonical-projection')) projected += 1;
    }
    return projected;
}

async function _agWarmCachedCoversForGames(games, { limit = 48, reason = 'all-games-first-paint', revision = null } = {}) {
    const numericLimit = limit === Infinity ? Infinity : Math.max(0, Number(limit) || 0);
    const source = (Array.isArray(games) ? games : []);
    const visibleSlice = numericLimit === Infinity ? source : source.slice(0, numericLimit);
    const list = visibleSlice.filter(game => game && !_agHasLocalCover(game));
    if (!list.length) return 0;
    return _agApplyBulkCachedCovers(list, reason, revision);
}

function _agWarmCachedCoversInBackground(games, { skip = 48, reason = 'all-games-background-cache-warm' } = {}) {
    const list = (Array.isArray(games) ? games : []).slice(Math.max(0, Number(skip) || 0));
    if (!list.length) return;
    const run = async () => {
        const changed = await _agWarmCachedCoversForGames(list, { limit: list.length, reason });
        if (changed && window._vs?.items === games) {
            _agRebindCachedCards(list);
            _agEnsureVirtualGridIntegrity('all-games-background-cache-warm');
        }
    };
    if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(() => { run().catch(() => {}); }, { timeout: 1200 });
    } else {
        setTimeout(() => { run().catch(() => {}); }, 120);
    }
}

function _agInvalidateLocalCoverResolution(reason = 'cache-state-changed') {
    window.__agLocalCoverResolution = window.__agLocalCoverResolution || { signature: '', promise: null, generation: '' };
    window.__agLocalCoverResolution.signature = '';
    window.__agLocalCoverResolution.invalidatedBy = reason;
}

async function _agResolveLocalCoverPathsForRevision(games, { reason = 'all-games-local-cover-resolution', revision = null } = {}) {
    const list = Array.isArray(games) ? games : [];
    if (!list.length) return 0;
    const baseSignature = String(revision ?? list.map(_agArtworkKey).join('|'));
    window.__agLocalCoverResolution = window.__agLocalCoverResolution || { signature: '', promise: null, generation: '' };
    const state = window.__agLocalCoverResolution;
    const signature = baseSignature + '|' + String(state.generation || 'unknown');
    if (state.signature === signature) return 0;
    if (state.promise) {
        try { await state.promise; } catch {}
        const nextSignature = baseSignature + '|' + String(state.generation || 'unknown');
        if (state.signature === nextSignature) return 0;
    }
    const run = (async () => {
        const changed = await _agWarmCachedCoversForGames(list, { limit: Infinity, reason, revision: baseSignature });
        const lookup = window.__agLastBulkArtworkLookup || {};
        state.generation = lookup.cacheGeneration || state.generation || '';
        if (Number(lookup.hits || 0) > 0) {
            state.signature = baseSignature + '|' + String(state.generation || 'unknown');
        } else {
            state.signature = '';
        }
        if (changed) {
            _agRebindCachedCards(list);
            _agEnsureVirtualGridIntegrity(reason);
            if (typeof window._vsRender === 'function') window._vsRender(false, reason);
        }
        return changed;
    })();
    const tracked = run.finally(() => {
        if (state.promise === tracked) state.promise = null;
    });
    state.promise = tracked;
    return tracked;
}

async function _agResolveCoverForGame(game, tier = 3) {
    if (!game) return;
    const id = String(game.id ?? game.appName ?? game.title ?? '');
    if (!id) return;

    if (_agApplyReadyArtworkToGame(game)) return;

    const record = _agArtworkRecordFor(game);
    if (!record || record.status === 'ready') return;
    if (record.status === 'retry_wait' && record.nextRetryAt > Date.now()) return;

    game._agCoverInFlight = true;
    if (Number(record.attempts || 0) >= 5) {
        _agSetArtworkTerminalError(game, 'ARTWORK_MAX_ATTEMPTS', 'Artwork retry limit reached');
        return;
    }
    record.status = 'resolving';
    record.attempts = Math.min(5, Number(record.attempts || 0) + 1);

    const creatorCover = game.coverUrl || game.image || game.defaultImage;
    if (_agIsCreatorArtworkGame(game) && _agIsUsableCardCover(creatorCover, game)) {
        _agSetArtworkReady(game, creatorCover, 'creator');
        return;
    }

    const verifyAndReady = async (url, source) => {
        if (!url || !String(url).startsWith('file://')) return false;
        record.status = 'verifying';
        if (await _agVerifyLocalArtworkUrl(url)) {
            if (_agIsManagedArtworkCacheUrl(url)) window.__agVerifiedArtworkUrls.add(url);
            _agSetArtworkReady(game, url, source);
            return true;
        }
        _agInvalidateArtworkRecord(game, 'local-file-unavailable');
        return false;
    };

    for (const localCandidate of [game.coverUrl, game.image, game.defaultImage]) {
        if (await verifyAndReady(localCandidate, 'existing-local-cover')) return;
    }

    const cacheKey = 'cover_' + id;
    try {
        const stored = localStorage.getItem(cacheKey);
        if (_agIsManagedArtworkCacheUrl(stored)) {
            localStorage.removeItem(cacheKey);
        } else {
            if (await verifyAndReady(stored, 'local-storage-cover')) return;
            if (stored && String(stored).startsWith('file://')) localStorage.removeItem(cacheKey);
        }
    } catch {}

    const remoteCandidates = _agArtworkCandidateUrlsFromGame(game);
    record.candidates = remoteCandidates;
    record.metadataComplete = false;

    if (window.electronAPI?.boostColdCoverBootstrap) {
        record.status = 'promoted';
        try {
            await window.electronAPI.boostColdCoverBootstrap([game], {
                reason: tier === 1 ? 'all-games-visible-cover-boost' : 'all-games-buffer-cover-boost',
                priority: tier === 1 ? 'visible' : (tier === 2 ? 'buffer' : 'prefetch'),
                concurrency: tier === 1 ? 3 : 1,
            });
        } catch (err) {
            record.lastError = err?.message || 'cover-boost-failed';
        }
        game._agCoverInFlight = false;
        return;
    }

    if (!remoteCandidates.length) {
        record.status = 'metadata_pending';
        _agSetCoverState(game, 'metadata_pending', { lastError: 'main-bootstrap-awaiting-metadata' });
    } else {
        record.status = 'queued_main';
        _agSetCoverState(game, 'queued_main', { lastError: null });
    }
    game._agCoverInFlight = false;

}

// ── User-library game classifier ──────────────────────────────────────────────
// Returns true only for games that belong in All Games:
//   Steam/Epic synced library records, manual/user-added games, and account-owned
//   merged records.  Auto-scanned installed-only games (Xbox, MS Store, EA registry
//   scan, etc.) return false — they belong in Installed Games only.
function _agIsUserLibraryGame(g) {
    if (!g) return false;

    const platform = (typeof _normPlatform === 'function')
        ? _normPlatform(g.platform || g.scannerPlatform || g.installSource || '')
        : String(g.platform || g.scannerPlatform || g.installSource || '').toLowerCase().trim();
    const scanner  = String(g.scannerPlatform || '').toLowerCase();

    // Manual/local/installed-only games do NOT belong in All Games.
    // They belong in Installed Games / local views only.
    if (
        platform === 'manual' ||
        scanner  === 'manual' ||
        g.installSource === 'manual' ||
        g.userAdded     === true ||
        g.addedManually === true
    ) {
        return false;
    }

    // Evidence that the record came from a synced account library (not just a local scan).
    const hasSyncedAccountEvidence =
        (Array.isArray(g.accountKeys)                && g.accountKeys.length > 0)             ||
        (Array.isArray(g.accounts)                   && g.accounts.length > 0)                ||
        (Array.isArray(g.owners)                     && g.owners.length > 0)                  ||
        (Array.isArray(g.ownedByAccountIds)          && g.ownedByAccountIds.length > 0)       ||
        (Array.isArray(g.steamLicensedAccountIds)    && g.steamLicensedAccountIds.length > 0) ||
        !!g.libraryAccountId  ||
        !!g.ownerAccountId    ||
        !!g.accountId         ||
        g.librarySource === 'synced-account' ||
        g.syncSource    === 'platform-sync'  ||
        g._agSource     === 'platform-sync';

    // Steam/Epic/GOG only belong when they came from a linked account library,
    // not merely from a local installed scanner.
    const isSyncedLibraryPlatform =
        platform === 'steam' || platform === 'epic' || platform === 'gog' ||
        scanner  === 'steam' || scanner  === 'epic' || scanner  === 'gog';
    if (isSyncedLibraryPlatform && hasSyncedAccountEvidence) return true;

    // Everything else is an auto-scanned installed-only record.
    return false;
}

function _agGetUserLibraryGames(games) {
    return (Array.isArray(games) ? games : []).filter(_agIsUserLibraryGame);
}

window._agIsUserLibraryGame   = _agIsUserLibraryGame;
window._agGetUserLibraryGames = _agGetUserLibraryGames;

// ── Canonical Ready-to-Install state ─────────────────────────────────────────
// Single source of truth for the count of owned-but-not-installed synced games.
// Published after every reliable library cache rebuild (onLibraryUpdated).
// Before that fires, state is not-ready and UIs show loading ("...").

function _agComputeReadyToInstallGamesFromCache() {
    if (!Array.isArray(window._allGamesCache) || window._allGamesCache.length === 0) return null;
    if (typeof _agIsInstalled !== 'function') return null;
    const lib = _agGetUserLibraryGames(window._allGamesCache);
    return lib.filter(g => { try { return !_agIsInstalled(g); } catch (_) { return false; } });
}

function _agPublishReadyToInstallState(games, source) {
    const count = Array.isArray(games) ? games.length : null;
    window.__readyToInstallState = {
        ready: true, games, count,
        version: (window.__readyToInstallState?.version ?? 0) + 1,
        source: source || 'accounts',
    };
    console.log(`[ReadyCount] published count=${count} source=${source}`);
    try {
        window.dispatchEvent(new CustomEvent('baddel:ready-install-updated', {
            detail: { count, source },
        }));
    } catch (_) {}
}

function _agMarkReadyToInstallNotReady(source) {
    window.__readyToInstallState = {
        ready: false, games: null, count: null,
        version: (window.__readyToInstallState?.version ?? 0) + 1,
        source: source || 'not-ready',
    };
    console.log(`[ReadyCount] state=not-ready source=${source}`);
    try {
        window.dispatchEvent(new CustomEvent('baddel:ready-install-updated', {
            detail: { count: null, source },
        }));
    } catch (_) {}
}

window.getCanonicalReadyToInstallGames = function() {
    return window.__readyToInstallState?.ready === true
        ? window.__readyToInstallState.games : null;
};

window.getCanonicalReadyToInstallCount = function() {
    return window.__readyToInstallState?.ready === true
        ? window.__readyToInstallState.count : null;
};

window.isCanonicalReadyToInstallReady = function() {
    return window.__readyToInstallState?.ready === true;
};

async function navigateToAllGames(opts = {}) {
    if (!opts.preserveFilters && !opts.restoreState) {
        window.electronAPI?.trackFeatureEvent?.('feature_viewed', {
            feature: 'library',
            view: window.agReadyOnly ? 'ready_to_install' : 'all_games',
        }).catch?.(() => {});
    }
    // Route version token: each navigation captures its own token.
    // After every await, stale callers check the token and exit without touching the DOM.
    window._agRouteVersion = (window._agRouteVersion || 0) + 1;
    const _myRouteToken = window._agRouteVersion;
    const _rdbg = typeof localStorage !== 'undefined' && localStorage.getItem('baddel_debug_vs') === '1';
    if (_rdbg) console.log('[AGROUTE] start token=' + _myRouteToken);

    // ── 0. Filter preservation (sync-complete / background refresh callers) ────────
    // When preserveFilters is set, capture state before anything resets it and
    // treat it as the restoreState so the normal restore path picks it up.
    if (opts.preserveFilters && !opts.restoreState) {
        const _snap = _agSnapshotFilterState();
        opts = {
            ...opts,
            _keepReadyMode: true,
            restoreState: {
                platform:      _snap.state.platform,
                sort:          _snap.state.sort,
                search:        _snap.state.search,
                account:       _snap.state.account,
                accountLabel:  _snap.selectedAccountText,
                scrollTop:     _snap.scrollTop,
            },
        };
    }

    // ── 1. Mode flags (synchronous) ──────────────────────────────────────────────
    if (!opts._keepReadyMode) {
        window.agReadyOnly = false;
        const t = document.getElementById('allGamesViewTitle');
        if (t) t.textContent = 'All Games';
    }
    document.body.classList.toggle('ag-ready-mode', !!window.agReadyOnly);

    // Set sidebar active state and page title BEFORE first paint.
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    if (window.agReadyOnly) {
        document.getElementById('nav-ready')?.classList.add('active');
        const titleEl = document.getElementById('allGamesViewTitle');
        if (titleEl) titleEl.textContent = 'Ready to Install';
    } else {
        document.getElementById('nav-all-games')?.classList.add('active');
    }
    // ── 2. Reset scroll and stale route state synchronously ─────────────────────
    // Set currentView early so getSidebarActionContext reads the right value
    // when the button-sync runs below (before any awaits).
    if (typeof currentView !== 'undefined') currentView = 'all-games';
    // Clear collection filter so Favorites/custom-collection rows don't stay active.
    if (!opts.restoreState && typeof currentFilters !== 'undefined') {
        currentFilters.collectionId = null;
    }
    const _agWarmActivation = _agCanWarmActivateAllGames(opts);
    {
        const _main = document.getElementById('mainContentArea');
        if (_main && !opts.restoreState?.scrollTop && !_agWarmActivation) {
            _main.style.scrollBehavior = 'auto';
            _main.scrollTop = 0;
        }
    }

    // ── 3. Hide other views (_agExitEmptyPageMode is called inside) ───────────────
    if (typeof _hideAllViews === 'function') _hideAllViews();

    // ── 4. Show allGamesView ─────────────────────────────────────────────────────
    const view = document.getElementById('allGamesView');
    if (view) view.style.display = 'block';

    // Sync button label now that the view is actually visible in the DOM.
    if (typeof syncSidebarActionButton === 'function') syncSidebarActionButton();
    requestAnimationFrame(() => {
        if (typeof syncSidebarActionButton === 'function') syncSidebarActionButton();
    });

    // ── 5. Install route skeleton synchronously (no stale cards visible) ─────────
    // Must run AFTER _hideAllViews (which calls _agExitEmptyPageMode and resets grid
    // styles) and AFTER display='block' so the skeleton is immediately visible.
    const _agRouteActivation = _agBeginAllGamesRoute(opts);

    try {
        // ── 6. Restore filter UI state (synchronous) ─────────────────────────────
        if (opts.restoreState) {
            const s = opts.restoreState;
            window._agState.platform = s.platform || 'all';
            window._agState.account  = s.account  || 'all';
            window._agState.sort     = s.sort     || 'title_asc';
            window._agState.search   = s.search   || '';

            document.querySelectorAll('.ag-pill').forEach(p => p.classList.remove('active'));
            const activePill = document.querySelector(`.ag-pill[data-platform="${s.platform}"]`);
            if (activePill) activePill.classList.add('active');

            const sortLabels = { title_asc: 'A → Z', title_desc: 'Z → A', playtime_desc: 'Most Played', multi_first: 'Multi-Platform First' };
            const sortLabelEl = document.getElementById('agSortLabel');
            if (sortLabelEl) sortLabelEl.textContent = sortLabels[s.sort] || 'A → Z';
            document.querySelectorAll('.ag-sort-item').forEach(i => i.classList.toggle('active', i.dataset.value === (s.sort || 'title_asc')));

            const searchEl = document.getElementById('allGamesSearch');
            if (searchEl) searchEl.value = s.search || '';

            const accountText = document.getElementById('selectedAgAccountText');
            if (accountText) accountText.innerText = s.accountLabel || 'All Accounts';
        }

        // ── 7. Account gate (first await) ─────────────────────────────────────────
        // Must come BEFORE inspecting the cache so removing all accounts while the
        // cache is populated correctly resets to the empty/onboarding state.
        const _syncSt = await window.electronAPI.platformSyncStatus?.().catch(() => ({}));
        if (window._agRouteVersion !== _myRouteToken) {
            if (_rdbg) console.log('[AGROUTE] stale token skipped token=' + _myRouteToken);
            return;
        }
        const _hasLinked = _syncSt?.steam === true || _syncSt?.epic === true || _syncSt?.gog === true;
        if (!_hasLinked) {
            window._allGamesCache    = [];
            window._allGamesRawCache = [];
            window._agNoLinkedAccounts = true;
            _agSetEmptyPageMode(true);
            _agSetToolbarVisible(false);
            _agRenderEmptyOnboarding();
            _agRenderAccountFilterOptions([]);
            return; // finally → _agEndAllGamesRoute()
        }

        // ── 8. Sanitize cache ─────────────────────────────────────────────────────
        if (Array.isArray(window._allGamesCache)) {
            window._allGamesCache = _agGetUserLibraryGames(window._allGamesCache);
        }
        if (Array.isArray(window._allGamesRawCache)) {
            window._allGamesRawCache = _agGetUserLibraryGames(window._allGamesRawCache);
        }

        // ── 9. Cache fast path ────────────────────────────────────────────────────
        if (window._allGamesCache && window._allGamesCache.length > 0) {
            const libraryCache = _agGetUserLibraryGames(window._allGamesCache);
            if (libraryCache.length > 0) {
                window._allGamesCache = libraryCache;
                _agRenderAccountFilterOptions(window._allGamesCache);

                // RTI loading guard: stale cache produces wrong pre-sync count.
                // Wait for canonical Ready-to-Install state before rendering cards.
                if (window.agReadyOnly
                    && typeof window.isCanonicalReadyToInstallReady === 'function'
                    && !window.isCanonicalReadyToInstallReady()) {
                    _agRenderReadyToInstallLoading(_myRouteToken);
                    return; // finally → _agEndAllGamesRoute(); listener re-renders when ready
                }

                // A normal restart usually enters this populated-cache fast path.
                // Restore verified local artwork before rendering; no Sync event is involved.
                const cacheWarmLimit = Number(window.__baddelAllGamesFirstPaintWarmLimit ?? 48);

                if (window.agReadyOnly && typeof window.getCanonicalReadyToInstallGames === 'function') {
                    const readyGames = window.getCanonicalReadyToInstallGames();
                    if (Array.isArray(readyGames)) _agProjectReadyArtworkFromAllGames(readyGames);
                }

                const visibleGames = window.agReadyOnly && typeof window.getCanonicalReadyToInstallGames === 'function'
                    ? (window.getCanonicalReadyToInstallGames() || [])
                    : window._allGamesCache;
                await _agWarmCachedCoversForGames(visibleGames, {
                    limit: cacheWarmLimit,
                    reason: window.agReadyOnly ? 'ready-to-install-before-first-paint' : 'all-games-before-first-paint',
                });
                await _agLoadExistingGridThumbnails(visibleGames);
                if (window._agRouteVersion !== _myRouteToken) return;
                _applyAgFilters({
                    resetScroll: !opts.restoreState?.scrollTop && _agRouteActivation !== 'warm',
                    reason: _agRouteActivation === 'warm' ? 'warm-navigation' : 'navigate-cache',
                    allowWarmReuse: _agRouteActivation === 'warm',
                });
                _agStartCompleteLibraryCoverHydration(visibleGames, window.agReadyOnly
                    ? 'ready-to-install-application-hydration'
                    : 'all-games-application-hydration');

                if (opts.restoreState?.scrollTop) {
                    requestAnimationFrame(() => requestAnimationFrame(() => {
                        const el = document.getElementById('mainContentArea');
                        if (el) el.scrollTop = opts.restoreState.scrollTop;
                        if (typeof window._vsRender === 'function') window._vsRender(false, 'scroll-restore');
                    }));
                }
                return; // finally -> _agEndAllGamesRoute()
            }
            // Cache only had installed-only games — treat as empty for onboarding.
            if (await _agMaybeRenderEmptyOnboarding('navigateToAllGames-existing-cache')) return;
            if (window._agRouteVersion !== _myRouteToken) {
                if (_rdbg) console.log('[AGROUTE] stale token skipped token=' + _myRouteToken);
                return;
            }
        }

        if (await _agMaybeRenderEmptyOnboarding('navigateToAllGames')) return;
        if (window._agRouteVersion !== _myRouteToken) {
            if (_rdbg) console.log('[AGROUTE] stale token skipped token=' + _myRouteToken);
            return;
        }

        // ── 10. Full rebuild ──────────────────────────────────────────────────────
        // suppressInitialLoading: keep our route skeleton until real data is ready.
        await renderAllGamesView({ stableLayout: true, suppressInitialLoading: true });

    } finally {
        if (_rdbg) console.log('[AGROUTE] finish token=' + _myRouteToken + ' current=' + (window._agRouteVersion || 0));
        // Tear down route lock only for the most recent navigation; a stale caller
        // must not remove the pending state that the still-running current call needs.
        if (window._agRouteVersion === _myRouteToken) {
            _agEndAllGamesRoute();
        }
    }
}

// Show a centered loading placeholder on the Ready to Install page while canonical
// state is not yet available. Hides the game grid and inserts a sibling wrapper
// inside the same parent section so the panel is not constrained by the grid's
// column layout or justify-content:start alignment.
// DOM updates are idempotent; the event listener registers only once.
function _agRenderReadyToInstallLoading(routeToken) {
    _agSetToolbarVisible(false);
    const countEl = document.getElementById('agResultCount');
    if (countEl) countEl.textContent = '…';

    // Hide the grid so stale pre-sync cards are not visible.
    const grid = document.getElementById('allGamesGrid');
    if (grid) grid.style.display = 'none';

    // Insert a sibling loading wrapper inside library-section so it spans the
    // full content width independently of the grid's column layout.
    const section = grid?.parentElement;
    if (section && !section.querySelector('.ag-rti-loading-wrap')) {
        const wrap = document.createElement('div');
        wrap.className = 'ag-rti-loading-wrap';
        wrap.innerHTML =
            '<div class="ag-ready-loading-state">' +
            '<div class="ag-ready-loading-inner">' +
            '<div class="acc-spinner ag-rls-spinner"></div>' +
            '<div>' +
            '<span class="ag-rls-title">Preparing your library…</span>' +
            '<span class="ag-rls-sub">Syncing accounts and ready‑to‑install games</span>' +
            '</div>' +
            '</div>' +
            '</div>';
        section.appendChild(wrap);
    }

    // Remove any previously registered listener before adding a new one.
    // This prevents a stale listener from calling _applyAgFilters after a newer
    // RTI navigation has already rendered the correct result.
    if (window._agRtiLoadingListener) {
        window.removeEventListener('baddel:ready-install-updated', window._agRtiLoadingListener);
        window._agRtiLoadingListener = null;
    }
    window._agRtiLoadingListenerActive = true;

    function _onCanonicalReady(evt) {
        window._agRtiLoadingListenerActive = false;
        window._agRtiLoadingListener = null;
        window.removeEventListener('baddel:ready-install-updated', _onCanonicalReady);
        // Stale route guard: a newer navigation has superseded this one.
        if (routeToken !== undefined && window._agRouteVersion !== routeToken) return;
        // Remove loading wrapper and restore grid visibility before re-rendering.
        document.querySelector('.ag-rti-loading-wrap')?.remove();
        const g = document.getElementById('allGamesGrid');
        if (g) g.style.display = '';
        if (!window.agReadyOnly) return;
        if (typeof currentView !== 'undefined' && currentView !== 'all-games') return;
        if (!evt?.detail?.count && evt?.detail?.count !== 0) return;
        _agSetToolbarVisible(true);
        _applyAgFilters({ resetScroll: false }); // loading overlay was shown → scroll was 0; keep position if not
    }
    window._agRtiLoadingListener = _onCanonicalReady;
    window.addEventListener('baddel:ready-install-updated', _onCanonicalReady);
}

// ── All Games: toolbar visibility helper ─────────────────────────────────────
function _agSetToolbarVisible(visible) {
    const sticky = document.getElementById('agToolbarSticky');
    if (!sticky) return;
    sticky.classList.toggle('ag-toolbar-hidden', !visible);
}

// ── All Games: hide the legacy Epic-only banners ──────────────────────────────
function _agHideEpicBanner() {
    const notLinked = document.getElementById('epicNotLinked');
    const syncing   = document.getElementById('epicSyncing');
    if (notLinked) notLinked.style.display = 'none';
    if (syncing)   syncing.style.display   = 'none';
}

// ── All Games: reset grid back to normal game-card layout ────────────────────
// Pass { preserveVirtualGrid: true } to skip clearing display/height/minHeight
// when the virtual scroller has live rows that must stay anchored.
function _agResetAllGamesGridMode(options = {}) {
    const grid = document.getElementById('allGamesGrid');
    if (!grid) return;
    grid.classList.remove('ag-empty-mode');
    grid.style.flexDirection = '';
    grid.style.alignItems    = '';
    grid.style.width         = '';
    if (!options.preserveVirtualGrid) {
        grid.style.display   = '';
        grid.style.height    = '';
        grid.style.minHeight = '';
    }
}

// Pass { preserveVirtualGrid: true } to skip clearing grid's layout styles when
// the virtual scroller has live rows — prevents orphaning position:absolute wrappers.
function _agExitEmptyPageMode(options = {}) {
    window._agNoLinkedAccounts = false;
    const main = document.getElementById('mainContentArea');
    const view = document.getElementById('allGamesView');
    const grid = document.getElementById('allGamesGrid');
    const list = document.getElementById('allGamesList');
    if (main) main.classList.remove('ag-no-scroll-empty');
    if (view) view.classList.remove('ag-empty-page');
    if (grid) {
        grid.classList.remove('ag-empty-mode');
        if (!options.preserveVirtualGrid) {
            grid.style.display        = '';
            grid.style.flexDirection  = '';
            grid.style.alignItems     = '';
            grid.style.justifyContent = '';
            grid.style.width          = '';
            grid.style.height         = '';
            grid.style.minHeight      = '';
            grid.style.padding        = '';
            grid.style.overflow       = '';
            grid.style.position       = '';
        }
    }
    window._agApplyDisplayPrefs?.();
}

// Idempotent repair helper: restores the grid's position/display/height if the
// virtual scroller has live rows but DOM styles were cleared prematurely. Only
// called in the background-skip path — never removes rows or clears cardPool.
function _agEnsureVirtualGridIntegrity(reason) {
    const vs = window._vs;
    if (!vs || !Array.isArray(vs.items) || vs.items.length === 0) return;
    const grid = document.getElementById('allGamesGrid');
    const view = document.getElementById('allGamesView');
    if (!grid || window._agDisplayPrefs?.viewMode !== 'grid') return;
    if (typeof currentView !== 'undefined' && currentView !== 'all-games') return;
    if (view?.style.display === 'none' || getComputedStyle(grid).display === 'none') return;
    if (!grid.style.position || grid.style.position === '') grid.style.position = 'relative';
    if (vs.totalHeight != null && vs.totalHeight > 0 && (!grid.style.height || grid.style.height === '')) {
        grid.style.height = vs.totalHeight + 'px';
    }
    if (typeof localStorage !== 'undefined' && localStorage.getItem('baddel_debug_vs') === '1') {
        console.log(`[AllGames] _agEnsureVirtualGridIntegrity(${reason}): pos=${grid.style.position} h=${grid.style.height}`);
    }
}

// ── Layout-lock helpers — prevent the grid collapsing to zero during nav ─────

function _agLockAllGamesLayout() {
    const view = document.getElementById('allGamesView');
    const grid = document.getElementById('allGamesGrid');
    const main = document.getElementById('mainContentArea');
    if (!grid) return;
    if (view) view.classList.add('ag-layout-loading');
    const available = (main ? main.clientHeight : window.innerHeight) - 180;
    grid.style.minHeight = Math.max(520, available) + 'px';
}

function _agUnlockAllGamesLayout() {
    requestAnimationFrame(() => {
        const view = document.getElementById('allGamesView');
        const grid = document.getElementById('allGamesGrid');
        if (view) view.classList.remove('ag-layout-loading');
        if (grid && !grid.classList.contains('ag-empty-mode')) {
            grid.style.minHeight = '';
        }
    });
}

function _agStableLibraryLoadingHTML() {
    return '<div class="ag-stable-loading-panel"><div class="acc-spinner"></div><span>Loading library…</span></div>';
}

function _agRouteSkeletonHTML() {
    return '<div class="ag-route-skeleton"><div class="acc-spinner"></div><span>Loading library…</span></div>';
}

function _agGameKey(game) {
    return String(game?.id ?? game?.appName ?? game?.title ?? '');
}

function _agItemKeyList(items) {
    return (Array.isArray(items) ? items : []).map(_agGameKey);
}

function _agHasLiveVirtualGrid() {
    return !!(
        window._vs
        && Array.isArray(_vs.items)
        && _vs.items.length > 0
        && _vs.lifecycle === 'warm'
        && _vs.totalHeight > 0
    );
}

function _agShouldPreserveVirtualGrid() {
    return _agHasLiveVirtualGrid() && !window._agNoLinkedAccounts;
}
window._agShouldPreserveVirtualGrid = _agShouldPreserveVirtualGrid;

function _agComputeVirtualTotalHeight(itemCount = _vs.items.length) {
    if (!_vs.cols || !_vs.rowH || itemCount <= 0) return 0;
    const totalRows = Math.ceil(itemCount / _vs.cols);
    return Math.max(0, totalRows * _vs.rowH - _vs.gap);
}

function _agApplyVirtualGridGeometry(grid = document.getElementById('allGamesGrid')) {
    if (!grid || !_vs.totalHeight) return;
    grid.style.position = 'relative';
    grid.style.display = 'block';
    grid.style.height = _vs.totalHeight + 'px';
}

function _agCanWarmActivateAllGames(opts = {}) {
    if (opts.forceCold || opts.stableLayout || opts.suppressInitialLoading) return false;
    if (opts.restoreState) return false;
    if (window.agReadyOnly) return false;
    if (!_agHasLiveVirtualGrid()) return false;
    return Array.isArray(window._allGamesCache) && window._allGamesCache.length > 0;
}

function _agHasWarmReadyToInstallProjection() {
    return !!(
        window.agReadyOnly
        && (typeof currentView === 'undefined' || currentView === 'all-games')
        && _agHasLiveVirtualGrid()
        && window._readyToInstallRenderedGames != null
    );
}

function _agCaptureVirtualScrollAnchor(items = _vs.items) {
    const scroller = _vs.scroller || document.getElementById('mainContentArea');
    if (!scroller || !_vs.cols || !_vs.rowH || !Array.isArray(items) || !items.length) return null;
    const relScroll = Math.max(0, Number(scroller.scrollTop || 0) - Number(_vs._gridTop || 0));
    const row = Math.max(0, Math.floor(relScroll / _vs.rowH));
    const index = Math.min(items.length - 1, row * _vs.cols);
    return {
        gameId: _agGameKey(items[index]),
        beforeId: index > 0 ? _agGameKey(items[index - 1]) : null,
        afterId: index + 1 < items.length ? _agGameKey(items[index + 1]) : null,
        rowOffset: relScroll - row * _vs.rowH,
        rawScrollTop: Number(scroller.scrollTop || 0),
    };
}

function _agRestoreVirtualScrollAnchor(anchor, items = _vs.items) {
    const scroller = _vs.scroller || document.getElementById('mainContentArea');
    if (!scroller || !anchor || !_vs.cols || !_vs.rowH || !Array.isArray(items) || !items.length) return false;
    const keys = _agItemKeyList(items);
    let index = keys.indexOf(anchor.gameId);
    if (index < 0 && anchor.afterId) index = keys.indexOf(anchor.afterId);
    if (index < 0 && anchor.beforeId) index = keys.indexOf(anchor.beforeId);
    if (index < 0) {
        scroller.scrollTop = Math.min(anchor.rawScrollTop || 0, Math.max(0, (_vs.totalHeight || 0) - scroller.clientHeight));
        return false;
    }
    const row = Math.floor(index / _vs.cols);
    const maxTop = Math.max(0, (_vs.totalHeight || 0) - scroller.clientHeight);
    scroller.scrollTop = Math.max(0, Math.min(maxTop, (_vs._gridTop || 0) + row * _vs.rowH + (anchor.rowOffset || 0)));
    return true;
}

function _agPruneCardCacheForItems(items) {
    if (!(_vs.cardCache instanceof Map)) return;
    const ids = new Set(_agItemKeyList(items));
    for (const [id] of _vs.cardCache) {
        if (!ids.has(String(id))) {
            _vs.cardCache.delete(id);
            _vs._coverQueued.delete(id);
        }
    }
    for (const [id, card] of _vs.retainedCards) {
        if (ids.has(String(id))) continue;
        _vs.retainedCards.delete(id);
        _vs.retainedCardBytes = Math.max(0, _vs.retainedCardBytes - Number(card?._vsRetainedBytes || 0));
        if (card) {
            _vsClearCardCoverForRebind(card, null);
            card._vsBoundGame = null;
            card._vsRetainedBytes = 0;
            _vs.freeCards.push(card);
        }
    }
}

function _agRebindCachedCards(items) {
    if (!(_vs.cardCache instanceof Map) || !Array.isArray(items)) return 0;
    const byId = new Map(items.map((game) => [_agGameKey(game), game]));
    let changed = 0;
    for (const [id, card] of _vs.cardCache.entries()) {
        const game = byId.get(String(id));
        if (!game) continue;
        _vsBindCard(card, game);
        changed++;
    }
    return changed;
}

function _agRebuildVisibleCardMap() {
    if (!(_vs.visibleCardsByGameId instanceof Map)) _vs.visibleCardsByGameId = new Map();
    _vs.visibleCardsByGameId.clear();
    for (const rowEl of _vs.cardPool.values()) {
        rowEl.querySelectorAll?.('.game-card[data-id]').forEach((card) => {
            const id = String(card.dataset.id || '');
            if (id) _vs.visibleCardsByGameId.set(id, card);
        });
    }
    return _vs.visibleCardsByGameId;
}

function _agBoundCardCacheToMountedRows() {
    const visible = _agRebuildVisibleCardMap();
    if (!(_vs.cardCache instanceof Map)) return;
    for (const [id] of _vs.cardCache) {
        if (!visible.has(String(id))) _vs.cardCache.delete(id);
    }
}

function _vsCardDecodedBytes(card) {
    const img = _vsCardRefs(card).img;
    const source = img?.getAttribute('src') || '';
    if (!source) return 0;
    if (_agIsGridThumbnailUrl(source)) return 160 * 240 * 4;
    const width = Number(img.naturalWidth || 384);
    const height = Number(img.naturalHeight || 576);
    return Math.max(0, width * height * 4);
}

function _vsEvictRetainedCardsToBudget() {
    while (_vs.retainedCardBytes > _vs.retainedCardBudgetBytes && _vs.retainedCards.size || _vs.retainedCards.size > _vs.retainedCardLimit) {
        const oldestId = _vs.retainedCards.keys().next().value;
        const card = _vs.retainedCards.get(oldestId);
        _vs.retainedCards.delete(oldestId);
        _vs.retainedCardBytes = Math.max(0, _vs.retainedCardBytes - Number(card?._vsRetainedBytes || 0));
        if (card) {
            _vsClearCardCoverForRebind(card, null);
            card._vsBoundGame = null;
            card._vsRetainedBytes = 0;
            _vs.freeCards.push(card);
        }
        _vs.retainedCardStats.evictions++;
    }
}

function _vsRetainCard(card, id) {
    if (!card || !id) { if (card) _vs.freeCards.push(card); return; }
    const previous = _vs.retainedCards.get(id);
    if (previous && previous !== card) {
        _vs.retainedCardBytes = Math.max(0, _vs.retainedCardBytes - Number(previous._vsRetainedBytes || 0));
        _vsClearCardCoverForRebind(previous, null);
        previous._vsBoundGame = null;
        _vs.freeCards.push(previous);
    }
    _vs.retainedCards.delete(id);
    card._vsRetainedBytes = _vsCardDecodedBytes(card);
    _vs.retainedCards.set(id, card);
    _vs.retainedCardBytes += card._vsRetainedBytes;
    _vs.retainedCardStats.peakBytes = Math.max(_vs.retainedCardStats.peakBytes, _vs.retainedCardBytes);
    _vsEvictRetainedCardsToBudget();
}

function _vsReleaseRow(rowIdx, rowEl) {
    if (!rowEl) return 0;
    let released = 0;
    const cards = Array.from(rowEl.children || []).filter((el) => el?.classList?.contains('game-card'));
    for (const card of cards) {
        const id = String(card.dataset?.id || '');
        if (id) {
            _vs.cardCache?.delete?.(id);
            _vs.visibleCardsByGameId?.delete?.(id);
        }
        card.dataset.poolState = 'retained';
        card.remove();
        _vsRetainCard(card, id);
        released++;
    }
    rowEl.remove();
    _vs.rowBindings?.delete?.(rowIdx);
    return released;
}

function _vsReleaseAllRows() {
    if (!(_vs.cardPool instanceof Map)) return 0;
    let released = 0;
    for (const [rowIdx, rowEl] of Array.from(_vs.cardPool.entries())) {
        released += _vsReleaseRow(rowIdx, rowEl);
    }
    _vs.cardPool.clear();
    _vs.rowBindings?.clear?.();
    _vs.cardCache?.clear?.();
    _vs.visibleCardsByGameId?.clear?.();
    return released;
}

function _vsAcquireCard(game) {
    const gameId = _agGameKey(game);
    let card = _vs.retainedCards.get(gameId);
    if (card) {
        _vs.retainedCards.delete(gameId);
        _vs.retainedCardBytes = Math.max(0, _vs.retainedCardBytes - Number(card._vsRetainedBytes || 0));
        card._vsRetainedBytes = 0;
        _vs.retainedCardStats.hits++;
        const expectedCover = _agResolveCardCoverPayload(game)?.cover || '';
        if (card._vsBoundGame !== game || String(card.dataset.coverUrl || '') !== String(expectedCover)) {
            _vsBindCard(card, game);
        } else {
            card._vsBoundGame = game;
        }
    } else {
        _vs.retainedCardStats.misses++;
        card = _vs.freeCards.pop();
        if (card) _vsBindCard(card, game);
        else card = _vsBuildCard(game);
    }
    card.dataset.poolState = 'mounted';
    _vs.cardCache.set(gameId, card);
    _vs.visibleCardsByGameId.set(gameId, card);
    return card;
}

// Synchronous first-paint helper — call AFTER view.style.display='block' and AFTER _hideAllViews.
// Clears stale virtual-scroll row DOM (without touching cardCache) and installs a stable skeleton.
function _agBeginAllGamesRoute(opts = {}) {
    const main   = document.getElementById('mainContentArea');
    const view   = document.getElementById('allGamesView');
    const grid   = document.getElementById('allGamesGrid');
    const list   = document.getElementById('allGamesList');
    const warmActivation = _agCanWarmActivateAllGames(opts);

    if (main) {
        main._agSavedScrollBehavior = main.style.scrollBehavior;
        main.style.scrollBehavior = 'auto';
    }

    window._agApplyDisplayPrefs?.({ routeActive: true });

    if (warmActivation) {
        _agExitEmptyPageMode({ preserveVirtualGrid: true });
        _agEnsureVirtualGridIntegrity('warm-route');
        if (grid) grid.classList.remove('ag-empty-mode', 'ag-ready-empty-grid');
        if (view) view.classList.remove('ag-first-paint-lock');
        document.body.classList.remove('ag-route-pending');
        return 'warm';
    }

    _vs.cardPool.forEach(row => row.remove());
    _vs.cardPool.clear();
    _vs.visibleCardsByGameId?.clear?.();
    _vs.renderedStart = -1;
    _vs.renderedEnd   = -1;
    _vs.cols          = 0;
    _vs.totalHeight   = 0;
    _vs.lifecycle     = 'invalidated';
    _vs._gridTopDirty = true;

    if (grid) {
        grid.classList.remove('ag-empty-mode');
        grid.style.position  = 'relative';
        grid.style.height    = '';
        grid.style.minHeight = 'calc(100vh - 180px)';
        if (window._agDisplayPrefs?.viewMode === 'grid') grid.innerHTML = _agRouteSkeletonHTML();
    }

    document.body.classList.add('ag-route-pending');
    if (view) view.classList.add('ag-first-paint-lock');
    return 'cold';
}

// Tear down route lock — safe to call multiple times.
function _agEndAllGamesRoute() {
    document.body.classList.remove('ag-route-pending');
    const view = document.getElementById('allGamesView');
    if (view) view.classList.remove('ag-first-paint-lock');
    // Restore scroll behavior after the current paint cycle
    requestAnimationFrame(() => {
        const main = document.getElementById('mainContentArea');
        if (main && main._agSavedScrollBehavior !== undefined) {
            main.style.scrollBehavior = main._agSavedScrollBehavior;
            delete main._agSavedScrollBehavior;
        }
    });
}

function _agSetEmptyPageMode(enabled) {
    if (!enabled) { _agExitEmptyPageMode(); return; }
    const main = document.getElementById('mainContentArea');
    const view = document.getElementById('allGamesView');
    const grid = document.getElementById('allGamesGrid');
    if (main) main.classList.add('ag-no-scroll-empty');
    if (view) view.classList.add('ag-empty-page');
    if (grid) grid.classList.add('ag-empty-mode');
}

// ── All Games: render polished dual-platform onboarding empty state ───────────
function _agRenderEmptyOnboarding() {
    const grid = document.getElementById('allGamesGrid');
    const list = document.getElementById('allGamesList');
    if (!grid) return;
    _agSetEmptyPageMode(true);
    _agSetToolbarVisible(false);
    window._agNoLinkedAccounts = true;

    // Clear content and apply empty-mode class — all layout is handled by CSS
    grid.innerHTML = '';
    grid.classList.add('ag-empty-mode');
    if (list) list.style.display = 'none';
    // Clear any leftover inline styles from previous renders
    grid.style.display       = '';
    grid.style.flexDirection = '';
    grid.style.alignItems    = '';
    grid.style.width         = '';
    grid.style.height        = '';
    grid.style.minHeight     = '';

    // Keep list hidden during empty onboarding
    if (list) list.style.display = 'none';

    const steamClick = "syncEmptyLibraryPlatform('steam')";
    const epicClick  = "syncEmptyLibraryPlatform('epic')";
    const gogClick   = "syncEmptyLibraryPlatform('gog')";

    const linkIcon = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="2.5"
        stroke-linecap="round" stroke-linejoin="round">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
    </svg>`;

    const panel = document.createElement('div');
    panel.className = 'ag-empty-onboarding';
    panel.innerHTML = `
        <h2 class="ag-empty-heading">Your Game Library Starts Here</h2>
        <p class="ag-empty-sub">
            Connect your Steam, Epic Games, or GOG account to browse,
            track and launch your entire collection in one place.
        </p>

        <div class="ag-platform-cards">

            <div class="ag-platform-card">
                <div class="ag-pc-logo">
                    <img src="../assets/Steam.png" alt="Steam">
                    <span class="ag-pc-platform-name">Steam Library</span>
                </div>
                <p class="ag-pc-desc">
                    Import all your owned Steam games, playtime,
                    and artwork automatically.
                </p>
                <button class="ag-pc-btn" onclick="${steamClick}">
                    ${linkIcon}
                    Sync Steam
                </button>
            </div>

            <div class="ag-platform-card">
                <div class="ag-pc-logo">
                    <img src="../assets/epic.svg" alt="Epic Games" class="ag-pc-invert">
                    <span class="ag-pc-platform-name">Epic Games Library</span>
                </div>
                <p class="ag-pc-desc">
                    Sync your Epic Games account and see every
                    free and purchased title with one click.
                </p>
                <button class="ag-pc-btn" onclick="${epicClick}">
                    ${linkIcon}
                    Sync Epic
                </button>
            </div>

            <div class="ag-platform-card">
                <div class="ag-pc-logo">
                    <img src="../assets/gog.png" alt="GOG">
                    <span class="ag-pc-platform-name">GOG Library</span>
                </div>
                <p class="ag-pc-desc">
                    Link your GOG account and sync your owned games
                    through Baddel's existing library connection.
                </p>
                <button class="ag-pc-btn" onclick="${gogClick}">
                    ${linkIcon}
                    Sync GOG
                </button>
            </div>

        </div>
    `;

    grid.appendChild(panel);
}

async function _agHasLinkedSteamOrEpicAccounts() {
    try {
        const steamRes     = await window.electronAPI?.platformSyncGetAccounts?.('steam');
        const epicRes      = await window.electronAPI?.platformSyncGetAccounts?.('epic');
        const gogRes       = await window.electronAPI?.platformSyncGetAccounts?.('gog');
        const steamAccounts = steamRes?.accounts || [];
        const epicAccounts  = epicRes?.accounts  || [];
        const gogAccounts   = gogRes?.accounts   || [];
        return steamAccounts.length > 0 || epicAccounts.length > 0 || gogAccounts.length > 0;
    } catch (err) {
        console.warn('[AllGamesEmpty] account check failed:', err);
        return false;
    }
}

async function _agMaybeRenderEmptyOnboarding(reason = '') {
    // Use the raw cache (before library filtering) so that installed-only games
    // don't incorrectly count as "has library games".
    const rawCache     = Array.isArray(window._allGamesRawCache) ? window._allGamesRawCache : window._allGamesCache;
    const libraryGames = _agGetUserLibraryGames(rawCache);
    const hasGames     = libraryGames.length > 0;

    if (hasGames) {
        window._agNoLinkedAccounts = false;
        _agSetEmptyPageMode(false);
        _agSetToolbarVisible(true);
        return false;
    }

    const hasLinkedAccounts = await _agHasLinkedSteamOrEpicAccounts();

    if (!hasLinkedAccounts) {
        console.log('[AllGamesEmpty] showing onboarding:', reason);
        window._agNoLinkedAccounts = true;
        _agSetEmptyPageMode(true);
        _agSetToolbarVisible(false);
        _agRenderEmptyOnboarding();
        return true;
    }

    window._agNoLinkedAccounts = false;
    _agSetEmptyPageMode(false);
    _agSetToolbarVisible(true);
    return false;
}

function _agSafeRenderAllGamesView(options) {
    const fn = window.renderAllGamesView;
    if (typeof fn !== 'function') return Promise.resolve(null);
    return Promise.resolve(fn(options));
}

window.renderAllGamesView = async function(options = {}) {
    // Guard: prevent concurrent renders — if a render is already in progress
    // (e.g. from a library-updated event while user is navigating), skip the duplicate.
    if (window._allGamesRendering) return;
    window._allGamesRendering = true;

    const grid = document.getElementById('allGamesGrid');
    if (!grid) { window._allGamesRendering = false; return; }

    try {
    // 1. Check platform link status for Epic and Steam.
    const status = await window.electronAPI.platformSyncStatus?.().catch(() => ({}));
    const isEpicLinked = status?.epic === true;
    const isSteamLinked = status?.steam === true;
    const isGogLinked = status?.gog === true;

    // 2. No accounts linked — show onboarding panel.
    if (!isEpicLinked && !isSteamLinked && !isGogLinked) {
        window._allGamesRendering = false;
        _agPublishAllGamesCount(0, 'account-sync');
        _agSetToolbarVisible(false);
        _agHideEpicBanner();
        _agSetEmptyPageMode(true);
        _agRenderEmptyOnboarding();
        _agRenderAccountFilterOptions([]);
        return;
    }

    // 3. At least one account linked — show toolbar and hide legacy banners.
    window._agNoLinkedAccounts = false;
    _agSetEmptyPageMode(false);
    _agSetToolbarVisible(true);
    _agHideEpicBanner();
    // Restore grid to normal card-layout mode. If a warm virtual grid is alive,
    // keep its phantom geometry; navigation visibility must not own layout teardown.
    _agResetAllGamesGridMode({ preserveVirtualGrid: _agShouldPreserveVirtualGrid() });

    // If the caller already installed a route skeleton, don't replace it with
    // another loading row — the skeleton is stable and avoids a double-flash.
    if (!options.suppressInitialLoading) {
        grid.innerHTML = options.stableLayout
            ? _agStableLibraryLoadingHTML()
            : `<div class="accounts-loading" style="padding:40px 0;"><div class="acc-spinner"></div><span>Loading library...</span></div>`;
    }

    try {
        const projection = await _agReadCachedAllGamesProjection();
        const _rawResolved = projection.rawResolved;
        _rawResolved.forEach(g => {
            if (g?.librarySource === 'synced-account') {
                g._agSource     = 'platform-sync';
                g.librarySource = 'synced-account';
            }
        });
        window._allGamesRawCache = _rawResolved;
        window._allGamesCache    = _agGetUserLibraryGames(_rawResolved);
        const readyGames = _agComputeReadyToInstallGamesFromCache();
        if (readyGames !== null) _agPublishReadyToInstallState(readyGames, 'cached-platform-projection');

        _agPruneCardCacheForItems(window._allGamesCache);
        const warmLimit = Number(window.__baddelAllGamesFirstPaintWarmLimit ?? 48);

        _agPublishAllGamesCount(window._allGamesCache.length, 'render-all-games');
        // Snapshot filters before account option rebuild may reset _agState.account.
        const _ravFilterSnap = options.preserveFilters ? _agSnapshotFilterState() : null;
        _agRenderAccountFilterOptions(window._allGamesCache);
        if (_ravFilterSnap) _agRestoreFilterState(_ravFilterSnap, { validateAccount: true });

        if (await _agMaybeRenderEmptyOnboarding('renderAllGamesView')) return;

        // RTI guard: canonical state not ready — block raw cache render to avoid stale count.
        if (window.agReadyOnly
            && typeof window.isCanonicalReadyToInstallReady === 'function'
            && !window.isCanonicalReadyToInstallReady()) {
            console.log('[ReadyCount] renderAllGamesView blocked raw RTI render; waiting canonical');
            _agRenderReadyToInstallLoading();
            return;
        }

        // When preserving filters, use _applyAgFilters so the existing platform/
        // sort/account/installedOnly state is applied rather than rendering raw cache.
        if (options.preserveFilters) {
            await _agWarmCachedCoversForGames(window._allGamesCache, { limit: warmLimit, reason: 'all-games-preserve-filters-before-first-paint' });
            await _agLoadExistingGridThumbnails(window._allGamesCache);
            _applyAgFilters({ resetScroll: false, reason: 'renderAllGamesView-preserve-filters' });
            _agStartCompleteLibraryCoverHydration(window._allGamesCache, 'all-games-preserve-filters-application-hydration');
            return;
        }

        // RTI canonical: render from canonical list rather than raw _allGamesCache.
        if (window.agReadyOnly
            && typeof window.getCanonicalReadyToInstallGames === 'function') {
            const readyGames = window.getCanonicalReadyToInstallGames();
            if (Array.isArray(readyGames)) {
                _agProjectReadyArtworkFromAllGames(readyGames);
                await _agWarmCachedCoversForGames(readyGames, { limit: warmLimit, reason: 'ready-to-install-before-first-paint' });
                await _agLoadExistingGridThumbnails(readyGames);
                _renderAllGamesViewModeAware(readyGames);
                _agStartCompleteLibraryCoverHydration(readyGames, 'ready-to-install-application-hydration');
                return;
            }
        }

        await _agWarmCachedCoversForGames(window._allGamesCache, { limit: warmLimit, reason: 'all-games-before-first-paint' });
        await _agLoadExistingGridThumbnails(window._allGamesCache);
        _renderAllGamesViewModeAware(window._allGamesCache);
        _agStartCompleteLibraryCoverHydration(window._allGamesCache, 'all-games-application-hydration');
    } catch (err) {
        grid.innerHTML = `<div style="color:#e74c3c; padding:24px;">Error loading library: ${err.message}</div>`;
    }

    } finally {
        window._allGamesRendering = false;
    }
};

// ── Filter state snapshot / restore ─────────────────────────────────────────
// These three helpers are used by the background library-updated handler so
// that a sync refresh never clobbers the user's active filters.

function _agSnapshotFilterState() {
    return {
        state: {
            platform: window._agState?.platform || 'all',
            sort:     window._agState?.sort     || 'title_asc',
            search:   window._agState?.search   || '',
            account:  window._agState?.account  || 'all',
        },
        agInstalledOnly:     !!window.agInstalledOnly,
        agReadyOnly:         !!window.agReadyOnly,
        searchInputValue:    document.getElementById('allGamesSearch')?.value || '',
        selectedAccountText: document.getElementById('selectedAgAccountText')?.innerText || 'All Accounts',
        scrollTop:           document.getElementById('mainContentArea')?.scrollTop || 0,
    };
}

// Sync the toolbar DOM to match the current window._agState / agInstalledOnly /
// agReadyOnly values.  Pure DOM write — does not call _applyAgFilters.
function _agSyncFilterUiFromState(snapshot) {
    const state     = window._agState || {};
    const sortLabels = { title_asc: 'A → Z', title_desc: 'Z → A', playtime_desc: 'Most Played', multi_first: 'Multi-Platform First' };

    // Platform pills
    document.querySelectorAll('.ag-pill').forEach(p => p.classList.remove('active'));
    const activePill = document.querySelector(`.ag-pill[data-platform="${state.platform || 'all'}"]`);
    if (activePill) activePill.classList.add('active');

    // Sort label + active item
    const sortLabelEl = document.getElementById('agSortLabel');
    if (sortLabelEl) sortLabelEl.textContent = sortLabels[state.sort] || 'A → Z';
    document.querySelectorAll('.ag-sort-item').forEach(i => {
        i.classList.toggle('active', i.dataset.value === (state.sort || 'title_asc'));
    });

    // Account dropdown label
    const accountTextEl = document.getElementById('selectedAgAccountText');
    if (accountTextEl) {
        if (state.account === 'all') {
            accountTextEl.innerText = 'All Accounts';
        } else if (snapshot?.selectedAccountText) {
            accountTextEl.innerText = snapshot.selectedAccountText;
        }
    }

    // Installed toggle button
    const installedBtn = document.getElementById('agInstalledToggle');
    if (installedBtn) installedBtn.classList.toggle('active', !!window.agInstalledOnly);

    // Body class used for RTI-mode styling
    document.body.classList.toggle('ag-ready-mode', !!window.agReadyOnly);
}

// Restore _agState + booleans from a snapshot, then sync the toolbar DOM.
// options.validateAccount: if true, verify the account still appears in the
// current account option map before restoring (falls back to 'all' if gone).
function _agRestoreFilterState(snapshot, options = {}) {
    if (!snapshot) return;
    if (!window._agState) {
        window._agState = { platform: 'all', sort: 'title_asc', search: '', account: 'all' };
    }

    window._agState.platform = snapshot.state.platform;
    window._agState.sort     = snapshot.state.sort;
    window._agState.search   = snapshot.state.search;
    window.agInstalledOnly   = snapshot.agInstalledOnly;
    window.agReadyOnly       = snapshot.agReadyOnly;

    // Validate account: only restore if the key still appears in the option menu.
    if (options.validateAccount) {
        const menu = document.getElementById('agAccountMenu');
        const accountKeys = menu
            ? Array.from(menu.querySelectorAll('.dropdown-item'))
                .map(el => {
                    const m = el.getAttribute('onclick')?.match(/setAgAccountFilter\('([^']+)'/);
                    return m ? m[1] : null;
                })
                .filter(Boolean)
            : [];
        const accountStillExists = snapshot.state.account === 'all'
            || accountKeys.includes(snapshot.state.account);
        window._agState.account = accountStillExists ? snapshot.state.account : 'all';
        if (!accountStillExists) {
            console.log(`[AGFILTER] account '${snapshot.state.account}' no longer available — reset to All Accounts`);
        }
    } else {
        window._agState.account = snapshot.state.account;
    }

    // Restore search input value
    const searchEl = document.getElementById('allGamesSearch');
    if (searchEl) searchEl.value = snapshot.searchInputValue || snapshot.state.search || '';
    if (typeof window._agUpdateSearchClear === 'function') window._agUpdateSearchClear();

    _agSyncFilterUiFromState(snapshot);
}

// ── Refresh grid when library updates from main process ────────
function _agStartSyncCommitRendererTrace(payload = {}) {
    const trace = { syncRunId: payload?.syncRunId || null, platform: payload?.platform || null, receivedAt: Date.now(), activeView: typeof currentView !== "undefined" ? currentView : null, completion: { coverCachedEventsReceived: 0 }, renderer: { stages: [], frameGaps: [], longTasks: [] } };
    const start = performance.now();
    window.__agActiveSyncCommitTrace = trace;
    let lastFrame = start;
    let rafId = null;
    let stopped = false;
    const tick = (now) => {
        if (stopped) return;
        trace.renderer.frameGaps.push(now - lastFrame);
        lastFrame = now;
        if (now - start < 5000) rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    let observer = null;
    try {
        observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) trace.renderer.longTasks.push({ startTime: entry.startTime, duration: entry.duration, name: entry.name });
        });
        observer.observe({ entryTypes: ["longtask"] });
    } catch {}
    setTimeout(() => {
        stopped = true;
        if (rafId) cancelAnimationFrame(rafId);
        try { observer?.disconnect?.(); } catch {}
        trace.completedAt = Date.now();
        trace.activeViewAtCompletion = typeof currentView !== "undefined" ? currentView : null;
        trace.renderer.maxFrameGapMs = trace.renderer.frameGaps.reduce((max, value) => Math.max(max, value || 0), 0);
        trace.renderer.longTasksOver50ms = trace.renderer.longTasks.filter((task) => Number(task.duration || 0) > 50).length;
        if (window.__agActiveSyncCommitTrace === trace) window.__agActiveSyncCommitTrace = null;
        console.log("BADDEL_SYNC_COMMIT_RENDERER_TRACE", JSON.stringify(trace));
    }, 5100);
    return trace;
}

function _agRendererTraceStage(trace, name, startedAt, extra = {}) {
    if (!trace) return;
    trace.renderer.stages.push({ name, durationMs: performance.now() - startedAt, ...extra });
}

function _agSchedulePostCommitHydration(reason = "platform-library-committed-idle") {
    if (window.__agPostCommitHydrationTimer) return;
    const run = async () => {
        window.__agPostCommitHydrationTimer = null;
        try { await _agHydrateCachedCoversIntoAllGames(); }
        catch (err) { console.warn("[AllGames] Deferred post-commit hydration failed:", err?.message || err); }
    };
    if (typeof requestIdleCallback !== "undefined") window.__agPostCommitHydrationTimer = requestIdleCallback(() => { run(); }, { timeout: 1500 });
    else window.__agPostCommitHydrationTimer = setTimeout(run, 250);
}

function _agScheduleDeferredSyncProjection(payload = {}, trace = null) {
    if (window.__agDeferredSyncProjectionTimer) return;
    const run = async () => {
        window.__agDeferredSyncProjectionTimer = null;
        const started = performance.now();
        try {
            const projection = await _agReadCachedAllGamesProjection({ platformSnapshots: [payload].filter(item => item?.platform) });
            _agRendererTraceStage(trace, "background.projection", started, { count: projection?.count || 0 });
            if (!_agCanCommitProjection(projection, "platform-library-committed-background")) return;
            _agCommitAllGamesProjection(projection, "platform-library-committed-background");
        } catch (err) { console.warn("[AllGames] Deferred sync projection failed:", err?.message || err); }
    };
    if (typeof requestIdleCallback !== "undefined") window.__agDeferredSyncProjectionTimer = requestIdleCallback(() => { run(); }, { timeout: 2000 });
    else window.__agDeferredSyncProjectionTimer = setTimeout(run, 300);
}

function _agRenderEpicEnrichmentIndicator(states = window.__epicProgressiveStates || {}) {
    const indicator = document.getElementById('epicEnrichmentIndicator');
    if (!indicator) return;
    const values = Object.values(states || {});
    const active = values.filter((state) => state?.overallStatus === 'library_ready_enriching');
    const partial = values.filter((state) => state?.overallStatus === 'partial');
    if (active.length) {
        const prices = active.some((state) => ['pending', 'running'].includes(state?.phases?.prices?.status));
        const history = active.some((state) => ['pending', 'running', 'waiting_for_auth'].includes(state?.phases?.purchaseHistory?.status));
        const detail = prices && history ? 'prices and history' : (prices ? 'prices' : 'history');
        indicator.textContent = `Epic library ready · Updating ${detail}`;
        indicator.className = 'epic-enrichment-indicator is-active';
    } else if (partial.length) {
        indicator.textContent = 'Epic library ready · Some details need attention';
        indicator.className = 'epic-enrichment-indicator is-warning';
    } else {
        indicator.textContent = '';
        indicator.className = 'epic-enrichment-indicator';
    }
}

if (window.electronAPI?.onEpicSyncProgress && !window.__agEpicProgressListenerAttached) {
    window.__agEpicProgressListenerAttached = true;
    window.__epicProgressiveStates = window.__epicProgressiveStates || {};
    window.electronAPI.onEpicSyncProgress((payload = {}) => {
        const accountId = String(payload.accountId || '');
        const existing = window.__epicProgressiveStates[accountId];
        const incomingRevision = Number(payload.libraryRevision ?? payload.state?.revision ?? 0);
        const existingRevision = Number(existing?.revision || 0);
        if (incomingRevision < existingRevision) return;
        if (incomingRevision === existingRevision && existing?.syncRunId && payload.syncRunId && String(existing.syncRunId) !== String(payload.syncRunId)) return;
        if (payload.cancelled) delete window.__epicProgressiveStates[accountId];
        else if (payload.state) window.__epicProgressiveStates[accountId] = payload.state;
        _agRenderEpicEnrichmentIndicator();
    });
    window.electronAPI.platformSyncGetEpicProgressState?.().then((result) => {
        window.__epicProgressiveStates = result?.state || {};
        _agRenderEpicEnrichmentIndicator();
    }).catch?.(() => {});
}

// Guard: register only once — navigating back and forth would stack listeners
// and trigger multiple concurrent re-renders per event.
const _agSubscribePlatformLibraryCommitted = window.electronAPI.onPlatformLibraryCommitted || window.electronAPI.onLibraryUpdated;
if (_agSubscribePlatformLibraryCommitted && !window._allGamesLibraryListenerAttached) {
    window._allGamesLibraryListenerAttached = true;
    _agSubscribePlatformLibraryCommitted(async (payload = {}) => {
        const __syncTrace = _agStartSyncCommitRendererTrace(payload);
        const __eventStart = performance.now();
        _agScrollDiagnosticCount('events.libraryUpdated');
        _agRendererTraceStage(__syncTrace, "event.received", __eventStart, { activeView: typeof currentView !== "undefined" ? currentView : null });
        const _agRefreshGeneration = ++window.__agAllGamesSnapshotGeneration;
        // All Games / Ready to Install virtualized updates own their own semantic
        // scroll anchor. Do not wrap this flow in raw scrollTop preservation; that
        // can defeat anchor restoration when sync inserts/removes items above view.
        const view = document.getElementById('allGamesView');
            const viewVisible = view && view.style.display === 'block';

            // Always rebuild cache so canonical ready state stays current,
            // regardless of which view is open.
            try {
                if (window._agNoLinkedAccounts) {
                    if (viewVisible) await renderAllGamesView({ preserveFilters: true, reason: 'sync-complete-no-accounts' });
                    return;
                }
                const status = await window.electronAPI.platformSyncStatus?.().catch(() => ({}));
                const isEpicLinked = status?.epic === true;
                const isSteamLinked = status?.steam === true;

                if (!isEpicLinked && !isSteamLinked) {
                    _agMarkReadyToInstallNotReady('no-linked-accounts');
                    _agPublishAllGamesCount(0, 'account-sync');
                    return;
                }

                console.log('[AllGames] Library updated — refreshing cache' + (viewVisible ? ' and view' : ' (background)'));

                if (!viewVisible) {
                    _agRendererTraceStage(__syncTrace, "background.deferred", performance.now(), { reason: "view-not-visible" });
                    _agScheduleDeferredSyncProjection(payload, __syncTrace);
                    return;
                }

                const __projectionStart = performance.now();
                const projection = await _agReadCachedAllGamesProjection({ platformSnapshots: [payload].filter(item => item?.platform) });
                _agRendererTraceStage(__syncTrace, "projection.read-and-merge", __projectionStart, { count: projection?.count || 0 });
                if (_agRefreshGeneration !== window.__agAllGamesSnapshotGeneration) return;
                if (!_agCanCommitProjection(projection, 'platform-library-committed')) return;
                let newCache = projection.rawResolved;
                const __overrideStart = performance.now();
                newCache = _agDedupeDelegatedLaunchProducts(await _agApplyInstalledCreatorOverrides(newCache));
                _agRendererTraceStage(__syncTrace, "projection.installed-overrides", __overrideStart, { count: newCache.length });
                newCache.forEach(g => {
                    if (g?.librarySource === 'synced-account') {
                        g._agSource     = 'platform-sync';
                        g.librarySource = 'synced-account';
                    }
                });
                const oldById = new Map((window._allGamesCache || []).map(g => [String(g.id ?? g.appName ?? g.title), g]));
                newCache.forEach(g => {
                    const key = String(g.id ?? g.appName ?? g.title);
                    const old = oldById.get(key);
                    if (old?.coverUrl)             g.coverUrl             = old.coverUrl;
                    if (old?.heroUrl)              g.heroUrl              = old.heroUrl;
                    if (old?.logoUrl)              g.logoUrl              = old.logoUrl;
                    if (old?._agCoverPipelineDone) g._agCoverPipelineDone = old._agCoverPipelineDone;
                    if (old?._agHeroLogoDone)      g._agHeroLogoDone      = old._agHeroLogoDone;
                });

                _agCommitAllGamesProjection({
                    ...projection,
                    rawResolved: newCache,
                    libraryGames: _agGetUserLibraryGames(newCache),
                    count: _agGetUserLibraryGames(newCache).length,
                }, 'platform-library-committed');

                // DOM updates only when the all-games view is visible.
                if (!viewVisible) return;

                // Capture filter state before any cache/DOM mutations. Rebuilding
                // the account option list can silently reset _agState.account when
                // account keys arrive in a slightly different order from sync, which
                // leaves the toolbar visually correct but the pool unfiltered.
                const filterSnapshot = _agSnapshotFilterState();
                if (window.baddel_debug_vs) {
                    console.log('[AGFILTER] snapshot before sync-refresh', JSON.stringify(filterSnapshot.state),
                        'installedOnly=' + filterSnapshot.agInstalledOnly,
                        'readyOnly=' + filterSnapshot.agReadyOnly);
                }

                _agRestoreFilterState(filterSnapshot, { validateAccount: true });

                // Compute the new visible pool BEFORE any DOM mutations so we know
                // whether a re-render is actually needed. Clearing grid styles
                // (position/display/height) when the pool is unchanged would orphan
                // the virtual scroller's position:absolute row wrappers.
                const _bgUseCanonical = window.agReadyOnly
                    && typeof window.getCanonicalReadyToInstallGames === 'function'
                    && window.isCanonicalReadyToInstallReady?.() === true;
                const _bgBase = (_bgUseCanonical && typeof window.getCanonicalReadyToInstallGames === 'function')
                    ? window.getCanonicalReadyToInstallGames()
                    : _agGetUserLibraryGames(window._allGamesCache || []);
                const _bgPool = _agBuildFilteredPool({ cache: _bgBase, useCanonical: _bgUseCanonical });
                const _bgSig  = _agComputePoolSignature(_bgPool);
                const _bgPoolUnchanged = !!window._agLastRenderedPoolSignature
                    && _bgSig === window._agLastRenderedPoolSignature;

                if (_bgPoolUnchanged) {
                    // Visible pool is identical — skip all DOM resets. Only patch
                    // covers and update non-layout UI so row wrappers stay anchored.
                    _agSchedulePostCommitHydration("platform-library-committed-unchanged");
                    _agPublishAllGamesCount(window._allGamesCache.length, 'platform-library-committed');
                    _agRenderAccountFilterOptions(window._allGamesCache);
                    // Restore filter state — _agRenderAccountFilterOptions may have
                    // silently reset _agState.account if account keys changed during sync.
                    _agRestoreFilterState(filterSnapshot, { validateAccount: true });
                    _agEnsureVirtualGridIntegrity('background-skip');
                    return;
                }

                // Pool changed — safe to reset DOM and run a full re-render.
                if (window._allGamesCache.length > 0) {
                    window._agNoLinkedAccounts = false;
                    _agSetEmptyPageMode(false);
                    _agSetToolbarVisible(true);
                    _agEnsureVirtualGridIntegrity('background-pool-changed-before-render');
                }

                _agPublishAllGamesCount(window._allGamesCache.length, 'platform-library-committed');

                _agRenderAccountFilterOptions(window._allGamesCache);

                // Restore filters after account option rebuild — must happen before
                // _applyAgFilters so the correct pool is built on the first pass.
                _agRestoreFilterState(filterSnapshot, { validateAccount: true });

                if (window.baddel_debug_vs) {
                    console.log('[AGFILTER] restored before apply', JSON.stringify({
                        platform: window._agState?.platform,
                        sort:     window._agState?.sort,
                        account:  window._agState?.account,
                        installedOnly: window.agInstalledOnly,
                    }));
                }

                const __renderStart = performance.now();
                const _rendered = _applyAgFilters({ resetScroll: false, reason: 'background-library-updated-preserve-filters' });
                _agRendererTraceStage(__syncTrace, "render.apply-filters", __renderStart, { rendered: _rendered !== false });
                _agSchedulePostCommitHydration("platform-library-committed-after-render");

                if (window.baddel_debug_vs) {
                    const _dbgPool = _agBuildFilteredPool({ cache: _agGetUserLibraryGames(window._allGamesCache || []), useCanonical: false });
                    console.log('[AGFILTER] apply result count=' + _dbgPool.length + ' rendered=' + (_rendered !== false));
                }
        } catch (err) {
            console.warn('[AllGames] Silent refresh failed:', err.message);
        }
    });
}

// ── Per-cover instant patch ───────────────────────────────────────────────────
// Receives platformSync's `all-games-cover-cached` event and patches All Games
// without doing a full library refresh or resetting scroll.

function _agNormKey(value) {
    return String(value || '').trim();
}

function _agNormTitleKey(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

function _agCoverPayloadKeys(payload = {}) {
    return new Set(
        [
            payload.id,
            payload.appid,
            payload.appId,
            payload.appName,
            payload.namespace,
            payload.title,
            _agNormTitleKey(payload.title),
        ]
            .filter(Boolean)
            .map(_agNormKey)
    );
}

function _agGameCoverKeys(game = {}) {
    return new Set(
        [
            game.id,
            game.appid,
            game.appId,
            game.appName,
            game.namespace,
            game.allIds?.steam,
            game.allIds?.epic,
            game.title,
            game.name,
            _agNormTitleKey(game.title || game.name || game.appName),
        ]
            .filter(Boolean)
            .map(_agNormKey)
    );
}

function _agMatchesCoverPayload(game, payload) {
    if (!game || !payload) return false;

    const payloadKeys = _agCoverPayloadKeys(payload);
    const gameKeys = _agGameCoverKeys(game);

    for (const key of payloadKeys) {
        if (gameKeys.has(key)) return true;
    }

    return false;
}

function _agApplyCoverToGame(game, cover) {
    if (!game || !cover) return false;
    _agInvalidateLocalCoverResolution('cover-cached-event');
    const nextCover = String(cover || '');
    if (!nextCover) return false;
    const currentCreatorCover = game.coverUrl || game.image || game.defaultImage;
    if (_agIsCreatorArtworkGame(game) && _agIsUsableCardCover(currentCreatorCover, game)) {
        _agSetArtworkReady(game, currentCreatorCover, 'creator');
        return false;
    }
    if (_agIsManagedArtworkCacheUrl(nextCover)) window.__agVerifiedArtworkUrls.add(nextCover);
    return _agSetArtworkReady(game, nextCover, 'cover-cached-event');
}


function _agPatchCardCover(card, cover) {
    if (!card || !cover) return 0;

    let patched = 0;
    const nextCover = String(cover || '');

    const imgs = card.querySelectorAll?.('img, .native-lazy-load') || [];
    imgs.forEach((img) => {
        const currentSrc = img.getAttribute('src') || '';

        if (currentSrc !== nextCover || img.style.display === 'none') {
            img.onerror = null;
            img.src = nextCover;
            img.dataset.src = nextCover;
            img.style.display = '';
            img.classList.add('loaded');
            img.classList.remove('loading', 'skeleton');
            patched++;
        }
    });

    const bgTargets = card.querySelectorAll?.(
        '.poster, .cover, .game-cover, .ag-cover, .card-poster, .agc-cover, .agc-poster'
    ) || [];

    bgTargets.forEach((el) => {
        el.style.backgroundImage = `url("${nextCover}")`;
        el.classList.remove('loading', 'skeleton');
        patched++;
    });

    card.classList.remove('loading', 'skeleton', 'is-loading');
    card.querySelector?.('.game-card-img-wrap')?.classList.add('cover-ready');
    card.dataset.coverUrl = nextCover;

    return patched;
}

function _agPatchVisibleCoverDom(payload, cover) {
    if (!payload || !cover) return 0;

    let patched = 0;
    const payloadKeys = _agCoverPayloadKeys(payload);

    const selectors = [
        '[data-game-id]',
        '[data-id]',
        '.game-card',
        '.ag-game-card',
        '.agc-card',
    ].join(',');

    document.querySelectorAll(selectors).forEach((card) => {
        const fakeGame = card._vsBoundGame || {
            id: card.dataset.gameId || card.dataset.id,
            appid: card.dataset.appid,
            appId: card.dataset.appId,
            appName: card.dataset.appName,
            namespace: card.dataset.namespace,
            title: card.dataset.gameTitle || card.dataset.title || card.dataset.titleKey,
        };

        const cardKeys = _agGameCoverKeys(fakeGame);
        let matched = false;

        for (const key of payloadKeys) {
            if (cardKeys.has(key)) {
                matched = true;
                break;
            }
        }

        if (!matched) return;

        patched += _agPatchCardCover(card, cover);
    });

    return patched;
}

if (window.electronAPI?.onAllGamesCoverCached) {
    if (!window.__BADDEL_ALL_GAMES_COVER_CACHED_LISTENER__) {
        window.__BADDEL_ALL_GAMES_COVER_CACHED_LISTENER__ = true;

        window.electronAPI.onAllGamesCoverCached((payload) => {
            if (!payload) return;

            const newCover = payload.coverUrl || payload.image || payload.defaultImage;
            if (!newCover) return;

            let patchedCache = 0;
            let patchedItems = 0;
            let cachedCardPatched = 0;

            // 1) Patch master All Games cache.
            if (Array.isArray(window._allGamesCache)) {
                window._allGamesCache.forEach((game) => {
                    if (_agMatchesCoverPayload(game, payload)) {
                        if (_agApplyCoverToGame(game, newCover)) patchedCache++;
                    }
                });
            }

            // 2) Patch virtual scroller active items.
            if (Array.isArray(window._vs?.items)) {
                window._vs.items.forEach((game) => {
                    if (_agMatchesCoverPayload(game, payload)) {
                        if (_agApplyCoverToGame(game, newCover)) patchedItems++;
                    }
                });
            }

            // 3) Patch cardCache cards that might not currently be mounted in DOM.
            if (window._vs?.visibleCardsByGameId instanceof Map) {
                for (const [key, card] of window._vs.visibleCardsByGameId.entries()) {
                    const fakeGame = card._vsBoundGame || {
                        id: card.dataset.gameId || card.dataset.id || key,
                        appid: card.dataset.appid,
                        appId: card.dataset.appId,
                        appName: card.dataset.appName,
                        namespace: card.dataset.namespace,
                        title: card.dataset.gameTitle || card.dataset.title || card.dataset.titleKey,
                    };

                    if (!_agMatchesCoverPayload(fakeGame, payload)) continue;

                    cachedCardPatched += _agPatchCardCover(card, newCover);
                }
            }

            // 4) Patch currently visible DOM cards.
            const domPatched = _agPatchVisibleCoverDom(payload, newCover);

            console.log(
                `[AllGamesUI] cover event patched cache=${patchedCache}, items=${patchedItems}, cachedCards=${cachedCardPatched}, dom=${domPatched}`,
                payload.title || payload.id || payload.appid || payload.namespace
            );

            // Do NOT full refresh and do NOT reset scroll.
            // Only repaint visible rows if the event matched data but no DOM/card was touched.
            if (
                (patchedCache || patchedItems) &&
                (domPatched + cachedCardPatched) === 0 &&
                typeof window._vsRender === 'function'
            ) {
                window._vsRender(false);
            }
        });
    }
}
// ============================================================
// VIRTUAL SCROLLER — All Games Grid
// Renders only the cards visible in the viewport + a buffer.
// Works with CSS auto-fill columns and aspect-ratio cards.
// Handles 5000+ games with zero lag.
// ============================================================

const PLAT_BADGE_META = {
    steam:   { color: '#66c0f4', icon: '../assets/Steam.png',   invert: false, label: 'Steam'   },
    epic:    { color: '#ffffff', icon: '../assets/epic.svg',    invert: true,  label: 'Epic'    },
    gog:     { color: '#a970ff', icon: '../assets/gog.png',     invert: false, label: 'GOG'     },
    ea:      { color: '#ff6b35', icon: '../assets/ea.png',      invert: false, label: 'EA'      },
    riot:    { color: '#ff4655', icon: '../assets/riot.png',    invert: false, label: 'Riot'    },
    ubisoft: { color: '#00a8ff', icon: '../assets/ubisoft.png', invert: false, label: 'Ubisoft' },
};

// Virtual scroll state
const _vs = {
    items: [],          // current filtered+sorted dataset
    cols: 0,            // columns count (measured at runtime)
    rowH: 0,            // row height in px (measured at runtime)
    gap: 20,            // gap between cards (must match CSS gap)
    renderedStart: -1,  // first rendered row index
    renderedEnd: -1,    // last rendered row index
    totalHeight: 0,     // current phantom grid height owned by the virtual scroller
    dataRevision: 0,    // increments when the rendered item projection changes
    lifecycle: 'uninitialized', // uninitialized | warm | invalidated
    raf: null,          // pending requestAnimationFrame handle
    scroller: null,     // the scrollable element
    sentinel: null,     // top spacer div
    cardPool: new Map(), // rowIndex -> rowEl DOM node
    rowBindings: new Map(), // rowIndex -> game keys currently bound into that row
    freeCards: [], // detached recyclable card DOM nodes
    cardCache: new Map(), // visible gameId -> currently mounted card DOM node
    visibleCardsByGameId: new Map(), // patch-only lookup for mounted cards
    retainedCards: new Map(), // gameId -> detached card, bounded by decoded-image bytes
    retainedCardBytes: 0,
    retainedCardBudgetBytes: 96 * 1024 * 1024,
    retainedCardLimit: 512,
    retainedCardStats: { hits: 0, misses: 0, evictions: 0, peakBytes: 0 },
    _coverQueued: new Set(), // gameIds queued or in-flight for cover fetch
    // ── Scroll-speed / settle tracking ──────────────────────────────────────
    _gridTop: 0,         // cached grid offsetTop relative to scroller — avoid rAF layout reads
    _gridTopDirty: true, // re-measure gridTop on next render if true
    _lastScrollTop: 0,   // last known scrollTop — used to detect fast scroll
    _scrollSpeed: 0,     // exponentially-smoothed scroll speed (px/frame)
    _scrollSettleTimer: null, // timer to run background cover work after scroll settles
    _isScrolling: false, // true while scroll events are actively arriving
    _isFastScrolling: false, // hysteresis-controlled fast-scroll mode
    _lastFrameTs: 0,
};
window._vs = _vs;

const AG_VS_FAST_BUFFER_ROWS = 2;
const AG_VS_NORMAL_BUFFER_ROWS = 4;
const AG_VS_FAST_ENTER_PX = 70;
const AG_VS_FAST_LEAVE_PX = 20;
const AG_VS_SCROLL_SETTLE_MS = 170;

function _agScrollPerfEnabled() {
    try { return typeof localStorage !== 'undefined' && localStorage.getItem('baddel_debug_scroll_perf') === '1'; } catch { return false; }
}

function _agSetActiveScrollState(active) {
    const nextActive = active === true;
    if (window.__agGridArtworkScrollActive !== nextActive) {
        window.__agGridArtworkScrollActive = nextActive;
        window.electronAPI?.setGridArtworkScrollActive?.(nextActive);
        if (!nextActive) _agFlushPendingGridThumbnailMappings();
    }
    const grid = document.getElementById('allGamesGrid');
    const view = document.getElementById('allGamesView');
    grid?.classList?.toggle('ag-is-scrolling', !!active);
    view?.classList?.toggle('ag-is-scrolling', !!active);
}

function _agLogScrollPerf(data = {}) {
    if (!_agScrollPerfEnabled()) return;
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const frameDelta = _vs._lastFrameTs ? now - _vs._lastFrameTs : 0;
    _vs._lastFrameTs = now;
    const droppedFrames = frameDelta > 20 ? Math.max(0, Math.round(frameDelta / 16.67) - 1) : 0;
    console.debug('[AG_SCROLL_PERF]', { frameDelta: Math.round(frameDelta * 10) / 10, droppedFrames, ...data });
}


function _agScrollDiagnosticActive() {
    return window.__agScrollDiagnosticActive || null;
}

function _agScrollDiagnosticCount(field, amount = 1) {
    const diag = _agScrollDiagnosticActive();
    if (!diag) return;
    diag.counters[field] = Number(diag.counters[field] || 0) + amount;
}

function _agScrollDiagnosticPush(field, value) {
    const diag = _agScrollDiagnosticActive();
    if (!diag) return;
    if (!Array.isArray(diag.samples[field])) diag.samples[field] = [];
    diag.samples[field].push(value);
}

function _agScrollDiagnosticSnapshot(label) {
    const diag = _agScrollDiagnosticActive();
    if (!diag) return;
    const grid = document.getElementById('allGamesGrid');
    const scroller = window._vs?.scroller || document.getElementById('mainContentArea');
    const registry = window.__agArtworkRegistry instanceof Map ? window.__agArtworkRegistry : new Map();
    const nodeCount = document.getElementsByTagName('*').length;
    const mountedCardCount = grid?.querySelectorAll?.('.game-card')?.length || 0;
    const rowCount = window._vs?.cardPool instanceof Map ? window._vs.cardPool.size : 0;
    const heap = performance?.memory ? {
        usedJSHeapSize: performance.memory.usedJSHeapSize,
        totalJSHeapSize: performance.memory.totalJSHeapSize,
        jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
    } : null;
    diag.snapshots.push({
        label,
        atMs: Math.round(performance.now() - diag.startedAt),
        nodeCount,
        mountedCardCount,
        rowCount,
        cardCacheSize: window._vs?.cardCache instanceof Map ? window._vs.cardCache.size : 0,
        artworkRegistrySize: registry.size,
        readyArtworkCount: [...registry.values()].filter(r => r?.status === 'ready' && r.localUrl).length,
        scrollTop: scroller?.scrollTop || 0,
        scrollHeight: scroller?.scrollHeight || 0,
        clientHeight: scroller?.clientHeight || 0,
        renderedStart: window._vs?.renderedStart ?? null,
        renderedEnd: window._vs?.renderedEnd ?? null,
        cols: window._vs?.cols || 0,
        rowH: window._vs?.rowH || 0,
        heap,
    });
    diag.max.mountedCards = Math.max(diag.max.mountedCards, mountedCardCount);
    diag.max.domNodes = Math.max(diag.max.domNodes, nodeCount);
}

function _agScrollDiagnosticPercentile(values, percentile) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1));
    return sorted[idx];
}

function _agScrollDiagnosticSummarizeDurations(values) {
    const list = values.filter(v => Number.isFinite(v));
    if (!list.length) return { count: 0, average: 0, p50: 0, p95: 0, p99: 0, max: 0 };
    const sum = list.reduce((acc, v) => acc + v, 0);
    return {
        count: list.length,
        average: Math.round((sum / list.length) * 100) / 100,
        p50: Math.round(_agScrollDiagnosticPercentile(list, 50) * 100) / 100,
        p95: Math.round(_agScrollDiagnosticPercentile(list, 95) * 100) / 100,
        p99: Math.round(_agScrollDiagnosticPercentile(list, 99) * 100) / 100,
        max: Math.round(Math.max(...list) * 100) / 100,
    };
}

function _agScrollDiagnosticInstalledBuildKind() {
    try {
        const ua = navigator.userAgent || '';
        return {
            userAgent: ua,
            electron: /Electron\/(\d+\.\d+\.\d+)/.exec(ua)?.[1] || null,
            protocol: location.protocol,
            href: location.href,
            devLikely: location.protocol !== 'app:' && !/app\.asar/i.test(location.href),
        };
    } catch {
        return { userAgent: '', electron: null, protocol: '', href: '', devLikely: null };
    }
}

function _agScrollDiagnosticInstallHooks(diag) {
    const cleanups = [];
    const patchMethod = (owner, name, wrapper) => {
        if (!owner || typeof owner[name] !== 'function') return;
        const original = owner[name];
        owner[name] = wrapper(original);
        cleanups.push(() => { owner[name] = original; });
    };

    ['getMetadata', 'cacheImage', 'getCachedImage', 'getCachedImagesBulk', 'cacheAllAssets', 'getArtworkDownloadStats'].forEach((name) => {
        patchMethod(window.electronAPI, name, (original) => function (...args) {
            _agScrollDiagnosticCount(`ipc.${name}`);
            if (name === 'cacheImage' || name === 'cacheAllAssets') _agScrollDiagnosticCount('artwork.networkOrCacheRequest');
            if (name === 'getMetadata') _agScrollDiagnosticCount('artwork.metadataRequests');
            if (name === 'getCachedImage' || name === 'getCachedImagesBulk') _agScrollDiagnosticCount('artwork.cacheLookups');
            return original.apply(this, args);
        });
    });

    const imgProto = window.HTMLImageElement?.prototype;
    const srcDescriptor = imgProto ? Object.getOwnPropertyDescriptor(imgProto, 'src') : null;
    if (imgProto && srcDescriptor?.set && srcDescriptor?.get) {
        Object.defineProperty(imgProto, 'src', {
            configurable: true,
            enumerable: srcDescriptor.enumerable,
            get: function () { return srcDescriptor.get.call(this); },
            set: function (value) {
                const text = String(value || '');
                _agScrollDiagnosticCount('artwork.imgSrcAssignments');
                if (text.startsWith('file://')) _agScrollDiagnosticCount('artwork.localFileAssignments');
                else if (/^https?:\/\//i.test(text)) _agScrollDiagnosticCount('artwork.remoteImgAssignments');
                return srcDescriptor.set.call(this, value);
            },
        });
        cleanups.push(() => Object.defineProperty(imgProto, 'src', srcDescriptor));
    }

    patchMethod(imgProto, 'decode', (original) => function (...args) {
        _agScrollDiagnosticCount('artwork.decodeCalls');
        const started = performance.now();
        try {
            const result = original.apply(this, args);
            if (result && typeof result.then === 'function') {
                return result.then((value) => {
                    _agScrollDiagnosticCount('artwork.decodeCompletions');
                    _agScrollDiagnosticPush('decodeDurations', performance.now() - started);
                    return value;
                }, (err) => {
                    _agScrollDiagnosticCount('artwork.decodeFailures');
                    _agScrollDiagnosticPush('decodeDurations', performance.now() - started);
                    throw err;
                });
            }
            _agScrollDiagnosticCount('artwork.decodeCompletions');
            return result;
        } catch (err) {
            _agScrollDiagnosticCount('artwork.decodeFailures');
            throw err;
        }
    });

    const elementProto = window.Element?.prototype;
    patchMethod(elementProto, 'getBoundingClientRect', (original) => function (...args) {
        _agScrollDiagnosticCount('layout.getBoundingClientRectCalls');
        return original.apply(this, args);
    });

    const nodeProto = window.Node?.prototype;
    patchMethod(nodeProto, 'appendChild', (original) => function (child) {
        _agScrollDiagnosticCount('dom.appendChildCalls');
        return original.call(this, child);
    });
    patchMethod(nodeProto, 'removeChild', (original) => function (child) {
        _agScrollDiagnosticCount('dom.removeChildCalls');
        return original.call(this, child);
    });

    if (typeof MutationObserver !== 'undefined') {
        const grid = document.getElementById('allGamesGrid');
        const observer = new MutationObserver((mutations) => {
            _agScrollDiagnosticCount('dom.mutationObserverCallbacks');
            _agScrollDiagnosticCount('dom.mutationRecords', mutations.length);
            for (const m of mutations) {
                _agScrollDiagnosticCount('dom.addedNodes', m.addedNodes?.length || 0);
                _agScrollDiagnosticCount('dom.removedNodes', m.removedNodes?.length || 0);
            }
        });
        if (grid) {
            observer.observe(grid, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'class', 'style', 'data-src'] });
            cleanups.push(() => observer.disconnect());
        }
    }

    if (typeof ResizeObserver !== 'undefined') {
        const grid = document.getElementById('allGamesGrid');
        const ro = new ResizeObserver((entries) => {
            _agScrollDiagnosticCount('layout.resizeObserverCallbacks');
            _agScrollDiagnosticCount('layout.resizeObserverEntries', entries.length);
        });
        if (grid) {
            ro.observe(grid);
            cleanups.push(() => ro.disconnect());
        }
    }

    if (typeof PerformanceObserver !== 'undefined') {
        try {
            const longTaskObserver = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    _agScrollDiagnosticCount('frame.longTasks');
                    _agScrollDiagnosticPush('longTaskDurations', entry.duration || 0);
                }
            });
            longTaskObserver.observe({ entryTypes: ['longtask'] });
            cleanups.push(() => longTaskObserver.disconnect());
        } catch {}
        try {
            const shiftObserver = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    if (entry.hadRecentInput) continue;
                    _agScrollDiagnosticCount('layout.layoutShifts');
                    _agScrollDiagnosticPush('layoutShiftValues', entry.value || 0);
                }
            });
            shiftObserver.observe({ type: 'layout-shift', buffered: true });
            cleanups.push(() => shiftObserver.disconnect());
        } catch {}
    }

    return () => cleanups.reverse().forEach(fn => { try { fn(); } catch {} });
}

function _agScrollDiagnosticApplyScenario(scenario) {
    const grid = document.getElementById('allGamesGrid');
    const view = document.getElementById('allGamesView');
    const style = document.createElement('style');
    style.id = 'ag-scroll-diagnostic-style';
    if (scenario === 'A') {
        style.textContent = `
            #allGamesView.ag-scroll-diag-placeholder .native-lazy-load { display:none !important; }
            #allGamesView.ag-scroll-diag-placeholder .agc-placeholder { display:flex !important; }
            #allGamesView.ag-scroll-diag-placeholder .agc-badges-strip,
            #allGamesView.ag-scroll-diag-placeholder .agc-top-gradient { display:none !important; }
            #allGamesView.ag-scroll-diag-placeholder .agc-card { box-shadow:none !important; transform:none !important; filter:none !important; }
        `;
        view?.classList?.add('ag-scroll-diag-placeholder');
    } else if (scenario === 'B') {
        style.textContent = `
            #allGamesView.ag-scroll-diag-cached-basic .agc-badges-strip,
            #allGamesView.ag-scroll-diag-cached-basic .agc-top-gradient { display:none !important; }
            #allGamesView.ag-scroll-diag-cached-basic .agc-card { box-shadow:none !important; transform:none !important; filter:none !important; }
        `;
        view?.classList?.add('ag-scroll-diag-cached-basic');
    }
    if (style.textContent) document.head.appendChild(style);
    if (grid) grid.dataset.scrollDiagnosticScenario = scenario;
    return () => {
        style.remove();
        view?.classList?.remove('ag-scroll-diag-placeholder', 'ag-scroll-diag-cached-basic');
        if (grid) delete grid.dataset.scrollDiagnosticScenario;
    };
}

async function _agRunSingleScrollDiagnosticScenario(scenario, options = {}) {
    const scroller = window._vs?.scroller || document.getElementById('mainContentArea');
    const grid = document.getElementById('allGamesGrid');
    if (!scroller || !grid || !window._vs || !Array.isArray(window._vs.items) || !window._vs.items.length) {
        return { scenario, error: 'All Games virtual grid is not ready' };
    }

    const durationMs = Math.max(4000, Number(options.durationMs || 20000));
    const settleMs = Math.max(100, Number(options.settleMs || 350));
    const diag = {
        scenario,
        startedAt: performance.now(),
        durationMs,
        build: _agScrollDiagnosticInstalledBuildKind(),
        config: {
            totalGames: window._vs.items.length,
            cols: window._vs.cols || 0,
            rowH: Math.round((window._vs.rowH || 0) * 100) / 100,
            renderedStart: window._vs.renderedStart,
            renderedEnd: window._vs.renderedEnd,
            scrollHeight: scroller.scrollHeight,
            clientHeight: scroller.clientHeight,
        },
        counters: {},
        samples: { frameDurations: [], renderDurations: [], scrollHandlerDurations: [], decodeDurations: [], longTaskDurations: [], layoutShiftValues: [] },
        ranges: [],
        snapshots: [],
        max: { mountedCards: 0, domNodes: 0, rowPatchSize: 0 },
        notes: [],
    };

    window.__agScrollDiagnosticActive = diag;
    const cleanupHooks = _agScrollDiagnosticInstallHooks(diag);
    const cleanupScenario = _agScrollDiagnosticApplyScenario(scenario);

    const originalScrollTop = scroller.scrollTop;
    scroller.scrollTop = 0;
    if (typeof window._vsRender === 'function') window._vsRender(false, 'scroll-diagnostic-start');
    await new Promise(resolve => setTimeout(resolve, settleMs));
    _agScrollDiagnosticSnapshot('before');

    let rafId = null;
    let lastFrame = null;
    const frameLoop = (ts) => {
        if (lastFrame != null) diag.samples.frameDurations.push(ts - lastFrame);
        lastFrame = ts;
        rafId = requestAnimationFrame(frameLoop);
    };
    rafId = requestAnimationFrame(frameLoop);

    const fullMaxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const viewportLimit = Number(options.maxViewports);
    const maxScroll = Number.isFinite(viewportLimit) && viewportLimit > 0
        ? Math.min(fullMaxScroll, scroller.clientHeight * viewportLimit)
        : fullMaxScroll;
    const half = durationMs / 2;
    const started = performance.now();

    await new Promise((resolve) => {
        const tick = (now) => {
            const elapsed = now - started;
            const phase = Math.min(1, elapsed / half);
            const downward = elapsed <= half;
            const localPhase = downward ? phase : Math.min(1, (elapsed - half) / half);
            const target = downward ? maxScroll * localPhase : maxScroll * (1 - localPhase);
            scroller.scrollTop = target;
            _agScrollDiagnosticCount('scroll.programmaticSteps');
            if (elapsed < durationMs) requestAnimationFrame(tick);
            else resolve();
        };
        requestAnimationFrame(tick);
    });

    await new Promise(resolve => setTimeout(resolve, settleMs));
    _agScrollDiagnosticSnapshot('after');
    if (rafId != null) cancelAnimationFrame(rafId);

    const frameDurations = diag.samples.frameDurations;
    const over = (threshold) => frameDurations.filter(v => v > threshold).length;
    const expectedFrames = durationMs / 16.7;
    const actualFrames = frameDurations.length;
    const droppedEstimate = Math.max(0, expectedFrames - actualFrames);
    const visibleRangeChanges = diag.ranges.length;
    const uniqueRangeChanges = new Set(diag.ranges.map(r => `${r.firstVisibleRow}-${r.lastVisibleRow}-${r.firstVisRow}-${r.lastVisRow}`)).size;

    const report = {
        scenario,
        build: diag.build,
        config: diag.config,
        framePerformance: {
            ..._agScrollDiagnosticSummarizeDurations(frameDurations),
            framesOver16_7ms: over(16.7),
            framesOver33ms: over(33),
            framesOver50ms: over(50),
            framesOver100ms: over(100),
            estimatedDroppedFramePercentage: Math.round((droppedEstimate / Math.max(1, expectedFrames)) * 10000) / 100,
            longTasks: {
                count: Number(diag.counters['frame.longTasks'] || 0),
                totalDuration: Math.round((diag.samples.longTaskDurations || []).reduce((a, b) => a + b, 0) * 100) / 100,
                maxDuration: Math.round(Math.max(0, ...(diag.samples.longTaskDurations || [])) * 100) / 100,
            },
        },
        virtualization: {
            totalGames: window._vs.items.length,
            renderedCardCount: grid.querySelectorAll('.game-card').length,
            mountedCardCount: grid.querySelectorAll('.game-card').length,
            pooledRowCount: window._vs.cardPool instanceof Map ? window._vs.cardPool.size : 0,
            cardCacheSize: window._vs.cardCache instanceof Map ? window._vs.cardCache.size : 0,
            mounts: Number(diag.counters['virtual.rowMounts'] || 0),
            unmounts: Number(diag.counters['virtual.rowUnmounts'] || 0),
            rebinds: Number(diag.counters['virtual.cardRebinds'] || 0),
            cardBuilds: Number(diag.counters['virtual.cardBuilds'] || 0),
            eventListenersCreated: Number(diag.counters['virtual.cardClickListeners'] || 0),
            maxCardsMounted: diag.max.mountedCards,
            visibleRangeChanges,
            uniqueRangeChanges,
            fullGridRenders: Number(diag.counters['virtual.fullGridRenders'] || 0),
            incrementalRangePatches: Number(diag.counters['virtual.incrementalRangePatches'] || 0),
            skippedRangePatches: Number(diag.counters['virtual.skippedRangePatches'] || 0),
            maxRowPatchSize: diag.max.rowPatchSize,
            patchMode: diag.max.rowPatchSize > 3 ? 'page/block rows' : 'one-by-one rows',
            renderDurations: _agScrollDiagnosticSummarizeDurations(diag.samples.renderDurations),
            ranges: diag.ranges.slice(0, 12),
            lastRange: diag.ranges[diag.ranges.length - 1] || null,
        },
        artworkBehavior: {
            imgSrcAssignments: Number(diag.counters['artwork.imgSrcAssignments'] || 0),
            localFileAssignments: Number(diag.counters['artwork.localFileAssignments'] || 0),
            remoteImgAssignments: Number(diag.counters['artwork.remoteImgAssignments'] || 0),
            decodeCalls: Number(diag.counters['artwork.decodeCalls'] || 0),
            decodeCompletions: Number(diag.counters['artwork.decodeCompletions'] || 0),
            cacheLookups: Number(diag.counters['artwork.cacheLookups'] || 0),
            networkArtworkRequests: Number(diag.counters['artwork.networkOrCacheRequest'] || 0),
            metadataRequests: Number(diag.counters['artwork.metadataRequests'] || 0),
            queueAdditions: Number(diag.counters['artwork.queueAdditions'] || 0),
            readyArtworkReapplies: Number(diag.counters['artwork.readyReapplies'] || 0),
            readyArtworkLost: Number(diag.counters['artwork.readyArtworkLost'] || 0),
            coverApplySkippedByScenario: Number(diag.counters['artwork.coverApplySkippedByScenario'] || 0),
            decodeDurations: _agScrollDiagnosticSummarizeDurations(diag.samples.decodeDurations),
        },
        renderingAndLayout: {
            forcedLayoutProxy_getBoundingClientRectCalls: Number(diag.counters['layout.getBoundingClientRectCalls'] || 0),
            layoutShiftCount: Number(diag.counters['layout.layoutShifts'] || 0),
            layoutShiftTotal: Math.round((diag.samples.layoutShiftValues || []).reduce((a, b) => a + b, 0) * 10000) / 10000,
            resizeObserverCallbacks: Number(diag.counters['layout.resizeObserverCallbacks'] || 0),
            mutationObserverCallbacks: Number(diag.counters['dom.mutationObserverCallbacks'] || 0),
            mutationRecords: Number(diag.counters['dom.mutationRecords'] || 0),
            scrollHandlerInvocations: Number(diag.counters['scroll.handlerInvocations'] || 0),
            scrollHandlerTotalMs: Math.round(Number(diag.counters['scroll.handlerTotalMs'] || 0) * 100) / 100,
            scrollHandlerDurations: _agScrollDiagnosticSummarizeDurations(diag.samples.scrollHandlerDurations),
            libraryUpdatedEvents: Number(diag.counters['events.libraryUpdated'] || 0),
            renderDecisionEvents: Number(diag.counters['events.renderDecision'] || 0),
        },
        memoryAndDom: {
            snapshots: diag.snapshots,
            maxDomNodes: diag.max.domNodes,
            maxMountedCards: diag.max.mountedCards,
            finalDomNodes: document.getElementsByTagName('*').length,
            finalCardCacheSize: window._vs.cardCache instanceof Map ? window._vs.cardCache.size : 0,
            finalArtworkRegistrySize: window.__agArtworkRegistry instanceof Map ? window.__agArtworkRegistry.size : 0,
            jsHeapBefore: diag.snapshots.find(s => s.label === 'before')?.heap || null,
            jsHeapAfter: diag.snapshots.find(s => s.label === 'after')?.heap || null,
        },
        counters: diag.counters,
    };

    cleanupHooks();
    cleanupScenario();
    window.__agScrollDiagnosticActive = null;
    scroller.scrollTop = originalScrollTop;
    if (typeof window._vsRender === 'function') window._vsRender(false, 'scroll-diagnostic-restore');
    return report;
}

window.__agScrollDiagnosticEvent = function __agScrollDiagnosticEvent(name, payload = {}) {
    _agScrollDiagnosticCount(`events.${name}`);
    if (name === 'renderDecision') _agScrollDiagnosticCount('events.renderDecision');
};

window.__runAllGamesScrollDiagnostic = async function __runAllGamesScrollDiagnostic(options = {}) {
    const scenarios = Array.isArray(options.scenarios) && options.scenarios.length ? options.scenarios : ['A', 'B', 'C'];
    const startedAt = new Date().toISOString();
    const reports = [];
    const errors = [];
    for (const scenario of scenarios) {
        try {
            reports.push(await _agRunSingleScrollDiagnosticScenario(String(scenario).toUpperCase(), options));
        } catch (err) {
            errors.push({ scenario, message: err?.message || String(err), stack: err?.stack || null });
        }
    }
    const result = {
        marker: 'BADDEL_SCROLL_DIAGNOSTIC',
        startedAt,
        finishedAt: new Date().toISOString(),
        options: { durationMs: options.durationMs || 20000, scenarios },
        build: _agScrollDiagnosticInstalledBuildKind(),
        reports,
        errors,
    };
    console.log('BADDEL_SCROLL_DIAGNOSTIC', JSON.stringify(result));
    return result;
};

window.__agArtworkPersistenceEvidence = window.__agArtworkPersistenceEvidence || {
    generation: 0,
    resetLabel: 'startup',
    resetAt: 0,
    imgErrorCount: 0,
    brokenImages: [],
    pendingEnrichment: 0,
};

if (!window.__agArtworkPersistenceErrorListenerAttached) {
    window.__agArtworkPersistenceErrorListenerAttached = true;
    document.addEventListener('error', (event) => {
        const target = event?.target;
        if (!target || String(target.tagName || '').toLowerCase() !== 'img') return;
        const src = target.currentSrc || target.src || target.getAttribute?.('src') || '';
        const card = target.closest?.('.game-card, .ag-list-row');
        const evidence = window.__agArtworkPersistenceEvidence || _agResetArtworkImageErrorDiagnostics('auto-init');
        const assignment = target.__agArtworkAssignment || null;
        const boundGame = _agFindDiagnosticGameForCard(card, assignment ? { id: assignment.gameId } : null);
        let canonicalKey = assignment?.canonicalKey || null;
        try { canonicalKey = canonicalKey || _agArtworkKey(boundGame); } catch {}
        const record = canonicalKey && window.__agArtworkRegistry instanceof Map ? window.__agArtworkRegistry.get(canonicalKey) : null;
        const tokenStillMatched = assignment?.token ? String(target.dataset?.artworkAssignmentToken || '') === String(assignment.token) : null;
        const cardWasRebound = assignment ? (
            String(card?.dataset?.id || '') !== String(assignment.gameId || '') ||
            String(card?.dataset?.coverToken || '') !== String(assignment.cardTokenAtAssignment || '')
        ) : null;
        const sample = {
            timestamp: Date.now(),
            generation: evidence.generation || 0,
            cardElementToken: card?.dataset?.cardInstanceToken || null,
            assignmentToken: assignment?.token || target.dataset?.artworkAssignmentToken || null,
            currentlyBoundGameIdentity: {
                id: boundGame?.id || card?.dataset?.id || null,
                title: boundGame?.title || boundGame?.name || card?.dataset?.gameTitle || target.getAttribute?.('alt') || null,
                platform: boundGame?.platform || boundGame?.platforms?.[0] || null,
                appName: boundGame?.appName || null,
                namespace: boundGame?.namespace || boundGame?.allIds?.epic || null,
            },
            canonicalArtworkKey: canonicalKey,
            imgSrc: src,
            dataSrc: target.dataset?.src || target.getAttribute?.('data-src') || null,
            artworkRegistry: record ? { status: record.status || null, localUrl: record.localUrl || null, errorCode: record.errorCode || null, lastError: record.lastError || null, attempts: Number(record.attempts || 0) } : null,
            bulkAliasLookup: null,
            assetHash: _agAssetHashFromFileUrl(src),
            artworkClass: target.classList?.contains?.('native-lazy-load') || target.classList?.contains?.('ag-list-thumb') ? 'cover' : (target.className || '').includes('logo') ? 'logo' : 'unknown',
            fileExistsAtSrcAssignmentTime: assignment?.fileExistsAtAssignment ?? null,
            fileExistsAtErrorTime: null,
            cardReboundBetweenAssignmentAndError: cardWasRebound,
            errorHandlerTokenStillMatched: tokenStillMatched,
            classification: 'pending',
            isFileUrl: String(src || '').startsWith('file://'),
            alt: target.getAttribute?.('alt') || null,
            className: target.className || null,
        };
        evidence.imgErrorCount += 1;
        if (evidence.brokenImages.length < 200) evidence.brokenImages.push(sample);
        evidence.pendingEnrichment = Number(evidence.pendingEnrichment || 0) + 1;
        (async () => {
            try {
                sample.fileExistsAtErrorTime = await _agArtworkFileExistsForDiagnostics(src);
                const aliases = (() => { try { return _agArtworkAliasesForGame(boundGame); } catch { return []; } })();
                if (window.electronAPI?.getCachedImagesBulk && aliases.length) {
                    const lookup = await window.electronAPI.getCachedImagesBulk([{ key: canonicalKey || aliases[0], ids: aliases }], 'cover').catch(() => null);
                    sample.bulkAliasLookup = lookup?.status === 'success' ? { hit: !!lookup.images?.[canonicalKey || aliases[0]], localUrl: lookup.images?.[canonicalKey || aliases[0]] || null, aliasesTried: aliases } : { hit: false, aliasesTried: aliases };
                }
                if (sample.fileExistsAtSrcAssignmentTime === true && sample.fileExistsAtErrorTime === false) sample.classification = 'genuine_physical_file_deletion';
                else if (sample.fileExistsAtSrcAssignmentTime === false || sample.cardReboundBetweenAssignmentAndError || sample.errorHandlerTokenStillMatched === false) sample.classification = 'stale_dom_src_assignment';
                else if (sample.bulkAliasLookup && !sample.bulkAliasLookup.hit && record?.status !== 'ready') sample.classification = 'canonical_identity_mismatch';
                else if (sample.fileExistsAtErrorTime === true) sample.classification = 'decode_or_mime_failure';
                else sample.classification = 'unknown_img_error';
            } finally {
                evidence.pendingEnrichment = Math.max(0, Number(evidence.pendingEnrichment || 0) - 1);
            }
        })();
    }, true);
}

function _agArtworkPersistenceGameInputs() {
    const source = Array.isArray(window._vs?.items) && window._vs.items.length
        ? window._vs.items
        : (Array.isArray(window._allGamesCache) && window._allGamesCache.length
            ? window._allGamesCache
            : (Array.isArray(window.allGamesData) ? window.allGamesData : []));
    return source.map(game => {
        let aliases = [];
        try { aliases = _agArtworkAliasesForGame(game); } catch {}
        let canonicalKey = null;
        try { canonicalKey = _agArtworkKey(game); } catch {}
        let remoteCandidates = [];
        try { remoteCandidates = _agArtworkCandidateUrlsFromGame(game); } catch {}
        return {
            id: game?.id || null,
            title: game?.title || game?.name || game?.appName || null,
            name: game?.name || game?.title || null,
            platform: game?.platform || game?.platforms?.[0] || null,
            canonicalKey,
            aliases,
            remoteCandidates,
            coverUrl: game?.coverUrl || null,
            image: game?.image || null,
            defaultImage: game?.defaultImage || null,
            storedCoverUrl: game?.storedCoverUrl || null,
        };
    });
}

function _agArtworkPersistenceRendererEvidence() {
    const grid = document.getElementById('allGamesGrid');
    const imgs = [...(grid?.querySelectorAll?.('img.native-lazy-load, img.ag-list-thumb, img') || [])];
    const mountedSources = imgs.map(img => img.currentSrc || img.src || img.getAttribute('src') || '').filter(Boolean);
    const registry = window.__agArtworkRegistry instanceof Map ? window.__agArtworkRegistry : new Map();
    const records = [...registry.values()];
    return {
        ...window.__agArtworkPersistenceEvidence,
        mountedImageCount: imgs.length,
        mountedFileImageCount: mountedSources.filter(src => String(src).startsWith('file://')).length,
        rendererReceivedNoCachedUrl: records.filter(r => r && r.status !== 'ready' && !r.localUrl).length,
        canonicalIdentityLookupMiss: records.filter(r => r && (r.status === 'unknown' || r.status === 'no_source')).length,
        artworkRegistrySize: registry.size,
        readyArtworkCount: records.filter(r => r?.status === 'ready' && r.localUrl).length,
        activeArtworkJobs: Number(_agT1Active || 0) + Number(_agT2Active || 0) + Number(_agT3Active || 0),
        queuedArtworkJobs: _agViewportCoverQueue.length + _agBufferCoverQueue.length + _agBackgroundCoverQueue.length,
    };
}

function _agArtworkPersistenceWait(ms = 250) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function _agArtworkPersistenceWaitForGrid(timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (window._vs && Array.isArray(window._vs.items) && window._vs.items.length > 0) return true;
        await _agArtworkPersistenceWait(250);
    }
    return false;
}

window.__runArtworkPersistenceAudit = async function(options = {}) {
    const snapshots = [];
    const collect = async (label) => {
        const payload = {
            label,
            games: _agArtworkPersistenceGameInputs(),
            rendererEvidence: _agArtworkPersistenceRendererEvidence(),
            lifecycle: {
                currentView: typeof currentView === 'undefined' ? null : currentView,
                allGamesVisible: document.getElementById('allGamesView')?.style?.display || null,
                allGamesItemCount: Array.isArray(window._vs?.items) ? window._vs.items.length : 0,
                allGamesCacheCount: Array.isArray(window._allGamesCache) ? window._allGamesCache.length : 0,
                allGamesDataCount: Array.isArray(window.allGamesData) ? window.allGamesData.length : 0,
                collectedAt: new Date().toISOString(),
            },
        };
        const result = await window.electronAPI?.getArtworkPersistenceAudit?.(payload);
        snapshots.push(result);
        return result;
    };

    await collect('startup-current-state-before-navigation');

    if (typeof window.navigateToAllGames === 'function') {
        await window.navigateToAllGames();
    } else if (typeof navigateToAllGames === 'function') {
        await navigateToAllGames();
    }
    await _agArtworkPersistenceWaitForGrid();
    await _agArtworkPersistenceWait(Number(options.settleMs || 500));
    await collect('after-opening-all-games');

    for (let i = 1; i <= 2; i++) {
        if (typeof window.navigateToHome === 'function') window.navigateToHome();
        else if (typeof navigateToHome === 'function') navigateToHome();
        await _agArtworkPersistenceWait(Number(options.leaveSettleMs || 350));
        if (typeof window.navigateToAllGames === 'function') await window.navigateToAllGames();
        else if (typeof navigateToAllGames === 'function') await navigateToAllGames();
        await _agArtworkPersistenceWaitForGrid();
        await _agArtworkPersistenceWait(Number(options.settleMs || 500));
        await collect(`after-reenter-all-games-${i}`);
    }

    const report = {
        status: 'success',
        marker: 'BADDEL_ARTWORK_PERSISTENCE_AUDIT',
        generatedAt: new Date().toISOString(),
        snapshots,
    };
    console.log('BADDEL_ARTWORK_PERSISTENCE_AUDIT', JSON.stringify(report));
    return report;
};

(function _agMaybeAutorunScrollDiagnostic() {
    if (!window.electronAPI?.getScrollDiagnosticConfig || window.__agScrollDiagnosticAutorunAttached) return;
    window.__agScrollDiagnosticAutorunAttached = true;
    setTimeout(async () => {
        try {
            const config = await window.electronAPI.getScrollDiagnosticConfig();
            if (!config?.enabled) return;
            if (typeof navigateToAllGames === 'function') navigateToAllGames();
            const deadline = Date.now() + 30000;
            while (Date.now() < deadline) {
                if (window._vs && Array.isArray(window._vs.items) && window._vs.items.length > 0) break;
                await new Promise(resolve => setTimeout(resolve, 250));
            }
            const report = await window.__runAllGamesScrollDiagnostic({
                durationMs: config.durationMs || 20000,
                scenarios: Array.isArray(config.scenarios) && config.scenarios.length ? config.scenarios : ['A', 'B', 'C'],
            });
            await window.electronAPI.writeScrollDiagnosticReport?.(report);
        } catch (err) {
            console.error('[ScrollDiagnostic] autorun failed', err?.message || err);
        }
    }, 2000);
})();

function _agLegacyCoverForResolver(game) {
    return game?.coverUrl || game?.image || game?.defaultImage || game?.cover || game?.posterImage || '';
}

function _agResolveAllGamesCoverDecision(game) {
    let legacyCover = _agLegacyCoverForResolver(game);
    if (_agIsManagedArtworkCacheUrl(legacyCover)) legacyCover = '';
    const adapter = window.BaddelAllGamesArtworkAdapter;

    if (!adapter || typeof adapter.resolveAllGamesArtwork !== 'function') {
        return {
            value: legacyCover,
            source: legacyCover ? 'legacy-fallback' : 'placeholder',
            reason: adapter ? 'All Games artwork adapter unavailable' : 'All Games artwork adapter not loaded',
            usedFallback: true,
        };
    }

    try {
        const result = adapter.resolveAllGamesArtwork({ game });
        if (result?.value) return result;
    } catch {}

    return {
        value: legacyCover,
        source: legacyCover ? 'legacy-fallback' : 'placeholder',
        reason: legacyCover ? 'legacy All Games cover fallback' : 'no All Games cover candidate',
        usedFallback: true,
    };
}

function _agResolveCardCoverPayload(game) {
    if (!game) return null;
    const activeScrollDiag = _agScrollDiagnosticActive();
    if (activeScrollDiag?.scenario === 'A') {
        _agScrollDiagnosticCount('artwork.coverApplySkippedByScenario');
        return null;
    }
    _agApplyReadyArtworkToGame(game);
    const record = _agArtworkRecordFor(game, false);
    const coverDecision = _agResolveAllGamesCoverDecision(game);
    const rawCover = (record?.status === 'ready' && record.localUrl) ? record.localUrl : coverDecision.value;
    const originalCover = String(rawCover || '');
    const cover = _agGridDisplayCover(originalCover);
    if (!cover) return null;
    if (!_agIsUsableCardCover(cover, game)) {
        game._agCoverPipelineDone = false;
        game._agCoverInFlight = false;
        _agScrollDiagnosticCount('artwork.readyArtworkLost');
        return null;
    }
    return { cover, originalCover, gridThumbnail: cover !== originalCover, record, coverDecision, ready: record?.status === 'ready' && record.localUrl === originalCover };
}

function _vsCardRefs(card) {
    if (!card) return {};
    if (!card._vsRefs) {
        card._vsRefs = {
            img: card.querySelector?.('.native-lazy-load'),
            title: card.querySelector?.('.game-card-title'),
            badges: card.querySelector?.('.agc-badges-strip'),
            placeholder: card.querySelector?.('.agc-placeholder, .agc-img-fallback'),
            imageWrap: card.querySelector?.('.game-card-img-wrap'),
        };
    }
    return card._vsRefs;
}

function _vsClearCardCoverForRebind(card, game) {
    if (!card) return;
    const refs = _vsCardRefs(card);
    const img = refs.img;
    if (img) {
        img.onload = null;
        img.onerror = null;
        img.removeAttribute('src');
        img.removeAttribute('data-src');
        img.style.display = 'none';
        img.classList.remove('loaded', 'loading', 'skeleton');
    }
    const placeholder = refs.placeholder;
    if (placeholder) placeholder.classList.remove('loading', 'skeleton');
    refs.imageWrap?.classList.remove('cover-ready');
    card.dataset.coverUrl = '';
    card._vsLastCoverApplied = false;
    card._vsPendingCoverUrl = '';
    card._vsDecodedCoverUrl = '';
    card._vsCoverBoundGameId = game ? _agGameKey(game) : '';
}

function _vsCardStillBound(card, game, token) {
    if (!card || !game) return false;
    return String(card.dataset.bindingToken || '') === String(token || '')
        && String(card.dataset.id || '') === String(_agGameKey(game));
}

function _vsEnsureImageBindState() {
    if (!_vs.coverDecodeCache) _vs.coverDecodeCache = new Map();
    if (!_vs.coverDecodeJobs) _vs.coverDecodeJobs = new Map();
    if (!_vs.coverCommitQueue) _vs.coverCommitQueue = [];
}

function _vsPruneDecodedCoverCache(limit = 96) {
    _vsEnsureImageBindState();
    while (_vs.coverDecodeCache.size > limit) {
        const first = _vs.coverDecodeCache.keys().next().value;
        if (!first) break;
        _vs.coverDecodeCache.delete(first);
    }
}

function _vsScheduleCoverCommit() {
    _vsEnsureImageBindState();
    if (_vs.coverCommitRaf) return;
    _vs.coverCommitRaf = requestAnimationFrame(() => {
        _vs.coverCommitRaf = null;
        const started = performance.now();
        let committed = 0;
        while (_vs.coverCommitQueue.length && committed < 2 && performance.now() - started <= 2) {
            const job = _vs.coverCommitQueue.shift();
            const { card, game, token, cover, payload } = job || {};
            if (!_vsCardStillBound(card, game, token)) continue;
            const refs = _vsCardRefs(card);
            const img = refs.img;
            if (!img) continue;
            const currentSrc = img.getAttribute('src') || '';
            if (currentSrc !== cover || img.style.display === 'none') {
                const gameId = _agGameKey(game);
                img.onload = null;
                img.onerror = function () {
                    if (!_vsCardStillBound(card, game, token)) return;
                    img.classList.remove('loaded');
                    img.style.display = 'none';
                    _agSetCoverState(game, 'retry_wait', { token, failedUrl: cover, lastError: 'image-load-failed' });
                    if (gameId && window._vs?._coverQueued) window._vs._coverQueued.delete(gameId);
                };
                _agMarkImageAssignment(img, card, game, cover, payload?.ready ? 'decoded-ready-commit' : 'decoded-cover-commit');
                img.src = cover;
                img.dataset.src = cover;
                _agArtworkDiagnosticsBump('cardRemountCacheHits');
            }
            img.style.display = '';
            img.classList.add('loaded');
            img.classList.remove('loading', 'skeleton');
            const placeholder = refs.placeholder;
            if (placeholder) placeholder.classList.remove('loading', 'skeleton');
            refs.imageWrap?.classList.add('cover-ready');
            card.classList.remove('loading', 'skeleton', 'is-loading');
            card.dataset.coverUrl = cover;
            card.dataset.artworkSource = payload?.ready ? 'session-registry' : (payload?.coverDecision?.source || 'decoded-local-cover');
            card.dataset.artworkReason = payload?.ready ? 'ready artwork registry hit' : (payload?.coverDecision?.reason || 'decoded local cover');
            card._vsLastCoverApplied = true;
            card._vsPendingCoverUrl = '';
            card._vsDecodedCoverUrl = cover;
            if (!payload?.gridThumbnail && _agIsUsableCardCover(cover, game)) _agSetArtworkReady(game, cover, payload?.ready ? 'decoded-ready-bind' : 'decoded-local-bind');
            committed++;
        }
        if (_vs.coverCommitQueue.length) _vsScheduleCoverCommit();
    });
}

function _vsQueueDecodedCoverCommit(card, game, token, cover, payload) {
    _vsEnsureImageBindState();
    _vs.coverCommitQueue = _vs.coverCommitQueue.filter(job => job && job.card !== card);
    _vs.coverCommitQueue.push({ card, game, token, cover, payload });
    _vsScheduleCoverCommit();
}

function _vsCommitReadyLocalCover(card, game, token, cover, payload, refs) {
    const img = refs.img;
    if (!img || !_vsCardStillBound(card, game, token) || img.getAttribute('src') !== cover) return false;
    img.style.display = '';
    img.classList.add('loaded');
    img.classList.remove('loading', 'skeleton');
    refs.placeholder?.classList.remove('loading', 'skeleton');
    refs.imageWrap?.classList.add('cover-ready');
    card.classList.remove('loading', 'skeleton', 'is-loading');
    card.dataset.coverUrl = cover;
    card._vsLastCoverApplied = true;
    card._vsPendingCoverUrl = '';
    card._vsDecodedCoverUrl = cover;
    if (!payload?.gridThumbnail) _agSetArtworkReady(game, cover, 'ready-local-buffer-bind');
    return true;
}

function _vsRequestCoverBind(card, game, priority = 'visible', resolvedPayload = null) {
    if (!card || !game) return false;
    const payload = resolvedPayload || _agResolveCardCoverPayload(game);
    if (!payload?.cover) return false;
    const cover = payload.cover;
    const token = String(card.dataset.bindingToken || '');
    const refs = _vsCardRefs(card);
    const img = refs.img;
    if (!img) return false;
    const currentSrc = img.getAttribute('src') || '';
    if (currentSrc === cover && img.style.display !== 'none' && img.classList.contains('loaded')) {
        card._vsLastCoverApplied = true;
        card.dataset.coverUrl = cover;
        return true;
    }
    if (card._vsPendingCoverUrl === cover) return false;
    card._vsPendingCoverUrl = cover;
    if (payload.ready && cover.startsWith('file://')) {
        img.onload = () => _vsCommitReadyLocalCover(card, game, token, cover, payload, refs);
        img.onerror = () => {
            if (!_vsCardStillBound(card, game, token)) return;
            card._vsPendingCoverUrl = '';
            _agSetCoverState(game, 'retry_wait', { token, failedUrl: cover, lastError: 'image-load-failed' });
        };
        _agMarkImageAssignment(img, card, game, cover, 'ready-local-buffer-bind');
        img.src = cover;
        img.dataset.src = cover;
        if (img.complete && img.naturalWidth > 0) _vsCommitReadyLocalCover(card, game, token, cover, payload, refs);
        return true;
    }
    _vsEnsureImageBindState();
    _vsPruneDecodedCoverCache();
    if (_vs.coverDecodeCache.has(cover)) {
        _vsQueueDecodedCoverCommit(card, game, token, cover, payload);
        return true;
    }
    const existing = _vs.coverDecodeJobs.get(cover);
    if (existing) {
        existing.waiters.push({ card, game, token, payload, priority });
        return true;
    }
    const job = { waiters: [{ card, game, token, payload, priority }] };
    _vs.coverDecodeJobs.set(cover, job);
    const decoder = new Image();
    decoder.decoding = 'async';
    decoder.onload = async () => {
        try { if (typeof decoder.decode === 'function') await decoder.decode(); } catch {}
        _vs.coverDecodeJobs.delete(cover);
        _vs.coverDecodeCache.delete(cover);
        _vs.coverDecodeCache.set(cover, { width: decoder.naturalWidth || 0, height: decoder.naturalHeight || 0, at: Date.now() });
        _vsPruneDecodedCoverCache();
        for (const waiter of job.waiters.splice(0)) {
            if (_vsCardStillBound(waiter.card, waiter.game, waiter.token)) {
                _vsQueueDecodedCoverCommit(waiter.card, waiter.game, waiter.token, cover, waiter.payload);
            }
        }
    };
    decoder.onerror = () => {
        _vs.coverDecodeJobs.delete(cover);
        for (const waiter of job.waiters.splice(0)) {
            if (!_vsCardStillBound(waiter.card, waiter.game, waiter.token)) continue;
            waiter.card._vsPendingCoverUrl = '';
            _agSetCoverState(waiter.game, 'retry_wait', { token: waiter.token, failedUrl: cover, lastError: 'predecode-failed' });
        }
    };
    decoder.src = cover;
    return true;
}

function _vsBindCoversForRows(firstRow, lastRow, firstVisRow, lastVisRow) {
    if (!_vs.items?.length || !_vs.cols) return;
    const from = Math.max(0, firstRow);
    const to = Math.max(from, lastRow);
    for (let row = from; row <= to; row++) {
        const rowEl = _vs.cardPool.get(row);
        if (!rowEl) continue;
        const startIdx = row * _vs.cols;
        const endIdx = Math.min(_vs.items.length, startIdx + _vs.cols);
        const priority = row >= firstVisRow && row <= lastVisRow ? 'visible' : 'near';
        for (let i = startIdx; i < endIdx; i++) {
            const game = _vs.items[i];
            const card = rowEl.children[i - startIdx];
            if (card && game && !card._vsLastCoverApplied && !card._vsPendingCoverUrl) {
                _vsRequestCoverBind(card, game, priority);
            }
        }
    }
}

function _vsApplyCoverToCard(card, game, force = false) {
    if (!card || !game) return false;
    const activeScrollDiag = _agScrollDiagnosticActive();
    if (activeScrollDiag?.scenario === 'A') {
        _agScrollDiagnosticCount('artwork.coverApplySkippedByScenario');
        return false;
    }
    _agApplyReadyArtworkToGame(game);

    const record = _agArtworkRecordFor(game, false);
    const coverDecision = _agResolveAllGamesCoverDecision(game);
    const rawCover = (record?.status === 'ready' && record.localUrl) ? record.localUrl : coverDecision.value;
    if (!rawCover) return false;

    const cover = String(rawCover || '');
    if (!_agIsUsableCardCover(cover, game)) {
        game._agCoverPipelineDone = false;
        game._agCoverInFlight = false;
        _agScrollDiagnosticCount('artwork.readyArtworkLost');
        return false;
    }

    const img = card.querySelector('.native-lazy-load');
    if (!img) return false;

    const gameId = _agGameKey(game);
    const currentSrc = img.getAttribute('src') || '';
    const ready = record?.status === 'ready' && record.localUrl === cover;

    if (ready) {
        _agScrollDiagnosticCount('artwork.readyReapplies');
        img.onload = null;
        img.onerror = function () {
            if (card.dataset.id !== gameId) return;
            if (_agInvalidateArtworkRecord(game, 'ready-local-img-error')) {
                _agEnqueueByPriority([game], null, null);
            }
        };
        if (force || currentSrc !== cover || img.style.display === 'none') {
            _agMarkImageAssignment(img, card, game, cover, 'ready-reapply');
            img.src = cover;
            img.dataset.src = cover;
            _agArtworkDiagnosticsBump('cardRemountCacheHits');
        }
        img.style.display = '';
        img.classList.add('loaded');
        img.classList.remove('loading', 'skeleton');
        card.querySelector('.game-card-img-wrap')?.classList.add('cover-ready');
    } else if (force || currentSrc !== cover || img.style.display === 'none' || !img.classList.contains('loaded')) {
        const token = String((Number(card.dataset.coverToken || 0) + 1));
        card.dataset.coverToken = token;
        img.onload = function () {
            if (card.dataset.coverToken !== token || card.dataset.id !== gameId) return;
            img.classList.add('loaded');
            img.classList.remove('loading', 'skeleton');
            img.style.display = '';
            card.querySelector('.game-card-img-wrap')?.classList.add('cover-ready');
            if (_agIsUsableCardCover(cover, game)) _agSetArtworkReady(game, cover, 'dom-local-load');
        };
        img.onerror = function () {
            if (card.dataset.coverToken !== token || card.dataset.id !== gameId) return;
            img.classList.remove('loaded');
            img.style.display = 'none';
            game._agCoverPipelineDone = false;
            game._agCoverInFlight = false;
            _agSetCoverState(game, 'retry_wait', { token, failedUrl: cover, lastError: 'image-load-failed' });
            if (gameId && window._vs?._coverQueued) window._vs._coverQueued.delete(gameId);
        };
        _agSetCoverState(game, 'verifying', { token, url: cover });
        _agMarkImageAssignment(img, card, game, cover, 'cover-verify');
        img.src = cover;
        img.dataset.src = cover;
        img.style.display = '';
        img.classList.add('loading');
        img.classList.remove('loaded', 'skeleton');
    }

    const placeholder = card.querySelector('.agc-placeholder, .agc-img-fallback');
    if (placeholder) placeholder.classList.remove('loading', 'skeleton');
    card.classList.remove('loading', 'skeleton', 'is-loading');
    card.dataset.coverUrl = cover;
    card.dataset.artworkSource = ready ? 'session-registry' : (coverDecision.source || '');
    card.dataset.artworkReason = ready ? 'ready artwork registry hit' : (coverDecision.reason || '');
    return true;
}


function _agPlatformBadgesHtml(game) {
    const MAX_VISIBLE = 3;
    const visiblePlats = (game.platforms || []).slice(0, MAX_VISIBLE);
    const overflowCount = (game.platforms || []).length - MAX_VISIBLE;
    let badgesHtml = visiblePlats.map(plat => {
        const m = PLAT_BADGE_META[plat] || { color: '#888', icon: null, invert: false, label: plat };
        const imgContent = m.icon
            ? `<img src="${m.icon}" alt="${m.label}" class="agc-badge-img${m.invert ? ' agc-badge-invert' : ''}">`
            : `<span class="agc-badge-dot" style="background:${m.color}"></span>`;
        return `<span class="agc-badge" style="--bc:${m.color}" title="${m.label}">${imgContent}</span>`;
    }).join('');
    if (overflowCount > 0) {
        badgesHtml += `<span class="agc-badge agc-badge-overflow" title="${(game.platforms || []).slice(MAX_VISIBLE).join(', ')}">+${overflowCount}</span>`;
    }
    return badgesHtml;
}

function _vsBindCard(card, game) {
    if (!card || !game) return card;
    _agScrollDiagnosticCount('virtual.cardRebinds');
    const rawId = _agGameKey(game);
    const previousId = String(card.dataset.id || '');
    const previousCoverUrl = String(card.dataset.coverUrl || '');
    const bindingToken = String((Number(card.dataset.bindingToken || 0) + 1));
    card.dataset.bindingToken = bindingToken;
    const isMulti = (game.platforms || []).length > 1;
    card.classList.toggle('agc-multi', isMulti);
    card.dataset.id = rawId;
    card._vsBoundGame = game;
    card.dataset.gameId = game.id || '';
    card.dataset.appid = game.appid || game.appId || game.appName || '';
    card.dataset.appName = game.appName || '';
    card.dataset.namespace = game.namespace || game.allIds?.epic || '';
    card.dataset.gameTitle = game.title || game.name || game.appName || '';
    card.dataset.titleKey = String(game.title || game.name || game.appName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const refs = _vsCardRefs(card);
    const titleEl = refs.title;
    if (titleEl && titleEl.textContent !== (game.title || '')) titleEl.textContent = game.title || '';
    const img = refs.img;
    if (img) img.alt = game.title || '';
    const badges = refs.badges;
    if (badges) {
        const next = _agPlatformBadgesHtml(game);
        if (badges.innerHTML !== next) badges.innerHTML = next;
    }
    const coverPayload = _agResolveCardCoverPayload(game);
    const keepingSameCover = previousId === rawId
        && coverPayload?.cover
        && previousCoverUrl === coverPayload.cover
        && img
        && img.getAttribute('src') === coverPayload.cover
        && img.style.display !== 'none'
        && img.classList.contains('loaded');
    if (keepingSameCover) {
        card._vsLastCoverApplied = true;
        card._vsPendingCoverUrl = '';
        card._vsDecodedCoverUrl = coverPayload.cover;
    } else {
        _vsClearCardCoverForRebind(card, game);
    }
    if (typeof _agDecorateAllGamesCardFields === 'function') _agDecorateAllGamesCardFields(card, game);
    _vsRequestCoverBind(card, game, 'buffer', coverPayload);
    return card;
}

/** Build one card DOM node for a game */
function _vsBuildCard(game) {
    _agScrollDiagnosticCount('virtual.cardBuilds');
    const rawId = game.id || game.appName || game.title || '';
    const safeId = String(rawId);

    const badgesHtml = _agPlatformBadgesHtml(game);
    const isMulti = (game.platforms || []).length > 1;
    _agApplyReadyArtworkToGame(game);
    const record = _agArtworkRecordFor(game, false);
    const coverDecision = _agResolveAllGamesCoverDecision(game);
    const rawCover = (record?.status === 'ready' && record.localUrl) ? record.localUrl : (coverDecision.value || '');
    const cover = _agScrollDiagnosticActive()?.scenario === 'A' ? '' : (_agIsUsableCardCover(rawCover, game) ? _agAttrUrl(rawCover) : '');
    const coverReady = !!cover && record?.status === 'ready' && record.localUrl === rawCover;

    const card = document.createElement('div');
    card.className = `game-card agc-card${isMulti ? ' agc-multi' : ''}`;
    card.dataset.id = safeId;
    card.dataset.cardInstanceToken = String(Date.now()) + '-' + Math.random().toString(36).slice(2);
    card.dataset.bindingToken = '1';
    card._vsBoundGame = game;
    card.dataset.artworkSource = coverDecision.source || '';
    card.dataset.artworkReason = coverDecision.reason || '';

    card.innerHTML = `
        <div class="game-card-img-wrap">
            <div class="game-card-img agc-placeholder agc-img-fallback" aria-hidden="true">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#2a2a2a" stroke-width="1.5">
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                </svg>
            </div>
            <img alt="${(game.title || '').replace(/"/g, '&quot;')}"
                 class="game-card-img native-lazy-load"
                 decoding="async" style="display:none">
            <div class="agc-badges-strip">${badgesHtml}</div>
            <div class="agc-top-gradient"></div>
        </div>
        <div class="game-card-info">
            ${typeof _gameCardUpdateIndicatorHtml === 'function' ? _gameCardUpdateIndicatorHtml(game) : ''}
            <div class="game-card-title">${game.title || ''}</div>
        </div>`;
    
    card.dataset.gameId = game.id || '';
    card.dataset.appid = game.appid || game.appId || game.appName || '';
    card.dataset.appName = game.appName || '';
    card.dataset.namespace = game.namespace || game.allIds?.epic || '';
    card.dataset.gameTitle = game.title || game.name || game.appName || '';
    card.dataset.titleKey = String(game.title || game.name || game.appName || '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
    card._vsLastCoverApplied = false;
    _vsCardRefs(card);

    _agScrollDiagnosticCount('virtual.cardClickListeners');
    card.addEventListener('click', (e) => {
        e.stopPropagation();
        const currentId = String(_agGameKey(card._vsBoundGame) || card.dataset.id || '');
        if (currentId && typeof openGameDetails === 'function') openGameDetails(currentId);
    });
    card.addEventListener('contextmenu', (e) => {
        const currentId = String(_agGameKey(card._vsBoundGame) || card.dataset.id || '');
        if (!currentId || typeof showContextMenu !== 'function') return;
        e.preventDefault();
        showContextMenu(e.pageX, e.pageY, currentId, card._vsBoundGame?.title || card.dataset.gameTitle || currentId);
    });

    // For installed synced entries, stamp the local DB ID onto the game object so
    // the playtime resolver can locate the correct playtimeData record without a
    // global ID replacement. Only performed when the game has no local IDs yet.
    if (_agIsInstalled(game)
        && !game.localGameId
        && !game.installedId
        && typeof window._agFindInstalledLocalMatch === 'function'
    ) {
        try {
            const localMatch = window._agFindInstalledLocalMatch(game);
            if (localMatch?.id) {
                game = {
                    ...game,
                    installedId:         localMatch.id,
                    localGameId:         localMatch.id,
                    totalPlaytime:       localMatch.totalPlaytime        ?? game.totalPlaytime,
                    lastPlayed:          localMatch.lastPlayed           ?? game.lastPlayed,
                    lastQualifiedPlayed: localMatch.lastQualifiedPlayed  ?? game.lastQualifiedPlayed,
                    playSessions:        localMatch.playSessions         ?? game.playSessions,
                };
            }
        } catch {}
    }

    // Attach the display overlay so Show Fields checkboxes (title, playtime,
    // lastPlayed, installed) work.  _agDecorateAllGamesCardFields is defined in
    // app.js and always available by the time this function is first called.
    if (typeof _agDecorateAllGamesCardFields === 'function') {
        _agDecorateAllGamesCardFields(card, game);
    }

    return card;
}


async function _agHydrateCachedCoversIntoAllGames() {
    const rawGames = [];

    try {
        const steamRes = await window.electronAPI.platformSyncGetCached?.('steam');
        if (Array.isArray(steamRes?.games)) rawGames.push(...steamRes.games);
    } catch {}

    try {
        const epicRes = await window.electronAPI.platformSyncGetCached?.('epic');
        if (Array.isArray(epicRes?.games)) rawGames.push(...epicRes.games);
    } catch {}
    try {
        const gogRes = await window.electronAPI.platformSyncGetCached?.('gog');
        if (Array.isArray(gogRes?.games)) rawGames.push(...gogRes.games);
    } catch {}

    const coverByKey = new Map();

    const addKeys = (g, cover) => {
        [
            g.id,
            g.appid,
            g.appId,
            g.appName,
            g.namespace,
            g.allIds?.steam,
            g.allIds?.epic,
            g.allIds?.gog,
            g.productId,
            String(g.title || g.name || g.appName || '').toLowerCase().replace(/[^a-z0-9]/g, '')
        ].filter(Boolean).forEach(k => coverByKey.set(String(k), cover));
    };

    const canUseHydratedCover = async (cover) => {
        if (!cover || !String(cover).startsWith('file://')) return false;
        if (!_agIsManagedArtworkCacheUrl(cover)) return true;
        return _agVerifyLocalArtworkUrl(cover);
    };

    for (const g of rawGames) {
        const cover = g.coverUrl || g.image || g.defaultImage;
        if (!await canUseHydratedCover(cover)) continue;
        if (_agIsManagedArtworkCacheUrl(cover)) window.__agVerifiedArtworkUrls.add(cover);
        addKeys(g, cover);
    }

    const patchList = (list) => {
        let changed = 0;
        if (!Array.isArray(list)) return changed;

        list.forEach(g => {
            const keys = [
                g.id,
                g.appid,
                g.appId,
                g.appName,
                g.namespace,
                g.allIds?.steam,
                g.allIds?.epic,
                String(g.title || g.name || g.appName || '').toLowerCase().replace(/[^a-z0-9]/g, '')
            ].filter(Boolean).map(String);
            // Settings/Creator artwork wins over platform-sync cached covers
if (g.customArtworkLocked === true && (g.artworkSource === 'settings' || g.artworkSource === 'creator')) {
    const creatorCover = g.coverUrl || g.image || g.defaultImage;

    if (_agIsUsableCardCover(creatorCover, g)) {
        g.coverUrl = creatorCover;
        g.image = creatorCover;
        g.defaultImage = creatorCover;
        g._agCoverPipelineDone = true;
        g._agCoverInFlight = false;
        g._agLocalRetryCount = 999;
        changed++;
    }

    return;
}
            const cover = keys.map(k => coverByKey.get(k)).find(Boolean);
            if (!cover) return;

            g.coverUrl = cover;
            g.image = cover;
            g.defaultImage = cover;
            g._agCoverPipelineDone = true;
            changed++;
        });

        return changed;
    };

    const changedCache = patchList(window._allGamesCache);
    const changedItems = patchList(window._vs?.items);

    // Patch cardCache cards in-place. cardCache holds the exact same DOM nodes
    // referenced by the mounted row wrappers, so patches are immediately visible
    // in the grid without any _vsRender call.
    let patchedCards = 0;
    if ((changedCache || changedItems) && window._vs?.cardCache instanceof Map && Array.isArray(window._vs.items)) {
        window._vs.items.forEach(game => {
            const gameId = String(game.id || game.appName || game.title || '');
            const card = window._vs.cardCache.get(gameId);
            if (card && game.coverUrl) {
                _vsApplyCoverToCard(card, game, true);
                window._vs._coverQueued.delete(gameId);
                patchedCards++;
            }
        });
    }

    console.log(`[AllGamesUI] hydrated cached covers cache=${changedCache}, items=${changedItems}, cards=${patchedCards}`);

    // Never call _vsRender(true) after cover hydration — forced remeasure tears
    // down all row wrappers and causes a visible grid jump. Fall back to a soft
    // repaint only when data changed but no card was reachable in cardCache yet.
    // Ensure grid styles are intact before the repaint so row wrappers are anchored.
    if ((changedCache || changedItems) && patchedCards === 0 && typeof window._vsRender === 'function') {
        _agEnsureVirtualGridIntegrity('cover-patch-fallback');
        window._vsRender(false, 'cover-patch-fallback');
    }
}

/** Measure columns and row height from the live grid */
function _vsMeasure(grid) {
    // cols: count how many columns CSS auto-fill created by checking card widths
    const view = document.getElementById('allGamesView');
    const gridW = grid.clientWidth;
    const rectW = grid.getBoundingClientRect().width;
    const visible = window._agDisplayPrefs?.viewMode === 'grid'
        && (typeof currentView === 'undefined' || currentView === 'all-games')
        && view?.style.display !== 'none'
        && getComputedStyle(grid).display !== 'none';
    if (!visible || gridW < 80 || rectW < 80) return null;
    // Read density from display prefs so card size actually changes
    const densityMinW = { compact: 120, normal: 160, large: 210 };
    const gridDensity = (window._agDisplayPrefs && window._agDisplayPrefs.gridDensity) || 'normal';
    const minCardW = densityMinW[gridDensity] || 160;
    const cols = Math.max(1, Math.floor((gridW + _vs.gap) / (minCardW + _vs.gap)));
    // row height: card width * (3/2) for aspect-ratio:2/3, + gap
    const colW = (gridW - (cols - 1) * _vs.gap) / cols;
    const cardH = colW * (3 / 2);
    const rowH = cardH + _vs.gap;
    return { cols, rowH };
}
function _agHasLocalCover(game) {
    if (_agApplyReadyArtworkToGame(game)) return true;
    return [game?.coverUrl, game?.image, game?.defaultImage]
        .some((u) => _agIsUsableCardCover(u, game));
}


function _agNeedsLocalCoverWork(game) {
    if (!game) return false;
    if (window.__agForegroundArtworkKeys instanceof Set
        && window.__agForegroundArtworkKeys.has(_agArtworkKey(game))) return false;
    const record = _agArtworkRecordFor(game);
    if (record?.status === 'ready' && record.localUrl) return false;
    if (record?.status === 'terminal_error' || record?.status === 'no_source') return false;
    if (Number(record?.attempts || 0) >= 5) return false;
    if (record?.promise) return false;
    if (record?.status === 'queued' || record?.status === 'resolving' || record?.status === 'downloading' || record?.status === 'verifying') return false;
    if (record?.status === 'retry_wait' && record.nextRetryAt > Date.now()) return false;
    if (_agHasLocalCover(game)) return false;
    return true;
}


function _agCanQueueCover(game, gameId) {
    if (!_agNeedsLocalCoverWork(game)) return false;
    const record = _agArtworkRecordFor(game);
    const now = Date.now();
    const lastQueuedAt = Number(record?.lastQueuedAt || game._agQueuedAt || 0);
    if (window._vs?._coverQueued?.has(gameId) && now - lastQueuedAt < 2500) return false;
    if (window._vs?._coverQueued?.has(gameId)) window._vs._coverQueued.delete(gameId);
    if (record) record.lastQueuedAt = now;
    game._agQueuedAt = now;
    window._vs?._coverQueued?.add(gameId);
    return true;
}


/** Main render function — called on every scroll tick */
function _vsRender(forceRemeasure = false, reason = 'unknown') {
    const __scrollDiagRenderStart = _agScrollDiagnosticActive() ? performance.now() : 0;
    _agArtworkDiagnosticsBump('virtualRenderCount');
    if (forceRemeasure) _agScrollDiagnosticCount('virtual.fullGridRenders');
    if (forceRemeasure) _agArtworkDiagnosticsBump('forcedVirtualRenderCount');
    if (typeof localStorage !== 'undefined' && localStorage.getItem('baddel_debug_vs') === '1') {
        const _dbgGrid     = document.getElementById('allGamesGrid');
        const _dbgScroller = _vs.scroller || document.getElementById('mainContentArea');
        console.log(
            `[VSDBG] _vsRender force=${forceRemeasure} reason=${reason}`,
            `view=${typeof currentView !== 'undefined' ? currentView : '?'}`,
            `rti=${window.agReadyOnly || false} installedOnly=${window.agInstalledOnly || false}`,
            `scrollTop=${_dbgScroller?.scrollTop ?? '?'}`,
            `gridRectTop=${_dbgGrid?.getBoundingClientRect().top ?? '?'}`,
            '\n' + (new Error().stack?.split('\n').slice(1, 6).join('\n') || '')
        );
    }
    const grid = document.getElementById('allGamesGrid');
    const scroller = _vs.scroller || document.getElementById('mainContentArea');
    if (!grid || !scroller || _vs.items.length === 0) return;
    const view = document.getElementById('allGamesView');
    if (window._agDisplayPrefs?.viewMode !== 'grid'
        || (typeof currentView !== 'undefined' && currentView !== 'all-games')
        || view?.style.display === 'none'
        || getComputedStyle(grid).display === 'none') return;

    // Measure on first render or when forced (filter/resize)
    if (forceRemeasure || _vs.cols === 0) {
        const m = _vsMeasure(grid);
        if (!m) {
            _vs.cols = 0;
            _vs.rowH = 0;
            _vs._gridTopDirty = true;
            return;
        }
        _vs.cols = m.cols;
        _vs.rowH = m.rowH;
        _vs.scroller = scroller;

        // Set grid to position:relative with total phantom height
        const totalRows = Math.ceil(_vs.items.length / _vs.cols);
        _vs.totalHeight = _agComputeVirtualTotalHeight(_vs.items.length);
        _agApplyVirtualGridGeometry(grid);

        // Detach row wrappers while preserving reusable card DOM nodes.
        _vsReleaseAllRows();
        _vs.renderedStart = -1;
        _vs.renderedEnd = -1;

        // Mark gridTop as needing a re-measure on next layout pass
        _vs._gridTopDirty = true;
    }

    // ── Cache gridTop — read once per remeasure, not every scroll frame ──────
    // We read it here only when dirty (first render, resize, or dataset change).
    // Subsequent scroll frames skip the getBoundingClientRect() call entirely.
    if (_vs._gridTopDirty) {
        _vs._gridTop = grid.getBoundingClientRect().top
            - scroller.getBoundingClientRect().top
            + scroller.scrollTop;
        _vs._gridTopDirty = false;
    }

    const totalRows = Math.ceil(_vs.items.length / _vs.cols);
    _vs.totalHeight = _agComputeVirtualTotalHeight(_vs.items.length);
    _agApplyVirtualGridGeometry(grid);
    const scrollTop = scroller.scrollTop;

    // ── Scroll-speed tracking ─────────────────────────────────────────────────
    const previousScrollTop = Number(_vs._lastScrollTop || 0);
    const scrollDirection = scrollTop > previousScrollTop ? 1 : (scrollTop < previousScrollTop ? -1 : (_vs._lastScrollDirection || 1));
    _vs._lastScrollDirection = scrollDirection;
    const scrollDelta = Math.abs(scrollTop - previousScrollTop);
    _vs._lastScrollTop = scrollTop;
    // Exponential moving average — fast scroll → high speed, settle → decays to 0
    _vs._scrollSpeed = _vs._scrollSpeed * 0.6 + scrollDelta * 0.4;
    if (!_vs._isFastScrolling && _vs._scrollSpeed > AG_VS_FAST_ENTER_PX) _vs._isFastScrolling = true;
    else if (_vs._isFastScrolling && _vs._scrollSpeed < AG_VS_FAST_LEAVE_PX) _vs._isFastScrolling = false;
    const isFastScrolling = _vs._isFastScrolling;

    const viewportH = scroller.clientHeight;

    // Stable buffer with hysteresis: avoid 2↔8+ row expansion thrash while scrolling.
    const BUFFER_ROWS = isFastScrolling ? AG_VS_FAST_BUFFER_ROWS : AG_VS_NORMAL_BUFFER_ROWS;

    // Which rows are visible?
    const relScroll = Math.max(0, scrollTop - _vs._gridTop);
    const firstVisRow = Math.max(0, Math.floor(relScroll / _vs.rowH));
    const lastVisRow  = Math.min(totalRows - 1, Math.ceil((relScroll + viewportH) / _vs.rowH));

    const firstVisibleRow = Math.max(0, firstVisRow - BUFFER_ROWS);
    const lastVisibleRow  = Math.min(totalRows - 1, lastVisRow + BUFFER_ROWS);

    // Nothing changed — skip all DOM work. Scroll-settle is tracked in _vsOnScroll().
    if (firstVisibleRow === _vs.renderedStart && lastVisibleRow === _vs.renderedEnd) {
        _agRefreshArtworkDiagnostics();
        _agScrollDiagnosticCount('virtual.skippedRangePatches');
        _agLogScrollPerf({
            reason,
            rowMounts: 0,
            rowRemovals: 0,
            bufferRows: BUFFER_ROWS,
            scrollSpeed: Math.round(_vs._scrollSpeed),
            fast: isFastScrolling,
            skipped: true,
            liveRows: _vs.cardPool.size,
            cardCacheSize: _vs.cardCache.size,
            totalHeight: Math.round(_vs.totalHeight || 0),
        });
        if (!isFastScrolling) {
            _agScheduleColdCoverPriorityBoost(
                _vsCollectGamesInRows(firstVisRow, lastVisRow),
                [],
                []
            );
        }
        if (__scrollDiagRenderStart) _agScrollDiagnosticPush('renderDurations', performance.now() - __scrollDiagRenderStart);
        return;
    }

    let rowRemovals = 0;
    let rowMounts = 0;

    // ── Remove rows that scrolled out of the buffer window ───────────────────
    for (const [rowIdx, rowEl] of _vs.cardPool) {
        if (rowIdx < firstVisibleRow || rowIdx > lastVisibleRow) {
            _vsReleaseRow(rowIdx, rowEl);
            _vs.cardPool.delete(rowIdx);
            rowRemovals++;
        }
    }

    if (rowRemovals) _agScrollDiagnosticCount('virtual.rowUnmounts', rowRemovals);

    // ── Mount rows that scrolled into the buffer window ───────────────────────
    // Collect games needing cover, separated by tier — queued AFTER the loop.
    const viewportNeedCover = [];   // Tier 1 — actually visible
    const bufferNeedCover   = [];   // Tier 2 — in render buffer but not visible

    const rowFragment = document.createDocumentFragment();

    for (let row = firstVisibleRow; row <= lastVisibleRow; row++) {
        if (_vs.cardPool.has(row)) {
            // Row already in DOM.  Promote visible blanks directly to Tier 1
            // so they aren't sitting behind buffer/background work that was
            // queued earlier.  Only do this when not fast-scrolling.
            if (!isFastScrolling && row >= firstVisRow && row <= lastVisRow) {
                const startIdx = row * _vs.cols;
                const endIdx = Math.min(_vs.items.length, startIdx + _vs.cols);
                for (let i = startIdx; i < endIdx; i++) {
                    const game   = _vs.items[i];
                    const gameId = String(game.id || game.appName || game.title || '');
                    if (_agCanQueueCover(game, gameId)) {
                        viewportNeedCover.push(game);
                    }
                }
            }
            continue;
        }

        const startIdx = row * _vs.cols;
        const endIdx = Math.min(_vs.items.length, startIdx + _vs.cols);
        const rowGames = _vs.items.slice(startIdx, endIdx);

        // Create a row wrapper positioned absolutely
        const rowEl = document.createElement('div');
        rowEl.style.cssText = `position:absolute;top:${row * _vs.rowH}px;left:0;right:0;display:grid;grid-template-columns:repeat(${_vs.cols},1fr);gap:${_vs.gap}px;`;

        const isVisibleRow = row >= firstVisRow && row <= lastVisRow;

        const boundKeys = [];
        rowGames.forEach((game) => {
            const gameId = _agGameKey(game);
            const card = _vsAcquireCard(game);
            const coverApplied = !!card._vsLastCoverApplied;

            rowEl.appendChild(card);
            boundKeys.push(gameId);

            if (coverApplied) {
                _vs._coverQueued.delete(gameId);
                return;
            }

            // Collect cover work — do NOT queue inside this hot loop
            if (_agCanQueueCover(game, gameId)) {
                if (isVisibleRow) {
                    viewportNeedCover.push(game);
                } else {
                    bufferNeedCover.push(game);
                }
            }
        });
        _vs.rowBindings.set(row, boundKeys);

        rowFragment.appendChild(rowEl);
        _vs.cardPool.set(row, rowEl);
        rowMounts++;
    }

    if (rowMounts) grid.appendChild(rowFragment);

    _vs.renderedStart = firstVisibleRow;
    _vs.renderedEnd   = lastVisibleRow;
    if (rowMounts || rowRemovals) {
        _agScrollDiagnosticCount('virtual.incrementalRangePatches');
        _agScrollDiagnosticCount('virtual.rowMounts', rowMounts);
        const activeDiag = _agScrollDiagnosticActive();
        if (activeDiag) {
            activeDiag.max.rowPatchSize = Math.max(activeDiag.max.rowPatchSize, rowMounts + rowRemovals);
            activeDiag.ranges.push({
                atMs: Math.round(performance.now() - activeDiag.startedAt),
                firstVisRow,
                lastVisRow,
                firstVisibleRow,
                lastVisibleRow,
                rowMounts,
                rowRemovals,
                cardPoolSize: _vs.cardPool.size,
                mountedCards: document.getElementById('allGamesGrid')?.querySelectorAll?.('.game-card')?.length || 0,
                fast: isFastScrolling,
            });
        }
    }

    // ── Defer all cover queue work outside the hot render path ───────────────
    if (viewportNeedCover.length || bufferNeedCover.length) {
        if (isFastScrolling) {
            // Un-mark so settle timer can re-queue them correctly
            viewportNeedCover.forEach(g => _vs._coverQueued.delete(String(g.id || g.appName || g.title || '')));
            bufferNeedCover.forEach(g =>   _vs._coverQueued.delete(String(g.id || g.appName || g.title || '')));
        } else {
            _vsScheduleCoverWork(viewportNeedCover, bufferNeedCover);
        }
    }

    if (_vs.cardCache.size !== _vs.visibleCardsByGameId.size) {
        _agBoundCardCacheToMountedRows();
    }

    if (!isFastScrolling) {
        _agScheduleColdCoverPriorityBoost(
            _vsCollectGamesInRows(firstVisRow, lastVisRow),
            [
                ..._vsCollectGamesInRows(firstVisibleRow, firstVisRow - 1),
                ..._vsCollectGamesInRows(lastVisRow + 1, lastVisibleRow),
            ],
            []
        );
    }

    const nearRows = isFastScrolling ? 1 : 2;
    if (scrollDirection >= 0) {
        _vsBindCoversForRows(firstVisRow, Math.min(totalRows - 1, lastVisRow + nearRows), firstVisRow, lastVisRow);
    } else {
        _vsBindCoversForRows(Math.max(0, firstVisRow - nearRows), lastVisRow, firstVisRow, lastVisRow);
    }

    _agRefreshArtworkDiagnostics();
    _agLogScrollPerf({
        reason,
        rowMounts,
        rowRemovals,
        bufferRows: BUFFER_ROWS,
        scrollSpeed: Math.round(_vs._scrollSpeed),
        fast: isFastScrolling,
        range: `${firstVisibleRow}-${lastVisibleRow}`,
        liveRows: _vs.cardPool.size,
        cardCacheSize: _vs.cardCache.size,
        visibleCards: _vs.visibleCardsByGameId.size,
        totalHeight: Math.round(_vs.totalHeight || 0),
    });
    if (__scrollDiagRenderStart) _agScrollDiagnosticPush('renderDurations', performance.now() - __scrollDiagRenderStart);
}
window._vsRender = _vsRender;

function _vsCollectGamesInRows(fromRow, toRow) {
    const out = [];
    if (!_vs.items.length || !_vs.cols) return out;
    const first = Math.max(0, Number(fromRow) || 0);
    const last = Math.min(Math.ceil(_vs.items.length / _vs.cols) - 1, Number(toRow) || 0);
    for (let row = first; row <= last; row++) {
        const startIdx = row * _vs.cols;
        const endIdx = Math.min(_vs.items.length, startIdx + _vs.cols);
        for (let i = startIdx; i < endIdx; i++) {
            const game = _vs.items[i];
            if (game && !_agHasLocalCover(game)) out.push(game);
        }
    }
    return out;
}

function _agScheduleColdCoverPriorityBoost(viewportGames = [], bufferGames = [], prefetchGames = []) {
    if (!window.electronAPI?.boostColdCoverBootstrap) return;
    const compact = (items) => {
        const seen = new Set();
        const out = [];
        for (const game of Array.isArray(items) ? items : []) {
            const key = _agArtworkKey(game) || _agGameKey(game);
            if (!key || seen.has(key) || _agHasLocalCover(game)) continue;
            seen.add(key);
            out.push(game);
        }
        return out;
    };
    const visible = compact(viewportGames);
    const buffer = compact(bufferGames);
    const prefetch = compact(prefetchGames);
    if (!visible.length && !buffer.length && !prefetch.length) return;

    window.__agColdCoverBoost = window.__agColdCoverBoost || { timer: null, visible: new Map(), buffer: new Map(), prefetch: new Map(), signature: '' };
    const state = window.__agColdCoverBoost;
    visible.forEach(game => state.visible.set(_agArtworkKey(game) || _agGameKey(game), game));
    buffer.forEach(game => {
        const key = _agArtworkKey(game) || _agGameKey(game);
        if (!state.visible.has(key)) state.buffer.set(key, game);
    });
    prefetch.forEach(game => {
        const key = _agArtworkKey(game) || _agGameKey(game);
        if (!state.visible.has(key) && !state.buffer.has(key)) state.prefetch.set(key, game);
    });

    const signature = [state.visible, state.buffer, state.prefetch]
        .map(map => Array.from(map.keys()).sort().join(','))
        .join('|');
    if (signature === state.signature && state.timer) return;
    state.signature = signature;
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
        state.timer = null;
        const flushVisible = Array.from(state.visible.values());
        const flushBuffer = Array.from(state.buffer.values());
        const flushPrefetch = Array.from(state.prefetch.values());
        state.visible.clear();
        state.buffer.clear();
        state.prefetch.clear();
        const restoreThenBoost = async (games, priority) => {
            if (!games.length) return;
            // A bootstrap cache hit does not emit a download-completed event.
            // Restore these rows directly instead of waiting for sequential
            // whole-library hydration to eventually reach the viewport.
            try {
                if (await _agApplyBulkCachedCovers(games, `all-games-${priority}-cache`)) {
                    _agRebindCachedCards(games);
                }
            } catch (_) { /* A failed cache lookup must not prevent downloading. */ }
            const missing = games.filter(game => !_agHasLocalCover(game));
            if (missing.length) await window.electronAPI.boostColdCoverBootstrap(missing, {
                priority, reason: `all-games-${priority}-artwork`,
            });
        };
        // Finish the viewport lookup before admitting lower-priority reads.
        // Concurrent buffer/prefetch IPC used to delay the visible response.
        restoreThenBoost(flushVisible, 'visible').catch(() => {})
            .then(() => restoreThenBoost(flushBuffer, 'buffer')).catch(() => {})
            .then(() => restoreThenBoost(flushPrefetch, 'prefetch')).catch(() => {});
    }, 75);
}
/**
 * Defer cover work out of the scroll frame.
 * viewportNeedCover → Tier 1 (viewport queue) via tight setTimeout(0)
 * bufferNeedCover   → Tier 2 (buffer queue) via idle callback
 */
function _vsScheduleCoverWork(viewportNeedCover, bufferNeedCover) {
    if (viewportNeedCover.length) {
        // Tight defer so viewport cards appear fast even without idle time
        setTimeout(() => {
            _agEnqueueByPriority(viewportNeedCover, null, null);
        }, 0);
    }
    if (bufferNeedCover.length) {
        const enqueueBuffer = () => _agEnqueueByPriority(null, bufferNeedCover, null);
        if (typeof requestIdleCallback !== 'undefined') {
            requestIdleCallback(enqueueBuffer, { timeout: 400 });
        } else {
            setTimeout(enqueueBuffer, 50);
        }
    }
}

/**
 * Called once scroll settles (~150 ms after last scroll event).
 * Routes unresolved games into the correct tier:
 *   - Tier 1 (viewport): actually visible rows
 *   - Tier 2 (buffer):   rows in the render buffer around the viewport
 *   - Tier 3 (background): far prefetch rows
 */
function _vsOnScrollSettle() {
    const grid = document.getElementById('allGamesGrid');
    const scroller = _vs.scroller;
    if (!grid || !scroller || _vs.items.length === 0) return;

    const totalRows = Math.ceil(_vs.items.length / _vs.cols);
    const scrollTop = scroller.scrollTop;
    const viewportH = scroller.clientHeight;
    const rowsPerViewport = Math.ceil(viewportH / (_vs.rowH || 1));
    const BUFFER_ROWS  = AG_VS_NORMAL_BUFFER_ROWS;
    const PREFETCH_ROWS = Math.max(6, Math.ceil(rowsPerViewport * 1.0));

    const relScroll    = Math.max(0, scrollTop - _vs._gridTop);
    const firstVisRow  = Math.max(0, Math.floor(relScroll / _vs.rowH));
    const lastVisRow   = Math.min(totalRows - 1, Math.ceil((relScroll + viewportH) / _vs.rowH));
    const firstBufRow  = Math.max(0, firstVisRow - BUFFER_ROWS);
    const lastBufRow   = Math.min(totalRows - 1, lastVisRow + BUFFER_ROWS);
    const firstPrefRow = Math.max(0, firstBufRow - PREFETCH_ROWS);
    const lastPrefRow  = Math.min(totalRows - 1, lastBufRow + PREFETCH_ROWS);

    const viewportNeedCover   = [];
    const bufferNeedCover     = [];
    const prefetchNeedCover   = [];

    const collect = (fromRow, toRow, bucket) => {
        for (let row = fromRow; row <= toRow; row++) {
            const startIdx = row * _vs.cols;
            const endIdx = Math.min(_vs.items.length, startIdx + _vs.cols);
            for (let i = startIdx; i < endIdx; i++) {
                const game   = _vs.items[i];
                const gameId = String(game.id || game.appName || game.title || '');
                if (_agCanQueueCover(game, gameId)) {
                    bucket.push(game);
                }
            }
        }
    };

    // Tier 1 — only the viewport rows
    collect(firstVisRow, lastVisRow, viewportNeedCover);
    // Tier 2 — buffer rows (excluding viewport already collected)
    collect(firstBufRow,  firstVisRow - 1, bufferNeedCover);
    collect(lastVisRow + 1, lastBufRow,    bufferNeedCover);
    // Tier 3 — prefetch rows beyond buffer
    collect(firstPrefRow, firstBufRow - 1, prefetchNeedCover);
    collect(lastBufRow  + 1, lastPrefRow,  prefetchNeedCover);

    _agScheduleColdCoverPriorityBoost(
        _vsCollectGamesInRows(firstVisRow, lastVisRow),
        [
            ..._vsCollectGamesInRows(firstBufRow, firstVisRow - 1),
            ..._vsCollectGamesInRows(lastVisRow + 1, lastBufRow),
        ],
        [
            ..._vsCollectGamesInRows(firstPrefRow, firstBufRow - 1),
            ..._vsCollectGamesInRows(lastBufRow + 1, lastPrefRow),
        ]
    );

    // Viewport fires immediately; buffer/prefetch deferred to idle
    if (viewportNeedCover.length) {
        setTimeout(() => _agEnqueueByPriority(viewportNeedCover, null, null), 0);
    }
    const enqueueLower = () => _agEnqueueByPriority(null, bufferNeedCover, prefetchNeedCover);
    if (bufferNeedCover.length || prefetchNeedCover.length) {
        if (typeof requestIdleCallback !== 'undefined') {
            requestIdleCallback(enqueueLower, { timeout: 600 });
        } else {
            setTimeout(enqueueLower, 80);
        }
    }
}

/** Throttled scroll handler using rAF */
function _vsOnScroll() {
    const __scrollDiagHandlerStart = _agScrollDiagnosticActive() ? performance.now() : 0;
    _agScrollDiagnosticCount('scroll.handlerInvocations');
    _vs._isScrolling = true;
    _agSetActiveScrollState(true);
    if (_vs._scrollSettleTimer) clearTimeout(_vs._scrollSettleTimer);
    _vs._scrollSettleTimer = setTimeout(() => {
        _vs._isScrolling = false;
        _vs._isFastScrolling = false;
        _vs._scrollSpeed = 0;
        _agSetActiveScrollState(false);
        _vsOnScrollSettle();
    }, AG_VS_SCROLL_SETTLE_MS);

    if (_vs.raf) {
        if (__scrollDiagHandlerStart) {
            const __dt = performance.now() - __scrollDiagHandlerStart;
            _agScrollDiagnosticCount('scroll.handlerTotalMs', __dt);
            _agScrollDiagnosticPush('scrollHandlerDurations', __dt);
        }
        return;
    }
    if (__scrollDiagHandlerStart) {
        const __dt = performance.now() - __scrollDiagHandlerStart;
        _agScrollDiagnosticCount('scroll.handlerTotalMs', __dt);
        _agScrollDiagnosticPush('scrollHandlerDurations', __dt);
    }
    _vs.raf = requestAnimationFrame(() => {
        _vs.raf = null;
        _vsRender(false, 'scroll');
    });
}

/** Initialize or reinitialize virtual scroll with a new dataset */
function _vsInit(items, resetScroll = true) {
    items = Array.isArray(items) ? items : [];
    const prevKeys = _agItemKeyList(_vs.items);
    const newKeys = _agItemKeyList(items);
    const sameOrderedDataset = prevKeys.length === newKeys.length && prevKeys.every((id, idx) => id === newKeys[idx]);
    const anchor = resetScroll ? null : _agCaptureVirtualScrollAnchor(_vs.items);

    _agPruneCardCacheForItems(items);
    _vs.items = items;
    _vs.dataRevision += 1;
    _vs.lifecycle = items.length ? 'warm' : 'uninitialized';
    _vs.scroller = _vs.scroller || document.getElementById('mainContentArea');

    const grid = document.getElementById('allGamesGrid');
    const scroller = document.getElementById('mainContentArea');
    if (!grid || !scroller) return;
    _vs.scroller = scroller;

    if (!_vs._scrollBound) {
        scroller.addEventListener('scroll', _vsOnScroll, { passive: true });
        window.addEventListener('resize', () => {
            _vs._gridTopDirty = true;
            const view = document.getElementById('allGamesView');
            if (_vs.items.length > 0
                && window._agDisplayPrefs?.viewMode === 'grid'
                && (typeof currentView === 'undefined' || currentView === 'all-games')
                && view?.style.display !== 'none') {
                _vsRender(true, 'window-resize');
            }
        });
        _vs._scrollBound = true;
    }

    if (!items.length) {
        _vs.totalHeight = 0;
        _vs.renderedStart = -1;
        _vs.renderedEnd = -1;
        _vsReleaseAllRows();
        return;
    }

    grid.classList.remove('ag-empty-mode', 'ag-ready-empty-grid');
    grid.style.position = 'relative';
    if (window._agDisplayPrefs?.viewMode !== 'grid') return;

    const needsMeasure = resetScroll || _vs.cols === 0 || _vs.rowH === 0;
    if (needsMeasure) {
        const m = _vsMeasure(grid);
        if (!m) {
            _vs.cols = 0;
            _vs.rowH = 0;
            _vs._gridTopDirty = true;
            return;
        }
        _vs.cols = m.cols;
        _vs.rowH = m.rowH;
        _vs._gridTopDirty = true;
    }

    _vs.totalHeight = _agComputeVirtualTotalHeight(items.length);
    _agApplyVirtualGridGeometry(grid);

    if (_vs._gridTopDirty) {
        _vs._gridTop = grid.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
        _vs._gridTopDirty = false;
    }

    if (sameOrderedDataset && !resetScroll) {
        _agRebindCachedCards(items);
        _agEnsureVirtualGridIntegrity('vs-update-same-dataset');
        _vsRender(false, 'vs-update-same-dataset');
        return;
    }

    _vsReleaseAllRows();
    _vs.renderedStart = -1;
    _vs.renderedEnd = -1;
    _vs._lastScrollTop = scroller.scrollTop || 0;
    _vs._scrollSpeed = 0;
    _vs._isScrolling = false;
    _vs._isFastScrolling = false;
    _agSetActiveScrollState(false);
    if (_vs._scrollSettleTimer) { clearTimeout(_vs._scrollSettleTimer); _vs._scrollSettleTimer = null; }

    if (resetScroll) {
        scroller.scrollTop = 0;
    } else {
        _agRestoreVirtualScrollAnchor(anchor, items);
    }

    _vsRender(false, 'vs-init');
}

/** The main entry point — replaces old _renderAllGamesGrid */
function _renderAllGamesGrid(games, resetScroll = true, fullReset = false) {
    const grid = document.getElementById('allGamesGrid');
    if (!grid) return;
    if (typeof localStorage !== 'undefined' && localStorage.getItem('baddel_debug_vs') === '1') {
        console.log(
            `[VSDBG] _renderAllGamesGrid games=${games?.length ?? 0} resetScroll=${resetScroll} fullReset=${fullReset}`,
            '\n' + (new Error().stack?.split('\n').slice(1, 6).join('\n') || '')
        );
    }

    const hasGames = Array.isArray(games) && games.length > 0;
    _agResetAllGamesGridMode({ preserveVirtualGrid: hasGames && _agShouldPreserveVirtualGrid() });
    grid.classList.remove('ag-ready-empty-grid');

    if (fullReset) {
        _vsReleaseAllRows();
        _vs.freeCards.length = 0;
        _vs.cardCache.clear();
        _vs._coverQueued.clear();
    }

    if (!hasGames) {
        if (window._agNoLinkedAccounts) return;
        grid.style.minHeight = '';
        grid.style.height = '';
        grid.style.position = '';
        _vs.items = [];
        _vs.totalHeight = 0;
        _vs.lifecycle = 'uninitialized';
        _vs.cols = 0;
        _vs.renderedStart = -1;
        _vs.renderedEnd = -1;
        _vsReleaseAllRows();
        _vs._gridTopDirty = true;
        if (_vs._scrollSettleTimer) {
            clearTimeout(_vs._scrollSettleTimer);
            _vs._scrollSettleTimer = null;
        }
        if (window.agReadyOnly) {
            grid.classList.add('ag-ready-empty-grid');
            grid.innerHTML = `
                <div class="empty-state ag-inline-empty">
                    <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="8" y1="12" x2="16" y2="12"></line>
                    </svg>
                    <div class="empty-title">... It's quiet in here ...</div>
                    <div class="empty-subtext">No ready-to-install games found. Try changing your filters or sync a connected library.</div>
                    <div class="ag-inline-empty-actions">
                        <button class="ag-pc-btn" onclick="syncEmptyLibraryPlatform('steam')">Sync Steam</button>
                        <button class="ag-pc-btn" onclick="syncEmptyLibraryPlatform('epic')">Sync Epic</button>
                        <button class="ag-pc-btn" onclick="syncEmptyLibraryPlatform('gog')">Sync GOG</button>
                    </div>
                </div>
            `;
        } else {
            grid.innerHTML = `
                <div class="empty-state ag-inline-empty">
                    <div class="empty-title">No games found.</div>
                    <div class="empty-subtext">Sync a connected library to refresh your games.</div>
                    <div class="ag-inline-empty-actions">
                        <button class="ag-pc-btn" onclick="syncEmptyLibraryPlatform('steam')">Sync Steam</button>
                        <button class="ag-pc-btn" onclick="syncEmptyLibraryPlatform('epic')">Sync Epic</button>
                        <button class="ag-pc-btn" onclick="syncEmptyLibraryPlatform('gog')">Sync GOG</button>
                    </div>
                </div>`;
        }
        _updateAgCount(0);
        return;
    }

    if (grid.querySelector('.ag-route-skeleton, .ag-stable-loading-panel, .accounts-loading, .accounts-empty, .empty-state')) {
        grid.innerHTML = '';
    }

    _updateAgCount(games.length);
    _vsInit(games, resetScroll);
    _agUnlockAllGamesLayout();
}

function _updateAgCount(n) {
    const el = document.getElementById('agResultCount');
    if (el) el.textContent = n > 0 ? `${n} games` : '';
}

// ── Filter + Sort state ────────────────────────────────────────
window._agState = { platform: 'all', sort: 'title_asc', search: '', account: 'all' };

window.setAgPlatformFilter = function(platform, btn) {
    window.electronAPI?.trackFeatureEvent?.('filter_changed', { feature: 'all_games', filter: 'platform', platform }).catch?.(() => {});
    window._agState.platform = platform;
    document.querySelectorAll('.ag-pill').forEach(p => p.classList.remove('active'));
    if (btn) btn.classList.add('active');
    _applyAgFilters();
};

window.setAgSort = function(value) {
    window.electronAPI?.trackFeatureEvent?.('sort_changed', { feature: 'all_games', sort: value }).catch?.(() => {});
    window._agState.sort = value;
    _applyAgFilters();
};

window.setAgAccountFilter = function(value, labelText) {
    window.electronAPI?.trackFeatureEvent?.('filter_changed', { feature: 'all_games', filter: 'account', mode: value === 'all' ? 'all' : 'single' }).catch?.(() => {});
    const normalizedValue = value || 'all';
    window._agState.account = normalizedValue;
    const selectedText = document.getElementById('selectedAgAccountText');
    if (selectedText) {
        selectedText.innerText = labelText || 'All Accounts';
    }
    const menu = document.getElementById('agAccountMenu');
    if (menu) menu.classList.remove('active');
    _applyAgFilters();
};

window.toggleAgAccountDropdown = function(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('agAccountMenu');
    if (!menu) return;
    // Close all other AG-namespaced menus only — no reference to Installed/legacy IDs.
    document.getElementById('agSortMenu')?.classList.remove('active');
    document.getElementById('agDisplayPanel')?.classList.remove('active');
    document.getElementById('agPlatformMenu')?.classList.remove('active');
    menu.classList.toggle('active');
};

document.addEventListener('click', (e) => {
    if (!e.target.closest('#agAccountDropdown')) {
        document.getElementById('agAccountMenu')?.classList.remove('active');
    }
});

window.filterAllGames = function() {
    window._agState.search = (document.getElementById('allGamesSearch')?.value || '').toLowerCase();
    // Update search clear button visibility
    if (typeof window._agUpdateSearchClear === 'function') window._agUpdateSearchClear();
    _applyAgFilters();
    clearTimeout(window._agAnalyticsSearchTimer);
    window._agAnalyticsSearchTimer = setTimeout(() => {
        window.electronAPI?.trackFeatureEvent?.('search_used', { feature: 'all_games', query_present: Boolean(window._agState.search) }).catch?.(() => {});
    }, 700);
};

// ── Installed-resolution map ──────────────────────────────────────────────────
// Built once per filter pass from window.allGamesData (which app.js now keeps
// synchronized on every assignment).  Maps every stable key we can derive from
// a local game entry → boolean (true = has path or command = truly installed).
// This replaces the old per-game find() scan which failed because:
//   • it only checked 3 keys (id, "epic-<appName>", exact name)
//   • window.allGamesData was never populated by app.js (fixed there now)

let _agInstalledMap    = null;   // Map<lowerKey, boolean> | null
let _agInstalledMapSrc = null;   // identity ref — rebuilt when array changes

function _agBuildInstalledMap() {
    const local = window.allGamesData;
    if (!Array.isArray(local)) return new Map();

    // Reuse cache as long as the same array instance is referenced.
    if (_agInstalledMap && _agInstalledMapSrc === local) return _agInstalledMap;

    const map = new Map();

    const set = (key, installed) => {
        if (!key) return;
        const k = String(key).toLowerCase().trim();
        if (!k) return;
        // Only upgrade false → true, never downgrade.
        if (!map.has(k) || installed) map.set(k, installed);
    };

    local.forEach(g => {
        const installed = !!(g.path || g.command || g.launchCommand || g.executablePath || g.installVerified || g.isInstalled);

        set(g.id, installed);

        // Normalised title — kept as last-resort for main-game matching.
        // Variants (demo, creator kit, …) are guarded on the probe side so
        // a base-game cleanTitle cannot make a variant appear installed.
        const cleanTitle = (g.name || g.title || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
        set(cleanTitle, installed);

        // "epic-<x>" prefixed variants that scanners produce
        if (g.appName) set(`epic-${g.appName}`, installed);
        if (g.id)      set(`epic-${g.id}`,      installed);

        // allIds — only store Steam app ID (product-specific).
        // DO NOT store allIds.epic: on Epic, allIds.epic equals the catalog
        // namespace which is a publisher-level field shared by all offers in
        // the same product (base game, demo, Creator Kit, DLC). Storing it
        // causes any variant of an installed game to appear installed.
        if (g.allIds?.steam) set(g.allIds.steam, installed);

        // appName is per-product on Epic (unlike namespace which is per-publisher)
        if (g.appName) set(g.appName, installed);

        // INTENTIONALLY NOT stored:
        //   g.namespace   — Epic publisher/product namespace; shared across all
        //                   offers (base game + demo + Creator Kit + …).
        //   g.allIds.epic — equals namespace for Epic games; same false-positive risk.
    });

    _agInstalledMap    = map;
    _agInstalledMapSrc = local;
    return map;
}

/**
 * Returns true when an All-Games entry matches any truly-installed local entry.
 * "Installed" = local entry has a launch target or verified installed marker (same rule as Game Details).
 */
function _agIsInstalled(game) {
    const map = _agBuildInstalledMap();
    if (!map.size) return false;

    const probe = (key) => {
        if (!key) return false;
        return map.get(String(key).toLowerCase().trim()) === true;
    };

    // 1. Exact game ID (stable hash or platform-specific ID)
    if (probe(game.id)) return true;

    // 2. cleanTitle fallback — ONLY for entries that classify as main games.
    //    Variant entries (demo, creator kit, tool, …) must match on exact identifiers
    //    only; the base game's cleanTitle must never make a variant appear installed.
    const classify = window._baddelClassifyVariant;
    const variantType = (typeof classify === 'function')
        ? classify(game.title || game.name || '')
        : 'main';
    if (variantType === 'main') {
        const cleanTitle = (game.title || game.name || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
        if (probe(cleanTitle)) return true;
    }

    // 3. Epic "epic-<appName>" / "epic-<id>" prefixed keys
    if (game.appName && probe(`epic-${game.appName}`)) return true;
    if (game.id      && probe(`epic-${game.id}`))      return true;

    // 4. Steam app ID from allIds (product-specific; safe)
    //    Skip allIds.epic — it equals the Epic namespace (publisher-level, shared
    //    between base game and all its variants) and would produce false positives.
    if (game.allIds?.steam && probe(game.allIds.steam)) return true;

    // 5. appName — per-product on Epic, per-appId string on Steam
    if (game.appName && probe(game.appName)) return true;

    // INTENTIONALLY NOT probed:
    //   game.namespace   — Epic publisher-level namespace; shared across all offers.
    //   game.allIds.epic — equals namespace for Epic games; same false-positive risk.

    return false;
}

// Pure filter/sort helper — no DOM writes. Accepts the base cache and whether
// the caller is already operating on the canonical RTI list so that RTI
// de-duplication is not applied twice.
function _agBuildFilteredPool({ cache, useCanonical }) {
    const { platform, sort, search, account } = window._agState || {};
    let pool = [...(Array.isArray(cache) ? cache : [])];

    if (platform !== 'all') {
        pool = pool.filter(g => Array.isArray(g.platforms) && g.platforms.includes(platform));
    }
    if (account && account !== 'all') {
        pool = pool.filter(g => Array.isArray(g.accountKeys) && g.accountKeys.includes(account));
    }
    if (window.agInstalledOnly) {
        pool = pool.filter(g => _agIsInstalled(g));
    }
    if (window.agReadyOnly && !useCanonical) {
        pool = pool.filter(g => !_agIsInstalled(g));
    }
    const searchTrim = (search || '').trim();
    if (searchTrim) {
        pool = pool.filter(g => (g.title || '').toLowerCase().includes(searchTrim));
    }
    if (sort === 'title_asc') {
        pool.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    } else if (sort === 'title_desc') {
        pool.sort((a, b) => (b.title || '').localeCompare(a.title || ''));
    } else if (sort === 'playtime_desc') {
        const playtimeOf = (game) => {
            if (typeof window._agFieldPlaytimeMinutes === 'function') {
                return Number(window._agFieldPlaytimeMinutes(game)) || 0;
            }
            return Number(game?.playtime || game?.totalPlaytime || 0) || 0;
        };
        const lastPlayedOf = (game) => {
            if (typeof window._agResolveLastPlayedTimestamp === 'function') {
                return Number(window._agResolveLastPlayedTimestamp(game)) || 0;
            }
            if (typeof window._agFieldLastPlayed === 'function') {
                return Number(window._agFieldLastPlayed(game)) || 0;
            }
            return Number(game?.lastQualifiedPlayed || game?.lastPlayed || 0) || 0;
        };
        const compareTitles = (a, b) => String(a.title || a.name || '').localeCompare(String(b.title || b.name || ''));
        // These resolvers can perform alias/local-install matching. Calling them
        // from the comparator repeats that work O(n log n) times and previously
        // degraded into multi-second sorts for large libraries.
        const metrics = new Map(pool.map(game => {
            const shared = typeof window._agPlaytimeSortMetrics === 'function'
                ? window._agPlaytimeSortMetrics(game)
                : { playtime: playtimeOf(game), lastPlayed: lastPlayedOf(game) };
            return [game, shared];
        }));
        pool.sort((a, b) => {
            const ptDiff = metrics.get(b).playtime - metrics.get(a).playtime;
            if (ptDiff !== 0) return ptDiff;
            const lpDiff = metrics.get(b).lastPlayed - metrics.get(a).lastPlayed;
            if (lpDiff !== 0) return lpDiff;
            return compareTitles(a, b);
        });
    } else if (sort === 'multi_first') {
        pool.sort((a, b) =>
            (b.platforms?.length || 0) - (a.platforms?.length || 0) ||
            (a.title || '').localeCompare(b.title || ''));
    }
    return pool;
}

// Returns a stable string that uniquely describes the current rendered pool:
// mode, active filters, and the ordered game-ID list. Cover URLs are excluded
// because they are patched in-place and do not require a grid remount.
function _agComputePoolSignature(pool) {
    const mode = window.agReadyOnly ? 'rti' : 'all';
    const { platform, sort, search, account } = window._agState || {};
    const installedOnly = window.agInstalledOnly ? '1' : '0';
    const ids = Array.isArray(pool)
        ? pool.map(g => String(g.id ?? g.appName ?? g.title)).join(',')
        : '';
    return `${mode}|${platform ?? ''}|${sort ?? ''}|${search ?? ''}|${account ?? ''}|${installedOnly}|${ids}`;
}

function _applyAgFilters(options = {}) {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('baddel_debug_vs') === '1') {
        console.log(
            `[VSDBG] _applyAgFilters reason=${options.reason || 'user-action'} resetScroll=${options.resetScroll}`,
            `view=${typeof currentView !== 'undefined' ? currentView : '?'}`,
            `rti=${window.agReadyOnly || false}`,
            '\n' + (new Error().stack?.split('\n').slice(1, 6).join('\n') || '')
        );
    }
    // RTI guard: canonical state not ready — do not render stale pre-sync cache.
    if (window.agReadyOnly
        && typeof window.isCanonicalReadyToInstallReady === 'function'
        && !window.isCanonicalReadyToInstallReady()) {
        console.log('[ReadyCount] _applyAgFilters blocked RTI render; canonical not ready');
        if (_agHasWarmReadyToInstallProjection()) {
            _agEnsureVirtualGridIntegrity('warm-rti-canonical-pending');
            return false;
        }
        _agRenderReadyToInstallLoading();
        return;
    }

    // RTI canonical: use canonical list as the base pool to ensure consistent count.
    // Falls back to _allGamesCache if canonical is unavailable (should not happen post-guard).
    const useCanonical = window.agReadyOnly
        && typeof window.getCanonicalReadyToInstallGames === 'function'
        && window.isCanonicalReadyToInstallReady?.() === true;
    const canonicalGames = useCanonical ? window.getCanonicalReadyToInstallGames() : null;
    if (useCanonical && Array.isArray(canonicalGames)) {
        console.log('[ReadyCount] _applyAgFilters using canonical ready count=', canonicalGames.length);
    }

    // Always filter the cache to user-library games before rendering, so that
    // auto-scanned installed-only records (Xbox, MS Store, etc.) never appear
    // in All Games even if they were pushed into _allGamesCache by app.js patches.
    const cache = (useCanonical && Array.isArray(canonicalGames))
        ? canonicalGames
        : _agGetUserLibraryGames(window._allGamesCache || []);
    if (cache.length === 0 && window._agNoLinkedAccounts) {
        _agSetEmptyPageMode(true);
        _agSetToolbarVisible(false);
        _agRenderEmptyOnboarding();
        return;
    }
    if (window._agNoLinkedAccounts) return;
    const resetScroll = options.resetScroll !== false;
    // Invalidate installed-map if allGamesData reference changed since last build
    if (_agInstalledMapSrc !== window.allGamesData) {
        _agInstalledMap    = null;
        _agInstalledMapSrc = null;
    }

    const pool = _agBuildFilteredPool({ cache, useCanonical });

    // Keep _readyToInstallRenderedGames for view-state use only (not as canonical count source).
    if (window.agReadyOnly && !window._agState?.search?.trim()) {
        window._readyToInstallRenderedGames = pool;
    } else if (!window.agReadyOnly) {
        window._readyToInstallRenderedGames = null;
    }

    // Skip rerender when a background sync fires with an unchanged visible pool.
    const _newSig = _agComputePoolSignature(pool);
    const unchangedVisibleProjection = _newSig === window._agLastRenderedPoolSignature;
    const isBackgroundLibraryUpdate = String(options.reason || '').startsWith('background-library-updated');
    if ((isBackgroundLibraryUpdate || options.allowWarmReuse)
        && unchangedVisibleProjection) {
        if (typeof localStorage !== 'undefined' && localStorage.getItem('baddel_debug_vs') === '1') {
            console.log('[AllGames] visible projection unchanged; reused warm virtual grid:', options.reason || 'unknown');
        }
        _agRebindCachedCards(pool);
        _agEnsureVirtualGridIntegrity(options.reason || 'projection-unchanged');
        if (typeof window._vsRender === 'function') window._vsRender(false, options.reason || 'projection-unchanged');
        return false;
    }
    window._agLastRenderedPoolSignature = _newSig;

    _agPrioritizeFilteredPoolArtwork(pool);
    _renderAllGamesViewModeAware(pool, resetScroll);
    return true;
}

window.syncEmptyLibraryPlatform = function syncEmptyLibraryPlatform(platform) {
    const target = ['steam', 'epic', 'gog'].includes(String(platform || '').toLowerCase())
        ? String(platform).toLowerCase()
        : 'steam';
    if (typeof window.openPlatformsModal === 'function') window.openPlatformsModal(target);
};

// Display preference functions (AG_DISPLAY_DEFAULTS, _agLoadDisplayPrefs,
// _agSaveDisplayPrefs, _agApplyDisplayPrefs, setAgViewMode, setAgDensity,
// setAgField) are defined in src/js/accounts/display-prefs.js.

// ── Search clear button ───────────────────────────────────────
window.agClearSearch = function() {
    const inp = document.getElementById('allGamesSearch');
    if (inp) { inp.value = ''; }
    const btn = document.getElementById('agSearchClear');
    if (btn) btn.style.display = 'none';
    if (typeof filterAllGames === 'function') filterAllGames();
};

window._agUpdateSearchClear = function() {
    const inp = document.getElementById('allGamesSearch');
    const btn = document.getElementById('agSearchClear');
    if (inp && btn) btn.style.display = inp.value ? 'flex' : 'none';
};

// ── Sticky toolbar IntersectionObserver ──────────────────────
window._agInitStickyToolbar = function() {
    const toolbar = document.getElementById('agToolbarSticky');
    if (!toolbar) return;
    // Insert a 1px sentinel directly above the sticky toolbar
    const sentinel = document.createElement('div');
    sentinel.id = 'agToolbarSentinel';
    sentinel.style.cssText = 'height:1px;pointer-events:none;';
    toolbar.parentNode.insertBefore(sentinel, toolbar);
    const scroller = document.getElementById('mainContentArea');
    if (!scroller) return;
    new IntersectionObserver(([entry]) => {
        toolbar.classList.toggle('is-stuck', !entry.isIntersecting);
    }, { root: scroller, threshold: 1, rootMargin: '0px 0px 0px 0px' }).observe(sentinel);
};

// ── Sort dropdown ─────────────────────────────────────────────
window.toggleAgSortDropdown = function(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('agSortMenu');
    if (!menu) return;
    // Close other dropdowns
    document.getElementById('agAccountMenu')?.classList.remove('active');
    document.getElementById('agDisplayPanel')?.classList.remove('active');
    menu.classList.toggle('active');
};

window.setAgSortCustom = function(value, label, itemEl) {
    // Update label
    const labelEl = document.getElementById('agSortLabel');
    if (labelEl) labelEl.textContent = label;
    // Active state on items
    document.querySelectorAll('.ag-sort-item').forEach(i => i.classList.remove('active'));
    if (itemEl) itemEl.classList.add('active');
    // Close menu
    document.getElementById('agSortMenu')?.classList.remove('active');
    // Delegate to existing sort logic
    window.setAgSort(value);
    // Persist sort choice
    try { localStorage.setItem('baddelSortPref', value); } catch(e) {}
};

// Restore sort label from persistent sort state
(function _restoreAgSortLabel() {
    const saved = (() => { try { return localStorage.getItem('baddelSortPref'); } catch(e) { return null; } })();
    if (!saved) return;
    const labels = { title_asc: 'A → Z', title_desc: 'Z → A', playtime_desc: 'Most Played', multi_first: 'Multi-Platform First' };
    const label = labels[saved];
    if (!label) return;
    // Will be re-applied once DOM is ready
    document.addEventListener('DOMContentLoaded', () => {
        const el = document.getElementById('agSortLabel');
        if (el) el.textContent = label;
        document.querySelectorAll('.ag-sort-item').forEach(i => {
            i.classList.toggle('active', i.dataset.value === saved);
        });
        if (window._agState) window._agState.sort = saved;
    });
})();

// ══════════════════════════════════════════════════════════════
// UNIFIED OUTSIDE-CLICK: close all menus when clicking outside
// ══════════════════════════════════════════════════════════════

// Bubble phase: close menus when clicking outside their wrappers.
// NOTE: No capture-phase stopPropagation needed — both panels live inside
// #agDisplayDropdown / #igDisplayDropdown, so the closest() guards below
// already keep panels open for in-panel clicks without blocking onclick handlers.
document.addEventListener('click', (e) => {
    if (!e.target.closest('#agSortDropdown')) {
        document.getElementById('agSortMenu')?.classList.remove('active');
    }
    if (!e.target.closest('#agDisplayDropdown')) {
        document.getElementById('agDisplayPanel')?.classList.remove('active');
        document.getElementById('agDisplayTrigger')?.classList.remove('active');
    }
    if (!e.target.closest('#igPlatformDropdown')) {
        document.getElementById('igPlatformMenu')?.classList.remove('active');
    }
    if (!e.target.closest('#igSortDropdown')) {
        document.getElementById('igSortMenu')?.classList.remove('active');
    }
    if (!e.target.closest('#igDisplayDropdown')) {
        document.getElementById('igDisplayPanel')?.classList.remove('active');
        document.getElementById('igDisplayTrigger')?.classList.remove('active');
    }
});

// toggleAgDisplayPanel is defined in src/js/accounts/display-prefs.js.

// ══════════════════════════════════════════════════════════════
// LIST VIEW RENDERER
// ══════════════════════════════════════════════════════════════
function _renderAllGamesList(games) {
    const container = document.getElementById('agListBody');
    if (!container) return;
    container.innerHTML = '';

    if (!games || games.length === 0) {
        container.innerHTML = `<div class="accounts-empty" style="padding:40px 0;"><p>No games found.</p></div>`;
        return;
    }

    const frag = document.createDocumentFragment();
    const prefs = window._agDisplayPrefs;

    games.forEach(game => {
        const rawId = String(game.id || game.appName || game.title || '');
        const isInstalled = _agIsInstalled(game);

        // Build platform badges HTML
        const visiblePlats = (game.platforms || []).slice(0, 4);
        const badgesHtml = visiblePlats.map(plat => {
            const m = PLAT_BADGE_META[plat] || { icon: null, invert: false, label: plat };
            return m.icon
                ? `<img src="${m.icon}" alt="${m.label}" class="ag-list-badge-img${m.invert ? ' ag-list-badge-img-invert' : ''}" title="${m.label}">`
                : `<span style="font-size:0.6rem;color:#555">${m.label}</span>`;
        }).join('');

        // Playtime — use cross-ID resolver so synced All Games entries reach the local record.
        const pt = (typeof window._agFieldPlaytimeMinutes === 'function')
            ? window._agFieldPlaytimeMinutes(game)
            : Number(game.playtime || game.totalPlaytime || 0) || 0;
        const ptStr = (typeof formatPlaytime === 'function')
            ? (pt > 0 ? formatPlaytime(pt) : '—')
            : (pt > 0 ? (pt >= 60 ? `${Math.floor(pt/60)}h ${pt%60}m` : `${pt}m`) : '—');

        // Last played — use resolver so synced entries see the real lastPlayed.
        const lp = (typeof window._agResolveLastPlayedTimestamp === 'function')
            ? window._agResolveLastPlayedTimestamp(game)
            : (typeof window._agFieldLastPlayed === 'function')
                ? window._agFieldLastPlayed(game)
                : (game.lastQualifiedPlayed || game.lastPlayed || game.last_played || null);
        const lpStr = (typeof formatLastPlayed === 'function')
            ? (lp ? formatLastPlayed(lp) : '—')
            : (lp ? new Date(lp).toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' }) : '—');

        // Cover
        const coverDecision = _agResolveAllGamesCoverDecision(game);
        const cover = coverDecision.value ? _agAttrUrl(coverDecision.value) : '';

        const row = document.createElement('div');
        row.className = 'ag-list-row';
        row.dataset.id = rawId;

        row.innerHTML = `
            <div class="ag-list-col ag-col-thumb">
                ${cover
                    ? `<img src="${cover}" alt="${(game.title||'').replace(/"/g,'&quot;')}" class="ag-list-thumb" loading="lazy" onerror="this.outerHTML=this.nextElementSibling.outerHTML;this.remove();">`
                    : ''
                }
                <div class="ag-list-thumb-placeholder" ${cover ? 'style="display:none"' : ''}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2a2a2a" stroke-width="1.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
                </div>
            </div>
            <div class="ag-list-col ag-col-title">
                <div class="ag-col-title-text">${game.title || ''}</div>
            </div>
            <div class="ag-list-col ag-col-platforms ag-list-field-platforms">
                <div class="ag-list-badges">${badgesHtml}</div>
            </div>
            <div class="ag-list-col ag-col-playtime ag-list-field-playtime">
                <div class="ag-col-meta">${ptStr}</div>
            </div>
            <div class="ag-list-col ag-col-lastplayed ag-list-field-lastPlayed">
                <div class="ag-col-meta">${lpStr}</div>
            </div>
            <div class="ag-list-col ag-col-installed ag-list-field-installed">
                <span class="ag-list-installed-icon${isInstalled ? ' is-installed' : ''}" title="${isInstalled ? 'Installed' : 'Not installed'}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/><polyline points="8 12 12 16 16 12"/><line x1="12" y1="3" x2="12" y2="16"/></svg>
                </span>
            </div>
        `;

        row.addEventListener('click', () => {
            if (typeof openGameDetails === 'function') openGameDetails(rawId);
        });

        frag.appendChild(row);
    });

    container.appendChild(frag);
}

// ── View-mode-aware render wrapper (replaces the old monkey-patch) ────────
// Holds a stable reference to the original grid renderer so the wrapper
// never calls itself (the previous patch reused the same name, causing
// infinite recursion in grid mode).
const _renderAllGamesGridBase = _renderAllGamesGrid;

function _renderAllGamesViewModeAware(games, resetScroll = true, fullReset = false) {
    const prefs = window._agDisplayPrefs;
    window._agApplyDisplayPrefs?.();

    if (prefs.viewMode === 'list') {
        _renderAllGamesList(games);
        _updateAgCount(games ? games.length : 0);
        // Keep _vs.items updated so filter state works when switching back
        _vs.items = games || [];
        return;
    }

    // Grid mode — delegate to the original, unpatched renderer
    _renderAllGamesGridBase(games, resetScroll, fullReset);
}

// ── Patch _updateAgCount (already defined above — just a safety bridge) ──
// (function already defined, no-op)

// ── Init display prefs on nav to All Games ────────────────────
const _origNavigateToAllGames_display = navigateToAllGames;
// We extend inside the async wrapper through a monkey-patch on the window
(function() {
    const _origNav = window.navigateToAllGames || navigateToAllGames;
    window.navigateToAllGames = async function(opts) {
        await _origNav(opts);
        window._agApplyDisplayPrefs?.();
        window._agSyncBackToTopVisibility?.();
    };
})();

// Also apply on DOMContentLoaded in case All Games is the first view
document.addEventListener('DOMContentLoaded', () => {
    window._agApplyDisplayPrefs?.();
    window._agInitBackToTop?.();
    // Init sticky toolbar observer
    if (typeof window._agInitStickyToolbar === 'function') window._agInitStickyToolbar();
    // Init search clear button visibility
    if (typeof window._agUpdateSearchClear === 'function') window._agUpdateSearchClear();
});

// ============================================================
// SECTION: INSTALLED GAMES VIEW
// Platform sync modal logic (activePlatformView through syncSinglePlatformAccount)
// is defined in src/js/accounts/platform-panels.js (loaded before this file).
// ============================================================

// Display preference functions (IG_DISPLAY_DEFAULTS, _igLoadDisplayPrefs,
// _igSaveDisplayPrefs, _igApplyDisplayPrefs, setIgViewMode, setIgDensity,
// setIgField) are defined in src/js/accounts/display-prefs.js.

// ── Sticky toolbar (IntersectionObserver, same pattern as All Games) ──
window._igInitStickyToolbar = function() {
    const toolbar = document.getElementById('igToolbarSticky');
    if (!toolbar) return;
    // Remove stale sentinel if re-entering the view
    document.getElementById('igToolbarSentinel')?.remove();
    const sentinel = document.createElement('div');
    sentinel.id = 'igToolbarSentinel';
    sentinel.style.cssText = 'height:1px;pointer-events:none;';
    toolbar.parentNode.insertBefore(sentinel, toolbar);
    const scroller = document.getElementById('mainContentArea');
    if (!scroller) return;
    new IntersectionObserver(([entry]) => {
        toolbar.classList.toggle('is-stuck', !entry.isIntersecting);
    }, { root: scroller, threshold: 1, rootMargin: '0px 0px 0px 0px' }).observe(sentinel);
};

// ── Search clear helper ───────────────────────────────────────
window.igClearSearch = function() {
    const inp = document.getElementById('searchInput');
    if (inp) inp.value = '';
    const btn = document.getElementById('igSearchClear');
    if (btn) btn.style.display = 'none';
    if (typeof filterGames === 'function') filterGames();
};

window.igUpdateSearchClear = function() {
    const inp = document.getElementById('searchInput');
    const btn = document.getElementById('igSearchClear');
    if (inp && btn) btn.style.display = inp.value ? 'flex' : 'none';
};

// toggleIgDisplayPanel is defined in src/js/accounts/display-prefs.js.

// ── IG Platform dropdown ──────────────────────────────────────
window.toggleIgPlatformDropdown = function(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('igPlatformMenu');
    if (!menu) return;
    document.getElementById('igSortMenu')?.classList.remove('active');
    document.getElementById('igDisplayPanel')?.classList.remove('active');
    document.getElementById('igDisplayTrigger')?.classList.remove('active');
    menu.classList.toggle('active');
};

window.igSelectPlatform = function(value, label) {
    document.getElementById('igSelectedPlatformText').textContent = label;
    document.getElementById('igPlatformMenu')?.classList.remove('active');
    if (typeof currentFilters !== 'undefined') {
        currentFilters.platform = value || 'all';
        // Keep collection scope when filtering inside Favorites or a custom collection.
        // Only clear collectionId when in the plain Installed view.
        if (typeof currentView === 'undefined' || currentView === 'installed') {
            currentFilters.collectionId = null;
        }
    }

    // Persist filter state for the Installed view only — not Favorites or collections.
    if (typeof currentView === 'undefined' || currentView === 'installed') {
        _igSaveFilterState();
    }
    try {
        if (typeof applyFilters === 'function') applyFilters();
        window._igApplyDisplayPrefs?.();

        const prefs = window._igDisplayPrefs;
        const filteredGames = _igGetCurrentFilteredGames();

        if (prefs && prefs.viewMode === 'list') {
            _renderInstalledGamesList(filteredGames);
        } else {
            // grid mode: ensure grid is visible (applyFilters already populated it)
            const grid = document.getElementById('gamesGrid');
            const listView = document.getElementById('igListView');
            if (grid) grid.style.display = '';
            if (listView) listView.style.display = 'none';
        }

        const countEl = document.getElementById('igResultCount');
        if (countEl) countEl.textContent = filteredGames.length > 0 ? `${filteredGames.length} games` : '';
    } catch (error) {
        console.error('[IG][PlatformFilter]', error, { value, label, currentFilters });
        const grid = document.getElementById('gamesGrid');
        if (grid) {
            grid.style.display = '';
            grid.innerHTML = `<div class="empty-state"><div class="empty-title">Filter error</div><div class="empty-subtext">Check console for details.</div></div>`;
        }
    }
};

// ── IG Sort dropdown ──────────────────────────────────────────
window.toggleIgSortDropdown = function(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('igSortMenu');
    if (!menu) return;
    document.getElementById('igPlatformMenu')?.classList.remove('active');
    document.getElementById('igDisplayPanel')?.classList.remove('active');
    document.getElementById('igDisplayTrigger')?.classList.remove('active');
    menu.classList.toggle('active');
};

window.igSelectSort = function(value, label, itemEl) {
    const labelEl = document.getElementById('igSortLabel');
    if (labelEl) labelEl.textContent = label;
    document.querySelectorAll('.ig-sort-item').forEach(i => i.classList.remove('active'));
    if (itemEl) itemEl.classList.add('active');
    document.getElementById('igSortMenu')?.classList.remove('active');
    if (typeof currentFilters !== 'undefined') {
        currentFilters.sort = value;
    }

    _igSaveFilterState();

    if (typeof applyFilters === 'function') applyFilters();
};

// ── IG Search ─────────────────────────────────────────────────
// igFilterGames: wraps app.js filterGames() + updates clear button
window.igFilterGames = function() {
    if (typeof filterGames === 'function') filterGames();

    _igSaveFilterState();

    window.igUpdateSearchClear?.();
};

// ── List renderer for Installed Games ────────────────────────
function _renderInstalledGamesList(games) {
    const container = document.getElementById('igListBody');
    if (!container) return;
    container.innerHTML = '';

    if (!games || games.length === 0) {
        container.innerHTML = `<div class="accounts-empty" style="padding:40px 0;"><p>No games found.</p></div>`;
        return;
    }

    const frag = document.createDocumentFragment();

    games.forEach(game => {
        const rawId = String(game.id || '');

        // Platform badge(s) — game.sources or fallback to game.platform
        const PLAT_META_IG = {
            steam:    { label: 'Steam',    icon: '../assets/Steam.png',    invert: false },
            epic:     { label: 'Epic',     icon: '../assets/epic.svg',     invert: true  },
            ea:       { label: 'EA',       icon: '../assets/ea.png',       invert: false },
            riot:     { label: 'Riot',     icon: '../assets/riot.png',     invert: false },
            ubisoft:  { label: 'Ubisoft',  icon: '../assets/Ubisoft_white.png', invert: false },
            rockstar: { label: 'Rockstar', icon: '../assets/rockstar.png', invert: false },
            xbox:     { label: 'Xbox',     icon: '../assets/Xbox_one_logo.png', invert: false },
            discord:  { label: 'Discord',  icon: '../assets/discord.png',  invert: false },
            gog:      { label: 'GOG',      icon: '../assets/gog.png',      invert: false },
            battlenet:{ label: 'Battle.net',icon:'../assets/battlenet.png',invert: false },
        };
        const ALIAS_IG = {
            'epic games':'epic','epicgames':'epic','ea app':'ea','ea games':'ea',
            'origin':'ea','riot games':'riot','ubisoft connect':'ubisoft','ubisoft+':'ubisoft',
            'rockstar games':'rockstar','rockstar launcher':'rockstar','xbox / store':'xbox',
            'xbox store':'xbox','ms store':'xbox','microsoft store':'xbox','store':'xbox',
            'gog galaxy':'gog','battle.net':'battlenet','battlenet':'battlenet','blizzard':'battlenet',
        };
        const normIG = (src) => {
            const r = (src || '').toLowerCase().trim();
            return PLAT_META_IG[r] ? r : (ALIAS_IG[r] || r);
        };

        const rawSrcs = (game.sources && Array.isArray(game.sources) && game.sources.length)
            ? game.sources
            : [game.platform || 'manual'];

        const badgesHtml = rawSrcs.slice(0, 3).map(src => {
            const key = normIG(src);
            const m   = PLAT_META_IG[key];
            return m
                ? `<img src="${m.icon}" alt="${m.label}" class="ag-list-badge-img${m.invert ? ' ag-list-badge-img-invert' : ''}" title="${m.label}">`
                : `<span style="font-size:0.6rem;color:#555">${src}</span>`;
        }).join('');

        // Playtime
        const pt = (typeof playtimeData !== 'undefined' && playtimeData[game.id])
            ? (playtimeData[game.id].totalMinutes || 0) : (game.playtime || 0);
        const ptStr = pt > 0 ? (pt >= 60 ? `${Math.floor(pt/60)}h ${pt%60}m` : `${pt}m`) : '—';

        // Last played
        const lpRaw = (typeof playtimeData !== 'undefined' && playtimeData[game.id])
            ? playtimeData[game.id].lastPlayed : null;
        const lpStr = lpRaw
            ? new Date(lpRaw).toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' })
            : '—';

        // Cover
        const coverDecision = _agResolveAllGamesCoverDecision(game);
        const cover = coverDecision.value || '';

        const row = document.createElement('div');
        row.className = 'ag-list-row';
        row.dataset.id = rawId;

        row.innerHTML = `
            <div class="ag-list-col ag-col-thumb">
                ${cover
                    ? `<img src="${cover}" alt="${(game.name||'').replace(/"/g,'&quot;')}" class="ag-list-thumb" loading="lazy" onerror="this.style.opacity='0'">`
                    : ''
                }
                <div class="ag-list-thumb-placeholder" ${cover ? 'style="display:none"' : ''}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2a2a2a" stroke-width="1.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
                </div>
            </div>
            <div class="ag-list-col ag-col-title">
                <div class="ag-col-title-text">${game.name || ''}</div>
            </div>
            <div class="ag-list-col ag-col-platforms">
                <div class="ag-list-badges">${badgesHtml}</div>
            </div>
            <div class="ag-list-col ag-col-playtime">
                <div class="ag-col-meta">${ptStr}</div>
            </div>
            <div class="ag-list-col ag-col-lastplayed">
                <div class="ag-col-meta">${lpStr}</div>
            </div>
            <div class="ag-list-col ag-col-play">
                <button class="ag-list-play-btn" onclick="event.stopPropagation(); triggerLaunchSequence('${rawId}')" title="Play">
                    <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                </button>
            </div>
        `;

        row.addEventListener('click', () => {
            if (typeof openGameDetails === 'function') openGameDetails(rawId);
        });

        frag.appendChild(row);
    });

    container.appendChild(frag);
}

// ── Helper: retrieve the currently filtered Installed Games set ─
function _igGetCurrentFilteredGames() {
    // Prefer the authoritative list set by applyFilters() so Grid and List stay in sync.
    if (Array.isArray(window._lastInstalledFilteredGames)) {
        return window._lastInstalledFilteredGames;
    }
    // Fallback: re-derive using the same shared matcher from app.js
    if (typeof allGamesData === 'undefined') return [];
    let filtered = [...allGamesData];

    if (typeof currentFilters !== 'undefined' && currentFilters.platform && currentFilters.platform !== 'all') {
        filtered = filtered.filter(g => {
            if (typeof _gameMatchesPlatformFilter === 'function') {
                return _gameMatchesPlatformFilter(g, currentFilters.platform);
            }
            // minimal safe fallback — exact canonical match only
            const plat = (g.platform || '').toLowerCase().trim();
            return plat === currentFilters.platform.toLowerCase().trim();
        });
    }
    if (typeof currentFilters !== 'undefined' && currentFilters.search && currentFilters.search.trim()) {
        const term = currentFilters.search.toLowerCase();
        filtered = filtered.filter(g => {
            const nm = (g.name || '').toLowerCase();
            return nm.startsWith(term) || nm.includes(` ${term}`) || nm.includes(`-${term}`);
        });
    }
    if (typeof currentFilters !== 'undefined' && currentFilters.collectionId !== null) {
        const c = (typeof allCollections !== 'undefined' ? allCollections : [])
            .find(col => col.id === currentFilters.collectionId);
        if (c) filtered = filtered.filter(g => c.gameIds.includes(String(g.id)));
    }
    return filtered;
}

// ── View-aware render wrapper for Installed Games ─────────────
window._renderInstalledViewModeAware = function(games) {
    window._igApplyDisplayPrefs?.();
    if (window._igDisplayPrefs.viewMode === 'list') {
        _renderInstalledGamesList(games || _igGetCurrentFilteredGames());
        // Update count
        const countEl = document.getElementById('igResultCount');
        const cnt = (games || _igGetCurrentFilteredGames()).length;
        if (countEl) countEl.textContent = cnt > 0 ? `${cnt} games` : '';
    }
    // Grid mode: applyFilters() in app.js populates gamesGrid — nothing extra needed.
};

// ── Patch applyFilters to sync list view + count after every filter ──
(function _igPatchApplyFilters() {
    const _origApplyFilters = window.applyFilters || (typeof applyFilters === 'function' ? applyFilters : null);
    if (!_origApplyFilters) return;
    window.applyFilters = function() {
        const afterRender = () => {
            // Only act when Installed Games is the active view
            const igView = document.getElementById('installedGamesView');
            if (!igView || igView.style.display === 'none') return;
            const prefs = window._igDisplayPrefs;
            // Re-apply display prefs so CSS class toggles survive grid re-renders
            window._igApplyDisplayPrefs?.();
            // Keep result count in toolbar updated
            const grid = document.getElementById('gamesGrid');
            const countEl = document.getElementById('igResultCount');
            if (grid && countEl) {
                const cnt = grid.querySelectorAll('.game-card').length;
                countEl.textContent = cnt > 0 ? `${cnt} games` : '';
            }
            // If list mode is active, rebuild the list from current card data
            if (prefs && prefs.viewMode === 'list') {
                const currentGames = _igGetCurrentFilteredGames();
                _renderInstalledGamesList(currentGames);
            }
        };
        return Promise.resolve(_origApplyFilters.apply(this, arguments)).finally(afterRender);
    };
})();

// ── Patch navigateToInstalled to init prefs + sticky toolbar ─
(function _igPatchNavigateToInstalled() {
    const _origNav = window.navigateToInstalled || (typeof navigateToInstalled === 'function' ? navigateToInstalled : null);
    if (!_origNav) return;
    window.navigateToInstalled = function() {
        _origNav.apply(this, arguments);
        // A small rAF gives the view time to display before we measure
        requestAnimationFrame(() => {
            window._igApplyDisplayPrefs?.();
            if (typeof window._igInitStickyToolbar === 'function') window._igInitStickyToolbar();
            window.igUpdateSearchClear?.();
        });
    };
})();

// ── Init on DOMContentLoaded ──────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // Apply prefs immediately if Installed Games happens to be the first view
    window._igApplyDisplayPrefs?.();
});

// ══════════════════════════════════════════════════════════════

// ============================================================
// ملاحظة للـ developer: محتاج تضيف الـ methods دي في preload.js
// عشان الـ accounts view يشتغل صح:
//
// ⚠️ مهم لفيديوهات اليوتيوب (YouTube embeds محظورة في Electron - Error 153):
//   في preload.js: openExternal: (url) => shell.openExternal(url),
//   وتأكد إن: const { shell } = require('electron'); موجود في preload.js
//
// في preload.js ضيف جوه electronAPI:
//   getSteamAccounts:     ()           => ipcRenderer.invoke('get-steam-accounts'),
//   getSteamImage:        (steamId)    => ipcRenderer.invoke('get-steam-image', steamId),
//   switchSteam:          (username)   => ipcRenderer.invoke('switch-steam', username),
//   addNewSteamAccount:   ()           => ipcRenderer.invoke('add-new-steam-account'),
//   getEpicProfiles:      ()           => ipcRenderer.invoke('get-epic-profiles'),
//   saveEpicAccount:      (name)       => ipcRenderer.invoke('save-epic-account', name),
//   switchEpic:           (name)       => ipcRenderer.invoke('switch-epic', name),
//   addNewEpicAccount:    ()           => ipcRenderer.invoke('add-new-epic-account'),
//   getEAProfiles:        ()           => ipcRenderer.invoke('get-ea-profiles'),
//   saveEAAccount:        (name)       => ipcRenderer.invoke('save-ea-account', name),
//   switchEA:             (name)       => ipcRenderer.invoke('switch-ea', name),
//   addNewEAAccount:      ()           => ipcRenderer.invoke('add-new-ea-account'),
//   getRiotProfiles:      ()           => ipcRenderer.invoke('get-riot-profiles'),
//   saveRiotAccount:      (name)       => ipcRenderer.invoke('save-riot-account', name),
//   switchRiot:           (name)       => ipcRenderer.invoke('switch-riot-account', name),
//   addNewRiotAccount:    ()           => ipcRenderer.invoke('add-new-riot-account'),
//   getUbisoftProfiles:   ()           => ipcRenderer.invoke('get-ubisoft-profiles'),
//   saveUbisoftAccount:   (name)       => ipcRenderer.invoke('save-ubisoft-account', name),
//   switchUbisoft:        (name)       => ipcRenderer.invoke('switch-ubisoft-account', name),
//   addNewUbisoftAccount: ()           => ipcRenderer.invoke('add-new-ubisoft-account'),
// ============================================================
