'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');

// ── Inline copies of pure RTIA logic (no Electron, no DOM) ───────────────────

function _suggKey(g) { return `${g._platform}:${g.id}`; }

function _preferLocalImage(urls) {
    if (!Array.isArray(urls)) return null;
    const local = urls.find(u => u && typeof u === 'string' && u.startsWith('file://'));
    if (local) return local;
    return urls.find(u => u && typeof u === 'string' && u.length > 4) || null;
}

function _suggArtCacheSetValue(cache, key, updates) {
    const existing = cache[key] || {};
    for (const [field, url] of Object.entries(updates)) {
        if (!url) continue;
        const cur = existing[field];
        if (cur && cur.startsWith('file://') && !url.startsWith('file://')) continue;
        existing[field] = url;
    }
    cache[key] = existing;
}

function _suggArtCacheDeleteFieldValue(cache, key, field) {
    const existing = cache[key];
    if (!existing || !(field in existing)) return;
    delete existing[field];
    if (!Object.keys(existing).length) delete cache[key];
}

function _suggArtCachePopulate(cache, g) {
    const key = _suggKey(g);
    const p = _preferLocalImage([g.image, g.defaultImage, g.coverUrl]);
    const h = _preferLocalImage([g.heroImage, g.defaultHero]);
    const l = _preferLocalImage([g.logo, g.defaultLogo]);
    const updates = {};
    if (p) updates.poster = p;
    if (h) updates.hero   = h;
    if (l) updates.logo   = l;
    if (Object.keys(updates).length) _suggArtCacheSetValue(cache, key, updates);
}

// Testable version of _rtia_warmOne — takes injected API and cache
async function rtia_warmOne(g, cache, api) {
    const key    = _suggKey(g);
    const cached = cache[key] || {};
    const staleFields = [];

    for (const field of ['poster', 'hero', 'logo']) {
        const url = cached[field];
        if (url && url.startsWith('file://')) {
            const alive = await api.probeLocalImage(url).catch(() => false);
            if (!alive) {
                delete cached[field];
                staleFields.push(field);
            }
        }
    }
    for (const field of staleFields) _suggArtCacheDeleteFieldValue(cache, key, field);

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
            const alive = await api.probeLocalImage(url).catch(() => false);
            if (!alive) {
                g[gameField] = null;
                _suggArtCacheDeleteFieldValue(cache, key, artField);
            }
        }
    }

    if (cached.poster && !g.image)     g.image     = cached.poster;
    if (cached.hero   && !g.heroImage) g.heroImage = cached.hero;
    if (cached.logo   && !g.logo)      g.logo      = cached.logo;

    const toFetch = [
        { gameField: 'image',     artField: 'poster', type: 'cover' },
        { gameField: 'heroImage', artField: 'hero',   type: 'hero'  },
        { gameField: 'logo',      artField: 'logo',   type: 'logo'  },
    ];
    for (const { gameField, artField, type } of toFetch) {
        if (g[gameField] || !api.getCachedImage) continue;
        const url = await api.getCachedImage(g.id, type).catch(() => null);
        if (url) {
            g[gameField] = url;
            _suggArtCacheSetValue(cache, key, { [artField]: url });
        }
    }

    _suggArtCachePopulate(cache, g);
}

async function rtia_warmBatch(games, cache, api, concurrency = 4) {
    const queue = [...games];
    await Promise.all(
        Array.from({ length: concurrency }, async () => {
            while (queue.length) {
                const g = queue.shift();
                if (g) await rtia_warmOne(g, cache, api).catch(() => {});
            }
        })
    );
}

function rtia_awaitHydration(games, timeoutMs) {
    return new Promise(resolve => {
        const deadline = Date.now() + timeoutMs;
        const check = () => {
            if (games.every(g => g._heroHydrated) || Date.now() >= deadline) { resolve(); return; }
            setTimeout(check, 20);
        };
        check();
    });
}

