'use strict';
const test   = require('node:test');
const assert = require('assert/strict');
const fs     = require('path');
const path   = require('path');
const fss    = require('fs');

const APP_JS          = fss.readFileSync(path.join(__dirname, '..', 'src', 'js', 'app.js'), 'utf8');
const GAME_CARD_JS    = fss.readFileSync(path.join(__dirname, '..', 'src', 'js', 'app', 'game-card.js'), 'utf8');
const ARTWORK_SYNC_JS = fss.readFileSync(path.join(__dirname, '..', 'src', 'js', 'app', 'artwork-sync.js'), 'utf8');

// ── Helper functions defined ───────────────────────────────────────────────────

test('game-card.js: _getRecentHeroCandidate function is defined', () => {
    assert.ok(GAME_CARD_JS.includes('function _getRecentHeroCandidate(game)'));
});

test('game-card.js: _getRecentHeroCandidate checks heroImage first', () => {
    const idx = GAME_CARD_JS.indexOf('function _getRecentHeroCandidate(game)');
    // Only scan up to the closing brace of this short function (no more than 180 chars)
    const block = GAME_CARD_JS.slice(idx, idx + 180);
    const heroIdx    = block.indexOf('heroImage');
    const defaultIdx = block.indexOf('defaultHero');
    const imageIdx   = block.indexOf('game.image');
    assert.ok(heroIdx !== -1, 'heroImage not checked');
    assert.ok(defaultIdx !== -1, 'defaultHero not checked');
    assert.ok(heroIdx < defaultIdx, 'heroImage must come before defaultHero');
    // game.image belongs in the poster fallback, not in the hero candidate
    assert.ok(imageIdx === -1, 'game.image must not appear in _getRecentHeroCandidate');
});

test('game-card.js: _getRecentHeroCandidate includes heroUrl and hero aliases', () => {
    const idx = GAME_CARD_JS.indexOf('function _getRecentHeroCandidate(game)');
    const block = GAME_CARD_JS.slice(idx, idx + 300);
    assert.ok(block.includes('heroUrl'), 'heroUrl not in hero candidate');
    assert.ok(block.includes('game.hero'), 'game.hero not in hero candidate');
});

test('game-card.js: _getRecentPosterFallback function is defined', () => {
    assert.ok(GAME_CARD_JS.includes('function _getRecentPosterFallback(game)'));
});

test('game-card.js: _getRecentPosterFallback checks image/defaultImage/coverUrl', () => {
    const idx = GAME_CARD_JS.indexOf('function _getRecentPosterFallback(game)');
    const block = GAME_CARD_JS.slice(idx, idx + 300);
    assert.ok(block.includes('game.image'), 'game.image not in poster fallback');
    assert.ok(block.includes('defaultImage'), 'defaultImage not in poster fallback');
    assert.ok(block.includes('coverUrl'), 'coverUrl not in poster fallback');
});

test('game-card.js: _getRecentPosterFallback does NOT include heroImage', () => {
    const idx = GAME_CARD_JS.indexOf('function _getRecentPosterFallback(game)');
    const block = GAME_CARD_JS.slice(idx, idx + 300);
    assert.ok(!block.includes('heroImage'), 'heroImage must not appear in _getRecentPosterFallback');
});

test('game-card.js: _getRecentDisplayImage function is defined', () => {
    assert.ok(GAME_CARD_JS.includes('function _getRecentDisplayImage(game)'));
});

test('game-card.js: _getRecentDisplayImage calls _getRecentHeroCandidate first', () => {
    const idx = GAME_CARD_JS.indexOf('function _getRecentDisplayImage(game)');
    const block = GAME_CARD_JS.slice(idx, idx + 300);
    const heroIdx   = block.indexOf('_getRecentHeroCandidate');
    const posterIdx = block.indexOf('_getRecentPosterFallback');
    assert.ok(heroIdx !== -1, '_getRecentHeroCandidate not called');
    assert.ok(posterIdx !== -1, '_getRecentPosterFallback not called');
    assert.ok(heroIdx < posterIdx, '_getRecentHeroCandidate must come before _getRecentPosterFallback');
});

// ── hydrateRecentHeroArtwork ───────────────────────────────────────────────────

test('artwork-sync.js: hydrateRecentHeroArtwork function is defined', () => {
    assert.ok(ARTWORK_SYNC_JS.includes('async function hydrateRecentHeroArtwork(game, imgEl)'));
});

test('artwork-sync.js: hydrateRecentHeroArtwork passes preferHero:true to getMetadata', () => {
    const idx = ARTWORK_SYNC_JS.indexOf('async function hydrateRecentHeroArtwork(game, imgEl)');
    const block = ARTWORK_SYNC_JS.slice(idx, idx + 1000);
    assert.ok(block.includes('preferHero:     true') || block.includes("preferHero: true"), 'preferHero:true not passed');
});

