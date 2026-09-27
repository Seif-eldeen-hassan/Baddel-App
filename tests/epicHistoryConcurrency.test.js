'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    EpicPurchaseHistoryRefreshService,
    EPIC_HISTORY_ERROR_CODES,
    epicHistoryError,
} = require('../src/features/sync/application/services/EpicPurchaseHistoryRefreshService');
const { EpicProgressiveSyncCoordinator } = require('../src/features/sync/application/services/EpicProgressiveSyncCoordinator');

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

function historyHarness() {
    const gates = new Map();
    const counts = { fetch: new Map(), commit: new Map(), login: 0 };
    const bump = (map, id) => map.set(id, Number(map.get(id) || 0) + 1);
    const service = new EpicPurchaseHistoryRefreshService({
        getAccount: async (id) => ({ id, displayName: id }),
        getSession: async (id) => ({ accountId: id }),
        verifyIdentity: async (epicSession) => ({ accountId: epicSession.accountId }),
        fetchHistory: async (epicSession) => {
            const id = epicSession.accountId;
            bump(counts.fetch, id);
            if (!gates.has(id)) gates.set(id, deferred());
            await gates.get(id).promise;
            return { purchaseHistoryItems: [{ orderId: id + '-order' }], ordersCount: 1 };
        },
        readVaultAccount: async (id) => ({ accountId: id }),
        processHistory: async (value) => value,
        buildVaultAccount: async ({ account, fetchedAt }) => ({ accountId: account.id, purchaseHistoryFetchedAt: fetchedAt }),
        commitVaultAccount: async (value) => {
            bump(counts.commit, value.accountId);
            return { ...value, vaultRevision: 7 };
        },
        openLogin: async () => { counts.login += 1; },
    });
    return { service, gates, counts };
}

async function coordinatorReady(accountId = 'account-a') {
    const writes = [];
    const coordinator = new EpicProgressiveSyncCoordinator({
        store: { read: async () => ({}), write: async (value) => writes.push(value) },
        isAccountActive: async () => true,
    });
    const state = await coordinator.beginAccount({
        accountId, syncRunId: 'sync-1', options: { purchaseHistory: true },
    });
    await coordinator.markLibraryCommitted({ accountId, syncRunId: 'sync-1', revision: state.revision });
    return { coordinator, state, writes };
}

function progressiveTask(service, accountId, source = 'progressive_sync') {
    return async ({ signal }) => {
        const result = await service.refresh(accountId, {
            operationId: source + '-operation', source, signal,
        });
        return {
            status: 'complete',
            committedRevision: result.committedRevision,
            operationSequence: result.operationSequence,
            canonicalOperationId: result.canonicalOperationId,
            progress: { committedRevision: result.committedRevision },
        };
    };
}

test('manual owner and progressive caller join one canonical fetch and commit', async () => {
    const { service, gates, counts } = historyHarness();
    const { coordinator, state } = await coordinatorReady();
    const manual = service.refresh('account-a', { operationId: 'manual-operation', source: 'manual_refresh' });
    await new Promise((resolve) => setImmediate(resolve));
    const progressive = coordinator.startOptionalPhases({
        accountId: 'account-a', syncRunId: 'sync-1', revision: state.revision,
        purchaseHistoryTask: progressiveTask(service, 'account-a'),
    });
    await new Promise((resolve) => setImmediate(resolve));
    gates.get('account-a').resolve();
    const [manualResult, phaseResults] = await Promise.all([manual, progressive]);
    assert.equal(manualResult.status, 'success');
    assert.equal(phaseResults[0].status, 'fulfilled');
    assert.equal(counts.fetch.get('account-a'), 1);
    assert.equal(counts.commit.get('account-a'), 1);
    assert.equal(coordinator.getAccountState('account-a').phases.purchaseHistory.status, 'complete');
    assert.notEqual(coordinator.getAccountState('account-a').overallStatus, 'partial');
    await coordinator.shutdown();
});

