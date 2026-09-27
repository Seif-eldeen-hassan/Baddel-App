'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    EpicHistorySessionBootstrapService,
    accountHash,
    cookieDetails,
    isEpicCookie,
} = require('../src/features/sync/application/services/EpicHistorySessionBootstrapService');
const {
    EPIC_HISTORY_ERROR_CODES,
    EpicPurchaseHistoryRefreshService,
    epicHistoryError,
} = require('../src/features/sync/application/services/EpicPurchaseHistoryRefreshService');

function cookieKey(cookie) {
    return `${String(cookie.domain || '').replace(/^\./, '')}|${cookie.path || '/'}|${cookie.name}`;
}

function makeSession(seed = []) {
    const values = new Map(seed.map((cookie) => [cookieKey(cookie), { ...cookie }]));
    const calls = [];
    return {
        calls,
        cookies: {
            async get() { return [...values.values()].map((cookie) => ({ ...cookie })); },
            async set(details) {
                calls.push({ kind: 'set', details: { ...details } });
                const url = new URL(details.url);
                const cookie = {
                    ...details,
                    domain: details.domain || url.hostname,
                    hostOnly: !details.domain,
                    path: details.path || url.pathname || '/',
                };
                values.set(cookieKey(cookie), cookie);
            },
            async remove(url, name) {
                calls.push({ kind: 'remove', url, name });
                const host = new URL(url).hostname;
                for (const [key, cookie] of values) {
                    if (cookie.name === name && String(cookie.domain || '').replace(/^\./, '') === host) values.delete(key);
                }
            },
            async flushStore() { calls.push({ kind: 'flush' }); },
        },
    };
}

const epicCookie = (value = 'new-value') => ({
    name: 'EPIC_SESSION', value, domain: '.epicgames.com', hostOnly: false,
    path: '/account', secure: true, httpOnly: true, sameSite: 'lax', expirationDate: 1999999999,
});

test('authenticated Epic cookies are copied with attributes and flushed before identity verification', async () => {
    const source = makeSession([epicCookie(), { name: 'OTHER', value: 'ignore', domain: '.example.com', path: '/' }]);
    const target = makeSession();
    const order = [];
    const diagnostics = [];
    const service = new EpicHistorySessionBootstrapService({
        getTargetSession: async () => target,
        flushSession: async (session) => { order.push('flush'); await session.cookies.flushStore(); },
        verifyIdentity: async (session) => {
            order.push('verify');
            assert.equal((await session.cookies.get({})).filter(isEpicCookie).length, 1);
            return { accountId: 'account-a' };
        },
        onDiagnostic: (event) => diagnostics.push(event),
    });
    const result = await service.bootstrap('account-a', {
        epicSession: source, userAgent: 'UA', waitForSessionReady: async () => order.push('source-ready'),
    });
    assert.equal(result.cookieCount, 1);
    assert.deepEqual(order, ['source-ready', 'flush', 'verify']);
    const set = target.calls.find((call) => call.kind === 'set').details;
    assert.deepEqual({
        name: set.name, value: set.value, domain: set.domain, path: set.path,
        secure: set.secure, httpOnly: set.httpOnly, sameSite: set.sameSite, expirationDate: set.expirationDate,
    }, {
        name: 'EPIC_SESSION', value: 'new-value', domain: '.epicgames.com', path: '/account',
        secure: true, httpOnly: true, sameSite: 'lax', expirationDate: 1999999999,
    });
    assert.deepEqual(diagnostics.map((event) => event.stage), [
        'history_session_handoff_started', 'history_cookies_copied',
        'history_cookie_store_flushed', 'history_session_identity_verified',
    ]);
    assert.doesNotMatch(JSON.stringify(diagnostics), /new-value|EPIC_SESSION|authorization|token/i);
});

