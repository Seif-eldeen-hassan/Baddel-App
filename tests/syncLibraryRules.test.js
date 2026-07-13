'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    createFriendlySyncError,
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
