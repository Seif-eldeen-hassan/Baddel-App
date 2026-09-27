'use strict';

const defaultFs = require('fs');
const defaultPath = require('path');

const PARTIAL_MARKER = '.baddel-download-partial.json';
const MAX_SCAN_ENTRIES = 2500;

function normalizeInstallPath(value, pathModule = defaultPath) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const isWindowsAbsolute = /^[a-z]:[\\/]/i.test(raw) || /^\\\\/.test(raw);
    const resolved = isWindowsAbsolute
        ? defaultPath.win32.resolve(raw)
        : pathModule.resolve(raw);
    return resolved.replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase();
}

function cleanId(value) {
    const id = String(value || '').trim();
    return id || null;
}

function platformKey(record = {}) {
    return String(record.scannerPlatform || record.platform || record.source || '').trim().toLowerCase();
}

function productIds(record = {}) {
    const allIds = record.allIds && typeof record.allIds === 'object' ? record.allIds : {};
    return [
        record.providerProductId,
        record.contentSystemProductId,
        record.gogProductId,
        record.gogdlAppName,
        record.providerAppName,
        record.launcherGameId,
        allIds.gog,
        allIds.gogProductId,
        allIds.contentSystemProductId,
        allIds.gogdlAppName,
    ].map(cleanId).filter(Boolean);
}

class GogInstallManifestRecoveryService {
    constructor({ userDataDir, gamesApi = null, fs = defaultFs, pathModule = defaultPath, clock = Date } = {}) {
        if (!userDataDir) throw new Error('GogInstallManifestRecoveryService requires userDataDir');
        this.userDataDir = userDataDir;
        this.gamesApi = gamesApi;
        this.fs = fs;
        this.path = pathModule;
        this.clock = clock;
        this.productLocks = new Map();
    }

    getManifestPath(configPath, productId) {
        return this.path.join(configPath, 'heroic_gogdl', 'manifests', String(productId));
    }

    async withProductLock(productId, operation) {
        const key = String(productId || 'unknown');
        const previous = this.productLocks.get(key) || Promise.resolve();
        const current = previous.catch(() => {}).then(operation);
        this.productLocks.set(key, current);
        try {
            return await current;
        } finally {
            if (this.productLocks.get(key) === current) this.productLocks.delete(key);
        }
    }

    inspectGogInstallation({ task = {}, productId, installPath, configPath } = {}) {
        const normalizedInstallPath = normalizeInstallPath(installPath, this.path);
        const manifestPath = this.getManifestPath(configPath, productId);
        const manifestExists = this.safeExists(manifestPath);
        const directory = this.inspectDirectory(installPath);
        const registered = this.findRegisteredInstallation(task, productId, normalizedInstallPath);
        const knownExecutables = [
            task.resolvedExecutablePath,
            task.verificationExecutablePath,
            task.executablePath,
            registered?.executablePath,
        ].map(cleanId).filter(Boolean);
        const hasExpectedExecutable = knownExecutables.some(candidate =>
            normalizeInstallPath(candidate, this.path).startsWith(`${normalizedInstallPath}/`) && this.safeFile(candidate)
        );
        const registeredInstallPathMatches = Boolean(registered && registered.pathMatches);
        const actualInstallationExists = Boolean(
            directory.directoryExists &&
            directory.hasFiles &&
            (hasExpectedExecutable || directory.executableFound || directory.gogMetadataFound || registeredInstallPathMatches)
        );
        const checkpointBytes = Math.max(
            Number(task.downloadedBytes) || 0,
            Number(task.checkpointDownloadedBytes) || 0,
            Number(task.resumeBaseDownloadedBytes) || 0
        );
        const partial = Boolean(
            task.resumeStartedAt ||
            Number(task.resumeAttempts) > 0 ||
            checkpointBytes > 0 ||
            (directory.hasFiles && !actualInstallationExists)
        );
        const downloadMode = actualInstallationExists
            ? 'existing-install-or-update'
            : (partial ? 'resume-or-repair' : 'new-install');
        return {
            productId: String(productId || ''),
            requestedInstallPath: installPath || null,
            normalizedInstallPath,
            manifestPath,
            manifestExists,
            detectedInstalledPath: registered?.installPath || null,
            directoryExists: directory.directoryExists,
            hasFiles: directory.hasFiles,
            targetHasFiles: directory.hasFiles,
            payloadFileCount: directory.payloadFileCount,
            actualBytes: directory.actualBytes,
            executableFound: directory.executableFound,
            hasExpectedExecutable,
            gogMetadataFound: directory.gogMetadataFound,
            registeredInstallPathMatches,
            actualInstallationExists,
            partial,
            checkpointBytes,
            downloadMode,
            staleManifestCandidate: Boolean(manifestExists && !actualInstallationExists && !partial),
            confidence: actualInstallationExists
                ? (hasExpectedExecutable || registeredInstallPathMatches ? 'high' : 'medium')
                : (directory.hasFiles ? 'medium' : 'high'),
        };
    }

