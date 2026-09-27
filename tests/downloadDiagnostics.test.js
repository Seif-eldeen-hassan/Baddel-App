'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {
    DownloadDiagnosticRecorder,
    diagnosticsEnabled,
} = require('../src/features/downloads/infrastructure/services/DownloadDiagnosticRecorder');
const {
    DownloadCompletionLibraryRegistrar,
} = require('../src/features/downloads/infrastructure/services/DownloadCompletionLibraryRegistrar');

function tempDir(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeGamesApi() {
    return {
        getAllGames: () => [],
        async upsertGame() {},
    };
}

function loadDownloadsDiagnostics(games) {
    const events = [];
    const source = fs.readFileSync(path.join(__dirname, '..', 'src/js/downloads.js'), 'utf8');
    const exposed = source.replace(/\}\)\(\);\s*$/, `
        window.__downloadDiagnosticHooks = {
            find: dlFindInstalledGameByTask,
            reason: dlCandidateMatchReason,
            displayBytes: getDisplayDownloadedBytes,
            syncPresentation: dlSyncPresentationState,
            advancePresentation: dlAdvancePresentationState,
            formatDiskUsage: dlFormatDiskUsage,
            formatRate: dlFormatRate,
            chartSamples: dlTaskChartSamples,
            taskCard: dlTaskCard,
            percent: dlPresentedPercent,
            cleanStatus: dlCleanStatus,
            presentedEta: dlPresentedEta,
            downloadedText: dlDownloadedText,
        };
    })();`);
    const window = {
        allGamesData: games,
        electronAPI: {
            downloads: {
                diagnosticsEnabled: true,
                recordDiagnostic(payload) {
                    events.push(payload);
                    return Promise.resolve({ status: 'success' });
                },
            },
        },
    };
    const document = { readyState: 'loading', addEventListener() {} };
    vm.runInNewContext(exposed, { window, document, console, setInterval, clearInterval, performance });
    return { hooks: window.__downloadDiagnosticHooks, events };
}

test('diagnostics are disabled with no debug environment flags and create no output', async () => {
    const root = tempDir('baddel-diag-disabled-');
    let consoleWrites = 0;
    const recorder = new DownloadDiagnosticRecorder({
        userDataDir: root,
        env: {},
        consoleRef: { info() { consoleWrites += 1; } },
    });
    assert.equal(diagnosticsEnabled({}), false);
    assert.equal(recorder.record('dl_0123456789abcdef', 'providerEvents', 'TEST', { value: 1 }), false);
    assert.equal(await recorder.flush('dl_0123456789abcdef'), null);
    assert.equal(consoleWrites, 0);
    assert.equal(fs.existsSync(path.join(root, 'download-diagnostics')), false);
});

test('diagnostic reports redact secrets, retain errorCode, and bound provider events', async () => {
    const root = tempDir('baddel-diag-redact-');
    const recorder = new DownloadDiagnosticRecorder({
        userDataDir: root,
        env: { BADDEL_GOG_DOWNLOAD_DEBUG: '1' },
        consoleRef: { info() {} },
    });
    const taskId = 'dl_0123456789abcdef';
    recorder.captureIdentity({ id: taskId, platform: 'gog', title: 'Test' });
    recorder.updateLivenessSummary(taskId, {
        lastRealByteMovementAt: '2026-08-30T15:14:16.633Z',
        providerSilenceDurationMs: 120000,
        byteStallDurationMs: 120000,
        watchdogWarning: true,
        hardStallDecision: true,
    });
    for (let index = 0; index < 410; index += 1) {
        recorder.record(taskId, 'providerEvents', 'GOG_PROVIDER_EVENT', {
            index,
            authorization: 'Bearer hidden-token',
            message: 'access_token=hidden-value cookie=session-secret',
            errorCode: 'GOG_NETWORK_ERROR',
            authoritativeTransfer: true,
            authoritativeOverallProgressGapMs: 1234,
        });
    }
    const reportPath = await recorder.flush(taskId);
    const raw = fs.readFileSync(reportPath, 'utf8');
    const report = JSON.parse(raw);
    assert.equal(report.providerEvents.length, 400);
    assert.equal(report.providerEvents.at(-1).errorCode, 'GOG_NETWORK_ERROR');
    assert.equal(report.providerEvents.at(-1).authorization, '[REDACTED]');
    assert.equal(report.providerEvents.at(-1).authoritativeTransfer, true);
    assert.equal(report.providerEvents.at(-1).authoritativeOverallProgressGapMs, 1234);
    assert.equal(report.livenessSummary.lastRealByteMovementAt, '2026-08-30T15:14:16.633Z');
    assert.equal(report.livenessSummary.hardStallDecision, true);
    assert.doesNotMatch(raw, /hidden-token|hidden-value|session-secret/);
    assert.match(raw, /\[REDACTED\]/);
});

