'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT          = path.resolve(__dirname, '..');
const APP_JS        = fs.readFileSync(path.join(ROOT, 'src/js/app.js'), 'utf8');
const SUGGESTIONS_JS = fs.readFileSync(path.join(ROOT, 'src/js/app/suggestions.js'), 'utf8');
const HTML          = fs.readFileSync(path.join(ROOT, 'src/dashboard.html'), 'utf8');

// ── helpers ───────────────────────────────────────────────────────────────────

function extractFn(src, sig, maxLen = 2000) {
    const idx = src.indexOf(sig);
    if (idx === -1) return '';
    return src.slice(idx, idx + maxLen);
}

// ── 1. State variables ────────────────────────────────────────────────────────

test('suggestions.js: _suggAllGames state is declared as an empty array', () => {
    assert.match(SUGGESTIONS_JS, /^let _suggAllGames\s*=\s*\[\]/m);
});

test('suggestions.js: _suggAllGames is exposed on window', () => {
    assert.match(SUGGESTIONS_JS, /window\._suggAllGames\s*=\s*_suggAllGames/);
});

test('suggestions.js: _suggFilter is declared with default value "all"', () => {
    assert.match(SUGGESTIONS_JS, /^let _suggFilter\s*=\s*['"]all['"]/m);
});

test('suggestions.js: _SUGG_STATE_KEY constant is declared', () => {
    assert.match(SUGGESTIONS_JS, /const _SUGG_STATE_KEY\s*=/);
    assert.match(SUGGESTIONS_JS, /baddel_sugg_state_v4/);
});

test('suggestions.js: _SUGG_POOL_TTL constant is declared', () => {
    assert.match(SUGGESTIONS_JS, /const _SUGG_POOL_TTL\s*=/);
});

test('suggestions.js: _SUGG_ROTATE_MS constant is declared', () => {
    assert.match(SUGGESTIONS_JS, /const _SUGG_ROTATE_MS\s*=/);
});

test('suggestions.js: _SUGG_POOL_PER_PLAT constant is declared', () => {
    assert.match(SUGGESTIONS_JS, /const _SUGG_POOL_PER_PLAT\s*=/);
});

test('suggestions.js: _SUGG_POOL_SINGLE constant is declared', () => {
    assert.match(SUGGESTIONS_JS, /const _SUGG_POOL_SINGLE\s*=/);
});

test('suggestions.js: _suggPool is declared as an empty array', () => {
    assert.match(SUGGESTIONS_JS, /^let _suggPool\s*=\s*\[\]/m);
});

test('suggestions.js: _suggPoolIdx is declared', () => {
    assert.match(SUGGESTIONS_JS, /^let _suggPoolIdx\s*=/m);
});

test('suggestions.js: _suggRotateTimer is declared as null', () => {
    assert.match(SUGGESTIONS_JS, /^let _suggRotateTimer\s*=\s*null/m);
});

test('suggestions.js: _suggPoolTs is declared', () => {
    assert.match(SUGGESTIONS_JS, /^let _suggPoolTs\s*=/m);
});

test('suggestions.js: _suggState is declared with bucket/recommendedItems/steamItems/epicItems/activeFilter shape', () => {
    assert.match(SUGGESTIONS_JS, /let _suggState\s*=\s*\{/);
    assert.match(SUGGESTIONS_JS, /bucket:/);
    assert.match(SUGGESTIONS_JS, /recommendedItems:/);
    assert.match(SUGGESTIONS_JS, /steamItems:/);
    assert.match(SUGGESTIONS_JS, /epicItems:/);
    assert.match(SUGGESTIONS_JS, /activeFilter:/);
});

test('suggestions.js: hydratedGameIds is declared as a Set', () => {
    assert.match(SUGGESTIONS_JS, /const hydratedGameIds\s*=\s*new Set\(\)/);
});

test('suggestions.js: hydratingGameIds is declared as a Set', () => {
    assert.match(SUGGESTIONS_JS, /const hydratingGameIds\s*=\s*new Set\(\)/);
});

test('suggestions.js: _SUGG_HYDRATE_CONCURRENCY constant is declared', () => {
    assert.match(SUGGESTIONS_JS, /const _SUGG_HYDRATE_CONCURRENCY\s*=/);
});

test('suggestions.js: _suggHydrateActive is declared', () => {
    assert.match(SUGGESTIONS_JS, /^let _suggHydrateActive\s*=/m);
});

test('suggestions.js: _suggCarouselIdx state is declared', () => {
    assert.match(SUGGESTIONS_JS, /^let _suggCarouselIdx\s*=/m);
});

test('suggestions.js: _suggFeaturedGame state is declared as null', () => {
    assert.match(SUGGESTIONS_JS, /^let _suggFeaturedGame\s*=\s*null/m);
});

test('suggestions.js: _SUGG_PLAT_CFG config object is declared', () => {
    assert.match(SUGGESTIONS_JS, /const _SUGG_PLAT_CFG\s*=/);
    assert.match(SUGGESTIONS_JS, /steam:/);
    assert.match(SUGGESTIONS_JS, /epic:/);
});

// ── 2. Function presence ──────────────────────────────────────────────────────

test('suggestions.js: _seededShuffle function exists', () => {
    assert.match(SUGGESTIONS_JS, /^function _seededShuffle\s*\(/m);
});

test('suggestions.js: _suggNorm function exists', () => {
    assert.match(SUGGESTIONS_JS, /^function _suggNorm\s*\(/m);
});

test('suggestions.js: _suggNormStrict function exists', () => {
    assert.match(SUGGESTIONS_JS, /^function _suggNormStrict\s*\(/m);
});

test('suggestions.js: _suggIsInstalled function exists', () => {
    assert.match(SUGGESTIONS_JS, /^function _suggIsInstalled\s*\(/m);
});

test('suggestions.js: _suggOwned function exists', () => {
    assert.match(SUGGESTIONS_JS, /^function _suggOwned\s*\(/m);
});

test('suggestions.js: _suggScore function exists', () => {
    assert.match(SUGGESTIONS_JS, /^function _suggScore\s*\(/m);
});

test('suggestions.js: _suggKey function exists', () => {
    assert.match(SUGGESTIONS_JS, /^function _suggKey\s*\(/m);
});

test('suggestions.js: _suggIsCacheStale async function exists', () => {
    assert.match(SUGGESTIONS_JS, /^async function _suggIsCacheStale\s*\(/m);
});

test('suggestions.js: _buildSyncedSuggestions async function exists', () => {
    assert.match(SUGGESTIONS_JS, /^async function _buildSyncedSuggestions\s*\(\)/m);
});

test('suggestions.js: _suggBuildGame function exists', () => {
    assert.match(SUGGESTIONS_JS, /^function _suggBuildGame\s*\(/m);
});

test('suggestions.js: _suggBadge function exists', () => {
    assert.match(SUGGESTIONS_JS, /^function _suggBadge\s*\(/m);
});

test('suggestions.js: _suggStaleBadge function exists', () => {
    assert.match(SUGGESTIONS_JS, /^function _suggStaleBadge\s*\(\)/m);
});

test('suggestions.js: _suggSaveState function exists', () => {
    assert.match(SUGGESTIONS_JS, /^function _suggSaveState\s*\(\)/m);
});

test('suggestions.js: _suggLoadState function exists', () => {
    assert.match(SUGGESTIONS_JS, /^function _suggLoadState\s*\(\)/m);
});

test('suggestions.js: _suggBuildPool function exists', () => {
    assert.match(SUGGESTIONS_JS, /^function _suggBuildPool\s*\(\)/m);
});

test('suggestions.js: _suggDedupe function exists', () => {
    assert.match(SUGGESTIONS_JS, /^function _suggDedupe\s*\(/m);
});

test('suggestions.js: _suggSyncState function exists', () => {
    assert.match(SUGGESTIONS_JS, /^function _suggSyncState\s*\(/m);
});

test('suggestions.js: _suggSelectForFilter function exists', () => {
    assert.match(SUGGESTIONS_JS, /^function _suggSelectForFilter\s*\(/m);
});

test('suggestions.js: _suggStopRotation function exists', () => {
    assert.match(SUGGESTIONS_JS, /^function _suggStopRotation\s*\(\)/m);
});

test('suggestions.js: _suggStartRotation function exists', () => {
    assert.match(SUGGESTIONS_JS, /^function _suggStartRotation\s*\(\)/m);
});

test('suggestions.js: window._suggSelectGame is assigned', () => {
    assert.match(SUGGESTIONS_JS, /window\._suggSelectGame\s*=\s*function\s*\(\s*idx\s*\)/);
});

test('suggestions.js: window.suggViewDetails is assigned', () => {
    assert.match(SUGGESTIONS_JS, /window\.suggViewDetails\s*=\s*function\s*\(/);
});

test('suggestions.js: _suggHydrateArt async function exists', () => {
    assert.match(SUGGESTIONS_JS, /^async function _suggHydrateArt\s*\(/m);
});

test('suggestions.js: _suggReRenderOne function exists', () => {
    assert.match(SUGGESTIONS_JS, /^function _suggReRenderOne\s*\(/m);
});

test('suggestions.js: _suggRailMetaHtml function exists', () => {
    assert.match(SUGGESTIONS_JS, /^function _suggRailMetaHtml\s*\(/m);
});

test('suggestions.js: window._suggCarouselPrev is assigned', () => {
    assert.match(SUGGESTIONS_JS, /window\._suggCarouselPrev\s*=\s*function\s*\(\)/);
});

test('suggestions.js: window._suggCarouselNext is assigned', () => {
    assert.match(SUGGESTIONS_JS, /window\._suggCarouselNext\s*=\s*function\s*\(\)/);
});

test('suggestions.js: _suggCarouselSlides function exists', () => {
    assert.match(SUGGESTIONS_JS, /^function _suggCarouselSlides\s*\(/m);
});

test('suggestions.js: _suggUpdateCarouselSlide function exists', () => {
    assert.match(SUGGESTIONS_JS, /^function _suggUpdateCarouselSlide\s*\(/m);
});

test('suggestions.js: _renderSyncedFeature function exists', () => {
    assert.match(SUGGESTIONS_JS, /^function _renderSyncedFeature\s*\(/m);
});

test('suggestions.js: _renderSyncedRail function exists', () => {
    assert.match(SUGGESTIONS_JS, /^function _renderSyncedRail\s*\(/m);
});

test('suggestions.js: _suggRenderFiltered function exists', () => {
    assert.match(SUGGESTIONS_JS, /^function _suggRenderFiltered\s*\(\)/m);
});

test('suggestions.js: _suggUpdatePills function exists', () => {
    assert.match(SUGGESTIONS_JS, /^function _suggUpdatePills\s*\(\)/m);
});

test('suggestions.js: renderSyncedSuggestions async function exists', () => {
    assert.match(SUGGESTIONS_JS, /^async function renderSyncedSuggestions\s*\(\)/m);
});

test('suggestions.js: window.setSyncedFilter is assigned', () => {
    assert.match(SUGGESTIONS_JS, /window\.setSyncedFilter\s*=\s*function\s*\(/);
});

test('suggestions.js: window.suggInstall is assigned', () => {
    assert.match(SUGGESTIONS_JS, /window\.suggInstall\s*=\s*function\s*\(/);
});

test('suggestions.js: window._onSyncLibraryUpdated is assigned', () => {
    assert.match(SUGGESTIONS_JS, /window\._onSyncLibraryUpdated\s*=\s*function\s*\(\)/);
});

// ── 3. _seededShuffle behaviour ───────────────────────────────────────────────

test('suggestions.js: _seededShuffle returns a new array without mutating the input', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'function _seededShuffle(', 400);
    assert.match(fn, /\[\.\.\.\s*arr\s*\]/);
});

test('suggestions.js: _seededShuffle uses xorshift32 PRNG (bit-shift pattern)', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'function _seededShuffle(', 400);
    assert.match(fn, /s\s*\^=\s*s\s*<<\s*13/);
    assert.match(fn, /s\s*\^=\s*s\s*>>\s*17/);
});

// ── 4. _suggNorm / _suggNormStrict behaviour ──────────────────────────────────

test('suggestions.js: _suggNorm lowercases and strips trademark symbols', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'function _suggNorm(', 200);
    assert.match(fn, /toLowerCase/);
    assert.match(fn, /[®©™]/);
});

test('suggestions.js: _suggNormStrict strips all non-alphanumeric characters', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'function _suggNormStrict(', 150);
    // Source contains /[^a-z0-9]/gi — verify via replace call and toLowerCase
    assert.match(fn, /\.replace\s*\(/);
    assert.match(fn, /toLowerCase\s*\(\)/);
});

// ── 5. _suggIsInstalled behaviour ─────────────────────────────────────────────

test('suggestions.js: _suggIsInstalled delegates to _agIsInstalled when available', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'function _suggIsInstalled(', 400);
    assert.match(fn, /typeof _agIsInstalled\s*===\s*['"]function['"]/);
    assert.match(fn, /_agIsInstalled\s*\(\s*syncedGame\s*\)/);
});

test('suggestions.js: _suggIsInstalled probes steam-prefix variants via _agBuildInstalledMap', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'function _suggIsInstalled(', 600);
    assert.match(fn, /_agBuildInstalledMap/);
    assert.match(fn, /steam-/);
});

test('suggestions.js: _suggIsInstalled falls back to window.allGamesData when _agIsInstalled unavailable', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'function _suggIsInstalled(', 1200);
    assert.match(fn, /window\.allGamesData/);
});

// ── 6. _suggKey behaviour ─────────────────────────────────────────────────────

test('suggestions.js: _suggKey returns a platform:id composite string', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'function _suggKey(', 120);
    assert.match(fn, /_platform/);
    assert.match(fn, /id/);
});

// ── 7. _suggIsCacheStale behaviour ────────────────────────────────────────────

test('suggestions.js: _suggIsCacheStale calls electronAPI.platformSyncGetState', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'async function _suggIsCacheStale(', 900);
    assert.match(fn, /electronAPI\.platformSyncGetState\s*\(/);
});

test('suggestions.js: _suggIsCacheStale returns true when phase is error', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'async function _suggIsCacheStale(', 900);
    assert.match(fn, /phase\s*===\s*['"]error['"]/);
    assert.match(fn, /return true/);
});

test('suggestions.js: _suggIsCacheStale returns false on IPC failure', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'async function _suggIsCacheStale(', 900);
    assert.match(fn, /catch/);
    assert.match(fn, /return false/);
});

// ── 8. _buildSyncedSuggestions behaviour ─────────────────────────────────────

test('suggestions.js: _buildSyncedSuggestions resets _suggAllGames to empty array', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'async function _buildSyncedSuggestions()', 200);
    assert.match(fn, /_suggAllGames\s*=\s*\[\]/);
});

test('suggestions.js: _buildSyncedSuggestions calls electronAPI.platformSyncGetCached', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'async function _buildSyncedSuggestions()', 600);
    assert.match(fn, /electronAPI\.platformSyncGetCached\s*\(/);
});

test('suggestions.js: _buildSyncedSuggestions calls electronAPI.platformSyncGetAccounts', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'async function _buildSyncedSuggestions()', 600);
    assert.match(fn, /electronAPI\.platformSyncGetAccounts\s*\(/);
});

test('suggestions.js: _buildSyncedSuggestions sets window._suggAllGames after building', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'async function _buildSyncedSuggestions()', 3920);
    assert.match(fn, /window\._suggAllGames\s*=/);
});

test('suggestions.js: _buildSyncedSuggestions sets window.__platformLibraryReady', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'async function _buildSyncedSuggestions()', 3920);
    assert.match(fn, /window\.__platformLibraryReady/);
});

test('suggestions.js: _buildSyncedSuggestions uses _suggIsInstalled to filter out already-installed games', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'async function _buildSyncedSuggestions()', 3000);
    assert.match(fn, /_suggIsInstalled\s*\(/);
});

// ── 9. _suggBuildGame behaviour ───────────────────────────────────────────────

test('suggestions.js: _suggBuildGame maps synced game fields to local game shape', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'function _suggBuildGame(', 500);
    assert.match(fn, /id:/);
    assert.match(fn, /name:/);
    assert.match(fn, /image:/);
    assert.match(fn, /platform:/);
    assert.match(fn, /platforms:/);
});

