'use strict';

/**
 * quickSwitcherService.test.js
 *
 * Structural smoke tests for the Quick Switcher readiness protocol.
 *
 * These tests never launch Electron — they inspect source files to confirm
 * that the race-free show flow, IPC signals, and timeout safety are present
 * and correctly wired up.
 */

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const path   = require('path');

const ROOT = path.resolve(__dirname, '..');

const QS_SERVICE = fs.readFileSync(path.join(ROOT, 'services', 'quickSwitcher.js'), 'utf8');
const QS_RENDERER = fs.readFileSync(path.join(ROOT, 'src', 'js', 'quick-switcher.js'), 'utf8');
const PRELOAD_JS  = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');

// ── services/quickSwitcher.js ────────────────────────────────────────────────

test('quickSwitcher service: imports ipcMain from electron', () => {
    assert.ok(QS_SERVICE.includes('ipcMain'), 'ipcMain must be destructured from electron require');
});

test('quickSwitcher service: defines _waitForSignal helper', () => {
    assert.ok(QS_SERVICE.includes('function _waitForSignal'), '_waitForSignal helper must be defined');
});

test('quickSwitcher service: _waitForSignal resolves false on timeout', () => {
    const idx = QS_SERVICE.indexOf('function _waitForSignal');
    const block = QS_SERVICE.slice(idx, idx + 500);
    assert.ok(block.includes('setTimeout'), '_waitForSignal must use setTimeout for the timeout path');
    assert.ok(block.includes('finish(false)'), '_waitForSignal must resolve false on timeout');
    assert.ok(block.includes('finish(true)'), '_waitForSignal must resolve true on signal');
});

test('quickSwitcher service: registers ipcMain listener for qs:renderer-ready', () => {
    assert.ok(QS_SERVICE.includes("ipcMain.on('qs:renderer-ready'") ||
              QS_SERVICE.includes('ipcMain.on("qs:renderer-ready"'),
        'service must listen for qs:renderer-ready from the renderer');
});

test('quickSwitcher service: registers ipcMain listener for qs:visible-ready', () => {
    assert.ok(QS_SERVICE.includes("ipcMain.on('qs:visible-ready'") ||
              QS_SERVICE.includes('ipcMain.on("qs:visible-ready"'),
        'service must listen for qs:visible-ready from the renderer');
});

test('quickSwitcher service: qs:renderer-ready listener sets _ready=true', () => {
    const idx = QS_SERVICE.indexOf("ipcMain.on('qs:renderer-ready'");
    assert.ok(idx !== -1, "ipcMain.on('qs:renderer-ready') must be present");
    const block = QS_SERVICE.slice(idx, idx + 350);
    assert.ok(block.includes('_ready = true'), 'qs:renderer-ready handler must set _ready=true');
});

test('quickSwitcher service: qs:renderer-ready listener filters by webContents sender', () => {
    const idx = QS_SERVICE.indexOf("ipcMain.on('qs:renderer-ready'");
    assert.ok(idx !== -1, "ipcMain.on('qs:renderer-ready') must be present");
    const block = QS_SERVICE.slice(idx, idx + 350);
    assert.ok(block.includes('event.sender'), 'qs:renderer-ready handler must verify event.sender matches _win.webContents');
});

test('quickSwitcher service: createQuickSwitcherWindow calls setIgnoreMouseEvents(true)', () => {
    const idx = QS_SERVICE.indexOf('function createQuickSwitcherWindow');
    // Window size extended to 2000 to accommodate path-resolution guards added before BrowserWindow creation.
    const block = QS_SERVICE.slice(idx, idx + 2000);
    assert.ok(block.includes('setIgnoreMouseEvents(true)'),
        'createQuickSwitcherWindow must call setIgnoreMouseEvents(true) immediately so transparent window blocks no input');
});

test('quickSwitcher service: _doShow waits for renderer-ready before sending qs:show', () => {
    const idx = QS_SERVICE.indexOf('function _doShow');
    // Window extended to 5000 to accommodate detailed diagnostic logging added throughout _doShow.
    const block = QS_SERVICE.slice(idx, idx + 5000);
    const rrIdx = block.indexOf('renderer-ready');
    const showIdx = block.indexOf("'qs:show'") !== -1
        ? block.indexOf("'qs:show'")
        : block.indexOf('"qs:show"');
    assert.ok(rrIdx !== -1, '_doShow must reference renderer-ready');
    assert.ok(showIdx !== -1, '_doShow must send qs:show');
    assert.ok(rrIdx < showIdx, 'renderer-ready wait must come before sending qs:show');
});

