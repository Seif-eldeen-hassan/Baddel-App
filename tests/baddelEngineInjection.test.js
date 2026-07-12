'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');

const { BaddelEngine } = require('../gameScanner');

function makeTempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-engine-injection-'));
}

function makeDeps() {
    const calls = {
        clearJob:    [],
        deleteEntry: [],
    };
    return {
        mrm: {
            clearJob(id) { calls.clearJob.push(id); },
            getStatus() { return null; },
            resolve: async () => null,
            getJob: () => null,
            markResolved: () => {},
        },
        metadataCacheStore: {
            save: async () => {},
            load: async () => null,
            deleteEntry: async (id) => { calls.deleteEntry.push(id); },
        },
        calls,
    };
}

test('BaddelEngine can be constructed with injected mrm and metadataCacheStore', () => {
    const tempDir = makeTempDir();
    const { mrm, metadataCacheStore } = makeDeps();

    const engine = new BaddelEngine({
        dbFolder: tempDir,
        skipMetadataServerSync: true,
        mrm,
        metadataCacheStore,
    });

    assert.equal(engine._mrm, mrm);
    assert.equal(engine._metadataCacheStore, metadataCacheStore);
    assert.equal(typeof engine.getJsonGameRepository, 'function');
});

test('BaddelEngine deleteGamePermanently uses injected mrm and metadataCacheStore', async () => {
    const tempDir = makeTempDir();
    const { mrm, metadataCacheStore, calls } = makeDeps();
    const engine = new BaddelEngine({
        dbFolder: tempDir,
        skipMetadataServerSync: true,
        mrm,
        metadataCacheStore,
    });

    engine.getJsonGameRepository().upsertGameRecord({
        id: 'delete-me',
        name: 'Delete Me',
        command: 'C:\\Games\\DeleteMe\\game.exe',
        isHidden: false,
        isInstalled: true,
    });

    const result = await engine.deleteGamePermanently('delete-me');

    assert.deepEqual(result, { status: 'success' });
    assert.deepEqual(calls.clearJob, ['delete-me']);
    assert.deepEqual(calls.deleteEntry, ['delete-me']);
});

test('BaddelEngine _getCore passes injected mrm to GameScannerCore', () => {
    const tempDir = makeTempDir();
    const { mrm, metadataCacheStore } = makeDeps();
    const engine = new BaddelEngine({
        dbFolder: tempDir,
        skipMetadataServerSync: true,
        mrm,
        metadataCacheStore,
    });

    const core = engine._getCore();

    assert.equal(core._mrm, mrm);
});

test('BaddelEngine construction without explicit injected deps still works', () => {
    const tempDir = makeTempDir();
    const engine = new BaddelEngine({
        dbFolder: tempDir,
        skipMetadataServerSync: true,
    });

    assert.equal(typeof engine.startGlobalScan, 'function');
    assert.equal(typeof engine.deleteGamePermanently, 'function');
    assert.ok(engine._mrm);
    assert.ok(engine._metadataCacheStore);
});