async function rtia_hydrateAll(games, cache, api, hydrateArt) {
    if (!games?.length) return;
    await rtia_warmBatch(games, cache, api);
    for (const g of games) {
        if (!g._heroHydrated && !g._heroHydrating) hydrateArt(g);
    }
    await rtia_awaitHydration(games, 500);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeGame(overrides = {}) {
    return {
        id: overrides.id || 'game1',
        title: 'Test Game',
        _platform: overrides._platform || 'steam',
        image: null,
        heroImage: null,
        logo: null,
        _heroHydrated: false,
        _heroHydrating: false,
        ...overrides,
    };
}

function makeApi({ probe = true, cached = null } = {}) {
    return {
        probeLocalImage: async () => probe,
        getCachedImage:  async () => cached,
    };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('warmOne: promotes valid file:// from cache into game object', async () => {
    const g     = makeGame();
    const cache = { 'steam:game1': { poster: 'file:///cache/cover_game1.webp' } };
    const api   = makeApi({ probe: true });
    await rtia_warmOne(g, cache, api);
    assert.equal(g.image, 'file:///cache/cover_game1.webp');
});

test('warmOne: deletes stale file:// URL that no longer exists on disk', async () => {
    const g     = makeGame();
    const cache = { 'steam:game1': { poster: 'file:///cache/cover_game1.webp' } };
    const api   = makeApi({ probe: false });
    await rtia_warmOne(g, cache, api);
    assert.equal(g.image, null);
    assert.equal(cache['steam:game1'].poster, undefined);
});

test('warmOne: invalidates stale file:// already stored on the game object and recovers from disk', async () => {
    const g     = makeGame({ image: 'file:///cache/gone_cover.webp' });
    const cache = { 'steam:game1': { poster: 'file:///cache/gone_cover.webp' } };
    const api = {
        probeLocalImage: async () => false,
        getCachedImage:  async (_id, type) => type === 'cover' ? 'file:///cache/fresh_cover.webp' : null,
    };

    await rtia_warmOne(g, cache, api);

    assert.equal(g.image, 'file:///cache/fresh_cover.webp');
    assert.equal(cache['steam:game1']?.poster, 'file:///cache/fresh_cover.webp');
});

test('warmOne: falls back to getCachedImage when cache and game object are empty', async () => {
    const g     = makeGame();
    const cache = {};
    const api   = makeApi({ probe: true, cached: 'file:///cache/cover_game1.webp' });
    await rtia_warmOne(g, cache, api);
    assert.equal(g.image, 'file:///cache/cover_game1.webp');
    assert.equal(cache['steam:game1']?.poster, 'file:///cache/cover_game1.webp');
});

test('warmOne: never replaces existing file:// with remote URL', async () => {
    const g     = makeGame({ image: 'file:///cache/cover_game1.webp' });
    const cache = { 'steam:game1': { poster: 'file:///cache/cover_game1.webp' } };
    // The "new" cached value is a remote URL — should be ignored
    const api = { probeLocalImage: async () => true, getCachedImage: async () => 'https://cdn/img.jpg' };
    await rtia_warmOne(g, cache, api);
    assert.equal(g.image, 'file:///cache/cover_game1.webp');
});

test('warmOne: Steam and Epic IDs do not collide in cache keys', async () => {
    const steamGame = makeGame({ id: '1234', _platform: 'steam' });
    const epicGame  = makeGame({ id: '1234', _platform: 'epic' });
    const cache = {};
    const steamApi = makeApi({ cached: 'file:///steam/cover_1234.webp' });
    const epicApi  = makeApi({ cached: 'file:///epic/cover_1234.webp' });
    await rtia_warmOne(steamGame, cache, steamApi);
    await rtia_warmOne(epicGame,  cache, epicApi);
    assert.equal(cache['steam:1234']?.poster, 'file:///steam/cover_1234.webp');
    assert.equal(cache['epic:1234']?.poster,  'file:///epic/cover_1234.webp');
    assert.notEqual(cache['steam:1234']?.poster, cache['epic:1234']?.poster);
});

test('warmBatch: hydrates all games with bounded concurrency', async () => {
    const games = Array.from({ length: 10 }, (_, i) => makeGame({ id: `g${i}` }));
    const cache = {};
    const api   = makeApi({ cached: 'file:///cache/img.webp' });
    await rtia_warmBatch(games, cache, api);
    for (const g of games) {
        assert.equal(g.image, 'file:///cache/img.webp', `game ${g.id} should have image`);
    }
});

test('warmBatch: a probe failure for one game does not break others', async () => {
    const games = [
        makeGame({ id: 'bad',  _platform: 'steam' }),
        makeGame({ id: 'good', _platform: 'steam' }),
    ];
    const cache = {
        'steam:bad':  { poster: 'file:///gone.webp' },
        'steam:good': { poster: 'file:///valid.webp' },
    };
    const api = {
        probeLocalImage: async (url) => !url.includes('gone'),
        getCachedImage:  async () => null,
    };
    await rtia_warmBatch(games, cache, api);
    assert.equal(games[0].image, null,              'bad game should have no image');
    assert.equal(games[1].image, 'file:///valid.webp', 'good game should retain image');
});

test('rtia_awaitHydration: resolves when all games are hydrated', async () => {
    const games = [makeGame(), makeGame({ id: 'g2' })];
    setTimeout(() => { games[0]._heroHydrated = true; games[1]._heroHydrated = true; }, 50);
    await rtia_awaitHydration(games, 500);
    assert.ok(games.every(g => g._heroHydrated));
});

test('rtia_awaitHydration: resolves on timeout even if some games never hydrate', async () => {
    const games = [makeGame()]; // _heroHydrated stays false
    const t0 = Date.now();
    await rtia_awaitHydration(games, 80);
    assert.ok(Date.now() - t0 >= 70, 'should wait approximately until timeout');
});

test('rtia_hydrateAll: calls hydrateArt only for non-hydrated games', async () => {
    const hydrated   = makeGame({ id: 'g1', _heroHydrated: true });
    const unhydrated = makeGame({ id: 'g2' });
    const games      = [hydrated, unhydrated];
    const cache      = {};
    const api        = makeApi({ cached: null });
    const called     = [];
    function fakeHydrate(g) { called.push(g.id); g._heroHydrated = true; }
    await rtia_hydrateAll(games, cache, api, fakeHydrate);
    assert.deepEqual(called, ['g2'], 'should only hydrate the unhydrated game');
});

test('rtia_hydrateAll: hydrates only the games passed in (visible pool), not a larger list', async () => {
    // Simulates: large synced library of 100 games, but only 15 are in visible pools.
    const fullLibrary   = Array.from({ length: 100 }, (_, i) => makeGame({ id: `g${i}` }));
    const visiblePool   = fullLibrary.slice(0, 15); // 5 recommended + 5 steam + 5 epic

    const cache = {};
    const api   = makeApi({ cached: 'file:///cache/img.webp' });
    let count   = 0;
    const hydrated = new Set();
    function fakeHydrate(g) { count++; hydrated.add(g.id); g._heroHydrated = true; }

    await rtia_hydrateAll(visiblePool, cache, api, fakeHydrate);

    assert.equal(count, 15, 'should hydrate exactly the 15 visible pool items');
    for (const g of fullLibrary.slice(15)) {
        assert.ok(!hydrated.has(g.id), `game ${g.id} is not in visible pool — must not be hydrated`);
    }
});

test('filter switch: all three filter pools are pre-hydrated at startup so switching is instant', async () => {
    // Simulates startup: recommendedItems (5) + steamItems (5) + epicItems (5) = 15 unique items.
    // After startup hydration, switching filter renders from already-hydrated games — no new downloads.
    const recommended = Array.from({ length: 5 }, (_, i) => makeGame({ id: `rec${i}`, _platform: 'steam' }));
    const steamPool   = Array.from({ length: 5 }, (_, i) => makeGame({ id: `st${i}`,  _platform: 'steam' }));
    const epicPool    = Array.from({ length: 5 }, (_, i) => makeGame({ id: `ep${i}`,  _platform: 'epic'  }));

    // Inline _suggDedupe equivalent
    function dedupeByKey(games) {
        const seen = new Set();
        return games.filter(g => { const k = `${g._platform}:${g.id}`; if (seen.has(k)) return false; seen.add(k); return true; });
    }
    const visiblePool = dedupeByKey([...recommended, ...steamPool, ...epicPool]);
    assert.equal(visiblePool.length, 15);

    const cache = {};
    const api   = makeApi({ cached: null });
    let callCount = 0;
    function fakeHydrate(g) { callCount++; g._heroHydrated = true; }

    // Startup hydration
    await rtia_hydrateAll(visiblePool, cache, api, fakeHydrate);
    assert.equal(callCount, 15, 'all 15 visible pool items hydrated at startup');

    // Filter switch: render "Steam" tab — all steamPool games already hydrated
    callCount = 0;
    await rtia_hydrateAll(steamPool, cache, api, fakeHydrate);
    assert.equal(callCount, 0, 'switching to Steam filter hydrates nothing (already done)');

    // Filter switch: render "Epic" tab — all epicPool games already hydrated
    callCount = 0;
    await rtia_hydrateAll(epicPool, cache, api, fakeHydrate);
    assert.equal(callCount, 0, 'switching to Epic filter hydrates nothing (already done)');
});

test('offline: getCachedImage returns null, game stays without image (no crash)', async () => {
    const g     = makeGame();
    const cache = {};
    const api   = { probeLocalImage: async () => false, getCachedImage: async () => null };
    await assert.doesNotReject(() => rtia_warmOne(g, cache, api));
    assert.equal(g.image, null);
    assert.equal(g.heroImage, null);
});

test('art cache: never overwrites file:// with remote URL on second populate', async () => {
    const cache = {};
    const g     = makeGame({ image: 'file:///local/cover.webp' });
    _suggArtCachePopulate(cache, g);
    // Now try to overwrite with a remote URL
    _suggArtCacheSetValue(cache, _suggKey(g), { poster: 'https://cdn/cover.jpg' });
    assert.equal(cache['steam:game1'].poster, 'file:///local/cover.webp');
});

test('art cache: remote URL accepted when no file:// is present', async () => {
    const cache = {};
    _suggArtCacheSetValue(cache, 'steam:game2', { poster: 'https://cdn/cover.jpg' });
    assert.equal(cache['steam:game2'].poster, 'https://cdn/cover.jpg');
});

// ── New tests: install roulette hero hydration ────────────────────────────────

// Inline pure versions of the fixed functions for unit-testing without DOM/Electron

function _isUsableImageUrl(url) {
    if (!url || typeof url !== 'string') return null;
    const s = url.replace(/\\/g, '/').trim();
    if (!s || ['null', 'undefined', 'none'].includes(s.toLowerCase())) return null;
    if (s.startsWith('http://') || s.startsWith('https://') || s.startsWith('file://') || s.includes('/')) return s;
    return null;
}

function _buildInstallCandidate(g, cache) {
    const cacheKey  = _suggKey(g);
    const cachedArt = cache[cacheKey] || {};
    const bestPoster = _preferLocalImage([g.image, g.defaultImage, g.coverUrl, cachedArt.poster]) || '';
    const bestHero   = _preferLocalImage([g.heroImage, g.defaultHero, cachedArt.hero]) || '';
    const bestLogo   = _preferLocalImage([g.logo, g.defaultLogo, cachedArt.logo]) || '';
    return {
        id:          g.id,
        name:        g.title || 'Unknown',
        image:       bestPoster,
        defaultImage:g.defaultImage || cachedArt.poster || '',
        heroImage:   bestHero,
        defaultHero: g.defaultHero  || cachedArt.hero   || '',
        logo:        bestLogo,
        defaultLogo: g.defaultLogo  || cachedArt.logo   || '',
        _platform:   g._platform,
        _raw:        g,
    };
}

function _rouletteHeroUrlPure(game, cache) {
    if (!game) return null;
    const raw = game._raw || game;
    const directHero = _isUsableImageUrl(
        game.heroImage || game.defaultHero || game.heroUrl || game.background || null
    );
    if (directHero) return directHero;
    const rawHero = _isUsableImageUrl(
        raw.heroImage || raw.defaultHero || raw.heroUrl || raw.background || null
    );
    if (rawHero) return rawHero;
    const cacheKey  = _suggKey(raw.id ? raw : game);
    const cachedArt = cache[cacheKey] || {};
    return _isUsableImageUrl(cachedArt.hero || null);
}

async function _prepareHeroForCandidate(c, cache, api, timeBudgetMs = 800) {
    if (_rouletteHeroUrlPure(c, cache)) return; // already resolved
    const raw = c._raw || c;
    const rawHero = _isUsableImageUrl(raw.heroImage || raw.defaultHero || null);
    if (rawHero) { c.heroImage = rawHero; return; }
    const cacheKey  = _suggKey(raw.id ? raw : c);
    const cachedArt = cache[cacheKey] || {};
    if (cachedArt.hero) { const h = _isUsableImageUrl(cachedArt.hero); if (h) { c.heroImage = h; return; } }
    if (api.getCachedImage) {
        const id = raw.id || c.id;
        const diskHero = await api.getCachedImage(id, 'hero').catch(() => null);
        if (diskHero) {
            c.heroImage = diskHero;
            _suggArtCacheSetValue(cache, cacheKey, { hero: diskHero });
        }
    }
}

// ── Test: install candidate merges cached hero into candidate ─────────────────
test('install-roulette: _buildInstallPool merges cached hero from _suggArtCache into candidate', () => {
    const rawGame = makeGame({ id: 'g1', _platform: 'steam', image: 'https://cdn/cover.jpg' });
    const cache   = { 'steam:g1': { hero: 'file:///cache/hero_g1.webp' } };
    const c       = _buildInstallCandidate(rawGame, cache);
    assert.equal(c.heroImage, 'file:///cache/hero_g1.webp', 'hero should be merged from cache');
    assert.equal(c.image, 'https://cdn/cover.jpg', 'poster should be preserved');
});

// ── Test: _rouletteHeroUrl resolves from raw ──────────────────────────────────
test('install-roulette: _rouletteHeroUrl resolves hero from _raw when candidate field is empty', () => {
    const rawGame = makeGame({ id: 'g2', _platform: 'epic', heroImage: 'https://cdn/hero_g2.jpg' });
    const cache   = {};
    const c       = { id: 'g2', heroImage: '', _raw: rawGame, _platform: 'epic' };
    const hero    = _rouletteHeroUrlPure(c, cache);
    assert.equal(hero, 'https://cdn/hero_g2.jpg', 'should resolve hero from _raw');
});

// ── Test: _rouletteHeroUrl resolves from _suggArtCache ───────────────────────
test('install-roulette: _rouletteHeroUrl resolves hero from _suggArtCache when game and _raw have none', () => {
    const rawGame = makeGame({ id: 'g3', _platform: 'steam' });
    const cache   = { 'steam:g3': { hero: 'file:///cache/hero_g3.webp' } };
    const c       = { id: 'g3', heroImage: '', _raw: rawGame, _platform: 'steam' };
    const hero    = _rouletteHeroUrlPure(c, cache);
    assert.equal(hero, 'file:///cache/hero_g3.webp', 'should resolve hero from _suggArtCache');
});

// ── Test: finalization can set hero from disk cache via getCachedImage ────────
test('install-roulette: prepareHero falls back to getCachedImage(id, hero) and stores in cache', async () => {
    const rawGame = makeGame({ id: 'g4', _platform: 'steam' });
    const cache   = {};
    const api     = makeApi({ cached: 'file:///cache/hero_g4.webp' });
    const c       = _buildInstallCandidate(rawGame, cache);
    await _prepareHeroForCandidate(c, cache, api);
    assert.equal(c.heroImage, 'file:///cache/hero_g4.webp', 'hero should be fetched from disk cache');
    assert.equal(cache['steam:g4']?.hero, 'file:///cache/hero_g4.webp', 'disk hero should be stored in art cache');
});

// ── Test: cache does not replace existing file:// art with remote URL ─────────
test('install-roulette: art cache never replaces existing file:// hero with remote URL', () => {
    const cache = { 'steam:g5': { hero: 'file:///cache/hero_g5.webp' } };
    _suggArtCacheSetValue(cache, 'steam:g5', { hero: 'https://cdn/hero_g5.jpg' });
    assert.equal(cache['steam:g5'].hero, 'file:///cache/hero_g5.webp', 'file:// hero should be preserved');
});

// ── Test: candidate with only poster still works (no crash, no broken hero) ───
test('install-roulette: candidate with only poster works gracefully without hero', async () => {
    const rawGame = makeGame({ id: 'g6', _platform: 'steam', image: 'https://cdn/cover.jpg' });
    const cache   = {};
    const api     = makeApi({ cached: null }); // no disk cache
    const c       = _buildInstallCandidate(rawGame, cache);
    await assert.doesNotReject(() => _prepareHeroForCandidate(c, cache, api));
    assert.equal(c.heroImage || null, null, 'hero should remain null when unavailable');
    assert.equal(c.image, 'https://cdn/cover.jpg', 'poster should still be present');
});

// ── Test: hero only on _raw is picked up ──────────────────────────────────────
test('install-roulette: _rouletteHeroUrl picks up hero that arrived on _raw after pool was built', () => {
    const rawGame = makeGame({ id: 'g7', _platform: 'epic' });
    const cache   = {};
    const c       = _buildInstallCandidate(rawGame, cache); // built before hero arrived
    // Hero arrives on _raw after pool was built (e.g. from _suggHydrateArt)
    rawGame.heroImage = 'file:///cache/hero_g7.webp';
    const hero = _rouletteHeroUrlPure(c, cache);
    assert.equal(hero, 'file:///cache/hero_g7.webp', 'should pick up hero from _raw even after pool was built');
});

// ── New tests: _gdResolveInstallArtwork / playRouletteResult artwork ──────────

// Inline pure version of the resolver (no DOM, no Electron)
function _gdIsUsableImageUrl(url) {
    if (!url || typeof url !== 'string') return null;
    const s = url.replace(/\\/g, '/').trim();
    if (!s || ['null', 'undefined', 'none'].includes(s.toLowerCase())) return null;
    if (s.startsWith('http://') || s.startsWith('https://') ||
        s.startsWith('file://') || s.includes('/')) return s;
    return null;
}

function _gdPickInstallPoster(game) {
    const raw = game._raw || game;
    const candidates = [
        game._roulettePosterUrl,
        game.image, game.defaultImage, game.coverUrl,
        game.capsuleImage, game.boxArt, game.grid,
        raw.image, raw.defaultImage, raw.coverUrl,
        raw.capsuleImage, raw.boxArt, raw.grid,
    ];
    for (const u of candidates) { const v = _gdIsUsableImageUrl(u); if (v) return v; }
    return null;
}

function _gdPickInstallHero(game) {
    const raw = game._raw || game;
    const candidates = [
        game._rouletteHeroUrl,
        game.heroImage, game.defaultHero, game.heroUrl, game.background,
        raw.heroImage, raw.defaultHero, raw.heroUrl, raw.background,
    ];
    for (const u of candidates) { const v = _gdIsUsableImageUrl(u); if (v) return v; }
    return null;
}

async function _gdResolveInstallArtwork(game, artCacheGet, getCachedImage) {
    let poster = _gdPickInstallPoster(game);
    let hero   = _gdPickInstallHero(game);
    if (poster && hero) return { poster, hero };

    try {
        const platform = game._platform || game.platform || (game._raw && game._raw._platform) || '';
        const id       = String(game.id || '');
        const cacheKey = platform && id ? `${platform}:${id}` : null;
        if (cacheKey && typeof artCacheGet === 'function') {
            const cached = artCacheGet(cacheKey);
            if (!poster && cached && cached.poster) poster = _gdIsUsableImageUrl(cached.poster);
            if (!hero   && cached && cached.hero)   hero   = _gdIsUsableImageUrl(cached.hero);
        }
    } catch (_) {}

    if (poster && hero) return { poster, hero };

    if (getCachedImage) {
        const id = String(game.id || '');
        if (id) {
            const timeout = new Promise(r => setTimeout(() => r(null), 400));
            if (!poster) {
                poster = _gdIsUsableImageUrl(
                    await Promise.race([getCachedImage(id, 'cover').catch(() => null), timeout])
                );
            }
            if (!hero) {
                hero = _gdIsUsableImageUrl(
                    await Promise.race([getCachedImage(id, 'hero').catch(() => null), timeout])
                );
            }
        }
    }

    return { poster: poster || null, hero: hero || poster || null };
}

// Helper: build a roulette-enriched game object the way playRouletteResult does
function makeRouletteGame(src) {
    const raw = src._raw || src;
    const baseGame = {
        id:   raw.id,
        name: raw.title || raw.name || 'Unknown',
        image:     raw.image     || raw.capsuleImage || '',
        heroImage: raw.heroImage || raw.image        || '',
        platform:  raw._platform || '',
        platforms: [raw._platform || ''],
        appName:   raw.appName   || '',
    };
    return {
        ...baseGame,
        image:        baseGame.image    || src.image    || src._roulettePosterUrl || '',
        defaultImage: src.defaultImage  || raw.defaultImage || '',
        coverUrl:     src.coverUrl      || raw.coverUrl     || '',
        capsuleImage: src.capsuleImage  || raw.capsuleImage || '',
        boxArt:       src.boxArt        || raw.boxArt       || '',
        grid:         src.grid          || raw.grid         || '',
        _roulettePosterUrl: src._roulettePosterUrl || '',
        heroImage:    baseGame.heroImage || src.heroImage || src._rouletteHeroUrl || '',
        defaultHero:  src.defaultHero   || raw.defaultHero || '',
        heroUrl:      src.heroUrl       || raw.heroUrl     || '',
        background:   src.background    || raw.background  || '',
        _rouletteHeroUrl: src._rouletteHeroUrl || '',
        _raw: raw,
        _platform: src._platform || raw._platform || '',
    };
}

const noCache   = () => null;
const noDisk    = async () => null;

// 1. resolves poster from defaultImage when image is empty
test('_gdResolveInstallArtwork: resolves poster from defaultImage when image is empty', async () => {
    const game = { id: 'g1', _platform: 'steam', image: '', defaultImage: 'https://cdn/cover.jpg' };
    const art = await _gdResolveInstallArtwork(game, noCache, noDisk);
    assert.equal(art.poster, 'https://cdn/cover.jpg');
});

// 2. resolves hero from defaultHero when heroImage is empty
test('_gdResolveInstallArtwork: resolves hero from defaultHero when heroImage is empty', async () => {
    const game = { id: 'g2', _platform: 'steam', image: 'https://cdn/cover.jpg', heroImage: '', defaultHero: 'https://cdn/hero.jpg' };
    const art = await _gdResolveInstallArtwork(game, noCache, noDisk);
    assert.equal(art.hero, 'https://cdn/hero.jpg');
});

// 3. resolves poster + hero from _raw
test('_gdResolveInstallArtwork: resolves poster and hero from _raw fields', async () => {
    const raw  = { id: 'g3', _platform: 'epic', image: 'https://cdn/cover.jpg', heroImage: 'https://cdn/hero.jpg' };
    const game = { id: 'g3', _platform: 'epic', image: '', heroImage: '', _raw: raw };
    const art  = await _gdResolveInstallArtwork(game, noCache, noDisk);
    assert.equal(art.poster, 'https://cdn/cover.jpg');
    assert.equal(art.hero,   'https://cdn/hero.jpg');
});

// 4. resolves poster/hero from _roulettePosterUrl / _rouletteHeroUrl
test('_gdResolveInstallArtwork: resolves poster and hero from roulette-resolved URL fields', async () => {
    const game = {
        id: 'g4', _platform: 'steam',
        image: '', heroImage: '',
        _roulettePosterUrl: 'file:///cache/cover_g4.webp',
        _rouletteHeroUrl:   'file:///cache/hero_g4.webp',
    };
    const art = await _gdResolveInstallArtwork(game, noCache, noDisk);
    assert.equal(art.poster, 'file:///cache/cover_g4.webp');
    assert.equal(art.hero,   'file:///cache/hero_g4.webp');
});

// 5. resolves from _suggArtCache when direct fields are empty
test('_gdResolveInstallArtwork: resolves poster and hero from _suggArtCache', async () => {
    const cache = { 'steam:g5': { poster: 'file:///cache/cover_g5.webp', hero: 'file:///cache/hero_g5.webp' } };
    const game  = { id: 'g5', _platform: 'steam', image: '', heroImage: '' };
    const art   = await _gdResolveInstallArtwork(game, (k) => cache[k] || null, noDisk);
    assert.equal(art.poster, 'file:///cache/cover_g5.webp');
    assert.equal(art.hero,   'file:///cache/hero_g5.webp');
});

// 6. resolves from disk cache via getCachedImage when nothing else works
test('_gdResolveInstallArtwork: falls back to getCachedImage for cover and hero', async () => {
    const game = { id: 'g6', _platform: 'steam', image: '', heroImage: '' };
    const fakeDisk = async (id, type) =>
        type === 'cover' ? 'file:///disk/cover_g6.webp' : 'file:///disk/hero_g6.webp';
    const art = await _gdResolveInstallArtwork(game, noCache, fakeDisk);
    assert.equal(art.poster, 'file:///disk/cover_g6.webp');
    assert.equal(art.hero,   'file:///disk/hero_g6.webp');
});

// 7. hero falls back to poster when hero is missing everywhere
test('_gdResolveInstallArtwork: uses poster as hero fallback when hero missing', async () => {
    const game = { id: 'g7', _platform: 'epic', image: 'https://cdn/cover.jpg', heroImage: '' };
    const art  = await _gdResolveInstallArtwork(game, noCache, noDisk);
    assert.equal(art.poster, 'https://cdn/cover.jpg');
    assert.equal(art.hero,   'https://cdn/cover.jpg', 'poster used as hero fallback');
});

// 8. returns null poster + null hero gracefully when nothing exists
test('_gdResolveInstallArtwork: returns null poster and null hero gracefully when no art exists', async () => {
    const game = { id: 'g8', _platform: 'epic', image: '', heroImage: '' };
    const art  = await _gdResolveInstallArtwork(game, noCache, noDisk);
    assert.equal(art.poster, null);
    assert.equal(art.hero,   null);
});

// 9. playRouletteResult does not drop resolved roulette artwork
test('playRouletteResult: does not drop _roulettePosterUrl / _rouletteHeroUrl before calling picker', () => {
    // Simulate rouletteResultGame as set by startRoulette's finalizeRoulette
    const rouletteResultGame = {
        id: 'g9', _platform: 'steam',
        name: 'Bulb Boy',
        image: '',          // direct field empty — art only on roulette-resolved fields
        heroImage: '',
        _roulettePosterUrl: 'file:///cache/cover_g9.webp',
        _rouletteHeroUrl:   'file:///cache/hero_g9.webp',
        _raw: { id: 'g9', _platform: 'steam', title: 'Bulb Boy', image: '', heroImage: '' },
    };

    // Inline the patched playRouletteResult merge logic
    const src = rouletteResultGame;
    const raw = src._raw || src;
    const baseGame = { id: raw.id, name: raw.title || 'Unknown', image: raw.image || '', heroImage: raw.heroImage || '', platform: raw._platform || '' };
    const gameObj = {
        ...baseGame,
        image:             baseGame.image    || src.image    || src._roulettePosterUrl || '',
        _roulettePosterUrl: src._roulettePosterUrl || '',
        heroImage:         baseGame.heroImage || src.heroImage || src._rouletteHeroUrl || '',
        _rouletteHeroUrl:  src._rouletteHeroUrl || '',
        _raw: raw,
    };

    // Verify the resolved fields survived into gameObj
    assert.equal(gameObj._roulettePosterUrl, 'file:///cache/cover_g9.webp', '_roulettePosterUrl preserved');
    assert.equal(gameObj._rouletteHeroUrl,   'file:///cache/hero_g9.webp',  '_rouletteHeroUrl preserved');
    // And that _gdPickInstallPoster/Hero can find them
    const poster = _gdPickInstallPoster(gameObj);
    const hero   = _gdPickInstallHero(gameObj);
    assert.equal(poster, 'file:///cache/cover_g9.webp', 'poster resolved from _roulettePosterUrl');
    assert.equal(hero,   'file:///cache/hero_g9.webp',  'hero resolved from _rouletteHeroUrl');
});

function safeImageCacheId(value) {
    return String(value ?? '').trim().replace(/[^a-zA-Z0-9_\-]/g, '_');
}

function addImageCacheIdVariants(out, value, platform) {
    const raw = String(value ?? '').trim();
    if (!raw || raw === 'null' || raw === 'undefined') return;
    const variants = new Set([raw, safeImageCacheId(raw)]);
    const cleanPlatform = String(platform || '').trim().toLowerCase();
    if (cleanPlatform) {
        variants.add(`${cleanPlatform}_${raw}`);
        variants.add(`${cleanPlatform}-${raw}`);
        variants.add(safeImageCacheId(`${cleanPlatform}_${raw}`));
        variants.add(safeImageCacheId(`${cleanPlatform}-${raw}`));
    }
    const prefixed = /^(steam|epic|ea|ubisoft|xbox|riot|discord|rockstar)[_-](.+)$/i.exec(raw);
    if (prefixed?.[2]) {
        variants.add(prefixed[2]);
        variants.add(safeImageCacheId(prefixed[2]));
    }
    for (const id of variants) {
        out.add(id);
        out.add(String(id).toLowerCase());
    }
}

function collectImageCacheIdsFromGame(game, out) {
    if (!game || typeof game !== 'object') return;
    const platform = game.platform || game.source || game._platform || game.store || game.client || game.launcher;
    for (const field of ['id', 'appId', 'appid', 'app_id', 'gameId', 'game_id', 'appName']) {
        addImageCacheIdVariants(out, game[field], platform);
    }
    if (game.allIds && typeof game.allIds === 'object') {
        for (const [p, id] of Object.entries(game.allIds)) addImageCacheIdVariants(out, id, p || platform);
    }
    if (game._raw && game._raw !== game) collectImageCacheIdsFromGame(game._raw, out);
}

function walkPlatformLibraryEntries(node, visit) {
    if (!node) return;
    if (Array.isArray(node)) {
        for (const item of node) walkPlatformLibraryEntries(item, visit);
        return;
    }
    if (typeof node !== 'object') return;
    if (node.id || node.appId || node.appid || node.app_id || node.allIds || node.appName) visit(node);
    for (const key of ['games', 'library', 'items', 'ownedGames', 'entries', 'data', 'merged', 'apps']) {
        if (node[key]) walkPlatformLibraryEntries(node[key], visit);
    }
}

function simulatePrune({ files, installedGames = [], mergedLibraries = [], now = 2_000_000, graceMs = 86_400_000 }) {
    const protectedIds = new Set();
    for (const game of installedGames) collectImageCacheIdsFromGame(game, protectedIds);
    for (const lib of mergedLibraries) {
        walkPlatformLibraryEntries(lib, (entry) => collectImageCacheIdsFromGame(entry, protectedIds));
    }
    const deleted = [];
    const kept = [];
    for (const file of files) {
        const m = /^(?:cover|hero|logo)_(.+?)\.(?:webp|jpg|png|gif)$/.exec(file.name);
        if (!m) continue;
        const id = m[1];
        if (protectedIds.has(id) || protectedIds.has(String(id).toLowerCase())) {
            kept.push(file.name);
            continue;
        }
        if (now - file.mtimeMs < graceMs) {
            kept.push(file.name);
            continue;
        }
        deleted.push(file.name);
    }
    return { deleted, kept, protectedIds };
}

test('ImageCachePrune: Ready to Install Steam and Epic merged-library assets survive prune', () => {
    const result = simulatePrune({
        files: [
            { name: 'cover_steam_730.webp', mtimeMs: 0 },
            { name: 'hero_epic_abc.webp',   mtimeMs: 0 },
            { name: 'logo_999.webp',        mtimeMs: 0 },
        ],
        mergedLibraries: [
            { games: [{ id: 'steam_730', platform: 'steam' }] },
            { library: [{ appId: 'abc', source: 'epic' }, { allIds: { steam: '999' }, platform: 'steam' }] },
        ],
    });

    assert.deepEqual(result.deleted, []);
    assert.ok(result.kept.includes('cover_steam_730.webp'));
    assert.ok(result.kept.includes('hero_epic_abc.webp'));
    assert.ok(result.kept.includes('logo_999.webp'));
});

test('ImageCachePrune: installed library assets still survive prune', () => {
    const result = simulatePrune({
        files: [{ name: 'cover_installed123.webp', mtimeMs: 0 }],
        installedGames: [{ id: 'installed123' }],
    });

    assert.deepEqual(result.deleted, []);
    assert.deepEqual(result.kept, ['cover_installed123.webp']);
});

test('ImageCachePrune: truly orphaned old image files are pruned', () => {
    const result = simulatePrune({
        files: [
            { name: 'cover_orphan.webp',      mtimeMs: -100_000_000 },
            { name: 'not_image_cache.txt',    mtimeMs: -100_000_000 },
        ],
        installedGames: [{ id: 'installed123' }],
        mergedLibraries: [{ games: [{ id: 'steam_730', platform: 'steam' }] }],
    });

    assert.deepEqual(result.deleted, ['cover_orphan.webp']);
});

test('ImageCachePrune: fresh orphaned cache entries are skipped by grace period', () => {
    const now = 2_000_000;
    const result = simulatePrune({
        now,
        graceMs: 60_000,
        files: [{ name: 'cover_new_art.webp', mtimeMs: now - 5_000 }],
    });

    assert.deepEqual(result.deleted, []);
    assert.deepEqual(result.kept, ['cover_new_art.webp']);
});
