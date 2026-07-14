'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const Module = require('node:module');

let testUserData = os.tmpdir();

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'electron') {
        return {
            app: {
                getPath: (name) => name === 'userData' ? testUserData : os.tmpdir(),
                getVersion: () => '0.0.0',
                on: () => {},
                isReady: () => true,
            },
            BrowserWindow: class {},
            Notification: class { show() {} },
            ipcMain: { handle: () => {}, on: () => {} },
        };
    }
    return originalLoad.apply(this, arguments);
};

function makeTmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-epic-fs-'));
}

function rmDir(dir) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

function mkdirp(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, value) {
    mkdirp(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function epicDir() {
    return path.join(testUserData, 'accounts', 'epic');
}

function profileDir(name) {
    return path.join(epicDir(), name);
}

function freshPlatformSync() {
    for (const key of Object.keys(require.cache)) {
        if (key.includes('platformSync')) {
            delete require.cache[key];
        }
    }
    return require('../platformSync');
}

test('_writeSyncLinkToExistingSwitcherProfile writes exact sync_link shape for real Epic profile', async () => {
    testUserData = makeTmpDir();
    try {
        const dir = profileDir('ShapeUser');
        mkdirp(path.join(dir, 'Data'));
        fs.writeFileSync(path.join(dir, 'keep.txt'), 'untouched', 'utf8');

        const { _writeSyncLinkToExistingSwitcherProfile } = freshPlatformSync();
        const ok = await _writeSyncLinkToExistingSwitcherProfile('epic', 'ShapeUser', 12345, {
            epicDisplayName: 'ShapeUser',
        });

        assert.equal(ok, true);
        assert.equal(fs.readFileSync(path.join(dir, 'keep.txt'), 'utf8'), 'untouched');

        const raw = fs.readFileSync(path.join(dir, 'sync_link.json'), 'utf8');
        assert.match(raw, /\n  "platformAccountId": "12345",\n/);
        assert.match(raw, /\n  "linkedAt": "/);
        assert.match(raw, /\n  "epicDisplayName": "ShapeUser"\n/);

        const link = JSON.parse(raw);
        assert.deepEqual(Object.keys(link), ['platformAccountId', 'linkedAt', 'epicDisplayName']);
        assert.equal(link.platformAccountId, '12345');
        assert.equal(link.epicDisplayName, 'ShapeUser');
        assert.match(link.linkedAt, /^\d{4}-\d{2}-\d{2}T/);
    } finally {
        rmDir(testUserData);
    }
});

test('_writeSyncLinkToExistingSwitcherProfile overwrites existing sync_link for real Epic profile', async () => {
    testUserData = makeTmpDir();
    try {
        const dir = profileDir('OverwriteUser');
        mkdirp(path.join(dir, 'Config'));
        writeJson(path.join(dir, 'sync_link.json'), {
            platformAccountId: 'old-id',
            linkedAt: 'old-date',
            oldField: true,
        });

        const { _writeSyncLinkToExistingSwitcherProfile } = freshPlatformSync();
        const ok = await _writeSyncLinkToExistingSwitcherProfile('epic', 'OverwriteUser', 'new-id', {
            epicDisplayName: 'New Name',
        });

        assert.equal(ok, true);
        const link = readJson(path.join(dir, 'sync_link.json'));
        assert.deepEqual(Object.keys(link), ['platformAccountId', 'linkedAt', 'epicDisplayName']);
        assert.equal(link.platformAccountId, 'new-id');
        assert.equal(link.epicDisplayName, 'New Name');
        assert.notEqual(link.linkedAt, 'old-date');
    } finally {
        rmDir(testUserData);
    }
});

test('_writeSyncLinkToExistingSwitcherProfile does not create missing Epic profile directory', async () => {
    testUserData = makeTmpDir();
    try {
        const { _writeSyncLinkToExistingSwitcherProfile } = freshPlatformSync();
        const ok = await _writeSyncLinkToExistingSwitcherProfile('epic', 'MissingUser', 'id-1');

        assert.equal(ok, false);
        assert.equal(fs.existsSync(profileDir('MissingUser')), false);
        assert.equal(fs.existsSync(epicDir()), false);
    } finally {
        rmDir(testUserData);
    }
});

test('_writeSyncLinkToExistingSwitcherProfile leaves phantom Epic sync_link untouched', async () => {
    testUserData = makeTmpDir();
    try {
        const dir = profileDir('PhantomUser');
        mkdirp(dir);
        writeJson(path.join(dir, 'sync_link.json'), { platformAccountId: 'old-id' });

        const { _writeSyncLinkToExistingSwitcherProfile } = freshPlatformSync();
        const ok = await _writeSyncLinkToExistingSwitcherProfile('epic', 'PhantomUser', 'new-id');

        assert.equal(ok, false);
        assert.deepEqual(readJson(path.join(dir, 'sync_link.json')), { platformAccountId: 'old-id' });
    } finally {
        rmDir(testUserData);
    }
});

test('_findMatchingEpicSwitcherProfile falls back to folder-name match when sync_link is missing', async () => {
    testUserData = makeTmpDir();
    try {
        mkdirp(path.join(profileDir('FolderOnly'), 'Data'));

        const { _findMatchingEpicSwitcherProfile } = freshPlatformSync();
        const match = await _findMatchingEpicSwitcherProfile('missing-id', ' folderonly ');

        assert.equal(match, 'FolderOnly');
    } finally {
        rmDir(testUserData);
    }
});

test('_findMatchingEpicSwitcherProfile ignores corrupt sync_link and continues to later profiles', async () => {
    testUserData = makeTmpDir();
    try {
        const corruptDir = profileDir('CorruptUser');
        mkdirp(path.join(corruptDir, 'Data'));
        fs.writeFileSync(path.join(corruptDir, 'sync_link.json'), '{not-json', 'utf8');

        const laterDir = profileDir('LaterUser');
        mkdirp(path.join(laterDir, 'Data'));
        writeJson(path.join(laterDir, 'sync_link.json'), { platformAccountId: 'target-id' });

        const { _findMatchingEpicSwitcherProfile } = freshPlatformSync();
        const match = await _findMatchingEpicSwitcherProfile('target-id', 'NoName');

        assert.equal(match, 'LaterUser');
    } finally {
        rmDir(testUserData);
    }
});

test('_findMatchingEpicSwitcherProfile matches sync_link epicDisplayName through filesystem', async () => {
    testUserData = makeTmpDir();
    try {
        const dir = profileDir('DifferentFolder');
        mkdirp(path.join(dir, 'webcache'));
        writeJson(path.join(dir, 'sync_link.json'), { epicDisplayName: 'Visible Epic Name' });

        const { _findMatchingEpicSwitcherProfile } = freshPlatformSync();
        const match = await _findMatchingEpicSwitcherProfile('', ' visible epic name ');

        assert.equal(match, 'DifferentFolder');
    } finally {
        rmDir(testUserData);
    }
});

test('_findMatchingEpicSwitcherProfile returns null for missing Epic switcher directory', async () => {
    testUserData = makeTmpDir();
    try {
        const { _findMatchingEpicSwitcherProfile } = freshPlatformSync();
        const match = await _findMatchingEpicSwitcherProfile('id-1', 'Missing');

        assert.equal(match, null);
        assert.equal(fs.existsSync(epicDir()), false);
    } finally {
        rmDir(testUserData);
    }
});

test('_findMatchingEpicSwitcherProfile keeps directory-order first match and skips files', async () => {
    testUserData = makeTmpDir();
    try {
        mkdirp(epicDir());
        fs.writeFileSync(path.join(epicDir(), 'NotADirectory'), 'ignored', 'utf8');

        const firstDir = profileDir('AFirst');
        mkdirp(path.join(firstDir, 'Data'));
        writeJson(path.join(firstDir, 'sync_link.json'), { platformAccountId: 'same-id' });

        const secondDir = profileDir('BSecond');
        mkdirp(path.join(secondDir, 'Data'));
        writeJson(path.join(secondDir, 'sync_link.json'), { platformAccountId: 'same-id' });

        const { _findMatchingEpicSwitcherProfile } = freshPlatformSync();
        const match = await _findMatchingEpicSwitcherProfile('same-id', '');

        assert.equal(match, 'AFirst');
    } finally {
        rmDir(testUserData);
    }
});

test('_findMatchingEpicSwitcherProfile never matches phantom profile by name or sync_link id', async () => {
    testUserData = makeTmpDir();
    try {
        const phantomDir = profileDir('PhantomMatch');
        mkdirp(phantomDir);
        writeJson(path.join(phantomDir, 'sync_link.json'), {
            platformAccountId: 'phantom-id',
            epicDisplayName: 'PhantomMatch',
        });

        const { _findMatchingEpicSwitcherProfile } = freshPlatformSync();
        assert.equal(await _findMatchingEpicSwitcherProfile('phantom-id', ''), null);
        assert.equal(await _findMatchingEpicSwitcherProfile('', 'PhantomMatch'), null);
    } finally {
        rmDir(testUserData);
    }
});

test('Epic switcher filesystem wrappers delegate to extracted repository', () => {
    const platformSyncSource = fs.readFileSync(path.join(__dirname, '..', 'platformSync.js'), 'utf8');
    const repositoryPath = path.join(
        __dirname,
        '..',
        'src',
        'features',
        'sync',
        'infrastructure',
        'repositories',
        'EpicSwitcherRepository.js'
    );
    const bundlePath = path.join(
        __dirname,
        '..',
        'src',
        'features',
        'sync',
        'infrastructure',
        'composition',
        'ConnectorRepositoryBundle.js'
    );
    const bundleSource = fs.readFileSync(bundlePath, 'utf8');

    assert.match(platformSyncSource, /async function _writeSyncLinkToExistingSwitcherProfile/);
    assert.match(platformSyncSource, /async function _findMatchingEpicSwitcherProfile/);
    assert.equal(fs.existsSync(repositoryPath), true);
    assert.equal(fs.existsSync(bundlePath), true);
    assert.match(platformSyncSource, /createConnectorRepositoryBundle/);
    assert.match(platformSyncSource, /epicSwitcherRepository\.writeSyncLinkToExistingProfile/);
    assert.match(platformSyncSource, /epicSwitcherRepository\.findMatchingEpicProfile/);
    assert.match(bundleSource, /EpicSwitcherRepository/);
});
