'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const resolver = require('../services/launcherPathResolver');
const none = async () => [];
const base = { _readManualPath: async () => null, _queryGogRegistration: none,
    _queryProtocol: async () => null, _queryRegistry: none, _queryShortcuts: none,
    _findRunning: async () => null, _getDrives: none, _probeTimeoutMs: 20 };
const hung = () => new Promise(() => {});

test('GOG finds custom Unicode shortcut despite hung registry and drive providers', async () => {
    const exePath = 'V:\\ألعابي\\Clients\\GalaxyClient.exe';
    const result = await resolver.resolveLauncher('gog', { ...base,
        _queryRegistry: hung, _getDrives: hung, _queryShortcuts: async () => [exePath],
        _fileExists: p => p === exePath });
    assert.deepEqual(result, { exePath, source: 'shortcut' });
});
test('GOG terminates discovery when all providers stall', async () => {
    const result = await resolver.resolveLauncher('gog', { ...base, _fileExists: () => false,
        _queryGogRegistration: hung, _queryProtocol: hung, _queryRegistry: hung,
        _queryShortcuts: hung, _findRunning: hung, _getDrives: hung });
    assert.equal(result, null);
});
test('GOG discovers a running executable at arbitrary depth after stale saved path', async () => {
    const exePath = 'S:\\a\\b\\c\\d\\GalaxyClient.exe';
    assert.deepEqual(await resolver.resolveLauncher('gog', { ...base,
        _readManualPath: async () => 'D:\\deleted\\GalaxyClient.exe',
        _fileExists: p => p === exePath, _findRunning: async () => exePath }),
    { exePath, source: 'running-process' });
});
test('GOG expands environment-based registration paths', async () => {
    const previous = process.env.BADDEL_GOG_TEST_ROOT;
    process.env.BADDEL_GOG_TEST_ROOT = 'T:\\Custom Apps';
    try {
        const exePath = 'T:\\Custom Apps\\GalaxyClient.exe';
        const result = await resolver.resolveLauncher('gog', { ...base,
            _queryGogRegistration: async () => ['%BADDEL_GOG_TEST_ROOT%\\GalaxyClient.exe'],
            _fileExists: p => p === exePath });
        assert.equal(result.exePath, exePath);
    } finally {
        if (previous === undefined) delete process.env.BADDEL_GOG_TEST_ROOT;
        else process.env.BADDEL_GOG_TEST_ROOT = previous;
    }
});
