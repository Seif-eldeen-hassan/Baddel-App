'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { fileURLToPath } = require('url');

const { ContentAddressedArtworkCache } = require('../src/features/games/infrastructure/services/ContentAddressedArtworkCache');
const { ImageCacheService } = require('../src/features/games/infrastructure/services/ImageCacheService');
const { JsonGameRepository } = require('../src/features/games/infrastructure/repositories/JsonGameRepository');

const PNG_1X1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lWv2YQAAAABJRU5ErkJggg==',
    'base64'
);
const PNG_1X1_ALT = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
);

function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-artwork-cache-v2-'));
}

function silentLogger() {
    return { log() {}, warn() {}, error() {} };
}

function makeCache(root, options = {}) {
    return new ContentAddressedArtworkCache({
        fs,
        path,
        crypto,
        baseDir: path.join(root, 'artwork-cache-v2'),
        logger: silentLogger(),
        ...options,
    });
}

function makeResponse(buffer, options = {}) {
    const headers = {
        'content-type': options.mime || 'image/png',
        'content-length': String(options.contentLength ?? buffer.length),
    };
    return {
        ok: options.ok ?? true,
        status: options.status ?? 200,
        headers: {
            get(name) {
                return headers[String(name).toLowerCase()] || null;
            },
        },
        async arrayBuffer() {
            if (options.failOnRead) throw new Error('body should not be read');
            return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
        },
    };
}

function assetFiles(cache) {
    return fs.readdirSync(cache.getAssetsDir()).sort();
}

test('ContentAddressedArtworkCache fetches a repeated URL once and reuses the same physical asset', async () => {
    const root = tempDir();
    let fetchCount = 0;
    const cache = makeCache(root, {
        fetchImpl: async () => {
            fetchCount += 1;
            await new Promise(resolve => setImmediate(resolve));
            return makeResponse(PNG_1X1);
        },
    });

    const [first, second] = await Promise.all([
        cache.fetchAndStore({ sourceUrl: 'https://cdn.example/cover.png', canonicalGameId: 'local:valorant', type: 'cover' }),
        cache.fetchAndStore({ sourceUrl: 'https://cdn.example/cover.png', canonicalGameId: 'riot:valorant', type: 'cover' }),
    ]);
    const third = await cache.fetchAndStore({
        sourceUrl: 'https://cdn.example/cover.png',
        canonicalGameId: 'epic:valorant',
        type: 'cover',
    });

    assert.equal(fetchCount, 1);
    assert.equal(first.assetHash, second.assetHash);
    assert.equal(first.assetHash, third.assetHash);
    assert.equal(second.inFlightDeduplication, true);
    assert.equal(third.cacheHit, true);
    assert.deepEqual(assetFiles(cache), [`${first.assetHash}.png`]);
});

test('ContentAddressedArtworkCache deduplicates different URLs with identical image bytes', async () => {
    const root = tempDir();
    const cache = makeCache(root, {
        fetchImpl: async () => makeResponse(PNG_1X1),
    });

    const first = await cache.fetchAndStore({ sourceUrl: 'https://cdn.example/a.png', canonicalGameId: 'game-a', type: 'cover' });
    const second = await cache.fetchAndStore({ sourceUrl: 'https://cdn.example/b.png', canonicalGameId: 'game-b', type: 'cover' });
    const manifest = cache.getManifest();

    assert.equal(first.assetHash, second.assetHash);
    assert.deepEqual(assetFiles(cache), [`${first.assetHash}.png`]);
    assert.equal(Object.keys(manifest.urls).length, 2);
    assert.equal(manifest.stats.duplicateContentFilesAvoided, 1);
});

