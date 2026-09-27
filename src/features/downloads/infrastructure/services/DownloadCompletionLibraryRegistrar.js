'use strict';

const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
    normalizePath,
    normalizeScannerPlatform,
    makeInstalledGameKey,
    findLikelyGameExe,
    isLauncherOrHelperExe,
    scoreExeCandidateForDiagnostics,
} = require('../../../games/infrastructure/scanner/GameScannerCore');
const {
    inspectEpicManagedInstall,
} = require('../../domain/services/EpicManagedInstallContract');

function norm(value) {
    return String(value || '').trim().toLowerCase();
}

function titleKey(value) {
    return norm(value).replace(/[^a-z0-9]+/g, '');
}

function sameString(a, b) {
    return a != null && b != null && String(a) === String(b);
}

function cleanId(value) {
    const id = String(value || '').trim();
    return id || null;
}

function pathKey(value) {
    const normalized = normalizePath(value || '');
    return normalized ? normalized.toLowerCase().replace(/\\/g, '/').replace(/\/+$/g, '') : '';
}

function meaningfulPathMatch(a, b) {
    const left = pathKey(a);
    const right = pathKey(b);
    if (!left || !right) return false;
    return left === right ||
        left.startsWith(`${right}/`) ||
        right.startsWith(`${left}/`);
}

function recordPlatform(record = {}) {
    return normalizeScannerPlatform(record.scannerPlatform || record.platform || record.source) ||
        norm(record.scannerPlatform || record.platform || record.source);
}

function samePlatform(a = {}, b = {}) {
    const left = recordPlatform(a);
    const right = recordPlatform(b);
    return Boolean(left && right && left === right);
}

function executableCommand(executablePath) {
    return executablePath ? `"${executablePath}"` : '';
}

