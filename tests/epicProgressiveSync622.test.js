'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EpicEnrichmentScheduler } = require('../src/features/sync/application/services/EpicEnrichmentScheduler');
const { EpicProgressiveSyncCoordinator } = require('../src/features/sync/application/services/EpicProgressiveSyncCoordinator');
const { EpicPriceEnrichmentService } = require('../src/features/sync/application/services/EpicPriceEnrichmentService');
const { collectEpicPurchaseHistoryPages } = require('../src/features/sync/application/services/EpicPurchaseHistoryRefreshService');
const { PlatformSyncCacheRepository } = require('../src/features/sync/infrastructure/repositories/PlatformSyncCacheRepository');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const makeEntries = (count = 622) => Array.from({ length: count }, (_, index) => ({ id: index, title: `Game ${index}` }));

test('622 progress updates stay within disk and IPC budgets', async (t) => {
    let diskWrites = 0;
    let ipcEvents = 0;
    const coordinator = new EpicProgressiveSyncCoordinator({
        store: { read: async () => ({}), write: async () => { diskWrites += 1; } },
        emit: () => { ipcEvents += 1; },
        isAccountActive: async () => true,
        ipcIntervalMs: 250,
        persistIntervalMs: 2000,
        persistEveryItems: 25,
    });
    t.after(() => coordinator.shutdown());
    const state = await coordinator.beginAccount({
        accountId: 'large', syncRunId: 'run-1', isFirstFullImport: true,
        options: { currentPrices: true, purchaseHistory: false },
    });
    await coordinator.markLibraryCommitted({ accountId: 'large', syncRunId: 'run-1', revision: state.revision, gamesFetched: 622 });
    for (let processed = 1; processed <= 622; processed += 1) {
        const event = processed % 25 === 0 ? 'batch_committed' : undefined;
        await coordinator.report('large', 'run-1', state.revision, 'prices', {
            status: 'running', processed, total: 622, resolved: processed, ...(event ? { event } : {}),
        });
    }
    await coordinator.report('large', 'run-1', state.revision, 'prices', { status: 'complete', processed: 622, total: 622, resolved: 622 });
    await delay(300);
    assert.ok(diskWrites <= 30, `disk writes=${diskWrites}`);
    assert.ok(ipcEvents <= 2, `IPC events=${ipcEvents}`);
    t.diagnostic(`622 metrics: diskWrites=${diskWrites}, ipcEvents=${ipcEvents}`);
});

test('622 resolved prices keep the optional phase responsive and bounded', async (t) => {
    const { monitorEventLoopDelay } = require('node:perf_hooks');
    const loop = monitorEventLoopDelay({ resolution: 10 });
    const heapBefore = process.memoryUsage().heapUsed;
    loop.enable();
    let progressReports = 0;
    const service = new EpicPriceEnrichmentService({
        fetchEntry: async (entry) => {
            await delay(1);
            return { id: entry.id, priceStatus: 'priced', resolutionSource: 'offer_id', amount: 100 };
        },
        concurrency: 2,
        batchSize: 100,
        maxRetries: 0,
        progressEveryItems: 20,
        progressIntervalMs: 60000,
        nowMs: () => 0,
    });
    const result = await service.process(makeEntries(), {
        onBatch: async () => {},
        onProgress: async () => { progressReports += 1; },
    });
    loop.disable();
    const heapDeltaMb = Math.max(0, process.memoryUsage().heapUsed - heapBefore) / (1024 * 1024);
    const eventLoopP99Ms = Number(loop.percentile(99) / 1e6);
    assert.equal(result.progress.processed, 622);
    assert.equal(result.progress.maxActiveRequests, 2);
    assert.equal(result.progress.batchesCommitted, 7);
    assert.ok(progressReports <= 40, 'progress reports=' + progressReports);
    assert.ok(eventLoopP99Ms < 100, 'event loop p99=' + eventLoopP99Ms);
    t.diagnostic('optional-phase metrics: activeHTTP=' + result.progress.maxActiveRequests
        + ', eventLoopP99Ms=' + eventLoopP99Ms.toFixed(2)
        + ', heapDeltaMb=' + heapDeltaMb.toFixed(2)
        + ', batches=' + result.progress.batchesCommitted
        + ', progressReports=' + progressReports);
});