test('renderer clamps stale projected bytes to Sanitarium authoritative progress', () => {
    const { hooks } = loadDownloadsDiagnostics([]);
    const task = { id: 'dl_sanitarium', status: 'downloading', progressSessionId: 'session-1', downloadedBytes: 299872422, totalBytes: 2474465980, writtenBytes: 338807705, downloadSpeedBps: 900000 };
    const state = hooks.syncPresentation(task);
    state.displayedBytes = 338807705;
    hooks.syncPresentation(task);
    assert.equal(hooks.displayBytes(task), 299872422);
    assert.equal(state.displayedBytes, 299872422);
    assert.ok(Math.abs(hooks.percent(task) - 12.11867224781971) < 1e-12);
    assert.notEqual(state.displayedBytes, 338807705);
    const staleState = hooks.syncPresentation({ ...task, networkState: 'stale', etaSeconds: 500 }, { etaSeconds: 500 });
    assert.equal(staleState.displayedEtaSeconds, null);
});

test('multi-EXE custom install folder records setup, utility, and real game without changing selection', async () => {
    const userData = tempDir('baddel-diag-user-');
    const installPath = tempDir('folder-unrelated-to-title-');
    const bin = path.join(installPath, 'bin', 'win64');
    fs.mkdirSync(bin, { recursive: true });
    const setup = path.join(installPath, 'setup.exe');
    const utility = path.join(installPath, 'ConfigTool.exe');
    const realGame = path.join(bin, 'DiagnosticGame.exe');
    fs.writeFileSync(setup, 'setup');
    fs.writeFileSync(utility, 'utility');
    fs.writeFileSync(realGame, 'game-binary');
    const recorder = new DownloadDiagnosticRecorder({
        userDataDir: userData,
        env: { BADDEL_GOG_DOWNLOAD_DEBUG: '1' },
        consoleRef: { info() {} },
    });
    const registrar = new DownloadCompletionLibraryRegistrar({
        gamesApi: makeGamesApi(),
        diagnosticRecorder: recorder,
    });
    const task = {
        id: 'dl_1111111111111111',
        title: 'Diagnostic Game',
        platform: 'gog',
        installPath,
        providerProductId: '123',
    };
    const selected = registrar.resolveExecutablePath(task, { verification: { executablePath: setup } });
    assert.equal(selected, realGame);
    const report = JSON.parse(fs.readFileSync(await recorder.flush(task.id), 'utf8'));
    assert.deepEqual(new Set(report.executableCandidates.map(item => item.fileName)), new Set(['setup.exe', 'ConfigTool.exe', 'DiagnosticGame.exe']));
    assert.equal(report.executableCandidates.find(item => item.fileName === 'setup.exe').isLauncherOrHelperExe, true);
    assert.equal(report.executableCandidates.find(item => item.fileName === 'DiagnosticGame.exe').selected, true);
    assert.equal(report.selectedExecutable.selectedExecutable, realGame);
    assert.ok(report.executableCandidates.find(item => item.fileName === 'DiagnosticGame.exe').scoreReasons.includes('name-hint-similarity'));
});

