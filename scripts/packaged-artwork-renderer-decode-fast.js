const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
function getJson(url) { return new Promise((resolve, reject) => { const req = http.get(url, res => { let body=''; res.setEncoding('utf8'); res.on('data', c => body += c); res.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { reject(e); } }); }); req.on('error', reject); req.setTimeout(10000, () => req.destroy(new Error('timeout'))); }); }
(async () => {
  const compatPath = path.join(process.cwd(), 'acceptance-checkpoints', 'packaged-compatibility', 'packaged-artwork-compatibility-node.json');
  const compat = JSON.parse(fs.readFileSync(compatPath, 'utf8'));
  const targets = await getJson('http://127.0.0.1:9224/json');
  const page = targets.find(t => t.type === 'page' && /dashboard\.html/i.test(t.url)) || targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let next = 1; const pending = new Map();
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = next++; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`CDP timeout ${method}`)); } }, params.timeout || 30000).unref?.(); });
  ws.onmessage = ev => { const msg = JSON.parse(ev.data); const p = pending.get(msg.id); if (!p) return; pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result); };
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws failed')); setTimeout(() => reject(new Error('ws open timeout')), 10000).unref?.(); });
  try {
    await call('Runtime.enable');
    await call('Page.bringToFront');
    const expression = `(async () => {
      const res = await fetch(${JSON.stringify(compat.output.fileUrl)});
      const blob = await res.blob();
      const bitmap = await createImageBitmap(blob);
      const out = { ok: true, width: bitmap.width, height: bitmap.height, type: blob.type, size: blob.size };
      bitmap.close();
      return out;
    })()`;
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 30000 });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || JSON.stringify(result.exceptionDetails));
    compat.rendererDecode = result.result.value;
    compat.status = compat.sharpLoaded && compat.boundsOk && compat.webpOk && compat.sizeOk && compat.rendererDecode?.ok ? 'success' : 'failed';
    try { fs.unlinkSync(compat.output.file); compat.syntheticArtifactRemoved = true; } catch (err) { compat.syntheticArtifactRemoveError = err.message; }
    fs.writeFileSync(compatPath, JSON.stringify(compat, null, 2));
    console.log(JSON.stringify(compat, null, 2));
  } finally { try { ws.close(); } catch {} }
})().catch(err => { console.error(err.stack || err); process.exit(1); });
