'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DownloadFileSafetyService } = require('../src/features/downloads/infrastructure/services/DownloadFileSafetyService');
const { DownloadPreflightService } = require('../src/features/downloads/infrastructure/services/DownloadPreflightService');
const { DownloadManagedGameUninstallService } = require('../src/features/downloads/infrastructure/services/DownloadManagedGameUninstallService');
const { DownloadQueueManager } = require('../src/features/downloads/infrastructure/services/DownloadQueueManager');
function fixture(t, platform = 'epic', legacy = false) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'install-root-proof-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const installPath = path.join(root, 'Game');
    const fileSafety = new DownloadFileSafetyService({ protectedRoots: [] });
    const preflight = new DownloadPreflightService({ fileSafety });
    const base = preflight.validateQueuePayload({ platform, installProvider: platform === 'epic' ? 'legendary' : 'gogdl', accountId: 'a', providerProductId: '123', installPath, ...(legacy ? { installRoot: installPath } : {}) });
    const task = { ...base, id: 'dl_test', identityKey: 'test', title: 'Game' };
    Object.assign(task, fileSafety.prepareTaskOwnership(task));
    fs.writeFileSync(path.join(installPath, 'Game.exe'), 'test');
    Object.assign(task, { status: 'completed', installedGameId: platform + '_123', resolvedExecutablePath: path.join(installPath, 'Game.exe'), uninstallEligible: false });
    const game = { id: task.installedGameId, platform, installSource: 'download', installProvider: task.installProvider, installPath, executablePath: task.resolvedExecutablePath };
    const service = new DownloadManagedGameUninstallService({ fileSafety, gamesApi: { getAllGames: () => [game], removeGame: async () => ({ status: 'success' }) } });
    return { root, task, game, fileSafety, service };
}
for (const platform of ['epic', 'gog']) test(`fresh ${platform} exact-folder selection derives parent root and is eligible`, t => {
    const f = fixture(t, platform);
    assert.equal(f.task.installRoot, f.root);
    assert.equal(f.service.isEligible(f.task), true);
});
for (const platform of ['epic', 'gog']) test(`${platform} legacy shape: same installRoot/path rejected, proof-gated metadata recovery restores eligibility`, t => {
    const f = fixture(t, platform, true);
    assert.equal(f.service.isEligible(f.task), false);
    assert.throws(() => f.fileSafety.assertManagedOwnershipProof({ ...f.task, uninstallEligible: true }), /library root/);
    const patch = f.service.recoverInstallRoot(f.task);
    assert.deepEqual(patch, { installRoot: f.root });
    assert.equal(f.service.isEligible({ ...f.task, ...patch }), true);
    assert.equal(f.task.installRoot, f.task.installPath, 'read-only recovery does not mutate task');
});
test('completed reconciliation persists repaired provenance and re-evaluates eligibility idempotently', async t => {
    const f = fixture(t, 'epic', true);
    const manager = Object.create(DownloadQueueManager.prototype);
    Object.assign(manager, { state: { tasks: [f.task] }, clock: Date, managedUninstallService: f.service, completionRegistrar: { recoverCompletedDownload() { throw Error('record already registered'); } } });
    assert.equal(await manager.reconcileCompletedRegistrations(), true);
    assert.equal(manager.state.tasks[0].installRoot, f.root);
    assert.equal(manager.state.tasks[0].uninstallEligible, true);
    assert.equal(await manager.reconcileCompletedRegistrations(), false);
});
for (const field of ['ownershipNonce', 'partialDeletionMarkerPath', 'installParentPath', 'installPathOwnershipPreparedAt', 'installPathPreflightAt', 'installedGameId']) test(`legacy recovery refuses missing ${field}`, t => {
    const f = fixture(t, 'epic', true); delete f.task[field];
    assert.equal(f.service.recoverInstallRoot(f.task), null);
    assert.equal(fs.existsSync(f.task.installPath), true);
});
test('legacy recovery refuses unowned, mismatched and protected folders without synthesizing markers', t => {
    const f = fixture(t, 'epic', true);
    f.game.installSource = 'scanner'; assert.equal(f.service.recoverInstallRoot(f.task), null);
    f.game.installSource = 'download';
    assert.equal(f.service.recoverInstallRoot({ ...f.task, installParentPath: path.dirname(f.root) }), null);
    f.fileSafety.protectedRoots.push(f.root.toLowerCase()); assert.equal(f.service.recoverInstallRoot(f.task), null);
    f.fileSafety.protectedRoots.pop(); fs.unlinkSync(f.task.partialDeletionMarkerPath);
    assert.equal(f.service.recoverInstallRoot(f.task), null);
    assert.equal(fs.existsSync(f.task.partialDeletionMarkerPath), false);
});
test('nested link prevents legacy repair and uninstall, preserving external saves', t => {
    const f = fixture(t, 'epic', true); const saves = path.join(f.root, 'Saves'); fs.mkdirSync(saves); fs.writeFileSync(path.join(saves, 'save.dat'), 'keep');
    fs.symlinkSync(saves, path.join(f.task.installPath, 'redirect'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal(f.service.recoverInstallRoot(f.task), null);
    assert.throws(() => f.fileSafety.assertSafeManagedUninstall({ ...f.task, installRoot: f.root, uninstallEligible: true }), /safe to uninstall/);
    assert.equal(fs.readFileSync(path.join(saves, 'save.dat'), 'utf8'), 'keep');
});
