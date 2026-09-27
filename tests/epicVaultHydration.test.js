'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    EpicVaultHydrationService,
} = require('../src/features/sync/application/services/EpicVaultHydrationService');
const client = require('../src/js/vault-hydration-client');

function service(readSnapshot, options = {}) {
    return new EpicVaultHydrationService({
        readSnapshot,
        userDataPath: 'C:\\profile-a',
        snapshotPath: 'C:\\profile-a\\platform-sync\\epic_vault.json',
        timeoutMs: 60,
        ...options,
    });
}

test('saved snapshot hydration returns account data and boundary diagnostics', async () => {
    const result = await service(async () => ({
        vault: { accounts: [{ accountId: 'a', games: Array.from({ length: 606 }) }] },
        stages: [{ name: 'repository.readEpicVault', status: 'success', durationMs: 2 }],
    })).handle();
    assert.equal(result.status, 'success');
    assert.equal(result.vault.accounts[0].games.length, 606);
    assert.equal(result.diagnostics.userDataPath, 'C:\\profile-a');
    assert.equal(result.diagnostics.outcome, 'success');
});

test('missing saved snapshot settles as a real empty state', async () => {
    const result = await service(async () => ({ vault: { accounts: [] }, stages: [] })).handle();
    assert.equal(result.status, 'success');
    assert.equal(result.diagnostics.outcome, 'empty');
});

test('repository failure returns a typed retryable IPC result', async () => {
    const error = new Error('read denied');
    error.code = 'EACCES';
    const result = await service(async () => { throw error; }).handle();
    assert.equal(result.status, 'error');
    assert.equal(result.code, 'EACCES');
});

test('repository request that never settles exits through the main deadline', async () => {
    const result = await service(() => new Promise(() => {})).handle();
    assert.equal(result.status, 'error');
    assert.equal(result.code, 'VAULT_MAIN_TIMEOUT');
});

test('renderer rejects missing preload handler and IPC rejection with distinct codes', async () => {
    await assert.rejects(() => client.requestSnapshot({}, { timeoutMs: 50 }), { code: 'VAULT_PRELOAD_API_MISSING' });
    await assert.rejects(() => client.requestSnapshot({ platformSyncGetEpicVault: async () => { throw new Error('No handler registered'); } }, { timeoutMs: 50 }), { code: 'VAULT_IPC_REJECTED' });
});

test('renderer request that never settles exits through its own deadline', async () => {
    await assert.rejects(() => client.requestSnapshot({ platformSyncGetEpicVault: () => new Promise(() => {}) }, { timeoutMs: 50 }), { code: 'VAULT_RENDERER_TIMEOUT' });
});

test('renderer detects a different userData response before accepting its snapshot', async () => {
    const api = { platformSyncGetEpicVault: async () => ({ status: 'success', vault: { accounts: [] }, diagnostics: { userDataPath: 'D:\\other-profile' } }) };
    await assert.rejects(() => client.requestSnapshot(api, { expectedUserDataPath: 'C:\\profile-a', timeoutMs: 50 }), { code: 'VAULT_USER_DATA_MISMATCH' });
});

test('optional progress cannot block a successful saved snapshot', async () => {
    const api = {
        platformSyncGetEpicVault: async () => ({ status: 'success', vault: { accounts: [{ accountId: 'a', games: [] }] }, diagnostics: { userDataPath: 'C:\\profile-a' } }),
        platformSyncGetEpicProgressState: () => new Promise(() => {}),
    };
    const snapshot = await client.requestSnapshot(api, { timeoutMs: 50 });
    const progress = await client.requestProgress(api, { timeoutMs: 50 });
    assert.equal(snapshot.vault.accounts.length, 1);
    assert.equal(progress.status, 'unavailable');
    assert.equal(progress.code, 'VAULT_PROGRESS_TIMEOUT');
});
