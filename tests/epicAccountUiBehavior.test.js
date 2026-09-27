'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src/js/accounts/platform-panels.js'), 'utf8');

function extractFunction(name) {
    const start = source.indexOf(`async function ${name}(`);
    assert.notEqual(start, -1);
    let depth = 0;
    let started = false;
    for (let index = start; index < source.length; index += 1) {
        if (source[index] === '{') { depth += 1; started = true; }
        else if (source[index] === '}' && started && --depth === 0) return source.slice(start, index + 1);
    }
    throw new Error(`Could not extract ${name}`);
}

test('unlink IPC error payload does not produce a false success toast', async () => {
    const toasts = [];
    let confirmation;
    const sandbox = {
        activePlatformView: 'epic',
        openConfirmModal(_title, _message, _label, callback) { confirmation = callback; },
        showToast(message, type) { toasts.push({ message, type }); },
        window: { electronAPI: { platformSyncUnlink: async () => ({ status: 'error', code: 'LOCKED', message: 'Could not unlink.' }) } },
        console: { error() {} },
    };
    vm.createContext(sandbox);
    vm.runInContext(`${extractFunction('unlinkPlatformAccount')}\nunlinkPlatformAccount('account-a');`, sandbox);
    await confirmation();
    assert.equal(toasts.some((toast) => toast.type === 'success'), false);
    assert.deepEqual(toasts, [{ message: 'Failed to unlink account.', type: 'error' }]);
});
