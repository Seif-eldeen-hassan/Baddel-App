'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { DownloadInstallPlanService } = require('../src/features/downloads/infrastructure/services/DownloadInstallPlanService');

function serviceWith(resolveSizes, now = Date.now) {
    return new DownloadInstallPlanService({
        resolveSizes,
        now,
        fileSafety: {
            inspectInstallPath() {},
            calculateRequiredBytes({ installedDiskSizeBytes }) { return installedDiskSizeBytes; },
            calculateSafetyMargin() { return 100; },
        },
        fsSync: {
            existsSync() { return true; },
            statfsSync() { return { blocks: 100000, bavail: 90000, bsize: 4096 }; },
        },
        pathModule: path.win32,
    });
}

function payload() {
    return {
        platform: 'gog',
        installProvider: 'gogdl',
        accountId: 'safe-owner',
        gameId: 'gog_1986509485',
        providerProductId: '1986509485',
        installPath: 'F:\\Baddel Games\\Outer Worlds',
        language: 'en-US',
    };
}

test('concurrent storage previews share one provider metadata process', async () => {
    let calls = 0;
    const service = serviceWith(async () => {
        calls += 1;
        await new Promise(resolve => setTimeout(resolve, 20));
        return { downloadSizeBytes: 1000, installedDiskSizeBytes: 2000, sizeSource: 'gogdl-info' };
    });

    const [first, second] = await Promise.all([service.resolve(payload()), service.resolve(payload())]);
    assert.equal(calls, 1);
    assert.equal(first.downloadSizeBytes, 1000);
    assert.equal(second.installedDiskSizeBytes, 2000);
});

test('sequential requests reuse the coordinator retained authoritative result', async () => {
    let calls = 0;
    const service = serviceWith(async () => {
        calls += 1;
        return { downloadSizeBytes: 1000, installedDiskSizeBytes: 2000, sizeSource: 'gogdl-info' };
    });
    await service.resolve(payload());
    await service.resolve(payload());
    assert.equal(calls, 1);
});
