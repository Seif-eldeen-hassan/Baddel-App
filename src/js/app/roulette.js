'use strict';

// ============================================================
// SURPRISE ME (ROULETTE)
// Extracted from src/js/app.js — Phase 2.22B
//
// Dependencies (must load before this file):
//   artwork-sync.js  — isUsableImageUrl, getPosterUrl, getPosterUrlInstalled,
//                      _preferLocalImage, failedImageIds, _suggArtCacheGet,
//                      _suggArtCacheSet
//   toast-confirm.js — showToast
//   launcher-actions.js — triggerLaunchSequence
//   suggestions.js   — _seededShuffle, _suggKey, _suggHydrateArt,
//                      _suggBuildGame, window._suggAllGames
//
// Runtime dependencies resolved at call time (not at load time):
//   window.allGamesData        — populated by app.js on init
//   window.openGameDetails     — game-details.js
//   window._gdOpenInstallPickerForGame — game-details.js
//   window.suggViewDetails     — suggestions.js
//   window.electronAPI         — preload.js context bridge
// ============================================================

// ── State ────────────────────────────────────────────────────
let customSpinIds        = [];
let rouletteResultId     = null;
let rouletteResultGame   = null;
let isSpinning           = false;
let rouletteMode         = null; // 'play' | 'install'
let _rouletteRecentPicks = [];
let rouletteSpinToken    = 0;
let rouletteState        = 'idle';

const _ROULETTE_HYDRATE_LIMIT = 12;
let   _roulettePoolHydrated   = false;

// ── Mode selector ─────────────────────────────────────────────
function setRouletteMode(mode) {
    rouletteMode = mode;

    // Update button active state
    document.getElementById('modeBtnPlay')?.classList.toggle('active', mode === 'play');
    document.getElementById('modeBtnInstall')?.classList.toggle('active', mode === 'install');

    const spinBtn      = document.getElementById('spinBtn');
    const poolBtn      = document.getElementById('roulettePoolBtn');
    const nameTxt      = document.getElementById('rouletteName');
    const card         = document.getElementById('rouletteCard');
    const playResultBtn = document.getElementById('playResultBtn');

    // Reset result state when mode changes
    rouletteResultId   = null;
    rouletteResultGame = null;
    card?.classList.remove('winner', 'spinning', 'has-poster');
    if (card) {
        delete card.dataset.rouletteWinnerId;
        delete card.dataset.rouletteInstallPlatform;
    }
    const img     = document.getElementById('rouletteImg');
    const graphic = document.getElementById('rouletteGraphic');
    if (img)     { img.style.display = 'none'; img.removeAttribute('src'); delete img.dataset.lastGoodImage; }
    if (graphic)  graphic.style.display = 'flex';
    if (playResultBtn) playResultBtn.style.display = 'none';

    if (mode === 'play') {
        const playPool = _buildPlayPool();
        if (spinBtn) {
            if (playPool.length === 0) {
                spinBtn.disabled = true;
                spinBtn.title    = 'Add games to your library first';
                spinBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.59-9.21l-3.25 1.64"></path></svg> No games`;
            } else {
                spinBtn.disabled = false;
                spinBtn.title    = '';
                spinBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.59-9.21l-3.25 1.64"></path></svg> Surprise Me`;
            }
        }
        if (poolBtn)  poolBtn.style.display  = 'flex';   // show custom pool gear for play mode
        if (nameTxt)  nameTxt.innerText = playPool.length === 0 ? 'No games in library' : 'Ready to spin!';
    } else {
        // install mode
        const installPool = _buildInstallPool();
        if (spinBtn) {
            if (installPool.length === 0) {
                spinBtn.disabled = true;
                spinBtn.title    = 'Sync your Steam or Epic library first';
                spinBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.59-9.21l-3.25 1.64"></path></svg> No synced games`;
            } else {
                spinBtn.disabled = false;
                spinBtn.title    = '';
                spinBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.59-9.21l-3.25 1.64"></path></svg> Surprise Me`;
            }
        }
        if (poolBtn)  poolBtn.style.display  = 'none';   // no custom pool for install mode
        if (nameTxt)  nameTxt.innerText = installPool.length === 0 ? 'Sync an account to spin' : 'Ready to spin!';
        // Reset per-session hydration gate so switching back to install re-checks
        _roulettePoolHydrated = false;
        // Kick off best-effort art hydration for candidates missing posters
        if (installPool.length > 0) _rouletteHydrateInstallPool(installPool);
    }
}

// ── Build pool for each mode ───────────────────────────────────
function _buildPlayPool() {
    const games = Array.isArray(window.allGamesData) ? window.allGamesData : [];
    let pool = games.filter(g => !g.isHidden && (g.path || g.command));
    if (customSpinIds.length > 0) {
        pool = pool.filter(g => customSpinIds.includes(String(g.id)));
    }
    return pool;
}

function _rouletteResolveArtwork(game, surface = 'roulette') {
    const raw = game?._raw || game || {};
    const cacheKey = typeof _suggKey === 'function' ? _suggKey(raw.id ? raw : (game?.id ? game : raw)) : null;
    const cachedArt = cacheKey && typeof _suggArtCacheGet === 'function' ? (_suggArtCacheGet(cacheKey) || {}) : {};
    const adapter = window.BaddelGameSurfaceArtworkAdapter;
    const cacheArtwork = {
        cover: cachedArt.poster || null,
        hero: cachedArt.hero || null,
        logo: cachedArt.logo || null,
    };
    const mergedGame = raw === game ? game : { ...raw, ...game };
    if (!adapter || typeof adapter.resolveGameSurfaceArtwork !== 'function') {
        return {
            cover: { value: getPosterUrl(mergedGame) || null, source: 'legacy-fallback' },
            hero:  { value: isUsableImageUrl(mergedGame.heroImage || mergedGame.defaultHero || mergedGame._rouletteHeroUrl || mergedGame.heroUrl || mergedGame.background || cachedArt.hero || null), source: 'legacy-fallback' },
            logo:  { value: isUsableImageUrl(mergedGame.logo || mergedGame.defaultLogo || cachedArt.logo || null), source: 'legacy-fallback' },
        };
    }
    try {
        return adapter.resolveGameSurfaceArtwork({ surface, game: mergedGame, cacheArtwork });
    } catch {
        return adapter.legacyGameSurfaceArtwork({ game: mergedGame, cacheArtwork });
    }
}

