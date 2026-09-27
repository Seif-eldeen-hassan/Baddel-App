'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const { JsonDownloadRepository } = require('../src/features/downloads/infrastructure/repositories/JsonDownloadRepository');
const { DownloadPreflightService } = require('../src/features/downloads/infrastructure/services/DownloadPreflightService');
const { DownloadQueueManager } = require('../src/features/downloads/infrastructure/services/DownloadQueueManager');

test('100 progress samples are throttled without durable writes or full-card renders', async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-download-metrics-'));
    const installPath = path.join(os.tmpdir(), 'baddel-download-metrics-install', 'Metric Game');
    try {
        let diskWrites = 0;
        const repository = new JsonDownloadRepository({ userDataDir });
        const originalWrite = repository.writeState.bind(repository);
        repository.writeState = async state => {
            diskWrites += 1;
            return originalWrite(state);
        };
        const manager = new DownloadQueueManager({
            repository,
            preflight: new DownloadPreflightService(),
        });
        await manager.load();
        const queued = await manager.queueInstall({
            platform: 'gog', accountId: 'metric-account', title: 'Metric Game',
            providerAppName: 'metric-game', installPath,
        });
        const sessionId = 'metric-session';
        await manager.transitionTask(queued.task.id, 'preparing', { progressSessionId: sessionId });
        await manager.transitionTask(queued.task.id, 'downloading', { progressSessionId: sessionId });
        const baselineWrites = diskWrites;
        let ipcTaskEvents = 0;
        manager.on('task-updated', () => { ipcTaskEvents += 1; });
        for (let index = 1; index <= 100; index += 1) {
            await manager.applyProgress(queued.task.id, {
                sessionId, timestamp: 1000 + index * 50, status: 'downloading',
                downloadedBytes: index * 50, totalBytes: 10_000,
                rawDownloadSpeedBps: 2_000_000,
                diskWriteSpeedBps: index % 5 === 0 ? 0 : 1_000_000,
                telemetryState: index % 5 === 0 ? 'idle' : 'active',
            });
        }
        const writesDuringProgress = diskWrites - baselineWrites;
        await manager.flushCheckpoint();
        const checkpointWrites = diskWrites - baselineWrites - writesDuringProgress;

        const sourcePath = path.join(__dirname, '..', 'src/js/downloads.js');
        let source = fs.readFileSync(sourcePath, 'utf8');
        source = source.replace(
            'function renderDownloads(snapshot = downloadsSnapshot)',
            'function renderDownloadsOriginal(snapshot = downloadsSnapshot)'
        );
        const exposure = [
            'let metricFullRenders = 0;',
            'let metricPatchCalls = 0;',
            'function renderDownloads(snapshot = downloadsSnapshot) {',
            '  metricFullRenders += 1;',
            '  return renderDownloadsOriginal(snapshot);',
            '}',
            'window.__downloadMetricHooks = {',
            '  setSnapshot(snapshot) { downloadsSnapshot = snapshot; },',
            '  patch(update) { metricPatchCalls += 1; patchDownloadTaskCard(update); },',
            '  counts() { return { fullRenders: metricFullRenders, patchCalls: metricPatchCalls }; },',
            '};',
            '})();',
        ].join('\n');
        source = source.replace(/\}\)\(\);\s*$/, exposure);

        const fields = new Map();
        function field(initial = '') {
            let value = initial;
            return {
                style: {}, open: false,
                get textContent() { return value; },
                set textContent(next) { value = String(next); },
                outerHTML: '',
            };
        }
        for (const name of ['status', 'downloaded', 'speed', 'disk', 'eta', 'eta-top']) fields.set(name, field());
        const fill = field();
        const label = field();
        const card = {
            dataset: { taskStatus: 'downloading', taskRevision: '0' },
            querySelector(selector) {
                if (selector === '.download-progress-fill') return fill;
                if (selector === '.download-progress-percent') return label;
                const match = selector.match(/data-download-field="([^"]+)"/);
                return match ? fields.get(match[1]) || null : null;
            },
        };
        const document = {
            readyState: 'loading',
            addEventListener() {},
            getElementById() { return null; },
            querySelector(selector) {
                return selector.includes('data-download-task-id') ? card : null;
            },
        };
        const window = {
            CSS: { escape: value => value },
            electronAPI: { downloads: { diagnosticsEnabled: false } },
        };
        vm.runInNewContext(source, { window, document, console, setInterval, clearInterval, performance });
        const initialTask = {
            id: 'dl_metric_renderer', platform: 'gog', title: 'Metric Game',
            status: 'downloading', stage: 'downloading', taskRevision: 0,
            downloadedBytes: 0, totalBytes: 10_000, telemetryState: 'idle',
            diskUsageBps: 0, diskWriteSpeedBps: 0,
        };
        window.__downloadMetricHooks.setSnapshot({ tasks: [initialTask], aggregateSpeedBps: 0 });
        for (let index = 1; index <= 100; index += 1) {
            window.__downloadMetricHooks.patch({
                taskId: initialTask.id,
                taskRevision: index,
                patch: {
                    status: 'downloading', stage: 'downloading',
                    downloadedBytes: index * 50, totalBytes: 10_000,
                    diskUsageBps: index % 5 === 0 ? 0 : 1_000_000,
                    diskWriteSpeedBps: index % 5 === 0 ? 0 : 1_000_000,
                    telemetryState: index % 5 === 0 ? 'idle' : 'active',
                },
            });
        }
        const renderer = window.__downloadMetricHooks.counts();
        const metrics = {
            providerSamples: 100,
            writesDuringProgress,
            checkpointWrites,
            ipcTaskEvents,
            ...renderer,
        };
        console.log('DOWNLOAD_PERF_METRICS ' + JSON.stringify(metrics));
        assert.deepEqual(
            {
                writesDuringProgress,
                checkpointWrites,
                fullRenders: renderer.fullRenders,
                patchCalls: renderer.patchCalls,
            },
            {
                writesDuringProgress: 0,
                checkpointWrites: 1,
                fullRenders: 0,
                patchCalls: 100,
            }
        );
        assert.ok(ipcTaskEvents > 0 && ipcTaskEvents < 100);
    } finally {
        fs.rmSync(userDataDir, { recursive: true, force: true });
        fs.rmSync(path.dirname(installPath), { recursive: true, force: true });
    }
});

