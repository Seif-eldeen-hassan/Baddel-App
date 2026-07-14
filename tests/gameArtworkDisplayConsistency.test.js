'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function readRepoFile(...parts) {
    return fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
}

function explicit(value, source, updatedAt = 0) {
    return value ? { value, source, locked: source === 'settings' || source === 'creator', updatedAt } : null;
}

function canonicalArtwork(game, custom = {}, metadata = {}, cache = {}) {
    const byType = (type) => {
        const settingsKey = `${type}Settings`;
        const creatorKey = `${type}Creator`;
        const dbKeys = {
            cover: ['image', 'cover', 'coverUrl', 'defaultImage', 'posterImage'],
            hero: ['heroImage', 'hero', 'heroUrl', 'defaultHero'],
            logo: ['logo', 'logoUrl', 'defaultLogo'],
        }[type];
        const metaKeys = {
            cover: ['cover', 'image', 'defaultImage', 'coverUrl'],
            hero: ['hero', 'heroImage', 'defaultHero', 'heroUrl'],
            logo: ['logo', 'defaultLogo', 'logoUrl'],
        }[type];

        const candidates = [
            explicit(game[settingsKey], 'settings', game.settingsUpdatedAt || 0),
            explicit(custom[creatorKey], 'creator', custom.updatedAt || 0),
            explicit(dbKeys.map((key) => game[key]).find(Boolean), 'database', game.artworkUpdatedAt || 0),
            explicit(metaKeys.map((key) => metadata[key]).find(Boolean), 'server', metadata.updatedAt || 0),
            explicit(cache[type], 'cache', 0),
        ];

        return candidates.find((candidate) => {
            if (!candidate) return false;
            return candidate.source !== 'cache';
        }) || explicit('placeholder://artwork', 'placeholder', 0);
    };

    return {
        cover: byType('cover'),
        hero: byType('hero'),
        logo: byType('logo'),
    };
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

    assert.equal(cacheOnly.source, 'placeholder');
    assert.equal(authoritative.value, 'file://db-cover.webp');
});

test('source guard: All Games currently chooses poster art from its own alias order', () => {
    const src = readRepoFile('src', 'js', 'app', 'artwork-sync.js');
    const fnStart = src.indexOf('function getPosterUrl');
    assert.ok(fnStart !== -1, 'getPosterUrl must exist');
    const fnBody = src.slice(fnStart, fnStart + 700);

    assert.match(fnBody, /game\.image/);
    assert.match(fnBody, /game\.defaultImage/);
    assert.match(fnBody, /game\.coverUrl/);
    assert.match(fnBody, /game\.heroImage/);
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

test('source guard: Play Launcher currently has its own artwork fallback list', () => {
    const src = readRepoFile('src', 'js', 'play-launcher.js');
    const heroIdx = src.indexOf('const hero = _plFirstAsset');
    const logoIdx = src.indexOf('const logo = _plFirstAsset');
    assert.ok(heroIdx !== -1, 'hero _plFirstAsset call must exist');
    assert.ok(logoIdx !== -1, 'logo _plFirstAsset call must exist');

    const heroBody = src.slice(heroIdx, heroIdx + 900);
    const logoBody = src.slice(logoIdx, logoIdx + 500);

    assert.match(heroBody, /game\?\.heroImage/);
    assert.match(heroBody, /fullMeta/);
    assert.match(heroBody, /cachedHero/);
    assert.match(heroBody, /game\?\.image/);
    assert.match(logoBody, /game\?\.logo/);
    assert.match(logoBody, /cachedLogo/);
});
