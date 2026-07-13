'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    createGamesFeature,
    getGamesFeature,
} = require('../src/features/games/infrastructure/composition/GamesContainer');

const EXPECTED_EXPORT_KEYS = [
    'scanAllGames',
    'addManualGame',
    'getSavedGames',
    'getMissingInstalledGames',
    'renameGame',
    'removeGame',
    'unhideAllGames',
    'getHiddenGames',
    'restoreSpecificGames',
    'deleteGamePermanently',
    'updateGameImage',
    'resetGameImage',
    'updateGameMetadata',
    'reorderLibrary',
    'getJsonGameRepository',
    'updatePlaytime',
    'saveQualifiedSession',
    'setTimeTrackingEnabled',
    'getTimeTrackingEnabled',
    'refetchMissingImages',
    'getLocalSteamGames',
    'saveFullMetadata',
    'loadFullMetadata',
    'runBackgroundMetadataPipeline',
    'registerLocalMetadataResolver',
    'registerImageDownloader',
    'registerGameImageUpdatedNotifier',
    'removeEpicNonGameEntries',
    'resolutionManager',
    'BaddelEngine',
    '__scannerTest',
];

function makeEngine(games = []) {
    return {
        startGlobalScan: async () => games,
        addManualGame: async () => ({ status: 'success' }),
        getStoredGames: () => games,
        getMissingInstalledGames: () => [],
        renameGame: async () => ({ status: 'success' }),
        removeGame: async () => ({ status: 'success' }),
        unhideAllGames: async () => ({ status: 'success' }),
        getHiddenGames: () => [],
        restoreSpecificGames: async () => ({ status: 'success' }),
        deleteGamePermanently: async () => ({ status: 'success' }),
        updateGameImage: () => ({ status: 'success' }),
        resetGameImage: async () => ({ status: 'success' }),
        updateGameMetadata: async () => ({ status: 'success' }),
        reorderLibrary: async () => ({ status: 'success' }),
        getJsonGameRepository: () => ({ repo: true }),
        updatePlaytime: async () => ({ status: 'success' }),
        saveQualifiedSession: async () => ({ status: 'success' }),
        setTimeTrackingEnabled: async () => ({ status: 'success' }),
        getTimeTrackingEnabled: () => true,
        getLocalSteamGames: async () => [],
        removeEpicNonGameEntries: async () => ({ removed: 0 }),
    };
}

test('createGamesFeature exists and returns an API object', () => {
    const api = createGamesFeature({
        engine: makeEngine(),
        metadataCacheStore: { save: async () => {}, load: async () => null },
        resolutionManager: { setApi() {} },
    });

    assert.equal(typeof createGamesFeature, 'function');
    assert.equal(typeof api, 'object');
    assert.equal(typeof api.scanAllGames, 'function');
});

test('getGamesFeature is exported as a function', () => {
    assert.equal(typeof getGamesFeature, 'function');
});

test('getGamesFeature returns the same API object across calls', () => {
    const a = getGamesFeature();
    const b = getGamesFeature();

    assert.strictEqual(a, b);
});

test('createGamesFeature still returns fresh API objects', () => {
    const options = {
        engine: makeEngine(),
        metadataCacheStore: { save: async () => {}, load: async () => null },
        resolutionManager: { setApi() {} },
    };
    const a = createGamesFeature(options);
    const b = createGamesFeature(options);

    assert.notStrictEqual(a, b);
});

test('getGamesFeature singleton keeps the expected public API keys', () => {
    assert.deepEqual(Object.keys(getGamesFeature()), EXPECTED_EXPORT_KEYS);
});

test('createGamesFeature API contains the expected public export keys', () => {
    const api = createGamesFeature({
        engine: makeEngine(),
        metadataCacheStore: { save: async () => {}, load: async () => null },
        resolutionManager: { setApi() {} },
    });

    assert.deepEqual(Object.keys(api), EXPECTED_EXPORT_KEYS);
    assert.equal(typeof api.BaddelEngine, 'function');
    assert.equal(typeof api.__scannerTest, 'object');
});

