'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DownloadCompletionLibraryRegistrar } = require('../src/features/downloads/infrastructure/services/DownloadCompletionLibraryRegistrar');
const { DownloadQueueManager } = require('../src/features/downloads/infrastructure/services/DownloadQueueManager');
const { DOWNLOAD_STATUSES } = require('../src/features/downloads/domain/entities/DownloadTask');

function makeInstallDir() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-download-register-'));
    const exe = path.join(root, 'Game.exe');
    fs.writeFileSync(exe, 'exe');
    return { root, exe };
}

function makeGamesApi(initial = []) {
    const games = initial.map(game => ({ ...game }));
    return {
        games,
        saved: 0,
        flushed: 0,
        getAllGames: () => games,
        getSavedGames: () => games.filter(game => game.isInstalled !== false),
        async upsertGame(game) {
            if (!game.id) game.id = `game-${games.length + 1}`;
            const index = games.findIndex(existing => existing.id === game.id || (game.installedGameKey && existing.installedGameKey === game.installedGameKey));
            if (index >= 0) games[index] = { ...games[index], ...game, id: games[index].id };
            else games.push({ ...game });
        },
        saveDatabase() { this.saved += 1; },
        async flushDatabase() { this.flushed += 1; },
    };
}

function task(root) {
    return {
        id: 'task-1',
        title: 'Nine Years of Shadows',
        platform: 'gog',
        providerProductId: '12345',
        contentSystemProductId: 'gog-content-12345',
        gogdlAppName: 'nine_years_of_shadows',
        installPath: root,
        coverUrl: 'cover.webp',
    };
}

test('completed download upserts one installed game with a launch target and emits library update', async () => {
    const { root, exe } = makeInstallDir();
    const gamesApi = makeGamesApi();
    let emitted = null;
    const registrar = new DownloadCompletionLibraryRegistrar({
        gamesApi,
        notifyLibraryUpdated: async games => { emitted = games; },
    });

    const result = await registrar.registerCompletedDownload(task(root), {
        verification: { executablePath: exe },
    });

    assert.equal(gamesApi.games.length, 1);
    assert.equal(result.installedGameId, gamesApi.games[0].id);
    assert.equal(gamesApi.games[0].isInstalled, true);
    assert.equal(gamesApi.games[0].installSource, 'download');
    assert.equal(gamesApi.games[0].executablePath, exe);
    assert.match(gamesApi.games[0].command, /Game\.exe/);
    assert.equal(gamesApi.games[0].providerProductId, '12345');
    assert.ok(gamesApi.games[0].installedGameKey);
    assert.equal(gamesApi.saved, 1);
    assert.equal(gamesApi.flushed, 1);
    assert.equal(emitted.length, 1);
});

test('completion registration is idempotent for the same provider identity', async () => {
    const { root, exe } = makeInstallDir();
    const gamesApi = makeGamesApi();
    const registrar = new DownloadCompletionLibraryRegistrar({ gamesApi });

    const first = await registrar.registerCompletedDownload(task(root), { verification: { executablePath: exe } });
    const second = await registrar.registerCompletedDownload(task(root), { verification: { executablePath: exe } });

    assert.equal(gamesApi.games.length, 1);
    assert.equal(second.installedGameId, first.installedGameId);
});

test('queue manager stores installedGameId after completion registration', async () => {
    const repository = {
        emptyState: () => ({ version: 1, tasks: [], settings: {} }),
        async readState() { return this.state || this.emptyState(); },
        async writeState(state) { this.state = JSON.parse(JSON.stringify(state)); return this.state; },
    };
    const manager = new DownloadQueueManager({
        repository,
        preflight: {},
        completionRegistrar: {
            async registerCompletedDownload() {
                return { installedGameId: 'installed-1', resolvedExecutablePath: 'E:/Games/Game.exe' };
            },
        },
    });
    await manager.load();
    manager.state.tasks.push({
        id: 'task-1',
        identityKey: 'gog:12345:E:/Games/Game',
        status: DOWNLOAD_STATUSES.DOWNLOADING,
        title: 'Game',
        platform: 'gog',
        installPath: 'E:/Games/Game',
        progressSessionId: 'session-1',
    });

    const snapshot = await manager.completeTask('task-1', {
        progressSessionId: 'session-1',
        completedAt: '2026-01-01T00:00:00.000Z',
        transfer: { downloadedBytes: 10, totalBytes: 10, source: 'test' },
        verification: { status: 'passed', executablePath: 'E:/Games/Game.exe' },
    });

    assert.equal(snapshot.tasks[0].status, DOWNLOAD_STATUSES.COMPLETED);
    assert.equal(snapshot.tasks[0].installedGameId, 'installed-1');
    assert.equal(snapshot.tasks[0].resolvedExecutablePath, 'E:/Games/Game.exe');
});
test('queue manager backfills installedGameId for old completed tasks on load', async () => {
    const repository = {
        emptyState: () => ({ version: 1, tasks: [], settings: {} }),
        state: {
            version: 1,
            settings: {},
            tasks: [{
                id: 'task-old',
                identityKey: 'gog:12345:E:/Games/Game',
                status: DOWNLOAD_STATUSES.COMPLETED,
                title: 'Game',
                platform: 'gog',
                installPath: 'E:/Games/Game',
                providerProductId: '12345',
                resolvedExecutablePath: 'E:/Games/Game/Game.exe',
            }],
        },
        async readState() { return JSON.parse(JSON.stringify(this.state)); },
        async writeState(state) { this.state = JSON.parse(JSON.stringify(state)); return this.state; },
    };
    const manager = new DownloadQueueManager({
        repository,
        preflight: {},
        completionRegistrar: {
            async resolveCompletedDownloadRegistration(task) {
                assert.equal(task.providerProductId, '12345');
                return { installedGameId: 'installed-old', resolvedExecutablePath: task.resolvedExecutablePath };
            },
        },
    });

    const snapshot = await manager.load();

    assert.equal(snapshot.tasks[0].installedGameId, 'installed-old');
    assert.equal(repository.state.tasks[0].installedGameId, 'installed-old');
});

