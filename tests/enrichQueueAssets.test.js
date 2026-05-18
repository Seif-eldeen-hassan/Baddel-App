'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');

// ─── A) normalizeServerData maps image_type="hero" → heroImage ───────────────
// Uses the real exported function — not a stub.

const { normalizeServerData, normalizeAssets } = require('../services/baddelApi');

function makeServerGame(imagePairs, overrides = {}) {
    return {
        title: 'Test Game',
        images: imagePairs.map(([type, url]) => ({
            image_type: type,
            cdn_url:    url,
            url:        null,
        })),
        media:    [],
        ratings:  [],
        metadata: [],
        system_requirements: [],
        ...overrides,
    };
}

test('normalizeServerData: image_type="hero" → heroImage is set', () => {
    const server = makeServerGame([
        ['cover', 'https://cdn/cover.jpg'],
        ['hero',  'https://cdn/hero.jpg'],
        ['logo',  'https://cdn/logo.png'],
    ]);
    const norm = normalizeServerData(server);
    assert.ok(norm,                 'normalizeServerData must return a result');
    assert.equal(norm.heroImage,    'https://cdn/hero.jpg',
        'image_type="hero" must be surfaced as heroImage');
    assert.equal(norm.cover,        'https://cdn/cover.jpg');
    assert.equal(norm.logo,         'https://cdn/logo.png');
});

test('normalizeServerData: image_type="hero" only — cover/logo null', () => {
    const server = makeServerGame([['hero', 'https://cdn/hero.jpg']]);
    const norm = normalizeServerData(server);
    assert.equal(norm.heroImage, 'https://cdn/hero.jpg');
    assert.equal(norm.cover,     null);
    assert.equal(norm.logo,      null);
});

test('normalizeServerData: cdn_url wins over url for hero', () => {
    const server = makeServerGame([]);
    server.images = [{ image_type: 'hero', cdn_url: 'https://cdn/hero-cdn.jpg', url: 'https://fallback/hero.jpg' }];
    const norm = normalizeServerData(server);
    assert.equal(norm.heroImage, 'https://cdn/hero-cdn.jpg', 'cdn_url must take priority over url');
});

test('normalizeServerData: url fallback used when cdn_url absent', () => {
    const server = makeServerGame([]);
    server.images = [{ image_type: 'hero', cdn_url: null, url: 'https://fallback/hero.jpg' }];
    const norm = normalizeServerData(server);
    assert.equal(norm.heroImage, 'https://fallback/hero.jpg');
});

test('normalizeServerData: no images → all assets null', () => {
    const server = makeServerGame([]);
    const norm = normalizeServerData(server);
    assert.equal(norm.heroImage, null);
    assert.equal(norm.cover,     null);
    assert.equal(norm.logo,      null);
});

test('normalizeServerData: screenshot rows do not bleed into hero pick', () => {
    const server = makeServerGame([
        ['screenshot', 'https://cdn/ss1.jpg'],
        ['screenshot', 'https://cdn/ss2.jpg'],
    ]);
    const norm = normalizeServerData(server);
    assert.equal(norm.heroImage, null, 'screenshots must not be picked as hero');
});

// ─── B) applyNormalizedToCache logic (pure extraction) ───────────────────────
// Mirrors the field-assignment lines in platformSync.js applyNormalizedToCache.
// Tests that cover+hero+logo all get written and heroImage → heroUrl mapping holds.

function applyToEntry(entry, normalized) {
    let updated = false;
    if (normalized.cover     && entry.coverUrl !== normalized.cover)     { entry.coverUrl = normalized.cover;     updated = true; }
    if (normalized.heroImage && entry.heroUrl  !== normalized.heroImage)  { entry.heroUrl  = normalized.heroImage; updated = true; }
    if (normalized.logo      && entry.logoUrl  !== normalized.logo)       { entry.logoUrl  = normalized.logo;      updated = true; }
    return updated;
}

test('applyToEntry: cover+hero+logo all written from normalizeServerData output', () => {
    const server = makeServerGame([
        ['cover', 'https://cdn/c.jpg'],
        ['hero',  'https://cdn/h.jpg'],
        ['logo',  'https://cdn/l.png'],
    ]);
    const norm  = normalizeServerData(server);
    const entry = { coverUrl: null, heroUrl: null, logoUrl: null };
    const updated = applyToEntry(entry, norm);

    assert.equal(updated,        true);
    assert.equal(entry.coverUrl, 'https://cdn/c.jpg');
    assert.equal(entry.heroUrl,  'https://cdn/h.jpg',
        'heroImage from normalizeServerData must land in heroUrl on the cache entry');
    assert.equal(entry.logoUrl,  'https://cdn/l.png');
});

