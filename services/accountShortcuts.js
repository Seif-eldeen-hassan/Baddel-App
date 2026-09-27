'use strict';

const path   = require('path');
const fs     = require('fs').promises;
const crypto = require('crypto');
const { app, globalShortcut, Notification } = require('electron');

const SHORTCUTS_FILE = () => path.join(app.getPath('userData'), 'account-shortcuts.json');

// Accelerators that are blocked because they are OS/app reserved combos.
const BLOCKED = new Set([
    'Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+A', 'Ctrl+Z', 'Ctrl+Y',
    'Ctrl+S', 'Ctrl+P', 'Ctrl+W', 'Ctrl+R', 'Ctrl+F', 'Ctrl+T',
    'Ctrl+N', 'Ctrl+Q', 'Alt+F4', 'Alt+Tab', 'F5', 'F11', 'F12',
    'Ctrl+Shift+I', 'Ctrl+Shift+J',
]);

const VALID_PLATFORMS = new Set(['steam', 'epic', 'gog', 'ea', 'riot', 'ubisoft', 'discord', 'rockstar']);

const MODIFIER_NAMES = new Set(['ctrl', 'control', 'commandorcontrol', 'shift', 'alt', 'super', 'meta']);
const MOD_ORDER = ['Ctrl', 'Shift', 'Alt', 'Super'];

let _switchFn = null;
// Track which accelerators we registered so we only unregister our own.
const _ours = new Set();

// ── Storage ─────────────────────────────────────────────────────────────────

async function _load() {
    try {
        const raw = await fs.readFile(SHORTCUTS_FILE(), 'utf8');
        const obj = JSON.parse(raw);
        if (obj && Array.isArray(obj.shortcuts)) return obj;
    } catch {}
    return { version: 1, shortcuts: [] };
}

async function _save(data) {
    await fs.writeFile(SHORTCUTS_FILE(), JSON.stringify(data, null, 2), 'utf8');
}

// ── Accelerator utilities ────────────────────────────────────────────────────

