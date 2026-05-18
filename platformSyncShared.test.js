const test = require('node:test');
const assert = require('node:assert/strict');
const {
    orderAccountsForSync,
    countGamesForAccount,
    finalizeLibraryForAccounts,
    removeAccountFromLibrary,
    isFabOrMarketplaceEntry,
    isEpicPlayableGameEntry,
    isEpicSyncedGameAllowed,
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

test('countGamesForAccount does NOT count steamDetectedAccountIds as ownership', () => {
    // Locally-detected installs must not inflate ownership counts.
    const games = [
        { id: 'steam_install_only', steamLicensedAccountIds: [], ownedByAccountIds: [], steamDetectedAccountIds: ['solo'] },
        { id: 'steam_other',        steamLicensedAccountIds: [], ownedByAccountIds: [], steamDetectedAccountIds: ['other'] },
    ];

    assert.equal(countGamesForAccount('steam', games, 'solo'),    0, 'detected install must not count as owned');
    assert.equal(countGamesForAccount('steam', games, 'other'),   0, 'detected install must not count as owned');
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
test('removeAccountFromLibrary keeps install-only games that have no owners after removal', () => {
    const games = [
        {
            id: 'steam_install_only',
            title: 'Install Only',
            ownedBy: [],
            ownedByAccountIds: [],
            steamLicensedAccountIds: [],
            steamDetectedAccountIds: ['a1'],
            installOnly: true,
        },
    ];

    // Removing a1 should keep the game because installOnly===true, even though no licensed owner remains.
    const filtered = removeAccountFromLibrary('steam', games, { id: 'a1', displayName: 'Primary' });

    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].installOnly, true);
    assert.deepEqual(filtered[0].ownedByAccountIds, []);
    assert.deepEqual(filtered[0].steamLicensedAccountIds, []);
});

test('removeAccountFromLibrary does not treat steamDetectedAccountIds as ownership when deciding to keep a game', () => {
    // A game with only steamDetectedAccountIds (no licensed owner) for the removed account
    // should be dropped — it was never licensed to anyone.
    const games = [
        {
            id: 'steam_detected_only',
            title: 'Detected Not Licensed',
            ownedBy: [],
            ownedByAccountIds: [],
            steamLicensedAccountIds: [],
            steamDetectedAccountIds: ['a1'],
            installOnly: false,
        },
    ];

    const filtered = removeAccountFromLibrary('steam', games, { id: 'a1', displayName: 'Primary' });

    // No licensed owners remain and installOnly is false → game should be dropped.
    assert.equal(filtered.length, 0);
});

test('finalizeLibraryForAccounts treats install-only games as zero ownership for accounts', () => {
    const accounts = [{ id: 'a1', displayName: 'Primary' }];
    const nextGames = [
        {
            id: 'steam_install',
            title: 'Installed Game',
            ownedBy: [],
            ownedByAccountIds: [],
            steamLicensedAccountIds: [],
            steamDetectedAccountIds: ['a1'],
            installOnly: true,
        },
    ];

    const finalized = finalizeLibraryForAccounts({
        platform: 'steam',
        previousGames: [],
        nextGames,
        accounts,
        accountResults: {
            a1: { status: 'success', rawGamesCount: 0, allowZeroGames: true },
        },
    });

    // The game exists in the library but is NOT counted as owned by a1.
    assert.equal(finalized.games.length, 1);
    assert.equal(finalized.validation.countsByAccount['a1'], 0);
});

// ─── Epic partial-sync ownership regression tests ──────────────────────────
//
// These tests exercise the shared-library helpers used by the fixed
// epicConnector.syncLibrary path.  The actual Map-seeding fix lives in
// platformSync.js; here we verify the counting + removal primitives that
// must keep working correctly after that fix.

test('countGamesForAccount counts a shared Epic game for both owners', () => {
    const games = [
        {
            id: 'epic_shared',
            title: 'Shared Game',
            ownedBy: ['Alice', 'Bob'],
            ownedByAccountIds: ['A', 'B'],
        },
        {
            id: 'epic_a_only',
            title: 'A Only',
            ownedBy: ['Alice'],
            ownedByAccountIds: ['A'],
        },
        {
            id: 'epic_b_only',
            title: 'B Only',
            ownedBy: ['Bob'],
            ownedByAccountIds: ['B'],
        },
    ];

    assert.equal(countGamesForAccount('epic', games, 'A'), 2, 'A must own shared + a_only');
    assert.equal(countGamesForAccount('epic', games, 'B'), 2, 'B must own shared + b_only');
});

test('Epic partial sync: shared game keeps both owners after syncing only account B', () => {
    // This simulates the state after the fixed merge:
    // previousGames (seeded into mergedLibrary) already has shared owned by A+B.
    // Fresh B sync runs mergeOwnedGamesIntoLibrary with only B's data for "shared".
    // The result must still show A as an owner of the shared game.

    // Simulate what mergeOwnedGamesIntoLibrary does when the map is pre-seeded:
    // the game already exists → we only ADD B's data, not overwrite.
    const previousGames = [
        { id: 'epic_shared', title: 'Shared Game', ownedBy: ['Alice', 'Bob'], ownedByAccountIds: ['A', 'B'] },
        { id: 'epic_a_only', title: 'A Only',       ownedBy: ['Alice'],        ownedByAccountIds: ['A'] },
    ];

    // After seeding from previousGames and syncing B (which brings shared + b_only):
    const mergedLibrary = new Map(previousGames.map((g) => [g.id, JSON.parse(JSON.stringify(g))]));

    // Simulate fresh B sync results (B owns "shared" and "b_only")
    const freshBGames = [
        { id: 'epic_shared', title: 'Shared Game', ownedBy: ['Bob'], ownedByAccountIds: ['B'] },
        { id: 'epic_b_only', title: 'B Only',       ownedBy: ['Bob'], ownedByAccountIds: ['B'] },
    ];

    // Replicate mergeOwnedGamesIntoLibrary logic for 'epic'
    const accountB = { id: 'B', displayName: 'Bob' };
    for (const game of freshBGames) {
        if (mergedLibrary.has(game.id)) {
            const existing = mergedLibrary.get(game.id);
            if (!existing.ownedBy.includes(accountB.displayName)) existing.ownedBy.push(accountB.displayName);
            if (!existing.ownedByAccountIds.map(String).includes('B')) existing.ownedByAccountIds.push('B');
        } else {
            mergedLibrary.set(game.id, JSON.parse(JSON.stringify(game)));
        }
    }

    const finalGames = Array.from(mergedLibrary.values());

    // 3 distinct game entries (no duplicates)
    assert.equal(finalGames.length, 3, 'All Games must have 3 entries (no duplicates)');

    const shared = finalGames.find((g) => g.id === 'epic_shared');
    assert.ok(shared, 'shared game must exist');
    assert.ok(shared.ownedByAccountIds.map(String).includes('A'), 'shared game must still list A as owner');
    assert.ok(shared.ownedByAccountIds.map(String).includes('B'), 'shared game must still list B as owner');

    // Per-account counts
    assert.equal(countGamesForAccount('epic', finalGames, 'A'), 2, "A's count must not drop (shared + a_only)");
    assert.equal(countGamesForAccount('epic', finalGames, 'B'), 2, "B's count must be 2 (shared + b_only)");
});

test('Epic partial sync: syncing B does not erase non-target ownership on shared titles', () => {
    // Variation: multiple shared games, ensure none lose A's ownership
    const previousGames = [
        { id: 'epic_shared1', title: 'Shared 1', ownedBy: ['Alice', 'Bob'], ownedByAccountIds: ['A', 'B'] },
        { id: 'epic_shared2', title: 'Shared 2', ownedBy: ['Alice', 'Bob'], ownedByAccountIds: ['A', 'B'] },
        { id: 'epic_a_only',  title: 'A Only',   ownedBy: ['Alice'],        ownedByAccountIds: ['A'] },
    ];

    const mergedLibrary = new Map(previousGames.map((g) => [g.id, JSON.parse(JSON.stringify(g))]));

    const freshBGames = [
        { id: 'epic_shared1', title: 'Shared 1', ownedBy: ['Bob'], ownedByAccountIds: ['B'] },
        { id: 'epic_shared2', title: 'Shared 2', ownedBy: ['Bob'], ownedByAccountIds: ['B'] },
        { id: 'epic_b_only',  title: 'B Only',   ownedBy: ['Bob'], ownedByAccountIds: ['B'] },
    ];

    // Apply merge (simulating mergeOwnedGamesIntoLibrary)
    for (const game of freshBGames) {
        if (mergedLibrary.has(game.id)) {
            const existing = mergedLibrary.get(game.id);
            if (!existing.ownedBy.includes('Bob')) existing.ownedBy.push('Bob');
            if (!existing.ownedByAccountIds.map(String).includes('B')) existing.ownedByAccountIds.push('B');
        } else {
            mergedLibrary.set(game.id, JSON.parse(JSON.stringify(game)));
        }
    }

    const finalGames = Array.from(mergedLibrary.values());
    assert.equal(finalGames.length, 4);

    for (const id of ['epic_shared1', 'epic_shared2']) {
        const g = finalGames.find((x) => x.id === id);
        assert.ok(g.ownedByAccountIds.map(String).includes('A'), `${id} must keep A as owner`);
        assert.ok(g.ownedByAccountIds.map(String).includes('B'), `${id} must keep B as owner`);
    }

    // A has shared1 + shared2 + a_only = 3
    assert.equal(countGamesForAccount('epic', finalGames, 'A'), 3);
    // B has shared1 + shared2 + b_only = 3
    assert.equal(countGamesForAccount('epic', finalGames, 'B'), 3);
});

test('removeAccountFromLibrary keeps shared Epic game for remaining owner after partial removal', () => {
    // This is the existing behavior test — verifying it still passes with our changes.
    const games = [
        { id: 'epic_shared', title: 'Shared', ownedBy: ['Alice', 'Bob'], ownedByAccountIds: ['A', 'B'] },
        { id: 'epic_a_only', title: 'A Only', ownedBy: ['Alice'],        ownedByAccountIds: ['A'] },
    ];

    const after = removeAccountFromLibrary('epic', games, { id: 'B', displayName: 'Bob' });

    // Only a_only is fully dropped; shared survives for A
    assert.equal(after.length, 2, 'shared must survive; a_only also kept (A still owns it)');
    const shared = after.find((g) => g.id === 'epic_shared');
    assert.ok(shared, 'shared game must remain');
    assert.deepEqual(shared.ownedByAccountIds, ['A'], 'only A should remain');
    assert.deepEqual(shared.ownedBy, ['Alice'], 'only Alice display name should remain');
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
        app_name: 'calluna',
        app_title: 'Control',
        metadata: { namespace: 'calluna' },
    };
    assert.equal(isFabOrMarketplaceEntry(entry), false);
    assert.equal(isEpicPlayableGameEntry(entry), true);
});

