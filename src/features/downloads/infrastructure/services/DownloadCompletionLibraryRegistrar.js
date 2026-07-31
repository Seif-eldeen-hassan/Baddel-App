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
} = require('../../../games/infrastructure/scanner/GameScannerCore');

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
    return normalized ? normalized.toLowerCase() : '';
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
    constructor({ gamesApi, notifyLibraryUpdated = null, fs = fsSync, pathModule = path, clock = Date } = {}) {
        if (!gamesApi?.upsertGame || !gamesApi?.getAllGames) {
            throw new Error('DownloadCompletionLibraryRegistrar requires gamesApi upsert/getAllGames');
        }
        this.gamesApi = gamesApi;
        this.notifyLibraryUpdated = notifyLibraryUpdated;
        this.fs = fs;
        this.path = pathModule;
        this.clock = clock;
    }

    resolveExecutablePath(task = {}, receipt = {}) {
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

    findExistingGame(task = {}, executablePath = null) {
        const games = Array.isArray(this.gamesApi.getAllGames()) ? this.gamesApi.getAllGames() : [];
        const platform = normalizeScannerPlatform(task.platform) || norm(task.platform);
        const installKey = makeDownloadInstalledKey(task, task.installPath, executablePath);
        const products = new Set(taskProductIds(task));
        const commandPath = pathKey(executablePath);
        const installPath = pathKey(task.installPath);
        const wantedTitle = titleKey(task.title);

        return games.find(game => game?.installedGameKey && installKey && game.installedGameKey === installKey) ||
            games.find(game => norm(game?.platform || game?.scannerPlatform) === platform && strongestProductIds(game).some(id => products.has(id))) ||
            games.find(game => commandPath && [game?.executablePath, game?.command, game?.path].some(value => pathKey(value).includes(commandPath) || commandPath.includes(pathKey(value)))) ||
            games.find(game => installPath && [game?.installPath, game?.path].some(value => pathKey(value) === installPath)) ||
            games.find(game => platform && norm(game?.platform || game?.scannerPlatform) === platform && wantedTitle && titleKey(game?.name || game?.title) === wantedTitle) ||
            null;
    }

    canLaunchGameRecord(game = {}) {
        return Boolean(game && (game.command || game.launchCommand || game.executablePath || game.path));
    }

    resolveCompletedDownloadRegistration(task = {}) {
        const executablePath = this.resolveExecutablePath(task, {
            verification: {
                executablePath: task.verificationExecutablePath || task.resolvedExecutablePath || task.executablePath,
            },
            executablePath: task.resolvedExecutablePath || task.executablePath,
        });
        const existing = this.findExistingGame(task, executablePath || task.resolvedExecutablePath || task.verificationExecutablePath || null);
        if (!existing || !this.canLaunchGameRecord(existing)) return null;
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
    buildGameRecord(task = {}, executablePath, existing = null) {
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

        return {
            ...(existing || {}),
            id: existing?.id || task.canonicalGameId || task.gameId || undefined,
            name: task.title || existing?.name || existing?.title || 'Unknown Game',
            title: task.title || existing?.title || existing?.name || 'Unknown Game',
            platform,
            scannerPlatform: platform,
            source: platform,
            installSource: 'download',
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
            providerAppName: cleanId(task.providerAppName || existing?.providerAppName || gogdlAppName),
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
        const existing = this.findExistingGame(task, executablePath);
        const game = this.buildGameRecord(task, executablePath, existing);
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
        const installedGame =
            games.find(g => sameString(g.id, game.id) && this.canLaunchGameRecord(g)) ||
            games.find(g => g.installedGameKey && g.installedGameKey === game.installedGameKey && this.canLaunchGameRecord(g)) ||
            games.find(g => sameString(g.id, game.id)) ||
            games.find(g => g.installedGameKey && g.installedGameKey === game.installedGameKey) ||
            game;
        await this.notifyLibraryUpdated?.(this.gamesApi.getSavedGames ? this.gamesApi.getSavedGames() : games);
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
};