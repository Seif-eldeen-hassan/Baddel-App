const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');

const ipcValidation = require('../src/shared/ipc/ipcValidation');
const imageHandlers = require('../handlers/imageHandlers');

test('artwork cache key validator accepts long colon-containing Epic canonical keys without weakening safe IDs', () => {
    const key = 'epic:account_123456789012345678901234567890:product-abcdef_1234567890';
    assert.equal(ipcValidation.assertArtworkCacheKey(key, 'gameId'), key);
    assert.throws(() => ipcValidation.assertSafeId(key, 'gameId'), /contains invalid characters|too long/);
});

test('artwork cache key validator rejects path-like and traversal keys', () => {
    for (const bad of ['epic:acct/product', 'epic:acct\\product', 'epic:acct.product', 'epic:acct product', 'epic:acct..product', 'epic:acct\0product']) {
        assert.throws(() => ipcValidation.assertArtworkCacheKey(bad, 'gameId'), /IPC_INVALID_ARG|invalid|unsafe/);
    }
    assert.throws(() => ipcValidation.assertArtworkCacheKey('x'.repeat(257), 'gameId'), /too long/);
});

test('cache-image accepts Epic canonical artwork key and returns a cached file URL', async () => {
    const handles = new Map();
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'baddel-artwork-key-'));
    try {
        const ipcMain = { handle: (name, fn) => handles.set(name, fn), on: () => {} };
        const calls = [];
        imageHandlers.register(ipcMain, {
            app: { getPath: () => temp },
            path,
            fs,
            dialog: {},
            fileURLToPath: (url) => new URL(url),
            imageWebpCache: { filePathToFileUrl: (p) => 'file:///' + String(p).replace(/\\/g, '/') },
            artworkDownloadManager: {
                async downloadAsset(opts) {
                    calls.push(opts);
                    return opts.structured
                        ? { status: 'downloaded', localUrl: 'file:///cache/epic-cover.webp', remoteCandidate: opts.sourceUrl }
                        : 'file:///cache/epic-cover.webp';
                },
                getStats: () => ({ cacheHits: 0 }),
                recordIpcValidationFailure() {},
            },
            ipcValidation,
            getSavedGames: () => [],
            getMainWindow: () => null,
            _collectImageCacheIdsFromGame: () => {},
            _readReadyToInstallProtectedImageIds: () => [],
            IMAGE_CACHE_PRUNE_GRACE_MS: 0,
            updateGameImage: async () => null,
            setGameArtwork: async () => null,
            resetGameArtwork: async () => null,
            resetGameImage: async () => null,
        });
        const result = await handles.get('cache-image')(null, 'https://cdn.example.test/cover.jpg', 'epic:acct_12345678901234567890:product-abcdef_1234567890', 'cover', { structured: true });
        assert.equal(result.status, 'downloaded');
        assert.equal(result.localUrl, 'file:///cache/epic-cover.webp');
        assert.equal(calls[0].canonicalGameId, 'epic:acct_12345678901234567890:product-abcdef_1234567890');
        assert.equal(calls[0].structured, true);
    } finally {
        await fs.rm(temp, { recursive: true, force: true });
    }
});

test('cache-image reports IPC validation failures as structured errors', async () => {
    const handles = new Map();
    let validationFailures = 0;
    imageHandlers.register({ handle: (name, fn) => handles.set(name, fn), on: () => {} }, {
        app: { getPath: () => os.tmpdir() }, path, fs, dialog: {}, fileURLToPath: (url) => new URL(url),
        imageWebpCache: { filePathToFileUrl: (p) => 'file:///' + String(p).replace(/\\/g, '/') },
        artworkDownloadManager: { downloadAsset: async () => { throw new Error('should not download'); }, getStats: () => ({}), recordIpcValidationFailure: () => { validationFailures += 1; } },
        ipcValidation, getSavedGames: () => [], getMainWindow: () => null,
        _collectImageCacheIdsFromGame: () => {}, _readReadyToInstallProtectedImageIds: () => [], IMAGE_CACHE_PRUNE_GRACE_MS: 0,
        updateGameImage: async () => null, setGameArtwork: async () => null, resetGameArtwork: async () => null, resetGameImage: async () => null,
    });
    const result = await handles.get('cache-image')(null, 'https://cdn.example.test/cover.jpg', 'epic:acct/unsafe', 'cover', { structured: true });
    assert.equal(result.status, 'error');
    assert.equal(result.code, 'IPC_INVALID_ARG');
    assert.equal(validationFailures, 1);
});
