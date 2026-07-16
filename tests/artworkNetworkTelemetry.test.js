'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const {
    ArtworkNetworkTelemetry,
    emptySummary,
} = require('../src/features/games/infrastructure/services/ArtworkNetworkTelemetry');

test('emptySummary exposes required artwork network counters', () => {
    const summary = emptySummary(new Date('2026-07-16T00:00:00.000Z'));
    for (const key of [
        'sessionDownloadedBytes',
        'sessionRequestCount',
        'cacheHits',
        'cacheMisses',
        'revalidated304',
        'deduplicatedRequests',
        'failedRequests',
        'rendererDirectRemoteRequests',
        'bySubsystem',
        'byAssetType',
        'topRepeatedUrlHashes',
    ]) {
        assert.ok(key in summary, `${key} must exist`);
    }
});

test('ArtworkNetworkTelemetry records sanitized request summaries without raw URLs', () => {
    const telemetry = new ArtworkNetworkTelemetry({
        now: () => new Date('2026-07-16T01:02:03.000Z'),
    });

    telemetry.recordRequest({
        url: 'https://cdn.example.com/art/cover.jpg?token=secret',
        sourceSubsystem: 'renderer-cache-all-assets-ipc',
        reason: 'cache-all-assets',
        canonicalGameId: 'game-1',
        assetType: 'cover',
        httpStatus: 200,
        responseContentLength: 1024,
        downloadedBytes: 900,
        cacheMiss: true,
        retryCount: 1,
        elapsedMs: 42,
    });

    const summary = telemetry.getSummary();
    assert.equal(summary.sessionRequestCount, 1);
    assert.equal(summary.sessionDownloadedBytes, 900);
    assert.equal(summary.cacheMisses, 1);
    assert.equal(summary.bySubsystem['renderer-cache-all-assets-ipc'].requestCount, 1);
    assert.equal(summary.byAssetType.cover.downloadedBytes, 900);
    assert.equal(summary.lastEvent.host, 'cdn.example.com');
    assert.match(summary.lastEvent.urlHash, /^[a-f0-9]{16}$/);
    assert.equal(JSON.stringify(summary).includes('token=secret'), false);
    assert.equal(JSON.stringify(summary).includes('/art/cover.jpg'), false);
});

test('ArtworkNetworkTelemetry tracks cache hits, failures, 304s, dedupe, and renderer direct remote counts', () => {
    const telemetry = new ArtworkNetworkTelemetry();

    telemetry.recordRequest({
        url: 'https://cdn.example.com/a.webp',
        sourceSubsystem: 'imageWebpCache',
        assetType: 'hero',
        cacheHit: true,
        cacheMiss: false,
        inFlightDeduplication: true,
        rendererDirectRemote: true,
        httpStatus: 304,
    });
    telemetry.recordRequest({
        url: 'https://cdn.example.com/b.webp',
        sourceSubsystem: 'imageWebpCache',
        assetType: 'hero',
        failed: true,
        cacheMiss: true,
    });

    const summary = telemetry.getSummary();
    assert.equal(summary.cacheHits, 1);
    assert.equal(summary.cacheMisses, 1);
    assert.equal(summary.revalidated304, 1);
    assert.equal(summary.deduplicatedRequests, 1);
    assert.equal(summary.rendererDirectRemoteRequests, 1);
    assert.equal(summary.failedRequests, 1);
    assert.equal(summary.byAssetType.hero.requestCount, 2);
});

test('ArtworkNetworkTelemetry persists a bounded summary file', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-art-telemetry-'));
    const summaryFile = path.join(root, 'artwork-network-diagnostics.json');
    const telemetry = new ArtworkNetworkTelemetry();
    telemetry.configure({ summaryFile });

    telemetry.recordRequest({
        url: 'https://cdn.example.com/persist.webp',
        sourceSubsystem: 'platform-sync',
        assetType: 'logo',
        downloadedBytes: 123,
        cacheMiss: true,
    });

    const persisted = JSON.parse(fs.readFileSync(summaryFile, 'utf8'));
    assert.equal(persisted.sessionDownloadedBytes, 123);
    assert.equal(persisted.bySubsystem['platform-sync'].requestCount, 1);
    assert.equal(JSON.stringify(persisted).includes('persist.webp'), false);
});

test('imageWebpCache records cache-hit telemetry for existing cached files', async () => {
    const cache = require('../services/imageWebpCache');
    const { artworkNetworkTelemetry } = require('../src/features/games/infrastructure/services/ArtworkNetworkTelemetry');
    artworkNetworkTelemetry.reset();

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-image-cache-hit-'));
    const localPath = path.join(root, 'cover_game-1.webp');
    fs.writeFileSync(localPath, Buffer.alloc(1024, 1));

    const result = await cache.downloadToCacheAsWebp(
        root,
        'cover_game-1',
        'https://cdn.example.com/cover.webp',
        { sourceSubsystem: 'test-cache-hit' }
    );

    assert.equal(result, localPath);
    const summary = artworkNetworkTelemetry.getSummary();
    assert.equal(summary.cacheHits, 1);
    assert.equal(summary.cacheMisses, 0);
    assert.equal(summary.bySubsystem['test-cache-hit'].cacheHits, 1);
    assert.equal(summary.lastEvent.canonicalGameId, 'game-1');
    assert.equal(summary.lastEvent.assetType, 'cover');
});

test('preload exposes getArtworkNetworkDiagnostics IPC helper', () => {
    const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
    assert.match(preload, /getArtworkNetworkDiagnostics:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('get-artwork-network-diagnostics'\)/);
});

test('main registers artwork network diagnostics IPC handler', () => {
    const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    assert.match(main, /ipcMain\.handle\('get-artwork-network-diagnostics'/);
    assert.match(main, /artworkNetworkTelemetry\.configure/);
});