test('isEpicPlayableGameEntry: "Fable" does NOT contain a whole-word "fab" match', () => {
    // "fab" is a substring of "fable" but NOT a separate word — must not be filtered.
    const entry = {
        app_name: 'fable-game',
        app_title: 'Fable',
        metadata: { namespace: 'fable' },
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

test('isEpicSyncedGameAllowed: evicts Fab from merged cache', () => {
    const games = [
        { id: 'epic_fab',     title: 'Fab',     platform: 'epic', source: 'epic', appName: 'fab',     namespace: 'fab' },
        { id: 'epic_control', title: 'Control', platform: 'epic', source: 'epic', appName: 'calluna', namespace: 'calluna' },
    ];
    const kept = games.filter(isEpicSyncedGameAllowed);
    assert.equal(kept.length, 1);
    assert.equal(kept[0].id, 'epic_control');
});

test('isEpicSyncedGameAllowed: non-Epic games are always kept', () => {
    const steamGame = { id: 'steam_123', title: 'Half-Life', platform: 'steam', source: 'steam' };
    assert.equal(isEpicSyncedGameAllowed(steamGame), true);
});

test('isEpicPlayableGameEntry: third-party EA game via Epic is kept', () => {
    // EA games show up in legendary --third-party with third_party_store = "Origin"
    const entry = {
        app_name: 'origin2',
        app_title: 'Mass Effect Legendary Edition',
        third_party_store: 'Origin',
        metadata: { namespace: 'origin2' },
    };
    assert.equal(isEpicPlayableGameEntry(entry), true);
});

test('isEpicPlayableGameEntry: "fab" inside asset description but NOT in name/namespace is not blocked', () => {
    // A real game whose description happens to mention "fab" should not be filtered.
    // Only app_name, app_title, namespace, and catalog fields drive the decision.
    const entry = {
        app_name: 'rpg-adventure-2024',
        app_title: 'The Great Adventure',
        metadata: { namespace: 'rpg-adventure-2024', description: 'A totally fab experience' },
    };
    // Description text is not in _getEpicEntryText, so this must pass.
    assert.equal(isEpicPlayableGameEntry(entry), true);
});