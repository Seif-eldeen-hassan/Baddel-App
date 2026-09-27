#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const http = require('node:http');
const sharp = require('sharp');
const port = Number(process.argv.find(value => value.startsWith('--port='))?.slice(7) || 9223);
const out = process.argv.find(value => value.startsWith('--out='))?.slice(6) || 'docs/library-cover-assets.json';

const getJson = path => new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port, path }, response => {
    let body = '';
    response.on('data', chunk => { body += chunk; });
    response.on('end', () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } });
}).on('error', reject));

const percentile = (values, p) => {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))] || 0;
};

(async () => {
    const target = (await getJson('/json')).find(item => item.type === 'page' && /dashboard\.html/.test(item.url));
    if (!target) throw new Error('Dashboard target unavailable');
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    const urls = await new Promise((resolve, reject) => {
        socket.onmessage = event => {
            const message = JSON.parse(event.data);
            if (message.id !== 1) return;
            message.error ? reject(new Error(message.error.message)) : resolve(message.result.result.value);
        };
        socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: {
            returnByValue: true,
            expression: `[...new Set((_vs?.items || []).map(game => String(_agResolveCardCoverPayload(game)?.cover || '')).filter(url => url.startsWith('file://')))]`,
        } }));
    });
    socket.close();
    const rows = [];
    for (const url of urls) {
        try {
            let pathname = decodeURIComponent(new URL(url).pathname);
            if (/^\/[A-Za-z]:\//.test(pathname)) pathname = pathname.slice(1);
            pathname = pathname.replace(/\//g, '\\');
            const metadata = await sharp(pathname).metadata();
            rows.push({ bytes: fs.statSync(pathname).size, width: metadata.width || 0, height: metadata.height || 0 });
        } catch {}
    }
    const metric = values => ({ p50: percentile(values, .5), p95: percentile(values, .95), p99: percentile(values, .99), max: percentile(values, 1) });
    const result = {
        marker: 'BADDEL_LIBRARY_COVER_ASSETS',
        measuredAt: new Date().toISOString(),
        requested: urls.length,
        measured: rows.length,
        bytes: metric(rows.map(row => row.bytes)),
        width: metric(rows.map(row => row.width)),
        height: metric(rows.map(row => row.height)),
        pixels: metric(rows.map(row => row.width * row.height)),
    };
    fs.writeFileSync(out, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
})().catch(error => { console.error(error.stack || error); process.exit(1); });