test('play diagnostics expose current cross-platform provider identity collision without fixing it', () => {
    const games = [
        { id: 'steam-game', name: 'Wrong Steam Game', platform: 'steam', providerProductId: '42', executablePath: 'C:/Steam/Wrong.exe' },
        { id: 'gog-game', name: 'Right GOG Game', platform: 'gog', providerProductId: '42', executablePath: 'D:/GOG/Right.exe' },
    ];
    const { hooks, events } = loadDownloadsDiagnostics(games);
    const task = { id: 'dl_2222222222222222', title: 'Right GOG Game', platform: 'gog', providerProductId: '42' };
    const selected = hooks.find(task, games);
    assert.equal(selected.id, 'steam-game');
    const candidates = events.filter(event => event.eventType === 'DOWNLOAD_PLAY_CANDIDATE');
    assert.equal(candidates.length, 2);
    assert.equal(candidates[0].payload.matchReason, 'providerIdentity');
    assert.equal(candidates[0].payload.selected, true);
    assert.equal(candidates[1].payload.matchReason, 'providerIdentity');
});

test('play diagnostics expose current shared numeric installedGameId collision across platforms', () => {
    const games = [
        { id: '99', name: 'Steam Numeric', platform: 'steam', executablePath: 'C:/Steam/99.exe' },
        { id: '99', name: 'GOG Numeric', platform: 'gog', executablePath: 'D:/GOG/99.exe' },
    ];
    const { hooks, events } = loadDownloadsDiagnostics(games);
    const task = { id: 'dl_3333333333333333', title: 'GOG Numeric', platform: 'gog', installedGameId: '99' };
    const selected = hooks.find(task, games);
    assert.equal(selected.name, 'Steam Numeric');
    const first = events.find(event => event.eventType === 'DOWNLOAD_PLAY_CANDIDATE');
    assert.equal(first.payload.matchReason, 'installedGameId');
    assert.equal(first.payload.selected, true);
});

test('play diagnostic reasons distinguish executable, install path, platform/title, and no match', () => {
    const { hooks } = loadDownloadsDiagnostics([]);
    const baseTask = { id: 'dl_4444444444444444', title: 'Exact Game', platform: 'gog', installPath: 'D:/Games/Exact', resolvedExecutablePath: 'D:/Games/Exact/Game.exe' };
    assert.equal(hooks.reason(baseTask, { executablePath: 'D:/Games/Exact/Game.exe' }), 'executablePath');
    assert.equal(hooks.reason({ ...baseTask, resolvedExecutablePath: null }, { installPath: 'D:/Games/Exact', command: 'play' }), 'installPath');
    assert.equal(hooks.reason({ ...baseTask, installPath: null, resolvedExecutablePath: null }, { name: 'Exact Game', platform: 'gog', command: 'play' }), 'platformAndTitle');
    assert.equal(hooks.reason(baseTask, { name: 'Other', platform: 'steam' }), 'noMatch');
});


test('positive disk telemetry renders a speed instead of Measuring', () => {
    const { hooks } = loadDownloadsDiagnostics([]);
    const text = hooks.formatDiskUsage({ status: 'downloading', telemetryState: 'active', diskUsageBps: 4_200_000, diskWriteSpeedBps: 4_200_000 });
    assert.equal(text, '4.2 MB/s');
    assert.notEqual(text, 'Measuring');
});

test('first zero disk sample renders 0 B/s and active-idle-active remains measurable', () => {
    const { hooks } = loadDownloadsDiagnostics([]);
    assert.equal(hooks.formatDiskUsage({ status: 'downloading', telemetryState: 'measuring' }), 'Measuring');
    assert.equal(hooks.formatDiskUsage({ status: 'downloading', telemetryState: 'idle', diskUsageBps: 0, diskWriteSpeedBps: 0 }), '0 B/s');
    assert.equal(hooks.formatDiskUsage({ status: 'downloading', telemetryState: 'active', diskUsageBps: 2048 }), '2.0 KB/s');
    assert.equal(hooks.formatDiskUsage({ status: 'downloading', telemetryState: 'idle', diskUsageBps: 0 }), '0 B/s');
    assert.equal(hooks.formatDiskUsage({ status: 'downloading', telemetryState: 'active', diskUsageBps: 4096 }), '4.1 KB/s');
});

