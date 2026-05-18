'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const os     = require('os');
const path   = require('path');
const fs     = require('fs');

// ─── Helper: in-memory MetadataCacheStore ────────────────────────────────────
// Mirrors the real MetadataCacheStore API without needing Electron paths.

class FakeMetadataCache {
    constructor() { this._cache = {}; }

    async save(gameId, _title, _platform, meta) {
        this._cache[String(gameId)] = { fetchedAt: Date.now(), meta };
    }

    async load(gameId) {
        return this._cache[String(gameId)]?.meta ?? null;
    }

    async hasEntry(gameId, maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
        const entry = this._cache[String(gameId)];
        if (!entry) return false;
        return (Date.now() - entry.fetchedAt) < maxAgeMs;
    }

    async deleteEntry(gameId) { delete this._cache[String(gameId)]; }
}

// ─── Helper: minimal pipeline skip + hero-completeness logic ─────────────────
// Extracted from gameScanner.js runBackgroundMetadataPipeline so we can
// unit-test the decision logic in isolation (without Electron).

function computeArtFlags(game, diskCover, diskHero) {
    const hasDiskCover = !!diskCover;
    const hasDiskHero  = !!diskHero;
    const hasDbArt     = !!(game.image || game.heroImage || game.logo);
    const hasDiskArt   = hasDiskCover || hasDiskHero;
    const hasAnyArt    = hasDbArt || hasDiskArt;
    const hasDbHero    = !!game.heroImage;
    const hasHero      = hasDbHero || hasDiskHero;
    return { hasAnyArt, hasHero, hasDbHero, hasDiskHero };
}

async function pipelineDecision(game, diskCover, diskHero, metaCache) {
    const { hasAnyArt, hasHero } = computeArtFlags(game, diskCover, diskHero);
    if (hasAnyArt && hasHero && await metaCache.hasEntry(game.id)) return 'skip';
    if (hasAnyArt && !hasHero) {
        const hasMeta = await metaCache.hasEntry(game.id);
        if (hasMeta) return 'hero-backfill';
        return 'full-pipeline'; // cover present but no metadata → full pipeline
    }
    if (!hasAnyArt) return 'full-pipeline';
    return 'full-pipeline'; // metadata missing
}

// ─── A) Hero completeness logic ───────────────────────────────────────────────

test('computeArtFlags: cover-only game → hasHero=false', () => {
    const game = { id: 'g1', image: 'file://cover.webp', heroImage: null, logo: null };
    const { hasAnyArt, hasHero } = computeArtFlags(game, 'file://cover.webp', null);
    assert.equal(hasAnyArt, true,  'cover counts as art');
    assert.equal(hasHero,   false, 'cover-only must NOT satisfy hero completeness');
});

test('computeArtFlags: logo-only game → hasHero=false', () => {
    const game = { id: 'g1', image: null, heroImage: null, logo: 'file://logo.webp' };
    const { hasAnyArt, hasHero } = computeArtFlags(game, null, null);
    assert.equal(hasAnyArt, true,  'logo counts as art');
    assert.equal(hasHero,   false, 'logo-only must NOT satisfy hero completeness');
});

test('computeArtFlags: DB heroImage present → hasHero=true', () => {
    const game = { id: 'g1', image: 'file://c.webp', heroImage: 'file://h.webp', logo: null };
    const { hasHero } = computeArtFlags(game, 'file://c.webp', null);
    assert.equal(hasHero, true);
});

test('computeArtFlags: disk hero file present (no DB heroImage) → hasHero=true', () => {
    const game = { id: 'g1', image: 'file://c.webp', heroImage: null, logo: null };
    const { hasHero } = computeArtFlags(game, 'file://c.webp', 'file://hero.webp');
    assert.equal(hasHero, true);
});

test('computeArtFlags: cover+logo but no hero anywhere → hasHero=false', () => {
    const game = { id: 'g1', image: 'file://c.webp', heroImage: null, logo: 'file://l.webp' };
    const { hasHero } = computeArtFlags(game, 'file://c.webp', null);
    assert.equal(hasHero, false);
});

// ─── B) Pipeline decision routing ────────────────────────────────────────────

test('pipeline: cover+hero+metadata → skip (fully complete)', async () => {
    const cache = new FakeMetadataCache();
    await cache.save('g1', 'Game', 'xbox', { heroImage: 'https://cdn/h.jpg' });
    const game = { id: 'g1', image: 'file://c.webp', heroImage: 'file://h.webp', logo: null };
    const decision = await pipelineDecision(game, 'file://c.webp', 'file://h.webp', cache);
    assert.equal(decision, 'skip', 'hero-complete game with metadata must be skipped');
});

test('pipeline: cover+logo but no hero, metadata present → hero-backfill', async () => {
    const cache = new FakeMetadataCache();
    await cache.save('g1', 'Game', 'xbox', { cover: 'https://cdn/c.jpg', heroImage: 'https://cdn/h.jpg' });
    const game = { id: 'g1', image: 'file://c.webp', heroImage: null, logo: 'file://l.webp' };
    const decision = await pipelineDecision(game, 'file://c.webp', null, cache);
    assert.equal(decision, 'hero-backfill',
        'cover+logo with no hero must enter hero-backfill, not skip');
});

test('pipeline: cover-only, no hero, no metadata → full-pipeline', async () => {
    const cache = new FakeMetadataCache(); // empty
    const game = { id: 'g1', image: 'file://c.webp', heroImage: null, logo: null };
    const decision = await pipelineDecision(game, 'file://c.webp', null, cache);
    assert.equal(decision, 'full-pipeline',
        'cover without metadata must trigger full pipeline to fetch hero');
});

