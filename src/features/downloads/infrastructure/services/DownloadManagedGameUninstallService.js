'use strict';

const path = require('path');

function makeError(code, message) {
    const err = new Error(message);
    err.code = code;
    return err;
}

function normalizedPlatform(value) {
    return String(value || '').trim().toLowerCase();
}

function samePath(a, b) {
    if (!a || !b) return false;
    return path.resolve(path.normalize(String(a))).toLowerCase() === path.resolve(path.normalize(String(b))).toLowerCase();
}

class DownloadManagedGameUninstallService {
    constructor({ fileSafety, gamesApi, isGameRunning = null, notifyLibraryUpdated = null, clock = Date } = {}) {
        if (!fileSafety?.deleteManagedInstall) throw new Error('Managed uninstall requires DownloadFileSafetyService');
        if (!gamesApi?.getAllGames || !gamesApi?.removeGame) throw new Error('Managed uninstall requires gamesApi getAllGames/removeGame');
        this.fileSafety = fileSafety;
        this.gamesApi = gamesApi;
        this.isGameRunning = isGameRunning;
        this.notifyLibraryUpdated = notifyLibraryUpdated;
        this.clock = clock;
    }

    findManagedGame(task = {}) {
        const allGames = this.gamesApi.getAllGames();
        const games = Array.isArray(allGames) ? allGames : [];
        const game = games.find(candidate => String(candidate?.id) === String(task.installedGameId || ''));
        if (!game || normalizedPlatform(game.platform || game.scannerPlatform) !== normalizedPlatform(task.platform)) {
            throw makeError('DOWNLOAD_UNINSTALL_LIBRARY_MISMATCH', 'Baddel could not verify the matching installed Library record.');
        }
        if (String(game.installSource || '').toLowerCase() !== 'download' || !samePath(game.installPath || game.path, task.installPath)) {
            throw makeError('DOWNLOAD_UNINSTALL_NOT_MANAGED', 'This Library record is not a Baddel-managed installation at the expected path.');
        }
        return game;
    }

    recoverInstallRoot(task = {}) {
        // Older direct folder-picker payloads mislabeled the exact game folder as its library root.
        // Repair only with the original preflight identity and a full, unchanged ownership proof.
        const supportedProvider = (task.platform === 'epic' && task.installProvider === 'legendary') ||
            (task.platform === 'gog' && task.installProvider === 'gogdl');
        if (task.status !== 'completed' || !supportedProvider ||
            !samePath(task.installRoot, task.installPath) || !task.installParentPath ||
            !samePath(task.installParentPath, path.dirname(task.installPath)) ||
            task.installFolder !== path.basename(task.installPath) || !task.installPathPreflightAt ||
            !task.installPathOwnershipPreparedAt) return null;
        try {
            const candidate = { ...task, installRoot: task.installParentPath, uninstallEligible: true };
            this.findManagedGame(candidate);
            const marker = this.fileSafety.readAndValidateMarker(candidate, candidate.installPath);
            if (marker.createdAt !== task.installPathOwnershipPreparedAt ||
                !Number.isFinite(Date.parse(task.installPathPreflightAt)) ||
                Date.parse(task.installPathPreflightAt) > Date.parse(marker.createdAt)) return null;
            this.fileSafety.assertSafeManagedUninstall(candidate);
            return { installRoot: task.installParentPath };
        } catch (_) {
            return null;
        }
    }

    isEligible(task = {}) {
        try {
            const candidate = { ...task, status: 'completed', uninstallEligible: true };
            this.findManagedGame(candidate);
            this.fileSafety.assertManagedOwnershipProof(candidate);
            return true;
        } catch (_) {
            return false;
        }
    }

    async uninstall(task = {}) {
        if (task.status !== 'completed' || task.uninstallEligible !== true) {
            throw makeError('DOWNLOAD_UNINSTALL_NOT_MANAGED', 'Only completed games installed and owned by Baddel can be uninstalled here.');
        }
        const game = this.findManagedGame(task);
        if (await this.isGameRunning?.(game, task)) {
            throw makeError('DOWNLOAD_UNINSTALL_GAME_RUNNING', 'Close the game before uninstalling it.');
        }

        const deletion = this.fileSafety.deleteManagedInstall(task);
        // removeGame is the Library's hide action. Uninstall removes only the installed DB record,
        // not the cross-cutting permanent-delete operation that also clears external artwork/settings.
        const repository = this.gamesApi.getJsonGameRepository?.();
        let removal;
        if (repository?.deleteGameById) {
            const removed = repository.deleteGameById(task.installedGameId);
            removal = { status: removed > 0 ? 'success' : 'error' };
            if (removed > 0) this.gamesApi.saveDatabase();
        } else {
            removal = await this.gamesApi.removeGame(task.installedGameId);
        }
        if (removal?.status && removal.status !== 'success') {
            throw makeError('DOWNLOAD_UNINSTALL_LIBRARY_REMOVE_FAILED', removal.message || 'The game files were removed, but Baddel could not update the Library record.');
        }
        await this.gamesApi.flushDatabase?.();
        const visibleGames = this.gamesApi.getSavedGames?.() || this.gamesApi.getAllGames();
        await this.notifyLibraryUpdated?.(visibleGames);
        return {
            ...deletion,
            installedGameId: task.installedGameId,
            uninstalledAt: new this.clock().toISOString(),
        };
    }
}

module.exports = { DownloadManagedGameUninstallService };