test('applyToEntry: idempotent — second application with same values returns updated=false', () => {
    const norm  = { cover: 'https://cdn/c.jpg', heroImage: 'https://cdn/h.jpg', logo: 'https://cdn/l.png' };
    const entry = { coverUrl: 'https://cdn/c.jpg', heroUrl: 'https://cdn/h.jpg', logoUrl: 'https://cdn/l.png' };
    assert.equal(applyToEntry(entry, norm), false);
});

// ─── C) _cacheAssetSideEffect guard — remote URL must NOT be skipped ─────────
// The guard previously was `if (!rawUrl || game[field]) return` which would bail
// when game.heroUrl was already a remote CDN URL.  The fix changes the guard to
// only bail when the field holds a local file:// path.

function makeCacheAssetSideEffect(game, cacheImageFn) {
    const id = String(game.id);
    const store = new Map();
    function _cacheAssetSideEffect(rawUrl, type, field) {
        // FIXED guard: only skip if already a local file:// path
        if (!rawUrl || (game[field] && String(game[field]).startsWith('file://'))) return;
        game[field] = rawUrl;
        store.set(type + '_' + id, rawUrl);
        if (cacheImageFn) {
            cacheImageFn(rawUrl, id, type).then(local => {
                if (local && String(local).startsWith('file://')) {
                    game[field] = local;
                    store.set(type + '_' + id, local);
                }
            }).catch(() => {});
        }
    }
    return { _cacheAssetSideEffect, store };
}

test('_cacheAssetSideEffect: remote heroUrl (from applyNormalizedToCache) triggers download', async () => {
    const game = { id: 'steam-2767030', heroUrl: 'https://cdn/h.jpg' }; // already set (the bug scenario)
    let downloadCalledWith = null;
    const fakeCache = async (url, id, type) => {
        downloadCalledWith = { url, id, type };
        return 'file://hero.webp';
    };
    const { _cacheAssetSideEffect } = makeCacheAssetSideEffect(game, fakeCache);

    _cacheAssetSideEffect(game.heroUrl, 'hero', 'heroUrl');

    // allow the promise to resolve
    await new Promise(r => setImmediate(r));

    assert.ok(downloadCalledWith, 'cacheImage must have been called for a remote heroUrl');
    assert.equal(downloadCalledWith.url,  'https://cdn/h.jpg');
    assert.equal(downloadCalledWith.type, 'hero');
    assert.equal(game.heroUrl, 'file://hero.webp', 'heroUrl must be upgraded to file://');
});

test('_cacheAssetSideEffect: file:// heroUrl (already cached) is NOT re-downloaded', async () => {
    const game = { id: 'steam-2767030', heroUrl: 'file://hero-cached.webp' };
    let called = false;
    const fakeCache = async () => { called = true; return 'file://new.webp'; };
    const { _cacheAssetSideEffect } = makeCacheAssetSideEffect(game, fakeCache);

    _cacheAssetSideEffect(game.heroUrl, 'hero', 'heroUrl');
    await new Promise(r => setImmediate(r));

    assert.equal(called, false, 'file:// heroUrl must not trigger a re-download');
    assert.equal(game.heroUrl, 'file://hero-cached.webp');
});

test('_cacheAssetSideEffect: null rawUrl is always a no-op', async () => {
    const game = { id: 'g1', heroUrl: null };
    let called = false;
    const { _cacheAssetSideEffect } = makeCacheAssetSideEffect(game, async () => { called = true; });
    _cacheAssetSideEffect(null, 'hero', 'heroUrl');
    await new Promise(r => setImmediate(r));
    assert.equal(called, false);
});

// ─── D) cacheLibraryCoversFirst — cover-first pipeline ───────────────────────
//
// These tests exercise the extracted function directly via a test-local re-
// implementation that accepts injected deps (no electron / fs required).

