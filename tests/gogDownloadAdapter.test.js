'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    GogDownloadAdapter,
    classifyGogError,
    normalizeGogError,
} = require('../src/features/downloads/infrastructure/providers/gog/GogDownloadAdapter');
const { GogProgressParser } = require('../src/features/downloads/infrastructure/providers/gog/GogProgressParser');
const { GogCapabilityDiscovery: Discovery } = require('../src/features/downloads/infrastructure/providers/gog/GogCapabilityDiscovery');

function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-gog-download-'));
}

function writeAccount(userDataDir, accountId = 'gog-a') {
    const dir = path.join(userDataDir, 'gog', 'accounts', accountId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'auth.json'), JSON.stringify({
        '46899977096215655': {
            access_token: 'token',
            refresh_token: 'refresh',
        },
    }), 'utf8');
}

function makeRuntime({ chunks = ['Progress: 100 100/100, Running for: 00:00:02, ETA: 00:00:00\n'], neverSettles = false, writeInstallFiles = true } = {}) {
    const calls = [];
    const envs = [];
    return {
        calls,
        envs,
        verify: async (_opts = {}) => ({ version: '1.2.2' }),
        run: async (args, opts = {}) => {
            calls.push(['run', args]);
            envs.push(opts.env || {});
            if (args.includes('--help')) return { stdout: 'usage: gogdl.exe {auth,download,info,repair,update}\n--path PATH\n--platform {windows,osx,linux}\n--skip-dlcs\n--force-gen {1,2}\n', stderr: '' };
            return { stdout: 'ok', stderr: '' };
        },
        spawnCommand: async (args, options = {}) => {
            calls.push(['spawn', args]);
            envs.push(options.env || {});
            options.onStarted?.({ pid: 123 });
            if (neverSettles) {
                await new Promise((resolve, reject) => {
                    options.signal?.addEventListener('abort', () => {
                        const err = new Error('cancelled');
                        err.code = 'GOG_RUNTIME_CANCELLED';
                        reject(err);
                    }, { once: true });
                });
            }
            for (const chunk of chunks) options.onStdout?.(chunk);
            if (writeInstallFiles) {
                const pathIndex = args.indexOf('--path');
                const installPath = pathIndex >= 0 ? args[pathIndex + 1] : null;
                if (installPath) {
                    fs.mkdirSync(installPath, { recursive: true });
                    fs.writeFileSync(path.join(installPath, 'Game.exe'), Buffer.alloc(100));
                }
            }
            return { code: 0, stdout: '', stderr: '' };
        },
    };
}

function adapterFor(dir, runtime, options = {}) {
    return new GogDownloadAdapter({
        runtime,
        discovery: new Discovery({ runtime }),
        userDataDir: dir,
        ...options,
    });
}

function verifiedTask(overrides = {}) {
    return {
        id: 'dl_0123456789abcdef',
        platform: 'gog',
        accountId: 'gog-a',
        gogdlAppName: '2099051765',
        contentSystemProductId: '2099051765',
        ownershipVerified: true,
        secureLinkVerified: true,
        verifiedBuildId: '58654342451764486',
        verifiedBuildGeneration: 2,
        supportPath: path.join(process.cwd(), '.tmp-download-tests', 'support'),
        language: 'en-US',
        installPath: path.join(process.cwd(), '.tmp-download-tests', 'GOG Game'),
        ...overrides,
    };
}

function isRealInfoCall(entry) {
    const [kind, args] = entry;
    return kind === 'run' && args.includes('info') && !args.includes('--help');
}

function spawnCalls(runtime) {
    return runtime.calls.filter(([kind, args]) => kind === 'spawn' && args.includes('download'));
}

