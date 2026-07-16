'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'src/dashboard.html'), 'utf8');
const APP_JS = fs.readFileSync(path.join(ROOT, 'src/js/app.js'), 'utf8');
const ACCOUNTS_JS = fs.readFileSync(path.join(ROOT, 'src/js/accounts.js'), 'utf8');
const SUGGESTIONS_JS = fs.readFileSync(path.join(ROOT, 'src/js/app/suggestions.js'), 'utf8');
const GAME_DETAILS_JS = fs.readFileSync(path.join(ROOT, 'src/js/game-details.js'), 'utf8');

test('dashboard loads CanonicalProductIdentity before suggestions, app, accounts, and game-details', () => {
    const serviceIdx = HTML.indexOf('features/games/domain/services/CanonicalProductIdentity.js');
    assert.notEqual(serviceIdx, -1, 'CanonicalProductIdentity must be loaded by dashboard.html');

    for (const script of ['js/app/suggestions.js', 'js/app.js', 'js/accounts.js', 'js/game-details.js']) {
        const idx = HTML.indexOf(script);
        assert.ok(idx > serviceIdx, `${script} must load after CanonicalProductIdentity`);
    }
});

test('app.js dedupes delegated launcher games before publishing allGamesData and playtime cache', () => {
    assert.match(APP_JS, /function\s+_dedupeDelegatedLaunchProducts\s*\(/);
    assert.match(APP_JS, /allGamesData\s*=\s*_dedupeDelegatedLaunchProducts\(games\)/);
    assert.match(APP_JS, /const\s+mergedGames\s*=\s*_dedupeDelegatedLaunchProducts\(_mergeCanonicalArtworkAcrossLibrary/);
    assert.match(APP_JS, /buildPlaytimeCache\(allGamesData\)/);
});

test('accounts.js dedupes delegated launcher games in installed override and All Games caches', () => {
    assert.match(ACCOUNTS_JS, /function\s+_agDedupeDelegatedLaunchProducts\s*\(/);
    assert.match(ACCOUNTS_JS, /window\.allGamesData\s*=\s*installedGames/);
    assert.match(ACCOUNTS_JS, /_rawResolved\s*=\s*_agDedupeDelegatedLaunchProducts\(_rawResolved\)/);
    assert.match(ACCOUNTS_JS, /newCache\s*=\s*_agDedupeDelegatedLaunchProducts\(await _agApplyInstalledCreatorOverrides\(newCache\)\)/);
});

test('renderer installed matchers allow delegated product identity without generic cross-platform title merge', () => {
    assert.match(SUGGESTIONS_JS, /deriveCanonicalProductIdentity/);
    assert.doesNotMatch(SUGGESTIONS_JS, /_agTitleToRiotProduct\(game\.name \|\| game\.title \|\| ''\)/);
    assert.match(SUGGESTIONS_JS, /_agCanMerge\(game,\s*g\)\)\s*why = 'title-main-game'/);

    assert.match(GAME_DETAILS_JS, /deriveCanonicalProductIdentity/);
    assert.doesNotMatch(GAME_DETAILS_JS, /_gdTitleToRiotProduct\(game\.name \|\| game\.title \|\| ''\)/);
    assert.doesNotMatch(GAME_DETAILS_JS, /_gdIsMainGame\(game\) && _gdIsMainGame\(g\)\) return g/);
});
