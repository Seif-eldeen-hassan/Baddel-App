'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { DownloadFileSafetyService } = require('../src/features/downloads/infrastructure/services/DownloadFileSafetyService');
const { DownloadManagedGameUninstallService } = require('../src/features/downloads/infrastructure/services/DownloadManagedGameUninstallService');

function makeFixture({ running = false } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-uninstall-'));
    const installPath = path.join(root, 'Sanitarium');
    const savesPath = path.join(root, 'Sanitarium Saves');
    fs.mkdirSync(savesPath);
    fs.writeFileSync(path.join(savesPath, 'save.dat'), 'keep');
    const fileSafety = new DownloadFileSafetyService({ protectedRoots: [], nonceFactory: () => 'owned-nonce' });
    const baseTask = {
        id: 'dl_sanitarium_owned', identityKey: 'gog|acct|1207659026',
        platform: 'gog', accountId: 'acct', providerProductId: '1207659026',
        installRoot: root, installPath, title: 'Sanitarium',
    };
    const ownership = fileSafety.prepareInitialTaskOwnership(baseTask);
    fs.mkdirSync(path.join(installPath, 'ScummVM'));
    fs.writeFileSync(path.join(installPath, 'ScummVM', 'scummvm.exe'), 'binary');
    const task = {
        ...baseTask, ...ownership, status: 'completed', uninstallEligible: true,
        installedGameId: 'gog_1207659026',
        resolvedExecutablePath: path.join(installPath, 'ScummVM', 'scummvm.exe'),
    };
    const game = {
        id: task.installedGameId, name: task.title, platform: 'gog',
        installSource: 'download', installPath, executablePath: task.resolvedExecutablePath,
    };
    let removeCalls = 0;
    let libraryEvents = 0;
    const games = [game];
    const gamesApi = {
        getAllGames: () => games,
        getSavedGames: () => games.filter(item => !item.hidden),
        async removeGame(id) {
            removeCalls += 1;
            const found = games.find(item => item.id === id);
            if (found) found.hidden = true;
            return { status: found ? 'success' : 'error' };
        },
        async flushDatabase() {},
    };
    const service = new DownloadManagedGameUninstallService({
        fileSafety, gamesApi,
        isGameRunning: async () => running,
        notifyLibraryUpdated: async () => { libraryEvents += 1; },
    });
    return { root, installPath, savesPath, fileSafety, task, game, service, get removeCalls() { return removeCalls; }, get libraryEvents() { return libraryEvents; } };
}

test('managed uninstall removes only the exact Baddel-owned game folder and updates Library', async () => {
    const fixture = makeFixture();
    try {
        assert.equal(fixture.service.isEligible(fixture.task), true);
        const result = await fixture.service.uninstall(fixture.task);
        assert.equal(result.deleted, true);
        assert.equal(fs.existsSync(fixture.installPath), false);
        assert.equal(fs.existsSync(path.join(fixture.savesPath, 'save.dat')), true);
        assert.equal(fixture.removeCalls, 1);
        assert.equal(fixture.libraryEvents, 1);
        assert.equal(fixture.game.hidden, true);
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
});

test('managed uninstall refuses a running game without deleting files or Library record', async () => {
    const fixture = makeFixture({ running: true });
    try {
        await assert.rejects(() => fixture.service.uninstall(fixture.task), err => err.code === 'DOWNLOAD_UNINSTALL_GAME_RUNNING');
        assert.equal(fs.existsSync(fixture.installPath), true);
        assert.equal(fixture.removeCalls, 0);
        assert.equal(fixture.game.hidden, undefined);
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
});

test('managed uninstall rejects drive roots and missing ownership markers', async () => {
    const fixture = makeFixture();
    try {
        fs.unlinkSync(fixture.task.partialDeletionMarkerPath);
        assert.equal(fixture.service.isEligible(fixture.task), false);
        await assert.rejects(() => fixture.service.uninstall(fixture.task), err => err.code === 'DOWNLOAD_UNINSTALL_UNSAFE');
        assert.equal(fs.existsSync(fixture.installPath), true);
        assert.equal(fixture.removeCalls, 0);

        const driveRoot = path.parse(fixture.installPath).root;
        const rootTask = { ...fixture.task, installPath: driveRoot, partialDeletionMarkerPath: path.join(driveRoot, '.baddel-download-partial.json') };
        const rootGame = { ...fixture.game, installPath: driveRoot };
        const rootService = new DownloadManagedGameUninstallService({
            fileSafety: fixture.fileSafety,
            gamesApi: { getAllGames: () => [rootGame], removeGame: async () => ({ status: 'success' }) },
        });
        await assert.rejects(() => rootService.uninstall(rootTask), err => err.code === 'DOWNLOAD_UNINSTALL_UNSAFE');
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
});

test('completed card source exposes Uninstall only for managed eligible tasks', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src/js/downloads.js'), 'utf8');
    assert.doesNotMatch(source, /Delete Partial|downloadsDeletePartial/);
    assert.match(source, /task.status === 'completed' \? dlCompletedMenu/);
    assert.match(source, /const uninstallable = task\.uninstallEligible === true && task\.installPath && task\.installedGameId/);
    assert.match(source, /\(uninstallable \? item\('Uninstall', 'uninstall'\) : ''\)/);
    assert.match(source, /const message = .*task\.title.*task\.installPath/);
});
