const test = require('node:test');
const assert = require('node:assert/strict');
const {
    orderAccountsForSync,
    countGamesForAccount,
    finalizeLibraryForAccounts,
    removeAccountFromLibrary,
    computeSteamSyncMessage,
    computeTerminalAccountStatus,
    TRANSIENT_SYNC_STATUSES,
    isFabOrMarketplaceEntry,
    isEpicNonGameAssetEntry,
    isEpicPositiveGameEntry,
    classifyEpicEntry,
    isEpicPlayableGameEntry,
    isEpicSyncedGameAllowed,
    resolveEpicAccountIdentity,
} = require('../platformSyncShared');

test('orderAccountsForSync prioritizes the active session account', () => {
    const accounts = [
        { id: '111', displayName: 'first' },
        { id: '222', displayName: 'second' },
        { id: '333', displayName: 'third' },
    ];

    const ordered = orderAccountsForSync(accounts, '222');

    assert.deepEqual(ordered.map((account) => account.id), ['222', '111', '333']);
});

test('countGamesForAccount reads Steam licensed ids and falls back to ownedBy ids', () => {
    const games = [
        { id: 'steam_1', steamLicensedAccountIds: ['1'], ownedByAccountIds: ['1'] },
        { id: 'steam_2', steamLicensedAccountIds: [], ownedByAccountIds: ['1'] },
        { id: 'steam_3', steamLicensedAccountIds: ['2'], ownedByAccountIds: ['2'] },
    ];

    assert.equal(countGamesForAccount('steam', games, '1'), 2);
    assert.equal(countGamesForAccount('steam', games, '2'), 1);
});

test('countGamesForAccount reads locally detected Steam ids when owned ids are missing', () => {
    const games = [
        { id: 'steam_install_only', steamLicensedAccountIds: [], ownedByAccountIds: [], steamDetectedAccountIds: ['solo'] },
        { id: 'steam_other', steamLicensedAccountIds: [], ownedByAccountIds: [], steamDetectedAccountIds: ['other'] },
    ];

    assert.equal(countGamesForAccount('steam', games, 'solo'), 1);
    assert.equal(countGamesForAccount('steam', games, 'other'), 1);
    assert.equal(countGamesForAccount('steam', games, 'missing'), 0);
});

test('finalizeLibraryForAccounts preserves cached Steam ownership when a synced account unexpectedly returns zero games', () => {
    const accounts = [
        { id: 'a1', displayName: 'primary' },
        { id: 'a2', displayName: 'secondary' },
    ];
    const previousGames = [
        {
            id: 'steam_10',
            title: 'Old Shared Game',
            ownedBy: ['secondary'],
            ownedByAccountIds: ['a2'],
            steamLicensedAccountIds: ['a2'],
        },
        {
            id: 'steam_20',
            title: 'Primary Game',
            ownedBy: ['primary'],
            ownedByAccountIds: ['a1'],
            steamLicensedAccountIds: ['a1'],
        },
    ];
    const nextGames = [
        {
            id: 'steam_20',
            title: 'Primary Game',
            ownedBy: ['primary'],
            ownedByAccountIds: ['a1'],
            steamLicensedAccountIds: ['a1'],
        },
    ];

    const finalized = finalizeLibraryForAccounts({
        platform: 'steam',
        previousGames,
        nextGames,
        accounts,
        accountResults: {
            a1: { status: 'success', rawGamesCount: 1, allowZeroGames: false },
            a2: { status: 'warning', rawGamesCount: 0, validationFailed: true, allowZeroGames: false },
        },
    });

    assert.equal(finalized.validation.countsByAccount.a2, 1);
    assert.equal(finalized.games.length, 2);
    assert.ok(finalized.validation.issues.some((issue) => issue.includes('secondary')));
});

test('finalizeLibraryForAccounts keeps legitimate zero-game new accounts without restoring stale data', () => {
    const accounts = [{ id: 'fresh', displayName: 'fresh' }];

    const finalized = finalizeLibraryForAccounts({
        platform: 'steam',
        previousGames: [],
        nextGames: [],
        accounts,
        accountResults: {
            fresh: { status: 'success', rawGamesCount: 0, allowZeroGames: true },
        },
    });

    assert.equal(finalized.games.length, 0);
    assert.equal(finalized.validation.countsByAccount.fresh, 0);
    assert.equal(finalized.validation.issues.length, 0);
});

test('finalizeLibraryForAccounts preserves Epic cached games for failed accounts', () => {
    const accounts = [{ id: 'epic-1', displayName: 'Epic User' }];
    const previousGames = [
        {
            id: 'epic_game',
            title: 'Epic Game',
            ownedBy: ['Epic User'],
            ownedByAccountIds: ['epic-1'],
        },
    ];

    const finalized = finalizeLibraryForAccounts({
        platform: 'epic',
        previousGames,
        nextGames: [],
        accounts,
        accountResults: {
            'epic-1': { status: 'error', rawGamesCount: 0, validationFailed: true, allowZeroGames: false },
        },
    });

    assert.equal(finalized.games.length, 1);
    assert.equal(finalized.validation.countsByAccount['epic-1'], 1);
});

