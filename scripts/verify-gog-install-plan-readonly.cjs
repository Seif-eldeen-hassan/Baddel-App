'use strict';
const fs = require('fs');
const path = require('path');
const { DownloadInstallPlanService, resolveGogManifestSizes } = require('../src/features/downloads/infrastructure/services/DownloadInstallPlanService');
const { DownloadFileSafetyService } = require('../src/features/downloads/infrastructure/services/DownloadFileSafetyService');

const installPath = 'F:\\Baddel Games\\Sanitarium diagnostic-only';
const queueFile = path.join(process.env.APPDATA, 'baddel-launcher-beta', 'downloads', 'downloads-queue.json');
const queueBefore = fs.readFileSync(queueFile, 'utf8');
const existedBefore = fs.existsSync(installPath);
const service = new DownloadInstallPlanService({
    fileSafety: new DownloadFileSafetyService(),
    resolveSizes: payload => resolveGogManifestSizes(payload),
});
service.resolve({ platform: 'gog', installProvider: 'gogdl', gameId: 'gog_1207658811', canonicalGameId: 'gog_1207658811',
    providerProductId: '1207658811', contentSystemProductId: '1207658811', gogdlAppName: '1207658811', accountId: 'sanitized-gog-owner', installPath })
    .then(plan => {
        const evidence = { capturedAt: new Date().toISOString(), product: 'Sanitarium', source: 'public GOG Windows generation-2 manifest',
            downloadSizeBytes: plan.downloadSizeBytes, installedDiskSizeBytes: plan.installedDiskSizeBytes,
            requiredSpaceBytes: plan.requiredSpaceBytes, diskSafetyMarginBytes: plan.diskSafetyMarginBytes,
            totalRequiredBytes: plan.totalRequiredBytes, freeSpaceBytes: plan.freeSpaceBytes, afterInstallBytes: plan.afterInstallBytes,
            enoughSpace: plan.enoughSpace, sizeSource: plan.sizeSource, downloadSizeSource: plan.downloadSizeSource,
            installedSizeSource: plan.installedSizeSource, sizeReason: plan.sizeReason,
            folderExistedBefore: existedBefore, folderExistsAfter: fs.existsSync(installPath), queueUnchanged: fs.readFileSync(queueFile, 'utf8') === queueBefore,
            installCommands: 0, ownershipMarkersCreated: 0 };
        fs.writeFileSync(path.join(__dirname, '..', 'docs', 'gog-install-plan-readonly-evidence.json'), JSON.stringify(evidence, null, 2));
        console.log(JSON.stringify(evidence, null, 2));
    }).catch(error => { console.error(error.code || error.message); process.exitCode = 1; });
