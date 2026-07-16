'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const adapter = require('../src/features/games/application/services/GameSurfaceArtworkAdapter');

const ROOT = path.resolve(__dirname, '..');

function read(relPath) {
    return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function extractFn(src, signature) {
    const idx = src.indexOf(signature);
    assert.notEqual(idx, -1, `${signature} must exist`);
    const paramsEnd = src.indexOf(')', idx);
    const braceOpen = src.indexOf('{', paramsEnd);
    let depth = 0;
    for (let i = braceOpen; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') {
            depth--;
            if (depth === 0) return src.slice(idx, i + 1);
        }
    }
    return src.slice(idx);
}

test('GameSurfaceArtworkAdapter calls the canonical resolver and preserves legacy fallback', () => {
    const result = adapter.resolveGameSurfaceArtwork({
        surface: 'home-card',
        game: {
            id: 'g1',
            image: 'file://settings-cover.webp',
            heroImage: 'file://settings-hero.webp',
            logo: 'file://settings-logo.webp',
            customArtworkLocked: true,
            artworkSource: 'settings',
            artworkUpdatedAt: 100,
        },
        cacheArtwork: {
            cover: 'file://cache-cover.webp',
            hero: 'file://cache-hero.webp',
            logo: 'file://cache-logo.webp',
        },
    });

    assert.equal(result.cover.value, 'file://settings-cover.webp');
    assert.equal(result.hero.value, 'file://settings-hero.webp');
    assert.equal(result.logo.value, 'file://settings-logo.webp');
    assert.equal(result.cover.source, 'settings');
    assert.equal(result.cover.fallbackValue, 'file://settings-cover.webp');
});

test('GameSurfaceArtworkAdapter supports surface aliases used by renderer-only displays', () => {
    const cover = adapter.resolveGameSurfaceArtwork({
        game: { capsuleImage: 'file://capsule.webp' },
    }).cover;
    const hero = adapter.resolveGameSurfaceArtwork({
        game: { _rouletteHeroUrl: 'file://roulette-hero.webp' },
    }).hero;

    assert.equal(cover.value, 'file://capsule.webp');
    assert.equal(hero.value, 'file://roulette-hero.webp');
});

test('GameSurfaceArtworkAdapter resolves mixed Artwork State V2 ownership per type', () => {
    const result = adapter.resolveGameSurfaceArtwork({
        surface: 'home-card',
        game: {
            id: 'mixed',
            artworkSource: 'mixed',
            customArtworkLocked: true,
            artworkState: {
                version: 2,
                cover: {
                    locked: true,
                    overrideValue: 'file://settings-cover.webp',
                    overrideSource: 'settings',
                    updatedAt: 10,
                    revision: 2,
                },
                hero: {
                    locked: true,
                    overrideValue: 'file://creator-hero.webp',
                    overrideSource: 'creator',
                    updatedAt: 20,
                    revision: 3,
                },
                logo: {
                    locked: false,
                    fallbackValue: 'file://metadata-logo.webp',
                    fallbackSource: 'metadata',
                    revision: 1,
                },
            },
        },
        metadataArtwork: { logo: 'file://metadata-logo.webp' },
    });

    assert.equal(result.cover.value, 'file://settings-cover.webp');
    assert.equal(result.cover.source, 'settings');
    assert.equal(result.hero.value, 'file://creator-hero.webp');
    assert.equal(result.hero.source, 'creator');
    assert.equal(result.logo.value, 'file://metadata-logo.webp');
});

