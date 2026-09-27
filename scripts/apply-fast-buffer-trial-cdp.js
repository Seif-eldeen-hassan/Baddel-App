#!/usr/bin/env node
'use strict';

const http = require('node:http');
const port = Number(process.argv.find(value => value.startsWith('--port='))?.slice(7) || 9223);
const mode = process.argv.find(value => value.startsWith('--mode='))?.slice(7) || 'apply';
const rows = Number(process.argv.find(value => value.startsWith('--rows='))?.slice(7) || 0);
const getJson = requestPath => new Promise((resolve, reject) => http.get({ host:'127.0.0.1', port, path:requestPath }, response => { let body=''; response.on('data', chunk => { body += chunk; }); response.on('end', () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } }); }).on('error', reject));

(async () => {
    const target=(await getJson('/json')).find(item=>item.type==='page'&&/dashboard\.html/.test(item.url));
    if(!target) throw new Error('Dashboard target unavailable');
    const socket=new WebSocket(target.webSocketDebuggerUrl);let nextId=0;const pending=new Map();
    await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
    socket.onmessage=event=>{const message=JSON.parse(event.data);const job=pending.get(message.id);if(!job)return;pending.delete(message.id);message.error?job.reject(new Error(message.error.message)):job.resolve(message.result);};
    const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++nextId;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
    const expression=mode==='apply'?`(() => {
        if (window.__baddelFastBufferTrial) window._vsRender=window.__baddelFastBufferTrial.original;
        const original=window._vsRender;
        const needle='const BUFFER_ROWS = isFastScrolling ? AG_VS_FAST_BUFFER_ROWS : AG_VS_NORMAL_BUFFER_ROWS;';
        const replacement='const BUFFER_ROWS = isFastScrolling ? ${rows} : AG_VS_NORMAL_BUFFER_ROWS;';
        const source=original.toString();
        if(!source.includes(needle)) return {applied:false,reason:'needle-missing'};
        window._vsRender=(0,eval)('('+source.replace(needle,replacement)+')');
        window.__baddelFastBufferTrial={original,rows:${rows}};
        _vsReleaseAllRows(); _vs.renderedStart=-1; _vs.renderedEnd=-1; _vsRender(true);
        return {applied:true,rows:${rows}};
    })()`:`(() => {
        const trial=window.__baddelFastBufferTrial;if(!trial)return {restored:false};
        window._vsRender=trial.original;delete window.__baddelFastBufferTrial;
        _vsReleaseAllRows();_vs.renderedStart=-1;_vs.renderedEnd=-1;_vsRender(true);
        return {restored:true};
    })()`;
    const result=await send('Runtime.evaluate',{expression,returnByValue:true});socket.close();console.log(JSON.stringify(result.result.value));
})().catch(error=>{console.error(error.stack||error);process.exit(1);});
