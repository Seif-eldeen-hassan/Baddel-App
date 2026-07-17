// ============================================================
// BADDEL LAUNCHER - RENDERER (app.js)
// ============================================================

// ============================================================
// SPLASH SCREEN — Letterboxed cinematic loader (CSS-driven)
// No canvas needed — bars + meta handled via CSS transitions
// ============================================================
window.__baddelStartupMetrics = window.__baddelStartupMetrics || {
    rendererInitAt: (typeof performance !== 'undefined' && performance?.now) ? performance.now() : Date.now(),
    firstShellAt: null,
    splashHiddenAt: null,
    firstHomePaintAt: null,
    firstExploreCoverAt: null,
    allVisibleExploreCoversAt: null,
    cacheIpcCount: 0,
    artworkHttpDownloadCount: 0,
};

window._splashTimers = window._splashTimers || new Set();
window._splashIntervals = window._splashIntervals || new Set();
window._splashRafId = null;
window._splashAudioContext = null;
window._stopSplashCanvas = () => {
    if (window._splashRafId != null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(window._splashRafId);
    }
    window._splashRafId = null;
    for (const timer of window._splashTimers || []) clearTimeout(timer);
    for (const interval of window._splashIntervals || []) clearInterval(interval);
    window._splashTimers?.clear?.();
    window._splashIntervals?.clear?.();
    if (window._splashAudioContext?.close) {
        window._splashAudioContext.close().catch(() => {});
    }
    window._splashAudioContext = null;
    window._splashCounterInterval = null;
    window._splashClockInterval = null;
};

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
        window._splashAudioContext = ctx;

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
    const splashSetTimeout = (fn, ms) => {
        const id = setTimeout(() => {
            window._splashTimers.delete(id);
            fn();
        }, ms);
        window._splashTimers.add(id);
        return id;
    };
    const splashSetInterval = (fn, ms) => {
        const id = setInterval(fn, ms);
        window._splashIntervals.add(id);
        return id;
    };

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
            window._splashRafId = requestAnimationFrame(drawParticles);
        }
        splashSetTimeout(() => {
            canvas.classList.add('visible');
            window._splashRafId = requestAnimationFrame(drawParticles);
        }, 40);
    }

    // ── Scan line sweep ─────────────────────────────────
    if (scanLine) {
        splashSetTimeout(() => {
            const H = window.innerHeight;
            scanLine.style.opacity = '1';
            scanLine.style.transition = 'top 0.35s cubic-bezier(.4,0,.6,1)';
            scanLine.style.top = '0px';
            requestAnimationFrame(() => requestAnimationFrame(() => {
                scanLine.style.top = H + 'px';
                splashSetTimeout(() => {
                    scanLine.style.opacity = '0';
                    scanLine.style.top = '-2px';
                    scanLine.style.transition = 'none';
                }, 380);
            }));
        }, 40);
    }

    // ── Corners ─────────────────────────────────────────
    splashSetTimeout(() => {
        corners.forEach(c => c.classList.add('visible'));
    }, 80);

    // ── HUD top ──────────────────────────────────────────
    splashSetTimeout(() => {
        if (hudTop) hudTop.classList.add('visible');
        if (hudClock) {
            const tick = () => {
                const now = new Date();
                hudClock.textContent = [now.getHours(), now.getMinutes(), now.getSeconds()]
                    .map(n => String(n).padStart(2, '0')).join(':');
            };
            tick();
            window._splashClockInterval = splashSetInterval(tick, 1000);
        }
    }, 100);

    // ── HUD bottom + frame counter ───────────────────────
    splashSetTimeout(() => {
        if (hudBot) hudBot.classList.add('visible');
        if (frameEl) {
            let f = 0;
            window._splashCounterInterval = splashSetInterval(() => {
                f++;
                frameEl.textContent = String(f).padStart(2, '0');
                if (f >= 30) {
                    clearInterval(window._splashCounterInterval);
                    window._splashIntervals.delete(window._splashCounterInterval);
                    window._splashCounterInterval = null;
                }
            }, 33);
        }
    }, 120);

    // ── Logo ring + logo ─────────────────────────────────
    splashSetTimeout(() => {
        if (logoWrap) logoWrap.classList.add('visible');
    }, 140);

    // ── Name wipe ────────────────────────────────────────
    splashSetTimeout(() => {
        name.classList.add('visible');
    }, 160);

    // ── Tagline ──────────────────────────────────────────
    splashSetTimeout(() => {
        if (sub) sub.classList.add('visible');
    }, 200);

    // ── Status row + cycle ───────────────────────────────
    splashSetTimeout(() => {
        if (statusRow) statusRow.classList.add('visible');
        if (statusTxt) {
            const messages = ['STARTING', 'OPENING HOME', 'READY'];
            let idx = 0;
            const iv = splashSetInterval(() => {
                idx++;
                statusTxt.style.opacity = '0';
                splashSetTimeout(() => {
                    statusTxt.textContent = messages[idx];
                    statusTxt.style.opacity = '1';
                }, 80);
                if (idx >= messages.length - 1) {
                    clearInterval(iv);
                    window._splashIntervals.delete(iv);
                }
            }, 180);
        }
    }, 220);

    // ── Progress bar fills over 3s ───────────────────────
    splashSetTimeout(() => {
        if (bar) {
            bar.style.transition = 'transform 0.45s ease-in-out';
            bar.style.width = '45%';
            bar.style.transform = 'translateX(140%)';
        }
    }, 80);
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

function _dedupeDelegatedLaunchProducts(games) {
    const service = window.BaddelCanonicalProductIdentity;
    return service?.dedupeDelegatedLaunchProducts
        ? service.dedupeDelegatedLaunchProducts(games)
        : games;
}

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
function _baddelPerfNow() {
    return (typeof performance !== 'undefined' && performance && typeof performance.now === 'function')
        ? performance.now()
        : Date.now();
}

function _baddelPerfLog(name, payload = {}) {
    try {
        const clean = { ...payload };
        if (Number.isFinite(clean.durationMs)) clean.durationMs = Math.round(clean.durationMs);
        if (Number.isFinite(clean.elapsedMs)) clean.elapsedMs = Math.round(clean.elapsedMs);
        console.info('[StartupPerf]', name, clean);
    } catch (_) {}
}

function _baddelScheduleDeferredTask(name, fn, timeout = 250) {
    const run = () => {
        Promise.resolve()
            .then(() => traceStartupStep(`deferred:${name}`, fn))
            .catch(err => {
                console.warn('[StartupDeferred]', name, 'failed:', err?.message || err);
            });
    };
    if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(run, { timeout });
    } else {
        setTimeout(run, timeout);
    }
}

function _baddelLogStartupSummary(reason = 'shell-visible') {
    const m = window.__baddelStartupMetrics || {};
    const now = _baddelPerfNow();
    try {
        console.info('[StartupSummary]', {
            reason,
            rendererInitToFirstShellMs: m.firstShellAt && m.rendererInitAt ? Math.round(m.firstShellAt - m.rendererInitAt) : null,
            visibleSplashDurationMs: m.splashHiddenAt && m.rendererInitAt ? Math.round(m.splashHiddenAt - m.rendererInitAt) : null,
            firstHomePaintMs: m.firstHomePaintAt && m.rendererInitAt ? Math.round(m.firstHomePaintAt - m.rendererInitAt) : null,
            firstExploreCoverMs: m.firstExploreCoverAt && m.rendererInitAt ? Math.round(m.firstExploreCoverAt - m.rendererInitAt) : null,
            allVisibleExploreCoversMs: m.allVisibleExploreCoversAt && m.rendererInitAt ? Math.round(m.allVisibleExploreCoversAt - m.rendererInitAt) : null,
            backgroundScanDurationMs: Number.isFinite(Number(m.backgroundScanDurationMs)) ? Math.round(Number(m.backgroundScanDurationMs)) : null,
            cacheIpcCount: Number(m.cacheIpcCount || 0),
            artworkHttpDownloadCount: Number(m.artworkHttpDownloadCount || 0),
            atMs: Math.round(now),
        });
    } catch (_) {}
}