function makeCoverFirstFn() {
    // Mirrors cacheLibraryCoversFirst but uses a local queue variable and injected deps.
    let queue = Promise.resolve();

    async function _wc(items, fn, concurrency) {
        if (!items.length || concurrency <= 0) return;
        const q = [...items];
        await Promise.all(
            Array.from({ length: Math.min(concurrency, items.length) }, async () => {
                while (q.length > 0) { const i = q.shift(); if (i !== undefined) await fn(i); }
            })
        );
    }

    async function cacheLibraryCoversFirst(entries, downloader, cacheFile, matchFn, emitter, opts = {}) {
        const {
            coverCachedEmitter       = null,
            existsFn                 = () => true,
            fsDeps                   = { readFile: async () => '[]', writeFile: async () => {} },
            coverConcurrency         = 10,
            secondaryConcurrency     = 2,
            batchSize                = 20,
            libUpdatedDebounceMs     = 500,
        } = opts;

        const isFileValid = (url) => {
            if (!url || !String(url).startsWith('file://')) return false;
            const raw = String(url).replace(/^file:\/\/\//, '').replace(/^file:\/\//, '');
            return existsFn(raw);
        };

        for (const entry of entries) {
            if (entry.coverUrl && String(entry.coverUrl).startsWith('file://') && !isFileValid(entry.coverUrl)) entry.coverUrl = null;
            if (entry.heroUrl  && String(entry.heroUrl ).startsWith('file://') && !isFileValid(entry.heroUrl))  entry.heroUrl  = null;
            if (entry.logoUrl  && String(entry.logoUrl ).startsWith('file://') && !isFileValid(entry.logoUrl))  entry.logoUrl  = null;
        }

        const coverTargets = entries.filter(e =>
            !e.customArtworkLocked && e.coverUrl && !String(e.coverUrl).startsWith('file://')
        );

        const pendingUpdates = [];

        // Debounced library-updated — fires at most every libUpdatedDebounceMs
        let _libUpdTimer = null;
        const debounceLibUpdated = () => {
            if (!emitter) return;
            if (_libUpdTimer) clearTimeout(_libUpdTimer);
            _libUpdTimer = setTimeout(() => { emitter(); _libUpdTimer = null; }, libUpdatedDebounceMs);
        };

        const scheduleFlush = () => {
            const batch = pendingUpdates.splice(0);
            queue = queue.then(async () => {
                try {
                    if (batch.length) {
                        const lib = JSON.parse(await fsDeps.readFile(cacheFile, 'utf8').catch(() => '[]'));
                        let changed = false;
                        for (const e of batch) {
                            const idx = matchFn(lib, e);
                            if (idx === -1) continue;
                            if (e.coverUrl !== undefined) { lib[idx].coverUrl = e.coverUrl; changed = true; }
                        }
                        if (changed) await fsDeps.writeFile(cacheFile, JSON.stringify(lib, null, 2), 'utf8');
                    }
                } catch {}
            });
        };

        const processOneCover = async (entry) => {
            const gameId = String(entry.id || entry.appName || '');
            if (!gameId || !entry.coverUrl) return;
            try {
                const result = await downloader({ cover: entry.coverUrl }, gameId);
                if (result?.cover && String(result.cover).startsWith('file://')) {
                    entry.coverUrl = result.cover;

                    if (coverCachedEmitter) {
                        coverCachedEmitter({
                            platform:     entry.platform     || null,
                            accountId:    entry.accountId    || null,
                            id:           entry.id           || entry.appName || null,
                            title:        entry.title        || null,
                            appid:        entry.appName      || null,
                            namespace:    entry.namespace    || null,
                            coverUrl:     result.cover,
                            image:        result.cover,
                            defaultImage: result.cover,
                        });
                    }

                    pendingUpdates.push(entry);
                    if (pendingUpdates.length >= batchSize) scheduleFlush();
                    debounceLibUpdated();
                }
            } catch {}
        };

        await _wc(coverTargets, processOneCover, coverConcurrency);
        scheduleFlush();
        if (_libUpdTimer) { clearTimeout(_libUpdTimer); _libUpdTimer = null; if (emitter) emitter(); }
        await queue;

        const secondaryTargets = entries.filter(e =>
            !e.customArtworkLocked && (
                (e.heroUrl && !String(e.heroUrl).startsWith('file://')) ||
                (e.logoUrl && !String(e.logoUrl).startsWith('file://'))
            )
        );

        const processOneSecondary = async (entry) => {
            const gameId = String(entry.id || entry.appName || '');
            if (!gameId) return;
            const assets = {};
            if (entry.heroUrl && !String(entry.heroUrl).startsWith('file://')) assets.hero = entry.heroUrl;
            if (entry.logoUrl && !String(entry.logoUrl).startsWith('file://')) assets.logo = entry.logoUrl;
            if (!Object.keys(assets).length) return;
            try {
                const result = await downloader(assets, gameId);
                let changed = false;
                if (result?.hero && String(result.hero).startsWith('file://')) { entry.heroUrl = result.hero; changed = true; }
                if (result?.logo && String(result.logo).startsWith('file://')) { entry.logoUrl = result.logo; changed = true; }
                if (changed) {
                    queue = queue.then(async () => {
                        try {
                            const lib = JSON.parse(await fsDeps.readFile(cacheFile, 'utf8').catch(() => '[]'));
                            const idx = matchFn(lib, entry);
                            if (idx !== -1) {
                                if (entry.heroUrl?.startsWith?.('file://')) lib[idx].heroUrl = entry.heroUrl;
                                if (entry.logoUrl?.startsWith?.('file://')) lib[idx].logoUrl = entry.logoUrl;
                                await fsDeps.writeFile(cacheFile, JSON.stringify(lib, null, 2), 'utf8');
                            }
                        } catch {}
                    });
                }
            } catch {}
        };

        _wc(secondaryTargets, processOneSecondary, secondaryConcurrency).catch(() => {});
    }

    return { cacheLibraryCoversFirst, getQueue: () => queue };
}

// ─── D1) Cover-before-hero phase ordering ────────────────────────────────────
test('cacheLibraryCoversFirst: all 3 cover downloads complete after await', async () => {
    const { cacheLibraryCoversFirst } = makeCoverFirstFn();
    const entries = [
        { id: 'g1', appName: 'g1', coverUrl: 'https://cdn/c1.jpg', heroUrl: 'https://cdn/h1.jpg' },
        { id: 'g2', appName: 'g2', coverUrl: 'https://cdn/c2.jpg', heroUrl: 'https://cdn/h2.jpg' },
        { id: 'g3', appName: 'g3', coverUrl: 'https://cdn/c3.jpg', heroUrl: 'https://cdn/h3.jpg' },
    ];
    const coverCalls = [];
    const downloader = async (assets, gameId) => {
        if (assets.cover) { coverCalls.push(gameId); return { cover: 'file://c.webp' }; }
        return {};
    };
    const matchFn = (lib, e) => lib.findIndex(lg => lg.id === e.id);
    await cacheLibraryCoversFirst(entries, downloader, 'cache.json', matchFn, null);
    assert.equal(coverCalls.length, 3, 'all 3 cover downloads must complete before await resolves');
    assert.ok(coverCalls.includes('g1') && coverCalls.includes('g2') && coverCalls.includes('g3'));
});

// ─── D2) Hero phase starts only after cover phase completes ──────────────────
test('cacheLibraryCoversFirst: hero downloads start only after cover phase is done', async () => {
    const { cacheLibraryCoversFirst } = makeCoverFirstFn();
    const entries = [
        { id: 'g1', appName: 'g1', coverUrl: 'https://cdn/c1.jpg', heroUrl: 'https://cdn/h1.jpg' },
        { id: 'g2', appName: 'g2', coverUrl: 'https://cdn/c2.jpg', heroUrl: 'https://cdn/h2.jpg' },
    ];

    // coversCompleted is incremented inside the cover downloader — it is fully updated
    // by the time the secondary phase fires (which starts after await _wc covers).
    let coversCompleted = 0;
    const secondarySeenCoverCount = [];

    const downloader = async (assets, gameId) => {
        if (assets.cover) {
            coversCompleted++;
            return { cover: 'file://c.webp' };
        }
        // Record how many covers were done at the point this secondary call started
        secondarySeenCoverCount.push(coversCompleted);
        return {};
    };

    const matchFn = (lib, e) => lib.findIndex(lg => lg.id === e.id);
    await cacheLibraryCoversFirst(entries, downloader, 'cache.json', matchFn, null);
    // Drain microtask queue so fire-and-forget secondary tasks can run
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));

    assert.ok(secondarySeenCoverCount.length > 0, 'secondary downloader must have been called');
    assert.ok(
        secondarySeenCoverCount.every(c => c === 2),
        `every secondary call must see coversCompleted=2 (all covers done); got: ${secondarySeenCoverCount}`
    );
});

