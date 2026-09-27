// ============================================================
// BADDEL LAUNCHER - PLAY LAUNCHER MODAL (play-launcher.js)
// ============================================================

const PL_PLATFORM_CONFIG = {
    steam:    { img: '../assets/Steam.png',    name: 'Steam',         color: '#1b2838',  accent: '#66c0f4', invert: false },
    epic:     { img: '../assets/epic.svg',     name: 'Epic Games',    color: '#181818',  accent: '#ffffff', invert: true  },
    gog:      { img: '../assets/gog.png',      name: 'GOG',           color: '#8638e5',  accent: '#a970ff', invert: false },
    ea:       { img: '../assets/ea.png',       name: 'EA App',        color: '#ff6b35',  accent: '#ff8c5a', invert: false },
    riot:     { img: '../assets/riot.png',     name: 'Riot Games',    color: '#ff4655',  accent: '#ff6673', invert: false },
    ubisoft:  { img: '../assets/ubisoft.png',  name: 'Ubisoft',       color: '#0070d1',  accent: '#00a8ff', invert: true  },
    discord:  { img: '../assets/discord.webp', name: 'Discord',       color: '#5865F2',  accent: '#7289da', invert: false },
    rockstar: { img: '../assets/rockstar.png', name: 'Rockstar',      color: '#1a1100',  accent: '#fcaf17', invert: false },
};

const PL_SWITCH_MAP = {
    steam:    (u) => window.electronAPI.switchSteam?.(u),
    epic:     (u) => window.electronAPI.switchEpic?.(u),
    gog:      (id) => window.electronAPI.switchGogAccount?.(id),
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
    gog:      () => window.electronAPI.getGogProfiles?.(),
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
    gog:   () => window.electronAPI.platformSyncGetAccounts?.('gog'),
};
const PL_SYNC_CACHE_MAP = {
    epic:  () => window.electronAPI.platformSyncGetCached?.('epic'),
    steam: () => window.electronAPI.platformSyncGetCached?.('steam'),
    gog:   () => window.electronAPI.platformSyncGetCached?.('gog'),
};



let _plCurrentGame      = null;
let _plSelectedPlatform = null;
let _plPrimaryPlatform  = null;
let _plLaunchOptions    = null;   // installed-only launch options (array | null)
let _plSelectedLaunchOpt = null;  // the option for the currently selected platform

function _plPrimaryKey(gameId) { return `baddel_primary_platform_${gameId}`; }

function _plRecordDownloadDiagnostic(game, eventType, payload = {}) {
    const taskId = game?.__downloadDiagnosticTaskId || _plCurrentGame?.__downloadDiagnosticTaskId;
    const api = window.electronAPI?.downloads;
    if (!taskId || !api?.diagnosticsEnabled || !api.recordDiagnostic) return;
    api.recordDiagnostic({ taskId, section: 'finalLaunchTarget', eventType, payload }).catch(() => {});
}

// Map a launch option to the platform key used by PL_PLATFORM_CONFIG / PL_PROFILES_MAP
function _plGetPlatformKey(opt) {
    const plat = (opt.scannerPlatform || opt.platform || '').toLowerCase();
    if (plat.includes('steam'))                        return 'steam';
    if (plat.includes('epic'))                         return 'epic';
    if (plat.includes('gog') || plat.includes('galaxy')) return 'gog';
    if (plat.includes('ea') || plat.includes('origin')) return 'ea';
    if (plat.includes('riot'))                         return 'riot';
    if (plat.includes('ubisoft'))                      return 'ubisoft';
    if (plat.includes('discord'))                      return 'discord';
    if (plat.includes('rockstar'))                     return 'rockstar';
    // Infer from command / path when platform string is missing
    const cmd = (opt.command || opt.path || '').toLowerCase();
    if (cmd.includes('steam://') || cmd.includes('\\steam\\')) return 'steam';
    if (cmd.includes('com.epicgames') || cmd.includes('epicgames')) return 'epic';
    if (cmd.includes('goggalaxy') || cmd.includes('galaxyclient') || cmd.includes('gog galaxy')) return 'gog';
    if (cmd.includes('origin') || cmd.includes('eaapp'))       return 'ea';
    if (cmd.includes('riotclient'))                            return 'riot';
    if (cmd.includes('ubisoft'))                               return 'ubisoft';
    return null;
}

function _plDirectEpicOwnerOptions(options) {
    return (Array.isArray(options) ? options : []).filter(option => option.ownsGame === true)
        .map(option => ({ ...option, notInSwitcher: false, enabled: option.enabled === true && option.actionStatus === 'ready' && !option.needsReauth }));
}

function _plIsManagedInstall(game, platform = _plGetPlatformKey(game || {})) {
    const provider = String(game?.installProvider || '').toLowerCase();
    const source = String(game?.installSource || '').toLowerCase();
    if (source !== 'download' && !provider) return false;
    return (platform === 'epic' && provider === 'legendary') || (platform === 'gog' && provider === 'gogdl');
}
window._plIsManagedInstall = _plIsManagedInstall;

function _plRequiresOfficialAccount(game, platform = _plGetPlatformKey(game || {})) {
    if (!['steam', 'epic', 'gog'].includes(platform) || _plIsManagedInstall(game, platform)) return false;
    if (platform !== 'gog') return true;
    const provider = String(game?.installProvider || '').toLowerCase();
    const command = String(game?.command || game?.launchCommand || '').trim().toLowerCase();
    return provider === 'gog_galaxy' || /^goggalaxy:\/\/launch\/[0-9]+$/.test(command) ||
        String(game?.launchType || '').toLowerCase() === 'gog-galaxy';
}
window._plRequiresOfficialAccount = _plRequiresOfficialAccount;

