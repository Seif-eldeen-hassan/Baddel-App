'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const arg = (name, fallback) => {
    const at = process.argv.indexOf(`--${name}`);
    return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
};
const port = Number(arg('port', '9331'));
const output = path.resolve(arg('out', 'docs/launcher-performance-investigation.json'));
const mode = arg('mode', 'full');

function getJson(route) {
    return new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port, path: route }, response => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { body += chunk; });
        response.on('end', () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } });
    }).on('error', reject));
}

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
    const diagnosticMode = ${JSON.stringify(mode)};
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const frames = async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); };
    const summarize = values => {
        const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
        const at = p => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))] || 0;
        return { count: sorted.length, medianMs: at(.5), p95Ms: at(.95), maxMs: sorted.at(-1) || 0 };
    };
    await window.navigateToAllGames();
    await wait(250);

    const components = ['_agWarmCachedCoversForGames', '_agLoadExistingGridThumbnails', '_applyAgFilters', '_agGetUserLibraryGames', '_agRenderAccountFilterOptions'];
    const samples = Object.fromEntries(components.map(name => [name, []]));
    const originals = {};
    for (const name of components) {
        const original = window[name];
        if (typeof original !== 'function') continue;
        originals[name] = original;
        window[name] = function(...args) {
            const started = performance.now();
            let value;
            try { value = original.apply(this, args); }
            catch (error) { samples[name].push(performance.now() - started); throw error; }
            if (value && typeof value.then === 'function') {
                return value.finally(() => samples[name].push(performance.now() - started));
            }
            samples[name].push(performance.now() - started);
            return value;
        };
    }
    const navigation = [];
    for (let cycle = 0; cycle < 10; cycle++) {
        navigateToHome();
        await wait(30);
        const started = performance.now();
        await window.navigateToAllGames();
        await frames();
        navigation.push(performance.now() - started);
    }
    for (const [name, original] of Object.entries(originals)) window[name] = original;

    const originalCache = window._allGamesCache;
    const originalRaw = window._allGamesRawCache;
    const originalState = { ...window._agState };
    const source = Array.from(originalCache || []);
    const scale = {};
    for (const count of [100, 1000, 3000]) {
        const synthetic = Array.from({ length: count }, (_, index) => {
            const base = source[index % Math.max(1, source.length)] || {};
            return { ...base, id: '__perf_' + index, title: String(base.title || base.name || 'Game') + ' ' + String(index).padStart(4, '0'), allIds: {}, accountKeys: ['perf'], platforms: index % 2 ? ['steam'] : ['epic'], playtime: index % 301 };
        });
        window._allGamesCache = synthetic;
        window._allGamesRawCache = synthetic;
        const operations = { titleSort: [], playtimeSort: [], search: [], renderPaint: [] };
        for (let run = 0; run < 10; run++) {
            window._agState = { platform: 'all', account: 'all', search: '', sort: run % 2 ? 'title_asc' : 'title_desc' };
            let started = performance.now(); _agBuildFilteredPool({ cache: synthetic, useCanonical: false }); operations.titleSort.push(performance.now() - started);
            window._agState.sort = 'playtime_desc';
            started = performance.now(); _agBuildFilteredPool({ cache: synthetic, useCanonical: false }); operations.playtimeSort.push(performance.now() - started);
            window._agState.search = 'game 29'; window._agState.sort = 'title_asc';
            started = performance.now(); _agBuildFilteredPool({ cache: synthetic, useCanonical: false }); operations.search.push(performance.now() - started);
        }
        window._agState = { platform: 'all', account: 'all', search: '', sort: 'title_asc' };
        const sorted = _agBuildFilteredPool({ cache: synthetic, useCanonical: false });
        const renderStarted = performance.now();
        _renderAllGamesViewModeAware(sorted, true, true);
        await frames();
        operations.renderPaint.push(performance.now() - renderStarted);
        scale[count] = Object.fromEntries(Object.entries(operations).map(([name, values]) => [name, summarize(values)]));
        scale[count].mountedCards = document.querySelectorAll('#allGamesGrid .game-card').length;
        scale[count].itemCount = window._vs?.items?.length || 0;
    }
    window._allGamesCache = originalCache;
    window._allGamesRawCache = originalRaw;
    window._agState = originalState;
    await window.navigateToAllGames({ preserveFilters: true });

    if (diagnosticMode === 'core') {
        const renderer = window.__baddelPerfDiagnostics?.snapshot() || null;
        await window.__baddelPerfDiagnostics?.report?.();
        const main = await window.electronAPI.performanceDiagnostics.snapshot();
        return {
            generatedAt: new Date().toISOString(), libraryCount: originalCache?.length || 0,
            navigation: summarize(navigation), navigationSamplesMs: navigation,
            components: Object.fromEntries(Object.entries(samples).map(([name, values]) => [name, summarize(values)])),
            scale, renderer, main,
        };
    }

    const detailsVisible = [];
    const firstGame = (originalCache || [])[0];
    if (firstGame) {
        for (let cycle = 0; cycle < 5; cycle++) {
            navigateToHome(); await wait(30);
            const started = performance.now();
            const opening = window.openGameDetails(String(firstGame.id || firstGame.appName || firstGame.title));
            const deadline = performance.now() + 3000;
            while (document.getElementById('gameDetailsView')?.style.display !== 'block' && performance.now() < deadline) await new Promise(requestAnimationFrame);
            await frames();
            detailsVisible.push(performance.now() - started);
            window.closeGameDetails();
            await Promise.race([Promise.resolve(opening).catch(() => {}), wait(30)]);
        }
    }

    const lifecycleBefore = window.__baddelPerfDiagnostics?.snapshot()?.lifecycle || {};
    for (let cycle = 0; cycle < 50; cycle++) {
        window._plBuildModal?.({ id: '__perf_modal', name: 'Performance Fixture' }, ['steam', 'epic']);
        window._plShowModal?.();
        window.closePlayLauncher?.();
    }
    await wait(350);
    const lifecycleAfter = window.__baddelPerfDiagnostics?.snapshot()?.lifecycle || {};

    let launchCalls = 0;
    let finishLaunch;
    const fakeLaunch = () => { launchCalls++; return new Promise(resolve => { finishLaunch = resolve; }); };
    const launchGame = { id: '__perf_launch', name: 'Performance Fixture', path: 'C:\\\\fixture', command: 'C:\\\\fixture\\\\game.exe' };
    const launchPromises = Array.from({ length: 10 }, () => window._plDoActualLaunch?.(launchGame, fakeLaunch));
    await wait(20);
    finishLaunch?.({ status: 'error', message: 'diagnostic cancellation' });
    await Promise.allSettled(launchPromises);

    const renderer = window.__baddelPerfDiagnostics?.snapshot() || null;
    await window.__baddelPerfDiagnostics?.report?.();
    const main = await window.electronAPI.performanceDiagnostics.snapshot();
    return {
        generatedAt: new Date().toISOString(),
        libraryCount: originalCache?.length || 0,
        navigation: summarize(navigation),
        navigationSamplesMs: navigation,
        components: Object.fromEntries(Object.entries(samples).map(([name, values]) => [name, summarize(values)])),
        detailsVisible: summarize(detailsVisible),
        detailsVisibleSamplesMs: detailsVisible,
        scale,
        duplicateActions: { rapidPlayIntents: 10, logicalLaunchCalls: launchCalls, playModalCount: document.querySelectorAll('#playLauncherModal').length },
        lifecycle: { before: lifecycleBefore, after: lifecycleAfter },
        renderer,
        main,
    };
})()`;

(async () => {
    const target = (await getJson('/json')).find(item => item.type === 'page' && /dashboard\.html/.test(item.url));
    if (!target) throw new Error('Dashboard target unavailable');
    const client = connect(target.webSocketDebuggerUrl);
    try {
        await client.send('Page.bringToFront');
        await client.send('Emulation.setFocusEmulationEnabled', { enabled: true });
        const response = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 180000 });
        if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
        fs.mkdirSync(path.dirname(output), { recursive: true });
        fs.writeFileSync(output, JSON.stringify(response.result.value, null, 2), 'utf8');
        console.log(`BADDEL_PERFORMANCE_INVESTIGATION_WRITTEN ${output}`);
    } finally {
        client.close();
    }
})().catch(error => { console.error(error.stack || error); process.exit(1); });
