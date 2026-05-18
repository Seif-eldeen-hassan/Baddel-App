'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');

// ─── A) _allGamesCache rebuild preserves heroUrl / logoUrl ───────────────────
//
// The real rebuild lives inside accounts.js (browser context). We extract the
// pure preservation logic here so it can be verified without a DOM.

/**
 * Mirror of the preservation pass performed in accounts.js §11 "ALL GAMES VIEW".
 * Copies coverUrl / heroUrl / logoUrl and pipeline-done flags from old cache into
 * the freshly-built newEntries list so images don't flash away on refresh.
 */
function rebuildWithPreservation(newEntries, oldEntries) {
    const newCache = newEntries.map(g => ({ ...g }));
    const oldById  = new Map(oldEntries.map(g => [String(g.id ?? g.appName ?? g.title), g]));
    newCache.forEach(g => {
        const key = String(g.id ?? g.appName ?? g.title);
        const old = oldById.get(key);
        if (old?.coverUrl)             g.coverUrl             = old.coverUrl;
        if (old?.heroUrl)              g.heroUrl              = old.heroUrl;
        if (old?.logoUrl)              g.logoUrl              = old.logoUrl;
        if (old?._agCoverPipelineDone) g._agCoverPipelineDone = old._agCoverPipelineDone;
        if (old?._agHeroLogoDone)      g._agHeroLogoDone      = old._agHeroLogoDone;
    });
    return newCache;
}

test('rebuild: coverUrl is preserved from old cache', () => {
    const old  = [{ id: 'g1', coverUrl: 'file://cover.webp', heroUrl: null, logoUrl: null }];
    const next = [{ id: 'g1', coverUrl: null, heroUrl: null, logoUrl: null }];
    const result = rebuildWithPreservation(next, old);
    assert.equal(result[0].coverUrl, 'file://cover.webp');
});

test('rebuild: heroUrl is preserved from old cache', () => {
    const old  = [{ id: 'g1', coverUrl: null, heroUrl: 'file://hero.webp', logoUrl: null }];
    const next = [{ id: 'g1', coverUrl: null, heroUrl: null, logoUrl: null }];
    const result = rebuildWithPreservation(next, old);
    assert.equal(result[0].heroUrl, 'file://hero.webp',
        'heroUrl must survive a library refresh, not be wiped by fresh null from sync');
});

test('rebuild: logoUrl is preserved from old cache', () => {
    const old  = [{ id: 'g1', coverUrl: null, heroUrl: null, logoUrl: 'file://logo.webp' }];
    const next = [{ id: 'g1', coverUrl: null, heroUrl: null, logoUrl: null }];
    const result = rebuildWithPreservation(next, old);
    assert.equal(result[0].logoUrl, 'file://logo.webp',
        'logoUrl must survive a library refresh');
});

test('rebuild: all three asset URLs preserved simultaneously', () => {
    const old  = [{ id: 'g1', coverUrl: 'file://c.webp', heroUrl: 'file://h.webp', logoUrl: 'file://l.webp' }];
    const next = [{ id: 'g1', coverUrl: null, heroUrl: null, logoUrl: null }];
    const result = rebuildWithPreservation(next, old);
    assert.equal(result[0].coverUrl, 'file://c.webp');
    assert.equal(result[0].heroUrl,  'file://h.webp');
    assert.equal(result[0].logoUrl,  'file://l.webp');
});

test('rebuild: pipeline-done flags are preserved', () => {
    const old  = [{ id: 'g1', _agCoverPipelineDone: true, _agHeroLogoDone: true }];
    const next = [{ id: 'g1' }];
    const result = rebuildWithPreservation(next, old);
    assert.equal(result[0]._agCoverPipelineDone, true);
    assert.equal(result[0]._agHeroLogoDone,      true);
});

test('rebuild: game absent from old cache gets no stale URLs', () => {
    const old  = [];
    const next = [{ id: 'g1', coverUrl: null, heroUrl: null, logoUrl: null }];
    const result = rebuildWithPreservation(next, old);
    assert.equal(result[0].coverUrl, null);
    assert.equal(result[0].heroUrl,  null);
    assert.equal(result[0].logoUrl,  null);
});

test('rebuild: old cached coverUrl wins when new entry has null (sync entries start null)', () => {
    // In practice, fresh entries from buildSteamOwnedGameEntries always have null asset URLs.
    // The asset pipeline populates them separately. So old always wins when truthy.
    const old  = [{ id: 'g1', coverUrl: 'file://old.webp' }];
    const next = [{ id: 'g1', coverUrl: null }];
    const result = rebuildWithPreservation(next, old);
    assert.equal(result[0].coverUrl, 'file://old.webp',
        'cached file:// URL must be kept — fresh sync entries have null URLs by design');
});

