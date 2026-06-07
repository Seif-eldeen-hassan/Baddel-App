'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const MAIN_JS = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Extract the complete source block starting at `anchor` through its matching
// closing brace.  Handles string literals so brace-characters inside strings
// are not counted.  Throws if the anchor is not found or has no matching brace,
// preventing tests from silently passing on a missing or truncated block.
function fnBody(anchor) {
    const start = MAIN_JS.indexOf(anchor);
    if (start === -1) throw new Error(`Anchor "${anchor}" not found in main.js`);

    let i = start;
    let depth = 0;
    let foundOpen = false;
    let inString = false;
    let stringChar = '';

    while (i < MAIN_JS.length) {
        const ch = MAIN_JS[i];

        if (inString) {
            if (ch === '\\') { i += 2; continue; } // skip escaped character
            if (ch === stringChar) inString = false;
        } else if (ch === '"' || ch === "'" || ch === '`') {
            inString = true;
            stringChar = ch;
        } else if (ch === '{') {
            depth++;
            foundOpen = true;
        } else if (ch === '}' && foundOpen) {
            depth--;
            if (depth === 0) return MAIN_JS.slice(start, i + 1);
        }
        i++;
    }

    throw new Error(`No matching closing brace for anchor "${anchor}"`);
}

// ─── 1. _updState shape ───────────────────────────────────────────────────────

test('_updState is declared with status, version, downloading, downloaded fields', () => {
    const block = fnBody('const _updState');
    assert.match(block, /status:/);
    assert.match(block, /version:/);
    assert.match(block, /downloading:/);
    assert.match(block, /downloaded:/);
});

test('_updState initial status is "idle"', () => {
    const block = fnBody('const _updState');
    assert.match(block, /status:\s*'idle'/);
});

test('_updState has prepareTimer and stallTimer fields', () => {
    const block = fnBody('const _updState');
    assert.match(block, /prepareTimer:/);
    assert.match(block, /stallTimer:/);
});

// ─── 2. Stall watchdog — 120-second timeout ───────────────────────────────────

test('stall watchdog fires after 120 seconds (120_000 ms)', () => {
    assert.match(MAIN_JS, /120_000/);
    const block = fnBody('function _resetStallTimer');
    assert.match(block, /120_000/);
});

test('stall watchdog only fires when status is "downloading"', () => {
    const block = fnBody('function _resetStallTimer');
    assert.match(block, /status.*downloading|downloading.*status/s);
});

test('stall watchdog transitions status to "error"', () => {
    const block = fnBody('function _resetStallTimer');
    assert.match(block, /status\s*=\s*'error'/);
});

test('stall watchdog sends "update-error" event to renderer', () => {
    const block = fnBody('function _resetStallTimer');
    assert.match(block, /update-error/);
});

test('stall watchdog sets downloading to false', () => {
    const block = fnBody('function _resetStallTimer');
    assert.match(block, /downloading\s*=\s*false/);
});

// ─── 3. Prepare timeout — 60-second timeout ───────────────────────────────────

test('prepare timeout is 60 seconds (60_000 ms)', () => {
    const block = fnBody("'start-update-download'");
    assert.match(block, /60_000/);
});

test('prepare timeout only fires when status is "preparing"', () => {
    const block = fnBody("'start-update-download'");
    assert.match(block, /status.*preparing|preparing.*status/s);
});

test('prepare timeout transitions status to "error"', () => {
    const block = fnBody("'start-update-download'");
    assert.match(block, /status\s*=\s*'error'/);
});

test('prepare timeout sends "update-error" with "did not start" message', () => {
    const block = fnBody("'start-update-download'");
    assert.match(block, /update-error/);
    assert.match(block, /did not start|not start/i);
});

// ─── 4. update-available event ────────────────────────────────────────────────

test('update-available sets status to "available"', () => {
    const block = fnBody("'update-available'");
    assert.match(block, /status\s*=\s*'available'/);
});

test('update-available stores info.version', () => {
    const block = fnBody("'update-available'");
    assert.match(block, /version\s*=\s*info\.version/);
});

test('update-available sends "update-found" to renderer', () => {
    const block = fnBody("'update-available'");
    assert.match(block, /update-found/);
});

// ─── 5. update-not-available event ───────────────────────────────────────────

test('update-not-available sets status to "idle"', () => {
    const block = fnBody("'update-not-available'");
    assert.match(block, /status\s*=\s*'idle'/);
});

test('update-not-available sends "update-not-found" to renderer', () => {
    const block = fnBody("'update-not-available'");
    assert.match(block, /update-not-found/);
});

// ─── 6. download-progress event ───────────────────────────────────────────────

test('download-progress sets status to "downloading"', () => {
    const block = fnBody("'download-progress'");
    assert.match(block, /status\s*=\s*'downloading'/);
});

test('download-progress sets downloading to true', () => {
    const block = fnBody("'download-progress'");
    assert.match(block, /downloading\s*=\s*true/);
});

test('download-progress sends progress percent to renderer', () => {
    const block = fnBody("'download-progress'");
    assert.match(block, /percent/);
    assert.match(block, /update-download-progress/);
});

// ─── 7. update-downloaded event ───────────────────────────────────────────────

test('update-downloaded sets status to "downloaded"', () => {
    const block = fnBody("'update-downloaded'");
    assert.match(block, /status\s*=\s*'downloaded'/);
});

test('update-downloaded sets downloaded to true', () => {
    const block = fnBody("'update-downloaded'");
    assert.match(block, /downloaded\s*=\s*true/);
});

test('update-downloaded sets downloading to false', () => {
    const block = fnBody("'update-downloaded'");
    assert.match(block, /downloading\s*=\s*false/);
});

test('update-downloaded calls markUpdateNotesPending', () => {
    const block = fnBody("'update-downloaded'");
    assert.match(block, /markUpdateNotesPending/);
});

test('update-downloaded sends "update-ready" to renderer', () => {
    const block = fnBody("'update-downloaded'");
    assert.match(block, /update-ready/);
});

// ─── 8. error event ───────────────────────────────────────────────────────────

test('autoUpdater error event sets status to "error"', () => {
    const idx = MAIN_JS.indexOf("autoUpdater.on('error'");
    assert.ok(idx !== -1, "autoUpdater.on('error') must be present");
    const block = fnBody("autoUpdater.on('error'");
    assert.match(block, /status\s*=\s*'error'/);
});

test('autoUpdater error event sets downloading to false', () => {
    const block = fnBody("autoUpdater.on('error'");
    assert.match(block, /downloading\s*=\s*false/);
});

// ─── 9. start-update-download IPC guard logic ────────────────────────────────

test('start-update-download: if already downloaded, re-sends update-ready without re-downloading', () => {
    const block = fnBody("'start-update-download'");
    assert.match(block, /_updState\.downloaded/);
    assert.match(block, /update-ready/);
});

test('start-update-download: if already downloading, returns current status immediately', () => {
    const block = fnBody("'start-update-download'");
    assert.match(block, /_updState\.downloading/);
});

test('start-update-download: sets status to "preparing" before calling downloadUpdate', () => {
    const block = fnBody("'start-update-download'");
    assert.match(block, /status\s*=\s*'preparing'/);
    assert.match(block, /downloadUpdate/);
});

// ─── 10. restart-and-update ───────────────────────────────────────────────────

test('restart-and-update: calls autoUpdater.quitAndInstall', () => {
    const block = fnBody("'restart-and-update'");
    assert.match(block, /quitAndInstall/);
});
