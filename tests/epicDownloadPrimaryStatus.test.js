'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const window = { electronAPI: {} };
const source = fs.readFileSync(path.join(__dirname, '../src/js/downloads.js'), 'utf8');
vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, 'window.hooks={status:dlCleanStatus,advanced:dlAdvancedDetails};})();'), { window, document: { readyState: 'loading', addEventListener() {} }, console, performance });
for (const message of ['Downloading compressed data', 'Downloading and unpacking', 'Writing game files']) test(`primary Epic copy hides transfer implementation detail: ${message}`, () => {
    const task = { id: 'test', platform: 'epic', installProvider: 'legendary', status: 'downloading', stage: 'downloading', statusMessage: message, downloadedBytes: 10, totalBytes: 100, writtenBytes: 20, rawDownloadSpeedBps: 15, diskWriteSpeedBps: 10 };
    assert.equal(window.hooks.status(task), 'Downloading');
    assert.equal(task.statusMessage, message);
    assert.match(window.hooks.advanced(task), new RegExp(message));
    assert.equal(window.hooks.status({ ...task, platform: 'gog', installProvider: 'gogdl' }), 'Downloading');
    assert.match(window.hooks.advanced({ ...task, platform: 'gog', providerActivity: 'Decompressing chunks' }), /Decompressing chunks/);
});
for (const [status, stage, expected] of [['pending','queued','Waiting in queue'],['preparing','preparing','Preparing download'],['resuming','downloading','Resuming...'],['pausing','downloading','Pausing...'],['paused','downloading','Paused'],['downloading','finalizing','Finalizing installation'],['verifying','verifying','Verifying files'],['completed','completed','Ready to play'],['failed','failed','Download failed']]) test(`Epic lifecycle label ${status}/${stage}`, () => {
    assert.equal(window.hooks.status({ platform: 'epic', installProvider: 'legendary', status, stage, statusMessage: 'Writing game files', readyToPlay: status === 'completed' }), expected);
});