test('quickSwitcher service: _doShow sends qs:show before waiting for visible-ready', () => {
    const idx = QS_SERVICE.indexOf('function _doShow');
    // Window extended to 5000 to accommodate detailed diagnostic logging added throughout _doShow.
    const block = QS_SERVICE.slice(idx, idx + 5000);
    const showIdx = block.indexOf("'qs:show'") !== -1
        ? block.indexOf("'qs:show'")
        : block.indexOf('"qs:show"');
    const vrIdx = block.indexOf('visible-ready');
    assert.ok(showIdx !== -1, '_doShow must send qs:show');
    assert.ok(vrIdx !== -1, '_doShow must wait for visible-ready');
    assert.ok(showIdx < vrIdx, 'qs:show must be sent before the visible-ready wait log');
});

// ── Race-safe show flow (fix: register waiters before triggering actions) ─────

test('quickSwitcher service: _doShow registers visible-ready waiter before sending qs:show', () => {
    const idx = QS_SERVICE.indexOf('function _doShow');
    // Window extended to 5000 to accommodate detailed diagnostic logging added throughout _doShow.
    const block = QS_SERVICE.slice(idx, idx + 5000);
    const waiterIdx = block.indexOf('visibleReadyPromise');
    const sendIdx   = block.indexOf("'qs:show'") !== -1
        ? block.indexOf("'qs:show'")
        : block.indexOf('"qs:show"');
    assert.ok(waiterIdx !== -1, '_doShow must declare visibleReadyPromise before sending qs:show');
    assert.ok(sendIdx   !== -1, '_doShow must call webContents.send with qs:show');
    assert.ok(waiterIdx < sendIdx,
        'visibleReadyPromise must be registered before webContents.send(qs:show) to avoid the warm-renderer race');
});

test('quickSwitcher service: _doShow awaits visibleReadyPromise after the send', () => {
    const idx = QS_SERVICE.indexOf('function _doShow');
    // Window extended to 5000 to accommodate detailed diagnostic logging added throughout _doShow.
    const block = QS_SERVICE.slice(idx, idx + 5000);
    const sendIdx  = block.indexOf("'qs:show'") !== -1
        ? block.indexOf("'qs:show'")
        : block.indexOf('"qs:show"');
    const awaitIdx = block.indexOf('await visibleReadyPromise');
    assert.ok(awaitIdx !== -1, '_doShow must await visibleReadyPromise');
    assert.ok(sendIdx < awaitIdx, 'await visibleReadyPromise must come after webContents.send(qs:show)');
});

test('quickSwitcher service: _doShow registers renderer-ready waiter before creating window', () => {
    const idx = QS_SERVICE.indexOf('function _doShow');
    // Window extended to 5000 to accommodate detailed diagnostic logging added throughout _doShow.
    const block = QS_SERVICE.slice(idx, idx + 5000);
    const waiterIdx = block.indexOf('rendererReadyPromise');
    const windowIdx = block.indexOf('createQuickSwitcherWindow');
    assert.ok(waiterIdx !== -1, '_doShow must declare rendererReadyPromise before creating the window');
    assert.ok(windowIdx !== -1, '_doShow must call createQuickSwitcherWindow');
    assert.ok(waiterIdx < windowIdx,
        'rendererReadyPromise must be registered before createQuickSwitcherWindow to avoid a renderer-ready race');
});

test('quickSwitcher service: hideQuickSwitcherOverlay does not reset _ready', () => {
    const idx = QS_SERVICE.indexOf('function hideQuickSwitcherOverlay');
    const block = QS_SERVICE.slice(idx, idx + 300);
    assert.ok(!block.includes('_ready = false'),
        'hideQuickSwitcherOverlay must not clear _ready — the renderer remains warm between successive shows');
});

test('quickSwitcher service: _doShow calls showInactive/show BEFORE visible-ready wait, focus AFTER', () => {
    const idx = QS_SERVICE.indexOf('function _doShow');
    const block = QS_SERVICE.slice(idx, idx + 5000);
    // visible-ready (hyphenated) first appears in the post-await timeout/focused log
    const vrIdx = block.indexOf('visible-ready');
    // showInactive or show (fallback) is called before the visible-ready wait
    const showIdx = block.indexOf('showInactive') !== -1
        ? block.indexOf('showInactive')
        : block.indexOf('_win.show()');
    const focusIdx = block.lastIndexOf('_win.focus()');
    assert.ok(vrIdx !== -1, '_doShow must reference visible-ready');
    assert.ok(showIdx !== -1, '_doShow must call showInactive or show');
    assert.ok(showIdx < vrIdx, 'window must be shown before the visible-ready wait');
    assert.ok(vrIdx < focusIdx, '_win.focus() must come after the visible-ready wait');
});

