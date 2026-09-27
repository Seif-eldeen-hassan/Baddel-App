#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const sharp = require('sharp');

const port = Number(process.argv.find(value => value.startsWith('--port='))?.slice(7) || 9223);
const width = Number(process.argv.find(value => value.startsWith('--width='))?.slice(8) || 160);
const height = Number(process.argv.find(value => value.startsWith('--height='))?.slice(9) || 240);
const outputDir = path.resolve(`.perf-grid-thumbnails/${width}x${height}`);
const mapFile = path.join(outputDir, 'map.json');

const getJson = requestPath => new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port, path: requestPath }, response => {
    let body = '';
    response.on('data', chunk => { body += chunk; });
    response.on('end', () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } });
}).on('error', reject));

function fileUrlToPath(value) {
    let pathname = decodeURIComponent(new URL(value).pathname);
    if (/^\/[A-Za-z]:\//.test(pathname)) pathname = pathname.slice(1);
    return pathname.replace(/\//g, '\\');
}

function pathToFileUrl(value) {
    return `file:///${value.replace(/\\/g, '/')}`;
}

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

    fs.mkdirSync(outputDir, { recursive: true });
    const mapping = {};
    let generated = 0;
    let reused = 0;
    let failed = 0;
    for (const url of urls) {
        try {
            const sourcePath = fileUrlToPath(url);
            const key = crypto.createHash('sha256').update(url).digest('hex');
            const destination = path.join(outputDir, `${key}.webp`);
            if (!fs.existsSync(destination)) {
                await sharp(sourcePath, { failOn: 'none' })
                    .resize({ width, height, fit: 'cover', withoutEnlargement: true })
                    .webp({ quality: 84 })
                    .toFile(destination);
                generated++;
            } else {
                reused++;
            }
            mapping[url] = pathToFileUrl(destination);
        } catch {
            failed++;
        }
    }
    fs.writeFileSync(mapFile, JSON.stringify(mapping));
    const result = { marker: 'BADDEL_GRID_THUMBNAIL_TRIAL_PREPARED', width, height, requested: urls.length, mapped: Object.keys(mapping).length, generated, reused, failed, outputDir, mapFile };
    console.log(JSON.stringify(result));
})().catch(error => { console.error(error.stack || error); process.exit(1); });