test('removeAccountFromLibrary only removes the selected Steam account data', () => {
    const games = [
        {
            id: 'steam_shared',
            title: 'Shared',
            ownedBy: ['Primary', 'Secondary'],
            ownedByAccountIds: ['a1', 'a2'],
            steamLicensedAccountIds: ['a1', 'a2'],
            steamDetectedAccountIds: [],
        },
        {
            id: 'steam_secondary_only',
            title: 'Secondary Only',
            ownedBy: ['Secondary'],
            ownedByAccountIds: ['a2'],
            steamLicensedAccountIds: ['a2'],
            steamDetectedAccountIds: [],
        },
    ];

    const filtered = removeAccountFromLibrary('steam', games, { id: 'a2', displayName: 'Secondary' });

    assert.equal(filtered.length, 1);
    assert.deepEqual(filtered[0].ownedBy, ['Primary']);
    assert.deepEqual(filtered[0].ownedByAccountIds, ['a1']);
    assert.deepEqual(filtered[0].steamLicensedAccountIds, ['a1']);
});

test('removeAccountFromLibrary drops Epic games owned only by the removed account', () => {
    const games = [
        {
            id: 'epic_shared',
            title: 'Shared',
            ownedBy: ['One', 'Two'],
            ownedByAccountIds: ['1', '2'],
        },
        {
            id: 'epic_two_only',
            title: 'Two Only',
            ownedBy: ['Two'],
            ownedByAccountIds: ['2'],
        },
    ];

    const filtered = removeAccountFromLibrary('epic', games, { id: '2', displayName: 'Two' });

    assert.equal(filtered.length, 1);
    assert.deepEqual(filtered[0].ownedBy, ['One']);
    assert.deepEqual(filtered[0].ownedByAccountIds, ['1']);
});

// ─── Epic non-game filter tests ────────────────────────────────────────────────

test('isFabOrMarketplaceEntry: exact "fab" app_name is rejected', () => {
    const entry = { app_name: 'fab', app_title: 'Fab', metadata: { namespace: 'fab' } };
    assert.equal(isFabOrMarketplaceEntry(entry), true);
    assert.equal(isEpicPlayableGameEntry(entry), false);
});

test('isFabOrMarketplaceEntry: "Fab Marketplace" title is rejected', () => {
    const entry = {
        app_name: 'fab-marketplace',
        app_title: 'Fab Marketplace',
        metadata: { customAttributes: { productType: { value: 'marketplace' } } },
    };
    assert.equal(isFabOrMarketplaceEntry(entry), true);
    assert.equal(isEpicPlayableGameEntry(entry), false);
});

test('isFabOrMarketplaceEntry: "Fab UE Plugin" with productType plugin is rejected', () => {
    const entry = {
        app_name: 'fab-plugin',
        app_title: 'Fab UE Plugin',
        metadata: { productType: 'plugin', namespace: 'fab' },
    };
    assert.equal(isFabOrMarketplaceEntry(entry), true);
    assert.equal(isEpicPlayableGameEntry(entry), false);
});

test('isFabOrMarketplaceEntry: "Unreal Engine Marketplace" namespace is rejected', () => {
    const entry = {
        app_name: 'ue-marketplace',
        app_title: 'Some Asset Pack',
        namespace: 'unreal engine marketplace',
    };
    assert.equal(isFabOrMarketplaceEntry(entry), true);
});

test('isEpicPlayableGameEntry: normal Epic game (Control) is accepted', () => {
    const entry = {
        app_name:   'calluna',
        app_title:  'Control',
        executable: 'Control.exe',
        metadata:   { namespace: 'calluna' },
    };
    assert.equal(isFabOrMarketplaceEntry(entry), false);
    assert.equal(isEpicPlayableGameEntry(entry), true);
});

test('isEpicPlayableGameEntry: "Fable" is NOT blocked — "fab" is not a whole word in "fable"', () => {
    const entry = {
        app_name:   'fable-game',
        app_title:  'Fable',
        executable: 'Fable.exe',
        metadata:   { namespace: 'fable' },
    };
    assert.equal(isFabOrMarketplaceEntry(entry), false, 'Fable must not be treated as Fab');
    assert.equal(isEpicPlayableGameEntry(entry), true);
});

test('isEpicPlayableGameEntry: entry without app_name is rejected', () => {
    const entry = { app_title: 'Mystery Game', metadata: {} };
    assert.equal(isEpicPlayableGameEntry(entry), false);
});

test('isEpicPlayableGameEntry: null/undefined entry is rejected', () => {
    assert.equal(isEpicPlayableGameEntry(null),      false);
    assert.equal(isEpicPlayableGameEntry(undefined), false);
    assert.equal(isEpicPlayableGameEntry(42),        false);
});

test('isEpicSyncedGameAllowed: evicts Fab from merged cache, keeps real games', () => {
    const games = [
        { id: 'epic_fab',     title: 'Fab',     platform: 'epic', source: 'epic', appName: 'fab',     namespace: 'fab' },
        { id: 'epic_control', title: 'Control', platform: 'epic', source: 'epic', appName: 'calluna', namespace: 'calluna' },
    ];
    const kept = games.filter(isEpicSyncedGameAllowed);
    assert.equal(kept.length, 1);
    assert.equal(kept[0].id, 'epic_control');
});