function withinDirectory(parent, child) {
    const parentPath = path.resolve(parent || '');
    const childPath = path.resolve(child || '');
    const rel = path.relative(parentPath, childPath);
    return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function strongestProductIds(record = {}) {
    const allIds = record.allIds && typeof record.allIds === 'object' ? record.allIds : {};
    return [
        record.providerProductId,
        record.contentSystemProductId,
        record.gogProductId,
        record.gogGameId,
        record.gogId,
        record.launcherGameId,
        record.appId,
        record.appName,
        allIds.gog,
        allIds.gogProductId,
        allIds.contentSystemProductId,
        allIds[record.platform],
    ].map(cleanId).filter(Boolean);
}

function taskProductIds(task = {}) {
    return [
        task.providerProductId,
        task.contentSystemProductId,
        task.gogProductId,
        task.gogdlAppName,
        task.providerAppName,
        task.gameId,
        task.canonicalGameId,
    ].map(cleanId).filter(Boolean);
}

function makeDownloadInstalledKey(task = {}, installPath, executablePath) {
    const platform = normalizeScannerPlatform(task.platform || 'unknown') || norm(task.platform) || 'unknown';
    const product = cleanId(task.providerProductId || task.contentSystemProductId || task.gogProductId || task.gogdlAppName || task.providerAppName);
    if (product) return `${platform}:download:${product}`;
    const target = pathKey(executablePath || installPath);
    if (target) return `${platform}:download:path:${crypto.createHash('sha1').update(target).digest('hex').slice(0, 16)}`;
    return null;
}

class DownloadCompletionLibraryRegistrar {
    constructor({ gamesApi, notifyLibraryUpdated = null, fs = fsSync, pathModule = path, clock = Date, diagnosticRecorder = null } = {}) {
        if (!gamesApi?.upsertGame || !gamesApi?.getAllGames) {
            throw new Error('DownloadCompletionLibraryRegistrar requires gamesApi upsert/getAllGames');
        }
        this.gamesApi = gamesApi;
        this.notifyLibraryUpdated = notifyLibraryUpdated;
        this.fs = fs;
        this.path = pathModule;
        this.clock = clock;
        this.diagnosticRecorder = diagnosticRecorder;
    }

    async reconcileManagedDuplicates(tasks = []) {
        if (typeof this.gamesApi.reconcileManagedInstalledGames !== 'function') {
            return { changed: false, idRemap: {}, merges: [], removedCount: 0 };
        }
        return this.gamesApi.reconcileManagedInstalledGames(tasks);
    }

    resolveExecutablePath(task = {}, receipt = {}) {
        this.diagnosticRecorder?.mark?.(task.id, 'EXECUTABLE_RESOLUTION_STARTED', {
            taskTitle: task.title || null,
            installPath: task.installPath || null,
        });
        const selected = this.resolveExecutablePathProduction(task, receipt);
        this.recordExecutableDiagnostics(task, receipt, selected);
        this.diagnosticRecorder?.mark?.(task.id, 'EXECUTABLE_RESOLUTION_FINISHED', { selectedExecutable: selected });
        return selected;
    }

    resolveExecutablePathProduction(task = {}, receipt = {}) {
        const installPath = task.installPath ? String(task.installPath) : null;
        const verification = receipt.verification || {};
        const candidates = [
            verification.executablePath,
            receipt.executablePath,
            task.resolvedExecutablePath,
            task.verificationExecutablePath,
        ].map(cleanId).filter(Boolean);

        for (const candidate of candidates) {
            const resolved = this.path.resolve(candidate);
            if (installPath && !withinDirectory(installPath, resolved)) continue;
            if (isLauncherOrHelperExe(resolved)) continue;
            try {
                if (this.fs.existsSync(resolved) && this.fs.statSync(resolved).isFile()) return resolved;
            } catch {}
        }

        if (!installPath) return null;
        try {
            const found = findLikelyGameExe(installPath, { fsSync: this.fs, pathModule: this.path });
            if (found && withinDirectory(installPath, found)) return this.path.resolve(found);
        } catch {}
        return null;
    }

    recordExecutableDiagnostics(task = {}, receipt = {}, selectedExecutable = null) {
        if (!this.diagnosticRecorder?.isEnabled?.() || !task.installPath) return;
        const verificationPath = cleanId(receipt.verification?.executablePath);
        const explicitFallbackPaths = new Set([receipt.executablePath, task.resolvedExecutablePath, task.verificationExecutablePath].map(cleanId).filter(Boolean).map(value => this.path.resolve(value)));
        const candidates = [];
        let visited = 0;
        const walk = (directory, depth) => {
            if (depth > 5 || visited > 1500) return;
            let entries;
            try { entries = this.fs.readdirSync(directory, { withFileTypes: true }); } catch { return; }
            for (const entry of entries) {
                visited += 1;
                const absolutePath = this.path.join(directory, entry.name);
                if (entry.isDirectory()) { walk(absolutePath, depth + 1); continue; }
                if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.exe')) continue;
                let fileSize = null;
                try { fileSize = this.fs.statSync(absolutePath).size; } catch {}
                const resolved = this.path.resolve(absolutePath);
                const scored = scoreExeCandidateForDiagnostics(resolved, task.installPath, { nameHint: task.title });
                candidates.push({
                    absolutePath: resolved,
                    relativePath: this.path.relative(task.installPath, resolved),
                    fileName: entry.name,
                    fileSize,
                    depth,
                    isLauncherOrHelperExe: isLauncherOrHelperExe(resolved),
                    score: scored.score,
                    scoreLabel: scored.scoreLabel,
                    scoreReasons: scored.reasons,
                    fromVerification: verificationPath ? this.path.resolve(verificationPath) === resolved : false,
                    fromFallbackScanning: !(verificationPath && this.path.resolve(verificationPath) === resolved) && !explicitFallbackPaths.has(resolved),
                    selected: selectedExecutable ? this.path.resolve(selectedExecutable) === resolved : false,
                });
            }
        };
        walk(task.installPath, 0);
        for (const candidate of candidates) {
            this.diagnosticRecorder.record(task.id, 'executableCandidates', 'EXECUTABLE_CANDIDATE', candidate);
        }
        const selectedCandidate = candidates.find(candidate => candidate.selected);
        this.diagnosticRecorder.record(task.id, 'selectedExecutable', 'SELECTED_EXECUTABLE', {
            selectedExecutable,
            selectedExecutableReason: selectedCandidate?.fromVerification
                ? 'verification'
                : (selectedExecutable && explicitFallbackPaths.has(this.path.resolve(selectedExecutable))
                    ? 'explicit-completion-candidate'
                    : (selectedExecutable ? 'production-fallback-scan' : 'none')),
            taskTitle: task.title || null,
            taskPlatform: task.platform || null,
            installPath: task.installPath || null,
            providerProductId: task.providerProductId || null,
            gogProductId: task.gogProductId || null,
            gogdlAppName: task.gogdlAppName || null,
            verificationExecutablePath: verificationPath,
            resolvedExecutablePath: task.resolvedExecutablePath || null,
        });
    }

    findExistingGame(task = {}, executablePath = null) {
        const games = Array.isArray(this.gamesApi.getAllGames()) ? this.gamesApi.getAllGames() : [];
        const platform = normalizeScannerPlatform(task.platform) || norm(task.platform);
        const installKey = makeDownloadInstalledKey(task, task.installPath, executablePath);
        const products = new Set(taskProductIds(task));
        const commandPath = pathKey(executablePath);
        const installPath = pathKey(task.installPath);
        const wantedTitle = titleKey(task.title);

        return games.find(game => game?.installedGameKey && installKey && game.installedGameKey === installKey) ||
            games.find(game => recordPlatform(game) === platform && strongestProductIds(game).some(id => products.has(id))) ||
            games.find(game => commandPath && [game?.executablePath, game?.command, game?.path].some(value => meaningfulPathMatch(value, commandPath))) ||
            games.find(game => installPath && [game?.installPath, game?.path].some(value => {
                const candidatePath = pathKey(value);
                return Boolean(candidatePath && candidatePath === installPath);
            })) ||
            games.find(game => platform && recordPlatform(game) === platform && wantedTitle && titleKey(game?.name || game?.title) === wantedTitle) ||
            null;
    }

    canLaunchGameRecord(game = {}) {
        return Boolean(game && (game.command || game.launchCommand || game.executablePath || game.path));
    }

    assertManagedRegistration(task = {}, game = null) {
        if (norm(task.platform) !== 'epic' || norm(task.installProvider) !== 'legendary') return game;
        const inspection = inspectEpicManagedInstall(game, task);
        this.diagnosticRecorder?.mark?.(task.id, 'EPIC_MANAGED_INSTALL_VALIDATED', {
            recordFound: inspection.fields.recordFound,
            installedGameIdPresent: inspection.fields.idPresent,
            installSource: inspection.fields.installSource || null,
            installProvider: inspection.fields.installProvider || null,
            installPathPresent: inspection.fields.installPathPresent,
            launchTargetPresent: inspection.fields.launchTargetPresent,
            appNamePresent: inspection.fields.appNamePresent,
            namespacePresent: inspection.fields.namespacePresent,
            catalogItemIdPresent: inspection.fields.catalogItemIdPresent,
            taskIdMatches: inspection.fields.taskIdMatches,
            taskPathMatches: inspection.fields.taskPathMatches,
            result: inspection.ok,
            failedFields: inspection.failedFields,
        });
        if (!inspection.ok) {
            const err = new Error('Baddel could not persist a complete managed Epic installation record.');
            err.code = 'EPIC_MANAGED_INSTALL_INVALID';
            err.details = { failedFields: inspection.failedFields };
            throw err;
        }
        return game;
    }

    resolveCompletedDownloadRegistration(task = {}) {
        const executablePath = this.resolveExecutablePath(task, {
            verification: {
                executablePath: task.verificationExecutablePath || task.resolvedExecutablePath || task.executablePath,
            },
            executablePath: task.resolvedExecutablePath || task.executablePath,
        });
        const existing = this.findExistingGame(task, executablePath || task.resolvedExecutablePath || task.verificationExecutablePath || null);
        if (!existing || !samePlatform(task, existing) || !this.canLaunchGameRecord(existing)) return null;
        try {
            this.assertManagedRegistration(task, existing);
        } catch {
            return null;
        }
        return {
            installedGameId: existing.id || null,
            installedGame: existing,
            resolvedExecutablePath: executablePath || existing.executablePath || existing.command || existing.path || null,
        };
    }

    buildRecoveryReceipt(task = {}) {
        const receipt = task.providerCompletionReceipt && typeof task.providerCompletionReceipt === 'object'
            ? { ...task.providerCompletionReceipt }
            : {};
        const verification = receipt.verification && typeof receipt.verification === 'object'
            ? { ...receipt.verification }
            : {};
        const executablePath = this.resolveExecutablePath(task, {
            ...receipt,
            verification,
            executablePath: receipt.executablePath || task.resolvedExecutablePath || task.executablePath,
        });
        if (!executablePath) return null;
        receipt.verification = {
            ...verification,
            status: verification.status || 'passed',
            method: verification.method || 'install-directory-scan',
            expectedFileCount: verification.expectedFileCount ?? null,
            verifiedFileCount: verification.verifiedFileCount ?? null,
            expectedBytes: verification.expectedBytes ?? task.verificationExpectedBytes ?? null,
            actualBytes: verification.actualBytes ?? task.verificationActualBytes ?? null,
            executableFound: true,
            executablePath,
            manifestFound: verification.manifestFound ?? task.verificationManifestFound ?? null,
        };
        receipt.executablePath = executablePath;
        return receipt;
    }

    async recoverCompletedDownload(task = {}) {
        const existing = this.resolveCompletedDownloadRegistration(task);
        if (existing?.installedGameId) return existing;
        const receipt = this.buildRecoveryReceipt(task);
        if (!receipt) return null;
        return this.registerCompletedDownload(task, receipt);
    }
    buildGameRecord(task = {}, executablePath, existing = null, receipt = {}) {
        const platform = normalizeScannerPlatform(task.platform || existing?.platform || 'unknown') || norm(task.platform || existing?.platform) || 'unknown';
        const installPath = task.installPath || (executablePath ? this.path.dirname(executablePath) : existing?.installPath || existing?.path || null);
        const installedGameKey = makeDownloadInstalledKey(task, installPath, executablePath) || existing?.installedGameKey || makeInstalledGameKey({
            platform,
            scannerPlatform: platform,
            path: installPath,
            command: executableCommand(executablePath),
            name: task.title || existing?.name,
        });
        const providerProductId = cleanId(task.providerProductId || existing?.providerProductId || existing?.launcherGameId);
        const contentSystemProductId = cleanId(task.contentSystemProductId || existing?.contentSystemProductId);
        const gogProductId = cleanId(task.gogProductId || providerProductId || existing?.gogProductId);
        const gogdlAppName = cleanId(task.gogdlAppName || task.providerAppName || existing?.gogdlAppName || existing?.appName);
        const command = executableCommand(executablePath);
        const allIds = {
            ...(existing?.allIds && typeof existing.allIds === 'object' ? existing.allIds : {}),
        };
        if (providerProductId) allIds[platform] = providerProductId;
        if (gogProductId) allIds.gog = gogProductId;
        if (contentSystemProductId) allIds.contentSystemProductId = contentSystemProductId;
        if (gogdlAppName) allIds.gogdlAppName = gogdlAppName;
        const legendaryOwner = platform === 'epic' && task.installProvider === 'legendary'
            ? cleanId(existing?.installedByAccountId || existing?.accountId || task.installedByAccountId || task.accountId)
            : null;

        return {
            ...(existing || {}),
            id: existing?.id || task.canonicalGameId || task.gameId || undefined,
            name: task.title || existing?.name || existing?.title || 'Unknown Game',
            title: task.title || existing?.title || existing?.name || 'Unknown Game',
            platform,
            scannerPlatform: platform,
            source: platform,
            installSource: 'download',
            ...(legendaryOwner ? {
                accountId: legendaryOwner,
                accountDisplayName: cleanId(existing?.accountDisplayName || (legendaryOwner === cleanId(task.accountId) ? task.accountDisplayName : null)),
            } : {}),
            // Provenance must come from the persisted task/record. A generic GOG
            // platform label is not proof that Baddel/gogdl installed the game.
            installProvider: cleanId(task.installProvider || existing?.installProvider),
            isInstalled: true,
            installVerified: true,
            path: installPath,
            installPath,
            executablePath,
            command: command || existing?.command || executablePath || '',
            launchCommand: command || existing?.launchCommand || executablePath || '',
            providerProductId,
            contentSystemProductId,
            gogProductId,
            gogdlAppName,
            providerAppName: cleanId(task.providerAppName || task.appName || existing?.providerAppName || gogdlAppName),
            appName: cleanId(task.appName || task.providerAppName || existing?.appName || gogdlAppName),
            namespace: cleanId(task.namespace || existing?.namespace),
            catalogItemId: cleanId(task.catalogItemId || existing?.catalogItemId),
            installedByAccountId: cleanId(existing?.installedByAccountId || task.installedByAccountId || task.accountId),
            ownedByAccountIds: [...new Set([...(Array.isArray(existing?.ownedByAccountIds) ? existing.ownedByAccountIds : []), ...(Array.isArray(task.ownedByAccountIds) ? task.ownedByAccountIds : [])].map(String).filter(Boolean))],
            installedAt: existing?.installedAt || new this.clock().toISOString(),
            buildId: cleanId(receipt.buildId || existing?.buildId),
            launcherGameId: providerProductId || contentSystemProductId || gogProductId || gogdlAppName || existing?.launcherGameId || null,
            installedGameKey,
            allIds,
            coverUrl: existing?.coverUrl || task.coverUrl || null,
            image: existing?.image || task.coverUrl || null,
            heroUrl: existing?.heroUrl || task.heroUrl || null,
            downloadedAt: existing?.downloadedAt || new this.clock().toISOString(),
            lastSeenAt: new this.clock().toISOString(),
        };
    }

    async registerCompletedDownload(task = {}, receipt = {}) {
        const executablePath = this.resolveExecutablePath(task, receipt);
        if (!executablePath) {
            const err = new Error('Baddel could not find a launchable executable in the completed install folder.');
            err.code = 'DOWNLOAD_LAUNCH_TARGET_NOT_FOUND';
            throw err;
        }
        const matchedExisting = this.findExistingGame(task, executablePath);
        const existing = matchedExisting && samePlatform(task, matchedExisting) ? matchedExisting : null;
        const gamesBefore = Array.isArray(this.gamesApi.getAllGames()) ? this.gamesApi.getAllGames() : [];
        const game = this.buildGameRecord(task, executablePath, existing, receipt);
        const conflictingId = gamesBefore.find(candidate => sameString(candidate?.id, game.id) && !samePlatform(task, candidate));
        if (conflictingId) {
            const platform = recordPlatform(task) || 'gog';
            const product = cleanId(task.providerProductId || task.contentSystemProductId || task.gogProductId || task.gogdlAppName);
            const seed = `${game.installedGameKey || ''}|${executablePath}`;
            const suffix = crypto.createHash('sha1').update(seed).digest('hex').slice(0, 12);
            game.id = product ? `${platform}_${product}` : `${platform}_download_${suffix}`;
            if (gamesBefore.some(candidate => sameString(candidate?.id, game.id) && !samePlatform(task, candidate))) {
                game.id = `${platform}_download_${suffix}`;
            }
        }
        try {
            await this.gamesApi.upsertGame(game);
            this.gamesApi.saveDatabase?.();
            await this.gamesApi.flushDatabase?.();
        } catch (cause) {
            const err = new Error('Baddel could not register the completed download in the Library.');
            err.code = 'DOWNLOAD_LIBRARY_REGISTRATION_FAILED';
            err.cause = cause;
            throw err;
        }
        const games = Array.isArray(this.gamesApi.getAllGames()) ? this.gamesApi.getAllGames() : [];
        const platformGames = games.filter(candidate => samePlatform(task, candidate));
        const installedGame =
            platformGames.find(g => sameString(g.id, game.id) && this.canLaunchGameRecord(g)) ||
            platformGames.find(g => g.installedGameKey && g.installedGameKey === game.installedGameKey && this.canLaunchGameRecord(g)) ||
            platformGames.find(g => sameString(g.id, game.id)) ||
            platformGames.find(g => g.installedGameKey && g.installedGameKey === game.installedGameKey) ||
            game;
        if (!samePlatform(task, installedGame)) {
            const err = new Error('Baddel rejected a cross-platform library registration result.');
            err.code = 'DOWNLOAD_LIBRARY_PLATFORM_MISMATCH';
            throw err;
        }
        this.assertManagedRegistration(task, installedGame);
        await this.notifyLibraryUpdated?.(this.gamesApi.getSavedGames ? this.gamesApi.getSavedGames() : this.gamesApi.getAllGames());
        return {
            installedGameId: installedGame.id || game.id,
            installedGame,
            resolvedExecutablePath: executablePath,
        };
    }
}

module.exports = {
    DownloadCompletionLibraryRegistrar,
    makeDownloadInstalledKey,
    meaningfulPathMatch,
};