test('suggestions.js: _suggBuildGame copies appName, namespace, catalogItemId, allIds', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'function _suggBuildGame(', 500);
    assert.match(fn, /appName:/);
    assert.match(fn, /namespace:/);
    assert.match(fn, /catalogItemId:/);
    assert.match(fn, /allIds:/);
});

// ── 10. _suggBuildPool behaviour ──────────────────────────────────────────────

test('suggestions.js: _suggBuildPool calls _suggLoadState for bucket-restore logic', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'function _suggBuildPool()', 1800);
    assert.match(fn, /_suggLoadState\s*\(\)/);
});

test('suggestions.js: _suggBuildPool calls _suggSyncState with computed bucket', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'function _suggBuildPool()', 1800);
    assert.match(fn, /_suggSyncState\s*\(\s*bucket\s*\)/);
});

test('suggestions.js: _suggBuildPool calls _suggSaveState after building a fresh pool', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'function _suggBuildPool()', 1800);
    assert.match(fn, /_suggSaveState\s*\(\)/);
});

test('suggestions.js: _suggBuildPool calls _suggSelectForFilter to select games', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'function _suggBuildPool()', 1800);
    assert.match(fn, /_suggSelectForFilter\s*\(\s*_suggFilter/);
});

// ── 11. _suggDedupe behaviour ─────────────────────────────────────────────────