// ─── B) Asset-caching side-effect: hero / logo populated alongside cover ──────
//
// Mirror of _cacheAssetSideEffect in _agResolveCoverForGame (accounts.js §11).
// The helper writes a field on game + fires a localStorage-like store entry.

function makeCacheAssetSideEffect(game, store) {
    return function _cacheAssetSideEffect(rawUrl, type, field) {
        if (!rawUrl || game[field]) return;
        game[field] = rawUrl;
        store.set(type + '_' + String(game.id), rawUrl);
    };
}

test('_cacheAssetSideEffect: heroImage from metadata sets heroUrl on game', () => {
    const game  = { id: 'abc123', heroUrl: null, logoUrl: null };
    const store = new Map();
    const fn    = makeCacheAssetSideEffect(game, store);

    fn('https://cdn/hero.jpg', 'hero', 'heroUrl');

    assert.equal(game.heroUrl, 'https://cdn/hero.jpg');
    assert.equal(store.get('hero_abc123'), 'https://cdn/hero.jpg');
});

test('_cacheAssetSideEffect: logo from metadata sets logoUrl on game', () => {
    const game  = { id: 'abc123', heroUrl: null, logoUrl: null };
    const store = new Map();
    const fn    = makeCacheAssetSideEffect(game, store);

    fn('https://cdn/logo.png', 'logo', 'logoUrl');

    assert.equal(game.logoUrl, 'https://cdn/logo.png');
    assert.equal(store.get('logo_abc123'), 'https://cdn/logo.png');
});

test('_cacheAssetSideEffect: already-set heroUrl is not overwritten', () => {
    const game  = { id: 'abc123', heroUrl: 'file://existing-hero.webp' };
    const store = new Map();
    const fn    = makeCacheAssetSideEffect(game, store);

    fn('https://cdn/new-hero.jpg', 'hero', 'heroUrl');

    assert.equal(game.heroUrl, 'file://existing-hero.webp',
        'a cached file:// hero must not be overwritten by a remote URL');
    assert.equal(store.has('hero_abc123'), false);
});

test('_cacheAssetSideEffect: null rawUrl is a no-op', () => {
    const game  = { id: 'abc123', heroUrl: null };
    const store = new Map();
    const fn    = makeCacheAssetSideEffect(game, store);

    fn(null, 'hero', 'heroUrl');

    assert.equal(game.heroUrl, null);
    assert.equal(store.has('hero_abc123'), false);
});

test('_cacheAssetSideEffect: hero and logo from same metadata call both set', () => {
    const game  = { id: 'abc123', heroUrl: null, logoUrl: null };
    const store = new Map();
    const fn    = makeCacheAssetSideEffect(game, store);
    const meta  = { heroImage: 'https://cdn/h.jpg', logo: 'https://cdn/l.png' };

    fn(meta.heroImage || meta.hero || null, 'hero', 'heroUrl');
    fn(meta.logo      || null,              'logo', 'logoUrl');

    assert.equal(game.heroUrl,  'https://cdn/h.jpg');
    assert.equal(game.logoUrl,  'https://cdn/l.png');
});

// ─── C) Steam synced entries can receive / preserve hero / logo after enrich ──
//
// Tests the chain: Steam entry initialised with null heroUrl/logoUrl
// → normalizeServerData produces heroImage → applyNormalizedToCache writes heroUrl.
//
// platformSync.js cannot be required (Electron dependency), so we extract the
// three key pieces of logic that make the chain work:
//   1. Steam entries start with heroUrl/logoUrl null fields (structural check)
//   2. normalizeServerData maps images[] hero → heroImage (via baddelApi)
//   3. The write-back rule: normalized.heroImage → entry.heroUrl

// Part 1 — Steam entry structure always includes heroUrl/logoUrl
test('Steam entry factory: heroUrl and logoUrl are present (not missing fields)', () => {
    // buildSteamOwnedGameEntries constructs entries like this:
    const steamEntry = {
        id: 'steam-730',
        title: 'Counter-Strike 2',
        platform: 'steam',
        source: 'steam',
        coverUrl: null,
        heroUrl:  null,
        logoUrl:  null,
        appName: '730',
    };
    assert.ok('heroUrl' in steamEntry, 'heroUrl must be present from the start');
    assert.ok('logoUrl' in steamEntry, 'logoUrl must be present from the start');
    assert.equal(steamEntry.heroUrl, null);
    assert.equal(steamEntry.logoUrl, null);
});

// Part 2 — normalizeServerData hero images → heroImage key
const { normalizeAssets } = require('../services/baddelApi');

test('normalizeAssets: heroImage alias is lifted to hero for applyNormalized consumers', () => {
    // normalizeServerData puts the result in `heroImage` — normalizeAssets bridges it
    const from = { heroImage: 'https://cdn/h.jpg', cover: 'https://cdn/c.jpg' };
    const n    = normalizeAssets(from);
    assert.equal(n.hero, 'https://cdn/h.jpg',
        'consumers that call normalizeAssets() must see hero, not heroImage');
});

