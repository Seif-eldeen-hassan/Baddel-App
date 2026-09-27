'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DAY_MS, isEpicPriceRefreshDue, EpicPriceRefreshScheduler } = require('../src/features/sync/application/services/EpicPriceRefreshScheduler');

test('Epic price refresh becomes due only after 24 hours', () => {
    const now = Date.parse('2026-09-08T12:00:00.000Z');
    assert.equal(isEpicPriceRefreshDue(null, now), true);
    assert.equal(isEpicPriceRefreshDue(new Date(now - DAY_MS + 1).toISOString(), now), false);
    assert.equal(isEpicPriceRefreshDue(new Date(now - DAY_MS).toISOString(), now), true);
});

test('scheduled refresh selects only due non-empty Epic accounts', async () => {
    const now = Date.parse('2026-09-08T12:00:00.000Z');
    const refreshed = [];
    const scheduler = new EpicPriceRefreshScheduler({
        nowMs: () => now,
        listAccounts: async () => [
            { accountId: 'egypt', totalGames: 606, pricesFetchedAt: new Date(now - DAY_MS).toISOString() },
            { accountId: 'recent', totalGames: 100, pricesFetchedAt: new Date(now - 60_000).toISOString() },
            { accountId: 'empty', totalGames: 0, pricesFetchedAt: null },
        ],
        refreshAccount: async (accountId, options) => {
            refreshed.push({ accountId, options });
            return { status: 'success' };
        },
        logger: { warn() {} },
    });
    const result = await scheduler.tick();
    assert.equal(result.checked, 3);
    assert.equal(result.due, 1);
    assert.deepEqual(refreshed, [{ accountId: 'egypt', options: { source: 'automatic' } }]);
});

test('scheduled checks are deduplicated while active', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let listCalls = 0;
    const scheduler = new EpicPriceRefreshScheduler({
        listAccounts: async () => { listCalls += 1; await gate; return []; },
        refreshAccount: async () => ({ status: 'success' }),
        logger: { warn() {} },
    });
    const first = scheduler.tick();
    const second = scheduler.tick();
    release();
    assert.deepEqual(await first, await second);
    assert.equal(listCalls, 1);
});


test('failed automatic refresh uses bounded backoff without changing success freshness', async () => {
    let now = Date.parse('2026-09-08T12:00:00.000Z');
    let calls = 0;
    const account = { accountId: 'due', totalGames: 606, pricesFetchedAt: null };
    const scheduler = new EpicPriceRefreshScheduler({
        nowMs: () => now, listAccounts: async () => [account],
        refreshAccount: async () => { calls += 1; throw Object.assign(new Error('offline'), { code: 'NETWORK' }); },
        failureBackoffBaseMs: 1000, failureBackoffMaxMs: 4000, logger: { warn() {} },
    });
    await scheduler.tick();
    assert.equal(calls, 1);
    assert.equal(account.pricesFetchedAt, null);
    assert.deepEqual(scheduler.getRuntimeState('due'), { attempts: 1, lastAttemptAt: now, nextRetryAt: now + 1000, code: 'NETWORK' });
    now += 999;
    assert.equal((await scheduler.tick()).due, 0);
    assert.equal(calls, 1);
    now += 1;
    await scheduler.tick();
    assert.equal(calls, 2);
    assert.equal(scheduler.getRuntimeState('due').nextRetryAt, now + 2000);
});

test('successful refresh clears backoff and persisted timestamp remains authoritative', async () => {
    let now = Date.parse('2026-09-08T12:00:00.000Z');
    let fail = true;
    const account = { accountId: 'due', totalGames: 100, pricesFetchedAt: null };
    const scheduler = new EpicPriceRefreshScheduler({
        nowMs: () => now, listAccounts: async () => [account],
        refreshAccount: async () => {
            if (fail) throw new Error('temporary');
            account.pricesFetchedAt = new Date(now).toISOString();
            return { status: 'success', pricesFetchedAt: account.pricesFetchedAt };
        },
        failureBackoffBaseMs: 1000, logger: { warn() {} },
    });
    await scheduler.tick();
    now += 1000; fail = false;
    await scheduler.tick();
    assert.equal(scheduler.getRuntimeState('due'), null);
    now += DAY_MS - 1;
    assert.equal((await scheduler.tick()).due, 0);
    now += 1;
    assert.equal((await scheduler.tick()).due, 1);
});
