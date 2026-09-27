'use strict';

const { configureEpicTrace } = require('../services/EpicDownloadTrace');
const { DownloadInstallPlanService } = require('../services/DownloadInstallPlanService');
const { InstallPlanDiagnosticRecorder } = require('../services/InstallPlanDiagnosticRecorder');
const { EpicLegendarySizeResolver } = require('../providers/epic/EpicLegendarySizeResolver');
const { JsonDownloadRepository } = require('../repositories/JsonDownloadRepository');
const { JsonDownloadHistoryRepository } = require('../repositories/JsonDownloadHistoryRepository');
const { DownloadPreflightService } = require('../services/DownloadPreflightService');
const { DownloadFileSafetyService } = require('../services/DownloadFileSafetyService');
const { DownloadQueueManager } = require('../services/DownloadQueueManager');
const { DownloadCompletionLibraryRegistrar } = require('../services/DownloadCompletionLibraryRegistrar');
const { DownloadDiagnosticRecorder } = require('../services/DownloadDiagnosticRecorder');
const { DownloadManagedGameUninstallService } = require('../services/DownloadManagedGameUninstallService');
const { DownloadProviderExecutor } = require('../services/DownloadProviderExecutor');
const { DownloadMaintenanceScheduler } = require('../services/DownloadMaintenanceScheduler');
const { GogCapabilityDiscovery } = require('../providers/gog/GogCapabilityDiscovery');
const { GogDownloadAdapter } = require('../providers/gog/GogDownloadAdapter');
const { GogOwnedProductIdentityResolver } = require('../providers/gog/GogOwnedProductIdentityResolver');
const { GogRuntimeSizeResolver } = require('../providers/gog/GogRuntimeSizeResolver');
const { InstallSizeCacheRepository } = require('../services/InstallSizeCacheRepository');
const { EpicLegendaryAccountResolver } = require('../providers/epic/EpicLegendaryAccountResolver');
const { EpicLegendaryRuntimeService } = require('../providers/epic/EpicLegendaryRuntimeService');
const { EpicLegendaryDownloadAdapter } = require('../providers/epic/EpicLegendaryDownloadAdapter');
const { QueueGameDownloadUseCase } = require('../../application/useCases/QueueGameDownloadUseCase');
const { PauseDownloadUseCase } = require('../../application/useCases/PauseDownloadUseCase');
const { ResumeDownloadUseCase } = require('../../application/useCases/ResumeDownloadUseCase');
const { CancelDownloadUseCase } = require('../../application/useCases/CancelDownloadUseCase');
const { RetryDownloadUseCase } = require('../../application/useCases/RetryDownloadUseCase');
const { RemoveDownloadUseCase } = require('../../application/useCases/RemoveDownloadUseCase');
const { UninstallDownloadUseCase } = require('../../application/useCases/UninstallDownloadUseCase');
const { ReorderDownloadsUseCase } = require('../../application/useCases/ReorderDownloadsUseCase');
const { GetDownloadsSnapshotUseCase } = require('../../application/useCases/GetDownloadsSnapshotUseCase');
const { CheckGameUpdateUseCase } = require('../../application/useCases/CheckGameUpdateUseCase');
const { QueueGameMaintenanceUseCase } = require('../../application/useCases/QueueGameMaintenanceUseCase');
function createDownloadsContainer({ app, userDataDir, autoStart = true, GogRuntimeClass = null, loadGogRuntimeVersionInfo = null, gogFetch = null, gamesApi = null, notifyLibraryUpdated = null, isGameRunning = null, epicConnector = null, spawnFn = null, getDrives = null } = {}) {
    const resolvedUserData = userDataDir || app?.getPath?.('userData');
    if (!resolvedUserData) throw new Error('DownloadsContainer requires app or userDataDir');
    if (typeof loadGogRuntimeVersionInfo !== 'function') throw new Error('DownloadsContainer requires loadGogRuntimeVersionInfo');
    if (typeof gogFetch !== 'function') throw new Error('DownloadsContainer requires gogFetch');

    configureEpicTrace({ userDataDir: resolvedUserData });
    const gogRuntimeMetadata = loadGogRuntimeVersionInfo({
        projectRoot: app?.getAppPath?.() || process.cwd(),
        resourcesPath: process.resourcesPath,
        isPackaged: Boolean(app?.isPackaged),
    });
    if (!GogRuntimeClass) throw new Error('DownloadsContainer requires GogRuntimeClass');
    const gogRuntime = new GogRuntimeClass({
        projectRoot: app?.getAppPath?.() || process.cwd(),
        resourcesPath: process.resourcesPath,
        isPackaged: Boolean(app?.isPackaged),
        versionInfo: gogRuntimeMetadata.versionInfo,
    });
    const gogDiscovery = new GogCapabilityDiscovery({ runtime: gogRuntime });
    const diagnosticRecorder = new DownloadDiagnosticRecorder({ userDataDir: resolvedUserData });
    const installPlanDiagnostics = new InstallPlanDiagnosticRecorder({ userDataDir: resolvedUserData });
    const gogIdentityResolver = new GogOwnedProductIdentityResolver({
        userDataDir: resolvedUserData,
        runtime: gogRuntime,
        fetchImpl: gogFetch,
        debug: (label, payload) => console.debug(label, payload),
    });
    const gogDownloadAdapter = new GogDownloadAdapter({
        runtime: gogRuntime,
        discovery: gogDiscovery,
        userDataDir: resolvedUserData,
        diagnosticRecorder,
        gamesApi,
        identityResolver: gogIdentityResolver,
    });
    const epicAccountResolver = new EpicLegendaryAccountResolver({ userDataDir: resolvedUserData, epicConnector });
    const epicLegendaryRuntime = new EpicLegendaryRuntimeService({
        projectRoot: app?.getAppPath?.() || process.cwd(),
        resourcesPath: process.resourcesPath,
        isPackaged: Boolean(app?.isPackaged),
        ...(spawnFn ? { spawnFn } : {}),
    });
    const epicLegendaryDownloadAdapter = new EpicLegendaryDownloadAdapter({ runtimeService: epicLegendaryRuntime, accountResolver: epicAccountResolver });
    gogDiscovery.discover({ env: gogDownloadAdapter.getRuntimeEnv().env }).catch(() => {});
    const providerExecutor = new DownloadProviderExecutor({ providers: [gogDownloadAdapter, epicLegendaryDownloadAdapter] });
    const repository = new JsonDownloadRepository({ userDataDir: resolvedUserData });
    const historyRepository = new JsonDownloadHistoryRepository({ userDataDir: resolvedUserData });
    const preflight = new DownloadPreflightService({
        fileSafety: new DownloadFileSafetyService({
            protectedRoots: [
                process.env.SystemRoot || 'C:\\Windows',
                process.env.ProgramFiles || 'C:\\Program Files',
                process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
                process.cwd(),
                resolvedUserData,
            ].filter(Boolean),
        }),
    });
    const installSizeCache = new InstallSizeCacheRepository({ userDataDir: resolvedUserData });
    const epicSizeResolver = new EpicLegendarySizeResolver({ runtimeService: epicLegendaryRuntime, accountResolver: epicAccountResolver, diagnostics: installPlanDiagnostics, cacheRepository: installSizeCache });
    const gogSizeResolver = new GogRuntimeSizeResolver({ runtime: gogRuntime, userDataDir: resolvedUserData, diagnostics: installPlanDiagnostics, cacheRepository: installSizeCache });
    const prepareSizePayload = async (payload = {}, { correlationId = null } = {}) => {
        installPlanDiagnostics.record(correlationId, 'INSTALL_SIZE_ACCOUNT_SELECTION_STARTED', { platform: payload.platform || null, accountId: payload.accountId || null });
        if (payload.platform === 'epic' && payload.installProvider === 'legendary') {
            let accountId = String(payload.accountId || '').trim();
            if (!accountId) {
                const options = await epicAccountResolver.resolveOptions(payload);
                accountId = String(options.find(option => option.actionStatus === 'ready' && option.enabled === true)?.id || '');
                if (!accountId) {
                    const error = new Error('No authenticated owning Epic account is available for this game.');
                    error.code = 'EPIC_ACCOUNT_NOT_READY';
                    throw error;
                }
            }
            const prepared = await epicAccountResolver.resolveForQueue({ ...payload, accountId });
            installPlanDiagnostics.record(correlationId, 'INSTALL_SIZE_ACCOUNT_SELECTION_COMPLETED', { platform: 'epic', accountId: prepared.accountId, ownershipVerified: true });
            return prepared;
        }
        if (payload.platform === 'gog' && payload.installProvider === 'gogdl' && !payload.accountId) {
            const accountId = (Array.isArray(payload.ownedByAccountIds) ? payload.ownedByAccountIds : []).map(String).find(Boolean);
            if (!accountId) {
                const error = new Error('Choose a linked owning GOG account.');
                error.code = 'GOG_ACCOUNT_NOT_FOUND';
                throw error;
            }
            installPlanDiagnostics.record(correlationId, 'INSTALL_SIZE_ACCOUNT_SELECTION_COMPLETED', { platform: 'gog', accountId, ownershipVerified: true });
            return { ...payload, accountId };
        }
        installPlanDiagnostics.record(correlationId, 'INSTALL_SIZE_ACCOUNT_SELECTION_COMPLETED', { platform: payload.platform || null, accountId: payload.accountId || null, ownershipVerified: Boolean(payload.ownershipVerified || payload.accountId) });
        return payload;
    };
    const installPlanService = new DownloadInstallPlanService({
        fileSafety: preflight.fileSafety, diagnostics: installPlanDiagnostics, prepareSizePayload, ...(getDrives ? { getDrives } : {}),
        resolveSizes: payload => payload.platform === 'epic' && payload.installProvider === 'legendary'
            ? epicSizeResolver.resolve(payload)
            : payload.platform === 'gog' && payload.installProvider === 'gogdl'
                ? gogSizeResolver.resolve(payload) : { sizeReason: 'SIZE_PROVIDER_UNSUPPORTED' },
    });
    const completionRegistrar = gamesApi ? new DownloadCompletionLibraryRegistrar({
        gamesApi,
        notifyLibraryUpdated,
        diagnosticRecorder,
    }) : null;
    const managedUninstallService = gamesApi?.removeGame ? new DownloadManagedGameUninstallService({
        fileSafety: preflight.fileSafety,
        gamesApi,
        isGameRunning,
        notifyLibraryUpdated,
    }) : null;
    const queueManager = new DownloadQueueManager({
        repository,
        historyRepository,
        preflight,
        providerExecutor,
        completionRegistrar,
        managedUninstallService,
        diagnosticRecorder,
        autoStart,
        identityResolvers: { gog: gogIdentityResolver, epic: epicAccountResolver },
    });
    const maintenanceScheduler = new DownloadMaintenanceScheduler({ queueManager, diagnosticRecorder });

    return {
        repository,
        historyRepository,
        preflight,
        installPlanService,
        providerExecutor,
        gogRuntime,
        gogDiscovery,
        gogIdentityResolver,
        gogSizeResolver,
        gogDownloadAdapter,
        epicAccountResolver,
        epicLegendaryRuntime,
        epicSizeResolver,
        epicLegendaryDownloadAdapter,
        diagnosticRecorder,
        completionRegistrar,
        managedUninstallService,
        queueManager,
        maintenanceScheduler,
        useCases: {
            getSnapshot: new GetDownloadsSnapshotUseCase({ queueManager }),
            queueInstall: new QueueGameDownloadUseCase({ queueManager }),
            checkUpdate: new CheckGameUpdateUseCase({ queueManager }),
            queueMaintenance: new QueueGameMaintenanceUseCase({ queueManager }),
            pause: new PauseDownloadUseCase({ queueManager }),
            resume: new ResumeDownloadUseCase({ queueManager }),
            cancel: new CancelDownloadUseCase({ queueManager }),
            retry: new RetryDownloadUseCase({ queueManager }),
            remove: new RemoveDownloadUseCase({ queueManager }),
            uninstall: new UninstallDownloadUseCase({ queueManager }),
            reorder: new ReorderDownloadsUseCase({ queueManager }),
        },
    };
}

module.exports = {
    createDownloadsContainer,
};
