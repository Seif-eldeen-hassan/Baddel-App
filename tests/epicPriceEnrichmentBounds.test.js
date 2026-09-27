'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EpicPriceEnrichmentService } = require('../src/features/sync/application/services/EpicPriceEnrichmentService');

test('Epic Retry-After is capped before sleeping', async () => {
    const sleeps = [];
    let calls = 0;
    const service = new EpicPriceEnrichmentService({
        fetchEntry: async () => {
            calls += 1;
            return calls === 1
                ? { priceStatus: 'unresolved', resolutionSource: 'rate_limited', retryAfterMs: 60 * 60 * 1000 }
                : { priceStatus: 'free', resolutionSource: 'offer_id' };
        },
        concurrency: 1, maxRetries: 1, maxRetryAfterMs: 1250, baseBackoffMs: 10,
        jitter: () => 0, sleepFn: async (ms) => { sleeps.push(ms); },
    });
    const result = await service.process([{ id: 'game' }], { pricingCountry: 'EG' });
    assert.equal(result.progress.resolved, 1);
    assert.deepEqual(sleeps, [1250]);
});

test('622-game progress and commits remain batched', async () => {
    let progressEvents = 0;
    let commits = 0;
    let clock = 0;
    const service = new EpicPriceEnrichmentService({
        fetchEntry: async (entry) => ({ ...entry, priceStatus: 'free', resolutionSource: 'offer_id' }),
        concurrency: 2, batchSize: 100, maxRetries: 0, progressEveryItems: 10, progressIntervalMs: 500,
        // A slow provider must not turn the time threshold into one event per result.
        nowMs: () => { clock += 600; return clock; },
    });
    const result = await service.process(Array.from({ length: 622 }, (_, id) => ({ id })), {
        pricingCountry: 'EG',
        onProgress: async () => { progressEvents += 1; },
        onBatch: async () => { commits += 1; },
    });
    assert.equal(result.progress.processed, 622);
    assert.equal(result.progress.resolved, 622);
    assert.equal(commits, 7);
    assert.ok(progressEvents <= 72, `expected bounded progress events, got ${progressEvents}`);
});
