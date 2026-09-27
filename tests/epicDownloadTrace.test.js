'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const vm = require('node:vm');
const { EpicDownloadTrace, configureEpicTrace, epicTrace, taskValues } = require('../src/features/downloads/infrastructure/services/EpicDownloadTrace');
const { EpicLegendaryProgressParser } = require('../src/features/downloads/infrastructure/providers/epic/EpicLegendaryProgressParser');
const { EpicLegendaryDownloadAdapter } = require('../src/features/downloads/infrastructure/providers/epic/EpicLegendaryDownloadAdapter');
const { DownloadQueueManager } = require('../src/features/downloads/infrastructure/services/DownloadQueueManager');
const { JsonDownloadRepository } = require('../src/features/downloads/infrastructure/repositories/JsonDownloadRepository');
const { normalizeTask } = require('../src/features/downloads/domain/entities/DownloadTask');
const { registerDownloadsIpc, CHANNELS } = require('../src/features/downloads/infrastructure/ipc/downloads.ipc');

// These inputs test diagnostic fidelity only. They are NOT a captured live Epic regression.
const SAMPLE = '[cli] INFO: Download size: 10.00 MiB\r\n' +
    '[DLManager] INFO: = Progress: 10.00% (1/10), Running for 00:00:01, ETA: 00:00:09\n' +
    '[DLManager] INFO:  - Downloaded: 1.00 MiB, Written: 2.00 MiB\r' +
    '[DLManager] INFO:  + Download\t- 1.00 MiB/s (raw) / 2.00 MiB/s (decompressed)\n' +
    '[DLManager] INFO:  + Disk\t- 0.00 MiB/s (write) / 0.00 MiB/s (read)\n';

function setup(t, extra = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-epic-trace-'));
    const executable = path.join(dir, 'runtime-test.bin');
    fs.writeFileSync(executable, 'not executable; diagnostic test hash input only');
    const options = { userDataDir: dir, enabled: true, probe: async (_exe, args) => ({ args, code: 0, stdout: args[0] === 'install' ? '--dlm-debug' : 'test version', stderr: '' }), ...extra };
    const trace = new EpicDownloadTrace(options);
    const runtime = { getRuntime: () => ({ legendaryPath: executable }), runtimeOptions: { projectRoot: path.resolve(__dirname, '..'), isPackaged: false } };
    const task = { id: 'dl_aaaaaaaaaaaaaaaa', platform: 'epic', installProvider: 'legendary', status: 'downloading', progressSessionId: 'session-one', installPath: path.join(dir, 'Game') };
    t.after(async () => {
        await epicTrace.flush(task.id);
        await trace.flush(task.id);
        configureEpicTrace({ enabled: false });
        const resolved = path.resolve(dir);
        assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
        fs.rmSync(resolved, { recursive: true, force: true });
    });
    return { dir, trace, runtime, task, options };
}

async function records(trace, task) {
    await trace.flush(task.id);
    return fs.readFileSync(trace.sessions.get(task.id).path, 'utf8').trim().split('\n').map(line => JSON.parse(line));
}

test('disabled diagnostic performs no probe, filesystem write or runtime lookup', async () => {
    const trace = new EpicDownloadTrace({ enabled: false });
    assert.equal(await trace.begin({ platform: 'epic', installProvider: 'legendary' }, { getRuntime() { throw new Error('must not run'); } }), false);
    assert.equal(trace.sessions.size, 0);
});

test('parser observer preserves current events for every chunk boundary, CR/LF and tabs', () => {
    const expected = new EpicLegendaryProgressParser().push(SAMPLE);
    for (let split = 0; split <= SAMPLE.length; split++) {
        const observed = [];
        const parser = new EpicLegendaryProgressParser({ onLine: (line, event) => { if (event) observed.push(event); } });
        const actual = [...parser.push(SAMPLE.slice(0, split)), ...parser.push(SAMPLE.slice(split)), ...parser.flush()];
        assert.deepEqual(actual, expected);
        assert.deepEqual(observed, expected);
    }
    const broken = new EpicLegendaryProgressParser({ onLine() { throw new Error('diagnostic failure'); } });
    assert.deepEqual(broken.push(SAMPLE), expected);
});

