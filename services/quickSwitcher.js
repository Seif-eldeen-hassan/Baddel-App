'use strict';

const { BrowserWindow, globalShortcut, screen, ipcMain } = require('electron');
const path = require('path');
const quickSwitcherSettings = require('./quickSwitcherSettings');
const accountShortcuts = require('./accountShortcuts');

const QS_DEBUG = process.env.BADDEL_QS_DEBUG === '1';

let _win = null;
let _ready = false;          // true after qs:renderer-ready received
let _hotkeyAccelerator = null;
let _showing = false;        // guard against concurrent show calls
let _showSeq = 0;            // incremented on each _doShow call for sequence tracking

// Mutable boxes — ipcMain listeners write .resolve; _waitForSignal reads it.
const _rrHolder = { resolve: null }; // renderer-ready
const _vrHolder = { resolve: null }; // visible-ready

// ── Path resolution helpers ───────────────────────────────────────────────────

function firstExistingPath(paths) {
    const fs = require('fs');
    for (const p of paths) {
        try {
            if (p && fs.existsSync(p)) return p;
        } catch {}
    }
    return null;
}

function resolveQuickSwitcherHtmlPath() {
    const { app } = require('electron');
    const appPath = app.getAppPath ? app.getAppPath() : null;
    const candidates = [
        // Packaged/protected app root (e.g. resources/app.asar)
        appPath && path.join(appPath, 'quick-switcher.html'),
        // Protected build folder before packaging
        path.join(__dirname, 'quick-switcher.html'),
        // Dev/source layout
        path.join(__dirname, '..', 'src', 'quick-switcher.html'),
        path.join(process.cwd(), 'src', 'quick-switcher.html'),
    ].filter(Boolean);
    return firstExistingPath(candidates) || candidates[0];
}

function resolveQuickSwitcherPreloadPath() {
    const { app } = require('electron');
    const appPath = app.getAppPath ? app.getAppPath() : null;
    const candidates = [
        // Packaged/protected app root (e.g. resources/app.asar)
        appPath && path.join(appPath, 'preload.bundle.cjs'),
        // Protected build folder before packaging
        path.join(__dirname, 'preload.bundle.cjs'),
        // Dev/source layout
        path.join(__dirname, '..', 'preload.js'),
        path.join(process.cwd(), 'preload.js'),
    ].filter(Boolean);
    return firstExistingPath(candidates) || candidates[0];
}

// ── Logger (writes to protected-quick-switcher.log) ──────────────────────────

function logQuickSwitcher(message, extra) {
    const line = `[${new Date().toISOString()}] ${message}${extra ? ' ' + JSON.stringify(extra) : ''}`;
    console.log(line);

    try {
        const { app } = require('electron');
        const fs = require('fs');
        const logPath = path.join(app.getPath('userData'), 'protected-quick-switcher.log');
        fs.appendFileSync(logPath, line + '\n', 'utf8');
    } catch {}
}

function debugLogQuickSwitcher(message, extra) {
    if (!QS_DEBUG) return;
    logQuickSwitcher(message, extra);
}

function _getQuickSwitcherState(label) {
    return {
        label,
        win:       _win ? (_win.isDestroyed() ? 'destroyed' : (_win.isVisible() ? 'visible' : 'hidden')) : 'null',
        ready:     _ready,
        showing:   _showing,
        showSeq:   _showSeq,
        rrResolve: !!_rrHolder.resolve,
        vrResolve: !!_vrHolder.resolve,
    };
}

function _debugLogState(label) {
    if (!QS_DEBUG) return;
    logQuickSwitcher('[QuickSwitcher] state', _getQuickSwitcherState(label));
}

// Returns a Promise that resolves to true when the signal fires, or false on timeout.
function _waitForSignal(holder, timeoutMs) {
    return new Promise(resolve => {
        let done = false;
        const finish = (ok) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            holder.resolve = null;
            resolve(ok);
        };
        const timer = setTimeout(() => finish(false), timeoutMs);
        holder.resolve = () => finish(true);
    });
}

// ── IPC readiness signals from renderer ──────────────────────────────────────

ipcMain.on('qs:renderer-ready', (event) => {
    if (!_win || _win.isDestroyed() || event.sender !== _win.webContents) return;
    _ready = true;
    if (_rrHolder.resolve) _rrHolder.resolve();
});

ipcMain.on('qs:visible-ready', (event, data) => {
    if (!_win || _win.isDestroyed() || event.sender !== _win.webContents) return;
    debugLogQuickSwitcher('[QuickSwitcher] qs:visible-ready received', { rendererSeq: data?.showSeq, mainSeq: _showSeq });
    if (_vrHolder.resolve) _vrHolder.resolve();
});

// ── Window management ─────────────────────────────────────────────────────────

