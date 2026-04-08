const test = require('node:test');
const assert = require('node:assert/strict');
const {
    orderAccountsForSync,
    countGamesForAccount,
    finalizeLibraryForAccounts,
    removeAccountFromLibrary,
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
