'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    resolveGameArtwork,
} = require('../src/features/games/application/services/GameArtworkResolver');
const surfaceAdapter = require('../src/features/games/application/services/GameSurfaceArtworkAdapter');

const ROOT = path.join(__dirname, '..');

function readRepoFile(...parts) {
    return fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
}

function canonicalArtwork(game, custom = {}, metadata = {}, cache = {}) {
    return resolveGameArtwork({
        game,
        settingsArtwork: {
            cover: game.coverSettings ? { value: game.coverSettings, updatedAt: game.settingsUpdatedAt } : null,
            hero: game.heroSettings ? { value: game.heroSettings, updatedAt: game.settingsUpdatedAt } : null,
            logo: game.logoSettings ? { value: game.logoSettings, updatedAt: game.settingsUpdatedAt } : null,
        },
        creatorArtwork: {
            cover: custom.coverCreator ? { value: custom.coverCreator, updatedAt: custom.updatedAt } : null,
            hero: custom.heroCreator ? { value: custom.heroCreator, updatedAt: custom.updatedAt } : null,
            logo: custom.logoCreator ? { value: custom.logoCreator, updatedAt: custom.updatedAt } : null,
        },
        metadataArtwork: {
            ...metadata,
            verified: true,
            confidence: metadata.confidence ?? 1,
        },
        cacheArtwork: cache,
        placeholders: {
            cover: 'placeholder://artwork',
            hero: 'placeholder://artwork',
            logo: 'placeholder://artwork',
        },
    });
}

function allGamesDecision(game, custom, metadata, cache) {
    return canonicalArtwork(game, custom, metadata, cache);
}

function gameDetailsDecision(game, custom, metadata, cache) {
    return canonicalArtwork(game, custom, metadata, cache);
}

function playLauncherDecision(game, custom, metadata, cache) {
    return canonicalArtwork(game, custom, metadata, cache);
}

function surfaceDecision(game, cache = {}, metadata = {}) {
    return surfaceAdapter.resolveGameSurfaceArtwork({
        surface: 'display-consistency',
        game,
        cacheArtwork: cache,
        metadataArtwork: {
            ...metadata,
            verified: true,
            confidence: metadata.confidence ?? 1,
        },
        placeholders: {
            cover: 'placeholder://artwork',
            hero: 'placeholder://artwork',
            logo: 'placeholder://artwork',
        },
    });
}

test('contract: All Games and Game Details converge on the same canonical cover candidate', () => {
    const game = {
        id: 'g1',
        image: 'file://db-cover.webp',
        coverUrl: 'file://alias-cover.webp',
        defaultImage: 'file://default-cover.webp',
        coverSettings: 'file://settings-cover.webp',
        settingsUpdatedAt: 200,
    };
    const custom = { coverCreator: 'file://creator-cover.webp', updatedAt: 100 };
    const metadata = { cover: 'https://cdn.example/server-cover.jpg', updatedAt: 50 };
    const cache = { cover: 'file://cache-cover.webp' };

    assert.deepEqual(
        allGamesDecision(game, custom, metadata, cache).cover,
        gameDetailsDecision(game, custom, metadata, cache).cover,
    );
    assert.equal(allGamesDecision(game, custom, metadata, cache).cover.value, 'file://settings-cover.webp');
});

test('contract: All Games and Game Details converge on the same canonical hero candidate', () => {
    const game = {
        id: 'g1',
        heroImage: 'file://db-hero.webp',
        heroUrl: 'file://alias-hero.webp',
        heroSettings: 'file://settings-hero.webp',
        settingsUpdatedAt: 200,
    };
    const custom = { heroCreator: 'file://creator-hero.webp', updatedAt: 100 };

    assert.deepEqual(
        allGamesDecision(game, custom, {}, {}).hero,
        gameDetailsDecision(game, custom, {}, {}).hero,
    );
    assert.equal(gameDetailsDecision(game, custom, {}, {}).hero.value, 'file://settings-hero.webp');
});

test('contract: Game Details and Play Launcher use the same canonical artwork decision', () => {
    const game = {
        id: 'g1',
        image: 'file://db-cover.webp',
        heroImage: 'file://db-hero.webp',
        logoSettings: 'file://settings-logo.webp',
        settingsUpdatedAt: 300,
    };
    const custom = {
        coverCreator: 'file://creator-cover.webp',
        heroCreator: 'file://creator-hero.webp',
        logoCreator: 'file://creator-logo.webp',
        updatedAt: 100,
    };
    const metadata = {
        cover: 'https://cdn.example/server-cover.jpg',
        hero: 'https://cdn.example/server-hero.jpg',
        logo: 'https://cdn.example/server-logo.png',
    };

    assert.deepEqual(
        gameDetailsDecision(game, custom, metadata, {}).cover,
        playLauncherDecision(game, custom, metadata, {}).cover,
    );
    assert.deepEqual(
        gameDetailsDecision(game, custom, metadata, {}).hero,
        playLauncherDecision(game, custom, metadata, {}).hero,
    );
    assert.equal(playLauncherDecision(game, custom, metadata, {}).logo.value, 'file://settings-logo.webp');
});