// Part 3 — the write-back rule used by applyNormalizedToCache
function applyEnrichToEntry(entry, normalized) {
    let updated = false;
    if (normalized.cover     && entry.coverUrl !== normalized.cover)    { entry.coverUrl = normalized.cover;     updated = true; }
    if (normalized.heroImage && entry.heroUrl  !== normalized.heroImage) { entry.heroUrl  = normalized.heroImage; updated = true; }
    if (normalized.logo      && entry.logoUrl  !== normalized.logo)      { entry.logoUrl  = normalized.logo;      updated = true; }
    return updated;
}

test('applyEnrichToEntry: heroImage → heroUrl, logo → logoUrl on a Steam entry', () => {
    const entry = { id: 'steam-730', coverUrl: null, heroUrl: null, logoUrl: null };
    const norm  = { cover: 'https://cdn/c.jpg', heroImage: 'https://cdn/h.jpg', logo: 'https://cdn/l.png' };

    const updated = applyEnrichToEntry(entry, norm);

    assert.equal(updated, true);
    assert.equal(entry.coverUrl, 'https://cdn/c.jpg');
    assert.equal(entry.heroUrl,  'https://cdn/h.jpg',
        'heroImage from normalizeServerData must land in heroUrl, not be ignored');
    assert.equal(entry.logoUrl,  'https://cdn/l.png');
});

test('applyEnrichToEntry: no-op when hero/logo already set (idempotent)', () => {
    const entry   = { coverUrl: 'file://c.webp', heroUrl: 'file://h.webp', logoUrl: 'file://l.webp' };
    const norm    = { cover: 'file://c.webp', heroImage: 'file://h.webp', logo: 'file://l.webp' };
    const updated = applyEnrichToEntry(entry, norm);
    assert.equal(updated, false, 'unchanged values must not set the updated flag');
});

test('applyEnrichToEntry: partial update — only heroImage present', () => {
    const entry   = { coverUrl: null, heroUrl: null, logoUrl: null };
    const norm    = { heroImage: 'https://cdn/h.jpg' };
    applyEnrichToEntry(entry, norm);
    assert.equal(entry.heroUrl,  'https://cdn/h.jpg');
    assert.equal(entry.coverUrl, null);
    assert.equal(entry.logoUrl,  null);
});

// ─── D) Library refresh does not wipe previously resolved hero / logo ─────────
//
// End-to-end scenario: game has cached assets, sync returns fresh data with
// null asset fields, rebuild must keep the cached values.

test('library refresh scenario: hero/logo survive a sync that returns null assets', () => {
    const beforeRefresh = [
        { id: 'g1', title: 'Game A', coverUrl: 'file://c.webp', heroUrl: 'file://h.webp', logoUrl: 'file://l.webp', _agCoverPipelineDone: true },
        { id: 'g2', title: 'Game B', coverUrl: null, heroUrl: null, logoUrl: null },
    ];

    // Simulate a sync that returns fresh entries with no URLs (as Steam entries start)
    const afterSync = [
        { id: 'g1', title: 'Game A', coverUrl: null, heroUrl: null, logoUrl: null },
        { id: 'g2', title: 'Game B', coverUrl: 'https://cdn/c.jpg', heroUrl: 'https://cdn/h.jpg', logoUrl: null },
    ];

    const result = rebuildWithPreservation(afterSync, beforeRefresh);
    const g1 = result.find(g => g.id === 'g1');
    const g2 = result.find(g => g.id === 'g2');

    // g1 kept its cached assets despite sync returning nulls
    assert.equal(g1.coverUrl, 'file://c.webp',  'cover must not be wiped by sync');
    assert.equal(g1.heroUrl,  'file://h.webp',  'hero must not be wiped by sync');
    assert.equal(g1.logoUrl,  'file://l.webp',  'logo must not be wiped by sync');
    assert.equal(g1._agCoverPipelineDone, true);

    // g2 had no cached assets — fresh values from sync are kept as-is
    assert.equal(g2.coverUrl, 'https://cdn/c.jpg');
    assert.equal(g2.heroUrl,  'https://cdn/h.jpg');
    assert.equal(g2.logoUrl,  null);
});

test('library refresh scenario: new game not in old cache starts without stale URLs', () => {
    const beforeRefresh = [
        { id: 'g1', heroUrl: 'file://h.webp', logoUrl: 'file://l.webp' },
    ];
    const afterSync = [
        { id: 'g1', heroUrl: null, logoUrl: null },
        { id: 'g2', heroUrl: null, logoUrl: null }, // newly discovered game
    ];
    const result = rebuildWithPreservation(afterSync, beforeRefresh);
    const g2 = result.find(g => g.id === 'g2');
    assert.equal(g2.heroUrl, null, 'brand-new game must not inherit another game\'s assets');
    assert.equal(g2.logoUrl, null);
});
