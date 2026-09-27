'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { register, BADDEL_SUPPORT_URL } = require('../handlers/externalLinkHandlers');

test('Support Baddel action opens only the exact approved Ko-fi URL', async () => {
    const handlers = new Map();
    const opened = [];
    register({ handle: (channel, handler) => handlers.set(channel, handler) }, {
        shell: { openExternal: async url => opened.push(url) },
        safeLauncher: { openProtocolUrl: async () => {} },
        ipcValidation: { assertString() {}, sanitizeErrorForRenderer: error => ({ status: 'error', message: error.message }) },
    });
    const handler = handlers.get('open-baddel-support');
    assert.equal(typeof handler, 'function');
    await handler({}, 'https://example.com/not-allowed');
    assert.deepEqual(opened, ['https://ko-fi.com/baddel']);
    assert.equal(BADDEL_SUPPORT_URL, 'https://ko-fi.com/baddel');
    const preload = fs.readFileSync('preload.js', 'utf8');
    assert.match(preload, /openBaddelSupport:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('open-baddel-support'\)/);
    assert.doesNotMatch(preload, /openBaddelSupport:\s*\([^)]*url/);
    assert.equal(fs.existsSync('assets/instapay-qr.jpg'), true);
    assert.match(fs.readFileSync('scripts/build-protected.js', 'utf8'), /copyDir\(path\.join\(ROOT, 'assets'\)/);
});
