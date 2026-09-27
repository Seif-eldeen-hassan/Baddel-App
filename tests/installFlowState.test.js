'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('src/js/game-details.js', 'utf8');
function block(start, end) { const a = source.indexOf(start); return source.slice(a, source.indexOf(end, a + start.length)); }
function harness() {
    const elements = new Map(); const loads = []; const storage = [];
    const element = () => ({ hidden: false, disabled: false, style: {}, classList: { add() {}, remove() {} }, querySelectorAll: () => [], querySelector: () => null, setAttribute() {}, addEventListener() {}, remove() {}, focus() {}, isConnected: true });
    for (const id of ['gdInstallConfirmBtn', 'gdInstallConfirmLabel', 'gdInstallCancelBtn', 'gdInstallBackBtn', 'gdInstallSetupPage', 'gdInstallMethodsSection', 'gdInstallAccountsSection', 'gdInstallStorageSection']) elements.set(id, element());
    const context = { console, Set, setTimeout: fn => fn(), requestAnimationFrame: fn => fn(),
        document: { getElementById: id => elements.get(id) || null, querySelectorAll: () => [], querySelector: () => null, createElement: element, body: { appendChild: modal => elements.set(modal.id, modal) } },
        _gdInstallSelectedAccountId: null, _gdInstallSelectedPlatform: null,
        _gdDetectPlatforms: game => game.platforms, _gdResolveInstallArtwork: async () => ({}), GD_PLATFORM_LOGOS: {},
        _gdInstallPlatformLabel: p => p, escapeHtml: x => x, _gdRefreshEpicLauncherAvailability() {},
        baddelInstallStorage: { reset: () => storage.push('reset'), valid: () => false },
    };
    context.window = context; vm.createContext(context);
    vm.runInContext(block('let _gdInstallSelectedAccountUsername', '// ── Install-picker artwork resolver'), context);
    vm.runInContext(block('async function _gdOpenInstallPicker', '// Public entry point used by app.js'), context);
    vm.runInContext(block('window.gdInstallSelectPlatform =', 'window.gdInstallLoadAccounts ='), context);
    context.gdInstallLoadAccounts = async platform => loads.push({ platform, provider: vm.runInContext('_gdInstallSelectedProvider', context) });
    return { context, elements, loads, storage, state: () => vm.runInContext('({ platform: _gdInstallSelectedPlatform, provider: _gdInstallSelectedProvider, account: _gdInstallSelectedAccountId })', context) };
}
for (const platforms of [['steam', 'epic'], ['epic', 'gog'], ['steam', 'gog'], ['steam', 'epic', 'gog']]) test(`multi-platform ${platforms.join('+')} requires explicit platform before provider/accounts`, async () => {
    const h = harness(); await h.context._gdOpenInstallPicker({ platforms, name: 'Fixture' });
    assert.equal(h.state().platform, null); assert.equal(h.state().provider, null); assert.equal(h.state().account, null); assert.equal(h.loads.length, 0);
    assert.equal(h.elements.get('gdInstallConfirmBtn').disabled, true); assert.equal(h.elements.get('gdInstallMethodsSection').hidden, true);
    assert.ok(h.elements.get('gdInstallerModal').innerHTML.includes('CHOOSE PLATFORM'));
});
for (const platform of ['steam', 'epic', 'gog']) test(`single ${platform} hides redundant platform step`, async () => {
    const h = harness(); await h.context._gdOpenInstallPicker({ platforms: [platform], name: 'Fixture' });
    assert.equal(h.state().platform, platform);
    assert.equal(h.elements.get('gdInstallerModal').innerHTML.includes('CHOOSE PLATFORM'), false);
    assert.equal(h.state().provider, ({ steam: 'steam_client', epic: null, gog: 'gogdl' })[platform]);
});
test('switching Epic to GOG/Steam clears account and Epic provider; switching back needs method selection', async () => {
    const h = harness(); await h.context._gdOpenInstallPicker({ platforms: ['epic', 'steam', 'gog'], name: 'Fixture' });
    await h.context.gdInstallSelectPlatform('epic'); await h.context.gdInstallSelectProvider('legendary');
    h.context._gdInstallSelectedAccountId = 'epic-owner';
    await h.context.gdInstallSelectPlatform('gog'); assert.equal(h.state().account, null); assert.equal(h.state().provider, 'gogdl');
    await h.context.gdInstallSelectPlatform('steam'); assert.equal(h.state().provider, 'steam_client');
    await h.context.gdInstallSelectPlatform('epic'); assert.equal(h.state().provider, null); assert.equal(h.elements.get('gdInstallMethodsSection').hidden, false);
});
test('changing Epic method invalidates account and storage before account resolver runs', async () => {
    const h = harness(); await h.context._gdOpenInstallPicker({ platforms: ['epic'], name: 'Fixture' });
    await h.context.gdInstallSelectProvider('legendary'); h.context._gdInstallSelectedAccountId = 'owner';
    await h.context.gdInstallSelectProvider('epic_launcher'); assert.equal(h.state().account, null); assert.equal(h.loads.at(-1).provider, 'epic_launcher'); assert.ok(h.storage.length >= 3);
});
test('an Epic method is rejected unless Epic is selected', async () => {
    const h = harness(); await h.context._gdOpenInstallPicker({ platforms: ['steam'], name: 'Fixture' });
    await h.context.gdInstallSelectProvider('legendary'); assert.equal(h.state().provider, 'steam_client');
});
test('changing game while artwork is pending cannot append stale installer', async () => {
    const h = harness(); let finish;
    h.context._gdResolveInstallArtwork = () => new Promise(resolve => { finish = resolve; });
    const pending = h.context._gdOpenInstallPicker({ platforms: ['gog'], name: 'Old' });
    h.context.gdInstallClose(); finish({}); await pending;
    assert.equal(h.elements.has('gdInstallerModal'), false);
});
test('queue forwards only confirmed plan sizes and never opens a native picker automatically', async () => {
    let queued = null;
    const context = { _gdInstallModalRevision: 1, _gdInstallAccountRevision: 1,
        baddelInstallStorage: { confirmed: async () => ({ installPath: 'F:\\Games\\Fixture', installPlanId: 'plan', totalBytes: 2000, expectedTotalBytes: 2000, downloadSizeBytes: 1000, installedDiskSizeBytes: 2000 }) },
        electronAPI: { downloads: { queueInstall: async payload => { queued = payload; return { status: 'success' }; }, selectInstallDirectory: () => { throw new Error('Must not open'); } } },
        _gdDirectInstallPayload: (platform, game, accountId, installProvider) => ({ platform, gameId: game.id, accountId, installProvider }), gdInstallClose() {},
    };
    context.window = context; vm.createContext(context);
    vm.runInContext(block('async function _gdQueueDirectDownload', 'function _gdPickTrailerFallbackThumbnail'), context);
    await context._gdQueueDirectDownload('gog', { id: 'fixture' }, 'owner', 'gogdl');
    assert.equal(queued.installPlanId, 'plan'); assert.equal(queued.totalBytes, 2000); assert.equal(queued.downloadSizeBytes, 1000); assert.equal(queued.installPath, 'F:\\Games\\Fixture');
});
