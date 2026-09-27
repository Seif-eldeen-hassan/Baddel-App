'use strict';
// Original dashboard/preload + production Downloads IPC in an isolated Electron
// profile. Only read-only handlers are operational; install/switch/delete cannot run.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert/strict');
const { EventEmitter } = require('events');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-size-ui-'));
app.setPath('userData', temp);
for (const channel of ['get-image-cache-dir-url-sync', 'get-artwork-cache-dir-url-sync', 'get-user-artwork-dir-url-sync']) ipcMain.on(channel, event => { event.returnValue = require('url').pathToFileURL(temp + path.sep).href; });
setTimeout(() => { console.error('Isolated UI deadline exceeded'); app.exit(2); }, 90000).unref();
app.commandLine.appendSwitch('disable-gpu');
const { EpicLegendaryAccountResolver } = require('../src/features/downloads/infrastructure/providers/epic/EpicLegendaryAccountResolver');
const { EpicLegendaryRuntimeService } = require('../src/features/downloads/infrastructure/providers/epic/EpicLegendaryRuntimeService');
const { EpicLegendarySizeResolver } = require('../src/features/downloads/infrastructure/providers/epic/EpicLegendarySizeResolver');
const { DownloadInstallPlanService } = require('../src/features/downloads/infrastructure/services/DownloadInstallPlanService');
const { DownloadFileSafetyService } = require('../src/features/downloads/infrastructure/services/DownloadFileSafetyService');
const { registerDownloadsIpc } = require('../src/features/downloads/infrastructure/ipc/downloads.ipc');
const real = path.join(process.env.APPDATA, 'baddel-launcher-beta');
const read = name => JSON.parse(fs.readFileSync(path.join(real, 'platform-sync', name), 'utf8'));
const connector = { getAccounts: () => read('epic_accounts.json'), getCachedLibrary: async () => read('epic_library_merged.json') };
const queueFile = path.join(real, 'downloads', 'downloads-queue.json');
const queueBefore = fs.readFileSync(queueFile, 'utf8');
const task = JSON.parse(queueBefore).tasks.find(t => t.platform === 'epic' && t.status === 'completed');
assert.ok(task);
// Drop private ownership/diagnostic data; use real historical sizes and dates.
const publicTask = Object.fromEntries(['id','title','platform','installProvider','accountId','accountDisplayName','status','installPath','installedGameId','totalBytes','transferTotalBytes','expectedDownloadBytes','expectedInstalledBytes','verificationActualBytes','downloadSizeBytes','installedDiskSizeBytes','requiredSpaceBytes','freeSpaceBytesAtQueue','createdAt','completedAt','buildVersion','verifiedBuildId','downloadedBytes','progressPercent'].map(key => [key, task[key]]));
const snapshot = { tasks: [publicTask], settings: { keepCompletedHistory: true } };
let win, infoCalls = 0;
const accountResolver = new EpicLegendaryAccountResolver({ userDataDir: real, epicConnector: connector });
const runtime = new EpicLegendaryRuntimeService({ projectRoot: root });
const spawn = runtime.createProcess.bind(runtime);
runtime.createProcess = (args, config) => { assert.equal(args[0], 'info'); infoCalls++; return spawn(args, config); };
const sizeResolver = new EpicLegendarySizeResolver({ runtimeService: runtime, accountResolver });
const installPlanService = new DownloadInstallPlanService({ fileSafety: new DownloadFileSafetyService(), getDrives: async () => ['F:\\','D:\\'].map(p => ({ path: p, label: 'Local Disk' })), resolveSizes: payload => sizeResolver.resolve(payload) });
const handlers = new Set();
registerDownloadsIpc({ handle(channel, fn) { handlers.add(channel); ipcMain.handle(channel, fn); } }, { container: {
    queueManager: Object.assign(new EventEmitter(), { getSnapshot: () => snapshot }),
    useCases: { getSnapshot: { execute: async () => snapshot } }, epicAccountResolver: accountResolver, installPlanService,
}, getMainWindow: () => win });
// Non-download initialization calls get inert, typed responses. No OS actions.
for (const match of fs.readFileSync(path.join(root, 'preload.js'), 'utf8').matchAll(/ipcRenderer\.invoke\(['"]([^'"]+)['"]/g)) {
    const channel = match[1]; if (handlers.has(channel)) continue; handlers.add(channel);
    ipcMain.handle(channel, async () => {
        if (/get.*accounts|saved-games|all-games/i.test(channel)) return [];
        if (/epic.*launcher.*avail/i.test(channel)) return { available: true };
        return { status: 'error', message: 'Not operational in read-only UI acceptance' };
    });
}
const evidence = { capturedAt: new Date().toISOString(), mode: 'Isolated Electron profile loading original dashboard, preload and Downloads IPC. Real owning account/config and read-only Legendary metadata. Non-download bootstrap APIs are inert and the startup-only splash is removed in the fixture. No main-app restart.', dialogs: [] };
async function main() {
    await app.whenReady();
    win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { preload: path.join(root,'preload.js'), contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false } });
    await win.loadFile(path.join(root,'src/dashboard.html'));
    const evaluate = expression => win.webContents.executeJavaScript(expression, true);
    const shot = async name => fs.writeFileSync(path.join(root,'docs',name+'.png'), (await win.webContents.capturePage()).toPNG());
    await evaluate(`document.getElementById('mainLoader')?.remove();window._stopSplashCanvas?.();navigateToDownloads();`); await new Promise(resolve=>setTimeout(resolve,500));
    for(const [width,height,zoom] of [[1280,900,1],[1280,900,1.25],[1280,900,1.5],[640,480,1]]) {
        win.setContentSize(width,height); win.webContents.setZoomFactor(zoom);
        const record=await evaluate(`(async()=>{document.getElementById('downloadGameInfo')?.close(); const trigger=document.querySelector('.download-overflow-trigger');trigger.focus();downloadsGameInfo(${JSON.stringify(task.id)});await new Promise(r=>setTimeout(r,200));const d=document.getElementById('downloadGameInfo');const rect=e=>{const b=e.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height,bottom:b.bottom};};return {width:innerWidth,height:innerHeight,dialog:rect(d),body:rect(d.querySelector('.download-info-body')),footer:rect(d.querySelector('.download-info-footer')),close:rect(d.querySelector('button')),text:d.innerText};})()`);
        evidence.dialogs.push({...record,zoom});
        assert.ok(Math.abs(record.dialog.x+record.dialog.width/2-record.width/2)<2); assert.ok(Math.abs(record.dialog.y+record.dialog.height/2-record.height/2)<2);
        assert.ok(record.footer.y>=record.body.bottom); assert.ok(record.close.bottom<=record.dialog.bottom); assert.ok(record.dialog.y>=0&&record.dialog.bottom<=record.height);
        assert.ok(!record.text.includes('legendary')&&!record.text.includes('Install method')); assert.ok(!/Download size\s+Unavailable|Installed size\s+Unavailable/.test(record.text));
        await shot('epic-size-layout-'+width+'-'+zoom);
    }
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'}); win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'}); await new Promise(r=>setTimeout(r,100));
    evidence.escape=await evaluate(`({closed:!document.getElementById('downloadGameInfo'),focusRestored:document.activeElement.classList.contains('download-overflow-trigger')})`);
    assert.ok(evidence.escape.closed&&evidence.escape.focusRestored);
    win.setContentSize(1280,900);win.webContents.setZoomFactor(1);
    evidence.controls=await evaluate(`(()=>{const a=document.querySelector('.download-overflow-trigger'),b=a.querySelector('span'),x=a.getBoundingClientRect(),y=b.getBoundingClientRect();const trigger=document.querySelector('#downloadsPlatform [data-menu-trigger]');trigger.focus();trigger.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));const i=document.querySelector('#downloadsToolbar .dropdown-item.selected'),s=getComputedStyle(i);return {padding:getComputedStyle(a).padding,width:x.width,height:x.height,dx:y.x+y.width/2-x.x-x.width/2,dy:y.y+y.height/2-x.y-x.height/2,color:s.color,background:s.backgroundColor,checked:i.getAttribute('aria-checked'),open:trigger.getAttribute('aria-expanded')==='true'};})()`);
    assert.equal(evidence.controls.padding,'0px');assert.ok(Math.abs(evidence.controls.dx)<1&&Math.abs(evidence.controls.dy)<1);assert.equal(evidence.controls.checked,'true');assert.notEqual(evidence.controls.color,'rgb(61, 255, 110)');
    assert.equal(evidence.controls.open,true);await new Promise(r=>setTimeout(r,300));await shot('epic-size-layout-neutral'); await evaluate('baddelMenus.close();');
    const game=(await connector.getCachedLibrary()).find(g=>g.appName==='d86f9cb568014746a15f66025dcc5733'); assert.ok(game);
    await evaluate(`(async()=>{await _gdOpenInstallPickerForGame(${JSON.stringify({...game,platform:'epic',platforms:['epic']})});await gdInstallSelectProvider('legendary');})()`);
    evidence.legendary=await evaluate(`({hasNoSwitch:!!document.querySelector('#gdInstallAccountsList [data-id="__none__"]'),ownerSelected:!!_gdInstallSelectedAccountId})`);
    assert.equal(evidence.legendary.hasNoSwitch,false);assert.ok(evidence.legendary.ownerSelected);
    evidence.storage=[];
    for(const drive of ['F:','D:']) {
        const plan=await evaluate(`(async()=>{for(let n=0;n<100&&!document.querySelector('#gdInstallDrives [data-root]');n++)await new Promise(r=>setTimeout(r,100));[...document.querySelectorAll('#gdInstallDrives [data-root]')].find(b=>b.dataset.root.startsWith('${drive}')).click();for(let n=0;n<250;n++){await new Promise(r=>setTimeout(r,100));if(!document.getElementById('gdInstallPlanSummary').textContent.includes('Checking storage'))break;}return {text:document.getElementById('gdInstallPlanSummary').innerText,visible:(()=>{const b=document.getElementById('gdInstallConfirmBtn'),r=b.getBoundingClientRect();return !!document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('#gdInstallerModal');})(),path:document.getElementById('gdInstallFolder').value,disabled:document.getElementById('gdInstallConfirmBtn').disabled,plan:await baddelInstallStorage.confirmed()};})()`);
        evidence.storage.push({drive,...plan}); assert.ok(plan.visible,'Storage confirmation must not be occluded');assert.ok(!plan.text.includes('Unavailable'),plan.text);assert.ok(!fs.existsSync(plan.path));assert.equal(plan.disabled,drive==='D:');await evaluate("document.getElementById('gdInstallPlanSummary').scrollIntoView({block:'end'});");await new Promise(r=>setTimeout(r,200));await shot('epic-size-layout-storage-'+drive[0]);
    }
    assert.equal(infoCalls,1);evidence.infoCalls=infoCalls;
    // Official launch is never confirmed; only its real account-row selection is tested.
    await evaluate(`(async()=>{document.querySelector('[data-install-provider="epic_launcher"]')?.removeAttribute('disabled');await gdInstallSelectProvider('epic_launcher');})()`);
    evidence.official=await evaluate(`(()=>{const row=document.querySelector('#gdInstallAccountsList [data-id="__none__"]');row?.click();return {label:row?.querySelector('.pl-account-name')?.textContent,selected:_gdInstallSelectedAccountId,disabled:document.getElementById('gdInstallConfirmBtn').disabled};})()`);
    assert.equal(evidence.official.label,'Launch Directly');assert.equal(evidence.official.selected,'__none__');assert.equal(evidence.official.disabled,false);
    await shot('epic-size-layout-official'); await evaluate('gdInstallClose();');
    assert.equal(fs.readFileSync(queueFile,'utf8'),queueBefore); evidence.realQueueUnchanged=true;evidence.gameFoldersCreated=0;evidence.installCommands=0;
}
main().then(()=>{console.log(JSON.stringify(evidence,null,2));}).catch(error=>{evidence.error=error.message;console.error(error.message);process.exitCode=1;}).finally(()=>{
    fs.writeFileSync(path.join(root,'docs','epic-size-isolated-ui-evidence.json'),JSON.stringify(evidence,null,2));
    win?.destroy(); app.exit(process.exitCode||0);
});
