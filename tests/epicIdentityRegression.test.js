'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
    EpicHistorySessionBootstrapService,
    attemptOptionalEpicHistorySessionBootstrap,
    isEpicCookie,
} = require('../src/features/sync/application/services/EpicHistorySessionBootstrapService');
const {
    EPIC_HISTORY_ERROR_CODES,
    EpicPurchaseHistoryRefreshService,
    classifyEpicWebResponse,
    epicHistoryError,
} = require('../src/features/sync/application/services/EpicPurchaseHistoryRefreshService');

function cookieKey(cookie) {
    return `${String(cookie.domain || '').replace(/^\./, '')}|${cookie.path || '/'}|${cookie.name}`;
}

function makeSession(seed = []) {
    const values = new Map(seed.map((cookie) => [cookieKey(cookie), { ...cookie }]));
    return {
        cookies: {
            async get() { return [...values.values()].map((cookie) => ({ ...cookie })); },
            async set(details) {
                const url = new URL(details.url);
                const cookie = {
                    ...details,
                    domain: details.domain || url.hostname,
                    hostOnly: !details.domain,
                    path: details.path || '/',
                };
                values.set(cookieKey(cookie), cookie);
            },
            async remove(url, name) {
                const host = new URL(url).hostname;
                for (const [key, cookie] of values) {
                    if (cookie.name === name && String(cookie.domain || '').replace(/^\./, '') === host) values.delete(key);
                }
            },
            async flushStore() {},
        },
    };
}

const epicCookie = (value) => ({
    name: 'EPIC_SESSION', value, domain: '.epicgames.com', hostOnly: false,
    path: '/', secure: true, httpOnly: true, sameSite: 'lax', expirationDate: 1999999999,
});

const proof = (accountId = 'account-a') => ({
    accountId, source: 'legendary_authorization_code', authorizationCodeBound: true,
});

for (const [name, body] of [
    ['generic HTML', '<html><body>maintenance</body></html>'],
    ['empty response', ''],
]) {
    test(`${name} is indeterminate, keeps handed-off cookies, and cannot fail core link`, async () => {
        const classification = classifyEpicWebResponse({ status: 200, headers: { get: () => 'text/html' } }, body);
        assert.equal(classification.authenticationFailure, false);
        const source = makeSession([epicCookie('new')]);
        const target = makeSession([epicCookie('old')]);
        const diagnostics = [];
        const service = new EpicHistorySessionBootstrapService({
            getTargetSession: async () => target,
            verifyIdentity: async () => {
                throw epicHistoryError(EPIC_HISTORY_ERROR_CODES.IDENTITY_ENDPOINT_UNAVAILABLE, 'identity endpoint unavailable');
            },
            onDiagnostic: (event) => diagnostics.push(event),
        });
        const events = ['core_account_saved'];
        const result = await attemptOptionalEpicHistorySessionBootstrap({
            bootstrap: service.bootstrap.bind(service),
            accountId: 'account-a', authResult: { epicSession: source },
            context: { authoritativeIdentity: proof() },
        });
        events.push('optional_bootstrap_finished', 'library_sync_started', 'games_committed');
        assert.equal(result.status, 'identity_indeterminate');
        assert.equal(result.verificationSource, 'legendary_authorization_code');
        assert.equal((await target.cookies.get({})).filter(isEpicCookie)[0].value, 'new');
        assert.deepEqual(events, ['core_account_saved', 'optional_bootstrap_finished', 'library_sync_started', 'games_committed']);
        assert.doesNotMatch(JSON.stringify(diagnostics), /new|EPIC_SESSION|authorizationCode|token/i);
    });
}

for (const [name, code] of [
    ['HTTP 401', EPIC_HISTORY_ERROR_CODES.REAUTH_REQUIRED],
    ['confirmed login HTML', EPIC_HISTORY_ERROR_CODES.REAUTH_REQUIRED],
]) {
    test(`${name} rolls back History cookies but optional policy lets games continue`, async () => {
        const source = makeSession([epicCookie('new')]);
        const target = makeSession([epicCookie('old')]);
        const service = new EpicHistorySessionBootstrapService({
            getTargetSession: async () => target,
            verifyIdentity: async () => { throw epicHistoryError(code, 'explicit authentication failure'); },
        });
        const result = await attemptOptionalEpicHistorySessionBootstrap({
            bootstrap: service.bootstrap.bind(service), accountId: 'account-a',
            authResult: { epicSession: source }, context: { authoritativeIdentity: proof() },
        });
        assert.equal(result.status, 'waiting_for_auth');
        assert.equal((await target.cookies.get({}))[0].value, 'old');
    });
}

test('matching JSON verifies the web identity and keeps target cookies', async () => {
    const target = makeSession();
    const service = new EpicHistorySessionBootstrapService({
        getTargetSession: async () => target,
        verifyIdentity: async () => ({ accountId: 'account-a' }),
    });
    const result = await service.bootstrap('account-a', { epicSession: makeSession([epicCookie('new')]) }, {
        authoritativeIdentity: proof(),
    });
    assert.equal(result.status, 'verified');
    assert.equal(result.verificationSource, 'epic_web_identity');
    assert.equal((await target.cookies.get({}))[0].value, 'new');
});

