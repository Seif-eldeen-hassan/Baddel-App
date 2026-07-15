// ============================================================
// BADDEL LAUNCHER - RENDERER (app.js)
// ============================================================

// ============================================================
// SPLASH SCREEN — Letterboxed cinematic loader (CSS-driven)
// No canvas needed — bars + meta handled via CSS transitions
// ============================================================
window._stopSplashCanvas = () => { /* no-op: no canvas in this version */ };

// ── Runtime error capture ─────────────────────────────────────────────────────
// In packaged builds these forward unhandled errors to the main process which
// writes them to protected-renderer-runtime.log in userData for post-install
// diagnosis.

window.onerror = function (msg, src, line, col, err) {
    const text = '[onerror] ' + msg + ' at ' + src + ':' + line + ':' + col +
                 (err ? ' — ' + (err.stack || err) : '');
    console.error(text);
    try { if (window.electronAPI && window.electronAPI.logRuntimeError) window.electronAPI.logRuntimeError(text); } catch (_) {}
};

window.onunhandledrejection = function (ev) {
    const reason = ev.reason;
    const text = '[unhandledrejection] ' + (reason && reason.stack ? reason.stack : String(reason));
    console.error(text);
    try { if (window.electronAPI && window.electronAPI.logRuntimeError) window.electronAPI.logRuntimeError(text); } catch (_) {}
};

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
// customSpinIds moved to src/js/app/roulette.js

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

// Logs each startup step to the console so the runtime log captures exactly
// where initialisation stalls or throws in a packaged build.
function traceStartupStep(name, fn) {
    console.log('[Startup]', name, 'start');
    try {
        const result = fn();
        if (result && typeof result.then === 'function') {
            return result
                .then(r  => { console.log('[Startup]', name, 'ok'); return r; })
                .catch(err => { console.error('[Startup]', name, 'failed:', err); throw err; });
        }
        console.log('[Startup]', name, 'ok');
        return result;
    } catch (err) {
        console.error('[Startup]', name, 'failed:', err);
        throw err;
    }
}

// Like traceStartupStep but swallows errors — one failing home section must not
// prevent the rest of the home view from rendering.
function traceHomeStep(name, fn) {
    console.log('[Home]', name, 'start');
    try {
        const result = fn();
        if (result && typeof result.then === 'function') {
            result
                .then(()  => console.log('[Home]', name, 'ok'))
                .catch(err => {
                    const msg = '[Home] ' + name + ' failed: ' + (err && err.stack ? err.stack : String(err));
                    console.error(msg);
                    try { if (window.electronAPI && window.electronAPI.logRuntimeError) window.electronAPI.logRuntimeError(msg); } catch (_) {}
                });
            return result;
        }
        console.log('[Home]', name, 'ok');
        return result;
    } catch (err) {
        const msg = '[Home] ' + name + ' failed: ' + (err && err.stack ? err.stack : String(err));
        console.error(msg);
        try { if (window.electronAPI && window.electronAPI.logRuntimeError) window.electronAPI.logRuntimeError(msg); } catch (_) {}
    }
}

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
        window.__baddelSetCanonicalGamesRegistry?.(games);
        allCollections = collections;

        buildPlaytimeCache(games);
        await migratePlaytimeFromLocalStorage();

        await traceStartupStep('renderSidebar',    () => renderSidebar());
        await traceStartupStep('navigateToHome',   () => navigateToHome());
        await traceStartupStep('initSortable',     () => initSortable());

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

    // Intentional navigation resets scroll and clears any deferred refresh.
    const _navHomeMain = document.getElementById('mainContentArea');
    if (_navHomeMain) _navHomeMain.scrollTop = 0;
    window._homeRefreshPending = false;

    currentFilters.collectionId = null;
    currentFilters.platform = 'all';
    currentFilters.search = '';
    currentHeroGameId = null;
    updateSidebarActiveState();
    syncSidebarActionButton();
    requestAnimationFrame(() => { syncSidebarActionButton(); });

    traceHomeStep('renderRecentlyPlayed',    () => renderRecentlyPlayed());
    traceHomeStep('renderExploreCarousel',   () => renderExploreCarousel());
    traceHomeStep('renderSyncedSuggestions', () => renderSyncedSuggestions());
    traceHomeStep('applyHeroForHome',        () => applyHeroForHome());
    if (typeof window.renderAccountShortcuts === 'function') traceHomeStep('renderAccountShortcuts', () => window.renderAccountShortcuts());
    traceHomeStep('updateFooterStats',       () => updateFooterStats());

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
    const previousScrollLeft = grid.scrollLeft || 0;
    const activeId = document.activeElement?.closest?.('[data-id]')?.dataset?.id || null;
    grid.innerHTML = '';

    // نجيب مثلاً 15 لعبة عشوائية نعرضهم في الـ Carousel (أو ممكن تعرضهم كلهم)
    if (!window._exploreSelectionState && window.BaddelExploreSelection?.createExploreSelectionState) {
        window._exploreSelectionState = window.BaddelExploreSelection.createExploreSelectionState({
            sessionSeed: String(Date.now()),
        });
    }
    const selectedIds = window.BaddelExploreSelection?.selectExploreGameIds
        ? window.BaddelExploreSelection.selectExploreGameIds(allGamesData, window._exploreSelectionState, { limit: 15 })
        : allGamesData.slice(0, 15).map(g => String(g.id));
    const byId = new Map(allGamesData.map(g => [String(g.id), g]));
    const shuffled = selectedIds.map(id => byId.get(String(id))).filter(Boolean);

    if (shuffled.length === 0) {
        grid.innerHTML = '<div class="empty-state" style="width:100%"><div class="empty-title">No games yet.</div></div>';
        return;
    }

    shuffled.forEach(game => grid.appendChild(createGameCard(game)));
    grid.scrollLeft = previousScrollLeft;
    if (activeId) grid.querySelector(`[data-id="${CSS.escape(activeId)}"]`)?.focus?.();
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

        // Re-render recently played when a qualified session changes the ranking, or
        // when any counted playtime exists / lastPlayed is now set (short sessions).
        if (sessionQualified !== false || totalMinutes > 0 || lastPlayed) renderRecentlyPlayed();

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

            if (lastPlayed) {
                const lpEl = card.querySelector('.gc-lastplayed');
                if (lpEl) {
                    const d = new Date(lastPlayed);
                    lpEl.textContent = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
                }
            }
        });
    });
}

