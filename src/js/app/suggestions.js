// ── Synced Library Suggestions ──────────────────────────────────────────────
// All state, scoring, rendering, and event handlers for the synced-library
// suggestions section (Recommended / Steam / Epic filter, featured cinematic
// hero panel, game-selector rail, screenshot carousel, art hydration).
//
// Loads before app.js. Reads globals from artwork-sync.js (isUsableImageUrl,
// setHeroBgStable, setCardImageStable) and accounts.js (_agIsInstalled,
// _agBuildInstalledMap). All outbound calls resolve at call time through the
// classic-script Global Declarative Environment.

// ============================================================
// SYNCED LIBRARY SUGGESTIONS
// ============================================================

const _SUGG_PLATFORMS = ['steam', 'epic'];
let _suggAllGames = [];
window._suggAllGames = _suggAllGames; // expose for roulette install pool
let _suggFilter   = 'all';

// ── Featured rail state (v2: pool of 5+5 per bucket, 6h rotation) ────────────
const _SUGG_STATE_KEY     = 'baddel_sugg_state_v4'; // bucketed 5-item visible views
const _SUGG_POOL_TTL      = 6 * 60 * 60 * 1000;     // 6 hours
const _SUGG_ROTATE_MS     = 15 * 1000;               // 15 s auto-rotation
const _SUGG_POOL_PER_PLAT = 5;                        // items per platform in 'all' filter
const _SUGG_POOL_SINGLE   = 5;                        // items for single-platform filter

let _suggPool        = [];   // Visible ready-to-install games (up to 5)
let _suggPoolIdx     = 0;
let _suggRotateTimer = null;
let _suggPoolTs      = 0;
let _suggState       = {
    bucket: null,
    recommendedItems: [],
    steamItems: [],
    epicItems: [],
    activeFilter: 'all',
};
const hydratedGameIds  = new Set();
const hydratingGameIds = new Set();
// failedImageIds, suggestion art cache, window.__baddelApplyGameCustomOverride,
// and RTIA hydrator moved to src/js/app/artwork-sync.js
const _SUGG_HYDRATE_CONCURRENCY = 6;
let _suggHydrateActive = 0;

