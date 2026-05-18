'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const os     = require('os');
const path   = require('path');
const fs     = require('fs');

// ─── A) Asset normalisation (baddelApi.normalizeAssets) ──────────────────────
// Load the pure function without triggering the full baddelApi init.
const baddelApi = require('../services/baddelApi');
const { normalizeAssets } = baddelApi;

test('normalizeAssets: null / undefined input → all-null', () => {
    assert.deepStrictEqual(normalizeAssets(null),      { cover: null, hero: null, logo: null });
    assert.deepStrictEqual(normalizeAssets(undefined), { cover: null, hero: null, logo: null });
});

test('normalizeAssets: canonical hero key is preserved', () => {
    const r = normalizeAssets({ cover: 'c.jpg', hero: 'h.jpg', logo: 'l.png' });
    assert.equal(r.cover, 'c.jpg');
    assert.equal(r.hero,  'h.jpg');
    assert.equal(r.logo,  'l.png');
});

test('normalizeAssets: heroImage alias is lifted to hero', () => {
    const r = normalizeAssets({ cover: 'c.jpg', heroImage: 'h.jpg', logo: 'l.png' });
    assert.equal(r.hero, 'h.jpg', 'heroImage must be surfaced as hero');
});

test('normalizeAssets: hero wins over heroImage when both present', () => {
    const r = normalizeAssets({ hero: 'h-canonical.jpg', heroImage: 'h-alias.jpg' });
    assert.equal(r.hero, 'h-canonical.jpg');
});

test('normalizeAssets: image alias is lifted to cover', () => {
    const r = normalizeAssets({ image: 'cover.jpg' });
    assert.equal(r.cover, 'cover.jpg');
});

test('normalizeAssets: cover wins over image when both present', () => {
    const r = normalizeAssets({ cover: 'cover.jpg', image: 'old.jpg' });
    assert.equal(r.cover, 'cover.jpg');
});

// ─── B) Cache key consistency (imageWebpCache.cacheBaseName) ─────────────────
const { cacheBaseName } = require('../services/imageWebpCache');

test('cacheBaseName: format is type_gameId', () => {
    assert.equal(cacheBaseName('cover', 'abc123def456'), 'cover_abc123def456');
    assert.equal(cacheBaseName('hero',  'abc123def456'), 'hero_abc123def456');
    assert.equal(cacheBaseName('logo',  'abc123def456'), 'logo_abc123def456');
});

test('cacheBaseName: hyphenated game ids are preserved', () => {
    // DB ids like "steam-410110" must not be mangled
    assert.equal(cacheBaseName('cover', 'steam-410110'), 'cover_steam-410110');
    assert.equal(cacheBaseName('hero',  'epic-abc123'),  'hero_epic-abc123');
});

test('cacheBaseName: all writers produce the same stem', () => {
    const gameId = 'abc123def4567890';
    const expected = (type) => `${type}_${gameId}`;
    // The formula used by the helper must match the formula used by every writer.
    ['cover', 'hero', 'logo'].forEach(type => {
        assert.equal(cacheBaseName(type, gameId), expected(type));
    });
});

// ─── C) MetadataResolutionManager: resetToIdle and clearJob ──────────────────
const { MetadataResolutionManager, STATUS } = require('../services/metadataResolutionManager');

function makeMRM() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mrm-test-'));
    return { mrm: new MetadataResolutionManager(dir), dir };
}

test('MRM: resetToIdle clears RESOLVED lock', () => {
    const { mrm } = makeMRM();
    mrm.markResolved('game1', { matchedName: 'Test' });
    assert.equal(mrm.getStatus('game1'), STATUS.RESOLVED);
    mrm.resetToIdle('game1');
    assert.equal(mrm.getStatus('game1'), STATUS.IDLE,
        'resetToIdle must allow the next pipeline pass to retry');
});

test('MRM: clearJob removes state entirely', () => {
    const { mrm } = makeMRM();
    mrm.markResolved('game2', {});
    mrm.clearJob('game2');
    assert.equal(mrm.getJob('game2'), null);
    assert.equal(mrm.getStatus('game2'), STATUS.IDLE);
});

test('MRM: resetToIdle is a no-op for games with no existing job', () => {
    const { mrm } = makeMRM();
    assert.doesNotThrow(() => mrm.resetToIdle('unknown-game'));
    assert.equal(mrm.getStatus('unknown-game'), STATUS.IDLE);
});

