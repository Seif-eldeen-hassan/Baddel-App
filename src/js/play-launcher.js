// ============================================================
// BADDEL LAUNCHER - PLAY LAUNCHER MODAL (play-launcher.js)
// ============================================================

const PL_PLATFORM_CONFIG = {
    steam:    { img: '../assets/Steam.png',    name: 'Steam',         color: '#1b2838',  accent: '#66c0f4', invert: false },
    epic:     { img: '../assets/epic.svg',     name: 'Epic Games',    color: '#181818',  accent: '#ffffff', invert: true  },
    ea:       { img: '../assets/ea.png',       name: 'EA App',        color: '#ff6b35',  accent: '#ff8c5a', invert: false },
    riot:     { img: '../assets/riot.png',     name: 'Riot Games',    color: '#ff4655',  accent: '#ff6673', invert: false },
    ubisoft:  { img: '../assets/ubisoft.png',  name: 'Ubisoft',       color: '#0070d1',  accent: '#00a8ff', invert: true  },
    discord:  { img: '../assets/discord.webp', name: 'Discord',       color: '#5865F2',  accent: '#7289da', invert: false },
    rockstar: { img: '../assets/rockstar.png', name: 'Rockstar',      color: '#1a1100',  accent: '#fcaf17', invert: false },
};

const PL_SWITCH_MAP = {
    steam:    (u) => window.electronAPI.switchSteam?.(u),
    epic:     (u) => window.electronAPI.switchEpic?.(u),
    ea:       (u) => window.electronAPI.switchEA?.(u),
    riot:     (u) => window.electronAPI.switchRiot?.(u),
    ubisoft:  (u) => window.electronAPI.switchUbisoft?.(u),
    discord:  (u) => window.electronAPI.switchDiscordAccount?.(u),
    rockstar: (u) => window.electronAPI.switchRockstarAccount?.(u),
};

const PL_PROFILES_MAP = {
    steam: async () => {
        const accounts = await window.electronAPI.getSteamAccounts?.() || [];
        if (window.electronAPI.getSteamImage) {
            await Promise.all(accounts.map(async (acc) => {
                try {
                    acc.avatar = await window.electronAPI.getSteamImage(acc.steamId || acc.id);
                } catch(e) {}
            }));
        }
        return accounts;
    },
    epic:     () => window.electronAPI.getEpicProfiles?.(),
    ea:       () => window.electronAPI.getEAProfiles?.(),
    riot:     () => window.electronAPI.getRiotProfiles?.(),
    ubisoft:  () => window.electronAPI.getUbisoftProfiles?.(),
    discord:  () => window.electronAPI.getDiscordProfiles?.(),
    rockstar: () => window.electronAPI.getRockstarProfiles?.(),
};

// الـ sync data — Epic + Steam
const PL_SYNC_ACCOUNTS_MAP = {
    epic:  () => window.electronAPI.platformSyncGetAccounts?.('epic'),
    steam: () => window.electronAPI.platformSyncGetAccounts?.('steam'),
};
const PL_SYNC_CACHE_MAP = {
    epic:  () => window.electronAPI.platformSyncGetCached?.('epic'),
    steam: () => window.electronAPI.platformSyncGetCached?.('steam'),
};

function _plNormTitle(s) {
    return (s || '').toLowerCase().replace(/[®©™]/g, '').replace(/[:\-'']/g, ' ').replace(/\s+/g, ' ').trim();
}

function _plFindSyncedGame(syncedLibrary, game) {
    if (!syncedLibrary || !game) return null;
    const gameNorm = _plNormTitle(game.name || '');
    const cmdApp = (() => {
        const m = (game.command || game.id || '').match(/(\d{5,})/);
        return m ? m[1] : null;
    })();
    return syncedLibrary.find((lg) => {
        if (cmdApp && lg.appName && String(lg.appName) === cmdApp) return true;
        const t = _plNormTitle(lg.title || '');
        return t === gameNorm || t.includes(gameNorm) || gameNorm.includes(t);
    });
}

function _plSteamLicenseForAccount(libGame, accountIdStr) {
    if (!libGame) return false;
    const lic = libGame.steamLicensedAccountIds;
    if (Array.isArray(lic)) {
        if (lic.length === 0) return false;
        return lic.map(String).includes(String(accountIdStr));
    }
    return (libGame.ownedByAccountIds || []).map(String).includes(String(accountIdStr));
}

let _plCurrentGame      = null;
let _plSelectedPlatform = null;
let _plPrimaryPlatform  = null;

function _plPrimaryKey(gameId) { return `baddel_primary_platform_${gameId}`; }

