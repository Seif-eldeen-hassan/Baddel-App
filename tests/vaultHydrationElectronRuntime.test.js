'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const FIXTURE = path.join(ROOT, 'tests/fixtures/vaultHydrationElectronFixture.cjs');
const ELECTRON = require('electron');

function runFixture(userDataPath, seed) {
    return new Promise((resolve, reject) => {
        const env = { ...process.env, VAULT_TEST_USER_DATA: userDataPath, VAULT_TEST_SEED: seed ? '1' : '0' };
        delete env.ELECTRON_RUN_AS_NODE;
        const child = spawn(ELECTRON, [FIXTURE], { cwd: ROOT, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', chunk => { stdout += chunk; });
        child.stderr.on('data', chunk => { stderr += chunk; });
        child.on('error', reject);
        child.on('exit', code => {
            if (code !== 0) return reject(new Error(`Electron fixture exited ${code}: ${stderr}`));
            const line = stdout.split(/\r?\n/).find(value => value.startsWith('VAULT_ELECTRON_RESULT '));
            if (!line) return reject(new Error(`Electron fixture returned no result: ${stdout}\n${stderr}`));
            resolve(JSON.parse(line.slice('VAULT_ELECTRON_RESULT '.length)));
        });
    });
}

test('real Electron preload and IPC always leave loading through success, empty, or typed error', { timeout: 20000 }, async () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-vault-electron-'));
    try {
        const result = await runFixture(temp, true);
        assert.equal(result.results.saved.state, 'success');
        assert.equal(result.results.saved.response.vault.accounts[0].games.length, 606);
        assert.equal(result.results.missing.state, 'empty');
        assert.deepEqual(
            ['repositoryFailure', 'neverSettles', 'handlerMissing', 'userDataMismatch'].map(key => result.results[key].state),
            ['error', 'error', 'error', 'error'],
        );
        assert.equal(result.results.repositoryFailure.code, 'VAULT_REPOSITORY_READ_FAILED');
        assert.equal(result.results.neverSettles.code, 'VAULT_MAIN_TIMEOUT');
        assert.equal(result.results.handlerMissing.code, 'VAULT_IPC_REJECTED');
        assert.equal(result.results.userDataMismatch.code, 'VAULT_USER_DATA_MISMATCH');
    } finally {
        fs.rmSync(temp, { recursive: true, force: true });
    }
});

test('real Electron clean restart reads the same persisted snapshot', { timeout: 30000 }, async () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-vault-restart-'));
    try {
        const first = await runFixture(temp, true);
        const second = await runFixture(temp, false);
        assert.equal(first.results.saved.response.vault.accounts[0].games.length, 606);
        assert.equal(second.results.saved.response.vault.accounts[0].games.length, 606);
        assert.equal(second.userDataPath, first.userDataPath);
        assert.equal(second.snapshotPath, first.snapshotPath);
    } finally {
        fs.rmSync(temp, { recursive: true, force: true });
    }
});