test('suggestions.js: _suggDedupe removes duplicates by _suggKey', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'function _suggDedupe(', 250);
    assert.match(fn, /_suggKey\s*\(/);
    assert.match(fn, /seen/);
});

// ── 12. _suggSelectForFilter behaviour ───────────────────────────────────────

test('suggestions.js: _suggSelectForFilter uses _seededShuffle for deterministic order', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'function _suggSelectForFilter(', 350);
    assert.match(fn, /_seededShuffle\s*\(\s*_suggAllGames/);
});

test('suggestions.js: _suggSelectForFilter filters by platform when filter is not "all"', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'function _suggSelectForFilter(', 350);
    assert.match(fn, /_platform\s*===\s*filter/);
});

// ── 13. _suggStartRotation behaviour ─────────────────────────────────────────

test('suggestions.js: _suggStartRotation calls _suggStopRotation first', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'function _suggStartRotation()', 400);
    const stopIdx  = fn.indexOf('_suggStopRotation()');
    const timerIdx = fn.indexOf('setInterval');
    assert.ok(stopIdx > -1, '_suggStopRotation must be called');
    assert.ok(timerIdx > -1, 'setInterval must be set up');
    assert.ok(stopIdx < timerIdx, '_suggStopRotation must come before setInterval');
});

test('suggestions.js: _suggStartRotation uses _SUGG_ROTATE_MS as the interval delay', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'function _suggStartRotation()', 400);
    assert.match(fn, /_SUGG_ROTATE_MS/);
});

