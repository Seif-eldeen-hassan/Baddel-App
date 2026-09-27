// ── Home Hero section ────────────────────────────────────────────────────────
// State and functions that drive the cinematic hero panel on the Home view.
// Loads before app.js; all bare-name references to app.js globals (allGamesData,
// playtimeData, isLaunching, checkBackgroundAssets, formatPlaytime, etc.) resolve
// at call time via the shared Global Declarative Environment Record.

let currentHeroGameId = null;
let currentHeroSlideshowInterval = null;
let _homeHeroRequestToken = 0;
let _homeHeroPendingTimer = null;
let _homeHeroPendingId = null;
const _homeHeroPreloadCache = new Map();
const _HOME_HERO_PRELOAD_CACHE_MAX = 150;

function _heroSurfaceArtwork(game, surface = 'home-hero') {
    const adapter = window.BaddelGameSurfaceArtworkAdapter;
    if (!adapter || typeof adapter.resolveGameSurfaceArtwork !== 'function') {
        return {
            cover: { value: game?.image || game?.defaultImage || game?.coverUrl || null, source: 'legacy-fallback' },
            hero:  { value: game?.heroImage || game?.image || null, source: 'legacy-fallback' },
            logo:  { value: game?.logo || game?.defaultLogo || null, source: 'legacy-fallback' },
        };
    }
    try {
        return adapter.resolveGameSurfaceArtwork({ surface, game });
    } catch {
        return adapter.legacyGameSurfaceArtwork({ game });
    }
}

function applyHeroForHome() {
    const recent = getRecentGames();
    if (recent.length > 0) {
        if (typeof clearHomeLoadingState === 'function') clearHomeLoadingState();
        updateHeroSection(recent[0].id, { immediate: true, reason: 'apply-home' });
    } else if (allGamesData.length > 0) {
        if (typeof clearHomeLoadingState === 'function') clearHomeLoadingState();
        updateHeroSection(allGamesData[0].id, { immediate: true, reason: 'apply-home' });
    } else {
        const startupState = typeof _startupLibraryState === 'function' ? _startupLibraryState() : 'confirmed-empty';
        if (startupState === 'bootstrapping' || startupState === 'scanning') {
            if (typeof renderHomeLoadingState === 'function') renderHomeLoadingState();
            return;
        }
        if (startupState === 'scan-failed') {
            if (typeof renderHomeScanErrorState === 'function') renderHomeScanErrorState();
            return;
        }
        // Fallback: no games present — show gradient and hide hero controls
        const bgImg = document.getElementById('heroBg');
        const titleTxt = document.getElementById('heroTitle');
        if (bgImg) {
            bgImg.style.backgroundImage = `linear-gradient(to bottom, transparent 0%, #000000 100%), radial-gradient(rgba(255, 255, 255, 0.18) 1.5px, transparent 1.5px), linear-gradient(135deg, #0f0f0f 0%, #1a1a1a 100%)`;
            bgImg.style.backgroundSize = '100% 100%, 20px 20px, 100% 100%';
        }
        if (titleTxt) { titleTxt.innerText = 'No Games Found'; titleTxt.style.display = 'block'; }
        document.getElementById('heroLogo').style.display = 'none';
        document.getElementById('heroStats').style.display = 'none';
        document.getElementById('heroPlayBtn').style.display = 'none';
        document.getElementById('heroSettingsBtn').style.display = 'none';
    }
}

function _homeHeroRememberPreload(key, promise) {
    if (_homeHeroPreloadCache.has(key)) _homeHeroPreloadCache.delete(key);
    _homeHeroPreloadCache.set(key, promise);
    while (_homeHeroPreloadCache.size > _HOME_HERO_PRELOAD_CACHE_MAX) {
        const oldest = _homeHeroPreloadCache.keys().next().value;
        _homeHeroPreloadCache.delete(oldest);
    }
}

