// ============================================================
// BADDEL LAUNCHER - PLATFORM PANELS (accounts/platform-panels.js)
// Extracted from accounts.js: account card renderers, action handlers,
// platform-specific IPC wrappers, Epic Library panel, and platform
// sync modal logic. Loaded after display-prefs.js, before accounts.js.
// ============================================================

const ACCOUNT_COUNT_PLACEHOLDER = '\u2014';
window.ACCOUNT_COUNT_PLACEHOLDER = ACCOUNT_COUNT_PLACEHOLDER;

function setPlatformAccountCount(platform, count, { loaded = false } = {}) {
    const countSpan = document.getElementById(`${platform}Count`);
    if (!countSpan) return;
    const numeric = Number(count);
    countSpan.textContent = loaded && Number.isInteger(numeric) && numeric > 0
        ? String(numeric)
        : ACCOUNT_COUNT_PLACEHOLDER;
}

function initializePlatformAccountCounts() {
    ['steam', 'epic', 'gog', 'ea', 'riot', 'ubisoft', 'discord', 'rockstar']
        .forEach(platform => setPlatformAccountCount(platform, null));
}

window.setPlatformAccountCount = setPlatformAccountCount;
window.initializePlatformAccountCounts = initializePlatformAccountCounts;

// ============================================================
// SECTION 1: ACCOUNTS VIEW SWITCHING
// ============================================================

function showAccountsView(platform) {
    if (typeof _hideAllViews === 'function') _hideAllViews();
    document.getElementById('accountsView').style.display = 'block';
    renderAccountsView(platform);
    if (typeof updateSbContextBtn === 'function') updateSbContextBtn();
    if (typeof updateSidebarActiveState === 'function') updateSidebarActiveState();
}

function selectAccountPlatform(platform) {
    currentAccountPlatform = platform;
    currentSidebarSection  = 'accounts';
    // Clear collection filter so Favorites/collection rows don't stay active
    if (typeof currentFilters !== 'undefined') currentFilters.collectionId = null;

    document.getElementById('subItems-accounts').style.display = 'block';
    document.getElementById('subItems-library').style.display  = 'none';
    document.getElementById('sectionBtn-accounts')?.classList.add('active');
    document.getElementById('sectionBtn-library')?.classList.remove('active');

    showAccountsView(platform);

    if (typeof updateSidebarActiveState === 'function') updateSidebarActiveState();
    if (typeof updateSbContextBtn === 'function') updateSbContextBtn();
}

// ============================================================
// SECTION 2: PLATFORM CONFIGURATION
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
    gog: {
        name:   'GOG',
        color:  '#8638e5',
        accent: '#a970ff',
        logoImg: '../assets/gog.png',
        switchFn: switchGogAccount,
        saveFn:   saveGogAccount,
        addFn:    addNewGogAccount,
        cancelAddFn: cancelAddGogAccount
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

// ============================================================
// SECTION 3: ACCOUNTS VIEW RENDERER
// ============================================================

async function renderAccountsView(platform) {
    const cfg = PLATFORM_CONFIG[platform];
    if (!cfg) return;

    const isDarkLogo = platform === 'epic' || platform === 'ubisoft';
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

    await loadAccountsForPlatform(platform);
}

// ============================================================
// SECTION 4: ACCOUNT DATA LOADER
// ============================================================

const _accountProfileReads = new Map();
function _readAccountProfilesOnce(platform, read) {
    if (_accountProfileReads.has(platform)) return _accountProfileReads.get(platform);
    const pending = Promise.resolve().then(read).finally(() => {
        if (_accountProfileReads.get(platform) === pending) _accountProfileReads.delete(platform);
    });
    _accountProfileReads.set(platform, pending);
    return pending;
}

async function loadAccountsForPlatform(platform) {
    const grid = document.getElementById('accountsGrid');
    const countEl = document.getElementById('accountsCount');
    if (!grid) return;
    const request = {};
    grid._accountLoadRequest = request;
    const isCurrent = () => currentAccountPlatform === platform
        && document.getElementById('accountsGrid') === grid
        && grid._accountLoadRequest === request;

    try {
        let profiles = [];
        let steamAccounts = [];

        if (platform === 'steam') {
            steamAccounts = await _readAccountProfilesOnce(platform, () => window.electronAPI.getSteamAccounts?.()) || [];
            if (Array.isArray(steamAccounts)) {
                profiles = steamAccounts.map(a => a.username);
            }
        } else {
            const ipcFn = {
                epic:    () => window.electronAPI.getEpicProfiles?.()    || ipcInvoke('get-epic-profiles'),
                gog:     () => window.electronAPI.getGogProfiles?.()     || ipcInvoke('get-gog-profiles'),
                ea:      () => window.electronAPI.getEAProfiles?.()      || ipcInvoke('get-ea-profiles'),
                riot:    () => window.electronAPI.getRiotProfiles?.()    || ipcInvoke('get-riot-profiles'),
                ubisoft: () => window.electronAPI.getUbisoftProfiles?.() || ipcInvoke('get-ubisoft-profiles'),
                discord: () => window.electronAPI.getDiscordProfiles?.() || ipcInvoke('get-discord-profiles'),
                rockstar: () => window.electronAPI.getRockstarProfiles?.() || ipcInvoke('get-rockstar-profiles')
            };
            profiles = await _readAccountProfilesOnce(platform, () => ipcFn[platform]?.() || []);
        }
        if (!isCurrent()) return;

        if (platform === 'gog') await _renderGogPendingAddState(isCurrent);
        if (!isCurrent()) return;

        setPlatformAccountCount(platform, Array.isArray(profiles) ? profiles.length : 0, { loaded: true });

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

        grid.innerHTML = '';
        const cfg = PLATFORM_CONFIG[platform];
        const shortcutsMap = await _loadShortcutsMap();
        if (!isCurrent()) return;

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
                const profileName = typeof profile === 'string'
                    ? profile
                    : (profile.name || profile.username || profile.displayName || String(profile.id || ''));
                const accountId = platform === 'gog' && profile?.id ? profile.id : profileName;
                const shortcut = shortcutsMap.get(`${platform}::${accountId}`) || null;
                grid.appendChild(createAccountCard(profile, platform, cfg, i, shortcut));
            });
        }

    } catch (err) {
        if (!isCurrent()) return;
        console.error(`Failed to load ${platform} accounts:`, err);
        grid.innerHTML = `<div class="accounts-empty"><p style="color:#ff3b30;">Error loading accounts</p><span>${escapeHtml(String(err.message || err))}</span></div>`;
    }
}

