'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { EpicDownloadTrace, sanitizeText } = require('../src/features/downloads/infrastructure/services/EpicDownloadTrace');

test('diagnostic resume flushes the preceding capture and stale patches cannot change session identity', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-trace-session-'));
    const binary = path.join(dir, 'synthetic-runtime');
    fs.writeFileSync(binary, 'synthetic hash input, never executed');
    const trace = new EpicDownloadTrace({ userDataDir: dir, enabled: true,
        probe: async (_file, args) => ({ args, code: 0, stdout: 'no debug flag supported by this fake', stderr: '' }) });
    const task = { id: 'dl_bbbbbbbbbbbbbbbb', platform: 'epic', installProvider: 'legendary', progressSessionId: 'first' };
    const runtime = { getRuntime: () => ({ legendaryPath: binary }), runtimeOptions: { projectRoot: path.resolve(__dirname, '..') } };
    t.after(async () => {
        await trace.flush(task.id);
        assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep));
        fs.rmSync(dir, { recursive: true, force: true });
    });
    assert.equal(await trace.begin(task, runtime, 'test-isolated-config'), false);
    const firstPath = trace.sessions.get(task.id).path;
    trace.record(task.id, 'LAST_PENDING_EVENT', { value: 1 });
    await trace.begin({ ...task, progressSessionId: 'second' }, runtime, 'test-isolated-config');
    assert.match(fs.readFileSync(firstPath, 'utf8'), /LAST_PENDING_EVENT/);
    trace.pipeline(task.id, { sessionId: 'first' }, 'QUEUE_REJECT', { reason: 'stale' });
    assert.equal(trace.sessions.get(task.id).progressSessionId, 'second');
    assert.notEqual(trace.sessions.get(task.id).path, firstPath);
});

test('diagnostic sanitization masks signed URLs and multiline header values without changing numeric telemetry', () => {
    const sanitized = sanitizeText('authorization:\nPRIVATE_VALUE\n[DLManager] INFO: boundary\n' +
        '[worker] DEBUG: https://cdn.example/chunk?signature=PRIVATE_URL\n' +
        '[DLManager] INFO: boundary\n[DLManager] INFO: Downloaded: 1.00 MiB\r\n');
    assert.ok(!sanitized.includes('PRIVATE_'));
    assert.ok(sanitized.endsWith('[DLManager] INFO: Downloaded: 1.00 MiB\r\n'));
});