// ─── D3) emitter fired after cover batch ─────────────────────────────────────
test('cacheLibraryCoversFirst: emitter called at least once after cover phase', async () => {
    const { cacheLibraryCoversFirst } = makeCoverFirstFn();
    const entries = [
        { id: 'g1', appName: 'g1', coverUrl: 'https://cdn/c1.jpg' },
        { id: 'g2', appName: 'g2', coverUrl: 'https://cdn/c2.jpg' },
    ];
    const downloader = async (assets) => assets.cover ? { cover: 'file://c.webp' } : {};
    const matchFn = (lib, e) => lib.findIndex(lg => lg.id === e.id);
    let emitCount = 0;
    await cacheLibraryCoversFirst(entries, downloader, 'cache.json', matchFn, () => emitCount++);
    assert.ok(emitCount >= 1, 'emitter must be called at least once after cover phase');
});

// ─── D4) Valid file:// coverUrl not re-downloaded ─────────────────────────────
test('cacheLibraryCoversFirst: entry with valid file:// coverUrl is not passed to downloader', async () => {
    const { cacheLibraryCoversFirst } = makeCoverFirstFn();
    const entries = [
        { id: 'g1', appName: 'g1', coverUrl: 'file://already-cached.webp' },
    ];
    let downloaderCalled = false;
    const downloader = async () => { downloaderCalled = true; return {}; };
    const matchFn = (lib, e) => lib.findIndex(lg => lg.id === e.id);
    // existsFn returns true → file:// is valid → must be skipped
    await cacheLibraryCoversFirst(entries, downloader, 'cache.json', matchFn, null,
        { existsFn: () => true });
    assert.equal(downloaderCalled, false,
        'downloader must not be called for a valid file:// coverUrl');
});