test('GOG adapter runs only verified gogdlAppName and does not call info preflight', async () => {
    const dir = tempDir();
    try {
        writeAccount(dir);
        const runtime = makeRuntime();
        const adapter = adapterFor(dir, runtime);
        const progress = [];
        const result = await adapter.start(verifiedTask({
            installPath: path.join(dir, 'Games', 'Test'),
            supportPath: path.join(dir, 'Support', 'Test'),
        }), { onProgress: event => progress.push(event) });
        assert.equal(result.provider, 'gog');
        assert.equal(result.completionConfirmed, true);
        assert.equal(result.verification.status, 'passed');
        assert.equal(runtime.calls.some(isRealInfoCall), false);
        const downloads = spawnCalls(runtime);
        assert.equal(downloads.length, 1);
        const args = downloads[0][1];
        assert.deepEqual(args.slice(0, 4), [
            '--auth-config-path',
            path.join(dir, 'gog', 'accounts', 'gog-a', 'auth.json'),
            'download',
            '2099051765',
        ]);
        assert.ok(args.includes('--path'));
        assert.ok(args.includes('--support'));
        assert.ok(args.includes('--lang'));
        assert.ok(args.includes('--build'));
        assert.equal(args.includes('56258463881831590'), false);
        assert.ok(progress.some(event => event.statusMessage === 'Starting GOG download...'));
        assert.ok(progress.some(event => event.progressPercent === 100));
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('GOG adapter rejects unverified local or generic ids before gogdl', async () => {
    const dir = tempDir();
    try {
        writeAccount(dir);
        const runtime = makeRuntime();
        const adapter = adapterFor(dir, runtime);
        await assert.rejects(
            () => adapter.start({
                id: 'dl_0123456789abcdef',
                platform: 'gog',
                accountId: 'gog-a',
                providerProductId: '56258463881831590',
                providerAppName: '56258463881831590',
                installPath: path.join(dir, 'Games', 'Test'),
            }),
            err => err.code === 'GOG_OWNED_IDENTITY_UNRESOLVED'
        );
        assert.equal(spawnCalls(runtime).length, 0);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('GOG maintenance invokes actual update and repair subcommands with verified identity', async () => {
    const dir = tempDir();
    try {
        writeAccount(dir);
        for (const operationKind of ['update', 'repair']) {
            const runtime = makeRuntime({ chunks: [], writeInstallFiles: false });
            const installPath = path.join(dir, 'Games', operationKind);
            const providerInstallPath = path.join(installPath, 'Provider Game');
            fs.mkdirSync(providerInstallPath, { recursive: true });
            fs.writeFileSync(path.join(providerInstallPath, 'Game.exe'), Buffer.alloc(100));
            const manifestPath = path.join(dir, 'gog', 'gogdl-config', 'heroic_gogdl', 'manifests');
            fs.mkdirSync(manifestPath, { recursive: true });
            fs.writeFileSync(path.join(manifestPath, '2099051765'), JSON.stringify({ installDirectory: 'Provider Game', buildId: '58654342451764486' }));
            const adapter = adapterFor(dir, runtime);
            const receipt = await adapter.start(verifiedTask({ operationKind, installPath }));
            const spawn = runtime.calls.find(([kind, args]) => kind === 'spawn' && args.includes(operationKind));
            assert.ok(spawn, `${operationKind} must use its gogdl subcommand`);
            assert.equal(spawn[1][2], operationKind);
            assert.equal(spawn[1][spawn[1].indexOf('--path') + 1], providerInstallPath);
            assert.equal(receipt.completionConfirmed, true);
            assert.equal(receipt.buildId, '58654342451764486');
        }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('GOG update check compares persisted installed build with freshly verified Windows build', async () => {
    const dir = tempDir();
    try {
        const adapter = adapterFor(dir, makeRuntime(), {
            identityResolver: { resolveForQueue: async task => ({ ...task, gogProductId: '2099051765', verifiedBuildId: 'new-build', verifiedBuildGeneration: 2 }) },
        });
        const result = await adapter.checkForUpdate(verifiedTask({ verifiedBuildId: 'old-build' }));
        assert.equal(result.installedBuildId, 'old-build');
        assert.equal(result.targetBuildId, 'new-build');
        assert.equal(result.updateAvailable, true);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('GOG adapter uses force-gen 1 only when resolver selected a generation 1 build', async () => {
    const dir = tempDir();
    try {
        writeAccount(dir);
        const runtime = makeRuntime();
        const adapter = adapterFor(dir, runtime);
        await adapter.start(verifiedTask({
            installPath: path.join(dir, 'Games', 'Test'),
            supportPath: path.join(dir, 'Support', 'Test'),
            verifiedBuildGeneration: 1,
        }));
        const args = spawnCalls(runtime)[0][1];
        assert.equal(args[args.indexOf('--force-gen') + 1], '1');
        assert.equal(args.includes('2'), false);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('GOG startup watchdog fails a process that starts but produces no output', async () => {
    const dir = tempDir();
    try {
        writeAccount(dir);
        const runtime = makeRuntime({ neverSettles: true });
        const adapter = adapterFor(dir, runtime);
        const originalSetTimeout = global.setTimeout;
        const originalClearTimeout = global.clearTimeout;
        global.setTimeout = (fn) => originalSetTimeout(fn, 0);
        global.clearTimeout = (id) => originalClearTimeout(id);
        try {
            await assert.rejects(
                () => adapter.start(verifiedTask({ installPath: path.join(dir, 'Games', 'Test') })),
                err => err.code === 'GOG_DOWNLOAD_START_TIMEOUT' &&
                    err.message === 'The GOG download did not start in time. Check the connection or relink the account.'
            );
        } finally {
            global.setTimeout = originalSetTimeout;
            global.clearTimeout = originalClearTimeout;
        }
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('GOG adapter rejects a zero-exit process that never reports transfer progress', async () => {
    const dir = tempDir();
    try {
        writeAccount(dir);
        const runtime = makeRuntime({ chunks: [], writeInstallFiles: false });
        const adapter = adapterFor(dir, runtime);
        const progress = [];
        await assert.rejects(
            () => adapter.start(verifiedTask({ installPath: path.join(dir, 'Games', 'No Progress') }), {
                onProgress: event => progress.push(event),
            }),
            err => err.code === 'GOG_DOWNLOAD_NO_PROGRESS'
        );
        assert.ok(progress.some(event => event.statusMessage === 'GOG download started.'));
        assert.equal(progress.some(event => Number(event.progressPercent) > 0), false);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('GOG adapter rejects info-only output even when the process exits successfully', async () => {
    const dir = tempDir();
    try {
        writeAccount(dir);
        const runtime = makeRuntime({
            chunks: ['[GENERIC_DOWNLOAD_MANAGER] INFO: Depot version: 2 [V2] INFO: Initialized V2 Download Manager\n'],
            writeInstallFiles: false,
        });
        const adapter = adapterFor(dir, runtime);
        await assert.rejects(
            () => adapter.start(verifiedTask({ installPath: path.join(dir, 'Games', 'Info Only') })),
            err => err.code === 'GOG_DOWNLOAD_NO_PROGRESS'
        );
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('GOG pause and cancel abort while the process is starting', async () => {
    for (const action of ['pause', 'cancel']) {
        const dir = tempDir();
        try {
            writeAccount(dir);
            const runtime = makeRuntime({ neverSettles: true });
            const adapter = adapterFor(dir, runtime);
            const startPromise = adapter.start(verifiedTask({ installPath: path.join(dir, 'Games', 'Test') }));
            await new Promise(resolve => setImmediate(resolve));
            await adapter[action]('dl_0123456789abcdef');
            await assert.rejects(startPromise, err => err.code === 'GOG_DOWNLOAD_CANCELLED');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

test('GOG adapter does not report exit confirmation when runtime stop is unconfirmed', async () => {
    const dir = tempDir();
    try {
        const adapter = adapterFor(dir, makeRuntime());
        const controller = new AbortController();
        const stopError = Object.assign(new Error('stop not confirmed'), {
            code: 'GOG_RUNTIME_STOP_NOT_CONFIRMED',
            details: { pid: 321 },
        });
        adapter.active.set('dl_stop_unconfirmed', {
            controller,
            execution: new Promise((_resolve, reject) => setImmediate(() => reject(stopError))),
            processInfo: { pid: 321 },
            stopReason: null,
            lifecycleStopped: new Promise(() => {}),
            taskId: 'dl_stop_unconfirmed',
            task: { id: 'dl_stop_unconfirmed', platform: 'gog' },
            diagnostics: [],
            diagnosticPath: null,
        });
        const result = await adapter.cancel('dl_stop_unconfirmed');
        assert.equal(result.exitConfirmed, false);
        assert.equal(result.timedOut, false);
        assert.equal(result.pid, 321);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('GOG runtime environment provides persistent GOGDL_CONFIG_PATH to discovery and download', async () => {
    const dir = tempDir();
    try {
        writeAccount(dir);
        const runtime = makeRuntime();
        const adapter = adapterFor(dir, runtime);
        await adapter.start(verifiedTask({ installPath: path.join(dir, 'Games', 'Test') }));
        const configPath = path.join(dir, 'gog', 'gogdl-config');
        assert.equal(fs.existsSync(configPath), true);
        assert.ok(runtime.envs.length >= 2);
        assert.equal(runtime.envs.every(env => env.GOGDL_CONFIG_PATH === configPath), true);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('GOG adapter does not double-count unknown resume-session progress', async () => {
    const dir = tempDir();
    try {
        writeAccount(dir);
        const runtime = makeRuntime({
            chunks: [
                'Progress: 0 0/650, Running for: 00:00:01, ETA: 00:10:00\n',
                'Progress: 15 150/650, Running for: 00:00:03, ETA: 00:08:00\n',
            ],
        });
        const adapter = adapterFor(dir, runtime);
        const progress = [];
        await assert.rejects(() => adapter.start(verifiedTask({
            installPath: path.join(dir, 'Games', 'Resume Test'),
            downloadedBytes: 350,
            totalBytes: 1000,
            progressPercent: 35,
        }), { onProgress: event => progress.push(event) }), err => err.code === 'DOWNLOAD_INCOMPLETE_TRANSFER');
        const cumulative = progress.filter(event => Number.isFinite(Number(event.downloadedBytes)));
        assert.ok(cumulative.some(event => event.downloadedBytes === 0 && event.totalBytes === 650));
        assert.ok(cumulative.some(event => event.downloadedBytes === 150 && event.totalBytes === 650));
        assert.equal(cumulative.some(event => event.downloadedBytes === 500), false);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('GOG adapter ignores generic size pairs that are not authoritative progress', async () => {
    const dir = tempDir();
    try {
        writeAccount(dir);
        const runtime = makeRuntime({
            chunks: ['Downloading 58.9% 57 MB / 2.1 GB 195 KB/s ETA 00:30:00\n'],
            writeInstallFiles: false,
        });
        const adapter = adapterFor(dir, runtime);
        const progress = [];
        await assert.rejects(() => adapter.start(verifiedTask({
            installPath: path.join(dir, 'Games', 'Percent Test'),
        }), { onProgress: event => progress.push(event) }), err => err.code === 'GOG_DOWNLOAD_NO_PROGRESS');
        assert.equal(progress.some(item => Number.isFinite(Number(item.downloadedBytes))), false);
        assert.equal(progress.some(item => Number.isFinite(Number(item.totalBytes))), false);
        assert.ok(progress.some(item => Math.round(Number(item.progressPercent)) === 59));
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('GOG adapter keeps Downloaded/Written diagnostics out of final transfer', async () => {
    const dir = tempDir();
    try {
        writeAccount(dir);
        const runtime = makeRuntime({
            chunks: [
                '[PROGRESS INFO]: = Progress: 21.10 69206016/327962160, Running for: 00:00:20, ETA: 00:01:15\n',
                '[PROGRESS INFO]: = Downloaded: 64.00 MiB, Written: 66.00 MiB\n',
                '[PROGRESS INFO]: + Download - 3.30 MiB/s (raw) / 4.10 MiB/s (decompressed)\n',
                '[PROGRESS INFO]: + Disk - 4.20 MiB/s (write) / 0.00 MiB/s (read)\n',
            ],
        });
        const adapter = adapterFor(dir, runtime);
        const progress = [];
        await assert.rejects(() => adapter.start(verifiedTask({
            installPath: path.join(dir, 'Games', 'Heroic Block'),
        }), { onProgress: event => progress.push(event) }), err => err.code === 'DOWNLOAD_INCOMPLETE_TRANSFER');

        const overall = progress.find(event => event.authoritativeTransfer === true);
        const counters = progress.find(event => event.eventType === 'transfer-counters');
        assert.equal(overall.downloadedBytes, 69206016);
        assert.equal(overall.totalBytes, 327962160);
        assert.equal(counters.rawDownloadedBytes, 64 * 1024 * 1024);
        assert.equal(counters.writtenBytes, 66 * 1024 * 1024);
        assert.equal(counters.downloadedBytes, undefined);
        assert.equal(counters.totalBytes, undefined);
        assert.ok(progress.some(event => event.downloadSpeedBps === Math.round(3.30 * 1024 * 1024)));
        assert.ok(progress.some(event => event.diskUsageBps === Math.round(4.20 * 1024 * 1024)));
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('GOG adapter requires authoritative 100 percent before completion', async () => {
    const dir = tempDir();
    try {
        writeAccount(dir);
        const runtime = makeRuntime({
            chunks: [
                '[PROGRESS INFO]: = Progress: 99.00 990/1000, Running for: 00:00:20, ETA: 00:00:01\n',
                '[PROGRESS INFO]: = Downloaded: 1000.00 B, Written: 1000.00 B\n',
            ],
        });
        const adapter = adapterFor(dir, runtime);
        await assert.rejects(() => adapter.start(verifiedTask({
            installPath: path.join(dir, 'Games', 'Almost Done'),
        })), err => err.code === 'DOWNLOAD_INCOMPLETE_TRANSFER');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('GOG diagnostics redact raw secrets and classifier avoids broad fallback matches', () => {
    const manifestErr = new Error("Game doesn't support content system api, unable to proceed using platform windows");
    assert.equal(classifyGogError(new Error('selected platform windows')).kind, 'process');
    assert.equal(classifyGogError(new Error('try --force-gen for debugging')).kind, 'process');
    assert.equal(classifyGogError(manifestErr).kind, 'manifest_resolution');
    assert.equal(classifyGogError(new Error('[GENERIC_DOWNLOAD_MANAGER] INFO: Depot version: 2 [V2] INFO: Initialized V2 Download Manager')).kind, 'startup_no_progress');
    const normalized = normalizeGogError(new Error('token=abc123 refresh_token=def456'));
    assert.equal(normalized.message.includes('abc123'), false);
    assert.equal(normalized.message.includes('def456'), false);
    const infoOnly = normalizeGogError(Object.assign(
        new Error('[GENERIC_DOWNLOAD_MANAGER] INFO: Depot version: 2 [V2] INFO: Initialized V2 Download Manager'),
        { code: 'GOG_RUNTIME_PROCESS_FAILED' }
    ));
    assert.equal(infoOnly.code, 'GOG_DOWNLOAD_NO_PROGRESS');
    assert.equal(infoOnly.message.includes('GENERIC_DOWNLOAD_MANAGER'), false);
});

test('GOG provider diagnostics retain stream and PID while sanitizing messages', () => {
    const dir = tempDir();
    try {
        const recorded = [];
        const adapter = adapterFor(dir, makeRuntime(), {
            diagnosticRecorder: { record(...args) { recorded.push(args); } },
        });
        adapter.recordDiagnosticLines({
            taskId: 'dl_diag_message',
            diagnostics: [],
            processInfo: { pid: 456 },
            stopReason: null,
        }, 'provider says access_token=hidden-value\n', 'stderr');
        const [, section, eventType, payload] = recorded[0];
        assert.equal(section, 'providerEvents');
        assert.equal(eventType, 'GOG_PROVIDER_MESSAGE');
        assert.equal(payload.stream, 'stderr');
        assert.equal(payload.processPid, 456);
        assert.doesNotMatch(payload.message, /hidden-value/);
        assert.match(payload.message, /\[REDACTED\]/);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('GOG download adapter rejects missing auth and non-GOG tasks', async () => {
    const dir = tempDir();
    try {
        const runtime = makeRuntime();
        const adapter = adapterFor(dir, runtime);
        await assert.rejects(
            () => adapter.start(verifiedTask({ accountId: 'missing', installPath: path.join(dir, 'x') })),
            /GOG authentication expired/
        );
        await assert.rejects(
            () => adapter.start({ id: 'dl_0123456789abcdef', platform: 'epic', accountId: 'a', gogdlAppName: '123', contentSystemProductId: '123', ownershipVerified: true, secureLinkVerified: true, installPath: path.join(dir, 'x') }),
            /not handled by the GOG downloader/
        );
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});


test('GOG adapter writes bounded redacted diagnostics on runtime failure', async () => {
    const dir = tempDir();
    try {
        writeAccount(dir);
        const chunks = [];
        for (let index = 0; index < 180; index += 1) {
            chunks.push(`[PROGRESS INFO]: + Download - ${index + 1}.00 KiB/s (raw) / ${index + 2}.00 KiB/s (decompressed) access_token=secret-${index}\n`);
        }
        const runtime = makeRuntime({ chunks, writeInstallFiles: false });
        runtime.spawnCommand = async (args, options = {}) => {
            runtime.calls.push(['spawn', args]);
            options.onStarted?.({ pid: 123 });
            for (const chunk of chunks) options.onStdout?.(chunk);
            const err = new Error('runtime failed password=super-secret');
            err.code = 'GOG_RUNTIME_PROCESS_FAILED';
            throw err;
        };
        const adapter = adapterFor(dir, runtime);
        await assert.rejects(() => adapter.start(verifiedTask({ installPath: path.join(dir, 'Games', 'Diagnostics') })), err => err.code === 'GOG_DOWNLOAD_PROCESS_FAILED');
        const diagnosticPath = path.join(dir, 'download-diagnostics', 'dl_0123456789abcdef-gog.json');
        const diagnostic = JSON.parse(fs.readFileSync(diagnosticPath, 'utf8'));
        assert.equal(diagnostic.version, 1);
        assert.equal(diagnostic.reason, 'failure');
        assert.equal(diagnostic.normalizedErrorCode, 'GOG_DOWNLOAD_PROCESS_FAILED');
        assert.equal(diagnostic.sampleLimit, 150);
        assert.equal(diagnostic.diagnostics.length, 150);
        assert.equal(diagnostic.diagnostics[0].eventType, 'download-speed');
        assert.equal(JSON.stringify(diagnostic).includes('super-secret'), false);
        assert.equal(JSON.stringify(diagnostic).includes('secret-'), false);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});


test('GOG adapter diagnoses provider disk-space stdout instead of exposing startup logs', async () => {
    const dir = tempDir();
    try {
        writeAccount(dir);
        const runtime = makeRuntime({ chunks: [], writeInstallFiles: false });
        runtime.spawnCommand = async (args, options = {}) => {
            runtime.calls.push(['spawn', args]);
            options.onStarted?.({ pid: 123 });
            options.onStderr?.('[GENERIC DOWNLOAD_MANAGER] INFO: Depot version: 2\n[V2] INFO: Initialized V2 Download Manager\n');
            options.onStdout?.("(26.36661433055997, 'GB') 28310936564\n");
            options.onStdout?.("(41.966462682932615, 'GB') 45061146188\n");
            options.onStdout?.('Unable to proceed, Not enough disk space\n');
            const err = new Error('[GENERIC DOWNLOAD_MANAGER] INFO: Depot version: 2\n[V2] INFO: Initialized V2 Download Manager');
            err.code = 'GOG_RUNTIME_PROCESS_FAILED';
            throw err;
        };
        const adapter = adapterFor(dir, runtime);
        await assert.rejects(
            () => adapter.start(verifiedTask({
                installPath: path.join(dir, 'Games', 'Control'),
                freeSpaceBytesAtQueue: 3_976_216_576,
                diskSafetyMarginBytes: 1_073_741_824,
            })),
            err => {
                assert.equal(err.code, 'DOWNLOAD_INSUFFICIENT_DISK_SPACE');
                assert.equal(err.message.includes('GENERIC'), false);
                assert.equal(err.failure.category, 'disk_space');
                assert.equal(err.failure.evidence.expectedInstalledBytes, 45061146188);
                assert.equal(err.failure.evidence.requiredSpaceBytes, 45061146188);
                assert.equal(err.failure.technicalSummary.includes('Not enough disk space'), true);
                return true;
            }
        );
        const diagnosticPath = path.join(dir, 'download-diagnostics', 'dl_0123456789abcdef-gog.json');
        const diagnostic = JSON.parse(fs.readFileSync(diagnosticPath, 'utf8'));
        assert.equal(diagnostic.normalizedErrorCode, 'DOWNLOAD_INSUFFICIENT_DISK_SPACE');
        assert.equal(diagnostic.failure.evidence.classificationRule, 'provider-disk-space-output');
        assert.equal(diagnostic.failure.userMessage.includes('GENERIC'), false);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('GOG disk-space normalizer uses download-wide code', () => {
    const normalized = normalizeGogError(new Error('Unable to proceed, Not enough disk space'));
    assert.equal(normalized.code, 'DOWNLOAD_INSUFFICIENT_DISK_SPACE');
    assert.equal(normalized.message, 'There is not enough free disk space for this download.');
});


test('GOG parser treats non-terminal timeout text as diagnostic progress, not task failure', () => {
    const parser = new GogProgressParser();
    const events = parser.push('temporary connection timeout, retrying download\n');
    assert.equal(events.length, 1);
    assert.equal(events[0].errorCode, null);
});
