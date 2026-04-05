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
 * handleSidebarBottomBtn - الزرار الأسفل بيعمل حاجة مختلفة حسب الـ section
 */
function handleSidebarBottomBtn() {
    if (currentSidebarSection === 'library') {
        openCollectionModal(); // الدالة الموجودة في app.js
    } else {
        // Add new account للـ platform الحالي
        if (currentAccountPlatform) {
            addNewAccount(currentAccountPlatform);
        }
    }
}

// ============================================================
// SECTION 2: VIEW SWITCHING (Library vs Accounts)
// ============================================================

function showLibraryView() {
    // نستخدم الدالة الجاهزة اللي بتنظف الشاشة وتفتح الـ Home صح
    if (typeof navigateToHome === 'function') {
        navigateToHome();
    }
}

function showAccountsView(platform) {
    // نخفي كل حاجة (بما فيها الـ Hero) قبل ما نعرض الأكاونت
    if (typeof _hideAllViews === 'function') {
        _hideAllViews();
    }
    
    document.getElementById('accountsView').style.display = 'block';
    renderAccountsView(platform);
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

    // تحديث الـ active state في الـ sidebar
    document.querySelectorAll('.platform-item').forEach(item => item.classList.remove('active'));
    document.getElementById(`nav-${platform}`)?.classList.add('active');

    // تأكد إن الـ accounts section مفتوح
    document.getElementById('subItems-accounts').style.display = 'block';
    document.getElementById('subItems-library').style.display  = 'none';
    document.getElementById(`sectionBtn-accounts`)?.classList.add('active');
    document.getElementById(`sectionBtn-library`)?.classList.remove('active');

    // تحديث الـ bottom button
    const btnText = document.getElementById('bottomBtnText');
    if (btnText) btnText.textContent = 'Add Account';

    showAccountsView(platform);
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
        logoImg: '../assets/ubisoft.png',
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

            <div class="accounts-list-section" style="--plat-accent: ${cfg.accent};">
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
            grid.innerHTML = `
                <div class="accounts-empty">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#333" stroke-width="1.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                    <p>No saved accounts yet.</p>
                    <span>Click "Add New Account" to get started.</span>
                </div>
            `;
            return;
        }

        // رندر الـ account cards
        grid.innerHTML = '';
        const cfg = PLATFORM_CONFIG[platform];

        if (platform === 'steam' && steamAccounts.length > 0) {
            steamAccounts.forEach((acc, i) => {
                grid.appendChild(createSteamAccountCard(acc, cfg, i));
            });
        } else if (platform === 'discord' && profiles.length > 0) {
            profiles.forEach((profileObj, i) => {
                grid.appendChild(createDiscordAccountCard(profileObj, cfg, i));
            });
        } else {
            profiles.forEach((profile, i) => {
                // بعد enrichProfilesWithSyncData، profile بقى object دايمًا
                const profileName = typeof profile === 'string'
                    ? profile
                    : (profile.name || profile.username || profile.displayName || String(profile.id || ''));
                grid.appendChild(createAccountCard(profileName, platform, cfg, i));
            });
        }

    } catch (err) {
        console.error(`Failed to load ${platform} accounts:`, err);
        grid.innerHTML = `<div class="accounts-empty"><p style="color:#ff3b30;">Error loading accounts</p><span>${err.message || err}</span></div>`;
    }
}

/**
 * createAccountCard - بيعمل card للـ account العادي (Epic, EA, Riot, Ubisoft)
 */