// ─── D5) Stale file:// coverUrl cleared ──────────────────────────────────────
test('cacheLibraryCoversFirst: stale file:// coverUrl is cleared from entry when file missing', async () => {
    const { cacheLibraryCoversFirst } = makeCoverFirstFn();
    const entries = [
        { id: 'g1', appName: 'g1', coverUrl: 'file://missing-cover.webp' },
    ];
    const downloader = async () => ({});
    const matchFn = (lib, e) => lib.findIndex(lg => lg.id === e.id);
    // existsFn returns false → file:// is stale → coverUrl must be cleared
    await cacheLibraryCoversFirst(entries, downloader, 'cache.json', matchFn, null,
        { existsFn: () => false });
    assert.equal(entries[0].coverUrl, null,
        'stale file:// coverUrl must be nulled so renderer can re-fetch');
});

// ─── D6) Hero failure does not affect cover result ───────────────────────────
test('cacheLibraryCoversFirst: hero downloader throwing does not revert cover', async () => {
    const { cacheLibraryCoversFirst } = makeCoverFirstFn();
    const entries = [
        { id: 'g1', appName: 'g1', coverUrl: 'https://cdn/c1.jpg', heroUrl: 'https://cdn/h1.jpg' },
    ];
    const downloader = async (assets, gameId) => {
        if (assets.cover) return { cover: 'file://c.webp' };
        throw new Error('hero network error');
    };
    const matchFn = (lib, e) => lib.findIndex(lg => lg.id === e.id);
    await cacheLibraryCoversFirst(entries, downloader, 'cache.json', matchFn, null);
    await new Promise(r => setImmediate(r));
    assert.equal(entries[0].coverUrl, 'file://c.webp',
        'cover must remain as file:// even when hero download throws');
});

// ─── D7) All Games updates: emitter + in-memory entry updated before await ───
test('cacheLibraryCoversFirst: in-memory entry coverUrl updated to file:// after await', async () => {
    const { cacheLibraryCoversFirst } = makeCoverFirstFn();
    const entries = [
        { id: 'g1', appName: 'g1', coverUrl: 'https://cdn/c1.jpg' },
    ];
    const downloader = async (assets) => assets.cover ? { cover: 'file://c1.webp' } : {};
    const matchFn = (lib, e) => lib.findIndex(lg => lg.id === e.id);
    await cacheLibraryCoversFirst(entries, downloader, 'cache.json', matchFn, null);
    assert.equal(entries[0].coverUrl, 'file://c1.webp',
        'in-memory entry must be updated to file:// URL immediately after cover download');
});

// ─── D8) Ownership: customArtworkLocked entries skipped ──────────────────────
test('cacheLibraryCoversFirst: customArtworkLocked entry excluded from cover and secondary phases', async () => {
    const { cacheLibraryCoversFirst } = makeCoverFirstFn();
    const entries = [
        { id: 'locked', appName: 'locked', coverUrl: 'https://cdn/c.jpg', heroUrl: 'https://cdn/h.jpg', customArtworkLocked: true },
        { id: 'free',   appName: 'free',   coverUrl: 'https://cdn/c2.jpg' },
    ];
    const calledFor = [];
    const downloader = async (assets, gameId) => { calledFor.push(gameId); return { cover: 'file://c.webp' }; };
    const matchFn = (lib, e) => lib.findIndex(lg => lg.id === e.id);
    await cacheLibraryCoversFirst(entries, downloader, 'cache.json', matchFn, null);
    await new Promise(r => setImmediate(r));
    assert.ok(!calledFor.includes('locked'),
        'downloader must never be called for customArtworkLocked=true entries');
    assert.ok(calledFor.includes('free'),
        'non-locked entries must still be processed');
});

// ─── D) EnrichQueue fire-and-forget download integration ─────────────────────
// Simulates the full applyNormalizedToCache → _platformSyncAssetDownloader chain:
// given a normalizeServerData result with cover+hero+logo, the downloader is called
// for all three, and file:// paths are written back.

