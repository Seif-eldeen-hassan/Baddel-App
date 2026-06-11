// ============================================================
// BADDEL LAUNCHER - RENDERER (app.js)
// ============================================================

// ============================================================
// SPLASH SCREEN — Letterboxed cinematic loader (CSS-driven)
// No canvas needed — bars + meta handled via CSS transitions
// ============================================================
window._stopSplashCanvas = () => { /* no-op: no canvas in this version */ };

// ============================================================
// SPLASH AUDIO — Cinematic swell, 2-3 seconds.
// Built entirely with Web Audio oscillators + reverb convolution.
// First launch: full orchestral-style pad swell
// Return visit:  short soft chord bloom
// ============================================================
function playSplashSound() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();

        const isFirst = !localStorage.getItem('baddel_launched_before');
        if (isFirst) localStorage.setItem('baddel_launched_before', '1');

        const master = ctx.createGain();
        master.gain.setValueAtTime(0, ctx.currentTime);
        master.connect(ctx.destination);

        // ── Shared reverb tail (convolution via noise impulse) ──
        function makeReverb(duration, decay) {
            const len  = ctx.sampleRate * duration;
            const buf  = ctx.createBuffer(2, len, ctx.sampleRate);
            for (let c = 0; c < 2; c++) {
                const d = buf.getChannelData(c);
                for (let i = 0; i < len; i++) {
                    d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
                }
            }
            const conv = ctx.createConvolver();
            conv.buffer = buf;
            return conv;
        }
        const reverb = makeReverb(2.8, 2.2);
        const reverbGain = ctx.createGain();
        reverbGain.gain.setValueAtTime(0.42, ctx.currentTime);
        reverb.connect(reverbGain);
        reverbGain.connect(master);

        // ── Helper: single sine voice with slow attack & release ──
        function voice(freq, startAt, attackDur, holdDur, releaseDur, peakGain) {
            const osc  = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, ctx.currentTime + startAt);
            gain.gain.setValueAtTime(0, ctx.currentTime + startAt);
            gain.gain.linearRampToValueAtTime(peakGain, ctx.currentTime + startAt + attackDur);
            gain.gain.setValueAtTime(peakGain, ctx.currentTime + startAt + attackDur + holdDur);
            gain.gain.linearRampToValueAtTime(0, ctx.currentTime + startAt + attackDur + holdDur + releaseDur);
            osc.connect(gain);
            gain.connect(master);  // dry
            gain.connect(reverb);  // wet
            const stopAt = ctx.currentTime + startAt + attackDur + holdDur + releaseDur + 0.05;
            osc.start(ctx.currentTime + startAt);
            osc.stop(stopAt);
        }

        // ── Soft noise breath — the "air" that opens the scene ──
        function breathLayer(startAt, duration, peakGain, hpfFreq) {
            const bufLen = ctx.sampleRate * duration;
            const buf    = ctx.createBuffer(1, bufLen, ctx.sampleRate);
            const data   = buf.getChannelData(0);
            for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
            const src  = ctx.createBufferSource();
            const hpf  = ctx.createBiquadFilter();
            const lpf  = ctx.createBiquadFilter();
            const gain = ctx.createGain();
            hpf.type = 'highpass'; hpf.frequency.value = hpfFreq;
            lpf.type = 'lowpass';  lpf.frequency.value = hpfFreq * 3.5;
            src.buffer = buf;
            gain.gain.setValueAtTime(0, ctx.currentTime + startAt);
            gain.gain.linearRampToValueAtTime(peakGain, ctx.currentTime + startAt + duration * 0.35);
            gain.gain.linearRampToValueAtTime(0, ctx.currentTime + startAt + duration);
            src.connect(hpf); hpf.connect(lpf); lpf.connect(gain); gain.connect(reverb);
            src.start(ctx.currentTime + startAt);
            src.stop(ctx.currentTime + startAt + duration + 0.05);
        }

        if (isFirst) {
            // ── FIRST LAUNCH: full cinematic swell (~2.8s) ──────────
            // Root chord: Cm — C3 · Eb3 · G3 · Bb3 (film score "epic minor")
            // Then resolves up a 5th — feels like "opening"

            // Air breath — enters first, sets the space
            breathLayer(0.0, 2.6, 0.06, 800);

            // Bass foundation — slow bloom
            voice(65.41,  0.00, 0.55, 0.80, 1.20, 0.28);  // C2
            voice(130.81, 0.05, 0.50, 0.85, 1.10, 0.22);  // C3

            // Chord tones — staggered entry, feels like strings coming in
            voice(155.56, 0.10, 0.55, 0.90, 1.00, 0.18);  // Eb3
            voice(196.00, 0.18, 0.52, 0.90, 1.00, 0.18);  // G3
            voice(233.08, 0.28, 0.50, 0.85, 0.95, 0.14);  // Bb3

            // Upper register — shimmer layer (2 octaves up, very soft)
            voice(261.63, 0.30, 0.60, 0.70, 1.00, 0.08);  // C4
            voice(392.00, 0.38, 0.55, 0.65, 0.95, 0.06);  // G4

            // Resolution tone — a 5th above root, arrives late, lifts the feeling
            voice(293.66, 0.65, 0.65, 0.60, 1.10, 0.10);  // D4 (brightens)
            voice(391.99, 0.70, 0.60, 0.55, 1.00, 0.07);  // G4

            // Master envelope — slow in, hold, slow out
            master.gain.setValueAtTime(0, ctx.currentTime);
            master.gain.linearRampToValueAtTime(0.70, ctx.currentTime + 0.40);
            master.gain.setValueAtTime(0.70, ctx.currentTime + 1.80);
            master.gain.linearRampToValueAtTime(0, ctx.currentTime + 2.90);

        } else {
            // ── RETURN VISIT: short 2-voice chord bloom (~1.4s) ──────
            breathLayer(0.0, 1.2, 0.04, 1000);

            voice(130.81, 0.00, 0.30, 0.45, 0.55, 0.22);  // C3
            voice(196.00, 0.05, 0.30, 0.45, 0.55, 0.18);  // G3
            voice(261.63, 0.10, 0.28, 0.40, 0.50, 0.12);  // C4

            master.gain.setValueAtTime(0, ctx.currentTime);
            master.gain.linearRampToValueAtTime(0.60, ctx.currentTime + 0.25);
            master.gain.setValueAtTime(0.60, ctx.currentTime + 0.80);
            master.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.45);
        }

    } catch (e) {
        console.warn('[Baddel] Audio init failed:', e);
    }
}