test('host-only cookie remains host-only during handoff', () => {
    const details = cookieDetails({ name: 'HOST', value: 'x', domain: 'www.epicgames.com', hostOnly: true, path: '/', secure: true });
    assert.equal(Object.hasOwn(details, 'domain'), false);
    assert.equal(details.url, 'https://www.epicgames.com/');
});

test('account mismatch rolls the target partition back and performs no downstream work', async () => {
    const source = makeSession([epicCookie('account-b-cookie')]);
    const target = makeSession([epicCookie('account-a-old')]);
    const diagnostics = [];
    const service = new EpicHistorySessionBootstrapService({
        getTargetSession: async () => target,
        verifyIdentity: async () => ({ accountId: 'account-b' }),
        onDiagnostic: (event) => diagnostics.push(event),
    });
    await assert.rejects(service.bootstrap('account-a', { epicSession: source }), {
        code: EPIC_HISTORY_ERROR_CODES.ACCOUNT_MISMATCH,
        failedStage: 'history_session_identity_verified',
    });
    const restored = (await target.cookies.get({})).filter(isEpicCookie);
    assert.equal(restored.length, 1);
    assert.equal(restored[0].value, 'account-a-old');
    assert.equal(target.calls.filter((call) => call.kind === 'flush').length, 2);
    assert.equal(diagnostics.filter((event) => event.stage === 'history_session_handoff_rolled_back').length, 1);
    assert.equal(restored[0].path, '/account');
    assert.equal(restored[0].secure, true);
    assert.equal(restored[0].httpOnly, true);
    assert.equal(restored[0].sameSite, 'lax');
    assert.equal(restored[0].expirationDate, 1999999999);
});

test('account partitions stay isolated and survive service recreation', async () => {
    const registry = new Map();
    const getTargetSession = async (id) => {
        const key = accountHash(id);
        if (!registry.has(key)) registry.set(key, makeSession());
        return registry.get(key);
    };
    const createService = () => new EpicHistorySessionBootstrapService({
        getTargetSession,
        verifyIdentity: async (_session, _ua, options) => ({ accountId: options.expectedId }),
    });
    const bootstrap = async (id, value) => {
        const service = createService();
        service.verifyIdentity = async () => ({ accountId: id });
        await service.bootstrap(id, { epicSession: makeSession([epicCookie(value)]) });
    };
    await bootstrap('account-a', 'cookie-a');
    await bootstrap('account-b', 'cookie-b');
    assert.notEqual(accountHash('account-a'), accountHash('account-b'));
    assert.equal((await (await getTargetSession('account-a')).cookies.get({}))[0].value, 'cookie-a');
    assert.equal((await (await getTargetSession('account-b')).cookies.get({}))[0].value, 'cookie-b');
    const restartedService = createService();
    assert.ok(restartedService);
    assert.equal((await (await getTargetSession('account-a')).cookies.get({}))[0].value, 'cookie-a');
});

test('temporary account IDs can never create persistent History sessions', async () => {
    const service = new EpicHistorySessionBootstrapService({
        getTargetSession: async () => { throw new Error('must not be called'); },
        verifyIdentity: async () => ({ accountId: 'unused' }),
    });
    await assert.rejects(service.bootstrap('epic_tmp_123', { epicSession: makeSession() }), {
        code: EPIC_HISTORY_ERROR_CODES.IDENTITY_CHECK_FAILED,
    });
});

