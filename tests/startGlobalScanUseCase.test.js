'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { startGlobalScan } = require('../src/features/games/application/useCases/StartGlobalScanUseCase');

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeGame(overrides = {}) {
    return { id: 'g1', name: 'Game', scannerPlatform: 'steam', ...overrides };
}

/**
 * Builds a minimal valid deps object. Individual tests override specific deps
 * to assert on call arguments or control return values.
 */
function makeDeps(overrides = {}) {
    const detectedGames = [makeGame()];
    const detectedKeys  = new Set(['key1']);
    const official      = [makeGame()];
    const storedGames   = [makeGame()];
    const diagnostics   = { scanStartedAt: '2024-01-01T00:00:00.000Z' };

    return {
        runPlatformScans:     async (sp) => { sp.add('steam'); return official; },
        buildDetectionMap:    () => ({ detectedGames, detectedKeys }),
        upsertDetectedGames:  async () => {},
        applyStalePass:       () => 0,
        buildScanDiagnostics: () => diagnostics,
        writeScanDiagnostics: async () => {},
        logScanSummary:       () => {},
        syncToMetadataServer: () => {},
        flushDatabase:        async () => {},
        getStoredGames:       () => storedGames,
        resetReports:         () => {},
        skipMetadataServerSync: false,
        // expose internals for assertions
        _official:      official,
        _detectedGames: detectedGames,
        _storedGames:   storedGames,
        _diagnostics:   diagnostics,
        ...overrides,
    };
}

// ─── call order ───────────────────────────────────────────────────────────────

test('startGlobalScan: resetReports is called before runPlatformScans', async () => {
    const callOrder = [];
    const deps = makeDeps({
        resetReports:     () => callOrder.push('reset'),
        runPlatformScans: async (sp) => { callOrder.push('runPlatformScans'); return []; },
    });
    await startGlobalScan(deps);
    assert.ok(callOrder.indexOf('reset') < callOrder.indexOf('runPlatformScans'),
        'resetReports must be called before runPlatformScans');
});

test('startGlobalScan: runPlatformScans receives a Set', async () => {
    let receivedSp;
    const deps = makeDeps({
        runPlatformScans: async (sp) => { receivedSp = sp; return []; },
    });
    await startGlobalScan(deps);
    assert.ok(receivedSp instanceof Set, 'runPlatformScans must receive a Set');
});

test('startGlobalScan: buildDetectionMap receives official array and scanStartedAt string', async () => {
    const official = [makeGame({ name: 'TestGame' })];
    let capturedOfficial, capturedAt;
    const deps = makeDeps({
        runPlatformScans:  async (sp) => official,
        buildDetectionMap: (off, at) => {
            capturedOfficial = off;
            capturedAt = at;
            return { detectedGames: [], detectedKeys: new Set() };
        },
    });
    await startGlobalScan(deps);
    assert.equal(capturedOfficial, official, 'buildDetectionMap must receive the official array from runPlatformScans');
    assert.equal(typeof capturedAt, 'string', 'scanStartedAt must be a string');
    assert.ok(capturedAt.includes('T'), 'scanStartedAt must be an ISO timestamp');
});

test('startGlobalScan: upsertDetectedGames receives detectedGames from buildDetectionMap', async () => {
    const detectedGames = [makeGame({ name: 'Detected' })];
    let capturedGames;
    const deps = makeDeps({
        buildDetectionMap:   () => ({ detectedGames, detectedKeys: new Set() }),
        upsertDetectedGames: async (games) => { capturedGames = games; },
    });
    await startGlobalScan(deps);
    assert.equal(capturedGames, detectedGames, 'upsertDetectedGames must receive detectedGames');
});

test('startGlobalScan: applyStalePass receives scannedPlatforms, detectedKeys, and scanStartedAt', async () => {
    const detectedKeys = new Set(['k1', 'k2']);
    let capturedSp, capturedDk, capturedAt;
    const deps = makeDeps({
        runPlatformScans:  async (sp) => { sp.add('steam'); return []; },
        buildDetectionMap: () => ({ detectedGames: [], detectedKeys }),
        applyStalePass:    (sp, dk, at) => { capturedSp = sp; capturedDk = dk; capturedAt = at; return 0; },
    });
    await startGlobalScan(deps);
    assert.ok(capturedSp instanceof Set, 'applyStalePass must receive the scannedPlatforms Set');
    assert.ok(capturedSp.has('steam'), 'scannedPlatforms must contain platforms added by runPlatformScans');
    assert.equal(capturedDk, detectedKeys, 'applyStalePass must receive detectedKeys');
    assert.equal(typeof capturedAt, 'string', 'applyStalePass must receive scanStartedAt string');
});

test('startGlobalScan: flushDatabase is called before writeScanDiagnostics', async () => {
    const callOrder = [];
    const deps = makeDeps({
        flushDatabase:        async () => callOrder.push('flush'),
        writeScanDiagnostics: async () => callOrder.push('write'),
    });
    await startGlobalScan(deps);
    assert.ok(callOrder.indexOf('flush') < callOrder.indexOf('write'),
        'flushDatabase must be called before writeScanDiagnostics');
});

