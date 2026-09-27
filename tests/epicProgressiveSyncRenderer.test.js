'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const sidebar = fs.readFileSync(path.join(ROOT, 'src/js/app/sidebar.js'), 'utf8');
function sourceOf(name, nextName) {
    const start = sidebar.indexOf(`function ${name}`);
    let end = sidebar.indexOf(`function ${nextName}`, start);
    if (sidebar.slice(end - 6, end) === 'async ') end -= 6;
    assert.ok(start >= 0 && end > start, `${name} source is available`);
    return sidebar.slice(start, end);
}
const functions = [
    sourceOf('_vaultEpicProgressState', '_vaultEpicProgressSummary'),
    sourceOf('_vaultEpicProgressSummary', '_vaultEpicProgressNoticeHtml'),
    sourceOf('_vaultEpicProgressNoticeHtml', 'retryVaultEpicPhase'),
].join('\n');

function render(state) {
    const context = { __vaultEpicProgressStates: { account: state }, _vaultHtml: (value) => String(value) };
    vm.createContext(context);
    vm.runInContext(`${functions}; this.summary = _vaultEpicProgressSummary('account'); this.notice = _vaultEpicProgressNoticeHtml('account');`, context);
    return context;
}

test('first Epic import renders pending copy without false zero values', () => {
    const view = render({
        accountId: 'account', isFirstFullImport: true, overallStatus: 'library_ready_enriching',
        phases: { prices: { status: 'running', processed: 2, total: 9 }, purchaseHistory: { status: 'pending' } },
    });
    assert.equal(view.summary, 'Updating prices and purchase history');
    assert.match(view.notice, /Prices 2\/9/);
    assert.match(view.notice, /History 0 pages/);
    assert.match(view.notice, /Your Epic library is ready/);
    assert.match(view.notice, /still being calculated/);
    assert.doesNotMatch(view.notice, /\$0|0\.00|no purchases/i);
});

test('later refresh explicitly keeps saved values visible while enrichment runs', () => {
    const view = render({
        accountId: 'account', isFirstFullImport: false, overallStatus: 'library_ready_enriching',
        phases: { prices: { status: 'complete' }, purchaseHistory: { status: 'running' } },
    });
    assert.equal(view.summary, 'History 0 pages · 0 orders');
    assert.match(view.notice, /data-vault-epic-progress-history/);
    assert.match(view.notice, /Showing your last saved values/);
});

test('partial state exposes phase-specific retry without claiming the library failed', () => {
    const view = render({
        accountId: 'account', overallStatus: 'partial',
        phases: { prices: { status: 'complete' }, purchaseHistory: { status: 'failed', errorCode: 'EPIC_HISTORY_FETCH_FAILED' } },
    });
    assert.match(view.notice, /games remain available/i);
    assert.match(view.notice, /Retry history/);
    assert.doesNotMatch(view.notice, /Retry prices/);
});
