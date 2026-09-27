'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/js/app/sidebar.js'), 'utf8');

test('622 running events coalesce to one DOM patch and zero full renders', (t) => {
    const patchStart = source.indexOf('function _vaultPatchEpicProgressDom');
    const listenerStart = source.indexOf('if (window.electronAPI?.onEpicSyncProgress', patchStart);
    const end = source.indexOf('function bindVaultBackToTop', listenerStart);
    assert.ok(patchStart >= 0 && listenerStart > patchStart && end > listenerStart);
    const raf = [];
    let listener;
    let reconcileCalls = 0;
    const timers = [];
    let now = 10000;
    const context = {
        window: { electronAPI: { onEpicSyncProgress: (callback) => { listener = callback; } } },
        document: { getElementById: () => null, querySelectorAll: () => [] },
        currentView: 'vault',
        __vaultEpicDataCache: { accounts: [] },
        __vaultEpicProgressStates: {},
        __vaultSelectedEpicAccountId: 'a',
        __vaultEpicPendingProgressPayloads: new Map(),
        __vaultEpicSeenTerminalEvents: new Set(),
        __vaultEpicProgressPatchScheduled: false,
        __vaultEpicProgressDomPatchCount: 0,
        __vaultEpicVaultReconcileCount: 0,
        __vaultEpicFullRenderCount: 0,
        __vaultEpicBatchReconcileTimer: null,
        __vaultEpicLastBatchReconcileAt: 0,
        Date: { now: () => now },
        setTimeout: (callback) => { timers.push(callback); return timers.length; },
        clearTimeout: () => {},
        _vaultRaf: (callback) => raf.push(callback),
        _vaultEpicProgressState: () => null,
        _vaultEpicProgressSummary: () => '',
        _vaultEpicPhaseProgressText: () => '',
        _vaultEpicProgressNoticeHtml: () => '',
        _vaultMergeEpicProgressState: (_existing, incoming) => incoming,
        _vaultReconcileProgressWithCommittedVault: () => {},
        invalidateEpicVaultCache: () => { reconcileCalls += 1; return Promise.resolve(); },
        console,
    };
    vm.createContext(context);
    vm.runInContext(source.slice(patchStart, end), context);
    for (let processed = 1; processed <= 622; processed += 1) {
        listener({ accountId: 'a', phase: 'prices', phaseStatus: 'running', state: { phases: { prices: { status: 'running', processed, total: 622 } } } });
    }
    assert.equal(raf.length, 1);
    raf.shift()();
    assert.equal(context.__vaultEpicProgressDomPatchCount, 1);
    assert.equal(context.__vaultEpicFullRenderCount, 0);
    for (let processed = 25; processed <= 622; processed += 25) {
        listener({ accountId: 'a', phase: 'prices', phaseStatus: 'batch_committed', state: { phases: { prices: { status: 'running', processed, total: 622 } } } });
    }
    assert.equal(timers.length, 1);
    assert.equal(reconcileCalls, 0);
    timers.shift()();
    assert.equal(reconcileCalls, 1);
    assert.equal(context.__vaultEpicFullRenderCount, 0);
    t.diagnostic('renderer metrics: domPatches=' + context.__vaultEpicProgressDomPatchCount + ', fullRenders=' + context.__vaultEpicFullRenderCount + ', reconciles=' + reconcileCalls);
});

test('renderer source keeps running progress off the full-render path', () => {
    const listener = source.slice(source.indexOf('if (window.electronAPI?.onEpicSyncProgress'), source.indexOf('function bindVaultBackToTop'));
    assert.match(listener, /_vaultRaf/);
    assert.match(listener, /batch_committed/);
    assert.doesNotMatch(listener, /_renderVaultEpicFromCache/);
    assert.match(source, /games are available\. Prices could not be loaded yet/);
    assert.match(source, /Retry prices/);
    assert.match(source, /Retry history/);
    assert.match(source, /failedStage/);
});
