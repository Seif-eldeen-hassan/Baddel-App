'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const {
    _cleanGameMatchText,
    _isTechnicalExeSuffix,
    _isVersionLikeSuffix,
    _safeFuzzyGameNameMatch,
} = require('../services/playtimeShared');

// ─── _cleanGameMatchText ──────────────────────────────────────────────────────

test('_cleanGameMatchText: strips .exe and lowercases', () => {
    assert.equal(_cleanGameMatchText('MyGame.exe'), 'mygame');
});

test('_cleanGameMatchText: removes non-alphanumeric chars', () => {
    assert.equal(_cleanGameMatchText("Assassin's Creed"), 'assassinscreed');
});

test('_cleanGameMatchText: handles null gracefully', () => {
    assert.equal(_cleanGameMatchText(null), '');
});

test('_cleanGameMatchText: handles undefined gracefully', () => {
    assert.equal(_cleanGameMatchText(undefined), '');
});

test('_cleanGameMatchText: strips .exe case-insensitively', () => {
    assert.equal(_cleanGameMatchText('Game.EXE'), 'game');
});

test('_cleanGameMatchText: collapses spaces and special chars', () => {
    assert.equal(_cleanGameMatchText('Red Dead Redemption 2'), 'reddeadredemption2');
});

// ─── _isTechnicalExeSuffix ───────────────────────────────────────────────────

test('_isTechnicalExeSuffix: empty string is technical (no suffix)', () => {
    assert.equal(_isTechnicalExeSuffix(''), true);
});

test('_isTechnicalExeSuffix: null is treated as technical', () => {
    assert.equal(_isTechnicalExeSuffix(null), true);
});

test('_isTechnicalExeSuffix: "win64" is technical', () => {
    assert.equal(_isTechnicalExeSuffix('win64'), true);
});

test('_isTechnicalExeSuffix: "win32" is technical', () => {
    assert.equal(_isTechnicalExeSuffix('win32'), true);
});

test('_isTechnicalExeSuffix: "shipping" is technical', () => {
    assert.equal(_isTechnicalExeSuffix('shipping'), true);
});

test('_isTechnicalExeSuffix: "win64shipping" is technical', () => {
    assert.equal(_isTechnicalExeSuffix('win64shipping'), true);
});

test('_isTechnicalExeSuffix: "dx11" is technical', () => {
    assert.equal(_isTechnicalExeSuffix('dx11'), true);
});

test('_isTechnicalExeSuffix: "vulkan" is technical', () => {
    assert.equal(_isTechnicalExeSuffix('vulkan'), true);
});

test('_isTechnicalExeSuffix: "game" is technical', () => {
    assert.equal(_isTechnicalExeSuffix('game'), true);
});

test('_isTechnicalExeSuffix: "retail" is technical', () => {
    assert.equal(_isTechnicalExeSuffix('retail'), true);
});

test('_isTechnicalExeSuffix: "2" is NOT technical', () => {
    assert.equal(_isTechnicalExeSuffix('2'), false);
});

test('_isTechnicalExeSuffix: "server" is NOT technical', () => {
    assert.equal(_isTechnicalExeSuffix('server'), false);
});

test('_isTechnicalExeSuffix: "ii" is NOT technical', () => {
    assert.equal(_isTechnicalExeSuffix('ii'), false);
});

// ─── _isVersionLikeSuffix ────────────────────────────────────────────────────

test('_isVersionLikeSuffix: empty string is NOT version-like', () => {
    assert.equal(_isVersionLikeSuffix(''), false);
});

test('_isVersionLikeSuffix: null is NOT version-like', () => {
    assert.equal(_isVersionLikeSuffix(null), false);
});

test('_isVersionLikeSuffix: "2" is version-like', () => {
    assert.equal(_isVersionLikeSuffix('2'), true);
});

test('_isVersionLikeSuffix: "2024" is version-like (year)', () => {
    assert.equal(_isVersionLikeSuffix('2024'), true);
});

test('_isVersionLikeSuffix: "ii" is version-like (roman)', () => {
    assert.equal(_isVersionLikeSuffix('ii'), true);
});

test('_isVersionLikeSuffix: "iii" is version-like', () => {
    assert.equal(_isVersionLikeSuffix('iii'), true);
});

