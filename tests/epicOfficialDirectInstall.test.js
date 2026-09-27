'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('src/js/game-details.js', 'utf8');
function block(start, end) { const index = source.indexOf(start); assert.ok(index >= 0); return source.slice(index, source.indexOf(end, index + start.length)); }
for (const [platform, provider, direct, label] of [
    ['epic', 'epic_launcher', true, 'Launch Directly'], ['epic', 'legendary', false, null],
    ['steam', 'steam_client', true, 'Install Directly'], ['gog', 'gog_galaxy', true, 'Launch Directly'], ['gog', 'gogdl', false, null],
]) test(`${platform}/${provider} no-switch row policy and account choices`, async () => {
    const list = { isConnected: true, style: {}, innerHTML: '' }; const selected = []; let ownerResolverCalls = 0;
    const account = { id: 'owner', enabled: true, actionStatus: 'ready' };
    const ctx = { console, _gdInstallAccountRevision: 0, _gdInstallSelectedProvider: provider, _gdInstallSelectedPlatform: platform, _gdCurrentGame: {},
        _gdUpdateInstallPlatformHint() {}, _gdInstallPlatformConfig: () => ({ name: platform }),
        document: { getElementById: () => list }, setTimeout: fn => fn(),
        buildPlatformAccountOptions: async () => [account], buildDirectEpicInstallAccountOptions: async () => { ownerResolverCalls++; return [account]; },
        buildManagedProviderAccountOptions: async () => { ownerResolverCalls++; return [account]; },
        _poRenderAccountRow: opt => `<div data-id="${opt.id}">Owner</div>`, gdInstallSelectAccount: id => selected.push(id), gdInstallUpdateConfirm() {},
    }; ctx.window = ctx;
    vm.runInNewContext(block('window.gdInstallLoadAccounts =', 'window.gdInstallSelectAccount ='), ctx);
    await ctx.gdInstallLoadAccounts(platform);
    assert.equal(list.innerHTML.includes('data-id="__none__"'), direct); if (label) assert.ok(list.innerHTML.includes(label));
    assert.ok(list.innerHTML.includes('data-id="owner"')); assert.equal(ownerResolverCalls, ['legendary', 'gogdl'].includes(provider) ? 1 : 0);
    ctx.buildPlatformAccountOptions = async () => []; await ctx.gdInstallLoadAccounts(platform);
    if (direct) assert.equal(selected.at(-1), '__none__');
});

test('official GOG Galaxy confirmation switches the exact profile UUID before product-view dispatch', async () => {
    const calls = [];
    const game = { id: 'gog_42', gogProductId: '42' };
    const ctx = { console: { log() {} }, _gdInstallSelectedAccountId: '0123456789abcdef0123456789abcdef', _gdInstallSelectedPlatform: 'gog', _gdInstallSelectedProvider: 'gog_galaxy',
        _gdInstallSelectedActionStatus: 'ready', _gdInstallSelectedAccountUsername: null, _gdInstallSelectedAccountName: 'Owner', _gdCurrentGame: game, _gdInstallPlatforms: ['gog'],
        document: { getElementById: () => ({ remove() {} }) }, electronAPI: { switchGogAccount: async id => calls.push(['switch', id]) },
        getGogGalaxyProductViewUrl: () => 'goggalaxy://openGameView/42', showToast() {},
        _gdOpenInstallUrl: async (...args) => calls.push(['open', ...args]),
    }; ctx.window = ctx;
    vm.runInNewContext(block('async function _gdInstallConfirmImpl()', 'async function _gdOpenInstallUrl('), ctx);
    await ctx._gdInstallConfirmImpl();
    assert.deepEqual(calls.map(call => call[0]), ['switch', 'open']);
    assert.equal(calls[0][1], '0123456789abcdef0123456789abcdef');
    assert.equal(calls[1][2], 'goggalaxy://openGameView/42');
    assert.equal(calls[1][5].didSwitchAccount, true);
});

test('GOG Galaxy Launch Directly skips switching and opens the validated product page', async () => {
    const calls = [];
    const game = { id: 'gog_1207659026', gogProductId: '1207659026' };
    const ctx = { console: { log() {} }, _gdInstallSelectedAccountId: '__none__', _gdInstallSelectedPlatform: 'gog', _gdInstallSelectedProvider: 'gog_galaxy',
        _gdInstallSelectedActionStatus: 'ready', _gdInstallSelectedAccountUsername: null, _gdInstallSelectedAccountName: null, _gdCurrentGame: game, _gdInstallPlatforms: ['gog'],
        document: { getElementById: () => ({ remove() {} }) }, electronAPI: { switchGogAccount: async id => calls.push(['switch', id]) },
        getGogGalaxyProductViewUrl: value => value === game ? 'goggalaxy://openGameView/1207659026' : null, showToast() {},
        _gdOpenInstallUrl: async (...args) => calls.push(['open', ...args]),
    }; ctx.window = ctx;
    vm.runInNewContext(block('async function _gdInstallConfirmImpl()', 'async function _gdOpenInstallUrl('), ctx);
    await ctx._gdInstallConfirmImpl();
    assert.deepEqual(calls.map(call => call[0]), ['open']);
    assert.equal(calls[0][2], 'goggalaxy://openGameView/1207659026');
    assert.equal(calls[0][4], 'GOG Galaxy opened on the game page. Continue the installation in Galaxy.');
    assert.equal(calls[0][5].didSwitchAccount, false);
});
for (const [account, switches] of [['__none__', 0], ['switcher-owner', 1]]) test(`official Epic confirmation ${account} uses existing URI and correct switch behavior`, async () => {
    let count = 0, opened, uriGame;
    const game = { id: 'epic-app', appName: 'app' };
    const ctx = { console: { log() {} }, _gdInstallSelectedAccountId: account, _gdInstallSelectedPlatform: 'epic', _gdInstallSelectedProvider: 'epic_launcher',
        _gdInstallSelectedActionStatus: 'ready', _gdInstallSelectedAccountUsername: null, _gdInstallSelectedAccountName: null, _gdCurrentGame: game, _gdInstallPlatforms: ['epic'],
        document: { getElementById: () => ({ remove() {} }) }, electronAPI: { switchEpic: async () => count++ }, setTimeout: fn => fn(),
        getEpicInstallUrl: value => { uriGame = value; return 'com.epicgames.launcher://apps/app?action=install&silent=false'; },
        _gdOpenInstallUrl: async (...args) => { opened = args; },
    }; ctx.window = ctx;
    vm.runInNewContext(block('async function _gdInstallConfirmImpl()', 'async function _gdOpenInstallUrl('), ctx);
    await ctx._gdInstallConfirmImpl(); assert.equal(count, switches); assert.equal(uriGame, game);
    assert.equal(opened[1], 'com.epicgames.launcher://apps/app?action=install&silent=false'); assert.equal(opened[4].didSwitchAccount, switches > 0);
});
test('official __none__ enables confirmation without bypassing Legendary storage/account requirements', () => {
    const button = {};
    const ctx = { _gdInstallSelectedProvider: 'epic_launcher', _gdInstallSelectedPlatform: 'epic', _gdInstallSelectedAccountId: '__none__', document: { getElementById: () => button } }; ctx.window = ctx;
    vm.runInNewContext(block('window.gdInstallUpdateConfirm =', 'function _gdInstallUpdateSteps'), ctx);
    ctx.gdInstallUpdateConfirm(); assert.equal(button.disabled, false);
    ctx._gdInstallSelectedProvider = 'legendary'; ctx._gdInstallSelectedAccountId = null; ctx.gdInstallUpdateConfirm(); assert.equal(button.disabled, true);
});
