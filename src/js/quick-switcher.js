'use strict';

/* global electronAPI */

const api = window.electronAPI.quickSwitcher;

// ── State ────────────────────────────────────────────────────────────────────

let _groups           = [];
let _carouselItems    = [];
let _selIdx           = 0;
let _closeAfterSwitch = true;
let _platformFilter   = 'all';
let _isSwitching      = false;
let _focusZone        = 'accounts'; // 'platforms' | 'accounts'
let _platformFocusIdx = 0;         // index of keyboard-focused chip in filtersEl

// ── DOM refs ─────────────────────────────────────────────────────────────────

const overlayEl      = document.getElementById('quickSwitcherApp');
const searchEl       = document.getElementById('quickSwitcherSearch');
const listEl         = document.getElementById('quickSwitcherList');
const errorEl        = document.getElementById('quickSwitcherError');
const closeBtn       = document.getElementById('quickSwitcherClose');
const filtersEl      = document.getElementById('qsPlatformFilters');
const switchStatusEl = document.getElementById('qsSwitchStatus');

// ── Platform icon assets ──────────────────────────────────────────────────────

const PLATFORM_ICONS = {
    steam:    '../assets/Steam.png',
    epic:     '../assets/epic.svg',
    ea:       '../assets/ea.png',
    riot:     '../assets/riot.png',
    ubisoft:  '../assets/Ubisoft_white.png',
    discord:  '../assets/discord.webp',
    rockstar: '../assets/rockstar.png',
    xbox:     '../assets/Xbox_one_logo.png',
};

// Human-readable labels for filter tooltips / aria-labels.
const PLATFORM_LABELS = {
    all:      'All accounts',
    steam:    'Steam',
    epic:     'Epic Games',
    ea:       'EA',
    riot:     'Riot Games',
    ubisoft:  'Ubisoft',
    discord:  'Discord',
    rockstar: 'Rockstar',
    xbox:     'Xbox',
    manual:   'Manual',
};

// Inline SVG used for the "All" filter button (2×2 grid icon).
const ALL_FILTER_ICON = `<svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true"><rect x="0" y="0" width="5.5" height="5.5" rx="1.5"/><rect x="8.5" y="0" width="5.5" height="5.5" rx="1.5"/><rect x="0" y="8.5" width="5.5" height="5.5" rx="1.5"/><rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1.5"/></svg>`;

// ── Carousel offset→visual mapping ───────────────────────────────────────────