test('ContentAddressedArtworkCache lets multiple canonical identities alias one asset without copying', () => {
    const root = tempDir();
    const cache = makeCache(root);

    const first = cache.storeBuffer({ canonicalGameId: 'local:valorant', type: 'cover', buffer: PNG_1X1, mime: 'image/png' });
    const second = cache.storeBuffer({ canonicalGameId: 'riot:valorant', type: 'cover', buffer: PNG_1X1, mime: 'image/png' });
    const manifest = cache.getManifest();

    assert.equal(first.assetHash, second.assetHash);
    assert.deepEqual(assetFiles(cache), [`${first.assetHash}.png`]);
    assert.equal(manifest.aliases['local:valorant:cover'].assetHash, first.assetHash);
    assert.equal(manifest.aliases['riot:valorant:cover'].assetHash, first.assetHash);
});

test('ContentAddressedArtworkCache keeps shared content when one alias is removed', () => {
    const root = tempDir();
    const cache = makeCache(root);

    const stored = cache.storeBuffer({ canonicalGameId: 'game-a', type: 'cover', buffer: PNG_1X1, mime: 'image/png' });
    cache.storeBuffer({ canonicalGameId: 'game-b', type: 'cover', buffer: PNG_1X1, mime: 'image/png' });
    const removed = cache.removeAlias({ canonicalGameId: 'game-a', type: 'cover' });

    assert.equal(removed.removed, true);
    assert.equal(removed.assetHash, stored.assetHash);
    assert.equal(removed.assetStillReferenced, true);
    assert.equal(fs.existsSync(stored.path), true);
    assert.equal(cache.lookupAlias({ canonicalGameId: 'game-a', type: 'cover' }), null);
    assert.equal(cache.lookupAlias({ canonicalGameId: 'game-b', type: 'cover' }).assetHash, stored.assetHash);
});

test('ContentAddressedArtworkCache evicts least-recently-used automatic assets above size limit', () => {
    const root = tempDir();
    let tick = 0;
    const cache = makeCache(root, {
        maxCacheBytes: PNG_1X1_ALT.length,
        now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)),
    });

    const first = cache.storeBuffer({
        sourceUrl: 'https://cdn.example/old.png',
        canonicalGameId: 'old-game',
        type: 'cover',
        buffer: PNG_1X1,
        mime: 'image/png',
    });
    const second = cache.storeBuffer({
        sourceUrl: 'https://cdn.example/new.png',
        canonicalGameId: 'new-game',
        type: 'cover',
        buffer: PNG_1X1_ALT,
        mime: 'image/png',
    });
    const manifest = cache.getManifest();

    assert.equal(fs.existsSync(first.path), false);
    assert.equal(fs.existsSync(second.path), true);
    assert.equal(cache.lookupAlias({ canonicalGameId: 'old-game', type: 'cover' }), null);
    assert.equal(cache.lookupUrl('https://cdn.example/old.png'), null);
    assert.equal(cache.lookupAlias({ canonicalGameId: 'new-game', type: 'cover' }).assetHash, second.assetHash);
    assert.equal(manifest.stats.evictedAssets, 1);
    assert.ok(manifest.stats.evictedBytes > 0);
});

test('ContentAddressedArtworkCache LRU eviction preserves recently accessed assets', () => {
    const root = tempDir();
    let tick = 0;
    const cache = makeCache(root, {
        maxCacheBytes: Infinity,
        now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)),
    });

    const first = cache.storeBuffer({ canonicalGameId: 'game-a', type: 'cover', buffer: PNG_1X1, mime: 'image/png' });
    const second = cache.storeBuffer({ canonicalGameId: 'game-b', type: 'cover', buffer: PNG_1X1_ALT, mime: 'image/png' });
    cache.lookupAlias({ canonicalGameId: 'game-a', type: 'cover' });

    const summary = cache.enforceMaxCacheBytes({ maxBytes: Math.max(PNG_1X1.length, PNG_1X1_ALT.length) });

    assert.equal(summary.evictedAssets, 1);
    assert.equal(fs.existsSync(first.path), true);
    assert.equal(fs.existsSync(second.path), false);
    assert.equal(cache.lookupAlias({ canonicalGameId: 'game-a', type: 'cover' }).assetHash, first.assetHash);
    assert.equal(cache.lookupAlias({ canonicalGameId: 'game-b', type: 'cover' }), null);
});

