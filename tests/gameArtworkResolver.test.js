'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    normalizeArtworkAliases,
    resolveArtworkType,
    resolveGameArtwork,
} = require('../src/features/games/application/services/GameArtworkResolver');

const ROOT = path.join(__dirname, '..');
const RESOLVER_PATH = path.join(ROOT, 'src', 'features', 'games', 'application', 'services', 'GameArtworkResolver.js');
const POLICY_PATH = path.join(ROOT, 'src', 'features', 'games', 'domain', 'services', 'ArtworkOwnershipPolicy.js');

function read(filePath) {
    return fs.readFileSync(filePath, 'utf8');
}

function candidate(source, value, overrides = {}) {
    return {
        type: overrides.type || 'cover',
        source,
        value,
        verified: overrides.verified ?? (source === 'platform' || source === 'database'),
        confidence: overrides.confidence ?? null,
        updatedAt: overrides.updatedAt ?? null,
        locked: overrides.locked,
        identity: overrides.identity || null,
        cacheOnly: overrides.cacheOnly,
    };
}

test('Settings cover beats Creator cover', () => {
    const result = resolveGameArtwork({
        settingsArtwork: { cover: 'file://settings-cover.webp' },
        creatorArtwork: { cover: 'file://creator-cover.webp' },
    });
    assert.equal(result.cover.value, 'file://settings-cover.webp');
    assert.equal(result.cover.source, 'settings');
});

test('Settings hero beats Creator hero', () => {
    const result = resolveGameArtwork({
        settingsArtwork: { hero: 'file://settings-hero.webp' },
        creatorArtwork: { hero: 'file://creator-hero.webp' },
    });
    assert.equal(result.hero.value, 'file://settings-hero.webp');
    assert.equal(result.hero.source, 'settings');
});

test('Settings logo beats Creator logo', () => {
    const result = resolveGameArtwork({
        settingsArtwork: { logo: 'file://settings-logo.webp' },
        creatorArtwork: { logo: 'file://creator-logo.webp' },
    });
    assert.equal(result.logo.value, 'file://settings-logo.webp');
    assert.equal(result.logo.source, 'settings');
});

test('Creator beats database, platform, metadata, and cache', () => {
    const result = resolveGameArtwork({
        game: { id: 'g1', image: 'file://db.webp', platform: 'steam', appId: '10' },
        creatorArtwork: { cover: 'file://creator.webp' },
        platformArtwork: { cover: 'file://platform.webp', verified: true, identity: { appId: '10' } },
        metadataArtwork: { cover: 'file://meta.webp', verified: true, confidence: 0.95 },
        cacheArtwork: { cover: 'file://cache.webp' },
    });
    assert.equal(result.cover.value, 'file://creator.webp');
    assert.equal(result.cover.source, 'creator');
});

test('Database canonical artwork beats lower sources', () => {
    const result = resolveGameArtwork({
        game: { id: 'g1', image: 'file://db.webp' },
        metadataArtwork: { cover: 'file://meta.webp', verified: true, confidence: 1 },
        cacheArtwork: { cover: 'file://cache.webp' },
    });
    assert.equal(result.cover.value, 'file://db.webp');
    assert.equal(result.cover.source, 'database');
});

test('Verified platform artwork beats metadata and cache', () => {
    const result = resolveGameArtwork({
        game: { id: 'g1', platform: 'steam', appId: '10' },
        platformArtwork: { cover: 'file://platform.webp', verified: true, identity: { platform: 'steam', appId: '10' } },
        metadataArtwork: { cover: 'file://meta.webp', verified: true, confidence: 1 },
        cacheArtwork: { cover: 'file://cache.webp' },
    });
    assert.equal(result.cover.source, 'platform');
});

test('Unverified platform candidate cannot beat verified metadata', () => {
    const result = resolveGameArtwork({
        game: { id: 'g1', platform: 'steam', appId: '10' },
        platformArtwork: { cover: 'file://platform.webp', verified: false, identity: { appId: '10' } },
        metadataArtwork: { cover: 'file://meta.webp', verified: true, confidence: 0.9 },
    });
    assert.equal(result.cover.value, 'file://meta.webp');
    assert.equal(result.cover.source, 'metadata');
});

test('High-confidence verified metadata beats cache', () => {
    const result = resolveGameArtwork({
        metadataArtwork: { cover: 'file://meta.webp', verified: true, confidence: 0.85 },
        cacheArtwork: { cover: 'file://cache.webp' },
    });
    assert.equal(result.cover.source, 'metadata');
});

test('Low-confidence metadata is rejected below valid fallback', () => {
    const result = resolveGameArtwork({
        metadataArtwork: { cover: 'file://low.webp', verified: false, confidence: 0.3 },
        placeholders: { cover: 'placeholder://cover' },
    });
    assert.equal(result.cover.value, 'placeholder://cover');
    assert.equal(result.cover.source, 'placeholder');
});

