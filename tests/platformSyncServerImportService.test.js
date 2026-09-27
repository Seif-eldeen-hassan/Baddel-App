'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    PlatformSyncServerImportService,
} = require('../src/features/sync/application/services/PlatformSyncServerImportService');

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function makeBatchResult(status, id = '10') {
    const counts = {
        acceptedCount: 0,
        queuedCount: 0,
        alreadyQueuedCount: 0,
        alreadyExistsCount: 0,
        invalidCount: 0,
        errorCount: 0,
        dedupCount: 0,
    };
    if (status === 'accepted') counts.acceptedCount = 1;
    if (status === 'already_exists' || status === 'needs_enrich') counts.alreadyExistsCount = 1;
    if (status === 'created_and_queued') counts.queuedCount = 1;
    if (status === 'already_queued') counts.alreadyQueuedCount = 1;
    if (status === 'error') counts.errorCount = 1;
    return {
        ...counts,
        results: status === 'accepted' ? [] : [{ id, status }],
    };
}

function makeRateLimitError({ retryAfter } = {}) {
    const err = new Error('rate limited');
    err.status = 429;
    if (retryAfter !== undefined) err.retryAfter = retryAfter;
    return err;
}

function makeRepository(initial = {}) {
    const libraries = {
        steam: clone(initial.steam || []),
        epic: clone(initial.epic || []),
    };
    const calls = {
        readMergedLibrary: [],
        writeMergedLibrary: [],
    };
    return {
        calls,
        async readMergedLibrary(platform) {
            calls.readMergedLibrary.push(platform);
            return clone(libraries[platform] || []);
        },
        async writeMergedLibrary(platform, library) {
            calls.writeMergedLibrary.push({ platform, library: clone(library) });
            libraries[platform] = clone(library);
        },
        getLibrary(platform) {
            return clone(libraries[platform] || []);
        },
    };
}

function makeBaddelApi(overrides = {}) {
    const calls = {
        requestGameEnrichBatch: [],
        lookupGame: [],
        normalizeServerData: [],
    };
    return {
        calls,
        async requestGameEnrichBatch(platform, chunk) {
            calls.requestGameEnrichBatch.push({ platform, chunk: clone(chunk) });
            if (overrides.requestGameEnrichBatch) {
                return overrides.requestGameEnrichBatch(platform, chunk, calls.requestGameEnrichBatch.length);
            }
            return makeBatchResult('accepted', chunk[0]?.id || '10');
        },
        async lookupGame(params) {
            calls.lookupGame.push({ ...params });
            if (overrides.lookupGame) return overrides.lookupGame(params, calls.lookupGame.length);
            return null;
        },
        normalizeServerData(value) {
            calls.normalizeServerData.push(value);
            if (overrides.normalizeServerData) return overrides.normalizeServerData(value);
            return null;
        },
    };
}

function makeHarness({ baddelApi, repository, random = () => 0.5, assetDownloader = null } = {}) {
    const delays = [];
    const emitted = [];
    const logs = [];
    let queue = Promise.resolve();
    const service = new PlatformSyncServerImportService({
        baddelApi,
        syncCacheRepository: repository,
        enqueueWrite: (fn) => {
            queue = queue.then(fn);
            return queue;
        },
        emitLibraryUpdated: (win) => emitted.push(win),
        getWindow: () => ({ id: 'window' }),
        getAssetDownloader: () => assetDownloader,
        sleep: async (ms) => {
            delays.push(ms);
        },
        random,
        logger: {
            log: (...args) => logs.push(['log', ...args]),
            warn: (...args) => logs.push(['warn', ...args]),
            consoleLog: (...args) => logs.push(['consoleLog', ...args]),
            consoleWarn: (...args) => logs.push(['consoleWarn', ...args]),
        },
    });
    return {
        service,
        delays,
        emitted,
        logs,
        async waitForWrites() {
            await queue;
        },
    };
}

async function flushAsync(times = 1) {
    for (let i = 0; i < times; i++) {
        await new Promise((resolve) => setImmediate(resolve));
    }
}

