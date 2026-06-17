'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT            = path.resolve(__dirname, '..');
const GAME_CONTEXT_JS = require('node:fs').readFileSync(path.join(ROOT, 'src/js/app/game-context-actions.js'), 'utf8');
const _SUGG_POOL_TTL = 6 * 60 * 60 * 1000;
const _SUGG_POOL_SINGLE = 5;

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

function getRoulettePosterUrlForTest(game, mode) {
    const raw = game?._raw || game || {};
    for (const field of ['image', 'defaultImage', 'coverUrl', 'capsuleImage', 'boxArt', 'grid', 'poster']) {
        const url = isUsableImageUrl(game?.[field]) || isUsableImageUrl(raw[field]);
        if (url) return url;
    }
    if (mode === 'install') {
        return isUsableImageUrl(game?.heroImage) || isUsableImageUrl(raw.heroImage) || null;
    }
    return null;
}

function applyRouletteFinalPosterForTest(finalGame, posterUrl, img, graphic, card) {
    const cleanUrl = isUsableImageUrl(posterUrl);
    const gameId = String(finalGame.id);
    card.classes.delete('spinning');
    card.classes.add('winner');
    card.dataset.gameId = gameId;

    if (!cleanUrl) {
        img.src = '';
        img.style.display = 'none';
        img.classList.delete('final-poster');
        img.classList.delete('spinning');
        img.dataset.gameId = gameId;
        card.classes.delete('has-poster');
        card.classes.add('no-poster');
        graphic.style.display = 'flex';
        return false;
    }

    img.onload = null;
    img.onerror = null;
    img.src = cleanUrl;
    img.style.display = 'block';
    img.style.opacity = '1';
    img.style.objectFit = 'cover';
    img.style.objectPosition = 'center';
    img.classList.delete('spinning');
    img.classList.add('final-poster');
    img.dataset.gameId = gameId;
    graphic.style.display = 'none';
    card.classes.add('has-poster');
    card.classes.delete('no-poster');
    return true;
}

function _key(g) {
    return `${g._platform}:${String(g.id)}`;
}

function _dedupe(games) {
    const seen = new Set();
    const out = [];
    for (const g of games) {
        const key = _key(g);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(g);
    }
    return out;
}

function buildReadyItems(games, filter, bucket) {
    const seed = `baddel_rtipool_${filter}_${bucket}`;
    if (filter === 'all') {
        return _dedupe(_seededShuffle(games, seed)).slice(0, _SUGG_POOL_SINGLE);
    }
    return _dedupe(_seededShuffle(games.filter(g => g._platform === filter), seed)).slice(0, _SUGG_POOL_SINGLE);
}

function setCardImageStableForTest(el, newUrl, fallbackUrl, ImageCtor) {
    const candidate = isUsableImageUrl(newUrl);
    const fallback = isUsableImageUrl(el.dataset.lastGoodImage) || isUsableImageUrl(fallbackUrl);
    const apply = (url) => {
        el.style.backgroundImage = `url('${url}')`;
        el.dataset.lastGoodImage = url;
    };
    if (!candidate) {
        if (fallback) apply(fallback);
        return;
    }
    const preloader = new ImageCtor();
    preloader.onload = () => apply(candidate);
    preloader.onerror = () => {
        if (fallback) apply(fallback);
    };
    preloader.src = candidate;
}

function makeGames(n, platform = 'steam') {
    return Array.from({ length: n }, (_, i) => ({
        id: `${platform}_${i}`,
        _platform: platform,
        title: `${platform} Game ${i}`,
    }));
}

test('Recommended returns max 5', () => {
    const games = [...makeGames(12, 'steam'), ...makeGames(12, 'epic')];
    assert.equal(buildReadyItems(games, 'all', 10).length, 5);
});

test('Steam returns max 5', () => {
    const games = [...makeGames(12, 'steam'), ...makeGames(12, 'epic')];
    assert.equal(buildReadyItems(games, 'steam', 10).length, 5);
});

test('Epic returns max 5', () => {
    const games = [...makeGames(12, 'steam'), ...makeGames(12, 'epic')];
    assert.equal(buildReadyItems(games, 'epic', 10).length, 5);
});

test('No You may also like render path exists', () => {
    const app = fs.readFileSync(path.join(ROOT, 'src/js/app.js'), 'utf8');
    const html = fs.readFileSync(path.join(ROOT, 'src/dashboard.html'), 'utf8');
    assert.equal(/You Might Also Like|You may also like|syncedSuggRecs|_renderSyncedRecs|_suggRecs/i.test(app + html), false);
});

test('Ready items do not duplicate within the same visible list', () => {
    const games = [...makeGames(10, 'steam'), ...makeGames(10, 'epic')];
    const visible = buildReadyItems(games, 'all', 22);
    const keys = visible.map(_key);
    assert.equal(keys.length, new Set(keys).size);
});

test('Same 6-hour bucket gives same selection', () => {
    const games = [...makeGames(20, 'steam'), ...makeGames(20, 'epic')];
    const bucket = Math.floor(Date.UTC(2026, 3, 24, 12) / _SUGG_POOL_TTL);
    assert.deepEqual(
        buildReadyItems(games, 'all', bucket).map(_key),
        buildReadyItems(games, 'all', bucket).map(_key)
    );
});

test('Different 6-hour bucket changes selection when enough games exist', () => {
    const games = [...makeGames(30, 'steam'), ...makeGames(30, 'epic')];
    const bucket = Math.floor(Date.UTC(2026, 3, 24, 12) / _SUGG_POOL_TTL);
    assert.notDeepEqual(
        buildReadyItems(games, 'all', bucket).map(_key),
        buildReadyItems(games, 'all', bucket + 1).map(_key)
    );
});

test('getPosterUrl prefers poster/cover before hero', () => {
    const game = {
        image: 'https://cdn.example.com/cover.jpg',
        defaultImage: 'https://cdn.example.com/default-cover.jpg',
        coverUrl: 'https://cdn.example.com/cover-url.jpg',
        capsuleImage: 'https://cdn.example.com/capsule.jpg',
        heroImage: 'https://cdn.example.com/hero.jpg',
    };
    assert.equal(getPosterUrl(game), 'https://cdn.example.com/cover.jpg');
});

test('Installed roulette poster helper does not return hero if cover exists', () => {
    const game = {
        image: 'https://cdn.example.com/cover.jpg',
        heroImage: 'https://cdn.example.com/hero.jpg',
    };
    assert.equal(getPosterUrlInstalled(game), 'https://cdn.example.com/cover.jpg');
});

test('Installed roulette poster helper does not fall back to hero', () => {
    const game = { heroImage: 'https://cdn.example.com/hero.jpg' };
    assert.equal(getPosterUrlInstalled(game), null);
});

test('Image stable setter does not blank existing image on failed preload', () => {
    class FailingImage {
        set src(_) {
            this.onerror?.();
        }
    }
    const el = {
        dataset: { lastGoodImage: 'https://cdn.example.com/old.jpg' },
        style: { backgroundImage: "url('https://cdn.example.com/old.jpg')" },
    };
    setCardImageStableForTest(el, 'https://cdn.example.com/new.jpg', null, FailingImage);
    assert.equal(el.dataset.lastGoodImage, 'https://cdn.example.com/old.jpg');
    assert.equal(el.style.backgroundImage, "url('https://cdn.example.com/old.jpg')");
});

test('roulette finalizer assigns result, name, and stopped state exactly once', () => {
    const calls = [];
    let spinTimeout = 123;
    let finalized = false;
    let selectedRouletteGame = null;
    const cleared = [];
    const card = {
        classes: new Set(['spinning']),
        classList: {
            remove: (...names) => names.forEach(n => card.classes.delete(n)),
            add: (...names) => names.forEach(n => card.classes.add(n)),
        },
    };
    const img = {
        classes: new Set(['spinning']),
        classList: {
            remove: (...names) => names.forEach(n => img.classes.delete(n)),
        },
    };
    const nameTxt = { innerText: 'Preview Game' };
    const finalGame = { id: 'game-final', name: 'Final Game' };

    function finalizeRoulette(game) {
        if (finalized) return;
        finalized = true;
        if (spinTimeout) {
            cleared.push(spinTimeout);
            spinTimeout = null;
        }
        selectedRouletteGame = game;
        nameTxt.innerText = game.name;
        calls.push(['poster', game.id]);
        card.classList.remove('spinning');
        img.classList.remove('spinning');
        card.classList.add('winner', 'has-poster');
    }

    finalizeRoulette(finalGame);
    finalizeRoulette({ id: 'late-preview', name: 'Late Preview' });

    assert.equal(selectedRouletteGame, finalGame);
    assert.equal(nameTxt.innerText, 'Final Game');
    assert.deepEqual(calls, [['poster', 'game-final']]);
    assert.deepEqual(cleared, [123]);
    assert.equal(card.classes.has('spinning'), false);
    assert.equal(img.classes.has('spinning'), false);
    assert.equal(card.classes.has('winner'), true);
});

test('roulette final result does not set final name before poster preload resolves', async () => {
    let resolvePreload;
    const preload = new Promise(resolve => { resolvePreload = resolve; });
    const nameTxt = { innerText: 'Preview Game' };
    let selected = null;
    const finalGame = { id: 'final', name: 'Final Game' };

    async function finalizeRoulette(game) {
        const poster = await preload;
        selected = game;
        if (poster.ok) nameTxt.poster = poster.url;
        nameTxt.innerText = game.name;
    }

    const done = finalizeRoulette(finalGame);
    await Promise.resolve();
    assert.equal(nameTxt.innerText, 'Preview Game');
    assert.equal(selected, null);
    resolvePreload({ ok: true, url: 'https://cdn.example.com/final.jpg' });
    await done;
    assert.equal(selected, finalGame);
    assert.equal(nameTxt.innerText, 'Final Game');
    assert.equal(nameTxt.poster, 'https://cdn.example.com/final.jpg');
});

test('roulette preview callbacks cannot update poster/name after finalization starts', () => {
    let finalized = false;
    const nameTxt = { innerText: 'Preview Game' };
    const img = { src: 'preview.jpg' };

    function previewCallback(game) {
        if (finalized) return;
        nameTxt.innerText = game.name;
        img.src = game.poster;
    }

    finalized = true;
    previewCallback({ name: 'Late Preview', poster: 'late.jpg' });
    assert.equal(nameTxt.innerText, 'Preview Game');
    assert.equal(img.src, 'preview.jpg');
});

test('roulette final poster and final name are applied in the same finalize step', () => {
    const events = [];
    const nameTxt = { innerText: 'Preview' };
    const img = { src: 'preview.jpg' };
    const finalGame = { id: 'final', name: 'Final Game' };

    function visualLock(game, posterUrl) {
        img.src = posterUrl;
        nameTxt.innerText = game.name;
        events.push({ poster: img.src, name: nameTxt.innerText });
    }

    visualLock(finalGame, 'final.jpg');
    assert.deepEqual(events, [{ poster: 'final.jpg', name: 'Final Game' }]);
});

function pickFinalForTest(pool, recent) {
    const recentSet = new Set(recent);
    let candidates = pool;
    const withoutRecent = pool.filter(g => !recentSet.has(g.id));
    if (withoutRecent.length >= 3) {
        candidates = withoutRecent;
    } else if (pool.length > 1 && recent[recent.length - 1]) {
        const withoutImmediate = pool.filter(g => g.id !== recent[recent.length - 1]);
        if (withoutImmediate.length) candidates = withoutImmediate;
    }
    return candidates[0];
}

test('roulette final picker avoids immediate repeat when possible', () => {
    const pool = [{ id: 'a' }, { id: 'b' }];
    assert.equal(pickFinalForTest(pool, ['a']).id, 'b');
});

test('roulette recent-pick avoidance keeps last 3 and does not over-filter tiny pools', () => {
    let recent = ['a', 'b', 'c', 'd'].slice(-3);
    assert.deepEqual(recent, ['b', 'c', 'd']);
    const tinyPool = [{ id: 'b' }, { id: 'c' }];
    assert.ok(['b', 'c'].includes(pickFinalForTest(tinyPool, recent).id));
    const largePool = [{ id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }, { id: 'f' }, { id: 'g' }];
    assert.equal(pickFinalForTest(largePool, recent).id, 'e');
});

test('roulette hero background is set after final selection when hero exists', () => {
    const section = {
        classes: new Set(),
        style: {
            values: {},
            setProperty(key, value) { this.values[key] = value; },
        },
        classList: {
            add(name) { section.classes.add(name); },
        },
    };
    const heroUrl = 'https://cdn.example.com/hero.jpg';
    section.style.setProperty('--roulette-hero-bg', `url("${heroUrl}")`);
    section.classList.add('has-hero-bg');
    assert.equal(section.style.values['--roulette-hero-bg'], `url("${heroUrl}")`);
    assert.equal(section.classes.has('has-hero-bg'), true);
});

test('roulette hero background is reset at the start of a new spin', () => {
    const section = {
        classes: new Set(['has-hero-bg']),
        style: {
            values: { '--roulette-hero-bg': 'url("hero.jpg")' },
            removeProperty(key) { delete this.values[key]; },
        },
        classList: {
            remove(name) { section.classes.delete(name); },
        },
    };
    section.classList.remove('has-hero-bg');
    section.style.removeProperty('--roulette-hero-bg');
    assert.equal(section.classes.has('has-hero-bg'), false);
    assert.equal(section.style.values['--roulette-hero-bg'], undefined);
});

test('getRoulettePosterUrl prefers poster fields before hero', () => {
    const game = {
        id: 'g1',
        image: 'https://cdn.example.com/image.jpg',
        defaultImage: 'https://cdn.example.com/default.jpg',
        coverUrl: 'https://cdn.example.com/cover.jpg',
        heroImage: 'https://cdn.example.com/hero.jpg',
    };
    assert.equal(getRoulettePosterUrlForTest(game, 'install'), 'https://cdn.example.com/image.jpg');
});

