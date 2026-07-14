'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    PlatformSyncAssetWriteBackService,
} = require('../src/features/sync/application/services/PlatformSyncAssetWriteBackService');
const {
    runBackgroundMetadataPipeline,
} = require('../src/features/games/infrastructure/services/BackgroundMetadataPipeline');
const { STATUS: MRM_STATUS } = require('../services/metadataResolutionManager');
const {
    resolveArtworkType,
    resolveGameArtwork,
} = require('../src/features/games/application/services/GameArtworkResolver');

function artwork(value, source, overrides = {}) {
    return value ? {
        value,
        source,
        locked: source === 'settings' || source === 'creator',
        updatedAt: overrides.updatedAt || 0,
        confidence: overrides.confidence || 'explicit',
        ...overrides,
    } : null;
}

function chooseArtwork(candidates, { resetSource = null } = {}) {
    const filtered = { ...candidates };
    if (resetSource) filtered[resetSource] = null;

    const priority = [
        'settings',
        'creator',
        'database',
        'platform',
        'server',
        'placeholder',
    ];

    for (const key of priority) {
        const candidate = filtered[key];
        if (!candidate?.value) continue;
        if (key === 'server' && !['verified', 'high'].includes(candidate.confidence)) continue;
        return candidate;
    }

    return null;
}

function mayWriteArtwork(current, incoming) {
    if (!current?.locked) return true;
    if (incoming.source === 'settings' || incoming.source === 'creator') return true;
    return false;
}

function normalizeResolverResult(result) {
    return ['cover', 'hero', 'logo'].reduce((acc, type) => {
        acc[type] = {
            value: result[type]?.value || null,
            source: result[type]?.source || null,
            locked: result[type]?.locked === true,
            updatedAt: result[type]?.updatedAt || 0,
            confidence: result[type]?.confidence || null,
        };
        return acc;
    }, {});
}

function makeTempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-art-contract-'));
}

function rmDir(dir) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

function writeJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function matchById(library, entry) {
    return library.findIndex((game) => game.id === entry.id);
}

test('contract: future resolver result shape carries value/source/lock/timestamp/confidence for cover, hero, logo', () => {
    const result = normalizeResolverResult(resolveGameArtwork({
        settingsArtwork: { cover: { value: 'file://settings-cover.webp', updatedAt: 20 } },
        creatorArtwork: { hero: { value: 'file://creator-hero.webp', updatedAt: 10 } },
        metadataArtwork: { logo: { value: 'file://server-logo.webp', verified: true, confidence: 1 } },
    }));

    assert.deepEqual({
        value: result.cover.value,
        source: result.cover.source,
        locked: result.cover.locked,
        updatedAt: result.cover.updatedAt,
        confidence: result.cover.confidence,
    }, {
        value: 'file://settings-cover.webp',
        source: 'settings',
        locked: true,
        updatedAt: 20,
        confidence: null,
    });
    assert.equal(result.hero.source, 'creator');
    assert.equal(result.logo.source, 'metadata');
    assert.equal(result.logo.confidence, 1);
});

test('contract: Settings-selected cover/hero/logo win over stale Creator custom metadata', () => {
    const result = resolveGameArtwork({
        game: { image: 'file://db-cover.webp' },
        settingsArtwork: {
            cover: { value: 'file://settings-cover.webp', updatedAt: 200 },
            hero: { value: 'file://settings-hero.webp', updatedAt: 200 },
            logo: { value: 'file://settings-logo.webp', updatedAt: 200 },
        },
        creatorArtwork: {
            cover: { value: 'file://creator-cover.webp', updatedAt: 100 },
            hero: { value: 'file://creator-hero.webp', updatedAt: 100 },
            logo: { value: 'file://creator-logo.webp', updatedAt: 100 },
        },
    });

    assert.equal(result.cover.value, 'file://settings-cover.webp');
    assert.equal(result.hero.value, 'file://settings-hero.webp');
    assert.equal(result.logo.value, 'file://settings-logo.webp');
});

test('contract: Settings and Creator remain distinguishable explicit sources', () => {
    const settings = resolveGameArtwork({
        settingsArtwork: { cover: 'file://settings.webp' },
        creatorArtwork: { cover: 'file://creator.webp' },
    }).cover;
    const creator = resolveGameArtwork({
        creatorArtwork: { cover: 'file://creator.webp' },
        metadataArtwork: { cover: 'file://server.webp', verified: true, confidence: 1 },
    }).cover;

    assert.equal(settings.source, 'settings');
    assert.equal(creator.source, 'creator');
    assert.notEqual(settings.source, creator.source);
});

