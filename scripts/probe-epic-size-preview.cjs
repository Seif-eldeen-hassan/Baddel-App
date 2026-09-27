'use strict';
// Read-only source-runtime acceptance. Never invokes install or creates game folders.
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { EpicLegendaryAccountResolver } = require('../src/features/downloads/infrastructure/providers/epic/EpicLegendaryAccountResolver');
const { EpicLegendaryRuntimeService } = require('../src/features/downloads/infrastructure/providers/epic/EpicLegendaryRuntimeService');
const { EpicLegendarySizeResolver } = require('../src/features/downloads/infrastructure/providers/epic/EpicLegendarySizeResolver');
const { DownloadInstallPlanService } = require('../src/features/downloads/infrastructure/services/DownloadInstallPlanService');
const { DownloadFileSafetyService } = require('../src/features/downloads/infrastructure/services/DownloadFileSafetyService');
async function main() {
    const userDataDir = path.join(process.env.APPDATA, 'baddel-launcher-beta');
    const read = name => JSON.parse(fs.readFileSync(path.join(userDataDir, 'platform-sync', name), 'utf8'));
    const epicConnector = { getAccounts: () => read('epic_accounts.json'), getCachedLibrary: async () => read('epic_library_merged.json') };
    const accountResolver = new EpicLegendaryAccountResolver({ userDataDir, epicConnector });
    const appName = 'd86f9cb568014746a15f66025dcc5733';
    const game = (await epicConnector.getCachedLibrary()).find(game => game.appName === appName || game.providerAppName === appName);
    assert.ok(game, 'Probe game must exist in the real synced library');
    const owner = (await accountResolver.resolveOptions(game)).find(account => account.enabled);
    assert.ok(owner, 'Probe requires a currently authenticated owning synced account');
    const payload = { ...game, platform: 'epic', installProvider: 'legendary', providerAppName: appName, accountId: owner.id };
    const runtimeService = new EpicLegendaryRuntimeService({ projectRoot: path.resolve(__dirname, '..') });
    let calls = 0;
    const spawn = runtimeService.createProcess.bind(runtimeService);
    runtimeService.createProcess = (args, config) => { assert.deepEqual(args, ['info', appName, '--json', '--platform', 'Windows']); calls++; return spawn(args, config); };
    const resolver = new EpicLegendarySizeResolver({ runtimeService, accountResolver, timeoutMs: 30000 });
    const resolved = await accountResolver.validateTask(payload);
    const raw = await resolver.probe(resolved);
    assert.ok(raw.info, JSON.stringify(raw));
    const info = {
        game: { app_name: raw.info.game?.app_name, platform_versions: raw.info.game?.platform_versions, is_dlc: raw.info.game?.is_dlc },
        manifest: Object.fromEntries(['app_name', 'build_version', 'build_id', 'disk_size', 'download_size', 'install_tags', 'num_files', 'num_chunks'].map(key => [key, raw.info.manifest?.[key]])),
    };
    fs.writeFileSync(path.resolve('docs/epic-size-real-info.json'), JSON.stringify(info, null, 2));
    const fileSafety = new DownloadFileSafetyService();
    const planService = new DownloadInstallPlanService({ fileSafety, resolveSizes: value => resolver.resolve(value) });
    const plans = [];
    for (const drive of ['F:', 'D:']) {
        const installPath = path.join(drive + path.sep, 'Baddel-size-preview-observational', 'EP3');
        assert.equal(fs.existsSync(installPath), false);
        const plan = await planService.resolve({ ...payload, installPath });
        assert.equal(fs.existsSync(installPath), false);
        plans.push(plan);
    }
    const result = { capturedAt: new Date().toISOString(), info, plans, infoCalls: calls, gameFoldersCreated: 0, installCommands: 0 };
    fs.writeFileSync(path.resolve('docs/epic-size-live-preview.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
    assert.ok(plans.every(plan => plan.downloadSizeBytes > 0 && plan.installedDiskSizeBytes > 0));
    assert.equal(calls, 2, 'One raw evidence probe plus one cached plan probe');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