// ============================================================
// ENTRY POINT
// ============================================================
window.openPlayLauncher = async function(game) {
    if (!game) return;
    _plCurrentGame = game;

    const platforms = _plDetectPlatforms(game);

    _plPrimaryPlatform  = localStorage.getItem(_plPrimaryKey(game.id)) || platforms[0];
    _plSelectedPlatform = _plPrimaryPlatform;

    // ✅ Auto-launch: منصة واحدة + أكونت واحد → switch وlaunch مباشرة بدون modal
    if (platforms.length === 1) {
        const singlePlat = platforms[0];
        const fetchFn    = PL_PROFILES_MAP[singlePlat];
        if (fetchFn) {
            try {
                const rawAccts = await fetchFn();
                const accts    = Array.isArray(rawAccts) ? rawAccts : [];
                if (accts.length === 1) {
                    const normalizedAccts = _plNormalizeProfiles(singlePlat, accts);
                    const acct    = normalizedAccts[0];
                    let forceModal = false;
                    if (singlePlat === 'steam' && window.electronAPI?.platformSyncGetCached && window.electronAPI?.platformSyncGetAccounts) {
                        try {
                            const [accRes, cacheRes] = await Promise.all([
                                window.electronAPI.platformSyncGetAccounts('steam'),
                                window.electronAPI.platformSyncGetCached('steam'),
                            ]);
                            const syncAccounts  = accRes?.accounts || [];
                            const syncedLibrary = cacheRes?.games || [];
                            const resolvedId = acct._resolvedSyncId || acct.platformAccountId || acct.id;
                            const syncAccount = syncAccounts.find((sa) => String(sa.id) === String(resolvedId));
                            const libGame = _plFindSyncedGame(syncedLibrary, game);
                            if (syncedLibrary.length > 0 && syncAccount && libGame && !_plSteamLicenseForAccount(libGame, syncAccount.id)) {
                                forceModal = true;
                                if (typeof showToast === 'function') {
                                    showToast('This account has no Steam license for this game — choose another account or Launch Directly.', 'info');
                                }
                            }
                        } catch (e) { /* keep auto-launch */ }
                    }
                    if (!forceModal) {
                        const switchFn = PL_SWITCH_MAP[singlePlat];
                        if (switchFn && acct) {
                            const switchArg = singlePlat === 'steam'
                                ? (acct.username || acct.id)
                                : (acct.displayName || acct.id);
                            if (typeof showToast === 'function') showToast(`Switching to ${acct.displayName || switchArg}\u2026`, 'info');
                            try {
                                await switchFn(switchArg);
                                const waitMs = singlePlat === 'steam' ? 7000 : 800;
                                await new Promise(r => setTimeout(r, waitMs));
                            } catch(e) {}
                        }
                        await _plDoActualLaunch(game);
                        return;
                    }
                }
            } catch(e) {
                console.warn('[PlayLauncher] Auto-launch check failed:', e);
            }
        }
    }

    _plBuildModal(game, platforms);
    _plShowModal();
    await _plLoadAccounts(_plSelectedPlatform);
};

// ============================================================
// كشف المنصات الحقيقية — من source/platform/command/path
// ============================================================
function _plDetectPlatforms(game) {
    const platforms = new Set();

    // 🟢 قراءة مصفوفة المنصات لو اللعبة مدمجة (Merged) من Cache
    if (game.platforms && Array.isArray(game.platforms)) {
        game.platforms.forEach(p => platforms.add(p.toLowerCase()));
    }

    const src  = (game.source   || '').toLowerCase();
    const plat = (game.platform || '').toLowerCase();
    const cmd  = (game.command  || '').toLowerCase();
    const p    = (game.path     || '').toLowerCase();

    if (src === 'epic'     || plat.includes('epic')     || cmd.includes('com.epicgames') || cmd.includes('epicgames'))
        platforms.add('epic');
    if (src === 'steam'    || plat.includes('steam')    || cmd.includes('steam://')      || p.includes('\\steam\\'))
        platforms.add('steam');
    if (src === 'ea'       || plat.includes('ea')       || plat.includes('origin')       || cmd.includes('origin') || cmd.includes('eadesktop'))
        platforms.add('ea');
    if (src === 'riot'     || plat.includes('riot')     || cmd.includes('riot'))
        platforms.add('riot');
    if (src === 'ubisoft'  || plat.includes('ubisoft')  || cmd.includes('ubisoft'))
        platforms.add('ubisoft');
    if (src === 'rockstar' || plat.includes('rockstar') || cmd.includes('rockstar'))
        platforms.add('rockstar');

    if (platforms.size === 0) platforms.add('steam');
    return [...platforms];
}