test('disk card and chart use the same diskUsageBps source', () => {
    const { hooks } = loadDownloadsDiagnostics([]);
    const task = { id: 'dl_disk_source', status: 'downloading', telemetryState: 'active', diskUsageBps: 8192, speedHistory: [{ at: 1, downloadSpeedBps: 0, diskUsageBps: 8192 }] };
    assert.equal(hooks.chartSamples(task).at(-1).diskUsageBps, 8192);
    assert.equal(hooks.formatDiskUsage(task), hooks.formatRate(8192, task));
});

test('large confirmed-byte jump animates to target without exceeding it', () => {
    const { hooks } = loadDownloadsDiagnostics([]);
    let task = { id: 'dl_jump', status: 'downloading', progressSessionId: 's1', downloadedBytes: 100, totalBytes: 1000 };
    const state = hooks.syncPresentation(task);
    task = { ...task, downloadedBytes: 900, rawDownloadSpeedBps: 5_000_000 };
    hooks.syncPresentation(task, task);
    const start = state.animationStartedAt;
    const samples = [200, 500, 800, 1000].map(offset => {
        hooks.advancePresentation(task, state, start + offset);
        return state.displayedBytes;
    });
    assert.ok(samples[0] > 100 && samples[0] < 900);
    assert.equal(samples.at(-1), 900);
    assert.ok(samples.every(value => value <= state.targetBytes && state.targetBytes <= task.downloadedBytes));
});

test('network speed cannot advance presentation when confirmed bytes are unchanged', () => {
    const { hooks } = loadDownloadsDiagnostics([]);
    const task = { id: 'dl_no_projection', status: 'downloading', downloadedBytes: 250, totalBytes: 1000, rawDownloadSpeedBps: 50_000_000 };
    const state = hooks.syncPresentation(task, task);
    const before = state.displayedBytes;
    hooks.advancePresentation(task, state, state.lastTickAt + 5000);
    assert.equal(state.displayedBytes, before);
    assert.equal(state.targetBytes, 250);
});

test('pause and resume preserve monotonic presentation and confirmed completion reaches 100 percent', () => {
    const { hooks } = loadDownloadsDiagnostics([]);
    let task = { id: 'dl_resume', status: 'downloading', progressSessionId: 's1', downloadedBytes: 100, totalBytes: 1000 };
    const state = hooks.syncPresentation(task);
    task = { ...task, downloadedBytes: 600 };
    hooks.syncPresentation(task, task);
    hooks.advancePresentation(task, state, state.animationStartedAt + 500);
    const beforePause = state.displayedBytes;
    hooks.syncPresentation({ ...task, status: 'paused' });
    const resumed = hooks.syncPresentation({ ...task, status: 'resuming', progressSessionId: 's2' });
    assert.ok(resumed.displayedBytes >= beforePause);
    const completedTask = { ...task, status: 'completed', progressSessionId: 's2', downloadedBytes: 1000 };
    const completed = hooks.syncPresentation(completedTask);
    assert.equal(completed.displayedBytes, 1000);
    assert.equal(hooks.percent(completedTask), 100);
});


test('renderer diagnostics record the final disk text and confirmed-byte invariant', () => {
    const { hooks, events } = loadDownloadsDiagnostics([]);
    hooks.taskCard({
        id: 'dl_renderer_diagnostic', platform: 'gog', title: 'Diagnostic Download',
        status: 'downloading', stage: 'downloading', telemetryState: 'idle', networkState: 'idle',
        diskUsageBps: 0, diskWriteSpeedBps: 0, downloadedBytes: 250, totalBytes: 1000, speedHistory: [{ at: 1, downloadSpeedBps: 0, diskUsageBps: 0 }],
    }, true);
    const event = events.find(item => item.eventType === 'RENDERER_PRESENTATION_STATE');
    assert.ok(event);
    assert.equal(event.payload.displayedDiskText, '0 B/s');
    assert.equal(event.payload.confirmedBytes, 250);
    assert.equal(event.payload.presentation.invariantExceeded, false);
    assert.ok(event.payload.presentation.displayedBytes <= event.payload.presentation.targetBytes);
});


