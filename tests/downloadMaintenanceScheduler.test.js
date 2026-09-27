'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
    DownloadMaintenanceScheduler,
    UPDATE_CHECK_TTL_MS,
    UPDATE_CHECK_SWEEP_INTERVAL_MS,
    UPDATE_CHECK_INITIAL_DELAY_MS,
    UPDATE_CHECK_CONCURRENCY,
} = require('../src/features/downloads/infrastructure/services/DownloadMaintenanceScheduler');
const { UpdateCheckCoordinator } = require('../src/features/downloads/infrastructure/services/UpdateCheckCoordinator');

const NOW = Date.parse('2026-09-05T12:00:00.000Z');
class FixedDate extends Date { constructor(value) { super(value === undefined ? NOW : value); } }
function managed(overrides = {}) {
    return {
        taskId: 'dl_0123456789abcdef', installedGameId: 'gog_1', installPath: 'D:\\Games\\One',
        platform: 'gog', installProvider: 'gogdl', status: 'completed', updateCheckedAt: null,
        updateAvailable: false, ...overrides,
    };
}
function harness(records, checkForUpdate = async () => {}) {
    const calls = [];
    const coordinator = new UpdateCheckCoordinator();
    const queueManager = {
        ensureLoaded: async () => {},
        getSnapshot: () => ({ managedInstallations: records }),
        checkForUpdate: (id, options = {}) => coordinator.request({
            identity: records.find(record => record.taskId === id)?.installedGameId || id,
            priority: options.priority,
            run: async () => { calls.push(id); return checkForUpdate(id); },
        }),
    };
    return { scheduler: new DownloadMaintenanceScheduler({ queueManager, clock: FixedDate, logger: { warn() {} } }), calls, queueManager };
}

test('automatic checker schedules an unchecked eligible managed game', async () => {
    const h = harness([managed()]);
    const result = await h.scheduler.sweep();
    assert.equal(result.checked, 1);
    assert.deepEqual(h.calls, ['dl_0123456789abcdef']);
});

test('automatic checker skips a game checked less than 24 hours ago', async () => {
    const h = harness([managed({ updateCheckedAt: new Date(NOW - UPDATE_CHECK_TTL_MS + 1).toISOString() })]);
    assert.equal((await h.scheduler.sweep()).selected, 0);
    assert.equal(h.calls.length, 0);
});

test('automatic checker selects a game at or older than the 24-hour TTL', async () => {
    const h = harness([managed({ updateCheckedAt: new Date(NOW - UPDATE_CHECK_TTL_MS).toISOString() })]);
    assert.equal((await h.scheduler.sweep()).checked, 1);
});

test('manual update check bypasses scheduler TTL', async () => {
    const h = harness([managed({ updateCheckedAt: new Date(NOW - 1000).toISOString() })]);
    assert.equal((await h.scheduler.sweep()).selected, 0);
    await h.queueManager.checkForUpdate('dl_0123456789abcdef');
    assert.deepEqual(h.calls, ['dl_0123456789abcdef']);
});

test('scheduler provider concurrency is bounded at two', async () => {
    let active = 0; let max = 0;
    const records = Array.from({ length: 6 }, (_, index) => managed({ taskId: `dl_${String(index).padStart(16, '0')}`, installedGameId: `gog_${index}` }));
    const h = harness(records, async () => { active += 1; max = Math.max(max, active); await new Promise(resolve => setImmediate(resolve)); active -= 1; });
    await h.scheduler.sweep();
    assert.equal(max, 2);
    assert.equal(h.calls.length, 6);
    assert.equal(UPDATE_CHECK_CONCURRENCY, 2);
});

test('repeated scheduler wake-up shares the in-flight sweep', async () => {
    let release;
    const blocked = new Promise(resolve => { release = resolve; });
    const h = harness([managed()], () => blocked);
    const first = h.scheduler.sweep();
    const second = h.scheduler.sweep();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.calls.length, 1);
    release();
    const [a, b] = await Promise.all([first, second]);
    assert.deepEqual(a, b);
});

test('queued, running, and paused maintenance records are not auto-checked', async () => {
    const records = ['pending', 'preparing', 'downloading', 'verifying', 'paused'].map((status, index) => managed({ taskId: `dl_${String(index).padStart(16, '1')}`, installedGameId: `gog_${index}`, operationKind: 'repair', status }));
    const h = harness(records);
    assert.equal((await h.scheduler.sweep()).selected, 0);
});

test('maintenance request preparation excludes the same game from automatic checks', async () => {
    const h = harness([managed()]);
    h.queueManager.hasMaintenanceRequestForTask = () => true;
    assert.equal((await h.scheduler.sweep()).selected, 0);
});

test('provider failure preserves prior update state and is reported without throwing the sweep', async () => {
    const record = managed({ updateAvailable: true, targetBuildId: 'known-new-build' });
    const h = harness([record], async () => { throw Object.assign(new Error('network unavailable'), { code: 'NETWORK_UNAVAILABLE' }); });
    const result = await h.scheduler.sweep();
    assert.equal(result.failed, 1);
    assert.equal(record.updateAvailable, true);
    assert.equal(record.targetBuildId, 'known-new-build');
});

test('automatic checks include only managed GOG and Epic Legendary provenance', async () => {
    const records = [
        managed(),
        managed({ taskId: 'dl_1111111111111111', installedGameId: 'epic_1', platform: 'epic', installProvider: 'legendary' }),
        managed({ taskId: 'dl_2222222222222222', installedGameId: 'epic_2', platform: 'epic', installProvider: 'epic_launcher' }),
        managed({ taskId: 'dl_3333333333333333', installedGameId: null }),
    ];
    const h = harness(records);
    assert.equal((await h.scheduler.sweep()).checked, 2);
    assert.deepEqual(h.calls, ['dl_0123456789abcdef', 'dl_1111111111111111']);
});

test('Steam is excluded and scheduler lifecycle uses delayed initial and hourly sweeps', () => {
    const timers = [];
    const h = harness([managed({ platform: 'steam', installProvider: 'steam_client', installedGameId: 'steam_1' })]);
    h.scheduler.setTimeoutFn = (fn, ms) => { timers.push(['timeout', ms, fn]); return { unref() {} }; };
    h.scheduler.setIntervalFn = (fn, ms) => { timers.push(['interval', ms, fn]); return { unref() {} }; };
    h.scheduler.start();
    assert.deepEqual(timers.map(([kind, ms]) => [kind, ms]), [['timeout', UPDATE_CHECK_INITIAL_DELAY_MS], ['interval', UPDATE_CHECK_SWEEP_INTERVAL_MS]]);
    assert.equal(h.scheduler.isEligible(h.queueManager.getSnapshot().managedInstallations[0]), false);
});

test('scheduler is composed once, starts after ready-to-show, and stops before quit', () => {
    const container = fs.readFileSync('src/features/downloads/infrastructure/composition/DownloadsContainer.js', 'utf8');
    const main = fs.readFileSync('main.js', 'utf8');
    assert.match(container, /new DownloadMaintenanceScheduler\(\{ queueManager, diagnosticRecorder \}\)/);
    assert.match(main, /ready-to-show[\s\S]{0,300}maintenanceScheduler\?\.start/);
    assert.match(main, /before-quit[\s\S]{0,200}maintenanceScheduler\?\.stop/);
});