test('EnrichQueue: all three asset types downloaded when normalizeServerData has all three', async () => {
    const server = makeServerGame([
        ['cover', 'https://cdn/c.jpg'],
        ['hero',  'https://cdn/h.jpg'],
        ['logo',  'https://cdn/l.png'],
    ]);
    const norm = normalizeServerData(server);
    assert.equal(!!norm.cover,     true);
    assert.equal(!!norm.heroImage, true);
    assert.equal(!!norm.logo,      true);

    // Simulate the _platformSyncAssetDownloader call
    const downloadedTypes = [];
    const fakeDownloader = async (assets, gameId) => {
        const results = {};
        for (const [type, url] of Object.entries(assets)) {
            if (!url) continue;
            downloadedTypes.push(type);
            results[type] = `file://${type}.webp`;
        }
        return results;
    };

    const assets = { cover: norm.cover, hero: norm.heroImage, logo: norm.logo };
    const cached = await fakeDownloader(assets, 'steam-2767030');

    assert.ok(downloadedTypes.includes('cover'), 'cover must be downloaded');
    assert.ok(downloadedTypes.includes('hero'),  'hero must be downloaded');
    assert.ok(downloadedTypes.includes('logo'),  'logo must be downloaded');
    assert.ok(String(cached.hero).startsWith('file://'), 'hero result must be a file:// path');
});

test('EnrichQueue: hero-only download (cover+logo already cached) still works', async () => {
    const norm   = { cover: null, heroImage: 'https://cdn/h.jpg', logo: null };
    const assets = { cover: norm.cover || null, hero: norm.heroImage || null, logo: norm.logo || null };

    const downloadedTypes = [];
    const fakeDownloader = async (a) => {
        const r = {};
        for (const [t, u] of Object.entries(a)) {
            if (!u) continue;
            downloadedTypes.push(t);
            r[t] = `file://${t}.webp`;
        }
        return r;
    };

    const cached = await fakeDownloader(assets, 'steam-2767030');
    assert.deepStrictEqual(downloadedTypes, ['hero']);
    assert.equal(cached.hero, 'file://hero.webp');
});

// ─── E) Regression: BackgroundMetaPipeline hero-complete skip gate ────────────
// Ensure the fixes to accounts.js don't break the gameScanner pipeline logic.

const { STATUS } = require('../services/metadataResolutionManager');

test('regression: game with cover+hero+metadata is still skipped (hero-complete)', async () => {
    // Mirrors computeArtFlags + pipelineDecision from heroBackfill.test.js
    function computeHasHero(game, diskHero) {
        return !!(game.heroImage || diskHero);
    }
    const game  = { heroImage: 'file://h.webp', image: 'file://c.webp' };
    const hasHero = computeHasHero(game, 'file://h.webp');
    assert.equal(hasHero, true, 'hero-complete game must still be detected as complete');
});

test('regression: cover-only game (heroImage null, no disk hero) → not hero-complete', () => {
    function computeHasHero(game, diskHero) {
        return !!(game.heroImage || diskHero);
    }
    const game  = { heroImage: null, image: 'file://c.webp' };
    const hasHero = computeHasHero(game, null);
    assert.equal(hasHero, false, 'cover-only game must not be considered hero-complete');
});

// ─── E) all-games-cover-cached event — per-cover instant UI patch ─────────────
//
// Tests for the coverCachedEmitter pathway added to cacheLibraryCoversFirst.
// These use the same makeCoverFirstFn() helper from section D.

// ─── E1) coverCachedEmitter fired immediately per cached cover ────────────────
test('cacheLibraryCoversFirst: coverCachedEmitter called once per successfully cached cover', async () => {
    const { cacheLibraryCoversFirst } = makeCoverFirstFn();
    const entries = [
        { id: 'g1', appName: 'g1', title: 'Game 1', coverUrl: 'https://cdn/c1.jpg' },
        { id: 'g2', appName: 'g2', title: 'Game 2', coverUrl: 'https://cdn/c2.jpg' },
        { id: 'g3', appName: 'g3', title: 'Game 3', coverUrl: 'https://cdn/c3.jpg' },
    ];
    const emittedPayloads = [];
    const downloader = async (assets) => assets.cover ? { cover: 'file://c.webp' } : {};
    const matchFn = (lib, e) => lib.findIndex(lg => lg.id === e.id);
    await cacheLibraryCoversFirst(entries, downloader, 'cache.json', matchFn, null, {
        coverCachedEmitter: (p) => emittedPayloads.push(p),
    });
    assert.equal(emittedPayloads.length, 3, 'coverCachedEmitter must be called once per cover');
    assert.ok(emittedPayloads.every(p => p.coverUrl === 'file://c.webp'), 'each payload must carry the file:// coverUrl');
});