// ============================================================
// BUILD MODAL
// ============================================================
function _plBuildModal(game, platforms) {
    document.getElementById('playLauncherModal')?.remove();
    // ✅ زود ستايل pl-badge-unknown لو مجوشم بعد
    if (!document.getElementById('pl-badge-unknown-style')) {
        const st = document.createElement('style');
        st.id = 'pl-badge-unknown-style';
        st.textContent = `
            .pl-badge-unknown {
                background: rgba(255,255,255,0.06);
                color: rgba(255,255,255,0.45);
                border: 1px solid rgba(255,255,255,0.12);
                font-size: 10px;
                padding: 2px 7px;
                border-radius: 10px;
                white-space: nowrap;
                cursor: help;
            }
        `;
        document.head.appendChild(st);
    }

    const gameName  = game.name || 'Unknown Game';
    const gameImage = game.image || '';
    const heroBg    = game.heroImage || game.image || '';

    const modal = document.createElement('div');
    modal.id        = 'playLauncherModal';
    modal.className = 'pl-backdrop';
    modal.innerHTML = `
        <div class="pl-modal" id="plModalInner">

            <div class="pl-hero" style="${heroBg ? `background-image:url('${heroBg.replace(/\\/g, '/')}')` : 'background:linear-gradient(135deg,#0f0f18,#1a1a2e)'}">
                <div class="pl-hero-overlay"></div>
                <div class="pl-hero-content">
                    ${gameImage
                        ? `<img class="pl-game-cover" src="${gameImage}" alt="${gameName}">`
                        : `<div class="pl-game-cover-placeholder">${gameName.substring(0,2).toUpperCase()}</div>`}
                    <div class="pl-game-info">
                        <div class="pl-game-label">LAUNCH GAME</div>
                        <h2 class="pl-game-name">${gameName}</h2>
                    </div>
                </div>
                <button class="pl-close-btn" onclick="closePlayLauncher()">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>

            <div class="pl-body">

                ${platforms.length > 1 ? `
                <div class="pl-section">
                    <div class="pl-section-header">
                        <div class="pl-step-badge">1</div>
                        <span class="pl-section-title">Choose Platform</span>
                    </div>
                    <div class="pl-platforms-row" id="plPlatformsRow">
                        ${platforms.map(p => _plBuildPlatformCard(p, _plPrimaryPlatform)).join('')}
                    </div>
                    <div class="pl-primary-hint" id="plPrimaryHint"></div>
                </div>
                <div class="pl-divider"></div>
                ` : `<div id="plPlatformsRow" style="display:none"></div><div id="plPrimaryHint" style="display:none"></div>`}

                <div class="pl-section">
                    <div class="pl-section-header">
                        <div class="pl-step-badge">${platforms.length > 1 ? '2' : '1'}</div>
                        <span class="pl-section-title">Choose Account</span>
                        <span class="pl-section-sub" id="plAccountsSubtitle"></span>
                    </div>
                    <div class="pl-accounts-list" id="plAccountsList">
                        <div class="pl-accounts-loading">
                            <div class="pl-spinner"></div>
                            <span>Loading accounts…</span>
                        </div>
                    </div>
                </div>

            </div>

            <div class="pl-footer">
                <button class="pl-btn-cancel" onclick="closePlayLauncher()">Cancel</button>
                <button class="pl-btn-launch" id="plLaunchBtn" onclick="plDoLaunch()">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
                    Launch
                </button>
            </div>

        </div>
    `;

    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) closePlayLauncher(); });
    document.addEventListener('keydown', _plKeyHandler);
}

function _plBuildPlatformCard(platKey, selected) {
    const cfg = PL_PLATFORM_CONFIG[platKey];
    if (!cfg) return '';
    const isSelected = platKey === selected;
    const isPrimary  = platKey === (_plCurrentGame ? localStorage.getItem(_plPrimaryKey(_plCurrentGame.id)) : null);
    return `
        <div class="pl-platform-card ${isSelected ? 'selected' : ''}"
             id="plPlat-${platKey}" data-plat="${platKey}"
             onclick="plSelectPlatform('${platKey}')"
             style="--plat-color:${cfg.color};--plat-accent:${cfg.accent}">
            <div class="pl-platform-icon-wrap">
                <img src="${cfg.img}" alt="${cfg.name}" ${cfg.invert ? 'style="filter:invert(1)"' : ''}>
            </div>
            <span class="pl-platform-name">${cfg.name}</span>
            ${isPrimary ? `<div class="pl-primary-star">★</div>` : ''}
        </div>`;
}