test('artwork-sync.js: hydrateRecentHeroArtwork passes source:jump-back-in to getMetadata', () => {
    const idx = ARTWORK_SYNC_JS.indexOf('async function hydrateRecentHeroArtwork(game, imgEl)');
    const block = ARTWORK_SYNC_JS.slice(idx, idx + 1000);
    assert.ok(block.includes("source:         'jump-back-in'") || block.includes("source: 'jump-back-in'"), "source: 'jump-back-in' not passed");
});

test('artwork-sync.js: hydrateRecentHeroArtwork sets game.heroImage on success', () => {
    const idx = ARTWORK_SYNC_JS.indexOf('async function hydrateRecentHeroArtwork(game, imgEl)');
    const block = ARTWORK_SYNC_JS.slice(idx, idx + 2000);
    assert.ok(block.includes('game.heroImage'), 'game.heroImage not set');
    assert.ok(block.includes('game.defaultHero'), 'game.defaultHero not set');
    assert.ok(block.includes('game.heroUrl'), 'game.heroUrl not set');
});

test('artwork-sync.js: hydrateRecentHeroArtwork does not set imgEl.src to hero when hero found', () => {
    const idx = ARTWORK_SYNC_JS.indexOf('async function hydrateRecentHeroArtwork(game, imgEl)');
    const block = ARTWORK_SYNC_JS.slice(idx, idx + 2000);
    assert.ok(!block.includes('imgEl.src = safeImageUrl(hero)'), 'hero hydration must not replace the Jump Back In card image');
    assert.ok(block.includes('shouldApplyHydratedArtwork'), 'hero hydration must re-check ownership before applying');
});

test('artwork-sync.js: hydrateRecentHeroArtwork caches to localStorage', () => {
    const idx = ARTWORK_SYNC_JS.indexOf('async function hydrateRecentHeroArtwork(game, imgEl)');
    const block = ARTWORK_SYNC_JS.slice(idx, idx + 2000);
    assert.ok(block.includes("localStorage.setItem('hero_'"), 'localStorage.setItem for hero not found');
});

test('artwork-sync.js: hydrateRecentHeroArtwork calls cacheAllAssets when assets available', () => {
    const idx = ARTWORK_SYNC_JS.indexOf('async function hydrateRecentHeroArtwork(game, imgEl)');
    const block = ARTWORK_SYNC_JS.slice(idx, idx + 2000);
    assert.ok(block.includes('cacheAllAssets'), 'cacheAllAssets not called');
});

test('artwork-sync.js: hydrateRecentHeroArtwork only uses cover as last fallback (no hero)', () => {
    const idx = ARTWORK_SYNC_JS.indexOf('async function hydrateRecentHeroArtwork(game, imgEl)');
    const block = ARTWORK_SYNC_JS.slice(idx, idx + 2500);
    // The cover fallback must come AFTER the hero block
    const heroSetIdx  = block.indexOf('game.heroImage  = hero');
    const coverFbIdx  = block.indexOf('cover && !imgEl.src');
    assert.ok(heroSetIdx !== -1, 'hero assignment not found');
    assert.ok(coverFbIdx !== -1, 'cover-only fallback not found');
    assert.ok(heroSetIdx < coverFbIdx, 'cover fallback must come after hero block');
});

// ── createRecentCard integration ──────────────────────────────────────────────

test('game-card.js: createRecentCard uses JBI artwork selection for initial displayImg', () => {
    const idx = GAME_CARD_JS.indexOf('function createRecentCard(game, isFeatured');
    const block = GAME_CARD_JS.slice(idx, idx + 600);
    assert.ok(block.includes('_jbiResolveArtworkSelection(displayGame)'), '_jbiResolveArtworkSelection not called for displayImg');
    assert.ok(block.includes('selection.selectedValue'), 'selection.selectedValue not used for displayImg');
});

test('game-card.js: createRecentCard does NOT call fetchMetadata directly', () => {
    const idx = GAME_CARD_JS.indexOf('function createRecentCard(game, isFeatured');
    // Search the full card function body (up to the next top-level function)
    const nextFnIdx = GAME_CARD_JS.indexOf('\nfunction getPlatformClass', idx);
    const block = GAME_CARD_JS.slice(idx, nextFnIdx > idx ? nextFnIdx : idx + 2000);
    assert.ok(!block.includes('fetchMetadata('), 'fetchMetadata must not be called from createRecentCard');
});

test('game-card.js: JBI selection uses _getRecentHeroCandidate for hero check', () => {
    const idx = GAME_CARD_JS.indexOf('function createRecentCard(game, isFeatured');
    const nextFnIdx = GAME_CARD_JS.indexOf('\nfunction getPlatformClass', idx);
    const block = GAME_CARD_JS.slice(GAME_CARD_JS.indexOf('function _jbiResolveArtworkSelection'), nextFnIdx > idx ? nextFnIdx : idx + 2000);
    assert.ok(block.includes('_getRecentHeroCandidate'), '_getRecentHeroCandidate not used in JBI selection');
});

