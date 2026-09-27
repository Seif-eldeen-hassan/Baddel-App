'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function rendererHarness({ queueResult, checkResult, capabilityResults = [], platform = 'gog', platformSyncResult } = {}) {
    let navigations = 0;
    let queueCalls = 0;
    let checkCalls = 0;
    const toasts = [];
    const timers = [];
    const events = [];
    let capabilityCalls = 0;
    let syncCalls = 0;
    const confirmations = [];
    const context = {
        console,
        Date,
        performance,
        setTimeout(callback) { timers.push(callback); return timers.length; }, clearTimeout() {}, setInterval() {}, clearInterval() {},
        CustomEvent: class CustomEvent { constructor(type) { this.type = type; } },
        document: {
            readyState: 'loading', addEventListener() {}, getElementById() { return null; },
            querySelector() { return null; }, querySelectorAll() { return []; },
        },
        dispatchEvent(event) { events.push(event.type); }, addEventListener() {},
        showToast(value, type) { toasts.push(typeof value === 'object' ? value : { message: value, type }); },
        openConfirmModal(title, message, label, run) { confirmations.push({ title, message, label, run }); },
        electronAPI: {
            platformSyncSync: async (...args) => { syncCalls += 1; return typeof platformSyncResult === 'function' ? platformSyncResult(...args) : platformSyncResult || { status: 'success' }; },
            downloads: {
            queueMaintenance: async () => { queueCalls += 1; return typeof queueResult === 'function' ? queueResult() : queueResult || { status: 'success' }; },
            checkUpdate: async () => { checkCalls += 1; return typeof checkResult === 'function' ? checkResult() : checkResult || { status: 'success', update: { updateAvailable: false } }; },
            getCapabilities: async () => capabilityResults[Math.min(capabilityCalls++, capabilityResults.length - 1)] || { status: 'success', capabilities: [] },
            getSnapshot: async () => ({ status: 'success', snapshot: context.__maintenanceSnapshot }),
        } },
    };
    context.window = context;
    vm.createContext(context);
    const source = fs.readFileSync('src/js/downloads.js', 'utf8').replace(/\}\)\(\);\s*$/, `
        window.__maintenanceTest = {
            setSnapshot(value) { downloadsSnapshot = value; },
            setCapabilities(value) { downloadsProviderCapabilities = value; },
            refreshCapabilities(options) { return refreshDownloadCapabilities(options); },
            getCapabilities() { return downloadsProviderCapabilities; },
        };
    })();`);
    vm.runInContext(source, context);
    context.navigateToDownloads = async () => { navigations += 1; };
    const epic = platform === 'epic';
    const record = { taskId: 'dl_0123456789abcdef', installedGameId: epic ? 'epic_App' : 'gog_1', platform, installProvider: epic ? 'legendary' : 'gogdl', accountId: 'owner-a', status: 'completed', uninstallEligible: true };
    context.__maintenanceSnapshot = { tasks: [], managedInstallations: [record] };
    context.__maintenanceTest.setSnapshot(context.__maintenanceSnapshot);
    context.__maintenanceTest.setCapabilities([{ provider: epic ? 'legendary' : 'gog', platform, available: true, supportsUpdate: true, supportsRepair: true }]);
    return { context, game: { id: record.installedGameId, platform }, toasts, timers, events, confirmations, get navigations() { return navigations; }, get queueCalls() { return queueCalls; }, get checkCalls() { return checkCalls; }, get capabilityCalls() { return capabilityCalls; }, get syncCalls() { return syncCalls; } };
}

test('successful right-click or gear maintenance action navigates after queue success', async () => {
    const h = rendererHarness({ queueResult: { status: 'success' } });
    const result = await h.context.__baddelRunMaintenanceAction(h.game, 'repair');
    assert.equal(result.status, 'success');
    assert.equal(h.queueCalls, 1);
    assert.equal(h.navigations, 1);
});

test('failed maintenance queue attempt stays on the current page', async () => {
    const h = rendererHarness({ queueResult: { status: 'error', message: 'provider unavailable' } });
    const result = await h.context.__baddelRunMaintenanceAction(h.game, 'update');
    assert.equal(result, null);
    assert.equal(h.queueCalls, 1);
    assert.equal(h.navigations, 0);
});

test('manual Check for Updates bypass path never navigates to Downloads', async () => {
    const h = rendererHarness();
    const result = await h.context.__baddelRunMaintenanceAction(h.game, 'check');
    assert.equal(result.status, 'success');
    assert.equal(h.checkCalls, 1);
    assert.equal(h.navigations, 0);
});

test('gear and right-click concurrent clicks share renderer duplicate protection', async () => {
    let release;
    const pending = new Promise(resolve => { release = () => resolve({ status: 'success' }); });
    const h = rendererHarness({ queueResult: () => pending });
    const first = h.context.__baddelRunMaintenanceAction(h.game, 'repair');
    const second = h.context.__baddelRunMaintenanceAction(h.game, 'repair');
    assert.equal(await second, null);
    assert.equal(h.queueCalls, 1);
    release();
    await first;
    assert.equal(h.navigations, 1);
});

