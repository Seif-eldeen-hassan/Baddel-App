'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'src/dashboard.html'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'src/css/dashboard.css'), 'utf8');
const SIDEBAR = fs.readFileSync(path.join(ROOT, 'src/js/app/sidebar.js'), 'utf8');
const HELP = fs.readFileSync(path.join(ROOT, 'src/js/app/help-feedback.js'), 'utf8');
const PLATFORM_SYNC = fs.readFileSync(path.join(ROOT, 'platformSync.js'), 'utf8');

function functionSource(source, name) {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `${name} must exist`);
    let depth = 0;
    let bodyStarted = false;
    for (let index = start; index < source.length; index += 1) {
        if (source[index] === '{') { depth += 1; bodyStarted = true; }
        if (source[index] === '}') {
            depth -= 1;
            if (bodyStarted && depth === 0) return source.slice(start, index + 1);
        }
    }
    throw new Error(`Could not extract ${name}`);
}

test('Vault overview removes colored summary rails and Epic cover previews', () => {
    assert.doesNotMatch(HTML, /vaultEpicCardCovers|vault-platform-covers/);
    assert.doesNotMatch(functionSource(SIDEBAR, '_renderVaultOverview'), /epic\.covers|vaultEpicCardCovers/);
    assert.match(CSS, /#vaultView \.vault-summary-card::before\s*\{\s*display:\s*none;/);
});

test('Vault overview keeps Epic prominent with readable distributed content', () => {
    assert.match(CSS, /grid-template-columns:\s*minmax\(500px, 1\.45fr\) minmax\(230px, 0\.72fr\)/);
    assert.match(CSS, /#vaultView \.vault-platform-card-epic\s*\{[\s\S]*?grid-row:\s*1 \/ span 3;[\s\S]*?min-height:\s*296px;/);
    assert.match(CSS, /vault-platform-card-epic \.vault-platform-copy strong\s*\{\s*font-size:\s*20px;/);
    assert.match(CSS, /vault-platform-card-epic \.vault-platform-metrics strong\s*\{\s*font-size:\s*18px;/);
});

test('Epic committed event is emitted only after every Vault library phase commit', () => {
    const mergedWrite = PLATFORM_SYNC.indexOf('const epicCommitSnapshot = await syncCacheRepository.writeEpicMergedLibrary(finalGames)');
    const vaultCommit = PLATFORM_SYNC.indexOf("phase: 'library'", mergedWrite);
    const committedEvent = PLATFORM_SYNC.indexOf("await _emitPlatformLibraryCommitted('epic'", mergedWrite);
    const finish = PLATFORM_SYNC.indexOf("_finishPlatformSync('epic'", mergedWrite);
    assert.ok(mergedWrite >= 0 && vaultCommit > mergedWrite, 'Epic merged library and Vault commit must exist');
    assert.ok(committedEvent > vaultCommit, 'renderer event must follow the durable Epic Vault commit');
    assert.ok(finish > committedEvent, 'terminal completion must follow the committed event');
    assert.equal(PLATFORM_SYNC.slice(mergedWrite, vaultCommit).includes("_emitPlatformLibraryCommitted('epic'"), false);
});

test('Connect more platforms opens the existing feedback tab with a prompt', () => {
    assert.match(HTML, /Connect more platforms/);
    assert.match(HTML, /onclick="openVaultPlatformFeedback\(\)"/);

    const message = {
        value: '',
        focused: false,
        selection: null,
        focus() { this.focused = true; },
        setSelectionRange(start, end) { this.selection = [start, end]; },
    };
    const helpModal = { classList: { add(value) { this.value = value; } } };
    let selectedTab = null;
    const context = {
        document: {
            getElementById(id) {
                if (id === 'feedbackMessage') return message;
                if (id === 'helpModal') return helpModal;
                return null;
            },
        },
        switchHelpTab(tab) { selectedTab = tab; },
    };
    vm.runInNewContext(`${functionSource(HELP, 'openHelpModal')}\n${functionSource(HELP, 'openVaultPlatformFeedback')}\nopenVaultPlatformFeedback();`, context);

    assert.equal(selectedTab, 'feedback');
    assert.equal(message.value, 'Platform request: ');
    assert.equal(message.focused, true);
    assert.deepEqual(message.selection, [message.value.length, message.value.length]);
});

test('Platform request does not overwrite feedback the user already typed', () => {
    const message = { value: 'Please add Battle.net', focus() {}, setSelectionRange() {} };
    const context = {
        document: {
            getElementById(id) {
                if (id === 'feedbackMessage') return message;
                if (id === 'helpModal') return { classList: { add() {} } };
                return null;
            },
        },
        switchHelpTab() {},
    };
    vm.runInNewContext(`${functionSource(HELP, 'openHelpModal')}\n${functionSource(HELP, 'openVaultPlatformFeedback')}\nopenVaultPlatformFeedback();`, context);
    assert.equal(message.value, 'Please add Battle.net');
});