test('_isVersionLikeSuffix: "iv" is version-like', () => {
    assert.equal(_isVersionLikeSuffix('iv'), true);
});

test('_isVersionLikeSuffix: "x" is version-like (roman 10)', () => {
    assert.equal(_isVersionLikeSuffix('x'), true);
});

test('_isVersionLikeSuffix: "win64" is NOT version-like', () => {
    assert.equal(_isVersionLikeSuffix('win64'), false);
});

test('_isVersionLikeSuffix: "shipping" is NOT version-like', () => {
    assert.equal(_isVersionLikeSuffix('shipping'), false);
});

// ─── _safeFuzzyGameNameMatch — true positives ─────────────────────────────────

test('fuzzy match: exact alphanumeric equality', () => {
    assert.equal(_safeFuzzyGameNameMatch('Fortnite', 'fortnite.exe'), true);
});

test('fuzzy match: process is game + win64 suffix', () => {
    assert.equal(_safeFuzzyGameNameMatch('Hades', 'hadeswin64.exe'), true);
});

test('fuzzy match: process is game + win64shipping suffix', () => {
    assert.equal(_safeFuzzyGameNameMatch('AC Mirage', 'acmiragewin64shipping.exe'), true);
});

test('fuzzy match: process is game + dx11 suffix', () => {
    assert.equal(_safeFuzzyGameNameMatch('Control', 'controldx11.exe'), true);
});

test('fuzzy match: process is game + retail suffix', () => {
    assert.equal(_safeFuzzyGameNameMatch('Cyberpunk 2077', 'cyberpunk2077retail.exe'), true);
});

test('fuzzy match: game name starts with 8-char process name', () => {
    // "reddead" = 7 chars → below threshold; "reddeadr" = 8 → at threshold
    assert.equal(_safeFuzzyGameNameMatch('Red Dead Redemption', 'reddeadr.exe'), true);
});

test('fuzzy match: game name starts with long process name (>8 chars)', () => {
    assert.equal(_safeFuzzyGameNameMatch('Battlefield Hardline', 'battlefield.exe'), true);
});

// ─── _safeFuzzyGameNameMatch — false positive guards ─────────────────────────

test('fuzzy guard: Little Nightmares must NOT match Little Nightmares II', () => {
    assert.equal(_safeFuzzyGameNameMatch('Little Nightmares', 'littlenightmaresii.exe'), false);
});

test('fuzzy guard: sequel suffix "2" blocks match', () => {
    assert.equal(_safeFuzzyGameNameMatch('Battlefront', 'battlefront2.exe'), false);
});

test('fuzzy guard: sequel suffix "iv" blocks match', () => {
    assert.equal(_safeFuzzyGameNameMatch('Final Fantasy', 'finalfantasyiv.exe'), false);
});

test('fuzzy guard: process name shorter than 3 chars returns false', () => {
    assert.equal(_safeFuzzyGameNameMatch('Hades', 'ha'), false);
});

test('fuzzy guard: empty game name returns false', () => {
    assert.equal(_safeFuzzyGameNameMatch('', 'game.exe'), false);
});

test('fuzzy guard: empty process name returns false', () => {
    assert.equal(_safeFuzzyGameNameMatch('Hades', ''), false);
});

test('fuzzy guard: process only 7 chars — below game-starts-with threshold', () => {
    // "reddead" = 7 chars, threshold is 8
    assert.equal(_safeFuzzyGameNameMatch('Red Dead Redemption', 'reddead.exe'), false);
});

test('fuzzy guard: completely unrelated names do not match', () => {
    assert.equal(_safeFuzzyGameNameMatch('Minecraft', 'chrome.exe'), false);
});

test('fuzzy guard: sequel roman numeral "iii" blocks match', () => {
    assert.equal(_safeFuzzyGameNameMatch('Dark Souls', 'darksoulsiii.exe'), false);
});

test('fuzzy guard: game "Red Dead Redemption 2" — numeral is in game name not suffix', () => {
    // cleanGame = "reddeadredemption2", cleanProc = "reddeadredemption2" → exact → true
    assert.equal(_safeFuzzyGameNameMatch('Red Dead Redemption 2', 'RedDeadRedemption2.exe'), true);
});
