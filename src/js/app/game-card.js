'use strict';

// ============================================================
// 3. CARD RENDERING & RECENTLY PLAYED
// Extracted from src/js/app.js — src/js/app/game-card.js
//
// Dependencies (loaded before this file):
//   domUtils.js          — escapeHtml, safeImageUrl
//   playtime.js          — formatPlaytime, formatLastPlayed
//   artwork-sync.js      — hydrateRecentHeroArtwork
//   launcher-actions.js  — triggerLaunchSequence
//   game-context-actions.js — showContextMenu, _toggleCardFavorite
//
// Runtime globals from app.js (accessed after DOMContentLoaded):
//   window.allGamesData  — full merged game list
//   playtimeData         — shared global from app.js
//   allCollections       — shared global from app.js
//   currentFilters       — shared global from app.js
//   currentView          — shared global from app.js
//   fetchMetadata        — shared global from app.js
//   checkBackgroundAssets — shared global from app.js
//   updateHeroSection    — shared global from hero.js
// ============================================================

function _jbiHasRealQualifiedSession(game, d) {
    const sessions =
        Array.isArray(d?.playSessions) ? d.playSessions :
        Array.isArray(game?.playSessions) ? game.playSessions :
        [];

    return sessions.some(s => s && s.qualified === true);
}

function _jbiGetRecentTimestamp(game) {
    const d = playtimeData?.[game.id] || {};

    // Best case: a confirmed qualified session timestamp
    const q = Number(d.lastQualifiedPlayed || game.lastQualifiedPlayed || 0);
    if (q > 0) return q;

    const sessions =
        Array.isArray(d.playSessions) ? d.playSessions :
        Array.isArray(game.playSessions) ? game.playSessions :
        [];

    const totalMinutes = Number(d.totalMinutes || game.totalPlaytime || 0);
    const lp = Number(d.lastPlayed || game.lastPlayed || 0);

    if (sessions.length > 0 && !_jbiHasRealQualifiedSession(game, d)) {
        // Exclude suspicious detections that accumulated no real playtime and have
        // no confirmed activity timestamp (prevents false-positive Jump Back In entries).
        if (totalMinutes <= 0 && lp <= 0) return 0;

        // A short but genuine session: use lastPlayed (set whenever countedMinutes > 0)
        // or the endedAt of the latest session that actually accumulated time.
        if (lp > 0) return lp;

        const latestCounted = sessions
            .filter(s => s && (s.countedMinutes > 0 || s.minutes > 0) && s.endedAt)
            .reduce((best, s) => (!best || s.endedAt > best.endedAt) ? s : best, null);

        return latestCounted ? Number(latestCounted.endedAt) : 0;
    }

    // Legacy fallback for data predating the qualified-session system
    return lp > 0 ? lp : 0;
}

function getRecentGames() {
    const playedGames = (window.allGamesData || []).filter(g => _jbiGetRecentTimestamp(g) > 0);

    return playedGames.sort((a, b) => {
        return _jbiGetRecentTimestamp(b) - _jbiGetRecentTimestamp(a);
    });
}

// ============================================================
// RECENT CARD RENDERER (dedicated — does not replace createGameCard)
// ============================================================

// Keep a ref to all recent games for filter functionality
let _currentRecentGames = [];

function filterRecentCards(btn, filter) {
    // Update active button
    document.querySelectorAll('.jbi-filter').forEach(b => b.classList.remove('jbi-filter--active'));
    btn.classList.add('jbi-filter--active');

    const grid = document.getElementById('recentGrid');
    if (!grid) return;

    const now = Date.now();
    const oneWeek = 7 * 24 * 60 * 60 * 1000;

    let filtered = _currentRecentGames;
    if (filter === 'week') {
        filtered = _currentRecentGames.filter(g => {
            const lp = playtimeData[g.id]?.lastPlayed;
            return lp && (now - lp) <= oneWeek;
        });
    }
    // 'unfinished' — show all (no completion data available); kept as UI affordance
    // If you add a game.completed field later, filter here.

    grid.innerHTML = '';
    filtered.forEach((game, i) => grid.appendChild(createRecentCard(game, i === 0)));
}

