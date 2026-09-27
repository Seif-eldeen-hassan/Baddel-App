'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { JsonGameRepository } = require('../src/features/games/infrastructure/repositories/JsonGameRepository');
const { JsonDownloadRepository } = require('../src/features/downloads/infrastructure/repositories/JsonDownloadRepository');
const { DownloadCompletionLibraryRegistrar } = require('../src/features/downloads/infrastructure/services/DownloadCompletionLibraryRegistrar');
const { DownloadQueueManager } = require('../src/features/downloads/infrastructure/services/DownloadQueueManager');
const { registerDownloadsIpc, CHANNELS } = require('../src/features/downloads/infrastructure/ipc/downloads.ipc');
const { inspectEpicManagedInstall } = require('../src/features/downloads/domain/services/EpicManagedInstallContract');

function makeGameApi(root) {
    const repository = new JsonGameRepository({
        fs, path, crypto,
        databasePath: path.join(root, 'games-db.json'),
        logger: { log() {}, error() {} },
        keyResolver: game => game.installedGameKey,
    });
    return {
        repository,
        api: {
            getAllGames: () => repository.getAllGames(),
            getSavedGames: () => repository.getSavedGames(),
            async upsertGame(game) { repository.upsertGameRecord(game); },
            saveDatabase: () => repository.saveDatabase(),
            flushDatabase: () => repository.flushDatabase(),
            reconcileManagedInstalledGames: tasks => repository.reconcileManagedInstalledGames(tasks),
        },
    };
}

function epicTask(installPath, overrides = {}) {
    return {
        id: 'dl_1111111111111111',
        identityKey: `epic:legendary:SampleArtifact:${installPath}`,
        gameId: 'epic-catalog-record',
        canonicalGameId: 'epic-catalog-record',
        title: 'Lifecycle Fixture',
        platform: 'epic',
        installProvider: 'legendary',
        accountId: 'owner_account',
        accountDisplayName: 'Owner',
        providerProductId: 'offer-fixture',
        providerAppName: 'SampleArtifact',
        appName: 'SampleArtifact',
        namespace: 'sample-namespace',
        catalogItemId: 'sample-catalog-item',
        ownedByAccountIds: ['owner_account'],
        ownershipVerified: true,
        installPath,
        status: 'downloading',
        stage: 'downloading',
        ...overrides,
    };
}

function receipt(executablePath) {
    return {
        provider: 'epic', processExitCode: 0, completionConfirmed: true,
        transfer: { downloadedBytes: 1024, totalBytes: 1024, source: 'legendary-completion-transfer' },
        verification: { status: 'passed', executableFound: true, executablePath, actualBytes: 1024 },
        buildId: 'fixture-build',
    };
}

async function makeLifecycle(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-epic-lifecycle-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const installPath = path.join(root, 'different-drive', 'Epic Library', 'Lifecycle Fixture');
    fs.mkdirSync(path.join(installPath, 'Binaries'), { recursive: true });
    const executablePath = path.join(installPath, 'Binaries', 'FixtureGame.exe');
    fs.writeFileSync(executablePath, 'fixture executable');
    const { repository: gameRepository, api } = makeGameApi(root);
    const queueRepository = new JsonDownloadRepository({ userDataDir: root });
    await queueRepository.writeState({ ...queueRepository.emptyState(), tasks: [epicTask(installPath)] });
    const timeline = [];
    const registrar = new DownloadCompletionLibraryRegistrar({
        gamesApi: api,
        notifyLibraryUpdated: async games => timeline.push({ event: 'library-updated', games: structuredClone(games) }),
    });
    const manager = new DownloadQueueManager({ repository: queueRepository, preflight: {}, completionRegistrar: registrar });
    manager.on('task-updated', update => timeline.push({ event: 'task-updated', status: update.status, readyToPlay: update.readyToPlay }));
    manager.on('snapshot', snapshot => timeline.push({
        event: 'snapshot',
        status: snapshot.tasks?.[0]?.status || null,
        readyToPlay: snapshot.tasks?.[0]?.readyToPlay === true,
    }));
    await manager.load();
    // The persisted repository correctly recovers interrupted active work as
    // paused; place this fixture at the real provider callback boundary.
    manager.state.tasks[0] = { ...manager.state.tasks[0], status: 'downloading', stage: 'downloading' };
    return { root, installPath, executablePath, gameRepository, api, queueRepository, registrar, manager, timeline };
}

function ipcHarness(container) {
    const handlers = new Map();
    registerDownloadsIpc({ handle: (channel, handler) => handlers.set(channel, handler) }, {
        container: {
            useCases: {},
            ...container,
        },
        getMainWindow: () => null,
    });
    return (channel, payload) => handlers.get(channel)(null, payload);
}