test('contract: Creator artwork wins over server, pipeline, and cache when no Settings override exists', () => {
    const result = resolveGameArtwork({
        creatorArtwork: { cover: { value: 'file://creator.webp', updatedAt: 10 } },
        metadataArtwork: { cover: 'file://server.webp', verified: true, confidence: 1 },
        cacheArtwork: { cover: 'file://cache.webp' },
        placeholders: { cover: 'placeholder://cover' },
    }).cover;

    assert.equal(result.value, 'file://creator.webp');
    assert.equal(result.source, 'creator');
});

test('contract: locked user artwork cannot be replaced by pipeline, server, or force metadata writes', () => {
    const result = resolveArtworkType({
        type: 'cover',
        candidates: [
            { value: 'file://settings.webp', type: 'cover', source: 'settings', locked: true },
            { value: 'file://pipeline.webp', type: 'cover', source: 'metadata', verified: true, confidence: 1, force: true },
        ],
    });

    assert.equal(result.value, 'file://settings.webp');
    assert.equal(result.locked, true);
});

test('contract: resetting Settings artwork reveals Creator before lower-priority sources', () => {
    const candidates = {
        settings: artwork('file://settings.webp', 'settings', { updatedAt: 200 }),
        creator: artwork('file://creator.webp', 'creator', { updatedAt: 100 }),
        server: artwork('file://server.webp', 'server', { confidence: 'verified' }),
    };

    assert.equal(chooseArtwork(candidates, { resetSource: 'settings' }).value, 'file://creator.webp');
});

test('contract: reset must not revive localStorage or disk cache as ownership authority', () => {
    const result = chooseArtwork({
        settings: artwork('file://settings.webp', 'settings'),
        server: artwork('file://server.webp', 'server', { confidence: 'verified' }),
        cache: artwork('file://stale-local-storage.webp', 'cache'),
    }, { resetSource: 'settings' });

    assert.equal(result.value, 'file://server.webp');
    assert.equal(result.source, 'server');
});

test('source guard: repository currently has a force path that bypasses artwork locks', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'games', 'infrastructure', 'repositories', 'JsonGameRepository.js'), 'utf8');
    const fnStart = src.indexOf('async updateGameMetadata');
    assert.ok(fnStart !== -1, 'updateGameMetadata must exist');
    const fnBody = src.slice(fnStart, fnStart + 4500);

    assert.match(fnBody, /force\s*=\s*false/, 'current implementation accepts a force option');
    assert.match(fnBody, /!force\s*&&/, 'current lock skip is gated by !force');
    assert.match(fnBody, /isCreator\s*\|\|\s*force/, 'current null-art branch also treats force as an override');
});

test('platform sync: locked Settings artwork is skipped and downloader is not called', async () => {
    const dir = makeTempDir();
    try {
        const cacheFile = path.join(dir, 'library.json');
        const entries = [{
            id: 'game-1',
            title: 'Locked Settings',
            coverUrl: 'https://cdn.example/settings-wrong.jpg',
            heroUrl: 'https://cdn.example/settings-hero.jpg',
            logoUrl: 'https://cdn.example/settings-logo.png',
            customArtworkLocked: true,
            artworkSource: 'settings',
        }];
        writeJson(cacheFile, entries);

        const calls = [];
        const service = new PlatformSyncAssetWriteBackService();
        await service.cacheLibraryCoversFirst({
            entries,
            downloader: async (assets, gameId) => {
                calls.push({ assets, gameId });
                return { cover: 'file:///cache/new.webp', hero: 'file:///cache/new-hero.webp' };
            },
            cacheFile,
            matchFn: matchById,
            emitter: null,
            opts: { coverConcurrency: 1, secondaryConcurrency: 1, batchSize: 1 },
        });

        assert.deepEqual(calls, []);
        assert.equal(entries[0].coverUrl, 'https://cdn.example/settings-wrong.jpg');
        assert.equal(readJson(cacheFile)[0].coverUrl, 'https://cdn.example/settings-wrong.jpg');
    } finally {
        rmDir(dir);
    }
});