test('MRM: RESOLVED expires after 7 days (TTL check)', () => {
    const { mrm } = makeMRM();
    mrm._setJob('game3', {
        status: STATUS.RESOLVED,
        resolvedAt: Date.now() - (8 * 24 * 60 * 60 * 1000), // 8 days ago
        updatedAt: Date.now(),
    });
    assert.equal(mrm.getStatus('game3'), STATUS.IDLE,
        'expired RESOLVED must return IDLE so the pipeline retries');
});

// ─── D) updateGameMetadata heroImage alias ────────────────────────────────────
// Test the pure logic of updateGameMetadata without requiring Electron by
// reconstructing a minimal engine-like object that holds a dbCache array.

function makeMinimalEngine() {
    const dbCache = [
        { id: 'g1', name: 'Test Game', image: null, heroImage: null, logo: null,
          defaultImage: null, defaultHero: null, defaultLogo: null },
    ];
    let saved = false;
    return {
        dbCache,
        saveDatabase() { saved = true; },
        get wasSaved() { return saved; },
        // Replicate the fixed updateGameMetadata logic
        async updateGameMetadata(gameId, metadata) {
            const index = this.dbCache.findIndex(g => String(g.id) === String(gameId));
            if (index === -1) return { status: 'error', message: 'Game not found' };
            const game = this.dbCache[index];
            const hero = metadata.hero || metadata.heroImage || null;
            if (hero)           { game.heroImage = hero;           game.defaultHero  = hero; }
            if (metadata.cover) { game.image     = metadata.cover; game.defaultImage = metadata.cover; }
            if (metadata.logo)  { game.logo      = metadata.logo;  game.defaultLogo  = metadata.logo; }
            this.saveDatabase();
            return { status: 'success' };
        },
    };
}

test('updateGameMetadata: canonical hero key sets heroImage in DB', async () => {
    const eng = makeMinimalEngine();
    await eng.updateGameMetadata('g1', { cover: 'c.jpg', hero: 'h.jpg', logo: 'l.png' });
    assert.equal(eng.dbCache[0].heroImage, 'h.jpg');
    assert.equal(eng.dbCache[0].defaultHero, 'h.jpg');
});

test('updateGameMetadata: heroImage alias sets heroImage in DB', async () => {
    const eng = makeMinimalEngine();
    await eng.updateGameMetadata('g1', { cover: 'c.jpg', heroImage: 'h-alias.jpg', logo: 'l.png' });
    assert.equal(eng.dbCache[0].heroImage, 'h-alias.jpg',
        'heroImage alias must not be silently dropped');
    assert.equal(eng.dbCache[0].defaultHero, 'h-alias.jpg');
});

test('updateGameMetadata: hero wins over heroImage', async () => {
    const eng = makeMinimalEngine();
    await eng.updateGameMetadata('g1', { hero: 'h-canonical.jpg', heroImage: 'h-alias.jpg' });
    assert.equal(eng.dbCache[0].heroImage, 'h-canonical.jpg');
});

test('updateGameMetadata: null heroImage/hero leaves existing value intact', async () => {
    const eng = makeMinimalEngine();
    eng.dbCache[0].heroImage = 'existing.jpg';
    eng.dbCache[0].defaultHero = 'existing.jpg';
    await eng.updateGameMetadata('g1', { cover: 'c.jpg' });
    // hero and heroImage not in metadata → must not overwrite
    assert.equal(eng.dbCache[0].heroImage, 'existing.jpg');
});

// ─── E) Xbox exception retryability guard ────────────────────────────────────
// Reference implementation of the pipeline skip logic (mirrors gameScanner.js).
// Tests that exception_keep_pending_art games stay retryable when they have no art.

function pipelineShouldSkip({ hasAnyArt, metaCacheHit, mrmStatus }) {
    // Recovery gate (mirrors the fixed pipeline)
    let effectiveMrm = mrmStatus;
    if (mrmStatus === STATUS.RESOLVED && !hasAnyArt) {
        effectiveMrm = STATUS.IDLE; // would call mrm.resetToIdle in real code
    }
    // metadataCacheStore skip gate — requires art too
    if (hasAnyArt && metaCacheHit) return true;
    // MRM terminal gates
    if (effectiveMrm === STATUS.NOT_FOUND || effectiveMrm === STATUS.AMBIGUOUS) return true;
    if (effectiveMrm === STATUS.COOLDOWN) return true;
    return false;
}

test('Exception game with no art, MRM RESOLVED → NOT skipped (recovery path)', () => {
    const skip = pipelineShouldSkip({
        hasAnyArt:    false,
        metaCacheHit: true,
        mrmStatus:    STATUS.RESOLVED,
    });
    assert.equal(skip, false,
        'RESOLVED + no art must trigger recovery so the game retries next run');
});