test('Cache-only candidate does not establish ownership over placeholder fallback', () => {
    const result = resolveGameArtwork({
        cacheArtwork: { cover: 'file://cache.webp' },
        placeholders: { cover: 'placeholder://cover' },
    });
    assert.equal(result.cover.source, 'cache');
    assert.equal(result.cover.cacheOnly, true);
});

test('Cache path can represent an already-selected authoritative candidate without changing source', () => {
    const result = resolveGameArtwork({
        metadataArtwork: { cover: 'https://cdn.example/meta.jpg', verified: true, confidence: 1 },
        cacheArtwork: { cover: { value: 'file://cache/meta.webp', representsSource: 'metadata' } },
    });
    assert.equal(result.cover.value, 'file://cache/meta.webp');
    assert.equal(result.cover.source, 'metadata');
    assert.match(result.cover.reason, /cache representation/);
});

test('Placeholder is last', () => {
    const result = resolveGameArtwork({ placeholders: { cover: 'placeholder://cover' } });
    assert.equal(result.cover.source, 'placeholder');
});

test('Locked Settings survives force-like lower candidate', () => {
    const result = resolveArtworkType({
        type: 'cover',
        candidates: [
            candidate('settings', 'file://settings.webp', { locked: true }),
            candidate('metadata', 'file://forced.webp', { verified: true, confidence: 1, force: true }),
        ],
    });
    assert.equal(result.value, 'file://settings.webp');
    assert.equal(result.locked, true);
});

test('Locked Creator survives platform/pipeline candidate', () => {
    const result = resolveArtworkType({
        type: 'cover',
        candidates: [
            candidate('creator', 'file://creator.webp', { locked: true }),
            candidate('platform', 'file://platform.webp', { verified: true }),
        ],
    });
    assert.equal(result.value, 'file://creator.webp');
});

test('Newer timestamp wins within the same source tier', () => {
    const result = resolveArtworkType({
        type: 'cover',
        candidates: [
            candidate('creator', 'file://old.webp', { updatedAt: 1 }),
            candidate('creator', 'file://new.webp', { updatedAt: 2 }),
        ],
    });
    assert.equal(result.value, 'file://new.webp');
});

test('Timestamp cannot move metadata above Settings', () => {
    const result = resolveArtworkType({
        type: 'cover',
        candidates: [
            candidate('settings', 'file://settings.webp', { updatedAt: 1 }),
            candidate('metadata', 'file://meta.webp', { verified: true, confidence: 1, updatedAt: 999 }),
        ],
    });
    assert.equal(result.source, 'settings');
});

test('Confidence decides between metadata candidates', () => {
    const result = resolveArtworkType({
        type: 'cover',
        candidates: [
            candidate('metadata', 'file://low.webp', { verified: true, confidence: 0.8 }),
            candidate('metadata', 'file://high.webp', { verified: true, confidence: 0.95 }),
        ],
    });
    assert.equal(result.value, 'file://high.webp');
});

test('Deterministic ordering when candidates tie', () => {
    const candidates = [
        candidate('metadata', 'file://first.webp', { verified: true, confidence: 0.9, updatedAt: 1 }),
        candidate('metadata', 'file://second.webp', { verified: true, confidence: 0.9, updatedAt: 1 }),
    ];
    assert.equal(resolveArtworkType({ type: 'cover', candidates }).value, 'file://first.webp');
    assert.equal(resolveArtworkType({ type: 'cover', candidates }).value, 'file://first.webp');
});

test('Empty values are ignored', () => {
    const result = resolveArtworkType({
        type: 'cover',
        candidates: [
            candidate('settings', ''),
            candidate('creator', 'file://creator.webp'),
        ],
    });
    assert.equal(result.value, 'file://creator.webp');
});

test('Inputs are not mutated', () => {
    const game = Object.freeze({ id: 'g1', image: 'file://db.webp' });
    const settingsArtwork = Object.freeze({ cover: 'file://settings.webp' });
    const before = JSON.stringify({ game, settingsArtwork });
    resolveGameArtwork({ game, settingsArtwork });
    assert.equal(JSON.stringify({ game, settingsArtwork }), before);
});

test('Output is not an input object reference', () => {
    const input = { cover: { value: 'file://settings.webp' } };
    const result = resolveGameArtwork({ settingsArtwork: input });
    assert.notEqual(result.cover, input.cover);
    assert.equal(result.cover.value, 'file://settings.webp');
});

test('Cover aliases normalize correctly', () => {
    const candidates = normalizeArtworkAliases({
        image: 'file://image.webp',
        cover: 'file://cover.webp',
        coverUrl: 'file://cover-url.webp',
        defaultImage: 'file://default.webp',
        posterImage: 'file://poster.webp',
    });
    assert.deepEqual(candidates.filter((c) => c.type === 'cover').map((c) => c.alias), [
        'image',
        'cover',
        'coverUrl',
        'defaultImage',
        'posterImage',
    ]);
});

