const http = require('node:http');
function getJson(url) { return new Promise((resolve, reject) => { const req = http.get(url, res => { let body=''; res.setEncoding('utf8'); res.on('data', c => body += c); res.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { reject(e); } }); }); req.on('error', reject); req.setTimeout(10000, () => req.destroy(new Error('timeout'))); }); }
(async () => {
  const version = await getJson('http://127.0.0.1:9224/json/version');
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  let id = 1; const pending = new Map();
  const call = (method, params = {}) => new Promise((resolve, reject) => { const msgId = id++; pending.set(msgId, { resolve, reject }); ws.send(JSON.stringify({ id: msgId, method, params })); });
  ws.onmessage = ev => { const msg = JSON.parse(ev.data); const p = pending.get(msg.id); if (!p) return; pending.delete(msg.id); if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result); };
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws failed')); });
  try { await call('Browser.close'); } finally { try { ws.close(); } catch {} }
  console.log('PACKAGED_APP_CLOSE_SENT');
})().catch(err => { console.error(err.stack || err); process.exit(1); });
