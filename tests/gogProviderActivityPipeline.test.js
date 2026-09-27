'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { DownloadTelemetryAggregator } = require('../src/features/downloads/infrastructure/services/DownloadTelemetryAggregator');
const { normalizeTask } = require('../src/features/downloads/domain/entities/DownloadTask');
const file = path.resolve('src/features/downloads/infrastructure/providers/gog/GogDownloadAdapter.js');
const loaded = new Module(file, module); loaded.filename = file; loaded.paths = Module._nodeModulePaths(path.dirname(file));
loaded._compile(fs.readFileSync(file, 'utf8') + '\nmodule.exports.testNormalizeProgress = normalizeProgress;', file);
test('raw sanitized GOG activity survives adapter, telemetry debounce and task serialization', () => {
    const normalize = loaded.exports.testNormalizeProgress;
    const first = normalize({ eventType: 'log', stage: 'downloading', message: 'Decompressing chunks access_token=private' });
    assert.ok(first.providerActivity.includes('Decompressing chunks')); assert.ok(!first.providerActivity.includes('private'));
    const telemetry = new DownloadTelemetryAggregator({ emitIntervalMs: 0 });
    const task = { id: 'dl_0123456789abcdef', platform: 'gog', status: 'downloading', downloadedBytes: 0, totalBytes: 100 };
    const result = telemetry.apply(task, { ...first, timestamp: 1000 });
    assert.equal(result.patch.providerActivity, first.providerActivity);
    const next = telemetry.apply({ ...task, ...result.patch }, { ...normalize({ eventType: 'log', stage: 'downloading', message: 'Writing game files' }), timestamp: 2000 });
    assert.equal(next.patch.providerActivity, 'Writing game files'); assert.equal(next.shouldEmit, true);
    assert.equal(normalizeTask({ ...task, ...next.patch }).providerActivity, 'Writing game files');
});
test('generic GOG installation chatter cannot cause early finalization', () => {
    for (const stage of ['installing', 'finalizing']) {
        const patch = loaded.exports.testNormalizeProgress({ eventType: 'log', stage, message: 'Initializing installation manager' });
        assert.equal(patch.status, 'downloading'); assert.equal(patch.stage, 'downloading');
    }
    assert.equal(loaded.exports.testNormalizeProgress({ eventType: 'log', stage: 'verifying', message: 'Verifying file hashes' }).status, 'verifying');
});
