'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EpicPriceEnrichmentService } = require('../src/features/sync/application/services/EpicPriceEnrichmentService');

test('two Epic accounts enrich independently with their own pricing country', async () => {
    const requests = [];
    const fetchEntry = async (entry, country) => {
        requests.push({ account: entry.account, country });
        return { priceStatus: 'priced', resolutionSource: 'offer_id', currency: country === 'EG' ? 'USD' : 'EUR' };
    };
    const service = new EpicPriceEnrichmentService({ fetchEntry, maxRetries: 0, concurrency: 1 });
    await service.process([{ account: 'egypt' }], { pricingCountry: 'EG' });
    await service.process([{ account: 'germany' }], { pricingCountry: 'DE' });
    assert.deepEqual(requests, [
        { account: 'egypt', country: 'EG' },
        { account: 'germany', country: 'DE' },
    ]);
});