function createQuickSwitcherWindow() {
    if (_win && !_win.isDestroyed()) return;
    _ready = false;

    const preloadPath = resolveQuickSwitcherPreloadPath();
    const htmlPath    = resolveQuickSwitcherHtmlPath();
    const { existsSync } = require('fs');

    debugLogQuickSwitcher('[QuickSwitcher] preload path', { path: preloadPath, exists: preloadPath ? existsSync(preloadPath) : false });
    debugLogQuickSwitcher('[QuickSwitcher] html path', { path: htmlPath, exists: htmlPath ? existsSync(htmlPath) : false });

    if (!preloadPath || !existsSync(preloadPath)) {
        logQuickSwitcher('[QuickSwitcher] preload path missing; aborting show');
        return;
    }
    if (!htmlPath || !existsSync(htmlPath)) {
        logQuickSwitcher('[QuickSwitcher] html path missing; aborting show');
        return;
    }

    _win = new BrowserWindow({
        width: 460,
        height: 560,
        show: false,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        hasShadow: false,
        resizable: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        focusable: true,
        fullscreenable: false,
        webPreferences: {
            preload: preloadPath,
            contextIsolation: true,
            nodeIntegration: false,
            devTools: false,
        },
    });

    // Block mouse events while the window is hidden / loading — prevents the
    // transparent window from swallowing clicks before content is visible.
    _win.setIgnoreMouseEvents(true);

    _win.webContents.on('did-fail-load', (event, code, desc, url) => {
        logQuickSwitcher('[QuickSwitcher] did-fail-load', { code, desc, url });
    });
    _win.webContents.on('render-process-gone', (event, details) => {
        logQuickSwitcher('[QuickSwitcher] render-process-gone', details);
    });

    _win.loadFile(htmlPath);

    _win.on('blur', () => {
        // Small delay so a click on the window itself doesn't immediately hide it.
        setTimeout(() => {
            if (_win && !_win.isDestroyed() && _win.isVisible() && !_win.isFocused()) {
                _win.setIgnoreMouseEvents(true);
                _win.hide();
            }
        }, 150);
    });

    _win.on('closed', () => {
        _win = null;
        _ready = false;
        // Null out pending waiters so they fall through to timeout.
        _rrHolder.resolve = null;
        _vrHolder.resolve = null;
    });
}

function _positionWindow() {
    if (!_win || _win.isDestroyed()) return;
    try {
        const cursor  = screen.getCursorScreenPoint();
        const display = screen.getDisplayNearestPoint(cursor);
        const { x, y, width, height } = display.workArea;
        _win.setBounds({ x, y, width, height });
    } catch {}
}

async function showQuickSwitcherOverlay() {
    if (_showing) {
        debugLogQuickSwitcher('[QuickSwitcher] showQuickSwitcherOverlay already in progress — skipped');
        return;
    }
    _showing = true;
    try {
        await _doShow();
    } catch (err) {
        logQuickSwitcher('[QuickSwitcher] _doShow threw', { message: err?.message, stack: err?.stack });
    } finally {
        _showing = false;
    }
}

async function _doShow() {
    const seq = ++_showSeq;
    debugLogQuickSwitcher('[QuickSwitcher] _doShow start', { seq });
    const settings = await quickSwitcherSettings.load();
    if (!settings.enabled) { debugLogQuickSwitcher('[QuickSwitcher] disabled — abort', { seq }); return; }

    // Register the renderer-ready waiter BEFORE creating the window so the
    // signal cannot arrive before _rrHolder.resolve is assigned.
    const rendererReadyPromise = !_ready ? _waitForSignal(_rrHolder, 1500) : null;
    debugLogQuickSwitcher('[QuickSwitcher] _ready at show time', { ready: _ready, seq });

    if (!_win || _win.isDestroyed()) {
        debugLogQuickSwitcher('[QuickSwitcher] creating window', { seq });
        createQuickSwitcherWindow();
    }

    // Prevent mouse events reaching anything below while we wait for the renderer.
    if (_win && !_win.isDestroyed()) _win.setIgnoreMouseEvents(true);

    if (rendererReadyPromise) {
        debugLogQuickSwitcher('[QuickSwitcher] waiting for renderer-ready…', { seq });
        const rrOk = await rendererReadyPromise;
        if (!rrOk) {
            logQuickSwitcher('[QuickSwitcher] renderer-ready timeout — aborting show', { seq });
            _debugLogState('rr-timeout');
            if (_win && !_win.isDestroyed()) { _win.setIgnoreMouseEvents(false); _win.hide(); }
            return;
        }
        debugLogQuickSwitcher('[QuickSwitcher] renderer-ready received', { seq });
    }

    if (!_win || _win.isDestroyed()) { debugLogQuickSwitcher('[QuickSwitcher] win gone after rr wait', { seq }); return; }

    _positionWindow();

    if (typeof _win.setIgnoreMouseEvents === 'function') {
        _win.setIgnoreMouseEvents(true);
    }

    // Show the window FIRST so the renderer can paint while visible.
    // Gating on a renderer signal before show is unreliable — hidden windows
    // may not fire requestAnimationFrame after the first hide.
    if (typeof _win.showInactive === 'function') {
        _win.showInactive();
    } else {
        _win.show();
    }
    debugLogQuickSwitcher('[QuickSwitcher] window shown for renderer paint', { seq });

    // Register the waiter BEFORE sending qs:show so the renderer cannot reply
    // faster than _vrHolder.resolve is assigned (warm/cached renderer race).
    const visibleReadyPromise = _waitForSignal(_vrHolder, 800);

    _win.webContents.send('qs:show', {
        showSearch:       settings.showSearchOnOpen,
        closeAfterSwitch: settings.closeAfterSwitch,
        showSeq:          seq,
    });
    debugLogQuickSwitcher('[QuickSwitcher] qs:show sent', { seq });

    // Wait briefly for visible-ready — informational only, not a gate.
    // The window is already shown; do not abort or hide on timeout.
    const vrOk = await visibleReadyPromise;

    if (!vrOk) {
        logQuickSwitcher('[QuickSwitcher] visible-ready timeout; continuing because window is already shown', { seq });
    }

    if (_win && !_win.isDestroyed()) {
        if (typeof _win.setIgnoreMouseEvents === 'function') {
            _win.setIgnoreMouseEvents(false);
        }
        _win.focus();
        debugLogQuickSwitcher('[QuickSwitcher] focused', { seq, visibleReady: vrOk });
    }
}

