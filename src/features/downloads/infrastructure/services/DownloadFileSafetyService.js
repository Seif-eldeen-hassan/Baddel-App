'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MARKER_FILE = '.baddel-download-partial.json';
const MARKER_VERSION = 1;
const MIN_SAFETY_MARGIN_BYTES = 1024 * 1024 * 1024;
const SAFETY_MARGIN_RATIO = 0.1;
const ATTRIBUTION_TIME_TOLERANCE_MS = 2000;

function makeDownloadError(code, message) {
    const err = new Error(message || code);
    err.code = code;
    return err;
}

function normalizePath(pathModule, value) {
    return pathModule.resolve(pathModule.normalize(String(value || '').trim()));
}

function canonicalKey(pathModule, value) {
    return normalizePath(pathModule, value).toLowerCase();
}

function samePath(pathModule, a, b) {
    return canonicalKey(pathModule, a) === canonicalKey(pathModule, b);
}

function isSubPath(pathModule, child, parent) {
    const rel = pathModule.relative(normalizePath(pathModule, parent), normalizePath(pathModule, child));
    return Boolean(rel) && !rel.startsWith('..') && !pathModule.isAbsolute(rel);
}

function defaultProtectedRoots(pathModule) {
    return [
        process.env.SystemRoot || 'C:\\Windows',
        process.env.ProgramFiles || 'C:\\Program Files',
        process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    ].filter(Boolean).map(p => canonicalKey(pathModule, p));
}

class DownloadFileSafetyService {
    constructor({
        fsSync = fs,
        pathModule = path,
        clock = Date,
        protectedRoots = null,
        safetyMarginRatio = SAFETY_MARGIN_RATIO,
        minSafetyMarginBytes = MIN_SAFETY_MARGIN_BYTES,
        nonceFactory = null,
        isReparsePoint = null,
    } = {}) {
        this.fs = fsSync;
        this.path = pathModule;
        this.clock = clock;
        this.protectedRoots = (protectedRoots || defaultProtectedRoots(pathModule))
            .filter(Boolean)
            .map(p => canonicalKey(pathModule, p));
        this.safetyMarginRatio = safetyMarginRatio;
        this.minSafetyMarginBytes = minSafetyMarginBytes;
        this.nonceFactory = nonceFactory || (() => crypto.randomBytes(16).toString('hex'));
        this.isReparsePoint = isReparsePoint || (() => false);
    }

    inspectInstallPath(payload = {}) {
        const installPath = normalizePath(this.path, payload.installPath);
        const root = this.path.parse(installPath).root;
        if (!root || samePath(this.path, installPath, root)) {
            throw makeDownloadError('DOWNLOAD_INVALID_INSTALL_PATH', 'Choose a game folder, not a drive root.');
        }
        this.assertNotProtected(installPath);
        this.assertNoLinkOrReparseEscape(installPath);

        const existedBefore = this.fs.existsSync(installPath);
        if (existedBefore && !this.fs.statSync(installPath).isDirectory()) {
            throw makeDownloadError('DOWNLOAD_INVALID_INSTALL_PATH', 'Choose a folder path, not a file.');
        }

        const existingEntries = existedBefore ? this.safeReadDir(installPath).filter(name => !this.isBaddelMetadataName(name)) : [];
        if (existingEntries.length > 0) {
            throw makeDownloadError('DOWNLOAD_INSTALL_PATH_NOT_EMPTY', 'Choose an empty install folder. Existing game folders are protected.');
        }

        this.assertWritableWithoutMutation(installPath);

        const installRoot = payload.installRoot ? normalizePath(this.path, payload.installRoot) : this.path.dirname(installPath);
        const installFolder = payload.installFolder ? String(payload.installFolder) : this.path.basename(installPath);
        const requiredSpaceBytes = this.calculateRequiredBytes(payload);
        const diskSafetyMarginBytes = this.calculateSafetyMargin(requiredSpaceBytes);
        const freeSpaceBytesAtQueue = this.getFreeSpaceBytes(existedBefore ? installPath : this.path.dirname(installPath));
        if (
            Number.isFinite(freeSpaceBytesAtQueue) &&
            Number.isFinite(requiredSpaceBytes) &&
            requiredSpaceBytes > 0 &&
            freeSpaceBytesAtQueue < requiredSpaceBytes + diskSafetyMarginBytes
        ) {
            throw makeDownloadError('DOWNLOAD_INSUFFICIENT_DISK_SPACE', 'Not enough free space for this download. Free up disk space or choose another drive.');
        }

        return {
            installPath,
            installRoot,
            installFolder,
            installDriveRoot: root,
            installParentPath: this.path.dirname(installPath),
            installPathCreatedByBaddel: !existedBefore,
            installPathPreflightAt: new this.clock().toISOString(),
            installPathWritable: true,
            freeSpaceBytesAtQueue: Number.isFinite(freeSpaceBytesAtQueue) ? freeSpaceBytesAtQueue : null,
            requiredSpaceBytes,
            diskSafetyMarginBytes,
            partialDeletionEligible: true,
            partialDeletionMarkerPath: this.path.join(installPath, MARKER_FILE),
        };
    }

