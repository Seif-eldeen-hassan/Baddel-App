'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { JsonDownloadRepository } = require('../src/features/downloads/infrastructure/repositories/JsonDownloadRepository');
const { DownloadPreflightService } = require('../src/features/downloads/infrastructure/services/DownloadPreflightService');
const { DownloadQueueManager } = require('../src/features/downloads/infrastructure/services/DownloadQueueManager');
const { DownloadProviderExecutor } = require('../src/features/downloads/infrastructure/services/DownloadProviderExecutor');
const { normalizeTask } = require('../src/features/downloads/domain/entities/DownloadTask');

function completedTask(dir, overrides = {}) {
    return normalizeTask({
        id: 'dl_0123456789abcdef', identityKey: 'gog:a:1:path',
        platform: 'gog', installProvider: 'gogdl', accountId: 'a',
        providerProductId: '1', gogdlAppName: '1', contentSystemProductId: '1',
        ownershipVerified: true, secureLinkVerified: true, verifiedBuildId: 'old-build',
        title: 'Managed Game', installPath: path.join(dir, 'Managed Game'),
        status: 'completed', stage: 'completed', completionConfirmed: true,
        uninstallEligible: true, installedGameId: 'gog_1', completedAt: '2026-09-01T00:00:00.000Z',
        ...overrides,
    });
}

test('update check persists immutable installed and target provider builds', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-maintenance-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const repository = new JsonDownloadRepository({ userDataDir: dir });
    await repository.writeState({ version: 1, tasks: [completedTask(dir)] });
    const provider = {
        supports: () => true,
        checkForUpdate: async () => ({ provider: 'gog', installedBuildId: 'old-build', targetBuildId: 'new-build', updateAvailable: true, checkedAt: '2026-09-04T00:00:00.000Z' }),
    };
    const manager = new DownloadQueueManager({ repository, preflight: new DownloadPreflightService(), providerExecutor: new DownloadProviderExecutor({ providers: [provider] }) });
    await manager.load();
    const result = await manager.checkForUpdate('dl_0123456789abcdef');
    assert.equal(result.update.updateAvailable, true);
    assert.equal(result.task.installedBuildId, 'old-build');
    assert.equal(result.task.targetBuildId, 'new-build');
    const restored = await repository.readState();
    assert.equal(restored.tasks[0].updateAvailable, true);
});

test('clear completed hides history while preserving durable managed update state', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-maintenance-clear-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const repository = new JsonDownloadRepository({ userDataDir: dir });
    await repository.writeState({ version: 1, tasks: [completedTask(dir, {
        updateAvailable: true,
        updateCheckedAt: '2026-09-04T00:00:00.000Z',
        installedBuildId: 'old-build',
        targetBuildId: 'new-build',
    })] });
    const manager = new DownloadQueueManager({ repository, preflight: new DownloadPreflightService() });
    await manager.load();
    const snapshot = await manager.clearCompleted();
    assert.equal(snapshot.tasks.length, 0);
    assert.equal(snapshot.managedInstallations.length, 1);
    assert.equal(snapshot.managedInstallations[0].installedGameId, 'gog_1');
    assert.equal(snapshot.managedInstallations[0].updateAvailable, true);
    const restored = await repository.readState();
    assert.equal(restored.tasks[0].historyHidden, true);
    assert.equal(restored.tasks[0].targetBuildId, 'new-build');
});

test('verified completed GOG history remains managed after Clear Completed even when uninstall proof is unavailable', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-maintenance-receipt-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const repository = new JsonDownloadRepository({ userDataDir: dir });
    await repository.writeState({ version: 1, tasks: [completedTask(dir, {
        uninstallEligible: false,
        providerCompletionReceipt: {
            provider: 'gog', completionConfirmed: true,
            verification: { status: 'passed', executableFound: true, manifestFound: true },
        },
    })] });
    const manager = new DownloadQueueManager({ repository, preflight: new DownloadPreflightService() });
    await manager.load();
    const snapshot = await manager.clearCompleted();
    assert.equal(snapshot.tasks.length, 0);
    assert.equal(snapshot.managedInstallations.length, 1);
    assert.equal(snapshot.managedInstallations[0].maintenanceEligible, true);
    assert.equal((await repository.readState()).tasks[0].historyHidden, true);
});