const CAROUSEL_STEPS = [
    { x:   0, scale: 1.35, opacity: 1.00, z: 10 },
    { x: 240, scale: 0.84, opacity: 0.60, z:  8 },
    { x: 440, scale: 0.68, opacity: 0.34, z:  6 },
    { x: 590, scale: 0.54, opacity: 0.16, z:  4 },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function _esc(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function _platformIcon(platform, imgCls, fallbackCls) {
    const src = PLATFORM_ICONS[platform];
    if (src) {
        return `<img class="${_esc(imgCls)}" src="${_esc(src)}" alt="" draggable="false">`;
    }
    return `<span class="${_esc(fallbackCls)}">${_esc(String(platform || '?')[0].toUpperCase())}</span>`;
}

// ── Flat list builder — accounts only, respects platform filter ───────────────

function _buildFlat(query) {
    const q = (query || '').toLowerCase().trim();
    const items = [];
    for (const group of _groups) {
        if (_platformFilter !== 'all' && group.platform !== _platformFilter) continue;
        const matching = q
            ? group.accounts.filter(a =>
                a.accountName.toLowerCase().includes(q) ||
                group.platformLabel.toLowerCase().includes(q))
            : group.accounts;
        for (const acc of matching) {
            items.push({ platform: group.platform, platformLabel: group.platformLabel, ...acc });
        }
    }
    return items;
}

// ── Platform chip HTML (utility — used for search/filter UI) ──────────────────

function _platformChipHtml(item) {
    return `<div class="qs-platform-group" data-platform="${_esc(item.platform)}">
        <div class="qs-platform-chip" data-platform="${_esc(item.platform)}">
            ${_platformIcon(item.platform, 'qs-chip-icon', 'qs-chip-icon-fallback')}
            <span class="qs-chip-label">${_esc(item.platformLabel)}</span>
            <span class="qs-platform-count">${item.count}</span>
        </div>
    </div>`;
}

// ── Platform filter icon-button renderer ─────────────────────────────────────

function _renderPlatformFilters() {
    if (!filtersEl) return;
    const present = _groups.filter(g => g.accounts.length > 0);
    if (present.length <= 1) {
        filtersEl.innerHTML = '';
        return;
    }

    const chips = present.map(g => {
        const label    = PLATFORM_LABELS[g.platform] || g.platformLabel;
        const iconSrc  = PLATFORM_ICONS[g.platform];
        const inner    = iconSrc
            ? `<img class="qs-filter-icon" src="${_esc(iconSrc)}" alt="" draggable="false">`
            : `<span class="qs-filter-fallback">${_esc(String(g.platform || '?')[0].toUpperCase())}</span>`;
        const isActive = _platformFilter === g.platform;
        return `<button class="qs-filter-chip${isActive ? ' is-active' : ''}" data-platform="${_esc(g.platform)}" type="button" title="${_esc(label)}" aria-label="${_esc(label)}" aria-pressed="${isActive}" tabindex="${isActive ? '0' : '-1'}">${inner}</button>`;
    });

    const allActive = _platformFilter === 'all';
    filtersEl.innerHTML =
        `<button class="qs-filter-chip qs-filter-all${allActive ? ' is-active' : ''}" data-platform="all" type="button" title="All accounts" aria-label="All accounts" aria-pressed="${allActive}" tabindex="${allActive ? '0' : '-1'}">${ALL_FILTER_ICON}</button>` +
        chips.join('');
}

// ── Account card HTML ─────────────────────────────────────────────────────────

function _accountCardHtml(item, i) {
    const classes = [
        'qs-carousel-item',
        'qs-card',
        item.isActive ? 'is-active' : '',
    ].filter(Boolean).join(' ');

    const activePill = item.isActive
        ? `<span class="qs-active-pill">Active</span>`
        : '';

    return `<button class="${_esc(classes)}" data-item-idx="${i}" data-platform="${_esc(item.platform)}" type="button" tabindex="-1" aria-selected="false">
        <span class="qs-card-avatar">
            ${_platformIcon(item.platform, 'qs-card-icon', 'qs-card-icon-fallback')}
        </span>
        <span class="qs-card-body">
            <span class="qs-card-name">${_esc(item.accountName)}</span>
            <span class="qs-card-platform">${_esc(item.platformLabel)}</span>
            ${activePill}
            <span class="qs-card-state">
                <span class="qs-enter-glyph" aria-hidden="true">↵</span>
            </span>
        </span>
    </button>`;
}

// ── Empty state ───────────────────────────────────────────────────────────────

function _emptyStateHtml(query) {
    if (query || _platformFilter !== 'all') {
        return `<div class="qs-empty qs-carousel-empty">No matching accounts</div>`;
    }
    return `<div class="qs-empty qs-carousel-empty">No accounts found</div>`;
}

// ── Switching feedback ────────────────────────────────────────────────────────

function _showSwitchStatus(text) {
    if (!switchStatusEl) return;
    switchStatusEl.innerHTML =
        `<span class="qs-switch-status-spinner"></span><span>${_esc(text)}</span>`;
    switchStatusEl.classList.add('is-visible');
}

function _hideSwitchStatus() {
    if (!switchStatusEl) return;
    switchStatusEl.classList.remove('is-visible');
}

// Remove .is-open before hiding so the overlay is invisible on the next show
// until accounts are loaded and the unified reveal animation fires.
function _closeOverlay() {
    overlayEl.classList.remove('is-open');
    api.hide();
}

// ── Carousel render ───────────────────────────────────────────────────────────

function _renderCarousel() {
    const items = _carouselItems;

    if (items.length === 0) {
        listEl.innerHTML = _emptyStateHtml(searchEl.value.trim());
        return;
    }

    if (_selIdx < 0 || _selIdx >= items.length) _selIdx = 0;

    listEl.innerHTML = items.map((item, i) => _accountCardHtml(item, i)).join('');

    // Suppress transitions on fresh render so items don't animate from origin.
    const els = Array.from(listEl.querySelectorAll('.qs-carousel-item'));
    els.forEach(el => (el.style.transition = 'none'));
    _updateCarouselPositions();
    requestAnimationFrame(() => {
        els.forEach(el => (el.style.transition = ''));
        // Restore focus to the selected card if keyboard focus was already in that zone.
        if (_focusZone === 'accounts') _focusSelectedCard();
    });
}

// ── Carousel position + ARIA update ──────────────────────────────────────────

function _updateCarouselPositions() {
    listEl.querySelectorAll('.qs-carousel-item').forEach(el => {
        const i      = Number(el.dataset.itemIdx);
        const offset = i - _selIdx;
        const absOff = Math.abs(offset);
        const step   = absOff < CAROUSEL_STEPS.length ? CAROUSEL_STEPS[absOff] : null;
        const isSel  = offset === 0;

        el.classList.toggle('is-selected', isSel);
        el.setAttribute('aria-selected', isSel ? 'true' : 'false');
        el.setAttribute('tabindex',      isSel ? '0'   : '-1');

        if (!step) {
            el.style.visibility    = 'hidden';
            el.style.pointerEvents = 'none';
            return;
        }

        const shiftX = offset >= 0 ? step.x : -step.x;
        el.style.visibility    = '';
        el.style.pointerEvents = '';
        el.style.setProperty('--shift-x', `${shiftX}px`);
        el.style.setProperty('--scale',   step.scale);
        el.style.setProperty('--opacity', step.opacity);
        el.style.setProperty('--z',       step.z);
    });
}

// ── Highlight selected (alias kept for API consistency) ───────────────────────

function _highlightSelected() {
    listEl.querySelectorAll('.qs-card').forEach(el => {
        const i = Number(el.dataset.itemIdx);
        el.classList.toggle('is-selected', i === _selIdx);
    });
    _updateCarouselPositions();
}

// ── Focus zone helpers ────────────────────────────────────────────────────────

function _focusSelectedCard() {
    const sel = listEl.querySelector('.qs-carousel-item[tabindex="0"]');
    if (sel) sel.focus();
}

function _setFocusZone(zone) {
    _focusZone = zone;
    if (zone === 'platforms') {
        if (!filtersEl) return;
        const chips = filtersEl.querySelectorAll('.qs-filter-chip');
        const safeIdx = Math.max(0, Math.min(_platformFocusIdx, chips.length - 1));
        if (chips[safeIdx]) chips[safeIdx].focus();
    } else {
        // accounts (default)
        _focusSelectedCard();
    }
}

function _getPlatformChipIndex(platform) {
    if (!filtersEl) return 0;
    const chips = Array.from(filtersEl.querySelectorAll('.qs-filter-chip'));
    const idx = chips.findIndex(c => c.dataset.platform === platform);
    return idx >= 0 ? idx : 0;
}

// Move keyboard focus to the adjacent platform chip, apply its filter immediately.
function _movePlatformFocus(delta) {
    if (!filtersEl) return;
    const chips = filtersEl.querySelectorAll('.qs-filter-chip');
    if (chips.length === 0) return;

    _platformFocusIdx = (_platformFocusIdx + delta + chips.length) % chips.length;
    const chip = chips[_platformFocusIdx];
    if (!chip) return;

    _platformFilter = chip.dataset.platform || 'all';
    _renderPlatformFilters();
    _carouselItems = _buildFlat(searchEl.value);
    _selIdx = 0;
    _renderCarousel();

    // Re-focus the chip after the DOM rebuild.
    const fresh = filtersEl.querySelectorAll('.qs-filter-chip');
    if (fresh[_platformFocusIdx]) fresh[_platformFocusIdx].focus();
}

// ── Navigation ────────────────────────────────────────────────────────────────

function _moveSelection(delta) {
    if (_isSwitching || _carouselItems.length === 0) return;
    _selIdx = (_selIdx + delta + _carouselItems.length) % _carouselItems.length;
    _highlightSelected();
}

// ── Switch account ────────────────────────────────────────────────────────────

async function _switchAccount(item) {
    if (_isSwitching) return;
    _isSwitching = true;
    errorEl.textContent = '';

    const idx = _carouselItems.indexOf(item);
    const el  = listEl.querySelector(`[data-item-idx="${idx}"]`);
    if (el) el.classList.add('is-switching');
    _showSwitchStatus(`Switching to ${item.accountName}…`);

    const t0     = Date.now();
    const result = await api.switchAccount({ platform: item.platform, accountId: item.accountId });

    if (result?.status === 'ok') {
        if (_closeAfterSwitch) {
            // Ensure feedback is visible for at least 350 ms before the window disappears.
            const elapsed = Date.now() - t0;
            if (elapsed < 350) await new Promise(r => setTimeout(r, 350 - elapsed));
            _closeOverlay();
        } else {
            _isSwitching = false;
            _hideSwitchStatus();
            await _loadAccounts();
        }
    } else {
        _isSwitching = false;
        if (el) el.classList.remove('is-switching');
        _hideSwitchStatus();
        errorEl.textContent = result?.message || 'Switch failed. Try again.';
    }
}

// ── Load & refresh ────────────────────────────────────────────────────────────

async function _loadAccounts() {
    listEl.innerHTML = `<div class="qs-loading"><div class="qs-spinner"></div><span>Loading accounts…</span></div>`;
    errorEl.textContent = '';
    _selIdx = 0;
    _isSwitching = false;
    _hideSwitchStatus();

    try {
        _groups = await api.listAccounts();
        if (!Array.isArray(_groups)) _groups = [];
    } catch {
        _groups = [];
        errorEl.textContent = 'Could not load accounts.';
    }

    _renderPlatformFilters();
    _carouselItems = _buildFlat(searchEl.value);
    _renderCarousel();
}

function _onSearchInput() {
    _carouselItems = _buildFlat(searchEl.value);
    _selIdx = 0;
    _renderCarousel();
}

// ── Keyboard handler ──────────────────────────────────────────────────────────

// Returns true for a single printable character with no modifier keys.
function _isPrintable(e) {
    return e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
}

function _onKeyDown(e) {
    if (e.key === 'Escape') {
        e.preventDefault();
        api.hide();
        overlayEl.classList.remove('is-open');
        return;
    }

    // Tab: let native browser focus handle it; focusin listeners update _focusZone.
    if (e.key === 'Tab') return;

    // Printable character while search input is not the active element:
    // route the keystroke into the search field and re-filter the carousel.
    if (_isPrintable(e) && document.activeElement !== searchEl) {
        e.preventDefault();
        searchEl.value += e.key;
        _onSearchInput();
        return;
    }

    // Backspace while search input is not active: delete the last search character.
    if (e.key === 'Backspace' && document.activeElement !== searchEl && searchEl.value.length > 0) {
        e.preventDefault();
        searchEl.value = searchEl.value.slice(0, -1);
        _onSearchInput();
        return;
    }

    const hasPlatforms = !!(filtersEl && filtersEl.children.length > 0);

    if (_focusZone === 'platforms') {
        switch (e.key) {
            case 'ArrowLeft':
                e.preventDefault();
                _movePlatformFocus(-1);
                break;
            case 'ArrowRight':
                e.preventDefault();
                _movePlatformFocus(1);
                break;
            case 'ArrowDown':
                e.preventDefault();
                if (_carouselItems.length > 0) _setFocusZone('accounts');
                break;
            case 'ArrowUp':
                // No zone above platforms — stay here.
                break;
            case 'Enter':
                e.preventDefault();
                // Filter already applied on ArrowLeft/Right; move into the carousel.
                if (_carouselItems.length > 0) _setFocusZone('accounts');
                break;
        }

    } else {
        // accounts zone (default)
        switch (e.key) {
            case 'ArrowLeft':
                // If the search input owns the cursor, let it handle the key.
                if (document.activeElement === searchEl) break;
                e.preventDefault();
                _moveSelection(-1);
                _focusSelectedCard();
                break;
            case 'ArrowRight':
                if (document.activeElement === searchEl) break;
                e.preventDefault();
                _moveSelection(1);
                _focusSelectedCard();
                break;
            case 'ArrowUp':
                if (hasPlatforms) {
                    e.preventDefault();
                    _platformFocusIdx = _getPlatformChipIndex(_platformFilter);
                    _setFocusZone('platforms');
                }
                // No platform filters — stay in accounts, do not go to search.
                break;
            case 'ArrowDown':
                // Already at the bottom — no action.
                break;
            case 'Enter':
                e.preventDefault();
                if (!_isSwitching && _carouselItems[_selIdx]) {
                    _switchAccount(_carouselItems[_selIdx]);
                }
                break;
        }
    }
}

// ── Init ──────────────────────────────────────────────────────────────────────

function _init() {
    document.addEventListener('keydown', _onKeyDown);
    closeBtn?.addEventListener('click', () => _closeOverlay());
    searchEl?.addEventListener('input', _onSearchInput);

    filtersEl?.addEventListener('focusin', e => {
        const chip = e.target.closest('.qs-filter-chip');
        if (!chip) return;
        _focusZone = 'platforms';
        const chips = Array.from(filtersEl.querySelectorAll('.qs-filter-chip'));
        const idx = chips.indexOf(chip);
        if (idx >= 0) _platformFocusIdx = idx;
    });

    listEl.addEventListener('focusin', e => {
        if (e.target.closest('.qs-carousel-item')) _focusZone = 'accounts';
    });

    document.getElementById('qsNavLeft')?.addEventListener('click',  () => _moveSelection(-1));
    document.getElementById('qsNavRight')?.addEventListener('click', () => _moveSelection(1));

    filtersEl?.addEventListener('click', e => {
        const chip = e.target.closest('.qs-filter-chip');
        if (!chip) return;
        const chips = Array.from(filtersEl.querySelectorAll('.qs-filter-chip'));
        _platformFocusIdx = Math.max(0, chips.indexOf(chip));
        _platformFilter = chip.dataset.platform || 'all';
        _renderPlatformFilters();
        _carouselItems = _buildFlat(searchEl.value);
        _selIdx = 0;
        _renderCarousel();
    });

    listEl.addEventListener('click', e => {
        const card = e.target.closest('.qs-carousel-item');
        if (!card) return;
        const idx = Number(card.dataset.itemIdx);
        if (idx === _selIdx) {
            if (_carouselItems[idx]) _switchAccount(_carouselItems[idx]);
        } else if (_carouselItems[idx]) {
            _selIdx = idx;
            _highlightSelected();
        }
    });

    api.onShow(async (payload) => {
        const { closeAfterSwitch, showSeq } = payload || {};

        // Remove any stale closing state and make overlay visible immediately.
        // Do not wait for account loading — the window is already shown by main.
        overlayEl.classList.remove('is-closing');
        overlayEl.classList.add('is-open');

        _closeAfterSwitch  = closeAfterSwitch !== false;
        _platformFilter    = 'all';
        _platformFocusIdx  = 0;
        _focusZone         = 'accounts';
        _isSwitching       = false;
        _hideSwitchStatus();
        searchEl.value = '';

        // Signal main immediately after is-open — do not block on rAF or account loading.
        // Hidden BrowserWindow may not fire requestAnimationFrame reliably after first hide.
        try { api.visibleReady({ showSeq }); } catch (err) {
            console.warn('[QS Renderer] visibleReady failed', err);
        }

        // Load accounts after signaling ready — spinner is visible while loading.
        await _loadAccounts();
        _setFocusZone('accounts');
    });

    api.onHide(() => {
        overlayEl.classList.remove('is-open');
        overlayEl.classList.remove('is-closing');
    });

    // Signal main process: IPC listeners are registered, safe to send qs:show.
    try { api.rendererReady(); } catch (_) {}
}

_init();
