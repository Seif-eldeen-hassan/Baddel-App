'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const { ArtworkDownloadManager, ARTWORK_DOWNLOAD_PRIORITIES } = require('../src/features/games/infrastructure/services/ArtworkDownloadManager');
const { ArtworkDownloadScheduler } = require('../src/features/games/infrastructure/services/ArtworkDownloadScheduler');
const { ContentAddressedArtworkCache } = require('../src/features/games/infrastructure/services/ContentAddressedArtworkCache');

const MANAGER_PATH = path.join(
    __dirname,
    '..',
    'src',
    'features',
    'games',
    'infrastructure',
    'services',
    'ArtworkDownloadManager.js'
);
const MAIN_PATH = path.join(__dirname, '..', 'main.js');
const IMAGE_HANDLERS_PATH = path.join(__dirname, '..', 'handlers', 'imageHandlers.js');

const PNG_1X1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lWv2YQAAAABJRU5ErkJggg==',
    'base64'
);

function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-artwork-manager-'));
}

function silentLogger() {
    return { log() {}, warn() {}, error() {} };
}

function createManager({ httpClient, telemetry = null } = {}) {
    const root = tempDir();
    const cache = new ContentAddressedArtworkCache({
        fs,
        path,
        crypto,
        baseDir: path.join(root, 'artwork-cache-v2'),
        logger: silentLogger(),
    });
    const scheduler = new ArtworkDownloadScheduler({
        concurrency: 2,
        worker: task => task.run(),
    });
    const events = [];
    const manager = new ArtworkDownloadManager({
        cache,
        scheduler,
        httpClient,
        telemetry: telemetry || { recordRequest(event) { events.push(event); } },
        logger: silentLogger(),
    });
    return { root, cache, scheduler, manager, events };
}

test('ArtworkDownloadManager returns cached content without calling HTTP', async () => {
    let httpCalls = 0;
    const { cache, manager, events } = createManager({
        httpClient: {
            async fetchImage() {
                httpCalls += 1;
                throw new Error('should not fetch');
            },
        },
    });
    const stored = cache.storeBuffer({
        sourceUrl: 'https://cdn.example/cover.png',
        canonicalGameId: 'game-a',
        type: 'cover',
        buffer: PNG_1X1,
        mime: 'image/png',
    });

    const url = await manager.downloadAsset({
        sourceUrl: 'https://cdn.example/cover.png',
        canonicalGameId: 'game-b',
        type: 'cover',
        priority: ARTWORK_DOWNLOAD_PRIORITIES.VISIBLE,
    });

    assert.equal(url, stored.fileUrl);
    assert.equal(httpCalls, 0);
    assert.equal(cache.lookupAlias({ canonicalGameId: 'game-b', type: 'cover' }).assetHash, stored.assetHash);
    assert.equal(events[0].cacheHit, true);
    assert.equal(events[0].downloadedBytes, 0);
});

test('ArtworkDownloadManager exposes cache-only alias lookup for warm startup', async () => {
    let httpCalls = 0;
    const { cache, manager } = createManager({
        httpClient: {
            async fetchImage() {
                httpCalls += 1;
                throw new Error('startup lookup must not fetch');
            },
        },
    });
    const stored = cache.storeBuffer({
        sourceUrl: 'https://cdn.example/startup-cover.png',
        canonicalGameId: 'game-startup',
        type: 'cover',
        buffer: PNG_1X1,
        mime: 'image/png',
    });

    const cached = manager.getCachedAsset({
        canonicalGameId: 'game-startup',
        type: 'cover',
    });

    assert.equal(cached.fileUrl, stored.fileUrl);
    assert.equal(httpCalls, 0);
});

test('Content-addressed alias lookup ignores stale missing files', () => {
    const { cache, manager } = createManager({
        httpClient: {
            async fetchImage() {
                throw new Error('not used');
            },
        },
    });
    const stored = cache.storeBuffer({
        sourceUrl: 'https://cdn.example/stale-cover.png',
        canonicalGameId: 'game-stale',
        type: 'cover',
        buffer: PNG_1X1,
        mime: 'image/png',
    });
    fs.unlinkSync(stored.path);

    assert.equal(manager.getCachedAsset({
        canonicalGameId: 'game-stale',
        type: 'cover',
    }), null);
});