function renderRecentlyPlayed() {
    const grid = document.getElementById('recentGrid');
    const section = document.getElementById('recentlyPlayedSection');
    if (!grid || !section) return;

    const recent = getRecentGames().slice(0, 3);
    _currentRecentGames = recent;

    if (recent.length === 0 || currentView !== 'home') {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';
    grid.innerHTML = '';

    // Reset filter to "All" when re-rendering
    document.querySelectorAll('.jbi-filter').forEach(b => b.classList.remove('jbi-filter--active'));
    const allBtn = document.querySelector('.jbi-filter[data-filter="all"]');
    if (allBtn) allBtn.classList.add('jbi-filter--active');

    recent.forEach((game, i) => grid.appendChild(createRecentCard(game, i === 0)));
}

function _agFieldGameId(game) {
    return String(game?.id || game?.gameId || game?.slug || game?.title || '');
}

// Cross-ID playtime resolver. All Games synced entries have a platform-sync ID
// (e.g. Epic appName, Steam appid string) that may differ from the local installed
// DB record which owns the playtime data. This helper tries each identity field in
// priority order before falling back to an installed-match lookup.
// Returns { key, data, localGame } where data is the playtime record or null.
function _agResolvePlaytimeRecordForGame(game) {
    if (!game) return { key: null, data: null, localGame: null };
    const pd = typeof playtimeData !== 'undefined' ? playtimeData : {};

    const hit = (k) => {
        const key = k != null ? String(k) : null;
        return (key && pd[key]) ? { key, data: pd[key], localGame: null } : null;
    };

    const primaryId = _agFieldGameId(game);

    // Priorities 1–4: direct ID fields on the game object (no DOM access)
    const direct = hit(primaryId)
        || hit(game.installedId)
        || hit(game.localGameId)
        || (game.gameId !== primaryId ? hit(game.gameId) : null);
    if (direct) return direct;

    // Priority 5: installed-match lookup (browser-only; gracefully skipped in Node.js)
    if (typeof window !== 'undefined' && typeof window._agFindInstalledLocalMatch === 'function') {
        try {
            const localGame = window._agFindInstalledLocalMatch(game);
            if (localGame) {
                const fromRecord = hit(localGame.id);
                if (fromRecord) return { ...fromRecord, localGame };
                // Local match found but no playtime record yet — synthesize from localGame fields.
                const merged = {
                    totalMinutes:        Number(localGame.totalPlaytime || game.totalPlaytime || 0) || 0,
                    lastPlayed:          localGame.lastPlayed         ?? game.lastPlayed         ?? null,
                    lastQualifiedPlayed: localGame.lastQualifiedPlayed ?? game.lastQualifiedPlayed ?? null,
                    playSessions: Array.isArray(localGame.playSessions) ? localGame.playSessions
                                : Array.isArray(game.playSessions)     ? game.playSessions : [],
                };
                return { key: null, data: merged, localGame };
            }
        } catch {}
    }

    return { key: null, data: null, localGame: null };
}

function _agFieldPlaytimeMinutes(game) {
    const _pResolved = _agResolvePlaytimeRecordForGame(game);
    const _pMinutes = _pResolved.data?.totalMinutes;

    return Number(
        game?.playtime ||
        game?.totalPlaytime ||
        _pMinutes ||
        0
    ) || 0;
}

// Canonical last-played resolver. Returns the best available timestamp for a
// game using a priority chain that handles pre-fix data where lastPlayed was
// never written despite counted playtime existing. Uses the cross-ID resolver
// so synced All Games entries fall through to the local installed record.
function _agResolveLastPlayedTimestamp(game) {
    const _pResolved = _agResolvePlaytimeRecordForGame(game);
    const d = _pResolved.data || {};
    const localGame = _pResolved.localGame;

    if (d.lastQualifiedPlayed) return d.lastQualifiedPlayed;
    if (game?.lastQualifiedPlayed) return game.lastQualifiedPlayed;
    if (localGame?.lastQualifiedPlayed) return localGame.lastQualifiedPlayed;
    if (d.lastPlayed) return d.lastPlayed;
    if (game?.lastPlayed) return game.lastPlayed;
    if (localGame?.lastPlayed) return localGame.lastPlayed;

    const totalMinutes = Number(d.totalMinutes || game?.totalPlaytime || 0);
    const sessions = Array.isArray(d.playSessions) ? d.playSessions
                   : Array.isArray(game?.playSessions) ? game.playSessions
                   : [];

    // Latest session with counted playtime (endedAt or endTime)
    const latestCounted = sessions
        .filter(s => s && (s.countedMinutes > 0 || s.minutes > 0) && (s.endedAt || s.endTime))
        .reduce((best, s) => {
            if (!best) return s;
            const ts = s.endedAt || s.endTime;
            const bestTs = best.endedAt || best.endTime;
            return ts > bestTs ? s : best;
        }, null);
    if (latestCounted) return latestCounted.endedAt || latestCounted.endTime;

    // Last resort: any session timestamp when totalMinutes proves real activity
    if (totalMinutes > 0) {
        const latestAny = sessions
            .filter(s => s != null)
            .reduce((best, s) => {
                const ts = s.endedAt || s.endTime;
                if (!ts) return best;
                if (!best) return s;
                const bestTs = best.endedAt || best.endTime;
                return ts > bestTs ? s : best;
            }, null);
        if (latestAny) return latestAny.endedAt || latestAny.endTime;
    }

    return null;
}

function _agFieldLastPlayed(game) {
    const _pResolved = _agResolvePlaytimeRecordForGame(game);
    const d = _pResolved.data || {};
    const localGame = _pResolved.localGame;

    if (d.lastQualifiedPlayed) return d.lastQualifiedPlayed;
    if (game?.lastQualifiedPlayed) return game.lastQualifiedPlayed;
    if (localGame?.lastQualifiedPlayed) return localGame.lastQualifiedPlayed;
    if (d.lastPlayed) return d.lastPlayed;
    if (game?.lastPlayed) return game.lastPlayed;
    if (localGame?.lastPlayed) return localGame.lastPlayed;

    // Final fallback: latest session with counted time, used when the persistence
    // layer predates the lastPlayed-for-counted-sessions fix.
    const totalMinutes = Number(d.totalMinutes || game?.totalPlaytime || 0);
    if (totalMinutes > 0) {
        const sessions = Array.isArray(d.playSessions) ? d.playSessions
                       : Array.isArray(game?.playSessions) ? game.playSessions
                       : [];
        const latestCounted = sessions
            .filter(s => s && (s.countedMinutes > 0 || s.minutes > 0) && s.endedAt)
            .reduce((best, s) => (!best || s.endedAt > best.endedAt) ? s : best, null);
        if (latestCounted) return latestCounted.endedAt;
    }

    return null;
}

function _agFieldIsInstalled(game) {
    try {
        if (typeof _agIsInstalled === 'function') {
            return _agIsInstalled(game);
        }
    } catch {}

    return !!(
        game?.isInstalled ||
        game?.installVerified ||
        game?.path ||
        game?.command ||
        game?.launchCommand
    );
}

function _agFormatLastPlayedShort(value) {
    if (!value) return 'Never';

    try {
        if (typeof formatLastPlayed === 'function') {
            return formatLastPlayed(value);
        }
    } catch {}

    const t = Number(value);
    if (!t) return 'Never';

    const diffMs = Date.now() - t;
    const days = Math.floor(diffMs / 86400000);

    if (days <= 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;

    return `${Math.floor(days / 30)}mo ago`;
}

function _surfaceArtwork(game, surface, fallback = {}) {
    const root = typeof window !== 'undefined' ? window : globalThis;
    const adapter = root.BaddelGameSurfaceArtworkAdapter;
    const legacyCover = game?.image || game?.defaultImage || game?.coverUrl || game?.cover || game?.posterImage || fallback.cover || fallback.placeholder || null;
    const legacyHero = game?.heroImage || game?.defaultHero || game?.heroUrl || game?.hero || fallback.hero || null;
    const legacyLogo = game?.logo || game?.defaultLogo || game?.logoUrl || fallback.logo || null;
    if (!adapter || typeof adapter.resolveGameSurfaceArtwork !== 'function') {
        return {
            cover: { value: legacyCover, source: legacyCover ? 'legacy-fallback' : 'placeholder' },
            hero:  { value: legacyHero, source: legacyHero ? 'legacy-fallback' : 'placeholder' },
            logo:  { value: legacyLogo, source: legacyLogo ? 'legacy-fallback' : 'placeholder' },
        };
    }
    try {
        return adapter.resolveGameSurfaceArtwork({
            surface,
            game,
            placeholders: fallback.placeholder ? { cover: fallback.placeholder, hero: fallback.placeholder } : null,
        });
    } catch {
        return adapter.legacyGameSurfaceArtwork({
            game,
            placeholders: fallback.placeholder ? { cover: fallback.placeholder, hero: fallback.placeholder } : null,
        });
    }
}

function _agDecorateAllGamesCardFields(card, game) {
    if (!card || !game) return;

    // This createGameCard variant has no .game-card-img-wrap
    // so the overlay is attached directly to the card element.
    card.querySelector('.ag-card-display-overlay')?.remove();

    const title = game.title || game.name || 'Untitled';

    const playtimeMinutes = _agFieldPlaytimeMinutes(game);
    const lastPlayed = _agFieldLastPlayed(game);
    const isInstalled = _agFieldIsInstalled(game);

    const playtimeText = typeof formatPlaytime === 'function'
        ? formatPlaytime(playtimeMinutes)
        : `${playtimeMinutes}m`;

    const lastPlayedText = _agFormatLastPlayedShort(lastPlayed);

    const overlay = document.createElement('div');
    overlay.className = 'ag-card-display-overlay';

    overlay.innerHTML = `
        <div class="ag-card-display-title" title="${String(title).replace(/"/g, '&quot;')}">
            ${title}
        </div>

        <div class="ag-card-display-fields">
            <div class="ag-card-field ag-card-field-playtime" title="Playtime">
                <span class="ag-card-field-dot"></span>
                <span>${playtimeText}</span>
            </div>

            <div class="ag-card-field ag-card-field-lastPlayed" title="Last played">
                <span class="ag-card-field-dot"></span>
                <span>${lastPlayedText}</span>
            </div>

            <div class="ag-card-field ag-card-field-installed ${isInstalled ? 'is-installed' : 'is-not-installed'}" title="${isInstalled ? 'Installed' : 'Not installed'}">
                <span class="ag-card-field-dot"></span>
                <span>${isInstalled ? 'Installed' : 'Not installed'}</span>
            </div>
        </div>
    `;

    card.appendChild(overlay);
}

function createGameCard(game, isRecent = false) {
    const card = document.createElement('div');
    card.className = 'game-card';
    card.setAttribute('data-id', game.id);

    card.addEventListener('mouseenter', () => {
        if (currentFilters.collectionId === null && currentView === 'home') updateHeroSection(game.id);
    });

    const pData = playtimeData[game.id] || { totalMinutes: 0 };
    let timeStr = 'Not played';
    let playedClass = '';
    if (pData.totalMinutes > 0) {
        const h = Math.floor(pData.totalMinutes / 60);
        const m = pData.totalMinutes % 60;
        timeStr = h > 0 ? `${h}h ${m}m` : `${m}m`;
        playedClass = 'played';
    }

    let lastPlayedStr = '';
    const _gcResolvedTs = _agResolveLastPlayedTimestamp(game);
    if (_gcResolvedTs) {
        const d = new Date(_gcResolvedTs);
        lastPlayedStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    }

    const clockIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;
    const initials = ''; // placeholder kept for layout only — no text shown before image loads
    const transparentPixel = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";

    // ── Platform badge(s) ──────────────────────────────────────────
    // Prefer game.sources array if present; fall back to game.platform
    const PLAT_META = {
        steam:    { label: 'Steam',    color: '#66c0f4', icon: '../assets/Steam.png',    invert: false },
        epic:     { label: 'Epic',     color: '#ffffff', icon: '../assets/epic.svg',     invert: true  },
        ea:       { label: 'EA',       color: '#ff6b35', icon: '../assets/ea.png',       invert: false },
        riot:     { label: 'Riot',     color: '#ff4655', icon: '../assets/riot.png',     invert: false },
        ubisoft:  { label: 'Ubisoft',  color: '#00a8ff', icon: '../assets/Ubisoft_white.png',  invert: false },
        rockstar: { label: 'Rockstar', color: '#fcaf17', icon: '../assets/rockstar.png', invert: false },
        xbox:     { label: 'Xbox',     color: '#107c10', icon: '../assets/Xbox_one_logo.png',     invert: false },
        discord:  { label: 'Discord',  color: '#5865f2', icon: '../assets/discord.png',  invert: false },
        manual:   { label: 'Manual',   color: '#888888', icon: null,                    invert: false },
        gog:      { label: 'GOG',      color: '#a855f7', icon: '../assets/gog.png',      invert: false },
        battlenet:{ label: 'Battle.net',color:'#00aeff', icon: '../assets/battlenet.png',invert: false },
    };

    // ── Platform alias map ─────────────────────────────────────────
    // game.platform / game.sources can contain raw display strings like
    // "Epic Games" or "EA App". Normalize them to a canonical PLAT_META key.
    const PLAT_ALIAS = {
        'epic games':        'epic',
        'epicgames':         'epic',
        'ea app':            'ea',
        'ea games':          'ea',
        'origin':            'ea',
        'riot games':        'riot',
        'ubisoft connect':   'ubisoft',
        'ubisoft+':          'ubisoft',
        'rockstar games':    'rockstar',
        'rockstar launcher': 'rockstar',
        'xbox':              'xbox',
        'xbox / store':      'xbox',
        'xbox store':        'xbox',
        'ms store':          'xbox',
        'microsoft store':   'xbox',
        'store':             'xbox',
        'gog galaxy':        'gog',
        'battle.net':        'battlenet',
        'battlenet':         'battlenet',
        'blizzard':          'battlenet',
    };

    /**
     * Map any raw platform string → a canonical PLAT_META key.
     * Exact match first, then alias lookup, then the raw key as-is.
     */
    function normalizePlatformBadgeKey(src) {
        const raw = (src || '').toLowerCase().trim();
        if (PLAT_META[raw])  return raw;           // already a canonical key
        if (PLAT_ALIAS[raw]) return PLAT_ALIAS[raw]; // alias match
        return raw;                                // unknown — will fall through to dot
    }

    const rawSources = game.sources && Array.isArray(game.sources) && game.sources.length > 0
        ? game.sources
        : [game.platform || 'manual'];

    const MAX_BADGES = 3;
    const visibleSources = rawSources.slice(0, MAX_BADGES);
    const overflow = rawSources.length - MAX_BADGES;

    const badgesHTML = visibleSources.map(src => {
        const key = normalizePlatformBadgeKey(src);
        const meta = PLAT_META[key] || { label: src, color: '#888', icon: null, invert: false };
        const imgTag = meta.icon
            ? `<img src="${meta.icon}" alt="${meta.label}" class="plat-badge-img${meta.invert ? ' plat-badge-invert' : ''}" style="--plat-c:${meta.color}">`
            : `<span class="plat-badge-dot" style="background:${meta.color}"></span>`;
        return `<span class="plat-badge" style="--plat-c:${meta.color}" title="${meta.label}">${imgTag}</span>`;
    }).join('');

    const overflowBadge = overflow > 0
        ? `<span class="plat-badge plat-badge-more" title="${rawSources.slice(MAX_BADGES).join(', ')}">+${overflow}</span>`
        : '';

    // ── Installed Games cards: POSTER ONLY ──────────────────────────────────────
    // Priority: game.image → game.defaultImage → game.coverUrl → placeholder.
    // heroImage, defaultHero, logo, and defaultLogo are intentionally excluded
    // from the card visual — they are used only by the hero section and game
    // details page.  Using hero art here causes the broken hero+logo composition
    // after a rescan because hero survives even when the cover is not yet loaded.
    const legacyDisplayImg = game.image || game.defaultImage || game.coverUrl || transparentPixel;
    const cardArtwork = _surfaceArtwork(game, 'home-card', { cover: legacyDisplayImg, placeholder: transparentPixel });
    const displayImg = cardArtwork.cover?.value || transparentPixel;
    const hasRealPoster = displayImg !== transparentPixel;

    const favColl   = allCollections.find(c => c.id === 'fav_system_default');
    const isFav     = favColl?.gameIds?.includes(String(game.id)) || false;
    const favLabel  = isFav ? 'Remove from Favorites' : 'Add to Favorites';
    const favActive = isFav ? ' gc-fav-active' : '';

    const _eName = escapeHtml(game.name);
    const _eId   = escapeHtml(game.id);
    const _eImg  = safeImageUrl(displayImg);
    card.innerHTML = `
        <div class="placeholder-bg"></div>
        <img class="actual-img" src="${_eImg}" alt="${_eName}" onerror="this.style.opacity='0'">
        <div class="gc-grad-bottom"></div>
        <div class="gc-grad-top"></div>
        <div class="gc-platforms">${badgesHTML}${overflowBadge}</div>
        <button class="gc-fav-btn${favActive}" data-id="${_eId}" aria-label="${escapeHtml(favLabel)}" title="${escapeHtml(favLabel)}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
        </button>
        <div class="gc-drag-handle" title="Drag to reorder" aria-label="Drag to reorder">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <line x1="8" y1="6"  x2="16" y2="6"/>
                <line x1="8" y1="12" x2="16" y2="12"/>
                <line x1="8" y1="18" x2="16" y2="18"/>
            </svg>
        </div>
        <div class="gc-info">
            <div class="gc-name">${_eName}</div>
            <div class="gc-time ${playedClass}">${clockIcon} ${timeStr}</div>
            <div class="gc-lastplayed">${escapeHtml(lastPlayedStr) || 'Never'}</div>
        </div>
        <div class="play-btn-center" data-game-id="${_eId}">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
            <span style="margin-left: 2px;">PLAY</span>
        </div>
    `;

    card.querySelector('.play-btn-center').addEventListener('click', (e) => {
        e.stopPropagation();
        triggerLaunchSequence(game.id);
    });

    const imgEl = card.querySelector('.actual-img');

    // Show image via class once loaded (prevents black flash)
    imgEl.addEventListener('load', () => {
        imgEl.classList.add('img-loaded');
    }, { once: true });

    // If image is already cached and complete before listener was added
    if (imgEl.complete && imgEl.naturalWidth > 0) {
        imgEl.classList.add('img-loaded');
    }

    // Handle missing local images automatically
    imgEl.onerror = () => {
        imgEl.style.opacity = '0';
        // Local file path no longer exists — clear the cache and re-fetch
        if (game.image && game.image.startsWith('file://')) {
            console.log('Broken local cache detected, re-fetching:', game.name);
            game.image = null;
            localStorage.removeItem('cover_' + game.id);
            fetchMetadata(imgEl, game);
        }
    };

    if (game.image && game.image.startsWith('file://')) {
        // Local cached file — load instantly
        imgEl.src = game.image;
        checkBackgroundAssets(game);
    } else {
        // No image, or image is a remote http:// URL that may be blocked/expired
        // — go through fetchMetadata which handles disk cache + API fallback
        fetchMetadata(imgEl, game);
    }

    // Favorite heart — stop propagation so it doesn't open Game Details
    const favBtn = card.querySelector('.gc-fav-btn');
    if (favBtn) {
        favBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            _toggleCardFavorite(game.id);
        });
    }

    card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showContextMenu(e.pageX, e.pageY, game.id, game.name);
    });
    _agDecorateAllGamesCardFields(card, game);
    return card;
}