test('progressive owner lets manual UI join and hydrate from final success', async () => {
    const { service, gates, counts } = historyHarness();
    const { coordinator, state } = await coordinatorReady();
    let hydrations = 0;
    const progressive = coordinator.startOptionalPhases({
        accountId: 'account-a', syncRunId: 'sync-1', revision: state.revision,
        purchaseHistoryTask: progressiveTask(service, 'account-a'),
    });
    await new Promise((resolve) => setImmediate(resolve));
    const manual = service.refresh('account-a', { operationId: 'manual-operation', source: 'manual_refresh' })
        .then((result) => { hydrations += 1; return result; });
    gates.get('account-a').resolve();
    const [manualResult] = await Promise.all([manual, progressive]);
    assert.equal(manualResult.joined, true);
    assert.equal(manualResult.canonicalSource, 'progressive_sync');
    assert.equal(hydrations, 1);
    assert.equal(counts.fetch.get('account-a'), 1);
    assert.equal(counts.commit.get('account-a'), 1);
    assert.equal(counts.login, 0);
    await coordinator.shutdown();
});

test('different Epic accounts refresh independently', async () => {
    const { service, gates, counts } = historyHarness();
    const a = service.refresh('account-a', { operationId: 'manual-a', source: 'manual_refresh' });
    const b = service.refresh('account-b', { operationId: 'manual-b', source: 'manual_refresh' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(counts.fetch.get('account-a'), 1);
    assert.equal(counts.fetch.get('account-b'), 1);
    gates.get('account-a').resolve();
    gates.get('account-b').resolve();
    await Promise.all([a, b]);
    assert.equal(counts.commit.get('account-a'), 1);
    assert.equal(counts.commit.get('account-b'), 1);
});

test('a joining caller cancellation signal cannot cancel the owner', async () => {
    const { service, gates, counts } = historyHarness();
    const ownerController = new AbortController();
    const joinController = new AbortController();
    const owner = service.refresh('account-a', {
        operationId: 'owner-operation', source: 'progressive_sync', signal: ownerController.signal,
    });
    await new Promise((resolve) => setImmediate(resolve));
    const joined = service.refresh('account-a', {
        operationId: 'joined-operation', source: 'manual_refresh', signal: joinController.signal,
    });
    joinController.abort();
    gates.get('account-a').resolve();
    const [ownerResult, joinedResult] = await Promise.all([owner, joined]);
    assert.equal(ownerResult.status, 'success');
    assert.equal(joinedResult.status, 'success');
    assert.equal(joinedResult.joined, true);
    assert.equal(counts.fetch.get('account-a'), 1);
});

test('legacy already-running boundary remains active and is never marked failed', async () => {
    const { coordinator, state } = await coordinatorReady();
    const results = await coordinator.startOptionalPhases({
        accountId: 'account-a', syncRunId: 'sync-1', revision: state.revision,
        purchaseHistoryTask: async () => {
            throw epicHistoryError(EPIC_HISTORY_ERROR_CODES.ALREADY_RUNNING, 'legacy boundary');
        },
    });
    assert.equal(results[0].status, 'fulfilled');
    const phase = coordinator.getAccountState('account-a').phases.purchaseHistory;
    assert.equal(phase.status, 'running');
    assert.equal(phase.errorCode, null);
    await coordinator.shutdown();
});

test('committed success rejects a delayed stale failure event', async () => {
    const { coordinator, state } = await coordinatorReady();
    await coordinator.reconcilePurchaseHistorySuccess({
        accountId: 'account-a', operationId: 'new', operationSequence: 2,
        committedRevision: 7, purchaseHistoryFetchedAt: '2026-09-09T11:34:46.173Z',
    });
    await coordinator.report('account-a', 'sync-1', state.revision, 'purchaseHistory', {
        status: 'failed', errorCode: 'EPIC_HISTORY_FETCH_FAILED', operationSequence: 1,
    });
    const phase = coordinator.getAccountState('account-a').phases.purchaseHistory;
    assert.equal(phase.status, 'complete');
    assert.equal(phase.errorCode, null);
    assert.equal(phase.committedRevision, 7);
    await coordinator.shutdown();
});

test('restore cleans persisted already-running failures because no operation survived restart', async () => {
    let saved;
    const coordinator = new EpicProgressiveSyncCoordinator({
        store: {
            read: async () => ({ accounts: { a: {
                accountId: 'a', syncRunId: 'old', revision: 1, overallStatus: 'partial',
                phases: {
                    library: { status: 'complete' }, prices: { status: 'complete' },
                    purchaseHistory: { status: 'failed', errorCode: EPIC_HISTORY_ERROR_CODES.ALREADY_RUNNING },
                },
            } } }),
            write: async (value) => { saved = value; },
        },
    });
    await coordinator.restore();
    assert.equal(saved.accounts.a.phases.purchaseHistory.status, 'skipped');
    assert.equal(saved.accounts.a.phases.purchaseHistory.errorCode, null);
    await coordinator.shutdown();
});