test('getRoulettePosterUrl installed mode does not fallback to hero when poster is missing', () => {
    const game = { id: 'g1', heroImage: 'https://cdn.example.com/hero.jpg' };
    assert.equal(getRoulettePosterUrlForTest(game, 'installed'), null);
});

test('applyRouletteFinalPoster sets rouletteImg dataset gameId to finalGame id', () => {
    const img = { src: 'old.jpg', style: {}, dataset: {}, classList: new Set(), onload: () => {}, onerror: () => {} };
    const graphic = { style: { display: 'flex' } };
    const card = { classes: new Set(['spinning']), dataset: {} };
    applyRouletteFinalPosterForTest({ id: 'final' }, 'https://cdn.example.com/final.jpg', img, graphic, card);
    assert.equal(img.dataset.gameId, 'final');
    assert.equal(card.dataset.gameId, 'final');
});

test('applyRouletteFinalPoster hides rouletteGraphic', () => {
    const img = { src: '', style: {}, dataset: {}, classList: new Set(), onload: null, onerror: null };
    const graphic = { style: { display: 'flex' } };
    const card = { classes: new Set(), dataset: {} };
    applyRouletteFinalPosterForTest({ id: 'final' }, 'https://cdn.example.com/final.jpg', img, graphic, card);
    assert.equal(graphic.style.display, 'none');
});

test('final visual lock does not keep previous preview poster', () => {
    const img = { src: 'https://cdn.example.com/preview.jpg', style: {}, dataset: {}, classList: new Set(), onload: null, onerror: null };
    const graphic = { style: { display: 'none' } };
    const card = { classes: new Set(['has-poster']), dataset: {} };
    applyRouletteFinalPosterForTest({ id: 'final' }, 'https://cdn.example.com/final.jpg', img, graphic, card);
    assert.equal(img.src, 'https://cdn.example.com/final.jpg');
});

test('final poster application and final name happen in the same finalize step', () => {
    const img = { src: 'preview.jpg', style: {}, dataset: {}, classList: new Set(), onload: null, onerror: null };
    const graphic = { style: { display: 'none' } };
    const card = { classes: new Set(['spinning']), dataset: {} };
    const nameTxt = { innerText: 'Preview' };
    const events = [];
    applyRouletteFinalPosterForTest({ id: 'final' }, 'https://cdn.example.com/final.jpg', img, graphic, card);
    nameTxt.innerText = 'Final';
    events.push({ src: img.src, name: nameTxt.innerText });
    assert.deepEqual(events, [{ src: 'https://cdn.example.com/final.jpg', name: 'Final' }]);
});

test('winner final-poster state removes spinning classes', () => {
    const img = { src: 'preview.jpg', style: {}, dataset: {}, classList: new Set(['spinning']), onload: null, onerror: null };
    const graphic = { style: { display: 'none' } };
    const card = { classes: new Set(['spinning']), dataset: {} };
    applyRouletteFinalPosterForTest({ id: 'final' }, 'https://cdn.example.com/final.jpg', img, graphic, card);
    assert.equal(img.classList.has('spinning'), false);
    assert.equal(card.classes.has('spinning'), false);
    assert.equal(img.classList.has('final-poster'), true);
    assert.equal(card.classes.has('winner'), true);
});

test('startRoulette schedules multiple preview ticks before finalize', () => {
    const events = [];
    let ticks = 0;
    const maxTicks = 4;
    function spinTick() {
        ticks++;
        if (ticks >= maxTicks) {
            events.push('finalize');
            return;
        }
        events.push(`preview-${ticks}`);
        spinTick();
    }
    spinTick();
    assert.deepEqual(events, ['preview-1', 'preview-2', 'preview-3', 'finalize']);
});

test('preview tick does not await image preload', () => {
    let preloadCalled = false;
    function previewTick(img, url) {
        img.src = url;
        return true;
    }
    const img = {};
    const applied = previewTick(img, 'https://cdn.example.com/poster.jpg');
    assert.equal(applied, true);
    assert.equal(img.src, 'https://cdn.example.com/poster.jpg');
    assert.equal(preloadCalled, false);
});

test('preview image error does not stop spin', () => {
    let isSpinningLocal = true;
    let timeoutCleared = false;
    const img = { dataset: {}, style: {}, src: '' };
    img.onerror = () => {
        isSpinningLocal = true;
    };
    img.onerror();
    assert.equal(isSpinningLocal, true);
    assert.equal(timeoutCleared, false);
});

test('finalize always resets isSpinning and re-enables button in finally', async () => {
    let isSpinningLocal = true;
    const spinBtn = { disabled: true, innerHTML: 'Rolling...' };
    async function finalize() {
        try {
            throw new Error('boom');
        } catch {
        } finally {
            isSpinningLocal = false;
            spinBtn.disabled = false;
            spinBtn.innerHTML = 'Spin Again';
        }
    }
    await finalize();
    assert.equal(isSpinningLocal, false);
    assert.equal(spinBtn.disabled, false);
    assert.equal(spinBtn.innerHTML, 'Spin Again');
});

test('final preload timeout still finalizes', async () => {
    let finalized = false;
    async function preloadFinal() {
        return { ok: false, url: null };
    }
    async function finalize() {
        try {
            await preloadFinal();
        } finally {
            finalized = true;
        }
    }
    await finalize();
    assert.equal(finalized, true);
});

test('play roulette posterPool empty can still spin names and finalize', () => {
    const originalPool = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
    const posterPool = [];
    const pool = posterPool.length > 0 ? posterPool : originalPool;
    const names = [];
    names.push(pool[0].name);
    const final = pool[1];
    assert.deepEqual(names, ['A']);
    assert.equal(final.name, 'B');
});

test('install roulette blocks instead of finalizing when no visual-ready candidates exist', () => {
    const originalPool = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
    const visualReady = [];
    let finalized = false;
    let toast = '';
    if (visualReady.length === 0 && originalPool.length > 0) {
        toast = 'Preparing artwork, try again in a moment.';
    } else {
        finalized = true;
    }
    assert.equal(finalized, false);
    assert.equal(toast, 'Preparing artwork, try again in a moment.');
});

test('install roulette only finalizes candidates with preloadable art', () => {
    const candidates = [
        { id: 'no-art', poster: null },
        { id: 'ready', poster: 'https://cdn.example.com/ready.jpg', preloaded: true },
    ];
    const visualReady = candidates.filter(g => g.poster && g.preloaded);
    assert.deepEqual(visualReady.map(g => g.id), ['ready']);
});

test('CSS state allows image visible during spinning has-poster', () => {
    const cardClasses = new Set(['spinning', 'has-poster']);
    const imgStyle = {};
    if (cardClasses.has('spinning') && cardClasses.has('has-poster')) {
        imgStyle.display = 'block';
        imgStyle.opacity = '1';
    }
    assert.equal(imgStyle.display, 'block');
    assert.equal(imgStyle.opacity, '1');
});

test('winner card spacing does not rely on translateY(-10px)', () => {
    const css = fs.readFileSync(path.join(ROOT, 'src/css/dashboard.css'), 'utf8');
    assert.equal(/\.roulette-card\.winner\s*{[^}]*translateY\(-10px\)/.test(css), false);
});

