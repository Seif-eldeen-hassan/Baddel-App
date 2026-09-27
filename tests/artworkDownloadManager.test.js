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
const { ArtworkBandwidthPolicy } = require('../src/features/games/infrastructure/services/ArtworkBandwidthPolicy');

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
const BANDWIDTH_POLICY_PATH = path.join(
    __dirname,
    '..',
    'src',
    'features',
    'games',
    'infrastructure',
    'services',
    'ArtworkBandwidthPolicy.js'
);
const SOURCE_URL_POLICY_PATH = path.join(
    __dirname,
    '..',
    'src',
    'features',
    'games',
    'infrastructure',
    'services',
    'ArtworkSourceUrlPolicy.js'
);
const MAIN_PATH = path.join(__dirname, '..', 'main.js');
const IMAGE_HANDLERS_PATH = path.join(__dirname, '..', 'handlers', 'imageHandlers.js');
const PRELOAD_PATH = path.join(__dirname, '..', 'preload.js');
const GAME_DETAILS_PATH = path.join(__dirname, '..', 'src', 'js', 'game-details.js');

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

function createManager({ httpClient, telemetry = null, bandwidthPolicy = null } = {}) {
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
        bandwidthPolicy,
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

test('ArtworkDownloadManager returns null and records failure when HTTP fails', async () => {
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

    assert.equal(url, null);
    assert.equal(events[0].failed, true);
    assert.equal(events[0].cacheMiss, true);
});

test('ArtworkDownloadManager requestAsset exposes failed remote candidate without returning it as local artwork', async () => {
    const { manager } = createManager({
        httpClient: {
            async fetchImage() {
                throw new Error('network down');
            },
        },
    });

    const result = await manager.requestAsset({
        sourceUrl: 'https://cdn.example/fail-structured.png',
        canonicalGameId: 'game-structured',
        type: 'cover',
    });

    assert.equal(result.status, 'failed');
    assert.equal(result.localUrl, null);
    assert.equal(result.remoteCandidate, 'https://cdn.example/fail-structured.png');
    assert.ok(result.errorCode);
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

test('ArtworkDownloadManager cache hits bypass automatic bandwidth policy', async () => {
    let httpCalls = 0;
    const policy = new ArtworkBandwidthPolicy({
        dataSaver: true,
        dataSaverMaxAutomaticBytes: 0,
    });
    const { cache, manager, events } = createManager({
        bandwidthPolicy: policy,
        httpClient: {
            async fetchImage() {
                httpCalls += 1;
                throw new Error('cache hit should not download');
            },
        },
    });
    const stored = cache.storeBuffer({
        sourceUrl: 'https://cdn.example/cached-hero.png',
        canonicalGameId: 'game-a',
        type: 'hero',
        buffer: PNG_1X1,
        mime: 'image/png',
    });

    const url = await manager.downloadAsset({
        sourceUrl: 'https://cdn.example/cached-hero.png',
        canonicalGameId: 'game-a',
        type: 'hero',
        priority: ARTWORK_DOWNLOAD_PRIORITIES.BACKGROUND,
    });

    assert.equal(url, stored.fileUrl);
    assert.equal(httpCalls, 0);
    assert.equal(events[0].cacheHit, true);
});

test('ArtworkDownloadManager Data Saver skips automatic hero/logo but keeps cover prewarm', async () => {
    let httpCalls = 0;
    const { manager, events } = createManager({
        bandwidthPolicy: new ArtworkBandwidthPolicy({ dataSaver: true }),
        httpClient: {
            async fetchImage() {
                httpCalls += 1;
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
        hero: 'https://cdn.example/hero.png',
        logo: 'https://cdn.example/logo.png',
    }, 'game-ds', {
        priority: ARTWORK_DOWNLOAD_PRIORITIES.PREWARM,
    });

    assert.match(result.cover, /^file:\/\//);
    assert.equal(result.hero, null);
    assert.equal(result.logo, null);
    assert.equal(httpCalls, 1);
    assert.equal(events.filter(event => event.skipped).length, 2);
    assert.ok(events.every(event => event.downloadedBytes === 0 || event.assetType === 'cover'));
});

test('ArtworkDownloadManager keeps visible secondary artwork interactive under Data Saver', async () => {
    let httpCalls = 0;
    const { manager, events } = createManager({
        bandwidthPolicy: new ArtworkBandwidthPolicy({ dataSaver: true }),
        httpClient: {
            async fetchImage() {
                httpCalls += 1;
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
        cover: 'https://cdn.example/visible-cover.png',
        hero: 'https://cdn.example/visible-hero.png',
        logo: 'https://cdn.example/visible-logo.png',
    }, 'game-visible', {
        priority: ARTWORK_DOWNLOAD_PRIORITIES.VISIBLE,
    });

    assert.match(result.cover, /^file:\/\//);
    assert.match(result.hero, /^file:\/\//);
    assert.match(result.logo, /^file:\/\//);
    assert.equal(httpCalls, 3);
    assert.equal(events.filter(event => event.skipped).length, 0);
});

test('ArtworkDownloadManager automatic bandwidth budget skips future background downloads', async () => {
    let httpCalls = 0;
    const { manager, events } = createManager({
        bandwidthPolicy: new ArtworkBandwidthPolicy({
            maxAutomaticBytes: PNG_1X1.length,
        }),
        httpClient: {
            async fetchImage() {
                httpCalls += 1;
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

    const first = await manager.downloadAsset({
        sourceUrl: 'https://cdn.example/first.png',
        canonicalGameId: 'game-budget',
        type: 'cover',
        priority: ARTWORK_DOWNLOAD_PRIORITIES.BACKGROUND,
    });
    const second = await manager.downloadAsset({
        sourceUrl: 'https://cdn.example/second.png',
        canonicalGameId: 'game-budget',
        type: 'cover',
        priority: ARTWORK_DOWNLOAD_PRIORITIES.BACKGROUND,
    });

    assert.match(first, /^file:\/\//);
    assert.equal(second, null);
    assert.equal(httpCalls, 1);
    assert.equal(events.at(-1).skipped, true);
    assert.equal(events.at(-1).skipReason, 'automatic-artwork-bandwidth-budget-exhausted');
});

test('ArtworkDownloadManager requestAsset exposes blocked remote candidate without returning it as local artwork', async () => {
    const { manager } = createManager({
        bandwidthPolicy: new ArtworkBandwidthPolicy({ maxAutomaticBytes: 0 }),
        httpClient: {
            async fetchImage() {
                throw new Error('blocked request must not fetch');
            },
        },
    });

    const result = await manager.requestAsset({
        sourceUrl: 'https://cdn.example/blocked.png',
        canonicalGameId: 'game-blocked',
        type: 'cover',
        priority: ARTWORK_DOWNLOAD_PRIORITIES.BACKGROUND,
    });

    assert.equal(result.status, 'blocked');
    assert.equal(result.localUrl, null);
    assert.equal(result.remoteCandidate, 'https://cdn.example/blocked.png');
    assert.equal(result.blockedReason, 'automatic-artwork-bandwidth-budget-exhausted');
});

test('ArtworkDownloadManager Game Details requests bypass Data Saver and automatic budget', async () => {
    let httpCalls = 0;
    const { manager } = createManager({
        bandwidthPolicy: new ArtworkBandwidthPolicy({
            dataSaver: true,
            dataSaverMaxAutomaticBytes: 0,
        }),
        httpClient: {
            async fetchImage() {
                httpCalls += 1;
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

    const result = await manager.downloadAsset({
        sourceUrl: 'https://cdn.example/details-hero.png',
        canonicalGameId: 'game-details',
        type: 'hero',
        priority: ARTWORK_DOWNLOAD_PRIORITIES.GAME_DETAILS,
    });

    assert.match(result, /^file:\/\//);
    assert.equal(httpCalls, 1);
});

test('ArtworkDownloadManager fetches efficient IGDB source sizes while preserving original URL cache alias', async () => {
    const requestedUrls = [];
    const sourceUrl = 'https://images.igdb.com/igdb/image/upload/t_original/co1abc.jpg';
    const { manager, cache } = createManager({
        httpClient: {
            async fetchImage({ url }) {
                requestedUrls.push(url);
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

    const first = await manager.downloadAsset({
        sourceUrl,
        canonicalGameId: 'game-igdb',
        type: 'cover',
        priority: ARTWORK_DOWNLOAD_PRIORITIES.VISIBLE,
    });
    const second = await manager.downloadAsset({
        sourceUrl,
        canonicalGameId: 'game-igdb-copy',
        type: 'cover',
        priority: ARTWORK_DOWNLOAD_PRIORITIES.VISIBLE,
    });

    assert.deepEqual(requestedUrls, ['https://images.igdb.com/igdb/image/upload/t_cover_big/co1abc.jpg']);
    assert.equal(first, second);
    assert.equal(cache.lookupUrl(sourceUrl).assetHash, cache.lookupAlias({ canonicalGameId: 'game-igdb-copy', type: 'cover' }).assetHash);
});

test('ArtworkDownloadManager stays independent of renderer, Electron, and legacy imageWebpCache downloads', () => {
    const source = fs.readFileSync(MANAGER_PATH, 'utf8');
    const policy = fs.readFileSync(BANDWIDTH_POLICY_PATH, 'utf8');
    const sourceUrlPolicy = fs.readFileSync(SOURCE_URL_POLICY_PATH, 'utf8');

    assert.doesNotMatch(source, /electron|ipcMain|BrowserWindow|window\.|document\./);
    assert.doesNotMatch(source, /imageWebpCache|downloadToCacheAsWebp|platformSync|main\.js|preload\.js/);
    assert.doesNotMatch(policy, /electron|ipcMain|BrowserWindow|window\.|document\./);
    assert.doesNotMatch(sourceUrlPolicy, /electron|ipcMain|BrowserWindow|window\.|document\./);
});

test('production artwork download routes delegate through ArtworkDownloadManager', () => {
    const main = fs.readFileSync(MAIN_PATH, 'utf8');
    const imageHandlers = fs.readFileSync(IMAGE_HANDLERS_PATH, 'utf8');

    assert.match(main, /new ArtworkDownloadManager\(/);
    assert.match(main, /registerPlatformSyncAssetDownloader\(_downloadAssetsToCache\)/);
    assert.match(main, /gamesApi\.registerImageDownloader\(_downloadAssetsToCache\)/);
    assert.match(main, /artworkDownloadManager\.downloadAssets\(assets,\s*gameId/);
    assert.match(main, /new ArtworkBandwidthPolicy\(/);
    assert.match(main, /BADDEL_ARTWORK_DATA_SAVER/);
    assert.doesNotMatch(main, /downloadToCacheAsWebp\(CACHE_DIR/);

    assert.match(imageHandlers, /artworkDownloadManager\.downloadAsset\(/);
    assert.match(imageHandlers, /artworkDownloadManager\.downloadAssets\(/);
    assert.match(imageHandlers, /artworkDownloadManager\?\.getCachedAsset\?\.\(/);
    assert.doesNotMatch(imageHandlers, /downloadToCacheAsWebp\(/);
});

test('Game Details artwork requests use the highest download priority', () => {
    const preload = fs.readFileSync(PRELOAD_PATH, 'utf8');
    const imageHandlers = fs.readFileSync(IMAGE_HANDLERS_PATH, 'utf8');
    const gameDetails = fs.readFileSync(GAME_DETAILS_PATH, 'utf8');

    assert.match(preload, /cacheAllAssets:\s*\(assets,\s*gameId,\s*opts\)\s*=>\s*ipcRenderer\.invoke\('cache-all-assets',\s*assets,\s*gameId,\s*opts\)/);
    assert.match(imageHandlers, /const requestedPriority = String\(opts\?\.priority \|\| 'visible'\)/);
    assert.match(imageHandlers, /priority === 'game-details'/);
    assert.match(imageHandlers, /game-details-cache-all-assets-ipc/);

    const detailsPriorityCount = (gameDetails.match(/priority:\s*'game-details'/g) || []).length;
    assert.ok(detailsPriorityCount >= 3, `expected Game Details cacheAllAssets calls to use game-details priority, found ${detailsPriorityCount}`);
    assert.match(gameDetails, /reason:\s*'game-details-cached-fallback'/);
    assert.match(gameDetails, /reason:\s*'game-details-metadata-fallback'/);
    assert.match(gameDetails, /reason:\s*'game-details-reset-assets'/);
});


test('ArtworkDownloadManager queues cover before secondary artwork and records timing telemetry', async () => {
    const order = [];
    const { manager, events } = createManager({
        httpClient: {
            async fetchImage({ url }) {
                order.push(url);
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

    await manager.downloadAssets({
        hero: 'https://cdn.example/hero.png',
        logo: 'https://cdn.example/logo.png',
        cover: 'https://cdn.example/cover.png',
    }, 'game-order', {
        priority: ARTWORK_DOWNLOAD_PRIORITIES.LIBRARY_COVER_HYDRATION,
    });

    assert.equal(order[0], 'https://cdn.example/cover.png');
    assert.ok(events.some(event => event.assetType === 'cover' && Number.isFinite(event.queueWaitMs)));
    assert.ok(events.some(event => event.assetType === 'cover' && Number.isFinite(event.httpDownloadMs)));
    assert.ok(events.some(event => event.assetType === 'cover' && Number.isFinite(event.coverNormalizationMs)));
    assert.ok(events.some(event => event.assetType === 'cover' && Number.isFinite(event.cacheStoreMs)));
});
