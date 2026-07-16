'use strict';

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
let electronApp = null;
try { electronApp = require('electron').app; } catch { /* node test environment */ }
const app = (electronApp && typeof electronApp.getPath === 'function')
    ? electronApp
    : {
        getPath(name) {
            if (name === 'userData') {
                return process.env.BADDEL_TEST_USER_DATA ||
                    process.env.BADDEL_USER_DATA ||
                    path.join(os.tmpdir(), 'BaddelLauncher-userData');
            }
            if (name === 'desktop') return path.join(os.homedir(), 'Desktop');
            return os.tmpdir();
        }
    };

const baddelApi = require('../../../../../services/baddelApi');
const { MetadataResolutionManager, STATUS: MRM_STATUS } = require('../../../../../services/metadataResolutionManager');
const { generateMetadataCandidates } = require('../../../../../services/candidateGenerator');
const {
    GameScannerCore,
    parseShortcutArgs,
    normalizeScannerPlatform,
    makeInstalledGameKey,
    isScannerOwnedGame,
    prepareScannerGame,
    preferDetectedCandidate,
    missingReasonForStoredGame,
    scannerPlatformForGame,
    withTimeout,
} = require('../scanner/GameScannerCore');
const { JsonGameRepository } = require('../repositories/JsonGameRepository');
const { ArtworkAssetStore } = require('../services/ArtworkAssetStore');
const { ImageCacheService } = require('../services/ImageCacheService');
const { ScanDiagnosticsWriter } = require('../services/ScanDiagnosticsWriter');
const { MetadataCacheStore } = require('../services/MetadataCacheStore');
const { GameScanReportAccumulator } = require('../../application/services/GameScanReportAccumulator');
const { deleteGamePermanently: _deleteGamePermanentlyUseCase } = require('../../application/useCases/DeleteGamePermanentlyUseCase');
const { backgroundDownload: _backgroundDownloadService } = require('../services/BackgroundDownloadService');
const { addManualGame: _addManualGameUseCase } = require('../../application/useCases/AddManualGameUseCase');
const { removeEpicNonGameEntries: _removeEpicNonGameEntriesUseCase } = require('../../application/useCases/RemoveEpicNonGameEntriesUseCase');
const { resetGameImage: _resetGameImageUseCase } = require('../../application/useCases/ResetGameImageUseCase');
const { upsertGame: _upsertGameUseCase } = require('../../application/useCases/UpsertGameUseCase');
const { startGlobalScan: _startGlobalScanUseCase } = require('../../application/useCases/StartGlobalScanUseCase');

function createFallbackMrm() {
    const fallback = new MetadataResolutionManager(app.getPath('userData'));
    fallback.setApi(baddelApi);
    return fallback;
}

class BaddelEngine {
    constructor(options = {}) {
        this.programData = options.programData || process.env.ProgramData || 'C:\\ProgramData';
        this.appData = options.appData || process.env.APPDATA || path.join(process.env.HOME || os.homedir(), 'AppData', 'Roaming');
        this.dbFolder = options.dbFolder || app.getPath('userData');
        this.dbPath = path.join(this.dbFolder, 'games-db.json');
        this.officialPaths = new Set();
        this._saveTimer = null; // retained for compatibility; timer is now owned by JsonGameRepository
        this._scanReportAccumulator = new GameScanReportAccumulator({
            normalizePlatform: normalizeScannerPlatform,
        });
        this._currentScanReports = this._scanReportAccumulator.reports;
        this._skipMetadataServerSync = !!options.skipMetadataServerSync;
        this._testDriveRoots = options.driveRoots || null;
        this._riotSearchRoots = options.riotSearchRoots || null;
        this._mrm = options.mrm || createFallbackMrm();
        this._metadataCacheStore = options.metadataCacheStore || new MetadataCacheStore(this.dbFolder);
        this.__core = null; // lazy - created on first scan
        this._artworkAssetStore = options.artworkAssetStore || new ArtworkAssetStore({
            fs: fsSync,
            path,
            crypto,
            baseDir: path.join(this.dbFolder, 'user_artwork'),
        });
        this._jsonGameRepository = new JsonGameRepository({
            fs: fsSync,
            path,
            crypto,
            databasePath: this.dbPath,
            keyResolver:  makeInstalledGameKey,
            artworkAssetStore: this._artworkAssetStore,
        });
        this._imageCacheService = new ImageCacheService({
            fs: fsSync,
            path,
            dbFolder: this.dbFolder,
        });
        this._scanDiagnosticsWriter = new ScanDiagnosticsWriter({
            baseDir: this.dbFolder,
        });
    }