test('quickSwitcher service: _doShow calls setIgnoreMouseEvents(false) before focus()', () => {
    const idx = QS_SERVICE.indexOf('function _doShow');
    const block = QS_SERVICE.slice(idx, idx + 5000);
    // setIgnoreMouseEvents(false) is called after the visible-ready wait, before focus()
    const ignoreOff = block.lastIndexOf('setIgnoreMouseEvents(false)');
    const focusCall = block.lastIndexOf('_win.focus()');
    assert.ok(ignoreOff !== -1, 'setIgnoreMouseEvents(false) must be called in _doShow');
    assert.ok(focusCall !== -1, '_win.focus() must be present in _doShow block');
    assert.ok(ignoreOff < focusCall, 'setIgnoreMouseEvents(false) must come before _win.focus()');
});

test('quickSwitcher service: _doShow aborts and hides window on renderer-ready timeout', () => {
    const idx = QS_SERVICE.indexOf('function _doShow');
    // Window extended to 5000 to accommodate detailed diagnostic logging added throughout _doShow.
    const block = QS_SERVICE.slice(idx, idx + 5000);
    const rrTimeoutIdx = block.indexOf('renderer-ready timeout');
    assert.ok(rrTimeoutIdx !== -1, '_doShow must log renderer-ready timeout');
    // Window extended to 250 to accommodate logQuickSwitcherState inserted between log and hide.
    const hideAfterRr = block.slice(rrTimeoutIdx, rrTimeoutIdx + 250);
    assert.ok(hideAfterRr.includes('hide()') || hideAfterRr.includes('.hide('),
        '_doShow must hide the window on renderer-ready timeout');
});

test('quickSwitcher service: _doShow does NOT abort or hide on visible-ready timeout — continues to focus', () => {
    const idx = QS_SERVICE.indexOf('function _doShow');
    const block = QS_SERVICE.slice(idx, idx + 5000);
    const vrTimeoutIdx = block.indexOf('visible-ready timeout');
    assert.ok(vrTimeoutIdx !== -1, '_doShow must log visible-ready timeout');
    // After timeout: must NOT hide — the window is already visible
    const afterTimeout = block.slice(vrTimeoutIdx, vrTimeoutIdx + 300);
    assert.ok(!afterTimeout.includes('.hide()'), '_doShow must not hide window on visible-ready timeout');
    // After timeout: must still call focus() so the window is interactive
    const focusAfter = block.slice(vrTimeoutIdx, vrTimeoutIdx + 500);
    assert.ok(focusAfter.includes('focus()'), '_doShow must call focus() even after visible-ready timeout');
});

test('quickSwitcher service: showQuickSwitcherOverlay has _showing guard to prevent concurrent calls', () => {
    const idx = QS_SERVICE.indexOf('async function showQuickSwitcherOverlay');
    const block = QS_SERVICE.slice(idx, idx + 300);
    assert.ok(block.includes('_showing'), 'showQuickSwitcherOverlay must guard against concurrent invocations');
});

test('quickSwitcher service: hideQuickSwitcherOverlay calls setIgnoreMouseEvents(true)', () => {
    const idx = QS_SERVICE.indexOf('function hideQuickSwitcherOverlay');
    // Window extended to 500 to accommodate qs:hide send and state logging added before setIgnoreMouseEvents.
    const block = QS_SERVICE.slice(idx, idx + 500);
    assert.ok(block.includes('setIgnoreMouseEvents(true)'),
        'hideQuickSwitcherOverlay must re-enable mouse-event blocking so the hidden window is transparent to input');
});

test('quickSwitcher service: window closed handler nulls _rrHolder and _vrHolder resolves', () => {
    const idx = QS_SERVICE.indexOf("'closed'");
    const block = QS_SERVICE.slice(idx, idx + 300);
    assert.ok(block.includes('_rrHolder.resolve = null'), "closed handler must null _rrHolder.resolve");
    assert.ok(block.includes('_vrHolder.resolve = null'), "closed handler must null _vrHolder.resolve");
});

test('quickSwitcher service: registerQuickSwitcherHotkey calls globalShortcut.register', () => {
    const idx = QS_SERVICE.indexOf('function registerQuickSwitcherHotkey');
    const block = QS_SERVICE.slice(idx, idx + 600);
    assert.ok(block.includes('globalShortcut.register'), 'must call globalShortcut.register');
});