async function _plTrySingleManagedOwner(platform, install) {
    try {
        const provider = platform === 'epic' ? 'legendary' : 'gogdl';
        const options = await buildManagedProviderAccountOptions({ game: install, platform, provider });
        const owners = (Array.isArray(options) ? options : []).filter(option => option.enabled === true && option.actionStatus === 'ready');
        if (owners.length !== 1) return false;
        await _plLaunchWithPlatform(platform, owners[0].id, platform === 'gog', owners[0].displayName, owners[0].username, install);
        return true;
    } catch (error) {
        if (typeof showToast === 'function') showToast(error.message || 'Could not verify the owning account.', 'error');
        return true;
    }
}

async function _plTrySingleOfficialReady(platform, game, install) {
    if (typeof buildPlatformAccountOptions !== 'function') return null;
    const options = await buildPlatformAccountOptions({ game: install || game, platform, mode: 'play' });
    const allowedStatuses = platform === 'gog' ? ['ready'] : ['ready', 'sync_to_verify'];
    const ready = options.filter(option => allowedStatuses.includes(option.actionStatus) && option.enabled === true && option.inSwitcher !== false);
    if (options.length !== 1 || ready.length !== 1) return false;
    const account = ready[0];
    const switchArg = platform === 'steam' ? (account.username || account.id) :
        (platform === 'gog' ? account.id : (account.displayName || account.username || account.id));
    const result = await PL_SWITCH_MAP[platform]?.(switchArg);
    if (result?.status === 'error') throw new Error(result.message || `${platform} account switch failed.`);
    if (platform !== 'gog') await new Promise(resolve => setTimeout(resolve, platform === 'steam' ? 7000 : 800));
    await window._plDoActualLaunch({ ...(install || game), __forceRetryAfterOpen: platform !== 'epic' });
    return true;
}

async function _plTrySingleLegendaryOwner(install) {
    try {
        const owners = _plDirectEpicOwnerOptions(await buildDirectEpicInstallAccountOptions({ game: install }));
        const eligible = owners.filter(option => option.enabled === true);
        if (eligible.length !== 1) return false;
        const owner = eligible[0];
        await _plLaunchWithPlatform('epic', owner.id, false, owner.displayName, owner.username, install);
        return true;
    } catch (error) {
        if (typeof showToast === 'function') showToast(error.message || 'Reconnect Epic account and try again.', 'error');
        return true;
    }
}

// ============================================================
// ENTRY POINT
// ============================================================
const _plOpenPromises = new Map();

