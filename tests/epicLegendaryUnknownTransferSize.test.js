'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('Epic renders confirmed raw counters while the canonical transfer denominator is still unknown', () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/js/downloads.js'), 'utf8');
    const window = { electronAPI: {} };
    const document = { readyState: 'loading', addEventListener() {} };
    vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, 'window.hooks = { bytes: getDisplayDownloadedBytes, text: dlDownloadedText, percent: dlPresentedPercent };})();'), { window, document, console, performance });
    const task = { id: 'unknown-denominator', platform: 'epic', status: 'downloading', downloadedBytes: 0, rawDownloadedBytes: 1268777, totalBytes: null, progressPercent: null, downloadSpeedBps: 1268777 };
    assert.equal(window.hooks.bytes(task), 1268777);
    assert.equal(window.hooks.text(task), '1.3 MB / Calculating');
    assert.equal(window.hooks.percent(task), null);
    assert.equal(task.downloadedBytes, 0, 'presentation must not fabricate a canonical tuple');
    assert.equal(task.totalBytes, null);
    assert.equal(window.hooks.bytes({ ...task, totalBytes: 602029425, downloadedBytes: 1048576 }), 1048576, 'a known canonical tuple remains authoritative');
    assert.equal(window.hooks.bytes({ ...task, platform: 'gog' }), 0, 'GOG semantics are unchanged');
});
