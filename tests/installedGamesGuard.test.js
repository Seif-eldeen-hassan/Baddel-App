'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MAIN_JS = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
const ACCOUNTS_JS = fs.readFileSync(path.join(ROOT, 'src', 'js', 'accounts.js'), 'utf8');
const INSTALLED_GAMES_HANDLERS_JS = fs.readFileSync(
    path.join(ROOT, 'handlers', 'installedGamesHandlers.js'),
    'utf8'
);

const handlerStart = INSTALLED_GAMES_HANDLERS_JS.indexOf("ipcMain.handle('get-installed-games'");
assert.ok(handlerStart !== -1, 'get-installed-games handler must exist');
const HANDLER_SRC = INSTALLED_GAMES_HANDLERS_JS.slice(handlerStart, handlerStart + 4000);

test('installedGamesState is declared in main.js with backgroundScanInProgress: false', () => {
    assert.match(MAIN_JS, /const installedGamesState\s*=\s*\{\s*backgroundScanInProgress:\s*false\s*\}/);
});

test('installedGamesState is passed to installedGamesHandlers through gamesIpc deps', () => {
    const gamesIpcIdx = MAIN_JS.lastIndexOf('gamesIpc.register(ipcMain');
    assert.ok(gamesIpcIdx !== -1, 'gamesIpc.register must be the primary games registration');
    const depsBagIdx = MAIN_JS.lastIndexOf('const _gamesDeps', gamesIpcIdx);
    const depsBag = MAIN_JS.slice(depsBagIdx, gamesIpcIdx);
    assert.match(depsBag, /installedGamesState/);
});

test('get-installed-games raises the background scan guard before scanAllGames', () => {
    const setAnchor = 'installedGamesState.backgroundScanInProgress = true';
    const setIdx = HANDLER_SRC.indexOf(setAnchor);
    const scanCallIdx = HANDLER_SRC.indexOf('scanAllGames()', setIdx);
    assert.ok(setIdx !== -1, 'guard must be set');
    assert.ok(scanCallIdx !== -1, 'scanAllGames must be called');
    assert.ok(setIdx < scanCallIdx, 'guard must be set before scan starts');
    assert.doesNotMatch(HANDLER_SRC.slice(setIdx + setAnchor.length, scanCallIdx), /\bawait\b/);
});

test('get-installed-games resets the scan guard on success and failure', () => {
    const resets = HANDLER_SRC.match(/installedGamesState\.backgroundScanInProgress\s*=\s*false/g);
    assert.ok(resets && resets.length >= 2, 'guard must reset in both paths');
    assert.match(HANDLER_SRC, /\.catch\(\s*err\s*=>\s*\{\s*installedGamesState\.backgroundScanInProgress\s*=\s*false/);
});

test('empty stored games return immediately and do not await scanAllGames', () => {
    assert.match(HANDLER_SRC, /stored\.length\s*===\s*0/);
    assert.match(HANDLER_SRC, /return stored/);
    assert.match(HANDLER_SRC, /scanAllGames\(\)/);
    assert.doesNotMatch(HANDLER_SRC, /await\s+scanAllGames\(\)/);
});

test('concurrent startup callers share one background scan guard', () => {
    assert.match(HANDLER_SRC, /!\s*installedGamesState\.backgroundScanInProgress/);
    assert.equal((HANDLER_SRC.match(/scanAllGames\(\)/g) || []).length, 1);
});

test('get-installed-games emits explicit scan-started, scan-finished, and scan-failed states', () => {
    assert.match(HANDLER_SRC, /installed-games-scan-state/);
    assert.match(HANDLER_SRC, /scan-started/);
    assert.match(HANDLER_SRC, /scan-finished/);
    assert.match(HANDLER_SRC, /scan-failed/);
});

test('get-installed-games sends library-updated after background scan resolves', () => {
    const thenIdx = HANDLER_SRC.indexOf('.then(');
    assert.ok(thenIdx !== -1, '.then callback must exist');
    assert.ok(HANDLER_SRC.indexOf("'library-updated'", thenIdx) !== -1);
});

test('get-installed-games sends game-image-updated via notifyGameImageUpdated callback', () => {
    assert.match(HANDLER_SRC, /['"]game-image-updated['"]/);
});

test('background pipeline remains deferred after scan resolves', () => {
    const setTimeoutIdx = HANDLER_SRC.indexOf('setTimeout');
    const pipelineAfterIdx = HANDLER_SRC.indexOf('runBackgroundMetadataPipeline', setTimeoutIdx);
    assert.ok(setTimeoutIdx !== -1, 'setTimeout must defer metadata pipeline');
    assert.ok(pipelineAfterIdx !== -1, 'metadata pipeline must run inside deferred callback');
    assert.match(HANDLER_SRC, /2000/);
});

test('installed filter treats downloaded launch records as installed', () => {
    assert.match(ACCOUNTS_JS, /g\.path \|\| g\.command \|\| g\.launchCommand \|\| g\.executablePath \|\| g\.installVerified \|\| g\.isInstalled/);
    assert.match(ACCOUNTS_JS, /local entry has a launch target or verified installed marker/);
});