function createAccountCard(profileName, platform, cfg, index = 0) {
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

    card.innerHTML = `
        <div class="acc-card-num">${indexStr}</div>
        <div class="acc-card-avatar" style="--acc-color: ${cfg.accent};">
            <span>${initials}</span>
        </div>
        <div class="acc-card-info">
            <div class="acc-card-name">${profileName}</div>
            <div class="acc-card-platform">${cfg.name}</div>
        </div>
        <div class="acc-card-actions">
            <button class="${pinClass}" title="Send to Home" onclick="handlePinAccount('${platform}', '${profileName}', null, null, null, this)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path></svg>
            </button>
            <button class="acc-switch-btn" style="--btn-accent: ${cfg.accent};" onclick="handleSwitchAccount('${platform}', '${profileName}', this)">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>
                Switch
            </button>
            <button class="acc-rename-btn" title="Rename Account" onclick="handleRenameAccount('${platform}', '${profileName}')">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4L18.5 2.5z"></path></svg>
            </button>
            <button class="acc-delete-btn" onclick="handleDeleteAccount('${platform}', '${profileName}')">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>
            </button>
        </div>
    `;
    return card;
}

/**
 * createDiscordAccountCard - card مخصص لديسكورد لعرض الصورة واليوزرنيم
 */
/**
 * createDiscordAccountCard - card مخصص لديسكورد لعرض الصورة واليوزرنيم
 */