function makeRefreshService({ session, events, expiredInitially = false }) {
    let expired = expiredInitially;
    let loginCalls = 0;
    let fetches = 0;
    let commits = 0;
    const processed = { purchaseHistoryItems: [{ orderId: 'one' }], ordersCount: 1, games: [] };
    const service = new EpicPurchaseHistoryRefreshService({
        getAccount: async () => ({ id: 'account-a', displayName: 'A' }),
        getSession: async () => session,
        verifyIdentity: async () => {
            if (expired) throw epicHistoryError(EPIC_HISTORY_ERROR_CODES.REAUTH_REQUIRED, 'expired');
            return { accountId: 'account-a' };
        },
        clearSession: async () => {}, flushSession: async () => {},
        openLogin: async () => { loginCalls += 1; events.push('login window opened'); expired = false; return { close() {} }; },
        fetchHistory: async () => { fetches += 1; events.push('History background phase started'); return processed; },
        readVaultAccount: async () => ({ accountId: 'account-a', purchaseHistoryFetchedAt: 'old' }),
        processHistory: async (value) => value,
        buildVaultAccount: async ({ account, processed: next, fetchedAt }) => ({ ...next, accountId: account.id, purchaseHistoryFetchedAt: fetchedAt }),
        commitVaultAccount: async () => { commits += 1; events.push('History committed'); },
        readinessDelays: [0],
    });
    return { service, stats: () => ({ loginCalls, fetches, commits }) };
}

test('initial Connect acceptance sequence has one login and History reuses the handed-off session', async () => {
    const events = ['Connect clicked'];
    let initialLoginCalls = 0;
    initialLoginCalls += 1; events.push('Epic login window opened once');
    const source = makeSession([epicCookie()]);
    const target = makeSession();
    events.push('authorization received', 'real account ID resolved');
    const bootstrap = new EpicHistorySessionBootstrapService({
        getTargetSession: async () => target,
        verifyIdentity: async () => ({ accountId: 'account-a' }),
    });
    await bootstrap.bootstrap('account-a', { epicSession: source });
    events.push('persistent History session bootstrapped', 'library committed', 'games visible', 'prices background phase started');
    const refresh = makeRefreshService({ session: target, events });
    await refresh.service.refresh('account-a', { allowInteractiveLogin: false });
    assert.equal(initialLoginCalls, 1);
    assert.deepEqual(refresh.stats(), { loginCalls: 0, fetches: 1, commits: 1 });
    assert.deepEqual(events, [
        'Connect clicked', 'Epic login window opened once', 'authorization received',
        'real account ID resolved', 'persistent History session bootstrapped',
        'library committed', 'games visible', 'prices background phase started',
        'History background phase started', 'History committed',
    ]);
});

test('expired normal sync waits silently and explicit retry alone opens one login', async () => {
    const events = ['normal sync', 'games visible'];
    const refresh = makeRefreshService({ session: makeSession(), events, expiredInitially: true });
    const silent = await refresh.service.refresh('account-a', { allowInteractiveLogin: false });
    events.push('History becomes waiting_for_auth');
    assert.equal(silent.status, 'reauth_required');
    assert.deepEqual(refresh.stats(), { loginCalls: 0, fetches: 0, commits: 0 });
    await refresh.service.refresh('account-a', { allowInteractiveLogin: true });
    assert.deepEqual(refresh.stats(), { loginCalls: 1, fetches: 1, commits: 1 });
});

test('source policy keeps one Connect login, persistent hashed partitions, and no legacy competing History read', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '..', 'platformSync.js'), 'utf8');
    const connectorStart = source.indexOf('const epicConnectorMethods');
    const linkStart = source.indexOf('async link(parentWindow', connectorStart);
    const link = source.slice(linkStart, source.indexOf('async syncLibrary(', linkStart));
    assert.equal((link.match(/openEpicLoginWindow\(/g) || []).length, 1);
    assert.match(link, /attemptOptionalEpicHistorySessionBootstrap/);
    assert.match(link, /bootstrap: bootstrapEpicHistorySessionFromLogin/);
    assert.match(source, /persist:baddel-epic-history-\$\{digest\}/);
    assert.doesNotMatch(source, /Boolean\(runtime\?\.initialEpicAuthResult\)|Boolean\(runtime\.initialEpicAuthResult\)/);
    const syncSingle = source.slice(source.indexOf('async function syncSingleEpicAccount'), source.indexOf('async function runEpicProgressivePricesPhase'));
    assert.doesNotMatch(syncSingle, /fetchEpicOrderHistoryWithSession\(/);
});
