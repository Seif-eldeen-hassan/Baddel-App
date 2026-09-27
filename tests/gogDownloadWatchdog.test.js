'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { JsonDownloadRepository } = require('../src/features/downloads/infrastructure/repositories/JsonDownloadRepository');
const { DownloadPreflightService } = require('../src/features/downloads/infrastructure/services/DownloadPreflightService');
const { DownloadQueueManager } = require('../src/features/downloads/infrastructure/services/DownloadQueueManager');
const { DownloadTelemetryAggregator } = require('../src/features/downloads/infrastructure/services/DownloadTelemetryAggregator');

function makeClock(initial = 1_000) {
    let now = initial;
    function Clock() { return new Date(now); }
    Clock.now = () => now;
    Clock.set = value => { now = value; };
    Clock.advance = delta => { now += delta; };
    return Clock;
}

function makeScheduler(clock) {
    let id = 0;
    const timers = new Map();
    return {
        set(fn, intervalMs) {
            const key = ++id;
            timers.set(key, { fn, intervalMs });
            return { key, unref() {} };
        },
        clear(timer) { timers.delete(timer?.key); },
        async tickTo(timestamp) {
            clock.set(timestamp);
            for (const timer of [...timers.values()]) timer.fn();
            await settle();
        },
        get size() { return timers.size; },
    };
}

function makeSilentProvider(clock) {
    const active = new Map();
    const state = { starts: 0, cancels: 0, activeCount: 0, maxActive: 0 };
    return {
        state,
        start(task, { onProgress, sessionId }) {
            state.starts += 1;
            state.activeCount += 1;
            state.maxActive = Math.max(state.maxActive, state.activeCount);
            onProgress({
                sessionId,
                timestamp: clock.now(),
                status: 'downloading',
                stage: 'downloading',
                eventType: 'progress',
                authoritativeTransfer: true,
                downloadedBytes: 299872422,
                totalBytes: 2474465980,
            });
            return new Promise((_resolve, reject) => active.set(task.id, { reject, sessionId }));
        },
        async pause(taskId) { return this.stop(taskId); },
        async cancel(taskId) { state.cancels += 1; return this.stop(taskId); },
        async stop(taskId) {
            const running = active.get(taskId);
            if (running) {
                active.delete(taskId);
                state.activeCount -= 1;
                const err = new Error('cancelled');
                err.code = 'GOG_DOWNLOAD_CANCELLED';
                running.reject(err);
            }
            return { requested: Boolean(running), exitConfirmed: true };
        },
    };
}

async function settle() {
    for (let index = 0; index < 8; index += 1) await new Promise(resolve => setImmediate(resolve));
}

async function waitFor(predicate, timeoutMs = 1000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const value = predicate();
        if (value) return value;
        await settle();
    }
    return predicate();
}

async function makeFixture(title = 'Sanitarium Watchdog') {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-watchdog-'));
    const installPath = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-watchdog-install-'));
    const clock = makeClock();
    const scheduler = makeScheduler(clock);
    const provider = makeSilentProvider(clock);
    const manager = new DownloadQueueManager({
        repository: new JsonDownloadRepository({ userDataDir }),
        preflight: new DownloadPreflightService(),
        providerExecutor: provider,
        clock,
        telemetryAggregator: new DownloadTelemetryAggregator({ clock, emitIntervalMs: 0, stallWarningMs: 30_000, hardStallMs: 120_000 }),
        watchdogIntervalMs: 2_000,
        setIntervalFn: scheduler.set.bind(scheduler),
        clearIntervalFn: scheduler.clear.bind(scheduler),
    });
    await manager.load();
    const queued = await manager.queueInstall({ platform: 'gog', accountId: 'gog-1', title, providerAppName: 'sanitarium', installPath });
    await manager.startNow(queued.task.id);
    await waitFor(() => manager.findTask(queued.task.id).downloadedBytes === 299872422);
    return { manager, provider, scheduler, clock, taskId: queued.task.id, userDataDir, installPath };
}