function traceStartupStep(name, fn) {
    const startedAt = _baddelPerfNow();
    console.log('[Startup]', name, 'start');
    try {
        const result = fn();
        if (result && typeof result.then === 'function') {
            return result
                .then(r  => {
                    console.log('[Startup]', name, 'ok');
                    _baddelPerfLog(name, { durationMs: _baddelPerfNow() - startedAt, ok: true });
                    return r;
                })
                .catch(err => {
                    _baddelPerfLog(name, { durationMs: _baddelPerfNow() - startedAt, ok: false });
                    console.error('[Startup]', name, 'failed:', err);
                    throw err;
                });
        }
        console.log('[Startup]', name, 'ok');
        _baddelPerfLog(name, { durationMs: _baddelPerfNow() - startedAt, ok: true });
        return result;
    } catch (err) {
        _baddelPerfLog(name, { durationMs: _baddelPerfNow() - startedAt, ok: false });
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
    const SPLASH_MIN_MS = Number(window.__baddelSplashMinMs ?? 450);
    const SPLASH_FADE_MS = Number(window.__baddelSplashFadeMs ?? 120);
    const splashStart   = _baddelPerfNow();

    function hideSplash(loader, grid) {
        const elapsed   = _baddelPerfNow() - splashStart;
        const remaining = Math.max(0, SPLASH_MIN_MS - elapsed);
        setTimeout(() => {
            if (loader) {
                loader.style.opacity = '0';
                setTimeout(() => {
                    loader.classList.remove('active');
                    loader.style.visibility    = 'hidden';
                    loader.style.pointerEvents = 'none';
                    if (typeof window._stopSplashCanvas === 'function') window._stopSplashCanvas();
                    if (typeof initAnalyticsConsent === 'function') initAnalyticsConsent();
                    if (window.__baddelStartupMetrics) {
                        window.__baddelStartupMetrics.splashHiddenAt = _baddelPerfNow();
                    }
                    _baddelPerfLog('splashDuration', {
                        elapsedMs: _baddelPerfNow() - splashStart,
                        minMs: SPLASH_MIN_MS,
                        fadeMs: SPLASH_FADE_MS,
                    });
                    _baddelLogStartupSummary('splash-hidden');
                }, SPLASH_FADE_MS);
            }
            if (grid) grid.style.display = 'grid';
            _dispatchHomeVisibleWhenReady('startup-splash-complete');
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
            traceStartupStep('getGames', () => window.electronAPI.getGames()),
            traceStartupStep('getCollections', () => window.electronAPI.getCollections())
        ]);

        allGamesData = _dedupeDelegatedLaunchProducts(games);
        window.allGamesData = allGamesData; // keep accounts.js in sync
        window.__baddelSetCanonicalGamesRegistry?.(allGamesData);
        allCollections = collections;

        await traceStartupStep('renderSidebar',    () => renderSidebar());
        await traceStartupStep('navigateToHomeShell', () => navigateToHome({ shellOnly: true }));

        hideSplash(loader, grid);
        _baddelScheduleDeferredTask('buildPlaytimeCache', () => buildPlaytimeCache(allGamesData));
        _baddelScheduleDeferredTask('migratePlaytimeFromLocalStorage', () => migratePlaytimeFromLocalStorage());
        _baddelScheduleDeferredTask('hydrateSidebarAllGamesCount', () => {
            if (typeof window.hydrateSidebarAllGamesCount === 'function') return window.hydrateSidebarAllGamesCount('startup-cache');
        });
        _baddelScheduleDeferredTask('renderRecentlyPlayed', () => renderRecentlyPlayed());
        _baddelScheduleDeferredTask('renderExploreCarousel', () => renderExploreCarousel());
        _baddelScheduleDeferredTask('renderSyncedSuggestions', () => renderSyncedSuggestions());
        _baddelScheduleDeferredTask('applyHeroForHome', () => applyHeroForHome());
        _baddelScheduleDeferredTask('renderAccountShortcuts', () => {
            if (typeof window.renderAccountShortcuts === 'function') return window.renderAccountShortcuts();
        });
        _baddelScheduleDeferredTask('updateFooterStats', () => updateFooterStats());
        _baddelScheduleDeferredTask('initSortable', () => initSortable());

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

if (window.electronAPI?.onInstalledGamesScanState) {
    window.electronAPI.onInstalledGamesScanState((payload = {}) => {
        if (window.__baddelStartupMetrics) {
            if (payload.state === 'scan-started') {
                window.__baddelStartupMetrics.backgroundScanStartedAt = _baddelPerfNow();
            }
            if (payload.state === 'scan-finished' || payload.state === 'scan-failed') {
                window.__baddelStartupMetrics.backgroundScanDurationMs = Number(payload.durationMs || 0) || (
                    window.__baddelStartupMetrics.backgroundScanStartedAt
                        ? _baddelPerfNow() - window.__baddelStartupMetrics.backgroundScanStartedAt
                        : null
                );
                _baddelLogStartupSummary(payload.state);
            }
        }
        try {
            console.info('[InstalledGamesScanState]', {
                state: payload.state || 'unknown',
                source: payload.source || 'unknown',
                count: Number(payload.count || 0),
                durationMs: Number(payload.durationMs || 0) || null,
            });
        } catch (_) {}
    });
}

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
    const options = arguments[0] || {};
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

    if (options.shellOnly) {
        if (window.__baddelStartupMetrics && !window.__baddelStartupMetrics.firstShellAt) {
            window.__baddelStartupMetrics.firstShellAt = _baddelPerfNow();
        }
        _baddelPerfLog('firstShell', { durationMs: _baddelPerfNow() - (window.__baddelStartupMetrics?.rendererInitAt || _baddelPerfNow()) });
        return;
    }

    traceHomeStep('renderRecentlyPlayed',    () => renderRecentlyPlayed());
    traceHomeStep('renderExploreCarousel',   () => renderExploreCarousel());
    traceHomeStep('renderSyncedSuggestions', () => renderSyncedSuggestions());
    traceHomeStep('applyHeroForHome',        () => applyHeroForHome());
    if (typeof window.renderAccountShortcuts === 'function') traceHomeStep('renderAccountShortcuts', () => window.renderAccountShortcuts());
    traceHomeStep('updateFooterStats',       () => updateFooterStats());
    _dispatchHomeVisibleWhenReady('navigation');

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
function _dispatchHomeVisibleWhenReady(reason = 'navigation') {
    const fire = () => {
        if (window.__baddelStartupMetrics && !window.__baddelStartupMetrics.firstHomePaintAt) {
            window.__baddelStartupMetrics.firstHomePaintAt = _baddelPerfNow();
            _baddelLogStartupSummary('first-home-paint');
        }
        try {
            window.dispatchEvent(new CustomEvent('baddel:home-visible', {
                detail: { reason },
            }));
        } catch (_) {}
    };
    const raf = typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (cb) => setTimeout(cb, 0);
    raf(() => raf(fire));
}

function _exploreCoverValue(game) {
    if (!game) return null;
    const model = window.BaddelGameArtworkReadModel?.createReadModel
        ? window.BaddelGameArtworkReadModel.createReadModel(game, game, {})
        : null;
    return model?.cover?.effectiveValue || game.image || game.defaultImage || game.coverUrl || game.cover || null;
}

function _exploreArtworkValues(game) {
    if (!game) return { cover: null, hero: null, logo: null };
    const model = window.BaddelGameArtworkReadModel?.createReadModel
        ? window.BaddelGameArtworkReadModel.createReadModel(game, game, {})
        : null;
    return {
        cover: model?.cover?.effectiveValue || game.image || game.defaultImage || game.coverUrl || game.cover || null,
        hero:  model?.hero?.effectiveValue  || game.heroImage || game.defaultHero || game.heroUrl || game.hero || null,
        logo:  model?.logo?.effectiveValue  || game.logo || game.defaultLogo || game.logoUrl || null,
    };
}

function _exploreCanonicalId(game) {
    return String(game?.localGameId || game?.installedId || game?.id || '');
}

class ExploreCoverHydrationController {
    constructor() {
        this.generation = 0;
        this.selectedIds = new Set();
        this.gamesByDisplayId = new Map();
        this.nodesByDisplayId = new Map();
        this.pendingByDisplayId = new Map();
        this.inFlightByDisplayId = new Map();
        this.queuedByDisplayId = new Set();
        this.completedByDisplayId = new Map();
        this.failedByDisplayId = new Map();
        this.negativeByDisplayId = new Map();
        this.blockedByDisplayId = new Map();
        this.metadataByDisplayId = new Map();
        this.secondaryQueuedByDisplayId = new Set();
        this.secondaryInFlightByDisplayId = new Map();
        this.secondaryCompletedByDisplayId = new Map();
        this.secondaryFailedByDisplayId = new Map();
        this.secondaryScheduled = false;
        this.finalReconcileQueued = false;
        this.homeVisible = false;
        this.concurrency = Number(window.__baddelExploreCoverHydrationConcurrency || window.__baddelExploreHydrationConcurrency || 6) || 6;
        this.secondaryConcurrency = Number(window.__baddelExploreSecondaryHydrationConcurrency || 2) || 2;
        this.retryTtlMs = 30000;
        this.lastHomeVisibleReason = null;
        this.firstCoverPaintAt = null;
    }

    ownsDisplayId(id) {
        return this.selectedIds.has(String(id || ''));
    }

    setSelection(games, { reason = 'render' } = {}) {
        this.generation += 1;
        this.selectedIds = new Set();
        this.gamesByDisplayId = new Map();
        for (const game of Array.isArray(games) ? games : []) {
            const id = String(game?.id || '');
            if (!id) continue;
            this.selectedIds.add(id);
            this.gamesByDisplayId.set(id, game);
        }
        for (const id of [...this.nodesByDisplayId.keys()]) {
            if (!this.selectedIds.has(id)) this.nodesByDisplayId.delete(id);
        }
        for (const map of [this.pendingByDisplayId, this.completedByDisplayId, this.failedByDisplayId, this.negativeByDisplayId, this.blockedByDisplayId, this.metadataByDisplayId, this.secondaryCompletedByDisplayId, this.secondaryFailedByDisplayId]) {
            for (const id of [...map.keys()]) {
                if (!this.selectedIds.has(id)) map.delete(id);
            }
        }
        for (const id of [...this.queuedByDisplayId]) {
            if (!this.selectedIds.has(id)) this.queuedByDisplayId.delete(id);
        }
        for (const id of [...this.secondaryQueuedByDisplayId]) {
            if (!this.selectedIds.has(id)) this.secondaryQueuedByDisplayId.delete(id);
        }
        for (const id of this.selectedIds) {
            const game = this.gamesByDisplayId.get(id);
            if (_isCacheBackedNormalArtworkUrl(_exploreCoverValue(game))) continue;
            this.completedByDisplayId.delete(id);
            this.negativeByDisplayId.delete(id);
            this.blockedByDisplayId.delete(id);
        }
        this._log(reason);
        this.reconcile(reason);
    }

    registerCard(displayId, card, game) {
        const id = String(displayId || game?.id || '');
        if (!id || !card) return;
        this.nodesByDisplayId.set(id, card);
        if (game) this.gamesByDisplayId.set(id, game);
        this._consumePending(id, 'card-mounted');
    }

    onHomeVisible(reason = 'home-visible') {
        if (this.homeVisible && this.lastHomeVisibleReason === reason) {
            this._consumeAllPending(reason);
            return;
        }
        this.homeVisible = true;
        this.lastHomeVisibleReason = reason;
        this.reconcile(reason);
    }

    onCanonicalCoverCommit({ canonicalGame, matchedDisplayIds = [], operationId = null } = {}) {
        const ids = Array.isArray(matchedDisplayIds) ? matchedDisplayIds.map(String) : [];
        for (const id of ids) {
            if (!this.selectedIds.has(id)) continue;
            const cover = _exploreCoverValue(canonicalGame);
            if (!cover) continue;
            this._storeAndApply(id, {
                canonicalGameId: String(canonicalGame.id || _exploreCanonicalId(this.gamesByDisplayId.get(id))),
                localUrl: cover,
                revision: canonicalGame?.artworkState?.cover?.revision ?? canonicalGame?.coverRevision ?? null,
                operationId,
                source: 'canonical-commit',
            });
        }
    }

    reconcile(reason = 'reconcile') {
        for (const id of this.selectedIds) {
            this._consumePending(id, reason);
            const game = this.gamesByDisplayId.get(id);
            const cover = _exploreCoverValue(game);
            const safe = _isCacheBackedNormalArtworkUrl(cover);
            if (safe) {
                this._storeAndApply(id, {
                    canonicalGameId: _exploreCanonicalId(game),
                    localUrl: safe,
                    revision: game?.artworkState?.cover?.revision ?? null,
                    operationId: `explore-cache-${id}`,
                    source: 'runtime-cover',
                });
                continue;
            }
            this._expireRetryState(id);
            this._ensureRequest(id, reason);
        }
        this._pump(reason);
        this._log(reason);
    }

    _ensureRequest(id, reason) {
        if (
            this.inFlightByDisplayId.has(id) ||
            this.queuedByDisplayId.has(id) ||
            this.pendingByDisplayId.has(id) ||
            this.completedByDisplayId.has(id) ||
            this.negativeByDisplayId.has(id) ||
            this.failedByDisplayId.has(id) ||
            this.blockedByDisplayId.has(id)
        ) return;
        const game = this.gamesByDisplayId.get(id);
        if (!game) return;
        this.queuedByDisplayId.add(id);
        this._log(reason);
    }

    _pump(reason = 'pump') {
        while (this.inFlightByDisplayId.size < this.concurrency && this.queuedByDisplayId.size) {
            const id = this.queuedByDisplayId.values().next().value;
            this.queuedByDisplayId.delete(id);
            const game = this.gamesByDisplayId.get(id);
            if (!game || !this.selectedIds.has(id)) continue;
            this._startRequest(id, game, reason);
        }
    }

    _startRequest(id, game, reason) {
        const generation = this.generation;
        const canonicalGameId = _exploreCanonicalId(game);
        const promise = this._hydrateOne({ id, game, canonicalGameId, generation, reason })
            .catch(err => {
            this.failedByDisplayId.set(id, { reason: err?.message || 'failed', retryAt: Date.now() + this.retryTtlMs });
            })
            .finally(() => {
                this.inFlightByDisplayId.delete(id);
                this._pump('settled');
                this._scheduleSecondaryDrain('cover-settled');
                this._log('settled');
                if (!this.inFlightByDisplayId.size && !this.queuedByDisplayId.size) this._queueFinalReconcile();
            });
        this.inFlightByDisplayId.set(id, promise);
    }

    async _hydrateOne({ id, game, canonicalGameId, generation, reason }) {
        const stageStartedAt = _baddelPerfNow();
        const cached = await this._lookupCachedArtwork(game, { id: canonicalGameId }, { types: ['cover'], stage: 'cover-cache' });
        if (!this._isGenerationCurrent(id, generation)) return;
        if (cached.cover) {
            this._applyTrustedArtworkToGame(game, cached);
            this._storeAndApply(id, {
                canonicalGameId,
                localUrl: cached.cover,
                assets: cached,
                revision: game?.artworkState?.cover?.revision ?? null,
                operationId: `explore-cache-${id}`,
                source: 'cache-hit',
                firstPaintMs: _baddelPerfNow() - stageStartedAt,
            });
            this._ensureSecondaryRequest(id, game, canonicalGameId, generation, 'cover-cache-hit');
            return;
        }

        const metadataStartedAt = _baddelPerfNow();
        const meta = await window.electronAPI?.getMetadata?.(game.name, {
            id: game.id,
            platform: game.platform,
            platforms: game.platforms,
            command: game.command,
            path: game.path,
            allIds: game.allIds,
            existingCover: game.image || null,
            existingHero: game.heroImage || game.hero || null,
            existingLogo: game.logo || null,
        }).catch(() => null);
        const metadataMs = _baddelPerfNow() - metadataStartedAt;
        const remoteAssets = {
            cover: meta?.cover || null,
            hero: meta?.hero || meta?.heroImage || null,
            logo: meta?.logo || meta?.defaultLogo || null,
        };
        this.metadataByDisplayId.set(id, remoteAssets);
        if (!remoteAssets.cover) {
            this.negativeByDisplayId.set(id, { reason: 'no-cover-candidate', at: Date.now(), retryAt: Date.now() + this.retryTtlMs });
            this._ensureSecondaryRequest(id, game, canonicalGameId, generation, 'metadata-no-cover');
            return;
        }

        const priority = this.homeVisible ? 'visible' : 'prewarm';
        const coverCacheStartedAt = _baddelPerfNow();
        if (window.__baddelStartupMetrics) {
            window.__baddelStartupMetrics.artworkHttpDownloadCount = Number(window.__baddelStartupMetrics.artworkHttpDownloadCount || 0) + 1;
        }
        const localAssets = await window.electronAPI?.cacheAllAssets?.({ cover: remoteAssets.cover }, canonicalGameId, {
            priority,
            reason: 'explore-cover-hydration',
            displayId: id,
        });
        const coverCacheMs = _baddelPerfNow() - coverCacheStartedAt;
        const assets = {
            cover: _isCacheBackedNormalArtworkUrl(localAssets?.cover),
            hero: null,
            logo: null,
        };
        if (!assets.cover) {
            this.blockedByDisplayId.set(id, { reason: localAssets?.reason || 'blocked-or-failed', at: Date.now(), retryAt: Date.now() + this.retryTtlMs });
            return;
        }

        if (!this._isGenerationCurrent(id, generation)) return;
        this._applyTrustedArtworkToGame(game, assets);
        const operationId = `explore-cover-${canonicalGameId}-${Date.now()}`;
        this._storeAndApply(id, {
            canonicalGameId,
            localUrl: assets.cover,
            assets,
            revision: game?.artworkState?.cover?.revision ?? null,
            operationId,
            source: reason,
            firstPaintMs: _baddelPerfNow() - stageStartedAt,
        });
        this._persistArtworkStage({
            id,
            canonicalGameId,
            assets: { cover: assets.cover },
            changedTypes: ['cover'],
            source: 'explore-cover-hydration',
            operationId,
            generation,
        }).catch(err => this._logTiming('saveMetadataFailed', id, { message: err?.message || 'failed' }));
        this._ensureSecondaryRequest(id, game, canonicalGameId, generation, 'cover-ready');
        this._logTiming('cover', id, {
            metadataMs,
            coverCacheMs,
            firstPaintMs: _baddelPerfNow() - stageStartedAt,
        });
    }

    async _persistArtworkStage({ id, canonicalGameId, assets, changedTypes, source, operationId, generation }) {
        const saveStartedAt = _baddelPerfNow();
        const saved = await window.electronAPI?.saveMetadata?.(canonicalGameId, assets, {
            source,
            displayId: id,
        }).catch(() => null);
        const saveMs = _baddelPerfNow() - saveStartedAt;
        const committedOperationId = saved?.operationId || operationId;
        let summary = null;
        if (saved?.updatedGame && typeof window.__baddelCommitCanonicalGameUpdate === 'function') {
            summary = window.__baddelCommitCanonicalGameUpdate({
                canonicalGame: saved.updatedGame,
                changedTypes,
                operationId: committedOperationId,
            }, { reason: source });
        }
        if (changedTypes.includes('cover') && this._isGenerationCurrent(id, generation) && saved?.updatedGame) {
            const cover = _isCacheBackedNormalArtworkUrl(saved.updatedGame.image || saved.updatedGame.defaultImage || assets.cover);
            if (cover) {
                this._storeAndApply(id, {
                    canonicalGameId,
                    localUrl: cover,
                    assets: { cover },
                    revision: saved.updatedGame?.artworkState?.cover?.revision ?? null,
                    operationId: committedOperationId,
                    source,
                    canonicalMatched: Array.isArray(summary?.matchedDisplayIds) && summary.matchedDisplayIds.map(String).includes(String(id)),
                });
            }
        }
        this._logTiming('saveMetadata', id, { saveMs, changedTypes });
    }

    async _lookupCachedArtwork(displayGame, canonicalGame, { types = ['cover', 'hero', 'logo'], stage = 'cache' } = {}) {
        const startedAt = _baddelPerfNow();
        const current = _exploreArtworkValues(displayGame);
        const direct = {
            cover: types.includes('cover') ? _isCacheBackedNormalArtworkUrl(current.cover) : null,
            hero: types.includes('hero') ? _isCacheBackedNormalArtworkUrl(current.hero) : null,
            logo: types.includes('logo') ? _isCacheBackedNormalArtworkUrl(current.logo) : null,
        };
        if (types.every(type => !!direct[type])) {
            this._logTiming(stage, displayGame?.id, { cacheLookupMs: _baddelPerfNow() - startedAt, direct: true, types });
            return direct;
        }
        if (window.__baddelLoadCachedArtworkForGame) {
            const cached = await window.__baddelLoadCachedArtworkForGame(displayGame, canonicalGame, { types }).catch(() => null);
            if (types.includes('cover')) direct.cover = direct.cover || _isCacheBackedNormalArtworkUrl(cached?.cover);
            if (types.includes('hero')) direct.hero = direct.hero || _isCacheBackedNormalArtworkUrl(cached?.hero);
            if (types.includes('logo')) direct.logo = direct.logo || _isCacheBackedNormalArtworkUrl(cached?.logo);
        }
        if (types.includes('cover') && !direct.cover) {
            const legacy = localStorage.getItem('cover_' + displayGame.id);
            direct.cover = direct.cover || _isCacheBackedNormalArtworkUrl(legacy);
        }
        this._logTiming(stage, displayGame?.id, {
            cacheLookupMs: _baddelPerfNow() - startedAt,
            types,
            hits: types.filter(type => !!direct[type]),
        });
        return direct;
    }

    _ensureSecondaryRequest(id, game, canonicalGameId, generation, reason) {
        if (!this._isGenerationCurrent(id, generation)) return;
        if (
            this.secondaryQueuedByDisplayId.has(id) ||
            this.secondaryInFlightByDisplayId.has(id) ||
            this.secondaryCompletedByDisplayId.has(id) ||
            this.secondaryFailedByDisplayId.has(id)
        ) return;
        const current = _exploreArtworkValues(game);
        if (_isCacheBackedNormalArtworkUrl(current.hero) && _isCacheBackedNormalArtworkUrl(current.logo)) {
            this.secondaryCompletedByDisplayId.set(id, { reason: 'already-local', at: Date.now() });
            return;
        }
        this.secondaryQueuedByDisplayId.add(id);
        this._scheduleSecondaryDrain(reason || 'secondary-queued');
    }

    _scheduleSecondaryDrain(reason = 'secondary-schedule') {
        if (this.inFlightByDisplayId.size || this.queuedByDisplayId.size) return;
        if (this.secondaryScheduled) return;
        this.secondaryScheduled = true;
        const schedule = window.requestIdleCallback || ((fn) => setTimeout(fn, 50));
        schedule(() => {
            this.secondaryScheduled = false;
            this._pumpSecondary(reason);
        });
    }

    _pumpSecondary(reason = 'secondary-pump') {
        if (this.inFlightByDisplayId.size || this.queuedByDisplayId.size) return;
        while (this.secondaryInFlightByDisplayId.size < this.secondaryConcurrency && this.secondaryQueuedByDisplayId.size) {
            const id = this.secondaryQueuedByDisplayId.values().next().value;
            this.secondaryQueuedByDisplayId.delete(id);
            const game = this.gamesByDisplayId.get(id);
            if (!game || !this.selectedIds.has(id)) continue;
            const generation = this.generation;
            const canonicalGameId = _exploreCanonicalId(game);
            const promise = this._hydrateSecondary({ id, game, canonicalGameId, generation, reason })
                .catch(err => {
                    this.secondaryFailedByDisplayId.set(id, { reason: err?.message || 'secondary-failed', at: Date.now() });
                })
                .finally(() => {
                    this.secondaryInFlightByDisplayId.delete(id);
                    this._pumpSecondary('secondary-settled');
                    this._log('secondary-settled');
                });
            this.secondaryInFlightByDisplayId.set(id, promise);
        }
        this._log(reason);
    }

    async _hydrateSecondary({ id, game, canonicalGameId, generation, reason }) {
        const startedAt = _baddelPerfNow();
        const cached = await this._lookupCachedArtwork(game, { id: canonicalGameId }, { types: ['hero', 'logo'], stage: 'secondary-cache' });
        if (!this._isGenerationCurrent(id, generation)) return;
        let assets = {
            hero: _isCacheBackedNormalArtworkUrl(cached?.hero),
            logo: _isCacheBackedNormalArtworkUrl(cached?.logo),
        };
        if (!assets.hero || !assets.logo) {
            let remote = this.metadataByDisplayId.get(id);
            if (!remote) {
                const metadataStartedAt = _baddelPerfNow();
                const meta = await window.electronAPI?.getMetadata?.(game.name, {
                    id: game.id,
                    platform: game.platform,
                    platforms: game.platforms,
                    command: game.command,
                    path: game.path,
                    allIds: game.allIds,
                    existingCover: game.image || null,
                    existingHero: game.heroImage || game.hero || null,
                    existingLogo: game.logo || null,
                }).catch(() => null);
                remote = {
                    cover: meta?.cover || null,
                    hero: meta?.hero || meta?.heroImage || null,
                    logo: meta?.logo || meta?.defaultLogo || null,
                };
                this.metadataByDisplayId.set(id, remote);
                this._logTiming('secondary-metadata', id, { metadataMs: _baddelPerfNow() - metadataStartedAt });
            }
            const requested = {};
            if (!assets.hero && remote?.hero) requested.hero = remote.hero;
            if (!assets.logo && remote?.logo) requested.logo = remote.logo;
            if (requested.hero || requested.logo) {
                const secondaryCacheStartedAt = _baddelPerfNow();
                if (window.__baddelStartupMetrics) {
                    window.__baddelStartupMetrics.artworkHttpDownloadCount = Number(window.__baddelStartupMetrics.artworkHttpDownloadCount || 0) + Object.keys(requested).length;
                }
                const localAssets = await window.electronAPI?.cacheAllAssets?.(requested, canonicalGameId, {
                    priority: 'background',
                    reason: 'explore-secondary-hydration',
                    displayId: id,
                }).catch(() => null);
                this._logTiming('secondary-cache-download', id, { secondaryCacheMs: _baddelPerfNow() - secondaryCacheStartedAt });
                assets = {
                    hero: assets.hero || _isCacheBackedNormalArtworkUrl(localAssets?.hero),
                    logo: assets.logo || _isCacheBackedNormalArtworkUrl(localAssets?.logo),
                };
            }
        }
        if (!assets.hero && !assets.logo) {
            this.secondaryFailedByDisplayId.set(id, { reason: 'no-secondary-assets', at: Date.now() });
            return;
        }
        if (!this._isGenerationCurrent(id, generation)) return;
        this._applyTrustedArtworkToGame(game, assets);
        this.secondaryCompletedByDisplayId.set(id, { reason, at: Date.now(), assets });
        this._persistArtworkStage({
            id,
            canonicalGameId,
            assets,
            changedTypes: [
                assets.hero ? 'hero' : null,
                assets.logo ? 'logo' : null,
            ].filter(Boolean),
            source: 'explore-secondary-hydration',
            operationId: `explore-secondary-${canonicalGameId}-${Date.now()}`,
            generation,
        }).catch(err => this._logTiming('secondarySaveFailed', id, { message: err?.message || 'failed' }));
        if (typeof currentHeroGameId !== 'undefined' && String(currentHeroGameId) === String(id)) {
            window.__baddelRequestHomeHeroTransition?.(id, { immediate: true, reason: 'explore-secondary-hydration' });
        }
        this._logTiming('secondary', id, { secondaryMs: _baddelPerfNow() - startedAt });
    }

    prewarmHeroArtwork(games, { reason = 'explore-prewarm' } = {}) {
        const visible = (Array.isArray(games) ? games : []).slice(0, 8);
        for (const game of visible) {
            const id = String(game?.id || '');
            if (!id || !this.selectedIds.has(id)) continue;
            const current = _exploreArtworkValues(game);
            if (_isCacheBackedNormalArtworkUrl(current.hero) && _isCacheBackedNormalArtworkUrl(current.logo)) continue;
            this._ensureSecondaryRequest(id, game, _exploreCanonicalId(game), this.generation, reason);
        }
    }

    _logTiming(stage, id, payload = {}) {
        try {
            const clean = { ...payload };
            for (const key of Object.keys(clean)) {
                if (Number.isFinite(clean[key])) clean[key] = Math.round(clean[key]);
            }
            console.info('[ExploreHydrationTiming]', {
                stage,
                displayId: String(id || ''),
                ...clean,
            });
        } catch (_) {}
    }

    _isGenerationCurrent(id, generation) {
        return generation === this.generation && this.selectedIds.has(String(id));
    }

    _expireRetryState(id) {
        const now = Date.now();
        for (const map of [this.failedByDisplayId, this.negativeByDisplayId, this.blockedByDisplayId]) {
            const state = map.get(id);
            const retryAt = Number(state?.retryAt || state?.at + this.retryTtlMs || 0);
            if (retryAt && retryAt <= now) map.delete(id);
        }
    }

    _consumeAllPending(reason) {
        for (const id of [...this.pendingByDisplayId.keys()]) this._consumePending(id, reason);
    }

    _applyTrustedArtworkToGame(game, assets = {}) {
        if (!game) return;
        if (assets.cover) {
            game.image = assets.cover;
            game.defaultImage = assets.cover;
            game.coverUrl = assets.cover;
        }
        if (assets.hero) {
            game.heroImage = assets.hero;
            game.defaultHero = assets.hero;
            game.hero = assets.hero;
        }
        if (assets.logo) {
            game.logo = assets.logo;
            game.defaultLogo = assets.logo;
            game.logoUrl = assets.logo;
        }
    }

    _storeAndApply(id, result) {
        this.pendingByDisplayId.set(id, result);
        this._consumePending(id, result.source || 'result');
    }

    _consumePending(id, reason) {
        const result = this.pendingByDisplayId.get(id);
        if (!result) return false;
        const card = this.nodesByDisplayId.get(id) || document.querySelector?.(`[data-id="${CSS.escape(String(id))}"]`);
        if (!card || card.isConnected === false || String(card.dataset?.id || '') !== String(id) || card.dataset?.artworkSurface !== 'explore') return false;
        this.pendingByDisplayId.delete(id);
        this.completedByDisplayId.set(id, { ...result, reason, at: Date.now() });
        if (!this.firstCoverPaintAt) {
            this.firstCoverPaintAt = _baddelPerfNow();
            if (window.__baddelStartupMetrics && !window.__baddelStartupMetrics.firstExploreCoverAt) {
                window.__baddelStartupMetrics.firstExploreCoverAt = this.firstCoverPaintAt;
            }
        }
        if (this.completedByDisplayId.size >= this.selectedIds.size && window.__baddelStartupMetrics && !window.__baddelStartupMetrics.allVisibleExploreCoversAt) {
            window.__baddelStartupMetrics.allVisibleExploreCoversAt = _baddelPerfNow();
            _baddelLogStartupSummary('all-visible-explore-covers');
        }
        window._patchVisibleGameCard?.({ id: result.canonicalGameId, image: result.localUrl }, [id], {
            canonicalGameId: result.canonicalGameId,
            operationId: result.operationId,
            cover: {
                changed: true,
                value: result.localUrl,
                revision: result.revision,
            },
        });
        if (typeof currentHeroGameId !== 'undefined' && String(currentHeroGameId) === String(id)) {
            window.__baddelRequestHomeHeroTransition?.(id, { immediate: true, reason: 'explore-hydration' });
        }
        try {
            console.info('[ExploreHydrationResult]', {
                displayId: String(id),
                canonicalGameId: String(result.canonicalGameId || ''),
                source: result.source || reason,
                exactApplied: true,
                canonicalMatched: result.canonicalMatched === true,
                firstPaintMs: Number.isFinite(result.firstPaintMs) ? Math.round(result.firstPaintMs) : null,
                ignoredReason: null,
            });
        } catch (_) {}
        return true;
    }

    _queueFinalReconcile() {
        if (this.finalReconcileQueued) return;
        this.finalReconcileQueued = true;
        Promise.resolve().then(() => {
            this.finalReconcileQueued = false;
            this.reconcile('idle-final');
            this._scheduleSecondaryDrain('cover-idle-final');
            const unresolved = [...this.selectedIds].filter(id =>
                !this.completedByDisplayId.has(id) &&
                !this.inFlightByDisplayId.has(id) &&
                !this.queuedByDisplayId.has(id) &&
                !this.negativeByDisplayId.has(id) &&
                !this.failedByDisplayId.has(id) &&
                !this.blockedByDisplayId.has(id)
            );
            if (unresolved.length) {
                console.warn('[ExploreHydrationIncomplete]', { displayIds: unresolved, reasons: Object.fromEntries(unresolved.map(id => [id, 'unresolved'])) });
            }
        });
    }

    _log(reason) {
        try {
            console.info('[ExploreHydrationQueue]', {
                selected: this.selectedIds.size,
                cached: this.completedByDisplayId.size,
                queued: this.queuedByDisplayId.size,
                active: this.inFlightByDisplayId.size,
                secondaryQueued: this.secondaryQueuedByDisplayId.size,
                secondaryActive: this.secondaryInFlightByDisplayId.size,
                secondaryCompleted: this.secondaryCompletedByDisplayId.size,
                completed: this.completedByDisplayId.size,
                failed: this.failedByDisplayId.size,
                blocked: this.blockedByDisplayId.size,
                pendingDom: this.pendingByDisplayId.size,
                generation: this.generation,
                reason,
            });
        } catch (_) {}
    }
}

window.__baddelExploreCoverHydrationController = window.__baddelExploreCoverHydrationController || new ExploreCoverHydrationController();
window.addEventListener?.('baddel:home-visible', event => {
    window.__baddelExploreCoverHydrationController?.onHomeVisible(event?.detail?.reason || 'home-visible');
});

function _explorePatchCardArtwork(card, game) {
    if (!card || !game) return;
    const img = card.querySelector?.('.actual-img');
    const expectedId = String(game.id || '');
    if (String(card.dataset?.id || '') !== expectedId) return;
    const cover = game.image || game.defaultImage || game.coverUrl || null;
    const safe = _isCacheBackedNormalArtworkUrl(cover);
    card.dataset.artworkGameId = expectedId;
    if (img && safe && img.src !== safe) {
        img.src = safe;
        img.dataset.lastGoodCover = safe;
        card.dataset.artworkAssetHash = safe;
        img.style.display = 'block';
        img.style.opacity = '';
    }
}

function renderExploreCarousel() {
    const grid = document.getElementById('exploreGrid');
    if (!grid) return;
    const previousScrollLeft = grid.scrollLeft || 0;
    const activeId = document.activeElement?.closest?.('[data-id]')?.dataset?.id || null;

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
        window._exploreRenderedIds = [];
        window._exploreRenderedNodes = new Map();
        return;
    }

    const ids = shuffled.map(game => String(game.id));
    const previousIds = Array.isArray(window._exploreRenderedIds) ? window._exploreRenderedIds : [];
    const previousNodes = window._exploreRenderedNodes instanceof Map ? window._exploreRenderedNodes : new Map();
    const sameMembership = ids.length === previousIds.length && ids.every((id, index) => id === previousIds[index]);
    window.__baddelExploreCoverHydrationController?.setSelection(shuffled, { reason: 'renderExploreCarousel' });

    if (sameMembership && ids.every(id => previousNodes.get(id)?.isConnected)) {
        shuffled.forEach(game => {
            const node = previousNodes.get(String(game.id));
            if (node?.dataset) node.dataset.artworkSurface = 'explore';
            _explorePatchCardArtwork(node, game);
            window.__baddelExploreCoverHydrationController?.registerCard(String(game.id), node, game);
        });
    } else {
        const nextNodes = new Map();
        const fragment = document.createDocumentFragment();
        shuffled.forEach(game => {
            const id = String(game.id);
            const node = previousNodes.get(id) || createGameCard(game, false, { artworkSurface: 'explore' });
            if (node?.dataset) node.dataset.artworkSurface = 'explore';
            _explorePatchCardArtwork(node, game);
            window.__baddelExploreCoverHydrationController?.registerCard(id, node, game);
            nextNodes.set(id, node);
            fragment.appendChild(node);
        });
        grid.replaceChildren(fragment);
        window._exploreRenderedNodes = nextNodes;
        window._exploreRenderedIds = ids;
    }
    grid.scrollLeft = previousScrollLeft;
    if (activeId) grid.querySelector(`[data-id="${CSS.escape(activeId)}"]`)?.focus?.();
    if (typeof window.__baddelPrewarmExploreHeroArtwork === 'function') {
        window.__baddelPrewarmExploreHeroArtwork(shuffled);
    }
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
let _libraryUpdateQueuedPayload = null;
let _libraryUpdateTimer = null;
let _lastLibraryRenderSnapshot = null;

function _artValue(game, type) {
    const item = game?.artworkState?.version === 2 ? game.artworkState[type] : null;
    const value = item?.overrideValue || item?.fallbackValue || null;
    if (value) return value;
    if (type === 'cover') return game?.image || game?.defaultImage || game?.coverUrl || null;
    if (type === 'hero') return game?.heroImage || game?.defaultHero || game?.heroUrl || null;
    return game?.logo || game?.defaultLogo || game?.logoUrl || null;
}

function _artRevision(game, type) {
    const item = game?.artworkState?.version === 2 ? game.artworkState[type] : null;
    return Number.isFinite(Number(item?.revision)) ? Number(item.revision) : 0;
}

function _librarySnapshot(games) {
    const entries = (Array.isArray(games) ? games : []).map((game, index) => {
        const id = String(game?.id || '');
        return {
            id,
            index,
            installed: Boolean(game?.path || game?.command || game?.isInstalled),
            platform: String(game?.platform || game?._platform || ''),
            ownership: JSON.stringify(game?.ownedByAccountIds || game?.steamLicensedAccountIds || game?.sources || []),
            cover: `${_artRevision(game, 'cover')}:${_artValue(game, 'cover') || ''}`,
            hero: `${_artRevision(game, 'hero')}:${_artValue(game, 'hero') || ''}`,
            logo: `${_artRevision(game, 'logo')}:${_artValue(game, 'logo') || ''}`,
        };
    });
    return {
        entries,
        byId: new Map(entries.map(entry => [entry.id, entry])),
        order: entries.map(entry => entry.id).join('|'),
    };
}

function _classifyLibrarySnapshot(prev, next) {
    if (!prev) return { classification: 'STRUCTURAL', structuralRender: true, changedTypes: [], changedIds: [] };
    if (prev.order !== next.order) return { classification: 'STRUCTURAL', structuralRender: true, changedTypes: [], changedIds: [] };
    const changedTypes = new Set();
    const changedIds = new Set();
    for (const entry of next.entries) {
        const before = prev.byId.get(entry.id);
        if (!before) return { classification: 'STRUCTURAL', structuralRender: true, changedTypes: [], changedIds: [] };
        if (before.installed !== entry.installed || before.platform !== entry.platform || before.ownership !== entry.ownership) {
            return { classification: 'STRUCTURAL', structuralRender: true, changedTypes: [], changedIds: [] };
        }
        for (const type of ['cover', 'hero', 'logo']) {
            if (before[type] !== entry[type]) {
                changedTypes.add(type);
                changedIds.add(entry.id);
            }
        }
    }
    if (!changedTypes.size) return { classification: 'NO_VISIBLE_CHANGE', structuralRender: false, changedTypes: [], changedIds: [] };
    if (changedTypes.size === 1 && changedTypes.has('cover')) {
        return { classification: 'CARD_COVER', structuralRender: false, changedTypes: ['cover'], changedIds: [...changedIds] };
    }
    if (![...changedTypes].includes('cover')) {
        return { classification: 'SURFACE_ART', structuralRender: false, changedTypes: [...changedTypes], changedIds: [...changedIds] };
    }
    return { classification: 'CARD_COVER', structuralRender: false, changedTypes: [...changedTypes], changedIds: [...changedIds] };
}

function _logRenderDecision(event, decision, surfacesPatched = []) {
    console.info('[RenderDecision]', {
        event,
        classification: decision.classification,
        structuralRender: Boolean(decision.structuralRender),
        matchedDisplayIds: decision.changedIds || [],
        surfacesPatched,
    });
}

function _patchLibraryArtworkSurfaces(decision) {
    const changedIds = new Set(decision.changedIds || []);
    const surfacesPatched = [];
    if (decision.changedTypes.includes('cover')) {
        changedIds.forEach(id => {
            const game = allGamesData.find(g => String(g.id) === String(id));
            if (game) {
                _patchVisibleGameCard(game, [id]);
                surfacesPatched.push(`card:${id}`);
            }
        });
    }
    if ((decision.changedTypes.includes('hero') || decision.changedTypes.includes('logo')) && currentHeroGameId && changedIds.has(String(currentHeroGameId))) {
        window.__baddelRequestHomeHeroTransition?.(currentHeroGameId, { immediate: true, reason: 'library-updated-artwork' });
        surfacesPatched.push(`hero:${currentHeroGameId}`);
    }
    _logRenderDecision('library-updated', decision, surfacesPatched);
}

function _renderStructuralLibraryUpdate() {
    renderSidebar();
    if (currentView === 'home') {
        if (_homeIsUserScrolled()) {
            _markHomeRefreshPending('library-updated-home-scrolled');
        } else {
            renderRecentlyPlayed();
            renderExploreCarousel();
            applyHeroForHome();
            renderSyncedSuggestions();
        }
    } else if (currentView === 'all-games') {
        if (typeof window._onSyncLibraryUpdated === 'function') window._onSyncLibraryUpdated();
    } else {
        _preserveActiveScrollDuring('library-updated', () => {
            applyFilters();
            if (typeof window._onSyncLibraryUpdated === 'function') window._onSyncLibraryUpdated();
        });
    }
}

async function _processLibraryUpdatedPayload(updatedGames) {
    await window.__baddelRefreshCanonicalGamesRegistry?.('library' + '-updated');
    const mergedGames = _dedupeDelegatedLaunchProducts(_mergeCanonicalArtworkAcrossLibrary(updatedGames, allGamesData));
    const nextSnapshot = _librarySnapshot(mergedGames);
    const decision = _classifyLibrarySnapshot(_lastLibraryRenderSnapshot, nextSnapshot);
    allGamesData = mergedGames;
    window.allGamesData = allGamesData;
    window._readyToInstallRenderedGames = null;
    _lastLibraryRenderSnapshot = nextSnapshot;
    if (decision.structuralRender && typeof window.hydrateSidebarAllGamesCount === 'function') {
        window.hydrateSidebarAllGamesCount('library-updated').catch(() => {});
    }

    if (decision.structuralRender) {
        _logRenderDecision('library-updated', decision, ['structural']);
        _renderStructuralLibraryUpdate();
        return;
    }
    if (decision.classification === 'NO_VISIBLE_CHANGE') {
        _logRenderDecision('library-updated', decision, []);
        return;
    }
    _patchLibraryArtworkSurfaces(decision);
}

if (window.electronAPI.onLibraryUpdated) {
    window.electronAPI.onLibraryUpdated(async (updatedGames) => {
        _libraryUpdateQueuedPayload = updatedGames;
        clearTimeout(_libraryUpdateTimer);
        _libraryUpdateTimer = setTimeout(() => {
            const payload = _libraryUpdateQueuedPayload;
            _libraryUpdateQueuedPayload = null;
            _processLibraryUpdatedPayload(payload);
        }, 75);
        return;

        // Sidebar is always safe — it lives outside the main scroll container.
        if (currentView === 'home') {
            if (_homeIsUserScrolled()) {
                // User has scrolled down — skip all Home DOM mutations to prevent
                // innerHTML clears from clamping scrollTop to 0. Flush when safe.
                _markHomeRefreshPending('library-updated-home-scrolled');
            } else {
            }
        } else if (currentView === 'all-games') {
            // All Games background updates are owned by accounts.js onLibraryUpdated.
            // Do not run the Installed Games applyFilters() while All Games is active.
        } else {
            _preserveActiveScrollDuring('library-updated', () => {
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
        const changedTypes = window.__baddelDetectArtworkChangedTypes
            ? window.__baddelDetectArtworkChangedTypes(updatedGame)
            : ['cover', 'hero', 'logo'];
        const summary = window.__baddelCommitCanonicalGameUpdate?.(updatedGame, {
            reason: 'game-image-updated',
            changedTypes,
            suppressDuplicateRevision: true,
        });
        const matchedDisplayIds = summary?.matchedDisplayIds || [];
        const surfacesPatched = [];
        if (summary?.changedTypes?.includes('cover')) surfacesPatched.push(...matchedDisplayIds.map(id => `card:${id}`));
        if ((summary?.changedTypes?.includes('hero') || summary?.changedTypes?.includes('logo')) &&
            currentHeroGameId &&
            (matchedDisplayIds.includes(String(currentHeroGameId)) || String(summary.canonicalGameId) === String(currentHeroGameId))) {
            window.__baddelRequestHomeHeroTransition?.(currentHeroGameId, { immediate: true, reason: 'game-image-updated' });
            surfacesPatched.push(`hero:${currentHeroGameId}`);
        }
        console.info('[RenderDecision]', {
            event: 'game-image-updated',
            classification: summary?.duplicate ? 'NO_VISIBLE_CHANGE' : (summary?.changedTypes?.includes('cover') ? 'CARD_COVER' : 'SURFACE_ART'),
            structuralRender: false,
            matchedDisplayIds,
            surfacesPatched,
        });

        // If this game's settings modal is open, refresh it
        if (selectedGameId === String(updatedGame.id) || matchedDisplayIds.includes(String(selectedGameId))) {
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

        const mergedGames = _dedupeDelegatedLaunchProducts(_mergeCanonicalArtworkAcrossLibrary(updatedGames, allGamesData));

        allGamesData = mergedGames;
        window.allGamesData = allGamesData; // keep accounts.js in sync
        await window.__baddelRefreshCanonicalGamesRegistry?.('scan-all-games');
        allCollections = await window.electronAPI.getCollections();
        buildPlaytimeCache(allGamesData);
        window.hydrateSidebarAllGamesCount?.('library-updated').catch?.(() => {});
        
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
    allGamesData = _dedupeDelegatedLaunchProducts(allGamesData);
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

let _artworkRequestSeq = 0;

function _isRemoteArtworkCandidate(url) {
    return /^https?:\/\//i.test(String(url || '').trim());
}

function _isCacheBackedNormalArtworkUrl(url) {
    const safe = typeof safeImageUrl === 'function' ? safeImageUrl(url) : String(url || '');
    if (!safe) return null;
    return _isRemoteArtworkCandidate(safe) ? null : safe;
}

function _artworkCardForImage(imgElement) {
    return imgElement?.closest?.('[data-id]') || null;
}

function _beginCardArtworkRequest(imgElement, game) {
    const card = _artworkCardForImage(imgElement);
    const expectedGameId = String(game?.id || card?.dataset?.id || '');
    const requestId = String(++_artworkRequestSeq);
    if (card) {
        card.dataset.artworkRequestId = requestId;
        card.dataset.artworkGameId = expectedGameId;
    }
    if (imgElement?.dataset) {
        imgElement.dataset.artworkRequestId = requestId;
        imgElement.dataset.artworkGameId = expectedGameId;
    }
    return { card, imgElement, expectedGameId, requestId };
}

function _cardArtworkRequestStillCurrent(ctx) {
    const card = ctx?.card || _artworkCardForImage(ctx?.imgElement);
    if (!ctx?.imgElement || !card || !card.isConnected) return false;
    if (String(card.dataset?.id || '') !== String(ctx.expectedGameId || '')) return false;
    if (String(card.dataset?.artworkRequestId || '') !== String(ctx.requestId || '')) return false;
    return true;
}

function _logExploreArtworkRequest(patch = {}) {
    try {
        console.debug('[ExploreArtworkRequest]', {
            gameId: patch.gameId || null,
            requestId: patch.requestId || null,
            source: patch.source || 'unknown',
            trusted: patch.trusted === true,
            applied: patch.applied === true,
            ignoredReason: patch.ignoredReason || null,
        });
    } catch {}
}

function _applyCardCoverResult(ctx, coverUrl, { source = 'downloaded' } = {}) {
    const safe = _isCacheBackedNormalArtworkUrl(coverUrl);
    const gameId = ctx?.expectedGameId || null;
    if (!safe) {
        _logExploreArtworkRequest({ gameId, requestId: ctx?.requestId, source, trusted: false, applied: false, ignoredReason: 'untrusted-or-remote' });
        return null;
    }
    if (!_cardArtworkRequestStillCurrent(ctx)) {
        _logExploreArtworkRequest({ gameId, requestId: ctx?.requestId, source, trusted: true, applied: false, ignoredReason: 'stale-card-request' });
        return null;
    }

    const img = ctx.imgElement;
    const apply = () => {
        if (!_cardArtworkRequestStillCurrent(ctx)) return;
        img.src = safe;
        img.dataset.lastGoodCover = safe;
        img.style.opacity = '';
        img.style.display = 'block';
        img.classList.add('img-loaded');
        ctx.card.dataset.artworkAssetHash = safe;
        _logExploreArtworkRequest({ gameId, requestId: ctx.requestId, source, trusted: true, applied: true });
    };

    if (typeof Image === 'function' && img.src && img.src !== safe) {
        const preloader = new Image();
        preloader.onload = apply;
        preloader.onerror = () => _logExploreArtworkRequest({ gameId, requestId: ctx.requestId, source, trusted: true, applied: false, ignoredReason: 'replacement-load-failed' });
        preloader.src = safe;
    } else {
        apply();
    }
    return safe;
}

async function fetchMetadata(imgElement, game) {
    const requestContext = _beginCardArtworkRequest(imgElement, game);
    const cacheKey = 'cover_' + game.id;
    const storedCover = localStorage.getItem(cacheKey);
    const hasExplicitArtwork =
        game.customArtworkLocked === true &&
        (game.artworkSource === 'settings' || game.artworkSource === 'creator');

    // 1. In-memory path is already a local file — probe it first (may be gone after Delete Forever)
    if (game.image && game.image.startsWith('file://')) {
        const alive = await window.electronAPI.probeLocalImage(game.image).catch(() => false);
        if (alive && _applyCardCoverResult(requestContext, game.image, { source: 'v2-cache-hit' })) { checkBackgroundAssets(game); return; }
        // File is gone — clear stale references so we fall through to a fresh fetch
        game.image = null; game.defaultImage = null; game.coverUrl = null;
        localStorage.removeItem('cover_' + game.id);
    }

    // 1b. Creator-locked with any URL — trust game.image, skip stale localStorage/server
    if (hasExplicitArtwork && game.image) {
        if (_applyCardCoverResult(requestContext, game.image, { source: 'user-artwork' })) checkBackgroundAssets(game);
        return;
    }

    if (hasExplicitArtwork && !game.image) {
        localStorage.removeItem(cacheKey);
    }

    // 2. localStorage has a local file path — probe before trusting
    if (storedCover && storedCover.startsWith('file://')) {
        const alive = await window.electronAPI.probeLocalImage(storedCover).catch(() => false);
        if (alive && _applyCardCoverResult(requestContext, storedCover, { source: 'legacy-cache-hit' })) { game.image = storedCover; checkBackgroundAssets(game); return; }
        // File is gone — drop stale entry
        localStorage.removeItem(cacheKey);
    }

    // 3. Check disk cache directly across canonical/local/display aliases
    if (window.__baddelLoadCachedArtworkForGame) {
        const canonicalGame = { id: game.localGameId || game.installedId || game.id };
        const cachedArtwork = await window.__baddelLoadCachedArtworkForGame(game, canonicalGame).catch(() => null);
        const cachedCover = _isCacheBackedNormalArtworkUrl(cachedArtwork?.cover);
        if (cachedCover && !hasExplicitArtwork && _applyCardCoverResult(requestContext, cachedCover, { source: 'v2-cache-hit' })) {
            game.image = cachedCover;
            game.defaultImage = cachedCover;
            game.coverUrl = cachedCover;
            if (cachedArtwork?.hero) {
                game.heroImage = cachedArtwork.hero;
                game.defaultHero = cachedArtwork.hero;
            }
            if (cachedArtwork?.logo) {
                game.logo = cachedArtwork.logo;
                game.defaultLogo = cachedArtwork.logo;
            }
            window.electronAPI.saveMetadata?.(canonicalGame.id, { cover: cachedCover, hero: cachedArtwork?.hero || null, logo: cachedArtwork?.logo || null }, {
                source: 'installed-cache-hit',
                displayId: game.id,
            }).catch(() => {});
            if (typeof currentHeroGameId !== 'undefined' && String(currentHeroGameId) === String(game.id)) {
                window.__baddelRequestHomeHeroTransition?.(game.id, { immediate: true, reason: 'installed-cache-hit' });
            }
            return;
        }
    }

    // 3b. Check disk cache directly (handles reinstall where localStorage was wiped)
    if (window.electronAPI.getCachedImage) {
        try {
            const diskCover = await window.electronAPI.getCachedImage(game.id, 'cover');
            const safeDiskCover = _isCacheBackedNormalArtworkUrl(diskCover);
            if (safeDiskCover && !hasExplicitArtwork && _applyCardCoverResult(requestContext, safeDiskCover, { source: 'v2-cache-hit' })) {
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
    imageQueue.push({ imgElement, game, requestContext });
    processQueue();
}

async function processQueue() {
    if (activeRequests >= 3 || imageQueue.length === 0) return;
    activeRequests++;
    const { imgElement, game, requestContext = _beginCardArtworkRequest(imgElement, game), _coverRetries = 0 } = imageQueue.shift();
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
                    imageQueue.push({ imgElement, game, requestContext, _coverRetries: _coverRetries + 1 });
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
            console.log(`[BaddelAPIEnrichAssets] ${game.name} (${game.id}): cover=${!!meta.cover} hero=${!!metaHero} logo=${!!metaLogo}`);

            if (window.electronAPI.cacheAllAssets) {
                const canonicalArtworkId = game.localGameId || game.installedId || game.id;
                const localAssets = await window.electronAPI.cacheAllAssets({ cover: meta.cover, hero: metaHero, logo: metaLogo }, canonicalArtworkId, {
                    priority: 'visible',
                    reason: 'explore-visible-cover',
                }).catch(() => null);
                const finalCover = _isCacheBackedNormalArtworkUrl(localAssets?.cover);
                const finalHero  = _isCacheBackedNormalArtworkUrl(localAssets?.hero);
                const finalLogo  = _isCacheBackedNormalArtworkUrl(localAssets?.logo);

                console.log(`[BaddelAPIEnrichAssets] ${game.name} cached: cover=${finalCover || 'none'} hero=${finalHero || 'none'}`);

                const saveCover = canApplyHydrated('cover') ? finalCover : null;
                const saveHero  = canApplyHydrated('hero') ? finalHero : null;
                const saveLogo  = canApplyHydrated('logo') ? finalLogo : null;
                if (saveCover || saveHero || saveLogo) {
                    const saved = await window.electronAPI.saveMetadata(canonicalArtworkId, { cover: saveCover, hero: saveHero, logo: saveLogo }, {
                        source: 'explore-visible-cover',
                        displayId: game.id,
                    }).catch(() => null);
                    if (saved?.updatedGame && typeof window.__baddelCommitCanonicalGameUpdate === 'function') {
                        const operationId = saved.operationId || `explore-${canonicalArtworkId}-${Date.now()}`;
                        window.__baddelCommitCanonicalGameUpdate({
                            canonicalGame: saved.updatedGame,
                            changedTypes: [
                                saveCover ? 'cover' : null,
                                saveHero ? 'hero' : null,
                                saveLogo ? 'logo' : null,
                            ].filter(Boolean),
                            operationId,
                        }, { reason: 'explore-visible-cover' });
                        if (saveCover) {
                            _applyCardCoverResult(requestContext, saveCover, { source: 'authoritative-exact-card-save' });
                            game.image = saveCover;
                            game.defaultImage = saveCover;
                            game.coverUrl = saveCover;
                        }
                        if (saveHero) {
                            game.heroImage = saveHero;
                            game.defaultHero = saveHero;
                            game.hero = saveHero;
                        }
                        if (saveLogo) {
                            game.logo = saveLogo;
                            game.defaultLogo = saveLogo;
                            game.logoUrl = saveLogo;
                        }
                        if (typeof currentHeroGameId !== 'undefined' && String(currentHeroGameId) === String(game.id)) {
                            window.__baddelRequestHomeHeroTransition?.(game.id, { immediate: true, reason: 'explore-visible-cover' });
                        }
                        return;
                    }
                    _logExploreArtworkRequest({
                        gameId: game.id,
                        requestId: requestContext.requestId,
                        source: 'canonical-save-missing-updated-game',
                        trusted: false,
                        applied: false,
                        ignoredReason: 'no-authoritative-updated-game',
                    });
                    return;
                }

                if (finalCover && canApplyHydrated('cover')) {
                    _logExploreArtworkRequest({ gameId: game.id, requestId: requestContext.requestId, source: 'blocked', trusted: false, applied: false, ignoredReason: 'awaiting-authoritative-save' });
                } else {
                    _logExploreArtworkRequest({ gameId: game.id, requestId: requestContext.requestId, source: 'blocked', trusted: false, applied: false, ignoredReason: 'no-local-cover' });
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
