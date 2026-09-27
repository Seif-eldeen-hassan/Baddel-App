#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const port = Number(process.argv.find(value => value.startsWith('--port='))?.slice(7) || 9223);
const mode = process.argv.find(value => value.startsWith('--mode='))?.slice(7) || 'apply';
const mapFile = path.resolve(process.argv.find(value => value.startsWith('--map='))?.slice(6) || '.perf-grid-thumbnails/160x240/map.json');
const mapping = mode === 'apply' ? JSON.parse(fs.readFileSync(mapFile, 'utf8')) : {};

const getJson = requestPath => new Promise((resolve, reject) => http.get({ host:'127.0.0.1', port, path:requestPath }, response => { let body=''; response.on('data', chunk => { body += chunk; }); response.on('end', () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } }); }).on('error', reject));

(async () => {
    const target = (await getJson('/json')).find(item => item.type === 'page' && /dashboard\.html/.test(item.url));
    if (!target) throw new Error('Dashboard target unavailable');
    const socket = new WebSocket(target.webSocketDebuggerUrl); let nextId=0; const pending=new Map();
    await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
    socket.onmessage=event=>{const message=JSON.parse(event.data);const job=pending.get(message.id);if(!job)return;pending.delete(message.id);message.error?job.reject(new Error(message.error.message)):job.resolve(message.result);};
    const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++nextId;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
    const expression = mode === 'apply' ? `(() => {
        if (window.__baddelGridThumbnailTrial) return { applied:false, reason:'already-applied' };
        const mapping = new Map(Object.entries(${JSON.stringify(mapping)}));
        const reverse = new Map([...mapping].map(([original, thumbnail]) => [thumbnail, original]));
        const originalResolve = window._agResolveCardCoverPayload;
        const originalReady = window._agSetArtworkReady;
        window._agResolveCardCoverPayload = function(game) {
            const payload = originalResolve(game);
            const thumbnail = mapping.get(String(payload?.cover || ''));
            return thumbnail ? { ...payload, cover:thumbnail } : payload;
        };
        window._agSetArtworkReady = function(game, cover, reason) {
            if (reverse.has(String(cover || ''))) return false;
            return originalReady(game, cover, reason);
        };
        window.__baddelGridThumbnailTrial = { mapping, reverse, originalResolve, originalReady };
        _vsReleaseAllRows();
        _vs.retainedCards.clear(); _vs.freeCards.length = 0; _vs.retainedCardBytes = 0;
        _vs.retainedCardStats = { hits:0, misses:0, evictions:0, peakBytes:0 };
        _vsRender(true);
        return { applied:true, mapped:mapping.size };
    })()` : `(() => {
        const trial = window.__baddelGridThumbnailTrial;
        if (!trial) return { restored:false, reason:'not-applied' };
        window._agResolveCardCoverPayload = trial.originalResolve;
        window._agSetArtworkReady = trial.originalReady;
        delete window.__baddelGridThumbnailTrial;
        _vsReleaseAllRows();
        _vs.retainedCards.clear(); _vs.freeCards.length = 0; _vs.retainedCardBytes = 0;
        _vs.retainedCardStats = { hits:0, misses:0, evictions:0, peakBytes:0 };
        _vsRender(true);
        return { restored:true };
    })()`;
    const result = await send('Runtime.evaluate', { expression, returnByValue:true, awaitPromise:true });
    socket.close();
    console.log(JSON.stringify(result.result.value));
})().catch(error=>{console.error(error.stack||error);process.exit(1);});
