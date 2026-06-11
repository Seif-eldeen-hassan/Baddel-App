'use strict';

const fs   = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const ROOT             = path.join(__dirname, '..');
const APP_JS           = fs.readFileSync(path.join(ROOT, 'src/js/app.js'), 'utf8');
const TOAST_CONFIRM_JS = fs.readFileSync(path.join(ROOT, 'src/js/app/toast-confirm.js'), 'utf8');
const COLLECTIONS_JS   = fs.readFileSync(path.join(ROOT, 'src/js/app/collections.js'), 'utf8');
const HTML             = fs.readFileSync(path.join(ROOT, 'src/dashboard.html'), 'utf8');

// ── Extraction helper ─────────────────────────────────────────────────────────

function getFunctionBody(source, functionName) {
    const marker = 'function ' + functionName;
    const start = source.indexOf(marker);
    if (start === -1) return '';
    const braceOpen = source.indexOf('{', start);
    if (braceOpen === -1) return '';
    let depth = 0;
    for (let i = braceOpen; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}') {
            depth--;
            if (depth === 0) return source.slice(start, i + 1);
        }
    }
    return source.slice(start);
}

// ── Section 1: Source presence in toast-confirm.js ───────────────────────────

describe('Phase 2.15B: toast/confirm — source presence in toast-confirm.js', () => {
    it('showToast is defined', () => {
        assert.match(TOAST_CONFIRM_JS, /function showToast\s*\(/);
    });
    it('openConfirmModal is defined', () => {
        assert.match(TOAST_CONFIRM_JS, /function openConfirmModal\s*\(/);
    });
    it('closeConfirmModal is defined', () => {
        assert.match(TOAST_CONFIRM_JS, /function closeConfirmModal\s*\(\s*\)/);
    });
    it('executeConfirm is defined as an async function', () => {
        assert.match(TOAST_CONFIRM_JS, /async function executeConfirm\s*\(\s*\)/);
    });
    it('pendingConfirmAction state variable is declared', () => {
        assert.match(TOAST_CONFIRM_JS, /^let pendingConfirmAction\s*=\s*null/m);
    });
});

// ── Section 2: showToast behaviour ───────────────────────────────────────────

describe('Phase 2.15B: toast/confirm — showToast behaviour', () => {
    it('showToast accepts a plain string message as first argument', () => {
        const fn = getFunctionBody(TOAST_CONFIRM_JS, 'showToast');
        assert.match(fn, /message\s*=\s*msgOrOpts/);
    });
    it('showToast accepts an object with message/title/type/duration fields', () => {
        const fn = getFunctionBody(TOAST_CONFIRM_JS, 'showToast');
        assert.match(fn, /typeof msgOrOpts\s*===\s*'object'/);
        assert.match(fn, /msgOrOpts\.message/);
        assert.match(fn, /msgOrOpts\.type/);
        assert.match(fn, /msgOrOpts\.duration/);
    });
    it('showToast reads toast-wrapper by ID to append the notification', () => {
        const fn = getFunctionBody(TOAST_CONFIRM_JS, 'showToast');
        assert.match(fn, /getElementById\('toast-wrapper'\)/);
    });
    it('showToast creates a div with class toast-notification', () => {
        const fn = getFunctionBody(TOAST_CONFIRM_JS, 'showToast');
        assert.match(fn, /toast-notification/);
        assert.match(fn, /document\.createElement\('div'\)/);
    });
    it('showToast adds toast-error class when type is "error"', () => {
        const fn = getFunctionBody(TOAST_CONFIRM_JS, 'showToast');
        assert.match(fn, /toast-error/);
        assert.match(fn, /type\s*===\s*'error'/);
    });
    it('showToast wraps message text in a <span>', () => {
        const fn = getFunctionBody(TOAST_CONFIRM_JS, 'showToast');
        assert.match(fn, /<span>/);
    });
    it('showToast appends the notification div to the wrapper', () => {
        const fn = getFunctionBody(TOAST_CONFIRM_JS, 'showToast');
        assert.match(fn, /w\.appendChild\(d\)/);
    });
    it('showToast auto-removes the notification after a timeout', () => {
        const fn = getFunctionBody(TOAST_CONFIRM_JS, 'showToast');
        assert.match(fn, /setTimeout/);
        assert.match(fn, /d\.remove\(\)/);
    });
    it('showToast applies a fadeOutUp animation before removal', () => {
        const fn = getFunctionBody(TOAST_CONFIRM_JS, 'showToast');
        assert.match(fn, /fadeOutUp/);
    });
    it('showToast default duration is 3500 ms', () => {
        const fn = getFunctionBody(TOAST_CONFIRM_JS, 'showToast');
        assert.match(fn, /3500/);
    });
    it('showToast falls back to title field when message field is absent in object input', () => {
        const fn = getFunctionBody(TOAST_CONFIRM_JS, 'showToast');
        assert.match(fn, /msgOrOpts\.message\s*\|\|\s*msgOrOpts\.title/);
    });
    it('showToast does not call escapeHtml on the message (raw HTML allowed)', () => {
        const fn = getFunctionBody(TOAST_CONFIRM_JS, 'showToast');
        assert.doesNotMatch(fn, /escapeHtml/);
    });
});

// ── Section 3: openConfirmModal behaviour ────────────────────────────────────

describe('Phase 2.15B: toast/confirm — openConfirmModal behaviour', () => {
    it('openConfirmModal accepts title, message, buttonText, callback parameters', () => {
        const fn = getFunctionBody(TOAST_CONFIRM_JS, 'openConfirmModal');
        assert.match(fn, /title/);
        assert.match(fn, /message/);
        assert.match(fn, /buttonText/);
        assert.match(fn, /callback/);
    });
    it('openConfirmModal sets confirmTitle innerHTML with escaped title and warning icon', () => {
        const fn = getFunctionBody(TOAST_CONFIRM_JS, 'openConfirmModal');
        assert.match(fn, /getElementById\('confirmTitle'\)/);
        assert.match(fn, /innerHTML/);
        assert.match(fn, /escapeHtml\(title\)/);
        assert.match(fn, /&#9888;/);
    });
    it('openConfirmModal sets confirmMessage innerText', () => {
        const fn = getFunctionBody(TOAST_CONFIRM_JS, 'openConfirmModal');
        assert.match(fn, /getElementById\('confirmMessage'\)/);
        assert.match(fn, /innerText\s*=\s*message/);
    });
    it('openConfirmModal sets confirmBtn innerText to buttonText', () => {
        const fn = getFunctionBody(TOAST_CONFIRM_JS, 'openConfirmModal');
        assert.match(fn, /getElementById\('confirmBtn'\)/);
        assert.match(fn, /innerText\s*=\s*buttonText/);
    });
    it('openConfirmModal stores the callback in pendingConfirmAction', () => {
        const fn = getFunctionBody(TOAST_CONFIRM_JS, 'openConfirmModal');
        assert.match(fn, /pendingConfirmAction\s*=\s*callback/);
    });
    it('openConfirmModal activates confirmModal by adding .active class', () => {
        const fn = getFunctionBody(TOAST_CONFIRM_JS, 'openConfirmModal');
        assert.match(fn, /getElementById\('confirmModal'\)/);
        assert.match(fn, /classList\.add\('active'\)/);
    });
});

// ── Section 4: closeConfirmModal behaviour ───────────────────────────────────

describe('Phase 2.15B: toast/confirm — closeConfirmModal behaviour', () => {
    it('closeConfirmModal removes .active from confirmModal', () => {
        const fn = getFunctionBody(TOAST_CONFIRM_JS, 'closeConfirmModal');
        assert.match(fn, /getElementById\('confirmModal'\)/);
        assert.match(fn, /classList\.remove\('active'\)/);
    });
    it('closeConfirmModal resets pendingConfirmAction to null', () => {
        const fn = getFunctionBody(TOAST_CONFIRM_JS, 'closeConfirmModal');
        assert.match(fn, /pendingConfirmAction\s*=\s*null/);
    });
});

// ── Section 5: executeConfirm behaviour ──────────────────────────────────────

describe('Phase 2.15B: toast/confirm — executeConfirm behaviour', () => {
    it('executeConfirm invokes pendingConfirmAction when set', () => {
        const fn = getFunctionBody(TOAST_CONFIRM_JS, 'executeConfirm');
        assert.match(fn, /pendingConfirmAction\s*\(\s*\)/);
    });
    it('executeConfirm awaits the callback (async operation)', () => {
        const fn = getFunctionBody(TOAST_CONFIRM_JS, 'executeConfirm');
        assert.match(fn, /await pendingConfirmAction/);
    });
    it('executeConfirm sets confirmBtn text to "Processing..." while running', () => {
        const fn = getFunctionBody(TOAST_CONFIRM_JS, 'executeConfirm');
        assert.match(fn, /Processing\.\.\./);
    });
    it('executeConfirm disables confirmBtn during callback execution', () => {
        const fn = getFunctionBody(TOAST_CONFIRM_JS, 'executeConfirm');
        assert.match(fn, /btn\.disabled\s*=\s*true/);
    });
    it('executeConfirm restores confirmBtn text after callback completes', () => {
        const fn = getFunctionBody(TOAST_CONFIRM_JS, 'executeConfirm');
        assert.match(fn, /btn\.innerText\s*=\s*originalText/);
    });
    it('executeConfirm re-enables confirmBtn after callback completes', () => {
        const fn = getFunctionBody(TOAST_CONFIRM_JS, 'executeConfirm');
        assert.match(fn, /btn\.disabled\s*=\s*false/);
    });
    it('executeConfirm always calls closeConfirmModal regardless of callback result', () => {
        const fn = getFunctionBody(TOAST_CONFIRM_JS, 'executeConfirm');
        assert.match(fn, /closeConfirmModal\(\)/);
    });
    it('executeConfirm reads confirmBtn by ID for progress state', () => {
        const fn = getFunctionBody(TOAST_CONFIRM_JS, 'executeConfirm');
        assert.match(fn, /getElementById\('confirmBtn'\)/);
    });
    it('pendingConfirmAction is initialized to null', () => {
        assert.match(TOAST_CONFIRM_JS, /^let pendingConfirmAction\s*=\s*null\s*;/m);
    });
});

// ── Section 6: DOM IDs in dashboard.html ─────────────────────────────────────

describe('Phase 2.15B: toast/confirm — DOM IDs in dashboard.html', () => {
    it('toast-wrapper element exists', () => {
        assert.match(HTML, /id="toast-wrapper"/);
    });
    it('confirmModal element exists', () => {
        assert.match(HTML, /id="confirmModal"/);
    });
    it('confirmTitle element exists', () => {
        assert.match(HTML, /id="confirmTitle"/);
    });
    it('confirmMessage element exists', () => {
        assert.match(HTML, /id="confirmMessage"/);
    });
    it('confirmBtn element exists', () => {
        assert.match(HTML, /id="confirmBtn"/);
    });
    it('confirmModal has modal-overlay class', () => {
        assert.match(HTML, /id="confirmModal"[^>]*class="modal-overlay"|class="modal-overlay"[^>]*id="confirmModal"/);
    });
    it('confirmModal cancel button calls closeConfirmModal via inline onclick', () => {
        assert.match(HTML, /onclick="closeConfirmModal\(\)"/);
    });
    it('confirmBtn calls executeConfirm via inline onclick', () => {
        assert.match(HTML, /id="confirmBtn"[^>]*onclick="executeConfirm\(\)"|onclick="executeConfirm\(\)"[^>]*id="confirmBtn"/);
    });
    it('toast-wrapper is an empty container div (notifications created dynamically)', () => {
        assert.match(HTML, /id="toast-wrapper"\s*><\/div>|id="toast-wrapper"><\/div>/);
    });
});

// ── Section 7: Intentional dependencies ──────────────────────────────────────

describe('Phase 2.15B: toast/confirm — intentional dependencies', () => {
    it('openConfirmModal depends on escapeHtml (from domUtils.js)', () => {
        const fn = getFunctionBody(TOAST_CONFIRM_JS, 'openConfirmModal');
        assert.match(fn, /\bescapeHtml\b/);
    });
    it('escapeHtml is defined in domUtils.js', () => {
        const DOMUTILS_JS = fs.readFileSync(path.join(ROOT, 'src/js/domUtils.js'), 'utf8');
        assert.match(DOMUTILS_JS, /function escapeHtml\s*\(|escapeHtml\s*=/);
    });
    it('executeConfirm calls closeConfirmModal (internal dependency)', () => {
        const fn = getFunctionBody(TOAST_CONFIRM_JS, 'executeConfirm');
        assert.match(fn, /\bcloseConfirmModal\b/);
    });
    it('launcher-actions.js calls showToast (cross-module dependency)', () => {
        const LAUNCHER_ACTIONS_JS = fs.readFileSync(path.join(ROOT, 'src/js/app/launcher-actions.js'), 'utf8');
        assert.match(LAUNCHER_ACTIONS_JS, /\bshowToast\b/);
    });
    it('accounts/platform-panels.js calls showToast (cross-module dependency)', () => {
        const PLATFORM_PANELS_JS = fs.readFileSync(path.join(ROOT, 'src/js/accounts/platform-panels.js'), 'utf8');
        assert.match(PLATFORM_PANELS_JS, /\bshowToast\b/);
    });
    it('accounts.js calls showToast (cross-module dependency)', () => {
        const ACCOUNTS_JS = fs.readFileSync(path.join(ROOT, 'src/js/accounts.js'), 'utf8');
        assert.match(ACCOUNTS_JS, /\bshowToast\b/);
    });
    it('game-details.js calls showToast (cross-module dependency)', () => {
        const GD_JS = fs.readFileSync(path.join(ROOT, 'src/js/game-details.js'), 'utf8');
        assert.match(GD_JS, /\bshowToast\b/);
    });
    it('addGameModal.js calls showToast (cross-module dependency)', () => {
        const AGM_JS = fs.readFileSync(path.join(ROOT, 'src/js/addGameModal.js'), 'utf8');
        assert.match(AGM_JS, /\bshowToast\b/);
    });
    it('openConfirmModal is called by triggerRemove for recycle-bin confirmation', () => {
        const fn = getFunctionBody(APP_JS, 'triggerRemove');
        assert.match(fn, /openConfirmModal\s*\(/);
    });
    it('openConfirmModal is called by deleteColl for collection delete confirmation', () => {
        const fn = getFunctionBody(COLLECTIONS_JS, 'deleteColl');
        assert.match(fn, /openConfirmModal\s*\(/);
    });
    it('openConfirmModal is called by hardDeleteGame for permanent-delete confirmation', () => {
        const fn = getFunctionBody(APP_JS, 'hardDeleteGame');
        assert.match(fn, /openConfirmModal\s*\(/);
    });
    it('openConfirmModal is called by triggerDeleteCollection for collection-settings delete', () => {
        const fn = getFunctionBody(COLLECTIONS_JS, 'triggerDeleteCollection');
        assert.match(fn, /openConfirmModal\s*\(/);
    });
});

// ── Section 8: Dependency isolation ──────────────────────────────────────────

describe('Phase 2.15B: toast/confirm — dependency isolation', () => {
    it('showToast does not reference currentAccountPlatform', () => {
        const fn = getFunctionBody(TOAST_CONFIRM_JS, 'showToast');
        assert.doesNotMatch(fn, /\bcurrentAccountPlatform\b/);
    });
    it('showToast does not reference activePlatformView', () => {
        const fn = getFunctionBody(TOAST_CONFIRM_JS, 'showToast');
        assert.doesNotMatch(fn, /\bactivePlatformView\b/);
    });
    it('showToast does not reference openPlatformsModal', () => {
        const fn = getFunctionBody(TOAST_CONFIRM_JS, 'showToast');
        assert.doesNotMatch(fn, /\bopenPlatformsModal\b/);
    });
    it('showToast does not reference renderPlatformAccounts', () => {
        const fn = getFunctionBody(TOAST_CONFIRM_JS, 'showToast');
        assert.doesNotMatch(fn, /\brenderPlatformAccounts\b/);
    });
    it('showToast does not reference AG_DISPLAY_DEFAULTS', () => {
        const fn = getFunctionBody(TOAST_CONFIRM_JS, 'showToast');
        assert.doesNotMatch(fn, /\bAG_DISPLAY_DEFAULTS\b/);
    });
    it('showToast does not reference IG_DISPLAY_DEFAULTS', () => {
        const fn = getFunctionBody(TOAST_CONFIRM_JS, 'showToast');
        assert.doesNotMatch(fn, /\bIG_DISPLAY_DEFAULTS\b/);
    });
    it('showToast does not reference window._agDisplayPrefs', () => {
        const fn = getFunctionBody(TOAST_CONFIRM_JS, 'showToast');
        assert.doesNotMatch(fn, /window\._agDisplayPrefs/);
    });
    it('showToast does not reference window._igDisplayPrefs', () => {
        const fn = getFunctionBody(TOAST_CONFIRM_JS, 'showToast');
        assert.doesNotMatch(fn, /window\._igDisplayPrefs/);
    });
    it('openConfirmModal does not reference currentAccountPlatform', () => {
        const fn = getFunctionBody(TOAST_CONFIRM_JS, 'openConfirmModal');
        assert.doesNotMatch(fn, /\bcurrentAccountPlatform\b/);
    });
    it('openConfirmModal does not reference AG_DISPLAY_DEFAULTS', () => {
        const fn = getFunctionBody(TOAST_CONFIRM_JS, 'openConfirmModal');
        assert.doesNotMatch(fn, /\bAG_DISPLAY_DEFAULTS\b/);
    });
    it('executeConfirm does not reference currentAccountPlatform', () => {
        const fn = getFunctionBody(TOAST_CONFIRM_JS, 'executeConfirm');
        assert.doesNotMatch(fn, /\bcurrentAccountPlatform\b/);
    });
    it('executeConfirm does not reference selectedGameId (not coupled to a specific game)', () => {
        const fn = getFunctionBody(TOAST_CONFIRM_JS, 'executeConfirm');
        assert.doesNotMatch(fn, /\bselectedGameId\b/);
    });
    it('closeConfirmModal does not reference selectedGameId', () => {
        const fn = getFunctionBody(TOAST_CONFIRM_JS, 'closeConfirmModal');
        assert.doesNotMatch(fn, /\bselectedGameId\b/);
    });
});

// ── Section 9: app.js does NOT redeclare moved identifiers ───────────────────

describe('Phase 2.15B: toast/confirm — app.js does NOT redeclare moved identifiers', () => {
    it('app.js does NOT define showToast (moved to toast-confirm.js)', () => {
        assert.doesNotMatch(APP_JS, /function showToast\s*\(/);
    });
    it('app.js does NOT define openConfirmModal (moved to toast-confirm.js)', () => {
        assert.doesNotMatch(APP_JS, /function openConfirmModal\s*\(/);
    });
    it('app.js does NOT define closeConfirmModal (moved to toast-confirm.js)', () => {
        assert.doesNotMatch(APP_JS, /function closeConfirmModal\s*\(\s*\)/);
    });
    it('app.js does NOT define executeConfirm (moved to toast-confirm.js)', () => {
        assert.doesNotMatch(APP_JS, /async function executeConfirm\s*\(\s*\)/);
    });
    it('app.js does NOT declare pendingConfirmAction (moved to toast-confirm.js)', () => {
        assert.doesNotMatch(APP_JS, /^let pendingConfirmAction\s*=/m);
    });
});

// ── Section 10: Window exports in toast-confirm.js ───────────────────────────

describe('Phase 2.15B: toast/confirm — window exports', () => {
    it('window.showToast is exported', () => {
        assert.match(TOAST_CONFIRM_JS, /window\.showToast\s*=/);
    });
    it('window.openConfirmModal is exported', () => {
        assert.match(TOAST_CONFIRM_JS, /window\.openConfirmModal\s*=/);
    });
    it('window.closeConfirmModal is exported', () => {
        assert.match(TOAST_CONFIRM_JS, /window\.closeConfirmModal\s*=/);
    });
    it('window.executeConfirm is exported', () => {
        assert.match(TOAST_CONFIRM_JS, /window\.executeConfirm\s*=/);
    });
});

// ── Section 11: Script load order in dashboard.html ──────────────────────────

describe('Phase 2.15B: toast/confirm — script load order in dashboard.html', () => {
    it('toast-confirm.js is present in dashboard.html', () => {
        assert.match(HTML, /js\/app\/toast-confirm\.js/);
    });
    it('toast-confirm.js loads before launcher-actions.js', () => {
        const toastIdx    = HTML.indexOf('js/app/toast-confirm.js');
        const launcherIdx = HTML.indexOf('js/app/launcher-actions.js');
        assert.ok(toastIdx > -1, 'toast-confirm.js must be in dashboard.html');
        assert.ok(toastIdx < launcherIdx, 'toast-confirm.js must load before launcher-actions.js');
    });
    it('toast-confirm.js loads before app.js', () => {
        const toastIdx = HTML.indexOf('js/app/toast-confirm.js');
        const appIdx   = HTML.indexOf('js/app.js');
        assert.ok(toastIdx < appIdx, 'toast-confirm.js must load before app.js');
    });
    it('toast-confirm.js loads before accounts/platform-panels.js', () => {
        const toastIdx   = HTML.indexOf('js/app/toast-confirm.js');
        const panelsIdx  = HTML.indexOf('js/accounts/platform-panels.js');
        assert.ok(toastIdx < panelsIdx, 'toast-confirm.js must load before platform-panels.js');
    });
    it('artwork-sync.js loads before toast-confirm.js', () => {
        const artworkIdx = HTML.indexOf('js/app/artwork-sync.js');
        const toastIdx   = HTML.indexOf('js/app/toast-confirm.js');
        assert.ok(artworkIdx < toastIdx, 'artwork-sync.js must load before toast-confirm.js');
    });
});

// ── Section 12: Comment hygiene in toast-confirm.js ──────────────────────────

describe('Phase 2.15B: toast/confirm — comment hygiene', () => {
    it('toast-confirm.js contains no Arabic-script characters', () => {
        assert.doesNotMatch(TOAST_CONFIRM_JS, /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/,
            'toast-confirm.js must not contain Arabic-script characters');
    });
});
