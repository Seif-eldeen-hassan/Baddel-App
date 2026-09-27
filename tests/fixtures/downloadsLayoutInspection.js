'use strict';

const path = require('path');
const { app, BrowserWindow } = require('electron');

app.whenReady().then(async () => {
    const win = new BrowserWindow({
        width: 1200,
        height: 720,
        show: false,
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    await win.loadFile(path.join(__dirname, '..', '..', 'src', 'dashboard.html'));
    win.webContents.debugger.attach('1.3');
    const results = [];
    for (const width of [1200, 760]) {
        await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height: 720, deviceScaleFactor: 1, mobile: false });
        for (const collapsed of [false, true]) results.push(await win.webContents.executeJavaScript(`(async () => {
            document.getElementById('mainSidebar')?.classList.toggle('collapsed', ${collapsed});
            await new Promise(resolve => setTimeout(resolve, 300));
            document.querySelectorAll('body > .app-container main > div, body > .app-container main > section').forEach(el => { el.style.display = 'none'; });
            const view = document.getElementById('downloadsView');
            view.style.display = 'block';
            const root = document.getElementById('downloadsRoot');
            root.innerHTML = '<div class="downloads-empty"><div class="downloads-empty-content"><div class="downloads-empty-icon"><svg viewBox="0 0 24 24"><path d="M12 3v12"></path></svg></div><h3>No downloads yet</h3><p>Description</p><button class="download-btn">Browse Ready to Install</button></div></div>';
            const center = element => { const r = element.getBoundingClientRect(); return r.left + r.width / 2; };
            const empty = root.querySelector('.downloads-empty');
            const icon = root.querySelector('.downloads-empty-icon');
            const heading = root.querySelector('h3');
            const browse = root.querySelector('button');
            const refresh = document.querySelector('.downloads-reset');
            const refreshIcon = refresh.querySelector('svg');
            const br = refresh.getBoundingClientRect(), ir = refreshIcon.getBoundingClientRect();
            const refreshStyle = getComputedStyle(refresh);
            return {
                width: innerWidth, sidebar: ${collapsed ? "'collapsed'" : "'expanded'"},
                emptyCenter: center(empty), iconCenter: center(icon), headingCenter: center(heading), buttonCenter: center(browse),
                refresh: { width: br.width, height: br.height, iconWidth: ir.width, iconHeight: ir.height, computedWidth: refreshStyle.width, minWidth: refreshStyle.minWidth, padding: refreshStyle.padding, centerDeltaX: Math.abs(center(refresh) - center(refreshIcon)), centerDeltaY: Math.abs((br.top + br.height / 2) - (ir.top + ir.height / 2)), contained: ir.left >= br.left && ir.right <= br.right && ir.top >= br.top && ir.bottom <= br.bottom }
            };
        })()`));
    }
    for (const result of results) {
        const centers = [result.iconCenter, result.headingCenter, result.buttonCenter];
        if (centers.some(value => Math.abs(value - result.emptyCenter) > 0.5)) throw new Error(`Downloads empty state is not centered at ${result.width}px`);
        if (!result.refresh.contained || result.refresh.width !== result.refresh.height || result.refresh.iconWidth !== 16 || result.refresh.iconHeight !== 16 || result.refresh.centerDeltaX > 0.5 || result.refresh.centerDeltaY > 0.5) {
            throw new Error(`Downloads refresh icon is not centered and contained at ${result.width}px`);
        }
    }
    process.stdout.write(JSON.stringify(results));
    win.webContents.debugger.detach();
    win.destroy();
    app.quit();
}).catch(error => {
    process.stderr.write(error.stack || error.message);
    app.exit(1);
});