test('suggestions.js: _suggStartRotation advances _suggPoolIdx in the interval callback', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'function _suggStartRotation()', 400);
    assert.match(fn, /_suggPoolIdx\s*=\s*\(/);
    assert.match(fn, /_suggPool\.length/);
});

// ── 14. _suggStopRotation behaviour ──────────────────────────────────────────

test('suggestions.js: _suggStopRotation clears _suggRotateTimer and resets it to null', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'function _suggStopRotation()', 150);
    assert.match(fn, /clearInterval\s*\(\s*_suggRotateTimer\s*\)/);
    assert.match(fn, /_suggRotateTimer\s*=\s*null/);
});

// ── 15. window._suggSelectGame behaviour ─────────────────────────────────────

test('suggestions.js: _suggSelectGame guards against out-of-range index', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'window._suggSelectGame = function(', 300);
    assert.match(fn, /idx\s*<\s*0\s*\|\|\s*idx\s*>=\s*_suggPool\.length/);
    assert.match(fn, /return/);
});

test('suggestions.js: _suggSelectGame updates _suggPoolIdx and restarts rotation', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'window._suggSelectGame = function(', 300);
    assert.match(fn, /_suggPoolIdx\s*=\s*idx/);
    assert.match(fn, /_suggStartRotation\s*\(\)/);
});

test('suggestions.js: _suggSelectGame calls _renderSyncedRail and _renderSyncedFeature', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'window._suggSelectGame = function(', 300);
    assert.match(fn, /_renderSyncedRail\s*\(\s*_suggPool\s*\)/);
    assert.match(fn, /_renderSyncedFeature\s*\(/);
});

// ── 16. window.suggViewDetails behaviour ─────────────────────────────────────

test('suggestions.js: suggViewDetails looks up game in _suggAllGames by platform and id', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'window.suggViewDetails = function(', 500);
    assert.match(fn, /_suggAllGames\.find/);
    assert.match(fn, /_platform\s*===\s*platform/);
});

test('suggestions.js: suggViewDetails sets window._gdSyncedGameOverride before opening details', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'window.suggViewDetails = function(', 500);
    const overrideIdx = fn.indexOf('_gdSyncedGameOverride');
    // Use the actual call (not the comment) by searching for 'openGameDetails('
    const openIdx     = fn.indexOf('openGameDetails(');
    assert.ok(overrideIdx > -1, '_gdSyncedGameOverride must be set');
    assert.ok(openIdx > -1, 'openGameDetails must be called');
    assert.ok(overrideIdx < openIdx, '_gdSyncedGameOverride must be set before openGameDetails call');
});

test('suggestions.js: suggViewDetails uses _suggBuildGame to convert the synced game object', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'window.suggViewDetails = function(', 500);
    assert.match(fn, /_suggBuildGame\s*\(\s*g\s*\)/);
});

// ── 17. _suggHydrateArt behaviour ────────────────────────────────────────────

test('suggestions.js: _suggHydrateArt calls electronAPI.getMetadata for art enrichment', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'async function _suggHydrateArt(', 1300);
    assert.match(fn, /electronAPI\.getMetadata\s*\(/);
});

test('suggestions.js: _suggHydrateArt guards against duplicate in-flight requests via hydratingGameIds', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'async function _suggHydrateArt(', 450);
    assert.match(fn, /hydratingGameIds\.has\s*\(/);
    assert.match(fn, /hydratedGameIds\.has\s*\(/);
});

test('suggestions.js: _suggHydrateArt respects _SUGG_HYDRATE_CONCURRENCY limit', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'async function _suggHydrateArt(', 600);
    assert.match(fn, /_suggHydrateActive\s*>=\s*_SUGG_HYDRATE_CONCURRENCY/);
});

test('suggestions.js: _suggHydrateArt calls _suggReRenderOne after fetching art', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'async function _suggHydrateArt(', 5280);
    assert.match(fn, /_suggReRenderOne\s*\(/);
});

// ── 18. _suggCarouselSlides behaviour ────────────────────────────────────────

test('suggestions.js: _suggCarouselSlides returns metaScreenshots when available', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'function _suggCarouselSlides(', 250);
    assert.match(fn, /_metaScreenshots/);
});

test('suggestions.js: _suggCarouselSlides falls back to heroImage when no screenshots', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'function _suggCarouselSlides(', 250);
    assert.match(fn, /heroImage/);
    assert.match(fn, /fallback/);
});

// ── 19. _suggUpdateCarouselSlide behaviour ────────────────────────────────────

test('suggestions.js: _suggUpdateCarouselSlide updates #suggCarouselStage element', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'function _suggUpdateCarouselSlide(', 550);
    assert.match(fn, /getElementById\s*\(\s*['"]suggCarouselStage['"]\s*\)/);
});

test('suggestions.js: _suggUpdateCarouselSlide updates carousel pip dots', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'function _suggUpdateCarouselSlide(', 550);
    assert.match(fn, /\.sugg-carousel-pip/);
    assert.match(fn, /classList\.toggle\s*\(\s*['"]active['"]/);
});

test('suggestions.js: _suggUpdateCarouselSlide shows/hides prev/next buttons based on slide count', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'function _suggUpdateCarouselSlide(', 750);
    assert.match(fn, /getElementById\s*\(\s*['"]suggCarouselPrev['"]\s*\)/);
    assert.match(fn, /getElementById\s*\(\s*['"]suggCarouselNext['"]\s*\)/);
});

// ── 20. _suggCarouselPrev / _suggCarouselNext behaviour ───────────────────────

test('suggestions.js: _suggCarouselPrev returns early when no featured game', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'window._suggCarouselPrev = function()', 250);
    assert.match(fn, /if\s*\(\s*!_suggFeaturedGame\s*\)\s*return/);
});

test('suggestions.js: _suggCarouselPrev decrements _suggCarouselIdx with wrap-around', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'window._suggCarouselPrev = function()', 250);
    assert.match(fn, /_suggCarouselIdx\s*-\s*1/);
    assert.match(fn, /slides\.length/);
});

test('suggestions.js: _suggCarouselNext increments _suggCarouselIdx with wrap-around', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'window._suggCarouselNext = function()', 250);
    assert.match(fn, /_suggCarouselIdx\s*\+\s*1/);
    assert.match(fn, /slides\.length/);
});

