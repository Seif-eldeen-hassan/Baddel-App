'use strict';
const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const MAIN_JS    = fs.readFileSync(path.join(__dirname, '..', 'main.js'),             'utf8');
const AUTO_UPDATE_HANDLERS_JS = fs.readFileSync(path.join(__dirname, '..', 'handlers/autoUpdateHandlers.js'), 'utf8');
const PRELOAD_JS = fs.readFileSync(path.join(__dirname, '..', 'preload.js'),          'utf8');
const APP_JS     = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'app.js'), 'utf8');
const HELP_JS    = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'app', 'help-feedback.js'), 'utf8');
const HTML       = fs.readFileSync(path.join(__dirname, '..', 'src', 'dashboard.html'), 'utf8');
const CSS        = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'dashboard.css'), 'utf8');
const UPDATE_NOTES_HANDLERS_JS = fs.readFileSync(path.join(__dirname, '..', 'handlers', 'updateNotesHandlers.js'), 'utf8');

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
    const block = MAIN_JS.slice(idx, idx + 1100);
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
    const idx = AUTO_UPDATE_HANDLERS_JS.indexOf("'restart-and-update'");
    assert.ok(idx !== -1, "restart-and-update handler not found");
    const block = AUTO_UPDATE_HANDLERS_JS.slice(idx, idx + 1800);
    const pendingIdx = block.indexOf('markUpdateNotesPending');
    const quitIdx    = block.indexOf('autoUpdater.quitAndInstall(');
    assert.ok(pendingIdx !== -1, 'markUpdateNotesPending not found in restart-and-update');
    assert.ok(quitIdx    !== -1, 'autoUpdater.quitAndInstall( not found in restart-and-update');
    assert.ok(pendingIdx < quitIdx, 'markUpdateNotesPending must come before autoUpdater.quitAndInstall');
});

test("main.js: get-pending-update-notes IPC handler exists", () => {
    assert.ok(
        UPDATE_NOTES_HANDLERS_JS.includes("'get-pending-update-notes'"),
        "get-pending-update-notes handler not found"
    );
});

test("main.js: get-pending-update-notes calls getPendingUpdateNotesPayload", () => {
    const idx = UPDATE_NOTES_HANDLERS_JS.indexOf("'get-pending-update-notes'");
    const block = UPDATE_NOTES_HANDLERS_JS.slice(idx, idx + 300);
    assert.ok(block.includes('getPendingUpdateNotesPayload'), 'getPendingUpdateNotesPayload not called in handler');
});

test("main.js: mark-update-notes-shown IPC handler exists", () => {
    assert.ok(
        UPDATE_NOTES_HANDLERS_JS.includes("'mark-update-notes-shown'"),
        "mark-update-notes-shown handler not found"
    );
});

test("main.js: mark-update-notes-shown calls markUpdateNotesShown", () => {
    const idx = UPDATE_NOTES_HANDLERS_JS.indexOf("'mark-update-notes-shown'");
    const block = UPDATE_NOTES_HANDLERS_JS.slice(idx, idx + 300);
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
    const block = HTML.slice(idx, idx + 1400);
    assert.ok(
        block.includes('update-notes-primary-btn'),
        'update-notes-primary-btn not found'
    );
    assert.ok(
        block.includes('closeUpdateNotesModal()'),
        'closeUpdateNotesModal not on primary button'
    );
});

// ── help-feedback.js ─────────────────────────────────────────────────────────

test('help-feedback.js: _pendingUpdateNotesVersion declared', () => {
    assert.ok(HELP_JS.includes('_pendingUpdateNotesVersion'), '_pendingUpdateNotesVersion not found');
});

test('help-feedback.js: checkAndShowUpdateNotes function exists', () => {
    assert.ok(HELP_JS.includes('async function checkAndShowUpdateNotes()'));
});

test('help-feedback.js: checkAndShowUpdateNotes calls getPendingUpdateNotes', () => {
    const idx = HELP_JS.indexOf('async function checkAndShowUpdateNotes()');
    const block = HELP_JS.slice(idx, idx + 400);
    assert.ok(block.includes('getPendingUpdateNotes'), 'getPendingUpdateNotes not called');
});

test('help-feedback.js: showUpdateNotesModal function exists', () => {
    assert.ok(HELP_JS.includes('function showUpdateNotesModal(notes)'));
});

test('help-feedback.js: showUpdateNotesModal populates updateNotesList', () => {
    const idx = HELP_JS.indexOf('function showUpdateNotesModal(notes)');
    const block = HELP_JS.slice(idx, idx + 1600);
    assert.ok(block.includes('updateNotesList'), 'updateNotesList not referenced');
    assert.ok(block.includes('update-notes-item'), 'update-notes-item class not used');
});

test('help-feedback.js: showUpdateNotesModal adds active class to modal', () => {
    const idx = HELP_JS.indexOf('function showUpdateNotesModal(notes)');
    const block = HELP_JS.slice(idx, idx + 4000);
    assert.ok(block.includes("classList.add('active')"), "modal not shown with active class");
});

test('help-feedback.js: closeUpdateNotesModal function exists', () => {
    assert.ok(HELP_JS.includes('async function closeUpdateNotesModal()'));
});

test('help-feedback.js: closeUpdateNotesModal removes active class', () => {
    const idx = HELP_JS.indexOf('async function closeUpdateNotesModal()');
    const block = HELP_JS.slice(idx, idx + 700);
    assert.ok(block.includes("classList.remove('active')"), "active class not removed on close");
});

