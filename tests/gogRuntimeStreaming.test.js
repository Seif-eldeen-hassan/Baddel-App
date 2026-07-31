'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const { PassThrough } = require('node:stream');

const { GogRuntime } = require('../src/features/sync/infrastructure/integrations/gog/GogRuntime');

function makeProcess({ exitCode = 0, output = 'Downloading access_token=secret 5%\n', hang = false } = {}) {
    const proc = new EventEmitter();
    proc.stdout = new PassThrough();
    proc.stderr = new PassThrough();
    proc.pid = 12345;
    proc.killed = false;
    proc.kill = () => {
        proc.killed = true;
        setImmediate(() => proc.emit('close', null, 'SIGTERM'));
    };
    setImmediate(() => {
        proc.emit('spawn');
        proc.stdout.write(output);
        proc.stderr.write('refresh_token=also-secret\n');
        if (!hang) {
            proc.stdout.end();
            proc.stderr.end();
            proc.emit('close', exitCode, null);
        }
    });
    return proc;
}

function runtimeWithSpawn(spawn) {
    return new GogRuntime({
        projectRoot: 'E:\\Baddel\\Baddel-App',
        fs: { accessSync: () => {} },
        spawn,
        execFile: (_cmd, _args, _opts, cb) => cb?.(),
    });
}

test('GOG runtime spawnCommand streams redacted output without shell execution', async () => {
    const calls = [];
    const runtime = runtimeWithSpawn((exe, args, options) => {
        calls.push({ exe, args, options });
        return makeProcess();
    });
    const stdout = [];
    const stderr = [];
    const result = await runtime.spawnCommand(['download', '--path', 'E:\\Games', '123'], {
        onStdout: chunk => stdout.push(chunk),
        onStderr: chunk => stderr.push(chunk),
    });
    assert.equal(result.code, 0);
    assert.equal(calls[0].options.shell, false);
    assert.deepEqual(calls[0].options.stdio, ['ignore', 'pipe', 'pipe']);
    assert.match(stdout.join(''), /access_token=\[REDACTED\]/);
    assert.match(stderr.join(''), /refresh_token=\[REDACTED\]/);
});

test('GOG runtime spawnCommand aborts a running process', async () => {
    let spawned;
    const runtime = runtimeWithSpawn(() => {
        spawned = makeProcess({ hang: true });
        return spawned;
    });
    const controller = new AbortController();
    const promise = runtime.spawnCommand(['download', '123'], {
        signal: controller.signal,
        killTree: false,
    });
    setImmediate(() => controller.abort());
    await assert.rejects(promise, /cancelled/i);
    assert.equal(spawned.killed, true);
});