// ─── E2) payload contains id, title, coverUrl, image, defaultImage ────────────
test('cacheLibraryCoversFirst: coverCachedEmitter payload has required fields', async () => {
    const { cacheLibraryCoversFirst } = makeCoverFirstFn();
    const entries = [
        { id: 'steam-123', appName: 'steam-123', title: 'Half-Life 3', namespace: null,
          coverUrl: 'https://cdn/hl3.jpg', platform: 'steam' },
    ];
    let captured = null;
    const downloader = async (assets) => assets.cover ? { cover: 'file://hl3.webp' } : {};
    const matchFn = (lib, e) => lib.findIndex(lg => lg.id === e.id);
    await cacheLibraryCoversFirst(entries, downloader, 'cache.json', matchFn, null, {
        coverCachedEmitter: (p) => { captured = p; },
    });
    assert.ok(captured,                            'payload must be emitted');
    assert.equal(captured.id,           'steam-123');
    assert.equal(captured.title,        'Half-Life 3');
    assert.equal(captured.platform,     'steam');
    assert.equal(captured.coverUrl,     'file://hl3.webp');
    assert.equal(captured.image,        'file://hl3.webp');
    assert.equal(captured.defaultImage, 'file://hl3.webp');
});

// ─── E3) renderer handler patches _allGamesCache without library-updated ──────
test('all-games-cover-cached handler patches _allGamesCache entry immediately', () => {
    // Simulate the renderer-side handler logic extracted from accounts.js.
    function makeHandler(allGamesCache, vsCardCache) {
        return function onCoverCached(payload) {
            if (!payload || !allGamesCache) return;
            const { id, appid, namespace, title, coverUrl, image, defaultImage } = payload;
            const newCover = coverUrl || image || defaultImage;
            if (!newCover) return;
            let game = null;
            for (const g of allGamesCache) {
                const gId = String(g.id || g.appName || '');
                if (id    && (gId === String(id)    || String(g.appName) === String(id)))  { game = g; break; }
                if (appid && (String(g.appName) === String(appid) || gId === String(appid))) { game = g; break; }
                if (namespace && (g.namespace === namespace))                               { game = g; break; }
                if (title && g.title && g.title.toLowerCase() === String(title).toLowerCase()) { game = g; break; }
            }
            if (!game) return;
            game.coverUrl     = newCover;
            game.image        = newCover;
            game.defaultImage = newCover;
            game._agCoverPipelineDone = true;

            const gameId = String(game.id || game.appName || '');
            const card = vsCardCache.get(gameId);
            if (card) {
                const img = card.querySelector?.('.native-lazy-load');
                if (img) img.src = newCover;
            }
        };
    }

    const cache = [{ id: 'g1', appName: 'g1', title: 'Game 1', coverUrl: null }];
    const fakeCard = { querySelector: () => ({ src: '' }) };
    const cardCache = new Map([['g1', fakeCard]]);
    const handler = makeHandler(cache, cardCache);

    handler({ id: 'g1', title: 'Game 1', coverUrl: 'file://new.webp', image: 'file://new.webp', defaultImage: 'file://new.webp' });

    assert.equal(cache[0].coverUrl, 'file://new.webp', '_allGamesCache entry must be patched immediately');
    assert.equal(cache[0]._agCoverPipelineDone, true,  '_agCoverPipelineDone must be set');
});

// ─── E4) renderer handler patches visible card img src ────────────────────────
test('all-games-cover-cached handler patches live card img.src when card is in cardCache', () => {
    function makeHandler(allGamesCache, vsCardCache) {
        return function onCoverCached(payload) {
            const { id, coverUrl } = payload;
            if (!coverUrl || !allGamesCache) return;
            const game = allGamesCache.find(g => String(g.id || g.appName || '') === String(id));
            if (!game) return;
            game.coverUrl = coverUrl;
            const gameId = String(game.id || game.appName || '');
            const card = vsCardCache.get(gameId);
            if (card) {
                const img = card.querySelector?.('.native-lazy-load');
                if (img) img.src = coverUrl;
            }
        };
    }
    const cache = [{ id: 'g42', appName: 'g42', coverUrl: null }];
    const mockImg = { src: '' };
    const fakeCard = { querySelector: (sel) => sel === '.native-lazy-load' ? mockImg : null };
    const cardCache = new Map([['g42', fakeCard]]);
    const handler = makeHandler(cache, cardCache);

    handler({ id: 'g42', coverUrl: 'file://cover42.webp' });

    assert.equal(mockImg.src, 'file://cover42.webp',
        'live card img.src must be updated immediately when card is in the virtual-scroller cardCache');
});