function _buildInstallPool() {
    // Reuse the already-fetched synced suggestions list (_suggAllGames from accounts/synced section)
    // Map them into a shape consistent with local games so the spinner can display them.
    const synced = Array.isArray(window._suggAllGames) ? window._suggAllGames : (typeof _suggAllGames !== 'undefined' ? _suggAllGames : []);
    if (synced.length > 0) {
        return synced.map(g => {
            // Merge art from _suggArtCache so roulette candidates have hero data
            // even when _suggHydrateArt ran after the pool was last built.
            const cacheKey    = _suggKey(g);
            const cachedArt   = (typeof _suggArtCacheGet === 'function' ? _suggArtCacheGet(cacheKey) : null) || {};

            const resolvedArt = _rouletteResolveArtwork(g, 'roulette-install-pool');
            const bestPoster  = _preferLocalImage([resolvedArt.cover?.value, g.image, g.defaultImage, g.coverUrl, g.capsuleImage, g.boxArt, g.grid, cachedArt.poster]) || '';
            const bestHero    = _preferLocalImage([resolvedArt.hero?.value, g.heroImage, g.defaultHero, cachedArt.hero]) || '';
            const bestLogo    = _preferLocalImage([resolvedArt.logo?.value, g.logo, g.defaultLogo, cachedArt.logo]) || '';

            return {
                id:          g.id,
                name:        g.title        || 'Unknown',
                // Poster / cover fields (normalised)
                image:        bestPoster,
                defaultImage: g.defaultImage || cachedArt.poster || '',
                coverUrl:     g.coverUrl     || '',
                capsuleImage: g.capsuleImage || '',
                boxArt:       g.boxArt       || '',
                grid:         g.grid         || '',
                // Hero fields (normalised — critical for _rouletteHeroUrl)
                heroImage:    bestHero,
                defaultHero:  g.defaultHero  || cachedArt.hero  || '',
                // Logo
                logo:         bestLogo,
                defaultLogo:  g.defaultLogo  || cachedArt.logo  || '',
                _platform:    g._platform,
                _raw:         g, // original synced object — mutated in-place by _suggHydrateArt
            };
        });
    }
    return [];
}

// ── Best available poster for an install-mode candidate ────────
// Walks candidate fields then falls through to _raw, which may be
// enriched by _suggHydrateArt after the pool was built.
function _rouletteInstallImage(c) {
    return getPosterUrl(c) || (c._raw ? getPosterUrl(c._raw) : null);
}

function _roulettePosterPick(game, mode) {
    let resolvedArt = null;
    if (typeof _rouletteResolveArtwork === 'function') {
        resolvedArt = _rouletteResolveArtwork(game, mode === 'install' ? 'roulette-install-poster' : 'roulette-play-poster');
    } else {
        for (const source of ['image', 'defaultImage', 'coverUrl', 'cover', 'posterImage', '_roulettePosterUrl']) {
            const url = isUsableImageUrl(game?.[source] || null);
            if (url) return { url, source };
        }
        resolvedArt = { cover: null, hero: null };
    }
    const coverUrl = isUsableImageUrl(resolvedArt.cover?.value || null);
    if (coverUrl) return { url: coverUrl, source: resolvedArt.cover?.source || 'resolver' };

    if (mode === 'install') {
        const heroUrl = isUsableImageUrl(resolvedArt.hero?.value || null);
        if (heroUrl) {
            console.warn(`[RoulettePoster] ${_rouletteGameId(game)} mode=${mode} using hero fallback source=${resolvedArt.hero?.source || 'resolver'}`);
            return { url: heroUrl, source: resolvedArt.hero?.source || 'resolver-hero' };
        }
    }

    return { url: null, source: 'none' };
}

function getRoulettePosterUrl(game, mode) {
    if (game?._roulettePosterUrl) {
        console.log(`[RoulettePoster] ${_rouletteGameId(game)} mode=${mode} poster=${game._roulettePosterUrl} source=preloaded`);
        return game._roulettePosterUrl;
    }
    const pick = _roulettePosterPick(game, mode);
    console.log(`[RoulettePoster] ${_rouletteGameId(game)} mode=${mode} poster=${pick.url || ''} source=${pick.source}`);
    return pick.url;
}

// ── Hydrate a batch of install candidates that are missing art ─
// Fire-and-forget: calls _suggHydrateArt (which has its own per-game
// guard) for the first LIMIT candidates without valid posters.
// No re-hydration, no request storm.
function _rouletteHydrateInstallPool(pool) {
    if (_roulettePoolHydrated) return;
    _roulettePoolHydrated = true;

    let queued = 0;
    for (const c of pool) {
        if (queued >= _ROULETTE_HYDRATE_LIMIT) break;
        if (_rouletteInstallImage(c)) continue; // already has art — skip
        const raw = c._raw;
        if (!raw) continue;
        if (raw._heroHydrated || raw._heroHydrating) continue; // already handled
        _suggHydrateArt(raw, null, false); // best-effort, no DOM target needed
        queued++;
    }
}

// ── Safe image URL resolver ────────────────────────────────────
// Returns a cleaned URL string if the image looks valid, otherwise null.
// Rejects empty strings, placeholder literals, and bare filenames with no path.
function _rouletteValidImg(raw) {
    return isUsableImageUrl(raw);
}

// ── Best poster for any game object (play or install mode) ─────
// Tries heroImage → image → capsuleImage in order, returns first valid URL or null.
function getGamePoster(game) {
    return getPosterUrlInstalled(game);
}