test('service sends deduplicated Baddel API batch payloads for Steam libraries', async () => {
    const repository = makeRepository();
    const baddelApi = makeBaddelApi();
    const { service } = makeHarness({ baddelApi, repository });

    await service.importLibraryToServer('steam', [
        { id: 'steam_10', appName: '10', title: 'Portal' },
        { id: 'steam_10_duplicate', appName: '10', title: 'Duplicate Portal' },
        { id: 'steam_20', appName: '20', title: 'Half-Life 2' },
        { id: 'steam_missing', title: 'Missing AppName' },
    ]);

    assert.equal(baddelApi.calls.requestGameEnrichBatch.length, 1);
    assert.deepEqual(baddelApi.calls.requestGameEnrichBatch[0], {
        platform: 'steam',
        chunk: [
            { id: '10', title: 'Portal' },
            { id: '20', title: 'Half-Life 2' },
            { id: 'missing', title: 'Missing AppName' },
        ],
    });
});

test('service retries 429 batch pages using Retry-After before applying lookup metadata', async () => {
    const repository = makeRepository({
        steam: [{ id: 'steam_10', appName: '10', title: 'Portal' }],
    });
    const baddelApi = makeBaddelApi({
        requestGameEnrichBatch: async (_platform, _chunk, callCount) => {
            if (callCount === 1) throw makeRateLimitError({ retryAfter: '3' });
            return makeBatchResult('already_exists', '10');
        },
        lookupGame: async (params) => ({ id: params.id }),
        normalizeServerData: () => ({ cover: 'https://cdn.example/cover.jpg' }),
    });
    const { service, delays, waitForWrites } = makeHarness({ baddelApi, repository });

    await service.importLibraryToServer('steam', [{ id: 'steam_10', appName: '10', title: 'Portal' }]);
    await flushAsync(4);
    await waitForWrites();

    assert.deepEqual(delays, [3000]);
    assert.equal(baddelApi.calls.requestGameEnrichBatch.length, 2);
    assert.equal(repository.getLibrary('steam')[0].coverUrl, 'https://cdn.example/cover.jpg');
});

test('service uses jittered exponential backoff for 429 pages without Retry-After', async () => {
    const repository = makeRepository();
    const baddelApi = makeBaddelApi({
        requestGameEnrichBatch: async (_platform, _chunk, callCount) => {
            if (callCount === 1) throw makeRateLimitError();
            return makeBatchResult('accepted', '10');
        },
    });
    const { service, delays } = makeHarness({ baddelApi, repository, random: () => 0.5 });

    await service.importLibraryToServer('steam', [{ id: 'steam_10', appName: '10', title: 'Portal' }]);

    assert.deepEqual(delays, [10000]);
    assert.equal(baddelApi.calls.requestGameEnrichBatch.length, 2);
});

test('service retries per-item errors with original item titles and reclassifies success for lookup', async () => {
    const repository = makeRepository({
        steam: [{ id: 'steam_10', appName: '10', title: 'Portal' }],
    });
    const baddelApi = makeBaddelApi({
        requestGameEnrichBatch: async (_platform, _chunk, callCount) => {
            if (callCount === 1) return makeBatchResult('error', '10');
            return makeBatchResult('already_exists', '10');
        },
        lookupGame: async (params) => ({ id: params.id }),
        normalizeServerData: () => ({ heroImage: 'https://cdn.example/hero.jpg' }),
    });
    const { service, waitForWrites } = makeHarness({ baddelApi, repository });

    await service.importLibraryToServer('steam', [{ id: 'steam_10', appName: '10', title: 'Portal' }]);
    await flushAsync(6);
    await waitForWrites();

    assert.deepEqual(baddelApi.calls.requestGameEnrichBatch[1], {
        platform: 'steam',
        chunk: [{ id: '10', title: 'Portal' }],
    });
    assert.deepEqual(baddelApi.calls.lookupGame, [{ platform: 'steam', id: '10' }]);
    assert.equal(repository.getLibrary('steam')[0].heroUrl, 'https://cdn.example/hero.jpg');
});