// ============================================================
// PLATFORM SELECTION
// ============================================================
window.plSelectPlatform = async function(platKey) {
    if (_plSelectedPlatform === platKey) return;
    _plSelectedPlatform = platKey;
    document.querySelectorAll('.pl-platform-card').forEach(c => c.classList.remove('selected'));
    document.getElementById(`plPlat-${platKey}`)?.classList.add('selected');
    await _plLoadAccounts(platKey);
};

window.plSetPrimary = function(platKey) {
    if (!_plCurrentGame) return;
    _plPrimaryPlatform = platKey;
    localStorage.setItem(_plPrimaryKey(_plCurrentGame.id), platKey);
    const platforms = _plDetectPlatforms(_plCurrentGame);
    const row = document.getElementById('plPlatformsRow');
    if (row) row.innerHTML = platforms.map(p => _plBuildPlatformCard(p, _plSelectedPlatform)).join('');
    const hint = document.getElementById('plPrimaryHint');
    const cfg  = PL_PLATFORM_CONFIG[platKey];
    if (hint) { hint.textContent = `★ ${cfg?.name} set as primary`; hint.style.opacity = '1'; setTimeout(() => { hint.style.opacity = '0'; }, 2500); }
    if (typeof showToast === 'function') showToast(`${cfg?.name || platKey} set as primary`, 'success');
};