test('manual check immediately publishes checking state and replaces its lifecycle toast', async () => {
    let release;
    const pending = new Promise(resolve => { release = () => resolve({ status: 'success', update: { updateAvailable: true } }); });
    const h = rendererHarness({ checkResult: () => pending });
    const request = h.context.__baddelRunMaintenanceAction(h.game, 'check');
    assert.equal(h.context.__baddelGetManagedMaintenanceState(h.game).checkingForUpdate, true);
    assert.equal(h.toasts[0].message, 'Checking for updates\u2026');
    assert.match(h.toasts[0].id, /^update-check:/);
    assert.equal(await h.context.__baddelRunMaintenanceAction(h.game, 'check'), null);
    assert.equal(h.checkCalls, 1);
    release();
    await request;
    assert.equal(h.toasts.at(-1).message, 'Update available.');
    assert.equal(h.toasts.at(-1).id, h.toasts[0].id);
});

test('manual check failure reports a safe final message without provider output', async () => {
    const h = rendererHarness({ checkResult: { status: 'error', message: 'raw legendary command output' } });
    await h.context.__baddelRunMaintenanceAction(h.game, 'check');
    assert.equal(h.toasts.at(-1).message, "Couldn't check for updates.");
    assert.doesNotMatch(h.toasts.at(-1).message, /legendary|command/i);
});

test('authoritative maintenance presentation reports queued and running operation states', () => {
    const h = rendererHarness();
    const present = h.context.__baddelMaintenancePresentation;
    assert.equal(present({ operationKind: 'repair', status: 'pending' }).label, 'Repair queued');
    assert.match(present({ operationKind: 'repair', status: 'verifying' }).label, /^Verifying files/);
    assert.match(present({ operationKind: 'repair', status: 'downloading' }).label, /^Repairing/);
    assert.equal(present({ operationKind: 'update', status: 'pending' }).label, 'Update queued');
    assert.match(present({ operationKind: 'update', status: 'downloading' }).label, /^Updating/);
});

test('Epic readiness does not cache a transient successful GOG unavailable response', async () => {
    const h = rendererHarness({ capabilityResults: [
        { status: 'success', capabilities: [
            { platform: 'epic', provider: 'legendary', available: true, supportsUpdate: true, supportsRepair: true },
            { platform: 'gog', provider: 'gog', available: false, supportsUpdate: false, supportsRepair: false },
        ] },
        { status: 'success', capabilities: [
            { platform: 'epic', provider: 'legendary', available: true, supportsUpdate: true, supportsRepair: true },
            { platform: 'gog', provider: 'gog', available: true, supportsUpdate: true, supportsRepair: true },
        ] },
    ] });
    h.context.__maintenanceTest.setCapabilities([]);
    await h.context.__maintenanceTest.refreshCapabilities({ force: true });
    assert.equal(h.context.__baddelGetManagedMaintenanceState(h.game).supportsRepair, false);
    assert.equal(h.timers.length, 1);
    h.timers.shift()();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.capabilityCalls, 2);
    assert.equal(h.context.__baddelGetManagedMaintenanceState(h.game).supportsUpdate, true);
    assert.equal(h.context.__baddelGetManagedMaintenanceState(h.game).supportsRepair, true);
    assert.ok(h.events.includes('baddel-maintenance-state-changed'));
});

test('missing Epic library identity offers targeted exact-account sync and retries without restart', async () => {
    let attempts = 0;
    const h = rendererHarness({
        platform: 'epic',
        queueResult: () => ++attempts === 1
            ? { status: 'error', code: 'EPIC_LIBRARY_IDENTITY_MISSING', message: 'stale provider output' }
            : { status: 'success' },
    });
    await h.context.__baddelRunMaintenanceAction(h.game, 'repair', { navigateOnSuccess: false });
    assert.equal(h.confirmations.length, 1);
    assert.match(h.confirmations[0].title, /Sync this Epic account/);
    await h.confirmations[0].run();
    assert.equal(h.syncCalls, 1);
    assert.equal(h.queueCalls, 2);
    assert.match(h.toasts[0].message, /Sync this Epic account/);
});

test('expired Epic auth is mapped to Reconnect and never mislabeled Resync', async () => {
    const h = rendererHarness({ platform: 'epic', queueResult: { status: 'error', code: 'EPIC_AUTH_REQUIRED', message: 'provider output' } });
    await h.context.__baddelRunMaintenanceAction(h.game, 'repair');
    assert.match(h.toasts.at(-1).message, /^Reconnect Epic account/);
    assert.doesNotMatch(h.toasts.at(-1).message, /Resync/i);
    assert.match(h.confirmations[0].title, /Reconnect/);
});

test('unmanaged GOG games never receive maintenance actions', async () => {
    const h = rendererHarness();
    h.context.__maintenanceSnapshot = { tasks: [], managedInstallations: [] };
    h.context.__maintenanceTest.setSnapshot(h.context.__maintenanceSnapshot);

    assert.equal(h.context.__baddelGetManagedMaintenanceState(h.game), null);
    assert.equal(await h.context.__baddelRunMaintenanceAction(h.game, 'repair'), null);
    assert.equal(h.queueCalls, 0);
    assert.equal(h.navigations, 0);
});
