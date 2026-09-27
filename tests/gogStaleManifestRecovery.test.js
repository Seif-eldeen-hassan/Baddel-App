
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { GogDownloadAdapter } = require('../src/features/downloads/infrastructure/providers/gog/GogDownloadAdapter');
const { GogCapabilityDiscovery } = require('../src/features/downloads/infrastructure/providers/gog/GogCapabilityDiscovery');
const {
    GogInstallManifestRecoveryService,
    normalizeInstallPath,
} = require('../src/features/downloads/infrastructure/providers/gog/GogInstallManifestRecoveryService');

const PRODUCT_A = '1207658811';
const PRODUCT_B = '1440133968';
const STALE_OUTPUT = [
    'Creating Manifest instance from existing mani',
    'fest\nNo patch found, falling back to chunk based updates\n',
    'Deleted: 0 New: 0 Changed: 0\nNothing to ',
    'do\n',
];

function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-gog-manifest-'));
}

function writeAuth(userDataDir, accountId = 'gog-a') {
    const accountDir = path.join(userDataDir, 'gog', 'accounts', accountId);
    fs.mkdirSync(accountDir, { recursive: true });
    fs.writeFileSync(path.join(accountDir, 'auth.json'), JSON.stringify({ access_token: 'redacted-test' }));
}

function configPath(userDataDir) {
    return path.join(userDataDir, 'gog', 'gogdl-config');
}

function manifestPath(userDataDir, productId = PRODUCT_A) {
    return path.join(configPath(userDataDir), 'heroic_gogdl', 'manifests', productId);
}

function writeManifest(userDataDir, productId = PRODUCT_A, contents = '{"installed":true}') {
    const file = manifestPath(userDataDir, productId);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
    return file;
}

function taskFor(installPath, overrides = {}) {
    const productId = String(overrides.productId || PRODUCT_A);
    return {
        id: overrides.id || `dl_${Math.random().toString(16).slice(2).padEnd(16, '0').slice(0, 16)}`,
        platform: 'gog',
        accountId: 'gog-a',
        gogdlAppName: productId,
        contentSystemProductId: productId,
        ownershipVerified: true,
        secureLinkVerified: true,
        verifiedBuildId: 'build-1',
        verifiedBuildGeneration: 2,
        language: 'en-US',
        installPath,
        ...overrides,
    };
}

function runtimeFor(plans) {
    const queue = [...plans];
    const calls = [];
    let active = 0;
    let maxActive = 0;
    return {
        calls,
        get maxActive() { return maxActive; },
        verify: async () => ({ version: '1.2.2' }),
        run: async (args) => {
            if (args.includes('--help')) {
                return {
                    stdout: 'usage: gogdl.exe {download,info,repair,update}\n--path PATH\n--platform windows\n--skip-dlcs\n--force-gen 1\n',
                    stderr: '',
                };
            }
            return { stdout: '', stderr: '' };
        },
        spawnCommand: async (args, options = {}) => {
            const plan = queue.shift();
            if (!plan) throw new Error('Unexpected GOGDL spawn');
            calls.push(args);
            active += 1;
            maxActive = Math.max(maxActive, active);
            options.onStarted?.({ pid: 4000 + calls.length });
            try {
                if (plan.waitForAbort) {
                    await new Promise((resolve, reject) => {
                        options.signal?.addEventListener('abort', () => {
                            const err = new Error('cancelled');
                            err.code = 'GOG_RUNTIME_CANCELLED';
                            reject(err);
                        }, { once: true });
                    });
                }
                if (plan.delayMs) await new Promise(resolve => setTimeout(resolve, plan.delayMs));
                for (const chunk of plan.chunks || []) {
                    (plan.stream === 'stderr' ? options.onStderr : options.onStdout)?.(chunk);
                }
                const pathIndex = args.indexOf('--path');
                const installPath = pathIndex >= 0 ? args[pathIndex + 1] : null;
                if (plan.writeExecutable && installPath) {
                    fs.mkdirSync(installPath, { recursive: true });
                    fs.writeFileSync(path.join(installPath, plan.executableName || 'Game.exe'), Buffer.alloc(plan.fileBytes || 100));
                }
                return { code: plan.code ?? 0, stdout: '', stderr: '' };
            } finally {
                active -= 1;
            }
        },
    };
}

function recorder() {
    const events = [];
    return {
        events,
        captureIdentity() {},
        mark() {},
        record(_taskId, _channel, eventType, payload) {
            events.push({ eventType, payload });
        },
        async flush() {},
    };
}

function adapterFor(userDataDir, runtime, options = {}) {
    return new GogDownloadAdapter({
        runtime,
        discovery: new GogCapabilityDiscovery({ runtime }),
        userDataDir,
        ...options,
    });
}

function successfulPlan() {
    return {
        chunks: ['Progress: 100 100/100, Running for: 00:00:02, ETA: 00:00:00\n'],
        writeExecutable: true,
    };
}

