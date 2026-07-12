'use strict';

const path = require('path');
const os = require('os');

let electronApp = null;
try { electronApp = require('electron').app; } catch { /* node test environment */ }

const defaultApp = (electronApp && typeof electronApp.getPath === 'function')
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

const defaultBaddelApi = require('../../../../../services/baddelApi');
const { MetadataResolutionManager: DefaultMetadataResolutionManager } = require('../../../../../services/metadataResolutionManager');
const { BaddelEngine: DefaultBaddelEngine } = require('../legacy/BaddelEngine');
const {
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
} = require('../scanner/GameScannerCore');
const { MetadataCacheStore: DefaultMetadataCacheStore } = require('../services/MetadataCacheStore');
const { runBackgroundMetadataPipeline: defaultRunBackgroundMetadataPipeline } = require('../services/BackgroundMetadataPipeline');
const { refetchMissingImages: defaultRefetchMissingImages } = require('../services/RefetchImagesService');

function createGamesFeature(options = {}) {
    const app = options.app || defaultApp;
    const baddelApi = options.baddelApi || defaultBaddelApi;
    const MetadataCacheStore = options.MetadataCacheStore || DefaultMetadataCacheStore;
    const MetadataResolutionManager = options.MetadataResolutionManager || DefaultMetadataResolutionManager;
    const BaddelEngine = options.BaddelEngine || DefaultBaddelEngine;
    const runBackgroundMetadataPipelineService =
        options.runBackgroundMetadataPipeline || defaultRunBackgroundMetadataPipeline;
    const refetchMissingImagesService =
        options.refetchMissingImages || defaultRefetchMissingImages;

    const metadataCacheStore = options.metadataCacheStore || new MetadataCacheStore(app.getPath('userData'));
    const mrm = options.resolutionManager || new MetadataResolutionManager(app.getPath('userData'));
    if (mrm && typeof mrm.setApi === 'function') {
        mrm.setApi(baddelApi);
    }

    const engine = options.engine || new BaddelEngine({
        mrm,
        metadataCacheStore,
        ...(options.engineOptions || {}),
    });

    let localMetadataResolver = options.localMetadataResolver || null;
    let imageDownloadFn = options.imageDownloadFn || null;
    let gameImageUpdatedFn = options.gameImageUpdatedFn || null;

    function registerLocalMetadataResolver(fn) {
        localMetadataResolver = fn;
        console.log('[BackgroundMetaPipeline] Local metadata resolver registered.');
    }

    function registerImageDownloader(fn) {
        imageDownloadFn = fn;
    }

    function registerGameImageUpdatedNotifier(fn) {
        gameImageUpdatedFn = fn;
        console.log('[BackgroundMetaPipeline] game-image-updated notifier registered.');
    }

    async function refetchMissingImages(notifyCallback = null, _deps = {}) {
        return refetchMissingImagesService({
            engine,
            baddelApi,
            notifyCallback,
            imageDownloadFn,
            gameImageUpdatedFn,
            ..._deps,
        });
    }

    async function runBackgroundMetadataPipeline(games, _deps = {}) {
        return runBackgroundMetadataPipelineService(games, {
            engine,
            mrm,
            metadataCacheStore,
            localMetadataResolver,
            imageDownloadFn,
            gameImageUpdatedFn,
            ..._deps,
        });
    }

    return {
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
        getJsonGameRepository: () => engine.getJsonGameRepository(),
        updatePlaytime:        (id, minutes) => engine.updatePlaytime(id, minutes),
        saveQualifiedSession:  (id, sessionData) => engine.saveQualifiedSession(id, sessionData),
        setTimeTrackingEnabled: (id, enabled) => engine.setTimeTrackingEnabled(id, enabled),
        getTimeTrackingEnabled: (id)          => engine.getTimeTrackingEnabled(id),
        refetchMissingImages:  (cb) => refetchMissingImages(cb),
        getLocalSteamGames:    () => engine.getLocalSteamGames(),
        saveFullMetadata: (gameId, title, platform, meta) => metadataCacheStore.save(gameId, title, platform, meta),
        loadFullMetadata: (gameId)                         => metadataCacheStore.load(gameId),

        runBackgroundMetadataPipeline,
        registerLocalMetadataResolver,
        registerImageDownloader,
        registerGameImageUpdatedNotifier,

        removeEpicNonGameEntries: (entries) => engine.removeEpicNonGameEntries(entries),

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
}

module.exports = {
    createGamesFeature,
};
