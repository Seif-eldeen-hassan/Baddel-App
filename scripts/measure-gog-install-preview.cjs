'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { GogRuntime } = require('../src/features/sync/infrastructure/integrations/gog/GogRuntime');
const { GogRuntimeSizeResolver } = require('../src/features/downloads/infrastructure/providers/gog/GogRuntimeSizeResolver');
const { DownloadInstallPlanService } = require('../src/features/downloads/infrastructure/services/DownloadInstallPlanService');
const { DownloadFileSafetyService } = require('../src/features/downloads/infrastructure/services/DownloadFileSafetyService');

const accountId = String(process.argv[2] || '');
const productId = String(process.argv[3] || '');
if (!/^\d+$/.test(accountId) || !/^\d+$/.test(productId)) {
    throw new Error('Pass numeric account and GOG product ids.');
}

const root = path.join(__dirname, '..');
const userDataDir = path.join(process.env.APPDATA, 'baddel-launcher-beta');
const installPath = 'E:\\Baddel Games\\GOG storage preview diagnostic';
const queuePath = path.join(userDataDir, 'downloads', 'downloads-queue.json');
const queueBefore = fs.existsSync(queuePath) ? fs.readFileSync(queuePath, 'utf8') : null;
const existedBefore = fs.existsSync(installPath);
const runtime = new GogRuntime({ projectRoot: root, isPackaged: false });
const resolver = new GogRuntimeSizeResolver({ runtime, userDataDir });
const service = new DownloadInstallPlanService({
    fileSafety: new DownloadFileSafetyService(),
    resolveSizes: payload => resolver.resolve(payload),
});
const payload = {
    platform: 'gog',
    installProvider: 'gogdl',
    accountId,
    gameId: `gog_${productId}`,
    providerProductId: productId,
    installPath,
    language: 'en-US',
};

async function measured() {
    const startedAt = Date.now();
    const plan = await service.resolve(payload);
    return { durationMs: Date.now() - startedAt, plan };
}

(async () => {
    const cold = await measured();
    const warm = await measured();
    const evidence = {
        capturedAt: new Date().toISOString(),
        accountHash: crypto.createHash('sha256').update(accountId).digest('hex').slice(0, 12),
        productId,
        coldDurationMs: cold.durationMs,
        warmDurationMs: warm.durationMs,
        downloadSizeBytes: cold.plan.downloadSizeBytes,
        installedDiskSizeBytes: cold.plan.installedDiskSizeBytes,
        freeSpaceBytes: cold.plan.freeSpaceBytes,
        totalRequiredBytes: cold.plan.totalRequiredBytes,
        enoughSpace: cold.plan.enoughSpace,
        sizeSource: cold.plan.sizeSource,
        sizeReason: cold.plan.sizeReason,
        folderCreated: !existedBefore && fs.existsSync(installPath),
        queueChanged: queueBefore !== (fs.existsSync(queuePath) ? fs.readFileSync(queuePath, 'utf8') : null),
    };
    fs.writeFileSync(path.join(root, 'docs', 'gog-install-preview-timing.json'), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence));
})().catch(error => {
    console.error(JSON.stringify({ code: error?.code || 'ERROR', message: String(error?.message || error).slice(0, 160) }));
    process.exitCode = 1;
});
