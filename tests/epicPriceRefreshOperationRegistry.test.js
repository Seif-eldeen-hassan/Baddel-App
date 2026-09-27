'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EpicPriceRefreshOperationRegistry } = require('../src/features/sync/application/services/EpicPriceRefreshOperationRegistry');

test('manual and automatic refresh join one account-scoped operation', async () => {
    const registry = new EpicPriceRefreshOperationRegistry();
    let calls = 0;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const first = registry.run('account-a', { source: 'automatic', timeoutMs: 1000 }, async () => {
        calls += 1;
        await gate;
        return { status: 'success', resolved: 622 };
    });
    const joined = registry.run('account-a', { source: 'manual', timeoutMs: 1000 }, async () => {
        calls += 1;
        return { status: 'success' };
    });
    release();
    assert.equal((await first).resolved, 622);
    assert.deepEqual(await joined, { status: 'success', resolved: 622, joined: true, activeSource: 'automatic' });
    assert.equal(calls, 1);
    assert.equal(registry.get('account-a'), null);
});

test('a request that never settles is aborted by the operation deadline and cleaned up', async () => {
    const registry = new EpicPriceRefreshOperationRegistry();
    let observedAbort = false;
    await assert.rejects(
        registry.run('account-a', { timeoutMs: 20 }, ({ signal }) => new Promise(() => {
            signal.addEventListener('abort', () => { observedAbort = true; }, { once: true });
        })),
        (error) => error.code === 'EPIC_PRICE_REFRESH_DEADLINE_EXCEEDED' && error.failedStage === 'price_refresh_deadline',
    );
    assert.equal(observedAbort, true);
    assert.equal(registry.get('account-a'), null);
    const recovered = await registry.run('account-a', { timeoutMs: 100 }, async () => ({ status: 'success' }));
    assert.equal(recovered.status, 'success');
});