// ============================================================
// REAL-TIME LIBRARY + IMAGE UPDATES FROM MAIN PROCESS
// ============================================================

// Walk a priority list of candidate scroll containers and return the first one
// that is actually scrolled (scrollTop > 0). Falls back to the first element
// that CAN scroll, so we never blindly assume mainContentArea is the scroller.
function _getActiveScrollContainer() {
    const candidates = [
        { el: document.getElementById('mainContentArea'),   name: 'mainContentArea' },
        { el: document.querySelector('.main-content'),      name: '.main-content' },
        { el: document.querySelector('.content'),           name: '.content' },
        { el: document.querySelector('.page-content'),      name: '.page-content' },
        { el: document.querySelector('.dashboard-content'), name: '.dashboard-content' },
        { el: document.scrollingElement,                    name: 'scrollingElement' },
        { el: document.documentElement,                     name: 'documentElement' },
        { el: document.body,                                name: 'body' },
    ].filter(function(c) { return c.el != null; });

    var scrolled = candidates.find(function(c) { return c.el.scrollTop > 0; });
    if (scrolled) return scrolled;

    if (window.scrollY > 0) return { el: null, name: 'window' };

    var canScroll = candidates.find(function(c) { return c.el.scrollHeight > c.el.clientHeight + 1; });
    if (canScroll) return canScroll;

    return candidates[0] || { el: document.documentElement, name: 'documentElement' };
}
window._getActiveScrollContainer = _getActiveScrollContainer;

