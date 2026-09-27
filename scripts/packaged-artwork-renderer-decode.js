const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
function getJson(url) { return new Promise((resolve, reject) => { const req = http.get(url, (res) => { let body=''; res.setEncoding('utf8'); res.on('data', c => body += c); res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } }); }); req.on('error', reject); req.setTimeout(10000, () => req.destroy(new Error('timeout'))); }); }
async function main() {
  const compatPath = path.join(process.cwd(), 'acceptance-checkpoints', 'packaged-compatibility', 'packaged-artwork-compatibility-node.json');
  const compat = JSON.parse(fs.readFileSync(compatPath, 'utf8'));
  const targets = await getJson('http://127.0.0.1:9224/json');
  const page = targets.find(t => t.type === 'page' && /dashboard\.html|Baddel Launcher/i.test(`${t.url} ${t.title}`)) || targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 1; const pending = new Map();
  const call = (method, params = {}) => new Promise((resolve, reject) => { const msgId = id++; pending.set(msgId, { resolve, reject }); ws.send(JSON.stringify({ id: msgId, method, params })); });
  ws.onmessage = (event) => { const msg = JSON.parse(event.data); const p = pending.get(msg.id); if (!p) return; pending.delete(msg.id); if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result); };
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws failed')); });
  try {
    await call('Runtime.enable');
    const expression = `new Promise((resolve) => {
      const img = new Image();
      const started = performance.now();
      const timer = setTimeout(() => resolve({ ok: false, stage: 'timeout', message: 'image decode timed out', src: img.src, durationMs: performance.now() - started }), 15000);
      img.onload = async () => {
        clearTimeout(timer);
        try { if (img.decode) await img.decode(); resolve({ ok: true, width: img.naturalWidth, height: img.naturalHeight, durationMs: performance.now() - started }); }
        catch (err) { resolve({ ok: false, stage: 'decode', message: err && err.message, width: img.naturalWidth, height: img.naturalHeight }); }
      };
      img.onerror = () => { clearTimeout(timer); resolve({ ok: false, stage: 'load', message: 'image load failed', src: img.src }); };
      img.src = ${JSON.stringify(compat.output.fileUrl)};
    })`;
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 30000 });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime exception');
    compat.rendererDecode = result.result.value;
    compat.status = compat.sharpLoaded && compat.boundsOk && compat.webpOk && compat.sizeOk && compat.rendererDecode?.ok ? 'success' : 'failed';
    compat.syntheticArtifactRemoved = false;
    try { fs.unlinkSync(compat.output.file); compat.syntheticArtifactRemoved = true; } catch (err) { compat.syntheticArtifactRemoveError = err.message; }
    fs.writeFileSync(compatPath, JSON.stringify(compat, null, 2));
    console.log(JSON.stringify(compat, null, 2));
  } finally { try { ws.close(); } catch {} }
}
main().catch((err) => { console.error(err.stack || err); process.exit(1); });
