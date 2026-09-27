'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JsonDownloadRepository } = require('../src/features/downloads/infrastructure/repositories/JsonDownloadRepository');
const { JsonDownloadHistoryRepository } = require('../src/features/downloads/infrastructure/repositories/JsonDownloadHistoryRepository');
const { DownloadQueueManager } = require('../src/features/downloads/infrastructure/services/DownloadQueueManager');
const { CHANNELS } = require('../src/features/downloads/infrastructure/ipc/downloads.ipc');

function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-download-history-')); }
function completedTask(overrides = {}) {
    return {
        id: 'dl_0123456789abcdef', identityKey: 'gog:gogdl:game-1', title: 'History Game',
        platform: 'gog', installProvider: 'gogdl', status: 'completed',
        startedAt: '2026-09-10T10:00:00.000Z', completedAt: '2026-09-10T11:00:00.000Z',
        updatedAt: '2026-09-10T11:00:00.000Z', totalBytes: 123456, coverUrl: 'https://example.com/cover.jpg?token=secret',
        ...overrides,
    };
}

test('Download History uses dedicated allowlisted IPC channels', () => {
    assert.equal(CHANNELS.GET_HISTORY, 'downloads:get-history');
    assert.equal(CHANNELS.CLEAR_HISTORY, 'downloads:clear-history');
});

test('Download History persists after recreation and duplicate terminal events remain idempotent', async () => {
    const dir = tempDir();
    try {
        const first = new JsonDownloadHistoryRepository({ userDataDir: dir });
        await first.archive(completedTask());
        await first.archive(completedTask());
        const restored = new JsonDownloadHistoryRepository({ userDataDir: dir });
        const entries = await restored.list();
        assert.equal(entries.length, 1);
        assert.equal(entries[0].taskId, 'dl_0123456789abcdef');
        assert.equal(entries[0].status, 'completed');
        assert.equal(entries[0].sizeBytes, 123456);
        assert.equal(entries[0].artworkUrl, 'https://example.com/cover.jpg');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('repeated queue completion events create one archived history entry', async () => {
    const dir = tempDir();
    try {
        const repository = new JsonDownloadRepository({ userDataDir: dir });
        const historyRepository = new JsonDownloadHistoryRepository({ userDataDir: dir });
        await repository.writeState({ ...repository.emptyState(), tasks: [completedTask({
            status: 'verifying', completedAt: null, downloadedBytes: 123456,
            totalBytes: 123456, completionConfirmed: false,
        })] });
        const manager = new DownloadQueueManager({ repository, historyRepository, preflight: {} });
        await manager.load();
        await manager.transitionTask('dl_0123456789abcdef', 'resuming');
        await manager.transitionTask('dl_0123456789abcdef', 'verifying');
        const receipt = {
            provider: 'gog', processExitCode: 0, completionConfirmed: true,
            completedAt: '2026-09-10T11:00:00.000Z',
            transfer: { downloadedBytes: 123456, totalBytes: 123456, source: 'test-receipt' },
            verification: { status: 'passed', method: 'test', verifiedFileCount: 1, actualBytes: 123456, executableFound: true },
        };
        await manager.completeTask('dl_0123456789abcdef', receipt);
        await manager.completeTask('dl_0123456789abcdef', receipt);
        assert.equal((await manager.getHistory()).length, 1);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Clear Completed removes queue cards but preserves the separate Download History archive', async () => {
    const dir = tempDir();
    try {
        const repository = new JsonDownloadRepository({ userDataDir: dir });
        const historyRepository = new JsonDownloadHistoryRepository({ userDataDir: dir });
        await repository.writeState({ ...repository.emptyState(), tasks: [completedTask()] });
        const manager = new DownloadQueueManager({ repository, historyRepository, preflight: {} });
        await manager.load();
        assert.equal((await manager.getHistory()).length, 1);
        await manager.clearCompleted();
        assert.equal(manager.getSnapshot().tasks.length, 0);
        assert.equal((await manager.getHistory()).length, 1);
        const recreated = new JsonDownloadHistoryRepository({ userDataDir: dir });
        assert.equal((await recreated.list()).length, 1);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('failed tasks are archived and Clear History leaves the queue untouched', async () => {
    const dir = tempDir();
    try {
        const repository = new JsonDownloadRepository({ userDataDir: dir });
        const historyRepository = new JsonDownloadHistoryRepository({ userDataDir: dir });
        await repository.writeState({ ...repository.emptyState(), tasks: [completedTask({ status: 'downloading', completedAt: null })] });
        const manager = new DownloadQueueManager({ repository, historyRepository, preflight: {} });
        await manager.load();
        await manager.transitionTask('dl_0123456789abcdef', 'resuming');
        await manager.transitionTask('dl_0123456789abcdef', 'failed', { errorCode: 'TEST_FAILURE', errorMessage: 'Failed' });
        assert.equal((await manager.getHistory())[0].status, 'failed');
        await manager.clearHistory();
        assert.equal((await manager.getHistory()).length, 0);
        assert.equal(manager.getSnapshot().tasks.length, 1);
        assert.equal(manager.getSnapshot().tasks[0].status, 'failed');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Download History stores only display metadata', async () => {
    const dir = tempDir();
    try {
        const repository = new JsonDownloadHistoryRepository({ userDataDir: dir });
        await repository.archive(completedTask({ token: 'secret', cookies: ['secret'], env: { TOKEN: 'secret' }, command: '--auth secret' }));
        const raw = fs.readFileSync(repository.historyFile, 'utf8');
        assert.doesNotMatch(raw, /"token"|"cookies"|"env"|"command"|secret/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
