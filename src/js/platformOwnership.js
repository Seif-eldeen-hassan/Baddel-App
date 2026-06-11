// ============================================================
// PLATFORM OWNERSHIP — shared resolver for Play and Install modals
// ============================================================

// ── Normalize a game title for fuzzy matching ──────────────────
function _poNormTitle(s) {
    return (s || '').toLowerCase()
        .replace(/[®©™]/g, '')
        .replace(/[:\-'']/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
window._poNormTitle = _poNormTitle;

// ── Extract Steam App ID from game object ──────────────────────
function _poSteamInstallCandidates(game) {
    if (!game) {
        return {
            appid: null,
            candidates: [],
            reason: 'null game'
        };
    }

    const candidates = [];

    function addCandidate(value, source) {
        const s = String(value || '').trim();

        if (!/^\d+$/.test(s)) return;
        if (Number(s) <= 0) return;

        candidates.push({
            appid: s,
            source
        });
    }

    function extractSteamUri(value, source) {
        const s = String(value || '').trim();

        // steam://run/730
        // steam://rungameid/730
        // steam://install/730
        // steam://store/730
        const m = s.match(/steam:\/\/(?:rungameid|run|install|store)\/(\d+)/i);

        if (m) {
            addCandidate(m[1], `${source} (steam uri)`);
        }
    }

    addCandidate(game.steamAppId, 'steamAppId');
    addCandidate(game.steam_appid, 'steam_appid');
    addCandidate(game.appid, 'appid');

    addCandidate(game.allIds?.steam, 'allIds.steam');
    addCandidate(game.appId, 'appId');
    addCandidate(game.namespace, 'namespace');
    addCandidate(game.productId, 'productId');
    addCandidate(game.launcherGameId, 'launcherGameId');

    const idStr = String(game.id || '').trim();

    if (/^\d+$/.test(idStr)) {
        addCandidate(idStr, 'id (numeric)');
    }

    const steamIdMatch = idStr.match(/^steam-(\d+)$/i);
    if (steamIdMatch) {
        addCandidate(steamIdMatch[1], 'id (steam-<appid>)');
    }

    addCandidate(game.appName, 'appName');
    extractSteamUri(game.command, 'command');
    extractSteamUri(game.launchCommand, 'launchCommand');
    extractSteamUri(game.installUrl, 'installUrl');
    extractSteamUri(game.url, 'url');

    const seen = new Set();
    const uniqueCandidates = [];

    for (const c of candidates) {
        if (seen.has(c.appid)) continue;

        seen.add(c.appid);
        uniqueCandidates.push(c);
    }

    const best = uniqueCandidates[0] || null;

    return {
        appid: best?.appid || null,
        candidates: uniqueCandidates,
        reason: best ? `first: ${best.source}` : 'no numeric steam appid found'
    };
}
window._poSteamInstallCandidates = _poSteamInstallCandidates;

function _poExtractSteamId(game) {
    return _poSteamInstallCandidates(game).appid;
}
window._poExtractSteamId = _poExtractSteamId;

// ── URL Helpers ───────────────────────────────────────────────
function getSteamInstallUrl(game) {
    const strictId =
        (typeof window !== 'undefined' && window._baddelGetStrictSteamAppId)
            ? window._baddelGetStrictSteamAppId(game)
            : null;

    const { appid, candidates } = _poSteamInstallCandidates(game);
    const finalAppId = strictId || appid;

    if (typeof window !== 'undefined' && window.__debugInstallOpen) {
        console.log('[SteamInstall] candidates', {
            strictId,
            appid,
            finalAppId,
            candidates,
            game
        });
    }

    return finalAppId ? `steam://install/${finalAppId}` : null;
}

window.getSteamInstallUrl = getSteamInstallUrl;

function getSteamLaunchUrl(game) {
    const id = _poExtractSteamId(game);
    return id ? `steam://run/${id}` : null;
}
window.getSteamLaunchUrl = getSteamLaunchUrl;

function getEpicAppTuple(game) {
    if (!game) return null;
    // Explicit fields first
    if (game.namespace && game.catalogItemId && game.appName) {
        return `${encodeURIComponent(game.namespace)}%3A${encodeURIComponent(game.catalogItemId)}%3A${encodeURIComponent(game.appName)}`;
    }
    // launcherGameId or allIds.epic — may already be encoded or colon-separated
    const lgid = game.launcherGameId || (game.allIds && game.allIds.epic);
    if (lgid && typeof lgid === 'string') {
        if (lgid.includes('%3A')) return lgid;
        const parts = lgid.split(':');
        if (parts.length === 3) return parts.map(encodeURIComponent).join('%3A');
    }
    return null;
}
window.getEpicAppTuple = getEpicAppTuple;

function getEpicInstallUrl(game) {
    const tuple = getEpicAppTuple(game);
    return tuple ? `com.epicgames.launcher://apps/${tuple}?action=install&silent=true` : null;
}
window.getEpicInstallUrl = getEpicInstallUrl;

function getEpicLaunchUrl(game) {
    const tuple = getEpicAppTuple(game);
    return tuple ? `com.epicgames.launcher://apps/${tuple}?action=launch&silent=true` : null;
}
window.getEpicLaunchUrl = getEpicLaunchUrl;

// ── Find matching game in a synced library ─────────────────────
function _poFindLibraryGame(syncedLibrary, game, platform) {
    if (!syncedLibrary || !syncedLibrary.length || !game) return null;
    const gameNorm = _poNormTitle(game.name || '');

    if (platform === 'steam') {
        const steamId = _poExtractSteamId(game);
        if (steamId) {
            const byId = syncedLibrary.find(lg =>
                (lg.appName   && String(lg.appName)   === String(steamId)) ||
                (lg.namespace && String(lg.namespace) === String(steamId))
            );
            if (byId) return byId;
        }
    } else if (platform === 'epic') {
        // appName is the stable app-level identifier (e.g. "Fortnite") — match first
        if (game.appName) {
            const m = syncedLibrary.find(lg => lg.appName && lg.appName === game.appName);
            if (m) return m;
        }
        // launcherGameId may be "ns:catalogItemId:appName" tuple or a raw appName
        if (game.launcherGameId) {
            const lgid = String(game.launcherGameId);
            const sep  = lgid.includes('%3A') ? '%3A' : ':';
            const parts = lgid.split(sep).map(s => { try { return decodeURIComponent(s); } catch (e) { return s; } });
            if (parts.length === 3) {
                const appNamePart = parts[2];
                const m = syncedLibrary.find(lg =>
                    (lg.appName && lg.appName === appNamePart) ||
                    lg.launcherGameId === lgid
                );
                if (m) return m;
            } else {
                const m = syncedLibrary.find(lg =>
                    (lg.appName && lg.appName === lgid) ||
                    lg.launcherGameId === lgid
                );
                if (m) return m;
            }
        }
        // allIds.epic — treat as appName only; namespace (publisher UUID) must NOT be used alone
        if (game.allIds && game.allIds.epic) {
            const epicId = String(game.allIds.epic);
            const m = syncedLibrary.find(lg => lg.appName && lg.appName === epicId);
            if (m) return m;
        }
        // catalogItemId
        if (game.catalogItemId) {
            const m = syncedLibrary.find(lg => lg.catalogItemId === game.catalogItemId);
            if (m) return m;
        }
    }

    // Title fallback (any platform)
    return syncedLibrary.find(lg => {
        const t = _poNormTitle(lg.title || '');
        return t && gameNorm && (t === gameNorm || t.includes(gameNorm) || gameNorm.includes(t));
    }) || null;
}
window._poFindLibraryGame = _poFindLibraryGame;

// ── Ownership checkers ─────────────────────────────────────────
// Steam: steamLicensedAccountIds → ownedByAccountIds. NEVER steamDetectedAccountIds.
function _poSteamOwnsGame(libGame, accountId) {
    if (!libGame || !accountId) return false;
    const id = String(accountId);
    const lic = libGame.steamLicensedAccountIds;
    if (Array.isArray(lic) && lic.length > 0) return lic.map(String).includes(id);
    const own = libGame.ownedByAccountIds;
    if (Array.isArray(own) && own.length > 0) return own.map(String).includes(id);
    return false;
}
window._poSteamOwnsGame = _poSteamOwnsGame;

// Epic: ownedByAccountIds only.
function _poEpicOwnsGame(libGame, accountId) {
    if (!libGame || !accountId) return false;
    const own = libGame.ownedByAccountIds;
    return Array.isArray(own) && own.map(String).includes(String(accountId));
}
window._poEpicOwnsGame = _poEpicOwnsGame;

// ── Normalize a single switcher profile to canonical shape ─────
function _poNormalizeProfile(platform, raw) {
    if (!raw) return null;
    if (platform === 'steam') {
        const a = typeof raw === 'object' ? raw : { username: String(raw) };
        return {
            id:                a.steamId  || a.SteamID || a.id || a.username,
            displayName:       a.displayName || a.PersonaName || a.username || 'Unknown',
            username:          a.username || a.AccountName || null,
            avatar:            a.avatar || a.avatarUrl || a.Avatar || null,
            platformAccountId: a.platformAccountId || a.steamId || null,
            _resolvedSyncId:   a._resolvedSyncId || a.steamId || null,
        };
    }
    if (typeof raw === 'string') {
        return { id: raw, displayName: raw, username: raw, avatar: null, platformAccountId: null, _resolvedSyncId: null };
    }
    return {
        id:                raw.id || raw.accountId || raw.name,
        displayName:       raw.displayName || raw.discordUsername || raw.name || 'Account',
        username:          raw.username || raw.name || null,
        avatar:            raw.avatar || raw.avatarUrl || raw.picture || null,
        platformAccountId: raw.platformAccountId || raw.id || null,
        _resolvedSyncId:   raw._resolvedSyncId || null,
    };
}
window._poNormalizeProfile = _poNormalizeProfile;

// ── Account identity helpers ───────────────────────────────────
// Returns a Set of every normalized alias an account object can be known by.
// addId includes any non-empty value; addName requires length >= 3 to avoid
// matching on noise like "ab" while still matching numeric Steam IDs.
function _poAccountAliases(platform, account) {
    if (!account) return new Set();
    const out = new Set();
    const addId   = v => { const s = String(v ?? '').trim().toLowerCase(); if (s) out.add(s); };
    const addName = v => { const s = String(v ?? '').trim().toLowerCase(); if (s.length >= 3) out.add(s); };
    if (platform === 'steam') {
        addId(account.steamId);           addId(account.SteamID);
        addId(account.id);                addId(account.accountId);
        addId(account.platformAccountId); addId(account._resolvedSyncId);
        addName(account.username);        addName(account.AccountName);
        addName(account.displayName);     addName(account.PersonaName);
    } else {
        addId(account.id);                addId(account.accountId);
        addId(account.platformAccountId); addId(account._resolvedSyncId);
        addName(account.username);
        addName(account.displayName);     addName(account.name);
    }
    return out;
}
window._poAccountAliases = _poAccountAliases;

// Returns true if two account objects refer to the same logical account.
function _poSameAccount(platform, a, b) {
    const aa = _poAccountAliases(platform, a);
    const ab = _poAccountAliases(platform, b);
    for (const x of aa) if (ab.has(x)) return true;
    return false;
}
window._poSameAccount = _poSameAccount;

// Returns the strongest stable single key for an account (for maps/sets).
function _poAccountKey(platform, account) {
    if (!account) return null;
    const id = platform === 'steam'
        ? (account.steamId || account.SteamID || account.id || account.accountId ||
           account.platformAccountId || account._resolvedSyncId)
        : (account.id || account.accountId || account.platformAccountId || account._resolvedSyncId);
    return id ? String(id).trim().toLowerCase() : null;
}
window._poAccountKey = _poAccountKey;

// ── Pure core resolver (sync, unit-testable) ───────────────────
// Returns array of account option objects sorted by actionStatus priority.
// mode='play'    — all switcher accounts, including sync_to_verify and add_to_switcher
// mode='details' — only synced accounts with a definitive ready/does_not_own verdict
function _buildAccountOptionsFromData({ game, platform, mode = 'play', switcherProfiles, syncAccounts, syncedLibrary }) {
    const libGame    = _poFindLibraryGame(syncedLibrary, game, platform);
    const hasLibData = syncedLibrary.length > 0;
    const ownsGame   = platform === 'steam' ? _poSteamOwnsGame : _poEpicOwnsGame;

    // ── Switcher accounts ──
    const rows = switcherProfiles.map(profile => {
        const syncAccount = syncAccounts.find(sa => _poSameAccount(platform, profile, sa));

        // Enrich display info from sync account
        let enriched = { ...profile };
        if (syncAccount) {
            if (syncAccount.displayName && syncAccount.displayName !== String(syncAccount.id))
                enriched.displayName = syncAccount.displayName;
            if (syncAccount.avatar && !enriched.avatar)
                enriched.avatar = syncAccount.avatar;
        }

        const isSynced = !!syncAccount;
        let actionStatus, ownershipStatus;

        if (!isSynced) {
            // Switcher profile not in syncAccounts — user hasn't synced this account yet
            actionStatus    = 'sync_to_verify';
            ownershipStatus = 'unknown';
        } else if (!hasLibData || !libGame) {
            // Synced account but library data unavailable for this game — unknown, not sync_to_verify
            actionStatus    = 'sync_unknown';
            ownershipStatus = 'unknown';
        } else if (ownsGame(libGame, syncAccount.id)) {
            actionStatus    = 'ready';
            ownershipStatus = 'owned';
        } else {
            actionStatus    = 'does_not_own';
            ownershipStatus = 'not-owned';
        }

        return {
            ...enriched,
            isSynced,
            ownershipStatus,
            actionStatus,
            enabled: actionStatus === 'ready' || actionStatus === 'sync_to_verify',
            inSwitcher:    true,
            notInSwitcher: false,
            syncAccountId: syncAccount ? syncAccount.id : null,
        };
    });

    // ── Ghost accounts (synced owners not in switcher) ──
    if (hasLibData && libGame) {
        for (const sa of syncAccounts) {
            if (switcherProfiles.some(p => _poSameAccount(platform, p, sa))) continue;
            if (!ownsGame(libGame, sa.id)) continue;

            rows.push({
                id:              `ghost-${sa.id}`,
                displayName:     sa.displayName || String(sa.id),
                username:        sa.displayName || String(sa.id),
                avatar:          sa.avatar || null,
                isSynced:        true,
                ownershipStatus: 'owned',
                actionStatus:    'add_to_switcher',
                enabled:         false,
                inSwitcher:      false,
                notInSwitcher:   true,
                syncAccountId:   sa.id,
            });
        }
    }

    // Sort: ready → sync_to_verify → sync_unknown → does_not_own → add_to_switcher
    const ORDER = { ready: 0, sync_to_verify: 1, sync_unknown: 2, does_not_own: 3, add_to_switcher: 4 };
    rows.sort((a, b) => (ORDER[a.actionStatus] ?? 9) - (ORDER[b.actionStatus] ?? 9));

    if (mode === 'details') {
        // Enumerate syncAccounts as the authoritative source — switcher presence is irrelevant.
        // Returns nothing if we have no library data (can't give a definitive verdict).
        if (!hasLibData) return [];
        return syncAccounts.map(sa => {
            // Prefer enriched display info from any already-computed switcher row
            const sw = rows.find(r => r.isSynced && r.inSwitcher && String(r.syncAccountId) === String(sa.id));
            const owned = ownsGame(libGame, sa.id);
            return {
                id:              String(sa.id),
                displayName:     (sw && sw.displayName) || sa.displayName || String(sa.id),
                username:        (sw && sw.username)    || sa.displayName || String(sa.id),
                avatar:          (sw && sw.avatar)      || sa.avatar      || null,
                isSynced:        true,
                ownershipStatus: owned ? 'owned' : 'not-owned',
                actionStatus:    owned ? 'ready' : 'does_not_own',
                enabled:         owned,
                inSwitcher:      !!sw,
                notInSwitcher:   !sw,
                syncAccountId:   sa.id,
            };
        });
    }
    return rows;
}
window._buildAccountOptionsFromData = _buildAccountOptionsFromData;

// ── Fetch switcher profiles for a given platform ───────────────
async function _poFetchSwitcherProfiles(platform) {
    if (platform === 'steam') {
        const accounts = await window.electronAPI.getSteamAccounts?.() || [];
        if (window.electronAPI.getSteamImage) {
            await Promise.all(accounts.map(async acc => {
                try { acc.avatar = await window.electronAPI.getSteamImage(acc.steamId || acc.id); } catch (e) {}
            }));
        }
        return accounts;
    }
    const fetchMap = {
        epic:     () => window.electronAPI.getEpicProfiles?.(),
        ea:       () => window.electronAPI.getEAProfiles?.(),
        riot:     () => window.electronAPI.getRiotProfiles?.(),
        ubisoft:  () => window.electronAPI.getUbisoftProfiles?.(),
        discord:  () => window.electronAPI.getDiscordProfiles?.(),
        rockstar: () => window.electronAPI.getRockstarProfiles?.(),
    };
    return (await fetchMap[platform]?.()) || [];
}

// ── Last-good sync snapshot ────────────────────────────────────
// Prevents a transient empty platformSyncGetAccounts/Cached response from
// degrading previously-known ready/does_not_own rows to sync_to_verify.
const _poLastGoodSyncSnapshot = new Map();

// ── Async wrapper — fetches data then calls pure core ──────────
async function buildPlatformAccountOptions({ game, platform, mode = 'play' }) {
    const hasSyncSupport = platform === 'steam' || platform === 'epic';

    const [switcherRaw, accRes, libRes] = await Promise.all([
        _poFetchSwitcherProfiles(platform).catch(() => []),
        hasSyncSupport
            ? (window.electronAPI.platformSyncGetAccounts?.(platform) || Promise.resolve({ accounts: [] }))
            : Promise.resolve({ accounts: [] }),
        hasSyncSupport
            ? (window.electronAPI.platformSyncGetCached?.(platform) || Promise.resolve({ games: [] }))
            : Promise.resolve({ games: [] }),
    ]);

    const switcherProfiles = (Array.isArray(switcherRaw) ? switcherRaw : [])
        .map(p => _poNormalizeProfile(platform, p))
        .filter(Boolean);

    const freshAccounts = Array.isArray(accRes?.accounts) ? accRes.accounts : [];
    const freshGames    = Array.isArray(libRes?.games)     ? libRes.games    : [];
    const isFreshUsable = freshAccounts.length > 0 && freshGames.length > 0;

    let syncAccounts, syncedLibrary, usedLastGood;

    if (isFreshUsable) {
        _poLastGoodSyncSnapshot.set(platform, {
            accounts:  freshAccounts,
            games:     freshGames,
            updatedAt: Date.now(),
            source:    'fresh',
        });
        syncAccounts  = freshAccounts;
        syncedLibrary = freshGames;
        usedLastGood  = false;
    } else {
        const snap = _poLastGoodSyncSnapshot.get(platform);
        if (snap) {
            console.warn('[PO][SyncSnapshot] Using last-good sync data for', platform, {
                freshAccounts: freshAccounts.length,
                freshGames:    freshGames.length,
            });
            syncAccounts  = snap.accounts;
            syncedLibrary = snap.games;
            usedLastGood  = true;
        } else {
            syncAccounts  = freshAccounts;
            syncedLibrary = freshGames;
            usedLastGood  = false;
        }
    }

    const result = _buildAccountOptionsFromData({ game, platform, mode, switcherProfiles, syncAccounts, syncedLibrary });

    if (typeof window !== 'undefined') {
        window._poLastBuildDebug = {
            platform,
            mode,
            switcherCount:      switcherProfiles.length,
            freshAccountsCount: freshAccounts.length,
            freshGamesCount:    freshGames.length,
            usedAccountsCount:  syncAccounts.length,
            usedGamesCount:     syncedLibrary.length,
            usedLastGood,
            optionStatuses:     result.map(o => o.actionStatus),
        };
    }

    return result;
}
window.buildPlatformAccountOptions = buildPlatformAccountOptions;

// ── Shared account row renderer ────────────────────────────────
// cfg: { idPrefix, makeOnClick(id, platKey), closeModalJs, platKey, platName, platAccent }
function _poRenderAccountRow(option, cfg) {
    const { idPrefix, makeOnClick, closeModalJs, platKey, platName, platAccent } = cfg;
    const initials = (option.displayName || '??').substring(0, 2).toUpperCase();
    const accent   = platAccent || '#fff';
    const rowId    = `${idPrefix}${option.id}`;

    // Ghost / add-to-switcher: disabled row with hover tooltip
    if (option.actionStatus === 'add_to_switcher') {
        const avatarHtml = option.avatar
            ? `<img src="${option.avatar}" alt="${option.displayName}">`
            : `<span>${initials}</span>`;
        return `
        <div class="pl-ghost-wrapper">
            <div class="pl-account-row pl-account-row-ghost" id="${rowId}">
                <div class="pl-account-avatar" style="background:${accent}22;border-color:${accent}44">
                    ${avatarHtml}
                </div>
                <div class="pl-account-info">
                    <div class="pl-account-name">${option.displayName}</div>
                    <div class="pl-account-sub" style="color:rgba(255,255,255,0.3);">Not in Switcher</div>
                </div>
                <div class="pl-owned-badge pl-badge-owned" style="opacity:0.8;">&#10003; Owned Game</div>
            </div>
            <div class="pl-ghost-tooltip">
                <div class="pl-ghost-tooltip-title">Account not in Switcher</div>
                <div class="pl-ghost-tooltip-body">This account owns the game but hasn&rsquo;t been added to your ${platName} Switcher yet.</div>
                <button class="pl-ghost-go-btn" onclick="${closeModalJs}; selectAccountPlatform('${platKey}');">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
                    Add to ${platName} Switcher
                </button>
            </div>
        </div>`;
    }

    let badge = '';
    if (option.syncNotSupported || option.actionStatus === 'switcher_ready') {
        badge = '';
    } else if (option.actionStatus === 'ready') {
        badge = `<div class="pl-owned-badge pl-badge-owned">&#10003; Owned</div>`;
    } else if (option.actionStatus === 'does_not_own') {
        badge = `<div class="pl-owned-badge pl-badge-not-owned">&#10007; Not Owned</div>`;
    } else if (option.actionStatus === 'sync_to_verify') {
        badge = `<div class="pl-owned-badge pl-badge-unknown" title="Sync this account in the Accounts tab to verify ownership">&#8212; Sync to verify</div>`;
    }

    const subtitle   = option.username && option.username !== option.displayName
        ? option.username
        : (platName || platKey);
    const isDisabled = option.enabled === false;
    const clickAttr  = isDisabled
        ? `aria-disabled="true" title="This synced account does not own this game"`
        : `onclick="${makeOnClick(option.id, option.platformType || platKey)}"`;

    return `
        <div class="pl-account-row${isDisabled ? ' po-row-disabled' : ''}" id="${rowId}"
             ${clickAttr}
             data-id="${option.id}"
             data-name="${option.displayName}"
             data-username="${option.username || option.id}"
             data-action-status="${option.actionStatus}">
            <div class="pl-account-avatar" style="background:${accent}22;border-color:${accent}44">
                ${option.avatar ? `<img src="${option.avatar}" alt="${option.displayName}">` : `<span>${initials}</span>`}
            </div>
            <div class="pl-account-info">
                <div class="pl-account-name">${option.displayName}</div>
                <div class="pl-account-sub">${subtitle}</div>
            </div>
            ${badge}
            <div class="pl-account-check"></div>
        </div>`;
}
window._poRenderAccountRow = _poRenderAccountRow;