// ── Show poster or fall back to the neutral graphic ────────────
function _rouletteShowImg(img, graphic, url, shouldApply) {
    if (!img) return;
    const card = img.closest?.('.roulette-card') || document.getElementById('rouletteCard');
    if (url) {
        const stableUrl = isUsableImageUrl(url);
        if (!stableUrl) return;
        if (failedImageIds.has(stableUrl)) return;
        const preloader = new Image();
        preloader.onload = () => {
            if (shouldApply && !shouldApply()) return;
            img.onerror = null;
            img.src = stableUrl;
            img.style.display = 'block';
            img.style.opacity = '1';
            img.dataset.lastGoodImage = stableUrl;
            card?.classList.add('has-poster');
            if (graphic) graphic.style.display = 'none';
        };
        preloader.onerror = () => {
            if (shouldApply && !shouldApply()) return;
            failedImageIds.add(stableUrl);
            const lastGood = isUsableImageUrl(img.dataset?.lastGoodImage);
            if (lastGood) {
                img.src = lastGood;
                img.style.display = 'block';
                card?.classList.add('has-poster');
                if (graphic) graphic.style.display = 'none';
            } else {
                card?.classList.remove('has-poster');
                if (graphic) graphic.style.display = 'flex';
            }
        };
        preloader.src = stableUrl;
    } else {
        img.onerror = null;
        if (!isUsableImageUrl(img.dataset?.lastGoodImage)) {
            img.style.display = 'none';
            card?.classList.remove('has-poster');
            if (graphic) graphic.style.display = 'flex';
        }
    }
}

async function prepareInstallRoulettePool(pool, token, timeBudgetMs = 1600) {
    const start = Date.now();
    const candidates = Array.isArray(pool) ? pool : [];
    const missing = candidates.filter(g => !getRoulettePosterUrl(g, 'install'));

    let queued = 0;
    for (const c of missing) {
        if (queued >= _ROULETTE_HYDRATE_LIMIT) break;
        const raw = c._raw || c;
        if (!raw || raw._heroHydrated || raw._heroHydrating) continue;
        _suggHydrateArt(raw, null, false);
        queued++;
    }

    if (missing.length) {
        await new Promise(resolve => setTimeout(resolve, Math.min(650, timeBudgetMs)));
    }

    // ── Hero hydration pass: for each candidate still missing hero, attempt a
    //    fast disk-cache lookup and merge from _raw / _suggArtCache.
    //    This runs before the poster preload workers so the final winner object
    //    already has heroImage when _rouletteSetHeroBackground is called.
    for (const c of candidates) {
        if (token !== rouletteSpinToken) return [];
        if (_rouletteHeroUrl(c)) continue; // already resolved

        const raw = c._raw || c;

        // Merge any hero that arrived on _raw since the pool was built
        const rawHero = isUsableImageUrl(raw.heroImage || raw.defaultHero || raw.heroUrl || raw.background || null);
        if (rawHero && !c.heroImage) { c.heroImage = rawHero; continue; }

        // Merge from _suggArtCache
        const cacheKey  = _suggKey(raw.id ? raw : c);
        const cachedArt = (typeof _suggArtCacheGet === 'function') ? _suggArtCacheGet(cacheKey) : null;
        if (cachedArt && cachedArt.hero) {
            const heroUrl = isUsableImageUrl(cachedArt.hero);
            if (heroUrl) { c.heroImage = heroUrl; continue; }
        }

        // Try disk cache via electronAPI — best-effort, non-blocking
        if (window.electronAPI?.getCachedImage) {
            const id = raw.id || c.id;
            if (id && Date.now() - start < timeBudgetMs - 200) {
                const diskHero = await window.electronAPI.getCachedImage(id, 'hero').catch(() => null);
                if (diskHero) {
                    c.heroImage = diskHero;
                    if (typeof _suggArtCacheSet === 'function') _suggArtCacheSet(cacheKey, { hero: diskHero });
                }
            }
        }
    }

    const visuallyReady = [];
    const preloadLimit = 6;
    let idx = 0;

    async function worker() {
        while (idx < candidates.length && Date.now() - start < timeBudgetMs) {
            if (token !== rouletteSpinToken) return;
            const game = candidates[idx++];
            const posterUrl = getRoulettePosterUrl(game, 'install');
            if (!posterUrl) continue;
            const res = await preloadRouletteFinalPoster(posterUrl, Math.max(250, Math.min(700, timeBudgetMs - (Date.now() - start))));
            if (res.ok && res.url) {
                game._roulettePosterUrl = res.url;
                visuallyReady.push(game);
            }
        }
    }

    await Promise.all(Array.from({ length: Math.min(preloadLimit, candidates.length) }, () => worker()));
    return visuallyReady;
}