function cleanup(fixture) {
    fixture.manager.stopSessionWatchdog(fixture.taskId);
    fs.rmSync(fixture.userDataDir, { recursive: true, force: true });
    fs.rmSync(fixture.installPath, { recursive: true, force: true });
}

test('independent watchdog warns, auto-resumes once, then fails a second silent session', async () => {
    const fixture = await makeFixture();
    try {
        const partialPath = path.join(fixture.installPath, 'partial.bin');
        fs.writeFileSync(partialPath, 'partial-data');
        const firstSession = fixture.manager.findTask(fixture.taskId).progressSessionId;

        await fixture.scheduler.tickTo(31_000);
        let task = await waitFor(() => fixture.manager.findTask(fixture.taskId).stage === 'stalled' && fixture.manager.findTask(fixture.taskId));
        assert.equal(task.statusMessage, 'Waiting for transfer activity');
        assert.equal(task.downloadSpeedBps, 0);
        assert.equal(task.etaSeconds, null);

        await fixture.scheduler.tickTo(121_000);
        task = await waitFor(() => fixture.provider.state.starts === 2 && fixture.manager.findTask(fixture.taskId));
        assert.equal(fixture.provider.state.starts, 2);
        assert.notEqual(task.progressSessionId, firstSession);
        assert.equal(task.stallAutoResumeAttempts, 1);
        assert.equal(fixture.provider.state.maxActive, 1);
        assert.equal(fs.readFileSync(partialPath, 'utf8'), 'partial-data');

        await fixture.scheduler.tickTo(241_000);
        task = await waitFor(() => fixture.manager.findTask(fixture.taskId).status === 'failed' && fixture.manager.findTask(fixture.taskId));
        assert.equal(task.errorCode, 'GOG_DOWNLOAD_STALLED');
        assert.equal(task.retryable, true);
        assert.equal(task.autoResumeEligible, true);
        assert.equal(fixture.provider.state.starts, 2);
        assert.equal(fixture.provider.state.maxActive, 1);
        assert.equal(fs.readFileSync(partialPath, 'utf8'), 'partial-data');
        assert.equal(fixture.scheduler.size, 0);
    } finally {
        cleanup(fixture);
    }
});

test('hard stall does not resume without explicit process-exit confirmation', async () => {
    const fixture = await makeFixture('Unconfirmed Stop');
    try {
        fixture.provider.cancel = async taskId => {
            fixture.provider.state.cancels += 1;
            await fixture.provider.stop(taskId);
            return undefined;
        };
        await fixture.scheduler.tickTo(121_000);
        const task = await waitFor(() => fixture.manager.findTask(fixture.taskId).status === 'failed' && fixture.manager.findTask(fixture.taskId));
        assert.equal(task.errorCode, 'DOWNLOAD_STOP_NOT_CONFIRMED');
        assert.equal(task.retryable, true);
        assert.equal(fixture.provider.state.starts, 1);
        assert.equal(fixture.scheduler.size, 0);
    } finally {
        cleanup(fixture);
    }
});

for (const action of ['pause', 'cancel']) {
    test(`manual ${action} during silence stops watchdog and prevents auto-resume`, async () => {
        const fixture = await makeFixture(`Manual ${action}`);
        try {
            if (action === 'pause') await fixture.manager.pause(fixture.taskId);
            else await fixture.manager.cancel({ taskId: fixture.taskId, deletePartial: false });
            await fixture.scheduler.tickTo(500_000);
            const task = fixture.manager.getSnapshot().tasks.find(item => item.id === fixture.taskId);
            assert.equal(action === 'pause' ? task?.status : task, action === 'pause' ? 'paused' : undefined);
            assert.equal(fixture.provider.state.starts, 1);
            assert.equal(fixture.scheduler.size, 0);
        } finally {
            cleanup(fixture);
        }
    });
}