    prepareTaskOwnership(task = {}) {
        if (task.ownershipNonce) return this.validateOwnedPartialForResume(task);
        return this.prepareInitialTaskOwnership(task);
    }

    prepareInitialTaskOwnership(task = {}) {
        const installPath = normalizePath(this.path, task.installPath);
        const existedBefore = this.fs.existsSync(installPath);
        if (existedBefore && !this.fs.statSync(installPath).isDirectory()) {
            throw makeDownloadError('DOWNLOAD_INVALID_INSTALL_PATH', 'Choose a folder path, not a file.');
        }
        this.assertNotProtected(installPath);
        this.assertNoLinkOrReparseEscape(installPath);
        if (!existedBefore) this.fs.mkdirSync(installPath, { recursive: true });
        const entries = this.safeReadDir(installPath).filter(name => !this.isBaddelMetadataName(name));
        if (entries.length > 0) {
            throw makeDownloadError('DOWNLOAD_INSTALL_PATH_NOT_EMPTY', 'Choose an empty install folder. Existing game folders are protected.');
        }
        this.assertWritableByProbe(installPath);

        const markerPath = this.path.join(installPath, MARKER_FILE);
        const ownershipNonce = task.ownershipNonce || this.nonceFactory();
        const marker = {
            version: MARKER_VERSION,
            owner: 'baddel',
            type: 'download-partial',
            taskId: String(task.id || ''),
            identityKey: String(task.identityKey || ''),
            provider: String(task.platform || ''),
            accountId: task.accountId ? String(task.accountId) : null,
            providerProductId: task.providerProductId ? String(task.providerProductId) : null,
            canonicalInstallPath: installPath,
            createdAt: new this.clock().toISOString(),
            ownershipNonce,
        };
        this.fs.writeFileSync(markerPath, JSON.stringify(marker, null, 2), 'utf8');
        return {
            ownershipNonce,
            partialDeletionEligible: true,
            partialDeletionMarkerPath: markerPath,
            installPathCreatedByBaddel: !existedBefore,
            installPathOwnershipPreparedAt: marker.createdAt,
        };
    }

    validateOwnedPartialForResume(task = {}) {
        const installPath = normalizePath(this.path, task.installPath);
        const root = this.path.parse(installPath).root;
        if (!root || samePath(this.path, installPath, root)) {
            throw makeDownloadError('DOWNLOAD_PARTIAL_DELETE_UNSAFE', 'Baddel will not use a drive root as a partial download folder.');
        }
        this.assertNotProtected(installPath);
        this.assertNoLinkOrReparseEscape(installPath);
        if (!this.fs.existsSync(installPath) || !this.fs.statSync(installPath).isDirectory()) {
            throw makeDownloadError('DOWNLOAD_PARTIAL_DELETE_UNSAFE', 'The partial install folder does not exist.');
        }
        const marker = this.readAndValidateMarker(task, installPath);
        this.assertDirectoryOwnedByTask(installPath, marker);
        const resolvedAgain = normalizePath(this.path, installPath);
        if (!samePath(this.path, resolvedAgain, marker.canonicalInstallPath)) {
            throw makeDownloadError('DOWNLOAD_PARTIAL_DELETE_UNSAFE', 'The install path changed during ownership validation.');
        }
        this.assertNoLinkOrReparseEscape(resolvedAgain);
        this.assertWritableByProbe(installPath);
        return {
            ownershipNonce: marker.ownershipNonce,
            partialDeletionEligible: true,
            partialDeletionMarkerPath: this.path.join(installPath, MARKER_FILE),
            installPathCreatedByBaddel: task.installPathCreatedByBaddel === true,
            installPathOwnershipPreparedAt: marker.createdAt,
        };
    }

