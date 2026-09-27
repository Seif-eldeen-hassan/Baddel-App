'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { createAccountSaveHandler } = require('../../services/accountSaveContract');

const root = path.resolve(__dirname, '..', '..');
const panelsSource = fs.readFileSync(path.join(root, 'src', 'js', 'accounts', 'platform-panels.js'), 'utf8');
const mainCalls = [];

app.setPath('userData', fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'baddel-save-boundary-')));
app.on('window-all-closed', () => {});
for (const channel of ['get-image-cache-dir-url-sync', 'get-artwork-cache-dir-url-sync', 'get-user-artwork-dir-url-sync']) {
    ipcMain.on(channel, event => { event.returnValue = ''; });
}
const saveGogHandler = createAccountSaveHandler(async accountName => {
    mainCalls.push({ boundary: 'main-service', name: accountName, type: typeof accountName });
    if (accountName === 'failure name') throw Object.assign(new Error('fixture persistence failed'), { code: 'PERSIST_FAILED' });
    return { status: 'success', profile: { displayName: accountName } };
});
ipcMain.handle('save-gog-account', async (...args) => {
    try { return await saveGogHandler(...args); }
    catch (error) { return { status: 'error', code: error.code, message: error.message }; }
});
ipcMain.handle('add-new-gog-account', async () => ({
    status: 'error',
    code: 'LAUNCH_FAILED',
    message: 'GOG Galaxy could not be opened.',
}));

async function runCase(shouldFail) {
    const win = new BrowserWindow({
        show: false,
        webPreferences: { preload: path.join(root, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false },
    });
    await win.loadURL('data:text/html,<html><body></body></html>');
    await win.webContents.executeJavaScript(`
        window.isAccountProcessing = false;
        window.currentAccountPlatform = 'gog';
        window.currentSidebarSection = 'accounts';
        window.__calls = [];
        window.__toasts = [];
        window.showToast = (message, type) => window.__toasts.push({ message, type });
        window.loadAccountsForPlatform = async platform => window.__calls.push({ boundary: 'reload', platform });
        true;
    `);
    await win.webContents.executeJavaScript(`${panelsSource}\ntrue;`);
    await win.webContents.executeJavaScript(`loadAccountsForPlatform = async platform => window.__calls.push({ boundary: 'reload', platform }); true;`);

    await win.webContents.executeJavaScript(`void (window.__pending = handleSaveAccount('gog'))`);
    await win.webContents.executeJavaScript(`new Promise(resolve => {
        const wait = () => document.querySelector('input') ? resolve() : setTimeout(wait, 5);
        wait();
    })`);
    await win.webContents.executeJavaScript(`(() => {
        const input = document.querySelector('input');
        input.value = ${JSON.stringify(shouldFail ? 'failure name' : 'gg')};
        const save = [...document.querySelectorAll('button')].find(button => button.textContent === 'Save');
        save.click();
    })()`);
    await win.webContents.executeJavaScript(`window.__pending`);
    const result = await win.webContents.executeJavaScript(`({ calls: window.__calls, toasts: window.__toasts, processing: window.isAccountProcessing })`);
    win.destroy();
    return { ...result, mainCalls: mainCalls.splice(0) };
}

async function runOpenFailureCase() {
    const win = new BrowserWindow({
        show: false,
        webPreferences: { preload: path.join(root, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false },
    });
    await win.loadURL('data:text/html,<html><body></body></html>');
    await win.webContents.executeJavaScript(`
        window.isAccountProcessing = false;
        window.__toasts = [];
        window.showToast = (message, type) => window.__toasts.push({ message, type });
        true;
    `);
    await win.webContents.executeJavaScript(`${panelsSource}\ntrue;`);
    await win.webContents.executeJavaScript(`void (window.__pending = addNewAccount('gog'))`);
    await win.webContents.executeJavaScript(`window.__pending`);
    const result = await win.webContents.executeJavaScript(`({ toasts: window.__toasts, processing: window.isAccountProcessing })`);
    win.destroy();
    return result;
}

app.whenReady().then(async () => {
    const result = { success: await runCase(false), failure: await runCase(true), openFailure: await runOpenFailureCase() };
    process.stdout.write(`ACCOUNT_SAVE_BOUNDARY_RESULT=${JSON.stringify(result)}\n`);
    app.quit();
}).catch(error => {
    process.stderr.write(`${error.stack || error}\n`);
    app.exit(1);
});
