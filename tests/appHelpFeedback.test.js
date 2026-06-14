'use strict';
const test    = require('node:test');
const assert  = require('node:assert/strict');
const fs      = require('node:fs');
const path    = require('node:path');

const ROOT           = path.resolve(__dirname, '..');
const APP_JS         = fs.readFileSync(path.join(ROOT, 'src/js/app.js'),                              'utf8');
const HELP_JS        = fs.readFileSync(path.join(ROOT, 'src/js/app/help-feedback.js'),                'utf8');
const SETTINGS_QS_JS = fs.readFileSync(path.join(ROOT, 'src/js/app/settings-quick-switcher.js'),     'utf8');
const HTML           = fs.readFileSync(path.join(ROOT, 'src/dashboard.html'),                         'utf8');

// ─── helper: extract first function body by name ──────────────────────────────
function extractFnSource(src, name) {
    const start = src.indexOf(`function ${name}`);
    if (start === -1) return null;
    let depth = 0, i = start;
    while (i < src.length) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) break; }
        i++;
    }
    return src.slice(start, i + 1);
}

// ─── 1. Source-presence: implementations live in help-feedback.js ─────────────

test('help-feedback.js: defines function openHelpModal', () => {
    assert.match(HELP_JS, /function openHelpModal\s*\(/);
});

test('help-feedback.js: defines function closeHelpModal', () => {
    assert.match(HELP_JS, /function closeHelpModal\s*\(/);
});

test('help-feedback.js: defines function toggleHelpDropdown', () => {
    assert.match(HELP_JS, /function toggleHelpDropdown\s*\(/);
});

test('help-feedback.js: defines function closeHelpDropdown', () => {
    assert.match(HELP_JS, /function closeHelpDropdown\s*\(/);
});

test('help-feedback.js: defines function _positionHelpDropdown', () => {
    assert.match(HELP_JS, /function _positionHelpDropdown\s*\(/);
});

test('help-feedback.js: defines function handleHelpDropdownAction', () => {
    assert.match(HELP_JS, /function handleHelpDropdownAction\s*\(/);
});

test('help-feedback.js: defines function switchHelpTab', () => {
    assert.match(HELP_JS, /function switchHelpTab\s*\(/);
});

test('help-feedback.js: defines async function sendFeedback', () => {
    assert.match(HELP_JS, /async function sendFeedback\s*\(/);
});

test('help-feedback.js: defines constant BETA_FEEDBACK_BANNER_KEY', () => {
    assert.match(HELP_JS, /const BETA_FEEDBACK_BANNER_KEY\s*=/);
});

test('help-feedback.js: defines function shouldShowBetaFeedbackBanner', () => {
    assert.match(HELP_JS, /function shouldShowBetaFeedbackBanner\s*\(/);
});

test('help-feedback.js: defines function markBetaFeedbackBannerDismissed', () => {
    assert.match(HELP_JS, /function markBetaFeedbackBannerDismissed\s*\(/);
});

test('help-feedback.js: defines function showBetaFeedbackBanner', () => {
    assert.match(HELP_JS, /function showBetaFeedbackBanner\s*\(/);
});

test('help-feedback.js: defines function hideBetaFeedbackBanner', () => {
    assert.match(HELP_JS, /function hideBetaFeedbackBanner\s*\(/);
});

test('help-feedback.js: defines function dismissBetaFeedbackBanner', () => {
    assert.match(HELP_JS, /function dismissBetaFeedbackBanner\s*\(/);
});

test('help-feedback.js: defines function openBetaFeedbackFromBanner', () => {
    assert.match(HELP_JS, /function openBetaFeedbackFromBanner\s*\(/);
});

test('help-feedback.js: defines function openUpdateModal', () => {
    assert.match(HELP_JS, /function openUpdateModal\s*\(/);
});

test('help-feedback.js: defines function closeUpdateModal', () => {
    assert.match(HELP_JS, /function closeUpdateModal\s*\(/);
});

test('help-feedback.js: defines function installUpdate', () => {
    assert.match(HELP_JS, /function installUpdate\s*\(/);
});

test('help-feedback.js: defines async function startUpdateDownload', () => {
    assert.match(HELP_JS, /async function startUpdateDownload\s*\(/);
});

test('help-feedback.js: defines async function settingsCheckForUpdate', () => {
    assert.match(HELP_JS, /async function settingsCheckForUpdate\s*\(/);
});

test('help-feedback.js: defines async function closeUpdateNotesModal', () => {
    assert.match(HELP_JS, /async function closeUpdateNotesModal\s*\(/);
});

test('help-feedback.js: defines function showUpdateNotesModal', () => {
    assert.match(HELP_JS, /function showUpdateNotesModal\s*\(/);
});

test('help-feedback.js: defines async function checkAndShowUpdateNotes', () => {
    assert.match(HELP_JS, /async function checkAndShowUpdateNotes\s*\(/);
});

test('help-feedback.js: defines function openCommunityModal', () => {
    assert.match(HELP_JS, /function openCommunityModal\s*\(/);
});

test('help-feedback.js: defines function closeCommunityModal', () => {
    assert.match(HELP_JS, /function closeCommunityModal\s*\(/);
});

test('help-feedback.js: defines async function openCommunityLink', () => {
    assert.match(HELP_JS, /async function openCommunityLink\s*\(/);
});

test('help-feedback.js: defines _updateState object with status field', () => {
    assert.match(HELP_JS, /const _updateState\s*=/);
    assert.match(HELP_JS, /status:\s*'idle'/);
});

test('help-feedback.js: defines _pendingUpdateNotesVersion', () => {
    assert.match(HELP_JS, /let _pendingUpdateNotesVersion\s*=\s*null/);
});

// ─── 2. window exports in help-feedback.js ───────────────────────────────────

test('help-feedback.js: exports window.handleHelpDropdownAction', () => {
    assert.match(HELP_JS, /window\.handleHelpDropdownAction\s*=\s*handleHelpDropdownAction/);
});

test('help-feedback.js: exports window.dismissBetaFeedbackBanner', () => {
    assert.match(HELP_JS, /window\.dismissBetaFeedbackBanner\s*=\s*dismissBetaFeedbackBanner/);
});

test('help-feedback.js: exports window.openBetaFeedbackFromBanner', () => {
    assert.match(HELP_JS, /window\.openBetaFeedbackFromBanner\s*=\s*openBetaFeedbackFromBanner/);
});

test('help-feedback.js: exports window.closeUpdateNotesModal', () => {
    assert.match(HELP_JS, /window\.closeUpdateNotesModal\s*=\s*closeUpdateNotesModal/);
});

test('help-feedback.js: exposes window._updateState for app.js openSettingsModal', () => {
    assert.match(HELP_JS, /window\._updateState\s*=\s*_updateState/);
});

test('help-feedback.js: exposes window._setSettingsUpdateRow for app.js openSettingsModal', () => {
    assert.match(HELP_JS, /window\._setSettingsUpdateRow\s*=\s*_setSettingsUpdateRow/);
});

test('help-feedback.js: exports window.toggleHelpDropdown', () => {
    assert.match(HELP_JS, /window\.toggleHelpDropdown\s*=\s*toggleHelpDropdown/);
});

test('help-feedback.js: exports window.openHelpModal', () => {
    assert.match(HELP_JS, /window\.openHelpModal\s*=\s*openHelpModal/);
});

test('help-feedback.js: exports window.closeHelpModal', () => {
    assert.match(HELP_JS, /window\.closeHelpModal\s*=\s*closeHelpModal/);
});

test('help-feedback.js: exports window.closeHelpDropdown', () => {
    assert.match(HELP_JS, /window\.closeHelpDropdown\s*=\s*closeHelpDropdown/);
});

test('help-feedback.js: exports window.switchHelpTab', () => {
    assert.match(HELP_JS, /window\.switchHelpTab\s*=\s*switchHelpTab/);
});

test('help-feedback.js: exports window.sendFeedback', () => {
    assert.match(HELP_JS, /window\.sendFeedback\s*=\s*sendFeedback/);
});

test('help-feedback.js: exports window.openUpdateModal', () => {
    assert.match(HELP_JS, /window\.openUpdateModal\s*=\s*openUpdateModal/);
});

test('help-feedback.js: exports window.closeUpdateModal', () => {
    assert.match(HELP_JS, /window\.closeUpdateModal\s*=\s*closeUpdateModal/);
});

test('help-feedback.js: exports window.startUpdateDownload', () => {
    assert.match(HELP_JS, /window\.startUpdateDownload\s*=\s*startUpdateDownload/);
});

test('help-feedback.js: exports window.installUpdate', () => {
    assert.match(HELP_JS, /window\.installUpdate\s*=\s*installUpdate/);
});

test('help-feedback.js: exports window.settingsCheckForUpdate', () => {
    assert.match(HELP_JS, /window\.settingsCheckForUpdate\s*=\s*settingsCheckForUpdate/);
});

test('help-feedback.js: exports window.openCommunityModal', () => {
    assert.match(HELP_JS, /window\.openCommunityModal\s*=\s*openCommunityModal/);
});

test('help-feedback.js: exports window.closeCommunityModal', () => {
    assert.match(HELP_JS, /window\.closeCommunityModal\s*=\s*closeCommunityModal/);
});

test('help-feedback.js: exports window.openCommunityLink', () => {
    assert.match(HELP_JS, /window\.openCommunityLink\s*=\s*openCommunityLink/);
});

// ─── 3. app.js carries only aliases, not full implementations ────────────────

test('app.js: does NOT contain full openHelpModal implementation', () => {
    assert.doesNotMatch(APP_JS, /function openHelpModal\s*\(/);
});

test('app.js: does NOT contain full closeHelpModal implementation', () => {
    assert.doesNotMatch(APP_JS, /function closeHelpModal\s*\(/);
});

test('app.js: does NOT contain sendFeedback', () => {
    assert.doesNotMatch(APP_JS, /function sendFeedback\s*\(/);
});

test('app.js: does NOT contain BETA_FEEDBACK_BANNER_KEY', () => {
    assert.doesNotMatch(APP_JS, /BETA_FEEDBACK_BANNER_KEY/);
});

test('app.js: does NOT contain openUpdateModal full body', () => {
    assert.doesNotMatch(APP_JS, /function openUpdateModal\s*\(/);
});

test('app.js: does NOT contain installUpdate full body', () => {
    assert.doesNotMatch(APP_JS, /function installUpdate\s*\(/);
});

test('app.js: does NOT contain openCommunityLink', () => {
    assert.doesNotMatch(APP_JS, /function openCommunityLink\s*\(/);
});

test('app.js: does NOT contain _pendingUpdateNotesVersion declaration', () => {
    assert.doesNotMatch(APP_JS, /let _pendingUpdateNotesVersion/);
});

test('app.js: does NOT contain checkAndShowUpdateNotes DOMContentLoaded listener', () => {
    assert.doesNotMatch(APP_JS, /setTimeout\(checkAndShowUpdateNotes/);
});

test('app.js: does NOT redeclare const _updateState at top level (prevents duplicate-binding black screen)', () => {
    assert.doesNotMatch(APP_JS, /^const _updateState\s*=/m);
});

test('app.js: does NOT redeclare const _setSettingsUpdateRow at top level (prevents duplicate-binding black screen)', () => {
    assert.doesNotMatch(APP_JS, /^const _setSettingsUpdateRow\s*=/m);
});

test('settings-quick-switcher.js: openSettingsModal reads window._updateState at call time', () => {
    const idx = SETTINGS_QS_JS.indexOf('async function openSettingsModal');
    const fn = SETTINGS_QS_JS.slice(idx, idx + 2500);
    assert.match(fn, /window\._updateState/, 'openSettingsModal must read window._updateState');
});

test('settings-quick-switcher.js: openSettingsModal calls window._setSettingsUpdateRow or local safe reference', () => {
    const idx = SETTINGS_QS_JS.indexOf('async function openSettingsModal');
    const fn = SETTINGS_QS_JS.slice(idx, idx + 2500);
    assert.match(fn, /window\._setSettingsUpdateRow|setSettingsUpdateRow/, 'openSettingsModal must reference _setSettingsUpdateRow');
});

// ─── 4. Function body logic: help modal ──────────────────────────────────────

test('help-feedback.js: openHelpModal adds "active" class to helpModal', () => {
    const fn = extractFnSource(HELP_JS, 'openHelpModal');
    assert.ok(fn, 'openHelpModal must be extractable');
    assert.match(fn, /helpModal/);
    assert.match(fn, /classList\.add\('active'\)/);
});

test('help-feedback.js: openHelpModal calls switchHelpTab when tab is provided', () => {
    const fn = extractFnSource(HELP_JS, 'openHelpModal');
    assert.match(fn, /switchHelpTab\(tab\)/);
});

test('help-feedback.js: closeHelpModal removes "active" class from helpModal', () => {
    const fn = extractFnSource(HELP_JS, 'closeHelpModal');
    assert.match(fn, /helpModal/);
    assert.match(fn, /classList\.remove\('active'\)/);
});

test('help-feedback.js: handleHelpDropdownAction closes dropdown before routing', () => {
    const fn = extractFnSource(HELP_JS, 'handleHelpDropdownAction');
    assert.match(fn, /closeHelpDropdown\(\)/);
});

test('help-feedback.js: handleHelpDropdownAction "help" action opens guide tab', () => {
    const fn = extractFnSource(HELP_JS, 'handleHelpDropdownAction');
    assert.match(fn, /action === 'help'/);
    assert.match(fn, /openHelpModal\('guide'\)/);
});

test('help-feedback.js: handleHelpDropdownAction "bug" action opens feedback tab', () => {
    const fn = extractFnSource(HELP_JS, 'handleHelpDropdownAction');
    assert.match(fn, /action === 'bug'/);
    assert.match(fn, /openHelpModal\('feedback'\)/);
});

test('help-feedback.js: handleHelpDropdownAction "community" action opens community modal', () => {
    const fn = extractFnSource(HELP_JS, 'handleHelpDropdownAction');
    assert.match(fn, /action === 'community'/);
    assert.match(fn, /openCommunityModal\(\)/);
});

// ─── 5. Function body logic: beta feedback banner ────────────────────────────

test('help-feedback.js: BETA_FEEDBACK_BANNER_KEY uses correct localStorage key', () => {
    assert.match(HELP_JS, /BETA_FEEDBACK_BANNER_KEY\s*=\s*'baddel\.betaFeedbackBanner\.dismissed\.v1'/);
});

test('help-feedback.js: shouldShowBetaFeedbackBanner checks localStorage via BETA_FEEDBACK_BANNER_KEY', () => {
    const fn = extractFnSource(HELP_JS, 'shouldShowBetaFeedbackBanner');
    assert.match(fn, /localStorage\.getItem\(BETA_FEEDBACK_BANNER_KEY\)/);
    assert.match(fn, /!== '1'/);
});

test('help-feedback.js: markBetaFeedbackBannerDismissed writes "1" to localStorage', () => {
    const fn = extractFnSource(HELP_JS, 'markBetaFeedbackBannerDismissed');
    assert.match(fn, /localStorage\.setItem\(BETA_FEEDBACK_BANNER_KEY, '1'\)/);
});

test('help-feedback.js: hideBetaFeedbackBanner with persist=true calls markBetaFeedbackBannerDismissed', () => {
    const fn = extractFnSource(HELP_JS, 'hideBetaFeedbackBanner');
    assert.match(fn, /markBetaFeedbackBannerDismissed\(\)/);
    assert.match(fn, /persist/);
});

test('help-feedback.js: hideBetaFeedbackBanner hides banner element and removes body class', () => {
    const fn = extractFnSource(HELP_JS, 'hideBetaFeedbackBanner');
    assert.match(fn, /betaFeedbackBanner/);
    assert.match(fn, /banner\.hidden\s*=\s*true/);
    assert.match(fn, /has-beta-feedback-banner/);
});

test('help-feedback.js: dismissBetaFeedbackBanner delegates to hideBetaFeedbackBanner(true)', () => {
    const fn = extractFnSource(HELP_JS, 'dismissBetaFeedbackBanner');
    assert.match(fn, /hideBetaFeedbackBanner\(true\)/);
});

test('help-feedback.js: openBetaFeedbackFromBanner opens feedback tab via openHelpModal', () => {
    const fn = extractFnSource(HELP_JS, 'openBetaFeedbackFromBanner');
    assert.match(fn, /openHelpModal\('feedback'\)/);
});

test('help-feedback.js: openBetaFeedbackFromBanner falls back to handleHelpDropdownAction bug', () => {
    const fn = extractFnSource(HELP_JS, 'openBetaFeedbackFromBanner');
    assert.match(fn, /handleHelpDropdownAction\(null, 'bug'\)/);
});

test('help-feedback.js: showBetaFeedbackBanner adds body class when not dismissed', () => {
    const fn = extractFnSource(HELP_JS, 'showBetaFeedbackBanner');
    assert.match(fn, /has-beta-feedback-banner/);
    assert.match(fn, /document\.body\.classList\.add/);
});

test('help-feedback.js: showBetaFeedbackBanner calls shouldShowBetaFeedbackBanner', () => {
    const fn = extractFnSource(HELP_JS, 'showBetaFeedbackBanner');
    assert.match(fn, /shouldShowBetaFeedbackBanner\(\)/);
});

test('help-feedback.js: DOMContentLoaded listener wires initBetaFeedbackBanner', () => {
    assert.match(HELP_JS, /DOMContentLoaded[\s\S]*?initBetaFeedbackBanner\(\)/);
    assert.doesNotMatch(HELP_JS, /DOMContentLoaded[^\n]*showBetaFeedbackBanner\(\)/);
});

test('help-feedback.js: DOMContentLoaded listener registers checkAndShowUpdateNotes with setTimeout', () => {
    assert.match(HELP_JS, /setTimeout\(checkAndShowUpdateNotes,\s*900\)/);
});

// ─── 5b. Versioned banner state (v2) ─────────────────────────────────────────

test('help-feedback.js: defines BETA_FEEDBACK_BANNER_STATE_KEY', () => {
    assert.match(HELP_JS, /const BETA_FEEDBACK_BANNER_STATE_KEY\s*=/);
});

test('help-feedback.js: BETA_FEEDBACK_BANNER_STATE_KEY uses state.v2 key', () => {
    assert.match(HELP_JS, /BETA_FEEDBACK_BANNER_STATE_KEY\s*=\s*'baddel\.betaFeedbackBanner\.state\.v2'/);
});

test('help-feedback.js: defines _BANNER_DELAY_MS constant for 3-day delay', () => {
    assert.match(HELP_JS, /const _BANNER_DELAY_MS\s*=/);
    assert.match(HELP_JS, /3 \* 24 \* 60 \* 60 \* 1000/);
});

test('help-feedback.js: defines function _loadBannerState', () => {
    assert.match(HELP_JS, /function _loadBannerState\s*\(/);
});

test('help-feedback.js: _loadBannerState reads from BETA_FEEDBACK_BANNER_STATE_KEY', () => {
    const fn = extractFnSource(HELP_JS, '_loadBannerState');
    assert.match(fn, /localStorage\.getItem\(BETA_FEEDBACK_BANNER_STATE_KEY\)/);
});

test('help-feedback.js: _loadBannerState returns null on broken JSON', () => {
    const fn = extractFnSource(HELP_JS, '_loadBannerState');
    assert.match(fn, /catch/);
    assert.match(fn, /return null/);
});

test('help-feedback.js: defines function _saveBannerState', () => {
    assert.match(HELP_JS, /function _saveBannerState\s*\(/);
});

test('help-feedback.js: _saveBannerState writes to BETA_FEEDBACK_BANNER_STATE_KEY', () => {
    const fn = extractFnSource(HELP_JS, '_saveBannerState');
    assert.match(fn, /localStorage\.setItem\(BETA_FEEDBACK_BANNER_STATE_KEY/);
    assert.match(fn, /JSON\.stringify/);
});

test('help-feedback.js: defines function _markBannerDismissedForVersion', () => {
    assert.match(HELP_JS, /function _markBannerDismissedForVersion\s*\(/);
});

test('help-feedback.js: _markBannerDismissedForVersion guards against null version', () => {
    const fn = extractFnSource(HELP_JS, '_markBannerDismissedForVersion');
    assert.match(fn, /if \(!version\) return/);
});

test('help-feedback.js: _markBannerDismissedForVersion pushes version into dismissedVersions', () => {
    const fn = extractFnSource(HELP_JS, '_markBannerDismissedForVersion');
    assert.match(fn, /dismissedVersions/);
    assert.match(fn, /\.push\(version\)/);
});

test('help-feedback.js: hideBetaFeedbackBanner with persist calls _markBannerDismissedForVersion', () => {
    const fn = extractFnSource(HELP_JS, 'hideBetaFeedbackBanner');
    assert.match(fn, /_markBannerDismissedForVersion/);
});

test('help-feedback.js: defines async function initBetaFeedbackBanner', () => {
    assert.match(HELP_JS, /async function initBetaFeedbackBanner\s*\(/);
});

test('help-feedback.js: initBetaFeedbackBanner calls getAppVersion', () => {
    const fn = extractFnSource(HELP_JS, 'initBetaFeedbackBanner');
    assert.match(fn, /getAppVersion/);
});

test('help-feedback.js: initBetaFeedbackBanner loads versioned state', () => {
    const fn = extractFnSource(HELP_JS, 'initBetaFeedbackBanner');
    assert.match(fn, /_loadBannerState/);
});

test('help-feedback.js: initBetaFeedbackBanner checks getPendingUpdateNotes for fresh install', () => {
    const fn = extractFnSource(HELP_JS, 'initBetaFeedbackBanner');
    assert.match(fn, /getPendingUpdateNotes/);
});

test('help-feedback.js: initBetaFeedbackBanner saves new state on first launch', () => {
    const fn = extractFnSource(HELP_JS, 'initBetaFeedbackBanner');
    assert.match(fn, /_saveBannerState/);
});

test('help-feedback.js: initBetaFeedbackBanner compares lastSeenVersion to detect updates', () => {
    const fn = extractFnSource(HELP_JS, 'initBetaFeedbackBanner');
    assert.match(fn, /lastSeenVersion/);
});

test('help-feedback.js: initBetaFeedbackBanner checks dismissedVersions array', () => {
    const fn = extractFnSource(HELP_JS, 'initBetaFeedbackBanner');
    assert.match(fn, /dismissedVersions/);
});

test('help-feedback.js: initBetaFeedbackBanner applies _BANNER_DELAY_MS for fresh-install wait', () => {
    const fn = extractFnSource(HELP_JS, 'initBetaFeedbackBanner');
    assert.match(fn, /_BANNER_DELAY_MS/);
});

test('help-feedback.js: initBetaFeedbackBanner falls back to showBetaFeedbackBanner on error', () => {
    const fn = extractFnSource(HELP_JS, 'initBetaFeedbackBanner');
    assert.match(fn, /showBetaFeedbackBanner\(\)/);
    assert.match(fn, /catch/);
});

test('help-feedback.js: initBetaFeedbackBanner sets window._betaFeedbackBannerVersion', () => {
    const fn = extractFnSource(HELP_JS, 'initBetaFeedbackBanner');
    assert.match(fn, /window\._betaFeedbackBannerVersion\s*=/);
});

// Behavioral simulation: decision logic mirrors initBetaFeedbackBanner
{
    const DELAY_MS = 3 * 24 * 60 * 60 * 1000;

    function bannerDecision({ state, version, now, isUpdate }) {
        if (!state) return isUpdate;
        if (version && state.lastSeenVersion !== version) {
            const dismissed = Array.isArray(state.dismissedVersions) && state.dismissedVersions.includes(version);
            return !dismissed;
        }
        const dismissed = version && Array.isArray(state.dismissedVersions) && state.dismissedVersions.includes(version);
        if (dismissed) return false;
        return (now - (state.firstSeenAt || now)) >= DELAY_MS;
    }

    const V = '1.2.0';
    const OLD_V = '1.1.0';

    test('banner decision: fresh install without update notes hides banner before 3 days', () => {
        const now = Date.now();
        const state = { firstSeenAt: now - 1000, lastSeenVersion: V, dismissedVersions: [] };
        assert.equal(bannerDecision({ state, version: V, now, isUpdate: false }), false);
    });

    test('banner decision: fresh install shows banner after 3-day delay', () => {
        const now = Date.now();
        const state = { firstSeenAt: now - DELAY_MS - 1000, lastSeenVersion: V, dismissedVersions: [] };
        assert.equal(bannerDecision({ state, version: V, now, isUpdate: false }), true);
    });

    test('banner decision: no state and update detected shows banner immediately', () => {
        assert.equal(bannerDecision({ state: null, version: V, now: Date.now(), isUpdate: true }), true);
    });

    test('banner decision: no state without update hides banner on first launch', () => {
        assert.equal(bannerDecision({ state: null, version: V, now: Date.now(), isUpdate: false }), false);
    });

    test('banner decision: version change shows banner immediately', () => {
        const state = { firstSeenAt: Date.now() - 100, lastSeenVersion: OLD_V, dismissedVersions: [OLD_V] };
        assert.equal(bannerDecision({ state, version: V, now: Date.now(), isUpdate: false }), true);
    });

    test('banner decision: dismissed current version hides banner', () => {
        const now = Date.now();
        const state = { firstSeenAt: now - DELAY_MS - 1000, lastSeenVersion: V, dismissedVersions: [V] };
        assert.equal(bannerDecision({ state, version: V, now, isUpdate: false }), false);
    });

    test('banner decision: dismissing old version does not block newer version', () => {
        const state = { firstSeenAt: Date.now() - 100, lastSeenVersion: OLD_V, dismissedVersions: [OLD_V] };
        assert.equal(bannerDecision({ state, version: V, now: Date.now(), isUpdate: false }), true);
    });

    test('banner decision: dismissed same new version after update is respected', () => {
        const state = { firstSeenAt: Date.now() - DELAY_MS - 1000, lastSeenVersion: V, dismissedVersions: [V] };
        assert.equal(bannerDecision({ state, version: V, now: Date.now(), isUpdate: false }), false);
    });
}

// ─── 6. Function body logic: update system ───────────────────────────────────

test('help-feedback.js: _updateState object has expected status field starting as "idle"', () => {
    const idx = HELP_JS.indexOf('const _updateState = {');
    assert.ok(idx !== -1);
    const block = HELP_JS.slice(idx, idx + 200);
    assert.match(block, /status:\s*'idle'/);
});

test('help-feedback.js: openUpdateModal dispatches on _updateState.status', () => {
    const fn = extractFnSource(HELP_JS, 'openUpdateModal');
    assert.match(fn, /_updateState\.status/);
    assert.match(fn, /updateModal/);
    assert.match(fn, /classList\.add\('active'\)/);
});

test('help-feedback.js: closeUpdateModal removes "active" from updateModal', () => {
    const fn = extractFnSource(HELP_JS, 'closeUpdateModal');
    assert.match(fn, /updateModal/);
    assert.match(fn, /classList\.remove\('active'\)/);
});

test('help-feedback.js: installUpdate calls window.electronAPI.sendRestartUpdate', () => {
    const fn = extractFnSource(HELP_JS, 'installUpdate');
    assert.match(fn, /window\.electronAPI\.sendRestartUpdate\(\)/);
});

test('help-feedback.js: closeUpdateNotesModal removes "active" from updateNotesModal', () => {
    const fnStart = HELP_JS.indexOf('async function closeUpdateNotesModal');
    const fn = HELP_JS.slice(fnStart, fnStart + 700);
    assert.match(fn, /updateNotesModal/);
    assert.match(fn, /classList\.remove\('active'\)/);
});

test('help-feedback.js: closeUpdateNotesModal calls electronAPI.markUpdateNotesShown', () => {
    const fnStart = HELP_JS.indexOf('async function closeUpdateNotesModal');
    const fn = HELP_JS.slice(fnStart, fnStart + 700);
    assert.match(fn, /markUpdateNotesShown/);
    assert.match(fn, /_pendingUpdateNotesVersion/);
});

// ─── 7. Function body logic: community hub ───────────────────────────────────

test('help-feedback.js: openCommunityModal adds "active" to communityModal', () => {
    const fn = extractFnSource(HELP_JS, 'openCommunityModal');
    assert.match(fn, /communityModal/);
    assert.match(fn, /classList\.add\('active'\)/);
});

test('help-feedback.js: closeCommunityModal removes "active" from communityModal', () => {
    const fn = extractFnSource(HELP_JS, 'closeCommunityModal');
    assert.match(fn, /communityModal/);
    assert.match(fn, /classList\.remove\('active'\)/);
});

test('help-feedback.js: openCommunityLink calls window.electronAPI.openCommunityUrl', () => {
    const fn = extractFnSource(HELP_JS, 'openCommunityLink');
    assert.match(fn, /window\.electronAPI.*openCommunityUrl/);
});

// ─── 8. sendFeedback logic ────────────────────────────────────────────────────

test('help-feedback.js: sendFeedback POSTs to formspree endpoint', () => {
    const fn = extractFnSource(HELP_JS, 'sendFeedback');
    assert.match(fn, /formspree\.io/);
    assert.match(fn, /method:\s*'POST'/);
});

test('help-feedback.js: sendFeedback reads feedbackMessage and feedbackName from DOM', () => {
    const fn = extractFnSource(HELP_JS, 'sendFeedback');
    assert.match(fn, /feedbackMessage/);
    assert.match(fn, /feedbackName/);
});

test('help-feedback.js: sendFeedback closes modal and hides banner on success', () => {
    const fn = extractFnSource(HELP_JS, 'sendFeedback');
    assert.match(fn, /closeHelpModal\(\)/);
    assert.match(fn, /hideBetaFeedbackBanner\(true\)/);
});

test('help-feedback.js: sendFeedback calls electronAPI.logFeedbackSent on success', () => {
    const fn = extractFnSource(HELP_JS, 'sendFeedback');
    assert.match(fn, /logFeedbackSent/);
});

// ─── 9. Inline HTML handler coverage (dashboard.html unchanged) ───────────────

test('dashboard.html: toggleHelpDropdown called from help button onclick', () => {
    assert.match(HTML, /onclick="toggleHelpDropdown\(event\)"/);
});

test('dashboard.html: handleHelpDropdownAction called with "help" action', () => {
    assert.match(HTML, /onclick="handleHelpDropdownAction\(event,'help'\)"/);
});

test('dashboard.html: handleHelpDropdownAction called with "bug" action', () => {
    assert.match(HTML, /onclick="handleHelpDropdownAction\(event,'bug'\)"/);
});

test('dashboard.html: handleHelpDropdownAction called with "community" action', () => {
    assert.match(HTML, /onclick="handleHelpDropdownAction\(event,'community'\)"/);
});

test('dashboard.html: openUpdateModal called from update badge button onclick', () => {
    assert.match(HTML, /onclick="openUpdateModal\(\)"/);
});

test('dashboard.html: sendFeedback called from feedback form button onclick', () => {
    assert.match(HTML, /onclick="sendFeedback\(\)"/);
});

test('dashboard.html: closeHelpModal called from close button onclick', () => {
    assert.match(HTML, /onclick="closeHelpModal\(\)"/);
});

test('dashboard.html: closeUpdateModal called from cancel/later buttons', () => {
    assert.match(HTML, /onclick="closeUpdateModal\(\)"/);
});

test('dashboard.html: startUpdateDownload called from download button onclick', () => {
    assert.match(HTML, /onclick="startUpdateDownload\(\)"/);
});

test('dashboard.html: installUpdate called from install button onclick', () => {
    assert.match(HTML, /onclick="installUpdate\(\)"/);
});

test('dashboard.html: settingsCheckForUpdate called from settings button onclick', () => {
    assert.match(HTML, /onclick="settingsCheckForUpdate\(\)"/);
});

test('dashboard.html: closeUpdateNotesModal called from modal overlay onclick', () => {
    assert.match(HTML, /onclick=".*closeUpdateNotesModal\(\)"/);
});

test('dashboard.html: closeCommunityModal called from community modal overlay onclick', () => {
    assert.match(HTML, /onclick=".*closeCommunityModal\(\)"/);
});

test('dashboard.html: openCommunityLink called from social buttons', () => {
    assert.match(HTML, /onclick="openCommunityLink\(/);
});

test('dashboard.html: openBetaFeedbackFromBanner called from banner button onclick', () => {
    assert.match(HTML, /onclick="openBetaFeedbackFromBanner\(\)"/);
});

test('dashboard.html: dismissBetaFeedbackBanner called from banner dismiss button onclick', () => {
    assert.match(HTML, /onclick="dismissBetaFeedbackBanner\(\)"/);
});

test('dashboard.html: includes help-feedback.js script before app.js', () => {
    const helpIdx = HTML.indexOf('js/app/help-feedback.js');
    const appIdx  = HTML.indexOf('"js/app.js"');
    assert.ok(helpIdx !== -1, 'help-feedback.js script tag must exist');
    assert.ok(helpIdx < appIdx, 'help-feedback.js must load before app.js');
});

// ─── 10. Dependency isolation: help-feedback.js must not reference game-list state ──

test('help-feedback.js: does NOT reference allGamesData', () => {
    assert.doesNotMatch(HELP_JS, /\ballGamesData\b/);
});

test('help-feedback.js: does NOT reference _allGamesCache', () => {
    assert.doesNotMatch(HELP_JS, /window\._allGamesCache\b/);
});

test('help-feedback.js: does NOT reference window._vs', () => {
    assert.doesNotMatch(HELP_JS, /window\._vs\b/);
});

test('help-feedback.js: does NOT reference currentFilters', () => {
    assert.doesNotMatch(HELP_JS, /\bcurrentFilters\b/);
});

test('help-feedback.js: does NOT reference renderAllGamesView', () => {
    assert.doesNotMatch(HELP_JS, /\brenderAllGamesView\b/);
});

test('help-feedback.js: does NOT reference playtimeData', () => {
    assert.doesNotMatch(HELP_JS, /\bplaytimeData\b/);
});
