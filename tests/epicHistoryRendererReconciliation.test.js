'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'app', 'sidebar.js'), 'utf8');
const PROGRESS_BLOCK = SOURCE.slice(
    SOURCE.indexOf('function _vaultEpicProgressState'),
    SOURCE.indexOf('async function retryVaultEpicPhase')
);
const STATUS_BLOCK = SOURCE.slice(
    SOURCE.indexOf('function _vaultEpicHistoryStatus'),
    SOURCE.indexOf('function _vaultEpicEmptyStateHtml')
);

function harness({ account, progress, refreshing = false, notice = null }) {
    const sandbox = { Date, Number, String, Object, Array };
    vm.createContext(sandbox);
    vm.runInContext(`
        let __vaultEpicDataCache = { accounts: [${JSON.stringify(account)}] };
        let __vaultEpicProgressStates = { ${JSON.stringify(account.accountId)}: ${JSON.stringify(progress)} };
        let __vaultEpicHistoryRefreshing = ${refreshing};
        let __vaultSelectedEpicAccountId = ${JSON.stringify(account.accountId)};
        let __vaultEpicHistoryNotice = ${JSON.stringify(notice)};
        function _vaultHtml(value) { return String(value ?? ''); }
        ${PROGRESS_BLOCK}
        ${STATUS_BLOCK}
        globalThis.result = {
            status: (items) => _vaultEpicHistoryStatus(__vaultEpicDataCache.accounts[0], items),
            notice: () => _vaultEpicProgressNoticeHtml(${JSON.stringify(account.accountId)}),
            phase: () => _vaultEffectiveHistoryPhase(${JSON.stringify(account.accountId)}),
            merge: _vaultMergeEpicProgressState,
        };
    `, sandbox);
    return sandbox.result;
}

function account() {
    return {
        accountId: 'account-a',
        purchaseHistoryFetchedAt: '2026-09-09T11:34:46.173Z',
        phaseRevisions: { purchaseHistory: 7 },
        purchaseHistoryItems: [{ orderId: 'saved-order' }],
    };
}

function progress(history) {
    return {
        overallStatus: 'partial',
        phases: {
            library: { status: 'complete' },
            prices: { status: 'complete' },
            purchaseHistory: history,
        },
    };
}

test('saved History rows and timestamp override the observed stale progressive failure', () => {
    const view = harness({
        account: account(),
        progress: progress({
            status: 'failed', errorCode: 'EPIC_HISTORY_REFRESH_ALREADY_RUNNING',
            completedAt: '2026-09-09T11:34:18.984Z',
        }),
    });
    assert.equal(view.status(account().purchaseHistoryItems), null);
    assert.equal(view.notice(), '');
    assert.equal(view.phase().errorCode, null);
    assert.notEqual(view.phase().status, 'failed');
});

test('already-running is active progress during a canonical manual refresh, never an error', () => {
    const view = harness({
        account: { ...account(), purchaseHistoryItems: [], purchaseHistoryFetchedAt: null },
        refreshing: true,
        progress: progress({ status: 'failed', errorCode: 'EPIC_HISTORY_REFRESH_ALREADY_RUNNING' }),
    });
    assert.equal(view.phase().status, 'running');
    assert.equal(view.phase().errorCode, null);
    assert.equal(view.status([]).kind, 'progress');
    assert.doesNotMatch(view.notice(), /needs attention|Retry history|ALREADY_RUNNING/i);
});

test('a later genuine failure keeps saved rows visible and produces one non-blocking notice', () => {
    const view = harness({
        account: account(),
        progress: progress({
            status: 'failed', errorCode: 'EPIC_HISTORY_NETWORK_ERROR',
            completedAt: '2026-09-09T11:35:46.173Z', operationSequence: 3,
        }),
    });
    assert.equal(view.status(account().purchaseHistoryItems), null, 'saved rows remain renderable');
    const html = view.notice();
    assert.match(html, /Some Epic details need attention/);
    assert.equal((html.match(/role="status"/g) || []).length, 1);
    assert.doesNotMatch(html, /vault-empty-state/);
});

test('a delayed older failure cannot replace a newer committed renderer state', () => {
    const view = harness({ account: account(), progress: progress({ status: 'complete' }) });
    const current = progress({ status: 'complete', operationSequence: 4, committedRevision: 7, errorCode: null });
    const delayed = progress({ status: 'failed', operationSequence: 3, committedRevision: 0, errorCode: 'EPIC_HISTORY_FETCH_FAILED' });
    const merged = view.merge(current, delayed);
    assert.equal(merged.phases.purchaseHistory.status, 'complete');
    assert.equal(merged.phases.purchaseHistory.committedRevision, 7);
    assert.equal(merged.phases.purchaseHistory.errorCode, null);
});
