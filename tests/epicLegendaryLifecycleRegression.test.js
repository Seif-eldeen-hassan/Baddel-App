'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { EpicLegendaryDownloadAdapter } = require('../src/features/downloads/infrastructure/providers/epic/EpicLegendaryDownloadAdapter');
const { EpicLegendaryRuntimeService } = require('../src/features/downloads/infrastructure/providers/epic/EpicLegendaryRuntimeService');
const { EpicLegendaryProgressParser, parseLegendaryProgressLine } = require('../src/features/downloads/infrastructure/providers/epic/EpicLegendaryProgressParser');

function setup(t, modes) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-epic-spawn-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const installPath = path.join(root, 'Game');
    const configPath = path.join(root, 'legendary-config-owner-a');
    const runtime = new EpicLegendaryRuntimeService();
    const calls = [];
    runtime.createProcess = (args, selectedConfig) => {
        calls.push({ args, selectedConfig });
        return spawn(process.execPath, [path.join(__dirname, 'fixtures/legendary/spawned-downloader.cjs'), installPath, selectedConfig, modes.shift()], {
            shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, LEGENDARY_CONFIG_PATH: selectedConfig },
        });
    };
    const adapter = new EpicLegendaryDownloadAdapter({
        runtimeService: runtime,
        accountResolver: { validateTask: async () => ({ appName: 'TestApp', configPath }) },
    });
    const task = { id: 'dl_lifecycle_test', platform: 'epic', installProvider: 'legendary', appName: 'TestApp', accountId: 'owner-a', installPath };
    return { adapter, runtime, task, calls, installPath };
}

test('real child process pauses, retains partial files, resumes and verifies the same installation', { timeout: 15000 }, async t => {
    const { adapter, task, calls, installPath } = setup(t, ['hold', 'complete']);
    let ready;
    const started = new Promise(resolve => { ready = resolve; });
    const first = adapter.start(task, { onProgress: event => { if (event.progressPercent === 50) ready(); } }).catch(error => error.code);
    await started;
    assert.equal((await adapter.pause(task.id)).exitConfirmed, true);
    assert.equal(await first, 'EPIC_DOWNLOAD_STOPPED');
    assert.equal(fs.existsSync(path.join(installPath, '.resume-fixture')), true);
    const events = [];
    const result = await adapter.start(task, { onProgress: event => events.push(event) });
    assert.equal(result.verification.status, 'passed');
    assert.equal(result.verification.executablePath, path.join(installPath, 'TestGame.exe'));
    assert.equal(result.buildId, 'resumed-build');
    assert.equal(result.transfer.totalBytes, Math.round(0.06 * 1024 ** 2));
    assert.ok(events.some(event => event.writtenBytes > 0));
    assert.ok(events.some(event => event.diskUsageBps === 0 && event.telemetryState === 'supported'));
    assert.deepEqual(calls[0], calls[1]);
});

test('real child process auth failure is typed and never exports its token', { timeout: 15000 }, async t => {
    const { adapter, task } = setup(t, ['auth-failure']);
    const events = [];
    await assert.rejects(adapter.start(task, { onProgress: event => events.push(event) }), error => {
        assert.equal(error.code, 'EPIC_AUTH_REQUIRED');
        assert.doesNotMatch(JSON.stringify(error), /fixture-private-token/);
        return true;
    });
    assert.doesNotMatch(JSON.stringify(events), /fixture-private-token/);
});

test('real child cancellation confirms exit and preserves partial files', { timeout: 15000 }, async t => {
    const { adapter, task, installPath } = setup(t, ['hold']);
    let ready;
    const started = new Promise(resolve => { ready = resolve; });
    const running = adapter.start(task, { onProgress: event => { if (event.progressPercent === 50) ready(); } }).catch(error => error.code);
    await started;
    assert.equal((await adapter.cancel(task.id)).exitConfirmed, true);
    assert.equal(await running, 'EPIC_DOWNLOAD_STOPPED');
    assert.equal(fs.existsSync(path.join(installPath, '.resume-fixture')), true);
});

test('cancel during account validation prevents a later process spawn', async () => {
    let resolveAccount;
    let spawned = false;
    const adapter = new EpicLegendaryDownloadAdapter({
        accountResolver: { validateTask: () => new Promise(resolve => { resolveAccount = resolve; }) },
        runtimeService: { createProcess: () => { spawned = true; } },
    });
    const task = { id: 'pending', platform: 'epic', installProvider: 'legendary', installPath: path.resolve('Game') };
    const running = adapter.start(task).catch(error => error.code);
    assert.equal((await adapter.cancel(task.id)).exitConfirmed, true);
    resolveAccount({ appName: 'TestApp', configPath: path.resolve('config') });
    assert.equal(await running, 'EPIC_DOWNLOAD_STOPPED');
    assert.equal(spawned, false);
});

test('a kill request without child close never confirms exit or permits a second process', async () => {
    const child = new EventEmitter();
    Object.assign(child, { pid: 123, stdout: new EventEmitter(), stderr: new EventEmitter(), kill: () => true });
    const adapter = new EpicLegendaryDownloadAdapter({ stopTimeoutMs: 20,
        accountResolver: { validateTask: async () => ({ appName: 'TestApp', configPath: path.resolve('config') }) },
        runtimeService: { createProcess: () => child },
    });
    const task = { id: 'live', platform: 'epic', installProvider: 'legendary', installPath: path.resolve('Game') };
    const running = adapter.start(task).catch(error => error.code);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal((await adapter.pause(task.id)).exitConfirmed, false);
    await assert.rejects(adapter.start(task), error => error.code === 'EPIC_DOWNLOAD_ALREADY_RUNNING');
    child.emit('close', null, 'SIGTERM');
    assert.equal(await running, 'EPIC_DOWNLOAD_STOPPED');
});

test('upstream log fixture separates compressed bytes, written bytes, network, disk zero, and compression percent', () => {
    const events = new EpicLegendaryProgressParser().push(fs.readFileSync(path.join(__dirname, 'fixtures/legendary/upstream-progress.txt'), 'utf8'));
    const size = events.find(event => event.totalBytes != null);
    assert.equal(size.totalBytes, Math.round(0.06 * 1024 ** 2));
    assert.equal(size.progressPercent, null);
    const bytes = events.find(event => event.writtenBytes != null);
    assert.equal(bytes.downloadedBytes, Math.round(0.03 * 1024 ** 2));
    assert.equal(bytes.writtenBytes, Math.round(0.06 * 1024 ** 2));
    const disk = events.find(event => event.diskUsageBps === 0);
    assert.equal(disk.downloadSpeedBps, null);
    assert.equal(parseLegendaryProgressLine('Progress: 100.00% (20/20), ETA: 00:00:00').progressPercent, 100);
});

for (const reason of ['missing-record', 'wrong-path', 'needs-verification', 'missing-executable', 'outside-executable']) {
    test(`zero process exit rejects unsafe completion: ${reason}`, async t => {
        const { adapter, runtime, task } = setup(t, ['complete']);
        const read = runtime.findInstalled.bind(runtime);
        runtime.findInstalled = (...args) => {
            const record = read(...args);
            if (reason === 'missing-record') return null;
            if (reason === 'wrong-path') record.install_path = path.dirname(task.installPath);
            if (reason === 'needs-verification') record.needs_verification = true;
            if (reason === 'missing-executable') record.executable = 'Absent.exe';
            if (reason === 'outside-executable') record.executable = '../Other.exe';
            return record;
        };
        await assert.rejects(adapter.start(task), error => error.code === 'EPIC_POST_INSTALL_VERIFICATION_FAILED');
    });
}