test('mismatching JSON rolls back only the target partition and remains optional to core sync', async () => {
    const accountA = makeSession([epicCookie('a-old')]);
    const accountB = makeSession([epicCookie('b-untouched')]);
    let historyFetches = 0;
    let vaultWrites = 0;
    const service = new EpicHistorySessionBootstrapService({
        getTargetSession: async () => accountA,
        verifyIdentity: async () => ({ accountId: 'account-b' }),
    });
    const result = await attemptOptionalEpicHistorySessionBootstrap({
        bootstrap: service.bootstrap.bind(service), accountId: 'account-a',
        authResult: { epicSession: makeSession([epicCookie('wrong')]) },
        context: { authoritativeIdentity: proof() },
    });
    const library = [{ id: 'game-1' }];
    assert.equal(result.status, 'mismatch');
    assert.equal(result.code, EPIC_HISTORY_ERROR_CODES.ACCOUNT_MISMATCH);
    assert.equal((await accountA.cookies.get({}))[0].value, 'a-old');
    assert.equal((await accountB.cookies.get({}))[0].value, 'b-untouched');
    assert.equal(historyFetches, 0);
    assert.equal(vaultWrites, 0);
    assert.equal(library.length, 1);
});

test('identity endpoint unavailable does not use linked identity as web-session proof', async () => {
    let historyFetches = 0;
    let commits = 0;
    let linkedIdentityChecks = 0;
    const service = new EpicPurchaseHistoryRefreshService({
        getAccount: async () => ({ id: 'account-a', displayName: 'A' }),
        getSession: async () => makeSession(),
        verifyIdentity: async () => {
            throw epicHistoryError(EPIC_HISTORY_ERROR_CODES.IDENTITY_ENDPOINT_UNAVAILABLE, 'generic identity HTML');
        },
        resolveSessionIdentity: async () => {
            linkedIdentityChecks += 1;
            return { accountId: 'account-a' };
        },
        fetchHistory: async () => {
            historyFetches += 1;
            return { purchaseHistoryItems: [{ orderId: 'new' }], ordersCount: 1, pagesFetched: 1 };
        },
        readVaultAccount: async () => ({ accountId: 'account-a', purchaseHistoryFetchedAt: 'old' }),
        processHistory: async (value) => value,
        buildVaultAccount: async ({ fetchedAt }) => ({ accountId: 'account-a', purchaseHistoryFetchedAt: fetchedAt }),
        commitVaultAccount: async () => { commits += 1; },
    });
    await assert.rejects(service.refresh('account-a', { allowInteractiveLogin: true }), {
        code: EPIC_HISTORY_ERROR_CODES.IDENTITY_ENDPOINT_UNAVAILABLE,
    });
    assert.equal(linkedIdentityChecks, 0);
    assert.equal(historyFetches, 0);
    assert.equal(commits, 0);
});

test('explicit redirect to Epic login is authoritative authentication failure', () => {
    const result = classifyEpicWebResponse({
        status: 200,
        redirected: true,
        url: 'https://www.epicgames.com/id/login?redirectUrl=%2Faccount',
        headers: { get: () => 'text/html' },
    }, '<html><body>redirecting</body></html>');
    assert.equal(result.explicitLoginRedirect, true);
    assert.equal(result.authenticationFailure, true);
});

test('platform fetch mapping never translates generic identity HTML or empty bodies to reauth', () => {
    const platformSource = fs.readFileSync(path.join(__dirname, '..', 'platformSync.js'), 'utf8');
    assert.doesNotMatch(platformSource, /missingIdentityState[\s\S]{0,240}REAUTH_REQUIRED/);
    assert.match(platformSource, /classification !== 'json'[\s\S]{0,220}IDENTITY_ENDPOINT_UNAVAILABLE/);
});

test('generic HTML from History fails only History and preserves existing Vault timestamp', async () => {
    const previous = { accountId: 'account-a', purchaseHistoryFetchedAt: '2025-01-01T00:00:00.000Z', purchaseHistoryItems: [{ orderId: 'old' }] };
    let commits = 0;
    const service = new EpicPurchaseHistoryRefreshService({
        getAccount: async () => ({ id: 'account-a', displayName: 'A' }),
        getSession: async () => makeSession(),
        verifyIdentity: async () => ({ accountId: 'account-a' }),
        fetchHistory: async () => { throw epicHistoryError(EPIC_HISTORY_ERROR_CODES.INVALID_RESPONSE, 'unexpected html'); },
        readVaultAccount: async () => previous,
        processHistory: async (value) => value,
        buildVaultAccount: async () => { throw new Error('must not build'); },
        commitVaultAccount: async () => { commits += 1; },
    });
    await assert.rejects(service.refresh('account-a', { allowInteractiveLogin: false }), {
        code: EPIC_HISTORY_ERROR_CODES.INVALID_RESPONSE,
    });
    assert.equal(commits, 0);
    assert.equal(previous.purchaseHistoryFetchedAt, '2025-01-01T00:00:00.000Z');
    assert.deepEqual(previous.purchaseHistoryItems, [{ orderId: 'old' }]);
    assert.deepEqual({ games: 'complete', prices: 'complete' }, { games: 'complete', prices: 'complete' });
});