test('maintenance provider failure preserves the completed managed installation and records a retryable maintenance error', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-maintenance-preserve-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const repository = new JsonDownloadRepository({ userDataDir: dir });
    const receipt = {
        provider: 'gog', completionConfirmed: true,
        verification: { status: 'passed', executableFound: true, manifestFound: true },
    };
    await repository.writeState({ version: 1, settings: { autoStartNext: true }, tasks: [completedTask(dir, {
        uninstallEligible: false, providerCompletionReceipt: receipt,
    })] });
    const providerError = Object.assign(new Error('Reconnect provider account.'), { code: 'GOG_AUTH_REQUIRED' });
    const provider = {
        supports: () => true,
        getCapabilityStatus: async () => ({ supportsRepair: true }),
        start: async () => { throw providerError; },
    };
    const manager = new DownloadQueueManager({
        repository, preflight: new DownloadPreflightService(),
        providerExecutor: new DownloadProviderExecutor({ providers: [provider] }), autoStart: true,
    });
    await manager.load();
    await manager.queueMaintenance({ taskId: 'dl_0123456789abcdef', operationKind: 'repair' });
    for (let i = 0; i < 20 && manager.getSnapshot().activeCount; i += 1) await new Promise(resolve => setTimeout(resolve, 10));
    const snapshot = manager.getSnapshot();
    assert.equal(snapshot.managedInstallations.length, 1);
    assert.equal(snapshot.managedInstallations[0].status, 'completed');
    assert.equal(snapshot.managedInstallations[0].maintenanceErrorCode, 'GOG_AUTH_REQUIRED');
    assert.equal(manager.findTask('dl_0123456789abcdef').completionConfirmed, true);
    assert.deepEqual(manager.findTask('dl_0123456789abcdef').providerCompletionReceipt, receipt);
});

test('legacy managed maintenance without a receipt stays projected while active and restores after failure', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-maintenance-legacy-active-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const repository = new JsonDownloadRepository({ userDataDir: dir });
    await repository.writeState({ version: 1, settings: { autoStartNext: true }, tasks: [completedTask(dir, {
        platform: 'epic', installProvider: 'legendary', providerAppName: 'App', installedGameId: 'epic_App',
        providerCompletionReceipt: null, uninstallEligible: true,
    })] });
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const provider = { supports: () => true, getCapabilityStatus: async () => ({ supportsRepair: true }), start: async () => {
        await gate;
        throw Object.assign(new Error('Reconnect account.'), { code: 'EPIC_AUTH_REQUIRED' });
    } };
    const manager = new DownloadQueueManager({ repository, preflight: new DownloadPreflightService(), providerExecutor: new DownloadProviderExecutor({ providers: [provider] }), autoStart: true });
    await manager.load();
    await manager.queueMaintenance({ taskId: 'dl_0123456789abcdef', operationKind: 'repair' });
    assert.equal(manager.getSnapshot().managedInstallations[0].status, 'preparing');
    release();
    for (let i = 0; i < 20 && manager.getSnapshot().activeCount; i += 1) await new Promise(resolve => setTimeout(resolve, 10));
    const restored = manager.getSnapshot().managedInstallations[0];
    assert.equal(restored.status, 'completed');
    assert.equal(restored.maintenanceErrorCode, 'EPIC_AUTH_REQUIRED');
    assert.equal(manager.findTask('dl_0123456789abcdef').completionConfirmed, true);
});