    cleanupFailedStart(task = {}) {
        try {
            const installPath = this.assertSafePartialDelete(task, { allowEmptyOnly: true });
            const entries = this.safeReadDir(installPath).filter(name => !this.isBaddelMetadataName(name));
            if (entries.length > 0) return { deleted: false, reason: 'not-empty' };
            this.fs.rmSync(installPath, { recursive: true, force: true });
            return { deleted: true, deletedPath: installPath, partialDeletedAt: new this.clock().toISOString() };
        } catch (err) {
            if (err?.code) return { deleted: false, reason: err.code };
            return { deleted: false, reason: 'DOWNLOAD_PARTIAL_DELETE_FAILED' };
        }
    }

    assertSafePartialDelete(task = {}, { allowEmptyOnly = false } = {}) {
        const installPath = normalizePath(this.path, task.installPath);
        const root = this.path.parse(installPath).root;
        if (!root || samePath(this.path, installPath, root)) {
            throw makeDownloadError('DOWNLOAD_PARTIAL_DELETE_UNSAFE', 'Baddel will not delete a drive root.');
        }
        this.assertNotProtected(installPath);
        this.assertNoLinkOrReparseEscape(installPath);
        if (task.installRoot) {
            const installRoot = normalizePath(this.path, task.installRoot);
            if (samePath(this.path, installPath, installRoot)) {
                throw makeDownloadError('DOWNLOAD_PARTIAL_DELETE_UNSAFE', 'Baddel will not delete a library root.');
            }
            if (!isSubPath(this.path, installPath, installRoot) && !samePath(this.path, this.path.dirname(installPath), installRoot)) {
                throw makeDownloadError('DOWNLOAD_PARTIAL_DELETE_UNSAFE', 'Baddel will not delete a folder outside the selected library.');
            }
        }
        if (!this.fs.existsSync(installPath) || !this.fs.statSync(installPath).isDirectory()) {
            throw makeDownloadError('DOWNLOAD_PARTIAL_DELETE_UNSAFE', 'The partial install folder does not exist.');
        }
        const marker = this.readAndValidateMarker(task, installPath);
        this.assertDirectoryOwnedByTask(installPath, marker, { allowEmptyOnly });
        const resolvedAgain = normalizePath(this.path, installPath);
        if (!samePath(this.path, resolvedAgain, marker.canonicalInstallPath)) {
            throw makeDownloadError('DOWNLOAD_PARTIAL_DELETE_UNSAFE', 'The install path changed during cleanup.');
        }
        this.assertNoLinkOrReparseEscape(resolvedAgain);
        return resolvedAgain;
    }

    deletePartial(task = {}) {
        const installPath = this.assertSafePartialDelete(task);
        try {
            this.fs.rmSync(installPath, { recursive: true, force: false });
        } catch (err) {
            throw makeDownloadError('DOWNLOAD_PARTIAL_DELETE_FAILED', 'Baddel could not safely delete all partial files.');
        }
        return {
            deleted: true,
            deletedPath: installPath,
            partialDeletedAt: new this.clock().toISOString(),
        };
    }

