#!/usr/bin/env node
'use strict';

const http = require('node:http');
const port = Number(process.argv.find(value => value.startsWith('--port='))?.slice(7) || 9223);
const bytes = Number(process.argv.find(value => value.startsWith('--bytes='))?.slice(8));
if (!Number.isFinite(bytes) || bytes <= 0) throw new Error('--bytes must be positive');

const getJson = requestPath => new Promise((resolve, reject) => http.get({ host:'127.0.0.1', port, path:requestPath }, response => { let body=''; response.on('data', chunk => { body += chunk; }); response.on('end', () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } }); }).on('error', reject));

(async () => {
    const target = (await getJson('/json')).find(item => item.type === 'page' && /dashboard\.html/.test(item.url));
    if (!target) throw new Error('Dashboard target unavailable');
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
    const result = await new Promise((resolve, reject) => {
        socket.onmessage = event => {
            const message = JSON.parse(event.data);
            if (message.id !== 1) return;
            message.error ? reject(new Error(message.error.message)) : resolve(message.result.result.value);
        };
        socket.send(JSON.stringify({ id:1, method:'Runtime.evaluate', params:{ returnByValue:true, expression:`(() => { _vs.retainedCardBudgetBytes = ${JSON.stringify(bytes)}; _vsEvictRetainedCardsToBudget(); return { budgetBytes:_vs.retainedCardBudgetBytes, retainedCards:_vs.retainedCards.size, retainedBytes:_vs.retainedCardBytes }; })()` } }));
    });
    socket.close();
    console.log(JSON.stringify(result));
})().catch(error=>{console.error(error.stack||error);process.exit(1);});
