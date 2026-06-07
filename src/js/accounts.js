// ============================================================
// BADDEL LAUNCHER - ACCOUNTS VIEW (accounts.js)
// ============================================================
// ده الملف المسؤول عن:
// 1. التبديل بين Library و Accounts في الـ sidebar
// 2. عرض الـ accounts view على اليمين
// 3. لوجيك الـ account switcher لكل platform
// ============================================================

// ---- State ----
let currentSidebarSection = 'library'; // 'library' | 'accounts'
let currentAccountPlatform = null;     // 'steam' | 'epic' | 'ea' | 'riot' | 'ubisoft'
let isAccountProcessing = false;

// ============================================================
// SECTION 1: SIDEBAR SECTION SWITCHING
// ============================================================

/**
 * switchSidebarSection - الدالة الرئيسية للتبديل بين Library و Accounts
 * @param {string} section - 'library' | 'accounts'
 */
function switchSidebarSection(section) {
    currentSidebarSection = section;

    // تحديث الـ section buttons
    document.querySelectorAll('.sidebar-section-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`sectionBtn-${section}`)?.classList.add('active');

    // إظهار/إخفاء الـ sub items
    document.getElementById('subItems-library').style.display  = section === 'library'  ? 'block' : 'none';
    document.getElementById('subItems-accounts').style.display = section === 'accounts' ? 'block' : 'none';

    // تحديث الـ bottom button
    const btnIcon = document.getElementById('bottomBtnIcon');
    const btnText = document.getElementById('bottomBtnText');

    if (section === 'library') {
        if (btnIcon) btnIcon.textContent = '+';
        if (btnText) btnText.textContent = 'New Collection';
        // إظهار الـ library view وإخفاء الـ accounts view
        showLibraryView();
    } else {
        if (btnIcon) btnIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
        if (btnText) btnText.textContent = 'Add Account';
        // لو فيه platform متاختار، اعرضه - لو لأ، اختار أول واحد
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

function showAccountsView(platform) {
    if (typeof _hideAllViews === 'function') _hideAllViews();
    document.getElementById('accountsView').style.display = 'block';
    renderAccountsView(platform);
    // Update the context button now that accountsView is visible
    if (typeof updateSbContextBtn === 'function') updateSbContextBtn();
    if (typeof updateSidebarActiveState === 'function') updateSidebarActiveState();
}

// ============================================================
// SECTION 3: PLATFORM SELECTION
// ============================================================

/**
 * selectAccountPlatform - لما تضغط على platform في الـ sidebar
 */
function selectAccountPlatform(platform) {
    currentAccountPlatform = platform;
    currentSidebarSection  = 'accounts';
    // Clear collection filter so Favorites/collection rows don't stay active
    if (typeof currentFilters !== 'undefined') currentFilters.collectionId = null;

    // Expand accounts section, collapse library
    document.getElementById('subItems-accounts').style.display = 'block';
    document.getElementById('subItems-library').style.display  = 'none';
    document.getElementById(`sectionBtn-accounts`)?.classList.add('active');
    document.getElementById(`sectionBtn-library`)?.classList.remove('active');

    showAccountsView(platform);

    // updateSidebarActiveState reads accountsView visibility, which showAccountsView sets.
    if (typeof updateSidebarActiveState === 'function') updateSidebarActiveState();
    if (typeof updateSbContextBtn === 'function') updateSbContextBtn();
}

// ============================================================
// SECTION 4: ACCOUNTS VIEW RENDERER
// ============================================================

const PLATFORM_CONFIG = {
    steam: {
        name:    'Steam',
        color:   '#1b2838',
        accent:  '#66c0f4',
        logoImg: '../assets/Steam.png',
        getProfiles:  () => window.electronAPI.invoke ? null : window.electronAPI.getSystemInfo?.(),
        switchFn: switchSteamAccount,
        saveFn:   null, 
        addFn:    addNewSteamAccount
    },
    epic: {
        name:   'Epic Games',
        color:  '#0f0f0f',
        accent: '#ffffff',
        logoImg: '../assets/epic.svg',
        switchFn: switchEpicAccount,
        saveFn:   saveEpicAccount,
        addFn:    addNewEpicAccount
    },
    ea: {
        name:   'EA App',
        color:  '#ff4500',
        accent: '#ff6b35',
        logoImg: '../assets/ea.png',
        switchFn: switchEAAccount,
        saveFn:   saveEAAccount,
        addFn:    addNewEAAccount
    },
    riot: {
        name:   'Riot Games',
        color:  '#d13639',
        accent: '#ff4655',
        logoImg: '../assets/riot.png',
        switchFn: switchRiotAccount,
        saveFn:   saveRiotAccount,
        addFn:    addNewRiotAccount
    },
    ubisoft: {
        name:   'Ubisoft',
        color:  '#0070d1',
        accent: '#00a8ff',
        logoImg: '../assets/Ubisoft_white.png',
        switchFn: switchUbisoftAccount,
        saveFn:   saveUbisoftAccount,
        addFn:    addNewUbisoftAccount
    },
    discord: {
        name:   'Discord',
        color:  '#1e1f22', 
        accent: '#5865F2', 
        logoImg: '../assets/discord.webp',
        switchFn: switchDiscordAccount,
        saveFn:   saveDiscordAccount,
        addFn:    addNewDiscordAccount
    },
    rockstar: {
        name:   'Rockstar Games',
        color:  '#1a1100',         
        accent: '#fcaf17',        
        logoImg: '../assets/rockstar.png', 
        switchFn: switchRockstarAccount,
        saveFn:   saveRockstarAccount,
        addFn:    addNewRockstarAccount
    }
};

/**
 * renderAccountsView - بيبني الـ accounts view على اليمين
 */
async function renderAccountsView(platform) {
    const cfg = PLATFORM_CONFIG[platform];
    if (!cfg) return;

    // تحديد ما إذا كان اللوجو يحتاج فلتر الأبيض (مثل إيبك ويوبي سوفت)
    const isDarkLogo = platform === 'epic' || platform === 'ubisoft';
    
    // تحديد شكل اللوجو (صورة أو SVG لديسكورد)
    const logoHtml = cfg.logoImg 
        ? `<img src="${cfg.logoImg}" class="acc-hero-main-logo ${isDarkLogo ? 'invert-hero-logo' : ''}" alt="${cfg.name}">`
        : cfg.logo;

    const container = document.getElementById('accountsView');
    container.innerHTML = `
        <div class="accounts-page">
            <div class="accounts-hero-v2" style="--plat-color: ${cfg.color}; --plat-accent: ${cfg.accent};">
                
                <div class="hero-glow-blob blob-1"></div>
                <div class="hero-glow-blob blob-2"></div>
                <div class="hero-grid-overlay"></div>
                <div class="hero-watermark">${cfg.name.toUpperCase()}</div>

                <div class="accounts-hero-inner-row">
                    <div class="accounts-hero-content-v2">
                        <div class="acc-hero-logo-box">
                            ${logoHtml}
                        </div>
                        <div class="acc-hero-text">
                            <div class="acc-hero-platform-eyebrow">Platform</div>
                            <h1 class="acc-hero-title">${cfg.name}</h1>
                            <div class="acc-hero-meta-row">
                                <div class="acc-hero-badge">
                                    <span class="pulse-dot-mini" style="background: ${cfg.accent};"></span>
                                    Account Manager
                                </div>
                                <div class="acc-hero-stat"><strong id="heroAccountCount">—</strong> accounts saved</div>
                            </div>
                        </div>
                    </div>

                    <div class="accounts-hero-actions-v2">
                        ${cfg.saveFn ? `<button class="acc-btn acc-btn-secondary" onclick="handleSaveAccount('${platform}')">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
                            Save Current
                        </button>` : ''}
                        
                        <button class="acc-btn-help" style="--btn-accent: ${cfg.accent};" onclick="openTutorialModal('${platform}')" title="Watch Tutorial">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                            Need Help?
                        </button>

                        <button class="acc-btn acc-btn-primary" style="--btn-accent: ${cfg.accent};" onclick="addNewAccount('${platform}')">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                            Add New Account
                        </button>
                    </div>
                </div>

                <div class="acc-hero-tabs">
                    <div class="acc-hero-tab active">Saved Accounts</div>
                    ${platform === 'epic' ? `<div class="acc-hero-tab" id="epicLibraryTab" onclick="showEpicLibraryPanel()">Link Library</div>` : ''}
                </div>
            </div>

            <div id="accountsOnboardWrap" class="accounts-onboard-wrap" style="display:none;"></div>

            <div class="accounts-list-section" id="accountsListSection" style="--plat-accent: ${cfg.accent};">
                <div class="accounts-list-header">
                    <span class="accounts-list-label">Saved Accounts</span>
                    <span class="accounts-list-count" id="accountsCount">Loading...</span>
                </div>
                <div class="accounts-grid" id="accountsGrid">
                    <div class="accounts-loading">
                        <div class="acc-spinner"></div>
                        <span>Loading accounts...</span>
                    </div>
                </div>
            </div>

            ${platform === 'epic' ? `
            <div id="epicLibraryPanel" style="display:none;">
                <div class="accounts-list-section" style="--plat-accent: ${cfg.accent}; margin-top: 16px;">
                    <div class="accounts-list-header">
                        <span class="accounts-list-label">Epic Library Sync</span>
                        <span class="accounts-list-count" id="epicLibraryCount"></span>
                    </div>
                    <div id="epicLibraryContent" style="padding: 24px 0;">
                        <div class="accounts-loading"><div class="acc-spinner"></div><span>Checking status...</span></div>
                    </div>
                </div>
            </div>` : ''}
        </div>
    `;

    // جلب الـ accounts
    await loadAccountsForPlatform(platform);
}

/**
 * loadAccountsForPlatform - تجيب الـ accounts من الـ main process
 */
async function loadAccountsForPlatform(platform) {
    const grid = document.getElementById('accountsGrid');
    const countEl = document.getElementById('accountsCount');
    if (!grid) return;

    try {
        let profiles = [];
        let steamAccounts = [];

        if (platform === 'steam') {
            steamAccounts = await window.electronAPI.getSteamAccounts?.() || [];
            if (Array.isArray(steamAccounts)) {
                profiles = steamAccounts.map(a => a.username);
            }
        } else {
            const ipcFn = {
                epic:    () => window.electronAPI.getEpicProfiles?.()    || ipcInvoke('get-epic-profiles'),
                ea:      () => window.electronAPI.getEAProfiles?.()      || ipcInvoke('get-ea-profiles'),
                riot:    () => window.electronAPI.getRiotProfiles?.()    || ipcInvoke('get-riot-profiles'),
                ubisoft: () => window.electronAPI.getUbisoftProfiles?.() || ipcInvoke('get-ubisoft-profiles'),
                discord: () => window.electronAPI.getDiscordProfiles?.() || ipcInvoke('get-discord-profiles'),
                rockstar: () => window.electronAPI.getRockstarProfiles?.() || ipcInvoke('get-rockstar-profiles')
            };
            profiles = await (ipcFn[platform]?.() || Promise.resolve([]));
        }
        if (currentAccountPlatform !== platform) return;

        // تحديث الـ count في الـ sidebar
        const countSpan = document.getElementById(`${platform}Count`);
        if (countSpan) countSpan.textContent = Array.isArray(profiles) ? profiles.length : 0;

        const count = Array.isArray(profiles) ? profiles.length : 0;
        if (countEl) countEl.textContent = `${count} accounts`;
        const heroCount = document.getElementById('heroAccountCount');
        if (heroCount) heroCount.textContent = count;

        if (!Array.isArray(profiles) || profiles.length === 0) {
            const cfg = PLATFORM_CONFIG[platform];
            const accent = cfg?.accent || '#ffffff';
            const isLight = (function(hex) {
                const h = hex.replace('#','');
                if (h.length < 6) return false;
                const r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
                return (r*299 + g*587 + b*114) / 1000 > 128;
            })(accent);
            const numColor = isLight ? '#000' : '#fff';

            const isDarkLogo = platform === 'epic' || platform === 'ubisoft';
            const logoHtml = cfg?.logoImg
                ? `<img src="${cfg.logoImg}" ${isDarkLogo ? 'style="filter:brightness(0) invert(1);"' : ''} alt="${escapeHtml(cfg.name)}">`
                : '';

            const step = (n, text) =>
                `<div class="acc-onboard-step">
                    <div class="acc-onboard-step-num" style="background:${accent};color:${numColor};">${n}</div>
                    <div class="acc-onboard-step-text">${text}</div>
                </div>`;

            let stepsHtml, warningHtml = '', saveBtnHtml = '';

            if (!cfg?.saveFn) {
                stepsHtml =
                    step(1, `Click <strong>Add New Account</strong> below to open ${escapeHtml(cfg?.name ?? 'the launcher')}`) +
                    step(2, 'Sign in — Baddel saves your account automatically');
            } else if (platform === 'riot') {
                stepsHtml =
                    step(1, 'Click <strong>Add New Account</strong> — Riot Client will open') +
                    step(2, 'Sign in to the Riot account you want to save') +
                    step(3, 'Fully close Riot Client from the system tray (right-click → Quit)') +
                    step(4, 'Return here and click <strong>Save Current</strong>');
                warningHtml = `<div class="acc-onboard-warning">Riot Client <strong>must be fully closed</strong> from the system tray before saving — leaving it running will cause the save to fail.</div>`;
            } else {
                stepsHtml =
                    step(1, `Click <strong>Add New Account</strong> — ${escapeHtml(cfg.name)} will open`) +
                    step(2, 'Sign in to the account you want to save') +
                    step(3, 'Return here and click <strong>Save Current</strong>');
            }

            if (cfg?.saveFn) {
                saveBtnHtml = `
                    <button class="acc-onboard-btn-secondary" onclick="handleSaveAccount('${platform}')">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
                        Already logged in? Save Current
                    </button>`;
            }

            const onboardWrap   = document.getElementById('accountsOnboardWrap');
            const listSectionEl = document.getElementById('accountsListSection');
            if (listSectionEl) listSectionEl.style.display = 'none';
            if (onboardWrap) {
                onboardWrap.style.display = 'flex';
                onboardWrap.innerHTML = `
                    <div class="acc-onboard-card" style="border:1px solid ${accent}33;box-shadow:0 0 48px -18px ${accent}88;">
                        <div class="acc-onboard-top">
                            <div class="acc-onboard-logo">${logoHtml}</div>
                            <div>
                                <h2 class="acc-onboard-title">No ${escapeHtml(cfg?.name ?? platform)} accounts saved yet</h2>
                                <p class="acc-onboard-sub">Save the account currently signed in to ${escapeHtml(cfg?.name ?? 'the launcher')}, or add a new one to get started.</p>
                            </div>
                        </div>
                        <div class="acc-onboard-steps">${stepsHtml}</div>
                        ${warningHtml}
                        <div class="acc-onboard-actions">
                            <button class="acc-onboard-btn-primary" style="background:${accent};color:${numColor};" onclick="addNewAccount('${platform}')">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                                Add New Account
                            </button>
                            ${saveBtnHtml}
                        </div>
                    </div>
                `;
            }
            return;
        }

        const onboardWrapFull   = document.getElementById('accountsOnboardWrap');
        const listSectionFull   = document.getElementById('accountsListSection');
        if (onboardWrapFull) onboardWrapFull.style.display = 'none';
        if (listSectionFull) listSectionFull.style.display = '';

        // رندر الـ account cards
        grid.innerHTML = '';
        const cfg = PLATFORM_CONFIG[platform];
        const shortcutsMap = await _loadShortcutsMap();

        if (platform === 'steam' && steamAccounts.length > 0) {
            steamAccounts.forEach((acc, i) => {
                const shortcut = shortcutsMap.get(`steam::${acc.username}`) || null;
                grid.appendChild(createSteamAccountCard(acc, cfg, i, shortcut));
            });
        } else if (platform === 'discord' && profiles.length > 0) {
            profiles.forEach((profileObj, i) => {
                const pName = typeof profileObj === 'string' ? profileObj : (profileObj.name || profileObj.username || '');
                const shortcut = shortcutsMap.get(`discord::${pName}`) || null;
                grid.appendChild(createDiscordAccountCard(profileObj, cfg, i, shortcut));
            });
        } else {
            profiles.forEach((profile, i) => {
                // بعد enrichProfilesWithSyncData، profile بقى object دايمًا
                const profileName = typeof profile === 'string'
                    ? profile
                    : (profile.name || profile.username || profile.displayName || String(profile.id || ''));
                const shortcut = shortcutsMap.get(`${platform}::${profileName}`) || null;
                grid.appendChild(createAccountCard(profileName, platform, cfg, i, shortcut));
            });
        }

    } catch (err) {
        console.error(`Failed to load ${platform} accounts:`, err);
        grid.innerHTML = `<div class="accounts-empty"><p style="color:#ff3b30;">Error loading accounts</p><span>${escapeHtml(String(err.message || err))}</span></div>`;
    }
}

// ── Account Shortcut helpers ─────────────────────────────────────────────────

async function _loadShortcutsMap() {
    if (!window.electronAPI?.accountShortcuts?.list) return new Map();
    try {
        const list = await window.electronAPI.accountShortcuts.list();
        if (!Array.isArray(list)) return new Map();
        const map = new Map();
        for (const s of list) map.set(`${s.platform}::${s.accountId}`, s);
        return map;
    } catch { return new Map(); }
}

function _shortcutBtnHtml(shortcut) {
    const kbdIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/></svg>`;
    if (shortcut) {
        return `<button class="acc-shortcut-btn has-shortcut" title="Shortcut: ${escapeHtml(shortcut.accelerator)} — Click to change" data-action="shortcut"><span class="acc-shortcut-pill">${escapeHtml(shortcut.accelerator)}</span></button>`;
    }
    return `<button class="acc-shortcut-btn" title="Set keyboard shortcut" data-action="shortcut">${kbdIcon}</button>`;
}

function _updateCardShortcutBtn(card, shortcut) {
    const btn = card.querySelector('[data-action="shortcut"]');
    if (!btn) return;
    const kbdIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/></svg>`;
    if (shortcut) {
        btn.className = 'acc-shortcut-btn has-shortcut';
        btn.title = `Shortcut: ${shortcut.accelerator} — Click to change`;
        btn.innerHTML = `<span class="acc-shortcut-pill">${escapeHtml(shortcut.accelerator)}</span>`;
    } else {
        btn.className = 'acc-shortcut-btn';
        btn.title = 'Set keyboard shortcut';
        btn.innerHTML = kbdIcon;
    }
}

// Renderer-side validation for the shortcut capture modal.
// Intentionally mirrors the main-process validation so the user gets instant
// feedback — but the IPC handler in main.js is still the final authority.
function validateShortcutCapture(accelerator) {
    if (!accelerator || typeof accelerator !== 'string') {
        return { valid: false, message: '', normalized: '' };
    }
    const MODIFIER_KEYS = new Set(['ctrl', 'control', 'shift', 'alt', 'meta', 'super', 'command']);
    const BLOCKED = new Set([
        'Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+A', 'Ctrl+Z', 'Ctrl+S',
        'Ctrl+P', 'Ctrl+F', 'Ctrl+R', 'Ctrl+W', 'Ctrl+T', 'Ctrl+N', 'Ctrl+Q',
        'Alt+Tab', 'Ctrl+Alt+Delete', 'Meta+L', 'Super+L',
    ]);
    const REJECT_KEYS = new Set(['enter', 'escape', 'backspace', 'delete', 'tab']);

    const parts = accelerator.split('+').map(p => p.trim()).filter(Boolean);
    const mods = parts.filter(p => MODIFIER_KEYS.has(p.toLowerCase()));
    const keys = parts.filter(p => !MODIFIER_KEYS.has(p.toLowerCase()));

    if (keys.length === 0) {
        return { valid: false, message: 'Include a non-modifier key, for example Ctrl + Alt + H.', normalized: '' };
    }

    const rawKey = keys[0];
    if (REJECT_KEYS.has(rawKey.toLowerCase())) {
        return { valid: false, message: `"${rawKey}" cannot be used as the shortcut key.`, normalized: '' };
    }

    // Normalise modifier display order: Ctrl → Shift → Alt → Super.
    const MOD_ORDER = ['Ctrl', 'Shift', 'Alt', 'Super'];
    const normMods = [...new Set(mods.map(m => {
        const l = m.toLowerCase();
        if (l === 'control' || l === 'commandorcontrol') return 'Ctrl';
        if (l === 'meta' || l === 'command' || l === 'super') return 'Super';
        return m.charAt(0).toUpperCase() + m.slice(1).toLowerCase();
    }))];
    normMods.sort((a, b) => {
        const ai = MOD_ORDER.indexOf(a), bi = MOD_ORDER.indexOf(b);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

    const normKey = rawKey.length === 1 ? rawKey.toUpperCase() : rawKey;
    const ipc     = [...normMods, normKey].join('+');      // Ctrl+Alt+K  (sent to IPC)
    const display = [...normMods, normKey].join(' + ');    // Ctrl + Alt + K (shown in UI)

    if (BLOCKED.has(ipc)) {
        return { valid: false, message: `${display} is reserved by the system. Try a different combination.`, normalized: display };
    }

    if (normMods.length < 2) {
        const exKey = normKey.length === 1 ? normKey : 'H';
        const example = [...normMods, 'Alt', exKey].join(' + ');
        return {
            valid: false,
            message: `Use at least 2 modifier keys — for example ${example}.`,
            normalized: display,
        };
    }

    return { valid: true, message: '', normalized: display };
}

function openShortcutCaptureModal(platform, accountId, accountName, accent, existingShortcut) {
    return new Promise((resolve) => {
        // capturedRaw  = 'Ctrl+Alt+K'  (no spaces — passed to IPC)
        // capturedValid, capturedMessage, capturedDisplay track live validation state.
        let capturedRaw     = existingShortcut || null;
        let capturedValid   = false;
        let capturedMessage = '';
        let capturedDisplay = '';

        if (capturedRaw) {
            const v = validateShortcutCapture(capturedRaw);
            capturedValid   = v.valid;
            capturedMessage = v.message;
            capturedDisplay = v.normalized || capturedRaw;
        }

        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.82);z-index:99999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(5px);';

        const box = document.createElement('div');
        box.style.cssText = 'background:#1a1a1a;padding:28px 24px;border-radius:14px;width:360px;display:flex;flex-direction:column;gap:16px;border:1px solid #2e2e2e;box-shadow:0 16px 48px rgba(0,0,0,0.6);font-family:sans-serif;';

        const title = document.createElement('div');
        title.style.cssText = 'color:#fff;font-size:15px;font-weight:600;';
        title.textContent = `Keyboard shortcut for "${accountName}"`;

        const sub = document.createElement('div');
        sub.style.cssText = 'color:#777;font-size:12px;margin-top:-8px;line-height:1.5;';
        sub.textContent = 'Press a key combination while this window is open. Requires Ctrl, Shift, or Alt plus at least one other modifier.';

        const captureBox = document.createElement('div');
        captureBox.className = 'shortcut-capture-box';

        const errorEl = document.createElement('div');
        errorEl.className = 'shortcut-error';

        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;margin-top:4px;';

        const clearBtn = document.createElement('button');
        clearBtn.textContent = 'Clear shortcut';
        clearBtn.style.cssText = 'padding:8px 14px;background:transparent;border:1px solid #444;border-radius:7px;color:#aaa;cursor:pointer;font-size:12px;';
        clearBtn.style.display = existingShortcut ? '' : 'none';

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.cssText = 'padding:8px 14px;background:transparent;border:1px solid #444;border-radius:7px;color:#ccc;cursor:pointer;font-size:13px;';

        const saveBtn = document.createElement('button');
        saveBtn.className = 'shortcut-save-btn';
        saveBtn.textContent = 'Save';
        saveBtn.style.cssText = `padding:8px 18px;background:${accent};border:none;border-radius:7px;cursor:pointer;font-weight:600;font-size:13px;transition:opacity 0.15s,filter 0.15s;`;
        saveBtn.style.color = typeof isColorLight === 'function' && isColorLight(accent) ? '#000' : '#fff';

        btnRow.append(clearBtn, cancelBtn, saveBtn);
        box.append(title, sub, captureBox, errorEl, btnRow);
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        // Sync the entire modal UI to the current capture state.
        function _refreshUI() {
            if (!capturedRaw) {
                captureBox.className = 'shortcut-capture-box';
                captureBox.textContent = 'Press a shortcut like Ctrl + Alt + H';
                errorEl.textContent = '';
                saveBtn.disabled = true;
            } else if (capturedValid) {
                captureBox.className = 'shortcut-capture-box is-valid';
                captureBox.textContent = capturedDisplay;
                errorEl.textContent = '';
                saveBtn.disabled = false;
            } else {
                captureBox.className = 'shortcut-capture-box is-invalid';
                captureBox.textContent = capturedDisplay || capturedRaw;
                errorEl.textContent = capturedMessage;
                saveBtn.disabled = true;
            }
        }

        _refreshUI();

        const onKeyDown = (e) => {
            const pureMods = ['Control', 'Shift', 'Alt', 'Meta', 'Super', 'AltGraph'];
            if (pureMods.includes(e.key)) return;
            e.preventDefault();
            e.stopPropagation();

            if (e.key === 'Escape') { cleanup(); resolve('cancel'); return; }
            if (e.key === 'Backspace' || e.key === 'Delete') {
                capturedRaw     = null;
                capturedValid   = false;
                capturedMessage = '';
                capturedDisplay = '';
                _refreshUI();
                return;
            }

            const mods = [];
            if (e.ctrlKey)  mods.push('Ctrl');
            if (e.shiftKey) mods.push('Shift');
            if (e.altKey)   mods.push('Alt');
            if (e.metaKey)  mods.push('Super');

            let key = e.key;
            if (key === ' ') key = 'Space';
            if (key.length === 1) key = key.toUpperCase();

            capturedRaw = [...mods, key].join('+');
            const v = validateShortcutCapture(capturedRaw);
            capturedValid   = v.valid;
            capturedMessage = v.message;
            capturedDisplay = v.normalized || capturedRaw;
            _refreshUI();
        };
        document.addEventListener('keydown', onKeyDown, true);

        const cleanup = () => {
            document.removeEventListener('keydown', onKeyDown, true);
            if (document.body.contains(overlay)) document.body.removeChild(overlay);
        };

        clearBtn.onclick = async () => {
            try { await window.electronAPI.accountShortcuts.clear({ platform, accountId }); } catch {}
            cleanup();
            resolve(null);
        };

        cancelBtn.onclick = () => { cleanup(); resolve('cancel'); };

        saveBtn.onclick = async () => {
            if (!capturedRaw || !capturedValid) {
                errorEl.textContent = capturedMessage || 'Press a valid key combination first.';
                return;
            }
            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving…';
            try {
                const result = await window.electronAPI.accountShortcuts.set({ platform, accountId, accountName, accelerator: capturedRaw });
                if (result?.status === 'error') {
                    errorEl.textContent = result.message;
                    capturedValid = false;
                    _refreshUI();
                    saveBtn.textContent = 'Save';
                    return;
                }
                cleanup();
                resolve(capturedRaw);
            } catch (err) {
                errorEl.textContent = err.message || 'Failed to save shortcut.';
                capturedValid = false;
                _refreshUI();
                saveBtn.textContent = 'Save';
            }
        };
    });
}

/**
 * createAccountCard - بيعمل card للـ account العادي (Epic, EA, Riot, Ubisoft)
 */
function createAccountCard(profileName, platform, cfg, index = 0, shortcut = null) {
    // تأمين: لو جاء object بدل string نسحب منه الاسم
    if (typeof profileName === 'object' && profileName !== null) {
        profileName = profileName.name || profileName.username || profileName.displayName || String(profileName.id || '');
    }
    profileName = String(profileName || '');

    const card = document.createElement('div');
    card.className = 'account-card';
    card.setAttribute('data-profile', profileName);

    const initials = profileName.substring(0, 2).toUpperCase();
    const indexStr = String(index + 1).padStart(2, '0');

    // 🔴 فحص هل الأكاونت متثبت؟
    let pinnedArr = JSON.parse(localStorage.getItem('baddel_pinned_accounts') || '[]');
    let isPinned = pinnedArr.some(p => p.platform === platform && p.profileName === profileName);
    let pinClass = isPinned ? 'acc-pin-btn is-pinned' : 'acc-pin-btn';

    const _eName = escapeHtml(profileName);
    card.innerHTML = `
        <div class="acc-card-num">${indexStr}</div>
        <div class="acc-card-avatar" style="--acc-color: ${cfg.accent};">
            <span>${initials}</span>
        </div>
        <div class="acc-card-info">
            <div class="acc-card-name">${_eName}</div>
            <div class="acc-card-platform">${escapeHtml(cfg.name)}</div>
        </div>
        <div class="acc-card-actions">
            <button class="${pinClass}" title="Send to Home" data-action="pin">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path></svg>
            </button>
            <button class="acc-switch-btn" style="--btn-accent: ${cfg.accent};" data-action="switch">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>
                Switch
            </button>
            ${_shortcutBtnHtml(shortcut)}
            <button class="acc-rename-btn" title="Rename Account" data-action="rename">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4L18.5 2.5z"></path></svg>
            </button>
            <button class="acc-delete-btn" data-action="delete">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>
            </button>
        </div>
    `;
    card.querySelector('[data-action="pin"]').addEventListener('click', function() {
        handlePinAccount(platform, profileName, null, null, null, this);
    });
    card.querySelector('[data-action="switch"]').addEventListener('click', function() {
        handleSwitchAccount(platform, profileName, this);
    });
    card.querySelector('[data-action="shortcut"]').addEventListener('click', async () => {
        const current = shortcut;
        const result = await openShortcutCaptureModal(platform, profileName, profileName, cfg.accent, current?.accelerator || null);
        if (result === 'cancel') return;
        const newMap = await _loadShortcutsMap();
        const updated = newMap.get(`${platform}::${profileName}`) || null;
        shortcut = updated;
        _updateCardShortcutBtn(card, updated);
        if (typeof showToast === 'function') {
            if (result === null) showToast('Shortcut cleared', 'success');
            else showToast(`Shortcut set: ${result}`, 'success');
        }
    });
    card.querySelector('[data-action="rename"]').addEventListener('click', () => handleRenameAccount(platform, profileName));
    card.querySelector('[data-action="delete"]').addEventListener('click', () => handleDeleteAccount(platform, profileName));
    return card;
}

/**
 * createDiscordAccountCard - card مخصص لديسكورد لعرض الصورة واليوزرنيم
 */
/**
 * createDiscordAccountCard - card مخصص لديسكورد لعرض الصورة واليوزرنيم
 */
function createDiscordAccountCard(profile, cfg, index = 0, shortcut = null) {
    // تأمين: نتأكد إن profile object وعنده name
    if (typeof profile === 'string') {
        profile = { name: profile, username: profile };
    }
    const profileName = String(profile.name || profile.username || profile.displayName || '');

    const card = document.createElement('div');
    card.className = 'account-card';
    card.setAttribute('data-profile', profileName);

    const indexStr = String(index + 1).padStart(2, '0');
    const _eName = escapeHtml(profileName);
    const _eAvatarUrl = safeImageUrl(profile.avatarUrl || '');
    const avatarHtml = _eAvatarUrl
        ? `<img src="${_eAvatarUrl}" alt="${_eName}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
        : `<span>${escapeHtml(profileName.substring(0, 2).toUpperCase())}</span>`;
    const discordUser = profile.discordUsername ? String(profile.discordUsername) : '';
    const usernameDisplay = discordUser ? `@${escapeHtml(discordUser)}` : escapeHtml(cfg.name);
    const copyBtnHtml = discordUser
        ? `<svg data-action="copy-username" title="Copy Username" style="cursor:pointer; opacity:0.4; transition:0.2s;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.4'" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`
        : '';

    // 🔴 فحص هل الأكاونت متثبت؟
    let pinnedArr = JSON.parse(localStorage.getItem('baddel_pinned_accounts') || '[]');
    let isPinned = pinnedArr.some(p => p.platform === 'discord' && p.profileName === profileName);
    let pinClass = isPinned ? 'acc-pin-btn is-pinned' : 'acc-pin-btn';

    card.innerHTML = `
        <div class="acc-card-num">${indexStr}</div>
        <div class="acc-card-avatar" style="--acc-color: ${cfg.accent}; border-radius: 50%;">${avatarHtml}</div>
        <div class="acc-card-info">
            <div class="acc-card-name">${_eName}</div>
            <div class="acc-card-platform" style="display: flex; align-items: center; gap: 6px;">${usernameDisplay} ${copyBtnHtml}</div>
        </div>
        <div class="acc-card-actions">
            <button class="${pinClass}" title="Send to Home" data-action="pin">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path></svg>
            </button>
            <button class="acc-switch-btn" style="--btn-accent: ${cfg.accent};" data-action="switch">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>
                Switch
            </button>
            ${_shortcutBtnHtml(shortcut)}
            <button class="acc-rename-btn" title="Rename Account" data-action="rename">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4L18.5 2.5z"></path></svg>
            </button>
            <button class="acc-delete-btn" data-action="delete">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>
            </button>
        </div>
    `;
    if (discordUser) {
        const copySvg = card.querySelector('[data-action="copy-username"]');
        if (copySvg) copySvg.addEventListener('click', (e) => copyToClipboard(discordUser, e));
    }
    card.querySelector('[data-action="pin"]').addEventListener('click', function() {
        handlePinAccount('discord', profileName, profileName, null, profile.avatarUrl || null, this);
    });
    card.querySelector('[data-action="switch"]').addEventListener('click', function() {
        handleSwitchAccount('discord', profileName, this);
    });
    card.querySelector('[data-action="shortcut"]').addEventListener('click', async () => {
        const result = await openShortcutCaptureModal('discord', profileName, profileName, cfg.accent, shortcut?.accelerator || null);
        if (result === 'cancel') return;
        const newMap = await _loadShortcutsMap();
        const updated = newMap.get(`discord::${profileName}`) || null;
        shortcut = updated;
        _updateCardShortcutBtn(card, updated);
        if (typeof showToast === 'function') {
            if (result === null) showToast('Shortcut cleared', 'success');
            else showToast(`Shortcut set: ${result}`, 'success');
        }
    });
    card.querySelector('[data-action="rename"]').addEventListener('click', () => handleRenameAccount('discord', profileName));
    card.querySelector('[data-action="delete"]').addEventListener('click', () => handleDeleteAccount('discord', profileName));
    return card;
}

// ============================================================
// 4. كارت ستيم
// ============================================================
function createSteamAccountCard(acc, cfg, index = 0, shortcut = null) {
    const card = document.createElement('div');
    card.className = 'account-card';
    card.setAttribute('data-profile', acc.username);

    const initials = (acc.displayName || acc.username).substring(0, 2).toUpperCase();
    const indexStr = String(index + 1).padStart(2, '0');

    // 🔴 فحص هل الأكاونت متثبت؟
    let pinnedArr = JSON.parse(localStorage.getItem('baddel_pinned_accounts') || '[]');
    let isPinned = pinnedArr.some(p => p.platform === 'steam' && p.profileName === acc.username);
    let pinClass = isPinned ? 'acc-pin-btn is-pinned' : 'acc-pin-btn';

    const _eSteamId  = escapeHtml(String(acc.steamId || ''));
    const _eUsername = escapeHtml(String(acc.username || ''));
    const _eDisplay  = escapeHtml(String(acc.displayName || acc.username || ''));
    card.innerHTML = `
        <div class="acc-card-num">${indexStr}</div>
        <div class="acc-card-avatar" style="--acc-color: ${cfg.accent}; border-radius: 50%;" id="avatar-${_eSteamId}">
            <span>${escapeHtml(initials)}</span>
        </div>
        <div class="acc-card-info">
            <div class="acc-card-name">${_eDisplay}</div>
            <div class="acc-card-platform">@${_eUsername}</div>
        </div>
        <div class="acc-card-actions">
            <button class="${pinClass}" title="Send to Home" data-action="pin">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path></svg>
            </button>
            <button class="acc-switch-btn" style="--btn-accent: ${cfg.accent};" data-action="switch">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>
                Switch
            </button>
            ${_shortcutBtnHtml(shortcut)}
        </div>
    `;
    card.querySelector('[data-action="pin"]').addEventListener('click', function() {
        handlePinAccount('steam', acc.username, acc.displayName || acc.username, acc.steamId, null, this);
    });
    card.querySelector('[data-action="switch"]').addEventListener('click', function() {
        handleSwitchAccount('steam', acc.username, this);
    });
    card.querySelector('[data-action="shortcut"]').addEventListener('click', async () => {
        const result = await openShortcutCaptureModal('steam', acc.username, acc.displayName || acc.username, cfg.accent, shortcut?.accelerator || null);
        if (result === 'cancel') return;
        const newMap = await _loadShortcutsMap();
        const updated = newMap.get(`steam::${acc.username}`) || null;
        shortcut = updated;
        _updateCardShortcutBtn(card, updated);
        if (typeof showToast === 'function') {
            if (result === null) showToast('Shortcut cleared', 'success');
            else showToast(`Shortcut set: ${result}`, 'success');
        }
    });
    loadSteamAvatar(acc.steamId, `avatar-${acc.steamId}`, acc.displayName || acc.username);
    return card;
}

// 🟢 دالة النسخ (حطها في أي مكان فاضي في ملف accounts.js)
function copyToClipboard(text, event) {
    event.stopPropagation(); // عشان الكارت ميعملش أكشن بالغلط وإنت بتدوس
    navigator.clipboard.writeText(text).then(() => {
        showToast(`Copied: ${text}`, 'success');
    }).catch(() => {
        showToast('Failed to copy', 'error');
    });
}


async function loadSteamAvatar(steamId, elementId, displayName) {
    try {
        if (!window.electronAPI.getSteamImage) return;
        const imgUrl = await window.electronAPI.getSteamImage(steamId);
        if (imgUrl) {
            const el = document.getElementById(elementId);
            if (el) {
                const safeUrl = safeImageUrl(imgUrl);
                if (safeUrl) {
                    el.innerHTML = `<img src="${safeUrl}" alt="${escapeHtml(displayName)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
                }
            }
        }
    } catch (e) {
        // silent fail - الـ initials تفضل
    }
}

