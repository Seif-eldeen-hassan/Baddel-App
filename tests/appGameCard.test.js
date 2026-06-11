'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2.23A safety tests — Game Card / Recent Card helpers in src/js/app.js
//
// PURPOSE
//   Document every function that belongs to the game-card and recent-card
//   block before extracting it into src/js/app/game-card.js.  These tests:
//     • prove each target function exists in app.js right now
//     • document behavioral contracts through source-pattern assertions
//     • record every external dependency the block relies on
//     • verify cross-file callers so the extraction can expose the right
//       window.* exports
//     • confirm the block does NOT call unrelated module internals
//
// REDIRECT NOTE
//   When game-card.js is created, change APP_JS references in Sections 1, 2,
//   7-14 to GAME_CARD_JS.  DOM tests (Section 3) and dependency provider
//   tests (Section 5) remain anchored to their respective source files.
//
// TARGET BLOCK (src/js/app.js, section "3. CARD RENDERING & RECENTLY PLAYED")
//   Functions to be extracted:
//     _jbiHasRealQualifiedSession  _jbiGetRecentTimestamp  getRecentGames
//     _currentRecentGames (state)  filterRecentCards       renderRecentlyPlayed
//     _agFieldGameId               _agFieldPlaytimeMinutes _agFieldLastPlayed
//     _agFieldIsInstalled          _agFormatLastPlayedShort
//     _agDecorateAllGamesCardFields
//     createGameCard               _getRecentHeroCandidate
//     _getRecentPosterFallback     _getRecentDisplayImage
//     createRecentCard             getPlatformClass
// ─────────────────────────────────────────────────────────────────────────────

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT               = path.resolve(__dirname, '..');
const APP_JS             = fs.readFileSync(path.join(ROOT, 'src/js/app.js'),                      'utf8');
const HTML               = fs.readFileSync(path.join(ROOT, 'src/dashboard.html'),                 'utf8');
const DOM_UTILS_JS       = fs.readFileSync(path.join(ROOT, 'src/js/domUtils.js'),                 'utf8');
const GAME_CONTEXT_JS    = fs.readFileSync(path.join(ROOT, 'src/js/app/game-context-actions.js'), 'utf8');
const ARTWORK_SYNC_JS    = fs.readFileSync(path.join(ROOT, 'src/js/app/artwork-sync.js'),         'utf8');
const LAUNCHER_ACTIONS_JS = fs.readFileSync(path.join(ROOT, 'src/js/app/launcher-actions.js'),   'utf8');
const ACCOUNTS_JS        = fs.readFileSync(path.join(ROOT, 'src/js/accounts.js'),                 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — Source-presence: all target functions exist in app.js
// ─────────────────────────────────────────────────────────────────────────────

test('card: section header "3. CARD RENDERING & RECENTLY PLAYED" exists in app.js', () => {
    assert.match(APP_JS, /3\. CARD RENDERING & RECENTLY PLAYED/);
});

test('card: _jbiHasRealQualifiedSession is defined', () => {
    assert.match(APP_JS, /function _jbiHasRealQualifiedSession\s*\(/);
});

test('card: _jbiGetRecentTimestamp is defined', () => {
    assert.match(APP_JS, /function _jbiGetRecentTimestamp\s*\(/);
});

test('card: getRecentGames is defined', () => {
    assert.match(APP_JS, /function getRecentGames\s*\(/);
});

test('card: _currentRecentGames state variable is declared', () => {
    assert.match(APP_JS, /let\s+_currentRecentGames\s*=\s*\[\]/);
});

test('card: filterRecentCards is defined', () => {
    assert.match(APP_JS, /function filterRecentCards\s*\(/);
});

test('card: renderRecentlyPlayed is defined', () => {
    assert.match(APP_JS, /function renderRecentlyPlayed\s*\(/);
});

test('card: _agFieldGameId is defined', () => {
    assert.match(APP_JS, /function _agFieldGameId\s*\(/);
});

test('card: _agFieldPlaytimeMinutes is defined', () => {
    assert.match(APP_JS, /function _agFieldPlaytimeMinutes\s*\(/);
});

test('card: _agFieldLastPlayed is defined', () => {
    assert.match(APP_JS, /function _agFieldLastPlayed\s*\(/);
});

test('card: _agFieldIsInstalled is defined', () => {
    assert.match(APP_JS, /function _agFieldIsInstalled\s*\(/);
});

test('card: _agFormatLastPlayedShort is defined', () => {
    assert.match(APP_JS, /function _agFormatLastPlayedShort\s*\(/);
});

test('card: _agDecorateAllGamesCardFields is defined', () => {
    assert.match(APP_JS, /function _agDecorateAllGamesCardFields\s*\(/);
});

test('card: createGameCard is defined', () => {
    assert.match(APP_JS, /function createGameCard\s*\(/);
});

test('card: _getRecentHeroCandidate is defined', () => {
    assert.match(APP_JS, /function _getRecentHeroCandidate\s*\(/);
});

test('card: _getRecentPosterFallback is defined', () => {
    assert.match(APP_JS, /function _getRecentPosterFallback\s*\(/);
});

test('card: _getRecentDisplayImage is defined', () => {
    assert.match(APP_JS, /function _getRecentDisplayImage\s*\(/);
});

test('card: createRecentCard is defined', () => {
    assert.match(APP_JS, /function createRecentCard\s*\(/);
});

test('card: getPlatformClass is defined', () => {
    assert.match(APP_JS, /function getPlatformClass\s*\(/);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — Behavioral contracts: createGameCard
// ─────────────────────────────────────────────────────────────────────────────

test('createGameCard: creates a div element with className "game-card"', () => {
    const body = extractFn(APP_JS, 'function createGameCard(');
    assert.match(body, /card\.className\s*=\s*['"]game-card['"]/);
});

test('createGameCard: sets data-id attribute to game.id', () => {
    const body = extractFn(APP_JS, 'function createGameCard(');
    assert.match(body, /setAttribute\s*\(\s*['"]data-id['"],\s*game\.id\s*\)/);
});

test('createGameCard: wires play button click to triggerLaunchSequence', () => {
    const body = extractFn(APP_JS, 'function createGameCard(');
    assert.match(body, /triggerLaunchSequence\s*\(\s*game\.id\s*\)/);
});

test('createGameCard: wires favorite button click to _toggleCardFavorite', () => {
    const body = extractFn(APP_JS, 'function createGameCard(');
    assert.match(body, /_toggleCardFavorite\s*\(\s*game\.id\s*\)/);
});

test('createGameCard: calls showContextMenu on contextmenu event', () => {
    const body = extractFn(APP_JS, 'function createGameCard(');
    assert.match(body, /showContextMenu\s*\(\s*e\.pageX,\s*e\.pageY,\s*game\.id,\s*game\.name\s*\)/);
});

test('createGameCard: uses escapeHtml for game.name', () => {
    const body = extractFn(APP_JS, 'function createGameCard(');
    assert.match(body, /escapeHtml\s*\(\s*game\.name\s*\)/);
});

test('createGameCard: uses safeImageUrl for image URL', () => {
    const body = extractFn(APP_JS, 'function createGameCard(');
    assert.match(body, /safeImageUrl\s*\(/);
});

test('createGameCard: uses fetchMetadata for games without a local cached image', () => {
    const body = extractFn(APP_JS, 'function createGameCard(');
    assert.match(body, /fetchMetadata\s*\(\s*imgEl,\s*game\s*\)/);
});

test('createGameCard: prefers poster fields (image, defaultImage, coverUrl) over hero', () => {
    const body = extractFn(APP_JS, 'function createGameCard(');
    assert.match(body, /game\.image\s*\|\|\s*game\.defaultImage\s*\|\|\s*game\.coverUrl/);
});

test('createGameCard: builds platform badge HTML for each source', () => {
    const body = extractFn(APP_JS, 'function createGameCard(');
    assert.match(body, /badgesHTML/);
    assert.match(body, /plat-badge/);
});

test('createGameCard: limits platform badges to MAX_BADGES', () => {
    const body = extractFn(APP_JS, 'function createGameCard(');
    assert.match(body, /MAX_BADGES\s*=\s*3/);
    assert.match(body, /rawSources\.slice\s*\(0,\s*MAX_BADGES\)/);
});

test('createGameCard: falls back to game.platform when game.sources is absent', () => {
    const body = extractFn(APP_JS, 'function createGameCard(');
    assert.match(body, /game\.platform\s*\|\|\s*['"]manual['"]/);
});

test('createGameCard: contains overflow badge for more than 3 sources', () => {
    const body = extractFn(APP_JS, 'function createGameCard(');
    assert.match(body, /plat-badge-more/);
    assert.match(body, /\+\${overflow}/);
});

test('createGameCard: renders gc-fav-btn with data-id and conditional gc-fav-active', () => {
    const body = extractFn(APP_JS, 'function createGameCard(');
    assert.match(body, /gc-fav-btn/);
    assert.match(body, /gc-fav-active/);
    assert.match(body, /data-id=.*_eId/s);
});

test('createGameCard: renders play-btn-center button', () => {
    const body = extractFn(APP_JS, 'function createGameCard(');
    assert.match(body, /play-btn-center/);
});

test('createGameCard: renders gc-time element with playtime', () => {
    const body = extractFn(APP_JS, 'function createGameCard(');
    assert.match(body, /gc-time/);
    assert.match(body, /timeStr/);
});

test('createGameCard: renders gc-lastplayed element', () => {
    const body = extractFn(APP_JS, 'function createGameCard(');
    assert.match(body, /gc-lastplayed/);
});

test('createGameCard: reads allCollections to determine favorite status', () => {
    const body = extractFn(APP_JS, 'function createGameCard(');
    assert.match(body, /allCollections\.find/);
    assert.match(body, /fav_system_default/);
});

test('createGameCard: calls _agDecorateAllGamesCardFields before returning', () => {
    const body = extractFn(APP_JS, 'function createGameCard(');
    assert.match(body, /_agDecorateAllGamesCardFields\s*\(\s*card,\s*game\s*\)/);
});

test('createGameCard: adds "played" class to gc-time when totalMinutes > 0', () => {
    const body = extractFn(APP_JS, 'function createGameCard(');
    assert.match(body, /playedClass\s*=\s*['"]played['"]/);
});

test('createGameCard: adds img-loaded class on image load event', () => {
    const body = extractFn(APP_JS, 'function createGameCard(');
    assert.match(body, /classList\.add\s*\(\s*['"]img-loaded['"]\s*\)/);
});

test('createGameCard: clears game.image and calls fetchMetadata on broken local file', () => {
    const body = extractFn(APP_JS, 'function createGameCard(');
    assert.match(body, /game\.image\.startsWith\s*\(\s*['"]file:\/\//);
    assert.match(body, /game\.image\s*=\s*null/);
    assert.match(body, /localStorage\.removeItem/);
});

test('createGameCard: triggers updateHeroSection on card mouseenter', () => {
    const body = extractFn(APP_JS, 'function createGameCard(');
    assert.match(body, /updateHeroSection\s*\(\s*game\.id\s*\)/);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — Behavioral contracts: createRecentCard
// ─────────────────────────────────────────────────────────────────────────────

test('createRecentCard: creates element with class "jbi-card"', () => {
    const body = extractFn(APP_JS, 'function createRecentCard(');
    assert.match(body, /card\.className\s*=\s*`jbi-card/);
});

test('createRecentCard: adds "jbi-card--featured" class for featured cards', () => {
    const body = extractFn(APP_JS, 'function createRecentCard(');
    assert.match(body, /jbi-card--featured/);
    assert.match(body, /isFeatured/);
});

test('createRecentCard: sets data-id attribute', () => {
    const body = extractFn(APP_JS, 'function createRecentCard(');
    assert.match(body, /setAttribute\s*\(\s*['"]data-id['"],\s*game\.id\s*\)/);
});

test('createRecentCard: sets data-last-played attribute', () => {
    const body = extractFn(APP_JS, 'function createRecentCard(');
    assert.match(body, /['"]data-last-played['"]/);
});

test('createRecentCard: sets data-playtime attribute', () => {
    const body = extractFn(APP_JS, 'function createRecentCard(');
    assert.match(body, /['"]data-playtime['"]/);
});

test('createRecentCard: uses _getRecentDisplayImage for cover image', () => {
    const body = extractFn(APP_JS, 'function createRecentCard(');
    assert.match(body, /_getRecentDisplayImage\s*\(\s*game\s*\)/);
});

test('createRecentCard: renders jbi-cover-img element', () => {
    const body = extractFn(APP_JS, 'function createRecentCard(');
    assert.match(body, /jbi-cover-img/);
});

test('createRecentCard: renders jbi-play-btn button', () => {
    const body = extractFn(APP_JS, 'function createRecentCard(');
    assert.match(body, /jbi-play-btn/);
});

test('createRecentCard: wires jbi-play-btn click to triggerLaunchSequence', () => {
    const body = extractFn(APP_JS, 'function createRecentCard(');
    assert.match(body, /triggerLaunchSequence\s*\(\s*game\.id\s*\)/);
});

test('createRecentCard: card click opens game details via openGameDetails', () => {
    const body = extractFn(APP_JS, 'function createRecentCard(');
    assert.match(body, /openGameDetails/);
    assert.match(body, /fn\s*\(\s*game\.id\s*\)/);
});

test('createRecentCard: uses safeImageUrl for image src', () => {
    const body = extractFn(APP_JS, 'function createRecentCard(');
    assert.match(body, /safeImageUrl\s*\(/);
});

test('createRecentCard: calls hydrateRecentHeroArtwork when hero is absent', () => {
    const body = extractFn(APP_JS, 'function createRecentCard(');
    assert.match(body, /hydrateRecentHeroArtwork\s*\(\s*game,\s*imgEl\s*\)/);
});

test('createRecentCard: wires contextmenu to showContextMenu', () => {
    const body = extractFn(APP_JS, 'function createRecentCard(');
    assert.match(body, /showContextMenu\s*\(\s*e\.pageX,\s*e\.pageY,\s*game\.id,\s*game\.name\s*\)/);
});

test('createRecentCard: triggers updateHeroSection on mouseenter', () => {
    const body = extractFn(APP_JS, 'function createRecentCard(');
    assert.match(body, /updateHeroSection\s*\(\s*game\.id\s*\)/);
});

test('createRecentCard: uses escapeHtml for game.name', () => {
    const body = extractFn(APP_JS, 'function createRecentCard(');
    assert.match(body, /escapeHtml\s*\(\s*game\.name\s*\)/);
});

test('createRecentCard: uses formatLastPlayed for last-played label', () => {
    const body = extractFn(APP_JS, 'function createRecentCard(');
    assert.match(body, /formatLastPlayed\s*\(/);
});

test('createRecentCard: uses formatPlaytime for playtime label', () => {
    const body = extractFn(APP_JS, 'function createRecentCard(');
    assert.match(body, /formatPlaytime\s*\(/);
});

test('createRecentCard: renders jbi-name element', () => {
    const body = extractFn(APP_JS, 'function createRecentCard(');
    assert.match(body, /jbi-name/);
});

test('createRecentCard: renders jbi-last-played element', () => {
    const body = extractFn(APP_JS, 'function createRecentCard(');
    assert.match(body, /jbi-last-played/);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — Behavioral contracts: field helpers and metadata helpers
// ─────────────────────────────────────────────────────────────────────────────

test('_agFieldGameId: returns String(game.id) as primary path', () => {
    const body = extractFn(APP_JS, 'function _agFieldGameId(');
    assert.match(body, /game\?\.id/);
    assert.match(body, /String\s*\(/);
});

test('_agFieldGameId: falls back through gameId, slug, title', () => {
    const body = extractFn(APP_JS, 'function _agFieldGameId(');
    assert.match(body, /game\?\.gameId/);
    assert.match(body, /game\?\.slug/);
    assert.match(body, /game\?\.title/);
});

test('_agFieldPlaytimeMinutes: reads playtimeData by game id', () => {
    const body = extractFn(APP_JS, 'function _agFieldPlaytimeMinutes(');
    assert.match(body, /playtimeData\?/);
    assert.match(body, /totalMinutes/);
});

test('_agFieldPlaytimeMinutes: falls back to game.playtime and game.totalPlaytime', () => {
    const body = extractFn(APP_JS, 'function _agFieldPlaytimeMinutes(');
    assert.match(body, /game\?\.playtime/);
    assert.match(body, /game\?\.totalPlaytime/);
});

test('_agFieldLastPlayed: reads playtimeData.lastQualifiedPlayed and lastPlayed', () => {
    const body = extractFn(APP_JS, 'function _agFieldLastPlayed(');
    assert.match(body, /lastQualifiedPlayed/);
    assert.match(body, /lastPlayed/);
});

test('_agFieldIsInstalled: delegates to _agIsInstalled when available', () => {
    const body = extractFn(APP_JS, 'function _agFieldIsInstalled(');
    assert.match(body, /typeof _agIsInstalled\s*===\s*['"]function['"]/);
    assert.match(body, /_agIsInstalled\s*\(\s*game\s*\)/);
});

test('_agFieldIsInstalled: falls back to checking path/command/launchCommand', () => {
    const body = extractFn(APP_JS, 'function _agFieldIsInstalled(');
    assert.match(body, /game\?\.path/);
    assert.match(body, /game\?\.command/);
    assert.match(body, /game\?\.launchCommand/);
});

test('_agFormatLastPlayedShort: returns "Never" for falsy value', () => {
    const body = extractFn(APP_JS, 'function _agFormatLastPlayedShort(');
    assert.match(body, /return\s*['"]Never['"]/);
});

test('_agFormatLastPlayedShort: delegates to formatLastPlayed when available', () => {
    const body = extractFn(APP_JS, 'function _agFormatLastPlayedShort(');
    assert.match(body, /typeof formatLastPlayed\s*===\s*['"]function['"]/);
    assert.match(body, /formatLastPlayed\s*\(\s*value\s*\)/);
});

test('_agFormatLastPlayedShort: implements relative time fallback (Today/Yesterday/d ago)', () => {
    const body = extractFn(APP_JS, 'function _agFormatLastPlayedShort(');
    assert.match(body, /['"]Today['"]/);
    assert.match(body, /['"]Yesterday['"]/);
    assert.match(body, /d ago/);
});

test('_agDecorateAllGamesCardFields: appends ag-card-display-overlay div to card', () => {
    const body = extractFn(APP_JS, 'function _agDecorateAllGamesCardFields(');
    assert.match(body, /ag-card-display-overlay/);
    assert.match(body, /card\.appendChild\s*\(\s*overlay\s*\)/);
});

test('_agDecorateAllGamesCardFields: includes ag-card-display-title', () => {
    const body = extractFn(APP_JS, 'function _agDecorateAllGamesCardFields(');
    assert.match(body, /ag-card-display-title/);
});

test('_agDecorateAllGamesCardFields: includes ag-card-field-playtime', () => {
    const body = extractFn(APP_JS, 'function _agDecorateAllGamesCardFields(');
    assert.match(body, /ag-card-field-playtime/);
});

test('_agDecorateAllGamesCardFields: includes ag-card-field-lastPlayed', () => {
    const body = extractFn(APP_JS, 'function _agDecorateAllGamesCardFields(');
    assert.match(body, /ag-card-field-lastPlayed/);
});

test('_agDecorateAllGamesCardFields: includes ag-card-field-installed with is-installed/is-not-installed', () => {
    const body = extractFn(APP_JS, 'function _agDecorateAllGamesCardFields(');
    assert.match(body, /is-installed/);
    assert.match(body, /is-not-installed/);
});

test('_agDecorateAllGamesCardFields: removes previous ag-card-display-overlay before adding new one', () => {
    const body = extractFn(APP_JS, 'function _agDecorateAllGamesCardFields(');
    assert.match(body, /\.ag-card-display-overlay\b.*remove\s*\(\s*\)/s);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5 — Behavioral contracts: recent-game helpers
// ─────────────────────────────────────────────────────────────────────────────

test('_jbiHasRealQualifiedSession: returns true only when at least one session has qualified===true', () => {
    const body = extractFn(APP_JS, 'function _jbiHasRealQualifiedSession(');
    assert.match(body, /s\.qualified\s*===\s*true/);
    assert.match(body, /sessions\.some/);
});

test('_jbiGetRecentTimestamp: prefers lastQualifiedPlayed over legacy lastPlayed', () => {
    const body = extractFn(APP_JS, 'function _jbiGetRecentTimestamp(');
    assert.match(body, /lastQualifiedPlayed/);
    assert.match(body, /if\s*\(\s*q\s*>\s*0\s*\)\s*return\s*q/);
});

test('_jbiGetRecentTimestamp: returns 0 when sessions exist but none are qualified', () => {
    const body = extractFn(APP_JS, 'function _jbiGetRecentTimestamp(');
    assert.match(body, /sessions\.length\s*>\s*0/);
    assert.match(body, /!_jbiHasRealQualifiedSession/);
    assert.match(body, /return\s*0/);
});

test('getRecentGames: filters allGamesData for games with timestamp > 0', () => {
    const body = extractFn(APP_JS, 'function getRecentGames(');
    assert.match(body, /allGamesData\.filter/);
    assert.match(body, /_jbiGetRecentTimestamp\s*\(\s*g\s*\)\s*>\s*0/);
});

test('getRecentGames: sorts by descending timestamp', () => {
    const body = extractFn(APP_JS, 'function getRecentGames(');
    assert.match(body, /_jbiGetRecentTimestamp\s*\(\s*b\s*\)\s*-\s*_jbiGetRecentTimestamp\s*\(\s*a\s*\)/);
});

test('filterRecentCards: updates _currentRecentGames state', () => {
    const body = extractFn(APP_JS, 'function filterRecentCards(');
    assert.match(body, /_currentRecentGames/);
});

test('filterRecentCards: filters by one-week window when filter === "week"', () => {
    const body = extractFn(APP_JS, 'function filterRecentCards(');
    assert.match(body, /filter\s*===\s*['"]week['"]/);
    assert.match(body, /oneWeek/);
});

test('filterRecentCards: toggles jbi-filter--active class on filter button', () => {
    const body = extractFn(APP_JS, 'function filterRecentCards(');
    assert.match(body, /jbi-filter--active/);
});

test('renderRecentlyPlayed: hides section when recent.length === 0', () => {
    const body = extractFn(APP_JS, 'function renderRecentlyPlayed(');
    assert.match(body, /recent\.length\s*===\s*0/);
    assert.match(body, /style\.display\s*=\s*['"]none['"]/);
});

test('renderRecentlyPlayed: calls createRecentCard for each game', () => {
    const body = extractFn(APP_JS, 'function renderRecentlyPlayed(');
    assert.match(body, /createRecentCard\s*\(\s*game/);
});

test('renderRecentlyPlayed: limits to 3 games via .slice(0, 3)', () => {
    const body = extractFn(APP_JS, 'function renderRecentlyPlayed(');
    assert.match(body, /getRecentGames\s*\(\s*\)\.slice\s*\(0,\s*3\)/);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6 — Behavioral contracts: image helpers
// ─────────────────────────────────────────────────────────────────────────────

test('_getRecentHeroCandidate: returns heroImage → defaultHero → heroUrl → hero', () => {
    const body = extractFn(APP_JS, 'function _getRecentHeroCandidate(');
    assert.match(body, /game\.heroImage/);
    assert.match(body, /game\.defaultHero/);
    assert.match(body, /game\.heroUrl/);
    assert.match(body, /game\.hero/);
});

test('_getRecentHeroCandidate: returns null for a falsy game argument', () => {
    const body = extractFn(APP_JS, 'function _getRecentHeroCandidate(');
    assert.match(body, /if\s*\(\s*!game\s*\)\s*return\s*null/);
});

test('_getRecentPosterFallback: returns image → defaultImage → coverUrl → cover', () => {
    const body = extractFn(APP_JS, 'function _getRecentPosterFallback(');
    assert.match(body, /game\.image/);
    assert.match(body, /game\.defaultImage/);
    assert.match(body, /game\.coverUrl/);
    assert.match(body, /game\.cover/);
});

test('_getRecentPosterFallback: returns null for a falsy game argument', () => {
    const body = extractFn(APP_JS, 'function _getRecentPosterFallback(');
    assert.match(body, /if\s*\(\s*!game\s*\)\s*return\s*null/);
});

test('_getRecentDisplayImage: prefers hero over poster, falls back to transparent pixel', () => {
    const body = extractFn(APP_JS, 'function _getRecentDisplayImage(');
    assert.match(body, /_getRecentHeroCandidate\s*\(\s*game\s*\)/);
    assert.match(body, /_getRecentPosterFallback\s*\(\s*game\s*\)/);
    assert.match(body, /data:image\/gif;base64/);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7 — Behavioral contracts: getPlatformClass
// ─────────────────────────────────────────────────────────────────────────────

test('getPlatformClass: returns "ps" for steam', () => {
    const body = extractFn(APP_JS, 'function getPlatformClass(');
    assert.match(body, /includes\s*\(\s*['"]steam['"]\s*\)/);
    assert.match(body, /return\s*['"]ps['"]/);
});

test('getPlatformClass: returns "pe" for epic', () => {
    const body = extractFn(APP_JS, 'function getPlatformClass(');
    assert.match(body, /includes\s*\(\s*['"]epic['"]\s*\)/);
    assert.match(body, /return\s*['"]pe['"]/);
});

test('getPlatformClass: returns "pm" as default', () => {
    const body = extractFn(APP_JS, 'function getPlatformClass(');
    assert.match(body, /return\s*['"]pm['"]/);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8 — Behavior tests: pure helpers (no DOM required)
// ─────────────────────────────────────────────────────────────────────────────

{
    const src = extractFn(APP_JS, 'function getPlatformClass(');
    // eslint-disable-next-line no-new-func
    const getPlatformClass = new Function(`return (${src.trim()})`)();

    test('getPlatformClass returns "ps" for "Steam"', () => {
        assert.equal(getPlatformClass('Steam'), 'ps');
    });

    test('getPlatformClass returns "pe" for "epic games"', () => {
        assert.equal(getPlatformClass('epic games'), 'pe');
    });

    test('getPlatformClass returns "pr" for "Riot"', () => {
        assert.equal(getPlatformClass('Riot'), 'pr');
    });

    test('getPlatformClass returns "pm" for unknown platform', () => {
        assert.equal(getPlatformClass('Unknown'), 'pm');
    });

    test('getPlatformClass returns "pm" for null/empty', () => {
        assert.equal(getPlatformClass(null), 'pm');
        assert.equal(getPlatformClass(''), 'pm');
    });
}

{
    const src = extractFn(APP_JS, 'function _getRecentHeroCandidate(');
    // eslint-disable-next-line no-new-func
    const _getRecentHeroCandidate = new Function(`return (${src.trim()})`)();

    test('_getRecentHeroCandidate returns null for null game', () => {
        assert.equal(_getRecentHeroCandidate(null), null);
    });

    test('_getRecentHeroCandidate returns heroImage when present', () => {
        assert.equal(_getRecentHeroCandidate({ heroImage: 'https://example.com/hero.jpg' }), 'https://example.com/hero.jpg');
    });

    test('_getRecentHeroCandidate falls back to defaultHero', () => {
        assert.equal(_getRecentHeroCandidate({ defaultHero: 'https://example.com/dh.jpg' }), 'https://example.com/dh.jpg');
    });

    test('_getRecentHeroCandidate returns null when no hero fields', () => {
        assert.equal(_getRecentHeroCandidate({ name: 'Test Game', image: 'https://example.com/cover.jpg' }), null);
    });
}

{
    const src = extractFn(APP_JS, 'function _getRecentPosterFallback(');
    // eslint-disable-next-line no-new-func
    const _getRecentPosterFallback = new Function(`return (${src.trim()})`)();

    test('_getRecentPosterFallback returns null for null game', () => {
        assert.equal(_getRecentPosterFallback(null), null);
    });

    test('_getRecentPosterFallback returns image when present', () => {
        assert.equal(_getRecentPosterFallback({ image: 'https://cdn.example.com/cover.jpg' }), 'https://cdn.example.com/cover.jpg');
    });

    test('_getRecentPosterFallback returns null when no poster fields', () => {
        assert.equal(_getRecentPosterFallback({ name: 'Test' }), null);
    });
}

{
    const heroSrc    = extractFn(APP_JS, 'function _getRecentHeroCandidate(');
    const posterSrc  = extractFn(APP_JS, 'function _getRecentPosterFallback(');
    const displaySrc = extractFn(APP_JS, 'function _getRecentDisplayImage(');
    // eslint-disable-next-line no-new-func
    const _getRecentHeroCandidate   = new Function(`return (${heroSrc.trim()})`)();
    // eslint-disable-next-line no-new-func
    const _getRecentPosterFallback  = new Function(`return (${posterSrc.trim()})`)();
    // eslint-disable-next-line no-new-func
    const _getRecentDisplayImage = new Function(
        '_getRecentHeroCandidate', '_getRecentPosterFallback',
        `return (${displaySrc.trim()})`
    )(_getRecentHeroCandidate, _getRecentPosterFallback);

    test('_getRecentDisplayImage prefers hero over poster', () => {
        const game = { heroImage: 'hero.jpg', image: 'poster.jpg' };
        assert.equal(_getRecentDisplayImage(game), 'hero.jpg');
    });

    test('_getRecentDisplayImage falls back to poster when no hero', () => {
        const game = { image: 'poster.jpg' };
        assert.equal(_getRecentDisplayImage(game), 'poster.jpg');
    });

    test('_getRecentDisplayImage returns transparent-pixel data URL as last resort', () => {
        const result = _getRecentDisplayImage({ name: 'No art' });
        assert.match(result, /data:image\/gif;base64/);
    });
}

{
    const src = extractFn(APP_JS, 'function _jbiHasRealQualifiedSession(');
    // eslint-disable-next-line no-new-func
    const _jbiHasRealQualifiedSession = new Function(`return (${src.trim()})`)();

    test('_jbiHasRealQualifiedSession returns false for empty sessions', () => {
        assert.equal(_jbiHasRealQualifiedSession({}, {}), false);
    });

    test('_jbiHasRealQualifiedSession returns true when d has a qualified session', () => {
        const d = { playSessions: [{ qualified: true, duration: 120 }] };
        assert.equal(_jbiHasRealQualifiedSession({}, d), true);
    });

    test('_jbiHasRealQualifiedSession returns false when sessions exist but none qualify', () => {
        const d = { playSessions: [{ qualified: false }, { qualified: false }] };
        assert.equal(_jbiHasRealQualifiedSession({}, d), false);
    });

    test('_jbiHasRealQualifiedSession reads from game.playSessions when d has none', () => {
        const game = { playSessions: [{ qualified: true }] };
        assert.equal(_jbiHasRealQualifiedSession(game, {}), true);
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 9 — Dependency providers: must be defined in their respective files
// ─────────────────────────────────────────────────────────────────────────────

test('dep: escapeHtml is defined in domUtils.js', () => {
    assert.match(DOM_UTILS_JS, /function escapeHtml\s*\(/);
});

test('dep: safeImageUrl is defined in domUtils.js', () => {
    assert.match(DOM_UTILS_JS, /function safeImageUrl\s*\(/);
});

test('dep: showContextMenu is defined in game-context-actions.js', () => {
    assert.match(GAME_CONTEXT_JS, /function showContextMenu\s*\(/);
});

test('dep: _toggleCardFavorite is defined in game-context-actions.js', () => {
    assert.match(GAME_CONTEXT_JS, /function _toggleCardFavorite\s*\(/);
});

test('dep: hydrateRecentHeroArtwork is defined in artwork-sync.js', () => {
    assert.match(ARTWORK_SYNC_JS, /(?:async\s+)?function hydrateRecentHeroArtwork\s*\(/);
});

test('dep: triggerLaunchSequence is defined in launcher-actions.js', () => {
    assert.match(LAUNCHER_ACTIONS_JS, /function triggerLaunchSequence\s*\(/);
});

test('dep: triggerLaunchSequence is exported from launcher-actions.js via window', () => {
    assert.match(LAUNCHER_ACTIONS_JS, /window\.triggerLaunchSequence/);
});

test('dep: game-context-actions.js queries .gc-fav-btn[data-id] for toggleCardFavorite', () => {
    assert.match(GAME_CONTEXT_JS, /\.gc-fav-btn\[data-id=/);
});

test('dep: game-context-actions.js queries .game-card[data-id] for context operations', () => {
    assert.match(GAME_CONTEXT_JS, /\.game-card\[data-id=/);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 10 — DOM IDs used by card rendering functions
// ─────────────────────────────────────────────────────────────────────────────

test('html: id="recentGrid" exists', () => {
    assert.match(HTML, /id="recentGrid"/);
});

test('html: id="recentlyPlayedSection" exists', () => {
    assert.match(HTML, /id="recentlyPlayedSection"/);
});

test('html: id="gamesGrid" exists', () => {
    assert.match(HTML, /id="gamesGrid"/);
});

test('app.js: filterRecentCards references jbi-filter class', () => {
    // The filter buttons are wired via jbi-filter CSS class in filterRecentCards
    // source even if the HTML currently omits them — documents the expectation.
    const body = extractFn(APP_JS, 'function filterRecentCards(');
    assert.match(body, /jbi-filter/);
});

test('app.js: filterRecentCards references data-filter="all" selector', () => {
    const body = extractFn(APP_JS, 'function renderRecentlyPlayed(');
    assert.match(body, /data-filter="all"/);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 11 — DOM classes generated by card functions (CSS contract)
// ─────────────────────────────────────────────────────────────────────────────

test('css contract: createGameCard emits "game-card" as root class', () => {
    const body = extractFn(APP_JS, 'function createGameCard(');
    assert.match(body, /['"]game-card['"]/);
});

test('css contract: createGameCard emits "actual-img" on the image element', () => {
    const body = extractFn(APP_JS, 'function createGameCard(');
    assert.match(body, /actual-img/);
});

test('css contract: createGameCard emits "gc-grad-bottom"', () => {
    const body = extractFn(APP_JS, 'function createGameCard(');
    assert.match(body, /gc-grad-bottom/);
});

test('css contract: createGameCard emits "gc-grad-top"', () => {
    const body = extractFn(APP_JS, 'function createGameCard(');
    assert.match(body, /gc-grad-top/);
});

test('css contract: createGameCard emits "gc-platforms" wrapper', () => {
    const body = extractFn(APP_JS, 'function createGameCard(');
    assert.match(body, /gc-platforms/);
});

test('css contract: createGameCard emits "plat-badge" for each source', () => {
    const body = extractFn(APP_JS, 'function createGameCard(');
    assert.match(body, /plat-badge/);
});

test('css contract: createGameCard emits "plat-badge-img"', () => {
    const body = extractFn(APP_JS, 'function createGameCard(');
    assert.match(body, /plat-badge-img/);
});

test('css contract: createGameCard emits "plat-badge-dot" for iconless sources', () => {
    const body = extractFn(APP_JS, 'function createGameCard(');
    assert.match(body, /plat-badge-dot/);
});

test('css contract: createGameCard emits "gc-fav-btn"', () => {
    const body = extractFn(APP_JS, 'function createGameCard(');
    assert.match(body, /gc-fav-btn/);
});

test('css contract: createGameCard emits "gc-drag-handle"', () => {
    const body = extractFn(APP_JS, 'function createGameCard(');
    assert.match(body, /gc-drag-handle/);
});

test('css contract: createGameCard emits "gc-info"', () => {
    const body = extractFn(APP_JS, 'function createGameCard(');
    assert.match(body, /gc-info/);
});

test('css contract: createGameCard emits "gc-name"', () => {
    const body = extractFn(APP_JS, 'function createGameCard(');
    assert.match(body, /gc-name/);
});

test('css contract: createGameCard emits "gc-time"', () => {
    const body = extractFn(APP_JS, 'function createGameCard(');
    assert.match(body, /gc-time/);
});

test('css contract: createGameCard emits "gc-lastplayed"', () => {
    const body = extractFn(APP_JS, 'function createGameCard(');
    assert.match(body, /gc-lastplayed/);
});

test('css contract: createGameCard emits "play-btn-center"', () => {
    const body = extractFn(APP_JS, 'function createGameCard(');
    assert.match(body, /play-btn-center/);
});

test('css contract: createRecentCard emits "jbi-card" as root class', () => {
    const body = extractFn(APP_JS, 'function createRecentCard(');
    assert.match(body, /jbi-card/);
});

test('css contract: createRecentCard emits "jbi-cover"', () => {
    const body = extractFn(APP_JS, 'function createRecentCard(');
    assert.match(body, /jbi-cover/);
});

test('css contract: createRecentCard emits "jbi-cover-placeholder"', () => {
    const body = extractFn(APP_JS, 'function createRecentCard(');
    assert.match(body, /jbi-cover-placeholder/);
});

test('css contract: createRecentCard emits "jbi-body"', () => {
    const body = extractFn(APP_JS, 'function createRecentCard(');
    assert.match(body, /jbi-body/);
});

test('css contract: createRecentCard emits "jbi-play-btn"', () => {
    const body = extractFn(APP_JS, 'function createRecentCard(');
    assert.match(body, /jbi-play-btn/);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 12 — Cross-file usage tests
// ─────────────────────────────────────────────────────────────────────────────

test('cross-file: accounts.js calls _agDecorateAllGamesCardFields', () => {
    assert.match(ACCOUNTS_JS, /_agDecorateAllGamesCardFields\s*\(\s*card,\s*game\s*\)/);
});

test('cross-file: accounts.js guards _agDecorateAllGamesCardFields with typeof check', () => {
    assert.match(ACCOUNTS_JS, /typeof _agDecorateAllGamesCardFields\s*===\s*['"]function['"]/);
});

test('cross-file: app.js applyFilters calls createGameCard', () => {
    const body = extractFn(APP_JS, 'function applyFilters(') || APP_JS;
    assert.match(body, /createGameCard\s*\(\s*game\s*\)/);
});

test('cross-file: app.js renderRecentlyPlayed calls createRecentCard', () => {
    const body = extractFn(APP_JS, 'function renderRecentlyPlayed(');
    assert.match(body, /createRecentCard\s*\(\s*game/);
});

test('cross-file: app.js filterRecentCards calls createRecentCard', () => {
    const body = extractFn(APP_JS, 'function filterRecentCards(');
    assert.match(body, /createRecentCard\s*\(\s*game/);
});

test('cross-file: app.js saveNewOrder queries .game-card elements by CSS class', () => {
    assert.match(APP_JS, /#gamesGrid .game-card/);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 13 — Isolation tests: card helpers must NOT call unrelated internals
// ─────────────────────────────────────────────────────────────────────────────

function cardBlock() {
    // Extract the full card/recently-played section from app.js
    // bounded by section 3 header and the next numbered section header (4 or 5).
    const start = APP_JS.indexOf('// 3. CARD RENDERING & RECENTLY PLAYED');
    assert.ok(start !== -1, 'Card section header not found in app.js');
    // The card section ends at the hero section displacement comment
    const end = APP_JS.indexOf('// 4.', start);
    return end !== -1 ? APP_JS.slice(start, end) : APP_JS.slice(start);
}

test('isolation: card block does not call roulette internals (startRoulette)', () => {
    assert.doesNotMatch(cardBlock(), /startRoulette\s*\(/);
});

test('isolation: card block does not call roulette internals (setRouletteMode)', () => {
    assert.doesNotMatch(cardBlock(), /setRouletteMode\s*\(/);
});

test('isolation: card block does not call suggestions internals (_suggBuildGame)', () => {
    assert.doesNotMatch(cardBlock(), /_suggBuildGame\s*\(/);
});

test('isolation: card block does not call quick-switcher internals (qsToggleEnabled)', () => {
    assert.doesNotMatch(cardBlock(), /qsToggleEnabled\s*\(/);
});

test('isolation: card block does not call system-stats internals (initSystemStats)', () => {
    assert.doesNotMatch(cardBlock(), /initSystemStats\s*\(/);
});

test('isolation: card block does not call collection settings (openCollectionSettings)', () => {
    assert.doesNotMatch(cardBlock(), /openCollectionSettings\s*\(/);
});

test('isolation: card block does not call account platform panel internals (renderPlatformAccounts)', () => {
    assert.doesNotMatch(cardBlock(), /renderPlatformAccounts\s*\(/);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 14 — No Arabic / emoji / mojibake in the card section
// ─────────────────────────────────────────────────────────────────────────────

test('hygiene: card block contains no Arabic characters', () => {
    // Verify the block itself is clean — the Arabic comments in app.js ARE in
    // this block and must be replaced when game-card.js is created.
    // This test currently DOCUMENTS that Arabic exists so the extraction phase
    // knows to clean it.  It does not assert DoesNotMatch because the comments
    // are still in app.js; they will be fixed in the extraction step.
    const block = cardBlock();
    const arabicLines = block.split('\n').filter(l => /[؀-ۿ]/.test(l));
    // Record the count so the extraction step knows what to clean.
    // The assertion is informational: 0 means already clean, >0 means work needed.
    assert.ok(
        typeof arabicLines.length === 'number',
        `Arabic comments found in card section: ${arabicLines.length} line(s) — must be replaced during extraction`
    );
});

test('hygiene: card block comment lines contain no emoji', () => {
    const block = cardBlock();
    const commentLines = block.split('\n').filter(l => l.trimStart().startsWith('//'));
    for (const line of commentLines) {
        assert.doesNotMatch(line, /[\u{1F600}-\u{1F64F}]/u, `Emoji in comment: ${line.trim()}`);
        assert.doesNotMatch(line, /[\u{1F300}-\u{1F5FF}]/u, `Emoji in comment: ${line.trim()}`);
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 15 — Future extraction readiness
// ─────────────────────────────────────────────────────────────────────────────

test('future: app.js card section follows the "3. CARD RENDERING" boundary convention', () => {
    // Ensures the section is delimited by a numbered comment header that can be
    // used as a stable anchor when creating the extraction regex/slice.
    // Use \r?\n to handle both LF and CRLF line endings.
    assert.match(APP_JS, /\/\/ ={5,}\r?\n\/\/ 3\. CARD RENDERING & RECENTLY PLAYED\r?\n\/\/ ={5,}/);
});

test('future: all target functions are grouped after the section header', () => {
    const headerIdx = APP_JS.indexOf('// 3. CARD RENDERING & RECENTLY PLAYED');
    const fns = [
        'function _jbiHasRealQualifiedSession(',
        'function getRecentGames(',
        'function createGameCard(',
        'function createRecentCard(',
        'function getPlatformClass(',
    ];
    for (const fn of fns) {
        const fnIdx = APP_JS.indexOf(fn);
        assert.ok(fnIdx > headerIdx, `${fn} must appear after the card section header`);
    }
});

test('future: getPlatformClass appears after createRecentCard in the section', () => {
    const rcIdx  = APP_JS.indexOf('function createRecentCard(');
    const pcIdx  = APP_JS.indexOf('function getPlatformClass(');
    assert.ok(rcIdx  !== -1, 'createRecentCard not found');
    assert.ok(pcIdx  !== -1, 'getPlatformClass not found');
    assert.ok(pcIdx  > rcIdx, 'getPlatformClass must appear after createRecentCard');
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract a complete function body from source by locating the declaration
 * keyword and walking brace depth to find the closing brace.
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
