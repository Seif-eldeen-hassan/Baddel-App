'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    PlatformSyncAssetWriteBackService,
} = require('../src/features/sync/application/services/PlatformSyncAssetWriteBackService');

function makeTempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-asset-writeback-'));
}

function rmDir(dir) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

function mkdirp(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, value) {
    mkdirp(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function fileUrl(filePath) {
    return `file:///${filePath.replace(/\\/g, '/')}`;
}

async function waitFor(assertion, timeoutMs = 2500) {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    while (Date.now() < deadline) {
        try {
            assertion();
            return;
        } catch (err) {
            lastError = err;
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
    }
    if (lastError) throw lastError;
}

function matchById(library, entry) {
    return library.findIndex((game) => game.id === entry.id);
}

test('service processes covers before secondary hero/logo and writes all artwork fields', async () => {
    const dir = makeTempDir();
    try {
        const cacheFile = path.join(dir, 'library.json');
        const entries = [{
            id: 'game-1',
            title: 'Game One',
            platform: 'steam',
            appName: '10',
            coverUrl: 'https://cdn.example/cover.jpg',
            heroUrl: 'https://cdn.example/hero.jpg',
            logoUrl: 'https://cdn.example/logo.png',
        }];
        writeJson(cacheFile, entries);

        const calls = [];
        const coverEvents = [];
        let emitterCount = 0;
        const service = new PlatformSyncAssetWriteBackService();

        await service.cacheLibraryCoversFirst({
            entries,
            downloader: async (assets, gameId) => {
                calls.push({ assets, gameId });
                if (assets.cover) return { cover: 'file:///cache/cover.webp' };
                return { hero: 'file:///cache/hero.webp', logo: 'file:///cache/logo.webp' };
            },
            cacheFile,
            matchFn: matchById,
            emitter: () => { emitterCount++; },
            opts: {
                coverCachedEmitter: (payload) => coverEvents.push(payload),
                coverConcurrency: 1,
                secondaryConcurrency: 1,
                batchSize: 1,
                libUpdatedDebounceMs: 1,
            },
        });

        assert.deepEqual(calls[0], {
            assets: { cover: 'https://cdn.example/cover.jpg' },
            gameId: 'game-1',
        });
        assert.equal(emitterCount, 1);
        assert.deepEqual(coverEvents[0], {
            platform: 'steam',
            accountId: null,
            id: 'game-1',
            title: 'Game One',
            appid: '10',
            namespace: null,
            coverUrl: 'file:///cache/cover.webp',
            image: 'file:///cache/cover.webp',
            defaultImage: 'file:///cache/cover.webp',
            _agCoverPipelineDone: true,
        });

        await waitFor(() => {
            assert.equal(calls.length, 2);
            assert.deepEqual(calls[1], {
                assets: {
                    hero: 'https://cdn.example/hero.jpg',
                    logo: 'https://cdn.example/logo.png',
                },
                gameId: 'game-1',
            });
            const cached = readJson(cacheFile)[0];
            assert.equal(cached.coverUrl, 'file:///cache/cover.webp');
            assert.equal(cached.image, 'file:///cache/cover.webp');
            assert.equal(cached.defaultImage, 'file:///cache/cover.webp');
            assert.equal(cached._agCoverPipelineDone, true);
            assert.equal(cached.heroUrl, 'file:///cache/hero.webp');
            assert.equal(cached.heroImage, 'file:///cache/hero.webp');
            assert.equal(cached.logoUrl, 'file:///cache/logo.webp');
            assert.equal(cached.logo, 'file:///cache/logo.webp');
        });
    } finally {
        rmDir(dir);
    }
});

test('service reuses a valid file cover and skips downloader for that cover', async () => {
    const dir = makeTempDir();
    try {
        const cacheFile = path.join(dir, 'library.json');
        const coverFile = path.join(dir, 'cover.webp');
        fs.writeFileSync(coverFile, 'image', 'utf8');
        const coverUrl = fileUrl(coverFile);
        const entries = [{ id: 'game-1', title: 'Game One', coverUrl }];
        writeJson(cacheFile, entries);

        const calls = [];
        const coverEvents = [];
        const service = new PlatformSyncAssetWriteBackService();

        await service.cacheLibraryCoversFirst({
            entries,
            downloader: async (assets, gameId) => {
                calls.push({ assets, gameId });
                return { cover: 'file:///cache/new-cover.webp' };
            },
            cacheFile,
            matchFn: matchById,
            emitter: null,
            opts: { coverCachedEmitter: (payload) => coverEvents.push(payload), batchSize: 1 },
        });

        assert.deepEqual(calls, []);
        assert.equal(entries[0].coverUrl, coverUrl);
        assert.equal(entries[0].image, coverUrl);
        assert.equal(entries[0].defaultImage, coverUrl);
        assert.equal(entries[0]._agCoverPipelineDone, true);
        assert.equal(coverEvents.length, 1);
        assert.equal(coverEvents[0].coverUrl, coverUrl);
        await waitFor(() => {
            assert.equal(readJson(cacheFile)[0]._agCoverPipelineDone, true);
        });
    } finally {
        rmDir(dir);
    }
});

test('service clears stale file cover and falls back to remote image candidate', async () => {
    const dir = makeTempDir();
    try {
        const cacheFile = path.join(dir, 'library.json');
        const entries = [{
            id: 'game-1',
            title: 'Game One',
            coverUrl: fileUrl(path.join(dir, 'missing.webp')),
            image: 'https://cdn.example/fallback.jpg',
        }];
        writeJson(cacheFile, entries);

        const calls = [];
        const service = new PlatformSyncAssetWriteBackService();
        await service.cacheLibraryCoversFirst({
            entries,
            downloader: async (assets, gameId) => {
                calls.push({ assets, gameId });
                return { cover: 'file:///cache/fallback.webp' };
            },
            cacheFile,
            matchFn: matchById,
            emitter: null,
            opts: { coverConcurrency: 1, batchSize: 1 },
        });

        assert.deepEqual(calls, [{
            assets: { cover: 'https://cdn.example/fallback.jpg' },
            gameId: 'game-1',
        }]);
        assert.equal(entries[0].coverUrl, 'file:///cache/fallback.webp');
        await waitFor(() => {
            assert.equal(readJson(cacheFile)[0].coverUrl, 'file:///cache/fallback.webp');
        });
    } finally {
        rmDir(dir);
    }
});

test('service swallows downloader failures and continues processing other covers', async () => {
    const dir = makeTempDir();
    try {
        const cacheFile = path.join(dir, 'library.json');
        const entries = [
            { id: 'game-fail', title: 'Fail', coverUrl: 'https://cdn.example/fail.jpg' },
            { id: 'game-ok', title: 'OK', coverUrl: 'https://cdn.example/ok.jpg' },
        ];
        writeJson(cacheFile, entries);

        const service = new PlatformSyncAssetWriteBackService();
        await assert.doesNotReject(() => service.cacheLibraryCoversFirst({
            entries,
            downloader: async (_assets, gameId) => {
                if (gameId === 'game-fail') throw new Error('cover failed');
                return { cover: 'file:///cache/ok.webp' };
            },
            cacheFile,
            matchFn: matchById,
            emitter: null,
            opts: { coverConcurrency: 1, batchSize: 1 },
        }));

        assert.equal(entries[0]._agCoverInFlight, false);
        assert.equal(entries[1].coverUrl, 'file:///cache/ok.webp');
        await waitFor(() => {
            const cached = readJson(cacheFile);
            assert.equal(cached[0].coverUrl, 'https://cdn.example/fail.jpg');
            assert.equal(cached[1].coverUrl, 'file:///cache/ok.webp');
        });
    } finally {
        rmDir(dir);
    }
});

test('service uses injected queue adapter for cover and secondary writes', async () => {
    const dir = makeTempDir();
    try {
        const cacheFile = path.join(dir, 'library.json');
        const entries = [{
            id: 'game-1',
            title: 'Game One',
            coverUrl: 'https://cdn.example/cover.jpg',
            heroUrl: 'https://cdn.example/hero.jpg',
        }];
        writeJson(cacheFile, entries);

        let queue = Promise.resolve();
        let enqueueCount = 0;
        const service = new PlatformSyncAssetWriteBackService({
            enqueueWrite: (fn) => {
                enqueueCount++;
                queue = queue.then(fn);
                return queue;
            },
            waitForWrites: async () => {
                await queue;
            },
        });

        await service.cacheLibraryCoversFirst({
            entries,
            downloader: async (assets) => {
                if (assets.cover) return { cover: 'file:///cache/cover.webp' };
                return { hero: 'file:///cache/hero.webp' };
            },
            cacheFile,
            matchFn: matchById,
            emitter: null,
            opts: { coverConcurrency: 1, secondaryConcurrency: 1, batchSize: 1 },
        });

        await waitFor(() => {
            assert.ok(enqueueCount >= 2);
            assert.equal(readJson(cacheFile)[0].heroUrl, 'file:///cache/hero.webp');
        });
    } finally {
        rmDir(dir);
    }
});

test('service tolerates missing cache file and downloader returning no file URLs', async () => {
    const dir = makeTempDir();
    try {
        const cacheFile = path.join(dir, 'missing-library.json');
        const entries = [{ id: 'game-1', coverUrl: 'https://cdn.example/cover.jpg' }];
        const service = new PlatformSyncAssetWriteBackService();

        await assert.doesNotReject(() => service.cacheLibraryCoversFirst({
            entries,
            downloader: async () => ({ cover: 'https://cdn.example/not-local.jpg' }),
            cacheFile,
            matchFn: matchById,
            emitter: null,
            opts: { coverConcurrency: 1 },
        }));

        assert.equal(fs.existsSync(cacheFile), false);
        assert.equal(entries[0].coverUrl, 'https://cdn.example/cover.jpg');
    } finally {
        rmDir(dir);
    }
});
