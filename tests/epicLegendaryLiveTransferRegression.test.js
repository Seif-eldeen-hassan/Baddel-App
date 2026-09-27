'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const fixture = require('./fixtures/legendary/live-transfer-0.20.34.json');
const { parseLegendaryProgressLine } = require('../src/features/downloads/infrastructure/providers/epic/EpicLegendaryProgressParser');
const { EpicLegendaryDownloadAdapter } = require('../src/features/downloads/infrastructure/providers/epic/EpicLegendaryDownloadAdapter');
const { DownloadQueueManager } = require('../src/features/downloads/infrastructure/services/DownloadQueueManager');
const { JsonDownloadRepository } = require('../src/features/downloads/infrastructure/repositories/JsonDownloadRepository');
const { normalizeTask } = require('../src/features/downloads/domain/entities/DownloadTask');
const { registerDownloadsIpc, CHANNELS } = require('../src/features/downloads/infrastructure/ipc/downloads.ipc');

function renderer(task, clock = Date) {
    const source = fs.readFileSync(path.join(__dirname, '../src/js/downloads.js'), 'utf8');
    const window = { electronAPI: {}, CSS: { escape: value => value } };
    const document = { readyState: 'loading', addEventListener() {} };
    vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, `
        window.hooks = {
            set: task => { downloadsSnapshot = { tasks: [task] }; },
            merge: mergeTaskPatch, card: dlTaskCard, percent: dlPresentedPercent,
            effectivePercent: getEffectiveTransferPercent, text: dlDownloadedText,
            status: dlCleanStatus, sync: dlSyncPresentationState, advance: dlAdvancePresentationState,
        };
    })();`), { window, document, console, performance, Date: clock, setInterval, clearInterval });
    window.hooks.set(task);
    return window.hooks;
}

const lines = fixture.chunks.flatMap(chunk => chunk.segments.map(segment => segment.text));
test('real worker startup and all 77 decompressed speed lines are not lifecycle transitions', () => {
    const worker = lines.find(line => line.includes('Starting file writing worker'));
    const event = parseLegendaryProgressLine(worker);
    assert.ok(!event || event.status === 'downloading');
    const speeds = lines.filter(line => line.includes('(decompressed)'));
    assert.equal(speeds.length, 77);
    for (const line of speeds) assert.equal(parseLegendaryProgressLine(line).stage, 'downloading');
    for (const line of ['[DLManager] DEBUG: writing chunk', '[DLManager] DEBUG: Downloading chunk', '[DLManager] DEBUG: verifying worker']) {
        assert.equal(parseLegendaryProgressLine(line), null);
    }
});

test('unknown renderer percentage stays indeterminate and unknown total stays Calculating', () => {
    for (const value of [null, undefined, '']) {
        const task = { id: 'unknown', platform: 'epic', status: 'downloading', stage: 'downloading', progressPercent: value, downloadedBytes: 1048576, downloadSpeedBps: 100000, totalBytes: null };
        const ui = renderer(task);
        assert.equal(ui.percent(task), null);
        assert.equal(ui.effectivePercent(task), null);
        assert.match(ui.text(task), /Calculating/);
        assert.doesNotMatch(ui.card(task, true), />0\.0%</);
    }
    const zero = { id: 'zero', progressPercent: 0 };
    assert.equal(renderer(zero).percent(zero), 0);
});

test('canonical IPC patch uses the committed status after transition normalization', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-epic-canonical-'));
    const manager = new DownloadQueueManager({ repository: new JsonDownloadRepository({ userDataDir: dir }), preflight: {}, autoStart: false });
    await manager.load();
    manager.state.tasks = [normalizeTask({ id: 'dl_aaaaaaaaaaaaaaaa', platform: 'epic', status: 'downloading' })];
    t.after(async () => { await manager.flushCheckpoint(); fs.rmSync(dir, { recursive: true, force: true }); });
    let payload;
    manager.on('task-updated', update => { payload = update; });
    await manager.applyProgress(manager.state.tasks[0].id, { status: 'installing', stage: 'installing' });
    assert.equal(payload.status, 'verifying');
    assert.equal(payload.patch.status, payload.status);
    assert.equal(payload.patch.stage, payload.stage);
    assert.equal(payload.patch.taskRevision, payload.taskRevision);
});