function _getRecentHeroCandidate(game) {
    if (!game) return null;
    const legacyHero = game.heroImage || game.defaultHero || game.heroUrl || game.hero || null;
    if (typeof _surfaceArtwork !== 'function') return legacyHero;
    const artwork = _surfaceArtwork(game, 'jump-back-in');
    return artwork.hero?.value || legacyHero;
}

function _getRecentPosterFallback(game) {
    if (!game) return null;
    const legacyPoster = game.image || game.defaultImage || game.coverUrl || game.cover || null;
    if (typeof _surfaceArtwork !== 'function') return legacyPoster;
    const artwork = _surfaceArtwork(game, 'jump-back-in');
    return artwork.cover?.value || legacyPoster;
}

function _getRecentDisplayImage(game) {
    return (
        _getRecentPosterFallback(game) ||
        _getRecentHeroCandidate(game) ||
        'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='
    );
}

// hydrateRecentHeroArtwork lives in src/js/app/artwork-sync.js

function createRecentCard(game, isFeatured = false) {
    const card = document.createElement('div');
    card.className = `jbi-card${isFeatured ? ' jbi-card--featured' : ''}`;
    card.setAttribute('data-id', game.id);
    card.setAttribute('data-last-played', playtimeData[game.id]?.lastPlayed || 0);
    card.setAttribute('data-playtime', playtimeData[game.id]?.totalMinutes || 0);

    const pData = playtimeData[game.id] || { totalMinutes: 0, lastPlayed: null };

    // Cover image — hero artwork first for the cinematic 16:9 look
    const displayImg = _getRecentDisplayImage(game);

    // Labels — use the resolver so pre-fix data with null lastPlayed still shows a date
    const lastPlayedLabel = formatLastPlayed(_agResolveLastPlayedTimestamp(game));
    const playtimeLabel   = formatPlaytime(pData.totalMinutes);

    // Progress bar heuristic (cap at 100%)
    const pct = Math.min(100, Math.max(5, pData.totalMinutes > 0 ? Math.min(100, (pData.totalMinutes / 6000) * 100) : 5));

    // Progress bar only on featured; shown narrower on smaller cards
    const progressWidth = isFeatured ? 'width:240px;max-width:100%' : 'width:100%';

    const _jbiName = escapeHtml(game.name);
    const _jbiImg  = safeImageUrl(displayImg);
    card.innerHTML = `
        <div class="jbi-cover">
            <div class="jbi-cover-placeholder"></div>
            <img class="jbi-cover-img" src="${_jbiImg}" alt="${_jbiName}" onerror="this.style.opacity='0'">
        </div>
        <div class="jbi-body">
            <span class="jbi-last-played">LAST PLAYED · ${escapeHtml(lastPlayedLabel)}</span>
            <div class="jbi-info-row">
                <div class="jbi-text">
                    <div class="jbi-name">${_jbiName}</div>
                </div>
            </div>
        </div>
        <button class="jbi-play-btn" title="Play ${_jbiName}">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        </button>
    `;

    card.querySelector('.jbi-play-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        console.log('[JumpBackIn] play clicked for', game.id);
        triggerLaunchSequence(game.id);
    });

    card.addEventListener('click', () => {
        console.log('[JumpBackIn] opening details for', game.id);
        const fn = (typeof openGameDetails === 'function') ? openGameDetails
                 : (typeof window.openGameDetails === 'function') ? window.openGameDetails
                 : null;
        if (fn) fn(game.id);
    });

    // Cover image load handling
    const imgEl = card.querySelector('.jbi-cover-img');
    imgEl.addEventListener('load', () => imgEl.classList.add('img-loaded'), { once: true });
    if (imgEl.complete && imgEl.naturalWidth > 0) imgEl.classList.add('img-loaded');

    // Hero-first hydration: use cached hero if available, otherwise hydrate in background
    const recentHero   = _getRecentHeroCandidate(game);
    const recentPoster = _getRecentPosterFallback(game);

    if (recentPoster) {
        imgEl.src = safeImageUrl(recentPoster);
        checkBackgroundAssets?.(game);
        hydrateRecentHeroArtwork(game, imgEl).catch(err => {
            console.warn('[JumpBackIn] hero hydration failed:', err);
        });
    } else if (recentHero) {
        imgEl.src = safeImageUrl(recentHero);
        checkBackgroundAssets?.(game);
    } else {
        hydrateRecentHeroArtwork(game, imgEl).catch(err => {
            console.warn('[JumpBackIn] hero hydration failed:', err);
        });
    }

    // Hero update on hover (same as createGameCard)
    card.addEventListener('mouseenter', () => {
        if (currentView === 'home') updateHeroSection(game.id);
    });

    // Context menu (same as createGameCard)
    card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showContextMenu(e.pageX, e.pageY, game.id, game.name);
    });

    return card;
}

