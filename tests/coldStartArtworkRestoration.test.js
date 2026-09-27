'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { pathToFileURL, fileURLToPath } = require('node:url');

const { ContentAddressedArtworkCache } = require('../src/features/games/infrastructure/services/ContentAddressedArtworkCache');
const imageHandlers = require('../handlers/imageHandlers');

const PNG_1X1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lWv2YQAAAABJRU5ErkJggg==',
    'base64'
);

function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-cold-start-artwork-'));
}

function makeCache(root) {
    return new ContentAddressedArtworkCache({
        fs,
        path,
        crypto,
        baseDir: path.join(root, 'artwork-cache-v2'),
        logger: { log() {}, warn() {}, error() {} },
        activeCoverCacheBytes: Infinity,
        secondaryCacheBytes: Infinity,
    });
}

function makeManager(cache) {
    return {
        getCachedAsset: query => cache.lookupAlias(query),
        getCachedAssetByFileUrl: fileUrl => cache.lookupFileUrl(fileUrl),
        getCacheGeneration: () => cache.getGeneration(),
        linkCachedAlias: query => cache.linkAlias(query),
        beginManifestTransaction: options => cache.beginManifestTransaction(options),
        commitManifestTransaction: () => cache.commitManifestTransaction({ final: true }),
    };
}

function registerHandlers(root, manager) {
    const handlers = new Map();
    const ipcMain = {
        handle(name, handler) { handlers.set(name, handler); },
        on() {},
    };
    imageHandlers.register(ipcMain, {
        app: { getPath: () => root },
        path,
        fs: fs.promises,
        dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
        imageWebpCache: {
            cacheBaseName: (type, id) => `${type}_${id}`,
            filePathToFileUrl: filePath => pathToFileURL(filePath).href,
        },
        artworkDownloadManager: manager,
        coldCoverBootstrapService: null,
        ipcValidation: {
            assertArtworkCacheKey(value) {
                if (!value || /[\\/\0]/.test(String(value))) throw new Error('invalid key');
            },
            assertString() {},
            sanitizeErrorForRenderer(error) { return { status: 'error', message: error.message }; },
        },
        fileURLToPath,
        getSavedGames: () => [],
        getMainWindow: () => null,
        _collectImageCacheIdsFromGame() {},
        _readReadyToInstallProtectedImageIds: async () => new Set(),
        IMAGE_CACHE_PRUNE_GRACE_MS: 0,
        updateGameImage() {},
        setGameArtwork() {},
        resetGameArtwork() {},
        resetGameImage() {},
    });
    return handlers;
}

function extractFunction(source, name) {
    const marker = `function ${name}(`;
    let start = source.indexOf(marker);
    assert.notEqual(start, -1, `missing ${name}`);
    if (source.slice(Math.max(0, start - 6), start) === 'async ') start -= 6;
    let paramsDepth = 1;
    let open = source.indexOf(marker, start) + marker.length;
    while (open < source.length && paramsDepth > 0) {
        if (source[open] === '(') paramsDepth += 1;
        else if (source[open] === ')') paramsDepth -= 1;
        open += 1;
    }
    open = source.indexOf('{', open);
    let depth = 1;
    let index = open + 1;
    while (index < source.length && depth > 0) {
        if (source[index] === '{') depth += 1;
        else if (source[index] === '}') depth -= 1;
        index += 1;
    }
    assert.equal(depth, 0, `unbalanced ${name}`);
    return source.slice(start, index);
}

