'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DownloadInstallPlanService } = require('../src/features/downloads/infrastructure/services/DownloadInstallPlanService');
const { InstallSizeResolutionCoordinator } = require('../src/features/downloads/infrastructure/services/InstallSizeResolutionCoordinator');

const GAME_DETAILS = fs.readFileSync(path.join(__dirname, '..', 'src/js/game-details.js'), 'utf8');

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

function service(resolveSizes) {
    return new DownloadInstallPlanService({
        resolveSizes,
        fileSafety: {
            inspectInstallPath() {},
            calculateRequiredBytes({ installedDiskSizeBytes }) { return installedDiskSizeBytes; },
            calculateSafetyMargin() { return 100; },
        },
        fsSync: { existsSync: () => true, statfsSync: () => ({ blocks: 10000, bavail: 9000, bsize: 1 }) },
        pathModule: path.win32,
    });
}

const epic = (accountId = 'epic-owner') => ({
    platform: 'epic', installProvider: 'legendary', accountId, gameId: 'epic-game',
    canonicalGameId: 'epic-game', providerAppName: 'epic-app', providerProductId: 'epic-product',
});
const sizes = { downloadSizeBytes: 1000, installedDiskSizeBytes: 2000, sizeSource: 'legendary-info-manifest' };

test('size prefetch is size-only and never creates or binds an install plan', async () => {
    let seen;
    const instance = service(async payload => { seen = payload; return sizes; });
    const result = await instance.prefetchSize({ ...epic(), installPath: 'F:\\invented', installPlanId: 'bad' });
    assert.equal(result.prefetchStatus, 'ready');
    assert.equal(seen.installPath, undefined);
    assert.equal(seen.installPlanId, undefined);
    assert.equal(instance.plans.size, 0);
});

test('unsupported Steam and Epic official launcher prefetches never reach a provider', async () => {
    let calls = 0;
    const instance = service(async () => { calls += 1; return sizes; });
    assert.equal((await instance.prefetchSize({ platform: 'steam', installProvider: 'steam_client' })).prefetchStatus, 'unsupported');
    assert.equal((await instance.prefetchSize({ ...epic(), installProvider: 'epic_launcher' })).prefetchStatus, 'unsupported');
    assert.equal(calls, 0);
});

test('prefetch and foreground Storage coalesce and Storage still calculates fresh disk state', async () => {
    const gate = deferred();
    let calls = 0;
    const instance = service(async () => { calls += 1; return gate.promise; });
    const prefetch = instance.prefetchSize(epic());
    const foreground = instance.resolve({ ...epic(), installPath: 'F:\\Baddel Games\\Probe' });
    gate.resolve(sizes);
    const [prefetched, plan] = await Promise.all([prefetch, foreground]);
    assert.equal(calls, 1);
    assert.equal(prefetched.prefetchStatus, 'ready');
    assert.equal(plan.installPath, 'F:\\Baddel Games\\Probe');
    assert.equal(plan.freeSpaceBytes, 9000);
    assert.ok(plan.planId);
});

test('failed speculative result is not reused by a foreground install plan', async () => {
    let calls = 0;
    const instance = service(async () => (++calls === 1 ? { sizeReason: 'EPIC_AUTH_REQUIRED' } : sizes));
    assert.equal((await instance.prefetchSize(epic())).prefetchStatus, 'unavailable');
    const plan = await instance.resolve({ ...epic(), installPath: 'F:\\Baddel Games\\Retry' });
    assert.equal(calls, 2);
    assert.equal(plan.downloadSizeBytes, 1000);
});

test('account changes create distinct speculative selections while duplicates coalesce', async () => {
    const gates = [deferred(), deferred()];
    let calls = 0;
    const instance = service(async () => gates[calls++].promise);
    const sameA = instance.prefetchSize(epic('A'));
    const sameB = instance.prefetchSize(epic('A'));
    const changed = instance.prefetchSize(epic('B'));
    gates[0].resolve(sizes);
    gates[1].resolve(sizes);
    await Promise.all([sameA, sameB, changed]);
    assert.equal(calls, 2);
});

test('coordinator bounds provider work and foreground outranks queued speculative work', async () => {
    const started = [];
    const gates = new Map();
    let active = 0;
    let maxActive = 0;
    const coordinator = new InstallSizeResolutionCoordinator({
        maxConcurrency: 2,
        maxBackgroundQueue: 20,
        execute: async payload => {
            started.push(payload.id);
            active += 1;
            maxActive = Math.max(maxActive, active);
            const gate = deferred();
            gates.set(payload.id, gate);
            await gate.promise;
            active -= 1;
            return sizes;
        },
    });
    const first = coordinator.request('b1', { id: 'b1' }, { priority: 'background' });
    const second = coordinator.request('b2', { id: 'b2' }, { priority: 'background' });
    const third = coordinator.request('b3', { id: 'b3' }, { priority: 'background' });
    const duplicate = coordinator.request('b3', { id: 'duplicate-must-not-run' }, { priority: 'background' });
    const foreground = coordinator.request('fg', { id: 'fg' }, { priority: 'foreground' });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(started, ['b1', 'b2']);
    gates.get('b1').resolve();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(started[2], 'fg');
    gates.get('b2').resolve();
    gates.get('fg').resolve();
    await new Promise(resolve => setImmediate(resolve));
    gates.get('b3').resolve();
    await Promise.all([first, second, third, duplicate, foreground]);
    assert.equal(maxActive, 2);
    assert.equal(started.filter(id => id === 'b3').length, 1);
});

test('Game Details schedules eligible direct Epic/GOG prefetch without awaiting first paint', () => {
    const basicDone = GAME_DETAILS.indexOf("_gdRecordStage('GD_POPULATE_BASIC_END')");
    const gogHydrate = GAME_DETAILS.indexOf("_gdRecordStage('GD_GOG_HYDRATE_START')");
    assert.match(GAME_DETAILS, /if \(initialDirectPlatforms\.length === 1\)[\s\S]{0,220}void _gdPrefetchDefaultInstallSize\(game\)/);
    assert.ok(basicDone > 0 && gogHydrate > basicDone, 'GOG hydration starts after the basic shell');
    assert.match(GAME_DETAILS, /void _gdHydrateGogRichRecordForDetails\(compactGogGame\)\.then/);
    assert.match(GAME_DETAILS, /GD_GOG_PREFETCH_SCHEDULED[\s\S]{0,100}void _gdPrefetchDefaultInstallSize\(displayGame\)/);
    assert.match(GAME_DETAILS, /platform === 'epic' \? 'legendary' : 'gogdl'/);
    assert.match(GAME_DETAILS, /_gdInstalledRecordCanLaunch\(game\) \|\| _gdInstalledRecordCanLaunch\(localInstalledMatch\)/);
    assert.match(GAME_DETAILS, /requested-main-account-resolution/);
    assert.match(GAME_DETAILS, /buildPlatformAccountOptions\(\{ game, platform, mode: 'install' \}\)/);
    assert.match(GAME_DETAILS, /void _gdRequestInstallSizePrefetch\(_gdInstallSelectedPlatform, _gdCurrentGame, accountId, _gdInstallSelectedProvider\)/);
});
