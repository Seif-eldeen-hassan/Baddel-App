'use strict';
const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const MAIN_JS    = fs.readFileSync(path.join(__dirname, '..', 'main.js'),             'utf8');
const PRELOAD_JS = fs.readFileSync(path.join(__dirname, '..', 'preload.js'),          'utf8');
const APP_JS     = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'app.js'), 'utf8');
const HTML       = fs.readFileSync(path.join(__dirname, '..', 'src', 'dashboard.html'), 'utf8');
const CSS        = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'dashboard.css'), 'utf8');

// ── main.js ──────────────────────────────────────────────────────────────────

test('main.js: UPDATE_NOTES_STATE_FILE is defined', () => {
    assert.ok(
        MAIN_JS.includes('UPDATE_NOTES_STATE_FILE'),
        'UPDATE_NOTES_STATE_FILE constant not found'
    );
});

test('main.js: UPDATE_NOTES_STATE_FILE uses update-notes-state.json', () => {
    assert.ok(
        MAIN_JS.includes("'update-notes-state.json'"),
        "update-notes-state.json filename not found"
    );
});

test('main.js: readUpdateNotesState function exists', () => {
    assert.ok(MAIN_JS.includes('function readUpdateNotesState()'));
});

test('main.js: writeUpdateNotesState function exists', () => {
    assert.ok(MAIN_JS.includes('function writeUpdateNotesState(state)'));
});

test('main.js: getUpdateNotesForVersion function exists', () => {
    assert.ok(MAIN_JS.includes('function getUpdateNotesForVersion(version)'));
});

test('main.js: getUpdateNotesForVersion has v1.1.2 entry', () => {
    assert.ok(MAIN_JS.includes("'1.1.2':"), "v1.1.2 key not found in notesByVersion");
});

test("main.js: v1.1.2 notes has 'Manual game launching' item", () => {
    assert.ok(
        MAIN_JS.includes('Manual game launching is now more reliable.'),
        "'Manual game launching' note text not found"
    );
});

test("main.js: v1.1.2 notes has 'Added Community & Socials' item", () => {
    assert.ok(
        MAIN_JS.includes('Added Community & Socials.'),
        "'Added Community & Socials' note text not found"
    );
});

test("main.js: v1.1.2 notes title is 'Baddel has been updated'", () => {
    const idx = MAIN_JS.indexOf("'1.1.2':");
    assert.ok(idx !== -1, 'v1.1.2 block not found');
    const block = MAIN_JS.slice(idx, idx + 600);
    assert.ok(block.includes('Baddel has been updated'), "title not found in v1.1.2 block");
});

test("main.js: v1.1.2 notes footer is 'Thanks for using Baddel.'", () => {
    const idx = MAIN_JS.indexOf("'1.1.2':");
    const block = MAIN_JS.slice(idx, idx + 900);
    assert.ok(block.includes('Thanks for using Baddel.'), "footer not found in v1.1.2 block");
});

test('main.js: markUpdateNotesPending function exists', () => {
    assert.ok(MAIN_JS.includes('function markUpdateNotesPending(version)'));
});

test('main.js: markUpdateNotesPending writes pendingVersion', () => {
    const idx = MAIN_JS.indexOf('function markUpdateNotesPending(version)');
    const block = MAIN_JS.slice(idx, idx + 400);
    assert.ok(block.includes('pendingVersion'), 'pendingVersion not written in markUpdateNotesPending');
});

test('main.js: getPendingUpdateNotesPayload function exists', () => {
    assert.ok(MAIN_JS.includes('function getPendingUpdateNotesPayload()'));
});

test('main.js: getPendingUpdateNotesPayload checks shownVersions', () => {
    const idx = MAIN_JS.indexOf('function getPendingUpdateNotesPayload()');
    const block = MAIN_JS.slice(idx, idx + 600);
    assert.ok(block.includes('shownVersions'), 'shownVersions guard missing');
});

test('main.js: markUpdateNotesShown function exists', () => {
    assert.ok(MAIN_JS.includes('function markUpdateNotesShown(version)'));
});

test('main.js: markUpdateNotesShown writes lastShownVersion', () => {
    const idx = MAIN_JS.indexOf('function markUpdateNotesShown(version)');
    const block = MAIN_JS.slice(idx, idx + 500);
    assert.ok(block.includes('lastShownVersion'), 'lastShownVersion not written in markUpdateNotesShown');
});

test('main.js: restart-and-update calls markUpdateNotesPending before quitAndInstall', () => {
    const idx = MAIN_JS.indexOf("'restart-and-update'");
    assert.ok(idx !== -1, "restart-and-update handler not found");
    const block = MAIN_JS.slice(idx, idx + 1800);
    const pendingIdx = block.indexOf('markUpdateNotesPending');
    const quitIdx    = block.indexOf('autoUpdater.quitAndInstall(');
    assert.ok(pendingIdx !== -1, 'markUpdateNotesPending not found in restart-and-update');
    assert.ok(quitIdx    !== -1, 'autoUpdater.quitAndInstall( not found in restart-and-update');
    assert.ok(pendingIdx < quitIdx, 'markUpdateNotesPending must come before autoUpdater.quitAndInstall');
});

