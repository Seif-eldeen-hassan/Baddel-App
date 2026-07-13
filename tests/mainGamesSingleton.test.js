'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MAIN_JS = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');

const GAME_API_NAMES = [
    'scanAllGames',
    'addManualGame',
    'getSavedGames',
    'updateGameImage',
    'resetGameImage',
    'removeGame',
    'renameGame',
    'unhideAllGames',
    'getHiddenGames',
    'restoreSpecificGames',
    'deleteGamePermanently',
    'reorderLibrary',
    'updateGameMetadata',
    'saveFullMetadata',
    'loadFullMetadata',
    'updatePlaytime',
    'setTimeTrackingEnabled',
    'getTimeTrackingEnabled',
    'refetchMissingImages',
    'runBackgroundMetadataPipeline',
    'getJsonGameRepository',
];

test('main.js imports getGamesFeature from GamesContainer', () => {
    assert.match(
        MAIN_JS,
        /const\s*\{\s*getGamesFeature\s*\}\s*=\s*require\(['"]\.\/src\/features\/games\/infrastructure\/composition\/GamesContainer['"]\)/,
    );
});

test('main.js creates exactly one module-level gamesApi singleton', () => {
    const matches = MAIN_JS.match(/const\s+gamesApi\s*=\s*getGamesFeature\s*\(\s*\)/g) || [];
    assert.equal(matches.length, 1);
});

test('main.js no longer requires the gameScanner shim', () => {
    assert.doesNotMatch(MAIN_JS, /require\s*\(\s*['"]\.\/gameScanner['"]\s*\)/);
});

test('main.js does not call createGamesFeature', () => {
    assert.doesNotMatch(MAIN_JS, /createGamesFeature/);
});

test('main.js preserves the expected games API names', () => {
    for (const name of GAME_API_NAMES) {
        assert.match(MAIN_JS, new RegExp(`\\b${name}\\b`), `${name} missing from main.js`);
    }
});

test('main.js uses gamesApi for former dynamic gameScanner calls', () => {
    for (const expression of [
        'gamesApi.updatePlaytime',
        'gamesApi.saveQualifiedSession',
        'gamesApi.resolutionManager',
        'gamesApi.registerLocalMetadataResolver',
        'gamesApi.registerImageDownloader',
        'gamesApi.getSavedGames',
    ]) {
        assert.ok(MAIN_JS.includes(expression), `${expression} missing from main.js`);
    }
});