// ============================================================
// دالة حفظ / تثبيت الأكاونت (Pin/Send to Home)
// ============================================================
window.handlePinAccount = function(platform, profileName, displayName = null, extraId = null, avatarUrl = null, btnEl = null) {
    let pinned = JSON.parse(localStorage.getItem('baddel_pinned_accounts') || '[]');
    
    const exists = pinned.find(p => p.platform === platform && p.profileName === profileName);
    
    if (exists) {
        pinned = pinned.filter(p => !(p.platform === platform && p.profileName === profileName));
        if(typeof showToast === 'function') showToast('Removed from Home', 'success');
        if (btnEl && btnEl.classList) btnEl.classList.remove('is-pinned'); // نشيل اللون
    } else {
        pinned.push({ 
            platform, 
            profileName, 
            displayName: displayName || profileName, 
            extraId,
            avatarUrl
        });
        if(typeof showToast === 'function') showToast('Pinned to Home!', 'success');
        if (btnEl && btnEl.classList) btnEl.classList.add('is-pinned'); // ننور الزرار
    }
    
    localStorage.setItem('baddel_pinned_accounts', JSON.stringify(pinned));
    
    if (typeof renderAccountShortcuts === 'function') {
        renderAccountShortcuts();
    }
};
// ============================================================
// SECTION 5: ACTION HANDLERS
// ============================================================

