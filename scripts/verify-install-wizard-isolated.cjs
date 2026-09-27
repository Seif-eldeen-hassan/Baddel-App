'use strict';
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert/strict');
const { EventEmitter } = require('events');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-install-wizard-'));
const real = path.join(process.env.APPDATA, 'baddel-launcher-beta');
app.setPath('userData', temp); app.commandLine.appendSwitch('disable-gpu');
for (const channel of ['get-image-cache-dir-url-sync', 'get-artwork-cache-dir-url-sync', 'get-user-artwork-dir-url-sync']) ipcMain.on(channel, event => { event.returnValue = require('url').pathToFileURL(temp + path.sep).href; });
setTimeout(() => { console.error('Wizard acceptance deadline exceeded'); app.exit(2); }, 150000).unref();

const { EpicLegendaryAccountResolver } = require('../src/features/downloads/infrastructure/providers/epic/EpicLegendaryAccountResolver');
const { EpicLegendaryRuntimeService } = require('../src/features/downloads/infrastructure/providers/epic/EpicLegendaryRuntimeService');
const { EpicLegendarySizeResolver } = require('../src/features/downloads/infrastructure/providers/epic/EpicLegendarySizeResolver');
const { DownloadInstallPlanService } = require('../src/features/downloads/infrastructure/services/DownloadInstallPlanService');
const { DownloadFileSafetyService } = require('../src/features/downloads/infrastructure/services/DownloadFileSafetyService');
const { registerDownloadsIpc } = require('../src/features/downloads/infrastructure/ipc/downloads.ipc');
const read = name => JSON.parse(fs.readFileSync(path.join(real, 'platform-sync', name), 'utf8'));
const connector = { getAccounts: () => read('epic_accounts.json'), getCachedLibrary: async () => read('epic_library_merged.json') };
const queueFile = path.join(real, 'downloads', 'downloads-queue.json');
const queueBefore = fs.readFileSync(queueFile, 'utf8');
const accountResolver = new EpicLegendaryAccountResolver({ userDataDir: real, epicConnector: connector });
const runtime = new EpicLegendaryRuntimeService({ projectRoot: root });
let infoCalls = 0, installCommands = 0;
const spawn = runtime.createProcess.bind(runtime);
runtime.createProcess = (args, config) => { if (args[0] === 'info') infoCalls++; else installCommands++; return spawn(args, config); };
const resolver = new EpicLegendarySizeResolver({ runtimeService: runtime, accountResolver });
const installPlanService = new DownloadInstallPlanService({ fileSafety: new DownloadFileSafetyService(),
    getDrives: async () => ['F:\\', 'D:\\'].map(value => ({ path: value, label: 'Local Disk' })),
    resolveSizes: payload => resolver.resolve(payload) });
