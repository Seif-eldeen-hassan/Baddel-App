'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2.23B safety tests — Game Card / Recent Card helpers extracted to
//   src/js/app/game-card.js
//
// PURPOSE
//   Verify each target function exists in game-card.js, document behavioral
//   contracts through source-pattern assertions, record external dependencies,
//   confirm cross-file callers still work, and prove app.js no longer owns
//   the moved identifiers.
//
// TARGET FILE: src/js/app/game-card.js
//   Functions extracted from app.js section "3. CARD RENDERING & RECENTLY PLAYED":
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
const GAME_CARD_JS       = fs.readFileSync(path.join(ROOT, 'src/js/app/game-card.js'),            'utf8');
const HERO_JS            = fs.readFileSync(path.join(ROOT, 'src/js/app/hero.js'),                 'utf8');
const HTML               = fs.readFileSync(path.join(ROOT, 'src/dashboard.html'),                 'utf8');
const DOM_UTILS_JS       = fs.readFileSync(path.join(ROOT, 'src/js/domUtils.js'),                 'utf8');
const GAME_CONTEXT_JS    = fs.readFileSync(path.join(ROOT, 'src/js/app/game-context-actions.js'), 'utf8');
const ARTWORK_SYNC_JS    = fs.readFileSync(path.join(ROOT, 'src/js/app/artwork-sync.js'),         'utf8');
const LAUNCHER_ACTIONS_JS = fs.readFileSync(path.join(ROOT, 'src/js/app/launcher-actions.js'),   'utf8');
const ACCOUNTS_JS        = fs.readFileSync(path.join(ROOT, 'src/js/accounts.js'),                 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — Source-presence: all target functions exist in game-card.js
// ─────────────────────────────────────────────────────────────────────────────

test('card: section header "3. CARD RENDERING & RECENTLY PLAYED" exists in game-card.js', () => {
    assert.match(GAME_CARD_JS, /3\. CARD RENDERING & RECENTLY PLAYED/);
});

test('card: _jbiHasRealQualifiedSession is defined', () => {
    assert.match(GAME_CARD_JS, /function _jbiHasRealQualifiedSession\s*\(/);
});

test('card: _jbiGetRecentTimestamp is defined', () => {
    assert.match(GAME_CARD_JS, /function _jbiGetRecentTimestamp\s*\(/);
});

test('card: getRecentGames is defined', () => {
    assert.match(GAME_CARD_JS, /function getRecentGames\s*\(/);
});

test('card: _currentRecentGames state variable is declared', () => {
    assert.match(GAME_CARD_JS, /let\s+_currentRecentGames\s*=\s*\[\]/);
});

test('card: filterRecentCards is defined', () => {
    assert.match(GAME_CARD_JS, /function filterRecentCards\s*\(/);
});

test('card: renderRecentlyPlayed is defined', () => {
    assert.match(GAME_CARD_JS, /function renderRecentlyPlayed\s*\(/);
});

test('card: _agFieldGameId is defined', () => {
    assert.match(GAME_CARD_JS, /function _agFieldGameId\s*\(/);
});

test('card: _agFieldPlaytimeMinutes is defined', () => {
    assert.match(GAME_CARD_JS, /function _agFieldPlaytimeMinutes\s*\(/);
});

test('card: _agFieldLastPlayed is defined', () => {
    assert.match(GAME_CARD_JS, /function _agFieldLastPlayed\s*\(/);
});

test('card: _agFieldIsInstalled is defined', () => {
    assert.match(GAME_CARD_JS, /function _agFieldIsInstalled\s*\(/);
});

test('card: _agFormatLastPlayedShort is defined', () => {
    assert.match(GAME_CARD_JS, /function _agFormatLastPlayedShort\s*\(/);
});

test('card: _agDecorateAllGamesCardFields is defined', () => {
    assert.match(GAME_CARD_JS, /function _agDecorateAllGamesCardFields\s*\(/);
});

test('card: createGameCard is defined', () => {
    assert.match(GAME_CARD_JS, /function createGameCard\s*\(/);
});

test('card: _getRecentHeroCandidate is defined', () => {
    assert.match(GAME_CARD_JS, /function _getRecentHeroCandidate\s*\(/);
});

test('card: _getRecentPosterFallback is defined', () => {
    assert.match(GAME_CARD_JS, /function _getRecentPosterFallback\s*\(/);
});

test('card: _getRecentDisplayImage is defined', () => {
    assert.match(GAME_CARD_JS, /function _getRecentDisplayImage\s*\(/);
});

test('card: createRecentCard is defined', () => {
    assert.match(GAME_CARD_JS, /function createRecentCard\s*\(/);
});

test('card: getPlatformClass is defined', () => {
    assert.match(GAME_CARD_JS, /function getPlatformClass\s*\(/);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — Behavioral contracts: createGameCard
// ─────────────────────────────────────────────────────────────────────────────

test('createGameCard: creates a div element with className "game-card"', () => {
    const body = extractFn(GAME_CARD_JS, 'function createGameCard(');
    assert.match(body, /card\.className\s*=\s*['"]game-card['"]/);
});

test('createGameCard: sets data-id attribute to game.id', () => {
    const body = extractFn(GAME_CARD_JS, 'function createGameCard(');
    assert.match(body, /setAttribute\s*\(\s*['"]data-id['"],\s*game\.id\s*\)/);
});

test('createGameCard: wires play button click to triggerLaunchSequence', () => {
    const body = extractFn(GAME_CARD_JS, 'function createGameCard(');
    assert.match(body, /triggerLaunchSequence\s*\(\s*game\.id\s*\)/);
});

test('createGameCard: wires favorite button click to _toggleCardFavorite', () => {
    const body = extractFn(GAME_CARD_JS, 'function createGameCard(');
    assert.match(body, /_toggleCardFavorite\s*\(\s*game\.id\s*\)/);
});

test('createGameCard: calls showContextMenu on contextmenu event', () => {
    const body = extractFn(GAME_CARD_JS, 'function createGameCard(');
    assert.match(body, /showContextMenu\s*\(\s*e\.pageX,\s*e\.pageY,\s*game\.id,\s*game\.name\s*\)/);
});

test('createGameCard: uses escapeHtml for game.name', () => {
    const body = extractFn(GAME_CARD_JS, 'function createGameCard(');
    assert.match(body, /escapeHtml\s*\(\s*game\.name\s*\)/);
});

test('createGameCard: uses cache-backed artwork for normal image URL', () => {
    const body = extractFn(GAME_CARD_JS, 'function createGameCard(');
    assert.match(body, /_gcCacheBackedArtworkValue\(displayImg\) \|\| transparentPixel/);
    assert.doesNotMatch(body, /const _eImg\s*=\s*safeImageUrl\(displayImg\)/);
});

test('createGameCard: uses fetchMetadata for games without a local cached image', () => {
    const body = extractFn(GAME_CARD_JS, 'function createGameCard(');
    assert.match(body, /fetchMetadata\s*\(\s*imgEl,\s*game\s*\)/);
});

test('createGameCard: prefers poster fields (image, defaultImage, coverUrl) over hero', () => {
    const body = extractFn(GAME_CARD_JS, 'function createGameCard(');
    assert.match(body, /game\.image\s*\|\|\s*game\.defaultImage\s*\|\|\s*game\.coverUrl/);
});

test('createGameCard: builds platform badge HTML for each source', () => {
    const body = extractFn(GAME_CARD_JS, 'function createGameCard(');
    assert.match(body, /badgesHTML/);
    assert.match(body, /plat-badge/);
});

test('createGameCard: limits platform badges to MAX_BADGES', () => {
    const body = extractFn(GAME_CARD_JS, 'function createGameCard(');
    assert.match(body, /MAX_BADGES\s*=\s*3/);
    assert.match(body, /rawSources\.slice\s*\(0,\s*MAX_BADGES\)/);
});

test('createGameCard: falls back to game.platform when game.sources is absent', () => {
    const body = extractFn(GAME_CARD_JS, 'function createGameCard(');
    assert.match(body, /game\.platform\s*\|\|\s*['"]manual['"]/);
});

test('createGameCard: contains overflow badge for more than 3 sources', () => {
    const body = extractFn(GAME_CARD_JS, 'function createGameCard(');
    assert.match(body, /plat-badge-more/);
    assert.match(body, /\+\${overflow}/);
});

test('createGameCard: renders gc-fav-btn with data-id and conditional gc-fav-active', () => {
    const body = extractFn(GAME_CARD_JS, 'function createGameCard(');
    assert.match(body, /gc-fav-btn/);
    assert.match(body, /gc-fav-active/);
    assert.match(body, /data-id=.*_eId/s);
});

test('createGameCard: renders play-btn-center button', () => {
    const body = extractFn(GAME_CARD_JS, 'function createGameCard(');
    assert.match(body, /play-btn-center/);
});

test('createGameCard: renders gc-time element with playtime', () => {
    const body = extractFn(GAME_CARD_JS, 'function createGameCard(');
    assert.match(body, /gc-time/);
    assert.match(body, /timeStr/);
});

test('createGameCard: renders gc-lastplayed element', () => {
    const body = extractFn(GAME_CARD_JS, 'function createGameCard(');
    assert.match(body, /gc-lastplayed/);
});

test('createGameCard: reads allCollections to determine favorite status', () => {
    const body = extractFn(GAME_CARD_JS, 'function createGameCard(');
    assert.match(body, /allCollections\.find/);
    assert.match(body, /fav_system_default/);
});

test('createGameCard: calls _agDecorateAllGamesCardFields before returning', () => {
    const body = extractFn(GAME_CARD_JS, 'function createGameCard(');
    assert.match(body, /_agDecorateAllGamesCardFields\s*\(\s*card,\s*game\s*\)/);
});

test('createGameCard: adds "played" class to gc-time when totalMinutes > 0', () => {
    const body = extractFn(GAME_CARD_JS, 'function createGameCard(');
    assert.match(body, /playedClass\s*=\s*['"]played['"]/);
});

test('createGameCard: adds img-loaded class on image load event', () => {
    const body = extractFn(GAME_CARD_JS, 'function createGameCard(');
    assert.match(body, /classList\.add\s*\(\s*['"]img-loaded['"]\s*\)/);
});

test('createGameCard: clears game.image and calls fetchMetadata on broken local file', () => {
    const body = extractFn(GAME_CARD_JS, 'function createGameCard(');
    assert.match(body, /game\.image\.startsWith\s*\(\s*['"]file:\/\//);
    assert.match(body, /game\.image\s*=\s*null/);
    assert.match(body, /localStorage\.removeItem/);
});

test('createGameCard: requests debounced Home Hero transition on card mouseenter', () => {
    const body = extractFn(GAME_CARD_JS, 'function createGameCard(');
    assert.match(body, /__baddelRequestHomeHeroTransition\?\.\(\s*game\.id/);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — Behavioral contracts: createRecentCard
// ─────────────────────────────────────────────────────────────────────────────

test('createRecentCard: creates element with class "jbi-card"', () => {
    const body = extractFn(GAME_CARD_JS, 'function createRecentCard(');
    assert.match(body, /card\.className\s*=\s*`jbi-card/);
});

test('createRecentCard: adds "jbi-card--featured" class for featured cards', () => {
    const body = extractFn(GAME_CARD_JS, 'function createRecentCard(');
    assert.match(body, /jbi-card--featured/);
    assert.match(body, /isFeatured/);
});

test('createRecentCard: sets data-id attribute', () => {
    const body = extractFn(GAME_CARD_JS, 'function createRecentCard(');
    assert.match(body, /setAttribute\s*\(\s*['"]data-id['"],\s*game\.id\s*\)/);
});

test('createRecentCard: sets data-last-played attribute', () => {
    const body = extractFn(GAME_CARD_JS, 'function createRecentCard(');
    assert.match(body, /['"]data-last-played['"]/);
});

test('createRecentCard: sets data-playtime attribute', () => {
    const body = extractFn(GAME_CARD_JS, 'function createRecentCard(');
    assert.match(body, /['"]data-playtime['"]/);
});

test('createRecentCard: uses the JBI artwork selection pipeline for cover image', () => {
    const body = extractFn(GAME_CARD_JS, 'function createRecentCard(');
    assert.match(body, /_jbiResolveArtworkSelection\s*\(\s*displayGame\s*\)/);
    assert.match(body, /const displayImg = _jbiCacheBackedArtworkValue\(selection\.selectedValue\)/);
});

test('createRecentCard: renders jbi-cover-img element', () => {
    const body = extractFn(GAME_CARD_JS, 'function createRecentCard(');
    assert.match(body, /jbi-cover-img/);
});

test('createRecentCard: renders jbi-play-btn button', () => {
    const body = extractFn(GAME_CARD_JS, 'function createRecentCard(');
    assert.match(body, /jbi-play-btn/);
});

test('createRecentCard: wires jbi-play-btn click to triggerLaunchSequence', () => {
    const body = extractFn(GAME_CARD_JS, 'function createRecentCard(');
    assert.match(body, /triggerLaunchSequence\s*\(\s*game\.id\s*\)/);
});

test('createRecentCard: card click opens game details via openGameDetails', () => {
    const body = extractFn(GAME_CARD_JS, 'function createRecentCard(');
    assert.match(body, /openGameDetails/);
    assert.match(body, /fn\s*\(\s*game\.id\s*\)/);
});

test('createRecentCard: uses safeImageUrl for image src', () => {
    const body = extractFn(GAME_CARD_JS, 'function createRecentCard(');
    assert.match(body, /safeImageUrl\s*\(/);
});

test('createRecentCard: calls hydrateRecentHeroArtwork when hero is absent', () => {
    const body = extractFn(GAME_CARD_JS, 'function createRecentCard(');
    assert.match(body, /hydrateRecentHeroArtwork\s*\(\s*game,\s*imgEl\s*\)/);
});

test('createRecentCard: wires contextmenu to showContextMenu', () => {
    const body = extractFn(GAME_CARD_JS, 'function createRecentCard(');
    assert.match(body, /showContextMenu\s*\(\s*e\.pageX,\s*e\.pageY,\s*game\.id,\s*game\.name\s*\)/);
});

test('createRecentCard: requests debounced Home Hero transition on mouseenter', () => {
    const body = extractFn(GAME_CARD_JS, 'function createRecentCard(');
    assert.match(body, /__baddelRequestHomeHeroTransition\?\.\(\s*game\.id/);
});

test('createRecentCard: uses escapeHtml for game.name', () => {
    const body = extractFn(GAME_CARD_JS, 'function createRecentCard(');
    assert.match(body, /escapeHtml\s*\(\s*game\.name\s*\)/);
});

test('createRecentCard: uses formatLastPlayed for last-played label', () => {
    const body = extractFn(GAME_CARD_JS, 'function createRecentCard(');
    assert.match(body, /formatLastPlayed\s*\(/);
});

test('createRecentCard: uses formatPlaytime for playtime label', () => {
    const body = extractFn(GAME_CARD_JS, 'function createRecentCard(');
    assert.match(body, /formatPlaytime\s*\(/);
});

test('createRecentCard: renders jbi-name element', () => {
    const body = extractFn(GAME_CARD_JS, 'function createRecentCard(');
    assert.match(body, /jbi-name/);
});

test('createRecentCard: renders jbi-last-played element', () => {
    const body = extractFn(GAME_CARD_JS, 'function createRecentCard(');
    assert.match(body, /jbi-last-played/);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — Behavioral contracts: field helpers and metadata helpers
// ─────────────────────────────────────────────────────────────────────────────

test('_agFieldGameId: returns String(game.id) as primary path', () => {
    const body = extractFn(GAME_CARD_JS, 'function _agFieldGameId(');
    assert.match(body, /game\?\.id/);
    assert.match(body, /String\s*\(/);
});

test('_agFieldGameId: falls back through gameId, slug, title', () => {
    const body = extractFn(GAME_CARD_JS, 'function _agFieldGameId(');
    assert.match(body, /game\?\.gameId/);
    assert.match(body, /game\?\.slug/);
    assert.match(body, /game\?\.title/);
});

test('_agFieldPlaytimeMinutes: uses _agResolvePlaytimeRecordForGame for playtime lookup', () => {
    const body = extractFn(GAME_CARD_JS, 'function _agFieldPlaytimeMinutes(');
    assert.match(body, /_agResolvePlaytimeRecordForGame\s*\(\s*game\s*\)/);
    assert.match(body, /totalMinutes/);
});

test('_agFieldPlaytimeMinutes: falls back to game.playtime and game.totalPlaytime', () => {
    const body = extractFn(GAME_CARD_JS, 'function _agFieldPlaytimeMinutes(');
    assert.match(body, /game\?\.playtime/);
    assert.match(body, /game\?\.totalPlaytime/);
});

test('_agFieldLastPlayed: reads playtimeData.lastQualifiedPlayed and lastPlayed', () => {
    const body = extractFn(GAME_CARD_JS, 'function _agFieldLastPlayed(');
    assert.match(body, /lastQualifiedPlayed/);
    assert.match(body, /lastPlayed/);
});

test('_agFieldIsInstalled: delegates to _agIsInstalled when available', () => {
    const body = extractFn(GAME_CARD_JS, 'function _agFieldIsInstalled(');
    assert.match(body, /typeof _agIsInstalled\s*===\s*['"]function['"]/);
    assert.match(body, /_agIsInstalled\s*\(\s*game\s*\)/);
});

test('_agFieldIsInstalled: falls back to checking path/command/launchCommand', () => {
    const body = extractFn(GAME_CARD_JS, 'function _agFieldIsInstalled(');
    assert.match(body, /game\?\.path/);
    assert.match(body, /game\?\.command/);
    assert.match(body, /game\?\.launchCommand/);
});

test('_agFormatLastPlayedShort: returns "Never" for falsy value', () => {
    const body = extractFn(GAME_CARD_JS, 'function _agFormatLastPlayedShort(');
    assert.match(body, /return\s*['"]Never['"]/);
});

test('_agFormatLastPlayedShort: delegates to formatLastPlayed when available', () => {
    const body = extractFn(GAME_CARD_JS, 'function _agFormatLastPlayedShort(');
    assert.match(body, /typeof formatLastPlayed\s*===\s*['"]function['"]/);
    assert.match(body, /formatLastPlayed\s*\(\s*value\s*\)/);
});

test('_agFormatLastPlayedShort: implements relative time fallback (Today/Yesterday/d ago)', () => {
    const body = extractFn(GAME_CARD_JS, 'function _agFormatLastPlayedShort(');
    assert.match(body, /['"]Today['"]/);
    assert.match(body, /['"]Yesterday['"]/);
    assert.match(body, /d ago/);
});

test('_agDecorateAllGamesCardFields: appends ag-card-display-overlay div to card', () => {
    const body = extractFn(GAME_CARD_JS, 'function _agDecorateAllGamesCardFields(');
    assert.match(body, /ag-card-display-overlay/);
    assert.match(body, /card\.appendChild\s*\(\s*overlay\s*\)/);
});

test('_agDecorateAllGamesCardFields: includes ag-card-display-title', () => {
    const body = extractFn(GAME_CARD_JS, 'function _agDecorateAllGamesCardFields(');
    assert.match(body, /ag-card-display-title/);
});

test('_agDecorateAllGamesCardFields: includes ag-card-field-playtime', () => {
    const body = extractFn(GAME_CARD_JS, 'function _agDecorateAllGamesCardFields(');
    assert.match(body, /ag-card-field-playtime/);
});

test('_agDecorateAllGamesCardFields: includes ag-card-field-lastPlayed', () => {
    const body = extractFn(GAME_CARD_JS, 'function _agDecorateAllGamesCardFields(');
    assert.match(body, /ag-card-field-lastPlayed/);
});

test('_agDecorateAllGamesCardFields: includes ag-card-field-installed with is-installed/is-not-installed', () => {
    const body = extractFn(GAME_CARD_JS, 'function _agDecorateAllGamesCardFields(');
    assert.match(body, /is-installed/);
    assert.match(body, /is-not-installed/);
});

test('_agDecorateAllGamesCardFields: removes previous ag-card-display-overlay before adding new one', () => {
    const body = extractFn(GAME_CARD_JS, 'function _agDecorateAllGamesCardFields(');
    assert.match(body, /\.ag-card-display-overlay\b.*remove\s*\(\s*\)/s);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5 — Behavioral contracts: recent-game helpers
// ─────────────────────────────────────────────────────────────────────────────

test('_jbiHasRealQualifiedSession: returns true only when at least one session has qualified===true', () => {
    const body = extractFn(GAME_CARD_JS, 'function _jbiHasRealQualifiedSession(');
    assert.match(body, /s\.qualified\s*===\s*true/);
    assert.match(body, /sessions\.some/);
});

test('_jbiGetRecentTimestamp: prefers lastQualifiedPlayed over legacy lastPlayed', () => {
    const body = extractFn(GAME_CARD_JS, 'function _jbiGetRecentTimestamp(');
    assert.match(body, /lastQualifiedPlayed/);
    assert.match(body, /if\s*\(\s*q\s*>\s*0\s*\)\s*return\s*q/);
});

test('_jbiGetRecentTimestamp: returns 0 when sessions exist but none are qualified', () => {
    const body = extractFn(GAME_CARD_JS, 'function _jbiGetRecentTimestamp(');
    assert.match(body, /sessions\.length\s*>\s*0/);
    assert.match(body, /!_jbiHasRealQualifiedSession/);
    assert.match(body, /return\s*0/);
});

test('getRecentGames: filters window.allGamesData for games with timestamp > 0', () => {
    const body = extractFn(GAME_CARD_JS, 'function getRecentGames(');
    assert.match(body, /window\.allGamesData/);
    assert.match(body, /_jbiGetRecentTimestamp\s*\(\s*g\s*\)\s*>\s*0/);
});

test('getRecentGames: sorts by descending timestamp', () => {
    const body = extractFn(GAME_CARD_JS, 'function getRecentGames(');
    assert.match(body, /_jbiGetRecentTimestamp\s*\(\s*b\s*\)\s*-\s*_jbiGetRecentTimestamp\s*\(\s*a\s*\)/);
});

test('filterRecentCards: updates _currentRecentGames state', () => {
    const body = extractFn(GAME_CARD_JS, 'function filterRecentCards(');
    assert.match(body, /_currentRecentGames/);
});

test('filterRecentCards: filters by one-week window when filter === "week"', () => {
    const body = extractFn(GAME_CARD_JS, 'function filterRecentCards(');
    assert.match(body, /filter\s*===\s*['"]week['"]/);
    assert.match(body, /oneWeek/);
});

test('filterRecentCards: toggles jbi-filter--active class on filter button', () => {
    const body = extractFn(GAME_CARD_JS, 'function filterRecentCards(');
    assert.match(body, /jbi-filter--active/);
});

test('renderRecentlyPlayed: hides section when recent.length === 0', () => {
    const body = extractFn(GAME_CARD_JS, 'function renderRecentlyPlayed(');
    assert.match(body, /recent\.length\s*===\s*0/);
    assert.match(body, /style\.display\s*=\s*['"]none['"]/);
});

test('renderRecentlyPlayed: calls createRecentCard for each game', () => {
    const body = extractFn(GAME_CARD_JS, 'function renderRecentlyPlayed(');
    assert.match(body, /createRecentCard\s*\(\s*game/);
});

test('renderRecentlyPlayed: limits to 3 games via .slice(0, 3)', () => {
    const body = extractFn(GAME_CARD_JS, 'function renderRecentlyPlayed(');
    assert.match(body, /getRecentGames\s*\(\s*\)\.slice\s*\(0,\s*3\)/);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6 — Behavioral contracts: image helpers
// ─────────────────────────────────────────────────────────────────────────────

test('_getRecentHeroCandidate: returns heroImage → defaultHero → heroUrl → hero', () => {
    const body = extractFn(GAME_CARD_JS, 'function _getRecentHeroCandidate(');
    assert.match(body, /game\.heroImage/);
    assert.match(body, /game\.defaultHero/);
    assert.match(body, /game\.heroUrl/);
    assert.match(body, /game\.hero/);
});

test('_getRecentHeroCandidate: returns null for a falsy game argument', () => {
    const body = extractFn(GAME_CARD_JS, 'function _getRecentHeroCandidate(');
    assert.match(body, /if\s*\(\s*!game\s*\)\s*return\s*null/);
});

test('_getRecentPosterFallback: returns image → defaultImage → coverUrl → cover', () => {
    const body = extractFn(GAME_CARD_JS, 'function _getRecentPosterFallback(');
    assert.match(body, /game\.image/);
    assert.match(body, /game\.defaultImage/);
    assert.match(body, /game\.coverUrl/);
    assert.match(body, /game\.cover/);
});

test('_getRecentPosterFallback: returns null for a falsy game argument', () => {
    const body = extractFn(GAME_CARD_JS, 'function _getRecentPosterFallback(');
    assert.match(body, /if\s*\(\s*!game\s*\)\s*return\s*null/);
});

test('_getRecentDisplayImage: prefers hero over poster, falls back to transparent pixel', () => {
    const body = extractFn(GAME_CARD_JS, 'function _getRecentDisplayImage(');
    assert.match(body, /_getRecentHeroCandidate\s*\(\s*game\s*\)/);
    assert.match(body, /_getRecentPosterFallback\s*\(\s*game\s*\)/);
    assert.match(body, /data:image\/gif;base64/);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7 — Behavioral contracts: getPlatformClass
// ─────────────────────────────────────────────────────────────────────────────

test('getPlatformClass: returns "ps" for steam', () => {
    const body = extractFn(GAME_CARD_JS, 'function getPlatformClass(');
    assert.match(body, /includes\s*\(\s*['"]steam['"]\s*\)/);
    assert.match(body, /return\s*['"]ps['"]/);
});

test('getPlatformClass: returns "pe" for epic', () => {
    const body = extractFn(GAME_CARD_JS, 'function getPlatformClass(');
    assert.match(body, /includes\s*\(\s*['"]epic['"]\s*\)/);
    assert.match(body, /return\s*['"]pe['"]/);
});

test('getPlatformClass: returns "pm" as default', () => {
    const body = extractFn(GAME_CARD_JS, 'function getPlatformClass(');
    assert.match(body, /return\s*['"]pm['"]/);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8 — Behavior tests: pure helpers (no DOM required)
// ─────────────────────────────────────────────────────────────────────────────

{
    const src = extractFn(GAME_CARD_JS, 'function getPlatformClass(');
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
    const src = extractFn(GAME_CARD_JS, 'function _getRecentHeroCandidate(');
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
    const src = extractFn(GAME_CARD_JS, 'function _getRecentPosterFallback(');
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
    const heroSrc    = extractFn(GAME_CARD_JS, 'function _getRecentHeroCandidate(');
    const posterSrc  = extractFn(GAME_CARD_JS, 'function _getRecentPosterFallback(');
    const displaySrc = extractFn(GAME_CARD_JS, 'function _getRecentDisplayImage(');
    // eslint-disable-next-line no-new-func
    const _getRecentHeroCandidate   = new Function(`return (${heroSrc.trim()})`)();
    // eslint-disable-next-line no-new-func
    const _getRecentPosterFallback  = new Function(`return (${posterSrc.trim()})`)();
    // eslint-disable-next-line no-new-func
    const _getRecentDisplayImage = new Function(
        '_getRecentHeroCandidate', '_getRecentPosterFallback',
        `return (${displaySrc.trim()})`
    )(_getRecentHeroCandidate, _getRecentPosterFallback);

    test('_getRecentDisplayImage prefers hero over poster for Jump Back In cards', () => {
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
    const src = extractFn(GAME_CARD_JS, 'function _jbiHasRealQualifiedSession(');
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
// SECTION 8b — Behavioral: _jbiGetRecentTimestamp (short/unqualified sessions)
// ─────────────────────────────────────────────────────────────────────────────

{
    const hasSrc = extractFn(GAME_CARD_JS, 'function _jbiHasRealQualifiedSession(');
    // eslint-disable-next-line no-new-func
    const _jbiHasRealQualifiedSession = new Function(`return (${hasSrc.trim()})`)();

    const tsSrc = extractFn(GAME_CARD_JS, 'function _jbiGetRecentTimestamp(');

    function makeTimestamp(game, playtimeOverride) {
        const playtimeData = playtimeOverride || {};
        // eslint-disable-next-line no-new-func
        const fn = new Function(
            'playtimeData', '_jbiHasRealQualifiedSession',
            `return (${tsSrc.trim()})`
        )(playtimeData, _jbiHasRealQualifiedSession);
        return fn(game);
    }

    const now = Date.now();

    test('_jbiGetRecentTimestamp: returns lastQualifiedPlayed when present', () => {
        const game = { id: 'g1', playSessions: [] };
        const result = makeTimestamp(game, { g1: { lastQualifiedPlayed: now } });
        assert.equal(result, now);
    });

    test('_jbiGetRecentTimestamp: short unqualified counted session returns lastPlayed', () => {
        const game = {
            id: 'g2',
            playSessions: [{ qualified: false, countedMinutes: 1, endedAt: now }],
        };
        const result = makeTimestamp(game, { g2: { totalMinutes: 1, lastPlayed: now } });
        assert.equal(result, now);
    });

    test('_jbiGetRecentTimestamp: unqualified session with zero countedMinutes and no lastPlayed returns 0', () => {
        const game = {
            id: 'g3',
            playSessions: [{ qualified: false, countedMinutes: 0, endedAt: now }],
        };
        const result = makeTimestamp(game, { g3: { totalMinutes: 0, lastPlayed: null } });
        assert.equal(result, 0);
    });

    test('_jbiGetRecentTimestamp: unqualified session falls back to endedAt of counted session when no lastPlayed', () => {
        const game = {
            id: 'g4',
            playSessions: [{ qualified: false, countedMinutes: 1, endedAt: now }],
        };
        // Simulate pre-fix data where lastPlayed was never written
        const result = makeTimestamp(game, { g4: { totalMinutes: 1, lastPlayed: null } });
        assert.equal(result, now);
    });

    test('_jbiGetRecentTimestamp: legacy game with no sessions returns lastPlayed', () => {
        const game = { id: 'g5', playSessions: [] };
        const result = makeTimestamp(game, { g5: { totalMinutes: 60, lastPlayed: now } });
        assert.equal(result, now);
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8c — Behavioral: _agFieldLastPlayed (session endedAt fallback)
// ─────────────────────────────────────────────────────────────────────────────

{
    const idSrc       = extractFn(GAME_CARD_JS, 'function _agFieldGameId(');
    const resolverSrc = extractFn(GAME_CARD_JS, 'function _agResolvePlaytimeRecordForGame(');
    const lpSrc       = extractFn(GAME_CARD_JS, 'function _agFieldLastPlayed(');
    // eslint-disable-next-line no-new-func
    const _agFieldGameId = new Function(`return (${idSrc.trim()})`)();

    const now = Date.now();

    function makeLastPlayed(game, playtimeOverride) {
        const playtimeData = playtimeOverride || {};
        // eslint-disable-next-line no-new-func
        const _agResolvePlaytimeRecordForGame = new Function(
            'playtimeData', '_agFieldGameId',
            `return (${resolverSrc.trim()})`
        )(playtimeData, _agFieldGameId);
        // eslint-disable-next-line no-new-func
        const fn = new Function(
            'playtimeData', '_agFieldGameId', '_agResolvePlaytimeRecordForGame',
            `return (${lpSrc.trim()})`
        )(playtimeData, _agFieldGameId, _agResolvePlaytimeRecordForGame);
        return fn(game);
    }

    test('_agFieldLastPlayed: returns playtimeData.lastQualifiedPlayed first', () => {
        const game = { id: 'x', lastQualifiedPlayed: now - 1000 };
        assert.equal(makeLastPlayed(game, { x: { lastQualifiedPlayed: now } }), now);
    });

    test('_agFieldLastPlayed: falls back to game.lastQualifiedPlayed', () => {
        const game = { id: 'x', lastQualifiedPlayed: now };
        assert.equal(makeLastPlayed(game, {}), now);
    });

    test('_agFieldLastPlayed: falls back to playtimeData.lastPlayed when no qualified', () => {
        const game = { id: 'x' };
        assert.equal(makeLastPlayed(game, { x: { lastPlayed: now } }), now);
    });

    test('_agFieldLastPlayed: falls back to game.lastPlayed when no qualified', () => {
        const game = { id: 'x', lastPlayed: now };
        assert.equal(makeLastPlayed(game, {}), now);
    });

    test('_agFieldLastPlayed: returns endedAt of latest counted session when totalMinutes > 0 and no lastPlayed', () => {
        const game = {
            id: 'x',
            totalPlaytime: 1,
            playSessions: [{ countedMinutes: 1, endedAt: now }],
        };
        assert.equal(makeLastPlayed(game, { x: { totalMinutes: 1 } }), now);
    });

    test('_agFieldLastPlayed: returns null when totalMinutes=0 and no timestamps', () => {
        const game = { id: 'x', totalPlaytime: 0 };
        assert.equal(makeLastPlayed(game, {}), null);
    });

    test('_agFieldLastPlayed: returns null when session has countedMinutes=0 and no lastPlayed', () => {
        const game = {
            id: 'x',
            totalPlaytime: 0,
            playSessions: [{ countedMinutes: 0, endedAt: now }],
        };
        assert.equal(makeLastPlayed(game, { x: { totalMinutes: 0 } }), null);
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

test('game-card.js: filterRecentCards references jbi-filter class', () => {
    const body = extractFn(GAME_CARD_JS, 'function filterRecentCards(');
    assert.match(body, /jbi-filter/);
});

test('game-card.js: renderRecentlyPlayed references data-filter="all" selector', () => {
    const body = extractFn(GAME_CARD_JS, 'function renderRecentlyPlayed(');
    assert.match(body, /data-filter="all"/);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 11 — DOM classes generated by card functions (CSS contract)
// ─────────────────────────────────────────────────────────────────────────────

test('css contract: createGameCard emits "game-card" as root class', () => {
    const body = extractFn(GAME_CARD_JS, 'function createGameCard(');
    assert.match(body, /['"]game-card['"]/);
});

test('css contract: createGameCard emits "actual-img" on the image element', () => {
    const body = extractFn(GAME_CARD_JS, 'function createGameCard(');
    assert.match(body, /actual-img/);
});

test('css contract: createGameCard emits "gc-grad-bottom"', () => {
    const body = extractFn(GAME_CARD_JS, 'function createGameCard(');
    assert.match(body, /gc-grad-bottom/);
});

test('css contract: createGameCard emits "gc-grad-top"', () => {
    const body = extractFn(GAME_CARD_JS, 'function createGameCard(');
    assert.match(body, /gc-grad-top/);
});

test('css contract: createGameCard emits "gc-platforms" wrapper', () => {
    const body = extractFn(GAME_CARD_JS, 'function createGameCard(');
    assert.match(body, /gc-platforms/);
});

test('css contract: createGameCard emits "plat-badge" for each source', () => {
    const body = extractFn(GAME_CARD_JS, 'function createGameCard(');
    assert.match(body, /plat-badge/);
});

test('css contract: createGameCard emits "plat-badge-img"', () => {
    const body = extractFn(GAME_CARD_JS, 'function createGameCard(');
    assert.match(body, /plat-badge-img/);
});

test('css contract: createGameCard emits "plat-badge-dot" for iconless sources', () => {
    const body = extractFn(GAME_CARD_JS, 'function createGameCard(');
    assert.match(body, /plat-badge-dot/);
});

test('css contract: createGameCard emits "gc-fav-btn"', () => {
    const body = extractFn(GAME_CARD_JS, 'function createGameCard(');
    assert.match(body, /gc-fav-btn/);
});

test('css contract: createGameCard emits "gc-drag-handle"', () => {
    const body = extractFn(GAME_CARD_JS, 'function createGameCard(');
    assert.match(body, /gc-drag-handle/);
});

test('css contract: createGameCard emits "gc-info"', () => {
    const body = extractFn(GAME_CARD_JS, 'function createGameCard(');
    assert.match(body, /gc-info/);
});

test('css contract: createGameCard emits "gc-name"', () => {
    const body = extractFn(GAME_CARD_JS, 'function createGameCard(');
    assert.match(body, /gc-name/);
});

test('css contract: createGameCard emits "gc-time"', () => {
    const body = extractFn(GAME_CARD_JS, 'function createGameCard(');
    assert.match(body, /gc-time/);
});

test('css contract: createGameCard emits "gc-lastplayed"', () => {
    const body = extractFn(GAME_CARD_JS, 'function createGameCard(');
    assert.match(body, /gc-lastplayed/);
});

test('css contract: createGameCard emits "play-btn-center"', () => {
    const body = extractFn(GAME_CARD_JS, 'function createGameCard(');
    assert.match(body, /play-btn-center/);
});

test('css contract: createRecentCard emits "jbi-card" as root class', () => {
    const body = extractFn(GAME_CARD_JS, 'function createRecentCard(');
    assert.match(body, /jbi-card/);
});

test('css contract: createRecentCard emits "jbi-cover"', () => {
    const body = extractFn(GAME_CARD_JS, 'function createRecentCard(');
    assert.match(body, /jbi-cover/);
});

test('css contract: createRecentCard emits "jbi-cover-placeholder"', () => {
    const body = extractFn(GAME_CARD_JS, 'function createRecentCard(');
    assert.match(body, /jbi-cover-placeholder/);
});

test('css contract: createRecentCard emits "jbi-body"', () => {
    const body = extractFn(GAME_CARD_JS, 'function createRecentCard(');
    assert.match(body, /jbi-body/);
});

test('css contract: createRecentCard emits "jbi-play-btn"', () => {
    const body = extractFn(GAME_CARD_JS, 'function createRecentCard(');
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

test('cross-file: app.js applyFilters still calls createGameCard (as global)', () => {
    const body = extractFn(APP_JS, 'function applyFilters(') || APP_JS;
    assert.match(body, /createGameCard\s*\(\s*game\s*\)/);
});

test('cross-file: game-card.js renderRecentlyPlayed calls createRecentCard', () => {
    const body = extractFn(GAME_CARD_JS, 'function renderRecentlyPlayed(');
    assert.match(body, /createRecentCard\s*\(\s*game/);
});

test('cross-file: game-card.js filterRecentCards calls createRecentCard', () => {
    const body = extractFn(GAME_CARD_JS, 'function filterRecentCards(');
    assert.match(body, /createRecentCard\s*\(\s*game/);
});

test('cross-file: app.js saveNewOrder queries .game-card elements by CSS class', () => {
    assert.match(APP_JS, /#gamesGrid .game-card/);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 13 — Isolation tests: card helpers must NOT call unrelated internals
// ─────────────────────────────────────────────────────────────────────────────

test('isolation: game-card.js does not call roulette internals (startRoulette)', () => {
    assert.doesNotMatch(GAME_CARD_JS, /startRoulette\s*\(/);
});

test('isolation: game-card.js does not call roulette internals (setRouletteMode)', () => {
    assert.doesNotMatch(GAME_CARD_JS, /setRouletteMode\s*\(/);
});

test('isolation: game-card.js does not call suggestions internals (_suggBuildGame)', () => {
    assert.doesNotMatch(GAME_CARD_JS, /_suggBuildGame\s*\(/);
});

test('isolation: game-card.js does not call quick-switcher internals (qsToggleEnabled)', () => {
    assert.doesNotMatch(GAME_CARD_JS, /qsToggleEnabled\s*\(/);
});

test('isolation: game-card.js does not call system-stats internals (initSystemStats)', () => {
    assert.doesNotMatch(GAME_CARD_JS, /initSystemStats\s*\(/);
});

test('isolation: game-card.js does not call collection settings (openCollectionSettings)', () => {
    assert.doesNotMatch(GAME_CARD_JS, /openCollectionSettings\s*\(/);
});

test('isolation: game-card.js does not call account platform panel internals (renderPlatformAccounts)', () => {
    assert.doesNotMatch(GAME_CARD_JS, /renderPlatformAccounts\s*\(/);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 14 — Hygiene: game-card.js must be clean
// ─────────────────────────────────────────────────────────────────────────────

test('hygiene: game-card.js contains no Arabic-script characters', () => {
    assert.doesNotMatch(GAME_CARD_JS, /[؀-ۿ]/, 'Arabic characters must be replaced with English equivalents');
});

test('hygiene: game-card.js comment lines contain no emoji', () => {
    const commentLines = GAME_CARD_JS.split('\n').filter(l => l.trimStart().startsWith('//'));
    for (const line of commentLines) {
        assert.doesNotMatch(line, /[\u{1F600}-\u{1F64F}]/u, `Emoji in comment: ${line.trim()}`);
        assert.doesNotMatch(line, /[\u{1F300}-\u{1F5FF}]/u, `Emoji in comment: ${line.trim()}`);
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 15 — Structural ordering within game-card.js
// ─────────────────────────────────────────────────────────────────────────────

test('structure: all target functions appear in game-card.js after the section header', () => {
    const headerIdx = GAME_CARD_JS.indexOf('// 3. CARD RENDERING & RECENTLY PLAYED');
    const fns = [
        'function _jbiHasRealQualifiedSession(',
        'function getRecentGames(',
        'function createGameCard(',
        'function createRecentCard(',
        'function getPlatformClass(',
    ];
    for (const fn of fns) {
        const fnIdx = GAME_CARD_JS.indexOf(fn);
        assert.ok(fnIdx > headerIdx, `${fn} must appear after the card section header in game-card.js`);
    }
});

test('structure: getPlatformClass appears after createRecentCard in game-card.js', () => {
    const rcIdx  = GAME_CARD_JS.indexOf('function createRecentCard(');
    const pcIdx  = GAME_CARD_JS.indexOf('function getPlatformClass(');
    assert.ok(rcIdx  !== -1, 'createRecentCard not found in game-card.js');
    assert.ok(pcIdx  !== -1, 'getPlatformClass not found in game-card.js');
    assert.ok(pcIdx  > rcIdx, 'getPlatformClass must appear after createRecentCard in game-card.js');
});

test('structure: app.js has displacement comment referencing game-card.js', () => {
    assert.match(APP_JS, /3\. CARD RENDERING & RECENTLY PLAYED.*moved to src\/js\/app\/game-card\.js/s);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 16 — Script load order: game-card.js in dashboard.html
// ─────────────────────────────────────────────────────────────────────────────

function scriptIndex(filename) {
    const re = new RegExp(`<script src="js(?:/app)?/${filename.replace('.', '\\.')}">`);
    return HTML.search(re);
}

test('script-order: game-card.js script tag exists in dashboard.html', () => {
    assert.match(HTML, /src="js\/app\/game-card\.js"/);
});

test('script-order: domUtils.js loads before game-card.js', () => {
    const domIdx  = HTML.indexOf('<script src="js/domUtils.js">');
    const cardIdx = HTML.indexOf('<script src="js/app/game-card.js">');
    assert.ok(domIdx  !== -1, 'domUtils.js not found in HTML');
    assert.ok(cardIdx !== -1, 'game-card.js not found in HTML');
    assert.ok(domIdx < cardIdx, 'domUtils.js must load before game-card.js');
});

test('script-order: artwork-sync.js loads before game-card.js', () => {
    const syncIdx = HTML.indexOf('<script src="js/app/artwork-sync.js">');
    const cardIdx = HTML.indexOf('<script src="js/app/game-card.js">');
    assert.ok(syncIdx < cardIdx, 'artwork-sync.js must load before game-card.js');
});

test('script-order: launcher-actions.js loads before game-card.js', () => {
    const laIdx   = HTML.indexOf('<script src="js/app/launcher-actions.js">');
    const cardIdx = HTML.indexOf('<script src="js/app/game-card.js">');
    assert.ok(laIdx < cardIdx, 'launcher-actions.js must load before game-card.js');
});

test('script-order: game-context-actions.js loads before game-card.js', () => {
    const gcIdx   = HTML.indexOf('<script src="js/app/game-context-actions.js">');
    const cardIdx = HTML.indexOf('<script src="js/app/game-card.js">');
    assert.ok(gcIdx < cardIdx, 'game-context-actions.js must load before game-card.js');
});

test('script-order: game-card.js loads before app.js', () => {
    const cardIdx = HTML.indexOf('<script src="js/app/game-card.js">');
    const appIdx  = HTML.indexOf('<script src="js/app.js">');
    assert.ok(cardIdx !== -1, 'game-card.js not found in HTML');
    assert.ok(appIdx  !== -1, 'app.js not found in HTML');
    assert.ok(cardIdx < appIdx, 'game-card.js must load before app.js');
});

test('script-order: game-card.js loads before accounts.js', () => {
    const cardIdx = HTML.indexOf('<script src="js/app/game-card.js">');
    const accIdx  = HTML.indexOf('<script src="js/accounts.js">');
    assert.ok(cardIdx < accIdx, 'game-card.js must load before accounts.js');
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 17 — Window exports: game-card.js exposes functions globally
// ─────────────────────────────────────────────────────────────────────────────

test('window-export: window.getRecentGames is assigned in game-card.js', () => {
    assert.match(GAME_CARD_JS, /window\.getRecentGames\s*=\s*getRecentGames/);
});

test('window-export: window.filterRecentCards is assigned in game-card.js', () => {
    assert.match(GAME_CARD_JS, /window\.filterRecentCards\s*=\s*filterRecentCards/);
});

test('window-export: window.renderRecentlyPlayed is assigned in game-card.js', () => {
    assert.match(GAME_CARD_JS, /window\.renderRecentlyPlayed\s*=\s*renderRecentlyPlayed/);
});

test('window-export: window._agDecorateAllGamesCardFields is assigned in game-card.js', () => {
    assert.match(GAME_CARD_JS, /window\._agDecorateAllGamesCardFields\s*=\s*_agDecorateAllGamesCardFields/);
});

test('window-export: window.createGameCard is assigned in game-card.js', () => {
    assert.match(GAME_CARD_JS, /window\.createGameCard\s*=\s*createGameCard/);
});

test('window-export: window.createRecentCard is assigned in game-card.js', () => {
    assert.match(GAME_CARD_JS, /window\.createRecentCard\s*=\s*createRecentCard/);
});

test('window-export: window.getPlatformClass is assigned in game-card.js', () => {
    assert.match(GAME_CARD_JS, /window\.getPlatformClass\s*=\s*getPlatformClass/);
});

test('window-export: window._jbiHasRealQualifiedSession is assigned in game-card.js', () => {
    assert.match(GAME_CARD_JS, /window\._jbiHasRealQualifiedSession\s*=\s*_jbiHasRealQualifiedSession/);
});

test('window-export: window._jbiGetRecentTimestamp is assigned in game-card.js', () => {
    assert.match(GAME_CARD_JS, /window\._jbiGetRecentTimestamp\s*=\s*_jbiGetRecentTimestamp/);
});

test('window-export: window._getRecentDisplayImage is assigned in game-card.js', () => {
    assert.match(GAME_CARD_JS, /window\._getRecentDisplayImage\s*=\s*_getRecentDisplayImage/);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 18 — app.js displacement guard: moved identifiers must NOT be in app.js
// ─────────────────────────────────────────────────────────────────────────────

test('displacement: app.js does NOT define function _jbiHasRealQualifiedSession', () => {
    assert.doesNotMatch(APP_JS, /function _jbiHasRealQualifiedSession\s*\(/);
});

test('displacement: app.js does NOT define function _jbiGetRecentTimestamp', () => {
    assert.doesNotMatch(APP_JS, /function _jbiGetRecentTimestamp\s*\(/);
});

test('displacement: app.js does NOT define function getRecentGames', () => {
    assert.doesNotMatch(APP_JS, /function getRecentGames\s*\(/);
});

test('displacement: app.js does NOT declare let _currentRecentGames', () => {
    assert.doesNotMatch(APP_JS, /let\s+_currentRecentGames\s*=/);
});

test('displacement: app.js does NOT define function filterRecentCards', () => {
    assert.doesNotMatch(APP_JS, /function filterRecentCards\s*\(/);
});

test('displacement: app.js does NOT define function renderRecentlyPlayed', () => {
    assert.doesNotMatch(APP_JS, /function renderRecentlyPlayed\s*\(/);
});

test('displacement: app.js does NOT define function createGameCard', () => {
    assert.doesNotMatch(APP_JS, /function createGameCard\s*\(/);
});

test('displacement: app.js does NOT define function createRecentCard', () => {
    assert.doesNotMatch(APP_JS, /function createRecentCard\s*\(/);
});

test('displacement: app.js does NOT define function getPlatformClass', () => {
    assert.doesNotMatch(APP_JS, /function getPlatformClass\s*\(/);
});

test('displacement: app.js does NOT define function _agDecorateAllGamesCardFields', () => {
    assert.doesNotMatch(APP_JS, /function _agDecorateAllGamesCardFields\s*\(/);
});

test('displacement: app.js displacement comment references game-card.js', () => {
    assert.match(APP_JS, /game-card\.js/);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 19 — Hygiene: game-card.js file-level checks
// ─────────────────────────────────────────────────────────────────────────────

test('hygiene: game-card.js contains no Arabic-script characters anywhere', () => {
    assert.doesNotMatch(GAME_CARD_JS, /[؀-ۿ]/);
});

test('hygiene: game-card.js contains no mojibake sequences', () => {
    assert.doesNotMatch(GAME_CARD_JS, /Ã[-¿]/u);
    assert.doesNotMatch(GAME_CARD_JS, /â€/);
});

test('hygiene: game-card.js starts with "use strict"', () => {
    assert.match(GAME_CARD_JS, /^'use strict';/);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 20 — _agResolveLastPlayedTimestamp: source-text and behavioral tests
// ─────────────────────────────────────────────────────────────────────────────

test('resolver: _agResolveLastPlayedTimestamp is defined in game-card.js', () => {
    assert.match(GAME_CARD_JS, /function _agResolveLastPlayedTimestamp\s*\(/);
});

test('resolver: window._agResolveLastPlayedTimestamp is exported in game-card.js', () => {
    assert.match(GAME_CARD_JS, /window\._agResolveLastPlayedTimestamp\s*=\s*_agResolveLastPlayedTimestamp/);
});

test('resolver: _agResolveLastPlayedTimestamp checks lastQualifiedPlayed before lastPlayed', () => {
    const body = extractFn(GAME_CARD_JS, 'function _agResolveLastPlayedTimestamp(');
    assert.match(body, /lastQualifiedPlayed/);
    assert.match(body, /lastPlayed/);
});

test('resolver: _agResolveLastPlayedTimestamp handles endTime in addition to endedAt', () => {
    const body = extractFn(GAME_CARD_JS, 'function _agResolveLastPlayedTimestamp(');
    assert.match(body, /endTime/);
    assert.match(body, /endedAt/);
});

test('createRecentCard: uses _agResolveLastPlayedTimestamp for the last-played label', () => {
    const body = extractFn(GAME_CARD_JS, 'function createRecentCard(');
    assert.match(body, /_agResolveLastPlayedTimestamp\s*\(\s*game\s*\)/);
});

test('hero: updateHeroSection uses _agResolveLastPlayedTimestamp for last-played display', () => {
    const body = extractFn(HERO_JS, 'function _homeHeroCommit(');
    assert.match(body, /_agResolveLastPlayedTimestamp/);
});

test('hero: updateHeroSection guards _agResolveLastPlayedTimestamp with typeof check', () => {
    const body = extractFn(HERO_JS, 'function _homeHeroCommit(');
    assert.match(body, /typeof _agResolveLastPlayedTimestamp\s*===\s*['"]function['"]/);
});

{
    const idSrc          = extractFn(GAME_CARD_JS, 'function _agFieldGameId(');
    const crossIdSrc     = extractFn(GAME_CARD_JS, 'function _agResolvePlaytimeRecordForGame(');
    const resolverSrc    = extractFn(GAME_CARD_JS, 'function _agResolveLastPlayedTimestamp(');
    // eslint-disable-next-line no-new-func
    const _agFieldGameId = new Function(`return (${idSrc.trim()})`)();

    const now = Date.now();

    function makeResolver(game, playtimeOverride) {
        const playtimeData = playtimeOverride || {};
        // eslint-disable-next-line no-new-func
        const _agResolvePlaytimeRecordForGame = new Function(
            'playtimeData', '_agFieldGameId',
            `return (${crossIdSrc.trim()})`
        )(playtimeData, _agFieldGameId);
        // eslint-disable-next-line no-new-func
        const fn = new Function(
            'playtimeData', '_agFieldGameId', '_agResolvePlaytimeRecordForGame',
            `return (${resolverSrc.trim()})`
        )(playtimeData, _agFieldGameId, _agResolvePlaytimeRecordForGame);
        return fn(game);
    }

    test('_agResolveLastPlayedTimestamp: prefers lastQualifiedPlayed over lastPlayed', () => {
        const game = { id: 'r1', lastPlayed: now - 5000 };
        const result = makeResolver(game, { r1: { lastQualifiedPlayed: now, lastPlayed: now - 5000 } });
        assert.equal(result, now);
    });

    test('_agResolveLastPlayedTimestamp: falls back to lastPlayed when no qualified', () => {
        const game = { id: 'r2' };
        const result = makeResolver(game, { r2: { lastPlayed: now } });
        assert.equal(result, now);
    });

    test('_agResolveLastPlayedTimestamp: falls back to counted session endedAt when lastPlayed is null', () => {
        const game = {
            id: 'r3',
            playSessions: [{ countedMinutes: 1, endedAt: now }],
        };
        const result = makeResolver(game, { r3: { totalMinutes: 1, lastPlayed: null } });
        assert.equal(result, now);
    });

    test('_agResolveLastPlayedTimestamp: ignores sessions with countedMinutes === 0', () => {
        const game = {
            id: 'r4',
            playSessions: [{ countedMinutes: 0, endedAt: now }],
        };
        const result = makeResolver(game, { r4: { totalMinutes: 0, lastPlayed: null } });
        assert.equal(result, null);
    });

    test('_agResolveLastPlayedTimestamp: falls back to endTime when endedAt absent', () => {
        const game = {
            id: 'r5',
            playSessions: [{ countedMinutes: 1, endTime: now }],
        };
        const result = makeResolver(game, { r5: { totalMinutes: 1, lastPlayed: null } });
        assert.equal(result, now);
    });

    test('_agResolveLastPlayedTimestamp: returns latest endedAt when multiple counted sessions', () => {
        const older = now - 86400000;
        const game = {
            id: 'r6',
            playSessions: [
                { countedMinutes: 1, endedAt: older },
                { countedMinutes: 2, endedAt: now },
            ],
        };
        const result = makeResolver(game, { r6: { totalMinutes: 3, lastPlayed: null } });
        assert.equal(result, now);
    });

    test('_agResolveLastPlayedTimestamp: returns null when no timestamps and no totalMinutes', () => {
        const game = { id: 'r7' };
        const result = makeResolver(game, {});
        assert.equal(result, null);
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 21 — Game Details: last-played uses _agResolveLastPlayedTimestamp
// ─────────────────────────────────────────────────────────────────────────────

const GAME_DETAILS_JS = fs.readFileSync(path.join(ROOT, 'src/js/game-details.js'), 'utf8');

test('game-details: gdLastPlayed element uses _agResolveLastPlayedTimestamp, not pData.lastPlayed directly', () => {
    // Find the block that writes to gdLastPlayed
    const idx = GAME_DETAILS_JS.indexOf('gdLastPlayed');
    assert.ok(idx !== -1, 'gdLastPlayed not found in game-details.js');
    // The 300 chars before the write must contain the resolver call
    const window = GAME_DETAILS_JS.slice(Math.max(0, idx - 400), idx + 200);
    assert.match(window, /_agResolveLastPlayedTimestamp/);
});

test('game-details: gdLastPlayed write uses typeof guard for resolver', () => {
    const idx = GAME_DETAILS_JS.indexOf('gdLastPlayed');
    assert.ok(idx !== -1, 'gdLastPlayed not found in game-details.js');
    const context = GAME_DETAILS_JS.slice(Math.max(0, idx - 400), idx + 200);
    assert.match(context, /typeof _agResolveLastPlayedTimestamp\s*===\s*['"]function['"]/);
});

test('game-details: details panel Last Played row uses _agResolveLastPlayedTimestamp', () => {
    // The second call site: add('Last Played', lpStr) — find its context
    const idx = GAME_DETAILS_JS.indexOf("add('Last Played'");
    assert.ok(idx !== -1, "'add Last Played' not found in game-details.js");
    const context = GAME_DETAILS_JS.slice(Math.max(0, idx - 500), idx + 50);
    assert.match(context, /_agResolveLastPlayedTimestamp/);
});

test('game-details: details panel Last Played uses typeof guard for resolver', () => {
    const idx = GAME_DETAILS_JS.indexOf("add('Last Played'");
    assert.ok(idx !== -1, "'add Last Played' not found in game-details.js");
    const context = GAME_DETAILS_JS.slice(Math.max(0, idx - 500), idx + 50);
    assert.match(context, /typeof _agResolveLastPlayedTimestamp\s*===\s*['"]function['"]/);
});

{
    // Behavioral: resolver must return the same timestamp regardless of call site
    const idSrc          = extractFn(GAME_CARD_JS, 'function _agFieldGameId(');
    const crossIdSrc     = extractFn(GAME_CARD_JS, 'function _agResolvePlaytimeRecordForGame(');
    const resolverSrc    = extractFn(GAME_CARD_JS, 'function _agResolveLastPlayedTimestamp(');
    // eslint-disable-next-line no-new-func
    const _agFieldGameId = new Function(`return (${idSrc.trim()})`)();

    const now = Date.now();

    function makeResolver(game, playtimeOverride) {
        const playtimeData = playtimeOverride || {};
        // eslint-disable-next-line no-new-func
        const _agResolvePlaytimeRecordForGame = new Function(
            'playtimeData', '_agFieldGameId',
            `return (${crossIdSrc.trim()})`
        )(playtimeData, _agFieldGameId);
        // eslint-disable-next-line no-new-func
        const fn = new Function(
            'playtimeData', '_agFieldGameId', '_agResolvePlaytimeRecordForGame',
            `return (${resolverSrc.trim()})`
        )(playtimeData, _agFieldGameId, _agResolvePlaytimeRecordForGame);
        return fn(game);
    }

    test('game-details resolver: same timestamp as Jump Back In for game with counted session and null lastPlayed', () => {
        const game = {
            id: 'gd1',
            playSessions: [{ countedMinutes: 1, endedAt: now }],
        };
        const playtime = { gd1: { totalMinutes: 1, lastPlayed: null } };
        // Both use the same resolver — result must be non-null
        const result = makeResolver(game, playtime);
        assert.ok(result !== null, 'resolver must return a timestamp, not null');
        assert.equal(result, now);
    });

    test('game-details resolver: zero-minute session with null lastPlayed returns null', () => {
        const game = {
            id: 'gd2',
            playSessions: [{ countedMinutes: 0, endedAt: now }],
        };
        const playtime = { gd2: { totalMinutes: 0, lastPlayed: null } };
        const result = makeResolver(game, playtime);
        assert.equal(result, null);
    });

    test('game-details resolver: returns same result for game with lastPlayed set', () => {
        const game = { id: 'gd3' };
        const playtime = { gd3: { totalMinutes: 5, lastPlayed: now } };
        const result = makeResolver(game, playtime);
        assert.equal(result, now);
    });
}

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
