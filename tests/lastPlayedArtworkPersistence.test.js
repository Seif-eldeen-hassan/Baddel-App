'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const GAME_CARD_JS = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'app', 'game-card.js'), 'utf8');
const ARTWORK_SYNC_JS = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'app', 'artwork-sync.js'), 'utf8');
const { resolveGameSurfaceArtwork } = require('../src/features/games/application/services/GameSurfaceArtworkAdapter');
const { projectCanonicalArtwork } = require('../src/features/games/application/services/CanonicalArtworkProjection');

function fnBlock(src, name, nextName) {
    const start = src.indexOf(`function ${name}`);
    assert.ok(start !== -1, `${name} must exist`);
    const end = nextName ? src.indexOf(`\nfunction ${nextName}`, start) : -1;
    return src.slice(start, end > start ? end : start + 4000);
}

test('Last Played card keeps independent cover and hero values', () => {
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

test('Last Played display helper is hero-first, with cover only as fallback', () => {
    const block = fnBlock(GAME_CARD_JS, '_getRecentDisplayImage', 'createRecentCard');
    const posterIdx = block.indexOf('_getRecentPosterFallback');
    const heroIdx = block.indexOf('_getRecentHeroCandidate');
    assert.ok(posterIdx !== -1);
    assert.ok(heroIdx !== -1);
    assert.ok(heroIdx < posterIdx);
});

test('Last Played display helper rejects unusable hero before cover fallback', () => {
    const block = fnBlock(GAME_CARD_JS, '_getRecentDisplayImage', 'createRecentCard');
    assert.match(block, /isUsableArtworkValue\(cover\)/);
    assert.match(block, /isUsableArtworkValue\(hero\)/);
    assert.ok(block.indexOf('isUsableArtworkValue(hero)') < block.indexOf('isUsableArtworkValue(cover)'));
});

test('Last Played canonical V2 projection supplies hero when legacy aliases are stale', () => {
    const runtime = { id: 'runtime-g1', installedId: 'g1', image: null, heroImage: null };
    const canonical = {
        id: 'g1',
        image: null,
        heroImage: null,
        artworkState: {
            version: 2,
            cover: { locked: false, overrideValue: null, fallbackValue: null, revision: 1 },
            hero: { locked: true, overrideValue: 'file://hero.webp', overrideSource: 'creator', revision: 2 },
            logo: { locked: false, overrideValue: null, fallbackValue: null, revision: 0 },
        },
    };

    const projected = projectCanonicalArtwork(runtime, canonical, { matchReason: 'installed-id' });
    const resolved = resolveGameSurfaceArtwork({ surface: 'jump-back-in', game: projected });
    assert.equal(resolved.cover.value, null);
    assert.equal(resolved.hero.value, 'file://hero.webp');
});

test('createRecentCard hydrates hero in the background without replacing an existing cover', () => {
    const block = fnBlock(GAME_CARD_JS, 'createRecentCard', 'getPlatformClass');
    assert.match(block, /_jbiResolveArtworkSelection\(displayGame\)/);
    assert.match(block, /selection\.selectedType === 'hero'/);
    assert.match(block, /hydrateRecentHeroArtwork\(game,\s*imgEl\)/);
    assert.match(block, /refreshed\.selectedType === 'hero'/);
    assert.match(block, /imgEl\.onerror/);
    assert.match(block, /jbiCandidateIndex/);
});

test('Last Played canonicalization uses the canonical registry, not allGamesData', () => {
    const block = fnBlock(GAME_CARD_JS, '_canonicalizeRecentGame', '_getRecentDisplayImage');
    assert.match(block, /window\.__baddelCanonicalGames/);
    assert.doesNotMatch(block, /window\.allGamesData/);
});

test('Last Played projection selects local V2 record when synced display id differs', () => {
    const runtime = {
        id: 'epic:FallGuys',
        installedId: 'local-fall-guys',
        appName: 'FallGuys',
        image: null,
        heroImage: null,
    };
    const canonical = {
        id: 'local-fall-guys',
        appName: 'FallGuys',
        image: null,
        heroImage: null,
        artworkState: {
            version: 2,
            cover: { locked: false, overrideValue: null, fallbackValue: null, revision: 0 },
            hero: { locked: true, overrideValue: 'file://fall-guys-hero.webp', overrideSource: 'creator', revision: 4 },
            logo: { locked: false, overrideValue: null, fallbackValue: null, revision: 0 },
        },
    };

    const projected = projectCanonicalArtwork(runtime, canonical, { matchReason: 'installedId' });
    const resolved = resolveGameSurfaceArtwork({ surface: 'jump-back-in', game: projected });
    assert.equal(projected.id, 'epic:FallGuys');
    assert.equal(projected.localGameId, 'local-fall-guys');
    assert.equal(resolved.cover.value, null);
    assert.equal(resolved.hero.value, 'file://fall-guys-hero.webp');
});

test('Last Played source has a single candidate pipeline and advances hero to cover to placeholder', () => {
    assert.match(GAME_CARD_JS, /function _jbiUniqueUsableCandidates/);
    assert.match(GAME_CARD_JS, /const candidates = _jbiUniqueUsableCandidates\(\[hero, cover\]\)/);
    assert.match(GAME_CARD_JS, /candidates\.push\(placeholder\)/);
    assert.match(GAME_CARD_JS, /\+\+jbiCandidateIndex/);
    assert.match(GAME_CARD_JS, /_jbiCacheBackedArtworkValue\(selection\.candidates\[jbiCandidateIndex\]\)/);
    assert.doesNotMatch(fnBlock(GAME_CARD_JS, 'createRecentCard', 'getPlatformClass'), /const recentHero|const recentPoster/);
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

test('changing Settings artwork commits through coordinator without forcing surface rerenders', () => {
    const settings = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'addGameModal.js'), 'utf8');
    const start = settings.indexOf('async function saveGameSettings');
    const body = settings.slice(start, start + 14000);
    assert.match(body, /__baddelCommitCanonicalGameUpdate\(\{\s*canonicalGame:\s*canonicalSavedGame,/);
    assert.match(body, /changedTypes:\s*_changedTypes/);
    assert.doesNotMatch(body, /renderRecentlyPlayed\(\)/);
    assert.doesNotMatch(body, /updateHeroSection\(currentHeroGameId\)/);
    assert.doesNotMatch(body, /applyFilters\(\)/);
    assert.match(ARTWORK_SYNC_JS, /if \(window\._vs\?\.cardCache instanceof Map\)\s+window\._vs\.cardCache\.clear\(\)/);
});
