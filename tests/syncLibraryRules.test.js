'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    createFriendlySyncError,
    mergeExistingEpicOwnership,
    mergeOwnedGamesIntoLibrary,
    summarizeEpicEntryForLog,
    summarizeGameTitles,
    steamGameBelongsToAccount,
} = require('../src/features/sync/domain/services/syncLibraryRules');

test('createFriendlySyncError maps Steam timeout to friendly Steam copy', () => {
    const result = createFriendlySyncError('steam', new Error('Cache timeout after 60s'));

    assert.equal(
        result.userMessage,
        'Steam took too long to reply. We kept the previous library data and saved diagnostics.'
    );
    assert.equal(result.diagnosticMessage, 'Cache timeout after 60s');
});

test('createFriendlySyncError maps Epic timeout to friendly Epic copy', () => {
    const result = createFriendlySyncError('epic', 'Legendary timeout');

    assert.equal(
        result.userMessage,
        'Epic Games took too long to reply. We kept the previous library data and saved diagnostics.'
    );
    assert.equal(result.diagnosticMessage, 'Legendary timeout');
});

test('createFriendlySyncError maps missing credentials and auth failures', () => {
    assert.deepEqual(
        createFriendlySyncError('steam', 'Credentials folder is missing'),
        {
            userMessage: 'The saved account data is incomplete. Please relink this account and try again.',
            diagnosticMessage: 'Credentials folder is missing',
        }
    );

    assert.deepEqual(
        createFriendlySyncError('epic', 'not authenticated'),
        {
            userMessage: 'Authentication did not finish correctly. Please sign in again.',
            diagnosticMessage: 'not authenticated',
        }
    );
});

test('createFriendlySyncError keeps unknown errors diagnostic', () => {
    assert.deepEqual(
        createFriendlySyncError('steam', null),
        {
            userMessage: 'Unknown error',
            diagnosticMessage: 'Unknown error',
        }
    );
});

test('summarizeEpicEntryForLog extracts stable Legendary fields', () => {
    const entry = {
        app_name: 'control',
        app_title: '',
        title: 'Control',
        metadata: {
            namespace: 'controlns',
            customAttributes: {
                productType: { value: 'Game' },
            },
            categories: ['games'],
        },
    };

    assert.deepEqual(summarizeEpicEntryForLog(entry), {
        app_name: 'control',
        app_title: 'Control',
        namespace: 'controlns',
        productType: 'Game',
        categories: ['games'],
    });
});

test('summarizeEpicEntryForLog handles nullish entries', () => {
    assert.deepEqual(summarizeEpicEntryForLog(null), {
        app_name: undefined,
        app_title: undefined,
        namespace: undefined,
        productType: undefined,
        categories: undefined,
    });
});

test('summarizeGameTitles trims, deduplicates, filters blanks, and limits', () => {
    const games = [
        { title: ' Portal ' },
        { title: 'Portal' },
        { title: '' },
        { title: 'Half-Life' },
        { title: 'Counter-Strike' },
    ];

    assert.deepEqual(summarizeGameTitles(games, 2), ['Portal', 'Half-Life']);
});

test('summarizeGameTitles handles empty/null input', () => {
    assert.deepEqual(summarizeGameTitles(null), []);
    assert.deepEqual(summarizeGameTitles([], 10), []);
});

test('summarizeGameTitles does not mutate input games', () => {
    const games = [{ title: 'Portal' }, { title: 'Half-Life' }];
    const before = JSON.stringify(games);

    summarizeGameTitles(games);

    assert.equal(JSON.stringify(games), before);
});

test('steamGameBelongsToAccount accepts licensed and owned account ids', () => {
    assert.equal(
        steamGameBelongsToAccount({ steamLicensedAccountIds: ['1'] }, 1),
        true
    );
    assert.equal(
        steamGameBelongsToAccount({ ownedByAccountIds: ['2'] }, 2),
        true
    );
});

test('steamGameBelongsToAccount ignores detected install ids as ownership evidence', () => {
    assert.equal(
        steamGameBelongsToAccount({ steamDetectedAccountIds: ['1'] }, 1),
        false
    );
});