// SPLASH ANIMATION — Letterboxed cinematic sequence
// ============================================================
function runSplash() {
    playSplashSound();

    // ── Element refs ────────────────────────────────────
    const canvas    = document.getElementById('splashCanvas');
    const scanLine  = document.getElementById('splashScan');
    const corners   = document.querySelectorAll('.splash-corner');
    const hudTop    = document.getElementById('splashHudTop');
    const hudBot    = document.getElementById('splashHudBot');
    const hudClock  = document.getElementById('splashHudClock');
    const frameEl   = document.getElementById('splashFrameCounter');
    const logoWrap  = document.getElementById('splashLogoImg');
    const name      = document.getElementById('splashName');
    const sub       = document.getElementById('splashSub');
    const statusRow = document.getElementById('splashStatus');
    const statusTxt = document.getElementById('splashStatusText');
    const bar       = document.getElementById('splashProgressBar');

    if (!name) return;

    // ── Particle canvas ─────────────────────────────────
    if (canvas) {
        const ctx = canvas.getContext('2d');
        const W   = canvas.width  = canvas.offsetWidth  || window.innerWidth;
        const H   = canvas.height = canvas.offsetHeight || window.innerHeight;
        const particles = Array.from({ length: 85 }, () => ({
            x: Math.random() * W, y: Math.random() * H,
            r: Math.random() * 1.2 + 0.3,
            vx: (Math.random() - 0.5) * 0.18,
            vy: (Math.random() - 0.5) * 0.18,
            alpha: Math.random() * 0.32 + 0.05,
            phase: Math.random() * Math.PI * 2,
        }));

        let rafId;
        function drawParticles(t) {
            ctx.clearRect(0, 0, W, H);
            particles.forEach(p => {
                p.x = (p.x + p.vx + W) % W;
                p.y = (p.y + p.vy + H) % H;
                const pulse = 0.6 + 0.4 * Math.sin(t * 0.0008 + p.phase);
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(255,255,255,${p.alpha * pulse})`;
                ctx.fill();
            });
            rafId = requestAnimationFrame(drawParticles);
        }
        window._splashRafId = rafId;
        setTimeout(() => {
            canvas.classList.add('visible');
            drawParticles(0);
        }, 120);
    }

    // ── Scan line sweep ─────────────────────────────────
    if (scanLine) {
        setTimeout(() => {
            const H = window.innerHeight;
            scanLine.style.opacity = '1';
            scanLine.style.transition = 'top 0.9s cubic-bezier(.4,0,.6,1)';
            scanLine.style.top = '0px';
            requestAnimationFrame(() => requestAnimationFrame(() => {
                scanLine.style.top = H + 'px';
                setTimeout(() => {
                    scanLine.style.opacity = '0';
                    scanLine.style.top = '-2px';
                    scanLine.style.transition = 'none';
                }, 960);
            }));
        }, 200);
    }

    // ── Corners ─────────────────────────────────────────
    setTimeout(() => {
        corners.forEach(c => c.classList.add('visible'));
    }, 350);

    // ── HUD top ──────────────────────────────────────────
    setTimeout(() => {
        if (hudTop) hudTop.classList.add('visible');
        if (hudClock) {
            const tick = () => {
                const now = new Date();
                hudClock.textContent = [now.getHours(), now.getMinutes(), now.getSeconds()]
                    .map(n => String(n).padStart(2, '0')).join(':');
            };
            tick();
            window._splashClockInterval = setInterval(tick, 1000);
        }
    }, 400);

    // ── HUD bottom + frame counter ───────────────────────
    setTimeout(() => {
        if (hudBot) hudBot.classList.add('visible');
        if (frameEl) {
            let f = 0;
            window._splashCounterInterval = setInterval(() => {
                f++;
                frameEl.textContent = String(f).padStart(2, '0');
                if (f >= 120) clearInterval(window._splashCounterInterval);
            }, 33);
        }
    }, 480);

    // ── Logo ring + logo ─────────────────────────────────
    setTimeout(() => {
        if (logoWrap) logoWrap.classList.add('visible');
    }, 550);

    // ── Name wipe ────────────────────────────────────────
    setTimeout(() => {
        name.classList.add('visible');
    }, 1100);

    // ── Tagline ──────────────────────────────────────────
    setTimeout(() => {
        if (sub) sub.classList.add('visible');
    }, 1500);

    // ── Status row + cycle ───────────────────────────────
    setTimeout(() => {
        if (statusRow) statusRow.classList.add('visible');
        if (statusTxt) {
            const messages = ['INITIALIZING', 'LOADING LIBRARIES', 'SYNCING LAUNCHERS', 'READY'];
            let idx = 0;
            const iv = setInterval(() => {
                idx++;
                statusTxt.style.opacity = '0';
                setTimeout(() => {
                    statusTxt.textContent = messages[idx];
                    statusTxt.style.opacity = '1';
                }, 180);
                if (idx >= messages.length - 1) clearInterval(iv);
            }, 800);
        }
    }, 1700);

    // ── Progress bar fills over 3s ───────────────────────
    setTimeout(() => {
        if (bar) {
            bar.style.transition = 'width 3s cubic-bezier(.4,0,.15,1)';
            bar.style.width = '100%';
        }
    }, 800);
}

// ---- State ----
let allGamesData = [];
window.allGamesData = allGamesData; // expose to accounts.js from the start
let allCollections = [];
// selectedGameId moved to src/js/app/game-context-actions.js
let tempImagePath = null;
let isEditingMode = false;

let activeHoverId = null;
// isLaunching moved to src/js/app/launcher-actions.js
// currentHeroGameId moved to src/js/app/hero.js
let currentFilters = { collectionId: null, platform: 'all', search: '', sort: 'manual' };
// ============================================================
// INSTALLED GAMES FILTER STATE
// يحفظ فلاتر Installed مستقلة عن Home / Collections
// ============================================================

const IG_PLATFORM_LABELS = {
    all: 'All Platforms',
    steam: 'Steam',
    epic: 'Epic Games',
    riot: 'Riot Games',
    ubisoft: 'Ubisoft',
    ea: 'EA App',
    xbox: 'Xbox / Store',
    manual: 'Manual',
};

const IG_SORT_LABELS = {
    manual: 'Custom Order',
    name: 'Alphabetical (A–Z)',
    playtime: 'Highest Playtime',
    last_played: 'Recently Played',
};

let _igSavedFilters = {
    platform: 'all',
    search: '',
    sort: 'manual',
};

function _igSaveFilterState() {
    if (typeof currentFilters === 'undefined') return;

    // نحفظ فقط حالة Installed الحقيقية، مش Collection/Favorites
    if (currentView !== 'installed') return;

    _igSavedFilters = {
        platform: currentFilters.platform || 'all',
        search: currentFilters.search || '',
        sort: currentFilters.sort || 'manual',
    };
}

function _igSyncFilterUiFromState() {
    const searchInput = document.getElementById('searchInput');
    if (searchInput) searchInput.value = currentFilters.search || '';

    const platformLabel = document.getElementById('igSelectedPlatformText');
    if (platformLabel) {
        platformLabel.textContent = IG_PLATFORM_LABELS[currentFilters.platform || 'all'] || 'All Platforms';
    }

    const sortLabel = document.getElementById('igSortLabel');
    if (sortLabel) {
        sortLabel.textContent = IG_SORT_LABELS[currentFilters.sort || 'manual'] || 'Custom Order';
    }

    document.querySelectorAll('.ig-sort-item').forEach(item => {
        item.classList.toggle('active', item.dataset.value === (currentFilters.sort || 'manual'));
    });

    if (typeof igUpdateSearchClear === 'function') {
        igUpdateSearchClear();
    }
}

function _igRestoreFilterState() {
    if (typeof currentFilters === 'undefined') return;

    currentFilters.collectionId = null;
    currentFilters.platform = _igSavedFilters.platform || 'all';
    currentFilters.search = _igSavedFilters.search || '';
    currentFilters.sort = _igSavedFilters.sort || 'manual';

    _igSyncFilterUiFromState();
}
// View state: 'home' | 'installed' | 'collection'
let currentView = 'home';
let exploreCarouselOffset = 0;
const EXPLORE_PAGE_SIZE = 12;

const imageQueue = [];
let activeRequests = 0;
let isScanning = false;

let playtimeData = {};
// currentHeroSlideshowInterval moved to src/js/app/hero.js
// currentEditingCollectionId moved to src/js/app/collections.js
let customSpinIds = [];

// ============================================================
// PLAYTIME SYSTEM — wrappers delegating to window.BaddelPlaytime
// Full implementations live in src/js/app/playtime.js.
// ============================================================
function buildPlaytimeCache(games) {
    playtimeData = window.BaddelPlaytime.buildPlaytimeCache(games);
}

async function savePlaytimeData(gameId, playedMinutes) {
    return window.BaddelPlaytime.savePlaytimeData(
        { playtimeData, allGamesData }, gameId, playedMinutes
    );
}

function formatPlaytime(minutes) {
    return window.BaddelPlaytime.formatPlaytime(minutes);
}

function formatLastPlayed(timestamp) {
    return window.BaddelPlaytime.formatLastPlayed(timestamp);
}

async function migratePlaytimeFromLocalStorage() {
    return window.BaddelPlaytime.migratePlaytimeFromLocalStorage({ playtimeData });
}

// ============================================================
// 1. SYSTEM STARTUP & NAVIGATION
// ============================================================
async function initSystem() {
    // Dev-only font readiness check — gated on NODE_ENV so it is silent in production
    if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') {
        document.fonts.ready.then(() => {
            console.debug('[Font] BaddelInter loaded:', document.fonts.check('16px BaddelInter'));
        });
    }

    // Minimum time the splash stays visible — ensures animation plays fully
    // even when data loads instantly (cached / fast machine).
    const SPLASH_MIN_MS = 3200;
    const splashStart   = Date.now();

    function hideSplash(loader, grid) {
        const elapsed   = Date.now() - splashStart;
        const remaining = Math.max(0, SPLASH_MIN_MS - elapsed);
        setTimeout(() => {
            if (loader) {
                loader.style.opacity = '0';
                setTimeout(() => {
                    loader.classList.remove('active');
                    loader.style.visibility    = 'hidden';
                    loader.style.pointerEvents = 'none';
                    if (typeof window._stopSplashCanvas === 'function') window._stopSplashCanvas();
                    if (window._splashCounterInterval) { clearInterval(window._splashCounterInterval); window._splashCounterInterval = null; }
                    if (typeof initAnalyticsConsent === 'function') initAnalyticsConsent();
                }, 500);
            }
            if (grid) grid.style.display = 'grid';
        }, remaining);
    }

    try {
        const loader = document.getElementById('mainLoader');
        const grid   = document.getElementById('gamesGrid');

        if (loader) loader.classList.add('active');
        if (grid)   grid.style.display = 'none';

        // Trigger the new splash animation
        if (typeof runSplash === 'function') runSplash();

        const [games, collections] = await Promise.all([
            window.electronAPI.getGames(),
            window.electronAPI.getCollections()
        ]);

        allGamesData = games;
        window.allGamesData = allGamesData; // keep accounts.js in sync
        allCollections = collections;

        buildPlaytimeCache(games);
        await migratePlaytimeFromLocalStorage();

        renderSidebar();
        navigateToHome();
        initSortable();

        hideSplash(loader, grid);

        setTimeout(() => {
            if (typeof window.checkAndStartTour === 'function') window.checkAndStartTour();
        }, 800);
    } catch (err) {
        console.error('Init Error:', err);
        const loader = document.getElementById('mainLoader');
        if (loader) {
            loader.classList.remove('active');
            loader.style.visibility    = 'hidden';
            loader.style.pointerEvents = 'none';
        }
    }
}
initSystem();

// Prune stale image_cache entries 3 minutes after launch — runs once per session,
// after the metadata pipeline has had time to finish its first pass.
setTimeout(() => {
    if (window.electronAPI?.pruneImageCache) {
        window.electronAPI.pruneImageCache()
            .then(r => { if (r?.pruned) console.log(`[ImageCachePrune] startup prune: removed ${r.pruned} file(s)`); })
            .catch(() => {});
    }
}, 3 * 60 * 1000);

function _hideAllViews() {
    const libView  = document.getElementById('libraryView');
    const instView = document.getElementById('installedGamesView');
    const accView  = document.getElementById('accountsView');
    const heroSec  = document.getElementById('heroSection');
    const gdView   = document.getElementById('gameDetailsView');
    const allGmsView  = document.getElementById('allGamesView');
    const collView = document.getElementById('collectionsView');

    // Stop any playing trailer/video before hiding Game Details
    if (gdView && gdView.style.display !== 'none') {
        if (typeof window._gdStopMediaOnNavAway === 'function') window._gdStopMediaOnNavAway();
    }

    if (libView)  libView.style.display  = 'none';
    if (instView) instView.style.display = 'none';
    if (accView)  accView.style.display  = 'none';
    if (heroSec)  heroSec.style.display  = 'none';
    if (gdView)   gdView.style.display   = 'none';
    if (collView) collView.style.display = 'none';
    if (typeof _agExitEmptyPageMode === 'function') _agExitEmptyPageMode();
    if (allGmsView) allGmsView.style.display = 'none';
}

function navigateToHome() {
    window.agReadyOnly = false;
    if (currentView === 'installed') {
        _igSaveFilterState();
    }

    currentView = 'home';
    _hideAllViews();

    document.getElementById('heroSection').style.display = 'flex';
    document.getElementById('libraryView').style.display = 'block';

    currentFilters.collectionId = null;
    currentFilters.platform = 'all';
    currentFilters.search = '';
    currentHeroGameId = null;
    updateSidebarActiveState();
    syncSidebarActionButton();
    requestAnimationFrame(() => { syncSidebarActionButton(); });

    renderRecentlyPlayed();
    renderExploreCarousel();
    renderSyncedSuggestions();
    applyHeroForHome();
    if (typeof window.renderAccountShortcuts === 'function') window.renderAccountShortcuts();
    updateFooterStats();
    
    if (typeof checkAndManagePolling === 'function') checkAndManagePolling();
}

function navigateToInstalled() {
    window.agReadyOnly = false;
    currentView = 'installed';
    currentFilters.collectionId = null;
    _hideAllViews();

    document.getElementById('installedGamesView').style.display = 'block';
    updateSidebarActiveState();
    syncSidebarActionButton();
    requestAnimationFrame(() => { syncSidebarActionButton(); });

    // رجّع آخر فلتر Installed محفوظ
    _igRestoreFilterState();

    applyFilters();

    // مهم للـ List mode عشان يعيد رسم القائمة بنفس الفلتر
    if (typeof _renderInstalledViewModeAware === 'function') {
        _renderInstalledViewModeAware(window._lastInstalledFilteredGames || []);
    } else if (typeof _igApplyDisplayPrefs === 'function') {
        _igApplyDisplayPrefs();
    }
}

// applyHeroForHome moved to src/js/app/hero.js

// ============================================================
// EXPLORE CAROUSEL (For Home - Epic Style)
// ============================================================
function renderExploreCarousel() {
    const grid = document.getElementById('exploreGrid');
    if (!grid) return;
    grid.innerHTML = '';

    // نجيب مثلاً 15 لعبة عشوائية نعرضهم في الـ Carousel (أو ممكن تعرضهم كلهم)
    const shuffled = [...allGamesData].sort(() => Math.random() - 0.5).slice(0, 15);

    if (shuffled.length === 0) {
        grid.innerHTML = '<div class="empty-state" style="width:100%"><div class="empty-title">No games yet.</div></div>';
        return;
    }

    shuffled.forEach(game => grid.appendChild(createGameCard(game)));
}

function exploreCarouselPrev() {
    const grid = document.getElementById('exploreGrid');
    // السكرول لليسار بمقدار 3 كروت تقريباً (عرض الكارت 200 + المسافات)
    if (grid) grid.scrollBy({ left: -660, behavior: 'smooth' });
}

function exploreCarouselNext() {
    const grid = document.getElementById('exploreGrid');
    // السكرول لليمين بمقدار 3 كروت تقريباً
    if (grid) grid.scrollBy({ left: 660, behavior: 'smooth' });
}

// Synced library suggestions (state, scoring, hydration, render, events)
// moved to src/js/app/suggestions.js

// Account shortcuts, PLATFORM_LOGOS, initShortcutsSortable, saveShortcutsOrder,
// switchPinnedAccount moved to src/js/app/account-shortcuts.js

// ============================================================
// REAL-TIME PLAYTIME UPDATER
// ============================================================
if (window.electronAPI.onPlaytimeUpdated) {
    window.electronAPI.onPlaytimeUpdated((data) => {
        const { gameId, totalMinutes, lastPlayed, lastQualifiedPlayed, playSessions, sessionQualified } = data;

        if (!playtimeData[gameId]) playtimeData[gameId] = { totalMinutes: 0, lastPlayed: null, lastQualifiedPlayed: null, playSessions: [] };
        playtimeData[gameId].totalMinutes = totalMinutes;
        playtimeData[gameId].lastPlayed   = lastPlayed;
        if (lastQualifiedPlayed) playtimeData[gameId].lastQualifiedPlayed = lastQualifiedPlayed;
        if (playSessions)        playtimeData[gameId].playSessions         = playSessions;

        const gameIndex = allGamesData.findIndex(g => String(g.id) === String(gameId));
        if (gameIndex > -1) {
            allGamesData[gameIndex].totalPlaytime = totalMinutes;
            allGamesData[gameIndex].lastPlayed    = lastPlayed;
            if (lastQualifiedPlayed) allGamesData[gameIndex].lastQualifiedPlayed = lastQualifiedPlayed;
            if (playSessions)        allGamesData[gameIndex].playSessions         = playSessions;
        }

        // Only re-render recently played if a qualified session changed the ranking
        if (sessionQualified !== false) renderRecentlyPlayed();

        if (currentFilters.collectionId === null && currentHeroGameId === String(gameId)) {
            updateHeroSection(gameId);
        }

        updateFooterStats();

        const cards = document.querySelectorAll(`.game-card[data-id="${gameId}"]`);
        cards.forEach(card => {
            const timeEl = card.querySelector('.gc-time');
            if (timeEl) {
                const h = Math.floor(totalMinutes / 60);
                const m = totalMinutes % 60;
                const timeStr = h > 0 ? `${h}h ${m}m` : `${m}m`;
                const clockIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;
                
                timeEl.innerHTML = `${clockIcon} ${timeStr}`;
                timeEl.classList.add('played'); 
            }
        });
    });
}

// ============================================================
// REAL-TIME LIBRARY + IMAGE UPDATES FROM MAIN PROCESS
// ============================================================

// Full library refresh (background scan completed)
if (window.electronAPI.onLibraryUpdated) {
    window.electronAPI.onLibraryUpdated((updatedGames) => {
        // Preserve lazily-fetched image assets — same logic as reloadLibrary()
        const _prevById = new Map(allGamesData.map(g => [String(g.id), g]));
        const mergedGames = updatedGames.map(g => {
            const prev = _prevById.get(String(g.id));
            if (!prev) return g;
            // If either side carries the creator lock, the DB version (g) is authoritative
            // for art — the pipeline cannot have overwritten it.  If only prev has the lock
            // (edge case: lock set in-memory but DB flush not yet on disk at scan time),
            // prefer prev's art so we don't momentarily revert.
            const artLocked = g.customArtworkLocked === true || prev.customArtworkLocked === true;
            return {
                ...g,
                image:        artLocked ? (g.image        || prev.image        || null) : (g.image        || prev.image        || null),
                defaultImage: artLocked ? (g.defaultImage || prev.defaultImage || null) : (g.defaultImage || prev.defaultImage || null),
                coverUrl:     artLocked ? (g.coverUrl     || prev.coverUrl     || null) : (g.coverUrl     || prev.coverUrl     || null),
                heroImage:    artLocked ? (g.heroImage    || prev.heroImage    || null) : (g.heroImage    || prev.heroImage    || null),
                defaultHero:  artLocked ? (g.defaultHero  || prev.defaultHero  || null) : (g.defaultHero  || prev.defaultHero  || null),
                logo:         artLocked ? (g.logo         || prev.logo         || null) : (g.logo         || prev.logo         || null),
                defaultLogo:  artLocked ? (g.defaultLogo  || prev.defaultLogo  || null) : (g.defaultLogo  || prev.defaultLogo  || null),
                customArtworkLocked: g.customArtworkLocked || prev.customArtworkLocked || false,
            };
        });
        allGamesData = mergedGames;
        window.allGamesData = allGamesData; // keep accounts.js in sync
        renderSidebar();
        if (currentView === 'home') {
            renderRecentlyPlayed();
            renderExploreCarousel();
            renderSyncedSuggestions();
            applyHeroForHome();
        } else {
            applyFilters();
        }
    });
}


if (window.electronAPI.onGameDeletedPermanently) {
    window.electronAPI.onGameDeletedPermanently(({ id }) => {
        if (typeof _clearArtworkLocalState === 'function') _clearArtworkLocalState(id);
    });
}

if (window.electronAPI.onGameImageUpdated) {
    window.electronAPI.onGameImageUpdated((updatedGame) => {
        const patched = _patchGameInMemory(updatedGame);

        const belongsInAllGames =
            typeof window._agIsUserLibraryGame === 'function'
                ? window._agIsUserLibraryGame(patched || updatedGame)
                : false;

        if (belongsInAllGames) {
            _patchVisibleGameCard(patched);
        } else {
            const _eid = String(updatedGame.id);
            window._allGamesCache = Array.isArray(window._allGamesCache)
                ? window._allGamesCache.filter(g => String(g.id) !== _eid) : [];
            window._allGamesRawCache = Array.isArray(window._allGamesRawCache)
                ? window._allGamesRawCache.filter(g => String(g.id) !== _eid) : [];
            document.querySelector(`#allGamesView [data-id="${CSS.escape(_eid)}"]`)?.remove();
            // Fire-and-forget: show onboarding if no accounts are linked
            ;(async () => {
                try {
                    const _st = await window.electronAPI.platformSyncStatus?.().catch(() => ({}));
                    if (_st?.steam !== true && _st?.epic !== true) {
                        if (typeof _agSetEmptyPageMode === 'function')    _agSetEmptyPageMode(true);
                        if (typeof _agSetToolbarVisible === 'function')   _agSetToolbarVisible(false);
                        if (typeof _agRenderEmptyOnboarding === 'function') _agRenderEmptyOnboarding();
                    }
                } catch (_) {}
            })();
        }

        // If card not yet rendered, trigger a full re-render of the current view
        if (!document.querySelector(`[data-id="${CSS.escape(String(updatedGame.id))}"]`)) {
            if (currentView === 'home') {
                renderRecentlyPlayed();
                renderExploreCarousel();
                renderSyncedSuggestions();
                applyHeroForHome();
            } else {
                applyFilters();
            }
        }

        if (currentHeroGameId === String(updatedGame.id)) updateHeroSection(updatedGame.id);

        // If this game's settings modal is open, refresh it
        if (selectedGameId === String(updatedGame.id)) {
            const settingsModal = document.getElementById('gameSettingsModal');
            if (settingsModal && settingsModal.classList.contains('active')) {
                if (typeof openGameSettings === 'function') openGameSettings(selectedGameId);
            }
        }
    });
}

// ============================================================
// 2. FILTERS (Fixed Version)
// ============================================================
// ── Platform key normalizer ───────────────────────────────────────────────────
// Maps any raw platform string (from DB, filter, or UI) → a canonical key.
// Kept in sync with PLATFORM_CANONICAL in platformResolver.js.
const _PLAT_NORM_MAP = {
    'steam': 'steam',
    'epic': 'epic', 'epic games': 'epic', 'epicgames': 'epic',
    'ea': 'ea', 'ea app': 'ea', 'ea games': 'ea', 'origin': 'ea', 'electronic arts': 'ea',
    'riot': 'riot', 'riot games': 'riot',
    'ubisoft': 'ubisoft', 'ubisoft connect': 'ubisoft', 'uplay': 'ubisoft',
    'rockstar': 'rockstar', 'rockstar games': 'rockstar',
    'xbox': 'xbox', 'xbox game pass': 'xbox', 'xbox / store': 'xbox',
    'microsoft': 'xbox', 'microsoft store': 'xbox', 'store': 'xbox',
    'gog': 'gog', 'gog.com': 'gog',
    'battlenet': 'battlenet', 'battle.net': 'battlenet',
    'discord': 'discord',
    'manual': 'manual', 'local': 'manual',
};
function _normPlatform(raw) {
    // Safe: never throws. Handles strings, numbers, null/undefined, arrays, objects.
    if (raw == null) return '';
    if (Array.isArray(raw)) return ''; // arrays not directly normalizable
    if (typeof raw === 'object') {
        // Extract likely platform string from object fields
        const candidate = raw.platform || raw.platformId || raw.sourcePlatform ||
            raw.scannerPlatform || raw.name || raw.label || raw.type || '';
        return _normPlatform(candidate);
    }
    const s = String(raw).toLowerCase().trim();
    return _PLAT_NORM_MAP[s] || s;
}

function _platformAliasesForGame(game) {
    const aliases = new Set();
    if (!game || typeof game !== 'object') return aliases;

    // Direct string fields
    const strFields = ['platform', 'scannerPlatform', 'sourcePlatform', 'platformId',
                       'launcher', 'store', 'client'];
    for (const f of strFields) {
        if (game[f]) { const n = _normPlatform(game[f]); if (n) aliases.add(n); }
    }

    // game.sources — array of strings or objects
    if (Array.isArray(game.sources)) {
        for (const s of game.sources) {
            if (!s) continue;
            if (typeof s === 'string') {
                const n = _normPlatform(s); if (n) aliases.add(n);
            } else if (typeof s === 'object') {
                for (const f of ['platform','sourcePlatform','scannerPlatform','name','label']) {
                    if (s[f]) { const n = _normPlatform(s[f]); if (n) aliases.add(n); }
                }
            }
        }
    }

    // game.platforms — array of strings
    if (Array.isArray(game.platforms)) {
        for (const p of game.platforms) {
            if (typeof p === 'string') { const n = _normPlatform(p); if (n) aliases.add(n); }
        }
    }

    // game.allIds — presence of a key means that platform owns the game
    if (game.allIds && typeof game.allIds === 'object') {
        const knownIds = ['steam','epic','ea','riot','ubisoft','rockstar','xbox','gog','battlenet'];
        for (const k of knownIds) {
            if (game.allIds[k] != null) aliases.add(k);
        }
    }

    // Command/path inference
    const pathHints = [game.executablePath, game.installPath, game.launchCommand,
                       game.command, game.path].filter(Boolean).join(' ').toLowerCase();
    if (pathHints) {
        if (pathHints.includes('steam://') || pathHints.includes('steamapps') || pathHints.includes('steam')) aliases.add('steam');
        if (pathHints.includes('epicgames') || pathHints.includes('com.epicgames') || pathHints.includes('epic games')) aliases.add('epic');
        if (pathHints.includes('riotclientservices') || pathHints.includes('riot') || pathHints.includes('valorant') || pathHints.includes('leagueclient')) aliases.add('riot');
        if (pathHints.includes('ea desktop') || pathHints.includes('eadesktop') || pathHints.includes('origin') || pathHints.includes('ea app')) aliases.add('ea');
        if (pathHints.includes('ubisoft') || pathHints.includes('uplay')) aliases.add('ubisoft');
        if (pathHints.includes('rockstar')) aliases.add('rockstar');
        if (pathHints.includes('xboxgames') || pathHints.includes('windowsapps') || pathHints.includes('microsoft store') || pathHints.includes('gamingservices')) aliases.add('xbox');
        if (pathHints.includes('gog galaxy') || pathHints.includes('goggame')) aliases.add('gog');
        if (pathHints.includes('battle.net') || pathHints.includes('battlenet')) aliases.add('battlenet');
    }

    return aliases;
}

function _gameMatchesPlatformFilter(game, platformFilter) {
    if (!platformFilter || platformFilter === 'all') return true;
    const normFilter = _normPlatform(platformFilter);
    const aliases = _platformAliasesForGame(game);
    if (aliases.has(normFilter)) return true;
    if (normFilter === 'manual' && aliases.size === 0) return true;
    return false;
}

function applyFilters() {
    const grid = document.getElementById('gamesGrid');
    if (!grid) return;

    grid.style.minHeight = grid.offsetHeight + 'px';
    grid.innerHTML = '';

    if (typeof imageQueue !== 'undefined') {
        imageQueue.length = 0;
    }

    let filtered = [...allGamesData];

    if (currentFilters.platform && currentFilters.platform !== 'all') {
        filtered = filtered.filter(g => _gameMatchesPlatformFilter(g, currentFilters.platform));
    }

    if (currentFilters.search.trim() !== '') {
        const term = currentFilters.search.toLowerCase();
        filtered = filtered.filter(g => {
            const name = g.name.toLowerCase();
            if (name.startsWith(term)) return true;
            if (name.includes(` ${term}`) || name.includes(`-${term}`) || name.includes(`_${term}`) || name.includes(`:${term}`)) return true;
            return false;
        });
    }
    if (currentFilters.sort === 'name') {
        filtered.sort((a, b) => a.name.localeCompare(b.name));
    } else if (currentFilters.sort === 'playtime') {
        filtered.sort((a, b) => {
            const timeA = playtimeData[a.id] ? playtimeData[a.id].totalMinutes : 0;
            const timeB = playtimeData[b.id] ? playtimeData[b.id].totalMinutes : 0;
            return timeB - timeA;
        });
    } else if (currentFilters.sort === 'last_played') {
        filtered.sort((a, b) => {
            const lastA = playtimeData[a.id] ? playtimeData[a.id].lastPlayed || 0 : 0;
            const lastB = playtimeData[b.id] ? playtimeData[b.id].lastPlayed || 0 : 0;
            return lastB - lastA;
        });
    } else if (currentFilters.sort === 'manual' && currentFilters.collectionId !== null) {
        const targetColl = allCollections.find(c => c.id === currentFilters.collectionId);
        if (targetColl) {
            filtered.sort((a, b) => targetColl.gameIds.indexOf(String(a.id)) - targetColl.gameIds.indexOf(String(b.id)));
        }
    }
    const libraryTitle = document.getElementById('libraryTitle');

    if (currentFilters.collectionId !== null) {
        const targetColl = allCollections.find(c => c.id === currentFilters.collectionId);
        if (targetColl) {
            filtered = filtered.filter(g => targetColl.gameIds.includes(String(g.id)));
            // Do NOT call updateHeroForCollection — collection view hides the hero section entirely.
            if (libraryTitle) libraryTitle.innerText = targetColl.name;
        }
    } else {
        if (libraryTitle) {
            const platformLabel =
                document.getElementById('igSelectedPlatformText')?.innerText ||
                document.getElementById('selectedPlatformText')?.innerText ||
                currentFilters.platform ||
                'Selected Platform';

            libraryTitle.innerText = currentFilters.platform !== 'all'
                ? `${platformLabel} Library`
                : 'Installed Games';
        }
    }

    if (currentHeroGameId && !filtered.find(g => String(g.id) === currentHeroGameId)) {
        currentHeroGameId = null;
    }

    // Expose filtered list for list-mode (accounts.js) and debug helpers
    window._lastInstalledFilteredGames = filtered;

    if (filtered.length === 0) {
        const platLabel = (currentFilters.platform && currentFilters.platform !== 'all')
            ? `No installed games found for this platform.`
            : `No games found. Try changing your filters or add a new game.`;
        grid.innerHTML = `
            <div class="empty-state">
                <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="8" y1="12" x2="16" y2="12"></line>
                </svg>
                <div class="empty-title">... It's quiet in here ...</div>
                <div class="empty-subtext">${platLabel}</div>
            </div>
        `;
    } else {
        let renderedCount = 0;
        for (const game of filtered) {
            try {
                grid.appendChild(createGameCard(game));
                renderedCount++;
            } catch (err) {
                console.error('[IG][GridRender] failed for game', {
                    id: game.id, name: game.name,
                    platform: game.platform, scannerPlatform: game.scannerPlatform,
                    sources: game.sources
                }, err);
            }
        }
        if (renderedCount === 0) {
            grid.innerHTML = `<div class="empty-state"><div class="empty-title">Could not render filtered games.</div><div class="empty-subtext">Check console for details.</div></div>`;
        }
    }

    updateSidebarActiveState();
    setTimeout(() => { grid.style.minHeight = 'auto'; }, 10);
    updateFooterStats();
    if (typeof checkAndManagePolling === 'function') checkAndManagePolling();
}

// ── Debug helpers ──────────────────────────────────────────────────────────────
window._debugInstalledPlatformFilter = function(platform) {
    const games = Array.isArray(allGamesData) ? allGamesData : [];
    const rows = games.map(g => ({
        id: g.id, name: g.name,
        platform: g.platform, scannerPlatform: g.scannerPlatform,
        sourcePlatform: g.sourcePlatform, sources: g.sources,
        platforms: g.platforms, allIds: g.allIds,
        aliases: Array.from(_platformAliasesForGame(g)),
        matches: _gameMatchesPlatformFilter(g, platform)
    }));
    console.table(rows.filter(r => r.matches));
    return { platform, total: rows.length, matched: rows.filter(r => r.matches).length, rows };
};

window._debugInstalledGridState = function() {
    return {
        viewMode: window._igDisplayPrefs?.viewMode,
        filter: typeof currentFilters !== 'undefined' ? currentFilters?.platform : undefined,
        lastFilteredCount: window._lastInstalledFilteredGames?.length,
        gridCards: document.querySelectorAll('#gamesGrid .game-card').length,
        listRows: document.querySelectorAll('#igListView .ig-list-row').length,
        gamesGridDisplay: document.getElementById('gamesGrid')?.style.display,
        listDisplay: document.getElementById('igListView')?.style.display,
        gamesGridHtmlLength: document.getElementById('gamesGrid')?.innerHTML?.length
    };
};

function filterGames() {
    currentFilters.search = document.getElementById('searchInput').value;
    applyFilters();
}

function selectPlatform(value, text) {
    document.getElementById('selectedPlatformText').innerText = text;
    currentFilters.platform = value;
    toggleDropdown();
    applyFilters();
}

function toggleSortDropdown(e) { 
    if (e) e.stopPropagation(); 
    document.getElementById('sortMenu').classList.toggle('active'); 
}

function selectSort(value, text) {
    document.getElementById('selectedSortText').innerText = text;
    currentFilters.sort = value;
    document.getElementById('sortMenu').classList.remove('active');
    applyFilters();
}

// filterByCollection moved to src/js/app/collections.js

async function reloadLibrary() {
    if (isScanning) return;
    isScanning = true;
    const btn = document.getElementById('btn-scan');
    if (btn) btn.style.transform = 'rotate(360deg)';
    showToast('Scanning library...', 'success');
    
    try {
        const updatedGames = await window.electronAPI.scanAllGames();

        // ── Preserve previously loaded image assets across the rescan ────────────
        // scanAllGames() returns the DB snapshot at the time of the scan.  Any
        // image fields that were lazily fetched AFTER the last save (e.g. by
        // fetchMetadata / onGameImageUpdated) live only in the current allGamesData
        // array.  Without this merge they are lost and the card falls back to hero
        // art, producing the broken hero+logo composition in Installed Games cards.
        const _prevById = new Map(allGamesData.map(g => [String(g.id), g]));
        const mergedGames = updatedGames.map(g => {
            const prev = _prevById.get(String(g.id));
            if (!prev) return g;
            return {
                ...g,
                // Poster — prefer freshly scanned value, fall back to what was in memory
                image:        g.image        || prev.image        || null,
                defaultImage: g.defaultImage || prev.defaultImage || null,
                coverUrl:     g.coverUrl     || prev.coverUrl     || null,
                // Background / logo — preserve for hero section & details page
                heroImage:    g.heroImage    || prev.heroImage    || null,
                defaultHero:  g.defaultHero  || prev.defaultHero  || null,
                logo:         g.logo         || prev.logo         || null,
                defaultLogo:  g.defaultLogo  || prev.defaultLogo  || null,
            };
        });

        allGamesData = mergedGames;
        window.allGamesData = allGamesData; // keep accounts.js in sync
        allCollections = await window.electronAPI.getCollections();
        buildPlaytimeCache(updatedGames);
        
        renderSidebar();
        
        if (currentView === 'home') {
            renderRecentlyPlayed();
            renderExploreCarousel();
            renderSyncedSuggestions();
            applyHeroForHome();
        } else {
            applyFilters(); 
        }
        
        showToast('Library updated!', 'success');
    } catch (e) { 
        showToast('Scan failed', 'error'); 
    } finally {
        if (btn) btn.style.transform = 'none';
        isScanning = false;
    }
}

// ============================================================
// 3. CARD RENDERING & RECENTLY PLAYED
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

    // الأفضل دائمًا: سيشن مؤكدة ومؤهلة
    const q = Number(d.lastQualifiedPlayed || game.lastQualifiedPlayed || 0);
    if (q > 0) return q;

    const sessions =
        Array.isArray(d.playSessions) ? d.playSessions :
        Array.isArray(game.playSessions) ? game.playSessions :
        [];

    // لو فيه sessions حديثة لكنها كلها unqualified، ممنوع تدخل Jump Back In
    // ده يمنع false detection زي Little Nightmares مع Little Nightmares II
    if (sessions.length > 0 && !_jbiHasRealQualifiedSession(game, d)) {
        return 0;
    }

    // fallback للبيانات القديمة فقط قبل نظام qualified sessions
    const legacy = Number(d.lastPlayed || game.lastPlayed || 0);
    return legacy > 0 ? legacy : 0;
}

