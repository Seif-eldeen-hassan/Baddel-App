'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    resolveAllGamesArtwork,
    legacyAllGamesCover,
} = require('../src/features/games/application/services/AllGamesArtworkAdapter');

const ROOT = path.join(__dirname, '..');

function read(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

test('All Games adapter calls the real GameArtworkResolver path', () => {
    const src = read('src/features/games/application/services/AllGamesArtworkAdapter.js');
    assert.match(src, /GameArtworkResolver/);
    assert.match(src, /resolveGameArtwork/);
});

test('Settings cover beats stale Creator cover', () => {
    const result = resolveAllGamesArtwork({
        game: { id: 'g1' },
        settingsArtwork: { cover: { value: 'file://settings.webp', updatedAt: 20 } },
        creatorArtwork: { cover: { value: 'file://creator.webp', updatedAt: 10 } },
    });
    assert.equal(result.value, 'file://settings.webp');
    assert.equal(result.source, 'settings');
});

test('Creator cover beats metadata and cache when no Settings cover exists', () => {
    const result = resolveAllGamesArtwork({
        game: { id: 'g1' },
        creatorArtwork: { cover: 'file://creator.webp' },
        metadataArtwork: { cover: 'file://metadata.webp', verified: true, confidence: 1 },
        cacheArtwork: { cover: 'file://cache.webp' },
    });
    assert.equal(result.value, 'file://creator.webp');
    assert.equal(result.source, 'creator');
});

test('Database canonical cover beats metadata and cache', () => {
    const result = resolveAllGamesArtwork({
        game: { id: 'g1', image: 'file://database.webp' },
        metadataArtwork: { cover: 'file://metadata.webp', verified: true, confidence: 1 },
        cacheArtwork: { cover: 'file://cache.webp' },
    });
    assert.equal(result.value, 'file://database.webp');
    assert.equal(result.source, 'database');
});

test('Verified platform artwork fills a missing canonical cover', () => {
    const result = resolveAllGamesArtwork({
        game: { id: 'g1', platform: 'steam', appId: '10' },
        platformArtwork: { cover: 'file://platform.webp', verified: true, identity: { appId: '10' } },
        metadataArtwork: { cover: 'file://metadata.webp', verified: true, confidence: 1 },
    });
    assert.equal(result.value, 'file://platform.webp');
    assert.equal(result.source, 'platform');
});

test('Verified high-confidence metadata fills missing artwork', () => {
    const result = resolveAllGamesArtwork({
        game: { id: 'g1' },
        metadataArtwork: { cover: 'file://metadata.webp', verified: true, confidence: 0.9 },
    });
    assert.equal(result.value, 'file://metadata.webp');
    assert.equal(result.source, 'metadata');
});

test('Unverified low-confidence metadata does not displace a valid canonical candidate', () => {
    const result = resolveAllGamesArtwork({
        game: { id: 'g1', coverUrl: 'file://canonical.webp' },
        metadataArtwork: { cover: 'file://metadata.webp', verified: false, confidence: 0.2 },
    });
    assert.equal(result.value, 'file://canonical.webp');
    assert.equal(result.source, 'database');
});

test('localStorage-style cache cannot independently beat Settings', () => {
    const result = resolveAllGamesArtwork({
        game: { id: 'g1' },
        settingsArtwork: { cover: 'file://settings.webp' },
        cacheArtwork: { cover: 'file://cover_g1_from_localstorage.webp' },
    });
    assert.equal(result.value, 'file://settings.webp');
    assert.equal(result.source, 'settings');
});

test('disk cache cannot independently beat Creator', () => {
    const result = resolveAllGamesArtwork({
        game: { id: 'g1' },
        creatorArtwork: { cover: 'file://creator.webp' },
        cacheArtwork: { cover: 'file://disk-cache.webp' },
    });
    assert.equal(result.value, 'file://creator.webp');
    assert.equal(result.source, 'creator');
});

test('cached representation preserves authoritative source where supported', () => {
    const result = resolveAllGamesArtwork({
        game: { id: 'g1' },
        metadataArtwork: { cover: 'https://cdn.example/cover.jpg', verified: true, confidence: 1 },
        cacheArtwork: { cover: { value: 'file://cached-cover.webp', representsSource: 'metadata' } },
    });
    assert.equal(result.value, 'file://cached-cover.webp');
    assert.equal(result.source, 'metadata');
    assert.match(result.reason, /cache representation/);
});

test('legacy image, cover, coverUrl, defaultImage, and posterImage aliases remain supported', () => {
    assert.equal(resolveAllGamesArtwork({ game: { image: 'file://image.webp' } }).value, 'file://image.webp');
    assert.equal(resolveAllGamesArtwork({ game: { cover: 'file://cover.webp' } }).value, 'file://cover.webp');
    assert.equal(resolveAllGamesArtwork({ game: { coverUrl: 'file://cover-url.webp' } }).value, 'file://cover-url.webp');
    assert.equal(resolveAllGamesArtwork({ game: { defaultImage: 'file://default.webp' } }).value, 'file://default.webp');
    assert.equal(resolveAllGamesArtwork({ game: { posterImage: 'file://poster.webp' } }).value, 'file://poster.webp');
});

test('conflicting aliases are resolved deterministically', () => {
    const game = {
        image: 'file://image.webp',
        coverUrl: 'file://cover-url.webp',
        defaultImage: 'file://default.webp',
    };
    assert.equal(resolveAllGamesArtwork({ game }).value, 'file://image.webp');
    assert.equal(resolveAllGamesArtwork({ game }).value, 'file://image.webp');
});

test('invalid resolver result uses the legacy fallback', () => {
    const result = resolveAllGamesArtwork({
        game: { coverUrl: 'file://legacy.webp' },
        resolver: () => ({ value: '' }),
    });
    assert.equal(result.value, 'file://legacy.webp');
    assert.equal(result.usedFallback, true);
});

test('missing artwork uses the existing placeholder-style empty result', () => {
    const result = resolveAllGamesArtwork({ game: {} });
    assert.equal(result.value, null);
    assert.equal(result.source, 'placeholder');
});

test('input game object is not mutated', () => {
    const game = Object.freeze({
        id: 'g1',
        image: 'file://image.webp',
        coverUrl: 'file://cover-url.webp',
        customArtworkLocked: true,
        artworkSource: 'settings',
    });
    const before = JSON.stringify(game);
    resolveAllGamesArtwork({ game });
    assert.equal(JSON.stringify(game), before);
});

test('adapter performs no database or localStorage writes during selection', () => {
    const src = read('src/features/games/application/services/AllGamesArtworkAdapter.js');
    assert.doesNotMatch(src, /localStorage\.setItem|localStorage\.removeItem|saveMetadata|updateGameMetadata|writeFile|fetch\(/);
});

test('lazy metadata fetch behavior remains reachable for missing artwork', () => {
    const src = read('src/js/app/game-card.js');
    assert.match(src, /fetchMetadata\(imgEl,\s*game\)/);
    assert.match(src, /No image, or image is a remote http/);
});

test('All Games card hydration remains stable and writes resolver diagnostics to dataset only', () => {
    const src = read('src/js/accounts.js');
    assert.match(src, /function _agResolveAllGamesCoverDecision/);
    assert.match(src, /BaddelAllGamesArtworkAdapter/);
    assert.match(src, /card\.dataset\.artworkSource/);
    assert.match(src, /card\.dataset\.artworkReason/);
    assert.doesNotMatch(src.slice(src.indexOf('function _agResolveAllGamesCoverDecision'), src.indexOf('function _vsApplyCoverToCard')), /localStorage\.setItem|saveMetadata|updateGameMetadata/);
});

test('All Games adapter is loaded before artwork-sync/app/accounts scripts in dev and protected build', () => {
    const html = read('src/dashboard.html');
    const protectedBuild = read('scripts/build-protected.js');
    assert.ok(html.indexOf('AllGamesArtworkAdapter.js') < html.indexOf('js/app/artwork-sync.js'));
    assert.ok(html.indexOf('AllGamesArtworkAdapter.js') < html.indexOf('js/accounts.js'));
    assert.ok(protectedBuild.indexOf('AllGamesArtworkAdapter.js') < protectedBuild.indexOf("S('src/js/app/artwork-sync.js')"));
});

test('Game Details and Play Launcher still do not import or use the resolver in this phase', () => {
    assert.doesNotMatch(read('src/js/game-details.js'), /BaddelAllGamesArtworkAdapter|BaddelGameArtworkResolver|GameArtworkResolver|ArtworkOwnershipPolicy/);
    assert.doesNotMatch(read('src/js/play-launcher.js'), /BaddelAllGamesArtworkAdapter|BaddelGameArtworkResolver|GameArtworkResolver|ArtworkOwnershipPolicy/);
});

test('legacyAllGamesCover preserves old fallback order', () => {
    assert.equal(legacyAllGamesCover({
        image: null,
        cover: 'file://cover.webp',
        coverUrl: 'file://cover-url.webp',
        defaultImage: 'file://default.webp',
    }), 'file://cover-url.webp');
});
