const test   = require('node:test');
const assert = require('node:assert/strict');
const { canonicalPlatforms, getStrictSteamAppId } = require('../src/js/platformResolver');

// ─── canonicalPlatforms ────────────────────────────────────────────────────────

test('manual game => canonical platform is manual, not steam', () => {
    const game = { platform: 'Manual', name: 'My Indie Game', path: 'C:\\Games\\MyGame.exe' };
    assert.deepEqual(canonicalPlatforms(game), ['manual']);
});

test('game with no fields => manual, not steam', () => {
    assert.deepEqual(canonicalPlatforms({}), ['manual']);
});

test('null game => manual', () => {
    assert.deepEqual(canonicalPlatforms(null), ['manual']);
});

test('Riot game with platform field => riot only, not ea', () => {
    const game = { platform: 'Riot Games', command: 'C:\\Riot Games\\League of Legends\\LeagueClient.exe' };
    const plats = canonicalPlatforms(game);
    assert.ok(plats.includes('riot'),  'must detect riot');
    assert.ok(!plats.includes('ea'),   'must NOT detect ea');
    assert.ok(!plats.includes('steam'),'must NOT detect steam');
    assert.ok(!plats.includes('manual'),'must NOT be manual');
});

test('Riot game with --launch-product= marker => riot only, not ea', () => {
    const game = {
        platform: '',
        command: '"C:\\Riot Client\\RiotClientServices.exe" --launch-product=valorant --launch-patchline=live',
    };
    const plats = canonicalPlatforms(game);
    assert.ok(plats.includes('riot'),  'must detect riot');
    assert.ok(!plats.includes('ea'),   'must NOT detect ea');
    assert.ok(!plats.includes('steam'),'must NOT detect steam');
});

test('Riot game with riotProduct field => riot only', () => {
    const game = { riotProduct: 'valorant', command: '' };
    const plats = canonicalPlatforms(game);
    assert.ok(plats.includes('riot'), 'must detect riot');
    assert.ok(!plats.includes('ea'),  'must NOT detect ea');
});

test('EA game with explicit EA App platform => ea', () => {
    const game = { platform: 'EA App', name: 'Apex Legends' };
    const plats = canonicalPlatforms(game);
    assert.ok(plats.includes('ea'),    'must detect ea');
    assert.ok(!plats.includes('steam'),'must NOT detect steam');
    assert.ok(!plats.includes('riot'), 'must NOT detect riot');
});

test('EA game with eadesktop:// command => ea', () => {
    const game = { command: 'eadesktop://run/12345' };
    const plats = canonicalPlatforms(game);
    assert.ok(plats.includes('ea'),    'must detect ea');
    assert.ok(!plats.includes('steam'),'must NOT detect steam');
});

test('EA game with origin:// command => ea', () => {
    const game = { command: 'origin://launchgame/67890' };
    const plats = canonicalPlatforms(game);
    assert.ok(plats.includes('ea'), 'must detect ea');
});

test('Steam game with source field => steam', () => {
    const game = { source: 'steam', allIds: { steam: 570 } };
    const plats = canonicalPlatforms(game);
    assert.ok(plats.includes('steam'),  'must detect steam');
    assert.ok(!plats.includes('manual'),'must NOT be manual');
});

test('Steam game with platform=Steam => steam', () => {
    const game = { platform: 'Steam', allIds: { steam: 730 } };
    const plats = canonicalPlatforms(game);
    assert.ok(plats.includes('steam'), 'must detect steam');
});

test('Steam game via steam:// command => steam', () => {
    const game = { command: 'steam://run/570' };
    assert.ok(canonicalPlatforms(game).includes('steam'), 'must detect steam from protocol');
});

test('Epic game with platform field => epic', () => {
    const game = { platform: 'Epic Games', allIds: { epic: 'abc123def456abc1' } };
    const plats = canonicalPlatforms(game);
    assert.ok(plats.includes('epic'),   'must detect epic');
    assert.ok(!plats.includes('steam'), 'must NOT detect steam');
});

