'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { InstallSizeCacheRepository } = require('../src/features/downloads/infrastructure/services/InstallSizeCacheRepository');

test('authoritative size cache persists across resolver instances and expires at the boundary', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-size-cache-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    let now = 1000;
    const first = new InstallSizeCacheRepository({ userDataDir: root, now: () => now, ttlMs: 100 });
    await first.set('epic:owner:app:build', {
        downloadSizeBytes: 1000,
        installedDiskSizeBytes: 2000,
        sizeSource: 'legendary-info-manifest',
        buildId: 'build-1',
    });
    const restarted = new InstallSizeCacheRepository({ userDataDir: root, now: () => now, ttlMs: 100 });
    assert.equal(restarted.get('epic:owner:app:build').downloadSizeBytes, 1000);
    now = 1101;
    assert.equal(restarted.get('epic:owner:app:build'), null);
});

test('unknown and failed size sources are never persisted', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-size-cache-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const cache = new InstallSizeCacheRepository({ userDataDir: root });
    assert.equal(await cache.set('bad', { downloadSizeBytes: 1, installedDiskSizeBytes: 2, sizeSource: 'estimate' }), false);
    assert.equal(cache.get('bad'), null);
});