function normalizeAccelerator(accelerator) {
    if (!accelerator || typeof accelerator !== 'string') return '';
    const parts = accelerator.split('+').map(p => p.trim()).filter(Boolean);
    const mods = [];
    const keys = [];
    for (const p of parts) {
        if (MODIFIER_NAMES.has(p.toLowerCase())) mods.push(p);
        else keys.push(p);
    }
    if (keys.length === 0) return '';

    const normMods = [...new Set(mods.map(m => {
        const l = m.toLowerCase();
        if (l === 'control' || l === 'commandorcontrol') return 'Ctrl';
        if (l === 'shift')  return 'Shift';
        if (l === 'alt')    return 'Alt';
        if (l === 'super' || l === 'meta') return 'Super';
        return m.charAt(0).toUpperCase() + m.slice(1).toLowerCase();
    }))];
    normMods.sort((a, b) => {
        const ai = MOD_ORDER.indexOf(a), bi = MOD_ORDER.indexOf(b);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

    const rawKey = keys[0];
    let normKey;
    const fn = rawKey.match(/^F(\d+)$/i);
    if (fn) normKey = `F${fn[1]}`;
    else if (rawKey.length === 1) normKey = rawKey.toUpperCase();
    else normKey = rawKey.charAt(0).toUpperCase() + rawKey.slice(1).toLowerCase();

    return [...normMods, normKey].join('+');
}

function validateAccelerator(accelerator) {
    if (!accelerator || typeof accelerator !== 'string') {
        return { valid: false, error: 'Shortcut cannot be empty.' };
    }
    const norm = normalizeAccelerator(accelerator);
    if (!norm) return { valid: false, error: 'Invalid shortcut format.' };

    const parts = norm.split('+');
    const mods = parts.filter(p => new Set(['ctrl','shift','alt','super']).has(p.toLowerCase()));
    const keys = parts.filter(p => !new Set(['ctrl','shift','alt','super']).has(p.toLowerCase()));

    if (keys.length === 0) return { valid: false, error: 'Shortcut must include a non-modifier key.' };
    if (mods.length < 1) {
        return { valid: false, error: 'Use at least one modifier key (e.g. Ctrl+H, Alt+H, Ctrl+Alt+H).' };
    }
    if (BLOCKED.has(norm)) {
        return { valid: false, error: 'This shortcut is reserved by the system. Try a different combination.' };
    }
    return { valid: true, normalized: norm };
}

// ── Public API ───────────────────────────────────────────────────────────────

async function getAll() {
    const data = await _load();
    // Return only non-sensitive fields.
    return data.shortcuts.map(s => ({
        id:          s.id,
        platform:    s.platform,
        accountId:   s.accountId,
        accountName: s.accountName,
        accelerator: s.accelerator,
        enabled:     s.enabled !== false,
        createdAt:   s.createdAt,
        updatedAt:   s.updatedAt,
    }));
}

async function setShortcut({ platform, accountId, accountName, accelerator }) {
    if (!VALID_PLATFORMS.has(platform))           throw new Error(`Unknown platform: ${platform}`);
    if (!accountId || typeof accountId !== 'string')   throw new Error('accountId is required.');
    if (!accountName || typeof accountName !== 'string') throw new Error('accountName is required.');

    const val = validateAccelerator(accelerator);
    if (!val.valid) throw new Error(val.error);
    const norm = val.normalized;

    const data = await _load();

    // Internal conflict check — same accelerator already used by a different account.
    const conflict = data.shortcuts.find(s =>
        normalizeAccelerator(s.accelerator) === norm &&
        !(s.platform === platform && s.accountId === accountId)
    );
    if (conflict) {
        throw new Error(
            `Shortcut already used by "${conflict.accountName}" (${conflict.platform}). Choose a different combination.`
        );
    }

    const existing = data.shortcuts.find(s => s.platform === platform && s.accountId === accountId);
    const oldAcc   = existing?.accelerator;
    const now      = new Date().toISOString();

    // If same shortcut re-saved with no key change, just update metadata.
    if (oldAcc && normalizeAccelerator(oldAcc) === norm) {
        if (existing) { existing.accountName = accountName; existing.updatedAt = now; }
        await _save(data);
        return { success: true, accelerator: norm };
    }

    // Unregister old before trying new.
    if (oldAcc) {
        try { globalShortcut.unregister(oldAcc); } catch {}
        _ours.delete(oldAcc);
    }

    let registered = false;
    try {
        registered = globalShortcut.register(norm, () => _fire(platform, accountId, accountName));
    } catch (err) {
        _restoreOld(oldAcc, platform, accountId, accountName);
        throw new Error(`Failed to register shortcut: ${err.message}`);
    }

    if (!registered) {
        _restoreOld(oldAcc, platform, accountId, accountName);
        throw new Error(`Shortcut ${norm} is already in use by another application.`);
    }

    _ours.add(norm);

    if (existing) {
        existing.accountName = accountName;
        existing.accelerator  = norm;
        existing.enabled      = true;
        existing.updatedAt    = now;
    } else {
        const id = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
        data.shortcuts.push({ id, platform, accountId, accountName, accelerator: norm, enabled: true, createdAt: now, updatedAt: now });
    }

    await _save(data);
    return { success: true, accelerator: norm };
}

async function clearShortcut({ platform, accountId }) {
    const data = await _load();
    const idx  = data.shortcuts.findIndex(s => s.platform === platform && s.accountId === accountId);
    if (idx === -1) return { success: true };

    const [removed] = data.shortcuts.splice(idx, 1);
    try { globalShortcut.unregister(removed.accelerator); } catch {}
    _ours.delete(removed.accelerator);

    await _save(data);
    return { success: true };
}

async function renameAccount(platform, accountId, accountName) {
    const data = await _load();
    const existing = data.shortcuts.find(s => s.platform === platform && s.accountId === accountId);
    if (!existing) return { success: true };
    existing.accountName = String(accountName || '').trim();
    existing.updatedAt = new Date().toISOString();
    await _save(data);
    return { success: true };
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

async function registerAll(switchCallback) {
    _switchFn = switchCallback;
    const data = await _load();
    for (const s of data.shortcuts) {
        if (!s.enabled || !s.accelerator) continue;
        try {
            const ok = globalShortcut.register(s.accelerator, () => _fire(s.platform, s.accountId, s.accountName));
            if (ok) _ours.add(s.accelerator);
            else console.warn(`[AccountShortcuts] ${s.accelerator} could not be registered — already in use by another app.`);
        } catch (err) {
            console.warn(`[AccountShortcuts] Failed to register ${s.accelerator}:`, err.message);
        }
    }
}

function unregisterAll() {
    for (const acc of _ours) {
        try { globalShortcut.unregister(acc); } catch {}
    }
    _ours.clear();
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function _fire(platform, accountId, accountName) {
    if (typeof _switchFn !== 'function') return;
    Promise.resolve()
        .then(() => _switchFn(platform, accountId, accountName))
        .catch(err => {
            console.error(`[AccountShortcuts] Switch failed (${platform}/${accountId}):`, err.message);
            try {
                new Notification({
                    title: 'Baddel — Switch Failed',
                    body:  `Could not switch to ${accountName}: ${err.message}`,
                }).show();
            } catch {}
        });
}

function _restoreOld(oldAcc, platform, accountId, accountName) {
    if (!oldAcc) return;
    try {
        const ok = globalShortcut.register(oldAcc, () => _fire(platform, accountId, accountName));
        if (ok) _ours.add(oldAcc);
    } catch {}
}

module.exports = {
    getAll,
    setShortcut,
    clearShortcut,
    renameAccount,
    validateAccelerator,
    normalizeAccelerator,
    registerAll,
    unregisterAll,
};
