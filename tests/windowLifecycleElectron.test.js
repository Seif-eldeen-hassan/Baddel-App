'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const fixture = path.join(__dirname, 'fixtures', 'windowLifecycleElectron.js');
const electron = require('electron');

function runFixture(runtime = 'source') {
    const env = { ...process.env, BADDEL_WINDOW_RUNTIME: runtime };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(electron, [fixture], {
        cwd: root,
        env,
        encoding: 'utf8',
        timeout: 30000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const line = String(result.stdout || '').split(/\r?\n/).find(value => value.startsWith('WINDOW_LIFECYCLE_RESULT='));
    assert.ok(line, result.stdout || result.stderr);
    return JSON.parse(line.slice('WINDOW_LIFECYCLE_RESULT='.length));
}

function assertRuntime(result) {
    for (const measurement of result.loaders) {
        assert.equal(measurement.loader.left, 0);
        assert.equal(measurement.loader.top, 0);
        assert.ok(Math.abs(measurement.loader.width - measurement.viewport.width) < 0.51);
        assert.ok(Math.abs(measurement.loader.height - measurement.viewport.height) < 0.51);
        assert.ok(Math.abs(measurement.centerDelta.x) < 0.51, `loader x delta was ${measurement.centerDelta.x}`);
        assert.ok(Math.abs(measurement.centerDelta.y) < 0.51, `loader y delta was ${measurement.centerDelta.y}`);
    }
    assert.equal(result.gog.initialShow, false);
    assert.equal(result.gog.hiddenBeforeReady, true);
    assert.equal(result.gog.showCalls, 1);
    assert.equal(result.gog.menuIsNull, true);
    assert.equal(result.gog.menuBarVisible, false);
    assert.equal(result.gog.childCount, 1);
    assert.equal(result.gog.childBounds.y, 84);
    assert.equal(result.gog.shell.title, 'Connect GOG Account');
    assert.equal(result.gog.shell.subtitle, 'Secure sign-in via GOG.com');
    assert.equal(result.gog.cancellationCode, 'GOG_LOGIN_CANCELLED');
    assert.equal(result.gog.storageCleared, true);
}

test('real Electron source runtime has stable first-frame loader geometry and secure GOG shell lifecycle', { timeout: 35000 }, () => {
    assertRuntime(runFixture('source'));
});

test('real Electron protected runtime preserves loader geometry and GOG shell lifecycle', { timeout: 35000 }, (context) => {
    const protectedIndex = path.join(root, '.protected-build', 'app', 'index.html');
    const protectedShell = path.join(root, '.protected-build', 'app', 'gog-auth-shell.html');
    if (!require('node:fs').existsSync(protectedIndex) || !require('node:fs').existsSync(protectedShell)) {
        context.skip('Protected runtime has not been generated.');
        return;
    }
    assertRuntime(runFixture('protected'));
});

test('real Electron loads the GOG authentication shell from the packaged app.asar root', { timeout: 35000 }, (context) => {
    const packagedAsar = path.join(root, 'dist', 'win-unpacked', 'resources', 'app.asar');
    if (!require('node:fs').existsSync(packagedAsar)) {
        context.skip('Packaged runtime has not been generated.');
        return;
    }
    assertRuntime(runFixture('packaged'));
});