function makeNestedInstallDir() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-download-recover-'));
    const nested = path.join(root, 'Jazz Jackrabbit 2', 'System');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(root, 'setup.exe'), 'setup');
    const exe = path.join(nested, 'Jazz2.exe');
    fs.writeFileSync(exe, 'exe');
    return { root, exe };
}

function makeCompletedLegacyTask(root) {
    return {
        id: 'task-jazz-old',
        identityKey: 'gog:1207658991:' + root,
        status: DOWNLOAD_STATUSES.COMPLETED,
        title: 'Jazz Jackrabbit 2',
        platform: 'gog',
        accountId: 'gog-account-1',
        accountDisplayName: 'GOG User',
        providerProductId: '1207658991',
        contentSystemProductId: 'gog-content-1207658991',
        gogProductId: '1207658991',
        gogdlAppName: 'jazz_jackrabbit_2_collection',
        installPath: root,
        providerCompletionReceipt: {
            verification: {
                status: 'passed',
                method: 'install-directory-scan',
                executableFound: true,
                executablePath: path.join(root, 'setup.exe'),
            },
        },
    };
}

test('old completed task with installPath and nested exe is registered on load', async () => {
    const { root, exe } = makeNestedInstallDir();
    const gamesApi = makeGamesApi();
    let emitted = null;
    const repository = {
        emptyState: () => ({ version: 1, tasks: [], settings: {} }),
        state: { version: 1, settings: {}, tasks: [makeCompletedLegacyTask(root)] },
        async readState() { return JSON.parse(JSON.stringify(this.state)); },
        async writeState(state) { this.state = JSON.parse(JSON.stringify(state)); return this.state; },
    };
    const registrar = new DownloadCompletionLibraryRegistrar({
        gamesApi,
        notifyLibraryUpdated: async games => { emitted = games; },
    });
    const manager = new DownloadQueueManager({ repository, preflight: {}, completionRegistrar: registrar });

    const snapshot = await manager.load();
    const repaired = snapshot.tasks[0];
    const installed = gamesApi.games[0];

    assert.equal(gamesApi.games.length, 1);
    assert.equal(installed.isInstalled, true);
    assert.equal(installed.installVerified, true);
    assert.equal(installed.installSource, 'download');
    assert.equal(installed.path, root);
    assert.equal(installed.installPath, root);
    assert.equal(installed.executablePath, exe);
    assert.match(installed.command, /Jazz2\.exe/);
    assert.match(installed.launchCommand, /Jazz2\.exe/);
    assert.equal(installed.providerProductId, '1207658991');
    assert.equal(installed.contentSystemProductId, 'gog-content-1207658991');
    assert.equal(installed.gogProductId, '1207658991');
    assert.equal(installed.gogdlAppName, 'jazz_jackrabbit_2_collection');
    assert.ok(installed.installedGameKey);
    assert.equal(repaired.installedGameId, installed.id);
    assert.equal(repaired.resolvedExecutablePath, exe);
    assert.ok(repaired.libraryRegisteredAt);
    assert.equal(repository.state.tasks[0].installedGameId, installed.id);
    assert.equal(repository.state.tasks[0].resolvedExecutablePath, exe);
    assert.equal(emitted.length, 1);
});

test('completed task recovery is idempotent and creates no duplicate game records', async () => {
    const { root, exe } = makeNestedInstallDir();
    const gamesApi = makeGamesApi();
    const repository = {
        emptyState: () => ({ version: 1, tasks: [], settings: {} }),
        state: { version: 1, settings: {}, tasks: [makeCompletedLegacyTask(root)] },
        async readState() { return JSON.parse(JSON.stringify(this.state)); },
        async writeState(state) { this.state = JSON.parse(JSON.stringify(state)); return this.state; },
    };
    const registrar = new DownloadCompletionLibraryRegistrar({ gamesApi });
    const first = new DownloadQueueManager({ repository, preflight: {}, completionRegistrar: registrar });
    await first.load();
    const second = new DownloadQueueManager({ repository, preflight: {}, completionRegistrar: registrar });
    const snapshot = await second.load();

    assert.equal(gamesApi.games.length, 1);
    assert.equal(gamesApi.games[0].executablePath, exe);
    assert.equal(snapshot.tasks[0].installedGameId, gamesApi.games[0].id);
    assert.equal(snapshot.tasks[0].resolvedExecutablePath, exe);
});
