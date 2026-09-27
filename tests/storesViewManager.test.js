'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const {
    StoresViewManager,
    PROVIDERS,
    normalizeProvider,
    classifyStoreUrl,
    safePartition,
    validateBounds,
} = require('../services/storesViewManager');
const { registerStoresHandlers } = require('../handlers/storesHandlers');

const ROOT = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'src/dashboard.html'), 'utf8');
const RENDERER = fs.readFileSync(path.join(ROOT, 'src/js/stores.js'), 'utf8');
const PRELOAD = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
const STORES_CSS = fs.readFileSync(path.join(ROOT, 'src/css/stores.css'), 'utf8');
const SIDEBAR = fs.readFileSync(path.join(ROOT, 'src/js/app/sidebar.js'), 'utf8');

function fixture(activeAccount = 'account-A') {
    const sessions = new Map();
    class FakeSession extends EventEmitter {
        setPermissionRequestHandler(handler) { this.permissionRequestHandler = handler; }
        setPermissionCheckHandler(handler) { this.permissionCheckHandler = handler; }
    }
    class FakeWebContents extends EventEmitter {
        constructor(options) {
            super();
            this.options = options;
            this.url = '';
            this.loading = false;
            this.closed = false;
            this.history = [];
            this.navigationHistory = {
                canGoBack: () => this.history.length > 1,
                canGoForward: () => false,
                goBack: () => { this.url = this.history[Math.max(0, this.history.length - 2)]; },
                goForward: () => {},
            };
        }
        async loadURL(url) { this.loading = true; this.url = url; this.history.push(url); this.emit('did-start-loading'); this.loading = false; this.emit('did-navigate'); this.emit('did-stop-loading'); }
        getURL() { return this.url; }
        getTitle() { return 'Store'; }
        isLoading() { return this.loading; }
        isDestroyed() { return this.closed; }
        reload() { this.reloaded = true; }
        stop() { this.stopped = true; }
        close() { this.closed = true; }
        setWindowOpenHandler(handler) { this.windowOpenHandler = handler; }
    }
    class FakeView {
        constructor(options) { this.options = options; this.webContents = new FakeWebContents(options); this.visible = false; }
        setVisible(value) { this.visible = value; }
        setBounds(value) { this.bounds = value; }
    }
    const children = [];
    const sent = [];
    const mainWindow = {
        contentView: {
            addChildView: view => children.push(view),
            removeChildView: view => { const i = children.indexOf(view); if (i >= 0) children.splice(i, 1); },
        },
        webContents: { send: (channel, value) => sent.push({ channel, value }) },
        isDestroyed: () => false,
    };
    const electron = {
        WebContentsView: FakeView,
        BrowserWindow: class {},
        session: { fromPartition: key => {
            if (!sessions.has(key)) sessions.set(key, new FakeSession());
            return sessions.get(key);
        } },
    };
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-stores-'));
    const external = [];
    const manager = new StoresViewManager({
        electron,
        mainWindow,
        userDataPath: temp,
        resolveActiveAccount: async () => activeAccount,
        shell: { openExternal: async url => external.push(url) },
        log: { warn() {} },
    });
    return { manager, temp, children, sessions, sent, external, cleanup: () => fs.rmSync(temp, { recursive: true, force: true }) };
}

test('Stores is directly below Home and above Library', () => {
    assert.ok(HTML.indexOf('id="nav-home"') < HTML.indexOf('id="nav-stores"'));
    assert.ok(HTML.indexOf('id="nav-stores"') < HTML.indexOf('id="sbSecLibrary"'));
});

test('provider homes are exact and arbitrary providers are rejected', async () => {
    assert.deepEqual(Object.fromEntries(Object.entries(PROVIDERS).map(([key, value]) => [key, value.home])), {
        steam: 'https://store.steampowered.com/',
        epic: 'https://store.epicgames.com/',
        gog: 'https://www.gog.com/',
    });
    assert.equal(normalizeProvider('other'), null);
    const f = fixture(); test.after(f.cleanup);
    await assert.rejects(() => f.manager.open('other'), { code: 'STORES_PROVIDER_INVALID' });
});