test('status text never contains ETA and stale provider ETA renders Calculating', () => {
    const { hooks } = loadDownloadsDiagnostics([]);
    const now = Date.now();
    const active = {
        id: 'dl_eta_ui', status: 'downloading', stage: 'downloading',
        statusMessage: 'Downloading compressed data', etaSeconds: 5,
        etaSource: 'provider', etaUpdatedAt: new Date(now).toISOString(),
    };
    assert.equal(hooks.cleanStatus(active), 'Downloading compressed data');
    assert.doesNotMatch(hooks.cleanStatus(active), /left|eta/i);
    assert.equal(hooks.presentedEta(active), 5);
    assert.equal(hooks.presentedEta({ ...active, etaUpdatedAt: new Date(now - 6000).toISOString() }), null);
});

test('near-complete game files retain precision and show remaining megabytes', () => {
    const { hooks } = loadDownloadsDiagnostics([]);
    const task = { id: 'dl_precise_files', status: 'downloading', downloadedBytes: 3_499_000_000, totalBytes: 3_500_000_000 };
    hooks.syncPresentation(task);
    const text = hooks.downloadedText(task);
    assert.equal(text.includes('3.499 GB / 3.500 GB'), true);
    assert.match(text, /1.0 MB remaining/);
});

test('renderer source has no 99.5 percent cap or speed-based byte projection', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src/js/downloads.js'), 'utf8');
    assert.doesNotMatch(source, /0.995|maximumLeadBytes|projectedBytes/);
});


test('99.5 percent diagnostic proves confirmed-only presentation and stable zero-disk state', () => {
    const { hooks, events } = loadDownloadsDiagnostics([]);
    hooks.taskCard({
        id: 'dl_diagnostic_995', platform: 'gog', title: 'Diagnostic 99.5',
        status: 'downloading', stage: 'downloading',
        statusMessage: 'Downloading compressed data',
        statusTextBeforeDebounce: 'Downloading compressed data',
        statusTextAfterDebounce: 'Downloading compressed data',
        statusChangeReason: 'no-active-sample-preserve',
        downloadedBytes: 995, totalBytes: 1000,
        providerDownloadedBytes: 995, providerTotalBytes: 1000,
        providerReportedPercent: 99.5,
        rawDownloadedBytes: 1200, writtenBytes: 1100,
        telemetryState: 'idle', networkState: 'active',
        diskUsageBps: 0, diskWriteSpeedBps: 0,
        etaSeconds: null, etaSource: null, etaUpdatedAt: null,
    }, true);
    const event = events.find(item => item.eventType === 'RENDERER_PRESENTATION_STATE');
    assert.ok(event);
    const proof = {
        confirmedBytes: event.payload.confirmedBytes,
        targetBytes: event.payload.presentation.targetBytes,
        displayedBytes: event.payload.presentation.displayedBytes,
        providerPercent: event.payload.providerReportedPercent,
        diskText: event.payload.displayedDiskText,
        statusBefore: event.payload.statusTextBeforeDebounce,
        statusAfter: event.payload.statusTextAfterDebounce,
        etaSource: event.payload.etaSource,
        invariantExceeded: event.payload.presentation.invariantExceeded,
    };
    console.log('DOWNLOAD_DIAGNOSTIC_PROOF ' + JSON.stringify(proof));
    assert.deepEqual(proof, {
        confirmedBytes: 995,
        targetBytes: 995,
        displayedBytes: 995,
        providerPercent: 99.5,
        diskText: '0 B/s',
        statusBefore: 'Downloading compressed data',
        statusAfter: 'Downloading compressed data',
        etaSource: null,
        invariantExceeded: false,
    });
});