// ============================================================
// LOAD ACCOUNTS — تفلتر حقيقي من الـ sync data
// ============================================================
async function _plLoadAccounts(platKey) {
    const list     = document.getElementById('plAccountsList');
    const subtitle = document.getElementById('plAccountsSubtitle');
    const cfg      = PL_PLATFORM_CONFIG[platKey];
    if (!list) return;

    // 🟢 1. تأثير اختفاء ناعم للقائمة والعنوان الفرعي
    list.style.opacity = '0';
    if (subtitle) {
        subtitle.style.transition = 'opacity 0.15s ease-in-out';
        subtitle.style.opacity = '0';
    }
    await new Promise(r => setTimeout(r, 150));

    list.innerHTML = `<div class="pl-accounts-loading"><div class="pl-spinner"></div><span>Loading ${cfg?.name} accounts…</span></div>`;
    list.style.opacity = '1';

    try {
        const fetchFn = PL_PROFILES_MAP[platKey];
        if (!fetchFn) {
            list.style.opacity = '0';
            await new Promise(r => setTimeout(r, 150));
            list.innerHTML = `<div class="pl-no-accounts">No account switcher for ${cfg?.name}.</div>`;
            list.style.opacity = '1';
            return;
        }
        const rawProfiles    = await fetchFn();
        const switcherProfiles = _plNormalizeProfiles(platKey, rawProfiles);

        let syncAccounts = [];
        let syncedLibrary = [];
        
        if (window.electronAPI.platformSyncGetAccounts && window.electronAPI.platformSyncGetCached) {
            try {
                const [accRes, cacheRes] = await Promise.all([
                    window.electronAPI.platformSyncGetAccounts(platKey),
                    window.electronAPI.platformSyncGetCached(platKey)
                ]);
                syncAccounts  = accRes?.accounts  || [];
                syncedLibrary = cacheRes?.games   || [];
            } catch (e) {}
        }

        // --- ضيف السطور دي هنا للـ Debugging ---
        if (platKey === 'steam') {
            console.log("=== 🔍 STEAM ACCOUNTS DEBUG ===");
            console.log("1. Switcher Profiles (Raw from app):", switcherProfiles);
            console.log("2. Synced Accounts (From backend sync):", syncAccounts);
            console.log("================================");
        }
        // ----------------------------------------

        const gameName = (_plCurrentGame?.name || '').toLowerCase().trim();
        const libGameMatch = _plFindSyncedGame(syncedLibrary, _plCurrentGame);

        const finalProfiles = switcherProfiles.map((profile) => {
            const resolvedId = profile._resolvedSyncId || profile.platformAccountId || profile.id || null;
            let syncAccount;

            if (resolvedId) {
                syncAccount = syncAccounts.find((sa) => String(sa.id) === String(resolvedId));
            }

            if (!syncAccount) {
                syncAccount = syncAccounts.find((sa) => {
                    const saName = (sa.displayName || '').toLowerCase().trim();
                    const pName  = (profile.displayName || '').toLowerCase().trim();
                    const pUser  = (profile.username || '').toLowerCase().trim();
                    if (!saName) return false;
                    return saName === pName || saName === pUser;
                });
            }

            const isSynced = !!syncAccount;
            let ownershipStatus = 'unknown';

            if (syncAccount) {
                if (syncAccount.displayName && syncAccount.displayName !== syncAccount.id) {
                    profile.displayName = syncAccount.displayName;
                }
                if (syncAccount.avatar) {
                    profile.avatar = syncAccount.avatar;
                }

                if (platKey === 'steam') {
                    if (!libGameMatch) ownershipStatus = 'unknown';
                    else ownershipStatus = _plSteamLicenseForAccount(libGameMatch, syncAccount.id) ? 'owned' : 'install-only';
                } else if (platKey === 'epic') {
                    if (!libGameMatch) ownershipStatus = 'unknown';
                    else {
                        const inOwn = (libGameMatch.ownedByAccountIds || []).map(String).includes(String(syncAccount.id));
                        ownershipStatus = inOwn ? 'owned' : 'not-owned';
                    }
                } else ownershipStatus = 'unknown';
            } else if (resolvedId && syncedLibrary.length > 0) {
                if (platKey === 'steam') {
                    if (!libGameMatch) ownershipStatus = 'unknown';
                    else ownershipStatus = _plSteamLicenseForAccount(libGameMatch, resolvedId) ? 'owned' : 'install-only';
                } else if (platKey === 'epic') {
                    const inOwn = libGameMatch && (libGameMatch.ownedByAccountIds || []).map(String).includes(String(resolvedId));
                    ownershipStatus = inOwn ? 'owned' : 'unknown';
                } else ownershipStatus = 'unknown';
            } else {
                ownershipStatus = 'unknown';
            }

            return { ...profile, isSynced, ownershipStatus, syncAccountId: syncAccount?.id, _hasLibraryData: syncedLibrary.length > 0 };
        }).filter((profile) => {
            if (syncedLibrary.length === 0) return true;
            return profile.ownershipStatus !== 'not-owned';
        });

        // 🟢 Ghost accounts: أكاونتات بتملك اللعبة من الـ Sync بس مش في الـ Switcher
        if (syncedLibrary.length > 0) {
            const switcherIds = new Set(switcherProfiles.map(p => {
                const id = p._resolvedSyncId || p.platformAccountId || p.id;
                return id ? String(id) : null;
            }).filter(Boolean));

            const switcherNames = new Set(switcherProfiles.map(p =>
                (p.displayName || p.username || '').toLowerCase().trim()
            ).filter(Boolean));

            syncAccounts.forEach(sa => {
                // هل الأكاونت ده موجود في الـ Switcher؟
                const alreadyInSwitcher = switcherIds.has(String(sa.id)) ||
                    switcherNames.has((sa.displayName || '').toLowerCase().trim());
                if (alreadyInSwitcher) return;

                if (!libGameMatch) return;
                const ownsGame = platKey === 'steam'
                    ? _plSteamLicenseForAccount(libGameMatch, sa.id)
                    : (libGameMatch.ownedByAccountIds || []).map(String).includes(String(sa.id));
                if (!ownsGame) return;

                // ضيفه كـ ghost entry (disabled — مش في الـ Switcher)
                finalProfiles.push({
                    id:              `ghost-${sa.id}`,
                    displayName:     sa.displayName || sa.id,
                    username:        sa.displayName || sa.id,
                    avatar:          sa.avatar || null,
                    isSynced:        true,
                    ownershipStatus: 'owned',
                    notInSwitcher:   true,
                    _hasLibraryData: true,
                    syncAccountId:   sa.id,
                });
            });
        }

        // 🟢 2. اختفاء اللودنج
        list.style.opacity = '0';
        await new Promise(r => setTimeout(r, 150));

        if (finalProfiles.length === 0) {
            list.innerHTML = `
                <div class="pl-no-accounts">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
                    <div>No saved accounts for ${cfg?.name}</div>
                    <div class="pl-no-accounts-sub">Add accounts from the Accounts tab to enable auto-switching</div>
                    <button class="pl-btn-no-account-play" onclick="plDoLaunch(true)">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
                        Launch Without Switch
                    </button>
                </div>`;
            if (subtitle) subtitle.textContent = 'No saved accounts';
            if (subtitle) subtitle.style.opacity = '1';
            list.style.opacity = '1';
            return;
        }

        const ownedCount  = finalProfiles.filter((p) => p.ownershipStatus === 'owned' && !p.notInSwitcher).length;
        const installOnly = finalProfiles.filter((p) => p.ownershipStatus === 'install-only' && !p.notInSwitcher).length;
        const ghostCount  = finalProfiles.filter((p) => p.notInSwitcher).length;
        if (subtitle) {
            if (ownedCount > 0) {
                let t = `${ownedCount} licensed account${ownedCount > 1 ? 's' : ''}`;
                if (installOnly > 0 && platKey === 'steam') t += ` · ${installOnly} installed only (no license)`;
                subtitle.textContent = t;
            } else if (installOnly > 0 && platKey === 'steam') {
                subtitle.textContent = `${installOnly} account${installOnly > 1 ? 's' : ''} — installed, no Steam license on this account`;
            } else if (ghostCount > 0) {
                subtitle.textContent = `${ghostCount} account${ghostCount > 1 ? 's' : ''} own this game (not in Switcher)`;
            } else {
                subtitle.textContent = `${finalProfiles.length} saved account${finalProfiles.length > 1 ? 's' : ''}`;
            }
        }

        const noSwitchRow = `
            <div class="pl-account-row no-switch" id="plAcct-__none__" onclick="plSelectAccount(null)" data-id="__none__" data-steam-license="yes">
                <div class="pl-account-avatar no-switch-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5,3 19,12 5,21"/></svg>
                </div>
                <div class="pl-account-info">
                    <div class="pl-account-name">Launch Directly</div>
                    <div class="pl-account-sub">No account switch</div>
                </div>
                <div class="pl-account-check"></div>
            </div>`;

        const accountRows = finalProfiles.map(p => {
            const initials = (p.displayName || '??').substring(0, 2).toUpperCase();
            const accent   = cfg?.accent || '#fff';

            // 🟢 Ghost account: بيملك اللعبة بس مش في الـ Switcher
            if (p.notInSwitcher) {
                const platName = cfg?.name || platKey;
                return `
                    <div class="pl-ghost-wrapper">
                        <div class="pl-account-row pl-account-row-ghost" id="plAcct-${p.id}">
                            <div class="pl-account-avatar" style="background:${accent}22;border-color:${accent}44">
                                ${p.avatar ? `<img src="${p.avatar}" alt="${p.displayName}">` : `<span>${initials}</span>`}
                            </div>
                            <div class="pl-account-info">
                                <div class="pl-account-name">${p.displayName}</div>
                                <div class="pl-account-sub" style="color:rgba(255,255,255,0.3);">Not in Switcher</div>
                            </div>
                            <div class="pl-owned-badge pl-badge-owned" style="opacity:0.8;">✓ Owned Game</div>
                        </div>
                        <div class="pl-ghost-tooltip">
                            <div class="pl-ghost-tooltip-title">Account not in Switcher</div>
                            <div class="pl-ghost-tooltip-body">This account owns the game but hasn't been added to your ${platName} Switcher yet.</div>
                            <button class="pl-ghost-go-btn" onclick="closePlayLauncher(); selectAccountPlatform('${platKey}');">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
                                Add to ${platName} Switcher
                            </button>
                        </div>
                    </div>`;
            }

            let badge = '';
            const steamLic = platKey !== 'steam' ? 'yes' : (p.ownershipStatus === 'owned' ? 'yes' : p.ownershipStatus === 'install-only' ? 'no' : 'unk');
            if      (p.ownershipStatus === 'owned')       badge = `<div class="pl-owned-badge pl-badge-owned">✓ Licensed</div>`;
            else if (p.ownershipStatus === 'install-only') badge = `<div class="pl-owned-badge pl-badge-install-only" title="Files may be on this PC, but this account has no Steam license. Steam may refuse to launch.">Installed · No license</div>`;
            else if (p.ownershipStatus === 'not-owned')   badge = `<div class="pl-owned-badge pl-badge-not-owned">✗ Doesn't Own</div>`;
            else if (p.ownershipStatus === 'unknown' && p._hasLibraryData)   badge = `<div class="pl-owned-badge pl-badge-unknown" title="Sync this account in the Accounts tab to verify ownership">— Sync to verify</div>`;
            else if (p.isSynced)                          badge = `<div class="pl-owned-badge pl-badge-synced">Synced</div>`;

            return `
                <div class="pl-account-row" id="plAcct-${p.id}"
                     onclick="plSelectAccount('${p.id}')"
                     data-id="${p.id}" data-name="${p.displayName}" data-username="${p.username || p.id}" data-steam-license="${steamLic}">
                    <div class="pl-account-avatar" style="background:${accent}22;border-color:${accent}44">
                        ${p.avatar ? `<img src="${p.avatar}" alt="${p.displayName}">` : `<span>${initials}</span>`}
                    </div>
                    <div class="pl-account-info">
                        <div class="pl-account-name">${p.displayName}</div>
                        <div class="pl-account-sub">${p.username && p.username !== p.displayName ? p.username : (cfg?.name || platKey)}</div>
                    </div>
                    ${badge}
                    <div class="pl-account-check"></div>
                </div>`;
        }).join('');

        list.innerHTML = noSwitchRow + accountRows;

        const firstOwned = finalProfiles.find((p) => p.ownershipStatus === 'owned' && !p.notInSwitcher);
        const firstSelectable = finalProfiles.find((p) => !p.notInSwitcher);
        plSelectAccount(firstOwned?.id || firstSelectable?.id || null);

        // 🟢 3. إظهار البيانات بسلاسة
        if (subtitle) subtitle.style.opacity = '1';
        list.style.opacity = '1';

    } catch (err) {
        console.error('[PlayLauncher] Error:', err);
        list.style.opacity = '0';
        await new Promise(r => setTimeout(r, 150));
        list.innerHTML = `<div class="pl-no-accounts">Error loading accounts. <button class="pl-link-btn" onclick="plDoLaunch(true)">Launch anyway</button></div>`;
        list.style.opacity = '1';
    }
}

