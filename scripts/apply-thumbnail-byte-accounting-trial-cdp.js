#!/usr/bin/env node
'use strict';

const http = require('node:http');
const port = Number(process.argv.find(value => value.startsWith('--port='))?.slice(7) || 9223);
const mode = process.argv.find(value => value.startsWith('--mode='))?.slice(7) || 'apply';
const width = Number(process.argv.find(value => value.startsWith('--width='))?.slice(8) || 128);
const height = Number(process.argv.find(value => value.startsWith('--height='))?.slice(9) || 192);

const getJson = requestPath => new Promise((resolve, reject) => http.get({ host:'127.0.0.1', port, path:requestPath }, response => { let body=''; response.on('data', chunk => { body += chunk; }); response.on('end', () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } }); }).on('error', reject));

(async () => {
    const target = (await getJson('/json')).find(item => item.type === 'page' && /dashboard\.html/.test(item.url));
    if (!target) throw new Error('Dashboard target unavailable');
    const socket = new WebSocket(target.webSocketDebuggerUrl); let nextId=0; const pending=new Map();
    await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
    socket.onmessage=event=>{const message=JSON.parse(event.data);const job=pending.get(message.id);if(!job)return;pending.delete(message.id);message.error?job.reject(new Error(message.error.message)):job.resolve(message.result);};
    const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++nextId;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
    const expression = mode === 'apply' ? `(() => {
        if (window.__baddelThumbnailByteTrial) return { applied:false };
        const original = window._vsCardDecodedBytes;
        window._vsCardDecodedBytes = function(card) {
            const src = _vsCardRefs(card).img?.getAttribute('src') || '';
            if (src.includes('/.perf-grid-thumbnails/128x192/')) return ${width} * ${height} * 4;
            return original(card);
        };
        window.__baddelThumbnailByteTrial = { original };
        _vsReleaseAllRows(); _vs.retainedCards.clear(); _vs.freeCards.length=0; _vs.retainedCardBytes=0;
        _vs.retainedCardStats={hits:0,misses:0,evictions:0,peakBytes:0}; _vsRender(true);
        return { applied:true, bytesPerThumbnail:${width}*${height}*4 };
    })()` : `(() => {
        const trial=window.__baddelThumbnailByteTrial;
        if (!trial) return {restored:false};
        window._vsCardDecodedBytes=trial.original; delete window.__baddelThumbnailByteTrial;
        return {restored:true};
    })()`;
    const result=await send('Runtime.evaluate',{expression,returnByValue:true});
    socket.close(); console.log(JSON.stringify(result.result.value));
})().catch(error=>{console.error(error.stack||error);process.exit(1);});
