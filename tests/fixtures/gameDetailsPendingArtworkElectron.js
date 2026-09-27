'use strict';
// Isolated Chromium rendering probe: production resolver, details renderer and
// preload; only the cache IPC backend is a fixture. No user library is touched.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, ipcMain, nativeImage, net } = require('electron');
const root = path.resolve(__dirname, '../..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-details-artwork-'));
app.setPath('userData', path.join(temp, 'profile'));
app.whenReady().then(async () => {
    const metadataKey = process.argv.find(arg => arg.startsWith('--metadata-key='))?.split('=')[1];
    let liveMeta = null;
    let manager = null;
    if (metadataKey) {
        const dataRoot = process.env.BADDEL_CURRENT_USER_DATA || path.join(process.env.APPDATA, 'baddel-launcher-beta');
        liveMeta = JSON.parse(fs.readFileSync(path.join(dataRoot, 'metadata-cache.json'), 'utf8'))[metadataKey]?.meta;
        assert.ok(liveMeta, 'persisted metadata must exist');
        const { ContentAddressedArtworkCache } = require('../../src/features/games/infrastructure/services/ContentAddressedArtworkCache');
        const { ArtworkDownloadManager } = require('../../src/features/games/infrastructure/services/ArtworkDownloadManager');
        const { ArtworkDownloadScheduler } = require('../../src/features/games/infrastructure/services/ArtworkDownloadScheduler');
        const { ArtworkHttpClient } = require('../../src/features/games/infrastructure/services/ArtworkHttpClient');
        const logger = { log() {}, warn() {}, error() {} };
        manager = new ArtworkDownloadManager({
            cache: new ContentAddressedArtworkCache({ fs, path, crypto: require('node:crypto'), baseDir: path.join(temp, 'cache'), logger }),
            scheduler: new ArtworkDownloadScheduler({ worker: task => task.run(), logger }),
            httpClient: new ArtworkHttpClient({ fetchImpl: net.fetch.bind(net) }), logger,
        });
    }
    const pixels = Buffer.alloc(16 * 16 * 4, 255);
    const png = nativeImage.createFromBitmap(pixels, { width: 16, height: 16 }).toPNG();
    const assets = {};
    for (const type of ['cover', 'hero', 'logo']) {
        const target = path.join(temp, `${type}.png`);
        fs.writeFileSync(target, png);
        assets[type] = pathToFileURL(target).href;
    }
    for (const channel of ['get-image-cache-dir-url-sync', 'get-artwork-cache-dir-url-sync', 'get-user-artwork-dir-url-sync']) {
        ipcMain.on(channel, event => { event.returnValue = pathToFileURL(temp).href + '/'; });
    }
    let requests = 0;
    ipcMain.handle('cache-all-assets', async (_event, requested, id, options) => {
        requests++;
        if (manager) {
            const started = Date.now();
            const result = await manager.downloadAssets(requested, id, { ...options, structured: true });
            for (const [type, decision] of Object.entries(result)) console.log(JSON.stringify({ type, status: decision.status, errorCode: decision.errorCode, elapsedMs: Date.now() - started }));
            return Object.fromEntries(Object.entries(result).map(([type, decision]) => [type, decision.localUrl]));
        }
        return Object.fromEntries(Object.keys(requested).map(type => [type, assets[type]]));
    });
    const html = path.join(temp, 'details.html');
    fs.writeFileSync(html, '<img id="gdCover"><img id="gdLogo"><div id="gdTitle"></div><div id="gdHeroBg"></div><div id="gdCoverPlaceholder"></div>');
    const win = new BrowserWindow({ show: false, webPreferences: { preload: path.join(root, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
    await win.loadFile(html);
    const modules = [
        'application/services/GameArtworkSchema', 'domain/services/ArtworkOwnershipPolicy',
        'domain/services/GameArtworkState', 'application/services/GameArtworkResolver',
        'application/services/GameArtworkReadModel', 'application/services/GameDetailsArtworkAdapter',
    ];
    for (const module of modules) await win.webContents.executeJavaScript(fs.readFileSync(path.join(root, 'src/features/games', module + '.js'), 'utf8') + '\n;void 0;');
    const source = fs.readFileSync(path.join(root, 'src/js/game-details.js'), 'utf8');
    const segment = source.slice(source.indexOf('function _gdHasArtworkValue'), source.indexOf('function _gdPopulateBasic'));
    await win.webContents.executeJavaScript(`
        var _gdViewToken = Symbol('view'), _gdCurrentBaseGame, _gdCurrentGame, _gdCurrentMeta = null, _gdCurrentCustomDetails = null;
        function _gdLoadCustomDetails() { return null; }
        function _gdRecordStage() {}
        function _gdClearProceduralHero() {}
        function _gdApplyProceduralHero() {}
        function _gdClearProceduralCard() {}
        function _gdApplyProceduralCard() {}
        ${segment}
    `);
    if (liveMeta) {
        const result = await win.webContents.executeJavaScript(`(async () => {
            _gdCurrentGame = { id: ${JSON.stringify(metadataKey)}, platform: 'steam' };
            _gdCurrentBaseGame = { ..._gdCurrentGame };
            _gdCurrentMeta = ${JSON.stringify(liveMeta)};
            _gdApplyResolvedArtworkToDom(_gdCurrentGame, _gdCurrentMeta);
            await _gdHydratePendingArtwork(_gdCurrentGame, _gdResolveArtworkForDisplay(_gdCurrentGame, _gdCurrentMeta));
            return await Promise.all(['gdCover', 'gdLogo'].map(async id => {
                const el = document.getElementById(id);
                try { await el.decode(); } catch {}
                return { type: id, decoded: el.naturalWidth > 0, visible: el.style.display === 'block' };
            }));
        })()`);
        console.log(JSON.stringify({ liveElectronRendering: result }));
        win.destroy(); app.exit(0); return;
    }
    for (const platform of ['steam', 'epic']) {
        const result = await win.webContents.executeJavaScript(`(async () => {
            _gdViewToken = Symbol('next');
            _gdCurrentGame = { id: '${platform}_fixture', platform: '${platform}', name: 'Fixture', image: 'https://fixture/cover', heroImage: 'https://fixture/hero', logo: 'https://fixture/logo' };
            _gdCurrentBaseGame = { ..._gdCurrentGame };
            _gdApplyResolvedArtworkToDom(_gdCurrentGame);
            await _gdHydratePendingArtwork(_gdCurrentGame, _gdResolveArtworkForDisplay(_gdCurrentGame));
            await Promise.all(['gdCover', 'gdLogo'].map(id => document.getElementById(id).decode()));
            return ['gdCover', 'gdLogo'].map(id => ({ width: document.getElementById(id).naturalWidth, display: document.getElementById(id).style.display }));
        })()`);
        assert.deepEqual(result, [{ width: 16, display: 'block' }, { width: 16, display: 'block' }]);
    }
    assert.equal(requests, 6);
    console.log('PASS: Steam and Epic pending cover/logo acquired through production preload and decoded visibly in Electron (isolated cache backend).');
    win.destroy();
    app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
