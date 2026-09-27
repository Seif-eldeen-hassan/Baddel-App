'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { GogCapabilityDiscovery, extractCommands } = require('../src/features/downloads/infrastructure/providers/gog/GogCapabilityDiscovery');

test('GOG capability discovery reads supported commands from runtime help', async () => {
    const runtime = {
        verify: async () => ({ version: '1.2.2' }),
        run: async (args) => {
            if (args[0] === '--help') return { stdout: 'usage: gogdl.exe {auth,download,info,repair,update}\n', stderr: '' };
            return { stdout: 'usage: gogdl.exe download --path PATH id\n--platform {windows,osx,linux}\n--skip-dlcs\n--max-workers WORKERS_COUNT\n', stderr: '' };
        },
    };
    const discovery = new GogCapabilityDiscovery({ runtime });
    const result = await discovery.discover();
    assert.equal(result.available, true);
    assert.equal(result.runtimeVersion, '1.2.2');
    assert.equal(result.supportsDownload, true);
    assert.equal(result.flags.path, true);
});

test('GOG capability discovery reports unsupported runtime safely', async () => {
    const runtime = {
        verify: async () => ({ version: '0.0.0' }),
        run: async () => ({ stdout: 'usage: gogdl.exe {auth,info}\n', stderr: '' }),
    };
    const discovery = new GogCapabilityDiscovery({ runtime });
    await assert.rejects(() => discovery.discover(), /does not support required download commands/);
    const status = await discovery.getStatus();
    assert.equal(status.available, false);
    assert.equal(status.reason, 'GOG_RUNTIME_UNSUPPORTED');
});

test('GOG command extraction handles comma-delimited help blocks', () => {
    assert.deepEqual(extractCommands('usage: gogdl.exe {import,redist,auth,download,info}'), ['import', 'redist', 'auth', 'download', 'info']);
});

test('capability extraction recognizes the actual bundled gogdl help format', () => {
    const executable = path.resolve('gog-runtime/gogdl.exe');
    const result = spawnSync(executable, ['--help'], { encoding: 'utf8', windowsHide: true, shell: false, timeout: 10000 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0);
    const commands = extractCommands(`${result.stdout || ''}\n${result.stderr || ''}`);
    assert.ok(commands.includes('download'));
    assert.ok(commands.includes('info'));
    assert.ok(commands.includes('update'));
    assert.ok(commands.includes('repair'));
});
