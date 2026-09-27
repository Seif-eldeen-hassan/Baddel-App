'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {
    GogInstalledGamesScanner,
    GalaxySqliteAdapter,
    cleanRegistryPath,
    isUnsafeExecutableName,
} = require('../src/features/games/infrastructure/scanner/GogInstalledGamesScanner');
const { GameScannerCore, SCANNER_PLATFORMS } = require('../src/features/games/infrastructure/scanner/GameScannerCore');
const { BaddelEngine } = require('../src/features/games/infrastructure/legacy/BaddelEngine');
const { resolveTrustedLaunchCommand } = require('../handlers/launchHandlers');

function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-gog-scanner-'));
}

function writeFile(file, value = 'x') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value);
    return file;
}

function makeInstall(root, options = {}) {
    const gameDir = path.join(root, options.folder || 'Example Game');
    const exeRelative = options.exeRelative || 'bin/game.exe';
    if (options.createExe !== false) writeFile(path.join(gameDir, exeRelative), 'MZ-fixture');
    const manifest = options.raw === undefined ? {
        gameId: options.productId || '1207659001',
        name: options.name || 'Example Game',
        ...(options.extra || {}),
        playTasks: options.playTasks || [{ category: 'game', isPrimary: true, path: exeRelative, arguments: '--safe "two words"' }],
    } : options.raw;
    writeFile(path.join(gameDir, options.manifestName || `goggame-${options.productId || '1207659001'}.info`),
        typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
    return { gameDir, executablePath: path.join(gameDir, exeRelative) };
}

function fallbackExe(root) {
    const queue = [root];
    while (queue.length) {
        const current = queue.shift();
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) queue.push(full);
            else if (entry.isFile() && entry.name.toLowerCase().endsWith('.exe') && !isUnsafeExecutableName(full)) return full;
        }
    }
    return null;
}

function makeScanner(root, options = {}) {
    return new GogInstalledGamesScanner({
        userDataDir: options.userDataDir || root,
        configuredRoots: options.configuredRoots || [root],
        driveRoots: [],
        registryAdapter: options.registryAdapter || { listEntries: async () => ({ status: 'ready', entries: [] }) },
        galaxyAdapter: options.galaxyAdapter || { readInstalledGames: async () => ({ status: 'unavailable', rows: [] }) },
        getStoredGames: options.getStoredGames || (() => []),
        findLikelyGameExe: options.findLikelyGameExe || fallbackExe,
        signal: options.signal,
        clock: options.clock,
        limits: options.limits,
    });
}

test('scanner platform set and official orchestration include GOG with failure isolation', async () => {
    assert.equal(SCANNER_PLATFORMS.has('gog'), true);
    const core = new GameScannerCore({
        programData: 'C:\\ProgramData', dbFolder: tempDir(), testDriveRoots: [], api: {}, mrm: {}, MRM_STATUS: {},
        gogScanner: { scan: async () => { throw new Error('synthetic GOG failure'); } },
    });
    for (const [name, value] of Object.entries({
        getSteamGames: [{ id: 'steam' }], getEpicGames: [], getRiotGames: [], getUbisoftGames: [], getEAGames: [], getXboxGames: [],
    })) core[name] = async () => value;
    const games = await core.getOfficialGames();
    assert.deepEqual(games, [{ id: 'steam' }]);
    assert.equal(core.getScanReports().gog.deletionReady, false);
});