test('zero price coverage fails truthfully and circuit breaker stops before 622 requests', async (t) => {
    let requests = 0;
    const service = new EpicPriceEnrichmentService({
        fetchEntry: async () => { requests += 1; return { priceStatus: 'unresolved', resolutionSource: 'network_failure' }; },
        concurrency: 3, batchSize: 25, maxRetries: 0, circuitMinAttempts: 24,
    });
    await assert.rejects(
        service.process(makeEntries(), { onBatch: async () => {} }),
        (error) => error.code === 'EPIC_PRICES_ZERO_COVERAGE'
            && error.failedStage === 'price_resolution'
            && error.progress.resolved === 0
    );
    assert.ok(requests < 40, `requests=${requests}`);
    t.diagnostic(`zero-coverage circuit: requests=${requests}, avoided=${622 - requests}`);
});

test('partial prices commit successful batches and retry only transient records', async () => {
    const committed = [];
    const first = new EpicPriceEnrichmentService({
        fetchEntry: async (entry) => entry.id % 3 === 0
            ? { id: entry.id, priceStatus: 'unresolved', resolutionSource: 'timeout' }
            : { id: entry.id, priceStatus: 'priced', resolutionSource: 'offer_id', amount: 100 },
        concurrency: 3, batchSize: 20, maxRetries: 0,
    });
    const result = await first.process(makeEntries(60), { onBatch: async (batch) => committed.push(...batch) });
    assert.equal(result.status, 'partial');
    assert.equal(result.progress.resolved, 40);
    assert.equal(result.retryable.length, 20);
    assert.equal(committed.filter((item) => item.priceStatus === 'priced').length, 40);
    let retryRequests = 0;
    const retry = new EpicPriceEnrichmentService({
        fetchEntry: async (entry) => { retryRequests += 1; return { id: entry.id, priceStatus: 'priced', resolutionSource: 'offer_id' }; },
        maxRetries: 0,
    });
    await retry.process(result.retryable, { onBatch: async () => {} });
    assert.equal(retryRequests, 20);
});

test('repeated 429 responses respect bounded concurrency and open the circuit', async () => {
    let active = 0;
    let maxActive = 0;
    let requests = 0;
    const service = new EpicPriceEnrichmentService({
        fetchEntry: async () => {
            requests += 1;
            active += 1;
            maxActive = Math.max(maxActive, active);
            await delay(1);
            active -= 1;
            return { priceStatus: 'unresolved', resolutionSource: 'rate_limited', retryAfterMs: 1 };
        },
        concurrency: 3, maxRetries: 0, circuitMinAttempts: 12,
    });
    await assert.rejects(service.process(makeEntries(), { onBatch: async () => {} }), { code: 'EPIC_PRICES_ZERO_COVERAGE' });
    assert.ok(maxActive <= 3);
    assert.ok(requests < 30);
});

test('hung History page times out with a typed failure', async () => {
    const started = Date.now();
    await assert.rejects(
        collectEpicPurchaseHistoryPages(() => new Promise(() => {}), { requestTimeoutMs: 25, maxRetries: 0, pageDelayMs: 0 }),
        { code: 'EPIC_HISTORY_REQUEST_TIMEOUT' }
    );
    assert.ok(Date.now() - started < 250);
});

test('History resumes from a durable page checkpoint without refetching prior pages', async () => {
    const requested = [];
    const checkpoints = [];
    const orders = await collectEpicPurchaseHistoryPages(async (token, page) => {
        requested.push({ token, page });
        return { orders: [{ id: 'new-order' }], nextPageToken: '' };
    }, {
        initialCheckpoint: {
            pagesFetched: 2,
            lastSuccessfulPage: 1,
            nextPageToken: 'cursor-2',
            orders: [{ id: 'old-order' }],
        },
        onCheckpoint: async (checkpoint) => checkpoints.push(checkpoint),
        pageDelayMs: 0,
    });
    assert.deepEqual(requested, [{ token: 'cursor-2', page: 2 }]);
    assert.deepEqual(orders.map((order) => order.id), ['old-order', 'new-order']);
    assert.equal(checkpoints[0].pagesFetched, 3);
});