test('isEpicSyncedGameAllowed: non-Epic platform games are always kept', () => {
    const steamGame = { id: 'steam_123', title: 'Half-Life', platform: 'steam', source: 'steam' };
    assert.equal(isEpicSyncedGameAllowed(steamGame), true);
});

test('isEpicPlayableGameEntry: third-party EA game via Epic is kept', () => {
    const entry = {
        app_name: 'origin2',
        app_title: 'Mass Effect Legendary Edition',
        third_party_store: 'Origin',
        metadata: { namespace: 'origin2' },
    };
    assert.equal(isEpicPlayableGameEntry(entry), true);
});

// ─── Expanded non-game filter tests (Blueprint CSV Parsing etc.) ───────────────

test('isEpicNonGameAssetEntry: Blueprint CSV Parsing rejected with plugin metadata', () => {
    const entry = {
        app_name: 'BlueprintCSVParsing',
        app_title: 'Blueprint CSV Parsing',
        metadata: { productType: 'plugin', categories: ['plugins'] },
    };
    assert.equal(isEpicNonGameAssetEntry(entry), true,  'plugin-tagged blueprint entry must be rejected');
    assert.equal(isEpicPlayableGameEntry(entry), false, 'must not enter library');
});

test('isEpicNonGameAssetEntry: Blueprint CSV Parsing rejected even without metadata', () => {
    const entry = {
        app_name: 'BlueprintCSVParsing',
        app_title: 'Blueprint CSV Parsing',
    };
    assert.equal(isEpicNonGameAssetEntry(entry), true,  'blueprint+csv must be caught by pattern');
    assert.equal(isEpicPlayableGameEntry(entry), false);
});

test('isEpicNonGameAssetEntry: "blueprintcsvparsing" normalised app_name in denylist', () => {
    const entry = { app_name: 'blueprintcsvparsing', app_title: 'Blueprint CSV Parsing' };
    assert.equal(isEpicNonGameAssetEntry(entry), true);
});

test('isEpicNonGameAssetEntry: Fab exact match is rejected', () => {
    assert.equal(isEpicNonGameAssetEntry({ app_name: 'fab', app_title: 'Fab' }), true);
});

test('isEpicNonGameAssetEntry: Fab Marketplace rejected', () => {
    assert.equal(isEpicNonGameAssetEntry({
        app_name:  'fab-marketplace',
        app_title: 'Fab Marketplace',
    }), true);
});

test('isEpicNonGameAssetEntry: Unreal asset with namespace signal rejected', () => {
    assert.equal(isEpicNonGameAssetEntry({
        app_name:  'some-unreal-asset-pack',
        app_title: 'Unreal Nature Asset Pack',
        metadata:  { namespace: 'ue marketplace', productType: 'asset' },
    }), true);
});

test('isEpicNonGameAssetEntry: Control (real game) is NOT rejected', () => {
    assert.equal(isEpicNonGameAssetEntry({
        app_name:  'calluna',
        app_title: 'Control',
        metadata:  { namespace: 'calluna' },
    }), false);
    // With a realistic executable field (as Legendary provides), it is accepted.
    assert.equal(isEpicPlayableGameEntry({
        app_name:   'calluna',
        app_title:  'Control',
        executable: 'Control.exe',
        metadata:   { namespace: 'calluna' },
    }), true);
});

test('isEpicNonGameAssetEntry: Fable is NOT rejected — fab is not a whole word in fable', () => {
    assert.equal(isEpicNonGameAssetEntry({
        app_name:  'fable-game',
        app_title: 'Fable',
        metadata:  { namespace: 'fable' },
    }), false);
});

test('isEpicNonGameAssetEntry: Ubisoft third-party game is NOT rejected', () => {
    assert.equal(isEpicNonGameAssetEntry({
        app_name:  'uplay_35',
        app_title: 'Assassin\'s Creed Origins',
        third_party_store: 'Uplay',
        metadata:  { namespace: 'uplay' },
    }), false);
});

test('isEpicSyncedGameAllowed: evicts Blueprint CSV Parsing from merged cache', () => {
    const games = [
        { id: 'epic_bcsv',    title: 'Blueprint CSV Parsing', platform: 'epic', source: 'epic',
          appName: 'BlueprintCSVParsing', namespace: '' },
        { id: 'epic_control', title: 'Control',               platform: 'epic', source: 'epic',
          appName: 'calluna',             namespace: 'calluna' },
    ];
    const kept = games.filter(isEpicSyncedGameAllowed);
    assert.equal(kept.length, 1, 'only Control must survive');
    assert.equal(kept[0].id, 'epic_control');
});

// ─── Account display name resolver tests ───────────────────────────────────────

test('resolveEpicAccountIdentity: uses display_name when available', () => {
    const { accountId, displayName } = resolveEpicAccountIdentity(
        { account_id: 'abc123', display_name: 'GamerTag99' }
    );
    assert.equal(accountId,   'abc123');
    assert.equal(displayName, 'GamerTag99');
});

test('resolveEpicAccountIdentity: falls back to nested account.display_name', () => {
    const { displayName } = resolveEpicAccountIdentity({
        account_id: 'x1',
        account: { display_name: 'NestedName' },
    });
    assert.equal(displayName, 'NestedName');
});

