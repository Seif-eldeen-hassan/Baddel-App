'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const {
    GogAuthService,
    GOG_AUTH_URL,
    isGogAuthCallback,
    isSafeExternalAuthUrl,
    resolveGogAuthShellPath,
} = require('../src/features/sync/infrastructure/integrations/gog/GogAuthService');

test('GOG auth shell resolver selects the file that exists in each runtime layout', () => {
    const winPath = path.win32;
    const packagedRoot = 'C:\\Program Files\\Baddel\\resources\\app.asar';
    const protectedShell = winPath.join(packagedRoot, 'gog-auth-shell.html');
    const standardShell = winPath.join(packagedRoot, 'src', 'gog-auth-shell.html');
    const devRoot = 'E:\\Baddel\\Baddel-App';
    const devShell = winPath.join(devRoot, 'src', 'gog-auth-shell.html');

    assert.equal(resolveGogAuthShellPath({
        projectRoot: packagedRoot,
        isPackaged: true,
        path: winPath,
        fsSync: { existsSync: (candidate) => candidate === protectedShell },
    }), protectedShell);
    assert.equal(resolveGogAuthShellPath({
        projectRoot: packagedRoot,
        isPackaged: true,
        path: winPath,
        fsSync: { existsSync: (candidate) => candidate === standardShell },
    }), standardShell);
    assert.equal(resolveGogAuthShellPath({
        projectRoot: devRoot,
        isPackaged: false,
        path: winPath,
        fsSync: { existsSync: (candidate) => candidate === devShell },
    }), devShell);
});

test('GOG auth shell resolver fails before opening a broken login window', () => {
    assert.throws(
        () => resolveGogAuthShellPath({
            projectRoot: 'C:\\missing\\resources\\app.asar',
            isPackaged: true,
            path: path.win32,
            fsSync: { existsSync: () => false },
        }),
        (err) => err?.code === 'GOG_AUTH_SHELL_NOT_FOUND'
    );
});

class FakeContents extends EventEmitter {
    constructor() {
        super();
        this.windowOpenHandler = null;
        this.loadedUrl = null;
        this.closed = false;
    }
    setWindowOpenHandler(handler) { this.windowOpenHandler = handler; }
    async loadURL(url) { this.loadedUrl = url; }
    close() { this.closed = true; }
}

class FakeWebContentsView {
    static instances = [];
    constructor(options) {
        this.options = options;
        this.webContents = new FakeContents();
        this.bounds = null;
        this.background = null;
        FakeWebContentsView.instances.push(this);
    }
    setBounds(bounds) { this.bounds = bounds; }
    setBackgroundColor(color) { this.background = color; }
}

class FakeBrowserWindow extends EventEmitter {
    static instances = [];
    constructor(options) {
        super();
        this.options = options;
        this.webContents = new FakeContents();
        this.destroyed = false;
        this.shown = false;
        this.menu = 'native';
        this.menuVisible = true;
        this.removedMenu = false;
        this.loadedFile = null;
        this.children = [];
        this.contentView = {
            addChildView: view => this.children.push(view),
            removeChildView: view => { this.children = this.children.filter(item => item !== view); },
        };
        FakeBrowserWindow.instances.push(this);
    }
    setMenu(value) { this.menu = value; }
    removeMenu() { this.removedMenu = true; }
    setMenuBarVisibility(value) { this.menuVisible = value; }
    getContentBounds() { return { width: this.options.width, height: this.options.height }; }
    async loadFile(file) { this.loadedFile = file; }
    show() { this.shown = true; }
    isDestroyed() { return this.destroyed; }
    close() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.emit('closed');
    }
}

function makeService() {
    FakeBrowserWindow.instances = [];
    FakeWebContentsView.instances = [];
    const cleared = [];
    const service = new GogAuthService({
        BrowserWindow: FakeBrowserWindow,
        WebContentsView: FakeWebContentsView,
        session: { fromPartition: partition => ({ clearStorageData: async () => cleared.push(partition) }) },
        shellPath: 'C:\\app\\src\\gog-auth-shell.html',
        windowIcon: 'C:\\app\\Logo.ico',
    });
    return { service, cleared };
}

function navigationEvent() {
    return { prevented: false, preventDefault() { this.prevented = true; } };
}

test('GOG auth preserves the original official login URL', () => {
    const url = new URL(GOG_AUTH_URL);
    assert.equal(url.hostname, 'login.gog.com');
    assert.equal(url.pathname, '/auth');
    assert.equal(url.searchParams.get('layout'), 'client2');
});

