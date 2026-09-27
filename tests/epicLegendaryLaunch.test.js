'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EpicLegendaryRuntimeService } = require('../src/features/downloads/infrastructure/providers/epic/EpicLegendaryRuntimeService');

test('launching as another owning account imports the existing path before launch', async () => {
    const calls = [];
    let installed = null;
    const service = new EpicLegendaryRuntimeService({ projectRoot: process.cwd() });
    service.findInstalled = () => installed;
    service.run = async (args, configPath) => {
        calls.push({ args, configPath });
        if (args[1] === 'import') installed = { app_name: 'TestApp', install_path: 'D:\\Games\\Test' };
        return { code: 0 };
    };
    const result = await service.launch({ appName: 'TestApp', installPath: 'D:\\Games\\Test', configPath: 'C:\\UserData\\legendary-config-owner-b' });
    assert.equal(result.imported, true);
    assert.equal(calls[0].args[1], 'import');
    assert.deepEqual(calls[0].args.slice(2, 4), ['TestApp', 'D:\\Games\\Test']);
    assert.deepEqual(calls[1].args, ['launch', 'TestApp', '--skip-version-check']);
    assert.equal(calls.every(call => call.configPath.endsWith('legendary-config-owner-b')), true);
});
