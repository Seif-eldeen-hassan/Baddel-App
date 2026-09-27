'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JsonGameRepository } = require('../src/features/games/infrastructure/repositories/JsonGameRepository');
const { DownloadManagedGameUninstallService } = require('../src/features/downloads/infrastructure/services/DownloadManagedGameUninstallService');
const { DownloadQueueManager } = require('../src/features/downloads/infrastructure/services/DownloadQueueManager');
test('managed uninstall removes installed identity rather than hiding it, retaining external caches', async () => {
    const repo = Object.create(JsonGameRepository.prototype);
    const game = { id: 'epic_game', platform: 'epic', installSource: 'download', installPath: 'D:\\Games\\EP3', isInstalled: true };
    repo._dbCache = [game]; let saves = 0; repo.saveDatabase = () => saves++;
    const events = []; const externalCache = new Map([['epic_game', 'keep artwork and settings']]);
    const service = new DownloadManagedGameUninstallService({
        fileSafety: { deleteManagedInstall: () => ({ deleted: true }), assertManagedOwnershipProof() {} },
        gamesApi: { getAllGames: () => repo.getAllGames(), getSavedGames: () => repo.getStoredGames(), removeGame: id => repo.removeGame(id), getJsonGameRepository: () => repo, saveDatabase: () => repo.saveDatabase(), flushDatabase: async () => {} },
        notifyLibraryUpdated: games => events.push(games),
    });
    await service.uninstall({ status: 'completed', uninstallEligible: true, installedGameId: game.id, platform: 'epic', installPath: game.installPath });
    assert.equal(repo.getAllGames().length, 0, 'no hidden installed identity can block reinstallation or be restored');
    assert.equal(events[0].length, 0); assert.equal(saves, 1); assert.equal(externalCache.size, 1);
});
test('uninstall removes task by ID even if another entry disappears while awaiting file/library work', async () => {
    const manager = Object.create(DownloadQueueManager.prototype);
    let release; const wait = new Promise(resolve => { release = resolve; });
    Object.assign(manager, { state: { tasks: [{ id: 'other' }, { id: 'uninstall-me' }] }, ensureLoaded: async () => {}, managedUninstallService: { uninstall: async () => { await wait; return { deleted: true }; } }, persistAndEmit: async () => ({ tasks: manager.state.tasks }) });
    const uninstall = manager.uninstall('uninstall-me');
    await new Promise(resolve => setImmediate(resolve));
    manager.state.tasks.shift(); release();
    const result = await uninstall;
    assert.equal(result.tasks.length, 0);
});
test('failed managed deletion preserves the completed queue record', async () => {
    const manager = Object.create(DownloadQueueManager.prototype);
    Object.assign(manager, { state: { tasks: [{ id: 'keep' }] }, ensureLoaded: async () => {}, managedUninstallService: { uninstall: async () => { throw Error('unsafe'); } }, persistAndEmit: async () => { throw Error('must not persist deletion'); } });
    await assert.rejects(manager.uninstall('keep'), /unsafe/);
    assert.equal(manager.state.tasks[0].id, 'keep');
});
