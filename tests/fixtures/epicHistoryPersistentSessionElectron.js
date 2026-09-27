'use strict';

const path = require('path');
const { app, BrowserWindow, ipcMain, session } = require('electron');

for (const channel of ['get-image-cache-dir-url-sync', 'get-artwork-cache-dir-url-sync', 'get-user-artwork-dir-url-sync']) {
    ipcMain.on(channel, (event) => { event.returnValue = ''; });
}

const [mode, userDataPath, rootPath] = process.argv.slice(2);
app.setPath('userData', userDataPath);
app.commandLine.appendSwitch('disable-gpu');

function output(payload) {
    process.stdout.write('EPIC_HISTORY_ELECTRON_FIXTURE=' + JSON.stringify(payload) + '\n');
}

app.whenReady().then(async () => {
    const accountA = session.fromPartition('persist:baddel-epic-history-fixture-a', { cache: true });
    const accountB = session.fromPartition('persist:baddel-epic-history-fixture-b', { cache: true });
    if (mode === 'seed') {
        await accountA.cookies.set({
            url: 'https://www.epicgames.com/',
            name: 'baddel_history_fixture',
            value: 'non-sensitive-fixture-marker',
            secure: true,
            httpOnly: true,
            sameSite: 'lax',
            expirationDate: Math.floor(Date.now() / 1000) + 3600,
        });
        await accountA.cookies.flushStore();
        output({ mode, seeded: true });
        app.exit(0);
        return;
    }

    const [cookiesA, cookiesB] = await Promise.all([
        accountA.cookies.get({ url: 'https://www.epicgames.com/' }),
        accountB.cookies.get({ url: 'https://www.epicgames.com/' }),
    ]);
    const win = new BrowserWindow({
        show: false,
        webPreferences: {
            preload: path.join(rootPath, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        },
    });
    await win.loadFile(path.join(rootPath, 'src', 'dashboard.html'));
    const rendered = await win.webContents.executeJavaScript(`(() => {
        const modal = document.getElementById('vaultEpicAuthModal');
        const actions = document.getElementById('vaultEpicAuthActions');
        const waiting = document.getElementById('vaultEpicAuthWaiting');
        modal.classList.add('active');
        actions.hidden = true;
        waiting.hidden = false;
        return {
            actionsDisplay: getComputedStyle(actions).display,
            waitingDisplay: getComputedStyle(waiting).display,
            preloadExposed: typeof window.electronAPI?.platformSyncRefreshEpicPurchaseHistory === 'function'
                && typeof window.electronAPI?.onEpicPurchaseHistoryRefreshState === 'function',
        };
    })()`);
    output({
        mode,
        accountAHasFixtureCookie: cookiesA.some((cookie) => cookie.name === 'baddel_history_fixture'),
        accountBHasFixtureCookie: cookiesB.some((cookie) => cookie.name === 'baddel_history_fixture'),
        rendered,
    });
    win.destroy();
    app.exit(0);
}).catch((error) => {
    output({ mode, error: error?.message || String(error) });
    app.exit(1);
});
