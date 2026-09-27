'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const assert = require('node:assert/strict');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baddel-main-trace-'));
app.setPath('userData', dir);
process.env.BADDEL_TEST_USER_DATA = dir;
process.env.BADDEL_DISABLE_STARTUP_SYNC = '1';
process.env.BADDEL_ARTWORK_STARTUP_TRACE = '1';
const resources = path.resolve(__dirname, '../../dist-artwork-diagnostics/win-unpacked/resources');
Object.defineProperty(app, 'isPackaged', { value: true });
Object.defineProperty(process, 'resourcesPath', { value: resources });
app.setAppPath(path.join(resources, 'app.asar'));
setTimeout(() => app.exit(2), 45000).unref();
try { require(path.join(resources, 'app.asar', 'main.bundle.cjs')); }
catch (error) { console.error(error); app.exit(1); }
app.whenReady().then(async () => {
    await new Promise(resolve => setTimeout(resolve, 12000));
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'artwork-startup-diagnostics/latest.json'), 'utf8'));
    assert.equal(saved.runtime.traceVersion, 1);
    assert.ok(saved.events.some(e => e.stage === 'registered:get-cached-images-bulk'));
    assert.ok(saved.events.some(e => e.stage === 'renderer-sample'));
    assert.ok(BrowserWindow.getAllWindows().length > 0);
    console.log('ARTWORK_TRACE_PROTECTED_MAIN_OK');
    app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
setTimeout(() => app.exit(2), 45000).unref();
