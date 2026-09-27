'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const resolver = require('../services/launcherPathResolver');
const { launchResolvedLauncher } = require('../services/launcherOpenService');

const none = async () => [];
const noneOne = async () => null;
const noMachine = {
    _readManualPath: noneOne,
    _getDrives: async () => [],
    _queryRegistry: none,
    _queryShortcuts: none,
    _findRunning: noneOne,
};
const existsOnly = (...paths) => {
    const values = new Set(paths.map(value => value.toLowerCase()));
    return value => values.has(String(value || '').toLowerCase());
};

test('GOG resolves from the primary Galaxy registration at its standard install location', async () => {
    const exePath = 'C:\\Program Files (x86)\\GOG Galaxy\\GalaxyClient.exe';
    const result = await resolver.resolveLauncher('gog', { ...noMachine, _fileExists: existsOnly(exePath), _queryGogRegistration: async () => [exePath], _queryProtocol: noneOne });
    assert.deepEqual(result, { exePath, source: 'gog-registration' });
});

test('GOG resolves from authoritative Galaxy registration at a non-default location', async () => {
    const exePath = 'Q:\\Apps\\GOG Galaxy\\GalaxyClient.exe';
    const result = await resolver.resolveLauncher('gog', { ...noMachine, _fileExists: existsOnly(exePath), _queryGogRegistration: async () => [exePath], _queryProtocol: noneOne });
    assert.deepEqual(result, { exePath, source: 'gog-registration' });
});

test('GOG falls back to its registered protocol when app registration is unavailable', async () => {
    const exePath = 'R:\\Portable Apps\\GalaxyClient.exe';
    const result = await resolver.resolveLauncher('gog', { ...noMachine, _fileExists: existsOnly(exePath), _queryGogRegistration: none, _queryProtocol: async () => exePath });
    assert.deepEqual(result, { exePath, source: 'protocol' });
});

test('GOG ignores stale registration and continues to a supported fallback', async () => {
    const stale = 'D:\\Old Galaxy\\GalaxyClient.exe';
    const current = 'E:\\Games\\GOG Galaxy\\GalaxyClient.exe';
    const result = await resolver.resolveLauncher('gog', { ...noMachine, _fileExists: existsOnly(current), _queryGogRegistration: async () => [stale], _queryProtocol: async () => current });
    assert.deepEqual(result, { exePath: current, source: 'protocol' });
});

test('GOG reports not installed in a clean machine-independent environment', async () => {
    const result = await resolver.resolveLauncher('gog', { ...noMachine, _fileExists: () => false, _queryGogRegistration: none, _queryProtocol: noneOne });
    assert.equal(result, null);
});

test('GOG open rejects when the OS launch call rejects', async () => {
    const spec = { exePath: 'X:\\GOG\\GalaxyClient.exe', args: [], source: 'protocol' };
    await assert.rejects(() => launchResolvedLauncher('gog', spec, { exists: () => true, launchExecutable: async () => ({ ok: false, error: new Error('ENOENT') }), log: { info() {} } }), { code: 'LAUNCH_FAILED' });
});

test('GOG open succeeds only after Windows emits spawn', async () => {
    const spec = { exePath: 'Y:\\GOG\\GalaxyClient.exe', args: [], source: 'gog-registration' };
    const diagnostics = [];
    let launchOptions;
    const result = await launchResolvedLauncher('gog', spec, { exists: () => true, launchExecutable: async (_exe, _args, options) => { launchOptions = options; return { ok: true, pid: 42 }; }, log: { info: message => diagnostics.push(message) } });
    assert.deepEqual(result, { ok: true, method: 'executable', source: 'gog-registration' });
    assert.equal(launchOptions.requireSpawnConfirmation, true);
    assert.match(diagnostics.join('\n'), /\[GOG_OPEN\].*launchResult=success/);
    assert.doesNotMatch(diagnostics.join('\n'), /Y:\\GOG|GalaxyClient\.exe/);
});

test('GOG open rejects a stale resolved executable before spawn', async () => {
    let launched = false;
    await assert.rejects(() => launchResolvedLauncher('gog', { exePath: 'Z:\\Gone\\GalaxyClient.exe', source: 'manual' }, { exists: () => false, launchExecutable: async () => { launched = true; }, log: { info() {} } }), { code: 'LAUNCHER_NOT_FOUND' });
    assert.equal(launched, false);
});