test('ArtworkDownloadManager deduplicates concurrent same-URL downloads and links every alias', async () => {
    let httpCalls = 0;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const { cache, manager, scheduler, events } = createManager({
        httpClient: {
            async fetchImage() {
                httpCalls += 1;
                await gate;
                return {
                    status: 200,
                    notModified: false,
                    buffer: PNG_1X1,
                    bytes: PNG_1X1.length,
                    mime: 'image/png',
                };
            },
        },
    });

    const first = manager.downloadAsset({
        sourceUrl: 'https://cdn.example/shared.png',
        canonicalGameId: 'local:shared',
        type: 'cover',
        priority: ARTWORK_DOWNLOAD_PRIORITIES.BACKGROUND,
    });
    const second = manager.downloadAsset({
        sourceUrl: 'https://cdn.example/shared.png',
        canonicalGameId: 'steam:shared',
        type: 'cover',
        priority: ARTWORK_DOWNLOAD_PRIORITIES.GAME_DETAILS,
    });
    release();
    const [firstUrl, secondUrl] = await Promise.all([first, second]);

    assert.equal(httpCalls, 1);
    assert.equal(firstUrl, secondUrl);
    assert.equal(scheduler.getStats().deduplicated, 1);
    assert.equal(cache.lookupAlias({ canonicalGameId: 'local:shared', type: 'cover' }).fileUrl, firstUrl);
    assert.equal(cache.lookupAlias({ canonicalGameId: 'steam:shared', type: 'cover' }).fileUrl, firstUrl);
    assert.equal(events.filter(event => event.cacheMiss).length, 2);
});

test('ArtworkDownloadManager returns original URL and records failure when HTTP fails', async () => {
    const { manager, events } = createManager({
        httpClient: {
            async fetchImage() {
                throw new Error('network down');
            },
        },
    });

    const url = await manager.downloadAsset({
        sourceUrl: 'https://cdn.example/fail.png',
        canonicalGameId: 'game-a',
        type: 'hero',
    });

    assert.equal(url, 'https://cdn.example/fail.png');
    assert.equal(events[0].failed, true);
    assert.equal(events[0].cacheMiss, true);
});

test('ArtworkDownloadManager downloadAssets preserves current asset map shape', async () => {
    const { manager } = createManager({
        httpClient: {
            async fetchImage() {
                return {
                    status: 200,
                    notModified: false,
                    buffer: PNG_1X1,
                    bytes: PNG_1X1.length,
                    mime: 'image/png',
                };
            },
        },
    });

    const result = await manager.downloadAssets({
        cover: 'https://cdn.example/cover.png',
        hero: null,
        logo: 'file:///already/local.png',
    }, 'game-a', {
        priority: ARTWORK_DOWNLOAD_PRIORITIES.VISIBLE,
    });

    assert.match(result.cover, /^file:\/\//);
    assert.equal(result.logo, 'file:///already/local.png');
    assert.equal(Object.prototype.hasOwnProperty.call(result, 'hero'), false);
});

test('ArtworkDownloadManager stays independent of renderer, Electron, and legacy imageWebpCache downloads', () => {
    const source = fs.readFileSync(MANAGER_PATH, 'utf8');

    assert.doesNotMatch(source, /electron|ipcMain|BrowserWindow|window\.|document\./);
    assert.doesNotMatch(source, /imageWebpCache|downloadToCacheAsWebp|platformSync|main\.js|preload\.js/);
});

test('production artwork download routes delegate through ArtworkDownloadManager', () => {
    const main = fs.readFileSync(MAIN_PATH, 'utf8');
    const imageHandlers = fs.readFileSync(IMAGE_HANDLERS_PATH, 'utf8');

    assert.match(main, /new ArtworkDownloadManager\(/);
    assert.match(main, /registerPlatformSyncAssetDownloader\(_downloadAssetsToCache\)/);
    assert.match(main, /gamesApi\.registerImageDownloader\(_downloadAssetsToCache\)/);
    assert.match(main, /artworkDownloadManager\.downloadAssets\(assets,\s*gameId/);
    assert.doesNotMatch(main, /downloadToCacheAsWebp\(CACHE_DIR/);

    assert.match(imageHandlers, /artworkDownloadManager\.downloadAsset\(/);
    assert.match(imageHandlers, /artworkDownloadManager\.downloadAssets\(/);
    assert.match(imageHandlers, /artworkDownloadManager\?\.getCachedAsset\?\.\(/);
    assert.doesNotMatch(imageHandlers, /downloadToCacheAsWebp\(/);
});