function quarantineEntries(userDataDir) {
    const directory = path.join(configPath(userDataDir), 'heroic_gogdl', 'manifests-quarantine');
    return fs.existsSync(directory) ? fs.readdirSync(directory) : [];
}

test('stale product manifest is quarantined and one clean retry completes the new install', async () => {
    const dir = tempDir();
    try {
        writeAuth(dir);
        const source = writeManifest(dir);
        const runtime = runtimeFor([{ chunks: STALE_OUTPUT }, successfulPlan()]);
        const diagnostics = recorder();
        const installPath = path.join(dir, 'Games', 'Fresh Target');
        const receipt = await adapterFor(dir, runtime, { diagnosticRecorder: diagnostics }).start(taskFor(installPath));

        assert.equal(runtime.calls.length, 2);
        assert.equal(receipt.staleManifestRecovered, true);
        assert.equal(receipt.completionMode, 'stale-manifest-recovered');
        assert.equal(receipt.verification.executablePath, path.join(installPath, 'Game.exe'));
        assert.equal(fs.existsSync(source), false);
        const entries = quarantineEntries(dir);
        assert.equal(entries.filter(name => name.startsWith(`${PRODUCT_A}.stale-`) && !name.endsWith('.json')).length, 1);
        assert.equal(entries.filter(name => name.startsWith(`${PRODUCT_A}.stale-`) && name.endsWith('.json')).length, 1);
        const sequence = diagnostics.events.map(item => item.eventType);
        for (const event of [
            'GOG_INSTALL_PREFLIGHT',
            'GOG_STALE_MANIFEST_DETECTED',
            'GOG_STALE_MANIFEST_QUARANTINED',
            'GOG_STALE_MANIFEST_RECOVERY',
            'GOG_DOWNLOAD_COMPLETED',
        ]) assert.ok(sequence.includes(event), `${event} was not recorded`);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('valid installed target with Nothing to do is up-to-date success without quarantine or retry', async () => {
    const dir = tempDir();
    try {
        writeAuth(dir);
        const source = writeManifest(dir);
        const installPath = path.join(dir, 'Games', 'Installed');
        fs.mkdirSync(installPath, { recursive: true });
        fs.writeFileSync(path.join(installPath, 'Installed.exe'), Buffer.alloc(80));
        const runtime = runtimeFor([{ chunks: STALE_OUTPUT }]);

        const receipt = await adapterFor(dir, runtime).start(taskFor(installPath));

        assert.equal(runtime.calls.length, 1);
        assert.equal(receipt.completionMode, 'already-installed-or-up-to-date');
        assert.equal(receipt.bytesTransferred, 0);
        assert.equal(fs.existsSync(source), true);
        assert.deepEqual(quarantineEntries(dir), []);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('quarantining stale game A leaves game B manifest untouched', async () => {
    const dir = tempDir();
    try {
        writeAuth(dir);
        const sourceA = writeManifest(dir, PRODUCT_A, 'A');
        const sourceB = writeManifest(dir, PRODUCT_B, 'B');
        const runtime = runtimeFor([{ chunks: STALE_OUTPUT }, successfulPlan()]);

        await adapterFor(dir, runtime).start(taskFor(path.join(dir, 'Games', 'A')));

        assert.equal(fs.existsSync(sourceA), false);
        assert.equal(fs.readFileSync(sourceB, 'utf8'), 'B');
        assert.equal(quarantineEntries(dir).some(name => name.startsWith(`${PRODUCT_B}.stale-`)), false);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('zero-byte exit without a product manifest preserves normal no-progress classification', async () => {
    const dir = tempDir();
    try {
        writeAuth(dir);
        const runtime = runtimeFor([{ chunks: STALE_OUTPUT }]);
        await assert.rejects(
            () => adapterFor(dir, runtime).start(taskFor(path.join(dir, 'Games', 'No Manifest'))),
            err => err.code === 'GOG_DOWNLOAD_NO_PROGRESS'
        );
        assert.equal(runtime.calls.length, 1);
        assert.deepEqual(quarantineEntries(dir), []);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('failed clean recovery returns typed rich failure and never starts a third attempt', async () => {
    const dir = tempDir();
    try {
        writeAuth(dir);
        writeManifest(dir);
        const runtime = runtimeFor([{ chunks: STALE_OUTPUT }, { chunks: [] }]);
        let failure = null;
        await assert.rejects(
            () => adapterFor(dir, runtime).start(taskFor(path.join(dir, 'Games', 'Still Empty'))),
            err => {
                failure = err;
                return err.code === 'GOG_STALE_INSTALL_MANIFEST';
            }
        );
        assert.equal(runtime.calls.length, 2);
        assert.equal(failure.retryable, true);
        assert.equal(failure.failure.category, 'stale_install_manifest');
        assert.equal(failure.failure.evidence.firstAttempt.bytesTransferred, 0);
        assert.equal(failure.failure.evidence.retryAttempt.attempt, 2);
        assert.equal(JSON.stringify(failure.failure).includes('Creating Manifest'), false);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('partial installation preserves manifest and does not trigger stale recovery', async () => {
    const dir = tempDir();
    try {
        writeAuth(dir);
        const source = writeManifest(dir);
        const installPath = path.join(dir, 'Games', 'Partial');
        fs.mkdirSync(installPath, { recursive: true });
        fs.writeFileSync(path.join(installPath, 'download.part'), Buffer.alloc(32));
        const runtime = runtimeFor([{ chunks: STALE_OUTPUT }]);

        await assert.rejects(
            () => adapterFor(dir, runtime).start(taskFor(installPath, { resumeAttempts: 1, downloadedBytes: 32 })),
            err => err.code === 'GOG_DOWNLOAD_NO_PROGRESS'
        );
        assert.equal(runtime.calls.length, 1);
        assert.equal(fs.existsSync(source), true);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('normal update of an installed game preserves its manifest', async () => {
    const dir = tempDir();
    try {
        writeAuth(dir);
        const source = writeManifest(dir);
        const installPath = path.join(dir, 'Games', 'Update');
        fs.mkdirSync(installPath, { recursive: true });
        fs.writeFileSync(path.join(installPath, 'Update.exe'), Buffer.alloc(80));
        const runtime = runtimeFor([successfulPlan()]);

        const receipt = await adapterFor(dir, runtime).start(taskFor(installPath, { operation: 'update' }));

        assert.equal(receipt.completionMode, 'downloaded');
        assert.equal(runtime.calls.length, 1);
        assert.equal(fs.existsSync(source), true);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('registered old install path cannot make a new empty target complete', async () => {
    const dir = tempDir();
    try {
        writeAuth(dir);
        writeManifest(dir);
        const oldPath = path.join(dir, 'Old');
        const newPath = path.join(dir, 'New');
        const gamesApi = {
            getAllGames: () => [{
                id: `gog_${PRODUCT_A}`,
                platform: 'gog',
                providerProductId: PRODUCT_A,
                installPath: oldPath,
                executablePath: path.join(oldPath, 'Old.exe'),
            }],
        };
        const runtime = runtimeFor([{ chunks: STALE_OUTPUT }, successfulPlan()]);

        const receipt = await adapterFor(dir, runtime, { gamesApi }).start(taskFor(newPath));

        assert.equal(runtime.calls.length, 2);
        assert.equal(receipt.staleManifestRecovered, true);
        assert.equal(receipt.verification.executablePath, path.join(newPath, 'Game.exe'));
        assert.equal(fs.existsSync(oldPath), false);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('Windows install path normalization is case and separator insensitive', () => {
    assert.equal(
        normalizeInstallPath('F:\\Games\\Game'),
        normalizeInstallPath('f:/games/game/')
    );
});

test('cancel during startup never quarantines or retries stale state', async () => {
    const dir = tempDir();
    try {
        writeAuth(dir);
        const source = writeManifest(dir);
        const runtime = runtimeFor([{ waitForAbort: true }]);
        const adapter = adapterFor(dir, runtime);
        const task = taskFor(path.join(dir, 'Games', 'Cancelled'));
        const pending = adapter.start(task);
        await new Promise(resolve => setImmediate(resolve));
        await adapter.cancel(task.id);

        await assert.rejects(pending, err => err.code === 'GOG_DOWNLOAD_CANCELLED');
        assert.equal(runtime.calls.length, 1);
        assert.equal(fs.existsSync(source), true);
        assert.deepEqual(quarantineEntries(dir), []);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('same-product starts are serialized around manifest inspection and execution', async () => {
    const dir = tempDir();
    try {
        writeAuth(dir);
        const runtime = runtimeFor([
            { ...successfulPlan(), delayMs: 25 },
            { ...successfulPlan(), delayMs: 25 },
        ]);
        const adapter = adapterFor(dir, runtime);
        const first = adapter.start(taskFor(path.join(dir, 'Games', 'One'), { id: 'dl_lock_one_0001' }));
        const second = adapter.start(taskFor(path.join(dir, 'Games', 'Two'), { id: 'dl_lock_two_0002' }));

        await Promise.all([first, second]);

        assert.equal(runtime.calls.length, 2);
        assert.equal(runtime.maxActive, 1);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('quarantine metadata is written beside the isolated product manifest', () => {
    const dir = tempDir();
    try {
        const source = writeManifest(dir);
        const service = new GogInstallManifestRecoveryService({ userDataDir: dir });
        const result = service.quarantineGogdlManifest({
            productId: PRODUCT_A,
            configPath: configPath(dir),
            requestedInstallPath: 'F:\\Games\\Fresh',
            reason: 'test-stale-state',
            buildId: 'build-1',
        });
        const metadata = JSON.parse(fs.readFileSync(result.metadataPath, 'utf8'));

        assert.equal(fs.existsSync(source), false);
        assert.equal(metadata.productId, PRODUCT_A);
        assert.equal(metadata.reason, 'test-stale-state');
        assert.equal(metadata.requestedInstallPath, 'F:\\Games\\Fresh');
        assert.equal(metadata.buildId, 'build-1');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
