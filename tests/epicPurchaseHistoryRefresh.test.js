'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
    EPIC_HISTORY_ERROR_CODES,
    EpicPurchaseHistoryRefreshService,
    classifyEpicWebResponse,
    epicHistoryError,
} = require('../src/features/sync/application/services/EpicPurchaseHistoryRefreshService');

const ROOT = path.join(__dirname, '..');

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function makeHarness(overrides = {}) {
    const account = { id: 'account-a', displayName: 'Account A' };
    const previous = {
        accountId: account.id,
        purchaseHistoryItems: [{ orderId: 'old' }],
        netSpentMinor: 4200,
        purchaseHistoryFetchedAt: '2025-01-01T00:00:00.000Z',
        purchaseHistory: { status: 'complete', fetchedAt: '2025-01-01T00:00:00.000Z' },
        permissions: { purchaseHistory: true },
        games: [{ id: 'library-game' }],
    };
    const processed = {
        ordersCount: 1,
        purchaseHistoryItems: [{ orderId: 'new' }],
        netSpentMinor: 9900,
        games: [{ title: 'New Purchase' }],
    };
    const state = { loginCalls: 0, commits: [], identities: 0, fetches: 0, flushes: 0, clears: 0, closes: 0, order: [] };
    const deps = {
        getAccount: async (id) => id === account.id ? account : null,
        getSession: async () => ({ partition: 'account-a' }),
        openLogin: async () => { state.loginCalls += 1; state.order.push('login'); return { userAgent: 'test', waitForSessionReady: async () => { state.order.push('settled'); }, close() { state.closes += 1; state.order.push('close'); } }; },
        clearSession: async () => { state.clears += 1; state.order.push('clear'); },
        flushSession: async () => { state.flushes += 1; state.order.push('flush'); },
        verifyIdentity: async () => { state.identities += 1; return { accountId: account.id }; },
        fetchHistory: async () => { state.fetches += 1; return processed; },
        readVaultAccount: async () => previous,
        processHistory: async (history) => history,
        buildVaultAccount: async ({ account: selected, previous: old, processed: fresh, fetchedAt }) => ({
            ...old,
            ...fresh,
            accountId: selected.id,
            purchaseHistoryFetchedAt: fetchedAt,
            purchaseHistory: { status: 'complete', fetchedAt },
        }),
        commitVaultAccount: async (value) => { state.commits.push(value); },
        now: () => '2026-08-27T01:02:03.000Z',
        ...overrides,
    };
    return { service: new EpicPurchaseHistoryRefreshService(deps), account, previous, processed, state };
}

test('manual refresh fetches previously imported history again and commits derived fields', async () => {
    const { service, state } = makeHarness();
    const result = await service.refresh('account-a');
    assert.equal(state.fetches, 1);
    assert.equal(state.loginCalls, 0);
    assert.equal(state.commits.length, 1);
    assert.deepEqual(state.commits[0].purchaseHistoryItems, [{ orderId: 'new' }]);
    assert.equal(state.commits[0].netSpentMinor, 9900);
    assert.equal(result.fetchedAt, '2026-08-27T01:02:03.000Z');
});

test('valid cached account session refreshes silently', async () => {
    const { service, state } = makeHarness();
    await service.refresh('account-a');
    assert.equal(state.identities, 1);
    assert.equal(state.loginCalls, 0);
});

test('approved expired session opens one login and resumes the same refresh', async () => {
    let attempts = 0;
    const { service, state } = makeHarness({
        verifyIdentity: async () => {
            attempts += 1;
            if (attempts === 1) throw epicHistoryError(EPIC_HISTORY_ERROR_CODES.REAUTH_REQUIRED, 'expired');
            return { accountId: 'account-a' };
        },
    });
    const result = await service.refresh('account-a', { allowInteractiveLogin: true });
    assert.equal(result.status, 'success');
    assert.equal(attempts, 2);
    assert.equal(state.loginCalls, 1);
    assert.equal(state.fetches, 1);
});

test('auth failure during order fetch also signs in once and retries', async () => {
    let attempts = 0;
    const { service, state, processed } = makeHarness({
        fetchHistory: async () => {
            attempts += 1;
            if (attempts === 1) throw epicHistoryError(EPIC_HISTORY_ERROR_CODES.REAUTH_REQUIRED, 'expired');
            return processed;
        },
    });
    await service.refresh('account-a', { allowInteractiveLogin: true });
    assert.equal(state.loginCalls, 1);
    assert.equal(attempts, 2);
});

