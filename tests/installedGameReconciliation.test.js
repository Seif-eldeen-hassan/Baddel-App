'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {
    reconcileManagedInstalledGames,
} = require('../src/features/games/domain/services/InstalledGameReconciliation');
const { JsonGameRepository } = require('../src/features/games/infrastructure/repositories/JsonGameRepository');
const { DownloadQueueManager } = require('../src/features/downloads/infrastructure/services/DownloadQueueManager');

function fixture(overrides = {}) {
    const root = path.join(os.tmpdir(), 'Baddel Games', 'Under The Moon');
    const managed = {
        id: 'gog_1386468605',
        name: 'Under The Moon',
        platform: 'gog',
        scannerPlatform: 'gog',
        gogProductId: '1386468605',
        providerProductId: '1386468605',
        installSource: 'download',
        installProvider: 'gogdl',
        installedGameKey: 'managed-key',
        installPath: root,
        path: root,
        ownedByAccountIds: ['account-a'],
        totalPlaytime: 30,
        cover: 'file://managed-cover.webp',
    };
    const scanner = {
        id: 'scanner-under-the-moon',
        name: 'Under The Moon',
        platform: 'gog',
        scannerPlatform: 'gog',
        gogProductId: '1386468605',
        providerProductId: '1386468605',
        installSource: 'scanner',
        installProvider: 'gog_discovered',
        installedGameKey: 'scanner-key',
        installPath: path.join(root, 'game'),
        path: path.join(root, 'game'),
        executablePath: path.join(root, 'game', 'UnderTheMoon.exe'),
        command: path.join(root, 'game', 'UnderTheMoon.exe'),
        ownedByAccountIds: ['account-b'],
        totalPlaytime: 45,
        hero: 'file://scanner-hero.webp',
    };
    const task = {
        id: 'download-under-the-moon',
        title: 'Under The Moon',
        status: 'completed',
        completionConfirmed: true,
        platform: 'gog',
        installProvider: 'gogdl',
        installedGameId: managed.id,
        installPath: root,
        gogProductId: '1386468605',
        providerProductId: '1386468605',
    };
    return { root, managed: { ...managed, ...(overrides.managed || {}) }, scanner: { ...scanner, ...(overrides.scanner || {}) }, task: { ...task, ...(overrides.task || {}) } };
}

test('managed completion and scanner record for the same physical GOG install merge safely', () => {
    const { managed, scanner, task } = fixture();
    const result = reconcileManagedInstalledGames([managed, scanner], [task]);

    assert.equal(result.changed, true);
    assert.equal(result.removedCount, 1);
    assert.equal(result.games.length, 1);
    assert.equal(result.games[0].id, managed.id);
    assert.equal(result.games[0].installSource, 'download');
    assert.equal(result.games[0].installProvider, 'gogdl');
    assert.equal(result.games[0].installPath, task.installPath);
    assert.equal(result.games[0].installedGameKey, managed.installedGameKey);
    assert.equal(result.games[0].executablePath, scanner.executablePath);
    assert.deepEqual(result.games[0].ownedByAccountIds.sort(), ['account-a', 'account-b']);
    assert.equal(result.games[0].totalPlaytime, 45);
    assert.equal(result.games[0].cover, managed.cover);
    assert.equal(result.games[0].hero, scanner.hero);
    assert.deepEqual(result.games[0].recordAliases, [scanner.id]);
    assert.equal(result.idRemap[scanner.id], managed.id);
});

test('same product in a different install root and cross-platform records never merge', () => {
    const { managed, scanner, task } = fixture({
        scanner: {
            installPath: path.join(os.tmpdir(), 'Other Library', 'Under The Moon'),
            path: path.join(os.tmpdir(), 'Other Library', 'Under The Moon'),
            executablePath: path.join(os.tmpdir(), 'Other Library', 'Under The Moon', 'UnderTheMoon.exe'),
        },
    });
    const xbox = {
        ...scanner,
        id: 'xbox-1386468605',
        platform: 'xbox',
        scannerPlatform: 'xbox',
        installPath: task.installPath,
        path: task.installPath,
    };
    const result = reconcileManagedInstalledGames([managed, scanner, xbox], [task]);
    assert.equal(result.changed, false);
    assert.equal(result.games.length, 3);
});

