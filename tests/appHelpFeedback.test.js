'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT   = path.resolve(__dirname, '..');
const APP_JS = fs.readFileSync(path.join(ROOT, 'src/js/app.js'),       'utf8');
const HTML   = fs.readFileSync(path.join(ROOT, 'src/dashboard.html'),  'utf8');

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

// ─── 1. Source-presence: all target functions defined in app.js ───────────────

test('app.js: defines function openHelpModal', () => {
    assert.match(APP_JS, /function openHelpModal\s*\(/);
});

test('app.js: defines function closeHelpModal', () => {
    assert.match(APP_JS, /function closeHelpModal\s*\(/);
});

test('app.js: defines function toggleHelpDropdown', () => {
    assert.match(APP_JS, /function toggleHelpDropdown\s*\(/);
});

test('app.js: defines function closeHelpDropdown', () => {
    assert.match(APP_JS, /function closeHelpDropdown\s*\(/);
});

test('app.js: defines function _positionHelpDropdown', () => {
    assert.match(APP_JS, /function _positionHelpDropdown\s*\(/);
});

test('app.js: defines function handleHelpDropdownAction', () => {
    assert.match(APP_JS, /function handleHelpDropdownAction\s*\(/);
});

test('app.js: defines function switchHelpTab', () => {
    assert.match(APP_JS, /function switchHelpTab\s*\(/);
});

test('app.js: defines async function sendFeedback', () => {
    assert.match(APP_JS, /async function sendFeedback\s*\(/);
});

test('app.js: defines constant BETA_FEEDBACK_BANNER_KEY', () => {
    assert.match(APP_JS, /const BETA_FEEDBACK_BANNER_KEY\s*=/);
});

test('app.js: defines function shouldShowBetaFeedbackBanner', () => {
    assert.match(APP_JS, /function shouldShowBetaFeedbackBanner\s*\(/);
});

test('app.js: defines function markBetaFeedbackBannerDismissed', () => {
    assert.match(APP_JS, /function markBetaFeedbackBannerDismissed\s*\(/);
});

test('app.js: defines function showBetaFeedbackBanner', () => {
    assert.match(APP_JS, /function showBetaFeedbackBanner\s*\(/);
});

test('app.js: defines function hideBetaFeedbackBanner', () => {
    assert.match(APP_JS, /function hideBetaFeedbackBanner\s*\(/);
});

test('app.js: defines function dismissBetaFeedbackBanner', () => {
    assert.match(APP_JS, /function dismissBetaFeedbackBanner\s*\(/);
});

test('app.js: defines function openBetaFeedbackFromBanner', () => {
    assert.match(APP_JS, /function openBetaFeedbackFromBanner\s*\(/);
});

test('app.js: defines function openUpdateModal', () => {
    assert.match(APP_JS, /function openUpdateModal\s*\(/);
});

test('app.js: defines function closeUpdateModal', () => {
    assert.match(APP_JS, /function closeUpdateModal\s*\(/);
});

test('app.js: defines function installUpdate', () => {
    assert.match(APP_JS, /function installUpdate\s*\(/);
});

test('app.js: defines async function startUpdateDownload', () => {
    assert.match(APP_JS, /async function startUpdateDownload\s*\(/);
});

test('app.js: defines async function settingsCheckForUpdate', () => {
    assert.match(APP_JS, /async function settingsCheckForUpdate\s*\(/);
});

test('app.js: defines async function closeUpdateNotesModal', () => {
    assert.match(APP_JS, /async function closeUpdateNotesModal\s*\(/);
});

test('app.js: defines function showUpdateNotesModal', () => {
    assert.match(APP_JS, /function showUpdateNotesModal\s*\(/);
});

test('app.js: defines async function checkAndShowUpdateNotes', () => {
    assert.match(APP_JS, /async function checkAndShowUpdateNotes\s*\(/);
});

test('app.js: defines function openCommunityModal', () => {
    assert.match(APP_JS, /function openCommunityModal\s*\(/);
});

test('app.js: defines function closeCommunityModal', () => {
    assert.match(APP_JS, /function closeCommunityModal\s*\(/);
});

test('app.js: defines async function openCommunityLink', () => {
    assert.match(APP_JS, /async function openCommunityLink\s*\(/);
});

// ─── 2. window exports ────────────────────────────────────────────────────────

test('app.js: exports window.handleHelpDropdownAction', () => {
    assert.match(APP_JS, /window\.handleHelpDropdownAction\s*=\s*handleHelpDropdownAction/);
});

test('app.js: exports window.dismissBetaFeedbackBanner', () => {
    assert.match(APP_JS, /window\.dismissBetaFeedbackBanner\s*=\s*dismissBetaFeedbackBanner/);
});

test('app.js: exports window.openBetaFeedbackFromBanner', () => {
    assert.match(APP_JS, /window\.openBetaFeedbackFromBanner\s*=\s*openBetaFeedbackFromBanner/);
});

test('app.js: exports window.closeUpdateNotesModal', () => {
    assert.match(APP_JS, /window\.closeUpdateNotesModal\s*=\s*closeUpdateNotesModal/);
});

// ─── 3. Function body logic: help modal ──────────────────────────────────────

test('app.js: openHelpModal adds "active" class to helpModal', () => {
    const fn = extractFnSource(APP_JS, 'openHelpModal');
    assert.ok(fn, 'openHelpModal must be extractable');
    assert.match(fn, /helpModal/);
    assert.match(fn, /classList\.add\('active'\)/);
});

test('app.js: openHelpModal calls switchHelpTab when tab is provided', () => {
    const fn = extractFnSource(APP_JS, 'openHelpModal');
    assert.match(fn, /switchHelpTab\(tab\)/);
});

test('app.js: closeHelpModal removes "active" class from helpModal', () => {
    const fn = extractFnSource(APP_JS, 'closeHelpModal');
    assert.match(fn, /helpModal/);
    assert.match(fn, /classList\.remove\('active'\)/);
});

test('app.js: handleHelpDropdownAction closes dropdown before routing', () => {
    const fn = extractFnSource(APP_JS, 'handleHelpDropdownAction');
    assert.match(fn, /closeHelpDropdown\(\)/);
});

test('app.js: handleHelpDropdownAction "help" action opens guide tab', () => {
    const fn = extractFnSource(APP_JS, 'handleHelpDropdownAction');
    assert.match(fn, /action === 'help'/);
    assert.match(fn, /openHelpModal\('guide'\)/);
});

test('app.js: handleHelpDropdownAction "bug" action opens feedback tab', () => {
    const fn = extractFnSource(APP_JS, 'handleHelpDropdownAction');
    assert.match(fn, /action === 'bug'/);
    assert.match(fn, /openHelpModal\('feedback'\)/);
});

test('app.js: handleHelpDropdownAction "community" action opens community modal', () => {
    const fn = extractFnSource(APP_JS, 'handleHelpDropdownAction');
    assert.match(fn, /action === 'community'/);
    assert.match(fn, /openCommunityModal\(\)/);
});

// ─── 4. Function body logic: beta feedback banner ────────────────────────────

test('app.js: BETA_FEEDBACK_BANNER_KEY uses correct localStorage key', () => {
    assert.match(APP_JS, /BETA_FEEDBACK_BANNER_KEY\s*=\s*'baddel\.betaFeedbackBanner\.dismissed\.v1'/);
});

test('app.js: shouldShowBetaFeedbackBanner checks localStorage via BETA_FEEDBACK_BANNER_KEY', () => {
    const fn = extractFnSource(APP_JS, 'shouldShowBetaFeedbackBanner');
    assert.match(fn, /localStorage\.getItem\(BETA_FEEDBACK_BANNER_KEY\)/);
    assert.match(fn, /!== '1'/);
});

test('app.js: markBetaFeedbackBannerDismissed writes "1" to localStorage', () => {
    const fn = extractFnSource(APP_JS, 'markBetaFeedbackBannerDismissed');
    assert.match(fn, /localStorage\.setItem\(BETA_FEEDBACK_BANNER_KEY, '1'\)/);
});

test('app.js: hideBetaFeedbackBanner with persist=true calls markBetaFeedbackBannerDismissed', () => {
    const fn = extractFnSource(APP_JS, 'hideBetaFeedbackBanner');
    assert.match(fn, /markBetaFeedbackBannerDismissed\(\)/);
    assert.match(fn, /persist/);
});

test('app.js: hideBetaFeedbackBanner hides banner element and removes body class', () => {
    const fn = extractFnSource(APP_JS, 'hideBetaFeedbackBanner');
    assert.match(fn, /betaFeedbackBanner/);
    assert.match(fn, /banner\.hidden\s*=\s*true/);
    assert.match(fn, /has-beta-feedback-banner/);
});

test('app.js: dismissBetaFeedbackBanner delegates to hideBetaFeedbackBanner(true)', () => {
    const fn = extractFnSource(APP_JS, 'dismissBetaFeedbackBanner');
    assert.match(fn, /hideBetaFeedbackBanner\(true\)/);
});

test('app.js: openBetaFeedbackFromBanner opens feedback tab via openHelpModal', () => {
    const fn = extractFnSource(APP_JS, 'openBetaFeedbackFromBanner');
    assert.match(fn, /openHelpModal\('feedback'\)/);
});

test('app.js: openBetaFeedbackFromBanner falls back to handleHelpDropdownAction bug', () => {
    const fn = extractFnSource(APP_JS, 'openBetaFeedbackFromBanner');
    assert.match(fn, /handleHelpDropdownAction\(null, 'bug'\)/);
});

test('app.js: showBetaFeedbackBanner adds body class when not dismissed', () => {
    const fn = extractFnSource(APP_JS, 'showBetaFeedbackBanner');
    assert.match(fn, /has-beta-feedback-banner/);
    assert.match(fn, /document\.body\.classList\.add/);
});

test('app.js: showBetaFeedbackBanner calls shouldShowBetaFeedbackBanner', () => {
    const fn = extractFnSource(APP_JS, 'showBetaFeedbackBanner');
    assert.match(fn, /shouldShowBetaFeedbackBanner\(\)/);
});

test('app.js: DOMContentLoaded listener calls showBetaFeedbackBanner', () => {
    // The listener is not inside a named function — check the surrounding code
    const listenerIdx = APP_JS.indexOf("DOMContentLoaded', () => { showBetaFeedbackBanner()");
    assert.ok(listenerIdx !== -1, 'DOMContentLoaded → showBetaFeedbackBanner must exist');
});

// ─── 5. Function body logic: update system ───────────────────────────────────

test('app.js: _updateState object has expected status field starting as "idle"', () => {
    const idx = APP_JS.indexOf('const _updateState = {');
    assert.ok(idx !== -1);
    const block = APP_JS.slice(idx, idx + 200);
    assert.match(block, /status:\s*'idle'/);
});

test('app.js: openUpdateModal dispatches on _updateState.status', () => {
    const fn = extractFnSource(APP_JS, 'openUpdateModal');
    assert.match(fn, /_updateState\.status/);
    assert.match(fn, /updateModal/);
    assert.match(fn, /classList\.add\('active'\)/);
});

test('app.js: closeUpdateModal removes "active" from updateModal', () => {
    const fn = extractFnSource(APP_JS, 'closeUpdateModal');
    assert.match(fn, /updateModal/);
    assert.match(fn, /classList\.remove\('active'\)/);
});

test('app.js: installUpdate calls window.electronAPI.sendRestartUpdate', () => {
    const fn = extractFnSource(APP_JS, 'installUpdate');
    assert.match(fn, /window\.electronAPI\.sendRestartUpdate\(\)/);
});

test('app.js: closeUpdateNotesModal removes "active" from updateNotesModal', () => {
    const fnStart = APP_JS.indexOf('async function closeUpdateNotesModal');
    const fn = APP_JS.slice(fnStart, fnStart + 400);
    assert.match(fn, /updateNotesModal/);
    assert.match(fn, /classList\.remove\('active'\)/);
});

test('app.js: closeUpdateNotesModal calls electronAPI.markUpdateNotesShown', () => {
    const fnStart = APP_JS.indexOf('async function closeUpdateNotesModal');
    const fn = APP_JS.slice(fnStart, fnStart + 400);
    assert.match(fn, /markUpdateNotesShown/);
    assert.match(fn, /_pendingUpdateNotesVersion/);
});

test('app.js: _pendingUpdateNotesVersion is a module-level let', () => {
    assert.match(APP_JS, /let _pendingUpdateNotesVersion\s*=\s*null/);
});

// ─── 6. Function body logic: community hub ───────────────────────────────────

test('app.js: openCommunityModal adds "active" to communityModal', () => {
    const fn = extractFnSource(APP_JS, 'openCommunityModal');
    assert.match(fn, /communityModal/);
    assert.match(fn, /classList\.add\('active'\)/);
});

test('app.js: closeCommunityModal removes "active" from communityModal', () => {
    const fn = extractFnSource(APP_JS, 'closeCommunityModal');
    assert.match(fn, /communityModal/);
    assert.match(fn, /classList\.remove\('active'\)/);
});

test('app.js: openCommunityLink calls window.electronAPI.openCommunityUrl', () => {
    const fn = extractFnSource(APP_JS, 'openCommunityLink');
    assert.match(fn, /window\.electronAPI.*openCommunityUrl/);
});

// ─── 7. sendFeedback logic ────────────────────────────────────────────────────

test('app.js: sendFeedback POSTs to formspree endpoint', () => {
    const fn = extractFnSource(APP_JS, 'sendFeedback');
    assert.match(fn, /formspree\.io/);
    assert.match(fn, /method:\s*'POST'/);
});

test('app.js: sendFeedback reads feedbackMessage and feedbackName from DOM', () => {
    const fn = extractFnSource(APP_JS, 'sendFeedback');
    assert.match(fn, /feedbackMessage/);
    assert.match(fn, /feedbackName/);
});

test('app.js: sendFeedback closes modal and hides banner on success', () => {
    const fn = extractFnSource(APP_JS, 'sendFeedback');
    assert.match(fn, /closeHelpModal\(\)/);
    assert.match(fn, /hideBetaFeedbackBanner\(true\)/);
});

test('app.js: sendFeedback calls electronAPI.logFeedbackSent on success', () => {
    const fn = extractFnSource(APP_JS, 'sendFeedback');
    assert.match(fn, /logFeedbackSent/);
});

// ─── 8. Inline HTML handler coverage ─────────────────────────────────────────

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

// ─── 9. Dependency isolation: section must not reference game-list state ──────

// Scope the check to the HELP & FEEDBACK through Community sections (~L6811-7673).
// We extract the portion by looking between the section markers.
function extractSection() {
    const start = APP_JS.indexOf('// HELP & FEEDBACK');
    const end   = APP_JS.indexOf('\n// ============================================================\n', start + 100);
    // If there's no clean end marker after the community section, take up to 1200 lines past start
    return end !== -1 ? APP_JS.slice(start, end) : APP_JS.slice(start, start + 60000);
}

// Use broader file scan for the negative assertions — if any of these show up
// in the lines BETWEEN the first "HELP & FEEDBACK" header and the end of the
// community hub block they would indicate hidden coupling that blocks extraction.

const SECTION = (() => {
    const start = APP_JS.indexOf('// HELP & FEEDBACK');
    // The community section is the last block; find "openCommunityLink" closing brace
    const fnSrc = extractFnSource(APP_JS, 'openCommunityLink');
    const linkEnd = APP_JS.indexOf(fnSrc) + fnSrc.length;
    return APP_JS.slice(start, linkEnd);
})();

test('help/feedback/update section: does NOT reference allGamesData', () => {
    assert.doesNotMatch(SECTION, /\ballGamesData\b/);
});

test('help/feedback/update section: does NOT reference _allGamesCache', () => {
    assert.doesNotMatch(SECTION, /window\._allGamesCache\b/);
});

test('help/feedback/update section: does NOT reference window._vs', () => {
    assert.doesNotMatch(SECTION, /window\._vs\b/);
});

test('help/feedback/update section: does NOT reference currentFilters', () => {
    assert.doesNotMatch(SECTION, /\bcurrentFilters\b/);
});

test('help/feedback/update section: does NOT reference renderAllGamesView', () => {
    assert.doesNotMatch(SECTION, /\brenderAllGamesView\b/);
});

test('help/feedback/update section: does NOT reference playtimeData', () => {
    // playtime state has no business in help/feedback/update UI
    assert.doesNotMatch(SECTION, /\bplaytimeData\b/);
});