test('service delayed-polls created_and_queued results and writes normalized metadata', async () => {
    const repository = makeRepository({
        steam: [{ id: 'steam_10', appName: '10', title: 'Portal' }],
    });
    const baddelApi = makeBaddelApi({
        requestGameEnrichBatch: async () => makeBatchResult('created_and_queued', '10'),
        lookupGame: async (params, callCount) => callCount === 1 ? null : { id: params.id },
        normalizeServerData: (value) => value && ({ logo: 'https://cdn.example/logo.png' }),
    });
    const { service, delays, waitForWrites } = makeHarness({ baddelApi, repository });

    await service.importLibraryToServer('steam', [{ id: 'steam_10', appName: '10', title: 'Portal' }]);
    await flushAsync(6);
    await waitForWrites();

    assert.deepEqual(baddelApi.calls.lookupGame, [
        { platform: 'steam', id: '10' },
        { platform: 'steam', id: '10' },
    ]);
    assert.deepEqual(delays, [12000, 15000]);
    assert.equal(repository.getLibrary('steam')[0].logoUrl, 'https://cdn.example/logo.png');
});

test('service delayed-polls already_queued results and gives up after three empty lookups', async () => {
    const repository = makeRepository({
        steam: [{ id: 'steam_10', appName: '10', title: 'Portal', coverUrl: null }],
    });
    const baddelApi = makeBaddelApi({
        requestGameEnrichBatch: async () => makeBatchResult('already_queued', '10'),
        lookupGame: async () => null,
        normalizeServerData: () => null,
    });
    const { service, delays, logs, waitForWrites } = makeHarness({ baddelApi, repository });

    await service.importLibraryToServer('steam', [{ id: 'steam_10', appName: '10', title: 'Portal' }]);
    await flushAsync(8);
    await waitForWrites();

    assert.equal(baddelApi.calls.lookupGame.length, 3);
    assert.deepEqual(delays, [12000, 15000, 15000]);
    assert.equal(repository.getLibrary('steam')[0].coverUrl, null);
    assert.ok(logs.some((entry) => String(entry[1]).includes('giving up for 10 after 3 attempts')));
});

test('service writes normalized cover hero logo release year and emits library updates', async () => {
    const repository = makeRepository({
        steam: [{ id: 'steam_10', appName: '10', title: 'Portal' }],
    });
    const baddelApi = makeBaddelApi({
        requestGameEnrichBatch: async () => makeBatchResult('already_exists', '10'),
        lookupGame: async (params) => ({ id: params.id }),
        normalizeServerData: () => ({
            cover: 'https://cdn.example/cover.jpg',
            heroImage: 'https://cdn.example/hero.jpg',
            logo: 'https://cdn.example/logo.png',
            info: { releaseDate: '2007-10-10' },
        }),
    });
    const { service, emitted, waitForWrites } = makeHarness({ baddelApi, repository });

    await service.importLibraryToServer('steam', [{ id: 'steam_10', appName: '10', title: 'Portal' }]);
    await waitForWrites();

    const cached = repository.getLibrary('steam')[0];
    assert.equal(cached.coverUrl, 'https://cdn.example/cover.jpg');
    assert.equal(cached.heroUrl, 'https://cdn.example/hero.jpg');
    assert.equal(cached.logoUrl, 'https://cdn.example/logo.png');
    assert.equal(cached.releaseYear, '2007-10-10');
    assert.equal(emitted.length >= 1, true);
});

test('service invokes asset downloader without persisting managed cache file URLs', async () => {
    const repository = makeRepository({
        steam: [{ id: 'steam_10', appName: '10', title: 'Portal' }],
    });
    const baddelApi = makeBaddelApi({
        requestGameEnrichBatch: async () => makeBatchResult('already_exists', '10'),
        lookupGame: async (params) => ({ id: params.id }),
        normalizeServerData: () => ({
            cover: 'https://cdn.example/cover.jpg',
            heroImage: 'https://cdn.example/hero.jpg',
            logo: 'https://cdn.example/logo.png',
        }),
    });
    const downloaderCalls = [];
    const assetDownloader = async (assets, gameId) => {
        downloaderCalls.push({ assets, gameId });
        return {
            cover: 'file:///cache/cover.webp',
            hero: 'file:///cache/hero.webp',
            logo: 'file:///cache/logo.webp',
        };
    };
    const { service, emitted, waitForWrites } = makeHarness({ baddelApi, repository, assetDownloader });

    await service.importLibraryToServer('steam', [{ id: 'steam_10', appName: '10', title: 'Portal' }]);
    await waitForWrites();
    await waitForWrites();

    assert.deepEqual(downloaderCalls, [{
        assets: {
            cover: 'https://cdn.example/cover.jpg',
            hero: 'https://cdn.example/hero.jpg',
            logo: 'https://cdn.example/logo.png',
        },
        gameId: 'steam_10',
    }]);
    const cached = repository.getLibrary('steam')[0];
    assert.equal(cached.coverUrl, 'https://cdn.example/cover.jpg');
    assert.equal(cached.heroUrl, 'https://cdn.example/hero.jpg');
    assert.equal(cached.logoUrl, 'https://cdn.example/logo.png');
    assert.equal(emitted.length >= 1, true);
});


