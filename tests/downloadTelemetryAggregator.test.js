'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { DownloadTelemetryAggregator } = require('../src/features/downloads/infrastructure/services/DownloadTelemetryAggregator');

test('download telemetry aggregator smooths speed and emits controlled patches', () => {
    const agg = new DownloadTelemetryAggregator({ emitIntervalMs: 200, sampleWindowMs: 8000 });
    const task = { id: 'dl_0123456789abcdef', status: 'downloading', downloadedBytes: 0, totalBytes: 1000 };
    agg.reset(task.id, { sessionId: 's1' });

    const first = agg.apply(task, {
        sessionId: 's1',
        timestamp: 1000,
        status: 'downloading',
        downloadedBytes: 100,
        totalBytes: 1000,
        progressPercent: 10,
        providerProgressMode: 'absolute',
        progressSource: 'bytes',
    });
    const second = agg.apply({ ...task, downloadedBytes: 100, progressPercent: 10 }, {
        sessionId: 's1',
        timestamp: 2000,
        status: 'downloading',
        downloadedBytes: 300,
        totalBytes: 1000,
        progressPercent: 30,
        providerProgressMode: 'absolute',
        progressSource: 'bytes',
    });

    assert.equal(first.meaningful, true);
    assert.equal(second.meaningful, true);
    assert.equal(second.patch.downloadSpeedBps, 200);
    assert.ok(second.patch.etaSeconds == null || second.patch.etaSeconds >= 3);
});

test('download telemetry aggregator resets by session and ignores duplicate patches', () => {
    const agg = new DownloadTelemetryAggregator({ emitIntervalMs: 1000 });
    const task = { id: 'dl_0123456789abcdef', status: 'downloading', downloadedBytes: 100 };
    agg.reset(task.id, { sessionId: 'old' });

    const staleLooking = agg.apply(task, {
        sessionId: 'new',
        timestamp: 1000,
        status: 'downloading',
        downloadedBytes: 90,
        progressPercent: 9,
    });
    const duplicate = agg.apply({ ...task, downloadedBytes: 90, progressPercent: 9 }, {
        sessionId: 'new',
        timestamp: 1100,
        status: 'downloading',
        downloadedBytes: 90,
        progressPercent: 9,
    });

    assert.equal(staleLooking.patch.downloadedBytes, 90);
    assert.equal(duplicate.meaningful, false);
});

test('download telemetry aggregator never emits a percent inconsistent with transfer bytes', () => {
    const agg = new DownloadTelemetryAggregator({ emitIntervalMs: 0 });
    const task = {
        id: 'dl_0123456789abcdef',
        status: 'downloading',
        downloadedBytes: 400_000_000,
        totalBytes: 2_000_000_000,
        progressPercent: 20,
    };
    agg.reset(task.id, { sessionId: 's1' });

    const directMismatch = agg.apply(task, {
        sessionId: 's1',
        timestamp: 1000,
        status: 'downloading',
        downloadedBytes: 500_000_000,
        totalBytes: 2_000_000_000,
        progressPercent: 50,
    });
    assert.equal(directMismatch.patch.progressPercent, 25);

    const percentOnlyMismatch = agg.apply(task, {
        sessionId: 's1',
        timestamp: 2000,
        status: 'downloading',
        progressPercent: 50,
    });
    assert.equal(percentOnlyMismatch.patch.progressPercent, 20);
});

test('download telemetry aggregator emits disk-only telemetry without byte progress', () => {
    const agg = new DownloadTelemetryAggregator({ emitIntervalMs: 0 });
    const task = { id: 'dl_0123456789abcdef', status: 'downloading', downloadedBytes: 100, totalBytes: 1000 };
    agg.reset(task.id, { sessionId: 's1' });

    const update = agg.apply(task, {
        sessionId: 's1',
        timestamp: 1000,
        status: 'downloading',
        diskWriteSpeedBps: 4096,
    });

    assert.equal(update.meaningful, false);
    assert.equal(update.shouldEmit, true);
    assert.equal(update.patch.diskUsageBps, 4096);
    assert.equal(update.patch.diskWriteSpeedBps, 4096);
    assert.equal(update.patch.telemetryState, 'active');
    assert.ok(Array.isArray(update.patch.speedHistory));
});

