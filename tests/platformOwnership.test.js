'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

// ── Load the module in a minimal browser-like sandbox ─────────
const ROOT = path.resolve(__dirname, '..');
const src  = fs.readFileSync(path.join(ROOT, 'src/js/platformOwnership.js'), 'utf8');

function loadModule() {
    const w = { electronAPI: {} };
    // eslint-disable-next-line no-new-func
    new Function('window', src)(w);
    return w;
}

// ── Helpers ────────────────────────────────────────────────────
function makeGame(overrides = {}) {
    return { id: 'game-1', name: 'Portal 2', command: 'steam://rungameid/620', ...overrides };
}

function makeLibGame(overrides = {}) {
    return { appName: '620', title: 'Portal 2', steamLicensedAccountIds: [], ownedByAccountIds: [], ...overrides };
}

function makeSyncAccount(id, displayName = `User ${id}`) {
    return { id: String(id), displayName, avatar: null };
}

function makeSwitcherProfile(id, extra = {}) {
    return {
        id:                String(id),
        displayName:       `User ${id}`,
        username:          `user${id}`,
        avatar:            null,
        platformAccountId: String(id),
        _resolvedSyncId:   String(id),
        ...extra,
    };
}

// ── _poSteamOwnsGame ───────────────────────────────────────────
test('_poSteamOwnsGame: licensed account returns true', () => {
    const { _poSteamOwnsGame } = loadModule();
    const lg = makeLibGame({ steamLicensedAccountIds: ['111', '222'] });
    assert.equal(_poSteamOwnsGame(lg, '111'), true);
});

test('_poSteamOwnsGame: falls through to ownedByAccountIds when licensed list empty', () => {
    const { _poSteamOwnsGame } = loadModule();
    const lg = makeLibGame({ steamLicensedAccountIds: [], ownedByAccountIds: ['333'] });
    assert.equal(_poSteamOwnsGame(lg, '333'), true);
});

test('_poSteamOwnsGame: steamDetectedAccountIds is NOT ownership evidence', () => {
    const { _poSteamOwnsGame } = loadModule();
    const lg = {
        appName: '620',
        title:   'Portal 2',
        steamLicensedAccountIds: [],
        ownedByAccountIds:       [],
        steamDetectedAccountIds: ['999'],
    };
    assert.equal(_poSteamOwnsGame(lg, '999'), false);
});

test('_poSteamOwnsGame: account not in any list returns false', () => {
    const { _poSteamOwnsGame } = loadModule();
    const lg = makeLibGame({ steamLicensedAccountIds: ['111'], ownedByAccountIds: ['222'] });
    assert.equal(_poSteamOwnsGame(lg, '999'), false);
});

// ── _poEpicOwnsGame ────────────────────────────────────────────
test('_poEpicOwnsGame: account in ownedByAccountIds returns true', () => {
    const { _poEpicOwnsGame } = loadModule();
    const lg = { ownedByAccountIds: ['abc', 'def'] };
    assert.equal(_poEpicOwnsGame(lg, 'abc'), true);
});

test('_poEpicOwnsGame: account not in list returns false', () => {
    const { _poEpicOwnsGame } = loadModule();
    const lg = { ownedByAccountIds: ['abc'] };
    assert.equal(_poEpicOwnsGame(lg, 'xyz'), false);
});

// ── getEpicInstallUrl ──────────────────────────────────────────
test('getEpicInstallUrl: uses action=install not action=launch', () => {
    const { getEpicInstallUrl } = loadModule();
    const game = makeGame({ namespace: 'ns', catalogItemId: 'ci', appName: 'ap' });
    const url = getEpicInstallUrl(game);
    assert.ok(url, 'should return a URL');
    assert.match(url, /action=install/);
    assert.doesNotMatch(url, /action=launch/);
});

test('getEpicInstallUrl: returns null when no tuple fields present', () => {
    const { getEpicInstallUrl } = loadModule();
    const url = getEpicInstallUrl(makeGame());
    assert.equal(url, null);
});

