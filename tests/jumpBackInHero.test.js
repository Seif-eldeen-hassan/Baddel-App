'use strict';
const test   = require('node:test');
const assert = require('assert/strict');
const fs     = require('path');
const path   = require('path');
const fss    = require('fs');

const APP_JS = fss.readFileSync(path.join(__dirname, '..', 'src', 'js', 'app.js'), 'utf8');

// ── Helper functions defined ───────────────────────────────────────────────────

test('app.js: _getRecentHeroCandidate function is defined', () => {
    assert.ok(APP_JS.includes('function _getRecentHeroCandidate(game)'));
});

test('app.js: _getRecentHeroCandidate checks heroImage first', () => {
    const idx = APP_JS.indexOf('function _getRecentHeroCandidate(game)');
    // Only scan up to the closing brace of this short function (no more than 180 chars)
    const block = APP_JS.slice(idx, idx + 180);
    const heroIdx    = block.indexOf('heroImage');
    const defaultIdx = block.indexOf('defaultHero');
    const imageIdx   = block.indexOf('game.image');
    assert.ok(heroIdx !== -1, 'heroImage not checked');
    assert.ok(defaultIdx !== -1, 'defaultHero not checked');
    assert.ok(heroIdx < defaultIdx, 'heroImage must come before defaultHero');
    // game.image belongs in the poster fallback, not in the hero candidate
    assert.ok(imageIdx === -1, 'game.image must not appear in _getRecentHeroCandidate');
});

test('app.js: _getRecentHeroCandidate includes heroUrl and hero aliases', () => {
    const idx = APP_JS.indexOf('function _getRecentHeroCandidate(game)');
    const block = APP_JS.slice(idx, idx + 300);
    assert.ok(block.includes('heroUrl'), 'heroUrl not in hero candidate');
    assert.ok(block.includes('game.hero'), 'game.hero not in hero candidate');
});

test('app.js: _getRecentPosterFallback function is defined', () => {
    assert.ok(APP_JS.includes('function _getRecentPosterFallback(game)'));
});

test('app.js: _getRecentPosterFallback checks image/defaultImage/coverUrl', () => {
    const idx = APP_JS.indexOf('function _getRecentPosterFallback(game)');
    const block = APP_JS.slice(idx, idx + 300);
    assert.ok(block.includes('game.image'), 'game.image not in poster fallback');
    assert.ok(block.includes('defaultImage'), 'defaultImage not in poster fallback');
    assert.ok(block.includes('coverUrl'), 'coverUrl not in poster fallback');
});

test('app.js: _getRecentPosterFallback does NOT include heroImage', () => {
    const idx = APP_JS.indexOf('function _getRecentPosterFallback(game)');
    const block = APP_JS.slice(idx, idx + 300);
    assert.ok(!block.includes('heroImage'), 'heroImage must not appear in _getRecentPosterFallback');
});

test('app.js: _getRecentDisplayImage function is defined', () => {
    assert.ok(APP_JS.includes('function _getRecentDisplayImage(game)'));
});

test('app.js: _getRecentDisplayImage calls _getRecentHeroCandidate first', () => {
    const idx = APP_JS.indexOf('function _getRecentDisplayImage(game)');
    const block = APP_JS.slice(idx, idx + 300);
    const heroIdx   = block.indexOf('_getRecentHeroCandidate');
    const posterIdx = block.indexOf('_getRecentPosterFallback');
    assert.ok(heroIdx !== -1, '_getRecentHeroCandidate not called');
    assert.ok(posterIdx !== -1, '_getRecentPosterFallback not called');
    assert.ok(heroIdx < posterIdx, '_getRecentHeroCandidate must come before _getRecentPosterFallback');
});

// ── hydrateRecentHeroArtwork ───────────────────────────────────────────────────

test('app.js: hydrateRecentHeroArtwork function is defined', () => {
    assert.ok(APP_JS.includes('async function hydrateRecentHeroArtwork(game, imgEl)'));
});

test('app.js: hydrateRecentHeroArtwork passes preferHero:true to getMetadata', () => {
    const idx = APP_JS.indexOf('async function hydrateRecentHeroArtwork(game, imgEl)');
    const block = APP_JS.slice(idx, idx + 1000);
    assert.ok(block.includes('preferHero:     true') || block.includes("preferHero: true"), 'preferHero:true not passed');
});

