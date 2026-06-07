'use strict';

/* global electronAPI */

const api = window.electronAPI.quickSwitcher;

// ── State ────────────────────────────────────────────────────────────────────

let _groups = [];           // raw groups from main process
let _flat = [];             // flat list of { type, ... } items
let _selIdx = -1;           // index into _flat pointing at an 'account' item
let _closeAfterSwitch = true;

// ── DOM refs ─────────────────────────────────────────────────────────────────

const searchEl = document.getElementById('quickSwitcherSearch');
const listEl   = document.getElementById('quickSwitcherList');
const errorEl  = document.getElementById('quickSwitcherError');
const closeBtn = document.getElementById('quickSwitcherClose');

// ── Platform icon assets ──────────────────────────────────────────────────────

const PLATFORM_ICONS = {
    steam:    '../assets/Steam.png',
    epic:     '../assets/epic.svg',
    ea:       '../assets/ea.png',
    riot:     '../assets/riot.png',
    ubisoft:  '../assets/Ubisoft_white.png',
    discord:  '../assets/discord.webp',
    rockstar: '../assets/rockstar.png',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function _esc(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Returns an <img> tag for the platform icon, or a fallback span.
function getPlatformIcon(platform) {
    const src = PLATFORM_ICONS[platform];
    if (src) {
        return `<img class="qs-platform-icon" src="${_esc(src)}" alt="" draggable="false">`;
    }
    return `<span class="qs-platform-icon qs-platform-icon-fallback">${_esc(String(platform || '?')[0].toUpperCase())}</span>`;
}

// ── Flat list builder ────────────────────────────────────────────────────────

function _buildFlat(query) {
    const q = (query || '').toLowerCase().trim();
    const items = [];
    for (const group of _groups) {
        const matching = q
            ? group.accounts.filter(a =>
                a.accountName.toLowerCase().includes(q) ||
                group.platformLabel.toLowerCase().includes(q))
            : group.accounts;
        if (matching.length === 0) continue;
        items.push({
            type: 'header',
            platform: group.platform,
            platformLabel: group.platformLabel,
            count: matching.length,
        });
        for (const acc of matching) {
            items.push({ type: 'account', platform: group.platform, platformLabel: group.platformLabel, ...acc });
        }
    }
    return items;
}

function _accountIndices() {
    return _flat.reduce((acc, item, i) => { if (item.type === 'account') acc.push(i); return acc; }, []);
}

// ── HTML builders ─────────────────────────────────────────────────────────────

function _platformHeaderHtml(item) {
    const iconSrc = PLATFORM_ICONS[item.platform];
    const iconHtml = iconSrc
        ? `<img class="qs-platform-heading-icon" src="${_esc(iconSrc)}" alt="" draggable="false">`
        : `<span class="qs-platform-heading-icon qs-platform-icon-fallback">${_esc((item.platformLabel[0] || '?').toUpperCase())}</span>`;
    return `<div class="qs-platform-header" data-platform="${_esc(item.platform)}">
        ${iconHtml}
        <span class="qs-platform-name">${_esc(item.platformLabel)}</span>
        <span class="qs-platform-count">${item.count}</span>
    </div>`;
}

function _accountRowHtml(item, idx) {
    const classes = [
        'qs-account-row',
        item.isActive   ? 'is-active'   : '',
        idx === _selIdx ? 'is-selected' : '',
    ].filter(Boolean).join(' ');

    const activeBadge  = item.isActive ? `<span class="qs-active-badge">Active</span>` : '';
    const shortcutPill = item.shortcut ? `<span class="qs-shortcut-pill">${_esc(item.shortcut.replace(/\+/g, ' + '))}</span>` : '';

    return `<button class="${_esc(classes)}" data-flat-idx="${idx}" data-platform="${_esc(item.platform)}" type="button">
        <span class="qs-row-indicator" aria-hidden="true"></span>
        <span class="qs-account-icon-wrap">
            ${getPlatformIcon(item.platform)}
        </span>
        <span class="qs-account-main">
            <strong class="qs-account-name">${_esc(item.accountName)}</strong>
            <span class="qs-account-meta">${_esc(item.platformLabel)}</span>
        </span>
        <span class="qs-account-side">
            ${activeBadge}
            ${shortcutPill}
            <span class="qs-enter-hint" aria-hidden="true">↵</span>
        </span>
    </button>`;
}

function _emptyStateHtml(query) {
    const searchIcon = `<svg class="qs-empty-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
    const userIcon   = `<svg class="qs-empty-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>`;
    if (query) {
        return `<div class="qs-empty">${searchIcon}<strong>No matching accounts</strong><span>Try another account or platform name</span></div>`;
    }
    return `<div class="qs-empty">${userIcon}<strong>No accounts found</strong><span>Add accounts in Baddel to see them here</span></div>`;
}

// ── Render ────────────────────────────────────────────────────────────────────

function _render() {
    const accIdxs = _accountIndices();

    if (accIdxs.length === 0) {
        listEl.innerHTML = _emptyStateHtml(searchEl.value.trim());
        return;
    }

    // Clamp selection to first real account item
    if (_selIdx === -1 || !_flat[_selIdx] || _flat[_selIdx].type !== 'account') {
        _selIdx = accIdxs[0];
    }

    // Group items into platform sections
    const sections = [];
    let cur = null;
    _flat.forEach((item, idx) => {
        if (item.type === 'header') { cur = { header: item, rows: [] }; sections.push(cur); }
        else if (cur)               { cur.rows.push({ item, idx }); }
    });

    listEl.innerHTML = sections.map(sec =>
        `<div class="qs-platform-group">
            ${_platformHeaderHtml(sec.header)}
            ${sec.rows.map(({ item, idx }) => _accountRowHtml(item, idx)).join('')}
        </div>`
    ).join('');

    _scrollSelIntoView();
}

function _highlightSelected() {
    listEl.querySelectorAll('.qs-account-row').forEach(el => {
        const i = Number(el.dataset.flatIdx);
        el.classList.toggle('is-selected', i === _selIdx);
    });
    _scrollSelIntoView();
}

function _scrollSelIntoView() {
    const sel = listEl.querySelector('.is-selected');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
}

// ── Navigation ────────────────────────────────────────────────────────────────

function _moveSelection(delta) {
    const idxs = _accountIndices();
    if (idxs.length === 0) return;
    const pos  = idxs.indexOf(_selIdx);
    const next = pos === -1
        ? (delta > 0 ? 0 : idxs.length - 1)
        : (pos + delta + idxs.length) % idxs.length;
    _selIdx = idxs[next];
    _highlightSelected();
    _scrollSelIntoView();
}

// ── Switch ────────────────────────────────────────────────────────────────────

async function _switchAccount(item) {
    errorEl.textContent = '';
    const idx = _flat.indexOf(item);
    const el  = listEl.querySelector(`[data-flat-idx="${idx}"]`);
    if (el) el.classList.add('is-switching');

    const result = await api.switchAccount({ platform: item.platform, accountId: item.accountId });

    if (result?.status === 'ok') {
        if (_closeAfterSwitch) {
            api.hide();
        } else {
            await _loadAccounts();
        }
    } else {
        if (el) el.classList.remove('is-switching');
        errorEl.textContent = result?.message || 'Switch failed. Try again.';
    }
}

// ── Load & refresh ────────────────────────────────────────────────────────────

async function _loadAccounts() {
    listEl.innerHTML = `<div class="qs-loading"><div class="qs-spinner"></div><span>Loading accounts…</span></div>`;
    errorEl.textContent = '';
    _selIdx = -1;

    try {
        _groups = await api.listAccounts();
        if (!Array.isArray(_groups)) _groups = [];
    } catch {
        _groups = [];
        errorEl.textContent = 'Could not load accounts.';
    }

    _flat = _buildFlat(searchEl.value);
    _render();
}

function _onSearchInput() {
    _flat = _buildFlat(searchEl.value);
    _selIdx = -1;
    _render();
}

// ── Keyboard handler ──────────────────────────────────────────────────────────

function _onKeyDown(e) {
    switch (e.key) {
        case 'Escape':
            e.preventDefault();
            api.hide();
            break;
        case 'ArrowDown':
            e.preventDefault();
            _moveSelection(1);
            break;
        case 'ArrowUp':
            e.preventDefault();
            _moveSelection(-1);
            break;
        case 'Enter':
            e.preventDefault();
            if (_selIdx >= 0 && _flat[_selIdx]?.type === 'account') {
                _switchAccount(_flat[_selIdx]);
            }
            break;
    }
}

// ── Init ──────────────────────────────────────────────────────────────────────

function _init() {
    document.addEventListener('keydown', _onKeyDown);
    closeBtn?.addEventListener('click', () => api.hide());
    searchEl?.addEventListener('input', _onSearchInput);

    // Event delegation for list clicks and hover selection
    listEl.addEventListener('click', e => {
        const row = e.target.closest('.qs-account-row');
        if (!row) return;
        const item = _flat[Number(row.dataset.flatIdx)];
        if (item?.type === 'account') _switchAccount(item);
    });
    listEl.addEventListener('mouseover', e => {
        const row = e.target.closest('.qs-account-row');
        if (!row) return;
        const idx = Number(row.dataset.flatIdx);
        if (_flat[idx]?.type === 'account') { _selIdx = idx; _highlightSelected(); }
    });

    // Main process fires 'qs:show' each time the overlay is shown.
    api.onShow(({ showSearch, closeAfterSwitch }) => {
        _closeAfterSwitch = closeAfterSwitch !== false;
        searchEl.value = '';
        _loadAccounts().then(() => {
            if (showSearch !== false) searchEl.focus();
        });
    });

    _loadAccounts();
}

_init();
