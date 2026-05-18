'use strict';

// ============================================================
// Integration tests for Epic library-sync vs switcher separation.
//
// Strategy: mock the electron module via Module._load and set
// BADDEL_TEST_USER_DATA to a temp directory so both accountsHandler
// and platformSync can be required without a running Electron process.
// ============================================================

const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');
const Module = require('module');

// ── Electron mock (installed once for the whole test file) ────────────────────

let _testUserData = os.tmpdir();   // overridden per test

const _origLoad = Module._load.bind(Module);
Module._load = function (request, parent, isMain) {
    if (request === 'electron') {
        return {
            app: {
                getPath:    (name) => name === 'userData' ? _testUserData : os.tmpdir(),
                getVersion: () => '0.0.0',
                on:         () => {},
                isReady:    () => true,
            },
            net:   { request: () => ({ on: () => {}, end: () => {} }) },
            shell: { openExternal: () => {} },
            BrowserWindow: class { constructor() {} on() {} loadURL() {} },
            Notification:  class { constructor() {} show() {} },
            ipcMain:       { handle: () => {}, on: () => {} },
        };
    }
    return _origLoad(request, parent, isMain);
};

// ── Filesystem helpers ────────────────────────────────────────────────────────

function makeTmpDir()  { return fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-test-')); }
function rmDir(dir)    { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /**/ } }
function mkdirp(p)     { fs.mkdirSync(p, { recursive: true }); }
function writeJson(p, obj) { mkdirp(path.dirname(p)); fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8'); }
function readJson(p)   { return JSON.parse(fs.readFileSync(p, 'utf8')); }

function epicSwitcherDir(tmpDir) { return path.join(tmpDir, 'accounts', 'epic'); }

// Re-require a module with a fresh cache so the electron mock picks up the
// current _testUserData value.
function freshRequire(mod) {
    delete require.cache[require.resolve(mod)];
    // Also bust any transitive deps that cache userData-derived paths
    for (const key of Object.keys(require.cache)) {
        if (key.includes('accountsHandler') || key.includes('platformSync')) {
            delete require.cache[key];
        }
    }
    return require(mod);
}

// ── getEpicProfiles: phantom filtering ───────────────────────────────────────

test('getEpicProfiles: phantom profile with only sync_link.json is excluded', async () => {
    _testUserData = makeTmpDir();
    try {
        const phantomDir = path.join(epicSwitcherDir(_testUserData), 'PhantomUser');
        mkdirp(phantomDir);
        writeJson(path.join(phantomDir, 'sync_link.json'), { platformAccountId: 'abc123' });

        const { getEpicProfiles } = freshRequire('../accountsHandler');
        const profiles = await getEpicProfiles();
        assert.equal(profiles.length, 0, 'Phantom profile must not appear in switcher list');
    } finally { rmDir(_testUserData); }
});

test('getEpicProfiles: real profile containing Data/ is returned', async () => {
    _testUserData = makeTmpDir();
    try {
        const profileDir = path.join(epicSwitcherDir(_testUserData), 'RealUser');
        mkdirp(path.join(profileDir, 'Data'));
        writeJson(path.join(profileDir, 'sync_link.json'), { platformAccountId: 'real123' });

        const { getEpicProfiles } = freshRequire('../accountsHandler');
        const profiles = await getEpicProfiles();
        assert.equal(profiles.length, 1);
        assert.equal(profiles[0].id, 'RealUser');
        assert.equal(profiles[0].platformAccountId, 'real123');
    } finally { rmDir(_testUserData); }
});

test('getEpicProfiles: phantom skipped but real profile returned when both exist', async () => {
    _testUserData = makeTmpDir();
    try {
        const epicDir = epicSwitcherDir(_testUserData);

        const phantomDir = path.join(epicDir, 'PhantomUser');
        mkdirp(phantomDir);
        writeJson(path.join(phantomDir, 'sync_link.json'), { platformAccountId: 'p1' });

        const realDir = path.join(epicDir, 'RealUser');
        mkdirp(path.join(realDir, 'Data'));
        writeJson(path.join(realDir, 'sync_link.json'), { platformAccountId: 'r1' });

        const { getEpicProfiles } = freshRequire('../accountsHandler');
        const profiles = await getEpicProfiles();
        assert.equal(profiles.length, 1);
        assert.equal(profiles[0].id, 'RealUser');
    } finally { rmDir(_testUserData); }
});

test('getEpicProfiles: profile with _baddel_meta.json is treated as real', async () => {
    _testUserData = makeTmpDir();
    try {
        const profileDir = path.join(epicSwitcherDir(_testUserData), 'MetaUser');
        mkdirp(profileDir);
        writeJson(path.join(profileDir, '_baddel_meta.json'), { savedAt: Date.now() });

        const { getEpicProfiles } = freshRequire('../accountsHandler');
        const profiles = await getEpicProfiles();
        assert.equal(profiles.length, 1);
        assert.equal(profiles[0].id, 'MetaUser');
    } finally { rmDir(_testUserData); }
});

test('getEpicProfiles: empty switcher directory returns no profiles', async () => {
    _testUserData = makeTmpDir();
    try {
        const { getEpicProfiles } = freshRequire('../accountsHandler');
        const profiles = await getEpicProfiles();
        assert.deepEqual(profiles, []);
    } finally { rmDir(_testUserData); }
});

// ── _writeSyncLinkToExistingSwitcherProfile ───────────────────────────────────

test('_writeSyncLinkToExistingSwitcherProfile: writes sync_link to existing real profile', async () => {
    _testUserData = makeTmpDir();
    try {
        const profileDir = path.join(_testUserData, 'accounts', 'epic', 'MyUser');
        mkdirp(path.join(profileDir, 'Data'));

        const { _writeSyncLinkToExistingSwitcherProfile } = freshRequire('../platformSync');
        const ok = await _writeSyncLinkToExistingSwitcherProfile('epic', 'MyUser', 'id001', { epicDisplayName: 'MyUser' });
        assert.equal(ok, true);
        const link = readJson(path.join(profileDir, 'sync_link.json'));
        assert.equal(link.platformAccountId, 'id001');
    } finally { rmDir(_testUserData); }
});

test('_writeSyncLinkToExistingSwitcherProfile: returns false and creates no folder when profile absent', async () => {
    _testUserData = makeTmpDir();
    try {
        const { _writeSyncLinkToExistingSwitcherProfile } = freshRequire('../platformSync');
        const ok = await _writeSyncLinkToExistingSwitcherProfile('epic', 'NonExistent', 'id002', {});
        assert.equal(ok, false);
        assert.equal(fs.existsSync(path.join(_testUserData, 'accounts', 'epic', 'NonExistent')), false);
    } finally { rmDir(_testUserData); }
});

test('_writeSyncLinkToExistingSwitcherProfile: returns false for phantom folder', async () => {
    _testUserData = makeTmpDir();
    try {
        const phantomDir = path.join(_testUserData, 'accounts', 'epic', 'Phantom');
        mkdirp(phantomDir);
        writeJson(path.join(phantomDir, 'sync_link.json'), { platformAccountId: 'old-id' });

        const { _writeSyncLinkToExistingSwitcherProfile } = freshRequire('../platformSync');
        const ok = await _writeSyncLinkToExistingSwitcherProfile('epic', 'Phantom', 'new-id', {});
        assert.equal(ok, false, 'Must not overwrite phantom profile');
        // Original sync_link must be untouched
        assert.equal(readJson(path.join(phantomDir, 'sync_link.json')).platformAccountId, 'old-id');
    } finally { rmDir(_testUserData); }
});

// ── _findMatchingEpicSwitcherProfile ─────────────────────────────────────────

test('_findMatchingEpicSwitcherProfile: matches by folder name (displayName)', async () => {
    _testUserData = makeTmpDir();
    try {
        const profileDir = path.join(epicSwitcherDir(_testUserData), 'JohnDoe');
        mkdirp(path.join(profileDir, 'Data'));

        const { _findMatchingEpicSwitcherProfile } = freshRequire('../platformSync');
        const match = await _findMatchingEpicSwitcherProfile('irrelevant-id', 'JohnDoe');
        assert.equal(match, 'JohnDoe');
    } finally { rmDir(_testUserData); }
});

test('_findMatchingEpicSwitcherProfile: matches by sync_link platformAccountId', async () => {
    _testUserData = makeTmpDir();
    try {
        const profileDir = path.join(epicSwitcherDir(_testUserData), 'JaneDoe');
        mkdirp(path.join(profileDir, 'Data'));
        writeJson(path.join(profileDir, 'sync_link.json'), { platformAccountId: 'acct-456' });

        const { _findMatchingEpicSwitcherProfile } = freshRequire('../platformSync');
        const match = await _findMatchingEpicSwitcherProfile('acct-456', 'SomeName');
        assert.equal(match, 'JaneDoe');
    } finally { rmDir(_testUserData); }
});

test('_findMatchingEpicSwitcherProfile: ignores phantom profiles when matching', async () => {
    _testUserData = makeTmpDir();
    try {
        // Phantom folder whose name matches displayName
        const phantomDir = path.join(epicSwitcherDir(_testUserData), 'PhantomMatch');
        mkdirp(phantomDir);
        writeJson(path.join(phantomDir, 'sync_link.json'), { platformAccountId: 'xyz' });

        const { _findMatchingEpicSwitcherProfile } = freshRequire('../platformSync');
        const match = await _findMatchingEpicSwitcherProfile('xyz', 'PhantomMatch');
        assert.equal(match, null, 'Phantom profile must not match');
    } finally { rmDir(_testUserData); }
});

test('_findMatchingEpicSwitcherProfile: returns null when no profile exists', async () => {
    _testUserData = makeTmpDir();
    try {
        const { _findMatchingEpicSwitcherProfile } = freshRequire('../platformSync');
        const match = await _findMatchingEpicSwitcherProfile('unknown-id', 'Unknown');
        assert.equal(match, null);
    } finally { rmDir(_testUserData); }
});

// ── Syncing Epic library must not create switcher profiles ────────────────────

test('Syncing Epic library (addToSwitcher false) must not create accounts/epic folder', async () => {
    _testUserData = makeTmpDir();
    try {
        // Ensure no switcher dir exists before sync
        const switcherDir = epicSwitcherDir(_testUserData);
        assert.equal(fs.existsSync(switcherDir), false);

        // Simulate what epicConnector.link would do — call _findMatchingEpicSwitcherProfile
        // then conditionally _writeSyncLinkToExistingSwitcherProfile.
        // With no pre-existing real switcher profiles, neither should create anything.
        const { _findMatchingEpicSwitcherProfile, _writeSyncLinkToExistingSwitcherProfile } = freshRequire('../platformSync');
        const match = await _findMatchingEpicSwitcherProfile('epic-abc', 'EpicUser');
        assert.equal(match, null, 'No match expected when no switcher profiles exist');
        // match is null, so _writeSyncLinkToExistingSwitcherProfile is NOT called.
        // Verify the switcher directory was never created.
        assert.equal(fs.existsSync(switcherDir), false, 'accounts/epic must not be created by library sync');
    } finally { rmDir(_testUserData); }
});
