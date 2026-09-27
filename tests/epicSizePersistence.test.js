'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { JsonDownloadRepository } = require('../src/features/downloads/infrastructure/repositories/JsonDownloadRepository');
const { registerDownloadsIpc, CHANNELS } = require('../src/features/downloads/infrastructure/ipc/downloads.ipc');
const { EpicLegendaryDownloadAdapter } = require('../src/features/downloads/infrastructure/providers/epic/EpicLegendaryDownloadAdapter');
const { DownloadQueueManager } = require('../src/features/downloads/infrastructure/services/DownloadQueueManager');
const { normalizeTask } = require('../src/features/downloads/domain/entities/DownloadTask');
test('actual queue file reload and renderer IPC retain public size provenance', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'epic-size-repo-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const repo = new JsonDownloadRepository({ userDataDir: root });
    const task = normalizeTask({ id: 'dl_123456789abcdef0', platform: 'epic', downloadSizeBytes: 600123, installedDiskSizeBytes: 700123, sizeSource: 'legendary-info-manifest', buildVersion: 'v1', access_token: 'SECRET' });
    await repo.writeState({ tasks: [task] }); const reloaded = (await repo.readState()).tasks[0]; assert.equal(reloaded.downloadSizeBytes, 600123);
    const queueManager = new EventEmitter(), sent = [];
    registerDownloadsIpc({ handle() {} }, { container: { queueManager, useCases: {} }, getMainWindow: () => ({ webContents: { send: (channel, payload) => sent.push({ channel, payload: structuredClone(payload) }) } }) });
    queueManager.emit('task-updated', { task: reloaded });
    assert.equal(sent[0].channel, CHANNELS.TASK_UPDATED_EVENT); assert.equal(sent[0].payload.task.downloadSizeBytes, 600123); assert.equal(sent[0].payload.task.sizeSource, 'legendary-info-manifest');
    assert.ok(!JSON.stringify(sent).includes('SECRET'));
});
test('real parser -> adapter -> reconciliation -> telemetry -> task backfills announced network size before byte counters', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'epic-size-runtime-')), installPath = path.join(root, 'Game');
    fs.mkdirSync(installPath); fs.writeFileSync(path.join(installPath, 'Game.exe'), 'executable-fixture');
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), pid: 123 });
    let ready; const spawned = new Promise(resolve => { ready = resolve; });
    const adapter = new EpicLegendaryDownloadAdapter({ accountResolver: { validateTask: async () => ({ appName: 'app', configPath: root }) }, runtimeService: {
        createProcess: () => { ready(); return child; }, findInstalled: () => ({ install_path: installPath, executable: 'Game.exe', needs_verification: false }), installationPath: value => value.install_path,
    } });
    const manager = new DownloadQueueManager({
        repository: new JsonDownloadRepository({ userDataDir: root }), preflight: {}, autoStart: false, providerExecutor: adapter,
        completionRegistrar: {
            async registerCompletedDownload(_task, receipt) {
                return { installedGameId: 'epic_app', resolvedExecutablePath: receipt.verification.executablePath };
            },
        },
    });
    await manager.load(); manager.state.settings.autoStartNext = false;
    const task = normalizeTask({ id: 'dl_123456789abcdef0', status: 'downloading', platform: 'epic', installProvider: 'legendary', providerAppName: 'app', accountId: 'owner', installPath, progressSessionId: 'session' });
    manager.state.tasks = [task]; const running = manager.executeActiveTask(task);
    t.after(async () => { await running; await manager.flushCheckpoint(); fs.rmSync(root, { recursive: true, force: true }); });
    await spawned; await new Promise(resolve => setImmediate(resolve));
    child.stderr.emit('data', '[cli] INFO: Download size: 574.14 MiB\n');
    await new Promise(resolve => setImmediate(resolve));
    const updated = structuredClone(manager.findTask(task.id));
    child.emit('close', 0); await running;
    assert.equal(updated.downloadSizeBytes, Math.round(574.14 * 1024 * 1024)); assert.equal(updated.downloadedBytes, 0);
    assert.equal(updated.downloadSizeSource, 'legendary-runtime-transfer');
    const completed = manager.findTask(task.id); assert.equal(completed.status, 'completed'); assert.equal(completed.downloadSizeBytes, updated.downloadSizeBytes);
    assert.equal(completed.installedDiskSizeBytes, 18); assert.equal(completed.installedSizeSource, 'verified-filesystem');
});