test('steamGameBelongsToAccount handles missing game/account data', () => {
    assert.equal(steamGameBelongsToAccount(null, '1'), false);
    assert.equal(steamGameBelongsToAccount({}, '1'), false);
});

test('mergeOwnedGamesIntoLibrary inserts fresh games into the target map', () => {
    const mergedLibrary = new Map();
    const game = {
        id: 'steam_10',
        title: 'Portal',
        ownedBy: ['Steam One'],
        ownedByAccountIds: ['s1'],
        steamLicensedAccountIds: ['s1'],
    };

    mergeOwnedGamesIntoLibrary(
        mergedLibrary,
        [game],
        { id: 's1', displayName: 'Steam One' },
        'steam'
    );

    assert.equal(mergedLibrary.get('steam_10'), game);
});

test('mergeOwnedGamesIntoLibrary mutates existing Steam ownership without duplicating ids', () => {
    const existing = {
        id: 'steam_10',
        title: 'Cached Portal',
        ownedBy: ['Steam Two'],
        ownedByAccountIds: ['s2'],
        steamLicensedAccountIds: ['s2'],
    };
    const mergedLibrary = new Map([['steam_10', existing]]);
    const fresh = {
        id: 'steam_10',
        title: 'Fresh Portal',
        ownedBy: ['Steam One'],
        ownedByAccountIds: ['s1'],
        steamLicensedAccountIds: ['s1'],
    };

    mergeOwnedGamesIntoLibrary(
        mergedLibrary,
        [fresh, fresh],
        { id: 's1', displayName: 'Steam One' },
        'steam'
    );

    assert.equal(mergedLibrary.get('steam_10'), existing);
    assert.deepEqual(existing.ownedBy, ['Steam Two', 'Steam One']);
    assert.deepEqual(existing.ownedByAccountIds, ['s2', 's1']);
    assert.deepEqual(existing.steamLicensedAccountIds, ['s2', 's1']);
});

test('mergeOwnedGamesIntoLibrary mutates existing Epic ownership without Steam fields', () => {
    const existing = {
        id: 'epic_control',
        title: 'Control',
        ownedBy: ['Epic One'],
        ownedByAccountIds: ['e1'],
    };
    const mergedLibrary = new Map([['epic_control', existing]]);

    mergeOwnedGamesIntoLibrary(
        mergedLibrary,
        [{ id: 'epic_control', title: 'Control Fresh' }],
        { id: 'e2', displayName: 'Epic Two' },
        'epic'
    );

    assert.equal(mergedLibrary.get('epic_control'), existing);
    assert.deepEqual(existing.ownedBy, ['Epic One', 'Epic Two']);
    assert.deepEqual(existing.ownedByAccountIds, ['e1', 'e2']);
    assert.equal(existing.steamLicensedAccountIds, undefined);
});

test('mergeExistingEpicOwnership preserves non-target cached owners only', () => {
    const targetGame = {
        id: 'epic_shared',
        ownedBy: ['Epic Two'],
        ownedByAccountIds: ['e2'],
    };
    const previousGame = {
        id: 'epic_shared',
        ownedBy: ['Epic One', 'Epic Two'],
        ownedByAccountIds: ['e1', 'e2'],
    };

    mergeExistingEpicOwnership(targetGame, previousGame, 'e2');

    assert.deepEqual(targetGame.ownedByAccountIds, ['e2', 'e1']);
    assert.deepEqual(targetGame.ownedBy, ['Epic Two', 'Epic One']);
});

test('mergeExistingEpicOwnership initializes missing ownership arrays', () => {
    const targetGame = { id: 'epic_shared' };

    mergeExistingEpicOwnership(
        targetGame,
        { ownedBy: ['Epic One'], ownedByAccountIds: ['e1'] },
        'e2'
    );

    assert.deepEqual(targetGame.ownedByAccountIds, ['e1']);
    assert.deepEqual(targetGame.ownedBy, ['Epic One']);
});
