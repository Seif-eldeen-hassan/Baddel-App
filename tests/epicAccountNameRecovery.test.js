'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'platformSync.js'), 'utf8');

test('successful Epic library reads retry a fallback display name without failing the sync', () => {
    const recovery = source.indexOf('async function recoverEpicDisplayNameAfterSuccessfulLibraryRead');
    const listRead = source.indexOf("runLegendary(['list', '--json'], confPath, 30_000)");
    const recoveryCall = source.indexOf('recoverEpicDisplayNameAfterSuccessfulLibraryRead(acc, confPath)', listRead);
    const buildGames = source.indexOf('buildEpicOwnedGameEntries(acc, allEntries)', listRead);
    assert.ok(recovery !== -1, 'Epic display-name recovery helper missing');
    assert.ok(listRead < recoveryCall, 'name recovery must happen only after a successful library read');
    assert.ok(recoveryCall < buildGames, 'games must be built with the recovered owner name');
    assert.match(source.slice(recovery, recovery + 2600), /Name refresh deferred[\s\S]*return null/);
    assert.match(source.slice(recovery, recovery + 2600), /identity\?\.source === 'id-derived'/);
});

test('recovered Epic names are persisted and replace stale ownership labels', () => {
    assert.match(source, /await persistRecoveredEpicDisplayName\(\{ accountId, previousDisplayName, displayName: nextDisplayName \}\)/);
    assert.match(source, /saveEpicAccountsList\(nextAccounts\)/);
    assert.match(source, /_emitPlatformAccountsChanged\('epic', 'identity_refreshed'\)/);
    assert.match(source, /replaceEpicOwnerDisplayName\(mergedLibrary, item\.accountNameChange\)/);
});

test('Epic display-name persistence is serialized and happens before game building', () => {
    assert.match(source, /let _epicIdentityWriteQueue = Promise\.resolve\(\)/);
    const recoveryCall = source.indexOf('await persistRecoveredEpicDisplayName');
    const buildGames = source.indexOf('buildEpicOwnedGameEntries(acc, allEntries)');
    assert.ok(recoveryCall !== -1 && recoveryCall < buildGames);
});