    // Migration bridge: exposes the single JsonGameRepository owned by BaddelEngine.
    // Do not instantiate repositories elsewhere.
    getJsonGameRepository() { return this._jsonGameRepository; }

    // ============================================================
    // DATABASE
    // ============================================================
    generateStableId(game) { return this._jsonGameRepository.generateStableId(game); }

    initDatabase() { this._jsonGameRepository.initDatabase(); }

    // _migrateLnkRecords is now owned by JsonGameRepository.initDatabase.
    // Kept as a no-op so any external callers do not throw during migration.
    _migrateLnkRecords() {}

    async flushDatabase() { return this._jsonGameRepository.flushDatabase(); }

    // Async write with 500ms debounce - delegated to JsonGameRepository
    saveDatabase() { return this._jsonGameRepository.saveDatabase(); }

    // ============================================================
    // UPSERT
    // ============================================================
    async upsertGame(game) {
        return _upsertGameUseCase({
            game,
            gamesRepository:      this._jsonGameRepository,
            findInCache:          (id, type) => this.findInCache(id, type),
            makeInstalledGameKey,
        });
    }

    // ============================================================
    // CRUD OPERATIONS
    // ============================================================
    async renameGame(gameId, newName) { return this._jsonGameRepository.renameGame(gameId, newName); }

    async removeGame(gameId) { return this._jsonGameRepository.removeGame(gameId); }

    async unhideAllGames() { return this._jsonGameRepository.unhideAllGames(); }

    getAllGames()              { return this._jsonGameRepository.getAllGames(); }
    getStoredGames()           { return this._jsonGameRepository.getStoredGames(); }
    getHiddenGames()           { return this._jsonGameRepository.getHiddenGames(); }
    getMissingInstalledGames() { return this._jsonGameRepository.getMissingInstalledGames(); }
    getGameById(gameId)        { return this._jsonGameRepository.getGameById(gameId); }

    async restoreSpecificGames(gameIds) { return this._jsonGameRepository.restoreSpecificGames(gameIds); }

    async deleteGamePermanently(gameId) {
        return _deleteGamePermanentlyUseCase({
            gameId,
            gamesRepository:           this._jsonGameRepository,
            imageCacheService:         this._imageCacheService,
            metadataResolutionManager: this._mrm,
            metadataCacheStore:         this._metadataCacheStore,
            saveDatabase: () => this.saveDatabase(),
        });
    }

    // Permanently remove Epic non-game entries (Fab assets, Unreal Marketplace
    // plugins, etc.) that were imported before the strict classifier existed.
    // Called after each Epic sync with the list of rejected/unknown entries.
    async removeEpicNonGameEntries(badEntries = []) {
        const epicEntryPolicy = require('../../../../../platformSyncShared');
        return _removeEpicNonGameEntriesUseCase({
            badEntries,
            gamesRepository:  this._jsonGameRepository,
            imageCacheService: this._imageCacheService,
            saveDatabase:      () => this.saveDatabase(),
            epicEntryPolicy,
        });
    }

    // ============================================================
    // IMAGES
    // ============================================================
    async updateGameImage(gameId, newImagePath, type = 'cover', opts) { return this._jsonGameRepository.updateGameImage(gameId, newImagePath, type, opts); }

    async setGameArtwork(identity, updates = {}, opts = {}) { return this._jsonGameRepository.setGameArtwork(identity, updates, opts); }

    async resetGameArtwork(identity, opts = {}) { return this._jsonGameRepository.resetGameArtwork(identity, opts); }

    async resetGameImage(gameId, type = 'cover', opts = {}) {
        return _resetGameImageUseCase({
            gameId,
            type,
            opts,
            gamesRepository:   this._jsonGameRepository,
            imageCacheService: this._imageCacheService,
        });
    }

    findInCache(gameId, type)  { return this._imageCacheService.findInCache(gameId, type); }

    deleteGameImages(gameId)   { this._imageCacheService.deleteGameImages(gameId); }

    async downloadToCache(url, gameId, type) {
        // All image caching is now handled by baddelapi
        return url || null;
    }

