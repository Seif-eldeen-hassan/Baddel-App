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
    return fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-provider-download-'));
}

function payload(title = 'GOG Game', installRoot = path.join(os.tmpdir(), 'baddel-provider-download-installs')) {
    return {
        platform: 'gog',
        accountId: 'gog-a',
        title,
        providerProductId: '123',
        installPath: path.join(installRoot, title),
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

async function waitForTaskStatus(manager, taskId, status, timeoutMs = 1500) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const tasks = manager.getSnapshot().tasks.filter(t => t.id === taskId);
        const task = tasks.find(t => t.status === status);
        if (task) return task;
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    const tasks = manager.getSnapshot().tasks.filter(t => t.id === taskId);
    return tasks.find(t => t.status === status) || tasks[tasks.length - 1];
}

async function waitForAnyTaskStatus(manager, taskId, statuses, timeoutMs = 1500) {
    const wanted = new Set(statuses);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const tasks = manager.getSnapshot().tasks.filter(t => t.id === taskId);
        const task = tasks.find(t => wanted.has(t.status));
        if (task) return task;
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    const tasks = manager.getSnapshot().tasks.filter(t => t.id === taskId);
    return tasks.find(t => wanted.has(t.status)) || tasks[tasks.length - 1];
}

test('Start Now runs provider and completes the existing queued task', async () => {
    const dir = tempDir();
    try {
        let started = 0;
        const providerExecutor = {
            start: async (_task, { onProgress }) => {
                started += 1;
                onProgress({ status: 'downloading', providerProgressMode: 'absolute', progressSource: 'bytes', downloadedBytes: 1000, totalBytes: 1000, progressPercent: 100, statusMessage: 'Downloading with fake GOG' });
                return completionReceipt();
            },
            pause: async () => {},
            cancel: async () => {},
        };
        const manager = new DownloadQueueManager({
            repository: new JsonDownloadRepository({ userDataDir: dir }),
            preflight: new DownloadPreflightService(),
            providerExecutor,
        });
        await manager.load();
        const queued = await manager.queueInstall(payload('GOG Game', path.join(dir, 'installs')));
        await manager.startNow(queued.task.id);
        await new Promise(resolve => setTimeout(resolve, 30));
        const task = manager.getSnapshot().tasks[0];
        assert.equal(started, 1);
        assert.equal(task.status, 'completed');
        assert.equal(task.progressPercent, 100);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('Epic direct downloads are rejected before entering the queue', async () => {
    const dir = tempDir();
    try {
        const manager = new DownloadQueueManager({
            repository: new JsonDownloadRepository({ userDataDir: dir }),
            preflight: new DownloadPreflightService(),
            providerExecutor: { start: async () => { throw new Error('should not start'); } },
        });
        await manager.load();
        await assert.rejects(
            () => manager.queueInstall({ ...payload('Epic Game', path.join(dir, 'installs')), platform: 'epic' }),
            err => err.code === 'EPIC_DIRECT_DOWNLOAD_NOT_AVAILABLE'
        );
        assert.equal(manager.getSnapshot().tasks.length, 0);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('failed GOG provider execution marks task failed and retry can complete after provider recovers', async () => {
    const dir = tempDir();
    try {
        let fail = true;
        const providerExecutor = {
            start: async (_task, { onProgress }) => {
                if (fail) {
                    const err = new Error('Baddel could not resolve the GOG download manifest. Retry or relink the account.');
                    err.code = 'GOG_MANIFEST_RESOLUTION_FAILED';
                    throw err;
                }
                onProgress({ status: 'downloading', providerProgressMode: 'absolute', progressSource: 'bytes', downloadedBytes: 1000, totalBytes: 1000, progressPercent: 100, statusMessage: 'Downloading with fake GOG' });
                return completionReceipt();
            },
            pause: async () => {},
            cancel: async () => {},
        };
        const manager = new DownloadQueueManager({
            repository: new JsonDownloadRepository({ userDataDir: dir }),
            preflight: new DownloadPreflightService(),
            providerExecutor,
        });
        await manager.load();
        await manager.updateSettings({ autoStartNext: false });
        const queued = await manager.queueInstall(payload('Probe Fail Game', path.join(dir, 'installs')));
        await manager.startNow(queued.task.id);
        let task = await waitForTaskStatus(manager, queued.task.id, 'failed');
        assert.equal(task.status, 'failed');
        assert.equal(task.errorCode, 'GOG_MANIFEST_RESOLUTION_FAILED');
        await new Promise(resolve => setTimeout(resolve, 20));

        fail = false;
        await manager.retry(queued.task.id);
        task = await waitForAnyTaskStatus(manager, queued.task.id, ['pending', 'preparing', 'downloading', 'completed']);
        if (task.status === 'pending') await manager.startNow(queued.task.id);
        task = await waitForTaskStatus(manager, queued.task.id, 'completed');
        assert.equal(task.status, 'completed');
        assert.equal(task.progressPercent, 100);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('GOG provider no-progress exit is surfaced as failed instead of completed', async () => {
    const dir = tempDir();
    try {
        const providerExecutor = {
            start: async (_task, { onProgress }) => {
                onProgress({ status: 'downloading', statusMessage: 'GOG download started.' });
                const err = new Error('GOG opened the download manager but stopped before transferring files.');
                err.code = 'GOG_DOWNLOAD_NO_PROGRESS';
                throw err;
            },
            pause: async () => {},
            cancel: async () => {},
        };
        const manager = new DownloadQueueManager({
            repository: new JsonDownloadRepository({ userDataDir: dir }),
            preflight: new DownloadPreflightService(),
            providerExecutor,
        });
        await manager.load();
        const queued = await manager.queueInstall(payload('No Progress GOG', path.join(dir, 'installs')));
        await manager.startNow(queued.task.id);
        const task = await waitForTaskStatus(manager, queued.task.id, 'failed');
        assert.equal(task.status, 'failed');
        assert.equal(task.errorCode, 'GOG_DOWNLOAD_NO_PROGRESS');
        assert.equal(task.progressPercent, null);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('provider partial progress followed by resolution fails without completion receipt', async () => {
    const dir = tempDir();
    try {
        const providerExecutor = {
            start: async (_task, { onProgress }) => {
                onProgress({ status: 'downloading', progressPercent: 55, downloadedBytes: 550, totalBytes: 1000, statusMessage: 'Partial transfer' });
                return { statusMessage: 'Done' };
            },
        };
        const manager = new DownloadQueueManager({
            repository: new JsonDownloadRepository({ userDataDir: dir }),
            preflight: new DownloadPreflightService(),
            providerExecutor,
        });
        await manager.load();
        const queued = await manager.queueInstall(payload('Partial Resolve', path.join(dir, 'installs')));
        await manager.startNow(queued.task.id);
        const task = await waitForTaskStatus(manager, queued.task.id, 'failed');
        assert.equal(task.status, 'failed');
        assert.equal(task.errorCode, 'DOWNLOAD_COMPLETION_UNCONFIRMED');
        assert.notEqual(task.status, 'completed');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('Start Now rejects non-pending tasks without starting another queued download', async () => {
    const dir = tempDir();
    try {
        let started = 0;
        const providerExecutor = {
            start: async () => {
                started += 1;
                return completionReceipt();
            },
        };
        const manager = new DownloadQueueManager({
            repository: new JsonDownloadRepository({ userDataDir: dir }),
            preflight: new DownloadPreflightService(),
            providerExecutor,
        });
        await manager.load();
        const first = await manager.queueInstall(payload('First', path.join(dir, 'installs')));
        await manager.queueInstall(payload('Second', path.join(dir, 'installs')));
        await manager.transitionTask(first.task.id, 'cancelled', { statusMessage: 'Cancelled' });
        await assert.rejects(() => manager.startNow(first.task.id), /Only queued downloads can be started now/);
        assert.equal(started, 0);
        assert.equal(manager.getSnapshot().tasks.find(t => t.title === 'Second').status, 'pending');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('Pause waits for the provider stop path and preserves resumable state', async () => {
    const dir = tempDir();
    try {
        let rejectStart;
        const providerExecutor = {
            start: async () => new Promise((_resolve, reject) => { rejectStart = reject; }),
            pause: async () => {
                rejectStart?.(Object.assign(new Error('stopped'), { code: 'GOG_DOWNLOAD_CANCELLED' }));
                await new Promise(resolve => setTimeout(resolve, 10));
            },
        };
        const manager = new DownloadQueueManager({
            repository: new JsonDownloadRepository({ userDataDir: dir }),
            preflight: new DownloadPreflightService(),
            providerExecutor,
        });
        await manager.load();
        const queued = await manager.queueInstall(payload('Pause Me', path.join(dir, 'installs')));
        await manager.startNow(queued.task.id);
        await new Promise(resolve => setTimeout(resolve, 10));
        await manager.pause(queued.task.id);
        const task = manager.getSnapshot().tasks[0];
        assert.equal(task.status, 'paused');
        assert.equal(task.errorCode, null);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('preparing timeout fails a provider that never emits first progress', async () => {
    const dir = tempDir();
    try {
        let cancelCalled = 0;
        const providerExecutor = {
            start: async () => new Promise(() => {}),
            cancel: async () => { cancelCalled += 1; },
        };
        const manager = new DownloadQueueManager({
            repository: new JsonDownloadRepository({ userDataDir: dir }),
            preflight: new DownloadPreflightService(),
            providerExecutor,
            preparingProgressTimeoutMs: 10,
        });
        await manager.load();
        const queued = await manager.queueInstall(payload('Stuck Preparing', path.join(dir, 'installs')));
        await manager.startNow(queued.task.id);
        const task = await waitForTaskStatus(manager, queued.task.id, 'failed', 500);
        assert.equal(task.status, 'failed');
        assert.equal(task.errorCode, 'DOWNLOAD_PREPARING_TIMEOUT');
        assert.equal(cancelCalled, 1);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
