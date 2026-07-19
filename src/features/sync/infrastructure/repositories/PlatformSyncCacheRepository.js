'use strict';

const defaultFs = require('fs').promises;
const defaultFsSync = require('fs');
const defaultPath = require('path');

function isGogAmazonPrimeEntitlement(game) {
    const values = [
        game?.title,
        game?.name,
        game?.originalTitle,
        game?.originalName,
        game?.info?.title,
        game?.info?.name,
    ];

    return values.some((value) => /\bamazon\s+prime\b/i.test(String(value || '')));
}

class PlatformSyncCacheRepository {
    constructor({ userDataDir, fs = defaultFs, fsSync = defaultFsSync, path = defaultPath } = {}) {
        if (!userDataDir) {
            throw new Error('PlatformSyncCacheRepository requires userDataDir');
        }

        this.fs = fs;
        this.fsSync = fsSync;
        this.path = path;
        this.userDataDir = userDataDir;
        this.syncCacheDir = path.join(userDataDir, 'platform-sync');
        this.syncLogsDir = path.join(this.syncCacheDir, 'logs');

        this.epicAccountsFile = path.join(this.syncCacheDir, 'epic_accounts.json');
        this.epicMergedCacheFile = path.join(this.syncCacheDir, 'epic_library_merged.json');
        this.epicClassificationReportFile = path.join(this.syncCacheDir, 'epic_sync_classification_report.json');

        this.steamAccountsFile = path.join(this.syncCacheDir, 'steam_accounts.json');
        this.steamMergedCacheFile = path.join(this.syncCacheDir, 'steam_library_merged.json');

        this.gogAccountsFile = path.join(this.syncCacheDir, 'gog_accounts.json');
        this.gogMergedCacheFile = path.join(this.syncCacheDir, 'gog_library_merged.json');
    }

    async ensureDirs() {
        await this.fs.mkdir(this.syncCacheDir, { recursive: true });
        await this.fs.mkdir(this.syncLogsDir, { recursive: true });
    }

    async _readJson(filePath, fallback) {
        try {
            return JSON.parse(await this.fs.readFile(filePath, 'utf8'));
        } catch {
            return fallback;
        }
    }

    _readJsonSync(filePath, fallback) {
        try {
            if (!this.fsSync.existsSync(filePath)) return fallback;
            return JSON.parse(this.fsSync.readFileSync(filePath, 'utf8'));
        } catch {
            return fallback;
        }
    }

    async _writeJson(filePath, value) {
        await this.ensureDirs();
        await this.fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
    }

    async _writeJsonAtomic(filePath, value) {
        await this.ensureDirs();
        const tmp = filePath + '.tmp';
        await this.fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
        await this.fs.rename(tmp, filePath);
    }

    async readSteamAccounts() {
        const accounts = await this._readJson(this.steamAccountsFile, []);
        return Array.isArray(accounts) ? accounts : [];
    }

    readSteamAccountsSync() {
        const accounts = this._readJsonSync(this.steamAccountsFile, []);
        return Array.isArray(accounts) ? accounts : [];
    }

    isSteamLinked() {
        return this.readSteamAccountsSync().length > 0;
    }

    async writeSteamAccounts(accounts) {
        await this._writeJson(this.steamAccountsFile, accounts);
    }

    async writeSteamAccountsAtomic(accounts) {
        await this._writeJsonAtomic(this.steamAccountsFile, accounts);
    }

    async readSteamMergedLibrary() {
        const library = await this._readJson(this.steamMergedCacheFile, []);
        return Array.isArray(library) ? library : [];
    }

    async writeSteamMergedLibrary(library) {
        await this._writeJson(this.steamMergedCacheFile, library);
    }

    async deleteSteamMergedLibrary() {
        try { await this.fs.unlink(this.steamMergedCacheFile); } catch {}
    }

    async readEpicAccounts() {
        const accounts = await this._readJson(this.epicAccountsFile, []);
        return Array.isArray(accounts) ? accounts : [];
    }

    readEpicAccountsSync() {
        const accounts = this._readJsonSync(this.epicAccountsFile, []);
        return Array.isArray(accounts) ? accounts : [];
    }

    isEpicLinked() {
        return this.readEpicAccountsSync().length > 0;
    }

    async writeEpicAccounts(accounts) {
        await this._writeJson(this.epicAccountsFile, accounts);
    }

    async readEpicMergedLibrary() {
        const library = await this._readJson(this.epicMergedCacheFile, []);
        return Array.isArray(library) ? library : [];
    }

    async writeEpicMergedLibrary(library) {
        await this._writeJson(this.epicMergedCacheFile, library);
    }

    async deleteEpicMergedLibrary() {
        try { await this.fs.unlink(this.epicMergedCacheFile); } catch {}
    }

    async writeEpicAccountsAtomic(accounts) {
        await this._writeJsonAtomic(this.epicAccountsFile, accounts);
    }

    async readGogAccounts() {
        const accounts = await this._readJson(this.gogAccountsFile, []);
        return Array.isArray(accounts) ? accounts : [];
    }

    readGogAccountsSync() {
        const accounts = this._readJsonSync(this.gogAccountsFile, []);
        return Array.isArray(accounts) ? accounts : [];
    }

    isGogLinked() {
        return this.readGogAccountsSync().length > 0;
    }

    async writeGogAccounts(accounts) {
        await this._writeJson(this.gogAccountsFile, accounts);
    }

    async writeGogAccountsAtomic(accounts) {
        await this._writeJsonAtomic(this.gogAccountsFile, accounts);
    }

    async readGogMergedLibrary() {
        const library = await this._readJson(this.gogMergedCacheFile, []);
        return Array.isArray(library) ? library.filter((game) => !isGogAmazonPrimeEntitlement(game)) : [];
    }

    async writeGogMergedLibrary(library) {
        const filtered = Array.isArray(library) ? library.filter((game) => !isGogAmazonPrimeEntitlement(game)) : [];
        await this._writeJson(this.gogMergedCacheFile, filtered);
    }

    async deleteGogMergedLibrary() {
        try { await this.fs.unlink(this.gogMergedCacheFile); } catch {}
    }

    async readEpicClassificationReport() {
        return this._readJson(this.epicClassificationReportFile, null);
    }

    async writeEpicClassificationReport(report) {
        await this.fs.writeFile(this.epicClassificationReportFile, JSON.stringify(report, null, 2), 'utf8');
    }

    getMergedCacheFile(platform) {
        switch (platform) {
            case 'steam': return this.steamMergedCacheFile;
            case 'epic': return this.epicMergedCacheFile;
            case 'gog': return this.gogMergedCacheFile;
            default: throw new Error(`Unsupported platform cache: ${platform}`);
        }
    }

    async readMergedLibrary(platform) {
        switch (platform) {
            case 'steam': return this.readSteamMergedLibrary();
            case 'epic': return this.readEpicMergedLibrary();
            case 'gog': return this.readGogMergedLibrary();
            default: throw new Error(`Unsupported platform library: ${platform}`);
        }
    }

    async writeMergedLibrary(platform, library) {
        switch (platform) {
            case 'steam':
                await this.writeSteamMergedLibrary(library);
                return;
            case 'epic':
                await this.writeEpicMergedLibrary(library);
                return;
            case 'gog':
                await this.writeGogMergedLibrary(library);
                return;
            default:
                throw new Error(`Unsupported platform library: ${platform}`);
        }
    }
}

module.exports = {
    PlatformSyncCacheRepository,
    isGogAmazonPrimeEntitlement,
};
