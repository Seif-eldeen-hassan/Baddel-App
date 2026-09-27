'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('real Electron uses the committed managed Epic record immediately after Ready to play', { timeout: 35000 }, () => {
    const electron = require('electron');
    const fixture = path.join(__dirname, 'fixtures', 'epicManagedInstallElectron.js');
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(electron, [fixture], { cwd: path.resolve(__dirname, '..'), env, encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const line = String(result.stdout || '').split(/\r?\n/).find(value => value.startsWith('EPIC_MANAGED_ELECTRON_RESULT='));
    assert.ok(line, result.stdout || result.stderr);
    const value = JSON.parse(line.slice('EPIC_MANAGED_ELECTRON_RESULT='.length));
    assert.match(value.renderer.text, /Ready to play/);
    assert.equal(value.renderer.opened.installSource, 'download');
    assert.equal(value.renderer.opened.installProvider, 'legendary');
    assert.equal(value.renderer.opened.managedDownloadTaskId, 'dl_2222222222222222');
    assert.deepEqual(value.renderer.toasts, []);
    assert.equal(value.launchResult.status, 'success');
    assert.equal(value.launchResult.route, 'baddel-managed-epic');
    assert.equal(value.launchResult.method, 'legendary');
    assert.equal(value.launches.length, 1);
    assert.equal(value.persisted.installProvider, 'legendary');
    assert.equal(value.persisted.installSource, 'download');
    assert.equal(value.persisted.appName, 'ElectronArtifact');
    assert.equal(value.queuePersisted.readyToPlay, true);
    assert.equal(value.queuePersisted.installedGameId, value.persisted.id);
});