function _homeHeroPreloadImage(url) {
    const safe = safeImageUrl(url);
    if (!safe) return Promise.resolve({ ok: false, url: null });
    const cached = _homeHeroPreloadCache.get(safe);
    if (cached) return cached;
    const promise = new Promise(resolve => {
        const img = new Image();
        img.onload = () => resolve({ ok: true, url: safe });
        img.onerror = () => {
            failedImageIds?.add?.(safe);
            setTimeout(() => _homeHeroPreloadCache.delete(safe), 5000);
            resolve({ ok: false, url: safe });
        };
        img.src = safe;
    });
    _homeHeroRememberPreload(safe, promise);
    return promise;
}

function _homeHeroPickGame(gameId) {
    let game = allGamesData.find(g => String(g.id) === String(gameId));
    if (!game) return null;
    if (window.BaddelCanonicalArtworkProjection?.projectFromRecords) {
        game = window.BaddelCanonicalArtworkProjection.projectFromRecords(
            game,
            Array.isArray(window.__baddelCanonicalGames) ? window.__baddelCanonicalGames : []
        ) || game;
    }
    return game;
}

function _homeHeroArtworkFor(game) {
    const readModel = window.BaddelGameArtworkReadModel?.buildGameArtworkReadModel
        ? window.BaddelGameArtworkReadModel.buildGameArtworkReadModel({
            displayGame: game,
            canonicalGame: game,
            cacheArtwork: {
                cover: game?.__baddelResolvedLocalCover || null,
                hero: game?.__baddelResolvedLocalHero || null,
                logo: game?.__baddelResolvedLocalLogo || null,
            },
        })
        : null;
    const heroArtwork = _heroSurfaceArtwork(game, 'home-hero');
    const presentation = window.BaddelGameArtworkReadModel?.selectPresentationCandidates
        ? window.BaddelGameArtworkReadModel.selectPresentationCandidates(readModel, 'home-hero')
        : [];
    const cacheBacked = (value) => {
        if (typeof isCacheBackedArtworkUrl === 'function') return isCacheBackedArtworkUrl(value);
        const safe = safeImageUrl(value);
        return /^file:\/\//i.test(String(safe || '')) ? safe : null;
    };
    const localPresentation = presentation.map(cacheBacked).filter(Boolean);
    const localHero = cacheBacked(heroArtwork.hero?.value) || cacheBacked(game?.__baddelResolvedLocalHero);
    const localCover = cacheBacked(readModel?.cover?.effectiveValue) || cacheBacked(heroArtwork.cover?.value) || cacheBacked(game?.__baddelResolvedLocalCover);
    const localLogo = cacheBacked(readModel?.logo?.effectiveValue || heroArtwork.logo?.value);
    const selected = window.BaddelHomeArtworkPresentation?.selectHomeHeroArtwork?.(readModel) || null;
    return {
        readModel,
        heroArtwork,
        bg: safeImageUrl(cacheBacked(selected?.background) || localPresentation[0] || localHero || (readModel?.hero?.terminal === true ? localCover : null) || null),
        logo: safeImageUrl(cacheBacked(selected?.logo) || localLogo),
        heroPending: readModel?.hero?.pending === true,
        logoPending: readModel?.logo?.pending === true,
    };
}

