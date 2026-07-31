'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { DownloadPreflightService } = require('../src/features/downloads/infrastructure/services/DownloadPreflightService');
const { DownloadFileSafetyService, MARKER_FILE } = require('../src/features/downloads/infrastructure/services/DownloadFileSafetyService');
const { GogDownloadAdapter } = require('../src/features/downloads/infrastructure/providers/gog/GogDownloadAdapter');

function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-file-safety-'));
}

function payload(installPath, extra = {}) {
    return {
        platform: 'gog',
        accountId: 'gog-1',
        title: 'Safety Game',
        providerProductId: '123',
        installPath,
        totalBytes: 100,
        ...extra,
    };
}

function taskFor(installPath, extra = {}) {
    return {
        id: 'dl_0123456789abcdef',
        identityKey: `gog:gog-1:123:${installPath.toLowerCase()}`,
        platform: 'gog',
        accountId: 'gog-1',
        providerProductId: '123',
        installPath,
        installRoot: path.dirname(installPath),
        ...extra,
    };
}

function prepareOwnedPartial(safety, installPath, extra = {}) {
    const task = taskFor(installPath, extra);
    const ownership = safety.prepareTaskOwnership(task);
    return { ...task, ...ownership };
}

test('download preflight is observational and creates no folder or marker', () => {
    const dir = tempDir();
    try {
        const installPath = path.join(dir, 'Safety Game');
        const preflight = new DownloadPreflightService();
        const valid = preflight.validateQueuePayload(payload(installPath, { installedDiskSizeBytes: 200 }));

        assert.equal(valid.installPath, installPath);
        assert.equal(valid.installPathWritable, true);
        assert.equal(valid.requiredSpaceBytes, 200);
        assert.ok(valid.diskSafetyMarginBytes >= 200);
        assert.equal(valid.partialDeletionEligible, true);
        assert.equal(fs.existsSync(installPath), false);
        assert.equal(fs.existsSync(path.join(installPath, MARKER_FILE)), false);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});



test('download preflight treats unresolved size as unknown, not zero bytes', () => {
    const dir = tempDir();
    try {
        const preflight = new DownloadPreflightService();
        const valid = preflight.validateQueuePayload(payload(path.join(dir, 'Unknown Size'), {
            totalBytes: null,
            expectedTotalBytes: null,
            installedDiskSizeBytes: null,
        }));
        assert.equal(valid.requiredSpaceBytes, null);
        assert.equal(valid.expectedTotalBytes, null);
        assert.equal(valid.sizeResolutionStatus, 'unresolved');
        assert.equal(valid.sizeResolutionFailureReason, 'not-provided-before-queue');
        assert.equal(fs.existsSync(valid.installPath), false);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('task ownership marker is created only during execution preparation', () => {
    const dir = tempDir();
    try {
        const installPath = path.join(dir, 'Safety Game');
        const safety = new DownloadFileSafetyService({ nonceFactory: () => 'nonce-1' });
        const preflight = new DownloadPreflightService({ fileSafety: safety });
        preflight.validateQueuePayload(payload(installPath));
        assert.equal(fs.existsSync(installPath), false);

        const task = prepareOwnedPartial(safety, installPath);
        const markerPath = path.join(installPath, MARKER_FILE);
        const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
        assert.equal(marker.version, 1);
        assert.equal(marker.taskId, task.id);
        assert.equal(marker.identityKey, task.identityKey);
        assert.equal(marker.provider, 'gog');
        assert.equal(marker.accountId, 'gog-1');
        assert.equal(marker.providerProductId, '123');
        assert.equal(marker.canonicalInstallPath, installPath);
        assert.equal(marker.ownershipNonce, 'nonce-1');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('partial deletion requires exact task marker identity and nonce', () => {
    const dir = tempDir();
    try {
        const safety = new DownloadFileSafetyService({ nonceFactory: () => 'nonce-1' });
        const installPath = path.join(dir, 'Owned Game');
        const task = prepareOwnedPartial(safety, installPath);
        fs.writeFileSync(path.join(installPath, 'partial.bin'), 'partial');

        assert.throws(() => safety.deletePartial({ ...task, taskId: undefined, id: 'dl_fedcba9876543210' }), err => err.code === 'DOWNLOAD_PARTIAL_DELETE_UNSAFE');
        assert.throws(() => safety.deletePartial({ ...task, identityKey: 'gog:gog-1:999:x' }), err => err.code === 'DOWNLOAD_PARTIAL_DELETE_UNSAFE');
        assert.throws(() => safety.deletePartial({ ...task, ownershipNonce: 'wrong' }), err => err.code === 'DOWNLOAD_PARTIAL_DELETE_UNSAFE');
        assert.equal(fs.existsSync(installPath), true);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('copied marker and marker path mismatch do not authorize deletion', () => {
    const dir = tempDir();
    try {
        const safety = new DownloadFileSafetyService({ nonceFactory: () => 'nonce-1' });
        const sourcePath = path.join(dir, 'Source Game');
        const targetPath = path.join(dir, 'Copied Game');
        const task = prepareOwnedPartial(safety, sourcePath);
        fs.mkdirSync(targetPath);
        fs.copyFileSync(path.join(sourcePath, MARKER_FILE), path.join(targetPath, MARKER_FILE));
        fs.writeFileSync(path.join(targetPath, 'partial.bin'), 'partial');

        assert.throws(() => safety.deletePartial({ ...task, installPath: targetPath }), err => err.code === 'DOWNLOAD_PARTIAL_DELETE_UNSAFE');
        assert.equal(fs.existsSync(targetPath), true);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('forged marker filename alone never authorizes deletion', () => {
    const dir = tempDir();
    try {
        const safety = new DownloadFileSafetyService();
        const installPath = path.join(dir, 'Forged Game');
        fs.mkdirSync(installPath);
        fs.writeFileSync(path.join(installPath, MARKER_FILE), JSON.stringify({ owner: 'baddel' }));
        fs.writeFileSync(path.join(installPath, 'partial.bin'), 'partial');

        assert.throws(() => safety.deletePartial(taskFor(installPath, { ownershipNonce: 'nonce' })), err => err.code === 'DOWNLOAD_PARTIAL_DELETE_UNSAFE');
        assert.equal(fs.existsSync(installPath), true);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('download preflight rejects drive roots, protected roots, existing games, and insufficient space', () => {
    const dir = tempDir();
    try {
        const safety = new DownloadFileSafetyService({ protectedRoots: [path.join(dir, 'App'), path.join(dir, 'UserData')] });
        const preflight = new DownloadPreflightService({ fileSafety: safety });
        assert.throws(() => preflight.validateQueuePayload(payload(path.parse(dir).root)), err => err.code === 'DOWNLOAD_INVALID_INSTALL_PATH');
        assert.throws(() => preflight.validateQueuePayload(payload(path.join(dir, 'App', 'Blocked'))), err => err.code === 'DOWNLOAD_INVALID_INSTALL_PATH');
        assert.throws(() => preflight.validateQueuePayload(payload(path.join(dir, 'UserData', 'Blocked'))), err => err.code === 'DOWNLOAD_INVALID_INSTALL_PATH');

        const existingGame = path.join(dir, 'Existing Game');
        fs.mkdirSync(existingGame);
        fs.writeFileSync(path.join(existingGame, 'game.exe'), 'not ours');
        assert.throws(() => preflight.validateQueuePayload(payload(existingGame)), err => err.code === 'DOWNLOAD_INSTALL_PATH_NOT_EMPTY');

        const fakeFs = { ...fs, statfsSync: () => ({ bsize: 1024, bavail: 1 }) };
        const lowSpace = new DownloadPreflightService({ fsSync: fakeFs });
        assert.throws(() => lowSpace.validateQueuePayload(payload(path.join(dir, 'Huge Game'), { totalBytes: 10_000_000 })), err => err.code === 'DOWNLOAD_INSUFFICIENT_DISK_SPACE');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('partial deletion rejects library roots, unrelated files, and pre-existing files', () => {
    const dir = tempDir();
    try {
        const safety = new DownloadFileSafetyService({ nonceFactory: () => 'nonce-1' });
        const libraryRoot = path.join(dir, 'Library');
        fs.mkdirSync(libraryRoot);
        assert.throws(() => safety.deletePartial(taskFor(libraryRoot, { installRoot: libraryRoot, ownershipNonce: 'nonce-1' })), err => err.code === 'DOWNLOAD_PARTIAL_DELETE_UNSAFE');

        const installPath = path.join(libraryRoot, 'Owned Game');
        const task = prepareOwnedPartial(safety, installPath, { installRoot: libraryRoot });
        fs.writeFileSync(path.join(installPath, 'partial.bin'), 'partial');
        const marker = JSON.parse(fs.readFileSync(path.join(installPath, MARKER_FILE), 'utf8'));
        marker.createdAt = new Date(Date.now() + 60_000).toISOString();
        fs.writeFileSync(path.join(installPath, MARKER_FILE), JSON.stringify(marker, null, 2));
        assert.throws(() => safety.deletePartial(task), err => err.code === 'DOWNLOAD_PARTIAL_DELETE_UNSAFE');
        assert.equal(fs.existsSync(installPath), true);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('delete partial deletes only current task-owned data and keep partial does no deletion', () => {
    const dir = tempDir();
    try {
        const safety = new DownloadFileSafetyService({ nonceFactory: () => 'nonce-1' });
        const installPath = path.join(dir, 'Partial Game');
        const task = prepareOwnedPartial(safety, installPath);
        fs.writeFileSync(path.join(installPath, 'partial.bin'), 'partial');

        safety.assertSafePartialDelete(task);
        assert.equal(fs.existsSync(installPath), true);
        const deleted = safety.deletePartial(task);
        assert.equal(deleted.deleted, true);
        assert.equal(fs.existsSync(installPath), false);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('locked or partial cleanup failure returns DOWNLOAD_PARTIAL_DELETE_FAILED', () => {
    const dir = tempDir();
    try {
        const installPath = path.join(dir, 'Locked Game');
        const realSafety = new DownloadFileSafetyService({ nonceFactory: () => 'nonce-1' });
        const task = prepareOwnedPartial(realSafety, installPath);
        fs.writeFileSync(path.join(installPath, 'partial.bin'), 'partial');
        const fakeFs = { ...fs, rmSync: () => { throw new Error('locked'); } };
        const safety = new DownloadFileSafetyService({ fsSync: fakeFs });
        assert.throws(() => safety.deletePartial(task), err => err.code === 'DOWNLOAD_PARTIAL_DELETE_FAILED');
        assert.equal(fs.existsSync(installPath), true);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('TOCTOU and reparse-point checks run immediately before deletion', () => {
    const dir = tempDir();
    try {
        const installPath = path.join(dir, 'Reparse Game');
        const realSafety = new DownloadFileSafetyService({ nonceFactory: () => 'nonce-1' });
        const task = prepareOwnedPartial(realSafety, installPath);
        fs.writeFileSync(path.join(installPath, 'partial.bin'), 'partial');
        let calls = 0;
        const safety = new DownloadFileSafetyService({
            isReparsePoint: () => {
                calls += 1;
                return calls > 2;
            },
        });
        assert.throws(() => safety.deletePartial(task), err => err.code === 'DOWNLOAD_INVALID_INSTALL_PATH' || err.code === 'DOWNLOAD_PARTIAL_DELETE_UNSAFE');
        assert.equal(fs.existsSync(installPath), true);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('completion verification ignores Baddel marker and support metadata', () => {
    const dir = tempDir();
    try {
        const installPath = path.join(dir, 'Marker Only');
        const safety = new DownloadFileSafetyService({ nonceFactory: () => 'nonce-1' });
        prepareOwnedPartial(safety, installPath);
        fs.mkdirSync(path.join(installPath, '.baddel-gog-support'), { recursive: true });
        fs.writeFileSync(path.join(installPath, '.baddel-gog-support', 'manifest.json'), '{}');
        const adapter = new GogDownloadAdapter({ runtime: {}, discovery: {}, userDataDir: dir });
        const verification = adapter.verifyInstalledGame(installPath, { expectedBytes: 100 });
        assert.equal(verification.status, 'failed');
        assert.equal(verification.actualBytes, 0);
        assert.equal(verification.verifiedFileCount, 0);
        assert.equal(verification.executableFound, false);
        assert.equal(verification.manifestFound, false);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('install path safety rejects symlink or junction path segments without touching target', () => {
    const dir = tempDir();
    try {
        const libraryRoot = path.join(dir, 'Library');
        const linkPath = path.join(libraryRoot, 'LinkGame');
        fs.mkdirSync(libraryRoot);
        const fakeFs = {
            ...fs,
            existsSync: (value) => {
                const normalized = path.normalize(String(value));
                return normalized === path.normalize(libraryRoot) || normalized === path.normalize(linkPath) || fs.existsSync(value);
            },
            lstatSync: (value) => {
                const normalized = path.normalize(String(value));
                if (normalized === path.normalize(linkPath)) return { isSymbolicLink: () => true };
                return { isSymbolicLink: () => false };
            },
        };
        const safety = new DownloadFileSafetyService({ fsSync: fakeFs });
        assert.throws(() => safety.assertSafePartialDelete({ installPath: linkPath, installRoot: libraryRoot }), err => err.code === 'DOWNLOAD_INVALID_INSTALL_PATH');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});


test('resume ownership validation accepts exact task-owned partial folder without rewriting marker', () => {
    const dir = tempDir();
    try {
        const safety = new DownloadFileSafetyService({ nonceFactory: () => 'nonce-1' });
        const installPath = path.join(dir, 'Resume Partial');
        const task = prepareOwnedPartial(safety, installPath);
        const markerPath = path.join(installPath, MARKER_FILE);
        const markerBefore = fs.readFileSync(markerPath, 'utf8');
        fs.writeFileSync(path.join(installPath, 'partial.bin'), 'partial bytes');

        const resumePatch = safety.prepareTaskOwnership(task);
        const markerAfter = fs.readFileSync(markerPath, 'utf8');

        assert.equal(resumePatch.ownershipNonce, 'nonce-1');
        assert.equal(resumePatch.installPathOwnershipPreparedAt, JSON.parse(markerBefore).createdAt);
        assert.equal(markerAfter, markerBefore);
        assert.equal(fs.existsSync(path.join(installPath, 'partial.bin')), true);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('resume ownership validation rejects missing marker and mismatched canonical path', () => {
    const dir = tempDir();
    try {
        const safety = new DownloadFileSafetyService({ nonceFactory: () => 'nonce-1' });
        const installPath = path.join(dir, 'Resume Reject');
        const task = prepareOwnedPartial(safety, installPath);
        const markerPath = path.join(installPath, MARKER_FILE);
        const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
        fs.unlinkSync(markerPath);
        assert.throws(() => safety.prepareTaskOwnership(task), err => err.code === 'DOWNLOAD_PARTIAL_DELETE_UNSAFE');

        fs.writeFileSync(markerPath, JSON.stringify({ ...marker, canonicalInstallPath: path.join(dir, 'Other') }, null, 2));
        assert.throws(() => safety.prepareTaskOwnership(task), err => err.code === 'DOWNLOAD_PARTIAL_DELETE_UNSAFE');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
