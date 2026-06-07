'use strict';

const { app } = require('electron');
const path = require('path');
const fs = require('fs').promises;

const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'quick-switcher-settings.json');

const VALID_POSITIONS = new Set(['right', 'center', 'left', 'top', 'bottom']);

const DEFAULTS = Object.freeze({
    version: 1,
    enabled: true,
    accelerator: 'Ctrl+Alt+B',
    position: 'right',
    closeAfterSwitch: true,
    showOnlyPlatformsWithAccounts: true,
    showSearchOnOpen: true,
    updatedAt: 0,
});

let _cache = null;

function _coerce(raw) {
    const out = { ...DEFAULTS };
    if (typeof raw.enabled === 'boolean') out.enabled = raw.enabled;
    if (typeof raw.accelerator === 'string' && raw.accelerator) out.accelerator = raw.accelerator;
    if (raw.accelerator === null) out.accelerator = null;
    if (typeof raw.position === 'string' && VALID_POSITIONS.has(raw.position)) out.position = raw.position;
    if (typeof raw.closeAfterSwitch === 'boolean') out.closeAfterSwitch = raw.closeAfterSwitch;
    if (typeof raw.showOnlyPlatformsWithAccounts === 'boolean') out.showOnlyPlatformsWithAccounts = raw.showOnlyPlatformsWithAccounts;
    if (typeof raw.showSearchOnOpen === 'boolean') out.showSearchOnOpen = raw.showSearchOnOpen;
    if (typeof raw.updatedAt === 'number') out.updatedAt = raw.updatedAt;
    return out;
}

async function load() {
    if (_cache) return { ..._cache };
    try {
        const raw = await fs.readFile(SETTINGS_FILE(), 'utf8');
        _cache = _coerce(JSON.parse(raw));
    } catch {
        _cache = { ...DEFAULTS };
    }
    return { ..._cache };
}

async function save(partial) {
    const current = await load();
    const merged = _coerce({ ...current, ...partial });
    merged.updatedAt = Date.now();
    _cache = merged;
    await fs.writeFile(SETTINGS_FILE(), JSON.stringify(merged, null, 2), 'utf8');
    return { ...merged };
}

function invalidateCache() { _cache = null; }

module.exports = { load, save, invalidateCache, VALID_POSITIONS, DEFAULTS };