test('app.js: hydrateRecentHeroArtwork passes source:jump-back-in to getMetadata', () => {
    const idx = APP_JS.indexOf('async function hydrateRecentHeroArtwork(game, imgEl)');
    const block = APP_JS.slice(idx, idx + 1000);
    assert.ok(block.includes("source:         'jump-back-in'") || block.includes("source: 'jump-back-in'"), "source: 'jump-back-in' not passed");
});

test('app.js: hydrateRecentHeroArtwork sets game.heroImage on success', () => {
    const idx = APP_JS.indexOf('async function hydrateRecentHeroArtwork(game, imgEl)');
    const block = APP_JS.slice(idx, idx + 2000);
    assert.ok(block.includes('game.heroImage'), 'game.heroImage not set');
    assert.ok(block.includes('game.defaultHero'), 'game.defaultHero not set');
    assert.ok(block.includes('game.heroUrl'), 'game.heroUrl not set');
});

test('app.js: hydrateRecentHeroArtwork sets imgEl.src to hero when hero found', () => {
    const idx = APP_JS.indexOf('async function hydrateRecentHeroArtwork(game, imgEl)');
    const block = APP_JS.slice(idx, idx + 2000);
    assert.ok(block.includes('imgEl.src = safeImageUrl(hero)'), 'imgEl.src not set to hero');
});

test('app.js: hydrateRecentHeroArtwork caches to localStorage', () => {
    const idx = APP_JS.indexOf('async function hydrateRecentHeroArtwork(game, imgEl)');
    const block = APP_JS.slice(idx, idx + 2000);
    assert.ok(block.includes("localStorage.setItem('hero_'"), 'localStorage.setItem for hero not found');
});

test('app.js: hydrateRecentHeroArtwork calls cacheAllAssets when assets available', () => {
    const idx = APP_JS.indexOf('async function hydrateRecentHeroArtwork(game, imgEl)');
    const block = APP_JS.slice(idx, idx + 2000);
    assert.ok(block.includes('cacheAllAssets'), 'cacheAllAssets not called');
});

test('app.js: hydrateRecentHeroArtwork only uses cover as last fallback (no hero)', () => {
    const idx = APP_JS.indexOf('async function hydrateRecentHeroArtwork(game, imgEl)');
    const block = APP_JS.slice(idx, idx + 2500);
    // The cover fallback must come AFTER the hero block
    const heroSetIdx  = block.indexOf('game.heroImage  = hero');
    const coverFbIdx  = block.indexOf('cover && !imgEl.src');
    assert.ok(heroSetIdx !== -1, 'hero assignment not found');
    assert.ok(coverFbIdx !== -1, 'cover-only fallback not found');
    assert.ok(heroSetIdx < coverFbIdx, 'cover fallback must come after hero block');
});

// ── createRecentCard integration ──────────────────────────────────────────────

test('app.js: createRecentCard uses _getRecentDisplayImage for initial displayImg', () => {
    const idx = APP_JS.indexOf('function createRecentCard(game, isFeatured');
    const block = APP_JS.slice(idx, idx + 600);
    assert.ok(block.includes('_getRecentDisplayImage(game)'), '_getRecentDisplayImage not called for displayImg');
});

test('app.js: createRecentCard does NOT call fetchMetadata directly', () => {
    const idx = APP_JS.indexOf('function createRecentCard(game, isFeatured');
    // Search the full card function body (up to the next top-level function)
    const nextFnIdx = APP_JS.indexOf('\nfunction getPlatformClass', idx);
    const block = APP_JS.slice(idx, nextFnIdx > idx ? nextFnIdx : idx + 2000);
    assert.ok(!block.includes('fetchMetadata('), 'fetchMetadata must not be called from createRecentCard');
});

test('app.js: createRecentCard uses _getRecentHeroCandidate for hero check', () => {
    const idx = APP_JS.indexOf('function createRecentCard(game, isFeatured');
    const nextFnIdx = APP_JS.indexOf('\nfunction getPlatformClass', idx);
    const block = APP_JS.slice(idx, nextFnIdx > idx ? nextFnIdx : idx + 2000);
    assert.ok(block.includes('_getRecentHeroCandidate'), '_getRecentHeroCandidate not used in createRecentCard');
});

test('app.js: createRecentCard uses _getRecentPosterFallback for poster fallback', () => {
    const idx = APP_JS.indexOf('function createRecentCard(game, isFeatured');
    const nextFnIdx = APP_JS.indexOf('\nfunction getPlatformClass', idx);
    const block = APP_JS.slice(idx, nextFnIdx > idx ? nextFnIdx : idx + 2000);
    assert.ok(block.includes('_getRecentPosterFallback'), '_getRecentPosterFallback not used in createRecentCard');
});