test('service applies lookup metadata with one merged-library write and one notification per metadata page', async () => {
    const repository = makeRepository({
        steam: Array.from({ length: 3 }, (_, i) => ({ id: `steam_${i + 1}`, appName: String(i + 1), title: `Game ${i + 1}`, ownedByAccountIds: ['acct'] })),
    });
    const baddelApi = makeBaddelApi({
        requestGameEnrichBatch: async (_platform, chunk) => ({
            acceptedCount: 0,
            queuedCount: 0,
            alreadyQueuedCount: 0,
            alreadyExistsCount: chunk.length,
            invalidCount: 0,
            errorCount: 0,
            dedupCount: 0,
            results: chunk.map(item => ({ id: item.id, status: 'already_exists' })),
        }),
        lookupGame: async (params) => ({ id: params.id }),
        normalizeServerData: (value) => ({ cover: `https://cdn.example/${value.id}.jpg` }),
    });
    const { service, emitted, waitForWrites } = makeHarness({ baddelApi, repository });

    await service.importLibraryToServer('steam', Array.from({ length: 3 }, (_, i) => ({ id: `steam_${i + 1}`, appName: String(i + 1), title: `Game ${i + 1}` })));
    await waitForWrites();

    assert.equal(repository.calls.readMergedLibrary.length, 1);
    assert.equal(repository.calls.writeMergedLibrary.length, 1);
    assert.equal(emitted.length, 1);
    assert.equal(repository.getLibrary('steam')[2].coverUrl, 'https://cdn.example/3.jpg');
});

test('cold Steam library record with no initial artwork candidates receives cover from metadata import without reopening All Games', async () => {
    const repository = makeRepository({
        steam: [{
            id: 'steam_10',
            appName: '10',
            title: 'Portal',
            coverUrl: null,
            heroUrl: null,
            logoUrl: null,
            ownedByAccountIds: ['acct'],
        }],
    });
    const baddelApi = makeBaddelApi({
        requestGameEnrichBatch: async () => makeBatchResult('already_exists', '10'),
        lookupGame: async (params) => ({ id: params.id }),
        normalizeServerData: () => ({ cover: 'https://cdn.example/steam-10-cover.jpg' }),
    });
    const downloaderCalls = [];
    const assetDownloader = async (assets, gameId, options = {}) => {
        downloaderCalls.push({ assets, gameId, options });
        return { cover: 'file:///cache/steam-10-cover.webp' };
    };
    const { service, emitted, waitForWrites } = makeHarness({ baddelApi, repository, assetDownloader });

    await service.importLibraryToServer('steam', [{
        id: 'steam_10',
        appName: '10',
        title: 'Portal',
        coverUrl: null,
        heroUrl: null,
        logoUrl: null,
    }]);
    await waitForWrites();
    await flushAsync(2);

    const cached = repository.getLibrary('steam')[0];
    assert.equal(cached.coverUrl, 'https://cdn.example/steam-10-cover.jpg');
    assert.equal(repository.calls.writeMergedLibrary.length, 1);
    assert.equal(emitted.length, 1);
    assert.equal(downloaderCalls.length, 1);
    assert.deepEqual(downloaderCalls[0].assets, {
        cover: 'https://cdn.example/steam-10-cover.jpg',
        hero: null,
        logo: null,
    });
    assert.equal(downloaderCalls[0].gameId, 'steam_10');
    assert.equal(downloaderCalls[0].options.reason, 'platform-sync-metadata-batch');
});