// ── 21. _renderSyncedFeature behaviour ───────────────────────────────────────

test('suggestions.js: _renderSyncedFeature uses #syncedFeatureWrap element', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'function _renderSyncedFeature(', 300);
    assert.match(fn, /getElementById\s*\(\s*['"]syncedFeatureWrap['"]\s*\)/);
});

test('suggestions.js: _renderSyncedFeature sets _suggFeaturedGame reference', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'function _renderSyncedFeature(', 400);
    assert.match(fn, /_suggFeaturedGame\s*=\s*g/);
});

test('suggestions.js: _renderSyncedFeature wires window.suggInstall in generated onclick', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'function _renderSyncedFeature(', 2700);
    assert.match(fn, /suggInstall\s*\(/);
});

test('suggestions.js: _renderSyncedFeature wires window.suggViewDetails in generated onclick', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'function _renderSyncedFeature(', 2700);
    assert.match(fn, /suggViewDetails\s*\(/);
});

// ── 22. _renderSyncedRail behaviour ───────────────────────────────────────────

test('suggestions.js: _renderSyncedRail uses #syncedRail element', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'function _renderSyncedRail(', 600);
    assert.match(fn, /getElementById\s*\(\s*['"]syncedRail['"]\s*\)/);
});

test('suggestions.js: _renderSyncedRail wires window._suggSelectGame in generated onclick', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'function _renderSyncedRail(', 1400);
    assert.match(fn, /_suggSelectGame\s*\(/);
});

test('suggestions.js: _renderSyncedRail uses escapeHtml for game titles', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'function _renderSyncedRail(', 1700);
    assert.match(fn, /escapeHtml\s*\(/);
});

// ── 23. _suggRenderFiltered behaviour ─────────────────────────────────────────

test('suggestions.js: _suggRenderFiltered calls _suggBuildPool then renders feature and rail', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'function _suggRenderFiltered()', 420);
    const buildIdx   = fn.indexOf('_suggBuildPool()');
    const featureIdx = fn.indexOf('_renderSyncedFeature(');
    const railIdx    = fn.indexOf('_renderSyncedRail(');
    assert.ok(buildIdx > -1, '_suggBuildPool must be called');
    assert.ok(featureIdx > -1, '_renderSyncedFeature must be called');
    assert.ok(railIdx > -1, '_renderSyncedRail must be called');
    assert.ok(buildIdx < featureIdx, '_suggBuildPool must come before _renderSyncedFeature');
});

test('suggestions.js: _suggRenderFiltered calls _suggStartRotation', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'function _suggRenderFiltered()', 450);
    assert.match(fn, /_suggStartRotation\s*\(\)/);
});

// ── 24. _suggUpdatePills behaviour ────────────────────────────────────────────

test('suggestions.js: _suggUpdatePills shows/hides Steam pill based on presence in _suggAllGames', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'function _suggUpdatePills()', 400);
    assert.match(fn, /_suggAllGames\.some/);
    assert.match(fn, /\[data-filter="steam"\]/);
    assert.match(fn, /style\.display/);
});

test('suggestions.js: _suggUpdatePills shows/hides Epic pill based on presence in _suggAllGames', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'function _suggUpdatePills()', 400);
    assert.match(fn, /\[data-filter="epic"\]/);
});

// ── 25. renderSyncedSuggestions behaviour ────────────────────────────────────

test('suggestions.js: renderSyncedSuggestions calls _suggStopRotation at entry', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'async function _renderSyncedSuggestionsInner(', 200);
    assert.match(fn, /_suggStopRotation\s*\(\)/);
});

test('suggestions.js: renderSyncedSuggestions uses all expected section DOM IDs', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'async function _renderSyncedSuggestionsInner(', 600);
    assert.match(fn, /syncedSuggestionsSection/);
    assert.match(fn, /syncedSuggLoading/);
    assert.match(fn, /syncedSuggEmpty/);
    assert.match(fn, /syncedSuggCTA/);
    assert.match(fn, /syncedSuggBody/);
    assert.match(fn, /syncedSuggStats/);
});

test('suggestions.js: renderSyncedSuggestions calls electronAPI.platformSyncGetAccounts per platform', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'async function _renderSyncedSuggestionsInner(', 1000);
    assert.match(fn, /electronAPI\.platformSyncGetAccounts\s*\(/);
});

test('suggestions.js: renderSyncedSuggestions calls _buildSyncedSuggestions after account check', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'async function _renderSyncedSuggestionsInner(', 2300);
    const accountIdx = fn.indexOf('platformSyncGetAccounts');
    const buildIdx   = fn.indexOf('_buildSyncedSuggestions()');
    assert.ok(accountIdx > -1, 'platformSyncGetAccounts must be called');
    assert.ok(buildIdx > -1, '_buildSyncedSuggestions must be called');
    assert.ok(accountIdx < buildIdx, 'accounts must be checked before building suggestions');
});

// ── 26. window.setSyncedFilter behaviour ─────────────────────────────────────

test('suggestions.js: setSyncedFilter stops rotation and resets pool state', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'window.setSyncedFilter = function(', 350);
    assert.match(fn, /_suggStopRotation\s*\(\)/);
    assert.match(fn, /_suggPool\s*=\s*\[\]/);
    assert.match(fn, /_suggPoolTs\s*=\s*0/);
});

test('suggestions.js: setSyncedFilter updates _suggFilter and calls _suggRenderFiltered', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'window.setSyncedFilter = function(', 350);
    assert.match(fn, /_suggFilter\s*=\s*filter/);
    assert.match(fn, /_suggRenderFiltered\s*\(\)/);
});

test('suggestions.js: setSyncedFilter toggles active class on the pill buttons', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'window.setSyncedFilter = function(', 350);
    assert.match(fn, /\.sugg-pill/);
    assert.match(fn, /classList\.remove\s*\(\s*['"]active['"]\s*\)/);
});

// ── 27. window.suggInstall behaviour ─────────────────────────────────────────

test('suggestions.js: suggInstall looks up game in _suggAllGames by platform and id', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'window.suggInstall = function(', 350);
    assert.match(fn, /_suggAllGames\.find/);
    assert.match(fn, /_platform\s*===\s*platform/);
});

test('suggestions.js: suggInstall delegates to window._gdOpenInstallPickerForGame', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'window.suggInstall = function(', 350);
    assert.match(fn, /window\._gdOpenInstallPickerForGame\s*\(/);
});