test('quickSwitcher service: registerQuickSwitcherHotkey logs warning on failure', () => {
    const idx = QS_SERVICE.indexOf('function registerQuickSwitcherHotkey');
    const block = QS_SERVICE.slice(idx, idx + 600);
    assert.ok(block.includes('console.warn'),
        'must emit a console.warn when hotkey registration fails');
});

// ── Path resolution ──────────────────────────────────────────────────────────

test('quickSwitcher service: defines firstExistingPath helper', () => {
    assert.ok(QS_SERVICE.includes('function firstExistingPath'), 'firstExistingPath must be defined');
});

test('quickSwitcher service: defines resolveQuickSwitcherHtmlPath helper', () => {
    assert.ok(QS_SERVICE.includes('function resolveQuickSwitcherHtmlPath'), 'resolveQuickSwitcherHtmlPath must be defined');
});

test('quickSwitcher service: defines resolveQuickSwitcherPreloadPath helper', () => {
    assert.ok(QS_SERVICE.includes('function resolveQuickSwitcherPreloadPath'), 'resolveQuickSwitcherPreloadPath must be defined');
});

test('quickSwitcher service: resolveQuickSwitcherHtmlPath uses app.getAppPath() as first candidate', () => {
    const idx = QS_SERVICE.indexOf('function resolveQuickSwitcherHtmlPath');
    assert.ok(idx !== -1, 'resolveQuickSwitcherHtmlPath must be defined');
    const block = QS_SERVICE.slice(idx, idx + 700);
    assert.ok(block.includes('getAppPath'), 'resolveQuickSwitcherHtmlPath must call app.getAppPath()');
    assert.ok(block.includes('quick-switcher.html'), 'resolveQuickSwitcherHtmlPath must target quick-switcher.html');
    const appPathIdx  = block.indexOf('getAppPath');
    const dirnameIdx  = block.indexOf('__dirname');
    assert.ok(appPathIdx < dirnameIdx, 'app.getAppPath() candidate must appear before __dirname fallback');
});

test('quickSwitcher service: resolveQuickSwitcherHtmlPath does not list src/quick-switcher.html before appPath', () => {
    const idx = QS_SERVICE.indexOf('function resolveQuickSwitcherHtmlPath');
    const block = QS_SERVICE.slice(idx, idx + 700);
    const appPathIdx = block.indexOf('getAppPath');
    const srcIdx     = block.indexOf("'src'") !== -1 ? block.indexOf("'src'") : block.indexOf(path.sep + 'src' + path.sep);
    // appPath candidate must appear before any src/ sub-path entry
    assert.ok(appPathIdx !== -1, 'app.getAppPath() must be present');
    if (srcIdx !== -1) {
        assert.ok(appPathIdx < srcIdx, 'src/ path must not be the first candidate — app.getAppPath() must come first');
    }
});

test('quickSwitcher service: resolveQuickSwitcherPreloadPath lists preload.bundle.cjs before preload.js', () => {
    const idx = QS_SERVICE.indexOf('function resolveQuickSwitcherPreloadPath');
    assert.ok(idx !== -1, 'resolveQuickSwitcherPreloadPath must be defined');
    const block = QS_SERVICE.slice(idx, idx + 700);
    assert.ok(block.includes('preload.bundle.cjs'), 'must target preload.bundle.cjs as packaged name');
    const bundleIdx    = block.indexOf('preload.bundle.cjs');
    const preloadJsIdx = block.indexOf('preload.js');
    if (preloadJsIdx !== -1) {
        assert.ok(bundleIdx < preloadJsIdx, 'preload.bundle.cjs must be listed before preload.js fallback');
    }
});

test('quickSwitcher service: resolveQuickSwitcherPreloadPath uses app.getAppPath() as first candidate', () => {
    const idx = QS_SERVICE.indexOf('function resolveQuickSwitcherPreloadPath');
    const block = QS_SERVICE.slice(idx, idx + 700);
    assert.ok(block.includes('getAppPath'), 'resolveQuickSwitcherPreloadPath must call app.getAppPath()');
    const appPathIdx = block.indexOf('getAppPath');
    const dirnameIdx = block.indexOf('__dirname');
    assert.ok(appPathIdx < dirnameIdx, 'app.getAppPath() candidate must appear before __dirname fallback');
});

