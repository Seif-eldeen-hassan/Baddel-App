'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EpicLegendaryRuntimeService } = require('../src/features/downloads/infrastructure/providers/epic/EpicLegendaryRuntimeService');
const game = { id: 'epic_ep3', name: '3 out of 10, EP 3', platform: 'epic', installProvider: 'legendary', installedByAccountId: 'a', installPath: 'D:\\Games\\EP3', path: 'D:\\Games\\EP3', appName: 'ep3' };
const owner = id => ({ id, displayName: id, ownsGame: true, enabled: true, actionStatus: 'ready', notInSwitcher: true });

function harness(options, result = { status: 'success' }, logo = 'file:///logo.webp') {
    const elements = new Map(); const timers = []; const rows = [];
    const calls = { launches: [], generic: 0, switcher: 0, assets: [], minimized: 0, toasts: [] };
    function element(id) {
        if (!elements.has(id)) {
            const classes = new Set();
            elements.set(id, { style: {}, dataset: {}, innerHTML: '', textContent: '', innerText: '',
                classList: { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x) },
                getAttribute: key => key === 'aria-disabled' ? 'false' : null, remove() { elements.delete(id); } });
        }
        return elements.get(id);
    }
    ['launchOverlay', 'launchBg', 'launchLogo', 'launchTitle', 'launchText', 'plAccountsList', 'plAccountsSubtitle', 'plAccountTitle', 'plLaunchBtn'].forEach(element);
    const context = { console: { error() {}, log() {} }, performance,
        setTimeout(fn, ms) { if (ms <= 150) fn(); else timers.push(fn); }, clearTimeout() {},
        addEventListener() {}, removeEventListener() {}, localStorage: { getItem: () => null },
        document: { getElementById: id => elements.get(id) || null, addEventListener() {}, removeEventListener() {},
            querySelector: selector => rows.find(row => selector.includes('"' + row.dataset.id + '"')) || null,
            querySelectorAll: () => rows },
        buildDirectEpicInstallAccountOptions: async () => options,
        _poRenderAccountRow(opt) { const row = element('row-' + opt.id); row.dataset = { id: opt.id, name: opt.displayName, actionStatus: opt.actionStatus }; row.getAttribute = () => String(!opt.enabled); rows.push(row); return opt.displayName + (opt.enabled ? ': Owns game' : ': Reconnect'); },
        showToast: message => calls.toasts.push(message),
        electronAPI: { getEpicProfiles: async () => { calls.switcher++; return []; }, switchEpic: async () => { calls.switcher++; },
            launchGame: async () => { calls.generic++; }, minimizeApp: () => { calls.minimized++; },
            downloads: { launchEpicLegendary: async (...args) => { assert.equal(element('launchOverlay').classList.contains('active'), true); calls.launches.push(args); return result; } } },
    };
    context.window = context; vm.createContext(context);
    vm.runInContext(fs.readFileSync('src/js/play-launcher.js', 'utf8'), context);
    context._plResolveLaunchOverlayAssets = async target => { calls.assets.push(target.id); return { hero: 'file:///hero.webp', logo }; };
    context._plBuildModal = () => { element('playLauncherModal'); };
    context._plShowModal = () => {};
    return { context, calls, element, rows, timers };
}

test('single direct owner uses shared artwork overlay, real title and only the Legendary executor', async () => {
    const h = harness([owner('b')]);
    await h.context.openPlayLauncher(game);
    assert.deepEqual(h.calls.launches, [[game.id, 'b']]);
    assert.deepEqual(h.calls.assets, [game.id]);
    assert.match(h.element('launchBg').style.backgroundImage, /hero.webp/);
    assert.equal(h.element('launchLogo').src, 'file:///logo.webp');
    assert.equal(h.element('launchText').innerText, 'STARTING 3 OUT OF 10, EP 3...');
    assert.equal(h.calls.generic, 0); assert.equal(h.calls.switcher, 0);
    assert.equal(h.calls.toasts.length, 0);
    while (h.timers.length) h.timers.shift()();
    assert.equal(h.element('launchOverlay').classList.contains('active'), false);
    assert.equal(h.context.isLaunching, false); assert.equal(h.calls.minimized, 1);
});
test('title fallback and failed auth clear the shared overlay without generic game copy', async () => {
    const h = harness([owner('a')], { status: 'error', code: 'EPIC_AUTH_REQUIRED' }, null);
    await h.context.openPlayLauncher(game);
    assert.equal(h.element('launchTitle').innerText, game.name);
    assert.match(h.calls.toasts[0], /3 out of 10, EP 3.*Reconnect Epic account/);
    assert.equal(h.element('launchOverlay').classList.contains('active'), false);
    assert.equal(h.context.isLaunching, false); assert.equal(h.calls.generic, 0);
});
test('two owners outside Switcher both appear; original preselected, alternate launches after closing picker', async () => {
    const h = harness([owner('b'), owner('a'), { ...owner('outsider'), ownsGame: false }]);
    await h.context.openPlayLauncher(game);
    assert.equal(h.calls.launches.length, 0);
    assert.equal(h.context._plSelectedAccountId, 'a');
    assert.deepEqual(h.rows.map(row => row.dataset.id), ['b', 'a']);
    assert.equal(h.rows.every(row => row.getAttribute('aria-disabled') === 'false'), true);
    assert.equal(h.element('plAccountTitle').textContent, 'Choose Epic Account');
    assert.match(h.element('plAccountsSubtitle').textContent, /multiple synced Epic accounts/);
    assert.doesNotMatch(h.element('plAccountsList').innerHTML, /Switcher/);
    h.context.plSelectAccount('b'); await h.context.plDoLaunch();
    assert.deepEqual(h.calls.launches, [[game.id, 'b']]);
    assert.equal(h.calls.switcher, 0); assert.equal(h.calls.generic, 0);
    assert.equal(h.context._debugPlayLaunchOptions().selectedLaunchOpt, null);
});
test('zero usable owners never launches, shows reconnect, disables unready rows', async () => {
    const h = harness([{ ...owner('a'), enabled: false, needsReauth: true, actionStatus: 'reconnect' }]);
    await h.context.openPlayLauncher(game);
    assert.equal(h.calls.launches.length, 0); assert.equal(h.calls.switcher, 0);
    assert.equal(h.element('plLaunchBtn').disabled, true);
    assert.match(h.element('plAccountsSubtitle').textContent, /No synced Epic owner is ready/);
    assert.equal(h.rows[0].getAttribute('aria-disabled'), 'true');
    h.context.plSelectAccount('a'); assert.equal(h.context._plSelectedAccountId, null);
});
test('already imported alternate owner launches without import/download/copy', async () => {
    const runtime = new EpicLegendaryRuntimeService({ projectRoot: process.cwd() });
    runtime.findInstalled = () => ({ app_name: 'ep3', install_path: game.installPath });
    const calls = [];
    runtime.run = async (args, configPath) => { calls.push({ args, configPath }); return { code: 0 }; };
    const result = await runtime.launch({ appName: 'ep3', installPath: game.installPath, configPath: 'D:\\Config\\owner-b' });
    assert.equal(result.imported, false);
    assert.deepEqual(calls, [{ args: ['launch', 'ep3', '--skip-version-check'], configPath: 'D:\\Config\\owner-b' }]);
});
