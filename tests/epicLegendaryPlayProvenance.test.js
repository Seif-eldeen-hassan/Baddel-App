'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { DownloadCompletionLibraryRegistrar } = require('../src/features/downloads/infrastructure/services/DownloadCompletionLibraryRegistrar');

// Real EP3 identity shape; account and filesystem values are anonymized.
const installed = {
    id: 'epic_d86f9cb568014746a15f66025dcc5733', name: '3 out of 10, EP 3: "Pivot Like A Champion"',
    platform: 'epic', source: 'epic', scannerPlatform: 'epic', installProvider: 'legendary',
    installedByAccountId: 'owner-red', appName: 'd86f9cb568014746a15f66025dcc5733',
    providerAppName: 'd86f9cb568014746a15f66025dcc5733', launcherGameId: 'c647731680bf427ca0d3f9fa41e5fed4',
    path: 'D:\\Games\\EP3', installPath: 'D:\\Games\\EP3', executablePath: 'D:\\Games\\EP3\\ThreeTen.exe',
    command: '"D:\\Games\\EP3\\ThreeTen.exe"', ownedByAccountIds: ['owner-red'], isInstalled: true, buildId: 'build-ep3',
};
const owner = { id: 'owner-red', displayName: 'Red . Vlad', ownsGame: true, enabled: true, actionStatus: 'ready', inSwitcher: false, notInSwitcher: true };