test('real transfer fixture survives adapter, executeActiveTask, reconciliation, telemetry, IPC and renderer', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-epic-live-replay-'));
    const child = Object.assign(new EventEmitter(), { pid: 123, stdout: new EventEmitter(), stderr: new EventEmitter() });
    child.kill = () => { setImmediate(() => child.emit('close', null, 'SIGTERM')); return true; };
    let ready;
    const spawned = new Promise(resolve => { ready = resolve; });
    const adapter = new EpicLegendaryDownloadAdapter({
        runtimeService: { createProcess: () => { ready(); return child; } },
        accountResolver: { validateTask: async () => ({ appName: 'Flounder', configPath: path.join(dir, 'config') }) },
    });
    const samples = [], pending = [], rejected = [], ipc = [], observations = [], renderedStates = [], telemetryTuples = [];
    let timestamp = Date.now();
    const startedAt = timestamp;
    class ReplayClock extends Date {
        constructor(value = timestamp) { super(value); }
        static now() { return timestamp; }
    }
    const manager = new DownloadQueueManager({
        repository: new JsonDownloadRepository({ userDataDir: dir }), preflight: {}, autoStart: false,
        providerExecutor: { start(task, options) { return adapter.start(task, { onProgress(patch) {
            patch.timestamp = timestamp;
            samples.push(structuredClone(patch));
            const result = options.onProgress(patch);
            pending.push(result);
            return result;
        } }); } },
    });
    await manager.load();
    const task = normalizeTask({ id: 'dl_aaaaaaaaaaaaaaaa', title: 'Real transfer replay', platform: 'epic', installProvider: 'legendary', status: 'preparing', progressSessionId: 'replay', installPath: path.join(dir, 'Game') });
    manager.state.tasks = [task];
    const ui = renderer(task, ReplayClock);
    const aggregate = manager.telemetryAggregator.apply.bind(manager.telemetryAggregator);
    manager.telemetryAggregator.apply = (current, sample) => {
        const result = aggregate(current, sample);
        if (sample.downloadedBytes === 1268777) telemetryTuples.push({ input: structuredClone(sample), output: structuredClone(result.patch) });
        return result;
    };
    const apply = manager.applyProgress.bind(manager);
    manager.applyProgress = async (...args) => {
        try { const result = await apply(...args); observations.push(structuredClone(manager.findTask(task.id))); return result; }
        catch (error) { rejected.push(error.code); throw error; }
    };
    registerDownloadsIpc({ handle() {} }, {
        container: { queueManager: manager, useCases: {} },
        getMainWindow: () => ({ webContents: { send(channel, payload) {
            if (channel !== CHANNELS.TASK_UPDATED_EVENT) return;
            ipc.push(structuredClone(payload));
            const rendered = ui.merge(payload);
            const state = ui.sync(rendered);
            ui.advance(rendered, state, performance.now() + 1500);
            renderedStates.push({ task: structuredClone(rendered), percent: ui.percent(rendered), text: ui.text(rendered) });
        } } }),
    });
    const running = manager.executeActiveTask(task);
    t.after(async () => {
        manager.stopIntents.set(task.id, 'cancel');
        await adapter.cancel(task.id);
        await running;
        await manager.flushCheckpoint();
        fs.rmSync(dir, { recursive: true, force: true });
    });
    await spawned;
    for (const chunk of fixture.chunks) {
        timestamp = startedAt + Date.parse(chunk.timestamp) - Date.parse(fixture.chunks[0].timestamp);
        for (const segment of chunk.segments) child[chunk.stream].emit('data', segment.text);
        await Promise.all(pending.splice(0));
    }
    const final = manager.findTask(task.id);
    assert.deepEqual(rejected, [], 'normal transfer must never request an invalid lifecycle transition');
    assert.equal(final.status, 'downloading');
    assert.ok(observations.every(value => !['installing', 'verifying', 'finalizing'].includes(value.status)));
    const first = samples.find(value => value.downloadedBytes === 1268777);
    assert.equal(first.totalBytes, 602029425);
    assert.equal(first.authoritativeTransfer, true);
    assert.equal(first.providerProgressMode, 'absolute');
    assert.equal(first.progressSource, 'legendary-transfer-bytes');
    assert.ok(samples.every(value => value.totalBytes == null || value.downloadedBytes != null), 'no partial transfer tuples');
    const committed = observations.find(value => value.downloadedBytes === 1268777);
    assert.equal(committed.totalBytes, 602029425);
    assert.ok(Math.abs(committed.progressPercent - 0.2107499978) < 0.00001);
    assert.ok(telemetryTuples.length > 0);
    for (const tuple of telemetryTuples) {
        assert.equal(tuple.input.totalBytes, 602029425);
        assert.equal(tuple.output.totalBytes, 602029425);
        assert.equal(tuple.output.downloadedBytes, 1268777);
    }
    const renderedFirst = renderedStates.find(value => value.task.downloadedBytes === 1268777);
    assert.equal(renderedFirst.task.totalBytes, 602029425);
    assert.ok(Math.abs(renderedFirst.percent - 0.2107499978) < 0.00001);
    assert.match(renderedFirst.text, /1\.3 MB/);
    const firstUi = renderer(committed);
    assert.match(firstUi.text(committed), /1\.3 MB/);
    assert.match(firstUi.card(committed, true), />0\.2%</);
    assert.equal(final.downloadedBytes, 195926426);
    assert.equal(final.totalBytes, 602029425);
    assert.ok(final.downloadSpeedBps > 0);
    assert.ok(observations.some(value => value.diskUsageBps > 0));
    assert.equal(final.diskUsageBps, 0, 'the final real disk sample is zero');
    assert.equal(final.telemetryState, 'idle');
    assert.ok(final.etaSeconds > 0);
    assert.doesNotMatch(ui.status(final), /Finalizing/);
    assert.match(ui.status(final), /Downloading|Writing/);
    for (const payload of ipc) {
        assert.equal(payload.status, payload.patch.status);
        assert.equal(payload.stage, payload.patch.stage);
        assert.equal(payload.taskRevision, payload.patch.taskRevision);
    }
    t.diagnostic(JSON.stringify({ realTraceReplayOnly: true, sourceChunks: fixture.chunks.length, speedLines: 77, rejected: rejected.length, ipcEvents: ipc.length, firstBytes: committed.downloadedBytes, totalBytes: final.totalBytes, firstPercent: committed.progressPercent, finalBytes: final.downloadedBytes, diskBps: final.diskUsageBps, peakDiskBps: Math.max(...observations.map(value => value.diskUsageBps || 0)), speedBps: final.downloadSpeedBps, etaSeconds: final.etaSeconds }));
});