test('login cancellation preserves the last-known-good ledger and timestamp', async () => {
    const { service, state } = makeHarness({
        verifyIdentity: async () => { throw epicHistoryError(EPIC_HISTORY_ERROR_CODES.REAUTH_REQUIRED, 'expired'); },
        openLogin: async () => { state.loginCalls += 1; throw epicHistoryError(EPIC_HISTORY_ERROR_CODES.LOGIN_CANCELLED, 'cancelled'); },
    });
    await assert.rejects(service.refresh('account-a', { allowInteractiveLogin: true }), { code: EPIC_HISTORY_ERROR_CODES.LOGIN_CANCELLED });
    assert.equal(state.loginCalls, 1);
    assert.deepEqual(state.commits, []);
});

test('invalid or partial history performs no write', async () => {
    const { service, state } = makeHarness({ fetchHistory: async () => ({ ordersCount: 20 }) });
    await assert.rejects(service.refresh('account-a'), { code: EPIC_HISTORY_ERROR_CODES.INVALID_RESPONSE });
    assert.deepEqual(state.commits, []);
});

test('valid zero-order history commits an empty ledger and advances fetchedAt', async () => {
    const { service, state } = makeHarness({
        fetchHistory: async () => ({ ordersCount: 0, purchaseHistoryItems: [], games: [], netSpentMinor: 0 }),
    });
    const result = await service.refresh('account-a');
    assert.equal(result.ordersCount, 0);
    assert.equal(result.purchaseHistoryItemsCount, 0);
    assert.deepEqual(state.commits[0].purchaseHistoryItems, []);
    assert.equal(state.commits[0].purchaseHistoryFetchedAt, result.fetchedAt);
});

test('authenticated account mismatch fails without corrective login or write', async () => {
    const { service, state } = makeHarness({ verifyIdentity: async () => ({ accountId: 'account-b' }) });
    await assert.rejects(service.refresh('account-a', { allowInteractiveLogin: true }), { code: EPIC_HISTORY_ERROR_CODES.ACCOUNT_MISMATCH });
    assert.equal(state.loginCalls, 0);
    assert.deepEqual(state.commits, []);
});

test('selected account only is committed in a multi-account vault', async () => {
    const vault = new Map([
        ['account-a', { accountId: 'account-a', purchaseHistoryItems: [{ orderId: 'old-a' }] }],
        ['account-b', { accountId: 'account-b', purchaseHistoryItems: [{ orderId: 'old-b' }] }],
    ]);
    const { service } = makeHarness({
        readVaultAccount: async (id) => vault.get(id),
        commitVaultAccount: async (value) => vault.set(value.accountId, value),
    });
    await service.refresh('account-a');
    assert.deepEqual(vault.get('account-b').purchaseHistoryItems, [{ orderId: 'old-b' }]);
    assert.deepEqual(vault.get('account-a').purchaseHistoryItems, [{ orderId: 'new' }]);
});