test('resolveEpicAccountIdentity: never returns generic "Epic User" if account_id present', () => {
    const { displayName } = resolveEpicAccountIdentity(
        { account_id: 'deadbeef1234', display_name: '' },
        null,
        null
    );
    assert.notEqual(displayName, 'Epic User', 'must not return generic "Epic User" when id exists');
    assert.match(displayName, /^Epic [0-9a-f]{6,8}$/i, 'fallback must be Epic <shortId>');
});

test('resolveEpicAccountIdentity: skips "Epic User" string even if present in candidates', () => {
    const { displayName } = resolveEpicAccountIdentity({
        account_id:   'aa11bb22',
        display_name: 'Epic User',
        username:     'Real Name Here',
    });
    assert.equal(displayName, 'Real Name Here', 'must skip "Epic User" and use next candidate');
});

test('resolveEpicAccountIdentity: falls back to tmpId-based short name if no id in status', () => {
    const { accountId, displayName } = resolveEpicAccountIdentity(
        {},
        null,
        'epic_tmp_12345678'
    );
    assert.equal(accountId,   'epic_tmp_12345678');
    assert.match(displayName, /^Epic /, 'must start with "Epic " when falling back to tmpId');
});

// ─── classifyEpicEntry tests ───────────────────────────────────────────────────

test('classifyEpicEntry: entry with no positive signal returns unknown (dropped)', () => {
    const entry = { app_name: 'mystery-app', app_title: 'Mystery Thing' };
    const result = classifyEpicEntry(entry);
    assert.equal(result.decision, 'unknown');
    assert.ok(result.reason, 'must include a reason');
});

test('classifyEpicEntry: Advanced Flock System returns reject', () => {
    const entry = {
        app_name:  'AdvancedFlockSystem',
        app_title: 'Advanced Flock System - Multithreaded Fish AI and Reactive School Behavior',
        metadata:  { productType: 'asset' },
    };
    const result = classifyEpicEntry(entry);
    assert.equal(result.decision, 'reject', 'flock system must be rejected');
});

test('classifyEpicEntry: Agora Static Mesh Thumbnail Render Extension returns reject', () => {
    const entry = {
        app_name:  'AgoraStaticMeshThumbnailRenderExtension',
        app_title: 'Agora Static Mesh Thumbnail Render Extension',
        metadata:  { productType: 'plugin' },
    };
    const result = classifyEpicEntry(entry);
    assert.equal(result.decision, 'reject');
});

test('classifyEpicEntry: Assets Cleaner Project Cleaning Tool returns reject', () => {
    const entry = {
        app_name:  'AssetsCleaner',
        app_title: 'Assets Cleaner - Project Cleaning Tool',
        metadata:  { productType: 'tool' },
    };
    const result = classifyEpicEntry(entry);
    assert.equal(result.decision, 'reject');
});

test('classifyEpicEntry: Blueprint CSV Parsing returns reject', () => {
    const entry = {
        app_name:  'BlueprintCSVParsing',
        app_title: 'Blueprint CSV Parsing',
        metadata:  { productType: 'plugin', categories: ['plugins'] },
    };
    const result = classifyEpicEntry(entry);
    assert.equal(result.decision, 'reject');
});

test('classifyEpicEntry: Fab returns reject', () => {
    const result = classifyEpicEntry({ app_name: 'fab', app_title: 'Fab', metadata: { namespace: 'fab' } });
    assert.equal(result.decision, 'reject');
});

test('classifyEpicEntry: null/missing entry returns reject', () => {
    assert.equal(classifyEpicEntry(null).decision,      'reject');
    assert.equal(classifyEpicEntry(undefined).decision, 'reject');
    assert.equal(classifyEpicEntry({}).decision,        'reject');
});

test('classifyEpicEntry: Control with categories [games] returns keep with epic_games_category_signal', () => {
    const entry = {
        app_name:  'calluna',
        app_title: 'Control',
        metadata:  { categories: ['games'], namespace: 'calluna' },
    };
    const result = classifyEpicEntry(entry);
    assert.equal(result.decision, 'keep');
    assert.equal(result.reason,   'epic_games_category_signal');
});

test('classifyEpicEntry: Fortnite with productType game returns keep', () => {
    const entry = {
        app_name:  'Fortnite',
        app_title: 'Fortnite',
        metadata:  { productType: 'game', namespace: 'fortnite' },
    };
    const result = classifyEpicEntry(entry);
    assert.equal(result.decision, 'keep');
});

test('classifyEpicEntry: third-party Mass Effect returns keep', () => {
    const entry = {
        app_name:          'origin2',
        app_title:         'Mass Effect Legendary Edition',
        third_party_store: 'Origin',
        metadata:          { namespace: 'origin2' },
    };
    const result = classifyEpicEntry(entry);
    assert.equal(result.decision, 'keep');
});

// ─── Fortnite regression tests ────────────────────────────────────────────────
// Fortnite's metadata includes UEFN/Creative references that previously triggered
// the broad non-game keyword heuristics before the "games" category was checked.

test('classifyEpicEntry: Fortnite with namespace fn and categories [games, applications] is kept', () => {
    const entry = {
        app_name:  'Fortnite',
        app_title: 'Fortnite',
        namespace: 'fn',
        metadata:  {
            namespace:   'fn',
            // Simulate real Legendary metadata: description contains UEFN/creative terms
            // that triggered false rejection before the category check was prioritised.
            description: 'Fortnite is a game. Play Battle Royale, Creative, and UEFN.',
            categories:  [{ path: 'games' }, { path: 'applications' }],
        },
    };
    const result = classifyEpicEntry(entry);
    assert.equal(result.decision, 'keep',                      'Fortnite must be kept');
    assert.equal(result.reason,   'epic_games_category_signal', 'kept via games category, not keyword path');
});