function hideQuickSwitcherOverlay(reason = 'unknown') {
    _showing = false;
    _vrHolder.resolve = null;
    _rrHolder.resolve = null;
    if (_win && !_win.isDestroyed()) {
        try { _win.webContents.send('qs:hide', { reason }); } catch {}
        _win.setIgnoreMouseEvents(true);
        _win.hide();
    }
}

async function toggleQuickSwitcherOverlay() {
    if (_win && !_win.isDestroyed() && _win.isVisible()) {
        hideQuickSwitcherOverlay();
    } else {
        await showQuickSwitcherOverlay();
    }
}

function destroyQuickSwitcherWindow() {
    if (_win && !_win.isDestroyed()) {
        _win.destroy();
        _win = null;
        _ready = false;
    }
}

// ── Account data (safe only — no passwords/tokens) ────────────────────────────

async function getQuickSwitcherAccounts() {
    // Lazy require to avoid circular dependency at module load time.
    const { getAllAccountsForQuickSwitcher } = require('../accountsHandler');
    const shortcuts = await accountShortcuts.getAll();
    const shortcutMap = new Map();
    for (const sc of shortcuts) {
        shortcutMap.set(`${sc.platform}::${sc.accountId}`, sc.accelerator);
    }

    const groups = await getAllAccountsForQuickSwitcher();
    return groups.map(group => ({
        platform:      group.platform,
        platformLabel: group.platformLabel,
        accounts: group.accounts.map(acc => {
            const sc = shortcutMap.get(`${group.platform}::${acc.accountId}`);
            return {
                accountId:        acc.accountId,
                accountName:      acc.accountName,
                isActive:         acc.isActive,
                hasDirectShortcut: !!sc,
                shortcut:         sc || null,
            };
        }),
    }));
}

// ── Hotkey registration ───────────────────────────────────────────────────────

function _onHotkeyFired() {
    toggleQuickSwitcherOverlay().catch(() => {});
}

async function registerQuickSwitcherHotkey() {
    const settings = await quickSwitcherSettings.load();
    debugLogQuickSwitcher('[QuickSwitcher] register start');
    unregisterQuickSwitcherHotkey();
    if (!settings.enabled || !settings.accelerator) return false;
    const ok = globalShortcut.register(settings.accelerator, _onHotkeyFired);
    debugLogQuickSwitcher('[QuickSwitcher] globalShortcut.register', { accelerator: settings.accelerator, ok });
    if (!ok) console.warn('[QuickSwitcher] hotkey registration failed — shortcut may be in use by another app');
    else _hotkeyAccelerator = settings.accelerator;
    return ok;
}

function unregisterQuickSwitcherHotkey() {
    if (_hotkeyAccelerator) {
        try { globalShortcut.unregister(_hotkeyAccelerator); } catch {}
        _hotkeyAccelerator = null;
    }
}

function getWindow() { return _win; }
function isReady()   { return _ready; }

module.exports = {
    createQuickSwitcherWindow,
    showQuickSwitcherOverlay,
    hideQuickSwitcherOverlay,
    toggleQuickSwitcherOverlay,
    destroyQuickSwitcherWindow,
    getQuickSwitcherAccounts,
    registerQuickSwitcherHotkey,
    unregisterQuickSwitcherHotkey,
    getWindow,
    isReady,
};
