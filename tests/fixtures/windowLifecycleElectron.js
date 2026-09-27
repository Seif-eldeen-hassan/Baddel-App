'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, WebContentsView, session } = require('electron');
const { pathToFileURL } = require('node:url');
const { GogAuthService } = require('../../src/features/sync/infrastructure/integrations/gog/GogAuthService');

const root = path.resolve(__dirname, '..', '..');
const runtime = process.env.BADDEL_WINDOW_RUNTIME || 'source';
const resultPrefix = 'WINDOW_LIFECYCLE_RESULT=';
const tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-window-lifecycle-'));
const loaderWindows = [];
app.setPath('userData', tempUserData);
app.on('window-all-closed', () => {});

function waitUntil(predicate, timeoutMs = 10000, label = 'Electron window state') {
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
        const poll = () => {
            const value = predicate();
            if (value) return resolve(value);
            if (Date.now() - startedAt >= timeoutMs) return reject(new Error(`Timed out waiting for ${label}.`));
            setTimeout(poll, 20);
        };
        poll();
    });
}

async function inspectLoader(htmlPath, dimensions, zoomFactor) {
    const source = fs.readFileSync(htmlPath, 'utf8');
    const baseUrl = pathToFileURL(`${path.dirname(htmlPath)}${path.sep}`).href;
    const fixtureHtml = source
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace('<head>', `<head><base href="${baseUrl}">`);
    const isolatedHtmlPath = path.join(tempUserData, `loader-${dimensions.width}-${zoomFactor}.html`);
    fs.writeFileSync(isolatedHtmlPath, fixtureHtml);
    const win = new BrowserWindow({
        show: false,
        frame: false,
        width: dimensions.width,
        height: dimensions.height,
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
    });
    await win.loadFile(isolatedHtmlPath);
    win.webContents.setZoomFactor(zoomFactor);
    await new Promise(resolve => setTimeout(resolve, 50));
    const geometry = await win.webContents.executeJavaScript(`(() => {
        const loader = document.getElementById('mainLoader').getBoundingClientRect();
        const center = document.getElementById('splashCenter').getBoundingClientRect();
        return {
            viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
            loader: { left: loader.left, top: loader.top, width: loader.width, height: loader.height },
            centerDelta: {
                x: center.left + center.width / 2 - innerWidth / 2,
                y: center.top + center.height / 2 - innerHeight / 2,
            },
        };
    })()`, true);
    loaderWindows.push(win);
    return { dimensions, zoomFactor, ...geometry };
}

async function inspectGogWindow(shellPath) {
    let initialShow = null;
    let createdWindow = null;
    let showCalls = 0;
    let menuSetToNull = false;
    let menuRemoved = false;
    let storageCleared = false;
    class TrackedBrowserWindow extends BrowserWindow {
        constructor(options) {
            super(options);
            initialShow = options.show;
            createdWindow = this;
        }
        show() {
            showCalls += 1;
            return super.show();
        }
        setMenu(menu) {
            if (menu === null) menuSetToNull = true;
            return super.setMenu(menu);
        }
        removeMenu() {
            menuRemoved = true;
            return super.removeMenu();
        }
    }
    const trackedSession = {
        fromPartition(partition) {
            const target = session.fromPartition(partition);
            return {
                async clearStorageData() {
                    await target.clearStorageData();
                    storageCleared = true;
                },
            };
        },
    };
    const service = new GogAuthService({
        BrowserWindow: TrackedBrowserWindow,
        WebContentsView,
        session: trackedSession,
        shellPath,
        authUrl: 'data:text/html,<html><body style="margin:0;background:%230b0d0c;color:white">GOG fixture</body></html>',
    });
    const resultPromise = service._openLoginWindow(null);
    const win = await waitUntil(() => createdWindow, 10000, 'GOG window creation');
    const hiddenBeforeReady = !win.isVisible();
    await waitUntil(() => win.isVisible(), 10000, 'GOG ready reveal');
    const child = win.contentView.children[0];
    const shell = await win.webContents.executeJavaScript(`({
        title: document.querySelector('.auth-title')?.textContent,
        subtitle: document.querySelector('.auth-subtitle')?.textContent,
        closeLabel: document.querySelector('.auth-close')?.getAttribute('aria-label')
    })`, true);
    const report = {
        initialShow,
        hiddenBeforeReady,
        showCalls,
        menuIsNull: menuSetToNull && menuRemoved,
        menuBarVisible: win.isMenuBarVisible(),
        shell,
        childBounds: child?.getBounds?.() || null,
        childCount: win.contentView.children.length,
    };
    await win.webContents.executeJavaScript("document.querySelector('.auth-close').click()", true);
    let cancellationCode = null;
    try { await resultPromise; } catch (error) { cancellationCode = error?.code || null; }
    report.cancellationCode = cancellationCode;
    report.storageCleared = storageCleared;
    return report;
}

app.whenReady().then(async () => {
    const packagedRoot = path.join(root, 'dist', 'win-unpacked', 'resources', 'app.asar');
    const htmlPath = runtime === 'packaged'
        ? path.join(packagedRoot, 'index.html')
        : runtime === 'protected'
            ? path.join(root, '.protected-build', 'app', 'index.html')
            : path.join(root, 'src', 'dashboard.html');
    const shellPath = runtime === 'packaged'
        ? path.join(packagedRoot, 'gog-auth-shell.html')
        : runtime === 'protected'
            ? path.join(root, '.protected-build', 'app', 'gog-auth-shell.html')
            : path.join(root, 'src', 'gog-auth-shell.html');
    const loaders = [];
    loaders.push(await inspectLoader(htmlPath, { width: 1280, height: 800 }, 1));
    loaders.push(await inspectLoader(htmlPath, { width: 1920, height: 1080 }, 1.25));
    for (const win of loaderWindows) win.destroy();
    const gog = await inspectGogWindow(shellPath);
    process.stdout.write(`${resultPrefix}${JSON.stringify({ runtime, loaders, gog })}\n`);
    app.quit();
}).catch(error => {
    process.stderr.write(`${error?.stack || error}\n`);
    app.exit(1);
});
