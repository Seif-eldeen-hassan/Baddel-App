'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const portArg = process.argv.find(value => value.startsWith('--port='));
const outArg = process.argv.find(value => value.startsWith('--out='));
const port = Number(portArg?.slice(7) || 9331);
const output = path.resolve(outArg?.slice(6) || 'docs/launcher-performance-interactions.json');
const getJson = route => new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port, path: route }, response => {
    let body = '';
    response.on('data', chunk => { body += chunk; });
    response.on('end', () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } });
}).on('error', reject));

function connect(url) {
    const socket = new WebSocket(url);
    const pending = new Map();
    let id = 0;
    const opened = new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    socket.onmessage = event => {
        const message = JSON.parse(event.data);
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result);
    };
    return {
        async send(method, params = {}) {
            await opened;
            const requestId = ++id;
            socket.send(JSON.stringify({ id: requestId, method, params }));
            return new Promise((resolve, reject) => pending.set(requestId, { resolve, reject }));
        },
        close() { socket.close(); },
    };
}

const expression = `(async () => {
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const paint = async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); };
    const firstGame = (window._allGamesCache || [])[0];
    const before = window.__baddelPerfDiagnostics?.snapshot()?.lifecycle || {};
    let details = null;
    if (firstGame) {
        navigateToHome();
        const id = String(firstGame.id || firstGame.appName || firstGame.title);
        const implementationCountBefore = Number(window.__gdOpenImplementationCount || 0);
        const started = performance.now();
        const promises = Array.from({ length: 10 }, () => window.openGameDetails(id));
        const handlerReturnedMs = performance.now() - started;
        const visibleSynchronously = document.getElementById('gameDetailsView')?.style.display === 'block';
        await paint();
        details = {
            rapidIntents: 10,
            logicalOpenCalls: Number(window.__gdOpenImplementationCount || 0) - implementationCountBefore,
            visibleSynchronously,
            handlerReturnedMs,
            firstPaintMs: performance.now() - started,
        };
        window.closeGameDetails();
    }
    await wait(50);
    const beforeModal = window.__baddelPerfDiagnostics?.snapshot()?.lifecycle || {};
    for (let index = 0; index < 50; index += 1) {
        _plBuildModal({ id: '__perf_modal', name: 'Performance Fixture' }, ['steam', 'epic']);
        _plShowModal();
        window.closePlayLauncher();
    }
    await wait(400);
    const after = window.__baddelPerfDiagnostics?.snapshot()?.lifecycle || {};
    return {
        generatedAt: new Date().toISOString(),
        details,
        modalCycles: 50,
        modalCountAfter: document.querySelectorAll('#playLauncherModal').length,
        keydownListenerAdds: (after.listenerAdds?.keydown || 0) - (beforeModal.listenerAdds?.keydown || 0),
        keydownListenerRemoves: (after.listenerRemoves?.keydown || 0) - (beforeModal.listenerRemoves?.keydown || 0),
        lifecycle: { before, after },
    };
})()`;

(async () => {
    const target = (await getJson('/json')).find(item => item.type === 'page' && /dashboard\.html/.test(item.url));
    if (!target) throw new Error('Dashboard target unavailable');
    const client = connect(target.webSocketDebuggerUrl);
    try {
        await client.send('Page.bringToFront');
        await client.send('Emulation.setFocusEmulationEnabled', { enabled: true });
        const response = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 30000 });
        if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
        fs.mkdirSync(path.dirname(output), { recursive: true });
        fs.writeFileSync(output, JSON.stringify(response.result.value, null, 2), 'utf8');
        console.log(`BADDEL_INTERACTION_DIAGNOSTICS_WRITTEN ${output}`);
    } finally { client.close(); }
})().catch(error => { console.error(error.stack || error); process.exit(1); });
