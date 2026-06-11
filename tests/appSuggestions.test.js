'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT   = path.resolve(__dirname, '..');
const APP_JS = fs.readFileSync(path.join(ROOT, 'src/js/app.js'), 'utf8');
const HTML   = fs.readFileSync(path.join(ROOT, 'src/dashboard.html'), 'utf8');

// ── helpers ───────────────────────────────────────────────────────────────────

function extractFn(src, sig, maxLen = 2000) {
    const idx = src.indexOf(sig);
    if (idx === -1) return '';
    return src.slice(idx, idx + maxLen);
}

// ── 1. State variables ────────────────────────────────────────────────────────

test('app.js: _suggAllGames state is declared as an empty array', () => {
    assert.match(APP_JS, /^let _suggAllGames\s*=\s*\[\]/m);
});

test('app.js: _suggAllGames is exposed on window', () => {
    assert.match(APP_JS, /window\._suggAllGames\s*=\s*_suggAllGames/);
});

test('app.js: _suggFilter is declared with default value "all"', () => {
    assert.match(APP_JS, /^let _suggFilter\s*=\s*['"]all['"]/m);
});

test('app.js: _SUGG_STATE_KEY constant is declared', () => {
    assert.match(APP_JS, /const _SUGG_STATE_KEY\s*=/);
    assert.match(APP_JS, /baddel_sugg_state_v4/);
});

test('app.js: _SUGG_POOL_TTL constant is declared', () => {
    assert.match(APP_JS, /const _SUGG_POOL_TTL\s*=/);
});

test('app.js: _SUGG_ROTATE_MS constant is declared', () => {
    assert.match(APP_JS, /const _SUGG_ROTATE_MS\s*=/);
});

test('app.js: _SUGG_POOL_PER_PLAT constant is declared', () => {
    assert.match(APP_JS, /const _SUGG_POOL_PER_PLAT\s*=/);
});

test('app.js: _SUGG_POOL_SINGLE constant is declared', () => {
    assert.match(APP_JS, /const _SUGG_POOL_SINGLE\s*=/);
});

test('app.js: _suggPool is declared as an empty array', () => {
    assert.match(APP_JS, /^let _suggPool\s*=\s*\[\]/m);
});

test('app.js: _suggPoolIdx is declared', () => {
    assert.match(APP_JS, /^let _suggPoolIdx\s*=/m);
});

test('app.js: _suggRotateTimer is declared as null', () => {
    assert.match(APP_JS, /^let _suggRotateTimer\s*=\s*null/m);
});

test('app.js: _suggPoolTs is declared', () => {
    assert.match(APP_JS, /^let _suggPoolTs\s*=/m);
});

test('app.js: _suggState is declared with bucket/recommendedItems/steamItems/epicItems/activeFilter shape', () => {
    assert.match(APP_JS, /let _suggState\s*=\s*\{/);
    assert.match(APP_JS, /bucket:/);
    assert.match(APP_JS, /recommendedItems:/);
    assert.match(APP_JS, /steamItems:/);
    assert.match(APP_JS, /epicItems:/);
    assert.match(APP_JS, /activeFilter:/);
});

test('app.js: hydratedGameIds is declared as a Set', () => {
    assert.match(APP_JS, /const hydratedGameIds\s*=\s*new Set\(\)/);
});

test('app.js: hydratingGameIds is declared as a Set', () => {
    assert.match(APP_JS, /const hydratingGameIds\s*=\s*new Set\(\)/);
});

test('app.js: _SUGG_HYDRATE_CONCURRENCY constant is declared', () => {
    assert.match(APP_JS, /const _SUGG_HYDRATE_CONCURRENCY\s*=/);
});

test('app.js: _suggHydrateActive is declared', () => {
    assert.match(APP_JS, /^let _suggHydrateActive\s*=/m);
});

test('app.js: _suggCarouselIdx state is declared', () => {
    assert.match(APP_JS, /^let _suggCarouselIdx\s*=/m);
});

test('app.js: _suggFeaturedGame state is declared as null', () => {
    assert.match(APP_JS, /^let _suggFeaturedGame\s*=\s*null/m);
});

test('app.js: _SUGG_PLAT_CFG config object is declared', () => {
    assert.match(APP_JS, /const _SUGG_PLAT_CFG\s*=/);
    assert.match(APP_JS, /steam:/);
    assert.match(APP_JS, /epic:/);
});

// ── 2. Function presence ──────────────────────────────────────────────────────

test('app.js: _seededShuffle function exists', () => {
    assert.match(APP_JS, /^function _seededShuffle\s*\(/m);
});

test('app.js: _suggNorm function exists', () => {
    assert.match(APP_JS, /^function _suggNorm\s*\(/m);
});

test('app.js: _suggNormStrict function exists', () => {
    assert.match(APP_JS, /^function _suggNormStrict\s*\(/m);
});

test('app.js: _suggIsInstalled function exists', () => {
    assert.match(APP_JS, /^function _suggIsInstalled\s*\(/m);
});

test('app.js: _suggOwned function exists', () => {
    assert.match(APP_JS, /^function _suggOwned\s*\(/m);
});

test('app.js: _suggScore function exists', () => {
    assert.match(APP_JS, /^function _suggScore\s*\(/m);
});

test('app.js: _suggKey function exists', () => {
    assert.match(APP_JS, /^function _suggKey\s*\(/m);
});

test('app.js: _suggIsCacheStale async function exists', () => {
    assert.match(APP_JS, /^async function _suggIsCacheStale\s*\(/m);
});

test('app.js: _buildSyncedSuggestions async function exists', () => {
    assert.match(APP_JS, /^async function _buildSyncedSuggestions\s*\(\)/m);
});

test('app.js: _suggBuildGame function exists', () => {
    assert.match(APP_JS, /^function _suggBuildGame\s*\(/m);
});

test('app.js: _suggBadge function exists', () => {
    assert.match(APP_JS, /^function _suggBadge\s*\(/m);
});

test('app.js: _suggStaleBadge function exists', () => {
    assert.match(APP_JS, /^function _suggStaleBadge\s*\(\)/m);
});

test('app.js: _suggSaveState function exists', () => {
    assert.match(APP_JS, /^function _suggSaveState\s*\(\)/m);
});

test('app.js: _suggLoadState function exists', () => {
    assert.match(APP_JS, /^function _suggLoadState\s*\(\)/m);
});

test('app.js: _suggBuildPool function exists', () => {
    assert.match(APP_JS, /^function _suggBuildPool\s*\(\)/m);
});

test('app.js: _suggDedupe function exists', () => {
    assert.match(APP_JS, /^function _suggDedupe\s*\(/m);
});

test('app.js: _suggSyncState function exists', () => {
    assert.match(APP_JS, /^function _suggSyncState\s*\(/m);
});

test('app.js: _suggSelectForFilter function exists', () => {
    assert.match(APP_JS, /^function _suggSelectForFilter\s*\(/m);
});

test('app.js: _suggStopRotation function exists', () => {
    assert.match(APP_JS, /^function _suggStopRotation\s*\(\)/m);
});

test('app.js: _suggStartRotation function exists', () => {
    assert.match(APP_JS, /^function _suggStartRotation\s*\(\)/m);
});

test('app.js: window._suggSelectGame is assigned', () => {
    assert.match(APP_JS, /window\._suggSelectGame\s*=\s*function\s*\(\s*idx\s*\)/);
});

test('app.js: window.suggViewDetails is assigned', () => {
    assert.match(APP_JS, /window\.suggViewDetails\s*=\s*function\s*\(/);
});

test('app.js: _suggHydrateArt async function exists', () => {
    assert.match(APP_JS, /^async function _suggHydrateArt\s*\(/m);
});

test('app.js: _suggReRenderOne function exists', () => {
    assert.match(APP_JS, /^function _suggReRenderOne\s*\(/m);
});

test('app.js: _suggRailMetaHtml function exists', () => {
    assert.match(APP_JS, /^function _suggRailMetaHtml\s*\(/m);
});

test('app.js: window._suggCarouselPrev is assigned', () => {
    assert.match(APP_JS, /window\._suggCarouselPrev\s*=\s*function\s*\(\)/);
});

test('app.js: window._suggCarouselNext is assigned', () => {
    assert.match(APP_JS, /window\._suggCarouselNext\s*=\s*function\s*\(\)/);
});

test('app.js: _suggCarouselSlides function exists', () => {
    assert.match(APP_JS, /^function _suggCarouselSlides\s*\(/m);
});

test('app.js: _suggUpdateCarouselSlide function exists', () => {
    assert.match(APP_JS, /^function _suggUpdateCarouselSlide\s*\(/m);
});

test('app.js: _renderSyncedFeature function exists', () => {
    assert.match(APP_JS, /^function _renderSyncedFeature\s*\(/m);
});

test('app.js: _renderSyncedRail function exists', () => {
    assert.match(APP_JS, /^function _renderSyncedRail\s*\(/m);
});

test('app.js: _suggRenderFiltered function exists', () => {
    assert.match(APP_JS, /^function _suggRenderFiltered\s*\(\)/m);
});

test('app.js: _suggUpdatePills function exists', () => {
    assert.match(APP_JS, /^function _suggUpdatePills\s*\(\)/m);
});

test('app.js: renderSyncedSuggestions async function exists', () => {
    assert.match(APP_JS, /^async function renderSyncedSuggestions\s*\(\)/m);
});

test('app.js: window.setSyncedFilter is assigned', () => {
    assert.match(APP_JS, /window\.setSyncedFilter\s*=\s*function\s*\(/);
});

test('app.js: window.suggInstall is assigned', () => {
    assert.match(APP_JS, /window\.suggInstall\s*=\s*function\s*\(/);
});

test('app.js: window._onSyncLibraryUpdated is assigned', () => {
    assert.match(APP_JS, /window\._onSyncLibraryUpdated\s*=\s*function\s*\(\)/);
});

// ── 3. _seededShuffle behaviour ───────────────────────────────────────────────

test('app.js: _seededShuffle returns a new array without mutating the input', () => {
    const fn = extractFn(APP_JS, 'function _seededShuffle(', 400);
    assert.match(fn, /\[\.\.\.\s*arr\s*\]/);
});

test('app.js: _seededShuffle uses xorshift32 PRNG (bit-shift pattern)', () => {
    const fn = extractFn(APP_JS, 'function _seededShuffle(', 400);
    assert.match(fn, /s\s*\^=\s*s\s*<<\s*13/);
    assert.match(fn, /s\s*\^=\s*s\s*>>\s*17/);
});

// ── 4. _suggNorm / _suggNormStrict behaviour ──────────────────────────────────

test('app.js: _suggNorm lowercases and strips trademark symbols', () => {
    const fn = extractFn(APP_JS, 'function _suggNorm(', 200);
    assert.match(fn, /toLowerCase/);
    assert.match(fn, /[®©™]/);
});

test('app.js: _suggNormStrict strips all non-alphanumeric characters', () => {
    const fn = extractFn(APP_JS, 'function _suggNormStrict(', 150);
    // Source contains /[^a-z0-9]/gi — verify via replace call and toLowerCase
    assert.match(fn, /\.replace\s*\(/);
    assert.match(fn, /toLowerCase\s*\(\)/);
});

// ── 5. _suggIsInstalled behaviour ─────────────────────────────────────────────

test('app.js: _suggIsInstalled delegates to _agIsInstalled when available', () => {
    const fn = extractFn(APP_JS, 'function _suggIsInstalled(', 400);
    assert.match(fn, /typeof _agIsInstalled\s*===\s*['"]function['"]/);
    assert.match(fn, /_agIsInstalled\s*\(\s*syncedGame\s*\)/);
});

test('app.js: _suggIsInstalled probes steam-prefix variants via _agBuildInstalledMap', () => {
    const fn = extractFn(APP_JS, 'function _suggIsInstalled(', 600);
    assert.match(fn, /_agBuildInstalledMap/);
    assert.match(fn, /steam-/);
});

test('app.js: _suggIsInstalled falls back to window.allGamesData when _agIsInstalled unavailable', () => {
    const fn = extractFn(APP_JS, 'function _suggIsInstalled(', 1200);
    assert.match(fn, /window\.allGamesData/);
});

// ── 6. _suggKey behaviour ─────────────────────────────────────────────────────

test('app.js: _suggKey returns a platform:id composite string', () => {
    const fn = extractFn(APP_JS, 'function _suggKey(', 120);
    assert.match(fn, /_platform/);
    assert.match(fn, /id/);
});

// ── 7. _suggIsCacheStale behaviour ────────────────────────────────────────────

test('app.js: _suggIsCacheStale calls electronAPI.platformSyncGetState', () => {
    const fn = extractFn(APP_JS, 'async function _suggIsCacheStale(', 900);
    assert.match(fn, /electronAPI\.platformSyncGetState\s*\(/);
});

test('app.js: _suggIsCacheStale returns true when phase is error', () => {
    const fn = extractFn(APP_JS, 'async function _suggIsCacheStale(', 900);
    assert.match(fn, /phase\s*===\s*['"]error['"]/);
    assert.match(fn, /return true/);
});

test('app.js: _suggIsCacheStale returns false on IPC failure', () => {
    const fn = extractFn(APP_JS, 'async function _suggIsCacheStale(', 900);
    assert.match(fn, /catch/);
    assert.match(fn, /return false/);
});

// ── 8. _buildSyncedSuggestions behaviour ─────────────────────────────────────

test('app.js: _buildSyncedSuggestions resets _suggAllGames to empty array', () => {
    const fn = extractFn(APP_JS, 'async function _buildSyncedSuggestions()', 200);
    assert.match(fn, /_suggAllGames\s*=\s*\[\]/);
});

test('app.js: _buildSyncedSuggestions calls electronAPI.platformSyncGetCached', () => {
    const fn = extractFn(APP_JS, 'async function _buildSyncedSuggestions()', 600);
    assert.match(fn, /electronAPI\.platformSyncGetCached\s*\(/);
});

test('app.js: _buildSyncedSuggestions calls electronAPI.platformSyncGetAccounts', () => {
    const fn = extractFn(APP_JS, 'async function _buildSyncedSuggestions()', 600);
    assert.match(fn, /electronAPI\.platformSyncGetAccounts\s*\(/);
});

test('app.js: _buildSyncedSuggestions sets window._suggAllGames after building', () => {
    const fn = extractFn(APP_JS, 'async function _buildSyncedSuggestions()', 3920);
    assert.match(fn, /window\._suggAllGames\s*=/);
});

test('app.js: _buildSyncedSuggestions sets window.__platformLibraryReady', () => {
    const fn = extractFn(APP_JS, 'async function _buildSyncedSuggestions()', 3920);
    assert.match(fn, /window\.__platformLibraryReady/);
});

test('app.js: _buildSyncedSuggestions uses _suggIsInstalled to filter out already-installed games', () => {
    const fn = extractFn(APP_JS, 'async function _buildSyncedSuggestions()', 3000);
    assert.match(fn, /_suggIsInstalled\s*\(/);
});

// ── 9. _suggBuildGame behaviour ───────────────────────────────────────────────

test('app.js: _suggBuildGame maps synced game fields to local game shape', () => {
    const fn = extractFn(APP_JS, 'function _suggBuildGame(', 500);
    assert.match(fn, /id:/);
    assert.match(fn, /name:/);
    assert.match(fn, /image:/);
    assert.match(fn, /platform:/);
    assert.match(fn, /platforms:/);
});

test('app.js: _suggBuildGame copies appName, namespace, catalogItemId, allIds', () => {
    const fn = extractFn(APP_JS, 'function _suggBuildGame(', 500);
    assert.match(fn, /appName:/);
    assert.match(fn, /namespace:/);
    assert.match(fn, /catalogItemId:/);
    assert.match(fn, /allIds:/);
});

// ── 10. _suggBuildPool behaviour ──────────────────────────────────────────────

test('app.js: _suggBuildPool calls _suggLoadState for bucket-restore logic', () => {
    const fn = extractFn(APP_JS, 'function _suggBuildPool()', 1800);
    assert.match(fn, /_suggLoadState\s*\(\)/);
});

test('app.js: _suggBuildPool calls _suggSyncState with computed bucket', () => {
    const fn = extractFn(APP_JS, 'function _suggBuildPool()', 1800);
    assert.match(fn, /_suggSyncState\s*\(\s*bucket\s*\)/);
});

test('app.js: _suggBuildPool calls _suggSaveState after building a fresh pool', () => {
    const fn = extractFn(APP_JS, 'function _suggBuildPool()', 1800);
    assert.match(fn, /_suggSaveState\s*\(\)/);
});

test('app.js: _suggBuildPool calls _suggSelectForFilter to select games', () => {
    const fn = extractFn(APP_JS, 'function _suggBuildPool()', 1800);
    assert.match(fn, /_suggSelectForFilter\s*\(\s*_suggFilter/);
});

// ── 11. _suggDedupe behaviour ─────────────────────────────────────────────────

test('app.js: _suggDedupe removes duplicates by _suggKey', () => {
    const fn = extractFn(APP_JS, 'function _suggDedupe(', 250);
    assert.match(fn, /_suggKey\s*\(/);
    assert.match(fn, /seen/);
});

// ── 12. _suggSelectForFilter behaviour ───────────────────────────────────────

test('app.js: _suggSelectForFilter uses _seededShuffle for deterministic order', () => {
    const fn = extractFn(APP_JS, 'function _suggSelectForFilter(', 350);
    assert.match(fn, /_seededShuffle\s*\(\s*_suggAllGames/);
});

test('app.js: _suggSelectForFilter filters by platform when filter is not "all"', () => {
    const fn = extractFn(APP_JS, 'function _suggSelectForFilter(', 350);
    assert.match(fn, /_platform\s*===\s*filter/);
});

// ── 13. _suggStartRotation behaviour ─────────────────────────────────────────

test('app.js: _suggStartRotation calls _suggStopRotation first', () => {
    const fn = extractFn(APP_JS, 'function _suggStartRotation()', 400);
    const stopIdx  = fn.indexOf('_suggStopRotation()');
    const timerIdx = fn.indexOf('setInterval');
    assert.ok(stopIdx > -1, '_suggStopRotation must be called');
    assert.ok(timerIdx > -1, 'setInterval must be set up');
    assert.ok(stopIdx < timerIdx, '_suggStopRotation must come before setInterval');
});

test('app.js: _suggStartRotation uses _SUGG_ROTATE_MS as the interval delay', () => {
    const fn = extractFn(APP_JS, 'function _suggStartRotation()', 400);
    assert.match(fn, /_SUGG_ROTATE_MS/);
});

test('app.js: _suggStartRotation advances _suggPoolIdx in the interval callback', () => {
    const fn = extractFn(APP_JS, 'function _suggStartRotation()', 400);
    assert.match(fn, /_suggPoolIdx\s*=\s*\(/);
    assert.match(fn, /_suggPool\.length/);
});

// ── 14. _suggStopRotation behaviour ──────────────────────────────────────────

test('app.js: _suggStopRotation clears _suggRotateTimer and resets it to null', () => {
    const fn = extractFn(APP_JS, 'function _suggStopRotation()', 150);
    assert.match(fn, /clearInterval\s*\(\s*_suggRotateTimer\s*\)/);
    assert.match(fn, /_suggRotateTimer\s*=\s*null/);
});

// ── 15. window._suggSelectGame behaviour ─────────────────────────────────────

test('app.js: _suggSelectGame guards against out-of-range index', () => {
    const fn = extractFn(APP_JS, 'window._suggSelectGame = function(', 300);
    assert.match(fn, /idx\s*<\s*0\s*\|\|\s*idx\s*>=\s*_suggPool\.length/);
    assert.match(fn, /return/);
});

test('app.js: _suggSelectGame updates _suggPoolIdx and restarts rotation', () => {
    const fn = extractFn(APP_JS, 'window._suggSelectGame = function(', 300);
    assert.match(fn, /_suggPoolIdx\s*=\s*idx/);
    assert.match(fn, /_suggStartRotation\s*\(\)/);
});

test('app.js: _suggSelectGame calls _renderSyncedRail and _renderSyncedFeature', () => {
    const fn = extractFn(APP_JS, 'window._suggSelectGame = function(', 300);
    assert.match(fn, /_renderSyncedRail\s*\(\s*_suggPool\s*\)/);
    assert.match(fn, /_renderSyncedFeature\s*\(/);
});

// ── 16. window.suggViewDetails behaviour ─────────────────────────────────────

test('app.js: suggViewDetails looks up game in _suggAllGames by platform and id', () => {
    const fn = extractFn(APP_JS, 'window.suggViewDetails = function(', 500);
    assert.match(fn, /_suggAllGames\.find/);
    assert.match(fn, /_platform\s*===\s*platform/);
});

test('app.js: suggViewDetails sets window._gdSyncedGameOverride before opening details', () => {
    const fn = extractFn(APP_JS, 'window.suggViewDetails = function(', 500);
    const overrideIdx = fn.indexOf('_gdSyncedGameOverride');
    // Use the actual call (not the comment) by searching for 'openGameDetails('
    const openIdx     = fn.indexOf('openGameDetails(');
    assert.ok(overrideIdx > -1, '_gdSyncedGameOverride must be set');
    assert.ok(openIdx > -1, 'openGameDetails must be called');
    assert.ok(overrideIdx < openIdx, '_gdSyncedGameOverride must be set before openGameDetails call');
});

test('app.js: suggViewDetails uses _suggBuildGame to convert the synced game object', () => {
    const fn = extractFn(APP_JS, 'window.suggViewDetails = function(', 500);
    assert.match(fn, /_suggBuildGame\s*\(\s*g\s*\)/);
});

// ── 17. _suggHydrateArt behaviour ────────────────────────────────────────────

test('app.js: _suggHydrateArt calls electronAPI.getMetadata for art enrichment', () => {
    const fn = extractFn(APP_JS, 'async function _suggHydrateArt(', 1300);
    assert.match(fn, /electronAPI\.getMetadata\s*\(/);
});

test('app.js: _suggHydrateArt guards against duplicate in-flight requests via hydratingGameIds', () => {
    const fn = extractFn(APP_JS, 'async function _suggHydrateArt(', 450);
    assert.match(fn, /hydratingGameIds\.has\s*\(/);
    assert.match(fn, /hydratedGameIds\.has\s*\(/);
});

test('app.js: _suggHydrateArt respects _SUGG_HYDRATE_CONCURRENCY limit', () => {
    const fn = extractFn(APP_JS, 'async function _suggHydrateArt(', 600);
    assert.match(fn, /_suggHydrateActive\s*>=\s*_SUGG_HYDRATE_CONCURRENCY/);
});

test('app.js: _suggHydrateArt calls _suggReRenderOne after fetching art', () => {
    const fn = extractFn(APP_JS, 'async function _suggHydrateArt(', 5280);
    assert.match(fn, /_suggReRenderOne\s*\(/);
});

// ── 18. _suggCarouselSlides behaviour ────────────────────────────────────────

test('app.js: _suggCarouselSlides returns metaScreenshots when available', () => {
    const fn = extractFn(APP_JS, 'function _suggCarouselSlides(', 250);
    assert.match(fn, /_metaScreenshots/);
});

test('app.js: _suggCarouselSlides falls back to heroImage when no screenshots', () => {
    const fn = extractFn(APP_JS, 'function _suggCarouselSlides(', 250);
    assert.match(fn, /heroImage/);
    assert.match(fn, /fallback/);
});

// ── 19. _suggUpdateCarouselSlide behaviour ────────────────────────────────────

test('app.js: _suggUpdateCarouselSlide updates #suggCarouselStage element', () => {
    const fn = extractFn(APP_JS, 'function _suggUpdateCarouselSlide(', 550);
    assert.match(fn, /getElementById\s*\(\s*['"]suggCarouselStage['"]\s*\)/);
});

test('app.js: _suggUpdateCarouselSlide updates carousel pip dots', () => {
    const fn = extractFn(APP_JS, 'function _suggUpdateCarouselSlide(', 550);
    assert.match(fn, /\.sugg-carousel-pip/);
    assert.match(fn, /classList\.toggle\s*\(\s*['"]active['"]/);
});

test('app.js: _suggUpdateCarouselSlide shows/hides prev/next buttons based on slide count', () => {
    const fn = extractFn(APP_JS, 'function _suggUpdateCarouselSlide(', 750);
    assert.match(fn, /getElementById\s*\(\s*['"]suggCarouselPrev['"]\s*\)/);
    assert.match(fn, /getElementById\s*\(\s*['"]suggCarouselNext['"]\s*\)/);
});

// ── 20. _suggCarouselPrev / _suggCarouselNext behaviour ───────────────────────

test('app.js: _suggCarouselPrev returns early when no featured game', () => {
    const fn = extractFn(APP_JS, 'window._suggCarouselPrev = function()', 250);
    assert.match(fn, /if\s*\(\s*!_suggFeaturedGame\s*\)\s*return/);
});

test('app.js: _suggCarouselPrev decrements _suggCarouselIdx with wrap-around', () => {
    const fn = extractFn(APP_JS, 'window._suggCarouselPrev = function()', 250);
    assert.match(fn, /_suggCarouselIdx\s*-\s*1/);
    assert.match(fn, /slides\.length/);
});

test('app.js: _suggCarouselNext increments _suggCarouselIdx with wrap-around', () => {
    const fn = extractFn(APP_JS, 'window._suggCarouselNext = function()', 250);
    assert.match(fn, /_suggCarouselIdx\s*\+\s*1/);
    assert.match(fn, /slides\.length/);
});

// ── 21. _renderSyncedFeature behaviour ───────────────────────────────────────

test('app.js: _renderSyncedFeature uses #syncedFeatureWrap element', () => {
    const fn = extractFn(APP_JS, 'function _renderSyncedFeature(', 300);
    assert.match(fn, /getElementById\s*\(\s*['"]syncedFeatureWrap['"]\s*\)/);
});

test('app.js: _renderSyncedFeature sets _suggFeaturedGame reference', () => {
    const fn = extractFn(APP_JS, 'function _renderSyncedFeature(', 400);
    assert.match(fn, /_suggFeaturedGame\s*=\s*g/);
});

test('app.js: _renderSyncedFeature wires window.suggInstall in generated onclick', () => {
    const fn = extractFn(APP_JS, 'function _renderSyncedFeature(', 2700);
    assert.match(fn, /suggInstall\s*\(/);
});

test('app.js: _renderSyncedFeature wires window.suggViewDetails in generated onclick', () => {
    const fn = extractFn(APP_JS, 'function _renderSyncedFeature(', 2700);
    assert.match(fn, /suggViewDetails\s*\(/);
});

// ── 22. _renderSyncedRail behaviour ───────────────────────────────────────────

test('app.js: _renderSyncedRail uses #syncedRail element', () => {
    const fn = extractFn(APP_JS, 'function _renderSyncedRail(', 600);
    assert.match(fn, /getElementById\s*\(\s*['"]syncedRail['"]\s*\)/);
});

test('app.js: _renderSyncedRail wires window._suggSelectGame in generated onclick', () => {
    const fn = extractFn(APP_JS, 'function _renderSyncedRail(', 1400);
    assert.match(fn, /_suggSelectGame\s*\(/);
});

test('app.js: _renderSyncedRail uses escapeHtml for game titles', () => {
    const fn = extractFn(APP_JS, 'function _renderSyncedRail(', 1700);
    assert.match(fn, /escapeHtml\s*\(/);
});

// ── 23. _suggRenderFiltered behaviour ─────────────────────────────────────────

test('app.js: _suggRenderFiltered calls _suggBuildPool then renders feature and rail', () => {
    const fn = extractFn(APP_JS, 'function _suggRenderFiltered()', 420);
    const buildIdx   = fn.indexOf('_suggBuildPool()');
    const featureIdx = fn.indexOf('_renderSyncedFeature(');
    const railIdx    = fn.indexOf('_renderSyncedRail(');
    assert.ok(buildIdx > -1, '_suggBuildPool must be called');
    assert.ok(featureIdx > -1, '_renderSyncedFeature must be called');
    assert.ok(railIdx > -1, '_renderSyncedRail must be called');
    assert.ok(buildIdx < featureIdx, '_suggBuildPool must come before _renderSyncedFeature');
});

test('app.js: _suggRenderFiltered calls _suggStartRotation', () => {
    const fn = extractFn(APP_JS, 'function _suggRenderFiltered()', 450);
    assert.match(fn, /_suggStartRotation\s*\(\)/);
});

// ── 24. _suggUpdatePills behaviour ────────────────────────────────────────────

test('app.js: _suggUpdatePills shows/hides Steam pill based on presence in _suggAllGames', () => {
    const fn = extractFn(APP_JS, 'function _suggUpdatePills()', 400);
    assert.match(fn, /_suggAllGames\.some/);
    assert.match(fn, /\[data-filter="steam"\]/);
    assert.match(fn, /style\.display/);
});

test('app.js: _suggUpdatePills shows/hides Epic pill based on presence in _suggAllGames', () => {
    const fn = extractFn(APP_JS, 'function _suggUpdatePills()', 400);
    assert.match(fn, /\[data-filter="epic"\]/);
});

// ── 25. renderSyncedSuggestions behaviour ────────────────────────────────────

test('app.js: renderSyncedSuggestions calls _suggStopRotation at entry', () => {
    const fn = extractFn(APP_JS, 'async function renderSyncedSuggestions()', 200);
    assert.match(fn, /_suggStopRotation\s*\(\)/);
});

test('app.js: renderSyncedSuggestions uses all expected section DOM IDs', () => {
    const fn = extractFn(APP_JS, 'async function renderSyncedSuggestions()', 600);
    assert.match(fn, /syncedSuggestionsSection/);
    assert.match(fn, /syncedSuggLoading/);
    assert.match(fn, /syncedSuggEmpty/);
    assert.match(fn, /syncedSuggCTA/);
    assert.match(fn, /syncedSuggBody/);
    assert.match(fn, /syncedSuggStats/);
});

test('app.js: renderSyncedSuggestions calls electronAPI.platformSyncGetAccounts per platform', () => {
    const fn = extractFn(APP_JS, 'async function renderSyncedSuggestions()', 1000);
    assert.match(fn, /electronAPI\.platformSyncGetAccounts\s*\(/);
});

test('app.js: renderSyncedSuggestions calls _buildSyncedSuggestions after account check', () => {
    const fn = extractFn(APP_JS, 'async function renderSyncedSuggestions()', 2300);
    const accountIdx = fn.indexOf('platformSyncGetAccounts');
    const buildIdx   = fn.indexOf('_buildSyncedSuggestions()');
    assert.ok(accountIdx > -1, 'platformSyncGetAccounts must be called');
    assert.ok(buildIdx > -1, '_buildSyncedSuggestions must be called');
    assert.ok(accountIdx < buildIdx, 'accounts must be checked before building suggestions');
});

// ── 26. window.setSyncedFilter behaviour ─────────────────────────────────────

test('app.js: setSyncedFilter stops rotation and resets pool state', () => {
    const fn = extractFn(APP_JS, 'window.setSyncedFilter = function(', 350);
    assert.match(fn, /_suggStopRotation\s*\(\)/);
    assert.match(fn, /_suggPool\s*=\s*\[\]/);
    assert.match(fn, /_suggPoolTs\s*=\s*0/);
});

test('app.js: setSyncedFilter updates _suggFilter and calls _suggRenderFiltered', () => {
    const fn = extractFn(APP_JS, 'window.setSyncedFilter = function(', 350);
    assert.match(fn, /_suggFilter\s*=\s*filter/);
    assert.match(fn, /_suggRenderFiltered\s*\(\)/);
});

test('app.js: setSyncedFilter toggles active class on the pill buttons', () => {
    const fn = extractFn(APP_JS, 'window.setSyncedFilter = function(', 350);
    assert.match(fn, /\.sugg-pill/);
    assert.match(fn, /classList\.remove\s*\(\s*['"]active['"]\s*\)/);
});

// ── 27. window.suggInstall behaviour ─────────────────────────────────────────

test('app.js: suggInstall looks up game in _suggAllGames by platform and id', () => {
    const fn = extractFn(APP_JS, 'window.suggInstall = function(', 350);
    assert.match(fn, /_suggAllGames\.find/);
    assert.match(fn, /_platform\s*===\s*platform/);
});

test('app.js: suggInstall delegates to window._gdOpenInstallPickerForGame', () => {
    const fn = extractFn(APP_JS, 'window.suggInstall = function(', 350);
    assert.match(fn, /window\._gdOpenInstallPickerForGame\s*\(/);
});

test('app.js: suggInstall builds the game object via _suggBuildGame before passing to install picker', () => {
    const fn = extractFn(APP_JS, 'window.suggInstall = function(', 350);
    const buildIdx  = fn.indexOf('_suggBuildGame(');
    const pickerIdx = fn.indexOf('_gdOpenInstallPickerForGame(');
    assert.ok(buildIdx > -1, '_suggBuildGame must be called');
    assert.ok(pickerIdx > -1, '_gdOpenInstallPickerForGame must be called');
    assert.ok(buildIdx < pickerIdx, '_suggBuildGame must come before _gdOpenInstallPickerForGame');
});

// ── 28. window._onSyncLibraryUpdated behaviour ───────────────────────────────

test('app.js: _onSyncLibraryUpdated only re-renders when currentView is "home"', () => {
    const fn = extractFn(APP_JS, 'window._onSyncLibraryUpdated = function()', 200);
    assert.match(fn, /currentView\s*===\s*['"]home['"]/);
});

test('app.js: _onSyncLibraryUpdated stops rotation then calls renderSyncedSuggestions', () => {
    const fn = extractFn(APP_JS, 'window._onSyncLibraryUpdated = function()', 200);
    const stopIdx   = fn.indexOf('_suggStopRotation()');
    const renderIdx = fn.indexOf('renderSyncedSuggestions()');
    assert.ok(stopIdx > -1, '_suggStopRotation must be called');
    assert.ok(renderIdx > -1, 'renderSyncedSuggestions must be called');
    assert.ok(stopIdx < renderIdx, '_suggStopRotation must come before renderSyncedSuggestions');
});

// ── 29. _suggSaveState / _suggLoadState behaviour ────────────────────────────

test('app.js: _suggSaveState writes to localStorage using _SUGG_STATE_KEY', () => {
    const fn = extractFn(APP_JS, 'function _suggSaveState()', 200);
    assert.match(fn, /localStorage\.setItem\s*\(\s*_SUGG_STATE_KEY/);
});

test('app.js: _suggSaveState stores filter, bucket, poolKeys, activeIdx, timestamp', () => {
    const fn = extractFn(APP_JS, 'function _suggSaveState()', 350);
    assert.match(fn, /filter:/);
    assert.match(fn, /bucket:/);
    assert.match(fn, /poolKeys:/);
    assert.match(fn, /activeIdx:/);
    assert.match(fn, /timestamp:/);
});

test('app.js: _suggLoadState reads from localStorage using _SUGG_STATE_KEY', () => {
    const fn = extractFn(APP_JS, 'function _suggLoadState()', 150);
    assert.match(fn, /localStorage\.getItem\s*\(\s*_SUGG_STATE_KEY/);
});

test('app.js: _suggLoadState returns null on parse failure', () => {
    const fn = extractFn(APP_JS, 'function _suggLoadState()', 150);
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

test('app.js: suggestion code depends on electronAPI.platformSyncGetState', () => {
    assert.match(APP_JS, /electronAPI\.platformSyncGetState\s*\(/);
});

test('app.js: suggestion code depends on electronAPI.platformSyncGetCached', () => {
    assert.match(APP_JS, /electronAPI\.platformSyncGetCached\s*\(/);
});

test('app.js: suggestion code depends on electronAPI.platformSyncGetAccounts', () => {
    const count = (APP_JS.match(/electronAPI\.platformSyncGetAccounts\s*\(/g) || []).length;
    assert.ok(count >= 2, 'platformSyncGetAccounts used in _buildSyncedSuggestions and renderSyncedSuggestions');
});

test('app.js: suggestion code depends on electronAPI.getMetadata for art hydration', () => {
    assert.match(APP_JS, /electronAPI\.getMetadata\s*\(/);
});

// ── 32. Intentional cross-file dependencies ───────────────────────────────────

test('app.js: _suggIsInstalled depends on _agIsInstalled from accounts.js helpers', () => {
    assert.match(APP_JS, /_agIsInstalled\s*\(/);
});

test('app.js: _suggIsInstalled depends on _agBuildInstalledMap from accounts.js helpers', () => {
    assert.match(APP_JS, /_agBuildInstalledMap\s*\(/);
});

test('app.js: suggestion code depends on window.allGamesData as installed-game fallback', () => {
    const fn = extractFn(APP_JS, 'function _suggIsInstalled(', 1200);
    assert.match(fn, /window\.allGamesData/);
});

test('app.js: _renderSyncedRail depends on escapeHtml', () => {
    const fn = extractFn(APP_JS, 'function _renderSyncedRail(', 1700);
    assert.match(fn, /escapeHtml\s*\(/);
});

test('app.js: _renderSyncedFeature depends on isUsableImageUrl from artwork-sync.js', () => {
    const fn = extractFn(APP_JS, 'function _renderSyncedFeature(', 700);
    assert.match(fn, /isUsableImageUrl\s*\(/);
});

test('app.js: _suggReRenderOne depends on setHeroBgStable from artwork-sync.js', () => {
    const fn = extractFn(APP_JS, 'function _suggReRenderOne(', 1200);
    assert.match(fn, /setHeroBgStable\s*\(/);
});

test('app.js: _suggReRenderOne depends on setCardImageStable from artwork-sync.js', () => {
    const fn = extractFn(APP_JS, 'function _suggReRenderOne(', 2800);
    assert.match(fn, /setCardImageStable\s*\(/);
});

test('app.js: suggViewDetails depends on openGameDetails from app.js', () => {
    const fn = extractFn(APP_JS, 'window.suggViewDetails = function(', 500);
    assert.match(fn, /openGameDetails\s*\(/);
});

test('app.js: suggViewDetails sets window._gdSyncedGameOverride for game-details.js handoff', () => {
    const fn = extractFn(APP_JS, 'window.suggViewDetails = function(', 500);
    assert.match(fn, /window\._gdSyncedGameOverride\s*=/);
});

test('app.js: suggInstall depends on window._gdOpenInstallPickerForGame from game-details.js', () => {
    const fn = extractFn(APP_JS, 'window.suggInstall = function(', 350);
    assert.match(fn, /window\._gdOpenInstallPickerForGame/);
});

test('app.js: _onSyncLibraryUpdated depends on currentView to guard re-render', () => {
    const fn = extractFn(APP_JS, 'window._onSyncLibraryUpdated = function()', 200);
    assert.match(fn, /currentView/);
});

// ── 33. Isolation tests ───────────────────────────────────────────────────────

test('app.js: _suggBuildPool does not call quick-switcher internals', () => {
    const fn = extractFn(APP_JS, 'function _suggBuildPool()', 1800);
    assert.doesNotMatch(fn, /openSettingsQuickSwitcher|closeSettingsQuickSwitcher|renderQuickSwitcher/);
});

test('app.js: renderSyncedSuggestions does not call system-stats internals', () => {
    const fn = extractFn(APP_JS, 'async function renderSyncedSuggestions()', 3000);
    assert.doesNotMatch(fn, /initSystemStats|_hudInterval|checkAndManagePolling/);
});

test('app.js: _renderSyncedFeature does not call collection settings modal internals', () => {
    const fn = extractFn(APP_JS, 'function _renderSyncedFeature(', 2700);
    assert.doesNotMatch(fn, /openCollectionSettings|closeCollectionSettings|saveCollectionSettings/);
});

test('app.js: _renderSyncedRail does not call context menu internals', () => {
    const fn = extractFn(APP_JS, 'function _renderSyncedRail(', 1700);
    assert.doesNotMatch(fn, /showContextMenu|hideContextMenu|triggerRemove/);
});

test('app.js: renderSyncedSuggestions does not call account display preference internals', () => {
    const fn = extractFn(APP_JS, 'async function renderSyncedSuggestions()', 3000);
    assert.doesNotMatch(fn, /renderPlatformPanels|updateDisplayPrefs|applyDisplayPreferences/);
});

test('app.js: _buildSyncedSuggestions does not call game context action internals', () => {
    const fn = extractFn(APP_JS, 'async function _buildSyncedSuggestions()', 3000);
    assert.doesNotMatch(fn, /confirmDeleteAction|triggerRemove|_toggleCardFavorite/);
});

// ── 34. Comment hygiene ───────────────────────────────────────────────────────

test('app.js (suggestion range): no Arabic-script characters near suggestion functions', () => {
    const start = APP_JS.indexOf('let _suggAllGames');
    const end   = APP_JS.indexOf('window._onSyncLibraryUpdated');
    assert.ok(start > -1 && end > start, 'suggestion range must be locatable');
    const slice = APP_JS.slice(start, end + 200);
    assert.doesNotMatch(slice, /[؀-ۿ]/);
});