test('Exception game with no art, MRM IDLE → NOT skipped', () => {
    const skip = pipelineShouldSkip({
        hasAnyArt:    false,
        metaCacheHit: false,
        mrmStatus:    STATUS.IDLE,
    });
    assert.equal(skip, false);
});

test('Game with art AND metadata cache hit → skipped correctly', () => {
    const skip = pipelineShouldSkip({
        hasAnyArt:    true,
        metaCacheHit: true,
        mrmStatus:    STATUS.RESOLVED,
    });
    assert.equal(skip, true, 'fully resolved game with art must be skipped');
});

test('Game with art but no metadata cache → NOT skipped (metadata should refresh)', () => {
    const skip = pipelineShouldSkip({
        hasAnyArt:    true,
        metaCacheHit: false,
        mrmStatus:    STATUS.IDLE,
    });
    assert.equal(skip, false);
});

test('MRM NOT_FOUND → skipped (terminal state)', () => {
    const skip = pipelineShouldSkip({
        hasAnyArt:    false,
        metaCacheHit: false,
        mrmStatus:    STATUS.NOT_FOUND,
    });
    assert.equal(skip, true);
});

test('MRM NOT_FOUND + art → still skipped (server confirmed not a game)', () => {
    const skip = pipelineShouldSkip({
        hasAnyArt:    true,
        metaCacheHit: false,
        mrmStatus:    STATUS.NOT_FOUND,
    });
    assert.equal(skip, true);
});

// ─── E) Platform/ID pre-lookup for Ubisoft/EA games with Epic or Steam IDs ───
// These tests verify the logic that get-game-metadata uses to extract Epic/Steam
// IDs from hints.allIds, hints.namespace, and hints.launcherGameId before MRM.

function extractEpicId(hints) {
    const id = hints.allIds?.epic
        || hints.namespace
        || (typeof (hints.id || '') === 'string' && /^epic[-_]/i.test(hints.id || '')
            ? String(hints.id).replace(/^epic[-_]/i, '') : null);
    if (!id) return null;
    return String(id).replace(/^epic[-_]/i, '');
}

function extractSteamId(hints) {
    const id = hints.allIds?.steam
        || (typeof (hints.id || '') === 'string' && /^steam[-_]/i.test(hints.id || '')
            ? String(hints.id).replace(/^steam[-_]/i, '') : null);
    if (!id) return null;
    return String(id).replace(/^steam[-_]/i, '');
}

test('platform/id pre-lookup: allIds.epic extracted correctly', () => {
    const hints = { platform: 'ubisoft', id: 'epic_Carnation', allIds: { epic: 'Carnation' } };
    assert.equal(extractEpicId(hints), 'Carnation');
});

test('platform/id pre-lookup: namespace extracted when allIds.epic absent', () => {
    const hints = { platform: 'ubisoft', id: 'epic_Carnation', namespace: 'Carnation' };
    assert.equal(extractEpicId(hints), 'Carnation');
});

test('platform/id pre-lookup: launcherGameId NOT used (avoids EA-format false positives)', () => {
    // launcherGameId can be EA-format (Origin.OFR.50.0000468) or Ubisoft-format —
    // not safe to use as Epic ID. Only allIds.epic and namespace are reliable.
    const hints = { platform: 'ea', launcherGameId: 'Origin.OFR.50.0000468' };
    assert.equal(extractEpicId(hints), null, 'EA launcherGameId must not be treated as Epic ID');
});

test('platform/id pre-lookup: hints.id with epic_ prefix extracted', () => {
    const hints = { platform: 'ubisoft', id: 'epic_Carnation' };
    assert.equal(extractEpicId(hints), 'Carnation');
});

test('platform/id pre-lookup: hints.id with steam_ prefix extracted', () => {
    const hints = { platform: 'rockstar', id: 'steam_12345' };
    assert.equal(extractSteamId(hints), '12345');
});

test('platform/id pre-lookup: allIds.steam extracted', () => {
    const hints = { platform: 'manual', allIds: { steam: '377160' } };
    assert.equal(extractSteamId(hints), '377160');
});

test('platform/id pre-lookup: no ids → null for both extractors', () => {
    const hints = { platform: 'manual', id: 'some-md5-hash-123abc' };
    assert.equal(extractEpicId(hints), null);
    assert.equal(extractSteamId(hints), null);
});

test('platform/id pre-lookup: epic id not double-stripped', () => {
    // allIds.epic is already clean — no double-stripping
    const hints = { allIds: { epic: 'a-hex-namespace-0123456789' } };
    assert.equal(extractEpicId(hints), 'a-hex-namespace-0123456789');
});