test('Epic game via com.epicgames command => epic', () => {
    const game = { command: 'com.epicgames.launcher://apps/Fortnite?action=launch' };
    assert.ok(canonicalPlatforms(game).includes('epic'), 'must detect epic from command');
});

test('no steam fallback when nothing matches', () => {
    const game = { name: 'Unknown Game', path: 'C:\\Games\\UnknownGame.exe' };
    const plats = canonicalPlatforms(game);
    assert.ok(!plats.includes('steam'), 'must NOT fall back to steam');
    assert.deepEqual(plats, ['manual']);
});

test('game with platform=league of legends (has "ea" as substring) => NOT ea', () => {
    // Regression: "league" contains "ea" but the game is not an EA game
    const game = { platform: 'league of legends', name: 'League of Legends' };
    const plats = canonicalPlatforms(game);
    assert.ok(!plats.includes('ea'),    'league-of-legends must NOT be detected as ea');
    assert.deepEqual(plats, ['manual'], 'unknown platform string => manual');
});

test('Ubisoft game with Ubisoft Connect platform => ubisoft', () => {
    const game = { platform: 'Ubisoft Connect', name: "Assassin's Creed" };
    const plats = canonicalPlatforms(game);
    assert.ok(plats.includes('ubisoft'), 'must detect ubisoft');
    assert.ok(!plats.includes('ea'),     'must NOT detect ea');
});

test('game with merged platforms array => uses array values', () => {
    const game = { platforms: ['Steam', 'Epic Games'], allIds: { steam: 440 } };
    const plats = canonicalPlatforms(game);
    assert.ok(plats.includes('steam'), 'must include steam from array');
    assert.ok(plats.includes('epic'),  'must include epic from array');
});

// ─── getStrictSteamAppId ──────────────────────────────────────────────────────

test('manual game => getStrictSteamAppId returns null', () => {
    const game = { platform: 'Manual', id: 'abc123456', name: 'My Game' };
    assert.equal(getStrictSteamAppId(game), null);
});

test('Riot game => getStrictSteamAppId returns null', () => {
    const game = { platform: 'Riot Games', name: 'Valorant', id: '9876543' };
    assert.equal(getStrictSteamAppId(game), null);
});

test('EA game => getStrictSteamAppId returns null even if id looks numeric', () => {
    const game = { platform: 'EA App', id: '12345678', name: 'Apex Legends' };
    assert.equal(getStrictSteamAppId(game), null);
});

test('Steam game with allIds.steam => returns correct appid', () => {
    const game = { platform: 'Steam', allIds: { steam: 570 }, id: 'steam-570' };
    assert.equal(getStrictSteamAppId(game), '570');
});

test('Steam game via steam:// command => returns appid from protocol', () => {
    const game = { platform: 'Steam', command: 'steam://run/730' };
    assert.equal(getStrictSteamAppId(game), '730');
});

test('Steam game with steam- prefixed id => returns appid', () => {
    const game = { platform: 'Steam', id: 'steam-12345' };
    assert.equal(getStrictSteamAppId(game), '12345');
});

test('Steam game with no appid source => returns null', () => {
    const game = { platform: 'Steam', id: 'some-random-id', name: 'Some Steam Game' };
    assert.equal(getStrictSteamAppId(game), null);
});

// ─── Platform bleed regression ────────────────────────────────────────────────

test('Rockstar game => not steam, not ea', () => {
    const game = { platform: 'Rockstar Games', name: 'GTA V' };
    const plats = canonicalPlatforms(game);
    assert.ok(plats.includes('rockstar'), 'must detect rockstar');
    assert.ok(!plats.includes('steam'),   'must NOT detect steam');
    assert.ok(!plats.includes('ea'),      'must NOT detect ea');
});

test('manual game with numeric path => not steam', () => {
    // Regression: old code read digits from game.id/command as steam app id
    const game = {
        platform: 'Manual',
        id: 'abc987654321',
        command: 'C:\\Games\\12345\\game.exe',
        name: 'Local Game',
    };
    assert.equal(getStrictSteamAppId(game), null, 'manual game must not get a steam app id');
    assert.deepEqual(canonicalPlatforms(game), ['manual']);
});
