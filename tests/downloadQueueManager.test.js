'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { JsonDownloadRepository } = require('../src/features/downloads/infrastructure/repositories/JsonDownloadRepository');
const { DownloadPreflightService } = require('../src/features/downloads/infrastructure/services/DownloadPreflightService');
const { DownloadQueueManager } = require('../src/features/downloads/infrastructure/services/DownloadQueueManager');

function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-downloads-'));
}

function makeManager(userDataDir) {
    return new DownloadQueueManager({
        repository: new JsonDownloadRepository({ userDataDir }),
        preflight: new DownloadPreflightService(),
    });
}

function payload(title = 'Fall Guys') {
    return {
        platform: 'gog',
        accountId: 'gog-1',
        title,
        providerAppName: title.toLowerCase().replace(/\s+/g, '-'),
        installPath: path.join(os.tmpdir(), 'baddel-download-test-installs', title),
    };
}

function completionReceipt({ downloadedBytes = 1000, totalBytes = 1000 } = {}) {
    return {
        provider: 'gog',
        processExitCode: 0,
        completionConfirmed: true,
        transfer: { downloadedBytes, totalBytes, source: 'test-receipt' },
        verification: {
            status: 'passed',
            method: 'test-verification',
            expectedFileCount: null,
            verifiedFileCount: 1,
            expectedBytes: totalBytes,
            actualBytes: downloadedBytes,
            executableFound: true,
            manifestFound: null,
        },
        diagnosticCode: null,
    };
}

async function waitForTaskStatus(manager, taskId, status, timeoutMs = 500) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const task = manager.getSnapshot().tasks.find(t => t.id === taskId);
        if (task?.status === status) return task;
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    return manager.getSnapshot().tasks.find(t => t.id === taskId);
}
async function waitForPathExists(targetPath, timeoutMs = 500) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (fs.existsSync(targetPath)) return true;
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    return fs.existsSync(targetPath);
}
async function waitForValue(getValue, timeoutMs = 500) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const value = getValue();
        if (value) return value;
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    return getValue();
}

