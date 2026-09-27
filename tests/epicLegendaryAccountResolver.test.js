'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EpicLegendaryAccountResolver, configDirectory, findEpicLibraryGame } = require('../src/features/downloads/infrastructure/providers/epic/EpicLegendaryAccountResolver');

function setup() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-epic-account-'));
    const accounts = [
        { id: 'owner-a', displayName: 'Owner A', status: 'synced', credentialStatus: 'ok' },
        { id: 'owner-b', displayName: 'Owner B', status: 'synced', credentialStatus: 'ok' },
        { id: 'other', displayName: 'Other', status: 'synced', credentialStatus: 'ok' },
    ];
    for (const account of accounts) {
        const config = configDirectory(dir, account.id);
        fs.mkdirSync(config, { recursive: true });
        fs.writeFileSync(path.join(config, 'user.json'), JSON.stringify({ account_id: account.id, refresh_token: `secret-${account.id}` }));
    }
    const library = [{ title: 'Test Game', appName: 'TestApp', namespace: 'ns', catalogItemId: 'cat', ownedByAccountIds: ['owner-a', 'owner-b'] }];
    return { dir, accounts, library, resolver: new EpicLegendaryAccountResolver({ userDataDir: dir, epicConnector: { getAccounts: () => accounts, getCachedLibrary: async () => library } }) };
}

test('direct Epic options enable synced owners even without Switcher membership', async t => {
    const ctx = setup(); t.after(() => fs.rmSync(ctx.dir, { recursive: true, force: true }));
    const options = await ctx.resolver.resolveOptions({ appName: 'TestApp' });
    assert.deepEqual(options.filter(option => option.enabled).map(option => option.id), ['owner-a', 'owner-b']);
    assert.equal(options.find(option => option.id === 'other').actionStatus, 'does_not_own');
    assert.equal(options.some(option => option.id.startsWith('ghost-')), false);
});

test('expired selected account is rejected without falling back to another owner', async t => {
    const ctx = setup(); t.after(() => fs.rmSync(ctx.dir, { recursive: true, force: true }));
    fs.rmSync(path.join(configDirectory(ctx.dir, 'owner-a'), 'user.json'));
    await assert.rejects(() => ctx.resolver.validateTask({ accountId: 'owner-a', appName: 'TestApp' }), error => error.code === 'EPIC_AUTH_REQUIRED');
    assert.equal((await ctx.resolver.validateTask({ accountId: 'owner-b', appName: 'TestApp' })).account.id, 'owner-b');
});

test('stable Epic identity conflicts prevent title-only ownership matches', () => {
    const library = [{ title: 'Same Title', appName: 'RealApp', catalogItemId: 'real-cat', ownedByAccountIds: ['a'] }];
    assert.equal(findEpicLibraryGame(library, { title: 'Same Title', appName: 'WrongApp', catalogItemId: 'wrong-cat' }), null);
});

test('queue resolution snapshots canonical account and authoritative Epic identity', async t => {
    const ctx = setup(); t.after(() => fs.rmSync(ctx.dir, { recursive: true, force: true }));
    const task = await ctx.resolver.resolveForQueue({ accountId: 'owner-a', title: 'Test Game', appName: 'TestApp' });
    assert.equal(task.accountId, 'owner-a');
    assert.equal(task.installProvider, 'legendary');
    assert.equal(task.providerAppName, 'TestApp');
    assert.deepEqual(task.ownedByAccountIds, ['owner-a', 'owner-b']);
    assert.equal(JSON.stringify(task).includes('secret-owner-a'), false);
});

test('fresh exact Epic sync is immediately valid for maintenance without restart', async t => {
    const ctx = setup(); t.after(() => fs.rmSync(ctx.dir, { recursive: true, force: true }));
    const result = await ctx.resolver.reconcileMaintenanceTask({
        accountId: 'owner-a', title: 'Test Game', providerAppName: 'TestApp',
        namespace: 'ns', catalogItemId: 'cat', ownedByAccountIds: ['owner-a'],
    });
    assert.equal(result.resolved.account.id, 'owner-a');
    assert.equal(result.task.providerAppName, 'TestApp');
    assert.equal(result.task.ownershipVerified, true);
});

test('stale Epic app name is reconciled only from matching catalog and namespace', async t => {
    const ctx = setup(); t.after(() => fs.rmSync(ctx.dir, { recursive: true, force: true }));
    const result = await ctx.resolver.reconcileMaintenanceTask({
        accountId: 'owner-a', title: 'Test Game', providerAppName: 'OldApp',
        namespace: 'ns', catalogItemId: 'cat', ownedByAccountIds: ['owner-a'],
    });
    assert.equal(result.task.providerAppName, 'TestApp');
    assert.equal(result.task.catalogItemId, 'cat');
    assert.equal(result.task.accountId, 'owner-a');
});

test('missing Epic library identity asks for targeted sync', async t => {
    const ctx = setup(); t.after(() => fs.rmSync(ctx.dir, { recursive: true, force: true }));
    ctx.library.splice(0);
    await assert.rejects(
        () => ctx.resolver.validateTask({ accountId: 'owner-a', appName: 'TestApp' }),
        error => error.code === 'EPIC_LIBRARY_IDENTITY_MISSING' && /Sync this Epic account/.test(error.message)
    );
});

test('Epic ownership is never rebound to a different account with the same display metadata', async t => {
    const ctx = setup(); t.after(() => fs.rmSync(ctx.dir, { recursive: true, force: true }));
    ctx.library[0].ownedByAccountIds = ['owner-b'];
    await assert.rejects(
        () => ctx.resolver.reconcileMaintenanceTask({ accountId: 'owner-a', title: 'Test Game', namespace: 'ns', catalogItemId: 'cat' }),
        error => error.code === 'EPIC_GAME_NOT_OWNED'
    );
});