// Saves the active scroll position, runs fn(), then restores it at five timing
// points (after fn, rAF1, rAF2, 50 ms, 150 ms) so layout shifts from innerHTML
// clearing and image loading cannot permanently clamp the user's position.
// Intentional navigation (wheel/touchstart during the update) aborts restoration.
// Only use this for background data updates — user navigation resets scroll normally.
function _preserveActiveScrollDuring(reason, fn) {
    var snapView = typeof currentView !== 'undefined' ? currentView : null;
    var _sc = _getActiveScrollContainer();
    var scrollEl   = _sc.el;
    var scrollName = _sc.name;
    var savedTop   = scrollEl ? scrollEl.scrollTop  : (window.scrollY || 0);
    var savedLeft  = scrollEl ? scrollEl.scrollLeft : 0;

    // Detect intentional user scroll via wheel/touchstart — do not fight the user.
    var _userScrolled = false;
    var _markUserScroll = function() { _userScrolled = true; };
    var _targetEl = scrollEl || document.getElementById('mainContentArea');
    if (_targetEl) {
        _targetEl.addEventListener('wheel', _markUserScroll, { passive: true, capture: true });
        _targetEl.addEventListener('touchstart', _markUserScroll, { passive: true, capture: true });
    }

    var _cleanup = function() {
        if (_targetEl) {
            _targetEl.removeEventListener('wheel', _markUserScroll, { capture: true });
            _targetEl.removeEventListener('touchstart', _markUserScroll, { capture: true });
        }
    };

    var _restore = function() {
        var nowView = typeof currentView !== 'undefined' ? currentView : null;
        if (nowView !== snapView) { _cleanup(); return; }
        if (_userScrolled && savedTop > 0) { _cleanup(); return; }
        if (scrollEl) {
            scrollEl.scrollTop  = savedTop;
            scrollEl.scrollLeft = savedLeft;
        } else {
            window.scrollTo(0, savedTop);
        }
        if (typeof window._vsRender === 'function') window._vsRender(false);
    };

    var result = fn();

    if (result && typeof result.then === 'function') {
        result.then(
            function() {
                _restore();
                requestAnimationFrame(function() {
                    _restore();
                    requestAnimationFrame(function() {
                        _restore();
                        setTimeout(function() {
                            _restore();
                            setTimeout(function() { _restore(); _cleanup(); }, 100);
                        }, 50);
                    });
                });
            },
            function() { _restore(); _cleanup(); }
        );
    } else {
        requestAnimationFrame(function() {
            _restore();
            requestAnimationFrame(function() {
                _restore();
                setTimeout(function() {
                    _restore();
                    setTimeout(function() { _restore(); _cleanup(); }, 100);
                }, 50);
            });
        });
    }

    return result;
}
window._preserveActiveScrollDuring = _preserveActiveScrollDuring;

// ── Home deferred refresh ─────────────────────────────────────────────────────
// When the user is scrolled down on Home, background syncs skip structural DOM
// mutations (innerHTML clears collapse container height and clamp scrollTop to 0).
// The Ready to Install count is still updated via textContent-only patching on
// the existing element. A full refresh is deferred until intentional navigation.

function _homeIsUserScrolled() {
    const main = document.getElementById('mainContentArea');
    return typeof currentView !== 'undefined'
        && currentView === 'home'
        && !!main
        && main.scrollTop > 40;
}
window._homeIsUserScrolled = _homeIsUserScrolled;

window._homeRefreshPending = false;
window._homeRefreshPendingReason = '';
function _markHomeRefreshPending(reason) {
    const main = document.getElementById('mainContentArea');
    window._homeRefreshPending = true;
    window._homeRefreshPendingReason = reason || 'background-update';
    console.log('[HomeRefresh] deferred reason=' + (reason || 'background-update') + ' scrollTop=' + (main ? main.scrollTop : 0));
}
window._markHomeRefreshPending = _markHomeRefreshPending;

function _flushPendingHomeRefreshIfSafe(reason) {
    if (!window._homeRefreshPending) return;
    if (_homeIsUserScrolled()) return;
    window._homeRefreshPending = false;
    console.log('[HomeRefresh] flushed reason=' + (reason || 'unknown'));
    if (typeof renderRecentlyPlayed === 'function') renderRecentlyPlayed();
    if (typeof renderExploreCarousel === 'function') renderExploreCarousel();
    if (typeof applyHeroForHome === 'function') applyHeroForHome();
    if (typeof renderSyncedSuggestions === 'function') renderSyncedSuggestions();
}
window._flushPendingHomeRefreshIfSafe = _flushPendingHomeRefreshIfSafe;

// Updates only the Ready to Install count text on the existing Home count element.
// Safe to call while the user is scrolled — does not use innerHTML, does not
// create elements, and does not change any display styles or layout.
function _updateHomeReadyCountTextOnly(count) {
    if (typeof currentView === 'undefined' || currentView !== 'home') return false;
    const statsEl = document.getElementById('syncedSuggStats');
    if (!statsEl) return false;
    const countEl =
        statsEl.querySelector('[data-ready-count]') ||
        statsEl.querySelector('.synced-count-inline .sci-num.green');
    if (!countEl) return false;
    countEl.textContent = count == null ? '…' : String(count);
    return true;
}
window._updateHomeReadyCountTextOnly = _updateHomeReadyCountTextOnly;