test("main.js: get-pending-update-notes IPC handler exists", () => {
    assert.ok(
        MAIN_JS.includes("'get-pending-update-notes'"),
        "get-pending-update-notes handler not found"
    );
});

test("main.js: get-pending-update-notes calls getPendingUpdateNotesPayload", () => {
    const idx = MAIN_JS.indexOf("'get-pending-update-notes'");
    const block = MAIN_JS.slice(idx, idx + 300);
    assert.ok(block.includes('getPendingUpdateNotesPayload'), 'getPendingUpdateNotesPayload not called in handler');
});

test("main.js: mark-update-notes-shown IPC handler exists", () => {
    assert.ok(
        MAIN_JS.includes("'mark-update-notes-shown'"),
        "mark-update-notes-shown handler not found"
    );
});

test("main.js: mark-update-notes-shown calls markUpdateNotesShown", () => {
    const idx = MAIN_JS.indexOf("'mark-update-notes-shown'");
    const block = MAIN_JS.slice(idx, idx + 300);
    assert.ok(block.includes('markUpdateNotesShown'), 'markUpdateNotesShown not called in handler');
});

// ── preload.js ────────────────────────────────────────────────────────────────

test('preload.js: getPendingUpdateNotes exposed', () => {
    assert.ok(
        PRELOAD_JS.includes('getPendingUpdateNotes'),
        'getPendingUpdateNotes not exposed in preload'
    );
});

test('preload.js: getPendingUpdateNotes invokes get-pending-update-notes', () => {
    const idx = PRELOAD_JS.indexOf('getPendingUpdateNotes');
    const block = PRELOAD_JS.slice(idx, idx + 200);
    assert.ok(block.includes('get-pending-update-notes'), 'IPC channel name missing');
});

test('preload.js: markUpdateNotesShown exposed', () => {
    assert.ok(
        PRELOAD_JS.includes('markUpdateNotesShown'),
        'markUpdateNotesShown not exposed in preload'
    );
});

test('preload.js: markUpdateNotesShown invokes mark-update-notes-shown', () => {
    const idx = PRELOAD_JS.indexOf('markUpdateNotesShown');
    const block = PRELOAD_JS.slice(idx, idx + 200);
    assert.ok(block.includes('mark-update-notes-shown'), 'IPC channel name missing');
});

// ── dashboard.html ────────────────────────────────────────────────────────────

test('HTML: updateNotesModal element exists', () => {
    assert.ok(HTML.includes('id="updateNotesModal"'), 'updateNotesModal not found in HTML');
});

test('HTML: updateNotesModal has update-notes-modal class', () => {
    assert.ok(HTML.includes('class="modal-overlay update-notes-modal"'));
});

test('HTML: updateNotesTitle element exists', () => {
    assert.ok(HTML.includes('id="updateNotesTitle"'));
});

test('HTML: updateNotesSubtitle element exists', () => {
    assert.ok(HTML.includes('id="updateNotesSubtitle"'));
});

test('HTML: updateNotesList element exists', () => {
    assert.ok(HTML.includes('id="updateNotesList"'));
});

test('HTML: updateNotesFooter element exists', () => {
    assert.ok(HTML.includes('id="updateNotesFooter"'));
});

test('HTML: updateNotesModal close button calls closeUpdateNotesModal', () => {
    const idx = HTML.indexOf('id="updateNotesModal"');
    const block = HTML.slice(idx, idx + 600);
    assert.ok(block.includes('closeUpdateNotesModal()'), 'closeUpdateNotesModal() not wired in modal');
});

test('HTML: updateNotesModal Continue button calls closeUpdateNotesModal', () => {
    const idx = HTML.indexOf('id="updateNotesModal"');
    const block = HTML.slice(idx, idx + 1000);
    assert.ok(
        block.includes('update-notes-primary-btn'),
        'update-notes-primary-btn not found'
    );
    assert.ok(
        block.includes('closeUpdateNotesModal()'),
        'closeUpdateNotesModal not on primary button'
    );
});

// ── app.js ────────────────────────────────────────────────────────────────────

test('app.js: _pendingUpdateNotesVersion declared', () => {
    assert.ok(APP_JS.includes('_pendingUpdateNotesVersion'), '_pendingUpdateNotesVersion not found');
});

test('app.js: checkAndShowUpdateNotes function exists', () => {
    assert.ok(APP_JS.includes('async function checkAndShowUpdateNotes()'));
});

test('app.js: checkAndShowUpdateNotes calls getPendingUpdateNotes', () => {
    const idx = APP_JS.indexOf('async function checkAndShowUpdateNotes()');
    const block = APP_JS.slice(idx, idx + 400);
    assert.ok(block.includes('getPendingUpdateNotes'), 'getPendingUpdateNotes not called');
});

test('app.js: showUpdateNotesModal function exists', () => {
    assert.ok(APP_JS.includes('function showUpdateNotesModal(notes)'));
});