test('probe records exact path, hash, stream-separated info commands and config path without reading credentials', async t => {
    const { trace, runtime, task, dir } = setup(t);
    assert.equal(await trace.begin(task, runtime, path.join(dir, 'isolated-account')), true);
    const rows = await records(trace, task);
    assert.match(rows.find(row => row.event === 'RUNTIME_PROBE').payload.sha256, /^[a-f0-9]{64}$/);
    assert.equal(rows[0].payload.configPath, path.join(dir, 'isolated-account'));
    assert.equal(rows[1].payload.commands.length, 3);
    assert.ok(Object.values(rows[1].payload.sourceHashes).every(value => /^[a-f0-9]{64}$/.test(value)));
    assert.equal(JSON.parse(fs.readFileSync(path.join(trace.directory, 'latest-session.json'))).path, trace.sessions.get(task.id).path);
});

test('raw redaction protects secrets split at every byte and preserves numeric line framing and stream order', async t => {
    const { trace, runtime, task } = setup(t);
    await trace.begin(task, runtime, 'isolated-test-account');
    const secrets = ['access_token', 'refresh_token', 'authorization', 'authorization_code', 'exchange_code', 'cookie', 'sid', 'Bearer'];
    for (const key of secrets) {
        for (const char of `${key}: PRIVATE_SECRET_VALUE\r\n`) trace.raw(task.id, 'stderr', Buffer.from(char));
    }
    for (const char of 'authorization:\nPRIVATE_MULTILINE_VALUE\n') trace.raw(task.id, 'stdout', char);
    trace.raw(task.id, 'stdout', '[DLManager] INFO: clean boundary\n');
    trace.raw(task.id, 'stdout', SAMPLE);
    trace.raw(task.id, 'stderr', '[DLManager] INFO: clean boundary\n');
    trace.raw(task.id, 'stderr', SAMPLE);
    trace.endProvider(task.id, 0, null, null);
    const rows = await records(trace, task);
    const encoded = JSON.stringify(rows);
    assert.ok(!encoded.includes('PRIVATE_SECRET_VALUE'));
    assert.ok(!encoded.includes('PRIVATE_MULTILINE_VALUE'));
    assert.ok(rows.some(row => row.event === 'RAW_LINE' && row.payload.rawSanitizedLine.includes('Downloaded: 1.00 MiB')));
    assert.ok(rows.some(row => row.event === 'RAW_LINE' && row.payload.rawSanitizedLine.includes('\t')));
    const chunks = rows.filter(row => row.event === 'RAW_CHUNK_RECEIVED');
    assert.ok(chunks.every((row, index) => row.payload.chunkId === index + 1));
    const segments = rows.filter(row => row.event === 'RAW_CHUNK_SEGMENT' && row.payload.chunkId === chunks.at(-1).payload.chunkId);
    assert.equal(segments.map(row => row.payload.rawSanitizedChunk).join(''), SAMPLE);
    assert.ok(trace.sessions.get(task.id).writes < rows.length / 10);
});

test('trace safety limits explicitly mark an incomplete trace', async t => {
    const { trace, task } = setup(t, { maxBytes: 50 });
    trace.sessions.set(task.id, { id: 'test', seq: 0, buffer: [], bufferedBytes: 0, bytes: 0, chain: Promise.resolve(), path: path.join(trace.directory || '', 'unused'), disabled: false });
    trace.record(task.id, 'TOO_LARGE', { text: 'large' });
    const session = trace.sessions.get(task.id);
    assert.equal(session.disabled, true);
    assert.match(session.buffer[0], /TRACE_TRUNCATED/);
    clearTimeout(session.timer);
    trace.sessions.delete(task.id);
});

