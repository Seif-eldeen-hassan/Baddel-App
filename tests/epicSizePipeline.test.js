'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { DownloadInstallPlanService } = require('../src/features/downloads/infrastructure/services/DownloadInstallPlanService');
const { DownloadFileSafetyService } = require('../src/features/downloads/infrastructure/services/DownloadFileSafetyService');
const { DownloadPreflightService } = require('../src/features/downloads/infrastructure/services/DownloadPreflightService');
const { normalizeTask } = require('../src/features/downloads/domain/entities/DownloadTask');
const { makeCompletionPatch } = require('../src/features/downloads/domain/services/DownloadCompletionValidator');
const { DownloadTelemetryAggregator } = require('../src/features/downloads/infrastructure/services/DownloadTelemetryAggregator');
const source = fs.readFileSync('src/js/downloads.js', 'utf8');
const ctx = { document: { readyState: 'loading', addEventListener() {} }, console, performance }; ctx.window = ctx;
vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, 'window.hooks={dlGameInfoSizes,dlGameInfoRows};})();'), ctx);
const downloadSizeBytes = Math.round(574.14 * 1024 * 1024), installedDiskSizeBytes = Math.round(655.78 * 1024 * 1024);
test('Epic preview -> preflight -> task -> reload -> completion -> Game Info preserves size meanings', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'epic-size-test-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    let free = 10e9, writes = 0;
    const readonly = new Proxy(fs, { get(target, prop) {
        if (['mkdirSync', 'writeFileSync', 'rmSync', 'unlinkSync', 'renameSync'].includes(prop)) return () => { writes++; throw new Error('Preview wrote'); };
        if (prop === 'statfsSync') return () => ({ blocks: 20e9, bavail: free, bsize: 1 }); return target[prop];
    } });
    const safety = new DownloadFileSafetyService({ fsSync: readonly, protectedRoots: [] });
    const preflight = new DownloadPreflightService({ fileSafety: safety });
    const service = new DownloadInstallPlanService({ fileSafety: safety, fsSync: readonly, resolveSizes: async () => ({ downloadSizeBytes, installedDiskSizeBytes, sizeSource: 'legendary-info-manifest', buildVersion: 'v1' }) });
    const payload = { platform: 'epic', installProvider: 'legendary', providerAppName: 'app', accountId: 'owner', installPath: path.join(root, 'game') };
    const plan = await service.resolve(payload); assert.equal(plan.totalBytes, downloadSizeBytes); assert.equal(plan.expectedTotalBytes, downloadSizeBytes);
    assert.equal(plan.requiredSpaceBytes, installedDiskSizeBytes); assert.equal(plan.totalRequiredBytes, installedDiskSizeBytes + plan.diskSafetyMarginBytes); assert.equal(plan.enoughSpace, true);
    const queued = service.applyPlan({ ...payload, installPlanId: plan.planId, downloadSizeBytes: 1 });
    const checked = preflight.validateQueuePayload(queued); assert.equal(checked.expectedDownloadBytes, downloadSizeBytes);
    const task = normalizeTask(checked); const reloaded = normalizeTask(JSON.parse(JSON.stringify(task)));
    assert.equal(reloaded.downloadSizeBytes, downloadSizeBytes); assert.equal(reloaded.installedDiskSizeBytes, installedDiskSizeBytes); assert.equal(reloaded.buildVersion, 'v1');
    const receipt = { provider: 'epic', transfer: { totalBytes: downloadSizeBytes, downloadedBytes: downloadSizeBytes }, verification: { actualBytes: installedDiskSizeBytes, status: 'passed' } };
    const completed = normalizeTask({ ...reloaded, ...makeCompletionPatch(receipt, reloaded), status: 'completed' });
    const display = ctx.hooks.dlGameInfoSizes(completed); assert.equal(display.download, downloadSizeBytes); assert.equal(display.installed, installedDiskSizeBytes); assert.equal(display.required, undefined);
    assert.ok(!JSON.stringify(ctx.hooks.dlGameInfoRows(completed)).includes('Required size'));
    free = 100; const other = await service.resolve({ ...payload, installPath: path.join(root, 'other') });
    assert.equal(other.enoughSpace, false); assert.equal(other.freeSpaceBytes, 100); assert.equal(other.missingSpaceBytes, other.totalRequiredBytes - 100);
    assert.equal(writes, 0); assert.deepEqual(fs.readdirSync(root), []);
});
test('normalization does not persist invalid or unknown sizes as zero', () => {
    for (const value of [null, undefined, 0, -1, Infinity, NaN, '123']) assert.equal(normalizeTask({ downloadSizeBytes: value }).downloadSizeBytes, null);
});
test('runtime metadata survives telemetry without being mistaken for a progress counter', () => {
    const aggregator = new DownloadTelemetryAggregator();
    const output = aggregator.apply({ id: 'fixture', status: 'downloading' }, { downloadSizeBytes, downloadSizeSource: 'legendary-runtime-transfer', eventType: 'legendary-progress' });
    assert.equal(output.patch.downloadSizeBytes, downloadSizeBytes); assert.equal(output.patch.downloadSizeSource, 'legendary-runtime-transfer');
});
test('completion backfills unknown sizes and prefers verified installed bytes without overwriting exact download size', () => {
    const receipt = { provider: 'epic', transfer: { totalBytes: 1000 }, verification: { actualBytes: 2000 } };
    const backfill = makeCompletionPatch(receipt, {}); assert.equal(backfill.downloadSizeBytes, 1000); assert.equal(backfill.installedDiskSizeBytes, 2000);
    const existing = makeCompletionPatch(receipt, { downloadSizeBytes: 999, installedDiskSizeBytes: 1900, downloadSizeSource: 'legendary-info-manifest' });
    assert.equal(existing.downloadSizeBytes, 999); assert.equal(existing.installedDiskSizeBytes, 2000); assert.equal(existing.installedSizeSource, 'verified-filesystem');
});
test('old completed Game Info uses historical authoritative fields and never invents required disk size', () => {
    const sizes = ctx.hooks.dlGameInfoSizes({ totalBytes: 1234, verificationActualBytes: 2345 });
    assert.equal(sizes.download, 1234); assert.equal(sizes.installed, 2345); assert.equal(sizes.required, undefined);
    const rows = JSON.stringify(ctx.hooks.dlGameInfoRows({ platform: 'epic', installProvider: 'legendary', totalBytes: 1234, verificationActualBytes: 2345 }));
    assert.ok(!rows.includes('Required size')); assert.ok(!rows.includes('Install method')); assert.ok(!rows.includes('legendary')); assert.ok(rows.includes('Unavailable'));
    assert.equal(ctx.hooks.dlGameInfoSizes({}).download, null);
});
test('composition injects the shared account/runtime resolver and leaves GOG resolver intact', () => {
    const composition = fs.readFileSync('src/features/downloads/infrastructure/composition/DownloadsContainer.js', 'utf8');
    assert.match(composition, /new EpicLegendarySizeResolver\(\{[^}]*cacheRepository: installSizeCache[^}]*\}\)/);
    assert.match(composition, /epicSizeResolver.resolve\(payload\)/); assert.match(composition, /gogSizeResolver.resolve\(payload\)/);
});
test('Game Info uses a scroll body and separated footer; centered dialog and overflow button are scoped', () => {
    const css = fs.readFileSync('src/css/install-flow.css', 'utf8');
    assert.match(source, /class="download-info-body"/); assert.match(source, /class="download-info-footer"/);
    assert.match(css, /\.download-info-dialog \{ position: fixed; inset: 0; margin: auto;/);
    assert.match(css, /\.download-info-body \{ min-height: 0; overflow-y: auto;/);
    assert.match(css, /\.download-overflow-trigger \{[^}]*padding: 0;[^}]*justify-content: center;/);
    assert.match(css, /#downloadsToolbar \.dropdown-item.selected \{ color: #ddd; background: transparent;/);
});