function _homeHeroPrimeGameShell(game, gameId) {
    const bgImg = document.getElementById('heroBg');
    const logoImg = document.getElementById('heroLogo');
    const titleTxt = document.getElementById('heroTitle');
    const statsDiv = document.getElementById('heroStats');
    const actionsDiv = document.querySelector('.hero-actions');
    const playBtn = document.getElementById('heroPlayBtn');
    const settingsBtn = document.getElementById('heroSettingsBtn');
    if (!game || !titleTxt || !statsDiv || !playBtn) return;

    const art = _homeHeroArtworkFor(game);
    const immediateBg = safeImageUrl(art.bg);
    const immediateLogo = safeImageUrl(art.logo);
    if (bgImg && immediateBg && bgImg.dataset.lastGoodBg !== immediateBg) {
        const sanitized = immediateBg.replace(/\\/g, '/').replace(/'/g, "\\'");
        bgImg.style.backgroundImage = `url('${sanitized}')`;
    }

    if (logoImg && immediateLogo) {
        logoImg.onerror = null;
        if (logoImg.src !== immediateLogo) logoImg.src = immediateLogo;
        logoImg.style.display = 'block';
        titleTxt.innerText = game.name || '';
        titleTxt.style.display = 'none';
    } else {
        if (logoImg) logoImg.style.display = 'none';
        titleTxt.innerText = game.name || '';
        titleTxt.style.display = game.name ? 'block' : 'none';
    }

    const pData = playtimeData[game.id] || { totalMinutes: 0, lastPlayed: null };
    const heroLastPlayedTs = typeof _agResolveLastPlayedTimestamp === 'function'
        ? _agResolveLastPlayedTimestamp(game)
        : pData.lastPlayed;
    statsDiv.innerHTML = `
        <span class="stat-badge playtime-stat"><span id="heroPlaytime">${formatPlaytime(pData.totalMinutes)}</span></span>
        <span class="stat-badge">Last Played: <span id="heroLastPlayed">${formatLastPlayed(heroLastPlayedTs)}</span></span>
    `;
    statsDiv.style.display = 'flex';
    playBtn.style.display = 'block';
    playBtn.onclick = () => triggerLaunchSequence(gameId);

    if (settingsBtn) {
        settingsBtn.style.display = 'flex';
        settingsBtn.style.width = '48px';
        settingsBtn.style.height = '48px';
        settingsBtn.style.fontSize = '1.2rem';
        if (actionsDiv) actionsDiv.appendChild(settingsBtn);
        settingsBtn.onclick = () => openGameSettings(gameId);
    }
}

async function _homeHeroHydrateCachedArtwork(game, source = 'hero', options = {}) {
    if (!game) return { coverHit: false, heroHit: false, logoHit: false };
    let cached = null;
    if (window.__baddelResolveArtworkCacheBulk) {
        const bulk = await window.__baddelResolveArtworkCacheBulk([game], { types: options.types || ['cover', 'hero', 'logo'], surface: source || 'home-hero' }).catch(() => null);
        cached = bulk?.results?.get?.(String(game.id || '')) || null;
    }
    if (!cached && window.__baddelLoadCachedArtworkForGame) {
        const canonicalGame = { id: game.localGameId || game.installedId || game.id };
        cached = await window.__baddelLoadCachedArtworkForGame(game, canonicalGame, { types: options.types || ['cover', 'hero', 'logo'] }).catch(() => null);
    }
    const cover = typeof isCacheBackedArtworkUrl === 'function' ? isCacheBackedArtworkUrl(cached?.cover) : cached?.cover;
    const hero = typeof isCacheBackedArtworkUrl === 'function' ? isCacheBackedArtworkUrl(cached?.hero) : cached?.hero;
    const logo = typeof isCacheBackedArtworkUrl === 'function' ? isCacheBackedArtworkUrl(cached?.logo) : cached?.logo;
    if (cover) {
        game.__baddelResolvedLocalCover = cover;
        game.image = cover;
        game.defaultImage = cover;
        game.coverUrl = cover;
    }
    if (hero) {
        game.__baddelResolvedLocalHero = hero;
        game.heroImage = hero;
        game.defaultHero = hero;
        game.hero = hero;
    }
    if (logo) {
        game.__baddelResolvedLocalLogo = logo;
        game.logo = logo;
        game.defaultLogo = logo;
        game.logoUrl = logo;
    }
    try {
        console.info('[HomeHeroHydration]', {
            gameId: String(game.id || ''),
            coverHit: !!cover,
            heroHit: !!hero,
            logoHit: !!logo,
            source,
            committed: !!(cover || hero || logo),
        });
    } catch (_) {}
    return { coverHit: !!cover, heroHit: !!hero, logoHit: !!logo };
}

function _homeHeroCommit(payload) {
    const { token, gameId, game, bg, logo, heroLoaded } = payload || {};
    if (token !== _homeHeroRequestToken || currentHeroGameId !== String(gameId)) return;
    window.BaddelArtworkDiagnostics?.record?.('home-hero-commit-request', {
        canonicalIdentity: game?.localGameId || game?.id,
        provider: game?.platform,
        value: bg,
        logoValue: logo,
        generationToken: token,
        reason: heroLoaded ? 'decoded' : 'decode-miss',
    });
    const bgImg = document.getElementById('heroBg');
    const logoImg = document.getElementById('heroLogo');
    const titleTxt = document.getElementById('heroTitle');
    const statsDiv = document.getElementById('heroStats');
    const actionsDiv = document.querySelector('.hero-actions');
    const playBtn = document.getElementById('heroPlayBtn');
    const settingsBtn = document.getElementById('heroSettingsBtn');
    if (!bgImg || !logoImg) return;

    requestAnimationFrame(() => {
        if (token !== _homeHeroRequestToken || currentHeroGameId !== String(gameId)) return;
        const nextBg = bg || '';
        const nextLogo = logo || '';
        const unchangedBg = nextBg && bgImg.dataset.lastGoodBg === nextBg;
        const unchangedLogo = nextLogo && logoImg.src === nextLogo;
        if (heroLoaded && bg) {
            if (!unchangedBg) {
                const sanitized = bg.replace(/\\/g, '/').replace(/'/g, "\\'");
                bgImg.style.backgroundImage = `url('${sanitized}')`;
            }
            bgImg.dataset.lastGoodBg = bg;
        } else if (!bgImg.dataset.lastGoodBg && !bgImg.style.backgroundImage) {
            bgImg.style.backgroundImage = 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)';
        }

        if (logo) {
            logoImg.onerror = null;
            if (!unchangedLogo) logoImg.src = logo;
            logoImg.style.display = 'block';
            titleTxt.innerText = game.name;
            titleTxt.style.display = 'none';
        } else {
            logoImg.onerror = null;
            logoImg.style.display = 'none';
            titleTxt.innerText = game.name;
            titleTxt.style.display = 'block';
        }

        const pData = playtimeData[game.id] || { totalMinutes: 0, lastPlayed: null };
        const heroLastPlayedTs = typeof _agResolveLastPlayedTimestamp === 'function'
            ? _agResolveLastPlayedTimestamp(game)
            : pData.lastPlayed;
        statsDiv.innerHTML = `
            <span class="stat-badge playtime-stat"><span id="heroPlaytime">${formatPlaytime(pData.totalMinutes)}</span></span>
            <span class="stat-badge">Last Played: <span id="heroLastPlayed">${formatLastPlayed(heroLastPlayedTs)}</span></span>
        `;

        statsDiv.style.display = 'flex';
        playBtn.style.display = 'block';

        if (settingsBtn) {
            settingsBtn.style.display = 'flex';
            settingsBtn.style.width = '48px';
            settingsBtn.style.height = '48px';
            settingsBtn.style.fontSize = '1.2rem';
            actionsDiv.appendChild(settingsBtn);
            settingsBtn.onclick = () => openGameSettings(game.id);
        }

        playBtn.onclick = () => triggerLaunchSequence(game.id);
    });
}

function __baddelRequestHomeHeroTransition(gameId, options = {}) {
    const id = String(gameId || '');
    if (!id) return;
    if (!options.immediate && currentHeroGameId === id && _homeHeroPendingId === id) return;
    clearTimeout(_homeHeroPendingTimer);
    _homeHeroPendingId = id;
    const delay = options.immediate ? 0 : 120;
    _homeHeroPendingTimer = setTimeout(() => {
        _homeHeroPendingTimer = null;
        updateHeroSection(id, { ...options, fromController: true });
    }, delay);
}

function __baddelPrewarmExploreHeroArtwork(games) {
    const visible = (Array.isArray(games) ? games : []).slice(0, 8);
    if (window.__baddelExploreCoverHydrationController?.prewarmHeroArtwork) {
        window.__baddelExploreCoverHydrationController.prewarmHeroArtwork(visible, { reason: 'explore-hero-prewarm' });
        return;
    }
    const schedule = window.requestIdleCallback || ((fn) => setTimeout(fn, 50));
    schedule(() => {
        let index = 0;
        let active = 0;
        const pump = () => {
            while (active < 2 && index < visible.length) {
                const game = visible[index++];
                active += 1;
                Promise.resolve().then(async () => {
                    const artBefore = _homeHeroArtworkFor(game);
                    const hasHero = typeof isCacheBackedArtworkUrl === 'function' ? isCacheBackedArtworkUrl(artBefore.bg) : artBefore.bg;
                    const hasLogo = typeof isCacheBackedArtworkUrl === 'function' ? isCacheBackedArtworkUrl(artBefore.logo) : artBefore.logo;
                    if (!hasHero || !hasLogo) {
                        await _homeHeroHydrateCachedArtwork(game, 'explore-prewarm', { types: ['hero', 'logo'] });
                    }
                }).catch(() => {}).finally(() => {
                    active -= 1;
                    pump();
                });
            }
        };
        pump();
        for (const game of visible) {
            const art = _homeHeroArtworkFor(game);
            if (art.bg) _homeHeroPreloadImage(art.bg);
            if (art.logo) _homeHeroPreloadImage(art.logo);
        }
    });
}

async function updateHeroSection(gameId, options) {
    options = options || {};
    if (isLaunching) return;
    if (!options.fromController && options.hover === true) {
        __baddelRequestHomeHeroTransition(gameId, options);
        return;
    }
    clearInterval(currentHeroSlideshowInterval);

    let game = _homeHeroPickGame(gameId);
    if (!game) return;
    currentHeroGameId = String(gameId);
    const token = ++_homeHeroRequestToken;
    window.BaddelArtworkDiagnostics?.record?.('home-hero-selection', {
        canonicalIdentity: game?.localGameId || game?.id,
        provider: game?.platform,
        generationToken: token,
        reason: options.reason || 'update',
    });
    window.__baddelExploreCoverHydrationController?.prewarmHeroArtwork?.([game], {
        reason: options.reason === 'card-hover' ? 'interactive-hover' : (options.reason || 'home-hero'),
    });

    // Hydrate hero/logo from localStorage and cache aliases before reading the fields
    checkBackgroundAssets(game);
    _homeHeroPrimeGameShell(game, gameId);
    await _homeHeroHydrateCachedArtwork(game, options.reason || 'updateHeroSection', { types: ['cover', 'hero', 'logo'] });
    if (token !== _homeHeroRequestToken || currentHeroGameId !== String(gameId)) return;
    const art = _homeHeroArtworkFor(game);
    const [heroResult, logoResult] = await Promise.all([
        _homeHeroPreloadImage(art.bg),
        art.logo ? _homeHeroPreloadImage(art.logo) : Promise.resolve({ ok: false, url: null }),
    ]);
    _homeHeroCommit({
        token,
        gameId,
        game,
        bg: art.bg,
        logo: logoResult.ok ? art.logo : null,
        heroLoaded: heroResult.ok,
    });
}

function updateHeroForCollection(coll) {
    clearInterval(currentHeroSlideshowInterval);

    const bgImg = document.getElementById('heroBg');
    const logoImg = document.getElementById('heroLogo');
    const titleTxt = document.getElementById('heroTitle');
    const statsDiv = document.getElementById('heroStats');
    const playBtn = document.getElementById('heroPlayBtn');
    const settingsBtn = document.getElementById('heroSettingsBtn');

    if (!bgImg) return;

    let totalMins = 0;
    let validImages = [];
    let activeGamesCount = 0;

    if (coll.gameIds && coll.gameIds.length > 0) {
        coll.gameIds.forEach(id => {
            const g = allGamesData.find(x => String(x.id) === String(id));
            if (g) {
                activeGamesCount++;
                if (playtimeData[id]?.totalMinutes) totalMins += playtimeData[id].totalMinutes;
                const artwork = _heroSurfaceArtwork(g, 'collection-hero-member');
                if (artwork.hero?.value || artwork.cover?.value) validImages.push(artwork.hero?.value || artwork.cover?.value);
            }
        });
    }

    if (coll.image) {
        bgImg.style.backgroundImage = `url('${coll.image.replace(/\\/g, '/').replace(/'/g, "\\'")}')`;
        bgImg.style.backgroundSize = 'cover';
        bgImg.style.filter = 'none';
    } else if (validImages.length > 0) {
        let imgIndex = 0;
        const setBg = (idx) => {
            bgImg.style.backgroundImage = `url('${validImages[idx].replace(/\\/g, '/').replace(/'/g, "\\'")}')`;
            bgImg.style.backgroundSize = 'cover';
        };
        setBg(imgIndex);
        bgImg.style.filter = 'none';
        if (validImages.length > 1) {
            currentHeroSlideshowInterval = setInterval(() => {
                imgIndex = (imgIndex + 1) % validImages.length;
                setBg(imgIndex);
            }, 5000);
        }
    } else {
        bgImg.style.backgroundImage = `
            linear-gradient(to bottom, transparent 0%, #000000 100%),
            radial-gradient(rgba(255, 255, 255, 0.08) 1px, transparent 1px),
            linear-gradient(135deg, #0f0f0f 0%, #1a1a1a 100%)
        `;
        bgImg.style.backgroundSize = '100% 100%, 20px 20px, 100% 100%';
        bgImg.style.filter = 'none';
    }

    logoImg.style.display = 'none';
    titleTxt.innerText = coll.name || 'Favorites';
    titleTxt.style.display = 'block';

    statsDiv.innerHTML = `
        <span class="stat-badge playtime-stat"><span id="heroPlaytime">${formatPlaytime(totalMins)}</span></span>
        <span class="stat-badge">Total Games: <span id="heroLastPlayed">${activeGamesCount}</span></span>
    `;

    statsDiv.style.display = 'flex';
    playBtn.style.display = 'none';

    if (settingsBtn) {
        settingsBtn.style.display = 'flex';
        settingsBtn.style.width = '32px';
        settingsBtn.style.height = '32px';
        settingsBtn.style.fontSize = '1rem';
        settingsBtn.style.margin = '0';
        statsDiv.appendChild(settingsBtn);
        settingsBtn.onclick = () => openCollectionSettings(coll.id);
    }
}

function triggerPlayFromHero() {
    if (currentHeroGameId) triggerLaunchSequence(currentHeroGameId);
}

function openCurrentGameSettings() {
    if (currentHeroGameId) openGameSettings(currentHeroGameId);
}

// Explicit window exports so inline onclick handlers and cross-file typeof guards resolve correctly
window.applyHeroForHome        = applyHeroForHome;
window.updateHeroSection       = updateHeroSection;
window.__baddelRequestHomeHeroTransition = __baddelRequestHomeHeroTransition;
window.__baddelHomeHeroPreloadImage = _homeHeroPreloadImage;
window.__baddelPrewarmExploreHeroArtwork = __baddelPrewarmExploreHeroArtwork;
window.updateHeroForCollection = updateHeroForCollection;
window.triggerPlayFromHero     = triggerPlayFromHero;
window.openCurrentGameSettings = openCurrentGameSettings;