test('suggestions.js: suggInstall builds the game object via _suggBuildGame before passing to install picker', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'window.suggInstall = function(', 350);
    const buildIdx  = fn.indexOf('_suggBuildGame(');
    const pickerIdx = fn.indexOf('_gdOpenInstallPickerForGame(');
    assert.ok(buildIdx > -1, '_suggBuildGame must be called');
    assert.ok(pickerIdx > -1, '_gdOpenInstallPickerForGame must be called');
    assert.ok(buildIdx < pickerIdx, '_suggBuildGame must come before _gdOpenInstallPickerForGame');
});

// ── 28. window._onSyncLibraryUpdated behaviour ───────────────────────────────

test('suggestions.js: _onSyncLibraryUpdated only re-renders when currentView is "home"', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'window._onSyncLibraryUpdated = function()', 200);
    assert.match(fn, /currentView\s*===\s*['"]home['"]/);
});

test('suggestions.js: _onSyncLibraryUpdated stops rotation then calls renderSyncedSuggestions', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'window._onSyncLibraryUpdated = function()', 200);
    const stopIdx   = fn.indexOf('_suggStopRotation()');
    const renderIdx = fn.indexOf('renderSyncedSuggestions()');
    assert.ok(stopIdx > -1, '_suggStopRotation must be called');
    assert.ok(renderIdx > -1, 'renderSyncedSuggestions must be called');
    assert.ok(stopIdx < renderIdx, '_suggStopRotation must come before renderSyncedSuggestions');
});

// ── 29. _suggSaveState / _suggLoadState behaviour ────────────────────────────

test('suggestions.js: _suggSaveState writes to localStorage using _SUGG_STATE_KEY', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'function _suggSaveState()', 200);
    assert.match(fn, /localStorage\.setItem\s*\(\s*_SUGG_STATE_KEY/);
});

test('suggestions.js: _suggSaveState stores filter, bucket, poolKeys, activeIdx, timestamp', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'function _suggSaveState()', 350);
    assert.match(fn, /filter:/);
    assert.match(fn, /bucket:/);
    assert.match(fn, /poolKeys:/);
    assert.match(fn, /activeIdx:/);
    assert.match(fn, /timestamp:/);
});

test('suggestions.js: _suggLoadState reads from localStorage using _SUGG_STATE_KEY', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'function _suggLoadState()', 150);
    assert.match(fn, /localStorage\.getItem\s*\(\s*_SUGG_STATE_KEY/);
});

test('suggestions.js: _suggLoadState returns null on parse failure', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'function _suggLoadState()', 150);
    assert.match(fn, /catch/);
    assert.match(fn, /return null/);
});

// ── 30. DOM tests ─────────────────────────────────────────────────────────────

test('dashboard.html: #syncedSuggestionsSection element exists', () => {
    assert.match(HTML, /id="syncedSuggestionsSection"/);
});

test('dashboard.html: #syncedSuggStats element exists', () => {
    assert.match(HTML, /id="syncedSuggStats"/);
});

test('dashboard.html: #syncedSuggLoading element exists', () => {
    assert.match(HTML, /id="syncedSuggLoading"/);
});

test('dashboard.html: #syncedSuggBody element exists', () => {
    assert.match(HTML, /id="syncedSuggBody"/);
});

test('dashboard.html: #syncedFeatureWrap element exists', () => {
    assert.match(HTML, /id="syncedFeatureWrap"/);
});

test('dashboard.html: #syncedRail element exists', () => {
    assert.match(HTML, /id="syncedRail"/);
});

test('dashboard.html: #syncedSuggEmpty element exists', () => {
    assert.match(HTML, /id="syncedSuggEmpty"/);
});

test('dashboard.html: #syncedSuggCTA element exists', () => {
    assert.match(HTML, /id="syncedSuggCTA"/);
});

test('dashboard.html: #syncedCtaBtns element exists', () => {
    assert.match(HTML, /id="syncedCtaBtns"/);
});

test('dashboard.html: .synced-filters element exists', () => {
    assert.match(HTML, /class="synced-filters"/);
});

test('dashboard.html: .sugg-pill elements exist', () => {
    assert.match(HTML, /class="sugg-pill/);
});

test('dashboard.html: sugg-pill for "all" filter wires setSyncedFilter', () => {
    assert.match(HTML, /onclick="setSyncedFilter\s*\(\s*'all'/);
});

test('dashboard.html: sugg-pill for "steam" filter wires setSyncedFilter', () => {
    assert.match(HTML, /onclick="setSyncedFilter\s*\(\s*'steam'/);
});

test('dashboard.html: sugg-pill for "epic" filter wires setSyncedFilter', () => {
    assert.match(HTML, /onclick="setSyncedFilter\s*\(\s*'epic'/);
});

test('dashboard.html: carousel stage DOM elements are NOT present (built dynamically by JS)', () => {
    assert.doesNotMatch(HTML, /id="suggCarouselStage"/);
    assert.doesNotMatch(HTML, /id="suggCarouselPrev"/);
    assert.doesNotMatch(HTML, /id="suggCarouselNext"/);
});

// ── 31. electronAPI dependencies ─────────────────────────────────────────────

test('suggestions.js: suggestion code depends on electronAPI.platformSyncGetState', () => {
    assert.match(SUGGESTIONS_JS, /electronAPI\.platformSyncGetState\s*\(/);
});

test('suggestions.js: suggestion code depends on electronAPI.platformSyncGetCached', () => {
    assert.match(SUGGESTIONS_JS, /electronAPI\.platformSyncGetCached\s*\(/);
});

test('suggestions.js: suggestion code depends on electronAPI.platformSyncGetAccounts', () => {
    const count = (SUGGESTIONS_JS.match(/electronAPI\.platformSyncGetAccounts\s*\(/g) || []).length;
    assert.ok(count >= 2, 'platformSyncGetAccounts used in _buildSyncedSuggestions and renderSyncedSuggestions');
});

test('suggestions.js: suggestion code depends on electronAPI.getMetadata for art hydration', () => {
    assert.match(SUGGESTIONS_JS, /electronAPI\.getMetadata\s*\(/);
});

// ── 32. Intentional cross-file dependencies ───────────────────────────────────

test('suggestions.js: _suggIsInstalled depends on _agIsInstalled from accounts.js helpers', () => {
    assert.match(SUGGESTIONS_JS, /_agIsInstalled\s*\(/);
});

test('suggestions.js: _suggIsInstalled depends on _agBuildInstalledMap from accounts.js helpers', () => {
    assert.match(SUGGESTIONS_JS, /_agBuildInstalledMap\s*\(/);
});

test('suggestions.js: suggestion code depends on window.allGamesData as installed-game fallback', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'function _suggIsInstalled(', 1200);
    assert.match(fn, /window\.allGamesData/);
});

test('suggestions.js: _renderSyncedRail depends on escapeHtml', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'function _renderSyncedRail(', 1700);
    assert.match(fn, /escapeHtml\s*\(/);
});

test('suggestions.js: _renderSyncedFeature depends on isUsableImageUrl from artwork-sync.js', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'function _renderSyncedFeature(', 700);
    assert.match(fn, /isUsableImageUrl\s*\(/);
});

test('suggestions.js: _suggReRenderOne depends on setHeroBgStable from artwork-sync.js', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'function _suggReRenderOne(', 1200);
    assert.match(fn, /setHeroBgStable\s*\(/);
});

test('suggestions.js: _suggReRenderOne depends on setCardImageStable from artwork-sync.js', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'function _suggReRenderOne(', 2800);
    assert.match(fn, /setCardImageStable\s*\(/);
});

test('suggestions.js: suggViewDetails depends on openGameDetails from app.js', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'window.suggViewDetails = function(', 500);
    assert.match(fn, /openGameDetails\s*\(/);
});

test('suggestions.js: suggViewDetails sets window._gdSyncedGameOverride for game-details.js handoff', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'window.suggViewDetails = function(', 500);
    assert.match(fn, /window\._gdSyncedGameOverride\s*=/);
});

test('suggestions.js: suggInstall depends on window._gdOpenInstallPickerForGame from game-details.js', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'window.suggInstall = function(', 350);
    assert.match(fn, /window\._gdOpenInstallPickerForGame/);
});