test('GameSurfaceArtworkAdapter boundary stays pure', () => {
    const src = read('src/features/games/application/services/GameSurfaceArtworkAdapter.js');
    assert.match(src, /require\('\.\/GameArtworkResolver'\)/);
    assert.doesNotMatch(src, /electron|localStorage|fs|repository|platformSync|document|window\.electronAPI|fetch\(/);
});

test('dashboard and protected build load GameSurfaceArtworkAdapter before renderer consumers', () => {
    const html = read('src/dashboard.html');
    const protectedBuild = read('scripts/build-protected.js');

    assert.ok(html.indexOf('GameArtworkResolver.js') < html.indexOf('GameSurfaceArtworkAdapter.js'));
    assert.ok(html.indexOf('GameArtworkState.js') < html.indexOf('GameSurfaceArtworkAdapter.js'));
    assert.ok(html.indexOf('GameSurfaceArtworkAdapter.js') < html.indexOf('js/app/artwork-sync.js'));
    assert.ok(html.indexOf('GameSurfaceArtworkAdapter.js') < html.indexOf('js/app/game-card.js'));
    assert.ok(html.indexOf('GameSurfaceArtworkAdapter.js') < html.indexOf('js/app/hero.js'));
    assert.ok(html.indexOf('GameSurfaceArtworkAdapter.js') < html.indexOf('js/app/suggestions.js'));
    assert.ok(html.indexOf('GameSurfaceArtworkAdapter.js') < html.indexOf('js/app/roulette.js'));
    assert.ok(html.indexOf('GameSurfaceArtworkAdapter.js') < html.indexOf('js/accounts.js'));

    assert.ok(protectedBuild.indexOf('GameArtworkResolver.js') < protectedBuild.indexOf('GameSurfaceArtworkAdapter.js'));
    assert.ok(protectedBuild.indexOf('GameArtworkState.js') < protectedBuild.indexOf('GameSurfaceArtworkAdapter.js'));
    assert.ok(protectedBuild.indexOf('GameSurfaceArtworkAdapter.js') < protectedBuild.indexOf("S('src/js/app/artwork-sync.js')"));
    assert.ok(protectedBuild.indexOf('GameSurfaceArtworkAdapter.js') < protectedBuild.indexOf("S('src/js/app/game-card.js')"));
    assert.ok(protectedBuild.indexOf('GameSurfaceArtworkAdapter.js') < protectedBuild.indexOf("S('src/js/app/hero.js')"));
    assert.ok(protectedBuild.indexOf('GameSurfaceArtworkAdapter.js') < protectedBuild.indexOf("S('src/js/app/suggestions.js')"));
    assert.ok(protectedBuild.indexOf('GameSurfaceArtworkAdapter.js') < protectedBuild.indexOf("S('src/js/app/roulette.js')"));
    assert.ok(protectedBuild.indexOf('GameSurfaceArtworkAdapter.js') < protectedBuild.indexOf("S('src/js/accounts.js')"));
});

test('home card and Jump Back In displays resolve through GameSurfaceArtworkAdapter', () => {
    const src = read('src/js/app/game-card.js');
    const helper = extractFn(src, 'function _surfaceArtwork(');
    const card = extractFn(src, 'function createGameCard(');
    const recentHero = extractFn(src, 'function _getRecentHeroCandidate(');
    const recentPoster = extractFn(src, 'function _getRecentPosterFallback(');

    assert.match(helper, /BaddelGameSurfaceArtworkAdapter/);
    assert.match(helper, /resolveGameSurfaceArtwork/);
    assert.match(card, /_surfaceArtwork\(game,\s*'home-card'/);
    assert.match(recentHero, /_surfaceArtwork\(game,\s*'jump-back-in'\)/);
    assert.match(recentPoster, /_surfaceArtwork\(game,\s*'jump-back-in'\)/);
});

test('home hero and collection member hero displays resolve through GameSurfaceArtworkAdapter', () => {
    const src = read('src/js/app/hero.js');
    assert.match(extractFn(src, 'function _heroSurfaceArtwork('), /BaddelGameSurfaceArtworkAdapter/);
    assert.match(extractFn(src, 'function _homeHeroArtworkFor('), /_heroSurfaceArtwork\(game,\s*'home-hero'\)/);
    assert.match(extractFn(src, 'function updateHeroForCollection('), /_heroSurfaceArtwork\(g,\s*'collection-hero-member'\)/);
});

test('suggestions feature, rail, carousel, and hydration patch displays resolve through GameSurfaceArtworkAdapter', () => {
    const src = read('src/js/app/suggestions.js');
    assert.match(extractFn(src, 'function _suggResolveArtwork('), /BaddelGameSurfaceArtworkAdapter/);
    assert.match(extractFn(src, 'function _renderSyncedFeature('), /_suggResolveArtwork\(g,\s*'suggestions-feature'\)/);
    assert.match(extractFn(src, 'function _renderSyncedRail('), /_suggResolveArtwork\(g,\s*'suggestions-rail'\)/);
    assert.match(extractFn(src, 'function _suggCarouselSlides('), /_suggResolveArtwork\(g,\s*'suggestions-carousel'\)/);
    assert.match(extractFn(src, 'function _suggReRenderOne('), /_suggResolveArtwork\(g,\s*'suggestions-feature-patch'\)/);
    assert.match(extractFn(src, 'function _suggReRenderOne('), /_suggResolveArtwork\(g,\s*'suggestions-rail-patch'\)/);
});

test('roulette preview, final, hero, install pool, and custom pool displays resolve through GameSurfaceArtworkAdapter', () => {
    const src = read('src/js/app/roulette.js');
    assert.match(extractFn(src, 'function _rouletteResolveArtwork('), /BaddelGameSurfaceArtworkAdapter/);
    assert.match(extractFn(src, 'function _buildInstallPool('), /_rouletteResolveArtwork\(g,\s*'roulette-install-pool'\)/);
    assert.match(extractFn(src, 'function _roulettePosterPick('), /_rouletteResolveArtwork\(game,\s*mode === 'install' \? 'roulette-install-poster' : 'roulette-play-poster'\)/);
    assert.match(extractFn(src, 'function _rouletteHeroUrl('), /_rouletteResolveArtwork\(game,\s*'roulette-hero'\)/);
    assert.match(extractFn(src, 'function openRoulettePool('), /_rouletteResolveArtwork\(g,\s*'roulette-custom-pool'\)/);
});

test('all games list and installed list displays use the existing all-games resolver decision helper', () => {
    const src = read('src/js/accounts.js');
    const allGamesListIdx = src.indexOf('function _renderAllGamesList');
    const installedListIdx = src.indexOf('function _renderInstalledGamesList');
    assert.notEqual(allGamesListIdx, -1, 'renderAllGamesList must exist');
    assert.notEqual(installedListIdx, -1, 'renderInstalledGames must exist');
    assert.match(src.slice(allGamesListIdx, allGamesListIdx + 3600), /_agResolveAllGamesCoverDecision\(game\)/);
    assert.match(src.slice(installedListIdx, installedListIdx + 3600), /_agResolveAllGamesCoverDecision\(game\)/);
});

test('Settings, Creator, metadata, IPC, and cache write ownership remain outside this display-only seam', () => {
    const changedRenderer = [
        'src/js/app/game-card.js',
        'src/js/app/hero.js',
        'src/js/app/suggestions.js',
        'src/js/app/roulette.js',
        'src/js/accounts.js',
    ].map(read).join('\n');

    assert.doesNotMatch(changedRenderer, /saveFullMetadata|updateGameMetadata|localStorage\.setItem\([^)]*artworkSource|window\.electronAPI\.saveGameMetadata/);
    assert.doesNotMatch(read('main.js'), /GameSurfaceArtworkAdapter/);
    assert.doesNotMatch(read('preload.js'), /GameSurfaceArtworkAdapter/);
    assert.doesNotMatch(read('src/features/games/infrastructure/repositories/JsonGameRepository.js'), /GameSurfaceArtworkAdapter/);
    assert.doesNotMatch(read('src/features/games/application/useCases/AddManualGameUseCase.js'), /GameSurfaceArtworkAdapter/);
});