function createRendererHarness() {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src/js/accounts/platform-panels.js'), 'utf8');
    const start = source.indexOf('let activePlatformView');
    const end = source.indexOf('// WINDOW EXPORTS', start);
    assert.ok(start >= 0 && end > start);
    const calls = { link: [], sync: [], toasts: [], linkListeners: [] };
    let pendingLink = null;
    const sandbox = {
        console: { error() {}, log() {} }, Date, Promise, Object, String, Number, Math,
        setTimeout: () => 1, clearTimeout() {},
        document: {
            readyState: 'loading', addEventListener() {},
            getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
        },
        window: {
            electronAPI: {
                platformSyncSync: async (...args) => { calls.sync.push(args); return { status: 'started', syncRunId: 'sync-run-1' }; },
                platformSyncLink: (...args) => { calls.link.push(args); return pendingLink || Promise.resolve({ status: 'success', accountId: 'a', initialSyncComplete: true }); },
                onPlatformSyncState: () => () => {},
                onPlatformSyncCompleted: () => () => {},
                onPlatformSyncFailed: () => () => {},
                onPlatformLinkStateChanged: (listener) => { calls.linkListeners.push(listener); return () => {}; },
            },
            showEpicSyncOptionsDialog: async () => ({ games: true, currentPrices: true, purchaseHistory: true }),
            hydrateSidebarAllGamesCount: () => Promise.resolve(),
            invalidateEpicVaultCache: async () => {},
        },
        PLATFORM_CONFIG: { epic: { name: 'Epic Games' }, steam: { name: 'Steam' }, gog: { name: 'GOG' } },
        showToast: (message, type) => calls.toasts.push({ message, type }),
        _renderPlatformSyncOverlay() {}, _schedulePlatformAccountsRender() {}, _renderPlatformSyncStatusPanel() {},
        _hidePlatformSyncOverlay() {}, updatePlatformsOverview: async () => {}, renderPlatformAccounts: async () => {},
        _agSafeRenderAllGamesView: async () => {}, _renderEpicLibraryPanel: async () => {},
        openConfirmModal() {}, loadAccountsForPlatform: async () => [],
    };
    sandbox.window.window = sandbox.window;
    const context = vm.createContext(sandbox);
    vm.runInContext(`${source.slice(start, end)}\nactivePlatformView = 'epic';\nwindow.linkNewPlatformAccount = linkNewPlatformAccount;\nwindow.syncCurrentPlatform = syncCurrentPlatform;\nwindow.syncSinglePlatformAccount = syncSinglePlatformAccount;`, context);
    return {
        calls, window: sandbox.window,
        setPendingLink(value) { pendingLink = value; },
        flush: () => new Promise((resolve) => setImmediate(resolve)),
    };
}

test('individual SYNC and Sync Library route only to platformSyncSync', async () => {
    const individual = createRendererHarness();
    await individual.window.syncSinglePlatformAccount('account-a');
    await individual.flush();
    assert.equal(individual.calls.sync.length, 1);
    assert.equal(individual.calls.sync[0][1], 'account-a');
    assert.equal(individual.calls.link.length, 0);

    const library = createRendererHarness();
    await library.window.syncCurrentPlatform();
    await library.flush();
    assert.equal(library.calls.sync.length, 1);
    assert.equal(library.calls.sync[0][1], null);
    assert.equal(library.calls.link.length, 0);
});

test('Link Account routes only to platformSyncLink', async () => {
    const harness = createRendererHarness();
    await harness.window.linkNewPlatformAccount();
    assert.equal(harness.calls.link.length, 1);
    assert.equal(harness.calls.sync.length, 0);
});

test('a stale failed link cannot show a link toast after a newer sync starts', async () => {
    const harness = createRendererHarness();
    let rejectLink;
    harness.setPendingLink(new Promise((_resolve, reject) => { rejectLink = reject; }));
    const oldLink = harness.window.linkNewPlatformAccount();
    await harness.flush();
    await harness.window.syncCurrentPlatform();
    await harness.flush();
    const stale = harness.calls.linkListeners[0];
    stale({ platform: 'epic', operationType: 'link', operationId: 'old-link', status: 'failed', message: 'old failure' });
    rejectLink(new Error('old link failure'));
    await oldLink;
    assert.equal(harness.calls.sync.length, 1);
    assert.equal(harness.calls.toasts.some((toast) => /Failed to link platform/i.test(toast.message)), false);
});