    _platformReport(platform) { return this._scanReportAccumulator.platformReport(platform); }
    _recordRaw(platform, count = 1) { return this._scanReportAccumulator.recordRaw(platform, count); }
    _recordValid(platform, count = 1) { return this._scanReportAccumulator.recordValid(platform, count); }
    _recordSkip(platform, reason, candidate = {}) { return this._scanReportAccumulator.recordSkip(platform, reason, candidate); }
    _recordError(platform, err) { return this._scanReportAccumulator.recordError(platform, err); }

    _scannerPlatformForGame(game = {}) {
        return scannerPlatformForGame(game);
    }

    _isScannerOwnedGame(game = {}) {
        return isScannerOwnedGame(game);
    }

    _prepareScannerGame(game, platform, scanStartedAt) {
        return prepareScannerGame(game, platform, scanStartedAt);
    }

    _preferDetectedCandidate(existing, candidate) {
        return preferDetectedCandidate(existing, candidate);
    }

    _missingReasonForStoredGame(game = {}) {
        return missingReasonForStoredGame(game);
    }

    async _writeScanDiagnostics(report) {
        return this._scanDiagnosticsWriter.write(report);
    }

    // ============================================================
    // CORE DELEGATION (GameScannerCore)
    // ============================================================

    _getCore() {
        if (!this.__core) {
            this.__core = new GameScannerCore({
                programData:     this.programData,
                dbFolder:        this.dbFolder,
                testDriveRoots:  this._testDriveRoots,
                riotSearchRoots: this._riotSearchRoots,
                api:             baddelApi,
                mrm:             this._mrm,
                MRM_STATUS,
            });
        }
        return this.__core;
    }


    async getSteamGames()      { return this._getCore().getSteamGames(); }
    async getLocalSteamGames() { return this._getCore().getLocalSteamGames(); }
    async getEpicGames()       { return this._getCore().getEpicGames(); }
    async getRiotGames()       { return this._getCore().getRiotGames(); }
    async getUbisoftGames()    { return this._getCore().getUbisoftGames(); }
    async getEAGames()         { return this._getCore().getEAGames(); }
    async getXboxGames()       { return this._getCore().getXboxGames(); }

    _buildUbisoftGameFromCandidate(candidate) { return this._getCore()._buildUbisoftGameFromCandidate(candidate); }
    _buildSteamGameFromManifest(appsPath, acf, sourceFile) { const r = this._getCore()._buildSteamGameFromManifest(appsPath, acf, sourceFile); this._syncCoreReports(); return r; }
    _buildEpicGameFromManifest(data, sourceFile) { const r = this._getCore()._buildEpicGameFromManifest(data, sourceFile); this._syncCoreReports(); return r; }
    _buildEAGameFromCandidate(candidate) { const r = this._getCore()._buildEAGameFromCandidate(candidate); this._syncCoreReports(); return r; }
    _syncCoreReports() { if (!this._currentScanReports) this._currentScanReports = {}; Object.assign(this._currentScanReports, this._getCore().getScanReports()); }

    async updateGameMetadata(gameId, metadata, options = {}) { return this._jsonGameRepository.updateGameMetadata(gameId, metadata, options); }

    async updatePlaytime(gameId, playedMinutes) { return this._jsonGameRepository.updatePlaytime(gameId, playedMinutes); }

    async saveQualifiedSession(gameId, sessionData)     { return this._jsonGameRepository.saveQualifiedSession(gameId, sessionData); }
    async setTimeTrackingEnabled(gameId, enabled)       { return this._jsonGameRepository.setTimeTrackingEnabled(gameId, enabled); }
    getTimeTrackingEnabled(gameId)                       { return this._jsonGameRepository.getTimeTrackingEnabled(gameId); }

    // ============================================================
    // REORDER
    // ============================================================
    async reorderLibrary(newOrderedIds) { return this._jsonGameRepository.reorderLibrary(newOrderedIds); }

    // ============================================================
    // MANUAL ADD
    // ============================================================
async addManualGame(launchPath, customName = null, notifyCallback = null, options = {}) {
        return _addManualGameUseCase({
            launchPath,
            customName,
            notifyCallback,
            options,

            fs,
            fsSync,
            generateStableId:           input => this.generateStableId(input),
            parseShortcutArgs,
            generateMetadataCandidates,

            gamesRepository:            this._jsonGameRepository,
            metadataResolutionManager:  this._mrm,
            metadataStatus:             MRM_STATUS,
            metadataCacheStore:         this._metadataCacheStore,

            upsertGame:         game => this.upsertGame(game),
            saveDatabase:       () => this.saveDatabase(),
            getGameById:        id => this.getGameById(id),
            backgroundDownload: (metadata, gameId, cb, opts) => this.backgroundDownload(metadata, gameId, cb, opts),
        });
    }


