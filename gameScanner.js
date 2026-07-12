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
const { BaddelEngine } = require('./src/features/games/infrastructure/legacy/BaddelEngine');

// ─── Utility functions imported from GameScannerCore ─────────────────────────
const {
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
const { MetadataCacheStore } = require('./src/features/games/infrastructure/services/MetadataCacheStore');
const { runBackgroundMetadataPipeline: _runBgPipelineService } = require('./src/features/games/infrastructure/services/BackgroundMetadataPipeline');
const { refetchMissingImages: _refetchMissingImagesService } = require('./src/features/games/infrastructure/services/RefetchImagesService');


// ============================================================
// SINGLETON + EXPORTS
// ============================================================
const metadataCacheStore = new MetadataCacheStore(app.getPath('userData'));

// Single coordinator for all non-Steam/Epic metadata resolution.
// Replaces the old _resolveThrottleMap + scattered cooldown checks.
const mrm = new MetadataResolutionManager(app.getPath('userData'));
mrm.setApi(baddelApi);

const engine = new BaddelEngine({
    mrm,
    metadataCacheStore,
});
async function refetchMissingImages(notifyCallback = null, _deps = {}) {
    return _refetchMissingImagesService({
        engine,
        baddelApi,
        notifyCallback,
        ..._deps,
    });
}

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
 * Public façade — injects the module-level singletons so production callers
 * that pass only the games array continue to work unchanged.  Test callers
 * spread their fakes into _deps, which overrides the singletons.
 */
async function runBackgroundMetadataPipeline(games, _deps = {}) {
    return _runBgPipelineService(games, {
        engine,
        mrm,
        metadataCacheStore,
        imageDownloadFn:    _imageDownloadFn,
        gameImageUpdatedFn: _gameImageUpdatedFn,
        ..._deps,
    });
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
