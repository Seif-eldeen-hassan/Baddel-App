'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

function arg(name, fallback) {
    const index = process.argv.indexOf(`--${name}`);
    return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function getJson(url) {
    return new Promise((resolve, reject) => {
        const request = http.get(url, response => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', chunk => { body += chunk; });
            response.on('end', () => {
                try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
            });
        });
        request.on('error', reject);
        request.setTimeout(10_000, () => request.destroy(new Error(`Timeout for ${url}`)));
    });
}

async function evaluate(port, expression) {
    const targets = await getJson(`http://127.0.0.1:${port}/json`);
    const page = targets.find(target => target.type === 'page' && /dashboard\.html|Baddel Launcher/i.test(`${target.title || ''} ${target.url || ''}`))
        || targets.find(target => target.type === 'page');
    if (!page?.webSocketDebuggerUrl) throw new Error('No Electron dashboard target found');
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    let nextId = 1;
    const pending = new Map();
    const call = (method, params = {}) => new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
    });
    socket.onmessage = event => {
        const message = JSON.parse(event.data);
        const waiter = pending.get(message.id);
        if (!waiter) return;
        pending.delete(message.id);
        if (message.error) waiter.reject(new Error(message.error.message));
        else waiter.resolve(message.result);
    };
    await new Promise((resolve, reject) => {
        socket.onopen = resolve;
        socket.onerror = () => reject(new Error('CDP websocket failed'));
    });
    try {
        await call('Runtime.enable');
        const result = await call('Runtime.evaluate', {
            expression,
            awaitPromise: true,
            returnByValue: true,
            timeout: Number(arg('timeout', '300000')),
        });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Renderer evaluation failed');
        return result.result.value;
    } finally {
        try { socket.close(); } catch {}
    }
}

