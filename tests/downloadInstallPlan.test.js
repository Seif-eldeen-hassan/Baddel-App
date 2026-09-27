'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { deflateSync } = require('node:zlib');
const { DownloadInstallPlanService, resolveGogManifestSizes } = require('../src/features/downloads/infrastructure/services/DownloadInstallPlanService');
const { DownloadFileSafetyService, MARKER_FILE } = require('../src/features/downloads/infrastructure/services/DownloadFileSafetyService');
function setup(t, sizes = {}, free = 100000000000) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-preview-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    let writes = 0; let calls = 0; let now = 1000;
    const readonly = new Proxy(fs, { get(target, key) {
        if (['mkdirSync', 'writeFileSync', 'unlinkSync', 'rmSync', 'renameSync'].includes(key)) return () => { writes++; throw new Error('Preview mutation'); };
        if (key === 'statfsSync') return () => ({ blocks: 200000000000, bavail: free, bsize: 1 });
        return target[key];
    } });
    const safety = new DownloadFileSafetyService({ fsSync: readonly, protectedRoots: [], minSafetyMarginBytes: 100 });
    const service = new DownloadInstallPlanService({ fileSafety: safety, fsSync: readonly, now: () => now, resolveSizes: async () => { calls++; return sizes; }, getDrives: async () => [{ path: path.parse(root).root, label: 'Test drive' }] });
    const payload = { platform: 'gog', installProvider: 'gogdl', providerProductId: '123', accountId: 'owner', gameId: 'gog123', installPath: path.join(root, 'new-parent', 'Game') };
    return { root, payload, service, get writes() { return writes; }, get calls() { return calls; }, advance() { now += 61000; } };
}
test('drive preview exposes root, volume label, total and authoritative free bytes', async t => {
    const h = setup(t); const drives = await h.service.storageOptions();
    assert.equal(drives[0].label, 'Test drive'); assert.equal(drives[0].freeSpaceBytes, 100000000000); assert.equal(drives[0].totalCapacityBytes, 200000000000);
});
test('preview is observational even for multiple missing parent directories', async t => {
    const h = setup(t, { downloadSizeBytes: 1000, installedDiskSizeBytes: 2000 });
    const before = fs.readdirSync(h.root);
    await h.service.resolve(h.payload);
    assert.equal(h.writes, 0); assert.deepEqual(fs.readdirSync(h.root), before);
    assert.equal(fs.existsSync(h.payload.installPath), false); assert.equal(fs.existsSync(path.join(h.payload.installPath, MARKER_FILE)), false);
});
test('known size exposes separate download, installed, reserve, required and remaining', async t => {
    const h = setup(t, { downloadSizeBytes: 1000, installedDiskSizeBytes: 2000 }, 10000);
    const p = await h.service.resolve(h.payload);
    assert.equal(p.downloadSizeBytes, 1000); assert.equal(p.installedDiskSizeBytes, 2000); assert.equal(p.diskSafetyMarginBytes, 200);
    assert.equal(p.requiredSpaceBytes, 2000); assert.equal(p.totalRequiredBytes, 2200); assert.equal(p.afterInstallBytes, 7800); assert.equal(p.enoughSpace, true);
});
test('known insufficient space reports missing bytes and rejects final confirmation', async t => {
    const h = setup(t, { installedDiskSizeBytes: 2000 }, 2100); const p = await h.service.resolve(h.payload);
    assert.equal(p.enoughSpace, false); assert.equal(p.missingSpaceBytes, 100);
    assert.throws(() => h.service.applyPlan({ ...h.payload, installPlanId: p.planId }), { code: 'DOWNLOAD_INSUFFICIENT_DISK_SPACE' });
});
for (const value of [undefined, null, 0, -1, NaN, Infinity, '2000']) test(`unknown/invalid installed size stays unknown: ${value}`, async t => {
    const h = setup(t, { installedDiskSizeBytes: value, downloadSizeBytes: 100 }); const p = await h.service.resolve(h.payload);
    assert.equal(p.installedDiskSizeBytes, null); assert.equal(p.enoughSpace, null); assert.equal(p.totalRequiredBytes, null); assert.equal(p.afterInstallBytes, null);
});
test('provider failure remains unknown, not zero or enough space', async t => {
    const h = setup(t); h.service.resolveSizes = async () => { throw new Error('offline'); };
    const p = await h.service.resolve(h.payload); assert.equal(p.enoughSpace, null); assert.equal(p.sizeReason, 'GOG_MANIFEST_UNAVAILABLE');
});
test('queue uses server-held resolved sizes, never client override of plan', async t => {
    const h = setup(t, { downloadSizeBytes: 1000, installedDiskSizeBytes: 2000 }); const p = await h.service.resolve(h.payload);
    const queued = h.service.applyPlan({ ...h.payload, installPlanId: p.planId, installedDiskSizeBytes: 1, totalBytes: 1 });
    assert.equal(queued.installedDiskSizeBytes, 2000); assert.equal(queued.totalBytes, 1000); assert.equal(queued.expectedTotalBytes, 1000); assert.equal(queued.downloadSizeBytes, 1000);
});
for (const [field, value] of [['accountId', 'other'], ['platform', 'epic'], ['providerProductId', '456'], ['installPath', 'C:\\elsewhere'], ['language', 'fr-FR']]) test(`plan is bound to selected ${field}`, async t => {
    const h = setup(t); const p = await h.service.resolve(h.payload);
    assert.throws(() => h.service.applyPlan({ ...h.payload, installPlanId: p.planId, [field]: value }), { code: 'DOWNLOAD_INSTALL_PLAN_EXPIRED' });
});
test('expired plans require fresh preview; rapid location checks reuse metadata only', async t => {
    const h = setup(t); const p = await h.service.resolve(h.payload); await h.service.resolve(h.payload); assert.equal(h.calls, 1);
    h.advance(); assert.throws(() => h.service.applyPlan({ ...h.payload, installPlanId: p.planId }), { code: 'DOWNLOAD_INSTALL_PLAN_EXPIRED' });
    await h.service.resolve(h.payload); assert.equal(h.calls, 2);
});
test('preview rejects drive roots, existing files, populated directories and relative paths', async t => {
    const h = setup(t);
    for (const installPath of [path.parse(h.root).root, 'relative']) await assert.rejects(h.service.resolve({ ...h.payload, installPath }));
    const file = path.join(h.root, 'save.dat'); fs.writeFileSync(file, 'keep');
    await assert.rejects(h.service.resolve({ ...h.payload, installPath: file }));
    await assert.rejects(h.service.resolve({ ...h.payload, installPath: h.root }));
    assert.equal(fs.readFileSync(file, 'utf8'), 'keep'); assert.equal(h.writes, 0);
});
function mockFetch(meta, build = {}) {
    const calls = [];
    const fetch = async (url, options) => { calls.push({ url, options }); return new Response(calls.length === 1 ? JSON.stringify({ items: [{ product_id: '123', generation: 2, public: true, branch: null, link: 'https://gog-cdn.gcdn.co/content-system/v2/meta/test', ...build }] }) : deflateSync(JSON.stringify(meta))); };
    return { fetch, calls };
}
test('GOG size resolution uses Windows base product and selected language; excludes DLC', async () => {
    const mock = mockFetch({ baseProductId: '123', dependencies: [], depots: [
        { productId: '123', languages: ['*'], compressedSize: 10, size: 20 },
        { productId: '123', languages: ['en-US'], compressedSize: 30, size: 40 },
        { productId: '123', languages: ['fr-FR'], compressedSize: 90, size: 100 },
        { productId: '456', languages: ['*'], compressedSize: 500, size: 600 },
    ] });
    const result = await resolveGogManifestSizes({ providerProductId: '123' }, mock.fetch);
    assert.equal(result.downloadSizeBytes, 40); assert.equal(result.installedDiskSizeBytes, 60); assert.equal(mock.calls.length, 2);
    assert.ok(mock.calls.every(call => call.options.redirect === 'error' && !call.options.headers));
});
test('GOG unresolved dependencies and mismatched identities never claim full known size', async () => {
    for (const meta of [{ baseProductId: '456', depots: [] }, { baseProductId: '123', depots: [], dependencies: ['redist'] }, { baseProductId: '123', depots: [{ productId: '123', languages: ['*'], size: 100, compressedSize: 50 }, { productId: '123', languages: ['English'], size: 1000, compressedSize: 500 }] }]) {
        const result = await resolveGogManifestSizes({ providerProductId: '123' }, mockFetch(meta).fetch);
        assert.equal(result.installedDiskSizeBytes, undefined); assert.ok(result.sizeReason);
    }
});
test('provider metadata URL cannot redirect preview to a local or arbitrary host', async () => {
    const mock = mockFetch({}, { link: 'http://127.0.0.1/private' });
    await assert.rejects(resolveGogManifestSizes({ providerProductId: '123' }, mock.fetch)); assert.equal(mock.calls.length, 1);
});
