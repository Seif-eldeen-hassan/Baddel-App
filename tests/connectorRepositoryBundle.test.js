'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    createConnectorRepositoryBundle,
} = require('../src/features/sync/infrastructure/composition/ConnectorRepositoryBundle');

const ROOT = path.resolve(__dirname, '..');
const BUNDLE_PATH = path.join(ROOT, 'src', 'features', 'sync', 'infrastructure', 'composition', 'ConnectorRepositoryBundle.js');

function readBundleSource() {
    return fs.readFileSync(BUNDLE_PATH, 'utf8');
}

test('createConnectorRepositoryBundle exists', () => {
    assert.equal(typeof createConnectorRepositoryBundle, 'function');
});

test('default bundle creates the current platform sync repositories', () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-connector-repos-'));
    const accountsRootDir = path.join(userDataDir, 'accounts');

    try {
        const bundle = createConnectorRepositoryBundle({
            cacheRepositoryOptions: { userDataDir },
            epicSwitcherRepositoryOptions: { accountsRootDir },
        });

        assert.equal(bundle.syncCacheRepository.userDataDir, userDataDir);
        assert.equal(bundle.syncCacheRepository.syncCacheDir, path.join(userDataDir, 'platform-sync'));
        assert.equal(bundle.epicSwitcherRepository.accountsRootDir, accountsRootDir);
    } finally {
        fs.rmSync(userDataDir, { recursive: true, force: true });
    }
});

test('injected repository identity is preserved', () => {
    const cacheRepository = { marker: 'cache' };
    const epicSwitcherRepository = { marker: 'epic-switcher' };
    const bundle = createConnectorRepositoryBundle({
        cacheRepository,
        epicSwitcherRepository,
    });

    assert.equal(bundle.syncCacheRepository, cacheRepository);
    assert.equal(bundle.epicSwitcherRepository, epicSwitcherRepository);
});

test('created repositories expose methods used by platformSync', () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-connector-repos-shape-'));

    try {
        const { syncCacheRepository, epicSwitcherRepository } = createConnectorRepositoryBundle({
            cacheRepositoryOptions: { userDataDir },
            epicSwitcherRepositoryOptions: { accountsRootDir: path.join(userDataDir, 'accounts') },
        });

        for (const method of [
            'ensureDirs',
            'isSteamLinked',
            'readSteamAccountsSync',
            'writeSteamAccountsAtomic',
            'readSteamMergedLibrary',
            'writeSteamMergedLibrary',
            'deleteSteamMergedLibrary',
            'readEpicAccounts',
            'writeEpicAccounts',
            'isEpicLinked',
            'readEpicAccountsSync',
            'readEpicMergedLibrary',
            'writeEpicMergedLibrary',
            'deleteEpicMergedLibrary',
            'writeEpicClassificationReport',
            'getMergedCacheFile',
            'readMergedLibrary',
            'writeMergedLibrary',
        ]) {
            assert.equal(typeof syncCacheRepository[method], 'function', `syncCacheRepository.${method} should exist`);
        }

        for (const method of ['findMatchingEpicProfile', 'writeSyncLinkToExistingProfile']) {
            assert.equal(typeof epicSwitcherRepository[method], 'function', `epicSwitcherRepository.${method} should exist`);
        }
    } finally {
        fs.rmSync(userDataDir, { recursive: true, force: true });
    }
});

test('bundle module stays independent of runtime and connector construction', () => {
    const source = readBundleSource();

    assert.doesNotMatch(source, /platformSync/);
    assert.doesNotMatch(source, /SyncContainer/);
    assert.doesNotMatch(source, /electron/);
    assert.doesNotMatch(source, /main\.js|preload\.js|renderer/);
    assert.doesNotMatch(source, /steamBridge/);
    assert.doesNotMatch(source, /LEGENDARY|legendary|execFile/);
    assert.doesNotMatch(source, /ipcMain|ipcRenderer|platform-sync:/);
});