test('classifyEpicEntry: Fortnite is not rejected even when metadata text contains "uefn" and "content"', () => {
    const entry = {
        app_name:  'Fortnite',
        app_title: 'Fortnite',
        namespace: 'fn',
        metadata:  {
            description: 'Build using uefn unreal editor. Download content packs and editor tools.',
            categories:  [{ path: 'games' }, { path: 'applications' }],
        },
    };
    const result = classifyEpicEntry(entry);
    assert.notEqual(result.decision, 'reject', 'Fortnite must not be rejected regardless of UEFN text in metadata');
    assert.equal(result.decision,    'keep');
});

test('classifyEpicEntry: Fortnite decision is keep so it is not passed to removeEpicNonGameEntries', () => {
    const entries = [
        { app_name: 'Fortnite', app_title: 'Fortnite', namespace: 'fn',
          metadata: { categories: [{ path: 'games' }, { path: 'applications' }] } },
        { app_name: 'Fortnite', app_title: 'Fortnite', namespace: 'fn',
          metadata: { categories: [{ path: 'games' }, { path: 'applications' }] } },
        { app_name: 'fab',      app_title: 'Fab',       namespace: 'fab', metadata: {} },
    ];
    const rejected = entries.filter(e => classifyEpicEntry(e).decision === 'reject');
    const rejectedNames = rejected.map(e => e.app_name);
    assert.ok(!rejectedNames.includes('Fortnite'), 'Fortnite must not appear in rejected entries');
    assert.ok(rejectedNames.includes('fab'),       'Fab must still be rejected');
});

test('classifyEpicEntry: UEFN denylist entry is still rejected even with categories [games]', () => {
    // "uefn" is explicitly hard-denylisted; the denylist must win over category data.
    const result = classifyEpicEntry({
        app_name:  'uefn',
        app_title: 'UEFN',
        namespace: 'uefn',
        metadata:  { categories: [{ path: 'games' }] },
    });
    assert.equal(result.decision, 'reject');
    assert.equal(result.reason,   'non_game_asset_or_marketplace_item');
});

test('classifyEpicEntry: Fab is still rejected even with categories [games]', () => {
    const result = classifyEpicEntry({
        app_name:  'fab',
        app_title: 'Fab',
        namespace: 'fab',
        metadata:  { categories: [{ path: 'games' }] },
    });
    assert.equal(result.decision, 'reject');
    assert.equal(result.reason,   'non_game_asset_or_marketplace_item');
});

test('classifyEpicEntry: Unreal Engine is still rejected even with categories [games]', () => {
    const result = classifyEpicEntry({
        app_name:  'UnrealEngineEditor',
        app_title: 'Unreal Engine',
        namespace: 'ue',
        metadata:  { categories: [{ path: 'games' }] },
    });
    assert.equal(result.decision, 'reject');
});

test('classifyEpicEntry: marketplace plugin with categories [content] and no games category is rejected', () => {
    const result = classifyEpicEntry({
        app_name:  'SomePlugin',
        app_title: 'Advanced AI Plugin',
        namespace: 'ue',
        metadata:  {
            description: 'An unreal engine plugin with assets and blueprints.',
            categories:  [{ path: 'content' }, { path: 'plugin' }],
        },
    });
    assert.equal(result.decision, 'reject');
});

test('classifyEpicEntry: game with categories [games, applications] and "content" in metadata is kept', () => {
    // Regression: "content" appearing in description must not block a game-category entry.
    const result = classifyEpicEntry({
        app_name:  'SomeGame',
        app_title: 'Some Game',
        namespace: 'somegame',
        metadata:  {
            description: 'Download free content updates and in-game content packs.',
            categories:  [{ path: 'games' }, { path: 'applications' }],
        },
    });
    assert.equal(result.decision, 'keep',                       'games-category entry must be kept');
    assert.equal(result.reason,   'epic_games_category_signal', 'reason must reflect category signal');
});

// ─── isEpicPositiveGameEntry tests ────────────────────────────────────────────

test('isEpicPositiveGameEntry: entry with categories [games] returns true', () => {
    assert.equal(isEpicPositiveGameEntry({
        app_name:  'some-game',
        app_title: 'Some Game',
        metadata:  { categories: [{ path: 'games/action' }] },
    }), true);
});

test('isEpicPositiveGameEntry: Fab is never a positive game entry', () => {
    assert.equal(isEpicPositiveGameEntry({ app_name: 'fab', app_title: 'Fab' }), false);
});

test('isEpicPositiveGameEntry: CanRunOffline attribute signals a game', () => {
    assert.equal(isEpicPositiveGameEntry({
        app_name:  'some-game',
        app_title: 'Some Game',
        metadata:  { customAttributes: { CanRunOffline: { value: 'true' } } },
    }), true);
});

// ─── isEpicSyncedGameAllowed batch tests ──────────────────────────────────────

