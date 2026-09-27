'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function extractFunction(source, name) {
    const start = source.indexOf(`async function ${name}`);
    if (start < 0) throw new Error(`${name} not found`);
    const brace = source.indexOf('{', start);
    let depth = 0;
    let quote = null;
    let escaped = false;
    for (let i = brace; i < source.length; i += 1) {
        const char = source[i];
        if (quote) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === quote) quote = null;
            continue;
        }
        if (char === "'" || char === '"' || char === '`') { quote = char; continue; }
        if (char === '{') depth += 1;
        if (char === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error(`${name} is incomplete`);
}

function deferred() {
    let resolve;
    const promise = new Promise((res) => { resolve = res; });
    return { promise, resolve };
}

test('renderer keeps Refreshing state through awaited IPC and committed-data hydration', async () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'app', 'sidebar.js'), 'utf8');
    const refreshFunction = extractFunction(source, 'refreshVaultEpicPurchaseHistory');
    const ipc = deferred();
    const hydrate = deferred();
    const renders = [];
    const scroller = { scrollTop: 275 };
    const account = { accountId: 'account-a' };
    const sandbox = {
        console: { error() {} },
        performance: { now: () => 0 },
        Error,
        Promise,
        setTimeout: () => 1,
        clearTimeout() {},
        requestAnimationFrame: (callback) => callback(),
        document: {
            getElementById(id) {
                if (id === 'mainContentArea') return scroller;
                return null;
            },
        },
        window: {
            _renders: renders,
            _hydrate: hydrate,
            electronAPI: {
                platformSyncRefreshEpicPurchaseHistory: async () => ipc.promise,
            },
        },
    };
    vm.createContext(sandbox);
    vm.runInContext(`
        let __vaultSelectedEpicAccountId = 'account-a';
        let __vaultEpicSection = 'history';
        let __vaultEpicHistoryRefreshing = false;
        let __vaultEpicDataCache = { accounts: [${JSON.stringify(account)}] };
        function _vaultSelectedEpicAccount() { return ${JSON.stringify(account)}; }
        function _renderVaultEpicHistory(value) { window._renders.push({ value, refreshing: __vaultEpicHistoryRefreshing, section: __vaultEpicSection }); }
        async function hydrateEpicVaultConsole(force) { await window._hydrate.promise; return force; }
        let __vaultEpicHistoryNotice = null;
        let __vaultEpicHistorySuccessTimer = null;
        function _vaultClearEpicHistoryNotice() { __vaultEpicHistoryNotice = null; }
        function _vaultSetEpicHistoryNotice(value) { __vaultEpicHistoryNotice = value; }
        function _vaultEpicHistoryErrorNotice(value) { return value; }
        async function _vaultOpenEpicReauthPrompt() { return false; }
        function _vaultShowEpicAuthWaiting() {}
        function _vaultCloseEpicAuthModal() {}
        function _vaultHtml(value) { return String(value); }
        ${refreshFunction}
        window.runRefresh = refreshVaultEpicPurchaseHistory;
        window.isRefreshing = () => __vaultEpicHistoryRefreshing;
        window.currentSection = () => __vaultEpicSection;
    `, sandbox);

    const pending = sandbox.window.runRefresh('account-a');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(sandbox.window.isRefreshing(), true);
    assert.equal(renders.at(-1).refreshing, true);

    ipc.resolve({ status: 'success', accountId: 'account-a', fetchedAt: '2026-08-27T01:02:03.000Z' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(sandbox.window.isRefreshing(), true, 'must remain refreshing while committed data reloads');

    hydrate.resolve();
    const result = await pending;
    assert.equal(result.status, 'success');
    assert.equal(sandbox.window.isRefreshing(), false);
    assert.equal(sandbox.window.currentSection(), 'history');
    assert.equal(scroller.scrollTop, 275);
});