/**
 * handleSwitchAccount - بيتعامل مع الضغط على Switch
 */
/**
 * handleSwitchAccount - بيتعامل مع الضغط على Switch
 */
/**
 * handleSwitchAccount - بيتعامل مع الضغط على Switch
 */
/**
 * handleSwitchAccount - بيتعامل مع الضغط على Switch
 */
async function handleSwitchAccount(platform, profileName, btnEl) {
    if (isAccountProcessing) {
        showToast("Please wait, an operation is already in progress...", "warning");
        return;
    }

    isAccountProcessing = true; 

    const originalContent = btnEl.innerHTML;
    // 🟢 1. نعرف هل ده الزرار الصغير بتاع الـ Home ولا الكبير؟
    const isShortcutBtn = btnEl.classList.contains('asc-play-btn');

    // 🟢 2. لو صغير نحط سبينر بس، لو كبير نحط الكلام
    btnEl.innerHTML = isShortcutBtn 
        ? `<div class="acc-mini-spinner"></div>` 
        : `<div class="acc-mini-spinner"></div> Launching...`;
        
    btnEl.disabled = true;
    btnEl.style.opacity = '0.7';

    const allSwitchBtns = document.querySelectorAll('.acc-switch-btn, .asc-play-btn');
    allSwitchBtns.forEach(btn => {
        if (btn !== btnEl) {
            btn.style.pointerEvents = 'none';
            btn.style.opacity = '0.4';
        }
    });

    try {
        const cfg = PLATFORM_CONFIG[platform];
        await cfg.switchFn(profileName);
        showToast(`Switched to ${profileName}! Starting launcher...`, 'success');

        
        // 🟢 3. فترة النقاهة (برضه سبينر بس للزرار الصغير)
        btnEl.innerHTML = isShortcutBtn 
            ? `<div class="acc-mini-spinner" style="border-top-color: #30d158;"></div>` // سبينر لونه أخضر عشان يبان إنه بيخلص
            : `<div class="acc-mini-spinner"></div> Stabilizing...`;
            
        await new Promise(r => setTimeout(r, 8000)); 

    } catch (err) {
        console.error(`Switch error for ${platform}:`, err);
        const code = err.code || '';
        if (code === 'LAUNCHER_NOT_INSTALLED' || code === 'RIOT_CLIENT_NOT_FOUND' ||
            code.endsWith('_LAUNCHER_NOT_FOUND') || code.endsWith('_NOT_FOUND')) {
            // Restore UI before showing the modal
            btnEl.innerHTML = originalContent;
            btnEl.disabled = false;
            btnEl.style.opacity = '1';
            allSwitchBtns.forEach(btn => { btn.style.pointerEvents = 'auto'; if (btn !== btnEl) btn.style.opacity = '1'; });
            isAccountProcessing = false;
            await showLauncherLocatorDialog(platform, () => cfg.switchFn(profileName));
            return;
        }
        showToast(`Switch failed: ${err.message || err}`, 'error');
    } finally {
        btnEl.innerHTML = originalContent;
        btnEl.disabled = false;
        btnEl.style.opacity = '1';

        allSwitchBtns.forEach(btn => {
            btn.style.pointerEvents = 'auto';
            if (btn !== btnEl) btn.style.opacity = '1';
        });

        isAccountProcessing = false;
    }
}

