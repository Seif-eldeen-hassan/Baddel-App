'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { normalizeAccountSaveName, createAccountSaveHandler } = require('../services/accountSaveContract');

const root = path.resolve(__dirname, '..');

test('account save contract accepts and preserves a valid name', async () => {
    let received;
    const handler = createAccountSaveHandler(async name => { received = name; return { status: 'success', name }; });
    const result = await handler({}, { accountName: '  gg  ' });
    assert.equal(received, 'gg');
    assert.deepEqual(result, { status: 'success', name: 'gg' });
});

test('account save contract rejects empty and whitespace-only names', async () => {
    for (const accountName of ['', '   \t\r\n']) {
        await assert.rejects(() => createAccountSaveHandler(async () => {})({}, { accountName }), { code: 'ACCOUNT_NAME_REQUIRED' });
    }
});

test('every platform Save Current adapter receives the same validated name', async () => {
    const received = [];
    for (const platform of ['epic', 'gog', 'ea', 'riot', 'ubisoft', 'discord', 'rockstar']) {
        const handler = createAccountSaveHandler(async name => received.push({ platform, name }));
        await handler({}, { accountName: '  Shared Name  ' });
    }
    assert.deepEqual(received, ['epic', 'gog', 'ea', 'riot', 'ubisoft', 'discord', 'rockstar'].map(platform => ({ platform, name: 'Shared Name' })));
});

test('source preload carries accountName in an explicit payload through IPC', () => {
    const result = spawnSync(process.execPath, [path.join(root, 'tests', 'fixtures', 'executeProtectedPreload.js'), path.join(root, 'preload.js')], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.saveInvokes.length, 7);
    for (const invoke of payload.saveInvokes) assert.deepEqual(invoke[1], { accountName: 'boundary-name' });
});

test('real Electron Save Current flow preserves gg and resets processing on success and failure', { timeout: 35000 }, () => {
    const electron = require('electron');
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(electron, [path.join(root, 'tests', 'fixtures', 'accountSaveBoundaryElectron.js')], { cwd: root, env, encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const line = result.stdout.split(/\r?\n/).find(value => value.startsWith('ACCOUNT_SAVE_BOUNDARY_RESULT='));
    assert.ok(line, result.stdout);
    const payload = JSON.parse(line.slice('ACCOUNT_SAVE_BOUNDARY_RESULT='.length));
    assert.deepEqual(payload.success.mainCalls, [{ boundary: 'main-service', name: 'gg', type: 'string' }]);
    assert.deepEqual(payload.success.calls[0], { boundary: 'reload', platform: 'gog' });
    assert.equal(payload.success.processing, false);
    assert.match(payload.success.toasts.at(-1).message, /gg saved!/);
    assert.equal(payload.failure.processing, false);
    assert.match(payload.failure.toasts.at(-1).message, /fixture persistence failed/);
    assert.equal(payload.openFailure.processing, false);
    assert.deepEqual(payload.openFailure.toasts.at(-1), { message: 'GOG Galaxy could not be opened.', type: 'error' });
});

test('legacy string IPC payload remains compatible during upgrades', () => {
    assert.equal(normalizeAccountSaveName(' legacy '), 'legacy');
});
