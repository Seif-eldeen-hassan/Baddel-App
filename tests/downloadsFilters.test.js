'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const GB = 1024 ** 3;
const now = Date.parse('2026-09-03T12:00:00Z');
const defaults = { search: '', platform: 'all', size: 'all', date: 'all', sort: 'newest' };
const tasks = [
    { id: 'active', title: 'Z active', status: 'downloading', platform: 'gog', totalBytes: 100 * GB },
    { id: 'ep3', title: 'Epic Episode', status: 'completed', platform: 'epic', totalBytes: 3 * GB, createdAt: '2025-01-01', completedAt: '2026-09-03T09:00:00Z', uninstallEligible: true, installPath: 'D:\\Games\\EP3', installedGameId: 'epic_ep3' },
    { id: 'san', title: 'Sanitarium', status: 'paused', platform: 'gog', totalBytes: null, installedDiskSizeBytes: 0.5 * GB, createdAt: '2026-08-30' },
    { id: 'unknown', title: 'Unknown', status: 'pending', platform: 'epic', totalBytes: null, createdAt: '2026-07-01' },
    { id: 'big', title: 'Big Game', status: 'failed', platform: 'gog', totalBytes: 25 * GB, createdAt: '2026-08-14' },
];
function harness() {
    const controls = new Map(); let writes = 0;
    const root = { _html: '', get innerHTML() { return this._html; }, set innerHTML(value) { writes++; this._html = value; } };
    controls.set('downloadsRoot', root);
    controls.set('downloadsPlatform', { dataset: {}, value: 'all' });
    const calls = []; let confirm = null;
    const context = { console, Date, performance, setInterval() {}, clearInterval() {}, setTimeout() {}, clearTimeout() {},
        document: { readyState: 'loading', addEventListener() {}, getElementById: id => controls.get(id) || null, querySelector: () => null, querySelectorAll: () => [] },
        showToast() {}, openConfirmModal: (...args) => { confirm = args; },
        electronAPI: { downloads: { uninstall: async id => { calls.push(id); return { status: 'success', snapshot: { tasks: [] } }; } } },
    };
    context.window = context; vm.createContext(context);
    const src = fs.readFileSync('src/js/downloads.js', 'utf8');
    vm.runInContext(src.replace(/\}\)\(\);\s*$/, 'window.hooks = { dlFilterTasks, dlFilterSize, dlTaskCard, renderDownloads, patchDownloadTaskCard, getSnapshot: () => downloadsSnapshot, getFilters: () => downloadFilters };})();'), context);
    return { context, hooks: context.hooks, root, calls, get confirm() { return confirm; }, get writes() { return writes; } };
}
function ids(filters) { return Array.from(harness().hooks.dlFilterTasks(tasks, { ...defaults, ...filters }, now), task => task.id); }
test('filters name/platform/size/date and combined selection pin all active tasks', () => {
    assert.deepEqual(ids({ search: 'ePiC eP' }), ['active', 'ep3']);
    assert.deepEqual(ids({ platform: 'epic' }), ['active', 'ep3', 'unknown']);
    assert.deepEqual(ids({ size: 'under1' }), ['active', 'san']);
    assert.deepEqual(ids({ size: '1to5' }), ['active', 'ep3']);
    assert.deepEqual(ids({ size: '5to20' }), ['active']);
    assert.deepEqual(ids({ size: '20to50' }), ['active', 'big']);
    assert.deepEqual(ids({ size: '50plus' }), ['active']);
    assert.deepEqual(ids({ date: 'today' }), ['active', 'ep3']);
    assert.deepEqual(ids({ date: '7days' }), ['active', 'ep3', 'san']);
    assert.deepEqual(ids({ date: '30days' }), ['active', 'ep3', 'san', 'big']);
    assert.deepEqual(ids({ date: 'older' }), ['active', 'unknown']);
    assert.deepEqual(ids({ platform: 'epic', search: 'Episode', size: '1to5', date: '7days' }), ['active', 'ep3']);
});
test('sorts derive arrays without mutation, unknown size sorts last in both directions', () => {
    const before = JSON.stringify(tasks);
    assert.deepEqual(ids({ sort: 'az' }), ['active', 'big', 'ep3', 'san', 'unknown']);
    assert.deepEqual(ids({ sort: 'za' }), ['active', 'unknown', 'san', 'ep3', 'big']);
    assert.deepEqual(ids({ sort: 'oldest' }), ['active', 'unknown', 'big', 'san', 'ep3']);
    assert.deepEqual(ids({ sort: 'smallest' }), ['active', 'san', 'ep3', 'big', 'unknown']);
    assert.deepEqual(ids({ sort: 'largest' }), ['active', 'big', 'ep3', 'san', 'unknown']);
    assert.deepEqual(ids({ sort: 'platform' }), ['active', 'ep3', 'unknown', 'big', 'san']);
    assert.equal(harness().hooks.dlFilterSize(tasks[3]), null);
    assert.equal(JSON.stringify(tasks), before);
});
test('reset restores filters; completed actions retain task ID after sorting', () => {
    const h = harness(); h.hooks.renderDownloads({ tasks });
    h.context.downloadsSetFilter('search', 'not found');
    assert.match(h.root.innerHTML, /active/); assert.doesNotMatch(h.root.innerHTML, /downloadsPlay\('ep3/);
    h.context.downloadsResetFilters();
    assert.equal(h.hooks.getFilters().search, '');
    assert.match(h.root.innerHTML, /downloadsPlay\('ep3'\)/);
    assert.match(h.root.innerHTML, /data-task-action="uninstall" data-task-id="ep3"/);
});
test('hidden speed-only patches merge state without rebuilding cards; size changes update filter membership', () => {
    const h = harness(); h.hooks.renderDownloads({ tasks: tasks.map(t => ({ ...t })) });
    h.context.downloadsSetFilter('size', 'under1'); const before = h.writes;
    h.hooks.patchDownloadTaskCard({ taskId: 'ep3', patch: { downloadSpeedBps: 200 } });
    assert.equal(h.writes, before);
    assert.equal(h.hooks.getSnapshot().tasks.find(t => t.id === 'ep3').downloadSpeedBps, 200);
    h.hooks.patchDownloadTaskCard({ taskId: 'ep3', patch: { totalBytes: GB / 2 } });
    assert.equal(h.writes, before + 1); assert.match(h.root.innerHTML, /downloadsPlay\('ep3'\)/);
});
test('uninstall requires confirmation, cancel is inert, unavailable confirmation fails closed', async () => {
    const h = harness(); h.hooks.renderDownloads({ tasks: [tasks[1]] });
    h.context.downloadsUninstall('ep3'); assert.equal(h.calls.length, 0);
    assert.equal(h.confirm[0], 'Uninstall Epic Episode?'); assert.match(h.confirm[1], /D:\\Games\\EP3/);
    assert.match(h.confirm[1], /outside this game folder/);
    const confirm = h.confirm[3]; await confirm(); assert.deepEqual(h.calls, ['ep3']);
    assert.equal(h.hooks.getSnapshot().tasks.length, 0);
    h.hooks.renderDownloads({ tasks: [tasks[1]] }); h.context.openConfirmModal = undefined;
    h.context.downloadsUninstall('ep3'); assert.equal(h.calls.length, 1);
});
test('no matching inactive tasks shows filter empty state; unmanaged cards have no Uninstall', () => {
    const h = harness(); h.hooks.renderDownloads({ tasks: [{ ...tasks[1], uninstallEligible: false }] });
    assert.doesNotMatch(h.root.innerHTML, /data-task-action="uninstall"/);
    h.context.downloadsSetFilter('search', 'missing');
    assert.match(h.root.innerHTML, /No downloads match these filters/);
});
