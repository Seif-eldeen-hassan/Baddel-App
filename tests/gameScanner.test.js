const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.BADDEL_TEST_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-scanner-singleton-'));

const { BaddelEngine, __scannerTest } = require('../gameScanner');

function makeTempDir(prefix = 'baddel-scanner-') {
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

test('Ubisoft candidate with missing folder is skipped', () => {
    const engine = makeEngine();
    const game = engine._buildUbisoftGameFromCandidate({
        Id: 'u1',
        Name: 'Assassin Test',
        Path: path.join(engine.dbFolder, 'missing'),
    });
    assert.equal(game, null);
});

test('Ubisoft candidate with folder but no likely exe is skipped', () => {
    const engine = makeEngine();
    const installDir = path.join(engine.dbFolder, 'UbisoftGame');
    touch(path.join(installDir, 'data.pak'));
    touch(path.join(installDir, 'uninstall.exe'));
    const game = engine._buildUbisoftGameFromCandidate({ Id: 'u2', Name: 'Ubisoft Game', Path: installDir });
    assert.equal(game, null);
});

test('Ubisoft candidate with valid exe is kept', () => {
    const engine = makeEngine();
    const installDir = path.join(engine.dbFolder, 'UbisoftGame');
    const exe = touch(path.join(installDir, 'AssassinTest.exe'));
    const game = engine._buildUbisoftGameFromCandidate({ Id: 'u3', Name: 'Assassin Test', Path: installDir });
    assert.equal(game.name, 'Assassin Test');
    assert.equal(game.executablePath, exe);
    assert.equal(game.scannerPlatform, 'ubisoft');
});

test('Riot detects VALORANT from live VALORANT.exe', async () => {
    const root = path.join(makeTempDir(), 'Riot Games');
    touch(path.join(root, 'VALORANT', 'live', 'VALORANT.exe'));
    touch(path.join(root, 'Riot Client', 'RiotClientServices.exe'));
    const engine = makeEngine({ riotSearchRoots: [root] });
    const games = await engine.getRiotGames();
    const valorant = games.find(g => g.riotProduct === 'valorant');
    assert.ok(valorant);
    assert.equal(path.basename(valorant.executablePath), 'VALORANT.exe');
});

test('Riot detects VALORANT from shipping exe', async () => {
    const root = path.join(makeTempDir(), 'Riot Games');
    const shipping = touch(path.join(root, 'VALORANT', 'live', 'ShooterGame', 'Binaries', 'Win64', 'VALORANT-Win64-Shipping.exe'));
    const engine = makeEngine({ riotSearchRoots: [root] });
    const games = await engine.getRiotGames();
    const valorant = games.find(g => g.riotProduct === 'valorant');
    assert.ok(valorant);
    assert.equal(valorant.executablePath, shipping);
});

test('Riot detects League from LeagueClient.exe', async () => {
    const root = path.join(makeTempDir(), 'Riot Games');
    const client = touch(path.join(root, 'League of Legends', 'LeagueClient.exe'));
    const engine = makeEngine({ riotSearchRoots: [root] });
    const games = await engine.getRiotGames();
    const league = games.find(g => g.riotProduct === 'league_of_legends');
    assert.ok(league);
    assert.equal(league.executablePath, client);
});

test('Riot detects League from Game\\League of Legends.exe', async () => {
    const root = path.join(makeTempDir(), 'Riot Games');
    const gameExe = touch(path.join(root, 'League of Legends', 'Game', 'League of Legends.exe'));
    const engine = makeEngine({ riotSearchRoots: [root] });
    const games = await engine.getRiotGames();
    const league = games.find(g => g.riotProduct === 'league_of_legends');
    assert.ok(league);
    assert.equal(league.executablePath, gameExe);
});

test('Riot associated_client keys are case-insensitive', async () => {
    const base = makeTempDir();
    const programData = path.join(base, 'ProgramData');
    const riotRoot = path.join(base, 'Riot Games');
    const valorantExe = touch(path.join(riotRoot, 'VALORANT', 'live', 'VALORANT.exe'));
    touch(path.join(programData, 'Riot Games', 'RiotClientInstalls.json'), JSON.stringify({
        associated_client: {
            'VALORANT.Live': valorantExe,
        },
    }));
    const engine = makeEngine({ programData, riotSearchRoots: [] });
    const games = await engine.getRiotGames();
    assert.ok(games.some(g => g.riotProduct === 'valorant'));
});

test('Riot scans multiple roots and does not stop after first game', async () => {
    const firstRoot = path.join(makeTempDir(), 'Riot Games');
    const secondRoot = path.join(makeTempDir(), 'Riot Games');
    touch(path.join(firstRoot, 'VALORANT', 'live', 'VALORANT.exe'));
    touch(path.join(secondRoot, 'League of Legends', 'LeagueClient.exe'));
    const engine = makeEngine({ riotSearchRoots: [firstRoot, secondRoot] });
    const games = await engine.getRiotGames();
    assert.deepEqual(new Set(games.map(g => g.riotProduct)), new Set(['valorant', 'league_of_legends']));
});

test('startGlobalScan marks previously scanned missing games as not installed and hides them', async () => {
    const engine = makeEngine();
    engine.dbCache = [{
        id: 'riot-valorant',
        name: 'VALORANT',
        platform: 'Riot Games',
        scannerPlatform: 'riot',
        installSource: 'scanner',
        installedGameKey: 'riot:valorant',
        path: path.join(engine.dbFolder, 'missing-valorant'),
        isHidden: false,
        isInstalled: true,
        totalPlaytime: 123,
    }];
    for (const method of ['getSteamGames', 'getEpicGames', 'getRiotGames', 'getUbisoftGames', 'getEAGames', 'getXboxGames']) {
        engine[method] = async () => [];
    }

    const visible = await engine.startGlobalScan();
    assert.equal(visible.length, 0);
    assert.equal(engine.dbCache[0].isInstalled, false);
    assert.equal(engine.dbCache[0].totalPlaytime, 123);
    assert.equal(engine.getStoredGames().length, 0);
});

test('Steam appmanifest with missing common folder is skipped', () => {
    const engine = makeEngine();
    const appsPath = path.join(engine.dbFolder, 'steamapps');
    fs.mkdirSync(appsPath, { recursive: true });
    const game = engine._buildSteamGameFromManifest(appsPath, `
        "AppState"
        {
            "appid" "10"
            "name" "Missing Steam Game"
            "installdir" "Missing Steam Game"
            "StateFlags" "4"
        }
    `);
    assert.equal(game, null);
});

test('EA uninstall entry with missing InstallLocation is skipped', () => {
    const engine = makeEngine();
    const game = engine._buildEAGameFromCandidate({
        DisplayName: 'Mass Effect Test',
        InstallLocation: path.join(engine.dbFolder, 'missing-ea'),
    });
    assert.equal(game, null);
});

test('Epic manifest with missing InstallLocation is skipped', () => {
    const engine = makeEngine();
    const game = engine._buildEpicGameFromManifest({
        DisplayName: 'Epic Test',
        InstallLocation: path.join(engine.dbFolder, 'missing-epic'),
        CatalogNamespace: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        CatalogItemId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        AppName: 'EpicTest',
    });
    assert.equal(game, null);
});

test('name-only dedupe no longer collapses same title across different platforms', async () => {
    const engine = makeEngine();
    const steamDir = path.join(engine.dbFolder, 'steam-game');
    const epicDir = path.join(engine.dbFolder, 'epic-game');
    touch(path.join(steamDir, 'data.pak'));
    touch(path.join(epicDir, 'data.pak'));

    engine.getSteamGames = async () => [{
        id: 'steam-100',
        name: 'Same Title',
        platform: 'Steam',
        scannerPlatform: 'steam',
        launcherGameId: '100',
        allIds: { steam: '100' },
        path: steamDir,
        command: 'steam://run/100',
    }];
    engine.getEpicGames = async () => [{
        id: 'epic-ns-item-app',
        name: 'Same Title',
        platform: 'Epic Games',
        scannerPlatform: 'epic',
        namespace: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        catalogNamespace: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        catalogItemId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        appName: 'SameTitle',
        launcherGameId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:SameTitle',
        allIds: { epic: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
        path: epicDir,
        command: 'com.epicgames.launcher://apps/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa%3Abbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb%3ASameTitle?action=launch&silent=true',
    }];
    for (const method of ['getRiotGames', 'getUbisoftGames', 'getEAGames', 'getXboxGames']) {
        engine[method] = async () => [];
    }

    const visible = await engine.startGlobalScan();
    assert.equal(visible.length, 2);
    assert.equal(new Set(visible.map(g => g.scannerPlatform)).size, 2);
});

test('stable installed game keys are platform-specific', () => {
    assert.notEqual(
        __scannerTest.makeInstalledGameKey({ scannerPlatform: 'steam', allIds: { steam: '1' }, name: 'Same' }),
        __scannerTest.makeInstalledGameKey({ scannerPlatform: 'epic', namespace: 'ns', catalogItemId: 'item', appName: 'app', name: 'Same' })
    );
});

// ─── Epic local scanner non-game asset filter ──────────────────────────────

function makeEpicManifest(overrides = {}) {
    return {
        DisplayName:      'Test Game',
        InstallLocation:  null, // caller must set a real path
        CatalogNamespace: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        CatalogItemId:    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        AppName:          'TestGame',
        LaunchExecutable: 'TestGame.exe',
        bIsIncompleteInstall: false,
        ...overrides,
    };
}

test('Epic local manifest DisplayName "Fab" / AppName "fab" is skipped', () => {
    const engine = makeEngine();
    const installDir = path.join(engine.dbFolder, 'Fab');
    touch(path.join(installDir, 'Fab.exe'));
    const game = engine._buildEpicGameFromManifest(makeEpicManifest({
        DisplayName: 'Fab',
        InstallLocation: installDir,
        CatalogNamespace: 'fab',
        CatalogItemId: 'fab-catalog-id',
        AppName: 'fab',
        LaunchExecutable: 'Fab.exe',
    }));
    assert.equal(game, null);
});

test('Epic local manifest "Fab Marketplace" is skipped', () => {
    const engine = makeEngine();
    const installDir = path.join(engine.dbFolder, 'FabMarket');
    touch(path.join(installDir, 'data.pak'));
    const game = engine._buildEpicGameFromManifest(makeEpicManifest({
        DisplayName: 'Fab Marketplace',
        InstallLocation: installDir,
        CatalogNamespace: 'marketplace',
        CatalogItemId: 'fab-market-id',
        AppName: 'FabMarketplace',
    }));
    assert.equal(game, null);
});

test('Epic local manifest "Unreal Engine Marketplace" is skipped', () => {
    const engine = makeEngine();
    const installDir = path.join(engine.dbFolder, 'UEMarket');
    touch(path.join(installDir, 'data.pak'));
    const game = engine._buildEpicGameFromManifest(makeEpicManifest({
        DisplayName: 'Unreal Engine Marketplace',
        InstallLocation: installDir,
        CatalogNamespace: 'ue',
        CatalogItemId: 'ue-market-id',
        AppName: 'UnrealEngineMarketplace',
    }));
    assert.equal(game, null);
});

test('Epic local manifest "Blueprint CSV Parsing" plugin is skipped', () => {
    const engine = makeEngine();
    const installDir = path.join(engine.dbFolder, 'BlueprintCSV');
    touch(path.join(installDir, 'BlueprintCSV.uplugin'));
    const game = engine._buildEpicGameFromManifest(makeEpicManifest({
        DisplayName: 'Blueprint CSV Parsing',
        InstallLocation: installDir,
        CatalogNamespace: 'ue-plugins',
        CatalogItemId: 'csv-plugin-id',
        AppName: 'BlueprintCSVParsing',
        LaunchExecutable: '',
        bIsIncompleteInstall: false,
        metadata: { productType: 'plugin', categories: ['plugins'] },
    }));
    assert.equal(game, null);
});

test('Epic local manifest "Fable" is kept — not confused with Fab', () => {
    const engine = makeEngine();
    const installDir = path.join(engine.dbFolder, 'Fable');
    const exe = touch(path.join(installDir, 'Fable.exe'));
    const game = engine._buildEpicGameFromManifest(makeEpicManifest({
        DisplayName: 'Fable',
        InstallLocation: installDir,
        CatalogNamespace: 'playground-fable',
        CatalogItemId: 'fable-item-id',
        AppName: 'Fable',
        LaunchExecutable: 'Fable.exe',
    }));
    assert.ok(game !== null, 'Fable should not be rejected as a non-game asset');
    assert.equal(game.name, 'Fable');
    assert.equal(game.executablePath, exe);
});

test('Epic local manifest "Fortnite" is kept', () => {
    const engine = makeEngine();
    const installDir = path.join(engine.dbFolder, 'Fortnite');
    touch(path.join(installDir, 'FortniteGame.exe'));
    const game = engine._buildEpicGameFromManifest(makeEpicManifest({
        DisplayName: 'Fortnite',
        InstallLocation: installDir,
        CatalogNamespace: 'fn',
        CatalogItemId: 'fortnite-item-id',
        AppName: 'Fortnite',
        LaunchExecutable: 'FortniteGame.exe',
    }));
    assert.ok(game !== null, 'Fortnite should not be rejected');
    assert.equal(game.name, 'Fortnite');
});

test('startGlobalScan marks existing scanner-owned Epic Fab entry as isInstalled=false', async () => {
    const engine = makeEngine();
    const fabDir = path.join(engine.dbFolder, 'Fab');
    touch(path.join(fabDir, 'Fab.exe'));

    engine.dbCache = [{
        id: 'epic-fab-id',
        name: 'Fab',
        platform: 'Epic Games',
        scannerPlatform: 'epic',
        installSource: 'scanner',
        installedGameKey: 'epic:fab:fab:fab-catalog-id:FabApp',
        appName: 'FabApp',
        namespace: 'fab',
        catalogNamespace: 'fab',
        path: fabDir,
        isHidden: false,
        isInstalled: true,
    }];

    for (const method of ['getSteamGames', 'getEpicGames', 'getRiotGames', 'getUbisoftGames', 'getEAGames', 'getXboxGames']) {
        engine[method] = async () => [];
    }

    const visible = await engine.startGlobalScan();
    assert.equal(visible.length, 0, 'Fab should not appear in visible games');
    assert.equal(engine.dbCache[0].isInstalled, false, 'Fab db entry must be marked isInstalled=false');
    assert.equal(engine.dbCache[0].missingReason, 'epic_non_game_asset');
});

// ── stale-pass field mutation ─────────────────────────────────────────────────

test('startGlobalScan: stale pass marks scanner-owned game missing with full metadata fields', async () => {
    const engine = makeEngine();
    engine.dbCache = [{
        id: 'riot-valorant',
        name: 'VALORANT',
        platform: 'Riot Games',
        scannerPlatform: 'riot',
        installSource: 'scanner',
        installedGameKey: 'riot:valorant',
        isHidden: false,
        isInstalled: true,
        totalPlaytime: 42,
    }];
    for (const method of ['getSteamGames', 'getEpicGames', 'getRiotGames', 'getUbisoftGames', 'getEAGames', 'getXboxGames']) {
        engine[method] = async () => [];
    }

    const beforeTs = new Date().toISOString();
    await engine.startGlobalScan();
    const afterTs = new Date().toISOString();

    const game = engine.dbCache[0];
    assert.equal(game.isInstalled, false, 'isInstalled must be false');
    assert.equal(game.installVerified, false, 'installVerified must be false');
    assert.ok(typeof game.removedFromDiskAt === 'string' && game.removedFromDiskAt.length > 0, 'removedFromDiskAt must be set');
    assert.ok(game.lastMissingScanAt >= beforeTs, 'lastMissingScanAt must be at or after scan start');
    assert.ok(game.lastMissingScanAt <= afterTs, 'lastMissingScanAt must be at or before scan end');
    assert.ok(typeof game.missingReason === 'string' && game.missingReason.length > 0, 'missingReason must be set');
    assert.ok(Array.isArray(game.validationWarnings), 'validationWarnings must be an array');
    assert.ok(game.validationWarnings.includes(game.missingReason), 'validationWarnings must include missingReason');
    assert.equal(game.totalPlaytime, 42, 'totalPlaytime must be preserved');
});

test('startGlobalScan: stale pass sets missingReason not_seen_in_latest_scan for unresolvable game', async () => {
    const engine = makeEngine();
    engine.dbCache = [{
        id: 'riot-valorant',
        name: 'VALORANT',
        scannerPlatform: 'riot',
        installSource: 'scanner',
        installedGameKey: 'riot:valorant',
        isInstalled: true,
        // no path, no executablePath → reason must be not_seen_in_latest_scan
    }];
    for (const method of ['getSteamGames', 'getEpicGames', 'getRiotGames', 'getUbisoftGames', 'getEAGames', 'getXboxGames']) {
        engine[method] = async () => [];
    }

    await engine.startGlobalScan();
    assert.equal(engine.dbCache[0].missingReason, 'not_seen_in_latest_scan');
});

test('startGlobalScan: stale pass sets missingReason install_path_missing when path does not exist', async () => {
    const engine = makeEngine();
    engine.dbCache = [{
        id: 'riot-valorant',
        name: 'VALORANT',
        scannerPlatform: 'riot',
        installSource: 'scanner',
        installedGameKey: 'riot:valorant',
        isInstalled: true,
        path: path.join(engine.dbFolder, 'this-folder-does-not-exist'),
    }];
    for (const method of ['getSteamGames', 'getEpicGames', 'getRiotGames', 'getUbisoftGames', 'getEAGames', 'getXboxGames']) {
        engine[method] = async () => [];
    }

    await engine.startGlobalScan();
    assert.equal(engine.dbCache[0].missingReason, 'install_path_missing');
});

test('startGlobalScan: stale pass accumulates validationWarnings without duplicates', async () => {
    const engine = makeEngine();
    const reason = 'not_seen_in_latest_scan';
    engine.dbCache = [{
        id: 'riot-valorant',
        name: 'VALORANT',
        scannerPlatform: 'riot',
        installSource: 'scanner',
        installedGameKey: 'riot:valorant',
        isInstalled: true,
        validationWarnings: [reason], // pre-existing warning — must not duplicate
    }];
    for (const method of ['getSteamGames', 'getEpicGames', 'getRiotGames', 'getUbisoftGames', 'getEAGames', 'getXboxGames']) {
        engine[method] = async () => [];
    }

    await engine.startGlobalScan();
    const warnings = engine.dbCache[0].validationWarnings;
    assert.ok(Array.isArray(warnings));
    assert.equal(warnings.filter(w => w === reason).length, 1, 'must not duplicate an existing warning');
});

// ── stale-pass removedFromDiskAt idempotency ──────────────────────────────────

test('startGlobalScan: stale pass preserves existing removedFromDiskAt', async () => {
    const engine = makeEngine();
    const existingDate = '2020-06-01T00:00:00.000Z';
    engine.dbCache = [{
        id: 'riot-valorant',
        name: 'VALORANT',
        scannerPlatform: 'riot',
        installSource: 'scanner',
        installedGameKey: 'riot:valorant',
        isInstalled: true,
        removedFromDiskAt: existingDate, // already recorded on a previous scan
    }];
    for (const method of ['getSteamGames', 'getEpicGames', 'getRiotGames', 'getUbisoftGames', 'getEAGames', 'getXboxGames']) {
        engine[method] = async () => [];
    }

    const beforeTs = new Date().toISOString();
    await engine.startGlobalScan();
    const afterTs = new Date().toISOString();

    const game = engine.dbCache[0];
    assert.equal(game.removedFromDiskAt, existingDate, 'removedFromDiskAt must not be overwritten if already set');
    // lastMissingScanAt must still update to the current scan time
    assert.ok(game.lastMissingScanAt >= beforeTs, 'lastMissingScanAt must update to current scan');
    assert.ok(game.lastMissingScanAt <= afterTs);
    assert.notEqual(game.lastMissingScanAt, existingDate, 'lastMissingScanAt must differ from the preserved removedFromDiskAt');
});

// ── stale-pass skip conditions ────────────────────────────────────────────────

test('startGlobalScan: stale pass skips manual games', async () => {
    const engine = makeEngine();
    engine.dbCache = [{
        id: 'manual-mygame',
        name: 'My Game',
        scannerPlatform: 'manual',
        installSource: 'manual',
        platform: 'Manual',
        isInstalled: true,
    }];
    for (const method of ['getSteamGames', 'getEpicGames', 'getRiotGames', 'getUbisoftGames', 'getEAGames', 'getXboxGames']) {
        engine[method] = async () => [];
    }

    await engine.startGlobalScan();
    const game = engine.dbCache[0];
    assert.notEqual(game.isInstalled, false, 'manual game must not be marked missing by stale pass');
    assert.equal(game.lastMissingScanAt, undefined, 'lastMissingScanAt must not be set on a manual game');
    assert.equal(game.missingReason, undefined, 'missingReason must not be set on a manual game');
});

test('startGlobalScan: stale pass skips games from unscanned platforms', async () => {
    const engine = makeEngine();
    engine.dbCache = [{
        id: 'steam-100',
        name: 'Steam Game',
        scannerPlatform: 'steam',
        installSource: 'scanner',
        installedGameKey: 'steam:100',
        isInstalled: true,
    }];
    // Make steam scanner throw — steam is NOT added to scannedPlatforms
    engine.getSteamGames = async () => { throw new Error('steam scan skipped'); };
    for (const method of ['getEpicGames', 'getRiotGames', 'getUbisoftGames', 'getEAGames', 'getXboxGames']) {
        engine[method] = async () => [];
    }

    await engine.startGlobalScan();
    const game = engine.dbCache[0];
    assert.notEqual(game.isInstalled, false, 'game from unscanned platform must not be marked missing');
    assert.equal(game.lastMissingScanAt, undefined, 'lastMissingScanAt must not be set for unscanned platform game');
});

// ── stale-pass backfill fields ────────────────────────────────────────────────

test('startGlobalScan: stale pass backfills installSource to scanner', async () => {
    // Game is scanner-owned (has scannerPlatform + command) but installSource was never set.
    // _isScannerOwnedGame falls through to platform+command check when installSource is absent.
    const engine = makeEngine();
    engine.dbCache = [{
        id: 'riot-valorant',
        name: 'VALORANT',
        scannerPlatform: 'riot',
        // installSource: intentionally absent
        command: 'riot://launch/valorant', // satisfies _isScannerOwnedGame's command check
        installedGameKey: 'riot:valorant',
        isInstalled: true,
    }];
    for (const method of ['getSteamGames', 'getEpicGames', 'getRiotGames', 'getUbisoftGames', 'getEAGames', 'getXboxGames']) {
        engine[method] = async () => [];
    }

    await engine.startGlobalScan();
    assert.equal(engine.dbCache[0].installSource, 'scanner', 'installSource must be backfilled to scanner');
});

test('startGlobalScan: stale pass backfills scannerPlatform when inferred from id prefix', async () => {
    // Game has no scannerPlatform or platform field.
    // _scannerPlatformForGame falls through to id-prefix check: 'riot-…' → 'riot'.
    const engine = makeEngine();
    engine.dbCache = [{
        id: 'riot-valorant',   // starts with 'riot-' → inferred platform = 'riot'
        name: 'VALORANT',
        // scannerPlatform: intentionally absent
        installSource: 'scanner',
        installedGameKey: 'riot:valorant',
        isInstalled: true,
    }];
    for (const method of ['getSteamGames', 'getEpicGames', 'getRiotGames', 'getUbisoftGames', 'getEAGames', 'getXboxGames']) {
        engine[method] = async () => [];
    }

    await engine.startGlobalScan();
    assert.equal(engine.dbCache[0].scannerPlatform, 'riot', 'scannerPlatform must be backfilled from id prefix');
});

test('startGlobalScan: stale pass backfills installedGameKey when missing', async () => {
    // Game is scanner-owned but installedGameKey was never written.
    // Stale pass calls makeInstalledGameKey(game) and stores the result.
    const engine = makeEngine();
    engine.dbCache = [{
        id: 'steam-440',
        name: 'Team Fortress 2',
        scannerPlatform: 'steam',
        installSource: 'scanner',
        allIds: { steam: '440' }, // enough for makeInstalledGameKey to produce a steam key
        // installedGameKey: intentionally absent
        isInstalled: true,
    }];
    for (const method of ['getSteamGames', 'getEpicGames', 'getRiotGames', 'getUbisoftGames', 'getEAGames', 'getXboxGames']) {
        engine[method] = async () => [];
    }

    await engine.startGlobalScan();
    const key = engine.dbCache[0].installedGameKey;
    assert.ok(typeof key === 'string' && key.length > 0, 'installedGameKey must be backfilled when missing');
});

// ── stale-pass staleRemoved counter ──────────────────────────────────────────

test('startGlobalScan: stale pass increments staleRemoved only for previously visible games', async () => {
    // Visible game → should increment platform staleRemoved counter once
    const engineA = makeEngine();
    engineA.dbCache = [{
        id: 'riot-valorant', name: 'VALORANT', scannerPlatform: 'riot',
        installSource: 'scanner', installedGameKey: 'riot:valorant',
        isInstalled: true, // was visible
    }];
    for (const m of ['getSteamGames', 'getEpicGames', 'getRiotGames', 'getUbisoftGames', 'getEAGames', 'getXboxGames'])
        engineA[m] = async () => [];
    await engineA.startGlobalScan();
    assert.equal(engineA._currentScanReports?.riot?.staleRemoved, 1,
        'visible game becoming stale must increment staleRemoved');

    // Already-missing game → staleRemoved must stay at 0
    const engineB = makeEngine();
    engineB.dbCache = [{
        id: 'riot-valorant', name: 'VALORANT', scannerPlatform: 'riot',
        installSource: 'scanner', installedGameKey: 'riot:valorant',
        isInstalled: false, // already marked missing — wasVisible is false
    }];
    for (const m of ['getSteamGames', 'getEpicGames', 'getRiotGames', 'getUbisoftGames', 'getEAGames', 'getXboxGames'])
        engineB[m] = async () => [];
    await engineB.startGlobalScan();
    assert.equal(engineB._currentScanReports?.riot?.staleRemoved ?? 0, 0,
        'already-missing game must not increment staleRemoved');
});

// ── stale-pass: already-missing game ─────────────────────────────────────────

test('startGlobalScan: stale pass updates lastMissingScanAt on game already marked missing', async () => {
    const engine = makeEngine();
    const priorDate = '2020-06-01T00:00:00.000Z';
    engine.dbCache = [{
        id: 'riot-valorant',
        name: 'VALORANT',
        scannerPlatform: 'riot',
        installSource: 'scanner',
        installedGameKey: 'riot:valorant',
        isInstalled: false, // already marked missing from a prior scan
        removedFromDiskAt: priorDate,
        lastMissingScanAt: priorDate,
    }];
    for (const method of ['getSteamGames', 'getEpicGames', 'getRiotGames', 'getUbisoftGames', 'getEAGames', 'getXboxGames']) {
        engine[method] = async () => [];
    }

    const beforeTs = new Date().toISOString();
    await engine.startGlobalScan();
    const afterTs = new Date().toISOString();

    const game = engine.dbCache[0];
    assert.equal(game.isInstalled, false, 'isInstalled must remain false');
    assert.equal(game.removedFromDiskAt, priorDate, 'removedFromDiskAt must not change for already-missing game');
    assert.ok(game.lastMissingScanAt >= beforeTs, 'lastMissingScanAt must update even when already missing');
    assert.ok(game.lastMissingScanAt <= afterTs);
});

test('Epic scanner diagnostics count skipped non-game assets separately', () => {
    const engine = makeEngine();
    const installDir = path.join(engine.dbFolder, 'FabSkip');
    touch(path.join(installDir, 'Fab.exe'));

    engine._buildEpicGameFromManifest(makeEpicManifest({
        DisplayName: 'Fab',
        InstallLocation: installDir,
        CatalogNamespace: 'fab',
        CatalogItemId: 'fab-id',
        AppName: 'fab',
        LaunchExecutable: 'Fab.exe',
    }));

    const report = engine._currentScanReports?.epic;
    assert.ok(report, 'epic report must exist after build attempt');
    assert.ok(
        (report.skipped || 0) >= 1,
        `expected at least 1 skipped for epic, got ${report?.skipped}`
    );
});

// ── Playtime & time-tracking tests ──────────────────────────────────────────

test('saveQualifiedSession: qualified session updates totalPlaytime and lastQualifiedPlayed', async () => {
    const engine = makeEngine();
    // Manually insert a game into the cache
    engine.dbCache = [{ id: 'g1', name: 'Portal 2', totalPlaytime: 10 }];
    const result = await engine.saveQualifiedSession('g1', {
        countedMinutes:      5,
        totalCountedMinutes: 5,
        rawRuntimeMinutes:   8,
        idleMinutes:         1,
        backgroundMinutes:   2,
        foregroundSeen:      true,
        confidence:          'high',
        endReason:           'process_gone',
        startedAt:           Date.now() - 10 * 60_000,
        endedAt:             Date.now(),
        isQualified:         true,
    });
    assert.equal(result.status, 'success');
    assert.equal(result.totalPlaytime, 15);
    assert.ok(result.lastQualifiedPlayed, 'lastQualifiedPlayed must be set');
    assert.equal(result.sessionQualified, true);
    const game = engine.dbCache[0];
    assert.equal(game.totalPlaytime, 15);
    assert.ok(game.lastQualifiedPlayed, 'game.lastQualifiedPlayed must be set');
    assert.equal(game.playSessions[0].qualified, true);
    assert.equal(game.playSessions[0].foregroundSeen, true);
});

test('saveQualifiedSession: unqualified session does NOT set lastQualifiedPlayed', async () => {
    const engine = makeEngine();
    engine.dbCache = [{ id: 'g2', name: 'Wallpaper Engine', totalPlaytime: 0 }];
    await engine.saveQualifiedSession('g2', {
        countedMinutes:      0,
        totalCountedMinutes: 0,
        rawRuntimeMinutes:   120,
        idleMinutes:         60,
        backgroundMinutes:   60,
        foregroundSeen:      false,
        confidence:          'low',
        endReason:           'process_gone',
        startedAt:           Date.now() - 120 * 60_000,
        endedAt:             Date.now(),
        isQualified:         false,
    });
    const game = engine.dbCache[0];
    assert.equal(game.lastQualifiedPlayed, undefined, 'must not set lastQualifiedPlayed for unqualified session');
    assert.equal(game.totalPlaytime, 0, 'must not increment totalPlaytime when countedMinutes=0');
    assert.equal(game.lastPlayed, undefined, 'must not set lastPlayed when countedMinutes=0');
});

test('saveQualifiedSession: unqualified but counted session sets lastPlayed, not lastQualifiedPlayed', async () => {
    const engine = makeEngine();
    const beforeTs = Date.now();
    engine.dbCache = [{ id: 'g-short', name: 'Fall Guys', totalPlaytime: 0 }];
    const result = await engine.saveQualifiedSession('g-short', {
        countedMinutes:      1,
        totalCountedMinutes: 1,
        rawRuntimeMinutes:   1,
        idleMinutes:         0,
        backgroundMinutes:   0,
        foregroundSeen:      true,
        confidence:          'medium',
        endReason:           'process_gone',
        startedAt:           beforeTs - 60_000,
        endedAt:             beforeTs,
        isQualified:         false,
    });
    assert.equal(result.status, 'success');
    assert.equal(result.totalPlaytime, 1, 'totalPlaytime must increase by countedMinutes');
    assert.ok(result.lastPlayed, 'result must carry lastPlayed');
    assert.equal(result.lastQualifiedPlayed, undefined, 'result must NOT carry lastQualifiedPlayed');
    assert.equal(result.sessionQualified, false);
    const game = engine.dbCache[0];
    assert.equal(game.totalPlaytime, 1);
    assert.ok(game.lastPlayed, 'game.lastPlayed must be set for counted session');
    assert.equal(game.lastQualifiedPlayed, undefined, 'game.lastQualifiedPlayed must stay unset');
    assert.equal(game.playSessions[0].qualified, false);
});

test('setTimeTrackingEnabled: sets and reads back the flag', async () => {
    const engine = makeEngine();
    engine.dbCache = [{ id: 'g3', name: 'Test Game' }];

    const res = await engine.setTimeTrackingEnabled('g3', false);
    assert.equal(res.status, 'success');
    assert.equal(res.timeTrackingEnabled, false, 'return value must use timeTrackingEnabled field');
    assert.equal(res.gameId, 'g3');

    const getRes = engine.getTimeTrackingEnabled('g3');
    assert.equal(getRes.status, 'success');
    assert.equal(getRes.timeTrackingEnabled, false);

    await engine.setTimeTrackingEnabled('g3', true);
    const getRes2 = engine.getTimeTrackingEnabled('g3');
    assert.equal(getRes2.timeTrackingEnabled, true);
});

test('setTimeTrackingEnabled: missing game returns error without throwing', async () => {
    const engine = makeEngine();
    engine.dbCache = [];
    const res = await engine.setTimeTrackingEnabled('nonexistent', false);
    assert.equal(res.status, 'error');
    assert.ok(res.error, 'error field must be set');
});

test('getTimeTrackingEnabled: missing game returns error without throwing', () => {
    const engine = makeEngine();
    engine.dbCache = [];
    const res = engine.getTimeTrackingEnabled('nonexistent');
    assert.equal(res.status, 'error');
    assert.ok(res.error, 'error field must be set');
});

test('getTimeTrackingEnabled: defaults to true when field absent (backward compat)', () => {
    const engine = makeEngine();
    engine.dbCache = [{ id: 'g-legacy', name: 'Legacy Game' }]; // no timeTrackingEnabled field
    const res = engine.getTimeTrackingEnabled('g-legacy');
    assert.equal(res.status, 'success');
    assert.equal(res.timeTrackingEnabled, true, 'missing field must default to true');
});

// Runtime export tests — not just grep, actually require the module
test('gameScanner module exports setTimeTrackingEnabled as a function', () => {
    const gs = require('../gameScanner');
    assert.equal(typeof gs.setTimeTrackingEnabled, 'function',
        'setTimeTrackingEnabled must be exported from module.exports');
});

test('gameScanner module exports getTimeTrackingEnabled as a function', () => {
    const gs = require('../gameScanner');
    assert.equal(typeof gs.getTimeTrackingEnabled, 'function',
        'getTimeTrackingEnabled must be exported from module.exports');
});

test('updatePlaytime: tracking_disabled returns without incrementing', async () => {
    const engine = makeEngine();
    engine.dbCache = [{ id: 'g4', name: 'Disabled Game', totalPlaytime: 20, timeTrackingEnabled: false }];
    const res = await engine.updatePlaytime('g4', 5);
    assert.equal(res.status, 'tracking_disabled');
    assert.equal(engine.dbCache[0].totalPlaytime, 20, 'totalPlaytime must not change');
});

test('saveQualifiedSession: tracking_disabled blocks session save', async () => {
    const engine = makeEngine();
    engine.dbCache = [{ id: 'g5', name: 'Off Game', totalPlaytime: 0, timeTrackingEnabled: false }];
    const res = await engine.saveQualifiedSession('g5', {
        countedMinutes: 10, totalCountedMinutes: 10, rawRuntimeMinutes: 15,
        foregroundSeen: true, confidence: 'high', isQualified: true,
        startedAt: Date.now(), endedAt: Date.now(),
    });
    assert.equal(res.status, 'tracking_disabled');
    assert.equal(engine.dbCache[0].totalPlaytime, 0);
});