// ============================================================
// ACCOUNT SELECTION
// ============================================================
window._plSelectedAccountId   = null;
window._plSelectedAccountName = null;

window.plSelectAccount = function(accountId) {
    window._plSelectedAccountId = accountId;
    window._plSelectedAccountUsername = null;
    window._plSelectedSteamLicenseOk = true;
    document.querySelectorAll('.pl-account-row').forEach(r => r.classList.remove('selected'));
    const row = document.querySelector(`.pl-account-row[data-id="${accountId || '__none__'}"]`);
    if (row) {
        row.classList.add('selected');
        window._plSelectedAccountName     = row.dataset.name     || null;
        window._plSelectedAccountUsername = row.dataset.username || null;
        const lic = row.dataset.steamLicense;
        if (lic === 'no') window._plSelectedSteamLicenseOk = false;
        else if (lic === 'yes' || lic === 'unk') window._plSelectedSteamLicenseOk = true;
    }
};

// ============================================================
// LAUNCH
// ============================================================
window.plDoLaunch = async function(skipSwitch = false) {
    const accountId       = skipSwitch ? null : window._plSelectedAccountId;
    const accountName     = window._plSelectedAccountName;
    const accountUsername = window._plSelectedAccountUsername;
    const platKey         = _plSelectedPlatform;
    const noSwitch        = !accountId || accountId === '__none__';
    if (!skipSwitch && platKey === 'steam' && !noSwitch && window._plSelectedSteamLicenseOk === false) {
        if (typeof showToast === 'function') {
            showToast('This Steam account has no license for this game. Switch to an account that owns it, or use Launch Directly.', 'warning');
        }
        return;
    }
    closePlayLauncher();
    await _plLaunchWithPlatform(platKey, noSwitch ? null : accountId, skipSwitch || noSwitch, accountName, accountUsername);
};