test('renderer performs silent probe before showing consent and opens one approved login', async () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'app', 'sidebar.js'), 'utf8');
    const refreshFunction = extractFunction(source, 'refreshVaultEpicPurchaseHistory');
    const calls = [];
    const account = { accountId: 'account-a', displayName: 'Account A' };
    const sandbox = {
        console: { error() {} }, performance: { now: () => 0 }, Error, Promise,
        requestAnimationFrame: (callback) => callback(),
        setTimeout: () => 1, clearTimeout() {},
        document: { getElementById(id) { return id === 'mainContentArea' ? { scrollTop: 0 } : null; } },
        window: { electronAPI: { platformSyncRefreshEpicPurchaseHistory: async (_id, options) => {
            calls.push(options.allowInteractiveLogin ? 'interactive' : 'silent');
            return options.allowInteractiveLogin
                ? { status: 'success', ordersCount: 1 }
                : { status: 'reauth_required', code: 'EPIC_REAUTH_REQUIRED' };
        } } },
    };
    vm.createContext(sandbox);
    vm.runInContext(`
        let __vaultSelectedEpicAccountId = 'account-a';
        let __vaultEpicSection = 'history';
        let __vaultEpicHistoryRefreshing = false;
        let __vaultEpicHistoryNotice = null;
        let __vaultEpicHistorySuccessTimer = null;
        let __vaultEpicDataCache = { accounts: [${JSON.stringify(account)}] };
        function _vaultSelectedEpicAccount() { return ${JSON.stringify(account)}; }
        function _renderVaultEpicHistory() {}
        function _vaultClearEpicHistoryNotice() { __vaultEpicHistoryNotice = null; }
        function _vaultSetEpicHistoryNotice(value) { __vaultEpicHistoryNotice = value; }
        function _vaultEpicHistoryErrorNotice(value) { return value; }
        async function _vaultOpenEpicReauthPrompt() { calls.push('modal'); return true; }
        function _vaultShowEpicAuthWaiting() { calls.push('waiting'); }
        function _vaultCloseEpicAuthModal() {}
        async function hydrateEpicVaultConsole() { calls.push('hydrate'); }
        ${refreshFunction}
        window.runRefresh = refreshVaultEpicPurchaseHistory;
    `, Object.assign(sandbox, { calls }));
    await sandbox.window.runRefresh('account-a');
    assert.deepEqual(calls.slice(0, 4), ['silent', 'modal', 'waiting', 'interactive']);
    assert.equal(calls.filter((item) => item === 'interactive').length, 1);
});

test('two rapid manual clicks issue one IPC refresh and produce no error notice', async () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'app', 'sidebar.js'), 'utf8');
    const refreshFunction = extractFunction(source, 'refreshVaultEpicPurchaseHistory');
    const ipc = deferred();
    let ipcCalls = 0;
    const notices = [];
    const sandbox = {
        console: { error() {} }, performance: { now: () => 0 }, Error, Promise,
        requestAnimationFrame: (callback) => callback(),
        setTimeout: () => 1, clearTimeout() {},
        document: { getElementById(id) { return id === 'mainContentArea' ? { scrollTop: 0 } : null; } },
        window: { electronAPI: {
            platformSyncRefreshEpicPurchaseHistory: async () => { ipcCalls += 1; return ipc.promise; },
            platformSyncConfirmEpicPurchaseHistoryHydrated: async () => {},
        } },
    };
    vm.createContext(sandbox);
    vm.runInContext(`
        let __vaultSelectedEpicAccountId = 'account-a';
        let __vaultEpicSection = 'history';
        let __vaultEpicHistoryRefreshing = false;
        let __vaultEpicHistoryOperationId = null;
        let __vaultEpicHistoryNotice = null;
        let __vaultEpicHistorySuccessTimer = null;
        function _vaultSelectedEpicAccount() { return { accountId: 'account-a', displayName: 'A' }; }
        function _renderVaultEpicHistory() {}
        function _vaultClearEpicHistoryNotice() { __vaultEpicHistoryNotice = null; }
        function _vaultSetEpicHistoryNotice(value) { __vaultEpicHistoryNotice = value; if (value?.kind === 'error') notices.push(value); }
        function _vaultEpicHistoryErrorNotice(value) { return value; }
        async function _vaultOpenEpicReauthPrompt() { return false; }
        function _vaultShowEpicAuthWaiting() {}
        function _vaultCloseEpicAuthModal() {}
        async function hydrateEpicVaultConsole() {}
        ${refreshFunction}
        globalThis.runRefresh = refreshVaultEpicPurchaseHistory;
    `, Object.assign(sandbox, { notices }));
    const first = sandbox.runRefresh('account-a');
    const second = sandbox.runRefresh('account-a');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(ipcCalls, 1);
    ipc.resolve({ status: 'success', ordersCount: 1 });
    await Promise.all([first, second]);
    assert.equal(notices.length, 0);
});

test('Not now is neutral and never starts interactive login', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'app', 'sidebar.js'), 'utf8');
    assert.match(source, /if \(!approved\) return \{ status: 'cancelled'/);
    assert.doesNotMatch(source.slice(source.indexOf('async function refreshVaultEpicPurchaseHistory'), source.indexOf('async function connectVaultEpicPurchaseHistory')), /insertAdjacentHTML/);
});

test('Epic history notices are rendered outside the virtual results host', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'app', 'sidebar.js'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'dashboard.css'), 'utf8');
    const toolbar = source.slice(source.indexOf('function _vaultHistoryToolbarHtml'), source.indexOf('function _vaultHistoryRowHtml'));
    const results = source.slice(source.indexOf('function _renderVaultEpicHistoryResults'), source.indexOf('function closeVaultDropdowns'));
    assert.match(toolbar, /vaultEpicHistoryNotice/);
    assert.match(results, /vaultEpicHistoryResults/);
    assert.doesNotMatch(results, /vaultEpicHistoryNotice/);
    assert.match(css, /\.vault-history-notice/);
});


