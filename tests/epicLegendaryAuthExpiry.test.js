'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const { EpicLegendaryAccountResolver, configDirectory } = require('../src/features/downloads/infrastructure/providers/epic/EpicLegendaryAccountResolver');
const { EpicLegendaryRuntimeService, redactLegendaryText } = require('../src/features/downloads/infrastructure/providers/epic/EpicLegendaryRuntimeService');

test('expired access and refresh credentials show Reconnect without selecting another owner', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-epic-expiry-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const accounts = [{ id: 'owner-a' }, { id: 'owner-b' }];
    for (const { id } of accounts) {
        const config = configDirectory(root, id);
        fs.mkdirSync(config, { recursive: true });
        fs.writeFileSync(path.join(config, 'user.json'), JSON.stringify({
            account_id: id, access_token: 'private-access', refresh_token: 'private-refresh',
            expires_at: '2000-01-01T00:00:00Z',
            refresh_expires_at: id === 'owner-a' ? '2000-01-01T00:00:00Z' : '2100-01-01T00:00:00Z',
        }));
    }
    const resolver = new EpicLegendaryAccountResolver({ userDataDir: root, epicConnector: {
        getAccounts: () => accounts,
        getCachedLibrary: async () => [{ appName: 'App', ownedByAccountIds: accounts.map(account => account.id) }],
    } });
    const options = await resolver.resolveOptions({ appName: 'App' });
    assert.equal(options[0].actionStatus, 'reconnect');
    assert.equal(options[0].enabled, false);
    assert.equal(options[1].enabled, true);
    await assert.rejects(resolver.validateTask({ accountId: 'owner-a', appName: 'App' }), error => error.code === 'EPIC_AUTH_REQUIRED');
    assert.doesNotMatch(JSON.stringify(options), /private-access|private-refresh/);
});

test('canonical account configuration rejects synthetic identities and path traversal', () => {
    for (const id of ['ghost-owner', 'tmp-owner', 'temp-owner', '../other', 'a/../../other', 'a\\..\\other', '', 'owner:alt']) {
        assert.throws(() => configDirectory(path.resolve('data'), id), error => error.code === 'EPIC_ACCOUNT_ID_INVALID');
    }
});

test('Legendary launch returns on process exit instead of waiting for game-inherited pipes', async () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    const runtime = new EpicLegendaryRuntimeService();
    runtime.createProcess = () => child;
    const running = runtime.run(['launch', 'App'], path.resolve('config'));
    child.stderr.emit('data', 'Launching App with access_token=private-launch-token');
    child.emit('exit', 0, null);
    const result = await running;
    assert.deepEqual(result, { code: 0, signal: null });
});

test('safe text redacts quoted JSON credentials and bearer authorization', () => {
    const source = '{"access_token": "private-a", "refresh_token":"private-r", "authorization_code":"private-c"} Authorization: Bearer private-b';
    assert.doesNotMatch(redactLegendaryText(source), /private-[arcb]/);
});