test('diagnostic pipeline observes adapter, reconciliation, telemetry, queue and actual IPC with one correlation; semantics remain unchanged', async t => {
    const { dir, runtime, task, options } = setup(t);
    configureEpicTrace(options);
    const child = new EventEmitter();
    child.pid = 123;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => { setImmediate(() => child.emit('close', null, 'SIGTERM')); return true; };
    let spawnArgs;
    let spawned;
    const ready = new Promise(resolve => { spawned = resolve; });
    runtime.createProcess = args => { spawnArgs = args; spawned(); return child; };
    const repository = new JsonDownloadRepository({ userDataDir: dir });
    const manager = new DownloadQueueManager({ repository, preflight: {}, autoStart: false });
    await manager.load();
    manager.state.tasks = [normalizeTask(task)];
    const handlers = new Map();
    const sent = [];
    registerDownloadsIpc({ handle: (channel, handler) => handlers.set(channel, handler) }, {
        container: { queueManager: manager, useCases: {} },
        getMainWindow: () => ({ webContents: { send: (channel, payload) => sent.push({ channel, payload }) } }),
    });
    const adapter = new EpicLegendaryDownloadAdapter({ runtimeService: runtime, accountResolver: { validateTask: async () => ({ appName: 'TestApp', configPath: path.join(dir, 'config') }) } });
    const pending = [];
    const rejectedUpdates = [];
    let pipeline = Promise.resolve();
    const running = adapter.start(task, { onProgress: patch => {
        patch.sessionId = task.progressSessionId;
        pipeline = pipeline.then(() => manager.applyProgress(task.id, patch).catch(error => {
            rejectedUpdates.push(error.code);
            epicTrace.pipeline(task.id, patch, 'QUEUE_APPLY_ERROR', { code: error.code, message: error.message });
        }));
        pending.push(pipeline);
    } }).catch(error => error.code);
    await ready;
    assert.ok(spawnArgs.includes('--dlm-debug'));
    child.stderr.emit('data', SAMPLE);
    await Promise.all(pending);
    await adapter.cancel(task.id);
    assert.equal(await running, 'EPIC_DOWNLOAD_STOPPED');
    await manager.flushCheckpoint();
    const final = manager.findTask(task.id);
    await handlers.get(CHANNELS.RECORD_DIAGNOSTIC)({}, { taskId: task.id, section: 'progressPipeline', eventType: 'RENDERER_PATCH_DOM', payload: { taskRevision: final.taskRevision, progressSessionId: task.progressSessionId, fields: { status: 'observed test field' } } });
    await epicTrace.flush(task.id);
    const pointer = JSON.parse(fs.readFileSync(path.join(dir, 'download-diagnostics/epic-legendary/latest-session.json')));
    const rows = fs.readFileSync(pointer.path, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    for (const event of ['RAW_LINE', 'PARSER', 'ADAPTER', 'QUEUE_INPUT', 'RECONCILIATION', 'TELEMETRY', 'QUEUE_AFTER', 'IPC_SEND', 'RENDERER_PATCH_DOM', 'PROVIDER_CLOSE']) assert.ok(rows.some(row => row.event === event), event);
    const byteLine = rows.find(row => row.event === 'RAW_LINE' && row.payload.rawSanitizedLine.includes('Downloaded:'));
    for (const event of ['PARSER', 'ADAPTER', 'RECONCILIATION', 'TELEMETRY', 'QUEUE_AFTER']) {
        assert.ok(rows.some(row => row.event === event && row.correlation?.lineId === byteLine.correlation.lineId), event + ' correlation');
    }
    assert.equal(rows.find(row => row.event === 'ADAPTER').payload.adapterStateBefore.lastWritten, null);
    assert.ok(sent.length > 0);
    assert.deepEqual(rejectedUpdates, []);
    assert.ok(!rows.some(row => row.event === 'QUEUE_APPLY_ERROR'));
    // Diagnostic correlation survives the transfer/lifecycle separation.
    const rawSpeed = rows.find(row => row.event === 'PARSER' && row.payload.parser?.downloadSpeedBps > 0);
    assert.equal(rawSpeed.payload.parser.stage, 'downloading');
    t.diagnostic(JSON.stringify({ syntheticOnly: true, rows: rows.length, ipcEvents: sent.length, bytes: final.downloadedBytes, total: final.totalBytes, rawSpeedParserStage: rawSpeed.payload.parser.stage }));
});

test('renderer diagnostics read actual DOM without changing displayed fields and remain Epic-only', () => {
    let source = fs.readFileSync(path.resolve(__dirname, '../src/js/downloads.js'), 'utf8');
    source = source.replace(/\}\)\(\);\s*$/, 'window.traceTest = dlEpicTraceDom;\n})();');
    const messages = [];
    const window = { CSS: { escape: value => value }, electronAPI: { downloads: { epicTraceEnabled: true, recordDiagnostic: async value => messages.push(value) } } };
    const document = { readyState: 'loading', addEventListener() {}, hidden: false, querySelector: () => ({ querySelector: selector => ({ textContent: selector.includes('percent') ? '0.0%' : '0 B', style: { width: '0%' } }) }) };
    vm.runInNewContext(source, { window, document, console, performance });
    window.traceTest({ id: 'dl_aaaaaaaaaaaaaaaa', platform: 'epic', taskRevision: 5 }, 'RENDERER_PATCH_DOM');
    assert.equal(messages[0].payload.fields.downloaded, '0 B');
    assert.equal(messages[0].payload.visiblePercent, '0.0%');
    assert.equal(messages[0].payload.taskRevision, 5);
    window.traceTest({ id: 'gog', platform: 'gog' }, 'RENDERER_PATCH_DOM');
    assert.equal(messages.length, 1);
    assert.equal(taskValues({ access_token: 'never log task credentials' }).access_token, undefined);
});