test('app.js: createRecentCard calls hydrateRecentHeroArtwork when no hero', () => {
    const idx = APP_JS.indexOf('function createRecentCard(game, isFeatured');
    const nextFnIdx = APP_JS.indexOf('\nfunction getPlatformClass', idx);
    const block = APP_JS.slice(idx, nextFnIdx > idx ? nextFnIdx : idx + 2000);
    assert.ok(block.includes('hydrateRecentHeroArtwork'), 'hydrateRecentHeroArtwork not called in createRecentCard');
});

test('app.js: createRecentCard sets imgEl.src to safeImageUrl(recentHero) when hero present', () => {
    const idx = APP_JS.indexOf('function createRecentCard(game, isFeatured');
    const nextFnIdx = APP_JS.indexOf('\nfunction getPlatformClass', idx);
    const block = APP_JS.slice(idx, nextFnIdx > idx ? nextFnIdx : idx + 2000);
    assert.ok(block.includes('imgEl.src = safeImageUrl(recentHero)'), 'safeImageUrl(recentHero) not set on imgEl.src');
});

test('app.js: createRecentCard poster fallback sets imgEl.src to safeImageUrl(recentPoster)', () => {
    const idx = APP_JS.indexOf('function createRecentCard(game, isFeatured');
    const nextFnIdx = APP_JS.indexOf('\nfunction getPlatformClass', idx);
    const block = APP_JS.slice(idx, nextFnIdx > idx ? nextFnIdx : idx + 2000);
    assert.ok(block.includes('imgEl.src = safeImageUrl(recentPoster)'), 'safeImageUrl(recentPoster) not set as fallback');
});

test('app.js: createRecentCard hero branch calls checkBackgroundAssets', () => {
    const idx = APP_JS.indexOf('function createRecentCard(game, isFeatured');
    const nextFnIdx = APP_JS.indexOf('\nfunction getPlatformClass', idx);
    const block = APP_JS.slice(idx, nextFnIdx > idx ? nextFnIdx : idx + 2000);
    assert.ok(block.includes('checkBackgroundAssets'), 'checkBackgroundAssets not called in hero branch');
});

test('app.js: createRecentCard hero branch comes before poster branch', () => {
    const idx = APP_JS.indexOf('function createRecentCard(game, isFeatured');
    const nextFnIdx = APP_JS.indexOf('\nfunction getPlatformClass', idx);
    const block = APP_JS.slice(idx, nextFnIdx > idx ? nextFnIdx : idx + 2000);
    const heroIdx   = block.indexOf('safeImageUrl(recentHero)');
    const posterIdx = block.indexOf('safeImageUrl(recentPoster)');
    assert.ok(heroIdx !== -1, 'recentHero branch not found');
    assert.ok(posterIdx !== -1, 'recentPoster branch not found');
    assert.ok(heroIdx < posterIdx, 'hero branch must appear before poster branch');
});

// ── hydrateRecentHeroArtwork error handling ───────────────────────────────────

test('app.js: createRecentCard wraps hydrateRecentHeroArtwork in .catch()', () => {
    const idx = APP_JS.indexOf('function createRecentCard(game, isFeatured');
    const nextFnIdx = APP_JS.indexOf('\nfunction getPlatformClass', idx);
    const block = APP_JS.slice(idx, nextFnIdx > idx ? nextFnIdx : idx + 2000);
    assert.ok(block.includes('.catch(err =>'), 'hydrateRecentHeroArtwork must be wrapped in .catch()');
    assert.ok(block.includes('[JumpBackIn] hero hydration failed'), 'JumpBackIn hydration failure log not found');
});

// ── normal createGameCard is unaffected ───────────────────────────────────────

test('app.js: createGameCard still uses fetchMetadata (not hydrateRecentHeroArtwork)', () => {
    const idx = APP_JS.indexOf("function createGameCard(");
    assert.ok(idx !== -1, 'createGameCard not found');
    // createGameCard ends at _getRecentHeroCandidate (the first helper before createRecentCard)
    const nextFnIdx = APP_JS.indexOf('\nfunction _getRecentHeroCandidate', idx);
    const block = APP_JS.slice(idx, nextFnIdx > idx ? nextFnIdx : idx + 3000);
    assert.ok(block.includes('fetchMetadata'), 'createGameCard must still call fetchMetadata');
    assert.ok(!block.includes('hydrateRecentHeroArtwork'), 'createGameCard must not call hydrateRecentHeroArtwork');
});
