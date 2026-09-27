'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs').promises;
const os = require('node:os');
const path = require('node:path');
const { PlatformSyncCacheRepository } = require('../src/features/sync/infrastructure/repositories/PlatformSyncCacheRepository');

test('pricesFetchedAt survives a library-only phase and a clean repository restart', async (t) => {
    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'baddel-epic-vault-freshness-'));
    t.after(() => fs.rm(userDataDir, { recursive: true, force: true }));
    const timestamp = '2026-09-09T01:02:03.000Z';
    const first = new PlatformSyncCacheRepository({ userDataDir });
    const priceCommit = await first.mergeEpicVaultAccountPhase({
        accountId: 'account-a', phase: 'prices',
        patch: { pricesFetchedAt: timestamp, pricingCountry: 'EG', priceDiagnostics: { resolved: 600, total: 606 } },
    });
    assert.equal(priceCommit.vaultRevision, 1);
    const libraryCommit = await first.mergeEpicVaultAccountPhase({
        accountId: 'account-a', phase: 'library',
        patch: { totalGamesOwned: 606, games: [{ namespace: 'ns', catalogItemId: 'game-a' }] },
    });
    assert.equal(libraryCommit.pricesFetchedAt, timestamp);
    assert.equal(libraryCommit.vaultRevision, 2);
    assert.deepEqual(libraryCommit.phaseRevisions, { prices: 1, library: 2 });

    const restarted = new PlatformSyncCacheRepository({ userDataDir });
    const saved = (await restarted.readEpicVault()).accounts[0];
    assert.equal(saved.pricesFetchedAt, timestamp);
    assert.equal(saved.pricingCountry, 'EG');
    assert.deepEqual(saved.priceDiagnostics, { resolved: 600, total: 606 });
    assert.equal(saved.vaultRevision, 2);
});
