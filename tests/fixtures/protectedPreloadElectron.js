'use strict';

const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');

const [protectedDir, userDataPath] = process.argv.slice(2);
app.setPath('userData', userDataPath);
app.commandLine.appendSwitch('disable-gpu');

for (const channel of ['get-image-cache-dir-url-sync', 'get-artwork-cache-dir-url-sync', 'get-user-artwork-dir-url-sync']) {
    ipcMain.on(channel, (event) => { event.returnValue = ''; });
}
ipcMain.handle('platform-sync:refresh-epic-purchase-history', (_event, accountId, options) => ({ accountId, options }));
ipcMain.handle('platform-sync:epic-purchase-history-renderer-hydrated', (_event, accountId, operationId, details) => ({ accountId, operationId, details }));

function output(payload) {
    process.stdout.write('PROTECTED_PRELOAD_ELECTRON=' + JSON.stringify(payload) + '\n');
}

app.whenReady().then(async () => {
    const win = new BrowserWindow({
        show: false,
        webPreferences: {
            preload: path.join(protectedDir, 'preload.bundle.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        },
    });
    await win.loadURL('data:text/html,<html><body>protected preload runtime</body></html>');
    const contract = await win.webContents.executeJavaScript(`(async () => {
        const api = window.electronAPI;
        const refresh = await api.platformSyncRefreshEpicPurchaseHistory('account-a', {
            allowInteractiveLogin: true,
            operationId: 'protected-operation-1',
        });
        const hydrated = await api.platformSyncConfirmEpicPurchaseHistoryHydrated(
            'account-a', 'protected-operation-1', { durationMs: 12.5 }
        );
        window.__historyState = null;
        window.__removeHistoryState = api.onEpicPurchaseHistoryRefreshState((payload) => {
            window.__historyState = payload;
        });
        return {
            types: {
                refresh: typeof api.platformSyncRefreshEpicPurchaseHistory,
                state: typeof api.onEpicPurchaseHistoryRefreshState,
                hydrated: typeof api.platformSyncConfirmEpicPurchaseHistoryHydrated,
            },
            refresh,
            hydrated,
        };
    })()`);
    win.webContents.send('epic-purchase-history-refresh-state', { phase: 'session_verified', operationId: 'protected-operation-1' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    contract.statePayload = await win.webContents.executeJavaScript('window.__historyState');
    output(contract);
    win.destroy();
    app.exit(0);
}).catch((error) => {
    output({ error: error?.message || String(error) });
    app.exit(1);
});