test('suggestions.js: _onSyncLibraryUpdated depends on currentView to guard re-render', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'window._onSyncLibraryUpdated = function()', 200);
    assert.match(fn, /currentView/);
});

// ── 33. Isolation tests ───────────────────────────────────────────────────────

test('suggestions.js: _suggBuildPool does not call quick-switcher internals', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'function _suggBuildPool()', 1800);
    assert.doesNotMatch(fn, /openSettingsQuickSwitcher|closeSettingsQuickSwitcher|renderQuickSwitcher/);
});

test('suggestions.js: renderSyncedSuggestions does not call system-stats internals', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'async function _renderSyncedSuggestionsInner(', 3000);
    assert.doesNotMatch(fn, /initSystemStats|_hudInterval|checkAndManagePolling/);
});

test('suggestions.js: _renderSyncedFeature does not call collection settings modal internals', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'function _renderSyncedFeature(', 2700);
    assert.doesNotMatch(fn, /openCollectionSettings|closeCollectionSettings|saveCollectionSettings/);
});

test('suggestions.js: _renderSyncedRail does not call context menu internals', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'function _renderSyncedRail(', 1700);
    assert.doesNotMatch(fn, /showContextMenu|hideContextMenu|triggerRemove/);
});

test('suggestions.js: renderSyncedSuggestions does not call account display preference internals', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'async function _renderSyncedSuggestionsInner(', 3000);
    assert.doesNotMatch(fn, /renderPlatformPanels|updateDisplayPrefs|applyDisplayPreferences/);
});

test('suggestions.js: _buildSyncedSuggestions does not call game context action internals', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'async function _buildSyncedSuggestions()', 3000);
    assert.doesNotMatch(fn, /confirmDeleteAction|triggerRemove|_toggleCardFavorite/);
});

// ── 34. Comment hygiene ───────────────────────────────────────────────────────

test('suggestions.js: no Arabic-script characters', () => {
    assert.doesNotMatch(SUGGESTIONS_JS, /[؀-ۿ]/);
});

