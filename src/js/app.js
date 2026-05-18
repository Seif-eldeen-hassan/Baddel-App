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
let selectedGameId = null;
let tempImagePath = null;
let isEditingMode = false;

let activeHoverId = null;
let isLaunching = false;
let currentHeroGameId = null;
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
let currentHeroSlideshowInterval = null;
let currentEditingCollectionId = null;
let customSpinIds = [];

// ============================================================
// PLAYTIME SYSTEM
// ============================================================
function buildPlaytimeCache(games) {
    playtimeData = {};
    games.forEach(g => {
        if (g.totalPlaytime || g.lastPlayed || g.playSessions) {
            playtimeData[g.id] = {
                totalMinutes:       g.totalPlaytime       || 0,
                lastPlayed:         g.lastPlayed          || null,
                lastQualifiedPlayed: g.lastQualifiedPlayed || null,
                playSessions:       g.playSessions        || [],
                timeTrackingEnabled: g.timeTrackingEnabled !== false,
            };
        }
    });
}

async function savePlaytimeData(gameId, playedMinutes) {
    try {
        const result = await window.electronAPI.updatePlaytime(gameId, playedMinutes);
        if (result && result.status === 'success') {
            if (!playtimeData[gameId]) playtimeData[gameId] = { totalMinutes: 0, lastPlayed: null };
            playtimeData[gameId].totalMinutes = result.totalPlaytime;
            playtimeData[gameId].lastPlayed = result.lastPlayed;

            const gameIndex = allGamesData.findIndex(g => String(g.id) === String(gameId));
            if (gameIndex > -1) {
                allGamesData[gameIndex].totalPlaytime = result.totalPlaytime;
                allGamesData[gameIndex].lastPlayed = result.lastPlayed;
            }
        }
    } catch (e) {
        console.error('Failed to save playtime:', e);
    }
}

