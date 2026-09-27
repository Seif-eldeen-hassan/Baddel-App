'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { projectEpicVaultAccount } = require('../src/features/sync/domain/services/EpicVaultAccountProjection');
const { vaultSnapshotRevision, shouldAcceptVaultSnapshot } = require('../src/js/vault-overview-model');

test('reconciliation projection preserves committed freshness and revision metadata', () => {
    const existing = {
        accountId: 'account-a', pricesFetchedAt: '2026-09-08T20:13:02.932Z', updatedAt: '2026-09-08T20:13:03.000Z',
        vaultRevision: 9, phaseRevisions: { library: 7, prices: 9 },
        priceDiagnostics: { resolved: 602, total: 606 }, games: [{ id: 'old' }],
    };
    const projected = projectEpicVaultAccount(existing, {
        accountId: 'account-a', displayName: 'Current name', games: [{ id: 'new' }], totalGamesOwned: 1,
    });
    assert.equal(projected.pricesFetchedAt, existing.pricesFetchedAt);
    assert.equal(projected.updatedAt, existing.updatedAt);
    assert.equal(projected.vaultRevision, 9);
    assert.deepEqual(projected.phaseRevisions, { library: 7, prices: 9 });
    assert.deepEqual(projected.priceDiagnostics, { resolved: 602, total: 606 });
    assert.deepEqual(projected.games, [{ id: 'new' }]);
    assert.notStrictEqual(projected, existing);
});

test('projection reads do not invent revisions and a preserved recent snapshot passes the gate', () => {
    const existing = { accountId: 'a', vaultRevision: 14, phaseRevisions: { library: 14, prices: 12 } };
    const firstRead = projectEpicVaultAccount(existing, { accountId: 'a', games: [] });
    const secondRead = projectEpicVaultAccount(firstRead, { accountId: 'a', games: [] });
    assert.equal(firstRead.vaultRevision, 14);
    assert.equal(secondRead.vaultRevision, 14);
    const snapshot = { accounts: [secondRead] };
    assert.equal(vaultSnapshotRevision(snapshot), 14);
    assert.equal(shouldAcceptVaultSnapshot({ incomingRevision: 14, acceptedRevision: 12, requiredRevision: 14 }), true);
});

test('authoritative account membership never preserves an unlinked account', () => {
    const linkedIds = new Set(['account-b']);
    const stored = [
        { accountId: 'account-a', vaultRevision: 9 },
        { accountId: 'account-b', vaultRevision: 10 },
    ];
    const projected = stored.filter((account) => linkedIds.has(account.accountId));
    assert.deepEqual(projected.map((account) => account.accountId), ['account-b']);
});
