'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('src/js/game-details.js', 'utf8');
const storageSource = fs.readFileSync('src/js/install-storage.js', 'utf8');
const css = fs.readFileSync('src/css/install-flow.css', 'utf8');
function block(start, end) { const at = source.indexOf(start); return source.slice(at, source.indexOf(end, at + start.length)); }

test('install modal renders one setup page and one storage page with the required footers', () => {
    assert.match(source, /id="gdInstallSetupPage"/); assert.match(source, /id="gdInstallStorageSection" hidden/);
    assert.match(source, /id="gdInstallCancelBtn"[^>]*>Cancel/); assert.match(source, /id="gdInstallBackBtn"[^>]*>Back/);
    assert.match(source, /id="gdInstallConfirmLabel">Continue/);
    assert.match(source, /Setup <b>1\/2<\/b>/); assert.match(source, /Storage <b>2\/2<\/b>/);
});

test('direct provider enters storage only on Continue; launcher-managed provider skips storage', async () => {
    let mounts = 0, confirms = 0, resets = 0;
    const context = { _gdInstallWizardPage: 'setup', _gdInstallSelectedPlatform: 'epic', _gdInstallSelectedProvider: 'legendary',
        _gdInstallSelectedAccountId: 'owner', _gdCurrentGame: { id: 'game' },
        _gdInstallUpdateSteps() {}, _gdDirectInstallPayload: () => ({ platform: 'epic' }), requestAnimationFrame: fn => fn(),
        document: { getElementById: () => ({ focus() {} }), querySelector: () => null },
        baddelInstallStorage: { mount: async () => { mounts++; }, reset: () => { resets++; } }, gdInstallConfirm: async () => { confirms++; } };
    context.window = context; vm.createContext(context);
    vm.runInContext(block('window.gdInstallBack =', 'window.gdInstallConfirm = async function'), context);
    await context.gdInstallContinue(); assert.equal(mounts, 1); assert.equal(confirms, 0); assert.equal(context._gdInstallWizardPage, 'storage');
    context.gdInstallBack(); assert.equal(context._gdInstallWizardPage, 'setup'); assert.equal(resets, 1); assert.equal(context._gdInstallSelectedAccountId, 'owner');
    context._gdInstallSelectedProvider = 'epic_launcher'; await context.gdInstallContinue(); assert.equal(mounts, 1); assert.equal(confirms, 1);
});

test('account selection invalidates storage but does not resolve it until Continue', () => {
    const accountBlock = block('window.gdInstallSelectAccount =', 'window.gdInstallBack =');
    assert.match(accountBlock, /baddelInstallStorage\?\.reset/);
    assert.doesNotMatch(accountBlock, /baddelInstallStorage\?\.mount/);
    const continueBlock = block('window.gdInstallContinue =', 'window.gdInstallConfirm = async function');
    assert.match(continueBlock, /baddelInstallStorage\?\.mount/);
});

test('storage requires known sufficient provider sizes and rejects stale responses', () => {
    assert.match(storageSource, /plan\.enoughSpace === true/);
    assert.match(storageSource, /plan\.downloadSizeBytes > 0/); assert.match(storageSource, /plan\.installedDiskSizeBytes > 0/);
    assert.match(storageSource, /selection !== current \|\| revision !== current\.revision/);
    assert.match(storageSource, /token !== generation/);
});

test('wizard preserves Escape/focus trapping and fits normal desktop heights', () => {
    assert.match(source, /event\.key === 'Escape'/); assert.match(source, /event\.key !== 'Tab'/);
    assert.match(css, /height: min\(660px, calc\(100vh - 40px\)\)/);
    assert.match(css, /#gdInstallAccountsList[^}]*max-height: min\(215px, 28vh\)/);
    assert.match(css, /\.install-method \{[^}]*font-size: 15px;[^}]*font-weight: 600;[^}]*letter-spacing: 0;/);
});