test('download telemetry aggregator emits raw counter updates after throttle', () => {
    const agg = new DownloadTelemetryAggregator({ emitIntervalMs: 200 });
    const task = { id: 'dl_0123456789abcdef', status: 'downloading', downloadedBytes: 100, totalBytes: 1000 };
    agg.reset(task.id, { sessionId: 's1' });

    const first = agg.apply(task, {
        sessionId: 's1',
        timestamp: 1000,
        status: 'downloading',
        rawDownloadedBytes: 256,
        writtenBytes: 128,
    });
    const second = agg.apply(task, {
        sessionId: 's1',
        timestamp: 1300,
        status: 'downloading',
        rawDownloadedBytes: 512,
        writtenBytes: 256,
    });

    assert.equal(first.shouldEmit, true);
    assert.equal(second.shouldEmit, true);
    assert.equal(second.patch.rawDownloadedBytes, 512);
    assert.equal(second.patch.writtenBytes, 256);
    assert.equal(second.patch.telemetryState, 'active');
});

test('download telemetry aggregator keeps speed-only provider updates visible', () => {
    const agg = new DownloadTelemetryAggregator({ emitIntervalMs: 0 });
    const task = { id: 'dl_0123456789abcdef', status: 'downloading', downloadedBytes: 100, totalBytes: 1000 };
    agg.reset(task.id, { sessionId: 's1' });

    const first = agg.apply(task, {
        sessionId: 's1',
        timestamp: 1000,
        status: 'downloading',
        rawDownloadSpeedBps: 10_000,
    });
    const second = agg.apply(task, {
        sessionId: 's1',
        timestamp: 1200,
        status: 'downloading',
        rawDownloadSpeedBps: 20_000,
    });

    assert.equal(first.shouldEmit, true);
    assert.equal(second.shouldEmit, true);
    assert.equal(first.patch.networkState, 'active');
    assert.equal(second.patch.networkState, 'active');
    assert.ok(second.patch.downloadSpeedBps > first.patch.downloadSpeedBps);
});

test('download telemetry aggregator marks stale telemetry after provider silence', () => {
    const agg = new DownloadTelemetryAggregator({ emitIntervalMs: 0, speedStaleGraceMs: 1000 });
    const task = { id: 'dl_0123456789abcdef', status: 'downloading', downloadedBytes: 100, totalBytes: 1000 };
    agg.reset(task.id, { sessionId: 's1' });

    agg.apply(task, {
        sessionId: 's1',
        timestamp: 1000,
        status: 'downloading',
        rawDownloadSpeedBps: 10_000,
        diskWriteSpeedBps: 8000,
    });
    const stale = agg.apply(task, {
        sessionId: 's1',
        timestamp: 2600,
        status: 'downloading',
        eventType: 'heartbeat',
    });

    assert.equal(stale.patch.networkState, 'stale');
    assert.equal(stale.patch.telemetryState, 'stale');
    assert.ok(stale.patch.downloadSpeedBps < 10_000);
});

test('download telemetry aggregator clears runtime rates for terminal statuses', () => {
    const agg = new DownloadTelemetryAggregator({ emitIntervalMs: 0 });
    const task = { id: 'dl_0123456789abcdef', status: 'downloading', downloadedBytes: 100, totalBytes: 1000 };
    agg.reset(task.id, { sessionId: 's1' });

    const terminal = agg.apply(task, {
        sessionId: 's1',
        timestamp: 1000,
        status: 'paused',
        rawDownloadSpeedBps: 5000,
        diskWriteSpeedBps: 3000,
        etaSeconds: 30,
    });

    assert.equal(terminal.patch.downloadSpeedBps, 0);
    assert.equal(terminal.patch.diskUsageBps, 0);
    assert.equal(terminal.patch.etaSeconds, null);
    assert.equal(terminal.patch.networkState, 'idle');
    assert.equal(terminal.patch.telemetryState, 'idle');
});