/**
 * handleSaveAccount - بيحفظ الحساب الحالي
 */
async function handleSaveAccount(platform) {
    if (isAccountProcessing) {
        showToast("Please wait for the current action to finish", "warning");
        return;
    }
    
    const name = await promptAccountName(
        `Save current ${PLATFORM_CONFIG[platform].name} account as:`,
        PLATFORM_CONFIG[platform].accent
    );
    if (!name) return;

    isAccountProcessing = true; // قفل العمليات
    showToast(`Saving ${name}...`, 'success');

    try {
        const cfg = PLATFORM_CONFIG[platform];
        await cfg.saveFn(name);
        showToast(`${name} saved!`, 'success');
        await loadAccountsForPlatform(platform);
    } catch (err) {
        showToast(`Save failed: ${err}`, 'error');
    } finally {
        isAccountProcessing = false; // فتح العمليات تاني
    }
}

/**
 * addNewAccount - يفتح لوجن جديد للـ platform
 */
async function addNewAccount(platform) {
    if (isAccountProcessing) return;

    isAccountProcessing = true;
    const cfg = PLATFORM_CONFIG[platform];
    showToast(`Preparing ${cfg.name}...`, 'info');

    try {
        const result = await cfg.addFn();
        if (result && (result.success === false || result.status === 'error')) {
            // Structured launcher-not-found response
            const code = result.code || '';
            if (code === 'LAUNCHER_NOT_INSTALLED' || code === 'RIOT_CLIENT_NOT_FOUND' ||
                code.endsWith('_LAUNCHER_NOT_FOUND') || code.endsWith('_NOT_FOUND')) {
                isAccountProcessing = false;
                await showLauncherLocatorDialog(platform, () => cfg.addFn());
                return;
            }
            showToast(result.message || 'Operation failed.', 'error');
            return;
        }
        showToast(`${cfg.name} is opening...`, 'success');
    } catch (err) {
        const code = err.code || '';
        if (code === 'LAUNCHER_NOT_INSTALLED' || code === 'RIOT_CLIENT_NOT_FOUND' ||
            code.endsWith('_LAUNCHER_NOT_FOUND') || code.endsWith('_NOT_FOUND')) {
            isAccountProcessing = false;
            await showLauncherLocatorDialog(platform, () => cfg.addFn());
            return;
        }
        showToast(err.message || String(err), 'error');
    } finally {
        isAccountProcessing = false;
    }
}

/**
 * Shows a modal when a launcher cannot be found automatically.
 * Generic for all platforms — uses PLATFORM_CONFIG for name and accent colour.
 * On success the saved path is used to retry the add-account flow.
 */
async function showLauncherLocatorDialog(platform, retryFn) {
    const cfg    = PLATFORM_CONFIG[platform] || { name: platform, accent: '#ffffff' };
    const accent = cfg.accent || '#ffffff';

    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.82);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);';

        const box = document.createElement('div');
        box.style.cssText = `background:#1a1a1a;padding:28px 24px;border-radius:12px;width:400px;display:flex;flex-direction:column;gap:18px;border:1px solid #333;box-shadow:0 12px 40px rgba(0,0,0,0.6);font-family:sans-serif;`;

        const icon = document.createElement('div');
        icon.textContent = '⚠';
        icon.style.cssText = `color:${accent};font-size:28px;text-align:center;`;

        const title = document.createElement('div');
        title.textContent = `${cfg.name} Not Found`;
        title.style.cssText = 'color:#fff;font-size:17px;font-weight:700;text-align:center;';

        const msg = document.createElement('div');
        msg.textContent = `${cfg.name} was not found automatically. If it is installed, locate the launcher executable manually.`;
        msg.style.cssText = 'color:#aaa;font-size:13px;line-height:1.6;text-align:center;';

        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;gap:10px;justify-content:center;flex-wrap:wrap;';

        const locateBtn = document.createElement('button');
        locateBtn.textContent = `Locate ${cfg.name}`;
        locateBtn.style.cssText = `background:${accent};color:${isColorLight(accent) ? '#000' : '#fff'};border:none;padding:10px 20px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;flex:1;min-width:130px;`;

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.cssText = 'background:#2a2a2a;color:#aaa;border:1px solid #444;padding:10px 20px;border-radius:8px;cursor:pointer;font-size:13px;flex:1;min-width:100px;';

        const dismiss = () => { overlay.remove(); resolve(); };
        cancelBtn.addEventListener('click', dismiss);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) dismiss(); });

        locateBtn.addEventListener('click', async () => {
            locateBtn.disabled = true;
            locateBtn.textContent = 'Opening…';
            try {
                // Use legacy Riot API for backwards compat, generic API for all others
                const res = platform === 'riot'
                    ? await window.electronAPI.selectRiotClientManually?.()
                    : await window.electronAPI.selectLauncherManually?.(platform);

                if (!res)              { dismiss(); return; }
                if (res.canceled)      { dismiss(); return; }

                if (res.success) {
                    dismiss();
                    showToast(`${cfg.name} located. Opening…`, 'success');
                    // Retry the original flow with the newly saved path
                    try {
                        const retryResult = retryFn ? await retryFn() : await cfg.addFn?.();
                        if (retryResult && (retryResult.success === false || retryResult.status === 'error')) {
                            showToast(retryResult.message || `Failed to launch ${cfg.name}.`, 'error');
                        } else {
                            showToast(`${cfg.name} is opening...`, 'success');
                        }
                    } catch (retryErr) {
                        showToast(retryErr.message || String(retryErr), 'error');
                    }
                } else {
                    msg.textContent = res.message || `The selected file is not valid for ${cfg.name}.`;
                    msg.style.color = accent;
                    locateBtn.disabled = false;
                    locateBtn.textContent = `Locate ${cfg.name}`;
                }
            } catch (e) {
                msg.textContent = e.message || 'Failed to open file dialog.';
                msg.style.color = accent;
                locateBtn.disabled = false;
                locateBtn.textContent = `Locate ${cfg.name}`;
            }
        });

        btnRow.appendChild(locateBtn);
        btnRow.appendChild(cancelBtn);
        box.appendChild(icon);
        box.appendChild(title);
        box.appendChild(msg);
        box.appendChild(btnRow);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
    });
}

// Kept as a shim so any remaining direct callers still work.
async function showRiotClientLocatorDialog() {
    return showLauncherLocatorDialog('riot');
}

function isColorLight(hex) {
    const c = hex.replace('#', '');
    if (c.length < 6) return false;
    const r = parseInt(c.substring(0,2), 16);
    const g = parseInt(c.substring(2,4), 16);
    const b = parseInt(c.substring(4,6), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 > 180;
}

async function handleRenameAccount(platform, oldName) {
    if (isAccountProcessing) return;
    const newName = await promptAccountName(
        `Rename "${oldName}" to:`,
        PLATFORM_CONFIG[currentAccountPlatform]?.accent || '#ff4655'
    );
    if (!newName || newName === oldName) return;

    isAccountProcessing = true;
    try {
        // 1. تحديد الدالة المناسبة حسب المنصة
        const methodMap = {
            riot: 'renameRiotProfile',
            ubisoft: 'renameUbisoftProfile',
            discord: 'renameDiscordProfile',
            epic: 'renameEpicProfile',
            ea: 'renameEaProfile',
            rockstar: 'renameRockstarProfile'
        };

        const methodName = methodMap[platform];

        if (!window.electronAPI[methodName]) {
            throw new Error(`Function ${methodName} is missing in preload.js`);
        }

        // 2. استدعاء الدالة 
        const result = await window.electronAPI[methodName](oldName, newName);

        // 3. التأكد إن الباك-إند مرجعش error مخفي
        if (result && result.status === 'error') {
            throw new Error(result.message);
        }

        showToast("Renamed successfully", "success");

        // تحديث الأكاونت لو كان متثبت (Pinned)
        let pinned = JSON.parse(localStorage.getItem('baddel_pinned_accounts') || '[]');
        let changed = false;
        pinned.forEach(p => {
            if (p.platform === platform && p.profileName === oldName) {
                p.profileName = newName;
                if (p.displayName === oldName) p.displayName = newName;
                changed = true;
            }
        });
        if (changed) {
            localStorage.setItem('baddel_pinned_accounts', JSON.stringify(pinned));
            if (typeof renderAccountShortcuts === 'function') renderAccountShortcuts();
        }

        await loadAccountsForPlatform(platform);
    } catch (err) {
        showToast(err.message, "error");
    } finally {
        isAccountProcessing = false;
    }
}

/**
 * handleDeleteAccount - بيحذف account محفوظ
 */
function handleDeleteAccount(platform, profileName) {
    openConfirmModal(
        'Delete Account?',
        `Delete saved data for "${profileName}"? This cannot be undone.`,
        'Delete',
        async () => {
            try {
                await ipcInvoke(`delete-${platform}-profile`, profileName);
                showToast(`${profileName} deleted.`, 'success');

                // 🟢 التعديل: مسح الأكونت من اللي متثبتين بره
                let pinned = JSON.parse(localStorage.getItem('baddel_pinned_accounts') || '[]');
                const newPinned = pinned.filter(p => !(p.platform === platform && p.profileName === profileName));
                if (pinned.length !== newPinned.length) {
                    localStorage.setItem('baddel_pinned_accounts', JSON.stringify(newPinned));
                    if (typeof renderAccountShortcuts === 'function') renderAccountShortcuts();
                }

                await loadAccountsForPlatform(platform);
            } catch (err) {
                showToast(`Delete not yet supported for ${PLATFORM_CONFIG[platform].name}`, 'error');
            }
        }
    );
}

// ============================================================
// SECTION 6: PLATFORM-SPECIFIC SWITCH FUNCTIONS
// (بتستدعي الـ IPC handlers الموجودة في main.js)
// ============================================================

async function switchSteamAccount(username) {
    return ipcInvoke('switch-steam', username);
}

async function switchEpicAccount(profileName) {
    return ipcInvoke('switch-epic', profileName);
}

async function switchEAAccount(profileName) {
    return ipcInvoke('switch-ea', profileName);
}

async function switchRiotAccount(profileName) {
    return ipcInvoke('switch-riot-account', profileName);
}

async function switchUbisoftAccount(profileName) {
    return ipcInvoke('switch-ubisoft-account', profileName);
}

async function saveEpicAccount(name) {
    return ipcInvoke('save-epic-account', name);
}

async function saveEAAccount(name) {
    return ipcInvoke('save-ea-account', name);
}

async function saveRiotAccount(name) {
    return ipcInvoke('save-riot-account', name);
}

async function saveUbisoftAccount(name) {
    return ipcInvoke('save-ubisoft-account', name);
}

async function addNewSteamAccount() {
    return ipcInvoke('add-new-steam-account');
}

async function addNewEpicAccount() {
    return ipcInvoke('add-new-epic-account');
}

async function addNewEAAccount() {
    return ipcInvoke('add-new-ea-account');
}

async function addNewRiotAccount() {
    return ipcInvoke('add-new-riot-account');
}

async function addNewUbisoftAccount() {
    return ipcInvoke('add-new-ubisoft-account');
}

async function switchDiscordAccount(profileName) {
    return ipcInvoke('switch-discord-account', profileName);
}
async function saveDiscordAccount(name) {
    return ipcInvoke('save-discord-account', name);
}
async function addNewDiscordAccount() {
    return ipcInvoke('add-new-discord-account');
}

async function switchRockstarAccount(profileName) { return ipcInvoke('switch-rockstar-account', profileName); }
async function saveRockstarAccount(name) { return ipcInvoke('save-rockstar-account', name); }
async function addNewRockstarAccount() { return ipcInvoke('add-new-rockstar-account'); }
// ============================================================
// SECTION 7: HELPERS
// ============================================================

/**
 * ipcInvoke - helper عشان نستدعي الـ IPC من الـ preload
 * بيشتغل مع أي electronAPI method اسمه زي الـ IPC channel
 */
async function ipcInvoke(channel, ...args) {
    // الـ preload بيعمل expose للـ methods مباشرة، فبنبحث عنها
    const methodMap = {
        'switch-steam':           (a) => window.electronAPI.switchSteam?.(a),
        'switch-epic':            (a) => window.electronAPI.switchEpic?.(a),
        'switch-ea':              (a) => window.electronAPI.switchEA?.(a),
        'switch-riot-account':    (a) => window.electronAPI.switchRiot?.(a),
        'switch-ubisoft-account': (a) => window.electronAPI.switchUbisoft?.(a),
        'save-epic-account':      (a) => window.electronAPI.saveEpicAccount?.(a),
        'save-ea-account':        (a) => window.electronAPI.saveEAAccount?.(a),
        'save-riot-account':      (a) => window.electronAPI.saveRiotAccount?.(a),
        'save-ubisoft-account':   (a) => window.electronAPI.saveUbisoftAccount?.(a),
        'add-new-steam-account':  ()  => window.electronAPI.addNewSteamAccount?.(),
        'add-new-epic-account':   ()  => window.electronAPI.addNewEpicAccount?.(),
        'add-new-ea-account':     ()  => window.electronAPI.addNewEAAccount?.(),
        'add-new-riot-account':   ()  => window.electronAPI.addNewRiotAccount?.(),
        'add-new-ubisoft-account':()  => window.electronAPI.addNewUbisoftAccount?.(),
        'get-epic-profiles':      ()  => window.electronAPI.getEpicProfiles?.(),
        'get-ea-profiles':        ()  => window.electronAPI.getEAProfiles?.(),
        'get-riot-profiles':      ()  => window.electronAPI.getRiotProfiles?.(),
        'get-ubisoft-profiles':   ()  => window.electronAPI.getUbisoftProfiles?.(),
        'get-steam-accounts':     ()  => window.electronAPI.getSteamAccounts?.(),
        'delete-epic-profile':    (a) => window.electronAPI.deleteEpicProfile?.(a),
        'delete-ea-profile':      (a) => window.electronAPI.deleteEAProfile?.(a),
        'delete-riot-profile':    (a) => window.electronAPI.deleteRiotProfile?.(a),
        'delete-ubisoft-profile': (a) => window.electronAPI.deleteUbisoftProfile?.(a),
        'switch-discord-account': (a) => window.electronAPI.switchDiscordAccount?.(a),
        'save-discord-account':   (a) => window.electronAPI.saveDiscordAccount?.(a),
        'add-new-discord-account':()  => window.electronAPI.addNewDiscordAccount?.(),
        'get-discord-profiles':   ()  => window.electronAPI.getDiscordProfiles?.(),
        'delete-discord-profile': (a) => window.electronAPI.deleteDiscordProfile?.(a),
        'switch-rockstar-account': (a) => window.electronAPI.switchRockstarAccount?.(a),
        'save-rockstar-account':   (a) => window.electronAPI.saveRockstarAccount?.(a),
        'add-new-rockstar-account':()  => window.electronAPI.addNewRockstarAccount?.(),
        'get-rockstar-profiles':   ()  => window.electronAPI.getRockstarProfiles?.(),
        'delete-rockstar-profile': (a) => window.electronAPI.deleteRockstarProfile?.(a),
        'rename-rockstar-profile': (a, b) => window.electronAPI.renameRockstarProfile?.(a, b),
    };

    const fn = methodMap[channel];
    if (fn) {
        const result = await fn(...args);

        if (
            result &&
            (
                result.status === 'error' ||
                result.success === false ||
                result.ok === false
            )
        ) {
            const e = new Error(
                result.message ||
                result.error ||
                'Operation failed.'
            );
            if (result.code) e.code = result.code;
            throw e;
        }

        return result;
    }

    console.warn(`[accounts.js] No method found for channel: ${channel}`);
    throw new Error(`IPC method not exposed: ${channel}`);
}

/**
 * promptAccountName - Custom isolated modal to prevent conflicts with Library UI
 */
function promptAccountName(message,accent = '#ff4655') {
    return new Promise((resolve) => {
        // إنشاء واجهة منبثقة مستقلة تماماً
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);';
        
        const box = document.createElement('div');
        box.style.cssText = 'background:#1e1e1e;padding:24px;border-radius:12px;width:320px;display:flex;flex-direction:column;gap:16px;border:1px solid #333;box-shadow:0 10px 30px rgba(0,0,0,0.5);font-family:sans-serif;';
        
        const title = document.createElement('div');
        title.textContent = message;
        title.style.cssText = 'color:#fff;font-size:16px;font-weight:600;';
        
        const input = document.createElement('input');
        input.style.cssText = 'padding:12px;border-radius:6px;border:1px solid #444;background:#141414;color:#fff;outline:none;font-size:14px;';
        input.placeholder = 'Account name (e.g. Main, Smurf)...';
        
        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;justify-content:flex-end;gap:12px;margin-top:8px;';
        
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.cssText = 'padding:8px 16px;background:transparent;border:1px solid #555;border-radius:6px;color:#ccc;cursor:pointer;font-weight:500;transition:0.2s;';
        cancelBtn.onmouseover = () => cancelBtn.style.background = '#333';
        cancelBtn.onmouseout = () => cancelBtn.style.background = 'transparent';
        
        const saveBtn = document.createElement('button');
        saveBtn.textContent = 'Save';
        saveBtn.style.cssText = `padding:8px 16px;background:${accent};border:none;border-radius:6px;cursor:pointer;font-weight:600;transition:0.2s;`;
        saveBtn.style.color = isColorLight(accent) ? '#000' : '#fff';
        saveBtn.onmouseover = () => saveBtn.style.background = accent + 'cc';
        saveBtn.onmouseout  = () => saveBtn.style.background = accent;
        
        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(saveBtn);
        box.appendChild(title);
        box.appendChild(input);
        box.appendChild(btnRow);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        
        // التركيز التلقائي على حقل الإدخال
        setTimeout(() => input.focus(), 50);
        
        const cleanup = () => {
            if (document.body.contains(overlay)) {
                document.body.removeChild(overlay);
            }
        };
        
        cancelBtn.onclick = () => { cleanup(); resolve(null); };
        saveBtn.onclick = () => { cleanup(); resolve(input.value.trim() || null); };
        
        input.onkeydown = (e) => {
            if (e.key === 'Enter') { cleanup(); resolve(input.value.trim() || null); }
            if (e.key === 'Escape') { cleanup(); resolve(null); }
        };
    });
}

