const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
function arg(name, fallback) { const i = process.argv.indexOf(`--${name}`); return i >= 0 && process.argv[i+1] ? process.argv[i+1] : fallback; }
function getJson(url) { return new Promise((resolve, reject) => { const req = http.get(url, res => { let body=''; res.setEncoding('utf8'); res.on('data', c => body += c); res.on('end', () => { if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`HTTP ${res.statusCode}: ${body}`)); try { resolve(JSON.parse(body)); } catch(e) { reject(e); } }); }); req.on('error', reject); req.setTimeout(10000, () => req.destroy(new Error('timeout'))); }); }
async function cdpEval(expression, timeout = 120000) {
  const port = arg('port', '9224');
  const targets = await getJson(`http://127.0.0.1:${port}/json`);
  const page = targets.find(t => t.type === 'page' && /dashboard\.html|Baddel Launcher/i.test(`${t.url} ${t.title}`)) || targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 1; const pending = new Map();
  const call = (method, params = {}) => new Promise((resolve, reject) => { const msgId = id++; pending.set(msgId, { resolve, reject }); ws.send(JSON.stringify({ id: msgId, method, params })); });
  ws.onmessage = (event) => { const msg = JSON.parse(event.data); const p = pending.get(msg.id); if (!p) return; pending.delete(msg.id); if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result); };
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws failed')); });
  try { await call('Runtime.enable'); const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime exception'); return result.result.value; }
  finally { try { ws.close(); } catch {} }
}
(async () => {
  const mode = arg('mode', 'stats');
  const out = path.resolve(arg('out', 'acceptance-checkpoints/cdp-result.json'));
  let expression;
  if (mode === 'stats') expression = `(async () => ({ stats: await window.electronAPI.getArtworkDownloadStats(), url: location.href, ts: new Date().toISOString() }))()`;
  else if (mode === 'hydrate') expression = `(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    if (typeof window.navigateToAllGames === 'function') await window.navigateToAllGames(); else if (typeof navigateToAllGames === 'function') await navigateToAllGames();
    const start = performance.now();
    const startStats = await window.electronAPI.getArtworkDownloadStats();
    let last = null;
    let stable = 0;
    for (let i = 0; i < 240; i++) {
      await wait(1000);
      const stats = await window.electronAPI.getArtworkDownloadStats();
      const active = Number(stats.activeDownloads || stats.schedulerSnapshot?.active || 0);
      const queued = Number(stats.queuedDownloads || (Array.isArray(stats.schedulerSnapshot?.pending) ? stats.schedulerSnapshot.pending.length : 0));
      const jobs = Number(window._agT1Active || 0) + Number(window._agT2Active || 0) + Number(window._agT3Active || 0) + Number((window._agViewportCoverQueue || []).length) + Number((window._agBufferCoverQueue || []).length) + Number((window._agBackgroundCoverQueue || []).length);
      last = { stats, active, queued, jobs, readyArtworkCount: Array.from(window._agArtworkRegistry?.values?.() || []).filter(r => r && r.status === 'ready' && r.localUrl).length, totalGames: Array.isArray(window._vs?.items) ? window._vs.items.length : 0 };
      if (active === 0 && queued === 0 && jobs === 0) stable += 1; else stable = 0;
      if (stable >= 5) break;
    }
    return { start: startStats, end: last, durationMs: performance.now() - start, ts: new Date().toISOString() };
  })()`;
  else if (mode === 'scroll') expression = `(async () => { const wait = ms => new Promise(r => setTimeout(r, ms)); if (typeof window.navigateToAllGames === 'function') await window.navigateToAllGames(); else if (typeof navigateToAllGames === 'function') await navigateToAllGames(); await wait(1000); const scroller = document.querySelector('.ag-virtual-scroll') || document.querySelector('#allGamesView .games-grid-wrapper') || document.scrollingElement; const before = await window.electronAPI.getArtworkDownloadStats(); const start = performance.now(); for (let i=0; i<120; i++) { const t = i / 119; scroller.scrollTop = t * (scroller.scrollHeight - scroller.clientHeight); scroller.dispatchEvent(new Event('scroll', { bubbles: true })); await wait(16); } for (let i=0; i<120; i++) { const t = 1 - i / 119; scroller.scrollTop = t * (scroller.scrollHeight - scroller.clientHeight); scroller.dispatchEvent(new Event('scroll', { bubbles: true })); await wait(16); } await wait(3000); const after = await window.electronAPI.getArtworkDownloadStats(); return { before, after, durationMs: performance.now() - start, scrollTop: scroller.scrollTop, scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight, ts: new Date().toISOString() }; })()`;
  else throw new Error(`Unknown mode ${mode}`);
  const value = await cdpEval(expression, Number(arg('timeout', '300000')));
  fs.writeFileSync(out, JSON.stringify(value, null, 2));
  console.log(`CDP_ACCEPTANCE_WRITTEN ${out}`);
})().catch(err => { console.error(err.stack || err); process.exit(1); });
