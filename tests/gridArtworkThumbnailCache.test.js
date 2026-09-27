'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { fileURLToPath, pathToFileURL } = require('node:url');
const sharp = require('sharp');
const { GridArtworkThumbnailCache, isPathInside } = require('../src/features/games/infrastructure/services/GridArtworkThumbnailCache');

test('grid thumbnail cache creates a persistent 160x240 variant and reuses it', async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-grid-thumb-'));
    t.after(() => { try { fs.rmSync(root, { recursive: true, force: true }); } catch {} });
    const sourceRoot = path.join(root, 'artwork-cache-v2');
    const outputRoot = path.join(root, 'artwork-grid-cache-v1');
    fs.mkdirSync(sourceRoot, { recursive: true });
    const sourcePath = path.join(sourceRoot, 'cover.webp');
    await sharp({ create: { width: 384, height: 576, channels: 4, background: '#2468ac' } }).webp().toFile(sourcePath);
    const sourceUrl = pathToFileURL(sourcePath).href;
    const cache = new GridArtworkThumbnailCache({ baseDir: outputRoot, sourceRoots: [sourceRoot] });

    const first = await cache.resolveBatch([sourceUrl], { createMissing: true });
    const second = await cache.resolveBatch([sourceUrl], { createMissing: false });
    assert.equal(first.resolved, 1);
    assert.equal(second.images[sourceUrl], first.images[sourceUrl]);
    const metadata = await sharp(fileURLToPath(first.images[sourceUrl])).metadata();
    assert.equal(metadata.width, 160);
    assert.equal(metadata.height, 240);
    assert.equal(cache.getStats().generated, 1);
    assert.equal(cache.getStats().hits, 1);
});

test('grid thumbnail cache rejects sources outside managed artwork roots', async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-grid-thumb-safe-'));
    t.after(() => { try { fs.rmSync(root, { recursive: true, force: true }); } catch {} });
    const sourceRoot = path.join(root, 'artwork-cache-v2');
    const outsideRoot = path.join(root, 'outside');
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.mkdirSync(outsideRoot, { recursive: true });
    const outsidePath = path.join(outsideRoot, 'cover.webp');
    fs.writeFileSync(outsidePath, 'not-an-image');
    const cache = new GridArtworkThumbnailCache({ baseDir: path.join(root, 'grid'), sourceRoots: [sourceRoot] });
    const result = await cache.resolve(pathToFileURL(outsidePath).href, { createMissing: true });
    assert.equal(result, null);
    assert.equal(cache.getStats().rejected, 1);
    assert.equal(isPathInside(outsidePath, sourceRoot), false);
});


test('grid thumbnail cache does not write a completed resize while scrolling is active', async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-grid-thumb-scroll-'));
    t.after(() => { try { fs.rmSync(root, { recursive: true, force: true }); } catch {} });
    const sourceRoot = path.join(root, 'artwork-cache-v2');
    const outputRoot = path.join(root, 'artwork-grid-cache-v1');
    fs.mkdirSync(sourceRoot, { recursive: true });
    const sourcePath = path.join(sourceRoot, 'cover.webp');
    await sharp({ create: { width: 384, height: 576, channels: 4, background: '#9752c7' } }).webp().toFile(sourcePath);
    const cache = new GridArtworkThumbnailCache({ baseDir: outputRoot, sourceRoots: [sourceRoot] });
    cache.setScrollActive(true);

    const result = await cache.resolve(pathToFileURL(sourcePath).href, { createMissing: true });
    assert.equal(result, null);
    assert.equal(cache.getStats().cancelledForScroll, 1);
    assert.deepEqual(fs.readdirSync(outputRoot), []);
});