const snapshot = { tasks: [], settings: { keepCompletedHistory: true } };
let win;
const handlers = new Set();
registerDownloadsIpc({ handle(channel, fn) { handlers.add(channel); ipcMain.handle(channel, fn); } }, { container: {
    queueManager: Object.assign(new EventEmitter(), { getSnapshot: () => snapshot }), useCases: { getSnapshot: { execute: async () => snapshot } },
    epicAccountResolver: accountResolver, installPlanService,
}, getMainWindow: () => win });
for (const match of fs.readFileSync(path.join(root, 'preload.js'), 'utf8').matchAll(/ipcRenderer\.invoke\(['"]([^'"]+)['"]/g)) {
    const channel = match[1]; if (handlers.has(channel)) continue; handlers.add(channel);
    ipcMain.handle(channel, async () => {
        if (/get.*accounts|saved-games|all-games/i.test(channel)) return [];
        if (/epic.*launcher.*avail/i.test(channel)) return { available: true };
        return { status: 'error', message: 'Read-only isolated acceptance' };
    });
}
const evidence = { capturedAt: new Date().toISOString(), mode: 'Hidden isolated Electron profile; production dashboard/preload/install-plan IPC; real Epic account/config and read-only Legendary info.', page1: [], page2: [], back: null, official: null };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
    await app.whenReady();
    win = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: { preload: path.join(root, 'preload.js'), contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false } });
    await win.loadFile(path.join(root, 'src/dashboard.html'));
    const evaluate = expression => win.webContents.executeJavaScript(expression, true);
    const shot = async name => fs.writeFileSync(path.join(root, 'docs', `${name}.png`), (await win.webContents.capturePage()).toPNG());
    await evaluate(`document.getElementById('mainLoader')?.remove();window._stopSplashCanvas?.();`);
    const game = (await connector.getCachedLibrary()).find(item => item.appName === 'd86f9cb568014746a15f66025dcc5733'); assert.ok(game);
    await evaluate(`(async()=>{await _gdOpenInstallPickerForGame(${JSON.stringify({ ...game, platform: 'epic', platforms: ['epic'] })});await gdInstallSelectProvider('legendary');for(let i=0;i<80&&!_gdInstallSelectedAccountId;i++)await new Promise(r=>setTimeout(r,100));})()`);
    for (const [width, height] of [[1280,720],[1280,800],[900,700]]) {
        win.setContentSize(width, height); await sleep(80);
        const state = await evaluate(`(()=>{const m=document.getElementById('gdInstallModalInner'),b=m.getBoundingClientRect(),body=m.querySelector('.pl-body');return {viewport:[innerWidth,innerHeight],rect:{x:b.x,y:b.y,width:b.width,height:b.height,bottom:b.bottom},bodyOverflow:body.scrollHeight>body.clientHeight+1,setupVisible:!document.getElementById('gdInstallSetupPage').hidden,storageVisible:!document.getElementById('gdInstallStorageSection').hidden,footer:[...m.querySelectorAll('.pl-footer button:not([hidden])')].map(x=>x.innerText.trim()),account:_gdInstallSelectedAccountId};})()`);
        assert.deepEqual(state.footer, ['Cancel','Continue']); assert.equal(state.setupVisible,true); assert.equal(state.storageVisible,false); assert.equal(state.bodyOverflow,false); assert.ok(state.rect.y>=0&&state.rect.bottom<=state.viewport[1]); evidence.page1.push(state);
    }
    await shot('install-wizard-page-1');
    await evaluate(`gdInstallContinue()`);
    await evaluate(`(async()=>{for(let i=0;i<100&&!document.querySelector('#gdInstallDrives [data-root]');i++)await new Promise(r=>setTimeout(r,100));document.querySelector('#gdInstallDrives [data-root^="F:"]')?.click();for(let i=0;i<700;i++){await new Promise(r=>setTimeout(r,100));const t=document.getElementById('gdInstallPlanSummary')?.innerText||'';if(t&&!t.includes('Checking storage')&&!t.includes('Choose a drive'))break;}})()`);
    for (const [width, height] of [[1280,720],[1280,800],[900,700]]) {
        win.setContentSize(width, height); await sleep(80);
        const state = await evaluate(`(()=>{const m=document.getElementById('gdInstallModalInner'),b=m.getBoundingClientRect(),body=m.querySelector('.pl-body');return {viewport:[innerWidth,innerHeight],rect:{y:b.y,bottom:b.bottom},bodyOverflow:body.scrollHeight>body.clientHeight+1,setupVisible:!document.getElementById('gdInstallSetupPage').hidden,storageVisible:!document.getElementById('gdInstallStorageSection').hidden,footer:[...m.querySelectorAll('.pl-footer button:not([hidden])')].map(x=>x.innerText.trim()),summary:document.getElementById('gdInstallPlanSummary').innerText,installDisabled:document.getElementById('gdInstallConfirmBtn').disabled,path:document.getElementById('gdInstallFolder').value};})()`);
        assert.deepEqual(state.footer,['Back','Install']); assert.equal(state.setupVisible,false); assert.equal(state.storageVisible,true); assert.equal(state.installDisabled,false); assert.ok(!state.summary.includes('Unavailable')); assert.ok(state.rect.y>=0&&state.rect.bottom<=state.viewport[1]); evidence.page2.push(state);
    }
    await shot('install-wizard-page-2-enough');
    await evaluate(`document.querySelector('#gdInstallDrives [data-root^="D:"]')?.click()`); await sleep(500);
    evidence.insufficient = await evaluate(`({summary:document.getElementById('gdInstallPlanSummary').innerText,installDisabled:document.getElementById('gdInstallConfirmBtn').disabled})`);
    assert.equal(evidence.insufficient.installDisabled,true); assert.match(evidence.insufficient.summary,/Not enough space/); await shot('install-wizard-page-2-insufficient');
    evidence.back = await evaluate(`(()=>{const before=_gdInstallSelectedAccountId;gdInstallBack();return {before,after:_gdInstallSelectedAccountId,setupVisible:!document.getElementById('gdInstallSetupPage').hidden,storageVisible:!document.getElementById('gdInstallStorageSection').hidden,footer:[...document.querySelectorAll('#gdInstallerModal .pl-footer button:not([hidden])')].map(x=>x.innerText.trim())};})()`);
    assert.equal(evidence.back.before,evidence.back.after); assert.equal(evidence.back.setupVisible,true); assert.equal(evidence.back.storageVisible,false);
    await evaluate(`(async()=>{await gdInstallSelectProvider('epic_launcher');for(let i=0;i<80&&!document.querySelector('#gdInstallAccountsList [data-id="__none__"]');i++)await new Promise(r=>setTimeout(r,100));document.querySelector('#gdInstallAccountsList [data-id="__none__"]')?.click();window.__officialConfirmed=false;window.gdInstallConfirm=async()=>{window.__officialConfirmed=true};await gdInstallContinue();})()`);
    evidence.official = await evaluate(`({confirmed:window.__officialConfirmed,storageVisible:!document.getElementById('gdInstallStorageSection').hidden,page:_gdInstallWizardPage})`);
    assert.equal(evidence.official.confirmed,true); assert.equal(evidence.official.storageVisible,false); assert.equal(evidence.official.page,'setup');
    await evaluate(`gdInstallClose()`);
    assert.equal(fs.readFileSync(queueFile,'utf8'),queueBefore); evidence.queueUnchanged=true; evidence.infoCalls=infoCalls; evidence.installCommands=installCommands;
    evidence.gameFoldersCreated = fs.existsSync('F:\\Baddel Games\\3 out of 10 EP3 diagnostic-only') ? 1 : 0;
    assert.equal(installCommands,0); assert.equal(evidence.gameFoldersCreated,0);
}
main().then(()=>console.log(JSON.stringify(evidence,null,2))).catch(error=>{evidence.error=error.stack;console.error(error.stack);process.exitCode=1;}).finally(()=>{fs.writeFileSync(path.join(root,'docs','install-wizard-isolated-evidence.json'),JSON.stringify(evidence,null,2));win?.destroy();app.exit(process.exitCode||0);});