test('platform sync: locked Creator artwork is skipped and missing artwork can still be filled for unlocked entries', async () => {
    const dir = makeTempDir();
    try {
        const cacheFile = path.join(dir, 'library.json');
        const entries = [
            {
                id: 'locked-creator',
                title: 'Locked Creator',
                coverUrl: 'https://cdn.example/creator-wrong.jpg',
                customArtworkLocked: true,
                artworkSource: 'creator',
            },
            {
                id: 'unlocked',
                title: 'Unlocked',
                coverUrl: 'https://cdn.example/unlocked.jpg',
            },
        ];
        writeJson(cacheFile, entries);

        const calls = [];
        const service = new PlatformSyncAssetWriteBackService();
        await service.cacheLibraryCoversFirst({
            entries,
            downloader: async (assets, gameId) => {
                calls.push({ assets, gameId });
                return { cover: `file:///cache/${gameId}.webp` };
            },
            cacheFile,
            matchFn: matchById,
            emitter: null,
            opts: { coverConcurrency: 1, batchSize: 1 },
        });

        assert.deepEqual(calls, [{
            assets: { cover: 'https://cdn.example/unlocked.jpg' },
            gameId: 'unlocked',
        }]);
        assert.equal(entries[0].coverUrl, 'https://cdn.example/creator-wrong.jpg');
        assert.equal(entries[1].coverUrl, 'file:///cache/unlocked.webp');
    } finally {
        rmDir(dir);
    }
});

test('background pipeline: can fill missing artwork and preserves pipeline source on DB write', async () => {
    const game = { id: 'g1', name: 'Pipeline Game', platform: 'xbox', image: null, heroImage: null, logo: null, isHidden: false };
    const calls = [];
    const engine = {
        findInCache: () => null,
        updateGameMetadata: async (gameId, patch, opts) => calls.push({ gameId, patch, opts }),
        saveDatabase: () => {},
        getGameById: () => ({ ...game, image: 'file://cache/cover.webp' }),
    };
    const cache = {
        hasEntry: async () => false,
        save: async () => {},
        deleteEntry: async () => {},
    };
    const mrm = {
        getStatus: () => MRM_STATUS.IDLE,
        resetToIdle: () => {},
        getJob: () => null,
        resolve: async () => ({
            meta: { cover: 'https://cdn.example/cover.jpg' },
            _resolveSource: 'mrm-api',
        }),
    };

    await runBackgroundMetadataPipeline([game], {
        engine,
        mrm,
        metadataCacheStore: cache,
        imageDownloadFn: async () => ({ cover: 'file://cache/cover.webp' }),
    });

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], {
        gameId: 'g1',
        patch: { cover: 'file://cache/cover.webp', hero: null, logo: null },
        opts: { source: 'pipeline' },
    });
});

test('background pipeline: locked artwork protection is delegated to updateGameMetadata', async () => {
    const lockedGame = {
        id: 'g1',
        name: 'Locked Pipeline Game',
        platform: 'xbox',
        image: 'file://settings-cover.webp',
        heroImage: null,
        logo: null,
        isHidden: false,
        customArtworkLocked: true,
        artworkSource: 'settings',
    };
    const calls = [];
    const engine = {
        findInCache: () => null,
        updateGameMetadata: async (gameId, patch, opts) => {
            calls.push({ gameId, patch, opts });
            if (lockedGame.customArtworkLocked && opts?.source === 'pipeline') return { status: 'success' };
            Object.assign(lockedGame, patch);
            return { status: 'success' };
        },
        saveDatabase: () => {},
        getGameById: () => lockedGame,
    };
    const cache = {
        hasEntry: async () => false,
        save: async () => {},
        deleteEntry: async () => {},
    };
    const mrm = {
        getStatus: () => MRM_STATUS.IDLE,
        resetToIdle: () => {},
        getJob: () => null,
        resolve: async () => ({
            meta: { hero: 'https://cdn.example/hero.jpg' },
            _resolveSource: 'mrm-api',
        }),
    };

    await runBackgroundMetadataPipeline([lockedGame], {
        engine,
        mrm,
        metadataCacheStore: cache,
        imageDownloadFn: async () => ({ hero: 'file://cache/hero.webp' }),
    });

    assert.equal(calls[0].opts.source, 'pipeline');
    assert.equal(lockedGame.image, 'file://settings-cover.webp');
    assert.equal(lockedGame.heroImage, null);
});