async function _plLaunchWithPlatform(platKey, accountId, skipSwitch, accountName, accountUsername) {
    const game = _plCurrentGame;
    if (!game) return;

    // 🟢 تجهيز نسخة جديدة من بيانات اللعبة لنعطيها الـ ID الصحيح للمنصة المختارة
    let gameToLaunch = { ...game };
    if (game.allIds && game.allIds[platKey]) {
        gameToLaunch.id = game.allIds[platKey];
    }

    if (!skipSwitch && accountId) {
        const switchFn = PL_SWITCH_MAP[platKey];
        if (switchFn) {
            try {
                // ستيم محتاج الـ username (AccountName) مش الـ displayName (PersonaName)
                // باقي المنصات بتاخد الـ profileName اللي هو اسم الفولدر (= displayName)
                const switchArg = platKey === 'steam'
                    ? (accountUsername && accountUsername !== 'undefined' ? accountUsername : accountId)
                    : (accountName || accountId);
                if (typeof showToast === 'function') showToast(`Switching to ${accountName || switchArg}… Please for Steam to login`, 'info');
                await switchFn(switchArg);
                // Steam needs more time to fully initialize and auto-login before steam:// URLs work
                const switchWaitMs = platKey === 'steam' ? 7000 : 800;
                await new Promise(r => setTimeout(r, switchWaitMs));
            } catch (err) {
                console.warn('[PlayLauncher] Switch failed:', err);
                if (typeof showToast === 'function') showToast('Switch failed, launching anyway…', 'warning');
            }
        }
    }

    await _plDoActualLaunch(gameToLaunch);
}

