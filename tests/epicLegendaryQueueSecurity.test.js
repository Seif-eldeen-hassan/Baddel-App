'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JsonDownloadRepository } = require('../src/features/downloads/infrastructure/repositories/JsonDownloadRepository');
const { DownloadPreflightService } = require('../src/features/downloads/infrastructure/services/DownloadPreflightService');
const { DownloadQueueManager } = require('../src/features/downloads/infrastructure/services/DownloadQueueManager');
const { normalizeTask } = require('../src/features/downloads/domain/entities/DownloadTask');
const { redactLegendaryText } = require('../src/features/downloads/infrastructure/providers/epic/EpicLegendaryRuntimeService');

function payload(root, accountId = 'owner-a') {
    return { platform: 'epic', installProvider: 'legendary', accountId, title: 'Test Game', appName: 'TestApp', providerAppName: 'TestApp', installPath: path.join(root, 'Test Game') };
}

test('queued Legendary task keeps its original canonical account snapshot', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-epic-queue-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    let activeUiAccount = 'owner-a';
    const resolver = { resolveForQueue: async value => ({ ...value, accountId: value.accountId, accountDisplayName: value.accountId, ownershipVerified: true }) };
    const manager = new DownloadQueueManager({ repository: new JsonDownloadRepository({ userDataDir: dir }), preflight: new DownloadPreflightService(), providerExecutor: {}, autoStart: false, identityResolvers: { epic: resolver } });
    await manager.load();
    const queued = await manager.queueInstall(payload(dir, activeUiAccount));
    activeUiAccount = 'owner-b';
    assert.equal(queued.task.accountId, 'owner-a');
    assert.equal(manager.getSnapshot().tasks[0].accountId, 'owner-a');
});

test('an existing central Legendary installation blocks a duplicate download for another owner', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-epic-duplicate-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const manager = new DownloadQueueManager({
        repository: new JsonDownloadRepository({ userDataDir: dir }), preflight: new DownloadPreflightService(), providerExecutor: {}, autoStart: false,
        identityResolvers: { epic: { resolveForQueue: async value => ({ ...value, ownershipVerified: true }) } },
        completionRegistrar: { gamesApi: { getAllGames: () => [{ platform: 'epic', installProvider: 'legendary', appName: 'TestApp', isInstalled: true }] } },
    });
    await manager.load();
    await assert.rejects(() => manager.queueInstall(payload(dir, 'owner-b')), error => error.code === 'EPIC_GAME_ALREADY_INSTALLED');
});

test('Legendary secrets are neither normalized into tasks nor retained in safe process output', () => {
    const task = normalizeTask({ ...payload('D:\\Games'), id: 'dl_0123456789abcdef', access_token: 'top-secret', refresh_token: 'refresh-secret' });
    assert.equal(task.access_token, undefined);
    assert.equal(task.refresh_token, undefined);
    const safe = redactLegendaryText('access_token=top-secret refresh_token:refresh-secret cookie=private');
    assert.doesNotMatch(safe, /top-secret|refresh-secret|private/);
    assert.match(safe, /\[REDACTED\]/);
});
