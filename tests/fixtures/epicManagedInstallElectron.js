'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { app, BrowserWindow, ipcMain } = require('electron');
const { JsonGameRepository } = require('../../src/features/games/infrastructure/repositories/JsonGameRepository');
const { JsonDownloadRepository } = require('../../src/features/downloads/infrastructure/repositories/JsonDownloadRepository');
const { DownloadCompletionLibraryRegistrar } = require('../../src/features/downloads/infrastructure/services/DownloadCompletionLibraryRegistrar');
const { DownloadQueueManager } = require('../../src/features/downloads/infrastructure/services/DownloadQueueManager');
const { registerDownloadsIpc } = require('../../src/features/downloads/infrastructure/ipc/downloads.ipc');

const projectRoot = path.resolve(__dirname, '..', '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-epic-electron-'));
app.setPath('userData', profile);
app.on('window-all-closed', () => {});
for (const channel of ['get-image-cache-dir-url-sync', 'get-artwork-cache-dir-url-sync', 'get-user-artwork-dir-url-sync']) {
    ipcMain.on(channel, event => { event.returnValue = ''; });
}

function gameApi() {
    const repository = new JsonGameRepository({
        fs, path, crypto, databasePath: path.join(profile, 'games-db.json'),
        logger: { log() {}, error() {} }, keyResolver: game => game.installedGameKey,
    });
    return { repository, api: {
        getAllGames: () => repository.getAllGames(), getSavedGames: () => repository.getSavedGames(),
        async upsertGame(game) { repository.upsertGameRecord(game); },
        saveDatabase: () => repository.saveDatabase(), flushDatabase: () => repository.flushDatabase(),
        reconcileManagedInstalledGames: tasks => repository.reconcileManagedInstalledGames(tasks),
    } };
}

function completionReceipt(executablePath) {
    return {
        provider: 'epic', processExitCode: 0, completionConfirmed: true,
        transfer: { downloadedBytes: 64, totalBytes: 64, source: 'legendary-completion-transfer' },
        verification: { status: 'passed', executableFound: true, executablePath, actualBytes: 64 },
    };
}

app.whenReady().then(async () => {
    const installPath = path.join(profile, 'alternate-volume', 'Epic Fixture');
    fs.mkdirSync(path.join(installPath, 'Binaries'), { recursive: true });
    const executablePath = path.join(installPath, 'Binaries', 'Game.exe');
    fs.writeFileSync(executablePath, 'electron fixture');
    const queueRepository = new JsonDownloadRepository({ userDataDir: profile });
    await queueRepository.writeState({ ...queueRepository.emptyState(), tasks: [{
        id: 'dl_2222222222222222', identityKey: `epic:legendary:ElectronArtifact:${installPath}`,
        gameId: 'catalog-electron', canonicalGameId: 'catalog-electron', title: 'Electron Lifecycle Fixture',
        platform: 'epic', installProvider: 'legendary', accountId: 'electron_owner',
        providerProductId: 'electron-offer', providerAppName: 'ElectronArtifact', appName: 'ElectronArtifact',
        namespace: 'electron-namespace', catalogItemId: 'electron-catalog', ownedByAccountIds: ['electron_owner'],
        ownershipVerified: true, installPath, status: 'downloading', stage: 'downloading',
    }] });
    const games = gameApi();
    let win;
    const registrar = new DownloadCompletionLibraryRegistrar({
        gamesApi: games.api,
        notifyLibraryUpdated: async records => win?.webContents?.send('library-updated', records),
    });
    const queueManager = new DownloadQueueManager({ repository: queueRepository, preflight: {}, completionRegistrar: registrar });
    await queueManager.load();
    queueManager.state.tasks[0] = { ...queueManager.state.tasks[0], status: 'downloading', stage: 'downloading' };
    const launches = [];
    const container = {
        queueManager, completionRegistrar: registrar,
        useCases: { getSnapshot: { execute: async () => queueManager.getSnapshot() } },
        epicAccountResolver: { async validateTask(game) { return { appName: game.appName, configPath: path.join(profile, 'legendary-config') }; } },
        epicLegendaryRuntime: { async launch(value) { launches.push(value); return { imported: false }; } },
    };
    registerDownloadsIpc(ipcMain, { container, getMainWindow: () => win, dialog: {}, shell: {} });
    win = new BrowserWindow({
        show: false,
        webPreferences: { preload: path.join(projectRoot, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false },
    });
    await win.loadURL('data:text/html,<html><body><div id="downloadsRoot"></div><span id="downloadsBadge"></span><span id="downloadsSpeed"></span><span id="downloadsActiveCount"></span><span id="downloadsPendingCount"></span><button id="downloadsClearCompleted"></button></body></html>');
    await win.webContents.executeJavaScript(`
        window.allGamesData = [{ id: 'stale-external', name: 'Electron Lifecycle Fixture', platform: 'epic', installSource: 'scanner', installProvider: 'epic_launcher', path: ${JSON.stringify(installPath)}, command: ${JSON.stringify(`"${executablePath}"`)} }];
        window.__opened = null; window.__toasts = [];
        window.openPlayLauncher = game => { window.__opened = game; };
        window.showToast = (message, type) => window.__toasts.push({ message, type });
        true;
    `);
    const downloadsSource = fs.readFileSync(path.join(projectRoot, 'src', 'js', 'downloads.js'), 'utf8');
    await win.webContents.executeJavaScript(`${downloadsSource}\ntrue;`);
    await queueManager.completeTask('dl_2222222222222222', completionReceipt(executablePath));
    await win.webContents.executeJavaScript(`new Promise(resolve => {
        const check = () => document.getElementById('downloadsRoot').textContent.includes('Ready to play') ? resolve() : setTimeout(check, 5);
        check();
    })`);
    await win.webContents.executeJavaScript(`window.downloadsPlay('dl_2222222222222222')`);
    const renderer = await win.webContents.executeJavaScript(`({ opened: window.__opened, toasts: window.__toasts, text: document.getElementById('downloadsRoot').textContent })`);
    const launchResult = await win.webContents.executeJavaScript(`window.electronAPI.downloads.launchEpicLegendary(window.__opened.id, 'electron_owner', window.__opened.managedDownloadTaskId)`);
    const persisted = JSON.parse(fs.readFileSync(path.join(profile, 'games-db.json'), 'utf8'))[0];
    const queuePersisted = JSON.parse(fs.readFileSync(path.join(profile, 'downloads', 'downloads-queue.json'), 'utf8')).tasks[0];
    process.stdout.write(`EPIC_MANAGED_ELECTRON_RESULT=${JSON.stringify({ renderer, launchResult, launches, persisted, queuePersisted })}\n`);
    win.destroy();
    app.quit();
}).catch(error => {
    process.stderr.write(`${error.stack || error}\n`);
    app.exit(1);
});