test('startGlobalScan: buildScanDiagnostics receives expected fields', async () => {
    const official       = [makeGame()];
    const detectedGames  = [makeGame()];
    const totalStaleRemoved = 3;
    let capturedArgs;
    const deps = makeDeps({
        runPlatformScans:     async (sp) => official,
        buildDetectionMap:    () => ({ detectedGames, detectedKeys: new Set() }),
        applyStalePass:       () => totalStaleRemoved,
        buildScanDiagnostics: (args) => { capturedArgs = args; return {}; },
    });
    await startGlobalScan(deps);
    assert.ok('scanStartedAt'    in capturedArgs, 'buildScanDiagnostics must receive scanStartedAt');
    assert.ok('scanStartedMs'    in capturedArgs, 'buildScanDiagnostics must receive scanStartedMs');
    assert.ok('official'         in capturedArgs, 'buildScanDiagnostics must receive official');
    assert.ok('detectedGames'    in capturedArgs, 'buildScanDiagnostics must receive detectedGames');
    assert.ok('totalStaleRemoved' in capturedArgs, 'buildScanDiagnostics must receive totalStaleRemoved');
    assert.ok('scannedPlatforms' in capturedArgs, 'buildScanDiagnostics must receive scannedPlatforms');
    assert.equal(capturedArgs.official,          official,          'official must be the runPlatformScans result');
    assert.equal(capturedArgs.detectedGames,     detectedGames,     'detectedGames must match');
    assert.equal(capturedArgs.totalStaleRemoved, totalStaleRemoved, 'totalStaleRemoved must match applyStalePass result');
    assert.equal(typeof capturedArgs.scanStartedMs, 'number',       'scanStartedMs must be a number');
});

test('startGlobalScan: writeScanDiagnostics receives the result of buildScanDiagnostics', async () => {
    const diagnosticsResult = { marker: 'test-diag' };
    let capturedReport;
    const deps = makeDeps({
        buildScanDiagnostics: () => diagnosticsResult,
        writeScanDiagnostics: async (r) => { capturedReport = r; },
    });
    await startGlobalScan(deps);
    assert.equal(capturedReport, diagnosticsResult, 'writeScanDiagnostics must receive buildScanDiagnostics result');
});

test('startGlobalScan: logScanSummary is called after writeScanDiagnostics', async () => {
    const callOrder = [];
    const deps = makeDeps({
        writeScanDiagnostics: async () => callOrder.push('write'),
        logScanSummary:       () => callOrder.push('log'),
    });
    await startGlobalScan(deps);
    assert.ok(callOrder.indexOf('write') < callOrder.indexOf('log'),
        'logScanSummary must be called after writeScanDiagnostics');
});

test('startGlobalScan: returns the result of getStoredGames', async () => {
    const storedGames = [makeGame({ name: 'StoredGame' })];
    const deps = makeDeps({ getStoredGames: () => storedGames });
    const result = await startGlobalScan(deps);
    assert.equal(result, storedGames, 'startGlobalScan must return the getStoredGames result');
});

// ─── scannedPlatforms identity ────────────────────────────────────────────────

test('startGlobalScan: same Set instance passed to runPlatformScans and applyStalePass', async () => {
    let spFromRun, spFromApply;
    const deps = makeDeps({
        runPlatformScans: async (sp) => { spFromRun = sp; return []; },
        applyStalePass:   (sp) => { spFromApply = sp; return 0; },
    });
    await startGlobalScan(deps);
    assert.equal(spFromRun, spFromApply, 'same Set must be passed to both runPlatformScans and applyStalePass');
});

test('startGlobalScan: same Set instance passed to runPlatformScans and buildScanDiagnostics', async () => {
    let spFromRun, spFromBuild;
    const deps = makeDeps({
        runPlatformScans:     async (sp) => { spFromRun = sp; return []; },
        buildScanDiagnostics: (args) => { spFromBuild = args.scannedPlatforms; return {}; },
    });
    await startGlobalScan(deps);
    assert.equal(spFromRun, spFromBuild, 'same Set must be passed to runPlatformScans and buildScanDiagnostics');
});

// ─── skipMetadataServerSync ───────────────────────────────────────────────────

test('startGlobalScan: syncToMetadataServer NOT called when skipMetadataServerSync=true', async () => {
    let syncCalled = false;
    const deps = makeDeps({
        syncToMetadataServer:   () => { syncCalled = true; },
        skipMetadataServerSync: true,
    });
    await startGlobalScan(deps);
    assert.equal(syncCalled, false, 'syncToMetadataServer must not be called when skip flag is true');
});

test('startGlobalScan: syncToMetadataServer IS called with detectedGames when skipMetadataServerSync=false', async () => {
    const detectedGames = [makeGame({ name: 'Sync' })];
    let syncArg;
    const deps = makeDeps({
        buildDetectionMap:      () => ({ detectedGames, detectedKeys: new Set() }),
        syncToMetadataServer:   (games) => { syncArg = games; },
        skipMetadataServerSync: false,
    });
    await startGlobalScan(deps);
    assert.equal(syncArg, detectedGames, 'syncToMetadataServer must receive detectedGames');
});

// ─── error propagation ────────────────────────────────────────────────────────

test('startGlobalScan: rejects if runPlatformScans throws', async () => {
    const deps = makeDeps({
        runPlatformScans: async () => { throw new Error('scan failed'); },
    });
    await assert.rejects(() => startGlobalScan(deps), /scan failed/);
});

test('startGlobalScan: rejects if writeScanDiagnostics throws', async () => {
    const deps = makeDeps({
        writeScanDiagnostics: async () => { throw new Error('write failed'); },
    });
    await assert.rejects(() => startGlobalScan(deps), /write failed/);
});

test('startGlobalScan: rejects if upsertDetectedGames throws', async () => {
    const deps = makeDeps({
        upsertDetectedGames: async () => { throw new Error('upsert failed'); },
    });
    await assert.rejects(() => startGlobalScan(deps), /upsert failed/);
});