test('isEpicSyncedGameAllowed: rejects all known bad entries, keeps real games', () => {
    const games = [
        { id: 'e1', title: 'Blueprint CSV Parsing',                                            platform: 'epic', appName: 'BlueprintCSVParsing' },
        { id: 'e2', title: 'Advanced Flock System - Multithreaded Fish AI and Reactive School Behavior', platform: 'epic', appName: 'AdvancedFlockSystem' },
        { id: 'e3', title: 'Agora Static Mesh Thumbnail Render Extension',                     platform: 'epic', appName: 'AgoraStaticMeshThumbnailRenderExtension' },
        { id: 'e4', title: 'Assets Cleaner - Project Cleaning Tool',                          platform: 'epic', appName: 'AssetsCleaner' },
        { id: 'e5', title: 'Fab',                                                              platform: 'epic', appName: 'fab' },
        { id: 'e6', title: 'Control',                                                          platform: 'epic', appName: 'calluna' },
        { id: 's1', title: 'Half-Life 2',                                                      platform: 'steam' },
    ];
    const kept = games.filter(isEpicSyncedGameAllowed);
    const keptIds = kept.map(g => g.id);
    assert.ok(keptIds.includes('e6'), 'Control must be kept');
    assert.ok(keptIds.includes('s1'), 'Steam game must be kept');
    assert.ok(!keptIds.includes('e1'), 'Blueprint CSV must be evicted');
    assert.ok(!keptIds.includes('e2'), 'Flock System must be evicted');
    assert.ok(!keptIds.includes('e3'), 'Agora thumbnail must be evicted');
    assert.ok(!keptIds.includes('e4'), 'Assets Cleaner must be evicted');
    assert.ok(!keptIds.includes('e5'), 'Fab must be evicted');
});

// ─── computeSteamSyncMessage tests ────────────────────────────────────────────

test('computeSteamSyncMessage: raw=432, final=216 shows entry/synced message with final count', () => {
    const msg = computeSteamSyncMessage(432, 216, 200);
    assert.equal(msg, 'Steam returned 432 entries; 216 games synced');
});

test('computeSteamSyncMessage: raw===final shows simple synced message', () => {
    assert.equal(computeSteamSyncMessage(100, 100, 95), 'Synced 100 games');
});

test('computeSteamSyncMessage: raw=0, prevCount>0 shows kept cache message', () => {
    assert.equal(computeSteamSyncMessage(0, 50, 50), 'Steam returned 0 games. Kept 50 cached games.');
});

test('computeSteamSyncMessage: raw=0, prevCount=0 shows no games message', () => {
    assert.equal(computeSteamSyncMessage(0, 0, 0), 'No owned games found');
});

test('computeSteamSyncMessage: raw=1, final=1, prev=0 shows synced message', () => {
    assert.equal(computeSteamSyncMessage(1, 1, 0), 'Synced 1 games');
});

// ─── TRANSIENT_SYNC_STATUSES ──────────────────────────────────────────────────

test('TRANSIENT_SYNC_STATUSES contains expected transient values', () => {
    for (const s of ['queued', 'pending', 'syncing', 'finalizing', 'starting']) {
        assert.ok(TRANSIENT_SYNC_STATUSES.has(s), `expected ${s} to be transient`);
    }
    for (const s of ['synced', 'success', 'error', 'idle', 'needs_reauth', 'warning']) {
        assert.ok(!TRANSIENT_SYNC_STATUSES.has(s), `expected ${s} to NOT be transient`);
    }
});

// ─── computeTerminalAccountStatus ────────────────────────────────────────────

test('computeTerminalAccountStatus: synced account with games returns synced', () => {
    const result = computeTerminalAccountStatus({ lastSyncedAt: '2024-01-01T00:00:00Z' }, 159);
    assert.equal(result.status, 'synced');
    assert.equal(result.message, 'Synced 159 games');
});

test('computeTerminalAccountStatus: synced account with 0 games but lastSyncedAt returns synced', () => {
    const result = computeTerminalAccountStatus({ lastSyncedAt: '2024-01-01T00:00:00Z' }, 0);
    assert.equal(result.status, 'synced');
    assert.ok(result.message.length > 0);
});

test('computeTerminalAccountStatus: account with no lastSyncedAt and 0 games returns idle', () => {
    const result = computeTerminalAccountStatus({}, 0);
    assert.equal(result.status, 'idle');
    assert.equal(result.message, '');
});

test('computeTerminalAccountStatus: needsReauth returns needs_reauth', () => {
    const result = computeTerminalAccountStatus({ needsReauth: true }, 100);
    assert.equal(result.status, 'needs_reauth');
    assert.equal(result.message, 'Reconnect required');
});

test('computeTerminalAccountStatus: credentialStatus missing returns needs_reauth', () => {
    const result = computeTerminalAccountStatus({ credentialStatus: 'missing' }, 50);
    assert.equal(result.status, 'needs_reauth');
});

test('computeTerminalAccountStatus: null account and 0 count returns idle', () => {
    const result = computeTerminalAccountStatus(null, 0);
    assert.equal(result.status, 'idle');
});

// ─── resolveEpicAccountIdentity (enhanced) ───────────────────────────────────

test('resolveEpicAccountIdentity: status.account plain string is used as displayName', () => {
    const { displayName, confidence } = resolveEpicAccountIdentity(
        { account: 'RealUser', account_id: 'abc123' }, null, null
    );
    assert.equal(displayName, 'RealUser');
    assert.equal(confidence, 'high');
});