test('quickSwitcher service: createQuickSwitcherWindow checks path existence before creating BrowserWindow', () => {
    const idx = QS_SERVICE.indexOf('function createQuickSwitcherWindow');
    const block = QS_SERVICE.slice(idx, idx + 1800);
    const existsIdx  = block.indexOf('existsSync');
    const browserIdx = block.indexOf('new BrowserWindow');
    assert.ok(existsIdx !== -1, 'createQuickSwitcherWindow must use existsSync to validate paths');
    assert.ok(browserIdx !== -1, 'createQuickSwitcherWindow must create BrowserWindow');
    assert.ok(existsIdx < browserIdx, 'existsSync check must come before new BrowserWindow');
});

test('quickSwitcher service: createQuickSwitcherWindow returns early when preload path is missing', () => {
    const idx = QS_SERVICE.indexOf('function createQuickSwitcherWindow');
    const block = QS_SERVICE.slice(idx, idx + 1800);
    assert.ok(block.includes('preload path missing; aborting show'),
        'createQuickSwitcherWindow must log and abort when preload path does not exist');
    const returnIdx  = block.indexOf('preload path missing; aborting show');
    const browserIdx = block.indexOf('new BrowserWindow');
    assert.ok(returnIdx < browserIdx, 'preload abort return must come before new BrowserWindow');
});

test('quickSwitcher service: createQuickSwitcherWindow returns early when html path is missing', () => {
    const idx = QS_SERVICE.indexOf('function createQuickSwitcherWindow');
    const block = QS_SERVICE.slice(idx, idx + 1800);
    assert.ok(block.includes('html path missing; aborting show'),
        'createQuickSwitcherWindow must log and abort when html path does not exist');
    const returnIdx  = block.indexOf('html path missing; aborting show');
    const browserIdx = block.indexOf('new BrowserWindow');
    assert.ok(returnIdx < browserIdx, 'html abort return must come before new BrowserWindow');
});

// ── Debug diagnostic infrastructure: must be absent in release ───────────────

test('quickSwitcher service: debug hotkey Ctrl+Shift+Alt+B is NOT registered in release', () => {
    assert.ok(!QS_SERVICE.includes('Ctrl+Shift+Alt+B'),
        'release build must not register Ctrl+Shift+Alt+B debug hotkey');
});

test('quickSwitcher service: _registerDebugHotkey is NOT present in release', () => {
    assert.ok(!QS_SERVICE.includes('_registerDebugHotkey'),
        '_registerDebugHotkey must be removed from the release build');
});

test('quickSwitcher service: _debugQuickSwitcher is not present', () => {
    assert.ok(!QS_SERVICE.includes('_debugQuickSwitcher'),
        '_debugQuickSwitcher must be removed for release');
});

test('quickSwitcher service: quick-switcher-debug-snapshot IPC is not registered', () => {
    assert.ok(!QS_SERVICE.includes('quick-switcher-debug-snapshot'),
        'debug snapshot IPC must be removed for release');
});

test('quickSwitcher service: openDevTools is not called in release mode', () => {
    assert.ok(!QS_SERVICE.includes('openDevTools'),
        'openDevTools must not be called in the release build');
});

test('quickSwitcher service: debug CSS outlines are not injected in release mode', () => {
    assert.ok(!QS_SERVICE.includes('insertCSS'),
        'insertCSS must not be called in the release build');
    assert.ok(!QS_SERVICE.includes('outline: 2px solid red'),
        'debug red outline must not be injected in release build');
    assert.ok(!QS_SERVICE.includes('outline: 2px solid lime'),
        'debug lime outline must not be injected in release build');
});

test('quickSwitcher service: BrowserWindow is created with devTools: false', () => {
    const idx = QS_SERVICE.indexOf('function createQuickSwitcherWindow');
    const block = QS_SERVICE.slice(idx, idx + 2000);
    assert.ok(block.includes('devTools: false'), 'createQuickSwitcherWindow must set devTools: false');
    assert.ok(!block.includes('devTools: true'), 'devTools must not be true in createQuickSwitcherWindow');
});

test('preload.js: debugSnapshot is not exposed', () => {
    assert.ok(!PRELOAD_JS.includes('debugSnapshot'),
        'debugSnapshot must not be exposed in preload for the release build');
});

// ── src/js/quick-switcher.js ─────────────────────────────────────────────────

test('quick-switcher renderer: sends rendererReady after _init()', () => {
    // rendererReady must be called AFTER _init() sets up all listeners.
    const initEndIdx = QS_RENDERER.lastIndexOf('_init()');
    // The call is either inside _init() at the very end or immediately after.
    const callInsideInit = QS_RENDERER.lastIndexOf('api.rendererReady()');
    assert.ok(callInsideInit !== -1, 'quick-switcher.js must call api.rendererReady()');
    // It should appear after the api.onShow listener registration.
    const onShowIdx = QS_RENDERER.indexOf('api.onShow(');
    assert.ok(callInsideInit > onShowIdx,
        'api.rendererReady() must be called after api.onShow() is registered');
});

