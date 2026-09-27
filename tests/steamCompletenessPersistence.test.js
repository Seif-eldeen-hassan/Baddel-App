const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { finalizeLibraryForAccounts } = require('../platformSyncShared');
const platformSyncSource = fs.readFileSync(path.join(__dirname, '..', 'platformSync.js'), 'utf8');

function game(index, accountId = 'steam-a') {
    return {
        id: `steam_${index}`,
        title: `Game ${index}`,
        platform: 'steam',
        ownedByAccountIds: [accountId],
        steamLicensedAccountIds: [accountId],
    };
}

test('incomplete 20-game response cannot replace an authoritative 500-game snapshot', () => {
    const previousGames = Array.from({ length: 500 }, (_, index) => game(index));
    const nextGames = Array.from({ length: 20 }, (_, index) => game(index));
    const result = finalizeLibraryForAccounts({
        platform: 'steam', previousGames, nextGames,
        accounts: [{ id: 'steam-a', displayName: 'Primary' }],
        accountResults: { 'steam-a': { status: 'partial', rawGamesCount: 20, authoritative: false } },
    });

    assert.equal(result.games.length, 500);
    assert.equal(result.validation.countsByAccount['steam-a'], 500);
    assert.equal(result.validation.ok, false);
});

test('incomplete empty response preserves cached ownership', () => {
    const result = finalizeLibraryForAccounts({
        platform: 'steam', previousGames: [game(1)], nextGames: [],
        accounts: [{ id: 'steam-a', displayName: 'Primary' }],
        accountResults: { 'steam-a': { status: 'partial', rawGamesCount: 0, authoritative: false } },
    });
    assert.equal(result.games.length, 1);
});

test('authoritative empty response permits legitimate ownership removal', () => {
    const result = finalizeLibraryForAccounts({
        platform: 'steam', previousGames: [game(1)], nextGames: [],
        accounts: [{ id: 'steam-a', displayName: 'Primary' }],
        accountResults: { 'steam-a': { status: 'success', rawGamesCount: 0, authoritative: true } },
    });
    assert.equal(result.games.length, 0);
    assert.equal(result.validation.ok, true);
});

test('Steam bridge timeouts cancel Python work and cache waits reject instead of proceeding', () => {
    const bridge = fs.readFileSync(path.join(__dirname, '..', 'steamBridge.js'), 'utf8');
    assert.match(bridge, /method: 'cancel_request'/);
    assert.match(bridge, /STEAM_LIBRARY_INACTIVITY_TIMEOUT/);
    assert.doesNotMatch(bridge, /proceeding anyway/);
});

test('email resend starts a fresh credential challenge and reports success only after Steam response', () => {
    const python = fs.readFileSync(path.join(__dirname, '..', 'baddel-steam-integration', 'src', 'baddel_bridge.py'), 'utf8');
    const html = fs.readFileSync(path.join(__dirname, '..', 'baddel-steam-integration', 'src', 'steam_network', 'custom_login', 'index.html'), 'utf8');
    assert.match(python, /async def resend_steam_guard_email/);
    assert.match(python, /AuthCall\.RSA_AND_LOGIN/);
    assert.match(python, /"resent": True/);
    assert.match(python, /"status": "cooldown"/);
    assert.match(html, /baddel:\/\/auth\/resend-email/);
});



test('Steam link and unlink are rejected while a sync owns the session', () => {
  assert.match(platformSyncSource, /platform === 'steam' && _getPlatformSyncState\('steam'\)\.isSyncing/);
  assert.equal((platformSyncSource.match(/STEAM_OPERATION_BUSY/g) || []).length, 2);
});

test('a rejected background sync only terminates its own active run', () => {
  assert.match(platformSyncSource, /activeState\.isSyncing && activeState\.syncRunId === syncRunId/);
});