// ── Legacy stub — kept for reference only; not called by any live code ────────
async function _legacyStartRouletteUnused0() {
    if (isSpinning) return;

    if (!rouletteMode) {
        showToast('Choose a mode first — Play or Install!', 'error');
        return;
    }

    window.electronAPI.logGameSpinClicked?.(customSpinIds.length > 0);

    const posterMode = rouletteMode === 'play' ? 'installed' : 'install';
    let pool = rouletteMode === 'play' ? _buildPlayPool() : _buildInstallPool();
    const posterPool = pool.filter(g => getRoulettePosterUrl(g, posterMode));
    if (posterPool.length > 0) pool = posterPool;

    if (pool.length === 0) {
        if (rouletteMode === 'play') {
            showToast('No playable games found. Add games or clear the custom pool.', 'error');
        } else {
            showToast('No synced games available to install. Sync your accounts first!', 'error');
        }
        return;
    }

    isSpinning = true;
    const card    = document.getElementById('rouletteCard');
    const img     = document.getElementById('rouletteImg');
    const graphic = document.getElementById('rouletteGraphic');
    const nameTxt = document.getElementById('rouletteName');
    const spinBtn = document.getElementById('spinBtn');
    const playBtn = document.getElementById('playResultBtn');

    // Reset card click state
    card.classList.remove('winner');
    card.classList.add('spinning');

    // Start with the neutral graphic hidden behind the image — we'll toggle per-tick
    if (!isUsableImageUrl(img.dataset?.lastGoodImage)) {
        img.style.display = 'none';
        card.classList.remove('has-poster');
        if (graphic) graphic.style.display = 'flex';
    }

    spinBtn.disabled = true;
    spinBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="spin-anim"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.59-9.21l-3.25 1.64"></path></svg> Rolling...`;
    if (playBtn) playBtn.style.display = 'none';

    let spinsCount = 0;
    const maxSpins = 25;
    let speed = 40;
    let finalized = false;
    let spinTimeout = null;

    function roulettePosterFor(game) {
        return rouletteMode === 'install'
            ? _rouletteInstallImage(game)
            : (getGamePoster(game) || '../assets/default_hero.jpg');
    }

    function finalizeRoulette(finalGame) {
        if (finalized) return;
        finalized = true;
        if (spinTimeout) {
            clearTimeout(spinTimeout);
            spinTimeout = null;
        }

        console.log(`[Roulette] finalizing ${finalGame.id} ${finalGame.name}`);

        rouletteResultId   = finalGame.id;
        rouletteResultGame = finalGame;
        nameTxt.innerText  = finalGame.name;
        _rouletteShowImg(img, graphic, roulettePosterFor(finalGame), () => finalized && rouletteResultGame === finalGame);

        card.classList.remove('spinning');
        img.classList.remove('spinning');
        card.classList.add('winner');
        if (roulettePosterFor(finalGame)) card.classList.add('has-poster');

        if (rouletteMode === 'play' && finalGame.id) {
            card.dataset.rouletteWinnerId = String(finalGame.id);
            delete card.dataset.rouletteInstallPlatform;
        } else if (rouletteMode === 'install' && finalGame.id) {
            card.dataset.rouletteWinnerId = String(finalGame.id);
            card.dataset.rouletteInstallPlatform = String(finalGame._platform || finalGame._raw?._platform || '');
        } else {
            delete card.dataset.rouletteWinnerId;
            delete card.dataset.rouletteInstallPlatform;
        }

        spinBtn.disabled = false;
        spinBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.59-9.21l-3.25 1.64"></path></svg> Spin Again`;

        if (playBtn) {
            playBtn.style.display = 'flex';
            if (rouletteMode === 'install') {
                playBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/><polyline points="8 12 12 16 16 12"/><line x1="12" y1="3" x2="12" y2="16"/></svg> INSTALL`;
            } else {
                playBtn.innerHTML = `&#9654; PLAY NOW`;
            }
        }

        isSpinning = false;
        console.log('[Roulette] finalized; spinning=false');
    }

    function spinTick() {
        if (finalized) return;
        spinsCount++;

        if (spinsCount >= maxSpins) {
            const winner = pool[Math.floor(Math.random() * pool.length)];
            finalizeRoulette(winner);
            return;
        }

        const randomGame = pool[Math.floor(Math.random() * pool.length)];
        nameTxt.innerText = randomGame.name;
        console.log(`[Roulette] preview tick ${spinsCount}/${maxSpins} ${randomGame.name}`);
        _rouletteShowImg(img, graphic, roulettePosterFor(randomGame), () => !finalized);
        speed += Math.floor(spinsCount * 0.8);
        spinTimeout = setTimeout(spinTick, speed);
        return;

        if (false && rouletteMode === 'install') {
            // INSTALL: use enriched resolver — reads from candidate AND _raw
            // which may have been hydrated since pool was built
            const validUrl = _rouletteInstallImage(randomGame);
            _rouletteShowImg(img, graphic, validUrl);
        } else {
            // PLAY: try all art fields (hero preferred over cover)
            const url = getGamePoster(randomGame) || '../assets/default_hero.jpg';
            _rouletteShowImg(img, graphic, url);
        }

        if (spinsCount < maxSpins) {
            speed += Math.floor(spinsCount * 0.8);
            setTimeout(spinTick, speed);
        } else {
            const winner = pool[Math.floor(Math.random() * pool.length)];
            nameTxt.innerText = winner.name;
            rouletteResultId   = winner.id;
            rouletteResultGame = winner;

            // Show winner poster (or clean placeholder if invalid)
            if (rouletteMode === 'install') {
                _rouletteShowImg(img, graphic, _rouletteInstallImage(winner));
            } else {
                _rouletteShowImg(img, graphic, getGamePoster(winner) || '../assets/default_hero.jpg');
            }

            card.classList.remove('spinning');
            card.classList.add('winner');

            // Card click opens game details (play mode only — install games aren't in local DB)
            if (rouletteMode === 'play' && winner.id) {
                card.dataset.rouletteWinnerId = String(winner.id);
                delete card.dataset.rouletteInstallPlatform;
            } else if (rouletteMode === 'install' && winner.id) {
                card.dataset.rouletteWinnerId = String(winner.id);
                card.dataset.rouletteInstallPlatform = String(winner._platform || winner._raw?._platform || '');
            } else {
                delete card.dataset.rouletteWinnerId;
                delete card.dataset.rouletteInstallPlatform;
            }

            spinBtn.disabled = false;
            spinBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.59-9.21l-3.25 1.64"></path></svg> Spin Again`;

            // Label the action button based on mode
            if (playBtn) {
                playBtn.style.display = 'flex';
                if (rouletteMode === 'install') {
                    playBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/><polyline points="8 12 12 16 16 12"/><line x1="12" y1="3" x2="12" y2="16"/></svg> INSTALL`;
                } else {
                    playBtn.innerHTML = `&#9654; PLAY NOW`;
                }
            }

            isSpinning = false;
        }
    }

    spinTick();
}

// ── Result action (play or install depending on mode) ──────────
function preloadImageUrl(url, timeoutMs = 2500) {
    return new Promise(resolve => {
        const cleanUrl = isUsableImageUrl(url);
        if (!cleanUrl) return resolve({ ok: false, url: null });
        const img = new Image();
        let done = false;
        const finish = (ok) => {
            if (done) return;
            done = true;
            resolve({ ok, url: ok ? cleanUrl : null });
        };
        const t = setTimeout(() => finish(false), timeoutMs);
        img.onload = () => { clearTimeout(t); finish(true); };
        img.onerror = () => { clearTimeout(t); finish(false); };
        img.src = cleanUrl;
    });
}

function _rouletteApplyImageNow(img, graphic, url) {
    const cleanUrl = isUsableImageUrl(url);
    if (!img || !cleanUrl) return false;
    img.onerror = null;
    img.src = cleanUrl;
    img.style.display = 'block';
    img.style.opacity = '1';
    img.dataset.lastGoodImage = cleanUrl;
    img.closest?.('.roulette-card')?.classList.add('has-poster');
    if (graphic) graphic.style.display = 'none';
    return true;
}