test('fresh process B restores an alias miss from a validated persisted managed path and backfills current aliases', async () => {
    const root = tempDir();
    try {
        const processA = makeCache(root);
        const stored = processA.storeBuffer({
            canonicalGameId: 'epic:old-account:offer',
            sourceUrl: 'https://cdn.example/offer.png',
            type: 'cover',
            buffer: PNG_1X1,
            mime: 'image/png',
            assetClass: 'active-library-cover',
        });

        const processB = makeCache(root);
        const handlers = registerHandlers(root, makeManager(processB));
        const bulk = handlers.get('get-cached-images-bulk');
        const identity = {
            key: 'epic:new-account:offer',
            ids: ['epic:new-account:offer', 'offer'],
            candidateManagedLocalUrls: [stored.fileUrl],
        };
        const first = await bulk({}, [identity], 'cover');

        assert.equal(first.aliasHits, 0);
        assert.equal(first.persistedPathHits, 1);
        assert.equal(first.misses, 0);
        assert.equal(first.results[identity.key].source, 'persisted-managed-file');
        assert.equal(first.results[identity.key].fileUrl, stored.fileUrl);
        assert.equal(first.backfilledAliases, 2);
        assert.equal(processB.lookupAlias({ canonicalGameId: identity.key, type: 'cover' }).assetHash, stored.assetHash);
        assert.equal(processB.lookupAlias({ canonicalGameId: 'offer', type: 'cover' }).assetHash, stored.assetHash);

        const readyToInstallObject = { key: identity.key, ids: ['offer'] };
        const second = await bulk({}, [readyToInstallObject], 'cover');
        assert.equal(second.aliasHits, 1);
        assert.equal(second.persistedPathHits, 0);
        assert.equal(second.backfilledAliases, 0);
        assert.equal(second.results[identity.key].fileUrl, stored.fileUrl);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('managed persisted-path fallback rejects deleted, zero-byte, malformed, and outside-cache files', async () => {
    for (const mode of ['deleted', 'zero-byte', 'malformed']) {
        const root = tempDir();
        try {
            const processA = makeCache(root);
            const stored = processA.storeBuffer({
                canonicalGameId: `old:${mode}`,
                type: 'cover',
                buffer: PNG_1X1,
                mime: 'image/png',
            });
            if (mode === 'deleted') fs.unlinkSync(stored.path);
            if (mode === 'zero-byte') fs.writeFileSync(stored.path, Buffer.alloc(0));
            if (mode === 'malformed') fs.writeFileSync(stored.path, Buffer.from('not an image'));

            const processB = makeCache(root);
            const bulk = registerHandlers(root, makeManager(processB)).get('get-cached-images-bulk');
            const key = `new:${mode}`;
            const response = await bulk({}, [{ key, ids: [key], candidateManagedLocalUrls: [stored.fileUrl] }], 'cover');
            assert.equal(response.persistedPathHits, 0, mode);
            assert.equal(response.misses, 1, mode);
            assert.equal(response.results[key].fileUrl, null, mode);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    }

    const root = tempDir();
    try {
        const cache = makeCache(root);
        const outside = path.join(root, 'artwork-cache-v2-copy', 'assets', 'outside.png');
        fs.mkdirSync(path.dirname(outside), { recursive: true });
        fs.writeFileSync(outside, PNG_1X1);
        assert.equal(cache.lookupFileUrl(pathToFileURL(outside).href), null);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('production local-cover resolver retries a previous zero-hit lookup after cache generation changes', async () => {
    const accounts = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'accounts.js'), 'utf8');
    const fn = extractFunction(accounts, '_agResolveLocalCoverPathsForRevision');
    let calls = 0;
    let phase = 'miss';
    const context = {
        window: {
            __agLocalCoverResolution: { signature: '', promise: null, generation: '' },
            __agLastBulkArtworkLookup: null,
            _vsRender() {},
        },
        _agArtworkKey: game => game.id,
        _agWarmCachedCoversForGames: async () => {
            calls += 1;
            context.window.__agLastBulkArtworkLookup = phase === 'miss'
                ? { hits: 0, misses: 1, cacheGeneration: 'generation-a' }
                : { hits: 1, misses: 0, cacheGeneration: 'generation-b' };
            return phase === 'miss' ? 0 : 1;
        },
        _agRebindCachedCards() {},
        _agEnsureVirtualGridIntegrity() {},
    };
    vm.runInNewContext(`${fn}; this.resolve = _agResolveLocalCoverPathsForRevision;`, context);

    await context.resolve([{ id: 'game-a' }]);
    assert.equal(calls, 1);
    assert.equal(context.window.__agLocalCoverResolution.signature, '');
    assert.equal(context.window.__agLocalCoverResolution.promise, null);

    phase = 'hit';
    await context.resolve([{ id: 'game-a' }]);
    assert.equal(calls, 2);
    assert.match(context.window.__agLocalCoverResolution.signature, /generation-b$/);
    assert.equal(context.window.__agLocalCoverResolution.promise, null);
});

test('Ready to Install projects a verified All Games cover to a different object while creator artwork remains authoritative', () => {
    const accounts = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'accounts.js'), 'utf8');
    const fn = extractFunction(accounts, '_agProjectReadyArtworkFromAllGames');
    const cachedUrl = 'file:///cache/artwork-cache-v2/assets/cover.png';
    const creatorUrl = 'file:///custom/creator.png';
    const allGame = { id: 'all-object', aliases: ['strong-product'], coverUrl: cachedUrl };
    const readyGame = { id: 'ready-object', aliases: ['strong-product'] };
    const creatorGame = { id: 'creator-object', aliases: ['strong-product'], coverUrl: creatorUrl, creator: true };
    const context = {
        window: { _allGamesCache: [allGame] },
        Map,
        Array,
        String,
        _agArtworkAliasesForGame: game => game.aliases,
        _agIsCreatorArtworkGame: game => game.creator === true,
        _agIsUsableCardCover: url => url === cachedUrl || url === creatorUrl,
        _agApplyCachedCoverToGame(game, cover) {
            game.coverUrl = cover;
            game.image = cover;
            game.defaultImage = cover;
            return true;
        },
    };
    vm.runInNewContext(`${fn}; this.project = _agProjectReadyArtworkFromAllGames;`, context);

    assert.equal(context.project([readyGame, creatorGame]), 1);
    assert.equal(readyGame.coverUrl, cachedUrl);
    assert.equal(readyGame.image, cachedUrl);
    assert.equal(readyGame.defaultImage, cachedUrl);
    assert.equal(creatorGame.coverUrl, creatorUrl);
});
