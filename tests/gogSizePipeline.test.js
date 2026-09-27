'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { makeCompletionPatch } = require('../src/features/downloads/domain/services/DownloadCompletionValidator');
const { normalizeTask } = require('../src/features/downloads/domain/entities/DownloadTask');

const source = fs.readFileSync('src/js/downloads.js', 'utf8');
const context = { document: { readyState: 'loading', addEventListener() {} }, console, performance };
context.window = context;
vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, 'window.hooks={dlGameInfoSizes,dlGameInfoRows};})();'), context);

const GB = 1024 ** 3;
const download = Math.round(2.6 * GB);
const installedEstimate = Math.round(4.1 * GB);
const installedActual = Math.round(4.15 * GB);

test('GOG manifest compressed and installed sizes remain distinct through normalization and Game Info', () => {
    const task = normalizeTask({ platform: 'gog', status: 'completed', downloadSizeBytes: download,
        installedDiskSizeBytes: installedEstimate, downloadSizeSource: 'gog-public-windows-manifest',
        installedSizeSource: 'gog-public-windows-manifest' });
    { const sizes = context.hooks.dlGameInfoSizes(task); assert.equal(sizes.download, download); assert.equal(sizes.installed, installedEstimate); }
});

test('GOG completion preserves manifest download bytes and prefers verified filesystem installed bytes', () => {
    const task = normalizeTask({ platform: 'gog', downloadSizeBytes: download, installedDiskSizeBytes: installedEstimate,
        downloadSizeSource: 'gog-public-windows-manifest', installedSizeSource: 'gog-public-windows-manifest' });
    const receipt = { provider: 'gog', transfer: { downloadedBytes: installedActual, totalBytes: installedActual,
        source: 'existing-installation-filesystem' }, verification: { status: 'passed', actualBytes: installedActual } };
    const completed = normalizeTask({ ...task, ...makeCompletionPatch(receipt, task), status: 'completed' });
    assert.equal(completed.downloadSizeBytes, download);
    assert.equal(completed.downloadSizeSource, 'gog-public-windows-manifest');
    assert.equal(completed.installedDiskSizeBytes, installedActual);
    { const sizes = context.hooks.dlGameInfoSizes(completed); assert.equal(sizes.download, download); assert.equal(sizes.installed, installedActual); }
});

test('existing-installation-filesystem never masquerades as GOG Download size', () => {
    const receipt = { provider: 'gog', transfer: { downloadedBytes: installedActual, totalBytes: installedActual,
        source: 'existing-installation-filesystem' }, verification: { status: 'passed', actualBytes: installedActual } };
    const completed = normalizeTask({ platform: 'gog', status: 'completed', ...makeCompletionPatch(receipt, { platform: 'gog' }) });
    assert.equal(completed.downloadSizeBytes, null);
    assert.equal(completed.installedDiskSizeBytes, installedActual);
    { const sizes = context.hooks.dlGameInfoSizes(completed); assert.equal(sizes.download, null); assert.equal(sizes.installed, installedActual); }
    assert.match(JSON.stringify(context.hooks.dlGameInfoRows(completed)), /Download size.*Unavailable/);
});

test('legacy GOG filesystem totals without provenance cannot invent a network download size', () => {
    for (const task of [
        { platform: 'gog', totalBytes: installedActual, verificationActualBytes: installedActual },
        { platform: 'gog', transferTotalBytes: installedActual, installedDiskSizeBytes: installedActual },
        { platform: 'gog', downloadSizeBytes: installedActual, verificationActualBytes: installedActual },
    ]) assert.equal(context.hooks.dlGameInfoSizes(task).download, null);
});

test('genuine GOG provider transfer total remains a valid download fallback', () => {
    const task = { platform: 'gog', transferTotalBytes: download, verificationActualBytes: installedActual,
        totalBytesSource: 'gogdl-overall-progress' };
    { const sizes = context.hooks.dlGameInfoSizes(task); assert.equal(sizes.download, download); assert.equal(sizes.installed, installedActual); }
});
