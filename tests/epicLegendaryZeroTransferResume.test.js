'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { EpicLegendaryDownloadAdapter } = require('../src/features/downloads/infrastructure/providers/epic/EpicLegendaryDownloadAdapter');
const { DownloadQueueManager } = require('../src/features/downloads/infrastructure/services/DownloadQueueManager');
const { JsonDownloadRepository } = require('../src/features/downloads/infrastructure/repositories/JsonDownloadRepository');
const { normalizeTask } = require('../src/features/downloads/domain/entities/DownloadTask');

test('real zero-transfer resume line reaches verification and registration without a rejected lifecycle update', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-epic-zero-resume-'));
    const installPath = path.join(root, 'Game');
    fs.mkdirSync(installPath);
    fs.writeFileSync(path.join(installPath, 'Game.exe'), 'fixture executable data');
    let spawned;
    const ready = new Promise(resolve => { spawned = resolve; });
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), pid: 123 });
    const adapter = new EpicLegendaryDownloadAdapter({
        accountResolver: { validateTask: async () => ({ appName: 'TestApp', configPath: path.join(root, 'config') }) },
        runtimeService: {
            createProcess: () => { spawned(); return child; },
            findInstalled: () => ({ install_path: installPath, executable: 'Game.exe', needs_verification: false }),
            installationPath: record => record.install_path,
        },
    });
    const errors = [], snapshots = [];
    t.mock.method(console, 'warn', (...args) => errors.push(args));
    let registrations = 0;
    const manager = new DownloadQueueManager({
        repository: new JsonDownloadRepository({ userDataDir: root }), preflight: {}, autoStart: false,
        providerExecutor: adapter,
        completionRegistrar: { async registerCompletedDownload(_task, receipt) {
            assert.equal(receipt.verification.status, 'passed');
            registrations += 1;
            return { installedGameId: 'epic_TestApp', resolvedExecutablePath: path.join(installPath, 'Game.exe') };
        } },
    });
    await manager.load();
    const task = normalizeTask({ id: 'dl_aaaaaaaaaaaaaaaa', platform: 'epic', installProvider: 'legendary', status: 'resuming', stage: 'resuming', progressSessionId: 'zero-resume', installPath });
    manager.state.tasks = [task];
    manager.state.settings.autoStartNext = false;
    manager.on('snapshot', snapshot => snapshots.push(structuredClone(snapshot)));
    const running = manager.executeActiveTask(task);
    t.after(async () => { await running; await manager.flushCheckpoint(); fs.rmSync(root, { recursive: true, force: true }); });
    await ready;
    // Verbatim sanitized line from live session 853d36ba, 2026-09-03T03:57:26.941Z.
    child.stderr.emit('data', '[cli] INFO: Download size is 0, the game is either already up to date or has not changed. Exiting...\r\n');
    child.emit('close', 0, null);
    await running;
    assert.equal(errors.length, 0);
    assert.equal(registrations, 1);
    assert.equal(manager.findTask(task.id).status, 'completed');
    assert.ok(snapshots.some(snapshot => snapshot.tasks.some(value => value.stage === 'finalizing' && value.status === 'installing')));
});
