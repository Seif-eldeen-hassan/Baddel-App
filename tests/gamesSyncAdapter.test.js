'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { GamesSyncAdapter } = require('../src/features/sync/infrastructure/adapters/GamesSyncAdapter');

const ROOT = path.resolve(__dirname, '..');
const ADAPTER_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'adapters', 'GamesSyncAdapter.js');

test('GamesSyncAdapter exports a constructable adapter', () => {
    assert.equal(typeof GamesSyncAdapter, 'function');
    const adapter = new GamesSyncAdapter();
    assert.equal(typeof adapter.getSavedGames, 'function');
    assert.equal(typeof adapter.getLocalSteamGames, 'function');
    assert.equal(typeof adapter.removeEpicNonGameEntries, 'function');
});

test('GamesSyncAdapter lazily resolves and delegates to the Games feature API', async () => {
    const calls = [];
    let featureCalls = 0;
    const api = {
        getSavedGames: async () => {
            calls.push('getSavedGames');
            return [{ id: 'local-1' }];
        },
        getLocalSteamGames: async () => {
            calls.push('getLocalSteamGames');
            return [{ id: 'steam-local-1' }];
        },
        removeEpicNonGameEntries: async (entries) => {
            calls.push(['removeEpicNonGameEntries', entries]);
            return { removed: entries.length };
        },
    };
    const adapter = new GamesSyncAdapter({
        getGamesFeature: () => {
            featureCalls += 1;
            return api;
        },
    });

    assert.equal(featureCalls, 0);
    assert.deepEqual(await adapter.getSavedGames(), [{ id: 'local-1' }]);
    assert.deepEqual(await adapter.getLocalSteamGames(), [{ id: 'steam-local-1' }]);
    const entries = [{ id: 'bad-epic-entry' }];
    assert.deepEqual(await adapter.removeEpicNonGameEntries(entries), { removed: 1 });

    assert.equal(featureCalls, 3);
    assert.deepEqual(calls, [
        'getSavedGames',
        'getLocalSteamGames',
        ['removeEpicNonGameEntries', entries],
    ]);
});

test('GamesSyncAdapter supports a nested getGamesApi feature shape', async () => {
    const adapter = new GamesSyncAdapter({
        getGamesFeature: () => ({
            getGamesApi: () => ({
                getSavedGames: async () => [{ id: 'nested-game' }],
                getLocalSteamGames: async () => [{ id: 'nested-steam' }],
                removeEpicNonGameEntries: async () => 'removed',
            }),
        }),
    });

    assert.deepEqual(await adapter.getSavedGames(), [{ id: 'nested-game' }]);
    assert.deepEqual(await adapter.getLocalSteamGames(), [{ id: 'nested-steam' }]);
    assert.equal(await adapter.removeEpicNonGameEntries([{ id: 'x' }]), 'removed');
});

test('GamesSyncAdapter returns empty no-op fallbacks when Games API methods are absent', async () => {
    const noFeatureAdapter = new GamesSyncAdapter();
    assert.deepEqual(await noFeatureAdapter.getSavedGames(), []);
    assert.deepEqual(await noFeatureAdapter.getLocalSteamGames(), []);
    assert.equal(await noFeatureAdapter.removeEpicNonGameEntries([{ id: 'x' }]), undefined);

    const partialAdapter = new GamesSyncAdapter({ getGamesFeature: () => ({}) });
    assert.deepEqual(await partialAdapter.getSavedGames(), []);
    assert.deepEqual(await partialAdapter.getLocalSteamGames(), []);
    assert.equal(await partialAdapter.removeEpicNonGameEntries([{ id: 'x' }]), undefined);
});

test('GamesSyncAdapter stays free of platform runtime and connector dependencies', () => {
    const source = fs.readFileSync(ADAPTER_PATH, 'utf8');

    for (const forbidden of [
        'electron',
        'steamBridge',
        'legendary',
        'runLegendary',
        'platformSync.js',
        'SyncContainer',
        'main.js',
        'preload.js',
    ]) {
        assert.doesNotMatch(source, new RegExp(forbidden), `${forbidden} should not be imported by GamesSyncAdapter`);
    }
});
