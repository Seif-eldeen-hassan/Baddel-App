'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { EpicLegendarySizeResolver, parseLegendaryInfo, selectionKey } = require('../src/features/downloads/infrastructure/providers/epic/EpicLegendarySizeResolver');
const { EpicLegendaryRuntimeService } = require('../src/features/downloads/infrastructure/providers/epic/EpicLegendaryRuntimeService');
const download = Math.round(574.14 * 1024 * 1024), installed = Math.round(655.78 * 1024 * 1024);
const info = () => ({ game: { app_name: 'app', is_dlc: false, platform_versions: { Windows: 'v1' } }, manifest: { app_name: 'shared-app', build_version: 'v1', build_id: 'build1', download_size: download, disk_size: installed, install_tags: [''] } });
const task = { platform: 'epic', installProvider: 'legendary', providerAppName: 'app', accountId: 'owner1' };
function harness(options = {}) {
    const calls = []; let kills = 0, now = 1000, authError = null;
    const runtimeService = { createProcess(args, config) {
        calls.push({ args, config }); const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
        queueMicrotask(() => {
            if (options.hang || (options.timeoutOnce && calls.length === 1)) return;
            child.stdout.emit('data', options.stdout ?? JSON.stringify(info()));
            child.stderr.emit('data', options.stderr || ''); child.emit('close', options.code || 0);
        }); return child;
    }, terminateProcess() { kills++; } };
    const accountResolver = { async validateTask(value) {
        if (authError) throw Object.assign(new Error('access_token=SECRET'), { code: authError });
        return { account: { id: value.accountId }, appName: 'app', configPath: 'C:/existing/legendary-config-' + value.accountId };
    } };
    const fsSync = { statSync: () => ({ size: 100 }), readFileSync: () => options.config || '[Legendary]\nlocale = en-US' };
    const resolver = new EpicLegendarySizeResolver({ runtimeService, accountResolver, fsSync, now: () => now, timeoutMs: 20, retryTimeoutMs: 20, retryDelayMs: 0, maxOutputBytes: options.maxOutputBytes || 4096 });
    return { resolver, calls, get kills() { return kills; }, advance() { now += 25 * 60 * 60 * 1000; }, expireAuth(code = 'EPIC_AUTH_REQUIRED') { authError = code; } };
}
test('real info schema yields separate exact compressed and installed sizes, not manifest app-name alias', () => {
    const value = parseLegendaryInfo(info(), 'app');
    assert.equal(value.downloadSizeBytes, download); assert.equal(value.installedDiskSizeBytes, installed); assert.notEqual(download, installed);
    assert.equal(value.sizeSource, 'legendary-info-manifest'); assert.equal(value.buildVersion, 'v1');
});
test('read-only supported Windows info uses exact resolved owning account config', async () => {
    const h = harness(); const value = await h.resolver.resolve(task);
    assert.ok(value.downloadSizeBytes); assert.deepEqual(h.calls[0], { args: ['info', 'app', '--json', '--platform', 'Windows'], config: 'C:/existing/legendary-config-owner1' });
});
test('runtime uses argument arrays, no shell, hidden window, same LEGENDARY_CONFIG_PATH', () => {
    let observed; const runtime = new EpicLegendaryRuntimeService({ spawnFn: (...args) => { observed = args; return {}; } });
    runtime.getRuntime = () => ({ legendaryPath: 'C:/bundled/legendary.exe' });
    runtime.createProcess(['info', 'app', '--json', '--platform', 'Windows'], 'C:/account');
    assert.equal(observed[2].shell, false); assert.equal(observed[2].windowsHide, true); assert.equal(observed[2].env.LEGENDARY_CONFIG_PATH, 'C:/account');
});
test('cache reuses metadata across partitions for 24 hours, then expires, and isolates accounts', async () => {
    const h = harness(); await h.resolver.resolve({ ...task, installPath: 'F:/Game' }); await h.resolver.resolve({ ...task, installPath: 'D:/Game' });
    assert.equal(h.calls.length, 1); await h.resolver.resolve({ ...task, accountId: 'owner2' }); assert.equal(h.calls.length, 2);
    assert.notEqual(h.calls[0].config, h.calls[1].config); h.advance(); await h.resolver.resolve(task); assert.equal(h.calls.length, 3);
});
test('concurrent path changes share the in-flight metadata probe', async () => {
    const h = harness(); const one = h.resolver.resolve(task); const two = h.resolver.resolve({ ...task, installPath: 'D:/Game' });
    await one; await two; assert.equal(h.calls.length, 1);
});
test('language, SDL, tags, DLC, build and account affect metadata key, path does not', () => {
    const resolved = { account: { id: 'owner1' }, appName: 'app' }; const key = selectionKey(task, resolved, null);
    for (const change of [{ language: 'fr-FR' }, { sdlPolicy: 'custom' }, { installTags: ['French'] }, { dlcPolicy: 'all' }, { buildId: 'new' }, { targetPlatform: 'Mac' }]) assert.notEqual(selectionKey({ ...task, ...change }, resolved, null), key);
    assert.notEqual(selectionKey(task, resolved, ['French']), key); assert.equal(selectionKey({ ...task, installPath: 'F:/Game' }, resolved, null), key);
});
for (const [name, mutate, reason] of [
    ['unsupported schema', i => { i.manifest.download_size = '123'; }, 'EPIC_MANIFEST_SCHEMA_UNSUPPORTED'],
    ['missing manifest', i => { i.manifest = null; }, 'EPIC_MANIFEST_UNAVAILABLE'],
    ['wrong app', i => { i.game.app_name = 'other'; }, 'EPIC_INFO_IDENTITY_MISMATCH'],
    ['wrong platform version', i => { i.game.platform_versions = { Mac: 'v1' }; }, 'EPIC_MANIFEST_VERSION_MISMATCH'],
    ['DLC', i => { i.game.is_dlc = true; }, 'EPIC_SELECTION_SIZE_AMBIGUOUS'],
    ['tagged manifest cannot be summed', i => { i.manifest.install_tags = ['', 'French']; }, 'EPIC_SELECTION_SIZE_AMBIGUOUS'],
]) test(name, () => { const i = info(); mutate(i); const value = parseLegendaryInfo(i, 'app'); assert.equal(value.sizeReason, reason); assert.equal(value.downloadSizeBytes, null); });
test('configured install tags do not silently use full or partial totals', async () => {
    const h = harness({ config: '[app]\ninstall_tags = French' }); assert.equal((await h.resolver.resolve(task)).sizeReason, 'EPIC_SELECTION_SIZE_AMBIGUOUS');
});
for (const [name, options, reason] of [
    ['malformed JSON', { stdout: '{access_token=SECRET' }, 'EPIC_INFO_JSON_INVALID'],
    ['oversized stdout', { stdout: 'SECRET'.repeat(1000), maxOutputBytes: 200 }, 'EPIC_INFO_OUTPUT_TOO_LARGE'],
    ['oversized stderr', { stderr: 'SECRET'.repeat(1000), maxOutputBytes: 200 }, 'EPIC_INFO_OUTPUT_TOO_LARGE'],
    ['timeout', { hang: true }, 'EPIC_INFO_TIMEOUT'],
    ['runtime auth expiry', { stderr: '[cli] ERROR: Invalid access_token=SECRET', code: 1 }, 'EPIC_AUTH_REQUIRED'],
    ['runtime not owned', { stderr: '[cli] ERROR: You do not own this game', code: 1 }, 'EPIC_GAME_NOT_OWNED'],
]) test(name + ' is bounded and never exposes provider output', async () => {
    const h = harness(options); const value = await h.resolver.resolve(task); assert.equal(value.sizeReason, reason); assert.ok(!JSON.stringify(value).includes('SECRET'));
    if (name === 'timeout') assert.equal(h.kills, 1);
    else if (/oversized/.test(name)) assert.equal(h.kills, 1);
});
test('a slow metadata timeout is not destructively restarted', async () => {
    const h = harness({ timeoutOnce: true });
    const value = await h.resolver.resolve(task);
    assert.equal(h.calls.length, 1); assert.equal(h.kills, 1);
    assert.equal(value.sizeReason, 'EPIC_INFO_TIMEOUT');
});
for (const code of ['EPIC_AUTH_REQUIRED', 'EPIC_GAME_NOT_OWNED']) test(code + ' checked before even cached metadata', async () => {
    const h = harness(); await h.resolver.resolve(task); h.expireAuth(code); assert.equal((await h.resolver.resolve(task)).sizeReason, code); assert.equal(h.calls.length, 1);
});

