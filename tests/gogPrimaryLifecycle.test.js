'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { GogProgressParser } = require('../src/features/downloads/infrastructure/providers/gog/GogProgressParser');
const source = fs.readFileSync('src/js/downloads.js', 'utf8');
const context = { document: { readyState: 'loading', addEventListener() {} }, console, performance }; context.window = context;
vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, 'window.hooks={dlCleanStatus,dlAdvancedDetails,dlGameInfoRows};})();'), context);
for (const line of ['Unpacking', 'Decompressing downloaded chunks', 'Decompressed', 'Writing game files', 'Installing decompressed chunks', '[PROGRESS INFO]: + Download - 1 MiB/s (raw) / 2 MiB/s (decompressed)', '[PROGRESS INFO]: + Disk - 1 MiB/s (write) / 0 MiB/s (read)']) test(`GOG transfer activity stays downloading: ${line}`, () => {
    const event = new GogProgressParser().parseLine(line);
    assert.equal(event.stage, 'downloading');
    const task = { platform: 'gog', status: 'downloading', stage: event.stage, providerActivity: event.message };
    assert.equal(context.hooks.dlCleanStatus(task), 'Downloading');
    assert.ok(context.hooks.dlAdvancedDetails(task).includes(event.message));
});
for (const [status, stage, expected] of [['verifying', 'verifying', 'Verifying files'], ['installing', 'finalizing', 'Finalizing installation'], ['paused', 'downloading', 'Paused'], ['completed', 'completed', 'Ready to play']]) test(`GOG lifecycle ${status}`, () => {
    assert.equal(context.hooks.dlCleanStatus({ platform: 'gog', status, stage, providerActivity: 'Decompressing' }), expected);
});
test('Game Info is allowlisted and correctly labels creation vs completion dates', () => {
    const rows = context.hooks.dlGameInfoRows({ title: 'Fixture', createdAt: '2026-09-01', completedAt: null, accountDisplayName: 'Owner', token: 'secret', cookie: 'secret', auth: { secret: 'secret' }, installedDiskSizeBytes: null });
    const text = JSON.stringify(rows); assert.ok(text.includes('Queued on')); assert.ok(!text.includes('Downloaded on')); assert.ok(!text.includes('secret')); assert.ok(text.includes('Unavailable'));
});