const routeExpression = `(async () => {
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const percentile = (values, p) => {
        if (!values.length) return 0;
        const sorted = [...values].sort((a, b) => a - b);
        return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p / 100) - 1)];
    };
    const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
    const stats = values => ({ count: values.length, p50: percentile(values, 50), p95: percentile(values, 95), p99: percentile(values, 99), max: values.length ? Math.max(...values) : 0 });
    const ipc = {};
    const originals = {};
    for (const [name, fn] of Object.entries(window.electronAPI || {})) {
        if (typeof fn !== 'function') continue;
        originals[name] = fn;
        window.electronAPI[name] = function (...args) {
            const start = performance.now();
            let result;
            try { result = fn.apply(this, args); } catch (error) {
                (ipc[name] ||= []).push(performance.now() - start);
                throw error;
            }
            return Promise.resolve(result).then(value => {
                (ipc[name] ||= []).push(performance.now() - start);
                return value;
            }, error => {
                (ipc[name] ||= []).push(performance.now() - start);
                throw error;
            });
        };
    }
    const frames = [];
    const longTasks = [];
    let running = true;
    let previous = null;
    const frame = now => { if (previous != null) frames.push(now - previous); previous = now; if (running) requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
    let observer = null;
    try {
        observer = new PerformanceObserver(list => list.getEntries().forEach(entry => longTasks.push({ start: entry.startTime, duration: entry.duration })));
        observer.observe({ entryTypes: ['longtask'] });
    } catch {}
    const route = async (name, navigate, ready) => {
        await wait(250);
        const start = performance.now();
        let returnedAt = null;
        const result = navigate();
        await Promise.resolve(result);
        returnedAt = performance.now();
        const deadline = performance.now() + 30000;
        while (!ready() && performance.now() < deadline) await wait(16);
        await nextFrame();
        await nextFrame();
        const usableAt = performance.now();
        return {
            name,
            navigateReturnedMs: returnedAt - start,
            usableMs: usableAt - start,
            domNodes: document.getElementsByTagName('*').length,
            mountedCards: document.querySelectorAll('#allGamesGrid .game-card, #allGamesList .ag-list-row').length,
            itemCount: Array.isArray(window._vs?.items) ? window._vs.items.length : null,
            heap: performance.memory?.usedJSHeapSize || null,
        };
    };
    const routes = [];
    routes.push(await route('home', () => window.navigateToHome?.(), () => typeof currentView === 'undefined' || currentView === 'home'));
    routes.push(await route('all-games', () => window.navigateToAllGames?.(), () => currentView === 'all-games' && !window._allGamesRendering && document.querySelectorAll('#allGamesGrid .game-card').length > 0));
    const scroller = window._vs?.scroller || document.getElementById('mainContentArea');
    const scrollStart = performance.now();
    for (let i = 0; i <= 120; i++) { scroller.scrollTop = (scroller.clientHeight * 10) * (i / 120); await nextFrame(); }
    for (let i = 0; i <= 120; i++) { scroller.scrollTop = (scroller.clientHeight * 10) * (1 - i / 120); await nextFrame(); }
    const scrollMs = performance.now() - scrollStart;
    routes.push(await route('ready-to-install', () => window.navigateToReadyToInstall?.(), () => currentView === 'all-games' && window.agReadyOnly && !window._allGamesRendering && document.querySelectorAll('#allGamesGrid .game-card').length > 0));
    routes.push(await route('installed', () => window.navigateToInstalled?.(), () => currentView === 'installed'));
    routes.push(await route('home-return', () => window.navigateToHome?.(), () => currentView === 'home'));
    await wait(500);
    running = false;
    observer?.disconnect();
    for (const [name, fn] of Object.entries(originals)) window.electronAPI[name] = fn;
    const ipcStats = Object.fromEntries(Object.entries(ipc).map(([name, values]) => [name, { ...stats(values), total: values.reduce((a, b) => a + b, 0) }]));
    return {
        generatedAt: new Date().toISOString(),
        startup: window.__baddelStartupMetrics || null,
        navigationTiming: performance.getEntriesByType('navigation')[0]?.toJSON?.() || null,
        routes,
        scrollMs,
        rendererFrames: stats(frames),
        framesOver50Ms: frames.filter(value => value > 50).length,
        framesOver100Ms: frames.filter(value => value > 100).length,
        longTasks: { ...stats(longTasks.map(item => item.duration)), entries: longTasks },
        ipc: ipcStats,
        final: {
            currentView: typeof currentView === 'undefined' ? null : currentView,
            domNodes: document.getElementsByTagName('*').length,
            heap: performance.memory?.usedJSHeapSize || null,
            allGamesCount: window._allGamesCache?.length || 0,
            readyCount: window.__readyToInstallState?.games?.length || 0,
            installedCount: window.allGamesData?.length || 0,
        },
    };
})()`;

const probeExpression = `(async () => {
    const time = async fn => { const start = performance.now(); const value = await fn(); return { durationMs: performance.now() - start, value }; };
    const status = await time(() => window.electronAPI.platformSyncStatus());
    const projection = await time(() => _agReadCachedAllGamesProjection());
    const cache = Array.isArray(window._allGamesCache) && window._allGamesCache.length ? window._allGamesCache : (projection.value?.rawResolved || []);
    const candidates = cache.filter(game => game && !_agHasLocalCover(game));
    const bulk48 = await time(() => _agWarmCachedCoversForGames(candidates, { limit: 48, reason: 'launcher-performance-probe-48' }));
    return { cacheCount: cache.length, candidateCount: candidates.length, status, bulk48, projection: { durationMs: projection.durationMs, rawCount: projection.value?.rawResolved?.length || 0 } };
})()`;

const expression = arg('mode', 'routes') === 'probe' ? probeExpression : routeExpression;

(async () => {
    const result = await evaluate(Number(arg('port', '9224')), expression);
    const output = path.resolve(arg('out', 'launcher-responsiveness.json'));
    fs.writeFileSync(output, JSON.stringify(result, null, 2), 'utf8');
    console.log(`BADDEL_LAUNCHER_RESPONSIVENESS_WRITTEN ${output}`);
})().catch(error => {
    console.error(error?.stack || error);
    process.exit(1);
});