test('getEpicInstallUrl: builds correct URL format', () => {
    const { getEpicInstallUrl } = loadModule();
    const game = makeGame({ namespace: 'abc', catalogItemId: 'def', appName: 'ghi' });
    const url = getEpicInstallUrl(game);
    assert.match(url, /com\.epicgames\.launcher:\/\/apps\//);
    assert.match(url, /abc.*def.*ghi/);
    assert.match(url, /silent=true/);
});

test('getEpicInstallUrl: falls back to launcherGameId colon-separated tuple', () => {
    const { getEpicInstallUrl } = loadModule();
    const game = makeGame({ launcherGameId: 'ns:ci:ap' });
    const url = getEpicInstallUrl(game);
    assert.ok(url, 'should build URL from launcherGameId');
    assert.match(url, /action=install/);
});

// ── getSteamInstallUrl ─────────────────────────────────────────
test('getSteamInstallUrl: extracts app ID from command', () => {
    const { getSteamInstallUrl } = loadModule();
    const url = getSteamInstallUrl(makeGame({ command: 'steam://rungameid/12345' }));
    assert.equal(url, 'steam://install/12345');
});

test('getSteamInstallUrl: uses allIds.steam first', () => {
    const { getSteamInstallUrl } = loadModule();
    const game = makeGame({ allIds: { steam: '99999' } });
    const url = getSteamInstallUrl(game);
    assert.equal(url, 'steam://install/99999');
});

test('getSteamInstallUrl: returns null when no app ID found', () => {
    const { getSteamInstallUrl } = loadModule();
    const url = getSteamInstallUrl({ id: 'manual', name: 'Local Game', command: '' });
    assert.equal(url, null);
});

test('getSteamInstallUrl: returns steam://install/<appid>', () => {
    const { getSteamInstallUrl } = loadModule();
    const url = getSteamInstallUrl({ id: 'steam-620', name: 'Portal 2' });
    assert.ok(url && url.startsWith('steam://install/'), `Expected steam://install/ prefix, got ${url}`);
});

test('getSteamInstallUrl: extracts appid from allIds.steam', () => {
    const { getSteamInstallUrl } = loadModule();
    const url = getSteamInstallUrl({ id: 'synced-abc', allIds: { steam: '620' } });
    assert.equal(url, 'steam://install/620');
});

test('getSteamInstallUrl: extracts appid from steam-<appid> id', () => {
    const { getSteamInstallUrl } = loadModule();
    const url = getSteamInstallUrl({ id: 'steam-620', command: '' });
    assert.equal(url, 'steam://install/620');
});

test('getSteamInstallUrl: extracts appid from steam://rungameid/<appid>', () => {
    const { getSteamInstallUrl } = loadModule();
    const url = getSteamInstallUrl({ id: 'steam-game', command: 'steam://rungameid/620' });
    assert.equal(url, 'steam://install/620');
});

test('getSteamInstallUrl: returns null for non-numeric IDs', () => {
    const { getSteamInstallUrl } = loadModule();
    const url = getSteamInstallUrl({ id: 'epic-SomeGame', appName: 'SomeGame', command: '' });
    assert.equal(url, null);
});

test('getSteamInstallUrl: extracts appid from steamAppId field', () => {
    const { getSteamInstallUrl } = loadModule();
    const url = getSteamInstallUrl({ id: 'manual', steamAppId: '730' });
    assert.equal(url, 'steam://install/730');
});

test('getSteamInstallUrl: extracts appid from appId field', () => {
    const { getSteamInstallUrl } = loadModule();
    const url = getSteamInstallUrl({ id: 'manual', appId: '440' });
    assert.equal(url, 'steam://install/440');
});

test('getSteamInstallUrl: extracts appid from appid field', () => {
    const { getSteamInstallUrl } = loadModule();
    const url = getSteamInstallUrl({ id: 'manual', appid: '570' });
    assert.equal(url, 'steam://install/570');
});

test('getSteamInstallUrl: extracts appid from steam://run/<appid>', () => {
    const { getSteamInstallUrl } = loadModule();
    const url = getSteamInstallUrl({ id: 'steam-game', command: 'steam://run/620' });
    assert.equal(url, 'steam://install/620');
});

test('_poSteamInstallCandidates: returns all candidate sources', () => {
    const { _poSteamInstallCandidates } = loadModule();
    // Use distinct appids so dedup keeps more than one entry
    const { appid, candidates } = _poSteamInstallCandidates({
        id: 'steam-111',
        allIds: { steam: '222' },
        command: 'steam://rungameid/333',
    });
    // Best (first) candidate comes from allIds.steam (priority 2 after steamAppId/steam_appid/appid)
    assert.ok(appid, 'should return a non-null appid');
    assert.ok(candidates.length >= 2, 'should have multiple distinct candidates');
});

test('getEpicInstallUrl: returns com.epicgames.launcher:// URI with action=install', () => {
    const { getEpicInstallUrl } = loadModule();
    const game = {
        id: 'epic-mygame',
        namespace: 'ns123',
        catalogItemId: 'cat456',
        appName: 'MyGame',
    };
    const url = getEpicInstallUrl(game);
    assert.ok(url, 'should return a URL');
    assert.ok(url.startsWith('com.epicgames.launcher://'), 'must use Epic protocol');
    assert.ok(url.includes('action=install'), 'must include action=install');
});

// ── _poFindLibraryGame ─────────────────────────────────────────
test('_poFindLibraryGame: finds game by Steam app ID (strong match)', () => {
    const { _poFindLibraryGame } = loadModule();
    const lib = [makeLibGame({ appName: '620' }), makeLibGame({ appName: '730', title: 'CS2' })];
    const result = _poFindLibraryGame(lib, makeGame({ command: 'steam://rungameid/620' }), 'steam');
    assert.equal(result && result.appName, '620');
});

test('_poFindLibraryGame: falls back to title match', () => {
    const { _poFindLibraryGame } = loadModule();
    const lib = [{ appName: null, title: 'Portal 2', ownedByAccountIds: [] }];
    const result = _poFindLibraryGame(lib, makeGame({ command: '' }), 'steam');
    assert.ok(result, 'should find by title');
    assert.equal(result.title, 'Portal 2');
});

test('_poFindLibraryGame: returns null for empty library', () => {
    const { _poFindLibraryGame } = loadModule();
    assert.equal(_poFindLibraryGame([], makeGame(), 'steam'), null);
});

// ── _buildAccountOptionsFromData ──────────────────────────────
test('Steam licensed account → actionStatus ready', () => {
    const { _buildAccountOptionsFromData } = loadModule();
    const game           = makeGame();
    const switcherProfiles = [makeSwitcherProfile('111')];
    const syncAccounts   = [makeSyncAccount('111')];
    const syncedLibrary  = [makeLibGame({ steamLicensedAccountIds: ['111'] })];

    const opts = _buildAccountOptionsFromData({ game, platform: 'steam', switcherProfiles, syncAccounts, syncedLibrary });
    assert.equal(opts.length, 1);
    assert.equal(opts[0].actionStatus,    'ready');
    assert.equal(opts[0].ownershipStatus, 'owned');
});

test('Steam synced account with no license → does_not_own', () => {
    const { _buildAccountOptionsFromData } = loadModule();
    const game           = makeGame();
    const switcherProfiles = [makeSwitcherProfile('111')];
    const syncAccounts   = [makeSyncAccount('111')];
    const syncedLibrary  = [makeLibGame({ steamLicensedAccountIds: ['999'] })];

    const opts = _buildAccountOptionsFromData({ game, platform: 'steam', switcherProfiles, syncAccounts, syncedLibrary });
    assert.equal(opts[0].actionStatus, 'does_not_own');
});

test('Unsynced steam account → sync_to_verify', () => {
    const { _buildAccountOptionsFromData } = loadModule();
    const opts = _buildAccountOptionsFromData({
        game: makeGame(), platform: 'steam',
        switcherProfiles: [makeSwitcherProfile('111')],
        syncAccounts:     [],
        syncedLibrary:    [makeLibGame({ steamLicensedAccountIds: ['111'] })],
    });
    assert.equal(opts[0].actionStatus, 'sync_to_verify');
});

test('steamDetectedAccountIds does NOT make account ready', () => {
    const { _buildAccountOptionsFromData } = loadModule();
    const libGame = {
        appName: '620', title: 'Portal 2',
        steamLicensedAccountIds: [],
        ownedByAccountIds:       [],
        steamDetectedAccountIds: ['111'],
    };
    const opts = _buildAccountOptionsFromData({
        game: makeGame(), platform: 'steam',
        switcherProfiles: [makeSwitcherProfile('111')],
        syncAccounts:     [makeSyncAccount('111')],
        syncedLibrary:    [libGame],
    });
    assert.notEqual(opts[0].actionStatus, 'ready');
});

test('Epic: ownedByAccountIds → ready', () => {
    const { _buildAccountOptionsFromData } = loadModule();
    const opts = _buildAccountOptionsFromData({
        game: makeGame({ name: 'Fortnite' }),
        platform: 'epic',
        switcherProfiles: [makeSwitcherProfile('ep1')],
        syncAccounts:     [makeSyncAccount('ep1', 'EpicUser')],
        syncedLibrary:    [{ title: 'Fortnite', ownedByAccountIds: ['ep1'] }],
    });
    assert.equal(opts[0].actionStatus, 'ready');
});

test('Epic: synced but not owned → does_not_own', () => {
    const { _buildAccountOptionsFromData } = loadModule();
    const opts = _buildAccountOptionsFromData({
        game: makeGame({ name: 'Fortnite' }),
        platform: 'epic',
        switcherProfiles: [makeSwitcherProfile('ep1')],
        syncAccounts:     [makeSyncAccount('ep1', 'EpicUser')],
        syncedLibrary:    [{ title: 'Fortnite', ownedByAccountIds: ['other'] }],
    });
    assert.equal(opts[0].actionStatus, 'does_not_own');
});

test('Ghost account: sync owner not in switcher → add_to_switcher', () => {
    const { _buildAccountOptionsFromData } = loadModule();
    const opts = _buildAccountOptionsFromData({
        game:            makeGame(),
        platform:        'steam',
        switcherProfiles: [],
        syncAccounts:    [makeSyncAccount('222')],
        syncedLibrary:   [makeLibGame({ steamLicensedAccountIds: ['222'] })],
    });
    assert.equal(opts.length, 1);
    assert.equal(opts[0].actionStatus,    'add_to_switcher');
    assert.equal(opts[0].enabled,         false);
    assert.equal(opts[0].notInSwitcher,   true);
});

test('Ghost: account already in switcher is NOT duplicated as ghost', () => {
    const { _buildAccountOptionsFromData } = loadModule();
    const opts = _buildAccountOptionsFromData({
        game:            makeGame(),
        platform:        'steam',
        switcherProfiles: [makeSwitcherProfile('111')],
        syncAccounts:    [makeSyncAccount('111')],
        syncedLibrary:   [makeLibGame({ steamLicensedAccountIds: ['111'] })],
    });
    assert.equal(opts.length, 1);
    assert.notEqual(opts[0].id, 'ghost-111');
});

test('Sort order: ready before sync_to_verify before does_not_own before add_to_switcher', () => {
    const { _buildAccountOptionsFromData } = loadModule();
    const opts = _buildAccountOptionsFromData({
        game: makeGame(),
        platform: 'steam',
        switcherProfiles: [
            makeSwitcherProfile('no',   { _resolvedSyncId: 'no'  }),
            makeSwitcherProfile('yes',  { _resolvedSyncId: 'yes' }),
            makeSwitcherProfile('unk'),
        ],
        syncAccounts: [
            makeSyncAccount('yes'),
            makeSyncAccount('no'),
        ],
        syncedLibrary: [makeLibGame({ steamLicensedAccountIds: ['yes'] })],
    });
    const statuses = opts.map(o => o.actionStatus);
    const readyIdx    = statuses.indexOf('ready');
    const unknownIdx  = statuses.indexOf('sync_to_verify');
    const notOwnedIdx = statuses.indexOf('does_not_own');
    assert.ok(readyIdx < unknownIdx,   'ready before sync_to_verify');
    assert.ok(unknownIdx < notOwnedIdx,'sync_to_verify before does_not_own');
});

// ── _poNormalizeProfile ────────────────────────────────────────
test('_poNormalizeProfile: steam maps steamId to id and _resolvedSyncId', () => {
    const { _poNormalizeProfile } = loadModule();
    const p = _poNormalizeProfile('steam', { steamId: '76561', username: 'gabe', displayName: 'Gabe N' });
    assert.equal(p.id,              '76561');
    assert.equal(p._resolvedSyncId, '76561');
    assert.equal(p.username,        'gabe');
});

test('_poNormalizeProfile: string input for Epic returns object', () => {
    const { _poNormalizeProfile } = loadModule();
    const p = _poNormalizeProfile('epic', 'MyProfile');
    assert.equal(p.id,          'MyProfile');
    assert.equal(p.displayName, 'MyProfile');
});

// ── enabled flag on does_not_own accounts ──────────────────────
test('does_not_own account has enabled: false', () => {
    const { _buildAccountOptionsFromData } = loadModule();
    const opts = _buildAccountOptionsFromData({
        game:             makeGame(),
        platform:         'steam',
        switcherProfiles: [makeSwitcherProfile('111')],
        syncAccounts:     [makeSyncAccount('111')],
        syncedLibrary:    [makeLibGame({ steamLicensedAccountIds: ['999'] })],
    });
    const notOwned = opts.find(o => o.actionStatus === 'does_not_own');
    assert.ok(notOwned, 'should have a does_not_own row');
    assert.equal(notOwned.enabled, false);
});

test('ready account has enabled: true', () => {
    const { _buildAccountOptionsFromData } = loadModule();
    const opts = _buildAccountOptionsFromData({
        game:             makeGame(),
        platform:         'steam',
        switcherProfiles: [makeSwitcherProfile('111')],
        syncAccounts:     [makeSyncAccount('111')],
        syncedLibrary:    [makeLibGame({ steamLicensedAccountIds: ['111'] })],
    });
    const ready = opts.find(o => o.actionStatus === 'ready');
    assert.ok(ready, 'should have a ready row');
    assert.equal(ready.enabled, true);
});

test('sync_to_verify account has enabled: true', () => {
    const { _buildAccountOptionsFromData } = loadModule();
    const opts = _buildAccountOptionsFromData({
        game:             makeGame(),
        platform:         'steam',
        switcherProfiles: [makeSwitcherProfile('111')],
        syncAccounts:     [],
        syncedLibrary:    [makeLibGame({ steamLicensedAccountIds: ['111'] })],
    });
    const stv = opts.find(o => o.actionStatus === 'sync_to_verify');
    assert.ok(stv, 'should have a sync_to_verify row');
    assert.equal(stv.enabled, true);
});

// ── Epic _poFindLibraryGame matching ──────────────────────────
test('_poFindLibraryGame: Epic matches by appName', () => {
    const { _poFindLibraryGame } = loadModule();
    const lib = [
        { appName: 'Fortnite', title: 'Fortnite', ownedByAccountIds: ['u1'] },
        { appName: 'Other',    title: 'Other',    ownedByAccountIds: [] },
    ];
    const game = makeGame({ name: 'Fortnite', appName: 'Fortnite' });
    const result = _poFindLibraryGame(lib, game, 'epic');
    assert.ok(result, 'should find by appName');
    assert.equal(result.appName, 'Fortnite');
});

test('_poFindLibraryGame: Epic matches by launcherGameId tuple (3-part colon)', () => {
    const { _poFindLibraryGame } = loadModule();
    const lib = [
        { appName: 'MyApp', title: 'My Game', launcherGameId: 'ns:ci:MyApp', ownedByAccountIds: ['u1'] },
    ];
    const game = makeGame({ name: 'My Game', launcherGameId: 'ns:ci:MyApp' });
    const result = _poFindLibraryGame(lib, game, 'epic');
    assert.ok(result, 'should find by launcherGameId tuple');
    assert.equal(result.appName, 'MyApp');
});

test('_poFindLibraryGame: Epic namespace-only does NOT match (namespace is publisher UUID)', () => {
    const { _poFindLibraryGame } = loadModule();
    const lib = [
        { appName: 'SomeOtherApp', namespace: 'abc123', title: 'Publisher Game', ownedByAccountIds: ['u1'] },
    ];
    // game has only namespace (no appName, no launcherGameId, no catalogItemId)
    const game = makeGame({ name: 'Different Game', namespace: 'abc123' });
    const result = _poFindLibraryGame(lib, game, 'epic');
    // should NOT find a match based on namespace alone — title differs
    assert.equal(result, null);
});

test('_poFindLibraryGame: Epic matches by catalogItemId when appName absent', () => {
    const { _poFindLibraryGame } = loadModule();
    const lib = [
        { appName: 'FortApp', catalogItemId: 'cat-99', title: 'Fort', ownedByAccountIds: [] },
    ];
    const game = makeGame({ name: 'Unknown', catalogItemId: 'cat-99' });
    const result = _poFindLibraryGame(lib, game, 'epic');
    assert.ok(result, 'should find by catalogItemId');
    assert.equal(result.catalogItemId, 'cat-99');
});

// ── _poRenderAccountRow: disabled row rendering ───────────────
test('_poRenderAccountRow: does_not_own row has po-row-disabled and aria-disabled', () => {
    const { _poRenderAccountRow } = loadModule();
    const option = {
        id:            'u1',
        displayName:   'Player One',
        username:      'player1',
        avatar:        null,
        actionStatus:  'does_not_own',
        ownershipStatus: 'not-owned',
        enabled:       false,
        inSwitcher:    true,
        notInSwitcher: false,
    };
    const html = _poRenderAccountRow(option, {
        idPrefix:    'test-',
        makeOnClick: (id) => `selectAccount('${id}')`,
        closeModalJs: '',
        platKey:     'epic',
        platName:    'Epic Games',
        platAccent:  '#0078f2',
    });
    assert.match(html,   /po-row-disabled/);
    assert.match(html,   /aria-disabled="true"/);
    assert.doesNotMatch(html, /onclick=/);
});

// ── mode='details' isolation ──────────────────────────────────
test('details mode: returns only synced accounts', () => {
    const { _buildAccountOptionsFromData } = loadModule();
    const opts = _buildAccountOptionsFromData({
        game:             makeGame(),
        platform:         'steam',
        mode:             'details',
        switcherProfiles: [makeSwitcherProfile('synced'), makeSwitcherProfile('unsynced')],
        syncAccounts:     [makeSyncAccount('synced')],
        syncedLibrary:    [makeLibGame({ steamLicensedAccountIds: ['synced'] })],
    });
    assert.ok(opts.every(o => o.isSynced), 'all returned rows must be synced');
    assert.ok(opts.every(o => o.id !== 'unsynced'), 'unsynced switcher account must be excluded');
});

test('details mode: never returns sync_to_verify', () => {
    const { _buildAccountOptionsFromData } = loadModule();
    const opts = _buildAccountOptionsFromData({
        game:             makeGame(),
        platform:         'steam',
        mode:             'details',
        switcherProfiles: [makeSwitcherProfile('a'), makeSwitcherProfile('b')],
        syncAccounts:     [makeSyncAccount('a')],
        syncedLibrary:    [makeLibGame({ steamLicensedAccountIds: ['a'] })],
    });
    assert.ok(opts.every(o => o.actionStatus !== 'sync_to_verify'), 'no sync_to_verify in details mode');
});

test('details mode: excludes switcher-only accounts (not in syncAccounts)', () => {
    const { _buildAccountOptionsFromData } = loadModule();
    const opts = _buildAccountOptionsFromData({
        game:             makeGame(),
        platform:         'steam',
        mode:             'details',
        switcherProfiles: [makeSwitcherProfile('switcher-only')],
        syncAccounts:     [],
        syncedLibrary:    [makeLibGame({ steamLicensedAccountIds: [] })],
    });
    assert.equal(opts.length, 0, 'switcher-only account must not appear in details mode');
});

test('play mode: switcher-only account appears as sync_to_verify', () => {
    const { _buildAccountOptionsFromData } = loadModule();
    const opts = _buildAccountOptionsFromData({
        game:             makeGame(),
        platform:         'steam',
        mode:             'play',
        switcherProfiles: [makeSwitcherProfile('switcher-only')],
        syncAccounts:     [],
        syncedLibrary:    [makeLibGame({ steamLicensedAccountIds: [] })],
    });
    const stv = opts.find(o => o.id === 'switcher-only');
    assert.ok(stv, 'switcher-only account must appear in play mode');
    assert.equal(stv.actionStatus, 'sync_to_verify');
});

// ── details mode — synced accounts regardless of switcher presence ─────────
test('details mode: includes synced account that is NOT in switcher', () => {
    const { _buildAccountOptionsFromData } = loadModule();
    const opts = _buildAccountOptionsFromData({
        game:             makeGame(),
        platform:         'steam',
        mode:             'details',
        switcherProfiles: [],                                  // account NOT in switcher
        syncAccounts:     [makeSyncAccount('sa1')],
        syncedLibrary:    [makeLibGame({ steamLicensedAccountIds: ['sa1'] })],
    });
    assert.equal(opts.length, 1);
    assert.equal(opts[0].id,           'sa1');
    assert.equal(opts[0].actionStatus, 'ready');
    assert.equal(opts[0].inSwitcher,   false);
});

test('details mode: includes synced account that IS in switcher', () => {
    const { _buildAccountOptionsFromData } = loadModule();
    const opts = _buildAccountOptionsFromData({
        game:             makeGame(),
        platform:         'steam',
        mode:             'details',
        switcherProfiles: [makeSwitcherProfile('sa2')],
        syncAccounts:     [makeSyncAccount('sa2')],
        syncedLibrary:    [makeLibGame({ steamLicensedAccountIds: ['sa2'] })],
    });
    assert.equal(opts.length, 1);
    assert.equal(opts[0].id,           'sa2');
    assert.equal(opts[0].actionStatus, 'ready');
    assert.equal(opts[0].inSwitcher,   true);
});

test('details mode: excludes switcher-only account (not in syncAccounts)', () => {
    const { _buildAccountOptionsFromData } = loadModule();
    const opts = _buildAccountOptionsFromData({
        game:             makeGame(),
        platform:         'steam',
        mode:             'details',
        switcherProfiles: [makeSwitcherProfile('sa3'), makeSwitcherProfile('sw-only')],
        syncAccounts:     [makeSyncAccount('sa3')],
        syncedLibrary:    [makeLibGame({ steamLicensedAccountIds: ['sa3'] })],
    });
    assert.ok(!opts.find(o => o.id === 'sw-only'), 'switcher-only must not appear');
    assert.equal(opts.length, 1);
});

test('details mode: never returns sync_to_verify', () => {
    const { _buildAccountOptionsFromData } = loadModule();
    const opts = _buildAccountOptionsFromData({
        game:             makeGame(),
        platform:         'steam',
        mode:             'details',
        switcherProfiles: [makeSwitcherProfile('sa4')],
        syncAccounts:     [makeSyncAccount('sa4')],
        syncedLibrary:    [makeLibGame({ steamLicensedAccountIds: ['sa4'] })],
    });
    assert.ok(opts.every(o => o.actionStatus !== 'sync_to_verify'), 'no sync_to_verify allowed');
});

test('details mode: never returns add_to_switcher (synced non-switcher owner shows ready)', () => {
    const { _buildAccountOptionsFromData } = loadModule();
    // sa5 owns the game but is NOT in the switcher — old code made this add_to_switcher
    const opts = _buildAccountOptionsFromData({
        game:             makeGame(),
        platform:         'steam',
        mode:             'details',
        switcherProfiles: [],
        syncAccounts:     [makeSyncAccount('sa5')],
        syncedLibrary:    [makeLibGame({ steamLicensedAccountIds: ['sa5'] })],
    });
    assert.ok(opts.every(o => o.actionStatus !== 'add_to_switcher'), 'no add_to_switcher allowed');
    assert.equal(opts[0].actionStatus, 'ready');
});

// ── Sync snapshot — prevent status degradation on transient empty fetch ──────

test('(A) buildPlatformAccountOptions: uses fresh sync data and marks account ready', async () => {
    const w = {
        electronAPI: {
            getEpicProfiles:         () => Promise.resolve([{ id: 'ep1', displayName: 'Player1' }]),
            platformSyncGetAccounts: () => Promise.resolve({ accounts: [{ id: 'ep1', displayName: 'Player1' }] }),
            platformSyncGetCached:   () => Promise.resolve({ games: [{ title: 'Fort', ownedByAccountIds: ['ep1'] }] }),
        },
    };
    new Function('window', src)(w);
    const opts = await w.buildPlatformAccountOptions({ game: { id: 'g1', name: 'Fort' }, platform: 'epic', mode: 'play' });
    const row = opts.find(o => o.id === 'ep1');
    assert.ok(row, 'account must appear');
    assert.equal(row.actionStatus, 'ready');
    assert.equal(w._poLastBuildDebug.usedLastGood, false);
});

test('(B) buildPlatformAccountOptions: falls back to last-good snapshot when fetch returns empty', async () => {
    let useGoodData = true;
    const w = {
        electronAPI: {
            getEpicProfiles:         () => Promise.resolve([{ id: 'ep1', displayName: 'Player1' }]),
            platformSyncGetAccounts: () => Promise.resolve(useGoodData
                ? { accounts: [{ id: 'ep1', displayName: 'Player1' }] }
                : { accounts: [] }),
            platformSyncGetCached:   () => Promise.resolve(useGoodData
                ? { games: [{ title: 'Fort', ownedByAccountIds: ['ep1'] }] }
                : { games: [] }),
        },
    };
    new Function('window', src)(w);
    const game = { id: 'g1', name: 'Fort' };
    // First call — good data populates the snapshot
    await w.buildPlatformAccountOptions({ game, platform: 'epic', mode: 'play' });
    // Second call — empty data, must use snapshot
    useGoodData = false;
    const opts2 = await w.buildPlatformAccountOptions({ game, platform: 'epic', mode: 'play' });
    const row = opts2.find(o => o.id === 'ep1');
    assert.ok(row, 'account must still appear after empty fetch');
    assert.equal(row.actionStatus, 'ready', 'must still be ready via snapshot');
    assert.equal(w._poLastBuildDebug.usedLastGood, true);
});

test('(C) buildPlatformAccountOptions: no snapshot, empty fetch → sync_to_verify', async () => {
    const w = {
        electronAPI: {
            getEpicProfiles:         () => Promise.resolve([{ id: 'ep1', displayName: 'Player1' }]),
            platformSyncGetAccounts: () => Promise.resolve({ accounts: [] }),
            platformSyncGetCached:   () => Promise.resolve({ games: [] }),
        },
    };
    new Function('window', src)(w);
    const opts = await w.buildPlatformAccountOptions({ game: { id: 'g1', name: 'Fort' }, platform: 'epic', mode: 'play' });
    const row = opts.find(o => o.id === 'ep1');
    assert.ok(row, 'switcher account must appear');
    assert.equal(row.actionStatus, 'sync_to_verify', 'must be sync_to_verify with no snapshot');
    assert.equal(w._poLastBuildDebug.usedLastGood, false);
    assert.equal(w._poLastBuildDebug.usedAccountsCount, 0);
});

test('(D) synced account never becomes sync_to_verify (even with empty syncedLibrary)', () => {
    const { _buildAccountOptionsFromData } = loadModule();
    const opts = _buildAccountOptionsFromData({
        game:             makeGame(),
        platform:         'steam',
        mode:             'play',
        switcherProfiles: [makeSwitcherProfile('sa1')],
        syncAccounts:     [makeSyncAccount('sa1')],
        syncedLibrary:    [],
    });
    const row = opts.find(o => o.id === 'sa1');
    assert.ok(row, 'synced account must appear');
    assert.notEqual(row.actionStatus, 'sync_to_verify', 'a synced account must never be sync_to_verify');
});

// ── _poSameAccount / deduplication ────────────────────────────
test('dedup: Steam switcher steamId matches sync account with same id', () => {
    const { _poSameAccount } = loadModule();
    const sw   = { steamId: '76561111', displayName: 'Gabe' };
    const sync = { id: '76561111',       displayName: 'Gabe N' };
    assert.equal(_poSameAccount('steam', sw, sync), true);
});

test('dedup: Steam switcher username matches sync account displayName', () => {
    const { _poSameAccount } = loadModule();
    const sw   = { id: 'sw-x', username: 'gaben' };
    const sync = { id: 'sy-y', displayName: 'gaben' };
    assert.equal(_poSameAccount('steam', sw, sync), true);
});

test('dedup: Epic switcher and sync same id become one row', () => {
    const { _buildAccountOptionsFromData } = loadModule();
    const opts = _buildAccountOptionsFromData({
        game:             makeGame({ name: 'Fortnite' }),
        platform:         'epic',
        mode:             'play',
        switcherProfiles: [makeSwitcherProfile('ep-1')],
        syncAccounts:     [makeSyncAccount('ep-1', 'EpicUser')],
        syncedLibrary:    [{ title: 'Fortnite', ownedByAccountIds: ['ep-1'] }],
    });
    const acctRows = opts.filter(o => o.actionStatus !== 'add_to_switcher');
    assert.equal(acctRows.length, 1, 'same account must not be duplicated');
    assert.equal(acctRows[0].actionStatus, 'ready');
});

test('dedup: Epic switcher and sync match via displayName fallback become one row', () => {
    const { _buildAccountOptionsFromData } = loadModule();
    const opts = _buildAccountOptionsFromData({
        game:             makeGame({ name: 'Fort' }),
        platform:         'epic',
        mode:             'play',
        switcherProfiles: [makeSwitcherProfile('sw-id', { displayName: 'EpicGamer', _resolvedSyncId: null, platformAccountId: null })],
        syncAccounts:     [{ id: 'sync-id', displayName: 'EpicGamer', avatar: null }],
        syncedLibrary:    [{ title: 'Fort', ownedByAccountIds: ['sync-id'] }],
    });
    const nonGhost = opts.filter(o => o.inSwitcher);
    assert.equal(nonGhost.length, 1, 'displayName match must produce one merged row');
    assert.equal(nonGhost[0].actionStatus, 'ready');
});

test('dedup: synced owner not in switcher creates exactly one add_to_switcher row', () => {
    const { _buildAccountOptionsFromData } = loadModule();
    const opts = _buildAccountOptionsFromData({
        game:             makeGame(),
        platform:         'steam',
        mode:             'play',
        switcherProfiles: [],
        syncAccounts:     [makeSyncAccount('ghost-owner')],
        syncedLibrary:    [makeLibGame({ steamLicensedAccountIds: ['ghost-owner'] })],
    });
    const ghosts = opts.filter(o => o.actionStatus === 'add_to_switcher');
    assert.equal(ghosts.length, 1, 'exactly one ghost row');
    assert.equal(ghosts[0].syncAccountId, 'ghost-owner');
});

test('dedup: switcher-only account appears as sync_to_verify in play/install mode', () => {
    const { _buildAccountOptionsFromData } = loadModule();
    const opts = _buildAccountOptionsFromData({
        game:             makeGame(),
        platform:         'steam',
        mode:             'play',
        switcherProfiles: [makeSwitcherProfile('sw-only')],
        syncAccounts:     [],
        syncedLibrary:    [makeLibGame({ steamLicensedAccountIds: [] })],
    });
    const row = opts.find(o => o.id === 'sw-only');
    assert.ok(row, 'switcher-only must appear');
    assert.equal(row.actionStatus, 'sync_to_verify');
    assert.equal(row.enabled, true, 'sync_to_verify must be selectable');
});

test('dedup: synced non-owner appears as does_not_own with enabled false', () => {
    const { _buildAccountOptionsFromData } = loadModule();
    const opts = _buildAccountOptionsFromData({
        game:             makeGame(),
        platform:         'steam',
        mode:             'play',
        switcherProfiles: [makeSwitcherProfile('syn-no')],
        syncAccounts:     [makeSyncAccount('syn-no')],
        syncedLibrary:    [makeLibGame({ steamLicensedAccountIds: ['other-999'] })],
    });
    const row = opts.find(o => o.id === 'syn-no');
    assert.ok(row, 'does_not_own row must exist');
    assert.equal(row.actionStatus, 'does_not_own');
    assert.equal(row.enabled, false);
});

test('default selection: prefers ready over sync_to_verify, never picks does_not_own', () => {
    const { _buildAccountOptionsFromData } = loadModule();
    const opts = _buildAccountOptionsFromData({
        game:             makeGame(),
        platform:         'steam',
        mode:             'play',
        switcherProfiles: [
            makeSwitcherProfile('no',  { _resolvedSyncId: 'no'  }),
            makeSwitcherProfile('yes', { _resolvedSyncId: 'yes' }),
            makeSwitcherProfile('unk'),
        ],
        syncAccounts:     [makeSyncAccount('yes'), makeSyncAccount('no')],
        syncedLibrary:    [makeLibGame({ steamLicensedAccountIds: ['yes'] })],
    });
    // Simulate the install picker selection logic
    const firstOwned      = opts.find(o => o.actionStatus === 'ready'  && !o.notInSwitcher);
    const firstSelectable = opts.find(o => o.enabled === true           && !o.notInSwitcher);
    const selected = firstOwned || firstSelectable;
    assert.ok(selected, 'must select something');
    assert.equal(selected.actionStatus, 'ready',       'must select the ready account first');
    assert.notEqual(selected.actionStatus, 'does_not_own', 'must never auto-select does_not_own');
});

test('_poRenderAccountRow: ready row has onclick and no po-row-disabled', () => {
    const { _poRenderAccountRow } = loadModule();
    const option = {
        id:            'u2',
        displayName:   'Player Two',
        username:      'player2',
        avatar:        null,
        actionStatus:  'ready',
        ownershipStatus: 'owned',
        enabled:       true,
        inSwitcher:    true,
        notInSwitcher: false,
    };
    const html = _poRenderAccountRow(option, {
        idPrefix:    'test-',
        makeOnClick: (id) => `selectAccount('${id}')`,
        closeModalJs: '',
        platKey:     'steam',
        platName:    'Steam',
        platAccent:  '#1b2838',
    });
    assert.match(html, /onclick=/);
    assert.doesNotMatch(html, /po-row-disabled/);
    assert.doesNotMatch(html, /aria-disabled/);
});
