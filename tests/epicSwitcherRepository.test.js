'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const {
    EpicSwitcherRepository,
} = require('../src/features/sync/infrastructure/repositories/EpicSwitcherRepository');

const FIXED_DATE = new Date('2026-01-02T03:04:05.000Z');

function makeTmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-epic-repo-'));
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

function createHarness() {
    const tmpDir = makeTmpDir();
    const accountsRootDir = path.join(tmpDir, 'accounts');
    const repository = new EpicSwitcherRepository({
        accountsRootDir,
        clock: () => FIXED_DATE,
    });
    return {
        tmpDir,
        accountsRootDir,
        repository,
        epicDir: () => path.join(accountsRootDir, 'epic'),
        profileDir: (name) => path.join(accountsRootDir, 'epic', name),
    };
}

test('EpicSwitcherRepository writes sync_link.json with exact shape and pretty formatting', async () => {
    const harness = createHarness();
    try {
        const dir = harness.profileDir('ShapeUser');
        mkdirp(path.join(dir, 'Data'));

        const result = await harness.repository.writeSyncLinkToExistingProfile('epic', 'ShapeUser', 12345, {
            epicDisplayName: 'ShapeUser',
        });

        assert.deepEqual(result, { ok: true });
        const raw = fs.readFileSync(path.join(dir, 'sync_link.json'), 'utf8');
        assert.match(raw, /\n  "platformAccountId": "12345",\n/);
        assert.match(raw, /\n  "linkedAt": "2026-01-02T03:04:05.000Z",\n/);
        assert.match(raw, /\n  "epicDisplayName": "ShapeUser"\n/);

        assert.deepEqual(readJson(path.join(dir, 'sync_link.json')), {
            platformAccountId: '12345',
            linkedAt: '2026-01-02T03:04:05.000Z',
            epicDisplayName: 'ShapeUser',
        });
    } finally {
        rmDir(harness.tmpDir);
    }
});

test('EpicSwitcherRepository overwrites existing sync_link.json for real Epic profile', async () => {
    const harness = createHarness();
    try {
        const dir = harness.profileDir('OverwriteUser');
        mkdirp(path.join(dir, 'Config'));
        writeJson(path.join(dir, 'sync_link.json'), {
            platformAccountId: 'old-id',
            linkedAt: 'old-date',
            oldField: true,
        });

        const result = await harness.repository.writeSyncLinkToExistingProfile('epic', 'OverwriteUser', 'new-id', {
            epicDisplayName: 'New Name',
        });

        assert.deepEqual(result, { ok: true });
        assert.deepEqual(readJson(path.join(dir, 'sync_link.json')), {
            platformAccountId: 'new-id',
            linkedAt: '2026-01-02T03:04:05.000Z',
            epicDisplayName: 'New Name',
        });
    } finally {
        rmDir(harness.tmpDir);
    }
});

test('EpicSwitcherRepository does not create missing profile directories', async () => {
    const harness = createHarness();
    try {
        const result = await harness.repository.writeSyncLinkToExistingProfile('epic', 'MissingUser', 'id-1');

        assert.deepEqual(result, { ok: false, reason: 'missing_profile' });
        assert.equal(fs.existsSync(harness.profileDir('MissingUser')), false);
        assert.equal(fs.existsSync(harness.epicDir()), false);
    } finally {
        rmDir(harness.tmpDir);
    }
});

test('EpicSwitcherRepository does not write phantom Epic profiles', async () => {
    const harness = createHarness();
    try {
        const dir = harness.profileDir('PhantomUser');
        mkdirp(dir);
        writeJson(path.join(dir, 'sync_link.json'), { platformAccountId: 'old-id' });

        const result = await harness.repository.writeSyncLinkToExistingProfile('epic', 'PhantomUser', 'new-id');

        assert.deepEqual(result, { ok: false, reason: 'phantom_profile' });
        assert.deepEqual(readJson(path.join(dir, 'sync_link.json')), { platformAccountId: 'old-id' });
    } finally {
        rmDir(harness.tmpDir);
    }
});

test('EpicSwitcherRepository finds profile by sync_link.json platformAccountId', async () => {
    const harness = createHarness();
    try {
        const dir = harness.profileDir('JaneDoe');
        mkdirp(path.join(dir, 'Data'));
        writeJson(path.join(dir, 'sync_link.json'), { platformAccountId: 'acct-456' });

        const match = await harness.repository.findMatchingEpicProfile('acct-456', 'SomeName');

        assert.equal(match, 'JaneDoe');
    } finally {
        rmDir(harness.tmpDir);
    }
});

test('EpicSwitcherRepository falls back to folder-name matching when sync_link.json is missing', async () => {
    const harness = createHarness();
    try {
        mkdirp(path.join(harness.profileDir('FolderOnly'), 'Data'));

        const match = await harness.repository.findMatchingEpicProfile('missing-id', ' folderonly ');

        assert.equal(match, 'FolderOnly');
    } finally {
        rmDir(harness.tmpDir);
    }
});

test('EpicSwitcherRepository ignores corrupt sync_link.json and continues matching', async () => {
    const harness = createHarness();
    try {
        const corruptDir = harness.profileDir('CorruptUser');
        mkdirp(path.join(corruptDir, 'Data'));
        fs.writeFileSync(path.join(corruptDir, 'sync_link.json'), '{not-json', 'utf8');

        const laterDir = harness.profileDir('LaterUser');
        mkdirp(path.join(laterDir, 'Data'));
        writeJson(path.join(laterDir, 'sync_link.json'), { platformAccountId: 'target-id' });

        const match = await harness.repository.findMatchingEpicProfile('target-id', 'NoName');

        assert.equal(match, 'LaterUser');
    } finally {
        rmDir(harness.tmpDir);
    }
});

test('EpicSwitcherRepository supports epicDisplayName matching through filesystem reads', async () => {
    const harness = createHarness();
    try {
        const dir = harness.profileDir('DifferentFolder');
        mkdirp(path.join(dir, 'webcache'));
        writeJson(path.join(dir, 'sync_link.json'), { epicDisplayName: 'Visible Epic Name' });

        const match = await harness.repository.findMatchingEpicProfile('', ' visible epic name ');

        assert.equal(match, 'DifferentFolder');
    } finally {
        rmDir(harness.tmpDir);
    }
});

test('EpicSwitcherRepository keeps directory-order first match and skips files', async () => {
    const harness = createHarness();
    try {
        mkdirp(harness.epicDir());
        fs.writeFileSync(path.join(harness.epicDir(), 'NotADirectory'), 'ignored', 'utf8');

        const firstDir = harness.profileDir('AFirst');
        mkdirp(path.join(firstDir, 'Data'));
        writeJson(path.join(firstDir, 'sync_link.json'), { platformAccountId: 'same-id' });

        const secondDir = harness.profileDir('BSecond');
        mkdirp(path.join(secondDir, 'Data'));
        writeJson(path.join(secondDir, 'sync_link.json'), { platformAccountId: 'same-id' });

        const match = await harness.repository.findMatchingEpicProfile('same-id', '');

        assert.equal(match, 'AFirst');
    } finally {
        rmDir(harness.tmpDir);
    }
});

test('EpicSwitcherRepository returns null when no Epic switcher directory or no profile matches', async () => {
    const harness = createHarness();
    try {
        assert.equal(await harness.repository.findMatchingEpicProfile('id-1', 'Missing'), null);

        mkdirp(path.join(harness.profileDir('OtherUser'), 'Data'));
        assert.equal(await harness.repository.findMatchingEpicProfile('id-1', 'Missing'), null);
    } finally {
        rmDir(harness.tmpDir);
    }
});
