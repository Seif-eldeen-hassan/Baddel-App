'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const arg = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
const port = Number(arg('port', '9331'));
const provider = String(arg('provider', 'epic')).toLowerCase();
const out = path.resolve(arg('out', `docs/provider-cover-${provider}.json`));

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
    const provider = ${JSON.stringify(provider)};
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const percentile = (values, p) => {
        const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
        return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))] || 0;
    };
    const platformOf = game => String(game?.platform || game?.platforms?.[0] || '').toLowerCase();
    const sourceClass = value => {
        const url = String(value || '');
        if (!url) return 'missing';
        if (_agIsGridThumbnailUrl(url)) return 'grid-thumbnail';
        if (_agIsManagedArtworkCacheUrl(url)) return 'managed-original';
        if (url.startsWith('file://')) return 'other-local';
        if (/^https?:/i.test(url)) return 'remote';
        if (/^(?:data:image|blob:)/i.test(url)) return 'inline';
        return 'other';
    };
    const add = (object, key) => { object[key] = Number(object[key] || 0) + 1; };
    const mounted = () => [...document.querySelectorAll('#allGamesGrid .game-card')].map(card => {
        const img = card.querySelector('.native-lazy-load');
        return {
            id: String(card.dataset.id || ''),
            loaded: !!img?.classList.contains('loaded') && img?.style.display !== 'none' && !!img?.getAttribute('src'),
            src: img?.getAttribute('src') || '',
            assignmentToken: Number(img?.dataset?.artworkAssignmentToken || 0),
        };
    });
    const mainBefore = await window.electronAPI.performanceDiagnostics.snapshot();
    await navigateToAllGames();
    const loadDeadline = Date.now() + 60000;
    while ((!Array.isArray(window._allGamesCache) || !window._allGamesCache.length) && Date.now() < loadDeadline) await wait(100);
    window.setAgPlatformFilter(provider);
    await wait(750);
    const games = (window._vs?.items || []).filter(game => provider === 'all' || platformOf(game) === provider || game?.platforms?.map(String).map(v => v.toLowerCase()).includes(provider));
    const records = { sourceField: {}, resolvedOriginal: {}, displayCover: {}, recordStatus: {}, recordSource: {} };
    let gridMappings = 0, usablePayloads = 0, missingPayloads = 0;
    const samples = [];
    for (const game of games) {
        const source = game.coverUrl || game.image || game.defaultImage || game.cover || game.posterImage || '';
        const record = _agArtworkRecordFor(game, false);
        const payload = _agResolveCardCoverPayload(game);
        add(records.sourceField, sourceClass(source));
        add(records.resolvedOriginal, sourceClass(payload?.originalCover));
        add(records.displayCover, sourceClass(payload?.cover));
        add(records.recordStatus, record?.status || 'none');
        add(records.recordSource, record?.readySource || 'none');
        if (payload?.gridThumbnail) gridMappings++;
        if (payload?.cover) usablePayloads++; else missingPayloads++;
        if (samples.length < 8) samples.push({
            id: String(game.id || game.appName || ''),
            platform: platformOf(game),
            sourceClass: sourceClass(source),
            originalClass: sourceClass(payload?.originalCover),
            displayClass: sourceClass(payload?.cover),
            recordStatus: record?.status || 'none',
            recordSource: record?.readySource || null,
            candidates: _agArtworkCandidateUrlsFromGame(game).length,
            aliases: _agArtworkAliasesForGame(game).length,
        });
    }
    const scroller = window._vs?.scroller || document.getElementById('mainContentArea');
    scroller.scrollTop = 0;
    await wait(500);
    const initial = mounted();
    const initiallyLoaded = new Set(initial.filter(item => item.loaded).map(item => item.id));
    const frameMs = [], blankSamples = [];
    const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const travel = Math.min(maxTop, scroller.clientHeight * 28);
    const started = performance.now();
    let prior;
    await new Promise(resolve => {
        const frame = now => {
            if (prior != null) frameMs.push(now - prior);
            prior = now;
            const progress = Math.min(1, (now - started) / 7000);
            const down = progress <= 0.5;
            const leg = down ? progress * 2 : (progress - 0.5) * 2;
            scroller.scrollTop = travel * (down ? leg : 1 - leg);
            const cards = mounted();
            blankSamples.push(cards.filter(item => !item.loaded).length);
            if (progress >= 1) resolve(); else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
    });
    scroller.scrollTop = 0;
    await wait(1000);
    const returned = mounted();
    const disappearedOnReturn = returned.filter(item => initiallyLoaded.has(item.id) && !item.loaded).map(item => item.id);
    const reassignedOnReturn = returned.filter(item => {
        const before = initial.find(value => value.id === item.id);
        return before && item.assignmentToken > before.assignmentToken;
    }).length;
    const finalGames = (window._vs?.items || []).filter(game => provider === 'all' || platformOf(game) === provider || game?.platforms?.map(String).map(v => v.toLowerCase()).includes(provider));
    let finalGridMappings = 0, finalUsablePayloads = 0, finalMissingPayloads = 0;
    for (const game of finalGames) {
        const payload = _agResolveCardCoverPayload(game);
        if (payload?.gridThumbnail) finalGridMappings++;
        if (payload?.cover) finalUsablePayloads++; else finalMissingPayloads++;
    }
    const mainAfter = await window.electronAPI.performanceDiagnostics.snapshot();
    const ipcDelta = {};
    for (const channel of ['get-grid-artwork-thumbnails', 'get-cached-images-bulk', 'probe-local-image', 'artwork-cold-cover-bootstrap:boost']) {
        ipcDelta[channel] = Number(mainAfter?.ipc?.[channel]?.count || 0) - Number(mainBefore?.ipc?.[channel]?.count || 0);
    }
    return {
        provider,
        gameCount: games.length,
        records,
        gridMappings,
        usablePayloads,
        missingPayloads,
        initialMounted: initial.length,
        initialMissing: initial.filter(item => !item.loaded).length,
        returnedMounted: returned.length,
        returnedMissing: returned.filter(item => !item.loaded).length,
        disappearedOnReturnCount: disappearedOnReturn.length,
        disappearedOnReturn: disappearedOnReturn.slice(0, 20),
        reassignedOnReturn,
        finalGridMappings,
        finalUsablePayloads,
        finalMissingPayloads,
        blankCards: { median: percentile(blankSamples, .5), p95: percentile(blankSamples, .95), max: Math.max(0, ...blankSamples) },
        frames: { count: frameMs.length, p50Ms: percentile(frameMs, .5), p95Ms: percentile(frameMs, .95), maxMs: Math.max(0, ...frameMs) },
        decodeCacheSize: window._vs?.coverDecodeCache?.size || 0,
        decodeJobs: window._vs?.coverDecodeJobs?.size || 0,
        gridMapSize: window.__agGridThumbnailByCover?.size || 0,
        registrySize: window.__agArtworkRegistry?.size || 0,
        thumbnailQueue: Number(window._agGridThumbnailPrepareQueue?.length || 0),
        ipcDelta,
        bulkLookup: window.__agLastBulkArtworkLookup || null,
        samples,
    };
})()`;

(async () => {
    const target = (await getJson('/json')).find(item => item.type === 'page' && /dashboard\.html/.test(item.url));
    if (!target) throw new Error('Dashboard target unavailable');
    const client = connect(target.webSocketDebuggerUrl);
    try {
        await client.send('Page.bringToFront');
        await client.send('Emulation.setFocusEmulationEnabled', { enabled: true });
        const response = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 90000 });
        if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
        const report = { generatedAt: new Date().toISOString(), ...response.result.value };
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, JSON.stringify(report, null, 2));
        console.log(JSON.stringify(report));
    } finally { client.close(); }
})().catch(error => { console.error(error.stack || error); process.exit(1); });