function getPlatformClass(p) {
    p = (p || '').toLowerCase();
    if (p.includes('steam')) return 'ps';
    if (p.includes('epic')) return 'pe';
    if (p.includes('riot')) return 'pr';
    if (p.includes('ea')) return 'pea';
    if (p.includes('ubisoft')) return 'pu';
    if (p.includes('xbox')) return 'px';
    return 'pm';
}

// ============================================================
// Window exports — makes card helpers callable from other scripts
// ============================================================
window.getRecentGames                  = getRecentGames;
window.filterRecentCards               = filterRecentCards;
window.renderRecentlyPlayed            = renderRecentlyPlayed;
window._agDecorateAllGamesCardFields   = _agDecorateAllGamesCardFields;
window.createGameCard                  = createGameCard;
window.createRecentCard                = createRecentCard;
window.getPlatformClass                = getPlatformClass;
window._jbiHasRealQualifiedSession     = _jbiHasRealQualifiedSession;
window._jbiGetRecentTimestamp          = _jbiGetRecentTimestamp;
window._getRecentDisplayImage          = _getRecentDisplayImage;
window._agResolveLastPlayedTimestamp      = _agResolveLastPlayedTimestamp;
window._agResolvePlaytimeRecordForGame    = _agResolvePlaytimeRecordForGame;
window._agFieldPlaytimeMinutes            = _agFieldPlaytimeMinutes;
window._agFieldLastPlayed                 = _agFieldLastPlayed;