    assertManagedOwnershipProof(task = {}) {
        if (task.status !== 'completed' || task.uninstallEligible !== true || !task.installedGameId) {
            throw makeDownloadError('DOWNLOAD_UNINSTALL_NOT_MANAGED', 'Only completed Baddel-managed games can be uninstalled.');
        }
        if (!task.ownershipNonce || !task.partialDeletionMarkerPath || !task.installPath) {
            throw makeDownloadError('DOWNLOAD_UNINSTALL_UNSAFE', 'The Baddel ownership proof for this installation is missing.');
        }
        const installPath = normalizePath(this.path, task.installPath);
        const root = this.path.parse(installPath).root;
        if (!root || samePath(this.path, installPath, root)) {
            throw makeDownloadError('DOWNLOAD_UNINSTALL_UNSAFE', 'Baddel will not uninstall a drive root.');
        }
        this.assertNotProtected(installPath);
        this.assertNoLinkOrReparseEscape(installPath);
        if (task.installRoot) {
            const installRoot = normalizePath(this.path, task.installRoot);
            if (samePath(this.path, installPath, installRoot)) {
                throw makeDownloadError('DOWNLOAD_UNINSTALL_UNSAFE', 'Baddel will not uninstall a library root.');
            }
            if (!isSubPath(this.path, installPath, installRoot) && !samePath(this.path, this.path.dirname(installPath), installRoot)) {
                throw makeDownloadError('DOWNLOAD_UNINSTALL_UNSAFE', 'The game folder is outside its Baddel library root.');
            }
        }
        if (!this.fs.existsSync(installPath) || !this.fs.statSync(installPath).isDirectory()) {
            throw makeDownloadError('DOWNLOAD_UNINSTALL_UNSAFE', 'The managed game folder does not exist.');
        }
        const expectedMarkerPath = this.path.join(installPath, MARKER_FILE);
        if (!samePath(this.path, task.partialDeletionMarkerPath, expectedMarkerPath)) {
            throw makeDownloadError('DOWNLOAD_UNINSTALL_UNSAFE', 'The ownership marker path does not match this game folder.');
        }
        const marker = this.readAndValidateMarker(task, installPath);
        if (!samePath(this.path, marker.canonicalInstallPath, installPath)) {
            throw makeDownloadError('DOWNLOAD_UNINSTALL_UNSAFE', 'The ownership marker points to a different folder.');
        }
        return installPath;
    }

    assertSafeManagedUninstall(task = {}) {
        try {
            const installPath = this.assertManagedOwnershipProof(task);
            const marker = this.readAndValidateMarker(task, installPath);
            this.assertDirectoryOwnedByTask(installPath, marker);
            this.assertNoLinkOrReparseEscape(installPath);
            return installPath;
        } catch (cause) {
            if (cause?.code === 'DOWNLOAD_UNINSTALL_NOT_MANAGED') throw cause;
            const err = makeDownloadError('DOWNLOAD_UNINSTALL_UNSAFE', 'Baddel could not prove that this exact game folder is safe to uninstall.');
            err.cause = cause;
            throw err;
        }
    }

    deleteManagedInstall(task = {}) {
        const installPath = this.assertSafeManagedUninstall(task);
        try {
            this.fs.rmSync(installPath, { recursive: true, force: false });
        } catch (cause) {
            const err = makeDownloadError('DOWNLOAD_UNINSTALL_DELETE_FAILED', 'Baddel could not remove the game folder. Close the game and try again.');
            err.cause = cause;
            throw err;
        }
        return { deleted: true, deletedPath: installPath };
    }

