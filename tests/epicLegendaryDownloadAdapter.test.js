'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { EpicLegendaryDownloadAdapter } = require('../src/features/downloads/infrastructure/providers/epic/EpicLegendaryDownloadAdapter');
const { EpicLegendaryRuntimeService } = require('../src/features/downloads/infrastructure/providers/epic/EpicLegendaryRuntimeService');

function childProcess() {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.pid = 4321;
    child.kill = () => { setImmediate(() => child.emit('close', null, 'SIGTERM')); return true; };
    return child;
}

function task(installPath, accountId = 'account-a') {
    return { id: 'dl_0123456789abcdef', platform: 'epic', installProvider: 'legendary', accountId, title: 'Test Game', appName: 'TestApp', providerAppName: 'TestApp', installPath };
}

test('adapter spawns Legendary, reports progress, and verifies installed.json plus disk', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-epic-adapter-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const installPath = path.join(dir, 'Test Game');
    const child = childProcess();
    const calls = [];
    const runtime = {
        createProcess(args, configPath) { calls.push({ args, configPath }); return child; },
        findInstalled: () => ({ app_name: 'TestApp', install_path: installPath, version: 'build-7' }),
        installationPath: record => record.install_path,
    };
    const adapter = new EpicLegendaryDownloadAdapter({ runtimeService: runtime, accountResolver: { validateTask: async value => ({ account: { id: value.accountId }, appName: 'TestApp', configPath: path.join(dir, 'legendary-config-account-a') }) } });
    const progress = [];
    const running = adapter.start(task(installPath), { onProgress: event => progress.push(event) });
    await new Promise(resolve => setImmediate(resolve));
    child.stdout.emit('data', 'Progress: 50.00% (1.00 GiB / 2.00 GiB), ETA: 00:00:30\n');
    fs.mkdirSync(installPath, { recursive: true });
    fs.writeFileSync(path.join(installPath, 'TestGame.exe'), Buffer.alloc(64));
    child.emit('close', 0, null);
    const receipt = await running;
    assert.deepEqual(calls[0].args.slice(0, 3), ['-y', 'install', 'TestApp']);
    assert.equal(calls[0].args.includes('--game-folder'), true);
    assert.equal(progress.some(event => event.progressPercent === 50), true);
    assert.equal(receipt.verification.status, 'passed');
    assert.equal(receipt.buildId, 'build-7');
});

test('pause stops the current process and resume starts the same account/path again', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-epic-resume-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const children = [childProcess(), childProcess()];
    const calls = [];
    const runtime = { createProcess(args, configPath) { calls.push({ args, configPath }); return children.shift(); }, findInstalled: () => null, installationPath: () => null };
    const adapter = new EpicLegendaryDownloadAdapter({ runtimeService: runtime, accountResolver: { validateTask: async value => ({ account: { id: value.accountId }, appName: 'TestApp', configPath: path.join(dir, `legendary-config-${value.accountId}`) }) } });
    const first = adapter.start(task(path.join(dir, 'Game'))).catch(error => error.code);
    await new Promise(resolve => setImmediate(resolve));
    await adapter.pause('dl_0123456789abcdef');
    assert.equal(await first, 'EPIC_DOWNLOAD_STOPPED');
    const second = adapter.start(task(path.join(dir, 'Game'))).catch(error => error.code);
    await new Promise(resolve => setImmediate(resolve));
    await adapter.cancel('dl_0123456789abcdef');
    assert.equal(await second, 'EPIC_DOWNLOAD_STOPPED');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].configPath, calls[1].configPath);
    assert.deepEqual(calls[0].args, calls[1].args);
});

