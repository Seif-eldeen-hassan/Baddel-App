const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
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
const baddelApi = require('./services/baddelApi');
const { MetadataResolutionManager, STATUS: MRM_STATUS } = require('./services/metadataResolutionManager');
const { generateMetadataCandidates } = require('./services/candidateGenerator');

// ─── Utility functions imported from GameScannerCore ─────────────────────────
const {
    GameScannerCore,
    parseShortcutArgs,
    _cacheBaseName,
    _mapPlatformHint,
    SCANNER_PLATFORMS,
    PLATFORM_LABEL_TO_KEY,
    _cleanPathInput,
    normalizePath,
    pathExists,
    fileExists,
    dirExists,
    isLauncherOrHelperExe,
    dirHasUsefulFiles,
    findFirstExisting,
    findLikelyGameExe,
    safeJsonParse,
    normalizeDisplayName,
    normalizeScannerPlatform,
    makeInstalledGameKey,
    isGameInstallValid,
    withTimeout,
    _hashShort,
} = require('./src/features/games/infrastructure/scanner/GameScannerCore');
const { JsonGameRepository } = require('./src/features/games/infrastructure/repositories/JsonGameRepository');
const { ImageCacheService } = require('./src/features/games/infrastructure/services/ImageCacheService');


// ============================================================
// ENGINE CLASS
// ============================================================
class BaddelEngine {
    constructor(options = {}) {
        this.programData = options.programData || process.env.ProgramData || 'C:\\ProgramData';
        this.appData = options.appData || process.env.APPDATA || path.join(process.env.HOME || os.homedir(), 'AppData', 'Roaming');
        this.dbFolder = options.dbFolder || app.getPath('userData');
        this.dbPath = path.join(this.dbFolder, 'games-db.json');
        this.officialPaths = new Set();
        this._saveTimer = null; // retained for compatibility; timer is now owned by JsonGameRepository
        this._currentScanReports = {};
        this._skipMetadataServerSync = !!options.skipMetadataServerSync;
        this._testDriveRoots = options.driveRoots || null;
        this._riotSearchRoots = options.riotSearchRoots || null;
        this.__core = null; // lazy — created on first scan (after module-level mrm/baddelApi are initialized)
        this._jsonGameRepository = new JsonGameRepository({
            fs: fsSync,
            path,
            crypto,
            databasePath: this.dbPath,
            keyResolver:  makeInstalledGameKey,
        });
        this._imageCacheService = new ImageCacheService({
            fs: fsSync,
            path,
            dbFolder: this.dbFolder,
        });
        // dbCache is a get/set proxy to this._jsonGameRepository._dbCache
    }

    // ─── dbCache get/set proxy ───────────────────────────────────────────────
    // All BaddelEngine methods share the single array owned by JsonGameRepository.
    // Delegated methods (init/save/rename/etc.) go through the repository directly;
    // non-delegated methods (upsertGame, scan, metadata, playtime) read/write through
    // this proxy and therefore always see the same underlying array.
    get dbCache()    { return this._jsonGameRepository._dbCache; }
    set dbCache(arr) { this._jsonGameRepository._dbCache = arr; }
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

    // Async write with 500ms debounce — delegated to JsonGameRepository
    saveDatabase() { return this._jsonGameRepository.saveDatabase(); }

    // ============================================================
    // UPSERT
    // ============================================================
    async upsertGame(game) {
        if (!game.id) game.id = this.generateStableId(game);
        game.installedGameKey = game.installedGameKey || makeInstalledGameKey(game);

        // ── Image cache recovery (INSERT path only) ──────────────────────────
        // Legacy: findInCache was only called when no existing record was found.
        // Calling it on UPDATE would be an unnecessary filesystem read.
        const willUpdate = this._jsonGameRepository.hasUpsertMatch(game);
        const cachedCover = willUpdate ? null : (game.image     || this.findInCache(game.id, 'cover'));
        const cachedHero  = willUpdate ? null : (game.heroImage || this.findInCache(game.id, 'hero'));
        const cachedLogo  = willUpdate ? null : (game.logo      || this.findInCache(game.id, 'logo'));

        this._jsonGameRepository.upsertGameRecord(game, { cachedCover, cachedHero, cachedLogo });
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
        const removedCount = this._jsonGameRepository.deleteGameById(gameId);
        if (removedCount > 0) {
            this.deleteGameImages(gameId);
            try { mrm.clearJob(gameId); } catch (_) {}
            try { await metadataCacheStore.deleteEntry(gameId); } catch (_) {}
            this.saveDatabase();
            return { status: 'success' };
        }
        return { status: 'error', message: 'Game not found' };
    }

    // Permanently remove Epic non-game entries (Fab assets, Unreal Marketplace
    // plugins, etc.) that were imported before the strict classifier existed.
    // Called after each Epic sync with the list of rejected/unknown entries.
    async removeEpicNonGameEntries(badEntries = []) {
        if (!Array.isArray(badEntries) || badEntries.length === 0) return { removed: 0 };

        const { isEpicSyncedGameAllowed } = require('./platformSyncShared');

        const normalize = v => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');

        const badAppNames = new Set(
            badEntries.map(e => normalize(e?.app_name)).filter(Boolean)
        );
        const badTitles = new Set(
            badEntries.map(e => normalize(e?.app_title || e?.title)).filter(Boolean)
        );

        const removed = [];

        for (const game of this.getAllGames()) {
            const isEpic = game.platform === 'epic' || game.source === 'epic';
            if (!isEpic) continue;

            // Match by app_name or normalized title against the bad-entry lists.
            const gameAppName = normalize(game.appName || game.app_name);
            const gameTitle   = normalize(game.title || game.name);
            const gameId      = normalize(game.id);

            if ((gameAppName && badAppNames.has(gameAppName)) ||
                (gameTitle   && badTitles.has(gameTitle))     ||
                (gameId      && badAppNames.has(gameId))      ||
                !isEpicSyncedGameAllowed(game)) {
                removed.push(game.id);
            }
        }

        if (removed.length > 0) {
            this._jsonGameRepository.deleteGamesByIds(removed);
            removed.forEach(id => this.deleteGameImages(id));
            this.saveDatabase();
            console.log(`[GameScanner] Removed ${removed.length} Epic non-game entries:`, removed);
        }

        return { removed: removed.length, ids: removed };
    }

    // ============================================================
    // IMAGES
    // ============================================================
    updateGameImage(gameId, newImagePath, type = 'cover') { return this._jsonGameRepository.updateGameImage(gameId, newImagePath, type); }

