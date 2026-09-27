'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EpicProgressiveSyncCoordinator } = require('../src/features/sync/application/services/EpicProgressiveSyncCoordinator');

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function harness(saved = {}) {
    let persisted = saved;
    const events = [];
    const active = new Set(['a', 'b']);
    let tick = 0;
    const coordinator = new EpicProgressiveSyncCoordinator({
        store: {
            read: async () => persisted,
            write: async (value) => { persisted = JSON.parse(JSON.stringify(value)); },
        },
        emit: (event) => events.push(JSON.parse(JSON.stringify(event))),
        now: () => `2026-08-28T00:00:${String(tick++).padStart(2, '0')}.000Z`,
        isAccountActive: async (id) => active.has(id),
    });
    return { coordinator, events, active, persisted: () => persisted };
}

test('library commits and emits ready while prices and history remain unresolved', async () => {
    const prices = deferred();
    const history = deferred();
    const order = [];
    const { coordinator } = harness();
    const result = await coordinator.startRun({
        accountId: 'a', syncRunId: 'run-1', isFirstFullImport: true,
        options: { currentPrices: true, purchaseHistory: true },
        libraryTask: async () => { order.push('library-fetched'); return { games: [{ id: 'g1' }], gamesFetched: 1 }; },
        commitLibrary: async () => { order.push('library-committed'); },
        emitLibraryReady: async () => { order.push('library-ready'); },
        pricesTask: async () => { order.push('prices-started'); await prices.promise; order.push('prices-complete'); },
        purchaseHistoryTask: async () => { order.push('history-started'); await history.promise; order.push('history-complete'); },
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(order, ['library-fetched', 'library-committed', 'library-ready', 'history-started', 'prices-started']);
    assert.equal(order.includes('history-complete'), false);
    assert.equal(order.includes('prices-complete'), false);
    assert.equal(result.state.overallStatus, 'library_ready_enriching');
    assert.equal(result.state.phases.library.status, 'complete');
    prices.resolve(); history.resolve();
    await result.background;
    assert.equal(coordinator.getAccountState('a').overallStatus, 'complete');
});

test('per-phase pending events preserve History complete beside Prices running', async () => {
    const prices = deferred();
    const { coordinator, events } = harness();
    const run = await coordinator.startRun({
        accountId: 'a', syncRunId: 'phase-events', options: { currentPrices: true, purchaseHistory: true },
        libraryTask: async () => ({ gamesFetched: 1 }), commitLibrary: async () => {}, emitLibraryReady: async () => {},
        pricesTask: async () => { await prices.promise; },
        purchaseHistoryTask: async () => ({ committedRevision: 8, progress: { pagesFetched: 7, ordersFetched: 186 } }),
    });
    await new Promise((resolve) => setImmediate(resolve));
    coordinator._flushEvents();
    const historyComplete = events.find((event) => event.phase === 'purchaseHistory' && event.phaseStatus === 'complete');
    const pricesRunning = events.find((event) => event.phase === 'prices' && event.phaseStatus === 'running');
    assert.ok(historyComplete, 'History terminal transition must survive the throttled flush');
    assert.ok(pricesRunning, 'Prices progress must remain independently visible');
    assert.equal(historyComplete.committedRevision, 8);
    assert.equal(historyComplete.libraryRevision, run.state.revision);
    prices.resolve();
    await run.background;
});

test('price failure is partial and does not cancel successful history', async () => {
    const { coordinator } = harness();
    const result = await coordinator.startRun({
        accountId: 'a', syncRunId: 'run-2', options: { currentPrices: true, purchaseHistory: true },
        libraryTask: async () => ({ gamesFetched: 2 }), commitLibrary: async () => {}, emitLibraryReady: async () => {},
        pricesTask: async () => { const error = new Error('price failed'); error.code = 'EPIC_PRICE_API_FAILED'; throw error; },
        purchaseHistoryTask: async () => ({ progress: { pagesFetched: 4, ordersFetched: 90 } }),
    });
    await result.background;
    const state = coordinator.getAccountState('a');
    assert.equal(state.overallStatus, 'partial');
    assert.equal(state.phases.prices.status, 'failed');
    assert.equal(state.phases.purchaseHistory.status, 'complete');
    assert.equal(state.phases.purchaseHistory.ordersFetched, 90);
});

test('duplicate phase starts share one in-flight task', async () => {
    const gate = deferred();
    let calls = 0;
    const { coordinator } = harness();
    const result = await coordinator.startRun({
        accountId: 'a', syncRunId: 'run-3', options: { currentPrices: true },
        libraryTask: async () => ({ gamesFetched: 1 }), commitLibrary: async () => {}, emitLibraryReady: async () => {},
        pricesTask: async () => { calls += 1; await gate.promise; },
    });
    const state = coordinator.getAccountState('a');
    const duplicate = coordinator.startOptionalPhases({ accountId: 'a', syncRunId: state.syncRunId, revision: state.revision, pricesTask: async () => { calls += 1; } });
    gate.resolve();
    await Promise.all([result.background, duplicate]);
    assert.equal(calls, 1);
});

test('multiple accounts remain independent and stale runs cannot finish', async () => {
    const oldGate = deferred();
    const { coordinator } = harness();
    const old = await coordinator.startRun({
        accountId: 'a', syncRunId: 'old', options: { purchaseHistory: true },
        libraryTask: async () => ({ gamesFetched: 1 }), commitLibrary: async () => {}, emitLibraryReady: async () => {},
        purchaseHistoryTask: async ({ assertCurrent }) => { await oldGate.promise; await assertCurrent(); },
    });
    const other = await coordinator.startRun({
        accountId: 'b', syncRunId: 'other', options: {},
        libraryTask: async () => ({ gamesFetched: 2 }), commitLibrary: async () => {}, emitLibraryReady: async () => {},
    });
    await other.background;
    await coordinator.startRun({
        accountId: 'a', syncRunId: 'new', options: {},
        libraryTask: async () => ({ gamesFetched: 3 }), commitLibrary: async () => {}, emitLibraryReady: async () => {},
    });
    oldGate.resolve();
    await old.background;
    assert.equal(coordinator.getAccountState('a').syncRunId, 'new');
    assert.equal(coordinator.getAccountState('b').phases.library.gamesFetched, 2);
});

test('unlink invalidates late work and removes durable state', async () => {
    const gate = deferred();
    const { coordinator, active, persisted } = harness();
    const run = await coordinator.startRun({
        accountId: 'a', syncRunId: 'run-4', options: { purchaseHistory: true },
        libraryTask: async () => ({ gamesFetched: 1 }), commitLibrary: async () => {}, emitLibraryReady: async () => {},
        purchaseHistoryTask: async ({ assertCurrent }) => { await gate.promise; await assertCurrent(); },
    });
    active.delete('a');
    await coordinator.cancelAccount('a');
    gate.resolve();
    await run.background;
    assert.equal(coordinator.getAccountState('a'), null);
    assert.equal(persisted().accounts.a, undefined);
});

test('restore exposes interrupted enrichment as durable partial state', async () => {
    const saved = { accounts: { a: {
        platform: 'epic', accountId: 'a', syncRunId: 'old', revision: 2,
        overallStatus: 'library_ready_enriching', updatedAt: 'old',
        phases: { library: { status: 'complete' }, prices: { status: 'running' }, purchaseHistory: { status: 'waiting_for_auth' } },
    } } };
    const { coordinator } = harness(saved);
    await coordinator.restore();
    const state = coordinator.getAccountState('a');
    assert.equal(state.overallStatus, 'partial');
    assert.equal(state.phases.prices.errorCode, 'EPIC_SYNC_INTERRUPTED');
    assert.equal(state.phases.purchaseHistory.status, 'waiting_for_auth');
});

test('emitted and persisted state contains no task secrets', async () => {
    const { coordinator, events, persisted } = harness();
    const result = await coordinator.startRun({
        accountId: 'a', syncRunId: 'run-safe', options: { purchaseHistory: true },
        libraryTask: async () => ({ gamesFetched: 1 }), commitLibrary: async () => {}, emitLibraryReady: async () => {},
        purchaseHistoryTask: async () => ({ progress: { pagesFetched: 1, ordersFetched: 2 } }),
    });
    await result.background;
    const serialized = JSON.stringify({ events, persisted: persisted() });
    assert.doesNotMatch(serialized, /authorizationCode|accessToken|refreshToken|exchangeCode|cookie/i);
});


test('background library refresh preserves durable failed optional phases for explicit retry', async () => {
    const { coordinator } = harness();
    const first = await coordinator.startRun({
        accountId: 'a', syncRunId: 'failed-run', options: { purchaseHistory: true },
        libraryTask: async () => ({ gamesFetched: 2 }), commitLibrary: async () => {}, emitLibraryReady: async () => {},
        purchaseHistoryTask: async () => { const error = new Error('history failed'); error.code = 'EPIC_HISTORY_FETCH_FAILED'; throw error; },
    });
    await first.background;
    assert.equal(coordinator.getAccountState('a').overallStatus, 'partial');

    const refreshed = await coordinator.beginAccount({
        accountId: 'a', syncRunId: 'startup-library',
        options: { preserveTerminalOptionalState: true },
    });
    await coordinator.markLibraryCommitted({ accountId: 'a', syncRunId: 'startup-library', revision: refreshed.revision, gamesFetched: 3 });
    await coordinator.startOptionalPhases({ accountId: 'a', syncRunId: 'startup-library', revision: refreshed.revision });
    const restored = coordinator.getAccountState('a');
    assert.equal(restored.phases.library.status, 'complete');
    assert.equal(restored.phases.purchaseHistory.status, 'failed');
    assert.equal(restored.overallStatus, 'partial');
});

test('phase retries do not execute the library task and remain phase-specific', async () => {
    let libraryCalls = 0;
    let priceCalls = 0;
    let historyCalls = 0;
    const { coordinator } = harness();
    const run = await coordinator.startRun({
        accountId: 'a', syncRunId: 'retry-run', options: { currentPrices: true, purchaseHistory: true },
        libraryTask: async () => { libraryCalls += 1; return { gamesFetched: 4 }; },
        commitLibrary: async () => {}, emitLibraryReady: async () => {},
        pricesTask: async () => { throw Object.assign(new Error('prices failed'), { code: 'EPIC_PRICE_API_FAILED' }); },
        purchaseHistoryTask: async () => { throw Object.assign(new Error('history failed'), { code: 'EPIC_HISTORY_FETCH_FAILED' }); },
    });
    await run.background;
    await coordinator.retryPhase({ accountId: 'a', phase: 'prices', task: async () => { priceCalls += 1; } });
    assert.equal(historyCalls, 0);
    await coordinator.retryPhase({ accountId: 'a', phase: 'purchaseHistory', task: async () => { historyCalls += 1; } });
    assert.equal(libraryCalls, 1);
    assert.equal(priceCalls, 1);
    assert.equal(historyCalls, 1);
});
