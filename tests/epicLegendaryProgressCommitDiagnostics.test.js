'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DownloadQueueManager } = require('../src/features/downloads/infrastructure/services/DownloadQueueManager');
const { JsonDownloadRepository } = require('../src/features/downloads/infrastructure/repositories/JsonDownloadRepository');
const { normalizeTask } = require('../src/features/downloads/domain/entities/DownloadTask');

test('Epic rejected progress remains observable and does not become a provider process failure', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-epic-progress-errors-'));
    const warnings = [], records = [], updates = [];
    t.mock.method(console, 'warn', (...args) => warnings.push(args));
    const task = normalizeTask({ id: 'dl_aaaaaaaaaaaaaaaa', platform: 'epic', installProvider: 'legendary', status: 'verifying', stage: 'verifying', progressSessionId: 'error-test' });
    const manager = new DownloadQueueManager({
        repository: new JsonDownloadRepository({ userDataDir: dir }), preflight: {}, autoStart: false,
        diagnosticRecorder: { record: (...args) => records.push(args) },
        providerExecutor: { async start(_task, { onProgress }) {
            for (let index = 0; index < 26; index++) await onProgress({ status: 'downloading', stage: 'downloading' });
            await onProgress({ status: 'verifying', stage: 'verifying', statusMessage: 'Verifying files' });
            manager.stopIntents.set(task.id, 'test-stop');
            throw Object.assign(new Error('Stop simulated provider'), { code: 'EPIC_DOWNLOAD_STOPPED' });
        } },
    });
    t.after(async () => { await manager.flushCheckpoint(); fs.rmSync(dir, { recursive: true, force: true }); });
    await manager.load();
    manager.state.tasks = [task];
    manager.on('task-updated', payload => updates.push(payload));
    await manager.executeActiveTask(task);
    assert.equal(manager.findTask(task.id).status, 'verifying');
    assert.equal(warnings.length, 2);
    assert.equal(warnings[0][1].count, 1);
    assert.equal(warnings[1][1].count, 25);
    assert.equal(records.length, 26);
    assert.ok(records.every(record => record[3].code === 'DOWNLOAD_INVALID_STATE_TRANSITION'));
    assert.ok(records.every(record => record[3].category === 'lifecycle-transition' && record[3].providerProcessFailed === false));
    assert.ok(updates.length > 0);
    assert.ok(updates.every(update => update.status === 'verifying' && update.patch.status === 'verifying'));
});