    readAndValidateMarker(task, installPath) {
        const markerPath = this.path.join(installPath, MARKER_FILE);
        if (!this.fs.existsSync(markerPath)) {
            throw makeDownloadError('DOWNLOAD_PARTIAL_DELETE_UNSAFE', 'Baddel will only delete task-owned partial folders.');
        }
        let marker;
        try { marker = JSON.parse(this.fs.readFileSync(markerPath, 'utf8')); } catch {
            throw makeDownloadError('DOWNLOAD_PARTIAL_DELETE_UNSAFE', 'The partial ownership marker is invalid.');
        }
        const expected = {
            taskId: String(task.id || ''),
            identityKey: String(task.identityKey || ''),
            provider: String(task.platform || ''),
            accountId: task.accountId ? String(task.accountId) : null,
            providerProductId: task.providerProductId ? String(task.providerProductId) : null,
            ownershipNonce: task.ownershipNonce ? String(task.ownershipNonce) : null,
        };
        if (marker.version !== MARKER_VERSION || marker.owner !== 'baddel' || marker.type !== 'download-partial') {
            throw makeDownloadError('DOWNLOAD_PARTIAL_DELETE_UNSAFE', 'The partial ownership marker is not trusted.');
        }
        if (!expected.taskId || marker.taskId !== expected.taskId) throw makeDownloadError('DOWNLOAD_PARTIAL_DELETE_UNSAFE', 'The partial marker belongs to another task.');
        if (!expected.identityKey || marker.identityKey !== expected.identityKey) throw makeDownloadError('DOWNLOAD_PARTIAL_DELETE_UNSAFE', 'The partial marker identity does not match this task.');
        if (!expected.ownershipNonce || marker.ownershipNonce !== expected.ownershipNonce) throw makeDownloadError('DOWNLOAD_PARTIAL_DELETE_UNSAFE', 'The partial marker nonce does not match this task.');
        if (marker.provider !== expected.provider || marker.accountId !== expected.accountId || marker.providerProductId !== expected.providerProductId) {
            throw makeDownloadError('DOWNLOAD_PARTIAL_DELETE_UNSAFE', 'The partial marker provider identity does not match this task.');
        }
        if (!marker.canonicalInstallPath || !samePath(this.path, marker.canonicalInstallPath, installPath)) {
            throw makeDownloadError('DOWNLOAD_PARTIAL_DELETE_UNSAFE', 'The partial marker path does not match this folder.');
        }
        return marker;
    }

    assertDirectoryOwnedByTask(installPath, marker, { allowEmptyOnly = false } = {}) {
        const markerCreatedAt = Date.parse(marker.createdAt || '') || 0;
        let gameDataSeen = false;
        const walk = (dir) => {
            for (const entry of this.fs.readdirSync(dir, { withFileTypes: true })) {
                const full = this.path.join(dir, entry.name);
                const rel = this.path.relative(installPath, full).replace(/\\/g, '/');
                if (this.isBaddelMetadataPath(rel)) continue;
                const stat = this.fs.lstatSync(full);
                if (this.isUnsafeLinkOrReparse(full, stat)) {
                    throw makeDownloadError('DOWNLOAD_PARTIAL_DELETE_UNSAFE', 'Baddel will not delete through symlinks, junctions, or reparse points.');
                }
                if (allowEmptyOnly) {
                    throw makeDownloadError('DOWNLOAD_PARTIAL_DELETE_UNSAFE', 'The folder is no longer empty.');
                }
                const createdAt = Number(stat.birthtimeMs || stat.ctimeMs || 0);
                if (markerCreatedAt && createdAt && createdAt < markerCreatedAt - ATTRIBUTION_TIME_TOLERANCE_MS) {
                    throw makeDownloadError('DOWNLOAD_PARTIAL_DELETE_UNSAFE', 'The folder contains files that predate this download task.');
                }
                gameDataSeen = true;
                if (entry.isDirectory()) walk(full);
                else if (!entry.isFile()) {
                    throw makeDownloadError('DOWNLOAD_PARTIAL_DELETE_UNSAFE', 'The folder contains unclassified filesystem entries.');
                }
            }
        };
        walk(installPath);
        return gameDataSeen;
    }

    assertNotProtected(installPath) {
        const normalized = canonicalKey(this.path, installPath);
        for (const protectedRoot of this.protectedRoots) {
            if (normalized === protectedRoot || normalized.startsWith(`${protectedRoot}${this.path.sep}`)) {
                throw makeDownloadError('DOWNLOAD_INVALID_INSTALL_PATH', 'Choose a game library folder, not a protected system or application folder.');
            }
        }
    }