// Launch overlay مباشرة — بدون triggerLaunchSequence عشان منعملش loop
async function _plDoActualLaunch(game) {
    if (window.isLaunching) return;
    window.isLaunching = true;

    const overlay    = document.getElementById('launchOverlay');
    const bgDiv      = document.getElementById('launchBg');
    const logoImg    = document.getElementById('launchLogo');
    const titleTxt   = document.getElementById('launchTitle');
    const statusText = document.getElementById('launchText');

    if (logoImg)    { logoImg.style.display = 'none'; logoImg.src = ''; }
    if (titleTxt)   { titleTxt.style.display = 'none'; }
    if (statusText) { statusText.innerText = 'INITIALIZING...'; }

    const bgUrl = game.heroImage || game.image || '';
    if (bgDiv && bgUrl) bgDiv.style.backgroundImage = `url('${bgUrl.replace(/\\/g, '/')}')`;

    if (logoImg && game.logo) { logoImg.src = game.logo; logoImg.style.display = 'block'; }
    else if (titleTxt) { titleTxt.innerText = game.name; titleTxt.style.display = 'block'; }

    if (statusText) statusText.innerText = `STARTING ${(game.name || '').toUpperCase()}...`;
    if (overlay) overlay.classList.add('active');

    let trackPath = game.path;
    if (!trackPath && game.command) {
        const cleanCmd = game.command.replace(/"/g, '');
        trackPath = cleanCmd.substring(0, cleanCmd.lastIndexOf('\\'));
    }

    try {
        const launchRes = await window.electronAPI.launchGame(game.command, game.id, trackPath, game.name);
        if (launchRes?.status === 'error') throw new Error(launchRes.message);
    } catch (e) {
        if (typeof showToast === 'function') showToast('Error starting game!', 'error');
        if (overlay) overlay.classList.remove('active');
        window.isLaunching = false;
        return;
    }

    const finish = () => {
        window.electronAPI.minimizeApp();
        setTimeout(() => { if (overlay) overlay.classList.remove('active'); window.isLaunching = false; }, 400);
    };

    const onFocus = () => { finish(); window.removeEventListener('focus', onFocus); };
    window.addEventListener('focus', onFocus);
    setTimeout(() => { if (window.isLaunching) { finish(); window.removeEventListener('focus', onFocus); } }, 8000);
}

// ============================================================
// SHOW / CLOSE
// ============================================================
function _plShowModal() {
    const modal = document.getElementById('playLauncherModal');
    if (!modal) return;
    requestAnimationFrame(() => {
        modal.classList.add('visible');
        document.getElementById('plModalInner')?.classList.add('visible');
    });
}

window.closePlayLauncher = function() {
    const modal = document.getElementById('playLauncherModal');
    if (!modal) return;
    modal.classList.remove('visible');
    document.getElementById('plModalInner')?.classList.remove('visible');
    document.removeEventListener('keydown', _plKeyHandler);
    setTimeout(() => modal.remove(), 300);
    window._plSelectedAccountId   = null;
    window._plSelectedAccountName = null;
};

function _plKeyHandler(e) {
    if (e.key === 'Escape') closePlayLauncher();
    if (e.key === 'Enter')  document.getElementById('plLaunchBtn')?.click();
}

// ============================================================
// NORMALIZE PROFILES
// ============================================================
function _plNormalizeProfiles(platform, raw) {
    if (!raw) return [];
    if (platform === 'steam') {
        return (Array.isArray(raw) ? raw : []).map(acc => ({
            // 🟢 تصحيح المسميات لتطابق الباك إند: steamId و displayName
            id:                acc.steamId || acc.SteamID || acc.id || acc.username,
            displayName:       acc.displayName || acc.PersonaName || acc.username || 'Unknown',
            username:          acc.username || acc.AccountName,
            avatar:            acc.avatar || acc.avatarUrl || acc.Avatar || null,
            platformAccountId: acc.platformAccountId || acc.steamId || null,
            _resolvedSyncId:   acc._resolvedSyncId || acc.steamId || null
        }));
    }
    return (Array.isArray(raw) ? raw : []).map(p => {
        if (typeof p === 'string') return { id: p, displayName: p, username: p, avatar: null, platformAccountId: null };
        return {
            id:                p.id || p.accountId || p.name,
            displayName:       p.displayName || p.discordUsername || p.name || 'Account',
            username:          p.username || p.name,
            avatar:            p.avatar || p.avatarUrl || p.picture || null,
            platformAccountId: p.platformAccountId || p.id || null,
            _resolvedSyncId:   p._resolvedSyncId   || null
        };
    });
}
