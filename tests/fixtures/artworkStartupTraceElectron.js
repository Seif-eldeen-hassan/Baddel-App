'use strict';
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const assert = require('node:assert/strict');
const { ArtworkStartupDiagnostics } = require('../../services/artworkStartupDiagnostics');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-artwork-trace-'));
app.setPath('userData', dir);
process.env.BADDEL_ARTWORK_STARTUP_TRACE = '1';
const trace = new ArtworkStartupDiagnostics({ enabled: true, durationMs: 5000 });
trace.install(ipcMain);
for (const channel of ['get-image-cache-dir-url-sync', 'get-artwork-cache-dir-url-sync', 'get-user-artwork-dir-url-sync']) {
    ipcMain.on(channel, event => { event.returnValue = ''; });
}
ipcMain.handle('get-cached-images-bulk', async () => ({ images: {}, misses: 1 }));
ipcMain.handle('get-grid-artwork-thumbnails', async () => { throw new Error('TEST_REJECTION'); });
app.whenReady().then(async () => {
    const preload = process.env.BADDEL_TRACE_PROTECTED_PRELOAD === '1'
        ? path.resolve(__dirname, '../../.protected-build/app/preload.bundle.cjs')
        : path.resolve(__dirname, '../../preload.js');
    const win = new BrowserWindow({ show: false, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: false } });
    await win.loadURL('data:text/html,<div id="allGamesGrid"><div class="game-card"><img class="game-card-img"></div></div>');
    trace.start(app, () => win);
    await win.webContents.executeJavaScript(`window.electronAPI.getCachedImagesBulk([{ id: 'private' }], 'cover')`);
    await win.webContents.executeJavaScript(`window.electronAPI.getGridArtworkThumbnails([]).catch(() => null)`);
    await new Promise(resolve => setTimeout(resolve, 6700));
    const saved = JSON.parse(fs.readFileSync(trace.output, 'utf8'));
    assert.equal(saved.complete, true);
    assert.ok(saved.events.some(x => x.stage === 'preload:get-cached-images-bulk:resolved'));
    assert.ok(saved.events.some(x => x.stage === 'preload:get-grid-artwork-thumbnails:rejected'));
    assert.ok(saved.events.some(x => x.stage === 'renderer-sample' && x.cards === 1));
    assert.doesNotMatch(JSON.stringify(saved), /private/);
    console.log('ARTWORK_TRACE_ELECTRON_OK'); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
setTimeout(() => app.exit(2), 20000).unref();
