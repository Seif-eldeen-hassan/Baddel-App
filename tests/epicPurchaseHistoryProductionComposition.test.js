'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    createEpicPurchaseHistoryRefreshService,
} = require('../src/features/sync/infrastructure/composition/createEpicPurchaseHistoryRefreshService');
const {
    EPIC_HISTORY_ERROR_CODES,
    classifyEpicWebResponse,
    epicHistoryError,
} = require('../src/features/sync/application/services/EpicPurchaseHistoryRefreshService');

const PLATFORM_SYNC_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'platformSync.js'), 'utf8');

function functionBody(source, name) {
    const start = source.indexOf('async function ' + name);
    assert.notEqual(start, -1, name + ' not found');
    const paramsStart = source.indexOf('(', start);
    let paramsDepth = 0;
    let paramsEnd = -1;
    for (let index = paramsStart; index < source.length; index += 1) {
        if (source[index] === '(') paramsDepth += 1;
        else if (source[index] === ')') {
            paramsDepth -= 1;
            if (paramsDepth === 0) {
                paramsEnd = index;
                break;
            }
        }
    }
    const brace = source.indexOf('{', paramsEnd);
    let depth = 0;
    for (let index = brace; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        else if (source[index] === '}') {
            depth -= 1;
            if (depth === 0) return source.slice(brace, index + 1);
        }
    }
    throw new Error(name + ' body not closed');
}

function productionHarness(overrides = {}) {
    const state = { fallbackCalls: 0, historyFetches: 0, loginWindows: 0, commits: 0, clears: 0 };
    let loginCompleted = false;
    const account = { id: 'account-a', displayName: 'Account A' };
    const genericHtml = classifyEpicWebResponse({
        status: 200,
        headers: { get: () => 'text/html; charset=utf-8' },
    }, '<html><body>Epic maintenance response</body></html>');
    assert.equal(genericHtml.classification, 'html');
    assert.equal(genericHtml.authenticationFailure, false);

    const service = createEpicPurchaseHistoryRefreshService({
        getAccount: async () => account,
        getSession: async () => ({ cookies: { flushStore: async () => {} } }),
        clearSession: async () => { state.clears += 1; },
        flushSession: async () => {},
        openLogin: async () => {
            state.loginWindows += 1;
            loginCompleted = true;
            return { waitForSessionReady: async () => {}, close() {} };
        },
        verifyEpicWebIdentity: async () => {
            if (loginCompleted) return { accountId: account.id };
            throw epicHistoryError(
                EPIC_HISTORY_ERROR_CODES.IDENTITY_ENDPOINT_UNAVAILABLE,
                'Primary identity endpoint returned generic HTML.'
            );
        },
        resolveEpicPersistentSessionIdentity: async (...args) => {
            state.fallbackCalls += 1;
            return (overrides.resolveEpicPersistentSessionIdentity || (async () => ({ accountId: account.id })))(...args);
        },
        fetchEpicOrderHistoryWithSession: async () => {
            state.historyFetches += 1;
            return { purchaseHistoryItems: [{ orderId: 'order-1' }], ordersCount: 1, pagesFetched: 1 };
        },
        processHistory: async (history) => history,
        readVaultAccount: async () => ({ accountId: account.id, purchaseHistoryItems: [] }),
        buildVaultAccount: async ({ fetchedAt }) => ({ accountId: account.id, purchaseHistoryFetchedAt: fetchedAt }),
        commitVaultAccount: async (value) => { state.commits += 1; return value; },
        readinessDelays: [0],
    });
    return { service, state };
}

test('production composition requires the persistent-session identity fallback', () => {
    assert.throws(() => createEpicPurchaseHistoryRefreshService({}), {
        name: 'TypeError',
        message: /requires resolveEpicPersistentSessionIdentity/,
    });
});

test('successful Legendary auth trusts its user.json identity without a second status network call', () => {
    const body = functionBody(PLATFORM_SYNC_SOURCE, 'resolveEpicAuthorizationIdentityForHistory');
    assert.match(body, /readEpicLegendaryUser\(configPath\)/);
    assert.match(body, /account_id:\s*legendaryUser\.account_id/);
    assert.doesNotMatch(body, /runLegendary\(\['status',\s*'--json'\]/);
});

test('production composition falls back from generic identity HTML and commits History once without login', async () => {
    const { service, state } = productionHarness();
    const result = await service.refresh('account-a', { allowInteractiveLogin: false });

    assert.equal(result.status, 'success');
    assert.equal(state.fallbackCalls, 1);
    assert.equal(state.historyFetches, 1);
    assert.equal(state.loginWindows, 0);
    assert.equal(state.commits, 1);
    assert.equal(state.clears, 0);
});

test('production composition uses a successful primary identity without invoking fallback', async () => {
    const { service, state } = productionHarness();
    service.verifyIdentity = async () => ({ accountId: 'account-a' });
    const result = await service.refresh('account-a', { allowInteractiveLogin: false });
    assert.equal(result.status, 'success');
    assert.equal(state.fallbackCalls, 0);
    assert.equal(state.historyFetches, 1);
    assert.equal(state.loginWindows, 0);
    assert.equal(state.commits, 1);
});

test('expired production session returns reauth silently and opens exactly one approved login window', async () => {
    const loginRedirect = classifyEpicWebResponse({
        status: 200,
        redirected: true,
        url: 'https://www.epicgames.com/id/login?redirectUrl=%2Fid%2Fapi%2Fredirect',
        headers: { get: () => 'text/html' },
    }, '<html><body>Redirecting</body></html>');
    assert.equal(loginRedirect.authenticationFailure, true);

    const { service, state } = productionHarness({
        resolveEpicPersistentSessionIdentity: async () => {
            throw epicHistoryError(EPIC_HISTORY_ERROR_CODES.REAUTH_REQUIRED, 'Epic login redirect confirmed.');
        },
    });
    const silent = await service.refresh('account-a', { allowInteractiveLogin: false });
    assert.equal(silent.status, 'reauth_required');
    assert.equal(silent.code, EPIC_HISTORY_ERROR_CODES.REAUTH_REQUIRED);
    assert.equal(state.loginWindows, 0);
    assert.equal(state.historyFetches, 0);
    assert.equal(state.commits, 0);

    // This second call represents the renderer's explicit approval action.
    const approved = await service.refresh('account-a', { allowInteractiveLogin: true });
    assert.equal(approved.status, 'success');
    assert.equal(state.loginWindows, 1);
    assert.equal(state.historyFetches, 1);
    assert.equal(state.commits, 1);
});

test('production fallback account mismatch blocks all History reads and Vault writes', async () => {
    const { service, state } = productionHarness({
        resolveEpicPersistentSessionIdentity: async () => ({ accountId: 'account-b' }),
    });
    await assert.rejects(service.refresh('account-a', { allowInteractiveLogin: true }), {
        code: EPIC_HISTORY_ERROR_CODES.ACCOUNT_MISMATCH,
    });
    assert.equal(state.loginWindows, 0);
    assert.equal(state.historyFetches, 0);
    assert.equal(state.commits, 0);
    assert.equal(state.clears, 0);
});
