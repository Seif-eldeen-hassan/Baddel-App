'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { fileURLToPath } = require('url');
let sharp = null;
try { sharp = require('sharp'); } catch {}

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


async function makeRepresentativeWebp({ channels = 3, quality = 80, targetBytes = 100 * 1024, seed = 1 } = {}) {
    if (!sharp) return Buffer.concat([PNG_1X1, Buffer.alloc(Math.max(0, targetBytes - PNG_1X1.length), seed)]);
    const width = 384;
    const height = 576;
    const raw = Buffer.alloc(width * height * channels);
    for (let i = 0; i < raw.length; i += channels) {
        const px = Math.floor(i / channels);
        const x = px % width;
        const y = Math.floor(px / width);
        raw[i] = (x * 17 + seed * 31 + y) & 255;
        raw[i + 1] = (y * 13 + seed * 19 + x) & 255;
        raw[i + 2] = ((x ^ y) + seed * 7) & 255;
        if (channels === 4) raw[i + 3] = ((x * 5 + y * 3 + seed) & 255);
    }
    const encoded = await sharp(raw, { raw: { width, height, channels } }).webp({ quality }).toBuffer();
    if (encoded.length >= targetBytes) return encoded;
    return Buffer.concat([encoded, Buffer.alloc(targetBytes - encoded.length, seed)]);
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


test('batch alias linking validates once and persists all names without trusting missing files', () => {
    const root = tempDir();
    const cache = makeCache(root);
    const stored = cache.storeBuffer({ canonicalGameId: 'primary', type: 'cover', buffer: PNG_1X1, mime: 'image/png' });
    let checks = 0;
    const original = cache._assetExists.bind(cache);
    cache._assetExists = hash => { checks++; return original(hash); };
    const ids = Array.from({ length: 20 }, (_, i) => `alias-${i}`);
    const linked = cache.linkAliases({ assetHash: stored.assetHash, canonicalGameIds: [...ids, ids[0]], type: 'cover' });
    assert.equal(linked.aliasesCreated, 20);
    assert.equal(checks, 1);
    assert.equal(cache.linkAliases({ assetHash: stored.assetHash, canonicalGameIds: ids, type: 'cover' }).aliasesCreated, 0);
    assert.equal(checks, 2);
    const restarted = makeCache(root);
    ids.forEach(id => assert.ok(restarted.lookupAlias({ canonicalGameId: id, type: 'cover' })));
    fs.unlinkSync(fileURLToPath(stored.fileUrl));
    assert.equal(cache.linkAliases({ assetHash: stored.assetHash, canonicalGameIds: ['missing'], type: 'cover' }), null);
    assert.equal(cache.lookupAlias({ canonicalGameId: 'missing', type: 'cover' }), null);
});

test('warm alias transactions do not rewrite an unchanged manifest', () => {
    const root = tempDir();
    const cache = makeCache(root);
    const stored = cache.storeBuffer({ canonicalGameId: 'warm', type: 'cover', buffer: PNG_1X1, mime: 'image/png' });
    let commits = 0;
    const original = cache._commitManifestNow.bind(cache);
    cache._commitManifestNow = () => { commits++; return original(); };
    cache.beginManifestTransaction();
    cache.linkAlias({ assetHash: stored.assetHash, canonicalGameId: 'warm', type: 'cover' });
    cache.commitManifestTransaction({ final: true });
    assert.equal(commits, 0);
    cache.beginManifestTransaction();
    cache.linkAlias({ assetHash: stored.assetHash, canonicalGameId: 'new-alias', type: 'cover' });
    cache.commitManifestTransaction({ final: true });
    assert.equal(commits, 1);
    assert.ok(makeCache(root).lookupAlias({ canonicalGameId: 'new-alias', type: 'cover' }));
});

test('capacity accounting does not reopen images and lookups still reject deleted files', () => {
    const root = tempDir();
    let probes = 0;
    const measuredFs = Object.create(fs);
    measuredFs.statSync = (...args) => { probes++; return fs.statSync(...args); };
    measuredFs.openSync = (...args) => { probes++; return fs.openSync(...args); };
    const cache = makeCache(root, { fs: measuredFs });
    cache.storeBuffer({ canonicalGameId: 'capacity-test', type: 'cover', buffer: PNG_1X1, mime: 'image/png', assetClass: 'active-library-cover' });
    probes = 0;
    for (let i = 0; i < 20; i++) {
        assert.equal(cache.getCapacityStats().totalBytes, PNG_1X1.length);
        assert.equal(cache.preflightStore({ type: 'cover', estimatedBytes: 1024 }).allowed, true);
    }
    assert.equal(probes, 0, 'stats and admission must not scan image files');
    const hit = cache.lookupAlias({ canonicalGameId: 'capacity-test', type: 'cover' });
    assert.ok(hit);
    fs.unlinkSync(fileURLToPath(hit.fileUrl));
    assert.equal(cache.lookupAlias({ canonicalGameId: 'capacity-test', type: 'cover' }), null);
    assert.equal(cache.getCapacityStats().totalBytes, 0);
});

test('ContentAddressedArtworkCache batches 3000 representative active covers and preserves aliases across restart', async () => {
    const root = tempDir();
    const cache = makeCache(root, {
        activeLibraryGameCount: 3000,
        activeCoverCacheBytes: 2 * 1024 * 1024 * 1024,
        secondaryCacheBytes: 1024,
    });
    const covers = [
        await makeRepresentativeWebp({ quality: 50, targetBytes: 100 * 1024, seed: 11 }),
        await makeRepresentativeWebp({ quality: 95, targetBytes: 200 * 1024, seed: 22 }),
        await makeRepresentativeWebp({ channels: 4, quality: 98, targetBytes: 460 * 1024, seed: 33 }),
    ];

    cache.beginManifestTransaction({ label: 'test-3000-cover-hydration', batchSize: 50 });
    for (let i = 0; i < 3000; i++) {
        cache.storeBuffer({
            canonicalGameId: `epic:acct:${i}`,
            type: 'cover',
            buffer: covers[i % covers.length],
            mime: 'image/webp',
            assetClass: 'active-library-cover',
            variant: 'card-cover-384x576-webp',
            normalized: true,
        });
    }
    cache.storeBuffer({ canonicalGameId: 'hero-a', type: 'hero', buffer: PNG_1X1_ALT, mime: 'image/png', assetClass: 'secondary-artwork' });
    cache.storeBuffer({ canonicalGameId: 'hero-b', type: 'hero', buffer: PNG_1X1, mime: 'image/png', assetClass: 'secondary-artwork' });
    cache.commitManifestTransaction({ final: true });

    const stats = cache.getCapacityStats();
    assert.equal(stats.byClass['active-library-cover'] > 500 * 1024, true);
    assert.equal(stats.byClass['active-library-cover'] <= stats.activeCoverCacheBytes, true);

    const restarted = makeCache(root, {
        activeLibraryGameCount: 3000,
        activeCoverCacheBytes: 2 * 1024 * 1024 * 1024,
        secondaryCacheBytes: 1024,
    });
    for (let i = 0; i < 3000; i++) {
        assert.ok(restarted.lookupAlias({ canonicalGameId: `epic:acct:${i}`, type: 'cover' }), `missing active cover ${i}`);
    }
    assert.equal(restarted.getManifest().stats.evictionsByArtworkClass?.['active-library-cover'] || 0, 0);
});

test('ContentAddressedArtworkCache recovers pending batch aliases from transaction journal after restart', async () => {
    const root = tempDir();
    const cache = makeCache(root, { activeLibraryGameCount: 10, activeCoverCacheBytes: Infinity, secondaryCacheBytes: Infinity });
    const cover = await makeRepresentativeWebp({ quality: 50, targetBytes: 100 * 1024, seed: 44 });

    cache.beginManifestTransaction({ label: 'interrupted-hydration', batchSize: 50 });
    for (let i = 0; i < 10; i++) {
        cache.storeBuffer({
            canonicalGameId: `epic:interrupted:${i}`,
            type: 'cover',
            buffer: cover,
            mime: 'image/webp',
            assetClass: 'active-library-cover',
            normalized: true,
        });
    }

    const recovered = makeCache(root, { activeLibraryGameCount: 10, activeCoverCacheBytes: Infinity, secondaryCacheBytes: Infinity });
    for (let i = 0; i < 10; i++) {
        assert.ok(recovered.lookupAlias({ canonicalGameId: `epic:interrupted:${i}`, type: 'cover' }), `missing recovered alias ${i}`);
    }
    assert.equal(fs.existsSync(path.join(recovered.getRootDir(), 'manifest.transaction-journal.json')), false);
});

test('ContentAddressedArtworkCache incrementally migrates one oversized active cover and preserves aliases', async () => {
    const root = tempDir();
    const cache = makeCache(root, { activeCoverCacheBytes: Infinity, secondaryCacheBytes: Infinity });
    const oversizedCover = Buffer.concat([PNG_1X1_ALT, Buffer.alloc(2048)]);
    const old = cache.storeBuffer({
        canonicalGameId: 'epic:account:product',
        type: 'cover',
        buffer: oversizedCover,
        mime: 'image/png',
        assetClass: 'active-library-cover',
    });
    cache.linkAlias({ assetHash: old.assetHash, canonicalGameId: 'epic:account:alias', type: 'cover' });

    const result = await cache.migrateOneOversizedActiveCover({
        minBytes: 1,
        normalizer: async () => ({ buffer: PNG_1X1, mime: 'image/png' }),
    });

    assert.equal(result.migrated, true);
    assert.equal(fs.existsSync(old.path), false);
    const first = cache.lookupAlias({ canonicalGameId: 'epic:account:product', type: 'cover' });
    const second = cache.lookupAlias({ canonicalGameId: 'epic:account:alias', type: 'cover' });
    assert.ok(first);
    assert.equal(first.assetHash, second.assetHash);
    assert.notEqual(first.assetHash, old.assetHash);

    const restarted = makeCache(root, { activeCoverCacheBytes: Infinity, secondaryCacheBytes: Infinity });
    assert.equal(restarted.lookupAlias({ canonicalGameId: 'epic:account:product', type: 'cover' }).assetHash, first.assetHash);
    assert.equal(restarted.getManifest().stats.normalizedCoverMigrations, 1);
});

test('ContentAddressedArtworkCache protects mixed Steam Epic GOG active-cover aliases across accounts', () => {
    const root = tempDir();
    try {
        const cache = makeCache(root, { activeLibraryGameCount: 3000 });
        const steam = cache.storeBuffer({ canonicalGameId: 'steam:account_a:570', type: 'cover', buffer: PNG_1X1, mime: 'image/png', assetClass: 'active-library-cover' });
        cache.linkAlias({ assetHash: steam.assetHash, canonicalGameId: 'steam:account_b:570', type: 'cover' });
        cache.linkAlias({ assetHash: steam.assetHash, canonicalGameId: 'epic:account_a:fn', type: 'cover' });
        cache.linkAlias({ assetHash: steam.assetHash, canonicalGameId: 'gog:account_a:control', type: 'cover' });
        cache.linkAlias({ assetHash: steam.assetHash, canonicalGameId: 'future:connector:stable_product', type: 'cover' });

        assert.equal(cache.lookupAlias({ canonicalGameId: 'steam:account_a:570', type: 'cover' }).assetHash, steam.assetHash);
        assert.equal(cache.lookupAlias({ canonicalGameId: 'steam:account_b:570', type: 'cover' }).assetHash, steam.assetHash);
        assert.equal(cache.lookupAlias({ canonicalGameId: 'epic:account_a:fn', type: 'cover' }).assetHash, steam.assetHash);
        assert.equal(cache.lookupAlias({ canonicalGameId: 'gog:account_a:control', type: 'cover' }).assetHash, steam.assetHash);
        assert.equal(cache.lookupAlias({ canonicalGameId: 'future:connector:stable_product', type: 'cover' }).assetHash, steam.assetHash);

        const removed = cache.removeAlias({ canonicalGameId: 'steam:account_a:570', type: 'cover' });
        assert.equal(removed.removed, true);
        assert.equal(removed.assetStillReferenced, true, 'unlinking one account must not orphan a shared physical asset');
        assert.equal(cache.lookupAlias({ canonicalGameId: 'steam:account_a:570', type: 'cover' }), null);
        assert.equal(cache.lookupAlias({ canonicalGameId: 'steam:account_b:570', type: 'cover' }).assetHash, steam.assetHash);
        assert.equal(cache.lookupAlias({ canonicalGameId: 'epic:account_a:fn', type: 'cover' }).assetHash, steam.assetHash);
        assert.equal(cache.lookupAlias({ canonicalGameId: 'gog:account_a:control', type: 'cover' }).assetHash, steam.assetHash);

        cache.storeBuffer({ canonicalGameId: 'secondary:hero:one', type: 'hero', buffer: PNG_1X1_ALT, mime: 'image/png', assetClass: 'secondary-artwork' });
        const restarted = makeCache(root, { activeLibraryGameCount: 3000 });
        assert.equal(restarted.lookupAlias({ canonicalGameId: 'steam:account_b:570', type: 'cover' }).assetHash, steam.assetHash);
        assert.equal(restarted.lookupAlias({ canonicalGameId: 'epic:account_a:fn', type: 'cover' }).assetHash, steam.assetHash);
        assert.equal(restarted.lookupAlias({ canonicalGameId: 'gog:account_a:control', type: 'cover' }).assetHash, steam.assetHash);
        assert.equal(restarted.getManifest().stats.evictionsByArtworkClass?.['active-library-cover'] || 0, 0);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