test('runtime service uses argument arrays, shell false, hidden window, and isolated config env', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-legendary-runtime-'));
    try {
        fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
        fs.writeFileSync(path.join(root, 'bin', 'legendary.exe'), 'fixture');
        let call;
        const service = new EpicLegendaryRuntimeService({ projectRoot: root, spawnFn: (exe, args, options) => { call = { exe, args, options }; return childProcess(); } });
        service.createProcess(['install', 'TestApp'], path.join(root, 'legendary-config-a'));
        assert.deepEqual(call.args, ['install', 'TestApp']);
        assert.equal(call.options.shell, false);
        assert.equal(call.options.windowsHide, true);
        assert.equal(call.options.env.LEGENDARY_CONFIG_PATH, path.join(root, 'legendary-config-a'));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('non-owner validation failure occurs before Legendary is spawned', async () => {
    let spawned = false;
    const adapter = new EpicLegendaryDownloadAdapter({ runtimeService: { createProcess() { spawned = true; } }, accountResolver: { validateTask: async () => { const error = new Error('not owned'); error.code = 'EPIC_GAME_NOT_OWNED'; throw error; } } });
    await assert.rejects(() => adapter.start(task('C:\\Games\\Test')), error => error.code === 'EPIC_GAME_NOT_OWNED');
    assert.equal(spawned, false);
});


test('Epic maintenance uses the bundled Legendary update and repair flags', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-epic-maintenance-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    for (const [operationKind, expectedFlag] of [['update', '--update-only'], ['repair', '--repair']]) {
        const installPath = path.join(dir, operationKind);
        const child = childProcess();
        const calls = [];
        const runtime = {
            createProcess(args, configPath) { calls.push({ args, configPath }); return child; },
            findInstalled: () => ({ app_name: 'TestApp', install_path: installPath, version: 'build-8' }),
            installationPath: record => record.install_path,
        };
        const adapter = new EpicLegendaryDownloadAdapter({ runtimeService: runtime, accountResolver: { validateTask: async () => ({ appName: 'TestApp', configPath: path.join(dir, 'config') }) } });
        const running = adapter.start({ ...task(installPath), operationKind });
        await new Promise(resolve => setImmediate(resolve));
        fs.mkdirSync(installPath, { recursive: true });
        fs.writeFileSync(path.join(installPath, 'Game.exe'), Buffer.alloc(64));
        child.emit('close', 0, null);
        await running;
        assert.equal(calls[0].args.includes(expectedFlag), true);
    }
});

test('Epic update check compares Legendary installed.json with remote provider version', async () => {
    const installPath = path.resolve('C:\\Games\\Test');
    const runtime = {
        findInstalled: () => ({ app_name: 'TestApp', install_path: installPath, version: 'build-7' }),
        installationPath: record => record.install_path,
        getGameInfo: async () => ({ game: { platform_versions: { Windows: 'build-8' } } }),
    };
    const adapter = new EpicLegendaryDownloadAdapter({ runtimeService: runtime, accountResolver: { validateTask: async () => ({ appName: 'TestApp', configPath: path.resolve('config') }) } });
    const result = await adapter.checkForUpdate(task(installPath));
    assert.equal(result.installedBuildId, 'build-7');
    assert.equal(result.targetBuildId, 'build-8');
    assert.equal(result.updateAvailable, true);
});

test('Epic repair imports a proven installation into the exact account config before spawning', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-epic-repair-import-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const installPath = path.join(dir, 'Game'); fs.mkdirSync(installPath);
    const configPath = path.join(dir, 'legendary-config-owner-a');
    const child = childProcess();
    const calls = [];
    let installed = null;
    const runtime = {
        findInstalled: () => installed,
        installationPath: record => record.install_path,
        async ensureImported(args) { calls.push({ type: 'import', ...args }); installed = { app_name: 'TestApp', install_path: installPath, version: 'build-1' }; return { imported: true, record: installed }; },
        createProcess(args, config) { calls.push({ type: 'spawn', args, config }); return child; },
    };
    const adapter = new EpicLegendaryDownloadAdapter({ runtimeService: runtime, accountResolver: { validateTask: async () => ({ appName: 'TestApp', configPath }) } });
    const running = adapter.start({ ...task(installPath, 'owner-a'), operationKind: 'repair' });
    await new Promise(resolve => setImmediate(resolve));
    fs.writeFileSync(path.join(installPath, 'Game.exe'), Buffer.alloc(64));
    child.emit('close', 0, null);
    await running;
    assert.equal(calls[0].type, 'import');
    assert.equal(calls[0].configPath, configPath);
    assert.equal(calls[0].installPath, installPath);
    assert.equal(calls[1].type, 'spawn');
    assert.ok(calls[1].args.includes('--repair'));
});

test('Epic installed record path mismatch blocks repair before provider spawn', async () => {
    let spawned = false;
    const installPath = path.resolve('C:\\Games\\Expected');
    const adapter = new EpicLegendaryDownloadAdapter({
        runtimeService: {
            findInstalled: () => ({ app_name: 'TestApp', install_path: path.resolve('C:\\Games\\Different') }),
            installationPath: record => record.install_path,
            createProcess() { spawned = true; },
        },
        accountResolver: { validateTask: async () => ({ appName: 'TestApp', configPath: path.resolve('config') }) },
    });
    await assert.rejects(
        () => adapter.start({ ...task(installPath), operationKind: 'repair' }),
        error => error.code === 'EPIC_INSTALL_PATH_MISMATCH'
    );
    assert.equal(spawned, false);
});
