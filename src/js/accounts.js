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

window.linkEpicLibrary = async function() {
    const content = document.getElementById('epicLibraryContent');
    if (content) content.innerHTML = `<div class="accounts-loading"><div class="acc-spinner"></div><span>Opening Epic login...</span></div>`;

    try {
        const res = await window.electronAPI.platformSyncLink?.('epic');
        if (res?.status === 'error') throw new Error(res.message);
        showToast(`Epic linked as ${res?.displayName || 'account'}! Syncing library...`, 'success');
        await _syncEpicAndRefresh();
    } catch (err) {
        showToast(`Link failed: ${err.message}`, 'error');
        if (content) await window._renderEpicLibraryPanel?.();
    }
};

window.syncEpicLibrary = async function() {
    const content = document.getElementById('epicLibraryContent');
    const syncBtn = null; // btn-sync-epic removed; no button to disable
    if (content) content.innerHTML = `<div class="accounts-loading"><div class="acc-spinner"></div><span>Syncing Epic library...</span></div>`;

    const epicSyncing = document.getElementById('epicSyncing');
    if (epicSyncing) epicSyncing.style.display = 'flex';

    try {
        await _syncEpicAndRefresh();
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

async function _syncEpicAndRefresh() {
    const res = await window.electronAPI.platformSyncSync?.('epic');
    if (res?.status === 'error') throw new Error(res.message);
    const count = res?.games?.length || 0;
    showToast(`Synced ${count} Epic games!`, 'success');

    const panel = document.getElementById('epicLibraryPanel');
    if (panel && panel.style.display !== 'none') await window._renderEpicLibraryPanel?.();

    _agSafeRenderAllGamesView();

    const countEl = document.getElementById('allGamesCount');
    if (countEl) countEl.textContent = count > 0 ? count : '—';
}

window.unlinkEpicLibrary = async function() {
    openConfirmModal(
        'Disconnect Epic Library?',
        'This will remove the synced Epic game list from All Games. Your account switcher profiles are not affected.',
        'Disconnect',
        async () => {
            try {
                await window.electronAPI.platformSyncUnlink?.('epic');
                showToast('Epic library disconnected.', 'success');
                await window._renderEpicLibraryPanel?.();
                _agSafeRenderAllGamesView();
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

    const out = { ...syncGame };

    const hasCreatorArtwork =
        localGame.customArtworkLocked === true ||
        localGame.artworkSource === 'creator';

    const hasCustomTitle =
        localGame.customTitleLocked === true ||
        localGame.titleSource === 'creator' ||
        !!localGame.customTitle;

    if (hasCustomTitle) {
        const customTitle = localGame.customTitle || localGame.name || localGame.title;
        if (customTitle) {
            out.title = customTitle;
            out.name = customTitle;
            out.customTitle = customTitle;
            out.customTitleLocked = true;
            out.titleSource = 'creator';
            out.titleUpdatedAt = localGame.titleUpdatedAt || Date.now();
        }
    }

    if (hasCreatorArtwork) {
        if (localGame.image) {
            out.coverUrl = localGame.image;
            out.image = localGame.image;
            out.defaultImage = localGame.image;

            out._agCoverPipelineDone = true;
            out._agCoverInFlight = false;
            out._agRemoteFallbackReady = true;
            out._agLocalRetryCount = 999;
        }

        if (localGame.heroImage) {
            out.heroUrl = localGame.heroImage;
            out.heroImage = localGame.heroImage;
            out.defaultHero = localGame.heroImage;
        }

        if ('logo' in localGame) {
            out.logoUrl = localGame.logo || null;
            out.logo = localGame.logo || null;
            out.defaultLogo = localGame.logo || null;
        }

        out.customArtworkLocked = true;
        out.artworkSource = localGame.artworkSource || 'creator';
    }

    out.installedId = localGame.id;

    out.allIds = {
        ...(localGame.allIds || {}),
        ...(out.allIds || {}),
    };

    return out;
}

function _agApplyInstalledCreatorOverride(syncGame, localGame) {
    if (!localGame) return syncGame;

    const out = { ...syncGame };

    const customTitle = localGame.name || localGame.title;
    if (customTitle) {
        out.title = customTitle;
        out.name = customTitle;
    }

    if (localGame.image) {
        out.coverUrl = localGame.image;
        out.image = localGame.image;
        out.defaultImage = localGame.image;

        out._agCoverPipelineDone = true;
        out._agCoverInFlight = false;
        out._agRemoteFallbackReady = true;
        out._agLocalRetryCount = 999;
    }

    if (localGame.heroImage) {
        out.heroUrl = localGame.heroImage;
        out.heroImage = localGame.heroImage;
        out.defaultHero = localGame.heroImage;
    }

    if ('logo' in localGame) {
        out.logoUrl = localGame.logo || null;
        out.logo = localGame.logo || null;
        out.defaultLogo = localGame.logo || null;
    }

    out.customArtworkLocked = true;
    out.artworkSource = localGame.artworkSource || 'creator';
    out.installedId = localGame.id;

    out.allIds = {
        ...(localGame.allIds || {}),
        ...(out.allIds || {}),
    };

    return out;
}

async function _agApplyInstalledCreatorOverrides(games = []) {
    let installedGames = [];

    if (Array.isArray(window.allGamesData) && window.allGamesData.length > 0) {
        installedGames = window.allGamesData;
    } else if (window.electronAPI?.getGames) {
        try {
            installedGames = await window.electronAPI.getGames();
            window.allGamesData = installedGames;
        } catch (_) {
            installedGames = [];
        }
    }

    const overrideMap = _agBuildInstalledCreatorOverrideMap(installedGames);

    if (overrideMap.size === 0) return games;

   return games.map(game => {
        const localOverride = _agFindInstalledCreatorOverrideFromMap(overrideMap, game);
        return _agApplyInstalledCreatorOverride(game, localOverride);
    });
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

function _agIsUsableCardCover(url, game = {}) {
    const s = String(url || '').trim();
    if (!s) return false;

    // Creator Mode stores chosen images as data:image base64
    if (s.startsWith('file://')) return true;
    if (s.startsWith('data:image/')) return true;
    if (s.startsWith('blob:')) return true;

    // Allow remote links only when user explicitly chose them in Creator Mode
    if (_agIsCreatorArtworkGame(game) && /^https?:\/\//i.test(s)) return true;

    // Existing fallback behavior
    if (game._agRemoteFallbackReady === true && /^https?:\/\//i.test(s)) return true;

    return false;
}

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

function _agEnqueueAllGamesCovers(games) {
    if (!window.electronAPI?.getMetadata || !Array.isArray(games) || games.length === 0) return;
    // Full dataset reset — drain all queues then populate Tier 3 (background)
    _agViewportCoverQueue.length   = 0;
    _agBufferCoverQueue.length     = 0;
    _agBackgroundCoverQueue.length = 0;
    games.forEach((g) => _agBackgroundCoverQueue.push(g));
    _agPumpCoverQueue();
}

/**
 * Enqueue games into the correct tier.
 *   viewportGames → Tier 1 (unshift = highest priority within tier)
 *   bufferGames   → Tier 2
 *   bgGames       → Tier 3
 */
function _agEnqueueByPriority(viewportGames, bufferGames, bgGames) {
    if (viewportGames?.length) _agViewportCoverQueue.unshift(...viewportGames);
    if (bufferGames?.length)   _agBufferCoverQueue.push(...bufferGames);
    if (bgGames?.length)       _agBackgroundCoverQueue.push(...bgGames);
    _agPumpCoverQueue();
}

/**
 * Strict 3-tier pump.
 *
 * Rule: a lower tier only gets a slot when ALL higher tiers are completely
 * idle — queue empty AND zero in-flight resolves.  This prevents a slow
 * Tier 3 resolve (e.g. a metadata fetch that started before a scroll) from
 * continuing to consume concurrency that should go to newly-visible cards.
 */
function _agPumpCoverQueue() {
    // ── Tier 1 — viewport ────────────────────────────────────────────────────
    while (_agT1Active < _AG_T1_CONCURRENCY && _agViewportCoverQueue.length > 0) {
        const game = _agViewportCoverQueue.shift();
        _agT1Active++;
        _agResolveCoverForGame(game, 1).finally(() => {
            _agT1Active--;
            _agPumpCoverQueue();
        });
    }

    // Tier 2 is blocked while ANY Tier 1 work exists (queued or in-flight)
    if (_agViewportCoverQueue.length > 0 || _agT1Active > 0) return;

    // ── Tier 2 — buffer ──────────────────────────────────────────────────────
    while (_agT2Active < _AG_T2_CONCURRENCY && _agBufferCoverQueue.length > 0) {
        const game = _agBufferCoverQueue.shift();
        _agT2Active++;
        _agResolveCoverForGame(game, 2).finally(() => {
            _agT2Active--;
            _agPumpCoverQueue();
        });
    }

    // Tier 3 is blocked while ANY Tier 1 or Tier 2 work exists
    if (_agBufferCoverQueue.length > 0 || _agT2Active > 0) return;

    // ── Tier 3 — background ──────────────────────────────────────────────────
    while (_agT3Active < _AG_T3_CONCURRENCY && _agBackgroundCoverQueue.length > 0) {
        const game = _agBackgroundCoverQueue.shift();
        _agT3Active++;
        _agResolveCoverForGame(game, 3).finally(() => {
            _agT3Active--;
            _agPumpCoverQueue();
        });
    }
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
        game.allIds?.steam,
        game.allIds?.epic,
        game.title,
        game.name,
        normTitle,
    ].filter(Boolean).map(String))];
}

async function _agGetCachedImageAnyKey(game, type = 'cover') {
    if (!window.electronAPI?.getCachedImage) return null;

    for (const key of _agCoverCacheKeys(game)) {
        try {
            const cached = await window.electronAPI.getCachedImage(key, type);
            if (cached && String(cached).startsWith('file://')) {
                return cached;
            }
        } catch {}
    }

    return null;
}

async function _agResolveCoverForGame(game, tier = 3) {
    const grid = document.getElementById('allGamesGrid');
    if (!grid || !game) return;

    const id = String(game.id ?? game.appName ?? game.title ?? '');
    if (!id) return;

    // In-flight guard — set synchronously before first await
    if (game._agCoverPipelineDone || game._agCoverInFlight) return;
    game._agCoverInFlight = true;

    /** Patch the visible card's <img> src in-place */
    function _patchVisibleCard(url) {
        const img = grid.querySelector(`[data-id="${_agCssEscape(id)}"] .native-lazy-load`);
        if (img) {
            img.src = url;
            img.style.display = '';
            img.classList.add('loaded');
        }
    }

    /**
     * Download a single asset (hero or logo) to the local cache as a side-effect.
     * Does not block the cover pipeline — fires and forgets.
     * Sets game[field] and the matching localStorage key both for the remote URL
     * immediately and upgrades to the local file:// path once downloaded.
     */
    function _cacheAssetSideEffect(rawUrl, type, field) {
        // Only skip when the field is already a locally-cached file:// path.
        // Remote http:// URLs written by applyNormalizedToCache must be downloaded.
        if (!rawUrl || (game[field] && String(game[field]).startsWith('file://'))) return;
        game[field] = rawUrl;
        localStorage.setItem(type + '_' + id, rawUrl);
        // Only persist to disk for installed games — library-only cards use the remote URL.
        if (!_agIsInstalled(game)) return;
        if (window.electronAPI.cacheImage) {
            window.electronAPI.cacheImage(rawUrl, id, type)
                .then((local) => {
                    if (local && String(local).startsWith('file://')) {
                        game[field] = local;
                        localStorage.setItem(type + '_' + id, local);
                    }
                })
                .catch(() => {});
        }
    }

    /**
     * Restore hero/logo from localStorage on any fast-path return.
     * Zero cost — no IPC, no network.
     */
    function _restoreHeroLogoFromStorage() {
        if (!game.heroUrl) { const h = localStorage.getItem('hero_' + id); if (h) game.heroUrl = h; }
        if (!game.logoUrl) { const l = localStorage.getItem('logo_' + id); if (l) game.logoUrl = l; }
    }
    // Creator Mode cover is authoritative.
// Do NOT let disk cache / metadata / remote fallback replace it.
const creatorCover = game.coverUrl || game.image || game.defaultImage;

if (_agIsCreatorArtworkGame(game) && _agIsUsableCardCover(creatorCover, game)) {
    game.coverUrl = creatorCover;
    game.image = creatorCover;
    game.defaultImage = creatorCover;

    game._agCoverPipelineDone = true;
    game._agCoverInFlight = false;
    game._agRemoteFallbackReady = true;
    game._agLocalRetryCount = 999;

    try {
        localStorage.setItem('cover_' + id, creatorCover);
    } catch {}

    _patchVisibleCard(creatorCover);
    _restoreHeroLogoFromStorage();
    return;
}
    const cacheKey = 'cover_' + id;
    

    // ── FAST PATH: synchronous checks before any await ────────────────────────
    // 1a. In-memory coverUrl that is a plain http URL (always valid, no probe).
    // hero/logo may also be remote CDN URLs set by applyNormalizedToCache —
    // kick off their download as a side-effect so they land in image_cache.
    const diskFirst = await _agGetCachedImageAnyKey(game, 'cover');

if (diskFirst) {
    const ok = !window.electronAPI.probeLocalImage || await window.electronAPI.probeLocalImage(diskFirst);

    if (ok) {
        game.coverUrl = diskFirst;
        game.image = diskFirst;
        game.defaultImage = diskFirst;
        game._agRemoteFallbackReady = false;
        localStorage.setItem(cacheKey, diskFirst);

        _patchVisibleCard(diskFirst);
        _restoreHeroLogoFromStorage();

        game._agCoverPipelineDone = true;
        game._agCoverInFlight = false;
        return;
    }
}
    if (game.coverUrl && !game.coverUrl.startsWith('file://')) {
    const remoteCover = game.coverUrl;

    // اعرض remote مؤقتًا فقط، لكن متعتبرش الـ pipeline خلص
    game._agRemoteFallbackReady = true;
    game._agRemoteCoverCandidate = remoteCover;

    _patchVisibleCard(remoteCover);
    _restoreHeroLogoFromStorage();
    _cacheAssetSideEffect(game.heroUrl || null, 'hero', 'heroUrl');
    _cacheAssetSideEffect(game.logoUrl || null, 'logo', 'logoUrl');

    game._agCoverPipelineDone = false;
    game._agCoverInFlight = false;

    // Retry local cache a few times because platformSync may emit/write file:// shortly after
    game._agLocalRetryCount = Number(game._agLocalRetryCount || 0);

    if (game._agLocalRetryCount < 3) {
        const retryDelay = [1500, 4000, 8000][game._agLocalRetryCount];
        game._agLocalRetryCount++;

        setTimeout(async () => {
            try {
                const current = String(game.coverUrl || game.image || game.defaultImage || '');

                // خلاص اتحولت file:// من event أو hydrate
                if (current.startsWith('file://')) {
                    game._agCoverPipelineDone = true;
                    game._agCoverInFlight = false;
                    return;
                }

                const local = await _agGetCachedImageAnyKey(game, 'cover');

                if (local && String(local).startsWith('file://')) {
                    game.coverUrl = local;
                    game.image = local;
                    game.defaultImage = local;
                    game._agRemoteFallbackReady = false;
                    game._agCoverPipelineDone = true;
                    game._agCoverInFlight = false;

                    localStorage.setItem('cover_' + id, local);
                    _patchVisibleCard(local);

                    if (window._vs?._coverQueued) {
                        window._vs._coverQueued.add(id);
                    }

                    return;
                }

                // اسمح بمحاولة تانية بعدين
                if (window._vs?._coverQueued) {
                    window._vs._coverQueued.delete(id);
                }

                game._agCoverPipelineDone = false;
                game._agCoverInFlight = false;

            } catch {
                game._agCoverInFlight = false;
            }
        }, retryDelay);
    } else {
        // بعد 3 محاولات، خلاص اعتبر remote fallback نهائي عشان ميعملش loop
        game._agCoverPipelineDone = true;
    }

    return;
}

    // 1b. localStorage http URL — synchronous read, zero cost
    const lsCached = localStorage.getItem(cacheKey);
    if (lsCached && lsCached.startsWith('http')) {
        game.coverUrl = lsCached;
        _patchVisibleCard(lsCached);
        _restoreHeroLogoFromStorage();
        _cacheAssetSideEffect(game.heroUrl || null, 'hero', 'heroUrl');
        _cacheAssetSideEffect(game.logoUrl || null, 'logo', 'logoUrl');
        game._agCoverPipelineDone = true;
        game._agCoverInFlight = false;
        return;
    }

    // ── ASYNC PATH ────────────────────────────────────────────────────────────
    const fileOk = async (u) => {
        if (!u || !String(u).startsWith('file://')) return true;
        if (!window.electronAPI.probeLocalImage) return true;
        return window.electronAPI.probeLocalImage(u);
    };

    try {
        // Validate existing file:// coverUrl
        if (game.coverUrl && game.coverUrl.startsWith('file://')) {
            if (!(await fileOk(game.coverUrl))) {
                game.coverUrl = null;
            } else {
                _patchVisibleCard(game.coverUrl);
                _restoreHeroLogoFromStorage();
                _cacheAssetSideEffect(game.heroUrl || null, 'hero', 'heroUrl');
                _cacheAssetSideEffect(game.logoUrl || null, 'logo', 'logoUrl');
                game._agCoverPipelineDone = true;
                return;
            }
        }

        // Validate localStorage file:// entry
        if (lsCached && lsCached.startsWith('file://')) {
            if (await fileOk(lsCached)) {
                game.coverUrl = lsCached;
                _patchVisibleCard(lsCached);
                _restoreHeroLogoFromStorage();
                _cacheAssetSideEffect(game.heroUrl || null, 'hero', 'heroUrl');
                _cacheAssetSideEffect(game.logoUrl || null, 'logo', 'logoUrl');
                game._agCoverPipelineDone = true;
                return;
            } else {
                localStorage.removeItem(cacheKey);
            }
        }

        if (game._agCoverPipelineDone) {
            if (game.coverUrl) _patchVisibleCard(game.coverUrl);
            return;
        }

        // 2. Disk cache (local IPC — fast)
        if (window.electronAPI.getCachedImage) {
            try {
                const disk = await window.electronAPI.getCachedImage(id, 'cover');
                if (disk && (await fileOk(disk))) {
                    game.coverUrl = disk;
                    localStorage.setItem(cacheKey, disk);
                    _patchVisibleCard(disk);

                    // Also pull hero/logo from disk cache while we're here.
                    // If hero/logo are remote CDN URLs (not yet local), fall back
                    // to _cacheAssetSideEffect to download them.
                    _restoreHeroLogoFromStorage();
                    if (!game.heroUrl || !String(game.heroUrl).startsWith('file://')) {
                        const remoteHero = game.heroUrl || null;
                        window.electronAPI.getCachedImage(id, 'hero').then(async h => {
                            if (h && await fileOk(h)) { game.heroUrl = h; localStorage.setItem('hero_' + id, h); }
                            else if (remoteHero) _cacheAssetSideEffect(remoteHero, 'hero', 'heroUrl');
                        }).catch(() => {});
                    }
                    if (!game.logoUrl || !String(game.logoUrl).startsWith('file://')) {
                        const remoteLogo = game.logoUrl || null;
                        window.electronAPI.getCachedImage(id, 'logo').then(async l => {
                            if (l && await fileOk(l)) { game.logoUrl = l; localStorage.setItem('logo_' + id, l); }
                            else if (remoteLogo) _cacheAssetSideEffect(remoteLogo, 'logo', 'logoUrl');
                        }).catch(() => {});
                    }

                    game._agCoverPipelineDone = true;
                    return;
                }
            } catch { /* fall through to metadata */ }
        }

        // 3. API metadata fetch — the expensive step
        const meta = await window.electronAPI.getMetadata(game.title || '', _agMetadataHints(game));

        // Pending enrichment: server has data but cover not ready yet — retry later
        const needsCover = !meta?.cover && !game.coverUrl;
        if (meta?._serverData && needsCover) {
            console.log(`[Metadata][Pending] ${game.title} — retrying in 4s...`);
            game._agCoverInFlight = false;
            _vs._coverQueued.delete(id);
            setTimeout(() => {
                // Re-queue into the same tier so priority is preserved on retry
                if (tier === 1)      _agViewportCoverQueue.push(game);
                else if (tier === 2) _agBufferCoverQueue.push(game);
                else                 _agBackgroundCoverQueue.push(game);
                _agPumpCoverQueue();
            }, 4000);
            return;
        }

        console.log(`[Metadata][AllGames] ${game.title} -> source: ${meta?.source || 'unknown'}`, meta?.debug || {});

        if (meta?.cover) {
            game.coverUrl = meta.cover;
            _patchVisibleCard(meta.cover);
            localStorage.setItem(cacheKey, meta.cover);

            if (window.electronAPI.cacheImage) {
                window.electronAPI.cacheImage(meta.cover, id, 'cover')
                    .then((localUrl) => {
                        if (localUrl && String(localUrl).startsWith('file://')) {
                            game.coverUrl = localUrl;
                            localStorage.setItem(cacheKey, localUrl);
                            _patchVisibleCard(localUrl);
                        }
                    })
                    .catch(() => {});
            }
        }

        // Also cache hero and logo from the same metadata response.
        // getMetadata() returns heroImage (normalizeServerData alias) or hero.
        // _cacheAssetSideEffect downloads to image_cache and upgrades to file://.
        _cacheAssetSideEffect(meta?.heroImage || meta?.hero || null, 'hero', 'heroUrl');
        _cacheAssetSideEffect(meta?.logo      || null,                'logo', 'logoUrl');

        game._agCoverPipelineDone = true;
    } catch (e) {
        console.warn('[AllGames] cover metadata failed', game?.title, e);
        game._agCoverPipelineDone = true;
    } finally {
        game._agCoverInFlight = false;
    }
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

    // Steam/Epic only belong when they came from a linked account library,
    // not merely from a local installed scanner.
    const isSteamOrEpic =
        platform === 'steam' || platform === 'epic' ||
        scanner  === 'steam' || scanner  === 'epic';
    if (isSteamOrEpic && hasSyncedAccountEvidence) return true;

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
    {
        const _main = document.getElementById('mainContentArea');
        if (_main && !opts.restoreState?.scrollTop) {
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
    _agBeginAllGamesRoute(opts);

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
        const _hasLinked = _syncSt?.steam === true || _syncSt?.epic === true;
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

                // resetScroll=false because scrollTop was already set to 0 in step 2;
                // for back-navigation we'll restore the saved position after render.
                _applyAgFilters({ resetScroll: !opts.restoreState?.scrollTop });

                if (opts.restoreState?.scrollTop) {
                    // Double-rAF: ensure _vsRender has completed its first pass
                    requestAnimationFrame(() => requestAnimationFrame(() => {
                        const el = document.getElementById('mainContentArea');
                        if (el) el.scrollTop = opts.restoreState.scrollTop;
                        if (typeof window._vsRender === 'function') window._vsRender(false, 'scroll-restore');
                    }));
                }
                return; // finally → _agEndAllGamesRoute()
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
    if (list) list.style.display = '';
}

// Idempotent repair helper: restores the grid's position/display/height if the
// virtual scroller has live rows but DOM styles were cleared prematurely. Only
// called in the background-skip path — never removes rows or clears cardPool.
function _agEnsureVirtualGridIntegrity(reason) {
    const vs = window._vs;
    if (!vs || !Array.isArray(vs.items) || vs.items.length === 0) return;
    if (!(vs.cardPool instanceof Map) || vs.cardPool.size === 0) return;
    const grid = document.getElementById('allGamesGrid');
    if (!grid) return;
    if (!grid.style.position || grid.style.position === '') {
        grid.style.position = 'relative';
    }
    if (!grid.style.display || grid.style.display === '') {
        grid.style.display = 'block';
    }
    if (vs.totalHeight != null && (!grid.style.height || grid.style.height === '')) {
        grid.style.height = vs.totalHeight + 'px';
    }
    console.log(`[AllGames] _agEnsureVirtualGridIntegrity(${reason}): pos=${grid.style.position} h=${grid.style.height}`);
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

// Synchronous first-paint helper — call AFTER view.style.display='block' and AFTER _hideAllViews.
// Clears stale virtual-scroll row DOM (without touching cardCache) and installs a stable skeleton.
function _agBeginAllGamesRoute(opts) {
    const main   = document.getElementById('mainContentArea');
    const view   = document.getElementById('allGamesView');
    const grid   = document.getElementById('allGamesGrid');
    const list   = document.getElementById('allGamesList');

    // Disable smooth scrolling temporarily so the synchronous reset is instant
    if (main) {
        main._agSavedScrollBehavior = main.style.scrollBehavior;
        main.style.scrollBehavior = 'auto';
    }

    // Remove currently-mounted virtual-scroll row nodes — do NOT wipe cardCache
    _vs.cardPool.forEach(row => row.remove());
    _vs.cardPool.clear();
    _vs.renderedStart = -1;
    _vs.renderedEnd   = -1;
    _vs.cols          = 0;
    _vs._gridTopDirty = true;

    if (list) list.style.display = 'none';

    // Install a stable skeleton — same height as the viewport so nothing collapses
    if (grid) {
        grid.classList.remove('ag-empty-mode');
        grid.style.position  = 'relative';
        grid.style.height    = '';
        grid.style.minHeight = 'calc(100vh - 180px)';
        grid.style.display   = 'block';
        grid.innerHTML       = _agRouteSkeletonHTML();
    }

    document.body.classList.add('ag-route-pending');
    if (view) view.classList.add('ag-first-paint-lock');
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

    const steamClick = "openPlatformsModal('steam')";
    const epicClick  = "openPlatformsModal('epic')";

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
            Connect your Steam or Epic Games account to browse,
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
                    Connect Steam
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
                    Connect Epic
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
        const steamAccounts = steamRes?.accounts || [];
        const epicAccounts  = epicRes?.accounts  || [];
        return steamAccounts.length > 0 || epicAccounts.length > 0;
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
    const allGamesCount = document.getElementById('allGamesCount');
    if (!grid) { window._allGamesRendering = false; return; }

    try {
    // 1. Check platform link status for Epic and Steam.
    const status = await window.electronAPI.platformSyncStatus?.().catch(() => ({}));
    const isEpicLinked = status?.epic === true;
    const isSteamLinked = status?.steam === true;

    // 2. No accounts linked — show onboarding panel.
    if (!isEpicLinked && !isSteamLinked) {
        window._allGamesRendering = false;
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
    // Restore grid to normal card-layout mode (in case we're coming from empty state)
    _agResetAllGamesGridMode();

    // If the caller already installed a route skeleton, don't replace it with
    // another loading row — the skeleton is stable and avoids a double-flash.
    if (!options.suppressInitialLoading) {
        grid.innerHTML = options.stableLayout
            ? _agStableLibraryLoadingHTML()
            : `<div class="accounts-loading" style="padding:40px 0;"><div class="acc-spinner"></div><span>Loading library...</span></div>`;
    }

    try {
        let rawGames = [];
        const accountNameByKey = new Map();

        // 1. Fetch cached games from each linked platform.
        if (isEpicLinked) {
            const epicAccountsRes = await window.electronAPI.platformSyncGetAccounts?.('epic');
            const epicAccounts = epicAccountsRes?.accounts || [];
            epicAccounts.forEach((acc) => {
                accountNameByKey.set(_agComposeAccountKey('epic', acc.id), _agNormalizeAccountLabel(acc.displayName, acc.id));
            });
            const epicRes = await window.electronAPI.platformSyncGetCached?.('epic');
            if (epicRes?.games) rawGames.push(...epicRes.games);
        }
        if (isSteamLinked) {
            const steamAccountsRes = await window.electronAPI.platformSyncGetAccounts?.('steam');
            const steamAccounts = steamAccountsRes?.accounts || [];
            steamAccounts.forEach((acc) => {
                accountNameByKey.set(_agComposeAccountKey('steam', acc.id), _agNormalizeAccountLabel(acc.displayName, acc.id));
            });
            const steamRes = await window.electronAPI.platformSyncGetCached?.('steam');
            if (steamRes?.games) rawGames.push(...steamRes.games);
        }

        // 2. Deduplicate by normalized title and merge platform metadata.
        const mergedGamesMap = new Map();

        rawGames.forEach(game => {
            // Normalize title for dedup comparison (lowercase, alphanumeric only).
            const cleanTitle = (game.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');

            if (mergedGamesMap.has(cleanTitle)) {
                // Merge additional platform/ID into the existing entry.
                const existingGame = mergedGamesMap.get(cleanTitle);

                // Add new platform if not already tracked.
                if (!existingGame.platforms.includes(game.platform)) {
                    existingGame.platforms.push(game.platform);
                }

                // Preserve per-platform ID for targeted launching.
                existingGame.allIds[game.platform] = game.id;
                existingGame._agSource     = 'platform-sync';
                existingGame.librarySource = 'synced-account';
                _agMergeAccountMeta(existingGame, game, accountNameByKey);

            } else {
                // First occurrence — initialize platform arrays.
                const newGame = { ...game };
                newGame.platforms      = [game.platform];
                newGame.allIds         = { [game.platform]: game.id };
                newGame._agSource      = 'platform-sync';
                newGame.librarySource  = 'synced-account';
                _agMergeAccountMeta(newGame, game, accountNameByKey);
                mergedGamesMap.set(cleanTitle, newGame);
            }
        });

        // Convert merged Map to array and apply installed-creator overrides.
        const _rawResolved = await _agApplyInstalledCreatorOverrides(
            Array.from(mergedGamesMap.values())
        );
        window._allGamesRawCache = _rawResolved;
        window._allGamesCache    = _agGetUserLibraryGames(_rawResolved);

        if (window._vs?.cardCache) window._vs.cardCache.clear();

        // Update sidebar All Games count badge.
        if (allGamesCount) {
            allGamesCount.textContent = window._allGamesCache.length > 0 ? window._allGamesCache.length : '—';
        }
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
            _applyAgFilters({ resetScroll: false, reason: 'renderAllGamesView-preserve-filters' });
            return;
        }

        // RTI canonical: render from canonical list rather than raw _allGamesCache.
        if (window.agReadyOnly
            && typeof window.getCanonicalReadyToInstallGames === 'function') {
            const readyGames = window.getCanonicalReadyToInstallGames();
            if (Array.isArray(readyGames)) {
                _renderAllGamesViewModeAware(readyGames);
                return;
            }
        }

        _renderAllGamesViewModeAware(window._allGamesCache);
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
// Guard: register only once — navigating back and forth would stack listeners
// and trigger multiple concurrent re-renders per event.
if (window.electronAPI.onLibraryUpdated && !window._allGamesLibraryListenerAttached) {
    window._allGamesLibraryListenerAttached = true;
    window.electronAPI.onLibraryUpdated(async () => {
        // Use the scroll-preserve helper from app.js; fall back to a no-op wrapper
        // if it is not yet available (should not happen in normal load order).
        const _preserve = typeof window._preserveActiveScrollDuring === 'function'
            ? window._preserveActiveScrollDuring
            : (reason, fn) => fn();

        return _preserve('accounts-library-updated', async () => {
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
                    return;
                }

                console.log('[AllGames] Library updated — refreshing cache' + (viewVisible ? ' and view' : ' (background)'));

                let rawGames = [];
                const accountNameByKey = new Map();

                if (isEpicLinked) {
                    const epicAccountsRes = await window.electronAPI.platformSyncGetAccounts?.('epic');
                    (epicAccountsRes?.accounts || []).forEach(acc => {
                        accountNameByKey.set(_agComposeAccountKey('epic', acc.id), _agNormalizeAccountLabel(acc.displayName, acc.id));
                    });
                    const epicRes = await window.electronAPI.platformSyncGetCached?.('epic');
                    if (epicRes?.games) rawGames.push(...epicRes.games);
                }
                if (isSteamLinked) {
                    const steamAccountsRes = await window.electronAPI.platformSyncGetAccounts?.('steam');
                    (steamAccountsRes?.accounts || []).forEach(acc => {
                        accountNameByKey.set(_agComposeAccountKey('steam', acc.id), _agNormalizeAccountLabel(acc.displayName, acc.id));
                    });
                    const steamRes = await window.electronAPI.platformSyncGetCached?.('steam');
                    if (steamRes?.games) rawGames.push(...steamRes.games);
                }

                const mergedGamesMap = new Map();
                rawGames.forEach(game => {
                    const cleanTitle = (game.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                    if (mergedGamesMap.has(cleanTitle)) {
                        const existingGame = mergedGamesMap.get(cleanTitle);
                        if (!existingGame.platforms.includes(game.platform)) existingGame.platforms.push(game.platform);
                        existingGame.allIds[game.platform] = game.id;
                        existingGame._agSource     = 'platform-sync';
                        existingGame.librarySource = 'synced-account';
                        _agMergeAccountMeta(existingGame, game, accountNameByKey);
                    } else {
                        const newGame = { ...game };
                        newGame.platforms     = [game.platform];
                        newGame.allIds        = { [game.platform]: game.id };
                        newGame._agSource     = 'platform-sync';
                        newGame.librarySource = 'synced-account';
                        _agMergeAccountMeta(newGame, game, accountNameByKey);
                        mergedGamesMap.set(cleanTitle, newGame);
                    }
                });

                let newCache = Array.from(mergedGamesMap.values());
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
                newCache = await _agApplyInstalledCreatorOverrides(newCache);

                window._allGamesRawCache = newCache;
                window._allGamesCache    = _agGetUserLibraryGames(newCache);

                // Publish canonical ready state — this is the single authoritative update.
                const _rtiGames = _agComputeReadyToInstallGamesFromCache();
                if (_rtiGames !== null) {
                    _agPublishReadyToInstallState(_rtiGames, 'library-updated');
                }

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
                    await _agHydrateCachedCoversIntoAllGames();
                    const _countEl = document.getElementById('allGamesCount');
                    if (_countEl) _countEl.textContent = window._allGamesCache.length > 0 ? window._allGamesCache.length : '—';
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
                    _agResetAllGamesGridMode();
                }

                await _agHydrateCachedCoversIntoAllGames();

                const allGamesCount = document.getElementById('allGamesCount');
                if (allGamesCount) allGamesCount.textContent = window._allGamesCache.length > 0 ? window._allGamesCache.length : '—';

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

                const scroller = document.getElementById('mainContentArea');
                const keepScrollTop = scroller ? scroller.scrollTop : 0;

                const _rendered = _applyAgFilters({ resetScroll: false, reason: 'background-library-updated-preserve-filters' });

                if (window.baddel_debug_vs) {
                    const _dbgPool = _agBuildFilteredPool({ cache: _agGetUserLibraryGames(window._allGamesCache || []), useCanonical: false });
                    console.log('[AGFILTER] apply result count=' + _dbgPool.length);
                }

                if (_rendered !== false) {
                    if (scroller) {
                        requestAnimationFrame(() => {
                            scroller.scrollTop = keepScrollTop;
                            if (typeof window._vsRender === 'function') {
                                window._vsRender(false, 'background-update');
                            }
                        });
                    } else if (typeof window._vsRender === 'function') {
                        window._vsRender(false, 'background-update');
                    }
                }
            } catch (err) {
                console.warn('[AllGames] Silent refresh failed:', err.message);
            }
        });
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

    const nextCover = String(cover || '');
    if (!nextCover) return false;
    // Never overwrite Creator Mode artwork with sync/cache events
const currentCreatorCover = game.coverUrl || game.image || game.defaultImage;

if (_agIsCreatorArtworkGame(game) && _agIsUsableCardCover(currentCreatorCover, game)) {
    game._agCoverPipelineDone = true;
    game._agCoverInFlight = false;
    game._agLocalRetryCount = 999;
    return false;
}

    const changed =
        game.coverUrl !== nextCover ||
        game.image !== nextCover ||
        game.defaultImage !== nextCover ||
        game._agCoverPipelineDone !== true ||
        game._agRemoteFallbackReady !== false;

    game.coverUrl = nextCover;
    game.image = nextCover;
    game.defaultImage = nextCover;

    // Important: once the local file:// cover arrives, remote fallback is no longer needed.
    game._agRemoteFallbackReady = false;
    game._agCoverPipelineDone = true;
    game._agCoverInFlight = false;
    game._agLocalRetryCount = 999;

    const id = String(game.id || game.appName || game.title || '');
    if (id && window._vs?._coverQueued) {
        window._vs._coverQueued.add(id);
    }

    try {
        localStorage.setItem('cover_' + id, nextCover);
    } catch {}

    return changed;
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
        const fakeGame = {
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
            if (window._vs?.cardCache instanceof Map) {
                for (const [key, card] of window._vs.cardCache.entries()) {
                    const fakeGame = {
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
    raf: null,          // pending requestAnimationFrame handle
    scroller: null,     // the scrollable element
    sentinel: null,     // top spacer div
    cardPool: new Map(), // rowIndex → rowEl DOM node
    cardCache: new Map(), // gameId → card DOM node — survives scroll cycles
    _coverQueued: new Set(), // gameIds already queued for cover fetch
    // ── Scroll-speed / settle tracking ──────────────────────────────────────
    _gridTop: 0,         // cached grid offsetTop relative to scroller — avoid rAF layout reads
    _gridTopDirty: true, // re-measure gridTop on next render if true
    _lastScrollTop: 0,   // last known scrollTop — used to detect fast scroll
    _scrollSpeed: 0,     // exponentially-smoothed scroll speed (px/frame)
    _scrollSettleTimer: null, // timer to run background cover work after scroll settles
    _isScrolling: false, // true while user is actively scrolling fast
};
window._vs = _vs;

function _agLegacyCoverForResolver(game) {
    return game?.coverUrl || game?.image || game?.defaultImage || game?.cover || game?.posterImage || '';
}

function _agResolveAllGamesCoverDecision(game) {
    const legacyCover = _agLegacyCoverForResolver(game);
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


function _vsApplyCoverToCard(card, game, force = false) {
    if (!card || !game) return false;

    const coverDecision = _agResolveAllGamesCoverDecision(game);
    const rawCover = coverDecision.value;
    if (!rawCover) return false;

    const cover = String(rawCover || '');

if (!_agIsUsableCardCover(cover, game)) {
    game._agCoverPipelineDone = false;
    game._agCoverInFlight = false;
    return false;
}

// Creator/data/file covers are already usable; don't let the pipeline refetch over them
game._agCoverPipelineDone = true;
game._agCoverInFlight = false;
    const img = card.querySelector('.native-lazy-load');

    if (!img) return false;

    const currentSrc = img.getAttribute('src') || '';

    if (force || currentSrc !== cover || img.style.display === 'none' || !img.classList.contains('loaded')) {
        img.onerror = function () {
            this.onerror = null;
            this.style.display = 'none';
            this.classList.remove('loaded');

            const gameId = String(game.id || game.appName || game.title || '');
            if (gameId && window._vs?._coverQueued) {
                window._vs._coverQueued.delete(gameId);
            }

            game._agCoverPipelineDone = false;
            game._agCoverInFlight = false;
        };

        img.src = cover;
        img.dataset.src = cover;
        img.style.display = '';
        img.classList.add('loaded');
        img.classList.remove('loading', 'skeleton');
    }

    const placeholder = card.querySelector('.agc-placeholder, .agc-img-fallback');
    if (placeholder) {
        placeholder.classList.remove('loading', 'skeleton');
    }

    card.classList.remove('loading', 'skeleton', 'is-loading');
    card.dataset.coverUrl = cover;
    card.dataset.artworkSource = coverDecision.source || '';
    card.dataset.artworkReason = coverDecision.reason || '';

    return true;
}

/** Build one card DOM node for a game */
function _vsBuildCard(game) {
    const rawId = game.id || game.appName || game.title || '';
    const safeId = String(rawId);

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

    const isMulti = (game.platforms || []).length > 1;
    const coverDecision = _agResolveAllGamesCoverDecision(game);
    const rawCover = coverDecision.value || '';
    const cover = _agIsUsableCardCover(rawCover, game) ? _agAttrUrl(rawCover) : '';

    const card = document.createElement('div');
    card.className = `game-card agc-card${isMulti ? ' agc-multi' : ''}`;
    card.dataset.id = safeId;
    card.dataset.title = (game.title || '').toLowerCase();
    card.dataset.platforms = (game.platforms || []).join(',');
    card.dataset.allIds = JSON.stringify(game.allIds || {});
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
                 ${cover ? `src="${cover}"` : ''}
                 decoding="async"
                 onload="this.classList.add('loaded')"
                 onerror="this.onerror=null;this.style.display='none'">
            <div class="agc-badges-strip">${badgesHtml}</div>
            <div class="agc-top-gradient"></div>
        </div>
        <div class="game-card-info">
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

    card.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof openGameDetails === 'function') openGameDetails(safeId);
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
            String(g.title || g.name || g.appName || '').toLowerCase().replace(/[^a-z0-9]/g, '')
        ].filter(Boolean).forEach(k => coverByKey.set(String(k), cover));
    };

    rawGames.forEach(g => {
        const cover = g.coverUrl || g.image || g.defaultImage;
        if (!cover || !String(cover).startsWith('file://')) return;
        addKeys(g, cover);
    });

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
                window._vs._coverQueued.add(gameId);
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
    const gridW = grid.clientWidth;
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
    return [
        game?.coverUrl,
        game?.image,
        game?.defaultImage,
    ].some((u) => _agIsUsableCardCover(u, game));
}

function _agNeedsLocalCoverWork(game) {
    if (!game) return false;
    if (_agHasLocalCover(game)) return false;
    if (game._agCoverPipelineDone) return false;
    if (game._agCoverInFlight) return false;
    return true;
}

function _agCanQueueCover(game, gameId) {
    if (!_agNeedsLocalCoverWork(game)) return false;

    const now = Date.now();
    const lastQueuedAt = Number(game._agQueuedAt || 0);

    // لو لسه متضاف قريب، بلاش loop سريع
    if (window._vs?._coverQueued?.has(gameId) && now - lastQueuedAt < 2500) {
        return false;
    }

    // لو stuck في queued بس مش inFlight ومش done، افتحه يتجرب تاني
    if (window._vs?._coverQueued?.has(gameId)) {
        window._vs._coverQueued.delete(gameId);
    }

    game._agQueuedAt = now;
    window._vs?._coverQueued?.add(gameId);

    return true;
}

/** Main render function — called on every scroll tick */
function _vsRender(forceRemeasure = false, reason = 'unknown') {
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

    // Measure on first render or when forced (filter/resize)
    if (forceRemeasure || _vs.cols === 0) {
        const m = _vsMeasure(grid);
        _vs.cols = m.cols;
        _vs.rowH = m.rowH;
        _vs.scroller = scroller;

        // Set grid to position:relative with total phantom height
        const totalRows = Math.ceil(_vs.items.length / _vs.cols);
        grid.style.position = 'relative';
        grid.style.height = (totalRows * _vs.rowH - _vs.gap) + 'px';
        grid.style.display = 'block'; // override CSS grid temporarily for absolute positioning

        // Detach all row wrappers from DOM but keep cardCache alive
        _vs.cardPool.forEach(rowEl => rowEl.remove());
        _vs.cardPool.clear();
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
    const scrollTop = scroller.scrollTop;

    // ── Scroll-speed tracking ─────────────────────────────────────────────────
    const scrollDelta = Math.abs(scrollTop - _vs._lastScrollTop);
    _vs._lastScrollTop = scrollTop;
    // Exponential moving average — fast scroll → high speed, settle → decays to 0
    _vs._scrollSpeed = _vs._scrollSpeed * 0.6 + scrollDelta * 0.4;
    const isFastScrolling = _vs._scrollSpeed > 40; // px/frame threshold

    const viewportH = scroller.clientHeight;

    // ── Adaptive buffer: smaller during fast scroll to reduce DOM work ────────
    const rowsPerViewport = Math.ceil(viewportH / (_vs.rowH || 1));
    const BUFFER_ROWS = isFastScrolling
        ? Math.max(2, Math.ceil(rowsPerViewport * 0.5))   // lean buffer while flying
        : Math.max(8, Math.ceil(rowsPerViewport * 1.5));   // generous buffer when settled

    // Which rows are visible?
    const relScroll = Math.max(0, scrollTop - _vs._gridTop);
    const firstVisRow = Math.max(0, Math.floor(relScroll / _vs.rowH));
    const lastVisRow  = Math.min(totalRows - 1, Math.ceil((relScroll + viewportH) / _vs.rowH));

    const firstVisibleRow = Math.max(0, firstVisRow - BUFFER_ROWS);
    const lastVisibleRow  = Math.min(totalRows - 1, lastVisRow + BUFFER_ROWS);

    // Nothing changed — skip all DOM work
    if (firstVisibleRow === _vs.renderedStart && lastVisibleRow === _vs.renderedEnd) return;

    // ── Remove rows that scrolled out of the buffer window ───────────────────
    for (const [rowIdx, rowEl] of _vs.cardPool) {
        if (rowIdx < firstVisibleRow || rowIdx > lastVisibleRow) {
            rowEl.remove();
            _vs.cardPool.delete(rowIdx);
        }
    }

    // ── Mount rows that scrolled into the buffer window ───────────────────────
    // Collect games needing cover, separated by tier — queued AFTER the loop.
    const viewportNeedCover = [];   // Tier 1 — actually visible
    const bufferNeedCover   = [];   // Tier 2 — in render buffer but not visible

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

        rowGames.forEach((game) => {
        const gameId = String(game.id || game.appName || game.title || '');

        // Reuse cached card DOM node
        let card = _vs.cardCache.get(gameId);
        if (!card) {
            card = _vsBuildCard(game);
            _vs.cardCache.set(gameId, card);
        }

        // مهم جدًا:
        // حتى لو الكارت cached أو gameId موجود في _coverQueued،
        // لو الداتا دلوقتي فيها coverUrl لازم نركبه على الـ DOM.
        const coverApplied = _vsApplyCoverToCard(card, game, false);

        rowEl.appendChild(card);

        if (coverApplied) {
            _vs._coverQueued.add(gameId);
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

        grid.appendChild(rowEl);
        _vs.cardPool.set(row, rowEl);
    }

    _vs.renderedStart = firstVisibleRow;
    _vs.renderedEnd   = lastVisibleRow;

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

    // ── Scroll-settle timer: fire richer prefetch once user stops scrolling ───
    if (_vs._scrollSettleTimer) clearTimeout(_vs._scrollSettleTimer);
    _vs._scrollSettleTimer = setTimeout(() => {
        _vs._isScrolling = false;
        _vs._scrollSpeed = 0;
        _vsOnScrollSettle();
    }, 150);
    _vs._isScrolling = true;
}
window._vsRender = _vsRender;

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
    const BUFFER_ROWS  = Math.max(8, Math.ceil(rowsPerViewport * 1.5));
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
    if (_vs.raf) return;
    _vs.raf = requestAnimationFrame(() => {
        _vs.raf = null;
        _vsRender(false, 'scroll');
    });
}

/** Initialize or reinitialize virtual scroll with a new dataset */
function _vsInit(items, resetScroll = true) {
    const prevItemIds = new Set(_vs.items.map(g => String(g.id || g.appName || g.title || '')));
    const newItemIds  = new Set(items.map(g => String(g.id || g.appName || g.title || '')));

    // Only wipe the card-level cache if the dataset changed significantly
    // (e.g. filter changed). On pure scroll re-inits keep the cache intact.
    const datasetChanged = prevItemIds.size !== newItemIds.size ||
        [...newItemIds].some(id => !prevItemIds.has(id));

    if (datasetChanged) {
        // Remove cached cards that no longer appear in the new dataset
        for (const [id, card] of _vs.cardCache) {
            if (!newItemIds.has(id)) {
                _vs.cardCache.delete(id);
                _vs._coverQueued.delete(id);
            }
        }
    }

    _vs.items = items;
    _vs.cols = 0; // force remeasure
    _vs.renderedStart = -1;
    _vs.renderedEnd = -1;
    _vs.cardPool.forEach(rowEl => rowEl.remove());
    _vs.cardPool.clear();
    // Reset scroll-speed tracking so settle logic starts fresh
    _vs._lastScrollTop = 0;
    _vs._scrollSpeed = 0;
    _vs._isScrolling = false;
    _vs._gridTopDirty = true;
    if (_vs._scrollSettleTimer) { clearTimeout(_vs._scrollSettleTimer); _vs._scrollSettleTimer = null; }

    const grid = document.getElementById('allGamesGrid');
    const scroller = document.getElementById('mainContentArea');
    if (!grid || !scroller) return;

    // Attach scroll listener only once
    if (!_vs._scrollBound) {
        scroller.addEventListener('scroll', _vsOnScroll, { passive: true });
        window.addEventListener('resize', () => {
            // On resize, invalidate cached gridTop and remeasure
            _vs._gridTopDirty = true;
            if (_vs.items.length > 0) _vsRender(true, 'window-resize');
        });
        _vs._scrollBound = true;
    }

    if (resetScroll) scroller.scrollTop = 0;

    // Initial render
    _vsRender(true, 'vs-init');
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

    // Capture current rendered height before resetting so we can hold a floor
    // and prevent the grid collapsing to zero during the innerHTML swap.
    const previousHeight = grid.offsetHeight || parseFloat(grid.style.minHeight) || 0;

    // Reset grid to normal state (clear old virtual DOM)
    // Also removes ag-empty-mode if we're coming from the empty onboarding state
    _agResetAllGamesGridMode();

    // Restore a height floor so the page does not jump while content is swapped
    if (previousHeight > 0) grid.style.minHeight = previousHeight + 'px';

    grid.innerHTML = '';
    grid.style.position = 'relative';
    grid.style.height = '';
    _vs.cardPool.clear();
    _vs.cols = 0;
    _vs._gridTopDirty = true;

    // Full dataset wipe (e.g. navigating away and back): clear card cache and cover queue tracker.
    // On filter/sort changes we keep the cache so cards aren't rebuilt and images don't reload.
    if (fullReset) {
        _vs.cardCache.clear();
        _vs._coverQueued.clear();
    }

    if (!games || games.length === 0) {
        if (window._agNoLinkedAccounts) return;
        grid.style.minHeight = '';
        const emptyMsg = window.agReadyOnly
            ? '<p>No ready-to-install games found.</p><p style="margin-top:8px;color:#666;font-size:0.85rem;">All your synced games are already installed, or connect Steam or Epic accounts to discover more.</p>'
            : '<p>No games found.</p>';
        grid.innerHTML = `<div class="accounts-empty" style="padding:40px 0;width:100%;">${emptyMsg}</div>`;
        _updateAgCount(0);
        return;
    }

    _updateAgCount(games.length);
    _vsInit(games, resetScroll);
    // Release layout lock after virtual scroll initialises first batch
    _agUnlockAllGamesLayout();
}

function _updateAgCount(n) {
    const el = document.getElementById('agResultCount');
    if (el) el.textContent = n > 0 ? `${n} games` : '';
}

// ── Filter + Sort state ────────────────────────────────────────
window._agState = { platform: 'all', sort: 'title_asc', search: '', account: 'all' };

window.setAgPlatformFilter = function(platform, btn) {
    window._agState.platform = platform;
    document.querySelectorAll('.ag-pill').forEach(p => p.classList.remove('active'));
    if (btn) btn.classList.add('active');
    _applyAgFilters();
};

window.setAgSort = function(value) {
    window._agState.sort = value;
    _applyAgFilters();
};

window.setAgAccountFilter = function(value, labelText) {
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
        const installed = !!(g.path || g.command);

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
 * "Installed" = local entry has `path` or `command` (same rule as Game Details).
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
        pool.sort((a, b) => {
            const ptDiff = playtimeOf(b) - playtimeOf(a);
            if (ptDiff !== 0) return ptDiff;
            const lpDiff = lastPlayedOf(b) - lastPlayedOf(a);
            if (lpDiff !== 0) return lpDiff;
            return String(a.title || a.name || '').localeCompare(String(b.title || b.name || ''));
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
    if (options.reason === 'background-library-updated'
        && _newSig === window._agLastRenderedPoolSignature) {
        console.log('[AllGames] background update skipped visible rerender: signature unchanged');
        return false;
    }
    window._agLastRenderedPoolSignature = _newSig;

    _renderAllGamesViewModeAware(pool, resetScroll);
    return true;
}

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
    };
})();

// Also apply on DOMContentLoaded in case All Games is the first view
document.addEventListener('DOMContentLoaded', () => {
    window._agApplyDisplayPrefs?.();
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
        _origApplyFilters.apply(this, arguments);
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
