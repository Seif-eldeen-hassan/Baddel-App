'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const GAME_CARD_JS = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'app', 'game-card.js'), 'utf8');
const ARTWORK_SYNC_JS = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'app', 'artwork-sync.js'), 'utf8');
const { resolveGameSurfaceArtwork } = require('../src/features/games/application/services/GameSurfaceArtworkAdapter');

function fnBlock(src, name, nextName) {
    const start = src.indexOf(`function ${name}`);
    assert.ok(start !== -1, `${name} must exist`);
    const end = nextName ? src.indexOf(`\nfunction ${nextName}`, start) : -1;
    return src.slice(start, end > start ? end : start + 4000);
}

test('Last Played card resolves the Settings-selected cover as its display image', () => {
    const game = {
        id: 'g1',
        image: 'file://settings-cover.webp',
        heroImage: 'file://metadata-hero.webp',
        customArtworkLocked: true,
        artworkSource: 'settings',
        artworkUpdatedAt: Date.now(),
    };
    const resolved = resolveGameSurfaceArtwork({ surface: 'jump-back-in', game });
    assert.equal(resolved.cover.value, 'file://settings-cover.webp');
    assert.equal(resolved.hero.value, 'file://metadata-hero.webp');
});

test('Last Played display helper is cover-first, with hero only as fallback', () => {
    const block = fnBlock(GAME_CARD_JS, '_getRecentDisplayImage', 'createRecentCard');
    const posterIdx = block.indexOf('_getRecentPosterFallback');
    const heroIdx = block.indexOf('_getRecentHeroCandidate');
    assert.ok(posterIdx !== -1);
    assert.ok(heroIdx !== -1);
    assert.ok(posterIdx < heroIdx);
});

test('createRecentCard hydrates hero in the background without replacing an existing cover', () => {
    const block = fnBlock(GAME_CARD_JS, 'createRecentCard', 'getPlatformClass');
    const posterBranch = block.indexOf('if (recentPoster)');
    const heroBranch = block.indexOf('} else if (recentHero)');
    assert.ok(posterBranch !== -1);
    assert.ok(heroBranch !== -1);
    assert.ok(posterBranch < heroBranch);
    assert.match(block, /hydrateRecentHeroArtwork\(game,\s*imgEl\)/);
});

test('hydrateRecentHeroArtwork updates hero cache but does not assign hero over imgEl.src', () => {
    const block = fnBlock(ARTWORK_SYNC_JS, 'hydrateRecentHeroArtwork');
    assert.match(block, /localStorage\.setItem\('hero_'/);
    assert.doesNotMatch(block, /imgEl\.src\s*=\s*safeImageUrl\(hero\)/);
    assert.match(block, /shouldApplyHydratedArtwork/);
});

test('delayed hydration re-checks ownership timestamp before applying or saving', () => {
    const block = fnBlock(ARTWORK_SYNC_JS, 'hydrateRecentHeroArtwork');
    assert.match(block, /const expectedUpdatedAt = game\.artworkUpdatedAt \|\| null/);
    assert.match(block, /shouldApplyHydratedArtwork\(\{ game, type: 'hero', expectedUpdatedAt \}\)/);
    assert.match(ARTWORK_SYNC_JS, /current\.artworkUpdatedAt !== expectedUpdatedAt/);
});

test('stale localStorage cover cannot be the Last Played winner over persisted Settings cover', () => {
    const game = {
        id: 'g1',
        image: 'file://settings-cover.webp',
        coverUrl: 'file://settings-cover.webp',
        defaultImage: 'file://settings-cover.webp',
        customArtworkLocked: true,
        artworkSource: 'settings',
    };
    const resolved = resolveGameSurfaceArtwork({
        surface: 'jump-back-in',
        game,
        cacheArtwork: { cover: 'file://stale-local-storage.webp' },
    });
    assert.equal(resolved.cover.value, 'file://settings-cover.webp');
});

test('changing Settings cover refresh paths remain wired for Last Played and Home surfaces', () => {
    const settings = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'addGameModal.js'), 'utf8');
    assert.match(settings, /refreshAllViews\(\)/);
    assert.match(settings, /__baddelApplyGameCustomOverride/);
    assert.match(settings, /_patch\.artworkSource\s*=\s*'settings'/);
    assert.match(ARTWORK_SYNC_JS, /if \(window\._vs\?\.cardCache instanceof Map\)\s+window\._vs\.cardCache\.clear\(\)/);
});
