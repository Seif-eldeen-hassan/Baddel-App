'use strict';

const fs = require('node:fs');
const path = require('node:path');

function arg(name, fallback) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const http = require('node:http');
    const req = http.get(url, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}: ${body.slice(0, 200)}`));
          return;
        }
        try { resolve(JSON.parse(body)); } catch (err) { reject(err); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error(`Timeout for ${url}`)));
  });
}

async function main() {
  const port = Number(arg('port', '9225'));
  const out = path.resolve(arg('out', 'artwork-persistence-audit.json'));
  const targets = await getJson(`http://127.0.0.1:${port}/json`);
  const page = targets.find(t => t.type === 'page' && /dashboard\.html|Baddel Launcher/i.test(`${t.title || ''} ${t.url || ''}`)) || targets.find(t => t.type === 'page');
  if (!page?.webSocketDebuggerUrl) throw new Error('No page target found');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (!msg.id || !pending.has(msg.id)) return;
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
    else p.resolve(msg.result);
  };

  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('CDP websocket failed'));
  });

  try {
    await call('Runtime.enable');
    await call('Page.enable');
    const expression = `
      (async () => {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const deadline = Date.now() + 45000;
        while (Date.now() < deadline) {
          if (typeof window.__runArtworkPersistenceAudit === 'function') break;
          await wait(250);
        }
        if (typeof window.__runArtworkPersistenceAudit !== 'function') {
          throw new Error('window.__runArtworkPersistenceAudit is not available');
        }
        return await window.__runArtworkPersistenceAudit({ settleMs: 750, leaveSettleMs: 500 });
      })()
    `;
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 120000 });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime exception');
    fs.writeFileSync(out, JSON.stringify(result.result.value, null, 2), 'utf8');
    console.log(`BADDEL_ARTWORK_PERSISTENCE_AUDIT_WRITTEN ${out}`);
  } finally {
    try { ws.close(); } catch {}
  }
}

main().then(() => setTimeout(() => process.exit(0), 50)).catch((err) => {
  console.error(err && err.stack || err);
  process.exit(1);
});
