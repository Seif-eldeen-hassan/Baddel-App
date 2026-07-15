// ============================================================
// BADDEL LAUNCHER - GAME DETAILS PAGE (game-details.js)
// ============================================================
// كيفية الاستخدام:
//   openGameDetails(gameId)  ← من أي مكان في app.js
//   closeGameDetails()       ← زرار الـ Back
// ============================================================

// ──────────────────────────────────────────
//  STATE
// ──────────────────────────────────────────
let _gdCurrentGameId   = null;
let _gdCurrentMeta     = null;
let _gdCurrentGame     = null;
let _gdCurrentBaseGame = null;
let _gdAchievementsLoaded = false;
/** يزيد مع كل فتح تفاصيل لمنع رسم إنجازات لعبة سابقة بعد اكتمال طلب بطيء */
let _gdAchievementsGen = 0;
const _gdPendingMetadataRetries = new Map();
/**
 * Unique token for each openGameDetails() call.
 * Every async continuation checks this before mutating the DOM.
 * A new open (even for the same game) produces a new token, so
 * in-flight callbacks from a previous open are silently dropped.
 */
let _gdViewToken = null;
let _gdDownloadInterval = null;   // للـ demo download progress
let _gdPreviousView    = 'home';  // عشان نعرف نرجع لأنهي شاشة
let _gdSavedFilterState = null;   // FIX: saves All Games filter state before navigating in
let _gdLightboxImages = [];
let _gdLightboxIndex  = 0;
const _GD_CREATOR_STORAGE_KEY = 'customGameDetails';
let _gdCreatorModeActive = false;
let _gdCreatorPreview = false;
let _gdCreatorDraft = null;
let _gdCreatorOriginalDraft = null;
let _gdCurrentCustomDetails = null;
let _gdCreatorDelegationInstalled = false;
let _gdCreatorAddingTrailer = false;

// ── Creator session snapshots (isolated from committed state) ──────────────────
// Initialized when entering Creator edit mode; never mutated by preview/draft.
let _gdCreatorSessionBaseGame   = null;  // deep clone of committed game before any edits
let _gdCreatorSessionSavedCustom = null; // deep clone of saved custom at session start
let _gdCreatorSessionSavedGame  = null;  // deep clone of committed game at session start
let _gdCreatorSaveInFlight      = false; // re-entrancy guard for gdCreatorSave

// Guard to prevent duplicate drag & drop listeners (fixes spam toasts)
let _gdCreatorDragDropSetupDone = false;

// ──────────────────────────────────────────
//  TIMEOUT HELPER
//  Wraps any promise with a hard deadline so a hung IPC call never
//  blocks Game Details forever.  Rejects with a labelled Error on timeout.
// ──────────────────────────────────────────
function _gdWithTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`[GD] ${label} timed out after ${ms}ms`)), ms)
        )
    ]);
}

// ──────────────────────────────────────────
//  SKELETON CLEAR HELPER
//  Called when metadata is unavailable (timeout / miss / error).
//  Replaces every .gd-skeleton element in the key containers with
//  a quiet "—" so the page is never stuck on loading placeholders.
// ──────────────────────────────────────────
function _gdClearSkeletons() {
    // Info grid
    const infoGrid = document.getElementById('gdInfoGrid');
    if (infoGrid && infoGrid.querySelector('.gd-skeleton')) {
        infoGrid.innerHTML = `
            <div class="gd-info-item" style="grid-column:1/-1">
                <div class="gd-info-label" style="color:rgba(255,255,255,0.35);font-size:0.82em;font-style:italic;">
                    No metadata available
                </div>
            </div>`;
    }
    // Sidebar detail list
    const detailList = document.getElementById('gdDetailList');
    if (detailList && detailList.querySelector('.gd-skeleton')) {
        detailList.innerHTML = `
            <div class="gd-detail-row" style="color:rgba(255,255,255,0.35);font-size:0.8em;font-style:italic;">
                No details available
            </div>`;
    }
    // Screenshots
    const ssContainer = document.getElementById('gdScreenshots');
    if (ssContainer && !ssContainer.querySelector('img')) {
        ssContainer.innerHTML = '<div class="gd-no-media" style="opacity:0.4;">No screenshots available</div>';
    }
    // Accounts list
    const accList = document.getElementById('gdAccountsList');
    if (accList && accList.textContent.trim() === 'Loading accounts…') {
        accList.innerHTML = '<div class="gd-no-accounts">No accounts found</div>';
    }
    // Short description
    const shortDescSection = document.getElementById('gdShortDescSection') || document.getElementById('gdShortDesc');
    if (shortDescSection) shortDescSection.style.display = 'none';
}

function _gdPlatformTokensForPending(game, explicitPlatform) {
    const raw = explicitPlatform || game?.platform || game?.platforms || '';

    if (Array.isArray(raw)) {
        return raw.map(p => String(p || '').toLowerCase().trim()).filter(Boolean);
    }

    return String(raw || '')
        .toLowerCase()
        .split(/[\s,\/|]+/)
        .map(p => p.trim())
        .filter(Boolean);
}

function _gdIsLikelyMetadataPending(game, explicitPlatform, explicitId, metaLike) {
    if (metaLike?.source === 'server-pending') return true;
    if (metaLike?._serverData?.pending === true) return true;

    const tokens = _gdPlatformTokensForPending(game, explicitPlatform);

    const hasSteam =
        tokens.includes('steam') ||
        tokens.includes('steam_app') ||
        !!game?.allIds?.steam ||
        !!game?.steamAppId ||
        !!game?.steam_appid ||
        !!game?.appid ||
        !!game?.appId;

    const hasEpic =
        tokens.includes('epic') ||
        tokens.includes('epic_games') ||
        tokens.includes('epicgames') ||
        tokens.includes('epic games') ||
        !!game?.allIds?.epic ||
        !!game?.namespace ||
        !!game?.catalogNamespace;

    const hasCanonicalId = !!String(
        explicitId ||
        game?.allIds?.steam ||
        game?.allIds?.epic ||
        game?.steamAppId ||
        game?.steam_appid ||
        game?.appid ||
        game?.appId ||
        game?.namespace ||
        game?.catalogNamespace ||
        ''
    ).trim();

    return (hasSteam || hasEpic) && hasCanonicalId;
}

function _gdHasUsableMeta(meta) {
    if (!meta || typeof meta !== 'object') return false;

    const info = meta.info || {};

    const screenshots = Array.isArray(info.screenshots) ? info.screenshots : [];
    const trailers = Array.isArray(info.allTrailers) ? info.allTrailers : [];
    const genres = Array.isArray(info.genres) ? info.genres : [];

    const ratingSources = Array.isArray(meta?.quality?.sources?.ratings)
        ? meta.quality.sources.ratings
        : Array.isArray(meta?.ratings?.sources)
            ? meta.ratings.sources
            : [];

    return !!(
        info.description ||
        meta.description ||
        info.short_description ||
        meta.short_description ||
        meta.quality?.sources?.text ||
        screenshots.length ||
        trailers.length ||
        genres.length ||
        ratingSources.length ||
        meta.cover ||
        meta.hero ||
        meta.heroImage ||
        meta.image
    );
}

function _gdShowMetadataPendingAndRetry(game, reason = 'pending') {
    if (!game) return;

    try {
        _gdRenderMetadataPendingState(game);
    } catch (err) {
        console.warn('[GD][PendingRetry] render pending failed:', err?.message || err);
    }

    const id = String(game.id || _gdCurrentGameId || '').trim();
    if (!id) return;

    const count = _gdPendingMetadataRetries.get(id) || 0;

    // كفاية 4 محاولات: 2.5s, 6s, 12s, 20s
    const delays = [2500, 6000, 12000, 20000];

    if (count >= delays.length) {
        console.log(`[GD][PendingRetry] stop retries for "${game.name}" after ${count} attempts`);
        return;
    }

    _gdPendingMetadataRetries.set(id, count + 1);

    const delay = delays[count];

    console.log(`[GD][PendingRetry] scheduled retry #${count + 1} for "${game.name}" in ${delay}ms (${reason})`);

    setTimeout(() => {
        const stillSameGame = String(_gdCurrentGameId || '') === id;
        const stillNoMeta = !_gdHasUsableMeta(_gdCurrentMeta);

        if (!stillSameGame || !stillNoMeta) return;
        if (_gdCreatorModeActive) return;

        console.log(`[GD][PendingRetry] retrying openGameDetails for "${game.name}"`);

        try {
            window.openGameDetails(id);
        } catch (err) {
            console.warn('[GD][PendingRetry] retry failed:', err?.message || err);
        }
    }, delay);
}

// ──────────────────────────────────────────
//  LI LINGXI'S ADDITIONS: BASE64 + FULL DRAG & DROP FOR CREATOR MODE
//  All images & videos (poster, hero, logo, screenshots, trailers) are now saved as
//  embedded base64 data URLs — no more local file:// paths. Works on any device.
// ──────────────────────────────────────────
async function _gdFileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = (err) => reject(err);
        reader.readAsDataURL(file);
    });
}

async function _gdHandleCreatorFile(field, file) {
    if (!file) return;
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    if (!isImage && !isVideo) {
        if (typeof showToast === 'function') showToast('Only images and videos are supported', 'error');
        return;
    }
    try {
        const base64DataUrl = await _gdFileToBase64(file);
        if (field === 'screenshots') {
            let current = _gdUniqList(_gdCreatorDraft?.screenshots || []);
            current.push(base64DataUrl);
            _gdCreatorSetDraft('screenshots', current);
        } else if (field === 'trailers') {
            const list = _gdNormalizeTrailerList(_gdCreatorDraft?.trailers || []);
            list.push({
                url: base64DataUrl,
                title: file.name.replace(/\.\w+$/, '') || 'Custom Video',
                thumbnail: base64DataUrl,
                creatorOwned: true
            });
            _gdCreatorSetDraft('trailers', list);
        } else {
            _gdCreatorSetDraft(field, base64DataUrl);
        }
        _gdCreatorApplyDraftToPage();
        // No toast here — visual update is instant and sufficient (prevents spam)
    } catch (err) {
        console.error('[GD][Creator] File processing failed:', err);
        if (typeof showToast === 'function') showToast('Failed to process file', 'error');
    }
}

function _gdSetupCreatorDragAndDrop() {
    if (_gdCreatorDragDropSetupDone || !_gdIsCreatorEditing()) return;
    _gdCreatorDragDropSetupDone = true;
    const targets = [
        { el: document.getElementById('gdHero'), field: 'heroImage' },
        { el: document.getElementById('gdCoverWrap'), field: 'posterImage' },
        { el: document.querySelector('.gd-title-block'), field: 'logoImage' },
        { el: document.getElementById('gdScreenshots'), field: 'screenshots' }
    ];
    targets.forEach(({ el, field }) => {
        if (!el) return;
        const prevent = (e) => { e.preventDefault(); e.stopPropagation(); };
        ['dragenter','dragover','dragleave','drop'].forEach(ev => el.addEventListener(ev, prevent));
        el.addEventListener('dragenter', () => {
            el.style.border = '3px dashed #60a5fa';
            el.style.backgroundColor = 'rgba(96,165,250,0.15)';
        });
        el.addEventListener('dragleave', () => {
            el.style.border = '';
            el.style.backgroundColor = '';
        });
        el.addEventListener('drop', async (e) => {
            el.style.border = '';
            el.style.backgroundColor = '';
            const file = e.dataTransfer.files[0];
            if (file) await _gdHandleCreatorFile(field, file);
        });
        el.style.cursor = 'pointer';
    });
    console.log('%c[GD][Creator] ✨ Drag & drop + base64 fully enabled (Li Lingxi)', 'color:#60a5fa;font-weight:bold');
}

function _gdEscHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function _gdCreatorStore() {
    try { return JSON.parse(localStorage.getItem(_GD_CREATOR_STORAGE_KEY) || '{}') || {}; } catch { return {}; }
}


function _gdClonePlain(obj = {}) {
    try {
        return JSON.parse(JSON.stringify(obj || {}));
    } catch {
        return { ...(obj || {}) };
    }
}

function _gdStripCreatorHistory(data = {}) {
    const out = _gdClonePlain(data);
    delete out.previousCreatorSave;
    delete out.updatedAt;
    return out;
}

function _gdGetPreviousCreatorSave(custom = {}) {
    const prev = custom?.previousCreatorSave;
    return _gdHasSavedCreatorDetails(prev) ? prev : null;
}

function _gdCreatorSaveStore(store) {
    try { localStorage.setItem(_GD_CREATOR_STORAGE_KEY, JSON.stringify(store || {})); } catch {}
}


function _gdCreatorAddKey(keys, value) {
    const raw = String(value || '').trim();
    if (!raw) return;

    keys.add(raw);

    const lower = raw.toLowerCase();
    if (lower) keys.add(lower);

    const loose = lower.replace(/[^a-z0-9]/g, '');
    if (loose) keys.add(loose);
}

function _gdCreatorCandidateKeys(gameOrId) {
    const keys = new Set();

    if (gameOrId && typeof gameOrId === 'object') {
        const g = gameOrId;

        // IMPORTANT: installedId first, because Creator edits are usually saved from Installed page
        _gdCreatorAddKey(keys, g.installedId);
        _gdCreatorAddKey(keys, g.id);
        _gdCreatorAddKey(keys, g.appName);
        _gdCreatorAddKey(keys, g.appid);
        _gdCreatorAddKey(keys, g.appId);
        _gdCreatorAddKey(keys, g.steamAppId);
        _gdCreatorAddKey(keys, g.steam_appid);
        _gdCreatorAddKey(keys, g.namespace);
        _gdCreatorAddKey(keys, g.catalogNamespace);
        _gdCreatorAddKey(keys, g.catalogItemId);
        _gdCreatorAddKey(keys, g.launcherGameId);

        if (g.allIds && typeof g.allIds === 'object') {
            Object.values(g.allIds).forEach(v => _gdCreatorAddKey(keys, v));
        }

        const steamId = g.allIds?.steam || g.steamAppId || g.steam_appid || g.appid || g.appId || g.appName;
        if (steamId) {
            _gdCreatorAddKey(keys, steamId);
            _gdCreatorAddKey(keys, `steam-${steamId}`);
            _gdCreatorAddKey(keys, `steam_${steamId}`);
        }

        const epicId = g.allIds?.epic || g.epicAppName || g.appName || g.namespace;
        if (epicId) {
            _gdCreatorAddKey(keys, epicId);
            _gdCreatorAddKey(keys, `epic-${epicId}`);
            _gdCreatorAddKey(keys, `epic_${epicId}`);
        }

    } else {
        _gdCreatorAddKey(keys, gameOrId);
    }

    return [...keys].filter(Boolean);
}

function _gdCreatorGameKey(gameOrId) {
    return _gdCreatorCandidateKeys(gameOrId)[0] || '';
}

function _gdNormalizeCustomDetailsData(data) {
    const normalizedData = { ...(data || {}) };

    if (Array.isArray(normalizedData.trailers)) {
        normalizedData.trailers = _gdNormalizeTrailerList(normalizedData.trailers).map(t => ({
            url: t.url,
            title: t.title || '',
            thumbnail: t.thumbnail || '',
        }));
    }

    return normalizedData;
}

function _gdLoadCustomDetails(gameOrId) {
    const store = _gdCreatorStore();

    for (const key of _gdCreatorCandidateKeys(gameOrId)) {
        if (store[key]) return store[key];
    }

    return null;
}

function _gdPersistCustomDetails(gameOrId, data) {
    const keys = _gdCreatorCandidateKeys(gameOrId);
    if (!keys.length) return;

    const store = _gdCreatorStore();
    const normalizedData = _gdNormalizeCustomDetailsData(data);
    const saved = { ...normalizedData, updatedAt: Date.now() };

    keys.forEach(key => {
        store[key] = saved;
    });

    _gdCreatorSaveStore(store);
}

function _gdRemoveCustomDetails(gameOrId) {
    const keys = _gdCreatorCandidateKeys(gameOrId);
    if (!keys.length) return;

    const store = _gdCreatorStore();
    keys.forEach(key => delete store[key]);

    _gdCreatorSaveStore(store);
}

function _gdUniqList(list) {
    return [...new Set((Array.isArray(list) ? list : String(list || '').split(','))
        .map(v => String(v || '').trim())
        .filter(Boolean))];
}

function _gdBuildCustomMeta(game, custom = {}) {
    const info = {};
    if (custom.shortDescription) {
        info.short_description = custom.shortDescription;
    }
    if (custom.description) {
        info.description = custom.description;
        if (!info.short_description) {
            info.short_description = custom.description.length > 250 ? `${custom.description.slice(0, 250)}...` : custom.description;
        }
    }
    if (custom.genres?.length) info.genres = custom.genres;
    if (custom.platforms?.length) info.platforms = custom.platforms;
    if (custom.screenshots?.length) info.screenshots = custom.screenshots;
    if (custom.trailers?.length) {
        info.allTrailers = _gdNormalizeTrailerList(custom.trailers).map((obj, i) => ({
            name: obj.title || `Custom Trailer ${i + 1}`,
            url: obj.url,
            thumbnail: obj.thumbnail || '',
            creatorOwned: true,
            importedFromPagePack: !!custom._importedFromPagePack,
        }));
        const firstObj = _gdNormalizeCreatorTrailer(custom.trailers[0]);
        info.trailer = firstObj?.url || (typeof custom.trailers[0] === 'string' ? custom.trailers[0] : '');
    }
    // Build ratings: prefer new array format, fall back to legacy scalar
    let ratingsOut = [];
    if (custom.ratings?.length) {
        ratingsOut = custom.ratings;
    } else if (custom.rating) {
        ratingsOut = [{ source: 'igdb', score: Number(custom.rating), max_score: 100, total_reviews: custom.reviewSummary || null }];
        info.rating = custom.rating;
        info.ratingSource = 'Creator';
    }
    const effectiveLogo  = custom.logoMode === 'text' ? null : (custom.logoImage || game?.logo || null);
    const effectiveCover = custom.posterImage || custom.coverImage || game?.image || null;
    return {
        title: custom.title || game?.name,
        cover: effectiveCover,
        logo: effectiveLogo,
        heroImage: custom.heroImage || game?.heroImage || null,
        hero: custom.heroImage || game?.heroImage || null,
        developer: custom.developer || game?.developer || null,
        publisher: custom.publisher || game?.publisher || null,
        releaseDate: custom.releaseDate || game?.releaseDate || null,
        platforms: custom.platforms || game?.platforms || (game?.platform ? [game.platform] : []),
        ratings: ratingsOut,
        info,
        _creatorCustom: true,
    };
}

function _gdMergeCustomIntoMeta(game, meta) {
    const custom = _gdCurrentCustomDetails || _gdLoadCustomDetails(game);
    if (!custom) return meta;
    const customMeta = _gdBuildCustomMeta(game, custom);
    const baseInfo = meta?.info || {};
    // logoMode controls which logo is active; if text mode, always null
    const effectiveLogoMerge = custom.logoMode === 'text' ? null
        : (custom.logoImage || meta?.logo || customMeta.logo || null);
    return {
        ...(meta || {}),
        ...customMeta,
        cover: custom.posterImage || custom.coverImage || meta?.cover || customMeta.cover,
        logo: effectiveLogoMerge,
        heroImage: custom.heroImage || meta?.heroImage || meta?.hero || customMeta.heroImage,
        hero: custom.heroImage || meta?.hero || meta?.heroImage || customMeta.hero,
        developer: custom.developer || meta?.developer || customMeta.developer,
        publisher: custom.publisher || meta?.publisher || customMeta.publisher,
        releaseDate: custom.releaseDate || meta?.releaseDate || customMeta.releaseDate,
        platforms: custom.platforms?.length ? custom.platforms : (meta?.platforms || customMeta.platforms),
        ratings: custom.ratings?.length || custom.rating ? customMeta.ratings : (meta?.ratings || []),
        info: {
            ...baseInfo,
            ...customMeta.info,
            short_description: custom.shortDescription || customMeta.info.short_description || baseInfo.short_description,
            genres: custom.genres?.length ? custom.genres : baseInfo.genres,
            screenshots: custom.screenshots?.length ? custom.screenshots : baseInfo.screenshots,
            allTrailers: custom.trailers?.length ? customMeta.info.allTrailers : baseInfo.allTrailers,
            trailer: custom.trailers?.length
                ? (_gdNormalizeCreatorTrailer(custom.trailers[0])?.url || baseInfo.trailer)
                : baseInfo.trailer,
        },
        _creatorCustom: true,
    };
}

function _gdApplyCustomToGame(game, custom) {
    if (!custom) return game;
    // logoMode controls visibility — don't let a stored logoImage override text mode
    const effectiveLogo = custom.logoMode === 'text' ? null : (custom.logoImage || game.logo || null);
    const effectiveCover = custom.posterImage || custom.coverImage || game.image || null;
    const effectiveHero = custom.heroImage || game.heroImage || null;
    const hasCreatorArtwork = !!(custom.posterImage || custom.coverImage || custom.heroImage || custom.logoImage || custom.logoMode === 'text');
    return {
        ...game,
        creatorOriginalName: custom.originalName || game.creatorOriginalName || game.originalName || game.name,
        originalName: custom.originalName || game.originalName || game.name,
        name: custom.title || game.name,
        image: effectiveCover,
        cover: effectiveCover,
        coverUrl: effectiveCover,
        defaultImage: effectiveCover || game.defaultImage,
        logo: effectiveLogo,
        logoUrl: effectiveLogo,
        defaultLogo: effectiveLogo,
        heroImage: effectiveHero,
        hero: effectiveHero,
        heroUrl: effectiveHero,
        defaultHero: effectiveHero || game.defaultHero,
        customArtworkLocked: hasCreatorArtwork ? true : game.customArtworkLocked,
        artworkSource: hasCreatorArtwork ? 'creator' : game.artworkSource,
        artworkUpdatedAt: hasCreatorArtwork ? (custom.artworkUpdatedAt || game.artworkUpdatedAt || Date.now()) : game.artworkUpdatedAt,
        developer: custom.developer || game.developer,
        publisher: custom.publisher || game.publisher,
        short_description: custom.shortDescription || game.short_description,
        description: custom.description || game.description,
        releaseDate: custom.releaseDate || game.releaseDate,
        platforms: custom.platforms?.length ? custom.platforms : game.platforms,
        platform: custom.platforms?.length ? custom.platforms.join(', ') : game.platform,
    };
}

// ──────────────────────────────────────────
//  IN-MEMORY METADATA CACHE
//  Key: "${platform}:${cleanId}"  Value: { meta, timestamp }
//  TTL: 5 minutes — avoids redundant lookups when re-opening the same game.
// ──────────────────────────────────────────
const _gdMetaCache = new Map();
const _GD_META_CACHE_TTL = 5 * 60 * 1000; // 5 min

// In-flight deduplication: prevents two simultaneous lookupGameServer calls
// for the same cacheKey (e.g. same Epic game opened twice before first resolves).
const _gdInflightLookups = new Map(); // cacheKey → Promise<meta>

// Active DASH player instances: used to call player.destroy() on teardown
// so dash.js can gracefully cancel its internal pending play() before we pause.
const _gdActiveDashPlayers = new Map(); // videoId → dashjs player instance

function _gdCacheGet(key) {
    const entry = _gdMetaCache.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.timestamp > _GD_META_CACHE_TTL) {
        _gdMetaCache.delete(key);
        return undefined;
    }
    return entry.meta; // may be null (confirmed not-in-server)
}

function _gdCacheSet(key, meta) {
    _gdMetaCache.set(key, { meta, timestamp: Date.now() });
}

/**
 * Merges two metadata objects, giving preference to non-null visual asset fields
 * (heroImage, hero, cover, logo) from `base` when `override` carries explicit nulls.
 * All other fields follow standard spread semantics (override wins).
 */
function _gdMergeMetaSafe(base, override) {
    if (!override) return base;
    if (!base)     return override;
    const VISUAL_KEYS = ['heroImage', 'hero', 'cover', 'logo'];
    const merged = { ...base, ...override };
    for (const k of VISUAL_KEYS) {
        if (merged[k] == null && base[k] != null) {
            merged[k] = base[k]; // restore non-null base value that override wiped
        }
    }
    return merged;
}

// ──────────────────────────────────────────
//  ENRICH DEDUP / COOLDOWN
//  Prevents sending enrich for the same game multiple times per session.
//  Key: "${platform}:${cleanId}"   Value: timestamp of last enrich request
// ──────────────────────────────────────────
const _gdEnrichSent = new Map();
const _GD_ENRICH_COOLDOWN = 10 * 60 * 1000; // 10 min cooldown

function _gdShouldEnrich(key) {
    const last = _gdEnrichSent.get(key);
    if (!last) return true;
    return (Date.now() - last) > _GD_ENRICH_COOLDOWN;
}

function _gdMarkEnrichSent(key) {
    _gdEnrichSent.set(key, Date.now());
}

// Platform logos config (نفس اللي في app.js)
const GD_PLATFORM_LOGOS = {
    steam:   { img: '../assets/Steam.png',    name: 'Steam',        color: '#1b2838' },
    epic:    { img: '../assets/epic.svg',      name: 'Epic Games',   color: '#181818', invert: true },
    ea:      { img: '../assets/ea.png',        name: 'EA App',       color: '#ff6b35' },
    riot:    { img: '../assets/riot.png',      name: 'Riot Games',   color: '#ff4655' },
    ubisoft: { img: '../assets/ubisoft.png',   name: 'Ubisoft',      color: '#0070d1', invert: true },
    discord: { img: '../assets/discord.webp',  name: 'Discord',      color: '#5865F2' },
    rockstar:{ img: '../assets/rockstar.png',  name: 'Rockstar',     color: '#1a1100' },
};

function _gdHashStr(s) {
    let h = 2166136261;
    const str = String(s || 'Game');
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function _gdProceduralHeroLayers(name) {
    const h = _gdHashStr(name);
    const a = h % 360;
    const b = (a + 47 + ((h >> 8) % 34)) % 360;
    const c = (b + 52 + ((h >> 16) % 28)) % 360;
    const x1 = 12 + (h % 58);
    const y1 = 18 + ((h >> 4) % 42);
    const x2 = 62 - (h % 38);
    const y2 = 58 + ((h >> 12) % 28);
    return [
        `radial-gradient(ellipse 95% 75% at ${x1}% ${y1}%, hsla(${a}, 65%, 30%, 0.55) 0%, transparent 58%)`,
        `radial-gradient(ellipse 80% 65% at ${x2}% ${y2}%, hsla(${b}, 60%, 24%, 0.45) 0%, transparent 52%)`,
        `linear-gradient(158deg, hsl(${c}, 38%, 7%) 0%, hsl(${a}, 46%, 11%) 45%, hsl(${b}, 34%, 5%) 100%)`,
    ].join(', ');
}

function _gdProceduralCardBg(name) {
    const h = _gdHashStr(`${name}|card`);
    const a = h % 360;
    const b = (a + 38 + ((h >> 10) % 22)) % 360;
    return `linear-gradient(148deg, hsl(${a}, 52%, 18%) 0%, hsl(${b}, 46%, 9%) 100%)`;
}

function _gdClearProceduralHero() {
    const el = document.getElementById('gdHeroBg');
    if (!el) return;
    el.classList.remove('gd-procedural-art');
    el.style.backgroundSize = '';
}

function _gdApplyProceduralHero(gameName) {
    const el = document.getElementById('gdHeroBg');
    if (!el) return;
    el.classList.add('gd-procedural-art');
    el.style.backgroundImage = _gdProceduralHeroLayers(gameName);
}

function _gdClearProceduralCard() {
    const wrap = document.getElementById('gdCoverWrap');
    const ph = document.getElementById('gdCoverPlaceholder');
    if (wrap) wrap.classList.remove('gd-procedural-card');
    if (ph) ph.style.background = '';
}

function _gdApplyProceduralCard(gameName) {
    const wrap = document.getElementById('gdCoverWrap');
    const ph = document.getElementById('gdCoverPlaceholder');
    if (wrap) wrap.classList.add('gd-procedural-card');
    if (ph) {
        ph.style.background = _gdProceduralCardBg(gameName);
        ph.style.display = 'flex';
    }
}

// ──────────────────────────────────────────
//  EPIC NAMESPACE VALIDATOR
//  Epic namespaces are hex UUIDs (32 chars, e.g. 9773aa1aa54f4f7b80e44bef04986107)
//  or long slugs. Short plain-word strings like "Sugar" or "Discus" are appNames,
//  NOT namespaces — reject them so we never send the wrong ID to the server.
// ──────────────────────────────────────────
function _gdIsValidEpicNamespace(s) {
    if (!s || typeof s !== 'string') return false;
    // Must be at least 10 characters and contain only hex chars and hyphens
    // (covers both UUID format and plain 32-char hex namespaces)
    return s.length >= 10 && /^[a-f0-9\-]+$/i.test(s);
}


/**
 * Returns true when the meta object exists but is too sparse to give a good
 * Game Details experience — i.e. the fallback should be allowed to fill gaps.
 */
function _gdIsMetadataTooIncomplete(meta) {
    if (!meta) return true;
    const hasDescription = !!(meta.info?.description || meta.description);
    const hasCover       = !!(meta.cover);
    const hasHero        = !!(meta.heroImage || meta.hero);
    const hasScreenshots = (meta.info?.screenshots || []).length > 0;
    // "Incomplete" = missing description AND at least two of the three visual assets
    const missingVisuals = [hasCover, hasHero, hasScreenshots].filter(Boolean).length < 2;
    return !hasDescription && missingVisuals;
}

// ──────────────────────────────────────────
//  CANONICAL SERVER TARGET RESOLVER
//  Single source of truth for platform eligibility + external ID resolution.
//  Mirrors baddelApi.resolveInstalledServerTarget() for renderer use.
//
//  Returns:
//    { platform: 'steam', id: '<numeric appid>' }
//    { platform: 'epic',  id: '<CatalogNamespace hex UUID>' }
//    null  → local-only, no server call
// ──────────────────────────────────────────
function _gdResolveServerTarget(game) {
    if (!game) return null;

    // Normalize platform — may be an array (["epic","steam"]) or a comma/slash-separated
    // string ("epic, steam") when a game is owned on multiple storefronts.
    const rawPlatform = game.platform || '';
    const platList = Array.isArray(rawPlatform)
        ? rawPlatform.map(p => String(p).toLowerCase().trim()).filter(Boolean)
        : String(rawPlatform).split(/[\s,\/|]+/).map(p => p.toLowerCase().trim()).filter(Boolean);

    const STEAM_ALIASES = new Set(['steam', 'steam_app']);
    const EPIC_ALIASES  = new Set(['epic', 'epic games', 'epic_games']);

    for (const plat of platList) {
        // ── Steam ──────────────────────────────────────────────────────────
        if (STEAM_ALIASES.has(plat)) {
            let id = game.allIds?.steam ? String(game.allIds.steam).trim() : null;
            if (!id) {
                const stripped = String(game.id || '').replace(/^steam[-_]/i, '').trim();
                if (/^\d+$/.test(stripped)) id = stripped;
            }
            if (id) {
                console.log(`[GD][ServerTarget] ✓ Steam "${game.name}" → appid=${id}`);
                return { platform: 'steam', id };
            }
            console.warn(`[GD][ServerTarget] Steam token in "${game.platform}" — no valid appid, trying next.`);
            continue;
        }

        // ── Epic Games ─────────────────────────────────────────────────────
        if (EPIC_ALIASES.has(plat)) {
            // Precedence:
            //   1. game.allIds.epic  — canonical namespace written at scan time
            //   2. game.namespace    — raw manifest CatalogNamespace field
            //   3. game.id stripped  — only if it passes namespace validation
            // appName (e.g. 'Sugar', 'Discus') is NEVER used.
            const candidates = [
                game.allIds?.epic,
                game.namespace,
                String(game.id || '').replace(/^epic[-_]/i, ''),
            ].filter(Boolean);

            const id = candidates.find(c => _gdIsValidEpicNamespace(c)) || null;
            if (id) {
                console.log(`[GD][ServerTarget] ✓ Epic "${game.name}" → namespace=${id}`);
                return { platform: 'epic', id };
            }
            const rejected = candidates.join(', ') || '(none)';
            console.warn(`[GD][ServerTarget] Epic token in "${game.platform}" — no valid namespace [${rejected}], trying next.`);
            continue;
        }
    }

    // ── Unsupported platforms — local-only for this release ────────────────
    console.log(`[GD][ServerTarget] Platform "${game.platform}" is not Steam/Epic — local-only (no server call).`);
    return null;
}

// ──────────────────────────────────────────
//  GENERIC (NON-STEAM/EPIC/RIOT) METADATA LOOKUP RESOLVER
//  For Ubisoft, EA, Xbox/Store, Manual, and any other local platform.
//  Produces a { slug } or { title } query for a server lookup by name only.
//  Never uses platform/id model. Never calls requestGameEnrich.
// ──────────────────────────────────────────
function _gdResolveGenericMetadataLookup(game) {
    if (!game?.name) return null;

    // Derive a clean slug from the game title:
    //   lowercase → strip noisy punctuation → collapse whitespace → replace with hyphens
    const slug = game.name
        .toLowerCase()
        .trim()
        .replace(/['‘’ʼ＇`™®©]/g, '')  // strip typographic noise (incl. Unicode apostrophes)
        .replace(/[^a-z0-9\s\-]/g, ' ')    // non-alphanum → space
        .replace(/\s+/g, '-')              // spaces → hyphens
        .replace(/-{2,}/g, '-')            // collapse double hyphens
        .replace(/^-+|-+$/g, '');          // trim leading/trailing hyphens

    // Reject slugs that are too short or purely numeric (unreliable)
    if (slug && slug.length >= 3 && !/^\d+$/.test(slug)) {
        return { slug, title: game.name };  // carry both; slug tried first, title as fallback
    }

    // Slug too weak — fall back to title lookup only
    console.log(`[GD][GenericMeta] Slug too weak for "${game.name}" ("${slug}") — using title only`);
    return { title: game.name };
}

// ──────────────────────────────────────────
//  NOISY EXE / FOLDER NAME FILTER
//  Names that are too generic to use as metadata search candidates.
//  Also rejects anything that still contains a file extension suffix
//  (e.g. "acmirageexe" — caused by the old parser including the .exe in
//  the stem before stripping it).
// ──────────────────────────────────────────
const _GD_NOISY_STEMS = new Set([
    'launcher', 'game', 'win64', 'win32', 'shipping', 'retail',
    'binaries', 'bin', 'setup', 'uninstall', 'uninstaller', 'start',
    'play', 'client', 'anticheat', 'crashreporter', 'crash', 'host',
    'engine', 'editor', 'server', 'dedicated', 'redist', 'prereq',
    'directx', 'vcredist', 'dotnet', 'dx11', 'dx12', 'vulkan',
]);

function _gdIsNoisyStem(stem) {
    if (!stem) return true;
    const s = stem.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (s.length < 3) return true;
    // Reject anything that still ends with a known extension suffix
    if (/(?:exe|bat|lnk|url|cmd|vbs)$/.test(s)) return true;
    if (_GD_NOISY_STEMS.has(s)) return true;
    return false;
}

// ──────────────────────────────────────────
//  EXECUTABLE PATH EXTRACTOR
//
//  Robustly extracts the actual .exe path from whatever string is
//  stored in game.command or game.path.
//
//  Handles all real-world manual-game command shapes:
//    • Plain path:       D:\Games\ACMirage\ACMirage.exe
//    • Quoted path:      "D:\Games\ACMirage\ACMirage.exe"
//    • With arguments:   "D:\Games\ACMirage\ACMirage.exe" -dx12 --fullscreen
//    • cmd /c prefix:    cmd /c "D:\Games\ACMirage\ACMirage.exe"
//    • start prefix:     start "" "D:\Games\ACMirage\ACMirage.exe"
//    • .lnk / .bat:      D:\Games\ACMirage\ACMirage.lnk
//
//  Returns the clean filesystem path to the exe/shortcut, with:
//    • surrounding quotes stripped
//    • trailing arguments stripped
//    • normalised to forward-slashes
//  Returns null if nothing recognisable is found.
// ──────────────────────────────────────────
function _gdExtractExecutablePath(input) {
    if (!input || typeof input !== 'string') return null;

    // 1. Strip leading shell prefixes: cmd /c, start "", powershell -Command, etc.
    //    These appear before the actual exe path.
    let s = input.trim();
    s = s.replace(/^cmd\s+\/[ckCK]\s+/i, '');          // cmd /c or cmd /k
    s = s.replace(/^start\s+"[^"]*"\s+/i, '');          // start "" "path"
    s = s.replace(/^start\s+\S+\s+/i, '');              // start /wait "path"
    s = s.replace(/^powershell(?:\.exe)?\s+(?:-\w+\s+)*/i, '');

    // 2. Try to extract a quoted path first — the most reliable pattern.
    //    Matches the FIRST "..." token that contains a path separator.
    const quotedMatch = s.match(/"([^"]+(?:\\|\/)[^"]+\.(?:exe|bat|lnk|url|cmd|vbs))"/i);
    if (quotedMatch) {
        return quotedMatch[1].replace(/\\/g, '/');
    }

    // 3. Try an unquoted path: a token containing a path separator that ends
    //    in a known executable/shortcut extension.
    //    Stop at the first whitespace that follows the extension — everything
    //    after that is a command-line argument.
    const unquotedMatch = s.match(/([A-Za-z]:[^\s"]+\.(?:exe|bat|lnk|url|cmd|vbs))/i);
    if (unquotedMatch) {
        return unquotedMatch[1].replace(/\\/g, '/');
    }

    // 4. Last resort: if the whole trimmed string looks like a path (contains \
    //    or / and has a file extension), take it verbatim after stripping quotes.
    if (/[\\\/]/.test(s) && /\.\w{2,4}$/.test(s.replace(/"/g, ''))) {
        return s.replace(/"/g, '').trim().replace(/\\/g, '/');
    }

    return null;
}

// ──────────────────────────────────────────
//  MANUAL / CRACKED GAME METADATA CANDIDATE BUILDER
//
//  Produces an ordered, deduplicated list of search strings to try
//  for games where game.name may be a poor match (e.g. "ACMirage"
//  stored as the title, exe is ACMirage.exe, folder is
//  "Assassin's Creed Mirage").
//
//  Candidate order:
//    1. game.name + slug + aliases
//    2. exe filename stem (camelCase-split) + slug + aliases
//    3. parent folder name + slug + aliases
//
//  Returns { candidates: string[], exeStem: string|null, folderName: string|null }
// ──────────────────────────────────────────
async function _gdBuildManualMetadataCandidates(game) {
    const ordered  = [];
    const seen     = new Set();
    const gameName = (game.name || '').trim();

    const push = (val) => {
        if (!val) return;
        const v = val.trim();
        // Reject empty, already-seen, or noisy values
        if (!v || seen.has(v.toLowerCase())) return;
        if (_gdIsNoisyStem(v)) return;
        seen.add(v.toLowerCase());
        ordered.push(v);
    };

    // ── Inner helpers ─────────────────────────────────────────────────────────

    // Strip any file extension before processing a stem or folder name.
    // This is the key guard that prevents "ACMirage.exe" → "AC Mirage exe".
    const stripExt = (s) =>
        s.replace(/\.(exe|bat|lnk|url|cmd|vbs|sh|app)$/i, '').trim();

    // camelCase / PascalCase → spaced words; also replaces _ and - with spaces.
    const toSpaced = (s) => s
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .replace(/[_\-]+/g, ' ')
        .replace(/[^a-zA-Z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    // slug: lowercase, strip noise punctuation, spaces → hyphens
    const toSlug = (s) => s
        .toLowerCase()
        .replace(/[''`™®©]/g, '')
        .replace(/[^a-z0-9\s\-]/g, ' ')
        .replace(/\s+/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-+|-+$/g, '');

    // Aliases: nospaces, slug, acronym, AC-series variants
    const aliases = (name) => {
        const clean = name.toLowerCase().replace(/[^a-z0-9\s]/g, '');
        const words = clean.split(/\s+/).filter(w => w.length > 0);
        const out   = new Set();
        out.add(clean.replace(/\s+/g, ''));
        out.add(toSlug(name));
        if (words.length > 1) {
            out.add(words.map(w => w[0]).join(''));
            if (words[0] === 'assassins' && words[1] === 'creed') {
                out.add('ac' + words.slice(2).join(''));
                out.add('ac ' + words.slice(2).join(' '));
            }
        }
        return [...out].filter(a => a && a.length >= 3);
    };

    // ── Step 0: resolve the raw source and extract the clean exe path ─────────
    const rawSource = (game.path || game.command || '').trim();
    const exePath   = _gdExtractExecutablePath(rawSource);

    console.log(
        `[GD][ManualCandidates] source → game.path="${game.path || '—'}" | game.command="${(game.command || '').substring(0, 80)}${(game.command || '').length > 80 ? '…' : ''}" | exePath="${exePath || '—'}"`
    );

    // ── Step 1: game.name ─────────────────────────────────────────────────────
    push(gameName);
    push(toSlug(gameName));
    aliases(gameName).forEach(push);

    // ── Step 2: exe filename stem ─────────────────────────────────────────────
    let exeStem = null;
    if (exePath) {
        // basename: last segment after the final /
        const segments = exePath.split('/');
        const basename = segments[segments.length - 1] || '';
        // Always strip extension before any further processing
        const stemRaw  = stripExt(basename);

        if (stemRaw && !_gdIsNoisyStem(stemRaw)) {
            exeStem = toSpaced(stemRaw);
            if (!exeStem || _gdIsNoisyStem(exeStem)) exeStem = null;
        }

        console.log(
            `[GD][ManualCandidates] exe basename="${basename}" | stemRaw="${stemRaw}" | exeStem="${exeStem || '—'}"`
        );

        if (exeStem) {
            push(exeStem);
            push(toSlug(exeStem));
            aliases(exeStem).forEach(push);
        }
    } else if (rawSource && window.electronAPI?.getDynamicGameExes) {
        // exePath could not be parsed — try IPC folder scan as last resort.
        // Strip the exe filename from rawSource to get a folder path for the scan.
        const folderForScan = rawSource
            .replace(/"/g, '')
            .replace(/\\/g, '/')
            .replace(/\/[^/]+\.\w{2,4}$/, '')
            .trim();
        try {
            const exes = await window.electronAPI.getDynamicGameExes(game.id, folderForScan);
            for (const exe of (exes || [])) {
                const stemRaw = stripExt(exe);
                if (!_gdIsNoisyStem(stemRaw)) {
                    exeStem = toSpaced(stemRaw);
                    if (exeStem && !_gdIsNoisyStem(exeStem)) break;
                    exeStem = null;
                }
            }
        } catch (_) {}
        if (exeStem) {
            push(exeStem);
            push(toSlug(exeStem));
            aliases(exeStem).forEach(push);
        }
    }

    // ── Step 3: parent folder name ────────────────────────────────────────────
    //  dirname: everything before the last / in the clean exePath.
    //  Walk the dirname segments backwards to find the first non-noisy one.
    let folderName = null;
    const pathForFolder = exePath
        || rawSource.replace(/"/g, '').replace(/\\/g, '/').trim();

    if (pathForFolder) {
        // Strip the final filename segment (whether or not it ends in .exe)
        const withoutFile = pathForFolder.replace(/\/[^/]+$/, '');
        const parts = withoutFile.split('/').filter(Boolean);

        for (let i = parts.length - 1; i >= 0; i--) {
            const seg = parts[i];
            // Skip drive roots (C:), pure-numeric segments, and noisy names
            if (/^[a-z]:$/i.test(seg)) continue;
            if (/^\d+$/.test(seg))     continue;
            if (seg.length <= 2)       continue;
            // stripExt in case a folder name somehow ends in .exe etc.
            const segClean = stripExt(seg);
            if (_gdIsNoisyStem(segClean)) continue;
            // Keep the folder name as-is (preserves apostrophes, spaces, etc.)
            // toSpaced handles CamelCase-only folder names
            const candidate = /[A-Z]/.test(segClean) && !/\s/.test(segClean)
                ? toSpaced(segClean)
                : segClean;
            if (candidate && !_gdIsNoisyStem(candidate)) {
                folderName = candidate;
                break;
            }
        }
    }

    console.log(
        `[GD][ManualCandidates] parentFolder="${folderName || '—'}"`
    );

    if (folderName && folderName.toLowerCase() !== gameName.toLowerCase()) {
        push(folderName);
        push(toSlug(folderName));
        aliases(folderName).forEach(push);
    }

    // ── Final summary log ─────────────────────────────────────────────────────
    console.log(
        `[GD][ManualCandidates] game="${gameName}" | exeStem="${exeStem || '—'}" | folder="${folderName || '—'}" | candidates=[${ordered.join(', ')}]`
    );

    return { candidates: ordered, exeStem, folderName };
}

// ──────────────────────────────────────────
//  RIOT METADATA LOOKUP RESOLVER
//  Riot is local-first — this helper produces a slug or title for a
//  server lookup by name only. Never uses platform/id model.
//  Never calls requestGameEnrich or importGames for Riot.
//
//  Known mappings (hardened):
//    VALORANT           → slug 'valorant'
//    League of Legends  → slug 'league-of-legends'
//
//  Unknown Riot titles fall back to { title: game.name }.
// ──────────────────────────────────────────
function _gdResolveRiotMetadataLookup(game) {
    if (!game?.name) return null;

    const SLUG_MAP = {
        'valorant':          'valorant',
        'league of legends': 'league-of-legends',
    };

    const normalized = game.name.toLowerCase().trim().replace(/\s+/g, ' ');
    const slug = SLUG_MAP[normalized] || null;

    if (slug) {
        console.log(`[GD][RiotMeta] Known title "${game.name}" → slug="${slug}"`);
        return { slug };
    }

    console.log(`[GD][RiotMeta] Unknown Riot title "${game.name}" — fallback to title lookup`);
    return { title: game.name };
}

// ──────────────────────────────────────────
//  ENTRY POINT
// ──────────────────────────────────────────
/**
 * openGameDetails(gameId)
 * يفتح صفحة تفاصيل اللعبة - استدعيها من createGameCard أو أي مكان تاني
 */
window.openGameDetails = async function(gameId) {
    _gdCurrentGameId = String(gameId);

    // Capture the active view/filter state so Back can restore it exactly.
    const allGamesView   = document.getElementById('allGamesView');
    const mainScroller   = document.getElementById('mainContentArea');
    const scrollTop      = mainScroller?.scrollTop || 0;

    if (allGamesView && allGamesView.style.display !== 'none') {
        _gdPreviousView = 'allGames';
        _gdSavedFilterState = {
            platform:     window._agState?.platform     || 'all',
            account:      window._agState?.account      || 'all',
            accountLabel: document.getElementById('selectedAgAccountText')?.innerText || 'All Accounts',
            sort:         window._agState?.sort         || 'title_asc',
            search:       window._agState?.search       || '',
            scrollTop,
        };
    } else {
        // Read currentView from app.js (exposed as window.currentView via the global scope)
        const cv = typeof currentView !== 'undefined' ? currentView : 'home';
        _gdPreviousView = cv; // 'home' | 'installed' | 'collection'
        _gdSavedFilterState = {
            platform:     (typeof currentFilters !== 'undefined' ? currentFilters.platform     : null) || 'all',
            collectionId: (typeof currentFilters !== 'undefined' ? currentFilters.collectionId : null) || null,
            search:       (typeof currentFilters !== 'undefined' ? currentFilters.search       : null) || '',
            sort:         (typeof currentFilters !== 'undefined' ? currentFilters.sort         : null) || 'manual',
            scrollTop,
        };
    }

    // ── Mint view token immediately — every async step checks this ────────────
    const myToken = Symbol('gdView');
    _gdViewToken  = myToken;
    const _gdOpenStart = Date.now();
    const tokenStillValid = () => _gdViewToken === myToken;
    console.log('[GD-DIAG] mint token gameId=', _gdCurrentGameId, 'token=', myToken.toString(), 'prevExisted=', !!_gdViewToken);

  try {

    // ── Settle delay: if the user clicks through games rapidly, the token will
    // be stale after 250 ms and we exit without making a single server call.
    // 250 ms is imperceptible when the skeleton UI is already on screen.
    await new Promise(r => setTimeout(r, 250));
    if (!tokenStillValid()) return;

    // ── 0. Synced-game override: app.js sets this before calling openGameDetails
    //    for games that live in the synced library but not in the local DB.
    let game = null;
    if (window._gdSyncedGameOverride && String(window._gdSyncedGameOverride.id) === _gdCurrentGameId) {
        game = window._gdSyncedGameOverride;
        window._gdSyncedGameOverride = null;
    }

    // ── 1. Resolve game object: try in-memory caches first ───────────────────
    if (!game) {
        game = (typeof allGamesData !== 'undefined')
            ? allGamesData.find(g => String(g.id) === _gdCurrentGameId)
            : null;
    }

    if (!game && window._allGamesCache) {
        const cachedGame = window._allGamesCache.find(
            g => String(g.id || g.appName || g.title) === _gdCurrentGameId
        );
        if (cachedGame) {
            // KEY FIX: allIds.epic must be namespace, not appName
            const epicNs = cachedGame.namespace
                || (cachedGame.allIds?.epic && _gdIsValidEpicNamespace(cachedGame.allIds.epic)
                    ? cachedGame.allIds.epic : null);
            game = {
                id:            _gdCurrentGameId,
                name:          cachedGame.title,
                image:         cachedGame.coverUrl,
                heroImage:     cachedGame.heroUrl || cachedGame.heroImage || null,
                logo:          cachedGame.logoUrl || cachedGame.logo || null,
                platforms:     cachedGame.platforms || [cachedGame.platform],
                allIds:        { ...(cachedGame.allIds || {}), epic: epicNs },
                platform:      cachedGame.platforms ? cachedGame.platforms.join(', ') : cachedGame.platform,
                path:          null,
                command:       null,
                appName:       cachedGame.appName,
                namespace:     cachedGame.namespace,
                catalogItemId: cachedGame.catalogItemId,
                installedId:         cachedGame.installedId || null,
                customArtworkLocked: cachedGame.customArtworkLocked === true,
                artworkSource:       cachedGame.artworkSource || null,
                artworkUpdatedAt:    cachedGame.artworkUpdatedAt || null,
                coverUrl:            cachedGame.coverUrl || cachedGame.image || cachedGame.defaultImage || null,
                heroUrl:             cachedGame.heroUrl || cachedGame.heroImage || null,
                logoUrl:             cachedGame.logoUrl || cachedGame.logo || null,
            };
        }
    }

    // ── 2. Lightweight DB read — NO scan, NO library-updated event ───────────
    //    getGameById is a new IPC that reads getSavedGames() synchronously.
    if (!game) {
        try {
            const dbGame = window.electronAPI.getGameById
                ? await _gdWithTimeout(window.electronAPI.getGameById(_gdCurrentGameId), 5000, 'getGameById')
                : null;
            if (dbGame) game = dbGame;
        } catch (e) {
            console.warn('[GD] getGameById error:', e);
        }
    }

    // ── 3. Last resort: full getGames() — only if both caches missed ─────────
    //    Even this does not block the UI; we already showed the skeleton above.
    if (!game) {
        try {
            const stored = await _gdWithTimeout(window.electronAPI.getGames(), 8000, 'getGames');
            if (!tokenStillValid()) { console.warn('[GD-DIAG] stale-token bail gameId=', _gdCurrentGameId, 'at', new Error().stack?.split('\n')[1]?.trim()); return; }
            game = stored.find(g => String(g.id) === _gdCurrentGameId) || null;
        } catch (e) {
            console.warn('[GD] getGames fallback error:', e);
        }
    }

    if (!game) {
        console.warn('[GD] Game not found for ID:', _gdCurrentGameId);
        return;
    }

    // ── 4. Merge launch data (path/command) from allGamesData if absent ───────
    //    We do NOT call getGames() a second time — use what we already have.
    //    SAFETY: only merge from a record whose platform is compatible with the
    //    base game's platform.  Never cross-merge Riot with EA (or any other
    //    unrelated platform) just because the name string happens to match.
    if (!game.path && !game.command) {
        const installedMatch = (typeof window._agFindInstalledLocalMatch === 'function'
            ? window._agFindInstalledLocalMatch(game)
            : null) || _gdFindInstalledLocalMatch(game);
        if (installedMatch) {
            game = {
                ...game,
                path:                 installedMatch.path                 || game.path,
                command:              installedMatch.command              || game.command,
                launchCommand:        installedMatch.launchCommand        || game.launchCommand,
                executablePath:       installedMatch.executablePath       || game.executablePath,
                platform:             installedMatch.platform             || game.platform,
                scannerPlatform:      installedMatch.scannerPlatform      || game.scannerPlatform,
                installedId:          installedMatch.id                   || game.installedId,
                launcherGameId:       installedMatch.launcherGameId       || game.launcherGameId,
                appName:              installedMatch.appName              || game.appName,
                namespace:            installedMatch.namespace            || game.namespace,
                catalogItemId:        installedMatch.catalogItemId        || game.catalogItemId,
                allIds:               installedMatch.allIds               || game.allIds,
                // Playtime fields — carry the local installed record's tracked data so
                // game-details resolvers can find it even when game.id is a sync ID.
                localGameId:          installedMatch.id                   ?? game.localGameId,
                totalPlaytime:        installedMatch.totalPlaytime        ?? game.totalPlaytime,
                lastPlayed:           installedMatch.lastPlayed           ?? game.lastPlayed,
                lastQualifiedPlayed:  installedMatch.lastQualifiedPlayed  ?? game.lastQualifiedPlayed,
                playSessions:         installedMatch.playSessions         ?? game.playSessions,
                timeTrackingEnabled:  installedMatch.timeTrackingEnabled  ?? game.timeTrackingEnabled,
            };
        }
    }

    _gdCurrentBaseGame = typeof _gdClonePlain === 'function' ? _gdClonePlain(game) : { ...game };
    _gdCurrentCustomDetails = _gdLoadCustomDetails(game);
    if (_gdCurrentCustomDetails) game = _gdApplyCustomToGame(game, _gdCurrentCustomDetails);
    _gdCurrentGame = game;
    _gdCurrentMeta = null;
    _gdSetCreatorModeState('normal', { log: false });

    // ── Show the details view ─────────────────────────────────────────────────
    if (typeof _hideAllViews === 'function') _hideAllViews();
    const view = document.getElementById('gameDetailsView');
    view.style.display = 'block';
    view.scrollTop = 0;
    _gdResetUI();
    _gdPopulateBasic(game);
    _gdSyncCreatorChrome();
    if (_gdCurrentCustomDetails) {
        const customMeta = _gdBuildCustomMeta(game, _gdCurrentCustomDetails);
        _gdCurrentMeta = customMeta;
        _gdPopulateMeta(game, customMeta);
    }
    _gdSetAchievementsTabVisibility(game);
    _gdSetAccountsTabVisibility(game);

    // Achievements are independent of metadata — start immediately (Steam only)
    if (_gdCurrentGameId === String(game.id) && !_gdAchievementsLoaded && _gdHasSteamAchievements(game)) {
        _gdAchievementsLoaded = true;
        void _gdPopulateAchievements(game);
    }

    // ── 5. Metadata fetch with cache, dedup, and resilient error handling ─────
    try {
        let meta = null;
        // FIX B (hoisted): keep exeStem/folderName accessible for the entire try block,
        // including the getMetadata() fallback at the bottom — let inside the else block
        // would go out of scope before reaching that call.
        let _manualExeStem   = null;
        let _manualFolderName = null;

        const platLower = (game.platform || '').toLowerCase().trim();
        const isRiot    = platLower === 'riot games' || platLower === 'riot';

        // ── Riot: local-first, metadata by slug/title only ────────────────────
        // Riot does NOT use the Steam/Epic platform/id server model.
        // No requestGameEnrich, no importGames, no platform triple.
        if (isRiot) {
            console.log(`[GD] Riot local-first path selected for "${game.name}"`);
            const riotQuery = _gdResolveRiotMetadataLookup(game);
            if (riotQuery) {
                const cacheKey = `riot:${riotQuery.slug || riotQuery.title}`;
                const cached = _gdCacheGet(cacheKey);
                if (cached !== undefined) {
                    if (cached) { _gdCurrentMeta = cached; _gdPopulateMeta(game, cached); }
                    // _gdPopulateAccounts called by the outer finally block
                    return;
                }

                try {
                    if (riotQuery.slug) {
                        console.log(`[GD] Riot metadata lookup by slug="${riotQuery.slug}"`);
                    } else {
                        console.log(`[GD] Riot metadata lookup by title="${riotQuery.title}"`);
                    }
                    meta = await _gdWithTimeout(window.electronAPI.lookupGameServer(riotQuery), 10000, 'lookupGameServer(riot)');
                    if (!tokenStillValid()) { console.warn('[GD-DIAG] stale-token bail gameId=', _gdCurrentGameId, 'at', new Error().stack?.split('\n')[1]?.trim()); return; }
                    if (meta) {
                        _gdCacheSet(cacheKey, meta);
                    } else {
                        _gdMetaCache.delete(cacheKey);
                    }

                    if (meta) {
                        console.log(`[GD] Riot metadata hit for "${game.name}"`);
                        _gdPendingMetadataRetries.delete(String(game.id || _gdCurrentGameId || ''));
                        _gdCurrentMeta = meta;
                        _gdPopulateMeta(game, meta);
                    } else {
                        console.log(`[GD] Riot metadata miss for "${game.name}" — local-only retained`);
                    }
                } catch (riotErr) {
                    console.warn(`[GD] Riot metadata lookup error for "${game.name}":`, riotErr?.message || riotErr);
                    // Stay local-only — never show false error state for Riot
                }
            } else {
                console.log(`[GD] Riot metadata resolver returned null for "${game.name}" — local-only`);
            }
            // Riot never enters the Steam/Epic poll/enrich loop
            // _gdPopulateAccounts called by the outer finally block
            return;
        }

        // ── One canonical helper owns platform eligibility + ID resolution ────
        // Non-Steam/Epic platforms get null → local-only, no server call.
        const serverTarget = _gdResolveServerTarget(game);
        const platform     = serverTarget?.platform || null;
        const cleanedId    = serverTarget?.id       || null;
        const fullMetadataCacheId =
        platform === 'steam' && cleanedId
            ? `steam_${cleanedId}`
            : String(game.id || _gdCurrentGameId || '');

        if (platform && cleanedId) {
            console.log(`[GD] Server flow → platform=${platform} id=${cleanedId} game="${game.name}"`);
            const cacheKey = `${platform}:${cleanedId}`;

            // ── In-memory cache hit: render instantly, skip all network ───────
            const cached = _gdCacheGet(cacheKey);
            if (cached !== undefined) {
                if (cached) {
                    const preferredCached = _gdPreferLocalArtwork(game, cached);
                    _gdCurrentMeta = preferredCached;
                    _gdPopulateMeta(game, preferredCached);
                    return;
                }
                // null in cache = previously returned null, but null may be transient for Steam/Epic.
                // Remove it and fall through to a fresh lookup instead of treating it as a confirmed miss.
                _gdMetaCache.delete(cacheKey);
            }

            // ── Guard: if API is in 429 cooldown, skip the network entirely ─
            const _preCheckCooling = await window.electronAPI.isCooldownActive?.().catch(() => false);
            if (_preCheckCooling) {
                console.warn('[GD] 429 cooldown active before initial lookup — showing pending/retry for', game.name);
                _gdShowMetadataPendingAndRetry(game, 'cooldown');
                return;
            }
            
        } else {
            // ── Generic local platform: Ubisoft / EA / Xbox / Manual / etc. ─────
            // Steam/Epic returned null from _gdResolveServerTarget.
            // Try server lookup by slug/title — lookup only, no enrich/import.
            // For manual/cracked games we build a rich candidate list first so we
            // try exe-stem and parent-folder names before giving up.

            const platLowerGen = (game.platform || '').toLowerCase();
            const isManual = platLowerGen.includes('manual')
                || (!platLowerGen.includes('ubisoft')
                    && !platLowerGen.includes('ea')
                    && !platLowerGen.includes('xbox')
                    && !platLowerGen.includes('store')
                    && !platLowerGen.includes('gog')
                    && !platLowerGen.includes('battlenet')
                    && !platLowerGen.includes('rockstar')
                    && !platLowerGen.includes('riot')
                    && serverTarget === null);

            // Build ordered candidate list (rich for manual, basic for known platforms)
            let candidateList = [];
            // (_manualExeStem / _manualFolderName are hoisted to the outer try block)
            if (isManual && (game.path || game.command)) {
                console.log(`[GD][ManualMeta] Building rich candidate list for "${game.name}" (manual/cracked)`);
                const built = await _gdBuildManualMetadataCandidates(game);
                if (!tokenStillValid()) { console.warn('[GD-DIAG] stale-token bail gameId=', _gdCurrentGameId, 'at', new Error().stack?.split('\n')[1]?.trim()); return; }
                candidateList     = built.candidates;
                _manualExeStem    = built.exeStem;
                _manualFolderName = built.folderName;
            } else {
                // Known platforms: just use the standard generic resolver
                const genericQuery = _gdResolveGenericMetadataLookup(game);
                if (genericQuery?.slug) candidateList.push(genericQuery.slug);
                if (genericQuery?.title) candidateList.push(genericQuery.title);
            }

            console.log(
                `[GD][GenericMeta] "${game.name}" — trying ${candidateList.length} candidate(s): [${candidateList.join(', ')}]`
            );

            for (const candidate of candidateList) {
                if (meta) break;
                if (!tokenStillValid()) { console.warn('[GD-DIAG] stale-token bail gameId=', _gdCurrentGameId, 'at', new Error().stack?.split('\n')[1]?.trim()); return; }

                // Try as slug first (if it looks like a slug), then as title
                const looksLikeSlug = /^[a-z0-9\-]+$/.test(candidate) && candidate.includes('-');

                // ── Slug attempt ──────────────────────────────────────────────
                if (looksLikeSlug) {
                    const slugKey = `generic-slug:${candidate}`;
                    const slugCached = _gdCacheGet(slugKey);
                    if (slugCached !== undefined) {
                        if (slugCached) {
                            console.log(`[GD][GenericMeta] Cache hit (slug) for candidate="${candidate}"`);
                            meta = slugCached;
                            _gdCurrentMeta = meta;
                            _gdPopulateMeta(game, meta);
                        }
                        continue;
                    }
                    try {
                        console.log(`[GD][GenericMeta] Trying slug="${candidate}"`);
                        const slugMeta = await _gdWithTimeout(window.electronAPI.lookupGameServer({ slug: candidate }), 10000, `lookupGameServer(slug:${candidate})`);
                        if (!tokenStillValid()) { console.warn('[GD-DIAG] stale-token bail gameId=', _gdCurrentGameId, 'at', new Error().stack?.split('\n')[1]?.trim()); return; }
                        _gdCacheSet(slugKey, slugMeta);
                        if (slugMeta) {
                            console.log(`[GD][GenericMeta] ✓ HIT slug="${candidate}" for game="${game.name}"`);
                            meta = slugMeta;
                            _gdCurrentMeta = meta;
                            _gdPopulateMeta(game, meta);
                            break;
                        } else {
                            console.log(`[GD][GenericMeta] miss slug="${candidate}"`);
                        }
                    } catch (err) {
                        console.warn(`[GD][GenericMeta] slug lookup error for "${candidate}":`, err?.message || err);
                    }
                    continue;
                }

                // ── Title attempt ─────────────────────────────────────────────
                const titleKey = `generic-title:${candidate}`;
                const titleCached = _gdCacheGet(titleKey);
                if (titleCached !== undefined) {
                    if (titleCached) {
                        console.log(`[GD][GenericMeta] Cache hit (title) for candidate="${candidate}"`);
                        meta = titleCached;
                        _gdCurrentMeta = meta;
                        _gdPopulateMeta(game, meta);
                    }
                    continue;
                }
                try {
                    console.log(`[GD][GenericMeta] Trying title="${candidate}"`);
                    const titleMeta = await _gdWithTimeout(window.electronAPI.lookupGameServer({ title: candidate }), 10000, `lookupGameServer(title:${candidate})`);
                    if (!tokenStillValid()) { console.warn('[GD-DIAG] stale-token bail gameId=', _gdCurrentGameId, 'at', new Error().stack?.split('\n')[1]?.trim()); return; }
                    _gdCacheSet(titleKey, titleMeta);
                    if (titleMeta) {
                        console.log(`[GD][GenericMeta] ✓ HIT title="${candidate}" for game="${game.name}"`);
                        meta = titleMeta;
                        _gdCurrentMeta = meta;
                        _gdPopulateMeta(game, meta);
                        break;
                    } else {
                        console.log(`[GD][GenericMeta] miss title="${candidate}"`);
                    }
                } catch (err) {
                    console.warn(`[GD][GenericMeta] title lookup error for "${candidate}":`, err?.message || err);
                }
            }

            if (!meta) {
                console.log(`[GD][GenericMeta] All ${candidateList.length} candidate(s) missed for "${game.name}" — local-only`);
            }
        }

        // ── Fallback: local resolver only when we have nothing at all ─────────
        // ── Fallback: full metadata cache + getMetadata() enrichment ──────────
        // Triggered when:
        //   A) server found nothing (meta is still null), OR
        //   B) server found something but it's too incomplete
        if (!meta || _gdIsMetadataTooIncomplete(meta)) {
            if (!tokenStillValid()) { console.warn('[GD-DIAG] stale-token bail gameId=', _gdCurrentGameId, 'at', new Error().stack?.split('\n')[1]?.trim()); return; }

            // ── C. Check local persisted metadata cache first ─────────────────
            let cachedFallback = null;
            try {
                cachedFallback = await _gdWithTimeout(
                    window.electronAPI.loadFullMetadata(fullMetadataCacheId),
                    15000,
                    'loadFullMetadata'
                );
            } catch (e) {
                console.warn('[GD] loadFullMetadata timed out or failed for', game.id, '—', e?.message);
                cachedFallback = null;
            }
            if (!tokenStillValid()) { console.warn('[GD-DIAG] stale-token bail gameId=', _gdCurrentGameId, 'at', new Error().stack?.split('\n')[1]?.trim()); return; }
            const isHollowCachedFallback =
                cachedFallback &&
                (
                    cachedFallback._isArtOnly === true ||
                    (
                        !cachedFallback.info?.description &&
                        !cachedFallback.description &&
                        !cachedFallback.info?.short_description &&
                        !cachedFallback.quality?.sources?.text &&
                        !(cachedFallback.info?.screenshots || []).length
                    )
                );

            if (isHollowCachedFallback) {
                console.warn(`[GD] Ignoring hollow cached metadata for "${game.name}" cacheId=${fullMetadataCacheId}`);
                cachedFallback = null;
            }
            if (cachedFallback) {
                console.log(`[GD] ✅ Loaded persisted fallback metadata for "${game.name}" (gameId=${game.id})`);
                // Merge cached fallback with any partial server data we already have.
                // Use _gdMergeMetaSafe so a partial server payload with heroImage:null
                // does not overwrite a valid hero that the fallback already has.
                const merged = meta ? _gdMergeMetaSafe(cachedFallback, meta) : cachedFallback;
                if (!_gdCurrentMeta || _gdIsMetadataTooIncomplete(_gdCurrentMeta)) {
                    _gdCurrentMeta = merged;
                    _gdPopulateMeta(game, merged);
                }
                // Cache images locally and persist URLs back into the game DB entry.
                // Without the saveMetadata() call the hero banner stays blank on the
                // details page even when the cached fallback has a valid heroImage —
                // the game DB entry (which the card and details page read) is never updated.
                if (cachedFallback.cover || cachedFallback.hero || cachedFallback.heroImage || cachedFallback.logo) {
                    window.electronAPI.cacheAllAssets?.({
                        cover: cachedFallback.cover,
                        hero:  cachedFallback.heroImage || cachedFallback.hero,
                        logo:  cachedFallback.logo,
                    }, game.id)
                    .then(localAssets => {
                        // Persist local URLs (or remote fallback) back into the game DB
                        // so that the hero banner is stable across page re-opens.
                        window.electronAPI.saveMetadata(game.id, {
                            cover:            localAssets?.cover || cachedFallback.cover || null,
                            hero:             localAssets?.hero  || cachedFallback.heroImage || cachedFallback.hero || null,
                            logo:             localAssets?.logo  || cachedFallback.logo  || null,
                            artworkSource:    'server-details',
                            artworkUpdatedAt: Date.now(),
                        }, { source: 'server-details' }).catch(() => {});
                    })
                    .catch(() => {
                        // cacheAllAssets failed — still persist remote URLs directly
                        // so the hero is not left blank on next open.
                        window.electronAPI.saveMetadata(game.id, {
                            cover:            cachedFallback.cover || null,
                            hero:             cachedFallback.heroImage || cachedFallback.hero || null,
                            logo:             cachedFallback.logo  || null,
                            artworkSource:    'server-details',
                            artworkUpdatedAt: Date.now(),
                        }, { source: 'server-details' }).catch(() => {});
                    });
                }
            } else {
                // ── D. No local cache — call getMetadata() as full fallback ───
                console.log(`[GD] ${meta ? 'Server metadata too incomplete' : 'Server lookup missed'} for "${game.name}" — trying getMetadata() fallback`);
                let fallbackMeta = null;
                try {
                    const canonicalAllIds = {
                        ...(game.allIds || {}),
                        ...(platform && cleanedId ? { [platform]: cleanedId } : {}),
                    };

                    fallbackMeta = await _gdWithTimeout(window.electronAPI.getMetadata(game.name, {
                        id: cleanedId || game.id,
                        platform: platform || game.platform,
                        platforms: game.platforms,

                        // مهم جدًا لـ Epic/Steam
                        namespace: platform === 'epic' ? cleanedId : (game.namespace || undefined),
                        appid: platform === 'steam' ? cleanedId : (game.appid || game.appId || undefined),
                        allIds: canonicalAllIds,

                        command: game.command,
                        path: game.path,

                        existingCover: game.image || null,
                        existingHero:  game.heroImage || null,
                        existingLogo:  game.logo || null,

                        exeName:    _manualExeStem    || undefined,
                        folderName: _manualFolderName || undefined,
                        pathHint:   (game.path || game.command) || undefined,
                    }), 15000, 'getMetadata');
                } catch (_) { fallbackMeta = null; }
                if (!tokenStillValid()) { console.warn('[GD-DIAG] stale-token bail gameId=', _gdCurrentGameId, 'at', new Error().stack?.split('\n')[1]?.trim()); return; }

                if (fallbackMeta && !_gdIsMetadataTooIncomplete(fallbackMeta)) {
                    // ── E. Fallback hit — render + persist ────────────────────
                    console.log(`[GD] ✅ getMetadata() fallback HIT for "${game.name}" — populating full Game Details`);
                    _gdPendingMetadataRetries.delete(String(game.id || _gdCurrentGameId || ''));
                    const merged = meta ? _gdMergeMetaSafe(fallbackMeta, meta) : fallbackMeta;
                    if (!_gdCurrentMeta || _gdIsMetadataTooIncomplete(_gdCurrentMeta)) {
                        _gdCurrentMeta = merged;
                        _gdPopulateMeta(game, merged);
                    }

                    // Persist images as usual
                    if (fallbackMeta.cover || fallbackMeta.hero || fallbackMeta.logo) {
                        window.electronAPI.cacheAllAssets?.({
                            cover: fallbackMeta.cover,
                            hero:  fallbackMeta.heroImage || fallbackMeta.hero,
                            logo:  fallbackMeta.logo,
                        }, game.id)
                        .then(localAssets => {
                            window.electronAPI.saveMetadata(game.id, {
                                cover:            localAssets.cover,
                                hero:             localAssets.hero,
                                logo:             localAssets.logo,
                                artworkSource:    'server-details',
                                artworkUpdatedAt: Date.now(),
                            }, { source: 'server-details' }).catch(() => {});
                        })
                        .catch(() => {});
                    }

                    // Persist full structured metadata to dedicated cache.
                    // GUARD: never persist an art-only result — no description,
                    // no text source, and no screenshots means SGDB matched art
                    // by name but IGDB had no usable metadata (e.g. Microsoft Jigsaw).
                    // Persisting it would permanently cache a hollow payload.
                    const _artOnly = fallbackMeta._isArtOnly === true
                        || (!fallbackMeta.info?.description
                            && !fallbackMeta.quality?.sources?.text
                            && (fallbackMeta.info?.screenshots || []).length === 0);

                    if (_artOnly) {
                        console.warn(`[GD] ⚠ Skipping saveFullMetadata for "${game.name}" — art-only result (no description, no text source, no screenshots). Will not persist hollow payload.`);
                    } else {
                            window.electronAPI.saveFullMetadata(fullMetadataCacheId, game.name, game.platform, fallbackMeta)
                            .then(() => console.log(`[GD] ✅ Persisted fallback metadata for "${game.name}"`))
                            .catch(err => console.warn(`[GD] Failed to persist fallback metadata for "${game.name}":`, err?.message));
                    }

                } else {
                    // ── F. Fallback miss — stay local-only gracefully ─────────
                    console.log(`[GD] getMetadata() fallback MISS for "${game.name}" — checking pending state`);
                    const _gdIsLikelyServerPending = _gdIsLikelyMetadataPending(
                        game,
                        platform,
                        cleanedId,
                        fallbackMeta
                    );

                    // مهم جدًا:
                    // لو Steam/Epic ومعاه canonical ID، ممنوع نعرض No metadata.
                    // اعرض Pending + اعمل retry حتى لو عندك صورة/cover محلية فقط.
                    if (_gdIsLikelyServerPending) {
                        _gdCurrentMeta = null;
                        _gdShowMetadataPendingAndRetry(game, 'fallback-miss');
                    } else {
                        // غير Steam/Epic فقط: استخدم local text fallback لو موجود
                        if (!_gdCurrentMeta && fallbackMeta) {
                            _gdCurrentMeta = fallbackMeta;
                            _gdPopulateMeta(game, fallbackMeta);
                        }

                        if (!_gdCurrentMeta) {
                            const _cachedDesc    = game.info?.description || game.metadata?.description || game.description || null;
                            const _cachedGenres  = game.genres || game.info?.genres || game.metadata?.genres || null;
                            const _cachedDev     = game.developer || game.info?.developer || game.metadata?.developer || null;
                            const _cachedRating  = game.rating || game.info?.rating || null;

                            if (_cachedDesc || _cachedGenres || _cachedDev) {
                                console.log(`[GD] Using cached game text fields for "${game.name}" (no server metadata)`);

                                const _localFallback = {
                                    info: {
                                        description: _cachedDesc || '',
                                        genres:      Array.isArray(_cachedGenres) ? _cachedGenres : (_cachedGenres ? [_cachedGenres] : []),
                                        screenshots: [],
                                        allTrailers: [],
                                        rating:      _cachedRating || undefined,
                                    },
                                    cover:     game.image     || null,
                                    heroImage: game.heroImage || null,
                                    logo:      game.logo      || null,
                                    _isLocalTextFallback: true,
                                };

                                _gdCurrentMeta = _localFallback;
                                _gdPopulateMeta(game, _localFallback);
                            } else {
                                _gdRenderCreatorEmptyState(game);
                            }
                        }
                    }
                }
            }
        }
    } catch (e) {
        // IMPORTANT: a transient error (429, timeout, IPC queue full) must NOT
        // wipe the UI with "No Data". Only show a soft hint if we truly have
        // nothing rendered yet — never call _gdPopulateMeta(game, null).
        console.warn('[GD] metadata fetch error:', e?.message || e);
        console.error('[GD-DIAG] inner-catch fired gameId=', _gdCurrentGameId, 'tokenValid=', tokenStillValid(), 'hasMeta=', !!_gdCurrentMeta, 'elapsed=', Date.now() - _gdOpenStart, 'ms err=', e?.message, 'stack=', e?.stack);
        if (tokenStillValid() && !_gdCurrentMeta) {
            if (_gdIsLikelyMetadataPending(game, null, null, null)) {
                _gdShowMetadataPendingAndRetry(game, 'metadata-error');
            } else {
                _gdClearSkeletons();

                const _pendingNote = document.getElementById('gdShortDescText');
                if (_pendingNote) {
                    _pendingNote.textContent = 'Could not load metadata — please try again.';
                    const _pendingSection = document.getElementById('gdShortDescSection');
                    if (_pendingSection) _pendingSection.style.display = 'block';
                }
            }
        }
    } finally {
        // FINAL SAFETY NET: always runs — even if a bug or an unhandled rejection
        // escapes the catch above.  Guarantees that:
        //   1. _gdPopulateAccounts() is always called so the Accounts tab is never stuck.
        //   2. Skeleton placeholders are always cleared so future openGameDetails() calls
        //      start from a clean state and are not poisoned by a previous hung request.
        if (tokenStillValid()) {
            try { _gdPopulateAccounts(game); } catch (_) {}

            // لو اللعبة Steam/Epic أو multi-platform ولسه الميتاداتا بتتجهز،
            // ممنوع نعرض No metadata. اعرض Pending واعمل retry.
            if (!_gdHasUsableMeta(_gdCurrentMeta)) {
                if (_gdIsLikelyMetadataPending(game, null, null, null)) {
                    _gdShowMetadataPendingAndRetry(game, 'finally-no-usable-meta');
                } else {
                    _gdClearSkeletons();
                }
            }
        }
        console.log('[GD-DIAG] inner-finally elapsed=', Date.now() - _gdOpenStart, 'ms gameId=', _gdCurrentGameId, 'tokenValid=', tokenStillValid(), 'hasMeta=', !!_gdCurrentMeta);
    }
  } catch (fatal) {
        console.error('[GD-DIAG] openGameDetails FATAL gameId=', _gdCurrentGameId, 'tokenValid=', _gdViewToken === myToken, 'msg=', fatal?.message, 'stack=', fatal?.stack);
  }
};

// ──────────────────────────────────────────
//  NO-METADATA UI STATE
//  Called when ALL lookup paths (slug / title / getMetadata) fail.
//  Replaces skeleton placeholders with a friendly local-only message.
//  Keeps title, platform badge, cover/procedural art, playtime, last played.
// ──────────────────────────────────────────
function _gdRenderNoMetadataState(game) {
    console.log(`[GD] No metadata state requested for "${game?.name || '?'}"`);

    if (_gdIsLikelyMetadataPending(game, null, null, null)) {
        return _gdShowMetadataPendingAndRetry(game, 'no-metadata-state');
    }

    return _gdRenderCreatorEmptyState(game);
    // ── Info grid: replace skeleton rows with a single friendly message ───────
    const infoGrid = document.getElementById('gdInfoGrid');
    if (infoGrid) {
        infoGrid.innerHTML = `
            <div class="gd-no-meta-notice" style="
                grid-column: 1 / -1;
                display: flex;
                flex-direction: column;
                align-items: flex-start;
                gap: 6px;
                padding: 14px 16px;
                background: rgba(255,255,255,0.04);
                border: 1px solid rgba(255,255,255,0.08);
                border-radius: 10px;
                color: rgba(255,255,255,0.5);
                font-size: 0.82em;
            ">
                <span style="font-size:1.2em;">📂</span>
                <strong style="color:rgba(255,255,255,0.7);font-size:0.9em;">No metadata available yet</strong>
                <span>Try rescanning or renaming the game for a better match.</span>
            </div>
        `;
    }

    // ── Sidebar detail list: clear skeletons ──────────────────────────────────
    const detailList = document.getElementById('gdDetailList');
    if (detailList) {
        detailList.innerHTML = `
            <div class="gd-detail-row" style="color:rgba(255,255,255,0.35);font-size:0.8em;font-style:italic;">
                No details available
            </div>
        `;
    }

    // ── Hide trailer, ratings, screenshots sections ───────────────────────────
    const trailerSection = document.getElementById('gdTrailerSection');
    if (trailerSection) trailerSection.style.display = 'none';

    const ratingsBlock = document.getElementById('gdRatingBlock');
    if (ratingsBlock) ratingsBlock.style.display = 'none';

    const ratingsTabBtn = document.getElementById('gdTabBtn-ratings');
    if (ratingsTabBtn) ratingsTabBtn.style.display = 'none';

    const genresSection = document.getElementById('gdGenresSection');
    if (genresSection) genresSection.style.display = 'none';

    // Screenshots: only hide if empty
    const ssContainer = document.getElementById('gdScreenshots');
    if (ssContainer && ssContainer.querySelectorAll('img').length === 0) {
        ssContainer.innerHTML = '<div class="gd-no-media" style="opacity:0.4;">No screenshots available</div>';
    }

    // ── Short description: show the friendly hint there too ───────────────────
    const shortDescSection = document.getElementById('gdShortDescSection') || document.getElementById('gdShortDesc');
    const shortDescText    = document.getElementById('gdShortDescText');
    if (shortDescText) {
        shortDescText.textContent = 'No description available. This game was not matched in the metadata database.';
    }
    if (shortDescSection) shortDescSection.style.display = 'block';
}

function _gdRenderMetadataPendingState(game) {
    console.log(`[GD] Metadata pending state rendered for "${game?.name || '?'}"`);

    // لو المستخدم عامل custom page قبل كده، نسيبه يشوفها بدل شاشة الانتظار
    const custom = _gdLoadCustomDetails(game);
    if (custom) {
        return _gdRenderCreatorEmptyState(game);
    }

    const pendingHtml = `
        <div class="gd-empty-state">
            <div class="gd-empty-icon" aria-hidden="true">
                <svg viewBox="0 0 64 64" width="64" height="64" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="32" cy="32" r="22"/>
                    <path d="M32 18v14l9 6"/>
                </svg>
            </div>
            <div class="gd-empty-text">
                <h3>Metadata is being prepared</h3>
                <p>
                    We found this game on the platform, but its metadata and artwork are still being prepared.
                    Open it again shortly and the details should appear automatically.
                </p>
            </div>
        </div>`;

    const infoGrid = document.getElementById('gdInfoGrid');
    if (infoGrid) infoGrid.innerHTML = pendingHtml;

    const detailList = document.getElementById('gdDetailList');
    if (detailList) {
        detailList.innerHTML = `
            <div class="gd-detail-row gd-empty-detail-row">
                <span class="gd-detail-label">Metadata status</span>
                <span>Preparing...</span>
            </div>`;
    }

    const shortDescSection = document.getElementById('gdShortDescSection') || document.getElementById('gdShortDesc');
    const shortDescText = document.getElementById('gdShortDescText');

    if (shortDescText) {
        shortDescText.textContent = 'Game metadata is still being fetched from the server.';
    }

    if (shortDescSection) shortDescSection.style.display = 'block';

    const fullDescSection = document.getElementById('gdFullDescSection');
    if (fullDescSection) fullDescSection.style.display = 'none';

    const trailerSection = document.getElementById('gdTrailerSection');
    if (trailerSection) trailerSection.style.display = 'none';

    const ratingsBlock = document.getElementById('gdRatingBlock');
    if (ratingsBlock) ratingsBlock.style.display = 'none';

    const ratingsTabBtn = document.getElementById('gdTabBtn-ratings');
    if (ratingsTabBtn) ratingsTabBtn.style.display = 'none';

    const genresSection = document.getElementById('gdGenresSection');
    if (genresSection) genresSection.style.display = 'none';

    const ssContainer = document.getElementById('gdScreenshots');
    if (ssContainer && ssContainer.querySelectorAll('img').length === 0) {
        ssContainer.innerHTML = '<div class="gd-no-media" style="opacity:0.4;">Screenshots are being prepared</div>';
    }

    _gdClearSkeletons();
    _gdSyncCreatorChrome();
}

function _gdRenderCreatorEmptyState(game) {
    console.log(`[GD] Creator empty state rendered for "${game?.name || '?'}"`);
    const custom = _gdLoadCustomDetails(game);
    if (custom) {
        _gdCurrentCustomDetails = custom;
        const customGame = _gdApplyCustomToGame(game, custom);
        const customMeta = _gdBuildCustomMeta(customGame, custom);
        _gdCurrentGame = customGame;
        _gdCurrentMeta = customMeta;
        _gdPopulateBasic(customGame);
        _gdPopulateMeta(customGame, customMeta);
        return;
    }

    const emptyHtml = `
        <div class="gd-empty-state">
            <div class="gd-empty-icon" aria-hidden="true">
                <svg viewBox="0 0 64 64" width="64" height="64" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="8" y="14" width="48" height="36" rx="4"/>
                    <line x1="8" y1="22" x2="56" y2="22"/>
                    <line x1="20" y1="14" x2="20" y2="22"/>
                    <line x1="32" y1="32" x2="32" y2="42"/>
                    <line x1="27" y1="37" x2="37" y2="37"/>
                </svg>
            </div>
            <div class="gd-empty-text">
                <h3>No details for this game yet</h3>
                <p>We do not have metadata for this title. They may be added soon. In the meantime, you can create your own custom page or load one from a file.</p>
                <div class="gd-empty-actions">
                    <button class="gd-empty-creator-btn" onclick="gdOpenCreatorMode()">
                        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>
                        </svg>
                        Create Your Page
                    </button>
                    <button class="gd-empty-import-btn" onclick="gdImportCreatorPage()">
                        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                        Load Page Pack
                    </button>
                </div>
            </div>
        </div>`;

    const infoGrid = document.getElementById('gdInfoGrid');
    if (infoGrid) infoGrid.innerHTML = emptyHtml;

    const detailList = document.getElementById('gdDetailList');
    if (detailList) {
        detailList.innerHTML = `
            <div class="gd-detail-row gd-empty-detail-row">
                <span class="gd-detail-label">Custom page</span>
                <button class="gd-inline-link-btn" onclick="gdOpenCreatorMode()">Open Creator Mode</button>
            </div>`;
    }

    const trailerSection = document.getElementById('gdTrailerSection');
    if (trailerSection) trailerSection.style.display = 'none';
    const ratingsBlock = document.getElementById('gdRatingBlock');
    if (ratingsBlock) ratingsBlock.style.display = 'none';
    const ratingsTabBtn = document.getElementById('gdTabBtn-ratings');
    if (ratingsTabBtn) ratingsTabBtn.style.display = 'none';
    const genresSection = document.getElementById('gdGenresSection');
    if (genresSection) genresSection.style.display = 'none';

    const ssContainer = document.getElementById('gdScreenshots');
    if (ssContainer && ssContainer.querySelectorAll('img').length === 0) {
        ssContainer.innerHTML = '<div class="gd-no-media" style="opacity:0.4;">No screenshots available</div>';
    }

    // Hide short desc section — empty state lives only in infoGrid, never duplicated here
    const shortDescSection = document.getElementById('gdShortDescSection') || document.getElementById('gdShortDesc');
    if (shortDescSection) shortDescSection.style.display = 'none';

    // Hide full desc section — stale data guard
    const fullDescSection = document.getElementById('gdFullDescSection');
    if (fullDescSection) fullDescSection.style.display = 'none';

    _gdSyncCreatorChrome();
}

// ──────────────────────────────────────────
//  TRAILER TEARDOWN
// ──────────────────────────────────────────
function _gdTeardownTrailerMedia() {
    const trailerSection  = document.getElementById('gdTrailerSection');
    const trailerWrap     = trailerSection?.querySelector('.gd-trailer-wrap');
    const thumbsContainer = document.getElementById('gdTrailerThumbs');

    if (trailerWrap) {
        // Pause + detach all HTML5 video elements — but skip any that are
        // currently living inside the mini player (user chose to keep playing)
        trailerWrap.querySelectorAll('video').forEach(v => {
            if (window._gdMiniPlayer?.videoEl === v) return; // leave it alone
            // Destroy the DASH player first so it can cancel its pending play()
            // internally — prevents AbortError from rapid view switching.
            const dashId = v.dataset.gdDashId;
            if (dashId && _gdActiveDashPlayers.has(dashId)) {
                try { _gdActiveDashPlayers.get(dashId).destroy(); } catch (_) {}
                _gdActiveDashPlayers.delete(dashId);
            } else {
                try { v.pause(); } catch (_) {}
            }
            try { v.removeAttribute('src'); } catch (_) {}
            try { v.load(); } catch (_) {}
        });
        // Destroy webviews / iframes so Electron releases the renderer
        trailerWrap.querySelectorAll('webview, iframe').forEach(node => {
            try { node.remove(); } catch (_) {}
        });
        trailerWrap.innerHTML = '';
    }

    if (thumbsContainer) {
        thumbsContainer.innerHTML = '';
        thumbsContainer.style.display = 'none';
    }

    if (trailerSection) {
        trailerSection.style.display = 'none';
    }

    // Clear fallback screenshot-gallery globals tied to the trailer area
    window._gdSsImages     = [];
    window._gdSsCurrentIdx = 0;
}

// Expose so _hideAllViews() (app.js) can stop media when leaving via sidebar nav.
window._gdStopMediaOnNavAway = function() {
    _gdTeardownTrailerMedia();
};

/**
 * closeGameDetails()
 * زرار الـ Back
 */
window.closeGameDetails = function() {
    const view = document.getElementById('gameDetailsView');
    const _wasVisible = view && view.style.display !== 'none';
    console.log('[GD-DIAG] closeGameDetails INVALIDATING token wasVisible=', _wasVisible, 'prevToken=', _gdViewToken && _gdViewToken.toString(), 'stack=', new Error().stack);
    view.style.display = 'none';
    _gdCurrentGameId = null;
    _gdCurrentMeta   = null;
    _gdCurrentGame   = null;
    _gdCurrentBaseGame = null;
    _gdAchievementsLoaded = false;
    _gdViewToken = null;
    clearInterval(_gdDownloadInterval);
    _gdTeardownTrailerMedia();

    const saved = _gdSavedFilterState;
    const prev  = _gdPreviousView;

    if (prev === 'allGames') {
        if (typeof navigateToAllGames === 'function') navigateToAllGames({ restoreState: saved });

    } else if (prev === 'installed') {
        // Restore filter state, then navigate
        if (typeof currentFilters !== 'undefined' && saved) {
            currentFilters.platform     = saved.platform     || 'all';
            currentFilters.search       = saved.search        || '';
            currentFilters.sort         = saved.sort          || 'manual';
            currentFilters.collectionId = null;
            const searchEl = document.getElementById('searchInput');
            if (searchEl) searchEl.value = currentFilters.search;
            if (window.igUpdateSearchClear) window.igUpdateSearchClear();
            const platLabelEl = document.getElementById('igSelectedPlatformText');
            if (platLabelEl && currentFilters.platform === 'all') platLabelEl.textContent = 'All Platforms';
        }
        if (typeof navigateToInstalled === 'function') navigateToInstalled();
        if (saved?.scrollTop) {
            requestAnimationFrame(() => {
                const s = document.getElementById('mainContentArea');
                if (s) s.scrollTop = saved.scrollTop;
            });
        }

    } else if (prev === 'collection') {
        const collId = saved?.collectionId;
        if (collId && typeof filterByCollection === 'function') {
            filterByCollection(collId);
        } else if (typeof navigateToInstalled === 'function') {
            navigateToInstalled();
        }
        if (saved?.scrollTop) {
            requestAnimationFrame(() => {
                const s = document.getElementById('mainContentArea');
                if (s) s.scrollTop = saved.scrollTop;
            });
        }

    } else {
        // 'home' or anything unknown
        if (typeof navigateToHome === 'function') navigateToHome();
    }
};

// ──────────────────────────────────────────
//  ACHIEVEMENTS VISIBILITY HELPERS
// ──────────────────────────────────────────
function _gdHasSteamAchievements(game) {
    return !!_gdExtractSteamAppId(game);
}

function _gdSetAchievementsTabVisibility(game) {
    const achTabBtn =
        document.getElementById('gdTabBtn-achievements') ||
        document.querySelector('.gd-tab[data-tab="achievements"]');
    const achTabContent = document.getElementById('gdTab-achievements');
    const hasSteam      = _gdHasSteamAchievements(game);

    if (achTabBtn) achTabBtn.style.display = hasSteam ? '' : 'none';

    if (!hasSteam) {
        if (achTabBtn) achTabBtn.classList.remove('active');

        if (achTabContent) {
            achTabContent.style.display = 'none';
            achTabContent.classList.remove('active');
        }

        // Ensure Overview is the visible active tab
        const overviewBtn     = document.querySelector('.gd-tab[data-tab="overview"]');
        const overviewContent = document.getElementById('gdTab-overview');
        if (overviewBtn) overviewBtn.classList.add('active');
        if (overviewContent) {
            overviewContent.style.display = 'block';
            overviewContent.classList.add('active');
        }

        _gdAchievementsLoaded = false;
        const achList = document.getElementById('gdAchievementsList');
        if (achList) achList.innerHTML = '';
    }
}

// ──────────────────────────────────────────
//  ACCOUNTS TAB VISIBILITY
//  Show only for Steam and Epic — the two platforms with library-sync ownership data.
// ──────────────────────────────────────────
function _gdSetAccountsTabVisibility(game) {
    const accTabBtn     = document.querySelector('.gd-tab[data-tab="accounts"]');
    const accTabContent = document.getElementById('gdTab-accounts');
    const plats         = (window._baddelCanonicalPlatforms || function() { return ['manual']; })(game);
    const hasStoreAccount = plats.includes('steam') || plats.includes('epic');

    if (accTabBtn) accTabBtn.style.display = hasStoreAccount ? '' : 'none';

    if (!hasStoreAccount) {
        if (accTabBtn) accTabBtn.classList.remove('active');
        if (accTabContent) {
            accTabContent.style.display = 'none';
            accTabContent.classList.remove('active');
        }
        // Redirect to Overview if Accounts was the active tab
        const overviewBtn     = document.querySelector('.gd-tab[data-tab="overview"]');
        const overviewContent = document.getElementById('gdTab-overview');
        if (overviewBtn) overviewBtn.classList.add('active');
        if (overviewContent) {
            overviewContent.style.display = 'block';
            overviewContent.classList.add('active');
        }
    }
}

// ──────────────────────────────────────────
//  RESET
// ──────────────────────────────────────────
function _gdResetUI() {
    _gdAchievementsLoaded = false;
    _gdAchievementsGen++;

    // B#4: clear any stale "Could not load metadata — please try again." that
    // may have been written by a previous failed open. Without this, a sticky
    // notice can survive into the next open and appear to "cascade".
    const _gdStalePending = document.getElementById('gdShortDescText');
    if (_gdStalePending) _gdStalePending.textContent = '';
    const _gdStaleSection = document.getElementById('gdShortDescSection');
    if (_gdStaleSection) _gdStaleSection.style.display = 'none';

    // Reset tabs — hide achievements and accounts tabs by default; re-shown by visibility helpers
    const achTabBtn =
        document.getElementById('gdTabBtn-achievements') ||
        document.querySelector('.gd-tab[data-tab="achievements"]');
    if (achTabBtn) achTabBtn.style.display = 'none';
    const accTabBtnReset = document.querySelector('.gd-tab[data-tab="accounts"]');
    if (accTabBtnReset) accTabBtnReset.style.display = 'none';
    document.querySelectorAll('.gd-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.gd-tab-content').forEach(t => { t.style.display = 'none'; t.classList.remove('active'); });
    const firstTab = document.querySelector('.gd-tab[data-tab="overview"]');
    if (firstTab) { firstTab.classList.add('active'); }
    const firstContent = document.getElementById('gdTab-overview');
    if (firstContent) { firstContent.style.display = 'block'; firstContent.classList.add('active'); }

    // Reset download block
    document.getElementById('gdDownloadBlock').style.display = 'none';
    document.getElementById('gdPlayBtn').style.display = 'flex';
    clearInterval(_gdDownloadInterval);

    // Reset screenshots
    document.getElementById('gdScreenshots').innerHTML = '<div class="gd-no-media">Loading media…</div>';

    // Reset lightbox state — prevents stale images from a previous game leaking in
    _gdLightboxImages = [];
    _gdLightboxIndex  = 0;
    const _lbImgReset = document.getElementById('gdLightboxImg');
    if (_lbImgReset) _lbImgReset.src = '';

    // Reset accounts
    document.getElementById('gdAccountsList').innerHTML = '<div class="gd-no-accounts">Loading accounts…</div>';
    const gdAchievementsList = document.getElementById('gdAchievementsList');
    if (gdAchievementsList) {
        // نضع Skeletons للإنجازات بدل رسالة "Open this tab"
        const achSkeletons = Array(3).fill().map(() => `
            <div class="gd-ach-item">
                <div class="gd-skeleton" style="width:44px; height:44px; border-radius:4px;"></div>
                <div class="gd-ach-info">
                    <div class="gd-skeleton" style="width:120px; height:14px; margin-bottom:6px;"></div>
                    <div class="gd-skeleton" style="width:200px; height:12px;"></div>
                </div>
                <div class="gd-skeleton" style="width:80px; height:12px;"></div>
            </div>
        `).join('');
        gdAchievementsList.innerHTML = `
            <div class="gd-ach-card">
                <div class="gd-ach-head">
                    <div class="gd-skeleton" style="width:100px; height:14px;"></div>
                    <div class="gd-skeleton" style="width:40px; height:14px;"></div>
                </div>
                <div class="gd-ach-bar"><div class="gd-skeleton" style="width:100%; height:100%;"></div></div>
                <div class="gd-ach-items">${achSkeletons}</div>
            </div>
        `;
    }

    _gdClearProceduralCard();
    _gdClearProceduralHero();
    const heroBgReset = document.getElementById('gdHeroBg');
    if (heroBgReset) {
        heroBgReset.style.backgroundImage = 'none';
        heroBgReset.style.background = 'linear-gradient(135deg, #0f0f18, #1a1a28)';
    }

    // Reset short description
    const shortDescReset = document.getElementById('gdShortDesc');
    if (shortDescReset) shortDescReset.style.display = 'none';

    // Reset cover
    const coverImg = document.getElementById('gdCover');
    coverImg.style.display = 'none';
    coverImg.src = '';
    document.getElementById('gdCoverPlaceholder').style.display = 'flex';

    // Reset rating
    document.getElementById('gdRatingBlock').style.display = 'none';

    // 🚀 التعديل هنا: وضع Skeletons كـ placeholders في الأماكن اللي بتحمل
    
    // 1. Info Grid Skeleton
    const gridItems = Array(6).fill().map(() => `
        <div class="gd-info-item">
            <div class="gd-info-label"><div class="gd-skeleton" style="height:10px; width:40%; margin-bottom:0;"></div></div>
            <div class="gd-info-value"><div class="gd-skeleton" style="height:14px; width:80%; margin-top:4px;"></div></div>
        </div>
    `).join('');
    document.getElementById('gdInfoGrid').innerHTML = gridItems;

    // 2. Sidebar Details Skeleton
    const sidebarItems = Array(5).fill().map(() => `
        <div class="gd-detail-row">
            <span class="gd-detail-label"><div class="gd-skeleton" style="height:10px; width:60px; display:inline-block; margin:0;"></div></span>
            <span class="gd-detail-value"><div class="gd-skeleton" style="height:12px; width:80px; display:inline-block; margin:0;"></div></span>
        </div>
    `).join('');
    document.getElementById('gdDetailList').innerHTML = sidebarItems;
    const ratingsTabBtn = document.getElementById('gdTabBtn-ratings');
    if (ratingsTabBtn) ratingsTabBtn.style.display = 'none';

    document.getElementById('gdPlatformsRow').innerHTML = '';

    // Hide sections — tear down trailer media first to stop any playing audio/video
    _gdTeardownTrailerMedia();
    document.getElementById('gdGenresSection').style.display  = 'none';

    // Reset dynamically-created full description section to prevent stale data leaking between games
    const fullDescSectionReset = document.getElementById('gdFullDescSection');
    if (fullDescSectionReset) {
        fullDescSectionReset.style.display = 'none';
        const fullDescTextReset = document.getElementById('gdFullDescText');
        if (fullDescTextReset) fullDescTextReset.innerHTML = '';
    }

}

// Cross-ID playtime resolver for Game Details. Delegates to the shared window
// helper from game-card.js when loaded; otherwise applies the same priority chain
// locally so game-details works even when loaded standalone.
function _gdResolvePlaytimeForGame(game) {
    if (typeof window._agResolvePlaytimeRecordForGame === 'function') {
        return window._agResolvePlaytimeRecordForGame(game);
    }
    if (!game) return { key: null, data: null, localGame: null };
    const pd = typeof playtimeData !== 'undefined' ? playtimeData : {};
    const hit = (k) => {
        const key = k != null ? String(k) : null;
        return (key && pd[key]) ? { key, data: pd[key], localGame: null } : null;
    };
    const direct = hit(game.id) || hit(game.installedId) || hit(game.localGameId);
    if (direct) return direct;
    try {
        const localGame = (typeof _gdFindInstalledLocalMatch === 'function')
            ? _gdFindInstalledLocalMatch(game) : null;
        if (localGame?.id && pd[String(localGame.id)]) {
            return { key: String(localGame.id), data: pd[String(localGame.id)], localGame };
        }
    } catch {}
    return { key: null, data: null, localGame: null };
}

// ──────────────────────────────────────────
//  BASIC DATA (no API needed)
// ──────────────────────────────────────────
function _gdHasArtworkValue(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function _gdConfidenceFromMeta(metaData) {
    const raw = metaData?.quality?.confidence ?? metaData?.confidence ?? null;
    if (raw === null || raw === undefined || raw === '') return null;
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) return null;
    return numeric > 1 ? Math.max(0, Math.min(1, numeric / 100)) : Math.max(0, Math.min(1, numeric));
}

function _gdMetadataArtworkFromMeta(metaData) {
    if (!metaData || typeof metaData !== 'object') return null;
    const confidence = _gdConfidenceFromMeta(metaData);
    const verified = metaData.verified === true || metaData._serverData?.verified === true || (confidence !== null && confidence >= 0.75);
    return {
        cover: metaData.cover || metaData.image || null,
        hero: metaData.heroImage || metaData.hero || null,
        logo: metaData.logo || null,
        confidence,
        verified,
        updatedAt: metaData.updatedAt || metaData.artworkUpdatedAt || null,
    };
}

function _gdResolveArtworkForDisplay(game, metaData = null) {
    const adapter = window.BaddelGameDetailsArtworkAdapter;
    if (metaData?._creatorCustom && adapter?.legacyGameDetailsArtwork) {
        return adapter.legacyGameDetailsArtwork({ game, metaData });
    }
    const baseGame = _gdCurrentBaseGame || game || {};
    const legacyMeta = metaData?._creatorCustom ? null : metaData;
    const creatorDetails = metaData?._creatorCustom ? null : (_gdCurrentCustomDetails || _gdLoadCustomDetails(baseGame));

    if (!adapter || typeof adapter.resolveGameDetailsArtwork !== 'function') {
        return {
            cover: { value: game?.image || game?.coverUrl || game?.defaultImage || legacyMeta?.cover || null, source: 'legacy-fallback', reason: 'adapter unavailable' },
            hero: { value: game?.heroImage || game?.heroUrl || game?.defaultHero || legacyMeta?.heroImage || legacyMeta?.hero || null, source: 'legacy-fallback', reason: 'adapter unavailable' },
            logo: { value: game?.logo || game?.logoUrl || game?.defaultLogo || legacyMeta?.logo || null, source: 'legacy-fallback', reason: 'adapter unavailable' },
        };
    }

    try {
        return adapter.resolveGameDetailsArtwork({
            game: baseGame,
            settingsArtwork: adapter.explicitSettingsArtworkFromGame?.(baseGame) || null,
            creatorArtwork: adapter.creatorArtworkFromCustomDetails?.(creatorDetails) || null,
            metadataArtwork: _gdMetadataArtworkFromMeta(legacyMeta),
            metaData: legacyMeta,
        });
    } catch {
        return adapter.legacyGameDetailsArtwork({ game, metaData: legacyMeta });
    }
}

function _gdApplyArtworkDiagnostics(el, type, decision) {
    if (!el || !decision) return;
    el.dataset.artworkType = type;
    el.dataset.artworkSource = decision.source || '';
    el.dataset.artworkReason = decision.reason || '';
}

function _gdApplyResolvedArtworkToDom(game, metaData = null) {
    const art = _gdResolveArtworkForDisplay(game, metaData);
    const name = game?.name || game?.title || '';

    const logoEl = document.getElementById('gdLogo');
    const titleEl = document.getElementById('gdTitle');
    const logoSrc = art?.logo?.value || null;
    if (logoSrc && logoEl) {
        logoEl.onerror = function _gdLogoOnErrorResolved() {
            this.onerror = null;
            this.style.display = 'none';
            if (titleEl) titleEl.style.display = 'block';
        };
        logoEl.src = logoSrc;
        logoEl.style.display = 'block';
        if (titleEl) titleEl.style.display = 'none';
    } else {
        if (logoEl) {
            logoEl.onerror = null;
            logoEl.removeAttribute('src');
            logoEl.style.display = 'none';
        }
        if (titleEl) titleEl.style.display = 'block';
    }
    _gdApplyArtworkDiagnostics(logoEl, 'logo', art?.logo);

    const heroBg = document.getElementById('gdHeroBg');
    const heroSrc = art?.hero?.value || null;
    if (heroBg) heroBg.style.background = '';
    if (heroSrc && heroBg) {
        _gdClearProceduralHero();
        heroBg.style.backgroundImage = `url('${heroSrc.replace(/\\/g, '/')}')`;
    } else if (heroBg) {
        _gdApplyProceduralHero(name);
    }
    _gdApplyArtworkDiagnostics(heroBg, 'hero', art?.hero);

    const coverImg = document.getElementById('gdCover');
    const coverPlaceholder = document.getElementById('gdCoverPlaceholder');
    const coverSrc = art?.cover?.value || null;
    if (coverSrc && coverImg) {
        _gdClearProceduralCard();
        coverImg.onerror = function _gdCoverErrResolved() {
            this.onerror = null;
            this.style.display = 'none';
            _gdApplyProceduralCard(name);
            if (coverPlaceholder) coverPlaceholder.style.display = 'flex';
        };
        coverImg.src = coverSrc;
        coverImg.style.display = 'block';
        if (coverPlaceholder) coverPlaceholder.style.display = 'none';
    } else {
        if (coverImg) {
            coverImg.removeAttribute('src');
            coverImg.style.display = 'none';
        }
        _gdApplyProceduralCard(name);
        if (coverPlaceholder) coverPlaceholder.style.display = 'flex';
    }
    _gdApplyArtworkDiagnostics(coverImg, 'cover', art?.cover);

    return art;
}

function _gdPopulateBasic(game) {
    // Breadcrumb + title
    document.getElementById('gdBreadcrumbName').textContent = game.name;
    document.getElementById('gdTitle').textContent = game.name;
    document.getElementById('gdTitle').style.display = 'block';
    document.getElementById('gdLogo').style.display  = 'none';

    _gdApplyResolvedArtworkToDom(game, null);

    // Cover initials
    document.getElementById('gdCoverInitials').textContent =
        game.name ? game.name.substring(0, 2).toUpperCase() : '??';

    // Playtime stats — use cross-ID resolver so synced All Games entries find the
    // local installed record (which may have a different game.id).
    const _gdPResolved = _gdResolvePlaytimeForGame(game);
    const pData = _gdPResolved.data || { totalMinutes: 0, lastPlayed: null };

    const gdLastPlayedTs = typeof _agResolveLastPlayedTimestamp === 'function'
        ? _agResolveLastPlayedTimestamp(game)
        : pData.lastPlayed;

    document.getElementById('gdPlaytime').textContent  =
        (typeof formatPlaytime === 'function') ? formatPlaytime(pData.totalMinutes) : `${Math.floor((pData.totalMinutes||0)/60)}h`;
    document.getElementById('gdLastPlayed').textContent =
        (typeof formatLastPlayed === 'function') ? formatLastPlayed(gdLastPlayedTs) : 'Never';

    // Time-tracking toggle badge
    _gdRenderTimeTrackingToggle(game);

    // Platform badges
    _gdRenderPlatformBadges(game);

    // Product-type badge (title-keyword pass; upgraded by _gdPopulateMeta when metadata arrives).
    // Uses raw game.name — never a cleaned title — so variant suffixes are preserved.
    _gdApplyProductTypeBadge(game, null);

    // Play / Install button state
    _gdSetActionButton(game);

    // Basic details sidebar
    _gdBuildDetailList(game, null);
}

// ──────────────────────────────────────────
//  TIME TRACKING TOGGLE
// ──────────────────────────────────────────
function _gdRenderTimeTrackingToggle(game) {
    const row = document.getElementById('gdTimeTrackingRow');
    if (!row) return;

    const launchOpts = typeof window._gdBuildLaunchOptions === 'function'
        ? window._gdBuildLaunchOptions(game)
        : [];
    const isInstalled =
        !!(game?.path || game?.command || game?.launchCommand || game?.executablePath || game?.installPath || game?.isInstalled || game?.installVerified) ||
        (Array.isArray(launchOpts) && launchOpts.length > 0);

    if (!isInstalled) {
        row.innerHTML = '';
        row.style.display = 'none';
        return;
    }

    const isEnabled = !(game.timeTrackingEnabled === false);

    row.style.display = '';
    row.innerHTML = `
        <div class="gd-tracking-row">
            <div class="gd-tracking-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="8"></circle>
                    <path d="M12 8v4l3 2"></path>
                </svg>
            </div>
            <div class="gd-tracking-copy">
                <div class="gd-tracking-title">
                    Time Tracking
                    <span class="gd-tracking-pill ${isEnabled ? 'is-on' : 'is-off'}">${isEnabled ? 'ON' : 'OFF'}</span>
                </div>
            </div>
            <button class="gd-tracking-toggle${isEnabled ? ' is-destructive' : ''}"
                    onclick="_gdToggleTimeTracking('${game.id}', ${!isEnabled})">
                ${isEnabled ? 'Disable' : 'Enable'}
            </button>
        </div>
    `;
}

window._gdToggleTimeTracking = async function(gameId, enable) {
    if (!window.electronAPI?.setTimeTrackingEnabled) return;
    try {
        const res = await window.electronAPI.setTimeTrackingEnabled(gameId, enable);
        if (res && res.status === 'success') {
            if (_gdCurrentGame && String(_gdCurrentGame.id) === String(gameId)) {
                _gdCurrentGame.timeTrackingEnabled = enable;
                _gdRenderTimeTrackingToggle(_gdCurrentGame);
            }
            if (typeof showToast === 'function')
                showToast(enable ? 'Time tracking enabled for this game' : 'Time tracking disabled for this game', 'info');
        } else {
            const errMsg = (res && res.error) ? res.error : 'Unknown error';
            console.error('[GD] toggle time tracking failed:', errMsg);
            if (typeof showToast === 'function')
                showToast('Could not update time tracking setting', 'error');
        }
    } catch (e) {
        console.error('[GD] toggle time tracking error:', e);
        if (typeof showToast === 'function')
            showToast('Could not update time tracking setting', 'error');
    }
};

// ──────────────────────────────────────────
//  PLATFORM BADGES
// ──────────────────────────────────────────
function _gdRenderPlatformBadges(game) {
    const row = document.getElementById('gdPlatformsRow');
    row.innerHTML = '';

    const platforms = _gdDetectPlatforms(game);
    platforms.forEach(platKey => {
        const cfg = GD_PLATFORM_LOGOS[platKey];
        if (!cfg) return;
        const badge = document.createElement('div');
        badge.className = 'gd-plat-badge';
        const platFilters = {
            steam:    'none',
            epic:     'invert(1)',
            ea:       'none',
            riot:     'none',
            ubisoft:  'invert(1)',
            discord:  'none',
            rockstar: 'none',
        };
        badge.innerHTML = `
            <img src="${cfg.img}" alt="${cfg.name}"
                 style="width:18px;height:18px;object-fit:contain;flex-shrink:0;display:block;filter:${platFilters[platKey] || 'none'};">
            <span>${cfg.name}</span>
        `;
        row.appendChild(badge);
    });

    // Ensure the Content Pack badge element exists in the row (create once, reuse)
    let contentBadgeEl = document.getElementById('gdContentPackBadge');
    if (!contentBadgeEl) {
        contentBadgeEl = document.createElement('div');
        contentBadgeEl.id = 'gdContentPackBadge';
        contentBadgeEl.style.cssText = `
            display: none;
            align-items: center;
            gap: 5px;
            padding: 4px 10px;
            border-radius: 8px;
            font-size: 0.78em;
            font-weight: 600;
            letter-spacing: 0.04em;
            color: #f0c040;
            background: rgba(240, 192, 64, 0.12);
            border: 1px solid rgba(240, 192, 64, 0.35);
            cursor: default;
        `;
        contentBadgeEl.innerHTML = `
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
            </svg>
            <span>Content Pack</span>
        `;
        row.appendChild(contentBadgeEl);
    }
}

// ──────────────────────────────────────────
//  PRODUCT TYPE BADGE
// ──────────────────────────────────────────

// Visual config for each variant type returned by classifyProductVariant / entry_type.
const _GD_VARIANT_BADGE = {
    creator_kit:      { label: 'Creator Kit',      color: '#a78bfa' },
    dedicated_server: { label: 'Dedicated Server', color: '#60a5fa' },
    mod_kit:          { label: 'Mod Kit',           color: '#f59e0b' },
    playtest:         { label: 'Playtest',          color: '#60c0f0' },
    tool:             { label: 'Tool',              color: '#60c0f0' },
    trial:            { label: 'Trial',             color: '#34d399' },
    demo:             { label: 'Demo',              color: '#90e890' },
    alpha:            { label: 'Alpha',             color: '#f97316' },
    beta:             { label: 'Beta',              color: '#a0d0ff' },
    dlc:              { label: 'DLC',               color: '#f0c040' },
    mod:              { label: 'Mod',               color: '#f59e0b' },
    bundle:           { label: 'Bundle',            color: '#f0c040' },
    other:            { label: 'Other',             color: '#aaaaaa' },
};

/**
 * Returns { label, color } for the product-type badge, or null for normal base games.
 *
 * Priority:
 *   1. Authoritative server entry_type (when metaData is non-null).
 *      entry_type "game" → no badge. Any other value → badge.
 *   2. Raw title keyword fallback via window._baddelClassifyVariant.
 *      Uses game.name (raw) — never a cleaned/normalised title.
 *      If metadata says "game", the keyword result is suppressed.
 */
function _gdGetProductTypeBadge(game, metaData) {
    // 1. Server metadata is authoritative when present
    if (metaData) {
        const et = metaData.entry_type;
        if (et && et !== 'game') {
            // Map server entry_type values to our badge config keys
            const serverMap = { demo: 'demo', dlc: 'dlc', mod: 'mod', tool: 'tool', other: 'other' };
            const key = serverMap[et];
            return (key && _GD_VARIANT_BADGE[key]) ? _GD_VARIANT_BADGE[key] : _GD_VARIANT_BADGE.other;
        }
        // Server explicitly says "game" → no badge, regardless of title keywords
        if (et === 'game') return null;
    }

    // 2. Title-keyword fallback (only when metadata absent or has no entry_type)
    const classify = window._baddelClassifyVariant;
    if (typeof classify !== 'function') return null;
    const variantType = classify(game.name || '');
    if (variantType === 'main') return null;
    return _GD_VARIANT_BADGE[variantType] || _GD_VARIANT_BADGE.other;
}

/** Renders (or hides) the gdContentPackBadge element based on product type. */
function _gdApplyProductTypeBadge(game, metaData) {
    const el = document.getElementById('gdContentPackBadge');
    if (!el) return;
    const badge = _gdGetProductTypeBadge(game, metaData);
    if (badge) {
        el.style.display = 'inline-flex';
        el.style.color = badge.color;
        el.style.background = `${badge.color}18`;
        el.style.borderColor = `${badge.color}55`;
        const span = el.querySelector('span');
        if (span) span.textContent = badge.label;
        el.title = `Product type: ${badge.label}`;
    } else {
        el.style.display = 'none';
    }
}

// ──────────────────────────────────────────
//  PLATFORM-SAFE MERGE GUARD
//  Prevents cross-platform contamination when merging launch data.
//  Rules:
//    - ID match always allowed (same record, unambiguous)
//    - Steam  merges only with Steam
//    - Epic   merges only with Epic
//    - Riot   merges only with Riot
//    - Others: allowed only when platforms match exactly or are both unknown
// ──────────────────────────────────────────
function _gdCanMergeInstalledRecord(baseGame, candidate) {
    // ID match is always safe — same record regardless of platform
    if (String(candidate.id) === String(baseGame.id)) return true;

    const basePlat = (baseGame.platform || '').toLowerCase().trim();
    const candPlat = (candidate.platform || '').toLowerCase().trim();

    // Helper: normalise platform string to a canonical family
    const family = (p) => {
        if (p.includes('steam'))  return 'steam';
        if (p.includes('epic'))   return 'epic';
        if (p.includes('riot'))   return 'riot';
        if (p.includes('ea') || p.includes('origin')) return 'ea';
        if (p.includes('ubisoft'))  return 'ubisoft';
        if (p.includes('xbox') || p.includes('store')) return 'xbox';
        if (p.includes('manual'))   return 'manual';
        return p || 'unknown';
    };

    const baseFamily = family(basePlat);
    const candFamily = family(candPlat);

    const allowed = baseFamily === candFamily;
    if (!allowed) {
        console.warn(
            `[GD][MergeGuard] Blocked cross-platform merge: base="${baseGame.platform}" (${baseFamily}) ` +
            `← candidate="${candidate.platform}" (${candFamily}) name="${candidate.name}"`
        );
    }
    return allowed;
}

function _gdDetectPlatforms(game) {
    return (window._baddelCanonicalPlatforms || function() { return ['manual']; })(game);
}

// ── Riot product from command/path string (mirrors _agRiotProductFromStr in app.js) ─
function _gdRiotProductFromStr(str) {
    const s = (str || '').toLowerCase();
    if (s.includes('launch-product=valorant') ||
        s.includes('valorant-win64-shipping') ||
        (s.includes('riotclientservices') && s.includes('valorant'))) return 'valorant';
    if (s.includes('launch-product=league_of_legends') ||
        s.includes('leagueclient.exe') ||
        (s.includes('riotclientservices') && s.includes('league_of_legends'))) return 'league_of_legends';
    return null;
}

function _gdRiotAliases(key) {
    if (key === 'valorant')
        return new Set(['riot:valorant', 'valorant', 'val']);
    if (key === 'league_of_legends')
        return new Set(['riot:league_of_legends', 'riot:league', 'league_of_legends',
                        'leagueoflegends', 'league of legends', 'lol']);
    return new Set();
}

function _gdTitleToRiotProduct(title) {
    const t = (title || '').toLowerCase().replace(/[®©™]/g, '').replace(/\s+/g, ' ').trim();
    if (t === 'valorant') return 'valorant';
    if (t === 'league of legends' || t === 'league of legends live') return 'league_of_legends';
    return null;
}

function _gdIsMainGame(game) {
    const n = (game.name || game.title || '').toLowerCase();
    return !/\b(demo|dlc|pbe|public beta|open beta|editor|sdk|wallpaper|benchmark|soundtrack|ost|artbook|season pass|bonus|starter pack|trial|lite)\b|dedicated server|test server/.test(n);
}

// ── Find a matching installed record in allGamesData using stable identifiers ─
// Uses Epic appName/launcherGameId/catalogItemId, Steam appId, and Riot launch-product.
// Cross-platform title match allowed for main-game releases. Never Epic namespace alone.
function _gdFindInstalledLocalMatch(game) {
    if (typeof allGamesData === 'undefined') return null;

    const epicAppName  = game.appName        || null;
    const epicLgid     = game.launcherGameId  || null;
    const epicNs       = game.namespace       || null;
    const epicCatId    = game.catalogItemId   || null;
    const epicTuple    = (epicNs && epicCatId && epicAppName)
        ? `${epicNs}:${epicCatId}:${epicAppName}` : null;

    const steamId       = (game.allIds && game.allIds.steam) ? String(game.allIds.steam) : null;
    const steamFromSelf = (game.command || String(game.id || '')).match(/(\d{5,})/)?.[1] || null;

    const inRiotKey =
        _gdRiotProductFromStr(game.command || '') ||
        _gdRiotProductFromStr(game.launchCommand || '') ||
        _gdRiotProductFromStr(game.path || '') ||
        _gdTitleToRiotProduct(game.name || game.title || '') ||
        (game.allIds?.riot ? String(game.allIds.riot) : null);
    const inRiotSet = _gdRiotAliases(inRiotKey);
    const normSelf  = (game.name || '').toLowerCase().replace(/[®©™]/g, '').replace(/[:\-'']/g, ' ').replace(/\s+/g, ' ').trim();

    for (const g of allGamesData) {
        if (!g.path && !g.command) continue;

        // 1. Exact ID
        if (String(g.id) === String(game.id)) return g;
        // 2. installedId pointer
        if (game.installedId && String(g.id) === String(game.installedId)) return g;
        // 3. Epic: appName exact
        if (epicAppName && g.appName === epicAppName && _gdCanMergeInstalledRecord(game, g)) return g;
        // 4. Epic: "epic-${appName}" synthetic id
        if (epicAppName && g.id === `epic-${epicAppName}` && _gdCanMergeInstalledRecord(game, g)) return g;
        // 5. Epic: launcherGameId exact
        if (epicLgid && (g.launcherGameId === epicLgid || g.id === epicLgid) && _gdCanMergeInstalledRecord(game, g)) return g;
        // 6. Epic: full namespace:catalogItemId:appName tuple
        if (epicTuple && g.launcherGameId && (
            g.launcherGameId === epicTuple ||
            g.launcherGameId === epicTuple.replace(/:/g, '%3A')
        ) && _gdCanMergeInstalledRecord(game, g)) return g;
        // 7. Steam: appId from allIds.steam
        if (steamId) {
            const gSteamId = g.allIds && g.allIds.steam ? String(g.allIds.steam) : null;
            const gFromCmd = (g.command || String(g.id || '')).match(/(\d{5,})/)?.[1] || null;
            if (((gSteamId && gSteamId === steamId) || (gFromCmd && gFromCmd === steamId))
                && _gdCanMergeInstalledRecord(game, g)) return g;
        }
        // 8. Steam: numeric app id parsed from this game's own command/id
        if (steamFromSelf && steamFromSelf !== steamId) {
            const gFromCmd = (g.command || String(g.id || '')).match(/(\d{5,})/)?.[1] || null;
            if (gFromCmd && gFromCmd === steamFromSelf && _gdCanMergeInstalledRecord(game, g)) return g;
        }
        // 9. Riot product alias intersection (cross-platform OK)
        if (inRiotSet.size > 0) {
            const candRiotKey = _gdRiotProductFromStr(g.command || '') ||
                _gdRiotProductFromStr(g.path || '') ||
                _gdRiotProductFromStr(g.executablePath || '') ||
                _gdRiotProductFromStr(g.launchCommand || '');
            if (candRiotKey) {
                const candRiotSet = _gdRiotAliases(candRiotKey);
                for (const a of inRiotSet) { if (candRiotSet.has(a)) return g; }
            }
        }
        // 10. Normalized title: same-platform (strict) OR cross-platform for main-game releases
        const gNorm = (g.name || '').toLowerCase().replace(/[®©™]/g, '').replace(/[:\-'']/g, ' ').replace(/\s+/g, ' ').trim();
        if (gNorm && normSelf && gNorm === normSelf) {
            if (_gdCanMergeInstalledRecord(game, g)) return g;
            if (_gdIsMainGame(game) && _gdIsMainGame(g)) return g;
        }
    }
    return null;
}

// ── Launch option label from local installed record ───────────────────────────
function _gdLaunchOptionLabel(option) {
    const plat = (option.scannerPlatform || option.platform || '').toLowerCase();
    if (plat.includes('steam'))                        return 'Play with Steam';
    if (plat.includes('epic'))                         return 'Play with Epic';
    if (plat.includes('ea') || plat.includes('origin')) return 'Play with EA';
    if (plat.includes('riot'))                         return 'Play with Riot';
    if (plat.includes('ubisoft'))                      return 'Play with Ubisoft';
    if (plat.includes('xbox') || plat.includes('microsoft')) return 'Play with Xbox';
    if (plat.includes('discord'))                      return 'Play with Discord';
    if (plat.includes('rockstar'))                     return 'Play with Rockstar';
    // Infer from command/path when platform string is missing/generic
    const cmd = (option.command || option.path || '').toLowerCase();
    if (cmd.includes('steam://'))                      return 'Play with Steam';
    if (cmd.includes('com.epicgames') || cmd.includes('epicgames')) return 'Play with Epic';
    if (cmd.includes('origin') || cmd.includes('eaapp') || cmd.includes('ea app')) return 'Play with EA';
    if (cmd.includes('riotclient') || cmd.includes('valorant') || cmd.includes('league_of_legends')) return 'Play with Riot';
    if (cmd.includes('ubisoft'))                       return 'Play with Ubisoft';
    return 'Play locally';
}

// ── Build installed-only launch options for the Play modal ────────────────────
// Each option = a local installed record with path or command.
// Only records that are actually installed locally are returned.
function _gdBuildLaunchOptions(game) {
    const opts     = [];
    const seenIds  = new Set();
    const seenPaths = new Set();

    function add(record) {
        if (!record || (!record.path && !record.command)) return;
        if (seenIds.has(record.id)) return;
        const pathKey = (record.path || record.command || '').toLowerCase().trim();
        if (pathKey && seenPaths.has(pathKey)) return;
        seenIds.add(record.id);
        if (pathKey) seenPaths.add(pathKey);
        opts.push({
            id:              record.id,
            installedId:     record.id,
            name:            record.name            || game.name,
            platform:        record.platform        || game.platform,
            scannerPlatform: record.scannerPlatform || '',
            path:            record.path            || null,
            command:         record.command         || null,
            launchCommand:   record.launchCommand   || null,
            executablePath:  record.executablePath  || null,
            appName:         record.appName         || game.appName         || null,
            launcherGameId:  record.launcherGameId  || game.launcherGameId  || null,
            namespace:       record.namespace       || game.namespace       || null,
            catalogItemId:   record.catalogItemId   || game.catalogItemId   || null,
            allIds:          record.allIds          || game.allIds          || null,
            label:           _gdLaunchOptionLabel(record),
        });
    }

    // 1. Game itself if it already has path/command (merged installed record)
    if (game.path || game.command) add(game);

    // 2. All matching local installed records
    const matches = (typeof window._agFindInstalledLocalMatches === 'function')
        ? window._agFindInstalledLocalMatches(game)
        : [];
    for (const m of matches) add(m);

    // 3. Fallback: single-match if nothing found yet
    if (opts.length === 0) {
        const m = _gdFindInstalledLocalMatch(game);
        if (m) add(m);
    }

    return opts;
}
window._gdBuildLaunchOptions = _gdBuildLaunchOptions;

// ──────────────────────────────────────────
//  ACTION BUTTON (Play / Install)
// ──────────────────────────────────────────
function _gdSetActionButton(game) {
    const btn = document.getElementById('gdPlayBtn');
    const label = document.getElementById('gdPlayBtnLabel');
    const playIcon = btn.querySelector('.gd-play-icon'); // 🟢 بنمسك أيقونة اللعب من هنا

    const isInstalled = !!(game.path || game.command);

    if (isInstalled) {
        // حالة اللعب
        btn.classList.remove('install-mode');
        label.textContent = 'PLAY';
        btn.title = 'Launch game';
        if (playIcon) playIcon.style.display = 'inline-block'; // 🟢 إظهار أيقونة البلاي
    } else {
        // حالة التحميل
        btn.classList.add('install-mode');
        label.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>INSTALL`;
        btn.title = 'Install game';
        if (playIcon) playIcon.style.display = 'none'; // 🟢 إخفاء أيقونة البلاي عشان متظهرش مع أيقونة التحميل
    }
}

// ──────────────────────────────────────────
//  ACTION BUTTON (Play / Install)
// ──────────────────────────────────────────
window.gdHandleMainAction = async function() {
    if (!_gdCurrentGame) {
        if (typeof showToast === 'function') showToast("No game selected!", "error");
        return;
    }

    // بنعرف هي متسطبة ولا لأ من وجود path أو command
    const isInstalled = !!(_gdCurrentGame.path || _gdCurrentGame.command);

    if (isInstalled) {
        // 🎮 حالة الـ PLAY
        // console.log("🚀 Opening Play Launcher for:", _gdCurrentGame.name);

        // 🟢 نستخدم الـ ID بتاع النسخة المتسطبة (لو موجود) عشان يتشغل صح بدون مشاكل
        const gameToLaunch = { ..._gdCurrentGame };
        if (gameToLaunch.installedId) {
            gameToLaunch.id = gameToLaunch.installedId;
        }

        if (typeof window.openPlayLauncher === 'function') {
            window.openPlayLauncher(gameToLaunch);
        } else {
            // Fallback
            if (typeof triggerLaunchSequence === 'function') {
                triggerLaunchSequence(gameToLaunch.id);
            } else if (window.electronAPI && window.electronAPI.launchGame) {
                window.electronAPI.launchGame(gameToLaunch.id);
            }
        }

    } else {
        // ⬇️ حالة الـ INSTALL
        // console.log("📥 Install picker for:", _gdCurrentGame.name);
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
        _gdOpenInstallPicker(_gdCurrentGame);
    }
};

// ──────────────────────────────────────────
//  INSTALL PICKER MODAL
// ──────────────────────────────────────────

let _gdInstallSelectedAccountUsername = null;
let _gdInstallSelectedAccountName     = null;
let _gdInstallSelectedActionStatus    = null;
let _gdInstallConfirmInFlight         = false;


// ── Install-picker artwork resolver ──────────────────────────────────────────
// Walks every possible location where poster/hero art may live on a Ready-to-
// Install game object coming from the roulette / synced-suggestions pipeline:
//   direct fields → _raw fields → roulette-resolved fields → _suggArtCache
//   → disk cache via getCachedImage.
// Returns { poster, hero } where either may be null.

function _gdIsUsableImageUrl(url) {
    if (!url || typeof url !== 'string') return null;
    const s = url.replace(/\\/g, '/').trim();
    if (!s || ['null', 'undefined', 'none'].includes(s.toLowerCase())) return null;
    if (s.startsWith('http://') || s.startsWith('https://') ||
        s.startsWith('file://') || s.includes('/')) return s;
    return null;
}

function _gdPickInstallPoster(game) {
    const raw = game._raw || game;
    const candidates = [
        game._roulettePosterUrl,
        game.image, game.defaultImage, game.coverUrl,
        game.capsuleImage, game.boxArt, game.grid,
        raw.image, raw.defaultImage, raw.coverUrl,
        raw.capsuleImage, raw.boxArt, raw.grid,
    ];
    for (const u of candidates) { const v = _gdIsUsableImageUrl(u); if (v) return v; }
    return null;
}

function _gdPickInstallHero(game) {
    const raw = game._raw || game;
    const candidates = [
        game._rouletteHeroUrl,
        game.heroImage, game.defaultHero, game.heroUrl, game.background,
        raw.heroImage, raw.defaultHero, raw.heroUrl, raw.background,
    ];
    for (const u of candidates) { const v = _gdIsUsableImageUrl(u); if (v) return v; }
    return null;
}

// Optionally consults _suggArtCache (exposed as window._suggArtCacheGet) and
// the disk cache via getCachedImage.  Must be awaited; bounded to ~400 ms.
async function _gdResolveInstallArtwork(game) {
    let poster = _gdPickInstallPoster(game);
    let hero   = _gdPickInstallHero(game);

    if (poster && hero) return { poster, hero };

    // Try _suggArtCache (app.js exposes the getter as window._suggArtCacheGet
    // and the key builder as window._suggKey, or we derive the key ourselves).
    try {
        const platform = game._platform || game.platform || (game._raw && game._raw._platform) || '';
        const id       = String(game.id || '');
        const cacheKey = platform && id ? `${platform}:${id}` : null;
        if (cacheKey && typeof window._suggArtCacheGet === 'function') {
            const cached = window._suggArtCacheGet(cacheKey);
            if (!poster && cached && cached.poster) poster = _gdIsUsableImageUrl(cached.poster);
            if (!hero   && cached && cached.hero)   hero   = _gdIsUsableImageUrl(cached.hero);
        }
    } catch (_) {}

    if (poster && hero) return { poster, hero: hero || poster };

    // Last resort: disk cache.  Skip if we already have both or no electronAPI.
    if (window.electronAPI && window.electronAPI.getCachedImage) {
        const id = String(game.id || '');
        if (id) {
            const timeout = new Promise(r => setTimeout(() => r(null), 400));
            if (!poster) {
                poster = _gdIsUsableImageUrl(
                    await Promise.race([window.electronAPI.getCachedImage(id, 'cover').catch(() => null), timeout])
                );
            }
            if (!hero) {
                hero = _gdIsUsableImageUrl(
                    await Promise.race([window.electronAPI.getCachedImage(id, 'hero').catch(() => null), timeout])
                );
            }
        }
    }

    // If hero still missing but poster exists, use poster as background fallback
    return { poster: poster || null, hero: hero || poster || null };
}

function _gdInstallPlatformLabel(platform) {
    const map = { steam: 'Steam', epic: 'Epic Games', ea: 'EA', riot: 'Riot', ubisoft: 'Ubisoft' };
    const key = String(platform || '').toLowerCase();
    return map[key] || (key.charAt(0).toUpperCase() + key.slice(1));
}

async function _gdOpenInstallPicker(game) {
    document.getElementById('gdInstallerModal')?.remove();

    // 1. كشف المنصات المتاحة للعبة (ستيم وإيبك فقط للتحميل حالياً)
    const detectedPlats = _gdDetectPlatforms(game).filter(p => p === 'epic' || p === 'steam');

    if (detectedPlats.length === 0) {
        _gdSimulateDownload();
        return;
    }

    // 2. اختيار أول منصة كافتراضي
    _gdInstallSelectedPlatform = detectedPlats[0];
    _gdInstallSelectedAccountId = null;

    // Resolve best available poster + hero across all candidate fields / caches.
    const _art   = await _gdResolveInstallArtwork(game);
    const _poster = _art.poster || '';
    const _hero   = _art.hero   || '';
    const coverHtml = _poster ? `<img class="pl-game-cover" src="${_poster.replace(/\\/g, '/')}" alt="${game.name}">` : '';
    const heroBg = _hero;

    // 3. بناء صف المنصات لو اللعبة متوفرة في أكتر من منصة
    //    platformsHtml = CHOOSE PLATFORM section only — no account IDs here.
    let platformsHtml = '';
    if (detectedPlats.length > 1) {
        const platformCards = detectedPlats.map(p => {
            const cfg = GD_PLATFORM_LOGOS[p] || {};
            const isSelected = p === _gdInstallSelectedPlatform;
            const logoHtml = cfg.img
                ? `<img src="${cfg.img}" alt="${cfg.name || p}" ${cfg.invert ? 'style="filter:invert(1) brightness(1.1)"' : ''}>`
                : `<span style="font-size:1.1em;font-weight:700;">${_gdInstallPlatformLabel(p)}</span>`;
            return `
                <button class="gd-inst-plat-card${isSelected ? ' selected' : ''}" data-plat="${p}" title="${cfg.name || _gdInstallPlatformLabel(p)}">
                    <div class="gd-inst-plat-logo">${logoHtml}</div>
                    <span class="gd-inst-plat-name">${cfg.name || _gdInstallPlatformLabel(p)}</span>
                </button>`;
        }).join('');
        platformsHtml = `
            <div class="pl-section">
                <div class="pl-section-header">
                    <div class="pl-step-badge">1</div>
                    <span class="pl-section-title">CHOOSE PLATFORM</span>
                </div>
                <div class="gd-inst-plat-row" id="gdInstPlatformsRow">
                    ${platformCards}
                </div>
            </div>
        `;
    }

    const accountStepNum = detectedPlats.length > 1 ? '2' : '1';

    const modal = document.createElement('div');
    modal.id        = 'gdInstallerModal';
    modal.className = 'pl-backdrop';
    modal.innerHTML = `
        <style>
            .gd-inst-plat-row {
                display: flex;
                gap: 10px;
                flex-wrap: wrap;
                padding: 6px 0 10px;
            }
            .gd-inst-plat-card {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                gap: 8px;
                width: 108px;
                min-height: 80px;
                padding: 14px 10px 12px;
                border-radius: 10px;
                border: 1.5px solid rgba(255,255,255,0.10);
                background: rgba(255,255,255,0.04);
                cursor: pointer;
                transition: border-color 0.15s, background 0.15s, transform 0.12s;
                position: relative;
                outline: none;
            }
            .gd-inst-plat-card:hover {
                border-color: rgba(255,255,255,0.28);
                background: rgba(255,255,255,0.08);
                transform: translateY(-1px);
            }
            .gd-inst-plat-card.selected {
                border-color: #3dff6e;
                background: rgba(61,255,110,0.07);
                box-shadow: 0 0 0 1px rgba(61,255,110,0.18), 0 4px 18px rgba(61,255,110,0.10);
            }
            .gd-inst-plat-card.selected::after {
                content: '';
                position: absolute;
                top: 7px; right: 7px;
                width: 8px; height: 8px;
                border-radius: 50%;
                background: #3dff6e;
                box-shadow: 0 0 6px #3dff6e;
            }
            .gd-inst-plat-logo {
                width: 44px;
                height: 30px;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .gd-inst-plat-logo img {
                max-width: 44px;
                max-height: 30px;
                width: auto;
                height: auto;
                object-fit: contain;
            }
            .gd-inst-plat-name {
                font-size: 0.72em;
                font-weight: 600;
                letter-spacing: 0.05em;
                color: rgba(255,255,255,0.65);
                text-transform: uppercase;
                line-height: 1;
            }
            .gd-inst-plat-card.selected .gd-inst-plat-name {
                color: #3dff6e;
            }
        </style>
        <div class="pl-modal" id="gdInstallModalInner">
            <div class="pl-hero" style="background-image:url('${heroBg.replace(/\\/g, '/')}')">
                <div class="pl-hero-overlay"></div>
                <div class="pl-hero-content">
                    ${coverHtml}
                    <div class="pl-game-info">
                        <div class="pl-game-label">INSTALLATION</div>
                        <h2 class="pl-game-name">${game.name}</h2>
                    </div>
                </div>
                <button class="pl-close-btn" onclick="document.getElementById('gdInstallerModal')?.remove()">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>
            
            <div class="pl-body">
                ${platformsHtml}
                <div class="pl-section">
                    <div class="pl-section-header">
                        <div class="pl-step-badge">${accountStepNum}</div>
                        <span class="pl-section-title">CHOOSE ACCOUNT</span>
                    </div>
                    <div id="gdInstallSelectedPlatformHint"></div>
                    <div class="pl-accounts-list" id="gdInstallAccountsList">
                        <div class="pl-accounts-loading"><div class="pl-spinner"></div><span>Loading accounts…</span></div>
                    </div>
                </div>
            </div>

            <div class="pl-footer">
                <button class="pl-btn-cancel" onclick="document.getElementById('gdInstallerModal')?.remove()">Cancel</button>
                <button class="pl-btn-launch" id="gdInstallConfirmBtn" onclick="gdInstallConfirm()">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    Install
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

    // Wire platform switcher buttons (only present for multi-platform games)
    const platRow = document.getElementById('gdInstPlatformsRow');
    if (platRow) {
        platRow.addEventListener('click', async (e) => {
            const btn = e.target.closest('.gd-inst-plat-card');
            if (!btn) return;
            const nextPlatform = btn.dataset.plat;
            if (!nextPlatform || nextPlatform === _gdInstallSelectedPlatform) return;
            _gdInstallSelectedPlatform = nextPlatform;
            _gdInstallSelectedAccountId = null;
            platRow.querySelectorAll('.gd-inst-plat-card').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            await gdInstallLoadAccounts(nextPlatform);
        });
    }

    requestAnimationFrame(() => {
        modal.classList.add('visible');
        document.getElementById('gdInstallModalInner')?.classList.add('visible');
    });

    // 4. تحميل الحسابات الخاصة بالمنصة الافتراضية
    await gdInstallLoadAccounts(_gdInstallSelectedPlatform);
}

// Public entry point used by app.js synced-suggestions Install button.
// Sets _gdCurrentGame so gdInstallLoadAccounts can read game.name for ownership checks.
window._gdOpenInstallPickerForGame = async function(game) {
    _gdCurrentGame   = game;
    _gdCurrentGameId = String(game.id);
    await _gdOpenInstallPicker(game);
};

// ──────────────────────────────────────────
//  INSTALL CONFIRM & ACCOUNT SELECT (CLEANED)
// ──────────────────────────────────────────
function _gdBuildInstallPlatformCard(platKey, selected) {
    const cfg = GD_PLATFORM_LOGOS[platKey];
    if (!cfg) return '';
    const isSelected = platKey === selected;
    const accent = platKey === 'steam' ? '#66c0f4' : '#ffffff';
    return `
        <div class="pl-platform-card ${isSelected ? 'selected' : ''}"
             id="gdInstPlat-${platKey}" data-plat="${platKey}"
             onclick="gdInstallSelectPlatform('${platKey}')"
             style="--plat-color:${cfg.color};--plat-accent:${accent}">
            <div class="pl-platform-icon-wrap">
                <img src="${cfg.img}" alt="${cfg.name}" ${cfg.invert ? 'style="filter:invert(1)"' : ''}>
            </div>
            <span class="pl-platform-name">${cfg.name}</span>
        </div>`;
}

window.gdInstallSelectPlatform = async function(platKey) {
    if (_gdInstallSelectedPlatform === platKey) return;
    _gdInstallSelectedPlatform = platKey;
    _gdInstallSelectedAccountId = null;

    // Support both new card class and legacy pl-platform-card
    const row = document.getElementById('gdInstPlatformsRow');
    if (row) {
        row.querySelectorAll('.gd-inst-plat-card, .pl-platform-card').forEach(c => c.classList.remove('selected'));
        const target = row.querySelector(`[data-plat="${platKey}"]`);
        target?.classList.add('selected');
    }

    await gdInstallLoadAccounts(platKey);
};

window.gdInstallLoadAccounts = async function(platKey) {
    _gdUpdateInstallPlatformHint?.(platKey);
    const list = document.getElementById('gdInstallAccountsList');
    if (!list) return;

    list.style.opacity = '0';
    await new Promise(r => setTimeout(r, 150));
    list.innerHTML = `<div class="pl-accounts-loading"><div class="pl-spinner"></div><span>Loading accounts…</span></div>`;
    list.style.opacity = '1';

    const game        = _gdCurrentGame;
    const platName    = platKey === 'steam' ? 'Steam' : 'Epic Games';
    const platAccent  = platKey === 'steam' ? '#66c0f4' : '#ffffff';

    let options = [];
    try {
        options = await buildPlatformAccountOptions({ game, platform: platKey, mode: 'install' });
    } catch (e) {
        console.error('[Install] Error loading accounts:', e);
    }

    if (options.length > 0 &&
        options.every(o => o.actionStatus === 'sync_to_verify') &&
        (window._poLastBuildDebug?.usedAccountsCount === 0 || window._poLastBuildDebug?.usedGamesCount === 0)) {
        console.warn('[Install] All accounts are sync_to_verify because sync data is unavailable', window._poLastBuildDebug);
    }

    const noSwitchRow = `
        <div class="pl-account-row no-switch" id="gdInstAcct-__none__"
             onclick="gdInstallSelectAccount('__none__', '${platKey}')"
             data-id="__none__" data-action-status="ready">
            <div class="pl-account-avatar no-switch-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
            </div>
            <div class="pl-account-info">
                <div class="pl-account-name">Install Directly</div>
                <div class="pl-account-sub">No account switch</div>
            </div>
            <div class="pl-account-check"></div>
        </div>`;

    const accountRows = options.map(opt => _poRenderAccountRow(opt, {
        idPrefix:     'gdInstAcct-',
        makeOnClick:  (id, pt) => `gdInstallSelectAccount('${id}', '${pt}')`,
        closeModalJs: `document.getElementById('gdInstallerModal')?.remove()`,
        platKey,
        platName,
        platAccent,
    })).join('');

    list.style.opacity = '0';
    await new Promise(r => setTimeout(r, 150));
    list.innerHTML = noSwitchRow + accountRows;

    const firstOwned      = options.find(o => o.actionStatus === 'ready' && !o.notInSwitcher);
    const firstSelectable = options.find(o => o.enabled && !o.notInSwitcher);
    gdInstallSelectAccount(
        firstOwned      ? firstOwned.id :
        firstSelectable ? firstSelectable.id : '__none__',
        platKey
    );

    list.style.opacity = '1';
};
window.gdInstallSelectAccount = function(accountId, platformType) {
    const row = document.querySelector(`#gdInstallAccountsList .pl-account-row[data-id="${accountId}"]`);
    if (row && row.getAttribute('aria-disabled') === 'true') return;
    _gdInstallSelectedAccountId       = accountId;
    _gdInstallSelectedAccountUsername = null;
    _gdInstallSelectedAccountName     = null;
    _gdInstallSelectedActionStatus    = null;

    document.querySelectorAll('#gdInstallAccountsList .pl-account-row').forEach(r => r.classList.remove('selected'));
    if (row) {
        row.classList.add('selected');
        _gdInstallSelectedAccountUsername = row.dataset.username     || null;
        _gdInstallSelectedAccountName     = row.dataset.name         || null;
        _gdInstallSelectedActionStatus    = row.dataset.actionStatus || null;
    }
};

window.gdInstallConfirm = async function() {
    if (_gdInstallConfirmInFlight) return;
    _gdInstallConfirmInFlight = true;
    try {
        await _gdInstallConfirmImpl();
    } finally {
        _gdInstallConfirmInFlight = false;
    }
};

function _gdInstallPlatformConfig(platKey) {
    const fallback = {
        steam: { name: 'Steam', img: './assets/Steam.png', accent: '#66c0f4', invert: false },
        epic:  { name: 'Epic Games', img: './assets/epic.svg', accent: '#ffffff', invert: true },
    };

    const cfg = (typeof GD_PLATFORM_LOGOS !== 'undefined' && GD_PLATFORM_LOGOS[platKey])
        ? GD_PLATFORM_LOGOS[platKey]
        : fallback[platKey];

    return {
        name: cfg?.name || cfg?.label || fallback[platKey]?.name || String(platKey || 'Unknown Platform'),
        img: cfg?.img || cfg?.src || cfg?.logo || fallback[platKey]?.img || '',
        accent: cfg?.accent || fallback[platKey]?.accent || '#ffffff',
        invert: cfg?.invert ?? fallback[platKey]?.invert ?? false,
    };
}

function _gdInstallPlatformHintHtml(platKey) {
    const cfg = _gdInstallPlatformConfig(platKey);

    return `
        <div class="pl-selected-platform-hint" style="--plat-accent:${cfg.accent || '#fff'}">
            <div class="pl-selected-platform-icon">
                ${cfg.img ? `<img src="${cfg.img}" alt="${cfg.name}" ${cfg.invert ? 'style="filter:invert(1)"' : ''}>` : ''}
            </div>
            <div class="pl-selected-platform-text">
                <div class="pl-selected-platform-kicker">Installing from</div>
                <div class="pl-selected-platform-name">${cfg.name}</div>
            </div>
        </div>
    `;
}

function _gdUpdateInstallPlatformHint(platKey) {
    const hint = document.getElementById('gdInstallSelectedPlatformHint');
    if (hint) {
        hint.innerHTML = _gdInstallPlatformHintHtml(platKey);
    }
}

async function _gdResolveSteamInstallGame(game, accountId) {
    // Fast path: direct extraction already works
    if (typeof _poSteamInstallCandidates === 'function') {
        const direct = _poSteamInstallCandidates(game);
        if (direct && direct.appid) {
            console.log('[SteamInstallResolve] direct extraction ok, appid:', direct.appid);
            return game;
        }
        if (game._raw) {
            const fromRaw = _poSteamInstallCandidates(game._raw);
            if (fromRaw && fromRaw.appid) {
                console.log('[SteamInstallResolve] _raw extraction ok, appid:', fromRaw.appid);
                return { ...game, ...game._raw, _steamInstallResolvedFromRaw: true };
            }
        }
    }

    // Slow path: fetch synced library cache and match by title / steam ID
    console.log('[SteamInstallResolve] no direct appid — fetching platformSyncGetCached steam');
    try {
        const cacheResult = await window.electronAPI?.platformSyncGetCached?.('steam');
        const games = cacheResult?.games ?? [];
        console.log('[SteamInstallResolve] cache shape:', { status: cacheResult?.status, count: games.length });

        if (!games.length) {
            console.warn('[SteamInstallResolve] Steam library cache empty');
            return game;
        }

        // Prefer entry owned by the selected account (accountId is numeric Steam ID)
        const accountOwned = accountId && accountId !== '__none__'
            ? games.filter(g => String(g.accountId) === String(accountId) || String(g.steamId) === String(accountId))
            : games;

        const pool = accountOwned.length ? accountOwned : games;

        let libGame = null;
        if (typeof window._poFindLibraryGame === 'function') {
            libGame = window._poFindLibraryGame(pool, game, 'steam');
            if (!libGame && pool !== games) {
                // widen search to full library
                libGame = window._poFindLibraryGame(games, game, 'steam');
            }
        }

        if (!libGame) {
            // title-only normalised fallback
            const normTitle = typeof window._poNormTitle === 'function' ? window._poNormTitle : (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
            const gameNorm  = normTitle(game.name || '');
            libGame = games.find(g => normTitle(g.name || g.title || '') === gameNorm) || null;
        }

        if (!libGame) {
            console.warn('[SteamInstallResolve] no library match for', game.name);
            return game;
        }

        // In this project synced Steam library games store the numeric AppID in appName
        const appid = libGame.appName || libGame.appid || libGame.steam_appid || libGame.steamAppId || null;
        console.log('[SteamInstallResolve] library match:', libGame.name, '→ appid:', appid);

        if (!appid) {
            console.warn('[SteamInstallResolve] library match found but no appid field', libGame);
            return game;
        }

        return {
            ...game,
            steamAppId: appid,
            appid,
            appName: appid,
            allIds: { ...(game.allIds || {}), steam: appid },
            _steamInstallResolvedFromLibrary: true,
            _steamInstallLibraryGame: libGame,
        };
    } catch (err) {
        console.error('[SteamInstallResolve] error fetching library cache:', err);
        return game;
    }
}

function _gdNormSteamAccountValue(value) {
    return String(value || '').trim().toLowerCase();
}

function _gdSteamAccountAliases(account) {
    const aliases = new Set();

    const add = (value) => {
        const s = _gdNormSteamAccountValue(value);
        if (s) aliases.add(s);
    };

    if (!account) return aliases;

    if (typeof account !== 'object') {
        add(account);
        return aliases;
    }

    add(account.id);
    add(account.steamId);
    add(account.SteamID);
    add(account.username);
    add(account.AccountName);
    add(account.displayName);
    add(account.PersonaName);
    add(account.name);
    add(account.platformAccountId);
    add(account._resolvedSyncId);

    return aliases;
}

function _gdSteamAccountsMatch(a, b) {
    const aa = _gdSteamAccountAliases(a);
    const bb = _gdSteamAccountAliases(b);

    for (const x of aa) {
        if (bb.has(x)) return true;
    }

    return false;
}

async function _gdIsSelectedSteamAccountAlreadyActive(accountId) {
    const selected = {
        id: accountId,
        steamId: accountId,
        username: _gdInstallSelectedAccountUsername,
        displayName: _gdInstallSelectedAccountName,
        name: _gdInstallSelectedAccountName,
    };

    let accounts = [];

    try {
        accounts = await window.electronAPI?.getSteamAccounts?.();
    } catch (e) {
        console.warn('[Install][Steam] Failed to read Steam accounts for active check:', e);
    }

    if (!Array.isArray(accounts) || accounts.length === 0) {
        return {
            alreadyActive: false,
            activeAccount: null,
            accounts: [],
        };
    }

    const activeAccount = accounts.find(a => a?.mostRecent) || null;

    if (!activeAccount) {
        return {
            alreadyActive: false,
            activeAccount: null,
            accounts,
        };
    }

    return {
        alreadyActive: _gdSteamAccountsMatch(activeAccount, selected),
        activeAccount,
        accounts,
    };
}


function _gdReadEpicField(game, keys) {
    const sources = [
        game,
        game?._raw,
        game?.raw,
        game?.metadata,
        game?._raw?.metadata,
        game?.allIds,
        game?._raw?.allIds,
    ].filter(Boolean);

    for (const src of sources) {
        for (const key of keys) {
            const val = src?.[key];
            if (val !== undefined && val !== null && String(val).trim()) {
                return String(val).trim();
            }
        }
    }

    return null;
}

function _gdBuildEpicAppId(game) {
    if (!game) return null;

    const namespace =
        _gdReadEpicField(game, ['namespace', 'NamespaceId', 'namespaceId', 'catalogNamespace']) ||
        (game.allIds?.epic && _gdIsValidEpicNamespace(game.allIds.epic) ? game.allIds.epic : null);

    const catalogItemId =
        _gdReadEpicField(game, ['catalogItemId', 'ItemId', 'itemId', 'catalogItemID']);

    const appName =
        _gdReadEpicField(game, ['appName', 'AppName', 'artifactId', 'ArtifactId', 'appId', 'epicAppName']);

    const launcherGameId =
        _gdReadEpicField(game, ['launcherGameId', 'launchCommand']);

    // لو عندك launcherGameId جاهز بالفعل كـ tuple
    if (launcherGameId && launcherGameId.includes(':')) {
        return launcherGameId.replace(/:/g, '%3A');
    }

    if (launcherGameId && launcherGameId.includes('%3A')) {
        return launcherGameId;
    }

    // الشكل الحديث: namespace:itemId:appName
    if (namespace && catalogItemId && appName) {
        return `${namespace}%3A${catalogItemId}%3A${appName}`;
    }

    // fallback للألعاب القديمة أو الكاش اللي فيه appName فقط
    if (appName) return appName;

    return null;
}

function getEpicInstallUrl(game) {
    const epicAppId = _gdBuildEpicAppId(game);

    console.log('[EpicInstallUrl]', {
        name: game?.name,
        id: game?.id,
        namespace: game?.namespace,
        catalogItemId: game?.catalogItemId,
        appName: game?.appName,
        launcherGameId: game?.launcherGameId,
        allIds: game?.allIds,
        epicAppId
    });

    if (!epicAppId) return null;

    return `com.epicgames.launcher://apps/${epicAppId}?action=install&silent=false`;
}



async function _gdInstallConfirmImpl() {
    const accountId = _gdInstallSelectedAccountId;
    const platform  = _gdInstallSelectedPlatform;
    const game      = _gdCurrentGame;

    if (_gdInstallSelectedActionStatus === 'does_not_own') {
        if (typeof showToast === 'function') {
            showToast('This account does not own this game. Choose an account that owns it.', 'warning');
        }

        document.getElementById('gdInstallerModal')?.remove();
        return;
    }

    document.getElementById('gdInstallerModal')?.remove();
    if (!game) return;

    const targetPlatform = String(
        platform || (Array.isArray(game.platforms) ? game.platforms[0] : game.platform) || 'steam'
    ).toLowerCase().trim();

    if (targetPlatform === 'epic') {
    const installUrl = getEpicInstallUrl(game);

    console.log('[Install][Epic] payload', {
        gameId: game.id,
        name: game.name,
        allIds: game.allIds,
        appName: game.appName,
        namespace: game.namespace,
        catalogItemId: game.catalogItemId,
        launcherGameId: game.launcherGameId,
        installUrl,
    });

    if (!installUrl) {
        if (typeof showToast === 'function') {
            showToast('Could not build Epic install URL — missing app ID.', 'error');
        }
        return;
    }

    if (window.__debugInstallOpen) {
        console.log('[Install] epic', {
            gameId: game.id,
            gameName: game.name,
            installUrl,
            accountId: null,
            didSwitchAccount: false
        });
    }

    await _gdOpenInstallUrl(
        'epic',
        installUrl,
        null,
        'Opening Epic to install...',
        { didSwitchAccount: false }
    );

    return;
}

    if (targetPlatform === 'steam') {
        let didSwitchAccount = false;

        if (accountId && accountId !== '__none__') {
            try {
                const switchArg = (_gdInstallSelectedAccountUsername && _gdInstallSelectedAccountUsername !== 'undefined')
                    ? _gdInstallSelectedAccountUsername
                    : accountId;

                const activeCheck = await _gdIsSelectedSteamAccountAlreadyActive(accountId);

                if (activeCheck.alreadyActive) {
                    console.log('[Install][Steam] Selected account is already active; skipping switch', {
                        accountId,
                        switchArg,
                        selectedName: _gdInstallSelectedAccountName,
                        activeAccount: activeCheck.activeAccount,
                    });
                } else {
                    if (typeof showToast === 'function') {
                        showToast(`Switching Steam account to ${_gdInstallSelectedAccountName || switchArg}… Please wait up to 7s`, 'info');
                    }

                    const switchRes = await window.electronAPI.switchSteam?.(switchArg);

                    if (switchRes?.skipped || switchRes?.alreadyActive) {
                        console.log('[Install][Steam] Main process skipped Steam switch; account already active', switchRes);
                        didSwitchAccount = false;
                    } else {
                        didSwitchAccount = true;
                        await new Promise(r => setTimeout(r, 7000));
                    }
                }
            } catch (e) {
                console.warn('[Install] Steam Switch failed:', e);
            }
        }

        const steamInstallGame = await _gdResolveSteamInstallGame(game, accountId);
        const installUrl = getSteamInstallUrl(steamInstallGame);

        if (!installUrl) {
            if (typeof showToast === 'function') {
                showToast('Could not find Steam App ID for this game. Try syncing your Steam library again.', 'error');
            }
            return;
        }

        console.log('[Install][Steam] payload', {
            gameId:         steamInstallGame.id,
            name:           steamInstallGame.name,
            allIds:         steamInstallGame.allIds,
            appName:        steamInstallGame.appName,
            command:        steamInstallGame.command,
            launchCommand:  steamInstallGame.launchCommand,
            launcherGameId: steamInstallGame.launcherGameId,
            resolvedFromLib: steamInstallGame._steamInstallResolvedFromLibrary,
            installUrl,
        });

        if (window.__debugInstallOpen) {
            console.log('[Install] steam', {
                gameId: game.id,
                gameName: game.name,
                installUrl,
                accountId,
                didSwitchAccount,
            });
        }

        await _gdOpenInstallUrl(
            'steam',
            installUrl,
            accountId,
            'Opening Steam to install...',
            { didSwitchAccount }
        );

        return;
    }

    if (typeof showToast === 'function') {
        showToast(`Install is not supported for ${targetPlatform}.`, 'error');
    }
}

async function _gdOpenInstallUrl(platform, installUrl, accountId, successMsg, options = {}) {
    const accountName = _gdInstallSelectedAccountName || _gdInstallSelectedAccountUsername || accountId;

    if (typeof window.electronAPI?.openInstallUrl === 'function') {
        // ✅ رسالة فورية قبل ما نستنى الـ main process
        if (typeof showToast === 'function') {
            if (platform === 'epic') {
                showToast('Opening Epic Games Launcher… preparing installation request.', 'info');
            } else if (platform === 'steam') {
                showToast('Opening Steam… preparing installation request.', 'info');
            } else {
                showToast(successMsg || 'Opening launcher…', 'info');
            }
        }

        const res = await window.electronAPI.openInstallUrl({
            platform,
            installUrl,
            accountId,
            accountName,

            // سيبها true عادي لو الـ main محتاجها كـ compatibility
            retryOnColdStart: true,

            // ✅ مهم:
            // Epic install بقى handled في main.js بالـ cold-start recovery الجديد.
            // بلاش forceRetryAfterOpen مع Epic عشان مايبعتش أوامر زيادة.
            forceRetryAfterOpen: platform !== 'epic' && options.didSwitchAccount === true,

            fallbackToStore: platform === 'steam',
        });

        console.log('[Install] IPC result:', res);

        if (res.ok) {
            if (typeof showToast === 'function') {
                if (platform === 'steam') {
                    showToast('Steam is ready. Continue installation in Steam.', 'success');
                } else if (platform === 'epic') {
                    showToast('Epic installation request sent. The download should start in Epic Games Launcher.', 'success');
                } else if (successMsg) {
                    showToast(successMsg, 'success');
                } else {
                    showToast('Installation request sent.', 'success');
                }
            }
        } else {
            console.warn('[Install] openInstallUrl failed', res);

            const msg =
                res?.message ||
                res?.error ||
                'Install failed. Please check that the required launcher is installed.';

            if (typeof showToast === 'function') {
                showToast(msg, 'error');
            }
        }
    } else {
        console.warn('[Install] openInstallUrl not available — falling back to openExternal');

        if (window.electronAPI?.openExternal) {
            await window.electronAPI.openExternal(installUrl).catch(err => {
                console.warn('[Install] openExternal fallback failed:', err);
            });
        } else if (typeof showToast === 'function') {
            showToast('Install opener is not available. Please restart Baddel and try again.', 'error');
        }
    }
}

// محاكاة بار التحميل - استبدلها بـ IPC event حقيقي
function _gdSimulateDownload() {
    const downloadBlock = document.getElementById('gdDownloadBlock');
    const playBtn = document.getElementById('gdPlayBtn');
    const dlBar = document.getElementById('gdDlBar');
    const dlPercent = document.getElementById('gdDlPercent');
    const dlSpeed = document.getElementById('gdDlSpeed');
    const dlEta = document.getElementById('gdDlEta');
    const dlStatus = document.getElementById('gdDlStatus');

    playBtn.style.display = 'none';
    downloadBlock.style.display = 'block';

    let percent = 0;
    const totalSizeMB = 25000; // 25 GB

    _gdDownloadInterval = setInterval(() => {
        const speedMBps = 5 + Math.random() * 10; // 5-15 MB/s
        percent += (speedMBps / totalSizeMB) * 100 * 2;
        if (percent >= 100) {
            percent = 100;
            clearInterval(_gdDownloadInterval);
            dlStatus.textContent = 'Installed!';
            dlSpeed.textContent = '';
            dlEta.textContent = 'Done';
            setTimeout(() => {
                downloadBlock.style.display = 'none';
                const btn = document.getElementById('gdPlayBtn');
                btn.classList.remove('install-mode');
                document.getElementById('gdPlayBtnLabel').textContent = 'PLAY';
                btn.style.display = 'flex';
            }, 1500);
            return;
        }
        const remainingMB = totalSizeMB * (1 - percent / 100);
        const etaSec = remainingMB / speedMBps;
        const etaMin = Math.floor(etaSec / 60);
        const etaSec2 = Math.floor(etaSec % 60);

        dlBar.style.width = percent + '%';
        dlPercent.textContent = percent.toFixed(1) + '%';
        dlSpeed.textContent = speedMBps.toFixed(1) + ' MB/s';
        dlEta.textContent = etaMin > 0 ? `${etaMin}m ${etaSec2}s left` : `${etaSec2}s left`;
        dlStatus.textContent = 'Downloading…';
    }, 200);
}

// ──────────────────────────────────────────
//  METADATA POPULATE
// ──────────────────────────────────────────
// ──────────────────────────────────────────
//  METADATA POPULATE
// ──────────────────────────────────────────
function _gdPopulateMeta(game, metaData) {
    // If the caller already built meta from the Creator draft (_creatorCustom: true),
    // do NOT merge committed saved custom back over it — that would erase draft changes.
    // Normal server/launcher metadata always goes through the merge as before.
    const isCreatorDraftMeta = !!metaData?._creatorCustom;
    if (isCreatorDraftMeta) {
        console.debug('[GD][Creator] _gdPopulateMeta using draft preview meta; skip committed merge');
    } else {
        metaData = _gdMergeCustomIntoMeta(game, metaData);
    }
    const images = metaData || {};          
    const info = metaData?.info || {};
    const sources = metaData?.quality?.sources || {};

    // ── 0. Metadata Sources Display ──
    const sourcesSection = document.getElementById('gdMetadataSourcesSection');
    const sourcesContainer = document.getElementById('gdMetadataSources');
    if (sourcesSection && sourcesContainer && metaData?.quality) {
        sourcesSection.style.display = 'block';
        
        const confidence = metaData.quality.confidence || 0;
        const confidenceColor = confidence > 80 ? '#30d158' : confidence > 50 ? '#ff9f0a' : '#ff453a';

        const sourceMap = [
            { label: 'Cover Art', source: sources.cover },
            { label: 'Hero Banner', source: sources.hero },
            { label: 'Game Logo', source: sources.logo },
            { label: 'Game Details', source: sources.text },
        ];
        
        const sourcesHtml = sourceMap.map(s => `
            <div class="gd-source-item" style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid rgba(255,255,255,0.05); font-size:0.85rem;">
                <span style="color:var(--gd-text-muted)">${s.label}</span>
                <span style="color:var(--accent); font-weight:600;">${s.source || 'Manual/Default'}</span>
            </div>
        `).join('');

        sourcesContainer.innerHTML = `
            <div style="margin-bottom:12px; display:flex; align-items:center; gap:10px;">
                <div style="flex:1; height:4px; background:rgba(255,255,255,0.1); border-radius:2px; overflow:hidden;">
                    <div style="width:${confidence}%; height:100%; background:${confidenceColor}; box-shadow:0 0 10px ${confidenceColor}aa;"></div>
                </div>
                <span style="font-size:0.75rem; font-weight:800; color:${confidenceColor}; min-width:35px; text-align:right;">${confidence}%</span>
            </div>
            ${sourcesHtml}
        `;
    } 
    if (sourcesSection) sourcesSection.style.display = 'none';

    // Upgrade product-type badge with authoritative server entry_type.
    // This overrides the title-keyword guess applied by _gdPopulateBasic.
    _gdApplyProductTypeBadge(game, metaData);

    const esc = (s) => String(s || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    // ==========================================
    // ── تحديث الوصف (Overview فقط) ──
    // ==========================================
    // بنحاول نجيب الوصف القصير، لو مش موجود بناخد أول 250 حرف من الوصف الطويل كبديل
    let finalDesc = info.short_description || game.short_description || null;
    if (!finalDesc) {
        const fallbackDesc = info.description || game.description || '';
        if (fallbackDesc) {
            finalDesc = fallbackDesc.length > 250 ? fallbackDesc.substring(0, 250) + '...' : fallbackDesc;
        }
    }

    const shortDescSection = document.getElementById('gdShortDescSection');
    const shortDescText = document.getElementById('gdShortDescText');
    
    if (shortDescSection && shortDescText) {
        if (finalDesc) {
            shortDescText.innerHTML = esc(finalDesc);
            shortDescSection.style.display = 'block';
        } else if (metaData) {
            // We received a valid server response but it has no description yet
            // (e.g. IGDB enrichment pending, or Epic-only game with no text metadata).
            // Show a clean fallback — never leave "Fetching metadata…" skeleton text in place.
            shortDescText.textContent = 'No description available.';
            shortDescSection.style.display = 'block';
        } else {
            shortDescSection.style.display = 'none';
        }
    }

    // ── Full Markdown Description ──
    // ابحث عن الجزء الخاص بـ Full Markdown Description وحدثه بهذا الكود:

    // ── Full Markdown Description ──
    const fullDesc = info.description || game.description || null;
    let fullDescSection = document.getElementById('gdFullDescSection');

    if (!fullDescSection) {
        fullDescSection = document.createElement('div');
        fullDescSection.id = 'gdFullDescSection';
        fullDescSection.className = 'gd-section';
        // ضفنا الـ Wrapper والـ Fade هنا
        fullDescSection.innerHTML = `
            <h3 class="gd-section-title">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/>
                </svg>
                About Game
            </h3>
            <div class="gd-about-wrapper" id="gdAboutWrapper">
                <div class="gd-full-desc gd-full-desc-text" id="gdFullDescText"></div>
                <div class="gd-about-fade" id="gdAboutFade"></div>
            </div>`;
        
        const mainContainer = document.getElementById('gdTab-overview');
        if (mainContainer) {
            mainContainer.appendChild(fullDescSection); 
        }
    }

    const fullDescEl = document.getElementById('gdFullDescText');
    const aboutWrapper = document.getElementById('gdAboutWrapper');
    const fadeEl = document.getElementById('gdAboutFade');

    if (fullDescEl && fullDesc) {
        fullDescEl.innerHTML = _gdRenderMarkdown(fullDesc);
        fullDescEl.addEventListener('click', (e) => {
            const a = e.target.closest('.gd-md-link');
            if (!a) return;
            e.preventDefault();
            const href = a.dataset.href;
            if (href) window.electronAPI?.openExternal?.(href);
        });
        fullDescSection.style.display = 'block';

        // مسح أي زرار قديم
        const oldBtn = fullDescSection.querySelector('.gd-show-more-btn');
        if (oldBtn) oldBtn.remove();

        // إضافة الزرار جوه الـ fade overlay عشان يظهر فوق التدرج
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'gd-show-more-btn';
        toggleBtn.textContent = 'Show More';

        toggleBtn.onclick = () => {
            const isExpanded = aboutWrapper.classList.toggle('expanded');
            toggleBtn.textContent = isExpanded ? 'Show Less' : 'Show More';
        };

        // بنضيف الزرار جوه الـ Fade مش تحته
        fadeEl.appendChild(toggleBtn);
    } else {
        fullDescSection.style.display = 'none';
    }

    // Hero resolution: prefer metadata images, fall back to what's already on the game record.
    // Never null out game.heroImage — a valid DB hero must survive a metadata payload that lacks one.
    const artLocked = game.customArtworkLocked === true;

// If user manually changed artwork, prefer local/manual artwork over server metadata
const heroSrc = artLocked
    ? (game.heroImage || game.defaultHero || images.heroImage || images.hero || null)
    : (images.heroImage || images.hero || game.heroImage || game.defaultHero || null);
    const heroBg = document.getElementById('gdHeroBg');

    if (heroSrc && heroBg) {
        _gdClearProceduralHero();
        heroBg.style.backgroundImage = `url('${heroSrc.replace(/\\/g, '/')}')`;
        game.heroImage = heroSrc;
    } else if (heroBg && metaData) {
        _gdApplyProceduralHero(game.name);
        // Do NOT null out game.heroImage — the DB value may still be valid for future renders.
    }

    const coverImg = document.getElementById('gdCover');
    const coverSrc = artLocked
        ? (game.image || images.cover || null)
        : (images.cover || game.image || null);

    if (coverSrc && coverImg) {
        _gdClearProceduralCard();
        game.image = coverSrc;
        coverImg.onerror = function _gdCoverErrMeta() {
            this.onerror = null;
            this.style.display = 'none';
            _gdApplyProceduralCard(game.name);
            const ph = document.getElementById('gdCoverPlaceholder');
            if (ph) ph.style.display = 'flex';
        };
        coverImg.src = coverSrc;
        coverImg.style.display = 'block';
        document.getElementById('gdCoverPlaceholder').style.display = 'none';
    } else if (metaData && coverImg) {
        game.image = null;
        coverImg.removeAttribute('src');
        coverImg.style.display = 'none';
        _gdApplyProceduralCard(game.name);
        document.getElementById('gdCoverPlaceholder').style.display = 'flex';
    }

    // ── Logo: SGDB → Steam CDN → RAWG → IGDB cover؛ لو فشل التحميل أو مفيش لوجو نعرض اسم اللعبة ──
    const logoSrc = artLocked
    ? (game.logo || null)
    : (images.logo || game.logo || null);

    if (logoSrc) {
        game.logo = logoSrc;
        const logoEl = document.getElementById('gdLogo');
        if (logoEl) {
            logoEl.onerror = function _gdLogoOnErrorMeta() {
                this.onerror = null;
                this.style.display = 'none';
                document.getElementById('gdTitle').style.display = 'block';
            };
            logoEl.src = logoSrc;
            logoEl.style.display = 'block';
            document.getElementById('gdTitle').style.display = 'none';
        }
    } else if (metaData) {
        game.logo = null;
        const logoEl = document.getElementById('gdLogo');
        if (logoEl) {
            logoEl.onerror = null;
            logoEl.removeAttribute('src');
            logoEl.style.display = 'none';
        }
        document.getElementById('gdTitle').style.display = 'block';
    }

    // في _gdPopulateMeta، قبل "if (media.length > 0)"
    _gdApplyResolvedArtworkToDom(game, metaData);

    const screenshotContainer = document.getElementById('gdScreenshots');
    const media = info.screenshots || [];

    // 2. Ratings — render ALL sources dynamically from the ratings array
    const ratingsArr = Array.isArray(metaData?.ratings)              ? metaData.ratings
                     : Array.isArray(info.ratings)                   ? info.ratings
                     : Array.isArray(metaData?._serverData?.ratings) ? metaData._serverData.ratings
                     : [];

    console.log('[GD Ratings] arr length:', ratingsArr.length, '| sources:', ratingsArr.map(r => r.source));

    const ratingBlock   = document.getElementById('gdRatingBlock');
    const scoreEl       = document.getElementById('gdRatingScore');
    const starsEl       = document.getElementById('gdRatingStars');
    const ratingLabelEl = document.getElementById('gdRatingLabel');

    /**
     * Builds a sidebar score chip (new horizontal layout).
     */
    const _buildRatingPill = (label, sublabel, score, maxScore, color) => {
        const s  = Number(score);
        const mx = Number(maxScore) || 100;
        const displayScore = mx <= 10 ? s.toFixed(1) : Math.round(s);
        const displayMax   = mx <= 10 ? mx : Math.round(mx);

        // Source icon mapping
        const srcKey = (label || '').toLowerCase();
        let iconHtml = '';
        if (srcKey.includes('igdb')) iconHtml = `<img src="../assets/igdb.png" class="gd-rd-icon-rect" style="max-width:18px;">`;
        else if (srcKey.includes('metacritic')) iconHtml = `<img src="../assets/Metacritic.svg" class="gd-rd-icon">`;
        else if (srcKey.includes('steam')) iconHtml = `<img src="../assets/Steam.png" class="gd-rd-icon">`;
        else if (srcKey.includes('epic')) iconHtml = `<img src="../assets/epic.svg" class="gd-rd-icon" style="filter:invert(1)">`;

        const sublabelHtml = sublabel ? `<div class="gd-pill-sub">${sublabel}</div>` : '';

        return `
            <div class="gd-rating-pill" style="--pill-color:${color}">
                <div class="gd-pill-source-icon">${iconHtml}</div>
                <div class="gd-pill-info">
                    <div class="gd-pill-label">${label}</div>
                    ${sublabelHtml}
                </div>
                <div class="gd-pill-score" style="color:${color}">
                    ${displayScore}<span class="gd-pill-max">/${displayMax}</span>
                </div>
            </div>`;
    };

    // ── Source config: label, color, pill grouping ──────────────────────────
    // كل source ممكن يطلع كـ group مستقل أو يتجمع مع غيره
    const SOURCE_CONFIG = {
        igdb_critics: { group: 'IGDB',        pillLabel: 'Critics',  color: '#30d158', sublabelSuffix: 'critics' },
        igdb_users:   { group: 'IGDB',        pillLabel: 'Users',    color: '#34aadc', sublabelSuffix: 'users'   },
        igdb:         { group: 'IGDB',        pillLabel: 'Score',    color: '#30d158', sublabelSuffix: 'ratings' },
        steam:        { group: 'Steam',       pillLabel: '',         color: '#66c0f4', sublabelSuffix: 'reviews' },
        epic:         { group: 'Epic',        pillLabel: '',         color: '#0094ff', sublabelSuffix: 'reviews' },
        metacritic:   { group: 'Metacritic',  pillLabel: '',         color: '#ffcc00', sublabelSuffix: 'critics' },
    };

    // ── Group ratings by their group name ──────────────────────────────────
    // ── Normalize + group ratings by their group name ───────────────────────
// Fix: prevent duplicate/generic white Steam Reviews cards.
// Only render Steam through the detailed positive/negative reviews card.
const _gdNormalizeRatingSourceKey = (value) => {
    const s = String(value || '')
        .toLowerCase()
        .trim()
        .replace(/[\s\-]+/g, '_');

    if (!s) return '';

    if (
        s === 'steam' ||
        s === 'steam_review' ||
        s === 'steam_reviews' ||
        s.includes('steam')
    ) return 'steam';

    if (
        s === 'epic' ||
        s === 'epic_games' ||
        s.includes('epic')
    ) return 'epic';

    if (s.includes('metacritic')) return 'metacritic';

    if (s === 'igdb_critic' || s === 'igdb_critics') return 'igdb_critics';
    if (s === 'igdb_user' || s === 'igdb_users') return 'igdb_users';
    if (s === 'igdb_score' || s === 'igdb') return 'igdb';

    return s;
};

const groups = {}; // { groupName: [ {cfg, rating} ] }
const normalizedRatings = [];
let bestSteamRating = null;

for (const rawRating of ratingsArr) {
    const srcKey = _gdNormalizeRatingSourceKey(rawRating.source || rawRating.label || rawRating.name);
    if (!srcKey) continue;

    const rating = {
        ...rawRating,
        source: srcKey,
    };

    // Steam should only appear as the big detailed Steam reviews bar.
    // Skip score-only Steam aliases because they create the useless white card.
    if (srcKey === 'steam') {
        const pos = Number(rating.positive_count || 0);
        const neg = Number(rating.negative_count || 0);
        const total = Number(rating.total_reviews || pos + neg || 0);
        const hasSteamCounts = pos > 0 || neg > 0;

        if (!hasSteamCounts) {
            console.log('[GD Ratings] Skipping score-only Steam rating alias:', rawRating);
            continue;
        }

        rating.total_reviews = total || (pos + neg);
        bestSteamRating = rating;
        continue;
    }

    normalizedRatings.push(rating);
}

if (bestSteamRating) {
    normalizedRatings.push(bestSteamRating);
}

for (const rating of normalizedRatings) {
    const srcKey = _gdNormalizeRatingSourceKey(rating.source);
    const cfg = SOURCE_CONFIG[srcKey] || {
        group:         rating.source || 'Unknown',
        pillLabel:     '',
        color:         '#ffffff',
        sublabelSuffix:'',
    };

    if (!groups[cfg.group]) groups[cfg.group] = [];
    groups[cfg.group].push({ cfg, rating });
}

    // Fallback: backward compat لو مفيش ratings arr بس في info.rating
    if (Object.keys(groups).length === 0 && info.rating) {
        const fallbackSource = info.ratingSource || 'igdb';
        const srcKey = fallbackSource.toLowerCase();
        const cfg    = SOURCE_CONFIG[srcKey] || { group: fallbackSource, pillLabel: '', color: '#30d158', sublabelSuffix: '' };
        groups[cfg.group] = [{ cfg, rating: { score: info.rating, max_score: 100, total_reviews: info.ratingCount || null } }];
    }

    const hasAnyRating = Object.keys(groups).length > 0;

    if (!hasAnyRating) {
        ratingBlock.style.display = 'none';
        const ratingsTabBtn = document.getElementById('gdTabBtn-ratings');
        if (ratingsTabBtn) ratingsTabBtn.style.display = 'none';
    } else {
        ratingBlock.style.display = 'block';

        // 🟢 1. بناء كل التقييمات للتاب الداخلي (Full Ratings Tab) - Premium Redesign
        const fullGroupsHtml = Object.entries(groups).map(([groupName, items]) => {
            return items.map(({ cfg, rating }) => {
                const rawScore = Number(rating.score);
                const rawMax = Number(rating.max_score) || 100;
                const displayScore = rawMax <= 10 ? rawScore.toFixed(1) : Math.round(rawScore);
                const displayMax = rawMax <= 10 ? rawMax : Math.round(rawMax);
                const normalized = Math.min(100, (rawScore / rawMax) * 100);

                const isSteam = String(rating.source || '').toLowerCase() === 'steam';
                const brandColor = cfg.color || '#fff';

                // Arc SVG (circumference ≈ 163 for r=26)
                const arcOffset = 163 - (163 * normalized / 100);
                const arcSvg = `
                    <div class="gd-rd-score-arc">
                        <svg viewBox="0 0 64 64">
                            <circle class="gd-rd-arc-track" cx="32" cy="32" r="26"/>
                            <circle class="gd-rd-arc-fill" cx="32" cy="32" r="26"
                                style="stroke:${brandColor}; stroke-dashoffset:${arcOffset}"/>
                        </svg>
                        <div class="gd-rd-arc-text" style="color:${brandColor}">${displayScore}</div>
                    </div>`;

                // Logo HTML
                let logoHtml = '';
                if (groupName.toLowerCase().includes('igdb')) logoHtml = `<img src="../assets/igdb.png" class="gd-rd-icon-rect">`;
                else if (groupName.toLowerCase().includes('metacritic')) logoHtml = `<img src="../assets/Metacritic.svg" class="gd-rd-icon">`;
                else if (groupName.toLowerCase().includes('epic')) logoHtml = `<img src="../assets/epic.svg" class="gd-rd-icon" style="filter:invert(1)">`;
                else if (isSteam) logoHtml = `<img src="../assets/Steam.png" class="gd-rd-icon">`;

                if (isSteam) {
                    const positiveCount = Number(rating.positive_count || 0);
                    const negativeCount = Number(rating.negative_count || 0);
                    const totalReviews = Number(rating.total_reviews || positiveCount + negativeCount || 0);
                    const posPerc = totalReviews > 0 ? ((positiveCount / totalReviews) * 100).toFixed(1) : '0.0';
                    const posOffset = 163 - (163 * parseFloat(posPerc) / 100);
                    return `
                        <div class="gd-rating-detailed-card steam-card" style="--brand-color: ${brandColor}">
                            <div class="gd-rd-header">
                                <div class="gd-rd-source">
                                    <div class="gd-rd-source-badge">
                                        ${logoHtml}
                                        <span class="gd-rd-source-name">Steam Reviews</span>
                                    </div>
                                </div>
                                <div class="gd-rd-label">${rating.rating_label || 'Mostly Positive'}</div>
                            </div>
                            <div class="gd-rd-main" style="gap:20px;">
                                <div class="gd-rd-score-arc">
                                    <svg viewBox="0 0 64 64">
                                        <circle class="gd-rd-arc-track" cx="32" cy="32" r="26"/>
                                        <circle class="gd-rd-arc-fill" cx="32" cy="32" r="26"
                                            style="stroke:${brandColor}; stroke-dashoffset:${posOffset}"/>
                                    </svg>
                                    <div class="gd-rd-arc-text" style="color:${brandColor};font-size:0.85rem">${Math.round(parseFloat(posPerc))}%</div>
                                </div>
                                <div class="gd-rd-sentiment-box">
                                    <div class="gd-rd-bar-track">
                                        <div class="gd-rd-bar-fill pos" style="width:${posPerc}%"></div>
                                    </div>
                                    <div class="gd-rd-counts">
                                        <span style="display:flex; align-items:center; gap:4px; color:${brandColor}">
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg>
                                            ${positiveCount.toLocaleString()}
                                        </span>
                                        <span style="display:flex; align-items:center; gap:4px; color:#ff453a">
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="transform: scaleY(-1);"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg>
                                            ${negativeCount.toLocaleString()}
                                        </span>
                                    </div>
                                </div>
                            </div>
                            <div class="gd-rd-footer">Based on ${totalReviews.toLocaleString()} total reviews</div>
                        </div>`;
                }

                // Score label text
                const scoreLabel = normalized >= 85 ? 'Outstanding' :
                                   normalized >= 70 ? 'Great' :
                                   normalized >= 55 ? 'Good' :
                                   normalized >= 40 ? 'Mixed' : 'Poor';

                const reviewsLine = rating.total_reviews
                    ? `${Number(rating.total_reviews).toLocaleString()} ${cfg.sublabelSuffix || 'reviews'}`
                    : '';

                return `
                    <div class="gd-rating-detailed-card" style="--brand-color: ${brandColor}">
                        <div class="gd-rd-header">
                            <div class="gd-rd-source">
                                <div class="gd-rd-source-badge">
                                    ${logoHtml}
                                    <span class="gd-rd-source-name">${groupName}</span>
                                </div>
                            </div>
                            ${cfg.pillLabel ? `<div class="gd-rd-label">${cfg.pillLabel}</div>` : ''}
                        </div>
                        <div class="gd-rd-main">
                            ${arcSvg}
                            <div class="gd-rd-side-info">
                                <div class="gd-rd-score-label" style="color:${brandColor}">${scoreLabel}</div>
                                <div class="gd-rd-score-sub">${displayScore} / ${displayMax}</div>
                                ${reviewsLine ? `<div class="gd-rd-score-sub" style="margin-top:2px">${reviewsLine}</div>` : ''}
                            </div>
                        </div>
                    </div>`;
            }).join('');
        }).join('');

        const fullRatingsContainer = document.getElementById('gdFullRatingsContainer');
        if (fullRatingsContainer) {
            fullRatingsContainer.innerHTML = `<div class="gd-detailed-ratings-grid">${fullGroupsHtml}</div>`;
        }

        // إظهار زرار التاب لأن في تقييمات
        const ratingsTabBtn = document.getElementById('gdTabBtn-ratings');
        if (ratingsTabBtn) ratingsTabBtn.style.display = '';

        // 🟢 2. اختيار التقييم الأساسي اللي هيظهر بره في الـ Sidebar
        let primaryItem = null;
        let primaryGroup = null;

        // ترتيب الأولوية: إحنا عايزين نعرض IGDB أو Metacritic كأولوية بره
        const priorityOrder = ['IGDB', 'Metacritic', 'Steam', 'Epic'];
        
        for (const p of priorityOrder) {
            if (groups[p] && groups[p].length > 0) {
                primaryGroup = p;
                // لو IGDB، نفضل الـ Score العام الأول، لو مفيش نجيب Critics
                primaryItem = groups[p].find(i => i.cfg.pillLabel === 'Score') || groups[p][0];
                break;
            }
        }

        // لو ملوناش حاجة من الأولويات، نعرض أول حاجة موجودة وخلاص
        if (!primaryItem) {
            primaryGroup = Object.keys(groups)[0];
            primaryItem = groups[primaryGroup][0];
        }

        // بناء الـ Pill الخاصة بالتقييم اللي بره
        const { cfg, rating } = primaryItem;
        const subOut = rating.total_reviews
            ? `${Number(rating.total_reviews).toLocaleString()} ${cfg.sublabelSuffix}`
            : (cfg.sublabelSuffix || null);
            
        // دمج اسم الجروب مع اسم الـ Pill عشان اليوزر يعرف ده تقييم إيه بره (مثلاً: IGDB Critics)
        const sidebarLabel = `${primaryGroup} ${cfg.pillLabel || ''}`.trim();
        const singlePillHtml = _buildRatingPill(sidebarLabel, subOut, rating.score, rating.max_score || 100, cfg.color);

        // 🟢 3. حساب إجمالي عدد التقييمات المتاحة
        let totalRatingsCount = 0;
        Object.values(groups).forEach(arr => totalRatingsCount += arr.length);

        // 🟢 4. بناء الـ HTML النهائي للـ Sidebar (تقييم واحد + زرار)
        let sidebarHtml = `
            <div class="gd-rating-group" style="--pill-color:${cfg.color || '#fff'}">
                ${singlePillHtml}
            </div>
        `;

        if (totalRatingsCount > 1) {
            const moreCount = totalRatingsCount - 1;
            sidebarHtml += `
                <button class="gd-more-ratings-btn" onclick="document.getElementById('gdTabBtn-ratings').click()">
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                    See all ${totalRatingsCount} ratings
                </button>
            `;
        }

        scoreEl.innerHTML = `<div class="gd-ratings-row">${sidebarHtml}</div>`;
        scoreEl.style.fontSize = '';
        if (starsEl) starsEl.innerHTML = '';
        if (ratingLabelEl) ratingLabelEl.textContent = '';
    }

    // ── Trailer Section (below fold — deferred) ────────────────────
    requestAnimationFrame(() => {

    // ── Trailer Section ──────────────────────────────────────────
    // YouTube embeds مش بتشتغل في Electron (Error 153)
    // الحل: نعرض thumbnail + زرار يفتح في المتصفح، زي ما accounts.js بيعمل
    const trailerSection = document.getElementById('gdTrailerSection');
    const trailerExtBtn  = document.getElementById('gdTrailerExtBtn');
    const rawTrailers = (info.allTrailers || (info.trailer ? [{
        name: 'Trailer',
        url: info.trailer,
        thumbUrl: (() => {
            const ytId = extractYouTubeVideoId(info.trailer);
            return ytId ? `https://img.youtube.com/vi/${ytId}/maxresdefault.jpg` : null;
        })()
    }] : [])).filter(t => t?.url && !String(t.url).includes('undefined'));

const allTrailers = _gdSortTrailersForPlayback(rawTrailers);

    if (allTrailers.length > 0 && trailerSection) {
        trailerSection.style.display = 'block';

        // ── المشغل الرئيسي ────────────────────────────────
        const trailerWrap = trailerSection.querySelector('.gd-trailer-wrap');
        if (trailerWrap) {
            _gdRenderTrailerPlayer(trailerWrap, allTrailers, 0);
        }

        // ── Thumbnails لو في أكتر من واحد (بالـ Slider والأسهم) ────────────────
        const thumbsContainer = document.getElementById('gdTrailerThumbs');
        if (thumbsContainer && allTrailers.length > 1) {
            
            // 1. نظبط الكونتينر الأساسي عشان يستوعب الأسهم ويبقى بلوك
            thumbsContainer.style.display = 'block';
            thumbsContainer.style.position = 'relative';
            thumbsContainer.style.marginTop = '16px';
            
            // 2. نحدد هل محتاجين أسهم ولا لأ (لو أكتر من 4 فيديوهات هيظهر الأسهم)
            const showArrows = allTrailers.length > 4;

            // 3. نبني التريلرات (عملناها flex-shrink: 0 عشان متتكبسش)
            // 3. نبني التريلرات (عملناها flex-shrink: 0 عشان متتكبسش)
            // Resolve the best thumbnail for each trailer:
            // 1. custom thumbnail (t.thumbnail)  2. t.thumbUrl  3. YouTube auto-thumb  4. hero/cover (never app_icon)
            const coverFallback = (game.heroImage || game.image || '').replace(/\\/g, '/');

            const thumbsHtml = allTrailers.map((t, i) => {
                // Derive YouTube thumb from the embed/watch URL if available
                let ytThumb = '';
                const ytMatch = (t.url || '').match(/(?:youtube\.com\/(?:embed\/|watch\?v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
                if (ytMatch) ytThumb = `https://img.youtube.com/vi/${ytMatch[1]}/mqdefault.jpg`;

                const bestThumb =
                t.thumbnail ||
                t.thumbUrl ||
                t.thumbnailUrl ||
                t.thumbnail_url ||
                t.poster ||
                t.posterUrl ||
                t.poster_url ||
                ytThumb ||
                coverFallback;
                const borderColor = i === 0 ? 'var(--accent)' : 'rgba(255,255,255,0.1)';
                const marginLeft  = showArrows && i === 0 ? '38px' : '0';
                const marginRight = showArrows && i === allTrailers.length - 1 ? '38px' : '0';

                const imgOrPh = bestThumb
                    ? `<img src="${_gdEscHtml(bestThumb)}" alt="${_gdEscHtml(t.name)}"
                             style="width:130px;height:73px;object-fit:cover;border-radius:6px;
                                    border:2px solid ${borderColor};display:block;"
                             onerror="this.onerror=null;this.style.display='none';this.nextElementSibling.style.display='flex';">
                       <div style="display:none;width:130px;height:73px;border-radius:6px;
                                   border:2px solid ${borderColor};background:#0d0d12;
                                   align-items:center;justify-content:center;color:rgba(255,255,255,0.25);">
                           <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                       </div>`
                    : `<div style="width:130px;height:73px;border-radius:6px;
                                  border:2px solid ${borderColor};background:#0d0d12;
                                  display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.25);">
                           <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                       </div>`;

                return `
                <div class="gd-trailer-thumb" data-idx="${i}"
                     style="cursor:pointer;text-align:center;opacity:${i===0?1:0.55};transition:opacity 0.2s;flex-shrink:0;
                            margin-left:${marginLeft};margin-right:${marginRight};">
                    ${imgOrPh}
                    <div style="font-size:0.68rem;color:var(--gd-text-muted);margin-top:5px;
                                max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                        ${_gdEscHtml(t.name)}
                    </div>
                </div>`;
            }).join('');

            // 4. نبني الأسهم (تصميم شيك بـ blur)
            const leftArrow = showArrows ? `
                <button onclick="document.getElementById('gd-thumbs-scroll').scrollBy({left: -200, behavior: 'smooth'})" 
                        style="position: absolute; left: 0; top: 0; height: 73px; width: 32px; background: rgba(0,0,0,0.85); color: white; border: 1px solid rgba(255,255,255,0.1); cursor: pointer; z-index: 2; border-radius: 6px; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(4px); transition: 0.2s; box-shadow: 5px 0 15px rgba(0,0,0,0.5);" 
                        onmouseover="this.style.background='rgba(255,255,255,0.15)'" onmouseout="this.style.background='rgba(0,0,0,0.85)'">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
                </button>` : '';

            const rightArrow = showArrows ? `
                <button onclick="document.getElementById('gd-thumbs-scroll').scrollBy({left: 200, behavior: 'smooth'})" 
                        style="position: absolute; right: 0; top: 0; height: 73px; width: 32px; background: rgba(0,0,0,0.85); color: white; border: 1px solid rgba(255,255,255,0.1); cursor: pointer; z-index: 2; border-radius: 6px; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(4px); transition: 0.2s; box-shadow: -5px 0 15px rgba(0,0,0,0.5);" 
                        onmouseover="this.style.background='rgba(255,255,255,0.15)'" onmouseout="this.style.background='rgba(0,0,0,0.85)'">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                </button>` : '';

            // 5. نحط المزيج ده كله جوه الكونتينر
            thumbsContainer.innerHTML = `
                ${leftArrow}
                <div id="gd-thumbs-scroll" style="display: flex; gap: 8px; overflow-x: auto; scroll-behavior: smooth; scrollbar-width: none; padding-bottom: 5px;">
                    ${thumbsHtml}
                </div>
                ${rightArrow}
            `;

            // 6. السحر هنا: إخفاء شريط السكرول المزعج من المتصفح عشان يبان إنه Custom
            if (!document.getElementById('hide-scroll-style')) {
                const style = document.createElement('style');
                style.id = 'hide-scroll-style';
                style.innerHTML = `#gd-thumbs-scroll::-webkit-scrollbar { display: none; }`;
                document.head.appendChild(style);
            }

            // 7. كليك على الـ thumbnail يغير المشغل
            thumbsContainer.querySelectorAll('.gd-trailer-thumb').forEach(el => {
                el.addEventListener('click', () => {
                    const idx = parseInt(el.dataset.idx);
                    if (trailerWrap) _gdRenderTrailerPlayer(trailerWrap, allTrailers, idx);
                    // تحديث الـ active state
                    thumbsContainer.querySelectorAll('.gd-trailer-thumb').forEach((t, i) => {
                        t.style.opacity = i === idx ? '1' : '0.55';
                        t.querySelector('img').style.border = i === idx
                            ? '2px solid var(--accent)'
                            : '2px solid rgba(255,255,255,0.1)';
                    });
                });
            });
        } else if (thumbsContainer) {
            thumbsContainer.style.display = 'none';
        }

    } else if (trailerSection) {
        // No trailer — show screenshots as a photo gallery in the trailer section
        // Deduplicate first, then use ALL screenshots (not just first 8)
        const _seenFallback = new Set();
        const fallbackScreenshots = (info.screenshots || []).filter(url => {
            if (!url || _seenFallback.has(url)) return false;
            _seenFallback.add(url);
            return true;
        });
        if (fallbackScreenshots.length > 0) {
            trailerSection.style.display = 'block';

            // Hide the "Trailer" section title — this is a screenshot gallery, not a trailer
            const trailerTitle = trailerSection.querySelector('.gd-section-title, h3, .section-title, [class*="title"]');
            if (trailerTitle) trailerTitle.style.display = 'none';

            // Set lightbox images to the FULL deduplicated list so lightbox shows all screenshots
            _gdLightboxImages = fallbackScreenshots;

            const trailerWrap = trailerSection.querySelector('.gd-trailer-wrap');
            const thumbsContainer = document.getElementById('gdTrailerThumbs');

            if (trailerWrap) {
                // Show first screenshot with prev/next arrows
                const arrowBtnStyle = `
                    position:absolute;top:50%;transform:translateY(-50%);
                    z-index:3;background:rgba(0,0,0,0.65);border:1px solid rgba(255,255,255,0.15);
                    color:#fff;cursor:pointer;border-radius:8px;
                    width:38px;height:38px;display:flex;align-items:center;justify-content:center;
                    backdrop-filter:blur(4px);transition:background 0.2s;
                `;
                trailerWrap.innerHTML = `
                    <div id="gd-ss-main-wrap" style="position:relative;width:100%;padding-top:56.25%;border-radius:10px;overflow:hidden;background:#000;">
                        <img id="gd-ss-main-img" src="${fallbackScreenshots[0]}" alt="Screenshot"
                             style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;cursor:zoom-in;"
                             onclick="gdOpenLightbox(window._gdSsCurrentIdx||0)"
                             onerror="this.style.display='none'">
                        ${fallbackScreenshots.length > 1 ? `
                        <button id="gd-ss-prev" style="${arrowBtnStyle}left:10px;"
                            onmouseover="this.style.background='rgba(255,255,255,0.2)'"
                            onmouseout="this.style.background='rgba(0,0,0,0.65)'"
                            onclick="event.stopPropagation();_gdSsNav(-1)">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
                        </button>
                        <button id="gd-ss-next" style="${arrowBtnStyle}right:10px;"
                            onmouseover="this.style.background='rgba(255,255,255,0.2)'"
                            onmouseout="this.style.background='rgba(0,0,0,0.65)'"
                            onclick="event.stopPropagation();_gdSsNav(1)">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                        </button>
                        <div id="gd-ss-counter" style="position:absolute;bottom:10px;right:12px;background:rgba(0,0,0,0.6);color:#fff;font-size:0.75rem;padding:3px 8px;border-radius:20px;backdrop-filter:blur(4px);">
                            1 / ${fallbackScreenshots.length}
                        </div>
                        ` : ''}
                    </div>
                `;
                // Store screenshots list and current index globally for the nav function
                window._gdSsImages = fallbackScreenshots;
                window._gdSsCurrentIdx = 0;
                window._gdSsNav = function(dir) {
                    const imgs = window._gdSsImages || [];
                    if (imgs.length === 0) return;
                    window._gdSsCurrentIdx = (window._gdSsCurrentIdx + dir + imgs.length) % imgs.length;
                    const idx = window._gdSsCurrentIdx;
                    const mainImg = document.getElementById('gd-ss-main-img');
                    if (mainImg) mainImg.src = imgs[idx];
                    const counter = document.getElementById('gd-ss-counter');
                    if (counter) counter.textContent = `${idx + 1} / ${imgs.length}`;
                    // Sync thumbnail highlight
                    document.querySelectorAll('#gdTrailerThumbs [onclick^="gdOpenLightbox"]').forEach((el, i) => {
                        const img = el.querySelector('img');
                        if (img) img.style.border = i === idx ? '2px solid var(--accent)' : '2px solid rgba(255,255,255,0.1)';
                        el.style.opacity = i === idx ? '1' : '0.6';
                    });
                };
            }

            // Thumbnails for the rest
            if (thumbsContainer && fallbackScreenshots.length > 1) {
                thumbsContainer.style.display = 'block';
                thumbsContainer.innerHTML = `
                    <div style="display:flex;gap:8px;overflow-x:auto;scroll-behavior:smooth;scrollbar-width:none;padding-bottom:5px;">
                        ${fallbackScreenshots.map((url, i) => `
                            <div onclick="gdOpenLightbox(${i})"
                                 style="cursor:pointer;flex-shrink:0;opacity:${i===0?1:0.6};transition:opacity 0.2s;"
                                 onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='${i===0?1:0.6}'">
                                <img src="${url}" alt="Screenshot ${i+1}"
                                     style="width:130px;height:73px;object-fit:cover;border-radius:6px;
                                            border:2px solid ${i===0?'var(--accent)':'rgba(255,255,255,0.1)'};display:block;"
                                     onerror="this.parentElement.style.display='none'">
                            </div>
                        `).join('')}
                    </div>
                `;
            } else if (thumbsContainer) {
                thumbsContainer.style.display = 'none';
            }
        } else {
            trailerSection.style.display = 'none';
        }
    }
    // Screenshots & Artworks
    // 📸 Screenshots ONLY (بدون أي Artworks أو لوجوهات)
    // 📸 Screenshots ONLY
    const screenshotsEl = document.getElementById('gdScreenshots');
    if (screenshotsEl) {
        // Deduplicate by URL — server sometimes returns same URL multiple times
        const seen = new Set();
        const allMedia = (info.screenshots || []).filter(url => {
            if (!url || seen.has(url)) return false;
            seen.add(url);
            return true;
        });

        if (allMedia.length > 0) {
            // Only set _gdLightboxImages here if not already set by the fallback gallery above
            // (fallback gallery runs when there's no trailer and sets _gdLightboxImages to the full deduped list)
            _gdLightboxImages = allMedia;
            screenshotsEl.innerHTML = allMedia.map((url, i) => `
                <div class="gd-screenshot-thumb" data-idx="${i}" data-loaded="0">
                    <img src="${url}"
                         ${i < 2 ? 'loading="eager"' : 'loading="lazy"'}
                         decoding="async"
                         alt="Screenshot"
                         onload="this.parentElement.dataset.loaded='1'; this.parentElement.classList.add('loaded')"
                         onerror="this.parentElement.style.display='none'">
                </div>
            `).join('');

            // Attach click listeners — only fires once the thumb image has fully loaded
            screenshotsEl.querySelectorAll('.gd-screenshot-thumb').forEach(el => {
                el.addEventListener('click', () => {
                    if (el.dataset.loaded !== '1') return;
                    const idx = Number(el.dataset.idx);
                    gdOpenLightbox(idx);
                });
            });
        } else {
            screenshotsEl.innerHTML = '<div class="gd-no-media">No screenshots available.</div>';
        }
    }
    // 3. تحديث الـ Info Grid عشان يقرا الداتا الجديدة من IGDB
    _gdBuildInfoGrid(game, info);

    // Genres
    const genresSection = document.getElementById('gdGenresSection');
    const genresList = document.getElementById('gdGenres');
    if (info.genres && info.genres.length > 0 && genresSection && genresList) {
        genresSection.style.display = 'block';
        genresList.innerHTML = info.genres.map(g => `<span class="gd-genre-tag">${escapeHtml(g)}</span>`).join('');
    } else if (genresSection) {
        genresSection.style.display = 'none';
    }

    // 4. إخفاء Requirements لو مش موجودة (لأن IGDB مش بيوفرها كنص زي RAWG)
    const reqSection = document.getElementById('gdTab-requirements');
    const reqTabBtn  = document.querySelector('.gd-tab[data-tab="requirements"]');
    if (info.requirements) {
        if (reqTabBtn) reqTabBtn.style.display = '';
        _gdPopulateRequirements(info);
    } else {
        // إخفاء تاب المتطلبات عشان ميفضلش فاضي
        if (reqTabBtn) reqTabBtn.style.display = 'none';
        if (reqSection) reqSection.style.display = 'none';
    }

    // Sidebar detail list
    _gdBuildDetailList(game, info);

    // لو الإنجازات اتحمّلت قبل الـ metadata، نحدّث النِّسَب بعد ما يتوفر achievementsTotal
    _gdRefreshAchievementsUIFromCache(game);
    if (_gdIsCreatorEditing()) _gdBindCreatorEditables();
    }); // end rAF below-fold
}

/** إعادة رسم بطاقات الإنجازات من الـ sessionStorage بعد تحديث _gdCurrentMeta (مثلاً إجمالي الإنجازات من المتجر). */
function _gdRefreshAchievementsUIFromCache(game) {
    if (!game?.id || String(_gdCurrentGameId) !== String(game.id)) return;

    const container = document.getElementById('gdAchievementsList');
    if (!container) return;

    const steamAppId = _gdExtractSteamAppId(game);
    if (!steamAppId) return;

    const cacheKey = `ach_v5_no_empty_steam_${steamAppId}`;
    const cached = sessionStorage.getItem(cacheKey);
    if (!cached) return;

    try {
        const parsed = JSON.parse(cached);

        if (_gdIsUsefulAchievementsResponse(parsed)) {
            _gdRenderAchievements(container, parsed);
            return;
        }

        console.warn('[GD][Achievements] removing non-useful cache from refresh:', cacheKey);
        sessionStorage.removeItem(cacheKey);
    } catch (_) {
        sessionStorage.removeItem(cacheKey);
    }
}

function _gdNormalizeSteamAppId(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;

    const cleaned = raw
        .replace(/^steam[-_]/i, '')
        .replace(/^steam:\/+run\//i, '')
        .trim();

    const match = cleaned.match(/\b(\d{2,10})\b/);
    return match ? match[1] : null;
}

function _gdExtractSteamAppIdFromRecord(record) {
    if (!record || typeof record !== 'object') return null;

    // 1) صريح من allIds
    const fromAllIds = _gdNormalizeSteamAppId(record.allIds?.steam);
    if (fromAllIds) return fromAllIds;

    // 2) صريح من حقول Steam الشائعة
    const directFields = [
        record.steamAppId,
        record.steam_appid,
        record.appid,
        record.appId,
    ];

    for (const v of directFields) {
        const id = _gdNormalizeSteamAppId(v);
        if (id) return id;
    }

    // 3) لو الريكورد نفسه Steam، نسمح باستخراج ID من launcherGameId/id/command
    const platformText = [
        record.platform,
        record.scannerPlatform,
        record.sourcePlatform,
        record._platform,
    ].filter(Boolean).join(' ').toLowerCase();

    const looksSteam =
        platformText.includes('steam') ||
        String(record.id || '').toLowerCase().startsWith('steam-') ||
        String(record.command || record.launchCommand || '').toLowerCase().includes('steam://run/');

    if (looksSteam) {
        const candidates = [
            record.launcherGameId,
            record.id,
            record.command,
            record.launchCommand,
            record.appName,
        ];

        for (const v of candidates) {
            const id = _gdNormalizeSteamAppId(v);
            if (id) return id;
        }
    }

    return null;
}

function _gdExtractSteamAppId(game) {
    if (!game) return null;

    // 1) حاول strict resolver الأول زي القديم
    try {
        const strictId = window._baddelGetStrictSteamAppId?.(game);
        const normalized = _gdNormalizeSteamAppId(strictId);
        if (normalized) return normalized;
    } catch (_) {}

    // 2) حاول من الريكورد الحالي نفسه
    const direct = _gdExtractSteamAppIdFromRecord(game);
    if (direct) return direct;

    // 3) المهم: لو اللعبة multi-platform، دور في كل installed matches
    // ممكن الريكورد الحالي Epic، لكن فيه match تاني Steam بنفس اللعبة.
    try {
        const matches = typeof window._agFindInstalledLocalMatches === 'function'
            ? window._agFindInstalledLocalMatches(game)
            : [];

        for (const match of matches || []) {
            const id = _gdExtractSteamAppIdFromRecord(match);
            if (id) {
                console.log(`[GD][Achievements] Steam appid resolved from multi-platform match: ${id}`);
                return id;
            }
        }
    } catch (err) {
        console.warn('[GD][Achievements] multi-platform Steam lookup failed:', err?.message || err);
    }

    return null;
}

function _gdExtractOwnerAccountIds(game) {
    if (!game || typeof game !== 'object') return [];
    const ids = [];
    if (Array.isArray(game.steamLicensedAccountIds)) ids.push(...game.steamLicensedAccountIds);
    if (Array.isArray(game.ownedByAccountIds)) ids.push(...game.ownedByAccountIds);
    // steamDetectedAccountIds intentionally excluded — install detection is not licensed ownership.
    return [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))];
}

const _gdAchievementsEmptyRetries = new Map();

function _gdIsUsefulAchievementsResponse(res) {
    if (!res || res.status !== 'success') return false;

    const rows = Array.isArray(res.accounts) ? res.accounts : [];
    if (!rows.length) return false;

    return rows.some(acc => {
        const total = Number(acc.totalCount || 0);
        const allLen = Array.isArray(acc.allAchievements) ? acc.allAchievements.length : 0;
        const unlockedLen = Array.isArray(acc.unlocked) ? acc.unlocked.length : 0;
        const previewLen = Array.isArray(acc.unlockedPreview) ? acc.unlockedPreview.length : 0;

        // error/skipped دي حالة مفيدة للعرض، مش empty silent
        if (acc.error || acc.skipped) return true;

        return total > 0 || allLen > 0 || unlockedLen > 0 || previewLen > 0;
    });
}

function _gdIsTransientEmptyAchievementsResponse(res) {
    if (!res || res.status !== 'success') return false;

    const rows = Array.isArray(res.accounts) ? res.accounts : [];
    if (!rows.length) return false;

    // كل الحسابات رجعت بدون error وبدون total وبدون أي achievements
    return rows.every(acc => {
        const total = Number(acc.totalCount || 0);
        const allLen = Array.isArray(acc.allAchievements) ? acc.allAchievements.length : 0;
        const unlockedLen = Array.isArray(acc.unlocked) ? acc.unlocked.length : 0;
        const previewLen = Array.isArray(acc.unlockedPreview) ? acc.unlockedPreview.length : 0;

        return !acc.error && !acc.skipped && total <= 0 && allLen === 0 && unlockedLen === 0 && previewLen === 0;
    });
}

function _gdScheduleAchievementsRetry(game, cacheKey, reason = 'empty') {
    const steamAppId = _gdExtractSteamAppId(game);
    const key = `${steamAppId || game?.id || _gdCurrentGameId}`;

    const count = _gdAchievementsEmptyRetries.get(key) || 0;
    const delays = [3000, 7000, 15000];

    if (count >= delays.length) {
        console.warn(`[GD][Achievements] stop empty retries for ${key} after ${count} attempts`);
        return;
    }

    _gdAchievementsEmptyRetries.set(key, count + 1);

    const delay = delays[count];

    console.log(`[GD][Achievements] transient empty; retry #${count + 1} in ${delay}ms (${reason})`);

    sessionStorage.removeItem(cacheKey);

    setTimeout(() => {
        if (String(_gdCurrentGameId || '') !== String(game?.id || '')) return;

        const activeTab = document.querySelector('.gd-tab-btn.active')?.dataset?.tab;
        if (activeTab && activeTab !== 'achievements') return;

        _gdPopulateAchievements(game);
    }, delay);
}

async function _gdPopulateAchievements(game) {
    const container = document.getElementById('gdAchievementsList');
    if (!container) return;
    const loadGen = _gdAchievementsGen;

    const steamAppId = _gdExtractSteamAppId(game);
    if (!steamAppId) {
        container.innerHTML = '<div class="gd-no-accounts">Achievements comparison is available for Steam games only.</div>';
        return;
    }

    // Cache key includes platform+appid to prevent bleed between different games/platforms
    const cacheKey = `ach_v5_no_empty_steam_${steamAppId}`;

const cachedData = sessionStorage.getItem(cacheKey);
if (cachedData) {
    try {
        const parsed = JSON.parse(cachedData);

        if (_gdIsUsefulAchievementsResponse(parsed)) {
            console.log('[GD][Achievements] useful session cache HIT:', cacheKey);
            _gdRenderAchievements(container, parsed);
            return;
        }

        console.warn('[GD][Achievements] ignoring transient empty session cache:', cacheKey);
        sessionStorage.removeItem(cacheKey);
    } catch (e) {
        sessionStorage.removeItem(cacheKey);
    }
}

    const invokeAch = window.electronAPI.getGameAchievements;
    if (typeof invokeAch !== 'function') {
        if (!sessionStorage.getItem(cacheKey)) {
            container.innerHTML = '<div class="gd-no-accounts">Achievements are not available in this build.</div>';
        }
        return;
    }

    // Must exceed main process + Steam bridge (up to ~180s for slow CM / PICS / stats import).
    const ACHIEVEMENTS_IPC_MS = 200000;
    try {
        const res = await Promise.race([
            invokeAch({
                appId: steamAppId,
                gameName: game.name,
                id: game.id,
                allIds: game.allIds,
                command: game.command,
                ownerAccountIds: _gdExtractOwnerAccountIds(game),
            }),
            new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Achievements request timed out')), ACHIEVEMENTS_IPC_MS);
            }),
        ]);

        if (!res || res.status !== 'success') {
            if (loadGen !== _gdAchievementsGen) return;
            sessionStorage.removeItem(cacheKey);
            _gdScheduleAchievementsRetry(game, cacheKey, 'api-error');
            if (!sessionStorage.getItem(cacheKey)) {
                container.innerHTML = '<div class="gd-no-accounts" style="opacity:0.6;font-style:italic;">Loading Steam achievements… retrying.</div>';
            }
            return;
        }

        // 2. Check for transient empty before caching
        if (_gdIsTransientEmptyAchievementsResponse(res)) {
            if (loadGen !== _gdAchievementsGen) return;
            console.warn('[GD][Achievements] transient empty response — not caching, scheduling retry');
            sessionStorage.removeItem(cacheKey);
            container.innerHTML = '<div class="gd-no-accounts" style="opacity:0.6;font-style:italic;">Loading Steam achievements… retrying.</div>';
            _gdScheduleAchievementsRetry(game, cacheKey, 'transient-empty');
            return;
        }

        // 3. Only cache useful responses
        if (_gdIsUsefulAchievementsResponse(res)) {
            sessionStorage.setItem(cacheKey, JSON.stringify(res));
        }

        // 4. عرض البيانات الجديدة
        if (loadGen !== _gdAchievementsGen) return;
        _gdRenderAchievements(container, res);
    } catch (e) {
        // console.warn('GD: achievements load failed', e);
        if (loadGen !== _gdAchievementsGen) return;
        sessionStorage.removeItem(cacheKey);
        _gdScheduleAchievementsRetry(game, cacheKey, 'exception');
        if (!sessionStorage.getItem(cacheKey)) {
            container.innerHTML = '<div class="gd-no-accounts" style="opacity:0.6;font-style:italic;">Loading Steam achievements… retrying.</div>';
        }
    }
}

function _gdNormalizeAchievementIconUrl(raw, appId) {
    const s = String(raw || '').trim();
    if (!s) return '';

    // already valid URL / data / local
    if (/^(https?:\/\/|file:\/\/|data:image\/|blob:)/i.test(s)) {
        return s;
    }

    // Steam icon hash, usually 40 hex chars
    if (/^[a-f0-9]{32,64}$/i.test(s) && appId) {
        return `https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/${appId}/${s}.jpg`;
    }

    return s;
}

function _gdRenderAchievements(container, res) {
    const rows = Array.isArray(res.accounts) ? res.accounts : [];
    if (!rows.length) {
        container.innerHTML = '<div class="gd-no-accounts">No Steam accounts linked yet.</div>';
        return;
    }

    const totalAchievements = Number(_gdCurrentMeta?.info?.achievementsTotal || 0) || null;
    const esc = (v) => String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    container.innerHTML = rows.map((acc) => {
        const unlockedCount = Number(acc.unlockedCount || 0);
        // Prefer per-account total from Steam (authoritative); fall back to game metadata total.
        // Never fake 100% by using unlocked count as denominator.
        const steamTotal = (acc.totalCount != null && Number(acc.totalCount) > 0) ? Number(acc.totalCount) : null;
        const knownTotal = steamTotal ?? totalAchievements;
        const percent = knownTotal !== null
            ? Math.max(0, Math.min(100, Math.round((unlockedCount / knownTotal) * 100)))
            : null;
        const summary = knownTotal !== null
            ? `${unlockedCount}/${knownTotal} unlocked`
            : `${unlockedCount} unlocked`;
        const subLine = acc.error || summary;
        const allAchievements = Array.isArray(acc.allAchievements)
    ? acc.allAchievements
    : [];

const preview = allAchievements.length
    ? allAchievements
        .slice()
        .sort((a, b) => {
            const au = a.unlocked === true ? 0 : 1;
            const bu = b.unlocked === true ? 0 : 1;
            if (au !== bu) return au - bu;

            // المفتوح الأحدث الأول، وبعده المقفول بنفس ترتيب Steam
            return Number(b.unlockTime || 0) - Number(a.unlockTime || 0);
        })
    : (Array.isArray(acc.unlockedPreview) ? acc.unlockedPreview : []);

        const previewHtml = preview.length
            ? `
                <div class="gd-ach-items">
                    ${preview.map((it) => {
                        const isLocked = it?.unlocked === false || it?.locked === true;

                    const ts = Number(it?.unlockTime || 0);

                    const when = isLocked
                        ? 'Locked'
                        : (ts > 0 ? new Date(ts * 1000).toLocaleDateString(undefined, {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                        }) : 'Unlocked');

                    const appIdForIcon = String(res?.appId || _gdExtractSteamAppId(_gdCurrentGame) || '').trim();
                    const rawIcon = isLocked
                        ? (
                            it?.iconGray ||
                            it?.icon_gray ||
                            it?.icon_gray_url ||
                            it?.icongray ||
                            it?.icon ||
                            ''
                        )
                        : (
                            it?.icon ||
                            it?.iconUrl ||
                            it?.icon_url ||
                            it?.iconGray ||
                            it?.icon_gray ||
                            ''
                        );

                    const iconUrl = _gdNormalizeAchievementIconUrl(rawIcon, appIdForIcon);

                    const iconHtml = `
                        <div class="gd-ach-icon-wrapper ${iconUrl ? '' : 'gd-ach-icon-missing'}">
                            ${
                                iconUrl
                                    ? `<img src="${esc(iconUrl)}"
                                        class="gd-ach-icon"
                                        loading="lazy"
                                        onerror="this.onerror=null; this.style.display='none'; this.parentElement.classList.add('gd-ach-icon-missing');"
                                    />`
                                    : ''
                            }
                        </div>
                    `;
                        
                        return `
                            <div class="gd-ach-item ${isLocked ? 'gd-ach-locked' : 'gd-ach-unlocked'}">
                                ${iconHtml}
                                <div class="gd-ach-info">
                                    <div class="gd-ach-item-name">${esc(it?.name || 'Achievement')}</div>
                                    <div class="gd-ach-item-desc">${esc(it?.description || '')}</div>
                                </div>
                                <div class="gd-ach-item-time ${isLocked ? 'gd-ach-item-locked-time' : ''}">
                                    ${esc(when)}
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            `
            : '';
        return `
            <div class="gd-ach-card">
                <div class="gd-ach-head">
                    <div class="gd-ach-name">${esc(acc.displayName || acc.accountId)}</div>
                    <div class="gd-ach-meta">${percent !== null ? `${percent}%` : '—'}</div>
                </div>
                <div class="gd-ach-bar"><div class="gd-ach-fill" style="width:${percent !== null ? percent : 0}%"></div></div>
                <div class="gd-ach-sub">${esc(subLine)}</div>
                ${previewHtml}
            </div>
        `;
    }).join('');
}

// ──────────────────────────────────────────
//  TRAILER PLAYER — thumbnail + open in browser
//  (YouTube embeds مش بتشتغل في Electron)
// ──────────────────────────────────────────
// ──────────────────────────────────────────
//  TRAILER PLAYER — مدمج بالكامل داخل التطبيق
// ──────────────────────────────────────────
// ──────────────────────────────────────────
//  TRAILER PLAYER — مدمج بالكامل داخل التطبيق
// ──────────────────────────────────────────
// ──────────────────────────────────────────
//  TRAILER PLAYER — مدمج بالكامل داخل التطبيق
// ──────────────────────────────────────────
// ──────────────────────────────────────────
//  TRAILER PLAYER — GOG/Epic Style Trick
// ──────────────────────────────────────────
// ──────────────────────────────────────────
//  TRAILER PLAYER — GOG/Epic Style Trick (Final Fix)
// ─── Trailer URL helpers ──────────────────────────────────────────────────────

function _gdNormalizeTrailerUrl(url) {
    if (!url || typeof url !== 'string') return '';
    const s = url.trim();
    if (!s || s.includes('undefined')) return '';
    return s;
}

function _gdGetYouTubeId(url) {
    return extractYouTubeVideoId(url);
}

function _gdToYouTubeEmbedUrl(url) {
    const id = _gdGetYouTubeId(url);
    if (!id) return '';
    return `https://www.youtube.com/embed/${id}?autoplay=1&rel=0&modestbranding=1&playsinline=1`;
}

function _gdIsDirectVideoUrl(url) {
    if (!url) return false;
    const s = String(url).trim();
    if (s.startsWith('blob:') || s.startsWith('data:video/') || s.startsWith('file://')) return true;
    let u;
    try { u = new URL(s); } catch { return false; }
    const p = u.pathname.toLowerCase();
    return (
        /\.(mp4|webm|ogg|ogv|mov|m4v)$/.test(p) ||
        /\.(m3u8|mpd)$/.test(p)
    );
}

function _gdCanPlayDirectVideo(url) {
    if (!url) return false;
    const s = String(url).trim();
    if (s.startsWith('blob:') || s.startsWith('data:video/') || s.startsWith('file://')) return true;
    let u;
    try { u = new URL(s); } catch { return false; }
    const p = u.pathname.toLowerCase();
    // For all recognised video extensions, return true — HLS.js and dash.js are
    // loaded lazily and the library check happens at attach time, not here.
    return (
        /\.(mp4|webm|ogg|ogv|mov|m4v)$/.test(p) ||
        /\.(m3u8|mpd)$/.test(p)
    );
}

function showTrailerFallback(container, url, message) {
    const msg = message || 'Trailer cannot be played inside the launcher';
    const s = url ? String(url) : '';
    const isHttp = s.startsWith('http://') || s.startsWith('https://');
    const btnHtml = isHttp
        ? `<button style="margin-top:12px;padding:8px 20px;background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.3);border-radius:8px;color:#fff;font-size:13px;cursor:pointer;font-family:inherit;" onclick="if(window.electronAPI&&window.electronAPI.openExternal)window.electronAPI.openExternal(${JSON.stringify(s)})">Open in Browser</button>`
        : '';
    container.style.display = 'block';
    container.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;aspect-ratio:16/9;border-radius:10px;background:#111;color:rgba(255,255,255,0.6);font-size:14px;text-align:center;padding:24px;gap:4px;"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:8px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg><span>${msg}</span>${btnHtml}</div>`;
}

function _gdTrailerUnavailableHtml(rawUrl) {
    const s = rawUrl ? String(rawUrl) : '';
    const msg = s ? 'This trailer URL is not supported inside the launcher.' : 'No trailer URL available.';
    const div = document.createElement('div');
    showTrailerFallback(div, s, msg);
    return div.innerHTML;
}

// ── Script loader: tries each candidate path in order, resolves with the global ──
function _gdLoadLocalScriptOnce(globalName, candidatePaths) {
    return new Promise((resolve, reject) => {
        if (window[globalName]) { resolve(window[globalName]); return; }
        let i = 0;
        const tryNext = () => {
            if (i >= candidatePaths.length) { reject(new Error('Could not load ' + globalName)); return; }
            const s = document.createElement('script');
            s.src = candidatePaths[i++];
            s.onload = () => window[globalName] ? resolve(window[globalName]) : tryNext();
            s.onerror = () => tryNext();
            document.head.appendChild(s);
        };
        tryNext();
    });
}

// ── Build ordered candidate list from trailer.sources or single trailer.url ──
function _gdBuildCandidates(trailer) {
    const safe = typeof safeMediaUrl === 'function' ? safeMediaUrl : (u => u);
    const rawSources = Array.isArray(trailer.sources) && trailer.sources.length > 0
        ? trailer.sources.map(s => ({ kind: s.kind || null, label: s.label || '', url: String(s.url || '').trim() }))
        : [{ kind: null, label: 'Video', url: _gdNormalizeTrailerUrl(trailer.url) }];
    return rawSources
        .map(c => ({ ...c, url: safe(c.url) }))
        .filter(c => c.url && _gdIsDirectVideoUrl(c.url));
}

// ─────────────────────────────────────────────────────────────────────────────
function _gdApplyDefaultTrailerMute(videoEl) {
    if (!videoEl) return;
    videoEl.muted = true;
    videoEl.defaultMuted = true;
    videoEl.setAttribute('muted', '');
}

// ── YouTube <webview> helpers ─────────────────────────────────────────────────

const _YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/**
 * Robust YouTube video-ID extractor.
 * Handles: watch?v=, youtu.be, embed/, shorts/, live/, v/, music.youtube.com,
 * youtube-nocookie.com, raw 11-char IDs, iframe src snippets, extra query params.
 * Returns the 11-char ID or null.
 */
function extractYouTubeVideoId(rawInput) {
    if (!rawInput || typeof rawInput !== 'string') return null;
    const input = rawInput.trim();
    if (!input) return null;

    // Raw 11-char video ID
    if (_YT_ID_RE.test(input)) return input;

    // Iframe embed snippet — extract src attribute value and recurse
    const iframeSrc = input.match(/src=["']([^"']+)["']/);
    if (iframeSrc) return extractYouTubeVideoId(iframeSrc[1]);

    // Try structured URL parsing
    let u;
    try { u = new URL(input); } catch (_) {
        // Fallback regex for malformed/relative URLs
        const m = input.match(
            /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^&\s]*&)*v=|embed\/|v\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
        );
        return m ? m[1] : null;
    }

    const host = u.hostname.replace(/^www\./, '');

    // youtu.be/ID
    if (host === 'youtu.be') {
        const id = u.pathname.slice(1).split('/')[0].split('?')[0];
        return _YT_ID_RE.test(id) ? id : null;
    }

    // youtube.com family (including m., music., youtube-nocookie.com)
    if (host === 'youtube.com' || host === 'youtube-nocookie.com' ||
        host.endsWith('.youtube.com') || host.endsWith('.youtube-nocookie.com')) {

        // ?v= parameter — most common watch URL
        const v = u.searchParams.get('v');
        if (v && _YT_ID_RE.test(v)) return v;

        // Path-based: /embed/ID, /v/ID, /shorts/ID, /live/ID
        const pathMatch = u.pathname.match(/\/(?:embed|v|shorts|live)\/([A-Za-z0-9_-]{11})/);
        if (pathMatch) return pathMatch[1];
    }

    return null;
}

// Backward-compat aliases (kept so existing call-sites don't break)
function _gdParseYouTubeVideoId(url) { return extractYouTubeVideoId(url); }

function _gdBuildYouTubeEmbedUrl(videoId) {
    return `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1&playsinline=1&enablejsapi=1&iv_load_policy=3&cc_load_policy=0&color=white&vq=hd1080&origin=http%3A%2F%2Flocalhost`;
}

function _gdBuildYouTubeWatchUrl(videoId) {
    return `https://www.youtube.com/watch?v=${videoId}&autoplay=1`;
}

function _gdRenderYouTubeWebviewPlayer(container, videoId) {
    const embedUrl = _gdBuildYouTubeEmbedUrl(videoId);
    const watchUrl = _gdBuildYouTubeWatchUrl(videoId);

    // Build thumbnail with play overlay; clicking replaces it with <webview>
    const thumbSrc = `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
    const thumbFallback = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

    const shell = document.createElement('div');
    shell.className = 'gd-youtube-shell';

    const thumb = document.createElement('div');
    thumb.className = 'gd-youtube-thumb';
    thumb.innerHTML = `
        <img src="${thumbSrc}" onerror="this.src='${thumbFallback}'" alt="Trailer thumbnail" draggable="false">
        <div class="gd-youtube-play">
            <svg width="68" height="48" viewBox="0 0 68 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect width="68" height="48" rx="10" fill="rgba(0,0,0,0.7)"/>
                <polygon points="26,14 26,34 48,24" fill="white"/>
            </svg>
        </div>`;

    const openBtn = document.createElement('button');
    openBtn.className = 'gd-yt-open-btn';
    openBtn.title = 'Open in Browser';
    openBtn.textContent = '⬀';
    openBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.electronAPI && window.electronAPI.openExternal) {
            window.electronAPI.openExternal(watchUrl);
        }
    });

    thumb.addEventListener('click', () => {
        thumb.remove();
        openBtn.remove();

        console.debug('[GD][YT]', {
            embedUrl,
            referrer: 'https://store.steampowered.com/',
            partition: 'persist:baddel-youtube-trailers',
        });

        const wv = document.createElement('webview');
        wv.className = 'gd-youtube-webview';
        wv.setAttribute('src', embedUrl);
        wv.setAttribute('partition', 'persist:baddel-youtube-trailers');
        wv.setAttribute('httpreferrer', 'https://store.steampowered.com/');
        wv.setAttribute('useragent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        wv.setAttribute('allowfullscreen', '');
        wv.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');

        // On load failure show the Open-in-Browser fallback instead of trying
        // to load a watch URL (watch pages are not allowed inside the webview).
        wv.addEventListener('did-fail-load', (e) => {
            if (e.errorCode === 0) return; // aborted / navigation — ignore
            console.warn('[GD][YT] webview did-fail-load', e.errorCode, e.errorDescription);
            wv.remove();
            const errMsg = document.createElement('div');
            errMsg.className = 'gd-youtube-error';
            errMsg.innerHTML = `<span>Could not load trailer inside the app.</span>`;
            const errBtn = document.createElement('button');
            errBtn.className = 'gd-yt-open-btn gd-yt-open-btn--inline';
            errBtn.textContent = 'Open in Browser';
            errBtn.addEventListener('click', () => {
                if (window.electronAPI && window.electronAPI.openExternal) {
                    window.electronAPI.openExternal(watchUrl);
                }
            });
            errMsg.appendChild(errBtn);
            shell.appendChild(errMsg);
        });

        shell.appendChild(wv);

        const newOpenBtn = document.createElement('button');
        newOpenBtn.className = 'gd-yt-open-btn';
        newOpenBtn.title = 'Open in Browser';
        newOpenBtn.textContent = '⬀';
        newOpenBtn.addEventListener('click', () => {
            if (window.electronAPI && window.electronAPI.openExternal) {
                window.electronAPI.openExternal(watchUrl);
            }
        });
        shell.appendChild(newOpenBtn);
    });

    shell.appendChild(thumb);
    shell.appendChild(openBtn);
    container.appendChild(shell);
}

// ─────────────────────────────────────────────────────────────────────────────

// _candIdx is internal — callers always pass (container, trailers, idx).
function _getDashVideoQualities(player) {
    const reps = typeof player.getRepresentationsByType === 'function'
        ? player.getRepresentationsByType('video') || []
        : [];

    if (reps.length) {
        return reps.map((rep, index) => ({
            source:  'representation',
            index,
            id:      rep.id,
            width:   rep.width,
            height:  rep.height,
            bitrate: rep.bandwidth || rep.bitrate || rep.bandwidthInKbit,
            raw:     rep
        }));
    }

    const bitrates = typeof player.getBitrateInfoListFor === 'function'
        ? player.getBitrateInfoListFor('video') || []
        : [];

    return bitrates.map((q, index) => ({
        source:  'bitrateInfo',
        index,
        id:      q.id,
        width:   q.width,
        height:  q.height,
        bitrate: q.bitrate,
        raw:     q
    }));
}

function _gdRenderTrailerPlayer(container, trailers, idx, _candIdx) {
    _candIdx = _candIdx || 0;
    const t = trailers[idx];
    if (!t || !t.url) {
        container.style.display = 'none';
        return;
    }

    const rawUrl = _gdNormalizeTrailerUrl(t.url);
    if (!rawUrl) {
        console.warn('[GD] _gdRenderTrailerPlayer: bad URL', t.url);
        container.style.display = 'none';
        return;
    }

    // ── YouTube: detect FIRST, before any direct-video pipeline ─────────────
    const _ytIdEarly = extractYouTubeVideoId(rawUrl);
    const _candidates = _ytIdEarly ? [] : _gdBuildCandidates(t);
    console.debug('[GD][Trailer]', { rawUrl, youtubeId: _ytIdEarly, candidatesCount: _candidates.length });

    if (_ytIdEarly) {
        container.style.display = 'block';
        container.querySelectorAll('video').forEach(v => {
            try { v.pause(); v.removeAttribute('src'); v.load(); } catch (_) {}
        });
        container.querySelectorAll('webview, iframe').forEach(node => {
            try { node.remove(); } catch (_) {}
        });
        container.innerHTML = '';
        _gdRenderYouTubeWebviewPlayer(container, _ytIdEarly);
        return;
    }

    // ── Build and validate candidate list ────────────────────────────────────

    if (_candidates.length === 0) {
        showTrailerFallback(container, rawUrl, 'Trailer URL is not supported inside the launcher');
        return;
    }

    if (_candIdx >= _candidates.length) {
        console.warn('[GD][Trailer] all candidates failed');
        showTrailerFallback(container, rawUrl, 'Trailer cannot be played inside the launcher');
        return;
    }

    const _cand = _candidates[_candIdx];
    console.log(`[GD][Trailer] trying candidate ${_candIdx + 1}/${_candidates.length} kind=${_cand.kind || '?'} url=${_cand.url}`);

    // Called when a candidate definitively fails — tries the next one.
    const _tryNext = (reason) => {
        console.warn(`[GD][Trailer] candidate ${_candIdx + 1} failed reason=${reason}`);
        _gdRenderTrailerPlayer(container, trailers, idx, _candIdx + 1);
    };

    // Tear down any currently playing media before replacing with new player
    container.querySelectorAll('video').forEach(v => {
        try { v.pause(); } catch (_) {}
        try { v.removeAttribute('src'); } catch (_) {}
        try { v.load(); } catch (_) {}
    });
    container.querySelectorAll('webview, iframe').forEach(node => {
        try { node.remove(); } catch (_) {}
    });
    container.innerHTML = '';

    container.style.display = 'block';
    const url = _cand.url;

    // Detect format using pathname so query-strings on .mpd/.m3u8 URLs don't break detection
    let _isDashPath = false;
    try { _isDashPath = /\.mpd$/i.test(new URL(url).pathname); } catch (_) {}
    const isDASH = _isDashPath || url.includes('.mpd');
    const isHLS  = url.includes('.m3u8');

    console.debug('[GD][Trailer] selected candidate', { kind: _cand.kind, url, isDASH, isHLS });

    const isDirect = _gdCanPlayDirectVideo(url);

    if (isDirect) {
        const videoId = `gd-steam-video-${Date.now()}`;

        container.innerHTML = `
            <video id="${videoId}" controls autoplay muted
                style="width:100%; aspect-ratio:16/9; border-radius:10px; background:#000; box-shadow: 0 4px 15px rgba(0,0,0,0.5);">
            </video>
        `;

        const videoEl = container.querySelector(`#${videoId}`);

        // ── Metadata timeout: if duration stays 0 after 10 s, try next candidate ──
        let _metaLoaded = false;
        const _metaTimer = setTimeout(() => {
            if (!document.body.contains(videoEl)) return; // DASH replaced the element
            if (!_metaLoaded || !Number.isFinite(videoEl.duration) || videoEl.duration <= 0) {
                _tryNext('metadata timeout');
            }
        }, 10000);
        videoEl.addEventListener('loadedmetadata', () => {
            _metaLoaded = true;
            clearTimeout(_metaTimer);
        }, { once: true });
        videoEl.addEventListener('error', () => {
            clearTimeout(_metaTimer);
            _tryNext('video error');
        }, { once: true });

        if (isHLS) {
            // ── HLS stream (Steam hls_h264) → HLS.js ──────────────────
            const _attachHls = (Hls) => {
                if (Hls.isSupported()) {
                    const hls = new Hls({ enableWorker: false });
                    hls.loadSource(url);
                    hls.attachMedia(videoEl);
                    hls.on(Hls.Events.MANIFEST_PARSED, () => videoEl.play().catch(() => {}));
                    hls.on(Hls.Events.ERROR, (_, data) => {
                        if (data.fatal) { clearTimeout(_metaTimer); _tryNext('hls fatal error'); }
                    });
                } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
                    // Safari / Electron native HLS
                    videoEl.src = url;
                    videoEl.play().catch(() => {});
                } else {
                    _tryNext('hls not supported');
                }
            };

            _gdLoadLocalScriptOnce('Hls', ['../node_modules/hls.js/dist/hls.min.js'])
                .then(Hls => _attachHls(Hls))
                .catch(() => _tryNext('hls.js load failed'));

        } else if (isDASH) {
            // ── DASH stream (Steam dash_h264 / dash_av1) → dash.js ────
            // Custom controls bar so the gear sits inline with play/volume/fullscreen.

            const wrapperId = `gd-dash-wrap-${Date.now()}`;
            const SVG_PLAY = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
            const SVG_PAUSE = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
            const SVG_VOL = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`;
            const SVG_MUTE = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`;
            const SVG_FS = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;
            const SVG_MINI = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><rect x="12" y="11" width="8" height="6" rx="1" fill="currentColor" stroke="none"/></svg>`;
            const SVG_GEAR_QS = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
            const SVG_CHECK_QS = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><polyline points="20 6 9 17 4 12"/></svg>`;

            const btnStyle = `background:transparent;border:none;color:#fff;cursor:pointer;padding:4px 6px;display:flex;align-items:center;justify-content:center;opacity:0.85;transition:opacity 0.15s;flex-shrink:0;`;

            container.innerHTML = `
                <div id="${wrapperId}" style="position:relative;width:100%;aspect-ratio:16/9;border-radius:10px;overflow:hidden;background:#000;box-shadow:0 4px 15px rgba(0,0,0,0.5);">

                    <video id="${videoId}" autoplay muted
                        style="width:100%;height:100%;display:block;cursor:pointer;">
                    </video>

                    <!-- Custom controls bar -->
                    <div id="${videoId}-ctrl" style="
                        position:absolute;bottom:0;left:0;right:0;
                        background:linear-gradient(transparent, rgba(0,0,0,0.75));
                        padding:8px 10px 6px;
                        display:flex;flex-direction:column;gap:6px;
                        opacity:0;transition:opacity 0.2s;
                        border-radius:0 0 10px 10px;
                    ">
                        <!-- Progress bar -->
                        <div id="${videoId}-prog-wrap" style="width:100%;height:4px;background:rgba(255,255,255,0.2);border-radius:2px;cursor:pointer;position:relative;">
                            <div id="${videoId}-prog" style="height:100%;width:0%;background:#fff;border-radius:2px;pointer-events:none;"></div>
                        </div>

                        <!-- Buttons row -->
                        <div style="display:flex;align-items:center;gap:2px;">
                            <!-- Play/Pause -->
                            <button id="${videoId}-playbtn" style="${btnStyle}" title="Play/Pause">${SVG_PLAY}</button>

                            <!-- Volume -->
                            <button id="${videoId}-volbtn" style="${btnStyle}" title="Mute/Unmute">${SVG_MUTE}</button>
                            <input id="${videoId}-volslider" type="range" min="0" max="1" step="0.05" value="1" style="
                                width:60px;height:3px;cursor:pointer;accent-color:#fff;opacity:0.85;
                            ">

                            <!-- Time -->
                            <span id="${videoId}-time" style="color:#fff;font-size:11px;opacity:0.8;margin-left:6px;white-space:nowrap;flex:1;">0:00 / 0:00</span>

                            <!-- Quality gear button + custom menu -->
                            <div id="${videoId}-quality-wrap" style="position:relative;flex-shrink:0;">
                                <!-- Backing select: hidden, owns the change handler wired in _attachDash -->
                                <select id="${videoId}-quality"
                                        style="display:none!important;position:absolute;pointer-events:none;"
                                        aria-hidden="true" tabindex="-1">
                                    <option value="auto" selected>Auto</option>
                                </select>
                                <!-- Gear toggle button -->
                                <button id="${videoId}-quality-btn"
                                        style="background:transparent;border:none;color:#fff;cursor:pointer;padding:4px 7px;display:flex;align-items:center;gap:4px;opacity:0.85;transition:opacity 0.15s,background 0.15s;flex-shrink:0;border-radius:6px;"
                                        title="Quality" aria-label="Trailer quality">
                                    ${SVG_GEAR_QS}
                                    <span id="${videoId}-quality-label"
                                          style="font-size:10px;white-space:nowrap;max-width:52px;overflow:hidden;text-overflow:ellipsis;line-height:1;">Auto</span>
                                </button>
                                <!-- Custom dropdown menu (built fresh on each open) -->
                                <div id="${videoId}-quality-menu"
                                     style="display:none;position:absolute;bottom:calc(100% + 6px);right:0;background:rgba(12,12,12,0.96);border:1px solid rgba(255,255,255,0.12);border-radius:10px;overflow:hidden;min-width:100px;box-shadow:0 6px 24px rgba(0,0,0,0.8);backdrop-filter:blur(10px);z-index:99999;">
                                </div>
                            </div>

                            <!-- Fullscreen -->
                            <button id="${videoId}-minibtn" style="${btnStyle}" title="Mini Player">${SVG_MINI}</button>
                            <button id="${videoId}-fsbtn" style="${btnStyle}" title="Fullscreen">${SVG_FS}</button>
                        </div>
                    </div>
                </div>
            `;

            const dashVideoEl  = document.getElementById(videoId);
            const ctrlBar      = document.getElementById(`${videoId}-ctrl`);
            const playBtn      = document.getElementById(`${videoId}-playbtn`);
            const volBtn       = document.getElementById(`${videoId}-volbtn`);
            const volSlider    = document.getElementById(`${videoId}-volslider`);
            const timeDisplay  = document.getElementById(`${videoId}-time`);
            const progWrap     = document.getElementById(`${videoId}-prog-wrap`);
            const progBar      = document.getElementById(`${videoId}-prog`);
            const miniBtn      = document.getElementById(`${videoId}-minibtn`);
            const fsBtn        = document.getElementById(`${videoId}-fsbtn`);
            const wrapEl       = document.getElementById(wrapperId);
            const qualityWrap   = document.getElementById(`${videoId}-quality-wrap`);
            const qualitySelect = document.getElementById(`${videoId}-quality`);
            const qualityBtn    = document.getElementById(`${videoId}-quality-btn`);
            const qualityLabel  = document.getElementById(`${videoId}-quality-label`);
            const qualityMenu   = document.getElementById(`${videoId}-quality-menu`);

            // Controls bar visible immediately so quality selector is accessible without hover
            ctrlBar.style.opacity       = '1';
            ctrlBar.style.pointerEvents = 'auto';
            ctrlBar.style.zIndex        = '50';

            console.debug('[GD][Trailer][DASH][DOM]', {
                qualityWrapExists:   !!document.getElementById(`${videoId}-quality-wrap`),
                qualitySelectExists: !!document.getElementById(`${videoId}-quality`),
                wrapDisplay:    getComputedStyle(document.getElementById(`${videoId}-quality-wrap`)).display,
                wrapVisibility: getComputedStyle(document.getElementById(`${videoId}-quality-wrap`)).visibility,
                wrapOpacity:    getComputedStyle(document.getElementById(`${videoId}-quality-wrap`)).opacity,
                rect: document.getElementById(`${videoId}-quality-wrap`)?.getBoundingClientRect()
            });

            // ── Gear quality button wiring ───────────────────────────────
            // Rebuilds custom menu from the hidden qualitySelect each time it opens.
            // _populateQuality (in _attachDash) only touches the hidden select; the
            // menu reflects those changes automatically when next opened.
            const _syncQualityMenu = () => {
                if (!qualityMenu || !qualitySelect) return;
                qualityMenu.innerHTML = '';
                const itemBase = 'display:flex;align-items:center;justify-content:space-between;gap:10px;' +
                    'width:100%;padding:7px 14px;background:transparent;color:#fff;border:none;' +
                    'font-size:12px;text-align:left;cursor:pointer;transition:background 0.1s;box-sizing:border-box;';
                [...qualitySelect.options].forEach(opt => {
                    const isActive   = opt.value === qualitySelect.value;
                    const isDisabled = opt.disabled;
                    const item       = document.createElement('button');
                    item.type        = 'button';
                    item.style.cssText = itemBase + (isDisabled ? 'opacity:0.35;cursor:default;' : '');
                    item.disabled    = isDisabled;
                    item.innerHTML   = `<span>${opt.textContent}</span>` +
                        `<span style="opacity:${isActive ? '1' : '0'};color:rgba(255,255,255,0.9);">${SVG_CHECK_QS}</span>`;
                    if (!isDisabled) {
                        item.addEventListener('mouseover', () => { item.style.background = 'rgba(255,255,255,0.08)'; });
                        item.addEventListener('mouseout',  () => { item.style.background = 'transparent'; });
                        item.addEventListener('click', () => {
                            qualitySelect.value = opt.value;
                            qualitySelect.dispatchEvent(new Event('change', { bubbles: true }));
                            qualityMenu.style.display = 'none';
                        });
                    }
                    qualityMenu.appendChild(item);
                });
            };

            if (qualityBtn) {
                qualityBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const isOpen = qualityMenu.style.display !== 'none';
                    if (isOpen) {
                        qualityMenu.style.display = 'none';
                    } else {
                        _syncQualityMenu();
                        qualityMenu.style.display = 'block';
                    }
                });
                qualityBtn.addEventListener('mouseenter', () => {
                    qualityBtn.style.opacity    = '1';
                    qualityBtn.style.background = 'rgba(255,255,255,0.08)';
                });
                qualityBtn.addEventListener('mouseleave', () => {
                    qualityBtn.style.opacity    = '0.85';
                    qualityBtn.style.background = 'transparent';
                });
            }

            // Update gear label when selection changes (fired by both menu click and _attachDash handler)
            if (qualitySelect) {
                qualitySelect.addEventListener('change', () => {
                    if (qualityLabel) {
                        const sel = qualitySelect.options[qualitySelect.selectedIndex];
                        qualityLabel.textContent = sel ? sel.textContent : 'Auto';
                    }
                });
            }

            // Close menu on any outside click
            document.addEventListener('click', function _qdOutside(e) {
                if (qualityWrap && !qualityWrap.contains(e.target)) {
                    if (qualityMenu) qualityMenu.style.display = 'none';
                }
            });

            // ── Mini Player ──────────────────────────────────────────────
            if (!window._gdMiniPlayer) window._gdMiniPlayer = null;

            const _dismissMiniPlayer = () => {
                const mp = document.getElementById('gd-mini-player');
                if (mp) mp.remove();
                window._gdMiniPlayer = null;
            };

            // Restore the mini player video back into its original inline slot
            const _restoreMiniPlayerInline = (mpState) => {
                const vid  = mpState?.videoEl;
                const slot = mpState?.sourceWrapperId ? document.getElementById(mpState.sourceWrapperId) : null;
                if (slot && vid) {
                    // Reset video styles — no z-index, no position override that could cover controls
                    vid.style.width        = '100%';
                    vid.style.height       = '100%';
                    vid.style.display      = 'block';
                    vid.style.objectFit    = 'contain';
                    vid.style.position     = '';
                    vid.style.inset        = '';
                    vid.style.zIndex       = '';
                    vid.style.pointerEvents = 'auto';

                    // Insert BEFORE the control bar so the control bar stays on top
                    const ctrl = document.getElementById(`${mpState.videoId}-ctrl`);
                    if (ctrl && slot.contains(ctrl)) {
                        slot.insertBefore(vid, ctrl);
                    } else {
                        slot.insertBefore(vid, slot.firstChild);
                    }

                    // Force control bar and all its interactive children to be clickable
                    if (ctrl) {
                        ctrl.style.pointerEvents = 'auto';
                        ctrl.style.zIndex        = '10';
                    }
                    [
                        `${mpState.videoId}-playbtn`,
                        `${mpState.videoId}-volbtn`,
                        `${mpState.videoId}-volslider`,
                        `${mpState.videoId}-prog-wrap`,
                        `${mpState.videoId}-minibtn`,
                        `${mpState.videoId}-fsbtn`
                    ].forEach(id => {
                        const el = document.getElementById(id);
                        if (el) el.style.pointerEvents = 'auto';
                    });
                }
                _dismissMiniPlayer();
            };

            miniBtn.addEventListener('click', () => {
                // If already in mini mode for this video, restore inline
                if (window._gdMiniPlayer?.videoEl === dashVideoEl) {
                    _restoreMiniPlayerInline(window._gdMiniPlayer);
                    return;
                }

                // Dismiss any previous mini player first
                _dismissMiniPlayer();

                // Disable native controls before moving video into mini player
                dashVideoEl.controls = false;
                dashVideoEl.removeAttribute('controls');

                // Build the fixed mini player shell
                const mp = document.createElement('div');
                mp.id = 'gd-mini-player';
                mp.style.cssText = `
                    position:fixed; bottom:20px; right:20px;
                    width:320px; height:${Math.round(320 / (16 / 9))}px;
                    z-index:99999; overflow:visible;
                    min-width:220px; max-width:640px;
                `;

                const SVG_GET_BACK = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>`;
                const SVG_RESIZE   = `<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M0 10 L10 0 L10 10 Z"/></svg>`;

                mp.innerHTML = `
                    <div id="gd-mp-video-slot" class="gd-mp-video-slot"></div>
                    <div id="gd-mp-overlay" class="gd-mp-overlay">
                        <div class="gd-mp-topbar">
                            <button id="gd-mp-getback" class="gd-mp-btn" title="Back to game">${SVG_GET_BACK}</button>
                            <button id="gd-mp-close" class="gd-mp-btn" title="Close">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                            </button>
                        </div>
                        <div class="gd-mp-center-play">
                            <button id="gd-mp-play" class="gd-mp-btn gd-mp-play-btn">${SVG_PLAY}</button>
                        </div>
                        <div class="gd-mp-prog-area">
                            <div id="gd-mp-prog-wrap" class="gd-mp-progress">
                                <div id="gd-mp-prog" class="gd-mp-prog-fill"></div>
                            </div>
                        </div>
                    </div>
                    <div id="gd-mp-resize-handle" class="gd-mp-resize-handle">${SVG_RESIZE}</div>
                `;

                document.body.appendChild(mp);

                // Move the video into the mini player slot
                const slot = document.getElementById('gd-mp-video-slot');
                dashVideoEl.style.cssText = 'width:100%;height:100%;display:block;object-fit:contain;';
                slot.appendChild(dashVideoEl);

                // Save extended state so back/close can restore correctly
                window._gdMiniPlayer = {
                    videoEl: dashVideoEl,
                    videoId,
                    sourceGameId: _gdCurrentGameId,
                    sourceWrapperId: wrapperId,
                    currentTime: dashVideoEl.currentTime,
                    wasPlaying: !dashVideoEl.paused
                };

                // ── Play/Pause ──
                const mpPlay = document.getElementById('gd-mp-play');
                const syncMpPlay = () => { mpPlay.innerHTML = dashVideoEl.paused ? SVG_PLAY : SVG_PAUSE; };
                dashVideoEl.addEventListener('play',  syncMpPlay);
                dashVideoEl.addEventListener('pause', syncMpPlay);
                syncMpPlay();
                mpPlay.addEventListener('click', () => { if (dashVideoEl.paused) dashVideoEl.play().catch(() => {}); else dashVideoEl.pause(); });

                // ── Progress bar ──
                const mpProg     = document.getElementById('gd-mp-prog');
                const mpProgWrap = document.getElementById('gd-mp-prog-wrap');
                dashVideoEl.addEventListener('timeupdate', () => {
                    if (dashVideoEl.duration) {
                        mpProg.style.width = (dashVideoEl.currentTime / dashVideoEl.duration * 100) + '%';
                    }
                });
                mpProgWrap.addEventListener('click', (e) => {
                    if (!dashVideoEl.duration) return;
                    const r = mpProgWrap.getBoundingClientRect();
                    dashVideoEl.currentTime = ((e.clientX - r.left) / r.width) * dashVideoEl.duration;
                });

                // ── Back button: navigate to original game details + restore video ──
                document.getElementById('gd-mp-getback').addEventListener('click', () => {
                    const mpState = window._gdMiniPlayer;
                    if (!mpState) return;
                    const savedTime  = dashVideoEl.currentTime;
                    const wasPlaying = !dashVideoEl.paused;
                    const gdView     = document.getElementById('gameDetailsView');
                    const alreadyOnPage = gdView && gdView.style.display !== 'none'
                        && _gdCurrentGameId === mpState.sourceGameId;

                    if (alreadyOnPage) {
                        _restoreMiniPlayerInline(mpState);
                    } else {
                        // Set restore hint so the new render can seek to saved time
                        window._gdMiniRestoreOnOpen = {
                            videoId: mpState.videoId,
                            currentTime: savedTime,
                            wasPlaying
                        };
                        const srcId = mpState.sourceGameId;
                        _dismissMiniPlayer();
                        if (srcId) openGameDetails(srcId);
                    }
                });

                // ── Close button ──
                document.getElementById('gd-mp-close').addEventListener('click', () => {
                    const mpState = window._gdMiniPlayer;
                    if (!mpState) return;
                    dashVideoEl.pause();
                    const gdView = document.getElementById('gameDetailsView');
                    const alreadyOnPage = gdView && gdView.style.display !== 'none'
                        && _gdCurrentGameId === mpState.sourceGameId;
                    if (alreadyOnPage) {
                        _restoreMiniPlayerInline(mpState);
                    } else {
                        _dismissMiniPlayer();
                    }
                });

                // ── Draggable ──
                let _dx = 0, _dy = 0, _dragging = false;
                mp.addEventListener('mousedown', (e) => {
                    if (e.target.closest('button') || e.target.closest('#gd-mp-prog-wrap') || e.target.closest('#gd-mp-resize-handle')) return;
                    _dragging = true;
                    _dx = e.clientX - mp.getBoundingClientRect().left;
                    _dy = e.clientY - mp.getBoundingClientRect().top;
                    mp.style.cursor = 'grabbing';
                    mp.style.transition = 'none';
                    e.preventDefault();
                });
                document.addEventListener('mousemove', (e) => {
                    if (!_dragging) return;
                    mp.style.right  = 'auto';
                    mp.style.bottom = 'auto';
                    mp.style.left   = (e.clientX - _dx) + 'px';
                    mp.style.top    = (e.clientY - _dy) + 'px';
                });
                document.addEventListener('mouseup', () => { _dragging = false; mp.style.cursor = ''; });

                // ── Resizable ──
                const resizeHandle = document.getElementById('gd-mp-resize-handle');
                let _resizing = false, _resizeStartX = 0, _resizeStartW = 0;
                resizeHandle.addEventListener('mousedown', (e) => {
                    _resizing = true;
                    _resizeStartX = e.clientX;
                    _resizeStartW = mp.getBoundingClientRect().width;
                    e.preventDefault();
                    e.stopPropagation();
                });
                document.addEventListener('mousemove', (e) => {
                    if (!_resizing) return;
                    const newW = Math.max(220, Math.min(640, _resizeStartW + (e.clientX - _resizeStartX)));
                    mp.style.width  = newW + 'px';
                    mp.style.height = Math.round(newW / (16 / 9)) + 'px';
                });
                document.addEventListener('mouseup', () => { _resizing = false; });
            });

            // Check if a back-button navigation requested restore to a saved time
            const _checkMiniRestoreHint = () => {
                const hint = window._gdMiniRestoreOnOpen;
                if (!hint || hint.videoId !== videoId) return;
                window._gdMiniRestoreOnOpen = null;
                const applyRestore = () => {
                    if (hint.currentTime > 0) dashVideoEl.currentTime = hint.currentTime;
                    if (hint.wasPlaying) dashVideoEl.play().catch(() => {});
                };
                if (dashVideoEl.readyState >= 2) {
                    applyRestore();
                } else {
                    dashVideoEl.addEventListener('loadeddata', applyRestore, { once: true });
                }
            };

            // ── Show/hide controls on hover ──
            let _hideTimer;
            const showCtrl = () => { ctrlBar.style.opacity = '1'; clearTimeout(_hideTimer); };
            const hideCtrl = () => { _hideTimer = setTimeout(() => { ctrlBar.style.opacity = '0'; }, 2000); };
            wrapEl.addEventListener('mouseenter', showCtrl);
            wrapEl.addEventListener('mousemove',  showCtrl);
            wrapEl.addEventListener('mouseleave', hideCtrl);

            // ── Play / Pause ──
            const syncPlayBtn = () => {
                playBtn.innerHTML = dashVideoEl.paused ? SVG_PLAY : SVG_PAUSE;
            };
            dashVideoEl.addEventListener('play',  syncPlayBtn);
            dashVideoEl.addEventListener('pause', syncPlayBtn);
            const _dashTogglePlay = () => {
                if (dashVideoEl.paused) dashVideoEl.play().catch(() => {});
                else dashVideoEl.pause();
            };
            playBtn.addEventListener('click', _dashTogglePlay);
            dashVideoEl.addEventListener('click', _dashTogglePlay);

            // ── Volume — start muted; user can unmute at any time ──
            dashVideoEl.volume = 1;
            _gdApplyDefaultTrailerMute(dashVideoEl);
            volBtn.innerHTML   = SVG_MUTE;
            volSlider.value    = 0;
            volBtn.addEventListener('click', () => {
                dashVideoEl.muted = !dashVideoEl.muted;
                volBtn.innerHTML  = dashVideoEl.muted ? SVG_MUTE : SVG_VOL;
                volSlider.value   = dashVideoEl.muted ? 0 : dashVideoEl.volume;
            });
            volSlider.addEventListener('input', () => {
                dashVideoEl.volume = parseFloat(volSlider.value);
                dashVideoEl.muted  = dashVideoEl.volume === 0;
                volBtn.innerHTML   = dashVideoEl.muted ? SVG_MUTE : SVG_VOL;
            });

            // ── Progress bar ──
            const _fmtTime = (s) => {
                if (!isFinite(s)) return '0:00';
                const m = Math.floor(s / 60), sec = Math.floor(s % 60);
                return `${m}:${sec.toString().padStart(2,'0')}`;
            };
            dashVideoEl.addEventListener('timeupdate', () => {
                const pct = dashVideoEl.duration ? (dashVideoEl.currentTime / dashVideoEl.duration) * 100 : 0;
                progBar.style.width = pct + '%';
                timeDisplay.textContent = `${_fmtTime(dashVideoEl.currentTime)} / ${_fmtTime(dashVideoEl.duration)}`;
            });
            progWrap.addEventListener('click', (e) => {
                if (!dashVideoEl.duration) return;
                const rect = progWrap.getBoundingClientRect();
                dashVideoEl.currentTime = ((e.clientX - rect.left) / rect.width) * dashVideoEl.duration;
            });

            // ── Fullscreen ──
            fsBtn.addEventListener('click', () => {
                if (document.fullscreenElement) document.exitFullscreen();
                else wrapEl.requestFullscreen?.();
            });

            dashVideoEl.dataset.gdDashId = videoId;

            const _attachDash = (dashjs) => {
                console.debug('[GD][Trailer][DASH] attachDash started', { url });
                console.debug('[GD][Trailer][DASH] dash.js version', dashjs?.Version || dashjs?.version);

                const player = dashjs.MediaPlayer().create();
                player.updateSettings({
                    streaming: { abr: { autoSwitchBitrate: { video: true } } }
                });
                _gdActiveDashPlayers.set(videoId, player);
                player.initialize(dashVideoEl, url, true);

                // _dashQualities holds the normalized quality list once populated
                let _dashQualities      = [];
                let _qualitiesPopulated = false;

                // Change handler wired once — reads _dashQualities populated by _populateQuality
                if (qualitySelect) {
                    qualitySelect.addEventListener('change', () => {
                        const val = qualitySelect.value;
                        if (val === 'auto') {
                            player.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: true } } } });
                            if (typeof player.setAutoSwitchQualityFor === 'function') {
                                player.setAutoSwitchQualityFor('video', true);
                            }
                        } else {
                            player.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: false } } } });
                            const q = _dashQualities[parseInt(val, 10)];
                            if (q) {
                                if (q.source === 'representation' && q.id != null &&
                                    typeof player.setRepresentationForTypeById === 'function') {
                                    player.setRepresentationForTypeById('video', q.id);
                                } else if (typeof player.setRepresentationForTypeByIndex === 'function') {
                                    player.setRepresentationForTypeByIndex('video', q.index);
                                } else {
                                    player.setQualityFor('video', q.index);
                                }
                            }
                        }
                    });
                }

                // _populateQuality: called at STREAM_INITIALIZED, retried at 300/1000/2000 ms
                const _populateQuality = (attempt) => {
                    if (!document.body.contains(dashVideoEl)) return;
                    if (!qualitySelect) return;
                    if (_qualitiesPopulated) return; // don't overwrite once populated

                    console.debug('[GD][Trailer][DASH] representations', player.getRepresentationsByType?.('video'));
                    console.debug('[GD][Trailer][DASH] bitrateInfoList', player.getBitrateInfoListFor?.('video'));

                    const qualities = _getDashVideoQualities(player);
                    console.debug('[GD][Trailer][DASH] normalized qualities', qualities);

                    if (qualities.length === 0) {
                        if (attempt < 3) {
                            const retryDelays = [300, 1000, 2000];
                            setTimeout(() => _populateQuality(attempt + 1), retryDelays[attempt]);
                            return;
                        }
                        // All retries exhausted — show Auto / Source so selector stays useful
                        qualitySelect.innerHTML = '<option value="auto" selected>Auto / Source</option>';
                    } else {
                        _dashQualities      = qualities;
                        _qualitiesPopulated = true;

                        // Sort descending: height first, then bitrate as tiebreaker
                        const sorted = [...qualities].sort((a, b) =>
                            ((b.height || 0) - (a.height || 0)) || ((b.bitrate || 0) - (a.bitrate || 0))
                        );

                        // Count per height to detect when we need a bitrate qualifier
                        const heightCount = {};
                        sorted.forEach(q => {
                            if (q.height) heightCount[q.height] = (heightCount[q.height] || 0) + 1;
                        });

                        qualitySelect.innerHTML = '<option value="auto" selected>Auto</option>';
                        sorted.forEach((q, sortedIdx) => {
                            const origIdx = qualities.indexOf(q);
                            let label;
                            if (q.height) {
                                label = (heightCount[q.height] > 1 && q.bitrate)
                                    ? `${q.height}p - ${Math.round(q.bitrate / 1000)} kbps`
                                    : `${q.height}p`;
                            } else if (q.bitrate) {
                                label = `${Math.round(q.bitrate / 1000)} kbps`;
                            } else {
                                label = `Quality ${sortedIdx + 1}`;
                            }
                            const opt     = document.createElement('option');
                            opt.value       = String(origIdx);
                            opt.textContent = label;
                            qualitySelect.appendChild(opt);
                        });
                    }

                    console.debug('[GD][Trailer][DASH] quality options', [...qualitySelect.options].map(o => ({
                        value: o.value,
                        text:  o.textContent
                    })));
                    console.debug('[GD][Trailer][DASH] quality DOM after populate', {
                        html:    qualityWrap?.outerHTML,
                        options: [...qualitySelect.options].map(o => ({ value: o.value, text: o.textContent }))
                    });
                };

                player.on(dashjs.MediaPlayer.events.STREAM_INITIALIZED, () => {
                    console.debug('[GD][Trailer][DASH] stream initialized', { url });
                    try {
                        _populateQuality(0);
                    } catch (e) {
                        console.warn('[GD] DASH quality selector error:', e);
                    }
                });
            };

            _gdLoadLocalScriptOnce('dashjs', ['../node_modules/dashjs/dist/modern/umd/dash.all.min.js'])
                .then(djs => { _attachDash(djs); _checkMiniRestoreHint(); })
                .catch(() => _tryNext('dashjs load failed'));

        } else {
            // ── mp4 / webm → native ───────────────────────────────────
            videoEl.src = url;
            videoEl.play().catch(() => {});
        }
    } else {
        // _gdCanPlayDirectVideo returned false for this candidate — try the next one
        _tryNext('format not playable');
    }
}
// ──────────────────────────────────────────
//  INFO GRID (Overview)
// ──────────────────────────────────────────

function _gdBuildInfoGrid(game, meta) {
    const grid = document.getElementById('gdInfoGrid');
    if (!grid) return;
    const items = [];

    const add = (label, value, field) => {
        if (value && value !== 'Unknown') items.push({ label, value, field });
    };

    let cleanPlatforms = game.platform || '—';
    if (meta?.platforms && Array.isArray(meta.platforms)) {
        const filtered = meta.platforms.filter(p => !p.toLowerCase().includes('platform'));
        if (filtered.length > 0) {
            cleanPlatforms = filtered.slice(0, 4).join(' • ');
            if (filtered.length > 4) cleanPlatforms += ' • ...';
        }
    }

    const developer   = meta?.developer   || game.developer   || null;
    const publisher   = meta?.publisher   || game.publisher   || null;
    const releaseDate = meta?.releaseDate || game.releaseDate || null;
    const playerMode  = meta?.playerMode  || meta?.gameMode   || null;
    const engine      = meta?.engine      || null;

    add('Developer',    developer, 'developer');
    add('Publisher',    publisher, 'publisher');
    add('Release Date', _gdFormatDate(releaseDate), 'releaseDate');
    add('Platform',     cleanPlatforms);  // read-only — not editable in Creator Mode
    add('Mode',         playerMode);
    add('Engine',       engine);

    if (items.length === 0) {
        grid.innerHTML = '<div class="gd-info-item" style="color:var(--gd-text-muted);font-style:italic;font-size:0.85rem;">No game info available.</div>';
        return;
    }

    grid.innerHTML = items.map(i => `
        <div class="gd-info-item">
            <div class="gd-info-label">${i.label}</div>
            <div class="gd-info-value" ${i.field ? `data-gd-edit-field="${i.field}" tabindex="0"` : ''}>${i.value}</div>
        </div>
    `).join('');
}

// ──────────────────────────────────────────
//  DETAIL LIST (Sidebar)
// ──────────────────────────────────────────
function _gdBuildDetailList(game, meta) {
    const list = document.getElementById('gdDetailList');
    const rows = [];

    const add = (label, value, field) => {
        if (value) rows.push(`
            <div class="gd-detail-row">
                <span class="gd-detail-label">${label}</span>
                <span class="gd-detail-value" ${field ? `data-gd-edit-field="${field}" tabindex="0"` : ''}>${value}</span>
            </div>
        `);
    };

    const _gdDPResolved = _gdResolvePlaytimeForGame(game);
    const pData = _gdDPResolved.data || { totalMinutes: 0, lastPlayed: null };

    const gdDetailsLastPlayedTs = typeof _agResolveLastPlayedTimestamp === 'function'
        ? _agResolveLastPlayedTimestamp(game)
        : pData.lastPlayed;

    const ptStr = (typeof formatPlaytime === 'function') ? formatPlaytime(pData.totalMinutes) : '0h';
    const lpStr = (typeof formatLastPlayed === 'function') ? formatLastPlayed(gdDetailsLastPlayedTs) : 'Never';

    add('Playtime',       ptStr);
    add('Last Played',    lpStr);
    add('Developer',      meta?.developer || game.developer, 'developer');
    add('Publisher',      meta?.publisher || game.publisher, 'publisher');
    add('Release Date',   _gdFormatDate(meta?.releaseDate || game.releaseDate), 'releaseDate');
    add('Platform',       game.platform);  // read-only
    add('File Size',      meta?.fileSize || game.size);

    list.innerHTML = rows.join('') || `
        <div class="gd-detail-row">
            <span class="gd-detail-value" style="color:var(--gd-text-muted); font-style:italic; font-size:0.8rem;">No additional info</span>
        </div>
    `;
}

function _gdCreatorDraftFromCurrent() {
    const game = _gdCurrentGame || {};
    const meta = _gdMergeCustomIntoMeta(game, _gdCurrentMeta || {});
    const info = meta?.info || {};
    // Always load directly from storage so saved title/thumbnail are never lost
    const existing = _gdLoadCustomDetails(game) || {};
    // Seed ratings array from existing custom data, or from server meta ratings
    const seedRatings = existing.ratings?.length ? existing.ratings
        : Array.isArray(meta.ratings) ? meta.ratings
        : [];

    // Trailers: prefer saved objects (full {url,title,thumbnail}) from storage.
    // Fall back to server allTrailers preserving their thumbnail/name fields.
    // Never strip to bare URL strings — that loses title and thumbnail.
    const savedTrailers = _gdNormalizeTrailerList(existing.trailers || []);
    const fallbackTrailers = savedTrailers.length ? [] : [
        ...(info.allTrailers || []).map(t => ({
            url:       t.url  || '',
            title:     t.name || '',
            thumbnail: t.thumbnail || t.thumbUrl || '',
        })),
        ...(info.trailer && !(info.allTrailers || []).length
            ? [{ url: info.trailer, title: '', thumbnail: '' }]
            : []),
    ];
    const trailers = savedTrailers.length
        ? savedTrailers
        : _gdNormalizeTrailerList(fallbackTrailers);
    const artLocked =
    game.customArtworkLocked === true ||
    game.artworkSource === 'creator';

    const gameCover = game.image || game.coverUrl || game.defaultImage || '';
    const gameHero  = game.heroImage || game.heroUrl || game.defaultHero || '';
    const gameLogo  = game.logo || game.logoUrl || game.defaultLogo || '';

    const metaCover = meta.cover || '';
    const metaHero  = meta.heroImage || meta.hero || '';
    const metaLogo  = meta.logo || '';

    const draftCover = artLocked
        ? (gameCover || metaCover)
        : (metaCover || gameCover);

    const draftHero = artLocked
        ? (gameHero || metaHero)
        : (metaHero || gameHero);

    const draftLogo = artLocked
        ? (gameLogo || metaLogo)
        : (metaLogo || gameLogo);
    return {
        title: existing.title || game.name || meta.title || '',
        publisher: existing.publisher || meta.publisher || game.publisher || '',
        developer: existing.developer || meta.developer || game.developer || '',
        releaseDate: existing.releaseDate || meta.releaseDate || game.releaseDate || '',
        platforms: _gdUniqList(existing.platforms?.length ? existing.platforms : (meta.platforms || game.platforms || game.platform || [])),
        genres: _gdUniqList(existing.genres?.length ? existing.genres : (info.genres || [])),
        rating: existing.rating ?? (info.rating || meta.ratings?.[0]?.score || ''),
        ratings: seedRatings,
        reviewSummary: existing.reviewSummary || meta.ratings?.[0]?.total_reviews || '',
        shortDescription: existing.shortDescription || info.short_description || game.short_description || '',
        description: existing.description || info.description || info.short_description || game.description || '',
       heroImage: existing.heroImage || draftHero || '',
        logoImage: existing.logoImage || draftLogo || '',
        logoMode: existing.logoMode || (existing.logoImage || existing.posterImage || draftLogo ? 'image' : 'text'),
        posterImage: existing.posterImage || existing.coverImage || draftCover || '',
        screenshots: _gdUniqList(existing.screenshots?.length ? existing.screenshots : (info.screenshots || [])),
        trailers,
    };
}

function _gdIsCreatorEditing() {
    return !!_gdCreatorModeActive && !_gdCreatorPreview;
}

function _gdCloseCreatorTransientUi({ leavingCreator = false } = {}) {
    document.getElementById('gdCreatorMoreWrap')?.classList.remove('open');
    document.getElementById('gdCreatorMoreBtn')?.setAttribute('aria-expanded', 'false');
    if (leavingCreator) {
        [
            'gdCreatorModal',
            'gdCreatorDateModal',
            'gdCreatorMediaModal',
            'gdCreatorRatingsModal',
            'gdCreatorRatingEntryModal',
            'gdCreatorConfirmModal',
        ].forEach(id => {
            const modal = document.getElementById(id);
            if (modal) modal.style.display = 'none';
        });
        document.querySelectorAll('[contenteditable="true"]').forEach(el => {
            el.contentEditable = 'false';
        });
    }
}

function _gdStripCreatorEditAffordances() {
    const view = document.getElementById('gameDetailsView');
    view?.querySelectorAll('.gd-creator-placeholder-card, .gd-edit-placeholder, .gd-trailer-add-header, .gd-creator-logo-ctrl, .gd-edit-image-btn, .gd-creator-add-card')
        .forEach(el => el.remove());
    view?.querySelectorAll('[data-gd-creator-action]').forEach(el => {
        delete el.dataset.gdCreatorAction;
        delete el.dataset.field;
        delete el.dataset.label;
        delete el.dataset.gdEditField;
        el.classList.remove('gd-editable', 'gd-editable-chip', 'gd-edit-placeholder');
    });
    view?.querySelectorAll('.gd-edit-image-host').forEach(el => el.classList.remove('gd-edit-image-host'));
}

function _gdSetCreatorModeState(mode, options = {}) {
    const nextMode = mode === 'preview' ? 'preview' : (mode === 'edit' ? 'edit' : 'normal');
    const isActive = nextMode !== 'normal';
    const isPreview = nextMode === 'preview';
    _gdCreatorModeActive = isActive;
    _gdCreatorPreview = isPreview;

    const view = document.getElementById('gameDetailsView');
    const toolbar = document.getElementById('gdCreatorToolbar');
    const entryBtn = document.getElementById('gdCreatorModeBtn');
    const previewBtn = document.getElementById('gdCreatorPreviewBtn');

    document.body.classList.toggle('creator-editing', nextMode === 'edit');
    document.body.classList.toggle('creator-preview', nextMode === 'preview');
    document.body.classList.toggle('gd-creator-active', isActive);
    document.body.classList.toggle('gd-creator-preview', isPreview);

    view?.classList.toggle('gd-creator-active', isActive);
    view?.classList.toggle('gd-creator-preview', isPreview);
    view?.classList.toggle('creator-editing', nextMode === 'edit');
    view?.classList.toggle('creator-preview', nextMode === 'preview');
    view?.classList.toggle('gd-has-custom-page', !!_gdCurrentCustomDetails);

    if (toolbar) toolbar.style.display = isActive ? 'flex' : 'none';
    if (entryBtn) {
        entryBtn.style.display = isActive ? 'none' : '';
        entryBtn.disabled = false;
        entryBtn.classList.toggle('active', isActive);
        entryBtn.style.pointerEvents = 'auto';
    }
    if (previewBtn) previewBtn.textContent = isPreview ? 'Edit' : 'Preview';

    _gdCloseCreatorTransientUi({ leavingCreator: !isActive });
    if (!_gdIsCreatorEditing()) _gdStripCreatorEditAffordances();
    if (!isActive && options.clearDraft !== false) {
        _gdCreatorDraft = null;
        // Also clear session snapshots when fully exiting Creator mode
        _gdCreatorSessionBaseGame    = null;
        _gdCreatorSessionSavedCustom = null;
        _gdCreatorSessionSavedGame   = null;
        // Reset drag & drop guard so it works again next time Creator opens
        _gdCreatorDragDropSetupDone = false;
    }

    if (options.log !== false) {
        console.debug(`[GD][Creator] ${nextMode === 'normal' ? 'normalize state' : nextMode}`);
    }
}

function _gdSyncCreatorChrome() {
    _gdSetCreatorModeState(_gdCreatorModeActive ? (_gdCreatorPreview ? 'preview' : 'edit') : 'normal', {
        clearDraft: false,
        log: false,
    });
}

window.gdCreatorToggleMore = function(ev) {
    ev?.stopPropagation?.();
    const wrap = document.getElementById('gdCreatorMoreWrap');
    const btn = document.getElementById('gdCreatorMoreBtn');
    if (!wrap) return;
    const open = !wrap.classList.contains('open');
    wrap.classList.toggle('open', open);
    btn?.setAttribute('aria-expanded', open ? 'true' : 'false');
};

document.addEventListener('click', (ev) => {
    const wrap = document.getElementById('gdCreatorMoreWrap');
    if (wrap && !wrap.contains(ev.target)) wrap.classList.remove('open');
});

window.gdCreatorDebugState = function() {
    return {
        active: _gdCreatorModeActive,
        preview: _gdCreatorPreview,
        hasDraft: !!_gdCreatorDraft,
        hasCustom: !!_gdCurrentCustomDetails,
        toolbarDisplay: document.getElementById('gdCreatorToolbar')?.style.display,
        entryButtonDisplay: document.getElementById('gdCreatorModeBtn')?.style.display,
        bodyClasses: document.body.className,
        viewClasses: document.getElementById('gameDetailsView')?.className,
    };
};

function _gdCreatorSetDraft(field, value) {
    if (!_gdCreatorDraft) _gdCreatorDraft = _gdCreatorDraftFromCurrent();
    if (field === 'trailers') {
        _gdCreatorDraft.trailers = _gdNormalizeTrailerList(value);
    } else if (['genres', 'screenshots'].includes(field)) {
        _gdCreatorDraft[field] = _gdUniqList(value);
    } else if (field === 'ratings') {
        _gdCreatorDraft.ratings = Array.isArray(value) ? value : [];
    } else if (field === 'rating') {
        // legacy compat — also accept scalar rating
        const n = Math.max(0, Math.min(100, Number(value) || 0));
        _gdCreatorDraft[field] = n;
    } else {
        _gdCreatorDraft[field] = String(value ?? '').trim();
    }
}

// Reconciles the logo/title DOM with the current draft's logoMode.
// Must be called AFTER _gdPopulateBasic/_gdPopulateMeta because those
// functions set visibility based on game.logo — we then correct it here.
function _gdSyncTitleIdentityDom() {
    const draft = _gdCreatorDraft;
    const titleEl = document.getElementById('gdTitle');
    const logoEl  = document.getElementById('gdLogo');
    if (!titleEl || !logoEl || !draft) return;

    if (draft.logoMode === 'text' || !draft.logoImage) {
        logoEl.onerror = null;
        logoEl.removeAttribute('src');
        logoEl.style.display = 'none';
        titleEl.style.display = 'block';
        // Ensure the title element shows the current draft title
        const wantTitle = draft.title || _gdCurrentGame?.name || '';
        if (!titleEl.textContent.trim() && wantTitle) titleEl.textContent = wantTitle;
    } else {
        logoEl.onerror = function () {
            this.onerror = null;
            this.style.display = 'none';
            titleEl.style.display = 'block';
        };
        logoEl.src = draft.logoImage;
        logoEl.style.display = 'block';
        titleEl.style.display = 'none';
    }
}

function _gdCreatorApplyDraftToPage() {
    if (!_gdCurrentGame || !_gdCreatorDraft) return;
    // Use the committed base game (never the in-flight draft-mutated game).
    // This ensures preview is always rendered from a stable baseline and never
    // leaks draft data into _gdCurrentGame / _gdCurrentMeta / _gdCurrentCustomDetails.
    const baseGame    = _gdCreatorSessionBaseGame || _gdCurrentGame;
    const previewGame = _gdApplyCustomToGame(baseGame, _gdCreatorDraft);
    const previewMeta = _gdBuildCustomMeta(previewGame, _gdCreatorDraft);
    console.debug('[GD][Creator] applying draft preview (no commit)', { title: _gdCreatorDraft.title });
    // ── DOM-only update — DO NOT assign _gdCurrentGame / _gdCurrentMeta / _gdCurrentCustomDetails ──
    _gdPopulateBasic(previewGame);
    _gdPopulateMeta(previewGame, previewMeta);
    _gdSyncTitleIdentityDom();
    if (_gdIsCreatorEditing()) _gdBindCreatorEditables();
    else _gdStripCreatorEditAffordances();
}

function _gdCreatorModal({ type = 'text', label = '', value = '', placeholder = '' }) {
    return new Promise((resolve) => {
        let modal = document.getElementById('gdCreatorModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'gdCreatorModal';
            modal.className = 'gd-creator-modal-backdrop gd-creator-modal-overlay';
            document.body.appendChild(modal);
        }

        const valStr = Array.isArray(value) ? value.join(', ') : String(value ?? '');
        let inputHtml;
        if (type === 'textarea') {
            inputHtml = `<textarea id="gdCreatorModalInput" class="gd-creator-modal-input" placeholder="${_gdEscHtml(placeholder)}" rows="5">${_gdEscHtml(valStr)}</textarea>`;
        } else if (type === 'rating') {
            const num = Math.max(0, Math.min(100, Number(valStr) || 0));
            inputHtml = `<div class="gd-creator-rating-wrap">
                <input type="range" id="gdCreatorModalRange" min="0" max="100" value="${num}" class="gd-creator-modal-range">
                <input type="number" id="gdCreatorModalInput" class="gd-creator-modal-input gd-creator-modal-number" min="0" max="100" value="${num}" placeholder="0-100">
            </div>`;
        } else {
            const inputType = type === 'url' ? 'url' : 'text';
            inputHtml = `<input type="${inputType}" id="gdCreatorModalInput" class="gd-creator-modal-input" placeholder="${_gdEscHtml(placeholder)}" value="${_gdEscHtml(valStr)}">`;
        }

        modal.innerHTML = `<div class="gd-creator-modal gd-creator-modal-box" role="dialog" aria-modal="true" aria-label="${_gdEscHtml(label)}">
            <div class="gd-creator-modal-header">
                <div>
                    <label class="gd-creator-modal-title gd-creator-modal-label" for="gdCreatorModalInput">${_gdEscHtml(label)}</label>
                    <p class="gd-creator-modal-subtitle">Edit this page detail in-place.</p>
                </div>
            </div>
            <div class="gd-creator-modal-body">${inputHtml}</div>
            <div class="gd-creator-modal-footer gd-creator-modal-actions">
                <button class="gd-creator-action gd-creator-secondary gd-creator-modal-btn" id="gdCreatorModalCancel" type="button">Cancel</button>
                <button class="gd-creator-action gd-creator-primary gd-creator-modal-btn primary" id="gdCreatorModalOk" type="button">OK</button>
            </div>
        </div>`;
        modal.style.display = 'flex';

        const input = document.getElementById('gdCreatorModalInput');
        const rangeEl = document.getElementById('gdCreatorModalRange');

        if (rangeEl && input) {
            rangeEl.addEventListener('input', () => { input.value = rangeEl.value; });
            input.addEventListener('input', () => {
                const v = Math.max(0, Math.min(100, Number(input.value) || 0));
                rangeEl.value = v;
            });
        }

        const finish = (ok) => {
            modal.style.display = 'none';
            if (!ok) { resolve(null); return; }
            resolve(input?.value ?? '');
        };

        document.getElementById('gdCreatorModalOk').onclick    = () => finish(true);
        document.getElementById('gdCreatorModalCancel').onclick = () => finish(false);
        modal.onclick = (ev) => { if (ev.target === modal) finish(false); };

        if (input) {
            setTimeout(() => { try { input.focus(); if (input.select) input.select(); } catch (_) {} }, 30);
            input.onkeydown = (ev) => {
                if (ev.key === 'Enter' && type !== 'textarea') { ev.preventDefault(); finish(true); }
                if (ev.key === 'Escape') finish(false);
            };
        }
    });
}

// Parse a human-readable date string into YYYY-MM-DD for Creator date storage.
// Returns '' when the date cannot be parsed reliably.
function _gdToIsoDate(val) {
    if (!val) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
    try {
        const d = new Date(val);
        if (isNaN(d)) return '';
        return d.toISOString().slice(0, 10);
    } catch { return ''; }
}

// ── Custom Date Picker Modal ─────────────────────────────────────────────────
// Returns ISO 'YYYY-MM-DD' string or null (cancelled).
function _gdCreatorDatePickerModal(currentIso) {
    return new Promise((resolve) => {
        const MONTHS = [
            ['Jan', 'January'], ['Feb', 'February'], ['Mar', 'March'], ['Apr', 'April'],
            ['May', 'May'], ['Jun', 'June'], ['Jul', 'July'], ['Aug', 'August'],
            ['Sep', 'September'], ['Oct', 'October'], ['Nov', 'November'], ['Dec', 'December'],
        ];
        const now = new Date();
        const maxYear = now.getFullYear() + 5;
        const years = Array.from({ length: maxYear - 1970 + 1 }, (_, i) => maxYear - i);
        let selYear = now.getFullYear();
        let selMonth = now.getMonth();
        let selDay = now.getDate();
        let hasSelection = false;

        // Pre-select from existing value
        if (currentIso && /^\d{4}-\d{2}-\d{2}$/.test(currentIso)) {
            const [y, m, d] = currentIso.split('-').map(Number);
            selYear = y;
            selMonth = m - 1;
            selDay = d;
            hasSelection = true;
        }

        let modal = document.getElementById('gdCreatorDateModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'gdCreatorDateModal';
            modal.className = 'gd-creator-modal-backdrop gd-creator-modal-overlay';
            document.body.appendChild(modal);
        }

        const render = () => {
            const daysInMonth = new Date(selYear, selMonth + 1, 0).getDate();
            if (selDay > daysInMonth) selDay = daysInMonth;
            const iso = hasSelection
                ? `${selYear}-${String(selMonth + 1).padStart(2, '0')}-${String(selDay).padStart(2, '0')}`
                : '';
            const dayButtons = Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => `
                <button type="button" class="gd-dob-option${day === selDay ? ' selected' : ''}" data-kind="day" data-value="${day}">
                    ${day}
                </button>`).join('');
            const monthButtons = MONTHS.map((m, idx) => `
                <button type="button" class="gd-dob-option${idx === selMonth ? ' selected' : ''}" data-kind="month" data-value="${idx}">
                    <span>${m[0]}</span><small>${m[1]}</small>
                </button>`).join('');
            const yearButtons = years.map(year => `
                <button type="button" class="gd-dob-option${year === selYear ? ' selected' : ''}" data-kind="year" data-value="${year}">
                    ${year}
                </button>`).join('');

            modal.innerHTML = `
            <div class="gd-creator-modal gd-creator-modal-box gd-dob-box" role="dialog" aria-modal="true" aria-label="Pick a release date">
                <div class="gd-creator-modal-header gd-media-picker-header">
                    <div>
                        <span class="gd-creator-modal-title gd-creator-modal-label">Release Date</span>
                        <p class="gd-creator-modal-subtitle">Choose Month, Day, and Year.</p>
                    </div>
                    <button type="button" class="gd-media-picker-close" id="gdDpClose" aria-label="Close">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                    </button>
                </div>
                <div class="gd-creator-modal-body">
                    <div class="gd-dob-picker" id="gdDobPicker">
                        <div class="gd-dob-column">
                            <div class="gd-dob-label">Month <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m6 9 6 6 6-6"/></svg></div>
                            <div class="gd-dob-list">${monthButtons}</div>
                        </div>
                        <div class="gd-dob-column">
                            <div class="gd-dob-label">Day <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m6 9 6 6 6-6"/></svg></div>
                            <div class="gd-dob-list">${dayButtons}</div>
                        </div>
                        <div class="gd-dob-column">
                            <div class="gd-dob-label">Year <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m6 9 6 6 6-6"/></svg></div>
                            <div class="gd-dob-list">${yearButtons}</div>
                        </div>
                    </div>
                    ${iso ? `<div class="gd-dp-selected-label">Selected: <strong>${iso}</strong></div>` : '<div class="gd-dp-selected-label gd-dp-no-sel">No date selected</div>'}
                </div>
                <div class="gd-creator-modal-footer gd-creator-modal-actions">
                    <button type="button" class="gd-creator-action gd-creator-secondary gd-creator-modal-btn" id="gdDpToday">Today</button>
                    <button type="button" class="gd-creator-action gd-creator-secondary gd-creator-modal-btn" id="gdDpClear">Clear</button>
                    <button type="button" class="gd-creator-action gd-creator-primary gd-creator-modal-btn primary" id="gdDpSave">Save</button>
                </div>
            </div>`;
            modal.style.display = 'flex';

            document.getElementById('gdDobPicker')?.addEventListener('click', (e) => {
                const btn = e.target.closest('.gd-dob-option');
                if (!btn) return;
                const value = Number(btn.dataset.value);
                if (btn.dataset.kind === 'month') selMonth = value;
                if (btn.dataset.kind === 'day') selDay = value;
                if (btn.dataset.kind === 'year') selYear = value;
                hasSelection = true;
                render();
            });
            document.getElementById('gdDpToday').onclick = () => {
                selYear = now.getFullYear();
                selMonth = now.getMonth();
                selDay = now.getDate();
                hasSelection = true;
                render();
            };
            document.getElementById('gdDpClear').onclick = () => {
                modal.style.display = 'none'; resolve('');
            };
            document.getElementById('gdDpSave').onclick = () => {
                if (!hasSelection) { modal.style.display = 'none'; resolve(null); return; }
                const maxDay = new Date(selYear, selMonth + 1, 0).getDate();
                if (selDay < 1 || selDay > maxDay) return;
                const iso = `${selYear}-${String(selMonth + 1).padStart(2, '0')}-${String(selDay).padStart(2, '0')}`;
                modal.style.display = 'none'; resolve(iso);
            };
            document.getElementById('gdDpClose').onclick = () => { modal.style.display = 'none'; resolve(null); };
            modal.onclick = (ev) => { if (ev.target === modal) { modal.style.display = 'none'; resolve(null); } };
        };

        render();
    });
}

async function _gdCreatorPrompt(field, label, current) {
    const isTagField = field === 'genres';
    if (field === 'releaseDate') {
        const currentIso = _gdToIsoDate(Array.isArray(current) ? current[0] : (current ?? ''));
        const value = await _gdCreatorDatePickerModal(currentIso);
        if (value == null) return;
        _gdCreatorSetDraft(field, value);
        _gdCreatorApplyDraftToPage();
        return;
    }
    const type = (field === 'description' || field === 'shortDescription') ? 'textarea' : 'text';
    const placeholder = isTagField ? 'Comma-separated values' : '';
    const displayVal  = Array.isArray(current) ? current.join(', ') : (current ?? '');
    const value = await _gdCreatorModal({ type, label, value: displayVal, placeholder });
    if (value == null) return;
    _gdCreatorSetDraft(field, value);
    _gdCreatorApplyDraftToPage();
}

function _gdBindCreatorText(el, field, multiline = false) {
    if (!el || el.dataset.creatorBound === field) return;
    el.dataset.creatorBound = field;
    el.classList.add('gd-editable');
    el.setAttribute('tabindex', '0');
    el.setAttribute('role', 'textbox');
    el.addEventListener('click', () => {
        if (!_gdIsCreatorEditing()) return;
        el.contentEditable = 'true';
        el.focus();
    });
    el.addEventListener('keydown', (e) => {
        if (!_gdIsCreatorEditing()) return;
        if (!multiline && e.key === 'Enter') {
            e.preventDefault();
            el.blur();
        }
    });
    el.addEventListener('blur', () => {
        if (el.isContentEditable) {
            el.contentEditable = 'false';
            const newVal = multiline ? el.innerText : el.textContent;
            _gdCreatorSetDraft(field, newVal);
            console.debug('[GD][Creator] text draft changed', field);
            _gdCreatorApplyDraftToPage();
        }
    });
}

function _gdCreatorImageButton(target, field, label) {
    if (!target) return;
    target.classList.add('gd-edit-image-host');
    let btn = target.querySelector(`.gd-edit-image-btn[data-gd-creator-action="edit-image"][data-field="${field}"]`);
    if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'gd-edit-image-btn';
        btn.dataset.gdCreatorAction = 'edit-image';
        btn.dataset.field = field;
        btn.dataset.label = label;
        btn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg><span>${label}</span>`;
        target.appendChild(btn);
    }
}

function _gdCreatorRenderPlaceholders() {
    if (!_gdIsCreatorEditing()) return;

    // Info grid: add clickable placeholders for fields that have no real data yet
    const infoGrid = document.getElementById('gdInfoGrid');
    if (infoGrid) {
        const _maybeAddPlaceholder = (field, label, text) => {
            if (!infoGrid.querySelector(`[data-gd-edit-field="${field}"]`)) {
                infoGrid.insertAdjacentHTML('beforeend', `
                    <div class="gd-info-item gd-edit-placeholder gd-editable"
                         data-gd-creator-action="edit-field"
                         data-gd-edit-field="${field}"
                         data-field="${field}"
                         data-label="${label}"
                         tabindex="0">
                        <div class="gd-info-label">${label}</div>
                        <div class="gd-info-value gd-placeholder-text">${text}</div>
                    </div>`);
            }
        };
        _maybeAddPlaceholder('publisher',   'Publisher',    'Add publisher');
        _maybeAddPlaceholder('developer',   'Developer',    'Add developer');
        _maybeAddPlaceholder('releaseDate', 'Release Date', 'Add release date');
    }

    // Genres placeholder — show section so it's clickable even when empty
    const genresSection = document.getElementById('gdGenresSection');
    const genresEl = document.getElementById('gdGenres');
    if (genresSection && genresEl && !(_gdCreatorDraft?.genres?.length)) {
        genresSection.style.display = 'block';
        genresSection.dataset.gdCreatorAction = 'edit-field';
        genresSection.dataset.field = 'genres';
        genresSection.dataset.label = 'Genres or tags, separated by commas';
        if (!genresEl.querySelector('.gd-creator-placeholder-card')) {
            genresEl.innerHTML = '<span class="gd-creator-placeholder-card">Add genres</span>';
        }
    }

    // Platforms row is read-only — no placeholder needed

    // Rating block placeholder — show block so it's clickable
    const ratingBlock = document.getElementById('gdRatingBlock');
    if (ratingBlock && !(_gdCreatorDraft?.ratings?.length)) {
        ratingBlock.style.display = 'block';
        ratingBlock.dataset.gdCreatorAction = 'edit-ratings';
        delete ratingBlock.dataset.field;
        ratingBlock.innerHTML = '<button type="button" class="gd-creator-placeholder-card gd-rating-empty-card" data-gd-creator-action="edit-ratings">Add ratings</button>';
    }

    // Short and full descriptions are both first-class Creator fields.
    const shortDescSection = document.getElementById('gdShortDescSection') || document.getElementById('gdShortDesc');
    const shortDescText = document.getElementById('gdShortDesc');
    if (shortDescSection) {
        shortDescSection.style.display = 'block';
        shortDescSection.dataset.gdCreatorAction = 'edit-field';
        shortDescSection.dataset.field = 'shortDescription';
        shortDescSection.dataset.label = 'Short Description';
        if (shortDescText && !(_gdCreatorDraft?.shortDescription) && !shortDescText.textContent.trim()) {
            shortDescText.innerHTML = '<span class="gd-creator-placeholder-card">Add a short description</span>';
        }
    }
    const fullDescSection = document.getElementById('gdFullDescSection');
    const fullDescText = document.getElementById('gdFullDescText');
    if (fullDescSection && fullDescText) {
        fullDescSection.style.display = 'block';
        fullDescSection.dataset.gdCreatorAction = 'edit-field';
        fullDescSection.dataset.field = 'description';
        fullDescSection.dataset.label = 'Full Description';
        if (!(_gdCreatorDraft?.description) && !fullDescText.textContent.trim()) {
            fullDescText.innerHTML = '<div class="gd-creator-placeholder-card">Add a full description</div>';
        }
    }

    _gdRenderCreatorGallery();
    _gdRenderCreatorTrailers();
}

function _gdRenderCreatorGallery() {
    const el = document.getElementById('gdScreenshots');
    if (!el || !_gdIsCreatorEditing()) return;
    const shots = _gdCreatorDraft?.screenshots || [];
    const items = shots.map((url, i) => `
        <div class="gd-creator-media-card">
            <img src="${_gdEscHtml(url)}" alt="Screenshot" onerror="this.parentElement.classList.add('broken')">
            <div class="gd-creator-media-actions">
                <button data-gd-creator-action="move-media" data-field="screenshots" data-index="${i}" data-direction="-1" title="Move left"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></button>
                <button data-gd-creator-action="move-media" data-field="screenshots" data-index="${i}" data-direction="1" title="Move right"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg></button>
                <button data-gd-creator-action="remove-media" data-field="screenshots" data-index="${i}" title="Remove"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
            </div>
        </div>`).join('');
    el.innerHTML = `${items}<button class="gd-creator-add-card" data-gd-creator-action="add-media" data-field="screenshots">Add screenshot</button>`;
}

// ── Trailer URL utilities ──────────────────────────────────────────────────────

function _gdNormalizeCreatorTrailerUrl(raw) {
    const ytId = extractYouTubeVideoId(raw.trim());
    return ytId ? `https://www.youtube.com/watch?v=${ytId}` : raw.trim();
}

function _gdPickTrailerThumbnail(trailer) {
    if (!trailer || typeof trailer !== 'object') return '';

    return String(
        trailer.thumbnail ||
        trailer.thumbUrl ||
        trailer.thumbnailUrl ||
        trailer.thumbnail_url ||
        trailer.poster ||
        trailer.posterUrl ||
        trailer.poster_url ||
        trailer.image ||
        trailer.imageUrl ||
        trailer.image_url ||
        trailer.preview ||
        trailer.previewImage ||
        trailer.previewUrl ||
        ''
    ).trim();
}

function _gdNormalizeCreatorTrailer(trailer) {
    if (trailer && typeof trailer === 'object') {
        // Guard against corrupted format:
        // { url: { url: "...", title: "...", thumbnail/thumbUrl: "..." } }
        const rawUrl = trailer.url;

        if (rawUrl && typeof rawUrl === 'object') {
            return _gdNormalizeCreatorTrailer({
                url: rawUrl.url || rawUrl.src || rawUrl.href || '',
                title: rawUrl.title || rawUrl.name || trailer.name || trailer.title || '',
                thumbnail:
                    _gdPickTrailerThumbnail(rawUrl) ||
                    _gdPickTrailerThumbnail(trailer)
            });
        }

        const url = _gdNormalizeCreatorTrailerUrl(
            String(rawUrl || trailer.src || trailer.href || '').trim()
        );

        if (!url) return null;

        const thumbnail = _gdPickTrailerThumbnail(trailer);

        return {
            url,
            title: String(trailer.title || trailer.name || ''),
            name: String(trailer.name || trailer.title || ''),
            thumbnail,
            thumbUrl: thumbnail
        };
    }

    const url = _gdNormalizeCreatorTrailerUrl(String(trailer || '').trim());
    if (!url) return null;

    return {
        url,
        title: '',
        name: '',
        thumbnail: '',
        thumbUrl: ''
    };
}

function _gdTrailerKey(trailer) {
    const obj = _gdNormalizeCreatorTrailer(trailer);
    return obj ? obj.url.toLowerCase() : '';
}

function _gdNormalizeTrailerList(list) {
    const seen = new Set();
    const out = [];
    for (const item of Array.isArray(list) ? list : []) {
        const normalized = _gdNormalizeCreatorTrailer(item);
        const key = _gdTrailerKey(normalized);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(normalized);
    }
    return out;
}

function _gdUpsertUniqueTrailer(list, trailer) {
    const normalized = _gdNormalizeCreatorTrailer(trailer);
    const key = _gdTrailerKey(normalized);
    if (!key) return _gdNormalizeTrailerList(list);
    const clean = _gdNormalizeTrailerList(list).filter(t => _gdTrailerKey(t) !== key);
    clean.push(normalized);
    return clean;
}

function _gdIsSimpleVideoUrl(url) {
    return /\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(url);
}

function _gdIsYouTubeTrailerUrl(url) {
    return !!extractYouTubeVideoId(String(url || ''));
}

function _gdIsReadyPlayableTrailerUrl(url) {
    const u = String(url || '').trim();
    if (!u) return false;

    const lower = u.toLowerCase();

    // Creator uploaded/local videos
    if (lower.startsWith('data:video/')) return true;
    if (lower.startsWith('blob:')) return true;
    if (lower.startsWith('file://')) return true;

    // Direct video links
    if (/\.(mp4|webm|ogg|mov)(?:\?|#|$)/i.test(lower)) return true;

    // Streaming manifests لو المشغل عندك بيدعمها
    if (/\.(m3u8|mpd)(?:\?|#|$)/i.test(lower)) return true;

    return false;
}

function _gdTrailerSortRank(trailer) {
    const url = typeof trailer === 'string'
        ? trailer
        : String(trailer?.url || trailer?.src || trailer?.href || '');

    // YouTube دايمًا آخر حاجة
    if (_gdIsYouTubeTrailerUrl(url)) return 99;

    // الفيديو الجاهز أو الملف المحلي أول حاجة
    if (_gdIsReadyPlayableTrailerUrl(url)) return 0;

    // أي لينك فيديو غير معروف ييجي في النص
    return 1;
}

function _gdSortTrailersForPlayback(list) {
    return _gdNormalizeTrailerList(list)
        .map((trailer, index) => ({
            ...trailer,
            _gdOriginalIndex: index,
        }))
        .sort((a, b) => {
            const rankDiff = _gdTrailerSortRank(a) - _gdTrailerSortRank(b);
            if (rankDiff !== 0) return rankDiff;

            return a._gdOriginalIndex - b._gdOriginalIndex;
        })
        .map(({ _gdOriginalIndex, ...trailer }) => trailer);
}

function _gdCreatorTrailerPreviewHtml(trailer, index) {
    const obj = _gdNormalizeCreatorTrailer(trailer) || { url: '', title: '', thumbnail: '' };
    const url = obj.url;
    const title = obj.title || '';
    const thumbnail = obj.thumbnail || '';
    const ytId = _gdParseYouTubeVideoId(url);
    const esc = _gdEscHtml(url);
    let preview;
    if (thumbnail) {
        // Custom thumbnail always wins — shown as a static image with a play overlay
        preview = `<div class="gd-creator-custom-thumb" role="img" aria-label="Custom trailer thumbnail">
            <img src="${_gdEscHtml(thumbnail)}" alt="${_gdEscHtml(title || 'Trailer')}" loading="lazy">
            <span class="gd-creator-yt-play" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            </span>
        </div>`;
    } else if (ytId) {
        const thumb = `https://img.youtube.com/vi/${ytId}/mqdefault.jpg`;
        // Use a div — never an <a href> — to prevent external browser navigation in Electron
        preview = `<div class="gd-creator-yt-thumb" data-yt-id="${_gdEscHtml(ytId)}" tabindex="0" role="img" aria-label="YouTube trailer thumbnail">
            <img src="${_gdEscHtml(thumb)}" alt="YouTube thumbnail" loading="lazy">
            <span class="gd-creator-yt-play" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            </span>
        </div>`;
    } else if (_gdIsSimpleVideoUrl(url)) {
        preview = `<video src="${esc}" class="gd-creator-video-preview" preload="metadata" muted controls></video>`;
    } else {
        // Clean fallback: dark placeholder + play icon, no large logo
        preview = `<div class="gd-creator-trailer-fallback">
            <span class="gd-creator-trailer-fallback-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            </span>
            ${url ? `<span class="gd-ct-fallback-url">${esc}</span>` : ''}
        </div>`;
    }
    const thumbPickerHtml = thumbnail
        ? `<img src="${_gdEscHtml(thumbnail)}" class="gd-ct-thumb-preview" alt="Custom thumbnail">
           <button type="button" class="gd-ct-thumb-btn" data-gd-creator-action="edit-trailer-thumbnail" data-index="${index}" title="Change thumbnail">Change</button>
           <button type="button" class="gd-ct-thumb-clear" data-gd-creator-action="clear-trailer-thumbnail" data-index="${index}" title="Remove thumbnail">✕</button>`
        : `<button type="button" class="gd-ct-thumb-btn" data-gd-creator-action="edit-trailer-thumbnail" data-index="${index}" title="Set custom thumbnail">Add thumbnail</button>`;
    return `<div class="gd-creator-trailer-row gd-creator-trailer-featured-row">
        <div class="gd-ct-featured-preview">${preview}</div>
        <div class="gd-ct-featured-meta">
            <input type="text" class="gd-ct-title-input"
                   placeholder="Trailer title (optional)"
                   value="${_gdEscHtml(title)}"
                   data-trailer-index="${index}">
            <div class="gd-ct-thumb-row">${thumbPickerHtml}</div>
        </div>
        <div class="gd-creator-media-actions gd-ct-featured-actions">
            <button data-gd-creator-action="move-media" data-field="trailers" data-index="${index}" data-direction="-1" title="Move left"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></button>
            <button data-gd-creator-action="move-media" data-field="trailers" data-index="${index}" data-direction="1" title="Move right"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg></button>
            <button data-gd-creator-action="edit-trailer" data-index="${index}" title="Edit URL"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>
            <button data-gd-creator-action="remove-media" data-field="trailers" data-index="${index}" title="Remove"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
        </div>
    </div>`;
}

// Compact thumbnail card for the strip (non-featured trailers).
// Intentionally smaller than the full _gdCreatorTrailerPreviewHtml.
function _gdCreatorTrailerThumbHtml(trailer, index) {
    const obj = _gdNormalizeCreatorTrailer(trailer) || { url: '', title: '', thumbnail: '' };
    const url = obj.url;
    const title = obj.title || '';
    const thumbnail = obj.thumbnail || '';
    const ytId = _gdParseYouTubeVideoId(url);
    let thumbContent;
    if (thumbnail) {
        thumbContent = `<img src="${_gdEscHtml(thumbnail)}" alt="${_gdEscHtml(title || `Trailer ${index + 1}`)}" loading="lazy" class="gd-ct-strip-img">`;
    } else if (ytId) {
        const thumb = `https://img.youtube.com/vi/${ytId}/mqdefault.jpg`;
        thumbContent = `<img src="${_gdEscHtml(thumb)}" alt="Trailer ${index + 1}" loading="lazy" class="gd-ct-strip-img">`;
    } else {
        thumbContent = `<div class="gd-ct-strip-ph">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        </div>`;
    }
    return `<div class="gd-ct-strip-card" data-trailer-index="${index}">
        <div class="gd-ct-strip-thumb">
            ${thumbContent}
            <button type="button" class="gd-ct-strip-thumb-edit" data-gd-creator-action="edit-trailer-thumbnail" data-index="${index}" title="Change thumbnail"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></button>
        </div>
        <input type="text" class="gd-ct-title-input gd-ct-strip-title-input"
               placeholder="Title…"
               value="${_gdEscHtml(title)}"
               data-trailer-index="${index}">
        <div class="gd-ct-strip-actions">
            <button data-gd-creator-action="edit-trailer" data-index="${index}" title="Edit URL"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>
            <button data-gd-creator-action="remove-media" data-field="trailers" data-index="${index}" title="Remove"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
        </div>
    </div>`;
}

function _gdRenderCreatorTrailers() {
    const section = document.getElementById('gdTrailerSection');
    const wrap = section?.querySelector('.gd-trailer-wrap');
    if (!section || !wrap || !_gdIsCreatorEditing()) return;

    section.style.display = 'block';
    const extBtn = document.getElementById('gdTrailerExtBtn');
    if (extBtn) extBtn.style.display = 'none';

    // Add header button once
    const title = section.querySelector('.gd-section-title, h3, .section-title');
    if (title && !title.querySelector('.gd-trailer-add-header')) {
        title.insertAdjacentHTML('beforeend', `
            <button type="button" class="gd-trailer-add-header" data-gd-creator-action="add-media" data-field="trailers">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
                Add Trailer
            </button>`);
    }

    const trailers = _gdNormalizeTrailerList(_gdCreatorDraft?.trailers || []);

    console.debug('[GD][Creator][Trailers] render', {
        dataCount: trailers.length,
        selectedIndex: 0,
        featuredUrl: trailers[0]?.url || null,
        thumbnailCount: Math.max(0, trailers.length - 1),
    });

    // Always clear container before rendering — no stale DOM
    wrap.innerHTML = '';

    if (!trailers.length) {
        wrap.innerHTML = '<button type="button" class="gd-creator-placeholder-card gd-creator-add-card" data-gd-creator-action="add-media" data-field="trailers">Add trailer</button>';
        return;
    }

    // ── Featured: index 0 only ────────────────────────────────────────────────
    const selectedIndex = 0;
    const featuredDiv = document.createElement('div');
    featuredDiv.className = 'gd-creator-trailer-featured';
    featuredDiv.innerHTML = _gdCreatorTrailerPreviewHtml(trailers[selectedIndex], selectedIndex);
    wrap.appendChild(featuredDiv);

    // ── Strip: every trailer EXCEPT the featured one + Add Another button ───────
    // Always rendered so the user can always add more trailers.
    const stripEl = document.createElement('div');
    stripEl.className = 'gd-ct-strip gd-ct-strip-with-add';
    trailers.forEach((url, index) => {
        if (index === selectedIndex) return; // skip featured — do not duplicate
        stripEl.insertAdjacentHTML('beforeend', _gdCreatorTrailerThumbHtml(url, index));
    });
    stripEl.insertAdjacentHTML('beforeend', `
        <button type="button"
            class="gd-creator-media-card gd-creator-add-card gd-creator-add-trailer-card"
            data-gd-creator-action="add-media"
            data-field="trailers"
            title="Add another trailer">
            <span>+ Add another trailer</span>
        </button>
    `);
    wrap.appendChild(stripEl);
}

async function _gdCreatorAddTrailerOnce() {
    if (_gdCreatorAddingTrailer) return;
    _gdCreatorAddingTrailer = true;
    try {
        const value = await _gdCreatorMediaPickerModal({
            mode: 'trailer',
            label: 'Add trailer',
        });
        if (!value) return;
        const normalized = _gdNormalizeCreatorTrailer(value);
        if (!normalized) return;
        const current = _gdNormalizeTrailerList(_gdCreatorDraft?.trailers || []);
        const next = _gdUpsertUniqueTrailer(current, normalized);
        _gdCreatorSetDraft('trailers', next);
        _gdCreatorApplyDraftToPage();
    } finally {
        _gdCreatorAddingTrailer = false;
    }
}

window._gdCreatorTrailerTestUtils = {
    normalizeCreatorTrailer: _gdNormalizeCreatorTrailer,
    normalizeTrailerList: _gdNormalizeTrailerList,
    upsertUniqueTrailer: _gdUpsertUniqueTrailer,
    trailerKey: _gdTrailerKey,
};

function _gdCreatorLogoControls(target) {
    if (!target) return;
    const mode = (_gdCreatorDraft?.logoMode || 'text');

    let wrap = target.querySelector('.gd-creator-logo-ctrl');
    if (!wrap) {
        wrap = document.createElement('div');
        wrap.className = 'gd-creator-logo-ctrl';
        target.appendChild(wrap);
    }

    if (mode === 'image') {
        wrap.innerHTML = `
            <button type="button" class="gd-lc-btn" data-gd-creator-action="edit-image" data-field="logoImage" data-label="Change logo">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                Change Logo
            </button>
            <button type="button" class="gd-lc-btn" data-gd-creator-action="toggle-logo-mode" title="Switch to text title">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>
                Use Text Title
            </button>
            <button type="button" class="gd-lc-btn gd-lc-btn-danger" data-gd-creator-action="remove-logo">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                Remove Logo
            </button>`;
    } else {
        wrap.innerHTML = `
            <button type="button" class="gd-lc-btn" data-gd-creator-action="edit-image" data-field="logoImage" data-label="Choose logo image" data-switch-to-logo="true">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                Use Logo Image
            </button>`;
    }
}

// ── Creator Mode: delegated event handler ─────────────────────────────────────

/**
 * Reads the current values of all .gd-ct-title-input elements and writes them
 * back into _gdCreatorDraft.trailers and _gdCurrentCustomDetails.
 * Must be called right before any save/persist operation so that titles the
 * user typed (without blurring the field) are not lost.
 */
function _gdSyncTrailerInputsToDraft() {
    if (!_gdCreatorDraft) return;

    const list = _gdNormalizeTrailerList(_gdCreatorDraft.trailers || []);

    document.querySelectorAll('.gd-ct-title-input[data-trailer-index]').forEach(input => {
        const index = Number(input.dataset.trailerIndex);
        if (!Number.isInteger(index) || index < 0 || !list[index]) return;

        list[index] = {
            ...list[index],
            title: String(input.value || '').trim(),
        };
    });

    _gdCreatorDraft.trailers = list;
    // NOTE: do NOT assign _gdCurrentCustomDetails here — that would leak draft into committed state.
}

function _gdInstallCreatorDelegation() {
    if (_gdCreatorDelegationInstalled) return;
    _gdCreatorDelegationInstalled = true;
    const view = document.getElementById('gameDetailsView');
    if (!view) return;
    view.addEventListener('click', _gdCreatorDelegatedClick);
    view.addEventListener('input', _gdCreatorDelegatedInput);
}

function _gdCreatorDelegatedInput(e) {
    if (!_gdIsCreatorEditing()) return;
    const input = e.target.closest('.gd-ct-title-input');
    if (!input) return;
    const idx = Number(input.dataset.trailerIndex);
    if (isNaN(idx) || idx < 0) return;
    if (!_gdCreatorDraft) _gdCreatorDraft = _gdCreatorDraftFromCurrent();
    const list = _gdNormalizeTrailerList(_gdCreatorDraft.trailers || []);
    if (!list[idx]) return;
    list[idx] = { ...list[idx], title: String(input.value || '').trim() };
    _gdCreatorDraft.trailers = list;
    // NOTE: do NOT assign _gdCurrentCustomDetails here — draft only.
}

async function _gdCreatorDelegatedClick(e) {
    if (!_gdIsCreatorEditing()) return;

    // Walk up from click target to find the action element
    const btn = e.target.closest('[data-gd-creator-action]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();

    const action = btn.dataset.gdCreatorAction;
    const field  = btn.dataset.field  || btn.dataset.gdEditField || null;
    const index  = btn.dataset.index     !== undefined ? Number(btn.dataset.index)     : undefined;
    const dir    = btn.dataset.direction !== undefined ? Number(btn.dataset.direction) : undefined;

    switch (action) {

        case 'add-media': {
            if (!field) break;
            const isTrailer = field === 'trailers';
            if (isTrailer) {
                await _gdCreatorAddTrailerOnce();
                break;
            }
            const addLabel  = isTrailer ? 'Add trailer' : 'Add screenshot';
            const addMode   = isTrailer ? 'trailer' : 'image';
            const addValue  = await _gdCreatorMediaPickerModal({ mode: addMode, label: addLabel });
            if (!addValue) break;
            const addList = _gdUniqList(_gdCreatorDraft?.[field] || []);
            addList.push(addValue);
            _gdCreatorSetDraft(field, addList);
            _gdCreatorApplyDraftToPage();
            break;
        }

        case 'edit-trailer': {
            if (index === undefined) break;
            const tList    = _gdNormalizeTrailerList(_gdCreatorDraft?.trailers || []);
            const tExisting = tList[index] || { url: '', title: '', thumbnail: '' };
            const tValue   = await _gdCreatorMediaPickerModal({
                mode: 'trailer',
                label: 'Edit trailer URL',
                current: tExisting.url,
            });
            if (tValue == null) break;
            const tNewObj = _gdNormalizeCreatorTrailer(tValue);
            if (!tNewObj) break;
            tList[index] = { ...tNewObj, title: tExisting.title, thumbnail: tExisting.thumbnail };
            _gdCreatorSetDraft('trailers', tList);
            _gdCreatorApplyDraftToPage();
            break;
        }

        case 'edit-trailer-thumbnail': {
            if (index === undefined) break;
            const ttList = _gdNormalizeTrailerList(_gdCreatorDraft?.trailers || []);
            const ttExisting = ttList[index] || { url: '', title: '', thumbnail: '' };
            const ttValue = await _gdCreatorMediaPickerModal({
                mode: 'image',
                label: 'Trailer thumbnail',
                current: ttExisting.thumbnail || '',
            });
            if (ttValue == null) break;
            ttList[index] = { ...ttExisting, thumbnail: ttValue };
            _gdCreatorSetDraft('trailers', ttList);
            _gdCreatorApplyDraftToPage();
            break;
        }

        case 'clear-trailer-thumbnail': {
            if (index === undefined) break;
            const ctList = _gdNormalizeTrailerList(_gdCreatorDraft?.trailers || []);
            if (!ctList[index]) break;
            ctList[index] = { ...ctList[index], thumbnail: '' };
            _gdCreatorSetDraft('trailers', ctList);
            _gdCreatorApplyDraftToPage();
            break;
        }

        case 'remove-media': {
            if (!field || index === undefined) break;
            const rmList = field === 'trailers'
                ? _gdNormalizeTrailerList(_gdCreatorDraft?.trailers || [])
                : _gdUniqList(_gdCreatorDraft?.[field] || []);
            rmList.splice(index, 1);
            _gdCreatorSetDraft(field, rmList);
            _gdCreatorApplyDraftToPage();
            break;
        }

        case 'move-media': {
            if (!field || index === undefined || dir === undefined) break;
            const mvList = field === 'trailers'
                ? _gdNormalizeTrailerList(_gdCreatorDraft?.trailers || [])
                : _gdUniqList(_gdCreatorDraft?.[field] || []);
            const next = index + dir;
            if (next < 0 || next >= mvList.length) break;
            [mvList[index], mvList[next]] = [mvList[next], mvList[index]];
            _gdCreatorSetDraft(field, mvList);
            _gdCreatorApplyDraftToPage();
            break;
        }

        case 'edit-image': {
            if (!field) break;
            e.stopPropagation();
            const imgLabel   = btn.dataset.label || 'Change image';
            const switchLogo = btn.dataset.switchToLogo === 'true';
            _gdCreatorPickImage(field, imgLabel, switchLogo);  // async, fire-and-forget
            break;
        }

        case 'toggle-logo-mode': {
            e.stopPropagation();
            const next = (_gdCreatorDraft?.logoMode || 'text') === 'image' ? 'text' : 'image';
            _gdCreatorSetDraft('logoMode', next);
            _gdCreatorApplyDraftToPage();
            break;
        }

        case 'remove-logo': {
            e.stopPropagation();
            _gdCreatorSetDraft('logoImage', '');
            _gdCreatorSetDraft('logoMode', 'text');
            _gdCreatorApplyDraftToPage();
            break;
        }

        case 'edit-ratings': {
            const newRatings = await _gdCreatorRatingsModal(_gdCreatorDraft?.ratings || []);
            if (newRatings !== null) {
                _gdCreatorSetDraft('ratings', newRatings);
                _gdCreatorApplyDraftToPage();
            }
            break;
        }

        case 'edit-field': {
            if (!field) break;
            const efLabel   = btn.dataset.label || field;
            const efCurrent = _gdCreatorDraft?.[field];
            await _gdCreatorPrompt(field, efLabel, efCurrent ?? '');
            break;
        }

        default:
            break;
    }
}

async function _gdCreatorPickImage(field, label, switchToLogoMode = false) {
    if (!_gdIsCreatorEditing() || !_gdCreatorDraft) return;
    const value = await _gdCreatorMediaPickerModal({ mode: 'image', label, current: _gdCreatorDraft[field] || '' });
    if (!value) return;
    _gdCreatorSetDraft(field, value);
    if (switchToLogoMode && field === 'logoImage' && value) {
        _gdCreatorSetDraft('logoMode', 'image');
    }
    _gdCreatorApplyDraftToPage();
}

// ── Creator media picker modal (File | Link tabs) ─────────────────────────────

async function _gdCreatorMediaPickerModal({ mode = 'image', label = '', current = '' }) {
    const isTrailer = mode === 'trailer';
    const acceptExt = isTrailer
        ? '.mp4, .webm, .mov, .m4v, .ogv'
        : '.jpg, .jpeg, .png, .webp, .avif, .gif';
    const linkHint  = isTrailer
        ? 'YouTube URL (youtube.com/watch?v=… or youtu.be/…) or direct video link (.mp4, .webm, .mov …)'
        : 'https:// or file:// URL ending in an image extension';
    const linkPlaceholder = isTrailer ? 'https://youtube.com/watch?v=...' : 'https://example.com/image.jpg';

    return new Promise((resolve) => {
        let modal = document.getElementById('gdCreatorMediaModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'gdCreatorMediaModal';
            modal.className = 'gd-creator-modal-backdrop gd-creator-modal-overlay';
            document.body.appendChild(modal);
        }

        modal.innerHTML = `
            <div class="gd-creator-modal gd-creator-modal-box gd-media-picker-box" role="dialog" aria-modal="true">
                <div class="gd-creator-modal-header gd-media-picker-header">
                    <div>
                        <span class="gd-creator-modal-title gd-creator-modal-label">${_gdEscHtml(label)}</span>
                        <p class="gd-creator-modal-subtitle">Choose a local file or paste a safe media link.</p>
                    </div>
                    <button type="button" class="gd-media-picker-close" id="gdMpClose" aria-label="Close">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                    </button>
                </div>
                <div class="gd-creator-modal-body">
                <div class="gd-media-picker-tabs" id="gdMpTabs">
                    <button type="button" class="gd-mp-tab active" data-tab="file">
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                        From device
                    </button>
                    <button type="button" class="gd-mp-tab" data-tab="link">
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                        Paste link
                    </button>
                </div>
                <div class="gd-mp-panel" id="gdMpPanelFile">
                    <p class="gd-mp-hint">Accepted: <span class="gd-mp-ext">${_gdEscHtml(acceptExt)}</span></p>
                    <button type="button" class="gd-creator-modal-btn primary" id="gdMpChooseFile">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        Choose file
                    </button>
                    <div class="gd-mp-selected" id="gdMpSelectedFile" style="display:none"></div>
                </div>
                <div class="gd-mp-panel" id="gdMpPanelLink" style="display:none">
                    <p class="gd-mp-hint">${_gdEscHtml(linkHint)}</p>
                    <input type="url" id="gdMpLinkInput" class="gd-creator-modal-input"
                           placeholder="${_gdEscHtml(linkPlaceholder)}" value="${_gdEscHtml(current)}">
                    <div class="gd-mp-link-err" id="gdMpLinkErr" style="display:none"></div>
                </div>
                </div>
                <div class="gd-creator-modal-footer gd-creator-modal-actions">
                    <button type="button" class="gd-creator-action gd-creator-secondary gd-creator-modal-btn" id="gdMpCancel">Cancel</button>
                    <button type="button" class="gd-creator-action gd-creator-primary gd-creator-modal-btn primary" id="gdMpOk">Use this</button>
                </div>
            </div>`;
        modal.style.display = 'flex';

        let chosenFileUrl = null;
        let activeTab = 'file';

        const panelFile  = document.getElementById('gdMpPanelFile');
        const panelLink  = document.getElementById('gdMpPanelLink');
        const linkInput  = document.getElementById('gdMpLinkInput');
        const linkErr    = document.getElementById('gdMpLinkErr');
        const selLabel   = document.getElementById('gdMpSelectedFile');

        // Tab switching
        document.getElementById('gdMpTabs').onclick = (ev) => {
            const tab = ev.target.closest('.gd-mp-tab');
            if (!tab) return;
            activeTab = tab.dataset.tab;
            document.querySelectorAll('#gdMpTabs .gd-mp-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === activeTab));
            panelFile.style.display  = activeTab === 'file'  ? '' : 'none';
            panelLink.style.display  = activeTab === 'link' ? '' : 'none';
        };

        // File chooser
        document.getElementById('gdMpChooseFile').onclick = async () => {
            let filePath = null;
            if (isTrailer) {
                filePath = await window.electronAPI?.selectImage?.().catch(() => null);
            } else {
                filePath = await window.electronAPI?.selectImage?.().catch(() => null);
            }
            if (!filePath) return;

            if (!isTrailer) {
                // Always convert to base64 — no more file:// or asset:// paths
                try {
                    const fileUrl = 'file://' + String(filePath).replace(/\\/g, '/');
                    const resp = await fetch(fileUrl);
                    const blob = await resp.blob();
                    chosenFileUrl = await new Promise((res, rej) => {
                        const r = new FileReader();
                        r.onload  = () => res(r.result);
                        r.onerror = () => rej(new Error('FileReader failed'));
                        r.readAsDataURL(blob);
                    });
                } catch (_) {
                    // Reliable fallback using our helper
                    try {
                        const fileObj = new File([], filePath); // dummy to trigger helper
                        chosenFileUrl = await _gdFileToBase64(fileObj);
                    } catch {
                        chosenFileUrl = 'file://' + String(filePath).replace(/\\/g, '/'); // last resort
                    }
                }
            } else {
                chosenFileUrl = 'file://' + String(filePath).replace(/\\/g, '/');
            }

            const shortName = String(filePath).replace(/\\/g, '/').split('/').pop();
            selLabel.textContent = shortName || chosenFileUrl;
            selLabel.style.display = '';
        };

        // Close / cancel
        const finish = (val) => { modal.style.display = 'none'; resolve(val || null); };
        document.getElementById('gdMpClose').onclick   = () => finish(null);
        document.getElementById('gdMpCancel').onclick  = () => finish(null);
        modal.onclick = (ev) => { if (ev.target === modal) finish(null); };

        // OK
        document.getElementById('gdMpOk').onclick = () => {
            if (activeTab === 'file') {
                if (!chosenFileUrl) return;
                finish(chosenFileUrl);
            } else {
                const v = (linkInput?.value || '').trim();
                if (!v) { linkErr.textContent = 'Please paste a URL.'; linkErr.style.display = ''; return; }
                linkErr.style.display = 'none';
                finish(isTrailer ? _gdNormalizeCreatorTrailerUrl(v) : v);
            }
        };

        // Keyboard
        linkInput?.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') document.getElementById('gdMpOk')?.click();
            if (ev.key === 'Escape') finish(null);
        });
        setTimeout(() => { if (activeTab === 'link') linkInput?.focus(); }, 30);
    });
}

// ── Source-specific ratings editor modal ─────────────────────────────────────
const _GD_RATING_SOURCES = [
    { key: 'metacritic',   label: 'Metacritic',    min: 0, max: 100, step: 1,   fields: ['score', 'total_reviews'] },
    { key: 'steam',        label: 'Steam',          min: 0, max: 100, step: 1,   fields: ['positive_count', 'negative_count'] },
    { key: 'epic',         label: 'Epic',           min: 0, max: 5,   step: 0.1, fields: ['score', 'total_reviews'] },
    { key: 'igdb_critics', label: 'IGDB Critics',   min: 0, max: 10,  step: 0.1, fields: ['score', 'total_reviews'] },
    { key: 'igdb_users',   label: 'IGDB Users',     min: 0, max: 10,  step: 0.1, fields: ['score', 'total_reviews'] },
];

async function _gdCreatorRatingsModal(currentRatings) {
    return new Promise((resolve) => {
        let modal = document.getElementById('gdCreatorRatingsModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'gdCreatorRatingsModal';
            modal.className = 'gd-creator-modal-overlay';
            document.body.appendChild(modal);
        }

        let workingRatings = JSON.parse(JSON.stringify(currentRatings || []));

        const renderModal = () => {
            const listHtml = workingRatings.map((r, i) => {
                const cfg = _GD_RATING_SOURCES.find(s => s.key === r.source) || { label: r.source || 'Custom', max: 100 };
                const isSteam = r.source === 'steam';
                let scoreLine, subLine;
                if (isSteam) {
                    const pos   = Number(r.positive_count || 0);
                    const neg   = Number(r.negative_count || 0);
                    const total = pos + neg;
                    const pct   = total > 0 ? Math.round((pos / total) * 100) : 0;
                    scoreLine = `${pct}% positive`;
                    subLine   = `${pos.toLocaleString()} pos / ${neg.toLocaleString()} neg`;
                } else {
                    scoreLine = `${r.score}/${cfg.max}`;
                    subLine   = r.total_reviews ? `${Number(r.total_reviews).toLocaleString()} reviews` : '';
                }
                return `<div class="gd-rating-entry" data-idx="${i}">
                    <div class="gd-re-info">
                        <span class="gd-rating-entry-src">${_gdEscHtml(cfg.label)}</span>
                        <span class="gd-rating-entry-score">${_gdEscHtml(scoreLine)}</span>
                        ${subLine ? `<span class="gd-rating-entry-sub">${_gdEscHtml(subLine)}</span>` : ''}
                    </div>
                    <div class="gd-re-actions">
                        <button type="button" class="gd-lc-btn" data-gd-rm-edit="${i}">
                            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                            Edit
                        </button>
                        <button type="button" class="gd-lc-btn gd-lc-btn-danger" data-gd-rm-remove="${i}">
                            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                            Remove
                        </button>
                    </div>
                </div>`;
            }).join('');

            const addedSources = new Set(workingRatings.map(r => r.source));
            const availableSources = _GD_RATING_SOURCES.filter(s => !addedSources.has(s.key));
            const addOptionsHtml = availableSources.map(s =>
                `<option value="${s.key}">${_gdEscHtml(s.label)}</option>`
            ).join('');

            modal.innerHTML = `<div class="gd-creator-modal-box gd-ratings-modal-box" role="dialog" aria-modal="true">
                <div class="gd-media-picker-header">
                    <span class="gd-creator-modal-label">Ratings</span>
                    <button type="button" class="gd-media-picker-close" id="gdRmClose" aria-label="Close">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                    </button>
                </div>
                <div class="gd-ratings-list" id="gdRmList">
                    ${listHtml || '<p class="gd-mp-hint" style="margin:0">No ratings yet. Add one below.</p>'}
                </div>
                ${availableSources.length ? `
                <div class="gd-ratings-src-label">Add a rating source</div>
                <div class="gd-rating-src-cards" id="gdRmSrcCards">
                    ${availableSources.map(s => {
                        let iconHtml = '';
                        if (s.key === 'metacritic')   iconHtml = `<img src="../assets/Metacritic.svg" class="gd-rsc-icon" alt="">`;
                        else if (s.key === 'steam')   iconHtml = `<img src="../assets/Steam.png" class="gd-rsc-icon" alt="">`;
                        else if (s.key === 'epic')    iconHtml = `<img src="../assets/epic.svg" class="gd-rsc-icon gd-rsc-icon-invert" alt="">`;
                        else if (s.key.startsWith('igdb')) iconHtml = `<img src="../assets/igdb.png" class="gd-rsc-icon" alt="">`;
                        const constraint = s.key === 'steam' ? 'pos / neg counts'
                            : s.key === 'metacritic' ? '0 – 100'
                            : `0 – ${s.max}`;
                        return `<button type="button" class="gd-rating-src-card" data-gd-src="${s.key}">
                            <span class="gd-rsc-icon-wrap">${iconHtml}</span>
                            <span class="gd-rsc-name">${_gdEscHtml(s.label)}</span>
                            <span class="gd-rsc-constraint">${_gdEscHtml(constraint)}</span>
                        </button>`;
                    }).join('')}
                </div>` : ''}
                <div class="gd-creator-modal-actions">
                    <button type="button" class="gd-creator-modal-btn" id="gdRmCancel">Cancel</button>
                    <button type="button" class="gd-creator-modal-btn primary" id="gdRmOk">Save ratings</button>
                </div>
            </div>`;
            modal.style.display = 'flex';

            // Edit buttons
            modal.querySelectorAll('[data-gd-rm-edit]').forEach(btn => {
                btn.onclick = async () => {
                    const idx = Number(btn.dataset.gdRmEdit);
                    const r = workingRatings[idx];
                    const cfg = _GD_RATING_SOURCES.find(s => s.key === r.source) || { label: r.source, min: 0, max: 100, step: 1 };
                    const edited = await _gdCreatorRatingEntryModal(r, cfg);
                    if (edited) { workingRatings[idx] = edited; renderModal(); }
                };
            });
            // Remove buttons
            modal.querySelectorAll('[data-gd-rm-remove]').forEach(btn => {
                btn.onclick = () => {
                    workingRatings.splice(Number(btn.dataset.gdRmRemove), 1);
                    renderModal();
                };
            });

            document.getElementById('gdRmClose').onclick   = () => { modal.style.display = 'none'; resolve(null); };
            document.getElementById('gdRmCancel').onclick  = () => { modal.style.display = 'none'; resolve(null); };
            modal.onclick = (ev) => { if (ev.target === modal) { modal.style.display = 'none'; resolve(null); } };
            document.getElementById('gdRmOk').onclick = () => { modal.style.display = 'none'; resolve(workingRatings); };

            const srcCards = document.getElementById('gdRmSrcCards');
            if (srcCards) {
                srcCards.querySelectorAll('.gd-rating-src-card').forEach(card => {
                    card.onclick = async () => {
                        const srcKey = card.dataset.gdSrc;
                        const cfg = _GD_RATING_SOURCES.find(s => s.key === srcKey);
                        if (!cfg) return;
                        const entry = await _gdCreatorRatingEntryModal({ source: srcKey }, cfg);
                        if (entry) { workingRatings.push(entry); renderModal(); }
                    };
                });
            }
        };

        renderModal();
    });
}

async function _gdCreatorRatingEntryModal(existing, cfg) {
    return new Promise((resolve) => {
        let modal = document.getElementById('gdCreatorRatingEntryModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'gdCreatorRatingEntryModal';
            modal.className = 'gd-creator-modal-overlay';
            modal.style.zIndex = '10001';
            document.body.appendChild(modal);
        }

        const isSteam = cfg.key === 'steam';
        const posCount = existing.positive_count ?? 0;
        const negCount = existing.negative_count ?? 0;
        const total    = posCount + negCount;
        const computed = total > 0 ? Math.round((posCount / total) * 100) : 0;

        const fieldsHtml = isSteam ? `
            <label class="gd-creator-modal-label">Positive reviews</label>
            <input type="number" id="gdRePos" class="gd-creator-modal-input" min="0" step="1" value="${posCount}" placeholder="0">
            <label class="gd-creator-modal-label" style="margin-top:10px">Negative reviews</label>
            <input type="number" id="gdReNeg" class="gd-creator-modal-input" min="0" step="1" value="${negCount}" placeholder="0">
            <p class="gd-mp-hint" id="gdReSteamCalc">Calculated: ${computed}% positive (${total} total)</p>
        ` : `
            <label class="gd-creator-modal-label">Score (0 – ${cfg.max})</label>
            <input type="number" id="gdReScore" class="gd-creator-modal-input" min="${cfg.min}" max="${cfg.max}" step="${cfg.step}" value="${existing.score ?? ''}" placeholder="0">
            <label class="gd-creator-modal-label" style="margin-top:10px">Total reviews (optional)</label>
            <input type="number" id="gdReReviews" class="gd-creator-modal-input" min="0" step="1" value="${existing.total_reviews ?? ''}" placeholder="0">
        `;

        modal.innerHTML = `<div class="gd-creator-modal-box" role="dialog" aria-modal="true">
            <div class="gd-media-picker-header">
                <span class="gd-creator-modal-label">${_gdEscHtml(cfg.label)}</span>
                <button type="button" class="gd-media-picker-close" id="gdReClose" aria-label="Close">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
            </div>
            <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:4px">
                ${fieldsHtml}
                <div class="gd-mp-link-err" id="gdReErr" style="display:none"></div>
            </div>
            <div class="gd-creator-modal-actions">
                <button type="button" class="gd-creator-modal-btn" id="gdReCancel">Back</button>
                <button type="button" class="gd-creator-modal-btn primary" id="gdReOk">Save</button>
            </div>
        </div>`;
        modal.style.display = 'flex';

        if (isSteam) {
            const updateCalc = () => {
                const p = Math.max(0, Number(document.getElementById('gdRePos')?.value) || 0);
                const n = Math.max(0, Number(document.getElementById('gdReNeg')?.value) || 0);
                const t = p + n;
                const pct = t > 0 ? Math.round((p / t) * 100) : 0;
                const el = document.getElementById('gdReSteamCalc');
                if (el) el.textContent = `Calculated: ${pct}% positive (${t} total)`;
            };
            document.getElementById('gdRePos')?.addEventListener('input', updateCalc);
            document.getElementById('gdReNeg')?.addEventListener('input', updateCalc);
        }

        const finish = (ok) => {
            modal.style.display = 'none';
            if (!ok) { resolve(null); return; }
            const errEl = document.getElementById('gdReErr');
            try {
                if (isSteam) {
                    const pos = Math.max(0, Number(document.getElementById('gdRePos')?.value) || 0);
                    const neg = Math.max(0, Number(document.getElementById('gdReNeg')?.value) || 0);
                    const tot = pos + neg;
                    resolve({ source: cfg.key, label: cfg.label, positive_count: pos, negative_count: neg,
                               total_reviews: tot, score: tot > 0 ? Math.round((pos / tot) * 100) : 0, max_score: 100 });
                } else {
                    const score = Number(document.getElementById('gdReScore')?.value);
                    if (isNaN(score) || score < cfg.min || score > cfg.max) {
                        if (errEl) { errEl.textContent = `Score must be ${cfg.min} – ${cfg.max}.`; errEl.style.display = ''; }
                        return;
                    }
                    const reviews = Number(document.getElementById('gdReReviews')?.value) || null;
                    resolve({ source: cfg.key, label: cfg.label, score, max_score: cfg.max,
                               total_reviews: reviews || null });
                }
            } catch (err) {
                if (errEl) { errEl.textContent = 'Invalid values.'; errEl.style.display = ''; }
            }
        };

        document.getElementById('gdReClose').onclick   = () => { modal.style.display = 'none'; resolve(null); };
        document.getElementById('gdReCancel').onclick  = () => { modal.style.display = 'none'; resolve(null); };
        document.getElementById('gdReOk').onclick      = () => finish(true);
        modal.onclick = (ev) => { if (ev.target === modal) { modal.style.display = 'none'; resolve(null); } };
    });
}

// Active ratings editor: one overlay with internal steps. The older entry helper
// stays above only for backward compatibility, but this function is the one used.
async function _gdCreatorRatingsModal(currentRatings) {
    return new Promise((resolve) => {
        let modal = document.getElementById('gdCreatorRatingsModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'gdCreatorRatingsModal';
            modal.className = 'gd-creator-modal-backdrop gd-creator-modal-overlay';
            document.body.appendChild(modal);
        }
        let workingRatings = JSON.parse(JSON.stringify(currentRatings || []));
        let step = 'list';
        let editIndex = -1;
        let activeSource = null;
        let editingRating = null;

        const sourceIcon = (key) => {
            if (key === 'metacritic') return `<img src="../assets/Metacritic.svg" class="gd-rsc-icon" alt="">`;
            if (key === 'steam') return `<img src="../assets/Steam.png" class="gd-rsc-icon" alt="">`;
            if (key === 'epic') return `<img src="../assets/epic.svg" class="gd-rsc-icon gd-rsc-icon-invert" alt="">`;
            if (key?.startsWith('igdb')) return `<img src="../assets/igdb.png" class="gd-rsc-icon" alt="">`;
            return '';
        };

        const ratingRowHtml = (r, i) => {
            const cfg = _GD_RATING_SOURCES.find(s => s.key === r.source) || { label: r.source || 'Custom', max: 100 };
            const isSteam = r.source === 'steam';
            let scoreLine = '';
            let subLine = '';
            if (isSteam) {
                const pos = Number(r.positive_count || 0);
                const neg = Number(r.negative_count || 0);
                const total = pos + neg;
                const pct = total > 0 ? Math.round((pos / total) * 100) : 0;
                scoreLine = `${pct}% positive`;
                subLine = `${pos.toLocaleString()} positive / ${neg.toLocaleString()} negative / ${total.toLocaleString()} total reviews`;
            } else {
                scoreLine = `${r.score ?? 0}/${cfg.max}`;
                subLine = r.total_reviews ? `${Number(r.total_reviews).toLocaleString()} reviews` : '';
            }
            return `<div class="gd-rating-entry" data-idx="${i}">
                <div class="gd-re-info">
                    <span class="gd-rating-entry-src">${_gdEscHtml(cfg.label)}</span>
                    <span class="gd-rating-entry-score">${_gdEscHtml(scoreLine)}</span>
                    ${subLine ? `<span class="gd-rating-entry-sub">${_gdEscHtml(subLine)}</span>` : ''}
                </div>
                <div class="gd-re-actions">
                    <button type="button" class="gd-lc-btn" data-gd-rm-edit="${i}">Edit</button>
                    <button type="button" class="gd-lc-btn gd-lc-btn-danger" data-gd-rm-remove="${i}">Remove</button>
                </div>
            </div>`;
        };

        const renderEditFields = () => {
            if (!activeSource) return '';
            if (activeSource.key === 'steam') {
                const pos = Math.max(0, Number(editingRating?.positive_count) || 0);
                const neg = Math.max(0, Number(editingRating?.negative_count) || 0);
                const total = pos + neg;
                const pct = total > 0 ? Math.round((pos / total) * 100) : 0;
                return `<div class="gd-rating-form-grid">
                    <label>Positive reviews<input type="number" id="gdRePos" class="gd-creator-input gd-creator-modal-input" min="0" step="1" value="${pos}" placeholder="0"></label>
                    <label>Negative reviews<input type="number" id="gdReNeg" class="gd-creator-input gd-creator-modal-input" min="0" step="1" value="${neg}" placeholder="0"></label>
                    <div class="gd-rating-live-calc" id="gdReSteamCalc">${pct}% positive - ${total.toLocaleString()} total reviews</div>
                </div>`;
            }
            return `<div class="gd-rating-form-grid">
                <label>Score (0 - ${activeSource.max})<input type="number" id="gdReScore" class="gd-creator-input gd-creator-modal-input" min="${activeSource.min}" max="${activeSource.max}" step="${activeSource.step}" value="${editingRating?.score ?? ''}" placeholder="0"></label>
                <label>Total reviews<input type="number" id="gdReReviews" class="gd-creator-input gd-creator-modal-input" min="0" step="1" value="${editingRating?.total_reviews ?? ''}" placeholder="0"></label>
            </div>`;
        };

        const saveSource = () => {
            const errEl = document.getElementById('gdReErr');
            if (errEl) errEl.style.display = 'none';
            if (!activeSource) return;
            if (activeSource.key === 'steam') {
                const pos = Math.max(0, Number(document.getElementById('gdRePos')?.value) || 0);
                const neg = Math.max(0, Number(document.getElementById('gdReNeg')?.value) || 0);
                const total = pos + neg;
                const entry = { source: activeSource.key, label: activeSource.label, positive_count: pos, negative_count: neg, total_reviews: total, score: total > 0 ? Math.round((pos / total) * 100) : 0, max_score: 100 };
                if (editIndex >= 0) workingRatings[editIndex] = entry; else workingRatings.push(entry);
            } else {
                const score = Number(document.getElementById('gdReScore')?.value);
                if (isNaN(score) || score < activeSource.min || score > activeSource.max) {
                    if (errEl) { errEl.textContent = `Score must be ${activeSource.min} - ${activeSource.max}.`; errEl.style.display = ''; }
                    return;
                }
                const reviews = Math.max(0, Number(document.getElementById('gdReReviews')?.value) || 0);
                const entry = { source: activeSource.key, label: activeSource.label, score, max_score: activeSource.max, total_reviews: reviews };
                if (editIndex >= 0) workingRatings[editIndex] = entry; else workingRatings.push(entry);
            }
            step = 'list';
            editIndex = -1;
            activeSource = null;
            editingRating = null;
            render();
        };

        const render = () => {
            const addedSources = new Set(workingRatings.map(r => r.source));
            const availableSources = _GD_RATING_SOURCES.filter(s => !addedSources.has(s.key));
            const bodyHtml = step === 'edit' && activeSource ? `
                <div class="gd-rating-step-head">
                    <button type="button" class="gd-lc-btn" id="gdRmBack">Back</button>
                    <div><strong>${_gdEscHtml(activeSource.label)}</strong><span>${activeSource.key === 'steam' ? 'Steam percentage is calculated live.' : 'Enter the score and review count.'}</span></div>
                </div>
                ${renderEditFields()}
                <div class="gd-mp-link-err" id="gdReErr" style="display:none"></div>
            ` : `
                <div class="gd-ratings-list" id="gdRmList">${workingRatings.map(ratingRowHtml).join('') || '<p class="gd-mp-hint" style="margin:0">No ratings yet. Add one below.</p>'}</div>
                ${availableSources.length ? `<div class="gd-ratings-src-label">Add a rating source</div><div class="gd-rating-src-cards" id="gdRmSrcCards">${availableSources.map(s => {
                    const constraint = s.key === 'steam' ? 'positive and negative counts' : (s.key === 'metacritic' ? '0 - 100' : `0 - ${s.max}`);
                    return `<button type="button" class="gd-rating-src-card" data-gd-src="${s.key}"><span class="gd-rsc-icon-wrap">${sourceIcon(s.key)}</span><span class="gd-rsc-name">${_gdEscHtml(s.label)}</span><span class="gd-rsc-constraint">${_gdEscHtml(constraint)}</span></button>`;
                }).join('')}</div>` : '<p class="gd-mp-hint" style="margin:0">All available rating sources are already added.</p>'}
            `;
            modal.innerHTML = `<div class="gd-creator-modal gd-creator-modal-box gd-ratings-modal-box" role="dialog" aria-modal="true">
                <div class="gd-creator-modal-header gd-media-picker-header">
                    <div><span class="gd-creator-modal-title gd-creator-modal-label">Ratings</span><p class="gd-creator-modal-subtitle">One clean editor with source-specific fields.</p></div>
                    <button type="button" class="gd-media-picker-close" id="gdRmClose" aria-label="Close"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
                </div>
                <div class="gd-creator-modal-body">${bodyHtml}</div>
                <div class="gd-creator-modal-footer gd-creator-modal-actions">
                    <button type="button" class="gd-creator-action gd-creator-secondary gd-creator-modal-btn" id="gdRmCancel">${step === 'edit' ? 'Cancel edit' : 'Cancel'}</button>
                    <button type="button" class="gd-creator-action gd-creator-primary gd-creator-modal-btn primary" id="gdRmOk">${step === 'edit' ? 'Save source' : 'Save ratings'}</button>
                </div>
            </div>`;
            modal.style.display = 'flex';

            document.getElementById('gdRmClose').onclick = () => { modal.style.display = 'none'; resolve(null); };
            modal.onclick = (ev) => { if (ev.target === modal) { modal.style.display = 'none'; resolve(null); } };
            document.getElementById('gdRmCancel').onclick = () => {
                if (step === 'edit') { step = 'list'; activeSource = null; editingRating = null; editIndex = -1; render(); }
                else { modal.style.display = 'none'; resolve(null); }
            };
            document.getElementById('gdRmOk').onclick = () => {
                if (step === 'edit') saveSource();
                else { modal.style.display = 'none'; resolve(workingRatings); }
            };
            document.getElementById('gdRmBack')?.addEventListener('click', () => {
                step = 'list'; activeSource = null; editingRating = null; editIndex = -1; render();
            });
            modal.querySelectorAll('[data-gd-rm-edit]').forEach(btn => {
                btn.onclick = () => {
                    editIndex = Number(btn.dataset.gdRmEdit);
                    editingRating = { ...workingRatings[editIndex] };
                    activeSource = _GD_RATING_SOURCES.find(s => s.key === editingRating.source) || { key: editingRating.source, label: editingRating.source, min: 0, max: 100, step: 1 };
                    step = 'edit';
                    render();
                };
            });
            modal.querySelectorAll('[data-gd-rm-remove]').forEach(btn => {
                btn.onclick = () => { workingRatings.splice(Number(btn.dataset.gdRmRemove), 1); render(); };
            });
            modal.querySelectorAll('[data-gd-src]').forEach(btn => {
                btn.onclick = () => {
                    activeSource = _GD_RATING_SOURCES.find(s => s.key === btn.dataset.gdSrc);
                    editingRating = { source: btn.dataset.gdSrc };
                    editIndex = -1;
                    step = 'edit';
                    render();
                };
            });
            const updateSteamCalc = () => {
                const pos = Math.max(0, Number(document.getElementById('gdRePos')?.value) || 0);
                const neg = Math.max(0, Number(document.getElementById('gdReNeg')?.value) || 0);
                const total = pos + neg;
                const pct = total > 0 ? Math.round((pos / total) * 100) : 0;
                const calc = document.getElementById('gdReSteamCalc');
                if (calc) calc.textContent = `${pct}% positive - ${total.toLocaleString()} total reviews`;
            };
            document.getElementById('gdRePos')?.addEventListener('input', updateSteamCalc);
            document.getElementById('gdReNeg')?.addEventListener('input', updateSteamCalc);
        };

        render();
    });
}

function _gdBindCreatorEditables() {
    if (!_gdIsCreatorEditing()) return;
    _gdInstallCreatorDelegation();
    _gdSyncCreatorChrome();

    // Inline contentEditable — these stay as direct bindings since they don't use prompts
    _gdBindCreatorText(document.getElementById('gdTitle'), 'title');
    _gdBindCreatorText(document.getElementById('gdShortDesc'), 'shortDescription', true);
    _gdBindCreatorText(document.getElementById('gdFullDescText'), 'description', true);

    // Mark existing info-grid items for delegation (they get data-gd-edit-field from _gdBuildInfoGrid)
    document.querySelectorAll('[data-gd-edit-field]').forEach(el => {
        el.classList.add('gd-editable');
        el.dataset.gdCreatorAction = 'edit-field';
        el.dataset.field = el.dataset.gdEditField;
        const labelEl = el.querySelector('.gd-info-label');
        if (labelEl && !el.dataset.label) el.dataset.label = labelEl.textContent.trim();
    });

    // Style existing genre chips (platform chips are read-only)
    document.querySelectorAll('#gdGenres .gd-genre-tag').forEach(el => {
        el.classList.add('gd-editable-chip');
    });

    // Mark genre/rating sections for delegation — platform is read-only
    const genresSection = document.getElementById('gdGenresSection');
    if (genresSection) {
        genresSection.dataset.gdCreatorAction = 'edit-field';
        genresSection.dataset.field = 'genres';
        genresSection.dataset.label = 'Genres or tags, separated by commas';
    }
    const ratingBlock = document.getElementById('gdRatingBlock');
    if (ratingBlock) {
        ratingBlock.dataset.gdCreatorAction = 'edit-ratings';
        delete ratingBlock.dataset.field;
        delete ratingBlock.dataset.label;
    }

    // Persistent image edit buttons — delegation-only, no addEventListener
    _gdCreatorImageButton(document.getElementById('gdHero'), 'heroImage', 'Change hero');
    _gdCreatorImageButton(document.getElementById('gdCoverWrap'), 'posterImage', 'Change poster');
    // Logo controls are handled by the inline segmented control, not a floating button
    _gdCreatorLogoControls(document.querySelector('.gd-title-block'));

    _gdCreatorRenderPlaceholders();

    // LI LINGXI: Enable drag & drop + base64 for all media fields
    _gdSetupCreatorDragAndDrop();
}

// ── Creator Mode guided tour (driver.js) ─────────────────────────────────────
const _GD_CREATOR_TOUR_KEY = 'baddel_creator_tour_seen';

// Resolves the Driver.js factory across all known CDN/iife global shapes.
// CDN iife (driver.js@1.x): window.driver.js.driver
// Some builds: window.driver.driver
// Legacy / class build: window.Driver
function _gdResolveDriverFactory() {
    const candidates = [
        window.driver?.js?.driver,
        window.driver?.driver,
        window.driver,
        window.Driver,
    ];
    return candidates.find(fn => typeof fn === 'function') || null;
}

// Builds tour steps, resolving fallback selectors and skipping missing elements.
function _gdBuildCreatorTourSteps() {
    const rawSteps = [
        ['#gdCreatorToolbar',         'Creator Toolbar',         'Save your page, toggle Preview, or open More for sharing, help, reset, and cancel.',           'bottom', 'start'],
        ['#gdCreatorPreviewBtn',      'Preview Your Page',       'Preview hides editing controls so you can inspect the finished page.',                         'bottom', 'center'],
        ['.gd-title-block',           'Title and Logo',          'Click the identity block to edit the title or switch to a logo image.',                        'bottom', 'start'],
        ['#gdHero',                   'Hero and Poster Art',     'Use the change controls to swap artwork.',                                                      'bottom', 'center'],
        ['#gdFullDescSection,#gdOverviewSection', 'Descriptions','Add a short intro and a full overview directly from the page.',                                'top',    'start'],
        ['#gdTrailerSection',         'Trailers and Screenshots','Add trailers, screenshots, thumbnails, and reorder media.',                                     'top',    'start'],
        ['#gdRatingBlock',            'Ratings',                 'Add Metacritic, Steam, Epic, or IGDB ratings.',                                                'top',    'start'],
        ['#gdCreatorMoreBtn',         'Page Packs',              'Share this page or load a page pack from another user.',                                       'bottom', 'end'],
    ];

    return rawSteps
        .map(([selector, title, description, side, align]) => {
            const element = selector
                .split(',')
                .map(s => document.querySelector(s.trim()))
                .find(Boolean);
            if (!element) return null;
            return { element, popover: { title, description, side, align } };
        })
        .filter(Boolean);
}

// Closes the Creator More menu so it does not cover tour targets.
function _gdCloseCreatorMoreMenu() {
    const wrap = document.getElementById('gdCreatorMoreMenu')?.closest('.gd-creator-more-wrap');
    const btn  = document.getElementById('gdCreatorMoreBtn');
    wrap?.classList.remove('open', 'active', 'show');
    btn?.setAttribute('aria-expanded', 'false');
}

function _gdRunCreatorTour({ force = false } = {}) {
    const driverFactory = _gdResolveDriverFactory();

    if (!driverFactory) {
        console.error('[GD][CreatorTour] Driver.js is not available.', {
            windowDriver:       window.driver,
            windowDriverJs:     window.driver?.js,
            windowDriverDriver: window.driver?.driver,
            windowDriverJsDriver: window.driver?.js?.driver,
            windowDriverClass:  window.Driver,
        });
        if (typeof showToast === 'function') {
            showToast('Creator tour is not available because Driver.js did not load.', 'error');
        }
        return false;
    }

    const steps = _gdBuildCreatorTourSteps();
    if (!steps.length) {
        console.warn('[GD][CreatorTour] No valid tour steps found in DOM.');
        if (typeof showToast === 'function') {
            showToast('Creator tour could not start because no tour targets were found.', 'warning');
        }
        return false;
    }

    try {
        const tour = driverFactory({
            showProgress: true,
            allowClose:   true,
            nextBtnText:  'Next',
            prevBtnText:  'Back',
            doneBtnText:  'Done',
            overlayColor: 'rgba(0,0,0,0.72)',
            popoverClass: 'gd-tour-popover',
            steps,
            onDestroyed: () => {
                try { localStorage.setItem(_GD_CREATOR_TOUR_KEY, 'true'); } catch (_) {}
            },
        });
        tour.drive();
        console.info('[GD][CreatorTour] Started.', { steps: steps.length, force });
        return true;
    } catch (err) {
        console.error('[GD][CreatorTour] Failed to start.', err);
        if (typeof showToast === 'function') {
            showToast('Creator tour failed to start. Check console for details.', 'error');
        }
        return false;
    }
}

function _gdMaybeShowCreatorTour() {
    if (localStorage.getItem(_GD_CREATOR_TOUR_KEY) === 'true') return;
    // rAF ensures toolbar is painted; inner timeout lets layout stabilize.
    window.requestAnimationFrame(() => {
        setTimeout(() => _gdRunCreatorTour({ force: false }), 700);
    });
}

window.gdStartCreatorTour = function(force = false) {
    if (force) {
        try { localStorage.removeItem(_GD_CREATOR_TOUR_KEY); } catch (_) {}
    }
    _gdCloseCreatorMoreMenu();
    window.requestAnimationFrame(() => {
        setTimeout(() => _gdRunCreatorTour({ force }), 100);
    });
};

// Kept for backward compatibility with any existing call sites.
window.gdReplayCreatorTour = function() {
    window.gdStartCreatorTour(true);
};

window.gdCreatorTourDebug = function() {
    return {
        seen:               localStorage.getItem(_GD_CREATOR_TOUR_KEY),
        driver:             !!window.driver,
        driverJs:           !!window.driver?.js,
        driverJsDriver:     typeof window.driver?.js?.driver,
        driverDriver:       typeof window.driver?.driver,
        Driver:             typeof window.Driver,
        resolved:           !!_gdResolveDriverFactory(),
        toolbar:            !!document.querySelector('#gdCreatorToolbar'),
        moreBtn:            !!document.querySelector('#gdCreatorMoreBtn'),
        titleBlock:         !!document.querySelector('.gd-title-block'),
        hero:               !!document.querySelector('#gdHero'),
        steps:              _gdBuildCreatorTourSteps().length,
    };
};

window.gdOpenCreatorMode = function() {
    if (!_gdCurrentGame) return;
    console.debug('[GD][Creator] open');
    _gdSetCreatorModeState('normal', { clearDraft: false });
    // ── Snapshot the committed state before any edits begin ──────────────────
    _gdCreatorSessionBaseGame    = _gdClonePlain(_gdCurrentGame);
    _gdCreatorSessionSavedCustom = _gdClonePlain(_gdLoadCustomDetails(_gdCurrentGame) || {});
    _gdCreatorSessionSavedGame   = _gdClonePlain(_gdCurrentGame);
    // ─────────────────────────────────────────────────────────────────────────
    _gdCreatorDraft = _gdCreatorDraftFromCurrent();
    _gdCreatorOriginalDraft = _gdClonePlain(_gdCreatorDraft);
    _gdSetCreatorModeState('edit', { clearDraft: false, log: false });
    _gdCreatorApplyDraftToPage();

    // LI LINGXI: Enable drag & drop + base64 immediately when entering Creator Mode
    _gdSetupCreatorDragAndDrop();

    if (typeof showToast === 'function') showToast('Creator Mode enabled.', 'info');
    _gdMaybeShowCreatorTour();
};

// ── Page Pack Export / Import ─────────────────────────────────────────────────

function _gdSanitizeString(v) {
    return String(v || '').replace(/<[^>]*>/g, '').trim().slice(0, 2048);
}
function _gdSanitizeUrlList(arr) {
    const SAFE_IMG  = /\.(jpg|jpeg|png|webp|avif|gif)(\?.*)?$/i;
    const SAFE_VID  = /\.(mp4|webm|mov|m4v|ogv)(\?.*)?$/i;
    const SAFE_YT   = /^https?:\/\/(www\.)?youtu(\.be|be\.com)\//i;
    const SAFE_B64  = /^data:image\//i;
    return (Array.isArray(arr) ? arr : []).filter(u => {
        if (typeof u !== 'string') return false;
        const s = u.trim();
        return SAFE_IMG.test(s) || SAFE_VID.test(s) || SAFE_YT.test(s) || s.startsWith('file://') || SAFE_B64.test(s);
    }).slice(0, 100);
}
function _gdSanitizeRatings(arr) {
    const VALID_SOURCES = new Set(['metacritic','steam','epic','igdb_critics','igdb_users']);
    return (Array.isArray(arr) ? arr : []).filter(r => r && VALID_SOURCES.has(r.source)).map(r => ({
        source: r.source,
        label:  _gdSanitizeString(r.label),
        score:  Number(r.score) || 0,
        max_score: Number(r.max_score) || 100,
        total_reviews: r.total_reviews != null ? Number(r.total_reviews) : null,
        positive_count: r.positive_count != null ? Number(r.positive_count) : undefined,
        negative_count: r.negative_count != null ? Number(r.negative_count) : undefined,
    })).slice(0, 10);
}

window.gdExportCreatorPage = async function() {
    const data = _gdCurrentCustomDetails || _gdLoadCustomDetails(_gdCurrentGame);
    if (!data) {
        if (typeof showToast === 'function') showToast('No custom page to export. Save a custom page first.', 'warn');
        return;
    }
    const gameName  = (_gdCurrentGame?.name || 'game').replace(/[^a-z0-9_-]/gi, '_').slice(0, 40);
    const payload   = JSON.stringify({
        schema:     'baddel.creatorPage',
        version:    1,
        exportedAt: new Date().toISOString(),
        app:        'Baddel',
        page: {
            title:       data.title       || '',
            description: data.description || '',
            publisher:   data.publisher   || '',
            developer:   data.developer   || '',
            releaseDate: data.releaseDate  || '',
            genres:      Array.isArray(data.genres)      ? data.genres      : [],
            ratings:     Array.isArray(data.ratings)     ? data.ratings     : [],
            heroImage:   data.heroImage    || '',
            posterImage: data.posterImage  || '',
            logoImage:   data.logoImage    || '',
            logoMode:    data.logoMode === 'image' ? 'image' : 'text',
            screenshots: Array.isArray(data.screenshots) ? data.screenshots : [],
            trailers:    Array.isArray(data.trailers)    ? data.trailers    : [],
        },
    }, null, 2);

    try {
        const ok = await window.electronAPI.exportCreatorPage?.(`${gameName}.baddelpage`, payload);
        if (ok === false) return; // cancelled
        if (typeof showToast === 'function') showToast('Page pack exported.', 'success');
    } catch (err) {
        // Fallback: create a download link
        try {
            const blob = new Blob([payload], { type: 'application/json' });
            const a    = document.createElement('a');
            a.href     = URL.createObjectURL(blob);
            a.download = `${gameName}.baddelpage`;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            if (typeof showToast === 'function') showToast('Page pack exported.', 'success');
        } catch (_) {
            if (typeof showToast === 'function') showToast('Export failed.', 'error');
        }
    }
};

window.gdImportCreatorPage = async function() {
    if (!_gdCurrentGame) return;
    let jsonString = null;
    try {
        jsonString = await window.electronAPI.importCreatorPage?.();
    } catch (_) {}

    if (!jsonString) return;

    let parsed;
    try { parsed = JSON.parse(jsonString); } catch (_) {
        if (typeof showToast === 'function') showToast('Invalid file — could not parse.', 'error');
        return;
    }

    if (parsed?.schema !== 'baddel.creatorPage' || !parsed?.page) {
        if (typeof showToast === 'function') showToast('Invalid page pack file.', 'error');
        return;
    }

    const p = parsed.page;
    const importedDraft = {
        title:       _gdSanitizeString(p.title),
        description: _gdSanitizeString(p.description),
        publisher:   _gdSanitizeString(p.publisher),
        developer:   _gdSanitizeString(p.developer),
        releaseDate: /^\d{4}-\d{2}-\d{2}$/.test(p.releaseDate) ? p.releaseDate : '',
        genres:      (Array.isArray(p.genres) ? p.genres : []).map(_gdSanitizeString).filter(Boolean).slice(0, 30),
        ratings:     _gdSanitizeRatings(p.ratings),
        heroImage:   _gdSanitizeString(p.heroImage),
        posterImage: _gdSanitizeString(p.posterImage),
        logoImage:   _gdSanitizeString(p.logoImage),
        logoMode:    p.logoMode === 'image' ? 'image' : 'text',
        screenshots: _gdSanitizeUrlList(p.screenshots),
        trailers:    _gdNormalizeTrailerList(
            (Array.isArray(p.trailers) ? p.trailers : []).map(t => {
                if (typeof t === 'string') return { url: t, title: '', thumbnail: '' };
                const rawUrl = t.url;
                if (rawUrl && typeof rawUrl === 'object') {
                    return { url: rawUrl.url || '', title: rawUrl.title || t.name || '', thumbnail: rawUrl.thumbnail || '' };
                }
                return { url: String(t.url || ''), title: String(t.title || t.name || ''), thumbnail: String(t.thumbnail || '') };
            })
        ),
    };

    // Merge into Creator Mode draft — do NOT persist until user clicks Save
    _gdSetCreatorModeState('edit', { clearDraft: false });
    _gdCreatorDraft      = { ...(_gdCreatorDraftFromCurrent()), ...importedDraft };
    _gdCreatorOriginalDraft = JSON.parse(JSON.stringify(_gdCreatorDraft));
    _gdCreatorApplyDraftToPage();

    // Show confirmation in a Baddel-themed notice (not window.alert)
    if (typeof showToast === 'function') showToast('Page pack loaded. Review it, then Save to keep it.', 'info');
};

// Page Pack v2: local file/data assets are embedded by the main process and
// asset:// references are decoded back to userData on import.
window.gdExportCreatorPage = async function() {
    const data = _gdCurrentCustomDetails || _gdLoadCustomDetails(_gdCurrentGame);
    if (!data) {
        if (typeof showToast === 'function') showToast('No custom page to export. Save a custom page first.', 'warn');
        return;
    }
    const gameName = (_gdCurrentGame?.name || 'game').replace(/[^a-z0-9_-]/gi, '_').slice(0, 40);
    const payload = {
        schema: 'baddel.creatorPage',
        version: 2,
        exportedAt: new Date().toISOString(),
        app: 'Baddel',
        page: {
            title: data.title || '',
            shortDescription: data.shortDescription || '',
            description: data.description || '',
            publisher: data.publisher || '',
            developer: data.developer || '',
            releaseDate: data.releaseDate || '',
            genres: Array.isArray(data.genres) ? data.genres : [],
            ratings: Array.isArray(data.ratings) ? data.ratings : [],
            heroImage: data.heroImage || '',
            posterImage: data.posterImage || '',
            logoImage: data.logoImage || '',
            logoMode: data.logoMode === 'image' ? 'image' : 'text',
            screenshots: (Array.isArray(data.screenshots) ? data.screenshots : []).map((url, i) => ({ id: `screenshot-${i + 1}`, url })),
            trailers: _gdNormalizeTrailerList(Array.isArray(data.trailers) ? data.trailers : []).map((t, i) => ({
                id: `trailer-${i + 1}`,
                name: t.title || `Trailer ${i + 1}`,
                url: t.url,
                title: t.title || '',
                thumbnail: t.thumbnail || '',
                type: _gdParseYouTubeVideoId(t.url) ? 'youtube' : 'direct',
                source: String(t.url || '').startsWith('file://') ? 'file' : 'link',
                creatorOwned: true,
            })),
        },
        assets: {},
    };
    try {
        const ok = await (window.electronAPI.exportCreatorPagePack || window.electronAPI.exportCreatorPage)?.(`${gameName}.baddelpage`, payload);
        if (ok === false) return;
        if (typeof showToast === 'function') showToast('Page pack exported.', 'success');
    } catch (err) {
        console.warn('[GD][Creator] export failed:', err);
        if (typeof showToast === 'function') showToast(err?.message || 'Export failed.', 'error');
    }
};

window.gdImportCreatorPage = async function() {
    if (!_gdCurrentGame) return;
    let parsed = null;
    try {
        parsed = await (window.electronAPI.importCreatorPagePack || window.electronAPI.importCreatorPage)?.();
    } catch (err) {
        console.warn('[GD][Creator] import failed:', err);
    }
    if (!parsed) return;
    if (typeof parsed === 'string') {
        try { parsed = JSON.parse(parsed); } catch (_) {
            if (typeof showToast === 'function') showToast('Invalid file - could not parse.', 'error');
            return;
        }
    }
    if (parsed?.assets && window.electronAPI.resolveCreatorPageAssets) {
        try {
            parsed = await window.electronAPI.resolveCreatorPageAssets(parsed, _gdCreatorGameKey(_gdCurrentGame));
        } catch (err) {
            console.warn('[GD][Creator] asset decode failed:', err);
            if (typeof showToast === 'function') showToast('Could not unpack Page Pack assets.', 'error');
            return;
        }
    }
    if (parsed?.schema !== 'baddel.creatorPage' || !parsed?.page) {
        if (typeof showToast === 'function') showToast('Invalid page pack file.', 'error');
        return;
    }
    const p = parsed.page;
    const shotUrls = (Array.isArray(p.screenshots) ? p.screenshots : []).map(s => typeof s === 'string' ? s : s?.url).filter(Boolean);
    // Trailers: preserve full {url, title, thumbnail} objects — do NOT flatten to URL strings
    const importedTrailers = _gdNormalizeTrailerList(
        (Array.isArray(p.trailers) ? p.trailers : []).map(t => {
            if (typeof t === 'string') return { url: t, title: '', thumbnail: '' };
            // Handle the nested-url format: { url: { url, title, thumbnail } }
            const rawUrl = t.url;
            if (rawUrl && typeof rawUrl === 'object') {
                return { url: rawUrl.url || '', title: rawUrl.title || t.name || '', thumbnail: rawUrl.thumbnail || '' };
            }
            return { url: String(t.url || ''), title: String(t.title || t.name || ''), thumbnail: String(t.thumbnail || '') };
        })
    );
    const importedDraft = {
        title: _gdSanitizeString(p.title),
        shortDescription: _gdSanitizeString(p.shortDescription),
        description: _gdSanitizeString(p.description),
        publisher: _gdSanitizeString(p.publisher),
        developer: _gdSanitizeString(p.developer),
        releaseDate: /^\d{4}-\d{2}-\d{2}$/.test(p.releaseDate) ? p.releaseDate : '',
        genres: (Array.isArray(p.genres) ? p.genres : []).map(_gdSanitizeString).filter(Boolean).slice(0, 30),
        ratings: _gdSanitizeRatings(p.ratings),
        heroImage: _gdSanitizeString(p.heroImage),
        posterImage: _gdSanitizeString(p.posterImage),
        logoImage: _gdSanitizeString(p.logoImage),
        logoMode: p.logoMode === 'image' ? 'image' : 'text',
        screenshots: _gdSanitizeUrlList(shotUrls),
        trailers: importedTrailers,
        _importedFromPagePack: true,
    };
    _gdSetCreatorModeState('edit', { clearDraft: false });
    _gdCreatorDraft = { ...(_gdCreatorDraftFromCurrent()), ...importedDraft };
    _gdCreatorOriginalDraft = JSON.parse(JSON.stringify(_gdCreatorDraft));
    _gdCreatorApplyDraftToPage();
    if (typeof showToast === 'function') showToast('Page pack loaded. Review it, then Save to keep it.', 'info');
};

async function _gdRefreshGameFromDbAfterMutation(gameId, opts = {}) {
    const id = String(gameId || '').trim();
    if (!id) return null;

    if (!window.electronAPI?.getGameById) {
        console.warn('[GD][RefreshDB] getGameById is not available');
        return null;
    }

    let freshGame = null;

    try {
        freshGame = await _gdWithTimeout(
            window.electronAPI.getGameById(id),
            5000,
            `getGameById(refresh:${opts.reason || 'mutation'})`
        );
    } catch (err) {
        console.warn('[GD][RefreshDB] failed:', err?.message || err);
        return null;
    }

    if (!freshGame) {
        console.warn('[GD][RefreshDB] no fresh game returned for:', id);
        return null;
    }

    window.__baddelUpsertCanonicalGameRegistry?.(freshGame);

    const freshId = String(freshGame.id || id);
    const freshIds = new Set(
        [freshId, id, freshGame.installedId, freshGame.launcherGameId,
         freshGame.appId, freshGame.appName, freshGame.steamAppId, freshGame.steam_appid]
        .filter(v => v != null && String(v).trim() !== '')
        .map(String)
    );

    const patchArray = (arr, label) => {
        if (!Array.isArray(arr)) return 0;

        let changed = 0;

        for (let i = 0; i < arr.length; i++) {
            const g = arr[i];
            if (!g) continue;

            const matches =
                freshIds.has(String(g.id || '')) ||
                freshIds.has(String(g.installedId || '')) ||
                freshIds.has(String(g.launcherGameId || '')) ||
                freshIds.has(String(g.appId || '')) ||
                freshIds.has(String(g.appName || '')) ||
                freshIds.has(String(g.steamAppId || '')) ||
                freshIds.has(String(g.steam_appid || ''));

            if (!matches) continue;

            arr[i] = {
                ...g,
                ...freshGame,

                // خلي aliases متزامنة عشان الكروت اللي بتقرأ coverUrl/heroUrl/logoUrl ما تعرضش القديم
                coverUrl: freshGame.image || freshGame.coverUrl || freshGame.defaultImage || null,
                heroUrl:  freshGame.heroImage || freshGame.heroUrl || freshGame.defaultHero || null,
                logoUrl:  freshGame.logo || freshGame.logoUrl || freshGame.defaultLogo || null,
            };

            changed++;
        }

        if (changed) {
            console.log(`[GD][RefreshDB] patched ${changed} item(s) in ${label}`);
        }

        return changed;
    };

    patchArray(typeof allGamesData !== 'undefined' ? allGamesData : null, 'allGamesData');

    if (window.allGamesData && typeof allGamesData !== 'undefined' && window.allGamesData !== allGamesData) {
        patchArray(window.allGamesData, 'window.allGamesData');
    }

    const _gdBelongsInAllGames =
        typeof window._agIsUserLibraryGame === 'function'
            ? window._agIsUserLibraryGame(freshGame)
            : false;

    if (_gdBelongsInAllGames) {
        patchArray(window._allGamesCache, 'window._allGamesCache');
        patchArray(window._vs?.items, 'window._vs.items');
    } else {
        // Remove installed-only game from All Games caches so it can't linger there.
        const _removeById = (arr) => {
            if (!Array.isArray(arr)) return;
            for (let i = arr.length - 1; i >= 0; i--) {
                const g = arr[i];
                if (g && (freshIds.has(String(g.id || '')) || freshIds.has(String(g.appName || '')))) {
                    arr.splice(i, 1);
                }
            }
        };
        _removeById(window._allGamesCache);
        _removeById(window._vs?.items);
    }

    // حدّث اللعبة الحالية في صفحة التفاصيل
    if (_gdCurrentGame && String(_gdCurrentGame.id || '') === freshId) {
        _gdCurrentGame = {
            ..._gdCurrentGame,
            ...freshGame,
            coverUrl: freshGame.image || freshGame.coverUrl || freshGame.defaultImage || null,
            heroUrl:  freshGame.heroImage || freshGame.heroUrl || freshGame.defaultHero || null,
            logoUrl:  freshGame.logo || freshGame.logoUrl || freshGame.defaultLogo || null,
        };
    }

    // امسح كاش الكروت القديم عشان الصور القديمة تختفي فورًا
    if (window._vs?.cardCache instanceof Map) {
        window._vs.cardCache.clear();
    }

    if (window._vs?._coverQueued instanceof Set) {
        window._vs._coverQueued.clear();
    }

    // امسح localStorage artwork القديم عشان ما يغلبش DB
    const keys = [
        freshId,
        freshGame.id,
        freshGame.installedId,
        freshGame.launcherGameId,
        freshGame.appName,
        freshGame.name,
        freshGame.title,
    ].filter(Boolean).map(String);

    keys.forEach(key => {
        localStorage.removeItem('cover_' + key);
        localStorage.removeItem('hero_' + key);
        localStorage.removeItem('logo_' + key);
    });

    // أعد رسم صفحة التفاصيل لو إحنا لسه واقفين على نفس اللعبة
    if (opts.rerenderDetails !== false && _gdCurrentGame && String(_gdCurrentGame.id || '') === freshId) {
        try {
            _gdPopulateBasic(_gdCurrentGame);
            _gdSyncCreatorChrome();
        } catch (err) {
            console.warn('[GD][RefreshDB] details rerender failed:', err?.message || err);
        }
    }

    // أعد رسم الشاشات الخارجية
    if (typeof renderRecentlyPlayed === 'function') {
        try { renderRecentlyPlayed(); } catch (_) {}
    }

    if (typeof renderExploreCarousel === 'function') {
        try { renderExploreCarousel(); } catch (_) {}
    }

    if (typeof applyFilters === 'function') {
        try { applyFilters(); } catch (_) {}
    }

    console.log(`[GD][RefreshDB] done after ${opts.reason || 'mutation'} for "${freshGame.name || freshId}"`);

    return freshGame;
}

// Collects every in-memory game object that represents the same title as baseGame,
// across the installed DB, session snapshots, and synced ready-to-install stores.
// Used by gdCreatorSave to apply a creator patch once to all affected objects.
function _gdCollectCreatorOverrideTargets(baseGame, savedGame) {
    const targets = [];
    const push = (g) => {
        if (!g || typeof g !== 'object') return;
        if (targets.includes(g)) return;
        targets.push(g);
    };

    push(baseGame);
    push(_gdCurrentGame);
    push(savedGame);
    push(_gdCreatorSessionBaseGame);
    push(_gdCreatorSessionSavedGame);

    try {
        const matches = typeof window._agFindInstalledLocalMatches === 'function'
            ? window._agFindInstalledLocalMatches(baseGame)
            : [];
        (matches || []).forEach(push);
    } catch (err) {
        console.warn('[GD][Creator] collecting installed override targets failed:', err?.message || err);
    }

    // Build broad key set from all targets so we can match synced records
    const targetKeys = new Set();
    const looseTitles = new Set();

    const _addKeyToSet = (v) => {
        const raw = String(v || '').trim();
        if (!raw) return;
        targetKeys.add(raw.toLowerCase());
        targetKeys.add(raw.toLowerCase().replace(/[^a-z0-9]/g, ''));
    };

    const _collectGameKeys = (g) => {
        if (!g) return;
        [g.id, g.installedId, g.appName, g.appid, g.appId, g.steamAppId, g.steam_appid,
         g.namespace, g.catalogNamespace, g.catalogItemId, g.launcherGameId,
         g.epicAppName, g.productId].forEach(_addKeyToSet);
        if (g.allIds && typeof g.allIds === 'object') {
            Object.values(g.allIds).forEach(_addKeyToSet);
        }
        const steamId = g.allIds?.steam || g.steamAppId || g.steam_appid || g.appid || g.appId;
        if (steamId) {
            _addKeyToSet(steamId);
            _addKeyToSet(`steam-${steamId}`);
            _addKeyToSet(`steam_${steamId}`);
        }
        const epicId = g.allIds?.epic || g.epicAppName || g.appName || g.namespace || g.catalogItemId;
        if (epicId) {
            _addKeyToSet(epicId);
            _addKeyToSet(`epic-${epicId}`);
            _addKeyToSet(`epic_${epicId}`);
        }
        const title = String(g.title || g.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        if (title) looseTitles.add(title);
    };

    targets.forEach(_collectGameKeys);

    const _matchesKnownTarget = (g) => {
        if (!g) return false;
        const vals = [g.id, g.installedId, g.appName, g.appid, g.appId, g.steamAppId, g.steam_appid,
                       g.namespace, g.catalogNamespace, g.catalogItemId, g.launcherGameId,
                       g.epicAppName, g.productId];
        if (g.allIds && typeof g.allIds === 'object') vals.push(...Object.values(g.allIds));
        for (const v of vals) {
            const raw   = String(v || '').trim().toLowerCase();
            const loose = raw.replace(/[^a-z0-9]/g, '');
            if ((raw && targetKeys.has(raw)) || (loose && targetKeys.has(loose))) return true;
        }
        const title = String(g.title || g.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        return Boolean(title && looseTitles.has(title));
    };

    try {
        if (Array.isArray(window._suggAllGames)) window._suggAllGames.filter(_matchesKnownTarget).forEach(push);
        if (Array.isArray(window._suggPool))     window._suggPool.filter(_matchesKnownTarget).forEach(push);
        if (window._suggFeaturedGame && _matchesKnownTarget(window._suggFeaturedGame)) push(window._suggFeaturedGame);
    } catch (err) {
        console.warn('[GD][Creator] collecting synced override targets failed:', err?.message || err);
    }

    return targets;
}

// Called by Game Settings save to null out stale Creator artwork fields in the
// customGameDetails localStorage store, so _gdApplyCustomToGame stops preferring
// the old creator posterImage over the fresh settings game.image.
window._gdClearCustomDetailArtwork = function(gameOrId, types) {
    try {
        const keys = _gdCreatorCandidateKeys(gameOrId);
        if (!keys.length) return;
        const store = _gdCreatorStore();
        let changed = false;
        keys.forEach(key => {
            const entry = store[key];
            if (!entry) return;
            if (!types || types.includes('cover')) { entry.posterImage = null; entry.coverImage = null; }
            if (!types || types.includes('hero'))  { entry.heroImage   = null; }
            if (!types || types.includes('logo'))  { entry.logoImage   = null; }
            changed = true;
        });
        if (changed) _gdCreatorSaveStore(store);
    } catch (err) {
        console.warn('[GD] _gdClearCustomDetailArtwork failed:', err?.message);
    }
};

// Called by Game Settings save to update an already-open Game Detail page.
// Matches by stable game IDs (falling back to title), patches _gdCurrentGame in-place,
// updates session snapshots, and re-renders if the view is visible.
window._gdApplyExternalPatch = function(matchGame, patch) {
    if (!_gdCurrentGame) return;
    const freshIds = new Set(
        [matchGame.id, matchGame.installedId, matchGame.launcherGameId,
         matchGame.appId, matchGame.appName, matchGame.steamAppId, matchGame.steam_appid]
        .filter(v => v != null && String(v).trim()).map(String)
    );
    const candidateFields = [
        _gdCurrentGame.id, _gdCurrentGame.installedId, _gdCurrentGame.launcherGameId,
        _gdCurrentGame.appId, _gdCurrentGame.appName, _gdCurrentGame.steamAppId, _gdCurrentGame.steam_appid
    ];
    const idMatch = candidateFields.some(v => v != null && freshIds.has(String(v)));
    if (!idMatch) {
        const loose = v => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const mt = loose(matchGame.title || matchGame.name);
        const ct = loose(_gdCurrentGame.title || _gdCurrentGame.name);
        if (!mt || mt !== ct) return;
    }
    if (patch.cover) {
        _gdCurrentGame.cover        = patch.cover;
        _gdCurrentGame.image        = patch.cover;
        _gdCurrentGame.coverUrl     = patch.cover;
        _gdCurrentGame.defaultImage = patch.cover;
        _gdCurrentGame._agCoverPipelineDone   = true;
        _gdCurrentGame._agCoverInFlight       = false;
        _gdCurrentGame._agRemoteFallbackReady = true;
        _gdCurrentGame._agLocalRetryCount     = 999;
    }
    if (patch.hero) {
        _gdCurrentGame.hero        = patch.hero;
        _gdCurrentGame.heroImage   = patch.hero;
        _gdCurrentGame.heroUrl     = patch.hero;
        _gdCurrentGame.defaultHero = patch.hero;
    }
    if (patch.logo)        { _gdCurrentGame.logo = patch.logo; _gdCurrentGame.logoUrl = patch.logo; _gdCurrentGame.defaultLogo = patch.logo; }
    if (patch.logoCleared) { _gdCurrentGame.logo = null; _gdCurrentGame.logoUrl = null; _gdCurrentGame.defaultLogo = null; }
    if (patch.artworkSource) {
        _gdCurrentGame.artworkSource    = patch.artworkSource;
        _gdCurrentGame.artworkUpdatedAt = patch.artworkUpdatedAt || Date.now();
        _gdCurrentGame.customArtworkLocked = true;
    }
    _gdCurrentBaseGame = typeof _gdClonePlain === 'function' ? _gdClonePlain(_gdCurrentGame) : { ..._gdCurrentGame };
    if (typeof _gdClonePlain === 'function') {
        _gdCreatorSessionBaseGame  = _gdClonePlain(_gdCurrentGame);
        _gdCreatorSessionSavedGame = _gdClonePlain(_gdCurrentGame);
    }
    const view = document.getElementById('gameDetailsView');
    if (view && view.style.display !== 'none') {
        try { _gdPopulateBasic(_gdCurrentGame); } catch (_) {}
        try { _gdApplyResolvedArtworkToDom(_gdCurrentGame, _gdCurrentMeta); } catch (_) {}
    }
};

window.gdCreatorSave = async function() {
    // ── Re-entrancy guard ────────────────────────────────────────────────────
    if (_gdCreatorSaveInFlight) {
        console.debug('[GD][Creator] save ignored — already in-flight');
        return;
    }

    // ── Guard: nothing to save ───────────────────────────────────────────────
    if (!_gdCurrentGame || !_gdCreatorDraft) {
        console.debug('[GD][Creator] save ignored — no draft');
        if (typeof showToast === 'function') showToast('No changes to save.', 'info');
        return;
    }

    _gdCreatorSaveInFlight = true;
    console.debug('[GD][Creator] save start');

    try {
        // Flush any title text the user may have typed without triggering an input event
        _gdSyncTrailerInputsToDraft();
        const draft = _gdCreatorDraft;

        // ── Use stable base (never the draft-mutated _gdCurrentGame) ────────
        const baseGame = _gdCreatorSessionBaseGame || _gdCurrentGame;
        const existingCustomBeforeSave = _gdLoadCustomDetails(baseGame) || {};

        // ── previousCreatorSave = the Creator page that existed BEFORE this Save ──
        const previousCreatorSave = _gdHasSavedCreatorDetails(existingCustomBeforeSave)
            ? _gdStripCreatorHistory(existingCustomBeforeSave)
            : null;

        draft.originalName =
            existingCustomBeforeSave.originalName ||
            _gdCreatorOriginalDraft?.title ||
            baseGame.creatorOriginalName ||
            baseGame.originalName ||
            baseGame.defaultName ||
            baseGame.name ||
            baseGame.title ||
            '';

        draft.originalCover =
            existingCustomBeforeSave.originalCover ||
            baseGame.creatorOriginalCover ||
            baseGame.originalCover ||
            baseGame.defaultImage ||
            baseGame.image ||
            '';

        draft.originalHero =
            existingCustomBeforeSave.originalHero ||
            baseGame.creatorOriginalHero ||
            baseGame.originalHero ||
            baseGame.defaultHero ||
            baseGame.heroImage ||
            '';

        draft.originalLogo =
            existingCustomBeforeSave.originalLogo ||
            baseGame.creatorOriginalLogo ||
            baseGame.originalLogo ||
            baseGame.defaultLogo ||
            baseGame.logo ||
            '';

        if (previousCreatorSave) {
            draft.previousCreatorSave = previousCreatorSave;
            console.debug('[GD][Creator] attaching previousCreatorSave to draft');
        }

        // ── Persist to localStorage (customGameDetails) ──────────────────────
        const gameId = String(baseGame.installedId || baseGame.id || baseGame.appName || '');
        const creatorIdentity = {
            gameId: baseGame.id,
            id: baseGame.id,
            localGameId: baseGame.localGameId,
            installedId: baseGame.installedId,
            installedGameKey: baseGame.installedGameKey,
            command: baseGame.command,
            executablePath: baseGame.executablePath,
            platform: baseGame.platform,
            allIds: baseGame.allIds,
            steamAppId: baseGame.steamAppId || baseGame.steam_appid,
            appId: baseGame.appId || baseGame.appid,
            appName: baseGame.appName,
            launcherGameId: baseGame.launcherGameId,
            namespace: baseGame.namespace || baseGame.catalogNamespace,
            catalogItemId: baseGame.catalogItemId,
        };
        const _creatorRedactPath = (value) => String(value || '').replace(/([^\\/:]+[\\\/])*([^\\\/:]+)$/g, '.../$2');
        const _creatorSafeIdentity = (identity = {}) => ({
            ...identity,
            command: identity.command ? _creatorRedactPath(identity.command) : identity.command,
            executablePath: identity.executablePath ? _creatorRedactPath(identity.executablePath) : identity.executablePath,
        });
        const logoCleared = draft.logoMode === 'text';
        const newCover = draft.posterImage || null;
        const newHero  = draft.heroImage   || null;
        const newLogo  = !logoCleared ? (draft.logoImage || null) : null;
        const creatorArtworkUpdatedAt = Date.now();
        const creatorOperationId = `creator-${creatorArtworkUpdatedAt}-${Math.random().toString(36).slice(2, 8)}`;
        const _creatorOriginal = _gdCreatorOriginalDraft || {};
        const _creatorChanged = (next, prev) => String(next || '') !== String(prev || '');
        const _creatorDirtyTypes = {
            cover: _creatorChanged(newCover, _creatorOriginal.posterImage || baseGame.image || ''),
            hero:  _creatorChanged(newHero, _creatorOriginal.heroImage || baseGame.heroImage || ''),
            logo:  logoCleared || _creatorChanged(newLogo, _creatorOriginal.logoImage || baseGame.logo || ''),
        };
        let _gdCreatorDbResult = null;
        const _creatorRequestedTypes = Object.keys(_creatorDirtyTypes).filter(type => _creatorDirtyTypes[type] && (
            type !== 'logo' ? (type === 'cover' ? newCover : newHero) : (newLogo || logoCleared)
        ));
        const _creatorArtworkUpdates = {};
        if (_creatorDirtyTypes.cover && newCover) _creatorArtworkUpdates.cover = newCover;
        if (_creatorDirtyTypes.hero && newHero) _creatorArtworkUpdates.hero = newHero;
        if (_creatorDirtyTypes.logo) _creatorArtworkUpdates.logo = logoCleared ? null : newLogo;
        const _creatorHasArtworkUpdates = Object.keys(_creatorArtworkUpdates).length > 0;
        const _creatorExpectedRevisions = {};
        ['cover', 'hero', 'logo'].forEach(type => {
            const rev = baseGame?.artworkState?.[type]?.revision;
            if (Number.isFinite(Number(rev))) _creatorExpectedRevisions[type] = Number(rev);
        });
        const _creatorFailureMessage = (res) => {
            const code = res?.code || res?.error?.code;
            const message = String(res?.message || res?.error || '');
            if (code === 'IPC_INVALID_ARG' || message.includes('IPC_INVALID_ARG')) return "Could not resolve this game's installed record.";
            if (res?.message === 'Game not found' || res?.canonicalGameId === null) return 'Could not find the installed game record.';
            if (res?.persisted === false) return 'Artwork could not be written to disk.';
            const rejected = Object.entries(res?.perType || {}).filter(([, r]) => r?.applied === false);
            if (rejected.some(([, r]) => r?.reason === 'stale-revision')) return 'Artwork changed elsewhere. Reload and try again.';
            if (res?.status === 'partial' || rejected.length) return 'Some artwork could not be saved: ' + rejected.map(([type]) => type).join(', ');
            if (message) return message;
            return 'Artwork could not be saved.';
        };
        let canonicalSavedGame = null;

        if (_creatorHasArtworkUpdates && !window.electronAPI?.setGameArtwork) {
            const err = new Error('Artwork save service is unavailable.');
            console.warn('[ArtworkStateV2][CreatorSaveFailure]', {
                requestedIdentity: _creatorSafeIdentity(creatorIdentity),
                requestedTypes: _creatorRequestedTypes,
                status: 'error',
                code: 'SET_GAME_ARTWORK_UNAVAILABLE',
                message: err.message,
                canonicalGameId: null,
                persisted: false,
                perType: {},
            });
            if (typeof showToast === 'function') showToast(err.message, 'error');
            return;
        }

        if (_creatorHasArtworkUpdates && window.electronAPI?.setGameArtwork) {
            try {
                const res = await window.electronAPI.setGameArtwork(creatorIdentity, _creatorArtworkUpdates, {
                    source: 'creator',
                    updatedAt: creatorArtworkUpdatedAt,
                    operationId: creatorOperationId,
                    expectedRevisions: _creatorExpectedRevisions,
                });
                _gdCreatorDbResult = res;
                console.info('[ArtworkStateV2][CreatorSave]', {
                    requestedIdentity: _creatorSafeIdentity(creatorIdentity),
                    canonicalGameId: res?.canonicalGameId || null,
                    requestedTypes: _creatorRequestedTypes,
                    perType: res?.perType || {},
                });
                const rejected = Object.values(res?.perType || {}).filter(r => r?.applied === false);
                if (!_gdCreatorDbResult || !['success', 'partial'].includes(_gdCreatorDbResult.status) || _gdCreatorDbResult.persisted !== true || !_gdCreatorDbResult.updatedGame || rejected.length) {
                    const err = new Error(_creatorFailureMessage(_gdCreatorDbResult));
                    err.creatorSaveResult = _gdCreatorDbResult;
                    throw err;
                }
                canonicalSavedGame = res.updatedGame;
                window.__baddelUpsertCanonicalGameRegistry?.(canonicalSavedGame);
                const refreshId = res?.canonicalGameId || gameId;
                await _gdRefreshGameFromDbAfterMutation(refreshId, {
                    reason: 'creator-save',
                    rerenderDetails: true,
                });
                ['cover', 'hero', 'logo'].forEach(type => {
                    if (!_creatorArtworkUpdates || !(type in _creatorArtworkUpdates)) return;
                    if (type === 'cover') {
                        draft.posterImage = null;
                        draft.coverImage = null;
                    } else if (type === 'hero') {
                        draft.heroImage = null;
                    } else if (type === 'logo') {
                        draft.logoImage = null;
                    }
                });
            } catch (err) {
                const res = err?.creatorSaveResult || err;
                console.warn('[ArtworkStateV2][CreatorSaveFailure]', {
                    requestedIdentity: _creatorSafeIdentity(creatorIdentity),
                    requestedTypes: _creatorRequestedTypes,
                    status: res?.status || null,
                    code: res?.code || null,
                    message: res?.message || err?.message || String(err || ''),
                    canonicalGameId: res?.canonicalGameId || null,
                    persisted: res?.persisted ?? null,
                    perType: res?.perType || {},
                });
                if (typeof showToast === 'function') showToast(err?.message || 'Artwork could not be saved.', 'error');
                return;
            }
        }

        const committedBaseGame = canonicalSavedGame || baseGame;
        _gdPersistCustomDetails(committedBaseGame, draft);
        _gdCurrentCustomDetails = _gdLoadCustomDetails(committedBaseGame);

        // ── Build committed savedGame/savedMeta from baseGame + saved custom ─
        const savedCustom = _gdCurrentCustomDetails || draft;
        const savedGame   = _gdApplyCustomToGame(committedBaseGame, savedCustom);
        const savedMeta   = _gdBuildCustomMeta(savedGame, savedCustom);

        // ── Commit to module-level state (only here, once) ───────────────────
        _gdCurrentGame = savedGame;
        _gdCurrentMeta = savedMeta;

        // ── Update session snapshots so a second Save uses the right base ────
        _gdCreatorSessionBaseGame    = _gdClonePlain(savedGame);
        _gdCreatorSessionSavedCustom = _gdClonePlain(_gdCurrentCustomDetails);
        _gdCreatorSessionSavedGame   = _gdClonePlain(savedGame);

        const creatorKeys = new Set(_gdCreatorCandidateKeys(baseGame));
        const _creatorNorm  = (v) => String(v || '').trim().toLowerCase();
        const _creatorLoose = (v) => String(v || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');

        const _creatorAddKey = (set, v) => {
            const raw = _creatorNorm(v);
            if (raw) set.add(raw);
            const loose = _creatorLoose(v);
            if (loose) set.add(loose);
        };

        const _creatorCollectKeys = (g = {}) => {
            const keys = new Set();
            _creatorAddKey(keys, g.id);
            _creatorAddKey(keys, g.installedId);
            _creatorAddKey(keys, g.appName);
            _creatorAddKey(keys, g.appid);
            _creatorAddKey(keys, g.appId);
            _creatorAddKey(keys, g.steamAppId);
            _creatorAddKey(keys, g.steam_appid);
            _creatorAddKey(keys, g.namespace);
            _creatorAddKey(keys, g.catalogNamespace);
            _creatorAddKey(keys, g.catalogItemId);
            _creatorAddKey(keys, g.launcherGameId);
            if (g.allIds && typeof g.allIds === 'object') {
                Object.values(g.allIds).forEach(v => _creatorAddKey(keys, v));
            }
            const steamId = g.allIds?.steam || g.steamAppId || g.steam_appid || g.appid || g.appId || g.appName;
            if (steamId) {
                _creatorAddKey(keys, steamId);
                _creatorAddKey(keys, `steam-${steamId}`);
                _creatorAddKey(keys, `steam_${steamId}`);
            }
            const epicId = g.allIds?.epic || g.epicAppName || g.appName || g.namespace;
            if (epicId) {
                _creatorAddKey(keys, epicId);
                _creatorAddKey(keys, `epic-${epicId}`);
                _creatorAddKey(keys, `epic_${epicId}`);
            }
            if (g._steamInstallLibraryGame) _creatorCollectKeys(g._steamInstallLibraryGame).forEach(k => keys.add(k));
            if (g._epicInstallLibraryGame)  _creatorCollectKeys(g._epicInstallLibraryGame).forEach(k => keys.add(k));
            return keys;
        };

        _creatorAddKey(creatorKeys, gameId);
        const creatorTitleKey = _creatorLoose(baseGame.title || baseGame.name || draft.title);

        const _creatorMatches = (g = {}) => {
            const keys = _creatorCollectKeys(g);
            for (const key of keys) {
                if (creatorKeys.has(key)) return true;
            }
            const titleKey = _creatorLoose(g.title || g.name);
            return Boolean(creatorTitleKey && titleKey && titleKey === creatorTitleKey);
        };

        const _creatorPatchGame = (g) => {
            if (!g) return;
            if (!g.creatorOriginalName) {
                g.creatorOriginalName = draft.originalName || g.originalName || g.defaultName || g.name || g.title || '';
            }
            if (draft.title) {
                g.name = draft.title;
                g.title = draft.title;
                g.creatorCustomName = draft.title;
            }
            if (gameId && !g.installedId) g.installedId = gameId;
        };

        // ── Sync in-memory game record (Installed/Home/All Games) ────────────
        console.debug('[GD][Creator] updating external caches');
        const _updateArr = (arr) => {
            if (!Array.isArray(arr)) return 0;
            let changed = 0;
            arr.forEach(g => { if (!_creatorMatches(g)) return; _creatorPatchGame(g); changed++; });
            return changed;
        };

        let creatorChangedCount = 0;
        if (typeof allGamesData !== 'undefined') creatorChangedCount += _updateArr(allGamesData);
        if (window.allGamesData && typeof allGamesData !== 'undefined' && window.allGamesData !== allGamesData) creatorChangedCount += _updateArr(window.allGamesData);
        if (Array.isArray(window._allGamesCache)) creatorChangedCount += _updateArr(window._allGamesCache);
        if (Array.isArray(window._vs?.items))     creatorChangedCount += _updateArr(window._vs.items);

        // Propagate patch to all known targets: installed record, session snapshots, and matched synced games.
        // Using _gdCollectCreatorOverrideTargets ensures installed+synced hybrid games are both updated.
        // skipSyncedRender=true because renderSyncedSuggestions() is called explicitly in the render block below.
        const _gdCreatorPatch = {
            name: draft.title,
        };
        const _gdOverrideTargets = _gdCollectCreatorOverrideTargets(baseGame, savedGame);
        if (!_creatorHasArtworkUpdates && typeof window.__baddelApplyGameCustomOverride === 'function') {
            _gdOverrideTargets.forEach(target => {
                window.__baddelApplyGameCustomOverride(target, _gdCreatorPatch, { skipSyncedRender: true });
            });
        }
        if (canonicalSavedGame && typeof window.__baddelCommitCanonicalGameUpdate === 'function') {
            window.__baddelCommitCanonicalGameUpdate(canonicalSavedGame, {
                reason: 'creator-save',
                changedTypes: Object.keys(_creatorArtworkUpdates),
            });
        }

        // ── Invalidate virtual scroller card cache ────────────────────────────
        if (window._vs?.cardCache instanceof Map)  window._vs.cardCache.clear();
        if (window._vs?._coverQueued instanceof Set) window._vs._coverQueued.clear();

        // ── Update localStorage artwork keys ──────────────────────────────────
        if (_creatorHasArtworkUpdates) {
            creatorKeys.forEach(key => {
                localStorage.removeItem('cover_' + key);
                localStorage.removeItem('hero_' + key);
                localStorage.removeItem('logo_' + key);
            });
        }

        // ── Persist to gameScanner DB ─────────────────────────────────────────
        if (window.electronAPI?.saveMetadata && gameId) {
            const contentGameId = _gdCreatorDbResult?.canonicalGameId || baseGame.localGameId || baseGame.id || gameId;
            const ipcMeta = {};
            if (draft.title) ipcMeta.name = draft.title;
            try {
                if (Object.keys(ipcMeta).length === 0) throw new Error('NO_CONTENT_METADATA');
                const res = await window.electronAPI.saveMetadata(contentGameId, ipcMeta, { source: 'creator-content' });
                const refreshId = res?.canonicalGameId || gameId;
                await _gdRefreshGameFromDbAfterMutation(refreshId, {
                    reason: 'creator-content-save',
                    rerenderDetails: true,
                });
            } catch (err) {
                const msg = String(err?.message || err || '');
                if (msg === 'NO_CONTENT_METADATA') {
                    // Custom page details are already persisted in customGameDetails.
                } else if (msg.includes('Game not found') || err?.code === 'GAME_NOT_FOUND') {
                    // Synced-only games are not in the local DB — skip the DB refresh
                    console.log('[GD][Creator] content saveMetadata: game not in local DB, skipping DB refresh');
                } else {
                    console.warn('[GD][Creator] content saveMetadata IPC error:', err);
                }
            }
        }

        // ── Re-render outside views ───────────────────────────────────────────
        if (typeof renderRecentlyPlayed    === 'function') try { renderRecentlyPlayed();    } catch (_) {}
        if (typeof applyFilters            === 'function') try { applyFilters();            } catch (_) {}
        if (typeof applyHeroForHome        === 'function') try { applyHeroForHome();        } catch (_) {}
        if (typeof renderSyncedSuggestions === 'function') try { renderSyncedSuggestions(); } catch (_) {}
        // Always re-render the library and AG filter after a creator save.
        // The previous `creatorChangedCount > 0` guard caused hybrid installed+synced
        // games to silently skip the VS re-render when _creatorMatches missed the record.
        if (typeof _applyAgFilters    === 'function') try { _applyAgFilters({ resetScroll: false }); } catch (_) {}
        if (typeof window._vsRender   === 'function') try { window._vsRender(true); } catch (_) {}

        // ── Exit Creator Mode and redraw from committed saved state ───────────
        _gdSetCreatorModeState('normal', { clearDraft: true });
        _gdResetUI();
        _gdPopulateBasic(savedGame);
        _gdPopulateMeta(savedGame, savedMeta);
        _gdSetAchievementsTabVisibility(savedGame);
        _gdSetAccountsTabVisibility(savedGame);
        _gdStripCreatorEditAffordances();
        _gdSetCreatorModeState('normal', { clearDraft: true, log: false });

        console.debug('[GD][Creator] save complete');
        if (typeof showToast === 'function') showToast('Custom game page saved.', 'success');

    } finally {
        _gdCreatorSaveInFlight = false;
    }
};

window.gdCreatorCancel = function() {
    console.debug('[GD][Creator] cancel — discarding draft, restoring committed state');
    // Discard draft — do NOT apply it anywhere
    _gdCreatorDraft = null;
    _gdCreatorOriginalDraft = null;
    // Restore _gdCurrentGame / _gdCurrentMeta from committed session snapshot
    if (_gdCreatorSessionSavedGame) {
        _gdCurrentGame = _gdClonePlain(_gdCreatorSessionSavedGame);
    }
    if (_gdCreatorSessionSavedCustom && Object.keys(_gdCreatorSessionSavedCustom).length) {
        _gdCurrentCustomDetails = _gdClonePlain(_gdCreatorSessionSavedCustom);
        _gdCurrentMeta = _gdBuildCustomMeta(_gdCurrentGame, _gdCurrentCustomDetails);
    } else {
        _gdCurrentCustomDetails = null;
    }
    // Clear session snapshots
    _gdCreatorSessionBaseGame    = null;
    _gdCreatorSessionSavedCustom = null;
    _gdCreatorSessionSavedGame   = null;

    _gdSetCreatorModeState('normal', { clearDraft: false }); // draft already null
    // Re-render Game Details from committed saved state only — do NOT touch outside cards
    _gdResetUI();
    _gdPopulateBasic(_gdCurrentGame);
    _gdPopulateMeta(_gdCurrentGame, _gdCurrentMeta);
    _gdSetAchievementsTabVisibility(_gdCurrentGame);
    _gdSetAccountsTabVisibility(_gdCurrentGame);
    _gdStripCreatorEditAffordances();
};

function _gdCreatorConfirmModal({ title, message, confirmText = 'Confirm', danger = false }) {
    return new Promise((resolve) => {
        let modal = document.getElementById('gdCreatorConfirmModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'gdCreatorConfirmModal';
            modal.className = 'gd-creator-modal-backdrop gd-creator-modal-overlay';
            document.body.appendChild(modal);
        }
        modal.innerHTML = `<div class="gd-creator-modal gd-creator-modal-box" role="dialog" aria-modal="true">
            <div class="gd-creator-modal-header">
                <div>
                    <span class="gd-creator-modal-title gd-creator-modal-label">${_gdEscHtml(title)}</span>
                    <p class="gd-creator-modal-subtitle">${_gdEscHtml(message)}</p>
                </div>
            </div>
            <div class="gd-creator-modal-footer gd-creator-modal-actions">
                <button type="button" class="gd-creator-action gd-creator-secondary gd-creator-modal-btn" id="gdConfirmCancel">Cancel</button>
                <button type="button" class="gd-creator-action ${danger ? 'gd-creator-danger' : 'gd-creator-primary'} gd-creator-modal-btn ${danger ? 'danger' : 'primary'}" id="gdConfirmOk">${_gdEscHtml(confirmText)}</button>
            </div>
        </div>`;
        modal.style.display = 'flex';
        const finish = (ok) => { modal.style.display = 'none'; resolve(!!ok); };
        document.getElementById('gdConfirmCancel').onclick = () => finish(false);
        document.getElementById('gdConfirmOk').onclick = () => finish(true);
        modal.onclick = (ev) => { if (ev.target === modal) finish(false); };
    });
}

async function _gdFetchResetMetadataFromServer(resetGame, customBeforeReset = {}) {
    const cleanName =
        customBeforeReset.originalName ||
        resetGame.creatorOriginalName ||
        resetGame.originalName ||
        resetGame.defaultName ||
        resetGame.steamTitle ||
        resetGame.epicTitle ||
        resetGame.name ||
        resetGame.title ||
        '';

    const serverGame = {
        ...resetGame,
        name: cleanName,
        title: cleanName,
    };

    let meta = null;

    // 1) Best path: Steam/Epic canonical server lookup by platform + id
    try {
        const target = typeof _gdResolveServerTarget === 'function'
            ? _gdResolveServerTarget(serverGame)
            : null;

        if (target?.platform && target?.id && window.electronAPI?.lookupGameServer) {
            meta = await window.electronAPI.lookupGameServer({
                platform: target.platform,
                id: target.id,
            });

            if (meta && !(_gdIsMetadataTooIncomplete?.(meta))) {
                return { meta, cleanName, source: 'server-id' };
            }
        }
    } catch (err) {
        console.warn('[GD][CreatorReset] server id lookup failed:', err?.message || err);
    }

    // 2) Generic server lookup by clean/original title
    try {
        if (cleanName && window.electronAPI?.lookupGameServer) {
            meta = await window.electronAPI.lookupGameServer({ title: cleanName });

            if (meta && !(_gdIsMetadataTooIncomplete?.(meta))) {
                return { meta, cleanName, source: 'server-title' };
            }
        }
    } catch (err) {
        console.warn('[GD][CreatorReset] server title lookup failed:', err?.message || err);
    }

    // 3) Full metadata resolver fallback
    // ده لسه قبل local saved fallback، عشان لو السيرفر/metadata resolver يقدر يجيب داتا حقيقية.
    try {
        if (cleanName && window.electronAPI?.getMetadata) {
            meta = await window.electronAPI.getMetadata(cleanName, {
                id: resetGame.installedId || resetGame.id,
                platform: resetGame.platform,
                platforms: resetGame.platforms,
                command: resetGame.command,
                path: resetGame.path,
                allIds: resetGame.allIds,
                existingCover: null,
                existingHero: null,
                existingLogo: null,
            });

            if (meta && !(_gdIsMetadataTooIncomplete?.(meta))) {
                return { meta, cleanName, source: 'metadata-resolver' };
            }
        }
    } catch (err) {
        console.warn('[GD][CreatorReset] getMetadata fallback failed:', err?.message || err);
    }

    // 4) Last resort: last known original saved before Creator edits
    const fallbackMeta = {
        title: cleanName || resetGame.name || resetGame.title,
        cover:
            customBeforeReset.originalCover ||
            resetGame.creatorOriginalCover ||
            resetGame.originalCover ||
            resetGame.defaultImage ||
            null,
        heroImage:
            customBeforeReset.originalHero ||
            resetGame.creatorOriginalHero ||
            resetGame.originalHero ||
            resetGame.defaultHero ||
            null,
        hero:
            customBeforeReset.originalHero ||
            resetGame.creatorOriginalHero ||
            resetGame.originalHero ||
            resetGame.defaultHero ||
            null,
        logo:
            customBeforeReset.originalLogo ||
            resetGame.creatorOriginalLogo ||
            resetGame.originalLogo ||
            resetGame.defaultLogo ||
            null,
        _resetFallback: true,
    };

    return await _gdBuildLocalOriginalResetSource(
        resetGame,
        customBeforeReset,
        resetGame.installedId || resetGame.id
    );
}

async function _gdCacheResetAssets(meta, gameId) {
    if (!meta || !gameId || !window.electronAPI?.cacheAllAssets) {
        return {
            cover: meta?.cover || null,
            hero: meta?.heroImage || meta?.hero || null,
            logo: meta?.logo || null,
        };
    }

    try {
        const assets = await window.electronAPI.cacheAllAssets({
            cover: meta.cover || null,
            hero: meta.heroImage || meta.hero || null,
            logo: meta.logo || null,
        }, gameId);

        return {
            cover: assets?.cover || meta.cover || null,
            hero: assets?.hero || meta.heroImage || meta.hero || null,
            logo: assets?.logo || meta.logo || null,
        };
    } catch (err) {
        console.warn('[GD][CreatorReset] cache reset assets failed:', err?.message || err);

        return {
            cover: meta.cover || null,
            hero: meta.heroImage || meta.hero || null,
            logo: meta.logo || null,
        };
    }
}


let _gdCreatorResetInFlight = false;

function _gdSetCreatorResetBusy(isBusy, label = 'Resetting…') {
    const buttons = [...document.querySelectorAll('button')]
        .filter(btn => String(btn.getAttribute('onclick') || '').includes('gdCreatorReset'));

    buttons.forEach(btn => {
        if (isBusy) {
            if (!btn.dataset.gdOriginalText) {
                btn.dataset.gdOriginalText = btn.textContent || 'Reset';
            }
            btn.disabled = true;
            btn.classList.add('is-loading');
            btn.textContent = label;
        } else {
            btn.disabled = false;
            btn.classList.remove('is-loading');
            btn.textContent = btn.dataset.gdOriginalText || 'Reset';
            delete btn.dataset.gdOriginalText;
        }
    });
}

async function _gdBuildLocalOriginalResetSource(resetGame, customBeforeReset = {}, dbGameId = null) {
    const localId = dbGameId || resetGame.installedId || resetGame.id;

    // 1) Best local saved source: persisted full metadata cache
    if (localId && window.electronAPI?.loadFullMetadata) {
        try {
            const cachedMeta = await window.electronAPI.loadFullMetadata(localId);

            if (cachedMeta && !(_gdIsMetadataTooIncomplete?.(cachedMeta))) {
                const cleanName =
                    cachedMeta.title ||
                    cachedMeta.name ||
                    customBeforeReset.originalName ||
                    resetGame.creatorOriginalName ||
                    resetGame.originalName ||
                    resetGame.defaultName ||
                    resetGame.name ||
                    resetGame.title ||
                    '';

                return {
                    meta: {
                        ...cachedMeta,
                        title: cleanName || cachedMeta.title || resetGame.name || resetGame.title,
                    },
                    cleanName,
                    source: 'local-saved-metadata',
                };
            }
        } catch (err) {
            console.warn('[GD][CreatorReset] loadFullMetadata failed:', err?.message || err);
        }
    }

    // 2) Fallback: original values captured before Creator edits
    const cleanName =
        customBeforeReset.originalName ||
        resetGame.creatorOriginalName ||
        resetGame.originalName ||
        resetGame.defaultName ||
        resetGame.steamTitle ||
        resetGame.epicTitle ||
        resetGame.name ||
        resetGame.title ||
        '';

    const fallbackMeta = {
        title: cleanName || resetGame.name || resetGame.title,
        cover:
            customBeforeReset.originalCover ||
            resetGame.creatorOriginalCover ||
            resetGame.originalCover ||
            resetGame.defaultImage ||
            resetGame.image ||
            null,
        heroImage:
            customBeforeReset.originalHero ||
            resetGame.creatorOriginalHero ||
            resetGame.originalHero ||
            resetGame.defaultHero ||
            resetGame.heroImage ||
            null,
        hero:
            customBeforeReset.originalHero ||
            resetGame.creatorOriginalHero ||
            resetGame.originalHero ||
            resetGame.defaultHero ||
            resetGame.heroImage ||
            null,
        logo:
            customBeforeReset.originalLogo ||
            resetGame.creatorOriginalLogo ||
            resetGame.originalLogo ||
            resetGame.defaultLogo ||
            resetGame.logo ||
            null,
        _resetFallback: true,
    };

    return { meta: fallbackMeta, cleanName, source: 'local-original' };
}

function _gdEnsureResetChoiceStyles() {
    if (document.getElementById('gdResetChoiceStyles')) return;

    const style = document.createElement('style');
    style.id = 'gdResetChoiceStyles';
    style.textContent = `
        #gdCreatorResetChoiceModal {
            position: fixed;
            inset: 0;
            z-index: 99999;
            display: none;
            align-items: center;
            justify-content: center;
            background: rgba(0, 0, 0, 0.62);
            backdrop-filter: blur(10px);
        }

        .gd-reset-choice-box {
            width: min(620px, calc(100vw - 32px));
            border-radius: 24px;
            border: 1px solid rgba(255,255,255,0.12);
            background:
                radial-gradient(circle at top left, rgba(255,255,255,0.08), transparent 35%),
                rgba(16, 16, 22, 0.96);
            box-shadow: 0 28px 80px rgba(0,0,0,0.55);
            padding: 22px;
            color: #fff;
        }

        .gd-reset-choice-top {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 16px;
            margin-bottom: 18px;
        }

        .gd-reset-choice-title {
            font-size: 18px;
            font-weight: 800;
            letter-spacing: -0.02em;
            margin: 0 0 6px;
        }

        .gd-reset-choice-subtitle {
            font-size: 13px;
            color: rgba(255,255,255,0.62);
            margin: 0;
            line-height: 1.45;
        }

        .gd-reset-close {
            width: 34px;
            height: 34px;
            border-radius: 12px;
            border: 1px solid rgba(255,255,255,0.10);
            background: rgba(255,255,255,0.06);
            color: rgba(255,255,255,0.75);
            cursor: pointer;
            font-size: 18px;
        }

        .gd-reset-choice-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
        }

        .gd-reset-option {
            text-align: left;
            min-height: 118px;
            border-radius: 18px;
            border: 1px solid rgba(255,255,255,0.10);
            background: rgba(255,255,255,0.055);
            color: #fff;
            padding: 16px;
            cursor: pointer;
            transition: transform .16s ease, border-color .16s ease, background .16s ease;
        }

        .gd-reset-option:hover {
            transform: translateY(-2px);
            border-color: rgba(255,255,255,0.24);
            background: rgba(255,255,255,0.09);
        }

        .gd-reset-option.primary {
            background: rgba(255,255,255,0.92);
            color: #101016;
            border-color: rgba(255,255,255,0.7);
        }

        .gd-reset-option.primary:hover {
            background: #fff;
        }

        .gd-reset-option-title {
            display: block;
            font-size: 15px;
            font-weight: 800;
            margin-bottom: 8px;
        }

        .gd-reset-option-desc {
            display: block;
            font-size: 12.5px;
            line-height: 1.45;
            opacity: .72;
        }

        @media (max-width: 560px) {
            .gd-reset-choice-grid {
                grid-template-columns: 1fr;
            }
        }
    `;
    document.head.appendChild(style);
}

function _gdCreatorResetChoiceModal() {
    return new Promise((resolve) => {
        _gdEnsureResetChoiceStyles();

        let modal = document.getElementById('gdCreatorResetChoiceModal');

        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'gdCreatorResetChoiceModal';
            document.body.appendChild(modal);
        }

        modal.innerHTML = `
            <div class="gd-reset-choice-box" role="dialog" aria-modal="true">
                <div class="gd-reset-choice-top">
                    <div>
                        <h3 class="gd-reset-choice-title">Reset custom page</h3>
                        <p class="gd-reset-choice-subtitle">
                            Choose how you want to restore this game.
                        </p>
                    </div>

                    <button type="button" class="gd-reset-close" id="gdResetCancel" aria-label="Close">
                        ×
                    </button>
                </div>

                <div class="gd-reset-choice-grid">
                    <button type="button" class="gd-reset-option" id="gdResetLocal">
                        <span class="gd-reset-option-title">Last saved page</span>
                        <span class="gd-reset-option-desc">
                            Restore the Creator page that existed before your latest Save.
                        </span>
                    </button>

                    <button type="button" class="gd-reset-option primary" id="gdResetLauncher">
                        <span class="gd-reset-option-title">From launcher data</span>
                        <span class="gd-reset-option-desc">
                            Fetch fresh official data again. This may take a few seconds.
                        </span>
                    </button>
                </div>
            </div>
        `;

        modal.style.display = 'flex';

        const finish = (choice) => {
            modal.style.display = 'none';
            resolve(choice);
        };

        document.getElementById('gdResetCancel').onclick = () => finish(null);
        document.getElementById('gdResetLocal').onclick = () => finish('local');
        document.getElementById('gdResetLauncher').onclick = () => finish('launcher');

        modal.onclick = (ev) => {
            if (ev.target === modal) finish(null);
        };
    });
}
function _gdHasSavedCreatorDetails(custom = {}) {
    return !!(
        custom &&
        typeof custom === 'object' &&
        (
            custom.title ||
            custom.posterImage ||
            custom.coverImage ||
            custom.heroImage ||
            custom.logoImage ||
            custom.logoMode ||
            custom.shortDescription ||
            custom.description ||
            custom.developer ||
            custom.publisher ||
            custom.releaseDate ||
            custom.genres?.length ||
            custom.platforms?.length ||
            custom.screenshots?.length ||
            custom.trailers?.length
        )
    );
}

function _gdBuildCreatorLastSavedResetSource(resetGame, customBeforeReset = {}) {
    const customGame = _gdApplyCustomToGame({ ...resetGame }, customBeforeReset);
    const meta = _gdBuildCustomMeta(customGame, customBeforeReset);

    return {
        meta,
        cleanName: customBeforeReset.title || meta.title || resetGame.name || resetGame.title || '',
        source: 'creator-last-saved',
    };
}

window.gdCreatorReset = async function() {
    if (!_gdCurrentGame) return;

    if (_gdCreatorResetInFlight) return;

    const resetChoice = await _gdCreatorResetChoiceModal();
    if (!resetChoice) return;

    _gdCreatorResetInFlight = true;
    _gdSetCreatorResetBusy(
        true,
        resetChoice === 'launcher' ? 'Fetching launcher data…' : 'Resetting…'
    );

    try {
        // باقي كود reset كله هنا

    const resetGame = { ..._gdCurrentGame };
    const customBeforeReset = _gdLoadCustomDetails(resetGame) || {};

    const reopenId = resetGame.id || _gdCurrentGameId;
    const dbGameId = resetGame.installedId || resetGame.id;

const previousCreatorSave = _gdGetPreviousCreatorSave(customBeforeReset);
const hasCreatorLastSaved = resetChoice === 'local' ? !!previousCreatorSave : _gdHasSavedCreatorDetails(customBeforeReset);

if (resetChoice === 'local' && !previousCreatorSave) {
    if (typeof showToast === 'function') {
        showToast('No previous saved Creator page found.', 'info');
    }
    // Must return inside finally path — throw a sentinel to skip the rest
    _gdCreatorResetInFlight = false;
    _gdSetCreatorResetBusy(false);
    return;
}

const resetSource = resetChoice === 'launcher'
    ? await _gdFetchResetMetadataFromServer(resetGame, customBeforeReset)
    : _gdBuildCreatorLastSavedResetSource(resetGame, previousCreatorSave);

const resetMeta = resetSource.meta || {};
const resetOriginalName =
    resetSource.cleanName ||
    resetMeta.title ||
    resetMeta.name ||
    resetGame.creatorOriginalName ||
    resetGame.originalName ||
    resetGame.defaultName ||
    resetGame.name ||
    resetGame.title ||
    null;

const resetAssets = await _gdCacheResetAssets(resetMeta, dbGameId);

const resetOriginalCover = resetAssets.cover || null;
const resetOriginalHero  = resetAssets.hero || null;
const resetOriginalLogo  = resetAssets.logo || null;

    const resetKeys = new Set(
        typeof _gdCreatorCandidateKeys === 'function'
            ? _gdCreatorCandidateKeys(resetGame)
            : [
                resetGame.installedId,
                resetGame.id,
                resetGame.appName,
                resetGame.appid,
                resetGame.appId,
                resetGame.steamAppId,
                resetGame.namespace,
                _gdCurrentGameId,
            ].filter(Boolean).map(String)
    );

    if (resetGame.installedId) resetKeys.add(String(resetGame.installedId));
    if (resetGame.id) resetKeys.add(String(resetGame.id));
    if (_gdCurrentGameId) resetKeys.add(String(_gdCurrentGameId));

    // 1) Remove Creator page data from all known keys
    if (resetChoice === 'launcher') {
    // From launcher data = امسح Creator edits فعلاً
    _gdRemoveCustomDetails(resetGame);

    resetKeys.forEach(key => {
        try {
            localStorage.removeItem('cover_' + key);
            localStorage.removeItem('hero_' + key);
            localStorage.removeItem('logo_' + key);
        } catch (_) {}
    });
} else if (hasCreatorLastSaved) {
    // Last saved page = restore the Creator page that existed before the latest Save
    _gdPersistCustomDetails(resetGame, previousCreatorSave);

    resetKeys.forEach(key => {
        try {
            const cover = previousCreatorSave.posterImage || previousCreatorSave.coverImage || null;
            const hero  = previousCreatorSave.heroImage || null;

            if (cover) localStorage.setItem('cover_' + key, cover);
            else localStorage.removeItem('cover_' + key);

            if (hero) localStorage.setItem('hero_' + key, hero);
            else localStorage.removeItem('hero_' + key);

            if (previousCreatorSave.logoMode === 'text') {
                localStorage.removeItem('logo_' + key);
            } else if (previousCreatorSave.logoImage) {
                localStorage.setItem('logo_' + key, previousCreatorSave.logoImage);
            } else {
                localStorage.removeItem('logo_' + key);
            }
        } catch (_) {}
    });
}

    const _resetMatches = (g = {}) => {
        const keys = new Set(
            typeof _gdCreatorCandidateKeys === 'function'
                ? _gdCreatorCandidateKeys(g)
                : [
                    g.installedId,
                    g.id,
                    g.appName,
                    g.appid,
                    g.appId,
                    g.steamAppId,
                    g.namespace,
                    g.catalogItemId,
                    g.launcherGameId,
                ].filter(Boolean).map(String)
        );

        for (const key of keys) {
            if (resetKeys.has(String(key))) return true;
        }

        return false;
    };

    const _resetCardGame = (g) => {
        if (!g) return;

        // clear Creator artwork from in-memory card objects
        if (resetOriginalCover) {
    g.image = resetOriginalCover;
    g.coverUrl = resetOriginalCover;
    g.defaultImage = resetOriginalCover;
} else {
    g.image = g.defaultImage || null;
    g.coverUrl = g.defaultImage || null;
}

if (resetOriginalHero) {
    g.heroImage = resetOriginalHero;
    g.heroUrl = resetOriginalHero;
    g.defaultHero = resetOriginalHero;
} else {
    g.heroImage = g.defaultHero || null;
    g.heroUrl = g.defaultHero || null;
}

if (resetOriginalLogo) {
    g.logo = resetOriginalLogo;
    g.logoUrl = resetOriginalLogo;
    g.defaultLogo = resetOriginalLogo;
} else {
    g.logo = g.defaultLogo || null;
    g.logoUrl = g.defaultLogo || null;
}

        if (resetOriginalName) {
    g.name = resetOriginalName;
    g.title = resetOriginalName;
}

if (resetChoice === 'local' && hasCreatorLastSaved) {
    g.customArtworkLocked = true;
    g.artworkSource = 'creator';
    g.artworkUpdatedAt = Date.now();

g.creatorCustomName = resetOriginalName || previousCreatorSave.title || null;
    // امنع All Games pipeline إنه يبدل صورة الـ Creator تاني
    g._agCoverPipelineDone = true;
    g._agCoverInFlight = false;
    g._agRemoteFallbackReady = true;
    g._agLocalRetryCount = 999;
} else {
    g.customArtworkLocked = false;
    g.artworkSource = null;
    g.artworkUpdatedAt = null;

    delete g.creatorCustomName;
    delete g.creatorOriginalName;
    delete g.creatorOriginalCover;
    delete g.creatorOriginalHero;
    delete g.creatorOriginalLogo;

    // خليه يقدر يجيب launcher/server art
    g._agCoverPipelineDone = false;
    g._agCoverInFlight = false;
    g._agRemoteFallbackReady = false;
    g._agLocalRetryCount = 0;
}

        delete g._agHeroLogoDone;
    };

    const _resetArr = (arr) => {
        if (!Array.isArray(arr)) return 0;
        let changed = 0;

        arr.forEach(g => {
            if (!_resetMatches(g)) return;
            _resetCardGame(g);
            changed++;
        });

        return changed;
    };

    let resetChangedCount = 0;

    if (typeof allGamesData !== 'undefined') {
        resetChangedCount += _resetArr(allGamesData);
    }

    if (window.allGamesData && typeof allGamesData !== 'undefined' && window.allGamesData !== allGamesData) {
        resetChangedCount += _resetArr(window.allGamesData);
    }

    if (Array.isArray(window._allGamesCache)) {
        resetChangedCount += _resetArr(window._allGamesCache);
    }

    if (Array.isArray(window._vs?.items)) {
        resetChangedCount += _resetArr(window._vs.items);
    }

    // 3) Clear card cache so old DOM images disappear
    if (window._vs?.cardCache instanceof Map) {
        window._vs.cardCache.clear();
    }

    if (window._vs?._coverQueued instanceof Set) {
        window._vs._coverQueued.clear();
    }

    // 4) Reset DB artwork lock + clear Creator artwork from installed DB record

if (window.electronAPI?.saveMetadata && dbGameId) {
    try {
        const isCreatorLastSavedReset = resetChoice === 'local' && hasCreatorLastSaved;

        const resetMetaPayload = {
            cover: resetOriginalCover || null,
            hero: resetOriginalHero || null,
            logo: resetOriginalLogo || null,
            name: resetOriginalName || resetGame.name,

            customArtworkLocked: isCreatorLastSavedReset,
            artworkSource: isCreatorLastSavedReset ? 'creator' : 'reset',
            artworkUpdatedAt: Date.now(),

            clearCreatorOriginals: !isCreatorLastSavedReset,
        };

        await window.electronAPI.saveMetadata(
            dbGameId,
            resetMetaPayload,
            {
                source: isCreatorLastSavedReset ? 'creator' : 'reset',
                force: true,
            }
        );

        await _gdRefreshGameFromDbAfterMutation(dbGameId, {
            reason: isCreatorLastSavedReset ? 'creator-reset-local' : 'creator-reset-launcher',
            rerenderDetails: true,
        });
    } catch (err) {
        console.warn('[GD][Creator] reset saveMetadata IPC error:', err);
    }
}

    _gdCurrentCustomDetails = null;
if (
    !['local-original', 'local-saved-metadata', 'creator-last-saved'].includes(resetSource.source) &&
    resetMeta &&
    window.electronAPI?.saveFullMetadata &&
    dbGameId
) {
    try {
        await window.electronAPI.saveFullMetadata(
            dbGameId,
            resetOriginalName,
            resetGame.platform,
            resetMeta
        );
    } catch (err) {
        console.warn('[GD][CreatorReset] saveFullMetadata failed:', err?.message || err);
    }
}
    _gdCreatorDraft = null;
    _gdCreatorOriginalDraft = null;
    _gdSetCreatorModeState('normal', { clearDraft: true });

    // 5) Re-render outside views
    if (typeof renderRecentlyPlayed === 'function') {
        try { renderRecentlyPlayed(); } catch (_) {}
    }

    if (typeof renderExploreCarousel === 'function') {
        try { renderExploreCarousel(); } catch (_) {}
    }

    if (typeof applyFilters === 'function') {
        try { applyFilters(); } catch (_) {}
    }

    if (typeof applyHeroForHome === 'function') {
        try { applyHeroForHome(); } catch (_) {}
    }

    if (typeof renderSyncedSuggestions === 'function') {
        try { renderSyncedSuggestions(); } catch (_) {}
    }

    if (typeof _applyAgFilters === 'function') {
        try { _applyAgFilters({ resetScroll: false }); } catch (_) {}
    }

    if (typeof window._vsRender === 'function') {
        try { window._vsRender(true); } catch (_) {}
    }

    if (typeof showToast === 'function') {
        showToast(
            resetChoice === 'local'
                ? 'Custom page reset from last saved data.'
                : 'Custom page reset from launcher data.',
            'success'
        );
    }

      window.openGameDetails(reopenId);

    } finally {
        _gdCreatorResetInFlight = false;
        _gdSetCreatorResetBusy(false);
    }
};

window.gdCreatorTogglePreview = function() {
    if (!_gdCreatorModeActive) return;
    _gdSetCreatorModeState(_gdCreatorPreview ? 'edit' : 'preview', { clearDraft: false });
    if (_gdIsCreatorEditing()) _gdCreatorApplyDraftToPage();
};

window.gdCreatorAddMedia = async function(field) {
    const isTrailer = field === 'trailers';
    if (isTrailer) {
        await _gdCreatorAddTrailerOnce();
        return;
    }
    const value = await _gdCreatorMediaPickerModal({
        mode: isTrailer ? 'trailer' : 'image',
        label: isTrailer ? 'Add trailer' : 'Add screenshot',
    });
    if (!value) return;
    const current = _gdUniqList(_gdCreatorDraft?.[field] || []);
    current.push(value);
    _gdCreatorSetDraft(field, current);
    _gdCreatorApplyDraftToPage();
};

window.gdCreatorRemoveMedia = function(field, index) {
    const current = field === 'trailers'
        ? _gdNormalizeTrailerList(_gdCreatorDraft?.trailers || [])
        : _gdUniqList(_gdCreatorDraft?.[field] || []);
    current.splice(index, 1);
    _gdCreatorSetDraft(field, current);
    _gdCreatorApplyDraftToPage();
};

window.gdCreatorMoveMedia = function(field, index, dir) {
    const current = field === 'trailers'
        ? _gdNormalizeTrailerList(_gdCreatorDraft?.trailers || [])
        : _gdUniqList(_gdCreatorDraft?.[field] || []);
    const next = index + dir;
    if (next < 0 || next >= current.length) return;
    [current[index], current[next]] = [current[next], current[index]];
    _gdCreatorSetDraft(field, current);
    _gdCreatorApplyDraftToPage();
};

window.gdCreatorEditTrailer = async function(index) {
    const list = _gdNormalizeTrailerList(_gdCreatorDraft?.trailers || []);
    const existing = list[index] || { url: '', title: '', thumbnail: '' };
    const value = await _gdCreatorMediaPickerModal({
        mode: 'trailer',
        label: 'Edit trailer URL',
        current: existing.url,
    });
    if (value == null) return;
    const newObj = _gdNormalizeCreatorTrailer(value);
    if (!newObj) return;
    list[index] = { ...newObj, title: existing.title, thumbnail: existing.thumbnail };
    _gdCreatorSetDraft('trailers', list);
    _gdCreatorApplyDraftToPage();
};


// ──────────────────────────────────────────
//  REQUIREMENTS & PARSER
// ──────────────────────────────────────────
function _parseRawgReqString(str) {
    if (!str) return {};

    // تحويل الـ <br> لسطر جديد عشان الـ Regex يشتغل صح
    const cleanStr = str.replace(/<br\s*\/?>/gi, '\n')
                        .replace(/<\/li>/gi, '\n')
                        .replace(/<[^>]*>?/gm, '')
                        .replace(/&nbsp;/g, ' ');

    const extract = (regex) => {
        const match = cleanStr.match(regex);
        return match ? match[1].trim() : null;
    };

    return {
        os: extract(/(?:OS|Operating System)\s*:?\s*([^\n]+)/i),
        cpu: extract(/(?:Processor|CPU)\s*:?\s*([^\n]+)/i),
        ram: extract(/(?:Memory|RAM)\s*:?\s*([^\n]+)/i),
        gpu: extract(/(?:Graphics|Video Card|GPU)\s*:?\s*([^\n]+)/i),
        storage: extract(/(?:Storage|Hard Drive|Network)\s*:?\s*([^\n]+)/i),
        directx: extract(/(?:DirectX|DX)\s*:?\s*([^\n]+)/i)
    };
}

function _gdPopulateRequirements(info) {
    const req = info?.requirements || {};

    let min = {}, rec = {};

    if (req.minimum || req.recommended) {
        // الشكل القديم (RAWG)
        min = typeof req.minimum === 'string' ? _parseRawgReqString(req.minimum) : (req.minimum || {});
        rec = typeof req.recommended === 'string' ? _parseRawgReqString(req.recommended) : (req.recommended || {});
    } else {
        // الشكل الجديد من Baddel server
        
        // 🛠️ التعديل هنا: إعطاء الأولوية المطلقة للـ win ثم Windows أو PC
        let platformKey = null;
        if (req['win'] && (req['win'].minimum || req['win'].recommended)) {
            platformKey = 'win'; // ده اللي جاي من السيرفر الموحد
        } else if (req['Windows'] && (req['Windows'].minimum || req['Windows'].recommended)) {
            platformKey = 'Windows'; // للبيانات القديمة
        } else if (req['PC'] && (req['PC'].minimum || req['PC'].recommended)) {
            platformKey = 'PC';
        } else {
            // لو مفيش ويندوز خالص، هات أول منصة متاحة (زي macos)
            platformKey = Object.keys(req).find(k => req[k]?.minimum || req[k]?.recommended);
        }

        if (platformKey) {
            min = req[platformKey].minimum || {};
            rec = req[platformKey].recommended || {};
        }
    }

    // hide the entire row when a value is missing — don't show a dash placeholder
    const fill = (id, val) => {
        const el = document.getElementById(id);
        if (!el) return;
        const row = el.closest('.gd-req-row');
        if (val && val !== '—') {
            el.textContent = val;
            if (row) row.style.display = '';
        } else {
            el.textContent = '';
            if (row) row.style.display = 'none';
        }
    };

    fill('gdReqMinOS',      min.os      || min.OS);
    fill('gdReqMinCPU',     min.cpu     || min.Processor);
    fill('gdReqMinRAM',     min.ram     || min.Memory);
    fill('gdReqMinGPU',     min.gpu     || min.Graphics);
    fill('gdReqMinStorage', min.storage || min.Storage);
    fill('gdReqMinDX',      min.directx || min.DirectX);

    fill('gdReqRecOS',      rec.os      || rec.OS);
    fill('gdReqRecCPU',     rec.cpu     || rec.Processor);
    fill('gdReqRecRAM',     rec.ram     || rec.Memory);
    fill('gdReqRecGPU',     rec.gpu     || rec.Graphics);
    fill('gdReqRecStorage', rec.storage || rec.Storage);
    fill('gdReqRecDX',      rec.directx || rec.DirectX);
}

function _gdNormTitle(s) {
    return (s || '').toLowerCase().replace(/[®©™]/g, '').replace(/[:\-'']/g, ' ').replace(/\s+/g, ' ').trim();
}

// ──────────────────────────────────────────
//  ACCOUNTS TAB (Smart Sync Filter & Ownership)
// ──────────────────────────────────────────
async function _gdPopulateAccounts(game) {
    const container = document.getElementById('gdAccountsList');
    const rows = [];
    const detectedPlatforms = _gdDetectPlatforms(game);
    const platformKeys = ['steam', 'epic'].filter(k => detectedPlatforms.includes(k));

    if (platformKeys.length === 0) {
        container.innerHTML = '<div class="gd-no-accounts">Accounts comparison is available for Steam and Epic games only.</div>';
        return;
    }

    for (const platKey of platformKeys) {
        try {
            const cfg = GD_PLATFORM_LOGOS[platKey];
            const options = await buildPlatformAccountOptions({ game, platform: platKey, mode: 'details' });

            for (const opt of options) {
                if (opt.actionStatus === 'add_to_switcher' || opt.actionStatus === 'sync_to_verify') continue;

                let statusHtml = '';
                let statusClass = '';
                if (opt.actionStatus === 'ready') {
                    statusHtml = platKey === 'steam' ? '&#10003; Licensed' : '&#10003; Owned';
                    statusClass = 'owned';
                } else if (opt.actionStatus === 'does_not_own') {
                    statusHtml = platKey === 'steam' ? 'No license' : 'Not Owned';
                    statusClass = 'not-owned';
                } else {
                    statusHtml = '&mdash; Sync to verify';
                    statusClass = 'unknown';
                }

                rows.push(`
                    <div class="gd-account-item">
                        <div class="gd-account-plat-icon" style="background:${cfg.color}22; border: 1px solid ${cfg.color}44;">
                            <img src="${cfg.img}" alt="${cfg.name}" ${cfg.invert ? 'style="filter:invert(1)"' : ''}>
                        </div>
                        <div class="gd-account-info">
                            <div class="gd-account-name">${opt.displayName}</div>
                            <div class="gd-account-plat">${cfg.name}</div>
                        </div>
                        <div class="gd-account-status ${statusClass}" ${statusClass === 'unknown' ? 'style="background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.45); border: 1px solid rgba(255,255,255,0.12); padding: 2px 6px; border-radius: 8px; font-size: 0.8em;"' : ''}>
                            ${statusHtml}
                        </div>
                    </div>
                `);
            }
        } catch(e) {
            console.error(e);
        }
    }

    if (rows.length === 0) {
        container.innerHTML = '<div class="gd-no-accounts">No scanned accounts found. Sync your library from the Accounts tab first.</div>';
    } else {
        container.innerHTML = rows.join('');
    }
}

/**
 * دالة ذكية لمعرفة إذا كان الأكاونت يملك اللعبة فعلاً مش مجرد تخمين
 */
function _gdCheckRealOwnership(game, platform, profile) {
    // 1. لو الباك إند باعت لستة الألعاب اللي الأكاونت ده بيملكها
    if (profile.ownedGames && Array.isArray(profile.ownedGames)) {
        const gameNameLower = (game.name || '').toLowerCase();
        const isOwned = profile.ownedGames.some(g => {
            // بنقارن الاسم سواء كان string أو object
            const gName = (typeof g === 'string' ? g : g.name || '').toLowerCase();
            return gName === gameNameLower || gName.includes(gameNameLower);
        });
        if (isOwned) return true;
    }

    // 2. لو اللعبة نفسها متخزن فيها الـ ID بتاع الأكاونت اللي بتنتمي ليه 
    if (game.ownerIds && Array.isArray(game.ownerIds)) {
        if (game.ownerIds.includes(profile.id || profile.username)) return true;
    }

    // 3. Fallback للعبة المتسطبة: لو إنت مسجل إن اللعبة دي تابعة لأكاونت معين في الـ DB
    if (game.accountId && (game.accountId === profile.id || game.accountId === profile.username)) {
        return true;
    }

    return false;
}

/**
 * بيحاول يحدد إذا كانت اللعبة موجودة على الأكاونت ده
 */
function _gdCheckGameOwnership(game, platform, profile) {
    const gamePlatform = (game.platform || '').toLowerCase();
    if (gamePlatform.includes(platform)) return true;

    const cmd = (game.command || '').toLowerCase();
    if (platform === 'steam' && cmd.includes('steam')) return true;
    if (platform === 'epic'  && cmd.includes('com.epicgames')) return true;
    if (platform === 'ea'    && (cmd.includes('origin') || cmd.includes('ea'))) return true;

    return false;
}

// ──────────────────────────────────────────
//  TAB SWITCHING
// ──────────────────────────────────────────
window.gdSwitchTab = function(tabName, btnEl) {
    // Block achievements tab for non-Steam games
    if (tabName === 'achievements' && !_gdHasSteamAchievements(_gdCurrentGame)) return;
    document.querySelectorAll('.gd-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.gd-tab-content').forEach(t => {
        t.style.display = 'none';
        t.classList.remove('active');
    });

    btnEl.classList.add('active');
    const content = document.getElementById(`gdTab-${tabName}`);
    if (content) {
        content.style.display = 'block';
        content.classList.add('active');
    }

    if (tabName === 'achievements' && _gdCurrentGame && !_gdAchievementsLoaded) {
        _gdAchievementsLoaded = true;
        _gdPopulateAchievements(_gdCurrentGame);
    }
};

// ──────────────────────────────────────────
//  LIGHTBOX (GALLERY NAVIGATION)
// ──────────────────────────────────────────
window.gdOpenLightbox = function(index) {
    if (_gdLightboxImages.length === 0) return;
    _gdLightboxIndex = index;
    document.getElementById('gdLightboxImg').src = _gdLightboxImages[_gdLightboxIndex];
    document.getElementById('gdLightbox').classList.add('active');
};

window.gdCloseLightbox = function() {
    document.getElementById('gdLightbox').classList.remove('active');
    _gdLightboxIndex = 0;
    const lbImg = document.getElementById('gdLightboxImg');
    if (lbImg) lbImg.src = '';
};

window.gdNavLightbox = function(direction) {
    if (_gdLightboxImages.length === 0) return;
    
    _gdLightboxIndex += direction;
    // لف الدائرة لو وصل للآخر
    if (_gdLightboxIndex < 0) _gdLightboxIndex = _gdLightboxImages.length - 1;
    if (_gdLightboxIndex >= _gdLightboxImages.length) _gdLightboxIndex = 0;
    
    document.getElementById('gdLightboxImg').src = _gdLightboxImages[_gdLightboxIndex];
};

// دعم الكيبورد (أسهم يمين/شمال و زرار الهروب)
document.addEventListener('keydown', (e) => {
    const lb = document.getElementById('gdLightbox');
    if (lb && lb.classList.contains('active')) {
        if (e.key === 'ArrowRight') window.gdNavLightbox(1);
        if (e.key === 'ArrowLeft') window.gdNavLightbox(-1);
        if (e.key === 'Escape') window.gdCloseLightbox();
    }
});

// عشان لو ضغط في أي حتة فاضية في الخلفية يقفلها (اختياري بس بيخلي الـ UX أنضف)
document.getElementById('gdLightbox')?.addEventListener('click', (e) => {
    if (e.target.id === 'gdLightbox') window.gdCloseLightbox();
});

// ──────────────────────────────────────────
//  HELPERS
// ──────────────────────────────────────────
/**
 * Lightweight Markdown → HTML renderer (no external dependencies).
 * Handles: headings, bold, italic, images (stripped), links, unordered lists, paragraphs.
 * Images from Markdown are intentionally stripped — they're already handled via the images[] array.
 */
function _gdEscapeRaw(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function _gdRenderMarkdown(md) {
    if (!md) return '';
    // Escape raw HTML first so server-controlled text cannot inject tags.
    // We intentionally unescape &amp; back after so literal & in game descriptions render correctly.
    let html = _gdEscapeRaw(md).replace(/&amp;/g, '&')
        // Strip linked-image banners like [![alt](img)](url) before anything else
        .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, '')
        // Strip standalone markdown images (![alt](url)) — game already shows art via images array
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        // Headings h1-h6
        .replace(/^######\s+(.+)$/gm, '<h6 class="gd-md-h6" style="margin:8px 0 2px;">$1</h6>')
        .replace(/^#####\s+(.+)$/gm,  '<h5 class="gd-md-h5" style="margin:8px 0 2px;">$1</h5>')
        .replace(/^####\s+(.+)$/gm,   '<h4 class="gd-md-h4" style="margin:8px 0 2px;">$1</h4>')
        .replace(/^###\s+(.+)$/gm,    '<h3 class="gd-md-h3" style="margin:10px 0 3px;">$1</h3>')
        .replace(/^##\s+(.+)$/gm,     '<h2 class="gd-md-h2" style="margin:10px 0 3px;">$1</h2>')
        .replace(/^#\s+(.+)$/gm,      '<h1 class="gd-md-h1" style="margin:12px 0 4px;">$1</h1>')
        // Bold + italic (order matters)
        .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
        .replace(/\*\*(.+?)\*\*/g,     '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g,         '<em>$1</em>')
        // Links [text](url) — URL validated; data-href used to avoid inline onclick injection
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
            const safe = (typeof safeExternalUrl === 'function') ? safeExternalUrl(url) : '';
            if (!safe) return text;
            return `<a class="gd-md-link" data-href="${safe}">${text}</a>`;
        })
        // Unordered list items (lines starting with - or *)
        .replace(/^[\*\-]\s+(.+)$/gm, '<li>$1</li>')
        // Wrap consecutive <li> in <ul>
        .replace(/(<li>[\s\S]*?<\/li>)(\n<li>[\s\S]*?<\/li>)*/g, m => `<ul class="gd-md-ul">${m}</ul>`)
        // Horizontal rules
        .replace(/^---+$/gm, '<hr class="gd-md-hr">')
        // Double newlines → paragraph breaks
        .replace(/\n{2,}/g, '\n\n')
        // Collapse blank lines that appear right after a heading tag (reduces visual gap)
        .replace(/(<\/h[1-6]>)\n\n/g, '$1\n')
        // Wrap loose text lines in <p> (lines not already wrapped in a tag)
        .split('\n\n')
        .map(block => {
            block = block.trim();
            if (!block) return '';
            if (/^<(h[1-6]|ul|li|hr)/.test(block)) return block;
            return `<p class="gd-md-p" style="margin:0 0 6px;">${block.replace(/\n/g, '<br>')}</p>`;
        })
        .join('\n');
    return html;
}

function _gdToYoutubeEmbed(url) {
    if (!url) return null;
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    // ضفنا الـ origin هنا كمان
    if (match) return `https://www.youtube.com/embed/${match[1]}?autoplay=0&rel=0&origin=http://localhost`;
    return null;
}

function _gdFormatDate(val) {
    if (!val) return null;
    try {
        const d = new Date(val);
        if (isNaN(d)) return String(val);
        return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    } catch { return String(val); }
}

function _gdTrimUrl(url) {
    return url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
}

// ──────────────────────────────────────────
//  HOOK: ADD CLICK TO GAME CARDS
// ──────────────────────────────────────────
// شلنا الـ DOMContentLoaded عشان الـ Event يتطبق فوراً بدون مشاكل توقيت
document.addEventListener('click', (e) => {
    // FIX: if SortableJS just finished a drag, swallow this click entirely
    if (window.__igSortDragging) return;

    // لو ضغط على زرار PLAY الموجود جوه الكارت نخليه يلعب مباشرة
    const playBtn = e.target.closest('.play-btn-center');
    if (playBtn) return; // اتركه للـ handler الأصلي

    // FIX: ignore clicks on the drag handle — those are for dragging, not navigation
    if (e.target.closest('.gc-drag-handle')) return;

    // هنا بنراقب الماوس داس فين وهل لقط الكارت ولا لأ
    const card = e.target.closest('.game-card');
    if (!card) return;
    if (card.closest('#allGamesView')) return;

    if (card && !e.target.closest('.asc-unpin-btn') && !e.target.closest('.asc-play-btn')) {
        const gameId = card.getAttribute('data-id');

        if (gameId) {
            e.stopPropagation();
            openGameDetails(gameId);
        }
    }
});

// ──────────────────────────────────────────
//  IPC: REAL DOWNLOAD PROGRESS LISTENER
// ──────────────────────────────────────────
if (window.electronAPI?.onDownloadProgress) {
    window.electronAPI.onDownloadProgress((data) => {
        if (data.gameId !== _gdCurrentGameId) return;
        const dlBar = document.getElementById('gdDlBar');
        if (dlBar) dlBar.style.width = data.percent + '%';
        document.getElementById('gdDlPercent').textContent = data.percent.toFixed(1) + '%';
        document.getElementById('gdDlSpeed').textContent = data.speedMBps.toFixed(1) + ' MB/s';
        document.getElementById('gdDlEta').textContent = data.etaStr;
    });
}

// At bottom of game-details.js
if (window.electronAPI?.onGameEnriched) {
    window.electronAPI.onGameEnriched(({ gameId, normalized }) => {
        // Only apply if the user is still on the same game page AND this
        // enrichment result is actually for the current game's server UUID.
        if (!_gdCurrentGameId || !normalized) return;
        if (gameId && _gdCurrentMeta?._serverData?.id !== gameId) return;
        _gdCurrentMeta = normalized;
        _gdPopulateMeta(_gdCurrentGame, normalized);
    });
}
