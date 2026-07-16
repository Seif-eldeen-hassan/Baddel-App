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
const { ArtworkNetworkTelemetry } = require('../src/features/games/infrastructure/services/ArtworkNetworkTelemetry');

const ROOT = path.resolve(__dirname, '..');
const ARTWORK_SYNC_JS = fs.readFileSync(path.join(ROOT, 'src', 'js', 'app', 'artwork-sync.js'), 'utf8');
const GAME_CARD_JS = fs.readFileSync(path.join(ROOT, 'src', 'js', 'app', 'game-card.js'), 'utf8');
const IMAGE_HANDLERS_JS = fs.readFileSync(path.join(ROOT, 'handlers', 'imageHandlers.js'), 'utf8');

const PNG_1X1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lWv2YQAAAABJRU5ErkJggg==',
    'base64'
);

function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-artwork-acceptance-'));
}

function silentLogger() {
    return { log() {}, warn() {}, error() {} };
}

function createManager({ httpClient, telemetry = null, bandwidthPolicy = null, concurrency = 2 } = {}) {
    const root = tempDir();
    const cache = new ContentAddressedArtworkCache({
        fs,
        path,
        crypto,
        baseDir: path.join(root, 'artwork-cache-v2'),
        logger: silentLogger(),
    });
    const scheduler = new ArtworkDownloadScheduler({
        concurrency,
        worker: task => task.run(),
    });
    const manager = new ArtworkDownloadManager({
        cache,
        scheduler,
        httpClient,
        bandwidthPolicy,
        telemetry,
        logger: silentLogger(),
    });
    return { root, cache, scheduler, manager };
}

function nextTurn() {
    return new Promise(resolve => setImmediate(resolve));
}

test('warm startup serves visible cached covers without response-body downloads', async () => {
    let httpCalls = 0;
    const telemetry = new ArtworkNetworkTelemetry();
    const { cache, manager } = createManager({
        telemetry,
        httpClient: {
            async fetchImage() {
                httpCalls += 1;
                throw new Error('warm startup must not fetch cached cover bodies');
            },
        },
    });
    for (const id of ['installed-a', 'installed-b', 'installed-c']) {
        cache.storeBuffer({
            sourceUrl: `https://cdn.example/${id}/cover.png`,
            canonicalGameId: id,
            type: 'cover',
            buffer: PNG_1X1,
            mime: 'image/png',
        });
    }

    const startedAt = Date.now();
    const urls = await Promise.all(['installed-a', 'installed-b', 'installed-c'].map(id => manager.downloadAsset({
        sourceUrl: `https://cdn.example/${id}/cover.png`,
        canonicalGameId: id,
        type: 'cover',
        priority: ARTWORK_DOWNLOAD_PRIORITIES.VISIBLE,
        sourceSubsystem: 'startup-visible-covers',
        reason: 'warm-startup-cache-first',
    })));
    const elapsedMs = Date.now() - startedAt;
    const summary = telemetry.getSummary();

    assert.equal(httpCalls, 0);
    assert.ok(urls.every(url => String(url).startsWith('file://')));
    assert.ok(elapsedMs < 1000, `cached cover lookup should be immediate; elapsed=${elapsedMs}ms`);
    assert.equal(summary.cacheHits, 3);
    assert.equal(summary.cacheMisses, 0);
    assert.equal(summary.sessionDownloadedBytes, 0);
});

test('interactive Game Details artwork is next after active work and before queued background work', async () => {
    const order = [];
    let releaseActive;
    const activeGate = new Promise(resolve => { releaseActive = resolve; });
    const scheduler = new ArtworkDownloadScheduler({
        concurrency: 1,
        worker: async task => {
            order.push(task.key);
            if (task.key === 'active-background') await activeGate;
            return task.key;
        },
    });

    scheduler.enqueue({ key: 'active-background', priority: ARTWORK_DOWNLOAD_PRIORITIES.BACKGROUND });
    await nextTurn();
    for (let i = 0; i < 5; i += 1) {
        scheduler.enqueue({ key: `queued-background-${i}`, priority: ARTWORK_DOWNLOAD_PRIORITIES.BACKGROUND });
    }
    const details = scheduler.enqueue({ key: 'interactive-game-details', priority: ARTWORK_DOWNLOAD_PRIORITIES.GAME_DETAILS });

    releaseActive();
    assert.equal(await details, 'interactive-game-details');
    await scheduler.drain();

    assert.deepEqual(order.slice(0, 2), ['active-background', 'interactive-game-details']);
    assert.ok(order.indexOf('interactive-game-details') < order.indexOf('queued-background-0'));
});

