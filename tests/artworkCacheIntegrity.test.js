'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { fileURLToPath } = require('node:url');

const { ContentAddressedArtworkCache } = require('../src/features/games/infrastructure/services/ContentAddressedArtworkCache');

const PNG_1X1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lWv2YQAAAABJRU5ErkJggg==',
    'base64'
);

function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-artwork-integrity-'));
}

function makeCache(root, options = {}) {
    return new ContentAddressedArtworkCache({
        fs,
        path,
        crypto,
        baseDir: path.join(root, 'artwork-cache-v2'),
        logger: { log() {}, warn() {}, error() {} },
        ...options,
    });
}

test('active cover and canonical aliases resolve from a fresh cache instance', () => {
    const root = tempDir();
    try {
        const sourceUrl = 'https://cdn.example/restart-cover.png';
        const cache = makeCache(root, { activeLibraryGameCount: 1 });
        const stored = cache.storeBuffer({
            sourceUrl,
            canonicalGameId: 'steam:account:730',
            type: 'cover',
            buffer: PNG_1X1,
            mime: 'image/png',
            assetClass: 'active-library-cover',
        });
        for (const alias of ['steam:730', '730', 'counter-strike-2']) {
            cache.linkAlias({ assetHash: stored.assetHash, canonicalGameId: alias, type: 'cover' });
        }

        const restarted = makeCache(root, { activeLibraryGameCount: 1 });
        for (const alias of ['steam:account:730', 'steam:730', '730', 'counter-strike-2']) {
            const hit = restarted.lookupAlias({ canonicalGameId: alias, type: 'cover' });
            assert.equal(hit.assetHash, stored.assetHash);
            assert.equal(fileURLToPath(hit.fileUrl), stored.path);
        }
        assert.equal(restarted.lookupUrl(sourceUrl).assetHash, stored.assetHash);
        assert.equal(fs.existsSync(stored.path), true);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('startup scrub removes every manifest reference to a missing physical asset', () => {
    const root = tempDir();
    try {
        const sourceUrl = 'https://cdn.example/deleted-before-restart.png';
        const cache = makeCache(root);
        const stored = cache.storeBuffer({
            sourceUrl,
            canonicalGameId: 'epic:account:offer',
            type: 'cover',
            buffer: PNG_1X1,
            mime: 'image/png',
            assetClass: 'active-library-cover',
        });
        cache.linkAlias({ assetHash: stored.assetHash, canonicalGameId: 'epic:offer', type: 'cover' });
        fs.unlinkSync(stored.path);

        const restarted = makeCache(root);
        const manifest = restarted.getManifest();
        assert.equal(restarted.lookupAlias({ canonicalGameId: 'epic:account:offer', type: 'cover' }), null);
        assert.equal(restarted.lookupAlias({ canonicalGameId: 'epic:offer', type: 'cover' }), null);
        assert.equal(restarted.lookupUrl(sourceUrl), null);
        assert.equal(manifest.assets[stored.assetHash], undefined);
        assert.equal(Object.values(manifest.aliases).some(entry => entry.assetHash === stored.assetHash), false);
        assert.equal(Object.values(manifest.urls).some(entry => entry.assetHash === stored.assetHash), false);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('lookup invalidates stale refs when an asset disappears after cache startup', () => {
    const root = tempDir();
    try {
        const sourceUrl = 'https://cdn.example/deleted-after-startup.png';
        const cache = makeCache(root);
        const stored = cache.storeBuffer({
            sourceUrl,
            canonicalGameId: 'gog:account:product',
            type: 'cover',
            buffer: PNG_1X1,
            mime: 'image/png',
        });
        fs.unlinkSync(stored.path);

        assert.equal(cache.lookupAlias({ canonicalGameId: 'gog:account:product', type: 'cover' }), null);
        assert.equal(cache.lookupUrl(sourceUrl), null);
        const manifest = cache.getManifest();
        assert.equal(manifest.assets[stored.assetHash], undefined);
        assert.equal(Object.values(manifest.aliases).some(entry => entry.assetHash === stored.assetHash), false);
        assert.equal(Object.values(manifest.urls).some(entry => entry.assetHash === stored.assetHash), false);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('journal recovery drops aliases when the interrupted asset file is missing', () => {
    const root = tempDir();
    try {
        const cache = makeCache(root, { activeCoverCacheBytes: Infinity, secondaryCacheBytes: Infinity });
        cache.beginManifestTransaction({ label: 'interrupted-missing-file', batchSize: 50 });
        const stored = cache.storeBuffer({
            sourceUrl: 'https://cdn.example/interrupted.png',
            canonicalGameId: 'epic:interrupted:missing',
            type: 'cover',
            buffer: PNG_1X1,
            mime: 'image/png',
            assetClass: 'active-library-cover',
        });
        fs.unlinkSync(stored.path);

        const recovered = makeCache(root, { activeCoverCacheBytes: Infinity, secondaryCacheBytes: Infinity });
        const manifest = recovered.getManifest();
        assert.equal(recovered.lookupAlias({ canonicalGameId: 'epic:interrupted:missing', type: 'cover' }), null);
        assert.equal(manifest.assets[stored.assetHash], undefined);
        assert.equal(Object.values(manifest.aliases).some(entry => entry.assetHash === stored.assetHash), false);
        assert.equal(Object.values(manifest.urls).some(entry => entry.assetHash === stored.assetHash), false);
        assert.equal(fs.existsSync(path.join(recovered.getRootDir(), 'manifest.transaction-journal.json')), false);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('All Games only accepts managed cache URLs after verification', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'accounts.js'), 'utf8');

    assert.match(source, /window\.__agVerifiedArtworkUrls\s*=\s*window\.__agVerifiedArtworkUrls instanceof Set/);
    assert.match(source, /_agIsManagedArtworkCacheUrl\(s\)[\s\S]{0,180}__agVerifiedArtworkUrls\.has\(s\)/);
    assert.match(source, /const canUseHydratedCover = async[\s\S]{0,240}_agVerifyLocalArtworkUrl\(cover\)/);
    assert.match(source, /if \(!await canUseHydratedCover\(cover\)\) continue;[\s\S]{0,180}__agVerifiedArtworkUrls\.add\(cover\)/);
    assert.match(source, /function _agApplyCachedCoverToGame[\s\S]{0,420}__agVerifiedArtworkUrls\.add\(cover\)/);
    assert.match(source, /function _agApplyCoverToGame[\s\S]{0,760}__agVerifiedArtworkUrls\.add\(nextCover\)/);
    assert.match(source, /localStorage\.removeItem\(key\)[\s\S]{0,140}__agVerifiedArtworkUrls\.add\(record\.localUrl\)/);
});