test('quick-switcher renderer: sends visibleReady after applying is-open class', () => {
    const isOpenIdx = QS_RENDERER.lastIndexOf("classList.add('is-open')");
    const vrIdx     = QS_RENDERER.lastIndexOf('api.visibleReady(');
    assert.ok(vrIdx !== -1, 'quick-switcher.js must call api.visibleReady(...)');
    assert.ok(vrIdx > isOpenIdx, 'api.visibleReady() must be called after classList.add(is-open)');
});

test('quick-switcher renderer: rendererReady call is wrapped in try/catch', () => {
    const idx = QS_RENDERER.lastIndexOf('api.rendererReady()');
    const before = QS_RENDERER.slice(Math.max(0, idx - 80), idx);
    assert.ok(before.includes('try'), 'api.rendererReady() call must be inside a try block');
});

test('quick-switcher renderer: visibleReady call is wrapped in try/catch', () => {
    const idx = QS_RENDERER.lastIndexOf('api.visibleReady(');
    const before = QS_RENDERER.slice(Math.max(0, idx - 80), idx);
    assert.ok(before.includes('try'), 'api.visibleReady() call must be inside a try block');
});

// ── preload.js ───────────────────────────────────────────────────────────────

test('preload.js: exposes quickSwitcher.rendererReady', () => {
    assert.ok(PRELOAD_JS.includes('rendererReady'),
        'preload.js must expose rendererReady in the quickSwitcher API');
    assert.ok(PRELOAD_JS.includes("ipcRenderer.send('qs:renderer-ready')") ||
              PRELOAD_JS.includes('ipcRenderer.send("qs:renderer-ready")'),
        'rendererReady must call ipcRenderer.send on qs:renderer-ready channel');
});

test('preload.js: exposes quickSwitcher.visibleReady', () => {
    assert.ok(PRELOAD_JS.includes('visibleReady'),
        'preload.js must expose visibleReady in the quickSwitcher API');
    assert.ok(PRELOAD_JS.includes("ipcRenderer.send('qs:visible-ready'") ||
              PRELOAD_JS.includes('ipcRenderer.send("qs:visible-ready"'),
        'visibleReady must call ipcRenderer.send on qs:visible-ready channel');
});

test('preload.js: uses ipcRenderer.send (not invoke) for readiness signals', () => {
    const rrIdx = PRELOAD_JS.indexOf('qs:renderer-ready');
    // Locate the send occurrence of qs:visible-ready (not the onHide/onShow listener occurrence).
    const vrIdx = PRELOAD_JS.indexOf("ipcRenderer.send('qs:visible-ready'") !== -1
        ? PRELOAD_JS.indexOf("ipcRenderer.send('qs:visible-ready'")
        : PRELOAD_JS.indexOf('ipcRenderer.send("qs:visible-ready"');
    // These are one-way signals — invoke would wait for a response that never comes.
    const rrBlock = PRELOAD_JS.slice(Math.max(0, rrIdx - 20), rrIdx + 30);
    assert.ok(rrBlock.includes('ipcRenderer.send('), 'qs:renderer-ready must use ipcRenderer.send, not invoke');
    assert.ok(vrIdx !== -1, 'qs:visible-ready must use ipcRenderer.send, not invoke');
});

test('preload.js: exposes quickSwitcher.onHide', () => {
    assert.ok(PRELOAD_JS.includes('onHide'),
        'preload.js must expose onHide in the quickSwitcher API');
    assert.ok(PRELOAD_JS.includes("ipcRenderer.on('qs:hide'") ||
              PRELOAD_JS.includes('ipcRenderer.on("qs:hide"'),
        'onHide must subscribe to the qs:hide channel');
});

// ── Debug state helpers: gated behind QS_DEBUG ───────────────────────────────

test('quickSwitcher service: debug state helper is QS_DEBUG-gated', () => {
    assert.ok(QS_SERVICE.includes('QS_DEBUG'),
        'QS_DEBUG flag must be defined for development-only debug logging');
    assert.ok(QS_SERVICE.includes('function debugLogQuickSwitcher'),
        'debugLogQuickSwitcher must be defined as the gated logger');
    assert.ok(QS_SERVICE.includes('if (!QS_DEBUG) return'),
        'debug logger must be gated on QS_DEBUG');
});