function getRecentGames() {
    const playedGames = allGamesData.filter(g => _jbiGetRecentTimestamp(g) > 0);

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

function _agFieldPlaytimeMinutes(game) {
    const id = _agFieldGameId(game);

    return Number(
        game?.playtime ||
        game?.totalPlaytime ||
        playtimeData?.[id]?.totalMinutes ||
        0
    ) || 0;
}

function _agFieldLastPlayed(game) {
    const id = _agFieldGameId(game);

    return (
        game?.lastQualifiedPlayed ||
        game?.lastPlayed ||
        playtimeData?.[id]?.lastQualifiedPlayed ||
        playtimeData?.[id]?.lastPlayed ||
        null
    );
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

function _agDecorateAllGamesCardFields(card, game) {
    if (!card || !game) return;

    // في نسختك createGameCard مفيهاش .game-card-img-wrap
    // فهنركّب الـ overlay مباشرة جوه الكارت نفسه.
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
    if (pData.lastPlayed) {
        const d = new Date(pData.lastPlayed);
        lastPlayedStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    }

    const clockIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;
    const initials = ''; // placeholder kept for layout only — no text shown before image loads
    const transparentPixel = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";

    // ── Platform badge(s) ──────────────────────────────────────────
    // game.sources = ['steam','epic',...] لو موجود، وإلا fallback على game.platform
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
    const displayImg = game.image || game.defaultImage || game.coverUrl || transparentPixel;
    const hasRealPoster = !!(game.image || game.defaultImage || game.coverUrl);

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
        // لو الصورة كان المفروض تكون لوكال ومش موجودة، هنفضي الكاش ونطلبها من تاني
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
    return game.heroImage || game.defaultHero || game.heroUrl || game.hero || null;
}

function _getRecentPosterFallback(game) {
    if (!game) return null;
    return game.image || game.defaultImage || game.coverUrl || game.cover || null;
}

function _getRecentDisplayImage(game) {
    return (
        _getRecentHeroCandidate(game) ||
        _getRecentPosterFallback(game) ||
        'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='
    );
}

// hydrateRecentHeroArtwork moved to src/js/app/artwork-sync.js

function createRecentCard(game, isFeatured = false) {
    const card = document.createElement('div');
    card.className = `jbi-card${isFeatured ? ' jbi-card--featured' : ''}`;
    card.setAttribute('data-id', game.id);
    card.setAttribute('data-last-played', playtimeData[game.id]?.lastPlayed || 0);
    card.setAttribute('data-playtime', playtimeData[game.id]?.totalMinutes || 0);

    const pData = playtimeData[game.id] || { totalMinutes: 0, lastPlayed: null };

    // Cover image — hero artwork first for the cinematic 16:9 look
    const displayImg = _getRecentDisplayImage(game);

    // Labels
    const lastPlayedLabel = formatLastPlayed(pData.lastPlayed);
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

    if (recentHero) {
        imgEl.src = safeImageUrl(recentHero);
        checkBackgroundAssets?.(game);
    } else if (recentPoster) {
        imgEl.src = safeImageUrl(recentPoster);
        hydrateRecentHeroArtwork(game, imgEl).catch(err => {
            console.warn('[JumpBackIn] hero hydration failed:', err);
        });
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

// updateHeroSection, updateHeroForCollection, triggerPlayFromHero,
// openCurrentGameSettings moved to src/js/app/hero.js

// ============================================================
// 5. LAUNCHER
// ============================================================
// isLaunching, triggerLaunchSequence, triggerPlay, closeGameSettings
// moved to src/js/app/launcher-actions.js

// ============================================================
// 6. IMAGE QUEUE & METADATA
// ============================================================
// _normalizeArtworkAliases and _patchVisibleGameCard moved to src/js/app/artwork-sync.js

function _patchGameInMemory(updatedGame) {
    if (!updatedGame || !updatedGame.id) return null;
    const normalized = _normalizeArtworkAliases({ ...updatedGame });
    const id = String(normalized.id);

    const idx = allGamesData.findIndex(g => String(g.id) === id);
    if (idx >= 0) {
        allGamesData[idx] = _normalizeArtworkAliases({ ...allGamesData[idx], ...normalized });
    } else {
        allGamesData.push(normalized);
    }
    window.allGamesData = allGamesData;

    const belongsInAllGames =
        typeof window._agIsUserLibraryGame === 'function'
            ? window._agIsUserLibraryGame(normalized)
            : false;

    if (Array.isArray(window._allGamesCache)) {
        const cidx = window._allGamesCache.findIndex(g => String(g.id) === id);
        if (belongsInAllGames) {
            if (cidx >= 0) {
                window._allGamesCache[cidx] = _normalizeArtworkAliases({ ...window._allGamesCache[cidx], ...normalized });
            } else {
                window._allGamesCache.push(normalized);
            }
        } else if (cidx >= 0) {
            window._allGamesCache.splice(cidx, 1);
        }
    }

    if (Array.isArray(window._allGamesRawCache)) {
        const ridx = window._allGamesRawCache.findIndex(g => String(g.id) === id);
        if (belongsInAllGames) {
            if (ridx >= 0) {
                window._allGamesRawCache[ridx] = _normalizeArtworkAliases({ ...window._allGamesRawCache[ridx], ...normalized });
            } else {
                window._allGamesRawCache.push(normalized);
            }
        } else if (ridx >= 0) {
            window._allGamesRawCache.splice(ridx, 1);
        }
    }

    if (window._vs?.cardCache instanceof Map) window._vs.cardCache.delete(id);
    if (window._vs?._coverQueued instanceof Set) window._vs._coverQueued.delete(id);

    return allGamesData.find(g => String(g.id) === id) || normalized;
}

async function fetchMetadata(imgElement, game) {
    const cacheKey = 'cover_' + game.id;
    const storedCover = localStorage.getItem(cacheKey);

    // 1. In-memory path is already a local file — probe it first (may be gone after Delete Forever)
    if (game.image && game.image.startsWith('file://')) {
        const alive = await window.electronAPI.probeLocalImage(game.image).catch(() => false);
        if (alive) { imgElement.src = game.image; checkBackgroundAssets(game); return; }
        // File is gone — clear stale references so we fall through to a fresh fetch
        game.image = null; game.defaultImage = null; game.coverUrl = null;
        localStorage.removeItem('cover_' + game.id);
    }

    // 1b. Creator-locked with any URL — trust game.image, skip stale localStorage/server
    if (game.customArtworkLocked === true && game.image) {
        imgElement.src = game.image; checkBackgroundAssets(game); return;
    }

    // 2. localStorage has a local file path — probe before trusting
    if (storedCover && storedCover.startsWith('file://')) {
        const alive = await window.electronAPI.probeLocalImage(storedCover).catch(() => false);
        if (alive) { imgElement.src = storedCover; game.image = storedCover; checkBackgroundAssets(game); return; }
        // File is gone — drop stale entry
        localStorage.removeItem(cacheKey);
    }

    // 3. Check disk cache directly (handles reinstall where localStorage was wiped)
    if (window.electronAPI.getCachedImage) {
        try {
            const diskCover = await window.electronAPI.getCachedImage(game.id, 'cover');
            if (diskCover) {
                imgElement.src = diskCover;
                game.image = diskCover;
                localStorage.setItem(cacheKey, diskCover);
                const diskHero = await window.electronAPI.getCachedImage(game.id, 'hero');
                const diskLogo = await window.electronAPI.getCachedImage(game.id, 'logo');
                if (diskHero) { game.heroImage = diskHero; localStorage.setItem('hero_' + game.id, diskHero); }
                if (diskLogo) { game.logo = diskLogo;      localStorage.setItem('logo_' + game.id, diskLogo); }
                window.electronAPI.saveMetadata(game.id, { cover: diskCover, hero: diskHero, logo: diskLogo }).catch(() => {});
                return;
            }
        } catch { /* fall through */ }
    }

    // 4. Clear any stale remote URL from DB/memory so we do a clean API fetch
    //    (remote URLs can expire or be blocked by CORS in Electron)
    if (game.image && !game.image.startsWith('file://')) {
        game.image = null;
    }

    // 5. Fetch fresh metadata from SteamGridDB API
    imageQueue.push({ imgElement, game });
    processQueue();
}

async function processQueue() {
    if (activeRequests >= 3 || imageQueue.length === 0) return;
    activeRequests++;
    const { imgElement, game, _coverRetries = 0 } = imageQueue.shift();

    try {
        const meta = await window.electronAPI.getMetadata(game.name, {
            id: game.id,
            platform: game.platform,
            platforms: game.platforms,
            command: game.command,
            path: game.path,
            allIds: game.allIds,
            existingCover: game.image || null,
            existingHero: game.heroImage || null,
            existingLogo: game.logo || null,
        });

        // ── SERVER-FIRST LOGIC ──────────────────────────────────
        // If the server found the game but images are still CDN-pending, retry up to 3×.
        // Beyond that, fall through and use whatever data we have (incl. local cover).
        const needsCover = !meta?.cover && !game.image;
        if (meta?._serverData && needsCover) {
            if (_coverRetries < 3) {
                console.log(`[Metadata][Pending] ${game.name} found on server but no images yet. Retry ${_coverRetries + 1}/3 in 4s...`);
                setTimeout(() => {
                    imageQueue.push({ imgElement, game, _coverRetries: _coverRetries + 1 });
                    processQueue();
                }, 4000);
                activeRequests--;
                processQueue();
                return;
            }
            console.warn(`[Metadata][Pending] ${game.name} — max retries (3) reached. Accepting data without CDN images.`);
            // fall through to normal processing with text metadata + existing local cover
        }

        console.log(`[Metadata][Library] ${game.name} -> source: ${meta?.source || 'unknown'}`, meta?.debug || {});
        if (meta) {
            // normalizeServerData returns heroImage (not hero) — accept both aliases
            const metaHero = meta.hero || meta.heroImage || null;
            const metaLogo = meta.logo || meta.defaultLogo || null;
            const isHollowPending =
                meta?.source === 'server-pending' &&
                !meta.cover &&
                !metaHero &&
                !metaLogo &&
                !(meta.info?.description);

            if (isHollowPending) {
                console.log(`[Metadata][Pending] ${game.name} still has no usable assets/text — skip cache/save for now.`);
                return;
            }
            if (metaHero) game.heroImage = metaHero;
            if (metaLogo) game.logo = metaLogo;
            if (meta.cover) { game.image = meta.cover; imgElement.src = meta.cover; }

            console.log(`[BaddelAPIEnrichAssets] ${game.name} (${game.id}): cover=${!!meta.cover} hero=${!!metaHero} logo=${!!metaLogo}`);

            if (window.electronAPI.cacheAllAssets) {
                window.electronAPI.cacheAllAssets({ cover: meta.cover, hero: metaHero, logo: metaLogo }, game.id)
                    .then(localAssets => {
                        const finalCover = localAssets.cover || meta.cover || null;
                        const finalHero  = localAssets.hero  || metaHero  || null;
                        const finalLogo  = localAssets.logo  || metaLogo  || null;

                        if (finalCover) {
                            game.image = finalCover; game.defaultImage = finalCover; game.coverUrl = finalCover;
                            localStorage.setItem('cover_' + game.id, finalCover);
                            if (imgElement) {
                                imgElement.classList.remove('img-loaded');
                                imgElement.addEventListener('load', () => imgElement.classList.add('img-loaded'), { once: true });
                                imgElement.src = safeImageUrl(finalCover) + (finalCover.startsWith('file://') ? `?t=${Date.now()}` : '');
                                imgElement.style.opacity = '';
                                imgElement.style.display = 'block';
                            }
                        }
                        if (finalHero) {
                            game.heroImage = finalHero; game.defaultHero = finalHero; game.heroUrl = finalHero;
                            localStorage.setItem('hero_' + game.id, finalHero);
                        }
                        if (finalLogo) {
                            game.logo = finalLogo; game.defaultLogo = finalLogo; game.logoUrl = finalLogo;
                            localStorage.setItem('logo_' + game.id, finalLogo);
                        }

                        console.log(`[BaddelAPIEnrichAssets] ${game.name} cached: cover=${finalCover || 'none'} hero=${finalHero || 'none'}`);

                        const patched = _patchGameInMemory({
                            ...game,
                            image: finalCover || game.image, defaultImage: finalCover || game.defaultImage, coverUrl: finalCover || game.coverUrl,
                            heroImage: finalHero || game.heroImage, defaultHero: finalHero || game.defaultHero, heroUrl: finalHero || game.heroUrl,
                            logo: finalLogo || game.logo, defaultLogo: finalLogo || game.defaultLogo, logoUrl: finalLogo || game.logoUrl,
                        });
                        _patchVisibleGameCard(patched);

                        window.electronAPI.saveMetadata(game.id, { cover: finalCover, hero: finalHero, logo: finalLogo }).catch(() => {});

                        if (currentHeroGameId === String(game.id)) updateHeroSection(game.id);

                        if (window.electronAPI.saveFullMetadata && meta) {
                            window.electronAPI.saveFullMetadata(game.id, game.name, game.platform, {
                                ...meta,
                                cover:     finalCover || meta.cover,
                                heroImage: finalHero  || metaHero,
                                hero:      finalHero  || metaHero,
                                logo:      finalLogo  || metaLogo,
                            }).catch(() => {});
                        }
                    })
                    .catch(() => {});
            }
        }
    } catch { } finally { activeRequests--; processQueue(); }
}

function checkBackgroundAssets(game) {
    const h = localStorage.getItem('hero_' + game.id);
    const l = localStorage.getItem('logo_' + game.id);
    if (h && h.startsWith('file://')) game.heroImage = h;
    if (l && l.startsWith('file://')) game.logo = l;
}


// ============================================================
// 8. SIDEBAR & COLLECTIONS
// ============================================================
// renderSidebar, renderSidebarJumpBackIn, renderSidebarAccountSummary,
// renderSidebarLibraryPulse, navigateToReadyToInstall, updateSidebarPlatformDots,
// updateSmartSidebarCounts, getReadyToInstallGamesForCounts, getReadyToInstallCount,
// getSidebarActionContext, syncSidebarActionButton
// moved to src/js/app/sidebar.js

// ── Collections page ─────────────────────────────────────────────────────────
// navigateToCollections, renderCollectionsView, _renderCollectionsHeader,
// _renderCollectionsStats, _collectionsEmptyStateHTML,
// _getGameByCollectionGameId, _getGameCoverUrl, _renderCollectionCard,
// openAddGamesToCollection, toggleCollectionCardMenu, renameCollection
// moved to src/js/app/collections.js

// ── Sidebar COLLECTIONS section (continued) ──────────────────────────────────
// SB_COLL_MAX, renderSidebarCollectionsList, openSidebarCollection,
// updateSidebarCards, sbToggleSection, sbExpandSection, _sbApplySectionState,
// sbGoManageCollections, handleSidebarContextBtn, updateSbContextBtn,
// clearSidebarActiveState, updateSidebarActiveState, toggleSidebar,
// and window._sbSec initialization
// moved to src/js/app/sidebar.js

// openCollectionModal, closeCollectionModal, saveCollection, deleteColl
// moved to src/js/app/collections.js

// ============================================================
// 9. CONTEXT MENU & RECYCLE BIN
// ============================================================
// selectedGameId, showContextMenu, hideContextMenu, fixSubmenuPosition,
// toggleTimeTracking, triggerRemove, confirmDeleteAction, toggleFavorite,
// _toggleCardFavorite, openRecycleBin, closeRecycleBin, restoreSelectedGames,
// hardDeleteGame moved to src/js/app/game-context-actions.js

// removeFromCurrentCollection moved to src/js/app/collections.js

// triggerPlay moved to src/js/app/launcher-actions.js

// addToCollection moved to src/js/app/collections.js

// _clearArtworkLocalState, _isUsableLocalArtwork, hydrateManualGameArtworkNow
// moved to src/js/app/artwork-sync.js



// closeGameSettings moved to src/js/app/launcher-actions.js

function refreshAllViews() {
    applyFilters(); 
    renderRecentlyPlayed();
    renderExploreCarousel();
    if (currentView === 'home') renderSyncedSuggestions();
    if (currentHeroGameId && allGamesData.find(g => String(g.id) === currentHeroGameId)) updateHeroSection(currentHeroGameId);
}

// ============================================================
// 11. DRAG & DROP (SORTABLE)
// ============================================================
let sortableInstance = null;

function initSortable() {
    const grid = document.getElementById('gamesGrid');
    if (!grid) return;
    if (sortableInstance) sortableInstance.destroy();

    sortableInstance = new Sortable(grid, {
        animation: 400,
        easing: 'cubic-bezier(0.25, 1, 0.5, 1)',
        ghostClass: 'sortable-ghost',
        dragClass: 'sortable-drag',
        draggable: '.game-card',
        // FIX: only start drag from the dedicated handle
        handle: '.gc-drag-handle',
        // FIX: tolerate small mouse/touchpad jitter before committing to drag
        fallbackTolerance: 6,
        touchStartThreshold: 8,
        // FIX: prevent clicks on interactive elements inside the card from starting a drag
        filter: '.gc-fav-btn, .play-btn-center, button',
        preventOnFilter: true,
        swap: true,
        swapClass: 'highlight-swap',
        forceFallback: true,
        delay: 0,
        delayOnTouchOnly: false,
        onStart: () => {
            document.body.classList.add('is-dragging');
            // FIX: global guard so Game Details click listener is suppressed during drag
            window.__igSortDragging = true;
        },
        onEnd: (evt) => {
            document.body.classList.remove('is-dragging');
            // FIX: delay clearing guard to swallow the synthetic click some browsers
            // fire immediately after pointerup
            setTimeout(() => { window.__igSortDragging = false; }, 50);
            if (evt.oldIndex !== evt.newIndex) saveNewOrder();
        }
    });
}

async function saveNewOrder() {
    if (currentFilters.search !== '' || currentFilters.platform !== 'all' || currentFilters.sort !== 'manual') return;
    
    const cards = document.querySelectorAll('#gamesGrid .game-card');
    const newOrderIds = Array.from(cards).map(c => c.getAttribute('data-id'));
    
    if (currentFilters.collectionId !== null) {
        await window.electronAPI.reorderCollection(currentFilters.collectionId, newOrderIds);
        const coll = allCollections.find(c => String(c.id) === String(currentFilters.collectionId));
        if (coll) coll.gameIds = newOrderIds;
    } else {
        await window.electronAPI.reorderLibrary(newOrderIds);
        allGamesData.sort((a, b) => newOrderIds.indexOf(String(a.id)) - newOrderIds.indexOf(String(b.id)));
    }
}

// ============================================================
// COLLECTION SETTINGS MODAL
// ============================================================
// openCollectionSettings, closeCollectionSettings, triggerDeleteCollection,
// saveCollectionSettings, changeCollectionImage, resetCollectionImage
// moved to src/js/app/collections.js

// ============================================================
// 12. SURPRISE ME (ROULETTE)
// ============================================================
let rouletteResultId   = null;
let rouletteResultGame = null; // full game object (needed for install mode)
let isSpinning         = false;
let rouletteMode       = null; // 'play' | 'install'
let _rouletteRecentPicks = [];
let rouletteSpinToken = 0;
let rouletteState = 'idle';

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
    let pool = allGamesData.filter(g => !g.isHidden && (g.path || g.command));
    if (customSpinIds.length > 0) {
        pool = pool.filter(g => customSpinIds.includes(String(g.id)));
    }
    return pool;
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

            const bestPoster  = _preferLocalImage([g.image, g.defaultImage, g.coverUrl, g.capsuleImage, g.boxArt, g.grid, cachedArt.poster]) || '';
            const bestHero    = _preferLocalImage([g.heroImage, g.defaultHero, cachedArt.hero]) || '';
            const bestLogo    = _preferLocalImage([g.logo, g.defaultLogo, cachedArt.logo]) || '';

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
    const raw = game?._raw || game || {};
    const fields = ['image', 'defaultImage', 'coverUrl', 'capsuleImage', 'boxArt', 'grid', 'poster'];
    for (const field of fields) {
        const url = isUsableImageUrl(game?.[field]) || isUsableImageUrl(raw[field]);
        if (url) return { url, source: field };
    }

    if (mode === 'install') {
        for (const field of ['heroImage', 'defaultHero', 'heroUrl', 'background']) {
            const url = isUsableImageUrl(game?.[field]) || isUsableImageUrl(raw[field]);
            if (url) {
                console.warn(`[RoulettePoster] ${_rouletteGameId(game)} mode=${mode} using hero fallback source=${field}`);
                return { url, source: field };
            }
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
const _ROULETTE_HYDRATE_LIMIT = 12;
let   _roulettePoolHydrated   = false;

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

// ── Main spin ──────────────────────────────────────────────────
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
    const raw = game._raw || game;

    // 1. Try the candidate's own normalised hero fields first
    const directHero = isUsableImageUrl(
        game.heroImage || game.defaultHero || game._rouletteHeroUrl ||
        game.heroUrl   || game.background  || null
    );
    if (directHero) return directHero;

    // 2. Try raw game object fields
    const rawHero = isUsableImageUrl(
        raw.heroImage || raw.defaultHero || raw.heroUrl || raw.background || null
    );
    if (rawHero) return rawHero;

    // 3. Fall back to _suggArtCache (populated by RTIA / _suggHydrateArt)
    const cacheKey = _suggKey(raw.id ? raw : (game.id ? game : raw));
    const cachedArt = (typeof _suggArtCacheGet === 'function') ? _suggArtCacheGet(cacheKey) : null;
    if (cachedArt && cachedArt.hero) return isUsableImageUrl(cachedArt.hero) || null;

    return null;
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
    
    const availableGames = allGamesData.filter(g => !g.isHidden);
    if(availableGames.length === 0) return showToast('Your library is empty!', 'error');

    availableGames.forEach(g => {
        const isChecked = customSpinIds.includes(String(g.id)) ? 'checked' : '';
        const div = document.createElement('div');
        div.className = 'bin-item pool-item';
        div.setAttribute('data-name', g.name.toLowerCase());
        div.innerHTML = `
            <label class="custom-checkbox">
                <input type="checkbox" value="${g.id}" ${isChecked}>
                <span class="checkmark"></span>
            </label>
            <img src="${g.image || '../assets/default_hero.jpg'}" style="width:32px;height:32px;border-radius:6px;margin-right:12px;object-fit:cover; border: 1px solid #333;">
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

// ============================================================
// UTILS & GLOBAL EVENTS
// ============================================================
// showToast moved to src/js/app/toast-confirm.js

function toggleDropdown(e) { if (e) e.stopPropagation(); document.getElementById('dropdownMenu').classList.toggle('active'); }

// ============================================================
// ALL GAMES VIEW - Installed Only / Ready-to-Install filters
// ============================================================
window.agInstalledOnly = false;
window.agReadyOnly     = false;

function toggleAgInstalledFilter() {
    window.agInstalledOnly = !window.agInstalledOnly;
    const btn = document.getElementById('agInstalledToggle');
    if (btn) btn.classList.toggle('active', window.agInstalledOnly);
    if (typeof window.filterAllGames === 'function') window.filterAllGames();
}

// fixSubmenuPosition, fixSubmenuPosition.reset moved to src/js/app/game-context-actions.js

window.onclick = (e) => {
    // Installed Games platform/sort dropdowns are fully isolated (igPlatformMenu/igSortMenu)
    // and closed by the accounts.js outside-click listener.
    // Here we only close the old library-view shared dropdowns.
    if (!e.target.closest('#platformDropdown')) {
        const d = document.getElementById('dropdownMenu'); if (d) d.classList.remove('active');
    }
    if (!e.target.closest('#playtimeDropdownContainer')) { const pm = document.getElementById('playtimeMenu'); if (pm) pm.classList.remove('active'); }
    if (!e.target.closest('#sortDropdown')) {
        const sm = document.getElementById('sortMenu'); if (sm) sm.classList.remove('active');
    }
    if (!e.target.closest('#contextMenu')) hideContextMenu();
};

// ============================================================
// 13. SYSTEM STATS HUD + FOOTER PLAYTIME STATS
// ============================================================
// _prevNetBytes, _hudInterval, _isStatsInit, _isStatsBusy, isSensorEnabled,
// currentPlaytimeFormat, currentPlaytimeFilterValue, checkAndManagePolling,
// toggleSensors, _resetStatsUI, initSystemStats, _loadStaticInfo, _tickStats,
// _setText, _setBar, _fmtBytes, _fmtSpeed, _shortName, cyclePlaytimeFormat,
// togglePlaytimeDropdown, selectPlaytime, updateFooterStats
// moved to src/js/app/system-stats.js
// ============================================================
// SETTINGS MODAL + QUICK SWITCHER SETTINGS
// ============================================================
// openSettingsModal, closeSettingsModal, _qsLoadSettings, qsToggleEnabled,
// qsChangePosition, qsToggleCloseAfter, qsChangeHotkey, qsResetHotkey,
// _openQSHotkeyModal, _qsBasicValidate, toggleAnalytics, toggleStartup,
// and the startupToggle DOMContentLoaded listener
// moved to src/js/app/settings-quick-switcher.js

// ============================================================
// CONFIRM MODAL
// ============================================================
// pendingConfirmAction, openConfirmModal, closeConfirmModal, executeConfirm
// moved to src/js/app/toast-confirm.js

// ============================================================
// FOOTER PLAYTIME STATS
// ============================================================
// currentPlaytimeFormat, currentPlaytimeFilterValue, cyclePlaytimeFormat,
// togglePlaytimeDropdown, selectPlaytime, updateFooterStats
// moved to src/js/app/system-stats.js

// Update notes, community hub moved to src/js/app/help-feedback.js