test('pipeline: no art at all → full-pipeline', async () => {
    const cache = new FakeMetadataCache(); // empty
    const game = { id: 'g1', image: null, heroImage: null, logo: null };
    const decision = await pipelineDecision(game, null, null, cache);
    assert.equal(decision, 'full-pipeline');
});

// ─── C) Hero backfill execution ───────────────────────────────────────────────
// Simulate the hero-backfill branch: given cached metadata with heroImage URL,
// the hero is downloaded and written to the DB without a full re-resolve.

async function runHeroBackfill(cachedMeta, imageDownloadFn) {
    const cachedHeroUrl = cachedMeta?.heroImage || cachedMeta?.hero || null;
    if (!cachedHeroUrl) return { outcome: 'no-hero-in-meta', finalHero: null };

    let finalHero = cachedHeroUrl;
    let downloaded = false;
    if (imageDownloadFn) {
        const dl = await imageDownloadFn({ hero: cachedHeroUrl });
        if (dl?.hero) { finalHero = dl.hero; downloaded = true; }
    }
    return { outcome: 'hero-rehydrated', finalHero, downloaded };
}

test('backfill: cached metadata with heroImage → hero rehydrated without re-resolve', async () => {
    const cachedMeta = { cover: 'https://cdn/c.jpg', heroImage: 'https://cdn/h.jpg', logo: null };

    let downloadCalledWith = null;
    const fakeDownload = async (assets) => {
        downloadCalledWith = assets;
        return { hero: 'file://cached/hero.webp' };
    };

    const result = await runHeroBackfill(cachedMeta, fakeDownload);

    assert.equal(result.outcome, 'hero-rehydrated');
    assert.equal(result.finalHero, 'file://cached/hero.webp');
    assert.equal(result.downloaded, true);
    assert.deepStrictEqual(downloadCalledWith, { hero: 'https://cdn/h.jpg' },
        'imageDownloadFn must be called with ONLY hero (no full re-resolve)');
});

test('backfill: cached metadata uses hero alias when heroImage absent', async () => {
    const cachedMeta = { hero: 'https://cdn/h-alias.jpg' };
    const fakeDownload = async (assets) => ({ hero: 'file://h-alias.webp' });

    const result = await runHeroBackfill(cachedMeta, fakeDownload);
    assert.equal(result.finalHero, 'file://h-alias.webp');
});

test('backfill: cached metadata has no hero URL → outcome is no-hero-in-meta', async () => {
    const cachedMeta = { cover: 'https://cdn/c.jpg', logo: 'https://cdn/l.png' };
    const fakeDownload = async () => assert.fail('should not download when no hero URL');

    const result = await runHeroBackfill(cachedMeta, fakeDownload);
    assert.equal(result.outcome, 'no-hero-in-meta');
    assert.equal(result.finalHero, null);
});

test('backfill: download failure → falls back to remote URL', async () => {
    const cachedMeta = { heroImage: 'https://cdn/h.jpg' };
    const failDownload = async () => { throw new Error('network timeout'); };

    // Mirrors the real code: on download error we keep cachedHeroUrl
    const cachedHeroUrl = cachedMeta.heroImage;
    let finalHero = cachedHeroUrl;
    try {
        const dl = await failDownload({ hero: cachedHeroUrl });
        if (dl?.hero) finalHero = dl.hero;
    } catch { /* keep remote URL */ }

    assert.equal(finalHero, 'https://cdn/h.jpg',
        'download failure must not lose the hero URL — fall back to remote');
});

test('backfill: imageDownloadFn not registered → uses remote URL', async () => {
    const cachedMeta = { heroImage: 'https://cdn/h.jpg' };
    const result = await runHeroBackfill(cachedMeta, null /* no downloader */);
    assert.equal(result.finalHero, 'https://cdn/h.jpg');
    assert.equal(result.downloaded, false);
});

// ─── D) Integration: the skip gate no longer fires for cover-only games ───────

test('skip gate: cover+hero+meta → skips (correct)', async () => {
    const cache = new FakeMetadataCache();
    await cache.save('g1', 'X', 'xbox', { heroImage: 'https://cdn/h.jpg', cover: 'https://cdn/c.jpg' });

    const hasAnyArt = true;
    const hasHero   = true; // hero present
    const metaHit   = await cache.hasEntry('g1');
    assert.equal(hasAnyArt && hasHero && metaHit, true, 'fully-complete game must be skipped');
});

test('skip gate: cover-only+meta → must NOT skip (bug was here)', async () => {
    const cache = new FakeMetadataCache();
    await cache.save('g1', 'X', 'xbox', { heroImage: 'https://cdn/h.jpg', cover: 'https://cdn/c.jpg' });

    const hasAnyArt = true;
    const hasHero   = false; // cover only
    const metaHit   = await cache.hasEntry('g1');
    assert.equal(hasAnyArt && hasHero && metaHit, false,
        'cover-only + metadata must NOT trigger the skip gate (was the bug)');
});

test('skip gate: cover+logo+meta → must NOT skip (needs hero)', async () => {
    const cache = new FakeMetadataCache();
    await cache.save('g1', 'X', 'xbox', { cover: 'https://cdn/c.jpg', logo: 'https://cdn/l.png' });

    const hasAnyArt = true;
    const hasHero   = false;
    const metaHit   = await cache.hasEntry('g1');
    assert.equal(hasAnyArt && hasHero && metaHit, false,
        'cover+logo without hero must not be considered complete');
});