test('quickSwitcher service: internal state snapshot helper tracks showing and ready', () => {
    const idx = QS_SERVICE.indexOf('function _getQuickSwitcherState');
    const block = QS_SERVICE.slice(idx, idx + 400);
    assert.ok(block.includes('_showing'), '_getQuickSwitcherState must include _showing flag');
    assert.ok(block.includes('_ready'), '_getQuickSwitcherState must include _ready flag');
    assert.ok(block.includes('showSeq') || block.includes('_showSeq'),
        '_getQuickSwitcherState must include showSeq for sequence correlation');
});

// ── Show sequence tracking ────────────────────────────────────────────────────

test('quickSwitcher service: _doShow increments _showSeq', () => {
    const idx = QS_SERVICE.indexOf('function _doShow');
    const block = QS_SERVICE.slice(idx, idx + 3000);
    assert.ok(block.includes('++_showSeq') || block.includes('_showSeq++'),
        '_doShow must increment _showSeq on each call');
});

test('quickSwitcher service: _doShow includes showSeq in qs:show payload', () => {
    const idx = QS_SERVICE.indexOf('function _doShow');
    const block = QS_SERVICE.slice(idx, idx + 3000);
    const sendIdx = block.indexOf("'qs:show'") !== -1 ? block.indexOf("'qs:show'") : block.indexOf('"qs:show"');
    const payloadBlock = block.slice(sendIdx, sendIdx + 200);
    assert.ok(payloadBlock.includes('showSeq'), '_doShow must include showSeq in the qs:show payload');
});

test('quickSwitcher service: qs:visible-ready handler logs rendererSeq', () => {
    const idx = QS_SERVICE.indexOf("ipcMain.on('qs:visible-ready'");
    const block = QS_SERVICE.slice(idx, idx + 300);
    assert.ok(block.includes('rendererSeq') || block.includes('showSeq'),
        'qs:visible-ready handler must log the sequence number from the renderer');
});

// ── Hardened hide lifecycle ───────────────────────────────────────────────────

test('quickSwitcher service: hideQuickSwitcherOverlay sends qs:hide to renderer', () => {
    const idx = QS_SERVICE.indexOf('function hideQuickSwitcherOverlay');
    const block = QS_SERVICE.slice(idx, idx + 400);
    assert.ok(block.includes("'qs:hide'") || block.includes('"qs:hide"'),
        'hideQuickSwitcherOverlay must send qs:hide to the renderer');
});

test('quickSwitcher service: hideQuickSwitcherOverlay clears _vrHolder.resolve', () => {
    const idx = QS_SERVICE.indexOf('function hideQuickSwitcherOverlay');
    const block = QS_SERVICE.slice(idx, idx + 400);
    assert.ok(block.includes('_vrHolder.resolve = null'),
        'hideQuickSwitcherOverlay must clear _vrHolder.resolve to unblock any pending waiter');
});

test('quickSwitcher service: hideQuickSwitcherOverlay resets _showing to false', () => {
    const idx = QS_SERVICE.indexOf('function hideQuickSwitcherOverlay');
    const block = QS_SERVICE.slice(idx, idx + 400);
    assert.ok(block.includes('_showing = false'),
        'hideQuickSwitcherOverlay must reset _showing so the next show attempt is not skipped');
});

// ── New show flow: show before visible-ready, no abort on timeout ────────────

test('quickSwitcher service: _doShow calls showInactive (or show) before registering visibleReadyPromise', () => {
    const idx = QS_SERVICE.indexOf('function _doShow');
    const block = QS_SERVICE.slice(idx, idx + 5000);
    const showInactiveIdx = block.indexOf('showInactive');
    const showFallbackIdx = block.indexOf('_win.show()');
    const waiterIdx = block.indexOf('visibleReadyPromise');
    assert.ok(showInactiveIdx !== -1 || showFallbackIdx !== -1, '_doShow must call showInactive or show');
    const actualShowIdx = showInactiveIdx !== -1 ? showInactiveIdx : showFallbackIdx;
    assert.ok(actualShowIdx < waiterIdx, 'window must be shown before visibleReadyPromise is registered');
});

test('quickSwitcher service: _doShow sets _showing=false in finally block', () => {
    const idx = QS_SERVICE.indexOf('async function showQuickSwitcherOverlay');
    const block = QS_SERVICE.slice(idx, idx + 600);
    assert.ok(block.includes('finally'), 'showQuickSwitcherOverlay must use a finally block');
    const finallyIdx = block.indexOf('finally');
    const showingFalseIdx = block.indexOf('_showing = false', finallyIdx);
    assert.ok(showingFalseIdx !== -1, '_showing = false must be inside the finally block');
    assert.ok(showingFalseIdx > finallyIdx, '_showing = false must come after finally');
});

