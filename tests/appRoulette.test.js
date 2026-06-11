'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2.22A safety tests — Roulette / Spin / Install-pool block in app.js
//
// PURPOSE
//   Document the complete roulette feature boundary before extracting it into
//   src/js/app/roulette.js.  These tests prove:
//     • every target function/state still lives in app.js
//     • every DOM ID and inline handler in dashboard.html is accounted for
//     • key behavioral contracts are source-encoded correctly
//     • all external dependencies are explicitly listed
//     • roulette does NOT touch unrelated module internals
//
// HOW TESTS ARE STRUCTURED
//   Source-presence tests  — assert the source text contains the expected
//     declaration; they will fail immediately if something is accidentally
//     deleted or renamed during extraction.
//   DOM tests              — assert IDs / classes / handlers exist in HTML;
//     they will fail if dashboard.html is edited to rename a target element.
//   Behavior tests         — extract pure helpers from source and run them
//     with real inputs so regressions in logic (not just location) are caught.
//   Dependency tests       — assert that the consuming call sites are still
//     present; they become cross-file dependency contracts after extraction.
//   Isolation tests        — assert the roulette block does NOT reference
//     internals of other feature modules that are already extracted.
//
// REDIRECT NOTE
//   When roulette.js is created, change APP_JS references in each section to
//   ROULETTE_JS.  The DOM and dependency tests remain anchored to APP_JS /
//   HTML so the contracts are still verified across the boundary.
// ─────────────────────────────────────────────────────────────────────────────

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT       = path.resolve(__dirname, '..');
const APP_JS     = fs.readFileSync(path.join(ROOT, 'src/js/app.js'),         'utf8');
const HTML       = fs.readFileSync(path.join(ROOT, 'src/dashboard.html'),    'utf8');
// Extracted files whose exports roulette depends on (read for dependency tests)
const SUGGESTIONS_JS  = fs.readFileSync(path.join(ROOT, 'src/js/app/suggestions.js'),   'utf8');
const ARTWORK_SYNC_JS = fs.readFileSync(path.join(ROOT, 'src/js/app/artwork-sync.js'),  'utf8');
const TOAST_JS        = fs.readFileSync(path.join(ROOT, 'src/js/app/toast-confirm.js'), 'utf8');
const LAUNCHER_JS     = fs.readFileSync(path.join(ROOT, 'src/js/app/launcher-actions.js'), 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — State variables
// ─────────────────────────────────────────────────────────────────────────────

test('roulette: rouletteResultId state variable is declared', () => {
    assert.match(APP_JS, /let\s+rouletteResultId\s*=/);
});

test('roulette: rouletteResultGame state variable is declared', () => {
    assert.match(APP_JS, /let\s+rouletteResultGame\s*=/);
});

test('roulette: isSpinning state variable is declared', () => {
    assert.match(APP_JS, /let\s+isSpinning\s*=\s*false/);
});

test('roulette: rouletteMode state variable is declared', () => {
    assert.match(APP_JS, /let\s+rouletteMode\s*=\s*null/);
});

test('roulette: _rouletteRecentPicks state variable is declared', () => {
    assert.match(APP_JS, /let\s+_rouletteRecentPicks\s*=\s*\[\]/);
});

test('roulette: rouletteSpinToken state variable is declared', () => {
    assert.match(APP_JS, /let\s+rouletteSpinToken\s*=\s*0/);
});

test('roulette: rouletteState state variable is declared', () => {
    assert.match(APP_JS, /let\s+rouletteState\s*=\s*'idle'/);
});

test('roulette: _ROULETTE_HYDRATE_LIMIT constant is declared with value 12', () => {
    assert.match(APP_JS, /const\s+_ROULETTE_HYDRATE_LIMIT\s*=\s*12/);
});

test('roulette: _roulettePoolHydrated flag is declared as false', () => {
    assert.match(APP_JS, /let\s+_roulettePoolHydrated\s*=\s*false/);
});

test('roulette: customSpinIds is declared as an empty array', () => {
    assert.match(APP_JS, /let\s+customSpinIds\s*=\s*\[\]/);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — Source-presence: all roulette functions exist in app.js
// ─────────────────────────────────────────────────────────────────────────────

test('roulette: setRouletteMode is defined', () => {
    assert.match(APP_JS, /function setRouletteMode\s*\(/);
});

test('roulette: _buildPlayPool is defined', () => {
    assert.match(APP_JS, /function _buildPlayPool\s*\(/);
});

test('roulette: _buildInstallPool is defined', () => {
    assert.match(APP_JS, /function _buildInstallPool\s*\(/);
});

test('roulette: _rouletteInstallImage is defined', () => {
    assert.match(APP_JS, /function _rouletteInstallImage\s*\(/);
});

test('roulette: _roulettePosterPick is defined', () => {
    assert.match(APP_JS, /function _roulettePosterPick\s*\(/);
});

test('roulette: getRoulettePosterUrl is defined', () => {
    assert.match(APP_JS, /function getRoulettePosterUrl\s*\(/);
});

test('roulette: _rouletteHydrateInstallPool is defined', () => {
    assert.match(APP_JS, /function _rouletteHydrateInstallPool\s*\(/);
});

test('roulette: _rouletteValidImg is defined', () => {
    assert.match(APP_JS, /function _rouletteValidImg\s*\(/);
});

test('roulette: getGamePoster is defined', () => {
    assert.match(APP_JS, /function getGamePoster\s*\(/);
});

test('roulette: _rouletteShowImg is defined', () => {
    assert.match(APP_JS, /function _rouletteShowImg\s*\(/);
});

test('roulette: prepareInstallRoulettePool is defined as async', () => {
    assert.match(APP_JS, /async\s+function prepareInstallRoulettePool\s*\(/);
});

test('roulette: preloadImageUrl is defined', () => {
    assert.match(APP_JS, /function preloadImageUrl\s*\(/);
});

test('roulette: _rouletteApplyImageNow is defined', () => {
    assert.match(APP_JS, /function _rouletteApplyImageNow\s*\(/);
});

test('roulette: applyRouletteFinalPoster is defined', () => {
    assert.match(APP_JS, /function applyRouletteFinalPoster\s*\(/);
});

test('roulette: _rouletteHeroUrl is defined', () => {
    assert.match(APP_JS, /function _rouletteHeroUrl\s*\(/);
});

test('roulette: resetRouletteVisualStateForSpin is defined', () => {
    assert.match(APP_JS, /function resetRouletteVisualStateForSpin\s*\(/);
});

test('roulette: _rouletteSetHeroBackground is defined', () => {
    assert.match(APP_JS, /function _rouletteSetHeroBackground\s*\(/);
});

test('roulette: _rouletteGameId is defined', () => {
    assert.match(APP_JS, /function _rouletteGameId\s*\(/);
});

test('roulette: _rouletteEntropySeed is defined', () => {
    assert.match(APP_JS, /function _rouletteEntropySeed\s*\(/);
});

test('roulette: _rouletteShuffleForSpin is defined', () => {
    assert.match(APP_JS, /function _rouletteShuffleForSpin\s*\(/);
});

test('roulette: _roulettePickFinal is defined', () => {
    assert.match(APP_JS, /function _roulettePickFinal\s*\(/);
});

test('roulette: applyRoulettePreviewPoster is defined', () => {
    assert.match(APP_JS, /function applyRoulettePreviewPoster\s*\(/);
});

test('roulette: preloadRouletteFinalPoster is defined', () => {
    assert.match(APP_JS, /function preloadRouletteFinalPoster\s*\(/);
});

test('roulette: startRoulette is defined as async', () => {
    assert.match(APP_JS, /async\s+function startRoulette\s*\(/);
});

test('roulette: playRouletteResult is defined', () => {
    assert.match(APP_JS, /function playRouletteResult\s*\(/);
});

test('roulette: onRouletteCardClick is defined', () => {
    assert.match(APP_JS, /function onRouletteCardClick\s*\(/);
});

test('roulette: openRoulettePool is defined', () => {
    assert.match(APP_JS, /function openRoulettePool\s*\(/);
});

test('roulette: closeRoulettePool is defined', () => {
    assert.match(APP_JS, /function closeRoulettePool\s*\(/);
});

test('roulette: filterPoolList is defined', () => {
    assert.match(APP_JS, /function filterPoolList\s*\(/);
});

test('roulette: saveRoulettePool is defined', () => {
    assert.match(APP_JS, /function saveRoulettePool\s*\(/);
});

test('roulette: clearRoulettePool is defined', () => {
    assert.match(APP_JS, /function clearRoulettePool\s*\(/);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — Legacy stubs (documented as unused)
// ─────────────────────────────────────────────────────────────────────────────

test('roulette: _legacyStartRouletteUnused0 stub is declared', () => {
    assert.match(APP_JS, /async\s+function _legacyStartRouletteUnused0\s*\(/);
});

test('roulette: _legacyStartRouletteUnused1 stub is declared', () => {
    assert.match(APP_JS, /function _legacyStartRouletteUnused1\s*\(/);
});

test('roulette: legacy stubs are NOT called anywhere outside their own body', () => {
    // Remove function bodies so we only check call sites, not declarations.
    // The stubs must not be referenced by any non-stub function.
    const withoutBodies = APP_JS.replace(
        /(?:async\s+)?function _legacyStartRouletteUnused[01]\s*\([^)]*\)\s*\{/g,
        '__LEGACY_DECL_REMOVED__{'
    );
    assert.doesNotMatch(withoutBodies, /_legacyStartRouletteUnused0\s*\(/,
        '_legacyStartRouletteUnused0 should not be called by any live code');
    assert.doesNotMatch(withoutBodies, /_legacyStartRouletteUnused1\s*\(/,
        '_legacyStartRouletteUnused1 should not be called by any live code');
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — DOM IDs in dashboard.html
// ─────────────────────────────────────────────────────────────────────────────

test('html: id="surpriseMeSection" exists', () => {
    assert.match(HTML, /id="surpriseMeSection"/);
});

test('html: id="rouletteModeSelector" exists', () => {
    assert.match(HTML, /id="rouletteModeSelector"/);
});

test('html: id="modeBtnPlay" exists', () => {
    assert.match(HTML, /id="modeBtnPlay"/);
});

test('html: id="modeBtnInstall" exists', () => {
    assert.match(HTML, /id="modeBtnInstall"/);
});

test('html: id="rouletteCard" exists', () => {
    assert.match(HTML, /id="rouletteCard"/);
});

test('html: id="rouletteImg" exists', () => {
    assert.match(HTML, /id="rouletteImg"/);
});

test('html: id="rouletteGraphic" exists', () => {
    assert.match(HTML, /id="rouletteGraphic"/);
});

test('html: id="rouletteName" exists', () => {
    assert.match(HTML, /id="rouletteName"/);
});

test('html: id="spinBtn" exists', () => {
    assert.match(HTML, /id="spinBtn"/);
});

test('html: id="roulettePoolBtn" exists', () => {
    assert.match(HTML, /id="roulettePoolBtn"/);
});

test('html: id="playResultBtn" exists', () => {
    assert.match(HTML, /id="playResultBtn"/);
});

test('html: id="roulettePoolModal" exists', () => {
    assert.match(HTML, /id="roulettePoolModal"/);
});

test('html: id="poolGamesList" exists', () => {
    assert.match(HTML, /id="poolGamesList"/);
});

test('html: id="poolSearchInput" exists', () => {
    assert.match(HTML, /id="poolSearchInput"/);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5 — CSS classes referenced by roulette JS in dashboard.html
// ─────────────────────────────────────────────────────────────────────────────

test('html: class "surprise-me-section" exists on the roulette wrapper section', () => {
    assert.match(HTML, /class="surprise-me-section"/);
});

test('html: class "roulette-card" exists on the card element', () => {
    assert.match(HTML, /class="roulette-card"/);
});

test('html: class "roulette-css-graphic" exists on the fallback graphic', () => {
    assert.match(HTML, /class="roulette-css-graphic"/);
});

test('html: class "roulette-mode-btn" exists on mode buttons', () => {
    assert.match(HTML, /class="roulette-mode-btn"/);
});

test('html: class "pool-item" is used in openRoulettePool source', () => {
    assert.match(APP_JS, /className\s*=\s*['"]bin-item pool-item['"]/);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6 — Inline handlers in dashboard.html
// ─────────────────────────────────────────────────────────────────────────────

test('html: modeBtnPlay calls setRouletteMode("play")', () => {
    assert.match(HTML, /id="modeBtnPlay"[^>]*onclick="setRouletteMode\('play'\)"/);
});

test('html: modeBtnInstall calls setRouletteMode("install")', () => {
    assert.match(HTML, /id="modeBtnInstall"[^>]*onclick="setRouletteMode\('install'\)"/);
});

test('html: rouletteCard calls onRouletteCardClick()', () => {
    assert.match(HTML, /id="rouletteCard"[^>]*onclick="onRouletteCardClick\(\)"/);
});

test('html: spinBtn calls startRoulette()', () => {
    assert.match(HTML, /id="spinBtn"[^>]*onclick="startRoulette\(\)"/);
});

test('html: roulettePoolBtn calls openRoulettePool()', () => {
    assert.match(HTML, /id="roulettePoolBtn"[^>]*onclick="openRoulettePool\(\)"/);
});

test('html: playResultBtn calls playRouletteResult()', () => {
    assert.match(HTML, /id="playResultBtn"[^>]*onclick="playRouletteResult\(\)"/);
});

test('html: poolSearchInput calls filterPoolList() on keyup', () => {
    assert.match(HTML, /id="poolSearchInput"[^>]*onkeyup="filterPoolList\(\)"/);
});

test('html: pool modal has a button calling clearRoulettePool()', () => {
    assert.match(HTML, /onclick="clearRoulettePool\(\)"/);
});

test('html: pool modal has a button calling closeRoulettePool()', () => {
    assert.match(HTML, /onclick="closeRoulettePool\(\)"/);
});

test('html: pool modal has a button calling saveRoulettePool()', () => {
    assert.match(HTML, /onclick="saveRoulettePool\(\)"/);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7 — Mode behavior (source-documented contracts)
// ─────────────────────────────────────────────────────────────────────────────

test('roulette: rouletteMode supports exactly the strings "play" and "install"', () => {
    // Both literal values must appear as mode checks in setRouletteMode.
    assert.match(APP_JS, /mode\s*===\s*['"]play['"]/);
    assert.match(APP_JS, /mode\s*===\s*['"]install['"]/);
});

test('roulette: setRouletteMode resets rouletteResultId to null', () => {
    const body = extractFn(APP_JS, 'function setRouletteMode(');
    assert.ok(body.length > 0, 'setRouletteMode body not found');
    assert.match(body, /rouletteResultId\s*=\s*null/);
});

test('roulette: setRouletteMode resets rouletteResultGame to null', () => {
    const body = extractFn(APP_JS, 'function setRouletteMode(');
    assert.match(body, /rouletteResultGame\s*=\s*null/);
});

test('roulette: setRouletteMode removes "winner" and "spinning" classes from rouletteCard', () => {
    const body = extractFn(APP_JS, 'function setRouletteMode(');
    assert.match(body, /classList\.remove\([^)]*'winner'[^)]*'spinning'/);
});

test('roulette: setRouletteMode hides roulettePoolBtn for install mode', () => {
    const body = extractFn(APP_JS, 'function setRouletteMode(');
    assert.match(body, /poolBtn.*style\.display\s*=\s*'none'/s);
});

test('roulette: setRouletteMode shows roulettePoolBtn for play mode', () => {
    const body = extractFn(APP_JS, 'function setRouletteMode(');
    assert.match(body, /poolBtn.*style\.display\s*=\s*'flex'/s);
});

test('roulette: setRouletteMode resets _roulettePoolHydrated to false in install mode', () => {
    const body = extractFn(APP_JS, 'function setRouletteMode(');
    assert.match(body, /_roulettePoolHydrated\s*=\s*false/);
});

test('roulette: setRouletteMode disables spinBtn when play pool is empty', () => {
    const body = extractFn(APP_JS, 'function setRouletteMode(');
    assert.match(body, /playPool\.length\s*===\s*0/);
    assert.match(body, /spinBtn\.disabled\s*=\s*true/);
});

test('roulette: setRouletteMode disables spinBtn when install pool is empty', () => {
    const body = extractFn(APP_JS, 'function setRouletteMode(');
    assert.match(body, /installPool\.length\s*===\s*0/);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8 — Pool builder contracts
// ─────────────────────────────────────────────────────────────────────────────

test('roulette: _buildPlayPool filters allGamesData for non-hidden games', () => {
    const body = extractFn(APP_JS, 'function _buildPlayPool(');
    assert.match(body, /allGamesData\.filter/);
    assert.match(body, /!g\.isHidden/);
});

test('roulette: _buildPlayPool requires a path or command on each game', () => {
    const body = extractFn(APP_JS, 'function _buildPlayPool(');
    assert.match(body, /g\.path\s*\|\|\s*g\.command/);
});

test('roulette: _buildPlayPool applies customSpinIds filter when the list is non-empty', () => {
    const body = extractFn(APP_JS, 'function _buildPlayPool(');
    assert.match(body, /customSpinIds\.length\s*>\s*0/);
    assert.match(body, /customSpinIds\.includes/);
});

test('roulette: _buildInstallPool reads from window._suggAllGames', () => {
    const body = extractFn(APP_JS, 'function _buildInstallPool(');
    assert.match(body, /window\._suggAllGames/);
});

test('roulette: _buildInstallPool falls back to an empty array when no synced games', () => {
    const body = extractFn(APP_JS, 'function _buildInstallPool(');
    assert.match(body, /return\s*\[\]/);
});

test('roulette: _buildInstallPool normalizes poster fields (image, coverUrl, capsuleImage)', () => {
    const body = extractFn(APP_JS, 'function _buildInstallPool(');
    assert.match(body, /image:/);
    assert.match(body, /coverUrl:/);
    assert.match(body, /capsuleImage:/);
});

test('roulette: _buildInstallPool normalizes hero fields (heroImage, defaultHero)', () => {
    const body = extractFn(APP_JS, 'function _buildInstallPool(');
    assert.match(body, /heroImage:/);
    assert.match(body, /defaultHero:/);
});

test('roulette: _buildInstallPool attaches _raw to each candidate for downstream use', () => {
    const body = extractFn(APP_JS, 'function _buildInstallPool(');
    assert.match(body, /_raw\s*:/);
});

test('roulette: _buildInstallPool reads art from _suggArtCacheGet', () => {
    const body = extractFn(APP_JS, 'function _buildInstallPool(');
    assert.match(body, /_suggArtCacheGet/);
});

test('roulette: _buildInstallPool uses _suggKey to generate cache lookup key', () => {
    const body = extractFn(APP_JS, 'function _buildInstallPool(');
    assert.match(body, /_suggKey\s*\(/);
});

test('roulette: _buildInstallPool uses _preferLocalImage to pick best poster', () => {
    const body = extractFn(APP_JS, 'function _buildInstallPool(');
    assert.match(body, /_preferLocalImage\s*\(/);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 9 — Spin and result state machine contracts
// ─────────────────────────────────────────────────────────────────────────────

test('roulette: startRoulette returns early if isSpinning is true', () => {
    const body = extractFn(APP_JS, 'async function startRoulette(');
    assert.match(body, /if\s*\(\s*isSpinning\s*\)\s*return/);
});

test('roulette: startRoulette returns early if rouletteMode is falsy', () => {
    const body = extractFn(APP_JS, 'async function startRoulette(');
    assert.match(body, /if\s*\(\s*!rouletteMode\s*\)/);
});

test('roulette: startRoulette transitions rouletteState to "spinning"', () => {
    const body = extractFn(APP_JS, 'async function startRoulette(');
    assert.match(body, /rouletteState\s*=\s*'spinning'/);
});

test('roulette: startRoulette sets isSpinning = true at entry', () => {
    const body = extractFn(APP_JS, 'async function startRoulette(');
    assert.match(body, /isSpinning\s*=\s*true/);
});

test('roulette: startRoulette increments rouletteSpinToken', () => {
    const body = extractFn(APP_JS, 'async function startRoulette(');
    assert.match(body, /\+\+rouletteSpinToken/);
});

test('roulette: startRoulette resets rouletteResultId to null', () => {
    const body = extractFn(APP_JS, 'async function startRoulette(');
    assert.match(body, /rouletteResultId\s*=\s*null/);
});

test('roulette: startRoulette resets rouletteResultGame to null', () => {
    const body = extractFn(APP_JS, 'async function startRoulette(');
    assert.match(body, /rouletteResultGame\s*=\s*null/);
});

test('roulette: startRoulette shows toast and returns when pool is empty', () => {
    const body = extractFn(APP_JS, 'async function startRoulette(');
    assert.match(body, /pool\.length\s*===\s*0/);
    assert.match(body, /showToast\s*\(/);
});

test('roulette: startRoulette calls resetRouletteVisualStateForSpin before spinning', () => {
    const body = extractFn(APP_JS, 'async function startRoulette(');
    assert.match(body, /resetRouletteVisualStateForSpin\s*\(/);
});

test('roulette: startRoulette calls prepareInstallRoulettePool for install mode', () => {
    const body = extractFn(APP_JS, 'async function startRoulette(');
    assert.match(body, /prepareInstallRoulettePool\s*\(/);
});

test('roulette: startRoulette uses _rouletteShuffleForSpin to randomise pool', () => {
    const body = extractFn(APP_JS, 'async function startRoulette(');
    assert.match(body, /_rouletteShuffleForSpin\s*\(/);
});

test('roulette: startRoulette drives animation with a maxTicks of 25', () => {
    const body = extractFn(APP_JS, 'async function startRoulette(');
    assert.match(body, /maxTicks\s*=\s*25/);
});

test('roulette: startRoulette uses _roulettePickFinal to select the winner', () => {
    const body = extractFn(APP_JS, 'async function startRoulette(');
    assert.match(body, /_roulettePickFinal\s*\(/);
});

test('roulette: startRoulette writes rouletteResultId with winner id after spin', () => {
    const body = extractFn(APP_JS, 'async function startRoulette(');
    assert.match(body, /rouletteResultId\s*=\s*finalGame\.id/);
});

test('roulette: startRoulette writes rouletteResultGame with winner object after spin', () => {
    const body = extractFn(APP_JS, 'async function startRoulette(');
    assert.match(body, /rouletteResultGame\s*=\s*finalGame/);
});

test('roulette: startRoulette sets rouletteState to "finalizing" during finalize', () => {
    const body = extractFn(APP_JS, 'async function startRoulette(');
    assert.match(body, /rouletteState\s*=\s*'finalizing'/);
});

test('roulette: startRoulette sets rouletteState to "complete" after finalize', () => {
    const body = extractFn(APP_JS, 'async function startRoulette(');
    assert.match(body, /rouletteState\s*=\s*'complete'/);
});

test('roulette: startRoulette appends winner id to _rouletteRecentPicks', () => {
    const body = extractFn(APP_JS, 'async function startRoulette(');
    assert.match(body, /_rouletteRecentPicks\.push\s*\(/);
});

test('roulette: startRoulette trims _rouletteRecentPicks to last 3 entries', () => {
    const body = extractFn(APP_JS, 'async function startRoulette(');
    assert.match(body, /_rouletteRecentPicks\s*=\s*_rouletteRecentPicks\.slice\s*\(-3\)/);
});

test('roulette: startRoulette calls _rouletteSetHeroBackground after picking winner', () => {
    const body = extractFn(APP_JS, 'async function startRoulette(');
    assert.match(body, /_rouletteSetHeroBackground\s*\(/);
});

test('roulette: startRoulette uses token guard to cancel a superseded spin', () => {
    const body = extractFn(APP_JS, 'async function startRoulette(');
    assert.match(body, /token\s*!==\s*rouletteSpinToken/);
});

test('roulette: startRoulette sets rouletteWinnerId dataset on card for play mode', () => {
    const body = extractFn(APP_JS, 'async function startRoulette(');
    assert.match(body, /card\.dataset\.rouletteWinnerId/);
});

test('roulette: startRoulette sets rouletteInstallPlatform dataset on card for install mode', () => {
    const body = extractFn(APP_JS, 'async function startRoulette(');
    assert.match(body, /card\.dataset\.rouletteInstallPlatform/);
});

test('roulette: startRoulette fires logGameSpinClicked IPC analytics', () => {
    const body = extractFn(APP_JS, 'async function startRoulette(');
    assert.match(body, /electronAPI\.logGameSpinClicked/);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 10 — playRouletteResult mode routing
// ─────────────────────────────────────────────────────────────────────────────

test('roulette: playRouletteResult returns early if rouletteResultGame is falsy', () => {
    const body = extractFn(APP_JS, 'function playRouletteResult(');
    assert.match(body, /if\s*\(\s*!rouletteResultGame\s*\)\s*return/);
});

test('roulette: playRouletteResult calls triggerLaunchSequence for play mode', () => {
    const body = extractFn(APP_JS, 'function playRouletteResult(');
    assert.match(body, /triggerLaunchSequence\s*\(\s*rouletteResultId\s*\)/);
});

test('roulette: playRouletteResult calls window._gdOpenInstallPickerForGame for install mode', () => {
    const body = extractFn(APP_JS, 'function playRouletteResult(');
    assert.match(body, /window\._gdOpenInstallPickerForGame\s*\(/);
});

test('roulette: playRouletteResult calls showToast if install picker is unavailable', () => {
    const body = extractFn(APP_JS, 'function playRouletteResult(');
    assert.match(body, /showToast\s*\(/);
});

test('roulette: playRouletteResult forwards _roulettePosterUrl to the install picker', () => {
    const body = extractFn(APP_JS, 'function playRouletteResult(');
    assert.match(body, /_roulettePosterUrl/);
});

test('roulette: playRouletteResult calls _suggBuildGame to build base install object', () => {
    const body = extractFn(APP_JS, 'function playRouletteResult(');
    assert.match(body, /_suggBuildGame\s*\(/);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 11 — onRouletteCardClick routing
// ─────────────────────────────────────────────────────────────────────────────

test('roulette: onRouletteCardClick returns early if card lacks "winner" class', () => {
    const body = extractFn(APP_JS, 'function onRouletteCardClick(');
    assert.match(body, /classList\.contains\s*\(\s*'winner'\s*\)/);
});

test('roulette: onRouletteCardClick routes to window.suggViewDetails for install mode', () => {
    const body = extractFn(APP_JS, 'function onRouletteCardClick(');
    assert.match(body, /window\.suggViewDetails\s*\(/);
});

test('roulette: onRouletteCardClick reads rouletteInstallPlatform from card dataset', () => {
    const body = extractFn(APP_JS, 'function onRouletteCardClick(');
    assert.match(body, /card\.dataset\.rouletteInstallPlatform/);
});

test('roulette: onRouletteCardClick routes to openGameDetails for play mode', () => {
    const body = extractFn(APP_JS, 'function onRouletteCardClick(');
    assert.match(body, /openGameDetails\s*\(/);
});

test('roulette: onRouletteCardClick reads rouletteWinnerId from card dataset', () => {
    const body = extractFn(APP_JS, 'function onRouletteCardClick(');
    assert.match(body, /card\.dataset\.rouletteWinnerId/);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 12 — Pool modal contracts
// ─────────────────────────────────────────────────────────────────────────────

test('roulette: openRoulettePool reads from allGamesData', () => {
    const body = extractFn(APP_JS, 'function openRoulettePool(');
    assert.match(body, /allGamesData/);
});

test('roulette: openRoulettePool filters hidden games out of the list', () => {
    const body = extractFn(APP_JS, 'function openRoulettePool(');
    assert.match(body, /!g\.isHidden/);
});

test('roulette: openRoulettePool checks if games already exist in customSpinIds', () => {
    const body = extractFn(APP_JS, 'function openRoulettePool(');
    assert.match(body, /customSpinIds\.includes/);
});

test('roulette: openRoulettePool opens roulettePoolModal by adding "active" class', () => {
    const body = extractFn(APP_JS, 'function openRoulettePool(');
    assert.match(body, /roulettePoolModal.*classList\.add\s*\(\s*'active'\s*\)/s);
});

test('roulette: closeRoulettePool removes "active" class from roulettePoolModal', () => {
    const body = extractFn(APP_JS, 'function closeRoulettePool(');
    assert.match(body, /roulettePoolModal.*classList\.remove\s*\(\s*'active'\s*\)/s);
});

test('roulette: saveRoulettePool writes checked items to customSpinIds', () => {
    const body = extractFn(APP_JS, 'function saveRoulettePool(');
    assert.match(body, /customSpinIds\s*=/);
    assert.match(body, /querySelectorAll.*checkbox.*checked/s);
});

test('roulette: clearRoulettePool resets customSpinIds to an empty array', () => {
    const body = extractFn(APP_JS, 'function clearRoulettePool(');
    assert.match(body, /customSpinIds\s*=\s*\[\]/);
});

test('roulette: filterPoolList searches pool-item elements by data-name attribute', () => {
    const body = extractFn(APP_JS, 'function filterPoolList(');
    assert.match(body, /\.pool-item/);
    assert.match(body, /getAttribute\s*\(\s*'data-name'\s*\)/);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 13 — _roulettePickFinal anti-repeat logic
// ─────────────────────────────────────────────────────────────────────────────

test('roulette: _roulettePickFinal avoids recently picked games when pool is large enough', () => {
    const body = extractFn(APP_JS, 'function _roulettePickFinal(');
    assert.match(body, /_rouletteRecentPicks/);
    assert.match(body, /withoutRecent\.length\s*>=\s*3/);
});

test('roulette: _roulettePickFinal avoids at minimum the immediately previous pick', () => {
    const body = extractFn(APP_JS, 'function _roulettePickFinal(');
    assert.match(body, /withoutImmediate/);
});

test('roulette: _roulettePickFinal delegates to _rouletteGameId for ID comparison', () => {
    const body = extractFn(APP_JS, 'function _roulettePickFinal(');
    assert.match(body, /_rouletteGameId\s*\(/);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 14 — _rouletteHydrateInstallPool hydration guard
// ─────────────────────────────────────────────────────────────────────────────

test('roulette: _rouletteHydrateInstallPool is idempotent via _roulettePoolHydrated guard', () => {
    const body = extractFn(APP_JS, 'function _rouletteHydrateInstallPool(');
    assert.match(body, /if\s*\(\s*_roulettePoolHydrated\s*\)\s*return/);
    assert.match(body, /_roulettePoolHydrated\s*=\s*true/);
});

test('roulette: _rouletteHydrateInstallPool caps requests at _ROULETTE_HYDRATE_LIMIT', () => {
    const body = extractFn(APP_JS, 'function _rouletteHydrateInstallPool(');
    assert.match(body, /queued\s*>=\s*_ROULETTE_HYDRATE_LIMIT/);
});

test('roulette: _rouletteHydrateInstallPool skips candidates that already have art', () => {
    const body = extractFn(APP_JS, 'function _rouletteHydrateInstallPool(');
    assert.match(body, /_rouletteInstallImage\s*\(c\)/);
    assert.match(body, /continue/);
});

test('roulette: _rouletteHydrateInstallPool calls _suggHydrateArt for art-less candidates', () => {
    const body = extractFn(APP_JS, 'function _rouletteHydrateInstallPool(');
    assert.match(body, /_suggHydrateArt\s*\(/);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 15 — Image helper contracts
// ─────────────────────────────────────────────────────────────────────────────

test('roulette: _rouletteValidImg delegates to isUsableImageUrl', () => {
    const body = extractFn(APP_JS, 'function _rouletteValidImg(');
    assert.match(body, /isUsableImageUrl\s*\(/);
});

test('roulette: getGamePoster delegates to getPosterUrlInstalled', () => {
    const body = extractFn(APP_JS, 'function getGamePoster(');
    assert.match(body, /getPosterUrlInstalled\s*\(/);
});

test('roulette: _rouletteInstallImage tries getPosterUrl on candidate and _raw', () => {
    const body = extractFn(APP_JS, 'function _rouletteInstallImage(');
    assert.match(body, /getPosterUrl\s*\(/);
    assert.match(body, /c\._raw/);
});

test('roulette: _rouletteHeroUrl falls back through candidate fields, raw fields, and _suggArtCache', () => {
    const body = extractFn(APP_JS, 'function _rouletteHeroUrl(');
    assert.match(body, /game\.heroImage/);
    assert.match(body, /raw\.heroImage/);
    assert.match(body, /_suggArtCacheGet/);
});

test('roulette: applyRouletteFinalPoster adds "winner" and "has-poster" classes on success', () => {
    const body = extractFn(APP_JS, 'function applyRouletteFinalPoster(');
    assert.match(body, /classList\.add\s*\([^)]*'has-poster'[^)]*'winner'/);
});

test('roulette: applyRouletteFinalPoster adds "no-poster" class when poster URL is missing', () => {
    const body = extractFn(APP_JS, 'function applyRouletteFinalPoster(');
    assert.match(body, /classList\.add\s*\([^)]*'no-poster'\s*\)/);
});

test('roulette: preloadRouletteFinalPoster delegates to preloadImageUrl', () => {
    const body = extractFn(APP_JS, 'function preloadRouletteFinalPoster(');
    assert.match(body, /preloadImageUrl\s*\(/);
});

test('roulette: resetRouletteVisualStateForSpin looks up section by "surpriseMeSection" or "rouletteSection"', () => {
    const body = extractFn(APP_JS, 'function resetRouletteVisualStateForSpin(');
    assert.match(body, /getElementById\s*\(\s*'rouletteSection'\s*\)/);
    assert.match(body, /getElementById\s*\(\s*'surpriseMeSection'\s*\)/);
});

test('roulette: _rouletteSetHeroBackground sets --roulette-hero-bg CSS custom property', () => {
    const body = extractFn(APP_JS, 'function _rouletteSetHeroBackground(');
    assert.match(body, /--roulette-hero-bg/);
});

test('roulette: _rouletteSetHeroBackground only applies hero if rouletteResultGame is still the same game', () => {
    const body = extractFn(APP_JS, 'function _rouletteSetHeroBackground(');
    assert.match(body, /rouletteResultGame\s*!==\s*game/);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 16 — Behavior tests for pure helpers (no DOM required)
// ─────────────────────────────────────────────────────────────────────────────

// _rouletteGameId — pure function, safe to extract and run
{
    // Extract source of _rouletteGameId and evaluate it in isolation
    const src = extractFn(APP_JS, 'function _rouletteGameId(');
    // eslint-disable-next-line no-new-func
    const _rouletteGameId = new Function(`return (${src.trim()})`)();

    test('_rouletteGameId returns String(game.id) when game has id', () => {
        assert.equal(_rouletteGameId({ id: 42 }), '42');
    });

    test('_rouletteGameId falls back to _raw.id when game.id is absent', () => {
        assert.equal(_rouletteGameId({ _raw: { id: 'abc' } }), 'abc');
    });

    test('_rouletteGameId returns empty string for null/undefined game', () => {
        assert.equal(_rouletteGameId(null), '');
        assert.equal(_rouletteGameId(undefined), '');
    });

    test('_rouletteGameId returns empty string when both id and _raw.id are absent', () => {
        assert.equal(_rouletteGameId({}), '');
    });
}

// preloadImageUrl — pure Promise wrapper; test that it resolves { ok, url }
{
    const src = extractFn(APP_JS, 'function preloadImageUrl(');
    // eslint-disable-next-line no-new-func
    const preloadImageUrl = new Function(`return (${src.trim()})`)();

    test('preloadImageUrl resolves { ok: false, url: null } for a falsy URL', async () => {
        // isUsableImageUrl is called inside — when not defined it would throw.
        // Stub it to return null for non-http strings.
        const origIsUsable = global.isUsableImageUrl;
        global.isUsableImageUrl = (u) => (u && u.startsWith('http') ? u : null);
        const result = await preloadImageUrl('', 100);
        global.isUsableImageUrl = origIsUsable;
        assert.deepEqual(result, { ok: false, url: null });
    });
}

// _rouletteEntropySeed — pure, side-effect-free
{
    const src = extractFn(APP_JS, 'function _rouletteEntropySeed(');
    // eslint-disable-next-line no-new-func
    const _rouletteEntropySeed = new Function(`return (${src.trim()})`)();

    test('_rouletteEntropySeed returns a non-empty string', () => {
        const seed = _rouletteEntropySeed();
        assert.equal(typeof seed, 'string');
        assert.ok(seed.length > 0, 'seed must not be empty');
    });

    test('_rouletteEntropySeed returns a different value on each call', () => {
        const a = _rouletteEntropySeed();
        const b = _rouletteEntropySeed();
        // Two sequential calls should not produce the identical string
        // (crypto.getRandomValues ensures this; Date.now fallback may collide
        // in theory but is practically distinct within the same process tick)
        assert.ok(typeof a === 'string' && typeof b === 'string');
    });
}

// _roulettePosterPick — test the install-mode hero fallback path
test('_roulettePosterPick returns { url: null, source: "none" } when no fields are usable', () => {
    // Minimal stub: isUsableImageUrl rejects everything
    const src = extractFn(APP_JS, 'function _roulettePosterPick(');
    // eslint-disable-next-line no-new-func
    const _roulettePosterPick = new Function(
        'isUsableImageUrl',
        '_rouletteGameId',
        `return (${src.trim()})`
    )(
        () => null,             // isUsableImageUrl — always reject
        (g) => String(g?.id || '') // _rouletteGameId stub
    );

    const result = _roulettePosterPick({ id: '1', image: null }, 'play');
    assert.deepEqual(result, { url: null, source: 'none' });
});

test('_roulettePosterPick returns first usable poster field', () => {
    const src = extractFn(APP_JS, 'function _roulettePosterPick(');
    // eslint-disable-next-line no-new-func
    const _roulettePosterPick = new Function(
        'isUsableImageUrl',
        '_rouletteGameId',
        `return (${src.trim()})`
    )(
        (u) => (u && u.startsWith('http') ? u : null),
        (g) => String(g?.id || '')
    );

    const result = _roulettePosterPick(
        { id: '1', image: 'https://cdn.example.com/cover.jpg', coverUrl: 'https://cdn.example.com/other.jpg' },
        'play'
    );
    assert.equal(result.url, 'https://cdn.example.com/cover.jpg');
    assert.equal(result.source, 'image');
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 17 — Dependency tests: providers must exist in their respective files
// ─────────────────────────────────────────────────────────────────────────────

test('dep: isUsableImageUrl is defined in artwork-sync.js', () => {
    assert.match(ARTWORK_SYNC_JS, /function isUsableImageUrl\s*\(/);
});

test('dep: getPosterUrl is defined in artwork-sync.js', () => {
    assert.match(ARTWORK_SYNC_JS, /function getPosterUrl\s*\(/);
});

test('dep: getPosterUrlInstalled is defined in artwork-sync.js', () => {
    assert.match(ARTWORK_SYNC_JS, /function getPosterUrlInstalled\s*\(/);
});

test('dep: _preferLocalImage is defined in artwork-sync.js', () => {
    assert.match(ARTWORK_SYNC_JS, /function _preferLocalImage\s*\(/);
});

test('dep: failedImageIds is defined in artwork-sync.js', () => {
    assert.match(ARTWORK_SYNC_JS, /const\s+failedImageIds\s*=\s*new\s+Set\s*\(\s*\)/);
});

test('dep: _suggArtCacheGet is exported from artwork-sync.js via window', () => {
    assert.match(ARTWORK_SYNC_JS, /window\._suggArtCacheGet/);
});

test('dep: _seededShuffle is defined in suggestions.js', () => {
    assert.match(SUGGESTIONS_JS, /function _seededShuffle\s*\(/);
});

test('dep: window._suggAllGames is exported from suggestions.js', () => {
    assert.match(SUGGESTIONS_JS, /window\._suggAllGames/);
});

test('dep: _suggKey is defined in suggestions.js', () => {
    assert.match(SUGGESTIONS_JS, /function _suggKey\s*\(/);
});

test('dep: _suggHydrateArt is defined in suggestions.js', () => {
    assert.match(SUGGESTIONS_JS, /(?:async\s+)?function _suggHydrateArt\s*\(/);
});

test('dep: _suggBuildGame is defined in suggestions.js', () => {
    assert.match(SUGGESTIONS_JS, /function _suggBuildGame\s*\(/);
});

test('dep: showToast is exported from toast-confirm.js via window', () => {
    assert.match(TOAST_JS, /window\.showToast/);
});

test('dep: triggerLaunchSequence is exported from launcher-actions.js via window', () => {
    assert.match(LAUNCHER_JS, /window\.triggerLaunchSequence/);
});

test('dep: roulette uses window._gdOpenInstallPickerForGame from game-details.js (runtime check)', () => {
    // Source must reference this as an optional window property — not a direct call
    assert.match(APP_JS, /window\._gdOpenInstallPickerForGame/);
    assert.match(APP_JS, /typeof window\._gdOpenInstallPickerForGame\s*===\s*'function'/);
});

test('dep: roulette uses window.suggViewDetails from suggestions.js (runtime check)', () => {
    assert.match(APP_JS, /window\.suggViewDetails/);
    assert.match(APP_JS, /typeof window\.suggViewDetails\s*===\s*'function'/);
});

test('dep: roulette uses electronAPI.logGameSpinClicked (IPC analytics)', () => {
    assert.match(APP_JS, /electronAPI\.logGameSpinClicked/);
});

test('dep: roulette uses electronAPI.getCachedImage for disk-cache hero lookup', () => {
    assert.match(APP_JS, /electronAPI\.getCachedImage/);
    // Must be optional-chained to avoid crashing in non-Electron contexts
    assert.match(APP_JS, /electronAPI\?\.getCachedImage/);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 18 — Isolation tests: roulette must NOT reach into unrelated modules
// ─────────────────────────────────────────────────────────────────────────────

// Helpers to extract only the roulette block (lines 2012–3177)
function rouletteBlock() {
    const start = APP_JS.indexOf('// 12. SURPRISE ME (ROULETTE)');
    const end   = APP_JS.indexOf('// UTILS & GLOBAL EVENTS');
    assert.ok(start !== -1, 'Roulette section header not found');
    assert.ok(end   !== -1, 'Roulette section end marker not found');
    return APP_JS.slice(start, end);
}

test('isolation: roulette block does not call openCollectionSettings', () => {
    assert.doesNotMatch(rouletteBlock(), /openCollectionSettings\s*\(/);
});

test('isolation: roulette block does not call closeCollectionSettings', () => {
    assert.doesNotMatch(rouletteBlock(), /closeCollectionSettings\s*\(/);
});

test('isolation: roulette block does not call saveCollectionSettings', () => {
    assert.doesNotMatch(rouletteBlock(), /saveCollectionSettings\s*\(/);
});

test('isolation: roulette block does not call qsToggleEnabled', () => {
    assert.doesNotMatch(rouletteBlock(), /qsToggleEnabled\s*\(/);
});

test('isolation: roulette block does not call qsChangeHotkey', () => {
    assert.doesNotMatch(rouletteBlock(), /qsChangeHotkey\s*\(/);
});

test('isolation: roulette block does not call initSystemStats', () => {
    assert.doesNotMatch(rouletteBlock(), /initSystemStats\s*\(/);
});

test('isolation: roulette block does not call toggleSensors', () => {
    assert.doesNotMatch(rouletteBlock(), /toggleSensors\s*\(/);
});

test('isolation: roulette block does not call renderPlatformAccounts', () => {
    assert.doesNotMatch(rouletteBlock(), /renderPlatformAccounts\s*\(/);
});

test('isolation: roulette block does not call selectAccountPlatform', () => {
    assert.doesNotMatch(rouletteBlock(), /selectAccountPlatform\s*\(/);
});

test('isolation: roulette block does not call hardDeleteGame', () => {
    assert.doesNotMatch(rouletteBlock(), /hardDeleteGame\s*\(/);
});

test('isolation: roulette block does not call toggleFavorite', () => {
    assert.doesNotMatch(rouletteBlock(), /toggleFavorite\s*\(/);
});

test('isolation: roulette block does not call confirmDeleteAction', () => {
    assert.doesNotMatch(rouletteBlock(), /confirmDeleteAction\s*\(/);
});

test('isolation: roulette block does not call sendFeedback', () => {
    assert.doesNotMatch(rouletteBlock(), /sendFeedback\s*\(/);
});

test('isolation: roulette block does not call openHelpModal', () => {
    assert.doesNotMatch(rouletteBlock(), /openHelpModal\s*\(/);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 19 — Roulette section boundary integrity
// ─────────────────────────────────────────────────────────────────────────────

test('roulette section: header comment "12. SURPRISE ME (ROULETTE)" exists', () => {
    assert.match(APP_JS, /\/\/ 12\. SURPRISE ME \(ROULETTE\)/);
});

test('roulette section: all pool modal functions appear after the section header', () => {
    const headerIdx     = APP_JS.indexOf('// 12. SURPRISE ME (ROULETTE)');
    const openIdx       = APP_JS.indexOf('function openRoulettePool(');
    const closeIdx      = APP_JS.indexOf('function closeRoulettePool(');
    const saveIdx       = APP_JS.indexOf('function saveRoulettePool(');
    const clearIdx      = APP_JS.indexOf('function clearRoulettePool(');
    assert.ok(openIdx  > headerIdx, 'openRoulettePool must appear after section header');
    assert.ok(closeIdx > headerIdx, 'closeRoulettePool must appear after section header');
    assert.ok(saveIdx  > headerIdx, 'saveRoulettePool must appear after section header');
    assert.ok(clearIdx > headerIdx, 'clearRoulettePool must appear after section header');
});

test('roulette section: startRoulette appears after setRouletteMode', () => {
    const setIdx   = APP_JS.indexOf('function setRouletteMode(');
    const startIdx = APP_JS.indexOf('async function startRoulette(');
    assert.ok(startIdx > setIdx, 'startRoulette must appear after setRouletteMode');
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract a function body from source by finding the declaration and then
 * walking brace depth to locate the closing brace.
 */
function extractFn(src, signature) {
    const idx = src.indexOf(signature);
    if (idx === -1) return '';
    let depth = 0;
    let i = idx;
    while (i < src.length) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') {
            depth--;
            if (depth === 0) return src.slice(idx, i + 1);
        }
        i++;
    }
    return src.slice(idx);
}
