#!/usr/bin/env node
'use strict';
const http = require('node:http');
const port = Number(process.argv.find(value => value.startsWith('--port='))?.slice(7) || 9223);
const getJson = path => new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port, path }, response => { let body=''; response.on('data', chunk => { body += chunk; }); response.on('end', () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } }); }).on('error', reject));
(async () => {
    const target = (await getJson('/json')).find(item => item.type === 'page' && /dashboard\.html/.test(item.url));
    if (!target) throw new Error('Dashboard target unavailable');
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    socket.send(JSON.stringify({ id: 1, method: 'Page.reload', params: { ignoreCache: true } }));
    await new Promise(resolve => setTimeout(resolve, 5000));
    socket.close();
    console.log('BADDEL_DASHBOARD_RELOADED');
})().catch(error => { console.error(error.stack || error); process.exit(1); });