function _mergeCanonicalArtworkAcrossLibrary(updatedGames, previousGames = []) {
    const projection = window.BaddelCanonicalArtworkProjection;
    const explicitPrevious = previousGames.filter(g =>
        g?.customArtworkLocked === true &&
        (g.artworkSource === 'settings' || g.artworkSource === 'creator')
    );
    const canonicalRecords = Array.isArray(window.__baddelCanonicalGames) ? window.__baddelCanonicalGames : [];
    const records = [...canonicalRecords, ...explicitPrevious];

    return updatedGames.map(g => {
        const prev = previousGames.find(p => String(p.id) === String(g.id));
        let merged = g;

        if (projection && typeof projection.projectFromRecords === 'function') {
            merged = projection.projectFromRecords(g, records);
            if (merged?._artworkIdentityMatchReason && merged.customArtworkLocked === true) {
                console.info('[ArtworkIdentity] uiId=' + String(g.id || '') +
                    ' canonicalId=' + String(merged.localGameId || merged.id || '') +
                    ' matchReason=' + String(merged._artworkIdentityMatchReason || '') +
                    ' source=' + String(merged.artworkSource || 'settings') +
                    ' artworkUpdatedAt=' + String(merged.artworkUpdatedAt || ''));
                return _normalizeArtworkAliases(merged);
            }
        }

        if (!prev) return _normalizeArtworkAliases(merged);
        return _normalizeArtworkAliases({
            ...merged,
            image:        merged.image        || prev.image        || null,
            defaultImage: merged.defaultImage || prev.defaultImage || null,
            coverUrl:     merged.coverUrl     || prev.coverUrl     || null,
            heroImage:    merged.heroImage    || prev.heroImage    || null,
            defaultHero:  merged.defaultHero  || prev.defaultHero  || null,
            logo:         merged.logo         || prev.logo         || null,
            defaultLogo:  merged.defaultLogo  || prev.defaultLogo  || null,
        });
    });
}