test('restart repairs a legacy failed maintenance task without deleting installed history', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-maintenance-legacy-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const repository = new JsonDownloadRepository({ userDataDir: dir });
    await repository.writeState({ version: 1, tasks: [completedTask(dir, {
        operationKind: 'repair', status: 'failed', stage: 'failed', completionConfirmed: false,
        errorCode: 'EPIC_AUTH_REQUIRED', errorMessage: 'Reconnect account.', platform: 'epic',
        installProvider: 'legendary', providerAppName: 'App', installedGameId: 'epic_App',
    })] });
    const manager = new DownloadQueueManager({ repository, preflight: new DownloadPreflightService() });
    const snapshot = await manager.load();
    assert.equal(snapshot.managedInstallations.length, 1);
    assert.equal(snapshot.managedInstallations[0].status, 'completed');
    assert.equal(snapshot.managedInstallations[0].maintenanceErrorCode, 'EPIC_AUTH_REQUIRED');
    assert.equal((await repository.readState()).tasks[0].completionConfirmed, true);
});

test('Epic maintenance reconciles stale app metadata only after exact account, game, ownership, and path proof', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-epic-maintenance-reconcile-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const installPath = path.join(dir, 'Epic Game');
    const epic = normalizeTask({
        id: 'dl_eeeeeeeeeeeeeeee', identityKey: 'epic:owner-a:cat:path', title: 'Epic Game',
        platform: 'epic', installProvider: 'legendary', accountId: 'owner-a',
        providerAppName: 'OldApp', appName: 'OldApp', namespace: 'ns', catalogItemId: 'cat',
        ownedByAccountIds: ['owner-a'], ownershipVerified: true, installPath,
        status: 'completed', completionConfirmed: true, uninstallEligible: true,
        installedGameId: 'epic_NewApp', completedAt: '2026-09-01T00:00:00.000Z',
    });
    const repository = new JsonDownloadRepository({ userDataDir: dir });
    await repository.writeState({ version: 1, tasks: [epic] });
    let validated = 0;
    const resolver = { async reconcileMaintenanceTask(task) {
        validated += 1;
        assert.equal(task.accountId, 'owner-a');
        return { task: { ...task, providerAppName: 'NewApp', appName: 'NewApp', ownedByAccountIds: ['owner-a'] } };
    } };
    const provider = { supports: () => true, getCapabilityStatus: async () => ({ supportsRepair: true }) };
    const manager = new DownloadQueueManager({
        repository, preflight: new DownloadPreflightService(),
        providerExecutor: new DownloadProviderExecutor({ providers: [provider] }),
        identityResolvers: { epic: resolver },
        completionRegistrar: { gamesApi: { getAllGames: () => [{ id: 'epic_NewApp', platform: 'epic', installProvider: 'legendary', installPath }] } },
    });
    await manager.load();
    const result = await manager.queueMaintenance({ taskId: epic.id, operationKind: 'repair' });
    assert.equal(validated, 1);
    assert.equal(result.task.providerAppName, 'NewApp');
    assert.equal(result.task.accountId, 'owner-a');
});

test('Epic maintenance rejects installed-path mismatch and cross-account provenance changes', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-epic-maintenance-isolation-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const installPath = path.join(dir, 'Expected');
    const epic = normalizeTask({
        id: 'dl_dddddddddddddddd', identityKey: 'epic:owner-a:cat:path', title: 'Epic Game',
        platform: 'epic', installProvider: 'legendary', accountId: 'owner-a', providerAppName: 'App',
        ownedByAccountIds: ['owner-a'], ownershipVerified: true, installPath,
        status: 'completed', completionConfirmed: true, uninstallEligible: true, installedGameId: 'epic_App',
    });
    const repository = new JsonDownloadRepository({ userDataDir: dir });
    const provider = { supports: () => true, getCapabilityStatus: async () => ({ supportsRepair: true }) };
    await repository.writeState({ version: 1, tasks: [epic] });
    const mismatch = new DownloadQueueManager({
        repository, preflight: new DownloadPreflightService(), providerExecutor: new DownloadProviderExecutor({ providers: [provider] }),
        identityResolvers: { epic: { reconcileMaintenanceTask: async task => ({ task }) } },
        completionRegistrar: { gamesApi: { getAllGames: () => [{ id: 'epic_App', platform: 'epic', installProvider: 'legendary', installPath: path.join(dir, 'Different') }] } },
    });
    await mismatch.load();
    await assert.rejects(() => mismatch.queueMaintenance({ taskId: epic.id, operationKind: 'repair' }), error => error.code === 'EPIC_INSTALL_PATH_MISMATCH');

    const isolated = new DownloadQueueManager({
        repository, preflight: new DownloadPreflightService(), providerExecutor: new DownloadProviderExecutor({ providers: [provider] }),
        identityResolvers: { epic: { reconcileMaintenanceTask: async task => ({ task: { ...task, accountId: 'owner-b' } }) } },
        completionRegistrar: { gamesApi: { getAllGames: () => [{ id: 'epic_App', platform: 'epic', installProvider: 'legendary', installPath }] } },
    });
    await isolated.load();
    await assert.rejects(() => isolated.queueMaintenance({ taskId: epic.id, operationKind: 'repair' }), error => error.code === 'EPIC_ACCOUNT_PROVENANCE_MISMATCH');
});