    assertNoLinkOrReparseEscape(installPath) {
        const normalized = normalizePath(this.path, installPath);
        const root = this.path.parse(normalized).root;
        let current = root;
        const parts = this.path.relative(root, normalized).split(/[\\/]+/).filter(Boolean);
        for (const part of parts) {
            current = this.path.join(current, part);
            if (!this.fs.existsSync(current)) continue;
            const stat = this.fs.lstatSync(current);
            if (this.isUnsafeLinkOrReparse(current, stat)) {
                throw makeDownloadError('DOWNLOAD_INVALID_INSTALL_PATH', 'Choose a folder without symlink, junction, mount-point, or reparse redirects.');
            }
        }
    }

    isUnsafeLinkOrReparse(fullPath, stat) {
        return Boolean(
            stat?.isSymbolicLink?.() ||
            stat?.isSocket?.() ||
            stat?.isFIFO?.() ||
            this.isReparsePoint(fullPath, stat)
        );
    }

    assertWritableWithoutMutation(installPath) {
        let target = installPath;
        while (target && !this.fs.existsSync(target)) {
            const parent = this.path.dirname(target);
            if (!parent || parent === target) break;
            target = parent;
        }
        try { this.fs.accessSync(target, fs.constants.W_OK); } catch {
            throw makeDownloadError('DOWNLOAD_INSTALL_PATH_NOT_WRITABLE', 'Baddel cannot write to this install folder.');
        }
    }

    assertWritableByProbe(installPath) {
        const probe = this.path.join(installPath, `.baddel-write-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);
        try {
            this.fs.writeFileSync(probe, 'ok');
            this.fs.unlinkSync(probe);
        } catch {
            throw makeDownloadError('DOWNLOAD_INSTALL_PATH_NOT_WRITABLE', 'Baddel cannot write to this install folder.');
        }
    }

    safeReadDir(installPath) {
        try { return this.fs.readdirSync(installPath); } catch { return []; }
    }

    isBaddelMetadataName(name) {
        return name === MARKER_FILE || name === '.baddel-gog-support' || name === '__support';
    }

    isBaddelMetadataPath(relPath) {
        const normalized = String(relPath || '').replace(/\\/g, '/').toLowerCase();
        return normalized === MARKER_FILE ||
            normalized.startsWith('.baddel-gog-support/') ||
            normalized === '.baddel-gog-support' ||
            normalized.startsWith('__support/') ||
            normalized === '__support';
    }

    calculateRequiredBytes(payload = {}) {
        const values = [
            payload.installedDiskSizeBytes,
            payload.expectedTotalBytes,
            payload.totalBytes,
            payload.downloadSizeBytes,
        ].map(Number).filter(n => Number.isFinite(n) && n > 0);
        return values.length ? Math.max(...values) : null;
    }

    calculateSafetyMargin(requiredSpaceBytes) {
        if (!Number.isFinite(requiredSpaceBytes) || requiredSpaceBytes <= 0) return this.minSafetyMarginBytes;
        return Math.max(this.minSafetyMarginBytes, Math.ceil(requiredSpaceBytes * this.safetyMarginRatio));
    }

    getFreeSpaceBytes(targetPath) {
        if (typeof this.fs.statfsSync !== 'function') return null;
        try {
            let existing = targetPath;
            while (existing && !this.fs.existsSync(existing)) {
                const parent = this.path.dirname(existing);
                if (!parent || parent === existing) break;
                existing = parent;
            }
            const stat = this.fs.statfsSync(existing);
            const blockSize = Number(stat.bsize || stat.frsize || 0);
            const availableBlocks = Number(stat.bavail ?? stat.bfree);
            if (!Number.isFinite(blockSize) || !Number.isFinite(availableBlocks)) return null;
            return blockSize * availableBlocks;
        } catch {
            return null;
        }
    }
}

module.exports = {
    DownloadFileSafetyService,
    MARKER_FILE,
    MARKER_VERSION,
    MIN_SAFETY_MARGIN_BYTES,
    SAFETY_MARGIN_RATIO,
    isSubPath,
};