test('completed Epic download commits managed state before Ready and immediately resolves and launches through Legendary', async t => {
    const life = await makeLifecycle(t);
    const completed = await life.manager.completeTask('dl_1111111111111111', receipt(life.executablePath));
    const task = completed.tasks[0];
    const game = life.gameRepository.getAllGames()[0];

    assert.equal(task.status, 'completed');
    assert.equal(task.statusMessage, 'Ready to play');
    assert.equal(task.readyToPlay, true);
    assert.equal(task.installedGameId, game.id);
    assert.deepEqual(inspectEpicManagedInstall(game, task).failedFields, []);
    assert.equal(game.installSource, 'download');
    assert.equal(game.installProvider, 'legendary');
    assert.equal(game.appName, 'SampleArtifact');
    assert.equal(game.namespace, 'sample-namespace');
    assert.equal(game.catalogItemId, 'sample-catalog-item');
    assert.equal(game.installPath, life.installPath);
    assert.equal(game.executablePath, life.executablePath);
    assert.ok(life.timeline.findIndex(item => item.event === 'library-updated') < life.timeline.findIndex(item => item.event === 'snapshot' && item.status === 'completed' && item.readyToPlay));

    const calls = { validated: [], launched: [] };
    const invoke = ipcHarness({
        queueManager: life.manager,
        completionRegistrar: life.registrar,
        epicAccountResolver: { async validateTask(value) { calls.validated.push(value); return { appName: value.appName, configPath: path.join(life.root, 'legendary-config') }; } },
        epicLegendaryRuntime: { async launch(value) { calls.launched.push(value); return { imported: false }; } },
    });
    const resolved = await invoke(CHANNELS.RESOLVE_EPIC_PLAY_TARGET, task.id);
    assert.equal(resolved.status, 'success');
    assert.equal(resolved.route, 'baddel-managed-epic');
    assert.equal(resolved.game.id, game.id);
    assert.equal(resolved.game.managedDownloadTaskId, task.id);

    // The task is authoritative even if a stale renderer hands main a catalog id.
    const launched = await invoke(CHANNELS.LAUNCH_EPIC_LEGENDARY, { gameId: 'stale-catalog-id', accountId: 'owner_account', taskId: task.id });
    assert.deepEqual({ status: launched.status, route: launched.route, method: launched.method }, { status: 'success', route: 'baddel-managed-epic', method: 'legendary' });
    assert.equal(calls.validated[0].installProvider, 'legendary');
    assert.deepEqual(calls.launched[0], { appName: 'SampleArtifact', installPath: life.installPath, configPath: path.join(life.root, 'legendary-config') });
});

test('managed Epic state survives repository and queue restart and resolves without a scan or delay', async t => {
    const life = await makeLifecycle(t);
    await life.manager.completeTask('dl_1111111111111111', receipt(life.executablePath));

    const restartedGames = makeGameApi(life.root);
    const restartedRegistrar = new DownloadCompletionLibraryRegistrar({ gamesApi: restartedGames.api });
    const restartedQueue = new DownloadQueueManager({ repository: new JsonDownloadRepository({ userDataDir: life.root }), preflight: {}, completionRegistrar: restartedRegistrar });
    const snapshot = await restartedQueue.load();
    assert.equal(snapshot.tasks[0].readyToPlay, true);
    const invoke = ipcHarness({
        queueManager: restartedQueue,
        completionRegistrar: restartedRegistrar,
        epicAccountResolver: { async validateTask(value) { return { appName: value.appName, configPath: 'fixture-config' }; } },
        epicLegendaryRuntime: { async launch() { return { imported: false }; } },
    });
    const result = await invoke(CHANNELS.RESOLVE_EPIC_PLAY_TARGET, snapshot.tasks[0].id);
    assert.equal(result.status, 'success');
    assert.equal(result.game.installProvider, 'legendary');
});

test('Epic scanner refresh cannot overwrite managed download provenance', async t => {
    const life = await makeLifecycle(t);
    await life.manager.completeTask('dl_1111111111111111', receipt(life.executablePath));
    const managed = life.gameRepository.getAllGames()[0];
    life.gameRepository.upsertGameRecord({
        id: 'external-scanner-copy', name: managed.name, platform: 'epic', scannerPlatform: 'epic',
        appName: managed.appName, namespace: managed.namespace, catalogItemId: managed.catalogItemId,
        installSource: 'scanner', installProvider: 'epic_launcher',
        installPath: life.installPath, path: life.installPath, executablePath: life.executablePath,
        command: `"${life.executablePath}"`,
    });
    const afterScan = life.gameRepository.getAllGames();
    assert.equal(afterScan.length, 1);
    assert.equal(afterScan[0].id, managed.id);
    assert.equal(afterScan[0].installSource, 'download');
    assert.equal(afterScan[0].installProvider, 'legendary');
});