test('managed installation projection selects one authoritative record per immutable installed game', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-maintenance-projection-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const repository = new JsonDownloadRepository({ userDataDir: dir });
    await repository.writeState({ version: 1, tasks: [
        completedTask(dir, { id: 'dl_aaaaaaaaaaaaaaaa', identityKey: 'gog:a:old:path', taskRevision: 2, updateAvailable: false }),
        completedTask(dir, { id: 'dl_bbbbbbbbbbbbbbbb', identityKey: 'gog:a:new:path', taskRevision: 5, updateAvailable: true, targetBuildId: 'new-build' }),
    ] });
    const manager = new DownloadQueueManager({ repository, preflight: new DownloadPreflightService() });
    await manager.load();
    const projection = manager.getSnapshot().managedInstallations;
    assert.equal(projection.length, 1);
    assert.equal(projection[0].taskId, 'dl_bbbbbbbbbbbbbbbb');
    assert.equal(projection[0].updateAvailable, true);
});

test('provider check failure preserves last-known-good update state', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-maintenance-failure-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const repository = new JsonDownloadRepository({ userDataDir: dir });
    await repository.writeState({ version: 1, tasks: [completedTask(dir, {
        updateAvailable: true,
        updateCheckedAt: '2026-09-04T00:00:00.000Z',
        targetBuildId: 'known-new-build',
    })] });
    const provider = { supports: () => true, checkForUpdate: async () => { throw new Error('provider unavailable'); } };
    const manager = new DownloadQueueManager({ repository, preflight: new DownloadPreflightService(), providerExecutor: new DownloadProviderExecutor({ providers: [provider] }) });
    await manager.load();
    await assert.rejects(() => manager.checkForUpdate('dl_0123456789abcdef'), /provider unavailable/);
    const state = manager.getSnapshot().managedInstallations[0];
    assert.equal(state.updateAvailable, true);
    assert.equal(state.targetBuildId, 'known-new-build');
});

test('concurrent maintenance requests are deduplicated by task and operation', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-maintenance-dedupe-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const repository = new JsonDownloadRepository({ userDataDir: dir });
    await repository.writeState({ version: 1, tasks: [completedTask(dir)] });
    let capabilityChecks = 0;
    const provider = {
        supports: () => true,
        getCapabilityStatus: async () => { capabilityChecks += 1; await new Promise(resolve => setTimeout(resolve, 15)); return { supportsRepair: true }; },
    };
    const manager = new DownloadQueueManager({ repository, preflight: new DownloadPreflightService(), providerExecutor: new DownloadProviderExecutor({ providers: [provider] }) });
    await manager.load();
    const [first, second] = await Promise.all([
        manager.queueMaintenance({ taskId: 'dl_0123456789abcdef', operationKind: 'repair' }),
        manager.queueMaintenance({ taskId: 'dl_0123456789abcdef', operationKind: 'repair' }),
    ]);
    assert.equal(capabilityChecks, 1);
    assert.equal(first.task.id, second.task.id);
    assert.equal(manager.getSnapshot().tasks.filter(task => task.operationKind === 'repair').length, 1);
});