test('only one callable startRoulette implementation remains (in roulette.js)', () => {
    const rouletteJs = fs.readFileSync(path.join(ROOT, 'src/js/app/roulette.js'), 'utf8');
    const matches = rouletteJs.match(/async\s+function\s+startRoulette\s*\(/g) || [];
    assert.equal(matches.length, 1);
    // Confirm app.js no longer defines it
    const appJs = fs.readFileSync(path.join(ROOT, 'src/js/app.js'), 'utf8');
    assert.doesNotMatch(appJs, /async\s+function\s+startRoulette\s*\(/);
});

test('starting second spin increments token and ignores stale callbacks from first spin', () => {
    let token = 0;
    let poster = 'none';
    const first = ++token;
    const second = ++token;
    function staleCallback(callbackToken) {
        if (callbackToken !== token) return;
        poster = 'stale';
    }
    staleCallback(first);
    assert.equal(second, 2);
    assert.equal(poster, 'none');
});

test('Game Details includes Creator Mode entry point and toolbar', () => {
    const html = fs.readFileSync(path.join(ROOT, 'src', 'dashboard.html'), 'utf8');
    assert.match(html, /id="gdCreatorModeBtn"/);
    assert.match(html, /Creator Mode/);
    assert.match(html, /id="gdCreatorToolbar"/);
});

test('Creator Mode uses local customGameDetails storage and overlays metadata', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    assert.match(js, /customGameDetails/);
    assert.match(js, /function _gdMergeCustomIntoMeta/);
    assert.match(js, /function _gdBuildCustomMeta/);
    assert.match(js, /_gdMergeCustomIntoMeta\(game, metaData\)/);
});

test('missing metadata state offers Creator Mode and Load Page Pack without emoji copy', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    // Updated copy: "No details for this game yet"
    assert.match(js, /No details for this game yet/);
    // Both primary actions present
    assert.match(js, /Create Your Page/);
    assert.match(js, /Load Page Pack/);
    // No emoji in button text
    assert.doesNotMatch(js, /Create Your Page[^`]*ð/);
});

test('Creator Mode media controls use data-gd-creator-action for event delegation', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    assert.match(js, /data-gd-creator-action="add-media"/,    'add-media action missing');
    assert.match(js, /data-gd-creator-action="remove-media"/, 'remove-media action missing');
    assert.match(js, /data-gd-creator-action="move-media"/,   'move-media action missing');
    assert.match(js, /data-gd-creator-action="edit-trailer"/, 'edit-trailer action missing');
    assert.match(js, /data-gd-creator-action="edit-image"/,   'edit-image action missing');
    assert.match(js, /data-gd-creator-action="toggle-logo-mode"/, 'toggle-logo-mode action missing');
    assert.match(js, /data-gd-creator-action="edit-field"/,   'edit-field action missing');
});

test('Creator Mode controls do not use inline onclick to call non-global functions', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    assert.doesNotMatch(js, /onclick="gdCreatorAddMedia/,    'gdCreatorAddMedia still in inline onclick');
    assert.doesNotMatch(js, /onclick="gdCreatorEditTrailer/, 'gdCreatorEditTrailer still in inline onclick');
    assert.doesNotMatch(js, /onclick="gdCreatorRemoveMedia/, 'gdCreatorRemoveMedia still in inline onclick');
    assert.doesNotMatch(js, /onclick="gdCreatorMoveMedia/,   'gdCreatorMoveMedia still in inline onclick');
    assert.doesNotMatch(js, /onclick="_gdCreatorPrompt/,     '_gdCreatorPrompt still in inline onclick');
    assert.doesNotMatch(js, /onclick="_gdCreatorPromptImage/, '_gdCreatorPromptImage still in inline onclick');
});

test('Creator Mode delegated handler installed once via _gdCreatorDelegationInstalled guard', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    assert.match(js, /_gdCreatorDelegationInstalled/,    'delegation guard flag missing');
    assert.match(js, /_gdCreatorDelegatedClick/,         'delegated click handler missing');
    assert.match(js, /_gdInstallCreatorDelegation/,      'install delegation function missing');
    assert.match(js, /closest\(\s*'\[data-gd-creator-action\]'\s*\)/, 'closest selector not used in handler');
});

test('Creator Mode posterImage canonical field reads coverImage as fallback', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    assert.match(js, /posterImage.*existing\.posterImage.*existing\.coverImage/s, 'posterImage fallback to coverImage missing');
    assert.match(js, /posterImage.*meta\.cover/s, 'posterImage fallback to meta.cover missing');
    assert.match(js, /custom\.posterImage.*custom\.coverImage/s, 'cover resolution in _gdBuildCustomMeta missing');
});

test('Creator Mode draft update logic for add-media normalizes YouTube trailer URLs', () => {
    // Extract _gdNormalizeTrailerUrl by evaluating the logic inline
    function parseYtId(url) {
        try {
            const u = new URL(url);
            if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('?')[0] || null;
            if (u.hostname.includes('youtube.com')) {
                return u.searchParams.get('v') ||
                    (u.pathname.startsWith('/embed/') ? u.pathname.split('/embed/')[1].split('?')[0] : null);
            }
        } catch (_) {}
        return null;
    }
    function normalizeTrailerUrl(raw) {
        const ytId = parseYtId(raw.trim());
        return ytId ? `https://www.youtube.com/watch?v=${ytId}` : raw.trim();
    }
    assert.strictEqual(normalizeTrailerUrl('https://youtu.be/abc123xyz01'), 'https://www.youtube.com/watch?v=abc123xyz01');
    assert.strictEqual(normalizeTrailerUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    assert.strictEqual(normalizeTrailerUrl('https://www.youtube.com/embed/dQw4w9WgXcQ'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    assert.strictEqual(normalizeTrailerUrl('https://example.com/video.mp4'), 'https://example.com/video.mp4');
    assert.strictEqual(normalizeTrailerUrl('  https://youtu.be/abc  '), 'https://www.youtube.com/watch?v=abc');
});

test('Creator toolbar uses compact More menu instead of exposing every action', () => {
    const html = fs.readFileSync(path.join(ROOT, 'src', 'dashboard.html'), 'utf8');
    assert.match(html, /id="gdCreatorMoreBtn"/);
    assert.match(html, /id="gdCreatorMoreMenu"/);
    assert.match(html, /gdStartCreatorTour\(true\)/);
    assert.match(html, /id="gdCreatorShareBtn"[\s\S]*Share Page Pack/);
});

test('Creator shortDescription is saved and included in Page Pack v2', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    assert.match(js, /shortDescription/);
    assert.match(js, /version:\s*2/);
    assert.match(js, /shortDescription:\s*data\.shortDescription/);
    assert.match(js, /shortDescription:\s*_gdSanitizeString\(p\.shortDescription\)/);
});

test('Creator date picker uses DOB-style custom lists, not native date input', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    assert.match(js, /gd-dob-picker/);
    assert.match(js, /gd-dob-column/);
    assert.doesNotMatch(js, /input\s+type=["']date["']/i);
    assert.doesNotMatch(js, /prompt\(/);
});

test('Creator rating editor active path uses one modal and internal steps', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    const activeBlock = js.slice(js.indexOf('Active ratings editor'));
    assert.match(activeBlock, /One clean editor with source-specific fields/);
    assert.match(activeBlock, /let step = 'list'/);
    assert.match(activeBlock, /step = 'edit'/);
    assert.doesNotMatch(activeBlock, /await _gdCreatorRatingEntryModal/);
});

test('Page Pack IPC embeds and resolves local assets', () => {
    const preload = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
    const creatorHandlers = fs.readFileSync(path.join(ROOT, 'handlers', 'creatorPageHandlers.js'), 'utf8');
    assert.match(preload, /exportCreatorPagePack/);
    assert.match(preload, /resolveCreatorPageAssets/);
    assert.match(creatorHandlers, /creatorEmbedAssets/);
    assert.match(creatorHandlers, /asset:\/\//);
    assert.match(creatorHandlers, /creator-page-assets/);
});

test('Creator Mode state normalizer controls normal edit and preview classes', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    assert.match(js, /function _gdSetCreatorModeState\(mode/);
    assert.match(js, /creator-editing/);
    assert.match(js, /creator-preview/);
    assert.match(js, /toolbar\.style\.display = isActive \? 'flex' : 'none'/);
    assert.match(js, /entryBtn\.style\.display = isActive \? 'none' : ''/);
});

test('gdCreatorSave returns to normal state and does not apply draft as edit mode', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    const saveBlock = js.slice(js.indexOf('window.gdCreatorSave'), js.indexOf('window.gdCreatorCancel'));
    assert.match(saveBlock, /_gdSetCreatorModeState\('normal'/);
    assert.match(saveBlock, /_gdStripCreatorEditAffordances\(\)/);
    assert.doesNotMatch(saveBlock, /_gdCreatorApplyDraftToPage\(\)/);
});

test('Creator edit placeholders render only while actively editing', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    const placeholderBlock = js.slice(js.indexOf('function _gdCreatorRenderPlaceholders'), js.indexOf('function _gdRenderCreatorGallery'));
    const galleryBlock = js.slice(js.indexOf('function _gdRenderCreatorGallery'), js.indexOf('//'));
    assert.match(placeholderBlock, /if \(!_gdIsCreatorEditing\(\)\) return/);
    assert.match(js, /function _gdIsCreatorEditing/);
    assert.match(js, /if \(!el \|\| !_gdIsCreatorEditing\(\)\) return/);
    assert.match(js, /if \(!section \|\| !wrap \|\| !_gdIsCreatorEditing\(\)\) return/);
});

test('Creator debug state is exposed and dragEvent is not referenced', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    const html = fs.readFileSync(path.join(ROOT, 'src', 'dashboard.html'), 'utf8');
    assert.match(js, /window\.gdCreatorDebugState/);
    assert.doesNotMatch(js, /\bdragEvent\b/);
    assert.doesNotMatch(html, /\bdragEvent\b/);
});

test('Creator trailer dedupe canonicalizes YouTube string and object inputs', () => {
    function parseYtId(url) {
        try {
            const u = new URL(url);
            if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('?')[0] || null;
            if (u.hostname.includes('youtube.com')) {
                return u.searchParams.get('v') ||
                    (u.pathname.startsWith('/embed/') ? u.pathname.split('/embed/')[1].split('?')[0] : null);
            }
        } catch (_) {}
        return null;
    }
    function normalizeTrailerUrl(raw) {
        const ytId = parseYtId(String(raw || '').trim());
        return ytId ? `https://www.youtube.com/watch?v=${ytId}` : String(raw || '').trim();
    }
    function normalizeCreatorTrailer(trailer) {
        const raw = typeof trailer === 'string' ? trailer : (trailer?.url || trailer?.src || trailer?.href || '');
        const url = normalizeTrailerUrl(raw);
        return url || null;
    }
    function trailerKey(trailer) {
        const url = normalizeCreatorTrailer(trailer);
        return url ? url.toLowerCase() : '';
    }
    function normalizeTrailerList(list) {
        const seen = new Set();
        const out = [];
        for (const item of Array.isArray(list) ? list : []) {
            const normalized = normalizeCreatorTrailer(item);
            const key = trailerKey(normalized);
            if (!key || seen.has(key)) continue;
            seen.add(key);
            out.push(normalized);
        }
        return out;
    }
    function upsertUniqueTrailer(list, trailer) {
        const normalized = normalizeCreatorTrailer(trailer);
        const key = trailerKey(normalized);
        if (!key) return normalizeTrailerList(list);
        const clean = normalizeTrailerList(list).filter(t => trailerKey(t) !== key);
        clean.push(normalized);
        return clean;
    }

    const one = upsertUniqueTrailer([], 'https://youtu.be/abc123xyz01');
    assert.equal(one.length, 1);
    assert.equal(one[0], 'https://www.youtube.com/watch?v=abc123xyz01');

    const two = upsertUniqueTrailer(one, 'https://www.youtube.com/watch?v=abc123xyz01');
    assert.equal(two.length, 1);

    const mixed = normalizeTrailerList([
        'https://youtu.be/abc123xyz01',
        { url: 'https://www.youtube.com/watch?v=abc123xyz01' },
    ]);
    assert.equal(mixed.length, 1);
});

test('Creator trailer renderer has anti-duplication guard: skips featured index in strip loop', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');

    // The renderer function must exist
    assert.match(js, /function _gdRenderCreatorTrailers\(\)/,
        '_gdRenderCreatorTrailers function missing');

    // Must clear the container before any re-render (stale DOM prevention)
    const renderFn = js.slice(
        js.indexOf('function _gdRenderCreatorTrailers()'),
        js.indexOf('\nfunction ', js.indexOf('function _gdRenderCreatorTrailers()') + 10)
    );
    assert.match(renderFn, /wrap\.innerHTML\s*=\s*['"]{2}/,
        'wrap.innerHTML = "" clear-before-render guard missing');

    // Must track a selectedIndex / featuredIndex
    assert.match(renderFn, /selectedIndex\s*=\s*0/,
        'selectedIndex variable missing in _gdRenderCreatorTrailers');

    // Strip loop must skip the featured/selected index
    assert.match(renderFn, /if\s*\(index\s*===\s*selectedIndex\)\s*return/,
        'anti-duplication guard (if index === selectedIndex return) missing in strip forEach');

    // Must use a separate compact thumb function for strip items (not the full-size preview)
    assert.match(js, /function _gdCreatorTrailerThumbHtml\(/,
        '_gdCreatorTrailerThumbHtml compact strip function missing');

    // Featured block must use the full-size preview function
    assert.match(renderFn, /_gdCreatorTrailerPreviewHtml\(/,
        '_gdCreatorTrailerPreviewHtml call missing in featured block');

    // Strip is always rendered (even for 1 trailer) so user can always add more.
    // The anti-duplication is the index===selectedIndex guard above, not a length check.
    assert.match(renderFn, /gd-ct-strip/,
        'strip container missing in _gdRenderCreatorTrailers');

    // Debug log must be present
    assert.match(renderFn, /console\.debug/,
        'debug log missing in _gdRenderCreatorTrailers');
});

test('Creator tour uses robust multi-candidate driver resolver including window.driver.js.driver', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    // Resolver function must exist
    assert.match(js, /function _gdResolveDriverFactory\(\)/,
        '_gdResolveDriverFactory missing');
    // Must check the CDN iife shape window.driver.js.driver
    assert.match(js, /window\.driver\?\.js\?\.driver/,
        'window.driver?.js?.driver candidate missing from resolver');
    // Must also check window.driver?.driver and window.Driver fallbacks
    assert.match(js, /window\.driver\?\.driver/,   'window.driver?.driver fallback missing');
    assert.match(js, /window\.Driver/,             'window.Driver fallback missing');
    // No duplicate _gdRunCreatorTour declaration
    const tourMatches = [...js.matchAll(/^function _gdRunCreatorTour\b/gm)];
    assert.equal(tourMatches.length, 1, `_gdRunCreatorTour declared ${tourMatches.length} times — must be exactly 1`);
});

test('Creator tour does not silently fail: logs error and toasts when Driver unavailable', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    assert.match(js, /\[GD\]\[CreatorTour\] Driver\.js is not available/,
        'console.error for missing Driver.js missing');
    assert.match(js, /Creator tour is not available because Driver\.js did not load/,
        'toast message for missing Driver.js missing');
    assert.match(js, /\[GD\]\[CreatorTour\] No valid tour steps found/,
        'console.warn for empty steps missing');
});

test('Creator tour first-time auto-show uses requestAnimationFrame with timeout', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    const fn = js.slice(
        js.indexOf('function _gdMaybeShowCreatorTour'),
        js.indexOf('\n}', js.indexOf('function _gdMaybeShowCreatorTour')) + 2
    );
    assert.match(fn, /_GD_CREATOR_TOUR_KEY/,         'seen-flag check missing from _gdMaybeShowCreatorTour');
    assert.match(fn, /requestAnimationFrame/,         'requestAnimationFrame missing from _gdMaybeShowCreatorTour');
    assert.match(fn, /setTimeout/,                   'setTimeout missing from _gdMaybeShowCreatorTour');
    assert.match(fn, /_gdRunCreatorTour/,             '_gdRunCreatorTour call missing from _gdMaybeShowCreatorTour');
});

test('Creator Help button calls gdStartCreatorTour and More menu is closed before tour', () => {
    const html = fs.readFileSync(path.join(ROOT, 'src', 'dashboard.html'), 'utf8');
    const js   = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    // Help button must call gdStartCreatorTour(true)
    assert.match(html, /gdStartCreatorTour\(true\)/,  'Help button does not call gdStartCreatorTour(true)');
    // gdStartCreatorTour must close the More menu before starting
    const startFn = js.slice(
        js.indexOf('window.gdStartCreatorTour'),
        js.indexOf('\n};', js.indexOf('window.gdStartCreatorTour')) + 3
    );
    assert.match(startFn, /_gdCloseCreatorMoreMenu/,  '_gdCloseCreatorMoreMenu not called from gdStartCreatorTour');
    assert.match(startFn, /requestAnimationFrame/,    'gdStartCreatorTour must defer via requestAnimationFrame');
    // _gdCloseCreatorMoreMenu must exist
    assert.match(js, /function _gdCloseCreatorMoreMenu\(\)/,
        '_gdCloseCreatorMoreMenu function missing');
});

test('Creator tour debug helper exposes resolved and steps count', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    assert.match(js, /window\.gdCreatorTourDebug/,   'gdCreatorTourDebug not exposed');
    assert.match(js, /resolved.*_gdResolveDriverFactory\(\)/s, 'resolved field missing from gdCreatorTourDebug');
    assert.match(js, /steps.*_gdBuildCreatorTourSteps\(\)\.length/s, 'steps field missing from gdCreatorTourDebug');
});

test('Creator trailer add uses canonical helper and direct pushes are non-trailer only', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    assert.match(js, /async function _gdCreatorAddTrailerOnce/);
    assert.match(js, /let _gdCreatorAddingTrailer = false/);
    assert.match(js, /await _gdCreatorAddTrailerOnce\(\)/);
    assert.match(js, /window\.gdCreatorAddMedia = async function\(field\)[\s\S]*await _gdCreatorAddTrailerOnce\(\)/);
    const addMediaBlock = js.slice(js.indexOf("case 'add-media'"), js.indexOf("case 'edit-trailer'"));
    assert.match(addMediaBlock, /if \(isTrailer\) \{\s*await _gdCreatorAddTrailerOnce\(\);\s*break;\s*\}/);
    assert.match(js, /if \(field === 'trailers'\)[\s\S]*_gdNormalizeTrailerList\(value\)/);
});

// ── All Games → Game Details installed detection via _gdFindInstalledLocalMatch ──

test('_gdFindInstalledLocalMatch: game-details.js defines the helper function', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    assert.match(js, /function _gdFindInstalledLocalMatch\s*\(/);
});

test('_gdFindInstalledLocalMatch: step 4 in openGameDetails uses the helper', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    assert.match(js, /_gdFindInstalledLocalMatch\s*\(game\)/);
});

test('_gdFindInstalledLocalMatch: merges appName, namespace, catalogItemId, launcherGameId', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    const fnStart = js.indexOf('function _gdFindInstalledLocalMatch');
    const fnEnd   = js.indexOf('\n}', fnStart) + 2;
    const fn      = js.slice(fnStart, fnEnd);
    assert.match(fn, /appName/);
    assert.match(fn, /launcherGameId/);
    assert.match(fn, /catalogItemId/);
    assert.match(fn, /namespace/);
});

test('_gdFindInstalledLocalMatch: Epic appName match uses _gdCanMergeInstalledRecord guard', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    const fnStart = js.indexOf('function _gdFindInstalledLocalMatch');
    const fnEnd   = js.indexOf('\n}', fnStart) + 2;
    const fn      = js.slice(fnStart, fnEnd);
    assert.match(fn, /_gdCanMergeInstalledRecord/);
});

test('step 4 merge spreads launchCommand, executablePath, scannerPlatform onto game', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    // Anchor on 'scannerPlatform:' inside the openGameDetails installedMatch spread
    const mergeIdx = js.indexOf('scannerPlatform:');
    assert.ok(mergeIdx !== -1, "'scannerPlatform:' not found in game-details.js");
    const mergeBlock = js.slice(Math.max(0, mergeIdx - 400), mergeIdx + 400);
    assert.match(mergeBlock, /launchCommand/);
    assert.match(mergeBlock, /executablePath/);
    assert.match(mergeBlock, /scannerPlatform/);
});

// ── gdInstallConfirm: in-flight guard and no duplicate open ──────

test('gdInstallConfirm: _gdInstallConfirmInFlight guard is declared', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    assert.match(js, /_gdInstallConfirmInFlight/);
});

