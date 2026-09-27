'use strict';
const fs = require('node:fs');
const http = require('node:http');
const port = Number(process.argv[process.argv.indexOf('--port') + 1] || 9223);
const out = process.argv[process.argv.indexOf('--out') + 1] || 'docs/artwork-route-cycles.json';
function getJson(url) { return new Promise((resolve, reject) => http.get(url, response => { let body = ''; response.on('data', chunk => body += chunk); response.on('end', () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } }); }).on('error', reject)); }
(async () => {
    const targets = await getJson(`http://127.0.0.1:${port}/json`);
    const page = targets.find(target => target.type === 'page' && /dashboard\.html/i.test(target.url)) || targets.find(target => target.type === 'page');
    const socket = new WebSocket(page.webSocketDebuggerUrl); let id = 0; const pending = new Map();
    socket.onmessage = event => { const message = JSON.parse(event.data); const waiter = pending.get(message.id); if (!waiter) return; pending.delete(message.id); message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result); };
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    const call = (method, params) => new Promise((resolve, reject) => { const current = ++id; pending.set(current, { resolve, reject }); socket.send(JSON.stringify({ id: current, method, params })); });
    const expression = `(async () => {
        const sample = (label, durationMs = null) => ({ label, durationMs, routeVersion: window._agRouteVersion || 0,
            ready: window.__readyToInstallState?.ready === true, readyVersion: window.__readyToInstallState?.version || 0,
            readySource: window.__readyToInstallState?.source || null, readyCount: window.__readyToInstallState?.count ?? null,
            loadingShown: Boolean(document.querySelector('.ag-rti-loading-wrap')),
            hydrationStatus: window.__agApplicationArtworkHydration?.status || null,
            hydrationCompleted: window.__agApplicationArtworkHydration?.completed || 0,
            hydrationTotal: window.__agApplicationArtworkHydration?.total || 0,
            mountedCards: document.querySelectorAll('#allGamesGrid .game-card, #allGamesList .ag-list-row').length,
            mountedBrokenImages: [...document.querySelectorAll('#allGamesGrid img, #allGamesList img')].filter(img => img.src?.startsWith('file:') && img.complete && !img.naturalWidth).length });
        const results = [sample('before')];
        for (let cycle = 1; cycle <= 10; cycle++) {
            navigateToHome(); await new Promise(r => setTimeout(r, 20));
            let started = performance.now(); await window.navigateToAllGames();
            results.push(sample('home-to-all-' + cycle, performance.now() - started));
        }
        for (let cycle = 1; cycle <= 10; cycle++) {
            let started = performance.now(); await window.navigateToReadyToInstall();
            results.push(sample('all-to-ready-' + cycle, performance.now() - started));
            started = performance.now(); await window.navigateToAllGames();
            results.push(sample('ready-to-all-' + cycle, performance.now() - started));
        }
        return { marker: 'BADDEL_ARTWORK_ROUTE_CYCLES', generatedAt: new Date().toISOString(), results };
    })()`;
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 120000 });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'runtime failure');
    fs.writeFileSync(out, JSON.stringify(result.result.value, null, 2)); socket.close();
    console.log(`BADDEL_ARTWORK_ROUTE_CYCLES_WRITTEN ${out}`);
})().catch(error => { console.error(error.stack || error); process.exit(1); });
