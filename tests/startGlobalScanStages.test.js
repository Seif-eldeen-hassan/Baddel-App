const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Must be set before requiring gameScanner so the module-level singleton uses a temp dir.
if (!process.env.BADDEL_TEST_USER_DATA) {
    process.env.BADDEL_TEST_USER_DATA = fs.mkdtempSync(
        path.join(os.tmpdir(), 'baddel-stages-singleton-')
    );
}

const { BaddelEngine } = require('../gameScanner');
// Require the same cached module object so mutations to importGames are visible
// to gameScanner.js's module-level baddelApi reference.
const baddelApi = require('../services/baddelApi');

// ─── Shared helpers ───────────────────────────────────────────────────────────

function makeTempDir(prefix = 'baddel-stages-') {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeEngine(options = {}) {
    const dbFolder = makeTempDir();
    return new BaddelEngine({
        dbFolder,
        programData: path.join(dbFolder, 'ProgramData'),
        skipMetadataServerSync: true,
        ...options,
    });
}

function touch(filePath, content = 'x') {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
    return filePath;
}

function seedGames(engine, games) {
    const arr = engine.getAllGames();
    arr.splice(0, arr.length, ...games);
}

// Replace all 6 platform delegates on the engine with stubs.
// overrides: { getSteamGames: async () => [...] } etc.
function stubAllPlatforms(engine, overrides = {}) {
    const defaults = {
        getSteamGames:   async () => [],
        getEpicGames:    async () => [],
        getRiotGames:    async () => [],
        getUbisoftGames: async () => [],
        getEAGames:      async () => [],
        getXboxGames:    async () => [],
    };
    Object.assign(engine, defaults, overrides);
}

// ─── _runPlatformScans ────────────────────────────────────────────────────────

test('_runPlatformScans: successful platform adds games to official and marks platform scanned', async () => {
    const engine = makeEngine();
    const scannedPlatforms = new Set();
    const steamGame = {
        id: 'steam-220',
        name: 'Half-Life 2',
        scannerPlatform: 'steam',
        allIds: { steam: '220' },
        launcherGameId: '220',
        command: 'steam://run/220',
    };
    stubAllPlatforms(engine, { getSteamGames: async () => [steamGame] });

    const official = await engine._runPlatformScans(scannedPlatforms);

    assert.ok(official.some(g => g.id === 'steam-220'), 'official must include the steam game');
    assert.ok(scannedPlatforms.has('steam'), 'steam must be added to scannedPlatforms');
    const report = engine._currentScanReports.steam;
    assert.ok(report, 'steam report must exist after successful scan');
    assert.equal(typeof report.durationMs, 'number', 'durationMs must be numeric');
});

test('_runPlatformScans: failed platform is excluded from scannedPlatforms and error is recorded', async () => {
    const engine = makeEngine();
    const scannedPlatforms = new Set();
    stubAllPlatforms(engine, {
        getRiotGames: async () => { throw new Error('riot scan failed'); },
    });

    const official = await engine._runPlatformScans(scannedPlatforms);

    assert.ok(!scannedPlatforms.has('riot'), 'failed platform must not be added to scannedPlatforms');
    const report = engine._currentScanReports.riot;
    assert.ok(report, 'riot report must exist even on failure');
    assert.ok(report.errors.some(e => e.includes('riot scan failed')), 'error must be recorded in riot report');
    assert.ok(!official.some(g => g.scannerPlatform === 'riot'), 'riot games must not appear in official after failure');
});

test('_runPlatformScans: other platforms succeed even when one platform fails', async () => {
    const engine = makeEngine();
    const scannedPlatforms = new Set();
    stubAllPlatforms(engine, {
        getEpicGames: async () => { throw new Error('epic down'); },
    });

    await engine._runPlatformScans(scannedPlatforms);

    assert.ok(scannedPlatforms.has('steam'),   'steam must still be marked scanned');
    assert.ok(scannedPlatforms.has('riot'),    'riot must still be marked scanned');
    assert.ok(!scannedPlatforms.has('epic'),   'epic must NOT be marked scanned after failure');
});

// ─── _buildDetectionMap ───────────────────────────────────────────────────────

test('_buildDetectionMap: valid steam game is detected and keyed', () => {
    const engine = makeEngine();
    const scanStartedAt = new Date().toISOString();
    const official = [{
        id: 'steam-440',
        name: 'Team Fortress 2',
        scannerPlatform: 'steam',
        allIds: { steam: '440' },
        launcherGameId: '440',
        command: 'steam://run/440',
    }];

    const { detectedGames, detectedKeys } = engine._buildDetectionMap(official, scanStartedAt);

    assert.equal(detectedGames.length, 1, 'one game must be detected');
    assert.ok(detectedKeys.has('steam:440'), 'detectedKeys must contain steam:440');
});

test('_buildDetectionMap: riot game without executablePath fails validation and is skipped', () => {
    const engine = makeEngine();
    const scanStartedAt = new Date().toISOString();
    // Riot requires executablePath; omitting it → isGameInstallValid returns valid:false, reason:exe_missing
    const official = [{
        id: 'riot-val',
        name: 'VALORANT',
        scannerPlatform: 'riot',
        riotProduct: 'valorant',
        // no executablePath
    }];

    const { detectedGames } = engine._buildDetectionMap(official, scanStartedAt);

    assert.equal(detectedGames.length, 0, 'game failing validation must be skipped');
    const report = engine._currentScanReports.riot;
    assert.ok(report, 'riot report must exist after skip');
    assert.ok(report.skipped >= 1, 'skipped counter must be incremented');
});

test('_buildDetectionMap: game with no stable key is skipped with missing_stable_key', () => {
    const engine = makeEngine();
    const scanStartedAt = new Date().toISOString();
    // Steam game with empty name, no allIds, no launcherGameId, no path, no command.
    // makeInstalledGameKey: no numeric steam id, no path, no command, empty name → returns null.
    const official = [{
        scannerPlatform: 'steam',
        name: '',
    }];

    const { detectedGames } = engine._buildDetectionMap(official, scanStartedAt);

    assert.equal(detectedGames.length, 0, 'game without stable key must be skipped');
    const report = engine._currentScanReports.steam;
    assert.ok(report, 'steam report must exist after skip');
    assert.ok(report.skipped >= 1, 'skipped counter must be incremented for missing_stable_key');
});

test('_buildDetectionMap: dedup prefers candidate with executablePath', () => {
    const engine = makeEngine();
    const scanStartedAt = new Date().toISOString();
    const exePath = touch(path.join(engine.dbFolder, 'hl2', 'hl2.exe'));
    // Both candidates share the same installedGameKey (steam:220).
    const official = [
        {
            id: 'steam-220-a',
            name: 'Half-Life 2',
            scannerPlatform: 'steam',
            allIds: { steam: '220' },
            launcherGameId: '220',
            command: 'steam://run/220',
            executablePath: exePath,
        },
        {
            id: 'steam-220-b',
            name: 'Half-Life 2',
            scannerPlatform: 'steam',
            allIds: { steam: '220' },
            launcherGameId: '220',
            command: 'steam://run/220',
            // no executablePath
        },
    ];

    const { detectedGames, detectedKeys } = engine._buildDetectionMap(official, scanStartedAt);

    assert.equal(detectedGames.length, 1, 'dedup must collapse both candidates into one game');
    assert.ok(detectedKeys.has('steam:220'), 'detectedKeys must contain steam:220');
    assert.equal(detectedGames[0].executablePath, exePath, 'candidate with executablePath must win dedup');
});

// ─── _upsertDetectedGames ─────────────────────────────────────────────────────

test('_upsertDetectedGames: calls upsertGame for every detected game', async () => {
    const engine = makeEngine();
    const captured = [];
    engine.upsertGame = async (g) => { captured.push(g); };

    const detectedGames = [
        { id: 'steam-1', name: 'Game A', scannerPlatform: 'steam' },
        { id: 'steam-2', name: 'Game B', scannerPlatform: 'steam' },
    ];

    await engine._upsertDetectedGames(detectedGames);

    assert.equal(captured.length, 2, 'upsertGame must be called once per detected game');
    assert.ok(captured.some(g => g.id === 'steam-1'), 'Game A must be upserted');
    assert.ok(captured.some(g => g.id === 'steam-2'), 'Game B must be upserted');
});

test('_upsertDetectedGames: per-game upsert error does not halt remaining games', async () => {
    const engine = makeEngine();
    const processed = [];
    let callCount = 0;
    engine.upsertGame = async (g) => {
        callCount++;
        if (callCount === 1) throw new Error('upsert failure');
        processed.push(g);
    };

    const detectedGames = [
        { id: 'steam-1', name: 'Failing Game', scannerPlatform: 'steam' },
        { id: 'steam-2', name: 'Succeeding Game', scannerPlatform: 'steam' },
    ];

    await assert.doesNotReject(
        () => engine._upsertDetectedGames(detectedGames),
        'per-game error must not propagate out of _upsertDetectedGames'
    );
    assert.equal(processed.length, 1, 'second game must still be processed after first fails');
    assert.equal(processed[0].id, 'steam-2');
    const report = engine._currentScanReports.steam;
    assert.ok(report?.errors?.length >= 1, 'error must be recorded for the failing game');
});

// ─── _applyStalePass ──────────────────────────────────────────────────────────

test('_applyStalePass: visible scanner game not in detectedKeys becomes missing', () => {
    const engine = makeEngine();
    seedGames(engine, [{
        id: 'riot-valorant',
        name: 'VALORANT',
        scannerPlatform: 'riot',
        installSource: 'scanner',
        installedGameKey: 'riot:valorant',
        isInstalled: true,
        isHidden: false,
    }]);
    const scannedPlatforms = new Set(['riot']);
    const detectedKeys = new Set(); // not detected this scan
    const scanStartedAt = new Date().toISOString();

    const totalStaleRemoved = engine._applyStalePass(scannedPlatforms, detectedKeys, scanStartedAt);

    const game = engine.getAllGames()[0];
    assert.equal(game.isInstalled, false, 'isInstalled must be false');
    assert.equal(game.installVerified, false, 'installVerified must be false');
    assert.ok(typeof game.removedFromDiskAt === 'string' && game.removedFromDiskAt.length > 0,
        'removedFromDiskAt must be set');
    assert.equal(game.lastMissingScanAt, scanStartedAt, 'lastMissingScanAt must equal scanStartedAt');
    assert.ok(typeof game.missingReason === 'string' && game.missingReason.length > 0,
        'missingReason must be set');
    assert.ok(Array.isArray(game.validationWarnings), 'validationWarnings must be an array');
    assert.ok(game.validationWarnings.includes(game.missingReason),
        'validationWarnings must include missingReason');
    assert.equal(totalStaleRemoved, 1, 'totalStaleRemoved must be 1');
    assert.equal(engine._currentScanReports?.riot?.staleRemoved, 1,
        'platform staleRemoved counter must be 1');
});

test('_applyStalePass: already-missing game updates lastMissingScanAt but staleRemoved stays 0', () => {
    const engine = makeEngine();
    const priorDate = '2020-01-01T00:00:00.000Z';
    seedGames(engine, [{
        id: 'riot-valorant',
        name: 'VALORANT',
        scannerPlatform: 'riot',
        installSource: 'scanner',
        installedGameKey: 'riot:valorant',
        isInstalled: false, // already missing from a prior scan
        removedFromDiskAt: priorDate,
        lastMissingScanAt: priorDate,
    }]);
    const scannedPlatforms = new Set(['riot']);
    const detectedKeys = new Set();
    const scanStartedAt = new Date().toISOString();

    const totalStaleRemoved = engine._applyStalePass(scannedPlatforms, detectedKeys, scanStartedAt);

    const game = engine.getAllGames()[0];
    assert.equal(totalStaleRemoved, 0, 'already-missing game must not increment staleRemoved');
    assert.equal(game.removedFromDiskAt, priorDate, 'removedFromDiskAt must not change');
    assert.equal(game.lastMissingScanAt, scanStartedAt, 'lastMissingScanAt must update to current scan');
});

test('_applyStalePass: manual game is not touched', () => {
    const engine = makeEngine();
    seedGames(engine, [{
        id: 'manual-mygame',
        name: 'My Game',
        scannerPlatform: 'manual',
        installSource: 'manual',
        isInstalled: true,
    }]);
    const scannedPlatforms = new Set(['manual']);
    const detectedKeys = new Set();
    const scanStartedAt = new Date().toISOString();

    const totalStaleRemoved = engine._applyStalePass(scannedPlatforms, detectedKeys, scanStartedAt);

    const game = engine.getAllGames()[0];
    assert.equal(totalStaleRemoved, 0, 'manual game must not contribute to staleRemoved');
    assert.equal(game.isInstalled, true, 'manual game isInstalled must remain unchanged');
    assert.equal(game.lastMissingScanAt, undefined, 'lastMissingScanAt must not be set on manual game');
});

test('_applyStalePass: game from unscanned platform is not touched', () => {
    const engine = makeEngine();
    seedGames(engine, [{
        id: 'steam-100',
        name: 'Steam Game',
        scannerPlatform: 'steam',
        installSource: 'scanner',
        installedGameKey: 'steam:100',
        isInstalled: true,
    }]);
    const scannedPlatforms = new Set(['epic']); // steam was NOT scanned
    const detectedKeys = new Set();
    const scanStartedAt = new Date().toISOString();

    const totalStaleRemoved = engine._applyStalePass(scannedPlatforms, detectedKeys, scanStartedAt);

    const game = engine.getAllGames()[0];
    assert.equal(totalStaleRemoved, 0, 'unscanned platform game must not contribute to staleRemoved');
    assert.equal(game.isInstalled, true, 'unscanned platform game must remain installed');
});

test('_applyStalePass: detected game is not marked stale', () => {
    const engine = makeEngine();
    seedGames(engine, [{
        id: 'steam-200',
        name: 'Still Here',
        scannerPlatform: 'steam',
        installSource: 'scanner',
        installedGameKey: 'steam:200',
        isInstalled: true,
    }]);
    const scannedPlatforms = new Set(['steam']);
    const detectedKeys = new Set(['steam:200']); // game IS in the detected set
    const scanStartedAt = new Date().toISOString();

    const totalStaleRemoved = engine._applyStalePass(scannedPlatforms, detectedKeys, scanStartedAt);

    const game = engine.getAllGames()[0];
    assert.equal(totalStaleRemoved, 0, 'detected game must not contribute to staleRemoved');
    assert.equal(game.isInstalled, true, 'detected game must remain installed');
});

// ─── _buildScanDiagnostics ────────────────────────────────────────────────────

test('_buildScanDiagnostics: output has correct shape and field values', () => {
    const engine = makeEngine();
    // Seed a visible game so getStoredGames().length is predictable.
    seedGames(engine, [{ id: 'g1', name: 'Test', isInstalled: true, isHidden: false }]);

    const scanStartedAt = '2024-01-01T00:00:00.000Z';
    const scanStartedMs = Date.now() - 50;
    const official = [{ id: 'a' }, { id: 'b' }];
    const detectedGames = [{ id: 'a' }];
    const totalStaleRemoved = 3;
    const scannedPlatforms = new Set(['steam', 'epic']);

    const report = engine._buildScanDiagnostics({
        scanStartedAt, scanStartedMs, official, detectedGames, totalStaleRemoved, scannedPlatforms,
    });

    assert.equal(report.scanStartedAt, scanStartedAt, 'scanStartedAt must match input');
    assert.ok(typeof report.scanFinishedAt === 'string', 'scanFinishedAt must be a string');
    assert.ok(report.scanFinishedAt >= scanStartedAt, 'scanFinishedAt must be at or after scanStartedAt');
    assert.ok(typeof report.durationMs === 'number' && report.durationMs >= 0,
        'durationMs must be a non-negative number');
    assert.equal(report.rawDetected, 2, 'rawDetected must equal official.length');
    assert.equal(report.uniqueDetected, 1, 'uniqueDetected must equal detectedGames.length');
    assert.equal(report.staleRemoved, 3, 'staleRemoved must equal totalStaleRemoved');
    assert.deepEqual(
        [...report.scannedPlatforms].sort(),
        ['epic', 'steam'],
        'scannedPlatforms must be serialized to a plain array'
    );
    assert.equal(report.platforms, engine._currentScanReports,
        'platforms must reference engine._currentScanReports');
    assert.equal(report.visibleGamesAfterScan, engine.getStoredGames().length,
        'visibleGamesAfterScan must equal getStoredGames().length at call time');
});

// ─── _logScanSummary ──────────────────────────────────────────────────────────

test('_logScanSummary: logs platform, raw, valid, skipped, staleRemoved, durationMs', () => {
    const engine = makeEngine();
    engine._currentScanReports = {
        steam: {
            platform: 'steam', raw: 12, valid: 9, skipped: 3,
            staleRemoved: 2, durationMs: 750, errors: [],
            kept: 9, skippedStale: 0, skippedMissingPath: 1, skippedMissingExe: 2,
        },
    };

    const logged = [];
    const originalLog = console.log;
    console.log = (...args) => logged.push(args.join(' '));
    try {
        engine._logScanSummary();
    } finally {
        console.log = originalLog;
    }

    const line = logged.join('\n');
    assert.ok(line.includes('steam'),          'log must include platform name');
    assert.ok(line.includes('raw=12'),          'log must include raw count');
    assert.ok(line.includes('valid=9'),         'log must include valid count');
    assert.ok(line.includes('skipped=3'),       'log must include skipped count');
    assert.ok(line.includes('staleRemoved=2'),  'log must include staleRemoved');
    assert.ok(line.includes('durationMs=750'),  'log must include durationMs');
});

test('_logScanSummary: emits one log line per platform', () => {
    const engine = makeEngine();
    engine._currentScanReports = {
        steam: { platform: 'steam', raw: 1, valid: 1, skipped: 0, staleRemoved: 0, durationMs: 10, errors: [] },
        epic:  { platform: 'epic',  raw: 2, valid: 2, skipped: 0, staleRemoved: 0, durationMs: 20, errors: [] },
    };

    const logged = [];
    const originalLog = console.log;
    console.log = (...args) => logged.push(args.join(' '));
    try {
        engine._logScanSummary();
    } finally {
        console.log = originalLog;
    }

    const platforms = logged.filter(l => l.includes('platform='));
    assert.equal(platforms.length, 2, 'must log one line per platform in _currentScanReports');
    assert.ok(platforms.some(l => l.includes('steam')), 'must log steam');
    assert.ok(platforms.some(l => l.includes('epic')),  'must log epic');
});

// ─── _syncDetectedGamesToMetadataServer ──────────────────────────────────────

test('_syncDetectedGamesToMetadataServer: steam game with numeric allIds.steam is synced', () => {
    const engine = makeEngine();
    const calls = [];
    const orig = baddelApi.importGames;
    baddelApi.importGames = async (platform, games) => { calls.push({ platform, games }); };
    try {
        engine._syncDetectedGamesToMetadataServer([
            { scannerPlatform: 'steam', allIds: { steam: '220' }, name: 'Half-Life 2' },
        ]);
        assert.ok(
            calls.some(c => c.platform === 'steam' && c.games.some(g => g.id === '220')),
            'steam game with numeric id must be passed to importGames'
        );
    } finally {
        baddelApi.importGames = orig;
    }
});

test('_syncDetectedGamesToMetadataServer: steam game with non-numeric id is filtered out', () => {
    const engine = makeEngine();
    const calls = [];
    const orig = baddelApi.importGames;
    baddelApi.importGames = async (platform, games) => { calls.push({ platform, games }); };
    try {
        engine._syncDetectedGamesToMetadataServer([
            { scannerPlatform: 'steam', id: 'steam-not-a-number', name: 'Bad Game' },
        ]);
        const steamCalls = calls.filter(c => c.platform === 'steam');
        assert.equal(steamCalls.length, 0, 'non-numeric steam id must not trigger importGames');
    } finally {
        baddelApi.importGames = orig;
    }
});

test('_syncDetectedGamesToMetadataServer: epic game with valid namespace is synced', () => {
    const engine = makeEngine();
    const calls = [];
    const orig = baddelApi.importGames;
    baddelApi.importGames = async (platform, games) => { calls.push({ platform, games }); };
    try {
        // Namespace must be >= 10 chars and match /^[a-f0-9\-]+$/i
        engine._syncDetectedGamesToMetadataServer([
            {
                scannerPlatform: 'epic',
                namespace: 'aaaaaaaaaa', // 10 hex chars — passes validation
                name: 'Epic Game',
            },
        ]);
        assert.ok(
            calls.some(c => c.platform === 'epic'),
            'epic game with valid namespace must be passed to importGames'
        );
    } finally {
        baddelApi.importGames = orig;
    }
});

test('_syncDetectedGamesToMetadataServer: epic game with invalid namespace is filtered out', () => {
    const engine = makeEngine();
    const calls = [];
    const orig = baddelApi.importGames;
    baddelApi.importGames = async (platform, games) => { calls.push({ platform, games }); };
    try {
        // Namespace shorter than 10 chars → filtered out
        engine._syncDetectedGamesToMetadataServer([
            { scannerPlatform: 'epic', namespace: 'short', name: 'Bad Epic' },
        ]);
        const epicCalls = calls.filter(c => c.platform === 'epic');
        assert.equal(epicCalls.length, 0, 'epic game with invalid namespace must not trigger importGames');
    } finally {
        baddelApi.importGames = orig;
    }
});

test('_syncDetectedGamesToMetadataServer: rejected importGames promise does not throw to caller', async () => {
    const engine = makeEngine();
    const orig = baddelApi.importGames;
    // .catch() is chained synchronously inside the method, so rejection is handled.
    baddelApi.importGames = async () => { throw new Error('server unavailable'); };
    try {
        assert.doesNotThrow(
            () => engine._syncDetectedGamesToMetadataServer([
                { scannerPlatform: 'steam', allIds: { steam: '100' }, name: 'Test' },
            ]),
            'rejected importGames must not propagate synchronously to caller'
        );
        // Let the .catch() microtask settle to avoid any noise in subsequent tests.
        await new Promise(resolve => setImmediate(resolve));
    } finally {
        baddelApi.importGames = orig;
    }
});
