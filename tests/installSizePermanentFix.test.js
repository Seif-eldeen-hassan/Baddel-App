'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {
    DownloadInstallPlanService,
    installSizeSelectionKey,
} = require('../src/features/downloads/infrastructure/services/DownloadInstallPlanService');
const { InstallSizeCacheRepository } = require('../src/features/downloads/infrastructure/services/InstallSizeCacheRepository');
const { DownloadQueueManager } = require('../src/features/downloads/infrastructure/services/DownloadQueueManager');
const {
    sanitizeInstallPlanDiagnostic,
} = require('../src/features/downloads/infrastructure/services/InstallPlanDiagnosticRecorder');

const root = path.resolve(__dirname, '..');
const gameDetailsSource = fs.readFileSync(path.join(root, 'src/js/game-details.js'), 'utf8');
const installStorageSource = fs.readFileSync(path.join(root, 'src/js/install-storage.js'), 'utf8');
const compositionSource = fs.readFileSync(path.join(root, 'src/features/downloads/infrastructure/composition/DownloadsContainer.js'), 'utf8');

const epic = {
    platform: 'epic',
    installProvider: 'legendary',
    accountId: 'owner-a',
    gameId: 'epic-local-a',
    canonicalGameId: 'epic-canonical-a',
    providerAppName: 'epic-app',
    providerProductId: 'catalog-a',
};
const exactSizes = {
    downloadSizeBytes: 1000,
    installedDiskSizeBytes: 2000,
    sizeSource: 'legendary-info-manifest',
};

function planService(resolveSizes) {
    return new DownloadInstallPlanService({
        resolveSizes,
        fileSafety: {
            inspectInstallPath() {},
            calculateRequiredBytes(value) {
                return value.installedDiskSizeBytes || value.totalBytes || value.downloadSizeBytes || null;
            },
            calculateSafetyMargin() { return 100; },
        },
        fsSync: {
            existsSync: () => true,
            statfsSync: () => ({ blocks: 10000, bavail: 9000, bsize: 1 }),
        },
        pathModule: path.win32,
    });
}

test('prefetch and foreground install use one canonical selection key', () => {
    const prefetched = installSizeSelectionKey(epic);
    const foreground = installSizeSelectionKey({
        ...epic,
        gameId: 'hydrated-local-id',
        canonicalGameId: 'richer-canonical-id',
        providerProductId: 'richer-catalog-metadata',
        installPath: 'F:\\Baddel Games\\Game',
    });
    assert.equal(foreground, prefetched);
    assert.notEqual(installSizeSelectionKey({ ...epic, accountId: 'owner-b' }), prefetched);
});

test('foreground install reuses a completed prefetch without a second provider call', async () => {
    let calls = 0;
    const service = planService(async () => {
        calls += 1;
        return exactSizes;
    });
    assert.equal((await service.prefetchSize(epic)).prefetchStatus, 'ready');
    const plan = await service.resolve({ ...epic, installPath: 'F:\\Baddel Games\\Game' });
    assert.equal(calls, 1);
    assert.equal(plan.sizeStatus, 'resolved');
    assert.equal(plan.downloadSizeBytes, 1000);
});

test('default authoritative cache remains valid beyond fifteen minutes and survives recreation', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-size-24h-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    let now = 1_000;
    const first = new InstallSizeCacheRepository({ userDataDir: dir, now: () => now });
    await first.set('epic:key', exactSizes);
    now += 16 * 60 * 1000;
    const restarted = new InstallSizeCacheRepository({ userDataDir: dir, now: () => now });
    assert.equal(restarted.get('epic:key').downloadSizeBytes, 1000);
    now += 24 * 60 * 60 * 1000;
    assert.equal(restarted.get('epic:key'), null);
});

test('one bounded retry recovers a transient provider failure without retrying auth failures', async () => {
    let calls = 0;
    const recovered = new DownloadInstallPlanService({
        ...planService(async () => exactSizes),
        resolveSizes: async () => (++calls === 1 ? { sizeReason: 'EPIC_INFO_UNAVAILABLE' } : exactSizes),
        fileSafety: planService(async () => exactSizes).fileSafety,
        fsSync: { existsSync: () => true, statfsSync: () => ({ blocks: 10000, bavail: 9000, bsize: 1 }) },
        pathModule: path.win32,
        retryDelayMs: 0,
    });
    const plan = await recovered.resolve({ ...epic, installPath: 'F:\\Baddel Games\\Retry' });
    assert.equal(calls, 2);
    assert.equal(plan.sizeStatus, 'resolved');

    calls = 0;
    const auth = planService(async () => {
        calls += 1;
        return { sizeReason: 'EPIC_AUTH_REQUIRED' };
    });
    const blocked = await auth.resolve({ ...epic, installPath: 'F:\\Baddel Games\\Auth' });
    assert.equal(calls, 1);
    assert.equal(blocked.sizeReason, 'EPIC_AUTH_REQUIRED');
});

test('account-selection deadline settles instead of leaving Storage resolving forever', async () => {
    const service = new DownloadInstallPlanService({
        resolveSizes: async () => exactSizes,
        prepareSizePayload: async () => new Promise(() => {}),
        identityTimeoutMs: 10,
        fileSafety: { inspectInstallPath() {} },
        pathModule: path.win32,
    });
    await assert.rejects(
        service.resolve({ ...epic, installPath: 'F:\\Baddel Games\\Timeout' }),
        error => error.code === 'EPIC_ACCOUNT_RESOLUTION_TIMEOUT'
    );
});