function formatPlaytime(minutes) {
    if (!minutes) return '0h 0m';
    if (minutes < 60) return `${minutes}m`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatLastPlayed(timestamp) {
    if (!timestamp) return 'Never';
    const date = new Date(timestamp);
    const now = new Date();
    const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
}

async function migratePlaytimeFromLocalStorage() {
    const migrationDone = localStorage.getItem('baddel_playtime_migrated');
    if (migrationDone) return;

    const oldData = JSON.parse(localStorage.getItem('baddel_playtime') || '{}');
    const entries = Object.entries(oldData);
    if (entries.length === 0) {
        localStorage.setItem('baddel_playtime_migrated', '1');
        return;
    }

    for (const [gameId, data] of entries) {
        try {
            await window.electronAPI.updatePlaytime(gameId, data.totalMinutes || 0);
            playtimeData[gameId] = { totalMinutes: data.totalMinutes || 0, lastPlayed: data.lastPlayed || null };
        } catch { /* skip failed games */ }
    }

    localStorage.setItem('baddel_playtime_migrated', '1');
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
    const libView = document.getElementById('libraryView');
    const instView = document.getElementById('installedGamesView');
    const accView = document.getElementById('accountsView');
    const heroSec = document.getElementById('heroSection');
    const gdView = document.getElementById('gameDetailsView');
    const allGmsView = document.getElementById('allGamesView');

    // Stop any playing trailer/video before hiding Game Details
    if (gdView && gdView.style.display !== 'none') {
        if (typeof window._gdStopMediaOnNavAway === 'function') window._gdStopMediaOnNavAway();
    }

    if (libView) libView.style.display = 'none';
    if (instView) instView.style.display = 'none';
    if (accView) accView.style.display = 'none';
    if (heroSec) heroSec.style.display = 'none';
    if (gdView) gdView.style.display = 'none';
    if (typeof _agExitEmptyPageMode === 'function') _agExitEmptyPageMode();
    if (allGmsView) allGmsView.style.display = 'none';
}

function navigateToHome() {
    if (currentView === 'installed') {
        _igSaveFilterState();
    }

    currentView = 'home';
    _hideAllViews();
    
    document.getElementById('heroSection').style.display = 'flex';
    document.getElementById('libraryView').style.display = 'block';
    
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

    currentFilters.collectionId = null;
    currentFilters.platform = 'all';
    currentFilters.search = '';
    currentHeroGameId = null;

    renderRecentlyPlayed();
    renderExploreCarousel();
    renderSyncedSuggestions();
    applyHeroForHome();
    renderAccountShortcuts();
    updateFooterStats();
    
    if (typeof checkAndManagePolling === 'function') checkAndManagePolling();
}

function navigateToInstalled() {
    currentView = 'installed';
    _hideAllViews();

    document.getElementById('installedGamesView').style.display = 'block';

    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.getElementById('nav-installed')?.classList.add('active');

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

function applyHeroForHome() {
    const recent = getRecentGames();
    if (recent.length > 0) {
        updateHeroSection(recent[0].id);
    } else if (allGamesData.length > 0) {
        updateHeroSection(allGamesData[0].id);
    } else {
        // Fallback لو مفيش أي ألعاب
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
const failedImageIds   = new Set();
const _SUGG_HYDRATE_CONCURRENCY = 6;
let _suggHydrateActive = 0;

// ── Ready-to-Install artwork cache ───────────────────────────────────────────
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

// ── Shared creator-patch helper ──────────────────────────────────────────────
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

// ── ReadyToInstallAssetHydrator (RTIA) ───────────────────────────────────────
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

async function renderSyncedSuggestions() {
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

    const freshCount = _suggAllGames.filter(g => !g._cacheStale).length;
    const staleCount = _suggAllGames.filter(g =>  g._cacheStale).length;
    if (stats) {
        let countHtml = `<div class="synced-count-inline"><span class="sci-label">READY TO INSTALL</span><span class="sci-num green">${freshCount}</span></div>`;
        if (staleCount > 0) {
            countHtml += `<div class="synced-count-inline" title="From a previous sync that had errors — may not be current"><span class="sci-label">CACHED</span><span class="sci-num" style="color:#f59e0b;">${staleCount}</span></div>`;
        }
        stats.innerHTML = countHtml;
    }

    _suggUpdatePills();
    _suggRenderFiltered();
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

// Hook for accounts.js to call after a sync completes:
window._onSyncLibraryUpdated = function() {
    if (typeof currentView !== 'undefined' && currentView === 'home') {
        _suggStopRotation();
        renderSyncedSuggestions();
    }
};

// ============================================================
// ACCOUNT SHORTCUTS (For Home)
// ============================================================
// ============================================================
// ACCOUNT SHORTCUTS (For Home)
// ============================================================
// ============================================================
// ACCOUNT SHORTCUTS (For Home)
// ============================================================
const PLATFORM_LOGOS = {
    steam:   { img: '../assets/Steam.png',        name: 'Steam',          color: '#1b2838' },
    epic:    { img: '../assets/epic.svg',          name: 'Epic',           color: '#181818', invert: true },
    ea:      { img: '../assets/ea.png',            name: 'EA App',         color: '#ff6b35' },
    riot:    { img: '../assets/riot.png',          name: 'Riot',           color: '#ff4655' },
    ubisoft: { img: '../assets/Ubisoft.png',       name: 'Ubisoft',        color: '#0070d1', invert: true },
    discord: { img: '../assets/discord.webp',      name: 'Discord',        color: '#5865F2' },
    rockstar: { img: '../assets/rockstar.png',     name: 'Rockstar',       color: '#1a1100' }, // ← ده المفقود
};

function renderAccountShortcuts() {
    const container = document.getElementById('accountsShortcutsInner');
    const section = document.getElementById('accountsShortcutsSection');
    if (!container || !section) return;

    let pinned = JSON.parse(localStorage.getItem('baddel_pinned_accounts') || '[]');
    
    if (pinned.length === 0) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';
    container.innerHTML = '';

    pinned.forEach(acc => {
        const cfg = PLATFORM_LOGOS[acc.platform];
        if (!cfg) return;
        
        const btn = document.createElement('div');
        btn.className = 'account-shortcut-card';
        // 🔴 بنخزن الداتا عشان نقدر نرتبهم بعدين
        btn.dataset.platform = acc.platform;
        btn.dataset.profile = acc.profileName;
        
        const initials = acc.displayName ? acc.displayName.substring(0, 2).toUpperCase() : '??';
        const uniqueId = `home-avatar-${acc.platform}-${acc.profileName.replace(/\W/g, '')}`;
        
        let avatarContent = `<span style="display:flex; align-items:center; justify-content:center; width:100%; height:100%; font-weight:bold; color: #fff;">${initials}</span>`;
        
        if (acc.avatarUrl) {
            avatarContent = `<img src="${acc.avatarUrl}" class="asc-img" style="width:100%; height:100%; object-fit:cover; border-radius:50%;">`;
        } 
        else if (acc.platform === 'steam') {
            avatarContent = `
                <span id="span-${uniqueId}" style="display:flex; align-items:center; justify-content:center; width:100%; height:100%; font-weight:bold; color: #fff;">${initials}</span>
                <img id="img-${uniqueId}" class="asc-img" style="display:none; width:100%; height:100%; object-fit:cover; border-radius:50%;">
            `;
        }

        // 🔴 غيرنا title لـ data-tooltip
        btn.innerHTML = `
            <button class="asc-unpin-btn" onclick="handlePinAccount('${acc.platform}', '${acc.profileName}')" data-tooltip="Unpin">
                <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
            <div class="asc-avatar" style="--sc-color:${cfg.color};">
                ${avatarContent}
                <div class="asc-plat-badge">
                    <img src="${cfg.img}" class="${cfg.invert ? 'shortcut-invert' : ''}" style="width:100%; height:100%; object-fit:contain;">
                </div>
            </div>
            <div class="asc-info">
                <div class="asc-name">${acc.displayName}</div>
                <div class="asc-plat">${cfg.name}</div>
            </div>
            <button class="asc-play-btn" onclick="switchPinnedAccount('${acc.platform}', '${acc.profileName}', this)" data-tooltip="Switch">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>
            </button>
        `;

        // 🔴 تفعيل فك التثبيت بـ Right Click
        btn.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            handlePinAccount(acc.platform, acc.profileName);
        });

        container.appendChild(btn);

        if (acc.platform === 'steam' && acc.extraId && window.electronAPI.getSteamImage) {
            window.electronAPI.getSteamImage(acc.extraId).then(imgUrl => {
                if (imgUrl && imgUrl.trim() !== '') {
                    const imgEl = document.getElementById(`img-${uniqueId}`);
                    const spanEl = document.getElementById(`span-${uniqueId}`);
                    if (imgEl && spanEl) {
                        imgEl.onload = () => { imgEl.style.display = 'block'; spanEl.style.display = 'none'; };
                        imgEl.onerror = () => { imgEl.style.display = 'none'; spanEl.style.display = 'flex'; };
                        imgEl.src = imgUrl;
                    }
                }
            }).catch(() => {});
        }
    });

    // 🔴 تشغيل السحب والإفلات بعد ما الكروت تترسم
    initShortcutsSortable();
}

// ============================================================
// 🟢 دوال السحب والإفلات (Drag & Drop) للأكاونتات
// ============================================================
let shortcutsSortableInstance = null;

function initShortcutsSortable() {
    const container = document.getElementById('accountsShortcutsInner');
    if (!container) return;

    if (shortcutsSortableInstance) {
        shortcutsSortableInstance.destroy();
    }

    shortcutsSortableInstance = new Sortable(container, {
        animation: 250,
        easing: 'cubic-bezier(0.25, 1, 0.5, 1)',
        ghostClass: 'sortable-ghost',
        dragClass: 'sortable-drag',
        delay: 100, // تأخير بسيط عشان ميمنعش كليك الماوس العادي
        delayOnTouchOnly: true,
        onEnd: () => {
            saveShortcutsOrder(); // حفظ الترتيب الجديد لما تسيب الماوس
        }
    });
}

function saveShortcutsOrder() {
    const container = document.getElementById('accountsShortcutsInner');
    const cards = container.querySelectorAll('.account-shortcut-card');
    
    let currentPinned = JSON.parse(localStorage.getItem('baddel_pinned_accounts') || '[]');
    let newOrder = [];

    // بنمشي على الكروت بعد ما اليوزر رتبهم ونعيد ترتيب الـ Array
    cards.forEach(card => {
        const plat = card.dataset.platform;
        const prof = card.dataset.profile;
        const acc = currentPinned.find(p => p.platform === plat && p.profileName === prof);
        if (acc) newOrder.push(acc);
    });

    // بنحفظ الترتيب الجديد في الجهاز
    localStorage.setItem('baddel_pinned_accounts', JSON.stringify(newOrder));
}

window.switchPinnedAccount = async function(platform, profileName, btnEl) {
    if(typeof handleSwitchAccount === 'function') {
        await handleSwitchAccount(platform, profileName, btnEl);
    }
}

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


if (window.electronAPI.onGameImageUpdated) {
    window.electronAPI.onGameImageUpdated((updatedGame) => {
        const idx = allGamesData.findIndex(g => String(g.id) === String(updatedGame.id));
        if (idx === -1) return;

        // Update the in-memory record (This includes cover, hero, and logo)
        allGamesData[idx] = { ...allGamesData[idx], ...updatedGame };

        const cacheBuster = `?t=${Date.now()}`;

        // Update the card's cover image in the DOM
        const cardImg = document.querySelector(`[data-id="${updatedGame.id}"] .actual-img`);
        if (cardImg && updatedGame.image) {
            cardImg.classList.remove('img-loaded');
            cardImg.addEventListener('load', () => cardImg.classList.add('img-loaded'), { once: true });
            cardImg.src = updatedGame.image + cacheBuster;
            cardImg.style.opacity = '';
        }

        // If this game is the current hero, refresh the hero section too
        if (currentHeroGameId === String(updatedGame.id)) {
            updateHeroSection(updatedGame.id);
        }

        // 🔴 السحر هنا: لو المستخدم فاتح إعدادات اللعبة دي تحديداً، اعملها إعادة تحميل تلقائي
        if (selectedGameId === String(updatedGame.id)) {
            const settingsModal = document.getElementById('gameSettingsModal');
            if (settingsModal && settingsModal.classList.contains('active')) {
                if (typeof openGameSettings === 'function') {
                    openGameSettings(selectedGameId);
                }
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

function filterByCollection(collId) {
    currentView = 'collection';
    _hideAllViews();

    // Collections / Favorites do NOT show the full hero/play area.
    // heroSection stays hidden; only the installedGamesView content pane is shown.
    document.getElementById('installedGamesView').style.display = 'block';

    currentFilters.collectionId = collId;
    currentHeroGameId = null;
    currentFilters.platform = 'all';
    currentFilters.search = '';
    const searchInp = document.getElementById('searchInput');
    if (searchInp) searchInp.value = '';
    const platformTxt = document.getElementById('selectedPlatformText');
    if (platformTxt) platformTxt.innerText = 'All Platforms';

    const igPlatformTxt = document.getElementById('igSelectedPlatformText');
    if (igPlatformTxt) igPlatformTxt.innerText = 'All Platforms';

    // FIX: immediately reflect active state in sidebar so the click is visibly registered,
    // even before applyFilters() re-runs updateSidebarActiveState().
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    if (collId === 'fav_system_default') {
        document.getElementById('nav-fav')?.classList.add('active');
    } else {
        const collEl = document.querySelector(`#collectionsList .nav-item[data-id="${collId}"]`);
        if (collEl) collEl.classList.add('active');
    }

    applyFilters();
}

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

// ─────────────────────────────────────────────────────────────────────────────
// Show Fields toggles  (All Games + Installed Games tabs)
// ─────────────────────────────────────────────────────────────────────────────
const _AG_FIELD_CLASS_MAP = {
    title:      { cls: 'hide-title',      invert: true  }, // checked = visible → no class
    platforms:  { cls: 'hide-platforms',  invert: true  },
    playtime:   { cls: 'show-playtime',   invert: false }, // checked = visible → add class
    lastPlayed: { cls: 'show-lastPlayed', invert: false },
    installed:  { cls: 'show-installed',  invert: false },
};

const _IG_FIELD_CLASS_MAP = {
    title:      { cls: 'ig-hide-title',      invert: true  },
    platform:   { cls: 'ig-hide-platform',   invert: true  },
    playtime:   { cls: 'ig-hide-playtime',   invert: true  },
    lastPlayed: { cls: 'ig-show-lastplayed', invert: false },
};

const _AG_FIELDS_LS_KEY = 'allGamesShowFields_v1';
const _IG_FIELDS_LS_KEY = 'installedGamesShowFields_v1';

function _readFieldPrefs(key) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

function _writeFieldPrefs(key, prefs) {
    try { localStorage.setItem(key, JSON.stringify(prefs)); } catch {}
}

function _applyFieldClass(grid, mapping, on) {
    if (!grid || !mapping) return;
    const shouldHaveClass = mapping.invert ? !on : on;
    grid.classList.toggle(mapping.cls, shouldHaveClass);
}

function setAgField(field, on) {
    const grid = document.getElementById('allGamesGrid');
    const mapping = _AG_FIELD_CLASS_MAP[field];
    if (!grid || !mapping) return;
    _applyFieldClass(grid, mapping, on);

    const prefs = _readFieldPrefs(_AG_FIELDS_LS_KEY) || {};
    prefs[field] = !!on;
    _writeFieldPrefs(_AG_FIELDS_LS_KEY, prefs);
}

function setIgField(field, on) {
    const grid = document.getElementById('gamesGrid');
    const mapping = _IG_FIELD_CLASS_MAP[field];
    if (!grid || !mapping) return;
    _applyFieldClass(grid, mapping, on);

    const prefs = _readFieldPrefs(_IG_FIELDS_LS_KEY) || {};
    prefs[field] = !!on;
    _writeFieldPrefs(_IG_FIELDS_LS_KEY, prefs);
}

// Expose to inline onchange handlers
window.setAgField = setAgField;
window.setIgField = setIgField;

function _initFieldToggles() {
    // ── All Games ─────────────────────────────────────────────────────
    const agGrid = document.getElementById('allGamesGrid');
    if (agGrid) {
        const savedAg = _readFieldPrefs(_AG_FIELDS_LS_KEY) || {};
        const agMapping = {
            title:      'adpFieldTitle',
            platforms:  'adpFieldPlatforms',
            lastPlayed: 'adpFieldLastPlayed',
            playtime:   'adpFieldPlaytime',
            installed:  'adpFieldInstalled',
        };
        Object.entries(agMapping).forEach(([field, cbId]) => {
            const cb = document.getElementById(cbId);
            if (!cb) return;
            // localStorage > checkbox default
            if (Object.prototype.hasOwnProperty.call(savedAg, field)) {
                cb.checked = !!savedAg[field];
            }
            _applyFieldClass(agGrid, _AG_FIELD_CLASS_MAP[field], cb.checked);
        });
    }

    // ── Installed Games ────────────────────────────────────────────────
    const igGrid = document.getElementById('gamesGrid');
    if (igGrid) {
        const savedIg = _readFieldPrefs(_IG_FIELDS_LS_KEY) || {};
        const igMapping = {
            title:      'igAdpFieldTitle',
            platform:   'igAdpFieldPlatform',
            playtime:   'igAdpFieldPlaytime',
            lastPlayed: 'igAdpFieldLastPlayed',
        };
        Object.entries(igMapping).forEach(([field, cbId]) => {
            const cb = document.getElementById(cbId);
            if (!cb) return;
            if (Object.prototype.hasOwnProperty.call(savedIg, field)) {
                cb.checked = !!savedIg[field];
            }
            _applyFieldClass(igGrid, _IG_FIELD_CLASS_MAP[field], cb.checked);
        });
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _initFieldToggles);
} else {
    // DOM already ready — defer to next tick to ensure grids are in the tree
    setTimeout(_initFieldToggles, 0);
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

function createRecentCard(game, isFeatured = false) {
    const card = document.createElement('div');
    card.className = `jbi-card${isFeatured ? ' jbi-card--featured' : ''}`;
    card.setAttribute('data-id', game.id);
    card.setAttribute('data-last-played', playtimeData[game.id]?.lastPlayed || 0);
    card.setAttribute('data-playtime', playtimeData[game.id]?.totalMinutes || 0);

    const pData = playtimeData[game.id] || { totalMinutes: 0, lastPlayed: null };

    // Cover image — hero artwork first for the cinematic 16:9 look
    const transparentPixel = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
    const displayImg =
        game.heroImage    ||
        game.defaultHero  ||
        game.image        ||
        game.defaultImage ||
        game.coverUrl     ||
        transparentPixel;

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

    // If a local hero or cover is already on disk, use it directly;
    // otherwise run the metadata pipeline (which will also deliver hero art)
    const localAsset = (game.heroImage   && game.heroImage.startsWith('file://'))   ? game.heroImage
                     : (game.defaultHero && game.defaultHero.startsWith('file://')) ? game.defaultHero
                     : (game.image       && game.image.startsWith('file://'))       ? game.image
                     : null;
    if (localAsset) {
        imgEl.src = localAsset;
    } else {
        fetchMetadata(imgEl, game);
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
// 4. HERO SECTION
// ============================================================
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

    const rawBg = game.heroImage || game.image || null;
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

    if (game.logo) {
        logoImg.src = game.logo; logoImg.style.display = 'block'; titleTxt.style.display = 'none';
    } else {
        logoImg.style.display = 'none'; titleTxt.innerText = game.name; titleTxt.style.display = 'block';
    }

    const pData = playtimeData[game.id] || { totalMinutes: 0, lastPlayed: null };
    statsDiv.innerHTML = `
        <span class="stat-badge playtime-stat"><span id="heroPlaytime">${formatPlaytime(pData.totalMinutes)}</span></span>
        <span class="stat-badge">Last Played: <span id="heroLastPlayed">${formatLastPlayed(pData.lastPlayed)}</span></span>
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
                if (g.heroImage || g.image) validImages.push(g.heroImage || g.image);
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

// ============================================================
// 5. LAUNCHER
// ============================================================
async function triggerLaunchSequence(gameId) {
    if (isLaunching) return;

    const game = allGamesData.find(g => String(g.id) === String(gameId));
    if (!game) return;

    // 🎮 افتح الـ Play Launcher Modal أولاً (بيختار المنصة والأكاونت)
    // لو اللعبة على منصة واحدة هيشغل مباشرة من غير Modal
    if (typeof window.openPlayLauncher === 'function') {
        window.openPlayLauncher(game);
        return;
    }

    // ── Fallback: لو play-launcher.js مش محمّل ──
    isLaunching = true;

    const overlay = document.getElementById('launchOverlay');
    const bgDiv = document.getElementById('launchBg');
    const logoImg = document.getElementById('launchLogo');
    const titleTxt = document.getElementById('launchTitle');
    const statusText = document.getElementById('launchText');

    logoImg.style.display = 'none'; logoImg.src = '';
    titleTxt.style.display = 'none'; statusText.innerText = 'INITIALIZING...';

    const bgUrl = game.heroImage || game.image || 'assets/default_hero.jpg';
    if (bgUrl) bgDiv.style.backgroundImage = `url('${bgUrl.replace(/\\/g, '/')}')`;

    if (game.logo) { logoImg.src = game.logo; logoImg.style.display = 'block'; }
    else { titleTxt.innerText = game.name; titleTxt.style.display = 'block'; }

    statusText.innerText = `STARTING ${game.name.toUpperCase()}...`;
    overlay.classList.add('active');

    let trackPath = game.path;
    if (!trackPath && game.command) {
        const cleanCommand = game.command.replace(/"/g, '');
        trackPath = cleanCommand.substring(0, cleanCommand.lastIndexOf('\\'));
    }

    try {
        const launchRes = await window.electronAPI.launchGame(game.command, game.id, trackPath, game.name);
        if (launchRes && launchRes.status === 'error') throw new Error(launchRes.message);
    } catch (e) {
        showToast('Error starting game! Make sure it\'s installed.', 'error');
        overlay.classList.remove('active');
        isLaunching = false;
        return;
    }

    const finish = () => {
        window.electronAPI.minimizeApp();
        setTimeout(() => { overlay.classList.remove('active'); isLaunching = false; }, 400);
    };

    const onFocus = () => { finish(); window.removeEventListener('focus', onFocus); };
    window.addEventListener('focus', onFocus);
    setTimeout(() => { if (isLaunching) { finish(); window.removeEventListener('focus', onFocus); } }, 8000);
}

// ============================================================
// 6. IMAGE QUEUE & METADATA
// ============================================================
async function fetchMetadata(imgElement, game) {
    const cacheKey = 'cover_' + game.id;
    const storedCover = localStorage.getItem(cacheKey);

    // 1. In-memory path is already a local file — use it instantly
    if (game.image && game.image.startsWith('file://')) {
        imgElement.src = game.image; checkBackgroundAssets(game); return;
    }

    // 1b. Creator-locked with any URL — trust game.image, skip stale localStorage/server
    if (game.customArtworkLocked === true && game.image) {
        imgElement.src = game.image; checkBackgroundAssets(game); return;
    }

    // 2. localStorage has a local file path
    if (storedCover && storedCover.startsWith('file://')) {
        imgElement.src = storedCover; game.image = storedCover; checkBackgroundAssets(game); return;
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
                        if (localAssets.cover) { game.image = localAssets.cover; localStorage.setItem('cover_' + game.id, localAssets.cover); }
                        if (localAssets.hero)  { game.heroImage = localAssets.hero;  localStorage.setItem('hero_' + game.id, localAssets.hero); }
                        if (localAssets.logo)  { game.logo = localAssets.logo;  localStorage.setItem('logo_' + game.id, localAssets.logo); }
                        console.log(`[BaddelAPIEnrichAssets] ${game.name} cached: hero=${localAssets.hero || 'none'}`);
                        window.electronAPI.saveMetadata(game.id, { cover: localAssets.cover, hero: localAssets.hero, logo: localAssets.logo });

                        // If this game is the active hero target, repaint now that local paths are ready
                        if (currentHeroGameId === String(game.id)) {
                            updateHeroSection(game.id);
                        }

                        // Persist full structured fallback metadata with local disk paths substituted in
                        if (window.electronAPI.saveFullMetadata && meta) {
                            const fullMeta = {
                                ...meta,
                                cover:     localAssets.cover || meta.cover,
                                heroImage: localAssets.hero  || metaHero,
                                hero:      localAssets.hero  || metaHero,
                                logo:      localAssets.logo  || metaLogo,
                            };
                            window.electronAPI.saveFullMetadata(game.id, game.name, game.platform, fullMeta)
                                .catch(() => {});
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
function renderSidebar() {
    const l = document.getElementById('collectionsList');
    if (!l) return;
    l.innerHTML = '';

    const customCollections = allCollections.filter(c => c.id !== 'fav_system_default');

    const favItem = document.getElementById('nav-fav');
    if (favItem) {
        if (currentFilters.collectionId === 'fav_system_default') favItem.classList.add('active');
        else favItem.classList.remove('active');
    }

    customCollections.forEach(c => {
        const i = document.createElement('div');
        i.className = `nav-item ${String(currentFilters.collectionId) === String(c.id) ? 'active' : ''}`;

        const dotColor = c.image ? 'var(--accent)' : '#444';
        i.innerHTML = `
            <div class="nav-icon">
                <div style="width:8px; height:8px; border-radius:50%; background:${dotColor}; box-shadow: 0 0 8px ${dotColor}"></div>
            </div>
            <span class="nav-text">${c.name}</span>
            <span class="delete-btn" onclick="deleteColl(event,'${c.id}')">&#10005;</span>
        `;

        i.setAttribute('data-id', c.id);
        i.onclick = () => filterByCollection(c.id);
        l.appendChild(i);
    });
    updateSidebarActiveState();
}

function updateSidebarActiveState() {
    const h = document.getElementById('nav-home'); // Actually this got renamed or acts as logic
    const inst = document.getElementById('nav-installed');
    
    if (currentView === 'home' && h) h.classList.add('active');
    else if (h) h.classList.remove('active');

    if (currentView === 'installed' && inst) inst.classList.add('active');
    else if (inst) inst.classList.remove('active');

    const f = document.getElementById('nav-fav');
    if (currentFilters.collectionId === 'fav_system_default' && f) f.classList.add('active');
    else if (f) f.classList.remove('active');

    document.querySelectorAll('#collectionsList .nav-item').forEach(i => {
        if (i.getAttribute('data-id') === String(currentFilters.collectionId)) i.classList.add('active');
        else i.classList.remove('active');
    });
}

function toggleSidebar() {
    const s = document.getElementById('mainSidebar'), i = document.getElementById('toggleIcon');
    s.classList.toggle('collapsed');
    i.innerHTML = s.classList.contains('collapsed') ? '&#9654;' : '&#9664;';

    if (typeof _vsRender !== 'function' || typeof _vs === 'undefined') return;
    if (_vs.items.length === 0) return;
    // FIX: Skip _vsRender when in list mode — _vsRender forces grid.style.display='block'
    // which would snap All Games back to grid view when user collapses the sidebar.
    if (window._agDisplayPrefs && window._agDisplayPrefs.viewMode === 'list') return;

    // Match CSS transition duration (250ms).
    // Poll every ~3 frames instead of every frame — columns change at most once.
    const DURATION = 270;
    const POLL_MS   = 48;
    const startTime = performance.now();
    let lastCols = _vs.cols;

    function poll() {
        const elapsed = performance.now() - startTime;
        const grid = document.getElementById('allGamesGrid');
        if (!grid) return;

        const m = _vsMeasure(grid);
        if (m.cols !== lastCols) {
            lastCols = m.cols;
            _vs._gridTopDirty = true;
            _vsRender(true);
        } else if (_vs.rowH !== m.rowH) {
            _vs.rowH = m.rowH;
            const totalRows = Math.ceil(_vs.items.length / _vs.cols);
            grid.style.height = (totalRows * _vs.rowH - _vs.gap) + 'px';
            _vs.cardPool.forEach((rowEl, rowIdx) => {
                rowEl.style.top = (rowIdx * _vs.rowH) + 'px';
            });
        }

        if (elapsed < DURATION) {
            setTimeout(() => requestAnimationFrame(poll), POLL_MS);
        } else {
            // Final pass after transition ends
            _vs._gridTopDirty = true;
            _vsRender(true);
        }
    }

    requestAnimationFrame(poll);
}
function openCollectionModal() { document.getElementById('collName').value = ''; document.getElementById('collectionModal').classList.add('active'); }
function closeCollectionModal() { document.getElementById('collectionModal').classList.remove('active'); }

async function saveCollection() {
    const name = document.getElementById('collName').value.trim();
    if (!name) return showToast('Please enter a name', 'error');
    try {
        await window.electronAPI.createCollection(name, null);
        allCollections = await window.electronAPI.getCollections();
        renderSidebar(); closeCollectionModal(); showToast('Collection Created!', 'success');
    } catch (e) { showToast('Error', 'error'); }
}

function deleteColl(e, id) {
    e.stopPropagation();
    openConfirmModal(
        'Delete Collection?',
        'Delete this collection from your sidebar? Games will stay in your library.',
        'Delete',
        async () => {
            await window.electronAPI.deleteCollection(id);
            allCollections = await window.electronAPI.getCollections();
            if (currentFilters.collectionId === id) currentFilters.collectionId = null;
            renderSidebar();
            if (currentView === 'collection') navigateToInstalled();
        }
    );
}

// ============================================================
// 9. CONTEXT MENU & RECYCLE BIN
// ============================================================
function showContextMenu(x, y, id, name) {
    const m = document.getElementById('contextMenu');
    selectedGameId = id;
    m.setAttribute('data-current-name', name);

    const favColl = allCollections.find(c => c.id === 'fav_system_default');
    const isLiked = favColl && favColl.gameIds.includes(String(id));

    const favAction = isLiked
        ? `<div class="menu-item" onclick="toggleFavorite('${id}', false)"> Remove from Favorites</div>`
        : `<div class="menu-item" onclick="toggleFavorite('${id}', true)"> Add to Favorites</div>`;

    let o = '';
    allCollections.forEach(c => {
        if (c.id !== currentFilters.collectionId && c.id !== 'fav_system_default') {
            o += `<div class="dropdown-item" onclick="addToCollection('${c.id}')">${c.name}</div>`;
        }
    });
    if (o === '') o = `<div class="dropdown-item" style="color:#555;font-size:0.75rem;padding:8px 15px;">No other collections</div>`;

    let removeFromCollAction = '';
    if (currentFilters.collectionId !== null && currentFilters.collectionId !== 'fav_system_default') {
        removeFromCollAction = `<div class="menu-item delete" onclick="removeFromCurrentCollection('${id}')">Remove from Collection</div>`;
    }

    const _ctxGame = allGamesData.find(g => String(g.id) === String(id));
    const trackingEnabled = _ctxGame ? _ctxGame.timeTrackingEnabled !== false : true;
    const trackingItem = trackingEnabled
        ? `<div class="menu-item" onclick="toggleTimeTracking('${id}', false)">Disable Time Tracking</div>`
        : `<div class="menu-item" onclick="toggleTimeTracking('${id}', true)">Enable Time Tracking</div>`;

    m.innerHTML = `
        <div class="menu-item" onclick="triggerPlay()">Play</div>
        ${favAction} <hr>
        <div class="menu-item" style="position:relative" onmouseenter="fixSubmenuPosition(this)">
            <span>Add to Collection <span class="submenu-icon">&#9654;</span></span>
            <div class="submenu">${o}</div>
        </div>
        ${removeFromCollAction}
        ${trackingItem}
        <div class="menu-item" onclick="openGameSettings('${id}')">Game Settings</div>
        <div class="menu-item delete" onclick="triggerRemove()">Remove from Library</div>
    `;

    m.style.display = 'block';
    const fx = x + 200 > window.innerWidth ? x - 200 : x;
    const fy = y + m.offsetHeight > window.innerHeight ? y - m.offsetHeight : y;
    m.style.left = `${fx}px`; m.style.top = `${fy}px`;
}

async function removeFromCurrentCollection(gameId) {
    hideContextMenu();
    if (!currentFilters.collectionId) return;
    try {
        const res = await window.electronAPI.removeGameFromCollection(currentFilters.collectionId, gameId);
        if (res.status === 'success') {
            allCollections = await window.electronAPI.getCollections();
            applyFilters();
            showToast('Removed from collection', 'success');
        } else {
            showToast('Failed to remove from collection', 'error');
        }
    } catch (e) {
        console.error(e);
        showToast('Error removing from collection', 'error');
    }
}

function triggerPlay() { if (selectedGameId) triggerLaunchSequence(selectedGameId); hideContextMenu(); }

async function toggleTimeTracking(gameId, enable) {
    hideContextMenu();
    const game = allGamesData.find(g => String(g.id) === String(gameId));
    if (!game) return;
    try {
        const res = await window.electronAPI.setTimeTrackingEnabled(gameId, enable);
        if (res && res.status === 'success') {
            game.timeTrackingEnabled = enable;
            if (!playtimeData[gameId]) playtimeData[gameId] = { totalMinutes: 0, lastPlayed: null };
            playtimeData[gameId].timeTrackingEnabled = enable;
            if (typeof showToast === 'function')
                showToast(enable ? 'Time tracking enabled for this game' : 'Time tracking disabled for this game', 'info');
        } else {
            const errMsg = (res && res.error) ? res.error : 'Unknown error';
            console.error('[TimeTracking] toggle failed:', errMsg);
            if (typeof showToast === 'function')
                showToast('Could not update time tracking setting', 'error');
        }
    } catch (e) {
        console.error('[TimeTracking] toggle error:', e);
        if (typeof showToast === 'function')
            showToast('Could not update time tracking setting', 'error');
    }
}

function triggerRemove() {
    hideContextMenu();
    openConfirmModal(
        'Move to Recycle Bin?',
        'Are you sure you want to remove this game from your library? It will be moved to the Recycle Bin.',
        'Move to Bin',
        async () => { await confirmDeleteAction(); }
    );
}

async function confirmDeleteAction() {
    try {
        const res = await window.electronAPI.removeGame(selectedGameId);
        if (res.status === 'success') {
            showToast('Game moved to bin!', 'success');
            allGamesData = allGamesData.filter(g => String(g.id) !== String(selectedGameId));
            window.allGamesData = allGamesData; // keep accounts.js in sync
            allCollections = await window.electronAPI.getCollections();
            applyFilters(); 
            renderRecentlyPlayed();
            renderExploreCarousel();
            if (currentHeroGameId === String(selectedGameId)) {
                currentHeroGameId = null;
                applyFilters();
            }
        }
    } catch (err) { console.error(err); }
}

function hideContextMenu() { document.getElementById('contextMenu').style.display = 'none'; fixSubmenuPosition.reset(); }

async function addToCollection(collId) {
    hideContextMenu();
    await window.electronAPI.addGameToCollection(collId, selectedGameId);
    allCollections = await window.electronAPI.getCollections();
    renderSidebar();
    showToast('Added to collection', 'success');
}

async function toggleFavorite(gameId, shouldAdd) {
    hideContextMenu();
    if (shouldAdd) await window.electronAPI.addGameToCollection('fav_system_default', gameId);
    else await window.electronAPI.removeGameFromCollection('fav_system_default', gameId);
    allCollections = await window.electronAPI.getCollections();
    renderSidebar();
    if (currentFilters.collectionId === 'fav_system_default') applyFilters();
}

// Called by the heart button on game cards (outside All Games).
// Toggles favorite state and updates all visible heart buttons for this game.
async function _toggleCardFavorite(gameId) {
    const favColl = allCollections.find(c => c.id === 'fav_system_default');
    const wasFav  = favColl?.gameIds?.includes(String(gameId)) || false;
    const nowFav  = !wasFav;

    if (nowFav) await window.electronAPI.addGameToCollection('fav_system_default', gameId);
    else        await window.electronAPI.removeGameFromCollection('fav_system_default', gameId);

    allCollections = await window.electronAPI.getCollections();
    renderSidebar();

    // Update all visible heart buttons for this game without full re-render
    document.querySelectorAll(`.gc-fav-btn[data-id="${gameId}"]`).forEach(btn => {
        btn.classList.toggle('gc-fav-active', nowFav);
        btn.setAttribute('aria-label', nowFav ? 'Remove from Favorites' : 'Add to Favorites');
        btn.setAttribute('title',      nowFav ? 'Remove from Favorites' : 'Add to Favorites');
        const svg = btn.querySelector('svg');
        if (svg) svg.setAttribute('fill', nowFav ? 'currentColor' : 'none');
    });

    // If currently in Favorites view, remove the card smoothly after un-favoriting
    if (!nowFav && currentFilters.collectionId === 'fav_system_default') {
        const card = document.querySelector(`.game-card[data-id="${gameId}"]`);
        if (card) {
            card.style.transition = 'opacity 0.25s, transform 0.25s';
            card.style.opacity = '0';
            card.style.transform = 'scale(0.93)';
            setTimeout(() => card.remove(), 260);
        }
    }
}

async function openRecycleBin() {
    document.getElementById('recycleModal').classList.add('active');
    const list = document.getElementById('recycleList');
    list.innerHTML = "<div style='padding:20px; color:#555; text-align:center;'>Loading...</div>";
    try {
        const hidden = await window.electronAPI.getHiddenGames();
        list.innerHTML = '';
        if (hidden.length === 0) {
            list.innerHTML = "<div style='padding:30px; color:#444; text-align:center;font-size:0.9rem;'>Recycle bin is empty.</div>";
            return;
        }
        hidden.forEach(g => {
            const div = document.createElement('div');
            div.className = 'bin-item';
            div.innerHTML = `
                <label class="custom-checkbox">
                    <input type="checkbox" value="${g.id}">
                    <span class="checkmark"></span>
                </label>
                <img src="${g.image || 'assets/logo.png'}" style="width:32px;height:32px;border-radius:6px;margin-right:12px;object-fit:cover; border: 1px solid #333;">
                <span style="flex-grow:1; color:#ddd; font-weight:500; font-size:0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-right: 15px;">${g.name}</span>
                <button class="btn-danger" style="padding:6px 12px; font-size:0.75rem; flex-shrink:0;" onclick="hardDeleteGame('${g.id}')">Delete Forever</button>
            `;
            list.appendChild(div);
        });
    } catch (e) { console.error(e); }
}

function closeRecycleBin() { document.getElementById('recycleModal').classList.remove('active'); }

async function restoreSelectedGames() {
    const checks = document.querySelectorAll('#recycleList input[type="checkbox"]:checked');
    const ids = Array.from(checks).map(c => c.value);
    if (ids.length === 0) return;
    await window.electronAPI.restoreSpecificGames(ids);
    closeRecycleBin();
    reloadLibrary();
}

function hardDeleteGame(id) {
    openConfirmModal(
        'Delete Forever?',
        'Permanently delete this game? Data and cached images cannot be recovered.',
        'Delete Forever',
        async () => {
            await window.electronAPI.deleteGamePermanently(id);
            openRecycleBin();
        }
    );
}



function closeGameSettings(){
     pendingImageChanges = {}; 
    document.getElementById('gameSettingsModal').classList.remove('active'); 
    selectedGameId = null;
}


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
function openCollectionSettings(id) {
    currentEditingCollectionId = id;
    const coll = allCollections.find(c => String(c.id) === String(id));
    if (!coll) return;

    const nameInput = document.getElementById('editCollNameInput');
    const deleteBtn = document.querySelector('#collectionSettingsModal .btn-danger');

    nameInput.value = coll.name || 'Favorites';
    document.getElementById('previewCollImage').src = coll.image || '../assets/app_icon.png';

    if (id === 'fav_system_default') {
        nameInput.disabled = true;
        nameInput.style.opacity = '0.5';
        if (deleteBtn) deleteBtn.style.display = 'none';
    } else {
        nameInput.disabled = false;
        nameInput.style.opacity = '1';
        if (deleteBtn) deleteBtn.style.display = 'block';
    }

    document.getElementById('collectionSettingsModal').classList.add('active');
}

function closeCollectionSettings() {
    document.getElementById('collectionSettingsModal').classList.remove('active');
    currentEditingCollectionId = null;
}

function triggerDeleteCollection() {
    if (!currentEditingCollectionId) return;
    openConfirmModal(
        'Delete Collection?',
        'Are you sure you want to delete this collection? Games inside will NOT be deleted from your library.',
        'Delete Collection',
        async () => {
            await window.electronAPI.deleteCollection(currentEditingCollectionId);
            allCollections = await window.electronAPI.getCollections();
            if (String(currentFilters.collectionId) === String(currentEditingCollectionId)) {
                currentFilters.collectionId = null;
            }
            renderSidebar();
            if (currentView === 'collection') navigateToInstalled();
            closeCollectionSettings();
            showToast('Collection deleted', 'success');
        }
    );
}

async function saveCollectionSettings() {
    if (!currentEditingCollectionId) return;
    const newName = document.getElementById('editCollNameInput').value.trim();
    if (!newName) return showToast('Name cannot be empty', 'error');
    try {
        await window.electronAPI.updateCollection(currentEditingCollectionId, newName, undefined);
        const coll = allCollections.find(c => String(c.id) === String(currentEditingCollectionId));
        if (coll) coll.name = newName;
        showToast('Settings saved!', 'success');
        renderSidebar();
        applyFilters();
        closeCollectionSettings();
    } catch (e) {
        console.error(e);
        showToast('Error saving collection', 'error');
    }
}

async function changeCollectionImage() {
    if (!currentEditingCollectionId) return;
    try {
        const newPath = await window.electronAPI.selectImage();
        if (newPath) {
            const safePath = `file://${newPath.replace(/\\/g, '/')}`;
            await window.electronAPI.updateCollection(currentEditingCollectionId, undefined, safePath);
            document.getElementById('previewCollImage').src = safePath;
            document.getElementById('previewCollImage').style.display = 'block';
            const txt = document.getElementById('previewCollText');
            if (txt) txt.style.display = 'none';
            const coll = allCollections.find(c => String(c.id) === String(currentEditingCollectionId));
            if (coll) coll.image = safePath;
            showToast('Custom image applied!', 'success');
            applyFilters();
        }
    } catch (e) { console.error(e); }
}

async function resetCollectionImage() {
    if (!currentEditingCollectionId) return;
    try {
        await window.electronAPI.updateCollection(currentEditingCollectionId, undefined, null);
        const coll = allCollections.find(c => String(c.id) === String(currentEditingCollectionId));
        if (coll) coll.image = null;
        document.getElementById('previewCollImage').src = '';
        document.getElementById('previewCollImage').style.display = 'none';
        const txt = document.getElementById('previewCollText');
        if (txt) txt.style.display = 'flex';
        showToast('Slideshow restored!', 'success');
        applyFilters();
    } catch (e) { console.error(e); }
}

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
function showToast(msgOrOpts, t) {
    let message, type, duration = 3500;
    if (typeof msgOrOpts === 'object' && msgOrOpts !== null) {
        message = msgOrOpts.message || msgOrOpts.title || '';
        type = msgOrOpts.type || t;
        duration = msgOrOpts.duration || 3500;
    } else {
        message = msgOrOpts;
        type = t;
    }
    const w = document.getElementById('toast-wrapper');
    const d = document.createElement('div');
    d.className = `toast-notification ${type === 'error' ? 'toast-error' : ''}`;
    d.innerHTML = `<span>${message}</span>`;
    w.appendChild(d);
    setTimeout(() => { d.style.animation = 'fadeOutUp 0.3s ease forwards'; setTimeout(() => d.remove(), 300); }, duration);
}

function toggleDropdown(e) { if (e) e.stopPropagation(); document.getElementById('dropdownMenu').classList.toggle('active'); }

// ============================================================
// ALL GAMES VIEW - Installed Only Filter
// ============================================================
window.agInstalledOnly = false;

function toggleAgInstalledFilter() {
    window.agInstalledOnly = !window.agInstalledOnly;
    const btn = document.getElementById('agInstalledToggle');
    if (btn) btn.classList.toggle('active', window.agInstalledOnly);
    if (typeof window.filterAllGames === 'function') window.filterAllGames();
}

function fixSubmenuPosition(i) {
    const s = i.querySelector('.submenu');
    if (s) {
        const r = i.getBoundingClientRect();
        if (window.innerWidth - r.right < 200) { s.style.left = 'auto'; s.style.right = '100%'; s.style.borderRadius = '8px 0 8px 8px'; }
        else { s.style.left = '100%'; s.style.right = 'auto'; s.style.borderRadius = '0 8px 8px 8px'; }
    }
}

fixSubmenuPosition.reset = () => {
    document.querySelectorAll('.submenu').forEach(s => { s.style.left = '100%'; s.style.right = 'auto'; });
};

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
// 13. SYSTEM STATS HUD (HIGHLY OPTIMIZED)
// ============================================================
let _prevNetBytes = { rx: 0, tx: 0, ts: 0 };
let _hudInterval = null;
let _isStatsInit = false;
let _isStatsBusy = false;

let isSensorEnabled = localStorage.getItem('baddel_sensors_enabled') !== 'false'; 

function checkAndManagePolling() {
    const isHomeView = (currentView === 'home');
    const hasFocus = document.hasFocus();
    const liveDot = document.getElementById('sysLiveDot');

    if (isSensorEnabled && hasFocus && isHomeView) {
        if (!_hudInterval) {
            _hudInterval = setInterval(_tickStats, 3000);
            _tickStats();
            if (liveDot) liveDot.style.opacity = '1';
        }
    } else {
        if (_hudInterval) {
            clearInterval(_hudInterval);
            _hudInterval = null;
            if (liveDot) liveDot.style.opacity = '0.3';
        }
    }
}

function toggleSensors() {
    isSensorEnabled = !isSensorEnabled;
    localStorage.setItem('baddel_sensors_enabled', isSensorEnabled);

    const btn = document.getElementById('sensorToggleBtn');
    const txt = document.getElementById('sensorToggleText');

    window.electronAPI.logHudSensorToggled?.(isSensorEnabled);

    if (isSensorEnabled) {
        if (btn) btn.classList.remove('off');
        if (txt) txt.innerText = 'SENSORS: ON';
        _tickStats(); 
    } else {
        if (btn) btn.classList.add('off');
        if (txt) txt.innerText = 'SENSORS: OFF';
        _resetStatsUI(); 
    }

    checkAndManagePolling();
}

function _resetStatsUI() {
    _setText('cpuPercent', '0%'); _setBar('cpuBar', 0); _setText('cpuTemp', 'N/A');
    _setText('gpuPercent', '0%'); _setBar('gpuBar', 0); _setText('gpuTemp', 'N/A');
    _setText('ramPercent', '0%'); _setBar('ramBar', 0); _setText('ramUsed', '0 GB');
    _setText('netDown', '0 KB/s'); _setText('netUp', '0 KB/s'); _setText('netPing', '0 ms');
}

async function initSystemStats() {
    if (_isStatsInit) return;
    _isStatsInit = true;
    await _loadStaticInfo();
    const btn = document.getElementById('sensorToggleBtn');
    const txt = document.getElementById('sensorToggleText');
    if (!isSensorEnabled && btn) {
        btn.classList.add('off');
        txt.innerText = 'SENSORS: OFF';
        _resetStatsUI();
    }

    checkAndManagePolling();
    window.addEventListener('focus', checkAndManagePolling);
    window.addEventListener('blur', checkAndManagePolling);
}


async function _loadStaticInfo() {
    try {
        const info = await window.electronAPI.getSystemInfo();
        _setText('osName', info.osName || '—');
        _setText('cpuModel', _shortName(info.cpuModel));
        _setText('cpuCores', `${info.cpuCores} Cores`);
        _setText('ramTotal', `${_fmtBytes(info.totalRam)} Total`);
        _setText('ramSpeed', info.ramSpeed || '—');
        _setText('ramKits', info.ramKitsStr ? `Kits: ${info.ramKitsStr}` : 'Kits: —');
        if (info.gpuModel && info.gpuModel !== '—') {
            _setText('gpuModel', _shortName(info.gpuModel));
            if (info.gpuVram > 0) _setText('gpuVram', `${_fmtBytes(info.gpuVram)} VRAM`);
        } else {
            _setText('gpuModel', 'Integrated');
        }
    } catch (e) { console.warn('Static info error:', e); }
}

async function _tickStats() {
    if (_isStatsBusy) return;
    _isStatsBusy = true;
    try {
        const stats = await window.electronAPI.getLiveStats();
        if (!stats || Object.keys(stats).length === 0) return;

        const cpuPct = stats.cpuLoad || 0;
        _setText('cpuPercent', `${cpuPct}%`);
        _setBar('cpuBar', cpuPct);
        _setText('cpuTemp', stats.cpuTemp ? `${stats.cpuTemp}°C` : 'N/A');

        const ramUsed = stats.usedRam || 0;
        const ramTotal = stats.totalRam || 1;
        const ramPct = Math.round((ramUsed / ramTotal) * 100);
        _setText('ramPercent', `${ramPct}%`);
        _setBar('ramBar', ramPct);
        _setText('ramUsed', _fmtBytes(ramUsed));

        const now = Date.now();
        const rx = stats.netRxBytes || 0;
        const tx = stats.netTxBytes || 0;
        const dt = _prevNetBytes.ts ? (now - _prevNetBytes.ts) / 1000 : 1;
        const down = _prevNetBytes.ts ? Math.max(0, (rx - _prevNetBytes.rx) / dt) : 0;
        const up = _prevNetBytes.ts ? Math.max(0, (tx - _prevNetBytes.tx) / dt) : 0;
        _prevNetBytes = { rx, tx, ts: now };

        _setText('netDown', _fmtSpeed(down));
        _setText('netUp', _fmtSpeed(up));
        _setText('netPing', `${stats.ping || 0} ms`);

        _setText('gpuPercent', `${stats.gpuLoad || 0}%`);
        _setBar('gpuBar', stats.gpuLoad || 0);
        _setText('gpuTemp', stats.gpuTemp ? `${stats.gpuTemp}°C` : '32°C');
    } catch (e) {
        console.error('Stats Tick Error:', e);
    } finally {
        _isStatsBusy = false;
    }
}

function _setText(id, val) { const el = document.getElementById(id); if (el && el.innerText !== val) el.innerText = val; }
function _setBar(id, pct) { const el = document.getElementById(id); if (el) el.style.width = `${Math.min(pct, 100)}%`; }
function _fmtBytes(b) {
    if (!b) return '0 GB';
    if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB';
    if (b >= 1e6) return (b / 1e6).toFixed(0) + ' MB';
    return '0 GB';
}
function _fmtSpeed(bps) {
    if (bps >= 1e6) return (bps / 1e6).toFixed(1) + ' MB/s';
    return (bps / 1e3).toFixed(0) + ' KB/s';
}
function _shortName(name) {
    if (!name) return '—';
    return name.replace(/Intel\(R\)|Core\(TM\)|CPU|NVIDIA GeForce|AMD Radeon/gi, '').replace(/\s+/g, ' ').trim();
}

document.addEventListener('DOMContentLoaded', () => setTimeout(initSystemStats, 1000));

// ============================================================
// CONFIRM MODAL
// ============================================================
let pendingConfirmAction = null;

function openConfirmModal(title, message, buttonText, callback) {
    document.getElementById('confirmTitle').innerHTML = `&#9888; ${escapeHtml(title)}`;
    document.getElementById('confirmMessage').innerText = message;
    document.getElementById('confirmBtn').innerText = buttonText;
    pendingConfirmAction = callback;
    document.getElementById('confirmModal').classList.add('active');
}

function closeConfirmModal() {
    document.getElementById('confirmModal').classList.remove('active');
    pendingConfirmAction = null;
}

async function executeConfirm() {
    if (pendingConfirmAction) {
        const btn = document.getElementById('confirmBtn');
        const originalText = btn.innerText;
        btn.innerText = 'Processing...';
        btn.disabled = true;
        btn.style.opacity = '0.7';
        await pendingConfirmAction();
        btn.innerText = originalText;
        btn.disabled = false;
        btn.style.opacity = '1';
    }
    closeConfirmModal();
}

// ============================================================
// FOOTER PLAYTIME STATS
// ============================================================
let currentPlaytimeFormat = 0;
let currentPlaytimeFilterValue = 'all';

function cyclePlaytimeFormat() {
    currentPlaytimeFormat = (currentPlaytimeFormat + 1) % 5;
    updateFooterStats();
}

function togglePlaytimeDropdown(e) {
    if (e) e.stopPropagation();
    document.getElementById('playtimeMenu').classList.toggle('active');
}

function selectPlaytime(value, text) {
    document.getElementById('selectedPlaytimeText').innerText = text;
    currentPlaytimeFilterValue = value;
    document.getElementById('playtimeMenu').classList.remove('active');
    updateFooterStats();
}

function updateFooterStats() {
    const countEl = document.getElementById('gamesCount');
    if (countEl) countEl.innerText = `${allGamesData.length} Games Installed`;

    const filterType = currentPlaytimeFilterValue;
    let totalMins = 0;

    const now = new Date();
    now.setHours(0, 0, 0, 0);

    for (const id in playtimeData) {
        const gameData = playtimeData[id];
        if (filterType === 'all') {
            totalMins += gameData.totalMinutes || 0;
        } else {
            const sessions = gameData.playSessions || [];
            sessions.forEach(session => {
                if (!session.date) return;
                const [year, month, day] = session.date.split('-');
                const sessionDate = new Date(year, month - 1, day);
                sessionDate.setHours(0, 0, 0, 0);
                const diffDays = Math.floor((now - sessionDate) / (1000 * 60 * 60 * 24));
                if (filterType === 'today' && diffDays === 0) totalMins += session.minutes;
                else if (filterType === 'week' && diffDays <= 7 && diffDays >= 0) totalMins += session.minutes;
                else if (filterType === 'month' && diffDays <= 30 && diffDays >= 0) totalMins += session.minutes;
                else if (filterType === 'year' && diffDays <= 365 && diffDays >= 0) totalMins += session.minutes;
            });
        }
    }

    const hours = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    const timeStr = totalMins > 0 ? `${hours}h ${mins}m` : '0h 0m';

    const timeEl = document.getElementById('totalLifePlaytime');
    if (timeEl) timeEl.innerText = timeStr;
}

// ============================================================
// HELP & FEEDBACK
// ============================================================
function openHelpModal() { document.getElementById('helpModal').classList.add('active'); }
function closeHelpModal() { document.getElementById('helpModal').classList.remove('active'); }

function switchHelpTab(tab) {
    document.querySelectorAll('.help-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.help-content').forEach(c => c.classList.remove('active'));
    if (tab === 'guide') {
        document.querySelectorAll('.help-tab')[0].classList.add('active');
        document.getElementById('tabGuide').classList.add('active');
    } else {
        document.querySelectorAll('.help-tab')[1].classList.add('active');
        document.getElementById('tabFeedback').classList.add('active');
    }
}

async function sendFeedback() {
    const msg = document.getElementById('feedbackMessage').value.trim();
    const name = document.getElementById('feedbackName').value.trim() || 'Gamer';
    if (!msg) return showToast('Please write a message first!', 'error');

    const btn = document.querySelector('#tabFeedback .btn-primary');
    const originalText = btn.innerText;
    btn.innerText = 'Sending...';
    btn.disabled = true;
    btn.style.opacity = '0.7';

    try {
        const response = await fetch('https://formspree.io/f/xnjoqlyo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ Name: name, Message: msg, App: 'Baddel Launcher Feedback' })
        });

        if (response.ok) {
            showToast('Feedback sent successfully! Thank you.', 'success');
            window.electronAPI.logFeedbackSent?.();
            document.getElementById('feedbackMessage').value = '';
            closeHelpModal();
        } else {
            throw new Error('Failed to send');
        }
    } catch (error) {
        console.error(error);
        showToast('Error sending feedback. Check your internet.', 'error');
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
        btn.style.opacity = '1';
    }
}

// ============================================================
// UPDATE SYSTEM
// ============================================================

// الـ state الداخلي للـ update
const _updateState = {
    status: 'idle',      // idle | found | preparing | downloading | ready | error
    newVersion: null,
    pendingRestart: false,
};

// ── helpers ──────────────────────────────────────────────────

function _setUpdateBadge(show, label) {
    const btn = document.getElementById('updateBadgeBtn');
    const lbl = document.getElementById('updateBadgeLabel');
    if (!btn) return;
    btn.style.display = show ? 'flex' : 'none';
    if (lbl && label) lbl.textContent = label;
}

function _setSettingsUpdateRow(stateId) {
    const ids = ['settingsUpdateAvailable','settingsUpdateDownloading','settingsUpdateReady','settingsUpToDate','settingsUpdateError'];
    const row = document.getElementById('settingsUpdateRow');
    if (row) row.style.display = stateId ? 'block' : 'none';
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = (id === stateId) ? 'block' : 'none';
    });
}

function _updateModalState(stateId) {
    const oldStatus = _updateState.status;
    console.log('[UpdateUI] modal state:', oldStatus, '->', stateId);
    ['updateStateAvailable','updateStateDownloading','updateStateReady','updateStateError'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = (id === stateId) ? 'block' : 'none';
    });
    // Keep the Download button disabled while a download is in flight
    const dlBtn = document.getElementById('btnStartDownload');
    if (dlBtn) {
        dlBtn.disabled = (stateId === 'updateStateDownloading');
    }
}

// Reset progress bar + percentage so a new download starts clean
function _resetUpdateProgress() {
    const bar   = document.getElementById('updateProgressBar');
    const pctEl = document.getElementById('updateProgressPct');
    const spEl  = document.getElementById('updateProgressSpeed');
    const infoEl = document.getElementById('updateDownloadInfo');
    if (bar)    bar.style.width     = '0%';
    if (pctEl)  pctEl.textContent   = '0%';
    if (spEl)   spEl.textContent    = '';
    if (infoEl) infoEl.textContent  = '';
    const sbar = document.getElementById('settingsProgressBar');
    const spct = document.getElementById('settingsProgressPct');
    const sspd = document.getElementById('settingsProgressSpeed');
    if (sbar) sbar.style.width   = '0%';
    if (spct) spct.textContent   = '0%';
    if (sspd) sspd.textContent   = '';
}

// Show "Preparing…" sub-label inside the downloading modal state
function _setDownloadSubLabel(text) {
    const el = document.getElementById('updateDownloadSubLabel');
    if (el) el.textContent = text || '';
}

function openUpdateModal() {
    const modal = document.getElementById('updateModal');
    if (!modal) return;
    if (_updateState.status === 'ready') {
        _updateModalState('updateStateReady');
    } else if (_updateState.status === 'downloading' || _updateState.status === 'preparing') {
        _updateModalState('updateStateDownloading');
    } else if (_updateState.status === 'error') {
        _updateModalState('updateStateError');
    } else {
        _updateModalState('updateStateAvailable');
    }
    modal.classList.add('active');
}

function closeUpdateModal() {
    document.getElementById('updateModal')?.classList.remove('active');
}

async function startUpdateDownload() {
    if (_updateState.status === 'ready') {
        // Already downloaded — just open the ready modal
        openUpdateModal();
        return;
    }
    if (_updateState.status === 'preparing' || _updateState.status === 'downloading') {
        // Already in flight — just show the modal
        console.log('[UpdateUI] startUpdateDownload: already in flight, status =', _updateState.status);
        openUpdateModal();
        return;
    }

    // Transition to preparing state immediately
    const oldStatus = _updateState.status;
    _updateState.status = 'preparing';
    console.log('[UpdateUI] state:', oldStatus, '-> preparing (startUpdateDownload)');
    _resetUpdateProgress();
    _updateModalState('updateStateDownloading');
    _setDownloadSubLabel('Preparing download…');
    _setSettingsUpdateRow('settingsUpdateDownloading');
    _setUpdateBadge(true, 'Preparing…');

    // Invoke the main process. Do NOT change the UI based on the return value —
    // update-status / update-error IPC events are the single source of truth for
    // state transitions once the download is in flight.
    try {
        const result = await window.electronAPI.startUpdateDownload();
        if (result && result.ok === false) {
            // Main process rejected synchronously before any download-progress fired.
            // The update-error event will also fire and is the canonical handler,
            // but log here for visibility.
            console.warn('[UpdateUI] startUpdateDownload returned ok:false —', result.error, '(update-error event will handle UI)');
        } else {
            console.log('[UpdateUI] startUpdateDownload invoke resolved ok');
        }
    } catch (err) {
        // IPC channel failure (not a download error) — update-error won't fire, so handle here.
        console.warn('[Update] startUpdateDownload invoke failed (IPC error):', err);
        const oldSt = _updateState.status;
        _updateState.status = 'error';
        console.log('[UpdateUI] state:', oldSt, '-> error (IPC channel failure)');
        const errEl = document.getElementById('updateErrorMsg');
        if (errEl) errEl.textContent = err?.message || 'Could not reach the update service.';
        _updateModalState('updateStateError');
        _setSettingsUpdateRow('settingsUpdateError');
        _setUpdateBadge(false);
        _setDownloadSubLabel('');
    }
}

function installUpdate() {
    const btn = document.querySelector('#updateStateReady .btn-primary');
    if (btn) { btn.textContent = 'Restarting...'; btn.disabled = true; }
    window.electronAPI.sendRestartUpdate();
}

// ── IPC Listeners ─────────────────────────────────────────────
async function settingsCheckForUpdate() {
    const btn = document.getElementById('settingsCheckUpdateBtn');
    if (btn) { btn.textContent = 'Checking...'; btn.disabled = true; }
    _setSettingsUpdateRow(null);
    try {
        await window.electronAPI.checkForUpdates?.();
        // لو في state موجود فعلاً، اعرضه
        if (_updateState.status === 'found') _setSettingsUpdateRow('settingsUpdateAvailable');
        else if (_updateState.status === 'preparing' || _updateState.status === 'downloading') _setSettingsUpdateRow('settingsUpdateDownloading');
        else if (_updateState.status === 'ready') _setSettingsUpdateRow('settingsUpdateReady');
        // لو مفيش حاجة، هيجي الـ onUpdateNotFound event هيتعامل معاه
    } catch {
        _setSettingsUpdateRow('settingsUpdateError');
    } finally {
        if (btn) { btn.textContent = 'Check for Updates'; btn.disabled = false; }
    }
}

// ── IPC Listeners ─────────────────────────────────────────────

// update-status: unified stream from the state machine in main.js
if (window.electronAPI.onUpdateStatus) {
    window.electronAPI.onUpdateStatus((data) => {
        const { status, version, message, progress } = data;
        const oldStatus = _updateState.status;
        switch (status) {
            case 'preparing':
                _updateState.status = 'preparing';
                console.log('[UpdateUI] state:', oldStatus, '-> preparing (update-status)');
                _resetUpdateProgress();
                _updateModalState('updateStateDownloading');
                _setSettingsUpdateRow('settingsUpdateDownloading');
                _setDownloadSubLabel('Preparing download…');
                _setUpdateBadge(true, 'Preparing…');
                break;

            case 'downloading':
                _updateState.status = 'downloading';
                console.log('[UpdateUI] state:', oldStatus, '-> downloading (update-status)');
                _updateModalState('updateStateDownloading');
                _setSettingsUpdateRow('settingsUpdateDownloading');
                _setDownloadSubLabel('');
                break;

            case 'downloaded':
                // handled by onUpdateReady below
                break;

            case 'error': {
                _updateState.status = 'error';
                console.log('[UpdateUI] state:', oldStatus, '-> error (update-status):', message);
                _setDownloadSubLabel('');
                const errEl = document.getElementById('updateErrorMsg');
                if (errEl) errEl.textContent = message || 'Unknown error';
                _setSettingsUpdateRow('settingsUpdateError');
                _setUpdateBadge(false);
                // Show the dedicated error state — never revert to available
                _updateModalState('updateStateError');
                break;
            }
        }
    });
}

// لقي update جديدة
if (window.electronAPI.onUpdateFound) {
    window.electronAPI.onUpdateFound((version) => {
        // Never overwrite an active download or ready state
        if (['preparing', 'downloading', 'ready'].includes(_updateState.status)) {
            console.log('[UpdateUI] Ignoring update-found — current state is', _updateState.status);
            return;
        }
        const oldStatus = _updateState.status;
        _updateState.status = 'found';
        _updateState.newVersion = version;
        console.log('[UpdateUI] state:', oldStatus, '-> found (update-found) version:', version);

        // badge في الـ title bar
        _setUpdateBadge(true, 'Update Available');

        // الـ modal message
        const msg = document.getElementById('updateAvailableMsg');
        if (msg) msg.textContent = `Version ${version} is available. Download it now?`;

        // الـ settings row
        const smsg = document.getElementById('settingsUpdateAvailableMsg');
        if (smsg) smsg.textContent = `Version ${version} is available`;
        _setSettingsUpdateRow('settingsUpdateAvailable');
    });
}

// مفيش update
if (window.electronAPI.onUpdateNotFound) {
    window.electronAPI.onUpdateNotFound(() => {
        if (_updateState.status === 'idle') {
            _setSettingsUpdateRow('settingsUpToDate');
        }
    });
}

// تقدم التحميل
if (window.electronAPI.onUpdateProgress) {
    window.electronAPI.onUpdateProgress((progress) => {
        const oldStatus = _updateState.status;
        if (oldStatus !== 'downloading') {
            console.log('[UpdateUI] state:', oldStatus, '-> downloading (download-progress)');
        }
        _updateState.status = 'downloading';
        _setDownloadSubLabel('');

        // Ensure the modal is on the downloading panel (guards against race with update-found)
        _updateModalState('updateStateDownloading');

        const pct   = progress.percent || 0;
        const speed = ((progress.bytesPerSecond || 0) / 1024 / 1024).toFixed(1);
        const transferred = ((progress.transferred || 0) / 1024 / 1024).toFixed(1);
        const total       = ((progress.total       || 0) / 1024 / 1024).toFixed(1);
        const info = `${transferred} MB / ${total} MB`;

        // modal progress
        const bar  = document.getElementById('updateProgressBar');
        const pctEl = document.getElementById('updateProgressPct');
        const spEl  = document.getElementById('updateProgressSpeed');
        const infoEl = document.getElementById('updateDownloadInfo');
        if (bar)    bar.style.width = `${pct}%`;
        if (pctEl)  pctEl.textContent = `${pct}%`;
        if (spEl)   spEl.textContent  = `${speed} MB/s`;
        if (infoEl) infoEl.textContent = info;

        // settings progress
        const sbar  = document.getElementById('settingsProgressBar');
        const spct  = document.getElementById('settingsProgressPct');
        const sspd  = document.getElementById('settingsProgressSpeed');
        if (sbar) sbar.style.width = `${pct}%`;
        if (spct) spct.textContent = `${pct}%`;
        if (sspd) sspd.textContent = `${speed} MB/s`;

        // badge
        _setUpdateBadge(true, `Downloading ${pct}%`);
    });
}

// التحميل خلص
if (window.electronAPI.onUpdateReady) {
    window.electronAPI.onUpdateReady((version) => {
        _updateState.status = 'ready';
        _updateState.pendingRestart = true;
        _setDownloadSubLabel('');

        // badge
        _setUpdateBadge(true, 'Ready to Install');

        // modal
        _updateModalState('updateStateReady');
        const rmsg = document.getElementById('updateReadyMsg');
        if (rmsg) rmsg.textContent = `Version ${version} downloaded. Restart to apply.`;

        // settings
        const smsg = document.getElementById('settingsUpdateReadyMsg');
        if (smsg) smsg.textContent = `Version ${version} ready. Restart to apply.`;
        _setSettingsUpdateRow('settingsUpdateReady');

        // افتح الـ modal تلقائياً لو مش مفتوح
        const modal = document.getElementById('updateModal');
        if (modal && !modal.classList.contains('active')) {
            openUpdateModal();
        }
    });
}

// خطأ
if (window.electronAPI.onUpdateError) {
    window.electronAPI.onUpdateError((msg) => {
        const oldStatus = _updateState.status;
        console.warn('[UpdateUI] state:', oldStatus, '-> error (update-error):', msg);
        _updateState.status = 'error';
        _setDownloadSubLabel('');
        const errEl = document.getElementById('updateErrorMsg');
        if (errEl) errEl.textContent = msg || 'Something went wrong. Try again.';
        _setSettingsUpdateRow('settingsUpdateError');
        _setUpdateBadge(false);
        // Show the dedicated error state — never revert to the available screen
        _updateModalState('updateStateError');
    });
}

// ── Settings Modal open: refresh analytics + version + update state ──
async function openSettingsModal() {
    const modal  = document.getElementById('settingsModal');
    const toggle = document.getElementById('analyticsToggle');

    // analytics toggle
    if (window.electronAPI && window.electronAPI.isAnalyticsEnabled) {
        const isEnabled = await window.electronAPI.isAnalyticsEnabled();
        if (toggle) toggle.checked = isEnabled;
    }

    // version label
    try {
        if (window.electronAPI.getAppVersion) {
            const ver = await window.electronAPI.getAppVersion();
            const el = document.getElementById('settingsVersionLabel');
            if (el) el.textContent = `v${ver}`;
        }
    } catch {}

    // update state
    if (_updateState.status === 'found')        _setSettingsUpdateRow('settingsUpdateAvailable');
    else if (_updateState.status === 'preparing' || _updateState.status === 'downloading') _setSettingsUpdateRow('settingsUpdateDownloading');
    else if (_updateState.status === 'ready')    _setSettingsUpdateRow('settingsUpdateReady');
    else if (_updateState.status === 'error')    _setSettingsUpdateRow('settingsUpdateError');
    else                                          _setSettingsUpdateRow(null);

    modal.classList.add('active');
}

function closeSettingsModal() {
    document.getElementById('settingsModal').classList.remove('active');
}

async function toggleAnalytics(checkbox) {
    const isEnabled = checkbox.checked;
    try {
        if (isEnabled) {
            // لو فتحه، نبعت للـ Back-end يكريت ملف الـ txt
            await window.electronAPI.grantAnalyticsConsent();
            localStorage.setItem('baddel_analytics_consent_shown', 'true');
            showToast('Analytics enabled. Thank you!', 'success');
        } else {
            // لو قفله، نبعت للـ Back-end يمسح ملف الـ txt
            await window.electronAPI.revokeAnalyticsConsent();
            localStorage.setItem('baddel_analytics_consent_shown', 'true');
            showToast('Analytics disabled.', 'success');
        }
    } catch (err) {
        console.error(err);
        // لو حصل إيرور نرجع الزرار زي ما كان
        checkbox.checked = !isEnabled; 
        showToast('Error saving setting.', 'error');
    }
}