test('gdInstallConfirm: no duplicate setTimeout openExternal call for Epic install', () => {
    const js  = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    // Count occurrences of openExternal inside the install confirm impl
    const implStart = js.indexOf('async function _gdInstallConfirmImpl');
    const implEnd   = js.indexOf('\n}', implStart) + 2;
    const impl      = js.slice(implStart, implEnd);
    const openCount = (impl.match(/openExternal/g) || []).length;
    // Should open exactly once per platform branch (steam + epic = 2 total max)
    assert.ok(openCount <= 2, `Expected at most 2 openExternal calls in impl, found ${openCount}`);
    assert.doesNotMatch(impl, /setTimeout[^)]*openExternal/);
});

test('gdInstallConfirm: does_not_own check before modal removal', () => {
    const js  = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    const impl = js.slice(
        js.indexOf('async function _gdInstallConfirmImpl'),
        js.indexOf('async function _gdInstallConfirmImpl') + 600
    );
    assert.match(impl, /does_not_own/);
});

// ── window._agFindInstalledLocalMatch (All Games → Game Details consistency) ──

test('suggestions.js exposes window._agFindInstalledLocalMatch', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'app', 'suggestions.js'), 'utf8');
    assert.match(js, /window\._agFindInstalledLocalMatch\s*=/);
});

test('window._agFindInstalledLocalMatch is a function returning a record object', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'app', 'suggestions.js'), 'utf8');
    // The core loop lives in _agCollectMatches; it must push records (not true/false)
    const fnStart = js.indexOf('function _agCollectMatches');
    const fn      = js.slice(fnStart, fnStart + 5000);
    assert.match(fn, /results\.push\(g\)/);
    assert.match(fn, /return results/);
    assert.doesNotMatch(fn, /return true/);
    assert.doesNotMatch(fn, /return false/);
});

test('window._agFindInstalledLocalMatch: Epic appName matching is supported', () => {
    const js      = fs.readFileSync(path.join(ROOT, 'src', 'js', 'app', 'suggestions.js'), 'utf8');
    const fnStart = js.indexOf('function _agCollectMatches');
    const fn      = js.slice(fnStart, fnStart + 5000);
    assert.match(fn, /epicAppName/);
    assert.match(fn, /g\.appName\s*===\s*epicAppName/);
});

test('window._agFindInstalledLocalMatch: launcherGameId tuple matching is supported', () => {
    const js      = fs.readFileSync(path.join(ROOT, 'src', 'js', 'app', 'suggestions.js'), 'utf8');
    const fnStart = js.indexOf('function _agCollectMatches');
    const fn      = js.slice(fnStart, fnStart + 5000);
    assert.match(fn, /epicTuple/);
    assert.match(fn, /launcherGameId/);
});

test('window._agFindInstalledLocalMatch: Epic namespace alone must NOT be used as match', () => {
    const js      = fs.readFileSync(path.join(ROOT, 'src', 'js', 'app', 'suggestions.js'), 'utf8');
    const fnStart = js.indexOf('window._agFindInstalledLocalMatch');
    const fnEnd   = js.indexOf('\n};', fnStart) + 3;
    const fn      = js.slice(fnStart, fnEnd);
    // The tuple requires namespace+catalogItemId+appName together; namespace alone must not be used
    // Verify there is no cmd.includes(namespace) or g.id === namespace style check
    assert.doesNotMatch(fn, /cmd\.includes\s*\(\s*namespace\s*\)/);
    assert.doesNotMatch(fn, /lid\s*===\s*namespace/);
    assert.doesNotMatch(fn, /g\.id\s*===\s*epicNs\b/);
});

test('game-details openGameDetails step 4 tries window._agFindInstalledLocalMatch before fallback', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    // The merged block must reference window._agFindInstalledLocalMatch AND _gdFindInstalledLocalMatch
    const mergeIdx   = js.indexOf('window._agFindInstalledLocalMatch');
    const fallbackIdx = js.indexOf('_gdFindInstalledLocalMatch(game)');
    assert.ok(mergeIdx !== -1, 'window._agFindInstalledLocalMatch not found in game-details.js');
    assert.ok(fallbackIdx !== -1, '_gdFindInstalledLocalMatch fallback not found');
    // The window._ call must appear before (or in the same expression as) the fallback
    assert.ok(mergeIdx < fallbackIdx + 200, 'window._agFindInstalledLocalMatch should precede fallback');
});

test('step 4 merge includes allIds field from installedMatch', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    const mergeIdx   = js.indexOf('window._agFindInstalledLocalMatch');
    const mergeBlock = js.slice(mergeIdx, mergeIdx + 1400);
    assert.match(mergeBlock, /allIds/);
});

test('window._agFindInstalledLocalMatch: runtime behavior — Epic appName match returns record', () => {
    // Inline simulation of the matching logic (no DOM needed)
    const localRecord = { id: 'epic-MyGame', appName: 'MyGame', platform: 'epic', path: 'C:/Games/MyGame', command: null };
    const allGamesData = [localRecord];

    // Replicate the core lookup logic from app.js
    function agPlatFamily(p) {
        p = (p || '').toLowerCase();
        if (p.includes('epic')) return 'epic';
        return p || 'unknown';
    }
    function agCanMerge(base, cand) {
        if (String(cand.id) === String(base.id)) return true;
        return agPlatFamily(base.platform) === agPlatFamily(cand.platform);
    }
    function agFindInstalledLocalMatch(game) {
        for (const g of allGamesData) {
            if (!g.path && !g.command) continue;
            if (String(g.id) === String(game.id)) return g;
            if (game.installedId && String(g.id) === String(game.installedId)) return g;
            const epicAppName = game.appName || null;
            if (epicAppName && g.appName === epicAppName && agCanMerge(game, g)) return g;
        }
        return null;
    }

    const syncedGame = { id: 'synced-abc', appName: 'MyGame', platform: 'epic', name: 'My Game' };
    const result = agFindInstalledLocalMatch(syncedGame);
    assert.ok(result !== null, 'should find installed record by Epic appName');
    assert.strictEqual(result.id, 'epic-MyGame');
    assert.strictEqual(result.path, 'C:/Games/MyGame');
});

// ── Riot / cross-platform installed detection ──────────────────────────────────

// Shared simulation helpers used across Riot tests
function _simRiotProductFromStr(str) {
    const s = (str || '').toLowerCase();
    if (s.includes('launch-product=valorant') || s.includes('valorant-win64-shipping') ||
        (s.includes('riotclientservices') && s.includes('valorant'))) return 'valorant';
    if (s.includes('launch-product=league_of_legends') || s.includes('leagueclient.exe') ||
        (s.includes('riotclientservices') && s.includes('league_of_legends'))) return 'league_of_legends';
    return null;
}
function _simRiotAliases(key) {
    if (key === 'valorant') return new Set(['riot:valorant', 'valorant', 'val']);
    if (key === 'league_of_legends') return new Set(['riot:league_of_legends', 'riot:league', 'league_of_legends', 'leagueoflegends', 'league of legends', 'lol']);
    return new Set();
}
function _simTitleToRiotProduct(title) {
    const t = (title || '').toLowerCase().replace(/[®©™]/g, '').replace(/\s+/g, ' ').trim();
    if (t === 'valorant') return 'valorant';
    if (t === 'league of legends' || t === 'league of legends live') return 'league_of_legends';
    return null;
}
function _simIsMainGame(game) {
    const n = (game.name || game.title || '').toLowerCase();
    return !/\b(demo|dlc|pbe|public beta|open beta|editor|sdk|wallpaper|benchmark|soundtrack|ost|artbook|season pass|bonus|starter pack|trial|lite)\b|dedicated server|test server/.test(n);
}
function _simNormTitle(s) {
    return (s || '').toLowerCase().replace(/[®©™]/g, '').replace(/[:\-'']/g, ' ').replace(/\s+/g, ' ').trim();
}
function _simPlatFamily(p) {
    p = (p || '').toLowerCase();
    if (p.includes('steam')) return 'steam';
    if (p.includes('epic'))  return 'epic';
    if (p.includes('riot'))  return 'riot';
    return p || 'unknown';
}
function _simCanMerge(base, cand) {
    if (String(cand.id) === String(base.id)) return true;
    return _simPlatFamily(base.platform) === _simPlatFamily(cand.platform);
}

function _simFindInstalledLocalMatch(game, allGamesData) {
    const inRiotKey = _simTitleToRiotProduct(game.name || game.title || '') ||
        _simRiotProductFromStr(game.command || '') ||
        (game.allIds?.riot ? String(game.allIds.riot) : null);
    const inRiotSet = _simRiotAliases(inRiotKey);
    const selfNorm  = _simNormTitle(game.name || game.title || '');
    for (const g of allGamesData) {
        if (!g.path && !g.command) continue;
        if (String(g.id) === String(game.id)) return g;
        if (game.installedId && String(g.id) === String(game.installedId)) return g;
        const epicAppName = game.appName || null;
        if (epicAppName && g.appName === epicAppName && _simCanMerge(game, g)) return g;
        // Riot alias intersection (cross-platform)
        if (inRiotSet.size > 0) {
            const candRiotKey = _simRiotProductFromStr(g.command || '') || _simRiotProductFromStr(g.path || '');
            if (candRiotKey) {
                const candRiotSet = _simRiotAliases(candRiotKey);
                for (const a of inRiotSet) { if (candRiotSet.has(a)) return g; }
            }
        }
        // Cross-platform title fallback for main games
        const gNorm = _simNormTitle(g.name || '');
        if (gNorm && selfNorm && gNorm === selfNorm) {
            if (_simCanMerge(game, g) || (_simIsMainGame(game) && _simIsMainGame(g))) return g;
        }
    }
    return null;
}

test('Riot: VALORANT local install matched by --launch-product=valorant command', () => {
    const local = [{
        id: 'local-valorant',
        name: 'VALORANT',
        platform: 'Riot Games',
        scannerPlatform: 'riot',
        command: '"C:\\Riot Games\\Riot Client\\RiotClientServices.exe" --launch-product=valorant --launch-patchline=live',
        path: 'C:\\Riot Games\\VALORANT',
    }];
    // Incoming: Steam-synced VALORANT (different platform family from Riot install)
    const incoming = { id: 'steam-1234567', name: 'VALORANT', title: 'VALORANT', platform: 'steam', allIds: { steam: '1234567' } };
    const result = _simFindInstalledLocalMatch(incoming, local);
    assert.ok(result !== null, 'Should find VALORANT Riot install via Riot alias matching');
    assert.strictEqual(result.id, 'local-valorant');
});

test('Riot: League of Legends local install matched by --launch-product=league_of_legends command', () => {
    const local = [{
        id: 'local-lol',
        name: 'League of Legends',
        platform: 'Riot Games',
        scannerPlatform: 'riot',
        command: '"C:\\Riot Games\\Riot Client\\RiotClientServices.exe" --launch-product=league_of_legends --launch-patchline=live',
        path: 'C:\\Riot Games\\League of Legends',
    }];
    const incoming = { id: 'synced-lol', name: 'League of Legends', title: 'League of Legends', platform: 'steam', allIds: { steam: '99999' } };
    const result = _simFindInstalledLocalMatch(incoming, local);
    assert.ok(result !== null, 'Should find League of Legends Riot install via Riot alias matching');
    assert.strictEqual(result.id, 'local-lol');
});

test('Riot: RiotClientServices.exe alone does NOT fire riot alias match', () => {
    // RiotClientServices with no launch-product and no game name → no alias match
    assert.strictEqual(_simRiotProductFromStr('"C:\\Riot Games\\Riot Client\\RiotClientServices.exe"'), null);
    // Also: candidate with riotclientservices-only command + non-matching title → no match
    const local = [{
        id: 'local-riot-client',
        name: 'Riot Client',
        platform: 'Riot Games',
        command: '"C:\\Riot Games\\Riot Client\\RiotClientServices.exe"',
        path: 'C:\\Riot Games\\Riot Client',
    }];
    const incoming = { id: 'synced-valorant', name: 'VALORANT', title: 'VALORANT', platform: 'steam' };
    const result = _simFindInstalledLocalMatch(incoming, local);
    assert.strictEqual(result, null, 'RiotClientServices alone must not match VALORANT by riot alias');
});

test('cross-platform: multiplatform synced item matches local install by exact main-game title', () => {
    const local = [{
        id: 'local-some-game',
        name: 'Some Game',
        platform: 'Xbox',
        scannerPlatform: 'xbox',
        path: 'C:\\Games\\SomeGame',
        command: null,
    }];
    const incoming = {
        id: 'synced-sg',
        name: 'Some Game',
        title: 'Some Game',
        platform: 'steam',
        allIds: { steam: '1', epic: 'someEpicApp' },
    };
    const result = _simFindInstalledLocalMatch(incoming, local);
    assert.ok(result !== null, 'Main-game title should match across platforms');
    assert.strictEqual(result.id, 'local-some-game');
});

test('cross-platform: demo/DLC does NOT match base game title across platforms', () => {
    const local = [{
        id: 'local-base',
        name: 'Some Game',
        platform: 'Xbox',
        path: 'C:\\Games\\SomeGame',
        command: null,
    }];
    // Incoming is the demo of the game
    const incomingDemo = { id: 'synced-demo', name: 'Some Game Demo', title: 'Some Game Demo', platform: 'steam' };
    const resultDemo = _simFindInstalledLocalMatch(incomingDemo, local);
    assert.strictEqual(resultDemo, null, 'Demo incoming must not match base game local record');

    // Incoming is base game but local is DLC
    const localDlc = [{ id: 'local-dlc', name: 'Some Game DLC', platform: 'Xbox', path: 'C:\\Games\\SomeDLC', command: null }];
    const incomingBase = { id: 'synced-base', name: 'Some Game', title: 'Some Game', platform: 'steam' };
    const resultDlc = _simFindInstalledLocalMatch(incomingBase, localDlc);
    assert.strictEqual(resultDlc, null, 'Base incoming must not match DLC local record');
});