// Full library refresh (background scan completed)
if (window.electronAPI.onLibraryUpdated) {
    window.electronAPI.onLibraryUpdated(async (updatedGames) => {
        await window.__baddelRefreshCanonicalGamesRegistry?.('library' + '-updated');
        const mergedGames = _mergeCanonicalArtworkAcrossLibrary(updatedGames, allGamesData);
        allGamesData = mergedGames;
        window.allGamesData = allGamesData; // keep accounts.js in sync
        window._readyToInstallRenderedGames = null; // invalidate stale RTI page count

        // Sidebar is always safe — it lives outside the main scroll container.
        renderSidebar();

        if (currentView === 'home') {
            if (_homeIsUserScrolled()) {
                // User has scrolled down — skip all Home DOM mutations to prevent
                // innerHTML clears from clamping scrollTop to 0. Flush when safe.
                _markHomeRefreshPending('library-updated-home-scrolled');
            } else {
                renderRecentlyPlayed();
                renderExploreCarousel();
                applyHeroForHome();
                renderSyncedSuggestions();
            }
        } else if (currentView === 'all-games') {
            // All Games background updates are owned by accounts.js onLibraryUpdated.
            // Do not run the Installed Games applyFilters() while All Games is active.
            if (typeof window._onSyncLibraryUpdated === 'function') window._onSyncLibraryUpdated();
        } else {
            _preserveActiveScrollDuring('library-updated', () => {
                applyFilters();
                if (typeof window._onSyncLibraryUpdated === 'function') window._onSyncLibraryUpdated();
            });
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

        const mergedGames = _mergeCanonicalArtworkAcrossLibrary(updatedGames, allGamesData);

        allGamesData = mergedGames;
        window.allGamesData = allGamesData; // keep accounts.js in sync
        await window.__baddelRefreshCanonicalGamesRegistry?.('scan-all-games');
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
// 3. CARD RENDERING & RECENTLY PLAYED — moved to src/js/app/game-card.js
// ============================================================

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
    window.__baddelUpsertCanonicalGameRegistry?.(normalized);
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
    const hasExplicitArtwork =
        game.customArtworkLocked === true &&
        (game.artworkSource === 'settings' || game.artworkSource === 'creator');

    // 1. In-memory path is already a local file — probe it first (may be gone after Delete Forever)
    if (game.image && game.image.startsWith('file://')) {
        const alive = await window.electronAPI.probeLocalImage(game.image).catch(() => false);
        if (alive) { imgElement.src = game.image; checkBackgroundAssets(game); return; }
        // File is gone — clear stale references so we fall through to a fresh fetch
        game.image = null; game.defaultImage = null; game.coverUrl = null;
        localStorage.removeItem('cover_' + game.id);
    }

    // 1b. Creator-locked with any URL — trust game.image, skip stale localStorage/server
    if (hasExplicitArtwork && game.image) {
        imgElement.src = game.image; checkBackgroundAssets(game); return;
    }

    if (hasExplicitArtwork && !game.image) {
        localStorage.removeItem(cacheKey);
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
            if (diskCover && !hasExplicitArtwork) {
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
    const expectedUpdatedAt = game?.artworkUpdatedAt || null;
    const canApplyHydrated = (type) => {
        if (typeof shouldApplyHydratedArtwork === 'function') {
            return shouldApplyHydratedArtwork({ game, type, expectedUpdatedAt });
        }
        return !(game?.customArtworkLocked === true && (game.artworkSource === 'settings' || game.artworkSource === 'creator'));
    };

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
            if (metaHero && canApplyHydrated('hero')) game.heroImage = metaHero;
            if (metaLogo && canApplyHydrated('logo')) game.logo = metaLogo;
            if (meta.cover && canApplyHydrated('cover')) { game.image = meta.cover; imgElement.src = meta.cover; }

            console.log(`[BaddelAPIEnrichAssets] ${game.name} (${game.id}): cover=${!!meta.cover} hero=${!!metaHero} logo=${!!metaLogo}`);

            if (window.electronAPI.cacheAllAssets) {
                window.electronAPI.cacheAllAssets({ cover: meta.cover, hero: metaHero, logo: metaLogo }, game.id)
                    .then(localAssets => {
                        const finalCover = localAssets.cover || meta.cover || null;
                        const finalHero  = localAssets.hero  || metaHero  || null;
                        const finalLogo  = localAssets.logo  || metaLogo  || null;

                        if (finalCover && canApplyHydrated('cover')) {
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
                        if (finalHero && canApplyHydrated('hero')) {
                            game.heroImage = finalHero; game.defaultHero = finalHero; game.heroUrl = finalHero;
                            localStorage.setItem('hero_' + game.id, finalHero);
                        }
                        if (finalLogo && canApplyHydrated('logo')) {
                            game.logo = finalLogo; game.defaultLogo = finalLogo; game.logoUrl = finalLogo;
                            localStorage.setItem('logo_' + game.id, finalLogo);
                        }

                        console.log(`[BaddelAPIEnrichAssets] ${game.name} cached: cover=${finalCover || 'none'} hero=${finalHero || 'none'}`);

                        const patched = _patchGameInMemory({
                            ...game,
                            image: canApplyHydrated('cover') ? (finalCover || game.image) : game.image,
                            defaultImage: canApplyHydrated('cover') ? (finalCover || game.defaultImage) : game.defaultImage,
                            coverUrl: canApplyHydrated('cover') ? (finalCover || game.coverUrl) : game.coverUrl,
                            heroImage: canApplyHydrated('hero') ? (finalHero || game.heroImage) : game.heroImage,
                            defaultHero: canApplyHydrated('hero') ? (finalHero || game.defaultHero) : game.defaultHero,
                            heroUrl: canApplyHydrated('hero') ? (finalHero || game.heroUrl) : game.heroUrl,
                            logo: canApplyHydrated('logo') ? (finalLogo || game.logo) : game.logo,
                            defaultLogo: canApplyHydrated('logo') ? (finalLogo || game.defaultLogo) : game.defaultLogo,
                            logoUrl: canApplyHydrated('logo') ? (finalLogo || game.logoUrl) : game.logoUrl,
                        });
                        _patchVisibleGameCard(patched);

                        const saveCover = canApplyHydrated('cover') ? finalCover : null;
                        const saveHero  = canApplyHydrated('hero') ? finalHero : null;
                        const saveLogo  = canApplyHydrated('logo') ? finalLogo : null;
                        if (saveCover || saveHero || saveLogo) {
                            window.electronAPI.saveMetadata(game.id, { cover: saveCover, hero: saveHero, logo: saveLogo }).catch(() => {});
                        }

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
    if (game?.customArtworkLocked === true && (game.artworkSource === 'settings' || game.artworkSource === 'creator')) return;
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
// 12. SURPRISE ME (ROULETTE) — moved to src/js/app/roulette.js
// ============================================================

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