    quarantineGogdlManifest({ productId, configPath, requestedInstallPath, reason, buildId = null } = {}) {
        const source = this.getManifestPath(configPath, productId);
        if (!this.safeExists(source)) return { quarantined: false, missing: true, source, destination: null };
        const quarantineDir = this.path.join(configPath, 'heroic_gogdl', 'manifests-quarantine');
        this.fs.mkdirSync(quarantineDir, { recursive: true });
        const stamp = new this.clock().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
        let destination = this.path.join(quarantineDir, `${productId}.stale-${stamp}`);
        let suffix = 1;
        while (this.safeExists(destination) || this.safeExists(`${destination}.json`)) {
            destination = this.path.join(quarantineDir, `${productId}.stale-${stamp}-${suffix}`);
            suffix += 1;
        }
        const metadataPath = `${destination}.json`;
        const metadataTempPath = `${metadataPath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
        const metadata = {
            productId: String(productId || ''),
            timestamp: new this.clock().toISOString(),
            source,
            destination,
            requestedInstallPath: requestedInstallPath || null,
            normalizedInstallPath: normalizeInstallPath(requestedInstallPath, this.path),
            reason: reason || 'stale-install-manifest',
            buildId: buildId || null,
        };
        let manifestMoved = false;
        try {
            this.fs.writeFileSync(metadataTempPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
            if (!this.safeExists(source)) {
                this.fs.rmSync(metadataTempPath, { force: true });
                return { quarantined: false, missing: true, source, destination: null };
            }
            this.fs.renameSync(source, destination);
            manifestMoved = true;
            this.fs.renameSync(metadataTempPath, metadataPath);
        } catch (cause) {
            try { this.fs.rmSync(metadataTempPath, { force: true }); } catch {}
            let rollbackError = null;
            if (manifestMoved && this.safeExists(destination) && !this.safeExists(source)) {
                try { this.fs.renameSync(destination, source); } catch (err) { rollbackError = err; }
            }
            const err = new Error('Baddel could not safely quarantine the stale GOG install manifest.');
            err.code = 'GOG_STALE_MANIFEST_QUARANTINE_FAILED';
            err.cause = cause;
            err.rollbackError = rollbackError;
            throw err;
        }
        return {
            quarantined: true,
            missing: false,
            source,
            destination,
            metadataPath,
            metadataError: null,
            metadata,
        };
    }

    inspectDirectory(installPath) {
        const result = {
            directoryExists: false,
            hasFiles: false,
            payloadFileCount: 0,
            actualBytes: 0,
            executableFound: false,
            gogMetadataFound: false,
            partialMarkerExists: false,
        };
        try {
            if (!installPath || !this.fs.existsSync(installPath) || !this.fs.statSync(installPath).isDirectory()) return result;
            result.directoryExists = true;
            let visited = 0;
            const walk = directory => {
                if (visited >= MAX_SCAN_ENTRIES) return;
                for (const entry of this.fs.readdirSync(directory, { withFileTypes: true })) {
                    visited += 1;
                    if (visited > MAX_SCAN_ENTRIES) return;
                    const full = this.path.join(directory, entry.name);
                    const relative = this.path.relative(installPath, full).replace(/\\/g, '/').toLowerCase();
                    if (entry.isDirectory()) {
                        if (relative === '.baddel-gog-support' || relative.startsWith('.baddel-gog-support/')) continue;
                        if (relative === '__support' || relative.startsWith('__support/')) continue;
                        walk(full);
                        continue;
                    }
                    if (!entry.isFile()) continue;
                    if (relative === PARTIAL_MARKER) { result.partialMarkerExists = true; continue; }
                    if (relative.startsWith('.baddel-gog-support/') || relative.startsWith('__support/')) continue;
                    const stat = this.fs.statSync(full);
                    result.payloadFileCount += 1;
                    result.actualBytes += Number(stat.size) || 0;
                    if (/\.(exe|bat|cmd)$/i.test(entry.name)) result.executableFound = true;
                    if (/^goggame-?.*\.info$/i.test(entry.name) || /manifest|gameinfo|\.gog/i.test(entry.name)) result.gogMetadataFound = true;
                }
            };
            walk(installPath);
            result.hasFiles = result.payloadFileCount > 0 && result.actualBytes > 0;
        } catch {}
        return result;
    }

    findRegisteredInstallation(task, productId, normalizedInstallPath) {
        const games = Array.isArray(this.gamesApi?.getAllGames?.()) ? this.gamesApi.getAllGames() : [];
        const wantedIds = new Set([productId, ...productIds(task)].map(cleanId).filter(Boolean));
        for (const game of games) {
            if (platformKey(game) !== 'gog') continue;
            if (!productIds(game).some(id => wantedIds.has(id))) continue;
            const installPath = game.installPath || game.path || (game.executablePath ? this.path.dirname(game.executablePath) : null);
            const normalized = normalizeInstallPath(installPath, this.path);
            if (!normalized || normalized !== normalizedInstallPath) continue;
            return {
                gameId: game.id || null,
                installPath,
                executablePath: game.executablePath || null,
                pathMatches: true,
            };
        }
        return null;
    }

    safeExists(target) {
        try { return Boolean(target && this.fs.existsSync(target)); } catch { return false; }
    }

    safeFile(target) {
        try { return Boolean(target && this.fs.existsSync(target) && this.fs.statSync(target).isFile()); } catch { return false; }
    }
}

module.exports = {
    GogInstallManifestRecoveryService,
    normalizeInstallPath,
};