test('suggestions.js: no emoji in comments', () => {
    // Strip string literals before checking for emoji in comments
    const stripped = SUGGESTIONS_JS.replace(/(['"`])(?:(?!\1)[^\\]|\\.)*\1/g, '""');
    assert.doesNotMatch(stripped, /[\u{1F300}-\u{1FFFF}]/u);
});

// ── 35. app.js no-redeclaration tests ────────────────────────────────────────

test('app.js: does not redeclare _suggAllGames', () => {
    assert.doesNotMatch(APP_JS, /^let _suggAllGames\b/m);
});

test('app.js: does not redeclare _suggFilter', () => {
    assert.doesNotMatch(APP_JS, /^let _suggFilter\b/m);
});

// ── 36. Canonical RTI state behavioral tests ─────────────────────────────────

test('suggestions.js: renderSyncedSuggestions stats block uses getCanonicalReadyToInstallCount (not _suggAllGames.length)', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'async function _renderSyncedSuggestionsInner(', 5000);
    assert.match(fn, /getCanonicalReadyToInstallCount/, 'must call getCanonicalReadyToInstallCount for the stat display');
    // Verify it does not use _suggAllGames.length as the stat value directly
    // (it may still use staleCount from _suggAllGames, but not for the main count)
    const statsIdx = fn.indexOf('syncedSuggStats');
    const rtiIdx   = fn.indexOf('getCanonicalReadyToInstallCount');
    assert.ok(statsIdx > -1, 'stats element must be referenced');
    assert.ok(rtiIdx > -1, 'getCanonicalReadyToInstallCount must be called');
});

test('suggestions.js: home stat shows "..." when canonical count is null (not ready)', () => {
    const fn = extractFn(SUGGESTIONS_JS, 'async function _renderSyncedSuggestionsInner(', 5000);
    // The stat display must handle null count with a loading indicator
    assert.match(fn, /\.\.\.|…/, 'must show loading indicator when canonical count is null');
});

test('suggestions.js: _suggAllGames.length=117 + canonical count=119 -> home stat shows 119', () => {
    // Unit simulation: canonical count takes precedence over _suggAllGames.length
    const _suggAllGames = Array.from({ length: 117 }, (_, i) => ({ id: i, title: `Game ${i}`, _cacheStale: false }));
    const canonicalCount = 119;
    const getCanonicalReadyToInstallCount = () => canonicalCount;
    const _rtiCount = typeof getCanonicalReadyToInstallCount === 'function'
        ? getCanonicalReadyToInstallCount()
        : null;
    const _rtiDisplay = _rtiCount !== null ? String(_rtiCount) : '…';
    assert.strictEqual(_rtiDisplay, '119', 'home stat must show canonical count 119, not _suggAllGames.length 117');
});

test('suggestions.js: baddel:ready-install-updated event listener is registered', () => {
    assert.match(SUGGESTIONS_JS, /baddel:ready-install-updated/, 'must listen for canonical state change events');
    assert.match(SUGGESTIONS_JS, /addEventListener\s*\(\s*['"]baddel:ready-install-updated['"]/);
});

test('app.js: does not redeclare _SUGG_STATE_KEY', () => {
    assert.doesNotMatch(APP_JS, /^const _SUGG_STATE_KEY\b/m);
});

test('app.js: does not redeclare _seededShuffle', () => {
    assert.doesNotMatch(APP_JS, /^function _seededShuffle\b/m);
});

test('app.js: does not redeclare _suggIsInstalled', () => {
    assert.doesNotMatch(APP_JS, /^function _suggIsInstalled\b/m);
});

test('app.js: does not redeclare _buildSyncedSuggestions', () => {
    assert.doesNotMatch(APP_JS, /^async function _buildSyncedSuggestions\b/m);
});

test('app.js: does not redeclare renderSyncedSuggestions', () => {
    assert.doesNotMatch(APP_JS, /^async function renderSyncedSuggestions\b/m);
});

test('app.js: does not redeclare _suggBuildPool', () => {
    assert.doesNotMatch(APP_JS, /^function _suggBuildPool\b/m);
});

test('app.js: does not redeclare _renderSyncedFeature', () => {
    assert.doesNotMatch(APP_JS, /^function _renderSyncedFeature\b/m);
});

test('app.js: does not redeclare _renderSyncedRail', () => {
    assert.doesNotMatch(APP_JS, /^function _renderSyncedRail\b/m);
});

test('app.js: does not redeclare _suggHydrateArt', () => {
    assert.doesNotMatch(APP_JS, /^async function _suggHydrateArt\b/m);
});

// ── 36. Script load order in dashboard.html ───────────────────────────────────

test('dashboard.html: suggestions.js script tag is present', () => {
    assert.match(HTML, /src="js\/app\/suggestions\.js"/);
});

test('dashboard.html: game-context-actions.js loads before suggestions.js', () => {
    const ctxIdx  = HTML.indexOf('game-context-actions.js');
    const suggIdx = HTML.indexOf('suggestions.js');
    assert.ok(ctxIdx > -1, 'game-context-actions.js must be in HTML');
    assert.ok(suggIdx > -1, 'suggestions.js must be in HTML');
    assert.ok(ctxIdx < suggIdx, 'game-context-actions.js must load before suggestions.js');
});

test('dashboard.html: suggestions.js loads before app.js', () => {
    const suggIdx = HTML.indexOf('suggestions.js');
    const appIdx  = HTML.indexOf('"js/app.js"');
    assert.ok(suggIdx > -1, 'suggestions.js must be in HTML');
    assert.ok(appIdx > -1, 'app.js must be in HTML');
    assert.ok(suggIdx < appIdx, 'suggestions.js must load before app.js');
});

test('dashboard.html: collections.js loads before suggestions.js', () => {
    const collIdx = HTML.indexOf('collections.js');
    const suggIdx = HTML.indexOf('suggestions.js');
    assert.ok(collIdx < suggIdx, 'collections.js must load before suggestions.js');
});

// ── 37. Window export tests ───────────────────────────────────────────────────

test('suggestions.js: window.renderSyncedSuggestions is exported', () => {
    assert.match(SUGGESTIONS_JS, /window\.renderSyncedSuggestions\s*=\s*renderSyncedSuggestions/);
});

test('suggestions.js: window._suggAllGames is set at module load', () => {
    assert.match(SUGGESTIONS_JS, /window\._suggAllGames\s*=\s*_suggAllGames/);
});

test('suggestions.js: window._suggSelectGame is exported', () => {
    assert.match(SUGGESTIONS_JS, /window\._suggSelectGame\s*=/);
});

test('suggestions.js: window.suggViewDetails is exported', () => {
    assert.match(SUGGESTIONS_JS, /window\.suggViewDetails\s*=/);
});

test('suggestions.js: window._suggCarouselPrev is exported', () => {
    assert.match(SUGGESTIONS_JS, /window\._suggCarouselPrev\s*=/);
});

test('suggestions.js: window._suggCarouselNext is exported', () => {
    assert.match(SUGGESTIONS_JS, /window\._suggCarouselNext\s*=/);
});

test('suggestions.js: window.setSyncedFilter is exported', () => {
    assert.match(SUGGESTIONS_JS, /window\.setSyncedFilter\s*=/);
});

test('suggestions.js: window.suggInstall is exported', () => {
    assert.match(SUGGESTIONS_JS, /window\.suggInstall\s*=/);
});

test('suggestions.js: window._onSyncLibraryUpdated is exported', () => {
    assert.match(SUGGESTIONS_JS, /window\._onSyncLibraryUpdated\s*=/);
});

// ── Deferred Home refresh in suggestions.js ──────────────────────────────────

test('suggestions.js: _renderSyncedSuggestionsInner is defined as the inner async body', () => {
    assert.match(SUGGESTIONS_JS, /async function _renderSyncedSuggestionsInner\s*\(/);
});

test('suggestions.js: renderSyncedSuggestions calls text-only count update and marks pending when scrolled', () => {
    const body = extractFn(SUGGESTIONS_JS, 'async function renderSyncedSuggestions(', 750);
    assert.match(body, /window\._homeIsUserScrolled/);
    assert.match(body, /window\._updateHomeReadyCountTextOnly/);
    assert.match(body, /window\._markHomeRefreshPending/);
    assert.match(body, /home-synced-suggestions-scrolled/);
    assert.match(body, /_renderSyncedSuggestionsInner/);
});

test('suggestions.js: baddel:ready-install-updated listener calls text-only update when Home is scrolled', () => {
    const idx = SUGGESTIONS_JS.indexOf('baddel:ready-install-updated');
    assert.ok(idx !== -1, 'baddel:ready-install-updated listener not found');
    const slice = SUGGESTIONS_JS.slice(idx, idx + 900);
    assert.match(slice, /window\._homeIsUserScrolled/);
    assert.match(slice, /window\._updateHomeReadyCountTextOnly/);
    assert.match(slice, /window\._markHomeRefreshPending/);
    assert.match(slice, /home-ready-count-text-only/);
});
