'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { InstallPlanDiagnosticRecorder } = require('../src/features/downloads/infrastructure/services/InstallPlanDiagnosticRecorder');
const { DownloadInstallPlanService } = require('../src/features/downloads/infrastructure/services/DownloadInstallPlanService');
const { DownloadFileSafetyService } = require('../src/features/downloads/infrastructure/services/DownloadFileSafetyService');

test('install-plan diagnostics are gated, structured, bounded and redact credentials', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'install-plan-diag-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const off = new InstallPlanDiagnosticRecorder({ userDataDir: root, env: {} });
    off.record('off', 'INSTALL_PLAN_REQUEST', { accessToken: 'secret' });
    assert.equal(fs.existsSync(off.file), false);
    const recorder = new InstallPlanDiagnosticRecorder({ userDataDir: root, env: { BADDEL_INSTALL_PLAN_DEBUG: '1' } });
    recorder.record('request-1', 'INSTALL_PLAN_REQUEST', { accountId: 'safe-id', accessToken: 'secret' });
    await recorder.flush();
    const report = JSON.parse(fs.readFileSync(recorder.file, 'utf8'));
    assert.equal(report.events[0].stage, 'INSTALL_PLAN_REQUEST');
    assert.equal(report.events[0].accessToken, '[REDACTED]');
    assert.ok(!JSON.stringify(report).includes('secret'));
});

test('install plan records typed resolver failure and disk result under one correlation ID', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'install-plan-events-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const events = [];
    const service = new DownloadInstallPlanService({
        fileSafety: new DownloadFileSafetyService({ protectedRoots: [] }),
        diagnostics: { record: (id, stage, payload) => events.push({ id, stage, ...payload }) },
        fsSync: new Proxy(fs, { get(target, key) { if (key === 'statfsSync') return () => ({ blocks: 10000, bavail: 5000, bsize: 1 }); return target[key]; } }),
        resolveSizes: async () => { throw Object.assign(new Error('private detail'), { code: 'EPIC_INFO_TIMEOUT' }); },
    });
    const plan = await service.resolve({ platform: 'epic', installProvider: 'legendary', accountId: 'owner', providerAppName: 'app', installPath: path.join(root, 'game') });
    assert.equal(plan.sizeReason, 'EPIC_INFO_TIMEOUT'); assert.equal(plan.downloadSizeBytes, null); assert.equal(plan.enoughSpace, null);
    assert.deepEqual(events.map(event => event.stage), ['INSTALL_PLAN_REQUEST', 'INSTALL_PLAN_IDENTITY', 'INSTALL_PLAN_SELECTION_KEY', 'INSTALL_PLAN_SIZE_RESOLVER_START', 'INSTALL_PLAN_PENDING_REQUEST', 'INSTALL_PLAN_SIZE_RESOLVER_ERROR', 'INSTALL_PLAN_DISK_RESULT', 'INSTALL_PLAN_RESPONSE']);
    assert.equal(new Set(events.map(event => event.id)).size, 1);
});
