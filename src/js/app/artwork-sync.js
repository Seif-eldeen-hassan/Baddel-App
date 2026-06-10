'use strict';

// ============================================================
// ARTWORK SYNC HELPERS
// Extracted from app.js — image URL helpers, card/hero image
// stable setters, in-memory game patching, suggestion art cache,
// RTIA hydrator, and local artwork state management.
// ============================================================

// ── Image load tracking ───────────────────────────────────────────────────────
// Shared Set so setCardImageStable / setHeroBgStable avoid retrying
// URLs that already returned a broken response.
const failedImageIds = new Set();

// ── Image URL helpers ─────────────────────────────────────────────────────────

function isUsableImageUrl(url) {
    if (!url || typeof url !== 'string') return null;
    const s = url.replace(/\\/g, '/').replace(/'/g, "\\'").trim();
    if (!s) return null;
    const lower = s.toLowerCase();
    if (lower === 'null' || lower === 'undefined' || lower === 'none') return null;
    if (lower.includes('broken') || lower.includes('missing-image') || lower.includes('placeholder')) return null;
    if (s.startsWith('http://') || s.startsWith('https://') || s.startsWith('file://') || s.startsWith('/') || s.includes('/')) return s;
    return null;
}

function _preferLocalImage(candidates) {
    const usable = candidates.map(isUsableImageUrl).filter(Boolean);
    return usable.find(u => u.startsWith('file://')) || usable[0] || null;
}

function getPosterUrl(game) {
    if (!game) return null;
    const poster = _preferLocalImage([
        game.image,
        game.defaultImage,
        game.coverUrl,
        game.capsuleImage,
        game.boxArt,
        game.grid,
    ]);
    return poster || _preferLocalImage([game.heroImage, game.defaultHero]);
}

function getPosterUrlInstalled(game) {
    if (!game) return null;
    return _preferLocalImage([game.image, game.defaultImage, game.coverUrl, game.capsuleImage]);
}

// ── Card image DOM helpers ────────────────────────────────────────────────────

function _cardImageApply(el, url) {
    if (!el || !url) return;
    if (el.tagName === 'IMG') {
        el.src = url;
        el.style.display = 'block';
    } else {
        el.style.backgroundImage = `url('${url}')`;
        el.classList.add('has-image');
    }
    el.dataset.lastGoodImage = url;
}

function setCardImageStable(el, newUrl, fallbackUrl) {
    if (!el) return;
    const candidate = isUsableImageUrl(newUrl);
    const fallback = isUsableImageUrl(el.dataset?.lastGoodImage) || isUsableImageUrl(fallbackUrl);
    if (!candidate) {
        if (fallback) _cardImageApply(el, fallback);
        return;
    }
    if (failedImageIds.has(candidate)) {
        if (fallback) _cardImageApply(el, fallback);
        return;
    }
    if (el.dataset?.lastGoodImage === candidate) return;

    const preloader = new Image();
    preloader.onload = () => _cardImageApply(el, candidate);
    preloader.onerror = () => {
        failedImageIds.add(candidate);
        if (fallback) _cardImageApply(el, fallback);
    };
    preloader.src = candidate;
}

// ── Hero background-image stable setter ──────────────────────────────────────
// Mirrors setCardImageStable but targets CSS background-image on a div.
// Tracks lastGoodBg on the element so fallback survives re-renders.
function _heroBgApply(el, url) {
    if (!el || !url) return;
    const safe = url.replace(/\\/g, '/').replace(/'/g, "\\'");
    el.style.backgroundImage = `url('${safe}')`;
    el.dataset.lastGoodBg = url;
}
function setHeroBgStable(el, newUrl, fallbackUrl) {
    if (!el) return;
    const candidate = isUsableImageUrl(newUrl);
    const fallback  = isUsableImageUrl(el.dataset?.lastGoodBg) || isUsableImageUrl(fallbackUrl);
    if (!candidate) {
        if (fallback) _heroBgApply(el, fallback);
        return;
    }
    if (failedImageIds.has(candidate)) {
        if (fallback) _heroBgApply(el, fallback);
        return;
    }
    if (el.dataset?.lastGoodBg === candidate) return;
    const preloader = new Image();
    preloader.onload  = () => _heroBgApply(el, candidate);
    preloader.onerror = () => {
        failedImageIds.add(candidate);
        if (fallback) _heroBgApply(el, fallback);
    };
    preloader.src = candidate;
}

// ── Artwork alias normalisation ───────────────────────────────────────────────

function _normalizeArtworkAliases(g) {
    if (!g) return g;
    const cover = g.image || g.defaultImage || g.coverUrl || g.cover || null;
    const hero  = g.heroImage || g.defaultHero || g.heroUrl || g.hero || null;
    const logo  = g.logo || g.defaultLogo || g.logoUrl || null;
    if (cover) { g.image = cover; g.defaultImage = cover; g.coverUrl = cover; }
    if (hero)  { g.heroImage = hero; g.defaultHero = hero; g.heroUrl = hero; }
    if (logo)  { g.logo = logo; g.defaultLogo = logo; g.logoUrl = logo; }
    return g;
}

// ── Visible card DOM patcher ──────────────────────────────────────────────────

function _patchVisibleGameCard(updatedGame) {
    const g = _normalizeArtworkAliases(updatedGame);
    if (!g || !g.id) return;
    const cover = g.image || g.defaultImage || g.coverUrl || null;
    if (!cover) return;
    const card = document.querySelector(`[data-id="${CSS.escape(String(g.id))}"]`);
    const img  = card?.querySelector?.('.actual-img');
    if (img) {
        img.classList.remove('img-loaded');
        img.addEventListener('load', () => img.classList.add('img-loaded'), { once: true });
        img.src = safeImageUrl(cover) + (cover.startsWith('file://') ? `?t=${Date.now()}` : '');
        img.style.opacity  = '';
        img.style.display  = 'block';
    }
}

// ── Ready-to-Install artwork cache ────────────────────────────────────────────
// Keyed by _suggKey(g) = "${platform}:${id}". Stores { poster, hero, logo }.
// Prefers file:// over remote URLs. Persists via localStorage so art survives
// rotation, filter changes, and re-renders without re-fetching from the CDN.
const _SUGG_ART_CACHE_KEY = 'baddel_sugg_art_cache_v1';
let _suggArtCache = (() => {
    try { return JSON.parse(localStorage.getItem(_SUGG_ART_CACHE_KEY) || '{}'); } catch { return {}; }
})();
function _suggArtCacheGet(key) { return _suggArtCache[key] || null; }
// Expose to game-details.js so the install-picker artwork resolver can
// consult the Ready-to-Install art cache without duplicating logic.
window._suggArtCacheGet = _suggArtCacheGet;
function _suggArtCacheSave() {
    try { localStorage.setItem(_SUGG_ART_CACHE_KEY, JSON.stringify(_suggArtCache)); } catch {}
}
function _suggArtCacheSet(key, updates) {
    const existing = _suggArtCache[key] || {};
    for (const [field, url] of Object.entries(updates)) {
        if (!url) continue;
        const cur = existing[field];
        // Never replace a confirmed-good file:// URL with a remote URL
        if (cur && cur.startsWith('file://') && !url.startsWith('file://')) continue;
        existing[field] = url;
    }
    _suggArtCache[key] = existing;
    _suggArtCacheSave();
}
function _suggArtCacheDeleteField(key, field) {
    const existing = _suggArtCache[key];
    if (!existing || !(field in existing)) return;
    delete existing[field];
    if (!Object.keys(existing).length) delete _suggArtCache[key];
    _suggArtCacheSave();
}
function _suggArtCachePopulate(g) {
    // Snapshot all current art fields from g into the cache.
    // Called at render-time and after hydration so rotation always has a fallback.
    const key = _suggKey(g);
    const p = _preferLocalImage([g.image, g.defaultImage, g.coverUrl, g.capsuleImage, g.boxArt, g.grid]);
    const h = _preferLocalImage([g.heroImage, g.defaultHero]);
    const l = _preferLocalImage([g.logo, g.defaultLogo]);
    const updates = {};
    if (p) updates.poster = p;
    if (h) updates.hero   = h;
    if (l) updates.logo   = l;
    if (Object.keys(updates).length) _suggArtCacheSet(key, updates);
}

// ── Shared creator-patch helper ───────────────────────────────────────────────
// Propagates a creator-mode artwork/name patch to every live in-memory store
// so Game Details, Home, and the synced Ready-to-Install rail all stay in sync
// without a full page reload.
//
// patch: { cover?, hero?, logo?, logoCleared?, name? }
// options: { skipSyncedRender? }
window.__baddelApplyGameCustomOverride = function(gameLike, patch = {}, options = {}) {
    const now = Date.now();
    const _norm  = (v) => String(v || '').trim().toLowerCase();
    const _loose = (v) => String(v || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    const _addKey = (set, v) => {
        const r = _norm(v);  if (r) set.add(r);
        const l = _loose(v); if (l) set.add(l);
    };

    const candidateKeys = new Set();
    ['id','installedId','appName','appid','appId','steamAppId','steam_appid',
     'namespace','catalogNamespace','catalogItemId','launcherGameId'].forEach(f => _addKey(candidateKeys, gameLike[f]));
    if (gameLike.allIds && typeof gameLike.allIds === 'object') {
        Object.values(gameLike.allIds).forEach(v => _addKey(candidateKeys, v));
    }
    const looseTitleKey = _loose(gameLike.title || gameLike.name || patch.name || '');

    const _matches = (g) => {
        for (const f of ['id','installedId','appName','appid','appId','steamAppId','steam_appid',
                          'namespace','catalogNamespace','catalogItemId','launcherGameId']) {
            const r = _norm(g[f]);  if (r && candidateKeys.has(r)) return true;
            const l = _loose(g[f]); if (l && candidateKeys.has(l)) return true;
        }
        if (g.allIds && typeof g.allIds === 'object') {
            for (const v of Object.values(g.allIds)) {
                const r = _norm(v);  if (r && candidateKeys.has(r)) return true;
                const l = _loose(v); if (l && candidateKeys.has(l)) return true;
            }
        }
        const t = _loose(g.title || g.name || '');
        return Boolean(looseTitleKey && t && t === looseTitleKey);
    };

    const _applyPatch = (g) => {
        if (!g) return;
        if (patch.cover) {
            g.cover        = patch.cover;
            g.image        = patch.cover;
            g.coverUrl     = patch.cover;
            g.defaultImage = patch.cover;
            // Stop background pipeline from overwriting creator-chosen art
            g._agCoverPipelineDone   = true;
            g._agCoverInFlight       = false;
            g._agRemoteFallbackReady = true;
            g._agLocalRetryCount     = 999;
        }
        if (patch.hero) {
            g.hero        = patch.hero;
            g.heroImage   = patch.hero;
            g.heroUrl     = patch.hero;
            g.defaultHero = patch.hero;
        }
        if (patch.logo) {
            g.logo        = patch.logo;
            g.logoUrl     = patch.logo;
            g.defaultLogo = patch.logo;
        }
        if (patch.logoCleared) {
            g.logo        = null;
            g.logoUrl     = null;
            g.defaultLogo = null;
        }
        if (patch.name) {
            g.name              = patch.name;
            g.title             = patch.name;
            g.customTitle       = patch.name;
            g.creatorCustomName = patch.name;
        }
        g.customArtworkLocked = true;
        g.artworkSource       = patch.artworkSource || 'creator';
        g.artworkUpdatedAt    = patch.artworkUpdatedAt || now;
    };

    const _patchArr = (arr) => {
        if (!Array.isArray(arr)) return;
        arr.forEach(g => { if (_matches(g)) _applyPatch(g); });
    };

    if (typeof allGamesData !== 'undefined') _patchArr(allGamesData);
    if (window.allGamesData && typeof allGamesData !== 'undefined' && window.allGamesData !== allGamesData) _patchArr(window.allGamesData);
    _patchArr(window._allGamesCache);
    _patchArr(window._vs?.items);
    _patchArr(_suggAllGames);
    _patchArr(_suggPool);
    if (_suggFeaturedGame && _matches(_suggFeaturedGame)) _applyPatch(_suggFeaturedGame);

    // Update localStorage cover/hero/logo keys for every candidate ID
    candidateKeys.forEach(key => {
        if (patch.cover)      localStorage.setItem('cover_' + key, patch.cover);
        if (patch.hero)       localStorage.setItem('hero_'  + key, patch.hero);
        if (patch.logo)       localStorage.setItem('logo_'  + key, patch.logo);
        if (patch.logoCleared) localStorage.removeItem('logo_' + key);
    });

    // Sync sugg art cache for all matched ready-to-install games.
    // Check all three sugg stores because installed+synced hybrids may be visible
    // in _suggPool/_suggFeaturedGame under a different object reference than _suggAllGames.
    const _seenSuggKeys = new Set();
    const _updateSuggArtCache = (g) => {
        if (!_matches(g)) return;
        const key = typeof _suggKey === 'function' ? _suggKey(g) : null;
        if (!key || _seenSuggKeys.has(key)) return;
        _seenSuggKeys.add(key);
        const updates = {};
        if (patch.cover) updates.poster = patch.cover;
        if (patch.hero)  updates.hero   = patch.hero;
        if (patch.logo)  updates.logo   = patch.logo;
        if (Object.keys(updates).length) _suggArtCacheSet(key, updates);
    };
    (_suggAllGames || []).forEach(_updateSuggArtCache);
    (_suggPool     || []).forEach(_updateSuggArtCache);
    if (_suggFeaturedGame) _updateSuggArtCache(_suggFeaturedGame);

    // Invalidate virtual scroller card cache
    if (window._vs?.cardCache instanceof Map)    window._vs.cardCache.clear();
    if (window._vs?._coverQueued instanceof Set) window._vs._coverQueued.clear();

    // Re-render synced UI unless caller will do it
    if (!options.skipSyncedRender) {
        if (typeof _renderSyncedFeature === 'function' && _suggFeaturedGame) {
            try { _renderSyncedFeature(_suggFeaturedGame); } catch (_) {}
        }
        if (typeof _renderSyncedRail === 'function' && Array.isArray(_suggPool)) {
            try { _renderSyncedRail(_suggPool); } catch (_) {}
        }
    }
};

// ── ReadyToInstallAssetHydrator (RTIA) ────────────────────────────────────────
// Eagerly hydrates art for ALL ready-to-install games before the first render.
// Filter switching re-renders from the already-populated in-memory + localStorage
// cache without triggering new downloads or broken images.
const _RTIA_DISK_CONCURRENCY = 4;
const _RTIA_HYDRATE_TIMEOUT  = 12_000;
let   _rtia_running          = false;

async function _rtia_warmOne(g) {
    const key    = _suggKey(g);
    const cached = _suggArtCacheGet(key) || {};
    const staleFields = [];

    // Validate cached file:// URLs — delete if the file no longer exists on disk
    for (const field of ['poster', 'hero', 'logo']) {
        const url = cached[field];
        if (url && url.startsWith('file://')) {
            const alive = await window.electronAPI.probeLocalImage(url).catch(() => false);
            if (!alive) {
                delete cached[field];
                staleFields.push(field);
            }
        }
    }
    for (const field of staleFields) _suggArtCacheDeleteField(key, field);

    const localFieldMap = [
        { gameField: 'image',        artField: 'poster' },
        { gameField: 'defaultImage', artField: 'poster' },
        { gameField: 'coverUrl',     artField: 'poster' },
        { gameField: 'heroImage',    artField: 'hero'   },
        { gameField: 'defaultHero',  artField: 'hero'   },
        { gameField: 'logo',         artField: 'logo'   },
        { gameField: 'defaultLogo',  artField: 'logo'   },
    ];
    for (const { gameField, artField } of localFieldMap) {
        const url = g[gameField];
        if (url && typeof url === 'string' && url.startsWith('file://')) {
            const alive = await window.electronAPI.probeLocalImage(url).catch(() => false);
            if (!alive) {
                console.warn('[ReadyToInstall] stale local art removed', key, gameField, url);
                g[gameField] = null;
                _suggArtCacheDeleteField(key, artField);
            }
        }
    }

    // Promote live cached file:// URLs into game object fields
    if (cached.poster && !g.image)     g.image     = cached.poster;
    if (cached.hero   && !g.heroImage) g.heroImage = cached.hero;
    if (cached.logo   && !g.logo)      g.logo      = cached.logo;

    // For any type still missing, try the on-disk image cache
    const toFetch = [
        { gameField: 'image',     artField: 'poster', type: 'cover' },
        { gameField: 'heroImage', artField: 'hero',   type: 'hero'  },
        { gameField: 'logo',      artField: 'logo',   type: 'logo'  },
    ];
    for (const { gameField, artField, type } of toFetch) {
        if (g[gameField] || !window.electronAPI.getCachedImage) continue;
        const url = await window.electronAPI.getCachedImage(g.id, type).catch(() => null);
        if (url) {
            g[gameField] = url;
            _suggArtCacheSet(key, { [artField]: url });
        }
    }

    _suggArtCachePopulate(g);
}

async function _rtia_warmBatch(games) {
    const queue = [...games];
    await Promise.all(
        Array.from({ length: _RTIA_DISK_CONCURRENCY }, async () => {
            while (queue.length) {
                const g = queue.shift();
                if (g) await _rtia_warmOne(g).catch(() => {});
            }
        })
    );
}

function _rtia_awaitHydration(games, timeoutMs) {
    return new Promise(resolve => {
        const deadline = Date.now() + timeoutMs;
        const check = () => {
            if (games.every(g => g._heroHydrated) || Date.now() >= deadline) { resolve(); return; }
            setTimeout(check, 200);
        };
        check();
    });
}

async function _rtia_hydrateAll(games) {
    if (_rtia_running || !games?.length) return;
    _rtia_running = true;
    try {
        // Phase 1: fast disk warm — validate cached file:// URLs, pull from disk cache.
        // Awaited so g.image / g.heroImage are filled before the first render.
        await _rtia_warmBatch(games);

        // Phase 2: kick off network hydration for games not yet fully hydrated.
        // Fire-and-forget — _suggReRenderOne patches the DOM when art arrives.
        // Do NOT await; rendering must not block on network round-trips.
        for (const g of games) {
            if (!g._heroHydrated && !g._heroHydrating) {
                _suggHydrateArt(g, null, false);
            }
        }
    } finally {
        _rtia_running = false;
    }
}

// ── Local artwork state and hydration helpers ─────────────────────────────────

async function _isUsableLocalArtwork(url) {
    if (!url) return false;
    if (!String(url).startsWith('file://')) return true;
    try {
        const ok = await window.electronAPI.probeLocalImage(url);
        return !!ok;
    } catch {
        return false;
    }
}

function _clearArtworkLocalState(gameId) {
    if (!gameId) return;
    const id = String(gameId);

    try {
        localStorage.removeItem('cover_' + id);
        localStorage.removeItem('hero_'  + id);
        localStorage.removeItem('logo_'  + id);
    } catch {}

    if (window._vs?.cardCache instanceof Map) {
        window._vs.cardCache.delete(id);
    }

    if (window._vs?._coverQueued instanceof Set) {
        window._vs._coverQueued.delete(id);
    }

    if (Array.isArray(window._allGamesCache)) {
        window._allGamesCache = window._allGamesCache.filter(g => String(g.id) !== id);
    }

    if (Array.isArray(window._allGamesRawCache)) {
        window._allGamesRawCache = window._allGamesRawCache.filter(g => String(g.id) !== id);
    }

    if (Array.isArray(allGamesData)) {
        allGamesData = allGamesData.filter(g => String(g.id) !== id);
        window.allGamesData = allGamesData;
    }
}
window._clearArtworkLocalState = _clearArtworkLocalState;

async function hydrateManualGameArtworkNow(game) {
    if (!game || !game.id) return;
    console.log('[ManualAddArtwork] readd hydrate start', game.id, game.name);

    const rawCover = localStorage.getItem('cover_' + game.id);
    const rawHero  = localStorage.getItem('hero_'  + game.id);
    const rawLogo  = localStorage.getItem('logo_'  + game.id);

    const coverOk = await _isUsableLocalArtwork(rawCover);
    const heroOk  = await _isUsableLocalArtwork(rawHero);
    const logoOk  = await _isUsableLocalArtwork(rawLogo);

    if (!coverOk && rawCover) {
        console.log('[ManualAddArtwork] stale local cover removed', game.id, rawCover);
        localStorage.removeItem('cover_' + game.id);
    }
    if (!heroOk && rawHero) {
        localStorage.removeItem('hero_' + game.id);
    }
    if (!logoOk && rawLogo) {
        localStorage.removeItem('logo_' + game.id);
    }

    const existingCover = coverOk ? rawCover : null;
    const existingHero  = heroOk  ? rawHero  : null;
    const existingLogo  = logoOk  ? rawLogo  : null;

    const meta = await window.electronAPI.getMetadata(game.name, {
        id:             game.id,
        platform:       game.platform || 'manual',
        existingCover:  existingCover,
        existingHero:   existingHero,
        existingLogo:   existingLogo,
        command:        game.command,
        path:           game.executablePath || game.path || game.command,
        executablePath: game.executablePath,
        folderName:     game.folderName,
        exeName:        game.exeName,
        allIds:         game.allIds,
        platforms:      game.platforms,
        force:          true,
        bypassTtl:      true,
        source:         'manual-add-readd',
    });
    if (!meta) return;

    const metaHero = meta.hero || meta.heroImage || null;
    const metaLogo = meta.logo || meta.defaultLogo || null;

    if (metaHero) game.heroImage = metaHero;
    if (metaLogo) game.logo      = metaLogo;

    let finalCover =
        meta.cover ||
        meta.image ||
        meta.defaultImage ||
        meta.coverUrl ||
        null;
    let finalHero  = metaHero;
    let finalLogo  = metaLogo;

    if (window.electronAPI.cacheAllAssets) {
        try {
            const localAssets = await window.electronAPI.cacheAllAssets(
                { cover: finalCover, hero: finalHero, logo: finalLogo }, game.id
            );
            finalCover = localAssets.cover || finalCover;
            finalHero  = localAssets.hero  || finalHero;
            finalLogo  = localAssets.logo  || finalLogo;
        } catch (e) {
            console.error('[ManualAddArtwork] cacheAllAssets failed', game.id, e);
        }
    }

    if (finalCover) {
        game.image = finalCover; game.defaultImage = finalCover; game.coverUrl = finalCover;
        localStorage.setItem('cover_' + game.id, finalCover);
    }
    if (finalHero) {
        game.heroImage = finalHero;
        localStorage.setItem('hero_' + game.id, finalHero);
    }
    if (finalLogo) {
        game.logo = finalLogo;
        localStorage.setItem('logo_' + game.id, finalLogo);
    }

    if (finalCover || finalHero || finalLogo) {
        await window.electronAPI.saveMetadata?.(game.id, {
            cover:           finalCover,
            hero:            finalHero,
            logo:            finalLogo,
            image:           finalCover,
            heroImage:       finalHero,
            artworkSource:   'manual-add',
            artworkUpdatedAt: Date.now(),
        }, { source: 'server-details', force: true }).catch(err => {
            console.warn('[ManualAddArtwork] saveMetadata failed', err);
        });
    }

    const patched = _patchGameInMemory(game);
    _patchVisibleGameCard(patched);
    applyFilters();
    return patched;
}
window.hydrateManualGameArtworkNow = hydrateManualGameArtworkNow;

async function hydrateRecentHeroArtwork(game, imgEl) {
    if (!game || !imgEl || !window.electronAPI?.getMetadata) return null;

    const meta = await window.electronAPI.getMetadata(game.name, {
        id:             game.id,
        platform:       game.platform,
        platforms:      game.platforms,
        command:        game.command,
        path:           game.executablePath || game.path || game.command,
        executablePath: game.executablePath,
        folderName:     game.folderName,
        exeName:        game.exeName,
        allIds:         game.allIds,
        existingHero:   game.heroImage || game.defaultHero || game.heroUrl || null,
        existingCover:  game.image || game.defaultImage || game.coverUrl || null,
        source:         'jump-back-in',
        preferHero:     true,
    });

    if (!meta) return null;

    let hero  = meta.hero  || meta.heroImage  || meta.defaultHero  || meta.heroUrl  || null;
    let logo  = meta.logo  || meta.defaultLogo || meta.logoUrl || null;
    let cover = meta.cover || meta.image || meta.defaultImage || meta.coverUrl || null;

    if (window.electronAPI.cacheAllAssets && (hero || logo || cover)) {
        const localAssets = await window.electronAPI.cacheAllAssets(
            { hero, logo, cover },
            game.id
        ).catch(() => null);

        if (localAssets) {
            hero  = localAssets.hero  || hero;
            logo  = localAssets.logo  || logo;
            cover = localAssets.cover || cover;
        }
    }

    if (hero) {
        game.heroImage  = hero;
        game.defaultHero = hero;
        game.heroUrl    = hero;
        localStorage.setItem('hero_' + game.id, hero);

        imgEl.src = safeImageUrl(hero);

        if (typeof _patchGameInMemory === 'function') _patchGameInMemory(game);

        if (window.electronAPI.saveMetadata) {
            window.electronAPI.saveMetadata(game.id, {
                hero,
                heroImage: hero,
                logo,
                cover,
                image: cover,
            }, { source: 'jump-back-in', force: true }).catch(() => {});
        }

        return hero;
    }

    if (cover && !imgEl.src) {
        imgEl.src = safeImageUrl(cover);
    }

    return null;
}