    async backgroundDownload(metadata, gameId, notifyCallback = null, { source = 'pipeline' } = {}) {
        return _backgroundDownloadService({
            metadata,
            gameId,
            notifyCallback,
            source,
            gamesRepository:  this._jsonGameRepository,
            metadataCacheStore: this._metadataCacheStore,
        });
    }



    // ============================================================
    // GLOBAL SCAN
    // ============================================================
    async startGlobalScan() {
        return _startGlobalScanUseCase({
            runPlatformScans:      (sp) => this._runPlatformScans(sp),
            buildDetectionMap:     (official, t) => this._buildDetectionMap(official, t),
            upsertDetectedGames:   (games) => this._upsertDetectedGames(games),
            applyStalePass:        (sp, dk, t) => this._applyStalePass(sp, dk, t),
            buildScanDiagnostics:  (args) => this._buildScanDiagnostics(args),
            writeScanDiagnostics:  (report) => this._writeScanDiagnostics(report),
            logScanSummary:        () => this._logScanSummary(),
            syncToMetadataServer:  (games) => this._syncDetectedGamesToMetadataServer(games),
            flushDatabase:         () => this.flushDatabase(),
            getStoredGames:        () => this.getStoredGames(),
            resetReports:          () => { this._currentScanReports = this._scanReportAccumulator.reset(); },
            skipMetadataServerSync: this._skipMetadataServerSync,
        });
    }

    // -- Scan stage helpers --------------------------------------------------

    async _runPlatformScans(scannedPlatforms) {
        const scannerDefs = [
            { platform: 'steam',   method: 'getSteamGames',   timeoutMs: 30000 },
            { platform: 'epic',    method: 'getEpicGames',    timeoutMs: 30000 },
            { platform: 'riot',    method: 'getRiotGames',    timeoutMs: 30000 },
            { platform: 'ubisoft', method: 'getUbisoftGames', timeoutMs: 30000 },
            { platform: 'ea',      method: 'getEAGames',      timeoutMs: 30000 },
            { platform: 'xbox',    method: 'getXboxGames',    timeoutMs: 45000 },
        ];
        const official = [];
        this._getCore().clearScanReports();
        await Promise.all(scannerDefs.map(async ({ platform, method, timeoutMs }) => {
            const started = Date.now();
            const report = this._platformReport(platform);
            try {
                const games = await withTimeout(Promise.resolve().then(() => this[method]()), timeoutMs, platform);
                // Merge per-platform stats tracked by GameScannerCore into BaddelEngine's report
                const coreStats = this._getCore().getScanReports()[platform];
                if (coreStats) Object.assign(report, coreStats);
                report.durationMs = Date.now() - started;
                scannedPlatforms.add(platform);
                official.push(...(Array.isArray(games) ? games : []));
            } catch (err) {
                const coreStats = this._getCore().getScanReports()[platform];
                if (coreStats) Object.assign(report, coreStats);
                report.durationMs = Date.now() - started;
                this._recordError(platform, err);
                console.warn(`[GameScanner] ${platform} scan failed:`, err.message);
            }
        }));
        return official;
    }

    _buildDetectionMap(official, scanStartedAt) {
        const detectedMap = new Map();
        for (const rawGame of official) {
            const platform = normalizeScannerPlatform(rawGame.scannerPlatform || rawGame.platform);
            const { game, validation } = this._prepareScannerGame(rawGame, platform, scanStartedAt);
            if (!validation.valid) {
                this._recordSkip(platform, validation.reason || 'invalid', game);
                continue;
            }
            const key = makeInstalledGameKey(game);
            if (!key) {
                this._recordSkip(platform, 'missing_stable_key', game);
                continue;
            }
            game.installedGameKey = key;
            detectedMap.set(key, this._preferDetectedCandidate(detectedMap.get(key), game));
        }
        const detectedGames = [...detectedMap.values()];
        const detectedKeys = new Set(detectedMap.keys());
        return { detectedMap, detectedGames, detectedKeys };
    }