    async resetGameImage(gameId, type = 'cover', opts = {}) {
        const game = this._jsonGameRepository.getGameById(gameId);
        if (!game) return { status: 'error', message: 'Game not found' };

        const resetAll = type === 'all' || opts.all === true;

        const resolvedPaths = {};
        if (resetAll || type === 'cover') {
            resolvedPaths.cover = game.defaultImage || this._imageCacheService.findInCache(gameId, 'cover') || null;
        }
        if (resetAll || type === 'hero') {
            resolvedPaths.hero = game.defaultHero || this._imageCacheService.findInCache(gameId, 'hero') || null;
        }
        if (resetAll || type === 'logo') {
            resolvedPaths.logo = game.defaultLogo || this._imageCacheService.findInCache(gameId, 'logo') || null;
        }

        return this._jsonGameRepository.applyImageReset(gameId, resolvedPaths, { type, resetAll });
    }

    findInCache(gameId, type)  { return this._imageCacheService.findInCache(gameId, type); }

    deleteGameImages(gameId)   { this._imageCacheService.deleteGameImages(gameId); }

    async downloadToCache(url, gameId, type) {
        // All image caching is now handled by baddelapi
        return url || null;
    }

    _platformReport(platform) {
        const key = normalizeScannerPlatform(platform);
        if (!this._currentScanReports[key]) {
            this._currentScanReports[key] = {
                platform: key,
                raw: 0,
                valid: 0,
                kept: 0,
                skipped: 0,
                skippedStale: 0,
                skippedMissingPath: 0,
                skippedMissingExe: 0,
                staleRemoved: 0,
                durationMs: 0,
                errors: [],
            };
        }
        return this._currentScanReports[key];
    }

    _recordRaw(platform, count = 1) {
        this._platformReport(platform).raw += count;
    }

    _recordValid(platform, count = 1) {
        const report = this._platformReport(platform);
        report.valid += count;
        report.kept += count;
    }

    _recordSkip(platform, reason, candidate = {}) {
        const report = this._platformReport(platform);
        report.skipped++;
        if (reason === 'install_path_missing') report.skippedMissingPath++;
        else if (reason === 'exe_missing') report.skippedMissingExe++;
        else if (reason === 'stale_registry_entry' || reason === 'install_path_empty') report.skippedStale++;
        if (platform === 'ubisoft') {
            console.log(`[Ubisoft Scan] SKIP stale registry entry "${candidate.name || candidate.Name || candidate.DisplayName || 'Unknown'}" ${reason} path=${candidate.path || candidate.Path || candidate.InstallDir || candidate.InstallLocation || ''}`);
        }
    }

    _recordError(platform, err) {
        this._platformReport(platform).errors.push(err?.message || String(err));
    }

    _scannerPlatformForGame(game = {}) {
        const platform = normalizeScannerPlatform(game.scannerPlatform || game.platform || game.source);
        if (SCANNER_PLATFORMS.has(platform)) return platform;

        const id = String(game.id || '').toLowerCase();
        if (id.startsWith('steam-')) return 'steam';
        if (id.startsWith('epic-')) return 'epic';
        if (id.startsWith('riot-')) return 'riot';
        if (id.startsWith('ubisoft-')) return 'ubisoft';
        if (id.startsWith('ea-')) return 'ea';
        if (id.startsWith('xbox-')) return 'xbox';
        return null;
    }

    _isScannerOwnedGame(game = {}) {
        if (game.installSource === 'scanner') return true;
        if (game.installSource && game.installSource !== 'scanner') return false;
        const platform = this._scannerPlatformForGame(game);
        if (!platform) return false;
        if (String(game.platform || '').toLowerCase() === 'manual') return false;
        return !!(game.command || game.path || game.launcherGameId || game.allIds);
    }

    _prepareScannerGame(game, platform, scanStartedAt) {
        const scannerPlatform = normalizeScannerPlatform(platform || game.scannerPlatform || game.platform);
        const validation = isGameInstallValid({ ...game, scannerPlatform });
        const prepared = {
            ...game,
            name: normalizeDisplayName(game.name || game.title),
            installSource: 'scanner',
            scannerPlatform,
            launchCommand: game.launchCommand || game.command || null,
            installVerified: validation.valid,
            isInstalled: validation.valid,
            firstSeenAt: game.firstSeenAt || scanStartedAt,
            lastSeenAt: scanStartedAt,
            scanSourceDetail: game.scanSourceDetail || scannerPlatform,
            validationWarnings: [
                ...(Array.isArray(game.validationWarnings) ? game.validationWarnings : []),
                ...(validation.validationWarnings || [])
            ],
        };
        prepared.installedGameKey = game.installedGameKey || makeInstalledGameKey(prepared);
        if (!prepared.launcherGameId) {
            if (scannerPlatform === 'steam') prepared.launcherGameId = prepared.allIds?.steam || String(prepared.id || '').replace(/^steam[-_]/i, '');
            if (scannerPlatform === 'epic') prepared.launcherGameId = [prepared.namespace || prepared.catalogNamespace, prepared.catalogItemId, prepared.appName].filter(Boolean).join(':');
            if (scannerPlatform === 'riot') prepared.launcherGameId = prepared.riotProduct;
            if (scannerPlatform === 'xbox') prepared.launcherGameId = prepared.packageFamilyName;
        }
        return { game: prepared, validation };
    }

    _preferDetectedCandidate(existing, candidate) {
        if (!existing) return candidate;
        const existingHasExe = !!existing.executablePath;
        const candidateHasExe = !!candidate.executablePath;
        if (candidateHasExe && !existingHasExe) return candidate;
        if (candidateHasExe === existingHasExe) {
            const existingPath = normalizePath(existing.path || '');
            const candidatePath = normalizePath(candidate.path || '');
            if (candidatePath && (!existingPath || candidatePath.length < existingPath.length)) return candidate;
        }
        return existing;
    }

    _missingReasonForStoredGame(game = {}) {
        // Epic non-game assets (Fab, Marketplace plugins, etc.) get a specific reason
        // so they can be distinguished from genuinely missing games.
        if (game.scannerPlatform === 'epic' || game.platform === 'Epic Games') {
            const { classifyEpicEntry } = require('./platformSyncShared');
            const { decision } = classifyEpicEntry({
                app_name:  game.appName || '',
                app_title: game.name   || '',
                title:     game.name   || '',
                namespace: game.namespace || game.catalogNamespace || '',
                metadata:  {},
            });
            if (decision === 'reject') return 'epic_non_game_asset';
        }
        if (game.path && !dirExists(game.path) && !fileExists(game.path)) return 'install_path_missing';
        if (game.executablePath && !fileExists(game.executablePath)) return 'exe_missing';
        return 'not_seen_in_latest_scan';
    }