test('external Epic installs remain external and cannot pass managed validation', async t => {
    const life = await makeLifecycle(t);
    life.gameRepository.upsertGameRecord({
        id: 'external-only', name: 'External Fixture', platform: 'epic', scannerPlatform: 'epic',
        appName: 'ExternalArtifact', installSource: 'scanner', installProvider: 'epic_launcher',
        installPath: life.installPath, path: life.installPath, executablePath: life.executablePath,
    });
    const invoke = ipcHarness({ queueManager: life.manager, completionRegistrar: life.registrar, epicAccountResolver: {}, epicLegendaryRuntime: {} });
    const result = await invoke(CHANNELS.LAUNCH_EPIC_LEGENDARY, { gameId: 'external-only', accountId: 'owner_account' });
    assert.equal(result.status, 'error');
    assert.equal(result.code, 'EPIC_LEGENDARY_INSTALL_NOT_FOUND');
    assert.equal(result.stage, 'managed-install-validation');
});

test('missing or corrupt managed records and missing required Epic identity block Ready to play', async t => {
    const life = await makeLifecycle(t);
    const strippingApi = {
        ...life.api,
        async upsertGame(game) { life.gameRepository.upsertGameRecord({ ...game, appName: null, providerAppName: null }); },
    };
    const registrar = new DownloadCompletionLibraryRegistrar({ gamesApi: strippingApi });
    const manager = new DownloadQueueManager({ repository: life.queueRepository, preflight: {}, completionRegistrar: registrar });
    await manager.load();
    await assert.rejects(() => manager.completeTask('dl_1111111111111111', receipt(life.executablePath)), error => error.code === 'EPIC_MANAGED_INSTALL_INVALID');
    const task = manager.getSnapshot().tasks[0];
    assert.notEqual(task.status, 'completed');
    assert.notEqual(task.readyToPlay, true);

    const invoke = ipcHarness({ queueManager: manager, completionRegistrar: registrar, epicAccountResolver: {}, epicLegendRuntime: {} });
    const missing = await invoke(CHANNELS.LAUNCH_EPIC_LEGENDARY, { gameId: 'missing', accountId: 'owner_account' });
    assert.equal(missing.code, 'EPIC_LEGENDARY_INSTALL_NOT_FOUND');
});

test('account and OS launch failures retain their lifecycle stage', async t => {
    const life = await makeLifecycle(t);
    const snapshot = await life.manager.completeTask('dl_1111111111111111', receipt(life.executablePath));
    const task = snapshot.tasks[0];
    const game = life.gameRepository.getAllGames()[0];
    const accountFailure = ipcHarness({
        queueManager: life.manager, completionRegistrar: life.registrar,
        epicAccountResolver: { async validateTask() { throw Object.assign(new Error('Reconnect Epic.'), { code: 'EPIC_AUTH_REQUIRED' }); } },
        epicLegendaryRuntime: {},
    });
    const auth = await accountFailure(CHANNELS.LAUNCH_EPIC_LEGENDARY, { gameId: game.id, accountId: 'owner_account', taskId: task.id });
    assert.equal(auth.stage, 'account-resolution');

    const launchFailure = ipcHarness({
        queueManager: life.manager, completionRegistrar: life.registrar,
        epicAccountResolver: { async validateTask(value) { return { appName: value.appName, configPath: 'fixture-config' }; } },
        epicLegendaryRuntime: { async launch() { throw Object.assign(new Error('Process start failed.'), { code: 'EPIC_LEGENDARY_PROCESS_FAILED' }); } },
    });
    const failed = await launchFailure(CHANNELS.LAUNCH_EPIC_LEGENDARY, { gameId: game.id, accountId: 'owner_account', taskId: task.id });
    assert.equal(failed.code, 'EPIC_LEGENDARY_PROCESS_FAILED');
    assert.equal(failed.stage, 'epic-launch');
});

test('Game Details ignores a stale external duplicate and consumes the authoritative task target', async () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'game-details.js'), 'utf8');
    const start = source.indexOf('async function _gdResolveInstalledGameForDownloadTask');
    const end = source.indexOf('async function _gdResolveInstalledCurrentGame', start);
    const managed = {
        id: 'managed-record', platform: 'epic', installSource: 'download', installProvider: 'legendary',
        appName: 'SampleArtifact', path: 'X:\\Fixture', command: '"X:\\Fixture\\Game.exe"',
    };
    let calls = 0;
    const context = {
        window: {
            allGamesData: [{ id: 'external-record', platform: 'epic', installSource: 'scanner', installProvider: 'epic_launcher', path: 'X:\\Fixture' }],
            electronAPI: { downloads: { async resolveEpicPlayTarget(taskId) { calls += 1; assert.equal(taskId, 'dl_3333333333333333'); return { status: 'success', game: managed }; } } },
        },
        console,
    };
    vm.createContext(context);
    vm.runInContext(`${source.slice(start, end)}; window.resolveFixture = _gdResolveInstalledGameForDownloadTask;`, context);
    const result = await context.window.resolveFixture({
        id: 'dl_3333333333333333', status: 'completed', readyToPlay: true,
        platform: 'epic', installProvider: 'legendary', installedGameId: 'managed-record',
    });
    assert.equal(calls, 1);
    assert.equal(result.id, 'managed-record');
    assert.equal(result.installProvider, 'legendary');
});