test('ContentAddressedArtworkCache eviction never touches user_artwork or legacy image_cache', () => {
    const root = tempDir();
    const userArtworkDir = path.join(root, 'user_artwork');
    const legacyCacheDir = path.join(root, 'image_cache');
    const userPath = path.join(userArtworkDir, 'explicit-cover.png');
    const legacyPath = path.join(legacyCacheDir, 'cover_game-a.png');
    fs.mkdirSync(userArtworkDir, { recursive: true });
    fs.mkdirSync(legacyCacheDir, { recursive: true });
    fs.writeFileSync(userPath, PNG_1X1);
    fs.writeFileSync(legacyPath, PNG_1X1);
    const cache = makeCache(root, { maxCacheBytes: 0 });

    const stored = cache.storeBuffer({ canonicalGameId: 'game-a', type: 'cover', buffer: PNG_1X1_ALT, mime: 'image/png' });

    assert.equal(fs.existsSync(stored.path), false);
    assert.equal(fs.existsSync(userPath), true);
    assert.equal(fs.existsSync(legacyPath), true);
    assert.deepEqual(fs.readdirSync(userArtworkDir), ['explicit-cover.png']);
    assert.deepEqual(fs.readdirSync(legacyCacheDir), ['cover_game-a.png']);
});

test('ContentAddressedArtworkCache recovers a completed temp manifest after an interrupted write', () => {
    const root = tempDir();
    const cache = makeCache(root);
    const stored = cache.storeBuffer({ canonicalGameId: 'game-a', type: 'cover', buffer: PNG_1X1, mime: 'image/png' });
    const manifestPath = path.join(cache.getRootDir(), 'manifest.json');
    const tempManifestPath = `${manifestPath}.tmp`;
    const nextManifest = cache.getManifest();
    nextManifest.aliases['game-b:hero'] = {
        canonicalGameId: 'game-b',
        type: 'hero',
        assetHash: stored.assetHash,
        updatedAt: new Date(0).toISOString(),
    };

    fs.writeFileSync(tempManifestPath, JSON.stringify(nextManifest, null, 2), 'utf8');
    fs.unlinkSync(manifestPath);
    const recovered = makeCache(root);

    assert.equal(recovered.lookupAlias({ canonicalGameId: 'game-b', type: 'hero' }).assetHash, stored.assetHash);
    assert.equal(fs.existsSync(tempManifestPath), false);
});

test('ContentAddressedArtworkCache restores manifest.backup.json when the manifest is corrupt', () => {
    const root = tempDir();
    const cache = makeCache(root);
    const stored = cache.storeBuffer({ canonicalGameId: 'game-a', type: 'cover', buffer: PNG_1X1, mime: 'image/png' });
    const manifestPath = path.join(cache.getRootDir(), 'manifest.json');
    const backupPath = path.join(cache.getRootDir(), 'manifest.backup.json');
    const backup = cache.getManifest();

    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2), 'utf8');
    fs.writeFileSync(manifestPath, '{ broken json', 'utf8');
    const recovered = makeCache(root);

    assert.equal(recovered.lookupAlias({ canonicalGameId: 'game-a', type: 'cover' }).assetHash, stored.assetHash);
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
});

test('ContentAddressedArtworkCache rejects corrupt and non-image responses without committing files', async () => {
    const root = tempDir();
    const html = Buffer.from('<html>not artwork</html>');
    const cache = makeCache(root, {
        fetchImpl: async () => makeResponse(html, { mime: 'image/png' }),
    });

    await assert.rejects(
        cache.fetchAndStore({ sourceUrl: 'https://cdn.example/bad.png', canonicalGameId: 'game-a', type: 'cover' }),
        /not a supported image/
    );

    assert.deepEqual(assetFiles(cache), []);
    assert.deepEqual(fs.readdirSync(cache.getTempDir()), []);
});

