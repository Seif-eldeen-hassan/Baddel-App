'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const play = fs.readFileSync('src/js/play-launcher.js', 'utf8');
const details = fs.readFileSync('src/js/game-details.js', 'utf8');

test('GOG Play policy is provenance-driven: gogdl is managed, Galaxy protocol is official, local exe is standalone', () => {
    const start = play.indexOf('function _plIsManagedInstall(');
    const end = play.indexOf('async function _plTrySingleManagedOwner', start);
    const ctx = { window: {}, _plGetPlatformKey: game => game.platform };
    vm.runInNewContext(play.slice(start, end), ctx);
    assert.equal(ctx._plIsManagedInstall({ platform: 'gog', installSource: 'download', installProvider: 'gogdl' }, 'gog'), true);
    assert.equal(ctx._plRequiresOfficialAccount({ platform: 'gog', command: 'goggalaxy://launch/42' }, 'gog'), true);
    assert.equal(ctx._plRequiresOfficialAccount({ platform: 'gog', command: 'D:\\Games\\Game.exe', installSource: 'scanner' }, 'gog'), false);
    assert.equal(ctx._plIsManagedInstall({ platform: 'gog' }, 'gog'), false);
});

test('single-account official Play path calls the canonical account resolver', () => {
    assert.match(play, /_plTrySingleOfficialReady[\s\S]*buildPlatformAccountOptions\(\{ game: install \|\| game, platform, mode: 'play' \}\)/);
    assert.match(play, /options\.length !== 1 \|\| ready\.length !== 1/);
});

test('Galaxy availability disables its install method with the required reason', async () => {
    const start = details.indexOf('async function _gdRefreshGogLauncherAvailability()');
    const end = details.indexOf('//', start + 60);
    const option = { isConnected: true, disabled: false };
    const reason = { textContent: '' };
    const ctx = {
        window: { electronAPI: { getLauncherAvailability: async () => ({ available: false }) } },
        document: { getElementById: id => id === 'gdGogGalaxyInstallOption' ? option : reason },
        _gdInstallSelectedProvider: 'gogdl',
    };
    vm.runInNewContext(details.slice(start, end), ctx);
    await ctx._gdRefreshGogLauncherAvailability();
    assert.equal(option.disabled, true);
    assert.equal(reason.textContent, 'GOG Galaxy is not installed.');
});

test('GOG product identity ignores a nonnumeric gogdl slug when a trusted numeric product ID exists', () => {
    const start = details.indexOf('function _gdProviderInstallIdentity(');
    const end = details.indexOf('function _gdDirectInstallPayload(', start);
    const ctx = {};
    vm.runInNewContext(details.slice(start, end), ctx);
    const identity = ctx._gdProviderInstallIdentity('gog', { gogdlAppName: 'game_slug', gogProductId: '12345' });
    assert.equal(identity.providerProductId, '12345');
});

test('Galaxy handoff copy says product page opened and never claims download started', () => {
    const gogBranch = details.slice(details.indexOf("targetPlatform === 'gog' && installProvider === 'gog_galaxy'"), details.indexOf("targetPlatform === 'steam'"));
    assert.match(gogBranch, /GOG Galaxy opened on the game page\. Continue the installation in Galaxy\./);
    assert.doesNotMatch(gogBranch, /Download started|installation started/i);
});