function applyRouletteFinalPoster(finalGame, posterUrl) {
    const img = document.getElementById('rouletteImg');
    const graphic = document.getElementById('rouletteGraphic');
    const card = document.getElementById('rouletteCard');
    const gameId = _rouletteGameId(finalGame);
    const cleanUrl = isUsableImageUrl(posterUrl);

    card?.classList.remove('spinning', 'no-poster');
    card?.classList.add('winner');
    if (card) card.dataset.gameId = gameId;

    if (!img || !cleanUrl) {
        if (img) {
            img.onload = null;
            img.onerror = null;
            img.removeAttribute('src');
            img.style.display = 'none';
            img.style.opacity = '0';
            img.classList.remove('final-poster', 'spinning');
            img.dataset.gameId = gameId;
        }
        card?.classList.remove('has-poster');
        card?.classList.add('no-poster');
        if (graphic) graphic.style.display = 'flex';
        console.warn(`[Roulette] final poster missing; showing placeholder ${gameId}`);
        return false;
    }

    img.onload = null;
    img.onerror = null;
    img.classList.remove('spinning');
    img.classList.add('final-poster');
    img.dataset.gameId = gameId;
    img.src = cleanUrl;
    img.style.display = 'block';
    img.style.opacity = '1';
    img.style.objectFit = 'cover';
    img.style.objectPosition = 'center';
    img.dataset.lastGoodImage = cleanUrl;

    if (graphic) graphic.style.display = 'none';
    card?.classList.add('has-poster', 'winner');
    card?.classList.remove('no-poster');

    console.log(`[Roulette] final poster applied ${gameId} img.src=${img.src} dataset=${img.dataset.gameId}`);
    if (img.dataset.gameId !== gameId) {
        console.warn(`[Roulette] final visual mismatch expected=${gameId} dataset=${img.dataset.gameId}`);
    }
    return true;
}

function _rouletteHeroUrl(game) {
    if (!game) return null;
    const resolvedArt = _rouletteResolveArtwork(game, 'roulette-hero');
    return isUsableImageUrl(resolvedArt.hero?.value || null);
}

function resetRouletteVisualStateForSpin(card) {
    const section = document.getElementById('rouletteSection') ||
        document.getElementById('surpriseMeSection') ||
        document.querySelector('.roulette-section') ||
        document.querySelector('.surprise-me-section');
    section?.classList.remove('has-hero-bg');
    section?.style.removeProperty('--roulette-hero-bg');
    card?.classList.remove('winner', 'has-hero-bg', 'has-poster', 'no-poster');
    if (card) delete card.dataset.gameId;
    const img = document.getElementById('rouletteImg');
    const graphic = document.getElementById('rouletteGraphic');
    if (img) {
        img.onload = null;
        img.onerror = null;
        img.removeAttribute('src');
        img.style.display = 'none';
        img.style.opacity = '0';
        img.classList.remove('final-poster', 'spinning');
        delete img.dataset.gameId;
        delete img.dataset.lastGoodImage;
    }
    if (graphic) graphic.style.display = 'flex';
}

function _rouletteSetHeroBackground(game) {
    const heroUrl = _rouletteHeroUrl(game);
    const section = document.getElementById('rouletteSection') ||
        document.getElementById('surpriseMeSection') ||
        document.querySelector('.roulette-section') ||
        document.querySelector('.surprise-me-section');
    if (!heroUrl || !section) return;
    preloadImageUrl(heroUrl, 1800).then(res => {
        if (!res.ok || !res.url || rouletteResultGame !== game) return;
        section.style.setProperty('--roulette-hero-bg', `url("${res.url}")`);
        section.classList.add('has-hero-bg');
    });
}

function _rouletteGameId(game) {
    return String(game?.id || game?._raw?.id || '');
}

function _rouletteEntropySeed() {
    try {
        if (globalThis.crypto?.getRandomValues) {
            const values = new Uint32Array(4);
            globalThis.crypto.getRandomValues(values);
            return Array.from(values).join('-');
        }
    } catch {}
    const perfNow = typeof performance !== 'undefined' && performance.now ? performance.now() : 0;
    return `${Date.now()}-${perfNow}-${Math.random()}`;
}

function _rouletteShuffleForSpin(pool, seed) {
    return _seededShuffle(pool, `roulette_${seed}_${Math.random()}`);
}

function _roulettePickFinal(pool) {
    const recent = _rouletteRecentPicks.filter(Boolean);
    const recentSet = new Set(recent);
    let candidates = pool;
    const withoutRecent = pool.filter(g => !recentSet.has(_rouletteGameId(g)));
    if (withoutRecent.length >= 3) {
        candidates = withoutRecent;
        console.log(`[Roulette] avoiding recent picks ${recent.join(',')}`);
    } else if (pool.length > 1 && recent[recent.length - 1]) {
        const withoutImmediate = pool.filter(g => _rouletteGameId(g) !== recent[recent.length - 1]);
        if (withoutImmediate.length) candidates = withoutImmediate;
    }
    const picked = candidates[0] || pool[0];
    console.log(`[Roulette] picked ${_rouletteGameId(picked)} from ${candidates.length}`);
    return picked;
}