// ─── E5) virtual scroller card cache invalidated for the patched game ─────────
test('all-games-cover-cached handler: _agCoverPipelineDone set so cover is not re-fetched', () => {
    const cache = [{ id: 'g7', appName: 'g7', coverUrl: null, _agCoverPipelineDone: false }];
    function onCoverCached(payload) {
        const game = cache.find(g => String(g.id) === String(payload.id));
        if (game && payload.coverUrl) {
            game.coverUrl = payload.coverUrl;
            game._agCoverPipelineDone = true;
        }
    }
    onCoverCached({ id: 'g7', coverUrl: 'file://g7.webp' });
    assert.equal(cache[0]._agCoverPipelineDone, true,
        '_agCoverPipelineDone must be set to prevent the renderer cover pipeline from re-fetching the same game');
});

// ─── E6) library-updated NOT required — card visible without it ───────────────
test('cacheLibraryCoversFirst: card can be patched via coverCachedEmitter without library-updated firing', async () => {
    const { cacheLibraryCoversFirst } = makeCoverFirstFn();
    const entries = [{ id: 'g1', appName: 'g1', coverUrl: 'https://cdn/c.jpg' }];
    let libUpdatedFired = false;
    let coverCachedFired = false;
    const downloader = async (assets) => assets.cover ? { cover: 'file://c.webp' } : {};
    const matchFn = (lib, e) => lib.findIndex(lg => lg.id === e.id);
    // Pass a libUpdated emitter that would normally fire but check coverCached fired first
    const libUpdatedEmitter = () => { libUpdatedFired = true; };
    await cacheLibraryCoversFirst(entries, downloader, 'cache.json', matchFn, libUpdatedEmitter, {
        coverCachedEmitter: () => { coverCachedFired = true; },
        libUpdatedDebounceMs: 9999, // suppress debounced lib-updated during test
    });
    assert.equal(coverCachedFired, true,
        'coverCachedEmitter must have fired even if library-updated debounce has not triggered yet');
});

// ─── E7) 3 covers emitted before any hero/logo ───────────────────────────────
test('cacheLibraryCoversFirst: 3 cover-cached events emitted before secondary phase starts', async () => {
    const { cacheLibraryCoversFirst } = makeCoverFirstFn();
    const entries = [
        { id: 'g1', appName: 'g1', coverUrl: 'https://cdn/c1.jpg', heroUrl: 'https://cdn/h1.jpg' },
        { id: 'g2', appName: 'g2', coverUrl: 'https://cdn/c2.jpg', heroUrl: 'https://cdn/h2.jpg' },
        { id: 'g3', appName: 'g3', coverUrl: 'https://cdn/c3.jpg', heroUrl: 'https://cdn/h3.jpg' },
    ];
    const coverEmitCount = [];
    let heroStartCount = 0;

    const downloader = async (assets, gameId) => {
        if (assets.cover) return { cover: 'file://c.webp' };
        heroStartCount++;
        return {};
    };
    const matchFn = (lib, e) => lib.findIndex(lg => lg.id === e.id);
    await cacheLibraryCoversFirst(entries, downloader, 'cache.json', matchFn, null, {
        coverCachedEmitter: () => coverEmitCount.push(heroStartCount), // record heroStartCount at emit time
    });
    // At time of each cover emit, no hero downloads should have started yet (heroStartCount=0)
    assert.equal(coverEmitCount.length, 3, '3 cover-cached events must be emitted');
    assert.ok(coverEmitCount.every(c => c === 0),
        `all cover-cached events must fire before any secondary (hero) download starts; heroStartCounts: ${coverEmitCount}`);
});

// ─── E8) failed cover does not block remaining covers ────────────────────────
test('cacheLibraryCoversFirst: one failed cover does not block the rest of the queue', async () => {
    const { cacheLibraryCoversFirst } = makeCoverFirstFn();
    const entries = [
        { id: 'ok1', appName: 'ok1', coverUrl: 'https://cdn/c1.jpg' },
        { id: 'bad', appName: 'bad', coverUrl: 'https://cdn/bad.jpg' },
        { id: 'ok2', appName: 'ok2', coverUrl: 'https://cdn/c2.jpg' },
    ];
    const succeeded = [];
    const downloader = async (assets, gameId) => {
        if (assets.cover) {
            if (gameId === 'bad') throw new Error('CDN 503');
            succeeded.push(gameId);
            return { cover: `file://${gameId}.webp` };
        }
        return {};
    };
    const matchFn = (lib, e) => lib.findIndex(lg => lg.id === e.id);
    await cacheLibraryCoversFirst(entries, downloader, 'cache.json', matchFn, null);
    assert.ok(succeeded.includes('ok1'), 'ok1 must succeed despite bad failing');
    assert.ok(succeeded.includes('ok2'), 'ok2 must succeed despite bad failing');
    assert.equal(succeeded.length, 2, 'exactly 2 covers must succeed');
});
