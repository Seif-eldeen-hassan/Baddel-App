'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const {
    PlatformSyncCacheRepository,
} = require('../src/features/sync/infrastructure/repositories/PlatformSyncCacheRepository');

function makeTempUserData() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-sync-cache-repo-'));
}

function rmDir(dir) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

function mkdirp(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function writeText(filePath, value) {
    mkdirp(path.dirname(filePath));
    fs.writeFileSync(filePath, value, 'utf8');
}

function readText(filePath) {
    return fs.readFileSync(filePath, 'utf8');
}

test('repository exposes current platform-sync cache paths', () => {
    const userData = makeTempUserData();
    try {
        const repo = new PlatformSyncCacheRepository({ userDataDir: userData });

        assert.equal(repo.syncCacheDir, path.join(userData, 'platform-sync'));
        assert.equal(repo.syncLogsDir, path.join(userData, 'platform-sync', 'logs'));
        assert.equal(repo.steamAccountsFile, path.join(userData, 'platform-sync', 'steam_accounts.json'));
        assert.equal(repo.steamMergedCacheFile, path.join(userData, 'platform-sync', 'steam_library_merged.json'));
        assert.equal(repo.epicAccountsFile, path.join(userData, 'platform-sync', 'epic_accounts.json'));
        assert.equal(repo.epicMergedCacheFile, path.join(userData, 'platform-sync', 'epic_library_merged.json'));
        assert.equal(repo.epicClassificationReportFile, path.join(userData, 'platform-sync', 'epic_sync_classification_report.json'));
    } finally {
        rmDir(userData);
    }
});

test('steam account repository reads empty arrays for missing, corrupt, and non-array files', async () => {
    const userData = makeTempUserData();
    try {
        const repo = new PlatformSyncCacheRepository({ userDataDir: userData });
        assert.deepEqual(await repo.readSteamAccounts(), []);
        assert.deepEqual(repo.readSteamAccountsSync(), []);
        assert.equal(repo.isSteamLinked(), false);

        writeText(repo.steamAccountsFile, '{ nope');
        assert.deepEqual(await repo.readSteamAccounts(), []);
        assert.deepEqual(repo.readSteamAccountsSync(), []);

        writeText(repo.steamAccountsFile, '{"id":"s1"}');
        assert.deepEqual(await repo.readSteamAccounts(), []);
        assert.deepEqual(repo.readSteamAccountsSync(), []);
    } finally {
        rmDir(userData);
    }
});

test('steam account repository writes pretty JSON and reads the same shape', async () => {
    const userData = makeTempUserData();
    try {
        const repo = new PlatformSyncCacheRepository({ userDataDir: userData });
        const accounts = [
            { id: 123, displayName: 'Steam Numeric' },
            { id: 's2', displayName: 'Steam Two', gamesCount: 4 },
        ];

        await repo.writeSteamAccounts(accounts);

        assert.deepEqual(await repo.readSteamAccounts(), accounts);
        assert.deepEqual(repo.readSteamAccountsSync(), accounts);
        assert.equal(repo.isSteamLinked(), true);
        assert.equal(readText(repo.steamAccountsFile), JSON.stringify(accounts, null, 2));
        assert.equal(fs.existsSync(repo.syncLogsDir), true);
    } finally {
        rmDir(userData);
    }
});

test('steam merged library repository preserves missing/corrupt defaults and write/read shape', async () => {
    const userData = makeTempUserData();
    try {
        const repo = new PlatformSyncCacheRepository({ userDataDir: userData });
        const library = [
            {
                id: 'steam_one',
                title: 'Steam One',
                ownedByAccountIds: ['s1'],
                steamLicensedAccountIds: ['s1'],
            },
        ];

        assert.deepEqual(await repo.readSteamMergedLibrary(), []);
        writeText(repo.steamMergedCacheFile, '{ nope');
        assert.deepEqual(await repo.readSteamMergedLibrary(), []);
        writeText(repo.steamMergedCacheFile, '{"id":"steam_one"}');
        assert.deepEqual(await repo.readSteamMergedLibrary(), []);

        await repo.writeSteamMergedLibrary(library);
        assert.deepEqual(await repo.readSteamMergedLibrary(), library);
        assert.equal(readText(repo.steamMergedCacheFile), JSON.stringify(library, null, 2));

        await repo.deleteSteamMergedLibrary();
        assert.equal(fs.existsSync(repo.steamMergedCacheFile), false);
        await assert.doesNotReject(() => repo.deleteSteamMergedLibrary());
    } finally {
        rmDir(userData);
    }
});

test('epic account repository reads empty arrays for missing, corrupt, and non-array files', async () => {
    const userData = makeTempUserData();
    try {
        const repo = new PlatformSyncCacheRepository({ userDataDir: userData });
        assert.deepEqual(await repo.readEpicAccounts(), []);
        assert.deepEqual(repo.readEpicAccountsSync(), []);
        assert.equal(repo.isEpicLinked(), false);

        writeText(repo.epicAccountsFile, '{ nope');
        assert.deepEqual(await repo.readEpicAccounts(), []);
        assert.deepEqual(repo.readEpicAccountsSync(), []);

        writeText(repo.epicAccountsFile, '{"id":"e1"}');
        assert.deepEqual(await repo.readEpicAccounts(), []);
        assert.deepEqual(repo.readEpicAccountsSync(), []);
    } finally {
        rmDir(userData);
    }
});

test('epic account repository writes pretty JSON and reads the same shape', async () => {
    const userData = makeTempUserData();
    try {
        const repo = new PlatformSyncCacheRepository({ userDataDir: userData });
        const accounts = [
            { id: 'epic_tmp_123', displayName: 'Epic Temp' },
            { id: 'e1', displayName: 'Epic One', gamesCount: 9 },
        ];

        await repo.writeEpicAccounts(accounts);

        assert.deepEqual(await repo.readEpicAccounts(), accounts);
        assert.deepEqual(repo.readEpicAccountsSync(), accounts);
        assert.equal(repo.isEpicLinked(), true);
        assert.equal(readText(repo.epicAccountsFile), JSON.stringify(accounts, null, 2));
    } finally {
        rmDir(userData);
    }
});

test('epic merged library repository preserves missing/corrupt defaults and write/read shape', async () => {
    const userData = makeTempUserData();
    try {
        const repo = new PlatformSyncCacheRepository({ userDataDir: userData });
        const library = [
            {
                id: 'epic_one',
                title: 'Epic One',
                ownedByAccountIds: ['e1'],
            },
        ];

        assert.deepEqual(await repo.readEpicMergedLibrary(), []);
        writeText(repo.epicMergedCacheFile, '{ nope');
        assert.deepEqual(await repo.readEpicMergedLibrary(), []);
        writeText(repo.epicMergedCacheFile, '{"id":"epic_one"}');
        assert.deepEqual(await repo.readEpicMergedLibrary(), []);

        await repo.writeEpicMergedLibrary(library);
        assert.deepEqual(await repo.readEpicMergedLibrary(), library);
        assert.equal(readText(repo.epicMergedCacheFile), JSON.stringify(library, null, 2));

        await repo.deleteEpicMergedLibrary();
        assert.equal(fs.existsSync(repo.epicMergedCacheFile), false);
        await assert.doesNotReject(() => repo.deleteEpicMergedLibrary());
    } finally {
        rmDir(userData);
    }
});

test('epic classification report repository preserves default and pretty write/read shape', async () => {
    const userData = makeTempUserData();
    try {
        const repo = new PlatformSyncCacheRepository({ userDataDir: userData });
        const report = {
            generatedAt: '2026-07-13T00:00:00.000Z',
            accounts: [
                {
                    accountId: 'e1',
                    accountName: 'Epic One',
                    keptCount: 1,
                    rejectedCount: 0,
                    unknownCount: 0,
                },
            ],
        };

        assert.equal(await repo.readEpicClassificationReport(), null);
        writeText(repo.epicClassificationReportFile, '{ nope');
        assert.equal(await repo.readEpicClassificationReport(), null);

        await repo.ensureDirs();
        await repo.writeEpicClassificationReport(report);

        assert.deepEqual(await repo.readEpicClassificationReport(), report);
        assert.equal(readText(repo.epicClassificationReportFile), JSON.stringify(report, null, 2));
    } finally {
        rmDir(userData);
    }
});

test('gog merged library repository filters Amazon Prime entitlement duplicates', async () => {
    const userData = makeTempUserData();
    try {
        const repo = new PlatformSyncCacheRepository({ userDataDir: userData });
        const library = [
            { id: 'gog_1', title: 'A Plague Tale: Innocence' },
            { id: 'gog_2', title: 'A Plague Tale: Innocence - Amazon Prime' },
            { id: 'gog_3', name: 'Arcade Paradise - Amazon Prime' },
        ];

        writeText(repo.gogMergedCacheFile, JSON.stringify(library, null, 2));
        assert.deepEqual(await repo.readGogMergedLibrary(), [{ id: 'gog_1', title: 'A Plague Tale: Innocence' }]);

        await repo.writeGogMergedLibrary(library);
        assert.deepEqual(JSON.parse(readText(repo.gogMergedCacheFile)), [{ id: 'gog_1', title: 'A Plague Tale: Innocence' }]);
    } finally {
        rmDir(userData);
    }
});

test('generic merged library helpers route by platform', async () => {
    const userData = makeTempUserData();
    try {
        const repo = new PlatformSyncCacheRepository({ userDataDir: userData });
        const steamLibrary = [{ id: 'steam_one' }];
        const epicLibrary = [{ id: 'epic_one' }];

        assert.equal(repo.getMergedCacheFile('steam'), repo.steamMergedCacheFile);
        assert.equal(repo.getMergedCacheFile('epic'), repo.epicMergedCacheFile);

        await repo.writeMergedLibrary('steam', steamLibrary);
        await repo.writeMergedLibrary('epic', epicLibrary);

        assert.deepEqual(await repo.readMergedLibrary('steam'), steamLibrary);
        assert.deepEqual(await repo.readMergedLibrary('epic'), epicLibrary);
    } finally {
        rmDir(userData);
    }
});


test('PlatformSyncCacheRepository migrates managed artwork-cache-v2 file URLs while preserving remote candidates', async () => {
    const dir = makeTempUserData();
    try {
        const repo = new PlatformSyncCacheRepository({ userDataDir: dir });
        await repo.ensureDirs();
        const managedPath = path.join(dir, 'artwork-cache-v2', 'assets', 'cover.webp');
        const customPath = path.join(dir, 'user_artwork', 'custom.webp');
        fs.mkdirSync(path.dirname(managedPath), { recursive: true });
        fs.mkdirSync(path.dirname(customPath), { recursive: true });
        fs.writeFileSync(managedPath, 'managed');
        fs.writeFileSync(customPath, 'custom');
        await repo.writeJsonFileAtomic(repo.epicMergedCacheFile, [{
            id: 'epic-1',
            platform: 'epic',
            coverUrl: pathToFileURL(managedPath).href,
            image: 'https://cdn.example/remote.jpg',
            defaultImage: pathToFileURL(managedPath).href,
            coverCandidates: ['https://cdn.example/remote.jpg'],
        }, {
            id: 'manual-1',
            customArtworkLocked: true,
            artworkSource: 'creator',
            coverUrl: pathToFileURL(customPath).href,
        }]);

        const summary = await repo.migrateManagedArtworkUrlsFromMergedLibraries(['epic']);
        assert.equal(summary.changed, true);
        const migrated = JSON.parse(fs.readFileSync(repo.epicMergedCacheFile, 'utf8'));
        assert.equal(migrated[0].coverUrl, 'https://cdn.example/remote.jpg');
        assert.equal(migrated[0].image, 'https://cdn.example/remote.jpg');
        assert.equal(migrated[0].defaultImage, 'https://cdn.example/remote.jpg');
        assert.deepEqual(migrated[0].coverCandidates, ['https://cdn.example/remote.jpg']);
        assert.equal(migrated[1].coverUrl, pathToFileURL(customPath).href);
    } finally {
        rmDir(dir);
    }
});

test('epic merged library read enriches missing Fortnite and Control covers from Vault using stable IDs', async () => {
    const userData = makeTempUserData();
    try {
        const repo = new PlatformSyncCacheRepository({ userDataDir: userData });
        await repo.writeJsonFileAtomic(repo.epicMergedCacheFile, [
            {
                id: 'epic_Fortnite',
                title: 'Fortnite',
                platform: 'epic',
                appName: 'Fortnite',
                namespace: 'fn',
                catalogItemId: '4fe75bbc5a674f4f9b356b5c90567da5',
                allIds: { epic: 'fn' },
            },
            {
                id: 'epic_Calluna',
                title: 'Control',
                platform: 'epic',
                appName: 'Calluna',
                namespace: 'calluna',
                catalogItemId: '9afb582e90b74bdd9e2146fb79c78589',
                allIds: { epic: 'calluna' },
            },
        ]);
        await repo.writeEpicVault({
            accounts: [{
                accountId: 'epic-account-1',
                games: [
                    {
                        id: 'vault-fortnite',
                        title: 'Different title text must not be required',
                        appName: 'Fortnite',
                        namespace: 'fn',
                        catalogItemId: '4fe75bbc5a674f4f9b356b5c90567da5',
                        coverUrl: 'https://cdn.example/fortnite-cover.jpg',
                    },
                    {
                        id: 'vault-control',
                        title: 'Not used as primary identity',
                        appName: 'Calluna',
                        namespace: 'calluna',
                        catalogItemId: '9afb582e90b74bdd9e2146fb79c78589',
                        coverCandidates: [{ url: 'https://cdn.example/control-cover.jpg', source: 'epic_catalog' }],
                    },
                ],
            }],
        });

        const games = await repo.readEpicMergedLibrary();
        const fortnite = games.find((game) => game.id === 'epic_Fortnite');
        const control = games.find((game) => game.id === 'epic_Calluna');
        assert.equal(fortnite.coverUrl, 'https://cdn.example/fortnite-cover.jpg');
        assert.equal(fortnite.image, 'https://cdn.example/fortnite-cover.jpg');
        assert.equal(control.coverUrl, 'https://cdn.example/control-cover.jpg');
        assert.equal(control.image, 'https://cdn.example/control-cover.jpg');
        assert.equal(fortnite.artworkSource, 'epic_vault_artwork_index');
        assert.equal(control.artworkSource, 'epic_vault_artwork_index');

        const persisted = JSON.parse(readText(repo.epicMergedCacheFile));
        assert.equal(persisted[0].coverUrl, undefined, 'read enrichment must not rewrite merged JSON with managed/runtime artwork');
    } finally {
        rmDir(userData);
    }
});
