'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const { app, BrowserWindow, WebContentsView, session, shell } = require('electron');
const { StoresViewManager } = require('../../services/storesViewManager');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-stores-electron-'));
const resultPath = process.env.BADDEL_STORES_SMOKE_RESULT || null;
app.setPath('userData', temp);

function waitForLoad(contents, timeoutMs = 45000) {
    return new Promise(resolve => {
        const timer = setTimeout(() => finish({ status: 'timeout' }), timeoutMs);
        const finish = result => {
            clearTimeout(timer);
            contents.removeListener('did-stop-loading', stopped);
            contents.removeListener('did-fail-load', failed);
            resolve(result);
        };
        const stopped = () => finish({ status: 'loaded' });
        const failed = (_event, code, description, url, mainFrame) => {
            if (mainFrame && code !== -3) finish({ status: 'failed', code, description: String(description || '').slice(0, 120), url });
        };
        contents.once('did-stop-loading', stopped);
        contents.on('did-fail-load', failed);
    });
}

app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: true, width: 1100, height: 760, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
    await win.loadURL('data:text/html,<body style=background:%23111111></body>');
    const sent = [];
    const originalSend = win.webContents.send.bind(win.webContents);
    win.webContents.send = (channel, payload) => { sent.push({ channel, payload }); return originalSend(channel, payload); };
    const manager = new StoresViewManager({
        electron: { BrowserWindow, WebContentsView, session },
        mainWindow: win,
        userDataPath: temp,
        resolveActiveAccount: async provider => 'smoke-' + provider,
        shell,
        log: { warn() {} },
    });
    const results = [];
    let steamPartition = null;
    for (const provider of ['steam', 'epic', 'gog']) {
        const opening = manager.open(provider);
        while (!manager.view) await new Promise(resolve => setTimeout(resolve, 10));
        manager.setBounds({ x: 20, y: 20, width: 1000, height: 680 });
        if (provider === 'steam') steamPartition = manager.scopeKey;
        const loaded = waitForLoad(manager.view.webContents);
        await opening.catch(() => {});
        const outcome = await loaded;
        const wc = manager.view.webContents;
        const security = await wc.executeJavaScript("({processType:typeof process,apiType:typeof window.electronAPI,nodeType:typeof require})", true).catch(() => null);
        const image = await wc.capturePage();
        const bitmap = image.toBitmap();
        let nonBlank = false;
        for (let i = 0; i < bitmap.length; i += Math.max(4, Math.floor(bitmap.length / 2000))) {
            if (bitmap[i] !== 0 || bitmap[i + 1] !== 0 || bitmap[i + 2] !== 0) { nonBlank = true; break; }
        }
        results.push({ provider, outcome, url: wc.getURL(), title: wc.getTitle(), security, nonBlank, visible: manager.view.getVisible?.() ?? true });
    }
    const steamSession = session.fromPartition(steamPartition);
    await steamSession.cookies.set({ url: 'https://store.steampowered.com/', name: 'baddel_isolation_probe', value: 'steam' });
    await manager.open('epic');
    const epicCookies = await session.fromPartition(manager.scopeKey).cookies.get({ name: 'baddel_isolation_probe' });
    const isolation = epicCookies.length === 0;
    manager.setVisible(false);
    const hidden = manager.view.getVisible?.() === false;
    manager.destroy();
    const report = { results, isolation, hidden, destroyed: manager.view === null };
    if (resultPath) fs.writeFileSync(resultPath, JSON.stringify(report, null, 2));
    console.log('STORES_ELECTRON_SMOKE=' + JSON.stringify(report));
    win.destroy();
    app.quit();
}).catch(error => {
    const message = String(error?.stack || error);
    if (resultPath) fs.writeFileSync(resultPath, JSON.stringify({ error: message }, null, 2));
    console.error('STORES_ELECTRON_SMOKE_ERROR=' + message);
    app.exit(1);
});
