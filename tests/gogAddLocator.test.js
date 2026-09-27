'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('src/js/addAccountModal.js', 'utf8');
const start = source.indexOf('async function addNewAccount(platform)');

async function run(addFn) {
    let callback;
    let located = 0, guided = 0;
    const button = { innerHTML: 'Add', style: {}, disabled: false };
    const context = vm.createContext({
        isAccountProcessing: false, showToast() {},
        document: { querySelectorAll: () => [button] },
        PLATFORM_CONFIG: { gog: { name: 'GOG', addFn } },
        showAddAccountModal: (_, fn) => { callback = fn; },
        showPostAddAccountGuide: () => { guided++; },
        showLauncherLocatorDialog: async () => { located++; },
    });
    vm.runInContext(source.slice(start), context);
    await context.addNewAccount('gog');
    await callback();
    return { located, guided, button, busy: context.isAccountProcessing };
}
test('GOG structured not-found result offers locator and never claims opened', async () => {
    const r = await run(async () => ({ status: 'error', code: 'LAUNCHER_NOT_FOUND', message: 'Not found' }));
    assert.equal(r.located, 1); assert.equal(r.guided, 0);
    assert.equal(r.busy, false); assert.equal(r.button.disabled, false); assert.equal(r.button.innerHTML, 'Add');
});
test('Electron serialized missing-launcher error still offers locator', async () => {
    const r = await run(async () => { throw new Error('GOG Galaxy could not be found. Install it or locate GalaxyClient.exe.'); });
    assert.equal(r.located, 1); assert.equal(r.guided, 0);
});
test('successful GOG launch shows guide, OS failure only shows error', async () => {
    assert.equal((await run(async () => ({ status: 'success', ok: true }))).guided, 1);
    const r = await run(async () => ({ status: 'error', code: 'LAUNCH_FAILED', message: 'Could not open' }));
    assert.equal(r.guided, 0); assert.equal(r.located, 0);
});