async function _renderGogPendingAddState(isCurrent = () => currentAccountPlatform === 'gog') {
    document.getElementById('gogPendingAddBanner')?.remove();
    const state = await window.electronAPI.getGogAddState?.();
    if (!isCurrent()) return;
    if (!state?.pending) return;
    const page = document.querySelector('#accountsView .accounts-page');
    if (!page) return;
    const banner = document.createElement('div');
    banner.id = 'gogPendingAddBanner';
    banner.className = 'acc-onboard-warning';
    banner.style.cssText = 'margin:16px 0;padding:16px;display:flex;align-items:center;gap:12px;border-color:#a970ff66;background:#a970ff12;';
    banner.innerHTML = `<div style="flex:1"><strong>GOG account setup is still active.</strong><div style="margin-top:5px;color:#aaa">Sign in, wait for the Galaxy library to load, fully close Galaxy, then save—or restore the previous session.</div></div><button class="acc-btn acc-btn-secondary" data-gog-save>Save Current</button><button class="acc-btn acc-btn-secondary" data-gog-cancel>Cancel Add</button>`;
    banner.querySelector('[data-gog-save]').addEventListener('click', () => handleSaveAccount('gog'));
    banner.querySelector('[data-gog-cancel]').addEventListener('click', cancelPendingGogAdd);
    page.querySelector('.accounts-hero-v2')?.after(banner);
}

async function cancelPendingGogAdd() {
    if (isAccountProcessing) return;
    isAccountProcessing = true;
    try {
        await cancelAddGogAccount();
        showToast('Previous GOG Galaxy session restored.', 'success');
        await loadAccountsForPlatform('gog');
        if (typeof hydrateSidebarPlatformCounts === 'function') hydrateSidebarPlatformCounts();
        if (typeof renderAccountShortcuts === 'function') renderAccountShortcuts();
    } catch (error) { showToast(error.message || String(error), 'error'); }
    finally { isAccountProcessing = false; }
}

// ============================================================
// SECTION 5: SHORTCUT HELPERS
// ============================================================

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

// ============================================================
// SECTION 6: SHORTCUT CAPTURE MODAL
// ============================================================

// Renderer-side validation mirrors main-process validation for instant feedback;
// the IPC handler in main.js is still the final authority.
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
        return { valid: false, message: 'Include a non-modifier key, for example Ctrl + H.', normalized: '' };
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
    const ipc     = [...normMods, normKey].join('+');
    const display = [...normMods, normKey].join(' + ');

    if (BLOCKED.has(ipc)) {
        return { valid: false, message: `${display} is reserved by the system. Try a different combination.`, normalized: display };
    }

    if (normMods.length < 1) {
        const exKey = normKey.length === 1 ? normKey : 'H';
        const example = ['Ctrl', exKey].join(' + ');
        return {
            valid: false,
            message: `Use at least one modifier key — for example ${example}.`,
            normalized: display,
        };
    }

    return { valid: true, message: '', normalized: display };
}