test('valid GOG metadata resolves a relative executable and structured arguments', async t => {
    const root = tempDir(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const install = makeInstall(root);
    const result = await makeScanner(root).scan();
    assert.equal(result.games.length, 1);
    assert.equal(result.games[0].gogProductId, '1207659001');
    assert.equal(result.games[0].executablePath, install.executablePath);
    assert.deepEqual(result.games[0].launchArgs, ['--safe', 'two words']);
    assert.equal(result.games[0].installProvider, 'gog_discovered');
    assert.equal(result.games[0].allIds.gog, '1207659001');
});

test('missing primary executable uses only a verified safe bounded fallback', async t => {
    const root = tempDir(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const install = makeInstall(root, { createExe: false });
    writeFile(path.join(install.gameDir, 'real-game.exe'), 'MZ');
    writeFile(path.join(install.gameDir, 'setup.exe'), 'MZ');
    const result = await makeScanner(root).scan();
    assert.equal(result.games.length, 1);
    assert.equal(path.basename(result.games[0].executablePath), 'real-game.exe');
});

test('malformed and oversized manifests fail softly', async t => {
    const root = tempDir(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    makeInstall(root, { folder: 'bad-json', raw: '{bad' });
    makeInstall(root, { folder: 'large', raw: JSON.stringify({ gameId: '1207659002', pad: 'x'.repeat(2048) }) });
    const result = await makeScanner(root, { limits: { maxManifestBytes: 512 } }).scan();
    assert.equal(result.games.length, 0);
    assert.ok(result.diagnostics.sources.filesystem.reasonCodes.GOG_MANIFEST_MALFORMED >= 1);
    assert.ok(result.diagnostics.sources.filesystem.reasonCodes.GOG_MANIFEST_OVERSIZED >= 1);
});

test('path traversal and executables outside the install root are rejected without fallback', async t => {
    const root = tempDir(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    writeFile(path.join(root, 'outside.exe'), 'MZ');
    makeInstall(root, { folder: 'Traversal', createExe: false, playTasks: [{ category: 'game', path: '../outside.exe' }] });
    const result = await makeScanner(root).scan();
    assert.equal(result.games.length, 0);
    assert.ok(result.diagnostics.sources.filesystem.reasonCodes.GOG_EXECUTABLE_PATH_TRAVERSAL >= 1);
});

test('setup, uninstall, redistributable, support, and Galaxy executables are rejected', async t => {
    const root = tempDir(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const names = ['setup.exe', 'unins000.exe', 'vcredist.exe', 'support.exe', 'GalaxyClient.exe'];
    for (let i = 0; i < names.length; i++) {
        makeInstall(root, { folder: `bad-${i}`, productId: String(1207659100 + i), exeRelative: names[i] });
    }
    const result = await makeScanner(root, { findLikelyGameExe: () => null }).scan();
    assert.equal(result.games.length, 0);
});

test('equivalent manifests and DLC metadata produce one base-game record', async t => {
    const root = tempDir(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const install = makeInstall(root);
    writeFile(path.join(install.gameDir, 'goggame-copy.INFO'), JSON.stringify({
        gameId: '1207659001', name: 'Example Game', playTasks: [{ category: 'game', path: 'bin/game.exe' }],
    }));
    writeFile(path.join(install.gameDir, 'goggame-dlc.info'), JSON.stringify({
        gameId: '1207659999', rootGameId: '1207659001', type: 'dlc', name: 'Bonus',
    }));
    const result = await makeScanner(root).scan();
    assert.equal(result.games.length, 1);
    assert.equal(result.games[0].gogProductId, '1207659001');
});

test('unrelated base identities in one folder are rejected conservatively', async t => {
    const root = tempDir(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const install = makeInstall(root);
    writeFile(path.join(install.gameDir, 'goggame-other.info'), JSON.stringify({
        gameId: '1207659002', name: 'Other', playTasks: [{ category: 'game', path: 'bin/game.exe' }],
    }));
    const result = await makeScanner(root).scan();
    assert.equal(result.games.length, 0);
    assert.ok(result.diagnostics.sources.filesystem.reasonCodes.GOG_BASE_IDENTITY_AMBIGUOUS >= 2);
});

test('symlink loops do not escape the trusted root', async t => {
    const root = tempDir(); const outside = tempDir();
    t.after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); });
    makeInstall(outside);
    try { fs.symlinkSync(outside, path.join(root, 'escape'), 'junction'); } catch { return; }
    const result = await makeScanner(root).scan();
    assert.equal(result.games.length, 0);
});

test('entry, timeout, and cancellation limits return a non-deletion-ready partial result', async t => {
    const root = tempDir(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    for (let i = 0; i < 8; i++) fs.mkdirSync(path.join(root, `dir-${i}`));
    const limited = await makeScanner(root, { limits: { maxEntries: 2 } }).scan();
    assert.equal(limited.deletionReady, false);
    assert.equal(limited.diagnostics.sources.filesystem.status, 'partial');
    const controller = new AbortController(); controller.abort();
    const cancelled = await makeScanner(root, { signal: controller.signal }).scan();
    assert.equal(cancelled.diagnostics.sources.filesystem.status, 'cancelled');
    let tick = 0;
    const timed = await makeScanner(root, { clock: () => (tick += 100), limits: { timeoutMs: 50 } }).scan();
    assert.equal(timed.diagnostics.sources.filesystem.status, 'timed_out');
});

test('registry discovery validates strong evidence, all supplied views, stale paths, and path quoting', async t => {
    const root = tempDir(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const install = makeInstall(root, { folder: 'Registry Game' });
    const entries = [
        { Hive: 'LocalMachine', View: 'Registry64', Publisher: 'GOG.com', InstallLocation: install.gameDir },
        { Hive: 'LocalMachine', View: 'Registry32', DisplayName: 'Name only', InstallLocation: install.gameDir },
        { Hive: 'CurrentUser', View: 'Registry64', Publisher: 'GOG.com', InstallLocation: path.join(root, 'missing') },
        { Hive: 'CurrentUser', View: 'Registry32', Publisher: 'GOG.com', DisplayIcon: `"${path.join(install.gameDir, 'bin', 'game.exe')}",-1` },
    ];
    const result = await makeScanner(root, {
        configuredRoots: [],
        registryAdapter: { listEntries: async () => ({ status: 'ready', entries }) },
    }).scan();
    assert.equal(result.games.length, 1);
    assert.ok(result.games[0].discoverySources.includes('registry'));
    assert.ok(result.diagnostics.sources.registry.reasonCodes.GOG_REGISTRY_EVIDENCE_WEAK >= 1);
    assert.ok(result.diagnostics.sources.registry.reasonCodes.GOG_REGISTRY_PATH_STALE >= 1);
    assert.equal(cleanRegistryPath(`"C:\\Games\\x.exe",-2`), 'C:\\Games\\x.exe');
});

test('registry query errors fail softly and prevent deletion readiness', async t => {
    const root = tempDir(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    makeInstall(root);
    const result = await makeScanner(root, {
        registryAdapter: { listEntries: async () => ({ status: 'failed', entries: [], error: 'ACCESS_DENIED' }) },
    }).scan();
    assert.equal(result.games.length, 1);
    assert.equal(result.deletionReady, false);
    assert.equal(result.diagnostics.sources.registry.error, 'ACCESS_DENIED');
});

test('exact Galaxy ID/path marks only that installation as Galaxy-managed', async t => {
    const root = tempDir(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const galaxyInstall = makeInstall(root, { folder: 'Galaxy' });
    makeInstall(root, { folder: 'Standalone', productId: '1207659002' });
    const result = await makeScanner(root, {
        galaxyAdapter: { readInstalledGames: async () => ({ status: 'ready', rows: [{ productId: '1207659001', installationPath: galaxyInstall.gameDir, title: 'DB Title' }] }) },
    }).scan();
    assert.equal(result.games.find(game => game.gogProductId === '1207659001').installProvider, 'gog_galaxy');
    assert.equal(result.games.find(game => game.gogProductId === '1207659002').installProvider, 'gog_discovered');
});

test('missing, locked, corrupt, and schema-mismatched Galaxy databases are soft failures', async t => {
    const root = tempDir(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const missing = await new GalaxySqliteAdapter({ databasePath: path.join(root, 'missing.db'), userDataDir: root }).readInstalledGames();
    assert.equal(missing.status, 'unavailable');
    const corruptPath = writeFile(path.join(root, 'corrupt.db'), 'not sqlite');
    const corrupt = await new GalaxySqliteAdapter({ databasePath: corruptPath, userDataDir: root }).readInstalledGames();
    assert.equal(corrupt.status, 'failed');
    assert.ok(['GOG_DB_CORRUPT', 'GOG_DB_READ_FAILED'].includes(corrupt.error));
    const locked = await new GalaxySqliteAdapter({
        databasePath: corruptPath, userDataDir: root,
        fsApi: { ...fs, promises: { ...fs.promises, copyFile: async () => { throw Object.assign(new Error('locked'), { code: 'EBUSY' }); } } },
    }).readInstalledGames();
    assert.equal(locked.status, 'failed');
});

test('Galaxy adapter inspects schema, reads only installation fields, and never writes the source database', async t => {
    const root = tempDir(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const initSqlJs = require('sql.js');
    const SQL = await initSqlJs({ locateFile: file => require.resolve(`sql.js/dist/${file}`) });
    const db = new SQL.Database();
    db.run('CREATE TABLE InstalledBaseProducts(productId INTEGER NOT NULL, installationPath TEXT NOT NULL, buildId INTEGER)');
    db.run('CREATE TABLE Products(id INTEGER PRIMARY KEY, name TEXT)');
    db.run('INSERT INTO Products VALUES (1207659001, ?)', ['Fixture Game']);
    db.run('INSERT INTO InstalledBaseProducts VALUES (1207659001, ?, 42)', [path.join(root, 'Fixture Game')]);
    const dbPath = path.join(root, 'galaxy-2.0.db');
    fs.writeFileSync(dbPath, Buffer.from(db.export())); db.close();
    const before = crypto.createHash('sha256').update(fs.readFileSync(dbPath)).digest('hex');
    const result = await new GalaxySqliteAdapter({ databasePath: dbPath, userDataDir: root, initSqlJs }).readInstalledGames();
    const after = crypto.createHash('sha256').update(fs.readFileSync(dbPath)).digest('hex');
    assert.equal(result.status, 'ready');
    assert.deepEqual(result.rows[0], { productId: '1207659001', installationPath: path.join(root, 'Fixture Game'), buildId: '42', title: 'Fixture Game' });
    assert.equal(after, before);

    fs.writeFileSync(dbPath + '-wal', Buffer.alloc(64, 1));
    const walResult = await new GalaxySqliteAdapter({ databasePath: dbPath, userDataDir: root, initSqlJs }).readInstalledGames();
    assert.equal(walResult.status, 'partial');
    assert.equal(walResult.error, 'GOG_DB_WAL_UNAPPLIED');
    assert.equal(walResult.rows.length, 1);
});

test('trusted completed Baddel record remains gogdl and weaker sources only enrich it', async t => {
    const root = tempDir(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const install = makeInstall(root);
    fs.mkdirSync(path.join(root, 'downloads'), { recursive: true });
    fs.writeFileSync(path.join(root, 'downloads', 'downloads-queue.json'), JSON.stringify({ tasks: [{
        platform: 'gog', installProvider: 'gogdl', status: 'completed', completionConfirmed: true,
        gogProductId: '1207659001', installPath: install.gameDir,
    }] }));
    const record = {
        id: 'existing', name: 'Custom Name', platform: 'gog', scannerPlatform: 'gog', installSource: 'download', installProvider: 'gogdl',
        gogProductId: '1207659001', allIds: { gog: '1207659001' }, path: install.gameDir, installPath: install.gameDir,
        executablePath: install.executablePath, favorite: true, playtime: 99,
    };
    const result = await makeScanner(root, {
        getStoredGames: () => [record],
        galaxyAdapter: { readInstalledGames: async () => ({ status: 'ready', rows: [{ productId: '1207659001', installationPath: install.gameDir }] }) },
    }).scan();
    assert.equal(result.games.length, 1);
    assert.equal(result.games[0].installProvider, 'gogdl');
    assert.equal(result.games[0].favorite, true);
    assert.equal(result.games[0].playtime, 99);
    assert.deepEqual(new Set(result.games[0].discoverySources), new Set(['baddel', 'manifest', 'galaxy']));
});

test('same title with different product IDs stays separate and same product in two paths stays separate', async t => {
    const root = tempDir(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    makeInstall(root, { folder: 'A', productId: '1207659001', name: 'Same' });
    makeInstall(root, { folder: 'B', productId: '1207659002', name: 'Same' });
    makeInstall(root, { folder: 'C', productId: '1207659001', name: 'Same' });
    const result = await makeScanner(root).scan();
    assert.equal(result.games.length, 3);
    assert.equal(new Set(result.games.map(game => game.installedGameKey)).size, 3);
});

test('folder without trustworthy GOG identity is never classified as GOG', async t => {
    const root = tempDir(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    writeFile(path.join(root, 'Copied Game', 'game.exe'), 'MZ');
    const result = await makeScanner(root).scan();
    assert.equal(result.games.length, 0);
});

test('Galaxy removal still detects intact metadata and does not infer ownership', async t => {
    const root = tempDir(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    makeInstall(root);
    const result = await makeScanner(root, {
        galaxyAdapter: { readInstalledGames: async () => ({ status: 'unavailable', rows: [] }) },
    }).scan();
    assert.equal(result.games[0].installProvider, 'gog_discovered');
    assert.equal(result.games[0].ownedByAccountIds, undefined);
    assert.match(result.games[0].command, /game\.exe"$/i);
});

test('empty authoritative scan is deletion-ready but partial Galaxy failure is not', async t => {
    const root = tempDir(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const empty = await makeScanner(root).scan();
    assert.equal(empty.games.length, 0);
    assert.equal(empty.deletionReady, true);
    const partial = await makeScanner(root, {
        galaxyAdapter: { readInstalledGames: async () => ({ status: 'failed', rows: [], error: 'LOCKED' }) },
    }).scan();
    assert.equal(partial.deletionReady, false);
});

function makeEngineWithGog(root, scanResult) {
    const engine = new BaddelEngine({
        dbFolder: root,
        driveRoots: [],
        skipMetadataServerSync: true,
        gogScanner: { scan: async () => scanResult },
        mrm: { setApi() {}, save() {}, get() { return null; } },
    });
    for (const method of ['getSteamGames', 'getEpicGames', 'getRiotGames', 'getUbisoftGames', 'getEAGames', 'getXboxGames']) {
        engine[method] = async () => [];
    }
    return engine;
}

test('authoritative empty GOG scan removes only the persisted library record', async t => {
    const root = tempDir(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const missingDir = path.join(root, 'gone');
    fs.writeFileSync(path.join(root, 'games-db.json'), JSON.stringify([{
        id: 'gog-local', name: 'Gone', platform: 'gog', scannerPlatform: 'gog', installSource: 'scanner',
        installedGameKey: 'gog:1207659001:gone', gogProductId: '1207659001', allIds: { gog: '1207659001' },
        path: missingDir, executablePath: path.join(missingDir, 'game.exe'), isInstalled: true,
    }]));
    const engine = makeEngineWithGog(root, { games: [], deletionReady: true, diagnostics: { sources: {} } });
    await engine.startGlobalScan();
    assert.equal(engine.getAllGames().length, 1);
    assert.equal(engine.getAllGames()[0].isInstalled, false);
    assert.equal(fs.existsSync(missingDir), false);
});

test('partial GOG scan never stale-removes an existing record', async t => {
    const root = tempDir(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.writeFileSync(path.join(root, 'games-db.json'), JSON.stringify([{
        id: 'gog-local', name: 'Preserved', platform: 'gog', scannerPlatform: 'gog', installSource: 'scanner',
        installedGameKey: 'gog:1207659001:gone', gogProductId: '1207659001', isInstalled: true,
    }]));
    const engine = makeEngineWithGog(root, { games: [], deletionReady: false, diagnostics: { sources: { galaxy: { status: 'failed' } } } });
    await engine.startGlobalScan();
    assert.equal(engine.getAllGames()[0].isInstalled, true);
});

test('saved GOG directory and executable preserve the record even after authoritative non-discovery', async t => {
    const root = tempDir(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const install = makeInstall(root);
    fs.writeFileSync(path.join(root, 'games-db.json'), JSON.stringify([{
        id: 'gog-local', name: 'Preserved', platform: 'gog', scannerPlatform: 'gog', installSource: 'scanner',
        installedGameKey: 'gog:1207659001:saved', gogProductId: '1207659001', path: install.gameDir,
        executablePath: install.executablePath, isInstalled: true,
    }]));
    const engine = makeEngineWithGog(root, { games: [], deletionReady: true, diagnostics: { sources: {} } });
    await engine.startGlobalScan();
    assert.equal(engine.getAllGames()[0].isInstalled, true);
    assert.equal(fs.existsSync(install.executablePath), true);
});

test('GOG upsert merges exact synced identity and preserves user state and stronger provenance', async t => {
    const root = tempDir(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const install = makeInstall(root);
    fs.writeFileSync(path.join(root, 'games-db.json'), JSON.stringify([{
        id: 'gog_1207659001', name: 'User Name', platform: 'gog', allIds: { gog: '1207659001' },
        isInstalled: false, favorite: true, totalPlaytime: 77, collections: ['Favorites'], customTitleLocked: true,
        image: 'cached-cover', installProvider: 'gogdl', installSource: 'download',
    }]));
    const engine = makeEngineWithGog(root, { games: [], deletionReady: true, diagnostics: { sources: {} } });
    await engine.upsertGame({
        id: 'gog-1207659001-path', name: 'Manifest Name', platform: 'gog', scannerPlatform: 'gog',
        allIds: { gog: '1207659001' }, gogProductId: '1207659001', path: install.gameDir, installPath: install.gameDir,
        executablePath: install.executablePath, command: `"${install.executablePath}"`, installedGameKey: 'gog:1207659001:path',
        installProvider: 'gog_discovered', installSource: 'scanner', isInstalled: true,
    });
    const stored = engine.getAllGames();
    assert.equal(stored.length, 1);
    assert.equal(stored[0].id, 'gog_1207659001');
    assert.equal(stored[0].name, 'User Name');
    assert.equal(stored[0].favorite, true);
    assert.equal(stored[0].totalPlaytime, 77);
    assert.deepEqual(stored[0].collections, ['Favorites']);
    assert.equal(stored[0].installProvider, 'gogdl');
    assert.equal(stored[0].installProvenance, 'gogdl');
    assert.equal(stored[0].isInstalled, true);
});

test('standalone and gogdl launch directly; Galaxy routing requires explicit trusted preference', () => {
    const direct = '"C:\\GOG Games\\Game\\game.exe"';
    assert.equal(resolveTrustedLaunchCommand({ installProvider: 'gog_discovered', command: direct }, { preferGalaxyLaunch: true }), direct);
    assert.equal(resolveTrustedLaunchCommand({ installProvider: 'gogdl', command: direct }, { preferGalaxyLaunch: true }), direct);
    assert.equal(resolveTrustedLaunchCommand({ installProvider: 'gog_galaxy', command: direct, galaxyLaunchCommand: 'goggalaxy://launch/1207659001' }, {}), direct);
    assert.equal(resolveTrustedLaunchCommand({ installProvider: 'gog_galaxy', command: direct, galaxyLaunchCommand: 'goggalaxy://launch/1207659001' }, { preferGalaxyLaunch: true }), 'goggalaxy://launch/1207659001');
    assert.equal(resolveTrustedLaunchCommand({ installProvider: 'gog_galaxy', command: direct, galaxyLaunchCommand: 'goggalaxy://launch/1?evil=1' }, { preferGalaxyLaunch: true }), direct);
});
