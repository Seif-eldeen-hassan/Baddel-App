'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');

const { ImageCacheService } = require('../src/features/games/infrastructure/services/ImageCacheService');

// ── helpers ───────────────────────────────────────────────────────────────────

function makeService(dbFolder) {
    return new ImageCacheService({ fs, path, dbFolder });
}

function makeTempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-ics-'));
}

function makeCacheDir(dbFolder) {
    const dir = path.join(dbFolder, 'image_cache');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

// ── module load ───────────────────────────────────────────────────────────────

test('ImageCacheService: can be required without throwing', () => {
    assert.ok(ImageCacheService, 'module must export ImageCacheService');
    const svc = makeService(os.tmpdir());
    assert.ok(typeof svc.findInCache === 'function');
    assert.ok(typeof svc.deleteGameImages === 'function');
});

// ── findInCache ───────────────────────────────────────────────────────────────

test('ImageCacheService: findInCache returns null when cache directory does not exist', () => {
    const dbFolder = makeTempDir(); // image_cache subdir never created
    const svc = makeService(dbFolder);
    assert.equal(svc.findInCache('g1', 'cover'), null);
});

test('ImageCacheService: findInCache returns null when no file matches the prefix', () => {
    const dbFolder = makeTempDir();
    const cacheDir = makeCacheDir(dbFolder);
    fs.writeFileSync(path.join(cacheDir, 'cover_other_game.webp'), 'x');
    const svc = makeService(dbFolder);
    assert.equal(svc.findInCache('g1', 'cover'), null);
});

test('ImageCacheService: findInCache returns file:// URL when a matching file exists', () => {
    const dbFolder = makeTempDir();
    const cacheDir = makeCacheDir(dbFolder);
    fs.writeFileSync(path.join(cacheDir, 'cover_g1.webp'), 'x');
    const svc = makeService(dbFolder);
    const result = svc.findInCache('g1', 'cover');
    assert.ok(result !== null, 'must return a non-null result');
    assert.ok(result.startsWith('file://'), 'must start with file://');
    assert.ok(result.endsWith('cover_g1.webp'), 'must end with the matched filename');
});

test('ImageCacheService: findInCache normalizes backslashes to forward slashes', () => {
    const dbFolder = makeTempDir();
    const cacheDir = makeCacheDir(dbFolder);
    fs.writeFileSync(path.join(cacheDir, 'hero_g1.webp'), 'x');
    const svc = makeService(dbFolder);
    const result = svc.findInCache('g1', 'hero');
    assert.ok(result !== null);
    assert.ok(!result.includes('\\'), 'must not contain backslashes');
});

test('ImageCacheService: findInCache matches by prefix and ignores unrelated files', () => {
    const dbFolder = makeTempDir();
    const cacheDir = makeCacheDir(dbFolder);
    fs.writeFileSync(path.join(cacheDir, 'cover_g1.webp'), 'x');
    fs.writeFileSync(path.join(cacheDir, 'cover_g2.webp'), 'x');
    fs.writeFileSync(path.join(cacheDir, 'hero_g1.webp'),  'x');
    const svc = makeService(dbFolder);
    const result = svc.findInCache('g1', 'cover');
    assert.ok(result !== null);
    assert.ok(result.includes('cover_g1'), 'must match g1 cover specifically');
    assert.ok(!result.includes('g2'), 'must not match g2');
    assert.ok(!result.includes('hero'), 'must not match hero type');
});

test('ImageCacheService: findInCache returns null (does not throw) when readdirSync throws', () => {
    const dbFolder = makeTempDir();
    // Create cacheDir as a FILE, so readdirSync on it throws ENOTDIR
    const cachePath = path.join(dbFolder, 'image_cache');
    fs.writeFileSync(cachePath, 'not a dir');
    const svc = makeService(dbFolder);
    assert.doesNotThrow(() => svc.findInCache('g1', 'cover'));
    assert.equal(svc.findInCache('g1', 'cover'), null);
});

test('ImageCacheService: findInCache uses String() coercion on gameId in prefix', () => {
    const dbFolder = makeTempDir();
    const cacheDir = makeCacheDir(dbFolder);
    fs.writeFileSync(path.join(cacheDir, 'cover_42.webp'), 'x');
    const svc = makeService(dbFolder);
    // numeric gameId 42 → prefix 'cover_42' → should find the file
    const result = svc.findInCache(42, 'cover');
    assert.ok(result !== null, 'numeric gameId must be coerced to string');
});

// ── deleteGameImages ──────────────────────────────────────────────────────────

test('ImageCacheService: deleteGameImages removes matching cover/hero/logo files', () => {
    const dbFolder = makeTempDir();
    const cacheDir = makeCacheDir(dbFolder);
    fs.writeFileSync(path.join(cacheDir, 'cover_g1.webp'), 'x');
    fs.writeFileSync(path.join(cacheDir, 'hero_g1.webp'),  'x');
    fs.writeFileSync(path.join(cacheDir, 'logo_g1.webp'),  'x');
    const svc = makeService(dbFolder);
    svc.deleteGameImages('g1');
    const remaining = fs.readdirSync(cacheDir);
    assert.equal(remaining.length, 0, 'all three files must be deleted');
});

test('ImageCacheService: deleteGameImages removes multiple files per type', () => {
    const dbFolder = makeTempDir();
    const cacheDir = makeCacheDir(dbFolder);
    // two cover files for the same gameId (different extensions)
    fs.writeFileSync(path.join(cacheDir, 'cover_g1.webp'), 'x');
    fs.writeFileSync(path.join(cacheDir, 'cover_g1.jpg'),  'x');
    const svc = makeService(dbFolder);
    svc.deleteGameImages('g1');
    const remaining = fs.readdirSync(cacheDir);
    assert.equal(remaining.length, 0, 'both cover variants must be deleted');
});

test('ImageCacheService: deleteGameImages does not remove unrelated files', () => {
    const dbFolder = makeTempDir();
    const cacheDir = makeCacheDir(dbFolder);
    fs.writeFileSync(path.join(cacheDir, 'cover_g1.webp'), 'x');
    fs.writeFileSync(path.join(cacheDir, 'cover_g2.webp'), 'x'); // different game
    fs.writeFileSync(path.join(cacheDir, 'unrelated.webp'), 'x');
    const svc = makeService(dbFolder);
    svc.deleteGameImages('g1');
    const remaining = fs.readdirSync(cacheDir).sort();
    assert.deepEqual(remaining, ['cover_g2.webp', 'unrelated.webp'],
        'only g1 files must be deleted; g2 and unrelated must survive');
});

test('ImageCacheService: deleteGameImages does not throw when cache directory is missing', () => {
    const dbFolder = makeTempDir(); // no image_cache subdir
    const svc = makeService(dbFolder);
    assert.doesNotThrow(() => svc.deleteGameImages('g1'));
});

test('ImageCacheService: deleteGameImages silences individual file unlink errors', () => {
    const dbFolder = makeTempDir();
    const cacheDir = makeCacheDir(dbFolder);
    fs.writeFileSync(path.join(cacheDir, 'cover_g1.webp'), 'x');

    // Patch unlinkSync to throw for this test
    const origUnlink = fs.unlinkSync.bind(fs);
    fs.unlinkSync = () => { throw new Error('simulated unlink failure'); };
    try {
        const svc = makeService(dbFolder);
        assert.doesNotThrow(() => svc.deleteGameImages('g1'),
            'must not propagate unlink errors');
    } finally {
        fs.unlinkSync = origUnlink;
    }
});