// ── Legacy stub — kept for reference only; not called by any live code ────────
function _legacyStartRouletteUnused1() {
    if (isSpinning) return;

    if (!rouletteMode) {
        showToast('Choose a mode first — Play or Install!', 'error');
        return;
    }

    window.electronAPI.logGameSpinClicked?.(customSpinIds.length > 0);

    let pool = rouletteMode === 'play' ? _buildPlayPool() : _buildInstallPool();
    const posterPool = pool.filter(g => rouletteMode === 'install' ? _rouletteInstallImage(g) : getGamePoster(g));
    if (posterPool.length > 0) pool = posterPool;

    if (pool.length === 0) {
        showToast(
            rouletteMode === 'play'
                ? 'No playable games found. Add games or clear the custom pool.'
                : 'No synced games available to install. Sync your accounts first!',
            'error'
        );
        return;
    }

    const seed = _rouletteEntropySeed();
    console.log(`[Roulette] random seed ${seed}`);
    pool = _rouletteShuffleForSpin(pool, seed);

    isSpinning = true;
    rouletteResultId = null;
    rouletteResultGame = null;
    const card    = document.getElementById('rouletteCard');
    const img     = document.getElementById('rouletteImg');
    const graphic = document.getElementById('rouletteGraphic');
    const nameTxt = document.getElementById('rouletteName');
    const spinBtn = document.getElementById('spinBtn');
    const playBtn = document.getElementById('playResultBtn');

    resetRouletteVisualStateForSpin(card);
    card?.classList.remove('winner');
    card?.classList.add('spinning');
    if (card) {
        delete card.dataset.rouletteWinnerId;
        delete card.dataset.rouletteInstallPlatform;
    }
    if (!isUsableImageUrl(img?.dataset?.lastGoodImage)) {
        if (img) img.style.display = 'none';
        card?.classList.remove('has-poster');
        if (graphic) graphic.style.display = 'flex';
    }

    if (spinBtn) {
        spinBtn.disabled = true;
        spinBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="spin-anim"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.59-9.21l-3.25 1.64"></path></svg> Rolling...`;
    }
    if (playBtn) playBtn.style.display = 'none';

    let spinsCount = 0;
    const maxSpins = 25;
    let speed = 40;
    let finalized = false;
    let spinTimeout = null;
    const posterMode = rouletteMode === 'play' ? 'installed' : 'install';
    const roulettePosterFor = (game) => getRoulettePosterUrl(game, posterMode);

    async function finalizeRoulette(finalGame) {
        if (finalized) return;
        finalized = true;
        if (spinTimeout) {
            clearTimeout(spinTimeout);
            spinTimeout = null;
        }

        const finalPoster = roulettePosterFor(finalGame);
        const expectedPoster = getRoulettePosterUrl(finalGame, posterMode);
        if (finalPoster !== expectedPoster) {
            console.warn(`[Roulette] final visual mismatch poster helper changed ${_rouletteGameId(finalGame)}`);
        }
        const finalPick = _roulettePosterPick(finalGame, posterMode);
        console.log(`[Roulette] final poster chosen ${_rouletteGameId(finalGame)} ${finalPick.source} ${finalPoster || ''}`);
        console.log(`[Roulette] final preload start ${_rouletteGameId(finalGame)} ${finalPoster || ''}`);
        const posterResult = await preloadImageUrl(finalPoster, 2500);
        console.log(`[Roulette] final preload ${posterResult.ok ? 'ok' : 'failed'} ${_rouletteGameId(finalGame)}`);
        console.log(`[Roulette] finalizing visual lock ${_rouletteGameId(finalGame)} ${finalGame.name}`);

        rouletteResultId   = finalGame.id;
        rouletteResultGame = finalGame;
        applyRouletteFinalPoster(finalGame, posterResult.ok ? posterResult.url : null);
        if (nameTxt) nameTxt.innerText = finalGame.name;

        card?.classList.remove('spinning');
        img?.classList.remove('spinning');
        card?.classList.add('winner');

        if (rouletteMode === 'play' && finalGame.id && card) {
            card.dataset.rouletteWinnerId = String(finalGame.id);
            delete card.dataset.rouletteInstallPlatform;
        } else if (rouletteMode === 'install' && finalGame.id && card) {
            card.dataset.rouletteWinnerId = String(finalGame.id);
            card.dataset.rouletteInstallPlatform = String(finalGame._platform || finalGame._raw?._platform || '');
        } else if (card) {
            delete card.dataset.rouletteWinnerId;
            delete card.dataset.rouletteInstallPlatform;
        }

        if (spinBtn) {
            spinBtn.disabled = false;
            spinBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.59-9.21l-3.25 1.64"></path></svg> Spin Again`;
        }
        if (playBtn) {
            playBtn.style.display = 'flex';
            playBtn.innerHTML = rouletteMode === 'install'
                ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/><polyline points="8 12 12 16 16 12"/><line x1="12" y1="3" x2="12" y2="16"/></svg> INSTALL`
                : `&#9654; PLAY NOW`;
        }

        const pickedId = _rouletteGameId(finalGame);
        if (pickedId) {
            _rouletteRecentPicks.push(pickedId);
            _rouletteRecentPicks = _rouletteRecentPicks.slice(-3);
        }
        _rouletteSetHeroBackground(finalGame);
        isSpinning = false;
        console.log('[Roulette] finalized; spinning=false');
    }

    function spinTick() {
        if (finalized) return;
        spinsCount++;
        if (spinsCount >= maxSpins) {
            finalizeRoulette(_roulettePickFinal(pool));
            return;
        }

        const randomGame = pool[Math.floor(Math.random() * pool.length)];
        if (nameTxt) nameTxt.innerText = randomGame.name;
        console.log(`[Roulette] preview tick ${spinsCount}/${maxSpins} ${randomGame.name}`);
        _rouletteShowImg(img, graphic, roulettePosterFor(randomGame), () => !finalized);
        speed += Math.floor(spinsCount * 0.8);
        spinTimeout = setTimeout(spinTick, speed);
    }

    spinTick();
}

function applyRoulettePreviewPoster(game, posterUrl, token) {
    if (token !== rouletteSpinToken) return false;
    const img = document.getElementById('rouletteImg');
    const graphic = document.getElementById('rouletteGraphic');
    const card = document.getElementById('rouletteCard');
    const clean = isUsableImageUrl(posterUrl);
    if (!img || !clean) {
        if (!isUsableImageUrl(img?.dataset?.lastGoodImage)) {
            if (img) img.style.display = 'none';
            if (graphic) graphic.style.display = 'flex';
            card?.classList.remove('has-poster');
        }
        return false;
    }

    img.onerror = () => {
        if (token !== rouletteSpinToken) return;
        console.warn('[Roulette] preview poster failed', _rouletteGameId(game), clean);
        const lastGood = isUsableImageUrl(img.dataset?.lastGoodImage);
        if (lastGood) {
            img.src = lastGood;
            img.style.display = 'block';
            card?.classList.add('has-poster');
            if (graphic) graphic.style.display = 'none';
        } else {
            img.style.display = 'none';
            card?.classList.remove('has-poster');
            if (graphic) graphic.style.display = 'flex';
        }
    };
    img.onload = null;
    img.src = clean;
    img.style.display = 'block';
    img.style.opacity = '1';
    img.style.objectFit = 'cover';
    img.style.objectPosition = 'center';
    img.dataset.lastGoodImage = clean;
    img.dataset.gameId = _rouletteGameId(game);
    card?.classList.add('has-poster');
    if (graphic) graphic.style.display = 'none';
    return true;
}

function preloadRouletteFinalPoster(url, timeoutMs = 800) {
    return preloadImageUrl(url, timeoutMs);
}