test('unknown size creates an explicit queueable plan without claiming sufficient space', async () => {
    const service = planService(async () => ({ sizeReason: 'EPIC_INFO_TIMEOUT' }));
    const payload = { ...epic, installPath: 'F:\\Baddel Games\\Unknown' };
    const plan = await service.resolve(payload);
    assert.equal(plan.sizeStatus, 'unknown');
    assert.equal(plan.enoughSpace, null);
    assert.equal(plan.sizeReason, 'EPIC_INFO_TIMEOUT');
    assert.ok(plan.sizeCheckedAt);
    const applied = service.applyPlan({ ...payload, installPlanId: plan.planId });
    assert.equal(applied.sizeStatus, 'unknown');
    assert.equal(applied.sizeReason, 'EPIC_INFO_TIMEOUT');
});

test('runtime authoritative size updates unknown task and performs a fresh disk check', () => {
    let free = 10_000;
    const manager = new DownloadQueueManager({
        repository: {},
        preflight: {
            fileSafety: {
                calculateRequiredBytes: ({ installedDiskSizeBytes, totalBytes }) => installedDiskSizeBytes || totalBytes,
                calculateSafetyMargin: () => 100,
                getFreeSpaceBytes: () => free,
            },
        },
    });
    const task = { id: 'task', installPath: 'F:\\Game', sizeStatus: 'unknown' };
    const accepted = manager.evaluateRuntimeSize(task, {
        authoritativeTransfer: true,
        totalBytes: 2_000,
        progressSource: 'provider-bytes',
    });
    assert.equal(accepted.error, undefined);
    assert.equal(accepted.patch.sizeStatus, 'runtime_resolved');
    assert.equal(accepted.patch.downloadSizeBytes, 2_000);
    assert.equal(accepted.patch.freeSpaceBytesAtQueue, 10_000);

    free = 2_050;
    const rejected = manager.evaluateRuntimeSize(task, {
        authoritativeTransfer: true,
        totalBytes: 2_000,
    });
    assert.equal(rejected.error.code, 'DOWNLOAD_INSUFFICIENT_DISK_SPACE');
    assert.equal(rejected.error.details.missingSpaceBytes, 50);
});

test('unknown-size confirmation queues exactly once and keeps Cancel non-destructive', async () => {
    const start = gameDetailsSource.indexOf('async function _gdQueueDirectDownload');
    const end = gameDetailsSource.indexOf('function _gdPickTrailerFallbackThumbnail', start);
    assert.ok(start >= 0 && end > start);
    let confirmed = false;
    let queued = 0;
    let confirmation = null;
    const sandbox = {
        window: {
            electronAPI: { downloads: {
                queueInstall: async () => { queued += 1; return { status: 'success' }; },
            } },
            baddelInstallStorage: {
                confirmed: async () => ({
                    installPath: 'F:\\Game',
                    installPlanId: 'plan',
                    sizeStatus: 'unknown',
                    sizeReason: 'EPIC_INFO_TIMEOUT',
                    unknownSizeConfirmed: confirmed,
                }),
                confirmUnknown: () => { confirmed = true; },
            },
            gdInstallClose: () => {},
        },
        _gdInstallModalRevision: 1,
        _gdInstallAccountRevision: 1,
        _gdDirectInstallPayload: () => ({}),
        openConfirmModal: (title, message, buttonText, callback) => {
            confirmation = { title, message, buttonText, callback };
        },
        showToast: () => {},
        navigateToDownloads: () => {},
    };
    vm.createContext(sandbox);
    vm.runInContext(gameDetailsSource.slice(start, end), sandbox);
    await sandbox._gdQueueDirectDownload('epic', {}, 'owner-a', 'legendary');
    assert.equal(queued, 0);
    assert.equal(confirmation.buttonText, 'Install anyway');
    assert.match(confirmation.message, /exact download and installed size could not be determined/);
    await confirmation.callback();
    assert.equal(queued, 1);
});

test('Game Details starts Epic and GOG prefetch before optional GOG hydration', () => {
    const initial = gameDetailsSource.indexOf('if (initialDirectPlatforms.length === 1)');
    const prefetch = gameDetailsSource.indexOf('void _gdPrefetchDefaultInstallSize(game)', initial);
    const hydrate = gameDetailsSource.indexOf('_gdHydrateGogRichRecordForDetails', initial);
    assert.ok(initial >= 0 && prefetch > initial && hydrate > prefetch);
    assert.match(gameDetailsSource, /requested-main-account-resolution/);
    assert.match(gameDetailsSource, /requested-owned-identity/);
    assert.match(compositionSource, /prepareSizePayload/);
    assert.match(compositionSource, /epicAccountResolver\.resolveOptions/);
});

test('prefetch path remains observational and authentication failures stay blocking', () => {
    assert.doesNotMatch(gameDetailsSource.slice(
        gameDetailsSource.indexOf('function _gdRequestInstallSizePrefetch'),
        gameDetailsSource.indexOf('function _gdInstallClearAccount')
    ), /queueInstall|selectInstallDirectory|mkdir|writeFile/);
    assert.match(installStorageSource, /BLOCKING_SIZE_REASONS/);
    for (const code of ['EPIC_AUTH_REQUIRED', 'EPIC_GAME_NOT_OWNED', 'GOG_AUTH_REQUIRED', 'GOG_GAME_NOT_OWNED']) {
        assert.match(installStorageSource, new RegExp(code));
    }
});

test('install-plan diagnostics hash account identity and sanitize filesystem paths', () => {
    const value = sanitizeInstallPlanDiagnostic({
        accountId: '123456789',
        installPath: 'F:\\Private\\Games\\Title',
        selectionKey: JSON.stringify(['epic', 'legendary', '123456789', 'app']),
    });
    assert.match(value.accountId, /^sha256:/);
    assert.notEqual(value.accountId, '123456789');
    assert.equal(value.installPath, 'F:\\[redacted]');
    assert.doesNotMatch(value.selectionKey, /123456789/);
});