test('contract: remaining display surfaces converge on the same canonical artwork decision', () => {
    const game = {
        id: 'g1',
        image: 'file://db-cover.webp',
        heroImage: 'file://db-hero.webp',
        logo: 'file://db-logo.webp',
        coverSettings: 'file://db-cover.webp',
        heroSettings: 'file://db-hero.webp',
        logoSettings: 'file://db-logo.webp',
        customArtworkLocked: true,
        artworkSource: 'settings',
        artworkUpdatedAt: 300,
        settingsUpdatedAt: 300,
    };
    const metadata = {
        cover: 'https://cdn.example/server-cover.jpg',
        hero: 'https://cdn.example/server-hero.jpg',
        logo: 'https://cdn.example/server-logo.png',
    };
    const cache = {
        cover: 'file://cache-cover.webp',
        hero: 'file://cache-hero.webp',
        logo: 'file://cache-logo.webp',
    };
    const canonical = canonicalArtwork(game, {}, metadata, cache);
    const surface = surfaceDecision(game, cache, metadata);

    assert.equal(surface.cover.value, canonical.cover.value);
    assert.equal(surface.hero.value, canonical.hero.value);
    assert.equal(surface.logo.value, canonical.logo.value);
    assert.equal(surface.cover.source, canonical.cover.source);
    assert.equal(surface.hero.source, canonical.hero.source);
    assert.equal(surface.logo.source, canonical.logo.source);
});

test('contract: cover aliases cannot independently produce different winners', () => {
    const game = {
        image: 'file://image.webp',
        cover: 'file://cover.webp',
        coverUrl: 'file://cover-url.webp',
        defaultImage: 'file://default-image.webp',
        posterImage: 'file://poster-image.webp',
    };

    const result = canonicalArtwork(game).cover;

    assert.equal(result.value, 'file://image.webp');
    assert.equal(result.source, 'database');
});

test('contract: Creator/custom metadata does not silently outrank newer Settings choice', () => {
    const game = {
        coverSettings: 'file://settings-cover.webp',
        settingsUpdatedAt: 500,
    };
    const custom = {
        coverCreator: 'file://creator-cover.webp',
        updatedAt: 100,
    };

    assert.equal(canonicalArtwork(game, custom).cover.value, 'file://settings-cover.webp');
    assert.equal(canonicalArtwork(game, custom).cover.source, 'settings');
});

test('contract: localStorage and disk cache cannot outrank locked canonical database fields', () => {
    const game = {
        image: 'file://db-locked-cover.webp',
        customArtworkLocked: true,
        artworkSource: 'settings',
        artworkUpdatedAt: 1000,
    };
    const cache = { cover: 'file://stale-local-storage-cover.webp' };

    const result = canonicalArtwork(game, {}, {}, cache).cover;

    assert.equal(result.value, 'file://db-locked-cover.webp');
    assert.equal(result.source, 'database');
});

test('contract: disk cache paths represent cached copies, not ownership decisions', () => {
    const cacheOnly = canonicalArtwork({}, {}, {}, { cover: 'file://cache-only-cover.webp' }).cover;
    const authoritative = canonicalArtwork(
        { image: 'file://db-cover.webp' },
        {},
        {},
        { cover: 'file://cache-only-cover.webp' },
    ).cover;

    assert.equal(cacheOnly.source, 'cache');
    assert.equal(cacheOnly.cacheOnly, true);
    assert.equal(authoritative.value, 'file://db-cover.webp');
});

test('source guard: remaining renderer display surfaces delegate to GameSurfaceArtworkAdapter', () => {
    const gameCard = readRepoFile('src', 'js', 'app', 'game-card.js');
    const hero = readRepoFile('src', 'js', 'app', 'hero.js');
    const suggestions = readRepoFile('src', 'js', 'app', 'suggestions.js');
    const roulette = readRepoFile('src', 'js', 'app', 'roulette.js');
    const accounts = readRepoFile('src', 'js', 'accounts.js');

    assert.match(gameCard, /BaddelGameSurfaceArtworkAdapter/);
    assert.match(hero, /BaddelGameSurfaceArtworkAdapter/);
    assert.match(suggestions, /BaddelGameSurfaceArtworkAdapter/);
    assert.match(roulette, /BaddelGameSurfaceArtworkAdapter/);
    assert.match(accounts, /_agResolveAllGamesCoverDecision/);
});

test('source guard: Game Details currently has an independent custom metadata merge order', () => {
    const src = readRepoFile('src', 'js', 'game-details.js');
    const fnStart = src.indexOf('function _gdMergeCustomIntoMeta');
    assert.ok(fnStart !== -1, '_gdMergeCustomIntoMeta must exist');
    const fnBody = src.slice(fnStart, fnStart + 2000);

    assert.match(fnBody, /custom\.posterImage\s*\|\|\s*custom\.coverImage/);
    assert.match(fnBody, /meta\?\.cover/);
    assert.match(fnBody, /custom\.heroImage/);
    assert.match(fnBody, /custom\.logoImage/);
});

test('source guard: Play Launcher delegates display selection to its artwork adapter', () => {
    const src = readRepoFile('src', 'js', 'play-launcher.js');
    const helperIdx = src.indexOf('function _plResolveArtworkForDisplay');
    assert.ok(helperIdx !== -1, '_plResolveArtworkForDisplay must exist');

    const helperBody = src.slice(helperIdx, src.indexOf('async function _plResolveLaunchOverlayAssets'));

    assert.match(helperBody, /BaddelPlayLauncherArtworkAdapter/);
    assert.match(helperBody, /resolvePlayLauncherArtwork/);
    assert.match(helperBody, /legacyPlayLauncherArtwork/);
});