test('navigation allowlist blocks protocols, private networks, and cross-provider domains', () => {
    assert.equal(classifyStoreUrl('steam', 'https://store.steampowered.com/app/10').allowed, true);
    assert.equal(classifyStoreUrl('epic', 'https://accounts.epicgames.com/login').allowed, true);
    assert.equal(classifyStoreUrl('gog', 'https://login.gog.com/').allowed, true);
    for (const url of ['javascript:alert(1)', 'data:text/html,x', 'file:///c:/x', 'http://localhost/', 'https://127.0.0.1/', 'https://example.com/']) {
        assert.equal(classifyStoreUrl('steam', url).allowed, false, url);
    }
});

test('partitions are stable, account-scoped, provider-scoped, and contain no raw identity', () => {
    const a = safePartition('steam', 'private-user-name');
    assert.equal(a, safePartition('steam', 'private-user-name'));
    assert.notEqual(a, safePartition('steam', 'other'));
    assert.notEqual(a, safePartition('epic', 'private-user-name'));
    assert.doesNotMatch(a, /private-user-name/);
});

test('store view uses hardened webPreferences and no preload', async t => {
    const f = fixture(); t.after(f.cleanup);
    await f.manager.open('steam');
    const prefs = f.children[0].options.webPreferences;
    assert.equal(prefs.nodeIntegration, false);
    assert.equal(prefs.contextIsolation, true);
    assert.equal(prefs.sandbox, true);
    assert.equal(prefs.webSecurity, true);
    assert.equal('preload' in prefs, false);
    const ses = [...f.sessions.values()][0];
    let permitted = true;
    ses.permissionRequestHandler(null, 'camera', value => { permitted = value; });
    assert.equal(permitted, false);
    assert.equal(ses.permissionCheckHandler(), false);
});

test('approved auth popup keeps secure settings and external link uses shell safely', async t => {
    const f = fixture(); t.after(f.cleanup);
    await f.manager.open('epic');
    const wc = f.manager.view.webContents;
    const approved = wc.windowOpenHandler({ url: 'https://accounts.epicgames.com/login' });
    assert.equal(approved.action, 'allow');
    assert.equal(approved.overrideBrowserWindowOptions.webPreferences.session, [...f.sessions.values()][0]);
    assert.equal(approved.overrideBrowserWindowOptions.webPreferences.nodeIntegration, false);
    const denied = wc.windowOpenHandler({ url: 'https://example.com/help' });
    assert.equal(denied.action, 'deny');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(f.external, ['https://example.com/help']);
});

test('bounds validation, visibility, route restore, and cleanup are deterministic', async t => {
    const f = fixture(); t.after(f.cleanup);
    await f.manager.open('gog');
    assert.deepEqual(f.manager.setBounds({ x: 280, y: 160, width: 900, height: 600 }), { x: 280, y: 160, width: 900, height: 600 });
    assert.equal(f.manager.view.visible, true);
    f.manager.setVisible(false);
    assert.equal(f.manager.view.visible, false);
    await f.manager.open('gog', { visible: false });
    assert.equal(f.manager.view.visible, false);
    assert.equal(f.children.length, 1);
    assert.throws(() => f.manager.setBounds({ x: -1, y: 0, width: 1, height: 1 }), { code: 'STORES_BOUNDS_INVALID' });
    f.manager.destroy();
    assert.equal(f.children.length, 0);
    assert.equal(f.manager.view, null);
});

test('provider or active-account changes replace the isolated view and stale contents cannot emit current state', async t => {
    let active = 'A';
    const f = fixture(); t.after(f.cleanup);
    f.manager.resolveActiveAccount = async () => active;
    await f.manager.open('steam');
    const old = f.manager.view;
    active = 'B';
    f.manager.setVisible(false);
    await f.manager.accountChanged('steam');
    assert.notEqual(f.manager.view, old);
    assert.equal(f.manager.view.visible, false);
    assert.equal(old.webContents.closed, true);
    const sentBefore = f.sent.length;
    old.webContents.emit('did-stop-loading');
    assert.equal(f.sent.length, sentBefore);
});