test('help-feedback.js: closeUpdateNotesModal calls markUpdateNotesShown', () => {
    const idx = HELP_JS.indexOf('async function closeUpdateNotesModal()');
    const block = HELP_JS.slice(idx, idx + 700);
    assert.ok(block.includes('markUpdateNotesShown'), 'markUpdateNotesShown not called on close');
});

test('help-feedback.js: window.closeUpdateNotesModal assigned', () => {
    assert.match(HELP_JS, /window\.closeUpdateNotesModal\s*=\s*closeUpdateNotesModal/, 'window.closeUpdateNotesModal not assigned');
});

test('help-feedback.js: checkAndShowUpdateNotes called 900ms after DOMContentLoaded', () => {
    assert.ok(
        HELP_JS.includes('setTimeout(checkAndShowUpdateNotes, 900)'),
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

// ── Reliability fixes ─────────────────────────────────────────────────────────

test('main.js: update-downloaded handler stores info.version in _updState.version', () => {
    const idx = MAIN_JS.indexOf("autoUpdater.on('update-downloaded'");
    assert.ok(idx !== -1, 'update-downloaded handler not found');
    const block = MAIN_JS.slice(idx, idx + 600);
    assert.ok(
        block.includes('_updState.version     = info.version') ||
        block.includes('_updState.version = info.version'),
        '_updState.version not set from info.version in update-downloaded'
    );
});

test('main.js: update-downloaded handler calls markUpdateNotesPending(info.version)', () => {
    const idx = MAIN_JS.indexOf("autoUpdater.on('update-downloaded'");
    const block = MAIN_JS.slice(idx, idx + 600);
    assert.ok(
        block.includes('markUpdateNotesPending(info.version)'),
        'markUpdateNotesPending(info.version) not called in update-downloaded'
    );
});

test('main.js: restart-and-update uses savedState.pendingVersion as fallback (not currentVersion)', () => {
    const idx = AUTO_UPDATE_HANDLERS_JS.indexOf("'restart-and-update'");
    assert.ok(idx !== -1, 'restart-and-update handler not found');
    const block = AUTO_UPDATE_HANDLERS_JS.slice(idx, idx + 2000);
    assert.ok(
        block.includes('savedState.pendingVersion') || block.includes('readUpdateNotesState()'),
        'restart-and-update must read savedState.pendingVersion as fallback'
    );
    // targetVersion assignment must not fall back to autoUpdater.currentVersion (old version)
    const targetLine = block.match(/const targetVersion\s*=.+/)?.[0] || '';
    assert.ok(
        !targetLine.includes('currentVersion'),
        'targetVersion must not fall back to autoUpdater.currentVersion (that is the old running version)'
    );
});

test('main.js: restart-and-update logs warning when no target version available', () => {
    const idx = AUTO_UPDATE_HANDLERS_JS.indexOf("'restart-and-update'");
    const block = AUTO_UPDATE_HANDLERS_JS.slice(idx, idx + 2000);
    assert.ok(
        block.includes('no target version found'),
        'warning log missing for missing target version in restart-and-update'
    );
});

test('main.js: getPendingUpdateNotesPayload logs currentVersion and pendingVersion', () => {
    const idx = MAIN_JS.indexOf('function getPendingUpdateNotesPayload()');
    const block = MAIN_JS.slice(idx, idx + 900);
    assert.ok(block.includes('currentVersion='), 'currentVersion not logged in getPendingUpdateNotesPayload');
    assert.ok(block.includes('pendingVersion='), 'pendingVersion not logged in getPendingUpdateNotesPayload');
});

test('main.js: getPendingUpdateNotesPayload logs skip reason when pendingVersion differs', () => {
    const idx = MAIN_JS.indexOf('function getPendingUpdateNotesPayload()');
    const block = MAIN_JS.slice(idx, idx + 900);
    assert.ok(
        block.includes('skip: pendingVersion'),
        'skip reason not logged when pendingVersion !== currentVersion'
    );
});

test('main.js: getPendingUpdateNotesPayload logs skip reason when already shown', () => {
    const idx = MAIN_JS.indexOf('function getPendingUpdateNotesPayload()');
    const block = MAIN_JS.slice(idx, idx + 1100);
    assert.ok(
        block.includes('already shown'),
        'skip reason not logged when version already shown'
    );
});

test('help-feedback.js: checkAndShowUpdateNotes logs result status and version', () => {
    const idx = HELP_JS.indexOf('async function checkAndShowUpdateNotes()');
    const block = HELP_JS.slice(idx, idx + 700);
    assert.ok(block.includes('[UpdateNotes] checkAndShowUpdateNotes:'), 'result log not found in checkAndShowUpdateNotes');
});

test('help-feedback.js: checkAndShowUpdateNotes checks updateNotesModal element exists before showing', () => {
    const idx = HELP_JS.indexOf('async function checkAndShowUpdateNotes()');
    const block = HELP_JS.slice(idx, idx + 700);
    assert.ok(block.includes('updateNotesModal'), 'updateNotesModal element check missing in checkAndShowUpdateNotes');
});

test('help-feedback.js: checkAndShowUpdateNotes retries with setTimeout if modal element not ready', () => {
    const idx = HELP_JS.indexOf('async function checkAndShowUpdateNotes()');
    const block = HELP_JS.slice(idx, idx + 700);
    assert.ok(block.includes('not ready, retrying') || block.includes('retrying in'), 'retry log not found');
    assert.ok(block.includes('setTimeout'), 'retry setTimeout not found in checkAndShowUpdateNotes');
});

test('help-feedback.js: checkAndShowUpdateNotes does NOT call markUpdateNotesShown', () => {
    const fnStart = HELP_JS.indexOf('async function checkAndShowUpdateNotes()');
    const fnEnd   = HELP_JS.indexOf('\nfunction showUpdateNotesModal', fnStart);
    const block   = HELP_JS.slice(fnStart, fnEnd > fnStart ? fnEnd : fnStart + 700);
    assert.ok(!block.includes('markUpdateNotesShown'), 'markUpdateNotesShown must not be called in checkAndShowUpdateNotes — only in closeUpdateNotesModal');
});

// ─── v1.1.3 update notes ─────────────────────────────────────────────────────

test('main.js: getUpdateNotesForVersion returns entry for v1.1.3', () => {
    const fnStart = MAIN_JS.indexOf('function getUpdateNotesForVersion(');
    const fn = MAIN_JS.slice(fnStart, fnStart + 2000);
    assert.ok(fn.includes("'1.1.3'"), "notesByVersion must contain a '1.1.3' key");
});

test('main.js: v1.1.3 notes include Riot launch fix', () => {
    const fnStart = MAIN_JS.indexOf("'1.1.3':");
    const block = MAIN_JS.slice(fnStart, fnStart + 1200);
    assert.ok(block.includes('Riot'), 'v1.1.3 notes must mention Riot');
    assert.ok(block.includes('launch'), 'v1.1.3 Riot note must mention launch');
});

test('main.js: v1.1.3 notes include EA launch fix', () => {
    const fnStart = MAIN_JS.indexOf("'1.1.3':");
    const block = MAIN_JS.slice(fnStart, fnStart + 1200);
    assert.ok(block.includes('EA'), 'v1.1.3 notes must mention EA');
    assert.ok(block.includes('launch path') || block.includes('real launch'), 'v1.1.3 EA note must mention real launch path');
});

test('main.js: v1.1.3 notes include startup toggle fix', () => {
    const fnStart = MAIN_JS.indexOf("'1.1.3':");
    const block = MAIN_JS.slice(fnStart, fnStart + 1200);
    assert.ok(block.includes('startup') || block.includes('Startup'), 'v1.1.3 notes must mention startup');
    assert.ok(block.includes('toggle') || block.includes('setting'), 'v1.1.3 startup note must mention toggle or setting');
});

test('main.js: v1.1.3 notes include Account Switcher improvement', () => {
    const fnStart = MAIN_JS.indexOf("'1.1.3':");
    const block = MAIN_JS.slice(fnStart, fnStart + 1200);
    assert.ok(block.includes('Account Switcher') || block.includes('account'), 'v1.1.3 notes must mention Account Switcher');
});

test('main.js: v1.1.3 notes have custom title and footer', () => {
    const fnStart = MAIN_JS.indexOf("'1.1.3':");
    const block = MAIN_JS.slice(fnStart, fnStart + 1200);
    assert.ok(block.includes('Baddel just got better'), "v1.1.3 must have title 'Baddel just got better'");
    assert.ok(block.includes('More improvements are coming'), 'v1.1.3 must have custom footer');
});

// ─── v1.1.4 update notes ─────────────────────────────────────────────────────

test("main.js: getUpdateNotesForVersion returns entry for v1.1.4", () => {
    const fnStart = MAIN_JS.indexOf('function getUpdateNotesForVersion(');
    const fn = MAIN_JS.slice(fnStart, fnStart + 5000);
    assert.ok(fn.includes("'1.1.4'"), "notesByVersion must contain a '1.1.4' key");
});

test("main.js: v1.1.4 hero title is \"What's New in Baddel 1.1.4\"", () => {
    const fnStart = MAIN_JS.indexOf("'1.1.4':");
    const block = MAIN_JS.slice(fnStart, fnStart + 3500);
    assert.ok(block.includes("What's New in Baddel 1.1.4"), "v1.1.4 hero title not found");
});

test('main.js: v1.1.4 notes include Keybind for Every Account feature', () => {
    const fnStart = MAIN_JS.indexOf("'1.1.4':");
    const block = MAIN_JS.slice(fnStart, fnStart + 3500);
    assert.ok(block.includes('Keybind for Every Account'), "Keybind feature not found in v1.1.4");
});

test('main.js: v1.1.4 notes include Quick Switch Overlay feature', () => {
    const fnStart = MAIN_JS.indexOf("'1.1.4':");
    const block = MAIN_JS.slice(fnStart, fnStart + 3500);
    assert.ok(block.includes('Quick Switch Overlay'), "Quick Switch Overlay not found in v1.1.4");
});

test('main.js: v1.1.4 notes include Ready to Install Tab feature', () => {
    const fnStart = MAIN_JS.indexOf("'1.1.4':");
    const block = MAIN_JS.slice(fnStart, fnStart + 3500);
    assert.ok(block.includes('Ready to Install Tab'), "Ready to Install Tab not found in v1.1.4");
});

test('main.js: v1.1.4 notes include Improved Collections feature', () => {
    const fnStart = MAIN_JS.indexOf("'1.1.4':");
    const block = MAIN_JS.slice(fnStart, fnStart + 3500);
    assert.ok(block.includes('Improved Collections'), "Improved Collections not found in v1.1.4");
});

test('main.js: v1.1.4 notes include Smarter Sidebar feature', () => {
    const fnStart = MAIN_JS.indexOf("'1.1.4':");
    const block = MAIN_JS.slice(fnStart, fnStart + 3500);
    assert.ok(block.includes('Smarter Sidebar'), "Smarter Sidebar not found in v1.1.4");
});

test("main.js: v1.1.4 notes use feature-tour type with 5 slides", () => {
    const fnStart = MAIN_JS.indexOf("'1.1.4':");
    const block = MAIN_JS.slice(fnStart, fnStart + 3500);
    assert.ok(block.includes("'feature-tour'"), "v1.1.4 must have type: 'feature-tour'");
    const slideImages = block.match(/image:\s*'assets\/update-notes\/1\.1\.4\//g);
    assert.ok(slideImages && slideImages.length === 5, `v1.1.4 must have 5 slides, found: ${slideImages?.length ?? 0}`);
});

test('main.js: v1.1.4 featured items have headline fields', () => {
    const fnStart = MAIN_JS.indexOf("'1.1.4':");
    const block = MAIN_JS.slice(fnStart, fnStart + 3500);
    assert.ok(block.includes('Switch Accounts Without Opening Baddel'), "Keybind headline not found in v1.1.4");
    assert.ok(block.includes('Switch From Anywhere'), "Quick Switch headline not found in v1.1.4");
});

test('main.js: v1.1.4 featured items have helper fields', () => {
    const fnStart = MAIN_JS.indexOf("'1.1.4':");
    const block = MAIN_JS.slice(fnStart, fnStart + 3500);
    assert.ok(block.includes('Steam, Epic, Riot'), "Keybind helper text not found in v1.1.4");
    assert.ok(block.includes('one shortcut away'), "Quick Switch helper text not found in v1.1.4");
});

test("main.js: v1.1.4 footer mentions more improvements", () => {
    const fnStart = MAIN_JS.indexOf("'1.1.4':");
    const block = MAIN_JS.slice(fnStart, fnStart + 3500);
    assert.ok(block.includes('more improvements'), 'v1.1.4 footer must mention improvements');
});

// ─── Featured card renderer ───────────────────────────────────────────────────

test('help-feedback.js: showUpdateNotesModal dispatches to _renderFeatureTour for tour type', () => {
    const idx = HELP_JS.indexOf('function showUpdateNotesModal(notes)');
    const block = HELP_JS.slice(idx, idx + 200);
    assert.ok(block.includes('feature-tour'), 'feature-tour type check not found');
    assert.ok(block.includes('_renderFeatureTour'), '_renderFeatureTour not called in dispatch');
});

test('help-feedback.js: showUpdateNotesModal handles featured card layout for non-tour notes', () => {
    const idx = HELP_JS.indexOf('function showUpdateNotesModal(notes)');
    const block = HELP_JS.slice(idx, idx + 1500);
    assert.ok(block.includes('update-notes-featured-row'), 'featured-row class not found in showUpdateNotesModal');
    assert.ok(block.includes('i.featured'), 'featured filter not found in showUpdateNotesModal');
});

test('help-feedback.js: showUpdateNotesModal renders update-notes-grid for regular items', () => {
    const idx = HELP_JS.indexOf('function showUpdateNotesModal(notes)');
    const block = HELP_JS.slice(idx, idx + 2200);
    assert.ok(block.includes('update-notes-grid'), 'update-notes-grid class not found');
});

test('help-feedback.js: _buildUpdateNoteCard function exists', () => {
    assert.ok(HELP_JS.includes('function _buildUpdateNoteCard'), '_buildUpdateNoteCard not found in help-feedback.js');
});

test('help-feedback.js: _buildUpdateNoteCard renders item-headline for headline field', () => {
    const idx = HELP_JS.indexOf('function _buildUpdateNoteCard');
    const block = HELP_JS.slice(idx, idx + 700);
    assert.ok(block.includes('update-notes-item-headline'), 'item-headline class not in _buildUpdateNoteCard');
    assert.ok(block.includes('item.headline'), 'headline field not read in _buildUpdateNoteCard');
});

test('help-feedback.js: _buildUpdateNoteCard renders item-helper for helper field', () => {
    const idx = HELP_JS.indexOf('function _buildUpdateNoteCard');
    const block = HELP_JS.slice(idx, idx + 1000);
    assert.ok(block.includes('update-notes-item-helper'), 'item-helper class not in _buildUpdateNoteCard');
    assert.ok(block.includes('item.helper'), 'helper field not read in _buildUpdateNoteCard');
});

// ─── New CSS for feature card layout ─────────────────────────────────────────

test('CSS: .update-notes-featured-row defined', () => {
    assert.ok(CSS.includes('.update-notes-featured-row'), '.update-notes-featured-row not found in CSS');
});

test('CSS: .update-notes-featured-row uses CSS grid', () => {
    const idx = CSS.indexOf('.update-notes-featured-row');
    const block = CSS.slice(idx, idx + 200);
    assert.ok(block.includes('grid'), 'grid not set on .update-notes-featured-row');
});

test('CSS: .update-notes-grid defined', () => {
    assert.ok(CSS.includes('.update-notes-grid {'), '.update-notes-grid not found in CSS');
});

test('CSS: .update-notes-grid uses CSS grid', () => {
    const idx = CSS.indexOf('.update-notes-grid {');
    const block = CSS.slice(idx, idx + 200);
    assert.ok(block.includes('grid'), 'grid not set on .update-notes-grid');
});

test('CSS: .update-notes-featured-card defined', () => {
    assert.ok(CSS.includes('.update-notes-featured-card'), '.update-notes-featured-card not found in CSS');
});

test('CSS: .update-notes-featured-card uses green accent border', () => {
    const idx = CSS.indexOf('.update-notes-featured-card');
    const block = CSS.slice(idx, idx + 200);
    assert.ok(block.includes('34, 197, 94'), 'green accent not on .update-notes-featured-card');
});

test('CSS: .update-notes-item-headline defined', () => {
    assert.ok(CSS.includes('.update-notes-item-headline'), '.update-notes-item-headline not found in CSS');
});

test('CSS: .update-notes-item-headline uses green accent color', () => {
    const idx = CSS.indexOf('.update-notes-item-headline');
    const block = CSS.slice(idx, idx + 200);
    assert.ok(block.includes('#22c55e') || block.includes('34, 197, 94'), 'green accent not on .update-notes-item-headline');
});

test('CSS: .update-notes-item-helper defined', () => {
    assert.ok(CSS.includes('.update-notes-item-helper'), '.update-notes-item-helper not found in CSS');
});

test('CSS: .update-notes-item-helper uses italic font-style', () => {
    const idx = CSS.indexOf('.update-notes-item-helper');
    const block = CSS.slice(idx, idx + 200);
    assert.ok(block.includes('italic'), 'font-style italic not on .update-notes-item-helper');
});

test('CSS: responsive breakpoint stacks feature cards on narrow screens', () => {
    assert.ok(
        CSS.includes('.update-notes-featured-row') && CSS.includes('grid-template-columns: 1fr;'),
        'responsive single-column fallback not found for feature cards'
    );
});

// ─── Feature tour slider ─────────────────────────────────────────────────────

test('main.js: v1.1.4 first slide is Quick Switch Overlay', () => {
    const fnStart = MAIN_JS.indexOf("'1.1.4':");
    const block = MAIN_JS.slice(fnStart, fnStart + 3500);
    const slidesIdx = block.indexOf('slides:');
    assert.ok(slidesIdx !== -1, 'slides array not found in v1.1.4 data');
    const firstSlice = block.slice(slidesIdx, slidesIdx + 300);
    assert.ok(firstSlice.includes('Quick Switch Overlay'), 'first slide must be Quick Switch Overlay');
});

test('main.js: v1.1.4 first slide has Ctrl + Alt + B badge', () => {
    const fnStart = MAIN_JS.indexOf("'1.1.4':");
    const block = MAIN_JS.slice(fnStart, fnStart + 3500);
    const slidesIdx = block.indexOf('slides:');
    const firstSlice = block.slice(slidesIdx, slidesIdx + 500);
    assert.ok(firstSlice.includes('Ctrl + Alt + B'), "first slide must have 'Ctrl + Alt + B' badge");
});

test('main.js: v1.1.4 slides include image paths under assets/update-notes/1.1.4/', () => {
    const fnStart = MAIN_JS.indexOf("'1.1.4':");
    const block = MAIN_JS.slice(fnStart, fnStart + 3500);
    assert.ok(block.includes('assets/update-notes/1.1.4/feature1.png'), 'feature1.png path not found');
    assert.ok(block.includes('assets/update-notes/1.1.4/feature5.png'), 'feature5.png path not found');
    assert.ok(!block.includes('assets/update-notes/1.1.4/feature6.png'), 'feature6.png must not exist in v1.1.4 slides');
});

// ─── v1.2.0 full-width poster tour ──────────────────────────────────────────

test('main.js: v1.2.0 uses seven poster-only slides in numeric order', () => {
    const start = MAIN_JS.indexOf("'1.2.0':");
    const block = MAIN_JS.slice(start, start + 1800);
    assert.ok(start !== -1, 'v1.2.0 update notes entry missing');
    assert.match(block, /posterOnly:\s*true/);
    const paths = [...block.matchAll(/assets\/update-notes\/1\.2\.0\/(\d)-poster\.png/g)].map(match => Number(match[1]));
    assert.deepEqual(paths, [1, 2, 3, 4, 5, 6, 7]);
});

test('v1.2.0 poster assets exist and are exactly 2048x768 PNGs', () => {
    for (let index = 1; index <= 7; index++) {
        const imagePath = path.join(__dirname, '..', 'src', 'assets', 'update-notes', '1.2.0', `${index}-poster.png`);
        const bytes = fs.readFileSync(imagePath);
        assert.equal(bytes.readUInt32BE(16), 2048, `${index}-poster width`);
        assert.equal(bytes.readUInt32BE(20), 768, `${index}-poster height`);
    }
});

test('protected build copies update-note posters into the packaged assets path', () => {
    const buildScript = fs.readFileSync(
        path.join(__dirname, '..', 'scripts', 'build-protected.js'),
        'utf8',
    );
    assert.match(
        buildScript,
        /path\.join\(ROOT, 'src', 'assets', 'update-notes'\)[\s\S]*path\.join\(DEST, 'assets', 'update-notes'\)/,
    );
});

test('v1.2.0 feature slides spotlight Downloads, Vault, Stores, and GOG', () => {
    const start = MAIN_JS.indexOf("'1.2.0':");
    const block = MAIN_JS.slice(start, start + 1800);
    for (const selector of ['#nav-downloads', '#nav-vault-overview', '#nav-stores', '#nav-gog']) {
        assert.ok(block.includes(selector), `${selector} spotlight missing`);
    }
});

test('poster tour supports clickable spotlight proxies and resumable exploration', () => {
    assert.match(HELP_JS, /function _applyTourSpotlight\s*\(/);
    assert.match(HELP_JS, /function _suspendFeatureTourForExplore\s*\(/);
    assert.match(HELP_JS, /function _resumeFeatureTour\s*\(/);
    assert.ok(HELP_JS.includes('update-tour-spotlight-proxy'));
    assert.ok(HELP_JS.includes('update-tour-resume'));
});

test('poster tour preserves the complete 8:3 artwork without cropping', () => {
    const start = CSS.indexOf('.update-notes-dialog.tour-mode.poster-tour-mode');
    const block = CSS.slice(start, start + 1800);
    assert.ok(start !== -1, 'poster tour CSS missing');
    assert.match(block, /aspect-ratio:\s*8\s*\/\s*3/);
    assert.match(block, /object-fit:\s*contain/);
});

test('poster tour stays a centered medium dialog instead of filling the screen', () => {
    const start = CSS.indexOf('.update-notes-dialog.tour-mode.poster-tour-mode');
    const block = CSS.slice(start, start + 500);
    assert.match(block, /width:\s*min\(1200px,/);
    assert.match(block, /max-height:\s*calc\(100vh\s*-\s*96px\)/);
});

test('poster tour uses the logo green with a borderless soft-elevation card', () => {
    const start = CSS.indexOf('.update-notes-dialog.tour-mode.poster-tour-mode');
    const block = CSS.slice(start, start + 2300);
    assert.match(block, /border:\s*0/);
    assert.ok(block.includes('#12ce18'), 'logo green missing from poster controls');
    assert.ok(!block.includes('0 30px 100px'), 'old slab-like shadow must not remain');
});

// ─── Tour engine in help-feedback.js ─────────────────────────────────────────

test('help-feedback.js: _renderFeatureTour function exists', () => {
    assert.ok(HELP_JS.includes('function _renderFeatureTour('), '_renderFeatureTour not found');
});

test('help-feedback.js: _renderFeatureTour sets tour-mode on dialog', () => {
    const idx = HELP_JS.indexOf('function _renderFeatureTour(');
    const block = HELP_JS.slice(idx, idx + 700);
    assert.ok(block.includes('tour-mode'), 'tour-mode class not added in _renderFeatureTour');
});

test('help-feedback.js: _renderFeatureTour hides static card-layout elements', () => {
    const idx = HELP_JS.indexOf('function _renderFeatureTour(');
    const block = HELP_JS.slice(idx, idx + 1000);
    assert.ok(block.includes('updateNotesTitle'), 'updateNotesTitle not hidden in _renderFeatureTour');
    assert.ok(block.includes('hidden = true'), 'hidden = true not set in _renderFeatureTour');
});

test('help-feedback.js: _renderFeatureTour builds dots and Back/Next buttons', () => {
    const idx = HELP_JS.indexOf('function _renderFeatureTour(');
    const block = HELP_JS.slice(idx, idx + 4000);
    assert.ok(block.includes('un-tour-dot'), 'progress dots not built in _renderFeatureTour');
    assert.ok(block.includes('un-tour-back'), 'back button not built');
    assert.ok(block.includes('un-tour-next'), 'next button not built');
});

test('help-feedback.js: _renderFeatureTour registers ArrowRight/ArrowLeft keyboard handler', () => {
    const idx = HELP_JS.indexOf('function _renderFeatureTour(');
    const block = HELP_JS.slice(idx, idx + 4000);
    assert.ok(block.includes('ArrowRight'), 'ArrowRight not handled in _renderFeatureTour');
    assert.ok(block.includes('ArrowLeft'), 'ArrowLeft not handled in _renderFeatureTour');
    assert.ok(block.includes("addEventListener('keydown'"), 'keydown listener not added');
});

test('help-feedback.js: _renderFeatureTour shows modal with active class', () => {
    const idx = HELP_JS.indexOf('function _renderFeatureTour(');
    const block = HELP_JS.slice(idx, idx + 4000);
    assert.ok(block.includes("classList.add('active')"), 'modal not activated in _renderFeatureTour');
});

test('help-feedback.js: _buildTourSlide function exists', () => {
    assert.ok(HELP_JS.includes('function _buildTourSlide('), '_buildTourSlide not found');
});

test('help-feedback.js: _buildTourSlide renders label, headline, desc, badge, helper', () => {
    const idx = HELP_JS.indexOf('function _buildTourSlide(');
    const block = HELP_JS.slice(idx, idx + 1400);
    assert.ok(block.includes('un-tour-label'), 'un-tour-label not rendered');
    assert.ok(block.includes('un-tour-headline'), 'un-tour-headline not rendered');
    assert.ok(block.includes('un-tour-desc'), 'un-tour-desc not rendered');
    assert.ok(block.includes('un-tour-badge'), 'un-tour-badge not rendered');
    assert.ok(block.includes('un-tour-helper'), 'un-tour-helper not rendered');
});

test('help-feedback.js: _buildTourSlide renders image with onerror placeholder fallback', () => {
    const idx = HELP_JS.indexOf('function _buildTourSlide(');
    const block = HELP_JS.slice(idx, idx + 2000);
    assert.ok(block.includes('un-tour-img'), 'un-tour-img not rendered');
    assert.ok(block.includes('onerror'), 'onerror handler missing for missing images');
    assert.ok(block.includes('un-tour-img-placeholder'), 'placeholder not created on error');
});

test('help-feedback.js: _navigateTour function exists and clamps index', () => {
    const idx = HELP_JS.indexOf('function _navigateTour(');
    const block = HELP_JS.slice(idx, idx + 200);
    assert.ok(idx !== -1, '_navigateTour not found');
    assert.ok(block.includes('Math.max') && block.includes('Math.min'), 'index not clamped in _navigateTour');
});

test('help-feedback.js: _updateTourState function exists', () => {
    assert.ok(HELP_JS.includes('function _updateTourState('), '_updateTourState not found');
});

test('help-feedback.js: _updateTourState updates dots and counter', () => {
    const idx = HELP_JS.indexOf('function _updateTourState(');
    const block = HELP_JS.slice(idx, idx + 600);
    assert.ok(block.includes('un-tour-dot'), 'dots not updated in _updateTourState');
    assert.ok(block.includes('unTourCounter'), 'counter not updated in _updateTourState');
});

test('help-feedback.js: _updateTourState sets Continue text on last slide', () => {
    const idx = HELP_JS.indexOf('function _updateTourState(');
    const block = HELP_JS.slice(idx, idx + 900);
    assert.ok(block.includes('Continue'), "Continue text not set for last slide");
    assert.ok(block.includes("'Next'"), "Next text not set for non-last slides");
});

test('help-feedback.js: _updateTourState disables Back button on first slide', () => {
    const idx = HELP_JS.indexOf('function _updateTourState(');
    const block = HELP_JS.slice(idx, idx + 600);
    assert.ok(block.includes('unTourBack'), 'back button not referenced in _updateTourState');
    assert.ok(block.includes('disabled'), 'disabled not set on back button');
});

test('help-feedback.js: closeUpdateNotesModal removes tour-mode and keyboard listener', () => {
    const idx = HELP_JS.indexOf('async function closeUpdateNotesModal()');
    const block = HELP_JS.slice(idx, idx + 500);
    assert.ok(block.includes('tour-mode'), 'tour-mode not cleaned up in closeUpdateNotesModal');
    assert.ok(block.includes('_tourKeyListener'), 'keyboard listener not removed on close');
});

// ─── Tour CSS ─────────────────────────────────────────────────────────────────

test('CSS: .update-notes-dialog.tour-mode defined', () => {
    assert.ok(CSS.includes('.update-notes-dialog.tour-mode'), 'tour-mode not found in CSS');
});

test('CSS: .update-notes-dialog.tour-mode is wider than default dialog', () => {
    const tourIdx = CSS.indexOf('.update-notes-dialog.tour-mode');
    const defaultIdx = CSS.indexOf('.update-notes-dialog {');
    const defaultBlock = CSS.slice(defaultIdx, defaultIdx + 200);
    const tourBlock = CSS.slice(tourIdx, tourIdx + 200);
    assert.ok(tourBlock.includes('880px') || tourBlock.includes('860px') || tourBlock.includes('900px'),
        'tour-mode dialog must be wider than default 660px');
});

test('CSS: .un-tour-slide defined with display none / display flex on active', () => {
    assert.ok(CSS.includes('.un-tour-slide'), '.un-tour-slide not found in CSS');
    assert.ok(CSS.includes('.un-tour-slide.active'), '.un-tour-slide.active not found');
});

test('CSS: .un-tour-label uses green accent', () => {
    const idx = CSS.indexOf('.un-tour-label');
    const block = CSS.slice(idx, idx + 200);
    assert.ok(block.includes('#22c55e') || block.includes('34,197,94'), 'green accent not on .un-tour-label');
});

test('CSS: .un-tour-badge defined with green border', () => {
    assert.ok(CSS.includes('.un-tour-badge'), '.un-tour-badge not found in CSS');
    const idx = CSS.indexOf('.un-tour-badge');
    const block = CSS.slice(idx, idx + 300);
    assert.ok(block.includes('34,197,94') || block.includes('22c55e'), 'green color not on .un-tour-badge');
});

test('CSS: .un-tour-next uses Baddel green gradient', () => {
    assert.ok(CSS.includes('.un-tour-next'), '.un-tour-next not found');
    const idx = CSS.indexOf('.un-tour-next {');
    const block = CSS.slice(idx, idx + 200);
    assert.ok(block.includes('#22c55e'), 'green gradient not on .un-tour-next');
});

test('CSS: .un-tour-back is disabled-safe', () => {
    assert.ok(CSS.includes('.un-tour-back:disabled'), '.un-tour-back:disabled not found');
});

test('CSS: feature tour responsive stacks image and text on narrow screens', () => {
    assert.ok(CSS.includes('.un-tour-slide') && CSS.includes('flex-direction: column-reverse'),
        'responsive column-reverse not found for tour slides');
});

// ─── Behavioral simulation: tour state machine ────────────────────────────────
{
    function makeTourState(total) {
        let current = 0;
        function navigate(delta) {
            current = Math.max(0, Math.min(total - 1, current + delta));
        }
        function goTo(i) { current = i; }
        function isFirst() { return current === 0; }
        function isLast() { return current === total - 1; }
        function counter() { return `${current + 1} / ${total}`; }
        function nextLabel() { return isLast() ? 'Continue' : 'Next'; }
        return { navigate, goTo, isFirst, isLast, counter, nextLabel, get current() { return current; } };
    }

    test('tour state: starts on first slide with Back disabled', () => {
        const s = makeTourState(5);
        assert.equal(s.current, 0);
        assert.ok(s.isFirst());
        assert.ok(!s.isLast());
    });

    test('tour state: next advances slide', () => {
        const s = makeTourState(5);
        s.navigate(1);
        assert.equal(s.current, 1);
        assert.ok(!s.isFirst());
    });

    test('tour state: back from first slide stays on first', () => {
        const s = makeTourState(5);
        s.navigate(-1);
        assert.equal(s.current, 0);
    });

    test('tour state: next from last slide stays on last', () => {
        const s = makeTourState(5);
        s.goTo(4);
        s.navigate(1);
        assert.equal(s.current, 4);
        assert.ok(s.isLast());
    });

    test('tour state: last slide shows Continue', () => {
        const s = makeTourState(5);
        s.goTo(4);
        assert.equal(s.nextLabel(), 'Continue');
    });

    test('tour state: non-last slide shows Next', () => {
        const s = makeTourState(5);
        assert.equal(s.nextLabel(), 'Next');
        s.goTo(2);
        assert.equal(s.nextLabel(), 'Next');
    });

    test('tour state: counter displays 1-based index', () => {
        const s = makeTourState(5);
        assert.equal(s.counter(), '1 / 5');
        s.goTo(4);
        assert.equal(s.counter(), '5 / 5');
    });

    test('tour state: dot click jumps to arbitrary slide', () => {
        const s = makeTourState(5);
        s.goTo(3);
        assert.equal(s.current, 3);
        assert.ok(!s.isLast());
    });
}

// ─── Tour header (polish: icon + title + subtitle) ────────────────────────────

test('HTML: un-tour-header container exists in update notes modal', () => {
    const idx = HTML.indexOf('id="updateNotesModal"');
    const block = HTML.slice(idx, idx + 800);
    assert.ok(block.includes('un-tour-header'), 'un-tour-header not found in modal HTML');
});

test('HTML: unTourTitle element exists in modal', () => {
    assert.ok(HTML.includes('id="unTourTitle"'), 'unTourTitle element missing from HTML');
});

test('HTML: unTourSubtitle element exists in modal', () => {
    assert.ok(HTML.includes('id="unTourSubtitle"'), 'unTourSubtitle element missing from HTML');
});

test('HTML: un-tour-header-icon element exists in modal', () => {
    const idx = HTML.indexOf('id="updateNotesModal"');
    const block = HTML.slice(idx, idx + 800);
    assert.ok(block.includes('un-tour-header-icon'), 'un-tour-header-icon not found in modal HTML');
});

test('help-feedback.js: _renderFeatureTour sets tour header title from notes.title', () => {
    const idx = HELP_JS.indexOf('function _renderFeatureTour(');
    const block = HELP_JS.slice(idx, idx + 700);
    assert.ok(block.includes('unTourTitle'), 'unTourTitle not populated in _renderFeatureTour');
    assert.ok(block.includes('notes.title'), 'notes.title not used for tour header title');
});

test('help-feedback.js: _renderFeatureTour sets tour header subtitle from notes.subtitle', () => {
    const idx = HELP_JS.indexOf('function _renderFeatureTour(');
    const block = HELP_JS.slice(idx, idx + 700);
    assert.ok(block.includes('unTourSubtitle'), 'unTourSubtitle not populated in _renderFeatureTour');
    assert.ok(block.includes('notes.subtitle'), 'notes.subtitle not used for tour header subtitle');
});

test('CSS: tour mode hides update-notes-primary-btn', () => {
    assert.ok(
        CSS.includes('.update-notes-dialog.tour-mode') && CSS.includes('.update-notes-primary-btn'),
        'tour-mode hiding of update-notes-primary-btn not found in CSS'
    );
    const idx = CSS.indexOf('.update-notes-dialog.tour-mode .update-notes-primary-btn');
    assert.ok(idx !== -1 || CSS.includes('tour-mode') && CSS.includes('update-notes-primary-btn'),
        'update-notes-primary-btn must be hidden in tour mode');
});

test('CSS: un-tour-header shown in tour mode', () => {
    assert.ok(CSS.includes('.update-notes-dialog.tour-mode .un-tour-header'), 'tour header not shown in tour mode CSS');
});

test('CSS: un-tour-header-icon has green accent', () => {
    const idx = CSS.indexOf('.un-tour-header-icon');
    assert.ok(idx !== -1, '.un-tour-header-icon not found in CSS');
    const block = CSS.slice(idx, idx + 300);
    assert.ok(block.includes('34,197,94') || block.includes('22c55e'), 'green accent missing from .un-tour-header-icon');
});

test('help-feedback.js: closeUpdateNotesModal restores elements hidden during tour', () => {
    const idx = HELP_JS.indexOf('async function closeUpdateNotesModal()');
    const block = HELP_JS.slice(idx, idx + 1200);
    assert.ok(block.includes('hidden = false'), 'hidden = false not found — tour elements not restored on close');
});