async function _plOpenPlayLauncherImpl(game) {
    if (!game) return;

    // ── Installed-only path: use launch options when available ───────────────────
    const launchOpts = (typeof window._gdBuildLaunchOptions === 'function')
        ? window._gdBuildLaunchOptions(game)
        : (game.installProvider === 'legendary' && _plGetPlatformKey(game) === 'epic' ? [game] : null);

    if (launchOpts !== null) {
        if (launchOpts.length === 0) {
            if (typeof showToast === 'function')
                showToast('Game is not installed locally. Use INSTALL to get it.', 'info');
            return;
        }

        _plCurrentGame    = game;
        _plLaunchOptions  = launchOpts;

        const seen = new Set();
        const platforms = launchOpts
            .map(opt => _plGetPlatformKey(opt))
            .filter(k => { if (!k || seen.has(k)) return false; seen.add(k); return true; });

        if (platforms.length === 0) {
            _plSelectedLaunchOpt = launchOpts[0];
            await _plDoActualLaunch(launchOpts[0]);
            return;
        }

        _plPrimaryPlatform   = localStorage.getItem(_plPrimaryKey(game.id)) || platforms[0];
        _plSelectedPlatform  = _plPrimaryPlatform;
        _plSelectedLaunchOpt = launchOpts.find(o => _plGetPlatformKey(o) === _plSelectedPlatform) || launchOpts[0];

        const directLegendary = platforms.length === 1 && platforms[0] === 'epic' && _plIsManagedInstall(_plSelectedLaunchOpt, 'epic');
        const directGog = platforms.length === 1 && platforms[0] === 'gog' && _plIsManagedInstall(_plSelectedLaunchOpt, 'gog');
        if (directLegendary && await _plTrySingleLegendaryOwner(_plSelectedLaunchOpt)) return;
        if (directGog) {
            await _plDoActualLaunch(_plSelectedLaunchOpt);
            return;
        }

        if (platforms.length === 1 && !directLegendary && !directGog) {
            const singlePlat = platforms[0];
            const singleOpt  = _plSelectedLaunchOpt;
            if (singlePlat === 'gog' && !_plRequiresOfficialAccount(singleOpt, 'gog')) {
                await _plDoActualLaunch(singleOpt);
                return;
            }
            if (['steam', 'epic', 'gog'].includes(singlePlat)) {
                try {
                    const handled = await _plTrySingleOfficialReady(singlePlat, game, singleOpt);
                    if (handled) return;
                    if (handled === false) throw Object.assign(new Error('Account selection required.'), { expected: true });
                } catch (error) {
                    if (!error?.expected) console.warn('[PlayLauncher] Canonical auto-launch check failed:', error);
                }
                _plBuildModal(game, platforms);
                _plShowModal();
                await _plLoadAccounts(singlePlat);
                return;
            }
            const fetchFn    = PL_PROFILES_MAP[singlePlat];
            if (!fetchFn) {
                await _plDoActualLaunch(singleOpt);
                return;
            }
            try {
                const rawAccts = await fetchFn();
                const accts    = Array.isArray(rawAccts) ? rawAccts : [];
                if (accts.length === 1) {
                    const normalizedAccts = _plNormalizeProfiles(singlePlat, accts);
                    const acct = normalizedAccts[0];
                    let forceModal = false;
                    if (['steam', 'epic', 'gog'].includes(singlePlat) && window.electronAPI?.platformSyncGetCached && window.electronAPI?.platformSyncGetAccounts) {
                        try {
                            const [accRes, cacheRes] = await Promise.all([
                                window.electronAPI.platformSyncGetAccounts(singlePlat),
                                window.electronAPI.platformSyncGetCached(singlePlat),
                            ]);
                            const syncAccounts  = accRes?.accounts || [];
                            const syncedLibrary = cacheRes?.games || [];
                            const resolvedId    = acct._resolvedSyncId || acct.platformAccountId || acct.id;
                            const syncAccount   = syncAccounts.find(sa => String(sa.id) === String(resolvedId));
                            const libGame       = _poFindLibraryGame(syncedLibrary, game, singlePlat);
                            const ownsGame = { steam: _poSteamOwnsGame, epic: _poEpicOwnsGame, gog: _poGogOwnsGame }[singlePlat];
                            if (!acct.platformAccountId || !syncAccount || !libGame || !ownsGame(libGame, syncAccount.id)) {
                                forceModal = true;
                                if (typeof showToast === 'function')
                                    showToast('This account has no Steam license for this game — choose another account or Launch Directly.', 'info');
                            }
                        } catch(e) {}
                    }
                    if (!forceModal) {
                        const switchFn = PL_SWITCH_MAP[singlePlat];
                        if (switchFn && acct) {
                            const switchArg = singlePlat === 'steam'
                                ? (acct.username || acct.id)
                                : (singlePlat === 'gog' ? acct.id : (acct.displayName || acct.id));
                            if (typeof showToast === 'function') showToast(`Switching to ${acct.displayName || switchArg}…`, 'info');
                            try {
                                await switchFn(switchArg);
                                if (singlePlat !== 'gog') await new Promise(r => setTimeout(r, singlePlat === 'steam' ? 7000 : 800));
                            } catch(e) {}
                        }
                        await _plDoActualLaunch(singleOpt);
                        return;
                    }
                }
            } catch(e) {
                console.warn('[PlayLauncher] Auto-launch check failed:', e);
            }
        }

        _plBuildModal(game, platforms);
        _plShowModal();
        await _plLoadAccounts(_plSelectedPlatform);
        return;
    }

    // ── Fallback: original behavior when _gdBuildLaunchOptions not yet loaded ────────
    _plCurrentGame       = game;
    _plLaunchOptions     = null;
    _plSelectedLaunchOpt = null;
    const platforms = _plDetectPlatforms(game);
    if (platforms.length === 0) {
        await _plDoActualLaunch(game);
        return;
    }
    _plPrimaryPlatform  = localStorage.getItem(_plPrimaryKey(game.id)) || platforms[0];
    _plSelectedPlatform = _plPrimaryPlatform;
    if (platforms.length === 1) {
        const singlePlat = platforms[0];
        if (singlePlat === 'gog' && !_plRequiresOfficialAccount(game, 'gog')) {
            await _plDoActualLaunch(game);
            return;
        }
        if (['steam', 'epic', 'gog'].includes(singlePlat)) {
            try {
                const handled = await _plTrySingleOfficialReady(singlePlat, game, game);
                if (handled) return;
            } catch (error) { console.warn('[PlayLauncher] Canonical auto-launch check failed:', error); }
            _plBuildModal(game, platforms);
            _plShowModal();
            await _plLoadAccounts(singlePlat);
            return;
        }
        const fetchFn    = PL_PROFILES_MAP[singlePlat];
        if (fetchFn) {
            try {
                const rawAccts = await fetchFn();
                const accts    = Array.isArray(rawAccts) ? rawAccts : [];
                if (accts.length === 1) {
                    const normalizedAccts = _plNormalizeProfiles(singlePlat, accts);
                    const acct = normalizedAccts[0];
                    let forceModal = false;
                    if (['steam', 'epic', 'gog'].includes(singlePlat) && window.electronAPI?.platformSyncGetCached && window.electronAPI?.platformSyncGetAccounts) {
                        try {
                            const [accRes, cacheRes] = await Promise.all([
                                window.electronAPI.platformSyncGetAccounts(singlePlat),
                                window.electronAPI.platformSyncGetCached(singlePlat),
                            ]);
                            const syncAccounts  = accRes?.accounts || [];
                            const syncedLibrary = cacheRes?.games || [];
                            const resolvedId = acct._resolvedSyncId || acct.platformAccountId || acct.id;
                            const syncAccount = syncAccounts.find((sa) => String(sa.id) === String(resolvedId));
                            const libGame = _poFindLibraryGame(syncedLibrary, game, singlePlat);
                            const ownsGame = { steam: _poSteamOwnsGame, epic: _poEpicOwnsGame, gog: _poGogOwnsGame }[singlePlat];
                            if (!acct.platformAccountId || !syncAccount || !libGame || !ownsGame(libGame, syncAccount.id)) {
                                forceModal = true;
                                if (typeof showToast === 'function')
                                    showToast('This account has no Steam license for this game — choose another account or Launch Directly.', 'info');
                            }
                        } catch (e) { /* keep auto-launch */ }
                    }
                    if (!forceModal) {
                        const switchFn = PL_SWITCH_MAP[singlePlat];
                        if (switchFn && acct) {
                            const switchArg = singlePlat === 'steam'
                                ? (acct.username || acct.id)
                                : (singlePlat === 'gog' ? acct.id : (acct.displayName || acct.id));
                            if (typeof showToast === 'function') showToast(`Switching to ${acct.displayName || switchArg}…`, 'info');
                            try {
                                await switchFn(switchArg);
                                if (singlePlat !== 'gog') await new Promise(r => setTimeout(r, singlePlat === 'steam' ? 7000 : 800));
                            } catch(e) {}
                        }
                        await _plDoActualLaunch(game);
                        return;
                    }
                }
            } catch(e) { console.warn('[PlayLauncher] Auto-launch check failed:', e); }
        }
    }
    _plBuildModal(game, platforms);
    _plShowModal();
    await _plLoadAccounts(_plSelectedPlatform);
}