test('reconciliation is idempotent and retains an alias remap for dependent stores', () => {
    const { managed, scanner, task } = fixture();
    const first = reconcileManagedInstalledGames([managed, scanner], [task]);
    const second = reconcileManagedInstalledGames(first.games, [task]);

    assert.equal(second.changed, false);
    assert.equal(second.games.length, 1);
    assert.equal(second.idRemap[scanner.id], managed.id);
});

test('future scanner upsert updates the managed record instead of recreating a duplicate', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-installed-repo-'));
    const db = path.join(dir, 'games-db.json');
    const { managed, scanner } = fixture();
    fs.writeFileSync(db, JSON.stringify([managed]));
    const repository = new JsonGameRepository({
        fs,
        path,
        crypto,
        databasePath: db,
        logger: { log() {}, error() {} },
        keyResolver: game => game.installedGameKey,
    });

    repository.upsertGameRecord(scanner);
    const games = repository.getAllGames();
    assert.equal(games.length, 1);
    assert.equal(games[0].id, managed.id);
    assert.equal(games[0].installSource, 'download');
    assert.equal(games[0].installProvider, 'gogdl');
    assert.equal(games[0].installPath, managed.installPath);
    assert.equal(games[0].installedGameKey, managed.installedGameKey);
    assert.equal(games[0].executablePath, scanner.executablePath);
});

test('queue recovery remaps completed task references and persists once', async () => {
    const writes = [];
    const repository = {
        emptyState: () => ({ version: 1, tasks: [], settings: {} }),
        async readState() {
            return {
                version: 1,
                tasks: [{ id: 'task-a', status: 'completed', installedGameId: 'scanner-id', taskRevision: 2 }],
                settings: {},
            };
        },
        async writeState(state) {
            writes.push(JSON.parse(JSON.stringify(state)));
        },
    };
    const manager = new DownloadQueueManager({
        repository,
        preflight: {},
        completionRegistrar: {
            async reconcileManagedDuplicates() {
                return { changed: true, idRemap: { 'scanner-id': 'managed-id' } };
            },
        },
    });

    const snapshot = await manager.load();
    assert.equal(snapshot.tasks[0].installedGameId, 'managed-id');
    assert.equal(snapshot.tasks[0].taskRevision, 3);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].tasks[0].installedGameId, 'managed-id');
});


test('repository reconciliation persists atomically and remains idempotent after restart', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-installed-migration-'));
    const db = path.join(dir, 'games-db.json');
    const { managed, scanner, task } = fixture();
    fs.writeFileSync(db, JSON.stringify([managed, scanner]));
    const deps = { fs, path, crypto, databasePath: db, logger: { log() {}, error() {} }, keyResolver: game => game.installedGameKey };
    const repository = new JsonGameRepository(deps);

    const first = await repository.reconcileManagedInstalledGames([task]);
    assert.equal(first.changed, true);
    assert.equal(JSON.parse(fs.readFileSync(db, 'utf8')).length, 1);

    const restarted = new JsonGameRepository(deps);
    const second = await restarted.reconcileManagedInstalledGames([task]);
    assert.equal(second.changed, false);
    assert.equal(second.games.length, 1);
    assert.equal(second.idRemap[scanner.id], managed.id);
});

test('collection references are remapped and deduplicated without touching unrelated IDs', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-collections-remap-'));
    const electron = { app: { getPath: () => dir } };
    const Module = require('node:module');
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (request === 'electron') return electron;
        return originalLoad.call(this, request, parent, isMain);
    };
    let handler;
    try {
        const modulePath = require.resolve('../collectionsHandler');
        delete require.cache[modulePath];
        handler = require(modulePath);
    } finally {
        Module._load = originalLoad;
    }
    const dataFile = path.join(dir, 'BaddelLauncher', 'collections.json');
    fs.writeFileSync(dataFile, JSON.stringify([
        { id: 'custom', name: 'Custom', gameIds: ['scanner-id', 'managed-id', 'other-id'] },
    ]));

    const first = await handler.remapGameIds({ 'scanner-id': 'managed-id' });
    assert.equal(first.changed, true);
    const saved = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    assert.deepEqual(saved.find(item => item.id === 'custom').gameIds, ['managed-id', 'other-id']);

    const second = await handler.remapGameIds({ 'scanner-id': 'managed-id' });
    assert.equal(second.changed, false);
});