test('download queue persists FIFO tasks and prevents duplicates', async () => {
    const dir = tempDir();
    try {
        const manager = makeManager(dir);
        await manager.load();
        const first = await manager.queueInstall(payload('Fall Guys'));
        await manager.queueInstall(payload('Rocket League'));

        assert.equal(first.status, 'success');
        assert.equal(manager.getSnapshot().pendingCount, 2);
        await assert.rejects(
            () => manager.queueInstall(payload('Fall Guys')),
            /already in the download queue/i
        );

        const restored = makeManager(dir);
        await restored.load();
        assert.equal(restored.getSnapshot().tasks.length, 2);
        assert.equal(restored.getSnapshot().tasks[0].title, 'Fall Guys');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('download queue recovers interrupted active task as paused', async () => {
    const dir = tempDir();
    try {
        const repo = new JsonDownloadRepository({ userDataDir: dir });
        await repo.writeState({
            version: 1,
            tasks: [{
                id: 'dl_aaaaaaaaaaaaaaaa',
                identityKey: 'epic:a:game:path',
                title: 'Interrupted',
                platform: 'epic',
                accountId: 'a',
                providerAppName: 'game',
                installPath: path.join(process.cwd(), '.tmp-download-tests', 'Interrupted'),
                status: 'downloading',
            }],
        });
        const manager = makeManager(dir);
        await manager.load();
        assert.equal(manager.getSnapshot().tasks[0].status, 'paused');
        assert.match(manager.getSnapshot().tasks[0].statusMessage, /closed/i);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('queue shutdown stops the active provider once and persists a resumable task', async () => {
    const dir = tempDir();
    try {
        let pauseCount = 0;
        let rejectStart = null;
        const manager = new DownloadQueueManager({
            repository: new JsonDownloadRepository({ userDataDir: dir }),
            preflight: new DownloadPreflightService(),
            providerExecutor: {
                start: async () => new Promise((_resolve, reject) => { rejectStart = reject; }),
                pause: async () => {
                    pauseCount += 1;
                    rejectStart?.(Object.assign(new Error('provider stopped for shutdown'), { code: 'DOWNLOAD_CANCELLED' }));
                    return { requested: true, exitConfirmed: true };
                },
            },
        });
        await manager.load();
        const queued = await manager.queueInstall(payload('Shutdown Resume'));
        await manager.startNow(queued.task.id);
        await waitForValue(() => rejectStart);

        await Promise.all([manager.shutdown(), manager.shutdown()]);

        const task = manager.findTask(queued.task.id);
        assert.equal(pauseCount, 1);
        assert.equal(task.status, 'paused');
        assert.equal(task.recoveryReason, 'app-shutdown');
        assert.match(task.statusMessage, /closed.*resume/i);

        const restored = makeManager(dir);
        await restored.load();
        assert.equal(restored.findTask(queued.task.id).status, 'paused');
        assert.equal(restored.findTask(queued.task.id).downloadedBytes, task.downloadedBytes);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('resume preserves visible partial progress when provider restarts at zero', async () => {
    const dir = tempDir();
    try {
        const manager = new DownloadQueueManager({
            repository: new JsonDownloadRepository({ userDataDir: dir }),
            preflight: new DownloadPreflightService(),
            providerExecutor: {
                start: async (_task, { onProgress }) => {
                    await onProgress({
                        status: 'downloading',
                        progressPercent: 0,
                        downloadedBytes: 0,
                        totalBytes: 1_000,
                        statusMessage: 'Restarting provider',
                    });
                    return completionReceipt();
                },
                pause: async () => {},
            },
        });
        await manager.load();
        const queued = await manager.queueInstall(payload('Resume Preserve'));
        await manager.transitionTask(queued.task.id, 'paused', {
            progressPercent: 35,
            downloadedBytes: 350,
            totalBytes: 1_000,
            statusMessage: 'Paused',
        });
        await manager.resume(queued.task.id);
        const task = await waitForTaskStatus(manager, queued.task.id, 'completed');
        assert.equal(task.progressPercent, 100);
        assert.equal(task.downloadedBytes, 1_000);
        assert.equal(task.totalBytes, 1_000);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('progress ignores impossible total smaller than downloaded bytes', async () => {
    const dir = tempDir();
    try {
        const manager = new DownloadQueueManager({
            repository: new JsonDownloadRepository({ userDataDir: dir }),
            preflight: new DownloadPreflightService(),
            providerExecutor: {
                start: async (_task, { onProgress }) => {
                    await onProgress({
                        status: 'downloading',
                        progressPercent: 1.3,
                        downloadedBytes: 13_000_000,
                        totalBytes: 420_000,
                        statusMessage: 'Downloading',
                    });
                    return {
                        provider: 'gog',
                        processExitCode: 0,
                        completionConfirmed: false,
                        transfer: { downloadedBytes: null, totalBytes: null, source: 'test' },
                        verification: { status: 'failed', method: 'test' },
                        diagnosticCode: 'DOWNLOAD_INCOMPLETE_TRANSFER',
                    };
                },
            },
        });
        await manager.load();
        const queued = await manager.queueInstall(payload('Impossible Total'));
        await manager.startNow(queued.task.id);
        const task = await waitForTaskStatus(manager, queued.task.id, 'failed');
        assert.equal(task.downloadedBytes, 0);
        assert.equal(task.totalBytes, null);
        assert.equal(task.errorCode, 'DOWNLOAD_INCOMPLETE_TRANSFER');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('same-session authoritative progress may safely correct a lower global denominator', async () => {
    const dir = tempDir();
    try {
        const manager = new DownloadQueueManager({
            repository: new JsonDownloadRepository({ userDataDir: dir }),
            preflight: new DownloadPreflightService(),
            providerExecutor: { start: async () => new Promise(() => {}) },
        });
        await manager.load();
        const queued = await manager.queueInstall(payload('Atomic Lower Total'));
        await manager.startNow(queued.task.id);
        const sessionId = manager.findTask(queued.task.id).progressSessionId;
        await manager.applyProgress(queued.task.id, {
            status: 'downloading',
            providerProgressMode: 'absolute',
            progressSource: 'bytes',
            downloadedBytes: 400_000_000,
            totalBytes: 2_000_000_000,
            progressPercent: 20,
            sessionId,
        });
        await manager.applyProgress(queued.task.id, {
            status: 'downloading',
            providerProgressMode: 'absolute',
            progressSource: 'bytes',
            downloadedBytes: 500_000_000,
            totalBytes: 1_000_000_000,
            progressPercent: 50,
            sessionId,
        });
        const task = manager.getSnapshot().tasks.find(t => t.id === queued.task.id);
        assert.equal(task.downloadedBytes, 500_000_000);
        assert.equal(task.totalBytes, 1_000_000_000);
        assert.equal(task.progressPercent, 50);
        assert.equal(task.totalBytesSource, 'provider-absolute');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('authoritative absolute progress derives percent from bytes when provider text disagrees', async () => {
    const dir = tempDir();
    try {
        const manager = new DownloadQueueManager({
            repository: new JsonDownloadRepository({ userDataDir: dir }),
            preflight: new DownloadPreflightService(),
            providerExecutor: { start: async () => new Promise(() => {}) },
        });
        await manager.load();
        const queued = await manager.queueInstall(payload('Atomic Percent Wins'));
        await manager.startNow(queued.task.id);
        await manager.applyProgress(queued.task.id, {
            status: 'downloading',
            providerProgressMode: 'absolute',
            progressSource: 'bytes',
            downloadedBytes: 500_000_000,
            totalBytes: 2_000_000_000,
            progressPercent: 50,
            sessionId: manager.findTask(queued.task.id).progressSessionId,
        });
        const task = manager.getSnapshot().tasks.find(t => t.id === queued.task.id);
        assert.equal(task.downloadedBytes, 500_000_000);
        assert.equal(task.totalBytes, 2_000_000_000);
        assert.equal(task.progressPercent, 25);
        assert.equal(task.providerReportedPercent, 50);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('authoritative absolute progress accepts higher exact total atomically', async () => {
    const dir = tempDir();
    try {
        const manager = new DownloadQueueManager({
            repository: new JsonDownloadRepository({ userDataDir: dir }),
            preflight: new DownloadPreflightService(),
            providerExecutor: { start: async () => new Promise(() => {}) },
        });
        await manager.load();
        const queued = await manager.queueInstall(payload('Atomic Higher Total'));
        await manager.startNow(queued.task.id);
        const sessionId = manager.findTask(queued.task.id).progressSessionId;
        await manager.applyProgress(queued.task.id, {
            status: 'downloading',
            providerProgressMode: 'absolute',
            progressSource: 'bytes',
            downloadedBytes: 250_000_000,
            totalBytes: 1_000_000_000,
            progressPercent: 25,
            sessionId,
        });
        await manager.applyProgress(queued.task.id, {
            status: 'downloading',
            providerProgressMode: 'absolute',
            progressSource: 'bytes',
            downloadedBytes: 500_000_000,
            totalBytes: 2_000_000_000,
            progressPercent: 25,
            sessionId,
        });
        const task = manager.getSnapshot().tasks.find(t => t.id === queued.task.id);
        assert.equal(task.downloadedBytes, 500_000_000);
        assert.equal(task.totalBytes, 2_000_000_000);
        assert.equal(task.progressPercent, 25);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('provider sample that omits total preserves the existing transfer tuple', async () => {
    const dir = tempDir();
    try {
        const manager = new DownloadQueueManager({
            repository: new JsonDownloadRepository({ userDataDir: dir }),
            preflight: new DownloadPreflightService(),
            providerExecutor: { start: async () => new Promise(() => {}) },
        });
        await manager.load();
        const queued = await manager.queueInstall(payload('Missing Total'));
        await manager.startNow(queued.task.id);
        const sessionId = manager.findTask(queued.task.id).progressSessionId;
        await manager.applyProgress(queued.task.id, {
            status: 'downloading',
            providerProgressMode: 'absolute',
            progressSource: 'bytes',
            downloadedBytes: 400_000_000,
            totalBytes: 2_000_000_000,
            progressPercent: 20,
            sessionId,
        });
        await manager.applyProgress(queued.task.id, {
            status: 'downloading',
            providerProgressMode: 'absolute',
            downloadedBytes: 500_000_000,
            progressPercent: 50,
            sessionId,
        });
        const task = manager.getSnapshot().tasks.find(t => t.id === queued.task.id);
        assert.equal(task.downloadedBytes, 400_000_000);
        assert.equal(task.totalBytes, 2_000_000_000);
        assert.equal(task.progressPercent, 20);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('provider sample with downloaded bytes greater than total is rejected as a tuple', async () => {
    const dir = tempDir();
    try {
        const manager = new DownloadQueueManager({
            repository: new JsonDownloadRepository({ userDataDir: dir }),
            preflight: new DownloadPreflightService(),
            providerExecutor: { start: async () => new Promise(() => {}) },
        });
        await manager.load();
        const queued = await manager.queueInstall(payload('Invalid Tuple'));
        await manager.startNow(queued.task.id);
        await manager.applyProgress(queued.task.id, {
            status: 'downloading',
            providerProgressMode: 'absolute',
            progressSource: 'bytes',
            downloadedBytes: 13_000_000,
            totalBytes: 420_000,
            progressPercent: 1.3,
            sessionId: manager.findTask(queued.task.id).progressSessionId,
        });
        const task = manager.getSnapshot().tasks.find(t => t.id === queued.task.id);
        assert.equal(task.downloadedBytes, 0);
        assert.equal(task.totalBytes, null);
        assert.equal(task.progressPercent, null);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('resume checkpoint maps smaller complete tuple as session-relative progress', async () => {
    const dir = tempDir();
    try {
        let onProgressRef;
        const manager = new DownloadQueueManager({
            repository: new JsonDownloadRepository({ userDataDir: dir }),
            preflight: new DownloadPreflightService(),
            providerExecutor: {
                start: async (_task, { onProgress }) => {
                    onProgressRef = onProgress;
                    return new Promise(() => {});
                },
            },
        });
        await manager.load();
        const queued = await manager.queueInstall(payload('Resume Atomic'));
        await manager.transitionTask(queued.task.id, 'paused', {
            progressPercent: 20,
            downloadedBytes: 400_000_000,
            totalBytes: 2_000_000_000,
            checkpointProgressPercent: 20,
            checkpointDownloadedBytes: 400_000_000,
            checkpointTotalBytes: 2_000_000_000,
        });
        await manager.resume(queued.task.id);
        assert.equal(manager.findTask(queued.task.id).progressPercent, 20);
        onProgressRef = await waitForValue(() => onProgressRef);
        assert.equal(typeof onProgressRef, 'function');
        await onProgressRef({
            status: 'downloading',
            providerProgressMode: 'absolute',
            progressSource: 'bytes',
            downloadedBytes: 500_000_000,
            totalBytes: 1_000_000_000,
            progressPercent: 50,
        });
        const task = manager.getSnapshot().tasks.find(t => t.id === queued.task.id);
        assert.equal(task.downloadedBytes, 900_000_000);
        assert.equal(task.totalBytes, 2_000_000_000);
        assert.equal(task.progressPercent, 45);
        assert.equal(task.sessionDownloadedBytes, 500_000_000);
        assert.equal(task.sessionTotalBytes, 1_000_000_000);
        assert.equal(task.checkpointProgressPercent, 45);
        assert.equal(task.checkpointSessionId, task.progressSessionId);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('old-session progress tuple is rejected completely', async () => {
    const dir = tempDir();
    try {
        const manager = new DownloadQueueManager({
            repository: new JsonDownloadRepository({ userDataDir: dir }),
            preflight: new DownloadPreflightService(),
            providerExecutor: { start: async () => new Promise(() => {}) },
        });
        await manager.load();
        const queued = await manager.queueInstall(payload('Old Session'));
        await manager.startNow(queued.task.id);
        const sessionId = manager.findTask(queued.task.id).progressSessionId;
        await manager.applyProgress(queued.task.id, {
            status: 'downloading',
            providerProgressMode: 'absolute',
            progressSource: 'bytes',
            downloadedBytes: 400_000_000,
            totalBytes: 2_000_000_000,
            progressPercent: 20,
            sessionId,
        });
        await manager.applyProgress(queued.task.id, {
            status: 'downloading',
            providerProgressMode: 'absolute',
            progressSource: 'bytes',
            downloadedBytes: 500_000_000,
            totalBytes: 1_000_000_000,
            progressPercent: 50,
            sessionId: 'old-session',
        });
        const task = manager.getSnapshot().tasks.find(t => t.id === queued.task.id);
        assert.equal(task.downloadedBytes, 400_000_000);
        assert.equal(task.totalBytes, 2_000_000_000);
        assert.equal(task.progressPercent, 20);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('installed disk size is not used as the transfer progress denominator', async () => {
    const dir = tempDir();
    try {
        const manager = new DownloadQueueManager({
            repository: new JsonDownloadRepository({ userDataDir: dir }),
            preflight: new DownloadPreflightService(),
            providerExecutor: { start: async () => new Promise(() => {}) },
        });
        await manager.load();
        const queued = await manager.queueInstall(payload('Installed Size Is Separate'));
        await manager.startNow(queued.task.id);
        await manager.transitionTask(queued.task.id, 'downloading', {
            installedDiskSizeBytes: 2_000_000_000,
        });
        await manager.applyProgress(queued.task.id, {
            status: 'downloading',
            downloadedBytes: 500_000_000,
            progressPercent: 50,
            sessionId: manager.findTask(queued.task.id).progressSessionId,
        });
        const task = manager.getSnapshot().tasks.find(t => t.id === queued.task.id);
        assert.equal(task.installedDiskSizeBytes, 2_000_000_000);
        assert.equal(task.totalBytes, null);
        assert.equal(task.progressPercent, null);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('bytes-sourced progress can correct an inflated visible percent', async () => {
    const dir = tempDir();
    try {
        const manager = new DownloadQueueManager({
            repository: new JsonDownloadRepository({ userDataDir: dir }),
            preflight: new DownloadPreflightService(),
            providerExecutor: { start: async () => new Promise(() => {}) },
        });
        await manager.load();
        const queued = await manager.queueInstall(payload('Correct Inflated Percent'));
        await manager.startNow(queued.task.id);
        await manager.applyProgress(queued.task.id, {
            status: 'downloading',
            progressPercent: 80,
            downloadedBytes: 50_000_000,
            totalBytes: 2_000_000_000,
        });
        await manager.applyProgress(queued.task.id, {
            status: 'downloading',
            progressPercent: 3,
            progressSource: 'bytes',
            downloadedBytes: 60_000_000,
            totalBytes: 2_000_000_000,
        });
        const task = manager.getSnapshot().tasks.find(t => t.id === queued.task.id);
        assert.equal(task.progressPercent, 3);
        assert.equal(task.downloadedBytes, 60_000_000);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('live progress emits task patches without durable write per sample', async () => {
    const dir = tempDir();
    try {
        let writes = 0;
        const repository = new JsonDownloadRepository({ userDataDir: dir });
        const originalWrite = repository.writeState.bind(repository);
        repository.writeState = async (state) => {
            writes += 1;
            return originalWrite(state);
        };
        const manager = new DownloadQueueManager({
            repository,
            preflight: new DownloadPreflightService(),
        });
        const updates = [];
        manager.on('task-updated', update => updates.push(update));
        await manager.load();
        const queued = await manager.queueInstall(payload('Telemetry Write Test'));
        const writesAfterQueue = writes;
        const progressSessionId = 'session-live-progress';
        await manager.transitionTask(queued.task.id, 'preparing', { progressSessionId });
        await manager.transitionTask(queued.task.id, 'downloading', { progressSessionId });
        const writesAfterStart = writes;
        await manager.applyProgress(queued.task.id, {
            status: 'downloading',
            progressPercent: 10,
            downloadedBytes: 100,
            totalBytes: 1000,
            sessionId: progressSessionId,
        });
        await manager.applyProgress(queued.task.id, {
            status: 'downloading',
            progressPercent: 20,
            downloadedBytes: 200,
            totalBytes: 1000,
            sessionId: progressSessionId,
        });
        assert.equal(writes, writesAfterStart);
        assert.ok(writesAfterStart > writesAfterQueue);
        assert.ok(updates.length >= 1);
        await manager.flushCheckpoint();
        assert.ok(writes > writesAfterStart);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('queue preflight does not create install folder or marker', async () => {
    const dir = tempDir();
    const installBase = tempDir();
    try {
        const manager = makeManager(dir);
        await manager.load();
        const installPath = path.join(installBase, 'No Mutation');
        await manager.queueInstall({ ...payload('No Mutation'), installPath });
        assert.equal(fs.existsSync(installPath), false);
        assert.equal(fs.existsSync(path.join(installPath, '.baddel-download-partial.json')), false);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
        fs.rmSync(installBase, { recursive: true, force: true });
    }
});

test('marker is created only when execution starts', async () => {
    const dir = tempDir();
    const installBase = tempDir();
    try {
        const manager = new DownloadQueueManager({
            repository: new JsonDownloadRepository({ userDataDir: dir }),
            preflight: new DownloadPreflightService(),
            providerExecutor: { start: async () => new Promise(() => {}) },
        });
        await manager.load();
        const queued = await manager.queueInstall({ ...payload('Marker Start'), installPath: path.join(installBase, 'Marker Start') });
        const markerPath = path.join(queued.task.installPath, '.baddel-download-partial.json');
        assert.equal(fs.existsSync(markerPath), false);
        await manager.startNow(queued.task.id);
        assert.equal(await waitForPathExists(markerPath), true);
        const task = manager.findTask(queued.task.id);
        const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
        assert.equal(marker.taskId, queued.task.id);
        assert.equal(marker.identityKey, task.identityKey);
        assert.equal(marker.ownershipNonce, task.ownershipNonce);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
        fs.rmSync(installBase, { recursive: true, force: true });
    }
});

test('provider start failure removes newly-created empty task directory and marker', async () => {
    const dir = tempDir();
    const installBase = tempDir();
    try {
        const providerExecutor = {
            start: async () => {
                const err = new Error('start failed');
                err.code = 'GOG_DOWNLOAD_PROCESS_FAILED';
                throw err;
            },
            cancel: async () => {},
        };
        const manager = new DownloadQueueManager({
            repository: new JsonDownloadRepository({ userDataDir: dir }),
            preflight: new DownloadPreflightService(),
            providerExecutor,
        });
        await manager.load();
        const queued = await manager.queueInstall({ ...payload('Start Failure'), installPath: path.join(installBase, 'Start Failure') });
        await manager.startNow(queued.task.id);
        const task = await waitForTaskStatus(manager, queued.task.id, 'failed');
        assert.equal(task.status, 'failed');
        assert.equal(task.partialDeletedAt != null, true);
        assert.equal(fs.existsSync(queued.task.installPath), false);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
        fs.rmSync(installBase, { recursive: true, force: true });
    }
});

test('keep-partial cancellation performs no deletion', async () => {
    const dir = tempDir();
    const installBase = tempDir();
    try {
        const manager = new DownloadQueueManager({
            repository: new JsonDownloadRepository({ userDataDir: dir }),
            preflight: new DownloadPreflightService(),
            providerExecutor: {
                start: async () => new Promise(() => {}),
                cancel: async () => {},
            },
        });
        await manager.load();
        const queued = await manager.queueInstall({ ...payload('Keep Partial'), installPath: path.join(installBase, 'Keep Partial') });
        const markerPath = path.join(queued.task.installPath, '.baddel-download-partial.json');
        await manager.startNow(queued.task.id);
        assert.equal(await waitForPathExists(markerPath), true);
        await manager.cancel({ taskId: queued.task.id, deletePartial: false });
        assert.equal(manager.getSnapshot().tasks.some(task => task.id === queued.task.id), false);
        assert.equal(fs.existsSync(queued.task.installPath), true);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
        fs.rmSync(installBase, { recursive: true, force: true });
    }
});
test('cancel targets the live duplicate-id task after a previous cancelled attempt', async () => {
    const dir = tempDir();
    const installBase = tempDir();
    try {
        let cancelCount = 0;
        const manager = new DownloadQueueManager({
            repository: new JsonDownloadRepository({ userDataDir: dir }),
            preflight: new DownloadPreflightService(),
            providerExecutor: {
                start: async () => new Promise(() => {}),
                cancel: async () => { cancelCount += 1; return { requested: true, exitConfirmed: true }; },
            },
        });
        await manager.load();
        const basePayload = { ...payload('Duplicate Cancel'), installPath: path.join(installBase, 'Duplicate Cancel') };
        const first = await manager.queueInstall(basePayload);
        await manager.cancel({ taskId: first.task.id, deletePartial: false });
        const second = await manager.queueInstall(basePayload);
        assert.equal(second.task.id, first.task.id);

        await manager.startNow(second.task.id);
        assert.equal(await waitForPathExists(path.join(second.task.installPath, '.baddel-download-partial.json')), true);
        await manager.cancel({ taskId: second.task.id, deletePartial: false });

        const matching = manager.getSnapshot().tasks.filter(task => task.id === second.task.id);
        assert.equal(cancelCount >= 1, true);
        assert.equal(matching.some(task => task.status === 'preparing' || task.status === 'downloading'), false);
        assert.equal(matching.length, 0);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
        fs.rmSync(installBase, { recursive: true, force: true });
    }
});

test('delete-partial cancellation removes only task-owned data', async () => {
    const dir = tempDir();
    const installBase = tempDir();
    try {
        const manager = new DownloadQueueManager({
            repository: new JsonDownloadRepository({ userDataDir: dir }),
            preflight: new DownloadPreflightService(),
            providerExecutor: {
                start: async () => new Promise(() => {}),
                cancel: async () => {},
            },
        });
        await manager.load();
        const queued = await manager.queueInstall({ ...payload('Partial Delete'), installPath: path.join(installBase, 'Partial Delete') });
        const markerPath = path.join(queued.task.installPath, '.baddel-download-partial.json');
        await manager.startNow(queued.task.id);
        assert.equal(await waitForPathExists(markerPath), true);
        fs.writeFileSync(path.join(queued.task.installPath, 'partial.bin'), 'partial');
        await manager.cancel({ taskId: queued.task.id, deletePartial: true });

        assert.equal(manager.getSnapshot().tasks.some(task => task.id === queued.task.id), false);
        assert.equal(fs.existsSync(queued.task.installPath), false);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
        fs.rmSync(installBase, { recursive: true, force: true });
    }
});



test('resume with valid ownership marker preserves partial files and does not require empty folder', async () => {
    const dir = tempDir();
    const installBase = tempDir();
    try {
        let startCount = 0;
        const manager = new DownloadQueueManager({
            repository: new JsonDownloadRepository({ userDataDir: dir }),
            preflight: new DownloadPreflightService(),
            providerExecutor: {
                start: async () => {
                    startCount += 1;
                    return new Promise(() => {});
                },
                pause: async () => ({ exitConfirmed: true }),
            },
        });
        await manager.load();
        const queued = await manager.queueInstall({ ...payload('Resume Owned Partial'), installPath: path.join(installBase, 'Resume Owned Partial') });
        await manager.startNow(queued.task.id);
        const markerPath = path.join(queued.task.installPath, '.baddel-download-partial.json');
        assert.equal(await waitForPathExists(markerPath), true);
        const markerBefore = fs.readFileSync(markerPath, 'utf8');
        fs.writeFileSync(path.join(queued.task.installPath, 'partial.bin'), 'partial');
        await manager.pause(queued.task.id);
        await manager.resume(queued.task.id);
        await waitForValue(() => startCount >= 2);
        assert.equal(startCount, 2);
        assert.equal(fs.readFileSync(markerPath, 'utf8'), markerBefore);
        assert.equal(fs.existsSync(path.join(queued.task.installPath, 'partial.bin')), true);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
        fs.rmSync(installBase, { recursive: true, force: true });
    }
});

test('first hard stall auto-resumes once and preserves owned partials', async () => {
    const dir = tempDir();
    const installBase = tempDir();
    try {
        let cancelReason = null;
        let startCount = 0;
        const { DownloadTelemetryAggregator } = require('../src/features/downloads/infrastructure/services/DownloadTelemetryAggregator');
        const manager = new DownloadQueueManager({
            repository: new JsonDownloadRepository({ userDataDir: dir }),
            preflight: new DownloadPreflightService(),
            telemetryAggregator: new DownloadTelemetryAggregator({ emitIntervalMs: 0, stallWarningMs: 1000, hardStallMs: 2000, speedStaleGraceMs: 5000 }),
            providerExecutor: {
                start: async () => { startCount += 1; return new Promise(() => {}); },
                cancel: async (_taskId, options = {}) => {
                    cancelReason = options.reason || null;
                    return { exitConfirmed: true };
                },
            },
        });
        await manager.load();
        const queued = await manager.queueInstall({ ...payload('Stall Preserve'), installPath: path.join(installBase, 'Stall Preserve') });
        await manager.startNow(queued.task.id);
        const markerPath = path.join(queued.task.installPath, '.baddel-download-partial.json');
        assert.equal(await waitForPathExists(markerPath), true);
        fs.writeFileSync(path.join(queued.task.installPath, 'partial.bin'), 'partial');
        const sessionId = manager.findTask(queued.task.id).progressSessionId;
        await manager.applyProgress(queued.task.id, {
            sessionId,
            timestamp: 1000,
            status: 'downloading',
            eventType: 'download-speed',
            rawDownloadSpeedBps: 1_000_000,
        });
        await manager.applyProgress(queued.task.id, {
            sessionId,
            timestamp: 3200,
            status: 'downloading',
            eventType: 'download-speed',
            rawDownloadSpeedBps: 900_000,
        });
        await manager.applyProgress(queued.task.id, {
            sessionId,
            timestamp: 5400,
            status: 'downloading',
            eventType: 'download-speed',
            rawDownloadSpeedBps: 0,
        });
        await waitForValue(() => startCount === 2);
        const task = manager.findTask(queued.task.id);
        assert.equal(startCount, 2);
        assert.equal(task.stallAutoResumeAttempts, 1);
        assert.equal(cancelReason, 'stall');
        assert.equal(fs.existsSync(markerPath), true);
        assert.equal(fs.existsSync(path.join(queued.task.installPath, 'partial.bin')), true);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
        fs.rmSync(installBase, { recursive: true, force: true });
    }
});


test('resume preserves stable global total when provider reports remaining-transfer total', async () => {
    const dir = tempDir();
    try {
        let onProgressRef;
        const manager = new DownloadQueueManager({
            repository: new JsonDownloadRepository({ userDataDir: dir }),
            preflight: new DownloadPreflightService(),
            providerExecutor: { start: async (_task, { onProgress }) => { onProgressRef = onProgress; return new Promise(() => {}); } },
        });
        await manager.load();
        const queued = await manager.queueInstall(payload('Stable Resume Total'));
        await manager.transitionTask(queued.task.id, 'paused', {
            progressPercent: 86.5217391304,
            downloadedBytes: 398_000_000,
            totalBytes: 460_000_000,
            checkpointProgressPercent: 86.5217391304,
            checkpointDownloadedBytes: 398_000_000,
            checkpointTotalBytes: 460_000_000,
            checkpointSessionId: 'session-a',
        });
        await manager.resume(queued.task.id);
        onProgressRef = await waitForValue(() => onProgressRef);
        await onProgressRef({
            status: 'downloading',
            providerProgressMode: 'absolute',
            progressSource: 'bytes',
            downloadedBytes: 0,
            totalBytes: 62_000_000,
            progressPercent: 0,
        });
        const task = manager.findTask(queued.task.id);
        assert.equal(task.downloadedBytes, 398_000_000);
        assert.equal(task.totalBytes, 460_000_000);
        assert.equal(Math.round(task.progressPercent * 10) / 10, 86.5);
        assert.equal(task.sessionDownloadedBytes, 0);
        assert.equal(task.sessionTotalBytes, 62_000_000);
        assert.equal(task.progressMode, 'session-relative');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('session-relative resume progress advances global progress without shrinking total', async () => {
    const dir = tempDir();
    try {
        let onProgressRef;
        const manager = new DownloadQueueManager({
            repository: new JsonDownloadRepository({ userDataDir: dir }),
            preflight: new DownloadPreflightService(),
            providerExecutor: { start: async (_task, { onProgress }) => { onProgressRef = onProgress; return new Promise(() => {}); } },
        });
        await manager.load();
        const queued = await manager.queueInstall(payload('Session Relative'));
        await manager.transitionTask(queued.task.id, 'paused', {
            downloadedBytes: 398_000_000,
            totalBytes: 460_000_000,
            checkpointDownloadedBytes: 398_000_000,
            checkpointTotalBytes: 460_000_000,
            checkpointSessionId: 'session-a',
        });
        await manager.resume(queued.task.id);
        onProgressRef = await waitForValue(() => onProgressRef);
        await onProgressRef({ status: 'downloading', providerProgressMode: 'absolute', progressSource: 'bytes', downloadedBytes: 10_000_000, totalBytes: 62_000_000, progressPercent: 16 });
        const task = manager.findTask(queued.task.id);
        assert.equal(task.downloadedBytes, 408_000_000);
        assert.equal(task.totalBytes, 460_000_000);
        assert.equal(task.sessionDownloadedBytes, 10_000_000);
        assert.equal(task.sessionTotalBytes, 62_000_000);
        assert.equal(task.downloadedBytes <= task.totalBytes, true);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('smaller denominator after resume cannot replace stable total', async () => {
    const dir = tempDir();
    try {
        let onProgressRef;
        const manager = new DownloadQueueManager({
            repository: new JsonDownloadRepository({ userDataDir: dir }),
            preflight: new DownloadPreflightService(),
            providerExecutor: { start: async (_task, { onProgress }) => { onProgressRef = onProgress; return new Promise(() => {}); } },
        });
        await manager.load();
        const queued = await manager.queueInstall(payload('No Shrink Resume'));
        await manager.transitionTask(queued.task.id, 'paused', {
            downloadedBytes: 400_000_000,
            totalBytes: 460_000_000,
            checkpointDownloadedBytes: 400_000_000,
            checkpointTotalBytes: 460_000_000,
            checkpointSessionId: 'session-a',
        });
        await manager.resume(queued.task.id);
        onProgressRef = await waitForValue(() => onProgressRef);
        await onProgressRef({ status: 'downloading', providerProgressMode: 'absolute', progressSource: 'bytes', downloadedBytes: 0, totalBytes: 145_000_000, progressPercent: 0 });
        const task = manager.findTask(queued.task.id);
        assert.equal(task.totalBytes, 460_000_000);
        assert.equal(task.downloadedBytes <= task.totalBytes, true);
        assert.notEqual(task.totalBytes, 145_000_000);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('progress sample from network log does not leave active task with terminal network error', async () => {
    const dir = tempDir();
    try {
        const manager = new DownloadQueueManager({
            repository: new JsonDownloadRepository({ userDataDir: dir }),
            preflight: new DownloadPreflightService(),
            providerExecutor: { start: async () => new Promise(() => {}) },
        });
        await manager.load();
        const queued = await manager.queueInstall(payload('Transient Network'));
        await manager.startNow(queued.task.id);
        const sessionId = manager.findTask(queued.task.id).progressSessionId;
        await manager.applyProgress(queued.task.id, {
            status: 'downloading',
            statusMessage: 'temporary connection timeout, retrying',
            errorCode: 'GOG_NETWORK_ERROR',
            errorMessage: 'temporary connection timeout',
            sessionId,
        });
        const task = manager.findTask(queued.task.id);
        assert.equal(task.status, 'downloading');
        assert.equal(task.errorCode, null);
        assert.equal(task.transientProviderWarningCode, 'GOG_NETWORK_ERROR');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('provider network exit becomes retryable failed task and preserves partial eligibility', async () => {
    const dir = tempDir();
    try {
        const manager = new DownloadQueueManager({
            repository: new JsonDownloadRepository({ userDataDir: dir }),
            preflight: new DownloadPreflightService(),
            preparingProgressTimeoutMs: 1000,
            providerExecutor: {
                start: async () => {
                    const err = new Error('GOG download hit a network error. Retry when the connection is stable.');
                    err.code = 'GOG_NETWORK_ERROR';
                    err.retryable = true;
                    throw err;
                },
            },
        });
        await manager.load();
        const queued = await manager.queueInstall(payload('Network Exit'));
        await manager.startNow(queued.task.id);
        const task = await waitForTaskStatus(manager, queued.task.id, 'failed', 1000);
        assert.equal(task.status, 'failed');
        assert.equal(task.errorCode, 'GOG_NETWORK_ERROR');
        assert.equal(task.retryable, true);
        assert.equal(task.partialDeletionEligible, false);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('second hard stall becomes retryable failed task without a third start', async () => {
    const dir = tempDir();
    try {
        let cancelCount = 0;
        let startCount = 0;
        const { DownloadTelemetryAggregator } = require('../src/features/downloads/infrastructure/services/DownloadTelemetryAggregator');
        const manager = new DownloadQueueManager({
            repository: new JsonDownloadRepository({ userDataDir: dir }),
            preflight: new DownloadPreflightService(),
            telemetryAggregator: new DownloadTelemetryAggregator({ stallWarningMs: 5, hardStallMs: 10 }),
            providerExecutor: {
                start: async () => { startCount += 1; return new Promise(() => {}); },
                cancel: async () => { cancelCount += 1; return { requested: true, exitConfirmed: true }; },
            },
        });
        await manager.load();
        const queued = await manager.queueInstall(payload('Hard Stall'));
        await manager.startNow(queued.task.id);
        const sessionId = manager.findTask(queued.task.id).progressSessionId;
        await manager.applyProgress(queued.task.id, { status: 'downloading', eventType: 'download-speed', rawDownloadSpeedBps: 1, sessionId, timestamp: 1000 });
        await manager.applyProgress(queued.task.id, { status: 'downloading', eventType: 'download-speed', rawDownloadSpeedBps: 0, sessionId, timestamp: 1020 });
        await waitForValue(() => startCount === 2);
        const secondSessionId = manager.findTask(queued.task.id).progressSessionId;
        await manager.applyProgress(queued.task.id, { status: 'downloading', eventType: 'download-speed', rawDownloadSpeedBps: 1, sessionId: secondSessionId, timestamp: 2000 });
        await manager.applyProgress(queued.task.id, { status: 'downloading', eventType: 'download-speed', rawDownloadSpeedBps: 0, sessionId: secondSessionId, timestamp: 2020 });
        const task = await waitForTaskStatus(manager, queued.task.id, 'failed');
        assert.equal(cancelCount, 2);
        assert.equal(startCount, 2);
        assert.equal(task.status, 'failed');
        assert.equal(task.errorCode, 'GOG_DOWNLOAD_STALLED');
        assert.equal(task.retryable, true);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