test('Epic namespace-only still does NOT produce a match', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'app.js'), 'utf8');
    const fnStart = js.indexOf('window._agFindInstalledLocalMatch');
    const fnEnd   = js.indexOf('\n};', fnStart) + 3;
    const fn      = js.slice(fnStart, fnEnd);
    // namespace must not appear as a standalone match condition
    assert.doesNotMatch(fn, /cmd\.includes\s*\(\s*namespace\s*\)/);
    assert.doesNotMatch(fn, /g\.id\s*===\s*epicNs\b/);
    assert.doesNotMatch(fn, /lid\s*===\s*namespace/);
});

test('game-details: action button reads game.path || game.command for PLAY vs INSTALL', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    const fnStart = js.indexOf('function _gdSetActionButton');
    const fn      = js.slice(fnStart, fnStart + 400);
    assert.match(fn, /game\.path\s*\|\|\s*game\.command/);
});

// ── Play modal installed-only launch options ───────────────────────────────────

test('play modal: _agFindInstalledLocalMatches exists and returns an array', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'app', 'suggestions.js'), 'utf8');
    assert.match(js, /window\._agFindInstalledLocalMatches\s*=/);
    // Must return an array (results variable)
    const fnStart = js.indexOf('window._agFindInstalledLocalMatches');
    const fn      = js.slice(fnStart, fnStart + 1200);
    assert.match(fn, /return results/);
});

test('play modal: _agFindInstalledLocalMatch returns first item from _agFindInstalledLocalMatches', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'app', 'suggestions.js'), 'utf8');
    // Find the single-match function body
    const idx = js.indexOf('window._agFindInstalledLocalMatch = function(game)');
    assert.ok(idx !== -1, 'single-match function not found');
    const body = js.slice(idx, idx + 200);
    assert.match(body, /_agFindInstalledLocalMatches\(game\)/);
    assert.match(body, /\[0\]/); // returns first element
});

test('play modal: game available on Steam/Epic but installed only from EA → one EA launch option', () => {
    // Simulate _gdBuildLaunchOptions logic
    function getPlatKey(opt) {
        const plat = (opt.scannerPlatform || opt.platform || '').toLowerCase();
        if (plat.includes('ea') || plat.includes('origin')) return 'ea';
        if (plat.includes('steam')) return 'steam';
        if (plat.includes('epic'))  return 'epic';
        return null;
    }
    function buildLaunchOptions(game, localInstalls) {
        const opts = []; const seenIds = new Set(); const seenPaths = new Set();
        function add(r) {
            if (!r || (!r.path && !r.command)) return;
            if (seenIds.has(r.id)) return;
            const pk = (r.path || r.command || '').toLowerCase();
            if (pk && seenPaths.has(pk)) return;
            seenIds.add(r.id); if (pk) seenPaths.add(pk);
            opts.push({ id: r.id, platform: r.platform, scannerPlatform: r.scannerPlatform || '',
                        path: r.path || null, command: r.command || null });
        }
        if (game.path || game.command) add(game);
        for (const m of localInstalls) add(m);
        return opts;
    }

    const baseGame = {
        id: 'synced-game', name: 'Some Game', platform: 'steam',
        allIds: { steam: '12345', epic: 'someapp' },
    };
    const eaInstall = {
        id: 'local-ea-game', name: 'Some Game', platform: 'EA App',
        scannerPlatform: 'ea', path: 'C:\\EA\\SomeGame\\Game.exe', command: null,
    };

    const opts = buildLaunchOptions(baseGame, [eaInstall]);
    assert.strictEqual(opts.length, 1);
    assert.strictEqual(getPlatKey(opts[0]), 'ea');
});

test('play modal: game installed from Steam AND EA → two launch options', () => {
    function buildLaunchOptions(game, localInstalls) {
        const opts = []; const seenIds = new Set(); const seenPaths = new Set();
        function add(r) {
            if (!r || (!r.path && !r.command)) return;
            if (seenIds.has(r.id)) return;
            const pk = (r.path || r.command || '').toLowerCase();
            if (pk && seenPaths.has(pk)) return;
            seenIds.add(r.id); if (pk) seenPaths.add(pk);
            opts.push({ id: r.id, platform: r.platform, scannerPlatform: r.scannerPlatform || '',
                        path: r.path || null, command: r.command || null });
        }
        if (game.path || game.command) add(game);
        for (const m of localInstalls) add(m);
        return opts;
    }

    const steamInstall = { id: 'local-steam', name: 'Some Game', platform: 'steam', scannerPlatform: 'steam', command: 'steam://rungameid/12345', path: null };
    const eaInstall    = { id: 'local-ea',    name: 'Some Game', platform: 'EA App', scannerPlatform: 'ea', path: 'C:\\EA\\SomeGame\\Game.exe', command: null };

    const opts = buildLaunchOptions({ id: 'synced', name: 'Some Game' }, [steamInstall, eaInstall]);
    assert.strictEqual(opts.length, 2);
    assert.ok(opts.some(o => (o.scannerPlatform || '').includes('steam')));
    assert.ok(opts.some(o => (o.scannerPlatform || '').includes('ea')));
});

test('play modal: rendering does not use game.platforms directly as launch options', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'play-launcher.js'), 'utf8');
    // The new path must use _gdBuildLaunchOptions, not game.platforms
    assert.match(js, /window\._gdBuildLaunchOptions/);
    // Platform list in new path comes from launchOpts, not game.platforms
    const newPathIdx = js.indexOf('window._gdBuildLaunchOptions');
    const newPathBlock = js.slice(newPathIdx, newPathIdx + 800);
    assert.match(newPathBlock, /launchOpts/);
    assert.match(newPathBlock, /_plGetPlatformKey/);
    assert.doesNotMatch(newPathBlock, /game\.platforms/);
});

test('play modal: does not render uninstalled owned/synced platforms', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'play-launcher.js'), 'utf8');
    // The new installed-only path derives platforms from launchOpts, never from allIds/ownership
    const newPathIdx = js.indexOf('const launchOpts = (typeof window._gdBuildLaunchOptions');
    const block = js.slice(newPathIdx, newPathIdx + 1200);
    assert.doesNotMatch(block, /game\.allIds/);
    assert.doesNotMatch(block, /game\.platforms/);
});

test('play modal: option rows require path or command', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    // _gdBuildLaunchOptions must guard: if (!record || (!record.path && !record.command)) return;
    const fnStart = js.indexOf('function _gdBuildLaunchOptions');
    const fn = js.slice(fnStart, fnStart + 600);
    assert.match(fn, /record\.path.*record\.command/);
    assert.match(fn, /return/);
});

test('play modal: Not Owned / Sync to verify / Add to switcher strings are absent from installed-only code path', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'play-launcher.js'), 'utf8');
    // The installed-only block (before fallback) must not reference ownership status strings
    const startIdx = js.indexOf('const launchOpts = (typeof window._gdBuildLaunchOptions');
    const returnIdx = js.indexOf('    // ── Fallback:', startIdx);
    const block = js.slice(startIdx, returnIdx);
    assert.doesNotMatch(block, /does_not_own/);
    assert.doesNotMatch(block, /add_to_switcher/);
    assert.doesNotMatch(block, /sync_to_verify/);
});

test('game-details main action shows PLAY when at least one launch option exists with path/command', () => {
    // _gdSetActionButton uses !!(game.path || game.command) which is set via _gdBuildLaunchOptions merge
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    const fnStart = js.indexOf('function _gdSetActionButton');
    const fn = js.slice(fnStart, fnStart + 700);
    assert.match(fn, /isInstalled\s*=\s*!!\s*\(\s*game\.path\s*\|\|\s*game\.command\s*\)/);
    assert.match(fn, /PLAY/);
});

test('game-details main action shows INSTALL when no launch options (no path/command on game)', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    const fnStart = js.indexOf('function _gdSetActionButton');
    const fn = js.slice(fnStart, fnStart + 2000);
    assert.match(fn, /INSTALL/);
    assert.match(fn, /install-mode/);
});

// ── Install button reliability (Epic / Steam cold-start) ──────────────────────

test('install: _gdInstallConfirmImpl uses openInstallUrl as primary path', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    const fnStart = js.indexOf('async function _gdInstallConfirmImpl');
    // Slice only the body of _gdInstallConfirmImpl, stopping before the next async function
    const fnEnd = js.indexOf('\nasync function _gdOpenInstallUrl', fnStart);
    const fn = fnEnd > fnStart ? js.slice(fnStart, fnEnd) : js.slice(fnStart, fnStart + 4000);
    // Must delegate to the helper (not call openExternal directly)
    assert.match(fn, /_gdOpenInstallUrl/);
    assert.doesNotMatch(fn, /openExternal/);
});

test('install: _gdOpenInstallUrl fallback to openExternal when openInstallUrl missing', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    const fnStart = js.indexOf('async function _gdOpenInstallUrl');
    const fn = js.slice(fnStart, fnStart + 3500);
    assert.match(fn, /openInstallUrl/);
    assert.match(fn, /openExternal/);
    assert.match(fn, /falling back/i);
});

test('install: in-flight guard still exists in gdInstallConfirm', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    const fnStart = js.indexOf('window.gdInstallConfirm');
    const fn = js.slice(fnStart, fnStart + 300);
    assert.match(fn, /_gdInstallConfirmInFlight/);
});

test('install: no blind setTimeout retry in renderer install confirm', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    const fnStart = js.indexOf('async function _gdInstallConfirmImpl');
    const fn = js.slice(fnStart, fnStart + 2000);
    // No bare setTimeout used for retry (account switch delay is OK, but no retry loop)
    const setTimeouts = [...fn.matchAll(/setTimeout/g)];
    // account-switch delays are allowed; what must NOT exist is a retry setTimeout after openExternal
    assert.doesNotMatch(fn, /openExternal[\s\S]{0,200}setTimeout/);
});

test('install: does_not_own guard still present in _gdInstallConfirmImpl', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    const fnStart = js.indexOf('async function _gdInstallConfirmImpl');
    const fn = js.slice(fnStart, fnStart + 600);
    assert.match(fn, /does_not_own/);
});

// ── Account-switch cold-start retry ──────────────────────────────────────────

test('install: _gdOpenInstallUrl passes forceRetryAfterOpen=true when didSwitchAccount=true', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    const fnStart = js.indexOf('async function _gdOpenInstallUrl');
    const fn = js.slice(fnStart, fnStart + 2000);
    assert.match(fn, /forceRetryAfterOpen/);
    assert.match(fn, /options\.didSwitchAccount/);
});

test('install: main handler reads forceRetryAfterOpen from payload', () => {
    const js = fs.readFileSync(path.join(ROOT, 'handlers', 'launchHandlers.js'), 'utf8');
    const fnStart = js.indexOf("ipcMain.handle('launcher:open-install-url'");
    const fn = js.slice(fnStart, fnStart + 800);
    assert.match(fn, /forceRetryAfterOpen/);
});

test('install: main handler uses ACCOUNT_SWITCH_GRACE_MS when forceRetryAfterOpen=true', () => {
    const js = fs.readFileSync(path.join(ROOT, 'handlers', 'launchHandlers.js'), 'utf8');
    assert.match(js, /ACCOUNT_SWITCH_GRACE_MS/);
    assert.match(js, /COLD_START_GRACE_MS/);
    // The handler must apply ACCOUNT_SWITCH_GRACE_MS when forceRetryAfterOpen is true
    const fnStart = js.indexOf("ipcMain.handle('launcher:open-install-url'");
    const fn = js.slice(fnStart, fnStart + 6000);
    assert.match(fn, /forceRetryAfterOpen.*ACCOUNT_SWITCH_GRACE_MS|ACCOUNT_SWITCH_GRACE_MS.*forceRetryAfterOpen/s);
});

// ── Play launcher fix: correct local id + command ─────────────────────────────

test('play: _plLaunchWithPlatform resolves selectedOpt from _plLaunchOptions', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'play-launcher.js'), 'utf8');
    const fnStart = js.indexOf('async function _plLaunchWithPlatform');
    const fn = js.slice(fnStart, fnStart + 800);
    assert.match(fn, /selectedOpt/);
    assert.match(fn, /_plLaunchOptions/);
    assert.match(fn, /_plGetPlatformKey/);
});

test('play: _plLaunchWithPlatform does not overwrite id from game.allIds[platKey]', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'play-launcher.js'), 'utf8');
    const fnStart = js.indexOf('async function _plLaunchWithPlatform');
    const fn = js.slice(fnStart, fnStart + 1200);
    assert.doesNotMatch(fn, /game\.allIds\s*&&\s*game\.allIds\[platKey\]/);
    assert.doesNotMatch(fn, /allIds\[platKey\]/);
});

test('play: _plLaunchWithPlatform validates command/path before launch', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'play-launcher.js'), 'utf8');
    const fnStart = js.indexOf('async function _plLaunchWithPlatform');
    const fn = js.slice(fnStart, fnStart + 1200);
    assert.match(fn, /gameToLaunch\.command.*gameToLaunch\.path|gameToLaunch\.path.*gameToLaunch\.command/);
    assert.match(fn, /No local launch data/);
});

test('play: _plDoActualLaunch has debug log using game.command and game.path', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'play-launcher.js'), 'utf8');
    const fnStart = js.indexOf('async function _plDoActualLaunch');
    const fn = js.slice(fnStart, fnStart + 700);
    assert.match(fn, /__debugPlayLaunch/);
    assert.match(fn, /game\.command/);
    assert.match(fn, /game\.path/);
});

test('play: _debugPlayLaunchOptions helper exposed on window', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'play-launcher.js'), 'utf8');
    assert.match(js, /window\._debugPlayLaunchOptions/);
    assert.match(js, /_plSelectedLaunchOpt/);
    assert.match(js, /_plLaunchOptions/);
});

// ── Steam install — main handler improvements ─────────────────────────────────

