'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PROTECTED_DIR = path.join(ROOT, '.protected-build', 'app');
const FIXTURE = path.join(__dirname, 'fixtures', 'protectedPreloadElectron.js');

test('new protected Electron renderer executes the complete Epic History preload contract', {
    skip: !fs.existsSync(path.join(PROTECTED_DIR, 'build-fingerprint.json')),
}, () => {
    const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-protected-preload-'));
    try {
        const electronPath = require('electron');
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const result = spawnSync(electronPath, [FIXTURE, PROTECTED_DIR, userDataPath], {
            cwd: ROOT,
            env,
            encoding: 'utf8',
            timeout: 30000,
            windowsHide: true,
        });
        assert.equal(result.status, 0, result.stderr || result.stdout);
        const line = String(result.stdout || '').split(/\r?\n/)
            .find((entry) => entry.startsWith('PROTECTED_PRELOAD_ELECTRON='));
        assert.ok(line, result.stdout || result.stderr);
        const runtime = JSON.parse(line.slice('PROTECTED_PRELOAD_ELECTRON='.length));
        assert.deepEqual(runtime.types, { refresh: 'function', state: 'function', hydrated: 'function' });
        assert.deepEqual(runtime.refresh.options, {
            allowInteractiveLogin: true,
            operationId: 'protected-operation-1',
        });
        assert.equal(runtime.hydrated.operationId, 'protected-operation-1');
        assert.equal(runtime.statePayload.phase, 'session_verified');
    } finally {
        fs.rmSync(userDataPath, { recursive: true, force: true });
    }
});
