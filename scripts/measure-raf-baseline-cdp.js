#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const http = require('node:http');

const arg = (name, fallback) => {
    const prefix = `--${name}=`;
    return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length) || fallback;
};
const port = Number(arg('port', '9223'));
const route = arg('route', 'all');
const durationMs = Number(arg('durationMs', '3000'));
const out = arg('out', `docs/raf-baseline-${route}.json`);
const skipNavigation = arg('skipNavigation', '0') === '1';
const settleMs = Number(arg('settleMs', '1000'));

function getJson(routePath) {
    return new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port, path: routePath }, response => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', chunk => { body += chunk; });
            response.on('end', () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } });
        }).on('error', reject);
    });
}

function connect(url) {
    const socket = new WebSocket(url);
    const pending = new Map();
    let nextId = 1;
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
            const id = nextId++;
            socket.send(JSON.stringify({ id, method, params }));
            return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
        },
        close() { socket.close(); },
    };
}

(async () => {
    const targets = await getJson('/json');
    const target = targets.find(item => item.type === 'page' && /dashboard\.html/.test(item.url));
    if (!target) throw new Error('Dashboard target unavailable');
    const client = connect(target.webSocketDebuggerUrl);
    await client.send('Page.bringToFront');
    const expression = `(async () => {
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
        if (!${skipNavigation} && ${JSON.stringify(route)} === 'ready') {
            window.agReadyOnly = true;
            await navigateToAllGames({ _keepReadyMode: true });
        } else if (!${skipNavigation}) {
            window.agReadyOnly = false;
            await navigateToAllGames();
        }
        await wait(${settleMs});
        const intervals = [];
        let previous = null;
        const started = performance.now();
        await new Promise(resolve => {
            const frame = timestamp => {
                if (previous !== null) intervals.push(timestamp - previous);
                previous = timestamp;
                if (performance.now() - started >= ${durationMs}) resolve();
                else requestAnimationFrame(frame);
            };
            requestAnimationFrame(frame);
        });
        intervals.sort((a, b) => a - b);
        const percentile = value => intervals[Math.min(intervals.length - 1, Math.ceil(intervals.length * value) - 1)];
        const thresholds = [6.94, 8.33, 11.11, 16.67, 20, 33.33, 50];
        return {
            route: ${JSON.stringify(route)}, durationMs: performance.now() - started, frameCount: intervals.length,
            effectiveFps: intervals.length / ((performance.now() - started) / 1000),
            p50Ms: percentile(0.5), p90Ms: percentile(0.9), p95Ms: percentile(0.95), p99Ms: percentile(0.99), maxMs: intervals.at(-1),
            overThreshold: Object.fromEntries(thresholds.map(limit => [String(limit), intervals.filter(value => value > limit).length])),
            mountedCards: document.querySelectorAll('#allGamesGrid .game-card').length,
            itemCount: window._vs?.items?.length || 0,
            hidden: document.hidden,
        };
    })()`;
    const response = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
    const result = { marker: 'BADDEL_RAF_BASELINE', measuredAt: new Date().toISOString(), ...response.result.value };
    fs.writeFileSync(out, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    client.close();
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