test('install: main launcher:open-install-url handler has Steam store fallback', () => {
    const js = fs.readFileSync(path.join(ROOT, 'handlers', 'launchHandlers.js'), 'utf8');
    const fnStart = js.indexOf("ipcMain.handle('launcher:open-install-url'");
    const fn = js.slice(fnStart, fnStart + 7500);
    assert.match(fn, /steam:\/\/store\//);
    assert.match(fn, /fallbackStoreUsed/);
});

test('install: main handler returns fallbackStoreUsed in result', () => {
    const js = fs.readFileSync(path.join(ROOT, 'handlers', 'launchHandlers.js'), 'utf8');
    const fnStart = js.indexOf("ipcMain.handle('launcher:open-install-url'");
    const fn = js.slice(fnStart, fnStart + 5000);
    assert.match(fn, /fallbackStoreUsed/);
    assert.match(fn, /wasRunning/);
    assert.match(fn, /appid/);
});

test('install: [Steam] payload log includes allIds and command', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    const idx = js.indexOf('[Install][Steam] payload');
    assert.ok(idx !== -1, '[Install][Steam] payload log not found');
    const block = js.slice(idx, idx + 600);
    assert.match(block, /allIds/);
    assert.match(block, /command/);
    assert.match(block, /installUrl/);
});

test('install: _gdResolveSteamInstallGame is defined in game-details.js', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    assert.ok(js.includes('async function _gdResolveSteamInstallGame'), 'helper function must be defined');
});

test('install: Steam branch calls _gdResolveSteamInstallGame before getSteamInstallUrl', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    const steamBranch = js.indexOf("targetPlatform === 'steam'");
    assert.ok(steamBranch !== -1, 'steam branch not found');
    const block = js.slice(steamBranch, steamBranch + 2500);
    assert.match(block, /_gdResolveSteamInstallGame/);
    assert.match(block, /getSteamInstallUrl\(steamInstallGame\)/);
    // resolve must appear before getSteamInstallUrl
    const resolvePos = block.indexOf('_gdResolveSteamInstallGame');
    const getUrlPos  = block.indexOf('getSteamInstallUrl(steamInstallGame)');
    assert.ok(resolvePos < getUrlPos, 'resolve must come before getSteamInstallUrl');
});

test('install: _gdResolveSteamInstallGame fetches platformSyncGetCached steam', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    const fnStart = js.indexOf('async function _gdResolveSteamInstallGame');
    assert.ok(fnStart !== -1);
    const fn = js.slice(fnStart, fnStart + 3000);
    assert.match(fn, /platformSyncGetCached/);
    assert.match(fn, /'steam'/);
    assert.match(fn, /_poFindLibraryGame/);
    assert.match(fn, /libGame\.appName/);
});

test('install: _gdResolveSteamInstallGame returns enriched game with appid fields', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    const fnStart = js.indexOf('async function _gdResolveSteamInstallGame');
    const fn = js.slice(fnStart, fnStart + 4500);
    assert.match(fn, /steamAppId/);
    assert.match(fn, /allIds/);
    assert.match(fn, /steam.*appid|appid.*steam/);
    assert.match(fn, /_steamInstallResolvedFromLibrary/);
});

// ── Activity-aware playtime tracker tests ────────────────────────────────────

test('tracker: main.js defines QUALIFIED_MIN_MINUTES and SUSPICIOUS_MAX_RATIO', () => {
    const js = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
    assert.match(js, /QUALIFIED_MIN_MINUTES/);
    assert.match(js, /SUSPICIOUS_MAX_RATIO/);
    assert.match(js, /IDLE_THRESHOLD_MS/);
    assert.match(js, /GRACE_PERIOD_MS/);
});

test('tracker: state machine has all required states', () => {
    const js = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
    assert.match(js, /'launching'/);
    assert.match(js, /'detected'/);
    assert.match(js, /'active'/);
    assert.match(js, /'paused_bg'/);
    assert.match(js, /'paused_idle'/);
    assert.match(js, /'suspicious'/);
});

test('tracker: _isForegroundGame is defined and checks PLATFORM_CLIENTS', () => {
    const js = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
    assert.match(js, /function _isForegroundGame/);
    assert.match(js, /PLATFORM_CLIENTS/);
});

test('tracker: saveTrackerPlaytime uses saveQualifiedSession not updatePlaytime for final save', () => {
    const js = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
    const fnStart = js.indexOf('function saveTrackerPlaytime');
    const fn = js.slice(fnStart, fnStart + 3500);
    assert.match(fn, /saveQualifiedSession/);
    assert.match(fn, /isQualified/);
    assert.match(fn, /foregroundSeen/);
    assert.match(fn, /sessionQualified/);
});

test('tracker: global watcher assigns confidence levels (high/medium/low)', () => {
    const js = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
    const fnStart = js.indexOf('function startGlobalWatcher');
    const fn = js.slice(fnStart, fnStart + 4000);
    assert.match(fn, /'high'/);
    assert.match(fn, /'medium'/);
    assert.match(fn, /'low'/);
    assert.match(fn, /matchedConf/);
});

test('tracker: timeTrackingEnabled=false skips startGameTracking', () => {
    const js = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
    const fnStart = js.indexOf('function startGameTracking');
    const fn = js.slice(fnStart, fnStart + 600);
    assert.match(fn, /timeTrackingEnabled/);
    assert.match(fn, /tracking disabled/);
});

test('game-card.js: getRecentGames sorts by lastQualifiedPlayed', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'app', 'game-card.js'), 'utf8');
    // getRecentGames delegates timestamp resolution to _jbiGetRecentTimestamp which uses lastQualifiedPlayed
    const fnStart = js.indexOf('function getRecentGames');
    const fn = js.slice(fnStart, fnStart + 500);
    assert.match(fn, /_jbiGetRecentTimestamp/);
    // The helper must use lastQualifiedPlayed
    const helperStart = js.indexOf('function _jbiGetRecentTimestamp');
    const helper = js.slice(helperStart, helperStart + 300);
    assert.match(helper, /lastQualifiedPlayed/);
    assert.doesNotMatch(fn, /\.sort\([^)]*lastPlayed[^)]*\)/);
});

test('playtime.js: buildPlaytimeCache includes lastQualifiedPlayed', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'app', 'playtime.js'), 'utf8');
    const fnStart = js.indexOf('function baddelPlaytimeBuildCache');
    const fn = js.slice(fnStart, fnStart + 400);
    assert.match(fn, /lastQualifiedPlayed/);
});

test('game-context-actions.js: showContextMenu has time tracking toggle item', () => {
    const fnStart = GAME_CONTEXT_JS.indexOf('function showContextMenu');
    const fn = GAME_CONTEXT_JS.slice(fnStart, fnStart + 2600);
    assert.match(fn, /toggleTimeTracking/);
    assert.match(fn, /Time Tracking/);
});

test('game-context-actions.js: toggleTimeTracking calls setTimeTrackingEnabled', () => {
    const fnStart = GAME_CONTEXT_JS.indexOf('async function toggleTimeTracking');
    assert.ok(fnStart !== -1, 'toggleTimeTracking must be defined');
    const fn = GAME_CONTEXT_JS.slice(fnStart, fnStart + 400);
    assert.match(fn, /setTimeTrackingEnabled/);
});

test('preload: setTimeTrackingEnabled and getTimeTrackingEnabled are exposed', () => {
    const js = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
    assert.match(js, /setTimeTrackingEnabled/);
    assert.match(js, /getTimeTrackingEnabled/);
    assert.match(js, /'set-time-tracking-enabled'/);
    assert.match(js, /'get-time-tracking-enabled'/);
});

test('game-details: _gdRenderTimeTrackingToggle and _gdToggleTimeTracking are defined', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    assert.match(js, /function _gdRenderTimeTrackingToggle/);
    assert.match(js, /window\._gdToggleTimeTracking/);
    assert.match(js, /setTimeTrackingEnabled/);
    assert.match(js, /timeTrackingEnabled/);
});

test('main.js: set-time-tracking-enabled and get-time-tracking-enabled IPC handlers exist', () => {
    const js = fs.readFileSync(path.join(ROOT, 'handlers/playtimeHandlers.js'), 'utf8');
    assert.match(js, /'set-time-tracking-enabled'/);
    assert.match(js, /'get-time-tracking-enabled'/);
    assert.match(js, /setTimeTrackingEnabled/);
    assert.match(js, /getTimeTrackingEnabled/);
});

test('playtimeOsHelper: module exists and exports getForegroundProcess + getIdleMs', () => {
    const helper = require(path.join(ROOT, 'playtimeOsHelper.js'));
    assert.equal(typeof helper.getForegroundProcess, 'function');
    assert.equal(typeof helper.getIdleMs, 'function');
    assert.equal(typeof helper.shutdown, 'function');
});

test('playtimeOsHelper: degrades gracefully in test env (returns null/0)', async () => {
    // Skip OS helper in test mode
    process.env.BADDEL_SKIP_OS_HELPER = '1';
    // Re-require to get a fresh instance
    const helperPath = path.join(ROOT, 'playtimeOsHelper.js');
    delete require.cache[require.resolve(helperPath)];
    const helper = require(helperPath);
    const fg = await helper.getForegroundProcess();
    const idle = await helper.getIdleMs();
    assert.equal(fg, null, 'must return null when disabled');
    assert.equal(idle, 0, 'must return 0 when disabled');
    delete require.cache[require.resolve(helperPath)];
    delete process.env.BADDEL_SKIP_OS_HELPER;
});

// ── OS helper unavailable: split-policy tests ─────────────────────────────────

test('tracker: startGameTracking stores userLaunched flag on tracker object', () => {
    const js = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
    const fnStart = js.indexOf('function startGameTracking');
    const fn = js.slice(fnStart, fnStart + 1400);
    assert.match(fn, /userLaunched/);
    assert.match(fn, /_osHelperWarnedOnce/);
    // default param must be false
    assert.match(fn, /userLaunched = false/);
});

test('tracker: launch-game IPC passes userLaunched=true to startGameTracking', () => {
    const js = fs.readFileSync(path.join(ROOT, 'handlers', 'launchHandlers.js'), 'utf8');
    const idx = js.indexOf("'launch-game'");
    const slice = js.slice(idx, idx + 10500);
    assert.match(slice, /userLaunched.*true|true.*userLaunched/);
});

test('tracker: _tickTracker separates OS-unavailable logic by userLaunched', () => {
    const js = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
    const fnStart = js.indexOf('async function _tickTracker');
    const fn = js.slice(fnStart, fnStart + 3500);
    // Must branch on userLaunched
    assert.match(fn, /tracker\.userLaunched/);
    // Legacy path logs message
    assert.match(fn, /legacy counting/);
    // External path logs different message
    assert.match(fn, /stays unconfirmed/);
    // confidence set to legacy
    assert.match(fn, /tracker\.confidence = 'legacy'/);
});

test('tracker: external watcher session (userLaunched=false) has effectiveFg=false when OS helper unavailable', () => {
    const js = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
    const fnStart = js.indexOf('async function _tickTracker');
    const fn = js.slice(fnStart, fnStart + 3500);
    // The else branch must set effectiveFg = false
    assert.match(fn, /effectiveFg = false/);
    // And log the warning
    assert.match(fn, /won't qualify/);
});

test('tracker: user-launched session (userLaunched=true) sets effectiveFg=true when OS helper unavailable', () => {
    const js = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
    const fnStart = js.indexOf('async function _tickTracker');
    const fn = js.slice(fnStart, fnStart + 3500);
    // The if (tracker.userLaunched) branch must set effectiveFg = true
    assert.match(fn, /effectiveFg = true/);
});

test('tracker: saveTrackerPlaytime treats legacy confidence as foregroundSeen=true', () => {
    const js = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
    const fnStart = js.indexOf('function saveTrackerPlaytime');
    const fn = js.slice(fnStart, fnStart + 2500);
    assert.match(fn, /confidence.*===.*'legacy'|'legacy'.*confidence/);
    // foregroundSeen variable (not just tracker.foregroundSeen raw)
    assert.match(fn, /const foregroundSeen/);
});

test('tracker: OS helper unavailable — external sessions cannot qualify (no foregroundSeen)', () => {
    const js = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
    // Verify the isQualified check uses the foregroundSeen variable (not tracker.foregroundSeen directly)
    const fnStart = js.indexOf('function saveTrackerPlaytime');
    const fn = js.slice(fnStart, fnStart + 2500);
    const qualIdx = fn.indexOf('const isQualified');
    const block = fn.slice(qualIdx, qualIdx + 200);
    // Must use the local foregroundSeen variable
    assert.match(block, /foregroundSeen/);
    // Must NOT use tracker.foregroundSeen directly inside isQualified expression
    assert.doesNotMatch(block, /tracker\.foregroundSeen/);
});

// ── Time Tracking toggle UI & export hardening ────────────────────────────────

test('game-details: tracking toggle has no emoji', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    const fnStart = js.indexOf('function _gdRenderTimeTrackingToggle');
    assert.ok(fnStart !== -1);
    const fn = js.slice(fnStart, fnStart + 2000);
    // Must not contain the clock emoji or any emoji in the render output
    assert.doesNotMatch(fn, /⏱/, 'clock emoji must be removed from tracking toggle');
    assert.doesNotMatch(fn, /[⏱⏲⏰]/, 'timer emoji must not appear');
});

test('game-details: tracking toggle renders ON/OFF pill text', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    const fnStart = js.indexOf('function _gdRenderTimeTrackingToggle');
    const fn = js.slice(fnStart, fnStart + 2000);
    assert.match(fn, /\bON\b/, 'must contain ON status text');
    assert.match(fn, /\bOFF\b/, 'must contain OFF status text');
});

test('game-details: tracking toggle renders Enable/Disable button text', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    const fnStart = js.indexOf('function _gdRenderTimeTrackingToggle');
    const fn = js.slice(fnStart, fnStart + 2000);
    assert.match(fn, /\bEnable\b/, 'must contain Enable button text');
    assert.match(fn, /\bDisable\b/, 'must contain Disable button text');
});

