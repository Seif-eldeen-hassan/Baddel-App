'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const FIXTURE = path.join(__dirname, 'fixtures', 'epicHistoryPersistentSessionElectron.js');

function runFixture(mode, userDataPath) {
    const electronPath = require('electron');
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(electronPath, [FIXTURE, mode, userDataPath, ROOT], {
        cwd: ROOT,
        env,
        encoding: 'utf8',
        timeout: 30000,
        windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const line = String(result.stdout || '').split(/\r?\n/).find((entry) => entry.startsWith('EPIC_HISTORY_ELECTRON_FIXTURE='));
    assert.ok(line, result.stdout || result.stderr);
    return JSON.parse(line.slice('EPIC_HISTORY_ELECTRON_FIXTURE='.length));
}

test('real Electron persist session survives restart, stays isolated, and modal hidden state computes correctly', () => {
    const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-epic-history-electron-'));
    try {
        assert.equal(runFixture('seed', userDataPath).seeded, true);
        const verified = runFixture('verify', userDataPath);
        assert.equal(verified.accountAHasFixtureCookie, true);
        assert.equal(verified.accountBHasFixtureCookie, false);
        assert.equal(verified.rendered.preloadExposed, true);
        assert.equal(verified.rendered.actionsDisplay, 'none');
        assert.notEqual(verified.rendered.waitingDisplay, 'none');
    } finally {
        fs.rmSync(userDataPath, { recursive: true, force: true });
    }
});