test('main composition remaps artwork aliases and publishes the reconciled library', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    assert.match(mainSource, /colHandler\.remapGameIds\(result\.idRemap\)/);
    assert.match(mainSource, /getCachedAsset\(\{ canonicalGameId: oldId, type \}\)/);
    assert.match(mainSource, /linkCachedAlias\([\s\S]*canonicalGameId: survivorId/);
    assert.match(mainSource, /webContents\?\.send\('library-updated', getSavedGames\(\)\)/);
});


test('Epic completion followed by scanner discovery of the same managed install reconciles', () => {
    const root = path.join(os.tmpdir(), 'Baddel Games', 'Epic Sample');
    const managed = {
        id: 'epic_AppOne',
        platform: 'epic',
        scannerPlatform: 'epic',
        appName: 'AppOne',
        providerAppName: 'AppOne',
        installSource: 'download',
        installProvider: 'legendary',
        installedGameKey: 'epic-managed-key',
        installPath: root,
        path: root,
    };
    const scanner = {
        id: 'scanner-epic-app-one',
        platform: 'epic',
        scannerPlatform: 'epic',
        appName: 'AppOne',
        installSource: 'scanner',
        installProvider: 'epic_launcher',
        installedGameKey: 'epic-scanner-key',
        installPath: path.join(root, 'Binaries'),
        path: path.join(root, 'Binaries'),
        executablePath: path.join(root, 'Binaries', 'Game.exe'),
    };
    const task = {
        id: 'download-epic-app-one',
        status: 'completed',
        completionConfirmed: true,
        platform: 'epic',
        installProvider: 'legendary',
        installedGameId: managed.id,
        installPath: root,
        providerAppName: 'AppOne',
    };
    const result = reconcileManagedInstalledGames([managed, scanner], [task]);
    assert.equal(result.changed, true);
    assert.equal(result.games.length, 1);
    assert.equal(result.games[0].id, managed.id);
    assert.equal(result.games[0].executablePath, scanner.executablePath);
});

test('GOG Galaxy or manifest discovery under the managed root reconciles to the download record', () => {
    const { managed, scanner, task } = fixture({
        scanner: { installProvider: 'gog_galaxy', installProvenance: 'gog_galaxy' },
    });
    const result = reconcileManagedInstalledGames([managed, scanner], [task]);
    assert.equal(result.changed, true);
    assert.equal(result.games[0].id, managed.id);
    assert.equal(result.games[0].installProvider, 'gogdl');
});

test('different provider identities remain separate even when title and folder are identical', () => {
    const { managed, scanner, task } = fixture({
        scanner: { gogProductId: '9999999999', providerProductId: '9999999999' },
    });
    const result = reconcileManagedInstalledGames([managed, scanner], [task]);
    assert.equal(result.changed, false);
    assert.equal(result.games.length, 2);
});

test('reconciliation never deletes physical game files', () => {
    const diskRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-no-file-delete-'));
    const executablePath = path.join(diskRoot, 'game', 'Game.exe');
    fs.mkdirSync(path.dirname(executablePath), { recursive: true });
    fs.writeFileSync(executablePath, 'game-bytes');
    const { managed, scanner, task } = fixture({
        managed: { installPath: diskRoot, path: diskRoot },
        scanner: { installPath: path.dirname(executablePath), path: path.dirname(executablePath), executablePath },
        task: { installPath: diskRoot },
    });

    const result = reconcileManagedInstalledGames([managed, scanner], [task]);
    assert.equal(result.changed, true);
    assert.equal(fs.existsSync(executablePath), true);
    assert.equal(fs.readFileSync(executablePath, 'utf8'), 'game-bytes');
});