test('Hero aliases normalize correctly', () => {
    const candidates = normalizeArtworkAliases({
        heroImage: 'file://hero-image.webp',
        hero: 'file://hero.webp',
        heroUrl: 'file://hero-url.webp',
        defaultHero: 'file://default-hero.webp',
        background: 'file://background.webp',
        backgroundUrl: 'file://background-url.webp',
    });
    assert.deepEqual(candidates.filter((c) => c.type === 'hero').map((c) => c.alias), [
        'heroImage',
        'hero',
        'heroUrl',
        'defaultHero',
        'background',
        'backgroundUrl',
    ]);
});

test('Logo aliases normalize correctly', () => {
    const candidates = normalizeArtworkAliases({
        logo: 'file://logo.webp',
        logoUrl: 'file://logo-url.webp',
        defaultLogo: 'file://default-logo.webp',
    });
    assert.deepEqual(candidates.filter((c) => c.type === 'logo').map((c) => c.alias), [
        'logo',
        'logoUrl',
        'defaultLogo',
    ]);
});

test('Conflicting aliases produce deterministic behavior', () => {
    const first = resolveGameArtwork({
        game: {
            image: 'file://image.webp',
            coverUrl: 'file://cover-url.webp',
            defaultImage: 'file://default.webp',
        },
    }).cover;
    const second = resolveGameArtwork({
        game: {
            image: 'file://image.webp',
            coverUrl: 'file://cover-url.webp',
            defaultImage: 'file://default.webp',
        },
    }).cover;

    assert.equal(first.value, 'file://image.webp');
    assert.deepEqual(first, second);
});

test('Missing candidates return stable null placeholder result', () => {
    const result = resolveArtworkType({ type: 'cover', candidates: [] });
    assert.deepEqual(result, {
        value: null,
        type: 'cover',
        source: 'placeholder',
        locked: false,
        updatedAt: null,
        confidence: null,
        verified: false,
        cacheOnly: false,
        identity: null,
        reason: 'no eligible artwork candidate',
    });
});

test('Cover, hero, and logo can have different winners', () => {
    const result = resolveGameArtwork({
        settingsArtwork: { cover: 'file://settings-cover.webp' },
        creatorArtwork: { hero: 'file://creator-hero.webp' },
        metadataArtwork: { logo: 'file://meta-logo.webp', verified: true, confidence: 0.9 },
    });
    assert.equal(result.cover.source, 'settings');
    assert.equal(result.hero.source, 'creator');
    assert.equal(result.logo.source, 'metadata');
});

test('Unknown source cannot beat Settings or Creator', () => {
    const result = resolveArtworkType({
        type: 'cover',
        candidates: [
            candidate('unknown', 'file://unknown.webp', { updatedAt: 999 }),
            candidate('settings', 'file://settings.webp', { updatedAt: 1 }),
        ],
    });
    assert.equal(result.source, 'settings');
});

test('Exact identity platform candidate is preferred over mismatched identity', () => {
    const result = resolveGameArtwork({
        game: { id: 'g1', platform: 'steam', appId: '10' },
        platformArtwork: {
            cover: 'file://wrong-platform.webp',
            verified: true,
            identity: { platform: 'steam', appId: '20' },
        },
        metadataArtwork: {
            cover: 'file://verified-meta.webp',
            verified: true,
            confidence: 0.9,
        },
    });
    assert.equal(result.cover.value, 'file://verified-meta.webp');
    assert.equal(result.cover.source, 'metadata');
});

test('Resolver diagnostic reason describes the winning rule', () => {
    const result = resolveGameArtwork({ settingsArtwork: { cover: 'file://settings.webp' } });
    assert.match(result.cover.reason, /selected settings cover/);
});

test('boundary: GameArtworkResolver and policy do not import renderer, Electron, filesystem, repositories, or platform sync', () => {
    const combined = `${read(RESOLVER_PATH)}\n${read(POLICY_PATH)}`;
    assert.doesNotMatch(combined, /require\(['"]electron['"]\)/);
    assert.doesNotMatch(combined, /require\(['"](?:node:)?fs['"]\)/);
    assert.doesNotMatch(combined, /src\/js|game-details|play-launcher|app\.js/);
    assert.doesNotMatch(combined, /JsonGameRepository|GamesRepository|platformSync/);
    assert.doesNotMatch(combined, /localStorage/);
});

test('boundary: current renderer files do not import GameArtworkResolver yet', () => {
    for (const rel of ['src/js/app.js', 'src/js/game-details.js', 'src/js/play-launcher.js']) {
        assert.doesNotMatch(read(path.join(ROOT, rel)), /GameArtworkResolver|ArtworkOwnershipPolicy/, rel);
    }
});

test('boundary: JsonGameRepository and public IPC files remain unwired to resolver', () => {
    for (const rel of [
        'src/features/games/infrastructure/repositories/JsonGameRepository.js',
        'preload.js',
        'handlers/localMetadataHandlers.js',
        'handlers/imageHandlers.js',
        'main.js',
    ]) {
        assert.doesNotMatch(read(path.join(ROOT, rel)), /GameArtworkResolver|ArtworkOwnershipPolicy/, rel);
    }
});
