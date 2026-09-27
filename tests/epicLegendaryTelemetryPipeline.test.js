'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { EpicLegendaryDownloadAdapter } = require('../src/features/downloads/infrastructure/providers/epic/EpicLegendaryDownloadAdapter');
const { DownloadTelemetryAggregator } = require('../src/features/downloads/infrastructure/services/DownloadTelemetryAggregator');

test('Legendary adapter feeds authoritative bytes, fresh ETA and independent disk samples into the existing aggregator', async t => {
    const child = new EventEmitter();
    Object.assign(child, { pid: 123, stdout: new EventEmitter(), stderr: new EventEmitter() });
    child.kill = () => { setImmediate(() => child.emit('close', null, 'SIGTERM')); return true; };
    const adapter = new EpicLegendaryDownloadAdapter({
        runtimeService: { createProcess: () => child },
        accountResolver: { validateTask: async () => ({ appName: 'App', configPath: path.resolve('test-config') }) },
    });
    let task = { id: 'epic-telemetry', platform: 'epic', installProvider: 'legendary', installPath: path.resolve('TestGame'), status: 'downloading', downloadedBytes: 0, totalBytes: null };
    const aggregator = new DownloadTelemetryAggregator();
    let timestamp = 10000;
    const samples = [];
    const running = adapter.start(task, { onProgress: sample => {
        samples.push(sample);
        const { patch } = aggregator.apply(task, { ...sample, timestamp: timestamp += 100 });
        task = { ...task, ...patch };
    } }).catch(error => error.code);
    await new Promise(resolve => setImmediate(resolve));
    child.stderr.emit('data', fs.readFileSync(path.join(__dirname, 'fixtures/legendary/upstream-progress.txt'), 'utf8'));
    assert.ok(samples.some(sample => sample.authoritativeTransfer === true));
    assert.equal(task.downloadedBytes, Math.round(0.03 * 1024 ** 2));
    assert.equal(task.totalBytes, Math.round(0.06 * 1024 ** 2));
    assert.equal(task.writtenBytes, Math.round(0.06 * 1024 ** 2));
    assert.equal(task.etaSeconds, 1);
    const disk = samples.find(sample => sample.diskUsageBps === 0);
    assert.equal(disk.telemetryState, 'supported');
    assert.equal(Object.hasOwn(disk, 'downloadSpeedBps'), false);
    assert.equal(Object.hasOwn(disk, 'etaSeconds'), false);
    const stale = aggregator.apply(task, { eventType: 'legendary-progress', timestamp: timestamp + 6000 });
    assert.equal(stale.patch.etaSeconds, null);
    t.diagnostic(JSON.stringify({ samples: samples.length, confirmedBytes: task.downloadedBytes, totalBytes: task.totalBytes, writtenBytes: task.writtenBytes, diskRawBps: disk.diskWriteSpeedBps, diskState: disk.telemetryState, etaBeforeExpiry: task.etaSeconds, etaAfterExpiry: stale.patch.etaSeconds }));
    await adapter.cancel(task.id);
    assert.equal(await running, 'EPIC_DOWNLOAD_STOPPED');
});