// ── Deterministic seeded Fisher-Yates shuffle ─────────────────────────────────
// Uses a reproducible xorshift32 PRNG seeded from a string, so the same seed
// always produces the same shuffle order.
function _seededShuffle(arr, seed) {
    const out = [...arr];
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = Math.imul(31, h) + seed.charCodeAt(i) | 0;
    let s = (h >>> 0) || 1;
    const rng = () => { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return (s >>> 0) / 0x100000000; };
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

const _SUGG_PLAT_CFG = {
    steam:   { name: 'Steam',      img: '../assets/Steam.png',    invert: false },
    epic:    { name: 'Epic Games', img: '../assets/epic.svg',     invert: true  },
    ea:      { name: 'EA App',     img: '../assets/ea.png',       invert: false },
    riot:    { name: 'Riot',       img: '../assets/riot.png',     invert: false },
    ubisoft: { name: 'Ubisoft',    img: '../assets/Ubisoft.png',  invert: true  },
    discord: { name: 'Discord',    img: '../assets/discord.webp', invert: false },
};

// ── Title normalizers ─────────────────────────────────────────────────────────
function _suggNorm(s) {
    return (s || '').toLowerCase()
        .replace(/[®©™]/g, '')
        .replace(/[:\-'']/g, ' ')
        .replace(/\s+/g, ' ').trim();
}
function _suggNormStrict(s) {
    return (s || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

// ── Installed-map probe (reuses accounts.js map, adds Steam prefix variants) ─
function _suggIsInstalled(syncedGame) {
    if (typeof _agIsInstalled === 'function') {
        if (_agIsInstalled(syncedGame)) return true;
        // Local Steam entries can be stored as steam-XXXX or steam_XXXX while
        // synced entries carry only the bare numeric appid — probe both prefixes.
        if (syncedGame._platform === 'steam' && syncedGame.id) {
            const numId = String(syncedGame.id).replace(/^steam[-_]/i, '');
            const map   = (typeof _agBuildInstalledMap === 'function') ? _agBuildInstalledMap() : null;
            if (map) {
                if (map.get(`steam-${numId}`) === true) return true;
                if (map.get(`steam_${numId}`) === true) return true;
            }
        }
        return false;
    }
    // Fallback when accounts.js not yet loaded: walk allGamesData directly
    const local      = Array.isArray(window.allGamesData) ? window.allGamesData : [];
    const rawId      = syncedGame.id ? String(syncedGame.id) : '';
    const numId      = rawId.replace(/^steam[-_]|^epic[-_]/i, '');
    const appName    = syncedGame.appName   ? String(syncedGame.appName)   : '';
    const namespace  = syncedGame.namespace ? String(syncedGame.namespace) : '';
    const strict     = _suggNormStrict(syncedGame.title || '');
    const platform   = syncedGame._platform || '';
    for (const g of local) {
        if (!(g.path || g.command)) continue;
        const lid = String(g.id || '');
        const cmd = String(g.command || '').toLowerCase();
        const plt = String(g.platform || '').toLowerCase();
        if (platform === 'steam') {
            if (numId && (lid === numId || lid === `steam-${numId}` || lid === `steam_${numId}`)) return true;
            if (numId && cmd.includes(`steam://rungameid/${numId}`)) return true;
            if (numId && g.allIds?.steam && String(g.allIds.steam) === numId) return true;
        }
        if (platform === 'epic') {
            if (appName && lid === `epic_${appName}`) return true;
            if (rawId   && lid === rawId)             return true;
            if (appName && cmd.includes(appName.toLowerCase())) return true;
            if (namespace && cmd.includes(namespace))           return true;
        }
        const sameFam = plt.includes(platform) ||
            (platform === 'epic'  && cmd.includes('com.epicgames')) ||
            (platform === 'steam' && (cmd.includes('steam://') || plt.includes('steam')));
        if (sameFam && strict && _suggNormStrict(g.name || '') === strict) return true;
    }
    return false;
}

// ── Platform family ────────────────────────────────────────────────────────────
function _agPlatFamily(p) {
    p = (p || '').toLowerCase();
    if (p.includes('steam'))                        return 'steam';
    if (p.includes('epic'))                         return 'epic';
    if (p.includes('riot'))                         return 'riot';
    if (p.includes('ea') || p.includes('origin'))   return 'ea';
    if (p.includes('ubisoft'))                      return 'ubisoft';
    if (p.includes('xbox') || p.includes('store'))  return 'xbox';
    if (p.includes('manual'))                       return 'manual';
    return p || 'unknown';
}

// ── Riot product from command/path string ──────────────────────────────────────
// Returns 'valorant', 'league_of_legends', or null.
// RiotClientServices.exe alone (no launch-product) → null.
function _agRiotProductFromStr(str) {
    const s = (str || '').toLowerCase();
    if (s.includes('launch-product=valorant') ||
        s.includes('valorant-win64-shipping') ||
        (s.includes('riotclientservices') && s.includes('valorant'))) return 'valorant';
    if (s.includes('launch-product=league_of_legends') ||
        s.includes('leagueclient.exe') ||
        (s.includes('riotclientservices') && s.includes('league_of_legends'))) return 'league_of_legends';
    return null;
}

// ── Stable aliases for a Riot product key ─────────────────────────────────────
function _agRiotAliases(key) {
    if (key === 'valorant')
        return new Set(['riot:valorant', 'valorant', 'val']);
    if (key === 'league_of_legends')
        return new Set(['riot:league_of_legends', 'riot:league', 'league_of_legends',
                        'leagueoflegends', 'league of legends', 'lol']);
    return new Set();
}

// ── Derive Riot product key from a game title (for synced / non-local items) ──
function _agTitleToRiotProduct(title) {
    const t = (title || '').toLowerCase().replace(/[®©™]/g, '').replace(/\s+/g, ' ').trim();
    if (t === 'valorant') return 'valorant';
    if (t === 'league of legends' || t === 'league of legends live') return 'league_of_legends';
    return null;
}

// ── Main-game guard: not a DLC / demo / tool / server / beta / soundtrack ─────
function _agIsMainGame(game) {
    const n = (game.name || game.title || '').toLowerCase();
    return !/\b(demo|dlc|pbe|public beta|open beta|editor|sdk|wallpaper|benchmark|soundtrack|ost|artbook|season pass|bonus|starter pack|trial|lite)\b|dedicated server|test server/.test(n);
}

// ── Normalize title for comparison ─────────────────────────────────────────────
function _agNormTitle(s) {
    return (s || '').toLowerCase()
        .replace(/[®©™]/g, '')
        .replace(/[:\-'']/g, ' ')
        .replace(/\s+/g, ' ').trim();
}

// ── Same-platform guard for platform-specific ID steps ─────────────────────────
function _agCanMerge(baseGame, candidate) {
    if (String(candidate.id) === String(baseGame.id)) return true;
    return _agPlatFamily(baseGame.platform) === _agPlatFamily(candidate.platform);
}

// ── Core matching loop — shared by single-match and multi-match APIs ──────────
function _agCollectMatches(game, local, dbg) {
    const epicAppName   = game.appName        || null;
    const epicLgid      = game.launcherGameId  || null;
    const epicNs        = game.namespace       || null;
    const epicCatId     = game.catalogItemId   || null;
    const epicTuple     = (epicNs && epicCatId && epicAppName)
        ? `${epicNs}:${epicCatId}:${epicAppName}` : null;
    const steamId       = game.allIds?.steam ? String(game.allIds.steam) : null;
    const steamFromSelf = (game.command || String(game.id || '')).match(/(\d{5,})/)?.[1] || null;

    const inRiotKey =
        _agRiotProductFromStr(game.command || '') ||
        _agRiotProductFromStr(game.launchCommand || '') ||
        _agRiotProductFromStr(game.path || '') ||
        _agTitleToRiotProduct(game.name || game.title || '') ||
        (game.allIds?.riot ? String(game.allIds.riot) : null);
    const inRiotSet = _agRiotAliases(inRiotKey);
    const selfNorm  = _agNormTitle(game.name || game.title || '');

    if (dbg) console.log('  probes:', {
        epicAppName, epicLgid, epicTuple, steamId, steamFromSelf,
        inRiotKey, inRiotAliases: [...inRiotSet], selfNorm,
    });

    const results = [];
    const seenIds = new Set();

    for (const g of local) {
        if (!g.path && !g.command) continue;

        const candRiotKey =
            _agRiotProductFromStr(g.command || '') ||
            _agRiotProductFromStr(g.path || '') ||
            _agRiotProductFromStr(g.executablePath || '') ||
            _agRiotProductFromStr(g.launchCommand || '');
        const candRiotSet = _agRiotAliases(candRiotKey);
        const gNorm       = _agNormTitle(g.name || '');

        let why = null;

        // P1: Exact ID / installedId
        if (String(g.id) === String(game.id))
            why = 'exact-id';
        else if (game.installedId && String(g.id) === String(game.installedId))
            why = 'installedId';

        // P2: Platform-specific stable IDs (same platform family required)
        else if (epicAppName && g.appName === epicAppName && _agCanMerge(game, g))
            why = 'epic-appName';
        else if (epicAppName && g.id === `epic-${epicAppName}` && _agCanMerge(game, g))
            why = 'epic-synthetic-id';
        else if (epicLgid && (g.launcherGameId === epicLgid || g.id === epicLgid) && _agCanMerge(game, g))
            why = 'epic-lgid';
        else if (epicTuple && g.launcherGameId && (
            g.launcherGameId === epicTuple ||
            g.launcherGameId === epicTuple.replace(/:/g, '%3A')
        ) && _agCanMerge(game, g))
            why = 'epic-tuple';
        else if (steamId) {
            const gSteamId = g.allIds?.steam ? String(g.allIds.steam) : null;
            const gFromCmd = (g.command || String(g.id || '')).match(/(\d{5,})/)?.[1] || null;
            if (((gSteamId && gSteamId === steamId) || (gFromCmd && gFromCmd === steamId)) && _agCanMerge(game, g))
                why = 'steam-appid';
        }
        if (!why && steamFromSelf && steamFromSelf !== steamId) {
            const gFromCmd = (g.command || String(g.id || '')).match(/(\d{5,})/)?.[1] || null;
            if (gFromCmd && gFromCmd === steamFromSelf && _agCanMerge(game, g))
                why = 'steam-self';
        }

        // P3: Riot product alias intersection (cross-platform OK)
        if (!why && inRiotSet.size > 0 && candRiotSet.size > 0) {
            for (const a of inRiotSet) {
                if (candRiotSet.has(a)) { why = `riot-alias:${a}`; break; }
            }
        }

        // P4: Exact normalized main-game title (cross-platform for main releases)
        if (!why && gNorm && selfNorm && gNorm === selfNorm &&
            _agIsMainGame(game) && _agIsMainGame(g))
            why = 'title-main-game';

        if (dbg) {
            const interesting = why || _agPlatFamily(g.platform) === 'riot' || gNorm === selfNorm;
            if (interesting) console.log(why ? `  ✔ (${why})` : '  ✘ no-match', {
                id: g.id, name: g.name, platform: g.platform,
                scannerPlatform: g.scannerPlatform, hasCmd: !!(g.path || g.command),
                candRiotKey, gNorm,
            });
        }

        if (why && !seenIds.has(g.id)) {
            seenIds.add(g.id);
            results.push(g);
        }
    }
    return results;
}

// ── All matching installed records — used by multi-launcher Play modal ─────────
window._agFindInstalledLocalMatches = function(game) {
    const local = Array.isArray(window.allGamesData) ? window.allGamesData : [];
    const dbg   = window.__debugAgInstalledMatch === true;
    if (dbg) {
        console.group('[_agFindInstalledLocalMatches]', game.name || game.title || game.id);
        console.log('  incoming:', {
            id: game.id, name: game.name, title: game.title,
            platform: game.platform, platforms: game.platforms,
            allIds: game.allIds, appName: game.appName,
            launcherGameId: game.launcherGameId,
        });
        console.log('  local candidates:', local.filter(g => g.path || g.command).length);
    }
    const results = _agCollectMatches(game, local, dbg);
    if (dbg) { console.log('  matches:', results.length, results.map(r => r.id)); console.groupEnd(); }
    return results;
};

// ── Single-match backward-compatible API — returns first match or null ─────────
window._agFindInstalledLocalMatch = function(game) {
    return window._agFindInstalledLocalMatches(game)[0] ?? null;
};

// ── Debug helper: find a game by title and inspect all its installed matches ───
// Usage: window.__debugAgInstalledMatch = true; window._debugFindInstalledMatchByTitle('valorant')
window._debugFindInstalledMatchByTitle = function(title) {
    window.__debugAgInstalledMatch = true;
    const pool = window._allGamesCache || window.allGamesData || [];
    const game = pool.find(x =>
        String(x.title || x.name || '').toLowerCase().includes(String(title).toLowerCase())
    );
    const matches = game ? window._agFindInstalledLocalMatches(game) : [];
    window.__debugAgInstalledMatch = false;
    return { game, matches, match: matches[0] ?? null };
};

// ── Owned check ───────────────────────────────────────────────────────────────
function _suggOwned(platform, g, accountIds) {
    const owned = platform === 'steam'
        ? (g.steamLicensedAccountIds?.length ? g.steamLicensedAccountIds : g.ownedByAccountIds)
        : g.ownedByAccountIds;
    if (!Array.isArray(owned) || !owned.length) return false;
    return accountIds.some(aid => owned.map(String).includes(String(aid)));
}

// ── Metadata richness score ───────────────────────────────────────────────────
function _suggScore(g) {
    let s = 0;
    if (getPosterUrl(g))           s += 3;
    if (g.heroImage)               s += 1;
    if (g.description)             s += 1;
    if (g._platform === 'steam')   s += 1;
    return s;
}

// isUsableImageUrl, _preferLocalImage, getPosterUrl, getPosterUrlInstalled,
// _cardImageApply, setCardImageStable, _heroBgApply, setHeroBgStable
// moved to src/js/app/artwork-sync.js

function _suggKey(g) {
    return `${g?._platform || 'unknown'}:${String(g?.id || '')}`;
}

// ── Stale-cache detection via platformSyncGetState ────────────────────────────
// Returns true when the last sync for this platform ended in a failed/error
// state: phase==='error', validation.ok===false, or any account status==='error'.
// In that case the cached games are preserved-from-previous-run data and must
// NOT be presented as a reliable "ready to install" source.
async function _suggIsCacheStale(platform) {
    try {
        const res = await window.electronAPI.platformSyncGetState(platform);
        const state = res?.state;
        if (!state) return false;                          // no state yet → not stale
        if (state.isSyncing) return false;                 // sync in progress → not stale (live)
        if (state.phase === 'idle') return false;          // never synced → handled separately
        if (state.phase === 'error') return true;
        if (state.validation && state.validation.ok === false) return true;
        // Any individual account in error state taints the whole platform cache
        const accts = state.accounts || {};
        if (Object.values(accts).some(a => a.status === 'error')) return true;
        return false;
    } catch {
        return false; // IPC failure → assume not stale, be conservative
    }
}

// ── Build the suggestions list ────────────────────────────────────────────────
// Returns a debug summary object (logged to console).
async function _buildSyncedSuggestions() {
    _suggAllGames = [];

    const debugSummary = {};

    // Step 1: collect per-platform, dedup by platform:id, check stale cache
    const seenPlatformId = new Set();
    const candidates = [];

    for (const platform of _SUGG_PLATFORMS) {
        let cachedRes, accountsRes, stale;
        try {
            [cachedRes, accountsRes, stale] = await Promise.all([
                window.electronAPI.platformSyncGetCached(platform),
                window.electronAPI.platformSyncGetAccounts(platform),
                _suggIsCacheStale(platform),
            ]);
        } catch { continue; }

        const games    = Array.isArray(cachedRes)
            ? cachedRes
            : Array.isArray(cachedRes?.games) ? cachedRes.games : [];
        const accounts = Array.isArray(accountsRes?.accounts) ? accountsRes.accounts : [];

        const dbg = { total: games.length, accounts: accounts.length, stale,
                      owned: 0, installedExcluded: 0, passed: 0 };

        if (!accounts.length || !games.length) {
            debugSummary[platform] = dbg;
            continue;
        }

        const accountIds = accounts.map(a => String(a.id));

        for (const g of games) {
            if (!g?.id) continue;
            const key = `${platform}:${g.id}`;
            if (seenPlatformId.has(key)) continue;
            seenPlatformId.add(key);

            const tagged = { ...g, _platform: platform, _cacheStale: stale };

            if (!_suggOwned(platform, tagged, accountIds)) continue;
            dbg.owned++;

            if (_suggIsInstalled(tagged)) { dbg.installedExcluded++; continue; }

            dbg.passed++;
            candidates.push({ ...tagged, _accounts: accounts });
        }

        debugSummary[platform] = dbg;
    }

    // Step 2: cross-platform title dedup — keep the richer entry per strict title.
    // Same game owned on Steam and Epic → show once (whichever has richer metadata).
    const titleMap = new Map();
    const noTitleCandidates = [];

    for (const g of candidates) {
        const key = _suggNormStrict(g.title || '');
        if (!key) { noTitleCandidates.push(g); continue; }
        if (!titleMap.has(key)) {
            titleMap.set(key, g);
        } else {
            const existing = titleMap.get(key);
            // Prefer non-stale; then richer score; then keep existing on tie.
            const gBetter = (!g._cacheStale && existing._cacheStale) ||
                            (_suggScore(g) > _suggScore(existing));
            if (gBetter) titleMap.set(key, g);
        }
    }

    _suggAllGames = [...titleMap.values(), ...noTitleCandidates];

    // Rank: stale entries last, then richest metadata, then alphabetical
    _suggAllGames.sort((a, b) => {
        if (a._cacheStale !== b._cacheStale) return a._cacheStale ? 1 : -1;
        const d = _suggScore(b) - _suggScore(a);
        return d !== 0 ? d : (a.title || '').localeCompare(b.title || '');
    });

    // ── Debug console summary ─────────────────────────────────────────────────
    const freshCount = _suggAllGames.filter(g => !g._cacheStale).length;
    const staleCount = _suggAllGames.filter(g =>  g._cacheStale).length;
    console.group('[SyncedSugg] Build summary');
    for (const [plt, d] of Object.entries(debugSummary)) {
        console.log(
            `  ${plt}: total=${d.total} accounts=${d.accounts} stale=${d.stale}` +
            ` | owned=${d.owned} installed-excluded=${d.installedExcluded} passed=${d.passed}`
        );
    }
    console.log(`  deduped-final: ${_suggAllGames.length} (fresh=${freshCount} stale-cache=${staleCount})`);
    console.groupEnd();
    window._suggAllGames = _suggAllGames; // keep roulette install pool in sync
    window.__platformLibraryReady = true;
    try { updateSmartSidebarCounts(); } catch (_) {}
}

// ── Shape for the install picker ──────────────────────────────────────────────
function _suggBuildGame(g) {
    return {
        id:            g.id,
        name:          g.title         || 'Unknown',
        image:         g.image         || g.capsuleImage || '',
        heroImage:     g.heroImage      || g.image        || '',
        platform:      g._platform,
        platforms:     [g._platform],
        appName:       g.appName        || '',
        namespace:     g.namespace      || '',
        catalogItemId: g.catalogItemId  || '',
        allIds:        g.allIds         || { [g._platform]: g.id },
    };
}

// ── Platform badge chip ───────────────────────────────────────────────────────
function _suggBadge(platform) {
    const cfg = typeof PLATFORM_LOGOS !== 'undefined' ? PLATFORM_LOGOS[platform] : null;
    if (!cfg) return '';
    return `<span class="sugg-plat-badge" style="background:${cfg.color};">` +
           `<img src="${cfg.img}" ${cfg.invert ? 'class="shortcut-invert"' : ''} ` +
           `style="height:11px;width:auto;object-fit:contain;"></span>`;
}

// ── Stale badge chip ──────────────────────────────────────────────────────────
function _suggStaleBadge() {
    return `<span class="sugg-stale-badge"
        title="This data is from a previous sync that encountered errors. It may not reflect your current library."
        style="font-size:0.64rem;color:#f59e0b;background:rgba(245,158,11,0.12);
               border:1px solid rgba(245,158,11,0.3);border-radius:4px;
               padding:1px 5px;margin-left:4px;vertical-align:middle;cursor:default;">
        cached
    </span>`;
}

// ── Pool state persistence ────────────────────────────────────────────────────
function _suggSaveState() {
    try {
        localStorage.setItem(_SUGG_STATE_KEY, JSON.stringify({
            filter:    _suggFilter,
            bucket:    Math.floor(Date.now() / _SUGG_POOL_TTL),
            poolKeys:  _suggPool.map(_suggKey),
            activeIdx: _suggPoolIdx,
            timestamp: _suggPoolTs,
        }));
    } catch {}
}

function _suggLoadState() {
    try { return JSON.parse(localStorage.getItem(_SUGG_STATE_KEY) || 'null'); }
    catch { return null; }
}

// ── Pool builder with 6-hour deterministic rotation ──────────────────────────
// Selects up to _SUGG_POOL_PER_PLAT games per platform for 'all', or
// _SUGG_POOL_SINGLE for a single-platform filter, using a seeded shuffle
// keyed to the 6-hour bucket so the same bucket always yields the same order.
function _suggBuildPool() {
    const now    = Date.now();
    const bucket = Math.floor(now / _SUGG_POOL_TTL);
    const maxVisible = _SUGG_POOL_SINGLE;

    // Try to restore persisted pool if it belongs to the same bucket + filter.
    // This makes refreshes within the same 6-hour window stable.
    const saved = _suggLoadState();
    if (saved && saved.bucket === bucket && saved.filter === _suggFilter && saved.poolKeys?.length) {
        const all = _suggAllGames;
        const restored = [];
        for (const key of saved.poolKeys) {
            const colon = key.indexOf(':');
            const plat  = key.slice(0, colon);
            const id    = key.slice(colon + 1);
            const found = all.find(g => g._platform === plat && String(g.id) === id);
            if (found) restored.push(found);
        }
        if (restored.length > 0) {
            _suggPool    = _suggDedupe(restored).slice(0, maxVisible);
            _suggPoolIdx = Math.max(0, Math.min(saved.activeIdx ?? 0, _suggPool.length - 1));
            _suggPoolTs  = saved.timestamp;
            _suggSyncState(bucket);
            console.log(`[ReadyToInstall] bucket=${bucket} filter=${_suggFilter} visible=${_suggPool.length}`);
            return;
        }
    }

    // Build fresh pool for this bucket using deterministic seeded shuffle.
    _suggPool = _suggSelectForFilter(_suggFilter, bucket).slice(0, maxVisible);

    if (_suggPool.length === 0) {
        _suggPoolIdx = 0;
        _suggSyncState(bucket);
        console.log(`[ReadyToInstall] bucket=${bucket} filter=${_suggFilter} visible=0`);
        return;
    }
    _suggPoolIdx = 0;
    _suggPoolTs  = now;
    _suggSyncState(bucket);
    _suggSaveState();
    console.log(`[ReadyToInstall] bucket=${bucket} filter=${_suggFilter} visible=${_suggPool.length}`);
}

// ── Recommendations: up to 5 games NOT in the visible pool ───────────────────
function _suggDedupe(games) {
    const seen = new Set();
    const out = [];
    for (const g of games) {
        const key = _suggKey(g);
        if (!g || seen.has(key)) continue;
        seen.add(key);
        out.push(g);
    }
    return out;
}

function _suggSyncState(bucket) {
    _suggState = {
        bucket,
        recommendedItems: _suggSelectForFilter('all', bucket),
        steamItems: _suggSelectForFilter('steam', bucket),
        epicItems: _suggSelectForFilter('epic', bucket),
        activeFilter: _suggFilter,
    };
}

function _suggSelectForFilter(filter, bucket) {
    const seed = `baddel_rtipool_${filter}_${bucket}`;
    if (filter === 'all') {
        return _suggDedupe(_seededShuffle(_suggAllGames, seed)).slice(0, _SUGG_POOL_SINGLE);
    }
    return _suggDedupe(_seededShuffle(
        _suggAllGames.filter(g => g._platform === filter),
        seed
    )).slice(0, _SUGG_POOL_SINGLE);
}

// ── Auto-rotation timer management ───────────────────────────────────────────
function _suggStopRotation() {
    if (_suggRotateTimer !== null) { clearInterval(_suggRotateTimer); _suggRotateTimer = null; }
}

function _suggStartRotation() {
    _suggStopRotation();
    if (_suggPool.length <= 1) return;
    _suggRotateTimer = setInterval(() => {
        _suggPoolIdx = (_suggPoolIdx + 1) % _suggPool.length;
        _suggSaveState();
        _renderSyncedRail(_suggPool);
        _renderSyncedFeature(_suggPool[_suggPoolIdx]);
    }, _SUGG_ROTATE_MS);
}

// ── Manual game selection from the rail ──────────────────────────────────────
window._suggSelectGame = function(idx) {
    if (idx < 0 || idx >= _suggPool.length) return;
    _suggPoolIdx = idx;
    _suggSaveState();
    _suggStartRotation(); // restart the 30s timer from the selected item
    _renderSyncedRail(_suggPool);
    _renderSyncedFeature(_suggPool[idx]);
};

// ── View Details: open the existing game-details page ────────────────────────
window.suggViewDetails = function(platform, gameId) {
    const g = _suggAllGames.find(x => x._platform === platform && String(x.id) === String(gameId));
    if (!g) return;
    const game = _suggBuildGame(g);
    // Inject the game object so openGameDetails can find it even though
    // synced games don't live in the local DB.
    window._gdSyncedGameOverride = game;
    if (typeof openGameDetails === 'function') {
        openGameDetails(game.id);
    }
};

// ── Screenshot carousel state (kept for hydration re-render compatibility) ───
let _suggCarouselIdx = 0;
let _suggFeaturedGame = null; // reference to current featured game object

// ── Rich metadata hydration ───────────────────────────────────────────────────
// Extends the existing art-hydration to also pull screenshots, genres, and
// storage requirements text from meta.info (same getMetadata call).
// Fields populated on g:
//   _metaScreenshots  — array of URL strings from meta.info.screenshots
//   _metaGenres       — array of strings from meta.info.genres
//   _metaStorageText  — nullable string, e.g. "24 GB" from meta.info.minimumDisk
//                       or meta.info.storageRequirements. Labelled as requirements,
//                       NOT presented as exact download size.
async function _suggHydrateArt(g, domId, isFeature) {
    // ── One-shot guards — prevent in-flight duplicates and re-requests ────────
    // _heroHydrating : a fetch is in-flight right now
    // _heroHydrated  : fetch has completed at least once (hero found or not)
    const hydrateKey = _suggKey(g);
    if (g._heroHydrated || g._heroHydrating || hydratedGameIds.has(hydrateKey) || hydratingGameIds.has(hydrateKey)) return;

    if (_suggHydrateActive >= _SUGG_HYDRATE_CONCURRENCY) {
        hydratingGameIds.add(hydrateKey);
        setTimeout(() => {
            hydratingGameIds.delete(hydrateKey);
            _suggHydrateArt(g, domId, isFeature);
        }, 120);
        return;
    }

    // Fast-exit if every art field AND rich meta is already present
    if (g.heroImage && g.image && g.logo && g._metaHydrated) return;

    g._heroHydrating = true;
    hydratingGameIds.add(hydrateKey);
    _suggHydrateActive++;
    try {
        const hints = {
            id:       g.id,
            platform: g._platform,
            platforms:[g._platform],
            appName:  g.appName   || '',
            allIds:   g.allIds    || { [g._platform]: g.id },
        };
        const meta = await window.electronAPI.getMetadata(g.title || '', hints);

        if (!meta) {
            // Definite miss — nothing to retry
            g._heroHydrated = true;
            hydratedGameIds.add(hydrateKey);
            return;
        }

        // ── Pending-enrichment detection ─────────────────────────────────────
        // If the server returned a stub (_serverData flag) but no usable art
        // yet, treat this as a pending response rather than a final miss.
        // Mirror the behaviour in processQueue() which retries after 4 s.
        const hasCoverArt = meta.cover || meta.hero || meta.heroImage || g.image || g.heroImage;
        const isPending   = meta._serverData && !hasCoverArt;

        if (isPending) {
            const retryCount = g._heroRetryCount || 0;
            if (retryCount < 2) {
                // Schedule one delayed retry; guard against duplicate timers
                g._heroRetryCount = retryCount + 1;
                setTimeout(() => {
                    g._heroHydrating = false; // allow re-entry
                    _suggHydrateArt(g, domId, isFeature);
                }, 3500);
                return; // _heroHydrated stays false; _heroHydrating cleared in finally
            }
            // Retry budget exhausted — accept the miss so we stop hammering
            g._heroHydrated = true;
            hydratedGameIds.add(hydrateKey);
            return;
        }

        // ── Art fields ───────────────────────────────────────────────────────
        let artChanged = false;
        // Hero: accept meta.heroImage OR meta.hero (mirrors _gdPopulateMeta)
        const incomingHero = meta.heroImage || meta.hero || null;
        if (incomingHero && !g.heroImage) { g.heroImage = incomingHero; artChanged = true; }
        if (meta.cover    && !g.image)    { g.image     = meta.cover;   artChanged = true; }
        // Logo: accept meta.logo or meta.defaultLogo
        const incomingLogo = meta.logo || meta.defaultLogo || null;
        if (incomingLogo  && !g.logo)     { g.logo      = incomingLogo; artChanged = true; }

        // ── Rich info fields ─────────────────────────────────────────────────
        const info = meta.info || {};

        if (Array.isArray(info.screenshots) && info.screenshots.length) {
            g._metaScreenshots = info.screenshots.filter(s => typeof s === 'string' && s.length > 4);
        }
        if (Array.isArray(info.genres) && info.genres.length) {
            g._metaGenres = info.genres.filter(s => typeof s === 'string' && s.trim());
        }
        if (!g._metaStorageText) {
            if (typeof info.minimumDisk === 'number' && info.minimumDisk > 0) {
                const gb = (info.minimumDisk / (1024 ** 3)).toFixed(1);
                g._metaStorageText = `${gb} GB`;
            } else if (typeof info.storageRequirements === 'string' && info.storageRequirements.trim()) {
                g._metaStorageText = info.storageRequirements.trim();
            }
        }

        // Lookup is genuinely complete — mark done
        g._heroHydrated  = true;
        g._metaHydrated  = true;
        hydratedGameIds.add(hydrateKey);

        // Snapshot remote URLs into art cache immediately so rotation has a
        // fallback before the disk-cache write completes.
        if (artChanged) _suggArtCachePopulate(g);

        // Cache art to disk if possible
        if (artChanged && window.electronAPI.cacheAllAssets) {
            window.electronAPI.cacheAllAssets(
                { cover: meta.cover || null, hero: incomingHero || null, logo: incomingLogo || null },
                g.id
            ).then(local => {
                if (local?.cover) g.image     = local.cover;
                if (local?.hero)  g.heroImage = local.hero;
                if (local?.logo)  g.logo      = local.logo;
                _suggArtCachePopulate(g); // update cache with local file:// paths
                _suggReRenderOne(g, domId, isFeature);
            }).catch(() => {});
        }

        if (!artChanged && !g._metaScreenshots && !g._metaGenres) return;
        _suggReRenderOne(g, domId, isFeature);

    } catch {
        failedImageIds.add(hydrateKey);
    }
    finally {
        g._heroHydrating = false;
        hydratingGameIds.delete(hydrateKey);
        _suggHydrateActive = Math.max(0, _suggHydrateActive - 1);
    }
}

// ── Re-render a single entry after hydration arrives ─────────────────────────
function _suggReRenderOne(g, domId, isFeature) {
    if (isFeature) {
        // Patch the featured panel in-place rather than rebuilding innerHTML.
        // A full rebuild would re-enter _renderSyncedFeature → re-trigger the
        // hydration guard and cause flicker. Only patch what changed: the hero
        // background and the title/logo block.
        if (_suggFeaturedGame !== g) {
            // Featured game switched — full re-render is correct.
            _renderSyncedFeature(g);
            return;
        }

        // ── Hero background ──
        const heroImgEl       = document.querySelector('#sfHeroPanel .sf-hero-img');
        const heroPlaceholder = document.querySelector('#sfHeroPanel .sf-hero-placeholder');
        _suggArtCachePopulate(g); // fold new hydration results into cache
        const artKey     = _suggKey(g);
        const cachedArt  = _suggArtCacheGet(artKey);
        const heroUrl    = isUsableImageUrl(cachedArt?.hero || g.heroImage || g.defaultHero || '');
        const posterFb   = isUsableImageUrl(cachedArt?.poster);
        if (heroUrl || posterFb) {
            if (heroImgEl) {
                setHeroBgStable(heroImgEl, heroUrl, posterFb);
            } else if (heroPlaceholder) {
                const div = document.createElement('div');
                div.className = 'sf-hero-img';
                heroPlaceholder.replaceWith(div);
                setHeroBgStable(div, heroUrl, posterFb);
            }
        }

        // ── Logo / title ──
        const featuredLogo = isUsableImageUrl(g.logo || g.defaultLogo || cachedArt?.logo || null);
        const titleEl = document.querySelector('#sfHeroPanel .sf-title');
        const logoEl  = document.querySelector('#sfHeroPanel .sf-logo');
        if (featuredLogo) {
            if (logoEl) {
                logoEl.src = featuredLogo.replace(/\\/g, '/');
            } else if (titleEl) {
                const img = document.createElement('img');
                img.className = 'sf-logo';
                img.src = featuredLogo.replace(/\\/g, '/');
                img.alt = g.title || '';
                titleEl.replaceWith(img);
            }
        }
        // If no logo and title element is already visible, nothing to change.
    } else {
        const row = document.getElementById(domId);
        if (!row) return;
        const artKey    = _suggKey(g);
        const cachedArt = _suggArtCacheGet(artKey);
        const img       = isUsableImageUrl(cachedArt?.poster) || getPosterUrl(g);
        const imgFb     = isUsableImageUrl(cachedArt?.poster) || null;
        if (!img) return;
        const thumbEl = row.querySelector('.srr-thumb');
        if (thumbEl) { setCardImageStable(thumbEl, img, imgFb); thumbEl.innerHTML = ''; }
        const artEl = row.querySelector('.sugg-rail-art');
        if (artEl) { setCardImageStable(artEl, img, imgFb); artEl.innerHTML = ''; }
    }
}

// ── Build the "X GB · Genre" meta string for a rail row ──────────────────────
function _suggRailMetaHtml(g) {
    const parts = [];

    // Size: approximate storage requirement, NOT download size
    if (g._metaStorageText) {
        parts.push(`<span title="Storage requirement (approximate)">${g._metaStorageText}</span>`);
    }

    // Genre: first genre or comma-joined pair
    if (Array.isArray(g._metaGenres) && g._metaGenres.length) {
        const genreStr = g._metaGenres.slice(0, 2).join(' / ');
        parts.push(`<span>${genreStr}</span>`);
    }

    if (parts.length === 0) return '';
    // Join with a centred dot separator
    return parts.join('<span class="sugg-meta-dot">·</span>');
}

// ── Carousel navigation helpers ───────────────────────────────────────────────
// These are called from inline onclick in the rendered carousel HTML.
window._suggCarouselPrev = function() {
    if (!_suggFeaturedGame) return;
    const slides = _suggCarouselSlides(_suggFeaturedGame);
    if (slides.length <= 1) return;
    _suggCarouselIdx = (_suggCarouselIdx - 1 + slides.length) % slides.length;
    _suggUpdateCarouselSlide(slides);
};

window._suggCarouselNext = function() {
    if (!_suggFeaturedGame) return;
    const slides = _suggCarouselSlides(_suggFeaturedGame);
    if (slides.length <= 1) return;
    _suggCarouselIdx = (_suggCarouselIdx + 1) % slides.length;
    _suggUpdateCarouselSlide(slides);
};

// Returns ordered array of image URLs: screenshots first, then hero/cover fallback
function _suggCarouselSlides(g) {
    const shots = Array.isArray(g._metaScreenshots) ? g._metaScreenshots : [];
    const fallback = (g.heroImage || g.image || g.capsuleImage || '').replace(/\\/g, '/');
    const all = shots.length ? shots : (fallback ? [fallback] : []);
    return all;
}

// Swaps the visible slide without re-rendering the whole card
function _suggUpdateCarouselSlide(slides) {
    const stage = document.getElementById('suggCarouselStage');
    if (!stage) return;
    const url = isUsableImageUrl((slides[_suggCarouselIdx] || '').replace(/\\/g, '/'));
    if (url) {
        setHeroBgStable(stage, url);
    } else if (!stage.dataset.lastGoodBg) {
        stage.style.backgroundImage = 'none';
    }

    // Update pip dots
    document.querySelectorAll('.sugg-carousel-pip').forEach((pip, i) => {
        pip.classList.toggle('active', i === _suggCarouselIdx);
    });

    // Update arrow visibility
    const total = slides.length;
    const btnPrev = document.getElementById('suggCarouselPrev');
    const btnNext = document.getElementById('suggCarouselNext');
    if (btnPrev) btnPrev.style.display = total > 1 ? '' : 'none';
    if (btnNext) btnNext.style.display = total > 1 ? '' : 'none';
}

// ── Featured cinematic hero panel ────────────────────────────────
function _renderSyncedFeature(g) {
    const wrap = document.getElementById('syncedFeatureWrap');
    if (!wrap) return;
    if (!g) { wrap.innerHTML = ''; return; }

    _suggFeaturedGame = g;
    _suggArtCachePopulate(g); // snapshot current art into cache before DOM rebuild

    const artKey    = _suggKey(g);
    const cachedArt = _suggArtCacheGet(artKey);

    // ── Hero background: prefer cached file:// then game fields ─────────────
    // Never embed the URL in innerHTML — apply it after render via
    // setHeroBgStable so broken remote URLs degrade gracefully to the fallback.
    const heroCandidate = isUsableImageUrl(
        cachedArt?.hero ||
        g.heroImage || g.defaultHero ||
        (g._heroHydrated ? (g.image || g.capsuleImage || '') : '')
    );

    // ── Logo vs text title ───────────────────────────────────────────────────
    const featuredLogo = isUsableImageUrl(g.logo || g.defaultLogo || cachedArt?.logo || null);
    const titleBlock = featuredLogo
        ? `<img class="sf-logo" src="${featuredLogo.replace(/\\/g, '/')}" alt="${g.title || ''}">`
        : `<div class="sf-title">${g.title || 'Unknown'}</div>`;

    const genres = Array.isArray(g._metaGenres) && g._metaGenres.length
        ? `<div class="sf-genres">${g._metaGenres.slice(0, 3).map(gr => `<span class="sf-genre-pill">${gr}</span>`).join('')}</div>`
        : '';

    const desc = g.description
        ? `<p class="sf-desc">${String(g.description).slice(0, 180)}…</p>`
        : '';

    // Single-quote safe escaping for inline onclick attributes
    const pSafe = String(g._platform).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const gSafe = String(g.id).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    const posCounter = _suggPool.length > 1
        ? `<div class="sf-pos-counter">${_suggPoolIdx + 1} <span>/ ${_suggPool.length}</span></div>`
        : '';

    // Hero div is always rendered empty — background is applied via JS after
    // insertion so we can preload and fall back without touching the innerHTML.
    wrap.innerHTML = `
        <div class="sf-hero" id="sfHeroPanel">
            <div class="sf-hero-img"></div>
            <div class="sf-hero-gradient"></div>
            ${posCounter}
            <div class="sf-hero-content">
                ${titleBlock}
                ${genres}
                ${desc}
                <div class="sf-cta">
                    <button class="sf-btn-install" onclick="window.suggInstall('${pSafe}','${gSafe}')">Install</button>
                    <button class="sf-btn-details" onclick="window.suggViewDetails('${pSafe}','${gSafe}')">View Details</button>
                </div>
            </div>
        </div>`;

    // Apply hero background with preload + fallback guard
    const heroBgEl = wrap.querySelector('.sf-hero-img');
    if (heroBgEl) {
        const posterFallback = isUsableImageUrl(cachedArt?.poster);
        setHeroBgStable(heroBgEl, heroCandidate, posterFallback);
    }

    // Trigger hydration only once per game: when hero (or logo) is missing,
    // no fetch is already in-flight, and we haven't already checked.
    if (!g._heroHydrating && !g._heroHydrated) {
        _suggHydrateArt(g, 'syncedFeatureWrap', true);
    }
}
// ── Rail: game selector panel ────────────────────────────────────────────────
function _renderSyncedRail(games) {
    const rail = document.getElementById('syncedRail');
    if (!rail) return;
    rail.innerHTML = '<div class="synced-rail-hdr">Install Queue</div>';

    games.forEach((g, idx) => {
        const artKey    = _suggKey(g);
        const cachedArt = _suggArtCacheGet(artKey);
        // Prefer cached file:// poster; fall back to live game fields
        const img         = isUsableImageUrl(cachedArt?.poster) || getPosterUrl(g);
        const imgFallback = isUsableImageUrl(cachedArt?.poster) || null;
        const rowId  = `sugg-rail-row-${idx}`;
        const cfg    = _SUGG_PLAT_CFG[g._platform] || { name: g._platform || '?', img: null, invert: false };
        const isActive = idx === _suggPoolIdx;

        const platHtml = cfg.img
            ? `<img src="${cfg.img}" alt="${cfg.name}"${cfg.invert ? ' class="sugg-invert"' : ''}><span>${cfg.name}</span>`
            : `<span>${cfg.name}</span>`;

        const row = document.createElement('div');
        row.className = 'sugg-rail-row' + (isActive ? ' active' : '');
        row.id        = rowId;
        row.setAttribute('tabindex', '0');
        row.setAttribute('role', 'button');
        row.setAttribute('aria-pressed', String(isActive));
        row.setAttribute('onclick', `window._suggSelectGame(${idx})`);
        row.setAttribute('onkeydown', `if(event.key==='Enter'||event.key===' ')window._suggSelectGame(${idx})`);

        row.innerHTML =
            `<div class="srr-thumb"></div>` +
            `<div class="srr-info">` +
                `<div class="srr-title">${escapeHtml(g.title || '?')}</div>` +
                `<div class="srr-plat">${platHtml}</div>` +
            `</div>` +
            `<div class="srr-chevron">&#x203A;</div>`;

        rail.appendChild(row);
        const thumb = row.querySelector('.srr-thumb');
        // Pass cached art as explicit fallback so newly-created elements don't
        // go blank if the URL re-fetch fails during this rotation cycle.
        setCardImageStable(thumb, img, imgFallback);
        if (!img && !failedImageIds.has(artKey)) _suggHydrateArt(g, rowId, false);
    });
}
// ── Render the active filter view (pool-aware) ───────────────────────────────
function _suggRenderFiltered() {
    _suggBuildPool();

    if (_suggPool.length === 0) {
        const w = document.getElementById('syncedFeatureWrap');
        if (w) w.innerHTML = '';
        const r = document.getElementById('syncedRail');
        if (r) r.innerHTML = '';
        return;
    }

    _renderSyncedFeature(_suggPool[_suggPoolIdx]);
    _renderSyncedRail(_suggPool);
    _suggStartRotation();
}

// ── Filter pills visibility ───────────────────────────────────────────────────
function _suggUpdatePills() {
    const hasSteam = _suggAllGames.some(g => g._platform === 'steam');
    const hasEpic  = _suggAllGames.some(g => g._platform === 'epic');
    const ps = document.querySelector('.sugg-pill[data-filter="steam"]');
    const pe = document.querySelector('.sugg-pill[data-filter="epic"]');
    if (ps) ps.style.display = hasSteam ? '' : 'none';
    if (pe) pe.style.display = hasEpic  ? '' : 'none';
}

async function _renderSyncedSuggestionsInner() {
    _suggStopRotation();
    const section  = document.getElementById('syncedSuggestionsSection');
    const loading  = document.getElementById('syncedSuggLoading');
    const empty    = document.getElementById('syncedSuggEmpty');
    const cta      = document.getElementById('syncedSuggCTA');
    const body     = document.getElementById('syncedSuggBody');
    const stats    = document.getElementById('syncedSuggStats');
    const filters  = section.querySelector('.synced-filters');
    if (!section) return;

    const _hide = el => { if (el) el.style.display = 'none'; };
    const _show = (el, disp = 'block') => { if (el) el.style.display = disp; };

    // Check which platforms have linked accounts
    const linkedPlatforms = [];
    for (const platform of _SUGG_PLATFORMS) {
        try {
            const r = await window.electronAPI.platformSyncGetAccounts(platform);
            if (r?.accounts?.length > 0) linkedPlatforms.push(platform);
        } catch { /* ignore */ }
    }

    section.style.display = 'block';
    _hide(loading); _hide(empty); _hide(cta); _hide(body);
    if (filters) filters.style.display = 'flex';

    if (linkedPlatforms.length === 0) {
        // No accounts at all — show CTA with connect buttons
        if (cta) {
            const ctaBtns = document.getElementById('syncedCtaBtns');
            if (ctaBtns) {
                ctaBtns.innerHTML =
                `<button class="synced-cta-btn synced-cta-btn-primary" onclick="typeof navigateToAllGames==='function'?navigateToAllGames():document.getElementById('nav-all-games')?.click()">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                    Connect Accounts
                </button>`;
            }
            if (filters) filters.style.display = 'none';
            _show(cta, 'flex');
        }
        if (stats) stats.innerHTML = '';
        return;
    }

    _show(loading, 'flex');
    await _buildSyncedSuggestions();

    if (_suggAllGames.length === 0) {
        _hide(loading);
        // Accounts linked but all games already installed (or no eligible games)
        if (empty) {
            empty.innerHTML = `
                <svg class="synced-empty-icon" width="36" height="36" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                    <polyline points="22 4 12 14.01 9 11.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                <div class="synced-empty-text">
                    <div class="synced-empty-title">All caught up</div>
                    <div class="synced-empty-sub">All games from your linked accounts are already installed on this machine.</div>
                </div>`;
            _show(empty, 'flex');
        }
        if (stats) stats.innerHTML = '';
        return;
    }

    // Build pools now so _suggState.{recommendedItems,steamItems,epicItems} is
    // populated before we decide what to hydrate.
    _suggBuildPool();

    // Warm disk cache for ONLY the items visible on the home screen (≤ 15 cards:
    // 5 recommended + 5 steam + 5 epic).  Never touches the rest of _suggAllGames.
    // warmBatch is fast (~50 ms); network hydration fires in the background so
    // _hide(loading) is not gated on any network round-trips.
    const _visibleReadyItems = _suggDedupe([
        ...(_suggState.recommendedItems || []),
        ...(_suggState.steamItems       || []),
        ...(_suggState.epicItems        || []),
    ]);
    await _rtia_hydrateAll(_visibleReadyItems);
    _hide(loading);

    _show(body, 'grid');

    const staleCount = _suggAllGames.filter(g =>  g._cacheStale).length;
    const _rtiCount = typeof window.getCanonicalReadyToInstallCount === 'function'
        ? window.getCanonicalReadyToInstallCount()
        : null;
    if (stats) {
        const _rtiDisplay = _rtiCount !== null ? String(_rtiCount) : '…';
        let countHtml = `<div class="synced-count-inline"><span class="sci-label">READY TO INSTALL</span><span class="sci-num green" data-ready-count>${_rtiDisplay}</span></div>`;
        if (staleCount > 0) {
            countHtml += `<div class="synced-count-inline" title="From a previous sync that had errors — may not be current"><span class="sci-label">CACHED</span><span class="sci-num" style="color:#f59e0b;">${staleCount}</span></div>`;
        }
        stats.innerHTML = countHtml;
    }

    _suggUpdatePills();
    _suggRenderFiltered();
}

async function renderSyncedSuggestions() {
    if (typeof window._homeIsUserScrolled === 'function' && window._homeIsUserScrolled()) {
        const _scrolledRtiCount = typeof window.getCanonicalReadyToInstallCount === 'function'
            ? window.getCanonicalReadyToInstallCount() : null;
        if (typeof window._updateHomeReadyCountTextOnly === 'function') {
            window._updateHomeReadyCountTextOnly(_scrolledRtiCount);
        }
        if (typeof window._markHomeRefreshPending === 'function') {
            window._markHomeRefreshPending('home-synced-suggestions-scrolled');
        }
        return;
    }
    return _renderSyncedSuggestionsInner();
}

window.setSyncedFilter = function(filter, btn) {
    _suggStopRotation();
    _suggPool    = [];
    _suggPoolTs  = 0;
    _suggFilter  = filter;
    document.querySelectorAll('.sugg-pill').forEach(p => p.classList.remove('active'));
    if (btn) btn.classList.add('active');
    _suggRenderFiltered();
};

window.suggInstall = function(platform, gameId) {
    const g = _suggAllGames.find(x => x._platform === platform && String(x.id) === String(gameId));
    if (!g) return;
    const game = _suggBuildGame(g);
    if (typeof window._gdOpenInstallPickerForGame === 'function') {
        window._gdOpenInstallPickerForGame(game);
    } else {
        console.warn('[SyncedSugg] _gdOpenInstallPickerForGame not ready — game-details.js not loaded yet');
    }
};

// Called by app.js after onLibraryUpdated fires.
// Re-renders the home suggestions section to pick up updated counts and cards.
window._onSyncLibraryUpdated = function() {
    if (typeof currentView !== 'undefined' && currentView === 'home') {
        _suggStopRotation();
        renderSyncedSuggestions();
    }
};
window.renderSyncedSuggestions = renderSyncedSuggestions;

// Refresh the home Ready to Install stat whenever canonical count changes.
try {
    window.addEventListener('baddel:ready-install-updated', () => {
        const statsEl = document.getElementById('syncedSuggStats');
        if (!statsEl || typeof currentView === 'undefined' || currentView !== 'home') return;
        const rtiCount = typeof window.getCanonicalReadyToInstallCount === 'function'
            ? window.getCanonicalReadyToInstallCount()
            : null;
        if (typeof window._homeIsUserScrolled === 'function' && window._homeIsUserScrolled()) {
            // Only patch the count text — no innerHTML, no layout mutations while scrolled.
            if (typeof window._updateHomeReadyCountTextOnly === 'function') {
                window._updateHomeReadyCountTextOnly(rtiCount);
            }
            if (typeof window._markHomeRefreshPending === 'function') {
                window._markHomeRefreshPending('home-ready-count-text-only');
            }
            return;
        }
        const staleGames = Array.isArray(window._suggAllGames)
            ? window._suggAllGames.filter(g => g._cacheStale)
            : [];
        const display = rtiCount !== null ? String(rtiCount) : '…';
        let html = `<div class="synced-count-inline"><span class="sci-label">READY TO INSTALL</span><span class="sci-num green" data-ready-count>${display}</span></div>`;
        if (staleGames.length > 0) {
            html += `<div class="synced-count-inline" title="From a previous sync that had errors — may not be current"><span class="sci-label">CACHED</span><span class="sci-num" style="color:#f59e0b;">${staleGames.length}</span></div>`;
        }
        statsEl.innerHTML = html;
    });
} catch (_) {}
