'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    EPIC_HISTORY_ERROR_CODES,
    collectEpicPurchaseHistoryPages,
} = require('../src/features/sync/application/services/EpicPurchaseHistoryRefreshService');

test('Epic Purchase History pagination awaits every page and preserves order', async () => {
    const tokens = [];
    const pages = {
        '': { orders: [{ id: 'one' }], nextPageToken: 'page-2' },
        'page-2': { elements: [{ id: 'two' }], paging: { nextPageToken: 'page-3' } },
        'page-3': { orders: [{ id: 'three' }] },
    };
    const orders = await collectEpicPurchaseHistoryPages(async (token) => {
        tokens.push(token);
        return pages[token];
    }, { pageDelayMs: 0 });
    assert.deepEqual(tokens, ['', 'page-2', 'page-3']);
    assert.deepEqual(orders.map((order) => order.id), ['one', 'two', 'three']);
});

test('invalid page shape rejects the complete refresh', async () => {
    await assert.rejects(
        collectEpicPurchaseHistoryPages(async () => ({ unexpected: [] }), { pageDelayMs: 0 }),
        { code: EPIC_HISTORY_ERROR_CODES.INVALID_RESPONSE }
    );
});

test('a remaining token at the page cap is treated as partial and rejected', async () => {
    await assert.rejects(
        collectEpicPurchaseHistoryPages(async () => ({ orders: [{ id: 'partial' }], nextPageToken: 'more' }), {
            maxPages: 2,
            pageDelayMs: 0,
        }),
        { code: EPIC_HISTORY_ERROR_CODES.INVALID_RESPONSE }
    );
});

test('an explicit empty orders page is a valid complete response', async () => {
    const orders = await collectEpicPurchaseHistoryPages(async () => ({ orders: [] }), { pageDelayMs: 0 });
    assert.deepEqual(orders, []);
});

test('progressing pagination can exceed the old fixed deadline without failing', async () => {
    let now = 0;
    const orders = await collectEpicPurchaseHistoryPages(async (_token, page) => {
        now += 80;
        return { orders: [{ id: page }], nextPageToken: page < 3 ? 'page-' + (page + 1) : '' };
    }, {
        nowMs: () => now, requestTimeoutMs: 10, progressDeadlineMs: 100,
        maxPhaseDurationMs: 1000, pageDelayMs: 0,
    });
    assert.equal(now, 320);
    assert.deepEqual(orders.map((order) => order.id), [0, 1, 2, 3]);
});

test('hard History deadline still stops pagination that keeps returning cursors', async () => {
    let now = 0;
    await assert.rejects(
        collectEpicPurchaseHistoryPages(async (_token, page) => {
            now += 120;
            return { orders: [{ id: page }], nextPageToken: 'page-' + (page + 1) };
        }, {
            nowMs: () => now, requestTimeoutMs: 10, progressDeadlineMs: 150,
            hardDeadlineAt: 250, pageDelayMs: 0, maxRetries: 0,
        }),
        { code: EPIC_HISTORY_ERROR_CODES.DEADLINE_EXCEEDED }
    );
});
