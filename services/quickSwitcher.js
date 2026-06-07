'use strict';

const { BrowserWindow, globalShortcut, screen } = require('electron');
const path = require('path');
const quickSwitcherSettings = require('./quickSwitcherSettings');
const accountShortcuts = require('./accountShortcuts');

let _win = null;
let _ready = false;
let _hotkeyAccelerator = null;

// ── Window management ────────────────────────────────────────────────────────

function createQuickSwitcherWindow() {
    if (_win && !_win.isDestroyed()) return;
    _ready = false;

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
            preload: path.join(__dirname, '..', 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            devTools: false,
        },
    });

    _win.loadFile(path.join(__dirname, '..', 'src', 'quick-switcher.html'));

    _win.webContents.once('did-finish-load', () => { _ready = true; });

    _win.on('blur', () => {
        // Small delay so a click on the window itself doesn't immediately hide it.
        setTimeout(() => {
            if (_win && !_win.isDestroyed() && _win.isVisible() && !_win.isFocused()) {
                _win.hide();
            }
        }, 150);
    });

    _win.on('closed', () => {
        _win = null;
        _ready = false;
    });
}

function _positionWindow(settings) {
    if (!_win || _win.isDestroyed()) return;
    try {
        const cursor = screen.getCursorScreenPoint();
        const display = screen.getDisplayNearestPoint(cursor);
        const wa = display.workArea;
        const [winW, winH] = _win.getSize();
        let x, y;
        switch (settings.position) {
            case 'right':
                x = wa.x + wa.width - winW - 22;
                y = wa.y + Math.round((wa.height - winH) / 2);
                break;
            case 'left':
                x = wa.x + 22;
                y = wa.y + Math.round((wa.height - winH) / 2);
                break;
            case 'top':
                x = wa.x + Math.round((wa.width - winW) / 2);
                y = wa.y + 22;
                break;
            case 'bottom':
                x = wa.x + Math.round((wa.width - winW) / 2);
                y = wa.y + wa.height - winH - 22;
                break;
            default:
                x = wa.x + Math.round((wa.width - winW) / 2);
                y = wa.y + Math.round((wa.height - winH) / 2);
        }
        _win.setBounds({ x, y, width: winW, height: winH });
    } catch {}
}

async function showQuickSwitcherOverlay() {
    const settings = await quickSwitcherSettings.load();
    if (!settings.enabled) return;

    if (!_win || _win.isDestroyed()) {
        createQuickSwitcherWindow();
        // Give the window time to load before positioning and showing.
        await new Promise(r => setTimeout(r, 250));
    }

    _positionWindow(settings);

    if (_win && !_win.isDestroyed()) {
        _win.show();
        _win.focus();
        if (_ready) {
            _win.webContents.send('qs:show', {
                showSearch:      settings.showSearchOnOpen,
                closeAfterSwitch: settings.closeAfterSwitch,
            });
        }
    }
}

function hideQuickSwitcherOverlay() {
    if (_win && !_win.isDestroyed()) _win.hide();
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

// ── Account data (safe only — no passwords/tokens) ───────────────────────────

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

// ── Hotkey registration ──────────────────────────────────────────────────────

async function registerQuickSwitcherHotkey() {
    const settings = await quickSwitcherSettings.load();
    unregisterQuickSwitcherHotkey();
    if (!settings.enabled || !settings.accelerator) return false;
    const ok = globalShortcut.register(settings.accelerator, () => {
        toggleQuickSwitcherOverlay().catch(() => {});
    });
    if (ok) _hotkeyAccelerator = settings.accelerator;
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