function openShortcutCaptureModal(platform, accountId, accountName, accent, existingShortcut) {
    return new Promise((resolve) => {
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
        sub.textContent = 'Press a key combination while this window is open. Requires at least one modifier plus a key.';

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

        function _refreshUI() {
            if (!capturedRaw) {
                captureBox.className = 'shortcut-capture-box';
                captureBox.textContent = 'Press a shortcut like Ctrl + H';
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

// ============================================================
// SECTION 7: ACCOUNT CARD BUILDERS
// ============================================================

function createAccountCard(profileName, platform, cfg, index = 0, shortcut = null) {
    const profileObject = typeof profileName === 'object' && profileName !== null ? profileName : null;
    const accountId = platform === 'gog' && profileObject?.id
        ? String(profileObject.id)
        : String(profileObject?.name || profileObject?.username || profileObject?.displayName || profileName || '');
    if (profileObject) profileName = profileObject.name || profileObject.username || profileObject.displayName || String(profileObject.id || '');
    profileName = String(profileName || '');

    const card = document.createElement('div');
    card.className = 'account-card';
    card.setAttribute('data-profile', accountId);

    const initials = profileName.substring(0, 2).toUpperCase();
    const indexStr = String(index + 1).padStart(2, '0');

    let pinnedArr = JSON.parse(localStorage.getItem('baddel_pinned_accounts') || '[]');
    let isPinned = pinnedArr.some(p => p.platform === platform && p.profileName === accountId);
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
        handlePinAccount(platform, accountId, profileName, null, null, this);
    });
    card.querySelector('[data-action="switch"]').addEventListener('click', function() {
        handleSwitchAccount(platform, accountId, this, profileName);
    });
    card.querySelector('[data-action="shortcut"]').addEventListener('click', async () => {
        const current = shortcut;
        const result = await openShortcutCaptureModal(platform, accountId, profileName, cfg.accent, current?.accelerator || null);
        if (result === 'cancel') return;
        const newMap = await _loadShortcutsMap();
        const updated = newMap.get(`${platform}::${accountId}`) || null;
        shortcut = updated;
        _updateCardShortcutBtn(card, updated);
        if (typeof showToast === 'function') {
            if (result === null) showToast('Shortcut cleared', 'success');
            else showToast(`Shortcut set: ${result}`, 'success');
        }
    });
    card.querySelector('[data-action="rename"]').addEventListener('click', () => handleRenameAccount(platform, accountId, profileName));
    card.querySelector('[data-action="delete"]').addEventListener('click', () => handleDeleteAccount(platform, accountId, profileName));
    return card;
}

function createDiscordAccountCard(profile, cfg, index = 0, shortcut = null) {
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

function createSteamAccountCard(acc, cfg, index = 0, shortcut = null) {
    const card = document.createElement('div');
    card.className = 'account-card';
    card.setAttribute('data-profile', acc.username);

    const initials = (acc.displayName || acc.username).substring(0, 2).toUpperCase();
    const indexStr = String(index + 1).padStart(2, '0');

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

function copyToClipboard(text, event) {
    event.stopPropagation();
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
        // silent fail — initials remain visible
    }
}

// ============================================================
// SECTION 8: PIN / HOME SHORTCUT
// ============================================================

window.handlePinAccount = function(platform, profileName, displayName = null, extraId = null, avatarUrl = null, btnEl = null) {
    let pinned = JSON.parse(localStorage.getItem('baddel_pinned_accounts') || '[]');

    const exists = pinned.find(p => p.platform === platform && p.profileName === profileName);

    if (exists) {
        pinned = pinned.filter(p => !(p.platform === platform && p.profileName === profileName));
        if (typeof showToast === 'function') showToast('Removed from Home', 'success');
        if (btnEl && btnEl.classList) btnEl.classList.remove('is-pinned');
    } else {
        pinned.push({
            platform,
            profileName,
            displayName: displayName || profileName,
            extraId,
            avatarUrl
        });
        if (typeof showToast === 'function') showToast('Pinned to Home!', 'success');
        if (btnEl && btnEl.classList) btnEl.classList.add('is-pinned');
    }

    localStorage.setItem('baddel_pinned_accounts', JSON.stringify(pinned));

    if (typeof renderAccountShortcuts === 'function') {
        renderAccountShortcuts();
    }
};

// ============================================================
// SECTION 9: ACTION HANDLERS
// ============================================================

async function handleSwitchAccount(platform, profileName, btnEl, displayName = profileName) {
    if (isAccountProcessing) {
        showToast("Please wait, an operation is already in progress...", "warning");
        return;
    }

    isAccountProcessing = true;

    const originalContent = btnEl.innerHTML;
    const isShortcutBtn = btnEl.classList.contains('asc-play-btn');

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
        showToast(`Switched to ${displayName}! Starting launcher...`, 'success');

        btnEl.innerHTML = isShortcutBtn
            ? `<div class="acc-mini-spinner" style="border-top-color: #30d158;"></div>`
            : `<div class="acc-mini-spinner"></div> Stabilizing...`;

        await new Promise(r => setTimeout(r, platform === 'gog' ? 10000 : 8000));

    } catch (err) {
        console.error(`Switch error for ${platform}:`, err);
        const code = err.code || '';
        if (code === 'LAUNCHER_NOT_INSTALLED' || code === 'RIOT_CLIENT_NOT_FOUND' ||
            code.endsWith('_LAUNCHER_NOT_FOUND') || code.endsWith('_NOT_FOUND')) {
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

async function handleSaveAccount(platform) {
    if (isAccountProcessing) {
        showToast("Please wait for the current action to finish", "warning");
        return;
    }

    const rawName = await promptAccountName(
        `Save current ${PLATFORM_CONFIG[platform].name} account as:`,
        PLATFORM_CONFIG[platform].accent
    );
    if (rawName === null) return;
    const name = String(rawName).trim();
    if (!name) {
        showToast('Enter an account name.', 'error');
        return;
    }

    isAccountProcessing = true;
    showToast(`Saving ${name}...`, 'success');

    try {
        const cfg = PLATFORM_CONFIG[platform];
        await cfg.saveFn(name);
        if (platform === 'gog') {
            window.invalidatePlatformOwnershipCache?.('gog');
            window.dispatchEvent?.(new CustomEvent('baddel:gog-switcher-changed'));
        }
        showToast(`${name} saved!`, 'success');
        await loadAccountsForPlatform(platform);
        if (typeof hydrateSidebarPlatformCounts === 'function') hydrateSidebarPlatformCounts();
        if (typeof renderAccountShortcuts === 'function') renderAccountShortcuts();
    } catch (err) {
        showToast(`Save failed: ${err?.message || err}`, 'error');
    } finally {
        isAccountProcessing = false;
    }
}

async function addNewAccount(platform) {
    if (isAccountProcessing) return;

    isAccountProcessing = true;
    const cfg = PLATFORM_CONFIG[platform];
    showToast(`Preparing ${cfg.name}...`, 'info');

    try {
        const result = await cfg.addFn();
        if (result && (result.success === false || result.status === 'error')) {
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

// Shows a modal when a launcher cannot be found automatically.
// Generic for all platforms — uses PLATFORM_CONFIG for name and accent colour.
// On success the saved path is used to retry the add-account flow.
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

                if (!res)         { dismiss(); return; }
                if (res.canceled) { dismiss(); return; }

                if (res.success) {
                    dismiss();
                    showToast(`${cfg.name} located. Opening…`, 'success');
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

async function handleRenameAccount(platform, profileId, currentName = profileId) {
    if (isAccountProcessing) return;
    const newName = await promptAccountName(
        `Rename "${currentName}" to:`,
        PLATFORM_CONFIG[currentAccountPlatform]?.accent || '#ff4655'
    );
    if (!newName || newName === currentName) return;

    isAccountProcessing = true;
    try {
        const methodMap = {
            riot:     'renameRiotProfile',
            ubisoft:  'renameUbisoftProfile',
            discord:  'renameDiscordProfile',
            epic:     'renameEpicProfile',
            ea:       'renameEaProfile',
            rockstar: 'renameRockstarProfile',
            gog:      'renameGogProfile'
        };

        const methodName = methodMap[platform];

        if (!window.electronAPI[methodName]) {
            throw new Error(`Function ${methodName} is missing in preload.js`);
        }

        const result = await window.electronAPI[methodName](profileId, newName);

        if (result && result.status === 'error') {
            throw new Error(result.message);
        }

        showToast("Renamed successfully", "success");
        if (platform === 'gog') window.invalidatePlatformOwnershipCache?.('gog');

        let pinned = JSON.parse(localStorage.getItem('baddel_pinned_accounts') || '[]');
        let changed = false;
        pinned.forEach(p => {
            if (p.platform === platform && p.profileName === profileId) {
                if (platform !== 'gog') p.profileName = newName;
                if (p.displayName === currentName || platform === 'gog') p.displayName = newName;
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

function handleDeleteAccount(platform, profileId, displayName = profileId) {
    openConfirmModal(
        'Delete Account?',
        `Remove the saved profile "${displayName}" from Baddel? This never deletes the real account or current Galaxy session.`,
        'Delete',
        async () => {
            try {
                await ipcInvoke(`delete-${platform}-profile`, profileId);
                showToast(`${displayName} deleted.`, 'success');
                if (platform === 'gog') window.invalidatePlatformOwnershipCache?.('gog');

                let pinned = JSON.parse(localStorage.getItem('baddel_pinned_accounts') || '[]');
                const newPinned = pinned.filter(p => !(p.platform === platform && p.profileName === profileId));
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
// SECTION 10: PLATFORM-SPECIFIC IPC WRAPPERS
// ============================================================

async function switchSteamAccount(username) {
    return ipcInvoke('switch-steam', username);
}

async function switchEpicAccount(profileName) {
    return ipcInvoke('switch-epic', profileName);
}

async function switchGogAccount(profileId) {
    return ipcInvoke('switch-gog-account', profileId);
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

async function saveGogAccount(name) {
    return ipcInvoke('save-gog-account', name);
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

async function addNewGogAccount(expectedAccountId = null) {
    return ipcInvoke('add-new-gog-account', expectedAccountId);
}

async function cancelAddGogAccount() {
    return ipcInvoke('cancel-add-gog-account');
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
// SECTION 11: IPC HELPER
// ============================================================

async function ipcInvoke(channel, ...args) {
    const methodMap = {
        'switch-steam':            (a) => window.electronAPI.switchSteam?.(a),
        'switch-epic':             (a) => window.electronAPI.switchEpic?.(a),
        'switch-gog-account':      (a) => window.electronAPI.switchGogAccount?.(a),
        'switch-ea':               (a) => window.electronAPI.switchEA?.(a),
        'switch-riot-account':     (a) => window.electronAPI.switchRiot?.(a),
        'switch-ubisoft-account':  (a) => window.electronAPI.switchUbisoft?.(a),
        'save-epic-account':       (a) => window.electronAPI.saveEpicAccount?.(a),
        'save-gog-account':        (a) => window.electronAPI.saveGogAccount?.(a),
        'save-ea-account':         (a) => window.electronAPI.saveEAAccount?.(a),
        'save-riot-account':       (a) => window.electronAPI.saveRiotAccount?.(a),
        'save-ubisoft-account':    (a) => window.electronAPI.saveUbisoftAccount?.(a),
        'add-new-steam-account':   ()  => window.electronAPI.addNewSteamAccount?.(),
        'add-new-epic-account':    ()  => window.electronAPI.addNewEpicAccount?.(),
        'add-new-gog-account':     (a) => window.electronAPI.addNewGogAccount?.(a),
        'cancel-add-gog-account':  ()  => window.electronAPI.cancelAddGogAccount?.(),
        'add-new-ea-account':      ()  => window.electronAPI.addNewEAAccount?.(),
        'add-new-riot-account':    ()  => window.electronAPI.addNewRiotAccount?.(),
        'add-new-ubisoft-account': ()  => window.electronAPI.addNewUbisoftAccount?.(),
        'get-epic-profiles':       ()  => window.electronAPI.getEpicProfiles?.(),
        'get-gog-profiles':        ()  => window.electronAPI.getGogProfiles?.(),
        'get-ea-profiles':         ()  => window.electronAPI.getEAProfiles?.(),
        'get-riot-profiles':       ()  => window.electronAPI.getRiotProfiles?.(),
        'get-ubisoft-profiles':    ()  => window.electronAPI.getUbisoftProfiles?.(),
        'get-steam-accounts':      ()  => window.electronAPI.getSteamAccounts?.(),
        'delete-epic-profile':     (a) => window.electronAPI.deleteEpicProfile?.(a),
        'delete-gog-profile':      (a) => window.electronAPI.deleteGogProfile?.(a),
        'delete-ea-profile':       (a) => window.electronAPI.deleteEAProfile?.(a),
        'delete-riot-profile':     (a) => window.electronAPI.deleteRiotProfile?.(a),
        'delete-ubisoft-profile':  (a) => window.electronAPI.deleteUbisoftProfile?.(a),
        'switch-discord-account':  (a) => window.electronAPI.switchDiscordAccount?.(a),
        'save-discord-account':    (a) => window.electronAPI.saveDiscordAccount?.(a),
        'add-new-discord-account': ()  => window.electronAPI.addNewDiscordAccount?.(),
        'get-discord-profiles':    ()  => window.electronAPI.getDiscordProfiles?.(),
        'delete-discord-profile':  (a) => window.electronAPI.deleteDiscordProfile?.(a),
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

    console.warn(`[platform-panels.js] No method found for channel: ${channel}`);
    throw new Error(`IPC method not exposed: ${channel}`);
}

// ============================================================
// SECTION 12: ACCOUNT NAME PROMPT
// ============================================================

// Custom isolated modal to prevent conflicts with Library UI
function promptAccountName(message, accent = '#ff4655') {
    return new Promise((resolve) => {
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
// SECTION 13: ACCOUNT COUNT INIT
// ============================================================

async function updateAllAccountCounts() {
    const platforms = ['steam', 'epic', 'gog', 'ea', 'riot', 'ubisoft', 'discord', 'rockstar'];

    for (const platform of platforms) {
        try {
            let count = 0;

            if (platform === 'steam') {
                const steamAccounts = await window.electronAPI.getSteamAccounts?.() || [];
                count = Array.isArray(steamAccounts) ? steamAccounts.length : 0;
            } else if (platform === 'gog') {
                const profiles = await (window.electronAPI.getGogProfiles?.() || Promise.resolve([]));
                count = Array.isArray(profiles) ? profiles.length : 0;
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

            setPlatformAccountCount(platform, count, { loaded: true });

        } catch (err) {
            console.warn(`Could not load count for ${platform}:`, err);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initializePlatformAccountCounts();
    // Deferred so startup rendering is not delayed by account IPC calls.
    setTimeout(() => {
        updateAllAccountCounts();
    }, 1500);
});
window.updateAllAccountCounts = updateAllAccountCounts;

// ============================================================
// SECTION 14: EPIC LIBRARY SYNC PANEL
// ============================================================

async function showEpicLibraryPanel() {
    document.querySelectorAll('.acc-hero-tab').forEach(t => t.classList.remove('active'));
    document.getElementById('epicLibraryTab')?.classList.add('active');

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
                        Connect &amp; Sync
                    </button>
                </div>`;
            if (countEl) countEl.textContent = 'Not linked';
            return;
        }

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

// ============================================================
// SECTION 15: PLATFORMS MODAL LOGIC (Multi-Account Sync)
// ============================================================

let activePlatformView = null;
const platformSyncStateCache = {};
const platformSyncRenderTimers = {};
const platformSyncActiveOperations = {};
let platformSyncOperationSequence = 0;
let platformSyncListenerBound = false;

function _createPlatformOperationId(platform, type) {
    platformSyncOperationSequence += 1;
    return `${String(platform || 'platform')}:${String(type || 'operation')}:${Date.now()}:${platformSyncOperationSequence}`;
}

function _isCurrentPlatformOperation(payload, type = 'sync') {
    if (!payload?.platform) return false;
    const active = platformSyncActiveOperations[payload.platform];
    if (payload.operationType && payload.operationType !== type) return false;
    if (!active) return true;
    if (active.type !== type) return false;
    if (payload.operationId && active.operationId && payload.operationId !== active.operationId) return false;
    if (payload.syncRunId && active.syncRunId && payload.syncRunId !== active.syncRunId) return false;
    return true;
}
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
    const platformName = PLATFORM_CONFIG[platform]?.name || (platform === 'steam' ? 'Steam' : 'library');
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
    const overlay    = document.getElementById('platformSyncSimpleOverlay');
    const titleEl    = document.getElementById('platformSyncSimpleTitle');
    const subtitleEl = document.getElementById('platformSyncSimpleSubtitle');
    const summaryEl  = document.getElementById('platformSyncSimpleSummary');
    const spinnerEl  = document.getElementById('platformSyncSimpleSpinner');
    if (!overlay || !titleEl || !subtitleEl || !summaryEl || !spinnerEl) return;

    clearTimeout(platformSyncOverlayTimer);

    const explicitVisible = options.visible === true;
    const shouldShow = explicitVisible || (activePlatformView === platform && !!state?.isSyncing);
    if (!shouldShow) {
        overlay.classList.remove('visible', 'done', 'error');
        return;
    }

    const customTitle    = options.title;
    const customSubtitle = options.subtitle;
    const copy = _buildFriendlyPlatformSyncCopy(platform, state, 'overlay');
    const summaryTitles = options.gameTitles || state?.summary?.sampleTitles || [];
    const accountSummary = state?.progress?.totalAccounts > 0
        ? `${state.progress.completedAccounts || 0}/${state.progress.totalAccounts || 0} account${state.progress.totalAccounts === 1 ? '' : 's'}`
        : '';
    const summaryItems = [accountSummary, ...summaryTitles].filter(Boolean).slice(0, 6);

    titleEl.textContent    = customTitle    || copy.title;
    subtitleEl.textContent = customSubtitle || copy.subtitle;
    summaryEl.innerHTML    = summaryItems.map((item) => `<span>${_escapePlatformSyncHtml(item)}</span>`).join('');
    overlay.classList.add('visible');
    overlay.classList.toggle('done',  !state?.isSyncing && !state?.lastError);
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
    const panel     = document.getElementById('platformSyncStatusPanel');
    const syncBtn   = document.getElementById('syncPlatformBtn');
    const importBtn = document.getElementById('linkPlatformBtn');
    if (!panel) return;

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
    const percent  = Number.isFinite(progress.percent) ? progress.percent : 0;
    const copy     = _buildFriendlyPlatformSyncCopy(platform, state);

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
        syncBtn.disabled  = !!state.isSyncing;
    }
    if (importBtn) importBtn.disabled = !!state.isSyncing;
    _renderPlatformSyncOverlay(platform, state);
}

function _ensurePlatformSyncListener() {
    if (platformSyncListenerBound || !window.electronAPI.onPlatformSyncState) return;
    platformSyncListenerBound = true;

    window.electronAPI.onPlatformSyncState((state) => {
        if (!state?.platform || !_isCurrentPlatformOperation(state, 'sync')) return;
        platformSyncStateCache[state.platform] = state;
        if (activePlatformView === state.platform) {
            _renderPlatformSyncStatusPanel(state.platform, state);
            _schedulePlatformAccountsRender(state.platform);
        }
    });

    if (window.electronAPI.onPlatformSyncCompleted) {
        window.electronAPI.onPlatformSyncCompleted((state) => {
            if (!state?.platform || !_isCurrentPlatformOperation(state, 'sync')) return;
            platformSyncStateCache[state.platform] = state;
            delete platformSyncActiveOperations[state.platform];
            const platformName = PLATFORM_CONFIG[state.platform]?.name || (state.platform === 'steam' ? 'Steam' : 'Epic Games');
            const syncedCount = state.summary?.totalGames ||
                Object.values(state.accounts || {}).reduce((sum, a) => sum + (a.gamesCount || 0), 0);
            const msg = state.statusText ||
                (syncedCount > 0 ? `${platformName} sync completed. ${syncedCount} games synced.` : `${platformName} sync completed.`);
            showToast(msg, 'success');
            if (activePlatformView === state.platform) {
                _renderPlatformSyncStatusPanel(state.platform, state);
                _schedulePlatformAccountsRender(state.platform);
            }
            window.hydrateSidebarAllGamesCount?.('platform-sync-completed').catch?.(() => {});
            if (state.platform === 'epic' && typeof window.invalidateEpicVaultCache === 'function') {
                window.invalidateEpicVaultCache(true).catch?.(() => {});
            }
        });
    }

    if (window.electronAPI.onPlatformSyncFailed) {
        window.electronAPI.onPlatformSyncFailed((state) => {
            if (!state?.platform || !_isCurrentPlatformOperation(state, 'sync')) return;
            platformSyncStateCache[state.platform] = state;
            delete platformSyncActiveOperations[state.platform];
            const platformName = PLATFORM_CONFIG[state.platform]?.name || (state.platform === 'steam' ? 'Steam' : 'Epic Games');
            showToast(`${platformName} sync failed: ${state.lastError || 'Unknown error'}`, 'error');
            if (activePlatformView === state.platform) {
                _renderPlatformSyncStatusPanel(state.platform, state);
                _schedulePlatformAccountsRender(state.platform);
            }
        });
    }
}

function _runPlatformSync(platform, options = {}) {
    const platformName    = PLATFORM_CONFIG[platform]?.name || (platform === 'steam' ? 'Steam' : 'Epic Games');
    const targetAccountId = options.targetAccountId || null;
    const syncOptions     = options.syncOptions || {};
    const operationId = _createPlatformOperationId(platform, 'sync');

    // Client-side duplicate guard — server will also check, but this gives instant feedback
    if (platformSyncStateCache[platform]?.isSyncing) {
        showToast(`${platformName} sync is already running in the background.`, 'info');
        return;
    }

    platformSyncActiveOperations[platform] = { type: 'sync', operationId, syncRunId: null };
    window.electronAPI.platformSyncSync(platform, targetAccountId, { ...syncOptions, __operationId: operationId })
        .then(res => {
            const active = platformSyncActiveOperations[platform];
            if (!active || active.type !== 'sync' || active.operationId !== operationId) return;
            if (res?.syncRunId) active.syncRunId = res.syncRunId;
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
        })
        .catch(err => {
            const active = platformSyncActiveOperations[platform];
            if (!active || active.type !== 'sync' || active.operationId !== operationId) return;
            delete platformSyncActiveOperations[platform];
            showToast(`${platformName} sync failed: ${err.message}`, 'error');
        });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _ensurePlatformSyncListener);
} else {
    _ensurePlatformSyncListener();
}

function openPlatformsModal(platform = 'epic') {
    const targetPlatform = ['steam', 'epic', 'gog'].includes(platform) ? platform : 'epic';
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

async function updatePlatformsOverview() {
    for (const platform of ['epic', 'steam', 'gog']) {
        try {
            const res = await window.electronAPI.platformSyncGetAccounts(platform);
            const count = res.accounts ? res.accounts.length : 0;
            const el = document.getElementById(`${platform}AccountsCount`);
            if (el) el.innerText = `${count} Linked`;
        } catch (e) {}
    }
}

async function openPlatformDetails(platform) {
    window.electronAPI?.trackFeatureEvent?.('feature_viewed', { feature: 'manage_accounts', view: 'platform_accounts', platform }).catch?.(() => {});
    activePlatformView = platform;
    document.querySelectorAll('.platform-nav-item').forEach(el => el.classList.remove('active'));
    const activeItem = document.getElementById(`plat-nav-${platform}`);
    if (activeItem) activeItem.classList.add('active');

    const titles = { 'epic': 'Epic Games', 'steam': 'Steam', 'gog': 'GOG' };
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
        if (gamesRes?.status === 'error')    throw new Error(gamesRes.message    || 'Failed to load cached games');
        const accounts = accountsRes.accounts || [];
        const games    = gamesRes.games || [];
        platformSyncStateCache[platform] = syncState || platformSyncStateCache[platform];
        _renderPlatformSyncStatusPanel(platform, syncState);

        if (accounts.length === 0) {
            listContainer.innerHTML = '<div style="text-align:center; padding: 20px; color:#888;">No accounts linked yet.</div>';
            return;
        }

        let html = '';
        for (const acc of accounts) {
            const aid          = String(acc.id);
            const baseGamesCount   = _countPlatformAccountGames(platform, games, aid);
            const syncAccountState = syncState?.accounts?.[aid] || null;
            const rawStatus        = syncAccountState?.status || 'idle';

            // Never display a transient in-progress status when no sync is running.
            // This prevents stale "Queued"/"Syncing" states left over from a previous session.
            let itemStatus, displayGamesCount, accountMessage;
            if (!syncState?.isSyncing && _TRANSIENT_UI_STATUSES.has(rawStatus)) {
                itemStatus        = _deriveAccountStatusFromData(acc, baseGamesCount);
                displayGamesCount = baseGamesCount;
                accountMessage    = itemStatus === 'needs_reauth' ? 'Reconnect required' : '';
            } else {
                itemStatus        = rawStatus;
                displayGamesCount = Number.isFinite(syncAccountState?.gamesCount) ? syncAccountState.gamesCount : baseGamesCount;
                accountMessage    = syncAccountState?.message || '';
            }

            const countIsKnown = syncAccountState?.gamesCountKnown !== false || baseGamesCount > 0 || !!acc.lastSyncedAt;
            const gamesCountLabel = countIsKnown ? `${displayGamesCount} Games` : 'Checking library';
            const statusLabel  = _getPlatformSyncStatusLabel(itemStatus);
            const isInProgress = ['syncing', 'starting', 'finalizing'].includes(itemStatus);
            const statusHtml   = statusLabel
                ? `<div class="linked-account-status ${_escapePlatformSyncHtml(itemStatus)}">${isInProgress ? '<span class="acc-mini-spinner"></span>' : ''}${_escapePlatformSyncHtml(statusLabel)}</div>`
                : '';
            const messageHtml  = accountMessage
                ? `<div class="linked-account-message">${_escapePlatformSyncHtml(accountMessage)}</div>`
                : '';
            html += `
                <div class="linked-account-item ${_escapePlatformSyncHtml(itemStatus)}">
                    <div class="linked-account-item-main">
                        <div class="linked-account-info">
                            <div class="linked-account-name">${_escapePlatformSyncHtml(_sanitizePlatformAccountName(acc.displayName))}</div>
                            <div class="linked-account-meta">
                                <span>${_escapePlatformSyncHtml(gamesCountLabel)}</span>
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

async function _finishLinkedPlatformAccount({ platform, platformLabel, isEpic, linkedName, linkedAccountId, res, epicSyncSelection }) {
    await updatePlatformsOverview();
    await renderPlatformAccounts(platform);
    if (isEpic && res.initialSyncComplete) {
        updateOverlayForLinkedPlatform(platform, 'Account linked!', `Epic synced ${Number(res.gamesCount || 0)} games inside Baddel.`);
        showToast(`Account "${linkedName}" linked and synced.`, 'success');
        await _agSafeRenderAllGamesView();
        window.hydrateSidebarAllGamesCount?.('account-sync').catch?.(() => {});
        if (typeof window.invalidateEpicVaultCache === 'function') await window.invalidateEpicVaultCache(true);
    } else {
        updateOverlayForLinkedPlatform(platform, 'Account linked!', `${platformLabel} account linked. Syncing library now...`);
        showToast(`Account "${linkedName}" linked! Syncing library automatically...`, 'info');
        _runPlatformSync(platform, { targetAccountId: linkedAccountId, silent: true, syncOptions: epicSyncSelection });
    }
    await updatePlatformsOverview();
    await renderPlatformAccounts(platform);
}

function updateOverlayForLinkedPlatform(platform, title, subtitle) {
    _renderPlatformSyncOverlay(platform, null, { visible: true, title, subtitle });
}
async function linkNewPlatformAccount() {
    if (!activePlatformView) return;

    const platform = String(activePlatformView || '').toLowerCase();
    if (!['steam', 'epic', 'gog'].includes(platform)) {
        console.error('[PlatformLink] Invalid activePlatformView:', activePlatformView);
        showToast(`Invalid platform: ${activePlatformView}`, 'error');
        return;
    }
    const isEpic = platform === 'epic';
    const platformLabel = PLATFORM_CONFIG[platform]?.name || platform;
    const operationId = _createPlatformOperationId(platform, 'link');
    platformSyncActiveOperations[platform] = { type: 'link', operationId, syncRunId: null };

    const linkBtn = document.getElementById('linkPlatformBtn');
    const syncBtn = document.getElementById('syncPlatformBtn');
    if (linkBtn) { linkBtn.disabled = true; linkBtn.style.opacity = '0.5'; }
    if (syncBtn) { syncBtn.disabled = true; syncBtn.style.opacity = '0.5'; }

    const restoreButtons = () => {
        if (linkBtn) { linkBtn.disabled = false; linkBtn.style.opacity = ''; }
        if (syncBtn) { syncBtn.disabled = false; syncBtn.style.opacity = ''; }
    };

    const stageMessages = {
        waiting_for_signin: isEpic ? 'Waiting for Epic authorization...' : `Waiting for ${platformLabel} authorization...`,
        resolving_identity: 'Reading account profile...', saving_account: 'Saving account...',
        linked: 'Account linked. Starting sync...', starting_sync: `${platformLabel} sync started.`, failed: 'Linking failed.',
    };

    let removeStateListener = null;
    let timeoutHandle10s    = null;
    let timeoutHandle30s    = null;

    const updateOverlay = (title, subtitle) => {
        _renderPlatformSyncOverlay(platform, null, { visible: true, title, subtitle });
    };

    const startTimeoutWarnings = () => {
        timeoutHandle10s = setTimeout(() => {
            const overlay    = document.getElementById('platformSyncSimpleOverlay');
            if (!overlay?.classList.contains('visible')) return;
            const subtitleEl = document.getElementById('platformSyncSimpleSubtitle');
            if (subtitleEl) subtitleEl.textContent =
                `Still working. ${platformLabel} can take a little while to finish authorization.`;
        }, 10_000);
        timeoutHandle30s = setTimeout(() => {
            const overlay    = document.getElementById('platformSyncSimpleOverlay');
            if (!overlay?.classList.contains('visible')) return;
            const subtitleEl = document.getElementById('platformSyncSimpleSubtitle');
            if (subtitleEl) subtitleEl.textContent =
                'Still connecting. Keep this window open.';
        }, 30_000);
    };

    const cleanup = () => {
        if (removeStateListener) { removeStateListener(); removeStateListener = null; }
        if (timeoutHandle10s)    { clearTimeout(timeoutHandle10s); timeoutHandle10s = null; }
        if (timeoutHandle30s)    { clearTimeout(timeoutHandle30s); timeoutHandle30s = null; }
        restoreButtons();
    };

    try {
        const initialTitle    = `Connecting ${platformLabel} account`;
        const initialSubtitle = isEpic
            ? 'Waiting for Epic authorization...'
            : (platform === 'gog'
                ? 'Finish GOG sign-in; sync starts after.'
                : 'Finish Steam sign-in; sync starts after.');
        updateOverlay(initialTitle, initialSubtitle);

        if (window.electronAPI.onPlatformLinkStateChanged) {
            removeStateListener = window.electronAPI.onPlatformLinkStateChanged((payload) => {
                const active = platformSyncActiveOperations[platform];
                if (payload?.platform !== platform || payload?.operationType !== 'link') return;
                if (!active || active.type !== 'link' || active.operationId !== operationId) return;
                if (payload.operationId && payload.operationId !== operationId) return;
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

        let epicSyncSelection = {};
        if (isEpic) {
            const selected = await window.showEpicSyncOptionsDialog?.();
            if (!selected) {
                _hidePlatformSyncOverlay();
                cleanup();
                return;
            }
            epicSyncSelection = selected;
        }

        if (isEpic || platform === 'gog') startTimeoutWarnings();

        const res = await window.electronAPI.platformSyncLink(platform, { ...epicSyncSelection, __operationId: operationId });

        if (res?.status === 'error') throw new Error(res.message || 'Failed to link account');
        if (res.status === 'success') {
            const _linkedName = res.displayName || res.accountName || res.name
                || `${platformLabel} account`;
            const _linkedAccountId = platform === 'steam'
                ? (res.steamId || res.accountId || res.id || null)
                : (res.accountId || res.epicAccountId || res.userId || res.id || null);

            await _finishLinkedPlatformAccount({
                platform,
                platformLabel,
                isEpic,
                linkedName: _linkedName,
                linkedAccountId: _linkedAccountId,
                res,
                epicSyncSelection,
            });
        }
    } catch (err) {
        const active = platformSyncActiveOperations[platform];
        if (!active || active.type !== 'link' || active.operationId !== operationId) return;
        const msg = err?.message || err?.details?.message || err?.error || 'Unknown error';
        showToast(`Failed to link platform ${platformLabel}: ${msg}`, 'error');
        console.error('[PlatformLink] Link Error:', { platform, message: err?.message, error: err });
        _hidePlatformSyncOverlay();
    } finally {
        const active = platformSyncActiveOperations[platform];
        if (active?.type === 'link' && active.operationId === operationId) {
            delete platformSyncActiveOperations[platform];
        }
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
                const result = await window.electronAPI.platformSyncUnlink(activePlatformView, accountId);
                if (!result || result.status === 'error') throw Object.assign(new Error(result?.message || 'Failed to unlink account.'), { code: result?.code || 'PLATFORM_UNLINK_FAILED' });
                showToast('Account removed successfully.', 'success');
                await updatePlatformsOverview();
                await renderPlatformAccounts(activePlatformView);
                await _agSafeRenderAllGamesView();
                window.hydrateSidebarAllGamesCount?.('account-sync').catch?.(() => {});
                if (activePlatformView === 'epic' && typeof window.invalidateEpicVaultCache === 'function') await window.invalidateEpicVaultCache(true);
                if (activePlatformView === 'epic' && typeof _renderEpicLibraryPanel === 'function') await _renderEpicLibraryPanel();
            } catch (err) {
                console.error('Unlink Error:', err);
                showToast('Failed to unlink account.', 'error');
            }
        }
    );
}

async function syncCurrentPlatform() {
    if (!activePlatformView) return;
    let syncOptions = {};
    if (String(activePlatformView).toLowerCase() === 'epic') {
        const selected = await window.showEpicSyncOptionsDialog?.();
        if (!selected) return;
        syncOptions = selected;
    }
    _runPlatformSync(activePlatformView, { syncOptions });
}

async function syncSinglePlatformAccount(accountId) {
    if (!activePlatformView || !accountId) return;
    let syncOptions = {};
    if (String(activePlatformView).toLowerCase() === 'epic') {
        const selected = await window.showEpicSyncOptionsDialog?.();
        if (!selected) return;
        syncOptions = selected;
    }
    _runPlatformSync(activePlatformView, { targetAccountId: String(accountId), syncOptions });
}

// ============================================================
// WINDOW EXPORTS
// Functions called from inline onclick handlers in dashboard.html
// or from accounts.js after this script loads must be on window.
// ============================================================

window.showAccountsView          = showAccountsView;
window.selectAccountPlatform     = selectAccountPlatform;
window.handleSaveAccount         = handleSaveAccount;
window.addNewAccount             = addNewAccount;
window.showEpicLibraryPanel      = showEpicLibraryPanel;
window._renderEpicLibraryPanel   = _renderEpicLibraryPanel;
window.openPlatformsModal        = openPlatformsModal;
window.closePlatformsModal       = closePlatformsModal;
window.backToPlatformsList       = backToPlatformsList;
window.openPlatformDetails       = openPlatformDetails;
window.renderPlatformAccounts    = renderPlatformAccounts;
window.linkNewPlatformAccount    = linkNewPlatformAccount;
window.unlinkPlatformAccount     = unlinkPlatformAccount;
window.syncCurrentPlatform       = syncCurrentPlatform;
window.syncSinglePlatformAccount = syncSinglePlatformAccount;
window.updatePlatformsOverview   = updatePlatformsOverview;