function createDiscordAccountCard(profile, cfg, index = 0) {
    // تأمين: نتأكد إن profile object وعنده name
    if (typeof profile === 'string') {
        profile = { name: profile, username: profile };
    }
    const profileName = String(profile.name || profile.username || profile.displayName || '');

    const card = document.createElement('div');
    card.className = 'account-card';
    card.setAttribute('data-profile', profileName);

    const indexStr = String(index + 1).padStart(2, '0');
    let avatarHtml = profile.avatarUrl ? `<img src="${profile.avatarUrl}" alt="${profileName}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">` : `<span>${profileName.substring(0, 2).toUpperCase()}</span>`;
    const usernameDisplay = profile.discordUsername ? `@${profile.discordUsername}` : cfg.name;
    const copyBtnHtml = profile.discordUsername ? `<svg onclick="copyToClipboard('${profile.discordUsername}', event)" title="Copy Username" style="cursor:pointer; opacity:0.4; transition:0.2s;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.4'" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>` : '';
    const safeAvatarUrl = profile.avatarUrl ? profile.avatarUrl.replace(/'/g, "\\'") : '';

    // 🔴 فحص هل الأكاونت متثبت؟
    let pinnedArr = JSON.parse(localStorage.getItem('baddel_pinned_accounts') || '[]');
    let isPinned = pinnedArr.some(p => p.platform === 'discord' && p.profileName === profileName);
    let pinClass = isPinned ? 'acc-pin-btn is-pinned' : 'acc-pin-btn';

    card.innerHTML = `
        <div class="acc-card-num">${indexStr}</div>
        <div class="acc-card-avatar" style="--acc-color: ${cfg.accent}; border-radius: 50%;">${avatarHtml}</div>
        <div class="acc-card-info">
            <div class="acc-card-name">${profileName}</div>
            <div class="acc-card-platform" style="display: flex; align-items: center; gap: 6px;">${usernameDisplay} ${copyBtnHtml}</div>
        </div>
        <div class="acc-card-actions">
            <button class="${pinClass}" title="Send to Home" onclick="handlePinAccount('discord', '${profileName}', '${profileName}', null, '${safeAvatarUrl}', this)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path></svg>
            </button>
            <button class="acc-switch-btn" style="--btn-accent: ${cfg.accent};" onclick="handleSwitchAccount('discord', '${profileName}', this)">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>
                Switch
            </button>
            <button class="acc-rename-btn" title="Rename Account" onclick="handleRenameAccount('discord', '${profileName}')">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4L18.5 2.5z"></path></svg>
            </button>
            <button class="acc-delete-btn" onclick="handleDeleteAccount('discord', '${profileName}')">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>
            </button>
        </div>
    `;
    return card;
}

// ============================================================
// 4. كارت ستيم
// ============================================================
function createSteamAccountCard(acc, cfg, index = 0) {
    const card = document.createElement('div');
    card.className = 'account-card';
    card.setAttribute('data-profile', acc.username);

    const initials = (acc.displayName || acc.username).substring(0, 2).toUpperCase();
    const indexStr = String(index + 1).padStart(2, '0');

    // 🔴 فحص هل الأكاونت متثبت؟
    let pinnedArr = JSON.parse(localStorage.getItem('baddel_pinned_accounts') || '[]');
    let isPinned = pinnedArr.some(p => p.platform === 'steam' && p.profileName === acc.username);
    let pinClass = isPinned ? 'acc-pin-btn is-pinned' : 'acc-pin-btn';

    card.innerHTML = `
        <div class="acc-card-num">${indexStr}</div>
        <div class="acc-card-avatar" style="--acc-color: ${cfg.accent}; border-radius: 50%;" id="avatar-${acc.steamId}">
            <span>${initials}</span>
        </div>
        <div class="acc-card-info">
            <div class="acc-card-name">${acc.displayName || acc.username}</div>
            <div class="acc-card-platform">@${acc.username}</div>
        </div>
        <div class="acc-card-actions">
            <button class="${pinClass}" title="Send to Home" onclick="handlePinAccount('steam', '${acc.username}', '${acc.displayName || acc.username}', '${acc.steamId}', null, this)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path></svg>
            </button>
            <button class="acc-switch-btn" style="--btn-accent: ${cfg.accent};" onclick="handleSwitchAccount('steam', '${acc.username}', this)">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>
                Switch
            </button>
        </div>
    `;

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
                el.innerHTML = `<img src="${imgUrl}" alt="${displayName}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
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
        showToast(`Switch failed: ${err}`, 'error');
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
    
    const name = await promptAccountName(`Save current ${PLATFORM_CONFIG[platform].name} account as:`);
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
    showToast(`Opening ${cfg.name}...`, 'success');

    try {
        await cfg.addFn();
    } catch (err) {
        showToast(`Error: ${err}`, 'error');
    } finally {
        isAccountProcessing = false;
    }
}

async function handleRenameAccount(platform, oldName) {
    if (isAccountProcessing) return;
    const newName = await promptAccountName(`Rename "${oldName}" to:`);
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
    if (fn) return fn(...args);

    console.warn(`[accounts.js] No method found for channel: ${channel}`);
    throw new Error(`IPC method not exposed: ${channel}`);
}

/**
 * promptAccountName - Custom isolated modal to prevent conflicts with Library UI
 */
function promptAccountName(message) {
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
        saveBtn.style.cssText = 'padding:8px 16px;background:#ff4655;border:none;border-radius:6px;color:#fff;cursor:pointer;font-weight:600;transition:0.2s;';
        saveBtn.onmouseover = () => saveBtn.style.background = '#e03e4b';
        saveBtn.onmouseout = () => saveBtn.style.background = '#ff4655';
        
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
    const syncBtn = document.getElementById('btn-sync-epic');
    if (syncBtn) { syncBtn.disabled = true; syncBtn.style.opacity = '0.5'; }
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
async function navigateToAllGames() {
    // تحديث الـ sidebar active state
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    document.getElementById('nav-all-games')?.classList.add('active');

    // إخفاء الـ views التانية
    if (typeof _hideAllViews === 'function') _hideAllViews();
    document.getElementById('allGamesView').style.display = 'block';

    await renderAllGamesView();
}

window.renderAllGamesView = async function() {
    const grid = document.getElementById('allGamesGrid');
    const epicNotLinked = document.getElementById('epicNotLinked'); // ممكن تغير الـ ID ده مستقبلاً لـ platformNotLinked
    const allGamesCount = document.getElementById('allGamesCount');
    if (!grid) return;

    // 1. فحص الـ status لـ Epic و Steam
    const status = await window.electronAPI.platformSyncStatus?.().catch(() => ({}));
    const isEpicLinked = status?.epic === true;
    const isSteamLinked = status?.steam === true;

    // 2. إخفاء رسالة "Not Linked" لو أي منصة مربوطة
    if (epicNotLinked) {
        epicNotLinked.style.display = (isEpicLinked || isSteamLinked) ? 'none' : 'flex';
    }

    if (!isEpicLinked && !isSteamLinked) {
        grid.innerHTML = `
            <div class="accounts-empty" style="padding: 60px 0; width:100%;">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#333" stroke-width="1.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path></svg>
                <p>No platform libraries linked yet.</p>
                <span>Connect Epic Games or Steam above to see your full library.</span>
            </div>`;
        return;
    }

    grid.innerHTML = `<div class="accounts-loading" style="padding:40px 0;"><div class="acc-spinner"></div><span>Loading library...</span></div>`;

    try {
        let rawGames = [];

        // 1. جلب الألعاب من المنصتين
        if (isEpicLinked) {
            const epicRes = await window.electronAPI.platformSyncGetCached?.('epic');
            if (epicRes?.games) rawGames.push(...epicRes.games);
        }
        if (isSteamLinked) {
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
                
            } else {
                // أول مرة نشوف اللعبة دي، هنجهز لها المصفوفات
                const newGame = { ...game };
                newGame.platforms = [game.platform]; // مصفوفة فيها المنصات
                newGame.allIds = { [game.platform]: game.id }; // Object فيه الـ ID بتاع كل منصة
                mergedGamesMap.set(cleanTitle, newGame);
            }
        });

        // تحويل الـ Map لـ Array عشان الـ Cache
        window._allGamesCache = Array.from(mergedGamesMap.values());

        // 3. تحديث الرقم في الـ Sidebar
        if (allGamesCount) {
            allGamesCount.textContent = window._allGamesCache.length > 0 ? window._allGamesCache.length : '—';
        }
        
        _renderAllGamesGrid(window._allGamesCache);
    } catch (err) {
        grid.innerHTML = `<div style="color:#e74c3c; padding:24px;">Error loading library: ${err.message}</div>`;
    }
};

function _renderAllGamesGrid(games) {
    const grid = document.getElementById('allGamesGrid');
    if (!grid) return;

    grid.innerHTML = '';

    if (!games || games.length === 0) {
        grid.innerHTML = `<div class="accounts-empty" style="padding:40px 0;width:100%;"><p>No games found.</p></div>`;
        _updateAgCount(0);
        return;
    }

    _updateAgCount(games.length);

    const PLAT_BADGE_META = {
        steam:   { color: '#66c0f4', icon: '../assets/Steam.png',   invert: false, label: 'Steam'   },
        epic:    { color: '#ffffff', icon: '../assets/epic.svg',    invert: true,  label: 'Epic'    },
        ea:      { color: '#ff6b35', icon: '../assets/ea.png',      invert: false, label: 'EA'      },
        riot:    { color: '#ff4655', icon: '../assets/riot.png',    invert: false, label: 'Riot'    },
        ubisoft: { color: '#00a8ff', icon: '../assets/ubisoft.png', invert: false, label: 'Ubisoft' },
    };

    let htmlString = '';

    games.forEach(game => {
        const safeTitle = (game.title || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        const rawId = game.id || game.appName || game.title || '';
        const safeId = String(rawId).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        const platformsStr = game.platforms.join(',');
        const safeIds = JSON.stringify(game.allIds).replace(/"/g, '&quot;');

        const MAX_VISIBLE = 3;
        const visiblePlats = game.platforms.slice(0, MAX_VISIBLE);
        const overflowCount = game.platforms.length - MAX_VISIBLE;

        let badgesHtml = visiblePlats.map(plat => {
            const m = PLAT_BADGE_META[plat] || { color: '#888', icon: null, invert: false, label: plat };
            const imgContent = m.icon
                ? `<img src="${m.icon}" alt="${m.label}" class="agc-badge-img${m.invert ? ' agc-badge-invert' : ''}">`
                : `<span class="agc-badge-dot" style="background:${m.color}"></span>`;
            return `<span class="agc-badge" style="--bc:${m.color}" title="${m.label}">${imgContent}</span>`;
        }).join('');

        if (overflowCount > 0) {
            badgesHtml += `<span class="agc-badge agc-badge-overflow" title="${game.platforms.slice(MAX_VISIBLE).join(', ')}">+${overflowCount}</span>`;
        }

        const isMulti = game.platforms.length > 1;

        htmlString += `
            <div class="game-card agc-card${isMulti ? ' agc-multi' : ''}"
                 data-id="${safeId}"
                 data-title="${safeTitle.toLowerCase()}"
                 data-platforms="${platformsStr}"
                 data-all-ids="${safeIds}">
                <div class="game-card-img-wrap">
                    ${game.coverUrl
                        ? `<img src="${game.coverUrl}" alt="${safeTitle}" class="game-card-img native-lazy-load" loading="lazy" decoding="async" onload="this.classList.add('loaded')" onerror="this.style.display='none'">`
                        : `<div class="game-card-img agc-placeholder"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#2a2a2a" stroke-width="1.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path></svg></div>`}
                    <div class="agc-badges-strip">${badgesHtml}</div>
                    <div class="agc-top-gradient"></div>
                </div>
                <div class="game-card-info">
                    <div class="game-card-title">${game.title}</div>
                </div>
            </div>`;
    });

    grid.innerHTML = htmlString;
}

function _updateAgCount(n) {
    const el = document.getElementById('agResultCount');
    if (el) el.textContent = n > 0 ? `${n} games` : '';
}

// ── Filter + Sort state ────────────────────────────────────────
window._agState = { platform: 'all', sort: 'title_asc', search: '' };

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

window.filterAllGames = function() {
    window._agState.search = (document.getElementById('allGamesSearch')?.value || '').toLowerCase();
    _applyAgFilters();
};

function _applyAgFilters() {
    const { platform, sort, search } = window._agState;
    let pool = [...(window._allGamesCache || [])];

    // 1. platform filter
    if (platform !== 'all') {
        pool = pool.filter(g => g.platforms.includes(platform));
    }

    // 2. search
    if (search.trim()) {
        pool = pool.filter(g => g.title.toLowerCase().includes(search));
    }

    // 3. sort
    if (sort === 'title_asc') {
        pool.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sort === 'title_desc') {
        pool.sort((a, b) => b.title.localeCompare(a.title));
    } else if (sort === 'playtime_desc') {
        pool.sort((a, b) => (b.playtime || 0) - (a.playtime || 0));
    } else if (sort === 'multi_first') {
        pool.sort((a, b) => b.platforms.length - a.platforms.length || a.title.localeCompare(b.title));
    }

    const mainScrollArea = document.getElementById('mainContentArea');
    if (mainScrollArea) mainScrollArea.scrollTop = 0;

    _renderAllGamesGrid(pool);
}


// ==========================================
// PLATFORMS MODAL LOGIC (Multi-Account)
// ==========================================
let activePlatformView = null;

function openPlatformsModal() {
    document.getElementById('platformsModal').classList.add('active');
    updatePlatformsOverview();
    openPlatformDetails('epic'); 
}

function closePlatformsModal() {
    document.getElementById('platformsModal').classList.remove('active');
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
    
    // نظبط الـ Active State في القائمة اللي على الشمال
    document.querySelectorAll('.platform-nav-item').forEach(el => el.classList.remove('active'));
    const activeItem = document.getElementById(`plat-nav-${platform}`);
    if (activeItem) activeItem.classList.add('active');
    
    const titles = { 'epic': 'Epic Games', 'steam': 'Steam' };
    document.getElementById('currentPlatformTitle').innerText = titles[platform] || platform;
    
    await renderPlatformAccounts(platform);
}

// بترسم لستة الحسابات وبتحسب كل حساب جاب كام لعبة
async function renderPlatformAccounts(platform) {
    const listContainer = document.getElementById('linkedAccountsList');
    listContainer.innerHTML = '<div style="text-align:center; padding: 20px; color:#888;">Loading...</div>';

    try {
        const accountsRes = await window.electronAPI.platformSyncGetAccounts(platform);
        const accounts = accountsRes.accounts || [];

        if (accounts.length === 0) {
            listContainer.innerHTML = '<div style="text-align:center; padding: 20px; color:#888;">No accounts linked yet.</div>';
            return;
        }

        // بنجيب الألعاب المتكيشة عشان نعد كل حساب جاب كام لعبة
        const gamesRes = await window.electronAPI.platformSyncGetCached(platform);
        const games = gamesRes.games || [];

        let html = '';
        for (const acc of accounts) {
            // بنعد الألعاب اللي الحساب ده بيملكها
            const aid = String(acc.id);
            const gamesCount = games.filter((g) => {
                if (g.platform === 'steam' && Array.isArray(g.steamLicensedAccountIds)) {
                    return g.steamLicensedAccountIds.some((id) => String(id) === aid);
                }
                return g.ownedByAccountIds && g.ownedByAccountIds.some((id) => String(id) === aid);
            }).length;
            
            html += `
                <div class="linked-account-item">
                    <div class="acc-name">
                        <h4>${acc.displayName}</h4>
                        <span>${gamesCount} Games Library</span>
                    </div>
                    <button class="btn-unlink" onclick="unlinkPlatformAccount('${acc.id}')">Unlink</button>
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
    try {
        const res = await window.electronAPI.platformSyncLink(activePlatformView);
        if (res.status === 'success') {
            // 1. تحديث الشاشة عشان الحساب يظهر
            await renderPlatformAccounts(activePlatformView);
            await updatePlatformsOverview();
            
            // 2. نطلع رسالة للمستخدم إننا بنسحب الألعاب
            showToast(`Account "${res.displayName}" linked! Syncing library automatically...`, 'info');

            try {
                // 3. ده السطر السحري اللي بيعمل Sync أوتوماتيك في الخلفية
                const syncRes = await window.electronAPI.platformSyncSync(activePlatformView);

                if (syncRes.status === 'success') {
                    const n = Array.isArray(syncRes.games) ? syncRes.games.length : 0;
                    showToast(`Library synced successfully! Found ${n} games.`, 'success');
                    await renderPlatformAccounts(activePlatformView);
                    if (typeof renderAllGamesView === 'function') await renderAllGamesView();
                }
            } catch (err) {
                showToast(`Account linked, but sync failed: ${err.message}`, 'error');
            }
        }
    } catch (err) {
        console.error('Link Error:', err);
        showToast('Failed to link account.', 'error');
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
                // نعمل ريفريش للستة بعد الحذف
                await renderPlatformAccounts(activePlatformView);
                // ريفريش للمكتبة الأساسية لو إيبك
                if (activePlatformView === 'epic' && typeof _renderEpicLibraryPanel === 'function') {
                    await _renderEpicLibraryPanel();
                }
            } catch (err) {
                console.error('Unlink Error:', err);
                showToast('Failed to unlink account.', 'error');
            }
        }
    );
}

async function syncCurrentPlatform() {
    if (!activePlatformView) return;
    const syncBtn = document.getElementById('syncPlatformBtn');
    
    try {
        syncBtn.innerText = 'Syncing...';
        syncBtn.disabled = true;
        
        await window.electronAPI.platformSyncSync(activePlatformView);

        await renderPlatformAccounts(activePlatformView);
        if (typeof renderAllGamesView === 'function') await renderAllGamesView();

        syncBtn.innerText = 'Sync Library';
        syncBtn.disabled = false;
        
    } catch (err) {
        console.error('Sync Error:', err);
        syncBtn.innerText = 'Sync Failed';
        setTimeout(() => {
            syncBtn.innerText = 'Sync Library';
            syncBtn.disabled = false;
        }, 3000);
    }
}

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