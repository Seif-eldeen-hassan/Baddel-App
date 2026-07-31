'use strict';

const { JsonDownloadRepository } = require('../repositories/JsonDownloadRepository');
const { DownloadPreflightService } = require('../services/DownloadPreflightService');
const { DownloadFileSafetyService } = require('../services/DownloadFileSafetyService');
const { DownloadQueueManager } = require('../services/DownloadQueueManager');
const { DownloadCompletionLibraryRegistrar } = require('../services/DownloadCompletionLibraryRegistrar');
const { DownloadProviderExecutor } = require('../services/DownloadProviderExecutor');
const { GogCapabilityDiscovery } = require('../providers/gog/GogCapabilityDiscovery');
const { GogDownloadAdapter } = require('../providers/gog/GogDownloadAdapter');
const { GogOwnedProductIdentityResolver } = require('../providers/gog/GogOwnedProductIdentityResolver');
const { QueueGameDownloadUseCase } = require('../../application/useCases/QueueGameDownloadUseCase');
const { PauseDownloadUseCase } = require('../../application/useCases/PauseDownloadUseCase');
const { ResumeDownloadUseCase } = require('../../application/useCases/ResumeDownloadUseCase');
const { CancelDownloadUseCase } = require('../../application/useCases/CancelDownloadUseCase');
const { RetryDownloadUseCase } = require('../../application/useCases/RetryDownloadUseCase');
const { RemoveDownloadUseCase } = require('../../application/useCases/RemoveDownloadUseCase');
const { ReorderDownloadsUseCase } = require('../../application/useCases/ReorderDownloadsUseCase');
const { GetDownloadsSnapshotUseCase } = require('../../application/useCases/GetDownloadsSnapshotUseCase');

function createDownloadsContainer({ app, userDataDir, autoStart = true, GogRuntimeClass = null, gamesApi = null, notifyLibraryUpdated = null } = {}) {
    const resolvedUserData = userDataDir || app?.getPath?.('userData');
    if (!resolvedUserData) throw new Error('DownloadsContainer requires app or userDataDir');

    let gogVersionInfo = null;
    try { gogVersionInfo = require('../../../../../gog-runtime/version.json'); } catch {}
    if (!GogRuntimeClass) throw new Error('DownloadsContainer requires GogRuntimeClass');
    const gogRuntime = new GogRuntimeClass({
        projectRoot: process.cwd(),
        resourcesPath: process.resourcesPath,
        isPackaged: Boolean(app?.isPackaged),
        versionInfo: gogVersionInfo,
    });
    const gogDiscovery = new GogCapabilityDiscovery({ runtime: gogRuntime });
    const gogIdentityResolver = new GogOwnedProductIdentityResolver({
        userDataDir: resolvedUserData,
        runtime: gogRuntime,
        debug: (label, payload) => console.debug(label, payload),
    });
    const gogDownloadAdapter = new GogDownloadAdapter({
        runtime: gogRuntime,
        discovery: gogDiscovery,
        userDataDir: resolvedUserData,
    });
    gogDiscovery.discover({ env: gogDownloadAdapter.getRuntimeEnv().env }).catch(() => {});
    const providerExecutor = new DownloadProviderExecutor({
        providers: [gogDownloadAdapter],
    });
    const repository = new JsonDownloadRepository({ userDataDir: resolvedUserData });
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
    const completionRegistrar = gamesApi ? new DownloadCompletionLibraryRegistrar({
        gamesApi,
        notifyLibraryUpdated,
    }) : null;
    const queueManager = new DownloadQueueManager({
        repository,
        preflight,
        providerExecutor,
        completionRegistrar,
        autoStart,
        identityResolvers: { gog: gogIdentityResolver },
    });

    return {
        repository,
        preflight,
        providerExecutor,
        gogRuntime,
        gogDiscovery,
        gogIdentityResolver,
        gogDownloadAdapter,
        completionRegistrar,
        queueManager,
        useCases: {
            getSnapshot: new GetDownloadsSnapshotUseCase({ queueManager }),
            queueInstall: new QueueGameDownloadUseCase({ queueManager }),
            pause: new PauseDownloadUseCase({ queueManager }),
            resume: new ResumeDownloadUseCase({ queueManager }),
            cancel: new CancelDownloadUseCase({ queueManager }),
            retry: new RetryDownloadUseCase({ queueManager }),
            remove: new RemoveDownloadUseCase({ queueManager }),
            reorder: new ReorderDownloadsUseCase({ queueManager }),
        },
    };
}

module.exports = {
    createDownloadsContainer,
};