test('game-card.js: JBI selection uses _getRecentPosterFallback for poster fallback', () => {
    const idx = GAME_CARD_JS.indexOf('function createRecentCard(game, isFeatured');
    const nextFnIdx = GAME_CARD_JS.indexOf('\nfunction getPlatformClass', idx);
    const block = GAME_CARD_JS.slice(GAME_CARD_JS.indexOf('function _jbiResolveArtworkSelection'), nextFnIdx > idx ? nextFnIdx : idx + 2000);
    assert.ok(block.includes('_getRecentPosterFallback'), '_getRecentPosterFallback not used in JBI selection');
});

test('game-card.js: createRecentCard calls hydrateRecentHeroArtwork when no hero', () => {
    const idx = GAME_CARD_JS.indexOf('function createRecentCard(game, isFeatured');
    const nextFnIdx = GAME_CARD_JS.indexOf('\nfunction getPlatformClass', idx);
    const block = GAME_CARD_JS.slice(idx, nextFnIdx > idx ? nextFnIdx : idx + 2000);
    assert.ok(block.includes('hydrateRecentHeroArtwork'), 'hydrateRecentHeroArtwork not called in createRecentCard');
});

test('game-card.js: JBI candidate list orders hero before cover before placeholder', () => {
    const idx = GAME_CARD_JS.indexOf('function createRecentCard(game, isFeatured');
    const nextFnIdx = GAME_CARD_JS.indexOf('\nfunction getPlatformClass', idx);
    const block = GAME_CARD_JS.slice(GAME_CARD_JS.indexOf('function _jbiResolveArtworkSelection'), nextFnIdx > idx ? nextFnIdx : idx + 2000);
    assert.ok(block.includes('_jbiUniqueUsableCandidates([hero, cover])'), 'hero/cover candidate list not found');
    assert.ok(block.includes('candidates.push(placeholder)'), 'placeholder fallback not found');
});

test('game-card.js: createRecentCard applies selected JBI candidate to imgEl.src', () => {
    const idx = GAME_CARD_JS.indexOf('function createRecentCard(game, isFeatured');
    const nextFnIdx = GAME_CARD_JS.indexOf('\nfunction getPlatformClass', idx);
    const block = GAME_CARD_JS.slice(idx, nextFnIdx > idx ? nextFnIdx : idx + 2000);
    assert.ok(block.includes('imgEl.src = displayImg'), 'selected display image not applied');
});

test('game-card.js: createRecentCard hero branch calls checkBackgroundAssets', () => {
    const idx = GAME_CARD_JS.indexOf('function createRecentCard(game, isFeatured');
    const nextFnIdx = GAME_CARD_JS.indexOf('\nfunction getPlatformClass', idx);
    const block = GAME_CARD_JS.slice(idx, nextFnIdx > idx ? nextFnIdx : idx + 2000);
    assert.ok(block.includes('checkBackgroundAssets'), 'checkBackgroundAssets not called in hero branch');
});

test('game-card.js: createRecentCard advances failed image to the next JBI candidate', () => {
    const idx = GAME_CARD_JS.indexOf('function createRecentCard(game, isFeatured');
    const nextFnIdx = GAME_CARD_JS.indexOf('\nfunction getPlatformClass', idx);
    const block = GAME_CARD_JS.slice(idx, nextFnIdx > idx ? nextFnIdx : idx + 2000);
    assert.ok(block.includes('jbiCandidateIndex += 1'), 'candidate advance not found');
    assert.ok(block.includes('selection.candidates[jbiCandidateIndex]'), 'next candidate lookup not found');
});

// ── hydrateRecentHeroArtwork error handling ───────────────────────────────────

test('game-card.js: createRecentCard wraps hydrateRecentHeroArtwork in .catch()', () => {
    const idx = GAME_CARD_JS.indexOf('function createRecentCard(game, isFeatured');
    const nextFnIdx = GAME_CARD_JS.indexOf('\nfunction getPlatformClass', idx);
    const block = GAME_CARD_JS.slice(idx, nextFnIdx > idx ? nextFnIdx : idx + 2000);
    assert.ok(block.includes('.catch(err =>'), 'hydrateRecentHeroArtwork must be wrapped in .catch()');
    assert.ok(block.includes('[JumpBackIn] hero hydration failed'), 'JumpBackIn hydration failure log not found');
});

// ── normal createGameCard is unaffected ───────────────────────────────────────

test('game-card.js: createGameCard still uses fetchMetadata (not hydrateRecentHeroArtwork)', () => {
    const idx = GAME_CARD_JS.indexOf("function createGameCard(");
    assert.ok(idx !== -1, 'createGameCard not found');
    // createGameCard ends at _getRecentHeroCandidate (the first helper before createRecentCard)
    const nextFnIdx = GAME_CARD_JS.indexOf('\nfunction _getRecentHeroCandidate', idx);
    const block = GAME_CARD_JS.slice(idx, nextFnIdx > idx ? nextFnIdx : idx + 3000);
    assert.ok(block.includes('fetchMetadata'), 'createGameCard must still call fetchMetadata');
    assert.ok(!block.includes('hydrateRecentHeroArtwork'), 'createGameCard must not call hydrateRecentHeroArtwork');
});