test('different concurrent maintenance operations for one install fail closed', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-maintenance-conflict-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const repository = new JsonDownloadRepository({ userDataDir: dir });
    await repository.writeState({ version: 1, tasks: [completedTask(dir)] });
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const provider = { supports: () => true, getCapabilityStatus: async () => { await gate; return { supportsRepair: true }; } };
    const manager = new DownloadQueueManager({ repository, preflight: new DownloadPreflightService(), providerExecutor: new DownloadProviderExecutor({ providers: [provider] }) });
    await manager.load();
    const repair = manager.queueMaintenance({ taskId: 'dl_0123456789abcdef', operationKind: 'repair' });
    await assert.rejects(() => manager.queueMaintenance({ taskId: 'dl_0123456789abcdef', operationKind: 'update' }), error => error.code === 'DOWNLOAD_MAINTENANCE_ALREADY_PENDING');
    release();
    await repair;
});

test('manual and automatic update checks share one in-flight provider comparison', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-maintenance-check-dedupe-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const repository = new JsonDownloadRepository({ userDataDir: dir });
    await repository.writeState({ version: 1, tasks: [completedTask(dir)] });
    let checks = 0;
    const provider = { supports: () => true, checkForUpdate: async () => { checks += 1; await new Promise(resolve => setImmediate(resolve)); return { installedBuildId: 'same', targetBuildId: 'same', updateAvailable: false }; } };
    const manager = new DownloadQueueManager({ repository, preflight: new DownloadPreflightService(), providerExecutor: new DownloadProviderExecutor({ providers: [provider] }) });
    await manager.load();
    await Promise.all([manager.checkForUpdate('dl_0123456789abcdef'), manager.checkForUpdate('dl_0123456789abcdef')]);
    assert.equal(checks, 1);
});

test('a hidden completed installation can still queue maintenance and returns to Downloads', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-maintenance-hidden-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const repository = new JsonDownloadRepository({ userDataDir: dir });
    await repository.writeState({ version: 1, tasks: [completedTask(dir, { historyHidden: true })] });
    const provider = { supports: () => true, getCapabilityStatus: async () => ({ supportsRepair: true }) };
    const manager = new DownloadQueueManager({ repository, preflight: new DownloadPreflightService(), providerExecutor: new DownloadProviderExecutor({ providers: [provider] }) });
    await manager.load();
    assert.equal(manager.getSnapshot().tasks.length, 0);
    const result = await manager.queueMaintenance({ taskId: 'dl_0123456789abcdef', operationKind: 'repair' });
    assert.equal(result.task.historyHidden, false);
    assert.equal(result.snapshot.tasks.length, 1);
    assert.equal(result.snapshot.tasks[0].status, 'pending');
});

test('successful update completion clears update availability in the shared projection', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-maintenance-complete-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const repository = new JsonDownloadRepository({ userDataDir: dir });
    await repository.writeState({ version: 1, tasks: [completedTask(dir, {
        status: 'verifying', stage: 'verifying', operationKind: 'update', completionConfirmed: false,
        updateAvailable: true, installedBuildId: 'old-build', targetBuildId: 'new-build',
    })] });
    const manager = new DownloadQueueManager({
        repository,
        preflight: new DownloadPreflightService(),
        completionRegistrar: { registerCompletedDownload: async () => ({ installedGameId: 'gog_1', resolvedExecutablePath: path.join(dir, 'Managed Game', 'Game.exe') }) },
        managedUninstallService: { isEligible: () => true },
    });
    await manager.load();
    manager.state.tasks[0] = { ...manager.state.tasks[0], status: 'verifying', stage: 'verifying' };
    const snapshot = await manager.completeTask('dl_0123456789abcdef', {
        provider: 'gog', processExitCode: 0, completionConfirmed: true, buildId: 'new-build',
        transfer: { downloadedBytes: 1, totalBytes: 1, source: 'test-provider' },
        verification: { status: 'passed', actualBytes: 1, verifiedFileCount: 1, executableFound: true, manifestFound: true },
    });
    assert.equal(snapshot.tasks[0].updateAvailable, false);
    assert.equal(snapshot.managedInstallations[0].updateAvailable, false);
    assert.equal(snapshot.managedInstallations[0].installedBuildId, 'new-build');
});

