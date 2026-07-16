'use strict';
// Static integrity checks for preload.js and dashboard.html.
// These guard against regressions that crash the app at boot.

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT    = path.resolve(__dirname, '..');
const preload = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
const html    = fs.readFileSync(path.join(ROOT, 'src', 'dashboard.html'), 'utf8');
const mainJs  = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');

// ── preload.js guards ────────────────────────────────────────────────────────

test('preload: does NOT call app.getPath() directly (main-process-only API)', () => {
    // app is only available in the main process.  Calling it from preload throws
    // and prevents window.electronAPI from being exposed — crashing the whole app.
    assert.doesNotMatch(
        preload,
        /const\s*\{[^}]*\bapp\b[^}]*\}\s*=\s*require\(['"]electron['"]\)/,
        'preload.js must not destructure { app } from electron (main-process-only API)'
    );
    assert.doesNotMatch(
        preload,
        /\bapp\.getPath\s*\(/,
        'preload.js must not call app.getPath() — use ipcRenderer.sendSync instead'
    );
});

test('preload: exposes electronAPI via contextBridge', () => {
    assert.match(preload, /contextBridge\.exposeInMainWorld\s*\(\s*['"]electronAPI['"]/,
        'preload.js must expose electronAPI via contextBridge');
});

test('preload: exposes __BADDEL_CACHE_URL__ via contextBridge', () => {
    assert.match(preload, /__BADDEL_CACHE_URL__/,
        'preload.js must expose __BADDEL_CACHE_URL__ for domUtils trust policy');
});

test('preload: exposes __BADDEL_ARTWORK_CACHE_URL__ via contextBridge', () => {
    assert.match(preload, /__BADDEL_ARTWORK_CACHE_URL__/,
        'preload.js must expose __BADDEL_ARTWORK_CACHE_URL__ so domUtils trusts artwork-cache-v2 before renderer scripts');
});

test('preload: image-cache URL block is wrapped in try/catch', () => {
    assert.match(preload, /try\s*\{[\s\S]*__BADDEL_CACHE_URL__[\s\S]*\}\s*catch/,
        'The __BADDEL_CACHE_URL__ block must be inside a try/catch so a failure never prevents electronAPI from loading');
});

test('preload: uses ipcRenderer.sendSync for cache URL (not app.getPath)', () => {
    assert.match(preload, /ipcRenderer\.sendSync\s*\(\s*['"]get-image-cache-dir-url-sync['"]\)/,
        'preload must use ipcRenderer.sendSync to get the image cache URL');
});

test('preload: uses ipcRenderer.sendSync for artwork-cache-v2 URL (not app.getPath)', () => {
    assert.match(preload, /ipcRenderer\.sendSync\s*\(\s*['"]get-artwork-cache-dir-url-sync['"]\)/,
        'preload must synchronously request artwork-cache-v2 before renderer scripts run');
});

test('preload: getSteamAccounts is exposed on electronAPI', () => {
    assert.match(preload, /getSteamAccounts/,
        'getSteamAccounts must be present in preload electronAPI');
});

test('preload: getSteamImage is exposed on electronAPI', () => {
    assert.match(preload, /getSteamImage/,
        'getSteamImage must be present in preload electronAPI');
});

test('preload: launchGame is exposed on electronAPI', () => {
    assert.match(preload, /launchGame/,
        'launchGame must be present in preload electronAPI');
});

test('preload: getGames is exposed on electronAPI', () => {
    assert.match(preload, /getGames/,
        'getGames must be present in preload electronAPI');
});

test('preload: getArtworkCacheDirUrl is exposed on electronAPI', () => {
    assert.match(preload, /getArtworkCacheDirUrl:\s*\(\)\s*=>\s*ipcRenderer\.invoke\(['"]get-artwork-cache-dir-url['"]\)/,
        'getArtworkCacheDirUrl must expose the async artwork-cache-v2 URL IPC');
});

// ── dashboard.html CSP guards ────────────────────────────────────────────────

test('dashboard.html CSP: img-src allows https:', () => {
    assert.match(html, /img-src[^;]*https:/,
        'CSP img-src must allow https: so remote artwork loads');
});

test('dashboard.html CSP: img-src allows http:', () => {
    assert.match(html, /img-src[^;]*http:/,
        'CSP img-src must allow http: for local metadata server artwork');
});

test('dashboard.html CSP: img-src allows file:', () => {
    assert.match(html, /img-src[^;]*file:/,
        'CSP img-src must allow file: so cached image_cache artwork loads');
});

test('dashboard.html CSP: media-src allows https:', () => {
    assert.match(html, /media-src[^;]*https:/,
        'CSP media-src must allow https: so trailers load');
});

test('dashboard.html CSP: frame-src allows youtube.com for trailers', () => {
    assert.match(html, /frame-src[^;]*youtube\.com/,
        'CSP frame-src must include youtube.com for embedded trailer iframes');
});

// ── preload: YouTube now uses <webview> tag — no IPC bridge needed ───────────

test('preload: YouTube WebContentsView IPC methods removed (webview replaces them)', () => {
    assert.doesNotMatch(preload, /showYoutubeTrailer/,
        'showYoutubeTrailer IPC must be removed — YouTube is now handled via <webview> in renderer');
    assert.doesNotMatch(preload, /hideYoutubeTrailer/,
        'hideYoutubeTrailer IPC must be removed — <webview> teardown is handled in renderer');
    assert.doesNotMatch(preload, /youtube-trailer:/,
        'youtube-trailer IPC channels must be removed — replaced by <webview> tag');
});

// ── main.js guard ────────────────────────────────────────────────────────────

const imageHandlersJs = fs.readFileSync(path.join(ROOT, 'handlers', 'imageHandlers.js'), 'utf8');

test('imageHandlers.js: registers get-image-cache-dir-url-sync synchronous IPC handler', () => {
    assert.match(imageHandlersJs, /ipcMain\.on\s*\(\s*['"]get-image-cache-dir-url-sync['"]/,
        'imageHandlers.js must register the synchronous IPC handler used by preload');
});

test('imageHandlers.js: registers artwork-cache-v2 sync and async IPC handlers', () => {
    assert.match(imageHandlersJs, /ipcMain\.on\s*\(\s*['"]get-artwork-cache-dir-url-sync['"]/,
        'imageHandlers.js must register the synchronous artwork-cache-v2 IPC handler used by preload');
    assert.match(imageHandlersJs, /ipcMain\.handle\s*\(\s*['"]get-artwork-cache-dir-url['"]/,
        'imageHandlers.js must expose the async artwork-cache-v2 IPC handler');
    assert.match(imageHandlersJs, /artwork-cache-v2/,
        'artwork-cache-v2 directory name must be used by the handler');
});

test('imageHandlers.js: no root-relative require for services/imageWebpCache (wrong path from handlers/)', () => {
    assert.doesNotMatch(imageHandlersJs, /require\s*\(\s*['"]\.\/services\/imageWebpCache['"]\s*\)/,
        "imageHandlers.js must not require('./services/imageWebpCache') — path is wrong from handlers/ subdirectory; use the imageWebpCache dep instead");
});

test('imageHandlers.js: no root-relative require for gameScanner (wrong path from handlers/)', () => {
    assert.doesNotMatch(imageHandlersJs, /require\s*\(\s*['"]\.\/gameScanner['"]\s*\)/,
        "imageHandlers.js must not require('./gameScanner') — path is wrong from handlers/ subdirectory; use updateGameImage/resetGameImage deps instead");
});

test('imageHandlers.js: update-game-image uses updateGameImage dep, not inline require', () => {
    assert.match(imageHandlersJs, /updateGameImage\s*\(/,
        'update-game-image handler must call the updateGameImage dep passed from main.js');
});

test('imageHandlers.js: reset-game-image uses resetGameImage dep, not inline require', () => {
    assert.match(imageHandlersJs, /resetGameImage\s*\(/,
        'reset-game-image handler must call the resetGameImage dep passed from main.js');
});

test('main.js: YouTube WebContentsView IPC handlers removed (replaced by webview tag)', () => {
    assert.doesNotMatch(mainJs, /ipcMain\.handle\s*\(\s*['"]youtube-trailer:show['"]/,
        'youtube-trailer:show IPC must be removed — YouTube uses <webview> tag now');
    assert.doesNotMatch(mainJs, /ipcMain\.handle\s*\(\s*['"]youtube-trailer:hide['"]/,
        'youtube-trailer:hide IPC must be removed — <webview> teardown is renderer-side');
});

test('main.js: validates webview src against YouTube embed patterns in will-attach-webview', () => {
    assert.match(mainJs, /will-attach-webview/,
        'main.js must register a will-attach-webview handler to validate the webview src');
    assert.match(mainJs, /_YT_EMBED_RE/,
        'will-attach-webview must define _YT_EMBED_RE for YouTube embed URL validation');
    // Must allow both youtube.com/embed and youtube-nocookie.com/embed
    assert.match(mainJs, /youtube(?:-nocookie)?/,
        'will-attach-webview _YT_EMBED_RE must cover youtube.com and youtube-nocookie.com embed URLs');
    const attachIdx = mainJs.indexOf('will-attach-webview');
    assert.ok(attachIdx !== -1, 'will-attach-webview must exist in main.js');
    const attachSection = mainJs.slice(attachIdx, attachIdx + 1200);
    assert.match(attachSection, /event\.preventDefault/,
        'will-attach-webview must call event.preventDefault() to block non-embed sources');
});

test('main.js: will-attach-webview forces sandbox:true and contextIsolation:true', () => {
    const handlerIdx = mainJs.indexOf('will-attach-webview');
    assert.ok(handlerIdx !== -1, 'will-attach-webview handler must exist');
    const section = mainJs.slice(handlerIdx, handlerIdx + 800);
    assert.match(section, /sandbox\s*=\s*true/,
        'will-attach-webview must force webPreferences.sandbox = true');
    assert.match(section, /contextIsolation\s*=\s*true/,
        'will-attach-webview must force webPreferences.contextIsolation = true');
    assert.match(section, /nodeIntegration\s*=\s*false/,
        'will-attach-webview must force webPreferences.nodeIntegration = false');
});

test('main.js: app web-contents-created blocks webview navigation to non-YouTube URLs', () => {
    assert.match(mainJs, /web-contents-created/,
        'main.js must register app.on("web-contents-created") for webview security hardening');
    const handlerIdx = mainJs.indexOf('web-contents-created');
    const section = mainJs.slice(handlerIdx, handlerIdx + 1200);
    assert.match(section, /will-navigate/,
        'web-contents-created handler must set up will-navigate guard on webview webContents');
    assert.match(section, /event\.preventDefault/,
        'web-contents-created will-navigate must call event.preventDefault() to block non-YouTube navigation');
});

test('main.js: main window enables webviewTag:true for YouTube trailer webviews', () => {
    const windowSection = mainJs.slice(mainJs.indexOf('function createWindow'));
    assert.match(windowSection.slice(0, 900), /webSecurity\s*:\s*true/,
        'mainWindow webPreferences must keep webSecurity: true');
    assert.match(windowSection.slice(0, 900), /webviewTag\s*:\s*true/,
        'mainWindow webPreferences must enable webviewTag: true for YouTube <webview> elements');
});
