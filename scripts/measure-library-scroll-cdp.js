#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const http = require('node:http');

const arg = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
const port = Number(arg('port', '9223'));
const route = arg('route', 'all');
const durationMs = Number(arg('durationMs', '8000'));
const viewports = Number(arg('viewports', '20'));
const out = arg('out', `docs/library-scroll-${route}.json`);
const skipNavigation = arg('skipNavigation', '0') === '1';
const nonBlockingNavigation = arg('nonBlockingNavigation', '0') === '1';
const skipHydration = arg('skipHydration', '0') === '1';
const syntheticCount = Number(arg('syntheticCount', '0'));
const cycles = Math.max(1, Number(arg('cycles', '1')) || 1);
const motion = arg('motion', 'linear');
const backToTopMode = arg('backToTop', 'current');

function getJson(path) {
    return new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port, path }, response => {
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
    return { async send(method, params = {}) { await opened; const requestId = ++id; socket.send(JSON.stringify({ id: requestId, method, params })); return new Promise((resolve, reject) => pending.set(requestId, { resolve, reject })); }, close() { socket.close(); } };
}

(async () => {
    const target = (await getJson('/json')).find(item => item.type === 'page' && /(?:dashboard|index)\.html/.test(item.url));
    if (!target) throw new Error('Dashboard target unavailable');
    const client = connect(target.webSocketDebuggerUrl);
    await client.send('Page.bringToFront');
    const expression = `(async () => {
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
        if (!${skipNavigation}) {
            window.agReadyOnly = ${JSON.stringify(route)} === 'ready';
            const navigation = navigateToAllGames(${JSON.stringify(route)} === 'ready' ? { _keepReadyMode: true } : {});
            if (${nonBlockingNavigation}) {
                Promise.resolve(navigation).catch(() => {});
                const routeDeadline = Date.now() + 15000;
                while ((currentView !== 'all-games' || document.getElementById('allGamesView')?.style.display === 'none' || !(window._vs?.items?.length)) && Date.now() < routeDeadline) await wait(25);
            } else await navigation;
            if (!${skipHydration}) {
                const hydrationDeadline = Date.now() + 45000;
                while (window.__agApplicationArtworkHydration?.status !== 'complete' && Date.now() < hydrationDeadline) await wait(50);
            }
        }
        await wait(500);
        if (${syntheticCount} > 0) {
            const sourceItems = Array.from(window._vs?.items || []);
            if (!sourceItems.length) throw new Error('Synthetic source dataset unavailable');
            const synthetic = Array.from({ length: ${syntheticCount} }, (_, index) => {
                const original = sourceItems[index % sourceItems.length];
                const id = '__scroll_perf_' + index;
                return { ...original, id, appid: id, appId: id, appName: id, namespace: id, allIds: {}, title: String(original.title || original.name || 'Game') + ' ' + index };
            });
            synthetic.forEach(game => {
                const cover = game.coverUrl || game.image || game.defaultImage;
                if (cover) _agSetArtworkReady(game, cover, 'synthetic-scroll-diagnostic');
            });
            _vsInit(synthetic);
            await wait(500);
        }
        const scroller = window._vs?.scroller || document.getElementById('mainContentArea');
        if (${JSON.stringify(backToTopMode)} === 'off' && typeof window._agSyncBackToTopVisibility === 'function') {
            scroller.removeEventListener('scroll', window._agSyncBackToTopVisibility);
        } else if (${JSON.stringify(backToTopMode)} === 'on' && typeof window._agSyncBackToTopVisibility === 'function') {
            scroller.removeEventListener('scroll', window._agSyncBackToTopVisibility);
            scroller.addEventListener('scroll', window._agSyncBackToTopVisibility, { passive: true });
        }
        const initialCounters = { ...(window.__agScrollPerfDiagnostics?.counters || {}) };
        const intervals = [];
        const downIntervals = [];
        const upIntervals = [];
        const longTasks = [];
        const observer = typeof PerformanceObserver === 'function' ? new PerformanceObserver(list => {
            for (const entry of list.getEntries()) longTasks.push(entry.duration);
        }) : null;
        try { observer?.observe({ type: 'longtask', buffered: false }); } catch {}
        const startTop = scroller.scrollTop;
        const travel = Math.min(Math.max(0, scroller.scrollHeight - scroller.clientHeight), scroller.clientHeight * ${viewports});
        const started = performance.now();
        let previous = null;
        let maxMounted = 0;
        await new Promise(resolve => {
            const frame = timestamp => {
                const interval = previous === null ? null : timestamp - previous;
                if (interval !== null) intervals.push(interval);
                previous = timestamp;
                const elapsed = timestamp - started;
                const phase = Math.min(1, elapsed / ${durationMs});
                const cyclePhase = Math.min(1, (phase * ${cycles}) % 1 || (phase >= 1 ? 1 : 0));
                const movingDown = cyclePhase <= 0.5;
                const halfPhase = movingDown ? cyclePhase * 2 : (cyclePhase - 0.5) * 2;
                const eased = ${JSON.stringify(motion)} === 'fling' ? 1 - Math.pow(1 - halfPhase, 3) : halfPhase;
                const position = movingDown ? eased : 1 - eased;
                if (interval !== null) (movingDown ? downIntervals : upIntervals).push(interval);
                scroller.scrollTop = startTop + travel * position;
                maxMounted = Math.max(maxMounted, document.querySelectorAll('#allGamesGrid .game-card').length);
                if (phase >= 1) resolve(); else requestAnimationFrame(frame);
            };
            requestAnimationFrame(frame);
        });
        observer?.disconnect();
        await wait(250);
        intervals.sort((a, b) => a - b);
        const percentile = p => intervals[Math.min(intervals.length - 1, Math.max(0, Math.ceil(intervals.length * p) - 1))] || 0;
        const summarize = values => {
            const sorted = values.slice().sort((a, b) => a - b);
            const at = p => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))] || 0;
            return { count: sorted.length, p50Ms: at(.5), p95Ms: at(.95), p99Ms: at(.99), maxMs: sorted.at(-1) || 0 };
        };
        const thresholds = [6.94, 8.33, 11.11, 16.67, 33.33, 50];
        const finalCounters = window.__agScrollPerfDiagnostics?.counters || {};
        const counterDelta = Object.fromEntries(Object.keys(finalCounters).map(key => [key, Number(finalCounters[key] || 0) - Number(initialCounters[key] || 0)]));
        return {
            route: ${JSON.stringify(route)}, syntheticCount: ${syntheticCount}, cycles: ${cycles}, motion: ${JSON.stringify(motion)}, backToTop: ${JSON.stringify(backToTopMode)}, durationMs: performance.now() - started, frameCount: intervals.length,
            effectiveFps: intervals.length / (${durationMs} / 1000), p50Ms: percentile(.5), p95Ms: percentile(.95), p99Ms: percentile(.99), maxMs: intervals.at(-1) || 0,
            direction: { down: summarize(downIntervals), up: summarize(upIntervals) },
            overThreshold: Object.fromEntries(thresholds.map(limit => [String(limit), intervals.filter(value => value > limit).length])),
            longTasks: { count: longTasks.length, maxMs: Math.max(0, ...longTasks), totalMs: longTasks.reduce((sum, value) => sum + value, 0) },
            itemCount: window._vs?.items?.length || 0, mountedCards: document.querySelectorAll('#allGamesGrid .game-card').length, maxMounted,
            scrollDistancePx: travel, returnedToStart: Math.abs(scroller.scrollTop - startTop) < 2,
            artworkReadyLost: counterDelta['artwork.readyArtworkLost'] || 0,
            networkArtworkRequests: counterDelta['artwork.networkRequests'] || 0,
            metadataRequests: counterDelta['artwork.metadataRequests'] || 0,
            counterDelta,
        };
    })()`;
    const response = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: durationMs + 60000 });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    const result = { marker: 'BADDEL_LIBRARY_SCROLL_LOW_OVERHEAD', measuredAt: new Date().toISOString(), ...response.result.value };
    fs.writeFileSync(out, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    client.close();
    setTimeout(() => process.exit(0), 50);
})().catch(error => { console.error(error.stack || error); process.exit(1); });