test('quickSwitcher service: _doShow visible-ready timeout log says "continuing" not "aborting"', () => {
    const idx = QS_SERVICE.indexOf('function _doShow');
    const block = QS_SERVICE.slice(idx, idx + 5000);
    assert.ok(block.includes('visible-ready timeout'), '_doShow must log visible-ready timeout');
    assert.ok(block.includes('continuing'), 'visible-ready timeout must log "continuing" (not aborting)');
    assert.ok(!block.includes('visible-ready timeout — aborting'), 'must not use old "aborting" message for visible-ready');
});

test('quick-switcher renderer: sends visibleReady immediately (not inside rAF or after loadAccounts)', () => {
    // visibleReady must appear before _loadAccounts call in the onShow handler source order
    const onShowIdx = QS_RENDERER.indexOf('api.onShow(');
    const block = QS_RENDERER.slice(onShowIdx, onShowIdx + 1500);
    const vrIdx = block.indexOf('api.visibleReady(');
    const loadIdx = block.indexOf('_loadAccounts');
    assert.ok(vrIdx !== -1, 'visibleReady must be called inside onShow');
    assert.ok(loadIdx !== -1, '_loadAccounts must be called inside onShow');
    assert.ok(vrIdx < loadIdx, 'visibleReady must be sent before _loadAccounts (not after account loading)');
});

test('quick-switcher renderer: onShow adds is-open before sending visibleReady', () => {
    const onShowIdx = QS_RENDERER.indexOf('api.onShow(');
    const block = QS_RENDERER.slice(onShowIdx, onShowIdx + 1500);
    const addOpenIdx = block.indexOf("classList.add('is-open')");
    const vrIdx = block.indexOf('api.visibleReady(');
    assert.ok(addOpenIdx !== -1, 'onShow must add is-open class');
    assert.ok(vrIdx !== -1, 'onShow must call visibleReady');
    assert.ok(addOpenIdx < vrIdx, 'is-open must be added before visibleReady is sent');
});

test('quick-switcher renderer: onShow removes is-closing before adding is-open', () => {
    const onShowIdx = QS_RENDERER.indexOf('api.onShow(');
    const block = QS_RENDERER.slice(onShowIdx, onShowIdx + 1500);
    const removeClosingIdx = block.indexOf("remove('is-closing')");
    const addOpenIdx = block.indexOf("classList.add('is-open')");
    assert.ok(removeClosingIdx !== -1, 'onShow must remove is-closing class');
    assert.ok(addOpenIdx !== -1, 'onShow must add is-open class');
    assert.ok(removeClosingIdx < addOpenIdx, 'is-closing must be removed before is-open is added');
});

// ── Error safety ──────────────────────────────────────────────────────────────

test('quickSwitcher service: showQuickSwitcherOverlay catches errors from _doShow', () => {
    const idx = QS_SERVICE.indexOf('async function showQuickSwitcherOverlay');
    const block = QS_SERVICE.slice(idx, idx + 500);
    assert.ok(block.includes('catch'), 'showQuickSwitcherOverlay must catch errors thrown by _doShow');
});

// ── Renderer: qs:hide and showSeq ────────────────────────────────────────────

test('quick-switcher renderer: registers qs:hide listener via api.onHide', () => {
    assert.ok(QS_RENDERER.includes('api.onHide('),
        'quick-switcher.js must register a qs:hide listener via api.onHide()');
});

test('quick-switcher renderer: onHide removes is-open class', () => {
    const idx = QS_RENDERER.indexOf('api.onHide(');
    const block = QS_RENDERER.slice(idx, idx + 200);
    assert.ok(block.includes("remove('is-open')") || block.includes('classList.remove'),
        'onHide handler must remove the is-open class from the overlay');
});

test('quick-switcher renderer: visibleReady sends showSeq payload', () => {
    const idx = QS_RENDERER.lastIndexOf('api.visibleReady(');
    const call = QS_RENDERER.slice(idx, idx + 60);
    assert.ok(call.includes('showSeq'),
        'api.visibleReady() must pass showSeq so main can correlate signals');
});

test('quick-switcher renderer: _debugShowSeq variable is removed in release', () => {
    assert.ok(!QS_RENDERER.includes('_debugShowSeq'),
        '_debugShowSeq is a debug-only variable and must not be present in release builds');
});