test('resolveEpicAccountIdentity: real account_id produces high confidence', () => {
    const { accountId, confidence } = resolveEpicAccountIdentity(
        { account_id: 'real-id-abc', display_name: 'PlayerOne' }, null, 'epic_tmp_99'
    );
    assert.equal(accountId, 'real-id-abc');
    assert.equal(confidence, 'high');
});

test('resolveEpicAccountIdentity: missing account_id falls back to tmpId with low confidence', () => {
    const { accountId, confidence } = resolveEpicAccountIdentity(
        {}, null, 'epic_tmp_12345'
    );
    assert.equal(accountId, 'epic_tmp_12345');
    assert.equal(confidence, 'low');
});

test('resolveEpicAccountIdentity: displayName is never epic_tmp* even as fallback', () => {
    const { displayName } = resolveEpicAccountIdentity({}, null, 'epic_tmp_12345');
    assert.ok(!displayName.toLowerCase().startsWith('epic_tmp'), `got: ${displayName}`);
    assert.ok(!displayName.toLowerCase().includes('epic_tmp'), `got: ${displayName}`);
});

test('resolveEpicAccountIdentity: "Epic User" in candidates is filtered out', () => {
    const { displayName } = resolveEpicAccountIdentity(
        { display_name: 'Epic User', account_id: 'abc123' }, null, null
    );
    assert.notEqual(displayName, 'Epic User');
});

test('resolveEpicAccountIdentity: existingAccount with invalid name is not used', () => {
    const { displayName } = resolveEpicAccountIdentity(
        { account_id: 'abc123' },
        { displayName: 'Epic epic_tmp_999' },
        null
    );
    assert.ok(!displayName.toLowerCase().includes('epic_tmp'), `got: ${displayName}`);
});

test('resolveEpicAccountIdentity: real displayName from existingAccount is preferred when status has none', () => {
    const { displayName } = resolveEpicAccountIdentity(
        { account_id: 'abc123' },
        { displayName: 'JohnDoe' },
        null
    );
    assert.equal(displayName, 'JohnDoe');
});

test('resolveEpicAccountIdentity: account_id only (no display name anywhere) gives id-derived name', () => {
    const { displayName, source } = resolveEpicAccountIdentity(
        { account_id: 'abcdef12345678' }, null, null
    );
    assert.ok(displayName.startsWith('Epic '), `got: ${displayName}`);
    assert.equal(source, 'id-derived');
});

test('resolveEpicAccountIdentity: no id and no display name gives Epic Account fallback', () => {
    const { displayName, source } = resolveEpicAccountIdentity({}, null, null);
    assert.equal(displayName, 'Epic Account');
    assert.equal(source, 'fallback');
});

// ─── Epic link result shape ───────────────────────────────────────────────────

test('resolveEpicAccountIdentity: displayName is never undefined for any input', () => {
    const cases = [
        [undefined, null, null],
        [null, null, null],
        [{}, null, null],
        [{ account: 'SomeUser' }, null, null],
        [{ account_id: 'abc123', display_name: 'Real Name' }, null, null],
        [{ account_id: 'abc123' }, null, 'epic_tmp_fallback'],
        [{}, { displayName: 'Stored Name' }, null],
    ];
    for (const [status, existing, tmp] of cases) {
        const { displayName } = resolveEpicAccountIdentity(status, existing, tmp);
        assert.notEqual(displayName, undefined, `got undefined for status=${JSON.stringify(status)}`);
        assert.notEqual(displayName, '', `got empty string for status=${JSON.stringify(status)}`);
    }
});

test('resolveEpicAccountIdentity: Legendary status.account plain string becomes displayName', () => {
    // Legendary `status --json` returns { account: "username", account_id: "abc" }
    const { displayName, accountId } = resolveEpicAccountIdentity(
        { account: 'abdomg10', account_id: 'realid999' }, null, null
    );
    assert.equal(displayName, 'abdomg10');
    assert.equal(accountId, 'realid999');
});

// ─── IPC link result normalization ───────────────────────────────────────────

// Mirror of the normalization logic in the platform-sync:link IPC handler.
function normalizeLinkResult(linkRes) {
    if (typeof linkRes === 'string') return { status: 'success', displayName: linkRes };
    return { status: 'success', ...linkRes };
}

test('normalizeLinkResult: string connector return is wrapped with displayName key', () => {
    const result = normalizeLinkResult('John Steam');
    assert.equal(result.status, 'success');
    assert.equal(result.displayName, 'John Steam');
    assert.equal(Object.keys(result).includes('0'), false, 'must not spread string chars as numeric keys');
});

test('normalizeLinkResult: object connector return is spread without modification', () => {
    const result = normalizeLinkResult({ displayName: 'Epic User', accountId: 'id123', epicAccountId: 'id123' });
    assert.equal(result.status, 'success');
    assert.equal(result.displayName, 'Epic User');
    assert.equal(result.accountId, 'id123');
    assert.equal(result.epicAccountId, 'id123');
});

test('normalizeLinkResult: object with steamId is preserved for Steam accounts', () => {
    const result = normalizeLinkResult({ displayName: 'SteamUser', steamId: '76561198012345678' });
    assert.equal(result.status, 'success');
    assert.equal(result.steamId, '76561198012345678');
});