test('renderer contract hides on navigation/modal, deduplicates state listener, throttles bounds, and ignores stale events', () => {
    assert.match(RENDERER, /hideStoresView[\s\S]*setStoreViewVisible/);
    assert.match(RENDERER, /MutationObserver\(setNativeVisible\)/);
    assert.match(RENDERER, /ResizeObserver\(queueBounds\)/);
    assert.match(RENDERER, /state\.generation < activeGeneration/);
    assert.match(RENDERER, /cancelAnimationFrame\(boundsFrame\)/);
    assert.match(PRELOAD, /_storeNavigationListenerAttached/);
    assert.match(PRELOAD, /return \(\) => _storeNavigationCallbacks\.delete\(callback\)/);
});

test('toolbar exposes real state controls without arbitrary URL loading', () => {
    for (const id of ['storeBack', 'storeForward', 'storeRefresh', 'storeCopy', 'storeOrigin', 'storeUrl', 'storeContentHost']) assert.match(HTML, new RegExp('id="' + id + '"'));
    for (const api of ['storeBack', 'storeForward', 'storeReload', 'storeStop', 'storeHome', 'storeOpenExternal', 'copyStoreUrl']) assert.match(PRELOAD, new RegExp(api));
    assert.doesNotMatch(PRELOAD, /loadStoreUrl|navigateStoreTo/);
    assert.match(HTML, /id="storeUrl" readonly/);
    assert.ok(STORES_CSS.includes('.store-refresh[data-mode="reload"] [data-stop-icon]'));
    assert.ok(STORES_CSS.includes('.store-refresh[data-mode="stop"] [data-refresh-icon]'));
    assert.ok(STORES_CSS.includes('.stores-provider[data-store-provider="epic"] img'));
    assert.ok(STORES_CSS.includes('filter: brightness(0) invert(1)'));
});

test('copy URL accepts only the current provider generation and committed safe URL', async t => {
    const f = fixture(); t.after(f.cleanup);
    const opened = await f.manager.open('steam');
    const url = f.manager.view.webContents.getURL();
    assert.deepEqual(f.manager.copyCurrentUrl({ provider: 'steam', generation: opened.generation, url }), {
        ok: true,
        provider: 'steam',
        generation: opened.generation,
        url,
    });
    assert.deepEqual(f.manager.copyCurrentUrl({ provider: 'epic', generation: opened.generation, url }), {
        ok: false,
        error: 'stale_or_invalid_url',
    });
});

test('sidebar keeps the first five canonical rows before More platforms', () => {
    assert.match(SIDEBAR, /SIDEBAR_PRIMARY_PLATFORM_LIMIT = 5/);
    const ids = [...HTML.matchAll(/class="nav-item sb-sub-item platform-item(?: sb-account-extra)?" id="nav-([^"]+)"/g)].map(match => match[1]);
    assert.deepEqual(ids.slice(0, 8), ['steam', 'epic', 'gog', 'ea', 'riot', 'rockstar', 'ubisoft', 'discord']);
    assert.ok(HTML.includes('class="nav-item sb-sub-item platform-item" id="nav-ea"'));
    assert.ok(HTML.includes('class="nav-item sb-sub-item platform-item" id="nav-riot"'));
});

test('IPC rejects untrusted senders and invalid commands before reaching manager', async () => {
    const handlers = new Map();
    const mainWindow = { webContents: {} };
    const copied = [];
    const manager = {
        open() {},
        command() {},
        openExternal() {},
        copyCurrentUrl: () => ({ ok: true, url: 'https://store.steampowered.com/' }),
        setBounds() {},
        setVisible() {},
    };
    registerStoresHandlers(
        { handle: (name, fn) => handlers.set(name, fn) },
        { getManager: () => manager, getMainWindow: () => mainWindow, clipboard: { writeText: value => copied.push(value) } },
    );
    await assert.rejects(() => handlers.get('stores:open')({ sender: {} }, 'steam'), { code: 'STORES_SENDER_INVALID' });
    await assert.rejects(() => handlers.get('stores:command')({ sender: mainWindow.webContents }, 'eval'), { code: 'STORES_COMMAND_INVALID' });
    const result = await handlers.get('stores:copy-url')({ sender: mainWindow.webContents }, {});
    assert.equal(result.ok, true);
    assert.deepEqual(copied, ['https://store.steampowered.com/']);
});