function harness({ records = [installed], options = [owner], profiles = [], launchResult = { status: 'success' }, optionBuilder = true } = {}) {
    const calls = { launch: [], switchEpic: [], switchSteam: [], profiles: 0, modal: 0, accountPicker: 0, local: [], toast: [], owners: 0 };
    const context = {
        console, performance, setTimeout: callback => { callback(); return 1; }, clearTimeout() {},
        localStorage: { getItem: () => null }, allGamesData: records,
        document: { addEventListener() {}, removeEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
        showToast: message => calls.toast.push(message),
        _poNormalizeProfile: (_platform, profile) => profile,
        buildPlatformAccountOptions: async () => [{ id: 'profile', username: 'profile', displayName: 'Profile', platformAccountId: 'profile', inSwitcher: true, enabled: true, actionStatus: 'ready' }],
        buildDirectEpicInstallAccountOptions: async () => { calls.owners++; return options; },
        _gdLaunchOptionLabel: () => 'Play with Epic', _gdFindInstalledLocalMatch: () => records[0],
        _agFindInstalledLocalMatches: () => records,
        electronAPI: {
            getEpicProfiles: async () => { calls.profiles++; return profiles; },
            getSteamAccounts: async () => profiles,
            platformSyncGetAccounts: async () => ({ accounts: [{ id: 'profile', displayName: 'Profile' }] }),
            platformSyncGetCached: async () => ({ games: [{ title: installed.name, appName: installed.appName, ownedByAccountIds: ['profile'], steamLicensedAccountIds: ['profile'] }] }),
            switchEpic: async id => calls.switchEpic.push(id), switchSteam: async id => calls.switchSteam.push(id),
            minimizeApp() {}, downloads: { launchEpicLegendary: async (...args) => { calls.launch.push(args); return launchResult; } },
        },
    };
    context.window = context;
    vm.createContext(context);
    if (optionBuilder) {
        const details = fs.readFileSync(path.join(__dirname, '../src/js/game-details.js'), 'utf8');
        vm.runInContext(details.slice(details.indexOf('function _gdBuildLaunchOptions(game)'), details.indexOf('window._gdBuildLaunchOptions = _gdBuildLaunchOptions;')) + 'window._gdBuildLaunchOptions = _gdBuildLaunchOptions;', context);
    }
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/js/play-launcher.js'), 'utf8'), context);
    context._plBuildModal = () => { calls.modal++; };
    context._plShowModal = () => {};
    context._plLoadAccounts = async () => { calls.accountPicker++; };
    context._plDoActualLaunch = async (game, executor) => { if (executor) { try { await executor(); } catch (error) { calls.toast.push(error.message); } } else calls.local.push(game.id); };
    return { context, calls };
}

test('real installed record retains provenance and legacy owner through launch option projection', () => {
    const { context } = harness();
    const option = context._gdBuildLaunchOptions(installed)[0];
    assert.equal(option.installProvider, 'legendary');
    assert.equal(option.accountId, 'owner-red');
    assert.equal(option.installedByAccountId, 'owner-red');
    assert.equal(option.installPath, installed.installPath);
    assert.equal(option.providerAppName, installed.appName);
    assert.equal(option.buildId, installed.buildId);
});

test('catalog duplicate with the same installed ID cannot mask local Legendary provenance', () => {
    const { context } = harness();
    const catalog = { id: installed.id, name: installed.name, platform: 'epic', path: installed.path, appName: installed.appName };
    const options = context._gdBuildLaunchOptions(catalog);
    assert.equal(options.length, 1);
    assert.equal(options[0].installProvider, 'legendary');
    assert.equal(options[0].accountId, 'owner-red');
    const official = context._gdBuildLaunchOptions({ ...catalog, installProvider: 'epic_launcher' });
    assert.notEqual(official[0].installProvider, 'legendary', 'explicit official-launcher provenance must not be overridden');
});

test('canonical managed projection launches the concrete installed ID instead of its catalog ID', async () => {
    const canonical = {
        ...installed,
        id: 'epic-canonical-catalog-id',
        installedId: installed.id,
        localGameId: installed.id,
        installSource: 'download',
        installProvider: 'legendary',
    };
    const { context, calls } = harness({ records: [installed] });
    await context.openPlayLauncher(canonical);
    assert.deepEqual(calls.launch, [[installed.id, 'owner-red']]);
    assert.equal(calls.modal, 0);
    assert.deepEqual(calls.switchEpic, []);
});

test('managed download task identity reaches Legendary and bypasses external Epic routing', async () => {
    const managed = { ...installed, installSource: 'download', managedDownloadTaskId: 'dl_1111111111111111' };
    const { context, calls } = harness({ records: [managed] });
    await context.openPlayLauncher(managed);
    assert.deepEqual(calls.launch, [[managed.id, 'owner-red', managed.managedDownloadTaskId]]);
    assert.equal(calls.modal, 0);
    assert.equal(calls.accountPicker, 0);
    assert.deepEqual(calls.switchEpic, []);
});

for (const count of [1]) test(`${count} synced owners: original install owner launches without Switcher or a modal`, async () => {
    const options = count === 1 ? [owner] : [{ ...owner, id: 'other-owner' }, owner];
    const { context, calls } = harness({ options, profiles: [{ id: 'wrong-switcher', displayName: 'Wrong profile' }] });
    await context.openPlayLauncher(installed);
    assert.deepEqual(calls.launch, [[installed.id, 'owner-red']]);
    assert.equal(calls.profiles, 0);
    assert.equal(calls.modal, 0);
    assert.equal(calls.accountPicker, 0);
    assert.deepEqual(calls.switchEpic, []);
    assert.deepEqual(calls.local, []);
});

test('Legendary owner can launch without a Switcher profile or the optional option builder', async () => {
    const { context, calls } = harness({ optionBuilder: false });
    await context.openPlayLauncher(installed);
    assert.deepEqual(calls.launch, [[installed.id, 'owner-red']]);
    assert.equal(calls.profiles, 0);
});

test('expired direct auth produces a reconnect error and never falls back to Switcher', async () => {
    const { context, calls } = harness({ launchResult: { status: 'error', code: 'EPIC_AUTH_REQUIRED', message: 'Session expired' } });
    await context.openPlayLauncher(installed);
    assert.match(calls.toast.join(' '), /Reconnect Epic account/i);
    assert.deepEqual(calls.switchEpic, []);
    assert.equal(calls.profiles, 0);
});

test('one eligible alternate owner launches directly when original owner needs reauth', async () => {
    const { context, calls } = harness({ options: [{ ...owner, enabled: false, actionStatus: 'reconnect', needsReauth: true }, { ...owner, id: 'other' }] });
    await context.openPlayLauncher(installed);
    assert.deepEqual(calls.launch, [[installed.id, 'other']]);
    assert.equal(calls.profiles, 0);
    assert.equal(calls.accountPicker, 0);
});

for (const platform of ['epic', 'steam', 'gog']) test(`${platform} non-Legendary Play retains the existing route`, async () => {
    const game = { ...installed, id: platform + '-normal', platform, scannerPlatform: platform, installProvider: platform === 'epic' ? 'epic_launcher' : platform };
    const { context, calls } = harness({ records: [game], profiles: [{ id: 'profile', username: 'profile', displayName: 'Profile', platformAccountId: 'profile', steamId: platform === 'steam' ? 'profile' : undefined }] });
    await context.openPlayLauncher(game);
    assert.equal(calls.launch.length, 0);
    assert.equal(calls.owners, 0);
    assert.equal(calls.local.length, 1, JSON.stringify(calls));
    if (platform === 'epic') assert.deepEqual(calls.switchEpic, ['Profile']);
    if (platform === 'steam') assert.deepEqual(calls.switchSteam, ['profile']);
});

test('registration and library reload retain the canonical original Epic install owner', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-epic-owner-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const exe = path.join(root, 'Game.exe'); fs.writeFileSync(exe, 'fixture');
    const dbPath = path.join(root, 'games.json'); let games = [];
    const api = { getAllGames: () => games, getSavedGames: () => games,
        async upsertGame(game) { games = [game]; }, saveDatabase() { fs.writeFileSync(dbPath, JSON.stringify(games)); }, async flushDatabase() {} };
    const registrar = new DownloadCompletionLibraryRegistrar({ gamesApi: api });
    const task = { ...installed, id: 'dl_aaaaaaaaaaaaaaaa', gameId: installed.id, title: installed.name, accountId: 'owner-red', accountDisplayName: 'Red . Vlad', installPath: root };
    await registrar.registerCompletedDownload(task, { buildId: 'build', verification: { executablePath: exe } });
    games = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    assert.equal(games[0].installProvider, 'legendary');
    assert.equal(games[0].platform, 'epic');
    assert.equal(games[0].accountId, 'owner-red');
    assert.equal(games[0].accountDisplayName, 'Red . Vlad');
    await registrar.registerCompletedDownload({ ...task, accountId: 'other', accountDisplayName: 'Other' }, { verification: { executablePath: exe } });
    assert.equal(games[0].accountId, 'owner-red');
    assert.equal(games[0].accountDisplayName, 'Red . Vlad');
});