test('GOG auth window is frameless, menu-free, centered, hidden, and revealed only when both surfaces are ready', async () => {
    const { service } = makeService();
    const parent = { isDestroyed: () => false, getBounds: () => ({ x: 100, y: 50, width: 1400, height: 900 }) };
    const result = service._openLoginWindow(parent);
    const win = FakeBrowserWindow.instances[0];
    const view = FakeWebContentsView.instances[0];

    assert.equal(win.options.show, false);
    assert.equal(win.options.frame, false);
    assert.equal(win.options.autoHideMenuBar, true);
    assert.equal(win.options.icon, 'C:\\app\\Logo.ico');
    assert.equal(win.menu, null);
    assert.equal(win.removedMenu, true);
    assert.equal(win.menuVisible, false);
    assert.deepEqual([win.options.x, win.options.y], [340, 120]);
    assert.equal(win.shown, false);
    assert.match(view.options.webPreferences.partition, /^temp:gog-auth-/);
    assert.equal(view.options.webPreferences.nodeIntegration, false);
    assert.equal(view.options.webPreferences.contextIsolation, true);
    assert.equal(view.options.webPreferences.sandbox, true);
    assert.deepEqual(view.bounds, { x: 0, y: 84, width: 920, height: 676 });
    assert.equal(view.background, null, 'the official GOG page must keep its own background');
    assert.equal(view.webContents.loadedUrl, GOG_AUTH_URL);

    win.webContents.emit('did-finish-load');
    assert.equal(win.shown, false);
    view.webContents.emit('dom-ready');
    assert.equal(win.shown, true);

    view.webContents.emit('will-redirect', navigationEvent(), 'https://embed.gog.com/on_login_success?code=abc%20123');
    assert.equal(await result, 'abc 123');
});

test('GOG auth view opens secure provider popups, blocks unsafe URLs, and captures only the official callback', async () => {
    const first = makeService();
    const firstResult = first.service._openLoginWindow(null);
    const firstWindow = FakeBrowserWindow.instances[0];
    const firstView = FakeWebContentsView.instances[0];
    assert.deepEqual(firstView.webContents.windowOpenHandler({ url: 'file:///unsafe' }), { action: 'deny' });
    const providerPopup = firstView.webContents.windowOpenHandler({ url: 'https://accounts.google.com/o/oauth2/auth' });
    assert.equal(providerPopup.action, 'allow');
    assert.equal(providerPopup.overrideBrowserWindowOptions.icon, 'C:\\app\\Logo.ico');
    assert.equal(providerPopup.overrideBrowserWindowOptions.webPreferences.partition, firstView.options.webPreferences.partition);
    const blocked = navigationEvent();
    firstView.webContents.emit('will-navigate', blocked, 'https://attacker.invalid/login');
    assert.equal(blocked.prevented, true);
    const allowed = navigationEvent();
    firstView.webContents.emit('will-navigate', allowed, 'https://login.gog.com/auth');
    assert.equal(allowed.prevented, false);
    firstView.webContents.emit('did-navigate-in-page', {}, 'https://embed.gog.com/on_login_success#?code=redirect-code');
    assert.equal(await firstResult, 'redirect-code');
    assert.equal(first.cleared.length, 1);
    assert.equal(firstView.webContents.closed, true);

    const second = makeService();
    const cancelled = second.service._openLoginWindow(null);
    FakeBrowserWindow.instances[0].close();
    await assert.rejects(cancelled, error => error?.code === 'GOG_LOGIN_CANCELLED');
    assert.equal(second.cleared.length, 1);
});

test('GOG callback and external auth URL validation are strict', () => {
    assert.equal(isGogAuthCallback('https://embed.gog.com/on_login_success?code=ok'), true);
    assert.equal(isGogAuthCallback('https://attacker.invalid/on_login_success?code=stolen'), false);
    assert.equal(isSafeExternalAuthUrl('https://accounts.google.com/o/oauth2/auth'), true);
    assert.equal(isSafeExternalAuthUrl('http://accounts.google.com/o/oauth2/auth'), false);
    assert.equal(isSafeExternalAuthUrl('javascript:alert(1)'), false);
});

test('local GOG shell contains Baddel branding, loading state, and close control without Electron branding', () => {
    const shell = fs.readFileSync(path.join(__dirname, '../src/gog-auth-shell.html'), 'utf8');
    assert.match(shell, /Connect GOG Account/);
    assert.match(shell, /Secure sign-in via GOG\.com/);
    assert.match(shell, /\.\.\/assets\/app_icon\.png/);
    assert.match(shell, /auth-loading/);
    assert.match(shell, /window\.close\(\)/);
    assert.doesNotMatch(shell, />\s*Electron\s*</i);
});