test('a new run aborts the old 622-item job instead of draining its queue', async (t) => {
    let requests = 0;
    const coordinator = new EpicProgressiveSyncCoordinator({
        store: { read: async () => ({}), write: async () => {} },
        isAccountActive: async () => true,
    });
    t.after(() => coordinator.shutdown());
    const first = await coordinator.beginAccount({ accountId: 'a', syncRunId: 'old', options: { currentPrices: true } });
    await coordinator.markLibraryCommitted({ accountId: 'a', syncRunId: 'old', revision: first.revision, gamesFetched: 622 });
    const background = coordinator.startOptionalPhases({
        accountId: 'a', syncRunId: 'old', revision: first.revision,
        pricesTask: async ({ signal }) => {
            const service = new EpicPriceEnrichmentService({
                fetchEntry: async () => { requests += 1; await delay(3); return { priceStatus: 'priced', resolutionSource: 'offer_id' }; },
                concurrency: 3, maxRetries: 0,
            });
            return service.process(makeEntries(), { signal, onBatch: async () => {} });
        },
    });
    await delay(15);
    await coordinator.beginAccount({ accountId: 'a', syncRunId: 'new', options: { currentPrices: false } });
    await background;
    assert.ok(requests < 40, `old-run requests=${requests}`);
});

test('account-scoped Vault transactions preserve prices and History in both commit orders', async (t) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baddel-vault-race-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const repository = new PlatformSyncCacheRepository({ userDataDir: dir });
    await repository.mergeEpicVaultAccount({ accountId: 'a', games: [{ id: 'g' }], permissions: {} });
    for (const order of ['prices-first', 'history-first']) {
        const prices = () => repository.mergeEpicVaultAccountPhase({ accountId: 'a', phase: 'prices', patch: { livePrices: [{ id: order }], games: [{ id: 'g', priceStatus: 'priced' }], permissions: { currentPrices: true } } });
        const history = () => repository.mergeEpicVaultAccountPhase({ accountId: 'a', phase: 'purchaseHistory', patch: { purchaseHistoryItems: [{ orderId: order }], netSpentMinor: 500, permissions: { purchaseHistory: true } } });
        if (order === 'prices-first') await Promise.all([prices(), delay(1).then(history)]);
        else await Promise.all([history(), delay(1).then(prices)]);
        const account = (await repository.readEpicVault()).accounts[0];
        assert.equal(account.livePrices[0].id, order);
        assert.equal(account.purchaseHistoryItems[0].orderId, order);
        assert.equal(account.permissions.currentPrices, true);
        assert.equal(account.permissions.purchaseHistory, true);
    }
});

test('scheduler allows two phases per account and honors per-account and global budgets', async () => {
    const scheduler = new EpicEnrichmentScheduler({ globalConcurrency: 3, perAccountConcurrency: 2 });
    let releaseGate;
    const releasePromise = new Promise((resolve) => { releaseGate = resolve; });
    let active = 0;
    let maxActive = 0;
    const perAccount = new Map();
    let maxForA = 0;
    const task = (accountId, phase) => scheduler.schedule({ accountId, revision: 1, phase, task: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        perAccount.set(accountId, Number(perAccount.get(accountId) || 0) + 1);
        if (accountId === 'a') maxForA = Math.max(maxForA, perAccount.get(accountId));
        await releasePromise;
        perAccount.set(accountId, perAccount.get(accountId) - 1);
        active -= 1;
    } });
    const jobs = [task('a', 'prices'), task('a', 'purchaseHistory'), task('b', 'prices'), task('c', 'prices')];
    await delay(10);
    assert.equal(maxForA, 2, 'both phases for account A should enter running before release');
    assert.ok(maxActive <= 3);
    assert.ok([...perAccount.values()].every((count) => count <= 2));
    releaseGate();
    await Promise.all(jobs);
    scheduler.shutdown();
});