test('IPC-facing refresh promise settles only after commit completes', async () => {
    const gate = deferred();
    const { service } = makeHarness({ commitVaultAccount: async () => gate.promise });
    let settled = false;
    const pending = service.refresh('account-a').then(() => { settled = true; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false);
    gate.resolve();
    await pending;
    assert.equal(settled, true);
});

test('per-account in-flight guard joins duplicate callers without duplicate work', async () => {
    const gate = deferred();
    const { service, state, processed } = makeHarness({
        fetchHistory: async () => { state.fetches += 1; await gate.promise; return processed; },
    });
    const first = service.refresh('account-a');
    await new Promise((resolve) => setImmediate(resolve));
    const second = service.refresh('account-a');
    assert.equal(state.fetches, 1);
    gate.resolve();
    const [owner, joined] = await Promise.all([first, second]);
    assert.equal(owner.status, 'success');
    assert.equal(joined.status, 'success');
    assert.equal(joined.joined, true);
    assert.equal(state.commits.length, 1);
});

test('commit failure does not publish a successful timestamp', async () => {
    const { service, previous } = makeHarness({ commitVaultAccount: async () => { throw new Error('disk full'); } });
    await assert.rejects(service.refresh('account-a'), { code: EPIC_HISTORY_ERROR_CODES.COMMIT_FAILED });
    assert.equal(previous.purchaseHistoryFetchedAt, '2025-01-01T00:00:00.000Z');
});

test('main, preload, renderer and unlink use the dedicated awaited account-scoped flow', () => {
    const main = fs.readFileSync(path.join(ROOT, 'platformSync.js'), 'utf8');
    const preload = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
    const sidebar = fs.readFileSync(path.join(ROOT, 'src/js/app/sidebar.js'), 'utf8');
    assert.match(main, /platform-sync:refresh-epic-purchase-history/);
    assert.match(main, /return await refreshEpicPurchaseHistory\(accountId, parentWindow, \{/);
    assert.match(main, /persist:baddel-epic-history-/);
    assert.match(main, /await clearEpicHistorySession\(accountId\)/);
    assert.match(preload, /platformSyncRefreshEpicPurchaseHistory/);
    const refreshStart = sidebar.indexOf('async function refreshVaultEpicPurchaseHistory');
    const refreshEnd = sidebar.indexOf('async function connectVaultEpicPurchaseHistory', refreshStart);
    const refresh = sidebar.slice(refreshStart, refreshEnd);
    assert.match(refresh, /allowInteractiveLogin: false/);
    assert.match(refresh, /allowInteractiveLogin: true/);
    assert.match(refresh, /await window\.electronAPI\?\.platformSyncRefreshEpicPurchaseHistory/);
    assert.doesNotMatch(refresh, /platformSyncSync|epicSyncOptions|platformSyncLink/);
    assert.match(refresh, /finally/);
    assert.match(refresh, /previousScrollTop/);
    assert.match(sidebar.slice(refreshEnd, refreshEnd + 220), /refreshVaultEpicPurchaseHistory/);
});

test('ordinary Epic sync still does not open an interactive history login', () => {
    const main = fs.readFileSync(path.join(ROOT, 'platformSync.js'), 'utf8');
    const start = main.indexOf('async function syncSingleEpicAccount');
    const end = main.indexOf('async function runEpicProgressivePricesPhase', start);
    const normalSync = main.slice(start, end);
    assert.doesNotMatch(normalSync, /openEpicLoginWindow|getEpicHistorySession|refreshEpicPurchaseHistory/);
    assert.match(normalSync, /if \(!runtime\.libraryOnly\)/);
    assert.doesNotMatch(normalSync, /initialEpicAuthResult|fetchEpicOrderHistoryWithSession\(/);
});


test('benign redirect followed by JSON remains authenticated data', () => {
    const result = classifyEpicWebResponse({
        status: 200,
        redirected: true,
        headers: { get: () => 'application/json' },
    }, '{"accountId":"account-a"}');
    assert.equal(result.classification, 'json');
    assert.equal(result.authenticationFailure, false);
});

test('401 and 403 are strong authentication failures', () => {
    for (const status of [401, 403]) {
        const result = classifyEpicWebResponse({ status, headers: { get: () => 'application/json' } }, '{}');
        assert.equal(result.authenticationFailure, true);
        assert.equal(result.explicitAuthStatus, true);
    }
});

test('confirmed Epic login HTML is an authentication failure while generic HTML is not', () => {
    const login = classifyEpicWebResponse({ status: 200, headers: { get: () => 'text/html' } }, '<html><title>Epic Games Sign In</title><a href="/id/login">Login</a></html>');
    const generic = classifyEpicWebResponse({ status: 200, headers: { get: () => 'text/html' } }, '<html><title>Maintenance</title></html>');
    assert.equal(login.authenticationFailure, true);
    assert.equal(login.classification, 'login_html');
    assert.equal(generic.authenticationFailure, false);
    assert.equal(generic.classification, 'html');
});

test('expired silent session returns reauth_required without opening login', async () => {
    const { service, state } = makeHarness({
        verifyIdentity: async () => { throw epicHistoryError(EPIC_HISTORY_ERROR_CODES.REAUTH_REQUIRED, 'expired'); },
    });
    const result = await service.refresh('account-a', { allowInteractiveLogin: false });
    assert.equal(result.status, 'reauth_required');
    assert.equal(result.code, EPIC_HISTORY_ERROR_CODES.REAUTH_REQUIRED);
    assert.equal(state.loginCalls, 0);
    assert.deepEqual(state.commits, []);
});

test('identity endpoint outage is an error without login or clearing the persistent session', async () => {
    const { service, state } = makeHarness({
        verifyIdentity: async () => {
            throw epicHistoryError(EPIC_HISTORY_ERROR_CODES.IDENTITY_ENDPOINT_UNAVAILABLE, 'Epic identity endpoint unavailable');
        },
    });
    await assert.rejects(service.refresh('account-a', { allowInteractiveLogin: true }), {
        code: EPIC_HISTORY_ERROR_CODES.IDENTITY_ENDPOINT_UNAVAILABLE,
    });
    assert.equal(state.loginCalls, 0);
    assert.equal(state.clears, 0);
    assert.equal(state.fetches, 0);
    assert.deepEqual(state.commits, []);
});

test('non-JSON primary identity uses exact identity proven by the same persistent session', async () => {
    let resolverCalls = 0;
    const { service, state } = makeHarness({
        verifyIdentity: async () => {
            throw epicHistoryError(EPIC_HISTORY_ERROR_CODES.IDENTITY_ENDPOINT_UNAVAILABLE, 'primary endpoint returned HTML');
        },
        resolvePersistentSessionIdentity: async (session, account, _userAgent, options) => {
            resolverCalls += 1;
            assert.equal(session.partition, 'account-a');
            assert.equal(account.id, 'account-a');
            options.onDiagnostic?.({
                stage: options.stage,
                originPath: 'https://www.epicgames.com/id/api/redirect',
                classification: 'json',
                verificationSource: 'persistent_session_authorization',
                code: 'OK',
            });
            return { accountId: 'account-a' };
        },
    });
    const result = await service.refresh('account-a', { allowInteractiveLogin: false });
    assert.equal(result.status, 'success');
    assert.equal(resolverCalls, 1);
    assert.equal(state.loginCalls, 0);
    assert.equal(state.clears, 0);
    assert.equal(state.fetches, 1);
    assert.equal(state.commits.length, 1);
    assert.ok(result.diagnostics.some((entry) => entry.verificationSource === 'persistent_session_authorization'));
});

test('persistent-session authorization mismatch cannot fetch or overwrite History', async () => {
    const { service, state } = makeHarness({
        verifyIdentity: async () => {
            throw epicHistoryError(EPIC_HISTORY_ERROR_CODES.IDENTITY_ENDPOINT_UNAVAILABLE, 'primary endpoint returned HTML');
        },
        resolvePersistentSessionIdentity: async () => ({ accountId: 'account-b' }),
    });
    await assert.rejects(service.refresh('account-a', { allowInteractiveLogin: true }), {
        code: EPIC_HISTORY_ERROR_CODES.ACCOUNT_MISMATCH,
    });
    assert.equal(state.loginCalls, 0);
    assert.equal(state.fetches, 0);
    assert.deepEqual(state.commits, []);
});

test('generic fetch failure does not prompt, clear the session, or overwrite History', async () => {
    const { service, state, previous } = makeHarness({
        fetchHistory: async () => {
            throw epicHistoryError(EPIC_HISTORY_ERROR_CODES.FETCH_FAILED, 'Epic returned 503');
        },
    });
    await assert.rejects(service.refresh('account-a', { allowInteractiveLogin: true }), {
        code: EPIC_HISTORY_ERROR_CODES.FETCH_FAILED,
    });
    assert.equal(state.loginCalls, 0);
    assert.equal(state.clears, 0);
    assert.deepEqual(state.commits, []);
    assert.deepEqual(previous.purchaseHistoryItems, [{ orderId: 'old' }]);
});

test('cached account mismatch fails without opening login or fetching History', async () => {
    const { service, state } = makeHarness({
        verifyIdentity: async () => ({ accountId: 'account-b' }),
    });
    await assert.rejects(service.refresh('account-a', { allowInteractiveLogin: true }), {
        code: EPIC_HISTORY_ERROR_CODES.ACCOUNT_MISMATCH,
    });
    assert.equal(state.loginCalls, 0);
    assert.equal(state.fetches, 0);
    assert.deepEqual(state.commits, []);
});

test('post-login persistent session is verified and login closes before deferred History finishes', async () => {
    const history = deferred();
    const events = [];
    let identityAttempts = 0;
    let fetchStarted = false;
    const { service, state, processed } = makeHarness({
        readinessDelays: [0, 0],
        verifyIdentity: async () => {
            identityAttempts += 1;
            if (identityAttempts === 1) throw epicHistoryError(EPIC_HISTORY_ERROR_CODES.REAUTH_REQUIRED, 'expired');
            return { accountId: 'account-a' };
        },
        fetchHistory: async () => {
            fetchStarted = true;
            return history.promise;
        },
    });
    const pending = service.refresh('account-a', {
        allowInteractiveLogin: true,
        operationId: 'history-operation-a',
        accountHash: 'account-hash',
        partitionHash: 'partition-hash',
        inspectSession: async () => ({ cookieCount: 4 }),
        onState: (event) => events.push(event),
    });
    for (let index = 0; index < 20 && !fetchStarted; index += 1) {
        await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(fetchStarted, true);
    assert.equal(state.closes, 1, 'login window must close before History resolves');
    assert.ok(events.some((event) => event.phase === 'session_verified'));
    assert.ok(events.some((event) => event.phase === 'fetching_history'));
    assert.ok(!events.some((event) => event.phase === 'success'));
    history.resolve(processed);
    const result = await pending;
    assert.equal(result.status, 'success');
    assert.equal(state.commits.length, 1);
    assert.equal(state.closes, 1);
    assert.ok(events.some((event) => event.phase === 'success'));
    const diagnostics = JSON.stringify(result.diagnostics);
    assert.match(diagnostics, /persistent_session_verified/);
    assert.match(diagnostics, /"cookieCount":4/);
});

test('explicit 401 after login is retried while persistent cookies settle', async () => {
    let identityAttempts = 0;
    const { service, state } = makeHarness({
        readinessDelays: [0, 0, 0],
        verifyIdentity: async () => {
            identityAttempts += 1;
            if (identityAttempts < 3) {
                throw epicHistoryError(EPIC_HISTORY_ERROR_CODES.REAUTH_REQUIRED, 'settling', null, { explicitAuthStatus: true });
            }
            return { accountId: 'account-a' };
        },
    });
    const result = await service.refresh('account-a', { allowInteractiveLogin: true });
    assert.equal(result.status, 'success');
    assert.equal(identityAttempts, 3);
    assert.equal(state.loginCalls, 1);
    assert.equal(state.commits.length, 1);
});

test('persistent session is silently reused by a recreated service after login', async () => {
    let authenticated = false;
    let loginCalls = 0;
    const overrides = {
        readinessDelays: [0],
        verifyIdentity: async () => {
            if (!authenticated) throw epicHistoryError(EPIC_HISTORY_ERROR_CODES.REAUTH_REQUIRED, 'expired');
            return { accountId: 'account-a' };
        },
        openLogin: async () => {
            loginCalls += 1;
            authenticated = true;
            return { userAgent: 'test', waitForSessionReady: async () => {}, close() {} };
        },
    };
    const first = makeHarness(overrides);
    assert.equal((await first.service.refresh('account-a', { allowInteractiveLogin: true })).status, 'success');
    const recreated = makeHarness(overrides);
    assert.equal((await recreated.service.refresh('account-a', { allowInteractiveLogin: false })).status, 'success');
    assert.equal(loginCalls, 1);
    assert.equal(recreated.state.clears, 0);
});

test('diagnostics keep operation metadata but discard credentials and response bodies', async () => {
    const { service } = makeHarness();
    const result = await service.refresh('account-a', {
        operationId: 'history-operation-safe',
        accountHash: 'hash-a',
        partitionHash: 'partition-a',
        onDiagnostic: () => {},
        secretToken: 'TOKEN_SECRET',
    });
    const serialized = JSON.stringify(result.diagnostics);
    assert.match(serialized, /history-operation-safe/);
    assert.match(serialized, /partition-a/);
    assert.doesNotMatch(serialized, /TOKEN_SECRET|authorizationCode|accessToken|refreshToken|cookieValue|responseBody/i);
});

test('two selected accounts cannot share an authenticated identity', async () => {
    let commits = 0;
    const service = new EpicPurchaseHistoryRefreshService({
        getAccount: async (id) => ({ id, displayName: id }),
        getSession: async (id) => ({ partition: id }),
        verifyIdentity: async (session) => ({ accountId: session.partition === 'account-a' ? 'account-a' : 'account-a' }),
        fetchHistory: async () => ({ purchaseHistoryItems: [], ordersCount: 0 }),
        readVaultAccount: async () => null,
        processHistory: async (value) => value,
        buildVaultAccount: async ({ account }) => ({ accountId: account.id }),
        commitVaultAccount: async () => { commits += 1; },
    });
    await assert.rejects(service.refresh('account-b'), { code: EPIC_HISTORY_ERROR_CODES.ACCOUNT_MISMATCH });
    assert.equal(commits, 0);
});