test('ContentAddressedArtworkCache rejects oversized responses before reading the body', async () => {
    const root = tempDir();
    const cache = makeCache(root, {
        maxBytes: 8,
        fetchImpl: async () => makeResponse(PNG_1X1, { contentLength: 1024, failOnRead: true }),
    });

    await assert.rejects(
        cache.fetchAndStore({ sourceUrl: 'https://cdn.example/huge.png', canonicalGameId: 'game-a', type: 'cover' }),
        /exceeds maximum/
    );

    assert.deepEqual(assetFiles(cache), []);
    assert.deepEqual(fs.readdirSync(cache.getTempDir()), []);
});

test('ContentAddressedArtworkCache cleans stale temp files on startup', () => {
    const root = tempDir();
    const baseDir = path.join(root, 'artwork-cache-v2');
    const tempPath = path.join(baseDir, 'temp');
    fs.mkdirSync(tempPath, { recursive: true });
    fs.writeFileSync(path.join(tempPath, 'stale-download.tmp'), 'partial');

    const cache = makeCache(root);

    assert.deepEqual(fs.readdirSync(cache.getTempDir()), []);
});

test('ContentAddressedArtworkCache never writes to user_artwork and refuses it as its root', () => {
    const root = tempDir();
    const userArtworkDir = path.join(root, 'user_artwork');
    const explicitPath = path.join(userArtworkDir, 'explicit.png');
    fs.mkdirSync(userArtworkDir, { recursive: true });
    fs.writeFileSync(explicitPath, PNG_1X1);
    const cache = makeCache(root);

    cache.storeBuffer({ canonicalGameId: 'game-a', type: 'cover', buffer: PNG_1X1_ALT, mime: 'image/png' });

    assert.equal(fs.existsSync(explicitPath), true);
    assert.deepEqual(fs.readdirSync(userArtworkDir), ['explicit.png']);
    assert.throws(
        () => new ContentAddressedArtworkCache({ fs, path, crypto, baseDir: userArtworkDir, logger: silentLogger() }),
        /must not use user_artwork/
    );
});

test('ContentAddressedArtworkCache preserves legacy ImageCacheService lookup compatibility', () => {
    const root = tempDir();
    const legacyCacheDir = path.join(root, 'image_cache');
    fs.mkdirSync(legacyCacheDir, { recursive: true });
    fs.writeFileSync(path.join(legacyCacheDir, 'cover_game-1.webp'), 'legacy');
    const legacy = new ImageCacheService({ fs, path, dbFolder: root });
    const cache = makeCache(root);

    const before = legacy.findInCache('game-1', 'cover');
    cache.storeBuffer({ canonicalGameId: 'game-1', type: 'cover', buffer: PNG_1X1, mime: 'image/png' });
    const after = legacy.findInCache('game-1', 'cover');

    assert.equal(after, before);
    assert.ok(after.endsWith('cover_game-1.webp'));
});

test('ContentAddressedArtworkCache materializes trusted file URLs without modifying Artwork State V2 records', () => {
    const root = tempDir();
    const dbPath = path.join(root, 'games-db.json');
    const originalGame = {
        id: 'game-1',
        name: 'Game One',
        image: 'https://cdn.example/current-cover.png',
        artworkState: {
            version: 2,
            cover: {
                locked: true,
                overrideValue: 'file:///C:/Baddel/user_artwork/game-1-cover.png',
                overrideSource: 'settings',
                revision: 7,
            },
        },
    };
    fs.writeFileSync(dbPath, JSON.stringify([originalGame], null, 2), 'utf8');
    const repo = new JsonGameRepository({
        fs,
        path,
        crypto,
        databasePath: dbPath,
        logger: silentLogger(),
    });
    const before = repo.getGameById('game-1');
    const cache = makeCache(root);
    const stored = cache.storeBuffer({ canonicalGameId: 'game-1', type: 'cover', buffer: PNG_1X1, mime: 'image/png' });
    const after = repo.getGameById('game-1');

    assert.equal(cache.ownsUrl(stored.fileUrl), true);
    assert.match(fileURLToPath(stored.fileUrl), /artwork-cache-v2/);
    assert.deepEqual(after, before);
});