test('artwork delivery metrics separate real body downloads from deduplicated callers', async () => {
    let httpCalls = 0;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const telemetry = new ArtworkNetworkTelemetry();
    const { cache, scheduler, manager } = createManager({
        telemetry,
        httpClient: {
            async fetchImage() {
                httpCalls += 1;
                if (httpCalls === 1) await gate;
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
        sourceUrl: 'https://cdn.example/shared-cover.png',
        canonicalGameId: 'game-a',
        type: 'cover',
        priority: ARTWORK_DOWNLOAD_PRIORITIES.VISIBLE,
    });
    const second = manager.downloadAsset({
        sourceUrl: 'https://cdn.example/shared-cover.png',
        canonicalGameId: 'game-b',
        type: 'cover',
        priority: ARTWORK_DOWNLOAD_PRIORITIES.VISIBLE,
    });
    release();
    assert.equal(await first, await second);

    await manager.downloadAsset({
        sourceUrl: 'https://cdn.example/duplicate-bytes.png',
        canonicalGameId: 'game-c',
        type: 'cover',
        priority: ARTWORK_DOWNLOAD_PRIORITIES.VISIBLE,
    });
    await manager.downloadAsset({
        sourceUrl: 'https://cdn.example/shared-cover.png',
        canonicalGameId: 'game-d',
        type: 'cover',
        priority: ARTWORK_DOWNLOAD_PRIORITIES.VISIBLE,
    });

    const summary = telemetry.getSummary();
    const stats = manager.getStats();

    assert.equal(httpCalls, 2);
    assert.equal(scheduler.getStats().deduplicated, 1);
    assert.equal(stats.cache.duplicateContentFilesAvoided, 1);
    assert.equal(summary.deduplicatedRequests, 1);
    assert.equal(summary.cacheHits, 1);
    assert.equal(summary.cacheMisses, 3);
    assert.equal(summary.sessionDownloadedBytes, PNG_1X1.length * 2);
    assert.equal(cache.lookupAlias({ canonicalGameId: 'game-b', type: 'cover' }).assetHash, cache.lookupAlias({ canonicalGameId: 'game-a', type: 'cover' }).assetHash);
});

test('automatic artwork bandwidth limits do not spend budget on joined in-flight callers', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const policy = new ArtworkBandwidthPolicy({ maxAutomaticBytes: PNG_1X1.length });
    const { manager } = createManager({
        bandwidthPolicy: policy,
        httpClient: {
            async fetchImage() {
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
        sourceUrl: 'https://cdn.example/budget-shared.png',
        canonicalGameId: 'game-a',
        type: 'cover',
        priority: ARTWORK_DOWNLOAD_PRIORITIES.BACKGROUND,
    });
    const second = manager.downloadAsset({
        sourceUrl: 'https://cdn.example/budget-shared.png',
        canonicalGameId: 'game-b',
        type: 'cover',
        priority: ARTWORK_DOWNLOAD_PRIORITIES.BACKGROUND,
    });
    release();
    await Promise.all([first, second]);

    const next = await manager.downloadAsset({
        sourceUrl: 'https://cdn.example/next-background.png',
        canonicalGameId: 'game-c',
        type: 'cover',
        priority: ARTWORK_DOWNLOAD_PRIORITIES.BACKGROUND,
    });

    assert.equal(policy.getStats().automaticBytes, PNG_1X1.length);
    assert.equal(next, 'https://cdn.example/next-background.png');
    assert.equal(policy.getStats().skipped, 1);
});

test('normal renderer artwork paths keep remote URLs behind cache manager IPC', () => {
    assert.match(ARTWORK_SYNC_JS, /function isCacheBackedArtworkUrl\s*\(/);
    assert.match(ARTWORK_SYNC_JS, /setCardImageStable[\s\S]*isCacheBackedArtworkUrl\(newUrl\)/);
    assert.match(ARTWORK_SYNC_JS, /setHeroBgStable[\s\S]*isCacheBackedArtworkUrl\(newUrl\)/);
    assert.match(GAME_CARD_JS, /function _jbiCacheBackedArtworkValue\s*\(/);
    assert.match(GAME_CARD_JS, /_jbiCacheBackedArtworkValue\(selection\.selectedValue\)/);
    assert.match(IMAGE_HANDLERS_JS, /artworkDownloadManager\.downloadAsset\(/);
    assert.match(IMAGE_HANDLERS_JS, /artworkDownloadManager\.downloadAssets\(/);

    const directRemoteAssignments = [
        /setCardImageStable[\s\S]*isUsableImageUrl\(newUrl\)/,
        /setHeroBgStable[\s\S]*isUsableImageUrl\(newUrl\)/,
        /imgEl\.src\s*=\s*refreshed\.selectedValue/,
        /imgEl\.src\s*=\s*selection\.candidates\[jbiCandidateIndex\]/,
    ].filter(pattern => pattern.test(`${ARTWORK_SYNC_JS}\n${GAME_CARD_JS}`));

    assert.deepEqual(directRemoteAssignments, []);
});