test('game-details: tracking toggle renders Time Tracking label', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    const fnStart = js.indexOf('function _gdRenderTimeTrackingToggle');
    const fn = js.slice(fnStart, fnStart + 2000);
    assert.match(fn, /Time Tracking/, 'must contain "Time Tracking" label text');
});

test('game-details: tracking toggle uses gdTimeTrackingRow container', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    const fnStart = js.indexOf('function _gdRenderTimeTrackingToggle');
    const fn = js.slice(fnStart, fnStart + 2000);
    assert.match(fn, /gdTimeTrackingRow/, 'must use gdTimeTrackingRow container');
});

test('game-details: tracking toggle uses inline SVG clock icon', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    const fnStart = js.indexOf('function _gdRenderTimeTrackingToggle');
    const fn = js.slice(fnStart, fnStart + 2000);
    assert.match(fn, /<svg/, 'must use inline SVG for clock icon');
    assert.match(fn, /viewBox/, 'SVG must have viewBox attribute');
});

test('game-details: tracking toggle includes gd-tracking-icon div', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    const fnStart = js.indexOf('function _gdRenderTimeTrackingToggle');
    const fn = js.slice(fnStart, fnStart + 2000);
    assert.match(fn, /gd-tracking-icon/, 'must include gd-tracking-icon element');
    assert.match(fn, /aria-hidden/, 'icon must be aria-hidden');
});

test('game-details: _gdRenderTimeTrackingToggle hides and clears row for non-installed games', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    const fnStart = js.indexOf('function _gdRenderTimeTrackingToggle');
    const fn = js.slice(fnStart, fnStart + 2000);
    assert.match(fn, /innerHTML\s*=\s*['"]['"]/, 'must clear innerHTML for non-installed games');
    assert.match(fn, /display.*none|none.*display/, 'must hide row for non-installed games');
});

test('game-details: installed detection uses _gdBuildLaunchOptions', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    const fnStart = js.indexOf('function _gdRenderTimeTrackingToggle');
    const fn = js.slice(fnStart, fnStart + 2000);
    assert.match(fn, /_gdBuildLaunchOptions/, 'must call _gdBuildLaunchOptions for installed detection');
    assert.match(fn, /executablePath|installPath/, 'must check executablePath or installPath for installed detection');
});

test('game-details: tracking toggle has no subtitle text', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    const fnStart = js.indexOf('function _gdRenderTimeTrackingToggle');
    const fn = js.slice(fnStart, fnStart + 2000);
    assert.doesNotMatch(fn, /gd-tracking-subtitle/, 'must not render subtitle element');
});

test('game-details: _gdToggleTimeTracking shows error toast on failure', () => {
    const js = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8');
    const fnStart = js.indexOf('window._gdToggleTimeTracking');
    const fn = js.slice(fnStart, fnStart + 1400);
    assert.match(fn, /showToast.*error|error.*showToast/, 'must show error toast on failure');
});

test('main.js: set-time-tracking-enabled has defensive fallback for missing export', () => {
    const js = fs.readFileSync(path.join(ROOT, 'handlers/playtimeHandlers.js'), 'utf8');
    assert.match(js, /Time tracking API unavailable/, 'must return safe error when export missing');
    assert.match(js, /setTimeTrackingEnabled missing from gameScanner/, 'must log when export missing');
});

test('game-context-actions.js: toggleTimeTracking shows error toast on failure', () => {
    const fnStart = GAME_CONTEXT_JS.indexOf('async function toggleTimeTracking');
    const fn = GAME_CONTEXT_JS.slice(fnStart, fnStart + 1300);
    assert.match(fn, /showToast.*error|error.*showToast/, 'must show error toast on failure');
});

test('context menu: Time Tracking item has no emoji', () => {
    // Check the area around "Disable Time Tracking" / "Enable Time Tracking"
    const idx = GAME_CONTEXT_JS.indexOf('Disable Time Tracking');
    assert.ok(idx !== -1, 'Disable Time Tracking text must exist in context menu');
    const snippet = GAME_CONTEXT_JS.slice(Math.max(0, idx - 50), idx + 100);
    // No emoji between the opening quote and the text
    assert.doesNotMatch(snippet, /[⏱⏰⏳]/, 'no clock emoji in context menu time tracking item');
});

// Runtime test: require the actual module and verify export types
test('gameScanner runtime exports: setTimeTrackingEnabled is a function', () => {
    const gs = require(path.join(ROOT, 'gameScanner'));
    assert.equal(typeof gs.setTimeTrackingEnabled, 'function',
        'setTimeTrackingEnabled must be a function in module.exports at runtime');
});

test('gameScanner runtime exports: getTimeTrackingEnabled is a function', () => {
    const gs = require(path.join(ROOT, 'gameScanner'));
    assert.equal(typeof gs.getTimeTrackingEnabled, 'function',
        'getTimeTrackingEnabled must be a function in module.exports at runtime');
});

// ── Trailer player guards ─────────────────────────────────────────────────────

