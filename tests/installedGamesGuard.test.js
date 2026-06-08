'use strict';
// Safety tests for get-installed-games.
// These tests lock in the behavioral contracts of the handler — especially the
// _backgroundScanInProgress guard — so that future extraction cannot silently
// break the concurrent-scan protection or background pipeline ordering.
// All tests are source-level: no Electron process is started.

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT    = path.resolve(__dirname, '..');
const MAIN_JS = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');

const handlerStart = MAIN_JS.indexOf("ipcMain.handle('get-installed-games'");
assert.ok(handlerStart !== -1, "get-installed-games handler must exist in main.js");

// Slice enough source to cover the full handler body (~48 lines).
// Use 4 000 chars to stay safe on Windows CRLF line endings.
const HANDLER_SRC = MAIN_JS.slice(handlerStart, handlerStart + 4000);

// ─── 1. Guard declaration ─────────────────────────────────────────────────────

test('_backgroundScanInProgress is declared before get-installed-games handler', () => {
    const guardIdx = MAIN_JS.indexOf('let _backgroundScanInProgress');
    assert.ok(guardIdx !== -1, 'guard variable must be declared in main.js');
    assert.ok(
        guardIdx < handlerStart,
        '_backgroundScanInProgress must be declared before the handler so the handler closes over it'
    );
});

test('_backgroundScanInProgress is initialised to false', () => {
    const guardIdx  = MAIN_JS.indexOf('let _backgroundScanInProgress');
    const guardLine = MAIN_JS.slice(guardIdx, guardIdx + 60);
    assert.match(guardLine, /_backgroundScanInProgress\s*=\s*false/);
});

// ─── 2. Concurrent-scan guard ─────────────────────────────────────────────────

test('get-installed-games checks !_backgroundScanInProgress before launching background scan', () => {
    assert.match(HANDLER_SRC, /!\s*_backgroundScanInProgress/);
});

test('get-installed-games sets _backgroundScanInProgress = true before scan starts', () => {
    assert.match(HANDLER_SRC, /_backgroundScanInProgress\s*=\s*true/);
});

test('_backgroundScanInProgress is set synchronously before scanAllGames is invoked (no await in between)', () => {
    // This is the critical atomicity invariant: the guard must be raised
    // synchronously (before any microtask boundary) so that a concurrent
    // IPC call arriving on the same turn sees the flag already set.
    const setIdx      = HANDLER_SRC.indexOf('_backgroundScanInProgress = true');
    const scanCallIdx = HANDLER_SRC.indexOf('scanAllGames()', setIdx);
    assert.ok(setIdx !== -1, '_backgroundScanInProgress must be set to true');
    assert.ok(scanCallIdx !== -1, 'scanAllGames() must follow the guard set');
    assert.ok(setIdx < scanCallIdx, 'guard must be set before scanAllGames is called');
    const between = HANDLER_SRC.slice(setIdx + '_backgroundScanInProgress = true'.length, scanCallIdx);
    assert.ok(!/\bawait\b/.test(between), 'no await may appear between the guard set and the scanAllGames call');
});

test('_backgroundScanInProgress is reset to false in both success and failure paths', () => {
    // There must be exactly two resets: one in .then() (success) and one in .catch() (failure).
    const resets = HANDLER_SRC.match(/_backgroundScanInProgress\s*=\s*false/g);
    assert.ok(resets && resets.length >= 2, 'guard must be reset in both .then() and .catch() so future calls are not permanently blocked');
});

test('get-installed-games resets _backgroundScanInProgress to false after scan failure (.catch path)', () => {
    // Failure path: if scanAllGames() rejects, the guard must be cleared so
    // the next call to get-installed-games can attempt a background scan again.
    assert.match(HANDLER_SRC, /\.catch\(\s*\(\s*\)\s*=>\s*\{\s*_backgroundScanInProgress\s*=\s*false/);
});

// ─── 3. Fresh-install (empty DB) path ────────────────────────────────────────

test('get-installed-games detects fresh install when stored.length === 0', () => {
    assert.match(HANDLER_SRC, /stored\.length\s*===\s*0/);
});

test('get-installed-games fresh-install path awaits scanAllGames before returning', () => {
    const freshIdx   = HANDLER_SRC.indexOf('stored.length');
    const freshBlock = HANDLER_SRC.slice(freshIdx, freshIdx + 600);
    // Must be awaited — fresh install cannot return stale data
    assert.match(freshBlock, /await\s+scanAllGames\(\)/);
});

test('get-installed-games fresh-install path calls refetchMissingImages', () => {
    const freshIdx   = HANDLER_SRC.indexOf('stored.length');
    const freshBlock = HANDLER_SRC.slice(freshIdx, freshIdx + 600);
    assert.match(freshBlock, /refetchMissingImages/);
});

test('get-installed-games fresh-install path calls runBackgroundMetadataPipeline', () => {
    const freshIdx   = HANDLER_SRC.indexOf('stored.length');
    const freshBlock = HANDLER_SRC.slice(freshIdx, freshIdx + 1200);
    assert.match(freshBlock, /runBackgroundMetadataPipeline/);
});

// ─── 4. Normal (non-empty DB) path ───────────────────────────────────────────

test('get-installed-games returns stored games immediately in normal path', () => {
    // The synchronous return must exist after the background-scan if-block
    assert.match(HANDLER_SRC, /return stored/);
});

test('return stored appears after the guard check, not inside the fresh-install branch', () => {
    const guardCheckIdx   = HANDLER_SRC.indexOf('!_backgroundScanInProgress');
    const returnStoredIdx = HANDLER_SRC.lastIndexOf('return stored');
    assert.ok(guardCheckIdx !== -1, 'guard check must be present');
    assert.ok(returnStoredIdx !== -1, 'return stored must be present');
    assert.ok(guardCheckIdx < returnStoredIdx, 'guard check must precede return stored');
});

// ─── 5. Event sending ─────────────────────────────────────────────────────────

test('get-installed-games sends library-updated to renderer after background scan resolves', () => {
    // library-updated must be sent inside the .then() callback (i.e. after scan resolves)
    const thenIdx = HANDLER_SRC.indexOf('.then(');
    assert.ok(thenIdx !== -1, '.then() callback must exist');
    const libraryUpdatedIdx = HANDLER_SRC.indexOf("'library-updated'", thenIdx);
    assert.ok(libraryUpdatedIdx !== -1, "'library-updated' must appear inside or after the .then() callback");
});

test('get-installed-games sends game-image-updated via notifyGameImageUpdated callback', () => {
    assert.match(HANDLER_SRC, /['"]game-image-updated['"]/);
});

// ─── 6. Background pipeline deferral ─────────────────────────────────────────

test('runBackgroundMetadataPipeline in normal path is wrapped in setTimeout deferred by 2000 ms', () => {
    // Verify setTimeout with 2000 ms exists in the handler and that
    // runBackgroundMetadataPipeline appears AFTER the setTimeout anchor.
    assert.match(HANDLER_SRC, /setTimeout/);
    assert.match(HANDLER_SRC, /2000/);
    const setTimeoutIdx     = HANDLER_SRC.indexOf('setTimeout');
    const pipelineAfterIdx  = HANDLER_SRC.indexOf('runBackgroundMetadataPipeline', setTimeoutIdx);
    assert.ok(
        pipelineAfterIdx !== -1,
        'runBackgroundMetadataPipeline must appear inside the setTimeout callback (after its opening)'
    );
});
