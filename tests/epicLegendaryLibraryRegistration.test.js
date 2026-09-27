'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DownloadCompletionLibraryRegistrar } = require('../src/features/downloads/infrastructure/services/DownloadCompletionLibraryRegistrar');

test('Legendary completion persists one central Epic installation with account and provider metadata', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-epic-register-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const exe = path.join(dir, 'Game.exe'); fs.writeFileSync(exe, Buffer.alloc(32));
    const games = [];
    const gamesApi = {
        getAllGames: () => games,
        getSavedGames: () => games,
        async upsertGame(game) { const index = games.findIndex(item => item.id === game.id); if (index < 0) games.push(game); else games[index] = game; },
        saveDatabase() {}, async flushDatabase() {},
    };
    const registrar = new DownloadCompletionLibraryRegistrar({ gamesApi });
    const task = {
        id: 'dl_0123456789abcdef', gameId: 'epic-TestApp', canonicalGameId: 'epic-TestApp', title: 'Test Game', platform: 'epic',
        installProvider: 'legendary', accountId: 'owner-a', appName: 'TestApp', providerAppName: 'TestApp', namespace: 'ns', catalogItemId: 'cat',
        ownedByAccountIds: ['owner-a', 'owner-b'], installPath: dir,
    };
    const receipt = { buildId: 'build-9', verification: { executablePath: exe } };
    const first = await registrar.registerCompletedDownload(task, receipt);
    const second = await registrar.registerCompletedDownload({ ...task, accountId: 'owner-b' }, receipt);
    assert.equal(games.length, 1);
    assert.equal(first.installedGameId, second.installedGameId);
    assert.equal(games[0].platform, 'epic');
    assert.equal(games[0].installProvider, 'legendary');
    assert.equal(games[0].appName, 'TestApp');
    assert.equal(games[0].installedByAccountId, 'owner-a');
    assert.deepEqual(games[0].ownedByAccountIds, ['owner-a', 'owner-b']);
    assert.equal(games[0].buildId, 'build-9');
});