test('repair re-enters the same global queue at the tail and preserves install provenance', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-maintenance-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const repository = new JsonDownloadRepository({ userDataDir: dir });
    const queued = normalizeTask({ id: 'dl_1111111111111111', identityKey: 'epic:a:x:path', title: 'Already queued', platform: 'epic', status: 'pending', installPath: path.join(dir, 'queued') });
    await repository.writeState({ version: 1, tasks: [completedTask(dir), queued] });
    const provider = { supports: task => task.platform === 'gog', getCapabilityStatus: async () => ({ supportsRepair: true }) };
    const manager = new DownloadQueueManager({ repository, preflight: new DownloadPreflightService(), providerExecutor: new DownloadProviderExecutor({ providers: [provider] }) });
    await manager.load();
    const result = await manager.queueMaintenance({ taskId: 'dl_0123456789abcdef', operationKind: 'repair' });
    assert.deepEqual(result.snapshot.tasks.map(task => task.id), ['dl_1111111111111111', 'dl_0123456789abcdef']);
    assert.equal(result.task.operationKind, 'repair');
    assert.equal(result.task.status, 'pending');
    assert.equal(result.task.installPath, path.join(dir, 'Managed Game'));
    assert.equal(result.task.accountId, 'a');
    assert.equal(result.task.completedAt, null);
});

test('update is not queued when provider proves the installed build is current', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-maintenance-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const repository = new JsonDownloadRepository({ userDataDir: dir });
    await repository.writeState({ version: 1, tasks: [completedTask(dir)] });
    const provider = {
        supports: () => true,
        getCapabilityStatus: async () => ({ supportsUpdate: true }),
        checkForUpdate: async () => ({ installedBuildId: 'same', targetBuildId: 'same', updateAvailable: false }),
    };
    const manager = new DownloadQueueManager({ repository, preflight: new DownloadPreflightService(), providerExecutor: new DownloadProviderExecutor({ providers: [provider] }) });
    await manager.load();
    await assert.rejects(() => manager.queueMaintenance({ taskId: 'dl_0123456789abcdef', operationKind: 'update' }), error => error.code === 'DOWNLOAD_UPDATE_NOT_AVAILABLE');
    assert.equal(manager.getSnapshot().tasks[0].status, 'completed');
}
);

test('retry starts the next job when the global queue is idle and auto-start is enabled', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-retry-autostart-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const repository = new JsonDownloadRepository({ userDataDir: dir });
    const failed = normalizeTask({
        id: 'dl_2222222222222222', identityKey: 'epic:a:x:path', title: 'Failed job',
        platform: 'epic', installProvider: 'legendary', accountId: 'a', providerAppName: 'TestApp',
        installPath: path.join(dir, 'Failed Game'), status: 'failed', stage: 'failed', errorCode: 'EPIC_TEST',
    });
    await repository.writeState({ version: 1, tasks: [failed], settings: { autoStartNext: true } });
    const provider = { supports: () => true, start: async () => ({
        provider: 'epic', processExitCode: 0, completionConfirmed: true,
        transfer: { downloadedBytes: 1, totalBytes: 1, source: 'test-provider' },
        verification: { status: 'passed', actualBytes: 1, verifiedFileCount: 1, executableFound: true, executablePath: path.join(dir, 'Failed Game', 'Game.exe'), manifestFound: true },
    }) };
    const manager = new DownloadQueueManager({
        repository,
        preflight: new DownloadPreflightService(),
        providerExecutor: new DownloadProviderExecutor({ providers: [provider] }),
        autoStart: true,
    });
    await manager.load();
    const snapshot = await manager.retry(failed.id);
    assert.equal(snapshot.activeTaskId, failed.id);
    assert.equal(snapshot.tasks[0].status, 'preparing');
    assert.equal(snapshot.tasks[0].retryCount, 1);
    await new Promise(resolve => setTimeout(resolve, 30));
});