async function startRoulette() {
    if (isSpinning) return;

    if (!rouletteMode) {
        showToast('Choose a mode first — Play or Install!', 'error');
        return;
    }

    const token = ++rouletteSpinToken;
    rouletteState = 'spinning';
    isSpinning = true;
    rouletteResultId = null;
    rouletteResultGame = null;

    const card    = document.getElementById('rouletteCard');
    const img     = document.getElementById('rouletteImg');
    const nameTxt = document.getElementById('rouletteName');
    const spinBtn = document.getElementById('spinBtn');
    const playBtn = document.getElementById('playResultBtn');

    resetRouletteVisualStateForSpin(card);
    card?.classList.add('spinning');
    card?.classList.remove('winner');
    if (nameTxt) nameTxt.innerText = 'Rolling...';
    if (spinBtn) {
        spinBtn.disabled = true;
        spinBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="spin-anim"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.59-9.21l-3.25 1.64"></path></svg> Rolling...`;
    }
    if (playBtn) playBtn.style.display = 'none';

    window.electronAPI.logGameSpinClicked?.(customSpinIds.length > 0);

    const posterMode = rouletteMode === 'play' ? 'installed' : 'install';
    const originalPool = rouletteMode === 'play' ? _buildPlayPool() : _buildInstallPool();
    const posterPool = originalPool.filter(g => getRoulettePosterUrl(g, posterMode));
    let pool = posterPool.length > 0 ? posterPool : originalPool;
    console.log(`[Roulette] pool size=${originalPool.length} posterPool=${posterPool.length} mode=${posterMode}`);

    if (pool.length === 0) {
        rouletteState = 'idle';
        isSpinning = false;
        card?.classList.remove('spinning');
        if (spinBtn) {
            spinBtn.disabled = true;
            spinBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.59-9.21l-3.25 1.64"></path></svg> No games`;
        }
        showToast(
            rouletteMode === 'play'
                ? 'No playable games found. Add games or clear the custom pool.'
                : 'No synced games available to install. Sync your accounts first!',
            'error'
        );
        return;
    }

    if (rouletteMode === 'install') {
        pool = await prepareInstallRoulettePool(originalPool, token, 1800);
        if (token !== rouletteSpinToken) return;
        if (pool.length === 0) {
            rouletteState = 'idle';
            isSpinning = false;
            card?.classList.remove('spinning');
            if (spinBtn) {
                spinBtn.disabled = false;
                spinBtn.innerHTML = 'Surprise Me';
            }
            showToast('Preparing artwork, try again in a moment.', 'info');
            return;
        }
    }

    const seed = _rouletteEntropySeed();
    console.log(`[Roulette] random seed ${seed}`);
    pool = _rouletteShuffleForSpin(pool, seed);

    let previewTimer = null;
    let ticks = 0;
    const maxTicks = 25;
    let speed = 40;

    async function finalizeRoulette(finalGame) {
        if (token !== rouletteSpinToken) return;
        if (rouletteState === 'finalizing' || rouletteState === 'complete') return;
        rouletteState = 'finalizing';
        if (previewTimer) {
            clearTimeout(previewTimer);
            previewTimer = null;
        }

        try {
            const posterUrl = getRoulettePosterUrl(finalGame, posterMode);
            console.log(`[Roulette] final poster chosen ${_rouletteGameId(finalGame)} ${_roulettePosterPick(finalGame, posterMode).source} ${posterUrl || ''}`);
            const preload = await preloadRouletteFinalPoster(posterUrl, 800);
            console.log(`[Roulette] final poster preload ${preload.ok ? 'ok' : 'failed'} ${_rouletteGameId(finalGame)}`);
            applyRouletteFinalPoster(finalGame, preload.ok ? preload.url : (rouletteMode === 'install' ? posterUrl : null));

            rouletteResultId = finalGame.id;
            rouletteResultGame = finalGame;
            if (nameTxt) nameTxt.innerText = finalGame.name;

            card?.classList.remove('spinning');
            img?.classList.remove('spinning');
            card?.classList.add('winner');
            if (rouletteMode === 'play' && finalGame.id && card) {
                card.dataset.rouletteWinnerId = String(finalGame.id);
                delete card.dataset.rouletteInstallPlatform;
            } else if (rouletteMode === 'install' && finalGame.id && card) {
                card.dataset.rouletteWinnerId = String(finalGame.id);
                card.dataset.rouletteInstallPlatform = String(finalGame._platform || finalGame._raw?._platform || '');
            }

            if (playBtn) {
                playBtn.style.display = 'flex';
                playBtn.innerHTML = rouletteMode === 'install'
                    ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/><polyline points="8 12 12 16 16 12"/><line x1="12" y1="3" x2="12" y2="16"/></svg> INSTALL`
                    : `&#9654; PLAY NOW`;
            }

            const pickedId = _rouletteGameId(finalGame);
            if (pickedId) {
                _rouletteRecentPicks.push(pickedId);
                _rouletteRecentPicks = _rouletteRecentPicks.slice(-3);
            }
            _rouletteSetHeroBackground(finalGame);
        } catch (err) {
            console.error('[Roulette] finalize failed', err);
            if (finalGame && nameTxt) nameTxt.innerText = finalGame.name || 'Selected game';
            card?.classList.remove('spinning');
            card?.classList.add('winner');
            if (playBtn) playBtn.style.display = 'flex';
        } finally {
            if (token === rouletteSpinToken) {
                rouletteState = 'complete';
                isSpinning = false;
                if (spinBtn) {
                    spinBtn.disabled = false;
                    spinBtn.innerHTML = 'Spin Again';
                }
                console.log('[Roulette] finalized; spinning=false');
            }
        }
    }

    function spinTick() {
        if (token !== rouletteSpinToken || rouletteState !== 'spinning') return;
        ticks++;
        if (ticks >= maxTicks) {
            console.log('[Roulette] max ticks reached -> finalizing');
            finalizeRoulette(_roulettePickFinal(pool));
            return;
        }

        const previewGame = pool[Math.floor(Math.random() * pool.length)];
        const posterUrl = getRoulettePosterUrl(previewGame, posterMode);
        if (nameTxt) nameTxt.innerText = previewGame.name;
        const posterApplied = applyRoulettePreviewPoster(previewGame, posterUrl, token);
        console.log(`[Roulette] preview tick ${ticks}/${maxTicks} ${_rouletteGameId(previewGame)} poster=${posterApplied}`);

        speed += Math.floor(ticks * 0.8);
        console.log(`[Roulette] scheduling next tick speed=${speed}`);
        previewTimer = setTimeout(spinTick, speed);
    }

    spinTick();
}