// ============================================================
// VIDEO TUTORIAL LOGIC
// ============================================================

// هنا هتحط الـ IDs بتاعت فيديوهات اليوتيوب لكل منصة
// (الـ ID هو الحروف اللي بتيجي بعد v= في لينك اليوتيوب)
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

    // استخراج الـ Video ID
    let videoId = videoInput.trim();
    if (videoId.includes("youtu.be/")) {
        videoId = videoId.split("youtu.be/")[1].split("?")[0];
    } else if (videoId.includes("youtube.com/watch")) {
        videoId = videoId.split("v=")[1].split("&")[0];
    }

    // الـ full URL اللي هيتفتح في المتصفح
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    // Thumbnail بدقة عالية من يوتيوب
    const thumbUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

    // تحديث العنوان
    const titleEl = document.getElementById('tutorialTitle');
    titleEl.innerHTML = `
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="${cfg.accent}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
        How to add ${cfg.name} account
    `;

    // استبدال الـ iframe بـ thumbnail + زرار يفتح المتصفح
    // (YouTube embeds محظورة في Electron بسبب CSP - Error 153)
    // 1. بنحط الشكل من غير أي onclick أو onmouseover عشان الـ CSP ميعملش بلوك
    // 1. بنحط الشكل وندي للـ div آي دي (ID) و z-index عالي
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
            z-index: 50; /* 👈 التريكة الأولى: نضمن إنه فوق أي حاجة */
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

    // 2. التريكة التانية: هنربط الكليك بـ addEventListener ونطلع Toast
    const triggerBtn = document.getElementById('yt-trigger-btn');
    triggerBtn.addEventListener('click', function(e) {
        e.preventDefault(); // نمنع أي أكشن افتراضي
        e.stopPropagation(); // نمنع الكليك يروح لأي عنصر تاني تحته
        
        // لو الكليك شغال، الرسالة دي هتظهرلك تحت على اليمين
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

/**
 * فتح الفيديو في المتصفح الخارجي عن طريق Electron shell
 */
function _openTutorialInBrowser(url) {
    if (window.electronAPI?.openExternal) {
        window.electronAPI.openExternal(url);
    } else {
        // Fallback لو الـ API مش متاح
        window.open(url, '_blank');
    }
}

function closeTutorialModal() {
    document.getElementById('tutorialModal').classList.remove('active');

    // إعادة الـ wrapper لحالته الأصلية (iframe) بعد الإغلاق
    setTimeout(() => {
        const wrapper = document.querySelector('.video-player-wrapper');
        if (wrapper) {
            wrapper.innerHTML = `<iframe id="tutorialIframe" src="" frameborder="0" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
        }
    }, 300);
}

// ============================================================
// SECTION 9: INITIALIZE ALL ACCOUNT COUNTS ON STARTUP
// ============================================================
async function updateAllAccountCounts() {
    const platforms = ['steam', 'epic', 'ea', 'riot', 'ubisoft', 'discord', 'rockstar'];
    
    for (const platform of platforms) {
        try {
            let count = 0;
            
            // جلب الداتا حسب كل بلاتفورم في الخلفية
            if (platform === 'steam') {
                const steamAccounts = await window.electronAPI.getSteamAccounts?.() || [];
                count = Array.isArray(steamAccounts) ? steamAccounts.length : 0;
            } else {
                const ipcFn = {
                    epic:    () => window.electronAPI.getEpicProfiles?.()    || ipcInvoke('get-epic-profiles'),
                    ea:      () => window.electronAPI.getEAProfiles?.()      || ipcInvoke('get-ea-profiles'),
                    riot:    () => window.electronAPI.getRiotProfiles?.()    || ipcInvoke('get-riot-profiles'),
                    ubisoft: () => window.electronAPI.getUbisoftProfiles?.() || ipcInvoke('get-ubisoft-profiles'),
                    discord: () => window.electronAPI.getDiscordProfiles?.() || ipcInvoke('get-discord-profiles'),
                };
                const profiles = await (ipcFn[platform]?.() || Promise.resolve([]));
                count = Array.isArray(profiles) ? profiles.length : 0;
            }
            
            // تحديث الرقم في الـ UI لو أكبر من 0، غير كدة يسيب الشرطة "—"
            const countSpan = document.getElementById(`${platform}Count`);
            if (countSpan) {
                countSpan.textContent = count > 0 ? count : '—';
            }
            
        } catch (err) {
            console.warn(`Could not load count for ${platform}:`, err);
        }
    }
}

// تشغيل الدالة تلقائياً أول ما واجهة البرنامج تفتح
document.addEventListener('DOMContentLoaded', () => {
    // استخدمنا setTimeout بسيط عشان منأثرش على سرعة فتح البرنامج الأساسية
    setTimeout(() => {
        updateAllAccountCounts();
    }, 1500); 
});





// ============================================================
// SECTION 10: EPIC LIBRARY SYNC (Link Library Tab)
// ============================================================

async function showEpicLibraryPanel() {
    // تبديل الـ tabs
    document.querySelectorAll('.acc-hero-tab').forEach(t => t.classList.remove('active'));
    document.getElementById('epicLibraryTab')?.classList.add('active');

    // إظهار الـ Panel وإخفاء الـ grid العادي
    const panel = document.getElementById('epicLibraryPanel');
    const mainSection = document.querySelector('#accountsView .accounts-list-section');
    if (mainSection) mainSection.style.display = 'none';
    if (panel) panel.style.display = 'block';

    await _renderEpicLibraryPanel();
}

async function _renderEpicLibraryPanel() {
    const content = document.getElementById('epicLibraryContent');
    const countEl = document.getElementById('epicLibraryCount');
    if (!content) return;

    try {
        const status = await window.electronAPI.platformSyncStatus?.();
        const isLinked = status?.epic === true;

        if (!isLinked) {
            content.innerHTML = `
                <div class="platform-link-banner epic-link-banner" style="margin: 0 0 16px 0;">
                    <div class="plb-icon">
                        <img src="../assets/epic.svg" alt="Epic" style="width:28px;height:28px;filter:brightness(0) invert(1);">
                    </div>
                    <div class="plb-text">
                        <strong>Not Connected</strong>
                        <span>Connect your Epic account to sync your full library into All Games tab.</span>
                    </div>
                    <button class="plb-btn" onclick="linkEpicLibrary()">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
                        Connect & Sync
                    </button>
                </div>`;
            if (countEl) countEl.textContent = 'Not linked';
            return;
        }

        // مربوط — اعرض الكاش
        const res = await window.electronAPI.platformSyncGetCached?.('epic');
        const games = res?.games || [];
        if (countEl) countEl.textContent = `${games.length} games synced`;

        if (games.length === 0) {
            content.innerHTML = `
                <div class="accounts-empty" style="padding: 32px 0;">
                    <p>No games synced yet.</p>
                    <button class="acc-btn acc-btn-primary" style="margin-top:12px;" onclick="syncEpicLibrary()">
                        Sync Now
                    </button>
                </div>`;
            return;
        }

        content.innerHTML = `
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; padding: 0 2px;">
                <span style="color:#555; font-size:0.78rem;">Last synced library — visible in <strong style="color:#888;">All Games</strong> tab with Epic badge</span>
                <button class="acc-btn acc-btn-secondary" style="padding: 6px 14px; font-size:0.78rem;" onclick="syncEpicLibrary()">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:5px;"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.59-9.21l-3.25 1.64"></path></svg>
                    Sync Again
                </button>
            </div>
            <div class="epic-library-mini-list">
                ${games.slice(0, 8).map(g => `
                    <div class="epic-lib-row">
                        ${g.coverUrl ? `<img src="${g.coverUrl}" class="epic-lib-thumb" alt="">` : `<div class="epic-lib-thumb epic-lib-thumb-placeholder"></div>`}
                        <span class="epic-lib-title">${g.title}</span>
                        <span class="platform-badge-epic">EPIC</span>
                    </div>`).join('')}
                ${games.length > 8 ? `<div style="color:#555;font-size:0.78rem;padding:10px 4px;">+ ${games.length - 8} more games in All Games tab</div>` : ''}
            </div>
            <button class="acc-btn acc-btn-secondary" style="margin-top:16px; color:#e74c3c; border-color:rgba(231,76,60,0.3);" onclick="unlinkEpicLibrary()">
                Disconnect Epic Library
            </button>`;
    } catch (err) {
        content.innerHTML = `<div style="color:#e74c3c; padding:16px;">Error: ${err.message}</div>`;
    }
}

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
        if (content) await _renderEpicLibraryPanel();
    }
};

window.syncEpicLibrary = async function() {
    const content = document.getElementById('epicLibraryContent');
    const syncBtn = null; // btn-sync-epic removed from All Games header; no button to disable here
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
        } else if (typeof renderAllGamesView === 'function') {
            await renderAllGamesView({ suppressInitialLoading: true });
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

    // تحديث الـ panel لو مفتوح
    const panel = document.getElementById('epicLibraryPanel');
    if (panel && panel.style.display !== 'none') await _renderEpicLibraryPanel();

    // تحديث All Games لو مفتوح
    if (typeof renderAllGamesView === 'function') renderAllGamesView();

    // تحديث count في sidebar
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
                await _renderEpicLibraryPanel();
                if (typeof renderAllGamesView === 'function') renderAllGamesView();
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

/** نفس تلميحات openGameDetails / getMetadata في game-details.js */
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

    const currentValue = window._agState?.account || 'all';
    menu.innerHTML = Array.from(optionMap.entries())
        .map(([value, label]) => `<div class="dropdown-item" onclick="setAgAccountFilter('${_escapePlatformSyncHtml(value)}', decodeURIComponent('${encodeURIComponent(label)}'))">${_escapePlatformSyncHtml(label)}</div>`)
        .join('');

    const resolvedValue = optionMap.has(currentValue) ? currentValue : 'all';
    selectedText.innerText = optionMap.get(resolvedValue) || 'All Accounts';
    if (window._agState) {
        window._agState.account = resolvedValue;
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

async function navigateToAllGames(opts = {}) {
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
                // resetScroll=false because scrollTop was already set to 0 in step 2;
                // for back-navigation we'll restore the saved position after render.
                _applyAgFilters({ resetScroll: !opts.restoreState?.scrollTop });

                if (opts.restoreState?.scrollTop) {
                    // Double-rAF: ensure _vsRender has completed its first pass
                    requestAnimationFrame(() => requestAnimationFrame(() => {
                        const el = document.getElementById('mainContentArea');
                        if (el) el.scrollTop = opts.restoreState.scrollTop;
                        if (typeof window._vsRender === 'function') window._vsRender(false);
                    }));
                }
                return; // finally → _agEndAllGamesRoute()
            }
            // Cache only had installed-only games — treat as empty for onboarding.
            if (await _agMaybeRenderEmptyOnboarding('navigateToAllGames-existing-cache')) return;
        }

        if (await _agMaybeRenderEmptyOnboarding('navigateToAllGames')) return;

        // ── 10. Full rebuild ──────────────────────────────────────────────────────
        // suppressInitialLoading: keep our route skeleton until real data is ready.
        await renderAllGamesView({ stableLayout: true, suppressInitialLoading: true });

    } finally {
        _agEndAllGamesRoute();
    }
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
function _agResetAllGamesGridMode() {
    const grid = document.getElementById('allGamesGrid');
    if (!grid) return;
    grid.classList.remove('ag-empty-mode');
    // Clear any inline overrides set during empty-state rendering
    grid.style.display       = '';
    grid.style.flexDirection = '';
    grid.style.alignItems    = '';
    grid.style.width         = '';
    grid.style.height        = '';
    grid.style.minHeight     = '';
}

function _agExitEmptyPageMode() {
    window._agNoLinkedAccounts = false;
    const main = document.getElementById('mainContentArea');
    const view = document.getElementById('allGamesView');
    const grid = document.getElementById('allGamesGrid');
    const list = document.getElementById('allGamesList');
    if (main) main.classList.remove('ag-no-scroll-empty');
    if (view) view.classList.remove('ag-empty-page');
    if (grid) {
        grid.classList.remove('ag-empty-mode');
        grid.style.display       = '';
        grid.style.flexDirection = '';
        grid.style.alignItems    = '';
        grid.style.justifyContent = '';
        grid.style.width         = '';
        grid.style.height        = '';
        grid.style.minHeight     = '';
        grid.style.padding       = '';
        grid.style.overflow      = '';
        grid.style.position      = '';
    }
    if (list) list.style.display = '';
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

window.renderAllGamesView = async function(options = {}) {
    // Guard: prevent concurrent renders — if a render is already in progress
    // (e.g. from a library-updated event while user is navigating), skip the duplicate.
    if (window._allGamesRendering) return;
    window._allGamesRendering = true;

    const grid = document.getElementById('allGamesGrid');
    const allGamesCount = document.getElementById('allGamesCount');
    if (!grid) { window._allGamesRendering = false; return; }

    try {
    // 1. فحص الـ status لـ Epic و Steam
    const status = await window.electronAPI.platformSyncStatus?.().catch(() => ({}));
    const isEpicLinked = status?.epic === true;
    const isSteamLinked = status?.steam === true;

    // 2. لو محدش متربط — ادّي المستخدم الـ onboarding panel
    if (!isEpicLinked && !isSteamLinked) {
        window._allGamesRendering = false;
        _agSetToolbarVisible(false);
        _agHideEpicBanner();
        _agSetEmptyPageMode(true);
        _agRenderEmptyOnboarding();
        _agRenderAccountFilterOptions([]);
        return;
    }

    // 3. في الأقل واحدة متربطة — ظهّر الـ toolbar وأخفي الـ banner القديمة
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

        // 1. جلب الألعاب من المنصتين
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

        // 2. فلترة ودمج الألعاب المكررة
        const mergedGamesMap = new Map();

        rawGames.forEach(game => {
            // توحيد اسم اللعبة للمقارنة (حروف صغيرة وبدون أي مسافات أو رموز عشان نتفادى الاختلافات البسيطة بين Steam و Epic)
            const cleanTitle = (game.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');

            if (mergedGamesMap.has(cleanTitle)) {
                // اللعبة موجودة أصلاً! هنضيف المنصة والـ ID للبيانات القديمة
                const existingGame = mergedGamesMap.get(cleanTitle);

                // إضافة المنصة الجديدة لو مش موجودة
                if (!existingGame.platforms.includes(game.platform)) {
                    existingGame.platforms.push(game.platform);
                }

                // حفظ الـ IDs بتاعت المنصتين عشان لو حبيت تشغلها من مكان معين
                existingGame.allIds[game.platform] = game.id;
                existingGame._agSource     = 'platform-sync';
                existingGame.librarySource = 'synced-account';
                _agMergeAccountMeta(existingGame, game, accountNameByKey);

            } else {
                // أول مرة نشوف اللعبة دي، هنجهز لها المصفوفات
                const newGame = { ...game };
                newGame.platforms      = [game.platform]; // مصفوفة فيها المنصات
                newGame.allIds         = { [game.platform]: game.id }; // Object فيه الـ ID بتاع كل منصة
                newGame._agSource      = 'platform-sync';
                newGame.librarySource  = 'synced-account';
                _agMergeAccountMeta(newGame, game, accountNameByKey);
                mergedGamesMap.set(cleanTitle, newGame);
            }
        });

        // تحويل الـ Map لـ Array عشان الـ Cache
        const _rawResolved = await _agApplyInstalledCreatorOverrides(
            Array.from(mergedGamesMap.values())
        );
        window._allGamesRawCache = _rawResolved;
        window._allGamesCache    = _agGetUserLibraryGames(_rawResolved);

        if (window._vs?.cardCache) window._vs.cardCache.clear();

        // 3. تحديث الرقم في الـ Sidebar
        if (allGamesCount) {
            allGamesCount.textContent = window._allGamesCache.length > 0 ? window._allGamesCache.length : '—';
        }
        _agRenderAccountFilterOptions(window._allGamesCache);

        if (await _agMaybeRenderEmptyOnboarding('renderAllGamesView')) return;

        _renderAllGamesViewModeAware(window._allGamesCache);
    } catch (err) {
        grid.innerHTML = `<div style="color:#e74c3c; padding:24px;">Error loading library: ${err.message}</div>`;
    }

    } finally {
        window._allGamesRendering = false;
    }
};

// ── Refresh grid when library updates from main process ────────
// Guard: register only once — navigating back and forth would stack listeners
// and trigger multiple concurrent re-renders per event.
if (window.electronAPI.onLibraryUpdated && !window._allGamesLibraryListenerAttached) {
    window._allGamesLibraryListenerAttached = true;
    window.electronAPI.onLibraryUpdated(async () => {
        const view = document.getElementById('allGamesView');
        if (!view || view.style.display !== 'block') return;

        // ── FIX: Don't full-rebuild (which resets filters). Instead, silently
        // refresh the cache in the background then re-apply current filters. ──
        console.log('[AllGames] Library updated — refreshing data without resetting filters...');

        // Rebuild cache silently (no loading spinner, no innerHTML wipe)
        try {
            if (window._agNoLinkedAccounts) {
                // Games may have just arrived after account link — do a full rebuild.
                await renderAllGamesView();
                return;
            }
            const status = await window.electronAPI.platformSyncStatus?.().catch(() => ({}));
            const isEpicLinked = status?.epic === true;
            const isSteamLinked = status?.steam === true;

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

            // Preserve existing asset URLs so images don't flash away on refresh
            let newCache = Array.from(mergedGamesMap.values());
            const oldById = new Map((window._allGamesCache || []).map(g => [String(g.id ?? g.appName ?? g.title), g]));
            newCache.forEach(g => {
                const key = String(g.id ?? g.appName ?? g.title);
                const old = oldById.get(key);
                if (old?.coverUrl)            g.coverUrl            = old.coverUrl;
                if (old?.heroUrl)             g.heroUrl             = old.heroUrl;
                if (old?.logoUrl)             g.logoUrl             = old.logoUrl;
                if (old?._agCoverPipelineDone) g._agCoverPipelineDone = old._agCoverPipelineDone;
                if (old?._agHeroLogoDone)      g._agHeroLogoDone      = old._agHeroLogoDone;
            });
            newCache = await _agApplyInstalledCreatorOverrides(newCache);
            if (window._vs?.cardCache) window._vs.cardCache.clear();

            window._allGamesRawCache = newCache;
            window._allGamesCache    = _agGetUserLibraryGames(newCache);

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
            const scroller = document.getElementById('mainContentArea');
            const keepScrollTop = scroller ? scroller.scrollTop : 0;

            // Background sync refresh: do NOT reset scroll
            _applyAgFilters({ resetScroll: false });

            if (scroller) {
                requestAnimationFrame(() => {
                    scroller.scrollTop = keepScrollTop;
                    if (typeof window._vsRender === 'function') {
                        window._vsRender(false);
                    }
                });
            } else if (typeof window._vsRender === 'function') {
                window._vsRender(false);
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


function _vsApplyCoverToCard(card, game, force = false) {
    if (!card || !game) return false;

    const rawCover = game.coverUrl || game.image || game.defaultImage;
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
    const rawCover = game.coverUrl || game.image || game.defaultImage || '';
    const cover = _agIsUsableCardCover(rawCover, game) ? _agAttrUrl(rawCover) : '';

    const card = document.createElement('div');
    card.className = `game-card agc-card${isMulti ? ' agc-multi' : ''}`;
    card.dataset.id = safeId;
    card.dataset.title = (game.title || '').toLowerCase();
    card.dataset.platforms = (game.platforms || []).join(',');
    card.dataset.allIds = JSON.stringify(game.allIds || {});

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
            // Creator Mode wins over platform-sync cached covers
if (_agIsCreatorArtworkGame(g)) {
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

    console.log(`[AllGamesUI] hydrated cached covers cache=${changedCache}, items=${changedItems}`);

    if (changedCache || changedItems) {
        if (window._vs?.cardCache instanceof Map && Array.isArray(window._vs.items)) {
            window._vs.items.forEach(game => {
                const gameId = String(game.id || game.appName || game.title || '');
                const card = window._vs.cardCache.get(gameId);

                if (card && game.coverUrl) {
                    _vsApplyCoverToCard(card, game, true);
                    window._vs._coverQueued.add(gameId);
                }
            });
        }

        if (typeof window._vsRender === 'function') {
            // true هنا مش هيرجع السكرول فوق، دي remeasure/render فقط
            window._vsRender(true);
        }
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
function _vsRender(forceRemeasure = false) {
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
        _vsRender();
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
            if (_vs.items.length > 0) _vsRender(true);
        });
        _vs._scrollBound = true;
    }

    if (resetScroll) scroller.scrollTop = 0;

    // Initial render
    _vsRender(true);
}

/** The main entry point — replaces old _renderAllGamesGrid */
function _renderAllGamesGrid(games, resetScroll = true, fullReset = false) {
    const grid = document.getElementById('allGamesGrid');
    if (!grid) return;

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

function _applyAgFilters(options = {}) {
    // Always filter the cache to user-library games before rendering, so that
    // auto-scanned installed-only records (Xbox, MS Store, etc.) never appear
    // in All Games even if they were pushed into _allGamesCache by app.js patches.
    const cache = _agGetUserLibraryGames(window._allGamesCache || []);
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

    const { platform, sort, search, account } = window._agState;
    let pool = [...cache];

    // 1. platform filter
    if (platform !== 'all') {
        pool = pool.filter(g => g.platforms.includes(platform));
    }

    // 2. account filter
    if (account && account !== 'all') {
        pool = pool.filter((g) => Array.isArray(g.accountKeys) && g.accountKeys.includes(account));
    }

    // 3. installed only filter
    if (window.agInstalledOnly) {
        pool = pool.filter(g => _agIsInstalled(g));
    }

    // 3b. ready-to-install filter — exclude anything already installed locally
    if (window.agReadyOnly) {
        pool = pool.filter(g => !_agIsInstalled(g));
    }

    // 4. search
    if (search.trim()) {
        pool = pool.filter(g => (g.title || '').toLowerCase().includes(search));
    }

    // 5. sort
    if (sort === 'title_asc') {
        pool.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sort === 'title_desc') {
        pool.sort((a, b) => b.title.localeCompare(a.title));
    } else if (sort === 'playtime_desc') {
        pool.sort((a, b) => (b.playtime || 0) - (a.playtime || 0));
    } else if (sort === 'multi_first') {
        pool.sort((a, b) => b.platforms.length - a.platforms.length || a.title.localeCompare(b.title));
    }

    // When showing Ready to Install, persist the exact rendered list as the
    // canonical count so the sidebar badge always matches the page.
    if (window.agReadyOnly && !window._agState?.search?.trim()) {
        window._readyToInstallRenderedGames = pool;
        try { updateSmartSidebarCounts(); } catch (_) {}
    } else if (!window.agReadyOnly) {
        window._readyToInstallRenderedGames = null;
    }

    _renderAllGamesViewModeAware(pool, resetScroll);
}

// ══════════════════════════════════════════════════════════════
// LIBRARY DISPLAY PREFERENCES — state, persistence, UI
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
function _agApplyDisplayPrefs() {
    const prefs = window._agDisplayPrefs;
    console.log('[_agApplyDisplayPrefs] viewMode=', prefs.viewMode, 'gridDensity=', prefs.gridDensity, 'listDensity=', prefs.listDensity);
    const grid  = document.getElementById('allGamesGrid');
    const list  = document.getElementById('allGamesList');
    if (!grid || !list) return;

    // ── Guard: do not touch layout if the empty onboarding state is active ──
    if (grid.classList.contains('ag-empty-mode')) {
        list.style.display = 'none';
        return;
    }

    // --- View mode ---
    const isGrid = prefs.viewMode === 'grid';
    grid.style.display = isGrid ? '' : 'none';
    list.style.display = isGrid ? 'none' : '';

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
    if (_vs && _vs.items && _vs.items.length > 0) {
        if (mode === 'list') {
            _renderAllGamesList(_vs.items);
        } else {
            // Grid mode: force remeasure with correct density
            _vs.cols = 0;
            _vs._gridTopDirty = true;
            _vsRender(true);
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
    if (isGrid && _vs.items.length > 0) {
        // Invalidate column count so _vsMeasure runs again with new density
        _vs.cols = 0;
        _vs._gridTopDirty = true;
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
    if (window._agDisplayPrefs.viewMode === 'list' && _vs.items.length > 0) {
        _renderAllGamesList(_vs.items);
    }
};

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

        // Playtime string
        const pt = game.playtime || 0;
        const ptStr = pt > 0 ? (pt >= 60 ? `${Math.floor(pt/60)}h ${pt%60}m` : `${pt}m`) : '—';

        // Last played
        const lp = game.lastPlayed || game.last_played;
        const lpStr = lp ? new Date(lp).toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' }) : '—';

        // Cover
        const cover = game.coverUrl ? _agAttrUrl(game.coverUrl) : '';

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
    _agApplyDisplayPrefs();

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
        _agApplyDisplayPrefs();
    };
})();

// Also apply on DOMContentLoaded in case All Games is the first view
document.addEventListener('DOMContentLoaded', () => {
    _agApplyDisplayPrefs();
    // Init sticky toolbar observer
    if (typeof window._agInitStickyToolbar === 'function') window._agInitStickyToolbar();
    // Init search clear button visibility
    if (typeof window._agUpdateSearchClear === 'function') window._agUpdateSearchClear();
});

// ==========================================
// PLATFORMS MODAL LOGIC (Multi-Account)
// ==========================================
let activePlatformView = null;
const platformSyncStateCache = {};
const platformSyncRenderTimers = {};
let platformSyncListenerBound = false;
let platformSyncOverlayTimer = null;

function _escapePlatformSyncHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function _countPlatformAccountGames(platform, games, accountId) {
    const aid = String(accountId);
    return (games || []).filter((game) => {
        if (!game || typeof game !== 'object') return false;
        if (platform === 'steam') {
            if (Array.isArray(game.steamLicensedAccountIds) && game.steamLicensedAccountIds.length > 0) {
                return game.steamLicensedAccountIds.some((id) => String(id) === aid);
            }
            if (Array.isArray(game.ownedByAccountIds) && game.ownedByAccountIds.length > 0) {
                return game.ownedByAccountIds.some((id) => String(id) === aid);
            }
            // steamDetectedAccountIds intentionally excluded — install detection is not licensed ownership.
            return false;
        }
        return Array.isArray(game.ownedByAccountIds) && game.ownedByAccountIds.some((id) => String(id) === aid);
    }).length;
}

function _platformAccountOwnsGame(platform, game, accountId) {
    return _countPlatformAccountGames(platform, [game], accountId) > 0;
}

function _summarizePlatformGameTitles(games, limit = 4) {
    return [...new Set(
        (games || [])
            .map((game) => String(game?.title || '').trim())
            .filter(Boolean)
    )].slice(0, limit);
}

function _buildFriendlyPlatformSyncCopy(platform, state, mode = 'panel') {
    const platformName = platform === 'steam' ? 'Steam' : 'library';
    if (state?.lastError) {
        return {
            title: 'Sync stopped',
            subtitle: state.lastError,
        };
    }

    if (state?.isSyncing) {
        if (state.phase === 'starting') {
            return {
                title: `Preparing ${platformName}`,
                subtitle: 'Please keep this window open.',
            };
        }
        if (state.phase === 'sync_account') {
            const currentName = state.progress?.currentAccountName || 'your account';
            return {
                title: 'Checking your account',
                subtitle: `We are reading ${currentName}'s library.`,
            };
        }
        if (state.phase === 'merge_local') {
            return {
                title: 'Finishing your library',
                subtitle: 'We are matching installed games and refreshing the list.',
            };
        }
        return {
            title: 'Syncing your library',
            subtitle: 'This usually only takes a moment.',
        };
    }

    const totalGames = Number(state?.summary?.totalGames || state?.validation?.totalGames || 0);
    const installOnlyGames = Number(state?.summary?.installOnlyGames || 0);
    if (mode === 'overlay') {
        return {
            title: 'Library updated',
            subtitle: totalGames > 0
                ? `${totalGames} game${totalGames === 1 ? '' : 's'} are ready.`
                : 'Your library is up to date.',
        };
    }

    if (installOnlyGames > 0 && totalGames > 0) {
        return {
            title: 'Library updated',
            subtitle: `${totalGames} game${totalGames === 1 ? '' : 's'} ready, including ${installOnlyGames} detected on this device.`,
        };
    }

    return {
        title: 'Library updated',
        subtitle: totalGames > 0
            ? `${totalGames} game${totalGames === 1 ? '' : 's'} ready to browse.`
            : 'Your synced accounts are ready.',
    };
}

function _renderPlatformSyncOverlay(platform, state = _getPlatformSyncState(platform), options = {}) {
    const overlay = document.getElementById('platformSyncSimpleOverlay');
    const titleEl = document.getElementById('platformSyncSimpleTitle');
    const subtitleEl = document.getElementById('platformSyncSimpleSubtitle');
    const summaryEl = document.getElementById('platformSyncSimpleSummary');
    const spinnerEl = document.getElementById('platformSyncSimpleSpinner');
    if (!overlay || !titleEl || !subtitleEl || !summaryEl || !spinnerEl) return;

    clearTimeout(platformSyncOverlayTimer);

    const explicitVisible = options.visible === true;
    const shouldShow = explicitVisible || (activePlatformView === platform && !!state?.isSyncing);
    if (!shouldShow) {
        overlay.classList.remove('visible', 'done', 'error');
        return;
    }

    const customTitle = options.title;
    const customSubtitle = options.subtitle;
    const copy = _buildFriendlyPlatformSyncCopy(platform, state, 'overlay');
    const summaryTitles = options.gameTitles || state?.summary?.sampleTitles || [];
    const accountSummary = state?.progress?.totalAccounts > 0
        ? `${state.progress.completedAccounts || 0}/${state.progress.totalAccounts || 0} account${state.progress.totalAccounts === 1 ? '' : 's'}`
        : '';
    const summaryItems = [accountSummary, ...summaryTitles].filter(Boolean).slice(0, 6);

    titleEl.textContent = customTitle || copy.title;
    subtitleEl.textContent = customSubtitle || copy.subtitle;
    summaryEl.innerHTML = summaryItems.map((item) => `<span>${_escapePlatformSyncHtml(item)}</span>`).join('');
    overlay.classList.add('visible');
    overlay.classList.toggle('done', !state?.isSyncing && !state?.lastError);
    overlay.classList.toggle('error', !!state?.lastError);
    spinnerEl.style.display = state?.isSyncing ? 'inline-flex' : 'none';
}

function _hidePlatformSyncOverlay(delay = 0) {
    const overlay = document.getElementById('platformSyncSimpleOverlay');
    if (!overlay) return;
    clearTimeout(platformSyncOverlayTimer);
    if (delay > 0) {
        platformSyncOverlayTimer = setTimeout(() => {
            overlay.classList.remove('visible', 'done', 'error');
        }, delay);
        return;
    }
    overlay.classList.remove('visible', 'done', 'error');
}

function _getPlatformSyncState(platform) {
    return platformSyncStateCache[platform] || null;
}

async function _refreshPlatformSyncState(platform) {
    if (!window.electronAPI.platformSyncGetState) return _getPlatformSyncState(platform);
    const res = await window.electronAPI.platformSyncGetState(platform);
    if (res?.status === 'success' && res.state) {
        platformSyncStateCache[platform] = res.state;
        return res.state;
    }
    return _getPlatformSyncState(platform);
}

function _schedulePlatformAccountsRender(platform) {
    clearTimeout(platformSyncRenderTimers[platform]);
    platformSyncRenderTimers[platform] = setTimeout(() => {
        if (activePlatformView === platform) {
            renderPlatformAccounts(platform).catch(() => {});
        }
    }, 80);
}

function _getPlatformSyncStatusLabel(status) {
    const labels = {
        queued:       'Queued',
        pending:      'Queued',
        starting:     'Starting',
        finalizing:   'Finalizing',
        syncing:      'Syncing',
        success:      'Synced',
        synced:       'Synced',
        warning:      'Recovered',
        error:        'Error',
        needs_reauth: 'Reconnect',
        idle:         '',
    };
    return labels[status] ?? '';
}

const _TRANSIENT_UI_STATUSES = new Set(['queued', 'pending', 'syncing', 'finalizing', 'starting']);

function _sanitizePlatformAccountName(name) {
    if (!name) return 'Account';
    const n = String(name);
    if (/^epic_tmp/i.test(n) || /^epic epic_tmp/i.test(n) || /^epic user$/i.test(n)) {
        return 'Reconnect Epic account';
    }
    return n;
}

function _deriveAccountStatusFromData(acc, gamesCount) {
    if (acc?.needsReauth || acc?.credentialStatus === 'missing' || acc?.credentialStatus === 'invalid') {
        return 'needs_reauth';
    }
    if (gamesCount > 0 || acc?.lastSyncedAt) return 'synced';
    return 'idle';
}

function _renderPlatformSyncStatusPanel(platform, state = _getPlatformSyncState(platform)) {
    const panel = document.getElementById('platformSyncStatusPanel');
    const syncBtn = document.getElementById('syncPlatformBtn');
    const importBtn = document.getElementById('linkPlatformBtn');
    if (!panel) return;

    // We hide the combined panel if there's no active sync
    const visible = state && state.isSyncing;
    if (!visible) {
        panel.style.display = 'none';
        if (syncBtn) {
            syncBtn.innerText = 'Sync Library';
            syncBtn.disabled = false;
        }
        if (importBtn) importBtn.disabled = false;
        _hidePlatformSyncOverlay();
        return;
    }

    const statusClass = state.lastError ? 'error' : (state.isSyncing ? 'syncing' : '');
    panel.style.display = 'flex';
    panel.className = `platform-sync-status-panel ${statusClass}`.trim();

    const progress = state.progress || {};
    const percent = Number.isFinite(progress.percent) ? progress.percent : 0;
    const copy = _buildFriendlyPlatformSyncCopy(platform, state);

    panel.innerHTML = `
        <div class="platform-sync-status-head">
            ${state.isSyncing ? '<div class="acc-spinner"></div>' : '<div style="width:18px;height:18px;border-radius:50%;background:rgba(255,255,255,0.12);display:flex;align-items:center;justify-content:center;color:#66c0f4;font-size:12px;">✓</div>'}
            <div class="platform-sync-status-copy">
                <div class="platform-sync-status-title">${_escapePlatformSyncHtml(copy.title)}</div>
                <div class="platform-sync-status-subtitle">${_escapePlatformSyncHtml(copy.subtitle)}</div>
            </div>
        </div>
        <div class="platform-sync-progress">
            <div class="platform-sync-progress-row">
                <span>${_escapePlatformSyncHtml(progress.currentAccountName || 'Updating your library')}</span>
                <span>${_escapePlatformSyncHtml(`${percent}%`)}</span>
            </div>
            <div class="platform-sync-progress-bar">
                <div class="platform-sync-progress-fill" style="width:${Math.max(0, Math.min(100, percent))}%"></div>
            </div>
        </div>
    `;

    if (syncBtn) {
        syncBtn.innerText = state.isSyncing ? 'Syncing...' : 'Sync Library';
        syncBtn.disabled = !!state.isSyncing;
    }
    if (importBtn) importBtn.disabled = !!state.isSyncing;
    _renderPlatformSyncOverlay(platform, state);
}

function _ensurePlatformSyncListener() {
    if (platformSyncListenerBound || !window.electronAPI.onPlatformSyncState) return;
    platformSyncListenerBound = true;

    window.electronAPI.onPlatformSyncState((state) => {
        if (!state?.platform) return;
        platformSyncStateCache[state.platform] = state;
        if (activePlatformView === state.platform) {
            _renderPlatformSyncStatusPanel(state.platform, state);
            _schedulePlatformAccountsRender(state.platform);
        }
    });

    if (window.electronAPI.onPlatformSyncCompleted) {
        window.electronAPI.onPlatformSyncCompleted((state) => {
            if (!state?.platform) return;
            platformSyncStateCache[state.platform] = state;
            const platformName = state.platform === 'steam' ? 'Steam' : 'Epic Games';
            // Prefer the statusText computed by platformSync (already has the right count for
            // both targeted and full syncs). Fall back to summary total if statusText is absent.
            const syncedCount = state.summary?.totalGames ||
                Object.values(state.accounts || {}).reduce((sum, a) => sum + (a.gamesCount || 0), 0);
            const msg = state.statusText ||
                (syncedCount > 0 ? `${platformName} sync completed. ${syncedCount} games synced.` : `${platformName} sync completed.`);
            showToast(msg, 'success');
            if (activePlatformView === state.platform) {
                _renderPlatformSyncStatusPanel(state.platform, state);
                _schedulePlatformAccountsRender(state.platform);
            }
            if (typeof renderAllGamesView === 'function') renderAllGamesView();
        });
    }

    if (window.electronAPI.onPlatformSyncFailed) {
        window.electronAPI.onPlatformSyncFailed((state) => {
            if (!state?.platform) return;
            platformSyncStateCache[state.platform] = state;
            const platformName = state.platform === 'steam' ? 'Steam' : 'Epic Games';
            showToast(`${platformName} sync failed: ${state.lastError || 'Unknown error'}`, 'error');
            if (activePlatformView === state.platform) {
                _renderPlatformSyncStatusPanel(state.platform, state);
                _schedulePlatformAccountsRender(state.platform);
            }
        });
    }
}

function _runPlatformSync(platform, options = {}) {
    const platformName = platform === 'steam' ? 'Steam' : 'Epic Games';
    const targetAccountId = options.targetAccountId || null;

    // Client-side duplicate guard — server will also check, but this gives instant feedback
    if (platformSyncStateCache[platform]?.isSyncing) {
        showToast(`${platformName} sync is already running in the background.`, 'info');
        return;
    }

    window.electronAPI.platformSyncSync(platform, targetAccountId)
        .then(res => {
            if (res?.alreadyRunning) {
                showToast(`${platformName} sync is already running in the background.`, 'info');
                return;
            }
            if (res?.status === 'error') {
                showToast(`${platformName} sync failed: ${res.message}`, 'error');
                return;
            }
            if (res?.status === 'started' && !options.silent) {
                showToast(`${platformName} sync started in the background. You can keep using Baddel.`, 'success');
            }
            // completion/failure toast comes from onPlatformSyncCompleted/onPlatformSyncFailed
        })
        .catch(err => {
            showToast(`${platformName} sync failed: ${err.message}`, 'error');
        });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _ensurePlatformSyncListener);
} else {
    _ensurePlatformSyncListener();
}

function openPlatformsModal(platform = 'epic') {
    const targetPlatform = platform === 'steam' ? 'steam' : 'epic';
    const modal = document.getElementById('platformsModal');
    if (modal) modal.classList.add('active');
    if (typeof updatePlatformsOverview === 'function') updatePlatformsOverview();
    if (typeof openPlatformDetails === 'function') openPlatformDetails(targetPlatform);
}

function closePlatformsModal() {
    document.getElementById('platformsModal').classList.remove('active');
    _hidePlatformSyncOverlay();
}

function backToPlatformsList() {
    document.getElementById('platformsListView').style.display = 'flex';
    document.getElementById('platformDetailsView').style.display = 'none';
    activePlatformView = null;
    updatePlatformsOverview();
}

// بتحدث عدد الحسابات في الشاشة الأولى
async function updatePlatformsOverview() {
    try {
        const epicRes = await window.electronAPI.platformSyncGetAccounts('epic');
        const epicCount = epicRes.accounts ? epicRes.accounts.length : 0;
        document.getElementById('epicAccountsCount').innerText = `${epicCount} Linked`;
    } catch (e) {}
    try {
        const steamRes = await window.electronAPI.platformSyncGetAccounts('steam');
        const steamCount = steamRes.accounts ? steamRes.accounts.length : 0;
        document.getElementById('steamAccountsCount').innerText = `${steamCount} Linked`;
    } catch (e) {}
}

async function openPlatformDetails(platform) {
    activePlatformView = platform;
    document.querySelectorAll('.platform-nav-item').forEach(el => el.classList.remove('active'));
    const activeItem = document.getElementById(`plat-nav-${platform}`);
    if (activeItem) activeItem.classList.add('active');

    const titles = { 'epic': 'Epic Games', 'steam': 'Steam' };
    document.getElementById('currentPlatformTitle').innerText = titles[platform] || platform;

    await _refreshPlatformSyncState(platform).catch(() => null);
    _renderPlatformSyncStatusPanel(platform);
    await renderPlatformAccounts(platform);
}

async function renderPlatformAccounts(platform) {
    const listContainer = document.getElementById('linkedAccountsList');
    listContainer.innerHTML = '<div style="text-align:center; padding: 20px; color:#888;">Loading...</div>';

    try {
        const [accountsRes, gamesRes, syncState] = await Promise.all([
            window.electronAPI.platformSyncGetAccounts(platform),
            window.electronAPI.platformSyncGetCached(platform),
            _refreshPlatformSyncState(platform).catch(() => _getPlatformSyncState(platform)),
        ]);
        if (accountsRes?.status === 'error') throw new Error(accountsRes.message || 'Failed to load accounts');
        if (gamesRes?.status === 'error') throw new Error(gamesRes.message || 'Failed to load cached games');
        const accounts = accountsRes.accounts || [];
        const games = gamesRes.games || [];
        platformSyncStateCache[platform] = syncState || platformSyncStateCache[platform];
        _renderPlatformSyncStatusPanel(platform, syncState);

        if (accounts.length === 0) {
            listContainer.innerHTML = '<div style="text-align:center; padding: 20px; color:#888;">No accounts linked yet.</div>';
            return;
        }

        let html = '';
        for (const acc of accounts) {
            const aid = String(acc.id);
            const baseGamesCount = _countPlatformAccountGames(platform, games, aid);
            const syncAccountState = syncState?.accounts?.[aid] || null;
            const rawStatus = syncAccountState?.status || 'idle';

            // Guard: never display a transient in-progress status when no sync is running.
            // This prevents stale "Queued"/"Syncing" states left over from a previous session.
            let itemStatus, displayGamesCount, accountMessage;
            if (!syncState?.isSyncing && _TRANSIENT_UI_STATUSES.has(rawStatus)) {
                itemStatus       = _deriveAccountStatusFromData(acc, baseGamesCount);
                displayGamesCount = baseGamesCount;
                accountMessage   = itemStatus === 'needs_reauth' ? 'Reconnect required' : '';
            } else {
                itemStatus        = rawStatus;
                displayGamesCount = Number.isFinite(syncAccountState?.gamesCount) ? syncAccountState.gamesCount : baseGamesCount;
                accountMessage    = syncAccountState?.message || '';
            }

            const statusLabel = _getPlatformSyncStatusLabel(itemStatus);
            const isInProgress = ['syncing', 'starting', 'finalizing'].includes(itemStatus);
            const statusHtml = statusLabel
                ? `<div class="linked-account-status ${_escapePlatformSyncHtml(itemStatus)}">${isInProgress ? '<span class="acc-mini-spinner"></span>' : ''}${_escapePlatformSyncHtml(statusLabel)}</div>`
                : '';
            const messageHtml = accountMessage
                ? `<div class="linked-account-message">${_escapePlatformSyncHtml(accountMessage)}</div>`
                : '';
            html += `
                <div class="linked-account-item ${_escapePlatformSyncHtml(itemStatus)}">
                    <div class="linked-account-item-main">
                        <div class="linked-account-info">
                            <div class="linked-account-name">${_escapePlatformSyncHtml(_sanitizePlatformAccountName(acc.displayName))}</div>
                            <div class="linked-account-meta">
                                <span>${_escapePlatformSyncHtml(`${displayGamesCount} Games`)}</span>
                                ${statusHtml}
                            </div>
                        </div>
                        <div class="linked-account-actions">
                            <button class="linked-account-action sync-btn" onclick="syncSinglePlatformAccount('${acc.id}')" ${syncState?.isSyncing ? 'disabled' : ''}>
                                ${isInProgress ? '<span class="acc-mini-spinner"></span> SYNCING...' : 'SYNC'}
                            </button>
                            <button class="linked-account-action unlink-btn" onclick="unlinkPlatformAccount('${acc.id}')" ${syncState?.isSyncing ? 'disabled' : ''}>UNLINK</button>
                        </div>
                    </div>
                    ${messageHtml}
                </div>
            `;
        }
        listContainer.innerHTML = html;

    } catch (err) {
        console.error(err);
        listContainer.innerHTML = '<div style="color:red; text-align:center;">Error loading accounts.</div>';
    }
}

async function linkNewPlatformAccount() {
    if (!activePlatformView) return;

    const platform = String(activePlatformView || '').toLowerCase();
    if (!['steam', 'epic'].includes(platform)) {
        console.error('[PlatformLink] Invalid activePlatformView:', activePlatformView);
        showToast(`Invalid platform: ${activePlatformView}`, 'error');
        return;
    }
    const isEpic = platform === 'epic';

    // Disable Link Account and Sync Library buttons while linking
    const linkBtn = document.getElementById('linkPlatformBtn');
    const syncBtn = document.getElementById('syncPlatformBtn');
    if (linkBtn) { linkBtn.disabled = true; linkBtn.style.opacity = '0.5'; }
    if (syncBtn) { syncBtn.disabled = true; syncBtn.style.opacity = '0.5'; }

    const restoreButtons = () => {
        if (linkBtn) { linkBtn.disabled = false; linkBtn.style.opacity = ''; }
        if (syncBtn) { syncBtn.disabled = false; syncBtn.style.opacity = ''; }
    };

    // Live overlay update driven by platform-sync:link-state-changed events
    const stageMessages = {
        waiting_for_signin: isEpic
            ? 'Waiting for Epic authorization...'
            : 'Finish the sign-in in the Steam window.',
        resolving_identity: 'Reading account profile...',
        saving_account:     'Saving account...',
        linked:             'Account linked. Starting library sync...',
        starting_sync:      'Epic sync started in the background. You can keep using Baddel.',
        failed:             'Linking failed.',
    };

    let removeStateListener = null;
    let timeoutHandle10s = null;
    let timeoutHandle30s = null;

    const updateOverlay = (title, subtitle) => {
        _renderPlatformSyncOverlay(platform, null, { visible: true, title, subtitle });
    };

    const startTimeoutWarnings = () => {
        timeoutHandle10s = setTimeout(() => {
            // Only update subtitle if overlay is still in "linking" state (not syncing)
            const overlay = document.getElementById('platformSyncSimpleOverlay');
            if (!overlay?.classList.contains('visible')) return;
            const subtitleEl = document.getElementById('platformSyncSimpleSubtitle');
            if (subtitleEl) subtitleEl.textContent =
                'Still working. Epic can take a little while to finish authorization.';
        }, 10_000);
        timeoutHandle30s = setTimeout(() => {
            const overlay = document.getElementById('platformSyncSimpleOverlay');
            if (!overlay?.classList.contains('visible')) return;
            const subtitleEl = document.getElementById('platformSyncSimpleSubtitle');
            if (subtitleEl) subtitleEl.textContent =
                'Still connecting. Please keep this window open until sign-in finishes.';
        }, 30_000);
    };

    const cleanup = () => {
        if (removeStateListener) { removeStateListener(); removeStateListener = null; }
        if (timeoutHandle10s) { clearTimeout(timeoutHandle10s); timeoutHandle10s = null; }
        if (timeoutHandle30s) { clearTimeout(timeoutHandle30s); timeoutHandle30s = null; }
        restoreButtons();
    };

    try {
        const initialTitle = isEpic ? 'Connecting Epic account' : 'Connecting Steam account';
        const initialSubtitle = isEpic
            ? 'Waiting for Epic authorization...'
            : 'Finish the sign-in in the Steam window, then we will sync your games automatically.';
        updateOverlay(initialTitle, initialSubtitle);

        // Subscribe to progress events from main process
        if (window.electronAPI.onPlatformLinkStateChanged) {
            removeStateListener = window.electronAPI.onPlatformLinkStateChanged((payload) => {
                if (payload?.platform !== platform) return;
                const subtitle = stageMessages[payload.status] || payload.message || '';
                const titleMap = {
                    waiting_for_signin: initialTitle,
                    resolving_identity: 'Reading account profile...',
                    saving_account:     'Saving account...',
                    linked:             'Account linked!',
                    starting_sync:      'Sync started',
                };
                updateOverlay(titleMap[payload.status] || initialTitle, subtitle || payload.message || '');
            });
        }

        // Start long-wait timeout warnings (Epic only — Steam usually resolves faster)
        if (isEpic) startTimeoutWarnings();

        const res = await window.electronAPI.platformSyncLink(platform);

        if (res?.status === 'error') throw new Error(res.message || 'Failed to link account');
        if (res.status === 'success') {
            const _linkedName = res.displayName || res.accountName || res.name
                || (platform === 'steam' ? 'Steam account' : 'Epic account');
            const _linkedAccountId = platform === 'steam'
                ? (res.steamId || res.accountId || res.id || null)
                : (res.accountId || res.epicAccountId || res.id || null);

            await updatePlatformsOverview();
            await renderPlatformAccounts(platform);
            updateOverlay(
                'Account linked!',
                isEpic
                    ? 'Epic sync started in the background. You can close this tab or keep using Baddel.'
                    : `Steam account linked. Syncing library now...`,
            );
            showToast(`Account "${_linkedName}" linked! Syncing library automatically...`, 'info');
            _runPlatformSync(platform, { targetAccountId: _linkedAccountId, silent: true });
            await updatePlatformsOverview();
            await renderPlatformAccounts(platform);
        }
    } catch (err) {
        console.error('[PlatformLink] Link Error:', { platform, message: err?.message, error: err });
        _hidePlatformSyncOverlay();
        const msg = err?.message || err?.details?.message || err?.error || 'Unknown error';
        showToast(`Failed to link ${platform === 'steam' ? 'Steam' : 'Epic'} account: ${msg}`, 'error');
    } finally {
        cleanup();
    }
}

async function unlinkPlatformAccount(accountId) {
    if (!activePlatformView) return;
    
    openConfirmModal(
        'Unlink Account?',
        'Are you sure you want to remove this account? Its games will be removed from your synced library.',
        'Unlink',
        async () => {
            try {
                await window.electronAPI.platformSyncUnlink(activePlatformView, accountId);
                showToast('Account removed successfully.', 'success');
                await updatePlatformsOverview();
                await renderPlatformAccounts(activePlatformView);
                if (typeof renderAllGamesView === 'function') await renderAllGamesView();
                if (activePlatformView === 'epic' && typeof _renderEpicLibraryPanel === 'function') await _renderEpicLibraryPanel();
            } catch (err) {
                console.error('Unlink Error:', err);
                showToast('Failed to unlink account.', 'error');
            }
        }
    );
}

function syncCurrentPlatform() {
    if (!activePlatformView) return;
    _runPlatformSync(activePlatformView);
}

function syncSinglePlatformAccount(accountId) {
    if (!activePlatformView || !accountId) return;
    _runPlatformSync(activePlatformView, { targetAccountId: String(accountId) });
}

// ══════════════════════════════════════════════════════════════
// INSTALLED GAMES — DISPLAY PREFERENCES (parallel to All Games)
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
        currentFilters.collectionId = null;
    }

    _igSaveFilterState();
    try {
        if (typeof applyFilters === 'function') applyFilters();
        if (typeof _igApplyDisplayPrefs === 'function') _igApplyDisplayPrefs();

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
        const cover = game.image || game.defaultImage || game.coverUrl || '';

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
    _igApplyDisplayPrefs();
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
        _igApplyDisplayPrefs();
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
            _igApplyDisplayPrefs();
            if (typeof window._igInitStickyToolbar === 'function') window._igInitStickyToolbar();
            window.igUpdateSearchClear?.();
        });
    };
})();

// ── Init on DOMContentLoaded ──────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // Apply prefs immediately if Installed Games happens to be the first view
    _igApplyDisplayPrefs();
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
