'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const platformSync = fs.readFileSync(path.join(root, 'platformSync.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const sidebar = fs.readFileSync(path.join(root, 'src/js/app/sidebar.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/css/dashboard.css'), 'utf8');

test('manual Epic price refresh has a dedicated IPC route and renderer API', () => {
    assert.match(platformSync, /platform-sync:refresh-epic-prices/);
    assert.match(preload, /platformSyncRefreshEpicPrices:[\s\S]*platform-sync:refresh-epic-prices/);
    assert.match(sidebar, /async function refreshVaultEpicPrices/);
    assert.match(sidebar, /Refresh prices/);
    assert.match(css, /\.vault-price-refresh-control/);
});

test('price refresh forces current catalog requests and remains region scoped', () => {
    assert.match(platformSync, /runEpicProgressivePricesPhase\(\{[\s\S]*forceRefresh: sourceLabel === 'manual'/);
    assert.match(platformSync, /shouldRefreshCachedEpicPrice\(cached, pricingCountry/);
    assert.match(platformSync, /const pricingCountry = legendaryCountry \|\| linkedCountry \|\| vaultCountry/);
    assert.match(platformSync, /fetchEntry: \(entry, country, options\) => fetchEpicLivePriceForEntry\(entry, country/);
});

test('price refresh never invokes Epic login or purchase history', () => {
    const start = platformSync.indexOf('async function refreshEpicPricesForAccount');
    const end = platformSync.indexOf('const epicPriceRefreshScheduler', start);
    const refreshBlock = platformSync.slice(start, end);
    assert.ok(start >= 0 && end > start);
    assert.doesNotMatch(refreshBlock, /openEpicLoginWindow|allowInteractiveLogin|refreshEpicPurchaseHistory|runEpicProgressiveHistoryPhase/);
});

test('successful completion advances pricesFetchedAt after enrichment settles', () => {
    const start = platformSync.indexOf('async function runEpicProgressivePricesPhase');
    const end = platformSync.indexOf('const _epicPriceRefreshInFlight', start);
    const phase = platformSync.slice(start, end);
    const processAt = phase.indexOf('await service.process');
    const timestampAt = phase.lastIndexOf('const pricesFetchedAt = new Date().toISOString()');
    assert.ok(processAt >= 0 && timestampAt > processAt);
    const batchEnd = phase.indexOf("await debug?.record?.('phase_progress_started'");
    const batch = phase.slice(phase.indexOf('const commitBatch'), batchEnd);
    assert.doesNotMatch(batch, /pricesFetchedAt\s*=/);
});

test('Vault displays freshness and hydrates after manual or automatic completion', () => {
    assert.match(sidebar, /Prices updated:/);
    assert.match(sidebar, /account\.pricesFetchedAt/);
    assert.match(sidebar, /reason: 'epic-prices-refreshed'/);
    assert.match(sidebar, /onEpicPriceRefreshState/);
    assert.match(sidebar, /reason: 'epic-prices-auto-refreshed'/);
});

test('automatic scheduler reads the saved 24-hour timestamp', () => {
    assert.match(platformSync, /new EpicPriceRefreshScheduler/);
    assert.match(platformSync, /pricesFetchedAt: account\.pricesFetchedAt \|\| null/);
    assert.match(platformSync, /finally\(\(\) => epicPriceRefreshScheduler\.start\(\)\)/);
});
