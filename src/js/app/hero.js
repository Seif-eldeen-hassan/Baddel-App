// ── Home Hero section ────────────────────────────────────────────────────────
// State and functions that drive the cinematic hero panel on the Home view.
// Loads before app.js; all bare-name references to app.js globals (allGamesData,
// playtimeData, isLaunching, checkBackgroundAssets, formatPlaytime, etc.) resolve
// at call time via the shared Global Declarative Environment Record.

let currentHeroGameId = null;
let currentHeroSlideshowInterval = null;

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
        updateHeroSection(recent[0].id);
    } else if (allGamesData.length > 0) {
        updateHeroSection(allGamesData[0].id);
    } else {
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

function updateHeroSection(gameId) {
    if (isLaunching) return;
    clearInterval(currentHeroSlideshowInterval);

    const game = allGamesData.find(g => String(g.id) === String(gameId));
    if (!game) return;
    currentHeroGameId = String(gameId);

    // Hydrate hero/logo from localStorage before reading the fields
    checkBackgroundAssets(game);

    const bgImg = document.getElementById('heroBg');
    const logoImg = document.getElementById('heroLogo');
    const titleTxt = document.getElementById('heroTitle');
    const statsDiv = document.getElementById('heroStats');
    const actionsDiv = document.querySelector('.hero-actions');
    const playBtn = document.getElementById('heroPlayBtn');
    const settingsBtn = document.getElementById('heroSettingsBtn');

    if (!bgImg || !logoImg) return;

    const heroArtwork = _heroSurfaceArtwork(game, 'home-hero');
    const rawBg = heroArtwork.hero?.value || heroArtwork.cover?.value || null;
    if (rawBg) {
        const sanitized = rawBg.replace(/\\/g, '/').replace(/'/g, "\\'");
        const probe = new Image();
        probe.onload = () => {
            if (currentHeroGameId !== String(gameId)) return;
            bgImg.style.backgroundImage = `url('${sanitized}')`;
        };
        probe.onerror = () => {
            if (currentHeroGameId !== String(gameId)) return;
            bgImg.style.backgroundImage = 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)';
        };
        probe.src = rawBg;
    } else {
        bgImg.style.backgroundImage = 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)';
    }

    if (heroArtwork.logo?.value) {
        logoImg.src = heroArtwork.logo.value; logoImg.style.display = 'block'; titleTxt.style.display = 'none';
    } else {
        logoImg.style.display = 'none'; titleTxt.innerText = game.name; titleTxt.style.display = 'block';
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
window.updateHeroForCollection = updateHeroForCollection;
window.triggerPlayFromHero     = triggerPlayFromHero;
window.openCurrentGameSettings = openCurrentGameSettings;