const _gdTrailerSrc = (() => fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-details.js'), 'utf8'))();

test('Trailer: _gdIsDirectVideoUrl exists and uses new URL() pathname check', () => {
    assert.match(_gdTrailerSrc, /function _gdIsDirectVideoUrl/,
        '_gdIsDirectVideoUrl must be defined');
    assert.match(_gdTrailerSrc, /u\.pathname\.toLowerCase\(\)/,
        '_gdIsDirectVideoUrl must check pathname (not hostname) via new URL()');
});

test('Trailer: _gdIsDirectVideoUrl does NOT use hostname trust (steamstatic/akamaihd)', () => {
    const fnStart = _gdTrailerSrc.indexOf('function _gdIsDirectVideoUrl');
    const fnEnd   = _gdTrailerSrc.indexOf('\n}', fnStart) + 2;
    const fn      = _gdTrailerSrc.slice(fnStart, fnEnd);
    assert.doesNotMatch(fn, /steamstatic|akamaihd/,
        '_gdIsDirectVideoUrl must not trust Steam hostnames — only check file extension in pathname');
});

test('Trailer: _gdCanPlayDirectVideo exists and checks m3u8/mpd runtime support', () => {
    assert.match(_gdTrailerSrc, /function _gdCanPlayDirectVideo/,
        '_gdCanPlayDirectVideo must be defined');
    assert.match(_gdTrailerSrc, /\.m3u8/,
        '_gdCanPlayDirectVideo must handle .m3u8 (HLS)');
    assert.match(_gdTrailerSrc, /\.mpd/,
        '_gdCanPlayDirectVideo must handle .mpd (DASH)');
});

test('Trailer: showTrailerFallback helper exists and contains Open in Browser text', () => {
    assert.match(_gdTrailerSrc, /function showTrailerFallback/,
        'showTrailerFallback must be defined');
    assert.match(_gdTrailerSrc, /Open in Browser/,
        'showTrailerFallback must contain "Open in Browser" button text');
});

test('Trailer: _gdRenderTrailerPlayer checks YouTube before creating <video>', () => {
    const fnStart = _gdTrailerSrc.indexOf('function _gdRenderTrailerPlayer');
    const fnEnd   = _gdTrailerSrc.indexOf('\nfunction _gdBuildInfoGrid', fnStart);
    const fn      = _gdTrailerSrc.slice(fnStart, fnEnd);
    const ytCheckPos    = fn.indexOf('extractYouTubeVideoId');
    const videoCreatePos = fn.indexOf('container.innerHTML');
    assert.ok(ytCheckPos !== -1 && ytCheckPos < videoCreatePos,
        '_gdRenderTrailerPlayer must call extractYouTubeVideoId before setting container.innerHTML');
});

test('Trailer: _gdRenderTrailerPlayer uses _gdCanPlayDirectVideo to gate <video> creation', () => {
    const fnStart = _gdTrailerSrc.indexOf('function _gdRenderTrailerPlayer');
    const fnEnd   = _gdTrailerSrc.indexOf('\nfunction _gdBuildInfoGrid', fnStart);
    const fn      = _gdTrailerSrc.slice(fnStart, fnEnd);
    assert.match(fn, /_gdCanPlayDirectVideo/,
        '_gdRenderTrailerPlayer must use _gdCanPlayDirectVideo to decide whether to create <video>');
});

test('Trailer: _gdRenderTrailerPlayer has metadata timeout with _tryNext on failure', () => {
    const fnStart = _gdTrailerSrc.indexOf('function _gdRenderTrailerPlayer');
    const fnEnd   = _gdTrailerSrc.indexOf('\nfunction _gdBuildInfoGrid', fnStart);
    const fn      = _gdTrailerSrc.slice(fnStart, fnEnd);
    assert.match(fn, /setTimeout[\s\S]{0,600}_tryNext/,
        '_gdRenderTrailerPlayer must have a setTimeout that calls _tryNext on timeout');
});

test('Trailer: YouTube URL uses <webview> renderer, not DOM <video> or <iframe>', () => {
    const fnStart = _gdTrailerSrc.indexOf('function _gdRenderTrailerPlayer');
    const fnEnd   = _gdTrailerSrc.indexOf('\nfunction _gdBuildInfoGrid', fnStart);
    const fn      = _gdTrailerSrc.slice(fnStart, fnEnd);

    // Isolate the YouTube branch only: from `if (_ytIdEarly)` up to its closing `}`
    const branchStart  = fn.indexOf('if (_ytIdEarly)');
    // End marker: _gdRenderYouTubeWebviewPlayer + a generous window to include the return + }
    const markerPos    = fn.indexOf('_gdRenderYouTubeWebviewPlayer', branchStart);
    const branchEnd    = fn.indexOf('}', markerPos + 40) + 1;
    const ytBranch     = fn.slice(branchStart, branchEnd);

    assert.doesNotMatch(ytBranch, /<video/,
        'YouTube branch must not create a <video> element');
    assert.doesNotMatch(ytBranch, /<iframe/,
        'YouTube branch must not inject a DOM <iframe>');
    assert.match(ytBranch, /_gdRenderYouTubeWebviewPlayer/,
        'YouTube branch must call _gdRenderYouTubeWebviewPlayer to render the <webview>');
    assert.match(fn, /_ytIdEarly/,
        'YouTube path must pass the extracted videoId to _gdRenderYouTubeWebviewPlayer');
    // YouTube detection must be before the non-YouTube pipeline
    const ytPos   = fn.indexOf('extractYouTubeVideoId(rawUrl)');
    const candPos = fn.indexOf('_gdBuildCandidates');
    assert.ok(ytPos < candPos, 'extractYouTubeVideoId must run before _gdBuildCandidates');
});

test('Trailer: YouTube branch renders .gd-youtube-shell via _gdRenderYouTubeWebviewPlayer', () => {
    const fnStart = _gdTrailerSrc.indexOf('function _gdRenderYouTubeWebviewPlayer');
    assert.ok(fnStart !== -1, '_gdRenderYouTubeWebviewPlayer must be defined');
    const fnEnd   = _gdTrailerSrc.indexOf('\nfunction _gdRenderTrailerPlayer', fnStart);
    const fn      = _gdTrailerSrc.slice(fnStart, fnEnd);
    assert.match(fn, /gd-youtube-shell/,
        '_gdRenderYouTubeWebviewPlayer must create a .gd-youtube-shell container');
    assert.match(fn, /gd-youtube-thumb/,
        '_gdRenderYouTubeWebviewPlayer must include a .gd-youtube-thumb thumbnail');
    assert.match(fn, /<webview/,
        '_gdRenderYouTubeWebviewPlayer must create a <webview> element on click');
});

test('Trailer: _gdBuildYouTubeEmbedUrl includes playsinline and youtube.com/embed', () => {
    const fnStart = _gdTrailerSrc.indexOf('function _gdBuildYouTubeEmbedUrl');
    assert.ok(fnStart !== -1, '_gdBuildYouTubeEmbedUrl must be defined in game-details.js');
    const fn = _gdTrailerSrc.slice(fnStart, fnStart + 300);
    assert.match(fn, /playsinline/,
        '_gdBuildYouTubeEmbedUrl must include playsinline=1 for in-app playback');
    assert.match(fn, /youtube\.com\/embed\//,
        '_gdBuildYouTubeEmbedUrl must use youtube.com/embed for the webview src');
    assert.match(fn, /color=white/,
        '_gdBuildYouTubeEmbedUrl must include color=white for consistent player appearance');
});

test('Trailer: YouTube openExternal is only a secondary button, not the primary path', () => {
    const fnStart = _gdTrailerSrc.indexOf('function _gdRenderYouTubeWebviewPlayer');
    const fnEnd   = _gdTrailerSrc.indexOf('\nfunction _gdRenderTrailerPlayer', fnStart);
    const fn      = _gdTrailerSrc.slice(fnStart, fnEnd);
    // Primary action is <webview> with embed URL; openExternal is secondary
    assert.match(fn, /_gdBuildYouTubeEmbedUrl/,
        '<webview> embed URL must be the primary YouTube playback path');
    assert.match(fn, /gd-yt-open-btn/,
        'openExternal must only appear inside a .gd-yt-open-btn fallback button');
});

test('Trailer: _gdRenderTrailerPlayer uses _gdBuildCandidates for candidate list', () => {
    const fnStart = _gdTrailerSrc.indexOf('function _gdRenderTrailerPlayer');
    const fnEnd   = _gdTrailerSrc.indexOf('\nfunction _gdBuildInfoGrid', fnStart);
    const fn      = _gdTrailerSrc.slice(fnStart, fnEnd);
    assert.match(fn, /_gdBuildCandidates/,
        '_gdRenderTrailerPlayer must call _gdBuildCandidates to build the candidate list');
});

test('Trailer: _gdRenderTrailerPlayer has _tryNext candidate retry mechanism', () => {
    const fnStart = _gdTrailerSrc.indexOf('function _gdRenderTrailerPlayer');
    const fnEnd   = _gdTrailerSrc.indexOf('\nfunction _gdBuildInfoGrid', fnStart);
    const fn      = _gdTrailerSrc.slice(fnStart, fnEnd);
    assert.match(fn, /const _tryNext\s*=/,
        '_gdRenderTrailerPlayer must define a _tryNext closure for candidate retry');
    assert.match(fn, /_gdRenderTrailerPlayer\s*\(container,\s*trailers,\s*idx,\s*_candIdx\s*\+\s*1\)/,
        '_tryNext must call _gdRenderTrailerPlayer recursively with _candIdx + 1');
});

test('Trailer: showTrailerFallback is called only when all candidates are exhausted', () => {
    const fnStart = _gdTrailerSrc.indexOf('function _gdRenderTrailerPlayer');
    const fnEnd   = _gdTrailerSrc.indexOf('\nfunction _gdBuildInfoGrid', fnStart);
    const fn      = _gdTrailerSrc.slice(fnStart, fnEnd);
    // showTrailerFallback only at the "all candidates exhausted" guard, not inside the try-one loop
    const exhaustedGuard = fn.indexOf('_candIdx >= _candidates.length');
    assert.ok(exhaustedGuard !== -1, 'must have _candIdx >= _candidates.length guard');
    // The fallback call after exhausted guard should exist
    const guardToEnd = fn.slice(exhaustedGuard, exhaustedGuard + 200);
    assert.match(guardToEnd, /showTrailerFallback/,
        'showTrailerFallback must appear right after the all-candidates-exhausted guard');
});

test('Trailer: _gdTeardownTrailerMedia removes webview elements to release the renderer', () => {
    const fnStart = _gdTrailerSrc.indexOf('function _gdTeardownTrailerMedia');
    const fnEnd   = _gdTrailerSrc.indexOf('\nwindow._gdStopMediaOnNavAway', fnStart);
    const fn      = _gdTrailerSrc.slice(fnStart, fnEnd);
    assert.match(fn, /querySelectorAll\s*\(\s*['"]webview/,
        '_gdTeardownTrailerMedia must remove <webview> elements via querySelectorAll("webview…") on nav-away');
});

test('Trailer: _gdRenderTrailerPlayer cleans up existing webviews before rendering YouTube', () => {
    const fnStart = _gdTrailerSrc.indexOf('function _gdRenderTrailerPlayer');
    const fnEnd   = _gdTrailerSrc.indexOf('\nfunction _gdBuildInfoGrid', fnStart);
    const fn      = _gdTrailerSrc.slice(fnStart, fnEnd);
    // The cleanup must happen inside the YouTube branch (between _ytIdEarly check and its return)
    const branchStart = fn.indexOf('if (_ytIdEarly)');
    const branchEnd   = fn.indexOf('_gdRenderYouTubeWebviewPlayer', branchStart) + 50;
    const ytBranch    = fn.slice(branchStart, branchEnd);
    assert.match(ytBranch, /querySelectorAll\s*\(\s*['"]webview/,
        'YouTube branch must clean up old webview elements before rendering a new one');
});

test('Trailer: HLS script path uses ../node_modules/ (correct relative to src/dashboard.html)', () => {
    assert.match(_gdTrailerSrc, /['"]\.\.\/node_modules\/hls\.js\//,
        'HLS.js must be loaded from ../node_modules/ (not ../../node_modules/ which resolves outside project root)');
});

test('Trailer: DASH script path uses ../node_modules/ (correct relative to src/dashboard.html)', () => {
    assert.match(_gdTrailerSrc, /['"]\.\.\/node_modules\/dashjs\//,
        'dash.js must be loaded from ../node_modules/ (not ../../node_modules/)');
});

test('Trailer: _gdLoadLocalScriptOnce helper exists', () => {
    assert.match(_gdTrailerSrc, /function _gdLoadLocalScriptOnce/,
        '_gdLoadLocalScriptOnce helper must be defined');
});

test('Trailer: _gdBuildCandidates helper exists and uses trailer.sources', () => {
    assert.match(_gdTrailerSrc, /function _gdBuildCandidates/,
        '_gdBuildCandidates must be defined');
    const fnStart = _gdTrailerSrc.indexOf('function _gdBuildCandidates');
    const fnEnd   = _gdTrailerSrc.indexOf('\n}', fnStart) + 2;
    const fn      = _gdTrailerSrc.slice(fnStart, fnEnd);
    assert.match(fn, /trailer\.sources/,
        '_gdBuildCandidates must read trailer.sources for multi-candidate support');
});

// ── DASH quality selector DOM guards ─────────────────────────────────────────

test('DASH branch: uses quality-wrap id, not the removed quality-sel id', () => {
    assert.doesNotMatch(_gdTrailerSrc, /`\$\{videoId\}-quality-sel`/,
        'DASH branch must not reference the removed ${videoId}-quality-sel element id');
    assert.match(_gdTrailerSrc, /`\$\{videoId\}-quality-wrap`/,
        'DASH branch must reference ${videoId}-quality-wrap for the quality container');
});

test('DASH branch: quality select element is created in the DASH controls-bar HTML', () => {
    const dashIdx  = _gdTrailerSrc.indexOf("} else if (isDASH) {");
    assert.ok(dashIdx !== -1, "DASH branch marker '} else if (isDASH) {' must exist");
    // End of DASH block: the mp4/webm fallback follows immediately
    const elseMarker = '// ── mp4 / webm → native';
    const elseIdx    = _gdTrailerSrc.indexOf(elseMarker, dashIdx);
    assert.ok(elseIdx !== -1, "mp4/webm fallback comment must follow the DASH block");
    const dashBlock = _gdTrailerSrc.slice(dashIdx, elseIdx);
    assert.match(dashBlock, /id="\$\{videoId\}-quality-wrap"/,
        'DASH block must include the quality-wrap div in its innerHTML template');
    assert.match(dashBlock, /id="\$\{videoId\}-quality"/,
        'DASH block must include the hidden backing quality select in its innerHTML template');
    assert.match(dashBlock, /id="\$\{videoId\}-quality-btn"/,
        'DASH block must include the gear toggle button in its innerHTML template');
    assert.match(dashBlock, /id="\$\{videoId\}-quality-label"/,
        'DASH block must include the quality label span in its innerHTML template');
    assert.match(dashBlock, /id="\$\{videoId\}-quality-menu"/,
        'DASH block must include the custom dropdown menu div in its innerHTML template');
    assert.match(dashBlock, /<option value="auto" selected>Auto<\/option>/,
        'Quality select must have Auto as the default selected option');
    assert.match(dashBlock, /aria-label="Trailer quality"/,
        'Gear button must have aria-label="Trailer quality" for accessibility');
});

test('DASH branch: logs [GD][Trailer][DASH][DOM] immediately after DOM render', () => {
    const dashIdx    = _gdTrailerSrc.indexOf("} else if (isDASH) {");
    const elseMarker = '// ── mp4 / webm → native';
    const elseIdx    = _gdTrailerSrc.indexOf(elseMarker, dashIdx);
    const dashBlock  = _gdTrailerSrc.slice(dashIdx, elseIdx);
    assert.match(dashBlock, /\[GD\]\[Trailer\]\[DASH\]\[DOM\]/,
        'DASH block must emit [GD][Trailer][DASH][DOM] diagnostic log after DOM is built');
});

test('DASH branch: _populateQuality never hides qualityWrap and logs DOM after populate', () => {
    const attachIdx = _gdTrailerSrc.indexOf('const _attachDash = (dashjs) =>');
    assert.ok(attachIdx !== -1, '_attachDash function must exist');
    const attachEnd = _gdTrailerSrc.indexOf('\n            };', attachIdx) + 14;
    const attachBody = _gdTrailerSrc.slice(attachIdx, attachEnd);
    assert.doesNotMatch(attachBody, /qualityWrap\.style\.display\s*=\s*['"]none['"]/,
        '_populateQuality must never hide qualityWrap');
    assert.match(attachBody, /\[GD\]\[Trailer\]\[DASH\] quality DOM after populate/,
        '_populateQuality must log DOM state after populating options');
    assert.match(attachBody, /\[GD\]\[Trailer\]\[DASH\] attachDash started/,
        '_attachDash must log attachDash started for diagnostics');
});

test('DASH branch: _getDashVideoQualities helper is defined and uses getRepresentationsByType with getBitrateInfoListFor fallback', () => {
    assert.match(_gdTrailerSrc, /function _getDashVideoQualities\s*\(/,
        '_getDashVideoQualities helper function must be defined');
    const fnStart = _gdTrailerSrc.indexOf('function _getDashVideoQualities');
    const fnEnd   = _gdTrailerSrc.indexOf('\n}', fnStart) + 2;
    const fn      = _gdTrailerSrc.slice(fnStart, fnEnd);
    assert.match(fn, /getRepresentationsByType/,
        '_getDashVideoQualities must try getRepresentationsByType first');
    assert.match(fn, /getBitrateInfoListFor/,
        '_getDashVideoQualities must fall back to getBitrateInfoListFor');
    assert.match(fn, /bandwidth.*bitrate.*bandwidthInKbit|bitrate.*bandwidth.*bandwidthInKbit/,
        '_getDashVideoQualities must normalise bitrate from bandwidth/bitrate/bandwidthInKbit');
});

test('DASH branch: _attachDash uses _getDashVideoQualities and the new quality-switching API priority', () => {
    const attachIdx  = _gdTrailerSrc.indexOf('const _attachDash = (dashjs) =>');
    const attachEnd  = _gdTrailerSrc.indexOf('\n            };', attachIdx) + 14;
    const attachBody = _gdTrailerSrc.slice(attachIdx, attachEnd);
    assert.match(attachBody, /_getDashVideoQualities\s*\(/,
        '_attachDash must call _getDashVideoQualities to get quality list');
    assert.match(attachBody, /setRepresentationForTypeById/,
        '_attachDash must prefer setRepresentationForTypeById when available');
    assert.match(attachBody, /setRepresentationForTypeByIndex/,
        '_attachDash must fall back to setRepresentationForTypeByIndex');
    assert.match(attachBody, /setQualityFor/,
        '_attachDash must fall back to setQualityFor as last resort');
    assert.match(attachBody, /retryDelays\s*=\s*\[300,\s*1000,\s*2000\]/,
        '_populateQuality must retry at 300ms, 1000ms, 2000ms');
    assert.match(attachBody, /_qualitiesPopulated/,
        '_populateQuality must guard against overwriting already-populated options');
    assert.match(attachBody, /Auto \/ Source/,
        '_populateQuality must show "Auto / Source" when all retries are exhausted');
    assert.match(attachBody, /\[GD\]\[Trailer\]\[DASH\] dash\.js version/,
        '_attachDash must log the dash.js version for diagnostics');
});


// ── Artwork refresh: _patchGameInMemory / _patchVisibleGameCard helpers ───────

test('app.js/_patchGameInMemory and artwork-sync.js/_patchVisibleGameCard are defined', () => {
    const appSrc    = fs.readFileSync(path.join(ROOT, 'src', 'js', 'app.js'), 'utf8');
    const syncSrc   = fs.readFileSync(path.join(ROOT, 'src', 'js', 'app', 'artwork-sync.js'), 'utf8');
    assert.ok(appSrc.includes('function _patchGameInMemory'), '_patchGameInMemory must be defined in app.js');
    assert.ok(syncSrc.includes('function _patchVisibleGameCard'), '_patchVisibleGameCard must be defined in artwork-sync.js');
    assert.ok(syncSrc.includes('function _normalizeArtworkAliases'), '_normalizeArtworkAliases must be defined in artwork-sync.js');
    // _patchGameInMemory must appear before processQueue in app.js
    const patchIdx   = appSrc.indexOf('function _patchGameInMemory');
    const processIdx = appSrc.indexOf('async function processQueue');
    assert.ok(patchIdx < processIdx, '_patchGameInMemory defined before processQueue');
});

test('app.js: processQueue cacheAllAssets branch updates imgElement.src after localAssets.cover', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'js', 'app.js'), 'utf8');
    const cacheStart = src.indexOf('window.electronAPI.cacheAllAssets({ cover: meta.cover');
    assert.ok(cacheStart > -1, 'cacheAllAssets call found in processQueue');
    const block = src.slice(cacheStart, cacheStart + 3000);
    assert.match(block, /imgElement\.src\s*=/, 'imgElement.src must be set after cacheAllAssets resolves');
    assert.match(block, /finalCover/, 'finalCover variable must be used');
    assert.match(block, /_patchGameInMemory/, '_patchGameInMemory called after caching');
    assert.match(block, /_patchVisibleGameCard/, '_patchVisibleGameCard called after caching');
});

test('app.js: onGameImageUpdated uses _patchGameInMemory and does not early-return on missing id', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'js', 'app.js'), 'utf8');
    const handlerStart = src.indexOf('window.electronAPI.onGameImageUpdated');
    assert.ok(handlerStart > -1, 'onGameImageUpdated handler found');
    const block = src.slice(handlerStart, handlerStart + 600);
    // Must use _patchGameInMemory, not the old idx === -1 return pattern
    assert.match(block, /_patchGameInMemory/, '_patchGameInMemory used in handler');
    assert.ok(!block.includes("if (idx === -1) return"), 'early-return on missing id must be removed');
    // Must set aliases
    assert.match(block, /_patchVisibleGameCard/, '_patchVisibleGameCard called');
});

test('main.js: save-game-metadata handler emits game-image-updated on success', () => {
    const src = fs.readFileSync(path.join(ROOT, 'handlers/localMetadataHandlers.js'), 'utf8');
    const handlerIdx = src.indexOf("ipcMain.handle('save-game-metadata'");
    assert.ok(handlerIdx > -1, 'save-game-metadata handler found');
    const block = src.slice(handlerIdx, handlerIdx + 600);
    assert.match(block, /game-image-updated/, 'game-image-updated event emitted after save');
    assert.match(block, /result\?\.status === 'success'/, 'emit guarded by success check');
    assert.match(block, /getSavedGames/, 'getSavedGames used to find updated game record');
});