test('session_verified event closes auth UI while History remains refreshing and stale events are ignored', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'app', 'sidebar.js'), 'utf8');
    const closeStart = source.indexOf('function _vaultCloseEpicAuthModal()');
    const closeEnd = source.indexOf('async function refreshVaultEpicPurchaseHistory', closeStart);
    const listenerStart = source.indexOf('if (window.electronAPI?.onEpicPurchaseHistoryRefreshState');
    const listenerEnd = source.indexOf('if (window.electronAPI?.onEpicPriceRefreshState', listenerStart);
    assert.ok(closeStart >= 0 && closeEnd > closeStart && listenerEnd > listenerStart);

    let listener;
    const modal = { active: true, classList: { remove(name) { if (name === 'active') modal.active = false; } } };
    const actions = { hidden: true };
    const waiting = { hidden: false };
    const notices = [];
    const sandbox = {
        document: {
            getElementById(id) {
                return { vaultEpicAuthModal: modal, vaultEpicAuthActions: actions, vaultEpicAuthWaiting: waiting }[id] || null;
            },
        },
        window: {
            notices,
            electronAPI: {
                onEpicPurchaseHistoryRefreshState(callback) { listener = callback; },
            },
        },
    };
    vm.createContext(sandbox);
    vm.runInContext(`
        let __vaultEpicHistoryOperationId = 'operation-current';
        let __vaultEpicHistoryRefreshing = true;
        let __vaultSelectedEpicAccountId = 'account-a';
        function _vaultSelectedEpicAccount() { return null; }
        function _renderVaultEpicHistory() {}
        function _vaultSetEpicHistoryNotice(notice) { window.notices.push(notice); }
        ${source.slice(closeStart, closeEnd)}
        ${source.slice(listenerStart, listenerEnd)}
        window.isRefreshing = () => __vaultEpicHistoryRefreshing;
    `, Object.assign(sandbox, { notices }));

    listener({ accountId: 'account-a', operationId: 'operation-old', phase: 'session_verified' });
    assert.equal(modal.active, true, 'stale operation must not close current auth UI');
    listener({ accountId: 'account-a', operationId: 'operation-current', phase: 'session_verified' });
    assert.equal(modal.active, false);
    assert.equal(waiting.hidden, true);
    assert.equal(actions.hidden, false);
    assert.equal(sandbox.window.isRefreshing(), true, 'History stays active in the background');
    assert.match(notices.at(-1).body, /keep using Baddel/);
});

test('renderer source scopes History state through preload and acknowledges one committed hydration', () => {
    const sidebar = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'app', 'sidebar.js'), 'utf8');
    const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
    const main = fs.readFileSync(path.join(__dirname, '..', 'platformSync.js'), 'utf8');
    assert.match(preload, /onEpicPurchaseHistoryRefreshState/);
    assert.match(preload, /platformSyncConfirmEpicPurchaseHistoryHydrated/);
    assert.match(main, /epic-purchase-history-refresh-state/);
    assert.match(main, /renderer_hydration_completed/);
    const refresh = sidebar.slice(
        sidebar.indexOf('async function refreshVaultEpicPurchaseHistory'),
        sidebar.indexOf('async function connectVaultEpicPurchaseHistory')
    );
    assert.match(refresh, /operationId/);
    assert.match(refresh, /platformSyncConfirmEpicPurchaseHistoryHydrated/);
    assert.equal((refresh.match(/hydrateEpicVaultConsole\(true/g) || []).length, 1);
});

test('renderer distinguishes connection, service, unexpected-response, auth, and account errors', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'app', 'sidebar.js'), 'utf8');
    const start = source.indexOf('function _vaultEpicHistoryErrorNotice');
    const end = source.indexOf('function _vaultOpenEpicReauthPrompt', start);
    const mapping = source.slice(start, end);
    assert.match(mapping, /EPIC_HISTORY_NETWORK_ERROR[\s\S]*Couldn't connect to Epic/);
    assert.match(mapping, /EPIC_HISTORY_REQUEST_TIMEOUT[\s\S]*took too long/);
    assert.match(mapping, /EPIC_HISTORY_SERVICE_UNAVAILABLE[\s\S]*temporarily unavailable/);
    assert.match(mapping, /EPIC_IDENTITY_ENDPOINT_UNAVAILABLE[\s\S]*unexpected response/);
    assert.match(mapping, /EPIC_REAUTH_REQUIRED[\s\S]*sign-in required/i);
    assert.match(mapping, /EPIC_ACCOUNT_MISMATCH[\s\S]*Different Epic account detected/);
    assert.doesNotMatch(mapping, /title:\s*["']Couldn't reach Epic["']/);
});

test('an actionable History error notice suppresses the duplicate failed empty state', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'app', 'sidebar.js'), 'utf8');
    const start = source.indexOf('function _vaultEpicHistoryStatus');
    const end = source.indexOf('function _vaultEpicEmptyStateHtml', start);
    const status = source.slice(start, end);
    assert.match(status, /activeNotice\?\.kind === 'error'/);
    assert.match(status, /No history to display/);
});
