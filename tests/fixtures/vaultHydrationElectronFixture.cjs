'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { PlatformSyncCacheRepository } = require('../../src/features/sync/infrastructure/repositories/PlatformSyncCacheRepository');
const { EpicVaultHydrationService } = require('../../src/features/sync/application/services/EpicVaultHydrationService');

const root = path.resolve(__dirname, '../..');
const userDataPath = path.resolve(process.env.VAULT_TEST_USER_DATA);
app.setPath('userData', userDataPath);
fs.mkdirSync(userDataPath, { recursive: true });
const traceFile = path.join(userDataPath, 'fixture-trace.log');
const trace = (stage) => fs.appendFileSync(traceFile, new Date().toISOString() + ' ' + stage + '\n');
trace('process-start');
const hardStop = setTimeout(() => { trace('hard-timeout'); app.exit(2); }, 12000);

function register(service) {
    ipcMain.removeHandler('platform-sync:get-epic-vault');
    ipcMain.handle('platform-sync:get-epic-vault', () => service.handle());
}

async function rendererRequest(win, expectedUserDataPath = '') {
    return win.webContents.executeJavaScript(`(async () => {
        const status = document.getElementById('status');
        status.dataset.state = 'loading';
        status.textContent = 'Reading your Vault';
        try {
            const response = await window.VaultHydrationClient.requestSnapshot(window.electronAPI, {
                timeoutMs: 180,
                expectedUserDataPath: ${JSON.stringify(expectedUserDataPath)},
            });
            status.dataset.state = response.vault.accounts.length ? 'success' : 'empty';
            status.textContent = status.dataset.state;
            return { state: status.dataset.state, response };
        } catch (error) {
            status.dataset.state = 'error';
            status.textContent = error.code || 'VAULT_ERROR';
            return { state: status.dataset.state, code: error.code, message: error.message };
        }
    })()`, true);
}

app.whenReady().then(async () => {
    trace('app-ready');
    const repository = new PlatformSyncCacheRepository({ userDataDir: app.getPath('userData') });
    await repository.ensureDirs();
    trace('repository-ready');
    if (process.env.VAULT_TEST_SEED === '1') {
        await repository.writeEpicVault({ accounts: [{ accountId: 'runtime-account', vaultRevision: 1, games: Array.from({ length: 606 }, (_, index) => ({ vaultCanonicalKey: 'game-' + index })) }] });
    }
    trace('seed-complete');
    for (const channel of ['get-image-cache-dir-url-sync', 'get-artwork-cache-dir-url-sync', 'get-user-artwork-dir-url-sync']) {
        ipcMain.on(channel, event => { event.returnValue = 'file:///' + userDataPath.replace(/\\/g, '/'); });
    }
    const win = new BrowserWindow({
        show: false,
        webPreferences: { preload: path.join(root, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    trace('window-created');
    await win.loadFile(path.join(__dirname, 'vaultHydrationRenderer.html'));
    trace('window-loaded');
    await win.webContents.executeJavaScript(fs.readFileSync(path.join(root, 'src/js/vault-hydration-client.js'), 'utf8'));
    trace('client-injected');
    const makeService = (readSnapshot, overrides = {}) => new EpicVaultHydrationService({
        readSnapshot,
        userDataPath: app.getPath('userData'),
        snapshotPath: repository.epicVaultFile,
        timeoutMs: 100,
        ...overrides,
    });
    const results = {};

    register(makeService(async () => ({ vault: await repository.readEpicVault(), stages: [{ name: 'repository.readEpicVault', status: 'success' }] })));
    results.saved = await rendererRequest(win);
    trace('saved-' + results.saved.state);

    register(makeService(async () => ({ vault: { accounts: [] }, stages: [] })));
    results.missing = await rendererRequest(win);

    register(makeService(async () => { const error = new Error('fixture read failed'); error.code = 'VAULT_REPOSITORY_READ_FAILED'; throw error; }));
    results.repositoryFailure = await rendererRequest(win);

    register(makeService(() => new Promise(() => {})));
    results.neverSettles = await rendererRequest(win);

    ipcMain.removeHandler('platform-sync:get-epic-vault');
    results.handlerMissing = await rendererRequest(win);

    register(makeService(async () => ({ vault: { accounts: [] }, stages: [] }), { userDataPath: path.join(userDataPath, 'other') }));
    results.userDataMismatch = await rendererRequest(win, userDataPath);

    trace('all-scenarios-complete');
    clearTimeout(hardStop);
    process.stdout.write('VAULT_ELECTRON_RESULT ' + JSON.stringify({ userDataPath: app.getPath('userData'), snapshotPath: repository.epicVaultFile, results }) + '\n');
    win.destroy();
    app.quit();
}).catch(error => {
    process.stderr.write(String(error?.stack || error) + '\n');
    app.exit(1);
});