    async _writeScanDiagnostics(report) {
        try {
            const dir = path.join(this.dbFolder, 'scan-diagnostics');
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(path.join(dir, 'latest-scan.json'), JSON.stringify(report, null, 2), 'utf8');
        } catch (err) {
            console.warn('[GameScanner] Failed to write scan diagnostics:', err.message);
        }
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
                mrm,
                MRM_STATUS,
            });
        }
        return this.__core;
    }


    async getOfficialGames() {
        const results = await Promise.allSettled([
            this.getSteamGames(),
            this.getEpicGames(),
            this.getRiotGames(),
            this.getUbisoftGames(),
            this.getEAGames(),
            this.getXboxGames()
        ]);
        const flatList = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
        flatList.forEach(g => { if (g.path) this.officialPaths.add(g.path.toLowerCase()); });
        return flatList;
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
        const lnkTarget     = options?.lnkTarget    || null;
        const metadataPath  = options?.metadataPath || lnkTarget || launchPath;
        const shortcutArgs  = options?.shortcutArgs || '';
        const shortcutCwd   = options?.shortcutCwd  || null;
        const forceMetadata = options?.forceMetadata === true || options?.force === true;

        try {
            const stats = await fs.stat(launchPath);
            if (!stats.isFile()) return { status: 'error', message: 'File not found' };

            // effectivePath is the real executable (or lnk target) used for
            // metadata — never a Desktop .lnk path.
            const effectivePath  = metadataPath;
            const rawExeStem     = path.parse(effectivePath).name;
            const exeName        = rawExeStem.replace(/[-_]/g, ' ').trim();
            const parentFolder   = path.basename(path.dirname(effectivePath)).replace(/[-_]/g, ' ').trim();

            // Compute stable ID from effectivePath so the same game reached via
            // different .lnk shortcuts doesn't create duplicate DB entries.
            const tempId = this.generateStableId({ command: effectivePath, name: customName || exeName });

            // ── Duplicate / re-add check ───────────────────────────────────────
            const normalizedLaunchPath    = path.normalize(launchPath).toLowerCase().trim();
            const normalizedEffectivePath = path.normalize(effectivePath).toLowerCase().trim();
            const existingIndex = this.dbCache.findIndex(g => {
                const cmd = path.normalize((g.command || '').replace(/"/g, '').trim()).toLowerCase();
                const exe = path.normalize((g.executablePath || '').replace(/"/g, '').trim()).toLowerCase();
                return cmd === normalizedLaunchPath || exe === normalizedEffectivePath;
            });
            if (existingIndex > -1) {
                const existing = this.dbCache[existingIndex];
                if (existing.isHidden) { existing.isHidden = false; this.saveDatabase(); }
                return { status: 'success', game: existing };
            }

            const primaryTitle = customName || parentFolder || exeName;

            // Build slug helper for MRM candidates
            const _toSlug = str => (str || '').toLowerCase()
                .replace(/[''`™®©]/g, '')
                .replace(/[^a-z0-9\s-]/g, ' ')
                .replace(/\s+/g, '-')
                .replace(/-{2,}/g, '-')
                .replace(/^-+|-+$/g, '');

            // Build MRM candidates using effectivePath so a Desktop .lnk doesn't
            // mislead camelCase splitting or franchise alias expansion.
            const mrmCandidates = generateMetadataCandidates({
                name:       customName || parentFolder,
                folderName: parentFolder,
                exeName:    rawExeStem,
                pathHint:   effectivePath,
            });

            // ── Route ALL resolution through MRM ──────────────────────────────
            let finalMetadata = null;
            let finalName     = primaryTitle;
            let validationDeferred = false;

            const mrmStatus = mrm.getStatus(tempId);

            if (mrmStatus === MRM_STATUS.COOLDOWN && !forceMetadata) {
                console.log(`[Manual Add] MRM cooldown active for "${primaryTitle}" — deferred`);
                validationDeferred = true;
            } else {
                console.log(`[Manual Add] MRM candidates for "${primaryTitle}": ${mrmCandidates.map(c => c.title || c.slug).join(', ')}`);
                const resolveResult = await mrm.resolve(tempId, {
                    candidates:  mrmCandidates,
                    title:       primaryTitle,
                    slug:        _toSlug(primaryTitle) || undefined,
                    exeName:     exeName      || undefined,
                    folderName:  parentFolder || undefined,
                    pathHint:    effectivePath || undefined,
                    force:       forceMetadata || undefined,
                    bypassTtl:   forceMetadata || undefined,
                });

                if (resolveResult) {
                    finalMetadata = resolveResult.meta;
                    if (!customName) finalName = resolveResult.matchedName || primaryTitle;
                    console.log(`[Manual Add] ✓ MRM resolved "${primaryTitle}" via ${resolveResult._resolveSource}`);
                } else {
                    if (mrm.getStatus(tempId) === MRM_STATUS.COOLDOWN && !forceMetadata) {
                        console.warn(`[Manual Add] MRM entered cooldown for "${primaryTitle}" — deferred`);
                        validationDeferred = true;
                    }
                }
            }

            const isLnk = launchPath.toLowerCase().endsWith('.lnk');
            // installDir is the real game folder, never the Desktop / shortcut folder
            const installDir = fsSync.existsSync(effectivePath)
                ? path.dirname(effectivePath)
                : path.dirname(launchPath);

            const newGame = {
                id:              tempId,
                name:            finalName,
                command:         launchPath,
                shortcutPath:    isLnk ? launchPath : null,
                path:            installDir,
                executablePath:  effectivePath,
                folderName:      parentFolder,
                exeName:         rawExeStem,
                launchArgs:      parseShortcutArgs(shortcutArgs),
                launchCwd:       shortcutCwd || installDir,
                rawShortcutArgs: shortcutArgs || '',
                scannerPlatform: 'manual',
                installSource:   'manual',
                isInstalled:     true,
                platform:        'Manual',
                image:     finalMetadata?.cover     || finalMetadata?.image     || null,
                heroImage: finalMetadata?.heroImage || finalMetadata?.hero      || null,
                logo:      finalMetadata?.logo                                  || null,
                score:     100,
                isHidden:  false,
                addedAt:   new Date().toISOString(),
                ...(validationDeferred ? {
                    needsValidation:    true,
                    validationDeferred: true,
                    validationReason:   'manual_add_rate_limited',
                } : {}),
            };

            await this.upsertGame(newGame);
            this.saveDatabase();

            // ── Persist full structured metadata immediately ───────────────────
            // game-details.js reads from metadataCacheStore via loadFullMetadata().
            // Without this call the details page has no description, screenshots,
            // ratings, etc. even though the card already shows the poster.
            if (finalMetadata) {
                metadataCacheStore.save(tempId, finalName, 'Manual', finalMetadata)
                    .catch(err => console.warn('[Manual Add] Failed to persist full metadata:', err.message));
            }

            // Download images to local WebP cache before returning so the
            // renderer receives a game with file:// cover/hero/logo already set.
            if (finalMetadata) {
                await this.backgroundDownload(finalMetadata, tempId, notifyCallback, { source: 'addManual' });
            }
            const hydratedGame = this.getGameById(tempId) || newGame;
            return { status: 'success', game: hydratedGame };
        } catch (err) {
            console.error('[Manual Add]', err);
            return { status: 'error', message: err.message };
        }
    }


    async backgroundDownload(metadata, gameId, notifyCallback = null, { source = 'pipeline' } = {}) {
        try {
            const [cover, hero, logo] = await Promise.all([
                metadata.cover ? this.downloadToCache(metadata.cover, gameId, 'cover') : null,
                metadata.hero  ? this.downloadToCache(metadata.hero,  gameId, 'hero')  : null,
                metadata.logo  ? this.downloadToCache(metadata.logo,  gameId, 'logo')  : null
            ]);

            const finalCover = cover || metadata.cover || null;
            const finalHero  = hero  || metadata.heroImage || metadata.hero || null;
            const finalLogo  = logo  || metadata.logo  || null;

            if (finalCover || finalHero || finalLogo) {
                await this.updateGameMetadata(gameId, {
                    cover: finalCover,
                    hero:  finalHero,
                    logo:  finalLogo,
                }, { source });

                // Re-persist the full metadata payload with local file:// paths
                // so that game-details.js (via loadFullMetadata) sees the locally
                // cached art instead of the remote CDN URL.
                const game = this._jsonGameRepository.getGameById(gameId);
                if (game && metadata) {
                    const updatedMeta = {
                        ...metadata,
                        cover:     finalCover,
                        heroImage: finalHero,
                        hero:      finalHero,
                        logo:      finalLogo,
                    };
                    metadataCacheStore.save(gameId, game.name, game.platform, updatedMeta)
                        .catch(err => console.warn('[Background Download] Failed to re-persist metadata with local paths:', err.message));
                }

                // إرسال إشعار للواجهة بعد اكتمال التحميل تماماً
                if (notifyCallback) {
                    const updatedGame = this._jsonGameRepository.getGameById(gameId);
                    if (updatedGame) notifyCallback(updatedGame);
                }
            }
        } catch (err) {
            console.error('[Background Download]', err);
        }
}



    // ============================================================
    // GLOBAL SCAN
    // ============================================================
    async startGlobalScan() {
        {
            const scanStartedAt = new Date().toISOString();
            const scanStartedMs = Date.now();
            this._currentScanReports = {};
            const scannedPlatforms = new Set();
            const scannerDefs = [
                { platform: 'steam', method: 'getSteamGames', timeoutMs: 30000 },
                { platform: 'epic', method: 'getEpicGames', timeoutMs: 30000 },
                { platform: 'riot', method: 'getRiotGames', timeoutMs: 30000 },
                { platform: 'ubisoft', method: 'getUbisoftGames', timeoutMs: 30000 },
                { platform: 'ea', method: 'getEAGames', timeoutMs: 30000 },
                { platform: 'xbox', method: 'getXboxGames', timeoutMs: 45000 },
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
            for (const game of detectedGames) {
                try {
                    await this.upsertGame(game);
                } catch (err) {
                    this._recordError(game.scannerPlatform || 'unknown', err);
                }
            }

            let totalStaleRemoved = 0;
            for (const game of this.dbCache) {
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

            await this.flushDatabase();

            const scanFinishedAt = new Date().toISOString();
            const diagnostics = {
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
            await this._writeScanDiagnostics(diagnostics);

            for (const platform of Object.keys(this._currentScanReports)) {
                const r = this._currentScanReports[platform];
                console.log(`[GameScanner] Summary platform=${platform} raw=${r.raw} valid=${r.valid} skipped=${r.skipped} staleRemoved=${r.staleRemoved} durationMs=${r.durationMs}`);
            }

            if (!this._skipMetadataServerSync) {
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

            return this.getStoredGames();
        }
        
        // ─── Sync Steam & Epic games to metadata server ───
        try {
            // Extract Steam games
            const steamGames = official
                .filter(g => g.platform === 'Steam')
                .map(g => {
                    // Use allIds.steam (set at scan time) — always a clean numeric appid
                    const id = g.allIds?.steam || String(g.id).replace(/^steam[-_]/i, '');
                    return { id, title: g.name, slug: g.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') };
                })
                .filter(g => /^\d+$/.test(g.id)); // guard: only numeric appids are valid

            if (steamGames.length > 0) {
                console.log(`[GameScanner] Syncing ${steamGames.length} Steam games to metadata server`);
                baddelApi.importGames('steam', steamGames).catch(err =>
                    console.warn('[GameScanner] Failed to sync Steam games:', err.message)
                );
            } else {
                console.log('[GameScanner] No Steam games found to sync');
            }

            // ─── Sync Epic games to metadata server (namespace only — never AppName) ─
            const epicGames = official
                .filter(g => g.platform === 'Epic Games' || g.platform === 'Epic')
                .map(g => {
                    // Use allIds.epic (CatalogNamespace set at scan time)
                    const id = g.allIds?.epic || g.namespace || null;
                    return id ? { id, title: g.name, slug: g.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), cover_url: g.image || null, hero_url: g.heroImage || null } : null;
                })
                .filter(g => {
                    if (!g) return false;
                    // Validate: namespace must be a hex UUID, not an appName like 'Sugar'
                    const valid = g.id.length >= 10 && /^[a-f0-9\-]+$/i.test(g.id);
                    if (!valid) console.warn(`[GameScanner] Epic game "${g.title}" — invalid namespace "${g.id}", skipping server sync`);
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
        
        return this.getStoredGames()
    }
}

// ============================================================
// SINGLETON + EXPORTS
// ============================================================
const engine = new BaddelEngine();
async function refetchMissingImages(notifyCallback) {
    const fsSync = require('fs');
    let updated = false;

    for (const game of engine.getStoredGames()) {
        if (!game.isHidden && !game.customArtworkLocked) {
            let isMissing = false;

            if (game.image && game.image.startsWith('file://')) {
                try {
                    const cleanPath = decodeURI(game.image.replace('file://', ''));
                    if (!fsSync.existsSync(cleanPath)) isMissing = true;
                } catch (e) { isMissing = true; }
            } else if (!game.image) {
                isMissing = true;
            }

            if (isMissing) {
                try {
                    // Try to fetch from Baddel metadata server by title
                    const meta = await baddelApi.lookupGame({ title: game.name });
                    if (meta && meta.images) {
                        const coverImg = meta.images.find(i => i.image_type === 'cover');
                        if (coverImg) {
                            const coverUrl = coverImg.cdn_url || coverImg.url;
                            if (coverUrl) {
                                await engine.backgroundDownload({ cover: coverUrl }, game.id, notifyCallback, { source: 'pipeline' });
                                updated = true;
                            }
                        }
                    }
                } catch (e) { /* skip */ }
            }
        }
    }
    if (updated) engine.saveDatabase();
}

// ============================================================
// METADATA CACHE STORE
// Full structured metadata fallback cache — separate from games-db.json
// Keyed by game.id; stores rich fields (description, screenshots, etc.)
// ============================================================
// ============================================================
// METADATA CACHE STORE
// Full structured metadata fallback cache — separate from games-db.json
// Canonicalizes Steam ids so steam-860510 and steam_860510 share one entry.
// ============================================================

function normalizeMetadataCacheKey(gameId) {
    const raw = String(gameId || '').trim();

    // Steam installed sometimes uses steam-APPID,
    // All Games sometimes uses steam_APPID.
    // Force both to one canonical cache key.
    const steam = raw.match(/^steam[-_](\d+)$/i);
    if (steam) return `steam_${steam[1]}`;

    return raw;
}

function metadataCacheAliases(gameId) {
    const raw = String(gameId || '').trim();
    const keys = new Set();

    if (raw) keys.add(raw);

    const canonical = normalizeMetadataCacheKey(raw);
    if (canonical) keys.add(canonical);

    const steam = raw.match(/^steam[-_](\d+)$/i);
    if (steam) {
        keys.add(`steam-${steam[1]}`);
        keys.add(`steam_${steam[1]}`);
    }

    return [...keys].filter(Boolean);
}

function isHollowMetadata(meta) {
    if (!meta || typeof meta !== 'object') return true;

    const info = meta.info || {};
    const screenshots = Array.isArray(info.screenshots) ? info.screenshots : [];
    const trailers = Array.isArray(info.allTrailers) ? info.allTrailers : [];
    const genres = Array.isArray(info.genres) ? info.genres : [];
    const ratingSources = Array.isArray(meta?.quality?.sources?.ratings)
        ? meta.quality.sources.ratings
        : Array.isArray(meta?.ratings?.sources)
            ? meta.ratings.sources
            : [];

    return !(
        info.description ||
        meta.description ||
        info.short_description ||
        meta.short_description ||
        meta.quality?.sources?.text ||
        screenshots.length ||
        trailers.length ||
        genres.length ||
        ratingSources.length
    );
}

class MetadataCacheStore {
    constructor(dbFolder) {
        this.cachePath = path.join(dbFolder, 'metadata-cache.json');
        this._cache = null; // loaded lazily
    }

    async _load() {
        if (this._cache !== null) return;
        try {
            const raw = await fs.readFile(this.cachePath, 'utf8');
            this._cache = JSON.parse(raw);
        } catch {
            this._cache = {};
        }
    }

    async _flush() {
        try {
            await fs.writeFile(this.cachePath, JSON.stringify(this._cache, null, 2), 'utf8');
        } catch (err) {
            console.warn('[MetadataCacheStore] flush error:', err.message);
        }
    }

    async save(gameId, title, platform, meta) {
        await this._load();

        const key = normalizeMetadataCacheKey(gameId);

        this._cache[key] = {
            gameId: key,
            originalGameId: String(gameId || ''),
            title: title || null,
            platform: platform || null,
            fetchedAt: Date.now(),
            source: 'fallback-getMetadata',
            meta,
        };

        // Remove old duplicate aliases like steam-860510
        // so the app cannot read the wrong/hollow cache later.
        for (const alias of metadataCacheAliases(gameId)) {
            if (alias !== key && this._cache[alias]) {
                delete this._cache[alias];
                console.log(`[MetadataCacheStore] Removed duplicate alias cache key=${alias}; canonical=${key}`);
            }
        }

        await this._flush();

        console.log(`[MetadataCacheStore] Persisted fallback metadata for gameId=${key} ("${title}")`);
        return { status: 'success' };
    }

    async load(gameId) {
        await this._load();

        const canonicalKey = normalizeMetadataCacheKey(gameId);
        const aliases = metadataCacheAliases(gameId);

        for (const key of [canonicalKey, ...aliases.filter(k => k !== canonicalKey)]) {
            const entry = this._cache[key] || null;
            if (!entry) continue;

            const meta = entry.meta || null;

            // If the found entry is hollow/empty, delete it and keep searching aliases.
            if (isHollowMetadata(meta)) {
                console.warn(`[MetadataCacheStore] Ignoring hollow cached metadata for gameId=${key} ("${entry.title || ''}")`);
                delete this._cache[key];
                await this._flush();
                continue;
            }

            // If found under old key steam-xxxx, migrate it to steam_xxxx.
            if (key !== canonicalKey) {
                this._cache[canonicalKey] = {
                    ...entry,
                    gameId: canonicalKey,
                    originalGameId: entry.originalGameId || String(gameId || ''),
                };

                delete this._cache[key];
                await this._flush();

                console.log(`[MetadataCacheStore] Migrated metadata cache ${key} -> ${canonicalKey}`);
            }

            console.log(
                `[MetadataCacheStore] Loaded cached fallback metadata for gameId=${canonicalKey} ` +
                `("${entry.title}") fetchedAt=${new Date(entry.fetchedAt || Date.now()).toISOString()}`
            );

            return meta;
        }

        return null;
    }

    // Returns the full entry with title, fetchedAt, etc. — used by main.js
    async getEntry(gameId) {
        await this._load();

        const canonicalKey = normalizeMetadataCacheKey(gameId);
        const aliases = metadataCacheAliases(gameId);

        for (const key of [canonicalKey, ...aliases.filter(k => k !== canonicalKey)]) {
            const entry = this._cache[key] || null;
            if (!entry) continue;

            if (isHollowMetadata(entry.meta)) {
                delete this._cache[key];
                await this._flush();
                continue;
            }

            if (key !== canonicalKey) {
                this._cache[canonicalKey] = {
                    ...entry,
                    gameId: canonicalKey,
                    originalGameId: entry.originalGameId || String(gameId || ''),
                };

                delete this._cache[key];
                await this._flush();
            }

            return this._cache[canonicalKey];
        }

        return null;
    }

    // Check if we already have a non-stale entry.
    async hasEntry(gameId, maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
        const entry = await this.getEntry(gameId);
        if (!entry) return false;
        return (Date.now() - (entry.fetchedAt || 0)) < maxAgeMs;
    }

    // Remove stale/incomplete entry and all aliases.
    async deleteEntry(gameId) {
        await this._load();

        let changed = false;

        for (const key of metadataCacheAliases(gameId)) {
            if (this._cache[key]) {
                delete this._cache[key];
                changed = true;
                console.log(`[MetadataCacheStore] Deleted metadata cache key=${key}`);
            }
        }

        if (changed) await this._flush();
    }
}

const metadataCacheStore = new MetadataCacheStore(app.getPath('userData'));

// Single coordinator for all non-Steam/Epic metadata resolution.
// Replaces the old _resolveThrottleMap + scattered cooldown checks.
const mrm = new MetadataResolutionManager(app.getPath('userData'));
mrm.setApi(baddelApi);

// ============================================================
// BACKGROUND METADATA PIPELINE
// ============================================================
// Runs after every scan for non-Steam/Epic games.
// For each such game:
//   1. Try server lookup by slug
//   2. Try server lookup by title
//   3. If server hits → cache assets + persist full metadata
//   4. If server misses → call local resolver (getMetadataLocal) + persist
//
// `getMetadataLocal` is injected from main.js at startup to avoid circular
// dependency. Call `registerLocalMetadataResolver(fn)` once during app init.
// ============================================================

/** @type {((gameName: string, hints: object) => Promise<object|null>) | null} */
let _localMetadataResolver = null;

/**
 * Register the local metadata resolver (the same logic powering get-game-metadata IPC).
 * Called once from main.js after the IPC handlers are set up.
 * @param {(gameName: string, hints: object) => Promise<object|null>} fn
 */
function registerLocalMetadataResolver(fn) {
    _localMetadataResolver = fn;
    console.log('[BackgroundMetaPipeline] Local metadata resolver registered.');
}

/**
 * Derive a clean slug from a game title (same logic as game-details.js).
 * @param {string} name
 * @returns {{ slug: string|null, title: string }}
 */
function _resolveGenericLookup(name) {
    if (!name) return { slug: null, title: name };
    const slug = name
        .toLowerCase()
        .trim()
        .replace(/[''`™®©]/g, '')
        .replace(/[^a-z0-9\s\-]/g, ' ')
        .replace(/\s+/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-+|-+$/g, '');
    const validSlug = (slug && slug.length >= 3 && !/^\d+$/.test(slug)) ? slug : null;
    return { slug: validSlug, title: name };
}

/** Platforms that use the Steam/Epic server enrich flow — skip from this pipeline. */
const _SERVER_ENRICH_PLATFORMS = new Set(['steam', 'Steam', 'epic', 'Epic Games', 'epic games']);

// ── Background pipeline path helpers ─────────────────────────────────────────
// Prefer executablePath (the real binary) over game.path (install dir) or
// the potentially-quoted command string, so .lnk shortcuts never pollute the
// metadata candidate generator with a Desktop folder path.
function _metadataPathForGame(game) {
    return (
        game.executablePath ||
        game.launchCommand  ||
        (game.command || '').replace(/^"|"$/g, '').trim() ||
        game.path ||
        ''
    );
}

function _metadataFolderForGame(game) {
    if (game.folderName) return game.folderName;
    const p = _metadataPathForGame(game);
    if (!p) return undefined;
    try {
        const ext = path.extname(p).toLowerCase();
        // If p has an extension it's a file — use its parent dir name.
        // If no extension it's a directory — use the directory's own name.
        return ext ? path.basename(path.dirname(p)) : path.basename(p);
    } catch { return undefined; }
}

/**
 * Run the background metadata pipeline for all installed non-Steam/Epic games.
 * Safe to call multiple times — skips games that already have persisted metadata
 * less than 7 days old and skips games that are already covered by the server
 * enrich pipeline.
 *
 * @param {object[]} games       - array of installed game records from the DB
 * @param {object}   imageCache  - the IPC-layer image cache helper (optional)
 */
async function runBackgroundMetadataPipeline(games) {
    const TAG = '[BackgroundMetaPipeline]';

    // Filter: only non-Steam/Epic installed games
    const targets = games.filter(g => {
        const plat = (g.platform || '').trim();
        return !_SERVER_ENRICH_PLATFORMS.has(plat) && !g.isHidden;
    });

    if (targets.length === 0) {
        console.log(`${TAG} No non-Steam/Epic games to process. Pipeline skipped.`);
        return;
    }

    console.log(`${TAG} ══════ Pipeline START — ${targets.length} game(s) to process ══════`);

    let resolved = 0, mrmSkipped = 0, skipped = 0, missed = 0, recovered = 0;

    for (const game of targets) {
        const gameTag = `${TAG}[${game.name}]`;

        // ── Art presence helpers ──────────────────────────────────────────────
        const hasDiskCover = !!engine.findInCache(game.id, 'cover');
        const hasDiskHero  = !!engine.findInCache(game.id, 'hero');
        const hasDiskLogo  = !!engine.findInCache(game.id, 'logo');
        const hasDbArt     = !!(game.image || game.heroImage || game.logo);
        const hasDiskArt   = hasDiskCover || hasDiskHero;
        const hasAnyArt    = hasDbArt || hasDiskArt;
        const hasDbHero    = !!game.heroImage;
        const hasHero      = hasDbHero || hasDiskHero;
        const hasDbLogo    = !!(game.logo || game.defaultLogo);
        const hasLogo      = hasDbLogo || hasDiskLogo;

        // ── RECOVERY: MRM says RESOLVED but game has no usable art ────────────
        // This happens when a prior pipeline run resolved metadata but the image
        // download or DB write then failed.  Without this reset the game is stuck
        // behind the 7-day RESOLVED lock even though its card is blank.
        const mrmStatus = mrm.getStatus(game.id);
        if (mrmStatus === MRM_STATUS.RESOLVED && !hasAnyArt) {
            console.log(`${gameTag} ⚠ MRM RESOLVED but no usable art in DB/cache — resetting to IDLE`);
            mrm.resetToIdle(game.id);
            await metadataCacheStore.deleteEntry(game.id).catch(() => {});
            recovered++;
        }

        // ── Skip only when cover + hero + logo are all present + metadata cached ─
        // Any missing visual asset must NOT trigger a skip — backfill runs instead.
        try {
            if (hasAnyArt && hasHero && hasLogo && await metadataCacheStore.hasEntry(game.id)) {
                console.log(`${gameTag} ↷ Has cached metadata + cover + hero + logo — skipping.`);
                skipped++;
                continue;
            }
        } catch { /* continue */ }

        // ── Hero backfill: cover/logo present but hero still missing ──────────
        // If cached metadata already has a hero URL we can download it directly
        // without triggering a full re-resolve.  If the cached metadata has no
        // hero URL the server had no hero data at that time — honour it and skip
        // until the 7-day metadata TTL expires and triggers a fresh resolve.
        if (hasAnyArt && !hasHero) {
            let heroHandled = false;
            try {
                const hasMeta = await metadataCacheStore.hasEntry(game.id);
                if (hasMeta) {
                    console.log(`${gameTag} [HeroBackfill] missing hero but cover/logo present — retrying`);
                    const cachedMeta   = await metadataCacheStore.load(game.id);
                    const cachedHeroUrl = cachedMeta?.heroImage || cachedMeta?.hero || null;
                    if (cachedHeroUrl) {
                        let finalHero = cachedHeroUrl;
                        if (_imageDownloadFn) {
                            try {
                                const dl = await _imageDownloadFn({ hero: cachedHeroUrl }, game.id);
                                if (dl?.hero) finalHero = dl.hero;
                                console.log(`${gameTag} [HeroBackfill] hero cached successfully (${finalHero})`);
                            } catch (e) {
                                console.warn(`${gameTag} [HeroBackfill] download failed, using remote URL:`, e.message);
                            }
                        }
                        try {
                            await engine.updateGameMetadata(game.id, { hero: finalHero }, { source: 'pipeline' });
                            engine.saveDatabase();
                            console.log(`${gameTag} [HeroBackfill] reused cached metadata hero — DB updated`);
                            if (_gameImageUpdatedFn) {
                                const updatedGame = engine.getGameById(game.id);
                                if (updatedGame) _gameImageUpdatedFn(updatedGame);
                            }
                        } catch (e) {
                            console.warn(`${gameTag} [HeroBackfill] DB update failed:`, e.message);
                        }
                        heroHandled = true;
                    } else {
                        // Cache entry exists but has no hero — treat as stale/incomplete.
                        // Delete it and reset MRM so the full pipeline re-resolves fresh data.
                        console.log(`${gameTag} [IncompleteArtRecovery] cache has no hero/logo -> force refresh`);
                        await metadataCacheStore.deleteEntry(game.id).catch(() => {});
                        mrm.resetToIdle(game.id);
                        // heroHandled stays false → falls through to full resolve below
                    }
                }
                // No metadata cache entry → fall through to full pipeline
            } catch (e) {
                console.warn(`${gameTag} [HeroBackfill] error:`, e.message);
            }
            if (heroHandled) {
                await new Promise(r => setTimeout(r, 300));
                continue;
            }
        }

        // ── Logo backfill: hero present but logo still missing ────────────────
        // Runs only when hero is already resolved so we avoid a full re-resolve
        // just for a logo.  Reads from the cached metadata without network traffic.
        if (hasAnyArt && hasHero && !hasLogo) {
            try {
                const hasMeta = await metadataCacheStore.hasEntry(game.id);
                if (hasMeta) {
                    const cachedMeta    = await metadataCacheStore.load(game.id);
                    const cachedLogoUrl = cachedMeta?.logo || cachedMeta?.defaultLogo || null;
                    if (cachedLogoUrl && _imageDownloadFn) {
                        const dl = await _imageDownloadFn({ logo: cachedLogoUrl }, game.id);
                        const finalLogo = dl?.logo || cachedLogoUrl;
                        await engine.updateGameMetadata(game.id, { logo: finalLogo }, { source: 'pipeline' });
                        engine.saveDatabase();
                        console.log(`${gameTag} [IncompleteArtRecovery] backfilled logo (${finalLogo})`);
                        if (_gameImageUpdatedFn) {
                            const upd = engine.getGameById(game.id);
                            if (upd) _gameImageUpdatedFn(upd);
                        }
                    }
                    await new Promise(r => setTimeout(r, 300));
                    continue;
                }
            } catch (e) {
                console.warn(`${gameTag} [IncompleteArtRecovery] logo backfill error:`, e.message);
            }
        }

        // ── Skip games only on active cooldown MRM state ──────────────────────
        const effectiveMrmStatus = mrm.getStatus(game.id); // re-read after potential reset
        if (effectiveMrmStatus === MRM_STATUS.COOLDOWN) {
            const job = mrm.getJob(game.id);
            console.log(`${gameTag} ↷ MRM cooldown until ${new Date(job?.cooldownUntil).toISOString()} — skipping.`);
            mrmSkipped++;
            continue;
        }

        // ── Route ALL resolution through MRM (Stage 1 DB + Stage 2 transient) ─
        // Use the centralized candidate generator so compact names like "ACMirage"
        // get camelCase-split + franchise-alias expansion.
        const metadataPath = _metadataPathForGame(game);
        const candidates = generateMetadataCandidates({
            name:       game.name,
            folderName: _metadataFolderForGame(game),
            exeName:    game.exeName || (metadataPath ? path.parse(metadataPath).name : undefined),
            pathHint:   metadataPath || undefined,
        });

        console.log(`${gameTag} MRM candidates: ${candidates.map(c => c.title || c.slug).join(', ')}`);

        // primary title = game.name (or first candidate's displayName)
        const primaryTitle = game.name || (candidates[0]?.title) || '';
        const { slug: _primarySlug } = (candidates[0] ? { slug: candidates[0].slug } : {});

        const resolveResult = await mrm.resolve(game.id, {
            candidates,
            title:        primaryTitle,
            slug:         _primarySlug || undefined,
            platformHint: _mapPlatformHint(game.platform) || undefined,
        });

        const meta = resolveResult ? Object.assign({}, resolveResult.meta, { _resolveSource: resolveResult._resolveSource }) : null;

        // ── STEP 4: Persist metadata + cache assets + backfill DB ────────────
        if (meta) {
            // Use normalizeAssets to canonicalise cover/hero/logo regardless of
            // which alias the normalise functions returned (heroImage vs hero).
            const { cover: remoteCover, hero: remoteHero, logo: remoteLogo } =
                baddelApi.normalizeAssets(meta);

            try {
                await metadataCacheStore.save(game.id, game.name, game.platform, meta);
                console.log(`${gameTag} ✓ Full metadata persisted to local cache`);
                resolved++;
            } catch (err) {
                console.warn(`${gameTag} Failed to persist metadata:`, err.message);
            }

            // ── Backfill cover/hero/logo into the game DB entry ──────────────
            let finalCover = remoteCover;
            let finalHero  = remoteHero;
            let finalLogo  = remoteLogo;

            if (_imageDownloadFn) {
                try {
                    const assets = { cover: remoteCover, hero: remoteHero, logo: remoteLogo };
                    const cached = await _imageDownloadFn(assets, game.id);
                    if (cached?.cover) finalCover = cached.cover;
                    if (cached?.hero)  finalHero  = cached.hero;
                    if (cached?.logo)  finalLogo  = cached.logo;
                    console.log(`${gameTag} ✓ Assets cached locally (cover=${!!finalCover} hero=${!!finalHero} logo=${!!finalLogo})`);
                } catch (err) {
                    console.warn(`${gameTag} Asset caching error (non-fatal) — using remote URLs:`, err.message);
                }
            }

            if (finalCover || finalHero || finalLogo) {
                try {
                    await engine.updateGameMetadata(game.id, {
                        cover: finalCover,
                        hero:  finalHero,
                        logo:  finalLogo,
                    }, { source: 'pipeline' });
                    engine.saveDatabase();
                    console.log(`${gameTag} ✓ DB entry backfilled (cover=${!!finalCover} hero=${!!finalHero} logo=${!!finalLogo})`);

                    if (_gameImageUpdatedFn) {
                        const updatedGame = engine.getGameById(game.id);
                        if (updatedGame) {
                            _gameImageUpdatedFn(updatedGame);
                            console.log(`${gameTag} ✓ Renderer notified (game-image-updated)`);
                        }
                    }
                } catch (err) {
                    console.warn(`${gameTag} DB backfill error:`, err.message);
                }
            } else {
                // Metadata resolved (text / ratings) but no images at all.
                // Reset MRM so the next pipeline pass retries image fetching;
                // this keeps exception_keep_pending_art games in the retry loop.
                mrm.resetToIdle(game.id);
                console.log(`${gameTag} ⚠ Resolved metadata has no images — MRM reset to IDLE for retry`);
            }
        } else {
            missed++;
            console.log(`${gameTag} ✗ No metadata found from any source`);
        }

        // Throttle: 300 ms between games to avoid hammering the server
        await new Promise(r => setTimeout(r, 300));
    }

    console.log(
        `${TAG} ══════ Pipeline END — resolved=${resolved} mrmSkipped=${mrmSkipped} ` +
        `cached=${skipped} missed=${missed} recovered=${recovered} ══════`
    );
}

/** Simple completeness check (mirrors _gdIsMetadataTooIncomplete in game-details.js) */
function _isMetaTooIncomplete(meta) {
    if (!meta) return true;
    const hasDescription = !!(meta.info?.description || meta.description);
    const hasCover       = !!(meta.cover);
    const hasHero        = !!(meta.heroImage || meta.hero);
    const hasScreenshots = (meta.info?.screenshots || []).length > 0;
    const missingVisuals = [hasCover, hasHero, hasScreenshots].filter(Boolean).length < 2;
    return !hasDescription && missingVisuals;
}

/** Image downloader injected from main.js (caches remote URLs to local disk as WebP). */
let _imageDownloadFn = null;
function registerImageDownloader(fn) {
    _imageDownloadFn = fn;
}

/**
 * Optional live-update notifier injected from main.js.
 * When registered, the background pipeline calls this after writing new
 * cover/hero/logo into the DB so the renderer can refresh the card immediately
 * without waiting for a full rescan.
 *
 * Expected signature: (game: object) => void
 * Typical implementation in main.js:
 *   registerGameImageUpdatedNotifier(game => mainWindow.webContents.send('game-image-updated', game));
 */
let _gameImageUpdatedFn = null;
function registerGameImageUpdatedNotifier(fn) {
    _gameImageUpdatedFn = fn;
    console.log('[BackgroundMetaPipeline] game-image-updated notifier registered.');
}

module.exports = {
    scanAllGames:          () => engine.startGlobalScan(),
    addManualGame:         (launchPath, customName, cb, opts) => engine.addManualGame(launchPath, customName, cb, opts),
    getSavedGames:         () => engine.getStoredGames(),
    getMissingInstalledGames: () => engine.getMissingInstalledGames(),
    renameGame:            (id, name) => engine.renameGame(id, name),
    removeGame:            (id) => engine.removeGame(id),
    unhideAllGames:        () => engine.unhideAllGames(),
    getHiddenGames:        () => engine.getHiddenGames(),
    restoreSpecificGames:  (ids) => engine.restoreSpecificGames(ids),
    deleteGamePermanently: (id) => engine.deleteGamePermanently(id),
    updateGameImage:       (id, imgPath, type) => engine.updateGameImage(id, imgPath, type),
    resetGameImage:        (id, type) => engine.resetGameImage(id, type),
    updateGameMetadata:    (id, meta, opts) => engine.updateGameMetadata(id, meta, opts),
    reorderLibrary:        (ids) => engine.reorderLibrary(ids),
    // Migration bridge — used by main.js to thread the repository into games.ipc.js.
    getJsonGameRepository: () => engine.getJsonGameRepository(),
    updatePlaytime:        (id, minutes) => engine.updatePlaytime(id, minutes),
    saveQualifiedSession:  (id, sessionData) => engine.saveQualifiedSession(id, sessionData),
    setTimeTrackingEnabled: (id, enabled) => engine.setTimeTrackingEnabled(id, enabled),
    getTimeTrackingEnabled: (id)          => engine.getTimeTrackingEnabled(id),
    refetchMissingImages:  (cb) => refetchMissingImages(cb),
    getLocalSteamGames:    () => engine.getLocalSteamGames(),
    saveFullMetadata: (gameId, title, platform, meta) => metadataCacheStore.save(gameId, title, platform, meta),
    loadFullMetadata: (gameId)                         => metadataCacheStore.load(gameId),

    // ── Background pipeline ──────────────────────────────────────────────────
    runBackgroundMetadataPipeline,
    registerLocalMetadataResolver,
    registerImageDownloader,
    registerGameImageUpdatedNotifier,

    // ── Epic cleanup ─────────────────────────────────────────────────────────
    removeEpicNonGameEntries: (entries) => engine.removeEpicNonGameEntries(entries),

    // ── Unified resolution manager ───────────────────────────────────────────
    resolutionManager: mrm,
    BaddelEngine,
    __scannerTest: {
        normalizePath,
        pathExists,
        fileExists,
        dirExists,
        dirHasUsefulFiles,
        findFirstExisting,
        findLikelyGameExe,
        isLauncherOrHelperExe,
        makeInstalledGameKey,
        isGameInstallValid,
        withTimeout,
        safeJsonParse,
        normalizeDisplayName,
        normalizeScannerPlatform,
    },
};