    async _upsertDetectedGames(detectedGames) {
        for (const game of detectedGames) {
            try {
                await this.upsertGame(game);
            } catch (err) {
                this._recordError(game.scannerPlatform || 'unknown', err);
            }
        }
    }

    _applyStalePass(scannedPlatforms, detectedKeys, scanStartedAt) {
        let totalStaleRemoved = 0;
        for (const game of this.getAllGames()) {
            const platform = this._scannerPlatformForGame(game);
            if (!platform || !scannedPlatforms.has(platform)) continue;
            if (!this._isScannerOwnedGame(game)) continue;
            const key = game.installedGameKey || makeInstalledGameKey(game);
            if (key && detectedKeys.has(key)) continue;

            const reason = this._missingReasonForStoredGame(game);
            const wasVisible = game.isInstalled !== false;
            game.installSource = 'scanner';
            game.scannerPlatform = platform;
            game.installedGameKey = key || game.installedGameKey;
            game.isInstalled = false;
            game.installVerified = false;
            game.removedFromDiskAt = game.removedFromDiskAt || scanStartedAt;
            game.lastMissingScanAt = scanStartedAt;
            game.missingReason = reason;
            game.validationWarnings = [...new Set([...(game.validationWarnings || []), reason])];
            if (wasVisible) {
                totalStaleRemoved++;
                this._platformReport(platform).staleRemoved++;
                console.log(`[GameScanner] Missing game hidden: ${game.name} reason=${reason} oldPath=${game.path || game.executablePath || ''}`);
            }
        }
        return totalStaleRemoved;
    }

    _buildScanDiagnostics({ scanStartedAt, scanStartedMs, official, detectedGames, totalStaleRemoved, scannedPlatforms }) {
        const scanFinishedAt = new Date().toISOString();
        return {
            scanStartedAt,
            scanFinishedAt,
            durationMs: Date.now() - scanStartedMs,
            rawDetected: official.length,
            uniqueDetected: detectedGames.length,
            staleRemoved: totalStaleRemoved,
            scannedPlatforms: [...scannedPlatforms],
            platforms: this._currentScanReports,
            visibleGamesAfterScan: this.getStoredGames().length,
        };
    }

    _logScanSummary() {
        for (const platform of Object.keys(this._currentScanReports)) {
            const r = this._currentScanReports[platform];
            console.log(`[GameScanner] Summary platform=${platform} raw=${r.raw} valid=${r.valid} skipped=${r.skipped} staleRemoved=${r.staleRemoved} durationMs=${r.durationMs}`);
        }
    }

    _syncDetectedGamesToMetadataServer(detectedGames) {
        try {
            const steamGames = detectedGames
                .filter(g => g.scannerPlatform === 'steam')
                .map(g => {
                    const id = g.allIds?.steam || String(g.id).replace(/^steam[-_]/i, '');
                    return { id, title: g.name, slug: g.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') };
                })
                .filter(g => /^\d+$/.test(g.id));

            if (steamGames.length > 0) {
                console.log(`[GameScanner] Syncing ${steamGames.length} Steam games to metadata server`);
                baddelApi.importGames('steam', steamGames).catch(err =>
                    console.warn('[GameScanner] Failed to sync Steam games:', err.message)
                );
            } else {
                console.log('[GameScanner] No Steam games found to sync');
            }

            const epicGames = detectedGames
                .filter(g => g.scannerPlatform === 'epic')
                .map(g => {
                    const id = g.allIds?.epic || g.namespace || null;
                    return id ? { id, title: g.name, slug: g.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), cover_url: g.image || null, hero_url: g.heroImage || null } : null;
                })
                .filter(g => {
                    if (!g) return false;
                    const valid = g.id.length >= 10 && /^[a-f0-9\-]+$/i.test(g.id);
                    if (!valid) console.warn(`[GameScanner] Epic game "${g.title}" - invalid namespace "${g.id}", skipping server sync`);
                    return valid;
                });

            if (epicGames.length > 0) {
                console.log(`[GameScanner] Syncing ${epicGames.length} Epic games to metadata server`);
                baddelApi.importGames('epic', epicGames).catch(err =>
                    console.warn('[GameScanner] Failed to sync Epic games:', err.message)
                );
            } else {
                console.log('[GameScanner] No Epic games with valid namespaces found to sync');
            }
        } catch (err) {
            console.warn('[GameScanner] Metadata server sync error:', err.message);
        }
    }
}

module.exports = { BaddelEngine };