test('ContentAddressedArtworkCache migrates legacy image_cache files without network access or deletion', () => {
    const root = tempDir();
    const legacyCacheDir = path.join(root, 'image_cache');
    fs.mkdirSync(legacyCacheDir, { recursive: true });
    const legacyPath = path.join(legacyCacheDir, 'cover_game-1.webp');
    fs.writeFileSync(legacyPath, PNG_1X1);
    let fetchCount = 0;
    const cache = makeCache(root, {
        fetchImpl: async () => {
            fetchCount += 1;
            return makeResponse(PNG_1X1_ALT);
        },
    });

    const summary = cache.migrateLegacyImageCache({ legacyCacheDir });
    const migrated = cache.lookupAlias({ canonicalGameId: 'game-1', type: 'cover' });
    const legacy = new ImageCacheService({ fs, path, dbFolder: root });

    assert.equal(fetchCount, 0);
    assert.equal(summary.scanned, 1);
    assert.equal(summary.migrated, 1);
    assert.equal(summary.skipped, 0);
    assert.equal(fs.existsSync(legacyPath), true);
    assert.ok(legacy.findInCache('game-1', 'cover').endsWith('cover_game-1.webp'));
    assert.equal(cache.ownsUrl(migrated.fileUrl), true);
    assert.deepEqual(assetFiles(cache), [`${migrated.assetHash}.png`]);
});

test('ContentAddressedArtworkCache migration deduplicates identical legacy files across aliases', () => {
    const root = tempDir();
    const legacyCacheDir = path.join(root, 'image_cache');
    fs.mkdirSync(legacyCacheDir, { recursive: true });
    fs.writeFileSync(path.join(legacyCacheDir, 'cover_game-a.jpg'), PNG_1X1);
    fs.writeFileSync(path.join(legacyCacheDir, 'hero_game-b.png'), PNG_1X1);
    const cache = makeCache(root);

    const summary = cache.migrateLegacyImageCache({ legacyCacheDir });
    const cover = cache.lookupAlias({ canonicalGameId: 'game-a', type: 'cover' });
    const hero = cache.lookupAlias({ canonicalGameId: 'game-b', type: 'hero' });

    assert.equal(summary.scanned, 2);
    assert.equal(summary.migrated, 2);
    assert.equal(summary.duplicateContentFilesAvoided, 1);
    assert.equal(cover.assetHash, hero.assetHash);
    assert.deepEqual(assetFiles(cache), [`${cover.assetHash}.png`]);
});

test('ContentAddressedArtworkCache migration skips corrupt legacy files safely', () => {
    const root = tempDir();
    const legacyCacheDir = path.join(root, 'image_cache');
    fs.mkdirSync(legacyCacheDir, { recursive: true });
    fs.writeFileSync(path.join(legacyCacheDir, 'cover_game-a.png'), Buffer.from('not image bytes'));
    fs.writeFileSync(path.join(legacyCacheDir, 'readme.txt'), 'ignored');
    const cache = makeCache(root);

    const summary = cache.migrateLegacyImageCache({ legacyCacheDir });

    assert.equal(summary.scanned, 1);
    assert.equal(summary.migrated, 0);
    assert.equal(summary.skipped, 1);
    assert.match(summary.errors[0].message, /not a supported image/);
    assert.equal(cache.lookupAlias({ canonicalGameId: 'game-a', type: 'cover' }), null);
    assert.deepEqual(assetFiles(cache), []);
});
