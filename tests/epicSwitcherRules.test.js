'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    findMatchingEpicSwitcherProfile,
    normalizeEpicSwitcherMatchValue,
} = require('../src/features/sync/domain/services/epicSwitcherRules');

test('normalizeEpicSwitcherMatchValue lowercases and trims current match values', () => {
    assert.equal(normalizeEpicSwitcherMatchValue('  JaneDoe  '), 'janedoe');
    assert.equal(normalizeEpicSwitcherMatchValue(null), '');
    assert.equal(normalizeEpicSwitcherMatchValue(undefined), '');
});

test('findMatchingEpicSwitcherProfile matches real profile by exact normalized folder name', () => {
    const profiles = [
        { name: 'OtherUser', isReal: true, syncLink: { platformAccountId: 'acct-other' } },
        { name: 'JaneDoe', isReal: true, syncLink: { platformAccountId: 'acct-2' } },
    ];

    assert.equal(findMatchingEpicSwitcherProfile('acct-1', ' janedoe ', profiles), 'JaneDoe');
});

test('findMatchingEpicSwitcherProfile matches real profile by sync_link platformAccountId', () => {
    const profiles = [
        { name: 'JaneDoe', isReal: true, syncLink: { platformAccountId: 'acct-456' } },
    ];

    assert.equal(findMatchingEpicSwitcherProfile(' ACCT-456 ', 'SomeName', profiles), 'JaneDoe');
});

test('findMatchingEpicSwitcherProfile matches real profile by sync_link epicDisplayName', () => {
    const profiles = [
        { name: 'FolderName', isReal: true, syncLink: { epicDisplayName: 'Visible Epic Name' } },
    ];

    assert.equal(findMatchingEpicSwitcherProfile('', ' visible epic name ', profiles), 'FolderName');
});

test('findMatchingEpicSwitcherProfile ignores phantom profiles', () => {
    const profiles = [
        { name: 'PhantomMatch', isReal: false, syncLink: { platformAccountId: 'acct-1', epicDisplayName: 'PhantomMatch' } },
    ];

    assert.equal(findMatchingEpicSwitcherProfile('acct-1', 'PhantomMatch', profiles), null);
});

test('findMatchingEpicSwitcherProfile returns null for missing or empty profiles', () => {
    assert.equal(findMatchingEpicSwitcherProfile('acct-1', 'Name', null), null);
    assert.equal(findMatchingEpicSwitcherProfile('acct-1', 'Name', []), null);
});

test('findMatchingEpicSwitcherProfile keeps first-match behavior for duplicate profile descriptors', () => {
    const profiles = [
        { name: 'First', isReal: true, syncLink: { platformAccountId: 'acct-1' } },
        { name: 'Second', isReal: true, syncLink: { platformAccountId: 'acct-1' } },
    ];

    assert.equal(findMatchingEpicSwitcherProfile('acct-1', '', profiles), 'First');
});

test('findMatchingEpicSwitcherProfile keeps current per-directory priority order', () => {
    const profiles = [
        { name: 'OtherUser', isReal: true, syncLink: { platformAccountId: 'acct-1' } },
        { name: 'JaneDoe', isReal: true, syncLink: { platformAccountId: 'acct-2' } },
    ];

    assert.equal(findMatchingEpicSwitcherProfile('acct-1', 'JaneDoe', profiles), 'OtherUser');
});

test('findMatchingEpicSwitcherProfile does not mutate profile descriptors', () => {
    const profiles = [
        { name: 'JaneDoe', isReal: true, syncLink: { platformAccountId: 'acct-1' } },
    ];
    const before = JSON.stringify(profiles);

    findMatchingEpicSwitcherProfile('acct-1', 'JaneDoe', profiles);

    assert.equal(JSON.stringify(profiles), before);
});