window.openPlayLauncher = async function(game) {
    if (!game) return Promise.resolve();
    const key = String(game.id || game.appName || game.productId || game.name || 'unknown');
    const existing = _plOpenPromises.get(key);
    if (existing) return existing;
    const trigger = document.activeElement?.tagName === 'BUTTON' ? document.activeElement : null;
    if (trigger) { trigger.disabled = true; trigger.setAttribute('aria-busy', 'true'); }
    const promise = _plOpenPlayLauncherImpl(game).finally(() => {
        if (_plOpenPromises.get(key) === promise) _plOpenPromises.delete(key);
        if (trigger?.isConnected) { trigger.disabled = false; trigger.removeAttribute('aria-busy'); }
    });
    _plOpenPromises.set(key, promise);
    return promise;
};

// ============================================================
// delegated to the shared canonical resolver
// ============================================================
function _plDetectPlatforms(game) {
    const resolver = window._baddelCanonicalPlatforms || function() { return ['manual']; };
    // 'manual' is excluded here: manual games have no platform switcher and launch directly
    return resolver(game).filter(p => p !== 'manual');
}

// ============================================================
// BUILD MODAL
// ============================================================
function _plBuildModal(game, platforms) {
    document.getElementById('playLauncherModal')?.remove();

    const gameName  = game.name || 'Unknown Game';
    const artwork   = _plResolveArtworkForDisplay(game);
    const gameImage = artwork.cover?.value || '';
    const heroBg    = artwork.hero?.value || gameImage || '';

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
                        <span class="pl-section-title" id="plAccountTitle">Choose Account</span>
                        <span class="pl-section-sub" id="plAccountsSubtitle"></span>
                    </div>
                    <div id="plSelectedPlatformHint"></div>
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

function _plPlatformHintHtml(platKey, mode = 'play') {
    const cfg = PL_PLATFORM_CONFIG[platKey] || {
        name: String(platKey || 'Unknown Platform'),
        img: '',
        accent: '#ffffff',
        invert: false,
    };

    const label = mode === 'install' ? 'Installing from' : 'Playing from';

    return `
        <div class="pl-selected-platform-hint" style="--plat-accent:${cfg.accent || '#fff'}">
            <div class="pl-selected-platform-icon">
                ${cfg.img ? `<img src="${cfg.img}" alt="${cfg.name}" ${cfg.invert ? 'style="filter:invert(1)"' : ''}>` : ''}
            </div>
            <div class="pl-selected-platform-text">
                <div class="pl-selected-platform-kicker">${label}</div>
                <div class="pl-selected-platform-name">${cfg.name}</div>
            </div>
        </div>
    `;
}

function _plUpdateAccountPlatformHint(platKey) {
    const cfg = PL_PLATFORM_CONFIG[platKey];
    const hint = document.getElementById('plSelectedPlatformHint');
    const subtitle = document.getElementById('plAccountsSubtitle');

    if (subtitle) {
        subtitle.textContent = cfg?.name ? `on ${cfg.name}` : '';
    }

    if (hint) {
        hint.innerHTML = _plPlatformHintHtml(platKey, 'play');
    }
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
    // Keep selected launch option in sync with chosen platform
    if (_plLaunchOptions) {
        _plSelectedLaunchOpt = _plLaunchOptions.find(o => _plGetPlatformKey(o) === platKey) || null;
    }
    document.querySelectorAll('.pl-platform-card').forEach(c => c.classList.remove('selected'));
    document.getElementById(`plPlat-${platKey}`)?.classList.add('selected');
    await _plLoadAccounts(platKey);
};

window.plSetPrimary = function(platKey) {
    if (!_plCurrentGame) return;
    _plPrimaryPlatform = platKey;
    localStorage.setItem(_plPrimaryKey(_plCurrentGame.id), platKey);
    // Use installed-only launch options when available; otherwise fall back to canonical platform list
    let platforms;
    if (_plLaunchOptions) {
        const seen = new Set();
        platforms = _plLaunchOptions
            .map(opt => _plGetPlatformKey(opt))
            .filter(k => { if (!k || seen.has(k)) return false; seen.add(k); return true; });
    } else {
        platforms = _plDetectPlatforms(_plCurrentGame);
    }
    const row = document.getElementById('plPlatformsRow');
    if (row) row.innerHTML = platforms.map(p => _plBuildPlatformCard(p, _plSelectedPlatform)).join('');
    const hint = document.getElementById('plPrimaryHint');
    const cfg  = PL_PLATFORM_CONFIG[platKey];
    if (hint) { hint.textContent = `★ ${cfg?.name} set as primary`; hint.style.opacity = '1'; setTimeout(() => { hint.style.opacity = '0'; }, 2500); }
    if (typeof showToast === 'function') showToast(`${cfg?.name || platKey} set as primary`, 'success');
};

// ============================================================
// LOAD ACCOUNTS — sync data
// ============================================================
async function _plLoadAccounts(platKey) {
    _plUpdateAccountPlatformHint(platKey);
    const list     = document.getElementById('plAccountsList');
    const subtitle = document.getElementById('plAccountsSubtitle');
    const cfg      = PL_PLATFORM_CONFIG[platKey];
    if (!list) return;

    list.style.opacity = '0';
    if (subtitle) { subtitle.style.transition = 'opacity 0.15s ease-in-out'; subtitle.style.opacity = '0'; }
    await new Promise(r => setTimeout(r, 150));
    list.innerHTML = `<div class="pl-accounts-loading"><div class="pl-spinner"></div><span>Loading ${cfg?.name} accounts…</span></div>`;
    list.style.opacity = '1';

    let options = [];
    const selectedInstall = _plSelectedLaunchOpt || (_plLaunchOptions || []).find(option => _plGetPlatformKey(option) === platKey) || _plCurrentGame;
    const isLegendaryEpic = platKey === 'epic' && selectedInstall?.installProvider === 'legendary';
    const isManagedGog = platKey === 'gog' && _plIsManagedInstall(selectedInstall, 'gog');
    const accountTitle = document.getElementById('plAccountTitle');
    if (accountTitle) accountTitle.textContent = isLegendaryEpic ? 'Choose Epic Account' : 'Choose Account';
    const launchButton = document.getElementById('plLaunchBtn');
    if (launchButton) launchButton.disabled = isLegendaryEpic;
    try {
        const hasSyncSupport = platKey === 'steam' || platKey === 'epic' || platKey === 'gog';
        if (hasSyncSupport) {
            options = isLegendaryEpic
                ? _plDirectEpicOwnerOptions(await buildDirectEpicInstallAccountOptions({ game: selectedInstall }))
                : isManagedGog
                    ? await buildManagedProviderAccountOptions({ game: selectedInstall, platform: 'gog', provider: 'gogdl' })
                : await buildPlatformAccountOptions({ game: _plCurrentGame, platform: platKey, mode: 'play' });
        } else {
            const fetchFn = PL_PROFILES_MAP[platKey];
            if (!fetchFn) {
                list.style.opacity = '0';
                await new Promise(r => setTimeout(r, 150));
                list.innerHTML = `<div class="pl-no-accounts">No account switcher for ${cfg?.name}.</div>`;
                list.style.opacity = '1';
                return;
            }
            const rawProfiles = await fetchFn();
            options = _plNormalizeProfiles(platKey, rawProfiles).map(p => ({
                ...p,

                // Non-sync platforms like Riot, Ubisoft, EA, Rockstar, Discord
                // should be selectable accounts only.
                // Do NOT show "Sync to verify" because sync ownership verification
                // exists only for Steam and Epic.
                actionStatus: 'switcher_ready',
                ownershipStatus: 'not_applicable',

                enabled: true,
                inSwitcher: true,
                notInSwitcher: false,
                syncNotSupported: true,
            }));
        }
    } catch (err) {
        console.error('[PlayLauncher] Error loading accounts:', err);
        list.style.opacity = '0';
        await new Promise(r => setTimeout(r, 150));
        list.innerHTML = `
            <div class="pl-no-accounts">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                <div>${isLegendaryEpic ? 'Reconnect Epic account' : 'Error loading accounts.'}</div>
                <div class="pl-no-accounts-sub">${isLegendaryEpic ? 'Reconnect or sync an owning Epic account, then retry.' : 'Something went wrong while fetching your accounts.'}</div>
                <div style="display:flex; gap:10px; margin-top:15px;">
                    <button class="pl-btn-no-account-play" onclick="_plLoadAccounts('${platKey}')">Retry</button>
                    <button class="pl-btn-cancel" style="${isLegendaryEpic ? 'display:none;' : ''}background:rgba(255,255,255,0.05);" onclick="plDoLaunch(true)">Launch anyway</button>
                </div>
            </div>`;
        list.style.opacity = '1';
        return;
    }

    list.style.opacity = '0';
    await new Promise(r => setTimeout(r, 150));

    if (options.length === 0) {
        list.innerHTML = `
            <div class="pl-no-accounts">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
                <div>${isLegendaryEpic ? 'No synced Epic owner is ready' : `No saved accounts for ${cfg?.name}`}</div>
                <div class="pl-no-accounts-sub">${isLegendaryEpic ? 'Reconnect or sync an owning Epic account.' : 'Add accounts from the Accounts tab to enable auto-switching'}</div>
                <button class="pl-btn-no-account-play" onclick="plDoLaunch(true)" ${isLegendaryEpic ? 'style="display:none"' : ''}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
                    Launch Without Switch
                </button>
            </div>`;
        if (subtitle) { subtitle.textContent = 'No saved accounts'; subtitle.style.opacity = '1'; }
        list.style.opacity = '1';
        return;
    }

    const ownedCount    = options.filter(p => p.actionStatus === 'ready' && !p.notInSwitcher && (!isLegendaryEpic || p.enabled)).length;
    const notOwnedCount = options.filter(p => p.actionStatus === 'does_not_own' && !p.notInSwitcher).length;
    const ghostCount    = options.filter(p => p.notInSwitcher).length;
    if (subtitle) {
        if (ownedCount > 0) {
            let t = `${ownedCount} licensed account${ownedCount > 1 ? 's' : ''}`;
            if (notOwnedCount > 0) t += ` · ${notOwnedCount} not owned`;
            subtitle.textContent = t;
        } else if (notOwnedCount > 0) {
            subtitle.textContent = `${notOwnedCount} account${notOwnedCount > 1 ? 's' : ''} — no license for this game`;
        } else if (ghostCount > 0) {
            subtitle.textContent = `${ghostCount} account${ghostCount > 1 ? 's' : ''} own this game (not in Switcher)`;
        } else {
            subtitle.textContent = `${options.length} saved account${options.length > 1 ? 's' : ''}`;
        }
    }

    if (isLegendaryEpic && subtitle) {
        subtitle.textContent = ownedCount > 1
            ? 'This game is available on multiple synced Epic accounts.'
            : ownedCount === 0 ? 'No synced Epic owner is ready. Reconnect an Epic account that owns this game.' : 'Synced Epic owner';
    }

    const officialGog = platKey === 'gog' && _plRequiresOfficialAccount(selectedInstall, 'gog');
    const noSwitchRow = isLegendaryEpic ? '' : `
        <div class="pl-account-row no-switch" id="plAcct-__none__" onclick="plSelectAccount(null)" data-id="__none__" data-action-status="ready">
            <div class="pl-account-avatar no-switch-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5,3 19,12 5,21"/></svg>
            </div>
            <div class="pl-account-info">
                <div class="pl-account-name">Launch Directly</div>
                <div class="pl-account-sub">No account switch</div>
            </div>
            <div class="pl-account-check"></div>
        </div>`;

    const accountRows = options.map(opt => _poRenderAccountRow(opt, {
        idPrefix:     'plAcct-',
        makeOnClick:  (id) => `plSelectAccount('${id}')`,
        closeModalJs: 'closePlayLauncher()',
        platKey,
        platName:     cfg?.name  || platKey,
        platAccent:   cfg?.accent || '#fff',
    })).join('');

    list.innerHTML = noSwitchRow + accountRows;

    const firstOwned      = options.find(o => o.actionStatus === 'ready' && ((isLegendaryEpic || isManagedGog) ? o.enabled : !o.notInSwitcher));
    const firstSelectable = options.find(o => o.enabled && ((isLegendaryEpic || isManagedGog) || !o.notInSwitcher));
    const storedOwnerId = String(selectedInstall?.accountId || selectedInstall?.installedByAccountId || '');
    const storedOwner = isLegendaryEpic ? options.find(option => String(option.id) === storedOwnerId && option.enabled && option.actionStatus === 'ready') : null;
    plSelectAccount(storedOwner ? storedOwner.id : firstOwned ? firstOwned.id : firstSelectable ? firstSelectable.id : null);

    if (subtitle) subtitle.style.opacity = '1';
    list.style.opacity = '1';
}

// ============================================================
// ACCOUNT SELECTION
// ============================================================
window._plSelectedAccountId   = null;
window._plSelectedAccountName = null;

window.plSelectAccount = function(accountId) {
    const row = document.querySelector(`.pl-account-row[data-id="${accountId || '__none__'}"]`);
    if (row && row.getAttribute('aria-disabled') === 'true') return;
    const direct = _plSelectedPlatform === 'epic' && (_plSelectedLaunchOpt || _plCurrentGame)?.installProvider === 'legendary';
    const launchButton = document.getElementById('plLaunchBtn');
    if (launchButton && direct) launchButton.disabled = !accountId || !row || row.getAttribute('aria-disabled') === 'true';
    window._plSelectedAccountId       = accountId;
    window._plSelectedAccountName     = null;
    window._plSelectedAccountUsername = null;
    window._plSelectedActionStatus    = 'ready';
    document.querySelectorAll('.pl-account-row').forEach(r => r.classList.remove('selected'));
    if (row) {
        row.classList.add('selected');
        window._plSelectedAccountName     = row.dataset.name         || null;
        window._plSelectedAccountUsername = row.dataset.username      || null;
        window._plSelectedActionStatus    = row.dataset.actionStatus  || 'ready';
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
    const selectedInstall = _plSelectedLaunchOpt || (_plLaunchOptions || []).find(option => _plGetPlatformKey(option) === platKey) || _plCurrentGame;
    const isLegendaryEpic = platKey === 'epic' && selectedInstall?.installProvider === 'legendary';
    const isManagedGog = platKey === 'gog' && _plIsManagedInstall(selectedInstall, 'gog');
    if (isLegendaryEpic && (skipSwitch || noSwitch)) {
        if (typeof showToast === 'function') showToast('Choose a synced Epic account that owns this game.', 'warning');
        return;
    }
    const officialGog = platKey === 'gog' && _plRequiresOfficialAccount(selectedInstall, 'gog');
    if (!skipSwitch && !noSwitch) {
        const status = window._plSelectedActionStatus;
        if (officialGog && status !== 'ready') {
            if (typeof showToast === 'function') showToast('Choose a verified GOG account that owns this game.', 'warning');
            return;
        }
        if (status === 'does_not_own') {
            if (typeof showToast === 'function')
                showToast('This account has no license for this game. Choose an account that owns it, or use Launch Directly.', 'warning');
            return;
        }
        if (status === 'sync_to_verify') {
            if (typeof showToast === 'function')
                showToast("Warning: Ownership not verified. If the game doesn't launch, sync this account in the Accounts tab.", 'warning');
            // Continue launch
        }
    }
    closePlayLauncher();
    await _plLaunchWithPlatform(platKey, noSwitch ? null : accountId, skipSwitch || noSwitch || isManagedGog, accountName, accountUsername, (isLegendaryEpic || isManagedGog) ? selectedInstall : null);
};

async function _plLaunchWithPlatform(platKey, accountId, skipSwitch, accountName, accountUsername, selectedInstall = null) {
    const game = _plCurrentGame;
    if (!game) return;

    // Resolve the correct installed launch option for the chosen platform
    const selectedOpt =
        selectedInstall || _plSelectedLaunchOpt ||
        (_plLaunchOptions || []).find(o => _plGetPlatformKey(o) === platKey) ||
        null;

    const gameToLaunch = selectedOpt
        ? { ...game, ...selectedOpt }
        : { ...game };

    // Prefer local installed id; never overwrite with store/ownership allIds
    if (selectedOpt?.installedId) {
        gameToLaunch.id = selectedOpt.installedId;
    } else if (selectedOpt?.id) {
        gameToLaunch.id = selectedOpt.id;
    }

    if (platKey === 'epic' && gameToLaunch.installProvider === 'legendary') {
        if (!accountId) {
            if (typeof showToast === 'function') showToast('Choose an owning Epic account.', 'warning');
            return;
        }
        await _plDoActualLaunch(gameToLaunch, async () => {
            const launchArgs = [gameToLaunch.id, accountId];
            if (gameToLaunch.managedDownloadTaskId) launchArgs.push(gameToLaunch.managedDownloadTaskId);
            const result = await window.electronAPI.downloads?.launchEpicLegendary?.(...launchArgs);
            if (result?.status !== 'success') {
                const message = result?.code === 'EPIC_AUTH_REQUIRED'
                    ? 'Reconnect Epic account, then try Play again.'
                    : result?.message || 'Legendary launch failed.';
                throw new Error(message);
            }
            return result;
        });
        return;
    }

    // Guard: require local launch data
    if (!gameToLaunch.command && !gameToLaunch.path) {
        console.error('[PlayLauncher] No local launch data for selected option', {
            platKey,
            selectedOpt,
            currentGame: game
        });

        if (typeof showToast === 'function') {
            showToast('No local launch data for this installed option.', 'error');
        }

        return;
    }

    let didSwitch = false;

    if (!skipSwitch && accountId) {
        const switchFn = PL_SWITCH_MAP[platKey];

        if (switchFn) {
            try {
                // Steam needs AccountName; Epic and others use profile/account folder/name
                const switchArg = platKey === 'steam'
                    ? (accountUsername && accountUsername !== 'undefined' ? accountUsername : accountId)
                    : (platKey === 'gog' ? accountId : (accountUsername || accountName || accountId));

                if (typeof showToast === 'function') {
                    showToast(`Switching to ${accountName || switchArg}…`, 'info');
                }

                await switchFn(switchArg);
                didSwitch = true;

                // Epic needs more time after account switch before protocol launch retry
                const switchWaitMs =
                    platKey === 'steam' ? 7000 :
                    platKey === 'epic'  ? 6000 :
                    platKey === 'gog'   ? 0 :
                    1500;

                if (window.__debugPlayLaunch) {
                    console.log('[PlayLauncher] account switched', {
                        platKey,
                        accountId,
                        accountName,
                        accountUsername,
                        switchArg,
                        switchWaitMs
                    });
                }

                if (switchWaitMs > 0) await new Promise(r => setTimeout(r, switchWaitMs));

            } catch (err) {
                console.warn('[PlayLauncher] Switch failed:', err);

                if (platKey === 'gog') {
                    if (typeof showToast === 'function') showToast(err?.message || 'GOG account switch failed.', 'error');
                    return;
                }

                if (typeof showToast === 'function') {
                    showToast('Switch failed, launching anyway…', 'warning');
                }
            }
        }
    }

    // This flag tells main.js to retry the protocol after launcher opens (non-Epic only).
    // For Epic, main.js handles cold-start recovery automatically via _waitForEpicUiStable.
    gameToLaunch.__forceRetryAfterOpen = didSwitch && platKey !== 'epic';
    gameToLaunch.__preferGalaxyLaunch = didSwitch && platKey === 'gog' && gameToLaunch.installProvider === 'gog_galaxy';

    console.log('[PlayLauncher] final gameToLaunch for play', {
        id:              gameToLaunch.id,
        platform:        gameToLaunch.platform,
        scannerPlatform: gameToLaunch.scannerPlatform,
        command:         gameToLaunch.command,
        appName:         gameToLaunch.appName,
        launcherGameId:  gameToLaunch.launcherGameId,
        selectedOpt,
    });

    await _plDoActualLaunch(gameToLaunch);
}

function _plFirstAsset(...values) {
    for (const v of values) {
        const s = String(v || '').trim();
        if (s) return s;
    }
    return '';
}

function _plCssUrl(value) {
    const s = String(value || '').trim();
    if (!s) return '';
    return s.replace(/\\/g, '/').replace(/'/g, "\\'");
}

function _plValidArtworkItem(item) {
    return item && typeof item === 'object' && String(item.value || '').trim();
}

function _plResolveArtworkForDisplay(game, { fullMeta = null, cacheArtwork = null, placeholders = null } = {}) {
    const adapter = window.BaddelPlayLauncherArtworkAdapter;
    const legacy = adapter?.legacyPlayLauncherArtwork || function() {
        const cover = _plFirstAsset(
            game?.image,
            game?.cover,
            game?.coverUrl,
            game?.defaultImage,
            game?.posterImage,
            game?.coverImage,
            fullMeta?.cover,
            fullMeta?.image,
            fullMeta?.posterImage,
            fullMeta?.coverImage,
            cacheArtwork?.cover
        );
        const hero = _plFirstAsset(
            game?.heroImage,
            game?.hero,
            game?.defaultHero,
            game?.background,
            fullMeta?.heroImage,
            fullMeta?.hero,
            fullMeta?.defaultHero,
            fullMeta?.background,
            fullMeta?.assets?.hero,
            fullMeta?.assets?.heroImage,
            cacheArtwork?.hero,
            cacheArtwork?.cover,
            cover
        );
        const logo = _plFirstAsset(
            game?.logo,
            game?.defaultLogo,
            fullMeta?.logo,
            fullMeta?.defaultLogo,
            fullMeta?.assets?.logo,
            cacheArtwork?.logo
        );
        return {
            cover: { value: cover || null, source: cover ? 'legacy-fallback' : 'placeholder', reason: cover ? 'legacy Play Launcher artwork fallback' : 'no Play Launcher artwork candidate' },
            hero: { value: hero || null, source: hero ? 'legacy-fallback' : 'placeholder', reason: hero ? 'legacy Play Launcher artwork fallback' : 'no Play Launcher artwork candidate' },
            logo: { value: logo || null, source: logo ? 'legacy-fallback' : 'placeholder', reason: logo ? 'legacy Play Launcher artwork fallback' : 'no Play Launcher artwork candidate' },
        };
    };

    try {
        const resolved = adapter?.resolvePlayLauncherArtwork?.({
            game,
            fullMeta,
            cacheArtwork,
            placeholders,
        });
        if (resolved && ['cover', 'hero', 'logo'].some((type) => _plValidArtworkItem(resolved[type]))) {
            return resolved;
        }
    } catch (e) {
        console.warn('[PlayLauncher] artwork resolver failed:', e?.message || e);
    }

    return legacy({ game, fullMeta, cacheArtwork, placeholders });
}

async function _plResolveLaunchOverlayAssets(game) {
    const gameId = game?.id;

    let fullMeta = null;

    try {
        if (gameId && window.electronAPI?.loadFullMetadata) {
            fullMeta = await window.electronAPI.loadFullMetadata(gameId);
        }
    } catch (e) {
        console.warn('[LaunchOverlay] loadFullMetadata failed:', e?.message || e);
    }

    async function cached(type) {
        try {
            if (!gameId || !window.electronAPI?.getCachedImage) return '';
            return await window.electronAPI.getCachedImage(gameId, type);
        } catch (e) {
            console.warn(`[LaunchOverlay] getCachedImage(${type}) failed:`, e?.message || e);
            return '';
        }
    }

    const cachedHero  = await cached('hero');
    const cachedCover = await cached('cover');
    const cachedLogo  = await cached('logo');

    const resolved = _plResolveArtworkForDisplay(game, {
        fullMeta,
        cacheArtwork: {
            cover: cachedCover || null,
            hero: cachedHero || null,
            logo: cachedLogo || null,
        },
    });
    const hero = resolved.hero?.value || '';
    const logo = resolved.logo?.value || '';
    const sourceHero = resolved.hero?.source || 'none';
    const sourceLogo = resolved.logo?.source || 'none';

    console.log('[LaunchOverlay] resolved assets', {
        gameId,
        name: game?.name,
        hasHero: !!hero,
        hasLogo: !!logo,
        sourceHero,
        sourceLogo,
        reasonHero: resolved.hero?.reason,
        reasonLogo: resolved.logo?.reason
    });

    return {
        cover: resolved.cover?.value || '',
        hero,
        logo,
        sourceHero,
        sourceLogo
    };
}

// Launch overlay 
async function _plDoActualLaunch(game, launchExecutor = null) {
    if (window.isLaunching) return;
    _plRecordDownloadDiagnostic(game, 'FINAL_LAUNCH_TARGET', {
        game: { name: game?.name ?? game?.title ?? null, id: game?.id ?? null, platform: game?.platform ?? null, scannerPlatform: game?.scannerPlatform ?? null, path: game?.path ?? null, executablePath: game?.executablePath ?? null, command: game?.command ?? null, launchCommand: game?.launchCommand ?? null },
        selectedLaunchOption: _plSelectedLaunchOpt ? { id: _plSelectedLaunchOpt.id ?? null, name: _plSelectedLaunchOpt.name ?? _plSelectedLaunchOpt.title ?? null, platform: _plSelectedLaunchOpt.platform ?? null, scannerPlatform: _plSelectedLaunchOpt.scannerPlatform ?? null, path: _plSelectedLaunchOpt.path ?? null, executablePath: _plSelectedLaunchOpt.executablePath ?? null, command: _plSelectedLaunchOpt.command ?? null, launchCommand: _plSelectedLaunchOpt.launchCommand ?? null } : null,
    });
    window.isLaunching = true;

    if (window.__debugPlayLaunch) {
        console.log('[PlayLauncher] launch payload', {
            id:              game.id,
            installedId:     game.installedId,
            platform:        game.platform,
            scannerPlatform: game.scannerPlatform,
            command:         game.command,
            path:            game.path,
            executablePath:  game.executablePath,
        });
    }

    const overlay    = document.getElementById('launchOverlay');
    const bgDiv      = document.getElementById('launchBg');
    const logoImg    = document.getElementById('launchLogo');
    const titleTxt   = document.getElementById('launchTitle');
    const statusText = document.getElementById('launchText');

    if (logoImg)    { logoImg.style.display = 'none'; logoImg.src = ''; }
    if (titleTxt)   { titleTxt.style.display = 'none'; }
    if (statusText) { statusText.innerText = 'INITIALIZING...'; }

    try {
        const overlayAssets = await _plResolveLaunchOverlayAssets(game);

        if (bgDiv) {
            if (overlayAssets.hero) {
                bgDiv.style.backgroundImage = `url('${_plCssUrl(overlayAssets.hero)}')`;
            } else {
                bgDiv.style.backgroundImage = '';
            }
        }

        if (logoImg && overlayAssets.logo) {
            logoImg.src = overlayAssets.logo;
            logoImg.style.display = 'block';

            if (titleTxt) {
                titleTxt.style.display = 'none';
                titleTxt.innerText = '';
            }
        } else if (titleTxt) {
            titleTxt.innerText = game.name || game.title || 'Launching';
            titleTxt.style.display = 'block';
        }

        if (statusText) statusText.innerText = `STARTING ${(game.name || game.title || 'game').toUpperCase()}...`;
        if (overlay) overlay.classList.add('active');

        let trackPath = game.path;
        if (!trackPath && game.command) {
            const cleanCmd = game.command.replace(/"/g, '');
            trackPath = cleanCmd.substring(0, cleanCmd.lastIndexOf('\\'));
        }

        const launchRes = launchExecutor ? await launchExecutor() : await window.electronAPI.launchGame(
            game.id,
            {
                forceRetryAfterOpen: !!game.__forceRetryAfterOpen,
                preferGalaxyLaunch: !!game.__preferGalaxyLaunch,
            }
        );
        if (launchRes?.status === 'error') {
            console.error('[PlayLauncher] Launch failed:', launchRes);
            throw new Error(launchRes.message || launchRes.code || 'Launch failed');
        }
    } catch (e) {
        console.error('[PlayLauncher] Error starting game:', e);
        if (typeof showToast === 'function') {
            const message = launchExecutor ? `Could not start ${game.name || game.title || 'game'}: ${e.message || 'Launch failed'}` : 'Error starting game!';
            showToast(message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'), 'error');
        }
        if (overlay) overlay.classList.remove('active');
        window.isLaunching = false;
        return;
    }

    let finished = false;
    const finish = () => {
        if (finished) return;
        finished = true;
        window.removeEventListener('focus', onFocus);
        window.electronAPI.minimizeApp();
        setTimeout(() => { if (overlay) overlay.classList.remove('active'); window.isLaunching = false; }, 400);
    };

    const onFocus = () => { finish(); window.removeEventListener('focus', onFocus); };
    window.addEventListener('focus', onFocus);
    setTimeout(() => { if (!finished) finish(); }, 8000);
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
    _plLaunchOptions     = null;
    _plSelectedLaunchOpt = null;
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
    return (Array.isArray(raw) ? raw : []).map(p => _poNormalizeProfile(platform, p)).filter(Boolean);
}

// ── DevTools debug helper ──────────────────────────────────────────────────
window._debugPlayLaunchOptions = function() {
    return {
        currentGame:      _plCurrentGame,
        selectedPlatform: _plSelectedPlatform,
        selectedLaunchOpt: _plSelectedLaunchOpt,
        launchOptions:    _plLaunchOptions,
    };
};