function playRouletteResult() {
    if (!rouletteResultGame) return;

    if (rouletteMode === 'install') {
        // Build the normalized game object for the install picker.
        // _suggBuildGame only copies image/heroImage from the raw synced game —
        // it does NOT see the roulette-resolved fields (_roulettePosterUrl,
        // _rouletteHeroUrl, defaultImage, defaultHero, etc.) that were merged
        // onto rouletteResultGame during the spin.  Re-merge them here so the
        // install-picker modal can display the correct artwork.
        const src = rouletteResultGame;
        const raw = src._raw || src;
        const baseGame = (_suggBuildGame ? _suggBuildGame(raw) : { ...raw });

        // Carry every poster/hero alternative forward so _gdResolveInstallArtwork
        // in game-details.js can find the best available URL.
        const gameObj = {
            ...baseGame,
            // Poster alternatives (prefer already-resolved roulette URL)
            image:        baseGame.image       || src.image       || src._roulettePosterUrl || '',
            defaultImage: src.defaultImage     || raw.defaultImage || '',
            coverUrl:     src.coverUrl         || raw.coverUrl     || '',
            capsuleImage: src.capsuleImage     || raw.capsuleImage || '',
            boxArt:       src.boxArt           || raw.boxArt       || '',
            grid:         src.grid             || raw.grid         || '',
            _roulettePosterUrl: src._roulettePosterUrl || '',
            // Hero alternatives (prefer already-resolved roulette URL)
            heroImage:    baseGame.heroImage   || src.heroImage    || src._rouletteHeroUrl  || '',
            defaultHero:  src.defaultHero      || raw.defaultHero  || '',
            heroUrl:      src.heroUrl          || raw.heroUrl      || '',
            background:   src.background       || raw.background   || '',
            _rouletteHeroUrl: src._rouletteHeroUrl || '',
            // Keep _raw so _gdResolveInstallArtwork can deep-dive if needed
            _raw: raw,
            _platform: src._platform || raw._platform || baseGame.platform || '',
        };

        if (typeof window._gdOpenInstallPickerForGame === 'function') {
            window._gdOpenInstallPickerForGame(gameObj);
        } else {
            showToast('Install picker not available.', 'error');
        }
    } else {
        if (rouletteResultId) triggerLaunchSequence(rouletteResultId);
    }
}

// ── Card click: open game details for play-mode winner ─────────
function onRouletteCardClick() {
    const card = document.getElementById('rouletteCard');
    if (!card || !card.classList.contains('winner')) return;
    const winnerId = card.dataset.rouletteWinnerId;
    const installPlatform = card.dataset.rouletteInstallPlatform;
    if (installPlatform && winnerId && typeof window.suggViewDetails === 'function') {
        window.suggViewDetails(installPlatform, winnerId);
        return;
    }
    if (winnerId && typeof openGameDetails === 'function') openGameDetails(winnerId);
}

// ── Custom pool (play mode only) ───────────────────────────────
function openRoulettePool() {
    const list = document.getElementById('poolGamesList');
    list.innerHTML = '';
    document.getElementById('poolSearchInput').value = '';

    const games = Array.isArray(window.allGamesData) ? window.allGamesData : [];
    const availableGames = games.filter(g => !g.isHidden);
    if (availableGames.length === 0) return showToast('Your library is empty!', 'error');

    availableGames.forEach(g => {
        const isChecked = customSpinIds.includes(String(g.id)) ? 'checked' : '';
        const poolArtwork = _rouletteResolveArtwork(g, 'roulette-custom-pool');
        const poolCover = poolArtwork.cover?.value || '../assets/default_hero.jpg';
        const div = document.createElement('div');
        div.className = 'bin-item pool-item';
        div.setAttribute('data-name', g.name.toLowerCase());
        div.innerHTML = `
            <label class="custom-checkbox">
                <input type="checkbox" value="${g.id}" ${isChecked}>
                <span class="checkmark"></span>
            </label>
            <img src="${poolCover}" style="width:32px;height:32px;border-radius:6px;margin-right:12px;object-fit:cover; border: 1px solid #333;">
            <span style="flex-grow:1; color:#ddd; font-weight:500; font-size:0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${g.name}</span>
        `;
        list.appendChild(div);
    });

    document.getElementById('roulettePoolModal').classList.add('active');
}

function closeRoulettePool() {
    document.getElementById('roulettePoolModal').classList.remove('active');
}

function filterPoolList() {
    const term = document.getElementById('poolSearchInput').value.toLowerCase();
    document.querySelectorAll('.pool-item').forEach(item => {
        if (item.getAttribute('data-name').includes(term)) {
            item.style.display = 'flex';
        } else {
            item.style.display = 'none';
        }
    });
}

function saveRoulettePool() {
    const checks = document.querySelectorAll('#poolGamesList input[type="checkbox"]:checked');
    customSpinIds = Array.from(checks).map(c => c.value);
    closeRoulettePool();
    if (customSpinIds.length > 0) {
        showToast(`Custom pool saved! (${customSpinIds.length} games)`, 'success');
    } else {
        showToast('Custom pool cleared. Spinning from all games.', 'INFO');
    }
}

function clearRoulettePool() {
    document.querySelectorAll('#poolGamesList input[type="checkbox"]').forEach(c => c.checked = false);
    customSpinIds = [];
    closeRoulettePool();
    showToast('Custom pool cleared. Spinning from all games.', 'INFO');
}

// ── Window exports ────────────────────────────────────────────
window.setRouletteMode        = setRouletteMode;
window.startRoulette          = startRoulette;
window.playRouletteResult     = playRouletteResult;
window.onRouletteCardClick    = onRouletteCardClick;
window.openRoulettePool       = openRoulettePool;
window.closeRoulettePool      = closeRoulettePool;
window.filterPoolList         = filterPoolList;
window.saveRoulettePool       = saveRoulettePool;
window.clearRoulettePool      = clearRoulettePool;
// Helpers exposed for tests and internal cross-file calls
window._buildPlayPool         = _buildPlayPool;
window._buildInstallPool      = _buildInstallPool;
window.getRoulettePosterUrl   = getRoulettePosterUrl;
window.prepareInstallRoulettePool = prepareInstallRoulettePool;