test('normalizeLinkResult: undefined displayName in object still does not show undefined string', () => {
    // Safeguard: even if connector returns { accountId } with no displayName,
    // the renderer fallback chain produces a sensible name (tested here as unit logic).
    const result = normalizeLinkResult({ accountId: 'id456' });
    assert.equal(result.displayName, undefined);
    // accounts.js uses: res.displayName || res.accountName || res.name || 'Epic account'
    const safe = result.displayName || result.accountName || result.name || 'Epic account';
    assert.equal(safe, 'Epic account');
});

// ─── Link progress event stages ──────────────────────────────────────────────

test('link-state-changed payload never has an undefined message for known statuses', () => {
    // Mirrors the stageMessages map in linkNewPlatformAccount() in accounts.js
    const stageMessages = {
        waiting_for_signin: 'Waiting for Epic authorization...',
        resolving_identity: 'Reading account profile...',
        saving_account:     'Saving account...',
        linked:             'Account linked. Starting library sync...',
        starting_sync:      'Epic sync started in the background. You can keep using Baddel.',
        failed:             'Linking failed.',
    };
    for (const [status, msg] of Object.entries(stageMessages)) {
        assert.ok(typeof msg === 'string' && msg.length > 0,
            `stageMessages['${status}'] must be a non-empty string`);
    }
});

test('Epic link targetAccountId uses accountId/epicAccountId, not steamId', () => {
    // Reproduces the renderer logic for choosing targetAccountId after link
    function deriveTargetId(platform, res) {
        return platform === 'steam'
            ? (res.steamId || res.accountId || res.id || null)
            : (res.accountId || res.epicAccountId || res.id || null);
    }

    const epicRes = { displayName: 'EpicUser', accountId: 'epic123', epicAccountId: 'epic123' };
    assert.equal(deriveTargetId('epic', epicRes), 'epic123');

    const steamRes = { displayName: 'SteamUser', steamId: '76561198012345678' };
    assert.equal(deriveTargetId('steam', steamRes), '76561198012345678');

    // Epic result must NOT use steamId even if it were accidentally present
    const mixedRes = { displayName: 'X', steamId: 'wrongId', accountId: 'rightId' };
    assert.equal(deriveTargetId('epic', mixedRes), 'rightId');
});

test('link display name fallback chain never produces undefined', () => {
    function resolveLinkedName(platform, res) {
        return res.displayName || res.accountName || res.name
            || (platform === 'steam' ? 'Steam account' : 'Epic account');
    }

    assert.equal(resolveLinkedName('epic', { displayName: 'John' }), 'John');
    assert.equal(resolveLinkedName('epic', { accountName: 'John' }), 'John');
    assert.equal(resolveLinkedName('epic', { name: 'John' }), 'John');
    assert.equal(resolveLinkedName('epic', {}), 'Epic account');
    assert.equal(resolveLinkedName('steam', {}), 'Steam account');
    assert.notEqual(resolveLinkedName('epic', {}), undefined);
    assert.notEqual(resolveLinkedName('steam', {}), undefined);
    assert.notEqual(resolveLinkedName('epic', { displayName: undefined }), undefined);
});

test('Steam approval poll URI contains two_factor_confirm_finished', () => {
    // The stub URI used by _startMobileApprovalPolling must match the Python
    // pass_login_credentials routing which checks: 'two_factor_confirm_finished' in end_uri
    const CONFIRM_STUB = 'baddel://steam/two_factor_confirm_finished';
    assert.ok(CONFIRM_STUB.includes('two_factor_confirm_finished'),
        'Stub URI must contain two_factor_confirm_finished for Python routing');
});

// ── isRealEpicSwitcherProfile ──────────────────────────────────────────────────
const { isRealEpicSwitcherProfile } = require('../platformSyncShared');

test('isRealEpicSwitcherProfile: returns true when Data/ is present', () => {
    assert.equal(isRealEpicSwitcherProfile(['Data', 'sync_link.json']), true);
});

test('isRealEpicSwitcherProfile: returns true when Config/ is present', () => {
    assert.equal(isRealEpicSwitcherProfile(['Config', 'Data']), true);
});

test('isRealEpicSwitcherProfile: returns true when _baddel_meta.json is present', () => {
    assert.equal(isRealEpicSwitcherProfile(['_baddel_meta.json']), true);
});

test('isRealEpicSwitcherProfile: returns false for phantom folder with only sync_link.json', () => {
    assert.equal(isRealEpicSwitcherProfile(['sync_link.json']), false);
});

test('isRealEpicSwitcherProfile: returns false for empty folder', () => {
    assert.equal(isRealEpicSwitcherProfile([]), false);
});

test('isRealEpicSwitcherProfile: returns false for non-array input', () => {
    assert.equal(isRealEpicSwitcherProfile(null), false);
    assert.equal(isRealEpicSwitcherProfile(undefined), false);
    assert.equal(isRealEpicSwitcherProfile('Data'), false);
});

test('isRealEpicSwitcherProfile: case-insensitive marker check', () => {
    assert.equal(isRealEpicSwitcherProfile(['data', 'sync_link.json']), true);
    assert.equal(isRealEpicSwitcherProfile(['DATA']), true);
});