test('positive provider activity does not stall while authoritative progress is delayed', () => {
    const agg = new DownloadTelemetryAggregator({
        emitIntervalMs: 0,
        stallWarningMs: 1000,
        hardStallMs: 2000,
        speedStaleGraceMs: 5000,
    });

    const task = {
        id: 'dl_0123456789abcdef',
        status: 'downloading',
        downloadedBytes: 555_000,
        totalBytes: 70_000_000,
    };

    agg.reset(task.id, { sessionId: 's1' });

    agg.apply(task, {
        sessionId: 's1',
        timestamp: 1000,
        status: 'downloading',
        eventType: 'download-speed',
        rawDownloadSpeedBps: 1_000_000,
        diskWriteSpeedBps: 800_000,
        etaSeconds: 60,
    });

    const active = agg.apply(task, {
        sessionId: 's1',
        timestamp: 3200,
        status: 'downloading',
        eventType: 'download-speed',
        rawDownloadSpeedBps: 900_000,
        diskWriteSpeedBps: 700_000,
        etaSeconds: 55,
    });

    assert.equal(active.meaningful, false);
    assert.notEqual(active.patch.stage, 'stalled');
    assert.equal(active.patch.errorCode, undefined);
    assert.equal(active.patch.networkState, 'active');
    assert.ok(active.patch.downloadSpeedBps > 0);
});

test('hard stall requires all transfer activity to stop', () => {
    const agg = new DownloadTelemetryAggregator({
        emitIntervalMs: 0,
        stallWarningMs: 1000,
        hardStallMs: 2000,
        speedStaleGraceMs: 5000,
    });

    const task = {
        id: 'dl_0123456789abcdef',
        status: 'downloading',
        downloadedBytes: 555_000,
        totalBytes: 70_000_000,
    };

    agg.reset(task.id, { sessionId: 's1' });

    agg.apply(task, {
        sessionId: 's1',
        timestamp: 1000,
        status: 'downloading',
        eventType: 'transfer-counters',
        rawDownloadedBytes: 1_000_000,
        writtenBytes: 900_000,
        rawDownloadSpeedBps: 800_000,
        diskWriteSpeedBps: 700_000,
    });

    const warning = agg.apply(task, {
        sessionId: 's1',
        timestamp: 2200,
        status: 'downloading',
        eventType: 'heartbeat',
    });

    assert.equal(warning.patch.stage, 'stalled');
    assert.equal(
        warning.patch.stallReason,
        'no-transfer-activity'
    );
    assert.equal(warning.patch.errorCode, undefined);

    const hard = agg.apply(task, {
        sessionId: 's1',
        timestamp: 3200,
        status: 'downloading',
        eventType: 'heartbeat',
    });

    assert.equal(hard.patch.errorCode, 'GOG_DOWNLOAD_STALLED');
    assert.equal(hard.patch.retryable, true);
    assert.equal(hard.patch.autoResumeEligible, true);
});

test('stall policy ignores verifying and installing phases', () => {
    const agg = new DownloadTelemetryAggregator({ emitIntervalMs: 0, stallWarningMs: 1000, hardStallMs: 2000 });
    const task = { id: 'dl_0123456789abcdef', status: 'verifying', downloadedBytes: 1000, totalBytes: 1000 };
    agg.reset(task.id, { sessionId: 's1' });
    agg.apply({ ...task, status: 'downloading' }, {
        sessionId: 's1',
        timestamp: 1000,
        status: 'downloading',
        eventType: 'download-speed',
        rawDownloadSpeedBps: 1,
    });
    const verifying = agg.apply(task, {
        sessionId: 's1',
        timestamp: 5000,
        status: 'verifying',
        eventType: 'log',
    });
    assert.equal(verifying.patch.errorCode, undefined);
    assert.notEqual(verifying.patch.stage, 'stalled');
});