test('app.js: showUpdateNotesModal populates updateNotesList', () => {
    const idx = APP_JS.indexOf('function showUpdateNotesModal(notes)');
    const block = APP_JS.slice(idx, idx + 1200);
    assert.ok(block.includes('updateNotesList'), 'updateNotesList not referenced');
    assert.ok(block.includes('update-notes-item'), 'update-notes-item class not used');
});

test('app.js: showUpdateNotesModal adds active class to modal', () => {
    const idx = APP_JS.indexOf('function showUpdateNotesModal(notes)');
    const block = APP_JS.slice(idx, idx + 1600);
    assert.ok(block.includes("classList.add('active')"), "modal not shown with active class");
});

test('app.js: closeUpdateNotesModal function exists', () => {
    assert.ok(APP_JS.includes('async function closeUpdateNotesModal()'));
});

test('app.js: closeUpdateNotesModal removes active class', () => {
    const idx = APP_JS.indexOf('async function closeUpdateNotesModal()');
    const block = APP_JS.slice(idx, idx + 500);
    assert.ok(block.includes("classList.remove('active')"), "active class not removed on close");
});

test('app.js: closeUpdateNotesModal calls markUpdateNotesShown', () => {
    const idx = APP_JS.indexOf('async function closeUpdateNotesModal()');
    const block = APP_JS.slice(idx, idx + 500);
    assert.ok(block.includes('markUpdateNotesShown'), 'markUpdateNotesShown not called on close');
});

test('app.js: window.closeUpdateNotesModal assigned', () => {
    assert.ok(
        APP_JS.includes('window.closeUpdateNotesModal = closeUpdateNotesModal'),
        'window.closeUpdateNotesModal not assigned'
    );
});

test('app.js: checkAndShowUpdateNotes called 900ms after DOMContentLoaded', () => {
    assert.ok(
        APP_JS.includes('setTimeout(checkAndShowUpdateNotes, 900)'),
        'checkAndShowUpdateNotes not scheduled at 900ms'
    );
});

// ── CSS ───────────────────────────────────────────────────────────────────────

test('CSS: .update-notes-modal defined', () => {
    assert.ok(CSS.includes('.update-notes-modal'), '.update-notes-modal not found in CSS');
});

test('CSS: .update-notes-modal has position fixed', () => {
    const idx = CSS.indexOf('.update-notes-modal');
    const block = CSS.slice(idx, idx + 400);
    assert.ok(block.includes('position: fixed'), 'position: fixed missing');
});

test('CSS: .update-notes-modal.active has display flex', () => {
    assert.ok(CSS.includes('.update-notes-modal.active'), '.update-notes-modal.active not found');
    const idx = CSS.indexOf('.update-notes-modal.active');
    const block = CSS.slice(idx, idx + 80);
    assert.ok(block.includes('display: flex'), 'display: flex not in .active rule');
});

test('CSS: .update-notes-dialog defined', () => {
    assert.ok(CSS.includes('.update-notes-dialog'), '.update-notes-dialog not found');
});

test('CSS: .update-notes-dialog has border-radius', () => {
    const idx = CSS.indexOf('.update-notes-dialog {');
    const block = CSS.slice(idx, idx + 400);
    assert.ok(block.includes('border-radius'), 'border-radius missing from .update-notes-dialog');
});

test('CSS: .update-notes-icon defined', () => {
    assert.ok(CSS.includes('.update-notes-icon'), '.update-notes-icon not found');
});

test('CSS: .update-notes-list defined', () => {
    assert.ok(CSS.includes('.update-notes-list'), '.update-notes-list not found');
});

test('CSS: .update-notes-item defined', () => {
    assert.ok(CSS.includes('.update-notes-item {'), '.update-notes-item not found');
});

test('CSS: .update-notes-item-title defined', () => {
    assert.ok(CSS.includes('.update-notes-item-title'), '.update-notes-item-title not found');
});

test('CSS: .update-notes-item-desc defined', () => {
    assert.ok(CSS.includes('.update-notes-item-desc'), '.update-notes-item-desc not found');
});

test('CSS: .update-notes-footer defined', () => {
    assert.ok(CSS.includes('.update-notes-footer'), '.update-notes-footer not found');
});

test('CSS: .update-notes-primary-btn defined', () => {
    assert.ok(CSS.includes('.update-notes-primary-btn'), '.update-notes-primary-btn not found');
});

test('CSS: .update-notes-primary-btn has cursor pointer', () => {
    const idx = CSS.indexOf('.update-notes-primary-btn {');
    const block = CSS.slice(idx, idx + 300);
    assert.ok(block.includes('cursor: pointer'), 'cursor: pointer missing from primary btn');
});

test('CSS: update-notes-modal z-index is >= 200000', () => {
    const idx = CSS.indexOf('.update-notes-modal');
    const block = CSS.slice(idx, idx + 300);
    const match = block.match(/z-index:\s*(\d+)/);
    assert.ok(match, 'z-index not set on .update-notes-modal');
    assert.ok(parseInt(match[1], 10) >= 200000, `z-index ${match[1]} is less than 200000`);
});