test('rapid mixed Repair and Update actions stay single-active, FIFO, lossless, and deduplicated', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-maintenance-content-stress-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const repository = new JsonDownloadRepository({ userDataDir: dir });
    const specs = [
        ['dl_000000000000000a', 'Repair A', 'repair'],
        ['dl_000000000000000b', 'Repair B', 'repair'],
        ['dl_000000000000000c', 'Update C', 'update'],
        ['dl_000000000000000d', 'Repair D', 'repair'],
        ['dl_000000000000000e', 'Update E', 'update'],
    ];
    await repository.writeState({
        version: 1,
        settings: { autoStartNext: true },
        tasks: specs.map(([id, title], index) => completedTask(dir, {
            id, title, identityKey: `gog:a:${index}:path`, installedGameId: `gog_${index}`,
            providerProductId: String(index), gogdlAppName: String(index), contentSystemProductId: String(index),
            installPath: path.join(dir, title),
        })),
    });
    const starts = [];
    const releases = [];
    const startWaiters = [];
    let active = 0;
    let maximumActive = 0;
    const receipt = task => ({
        provider: 'gog', processExitCode: 0, completionConfirmed: true, buildId: task.targetBuildId || task.installedBuildId || 'current',
        transfer: { downloadedBytes: 1, totalBytes: 1, source: 'controlled-provider' },
        verification: { status: 'passed', actualBytes: 1, verifiedFileCount: 1, executableFound: true, manifestFound: true },
    });
    const provider = {
        supports: () => true,
        getCapabilityStatus: async () => ({ supportsRepair: true, supportsUpdate: true }),
        checkForUpdate: async task => ({ installedBuildId: 'old', targetBuildId: `new-${task.id}`, updateAvailable: true }),
        start: task => new Promise(resolve => {
            active += 1;
            maximumActive = Math.max(maximumActive, active);
            starts.push(task.id);
            for (let index = startWaiters.length - 1; index >= 0; index -= 1) {
                if (starts.length < startWaiters[index].count) continue;
                startWaiters.splice(index, 1)[0].resolve();
            }
            releases.push(() => { active -= 1; resolve(receipt(task)); });
        }),
    };
    const manager = new DownloadQueueManager({
        repository,
        preflight: { fileSafety: { prepareTaskOwnership: () => ({}) } },
        providerExecutor: new DownloadProviderExecutor({ providers: [provider] }),
        managedUninstallService: { isEligible: () => true },
        autoStart: false,
    });
    await manager.load();
    const waitFor = predicate => {
        if (predicate(manager.getSnapshot())) return Promise.resolve(manager.getSnapshot());
        return new Promise(resolve => {
            const listener = snapshot => {
                if (!predicate(snapshot)) return;
                manager.off('snapshot', listener);
                resolve(snapshot);
            };
            manager.on('snapshot', listener);
        });
    };
    const waitForStarts = count => starts.length >= count ? Promise.resolve() : new Promise(resolve => startWaiters.push({ count, resolve }));
    await Promise.all(specs.map(([taskId, , operationKind]) => manager.queueMaintenance({ taskId, operationKind })));
    assert.deepEqual(manager.getSnapshot().tasks.map(task => task.id), specs.map(([id]) => id));
    assert.equal(manager.getSnapshot().pendingCount, 5);
    await assert.rejects(
        () => manager.queueMaintenance({ taskId: specs[0][0], operationKind: 'repair' }),
        error => error.code === 'DOWNLOAD_MAINTENANCE_ALREADY_PENDING'
    );
    assert.equal(manager.getSnapshot().tasks.length, 5);

    await manager.startNext();
    await waitForStarts(1);
    assert.equal(manager.getSnapshot().activeCount, 1);
    assert.equal(manager.getSnapshot().pendingCount, 4);
    for (let index = 0; index < specs.length; index += 1) {
        releases[index]();
        if (index + 1 < specs.length) await waitForStarts(index + 2);
        else await waitFor(snapshot => snapshot.pendingCount === 0 && snapshot.activeCount === 0);
    }
    assert.equal(maximumActive, 1);
    assert.deepEqual(starts, specs.map(([id]) => id));
    assert.deepEqual(manager.getSnapshot().tasks.map(task => task.status), specs.map(() => 'completed'));
    assert.equal(manager.getSnapshot().tasks.length, 5);
    assert.equal(new Set(starts).size, 5);
});