test('getSavedGames returns an array from the injected engine', () => {
    const games = [{ id: 'g1', name: 'Game One' }];
    const api = createGamesFeature({
        engine: makeEngine(games),
        metadataCacheStore: { save: async () => {}, load: async () => null },
        resolutionManager: { setApi() {} },
    });

    assert.deepEqual(api.getSavedGames(), games);
});

test('saveFullMetadata and loadFullMetadata call injected metadataCacheStore', async () => {
    const calls = [];
    const cache = {
        async save(gameId, title, platform, meta) {
            calls.push(['save', gameId, title, platform, meta]);
            return { ok: true };
        },
        async load(gameId) {
            calls.push(['load', gameId]);
            return { id: gameId };
        },
    };
    const api = createGamesFeature({
        engine: makeEngine(),
        metadataCacheStore: cache,
        resolutionManager: { setApi() {} },
    });

    assert.deepEqual(await api.saveFullMetadata('g1', 'Game One', 'xbox', { score: 1 }), { ok: true });
    assert.deepEqual(await api.loadFullMetadata('g1'), { id: 'g1' });
    assert.deepEqual(calls, [
        ['save', 'g1', 'Game One', 'xbox', { score: 1 }],
        ['load', 'g1'],
    ]);
});

test('resolutionManager points to injected manager and receives the injected API', () => {
    const calls = [];
    const mrm = {
        setApi(api) {
            calls.push(api);
        },
    };
    const baddelApi = { lookupGame: async () => null };
    const api = createGamesFeature({
        engine: makeEngine(),
        metadataCacheStore: { save: async () => {}, load: async () => null },
        resolutionManager: mrm,
        baddelApi,
    });

    assert.equal(api.resolutionManager, mrm);
    assert.deepEqual(calls, [baddelApi]);
});

test('registered resolver and image callbacks are passed to runBackgroundMetadataPipeline', async () => {
    const seen = [];
    const engine = makeEngine();
    const mrm = { setApi() {} };
    const cache = { save: async () => {}, load: async () => null };
    const api = createGamesFeature({
        engine,
        metadataCacheStore: cache,
        resolutionManager: mrm,
        runBackgroundMetadataPipeline(games, deps) {
            seen.push({ games, deps });
            return Promise.resolve('pipeline-result');
        },
    });
    const resolver = async () => ({});
    const imageDownloader = async () => ({});
    const notifier = () => {};

    api.registerLocalMetadataResolver(resolver);
    api.registerImageDownloader(imageDownloader);
    api.registerGameImageUpdatedNotifier(notifier);

    const games = [{ id: 'g1' }];
    assert.equal(await api.runBackgroundMetadataPipeline(games), 'pipeline-result');
    assert.equal(seen[0].games, games);
    assert.equal(seen[0].deps.engine, engine);
    assert.equal(seen[0].deps.mrm, mrm);
    assert.equal(seen[0].deps.metadataCacheStore, cache);
    assert.equal(seen[0].deps.localMetadataResolver, resolver);
    assert.equal(seen[0].deps.imageDownloadFn, imageDownloader);
    assert.equal(seen[0].deps.gameImageUpdatedFn, notifier);
});

test('registered image callbacks are available to refetchMissingImages runner', async () => {
    const seen = [];
    const engine = makeEngine();
    const api = createGamesFeature({
        engine,
        metadataCacheStore: { save: async () => {}, load: async () => null },
        resolutionManager: { setApi() {} },
        refetchMissingImages(deps) {
            seen.push(deps);
            return Promise.resolve('refetch-result');
        },
    });
    const imageDownloader = async () => ({});
    const notifier = () => {};
    const notifyCallback = () => {};

    api.registerImageDownloader(imageDownloader);
    api.registerGameImageUpdatedNotifier(notifier);

    assert.equal(await api.refetchMissingImages(notifyCallback), 'refetch-result');
    assert.equal(seen[0].engine, engine);
    assert.equal(seen[0].notifyCallback, notifyCallback);
    assert.equal(seen[0].imageDownloadFn, imageDownloader);
    assert.equal(seen[0].gameImageUpdatedFn, notifier);
});
